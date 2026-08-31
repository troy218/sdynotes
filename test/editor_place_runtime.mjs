/* 텍스트 상자·표 '눌러서 배치' 가 배율(사이트 90% + 종이 확대)과 무관하게
   미리보기(고스트)와 실제 생성 위치를 일치시키는지 실제 DOM 으로 검증한다.

   jsdom 은 레이아웃을 하지 않으므로 종이·배율 프로브의 사각형을 직접 넣어
   데스크톱 조건(html{zoom:.9} + 종이 150% 확대)을 흉내 낸다. */
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
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}

// 14.13.7 · 이 테스트는 반드시 임시 저장소에서 돈다. 예전엔 SDY_BASE_DIR 없이
//   서버가 repo 루트의 db/ 에 노트를 쌓았고, 다음 실행이 '첫 카드'로 그
//   이전 실행이 저장한 표가 든 노트를 열어 '고스트 자리 == 실제 자리' 검사가
//   깨졌다 (가장 앞 .tb 가 표 칸이 됨). 실행마다 깨끗한 저장소 + 새 파일을
//   쓴다.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-place-'));
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
child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);
let dom;
try {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died');
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }

  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const ins = await q({ table: 'notebooks', op: 'insert', values: [{ title: '배치 런타임', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const seedDoc = { version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {}, pages: [{ id: 'p1', els: [] }] };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: ins.data.id, content: JSON.stringify(seedDoc), font_size: 16 }], filters: [] });

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String(e?.message || e);
    if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errors.push(m);
  });
  vc.on('error', (...a) => errors.push(a.join(' ')));
  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      installWindowGuard(window); // 14.13.5 · close 전 타이머 추적
            window.innerWidth = 1280; window.innerHeight = 800;
      window.matchMedia = query => ({ matches: query.includes('pointer:fine'), media: query,
        addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.BroadcastChannel = class { postMessage(){} close(){} addEventListener(){} };
      window.EventSource = class { close(){} addEventListener(){} };
      window.requestIdleCallback = cb => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
      window.cancelIdleCallback = clearTimeout;
      window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
      window.cancelAnimationFrame = clearTimeout;
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function(){};
      window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect(){}, drawImage(){}, fillRect(){}, beginPath(){}, moveTo(){},
        lineTo(){}, stroke(){}, arc(){}, fill(){}, save(){}, restore(){}, scale(){}, translate(){}, setTransform(){},
        measureText(){return {width:10}}, getImageData(){return {data:new Uint8ClampedArray(4)}}, putImageData(){} });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class { constructor(){this.paused=true;} play(){return Promise.resolve()} pause(){} addEventListener(){} removeEventListener(){} };
      window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
      window.addEventListener('error', e => errors.push(e.error?.stack || e.message));
      window.addEventListener('unhandledrejection', e => errors.push('unhandled: ' + (e.reason?.stack || e.reason)));
    },
  });

  const { window } = dom, { document } = window;
  const boot = Date.now();
  while (Date.now() - boot < 8_000 && !document.querySelector('.note-stack .note-card')) await wait(60);
  const card = [...document.querySelectorAll('.note-stack .note-card')]
    .find(c => (c.textContent || '').includes('배치 런타임'));
  check('배치 런타임 노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1100);
  check('배치 런타임용 노트가 열린다', document.getElementById('editorView').classList.contains('open'));
  check('배치 관련 API가 전역으로 준비된다',
    typeof window.setTextTool === 'function' && typeof window.openTableModal === 'function'
    && typeof window.moveTextGhost === 'function' && typeof window.uiCssZoom === 'function');

  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  const size = window.paperSize();

  // ── 데스크톱 조건 흉내: 사이트 기본 배율 90% × 종이 확대 150% ──────────
  const SITE_ZOOM = 0.9;      // @media(min-width:641px) and (pointer:fine){ html{zoom:.9} }
  const PAGE_ZOOM = 1.5;      // 에디터 확대
  const ORIGIN = { left: 120, top: 80 };
  const rectOf = () => ({
    left: ORIGIN.left, top: ORIGIN.top,
    width: size.w * PAGE_ZOOM * SITE_ZOOM, height: size.h * PAGE_ZOOM * SITE_ZOOM,
    right: ORIGIN.left + size.w * PAGE_ZOOM * SITE_ZOOM,
    bottom: ORIGIN.top + size.h * PAGE_ZOOM * SITE_ZOOM,
    x: ORIGIN.left, y: ORIGIN.top,
  });
  paper.getBoundingClientRect = rectOf;

  // 배율 프로브(100 CSS px)가 화면에 90px 로 잡히는 상황 = site zoom .9
  const probe = document.createElement('div');
  probe.id = 'uiZoomProbe';
  probe.getBoundingClientRect = () => ({ width: 100 * SITE_ZOOM, height: 0, left: 0, top: 0, right: 100 * SITE_ZOOM, bottom: 0, x: 0, y: 0 });
  document.body.appendChild(probe);
  check('사이트 배율 프로브를 0.9 로 잰다', Math.abs(window.uiCssZoom() - SITE_ZOOM) < 1e-9);

  // 포인터 아래 요소를 종이로 답하게 한다 (jsdom 에는 hit-testing 이 없다)
  document.elementFromPoint = (x, y) => {
    const r = rectOf();
    return (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) ? paper : null;
  };

  // 화면 px ↔ 문서 px
  const screenPerDoc = PAGE_ZOOM * SITE_ZOOM;          // gBCR 기준
  const docX = cx => (cx - ORIGIN.left) / screenPerDoc;
  const docY = cy => (cy - ORIGIN.top) / screenPerDoc;

  const CLICK = { x: 620, y: 520 };
  const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

  // ── ① 텍스트 상자: 고스트 자리 == 실제로 생기는 자리 ─────────────────
  window.setTextTool(true);
  document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: CLICK.x, clientY: CLICK.y }));
  const tghost = document.getElementById('textGhost');
  const gLeft = parseFloat(tghost.style.left), gTop = parseFloat(tghost.style.top);
  const gW = parseFloat(tghost.style.width), gH = parseFloat(tghost.style.height);
  check('텍스트 고스트는 사이트 배율만큼 환산한 CSS px 에 놓인다',
    near(gLeft, ORIGIN.left / SITE_ZOOM + (docX(CLICK.x) - 100) * PAGE_ZOOM)
    && near(gTop, ORIGIN.top / SITE_ZOOM + (docY(CLICK.y) - 24) * PAGE_ZOOM));
  check('텍스트 고스트 크기는 종이 확대율 기준(200×48 문서 px)이다',
    near(gW, 200 * PAGE_ZOOM) && near(gH, 48 * PAGE_ZOOM));

  paper.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1, clientX: CLICK.x, clientY: CLICK.y }));
  await wait(80);
  const tb = paper.querySelector('.layer-text .tb');
  check('클릭하면 텍스트 상자가 만들어진다', !!tb);
  // 고스트(style.left 는 CSS px)를 화면 px 로 되돌리면 생성된 상자의 화면 자리와 같아야 한다
  const tbScreenLeft = ORIGIN.left + parseFloat(tb.style.left) * screenPerDoc;
  const tbScreenTop = ORIGIN.top + parseFloat(tb.style.top) * screenPerDoc;
  check('만들어진 텍스트 상자는 고스트가 보여주던 바로 그 자리에 생긴다',
    near(tbScreenLeft, gLeft * SITE_ZOOM) && near(tbScreenTop, gTop * SITE_ZOOM));
  check('만들어진 텍스트 상자는 커서를 중심으로 잡힌다',
    near(parseFloat(tb.style.left), docX(CLICK.x) - 100) && near(parseFloat(tb.style.top), docY(CLICK.y) - 24));

  if (typeof window.deselectAll === 'function') window.deselectAll(true);
  window.setFS(40);
  window.setTextTool(true);
  const BIG_CLICK = { x: 520, y: 300 };
  document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: BIG_CLICK.x, clientY: BIG_CLICK.y }));
  const bigGW = parseFloat(tghost.style.width), bigGH = parseFloat(tghost.style.height);
  check('현재 선택 글자 크기가 크면 텍스트 고스트도 한 줄 높이에 맞춰 커진다',
    near(bigGW, 320 * PAGE_ZOOM) && near(bigGH, 80 * PAGE_ZOOM));
  paper.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1, clientX: BIG_CLICK.x, clientY: BIG_CLICK.y }));
  await wait(80);
  const bigTb = [...paper.querySelectorAll('.layer-text .tb')].filter(n => !n.classList.contains('in-tbl')).at(-1);
  check('현재 글자 크기로 만든 새 텍스트 상자는 48px 고정 높이가 아니다',
    near(parseFloat(bigTb.style.width), 320) && near(parseFloat(bigTb.style.height), 80));
  if (typeof window.deselectAll === 'function') window.deselectAll(true);
  window.setFS(16);

  // ── ② 표: 고스트 자리 == 실제로 생기는 자리 ──────────────────────────
  window.prompt = () => '3 x 3';
  window.openTableModal();
  check('표 버튼은 크기 입력 뒤 배치 모드로 들어간다',
    document.getElementById('tableGhost').style.display === 'block' && document.body.classList.contains('placing-table'));
  document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: CLICK.x, clientY: CLICK.y }));
  const pghost = document.getElementById('tableGhost');
  const pLeft = parseFloat(pghost.style.left), pTop = parseFloat(pghost.style.top);
  check('표 고스트도 같은 환산(문서 px × 종이 배율, 사이트 배율 보정)을 쓴다',
    near(parseFloat(pghost.style.width), 3 * 150 * PAGE_ZOOM, 2)
    && Number.isFinite(pLeft) && Number.isFinite(pTop));

  paper.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1, clientX: CLICK.x, clientY: CLICK.y }));
  await wait(150);
  const boxes = [...paper.querySelectorAll('.tbl-box')];
  check('클릭한 자리에 표가 하나 생긴다', boxes.length === 1);
  const box = boxes[0];
  const boxScreenLeft = ORIGIN.left + parseFloat(box.style.left) * screenPerDoc;
  const boxScreenTop = ORIGIN.top + parseFloat(box.style.top) * screenPerDoc;
  check('생성된 표는 고스트가 보여주던 바로 그 자리에 생긴다',
    near(boxScreenLeft, pLeft * SITE_ZOOM, 2) && near(boxScreenTop, pTop * SITE_ZOOM, 2));
  check('생성된 표는 커서가 표 중심이 되도록 배치된다',
    near(parseFloat(box.style.left) + parseFloat(box.style.width) / 2, docX(CLICK.x), 2)
    && near(parseFloat(box.style.top) + parseFloat(box.style.height) / 2, docY(CLICK.y), 2));

  // ── ③ 확대를 바꾼 뒤에도 같은 약속이 지켜진다 ────────────────────────
  window.setTextTool(true);
  const Z2 = 2.4;
  paper.getBoundingClientRect = () => ({
    left: ORIGIN.left, top: ORIGIN.top,
    width: size.w * Z2 * SITE_ZOOM, height: size.h * Z2 * SITE_ZOOM,
    right: ORIGIN.left + size.w * Z2 * SITE_ZOOM, bottom: ORIGIN.top + size.h * Z2 * SITE_ZOOM,
    x: ORIGIN.left, y: ORIGIN.top,
  });
  document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: CLICK.x, clientY: CLICK.y }));
  const g2Left = parseFloat(tghost.style.left);
  check('배율을 240% 로 바꿔도 고스트는 커서 자리(문서 좌표)를 그대로 가리킨다',
    near(g2Left, ORIGIN.left / SITE_ZOOM + ((CLICK.x - ORIGIN.left) / (Z2 * SITE_ZOOM) - 100) * Z2));
  paper.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1, clientX: CLICK.x, clientY: CLICK.y }));
  await wait(80);
  const tbs = [...paper.querySelectorAll('.layer-text .tb')].filter(n => !n.classList.contains('in-tbl'));
  const last = tbs[tbs.length - 1];
  check('배율을 바꾼 뒤 만든 상자도 고스트와 같은 자리에 생긴다',
    near(ORIGIN.left + parseFloat(last.style.left) * Z2 * SITE_ZOOM, g2Left * SITE_ZOOM));

  const fatal = errors.filter(Boolean);
  check('배치 중 치명적 런타임 오류가 없다', fatal.length === 0);
  if (fatal.length) console.log(fatal.slice(0, 5).join('\n---\n'));
  console.log(`\n에디터 배치 런타임: PASS ${pass} / FAIL 0`);
} catch (e) {
  console.error('\n에디터 배치 런타임 실패:', e);
  if (log) console.error('\nserver log:\n' + log.slice(-2500));
  process.exitCode = 1;
} finally {
  // 창을 닫기 전에 남아 있는 rAF(=setTimeout) 콜백을 먼저 돌린다.
  // 닫힌 뒤 돌면 jsdom 의 document 가 없어져 테스트 프로세스가 깨진다.
  await wait(80);
  await closeDoms([dom]);

  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
}
