// 14.30.0 · 해돌이 인터넷 도구 — 웹 검색 + 사진 검색/저장 (키 없이 동작).
//
//  - GET  /api/ai/web?q=...    → 인터넷 검색 결과 (여러 무료 소스를 순서대로 시도)
//  - GET  /api/ai/imgs?q=...   → 사진 후보 목록 (위키미디어 커먼즈)
//  - POST /api/ai/imgadd       → {q} 사진을 찾아 이 서버 저장소에 받아 노트용
//                                주소(/api/img/…)로 돌려준다 (upload와 같은 파이프라인)
//
// 설계 원칙 (ai.js 와 같다)
//  · API 키가 없는 무료 엔드포인트만 쓴다 → .env 를 건드릴 필요가 없다.
//  · 돈·저장소가 드는 imgadd 는 캐시 + 창 레이트리밋 + 512KB~20MB 상한을 건다.
//  · 외부 호출은 전부 서버에서 — 브라우저에 키/주소를 심지 않는다.
//  · 위키미디어 파일은 라이선스(대개 CC-BY-SA/퍼블릭도메인)로 개인 노트에 안전.
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { DIRS } from '../lib/paths.js';
import { CLOUD_READY } from '../lib/config.js';
import { uploadStream } from '../lib/cloudinary.js';
import { requireUser } from '../lib/userauth.js';

const WEB_TTL = 10 * 60 * 1000;      // 검색 결과 캐시 10분
const IMG_TTL = 10 * 60 * 1000;      // 사진 후보 캐시 10분
const MAX_CACHE = 300;
const RATE_N = 24;                   // 창당 요청 수 (web+img 합계)
const RATE_WINDOW = 60 * 1000;
const FETCH_MS = 14000;              // 소스 하나당 기다림
const DOWNLOAD_MS = 25000;           // 사진 내려받기 상한
const MAX_DOWNLOAD = 20 * 1024 * 1024;   // 20MB
const MIN_DOWNLOAD = 512;                 // 그보다 작으면 깨진 파일로 본다
const MAX_IMG_EDGE = 1600;                // 저장 전 긴 변 리사이즈

