// 14.20.0 · /api/ai 계약 테스트 — 실제 모델 API 대신 fetch 를 가짜로 갈아끼워
// 요청 모양(키가 헤더에만 있는지)·캐시·in-flight 합치기·길이 제한·429 쿨다운을 검증한다.
//
// 이 파일이 지키려는 계약
//   1) 모델 키는 Authorization 헤더로만 나가고 응답·본문에는 절대 새지 않는다
//   2) task 화이트리스트(outline/chat, 14.23.0) 밖의 일은 400 으로 거절한다 (임의 프롬프트 주입 차단)
//   3) 같은 입력 재요청은 외부 호출 없이 캐시로 답한다 / 동시에 온 중복은 하나로 합친다
//   4) 본문은 상한만큼만 잘라 보낸다 (truncated=true 로 클라이언트에 알린다)
//   5) 429 를 맞으면 잠깐 쿨다운 — 그 사이엔 외부 API 를 아예 부르지 않는다
import assert from 'node:assert/strict';

let calls = [];        // 모델 API 호출 기록
let extFetch = null;   // (url, opts) -> Response

const realFetch = globalThis.fetch;
const FAKE_KEY = 'sk-test-do-not-leak-0001';
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(u, opts);   // 테스트 서버는 진짜로
  calls.push({
    url: u,
    method: opts.method || 'GET',
    auth: (opts.headers && opts.headers.Authorization) || '',
    body: opts.body ? JSON.parse(opts.body) : null,
    raw: String(opts.body || ''),
  });
  return extFetch ? extFetch(u, opts) : new Response('no plan', { status: 404 });
};
const json200 = (j) => new Response(JSON.stringify(j), {
  status: 200, headers: { 'content-type': 'application/json' },
});
const chatOk = (txt) => json200({ choices: [{ message: { role: 'assistant', content: txt } }] });

process.env.AI_KEY = FAKE_KEY;
process.env.AI_BASE_URL = 'https://ai.example.test/v1/';      // 끝 슬래시 → 붙일 때 정리되는지 확인
process.env.AI_MODEL = 'test-model-x';
process.env.AI_MAX_TEXT = '500';   // config 가 최소 500 으로 올림(clamp)한다 — 그 값으로 검증
process.env.AI_MAX_TOKENS = '321';
process.env.AI_CACHE_TTL_MS = '60000';
process.env.AI_RATE_N = '200';   // 이 파일에선 레이트리밋을 사실상 끈다 (전용 파일에서 따로 검증)
process.env.AI_WARM_N = '1';    // 14.22.0 · '미리 준비' 전용 한도는 1 로 — 13) 에서 검증
process.env.AI_RATE_WINDOW_MS = '60000';
process.env.AI_COOLDOWN_MS = '300';

const ai = await import('../server/src/routes/ai.js');
const { default: Fastify } = await import('fastify');

const app = Fastify({ logger: false });
ai.registerAi(app);
await app.listen({ port: 5198, host: '127.0.0.1' });
const BASE = 'http://127.0.0.1:5198';
const post = (p, body) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json().then((j) => ({ status: r.status, ...j })));
const get = (p) => fetch(BASE + p).then((r) => r.text().then((t) => ({ status: r.status, body: t })));

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };

// ── 1) 상태: 켜짐·모델·할 일 목록은 알려 주되 키는 절대 내보내지 않는다 ──
let g = await get('/api/ai/status');
let j = JSON.parse(g.body);
ok('status: enabled=true', g.status === 200 && j.enabled === true);
ok('status: 모델명을 알려 준다', j.model === 'test-model-x');
ok('status: 할 일 2종(outline/chat)', Array.isArray(j.tasks) && j.tasks.length === 2
  && j.tasks.map((t) => t.id).join(',') === 'outline,chat');
ok('status: 키가 응답에 새지 않는다', !g.body.includes(FAKE_KEY) && !g.body.includes(FAKE_KEY.slice(3)));

