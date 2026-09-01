/* 이미지 저장 방식 v3 · 업로드-선행(단순·확실) 계약
   ---------------------------------------------------------------------------
   QA 보고(원 증상): "그림을 올린 뒤 나중에 다른 기기에서 열면 사진이 안
   불러와진다." — 원인은 '화면에 먼저 붙이고 저장은 백그라운드 큐가 나중에'
   하던 옛 구조(pending/blob:/data:/IndexedDB/outbox/자가복구)의 부분 실패였다.

   v3 이 지키는 계약 (전부 여기서 검증):
     ① 업로드-선행 — 요소는 서버가 저장하고 **다시 읽어 검증한** url
        (/api/img/…)로만 태어난다. pending 상태·로컬 소스는 존재하지 않는다.
     ② 공유 상태(ops·memo)에는 절대 blob:/data:/빈 url 이미지를 싣지 않는다
        (serverImageElement: url 없으면 null — 레거시 data: 만 예외 보존).
     ③ 보낸 기기가 죽어도(세션 파괴) 다른 어떤 기기든 서버 저장소에서 그대로
        사진을 읽는다 — 자산 수명 ≠ 업로더 세션.
     ④ 업로드가 실패하면 **아무것도 놓지 않는다** — 깨진 자리/있었다는 표시가
        어떤 기기에도 생기지 않고, 사용자는 실패 알림을 받는다.
     ⑤ 네트워크가 돌아온 뒤 다시 넣으면 정상 경로로 완전히 복구된다.

   실행 규칙(SLA) — 임의 고정 sleep 금지: 모든 대기는 waitFor(조건 폴링,
   적응형 백오프)로만 한다. 시나리오가 빨리 끝나면 테스트도 빨리 끝난다. */
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
async function waitFor(what, predicate, { timeout = 25_000 } = {}) {
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

// 1×1 투명 PNG — 실제 디코딩 가능한 바이트여야 서버의 sharp 재인코딩이 성공한다.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_B64, 'base64');
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`;
const pngFile = (win, name = 'paste-qa.png') =>
  new (win ? win.File : globalThis.File)([PNG_BYTES], name, { type: 'image/png' });

async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-pasteimg-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) {
    fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
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
const closedDoms = [];

function common({ block = [] } = {}) {
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
      window.HTMLCanvasElement.prototype.toBlob = function (cb, type) { cb(new window.Blob([PNG_BYTES], { type: type || 'image/png' })); };
      window.HTMLCanvasElement.prototype.toDataURL = () => PNG_DATA_URL;
      // Image 스텁: jsdom 은 <img>/Image 에 load/error 를 발화하지 않는다.
      // data: 와 서버 이미지 주소(/api/img/…)는 onload, 그 외에는 onerror.
      class FakeImage {
        constructor() { this.width = 0; this.height = 0; this.naturalWidth = 0; this.naturalHeight = 0; this.complete = false; this.onload = null; this.onerror = null; this._src = ''; }
        set src(v) {
          this._src = String(v || '');
          Promise.resolve().then(() => {
            if (this._src.startsWith('data:image/') || this._src.includes('/api/img/')) {
              this.naturalWidth = 64; this.naturalHeight = 48; this.width = 64; this.height = 48; this.complete = true;
              if (this.onload) { try { this.onload(); } catch (e) { /* 오류 수집기로 */ } }
            } else if (this.onerror) {
              try { this.onerror(new window.Event('error')); } catch (e) { /* noop */ }
            }
          });
        }
        get src() { return this._src; }
      }
      window.Image = FakeImage;
      let seq = 0;
      window.URL.createObjectURL = () => `blob:sdynotes-qa-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
      window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      // File/Blob/FormData 는 jsdom-native 그대로 둔다 (FileReader 호환).
      const isJsdomBlobLike = (v) => !!v && typeof v === 'object'
        && (v.constructor?.name === 'File' || v.constructor?.name === 'Blob');
      const blobToNodeFile = (v) => new Promise((resolve, reject) => {
        const fr = new window.FileReader();
        fr.onload = () => resolve(new globalThis.File([Buffer.from(fr.result)], v.name || 'file', { type: v.type || 'application/octet-stream' }));
        fr.onerror = () => reject(fr.error || new Error('blob read failed'));
        fr.readAsArrayBuffer(v);
      });
      // 네트워크 셈: 실제 서버로 통과시키되, 선택한 엔드포인트만 끊는다.
      const blocked = new Set(block);
      window.__severEndpoint = (p) => blocked.add(p);
      window.__restoreEndpoint = (p) => blocked.delete(p);
      window.fetch = async (input, init) => {
        const target = typeof input === 'string' || input instanceof window.URL
          ? new window.URL(String(input), window.location.href)
          : input;
        const p = (target && target.pathname) || '';
        for (const b of blocked) {
          if (p.startsWith(b)) return Promise.reject(new TypeError(`Failed to fetch (severed by test): ${p}`));
        }
        let init2 = init;
        const body = init && init.body;
        if (body && typeof body === 'object' && body.constructor?.name === 'FormData') {
          const fd = new globalThis.FormData();
          for (const [k, v] of body.entries()) {
            if (isJsdomBlobLike(v)) fd.append(k, await blobToNodeFile(v), v.name || 'file');
            else fd.append(k, v);
          }
          init2 = { ...init, body: fd };
        }
        return globalThis.fetch(target, init2);
      };
    },
  };
}

