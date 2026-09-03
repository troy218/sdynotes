// 14.20.0 · /api/ai 레이트리밋 전용 계약 — 창(window) 안에서 N번까지만 모델 API 를 부른다.
// AI_RATE_* 는 import 시점에 읽히므로 이 검사는 단독 프로세스로 돌린다 (test:ai 가 둘을 이어서 실행).
import assert from 'node:assert/strict';

let calls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(u, opts);
  calls++;
  return new Response(JSON.stringify({ choices: [{ message: { content: '답변 ' + calls } }] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
};

process.env.AI_KEY = 'sk-rl-test';
process.env.AI_BASE_URL = 'https://ai.example.test/v1';
process.env.AI_MODEL = 'rl-model';
process.env.AI_RATE_N = '3';
process.env.AI_RATE_WINDOW_MS = '60000';
process.env.AI_CACHE_TTL_MS = '0';        // 캐시로 요청이 absorbed 되면 리밋 검사가 안 되므로 끈다

const ai = await import('../server/src/routes/ai.js');
const { default: Fastify } = await import('fastify');
const app = Fastify({ logger: false });
ai.registerAi(app);
await app.listen({ port: 5199, host: '127.0.0.1' });
const post = (body) => fetch('http://127.0.0.1:5199/api/ai/ask', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json().then((j) => ({ status: r.status, ...j })));

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };

const r1 = await post({ task: 'summarize', text: '본문 1' });
const r2 = await post({ task: 'summarize', text: '본문 2' });
const r3 = await post({ task: 'summarize', text: '본문 3' });
ok('한도(3번) 안쪽은 전부 성공', r1.ok && r2.ok && r3.ok && calls === 3);

const r4 = await post({ task: 'summarize', text: '본문 4' });
ok('한도를 넘기면 429 + limited', r4.status === 429 && r4.limited === true);
ok('429 안내에 재시도 대기(retry_after)가 담긴다', Number(r4.retry_after) >= 1);
ok('거절된 요청은 모델 API 를 부르지 않는다', calls === 3);

const st = await fetch('http://127.0.0.1:5199/api/ai/status').then((r) => r.json());
ok('상태 조회는 리밋을 소비하지 않는다', st.ok === true);
const r5 = await post({ task: 'summarize', text: '본문 5' });
ok('상태 조회 뒤에도 여전히 제한 중', r5.status === 429 && calls === 3);

console.log(`\n${pass} passed, ${fail} failed`);
await app.close();
process.exit(fail ? 1 : 0);