// ── 2) 개요 정리: OpenAI 호환 본문으로 나가고 키는 헤더에만 ──
calls = [];
extFetch = () => chatOk('1. 광합성\n  - 엽록체에서 일어난다');
let r = await post('/api/ai/ask', { task: 'outline', text: '오늘 배운 것. 광합성은 엽록체에서 일어난다.' });
ok('개요 정리 성공', r.ok === true && r.text === '1. 광합성\n  - 엽록체에서 일어난다');
const c0 = calls[0];
ok('엔드포인트: {base}/chat/completions (끝 슬래시 중복 없음)', c0.url === 'https://ai.example.test/v1/chat/completions');
ok('Authorization: Bearer 로만 전송', c0.auth === `Bearer ${FAKE_KEY}`);
ok('본문에 키가 없다', !c0.raw.includes(FAKE_KEY));
ok('모델·온도·max_tokens 를 보낸다', c0.body.model === 'test-model-x'
  && c0.body.temperature === 0.3 && c0.body.max_tokens === 321 && c0.body.stream === false);
ok('system+user 2 메시지', Array.isArray(c0.body.messages) && c0.body.messages.length === 2
  && c0.body.messages[0].role === 'system' && c0.body.messages[1].role === 'user');
ok('user 메시지에 노트 본문이 담긴다', /광합성은 엽록체에서/.test(c0.body.messages[1].content));

// ── 3) 질문: 질문이 프롬프트에 실린다 ──
calls = [];
extFetch = () => chatOk('[[note]]\n엽록체입니다.');
r = await post('/api/ai/ask', { task: 'chat', text: '광합성은 엽록체에서 일어난다.', question: '어디서 일어나?' });
ok('질문 성공', r.ok === true && r.text === '[[note]]\n엽록체입니다.');
ok('질문이 user 메시지에 담긴다', /질문: 어디서 일어나\?/.test(calls[0].body.messages[1].content));
ok('chat 은 노트 본문도 함께 담긴다', /노트 본문:/.test(calls[0].body.messages[1].content));
r = await post('/api/ai/ask', { task: 'chat', text: '본문', question: '' });
ok('질문 없이 chat → 400', r.status === 400 && /질문을 적어 주세요/.test(r.error || ''));
// 14.23.0 · chat 은 노트가 비어 있어도 부를 수 있다 — 모델이 자유 질문[[free]]으로 판단한다
calls = [];
extFetch = () => chatOk('[[free]]\n노트 없이 답했어요.');
r = await post('/api/ai/ask', { task: 'chat', text: '   \n  ', question: '그냥 궁금한 것' });
ok('빈 노트 + chat → 400 이 아니라 모델이 답한다', r.ok === true && /^\[\[free\]\]/.test(r.text || ''));
ok('빈 노트면 user 메시지에 본문을 싣지 않는다', !/노트 본문:/.test(calls[0].body.messages[1].content));

// ── 4) task 화이트리스트 ──
calls = [];
extFetch = () => chatOk('nope');
r = await post('/api/ai/ask', { task: 'ignore-all-rules', text: '본문' });
ok('화이트리스트 밖 task → 400 + 외부 호출 0번', r.status === 400 && calls.length === 0
  && Array.isArray(r.allowed) && r.allowed.includes('outline'));
r = await post('/api/ai/ask', { text: '본문' });
ok('task 없음 → 400', r.status === 400);

// ── 5) 캐시: 같은 입력 재요청은 외부 호출 없이 ──
ai.aiCacheReset();
calls = [];
extFetch = () => chatOk('캐시될 답변');
r = await post('/api/ai/ask', { task: 'outline', text: '캐시 테스트 본문' });
ok('첫 요청은 외부 호출', r.ok === true && calls.length === 1 && r.cached === false);
r = await post('/api/ai/ask', { task: 'outline', text: '캐시 테스트 본문' });
ok('같은 요청 재시도는 캐시 응답 (외부 호출 0번)', r.ok === true && calls.length === 1 && r.cached === true);
r = await post('/api/ai/ask', { task: 'chat', text: '캐시 테스트 본문', question: '다른 일' });
ok('다른 task 는 다른 캐시 (외부 호출 1번 더)', r.ok === true && calls.length === 2 && r.cached === false);

// ── 6) in-flight 합치기: 동시에 온 같은 요청은 한 번만 나간다 ──
ai.aiCacheReset();
calls = [];
extFetch = async () => { await new Promise((z) => setTimeout(z, 40)); return chatOk('동시 응답'); };
const both = await Promise.all([
  post('/api/ai/ask', { task: 'outline', text: '동시 요청 본문' }),
  post('/api/ai/ask', { task: 'outline', text: '동시 요청 본문' }),
]);
ok('동시 중복 요청은 외부 호출 1번', calls.length === 1);
ok('둘 다 같은 답변을 받는다', both[0].text === '동시 응답' && both[1].text === '동시 응답');

