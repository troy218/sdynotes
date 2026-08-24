// /api/translate 계약 테스트 — 실제 Google/LibreTranslate 대신 fetch 를
// 가짜로 갈아끼워 엔진 순회·POST 본문·청크·429 안내를 검증한다.
import assert from 'node:assert/strict';

let calls = [];           // 외부 엔진 호출 기록
let extFetch = null;      // url -> Response (테스트 단계마다 교체)

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(u, opts);  // 테스트 서버는 진짜로
  calls.push({ url: u, method: opts.method || 'GET', body: opts.body || null, ua: (opts.headers && (opts.headers['User-Agent'] || opts.headers['user-agent'])) || '' });
  const r = extFetch ? extFetch(u, opts) : new Response('no plan', { status: 404 });
  return r;
};
const json200 = (j) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });
const seg = (arrs) => [arrs.map(([t]) => [t, 'x', null, null]), null, 'en'];

process.env.LIBRETRANSLATE_URL = '';
process.env.TRANSLATE_ENGINE = 'auto';
process.env.TRANSLATE_HOST_COOLDOWN_MS = '150';   // 테스트에서는 쿨다운을 짧게
const { registerTranslate } = await import('../server/src/routes/translate.js');
const { default: Fastify } = await import('fastify');

const app = Fastify({ logger: false });
registerTranslate(app);
await app.listen({ port: 5197, host: '127.0.0.1' });
const BASE = 'http://127.0.0.1:5197';
const post = (p, body) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json().then((j) => ({ status: r.status, ...j })));

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };

// ── 1) 정상 번역: POST 본문 + UA 헤더로 요청 ──
calls = [];
extFetch = (u) => {
  if (u.startsWith('https://translate.googleapis.com')) {
    // Google 응답 형태: [[["번역","원문",null,null],...], ..., "원문언어"]
    return json200([[['안녕 세계', 'hello world', null, null]], null, 'en']);
  }
  return new Response('nf', { status: 404 });
};
let r = await post('/api/translate', { text: 'hello world', target: 'ko' });
ok('기본 번역 성공', r.ok === true && r.text === '안녕 세계' && r.engine === 'google');
const c0 = calls[0];
ok('POST 본문으로 전송 (URL 길이 한도 회피)', c0.method === 'POST' && /^q=/.test(c0.body || ''));
ok('User-Agent 헤더 포함', /Mozilla/.test(c0.ua || ''));
ok('gtx 엔드포인트 사용', /\/translate_a\/single\?client=gtx/.test(c0.url));

// ── 2) 1차 호스트 429 → 다른 호스트로 즉시 재시도 ──
calls = [];
extFetch = (u) => {
  if (u.startsWith('https://translate.googleapis.com')) return new Response('too many requests', { status: 429 });
  if (u.startsWith('https://clients5.google.com')) return json200([[['GOOD', 'q', null, null]], null, 'en']);
  return new Response('nf', { status: 404 });
};
r = await post('/api/translate', { text: 'second try', target: 'ko' });
ok('429 시 다른 호스트로 재시도', r.ok === true && r.text === 'GOOD');
ok('호스트 순회 순서 (googleapis → clients5)', /translate\.googleapis/.test(calls[0].url) && /clients5\.google/.test(calls[1].url));
// 쿨다운 확인: 다른 텍스트 → googleapis 는 건너뛰고 clients5 로
calls = [];
r = await post('/api/translate', { text: 'third try', target: 'ko' });
ok('429 받은 호스트는 쿨다운 동안 건너뜀', calls.length === 1 && /clients5/.test(calls[0].url));

// ── 3) 전 면결 실패 → 502 + 이유 전달 ──
calls = [];
extFetch = () => new Response('down', { status: 500 });
r = await post('/api/translate', { text: 'will fail', target: 'ko' });
ok('전체 실패 시 502', r.status === 502 && r.ok === false);
ok('실패 이유가 클라이언트까지 전달됨 (일반 안내)', /번역 서버에 닿지 않아요/.test(r.error || ''));

// 429 전용 안내 문구 — 쿨다운 초기화를 위해 3호스트 모두 429
await new Promise((r2) => setTimeout(r2, 200));   // 앞 단계 쿨다운 만료 대기
extFetch = () => new Response('rl', { status: 429 });
r = await post('/api/translate', { text: 'rate limited text now', target: 'ko' });
ok('429 일 때 전용 안내 문구', /제한/.test(r.error || ''));

