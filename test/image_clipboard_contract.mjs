/* 18.12 · 사진 복사 → OS 클립보드 계약
   ---------------------------------------------------------------------------
   요청: "그냥 복사 하면 바로 클립보드로 들어가게 해줘."
     일반 복사(Ctrl+C 또는 우클릭 → 복사)로 사진 하나를 고르면, 앱 내부 클립보드
     (요소 복사/붙여넣기)뿐 아니라 OS 클립보드에도 '진짜 이미지(PNG)'를 즉시 올려
     워드 등 외부 앱에 바로 붙여넣을 수 있어야 한다.

   이 계약이 지키는 것:
     ① copyImageToClipboard(el) — 확정 서버 URL(/api/img/…)은 fetch→blob,
        레거시 data: 는 dataURLToFile, 둘 다 캔버스로 PNG 재인코딩한 뒤
        navigator.clipboard.write([new ClipboardItem({'image/png': …})]) 로 올린다.
     ② 소스가 없는 요소(업로드 전 pending·url 없음)는 '복사할 그림이 없다'는
        뜻으로 false 를 돌려주고 OS 클립보드를 건드리지 않는다.
     ③ 일반 복사(Ctrl+C)는 여전히 앱 내부 클립보드(clipboardEls)를 유지하므로
        앱 안에서 붙여넣기(Ctrl+V)가 그대로 동작한다.
     ④ 잘라내기(Ctrl+X)는 요소를 지우면서도 OS 클립보드에 이미지를 남긴다.

   실행 규칙(SLA): 임의 고정 sleep 금지 — waitFor/waitForSelector 로만 대기한다. */
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

const tick = () => new Promise((r) => setImmediate(r));
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

// 1×1 투명 PNG — 실제 이미지 바이트 (fetch 셈이 돌려주는 '서버 응답' 본문).
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_B64, 'base64');
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`;

async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-imgclip-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
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
      // canvas: jsdom 은 래스터화를 못 한다 → 2D 컨텍스트·blob 내보내기를 스텁.
      window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}, save() {}, restore() {}, scale() {}, translate() {}, setTransform() {}, measureText() { return { width: 10 }; }, getImageData() { return { data: new Uint8ClampedArray(4) }; }, putImageData() {} });
      window.HTMLCanvasElement.prototype.toBlob = function (cb, type) { cb(new window.Blob([PNG_BYTES], { type: type || 'image/png' })); };
      window.HTMLCanvasElement.prototype.toDataURL = () => PNG_DATA_URL;
      // Image: data:/blob: src → 다음 마이크로태스크에 onload(64×48), 그 외 → onerror.
      //   copyImageToClipboard 는 URL.createObjectURL(blob) 로 만든 blob: src 를 그리므로
      //   blob: 도 onload 로 처리해야 한다(붙여넣기 계약 테스트의 data: 전용 스텁과 차이).
      class FakeImage {
        constructor() { this.width = 0; this.height = 0; this.naturalWidth = 0; this.naturalHeight = 0; this.complete = false; this.onload = null; this.onerror = null; this._src = ''; }
        set src(v) {
          this._src = String(v || '');
          Promise.resolve().then(() => {
            if (this._src.startsWith('data:image/') || this._src.startsWith('blob:')) {
              this.naturalWidth = 64; this.naturalHeight = 48; this.width = 64; this.height = 48; this.complete = true;
              if (this.onload) { try { this.onload(); } catch (e) { /* noop */ } }
            } else if (this.onerror) {
              try { this.onerror(new window.Event('error')); } catch (e) { /* noop */ }
            }
          });
        }
        get src() { return this._src; }
      }
      window.Image = FakeImage;
      let seq = 0;
      window.URL.createObjectURL = () => `blob:sdynotes-clip-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
      window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      // ── OS 클립보드 관찰 ──
      window.__clipWrites = [];
      Object.defineProperty(window.navigator, 'clipboard', {
        value: {
          write: async (items) => { window.__clipWrites.push(items.map((it) => Object.keys(it.map))); },
          writeText: async (t) => { window.__clipWrites.push(['text/plain']); },
          read: async () => [],
          readText: async () => '',
        },
        configurable: true,
      });
      window.ClipboardItem = class { constructor(map) { this.map = map; } };
      // fetch: /api/img/… 는 '서버가 돌려주는 이미지'로 셈하고, 그 외는 실제 서버 통과.
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof window.URL ? new window.URL(String(input), window.location.href) : input;
        if (target && target.pathname && target.pathname.startsWith('/api/img/')) {
          return Promise.resolve(new globalThis.Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } }));
        }
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