// ── 7) 길이 상한: 잘라 보내고 클라이언트에게 알린다 ──
ai.aiCacheReset();
calls = [];
extFetch = (u, opts) => chatOk('ok');
const long = '가'.repeat(600) + '나'.repeat(300);   // 14.22.0 · 앞 70% + 뒤 30%
r = await post('/api/ai/ask', { task: 'outline', text: long });
ok('긴 본문은 AI_MAX_TEXT(500) 만큼만 전송', r.ok === true && r.truncated === true && r.chars === 500);
ok('긴 본문은 전체 길이를 따로 알려 준다', r.note_chars === 900, r.note_chars);
// 앞 350자(가) + 뒤 150자(나) 를 살리고 가운데만 접는다 — '앞부분만' 보내지 않는다
ok('긴 본문은 앞부분(350자)을 보낸다', calls[0].body.messages[1].content.includes('가'.repeat(350))
  && !calls[0].body.messages[1].content.includes('가'.repeat(351)));
ok('긴 본문은 뒷부분(150자)도 보낸다', calls[0].body.messages[1].content.includes('나'.repeat(150)));
ok('가운데가 접혔다는 표시가 남는다', /가운데 \d+자를 접었어요/.test(calls[0].body.messages[1].content));
r = await post('/api/ai/ask', { task: 'outline', text: '가'.repeat(499) });
ok('한도 안쪽이면 truncated=false', r.ok === true && r.truncated === false && r.chars === 499);

// ── 8) 빈 노트 ──
r = await post('/api/ai/ask', { task: 'outline', text: '   \n  ' });
ok('빈 노트 → 400 + 외부 호출 없음', r.status === 400 && /빈 노트/.test(r.error || ''));

// ── 9) 429 → 제한 안내 + 쿨다운 동안 외부 호출 0번 ──
ai.aiCacheReset(); ai.aiCooldownReset();
calls = [];
extFetch = () => new Response('rate limited', { status: 429 });
r = await post('/api/ai/ask', { task: 'outline', text: '429 맞는 본문' });
ok('429 → 429 + limited + retry_after', r.status === 429 && r.limited === true
  && Number(r.retry_after) >= 1 && /제한|사용량/.test(r.error || ''));
extFetch = () => chatOk('쿨다운 중이면 부르면 안 되는 호출');
r = await post('/api/ai/ask', { task: 'outline', text: '쿨다운 중 본문' });
ok('쿨다운 중에는 모델 API 를 부르지 않는다', r.status === 429 && calls.length === 1);
await new Promise((z) => setTimeout(z, 350));   // 쿨다운 만료
r = await post('/api/ai/ask', { task: 'outline', text: '쿨다운 뒤 본문' });
ok('쿨다운이 지나면 다시 호출', r.ok === true && calls.length === 2);

// ── 10) 키 오류(401) → 502 · 쿨다운을 걸지 않아 바로 재시도된다 ──
ai.aiCacheReset(); ai.aiCooldownReset();
calls = [];
extFetch = () => new Response('invalid api key', { status: 401 });
r = await post('/api/ai/ask', { task: 'outline', text: '키 오류 본문' });
ok('401 → 502 (limited 아님)', r.status === 502 && r.limited === false);
r = await post('/api/ai/ask', { task: 'outline', text: '키 오류 본문 두번째' });
ok('401 은 쿨다운이 없어서 곧바로 다시 나간다', calls.length === 2 && r.status === 502);

