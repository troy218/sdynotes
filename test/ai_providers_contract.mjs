// 14.20.0 · AI 공급사 '체인' 계약 — 무료 티어 한도(429)가 걸려도 다음 공급사로
// 넘어가서 답을 받아 온다. translate.js 의 Google 호스트 순회와 같은 발상.
//
// AI_PROVIDERS/AI_* 는 import 시점에 읽히므로 단독 프로세스로 돌린다.
//   1) .env → 공급사 목록 해석 (프리셋 URL/모델, 자동 감지, 중복 제거, ollama)
//   2) 1차 429 → 2차로 폴백 (응답에 '누가 답했는지'가 담긴다)
//   3) 전부 429 → 429 + retry_after, 그 뒤엔 외부 호출 0번
//   4) 전부 쉬는 중에도 캐시가 있으면 그것으로 답한다
//   5) 키는 항상 Authorization 헤더로만 나간다
import assert from 'node:assert/strict';

let calls = [];
let extFetch = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(u, opts);
  calls.push({
    url: u, auth: (opts.headers && opts.headers.Authorization) || '',
    body: opts.body ? JSON.parse(opts.body) : null, raw: String(opts.body || ''),
  });
  return extFetch ? extFetch(u, opts) : new Response('no plan', { status: 404 });
};
const chatOk = (t) => new Response(JSON.stringify({ choices: [{ message: { content: t } }] }), {
  status: 200, headers: { 'content-type': 'application/json' },
});

process.env.GROQ_API_KEY = 'gsk-fake-1111';
process.env.GEMINI_API_KEY = 'gem-fake-2222';
process.env.AI_PROVIDERS = 'groq,gemini';
process.env.AI_CACHE_TTL_MS = '60000';
process.env.AI_RATE_N = '200';
process.env.AI_COOLDOWN_MS = '300';

