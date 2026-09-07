// 14.34.1 · 해돌이 그림 '참고 일러스트 보고 그리기(윤곽선 따기)' 런타임 계약
// ---------------------------------------------------------------------------
//   "윤곽선 따는 모듈로 바꿨는데 여전히 예전 방식으로 그린다"의 원인이었던
//   fetchDrawReference 캐시 버그(hit.data → undefined → 조용히 텍스트 폴백)가
//   다시 살아나지 않는지 실제 /api/ai/ask(task=draw) 경로로 검증한다.
//   모델·커먼즈·오픈버스는 전부 가짜 fetch 로 갈아끼운다(외부 호출 0).
//
//   이 파일이 지키려는 계약
//   1) 참고를 찾으면 모델 요청 user 메시지에 image_url 이 실린다(스트림·비스트림 둘 다)
//   2) 같은 요청의 두 번째 그림도 캐시에서 '제대로 된 참고'를 받아 윤곽선 따기로
//      그린다 — 캐시 히트가 undefined 가 되어 예전 방식으로 폴백하지 않는다
//   3) 같은 요청 재사용 때는 참고를 다시 검색하지 않는다(10분 캐시)
//   4) 참고 검색이 실패해도 그림 자체는 성공한다(이미지 없는 텍스트 폴백)
//   5) 모델이 이미지를 거부(400)하면 참고 없이 한 번 더 그린다
//   6) 검색어 AI(imgq)가 못 답해도 정제·번역 경로로 참고를 찾는다
import assert from 'node:assert/strict';
import net from 'node:net';

// ── 가짜 외부 세계 ─────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
const aiCalls = [];    // 모델 API 호출 기록 { sys, hasImage }
const ext = [];        // 외부(커먼즈·오픈버스·이미지) 호출 기록
const SIM = {
  search: 'good',        // good | fail
  imgq: 'ok',            // ok | empty
  rejectImage: false,    // true 면 이미지 포함 요청을 400 으로 거부
};
let JPEG = null;         // 참고 이미지 내려받기용 진짜 JPEG 버퍼

const json200 = (j) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });
const SVG_OK = '<svg viewBox="0 0 480 360" xmlns="http://www.w3.org/2000/svg">'
  + '<path stroke="#1a1a1a" stroke-width="2" fill="none" d="M 140 120 C 170 90 230 90 260 120 S 300 180 260 210"/>'
  + '</svg>';

