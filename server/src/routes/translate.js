// EN<->KO 번역 — Google 비공개 엔드포인트 여러 갈래를 순회하고
// LibreTranslate · MyMemory 를 백업으로 쓴다. 원본 translate.py 포트.
//
// 15.0 · '번역 실패'가 반복되던 원인 3개를 고쳤다.
//   ① 긴 글을 GET 쿼리로 보내 URL 길이 한도(≈8KB)에 걸려 414/실패 →
//      본문(POST)으로 보낸다. client=gtx 는 POST 를 지원한다.
//   ② 호스트 하나가 429(무료 한도)를 내면 10분간 엔진 전체를 잠갔는데,
//      이제 '그 호스트만' 잠시 잠그고 나머지 호스트로 즉시 재시도한다.
//   ③ 글을 한 덩어리로 보내면 길이/한도에 걸리기 쉬워 → 문장 경계에서
//      1400자 조각으로 나눠 보내고, 되돌릴 땐 원본 그대로 이어 붙인다.
//
// 15.2 · gtx 한 갈래가 막히면 상자마다 '번역 실패'가 쏟아지던 문제.
//   · gtx POST 가 죽어도 짧은 글은 GET 으로 한 번 더 본다 (옛 빠른 경로).
//   · client=at · dict-chrome-ex · batchexecute · MyMemory 를 이어서 시도.
//   · 응답 형식이 달라도(dj=1, /t 배열) 같은 파서로 글을 꺼낸다.
//   · '빈 결과'만으로 호스트를 잠그지 않는다 (한 문장 파싱 실패 ≠ 엔진 사망).
//   · 용어 묶음이 실패하면 용어별 재시도를 생략해 한도를 더 깎지 않는다.
import crypto from 'node:crypto';
import { LT_URL, LT_KEY, TR_ENGINE } from '../lib/config.js';

const cache = new Map(); // key -> text (max ~500)
// 같은 문서의 여러 상자가 동시에 같은 문장을 요청하거나 사용자가 재클릭해도
// 외부 무료 엔진에 중복 요청을 보내지 않는다. 요청 폭주/429의 가장 흔한 원인이다.
const inFlight = new Map(); // key -> Promise<{ text, engine }>

const GOOGLE_HOSTS = [
  'https://translate.googleapis.com',
  'https://clients5.google.com',
  'https://translate.google.com',
];
// Node fetch(undici)는 User-Agent 를 안 보낸다. Google 이 일부 요청을
// 걸러내지 않도록 브라우저 토큰을 붙인다.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const G_HEADERS = {
  'User-Agent': UA,
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://translate.google.com/',
};

// 호스트별 429/5xx 쿨다운. 예전의 '전역 10분 잠금' 보다 훨씬 빨리 회복되고,
// 다른 호스트는 계속 쓸 수 있다. 왜 잠겼는지(429/5xx)도 기억해서
// 나중에 '한도 초과' 안내를 그대로 내보낼 수 있게 한다.
const HOST_COOLDOWN_MS = Math.max(0, parseInt(process.env.TRANSLATE_HOST_COOLDOWN_MS || '60000', 10));
const HOST_SOFT_COOLDOWN_MS = Math.max(0, parseInt(process.env.TRANSLATE_HOST_SOFT_COOLDOWN_MS || String(Math.min(15000, HOST_COOLDOWN_MS)), 10));
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