async function boot(opts = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const m = String(e?.message || e);
    if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errors.push(m);
  });
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const d = await JSDOM.fromURL(base + '/', { ...common(opts), virtualConsole: vc });
  d.window.addEventListener('error', (e) => errors.push(e.error?.stack || e.message));
  d.window.addEventListener('unhandledrejection', (e) => errors.push('unhandled: ' + (e.reason?.stack || e.reason)));
  d.__errors = errors;
  doms.push(d);
  return d;
}

async function killDevice(dom) {
  const i = doms.indexOf(dom);
  if (i >= 0) doms.splice(i, 1);
  await closeDoms([dom], { tailMs: 0 });
  closedDoms.push(dom);
}
const appReady = (dom) => waitFor('app globals (serverImageElement)', () => (typeof dom.window.serverImageElement === 'function' ? true : null));

async function openNoteByTitle(dom, title) {
  const card = await waitFor(`note card "${title}"`, () =>
    [...dom.window.document.querySelectorAll('.note-stack .note-card')]
      .find((c) => (c.textContent || '').includes(title)) || null);
  card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await waitFor(`editorView open for "${title}"`, () =>
    dom.window.document.getElementById('editorView').classList.contains('open') || null);
}

function pasteImage(dom, file) {
  const ev = new dom.window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', {
    value: {
      items: [{ type: file.type, getAsFile: () => file }],
      getData: () => '',
    },
  });
  dom.window.document.dispatchEvent(ev);
}

