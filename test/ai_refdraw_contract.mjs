/* 14.34.0 · 해돌이 참고 일러스트 그리기 계약 (네트워크 없음)
 * ---------------------------------------------------------------------------
 *   "해돌이 그림 수준이 너무 떨어진다" → 모델이 좌표를 지어내는 대신 잘 그려진
 *   선화(참고 일러스트)를 찾아 그 윤곽을 따라 그린다. 이 테스트는
 *     ① 번들(server/assets/haedol_refs.json.gz)이 있고 쓸 만한 크기인지
 *     ② 한국어·영어 요청 → 검색 낱말 → 맞는 참고 그림이 1위인지
 *     ③ 대상이 여럿("고양이와 강아지")이면 나란히 한 장으로 만드는지
 *     ④ SVG 가 브라우저 파서(sdyAiDrawParse)가 읽는 규약(480×360·M/L/C/Z·fill none)인지
 *     ⑤ /api/ai/refdraw · /api/ai/refs 라우트가 후보를 고르고(모델은 가짜) 못 찾으면
 *        404 nomatch 로 '모델 직접 그리기'에 길을 내주는지
 *   를 실제 번들로 검증한다. 모델 호출은 가짜 fetch 로 가로챈다. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.SDY_BASE_DIR = '/tmp/sdy-refdraw-test';
process.env.SDY_STORAGE = 'oracle';
process.env.AI_KEY = 'test-key';
process.env.AI_BASE_URL = 'https://ai.test/v1';
process.env.AI_MODEL = 'test-model';

let pass = 0;
const check = (name, cond, extra = '') => {
  assert.ok(cond, name + (extra ? ` → ${extra}` : ''));
  pass++;
  console.log('  ✓ ' + name);
};

const REPO = path.resolve(new URL('..', import.meta.url).pathname);

// ── 가짜 모델 — refpick 은 "2" 라고 답한다(후보 2번을 고르게) ──────────────
const aiCalls = [];
let pickAnswer = '2';
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('ai.test/v1/chat/completions')) {
    const body = JSON.parse(String((init && init.body) || '{}'));
    const sys = String(((body.messages || [])[0] || {}).content || '');
    const user = String(((body.messages || [])[1] || {}).content || '');
    aiCalls.push({ sys: sys.slice(0, 40), user });
    const content = /참고 일러스트를 고르는/.test(sys) ? pickAnswer : 'x';
    return { ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ choices: [{ finish_reason: 'stop', message: { content } }] }),
      text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }) };
  }
  throw new Error('예상치 못한 외부 호출: ' + u);
};

const R = await import('../server/src/lib/haedolRefs.js');
const tools = await import('../server/src/routes/aiTools.js');
const ai = await import('../server/src/routes/ai.js');

// ── ① 번들 ────────────────────────────────────────────────────────────────────
const bundlePath = path.join(REPO, 'server', 'assets', 'haedol_refs.json.gz');
check('참고 일러스트 번들이 저장소에 들어 있다', fs.existsSync(bundlePath));
check('번들이 배포에 부담 없는 크기다(2MB 이하)', fs.statSync(bundlePath).size < 2 * 1024 * 1024,
  String(fs.statSync(bundlePath).size));
const info = R.refsInfo();
check('번들을 읽으면 1,000장 넘는 선화가 있다', R.refsReady() && info.count >= 1000, JSON.stringify(info));
check('출처·라이선스가 번들에 적혀 있다(OpenMoji CC BY-SA)', /OpenMoji/.test(info.source) && /CC BY-SA/.test(info.license));
check('라이선스 안내 파일이 함께 있다', fs.existsSync(path.join(REPO, 'server', 'assets', 'haedol_refs.LICENSE.txt')));
check('빌드 스크립트가 있다(scripts/build-haedol-refs.mjs)', fs.existsSync(path.join(REPO, 'scripts', 'build-haedol-refs.mjs')));

// ── ② 검색 낱말 · 1위 ─────────────────────────────────────────────────────────
const t = R.refTerms;
check('"귀여운 고양이 한 마리 그려 줘" → 낱말 [고양이]', JSON.stringify(t('귀여운 고양이 한 마리 그려 줘')) === '["고양이"]',
  JSON.stringify(t('귀여운 고양이 한 마리 그려 줘')));
check('"/그림 집" 접두사를 뗀다', JSON.stringify(t('/그림 집')) === '["집"]', JSON.stringify(t('/그림 집')));
check('"draw a cute otter please" → [otter]', JSON.stringify(t('draw a cute otter please')) === '["otter"]',
  JSON.stringify(t('draw a cute otter please')));
check('색 낱말은 검색어가 아니라 펜 색이다("빨간 하트")', JSON.stringify(t('빨간 하트 그려줘')) === '["하트"]'
  && R.refColorOf('빨간 하트 그려줘') === '#e74c3c', JSON.stringify(t('빨간 하트 그려줘')));
check('"해돌이 그려 줘"는 해돌이 자신(수달)이다', JSON.stringify(t('해돌이 그려 줘')) === '["수달"]', JSON.stringify(t('해돌이 그려 줘')));

const top = (q) => { const r = R.refSearch(q); return r.results[0] ? (r.results[0].ko || r.results[0].en) : ''; };
const cases = [
  ['귀여운 고양이 그려 줘', '고양이'], ['강아지 한 마리 그려줘', '개'], ['생일 케이크 그려 줘', '생일 케이크'],
  ['해달 그려줘', '수달'], ['웃는 얼굴 그려줘', '웃는 얼굴'], ['자전거 그려줘', '자전거'], ['요리사 그려 줘', '요리사'],
  ['집 그려줘', '집'], ['draw a cute otter', '수달'], ['벚꽃 그려줘', '벚꽃'], ['우주비행사 그려줘', '우주비행사'],
  ['해바라기 그려줘', '해바라기'], ['토끼 그려줘', '토끼'], ['눈사람 그려줘', '눈사람'], ['기차 그려줘', '기차'],
  ['축구공 그려줘', '축구공'], ['선생님 그려줘', '교사'], ['고양이 얼굴 그려줘', '고양이 얼굴'], ['달 그려줘', '초승달'],
];
for (const [q, want] of cases) {
  const got = top(q);
  check(`1위: "${q}" → ${want}`, got === want, got);
}
check('"강아지"에는 얼굴만 있는 그림보다 몸 전체(개)가 먼저 온다', top('강아지 그려줘') === '개'
  && (R.refSearch('강아지 그려줘').results.findIndex((r) => r.ko === '강아지 얼굴') > 0));
check('아무것도 안 맞으면 후보가 없다', R.refSearch('zzqq 존재하지 않음').results.length === 0);

// ── ③ 대상이 여럿 ─────────────────────────────────────────────────────────────
const multi = R.refSearch('고양이와 강아지 그려 줘');
check('"고양이와 강아지" → 대상 둘로 가른다', multi.subjects.length === 2, JSON.stringify(multi.subjects));
check('대상별 1위가 고양이·개 둘이다', multi.tops.map((x) => x.ko).join(',') === '고양이,개', JSON.stringify(multi.tops.map((x) => x.ko)));
const three = R.refSearch('사과, 바나나, 포도 그려줘');
check('쉼표로 이어도 대상을 가른다(최대 3)', three.subjects.length === 3 && three.tops.length === 3, JSON.stringify(three.tops.map((x) => x.ko)));
check('영어 "cat and dog"도 둘로 가른다', R.refSearch('cat and dog').tops.length === 2);

// ── ④ SVG 규약 ────────────────────────────────────────────────────────────────
const cat = R.refByHex('1F408');
const svg = R.refSvg(cat);
check('참고 그림 → SVG(480×360 viewBox)', /^<svg viewBox="0 0 480 360"/.test(svg));
check('모든 path 가 fill="none" 윤곽선이다(펜 획 규약)', (svg.match(/<path/g) || []).length >= 4
  && (svg.match(/fill="none"/g) || []).length === (svg.match(/<path/g) || []).length);
const dAttrs = [...svg.matchAll(/\sd="([^"]*)"/g)].map((m) => m[1]);
check('경로는 절대좌표 M/L/C/Z 만 쓴다', dAttrs.length > 0 && dAttrs.every((d) => /^[MLCZ0-9.\s-]+$/.test(d) && /^M /.test(d)),
  dAttrs.find((d) => !/^[MLCZ0-9.\s-]+$/.test(d)) || '');
const nums = (dAttrs.join(' ').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
check('좌표가 여유 24px 안쪽에 들어간다', nums.length > 0 && nums.every((n) => n >= 24 && n <= 456), `${Math.min(...nums)}~${Math.max(...nums)}`);
const otter = R.refSvg(R.refByHex('1F9A6'));
check('채움 도형(눈동자)은 윤곽 + 빗금 획으로 옮긴다', /data-fill="1"/.test(otter) && /data-hatch="1"/.test(otter));
const multiSvg = R.refSvg([R.refByHex('1F408'), R.refByHex('1F415')]);
check('두 그림을 한 장에 나란히 놓는다', /data-ref="1F408\+1F415"/.test(multiSvg)
  && (multiSvg.match(/<path/g) || []).length > (svg.match(/<path/g) || []).length);
check('색을 주면 그 색으로 그린다', /stroke="#e74c3c"/.test(R.refSvg(cat, { color: '#e74c3c' })));
check('모델이 고른 번호를 읽는다("2번"→2, "없음"→0, "9"(범위 밖)→0)',
  R.refParsePick('2번', 5) === 2 && R.refParsePick('없음', 5) === 0 && R.refParsePick('9', 5) === 0 && R.refParsePick('3. 고양이', 5) === 3);

// ── ⑤ 라우트 · refpick 모델 ──────────────────────────────────────────────────
check('refpick 은 서버 전용 task 다(밖에서 못 부른다)', ai.AI_TASKS.refpick && ai.AI_TASKS.refpick.internal === true);
check('draw task 는 여전히 대체 경로로 남아 있다', ai.AI_TASKS.draw && !ai.AI_TASKS.draw.internal);
const routes = {};
tools.registerAiTools({ get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; } });
const call = async (method, route, req) => {
  let out = null;
  const reply = { status: 200, code(s) { this.status = s; return this; }, send(b) { out = { status: this.status, body: b }; return out; } };
  await routes[method + ' ' + route](req, reply);
  return out;
};
const req = (body, query) => ({ body: body || {}, query: query || {}, ip: '127.0.0.1', headers: {} });

let r = await call('GET', '/api/ai/refs', req(null, { q: '고양이 그려 줘' }));
check('GET /api/ai/refs 가 후보 목록을 준다', r.status === 200 && r.body.ok && r.body.results[0].ko === '고양이', JSON.stringify(r.body).slice(0, 120));

aiCalls.length = 0;
r = await call('POST', '/api/ai/refdraw', req({ q: '귀여운 고양이 그려 줘' }));
check('POST /api/ai/refdraw → 고양이 선화 SVG', r.status === 200 && r.body.ok && r.body.name === '고양이' && /<svg /.test(r.body.svg), JSON.stringify(r.body).slice(0, 100));
check('1위가 압도적이면 모델에게 묻지 않는다(how=clear)', r.body.how === 'clear' && aiCalls.length === 0, r.body.how);
check('출처(OpenMoji · CC BY-SA)를 함께 돌려준다', /OpenMoji/.test(String(r.body.credit)));

aiCalls.length = 0; pickAnswer = '2';
r = await call('POST', '/api/ai/refdraw', req({ q: '책 그려 줘' }));
const bookList = R.refSearch('책 그려 줘').results;
check('후보가 비슷비슷하면 모델(refpick)에게 번호로 고르게 한다', r.status === 200 && r.body.how === 'ai' && aiCalls.length === 1
  && r.body.picks[0].h === bookList[1].h, `${r.body.how} · ${aiCalls.length} · ${r.body.name}`);
check('모델에게는 번호 목록만 보여 준다(좌표를 만들게 하지 않는다)', /후보:\n1\. /.test(aiCalls[0].user) && !/<svg|path/.test(aiCalls[0].user));

pickAnswer = '0';                          // (같은 요청은 모델 답이 캐시되므로 다른 요청으로)
r = await call('POST', '/api/ai/refdraw', req({ q: '꽃 그려 줘' }));
check('모델이 "0(없음)"이라 하면 404 nomatch 로 모델 직접 그리기에 길을 낸다', r.status === 404 && r.body.reason === 'nomatch', JSON.stringify(r.body).slice(0, 100));

pickAnswer = '2';
r = await call('POST', '/api/ai/refdraw', req({ q: '고양이와 강아지 그려 줘' }));
check('"고양이와 강아지" → 두 그림을 한 장에(how=multi)', r.status === 200 && r.body.how === 'multi' && r.body.picks.length === 2
  && r.body.name === '고양이, 개', JSON.stringify(r.body.picks));

r = await call('POST', '/api/ai/refdraw', req({ q: '빨간 하트 그려줘' }));
check('"빨간 하트"는 빨간 펜으로', r.status === 200 && r.body.color === '#e74c3c' && /stroke="#e74c3c"/.test(r.body.svg));

r = await call('POST', '/api/ai/refdraw', req({ q: 'zzqq 존재하지 않는 것 그려줘' }));
check('참고 그림이 없으면 404 nomatch(오류가 아니라 대체 경로 신호)', r.status === 404 && r.body.ok === false && r.body.reason === 'nomatch');

r = await call('POST', '/api/ai/refdraw', req({ q: '' }));
check('빈 요청은 400', r.status === 400);

console.log(`\n  ${pass}개 통과 · 해돌이 참고 일러스트 그리기 계약`);