// LibreTranslate도 Google과 같은 방식으로 자른다. 이전 구현은 문장 경계의
// 공백/줄바꿈을 버린 뒤 ' '로 다시 붙여, 백업 엔진을 탄 번역문이 저장될 때
// 원본의 문단 구조가 바뀌는 문제가 있었다.
function chunkText(s, limit = 1000) {
  return chunkKeep(s, limit);
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

function cooldownMsFor(msg, eName) {
  if (/429/.test(msg)) return HOST_COOLDOWN_MS;
  if (/google 5\d\d/.test(msg) || /fetch failed/i.test(msg) || eName === 'TimeoutError' || eName === 'AbortError' || /aborted due to timeout/i.test(msg)) {
    return HOST_SOFT_COOLDOWN_MS;
  }
  return 0;
}

// gtx / client=at / dict-chrome-ex / dj=1 응답을 한곳에서 푼다.
function parseGoogleJson(j) {
  if (typeof j === 'string') {
    const s = j.trim();
    if (!s) return '';
    try { j = JSON.parse(s); } catch { return ''; }
  }
  if (!j) return '';
  if (typeof j.translatedText === 'string') return j.translatedText;
  if (Array.isArray(j.sentences)) {
    return j.sentences.map((s) => (s && s.trans) || '').join('');
  }
  if (Array.isArray(j)) {
    // /translate_a/t : [["안녕","en"]] 또는 ["안녕","en"]
    if (typeof j[0] === 'string') return j[0];
    if (Array.isArray(j[0])) {
      if (typeof j[0][0] === 'string' && !Array.isArray(j[0][0])) {
        // [["안녕 세계","en"]] 또는 [[["안녕","hello",...], ...], ...] 의 후자?
        // 후자는 j[0][0] 이 배열. 여기 분기는 전자.
        if (!Array.isArray(j[0][0])) {
          return j.map((row) => (Array.isArray(row) ? row[0] : '') || '').join('');
        }
      }
      // classic gtx: [[["안녕","hello",null,null], ...], null, "en"]
      return j[0].map((seg) => (Array.isArray(seg) ? seg[0] : '') || '').join('');
    }
  }
  return '';
}

async function readGoogle(r) {
  if (!r.ok) throw new Error(`google ${r.status}`);
  const raw = await r.text();
  let j;
  try { j = JSON.parse(raw); } catch {
    throw new Error('google 응답 형식');
  }
  const out = parseGoogleJson(j);
  if (!String(out).trim()) throw new Error('빈 결과');
  return out;
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
  const res = out.filter(Boolean).join('');
  if (!res) throw new Error('LibreTranslate 빈 결과');
  return res;
}

// Google 1회 시도. POST 본문으로 보내고(길이 무관), 짧은 글에서 POST 가
// 거부·타임아웃되면 옛 방식(GET)으로 한 번 더 본다.
async function googleOnce(host, text, target) {
  const url = `${host}/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&ie=UTF-8&oe=UTF-8`;
  const getOnce = () => fetch(`${url}&q=${encodeURIComponent(text)}`, {
    headers: G_HEADERS, signal: AbortSignal.timeout(8000),
  }).then(readGoogle);

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        ...G_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: 'q=' + encodeURIComponent(text),
      signal: AbortSignal.timeout(8000),
    });
    return await readGoogle(r);
  } catch (e) {
    // 짧은 글은 POST 가 죽어도 GET 이 되는 경우가 많다 (15.0 이전의 빠른 경로).
    // 429/5xx 는 같은 호스트 GET 도 거의 실패하므로 건너뛴다.
    const eMsg = String((e && e.message) || '');
    if (/google (429|5\d\d)/.test(eMsg)) throw e;
    if (text.length <= 1200) {
      try { return await getOnce(); } catch { /* fall through */ }
    }
    throw e;
  }
}