try {
  await waitFor('server /api/health', async () => {
    if (child.exitCode !== null) throw new Error('server died during boot: ' + log.slice(-500));
    try { return (await fetch(base + '/api/health')).ok; } catch { return false; }
  }, { timeout: 15_000 });

  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = (b) => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then((r) => r.json());

  // ── 픽스처: 이미지 1개(i1, 확정 URL) + 레거시 data: 이미지(i2) + 텍스트(t1) ──
  const nb = (await q({ table: 'notebooks', op: 'insert', values: [{ title: '클립보드이미지', color: '#4f6ef7' }], filters: [], returning: true, single: true })).data;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{
      id: 'p1',
      els: [
        { type: 'image', id: 'i1', url: '/api/img/img_test.webp', x: 80, y: 80, w: 200, h: 150 },
        { type: 'image', id: 'i2', url: '', localURL: PNG_DATA_URL, x: 320, y: 80, w: 200, h: 150 },
        { type: 'text', id: 't1', x: 80, y: 300, w: 200, h: 60, html: '텍스트', fontSize: 16 },
      ],
    }],
  };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: nb.id, content: JSON.stringify(doc0), font_size: 16 }], filters: [] });

  const dom = await boot();
  const { window } = dom, { document } = window;
  await waitFor('app globals (copyImageToClipboard)', () => (typeof window.copyImageToClipboard === 'function' ? true : null));
  check('A-00 copyImageToClipboard 가 노출된다', typeof window.copyImageToClipboard === 'function');

  // ═══════ A · copyImageToClipboard 단위 계약 ═══════
  console.log('\n── A. copyImageToClipboard 단위 계약 ──');
  window.__clipWrites = [];
  const okUrl = await window.copyImageToClipboard({ type: 'image', id: 'i1', url: '/api/img/img_test.webp' });
  check('A-01 확정 서버 URL 이미지 → OS 클립보드 복사 성공(true)', okUrl === true);
  check('A-02 OS 클립보드에 image/png 가 기록된다', window.__clipWrites.some((w) => w.join(',') === 'image/png'), JSON.stringify(window.__clipWrites));

  window.__clipWrites = [];
  const okData = await window.copyImageToClipboard({ type: 'image', id: 'i2', url: '', localURL: PNG_DATA_URL });
  check('A-03 레거시 data: 이미지 → OS 클립보드 복사 성공(true)', okData === true);
  check('A-04 data: 경로도 image/png 로 기록된다', window.__clipWrites.some((w) => w.join(',') === 'image/png'), JSON.stringify(window.__clipWrites));

  window.__clipWrites = [];
  const okText = await window.copyImageToClipboard({ type: 'text', id: 't1', html: '텍스트' });
  check('A-05 이미지가 아니면 복사하지 않는다(false)', okText === false);
  check('A-06 이미지가 아닌 요소는 OS 클립보드를 건드리지 않는다', window.__clipWrites.length === 0);

  window.__clipWrites = [];
  const okPending = await window.copyImageToClipboard({ type: 'image', id: 'xx-no-src', url: '', pending: true, localURL: 'blob:volatile' });
  check('A-07 소스 없는(업로드 전) 이미지는 복사하지 않는다(false)', okPending === false);
  check('A-08 소스 없는 이미지는 OS 클립보드를 건드리지 않는다', window.__clipWrites.length === 0);

  // ═══════ B · 일반 복사(Ctrl+C) 통합 + 앱 내부 붙여넣기 보존 ═══════
  console.log('\n── B. 일반 복사(Ctrl+C) 통합 ──');
  const card = await waitFor('note card "클립보드이미지"', () =>
    [...document.querySelectorAll('.note-stack .note-card')].find((c) => (c.textContent || '').includes('클립보드이미지')) || null);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await waitFor('editorView open', () => document.getElementById('editorView').classList.contains('open') || null);
  const imgNode = await waitForSelector(dom, '#pagesStage .paper-img[data-id="i1"]');

  // 첫 클릭 = 선택 (onPaperDown: deselectAll → .sel + selected={type:'image',el:im})
  imgNode.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 120, clientY: 120 }));
  check('B-01 이미지 클릭으로 선택된다(.sel)', imgNode.classList.contains('sel'));

  window.__clipWrites = [];
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
  await waitFor('Ctrl+C → OS 클립보드에 image/png', () => window.__clipWrites.some((w) => w.join(',') === 'image/png') || null);
  check('B-02 Ctrl+C 로 OS 클립보드에 image/png 가 기록된다', true);
  check('B-03 복사는 요소를 지우지 않는다(원본 유지)', !!document.querySelector('#pagesStage .paper-img[data-id="i1"]'));

  // 앱 내부 클립보드 보존: OS 클립보드가 '비어 있는' paste 이벤트 → clipboardEls 로 붙여넣기
  const before = document.querySelectorAll('#pagesStage .paper-img').length;
  document.dispatchEvent(new window.Event('paste', { bubbles: true, cancelable: true }));
  await waitFor('내부 붙여넣기로 복제본이 생긴다', () => document.querySelectorAll('#pagesStage .paper-img').length === before + 1 || null);
  const clones = [...document.querySelectorAll('#pagesStage .paper-img')].filter((n) => n.dataset.id !== 'i1' && n.dataset.id !== 'i2');
  check('B-04 앱 내부 붙여넣기가 그대로 동작한다(이미지 복제)', clones.length >= 1);

  // ═══════ C · 잘라내기(Ctrl+X) 통합 ═══════
  console.log('\n── C. 잘라내기(Ctrl+X) 통합 ──');
  const cutNode = document.querySelector('#pagesStage .paper-img[data-id="i1"]');
  cutNode.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 120, clientY: 120 }));
  check('C-01 잘라내기 전 이미지 재선택', cutNode.classList.contains('sel'));

  window.__clipWrites = [];
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'x', ctrlKey: true, bubbles: true, cancelable: true }));
  await waitFor('Ctrl+X → OS 클립보드에 image/png', () => window.__clipWrites.some((w) => w.join(',') === 'image/png') || null);
  check('C-02 Ctrl+X 로 OS 클립보드에 image/png 가 기록된다', true);
  await waitFor('잘라낸 요소가 사라진다', () => document.querySelector('#pagesStage .paper-img[data-id="i1"]') ? null : true);
  check('C-03 잘라내기는 요소를 지운다', !document.querySelector('#pagesStage .paper-img[data-id="i1"]'));

  // ── G · 치명적 런타임 오류 없음 ──────────────────────────────────
  check('E-08 치명적 런타임 오류 없음', (dom.__errors || []).length === 0, (dom.__errors || []).join(' | '));

  console.log(`\n이미지 OS 클립보드 복사 계약: PASS ${pass}`);
} catch (e) {
  console.error('FAIL: ' + ((e && e.stack) || e));
  throw e;
} finally {
  try { child.kill('SIGTERM'); } catch { /* noop */ }
  await closeDoms(doms, { tailMs: 0 });
}
