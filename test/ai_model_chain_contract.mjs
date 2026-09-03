// 14.23.x · 같은 키로 '모델 여러 개'를 걸어 두는 계약 — 무료 티어의 모델별 하루
// 한도를 우회하려고 GEMINI_MODELS=gemini-3.5-flash,gemini-3.1-flash-lite 처럼
// 나열해 두면, 앞 모델이 429(한도)를 주면 **같은 키/URL 로** 다음 모델로 넘어간다.
//
// AI_PROVIDERS / AI_* / <이름>_MODELS 는 import 시점에 읽히므로 이 검사는
// 단독 프로세스로 돌린다 (test:ai 가 나머지와 함께 이어서 실행).
import assert from 'node:assert/strict';

const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(u, opts);
  const body = opts.body ? JSON.parse(opts.body) : {};
  calls.push({ url: u, model: body.model, auth: (opts.headers && opts.headers.Authorization) || '' });
  // 앞 모델(gemini-3.5-flash)은 무료 티어 한도가 찼다고 429
  if (body.model === 'gemini-3.5-flash') return new Response('rate limited', { status: 429 });
  return new Response(JSON.stringify({ choices: [{ message: { content: body.model + ' answered' } }] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
};

process.env.GEMINI_API_KEY = 'gem-fake-chain-3333';
process.env.AI_PROVIDERS = 'gemini';
process.env.GEMINI_MODELS = 'gemini-3.5-flash,gemini-3.1-flash-lite';
process.env.AI_CACHE_TTL_MS = '0';        // 캐시로 호출이 흡수되면 체인 검사가 안 되므로 끈다
process.env.AI_RATE_N = '100';

const cfg = await import('../server/src/lib/config.js');
const ai = await import('../server/src/routes/ai.js');
const { default: Fastify } = await import('fastify');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : '\n      ' + extra}`);
};

// ── 1) .env → 같은 키로 모델 2개가 순서대로 잡힌다 ───────────────────────────
ok('하나의 키로 모델 2개가 체인에 올라간다', cfg.AI_PROVIDERS.length === 2
  && cfg.AI_PROVIDERS[0].name === 'gemini' && cfg.AI_PROVIDERS[0].model === 'gemini-3.5-flash'
  && cfg.AI_PROVIDERS[1].name === 'gemini' && cfg.AI_PROVIDERS[1].model === 'gemini-3.1-flash-lite',
  JSON.stringify(cfg.AI_PROVIDERS));
ok('두 항목이 같은 키·같은 base URL 을 쓴다', cfg.AI_PROVIDERS[0].key === cfg.AI_PROVIDERS[1].key
  && cfg.AI_PROVIDERS[0].url === cfg.AI_PROVIDERS[1].url,
  JSON.stringify(cfg.AI_PROVIDERS));

const app = Fastify({ logger: false });
ai.registerAi(app);
await app.listen({ port: 5203, host: '127.0.0.1' });
const BASE = 'http://127.0.0.1:5203';
const post = (body) => fetch(BASE + '/api/ai/ask', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json().then((j) => ({ status: r.status, ...j })));
const get = (p) => fetch(BASE + p).then((r) => r.json());

const st = await get('/api/ai/status');
ok('status: 같은 공급사가 모델별로 2개 보인다', st.enabled === true && st.providers.length === 2
  && st.providers[0].name === 'gemini' && st.providers[1].name === 'gemini'
  && st.providers[0].model === 'gemini-3.5-flash' && st.providers[1].model === 'gemini-3.1-flash-lite',
  JSON.stringify(st.providers));
ok('status: 키는 응답에 없다', !JSON.stringify(st).includes('gem-fake-chain-3333'));

// ── 2) 앞 모델 429 → 같은 키로 다음 모델로 폴백해 성공 ────────────────────────
calls.length = 0;
let r = await post({ task: 'outline', text: '모델 체인 테스트 본문' });
ok('앞 모델(429) → 뒤 모델로 폴백해 성공', r.ok === true && r.text === 'gemini-3.1-flash-lite answered');
ok('응답에 실제로 답한 모델이 담긴다', r.model === 'gemini-3.1-flash-lite' && r.provider === 'gemini');
ok('모델 2개를 순서대로 때렸다 (앞 429 → 뒤 시도)', calls.length === 2
  && calls[0].model === 'gemini-3.5-flash' && calls[1].model === 'gemini-3.1-flash-lite',
  JSON.stringify(calls));
ok('두 모델 모두 같은 키를 헤더로만 보냈다', calls.every((c) => c.auth === 'Bearer gem-fake-chain-3333'));

// ── 3) 서버 쪽 쿨다운 없음 — 다음 요청도 앞 모델부터 다시 시도한다 ─────────────
calls.length = 0;
r = await post({ task: 'outline', text: '429 직후 모델 체인 본문' });
ok('한도 뒤에도 앞 모델부터 다시 부른다 (쿨다운 없음)', r.ok === true
  && calls[0].model === 'gemini-3.5-flash' && calls[1].model === 'gemini-3.1-flash-lite',
  JSON.stringify(calls.map((c) => c.model)));

// ── 4) 전부 429 → 429 제한 안내 ──────────────────────────────────────────────
const realFetch2 = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch2(u, opts);
  calls.push({ url: u, model: opt_body(opts) });
  return new Response('rl', { status: 429 });
};
function opt_body(opts) { try { return JSON.parse(opts.body).model; } catch { return ''; } }
calls.length = 0;
r = await post({ task: 'outline', text: '전부 막힘 모델 체인 본문' });
ok('전부 429 → 429 + limited', r.status === 429 && r.limited === true);
ok('둘 다 때려 보고 나서 거절했다', calls.length === 2);
globalThis.fetch = realFetch2;

console.log(`\n${pass} passed, ${fail} failed`);
await app.close();
process.exit(fail ? 1 : 0);