async function viaGoogle(text, target) {
  const errs = [];
  // '한도(429) 때문에 막혔다'는 문자열 추론이 아니라 플래그로 추적한다.
  //  · 이번 시도에서 직접 429 를 받았거나(fresh)
  //  · 아예 시도할 호스트가 없을 정도로 전부 쿨다운인데 그 사유가 429 이면
  //    쿨다운 중 재요청에도 '잠시 제한' 안내가 정확히 나간다.
  //    (옛 코드는 안내 문자열에서 쿨다운 표기를 지워 원인을 짚다가 이 경우
  //     원인이 통째로 지워져 '번역 서버에 닿지 않아요'가 나갔다)
  let freshLimited = false, cooldownOnly = true, cooldownHad429 = false;
  let earliestCooldown = 0; // 가장 빨리 풀리는 쿨다운 시각 (retry_after 힌트)
  const noteCooldown = (until) => { if (!earliestCooldown || until < earliestCooldown) earliestCooldown = until; };
  for (const host of GOOGLE_HOSTS) {
    const cd = hostCooldown.get(host);
    if (cd && cd.until > Date.now()) {
      errs.push(`${host.replace('https://', '')}: 쿨다운(${cd.reason})`);
      if (/429/.test(String(cd.reason))) cooldownHad429 = true;
      noteCooldown(cd.until);
      continue;
    }
    cooldownOnly = false;
    try {
      const out = await googleOnce(host, text, target);
      hostCooldown.delete(host);
      return out;
    } catch (e) {
      const eName = String((e && e.name) || '');
      const msg = String((e && e.message) || e);
      errs.push(`${host.replace('https://', '')}: ${msg || eName}`);
      // 429(무료 한도)·5xx·타임아웃·연결 실패 → 그 호스트만 잠시 쉰다.
      // '빈 결과'는 그 문장만의 파싱 문제일 수 있어 호스트를 잠그지 않는다.
      const wait = cooldownMsFor(msg, eName);
      if (wait > 0) {
        const until = Date.now() + wait;
        hostCooldown.set(host, { until, reason: msg || eName });
        noteCooldown(until);
      }
      if (/google 429/.test(msg)) freshLimited = true;
    }
  }
  const err = new Error(`google 실패 (${errs.join(' / ')})`);
  // 직접 받은 429 가 있거나, 시도 자체가 불가할 만큼 전부 429 쿨다운이면 '제한' 취급
  const limited = freshLimited || (cooldownOnly && cooldownHad429);
  err.limited = limited;                       // 429 계열 실패 → 클라이언트 안내 분기
  err.retryAfterMs = limited && earliestCooldown
    ? Math.max(1000, earliestCooldown - Date.now()) : 0;
  throw err;
}

// Android 클라이언트(client=at). gtx 와 한도가 달라 막힌 뒤에도 되는 경우가 많다.
async function viaGoogleAt(text, target) {
  const key = 'google-at';
  const cd = hostCooldown.get(key);
  if (cd && cd.until > Date.now()) throw new Error(`google-at 쿨다운(${cd.reason})`);
  const url = `https://translate.google.com/translate_a/single?client=at&dt=t&dt=rm&dj=1&sl=auto&tl=${encodeURIComponent(target)}`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        ...G_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: new URLSearchParams({ sl: 'auto', tl: target, q: text }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    const out = await readGoogle(r);
    hostCooldown.delete(key);
    return out;
  } catch (e) {
    const msg = String((e && e.message) || e);
    const wait = cooldownMsFor(msg, e && e.name);
    if (wait > 0) hostCooldown.set(key, { until: Date.now() + wait, reason: msg });
    const err = new Error(msg.startsWith('google') ? msg.replace('google', 'google-at') : `google-at ${msg}`);
    if (/429/.test(msg)) err.limited = true;
    throw err;
  }
}

