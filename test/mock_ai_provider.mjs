#!/usr/bin/env node
// 14.23.0 · '가짜 모델 API' — 노트 해돌이를 키 없이 미리 보려고
// ---------------------------------------------------------------------------
//   OpenAI 호환 /v1/chat/completions 만 흉내 낸다. 스트림(stream:true) 도
//   진짜처럼 조각을 흘려 보내서, 해돌이가 '말하는' 모습까지 그대로 확인된다.
//
//   쓰는 법 (터미널 두 개 또는 백그라운드):
//     node test/mock_ai_provider.mjs            # 5399 번에서 가짜 모델 실행
//     AI_PROVIDER=manual AI_KEY=demo AI_BASE_URL=http://127.0.0.1:5399/v1 \
//       AI_MODEL=mock-haedori-1 PORT=5000 node server/src/index.js
//
//   ※ 이건 '돈이 나가는 키' 없이 화면·스트림·캐시를 확인하는 개발용이다.
//     배포 서버에서 쓰지 마라 — 아무 모델도 부르지 않고 답을 지어낸다.
import http from 'node:http';

const PORT = parseInt(process.env.MOCK_AI_PORT || '5399', 10);
const HOST = process.env.MOCK_AI_HOST || '127.0.0.1';
const WORD_MS = parseInt(process.env.MOCK_AI_WORD_MS || '45', 10);   // 조각 간격(ms)
const THINK_MS = parseInt(process.env.MOCK_AI_THINK_MS || '350', 10); // 첫 조각까지

const readBody = (req) => new Promise((res) => {
  let s = '';
  req.on('data', (c) => { s += c; });
  req.on('end', () => res(s));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 노트 본문을 대충 읽어 '그럴듯한' 답을 만든다 — 모델이 아니라 그냥 문장 조립.
// 14.23.0 · 서버 task 는 두 가지 — 개요 정리(outline)와 질문(chat).
//   chat 프롬프트는 [[note]] / [[free]] 판단 표식을 요구하므로 흉내 답도 붙여 준다.
function fakeAnswer(messages = []) {
  const sys = String(messages.find((m) => m.role === 'system')?.content || '');
  const user = String(messages.find((m) => m.role === 'user')?.content || '');
  const note = (user.match(/노트 본문:\n"""([\s\S]*?)"""/) || [, ''])[1].trim();
  const question = (user.match(/질문: (.*)$/m) || [, ''])[1].trim();
  const body = note || question;
  const sentences = body.split(/(?<=[.!?다요]\s)|\n+/).map((s) => s.trim()).filter(Boolean);
  const head = sentences.slice(0, 3).join(' ') || body.slice(0, 60);
  if (/개요\(목차\) 형식/.test(sys)) {
    if (!note) return '정리할 내용이 부족해요';
    const topics = (sentences.length ? sentences : [body]).slice(0, 4);
    return topics.map((t, i) => (i + 1) + '. ' + t.replace(/^[-\d.\s]+/, '').slice(0, 24)
      + '\n  - ' + t.slice(0, 36)).join('\n');
  }
  if (/판단 표식/.test(sys)) {
    // 노트 글자가 질문에 겹치면 노트 질문[[note]], 아니면 자유 질문[[free]] 인 척
    const overlap = note && question
      && question.split(/\s+/).some((w) => w.length >= 2 && note.includes(w.replace(/[??.!,]/g, '')));
    if (overlap) {
      if (/없|모르/.test(body)) return '[[note]]\n노트에는 없는 내용이에요.';
      return '[[note]]\n노트를 볼면 ' + head.slice(0, 90) + ' — 여기까지 적혀 있어요. 해돌~';
    }
    return '[[free]]\n질문 고마워요! ' + (question ? '"' + question.slice(0, 30) + '" 는 ' : '')
      + '지금 노트 흐름대로면 핵심을 먼저 적고 근거를 붙이는 게 좋아요. 해돌~';
  }
  return head.slice(0, 220) + (body.length > 220 ? ' …' : '') + ' — 이 노트는 이런 이야기네요. 해돌~';
}

const server = http.createServer(async (req, res) => {
  const url = String(req.url || '');
  if (req.method === 'GET' && url.startsWith('/v1/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'mock-haedori-1' }] }));
    return;
  }
  if (!(req.method === 'POST' && url.startsWith('/v1/chat/completions'))) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
    return;
  }
  let body = {};
  try { body = JSON.parse(await readBody(req) || '{}'); } catch { /* 빈 본문 */ }
  const text = fakeAnswer(body.messages || []);
  const id = 'chatcmpl-mock';

  if (body.stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    const chunk = (t) => `data: ${JSON.stringify({
      id, object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { content: t }, finish_reason: null }],
    })}\n\n`;
    try {
      await sleep(THINK_MS);                       // '생각하는' 시간
      // 글자 몇 개씩 끊어 흘려 보낸다 — 화면에서 말하듯 붙는지 확인하려고
      const step = 3;
      for (let i = 0; i < text.length; i += step) {
        res.write(chunk(text.slice(i, i + step)));
        await sleep(WORD_MS);
      }
      res.write(`data: ${JSON.stringify({
        id, object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch { /* 클라이언트가 먼저 끊으면 조용히 끝 */ }
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    id, object: 'chat.completion', created: Date.now(), model: body.model || 'mock-haedori-1',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }));
});

server.listen(PORT, HOST, () => {
  console.log(`가짜 모델 API · http://${HOST}:${PORT}/v1  (model: mock-haedori-1)`);
  console.log('─ 실제 모델이 아닙니다. 화면·스트림 확인용 개발 목업 ─');
});