// ── 7) 429 쿨다운 중 재요청 → '제한' 안내 유지 (회귀: 예전엔 '닿지 않아요'로 떴다) ──
// 직전 단계에서 3개 호스트가 모두 429 쿨다운(150ms)이다. 곧바로 다시 요청한다.
extFetch = () => json200([[['SHOULD-NOT-CALL', 'q', null, null]], null, 'en']);
calls = [];
r = await post('/api/translate', { text: 'retry during full cooldown', target: 'ko' });
ok('쿨다운 중에는 외부 엔진을 다시 부르지 않음', calls.length === 0);
ok('쿨다운 중 재요청도 제한 안내를 유지', r.status === 502 && /제한/.test(r.error || ''));
ok('제한 안내에 재시도 시각(retry_after) 힌트가 실린다', Number.isFinite(r.retry_after) && r.retry_after >= 1);
await new Promise((r2) => setTimeout(r2, 200));   // 쿨다운 만료 대기
await new Promise((r2) => setTimeout(r2, 200));   // 429 쿨다운 만료 대기

// ── 4) 긴 문장 청크: 조각을 이어붙이면 원본과 동일 (구분 보존) ──
const chunksSeen = [];
extFetch = (u, opts) => {
  const q = decodeURIComponent(String(opts.body || '').replace(/^q=/, ''));
  chunksSeen.push(q);
  return json200([[[q, 'x', null, null]], null, 'en']);  // 조각을 그대로 돌려준다
};
const long = ('This is a numbered sentence for chunk testing. '.repeat(60)) + '마지막 한국어 문장입니다.';
r = await post('/api/translate', { text: long, target: 'ko' });
ok('긴 글 청크 후 원문 그대로 복원', r.ok === true && r.text === long);
ok('1400자 이하 조각으로 나눠 전송', chunksSeen.length > 1 && chunksSeen.every((c) => c.length <= 1400));

// ── 5) 한국어→ko 요청은 그대로 반환 (불필요한 왕복 없음) ──
calls = [];
r = await post('/api/translate', { text: '이미 한국어 텍스트입니다', target: 'ko' });
ok('한국어→ko 는 unchanged', r.ok === true && r.unchanged === true && calls.length === 0);

// 목적 언어가 영어/일본어/중국어인 경우도 이미 같은 언어라면 외부 호출을 하지 않는다.
calls = [];
r = await post('/api/translate', { text: 'already English', target: 'en' });
ok('영어→en 도 unchanged', r.ok === true && r.unchanged === true && r.text === 'already English' && calls.length === 0);

// ── 6) 용어 사전 마스킹 유지 ──
extFetch = (u, opts) => {
  const q = decodeURIComponent(String(opts.body || '').replace(/^q=/, ''));   // 마스크된 입력을 그대로 돌려줌
  return json200([[[q, 'x', null, null]], null, 'en']);
};
r = await post('/api/translate', { text: 'the CRISPR system works', target: 'ko', gloss: { CRISPR: '크리스퍼' } });
ok('용어 마스킹 복원', r.ok === true && r.text === 'the 크리스퍼 system works');
ok('마스크된 입력은 용어가 치환된 채 전송됨', calls.at(-1).body && decodeURIComponent(calls.at(-1).body) === 'q=the [[0]] system works');

// 편집기에 있던 앞뒤 줄바꿈/공백은 번역 후 저장할 텍스트에도 보존돼야 한다.
calls = [];
extFetch = (u, opts) => {
  const q = decodeURIComponent(String(opts.body || '').replace(/^q=/, ''));
  return json200([[[`번역:${q}`, q, null, null]], null, 'en']);
};
r = await post('/api/translate', { text: '\n  preserve me  \n', target: 'ko' });
ok('번역 전후 공백 보존', r.ok === true && r.text === '\n  번역:preserve me  \n');


