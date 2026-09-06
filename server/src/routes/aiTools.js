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
import { translateFree } from './translate.js';
import { aiQuickText } from './ai.js';

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

// ── ② 사진 검색 ────────────────────────────────────────────────────────────
// 14.31.0 · "연관 없는 사진이 나온다"는 불만의 원인 세 가지와 대책
//   ① 한국어 검색어를 그대로 넣었다 — 커먼즈 검색은 영어가 훨씬 잘 맞는다
//      → 요청을 한 번 AI(imgq)에 부탁해 '무엇의 사진인지' 영어 검색어 3단계로
//        바꾼다. AI 가 꺼져 있으면 (무료 번역 → 낱말 정제) 순으로 대체한다.
//   ② 소스가 커먼즈 하나였다 — 주제에 따라 결과가 없거나 한쪽으로 쳤다
//      → 커먼즈 + 오픈버스(공개 사진 모음)를 함께 찾는다.
//   ③ '검색 결과 순위'를 그대로 믿었다
//      → 제목·설명이 검색어와 얼마나 맞는지 점수를 매겨 줄을 다시 세우고,
//        로고·지도·도표·아이콘처럼 '사진이 아닌 것'을 걷어 낸다.
//
//   아래 순수 함수(cleanImgQuery · imgTerms · imgScore · imgRank)는 네트워크를
//   쓰지 않아 test/ai_img_search_contract.mjs 가 그대로 검증한다.

const IMG_MIN_SCORE = 2;           // 이보다 낮으면 '잘 맞는 사진'으로 보지 않는다
const IMG_TRY_DOWNLOAD = 5;        // 상위 후보 몇 장까지 내려받기를 시도할지
const IMG_QUERY_MS = 9000;         // 검색어 만들기 상한
const IMG_TRANSLATE_MS = 7000;     // 무료 번역 상한
const IMG_MIN_EDGE = 300;          // 노트에 넣기 너무 작은 사진(가로·세로)은 뺀다

// 요청 문장에 섞이는 부탁 말·조사·수식어 — 검색어에서는 뺀다(낱말 단위로만).
const IMG_STOP = new Set([
  // 영어
  'photo', 'photos', 'photograph', 'picture', 'pictures', 'image', 'images', 'pic', 'pics', 'img',
  'of', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'with', 'and', 'or', 'this', 'that', 'it',
  'please', 'plz', 'add', 'insert', 'put', 'find', 'search', 'show', 'me', 'some', 'into', 'note', 'page',
  // 한국어 (조사는 아래 꼬리 떼기에서 함께 지운다)
  '사진', '이미지', '이미지들', '포토', '짤', '그림', '그림파일', '파일', '사진들',
  '넣어', '넣어줘', '넣어주세요', '넣고', '넣는', '넣을', '넣습니다', '추가', '추가해', '추가해줘', '추가해주세요',
  '찾아', '찾아서', '찾아줘', '찾고', '찾는', '찾을', '붙여', '붙여줘', '붙이고',
  '삽입', '삽입해', '올려', '올려줘', '올리고', '실어', '첨부', '첨부해', '가져와', '가져와줘', '보여줘', '보여주세요',
  '주세요', '해줘', '해주세요', '부탁', '부탁해', '줘', '달라', '주라', '좀', '한번', '제발',
  '아래에', '아래', '밑에', '밑', '위에', '위', '옆에', '옆', '다음', '그리고', '함께', '같이', '같은',
  '어울리는', '알맞은', '적당한', '관련', '관련된', '관한', '대한', '대해', '대해서',
  '나타내는', '보여주는', '대표하는', '예쁜', '멋진', '귀여운', '실제', '진짜',
  '이', '그', '저', '것', '무엇', '뭐', '어떤', '여기', '거기', '안에', '속에',
  '노트', '쪽', '페이지', '문서', '그리고는', '그다음',
]);

// 사진이 아닌 것 — 제목에 있으면 크게 감점한다(검색어에 들어 있으면 예외).
const IMG_JUNK = [
  'logo', 'logos', 'icon', 'icons', 'map', 'maps', 'chart', 'charts', 'diagram', 'diagrams',
  'graph', 'graphs', 'plot', 'flag', 'flags', 'seal', 'emblem', 'coat', 'screenshot',
  'poster', 'banner', 'signage', 'sign', 'symbol', 'font', 'alphabet', 'collage', 'montage',
  'texture', 'pattern', 'wallpaper', 'background', 'template', 'qr', 'barcode', 'sprite',
  'vector', 'svg', 'clip', 'clipart', 'blank', 'placeholder', 'wiki', 'commons', 'category',
  'button', 'gui', 'website', 'infographic', 'thumbnail',
];

