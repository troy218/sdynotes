// 14.36.0 · 해돌이 참고 일러스트 — 찾기 · 고르기 · 펜 획으로 옮기기
// ---------------------------------------------------------------------------
//   왜 있나
//     모델이 좌표를 즉석에서 지어내는 SVG 그림은 '눈이 얼굴 밖에 있고 팔이 셋인'
//     수준을 벗어나기 어려웠다(플래시급 모델의 공간 감각 한계). 그래서 순서를
//     뒤집는다 — **잘 그려진 선화(참고 일러스트)를 먼저 찾고, 그 윤곽을 따라
//     그린다.** 사람이 그림을 배울 때 트레이싱을 하는 것과 같다. 윤곽이 원본
//     그대로라 퀄리티가 보장되고, 모델은 '무엇을 그릴지 고르는 일'만 한다.
//
//   재료
//     server/assets/haedol_refs.json.gz — scripts/build-haedol-refs.mjs 가 만든
//     OpenMoji 선화 1,500여 장(CC BY-SA 4.0) + CLDR 한국어 이름·키워드.
//     실행 시 인터넷이 필요 없다(배포 서버가 폐쇄망이어도 그린다).
//
//   흐름 (routes/aiTools.js 의 /api/ai/refs · /api/ai/refdraw 가 부른다)
//     ① 요청 문장 → 검색 낱말(한국어 조사 떼기·불용어 제거·영어 소문자)
//     ② 참고 그림 후보 점수 매기기(한국어 이름 정확 일치 > 키워드 > 영어 이름 > 태그)
//     ③ 후보가 여럿이면 모델(refpick, 서버 전용)에게 '어느 것이 요청에 가장 맞는지'
//        번호로 고르게 한다 — 모델이 좌표를 만드는 게 아니라 고르기만 하니 실수가 적다
//     ④ 고른 그림의 경로(M/L/C/Z 절대좌표)를 그대로 SVG 로 조립해 돌려준다.
//        브라우저(sdyAiDrawParse)가 그 SVG 를 펜 획으로 바꿔 종이에 그린다.
//        "고양이와 강아지"처럼 대상이 둘 이상이면 나란히 놓아 한 장으로 만든다.
//
//   순수 함수(refTerms · refScore · refSearch · refSvg …)는 네트워크·모델을 쓰지
//   않아 test/ai_refdraw_contract.mjs 가 그대로 검증한다.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.resolve(HERE, '..', '..', 'assets', 'haedol_refs.json.gz');
export const REF_CREDIT = 'OpenMoji · CC BY-SA 4.0';

// ── 번들 읽기 (게으르게 한 번만) ─────────────────────────────────────────────
let bundle = null;          // { v, source, license, count, items }
let index = null;           // 검색용으로 미리 소문자·낱말화한 목록
export function refsLoad(file = BUNDLE) {
  if (bundle) return bundle;
  try {
    bundle = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf-8'));
  } catch (e) {
    bundle = { v: 0, source: '', license: '', count: 0, items: [], error: String((e && e.message) || e) };
  }
  index = null;
  return bundle;
}
export function refsReady() { const b = refsLoad(); return !!(b && b.items && b.items.length); }
export function refsInfo() {
  const b = refsLoad();
  return { count: (b.items || []).length, source: b.source || '', license: b.license || '', error: b.error || '' };
}
// 테스트용 — 가짜 번들을 꽂는다 (null 이면 파일에서 다시 읽는다)
export function refsUse(fake) { bundle = fake || null; index = null; }