// ── 캐시 · 레이트리밋 (ai.js 와 같은 모양, 가볍게) ──────────────────────────
const cacheMap = new Map();   // key -> {at, data}
function cacheGet(key) {
  const hit = cacheMap.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > (String(key).startsWith('img:') ? IMG_TTL : WEB_TTL)) {
    cacheMap.delete(key);
    return null;
  }
  return hit.data;
}
function cachePut(key, data) {
  if (cacheMap.size >= MAX_CACHE) {
    let oldest = null;
    for (const [k, v] of cacheMap) if (!oldest || v.at < oldest.at) oldest = { k, at: v.at };
    if (oldest) cacheMap.delete(oldest.k);
  }
  cacheMap.set(key, { at: Date.now(), data });
}
const hits = new Map();
function rateHit(key, now = Date.now()) {
  const arr = (hits.get(key) || []).filter((t) => now - t < RATE_WINDOW);
  if (arr.length >= RATE_N) {
    const retry = Math.max(1, Math.ceil((RATE_WINDOW - (now - arr[0])) / 1000));
    return { ok: false, retry };
  }
  arr.push(now);
  hits.set(key, arr);
  return { ok: true, retry: 0 };
}
function rlKey(req, kind) {
  const u = requireUser(req);
  return `${kind}:${u ? `uid:${u.uid}` : `ip:${req.ip || 'unknown'}`}`;
}
function htmlDecode(s) {
  return String(s == null ? '' : s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Math.min(0xffff, Number(d))));
}
function stripTags(s) {
  return htmlDecode(String(s == null ? '' : s)).replace(/<[^>]*>/g, ' ');
}
function cleanText(s, n) {
  return stripTags(s).replace(/\s+/g, ' ').trim().slice(0, n || 260);
}
function normUrl(u) {
  return String(u || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '').toLowerCase();
}
async function withTimeout(promise, ms, label) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error(`${label || '요청'} 시간 초과`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── ① 웹 검색 엔진들 — 앞이 실패/부족하면 다음으로 ──────────────────────────
// 공개 무료 엔드포인트만: Bing RSS · 위키백과(ko/en) · DuckDuckGo Instant Answer.
async function bingSearch(q) {
  const u = `https://www.bing.com/search?q=${encodeURIComponent(q)}&format=rss&count=10&mkt=ko-KR`;
  const r = await fetch(u, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SDYnotes/14.30)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_MS),
  });
  if (!r.ok) throw new Error('bing ' + r.status);
  const xml = await r.text();
  const out = [];
  const items = String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const m of items) {
    const body = m[1];
    const title = cleanText((body.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '', 200);
    const link = ((body.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
    const desc = cleanText((body.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '', 300);
    if (!title || !/^https?:\/\//i.test(link)) continue;
    out.push({ title, url: htmlDecode(link), snippet: desc || '', source: 'bing' });
  }
  if (!out.length) throw new Error('bing empty');
  return out;
}

async function wikiSearch(lang, q) {
  const api = `https://${lang}.wikipedia.org/w/api.php?action=query&generator=search`
    + `&gsrsearch=${encodeURIComponent(q)}&gsrnamespace=0&gsrlimit=5`
    + `&prop=extracts&exintro=1&explaintext=1&exlimit=5&format=json&redirects=1`;
  const r = await fetch(api, {
    headers: { 'User-Agent': 'SDYnotes/14.30 (note app helper)' },
    signal: AbortSignal.timeout(FETCH_MS),
  });
  if (!r.ok) throw new Error(`wiki ${r.status}`);
  const j = await r.json();
  const pages = j && j.query && j.query.pages ? Object.values(j.query.pages) : [];
  const out = [];
  for (const p of pages) {
    if (!p || !p.title) continue;
    out.push({
      title: p.title,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(p.title).replace(/ /g, '_'))}`,
      snippet: cleanText(p.extract || '', 300),
      source: `${lang}.wikipedia.org`,
    });
  }
  if (!out.length) throw new Error('wiki empty');
  return out;
}

function flattenDDG(topics, out) {
  (topics || []).forEach((t) => {
    if (!t) return;
    if (Array.isArray(t.Topics)) flattenDDG(t.Topics, out);
    else if (t && t.FirstURL && t.Text) out.push({
      title: cleanText(t.Text.split(' - ')[0], 180),
      url: t.FirstURL,
      snippet: cleanText(t.Text, 300),
      source: 'duckduckgo',
    });
  });
}
async function ddgSearch(q) {
  const u = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1&t=sdynotes`;
  const r = await fetch(u, {
    headers: { 'User-Agent': 'SDYnotes/14.30' },
    signal: AbortSignal.timeout(FETCH_MS),
  });
  if (!r.ok) throw new Error('ddg ' + r.status);
  const j = await r.json();
  const out = [];
  if (j.AbstractURL && (j.AbstractText || j.Heading)) {
    out.push({
      title: cleanText(j.Heading || j.AbstractURL, 180),
      url: j.AbstractURL,
      snippet: cleanText(j.AbstractText || '', 300),
      source: 'duckduckgo',
    });
  }
  flattenDDG(j.RelatedTopics, out);
  if (!out.length) throw new Error('ddg empty');
  return out;
}

async function webSearch(q) {
  const engines = [
    ['bing', () => bingSearch(q)],
    ['ko.wikipedia.org', () => wikiSearch('ko', q)],
    ['en.wikipedia.org', () => wikiSearch('en', q)],
    ['duckduckgo', () => ddgSearch(q)],
  ];
  const seen = new Set();
  const results = [];
  const tried = [];
  for (const [name, run] of engines) {
    if (results.length >= 8) break;
    try {
      const got = await withTimeout(run(), FETCH_MS + 2000, name);
      for (const item of got) {
        if (!item || !/^https?:\/\//i.test(String(item.url || ''))) continue;
        const key = normUrl(item.url);
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(item);
        if (results.length >= 8) break;
      }
      tried.push(`${name}:${got.length}`);
    } catch (e) {
      tried.push(`${name}:fail`);
    }
  }
  return { results, tried: tried.join(' ') };
}

// ── ② 사진 검색 — 위키미디어 커먼즈 (키 없음 · CORS 허용 · 라이선스 명시) ──
async function commonsImageSearch(q) {
  const api = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search'
    + `&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap')}&gsrnamespace=6&gsrlimit=12`
    + '&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1400&format=json&redirects=1';
  const r = await fetch(api, {
    headers: { 'User-Agent': 'SDYnotes/14.30 (note app helper)' },
    signal: AbortSignal.timeout(FETCH_MS),
  });
  if (!r.ok) throw new Error('commons ' + r.status);
  const j = await r.json();
  const pages = j && j.query && j.query.pages ? Object.values(j.query.pages) : [];
  const out = [];
  for (const p of pages) {
    const ii = p && p.imageinfo && p.imageinfo[0];
    if (!ii || !ii.url) continue;
    const mime = String(ii.mime || '');
    if (!/^image\/(jpeg|png|webp|gif|bmp)/.test(mime)) continue;
    const w = Number(ii.width) || 0;
    const h = Number(ii.height) || 0;
    if (w < 240 || h < 240) continue;   // 너무 작은 썸네일은 노트에 어울리지 않는다
    const title = String(p.title || '').replace(/^File:/, '').replace(/_/g, ' ').trim();
    let credit = '';
    try { credit = cleanText((ii.extmetadata && (ii.extmetadata.LicenseShortName || {}).value) || '', 40); } catch (e) {}
    out.push({
      title: title.slice(0, 200) || q,
      url: ii.thumburl || ii.url,          // 1400px 이하 썸네일 (원본보다 가벼움)
      full: ii.url,
      page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(p.title || '').replace(/ /g, '_'))}`,
      width: w, height: h,
      license: credit || '',
      source: 'wikimedia',
    });
  }
  if (!out.length) throw new Error('commons empty');
  return out;
}

// 로컬/사설망으로 나가지 않게 — 외부 사진을 받을 때만 검사한다.
function publicUrlOnly(u) {
  let host;
  try { host = new URL(u).hostname; } catch (e) { return false; }
  if (host === 'localhost') return false;
  const ipv4 = host.replace(/^\[|\]$/g, '');
  if (/^127\./.test(ipv4) || /^10\./.test(ipv4) || /^192\.168\./.test(ipv4)
      || /^169\.254\./.test(ipv4) || /^0\./.test(ipv4)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ipv4)) return false;
  if (ipv4 === '::1' || ipv4 === '::' || /^fe80:/i.test(ipv4)) return false;
  return /^https:/i.test(u);
}

async function downloadImage(url) {
  if (!publicUrlOnly(url)) throw new Error('허용되지 않은 주소');
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SDYnotes/14.30)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_MS),
  });
  if (!r.ok) throw new Error('download ' + r.status);
  const len = Number(r.headers.get('content-length') || 0);
  if (len > MAX_DOWNLOAD) throw new Error('이미지가 너무 큼');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD) throw new Error('이미지가 너무 큼');
  if (buf.length < MIN_DOWNLOAD) throw new Error('이미지가 너무 작음');
  return buf;
}

// 저장소에 저장 → /api/img/<file> (pages.js 의 /api/upload 와 같은 파이프라인)
async function storeImage(buf) {
  let img = sharp(buf).rotate();
  const meta = await img.metadata();
  if ((meta.width || 0) > MAX_IMG_EDGE) img = img.resize({ width: MAX_IMG_EDGE, withoutEnlargement: true });
  const out = await img.webp({ quality: 82 }).toBuffer();
  const finalMeta = await sharp(out).metadata();
  const w = finalMeta.width || meta.width || 0;
  const h = finalMeta.height || meta.height || 0;

  if (!CLOUD_READY) {
    const fid = `img_${crypto.randomBytes(6).toString('hex')}`;
    const fn = `${fid}.webp`;
    await fsp.mkdir(DIRS.img, { recursive: true });
    await fsp.writeFile(path.join(DIRS.img, fn), out);
    return { url: `/api/img/${fn}`, public_id: fn, width: w, height: h, storage: 'oracle' };
  }
  const res = await uploadStream(out, { folder: 'sdynotes', resource_type: 'image' });
  const originalUrl = res.secure_url;
  return {
    url: originalUrl.replace('/upload/', '/upload/f_auto,q_auto/'),
    public_id: res.public_id, width: w, height: h, storage: 'cloud',
  };
}

// ── ③ 라우트 ────────────────────────────────────────────────────────────────
function qOf(req) {
  return String((req.query && (req.query.q || req.query.query)) || '').trim().slice(0, 200);
}
function replyErr(reply, status, error) {
  return reply.code(status).send({ ok: false, error });
}

export function registerAiTools(app) {
  // 웹 검색 — 해돌이가 [[search]] 판단 뒤 이 결과를 달고 답한다.
  app.get('/api/ai/web', async (req, reply) => {
    const q = qOf(req);
    if (q.length < 2) return replyErr(reply, 400, '검색어를 적어 주세요');
    const rl = rateHit(rlKey(req, 'web'));
    if (!rl.ok) return replyErr(reply, 429, `잠시 뒤에 다시 시도해 주세요 · ${RATE_N}번/${Math.round(RATE_WINDOW / 1000)}초`);
    const ck = 'web:' + q.toLowerCase();
    const hit = cacheGet(ck);
    if (hit) return reply.send(Object.assign({ ok: true, cached: true }, hit));
    try {
      const got = await webSearch(q);
      if (!got.results.length) return replyErr(reply, 404, '검색 결과를 찾지 못했어요 · 검색어를 바꿔 보세요');
      const data = { q, results: got.results, engines: got.tried };
      cachePut(ck, data);
      return reply.send(Object.assign({ ok: true, cached: false }, data));
    } catch (e) {
      console.error('[ai/web]', e && e.message);
      return replyErr(reply, 502, '인터넷 검색에 닿지 못했어요 · 잠시 뒤 다시 시도해 주세요');
    }
  });

  // 사진 후보 — 고르는 화면이 없어도 디버그/확장용으로 열어 둔다.
  app.get('/api/ai/imgs', async (req, reply) => {
    const q = qOf(req);
    if (q.length < 2) return replyErr(reply, 400, '찾을 사진을 적어 주세요');
    const rl = rateHit(rlKey(req, 'img'));
    if (!rl.ok) return replyErr(reply, 429, `잠시 뒤에 다시 시도해 주세요 · ${RATE_N}번/${Math.round(RATE_WINDOW / 1000)}초`);
    const ck = 'img:' + q.toLowerCase();
    const hit = cacheGet(ck);
    if (hit) return reply.send(Object.assign({ ok: true, cached: true }, hit));
    try {
      const list = await commonsImageSearch(q);
      const data = { q, results: list.slice(0, 8) };
      cachePut(ck, data);
      return reply.send(Object.assign({ ok: true, cached: false }, data));
    } catch (e) {
      console.error('[ai/imgs]', e && e.message);
      return replyErr(reply, 502, '사진 검색에 닿지 못했어요 · 잠시 뒤 다시 시도해 주세요');
    }
  });

  // 사진을 찾아 이 서버에 저장하고 노트용 주소로 돌려준다 (@img 적용기가 사용)
  app.post('/api/ai/imgadd', async (req, reply) => {
    const b = (req.body && typeof req.body === 'object') ? req.body : {};
    const q = String(b.q || b.query || '').trim().slice(0, 200);
    if (q.length < 2) return replyErr(reply, 400, '찾을 사진을 적어 주세요');
    const rl = rateHit(rlKey(req, 'imgadd'));
    if (!rl.ok) return replyErr(reply, 429, `잠시 뒤에 다시 시도해 주세요 · ${RATE_N}번/${Math.round(RATE_WINDOW / 1000)}초`);
    const ck = 'add:' + q.toLowerCase();
    const hit = cacheGet(ck);
    if (hit) return reply.send(Object.assign({ ok: true, cached: true }, hit));

    let cands = [];
    try { cands = await commonsImageSearch(q); } catch (e) { /* 아래에서 빈 목록 처리 */ }
    if (!cands.length) return replyErr(reply, 404, '‘' + q + '’ 사진을 찾지 못했어요 · 검색어를 바꿔 보세요');
    let lastErr = '';
    for (const c of cands.slice(0, 4)) {
      try {
        const buf = await downloadImage(c.url);
        const stored = await storeImage(buf);
        const data = {
          q,
          url: stored.url,
          public_id: stored.public_id,
          width: stored.width, height: stored.height,
          title: c.title, page: c.page, license: c.license,
        };
        cachePut(ck, data);
        return reply.send(Object.assign({ ok: true, cached: false }, data));
      } catch (e) {
        lastErr = String(e && e.message || e);
        // 몇 장은 깨졌을 수 있으니 다음 후보로
      }
    }
    return replyErr(reply, 502, '사진을 받아오지 못했어요 · ' + (lastErr || '잠시 뒤 다시 시도해 주세요'));
  });
}
