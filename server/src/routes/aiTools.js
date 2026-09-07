// 14.30.0 · 해돌이 인터넷 도구 — 웹 검색 + 사진 검색/저장 (키 없이 동작).
//
//  - GET  /api/ai/web?q=...    → 인터넷 검색 결과 (여러 무료 소스를 순서대로 시도)
//  - GET  /api/ai/imgs?q=...   → 사진 후보 목록 (위키미디어 커먼즈)
//  - POST /api/ai/imgadd       → {q} 사진을 찾아 이 서버 저장소에 받아 노트용
//                                주소(/api/img/…)로 돌려준다 (upload와 같은 파이프라인)
//  - GET  /api/ai/refs?q=...   → 14.36.0 · 참고 일러스트 후보 목록 (서버 번들, 인터넷 없음)
//  - POST /api/ai/refdraw      → 14.36.0 · {q} 요청에 맞는 참고 일러스트를 찾아(필요하면
//                                모델이 후보 중 하나를 고름) 펜 획용 SVG 로 돌려준다
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
import {
  refsReady, refsInfo, refSearch, refByHex, refSvg, refColorOf,
  refChoicesText, refParsePick, REF_MIN_SCORE, REF_CREDIT,
} from '../lib/haedolRefs.js';

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

// ── ③ 14.36.0 · 참고 일러스트 그리기 — "찾아서 윤곽을 따라 그린다" ─────────
//   모델이 좌표를 지어내던 예전 방식은 그림 수준이 들쭉날쭉했다. 이제는
//   ① 요청 문장에서 그림 대상 낱말을 뽑아 서버 번들(OpenMoji 선화 1,600여 장)
//      에서 후보를 찾고,
//   ② 후보가 둘 이상이고 1위가 압도적이지 않으면 모델(refpick)에게 번호로
//      고르게 하고(모델이 없거나 실패하면 1위),
//   ③ 그 선화를 480×360 SVG 로 조립해 돌려준다 — 브라우저가 펜 획으로 옮긴다.
//   대상이 여럿("고양이와 강아지")이면 대상별 1위를 나란히 한 장에 놓는다.
//   못 찾으면 ok:false·reason:'nomatch' 로 알리고, 브라우저는 예전처럼 모델이
//   직접 그리는 경로(task=draw)로 내려간다.
const REF_PICK_MS = 9000;          // 모델이 후보를 고르는 데 기다리는 상한
const REF_CLEAR_MARGIN = 12;       // 1위가 2위보다 이만큼 앞서면 모델에게 묻지 않는다

async function pickWithModel(q, results) {
  const list = results.slice(0, 6);
  if (list.length < 2) return { idx: 0, how: 'single' };
  if (list[0].score - list[1].score >= REF_CLEAR_MARGIN) return { idx: 0, how: 'clear' };
  try {
    const prompt = '그림 요청: ' + String(q).slice(0, 200) + '\n\n후보:\n' + refChoicesText(list) + '\n\n가장 잘 맞는 후보의 번호 하나만 답하라(없으면 0).';
    const out = await withTimeout(aiQuickText('refpick', prompt), REF_PICK_MS, 'refpick');
    const k = refParsePick(out, list.length);
    if (k === 0 && /^\s*0\b/.test(String(out || ''))) return { idx: -1, how: 'ai-none' };
    return { idx: k > 0 ? k - 1 : 0, how: k > 0 ? 'ai' : 'ai-fallback' };
  } catch (e) {
    return { idx: 0, how: (e && e.aiOff) ? 'ai-off' : 'ai-fail' };
  }
}

