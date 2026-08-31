/* 18.8 · 이미지 크로스 디바이스 계약 (내구성 outbox + data 원본 라이딩)
   ---------------------------------------------------------------------------
   보고: "그림을 업로드 후, 해당 기기에서 접속을 끊은 후 다른 기기에서 접속하면
          사진이 안불러와진다."

   원인 후보(18.8 에서 방어):
     ① 업로드(/api/upload)는 끝났는데 '어느 노트·어느 요소의 url'인지 op 로
        push 하는 fetch 가 접속 끊김과 함께 취소되면, 다른 기기는 파일은 있어도
        위치·url 을 모른다. → url 확정 즉시 localStorage 내구성 outbox 에 기록하고
        온라인/주기/열기/나가기 때 재전송한다.
     ② 아직 업로드 전(원본 data: 만 있음)인 이미지 op 는 localURL 을 버리고
        가서 다른 기기에서 '있었다는 표시'만 남았다. → serverImageElement 가
        url 이 없으면 data: 원본을 op 에 함께 실어 보낸다. 어느 기기든 표시 +
        자동 재업로드가 된다.

   여기서는 실제 서버에:
     ① serverImageElement: url 없으면 data 유지 / url 있으면 data 제거
     ② 내구성 outbox(queueImageMetaPut → flushImageMetaOutbox)가 진짜 url 을
        서버 ops 스토어에 도착시키는지
     ③ 그 url 을 pull 로 받은 다른 기기(새 JSDOM, 빈 localStorage)가 진짜
        사진 src 로 그리는지
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
  const pull = async (nb) => (await fetch(base + '/api/sync/pull?nb=' + nb + '&since=0')).json();

  const dom = await boot();
  const { window } = dom, { document } = window;
  // defer 스크립트가 실행돼 편집기 함수들이 window 에 노출될 때까지 기다린다.
  const boot2 = Date.now();
  while (Date.now() - boot2 < 8_000 && typeof window.serverImageElement !== 'function') await wait(60);
  check('앱 스크립트가 로드돼 이미지 함수가 노출된다', typeof window.serverImageElement === 'function');

  // ── ① serverImageElement: url 없으면 data 원본 유지 / url 있으면 제거 ──
  const pending = { type: 'image', id: 'imP', url: '', localURL: 'data:image/png;base64,AAAA', pending: true, x: 40, y: 40, w: 100, h: 100 };
  const serP = window.serverImageElement(pending);
  check('① url 비면 data 원본이 op 에 남는다', String(serP.localURL).startsWith('data:image/'));
  check('① url 비면 pending/failed 는 제거된다', !('pending' in serP) && !('failed' in serP));
  const done = { type: 'image', id: 'imD', url: '/api/img/img_done.webp', localURL: 'data:image/png;base64,BBBB', x: 40, y: 40, w: 100, h: 100 };
  const serD = window.serverImageElement(done);
  check('② url 있으면 data 원본은 제거된다', !('localURL' in serD));
  check('② url 있으면 url 은 유지된다', serD.url === '/api/img/img_done.webp');
  const blobP = { type: 'image', id: 'imB', url: '', localURL: 'blob:xyz', pending: true, x: 40, y: 40, w: 100, h: 100 };
  const serB = window.serverImageElement(blobP);
  check('③ blob: 은 다른 기기에서 소용없으므로 버린다', !('localURL' in serB));

  // ── ② 내구성 outbox → 서버 ops 스토어에 진짜 URL 도착 ──
  const nb = (await q({ table: 'notebooks', op: 'insert', values: [{ title: '이미지크로스', color: '#4f6ef7' }], filters: [], returning: true, single: true })).data;
  const nid = nb.id;
  const seedDoc = { version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {}, pages: [{ id: 'p1', els: [] }] };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: nid, content: JSON.stringify(seedDoc), font_size: 16 }], filters: [] });

  // 업로드가 방금 끝났다고 가정 → url 확정 op 를 내구성 outbox 에 넣고 flush
  const op = { id: 'imX', kind: 'put', page: 0, rev: 2.0, data: { type: 'image', id: 'imX', url: '/api/img/img_abc123.webp', x: 50, y: 50, w: 200, h: 150 }, dev: 'test' };
  window.queueImageMetaPut(nid, op);
  check('② outbox 에 op 가 기록된다', (window.getImageMetaOutbox() || []).some(x => x.nbId === nid && x.op.id === 'imX'));
  await window.flushImageMetaOutbox();
  let pr = await pull(nid);
  let got = (pr.ops || []).find(o => o.id === 'imX');
  check('② flushImageMetaOutbox 가 서버 ops 에 진짜 url 을 도착시킨다', !!got && got.data && got.data.url === '/api/img/img_abc123.webp');
  check('② 전송 성공 후 outbox 는 비운다', !(window.getImageMetaOutbox() || []).some(x => x.nbId === nid && x.op.id === 'imX'));

  // ── ③ 다른 기기(새 JSDOM·빈 localStorage)가 그 노트를 열면 진짜 src 로 그림 ──
  const other = await boot();
  const oDoc = other.window.document;
  const oWin = other.window;
  const oboot2 = Date.now();
  while (Date.now() - oboot2 < 8_000 && typeof oWin.serverImageElement !== 'function') await wait(60);
  // 노트를 다시 새로(서버만) 읽기 위해 홈을 갱신
  const untilCard = Date.now() + 8_000;
  let card = null;
  while (Date.now() < untilCard && !card) {
    card = [...oDoc.querySelectorAll('.note-stack .note-card')].find(c => (c.textContent || '').includes('이미지크로스'));
    if (!card) await wait(60);
  }
  check('③ 새 기기에 노트 카드가 보인다', !!card);
  card.dispatchEvent(new oWin.MouseEvent('click', { bubbles: true }));
  const untilOpen = Date.now() + 6_000;
  while (Date.now() < untilOpen && !oDoc.getElementById('editorView').classList.contains('open')) await wait(60);
  check('③ 새 기기에서 노트가 열린다', oDoc.getElementById('editorView').classList.contains('open'));
  const untilImg = Date.now() + 6_000;
  let imgEl = null;
  while (Date.now() < untilImg && !imgEl) {
    imgEl = oDoc.querySelector('.paper-img[data-id="imX"] img');
    if (!imgEl) await wait(80);
  }
  check('③ 새 기기에서 사진 요소가 그려진다', !!imgEl);
  check('③ 새 기기의 사진 src 가 진짜 url 이다', imgEl && imgEl.getAttribute('src') === '/api/img/img_abc123.webp');
  const box = oDoc.querySelector('.paper-img[data-id="imX"]');
  check('③ pending(있었다는 표시) 클래스가 없다', box && !box.classList.contains('pending'));

  check('④ 치명적 런타임 오류 없음', dom.__errors.length === 0 && other.__errors.length === 0);
  console.log(`\n이미지 크로스 디바이스: PASS ${pass}`);
} catch (e) {
  console.error('FAIL: ' + (e && e.stack || e));
  throw e;
} finally {
  try { child.kill('SIGTERM'); } catch {}
  await closeDoms(doms);
}
