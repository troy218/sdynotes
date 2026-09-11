/* 14.31.0 · 해돌이 그림·사진 실제 런타임 검증
 * ---------------------------------------------------------------------------
 *   "그림이 너무 크다 · 너무 대충 그린다 · 사진과 그림이 섞인다 · 사진이
 *    안 들어간다" 는 네 가지 불만을 실제 편집기에서 확인한다.
 *
 *   ① 말투 분류 — '사진 넣어 줘'(사진) vs '그려 줘'(그림) vs '옮겨 줘'(편집)
 *   ② 입력 즉시 보라색 — 사진·그림도 문서 편집이라 같은 색으로 알린다
 *   ③ 그림 크기 — 쪽을 반이나 차지하지 않는지(본문 폭의 40%·최대 320px)
 *   ④ 사진 넣기 — /api/ai/imgadd 응답이 실제 사진 요소로 들어가는지
 *   ⑤ 14.36.0 · 참고 일러스트 따라 그리기 — /api/ai/refdraw(진짜 번들)의 선화가
 *      펜 획으로 들어가고, 참고 그림이 없을 때만 모델 직접 그리기로 내려가는지
 *
 *   AI 모델·외부 사진 소스는 부르지 않는다(가짜 응답만 쓴다). */
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import jsdom from 'jsdom';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { installWindowGuard, closeDoms } from './jsdom_guard.mjs';

const { JSDOM, VirtualConsole } = jsdom;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-ai-draw-'));
process.env.SDY_BASE_DIR = TMP;
for (const file of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) {
  fs.copyFileSync(path.join(REPO, file), path.join(TMP, file));
}

let passed = 0;
const check = (name, condition, extra = '') => {
  assert.ok(condition, name + (extra ? ` → ${extra}` : ''));
  passed++;
  console.log('  ✓ ' + name);
};
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

