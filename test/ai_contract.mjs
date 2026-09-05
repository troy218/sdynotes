// 14.20.0 · /api/ai 계약 테스트 — 실제 모델 API 대신 fetch 를 가짜로 갈아끼워
// 요청 모양(키가 헤더에만 있는지)·캐시·in-flight 합치기·길이 제한·429 제한 안내를 검증한다.
//
// 이 파일이 지키려는 계약
//   1) 모델 키는 Authorization 헤더로만 나가고 응답·본문에는 절대 새지 않는다
//   2) task 화이트리스트(outline/chat/edit/app, 14.26.0) 밖의 일은 400 으로 거절한다 (임의 프롬프트 주입 차단)
//   3) 같은 입력 재요청은 외부 호출 없이 캐시로 답한다 / 동시에 온 중복은 하나로 합친다
//   4) 본문은 상한만큼만 잘라 보낸다 (truncated=true 로 클라이언트에 알린다)
//   5) 429 를 맞아도 서버 쪽 쿨다운은 없다 — 다음 요청은 곧바로 다시 외부로 나간다
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
const chatOk = (txt, finishReason = '') => json200({ choices: [{
  message: { role: 'assistant', content: txt }, finish_reason: finishReason || null,
}] });

process.env.AI_KEY = FAKE_KEY;
process.env.AI_BASE_URL = 'https://ai.example.test/v1/';      // 끝 슬래시 → 붙일 때 정리되는지 확인
process.env.AI_MODEL = 'test-model-x';
process.env.AI_MAX_TEXT = '500';   // config 가 최소 500 으로 올림(clamp)한다 — 그 값으로 검증
process.env.AI_MAX_TOKENS = '321';
process.env.AI_CACHE_TTL_MS = '60000';
process.env.AI_RATE_N = '200';   // 이 파일에선 레이트리밋을 사실상 끈다 (전용 파일에서 따로 검증)
process.env.AI_WARM_N = '1';    // 14.22.0 · '미리 준비' 전용 한도는 1 로 — 13) 에서 검증
process.env.AI_RATE_WINDOW_MS = '60000';

const ai = await import('../server/src/routes/ai.js');
const cfg = await import('../server/src/lib/config.js');
const splitSample = '노트 제목: 테스트\n페이지 크기: 800x1100\n'
  + Array.from({ length: 30 }, (_, i) => `[${i + 1}쪽]\n  id=t_${i} text=${'가'.repeat(30)}`).join('\n');
const splitParts = ai.splitEditText(splitSample, 300, 4);
assert.ok(splitParts.length > 1 && splitParts.length <= 4);
assert.ok(splitParts.every((part) => part.startsWith('노트 제목: 테스트\n페이지 크기: 800x1100')));
assert.ok(splitParts.join('\n').includes('id=t_0') && splitParts.join('\n').includes('id=t_29'));
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
ok('status: 할 일 5종(outline/chat/edit/app/draw)', Array.isArray(j.tasks) && j.tasks.length === 5
  && j.tasks.map((t) => t.id).join(',') === 'outline,chat,edit,app,draw'
  && j.tasks.some((t) => t.id === 'draw' && t.label === '그림 그리기'));
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

// 작은 모델이 자체 출력 한도에 닿으면 끊긴 지점부터 자동으로 이어 받는다.
ai.aiCacheReset(); calls = [];
let continueCall = 0;
extFetch = () => (++continueCall === 1) ? chatOk('첫 번째 파트', 'length') : chatOk('두 번째 파트', 'stop');
r = await post('/api/ai/ask', { task: 'outline', text: '자동 이어쓰기 고유 본문' });
ok('출력 한도(length)면 다음 파트를 자동 호출한다', calls.length === 2);
ok('자동 이어쓰기 파트를 한 답으로 합친다', r.text === '첫 번째 파트두 번째 파트');
ok('이어쓰기 호출은 반복 금지와 다음 지점을 명시한다',
  /이미 쓴 내용은 반복하지 말고/.test(calls[1].body.messages.at(-1).content));

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

