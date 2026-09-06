/* 20.3 · 되돌리기(Ctrl+Z) 재설계 런타임 검증
   ---------------------------------------------------------------------------
   실제 서버 + 실제 편집기(JSDOM)를 띄우고, 다른 기기(다른 dev id)의 편집을
   /api/sync/push 로 밀어 넣어 '같이 편집하는 상황'을 진짜로 만든다.

   1) 되돌리기가 남의 작업을 먹지 않는다
      · 내가 A 상자를 고친 뒤, 다른 사람이 B 상자를 고치고 C 상자를 새로 만든다.
      · 내가 Ctrl+Z → A 만 원래대로. B 의 남의 편집과 C 는 그대로 살아 있다.
   2) 되돌린 결과가 서버로 올라간다 (예전엔 rehashAll 이 전송을 막아
      다음 pull 이 되돌리기 전 내용을 도로 끌고 왔다)
   3) 되돌리기 사다리가 헛돌지 않는다 — 여러 번 눌러도 계속 한 단계씩 간다
   4) 되돌리기 뒤 다시 실행(Ctrl+Shift+Z)이 그 작업만 복구한다
   5) 스크립트 편집(해돌이 apply)은 글상자에 커서가 있어도 앱 되돌리기가 받는다 */
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import jsdom from 'jsdom';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { installWindowGuard, closeDoms } from './jsdom_guard.mjs';

const { JSDOM, VirtualConsole } = jsdom;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-undo-collab-'));
process.env.SDY_BASE_DIR = TMP;
for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) {
  fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
}

let passed = 0;
const check = (name, cond, extra = '') => {
  assert.ok(cond, name + (extra ? ` → ${extra}` : ''));
  passed++;
  console.log('  ✓ ' + name);
};
async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/src/index.js'], {
  cwd: REPO,
  env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (c) => { serverLog += c; });
child.stderr.on('data', (c) => { serverLog += c; });