// 한국어 낱말인지 — 영어 낱말에서 조사만 떼는 일이 없게 구분한다.
function isKoWord(w) { return /[가-힣]/.test(w) && !/[A-Za-z0-9]/.test(w); }
// 낱말 뒤 조사·어미 — "고양이를" → "고양이"
//   ★한 글자 조사는 '낱말의 일부'인 경우가 많다(노을·고양이·모기·의자).
//     그래서 ① 두 글자 이상 어미는 줄기가 2글자 이상 남을 때, ② 한 글자
//     조사는 줄기가 3글자 이상 남을 때만 떼어 낸다.
const KO_TAIL2 = /(에서|에게|부터|까지|처럼|보다|이나|이랑|하고|면서|지만|이라고|이라는|라는|인데|입니다|들의|에는|으로는|지는|지은|하는|되는|있는|있는지|위한|대한|관한|통해|따른)$/;
const KO_TAIL1 = /(을|를|의|은|는|이|가|과|와|도|만|으로|로|에|고|며|랑)$/;
const EDGE_PUNC = /^[(\[「『"'<《]*|[)\]」』"'>.?!,;:~《》]*$/;
function koStem(w) {
  let out = String(w || '');
  for (let i = 0; i < 2; i++) {
    const m2 = KO_TAIL2.exec(out);
    if (m2 && out.length - m2[1].length >= 2) { out = out.slice(0, out.length - m2[1].length); continue; }
    const m1 = KO_TAIL1.exec(out);
    if (m1 && out.length - m1[1].length >= 3) { out = out.slice(0, out.length - m1[1].length); continue; }
    break;
  }
  return out;
}
// "사진을"·"이미지는" 처럼 조사가 붙어 목록에 안 걸리는 경우를 잡는다 —
//   뒤에서 한 글자씩 줄여 가며 '빼야 할 낱말'인지 본다. (노을·의자 같은
//   낱말이 잘못 지워지지 않게, 줄여 본 낱말은 이 목록에서만 확인한다.)
const IMG_STOP_PREFIX = ['사진', '이미지', '포토', '짤', '그림', '파일', '문서', '페이지',
  '추가', '찾아', '찾는', '넣어', '넣는', '넣을', '올려', '올리', '붙여', '보여', '가져', '부탁', '실어', '첨부', '삽입'];
function koStopped(w) {
  for (let k = w.length - 1; k >= 2; k--) {
    if (IMG_STOP_PREFIX.indexOf(w.slice(0, k)) >= 0) return true;
  }
  return false;
}

// 검색어로 쓸 낱말만 남긴다 (순수 함수 — 네트워크·번역 없음)
export function cleanImgQuery(q) {
  let s = String(q == null ? '' : q).replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!s) return '';
  s = s.replace(/^\s*\/?\s*(?:img|photo|pic|image|사진|이미지)\s*[:：]\s*/i, '');   // '/사진:' · '이미지:'
  s = s.replace(/^\s*\/?\s*(?:img|photo|pic|image|사진|이미지)\s+/i, '');           // '/사진 고양이'
  const out = [];
  for (const raw of s.split(' ')) {
    let w = String(raw || '').replace(EDGE_PUNC, '');
    if (!w) continue;
    if (IMG_STOP.has(w.toLowerCase())) continue;
    if (koStopped(w)) continue;
    if (isKoWord(w)) w = koStem(w);                 // "고양이를" → "고양이" (노을·고양이는 그대로)
    if (!w) continue;
    if (IMG_STOP.has(w.toLowerCase())) continue;
    out.push(w);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

// 점수를 매길 때 쓸 검색 낱말 (불용어 제거 + 조사 제거, 소문자)
export function imgTerms(q) {
  const s = String(q == null ? '' : q).toLowerCase();
  const out = [];
  for (const raw of s.split(/[^A-Za-z0-9가-힣]+/)) {
    let w = String(raw || '').trim();
    if (!w) continue;
    if (IMG_STOP.has(w)) continue;
    if (koStopped(w)) continue;
    if (isKoWord(w)) w = koStem(w);
    if (!w || w.length < 2) continue;
    if (IMG_STOP.has(w)) continue;
    out.push(w);
  }
  return out.slice(0, 8);
}

function wordRe(t) {
  const esc = String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (isKoWord(t)) return new RegExp(esc);                                   // 한글은 경계 없이
  // 영어는 낱말 단위로, 복수형(cat → cats·boxes)도 같은 낱말로 본다.
  return new RegExp('(^|[^a-z0-9가-힣])' + esc + '(?:es|s)?(?![a-z0-9가-힣])');
}

// 후보 한 장이 검색어와 얼마나 맞는지 — 제목이 가장 중요, 설명·분류는 보너스.
export function imgScore(cand, terms) {
  const c = cand || {};
  const title = String(c.title || '').toLowerCase();
  const desc = String(c.desc || '').toLowerCase();
  const cats = String(c.cats || '').toLowerCase();
  const set = new Set((terms || []).map((t) => String(t || '').toLowerCase()));
  let score = 0; let matched = 0;
  for (const raw of terms || []) {
    const t = String(raw || '').toLowerCase();
    if (t.length < 2) continue;
    const re = wordRe(t);
    if (re.test(title)) { score += 6; matched++; }
    else if (re.test(desc)) { score += 3; matched++; }
    else if (re.test(cats)) { score += 2; matched++; }
    else if (isKoWord(t)) continue;        // 한국어 검색어가 영어 사진에 없는 건 당연 — 감점하지 않는다
    else score -= 2;                       // 영어 검색어가 안 걸리면 조금씩 감점(하나라도 제목에 걸리면 통과)
  }
  // 사진이 아닌 것(로고·지도·도표…) — 검색어에 그 낱말이 있으면 예외("지도 사진")
  for (const w of IMG_JUNK) {
    if (set.has(w)) continue;
    if (wordRe(w).test(title)) score -= 8;
  }
  const w = Number(c.width) || 0;
  const h = Number(c.height) || 0;
  if (w >= 800 && w <= 3000) score += 2;
  else if (w >= 500) score += 1;
  else if (w && w < 400) score -= 2;
  if (/(featured|quality images|valued|picture of the)/.test(cats)) score += 2;
  if (w && h) {
    const r = w / h;
    if (r < 0.45 || r > 3.2) score -= 4;              // 세로로만 길거나 파노라마는 노트에 어색하다
    else if (r >= 0.9 && r <= 2) score += 1;
  }
  return { score, matched };
}

// 후보 목록을 다시 세운다 — 너무 작은 사진·중복 제목을 걷어 내고 점수 순으로.
export function imgRank(list, terms) {
  const seen = new Set();
  const out = [];
  for (const c of list || []) {
    if (!c || !c.url) continue;
    const w = Number(c.width) || 0;
    const h = Number(c.height) || 0;
    if (w < IMG_MIN_EDGE || h < IMG_MIN_EDGE) continue;      // 노트에 넣기엔 너무 작다
    const key = String(c.title || '').toLowerCase().replace(/[^a-z0-9가-힣]+/g, ' ').trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const s = imgScore(c, terms);
    out.push(Object.assign({}, c, { score: s.score, matched: s.matched }));
  }
  out.sort((a, b) => (b.score - a.score) || ((Number(b.width) || 0) - (Number(a.width) || 0)));
  return out;
}

function looksKorean(t) {
  let ko = 0;
  const s = String(t || '');
  for (const ch of s) if (ch >= '\uAC00' && ch <= '\uD7A3') ko += 1;
  return ko >= Math.max(1, Math.floor(s.trim().length * 0.3));
}

// ── 사진 소스 ① 위키미디어 커먼즈 (키 없음 · CORS 허용 · 라이선스 명시) ─────
async function commonsImageSearch(q, limit = 14) {
  const api = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search'
    + `&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap')}&gsrnamespace=6&gsrlimit=${limit}`
    + '&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1400&format=json&redirects=1';
  const r = await fetch(api, {
    headers: { 'User-Agent': 'SDYnotes/14.31 (note app helper)' },
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
    if (w < IMG_MIN_EDGE || h < IMG_MIN_EDGE) continue;
    const title = String(p.title || '').replace(/^File:/, '').replace(/_/g, ' ').trim();
    const em = ii.extmetadata || {};
    let credit = '';
    try { credit = cleanText((em.LicenseShortName || {}).value || '', 40); } catch (e) { /* 무시 */ }
    out.push({
      title: title.slice(0, 200) || q,
      url: ii.thumburl || ii.url,          // 1400px 이하 썸네일 (원본보다 가벼움)
      full: ii.url,
      page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(p.title || '').replace(/ /g, '_'))}`,
      width: w, height: h,
      license: credit || '',
      desc: cleanText((em.ImageDescription || {}).value || '', 240),
      cats: cleanText((em.Categories || {}).value || '', 240).replace(/\|/g, ' '),
      source: 'wikimedia',
    });
  }
  if (!out.length) throw new Error('commons empty');
  return out;
}

// ── 사진 소스 ② 오픈버스 (Flickr·Wikimedia 등 공개 사진 모음, 키 없음) ──────
//   커먼즈에 결과가 없거나 한쪽으로 치우친 주제가 여기서 채워진다.
async function openverseSearch(q, limit = 12) {
  const u = 'https://api.openverse.org/v1/images/?q=' + encodeURIComponent(q)
    + `&page_size=${limit}&license_type=commercial&mature=false`;
  const r = await fetch(u, {
    headers: { 'User-Agent': 'SDYnotes/14.31 (note app helper)', Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_MS),
  });
  if (!r.ok) throw new Error('openverse ' + r.status);
  const j = await r.json();
  const list = (j && j.results) || [];
  const out = [];
  for (const it of list) {
    if (!it) continue;
    const w = Number(it.width) || 0;
    const h = Number(it.height) || 0;
    if (w < IMG_MIN_EDGE || h < IMG_MIN_EDGE) continue;
    const full = String(it.url || '');
    const url = (w > 1600 && it.thumbnail) ? String(it.thumbnail) : full;   // 너무 큰 원본은 썸네일로
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({
      title: cleanText(it.title || '', 200) || q,
      url,
      full: full || url,
      page: String(it.foreign_landing_url || ''),
      width: w, height: h,
      license: [String(it.license || ''), String(it.license_version || '')].filter(Boolean).join(' '),
      desc: cleanText(it.creator ? `by ${it.creator}` : '', 120),
      cats: String(it.source || ''),
      source: 'openverse',
    });
  }
  if (!out.length) throw new Error('openverse empty');
  return out;
}

// 두 소스를 함께 찾고 점수 순으로 다시 세운다.
async function searchImagesRanked(q, terms) {
  const sources = [
    ['wikimedia', () => commonsImageSearch(q)],
    ['openverse', () => openverseSearch(q)],
  ];
  const seen = new Set();
  const results = [];
  const tried = [];
  await Promise.all(sources.map(async ([name, run]) => {
    try {
      const got = await withTimeout(run(), FETCH_MS + 2000, name);
      for (const it of got) {
        const key = normUrl(it.url) + '|' + String(it.title || '').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(it);
      }
      tried.push(`${name}:${got.length}`);
    } catch (e) {
      tried.push(`${name}:fail`);
    }
  }));
  return { results: imgRank(results, terms), tried: tried.join(' ') };
}

// 요청 문장 → 검색어 여러 개(좁은 것 → 넓은 것) + 어떻게 만들었는지
async function imgQueries(q) {
  const raw = String(q == null ? '' : q).trim().slice(0, 300);
  const cleaned = cleanImgQuery(raw);
  // ① AI에게 '무엇의 사진인지' 영어 검색어를 뽑아 달라고 한다(가장 정확하다).
  if (raw) {
    try {
      const out = await withTimeout(aiQuickText('imgq', raw), IMG_QUERY_MS, 'imgq');
      const lines = String(out || '').split(/\n+/)
        .map((s) => String(s || '').replace(/^\s*(?:[-*·•>]|\d+[.)]]?)+\s*/, '').replace(/["'`]/g, '').trim())
        .filter((s) => s && s.length <= 80 && !/^\d+$/.test(s));
      if (lines.length) return { queries: lines.slice(0, 3), how: 'ai' };
    } catch (e) {
      console.error('[ai/imgq]', e && e.message);
    }
  }
  // ② 정제된 검색어가 한국어면 무료 번역으로 영어 검색어를 한 번 더 만든다.
  if (cleaned && looksKorean(cleaned)) {
    try {
      const [tr] = await withTimeout(translateFree(cleaned, 'en'), IMG_TRANSLATE_MS, 'translate');
      const en = String(tr || '').replace(/["'`]/g, '').replace(/\s+/g, ' ').trim();
      if (en && en.length <= 80 && !looksKorean(en)) return { queries: [en, cleaned], how: 'translate' };
    } catch (e) { /* 번역 실패 → 정제 검색어로 */ }
    return { queries: [cleaned], how: 'clean' };
  }
  return { queries: [cleaned || raw.slice(0, 120)], how: 'clean' };
}

// 검색어 후보를 넓혀 가며 '가장 잘 맞는' 사진 후보 목록을 만든다.
async function rankedSearch(q) {
  const { queries, how } = await imgQueries(q);
  const tried = [];
  let ranked = [];
  for (let i = 0; i < queries.length; i++) {
    const terms = imgTerms(queries[i]);
    const got = await searchImagesRanked(queries[i], terms);
    tried.push(`"${queries[i]}"[${got.tried}]`);
    const top = got.results[0];
    if (top && top.score >= IMG_MIN_SCORE) { ranked = got.results; break; }   // 충분히 맞는 사진
    if (!ranked.length || (top && top.score > ranked[0].score)) ranked = got.results;
  }
  return { queries, how, results: ranked, tried: tried.join(' ') };
}

// 후보를 실제로 내려받아 저장소에 넣는다(깨진 파일이면 다음 후보로).
async function storeFromRanked(q, ranked) {
  let lastErr = '';
  for (const c of ranked.slice(0, IMG_TRY_DOWNLOAD)) {
    try {
      const buf = await downloadImage(c.url);
      const stored = await storeImage(buf);
      return { data: { url: stored.url, public_id: stored.public_id, width: stored.width, height: stored.height,
        title: c.title, page: c.page, license: c.license, source: c.source, score: c.score } };
    } catch (e) {
      lastErr = String((e && e.message) || e);
      if (c.full && c.full !== c.url) {          // 썸네일이 깨졌으면 원본으로 한 번 더
        try {
          const buf = await downloadImage(c.full);
          const stored = await storeImage(buf);
          return { data: { url: stored.url, public_id: stored.public_id, width: stored.width, height: stored.height,
            title: c.title, page: c.page, license: c.license, source: c.source, score: c.score } };
        } catch (e2) { lastErr = String((e2 && e2.message) || e2); }
      }
    }
  }
  return { error: '사진을 받아오지 못했어요 · ' + (lastErr || '잠시 뒤 다시 시도해 주세요') };
}

async function findAndStore(q) {
  const got = await rankedSearch(q);
  if (!got.results.length) {
    return { error: '‘' + String(q).slice(0, 40) + '’ 사진을 찾지 못했어요 · 무엇의 사진인지 조금 더 구체적으로 알려 주세요',
      queries: got.queries, tried: got.tried };
  }
  // 점수가 낮으면 '아무 사진이나' 넣지 않는다 — 엉뚱한 사진이 더 나쁘다.
  if (got.results[0].score < IMG_MIN_SCORE) {
    return { error: '‘' + String(q).slice(0, 40) + '’ 와 잘 맞는 사진을 찾지 못했어요 · 조금 더 구체적으로 알려 주세요(예: ‘고양이’ 보다 ‘노란 고양이’)',
      queries: got.queries, tried: got.tried, low: true };
  }
  const done = await storeFromRanked(q, got.results);
  if (done.error) return Object.assign({}, done, { queries: got.queries, tried: got.tried });
  return { data: Object.assign({ q }, done.data, { queries: got.queries, how: got.how }) };
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
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SDYnotes/14.31)' },
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

  // 사진 후보 — 검색어를 영어로 다듬고, 두 소스를 찾아 관련도 순으로 돌려준다.
  app.get('/api/ai/imgs', async (req, reply) => {
    const q = qOf(req);
    if (q.length < 2) return replyErr(reply, 400, '찾을 사진을 적어 주세요');
    const rl = rateHit(rlKey(req, 'img'));
    if (!rl.ok) return replyErr(reply, 429, `잠시 뒤에 다시 시도해 주세요 · ${RATE_N}번/${Math.round(RATE_WINDOW / 1000)}초`);
    const ck = 'img:' + q.toLowerCase();
    const hit = cacheGet(ck);
    if (hit) return reply.send(Object.assign({ ok: true, cached: true }, hit));
    try {
      const got = await rankedSearch(q);
      const data = { q, queries: got.queries, how: got.how, results: got.results.slice(0, 8) };
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

    try {
      const got = await findAndStore(q);
      if (got.error) {
        // '관련 없는 사진'은 아예 넣지 않는다 — 못 찾았다는 말이 더 낫다.
        console.error('[ai/imgadd]', q, '→', got.error, '|', got.tried || '');
        return replyErr(reply, 404, got.error);
      }
      cachePut(ck, got.data);
      return reply.send(Object.assign({ ok: true, cached: false }, got.data));
    } catch (e) {
      console.error('[ai/imgadd]', e && e.message);
      return replyErr(reply, 502, '사진 검색에 닿지 못했어요 · 잠시 뒤 다시 시도해 주세요');
    }
  });
}