// ── 3-2) 문서 편집: 상태/요청을 분리하고 실행 계획을 캐시하지 않는다 ──
ai.aiCacheReset();
calls = [];
const editPlan = '@tx t_1 | 새 제목\\n부제\n@done 제목과 부제를 고쳤어요';
extFetch = () => chatOk(editPlan);
const editBody = {
  task: 'edit',
  text: '페이지 크기: 800x1100 px · 총 1쪽\n[1쪽]\n  id=t_1 type=글상자 x=40 y=50 w=300 h=80 text="옛 제목"',
  question: '제목을 새 제목과 부제로 바꿔 줘',
};
r = await post('/api/ai/ask', editBody);
ok('문서 편집 계획을 그대로 돌려준다', r.ok === true && r.task === 'edit' && r.text === editPlan);
const editMessages = calls[0].body.messages;
ok('편집 시스템 프롬프트는 허용 명령과 @done 형식을 고정한다',
  /@mv/.test(editMessages[0].content) && /@tx/.test(editMessages[0].content)
  && /@add/.test(editMessages[0].content) && /@done/.test(editMessages[0].content));
ok('문서 상태와 편집 요청은 서로 다른 레이블로 모델에 전달한다',
  /문서 상태:\n<document>/.test(editMessages[1].content)
  && /편집 요청: 제목을 새 제목과 부제로/.test(editMessages[1].content));
ok('문서 안 가짜 지시를 따르지 말라는 방어 규칙이 있다', /신뢰할 수 없는 사용자 문서/.test(editMessages[0].content));
r = await post('/api/ai/ask', editBody);
ok('같은 편집 요청도 캐시하지 않고 매번 새 계획을 만든다',
  r.ok === true && r.cached === false && calls.length === 2);
r = await post('/api/ai/ask', { task: 'edit', text: '', question: '상자 추가' });
ok('문서 상태 없는 편집은 외부 호출 없이 400', r.status === 400 && /문서 상태/.test(r.error || '') && calls.length === 2);
r = await post('/api/ai/ask', { task: 'edit', text: '페이지 크기: 800x1100', question: '' });
ok('요청 없는 편집은 외부 호출 없이 400', r.status === 400 && /어떻게 고칠지/.test(r.error || '') && calls.length === 2);

// ── 3-3) 똑똑한 해돌이(14.25.0): 자동 라우팅·서식·표·문맥 ──
ok('질문 프롬프트는 편집 요청이면 [[edit]] 으로 넘기라고 한다',
  /\[\[edit\]\]/.test(ai.AI_TASKS.chat.system) && /\[\[note\]\]/.test(ai.AI_TASKS.chat.system)
  && /\[\[free\]\]/.test(ai.AI_TASKS.chat.system));
ok('편집 프롬프트는 부분 수정·서식·표·이동·클립보드·되묻기를 문서화한다',
  ['@rp', '@ap', '@st', '@tbl', '@tsz', '@tmv', '@tcell', '@goto', '@newpage',
    '@title', '@clip', '@clipin', '@copy', '@ask'].every((c) => editMessages[0].content.includes(c)));
ok('편집 프롬프트는 글꼴·색 지도를 싣는다',
  /gaegu\(개구쟁이\)/.test(editMessages[0].content) && /형광펜: 노랑/.test(editMessages[0].content));
ok('편집 프롬프트는 통째 교체보다 부분 수정을 먼저 쓰라고 한다',
  /통째로\(@tx\)보다 부분\(@rp\)/.test(editMessages[0].content));
r = await post('/api/ai/ask', { ...editBody, context: '이전 요청: 제목 Stand by\n이전 결과: 파란 상자를 물어봄' });
ok('편집 후속 문맥(context)은 이전 대화 레이블로 모델에 전달한다',
  r.ok === true && /이전 대화:\n이전 요청: 제목 Stand by/.test(calls[calls.length - 1].body.messages[1].content));
