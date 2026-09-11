/* 22.2 · 요소 복사/붙여넣기 계약 — "드래그해서 골라 복사한 뒤 Ctrl+V 가 잘 안 된다"
   ---------------------------------------------------------------------------
   보고된 증상:
     요소를 드래그로 선택해 Ctrl+C 한 뒤 Ctrl+V 하면 복사한 요소가 붙지 않고,
     예전에 복사해 둔 '글자'가 새 글상자로 붙었다.

   원인:
     요소 복사(copyElements — 비텍스트·혼합·드래그 다중 선택)가 OS 클립보드를
     건드리지 않았다. 그래서 Ctrl+V 때 클립보드에 남아 있던 오래된 글자가
     '외부 텍스트 붙여넣기'로 처리돼 글상자가 만들어졌다.

   이 계약이 지키는 것:
     ① 글상자 Ctrl+C → OS 클립보드에 '상자의 글자'가 오르고(18.9),
        같은 글자를 붙여넣으면 상자 복제가 된다.
     ② 획(stroke) 등 글자 없는 요소 복사 → OS 클립보드의 오래된 글자를
        비우는(빈 글자 쓰기) 쓰기를 하고, Ctrl+V 는 요소를 복제한다.
     ③ OS 클립보드 쓰기가 실패하는 환경(권한 없음 등)에서 요소 복사 직후
        Ctrl+V 는 오래된 글자가 클립보드에 있어도 '요소 붙여넣기'로 우선
        처리된다(60초 안전창).
     ④ 요소 복사(쓰기 성공) 뒤 '다른 글자'를 붙여넣으면 여전히 새 글상자로
        붙는다 — 외부 텍스트 붙여넣기가 깨지지 않는다.
     ⑤ 잘라내기(Ctrl+X)도 같은 규칙 — 지운 요소가 붙여넣기로 돌아온다.

   실행 규칙(SLA): 임의 고정 sleep 금지 — waitFor 로만 대기한다. */
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import jsdom from 'jsdom';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { installWindowGuard, closeDoms } from './jsdom_guard.mjs';

const { JSDOM, VirtualConsole } = jsdom;

let pass = 0;
const check = (name, cond, detail) => {
  assert.ok(cond, `${name}${detail ? ` — ${detail}` : ''}`);
  pass += 1;
  console.log('  ✓ ' + name);
};

async function waitFor(what, predicate, { timeout = 20_000 } = {}) {
  const deadline = Date.now() + timeout;
  let backoff = 0;
  for (;;) {
    const v = await predicate();
    if (v) return v;
    assert.ok(Date.now() < deadline, `timeout waiting for: ${what}`);
    await (backoff ? new Promise((r) => setTimeout(r, backoff)) : tick());
    backoff = backoff ? Math.min(backoff * 2, 16) : 1;
  }
}
const tick = () => new Promise((r) => setImmediate(r));
function waitForSelector(dom, selector, { timeout = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const doc = dom.window.document;
    const hitNow = doc.querySelector(selector);
    if (hitNow) return resolve(hitNow);
    let mo = null;
    const timer = setTimeout(() => {
      if (mo) mo.disconnect();
      reject(new Error(`timeout waiting for selector: ${selector}`));
    }, timeout);
    mo = new dom.window.MutationObserver(() => {
      const el = doc.querySelector(selector);
      if (el) {
        clearTimeout(timer);
        mo.disconnect();
        resolve(el);
      }
    });
    mo.observe(doc.documentElement, { childList: true, subtree: true });
  });
}

async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-elclip-'));
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
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (b) => (log += b));
child.stderr.on('data', (b) => (log += b));

const doms = [];

function common() {
  return {
    resources: 'usable',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      installWindowGuard(window);
      window.innerWidth = 1280;
      window.innerHeight = 800;
      window.matchMedia = (q) => ({ matches: q.includes('pointer:fine'), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.BroadcastChannel = class { postMessage() {} close() {} addEventListener() {} };
      window.EventSource = class { close() {} addEventListener() {} };
      window.requestIdleCallback = (cb) => window.setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
      window.cancelIdleCallback = clearTimeout;
      window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
      window.cancelAnimationFrame = clearTimeout;
      window.Audio = class { constructor() { this.paused = true; } play() { return Promise.resolve(); } pause() {} addEventListener() {} removeEventListener() {} };
      window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}, save() {}, restore() {}, scale() {}, translate() {}, setTransform() {}, measureText() { return { width: 10 }; }, getImageData() { return { data: new Uint8ClampedArray(4) }; }, putImageData() {} });
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      // ── OS 클립보드 관찰/제어 ──
      //   __clipWrites      : writeText/write 로 넣은 값 기록 ('text/plain:<값>')
      //   __failClipWrite   : true 면 writeText 가 실패(권한 없음 환경 재현)
      //   __osClipText      : '실제 OS 클립보드에 들어있는 글자' 시뮬레이션
      window.__clipWrites = [];
      window.__failClipWrite = false;
      window.__osClipText = '';
      Object.defineProperty(window.navigator, 'clipboard', {
        value: {
          write: async () => { window.__clipWrites.push('image/*'); },
          writeText: async (t) => {
            if (window.__failClipWrite) throw new window.DOMException('denied', 'NotAllowedError');
            window.__osClipText = String(t ?? '');
            window.__clipWrites.push('text/plain:' + String(t ?? ''));
          },
          read: async () => [],
          readText: async () => window.__osClipText,
        },
        configurable: true,
      });
      window.ClipboardItem = class { constructor(map) { this.map = map; } };
      // jsdom 창엔 fetch 가 없다 — 실제 서버(같은 origin)로 통과시킨다.
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof window.URL ? new window.URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
    },
  };
}