export async function refDraw(q) {
  if (!refsReady()) return { ok: false, reason: 'nobundle', error: '참고 그림 묶음을 읽지 못했어요 · ' + (refsInfo().error || 'server/assets/haedol_refs.json.gz') };
  const found = refSearch(q, 6);
  if (!found.terms.length) return { ok: false, reason: 'noterms', terms: [], error: '무엇을 그릴지 알아듣지 못했어요' };
  const color = refColorOf(q);
  // 대상이 여럿 — 대상마다 1위를 나란히(모델을 부르지 않는다: 대상별 1위는 대개 분명하다)
  if (found.subjects.length >= 2 && found.tops.length >= 2) {
    const items = found.tops.map((t) => refByHex(t.h)).filter(Boolean);
    const svg = refSvg(items, { color });
    if (svg) {
      return { ok: true, q, terms: found.terms, how: 'multi', color: color || '',
        picks: found.tops.map((t) => ({ h: t.h, e: t.e, ko: t.ko, en: t.en, score: t.score })),
        name: found.tops.map((t) => t.ko || t.en).join(', '), credit: REF_CREDIT, svg };
    }
  }
  const results = found.results;
  if (!results.length || results[0].score < REF_MIN_SCORE) {
    return { ok: false, reason: 'nomatch', terms: found.terms, error: '‘' + found.terms.join(' ') + '’ 참고 그림이 없어요',
      candidates: results.slice(0, 3).map((r) => ({ h: r.h, ko: r.ko, en: r.en, score: r.score })) };
  }
  const picked = await pickWithModel(q, results);
  if (picked.idx < 0) {
    return { ok: false, reason: 'nomatch', terms: found.terms, how: picked.how, error: '‘' + found.terms.join(' ') + '’ 에 딱 맞는 참고 그림이 없어요',
      candidates: results.slice(0, 3).map((r) => ({ h: r.h, ko: r.ko, en: r.en, score: r.score })) };
  }
  const top = results[picked.idx] || results[0];
  const item = refByHex(top.h);
  const svg = refSvg(item, { color });
  if (!svg) return { ok: false, reason: 'nomatch', terms: found.terms, error: '참고 그림을 옮기지 못했어요' };
  return { ok: true, q, terms: found.terms, how: picked.how, color: color || '',
    picks: [{ h: top.h, e: top.e, ko: top.ko, en: top.en, score: top.score }],
    name: top.ko || top.en, credit: REF_CREDIT, svg };}

// 14.33.1(업스트림)의 참고 사진 찾기 — 위 refDraw(번들 선화 따라 그리기)가 nomatch 로
//   끝나 브라우저가 모델 직접 그리기(task=draw)로 내려갔을 때, ai.js 의 runDrawJob 이
//   멀티모달 모델에게 보여 줄 참고 사진을 여기서 찾는다. 두 단계가 겹치지 않는다:
//   번들에 있는 대상은 모델을 부르지 않고, 없는 대상만 이 경로로 온다.
// ── ④ 해돌이 그림 참고 일러스트(모델 폴백용) ────────────────────────────────────────────
// 14.33.1 · \"그림을 그려 줘\"가 흐트러지는 건 텍스트 모델이 좌표를 머릿속으로
//   찍기 때문이다. 그러니 그리기 전에 '그릴 대상의 참고 일러스트'를 하나 찾아
//   멀티모달 모델(제미나이 등)에게 이미지로 보여 주고 \"이 윤곽을 따라 귀엽게
//   선화로 다시 그려\"라고 시킨다 — 사진(이미지 생성)이 아니라 형태가 잡힌
//   참고를 보고 그리는 방식이라 윤곽이 훨씬 안정된다.
//
//   참고 그림은 모델 입력(보기)에만 쓰고 어디에도 저장하지 않는다. 그러므로
//   사진처럼 노트에 저장되는 imgadd 와 달리 저장 라이선스 걱정이 없고,
//   외부 그림은 공개 소스(위키미디어 커먼즈·오픈버스)만 받아온다.
//   검색/내려받기가 실패하거나 대상을 못 찾으면 null → 부르는 쪽이
//   '참고 없이 그리기'(예전 그대로)로 자연 폴백한다.
const DRAW_REF_EDGE = 960;              // 참고로 보여 줄 최대 가로·세로 (모델 입력용 축소)
const DRAW_REF_MAX = 12 * 1024 * 1024;  // 그보다 큰 원본은 받지 않는다