let dom;
try {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('server exited before ready');
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }

  const headers = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const db = (body) => fetch(base + '/api/db/query', {
    method: 'POST', headers, body: JSON.stringify(body),
  }).then((r) => r.json());
  const inserted = await db({
    table: 'notebooks', op: 'insert', values: [{ title: '되돌리기 협업', color: '#4f6ef7' }],
    filters: [], returning: true, single: true,
  });
  const nbId = inserted.data.id;
  const mkText = (id, y, html) => ({ type: 'text', id, x: 40, y, w: 300, h: 60, html, fontSize: 16 });
  const original = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'page-1', els: [mkText('box-a', 40, '내 상자'), mkText('box-b', 140, '남의 상자')], tables: [] }],
  };
  await db({
    table: 'memos', op: 'insert',
    values: [{ notebook_id: nbId, content: JSON.stringify(original), font_size: 16 }], filters: [],
  });

  // 다른 기기(dev id 가 다른 '남')가 서버에 올리는 편집
  let peerRev = Date.now() + 1_000_000;
  const peerPush = (ops) => fetch(base + '/api/sync/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nb: String(nbId), ops }),
  }).then((r) => r.json());
  const peerPut = (el, page = 0) => peerPush([{
    id: el.id, kind: 'put', page, rev: ++peerRev, data: el, dev: 'peer-device',
  }]);
  const serverEl = async (id) => {
    const r = await fetch(base + `/api/sync/pull?nb=${encodeURIComponent(nbId)}&since=0`);
    const d = await r.json();
    const op = (d.ops || []).filter((o) => o.id === id).sort((a, b) => (a.rev || 0) - (b.rev || 0)).pop();
    return op && op.data ? op.data : null;
  };

  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => {
    const m = String(e?.message || e);
    if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errors.push(m);
  });
  virtualConsole.on('error', (...a) => errors.push(a.join(' ')));
  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
    beforeParse(window) {
      installWindowGuard(window);
      window.innerWidth = 1280; window.innerHeight = 800;
      window.matchMedia = (q) => ({ matches: q.includes('pointer:fine'), media: q,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.BroadcastChannel = class { postMessage() {} close() {} addEventListener() {} };
      window.EventSource = class { close() {} addEventListener() {} };
      window.cancelIdleCallback = clearTimeout;
      window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
      window.cancelAnimationFrame = clearTimeout;
      window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {}, fillRect() {},
        beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}, save() {}, restore() {},
        scale() {}, translate() {}, setTransform() {}, measureText() { return { width: 10 }; },
        getImageData() { return { data: new Uint8ClampedArray(4) }; }, putImageData() {} });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class { constructor() { this.paused = true; } play() { return Promise.resolve(); }
        pause() {} addEventListener() {} removeEventListener() {} };
      window.URL.createObjectURL = () => 'blob:test';
      window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      window.fetch = (input, init) => {
        const t = typeof input === 'string' || input instanceof URL
          ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(t, init);
      };
      window.addEventListener('error', (ev) => errors.push(ev.error?.stack || ev.message));
      window.addEventListener('unhandledrejection', (ev) => errors.push('unhandled: ' + ev.reason));
    },
  });

  const { window } = dom;
  const { document } = window;
  const boot = Date.now() + 8000;
  let card;
  while (Date.now() < boot) {
    card = [...document.querySelectorAll('.note-stack .note-card')]
      .find((n) => (n.textContent || '').includes('되돌리기 협업'));
    if (card) break;
    await wait(60);
  }
  check('테스트 노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const openAt = Date.now() + 8000;
  while (Date.now() < openAt) {
    if (document.getElementById('editorView').classList.contains('open') && window.__sdyAiBridge?.apply) break;
    await wait(60);
  }
  await wait(700);
  check('편집기가 열린다', document.getElementById('editorView').classList.contains('open'));

  const el = (id) => window.findEl(0, id);
  const ctrlZ = (shift = false) => document.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: shift ? 'Z' : 'z', ctrlKey: true, shiftKey: shift, bubbles: true, cancelable: true,
  }));
  const els = () => window.__sdyTranslate.getDoc().pages[0].els;

  // ── ① 내 편집 → 남의 편집(다른 상자 수정 + 새 상자) → 내 Ctrl+Z ──
  const cap1 = window.__sdyAiBridge.capture();
  window.__sdyAiBridge.apply([{ cmd: 'tx', id: 'box-a', text: '내가 고친 A' }], cap1.revision);
  await wait(400);
  check('내 편집이 반영된다', /내가 고친 A/.test(el('box-a').html));

  await peerPut({ ...mkText('box-b', 140, '남이 고친 B'), fontSize: 16 });
  await peerPut(mkText('box-c', 240, '남이 새로 만든 C'));
  // 실시간 동기화가 남의 편집을 받아올 때까지 기다린다
  const gotPeer = Date.now() + 12_000;
  while (Date.now() < gotPeer) {
    if (el('box-c') && /남이 고친 B/.test(el('box-b')?.html || '')) break;
    await wait(150);
  }
  check('다른 기기의 편집(수정 + 새 상자)이 내 화면에 들어온다',
    /남이 고친 B/.test(el('box-b').html) && /남이 새로 만든 C/.test(el('box-c')?.html || ''));

  ctrlZ();
  await wait(600);
  check('되돌리기는 내 변경(A)만 원래대로 돌린다', el('box-a').html === '내 상자',
    el('box-a').html);
  check('되돌리기가 다른 사람이 고친 상자(B)를 덮어쓰지 않는다',
    /남이 고친 B/.test(el('box-b').html), el('box-b').html);
  check('되돌리기가 다른 사람이 새로 만든 상자(C)를 지우지 않는다',
    !!el('box-c') && /남이 새로 만든 C/.test(el('box-c').html));

  // ── ② 되돌린 결과가 서버에도 올라간다 ──
  const upAt = Date.now() + 12_000;
  let pushedBack = null;
  while (Date.now() < upAt) {
    pushedBack = await serverEl('box-a');
    if (pushedBack && pushedBack.html === '내 상자') break;
    await wait(200);
  }
  check('되돌린 내용이 서버로 올라가 다른 기기에도 반영된다',
    !!pushedBack && pushedBack.html === '내 상자',
    JSON.stringify(pushedBack && pushedBack.html));

  // ── ③ 다시 실행 ──
  ctrlZ(true);
  await wait(500);
  check('다시 실행이 내 변경만 복구한다',
    /내가 고친 A/.test(el('box-a').html) && /남이 고친 B/.test(el('box-b').html) && !!el('box-c'));

  // ── ④ 여러 번 눌러도 사다리가 한 칸씩 정확히 내려간다 ──
  const beforeSteps = els().length;
  for (const t of ['1단계', '2단계', '3단계']) {
    const cap = window.__sdyAiBridge.capture();
    window.__sdyAiBridge.apply([{ cmd: 'tx', id: 'box-a', text: t }], cap.revision);
    await wait(320);
  }
  check('연속 편집 3번이 모두 반영된다', el('box-a').html === '3단계', el('box-a').html);
  ctrlZ(); await wait(350);
  check('되돌리기 1번 → 2단계', el('box-a').html === '2단계', el('box-a').html);
  ctrlZ(); await wait(350);
  check('되돌리기 2번 → 1단계 (헛돌지 않는다)', el('box-a').html === '1단계', el('box-a').html);
  ctrlZ(); await wait(350);
  check('되돌리기 3번 → 그 이전 상태', /내가 고친 A/.test(el('box-a').html), el('box-a').html);
  check('되돌리는 동안 남의 상자 수는 유지된다', els().length === beforeSteps);

  // ── ⑤ 글상자에 커서가 있어도 스크립트(해돌이) 편집은 앱이 되돌린다 ──
  const node = document.querySelector('#pagesStage .tb[data-id="box-a"]');
  check('A 상자 DOM 이 있다', !!node);
  node.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await wait(250);
  const cap5 = window.__sdyAiBridge.capture();
  window.__sdyAiBridge.apply([{ cmd: 'tx', id: 'box-b', text: '해돌이가 고친 B' }], cap5.revision);
  await wait(400);
  const b5 = el('box-b').html;
  check('해돌이 편집이 반영된다', /해돌이가 고친 B/.test(b5), b5);
  ctrlZ();
  await wait(500);
  check('글상자에 커서가 있어도 해돌이 편집은 Ctrl+Z 로 되돌아간다',
    !/해돌이가 고친 B/.test(el('box-b').html), el('box-b').html);

  const fatal = errors.filter(Boolean);
  check('되돌리기 흐름에 치명적 브라우저 오류가 없다', fatal.length === 0, fatal.slice(0, 2).join('\n'));
  console.log(`\n되돌리기 협업 런타임: PASS ${passed} / FAIL 0`);
} catch (error) {
  console.error('\n되돌리기 협업 런타임 실패:', error);
  if (serverLog) console.error('\nserver log:\n' + serverLog.slice(-2500));
  process.exitCode = 1;
} finally {
  await wait(80);
  await closeDoms([dom]);
  child.kill('SIGTERM');
  await Promise.race([new Promise((r) => child.once('exit', r)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  fs.rmSync(TMP, { recursive: true, force: true });
}
