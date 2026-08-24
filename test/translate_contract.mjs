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

// ── 7) ja 대상 정규화 ( ALLOWED 목록 ) ──
calls = [];
extFetch = () => json200([[['こんにちは', 'hello', null, null]], null, 'en']);
r = await post('/api/translate', { text: 'hello there friend', target: 'ja' });
ok('ja 대상 그대로 전달', r.ok === true && calls[0] && /tl=ja/.test(calls[0].url));

await app.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