// ── 10-2) 설정 오류 힌트: 401 은 키, 404 는 모델명을 짚어 주고 키는 안 싣는다 ──
ai.aiCacheReset(); ai.aiCooldownReset();
extFetch = () => new Response('invalid api key', { status: 401 });
r = await post('/api/ai/ask', { task: 'outline', text: '힌트 401 본문' });
ok('401 → 키 확인 힌트', r.status === 502 && /키가 거부됐어요\(401\)/.test(r.hint || ''));
ok('401 힌트에 Vertex/서비스계정 함정을 알려 준다', /Vertex AI 서비스계정/.test(r.hint || ''));
ok('힌트에 키가 새지 않는다', !JSON.stringify(r).includes(FAKE_KEY));
extFetch = () => new Response('model not found', { status: 404 });
r = await post('/api/ai/ask', { task: 'outline', text: '힌트 404 본문' });
ok('404 → 모델명 확인 힌트', r.status === 502 && /모델을 못 찾았어요\(404\)/.test(r.hint || '')
  && /models/.test(r.hint || ''));
ok('한도(429)에는 설정 힌트를 붙이지 않는다', true);
ai.aiCacheReset(); ai.aiCooldownReset();
extFetch = () => new Response('rl', { status: 429 });
r = await post('/api/ai/ask', { task: 'outline', text: '힌트 429 본문' });
ok('429 → hint 비어 있음', r.status === 429 && r.hint === '');
await new Promise((z) => setTimeout(z, 350));

// ── 11) 빈 응답 ──
ai.aiCacheReset();
extFetch = () => chatOk('   ');
r = await post('/api/ai/ask', { task: 'outline', text: '빈 응답 본문' });
ok('모델이 빈 내용을 주면 502', r.status === 502 && r.ok === false);