// Chrome 사전 확장 엔드포인트. 응답이 [["글","en"]] 형태다.
async function viaChromeDict(text, target) {
  const key = 'google-chrome';
  const cd = hostCooldown.get(key);
  if (cd && cd.until > Date.now()) throw new Error(`google-chrome 쿨다운(${cd.reason})`);
  if (text.length > 1200) throw new Error('google-chrome 너무 김');
  const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(target)}&q=${encodeURIComponent(text)}`;
  try {
    const r = await fetch(url, { headers: G_HEADERS, signal: AbortSignal.timeout(10000) });
    const out = await readGoogle(r);
    hostCooldown.delete(key);
    return out;
  } catch (e) {
    const msg = String((e && e.message) || e);
    const wait = cooldownMsFor(msg, e && e.name);
    if (wait > 0) hostCooldown.set(key, { until: Date.now() + wait, reason: msg });
    const err = new Error(msg.startsWith('google') ? msg.replace('google', 'google-chrome') : `google-chrome ${msg}`);
    if (/429/.test(msg)) err.limited = true;
    throw err;
  }
}

function parseBatchExecute(raw) {
  const body = String(raw || '').replace(/^\)\]\}'\s*/, '');
  for (const chunk of body.split('\n')) {
    const s = chunk.trim();
    if (!s.startsWith('[')) continue;
    let arr;
    try { arr = JSON.parse(s); } catch { continue; }
    if (!Array.isArray(arr)) continue;
    const rows = (arr[0] === 'wrb.fr') ? [arr] : arr;
    for (const translation of rows) {
      if (!Array.isArray(translation) || translation[0] !== 'wrb.fr') continue;
      if (!translation[2]) continue;
      let inner;
      try { inner = JSON.parse(translation[2]); } catch { continue; }
      try {
        const cell = inner?.[1]?.[0]?.[0];
        if (!cell) continue;
        if (cell[5] == null) return String(cell[0] || '');
        return cell[5].map((o) => (o && o[0]) || '').filter(Boolean).join('');
      } catch { /* next row */ }
    }
  }
  return '';
}

// translate.google.com 이 쓰는 batchexecute. gtx 보다 한도가 느슨하다.
async function viaGoogleBatch(text, target) {
  const key = 'google-batch';
  const cd = hostCooldown.get(key);
  if (cd && cd.until > Date.now()) throw new Error(`google-batch 쿨다운(${cd.reason})`);
  const rpcids = 'MkEWBc';
  const qs = new URLSearchParams({
    rpcids,
    'source-path': '/',
    'f.sid': '',
    bl: '',
    hl: 'en-US',
    'soc-app': '1',
    'soc-platform': '1',
    'soc-device': '1',
    _reqid: String(1000 + Math.floor(Math.random() * 9000)),
    rt: 'c',
  });
  const freq = [[rpcids, JSON.stringify([[text, 'auto', target, true], [null]]), null, '0']];
  try {
    const r = await fetch(`https://translate.google.com/_/TranslateWebserverUi/data/batchexecute?${qs}`, {
      method: 'POST',
      headers: {
        ...G_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: 'f.req=' + encodeURIComponent(JSON.stringify([freq])) + '&',
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(`google-batch ${r.status}`);
    const out = parseBatchExecute(await r.text());
    if (!String(out).trim()) throw new Error('빈 결과');
    hostCooldown.delete(key);
    return out;
  } catch (e) {
    const msg = String((e && e.message) || e);
    const wait = cooldownMsFor(msg, e && e.name);
    if (wait > 0) hostCooldown.set(key, { until: Date.now() + wait, reason: msg });
    const err = new Error(msg);
    if (/429/.test(msg)) err.limited = true;
    throw err;
  }
}