// 원본 버퍼의 이미지 종류를 시그니처로 맞힌다 (data URL 라벨용).
function sniffMime(buf) {
  if (!buf || buf.length < 8) return '';
  const h = Array.prototype.slice.call(buf, 0, 12);
  const hex = h.map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.slice(0, 8) === 'ffd8ffe0' || hex.slice(0, 8) === 'ffd8ffdb' || hex.slice(0, 6) === 'ffd8ff') return 'image/jpeg';
  if (hex.slice(0, 8) === '89504e47') return 'image/png';
  if (hex.slice(0, 8) === '52494646' && hex.slice(16, 24) === '57454250') return 'image/webp';
  if (hex.slice(0, 6) === '474946') return 'image/gif';
  if (hex.slice(0, 2) === '42' && hex.slice(2, 4) === '4d') return 'image/bmp';
  return '';
}

// 요청 문장에서 '그릴 대상' 낱말을 뽑아 영어 검색어를 만든다.
//   imgQueries 는 그대로 쓸 수 있다 — 한국어를 (imgq AI → 무료 번역 → 정제)
//   순으로 영어 3단계로 만들어 준다. 사진 전용 stopword 처리라 '그려 줘' 류가
//   이미 빠진 상태로 '대상'만 남는다.
async function drawRefEnglish(raw) {
  let cleaned = cleanImgQuery(raw);
  try {
    const { queries } = await imgQueries(raw);
    const en = (queries || []).find((q) => q && /^[A-Za-z0-9 ,.'\-]{2,}$/.test(q) && !looksKorean(q));
    if (en) return en.trim();
  } catch (e) { /* AI·번역 실패 → 정제 검색어로 */ }
  // 한글 그대로면 영문 소스를 못 쓰므로 대략 영어로 돌려 본다(최선).
  if (cleaned && looksKorean(cleaned)) {
    try {
      const [tr] = await withTimeout(translateFree(cleaned, 'en'), IMG_TRANSLATE_MS, 'translate');
      const en = String(tr || '').replace(/["'`]/g, '').replace(/\s+/g, ' ').trim();
      if (en && !looksKorean(en)) cleaned = en;
    } catch (e) { /* 실패 → 정제값 */ }
  }
  return cleaned || '';
}

// 참고 일러스트 후보를 넓혀 가며 '그리기 참고로 쓸' 한 장을 찾는다.
//   대상 검색어에 illustration / drawing / line art 를 붙여 선화·그림 위주로
//   고른다(사진 그대로를 추적하면 잡음만 많아진다). 그래도 사진이면 모델이
//   형태만 참고하도록 아래 지침에서 다시 못 박는다.
async function drawRefFind(query, signal) {
  const cands = [`${query} illustration`, `${query} drawing`, `${query} coloring page`, `${query} line art`, query];
  let ranked = [];
  for (const cq of cands) {
    if (signal && signal.aborted) return null;
    const terms = imgTerms(cq);
    const got = await searchImagesRanked(cq, terms).catch(() => ({ results: [] }));
    const top = got.results && got.results[0];
    if (top && top.score >= IMG_MIN_SCORE) { ranked = got.results; break; }   // 잘 맞는 그림
    if (!ranked.length && top) ranked = got.results;                          // 최선의 후보 보관
  }
  const top = ranked[0];
  if (!top || Number(top.score || 0) < IMG_MIN_SCORE) return null;
  return top;
}

// 후보를 내려받아 멀티모달 입력용 data URL 로 만든다 (저장 안 함 · 실패 시 null).
async function drawRefDataUrl(cand, signal) {
  const urls = [cand.url];
  if (cand.full && cand.full !== cand.url) urls.push(cand.full);
  for (const u of urls) {
    try {
      const buf = await downloadImage(u);
      if (!buf || buf.length > DRAW_REF_MAX) continue;
      let out = buf; let mime = 'image/jpeg';
      try {
        // EXIF 회전 반영 + 모델 입력용으로 적당히 줄여 가벼운 JPEG 로 통일한다.
        out = await sharp(buf).rotate()
          .resize({ width: DRAW_REF_EDGE, height: DRAW_REF_EDGE, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 86 }).toBuffer();
        mime = 'image/jpeg';
      } catch (e) {
        // sharp 실패(깨진/특수 파일) 시 원본을 쓰되, data URL 라벨은 실제로 맞춘다.
        mime = sniffMime(buf) || 'image/jpeg';
      }
      return { dataUrl: `data:${mime};base64,` + out.toString('base64') };
    } catch (e) { /* 깨진 후보 → 다음 주소로 */ }
  }
  return null;
}

// 외부에서 부르는 참고 찾기 — 성공 시 { dataUrl, title, page, license, source },
// 아니면 null. 오류는 모두 삼킨다(그림이 실패하지 않게 부르는 쪽이 폴백).
export async function fetchDrawReference(raw, signal) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  const ck = 'ref:' + s.toLowerCase();
  const hit = cacheGet(ck);
  // cacheGet 은 저장된 데이터 자체를 돌려 준다({dataUrl,…} 또는 null).
  //   예전엔 여기서 hit.data 를 다시 읽어 undefined 가 나와, 캐시에 든 참고를
  //   못 쓰고 '예전 방식(참고 없이 그리기)'로 폴백했다 — 같은 요청의 두 번째
  //   그림부터 윤곽선 따기가 절대 안 되던 원인.
  if (hit) return hit;                            // TTL 안의 같은 요청은 재검색 안 함
  if (signal && signal.aborted) return null;
  let out = null;
  try {
    const query = await drawRefEnglish(s);
    if (query) {
      const cand = await drawRefFind(query, signal);
      if (cand) {
        const img = await drawRefDataUrl(cand, signal);
        if (img) {
          out = Object.assign({}, img, {
            query,
            title: cand.title, page: cand.page, license: cand.license, source: cand.source,
          });
        }
      }
    }
  } catch (e) {
    console.error('[ai/drawref]', e && e.message);
  }
  if (!out) console.error('[ai/drawref] 참고 일러스트를 못 찾아 예전 방식(참고 없이 그리기)으로 그립니다 ·', s);
  cachePut(ck, out);
  return out;
}

// ── ⑤ 라우트 ────────────────────────────────────────────────────────────────
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

  // 14.36.0 · 참고 일러스트 후보 — 어떤 그림이 있는지 본다(디버그·미리보기용, 모델 없음)
  app.get('/api/ai/refs', async (req, reply) => {
    const q = qOf(req);
    if (q.length < 1) return replyErr(reply, 400, '무엇을 그릴지 적어 주세요');
    if (!refsReady()) return replyErr(reply, 503, '참고 그림 묶음을 읽지 못했어요 · ' + (refsInfo().error || ''));
    const got = refSearch(q, 8);
    return reply.send({ ok: true, q, terms: got.terms, subjects: got.subjects, credit: REF_CREDIT,
      results: got.results.map((r) => ({ h: r.h, e: r.e, ko: r.ko, en: r.en, score: r.score, paths: r.paths })) });
  });

  // 14.36.0 · 참고 일러스트를 찾아 펜 획용 SVG 로 — 그림 요청의 1순위 경로
  app.post('/api/ai/refdraw', async (req, reply) => {
    const b = (req.body && typeof req.body === 'object') ? req.body : {};
    const q = String(b.q || b.query || '').trim().slice(0, 200);
    if (q.length < 1) return replyErr(reply, 400, '무엇을 그릴지 적어 주세요');
    const rl = rateHit(rlKey(req, 'refdraw'));
    if (!rl.ok) return replyErr(reply, 429, `잠시 뒤에 다시 시도해 주세요 · ${RATE_N}번/${Math.round(RATE_WINDOW / 1000)}초`);
    try {
      const got = await refDraw(q);
      if (!got.ok) {
        // 못 찾은 건 오류가 아니다 — 브라우저가 모델 직접 그리기로 내려간다.
        return reply.code(404).send(Object.assign({ ok: false }, got));
      }
      return reply.send(got);
    } catch (e) {
      console.error('[ai/refdraw]', e && e.message);
      return replyErr(reply, 502, '참고 그림을 찾지 못했어요 · 잠시 뒤 다시 시도해 주세요');
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
