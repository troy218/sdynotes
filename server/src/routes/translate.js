// EN<->KO 번역 (Google 우선, LibreTranslate 백업). 원본 translate.py 포트.
import crypto from 'node:crypto';
import { LT_URL, LT_KEY, TR_ENGINE } from '../lib/config.js';

const cache = new Map(); // key -> text (max ~500)
let googleCooldown = 0;  // epoch sec — until this time prefer Libre

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

async function viaGoogle(text, target) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`google ${r.status}`);
  const j = await r.json();
  const out = (j?.[0] || []).map((seg) => seg?.[0] || '').join('');
  if (!out) throw new Error('빈 결과');
  return out;
}

async function translateCore(text, target) {
  const preferLibre = TR_ENGINE === 'libre';
  const tryLibreFirst = preferLibre || Date.now() / 1000 < googleCooldown;
  if (!tryLibreFirst && TR_ENGINE !== 'libre') {
    try {
      const out = await viaGoogle(text, target);
      return [out, 'google'];
    } catch (e) {
      console.log(`[translate] Google 실패(${e.message}) → LibreTranslate 백업 시도`);
      googleCooldown = Date.now() / 1000 + 600;
    }
  }
  if (LT_URL) {
    const out = await viaLibre(text, target);
    return [out, 'libre'];
  }
  throw new Error('번역 엔진 모두 사용 불가');
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
    const ALLOWED = ['ko', 'en', 'ja', 'zh-cn', 'zh-cn'];
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
      const [out] = await translateCore(masked, target);
      if (!out) return reply.code(502).send({ ok: false, error: '번역 결과가 비었습니다' });
      let final = out;
      if (Object.keys(mapping).length) {
        final = final.replace(TOK_RE, (m, g1) => mapping[String(g1).trim()] ?? m);
      }
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      cache.set(key, final);
      return reply.send({ ok: true, text: final, target });
    } catch (e) {
      console.error('[translate] 실패:', e);
      return reply.code(502).send({ ok: false, error: '번역 서버에 연결할 수 없습니다' });
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
    if (!['ko', 'en', 'ja', 'zh-cn', 'zh-CN'].includes(target)) target = 'ko';
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