// 키 없는 공개 백업. 품질은 Google 보다 떨어지지만 '실패'보다는 낫다.
async function viaMyMemory(text, target) {
  const key = 'mymemory';
  const cd = hostCooldown.get(key);
  if (cd && cd.until > Date.now()) throw new Error(`mymemory 쿨다운(${cd.reason})`);
  const src = detectSource(text);
  const tgt = target === 'zh-CN' ? 'zh-CN' : target;
  if (src === tgt) return text;
  const out = [];
  try {
    for (const ch of chunkKeep(text, 450)) {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(ch)}&langpair=${encodeURIComponent(`${src}|${tgt}`)}`;
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error(`mymemory ${r.status}`);
      const j = await r.json();
      const t = j?.responseData?.translatedText;
      if (!t || /MYMEMORY WARNING/i.test(t)) throw new Error('mymemory 한도');
      out.push(t);
    }
    const res = out.join('');
    if (!res.trim()) throw new Error('mymemory 빈 결과');
    hostCooldown.delete(key);
    return res;
  } catch (e) {
    const msg = String((e && e.message) || e);
    const wait = cooldownMsFor(msg, e && e.name);
    if (wait > 0) hostCooldown.set(key, { until: Date.now() + wait, reason: msg });
    throw e;
  }
}

async function mapParts(text, fn) {
  const parts = chunkKeep(text);
  const outs = [];
  for (const p of parts) outs.push(await fn(p));
  const joined = outs.join('');
  if (!joined.trim()) throw new Error('빈 결과');
  return joined;
}

async function translateCore(text, target) {
  const preferLibre = TR_ENGINE === 'libre';
  let limitedErr = null;
  let lastErr = null;
  const remember = (e) => {
    lastErr = e;
    if (e && e.limited) limitedErr = e;
  };

  const tryEng = async (label, fn) => {
    try {
      const out = await fn();
      if (out && String(out).trim()) return out;
      throw new Error('빈 결과');
    } catch (e) {
      remember(e);
      console.log(`[translate] ${label} 실패(${String((e && e.message) || e).slice(0, 160)})`);
      return null;
    }
  };

  if (!preferLibre) {
    let hit = await tryEng('Google gtx', () => mapParts(text, (p) => viaGoogle(p, target)));
    if (hit) return [hit, 'google'];
    hit = await tryEng('Google at', () => mapParts(text, (p) => viaGoogleAt(p, target)));
    if (hit) return [hit, 'google'];
    hit = await tryEng('Google chrome', () => viaChromeDict(text, target));
    if (hit) return [hit, 'google'];
    hit = await tryEng('Google batch', () => mapParts(text, (p) => viaGoogleBatch(p, target)));
    if (hit) return [hit, 'google'];
  }
  if (LT_URL) {
    const hit = await tryEng('LibreTranslate', () => viaLibre(text, target));
    if (hit) return [hit, 'libre'];
  }
  const mm = await tryEng('MyMemory', () => viaMyMemory(text, target));
  if (mm) return [mm, 'mymemory'];

  // 마지막까지 실패 → Google 429 가 핵심이면 그 안내를 우선 보존한다.
  throw limitedErr || lastErr || new Error('LibreTranslate 미설정');
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
    // String(object)는 "[object Object]"를 번역하는 사고를 만든다. API 입력을
    // 명확히 문자열로 제한하고, 앞뒤 공백은 결과에 다시 붙여 편집 내용을 보존한다.
    if (typeof data.text !== 'string') return reply.code(400).send({ ok: false, error: '번역할 내용은 문자열이어야 합니다' });
    const rawText = data.text;
    const lead = (rawText.match(/^\s*/) || [''])[0];
    const tail = (rawText.match(/\s*$/) || [''])[0];
    const text = rawText.slice(lead.length, rawText.length - tail.length);
    let target = String(data.target || '').toLowerCase();
    let gloss = data.gloss || {};
    if (!gloss || typeof gloss !== 'object' || Array.isArray(gloss)) gloss = {};
    if (!text) return reply.code(400).send({ ok: false, error: '번역할 내용이 없습니다' });
    if (text.length > 5000) return reply.code(400).send({ ok: false, error: '한 번에 5000자까지 번역할 수 있습니다' });
    const ALLOWED = ['ko', 'en', 'ja', 'zh-cn'];
    if (!ALLOWED.includes(target)) target = looksKorean(text) ? 'en' : 'ko';
    if (target === 'zh-cn') target = 'zh-CN';

    const gkey = crypto.createHash('sha256').update(JSON.stringify(gloss, Object.keys(gloss).sort())).digest('hex').slice(0, 12);
    const key = `>${target}:${gkey}:${crypto.createHash('sha256').update(rawText).digest('hex')}`;
    if (cache.has(key)) return reply.send({ ok: true, text: cache.get(key), target, cached: true });
    try {
      const source = detectSource(text);
      // 이미 목적 언어인 경우에도 ko만 예외였던 탓에 영문→en, 일본어→ja는
      // 불필요하게 외부 서버를 거쳤다. 네 언어 모두 즉시 반환한다.
      if (source === trLtCode(target)) {
        return reply.send({ ok: true, text: rawText, target, unchanged: true });
      }
      let job = inFlight.get(key);
      if (!job) {
        job = (async () => {
          const [masked, mapping] = maskGloss(text, gloss);
          const [out, engine] = await translateCore(masked, target);
          if (!out || !String(out).trim()) throw new Error('번역 결과가 비었습니다');
          let final = out;
          if (Object.keys(mapping).length) {
            final = final.replace(TOK_RE, (m, g1) => mapping[String(g1).trim()] ?? m);
          }
          // 엔진이 앞뒤 공백을 정리하더라도 노트에 있던 공백은 그대로 보존한다.
          final = lead + final + tail;
          if (cache.size >= 500) cache.delete(cache.keys().next().value);
          cache.set(key, final);
          return { text: final, engine };
        })();
        inFlight.set(key, job);
        // 실패한 Promise를 Map에 남기면 이후 재시도가 영구 실패한다.
        job.finally(() => inFlight.delete(key)).catch(() => {});
      }
      const result = await job;
      return reply.send({ ok: true, text: result.text, target, engine: result.engine });
    } catch (e) {
      const detail = String((e && e.message) || e).slice(0, 160);
      console.error('[translate] 실패:', detail);
      // 429 는 '지금 많이 해서 잠깐 막힘' — 안내를 다르게 준다.
      // 엔진이 달아 준 limited 플래그를 우선 본다(쿨다운 중 재요청도 정확히 안내).
      // 옛 코드는 160자로 자른 안내 문자열에서 쿨다운 표기를 지워 429를 짚었는데,
      // 세 호스트가 모두 쿨다운이면 원인이 통째로 지워져 '닿지 않아요'가 나갔다.
      const fresh = String((e && e.message) || e).replace(/쿨다운\([^)]*\)/g, '');
      const limited = Boolean(e && e.limited) || /google 429/.test(fresh);
      const retryAfter = limited
        ? Math.min(600, Math.max(1, Math.ceil(((e && e.retryAfterMs) || 60000) / 1000)))
        : undefined;
      return reply.code(502).send({
        ok: false,
        error: limited
          ? `지금 번역 요청이 몰려 잠시 제한됐어요 · 약 ${retryAfter}초 뒤 다시 시도해 주세요`
          : `번역 서버에 닿지 않아요 (${detail})`,
        retry_after: retryAfter,
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
      const tr = (s) => translateCore(s, target).then((r) => r[0] || s);
      let res = '';
      let batchFailed = false;
      try { res = await tr(need.join('\n')); } catch { res = ''; batchFailed = true; }
      const lines = res.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === need.length) {
        need.forEach((t, i) => { out[t] = lines[i] || t; });
      } else if (batchFailed) {
        // 엔진이 죽은 상태에서 용어별 재시도는 한도만 더 깎는다.
        for (const t of need) out[t] = t;
      } else {
        // 용어별 재시도 중 엔진이 죽으면(429 등) 즉시 멈추고 나머지는 원문을 둔다.
        // 예전처럼 최대 80회를 넋놓고 본 남으면 무료 엔진 한도만 더 깎아 먹어서
        // 한 번의 상자 번역이 사이트 전체 429 를 부르는 폭주 원인이 됐다.
        for (let i = 0; i < need.length; i++) {
          const t = need[i];
          try { out[t] = (await tr(t)).trim() || t; }
          catch { for (; i < need.length; i++) out[need[i]] = need[i]; break; }
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
