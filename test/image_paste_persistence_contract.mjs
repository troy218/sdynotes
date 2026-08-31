/* 18.11 · 클립보드 이미지 붙여넣기 → "보낸 기기가 꺼져도 사진은 남아 있어야 한다" 계약
   ---------------------------------------------------------------------------
   QA 보고(재현 시나리오):
     "Device A 에서 이미지를 붙여넣으면 Device B 에 실시간으로 즉시 보인다.
      그런데 A 가 접속을 끊거나 세션을 닫으면 B(및 이후 새로 접속하는 기기)에서
      더 이상 그 이미지를 불러올 수 없다(깨진 참조/빈 자리)."

   근본 원인(요약 — docs/image_paste_persistence_bug.md 참조):
     붙여넣기는 '즉시 렌더'를 위해 로컬 소스(localURL: blob:/data:)로 pending 요소를
     먼저 만들고, 실제 저장(/api/upload → /api/img/…)은 백그라운드 큐가 나중에 확정한다.
       · blob: Object URL 은 그 문서(보낸 기기의 탭)가 닫히는 순간 소멸한다 →
         다른 기기에서는 절대 불러올 수 없다.
       · 업로드가 끝나기 전에 A 가 끊기면 확정 URL op 이 서버에 못 온다 →
         다른 기기에는 '있었다는 표시'(pending placeholder)만 남는다.
       · 업로드는 끝났어도 '어느 요소가 이 URL 인지' op 전송이 끊기면 취소된다 →
         서버엔 파일이 있어도 아무도 참조하지 못한다.

   이 계약이 지키는 방어(회귀 방지):
     ① op 직렬화(serverImageElement): url 이 없으면 data: 원본을 op 에 함께 싣는다.
     ② url 확정 op 은 localStorage 내구성 outbox(queueImageMetaPut)를 탄다.
     ③ data: 원본이 남은 pending 이미지는 '어느 기기에서 열든' 자동 재업로드된다.
     ④ 채팅 첨부는 업로더 세션이 아니라 서버 저장소에서 제공돼야 한다.

   실행 규칙(SLA) — 임의 고정 sleep 금지:
     이 파일에는 '충분히 기다렸으면 됐겠지'식의 고정 지연(await sleep(N))이 하나도
     없다. 모든 대기는 다음 두 프리미티브로만 이루어진다:
       · waitFor(desc, predicate) — 조건이 참이 되는 순간 즉시 반환하는 스마트 폴링
         (적응형 백오프 0→1→2→…→16ms, 마감 임계값만 존재)
       · waitForSelector(...)    — MutationObserver 기반 이벤트 구동 대기(폴링 없음)
     네트워크 왕복·디바운스(180/400ms)는 전부 조건 폴링으로 소비하므로, 시나리오가
     빨리 끝나면 테스트도 그만큼 빨리 끝난다. */
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

// ══════════════════════════════════════════════════════════════════
// 0 · 무지연(zero-sleep) 비동기 프리미티브
// ══════════════════════════════════════════════════════════════════

// 이벤트 루프 양보 — 시계를 기다리지 않는다(0ms). I/O·타이머 완료 통지를 받는다.
const tick = () => new Promise((r) => setImmediate(r));

// 조건이 참이 되는 즉시 반환. 고정 settle-지연이 아니라 마감 임계값만 있다.
// 백오프는 CPU 점유를 줄이기 위한 적응형 값(0→1→2→4→…→16ms 상한)일 뿐,
// 시나리오 정확성은 오직 predicate 가 결정한다.
async function waitFor(what, predicate, { timeout = 20_000 } = {}) {
  const deadline = Date.now() + timeout;
  let backoff = 0;
  for (;;) {
    const v = await predicate();            // predicate 예외는 즉시 전파(빠른 실패)
    if (v) return v;
    assert.ok(Date.now() < deadline, `timeout waiting for: ${what}`);
    await (backoff ? new Promise((r) => setTimeout(r, backoff)) : tick());
    backoff = backoff ? Math.min(backoff * 2, 16) : 1;
  }
}

// DOM 구조 대기 — MutationObserver 이벤트 구동(폴링 없음, 삽입 즉시 해결).
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

// ══════════════════════════════════════════════════════════════════
// 1 · 테스트 픽스처: 서버 + JSDOM '기기'
// ══════════════════════════════════════════════════════════════════