// ── ① 검색 낱말 ─────────────────────────────────────────────────────────────
//   "귀여운 고양이 한 마리 그려 줘" → ["고양이"]  ·  "birthday cake please" → ["birthday","cake"]
const KO_STOP = new Set([
  '그림', '그려', '그려줘', '그려주세요', '그려라', '그려봐', '그려줄래', '그려주라', '그리고', '그리기', '그린', '그릴', '그려서',
  '스케치', '일러스트', '낙서', '캐리커처', '펜', '선화', '아이콘', '이모지', '이모티콘', '모양', '캐릭터', '모습', '그림체',
  '하나', '한장', '한마리', '마리', '장', '좀', '제발', '빨리', '얼른', '다시', '또', '새로', '다른', '한', '두', '세', '네', '여러', '몇',
  '귀여운', '귀엽게', '예쁜', '예쁘게', '멋진', '멋지게', '간단한', '간단하게', '간단히', '단순한', '단순하게', '작은', '큰', '아주', '엄청', '진짜', '정말',
  '크게', '작게', '자세히', '꼼꼼하게', '대충', '느낌', '느낌으로', '스타일', '스타일로', '풍', '버전', '식으로', '처럼', '같이',
  '여기', '여기에', '아래', '아래에', '밑에', '위에', '옆에', '옆', '앞', '앞에', '뒤', '뒤에', '안', '안에', '밖', '속', '사이',
  '오른쪽', '오른쪽에', '왼쪽', '왼쪽에', '가운데', '가운데에', '중앙에', '페이지', '페이지에', '쪽', '노트', '노트에', '문서', '문서에',
  '이', '그', '저', '것', '거', '수', '있는', '없는', '같은', '해줘', '해주세요', '줘', '주세요', '주라', '달라', '부탁', '부탁해',
  '나', '내', '우리', '너', '너를', '자신', '자신을', '스스로', '해돌아', '해돌이가', '넣어', '넣어줘', '추가', '추가해', '만들어', '만들어줘', '보여줘',
  // 색은 그림의 주제가 아니라 펜 색이다 — refColorOf 가 따로 읽는다
  '검은', '검정', '검정색', '까만', '빨간', '빨강', '빨간색', '붉은', '파란', '파랑', '파란색', '푸른', '노란', '노랑', '노란색',
  '초록', '초록색', '녹색', '보라', '보라색', '분홍', '분홍색', '핑크', '주황', '주황색', '갈색', '회색', '흰', '하얀', '흰색', '색', '색으로', '색깔',
]);
const EN_STOP = new Set([
  'draw', 'drawing', 'sketch', 'doodle', 'illustration', 'illustrate', 'picture', 'image', 'icon', 'emoji', 'please', 'plz',
  'a', 'an', 'the', 'of', 'in', 'on', 'for', 'me', 'my', 'some', 'cute', 'simple', 'small', 'big', 'little', 'nice', 'pretty',
  'quick', 'fast', 'again', 'another', 'here', 'below', 'above', 'left', 'right', 'and', 'or', 'with', 'style', 'like', 'one', 'two',
  'black', 'red', 'blue', 'green', 'yellow', 'purple', 'pink', 'orange', 'brown', 'gray', 'grey', 'white', 'color', 'colour',
]);
// 자주 쓰는 다른 이름 → 번들에 있는 이름(낱말 여러 개면 공백으로)
const KO_ALIAS = {
  해달: '수달', 해돌이: '수달', 해돌: '수달', 냥이: '고양이', 고냥이: '고양이', 냐옹이: '고양이', 야옹이: '고양이', 고양: '고양이',
  강아지: '개 강아지', 멍멍이: '개 강아지', 댕댕이: '개 강아지', 멍멍: '개 강아지', 곰돌이: '곰', 토깽이: '토끼',
  달: '초승달', 달님: '초승달', 해님: '해', 별님: '별', 스마일: '웃는 얼굴', 웃는얼굴: '웃는 얼굴', 웃음: '웃는 얼굴',
  차: '자동차', 핸드폰: '휴대전화', 스마트폰: '휴대전화', 폰: '휴대전화', 케익: '케이크', 케잌: '케이크',
  커피: '커피 뜨거운 음료', 치킨: '닭다리', 햄버거: '햄버거', 피자: '피자', 라면: '라면', 국수: '라면',
  사람: '사람', 남자: '남자', 여자: '여자', 아기: '아기', 아이: '어린이', 친구: '사람', 선생님: '교사',
  나무: '낙엽수', 꽃: '꽃', 태양: '해', 별: '별', 구름: '구름', 비: '비구름', 눈: '눈송이', 무지개: '무지개',
  집: '집', 학교: '학교', 병원: '병원', 자동차: '자동차', 버스: '버스', 비행기: '비행기', 배: '배', 로켓: '로켓',
};
// 그림 대상이 하나도 안 남았을 때 — "해돌이 그려 줘"·"너 그려 줘" 는 해돌이(수달) 자신이다
const SELF_RE = /(해돌|수달|해달|너\s*자신|네\s*모습|니\s*모습|자화상|셀카|자기\s*소개)/;
const KO_COLORS = [
  [/(검은|검정|검정색|까만)/, '#1a1a1a'], [/(빨간|빨강|붉은|레드)/, '#e74c3c'], [/(주황|오렌지)/, '#e67e22'], [/(노란|노랑|옐로)/, '#f1c40f'],
  [/(초록|녹색|그린)/, '#2ecc71'], [/(파란|파랑|푸른|블루)/, '#3498db'], [/(보라|퍼플)/, '#9b59b6'],
  [/(분홍|핑크)/, '#e84393'], [/(갈색|브라운)/, '#795548'], [/(회색|그레이)/, '#7f8c8d'],
];
const EN_COLORS = [
  [/\bblack\b/, '#1a1a1a'], [/\bred\b/, '#e74c3c'], [/\borange\b/, '#e67e22'], [/\byellow\b/, '#f1c40f'], [/\bgreen\b/, '#2ecc71'],
  [/\bblue\b/, '#3498db'], [/\bpurple\b/, '#9b59b6'], [/\bpink\b/, '#e84393'], [/\bbrown\b/, '#795548'], [/\b(gray|grey)\b/, '#7f8c8d'],
];
export function refColorOf(q) {
  const s = String(q || '').toLowerCase();
  for (const [re, hex] of KO_COLORS) if (re.test(s)) return hex;
  for (const [re, hex] of EN_COLORS) if (re.test(s)) return hex;
  return '';
}

