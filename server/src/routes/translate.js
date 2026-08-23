// EN<->KO 번역 — Google 비공개 엔드포인트 3개를 순회(POST 방식)하고
// LibreTranslate 를 백업으로 쓴다. 원본 translate.py 포트.
//
// 15.0 · '번역 실패'가 반복되던 원인 3개를 고쳤다.
//   ① 긴 글을 GET 쿼리로 보내 URL 길이 한도(≈8KB)에 걸려 414/실패 →
//      본문(POST)으로 보낸다. client=gtx 는 POST 를 지원한다.
//   ② 호스트 하나가 429(무료 한도)를 내면 10분간 엔진 전체를 잠갔는데,
//      이제 '그 호스트만' 2분 잠그고 나머지 호스트로 즉시 재시도한다.
//   ③ 글을 한 덩어리로 보내면 길이/한도에 걸리기 쉬워 → 문장 경계에서
//      1400자 조각으로 나눠 보내고, 되돌릴 땐 원본 그대로 이어 붙인다.
import crypto from 'node:crypto';
import { LT_URL, LT_KEY, TR_ENGINE } from '../lib/config.js';

const cache = new Map(); // key -> text (max ~500)

const GOOGLE_HOSTS = [
  'https://translate.googleapis.com',
  'https://clients5.google.com',
  'https://translate.google.com',
];
// Node fetch(undici)는 User-Agent 를 안 보낸다. Google 이 일부 요청을
// 걸러내지 않도록 브라우저 토큰을 붙인다.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 호스트별 429/5xx 쿨다운. 예전의 '전역 10분 잠금' 보다 훨씬 빨리 회복되고,
// 다른 호스트는 계속 쓸 수 있다. 왜 잠겼는지(429/5xx)도 기억해서
// 나중에 '한도 초과' 안내를 그대로 내보낼 수 있게 한다.
const HOST_COOLDOWN_MS = Math.max(0, parseInt(process.env.TRANSLATE_HOST_COOLDOWN_MS || '120000', 10));
const hostCooldown = new Map(); // host -> { until: epoch ms, reason: 'google 429' 등 }

const looksKorean = (t) => {
  let ko = 0;
  for (const ch of t) if (ch >= '\uAC00' && ch <= '\uD7A3') ko += 1;
  return ko >= Math.max(1, Math.floor(t.trim().length * 0.15));
};

const trLtCode = (target) => (target === 'zh-CN' ? 'zh' : target);

function detectSource(t) {
  if (looksKorean(t)) return 'ko';
  if (/[\u3040-\u30ff]/.test(t)) return 'ja';
  if (/[\u4e00-\u9fff]/.test(t)) return 'zh';
  return 'en';
}

// LibreTranslate 용: 문장 단위로 붙여 보낸다(띄어쓰기로 연결).
function chunkText(s, limit = 1000) {
  const parts = [];
  let cur = '';
  for (const seg of s.split(/(?<=[.!?\n\u3002\uff01\uff1f])\s*/)) {
    if (cur.length + seg.length > limit && cur) { parts.push(cur); cur = seg; }
    else cur = cur ? cur + seg : seg;
  }
  if (cur) parts.push(cur);
  return parts;
}

// Google 용: 문장/줄 경계에서 자르되 잘린 조각을 이어 붙이면
// 원본과 '한 글자도' 다르지 않게 만든다 (용어 사전 라인 수 등이 꼬이지 않게).
function chunkKeep(s, limit = 1400) {
  if (s.length <= limit) return [s];
  const parts = [];
  let cur = '';
  for (const seg of s.split(/(?<=[.!?\u3002\uff01\uff1f\n])/)) {
    if (cur.length + seg.length > limit && cur) { parts.push(cur); cur = seg; }
    else cur += seg;
    while (cur.length > limit) { parts.push(cur.slice(0, limit)); cur = cur.slice(limit); }
  }
  if (cur) parts.push(cur);
  return parts;
}