// 1×1 투명 PNG — 실제 디코딩 가능한 바이트여야 서버의 sharp 재인코딩이 성공한다.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_B64, 'base64');
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`;
// paste 파일은 '기기(window) 렬름'의 File 이어야 한다 — jsdom FileReader 가
// jsdom-native Blob 만 받아들이기 때문(compressImg·fileToDataURL 경로).
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

const doms = [];        // 아직 살아 있는 '기기' 목록 (finally 에서 정리)
const closedDoms = [];  // 시나리오 도중 접속을 끊은 기기(오류 수집 결과 검증용)

// JSDOM 공용 스텁 — 기존 이미지 계약 테스트의 검증된 세트 + Image/canvas 스텁.
//   실측(checked): jsdom 은 data:/blob: URL 을 가진 <img> 에 load/error 를
//   절대 발화하지 않는다. 붙여넣기 즉시 미리보기 경로(imageNaturalSize·
//   compressImg)가 영원히 대기하지 않도록 브라우저 계약을 흉내 낸다.
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
      window.requestIdleCallback = (cb) => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
      window.cancelIdleCallback = clearTimeout;
      window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
      window.cancelAnimationFrame = clearTimeout;
      window.Audio = class { constructor() { this.paused = true; } play() { return Promise.resolve(); } pause() {} addEventListener() {} removeEventListener() {} };
      // canvas: jsdom 은 래스터화를 못 한다 → 2D 컨텍스트·blob 내보내기를 스텁.
      window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}, save() {}, restore() {}, scale() {}, translate() {}, setTransform() {}, measureText() { return { width: 10 }; }, getImageData() { return { data: new Uint8ClampedArray(4) }; }, putImageData() {} });
      window.HTMLCanvasElement.prototype.toBlob = function (cb, type) { cb(new window.Blob([PNG_BYTES], { type: type || 'image/png' })); };
      window.HTMLCanvasElement.prototype.toDataURL = () => PNG_DATA_URL;
      // Image: data: src → 다음 마이크로태스크에 onload(64×48), 그 외 → onerror.
      class FakeImage {
        constructor() { this.width = 0; this.height = 0; this.naturalWidth = 0; this.naturalHeight = 0; this.complete = false; this.onload = null; this.onerror = null; this._src = ''; }
        set src(v) {
          this._src = String(v || '');
          Promise.resolve().then(() => {
            if (this._src.startsWith('data:image/')) {
              this.naturalWidth = 64; this.naturalHeight = 48; this.width = 64; this.height = 48; this.complete = true;
              if (this.onload) { try { this.onload(); } catch (e) { /* app bug → 테스트 오류 수집기로 */ } }
            } else if (this.onerror) {
              try { this.onerror(new window.Event('error')); } catch (e) { /* noop */ }
            }
          });
        }
        get src() { return this._src; }
      }
      window.Image = FakeImage;
      // Object URL: 생성마다 고유 → blob: 누출을 탐지할 수 있다.
      let seq = 0;
      window.URL.createObjectURL = () => `blob:sdynotes-qa-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
      window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      // 주의: File/Blob/FormData 는 jsdom-native 그대로 둔다. 예전 테스트처럼
      // globalThis 것으로 갈아끼우면 jsdom FileReader(compressImg·fileToDataURL)
      // 가 'not of type Blob' 을 던져 data: 폴백이 조용히 죽는다 — 그러면 붙여넣은
      // 그림이 blob: 소스만 남아 '보낸 기기 종료 의존' 버그 상태 그 자체가 되어버린다.
      // (jsdom Blob ↔ Node Blob 경계는 아래 fetch 셈에서 다리를 놓는다.)
      const isJsdomBlobLike = (v) => !!v && typeof v === 'object'
        && (v.constructor?.name === 'File' || v.constructor?.name === 'Blob');
      const blobToNodeFile = (v) => new Promise((resolve, reject) => {
        const fr = new window.FileReader();
        fr.onload = () => resolve(new globalThis.File([Buffer.from(fr.result)], v.name || 'file', { type: v.type || 'application/octet-stream' }));
        fr.onerror = () => reject(fr.error || new Error('blob read failed'));
        fr.readAsArrayBuffer(v);
      });
      // 네트워크 셈: 실제 서버로 통과시키되, 선택한 엔드포인트만 끊는다.
      //   (예: /api/upload 차단 = "큰 바이너리 전송이 끊겼는데 작은 sync 요청은
      //    살아 있는" 부분 연결 상황 — 업로더가 붙여넣기 직후 오프라인이 된 상태)
      const blocked = new Set(block);
      // 시나리오 도중 엔드포인트를 끊었다 복구한다(부분 네트워크 장애 시뮬레이션).
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
        // jsdom FormData → Node FormData 변환(바이너리 파트는 FileReader 로 역직렬화)
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