const cfg = await import('../server/src/lib/config.js');
const ai = await import('../server/src/routes/ai.js');
const { default: Fastify } = await import('fastify');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : '\n      ' + extra}`);
};

// ── 1) .env → 공급사 목록 해석 ───────────────────────────────────────────────
const list = cfg.aiProvidersFromEnv({ AI_PROVIDERS: 'groq,gemini', GROQ_API_KEY: 'g1', GEMINI_API_KEY: 'm1' });
ok('AI_PROVIDERS 순서대로 2개가 잡힌다', list.length === 2 && list[0].name === 'groq' && list[1].name === 'gemini',
  JSON.stringify(list));
ok('프리셋 URL 이 자동으로 붙는다 (Groq)', list[0].url === 'https://api.groq.com/openai/v1', list[0].url);
ok('프리셋 URL 이 자동으로 붙는다 (Gemini · OpenAI 호환 경로)',
  list[1].url === 'https://generativelanguage.googleapis.com/v1beta/openai', list[1].url);
ok('프리셋 모델명이 자동으로 붙는다', list[0].model === 'llama-3.3-70b-versatile' && list[1].model === 'gemini-2.5-flash');

ok('키가 없는 공급사는 목록에서 빠진다',
  cfg.aiProvidersFromEnv({ AI_PROVIDERS: 'groq,openai', GROQ_API_KEY: 'g1' }).length === 1);
ok('AI_PROVIDERS 를 안 적어도 프리셋 키만으로 자동 감지된다',
  cfg.aiProvidersFromEnv({ GROQ_API_KEY: 'g1' }).some((p) => p.name === 'groq'));
ok('ollama 는 명시해야 붙고 자리표시자 키를 쓴다',
  cfg.aiProvidersFromEnv({ AI_PROVIDERS: 'ollama' })[0]?.url === 'http://127.0.0.1:11434/v1'
  && cfg.aiProvidersFromEnv({ AI_PROVIDERS: 'ollama' })[0]?.key === 'ollama'
  && cfg.aiProvidersFromEnv({}).every((p) => p.name !== 'ollama'));
ok('ollama 모델명을 덮어쓸 수 있다',
  cfg.aiProvidersFromEnv({ AI_PROVIDERS: 'ollama', OLLAMA_MODEL: 'llama3.2:1b' })[0]?.model === 'llama3.2:1b');
ok('수동 AI_KEY/AI_BASE_URL/AI_MODEL 은 1순위로 들어간다', (() => {
  const l = cfg.aiProvidersFromEnv({ AI_KEY: 'k', AI_BASE_URL: 'https://my.gw/v1/', AI_MODEL: 'm', GROQ_API_KEY: 'g1' });
  return l[0].name === 'manual' && l[0].url === 'https://my.gw/v1' && l[0].model === 'm' && l[1].name === 'groq';
})());
ok('같은 키+url+model 중복은 한 번만', (() => {
  const l = cfg.aiProvidersFromEnv({ AI_PROVIDERS: 'groq,groq', GROQ_API_KEY: 'g1' });
  return l.length === 1;
})());
// 회귀: AI_PROVIDERS 에 적은 공급사의 URL 을 덮어쓰면, 자동 감지 경로가 프리셋
// 기본 URL 로 한 번 더 집어넣어 '같은 공급사를 두 번 때리는' 사고가 났었다.
ok('AI_PROVIDERS + BASE_URL 덮어쓰기 → 덮어쓴 값 하나로만 (중복 호출 방지)', (() => {
  const l = cfg.aiProvidersFromEnv({
    AI_PROVIDERS: 'groq,gemini', GROQ_API_KEY: 'g1', GEMINI_API_KEY: 'm1',
    GROQ_BASE_URL: 'http://127.0.0.1:5061/v1',
  });
  return l.length === 2 && l[0].url === 'http://127.0.0.1:5061/v1'
    && l.filter((p) => p.name === 'groq').length === 1
    && l.filter((p) => p.name === 'gemini').length === 1;
})(), JSON.stringify(cfg.aiProvidersFromEnv({
  AI_PROVIDERS: 'groq,gemini', GROQ_API_KEY: 'g1', GEMINI_API_KEY: 'm1',
  GROQ_BASE_URL: 'http://127.0.0.1:5061/v1',
})));

// ── 2) 1차 429 → 2차 폴백 ────────────────────────────────────────────────────
const app = Fastify({ logger: false });
ai.registerAi(app);
await app.listen({ port: 5201, host: '127.0.0.1' });
const BASE = 'http://127.0.0.1:5201';
const post = (body) => fetch(BASE + '/api/ai/ask', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json().then((j) => ({ status: r.status, ...j })));
const get = (p) => fetch(BASE + p).then((r) => r.json());

let st = await get('/api/ai/status');
ok('status: 공급사 체인을 이름·모델로 알려 준다',
  st.enabled === true && st.providers.length === 2
  && st.providers[0].name === 'groq' && st.providers[1].name === 'gemini');
ok('status: 키는 응답에 없다', !JSON.stringify(st).includes('gsk-fake-1111') && !JSON.stringify(st).includes('gem-fake-2222'));

ai.aiCacheReset(); ai.aiCooldownReset();
calls = [];
extFetch = (u) => u.startsWith('https://api.groq.com')
  ? new Response('rate limited', { status: 429 })
  : chatOk('Gemini 가 답했어요');
let r = await post({ task: 'outline', text: '폴백 테스트 본문' });
ok('1차(Groq) 429 → 2차(Gemini)로 폴백해 성공', r.ok === true && r.text === 'Gemini 가 답했어요');
ok('응답에 실제로 답한 공급사·모델이 담긴다', r.provider === 'gemini' && r.model === 'gemini-2.5-flash',
  JSON.stringify({ p: r.provider, m: r.model }));
ok('두 공급사를 순서대로 때렸다', calls.length === 2
  && calls[0].url.startsWith('https://api.groq.com') && calls[1].url.startsWith('https://generativelanguage.googleapis.com'));
ok('각자 자기 키를 헤더로만 보냈다', calls[0].auth === 'Bearer gsk-fake-1111'
  && calls[1].auth === 'Bearer gem-fake-2222'
  && !calls[0].raw.includes('gsk-fake-1111') && !calls[1].raw.includes('gem-fake-2222'));

// Groq 는 쿨다운 중 → 다음 요청은 Groq 를 아예 안 부른다
ai.aiCacheReset();
calls = [];
extFetch = () => chatOk('두번째 답');
r = await post({ task: 'outline', text: '쿨다운 건너뛰기 본문' });
ok('429 맞은 공급사는 쿨다운 동안 건너뛴다', r.ok === true && calls.length === 1
  && calls[0].url.startsWith('https://generativelanguage.googleapis.com'));

// ── 3) 전부 429 → 429 안내, 이후 외부 호출 0번 ──────────────────────────────
ai.aiCacheReset(); ai.aiCooldownReset();
calls = [];
extFetch = () => new Response('rl', { status: 429 });
r = await post({ task: 'outline', text: '전부 막힘 본문' });
ok('전부 429 → 429 + limited + retry_after', r.status === 429 && r.limited === true && Number(r.retry_after) >= 1);
ok('둘 다 때려 보고 나서 거절했다', calls.length === 2);
extFetch = () => chatOk('부르면 안 되는 호출');
r = await post({ task: 'outline', text: '전부 쿨다운 중 본문' });
ok('전부 쉬는 중엔 외부 호출 0번', r.status === 429 && calls.length === 2);

// ── 4) 전부 쉬는 중에도 캐시가 있으면 그것으로 답한다 ────────────────────────
ai.aiCacheReset(); ai.aiCooldownReset();
calls = [];
extFetch = () => chatOk('캐시될 답');
r = await post({ task: 'outline', text: '캐시+쿨다운 본문' });
ok('미리 캐시를 채운다', r.ok === true && r.provider === 'groq' && calls.length === 1);
extFetch = () => new Response('rl', { status: 429 });
await post({ task: 'outline', text: '쿨다운을 거는 다른 본문' });   // 두 공급사 다 429
extFetch = () => chatOk('부르면 안 되는 호출');
calls = [];
r = await post({ task: 'outline', text: '캐시+쿨다운 본문' });
ok('전부 쿨다운이어도 캐시로 답한다 (외부 호출 0번)',
  r.ok === true && r.cached === true && r.text === '캐시될 답' && calls.length === 0);

// ── 5) 401(키 오류) 은 '한도'가 아니라 502 로 떨어진다 ──────────────────────
ai.aiCacheReset(); ai.aiCooldownReset();
calls = [];
extFetch = () => new Response('bad key', { status: 401 });
r = await post({ task: 'outline', text: '키 오류 체인 본문' });
ok('401 은 limited 아님 → 502', r.status === 502 && r.limited === false);
ok('401 이면 두 공급사 모두 확인한다', calls.length === 2);

console.log(`\n${pass} passed, ${fail} failed`);
await app.close();
process.exit(fail ? 1 : 0);