try {
  await waitFor('server /api/health', async () => {
    if (child.exitCode !== null) throw new Error('server died during boot: ' + log.slice(-500));
    try { return (await fetch(base + '/api/health')).ok; } catch { return false; }
  }, { timeout: 15_000 });

  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = (b) => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then((r) => r.json());
  const pull = async (nb) => (await fetch(base + '/api/sync/pull?nb=' + encodeURIComponent(nb) + '&since=0')).json();
  const imageOps = async (nb) => ((await pull(nb)).ops || []).filter((o) => o.data && o.data.type === 'image');

  const seedNote = async (title) => {
    const nb = (await q({ table: 'notebooks', op: 'insert', values: [{ title, color: '#4f6ef7' }], filters: [], returning: true, single: true })).data;
    const seedDoc = { version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {}, pages: [{ id: 'p1', els: [] }] };
    await q({ table: 'memos', op: 'insert', values: [{ notebook_id: nb.id, content: JSON.stringify(seedDoc), font_size: 16 }], filters: [] });
    return nb.id;
  };

  // ══════ U · 직렬화 정책(공유 상태 위생) — 순수 함수 ══════
  console.log('\n[U] serverImageElement — 공유 상태에는 확정 url 만');
  const devA = await boot();
  await appReady(devA);
  const winA = devA.window;
  {
    const done = winA.serverImageElement({ type: 'image', id: 'u1', url: '/api/img/img_ok.webp', localURL: 'data:image/png;base64,AA', pending: true, x: 1, y: 1, w: 10, h: 10 });
    check('U-01 확정 url 이 있으면 url 만 남는다(localURL·pending 제거)', done.url === '/api/img/img_ok.webp' && !('localURL' in done) && !('pending' in done));
    const legacy = winA.serverImageElement({ type: 'image', id: 'u2', url: '', localURL: PNG_DATA_URL, pending: true, x: 1, y: 1, w: 10, h: 10 });
    check('U-02 레거시 data: 원본은 복구용으로만 보존된다', String(legacy.localURL).startsWith('data:image/') && !('pending' in legacy));
    check('U-03 blob: 소스는 절대 공유하지 않는다(null)', winA.serverImageElement({ type: 'image', id: 'u3', url: '', localURL: 'blob:dead', x: 1, y: 1, w: 10, h: 10 }) === null);
    check('U-04 소스 없는 이미지는 공유하지 않는다(null)', winA.serverImageElement({ type: 'image', id: 'u4', url: '', pending: true, x: 1, y: 1, w: 10, h: 10 }) === null);
    check('U-05 url 이 blob: 이어도 공유하지 않는다(null)', winA.serverImageElement({ type: 'image', id: 'u5', url: 'blob:dead2', x: 1, y: 1, w: 10, h: 10 }) === null);
  }

  // ══════ S1 · 업로드-선행: 붙여넣기 → 요소는 검증된 서버 url 로만 태어난다 ══════
  console.log('\n[S1] 업로드-선행 배치 (Device A)');
  const NB = '업로드선행v3';
  const nid = await seedNote(NB);
  await openNoteByTitle(devA, NB);
  pasteImage(devA, pngFile(winA));

  const imgNode = await waitFor('A: .paper-img (업로드 완료 후 배치)', () =>
    winA.document.querySelector('#pagesStage .paper-img img') || null);
  check('S1-01 붙여넣은 사진이 화면에 붙는다', !!imgNode);
  const src1 = imgNode.getAttribute('src') || '';
  check('S1-02 요소의 src 가 처음부터 서버 주소(/api/img/…)다', /^\/api\/img\//.test(src1), `src=${src1}`);
  check('S1-03 pending(있었다는 표시) 상태가 존재하지 않는다', !winA.document.querySelector('#pagesStage .paper-img.pending'));

  const ops1 = await waitFor('server: 이미지 op 도착', async () => {
    const o = await imageOps(nid);
    return o.length ? o : null;
  });
  check('S1-04 서버 ops 의 이미지 op 은 확정 url 만 갖는다',
    ops1.length === 1 && ops1[0].data.url === src1 && !('localURL' in ops1[0].data) && !('pending' in ops1[0].data),
    JSON.stringify(ops1.map((o) => o.data)));
  const rawGet = await fetch(base + src1);
  const bytes1 = Buffer.from(await rawGet.arrayBuffer());
  check('S1-05 그 주소는 세션 없는 순수 HTTP 로도 읽힌다', rawGet.ok && (rawGet.headers.get('content-type') || '').startsWith('image/') && bytes1.length > 0);

  // ══════ S2 · 보낸 기기 사망 → 새 기기(빈 localStorage)가 그대로 읽는다 ══════
  console.log('\n[S2] 업로더 세션 파괴 후 새 기기');
  await killDevice(devA);
  const devB = await boot();
  await appReady(devB);
  await openNoteByTitle(devB, NB);
  const bImg = await waitFor('B: 사진 렌더', () => {
    const im = devB.window.document.querySelector('#pagesStage .paper-img img');
    return im && /^\/api\/img\//.test(im.getAttribute('src') || '') ? im : null;
  });
  check('S2-01 새 기기가 서버 주소로 사진을 그린다', bImg.getAttribute('src') === src1);
  check('S2-02 pending/failed 표시가 없다',
    !devB.window.document.querySelector('#pagesStage .paper-img.pending') &&
    !devB.window.document.querySelector('#pagesStage .paper-img.failed'));

  // ══════ S3 · 업로드 실패 = 아무것도 놓지 않는다 (깨진 자리 원천 차단) ══════
  console.log('\n[S3] /api/upload 절단 상태에서 붙여넣기 (Device C)');
  const devC = await boot({ block: ['/api/upload'] });
  await appReady(devC);
  await openNoteByTitle(devC, NB);
  await waitFor('C: 기존 사진 1장 렌더', () =>
    devC.window.document.querySelectorAll('#pagesStage .paper-img').length === 1 || null);
  pasteImage(devC, pngFile(devC.window, 'paste-offline.png'));
  await waitFor('C: 업로드 실패 알림', () => {
    const t = devC.window.document.getElementById('toast');
    return t && /업로드 실패/.test(t.textContent || '') ? true : null;
  }, { timeout: 30_000 });
  check('S3-01 실패 알림이 사용자에게 보인다', true);
  check('S3-02 화면에 깨진 자리(추가 요소)가 생기지 않는다',
    devC.window.document.querySelectorAll('#pagesStage .paper-img').length === 1);
  const ops3 = await imageOps(nid);
  check('S3-03 서버 ops 에도 새 이미지 op 이 없다(빈 url·blob·data 없음)',
    ops3.length === 1 && ops3.every((o) => /^\/api\/img\//.test(o.data.url || '')),
    JSON.stringify(ops3.map((o) => o.data)));

  // ══════ S4 · 네트워크 복구 후 다시 넣으면 완전 복구 ══════
  console.log('\n[S4] 엔드포인트 복구 후 재시도');
  devC.window.__restoreEndpoint('/api/upload');
  pasteImage(devC, pngFile(devC.window, 'paste-retry.png'));
  await waitFor('C: 두 번째 사진 배치', () =>
    devC.window.document.querySelectorAll('#pagesStage .paper-img').length === 2 || null, { timeout: 30_000 });
  const srcs = [...devC.window.document.querySelectorAll('#pagesStage .paper-img img')].map((i) => i.getAttribute('src') || '');
  check('S4-01 재시도한 사진도 확정 서버 주소로만 배치된다', srcs.length === 2 && srcs.every((s) => /^\/api\/img\//.test(s)), JSON.stringify(srcs));
  const ops4 = await waitFor('server: 이미지 op 2개', async () => {
    const o = await imageOps(nid);
    return o.length === 2 ? o : null;
  });
  check('S4-02 서버 ops 도 2개 모두 확정 url 이다', ops4.every((o) => /^\/api\/img\//.test(o.data.url || '')));
  const newSrc = srcs.find((s) => s !== src1);
  const rawGet2 = await fetch(base + newSrc);
  check('S4-03 새 사진도 순수 HTTP 로 읽힌다', rawGet2.ok && Buffer.from(await rawGet2.arrayBuffer()).length > 0);

  // ══════ E · 전 기기 무결성 ══════
  const allErr = [...doms, ...closedDoms].flatMap((d) => d.__errors || []);
  check('E-01 모든 기기(종료된 기기 포함)에서 치명적 오류 없음', allErr.length === 0, allErr.join(' | ').slice(0, 500));

  console.log(`\n업로드-선행 이미지 계약: PASS ${pass}`);
} catch (e) {
  console.error('FAIL: ' + (e && e.stack || e));
  process.exitCode = 1;
  throw e;
} finally {
  try { child.kill('SIGTERM'); } catch {}
  await closeDoms(doms);
}
