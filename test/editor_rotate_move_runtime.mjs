/* 14.39.9 · 회전 후 이동해도 회전 유지 계약
   ---------------------------------------------------------------------------
   사용자 보고 (26.09.08): 내용물을 선택 → 회전 → 이동하면 회전 각도가 풀린다.
   원인 2종:
     ① 펜 획(단일/다중 드래그·정렬)은 이동 중 transform 을 translate 로
        통째로 덮어써 회전 성분이 영구히 사라졌다 (모델 rotation 은 남음).
     ② 글상자·그림은 GPU 미리보기가 transform 을 translate 로 덮어써
        드래그 내내 똑바로 보였고, 원점을 모서리로 옮겨 잡는 순간 흔들렸다.
   이 테스트는 실제 마우스 이벤트로 선택→회전→이동을 재현해 회전이
   이동 중·이동 후에도 유지되는지 검증한다. */
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
let pass = 0;
const check = (name, cond, extra) => {
  assert.ok(cond, extra !== undefined ? `${name} :: ${extra}` : name);
  pass++;
  console.log('  ✓ ' + name);
};
async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-rotmove-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
  fs.mkdirSync(path.join(TMP, 'src'), { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO, 'src'))) {
    const from = path.join(REPO, 'src', f), to = path.join(TMP, 'src', f);
    if (fs.statSync(from).isDirectory()) continue;
    fs.copyFileSync(from, to);
  }
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/src/index.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (b) => (log += b));
child.stderr.on('data', (b) => (log += b));
const doms = [];
const errors = [];
try {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died: ' + log.slice(-400));
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }

  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = (b) => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then((r) => r.json());
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '회전 이동', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{
      id: 'p1',
      els: [
        { type: 'text', id: 't1', x: 100, y: 100, w: 200, h: 60, html: '회전 테스트', fontSize: 16 },
        { type: 'stroke', id: 's1', pts: [[300, 300], [360, 300], [360, 360], [300, 360]], dx: 0, dy: 0, size: 3, color: '#111111' },
        { type: 'stroke', id: 's2', pts: [[420, 300], [470, 300], [470, 350]], dx: 0, dy: 0, size: 3, color: '#2255aa' },
      ],
    }],
  };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: id, content: JSON.stringify(doc0), font_size: 16 }], filters: [] });

  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const m = String(e?.message || e);
    if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errors.push(m);
  });
  vc.on('error', (...a) => errors.push(a.join(' ')));

  const d = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      installWindowGuard(window);
      window.innerWidth = 1280; window.innerHeight = 800;
      window.matchMedia = (query) => ({ matches: query.includes('pointer:fine'), media: query,
        addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.BroadcastChannel = class { postMessage(){} close(){} addEventListener(){} };
      window.EventSource = class { close(){} addEventListener(){} };
      window.requestIdleCallback = (cb) => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
      window.cancelIdleCallback = clearTimeout;
      window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
      window.cancelAnimationFrame = clearTimeout;
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.HTMLCanvasElement.prototype.getContext = () => ({
        clearRect(){}, drawImage(){}, fillRect(){}, beginPath(){}, moveTo(){}, lineTo(){},
        stroke(){}, arc(){}, fill(){}, save(){}, restore(){}, scale(){}, translate(){},
        setTransform(){}, measureText(){ return { width: 10 }; }, getImageData(){ return { data: new Uint8ClampedArray(4) }; }, putImageData(){},
      });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class { constructor(){ this.paused = true; } play(){ return Promise.resolve(); } pause(){} addEventListener(){} removeEventListener(){} };
      window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
      window.addEventListener('error', (e) => errors.push(e.error?.stack || e.message));
      window.addEventListener('unhandledrejection', (e) => errors.push('unhandled: ' + (e.reason?.stack || e.reason)));
    },
  });
  doms.push(d);
  const { window } = d;
  const { document } = window;

  const boot = Date.now();
  while (Date.now() - boot < 8_000 && document.querySelectorAll('.note-stack .note-card,.pro-grid .note-card').length < 1) await wait(60);
  const card = [...document.querySelectorAll('.note-stack .note-card,.pro-grid .note-card')]
    .find((c) => (c.textContent || '').includes('회전 이동'));
  check('노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const elUntil = Date.now() + 8_000;
  while (Date.now() < elUntil && (!document.querySelector('#pagesStage .tb[data-id="t1"]')
      || !document.querySelector('#pagesStage .stroke-g[data-id="s1"]'))) await wait(80);
  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));
  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });

  const down = (node, x, y, extra) => node.dispatchEvent(
    new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x, clientY: y, ...(extra || {}) }));
  const move = (x, y, extra) => document.dispatchEvent(
    new window.MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y, ...(extra || {}) }));
  const up = () => document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  const wheelRot = () => document.getElementById('editorBody').dispatchEvent(
    new window.WheelEvent('wheel', { bubbles: true, cancelable: true, altKey: true, shiftKey: true, deltaY: 100 }));
  const resetSel = () => { try { window.deselectAll(true); } catch {} try { window.clearMulti(); } catch {} };
  const tb = () => document.querySelector('#pagesStage .tb[data-id="t1"]');
  const g1 = () => document.querySelector('#pagesStage .stroke-g[data-id="s1"]');
  const g2 = () => document.querySelector('#pagesStage .stroke-g[data-id="s2"]');

  // ── 1) 펜 획: 회전 → 드래그 이동 ──────────────────────────
  down(g1().querySelector('.stroke-vis'), 330, 330);
  await wait(80);
  check('획 1차 클릭으로 선택된다', g1().classList.contains('sel'));
  wheelRot();
  await wait(120);
  check('Alt+Shift+휠로 획이 회전한다', (g1().getAttribute('transform') || '').includes('rotate'),
    g1().getAttribute('transform'));
  check('모델에도 각도가 남는다', (window.findEl(0, 's1').rotation || 0) === 5);
  down(g1().querySelector('.stroke-vis'), 330, 330);   // 2차 클릭부터 이동
  move(390, 330, { altKey: true });                     // Alt = 스냅 제외, 정확히 +60
  await wait(150);
  check('이동 중에도 획 회전이 유지된다', (g1().getAttribute('transform') || '').includes('rotate'),
    g1().getAttribute('transform'));
  up();
  await wait(120);
  check('이동 후에도 획 회전이 유지된다 (보고 증상)', (g1().getAttribute('transform') || '').includes('rotate'),
    g1().getAttribute('transform'));
  check('획이 실제로 오른쪽으로 옮겨졌다', (window.findEl(0, 's1').dx || 0) > 10,
    'dx=' + window.findEl(0, 's1').dx);
  resetSel();

  // ── 2) 글상자: 회전 → 테두리 드래그 이동 ──────────────────
  down(tb().querySelector('.tb-content'), 150, 130);
  await wait(80);
  check('글상자 1차 클릭으로 선택된다', tb().classList.contains('sel'));
  window.rotateSelection(15);
  await wait(60);
  check('글상자가 회전한다', (tb().style.transform || '').includes('rotate(15deg)'), tb().style.transform);
  down(tb().querySelector('.tb-edge.top'), 150, 100);
  await wait(60);
  check('잡는 순간 회전축이 중심에 남는다', (tb().style.transformOrigin || '').includes('50%'),
    'origin=' + tb().style.transformOrigin);
  move(190, 130, { altKey: true });
  await wait(150);
  check('이동 중 미리보기에도 회전이 남는다', (tb().style.transform || '').includes('rotate'),
    tb().style.transform);
  up();
  await wait(120);
  check('이동 후에도 글상자 회전이 유지된다', (tb().style.transform || '').includes('rotate(15deg)'),
    tb().style.transform);
  check('글상자가 실제로 옮겨졌다', (window.findEl(0, 't1').x || 0) > 100,
    'x=' + window.findEl(0, 't1').x);
  resetSel();

  // ── 3) 다중 선택: 회전 → 함께 이동 ───────────────────────
  window.toggleMultiSelect(0, tb());
  window.toggleMultiSelect(0, g2());
  await wait(60);
  check('두 요소가 다중 선택된다', tb().classList.contains('msel') && g2().classList.contains('msel'));
  window.rotateSelection(10);
  await wait(60);
  check('묶음 회전이 둘 다 돈다',
    (tb().style.transform || '').includes('rotate') && (g2().getAttribute('transform') || '').includes('rotate'));
  down(g2().querySelector('.stroke-vis'), 445, 325);
  move(475, 325, { altKey: true });
  await wait(150);
  check('다중 이동 중 글상자 회전 유지', (tb().style.transform || '').includes('rotate'), tb().style.transform);
  check('다중 이동 중 획 회전 유지', (g2().getAttribute('transform') || '').includes('rotate'),
    g2().getAttribute('transform'));
  up();
  await wait(120);
  check('다중 이동 후 글상자 회전 유지', (tb().style.transform || '').includes('rotate'), tb().style.transform);
  check('다중 이동 후 획 회전 유지', (g2().getAttribute('transform') || '').includes('rotate'),
    g2().getAttribute('transform'));

  // ── 4) 정렬 이동도 회전을 유지 ────────────────────────────
  window.alignSelection('left');
  await wait(120);
  check('정렬 후에도 획 회전이 유지된다', (g2().getAttribute('transform') || '').includes('rotate'),
    g2().getAttribute('transform'));
  check('정렬 후에도 글상자 회전이 유지된다', (tb().style.transform || '').includes('rotate'), tb().style.transform);

  check('런타임 오류 없음', errors.length === 0, errors.slice(0, 3).join(' || ').slice(0, 500));
  console.log(`회전 후 이동 계약: PASS ${pass}`);
} catch (e) {
  console.error('FAIL:', e.message);
  console.error((e.stack || '').split('\n').slice(0, 4).join('\n'));
  process.exitCode = 1;
} finally {
  await closeDoms(doms);
  if (child && child.exitCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    try { child.kill('SIGTERM'); } catch {}
    await Promise.race([exited, wait(1500)]);
    if (child.exitCode === null) {
      const killed = new Promise(resolve => child.once('exit', resolve));
      try { child.kill('SIGKILL'); } catch {}
      await Promise.race([killed, wait(1500)]);
    }
  }
  process.exit(process.exitCode || 0);
}