async function viaLibre(text, target) {
  if (!LT_URL) throw new Error('LibreTranslate 미설정');
  const tgt = trLtCode(target);
  const src = detectSource(text);
  if (src === tgt) return text;
  const out = [];
  for (const ch of chunkText(text)) {
    const payload = { q: ch, source: src, target: tgt, format: 'text' };
    if (LT_KEY) payload.api_key = LT_KEY;
    const r = await fetch(`${LT_URL}/translate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`libre ${r.status}`);
    const j = await r.json();
    out.push(j?.translatedText || '');
  }
  const res = out.filter(Boolean).join(' ').trim();
  if (!res) throw new Error('LibreTranslate 빈 결과');
  return res;
}

// Google 1회 시도. POST 본문으로 보내고(길이 무관), 짧은 글에서 POST 가
// 거부되면 옛 방식(GET)으로 한 번 더 본다.
async function googleOnce(host, text, target) {
  const url = `${host}/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&ie=UTF-8&oe=UTF-8`;
  const parse = async (r) => {
    if (!r.ok) throw new Error(`google ${r.status}`);
    const j = await r.json();
    const out = (j?.[0] || []).map((seg) => seg?.[0] || '').join('');
    if (!out.trim()) throw new Error('빈 결과');
    return out;
  };
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': UA,
      },
      body: 'q=' + encodeURIComponent(text),
      signal: AbortSignal.timeout(15000),
    });
    return await parse(r);
  } catch (e) {
    const retriable = e.name === 'AbortError' || /google (429|5\d\d)/.test(e.message || '');
    if (retriable) throw e;                        // 호스트 문제 → 다음 호스트
    if (text.length <= 1200) {                     // POST 자체가 거부된 경우
      const g = await fetch(`${url}&q=${encodeURIComponent(text)}`, {
        headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000),
      });
      return await parse(g);
    }
    throw e;
  }
}

async function viaGoogle(text, target) {
  const errs = [];
  for (const host of GOOGLE_HOSTS) {
    const cd = hostCooldown.get(host);
    if (cd && cd.until > Date.now()) {
      errs.push(`${host.replace('https://', '')}: 쿨다운(${cd.reason})`);
      continue;
    }
    try {
      const out = await googleOnce(host, text, target);
      hostCooldown.delete(host);
      return out;
    } catch (e) {
      const msg = String((e && e.message) || e);
      errs.push(`${host.replace('https://', '')}: ${msg}`);
      // 429(무료 한도)·5xx·타임아웃 → 그 호스트만 잠시 쉰다
      if (/google (429|5\d\d)|AbortError|빈 결과/.test(msg)) {
        hostCooldown.set(host, { until: Date.now() + HOST_COOLDOWN_MS, reason: msg });
      }
    }
  }
  throw new Error(`google 실패 (${errs.join(' / ')})`);
}

async function translateCore(text, target) {
  const preferLibre = TR_ENGINE === 'libre';
  let googleErr = null;
  if (!preferLibre) {
    try {
      // 짧게 나눠 보낸다 — 무료 엔진은 요청이 짧을수록 안정적이다.
      const parts = chunkKeep(text);
      const outs = [];
      for (const p of parts) outs.push(await viaGoogle(p, target));
      const joined = outs.join('');
      if (!joined.trim()) throw new Error('빈 결과');
      return [joined, 'google'];
    } catch (e) {
      googleErr = String((e && e.message) || e);
      console.log(`[translate] Google 실패(${googleErr.slice(0, 200)}) → LibreTranslate 백업 시도`);
    }
  }
  if (LT_URL) {
    const out = await viaLibre(text, target);
    return [out, 'libre'];
  }
  // 마지막까지 실패 → '왜' 실패했는지(429 등)를 그대로 실어 보낸다.
  throw new Error(googleErr || 'LibreTranslate 미설정');
}

const TOK_RE = /\[\[\s*(\d+)\s*\]\]/g;

function maskGloss(text, gloss) {
  if (!gloss || !Object.keys(gloss).length) return [text, {}];
  const terms = Object.keys(gloss).map((t) => String(t).trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  const mapping = {};
  for (const t of terms) {
    const pat = new RegExp(`(?<![A-Za-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`);
    if (!pat.test(text)) continue;
    const idx = String(Object.keys(mapping).length);
    mapping[idx] = gloss[t];
    text = text.replace(new RegExp(pat.source, 'g'), `[[${idx}]]`);
  }
  return [text, mapping];
}

export function registerTranslate(app) {
  app.post('/api/translate', async (req, reply) => {
    const data = req.body || {};
    const text = String(data.text || '').trim();
    let target = String(data.target || '').toLowerCase();
    let gloss = data.gloss || {};
    if (!gloss || typeof gloss !== 'object' || Array.isArray(gloss)) gloss = {};
    if (!text) return reply.code(400).send({ ok: false, error: '번역할 내용이 없습니다' });
    if (text.length > 5000) return reply.code(400).send({ ok: false, error: '한 번에 5000자까지 번역할 수 있습니다' });
    const ALLOWED = ['ko', 'en', 'ja', 'zh-cn'];
    if (!ALLOWED.includes(target)) target = looksKorean(text) ? 'en' : 'ko';
    if (target === 'zh-cn') target = 'zh-CN';

    const gkey = crypto.createHash('sha256').update(JSON.stringify(gloss, Object.keys(gloss).sort())).digest('hex').slice(0, 12);
    const key = `>${target}:${gkey}:${crypto.createHash('sha256').update(text).digest('hex')}`;
    if (cache.has(key)) return reply.send({ ok: true, text: cache.get(key), target, cached: true });
    try {
      if (target === 'ko' && looksKorean(text)) {
        return reply.send({ ok: true, text, target, unchanged: true });
      }
      const [masked, mapping] = maskGloss(text, gloss);
      const [out, engine] = await translateCore(masked, target);
      if (!out) return reply.code(502).send({ ok: false, error: '번역 결과가 비었습니다' });
      let final = out;
      if (Object.keys(mapping).length) {
        final = final.replace(TOK_RE, (m, g1) => mapping[String(g1).trim()] ?? m);
      }
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      cache.set(key, final);
      return reply.send({ ok: true, text: final, target, engine });
    } catch (e) {
      const detail = String((e && e.message) || e).slice(0, 160);
      console.error('[translate] 실패:', detail);
      // 429 는 '지금 많이 해서 잠깐 막힘' — 안내를 다르게 준다.
      // (지난 번 쿨다운 기록은 제외하고 이번 시도에서 직접 받은 429만 본다)
      const fresh = detail.replace(/쿨다운\([^)]*\)/g, '');
      const limited = /google 429/.test(fresh);
      return reply.code(502).send({
        ok: false,
        error: limited
          ? '지금 번역 요청이 몰려 잠시 제한됐어요 · 1~2분 뒤 다시 시도해 주세요'
          : `번역 서버에 닿지 않아요 (${detail})`,
      });
    }
  });

  app.post('/api/translate/gloss', async (req, reply) => {
    const data = req.body || {};
    const raw = data.terms || [];
    const terms = [];
    const seen = new Set();
    for (const t of raw) {
      const s = String(t ?? '').trim();
      if (s && !seen.has(s)) { seen.add(s); terms.push(s); }
      if (terms.length >= 80) break;
    }
    let target = String(data.target || 'ko').toLowerCase();
    if (!['ko', 'en', 'ja', 'zh-cn'].includes(target)) target = 'ko';
    if (target === 'zh-cn') target = 'zh-CN';
    if (!terms.length) return reply.send({ ok: true, gloss: {} });
    const out = {};
    const need = [];
    for (const t of terms) {
      if (/^[A-Z][A-Z0-9]{1,9}([-.][A-Z0-9]+)*$/.test(t)) out[t] = t;
      else need.push(t);
    }
    if (!need.length) return reply.send({ ok: true, gloss: out });
    try {
      const tr = async (s) => {
        try { return (await translateCore(s, target))[0] || s; }
        catch { return s; }
      };
      let res = '';
      try { res = await tr(need.join('\n')); } catch { res = ''; }
      const lines = res.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === need.length) {
        need.forEach((t, i) => { out[t] = lines[i] || t; });
      } else {
        for (const t of need) {
          try { out[t] = (await tr(t)).trim() || t; } catch { out[t] = t; }
        }
      }
      for (const t of Object.keys(out)) if (!out[t]) out[t] = t;
      return reply.send({ ok: true, gloss: out });
    } catch (e) {
      console.error('[gloss] 실패:', e);
      return reply.code(502).send({ ok: false, error: '용어 번역 실패' });
    }
  });
}