// 낱말 뒤 조사·어미 — 두 글자 어미는 줄기 2자 이상, 한 글자 조사는 줄기 3자 이상 남을 때만 뗀다
//   (노을·고양이·모기처럼 '이'로 끝나는 낱말을 잘못 자르지 않게). "개를"→"개" 같은
//   짧은 줄기는 점수를 매길 때 변형으로 한 번 더 시도한다(koVariants).
const KO_TAIL2 = /(에서|에게|부터|까지|처럼|보다|이나|이랑|하고|면서|지만|이라고|이라는|라는|인데|입니다|들의|에는|으로는|으로|이야|이다)$/;
const KO_TAIL1 = /(을|를|의|은|는|이|가|과|와|도|만|로|에|고|랑|들|야)$/;
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
function koVariants(t) {
  const out = [t];
  const m2 = KO_TAIL2.exec(t);
  if (m2 && t.length - m2[1].length >= 1) out.push(t.slice(0, t.length - m2[1].length));
  const m1 = KO_TAIL1.exec(t);
  if (m1 && t.length - m1[1].length >= 1) out.push(t.slice(0, t.length - m1[1].length));
  return out;
}
const isKo = (w) => /[가-힣]/.test(w);
// 접두사 — '/그림 고양이', '그림: 고양이', '/draw cat'
const PREFIX = /^\s*(?:\/(?:draw|그림)(?=\s|$)|그림\s*[:：])\s*/i;
const DRAW_SUFFIX = /(그려\s*(줘|주세요|라|봐|줄래|주라)?|그리기|그림)$/;