// 실제 커먼즈 API 응답 모양(2026-09 실측 축약) — 제목·설명·분류가 점수에 쓰인다.
function commonsPage(id, title, w, h, desc, cats) {
  return {
    pageid: id, ns: 6, title,
    imageinfo: [{
      size: 100000, width: w, height: h, mime: 'image/jpeg',
      url: `https://upload.wikimedia.org/wikipedia/commons/x/${id}/${encodeURIComponent(title.replace(/^File:/, ''))}`,
      thumburl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/x/${id}/${encodeURIComponent(title.replace(/^File:/, ''))}/1400px-x.jpg`,
      descriptionurl: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')),
      extmetadata: {
        LicenseShortName: { value: 'Public domain' },
        ImageDescription: { value: desc },
        Categories: { value: cats },
      },
    }],
  };
}
const COMMONS_GOOD = { batchcomplete: '', query: { pages: {
  1: commonsPage(1, 'File:Cat illustration.jpg', 1200, 900, 'A cute cat illustration', 'Cat illustrations|Cute animals'),
  2: commonsPage(2, 'File:"The Cheshire cat sitting on the bough of a tree.".jpg', 1832, 2776,
    'Illustrations from Alice in Wonderland 1917', 'Cheshire Cat|20th-century illustrations of cats'),
  3: commonsPage(3, 'File:Black cat at work.jpg', 1012, 1409, 'A black cat', 'Cats|Black cats'),
} } };

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(u, opts);   // 테스트 서버는 진짜로

  // 모델 API(OpenAI 호환) — 요청을 기록하고 imgq/그림 답을 흉내 낸다.
  if (u.includes('/chat/completions')) {
    const body = JSON.parse(opts.body);
    const sys = String((body.messages || []).find((m) => m.role === 'system')?.content || '');
    const user = (body.messages || []).find((m) => m.role === 'user');
    const hasImage = Array.isArray(user?.content) && user.content.some((c) => c.type === 'image_url');
    if (sys.includes('펜 그림 엔진')) aiCalls.push({ draw: true, hasImage });
    if (SIM.rejectImage && hasImage) {
      return new Response(JSON.stringify({ error: { message: 'Unsupported media type' } }), { status: 400 });
    }
    let text = '무슨 일이든 도와드릴게요';
    if (sys.includes('사진 검색어')) text = SIM.imgq === 'ok' ? 'cat\ndomestic cat\nfelidae' : '';
    else if (sys.includes('펜 그림 엔진')) text = SVG_OK;
    if (body.stream) {
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return json200({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: null }] });
  }

  // 커먼즈 검색
  if (u.includes('commons.wikimedia.org')) {
    ext.push('commons');
    if (SIM.search === 'fail') return new Response('boom', { status: 500 });
    return json200(COMMONS_GOOD);
  }
  // 오픈버스 검색
  if (u.includes('api.openverse.org')) { ext.push('openverse'); return json200({ results: [] }); }
  // 참고 이미지 내려받기
  if (/(upload|thumb)\.wikimedia\.org/.test(u)) { ext.push('img'); return new Response(JPEG, { status: 200 }); }
  // 무료 번역(검색어 AI 가 못 답할 때의 대체 경로) — 실패로 둔다
  ext.push('other');
  return new Response('', { status: 404 });
};

process.env.AI_KEY = 'sk-test-draw-ref';
process.env.AI_BASE_URL = 'https://ai.example.test/v1';
process.env.AI_MODEL = 'gemini-2.5-flash';      // drawRefAllowed 를 통과하는 멀티모달 모델
process.env.AI_RATE_N = '1000';                 // 이 파일에선 레이트리밋을 사실상 끈다
process.env.AI_RATE_WINDOW_MS = '60000';

// 참고 이미지용 진짜 JPEG(512B 이상이어야 downloadImage 가 받아들인다)
{
  const sharp = (await import('sharp')).default;
  JPEG = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 240, g: 240, b: 240 } } })
    .jpeg({ quality: 80 }).toBuffer();
  assert.ok(JPEG.length > 512, '테스트용 JPEG 가 너무 작다');
}

const ai = await import('../server/src/routes/ai.js');
const { default: Fastify } = await import('fastify');
const app = Fastify({ logger: false });
ai.registerAi(app);
const freePort = () => new Promise((res) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const PORT = await freePort();
await app.listen({ port: PORT, host: '127.0.0.1' });
const BASE = 'http://127.0.0.1:' + PORT;

async function askDraw(question, stream = false) {
  if (!stream) {
    const r = await fetch(BASE + '/api/ai/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'draw', text: '', question }),
    });
    return r.json();
  }
  // stream done 이벤트에는 ok 필드가 없다(프런트 readSSE 가 ok:true 를 합성한다)
  const r = await fetch(BASE + '/api/ai/ask', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'draw', text: '', question, stream: true }),
  });
  const text = await r.text();
  const done = text.match(/event: done\ndata: (.*)/);
  return done ? Object.assign({ ok: true }, JSON.parse(done[1])) : { ok: false };
}
const drawCalls = () => aiCalls.filter((c) => c.draw);
const commonsCalls = () => ext.filter((u) => u === 'commons').length;
const reset = () => { aiCalls.length = 0; ext.length = 0; };

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' → ' + extra : ''}`); };

// ── 1) 스트림(프런트가 실제 쓰는 경로): 첫 그림은 참고를 보고 그린다 ──
reset();
let r = await askDraw('고양이 그려 줘', true);
ok('스트림 그림 성공', r.ok === true && String(r.text).includes('<svg'));
ok('첫 요청: 모델이 참고 이미지를 받는다', drawCalls().length === 1 && drawCalls()[0].hasImage === true);
ok('첫 요청: 커먼즈에서 참고를 찾았다', commonsCalls() >= 1);
const before = commonsCalls();

// ── 2) ★회귀: 같은 요청의 두 번째 그림도 참고를 보고 그린다 ──
//    (예전 버그: 캐시 히트가 hit.data → undefined 를 돌려줘 '예전 방식'으로 폴백)
reset();
r = await askDraw('고양이 그려 줘', true);
ok('같은 요청 재요청: 그림 성공', r.ok === true && String(r.text).includes('<svg'));
ok('★같은 요청 재요청: 참고 이미지를 계속 받는다(캐시 폴백 버그 회귀)',
  drawCalls().length === 1 && drawCalls()[0].hasImage === true,
  drawCalls().map((c) => (c.hasImage ? '이미지' : '텍스트')).join(','));
ok('같은 요청 재요청: 참고를 다시 검색하지 않는다(10분 캐시)', commonsCalls() === 0);

// ── 3) 비스트림 요청도 참고를 보고 그린다 ──
reset();
r = await askDraw('고양이 한 마리 그려 줘');
ok('비스트림 그림 성공', r.ok === true && String(r.text).includes('<svg'));
ok('비스트림: 참고 이미지를 받는다', drawCalls().length === 1 && drawCalls()[0].hasImage === true);

// ── 4) 참고 검색이 실패해도 그림은 성공(이미지 없는 예전 방식 폴백) ──
SIM.search = 'fail'; reset();
r = await askDraw('토끼 그려 줘', true);
ok('검색 실패에도 그림은 성공(두 겹 폴백 ①)', r.ok === true && String(r.text).includes('<svg'));
ok('검색 실패: 이미지 없이 텍스트로만 그린다', drawCalls().length === 1 && drawCalls()[0].hasImage === false);
SIM.search = 'good';

// ── 5) 모델이 이미지를 거부(400)하면 참고 없이 다시 그린다(두 겹 폴백 ②) ──
SIM.rejectImage = true; reset();
r = await askDraw('펭귄 그려 줘', true);
ok('400 거부에도 그림은 성공', r.ok === true && String(r.text).includes('<svg'));
ok('400 거부: 이미지 시도 → 텍스트 재시도',
  drawCalls().length === 2 && drawCalls()[0].hasImage === true && drawCalls()[1].hasImage === false,
  drawCalls().map((c) => (c.hasImage ? '이미지' : '텍스트')).join(' → '));
SIM.rejectImage = false;

// ── 6) 검색어 AI(imgq)가 못 답해도 정제 검색어로 참고를 찾는다 ──
SIM.imgq = 'empty'; reset();
r = await askDraw('다람쥐 그려 줘', true);
ok('imgq 공백: 그림 성공', r.ok === true && String(r.text).includes('<svg'));
ok('imgq 공백: 정제 검색어로 참고를 찾아 이미지를 보낸다',
  drawCalls().length === 1 && drawCalls()[0].hasImage === true,
  '커먼즈 검색 ' + commonsCalls() + '회');
SIM.imgq = 'ok';

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
await app.close();
process.exit(fail ? 1 : 0);