// ── 12) 14.22.0 · 스트리밍 — 말하는 대로 흘려 보낸다 ──
ai.aiCacheReset(); ai.aiRateReset(); ai.aiCooldownReset();
// 모델(OpenAI 호환) 이 흘려 보내는 SSE — data: {choices:[{delta:{content}}]} … [DONE]
const openaiSse = (parts, size = 8) => {
  const raw = parts.map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`)
    .join('') + 'data: [DONE]\n\n';
  const bytes = Buffer.from(raw, 'utf8');
  const stream = new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += size) c.enqueue(new Uint8Array(bytes.subarray(i, i + size)));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
};
const parseEvts = (text) => text.split('\n\n').filter(Boolean).map((blk) => {
  const o = { event: '', data: null };
  for (const ln of blk.split('\n')) {
    if (ln.startsWith('event:')) o.event = ln.slice(6).trim();
    else if (ln.startsWith('data:')) o.data = JSON.parse(ln.slice(5).trim());
  }
  return o;
});
const askStream = async (body) => {
  const res = await fetch(BASE + '/api/ai/ask', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ stream: true }, body)),
  });
  const text = await res.text();
  return { status: res.status, ctype: res.headers.get('content-type') || '', text, evts: parseEvts(text) };
};

calls = [];
extFetch = () => openaiSse(['광합성은 ', '엽록체에서 ', '일어난다.']);
let sr = await askStream({ task: 'outline', text: '광합성 노트' });
ok('스트림: SSE(text/event-stream) 로 답한다', sr.status === 200 && /text\/event-stream/.test(sr.ctype), sr.ctype);
let deltas = sr.evts.filter((e) => e.event === 'delta');
ok('스트림: 조각(delta) 이 여러 개로 흘러온다', deltas.length === 3, deltas.length);
ok('스트림: 조각을 모으면 전체 문장이 된다',
  deltas.map((e) => e.data.t).join('') === '광합성은 엽록체에서 일어난다.',
  deltas.map((e) => e.data.t).join(''));
let doneEvt = sr.evts.find((e) => e.event === 'done');
ok('스트림: 마지막에 done(전체·공급사·모델) 을 준다',
  Boolean(doneEvt) && doneEvt.data.text === '광합성은 엽록체에서 일어난다.'
  && doneEvt.data.provider === 'manual', doneEvt && JSON.stringify(doneEvt.data));
ok('스트림: 모델 요청도 stream:true 로 나간다', calls[0].body.stream === true);
ok('스트림: 키가 응답에 절대 새지 않는다', !sr.text.includes(FAKE_KEY));

// 두 번째(같은 질문) → 캐시에서 바로 흘려 보낸다(외부 호출 0번)
calls = [];
sr = await askStream({ task: 'outline', text: '광합성 노트' });
ok('스트림: 같은 질문은 외부 호출 없이 캐시로 흘려 보낸다', calls.length === 0
  && (sr.evts.find((e) => e.event === 'done') || {}).data?.cached === true, calls.length);

// 스트림 중 429 → error 이벤트(한도) 로 알린다
ai.aiCacheReset(); ai.aiCooldownReset();
calls = [];
extFetch = () => new Response('rate limited', { status: 429 });
sr = await askStream({ task: 'outline', text: '스트림 429 본문' });
let errEvt = sr.evts.find((e) => e.event === 'error');
ok('스트림: 429 는 error 이벤트로 알린다(제한 초 포함)',
  Boolean(errEvt) && errEvt.data.limited === true && Number(errEvt.data.retry_after) >= 1
  && /제한|사용량/.test(errEvt.data.error || ''), errEvt && JSON.stringify(errEvt.data));
ok('스트림: 429 도 SSE(200) 로 감싸서 내려준다', sr.status === 200);
await new Promise((z) => setTimeout(z, 350));   // 쿨다운 만료

// 스트림을 못 주는 공급사 → 알아서 한 방(JSON) 응답으로 떨어진다
ai.aiCacheReset(); ai.aiCooldownReset();
calls = [];
extFetch = (u, opts) => (JSON.parse(opts.body).stream
  ? chatOk('')                                  // 빈 스트림 → 못 준다
  : chatOk('그냥 한 방으로 줄게요'));
sr = await askStream({ task: 'outline', text: '스트림 미지원 본문' });
ok('스트림: 스트림을 못 주는 공급사는 한 방 응답으로 떨어진다',
  (sr.evts.find((e) => e.event === 'done') || {}).data?.text === '그냥 한 방으로 줄게요',
  sr.text.slice(0, 120));

// 14.23.0 · chat 스트림 — 해돌이 판단 표식([[note]]/[[free]])도 그대로 흘려 본다
//   (딱지로 바꾸는 건 프런트 일 — 서버는 그대로 통과시킨다)
ai.aiCacheReset();
calls = [];
extFetch = () => openaiSse(['[[note', ']]\n', '엽록체에서 일어나요']);
sr = await askStream({ task: 'chat', text: '광합성 노트', question: '어디서 일어나?' });
{
  const cd = sr.evts.find((e) => e.event === 'done');
  ok('스트림: chat 답도 조각으로 흘러오고 done 에 표식 포함 전문이 담긴다',
    Boolean(cd) && cd.data.text === '[[note]]\n엽록체에서 일어나요', cd && cd.data.text);
}

// ── 13) 14.22.0 · 미리 준비(warm) — 한도를 따로 센다 ──
//   (AI_RATE_N=200 으로 리밋이 사실상 꺼진 이 파일에서 AI_WARN_N 만 1 로 둔다)
ai.aiCacheReset(); ai.aiRateReset(); ai.aiCooldownReset();
calls = [];
extFetch = () => chatOk('미리 준비된 개요');
r = await post('/api/ai/ask', { task: 'outline', text: '미리 준비 본문', warm: true });
ok('미리 준비: warm:true 요청도 똑같이 답한다', r.ok === true && r.text === '미리 준비된 개요');
r = await post('/api/ai/ask', { task: 'outline', text: '미리 준비 본문 둘', warm: true });
ok('미리 준비: 두 번째는 전용 한도(AI_WARM_N=1)에 걸린다', r.status === 429 && r.limited === true, r.status);
// 14.23.0 · chat(질문)은 미리 준비할 수 없다 — warm:true 가 붙어도 일반 요청으로 센다
r = await post('/api/ai/ask', { task: 'chat', text: '미리 준비 본문 셋', question: '뭐든', warm: true });
ok('미리 준비: chat 은 warm 이 아니다(일반 한도로 답한다)', r.ok === true && r.cached === false, r.status);
r = await post('/api/ai/ask', { task: 'outline', text: '사용자가 직접 누른 본문' });
ok('미리 준비: 준비 한도가 찼어도 사용자가 누른 요청은 막지 않는다', r.ok === true, r.status);
r = await post('/api/ai/ask', { task: 'outline', text: '미리 준비 본문' });
ok('미리 준비: 준비해 둔 답은 그대로 캐시에서 나온다(외부 호출 0번)',
  r.ok === true && r.cached === true && r.text === '미리 준비된 개요', r.cached);

console.log(`\n${pass} passed, ${fail} failed`);
await app.close();
process.exit(fail ? 1 : 0);