// 스냅샷 한 줄(  id=… type=… x=… y=… w=… h=…)을 좌표로 읽는다.
function boxesOf(snapshot, kind) {
  const out = [];
  for (const line of String(snapshot || '').split('\n')) {
    if (!line.includes('type=' + kind)) continue;
    const num = key => {
      const m = new RegExp(key + '=(-?\\d+(?:\\.\\d+)?)').exec(line);
      return m ? Number(m[1]) : null;
    };
    const x = num('x'), y = num('y'), w = num('w'), h = num('h');
    if ([x, y, w, h].some(v => v == null)) continue;
    out.push({ x, y, w, h });
  }
  return out;
}
function boundingBox(list) {
  if (!list.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const b of list) {
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/src/index.js'], {
  cwd: REPO,
  env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', chunk => { serverLog += chunk; });
child.stderr.on('data', chunk => { serverLog += chunk; });

// 해돌이가 그렸다고 치는 SVG 선화 (가로세로 4:3, viewBox 480x360)
const SAMPLE_SVG = '<svg viewBox="0 0 480 360" xmlns="http://www.w3.org/2000/svg">'
  + '<path fill="none" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"'
  + ' d="M 120 90 Q 240 40 360 90 Q 380 200 300 300 Q 240 340 180 300 Q 100 200 120 90 Z"/>'
  + '<path fill="none" stroke="#1a1a1a" stroke-width="3" d="M 170 170 C 170 150 190 150 190 170"/>'
  + '<path fill="none" stroke="#1a1a1a" stroke-width="3" d="M 290 170 C 290 150 310 150 310 170"/>'
  + '<path fill="none" stroke="#e74c3c" stroke-width="2.5" d="M 210 230 Q 240 260 270 230"/>'
  + '</svg>';

let dom;
try {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('server exited before ready');
    try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* 아직 */ }
    await wait(80);
  }

  const headers = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const db = body => fetch(base + '/api/db/query', {
    method: 'POST', headers, body: JSON.stringify(body),
  }).then(response => response.json());
  const inserted = await db({
    table: 'notebooks', op: 'insert', values: [{ title: 'AI 그림·사진 런타임', color: '#4f6ef7' }],
    filters: [], returning: true, single: true,
  });
  const notebookId = inserted.data.id;
  const original = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'page-1', els: [
      { type: 'text', id: 'title-box', x: 40, y: 50, w: 300, h: 60, html: '고양이', fontSize: 16 },
    ], tables: [] }],
  };
  await db({
    table: 'memos', op: 'insert',
    values: [{ notebook_id: notebookId, content: JSON.stringify(original), font_size: 16 }], filters: [],
  });

  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => {
    const message = String(error?.message || error);
    if (!/HTMLMediaElement|Could not load (link|script|img)|Not implemented/.test(message)) errors.push(message);
  });
  virtualConsole.on('error', (...args) => {
    const message = args.join(' ');
    if (!/Could not load|Not implemented|Error: Not implemented/.test(message)) errors.push(message);
  });
  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
    beforeParse(window) {
      installWindowGuard(window);
      window.innerWidth = 1280; window.innerHeight = 800;
      window.matchMedia = query => ({ matches: query.includes('pointer:fine'), media: query,
        addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.BroadcastChannel = class { postMessage(){} close(){} addEventListener(){} };
      window.EventSource = class { close(){} addEventListener(){} };
      window.cancelIdleCallback = clearTimeout;
      window.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 0);
      window.cancelAnimationFrame = clearTimeout;
      window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect(){}, drawImage(){}, fillRect(){},
        beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, arc(){}, fill(){}, save(){}, restore(){},
        scale(){}, translate(){}, setTransform(){}, measureText(){ return { width: 10 }; },
        getImageData(){ return { data: new Uint8ClampedArray(4) }; }, putImageData(){} });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class { constructor(){ this.paused = true; } play(){ return Promise.resolve(); }
        pause(){} addEventListener(){} removeEventListener(){} };
      window.URL.createObjectURL = () => 'blob:test';
      window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL
          ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
      window.addEventListener('error', event => errors.push(event.error?.stack || event.message));
      window.addEventListener('unhandledrejection', event => errors.push('unhandled: ' + event.reason));
    },
  });

  const { window } = dom;
  const { document } = window;
  const bootDeadline = Date.now() + 8_000;
  let card;
  while (Date.now() < bootDeadline) {
    card = [...document.querySelectorAll('.note-stack .note-card,.pro-grid .note-card')]
      .find(node => (node.textContent || '').includes('AI 그림·사진 런타임'));
    if (card) break;
    await wait(60);
  }
  check('테스트 노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const openDeadline = Date.now() + 8_000;
  while (Date.now() < openDeadline) {
    if (document.getElementById('editorView').classList.contains('open')
      && window.__sdyAiBridge?.capture) break;
    await wait(60);
  }
  await wait(700);
  check('실제 편집기와 AI bridge가 열린다',
    document.getElementById('editorView').classList.contains('open')
    && typeof window.__sdyAiBridge?.apply === 'function');

  // ── ① 말투 분류 — 사진 vs 그림 vs 편집 ──────────────────────────────────
  const photo = window.sdyAiLooksLikePhoto, draw = window.sdyAiLooksLikeDraw;
  check('사진: "고양이 사진 넣어 줘" → 사진', !!photo('고양이 사진 넣어 줘'));
  check('사진: "고양이 이미지 추가해 줘" → 사진', !!photo('고양이 이미지 추가해 줘'));
  check('사진: "○○ 설명하고 그 아래 사진도 넣어 줘" → 사진',
    !!photo('고양이에 대해 설명하고 그 아래에 고양이를 잘 나타내는 사진을 넣을 수 있도록 해 줘'));
  check('그림: "고양이 그려 줘" → 사진이 아니다', !photo('고양이 그려 줘'));
  check('그림: "귀엽게 고양이 그려 줘" → 그림', !!draw('귀엽게 고양이 그려 줘'));
  check('그림: "고양이 일러스트 그려 줘" → 그림', !!draw('고양이 일러스트 그려 줘'));
  check('사진: "고양이 사진 그려 줘" → 그림(사진 아님)',
    !photo('고양이 사진 그려 줘') && !!draw('고양이 사진 그려 줘'));
  check('편집: "표 그려 줘"는 문서 편집(그림 아님)', !draw('표 그려 줘'));
  check('질문: "고양이 사진 어디서 구해?" 는 사진 요청이 아니다', !photo('고양이 사진 어디서 구해?'));

  // ── ② 입력하는 동안 보라색 + 딱지 ───────────────────────────────────────
  const qEl = document.getElementById('aiQ');
  const askEl = document.getElementById('aiAsk');
  const tagEl = document.getElementById('aiEditTag');
  const typeIt = async (text) => {
    qEl.value = text;
    qEl.dispatchEvent(new window.Event('input', { bubbles: true }));
    await wait(60);
    return { purple: askEl.classList.contains('edit-on'), tag: tagEl ? tagEl.textContent : '' };
  };
  let mode = await typeIt('고양이 사진 넣어 줘');
  check('사진 요청을 적으면 검색창이 바로 보라색(편집 모드)이 된다', mode.purple);
  check('사진 요청에는 "사진" 딱지가 붙는다', mode.tag === '사진', mode.tag);
  mode = await typeIt('고양이 그려 줘');
  check('그림 요청도 검색창이 바로 보라색이 된다', mode.purple);
  check('그림 요청에는 "그림" 딱지가 붙는다', mode.tag === '그림', mode.tag);
  mode = await typeIt('제목을 맨 위로 옮겨 줘');
  check('편집 요청에는 "편집" 딱지가 붙는다', mode.purple && mode.tag === '편집', mode.tag);
  mode = await typeIt('안녕 해돌아');
  check('그냥 인사에는 보라색이 아니다', !mode.purple, mode.tag);
  qEl.value = '';
  qEl.dispatchEvent(new window.Event('input', { bubbles: true }));

  // ── ③ 그림 크기 — 쪽을 반이나 차지하지 않는지 ───────────────────────────
  const parsed = window.sdyAiDrawParse(SAMPLE_SVG);
  check('SVG 선화를 펜 획으로 바꾼다', parsed.ok && parsed.ops.length === 1 && parsed.strokes > 0,
    JSON.stringify({ ok: parsed.ok, strokes: parsed.strokes }));

  // 유기적인 자유 곡선(3차 베지어 C·S·Q) 파싱 및 부드러운 샘플링 검증
  const organicSvg = '<svg viewBox="0 0 480 360" xmlns="http://www.w3.org/2000/svg">'
    + '<path fill="none" stroke="#1a1a1a" stroke-width="3" d="M 50 150 C 90 80 140 220 200 150 S 290 80 340 160 Q 390 240 440 150"/>'
    + '</svg>';
  const parsedOrganic = window.sdyAiDrawParse(organicSvg);
  check('자유 곡선(C·S·Q)이 부드럽고 촘촘하게 샘플링된다',
    parsedOrganic.ok && parsedOrganic.strokes === 1 && parsedOrganic.ops[0].strokes[0].pts.length >= 30,
    JSON.stringify({ ptsCount: parsedOrganic.ops[0]?.strokes[0]?.pts?.length }));

  const before = boxesOf(window.__sdyAiBridge.capture().text, '그림획').length;
  const drawRes = window.__sdyAiBridge.apply(parsed.ops);
  await wait(200);
  const strokes = boxesOf(window.__sdyAiBridge.capture().text, '그림획');
  check('펜 획이 문서에 들어간다', strokes.length > before, `${before} → ${strokes.length}`);
  const bb = boundingBox(strokes);
  const pageW = 800;   // a4_portrait
  check('그림이 쪽 폭의 40%를 넘지 않는다', bb && bb.w <= Math.round(pageW * 0.42),
    bb ? `${Math.round(bb.w)}px / ${pageW}px` : 'no box');
  check('그림이 최대 320px을 넘지 않는다', bb && bb.w <= 320, bb ? String(Math.round(bb.w)) : 'no box');
  check('그림 높이도 360px을 넘지 않는다', bb && bb.h <= 362, bb ? String(Math.round(bb.h)) : 'no box');
  check('그림이 페이지 안에 들어간다', bb && bb.x >= 0 && bb.y >= 0 && (bb.x + bb.w) <= pageW,
    bb ? JSON.stringify(bb) : 'no box');
  check('그림 적용 결과가 보고된다', !drawRes || (drawRes.applied|0) >= 1, JSON.stringify(drawRes));

  // ── ④ 사진 넣기 — 서버 응답이 실제 사진 요소로 들어가는지 ───────────────
  const realFetch = window.fetch;
  const imgCalls = [];
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : String((input && input.url) || input);
    if (url.indexOf('/api/ai/imgadd') >= 0) {
      imgCalls.push(JSON.parse(String((init && init.body) || '{}')));
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ ok: true, url: '/api/img/ai_runtime_cat.webp',
          public_id: 'ai_runtime_cat.webp', width: 800, height: 600,
          title: 'Cat sitting on a sofa', license: 'CC BY-SA 4.0' }),
      });
    }
    return realFetch(input, init);
  };
  const photoBefore = boxesOf(window.__sdyAiBridge.capture().text, '사진').length;
  window.sdyAiRunPhoto('고양이 사진 넣어 줘');
  const photoDeadline = Date.now() + 6_000;
  while (Date.now() < photoDeadline) {
    if (boxesOf(window.__sdyAiBridge.capture().text, '사진').length > photoBefore) break;
    await wait(80);
  }
  const photoBoxes = boxesOf(window.__sdyAiBridge.capture().text, '사진');
  check('사진 요청이 서버 사진 찾기(/api/ai/imgadd)를 부른다', imgCalls.length === 1,
    JSON.stringify(imgCalls));
  check('찾을 사진을 요청 문장 그대로 넘긴다(서버가 검색어를 다듬는다)',
    imgCalls[0] && /고양이/.test(String(imgCalls[0].q || '')), JSON.stringify(imgCalls[0]));
  check('돌려받은 사진이 노트에 들어간다', photoBoxes.length > photoBefore,
    `${photoBefore} → ${photoBoxes.length}`);
  check('사진이 쪽 안에 적당한 크기로 들어간다',
    photoBoxes.length > 0 && photoBoxes.every(b => b.w > 60 && b.w <= pageW),
    JSON.stringify(photoBoxes[photoBoxes.length - 1] || null));
  const said = String((document.getElementById('aiOut') || {}).textContent || '');
  check('사진을 넣었다고 말해 준다', /사진을 넣었어요/.test(said), said.slice(0, 80));
  window.fetch = realFetch;

  // ── ⑤ 14.36.0 · 참고 일러스트를 따라 그리기 — 실제 서버 번들 → 펜 획 ───────
  //   "고양이 그려 줘"는 모델을 부르기 전에 /api/ai/refdraw(진짜 서버·진짜 번들)로
  //   참고 선화를 받아 그 윤곽을 펜 획으로 옮긴다. 모델(/api/ai/ask)은 부르지 않는다.
  const askCalls = [];
  const refCalls = [];
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : String((input && input.url) || input);
    if (url.indexOf('/api/ai/ask') >= 0) {
      askCalls.push(JSON.parse(String((init && init.body) || '{}')));
      // 모델 직접 그리기(대체 경로)에 대한 가짜 답 — SAMPLE_SVG 를 SSE 로 흘린다
      const body = `event: meta\ndata: {"cached":false}\n\nevent: delta\ndata: ${JSON.stringify({ t: SAMPLE_SVG })}\n\nevent: done\ndata: ${JSON.stringify({ text: SAMPLE_SVG, task: 'draw' })}\n\n`;
      const enc = new TextEncoder().encode(body);
      let sent = false;
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'text/event-stream' },
        body: { getReader: () => ({ read: () => Promise.resolve(sent ? { done: true } : (sent = true, { done: false, value: enc })) }) } });
    }
    if (url.indexOf('/api/ai/refdraw') >= 0) refCalls.push(JSON.parse(String((init && init.body) || '{}')));
    return realFetch(input, init);
  };
  const strokesBefore = boxesOf(window.__sdyAiBridge.capture().text, '그림획').length;
  qEl.value = '귀여운 고양이 그려 줘';
  qEl.dispatchEvent(new window.Event('input', { bubbles: true }));
  window.sdyAiRun();
  const refDeadline = Date.now() + 8_000;
  while (Date.now() < refDeadline) {
    if (boxesOf(window.__sdyAiBridge.capture().text, '그림획').length > strokesBefore) break;
    await wait(80);
  }
  await wait(150);
  const refStrokes = boxesOf(window.__sdyAiBridge.capture().text, '그림획');
  check('"고양이 그려 줘"는 먼저 참고 그림(/api/ai/refdraw)을 찾는다', refCalls.length === 1 && /고양이/.test(String(refCalls[0].q || '')),
    JSON.stringify(refCalls));
  check('참고 그림이 있으면 모델(/api/ai/ask)은 부르지 않는다', askCalls.length === 0, JSON.stringify(askCalls.map(a => a.task)));
  check('참고 선화의 윤곽이 펜 획으로 문서에 들어간다', refStrokes.length > strokesBefore, `${strokesBefore} → ${refStrokes.length}`);
  const refBox = boundingBox(refStrokes.slice(strokesBefore));
  check('따라 그린 그림도 크기 규약(폭 ≤ 320px)을 지킨다', refBox && refBox.w <= 320 && refBox.h <= 362, JSON.stringify(refBox));
  const saidRef = String((document.getElementById('aiOut') || {}).textContent || '');
  check('완료 말풍선은 참고 대상·출처 표시 없이 그린 결과만 알려 준다', /고양이/.test(saidRef)
    && /컬러 펜/.test(saidRef) && !/참고|OpenMoji|CC BY/.test(saidRef), saidRef.slice(0, 120));
  check('그림 딱지가 붙는다', (document.getElementById('aiKind') || {}).textContent === '그림');

  // 말풍선이 떠 있고 질문칸 포커스가 남아 있어도 종이의 그림을 누르는 순간
  // 키보드 소유권은 노트로 돌아와야 한다. 그래야 Delete/Ctrl+Z가 대화칸이 아닌
  // 방금 고른 그림에 적용된다.
  qEl.focus();
  const drawnNodes = [...document.querySelectorAll('#pagesStage .stroke-g')];
  const pickedStroke = drawnNodes[strokesBefore];
  assert.ok(pickedStroke, '방금 그린 펜 획 노드가 있다');
  const hit = pickedStroke.querySelector('.stroke-hit') || pickedStroke;
  hit.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1, clientX: 180, clientY: 180 }));
  document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientX: 180, clientY: 180 }));
  await wait(80);
  check('말풍선이 떠 있어도 그림을 누르면 해돌이 입력 포커스가 빠진다', document.activeElement !== qEl
    && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#aiAsk,#aiSay,#aiHist')));
  const selectedCount = boxesOf(window.__sdyAiBridge.capture().text, '그림획').length;
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  await wait(150);
  check('그림 선택 뒤 Delete는 노트의 해당 그림 획을 지운다',
    boxesOf(window.__sdyAiBridge.capture().text, '그림획').length === selectedCount - 1);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
  await wait(180);
  check('종이를 누른 뒤 Ctrl+Z도 대화가 아니라 노트 편집을 되돌린다',
    boxesOf(window.__sdyAiBridge.capture().text, '그림획').length === selectedCount);

  // 참고 그림이 없는 주제 → 예전처럼 모델이 직접 그린다(대체 경로)
  const fbBefore = boxesOf(window.__sdyAiBridge.capture().text, '그림획').length;
  refCalls.length = 0; askCalls.length = 0;
  qEl.value = '/그림 zzqq 존재하지 않는 것';
  qEl.dispatchEvent(new window.Event('input', { bubbles: true }));
  window.sdyAiRun();
  const fbDeadline = Date.now() + 8_000;
  while (Date.now() < fbDeadline) {
    if (boxesOf(window.__sdyAiBridge.capture().text, '그림획').length > fbBefore) break;
    await wait(80);
  }
  await wait(150);
  check('참고 그림이 없으면(404) 모델 직접 그리기(task=draw)로 내려간다',
    refCalls.length === 1 && askCalls.length === 1 && askCalls[0].task === 'draw', JSON.stringify(askCalls.map(a => a.task)));
  check('대체 경로에서도 그림이 문서에 들어간다', boxesOf(window.__sdyAiBridge.capture().text, '그림획').length > fbBefore);
  window.fetch = realFetch;

  check('실제 그리기·사진 넣기 중 치명적 브라우저 오류가 없다', errors.length === 0,
    errors.slice(0, 2).join(' | '));
} finally {
  await closeDoms([dom]);
  child.kill('SIGTERM');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 정리 실패는 무시 */ }
}

console.log(`\n  ${passed}개 통과 · 해돌이 그림·사진 런타임`);