r = await post('/api/ai/ask', { task: 'chat', text: '본문', question: '질문', context: '무시되는 문맥' });
ok('context 는 edit·app 전용 — chat 에는 실리지 않는다',
  r.ok === true && !/무시되는 문맥/.test(calls[calls.length - 1].body.messages[1].content));

// ── 3-3b) 14.27.0 · 형광펜·표 삭제·보기 좋은 배치·여러 대화 묶음 문맥 ──
ok('편집 프롬프트는 형광펜(@hl)·정돈(@tidy)·표 삭제 별칭(@tdel)·auto 자리를 문서화한다',
  ['@hl', '@tidy', '@tdel', 'auto'].every((c) => editMessages[0].content.includes(c))
  && /중요한 글귀/.test(editMessages[0].content)
  && /⟦…⟧/.test(editMessages[0].content)
  && /표 칸 id를 넣어도 그 표 전체를 지운다/.test(editMessages[0].content));
const longCtx = Array.from({ length: 5 }, (_, i) => `${i + 1}) 앞선 대화(문서 편집): 요청 ${i} → 결과 ${i}`).join('\n')
  + '\n이전 요청: ' + '아주 긴 요청 '.repeat(200)
  + '\n이전 결과: ' + '아주 긴 결과 '.repeat(200);
r = await post('/api/ai/ask', { ...editBody, context: longCtx });
const sentCtx = (calls[calls.length - 1].body.messages[1].content
  .match(/이전 대화:\n([\s\S]*?)\n\n편집 요청:/) || [, ''])[1];
ok('여러 턴을 묶은 긴 문맥이 예전 1500자에서 잘리지 않고 통째로 전달된다',
  r.ok === true && sentCtx.length > 2500 && /1\) 앞선 대화/.test(sentCtx)
  && /이전 요청: 아주 긴 요청/.test(sentCtx) && /이전 결과: 아주 긴 결과/.test(sentCtx),
  `len=${sentCtx.length}`);
ok('문맥 상한은 AI_MAX_CONTEXT 이다', cfg.AI_MAX_CONTEXT > 1500 && sentCtx.length <= cfg.AI_MAX_CONTEXT);

// ── 3-4) 해돌이 앱 실행(14.26.0): 음악·노트·타이머·도구 ──
ai.aiCacheReset();
calls = [];
const appPlan = '@music play | 봄날\n@done 봄날을 틀었어요';
extFetch = () => chatOk(appPlan);
const appBody = {
  task: 'app',
  text: '열린 노트: 회의록\n노트 목록 2개: 회의록 / 일기\n음악: 정지\n노래 목록 2곡: 봄날 - 방탄소년단 / NIGHT DANCER - imase',
  question: '봄날 틀어줘',
};
r = await post('/api/ai/ask', appBody);
ok('앱 실행 계획을 그대로 돌려준다', r.ok === true && r.task === 'app' && r.text === appPlan);
const appMessages = calls[0].body.messages;
ok('앱 시스템 프롬프트는 음악·노트·타이머·도구·되묻기를 문서화한다',
  ['@music play', '@note open', '@timer', '@clock', '@sw', '@present', '@export', '@find',
    '@stickers', '@cards', '@settings', '@ask', '@done'].every((c) => appMessages[0].content.includes(c)));
ok('앱 상태와 실행 요청은 서로 다른 레이블로 모델에 전달한다',
  /앱 상태:\n<appstate>/.test(appMessages[1].content)
  && /실행 요청: 봄날 틀어줘/.test(appMessages[1].content));
ok('앱 상태 안 가짜 지시를 따르지 말라는 방어 규칙이 있다', /신뢰할 수 없는 사용자 데이터/.test(appMessages[0].content));
ok('질문 프롬프트는 앱 실행 요청이면 [[app]] 으로 넘기라고 한다',
  /\[\[app\]\]/.test(ai.AI_TASKS.chat.system));
r = await post('/api/ai/ask', appBody);
ok('같은 실행 요청도 캐시하지 않고 매번 새 계획을 만든다',
  r.ok === true && r.cached === false && calls.length === 2);