function cleanReq(q) {
  return String(q == null ? '' : q).replace(/\s+/g, ' ').trim().slice(0, 200).replace(PREFIX, '')
    .replace(/[“”"'`()[\]{}<>~!?.;:·…]/g, ' ');
}
function termsOf(s) {
  const out = [];
  const push = (w) => { if (w && out.indexOf(w) < 0 && out.length < 8) out.push(w); };
  for (const raw of String(s || '').split(/[\s,]+/)) {
    const w = String(raw || '').trim().toLowerCase();
    if (!w) continue;
    if (isKo(w)) {
      const stem = koStem(w).replace(DRAW_SUFFIX, '');
      if (!stem || KO_STOP.has(w) || KO_STOP.has(stem)) continue;
      if (KO_ALIAS[stem]) { for (const a of KO_ALIAS[stem].split(' ')) push(a); continue; }
      push(stem);
    } else {
      const ww = w.replace(/[^a-z0-9-]/g, '');
      if (!ww || ww.length < 2 || EN_STOP.has(ww)) continue;
      push(ww.length >= 5 ? ww.replace(/(es|s)$/, '') : ww);
    }
  }
  return out;
}
export function refTerms(q) {
  const s = cleanReq(q);
  const out = termsOf(s);
  if (!out.length && SELF_RE.test(s)) return ['수달'];
  return out;
}
// "고양이와 강아지", "cat and dog", "사과, 바나나" → 대상별 낱말 묶음(최대 3)
//   접속 조사(와/과/랑/이랑/하고)는 낱말에 붙어 있어 낱말 경계에서만 가른다.
const CONJ = /\s*(?:,|&|\+|그리고|및|\band\b)\s*|(?<=[가-힣])(?:와|과|이랑|랑|하고)\s+/g;
export function refSubjects(q) {
  const s = cleanReq(q);
  const parts = s.split(CONJ).map((p) => String(p || '').trim()).filter(Boolean);
  if (parts.length < 2) return [];
  const out = [];
  for (const p of parts) {
    const t = termsOf(p);
    if (t.length) out.push(t);
    if (out.length >= 3) break;
  }
  return out.length >= 2 ? out : [];
}

// ── ② 점수 ───────────────────────────────────────────────────────────────────
function buildIndex() {
  const b = refsLoad();
  index = (b.items || []).map((it, i) => ({
    i,
    ko: String(it.ko || '').toLowerCase(),
    koWords: String(it.ko || '').toLowerCase().split(/[\s:·,]+/).filter(Boolean),
    kw: (it.kw || []).map((w) => String(w).toLowerCase()),
    en: String(it.en || '').toLowerCase(),
    enWords: String(it.en || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
    tags: String(it.tags || '').toLowerCase().split(/\s*,\s*/).filter(Boolean),
    isFace: /\bface\b|얼굴/.test(String(it.en || '') + ' ' + String(it.ko || '')),
    paths: (it.p || []).length,
  }));
  return index;
}
const escRe = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function koTermScore(entry, t) {
  if (entry.ko === t) return 30;                                              // "고양이" == 고양이
  if (entry.koWords.indexOf(t) >= 0) return 18;                               // "고양이 얼굴" 안의 낱말
  if (entry.kw.indexOf(t) >= 0) return 12;                                    // 키워드 정확 일치
  if (t.length >= 2 && entry.ko && entry.ko.indexOf(t) >= 0) return 8 + Math.min(4, t.length);   // "생일" ⊂ "생일 케이크"
  if (entry.ko.length >= 2 && t.indexOf(entry.ko) >= 0) return 8;              // "벚꽃나무" ⊃ "벚꽃"
  if (t.length === 1 && entry.ko.indexOf(t) >= 0) return 9;                   // "소" ⊂ "젖소"
  if (entry.kw.some((k) => (t.length >= 2 && k.indexOf(t) >= 0) || (k.length >= 2 && t.indexOf(k) >= 0))) return 5;
  return 0;
}
function enTermScore(entry, t) {
  const re = new RegExp('(^|[^a-z0-9])' + escRe(t) + '(?:es|s)?(?![a-z0-9])');
  if (entry.en === t) return 30;
  if (entry.enWords.indexOf(t) >= 0 || re.test(entry.en)) return 16;
  if (entry.tags.some((k) => k === t)) return 10;
  if (entry.tags.some((k) => re.test(k))) return 6;
  return 0;
}
export function refScore(entry, terms) {
  const list = (terms || []).filter(Boolean);
  let score = 0; let matched = 0; let wantsFace = false;
  for (const t of list) {
    let s = 0;
    if (isKo(t)) {
      if (/얼굴|표정/.test(t)) wantsFace = true;
      for (const v of koVariants(t)) s = Math.max(s, koTermScore(entry, v));
    } else {
      if (/^(face|smile|smiley|expression)$/.test(t)) wantsFace = true;
      s = enTermScore(entry, t);
    }
    if (s) matched++;
    score += s;
  }
  if (!matched) return { score: -1, matched: 0 };
  // 모든 낱말이 걸리면 보너스, 하나라도 빠지면 조금 감점
  if (matched === list.length) score += 6; else score -= 4 * (list.length - matched);
  // '얼굴만'은 요청이 얼굴·표정일 때만 — "강아지 그려 줘"에는 몸 전체(개)가 먼저 온다
  if (entry.isFace && !wantsFace) score -= 8;
  // 이름에 요청에 없는 낱말이 많을수록('활짝 웃는 고양이 얼굴' vs '웃는 얼굴') 뒤로
  const extra = entry.koWords.filter((w) => !list.some((t) => koVariants(t).some((v) => w === v || (v.length >= 2 && w.indexOf(v) >= 0)))).length;
  score -= 2 * extra;
  score += Math.min(2, entry.paths / 8);             // 선이 조금 더 많은(디테일 있는) 쪽이 낫다
  return { score, matched };
}

function pickOf(b, s) {
  const it = b.items[s.i];
  return { h: it.h, e: it.e, en: it.en, ko: it.ko, g: it.g, s: it.s, kw: (it.kw || []).slice(0, 6),
    paths: (it.p || []).length, score: Math.round(s.score * 10) / 10, matched: s.matched };
}
function searchTerms(terms, limit) {
  const b = refsLoad();
  if (!terms.length || !b.items || !b.items.length) return [];
  const idx = index || buildIndex();
  const scored = [];
  for (const e of idx) {
    const s = refScore(e, terms);
    if (s.score <= 0) continue;
    scored.push({ i: e.i, score: s.score, matched: s.matched });
  }
  scored.sort((a, c) => (c.score - a.score) || (a.i - c.i));
  return scored.slice(0, Math.max(1, limit)).map((s) => pickOf(b, s));
}
// 후보 목록. 대상이 여럿("고양이와 강아지")이면 대상마다 상위 후보를 모으고
//   subjects 에 대상별 1위를 따로 담는다(모델 없이도 나란히 그릴 수 있게).
export const REF_MIN_SCORE = 10;
export function refSearch(q, limit = 6) {
  const subjects = Array.isArray(q) ? [] : refSubjects(q);
  const terms = Array.isArray(q) ? q.slice(0, 8) : refTerms(q);
  if (subjects.length) {
    const results = []; const tops = [];
    const per = Math.max(2, Math.ceil(limit / subjects.length));
    for (const st of subjects) {
      const got = searchTerms(st, per);
      if (got.length && got[0].score >= REF_MIN_SCORE && !tops.some((x) => x.h === got[0].h)) tops.push(got[0]);
      for (const r of got) if (!results.some((x) => x.h === r.h)) results.push(r);
    }
    return { terms, subjects, results, tops };
  }
  const results = searchTerms(terms, limit);
  return { terms, subjects: [], results, tops: results.length && results[0].score >= REF_MIN_SCORE ? [results[0]] : [] };
}
export function refByHex(h) {
  const b = refsLoad();
  const key = String(h || '').toUpperCase();
  return (b.items || []).find((it) => String(it.h).toUpperCase() === key) || null;
}

// ── ④ 참고 그림 → SVG (브라우저의 sdyAiDrawParse 가 그대로 읽는다) ───────────
//   OpenMoji 는 72×72, 선 굵기 2. 노트에서는 480×360 viewBox 에 맞춰 키운다
//   (기존 그림 엔진과 같은 크기 규약 → 적용기의 크기 계산이 그대로 통한다).
//   채움만 있는 도형(눈동자·콧구멍 같은 검은 점)은 윤곽을 그리고 안쪽을 짧은
//   빗금 획으로 채워 '검은 점'처럼 보이게 한다 — 펜에는 fill 이 없기 때문이다.
const VIEW_W = 480; const VIEW_H = 360; const REF_SIZE = 72; const PAD = 24;
const f1 = (n) => Math.round(n * 10) / 10;
function cubicPts(p0, a, n = 6) {
  const out = [];
  for (let k = 1; k <= n; k++) {
    const t = k / n; const it = 1 - t;
    out.push([it * it * it * p0[0] + 3 * it * it * t * a[0] + 3 * it * t * t * a[2] + t * t * t * a[4],
      it * it * it * p0[1] + 3 * it * it * t * a[1] + 3 * it * t * t * a[3] + t * t * t * a[5]]);
  }
  return out;
}
function scanX(poly, y) {
  const xs = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const [ax, ay] = poly[i]; const [bx, by] = poly[(i + 1) % n];
    if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + (y - ay) * (bx - ax) / (by - ay));
  }
  xs.sort((a, b) => a - b);
  return xs;
}
const escAttr = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// 색을 따로 말하지 않은 그림도 더는 검정 펜 하나로만 그리지 않는다. 참고 번들에는
// OpenMoji black 선화의 좌표만 있으므로 원본의 색을 복원할 수는 없다. 대신 이름·태그를
// 보고 대상에 어울리는 밝은 주색을 고르고, 눈·단추 같은 작은 디테일에는 짝색을 쓴다.
// 같은 대상은 언제나 같은 색이라 재요청할 때 그림 분위기가 갑자기 바뀌지 않는다.
const AUTO_PALETTES = {
  love:      { main: '#e84393', detail: '#9b59b6' },
  nature:    { main: '#2ecc71', detail: '#e67e22' },
  sky:       { main: '#3498db', detail: '#9b59b6' },
  warm:      { main: '#e67e22', detail: '#e84393' },
  animal:    { main: '#e67e22', detail: '#34495e' },
  person:    { main: '#9b59b6', detail: '#e84393' },
  transport: { main: '#3498db', detail: '#e67e22' },
  object:    { main: '#2f9e9e', detail: '#9b59b6' },
};
const AUTO_FALLBACK = [AUTO_PALETTES.object, AUTO_PALETTES.warm, AUTO_PALETTES.sky, AUTO_PALETTES.person, AUTO_PALETTES.nature];
export function refPaletteOf(item, offset = 0) {
  const s = [item && item.ko, item && item.en, item && item.tags, ...((item && item.kw) || [])].join(' ').toLowerCase();
  if (/하트|사랑|애정|로맨|꽃다발|\b(heart|love|kiss|rose)\b/.test(s)) return AUTO_PALETTES.love;
  if (/꽃|나무|잎|식물|숲|새싹|\b(flower|tree|leaf|plant|forest|herb|sunflower)\b/.test(s)) return AUTO_PALETTES.nature;
  // '동물' 속의 '물', birthday 속의 'day'처럼 우연히 든 글자에 색이 끌려가지
  // 않도록 짧은 한국어 단어는 피하고 영어 이름은 낱말 경계를 지킨다.
  if (/동물|애완|\b(animal|animals|pet|cat|dog|bird|fish|bear|rabbit|otter)\b/.test(s)) return AUTO_PALETTES.animal;
  if (/(?:^|[ ,])(?:해|별|불)(?:$|[ ,])|태양|케이크|음식|과일|디저트|\b(sun|star|fire|cake|food|fruit|dessert|sweet)\b/.test(s)) return AUTO_PALETTES.warm;
  if (/사람|남자|여자|어린이|아기|교사|\b(person|people|man|woman|child|baby|teacher)\b/.test(s)) return AUTO_PALETTES.person;
  if (/자동차|버스|기차|비행기|자전거|로켓|\b(car|bus|train|plane|bicycle|ship|rocket|vehicle)\b/.test(s)) return AUTO_PALETTES.transport;
  if (/하늘|구름|눈송이|바다|물결|물방울|초승달|\b(weather|cloud|rain|snow|ocean|water|moon)\b/.test(s)) return AUTO_PALETTES.sky;
  let hash = Number(offset) || 0;
  for (let i = 0; i < s.length; i++) hash = ((hash * 31) + s.charCodeAt(i)) >>> 0;
  return AUTO_FALLBACK[hash % AUTO_FALLBACK.length];
}

// 그림 하나를 (ox, oy) 자리에 k 배로 놓은 <path> 목록
function refPaths(item, palette, k, ox, oy, monochrome) {
  const tx = (x) => f1(x * k + ox); const ty = (y) => f1(y * k + oy);
  const out = [];
  for (const [w0, filled, d] of item.p || []) {
    const toks = String(d || '').match(/[MLCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
    let i = 0; const seg = []; const poly = []; let cur = [0, 0];
    const n = (cnt) => { const a = []; for (let j = 0; j < cnt; j++) a.push(parseFloat(toks[i++])); return a; };
    while (i < toks.length) {
      const c = toks[i++];
      if (c === 'M' || c === 'L') { const [x, y] = n(2); seg.push(c + ' ' + tx(x) + ' ' + ty(y)); cur = [x, y]; poly.push(cur); }
      else if (c === 'C') {
        const a = n(6);
        seg.push('C ' + tx(a[0]) + ' ' + ty(a[1]) + ' ' + tx(a[2]) + ' ' + ty(a[3]) + ' ' + tx(a[4]) + ' ' + ty(a[5]));
        for (const p of cubicPts(cur, a)) poly.push(p);
        cur = [a[4], a[5]];
      } else if (c === 'Z') seg.push('Z');
    }
    if (!seg.length) continue;
    // 선 굵기: 원본 2 → 노트 기준 3 (원본 굵기에 비례, 1.5~5 사이)
    const sw = Math.max(1.5, Math.min(5, (w0 || 1.2) * 1.5));
    let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
    for (const [x, y] of poly) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
    const bw = x2 - x1; const bh = y2 - y1;
    // 작은 디테일 부품(눈·단추·꽃술 등)만 짝색으로 잡아, 무지개처럼 산만하지
    // 않으면서도 실루엣과 디테일이 또렷하게 나뉘게 한다.
    const smallDetail = (item.p || []).length <= 12 && poly.length >= 3
      && Number.isFinite(bw) && Number.isFinite(bh) && bw <= 12 && bh <= 12 && bw * bh <= 120;
    const pathColor = monochrome ? palette.main : ((filled || smallDetail) ? palette.detail : palette.main);
    out.push(`<path d="${seg.join(' ')}" fill="none" stroke="${pathColor}" stroke-width="${f1(sw)}" stroke-linecap="round" stroke-linejoin="round"${filled ? ' data-fill="1"' : ''}/>`);
    if (filled && poly.length >= 3) {
      const hatchColor = monochrome ? palette.main : palette.detail;
      if (bw > 0.6 && bh > 0.6 && bw * bh <= 220) {               // 큰 면(배경 판 등)은 채우지 않는다
        const step = Math.max(0.55, Math.min(1.2, Math.min(bw, bh) / 3));
        const lines = [];
        for (let yy = y1 + step * 0.5; yy < y2; yy += step) {
          const xs = scanX(poly, yy);
          for (let j = 0; j + 1 < xs.length; j += 2) {
            if (xs[j + 1] - xs[j] < 0.25) continue;
            lines.push(`M ${tx(xs[j])} ${ty(yy)} L ${tx(xs[j + 1])} ${ty(yy)}`);
          }
        }
        if (lines.length) out.push(`<path d="${lines.join(' ')}" fill="none" stroke="${hatchColor}" stroke-width="${f1(Math.max(1.6, step * k * 0.95))}" stroke-linecap="round" stroke-linejoin="round" data-hatch="1"/>`);
      }
    }
  }
  return out;
}
export function refSvg(items, opt = {}) {
  const list = (Array.isArray(items) ? items : [items]).filter((it) => it && Array.isArray(it.p) && it.p.length).slice(0, 3);
  if (!list.length) return '';
  const requestedColor = /^#[0-9a-f]{6}$/i.test(String(opt.color || '')) ? String(opt.color).toLowerCase() : '';
  const n = list.length;
  const gap = n > 1 ? 16 : 0;
  const cellW = (VIEW_W - 2 * PAD - gap * (n - 1)) / n;
  const cellH = VIEW_H - 2 * PAD;
  const k = Math.min(cellW, cellH) / REF_SIZE;
  const drawW = REF_SIZE * k;
  const totalW = drawW * n + gap * (n - 1);
  const x0 = (VIEW_W - totalW) / 2; const oy = (VIEW_H - drawW) / 2;
  const paths = [];
  list.forEach((it, i) => {
    const auto = refPaletteOf(it, i);
    const palette = requestedColor ? { main: requestedColor, detail: requestedColor } : auto;
    for (const p of refPaths(it, palette, k, x0 + i * (drawW + gap), oy, !!requestedColor)) paths.push(p);
  });
  if (!paths.length) return '';
  const names = list.map((it) => it.ko || it.en).join(', ');
  return `<svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" xmlns="http://www.w3.org/2000/svg" data-ref="${escAttr(list.map((it) => it.h).join('+'))}" data-name="${escAttr(names)}" data-color-mode="${requestedColor ? 'requested' : 'auto'}">${paths.join('')}</svg>`;
}

// ── ③ 모델이 고를 후보 목록 문구 · 답 읽기 ──────────────────────────────────
export function refChoicesText(results) {
  return (results || []).map((r, i) => `${i + 1}. ${r.ko || r.en}${r.ko && r.en ? ` (${r.en})` : ''}${r.kw && r.kw.length ? ` — ${r.kw.slice(0, 4).join(', ')}` : ''}`).join('\n');
}
// "2" · "2번" · "2. 고양이" · "없음"/"0" → 1-based 번호 또는 0(없음)
export function refParsePick(text, n) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return 0;
  if (/^(없음|none|no)\b/i.test(s)) return 0;
  const m = /(\d{1,2})/.exec(s);
  if (!m) return 0;
  const k = Number(m[1]);
  return (k >= 1 && k <= n) ? k : 0;
}