async function boot() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { const m = String(e?.message || e); if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errors.push(m); });
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const d = await JSDOM.fromURL(base + '/', { ...common(), virtualConsole: vc });
  d.window.addEventListener('error', (e) => errors.push(e.error?.stack || e.message));
  d.window.addEventListener('unhandledrejection', (e) => errors.push('unhandled: ' + (e.reason?.stack || e.reason)));
  d.__errors = errors;
  doms.push(d);
  return d;
}

// paste 이벤트 — clipboardData 에 '지금 클립보드에서 온 글자'를 심어 보낸다.
function pasteEvent(window, plain) {
  const dt = {
    items: [],
    getData: (t) => (t === 'text/plain' ? plain : ''),
  };
  const ev = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: dt });
  return ev;
}

try {
  await waitFor('server /api/health', async () => {
    if (child.exitCode !== null) throw new Error('server died during boot: ' + log.slice(-500));
    try { return (await fetch(base + '/api/health')).ok; } catch { return false; }
  }, { timeout: 15_000 });

  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = (b) => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then((r) => r.json());

  // ── 픽스처: 글상자 1개(t1 '안녕하세요') + 펜 획 1개(s1) ──
  const nb = (await q({ table: 'notebooks', op: 'insert', values: [{ title: '요소클립보드', color: '#4f6ef7' }], filters: [], returning: true, single: true })).data;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{
      id: 'p1',
      els: [
        { type: 'text', id: 't1', x: 80, y: 80, w: 240, h: 60, html: '안녕하세요', fontSize: 16 },
        { type: 'stroke', id: 's1', pts: [[60, 200], [120, 260], [200, 210]], dx: 0, dy: 0, color: '#111111', size: 3 },
      ],
    }],
  };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: nb.id, content: JSON.stringify(doc0), font_size: 16 }], filters: [] });

  const dom = await boot();
  const { window } = dom, { document } = window;
  await waitForSelector(dom, '.note-stack .note-card,.pro-grid .note-card');

  console.log('\n── 준비: 에디터 열기 ──');
  const card = await waitFor('note card "요소클립보드"', () =>
    [...document.querySelectorAll('.note-stack .note-card,.pro-grid .note-card')].find((c) => (c.textContent || '').includes('요소클립보드')) || null);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await waitFor('editorView open', () => document.getElementById('editorView').classList.contains('open') || null);
  await waitForSelector(dom, '#pagesStage .tb[data-id="t1"]');
  await waitForSelector(dom, '#pagesStage .stroke-g[data-id="s1"]');

  const tbCount = () => document.querySelectorAll('#pagesStage .tb[data-id]').length;
  const strokeCount = () => document.querySelectorAll('#pagesStage .stroke-g[data-id]').length;
  const ctrl = (key) => document.dispatchEvent(new window.KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }));
  const clickSel = (node) => node.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, detail: 1, clientX: 120, clientY: 120 }));

  // ═══════ ① 글상자 복사 → 같은 글자 붙여넣기 = 상자 복제 (18.9 유지) ═══════
  console.log('\n── 1. 글상자 Ctrl+C → Ctrl+V (글자 일치 → 상자 복제) ──');
  const tb1 = document.querySelector('#pagesStage .tb[data-id="t1"]');
  clickSel(tb1.querySelector('.tb-content') || tb1);
  check('1-1 글상자 클릭으로 선택된다(.sel)', tb1.classList.contains('sel'));

  window.__clipWrites = [];
  ctrl('c');
  await waitFor('Ctrl+C → OS 클립보드에 상자의 글자', () => window.__clipWrites.includes('text/plain:안녕하세요') || null);
  check('1-2 OS 클립보드에 상자의 글자가 오른다', true);

  const tbs0 = tbCount(), strokes0 = strokeCount();
  document.dispatchEvent(pasteEvent(window, '안녕하세요'));
  await waitFor('상자 복제', () => tbCount() === tbs0 + 1 || null);
  check('1-3 같은 글자를 붙이면 상자가 복제된다', tbCount() === tbs0 + 1);
  check('1-4 획 개수는 그대로', strokeCount() === strokes0);

  // ═══════ ② 획 복사(글자 없음) → OS 클립보드 정리 + 요소 복제 ═══════
  console.log('\n── 2. 획(stroke) Ctrl+C → Ctrl+V (빈 클립보드 → 요소 복제) ──');
  const sg = document.querySelector('#pagesStage .stroke-g[data-id="s1"]');
  clickSel(sg);
  check('2-1 획 클릭으로 선택된다(.sel)', sg.classList.contains('sel'));

  window.__clipWrites = [];
  ctrl('c');
  await waitFor('Ctrl+C → OS 클립보드 정리(빈 글자 쓰기)', () => window.__clipWrites.includes('text/plain:') || null);
  check('2-2 요소 복사가 OS 클립보드의 오래된 글자를 비운다', window.__osClipText === '');
  check('2-3 복사는 요소를 지우지 않는다', strokeCount() === strokes0);

  const strokes1 = strokeCount();
  window.__osClipText = '';   // 실제 브라우저: 빈 클립보드로 붙여넣기
  document.dispatchEvent(pasteEvent(window, ''));
  await waitFor('획 복제', () => strokeCount() === strokes1 + 1 || null);
  check('2-4 Ctrl+V 로 획이 복제된다', strokeCount() === strokes1 + 1);
  check('2-5 엉뚱한 글상자는 생기지 않는다', tbCount() === tbs0 + 1);

  // ═══════ ③ 쓰기 실패 환경 + 클립보드에 오래된 글자 → 요소 붙여넣기 우선 ═══════
  console.log('\n── 3. 클립보드 쓰기 실패 + 오래된 글자 → 요소 복제 (보고 시나리오) ──');
  window.__failClipWrite = true;          // 권한 없음 환경 재현
  window.__osClipText = '안녕하세요';      // 예전 글상자 복사 때 남은 글자가 클립보드에 썩어 있다
  const sg2 = document.querySelector('#pagesStage .stroke-g[data-id="s1"]');
  clickSel(sg2);
  ctrl('c');
  await tick(); await tick();             // writeText 거부 · fallback 실패까지 통과
  check('3-1 쓰기 실패에도 요소 복사는 살아 있다', strokeCount() === strokes1 + 1);

  const strokes2 = strokeCount();
  document.dispatchEvent(pasteEvent(window, '안녕하세요'));   // 오래된 글자가 실려 온다
  await waitFor('요소 복제(글상자 아님)', () => strokeCount() === strokes2 + 1 || null);
  check('3-2 Ctrl+V 가 요소를 복제한다', strokeCount() === strokes2 + 1);
  check('3-3 오래된 글자로 글상자를 만들지 않는다', tbCount() === tbs0 + 1);

  // ═══════ ④ 쓰기 성공 + '다른 글자' 붙여넣기 → 외부 텍스트 상자 유지 ═══════
  console.log('\n── 4. 요소 복사 뒤 다른 글자 붙이면 외부 텍스트 상자 ──');
  window.__failClipWrite = false;
  window.__osClipText = '';
  const sg3 = document.querySelector('#pagesStage .stroke-g[data-id="s1"]');
  clickSel(sg3);
  ctrl('c');
  await waitFor('Ctrl+C → OS 클립보드 정리', () => window.__clipWrites.slice(-1).includes('text/plain:') || null);
  window.__osClipText = '외부에서 복사한 글자';   // 사용자가 밖에서 다른 글자를 복사해 왔다
  const tbs1 = tbCount(), strokes3 = strokeCount();
  document.dispatchEvent(pasteEvent(window, '외부에서 복사한 글자'));
  await waitFor('외부 글자로 새 글상자', () => tbCount() === tbs1 + 1 || null);
  check('4-1 외부 텍스트는 여전히 새 글상자로 붙는다', tbCount() === tbs1 + 1);
  check('4-2 이때 요소를 몰래 복제하지 않는다', strokeCount() === strokes3);

  // ═══════ ⑤ 잘라내기도 같은 규칙 — 지운 요소가 Ctrl+V 로 돌아온다 ═══════
  console.log('\n── 5. 글상자 Ctrl+X(쓰기 실패) → Ctrl+V 복원 ──');
  window.__failClipWrite = true;
  window.__osClipText = '외부에서 복사한 글자';
  const cutBox = [...document.querySelectorAll('#pagesStage .tb[data-id]')]
    .find((n) => (n.textContent || '').includes('외부에서 복사한 글자'));
  clickSel(cutBox.querySelector('.tb-content') || cutBox);
  ctrl('x');
  await waitFor('잘라낸 상자가 사라진다', () => tbCount() === tbs1 || null);
  check('5-1 잘라내기는 상자를 지운다', tbCount() === tbs1);

  document.dispatchEvent(pasteEvent(window, '외부에서 복사한 글자'));
  await waitFor('잘라낸 상자 복원', () => tbCount() === tbs1 + 1 || null);
  check('5-2 Ctrl+V 로 잘라낸 상자가 돌아온다', tbCount() === tbs1 + 1);

  // ── 치명적 런타임 오류 없음 ──
  check('6-1 치명적 런타임 오류 없음', (dom.__errors || []).length === 0, (dom.__errors || []).join(' | '));

  console.log(`\n요소 복사/붙여넣기 계약: PASS ${pass}`);
} catch (e) {
  console.error('FAIL: ' + ((e && e.stack) || e));
  throw e;
} finally {
  try { child.kill('SIGTERM'); } catch { /* noop */ }
  await closeDoms(doms, { tailMs: 0 });
}