// '기기 접속 종료' — 세션 파괴(타이머·진행 중 fetch 전부 소멸).
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

// 진짜 사용자 붙여넣기: document paste 이벤트에 clipboardData 로 이미지 File 실어 발사.
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

// ══════════════════════════════════════════════════════════════════
// 2 · 시나리오 실행
// ══════════════════════════════════════════════════════════════════
try {
  // ── 서버 기동(헬스체크 폴링 — 각 시도는 실제 네트워크 이벤트) ──
  await waitFor('server /api/health', async () => {
    if (child.exitCode !== null) throw new Error('server died during boot: ' + log.slice(-500));
    try { return (await fetch(base + '/api/health')).ok; } catch { return false; }
  }, { timeout: 15_000 });

  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = (b) => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then((r) => r.json());
  const pushOps = (nb, ops) => fetch(base + '/api/sync/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nb, ops }) }).then((r) => r.json());
  const pull = async (nb) => (await fetch(base + '/api/sync/pull?nb=' + encodeURIComponent(nb) + '&since=0')).json();
  const opFor = async (nb, id) => ((await pull(nb)).ops || []).find((o) => o.id === id) || null;

  const seedNote = async (title) => {
    const nb = (await q({ table: 'notebooks', op: 'insert', values: [{ title, color: '#4f6ef7' }], filters: [], returning: true, single: true })).data;
    const seedDoc = { version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {}, pages: [{ id: 'p1', els: [] }] };
    await q({ table: 'memos', op: 'insert', values: [{ notebook_id: nb.id, content: JSON.stringify(seedDoc), font_size: 16 }], filters: [] });
    return nb.id;
  };

  const devU = await boot();
  await appReady(devU);
  const W = devU.window;

  // ── A · 단위 계약: 렌더 정책 + op 직렬화 정책 ─────────────────────
  console.log('\n── A. 단위: 로컬 우선 렌더·op 직렬화 정책 ──');
  {
    const n1 = W.buildImageEl({ type: 'image', id: 'u1', url: '', localURL: PNG_DATA_URL, pending: true, x: 0, y: 0, w: 64, h: 48 }, 0);
    check('U-01 pasted image renders instantly from the local source (pending, no upload round-trip)',
      n1.classList.contains('pending') && n1.querySelector('img').getAttribute('src') === PNG_DATA_URL);
    const n2 = W.buildImageEl({ type: 'image', id: 'u2', url: '/api/img/img_unit.webp', x: 0, y: 0, w: 64, h: 48 }, 0);
    check('U-02 a confirmed element renders directly from the durable server URL',
      n2.querySelector('img').getAttribute('src') === '/api/img/img_unit.webp' && !n2.classList.contains('pending'));

    const serP = W.serverImageElement({ type: 'image', id: 'u3', url: '', localURL: PNG_DATA_URL, pending: true, x: 0, y: 0, w: 1, h: 1 });
    check('U-03 op keeps the data: original while url is unset (durable fallback for other devices)',
      String(serP.localURL || '').startsWith('data:image/'));
    check('U-03 volatile flags (pending/failed) never leave the device', !('pending' in serP) && !('failed' in serP));
    const serD = W.serverImageElement({ type: 'image', id: 'u4', url: '/api/img/img_unit2.webp', localURL: PNG_DATA_URL, x: 0, y: 0, w: 1, h: 1 });
    check('U-04 once the durable url is set, the local source is dropped from the op',
      !('localURL' in serD) && serD.url === '/api/img/img_unit2.webp');
    const serB = W.serverImageElement({ type: 'image', id: 'u5', url: '', localURL: 'blob:http://device-a/dead-beef', pending: true, x: 0, y: 0, w: 1, h: 1 });
    check('U-05 blob: object URLs never leave the device (unrecoverable by definition)',
      !('localURL' in serB) && !('pending' in serB));
    const serBU = W.serverImageElement({ type: 'image', id: 'u6', url: 'blob:http://device-a/dead-beef', x: 0, y: 0, w: 1, h: 1 });
    check('U-05 a blob: value smuggled into url is sanitized to empty', String(serBU.url || '') === '');
  }

  // ── B · 버그 상태 재현(결정적): 접속 종료 의존 가시성 ─────────────
  //  고의로 '깨진 참조' op 을 서버에 심는다(수정 전 클라이언트가 만들던 상태):
  //   · url 없음 + localURL 도 없음 → 다른 기기엔 빈 src (pre-18.8 직렬화)
  //   · url 없음 + blob: localURL  → 보낸 문서가 죽으면 죽은 참조
  console.log('\n── B. 버그 상태 재현: 보낸 기기 종료 의존 가시성 ──');
  {
    const nbBug = await seedNote('QA-BugRepro');
    await pushOps(nbBug, [
      { id: 'bug-empty', kind: 'put', page: 0, rev: 1.1, dev: 'old-client', data: { type: 'image', id: 'bug-empty', url: '', x: 20, y: 20, w: 100, h: 80 } },
      { id: 'bug-blob', kind: 'put', page: 0, rev: 1.2, dev: 'old-client', data: { type: 'image', id: 'bug-blob', url: '', localURL: 'blob:http://device-a/gone-forever', x: 140, y: 20, w: 100, h: 80 } },
    ]);
    await openNoteByTitle(devU, 'QA-BugRepro');
    const nEmpty = await waitForSelector(devU, '#pagesStage .paper-img[data-id="bug-empty"]');
    const nBlob = await waitForSelector(devU, '#pagesStage .paper-img[data-id="bug-blob"]');
    check('B-01 BUG STATE: op without url/localURL renders an empty src (broken reference, nothing to load)',
      (nEmpty.querySelector('img').getAttribute('src') || '') === '');
    check('B-02 BUG STATE: blob: localURL survives into the receiving device as a dead reference',
      (nBlob.querySelector('img').getAttribute('src') || '').startsWith('blob:'));
    check('B-03 BUG STATE: neither broken element can ever be repaired (no data: source → auto-reupload skips them)',
      !W.serverImageElement({ type: 'image', id: 'x', url: '', localURL: '' }).localURL);
  }

  // ── C · E2E 정상 경로: 붙여넣기 → 업로드 → 보낸 기기 종료 후에도 로드 ──
  console.log('\n── C. E2E 정상 경로: 붙여넣기 → 영속 URL → 발신자 오프라인 ──');
  let urlA = '';
  {
    const nbA = await seedNote('QA-Paste-A');
    const devA = await boot();
    await appReady(devA);
    await openNoteByTitle(devA, 'QA-Paste-A');
    pasteImage(devA, pngFile(devA.window));

    const nodeA = await waitForSelector(devA, '#pagesStage .paper-img[data-id]');
    const imgId = nodeA.dataset.id;
    check('E-01 pasted image is placed on the canvas immediately (local placement, no upload gate)',
      !!nodeA.querySelector('img'));

    // 발신자 화면이 영속 URL 로 전환되는 순간까지(디바운스+업로드 왕복을 조건으로 소비)
    await waitFor(`sender img src becomes durable /api/img/ url (${imgId})`, () => {
      const el = devA.window.document.querySelector(`#pagesStage .paper-img[data-id="${imgId}"] img`);
      const s = (el && el.getAttribute('src')) || '';
      return s.startsWith('/api/img/') ? s : null;
    });
    const opA = await waitFor(`server op carries the durable url (${imgId})`, async () => {
      const op = await opFor(nbA, imgId);
      return op && op.data && String(op.data.url || '').startsWith('/api/img/') ? op : null;
    });
    urlA = opA.data.url;
    check('E-02 the durable url is persisted in the server ops store (not just the sender screen)', urlA.startsWith('/api/img/'));
    check('E-02 no blob: localURL is persisted in the durable op', !String(opA.data.localURL || '').startsWith('blob:'));

    const rA = await fetch(base + urlA);
    const bytesA = Buffer.from(await rA.arrayBuffer());
    check('E-03 the asset is servable from server storage over HTTP',
      rA.status === 200 && (rA.headers.get('content-type') || '').includes('image/') && bytesA.length > 0);

    // ★ 발신자(Device A) 세션 파괴 — 버그 보고의 트리거 조건
    await killDevice(devA);

    const devB = await boot();
    await appReady(devB);
    await openNoteByTitle(devB, 'QA-Paste-A');
    const imgB = await waitForSelector(devB, `#pagesStage .paper-img[data-id="${imgId}"] img`);
    check('E-04 a fresh device renders the image from the server url after the sender is gone',
      imgB.getAttribute('src') === urlA);
    check('E-04 no pending/failed placeholder on the fresh device',
      !imgB.closest('.paper-img').classList.contains('pending') && !imgB.closest('.paper-img').classList.contains('failed'));
    await killDevice(devB);
  }

  // ── D · E2E 버그 조건: 업로드 완료 전 발신자 오프라인 → 다른 기기가 복구 ──
  console.log('\n── D. E2E 버그 조건: 업로드 전 발신자 오프라인 → 수신 기기 자가 복구 ──');
  {
    const nbB = await seedNote('QA-Paste-B');
    // /api/upload 만 끊는다: 작은 sync op 은 살아 있어 "B 에 실시간으로 보인다"는
    // 전제를 유지하면서, 바이너리 업로드는 절대 끝나지 않는다(접속 종료 직전 상태).
    const devA2 = await boot({ block: ['/api/upload'] });
    await appReady(devA2);
    await openNoteByTitle(devA2, 'QA-Paste-B');
    pasteImage(devA2, pngFile(devA2.window, 'paste-offline.png'));

    const nodeA2 = await waitForSelector(devA2, '#pagesStage .paper-img[data-id]');
    const imgId2 = nodeA2.dataset.id;
    check('E-05 sender sees the pasted image instantly even though the upload can never finish',
      nodeA2.classList.contains('pending') && /^(data:|blob:)/.test(nodeA2.querySelector('img').getAttribute('src') || ''));

    // 접속이 끊기기 전, pending op 이 data: 원본을 싣고 서버에 도착해야 한다.
    const pendOp = await waitFor(`pending op with data: fallback reaches server (${imgId2})`, async () => {
      const op = await opFor(nbB, imgId2);
      return op && op.data && String(op.data.url || '') === '' && String(op.data.localURL || '').startsWith('data:image/') ? op : null;
    });
    check('E-05 the op that reaches the server carries the data: original (this is what Device B sees in real time)',
      String(pendOp.data.localURL || '').startsWith('data:image/'));
    check('E-05 no premature durable url exists yet (upload really could not finish)',
      String(pendOp.data.url || '') === '');

    // ★ 발신자가 이 시점에 완전히 오프라인 — 수정 전이라면 여기서 자산이 죽는다.
    await killDevice(devA2);

    const devB2 = await boot();
    await appReady(devB2);
    await openNoteByTitle(devB2, 'QA-Paste-B');
    const nodeB2 = await waitForSelector(devB2, `#pagesStage .paper-img[data-id="${imgId2}"]`);
    check('E-06 the receiving device still shows the image although the sender is offline for good',
      /^(data:image\/|\/api\/img\/)/.test(nodeB2.querySelector('img').getAttribute('src') || ''));

    // 수신 기기 자가 복구: data: 원본을 스스로 서버에 올리고 영속 URL 을 확정한다.
    const repairedUrl = await waitFor(`receiving device repairs the asset (durable src, ${imgId2})`, () => {
      const el = devB2.window.document.querySelector(`#pagesStage .paper-img[data-id="${imgId2}"] img`);
      const s = (el && el.getAttribute('src')) || '';
      return s.startsWith('/api/img/') ? s : null;
    });
    const opB2 = await waitFor(`repaired url persisted server-side (${imgId2})`, async () => {
      const op = await opFor(nbB, imgId2);
      return op && op.data && String(op.data.url || '').startsWith('/api/img/') ? op : null;
    });
    check('E-06 the repair is persisted to the server ops store (identical url on screen and in storage)',
      opB2.data.url === repairedUrl);

    // 세 번째 기기: 오직 서버 저장소만으로 이미지를 불러온다.
    const devC = await boot();
    await appReady(devC);
    await openNoteByTitle(devC, 'QA-Paste-B');
    const imgC = await waitForSelector(devC, `#pagesStage .paper-img[data-id="${imgId2}"] img`);
    check('E-07 a brand-new device loads the image purely from server storage',
      imgC.getAttribute('src') === opB2.data.url && !imgC.closest('.paper-img').classList.contains('pending'));
    const rC = await fetch(base + opB2.data.url);
    check('E-07 the repaired asset is fetchable over HTTP after the original sender is gone', rC.ok);
    await killDevice(devC);
    await killDevice(devB2);
  }

  // ── E · 통합: url 확정 op 내구성 아웃박스 ──────────────────────────
  console.log('\n── E. 통합: url 확정 op 내구성 아웃박스 ──');
  {
    const nbD = await seedNote('QA-Outbox');
    const opD = { id: 'qa-obx', kind: 'put', page: 0, rev: 2.5, dev: 'qa', data: { type: 'image', id: 'qa-obx', url: '/api/img/img_outbox_qa.webp', x: 1, y: 1, w: 5, h: 5 } };
    W.queueImageMetaPut(nbD, opD);
    check('I-01 url-fix op is recorded in the durable outbox (localStorage survives reload)',
      (W.getImageMetaOutbox() || []).some((x) => x.nbId === nbD && x.op && x.op.id === 'qa-obx')
        && String(W.localStorage.getItem('sdy_imgmeta_outbox') || '').includes('qa-obx'));
    await W.flushImageMetaOutbox();
    const opSrv = await opFor(nbD, 'qa-obx');
    check('I-02 flush delivers the url-fix op to the server ops store',
      !!opSrv && opSrv.data && opSrv.data.url === '/api/img/img_outbox_qa.webp');
    check('I-03 delivered entries are cleared from the outbox (no duplicate retries)',
      !(W.getImageMetaOutbox() || []).some((x) => x.op && x.op.id === 'qa-obx'));

    // 접속 끊김(ops push 만 끊긴 상태) → outbox 항목은 살아남고, 복구되면 그대로 전달.
    W.__severEndpoint('/api/sync/push');
    const opR = { id: 'qa-obx-retry', kind: 'put', page: 0, rev: 3.5, dev: 'qa', data: { type: 'image', id: 'qa-obx-retry', url: '/api/img/img_retry_qa.webp', x: 2, y: 2, w: 5, h: 5 } };
    W.queueImageMetaPut(nbD, opR);
    await W.flushImageMetaOutbox();
    check('I-03 a severed connection leaves the url-fix op in the durable outbox (no data loss)',
      (W.getImageMetaOutbox() || []).some((x) => x.op && x.op.id === 'qa-obx-retry'));
    check('I-03 the op did NOT reach the server while severed', !(await opFor(nbD, 'qa-obx-retry')));
    W.__restoreEndpoint('/api/sync/push');
    await W.flushImageMetaOutbox();
    const opR2 = await opFor(nbD, 'qa-obx-retry');
    check('I-03 after reconnection the surviving op is delivered and cleared',
      !!opR2 && opR2.data && opR2.data.url === '/api/img/img_retry_qa.webp'
        && !(W.getImageMetaOutbox() || []).some((x) => x.op && x.op.id === 'qa-obx-retry'));
  }

  // ── F · 통합(채팅 첨부): 자산 수명은 업로더 세션과 무관해야 한다 ──
  console.log('\n── F. 통합(채팅): 자산 수명 ≠ 업로더 세션 ──');
  {
    const uid = 'qa-img-' + Math.random().toString(36).slice(2, 8);
    const join = await (await fetch(base + '/api/chat/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid, name: 'QA Sender ' + uid.slice(-4) }) })).json();
    check('I-04 chat: sender joins the room', !!(join && join.ok));

    const fd = new FormData();
    fd.append('uid', uid);
    fd.append('file', pngFile(null, 'chat-paste.png'), 'chat-paste.png');
    const up = await (await fetch(base + '/api/chat/upload', { method: 'POST', body: fd })).json();
    check('I-04 chat: pasted image upload returns a message bound to a server-side file id',
      !!(up && up.ok && up.msg && up.msg.file && up.msg.file.id));
    const fileId = up.msg.file.id;

    // ★ 발신자 퇴장(접속 종료와 동등)
    await fetch(base + '/api/chat/leave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid }) });
    const rFile = await fetch(base + '/api/chat/file/' + fileId);
    const got = Buffer.from(await rFile.arrayBuffer());
    check('I-05 chat: the image remains fully loadable after the sender left (byte-exact)',
      rFile.status === 200 && got.equals(PNG_BYTES));
    const r404 = await fetch(base + '/api/chat/file/does-not-exist');
    check('I-06 chat: unknown file ids fail fast with 404 (no phantom assets)', r404.status === 404);
  }

  // ── G · 치명적 런타임 오류 없음 ──────────────────────────────────
  const allDoms = [...doms, ...closedDoms];
  check('E-08 no fatal runtime errors on any device',
    allDoms.every((d) => (d.__errors || []).length === 0),
    allDoms.map((d) => (d.__errors || []).join(' | ')).filter(Boolean).join(' || '));

  console.log(`\n이미지 붙여넣기 영속성(보낸 기기 오프라인): PASS ${pass}`);
} catch (e) {
  console.error('FAIL: ' + ((e && e.stack) || e));
  throw e;
} finally {
  try { child.kill('SIGTERM'); } catch { /* noop */ }
  await closeDoms(doms, { tailMs: 0 });
}
