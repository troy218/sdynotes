/* 18.4 · 노트 사진: 재접속/서버 업데이트 뒤 '사진이 있었다는 표시'만 남는 계약
   ---------------------------------------------------------------------------
   회귀: 이미지 업로드가 끝날 무렵 그 노트가 닫혀 있으면
     · memo(전체 스냅샷)는 업로드 완료 상태(url=/api/img/…)로 고쳐지지만
     · 요소 ops 스토어(/api/sync/push)에는 업로드 전 상태(pending·url:'')가 남는다.
   다시 접속해 노트를 열면 openNB 가 memo 를 먼저 적용한 뒤 initSync 가 ops 를
   pull 하는데, 그 '옛 pending op'가 최신 memo 상태를 덮어써 사진 자리에
   회전 표시(있었다는 표시)만 남았다.

   ① 시나리오 A(버그 상태): memo=완료 / ops=옛 pending → 열면 진짜 사진이
     보여야 하고, 서버 ops 스토어도 스스로 완료 상태로 복구돼야 한다.
   ② 시나리오 B(정상 상태): memo=pending / ops=완료 → 열면 ops 가 이겨서
     진짜 사진이 보여야 한다 (기존 회귀 방지). */
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
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };
async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-img-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
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
try {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died: ' + log.slice(-400));
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }

  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = (b) => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then((r) => r.json());
  const push = (nb, ops) => fetch(base + '/api/sync/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nb, ops }),
  }).then((r) => r.json());
  const pull = async (nb) => (await fetch(base + '/api/sync/pull?nb=' + nb + '&since=0')).json();

  async function seedNote(title, memoImg, opImg) {
    const ins = await q({ table: 'notebooks', op: 'insert', values: [{ title, color: '#4f6ef7' }], filters: [], returning: true, single: true });
    const nid = ins.data.id;
    const seedDoc = {
      version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
      pages: [{ id: 'p1', els: memoImg ? [memoImg] : [] }],
    };
    await q({ table: 'memos', op: 'insert', values: [{ notebook_id: nid, content: JSON.stringify(seedDoc), font_size: 16 }], filters: [] });
    if (opImg) await push(nid, [{ id: opImg.id, kind: 'put', page: 0, rev: 1.001, data: opImg, dev: 'test' }]);
    return nid;
  }

  // ── 시나리오 A: memo=업로드 완료 / ops=옛 pending (버그 상태 재현) ──
  const REAL = { type: 'image', id: 'imA', url: '/api/img/img_deadbeef.webp', x: 48, y: 48, w: 200, h: 150 };
  const STALE = { type: 'image', id: 'imA', url: '', localURL: 'blob:dead', pending: true, x: 48, y: 48, w: 200, h: 150 };
  const nidA = await seedNote('사진 재접속 A', REAL, STALE);

  // ── 시나리오 B: memo=pending / ops=완료 (정상 상태) ──
  const B_STALE = { type: 'image', id: 'imB', url: '', localURL: 'blob:dead2', pending: true, x: 48, y: 48, w: 200, h: 150 };
  const B_REAL = { type: 'image', id: 'imB', url: '/api/img/img_cafebabe.webp', x: 48, y: 48, w: 200, h: 150 };
  const nidB = await seedNote('사진 재접속 B', B_STALE, B_REAL);

  const common = () => ({
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      installWindowGuard(window);
      window.innerWidth = 1280; window.innerHeight = 800;
      window.matchMedia = (query) => ({ matches: query.includes('pointer:fine'), media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.BroadcastChannel = class { postMessage() {} close() {} addEventListener() {} };
      window.EventSource = class { close() {} addEventListener() {} };
      window.requestIdleCallback = (cb) => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
      window.cancelIdleCallback = clearTimeout;
      window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
      window.cancelAnimationFrame = clearTimeout;
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.HTMLCanvasElement.prototype.getContext = () => ({
        clearRect() {}, drawImage() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
        stroke() {}, arc() {}, fill() {}, save() {}, restore() {}, scale() {}, translate() {},
        setTransform() {}, measureText() { return { width: 10 }; }, getImageData() { return { data: new Uint8ClampedArray(4) }; }, putImageData() {},
      });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class { constructor() { this.paused = true; } play() { return Promise.resolve(); } pause() {} addEventListener() {} removeEventListener() {} };
      window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
    },
  });

  async function boot() {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', (e) => {
      const m = String(e?.message || e);
      if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errors.push(m);
    });
    vc.on('error', (...a) => errors.push(a.join(' ')));
    const d = await JSDOM.fromURL(base + '/', { ...common(), virtualConsole: vc });
    d.window.addEventListener('error', (e) => errors.push(e.error?.stack || e.message));
    d.window.addEventListener('unhandledrejection', (e) => errors.push('unhandled: ' + (e.reason?.stack || e.reason)));
    d.__errors = errors; doms.push(d);
    return d;
  }
  async function openNote(d, nid) {
    const { document } = d.window;
    const want = String(nid || '');
    const untilCard = Date.now() + 8_000;
    let card = null;
    while (Date.now() < untilCard && !card) {
      card = [...document.querySelectorAll('.note-stack .note-card')].find((c) => String(c.dataset.nbId || '') === want);
      if (!card) await wait(60);
    }
    check('홈에 ' + want + ' 카드가 보인다', !!card);
    card.dispatchEvent(new d.window.MouseEvent('click', { bubbles: true }));
    const untilOpen = Date.now() + 6_000;
    while (Date.now() < untilOpen && !document.getElementById('editorView').classList.contains('open')) await wait(60);
    check(want + ' 노트가 열린다', document.getElementById('editorView').classList.contains('open'));
  }

  const dom = await boot();

  /* ══ 시나리오 A ══ */
  await openNote(dom, nidA);
  const untilImg = Date.now() + 6_000;
  let imgEl = null;
  while (Date.now() < untilImg && !imgEl) {
    imgEl = dom.window.document.querySelector('.paper-img[data-id="imA"] img');
    if (!imgEl) await wait(80);
  }
  check('A: 사진 요소가 그려진다', !!imgEl);
  check('A: 사진 src 가 진짜 URL 이다', imgEl && imgEl.getAttribute('src') === '/api/img/img_deadbeef.webp');
  const boxA = dom.window.document.querySelector('.paper-img[data-id="imA"]');
  check('A: pending(있었다는 표시) 클래스가 없다', boxA && !boxA.classList.contains('pending'));

  // 서버 ops 스토어가 스스로 완료 상태로 복구됐는지 (다른 기기 재접속 대비)
  let healed = false;
  const untilHeal = Date.now() + 6_000;
  while (Date.now() < untilHeal && !healed) {
    const pr = await pull(nidA);
    const op = (pr.ops || []).find((o) => o.id === 'imA');
    healed = !!(op && op.data && op.data.url === '/api/img/img_deadbeef.webp' && !op.data.pending);
    if (!healed) await wait(150);
  }
  check('A: 서버 ops 스토어도 진짜 URL 로 복구된다', healed);

  /* ══ 시나리오 B ══ */
  await openNote(dom, nidB);
  // 첫 렌더는 memo(pending)로 뜰 수 있다. initSync(60ms 후)가 ops(완료)를
  // pull 하면 진짜 URL 로 다시 그려져야 한다 — 최대 8초 폴링으로 잰다.
  const untilImgB = Date.now() + 8_000;
  let imgB = null;
  while (Date.now() < untilImgB) {
    imgB = dom.window.document.querySelector('.paper-img[data-id="imB"] img');
    if (imgB && imgB.getAttribute('src') === '/api/img/img_cafebabe.webp') break;
    await wait(80);
  }
  check('B: 사진 요소가 그려진다', !!imgB);
  const boxB = dom.window.document.querySelector('.paper-img[data-id="imB"]');
  check('B: ops(완료)가 이겨서 진짜 URL 이 보인다', imgB && imgB.getAttribute('src') === '/api/img/img_cafebabe.webp');
  check('B: pending 클래스가 없다', boxB && !boxB.classList.contains('pending'));
  check('런타임 오류 없음', dom.__errors.length === 0);

  console.log(`노트 사진 재접속 계약: PASS ${pass}`);
} catch (e) {
  console.error('FAIL:', e.message);
  console.error((e.stack || '').split('\n').slice(0, 4).join('\n'));
} finally {
  try { child.kill('SIGTERM'); } catch {}
  await wait(300);
  try { child.kill('SIGKILL'); } catch {}
  closeDoms(doms);
  process.exit(0);
}