// ── 7.5) 타임아웃한 호스트는 쿨다운으로 건너뛴다 (TimeoutError 회귀) ──
// Node fetch 는 AbortSignal.timeout 을 AbortError 가 아니라 TimeoutError 로 던진다.
// 예전엔 이걸 몰라 죽은 호스트를 매 요청 다시 기다렸다 (15~30초 스톨).
{
  const timeoutErr = () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; return e; };
  extFetch = (u) => {
    if (u.startsWith('https://translate.googleapis.com')) throw timeoutErr();
    if (u.startsWith('https://clients5.google.com')) return json200([[['VIA-B', 'q', null, null]], null, 'en']);
    throw timeoutErr();
  };
  calls = [];
  r = await post('/api/translate', { text: 'timeout walks to next host', target: 'ko' });
  ok('한 호스트 타임아웃이면 다음 호스트로 넘어가 성공', r.ok === true && r.text === 'VIA-B');
  calls = [];
  r = await post('/api/translate', { text: 'second request skips dead host', target: 'ko' });
  ok('타임아웃 호스트는 쿨다운 → 다음 요청에서 건드리지 않음', calls.length === 1 && /clients5/.test(calls[0].url));
  ok('걸러진 요청도 정상 응답', r.ok === true && r.text === 'VIA-B');
  await new Promise((r2) => setTimeout(r2, 200));
}

// ── 7.6) 연결 자체가 실패하는 호스트(fetch failed)도 쿨다운 ──
{
  const failErr = () => new TypeError('fetch failed');
  extFetch = (u) => {
    if (u.startsWith('https://translate.googleapis.com')) throw failErr();
    if (u.startsWith('https://clients5.google.com')) return json200([[['VIA-B2', 'q', null, null]], null, 'en']);
    throw failErr();
  };
  calls = [];
  r = await post('/api/translate', { text: 'fetch failed cools the host', target: 'ko' });
  ok('연결 실패 호스트를 걷고 다음 호스트에서 성공', r.ok === true && r.text === 'VIA-B2');
  calls = [];
  r = await post('/api/translate', { text: 'next request skips unreachable host', target: 'ko' });
  ok('연결 실패 호스트도 쿨다운으로 건드리지 않음', calls.length === 1 && /clients5/.test(calls[0].url));
  await new Promise((r2) => setTimeout(r2, 200));
}

// ── 8) 용어 사전: 엔진이 죽으면 용어별 재시도를 바로 멈춘다 (429 폭주 방지) ──
{
  extFetch = () => { throw new TypeError('fetch failed'); };   // 엔진 전면 다운
  calls = [];
  r = await post('/api/translate/gloss', { terms: ['AlphaOne', 'BetaTwo', 'GammaThree', 'DeltaFour'], target: 'ko' });
  const extCalls = calls.length;
  ok('용어 번역은 실패해도 원문을 그대로 돌려준다', r.ok === true && r.gloss && r.gloss.AlphaOne === 'AlphaOne' && r.gloss.DeltaFour === 'DeltaFour');
  // 묶음 1회(엔진 순회)만 하고 용어별 재시도는 하지 않는다. 옛 구현은 15회 이상.
  ok('엔진 다운 시 용어별 재시도로 폭주하지 않음', extCalls > 0 && extCalls <= 12);
  await new Promise((r2) => setTimeout(r2, 200));
}

// ── 9) ja 대상 정규화 ( ALLOWED 목록 ) ──
calls = [];
extFetch = () => json200([[['こんにちは', 'hello', null, null]], null, 'en']);
r = await post('/api/translate', { text: 'hello there friend', target: 'ja' });
ok('ja 대상 그대로 전달', r.ok === true && calls[0] && /tl=ja/.test(calls[0].url));

// ── 10) gtx 가 전부 429여도 다른 Google 갈래가 되면 성공 ──
await new Promise((r2) => setTimeout(r2, 200));
{
  extFetch = (u) => {
    if (/client=gtx/.test(u) || /translate_a\/single\?client=gtx/.test(u)) return new Response('rl', { status: 429 });
    if (/client=at/.test(u)) return json200({ sentences: [{ trans: '대체 성공' }] });
    return new Response('nf', { status: 404 });
  };
  calls = [];
  r = await post('/api/translate', { text: 'fallback engine please', target: 'ko' });
  ok('gtx 429 이후 client=at 으로 성공', r.ok === true && r.text === '대체 성공');
  ok('실패한 gtx 다음 갈래를 실제로 호출했다', calls.some((c) => /client=at/.test(c.url)));
}

// ── 11) dj=1 · /t 배열 응답도 같은 파서로 읽는다 ──
await new Promise((r2) => setTimeout(r2, 220));
{
  extFetch = (u) => {
    if (/translate\.google|clients5\.google/.test(u)) return json200({ sentences: [{ trans: '문장형' }] });
    return new Response('nf', { status: 404 });
  };
  r = await post('/api/translate', { text: 'dj one format please', target: 'ko' });
  ok('dj=1 sentences 형식 파싱', r.ok === true && r.text === '문장형');
}

await app.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