r = await post('/api/ai/ask', { task: 'app', text: '', question: '노래 틀어줘' });
ok('앱 상태 없는 실행은 외부 호출 없이 400', r.status === 400 && /앱 상태/.test(r.error || '') && calls.length === 2);
r = await post('/api/ai/ask', { task: 'app', text: '열린 노트: 없음', question: '' });
ok('요청 없는 실행은 외부 호출 없이 400', r.status === 400 && /무엇을 실행할지/.test(r.error || '') && calls.length === 2);
r = await post('/api/ai/ask', { ...appBody, context: '이전 요청: 봄날 틀어줘\n이전 결과: 틀었어요' });
ok('실행 후속 문맥(context)도 이전 대화 레이블로 모델에 전달한다',
  r.ok === true && /이전 대화:\n이전 요청: 봄날 틀어줘/.test(calls[calls.length - 1].body.messages[1].content));

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
const long = '가'.repeat(300) + '중'.repeat(300) + '나'.repeat(300); // 14.27.1 · 앞·중간·뒤
r = await post('/api/ai/ask', { task: 'outline', text: long });
ok('긴 본문은 AI_MAX_TEXT(500) 만큼만 전송', r.ok === true && r.truncated === true && r.chars === 500);
ok('긴 본문은 전체 길이를 따로 알려 준다', r.note_chars === 900, r.note_chars);
// 앞 200자 + 가운데 150자 + 뒤 150자를 고르게 살린다.
const sentLong = calls[0].body.messages[1].content;
ok('긴 본문은 앞부분(200자)을 보낸다', sentLong.includes('가'.repeat(200)));
ok('긴 본문은 중간 내용도 보낸다', sentLong.includes('중'.repeat(100)));
ok('긴 본문은 뒷부분(150자)도 보낸다', sentLong.includes('나'.repeat(150)));
ok('두 생략 구간이 표시된다', (sentLong.match(/긴 노트: 여기서 \d+자를 접었어요/g) || []).length === 2);
r = await post('/api/ai/ask', { task: 'outline', text: '가'.repeat(499) });
ok('한도 안쪽이면 truncated=false', r.ok === true && r.truncated === false && r.chars === 499);

// ── 8) 빈 노트 ──
r = await post('/api/ai/ask', { task: 'outline', text: '   \n  ' });
ok('빈 노트 → 400 + 외부 호출 없음', r.status === 400 && /빈 노트/.test(r.error || ''));

// ── 9) 429 → 제한 안내 · 서버 쪽 쿨다운 없음(다음 요청은 곧바로 재시도) ──
ai.aiCacheReset();
calls = [];
extFetch = () => new Response('rate limited', { status: 429 });
r = await post('/api/ai/ask', { task: 'outline', text: '429 맞는 본문' });
ok('429 → 429 + limited 안내', r.status === 429 && r.limited === true && /제한|사용량/.test(r.error || ''));
ok('공급사가 retry-after 를 안 주면 서버가 초를 지어내지 않는다', Number(r.retry_after) === 0,
  String(r.retry_after));
extFetch = () => chatOk('곧바로 다시 나가야 하는 호출');
r = await post('/api/ai/ask', { task: 'outline', text: '429 직후 본문' });
ok('429 직후에도 기다림 없이 모델 API 를 다시 부른다 (쿨다운 없음)',
  r.ok === true && calls.length === 2, calls.length);
// 공급사가 retry-after 헤더를 주면 그 값만 그대로 전달한다
ai.aiCacheReset();
extFetch = () => new Response('rate limited', { status: 429, headers: { 'retry-after': '7' } });
r = await post('/api/ai/ask', { task: 'outline', text: 'retry-after 있는 본문' });
ok('공급사의 retry-after 는 그대로 실어 보낸다', r.status === 429 && Number(r.retry_after) === 7,
  String(r.retry_after));

