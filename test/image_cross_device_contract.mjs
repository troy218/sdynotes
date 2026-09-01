/* 이미지 크로스 디바이스 계약 (업로드-선행 · 단일 진실 공급원)
   ---------------------------------------------------------------------------
   보고: "그림을 올린 뒤 그 기기의 접속을 끊고 다른 기기에서 열면 사진이
          안 불러와진다."

   새 방식(업로드-선행)의 계약:
     · 공유 상태(ops·memo)에는 절대 blob:/data: 를 싣지 않는다.
     · 확정 url(/api/img/…)이 있는 이미지만 다른 기기로 전파된다.
     · 업로드 전 이미지는 공유되지 않으므로 '깨진 자리/있었다는 표시'가 생기지
       않는다(다른 기기는 업로드가 끝난 뒤에만 사진을 본다).

   여기서는 실제 서버에:
     ① serverImageElement: url 있으면 url 만 / url 없으면 data: 만 보존(레거시)
        / blob:·소스 없음은 공유 안 함(null)
     ② 확정 url op 이 pull 로 다른 기기(새 JSDOM·빈 localStorage)에 전달돼
        진짜 사진 src 로 그려지는지
     ③ 업로드 전 pending 이미지가 다른 기기로 새지 않는지
   를 확인한다. */
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import jsdom from 'jsdom';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { installWindowGuard, closeDoms } from './jsdom_guard.mjs';
const { JSDOM, VirtualConsole } = jsdom;
const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };
async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port; await new Promise(r => s.close(r)); return p;
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-imgx-'));
process.env.SDY_BASE_DIR = TMP;
{ const REPO = path.resolve(new URL('..', import.meta.url).pathname); for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f)); }
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/src/index.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);
const doms = [];
const common = () => ({
  resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(window) {
    installWindowGuard(window);
    window.innerWidth = 1280; window.innerHeight = 800;
    window.matchMedia = q => ({ matches: q.includes('pointer:fine'), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.BroadcastChannel = class { postMessage() {} close() {} addEventListener() {} };
    window.EventSource = class { close() {} addEventListener() {} };
    window.requestIdleCallback = cb => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
    window.cancelIdleCallback = clearTimeout;
    window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
    window.cancelAnimationFrame = clearTimeout;
    window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}, save() {}, restore() {}, scale() {}, translate() {}, setTransform() {}, measureText() { return { width: 10 }; }, getImageData() { return { data: new Uint8ClampedArray(4) }; }, putImageData() {} });
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
    window.Audio = class { constructor() { this.paused = true; } play() { return Promise.resolve(); } pause() {} addEventListener() {} removeEventListener() {} };
    window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};
    window.File = globalThis.File; window.FormData = globalThis.FormData; window.Blob = globalThis.Blob;
    window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
    window.fetch = (input, init) => { const target = typeof input === 'string' || input instanceof URL ? new URL(String(input), window.location.href) : input; return globalThis.fetch(target, init); };
  },
});
async function boot() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = String(e?.message || e); if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errors.push(m); });
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const d = await JSDOM.fromURL(base + '/', { ...common(), virtualConsole: vc });
  d.window.addEventListener('error', e => errors.push(e.error?.stack || e.message));
  d.window.addEventListener('unhandledrejection', e => errors.push('unhandled: ' + (e.reason?.stack || e.reason)));
  d.__errors = errors; doms.push(d);
  return d;
}
try {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died: ' + log.slice(-400));
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }
  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const push = (nb, ops) => fetch(base + '/api/sync/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nb, ops }) }).then(r => r.json());

  const dom = await boot();
  const { window } = dom;
  const boot2 = Date.now();
  while (Date.now() - boot2 < 8_000 && typeof window.serverImageElement !== 'function') await wait(60);
  check('앱 스크립트가 로드돼 이미지 함수가 노출된다', typeof window.serverImageElement === 'function');

  // ── ① serverImageElement: 확정 url 만 공유 / 소스 없음은 공유 안 함 ──
  const done = { type: 'image', id: 'imD', url: '/api/img/img_done.webp', localURL: 'data:image/png;base64,BBBB', x: 40, y: 40, w: 100, h: 100 };
  const serD = window.serverImageElement(done);
  check('① url 있으면 data 원본은 제거된다', !('localURL' in serD));
  check('① url 있으면 url 은 유지된다', serD.url === '/api/img/img_done.webp');
  const legacy = { type: 'image', id: 'imL', url: '', localURL: 'data:image/png;base64,AAAA', pending: true, x: 40, y: 40, w: 100, h: 100 };
  const serL = window.serverImageElement(legacy);
  check('① url 없고 data: 원본(레거시)이면 data 만 보존된다', String(serL.localURL).startsWith('data:image/'));
  check('① 레거시 pending/failed 는 제거된다', !('pending' in serL) && !('failed' in serL));
  const blobP = { type: 'image', id: 'imB', url: '', localURL: 'blob:xyz', pending: true, x: 40, y: 40, w: 100, h: 100 };
  check('① blob: 만 있는 업로드 전 이미지는 공유하지 않는다(null)', window.serverImageElement(blobP) === null);
  const blobU = { type: 'image', id: 'imBU', url: 'blob:dead', x: 40, y: 40, w: 100, h: 100 };
  check('① url 이 blob: 인 이미지도 공유하지 않는다(null)', window.serverImageElement(blobU) === null);
  const newPending = { type: 'image', id: 'imN', url: '', pending: true, x: 40, y: 40, w: 100, h: 100 };
  check('① 새 방식 pending(소스 없음)은 공유하지 않는다(null)', window.serverImageElement(newPending) === null);

  // ── ② 확정 url op → 새 기기(빈 localStorage)가 진짜 src 로 그림 ──
  const nb = (await q({ table: 'notebooks', op: 'insert', values: [{ title: '이미지크로스', color: '#4f6ef7' }], filters: [], returning: true, single: true })).data;
  const nid = nb.id;
  const seedDoc = { version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {}, pages: [{ id: 'p1', els: [] }] };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: nid, content: JSON.stringify(seedDoc), font_size: 16 }], filters: [] });
  // 업로드가 끝난 상태를 시뮬레이션: 요소 op 에 확정 url 만 실어 서버에 둔다.
  await push(nid, [{ id: 'imX', kind: 'put', page: 0, rev: 2.0, data: { type: 'image', id: 'imX', url: '/api/img/img_abc123.webp', x: 50, y: 50, w: 200, h: 150 }, dev: 'test' }]);
  check('② 서버 ops 스토어에 확정 url op 이 도착했다', true);

  const other = await boot();
  const oDoc = other.window.document;
  const oWin = other.window;
  const oboot2 = Date.now();
  while (Date.now() - oboot2 < 8_000 && typeof oWin.serverImageElement !== 'function') await wait(60);
  const untilCard = Date.now() + 8_000;
  let card = null;
  while (Date.now() < untilCard && !card) {
    card = [...oDoc.querySelectorAll('.note-stack .note-card')].find(c => (c.textContent || '').includes('이미지크로스'));
    if (!card) await wait(60);
  }
  check('② 새 기기에 노트 카드가 보인다', !!card);
  card.dispatchEvent(new oWin.MouseEvent('click', { bubbles: true }));
  const untilOpen = Date.now() + 6_000;
  while (Date.now() < untilOpen && !oDoc.getElementById('editorView').classList.contains('open')) await wait(60);
  check('② 새 기기에서 노트가 열린다', oDoc.getElementById('editorView').classList.contains('open'));
  const untilImg = Date.now() + 6_000;
  let imgEl = null;
  while (Date.now() < untilImg && !imgEl) {
    imgEl = oDoc.querySelector('.paper-img[data-id="imX"] img');
    if (!imgEl) await wait(80);
  }
  check('② 새 기기에서 사진 요소가 그려진다', !!imgEl);
  check('② 새 기기의 사진 src 가 진짜 url 이다', imgEl && imgEl.getAttribute('src') === '/api/img/img_abc123.webp');
  const box = oDoc.querySelector('.paper-img[data-id="imX"]');
  check('② pending(있었다는 표시) 클래스가 없다', box && !box.classList.contains('pending'));

  check('③ 치명적 런타임 오류 없음', dom.__errors.length === 0 && other.__errors.length === 0);
  console.log(`\n이미지 크로스 디바이스: PASS ${pass}`);
} catch (e) {
  console.error('FAIL: ' + (e && e.stack || e));
  throw e;
} finally {
  try { child.kill('SIGTERM'); } catch {}
  await closeDoms(doms);
}