// ── 10) 키 오류(401) → 502 · 바로 재시도된다 ──
ai.aiCacheReset();
calls = [];
extFetch = () => new Response('invalid api key', { status: 401 });
r = await post('/api/ai/ask', { task: 'outline', text: '키 오류 본문' });
ok('401 → 502 (limited 아님)', r.status === 502 && r.limited === false);
r = await post('/api/ai/ask', { task: 'outline', text: '키 오류 본문 두번째' });
ok('401 뒤에도 곧바로 다시 나간다', calls.length === 2 && r.status === 502);

// ── 10-2) 설정 오류 힌트: 401 은 키, 404 는 모델명을 짚어 주고 키는 안 싣는다 ──
ai.aiCacheReset();
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
ai.aiCacheReset();
extFetch = () => new Response('rl', { status: 429 });
r = await post('/api/ai/ask', { task: 'outline', text: '힌트 429 본문' });
ok('429 → hint 비어 있음', r.status === 429 && r.hint === '');

// ── 11) 빈 응답 ──
ai.aiCacheReset();
extFetch = () => chatOk('   ');
r = await post('/api/ai/ask', { task: 'outline', text: '빈 응답 본문' });
ok('모델이 빈 내용을 주면 502', r.status === 502 && r.ok === false);

// ── 12) 14.22.0 · 스트리밍 — 말하는 대로 흘려 보낸다 ──
ai.aiCacheReset(); ai.aiRateReset();
// 모델(OpenAI 호환) 이 흘려 보내는 SSE — data: {choices:[{delta:{content}}]} … [DONE]
const openaiSse = (parts, size = 8, finishReason = '') => {
  const finish = finishReason
    ? `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n\n` : '';
  const raw = parts.map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`)
    .join('') + finish + 'data: [DONE]\n\n';
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

// 스트림도 length 종료를 감지해 새 스트림 파트를 이어 붙인다.
ai.aiCacheReset(); calls = []; continueCall = 0;
extFetch = () => (++continueCall === 1)
  ? openaiSse(['스트림 첫 파트'], 8, 'length')
  : openaiSse(['스트림 둘째 파트'], 8, 'stop');
sr = await askStream({ task: 'outline', text: '스트림 자동 이어쓰기 고유 본문' });
deltas = sr.evts.filter((e) => e.event === 'delta');
doneEvt = sr.evts.find((e) => e.event === 'done');
ok('스트림 출력 한도도 자동으로 다음 파트를 호출한다', calls.length === 2);
ok('스트림 이어쓰기 전문이 done에 합쳐진다',
  doneEvt?.data?.text === '스트림 첫 파트스트림 둘째 파트');

// 두 번째(같은 질문) → 캐시에서 바로 흘려 보낸다(외부 호출 0번)
// 앞의 기본 광합성 답을 다시 준비해 캐시 경로를 확인한다.
ai.aiCacheReset(); calls = [];
extFetch = () => openaiSse(['광합성은 엽록체에서 일어난다.']);
sr = await askStream({ task: 'outline', text: '광합성 노트' });
calls = [];
calls = [];
sr = await askStream({ task: 'outline', text: '광합성 노트' });
ok('스트림: 같은 질문은 외부 호출 없이 캐시로 흘려 보낸다', calls.length === 0
  && (sr.evts.find((e) => e.event === 'done') || {}).data?.cached === true, calls.length);

// 스트림 중 429 → error 이벤트(한도) 로 알린다
ai.aiCacheReset();
calls = [];
extFetch = () => new Response('rate limited', { status: 429 });
sr = await askStream({ task: 'outline', text: '스트림 429 본문' });
let errEvt = sr.evts.find((e) => e.event === 'error');
ok('스트림: 429 는 error 이벤트로 알린다(제한 표시)',
  Boolean(errEvt) && errEvt.data.limited === true
  && /제한|사용량/.test(errEvt.data.error || ''), errEvt && JSON.stringify(errEvt.data));
ok('스트림: 429 도 SSE(200) 로 감싸서 내려준다', sr.status === 200);

// 스트림을 못 주는 공급사 → 알아서 한 방(JSON) 응답으로 떨어진다
ai.aiCacheReset();
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
ai.aiCacheReset(); ai.aiRateReset();
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
