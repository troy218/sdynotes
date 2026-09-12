/* 14.68 · 모바일 터치 조작 런타임 계약
   ---------------------------------------------------------------------------
   390×844 터치 폰 JSDOM 에서 새 모바일 조작 경로를 실제로 돌린다.
   1) 핀치 줌 — 두 손가락 거리 비율만큼 zoomPct 가 커밋되고, 제스처 중에는
      stage transform(translate+scale)만 쓰이며, 끝나면 transform 이 비워진다.
   2) 자동 손바닥 거부 — 펜(pointerType:'pen')이 닿아 있는 동안의 손가락 터치는
      에디터 본문에서 그리기·선택·스크롤 어떤 핸들러에도 도달하지 않는다.
   3) 손바닥 차단(연필 모드) — 토글 버튼은 터치 기기에서만 주입되고, 켜면
      손가락 터치는 그려지지 않으며 펜은 계속 그려진다. 상태는 저장된다.
   4) 빈 곳 더블탭 + 끌기 → 영역 선택(marquee). 한 번 탭 + 끌기는 선택을
      시작하지 않는다(화면 이동 우선).
   5) 터치 pointerdown 은 빈 종이에서 marquee 를 시작하지 않는다(데스크톱
      마우스 경로는 그대로 시작한다).
*/
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-mtouch-'));
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
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '폰 터치', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [
      { type: 'stroke', id: 's_in',  pts: [[120, 120], [200, 200]], color: '#000000', size: 2, dx: 0, dy: 0 },
      { type: 'stroke', id: 's_out', pts: [[500, 700], [600, 800]], color: '#000000', size: 2, dx: 0, dy: 0 },
      { type: 'text', id: 't_ph', x: 60, y: 300, w: 220, h: 90, html: '안녕 폰', fontSize: 16 },
    ] }],
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
      // 390×844 세로 폰 + coarse pointer + 멀티터치 (iPad/Android 포함)
      window.innerWidth = 390; window.innerHeight = 844;
      window.matchMedia = (query) => ({ matches: /pointer:coarse|max-width:640/.test(query), media: query,
        addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      try { Object.defineProperty(window.navigator, 'maxTouchPoints', { value: 5, configurable: true }); } catch {}
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
      window.Audio = class { constructor(){ this.paused = true; } play(){ return Promise.resolve(); } pause(){} addEventListener(){} };
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
    .find((c) => (c.textContent || '').includes('폰 터치'));
  check('노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1600);
  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));

  const RECT = { left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 };
  const refit = () => {
    const pp = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
    if (pp) pp.getBoundingClientRect = () => ({ ...RECT });
    return pp;
  };
  refit();
  const body = document.getElementById('editorBody');
  const stage = document.getElementById('pagesStage');
  const strokeN = () => document.querySelectorAll('#pagesStage .stroke-g').length;

  // 터치 이벤트 헬퍼 — jsdom 에 TouchEvent 가 없어도 리스너는 일반 Event 로 돈다
  const touch = (x, y, id) => ({ clientX: x, clientY: y, identifier: id || 0, pageX: x, pageY: y, target: null });
  function fireTouch(target, type, pts, opts) {
    const ev = new window.Event(type, { bubbles: true, cancelable: !(opts && opts.uncancelable) });
    ev.touches = pts;
    ev.targetTouches = pts;
    ev.changedTouches = pts.length ? pts : [touch(0, 0)];
    target.dispatchEvent(ev);
    return ev;
  }
  function firePointer(target, type, props) {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(ev, { button: 0, buttons: 1, pointerId: 2, isPrimary: true, pressure: 0.5 }, props || {});
    target.dispatchEvent(ev);
    return ev;
  }

  await wait(800);   // 쪽 렌더 완료 대기
  refit();
  const strokes0 = strokeN();
  check('문서의 획 2개가 렌더된다', strokes0 === 2);

  /* ── 1) 핀치 줌: 거리 비율만큼 커밋, 제스처 중에는 transform 만 ── */
  {
    const w0 = parseFloat(stage.style.width);
    check('시작 배율에서 stage 폭이 잡혀 있다', w0 > 0);
    fireTouch(body, 'touchstart', [touch(100, 200, 1), touch(200, 200, 2)]);
    fireTouch(body, 'touchmove', [touch(50, 200, 1), touch(250, 200, 2)]);   // 거리 100→200 = ×2
    await wait(60);
    const tr = stage.style.transform || '';
    check('제스처 중에는 translate+scale transform 으로 미리 본다', /translate\(.+px,.+px\) scale\(2/.test(tr));
    check('제스처 중에 스크롤을 움직이지 않는다(클리핑 없음)', body.scrollLeft === 0 && body.scrollTop === 0);
    fireTouch(body, 'touchend', []);
    await wait(80);
    refit();
    check('손을 떼면 transform 이 걷히고 진짜 레이아웃으로 커밋된다', stage.style.transform === '');
    const w1 = parseFloat(stage.style.width);
    check('두 손가락 거리 비율(×2)만큼 배율이 커밋된다', Math.abs(w1 - w0 * 2) < 0.51);
    // 축소 방향도 — ×0.5 로 되돌린다 (25% 하한 안에서)
    fireTouch(body, 'touchstart', [touch(50, 200, 1), touch(250, 200, 2)]);
    fireTouch(body, 'touchmove', [touch(100, 200, 1), touch(200, 200, 2)]); // 거리 200→100 = ÷2
    fireTouch(body, 'touchend', []);
    await wait(80);
    refit();
    const w2 = parseFloat(stage.style.width);
    check('축소도 같은 비율로 커밋된다', Math.abs(w2 - w0) < 0.51);
    // 브라우저가 제스처를 가져간 경우(cancelable=false)에는 손대지 않는다
    const wBefore = parseFloat(stage.style.width);
    fireTouch(body, 'touchstart', [touch(100, 300, 1), touch(200, 300, 2)], { uncancelable: true });
    fireTouch(body, 'touchmove', [touch(50, 300, 1), touch(250, 300, 2)], { uncancelable: true });
    fireTouch(body, 'touchend', [], { uncancelable: true });
    await wait(60);
    check('네이티브가 소유한 제스처(uncanable)에서는 줌이 바뀌지 않는다',
      stage.style.transform === '' && Math.abs(parseFloat(stage.style.width) - wBefore) < 0.01);
  }

  /* ── 2) 자동 손바닥 거부: 펜이 닿은 동안의 손가락 터치는 무시 ── */
  window.togglePen();
  await wait(100);
  refit();
  check('펜 모드가 켜지고 그리기 도구막대가 열린다', document.getElementById('drawToolbar').style.display === 'flex');
  const draw = () => document.querySelector('#pagesStage .paper[data-page-idx="0"] .draw-surface');
  check('터치 기기에서는 손바닥 차단 버튼이 주입된다', !!document.getElementById('palmBtn'));

  function fingerStroke(x0, y0) {
    const ds = draw();
    fireTouch(ds, 'touchstart', [touch(x0, y0)]);
    fireTouch(document, 'touchmove', [touch(x0 + 60, y0 + 40)]);
    fireTouch(document, 'touchend', []);
  }
  const n0 = strokeN();
  fingerStroke(300, 900);
  await wait(200); refit();
  check('펜 모드에서 손가락으로도 그릴 수 있다(차단 끔 기본값)', strokeN() === n0 + 1);

  // 펜이 화면에 닿는다 → 그 순간의 손가락(손바닥) 터치는 완전히 무시된다
  firePointer(window, 'pointerdown', { pointerType: 'pen' });
  const n1 = strokeN();
  fingerStroke(300, 950);
  await wait(150); refit();
  check('펜이 닿아 있는 동안의 손가락 터치는 그려지지 않는다(손바닥 거부)', strokeN() === n1);
  // 펜을 떼고 유예 시간(320ms)이 지나면 손가락이 다시 동작한다
  firePointer(window, 'pointerup', { pointerType: 'pen', buttons: 0 });
  await wait(420);
  refit();
  const n2 = strokeN();
  fingerStroke(300, 1000);
  await wait(200); refit();
  check('펜을 떼고 나면 손가락 그리기가 다시 동작한다', strokeN() === n2 + 1);

  /* ── 3) 손바닥 차단(연필 모드): 손가락은 팬 전용, 펜은 계속 그려진다 ── */
  {
    const palm = document.getElementById('palmBtn');
    palm.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await wait(50);
    check('손바닥 차단을 켜면 body.palm-strict 가 붙는다', document.body.classList.contains('palm-strict'));
    check('손바닥 차단 상태가 저장된다', window.localStorage.getItem('sdy_palm_strict') === '1');
    check('손바닥 차단 버튼에 active 가 붙는다', palm.classList.contains('active'));
    const m0 = strokeN();
    fingerStroke(320, 900);
    await wait(150); refit();
    check('손바닥 차단 중 손가락 터치는 그려지지 않는다(화면 이동만)', strokeN() === m0);
    // 펜(pointerType:'pen')은 손바닥 차단 중에도 그대로 그린다
    const ds = draw();
    firePointer(ds, 'pointerdown', { pointerType: 'pen', clientX: 700, clientY: 950 });
    firePointer(document, 'pointermove', { pointerType: 'pen', clientX: 740, clientY: 980, pressure: 0.5, buttons: 1 });
    firePointer(document, 'pointerup', { pointerType: 'pen', buttons: 0 });
    await wait(200); refit();
    check('손바닥 차단 중에도 펜은 그려진다', strokeN() === m0 + 1);
    palm.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await wait(50);
    check('손바닥 차단을 끄면 body 클래스가 벗겨진다', !document.body.classList.contains('palm-strict'));
    await wait(420);   // 직전 펜 스트로크의 자동 거부 유예(320ms)가 지난 뒤
    const m1 = strokeN();
    fingerStroke(320, 940);
    await wait(200); refit();
    check('손바닥 차단을 끄면 손가락 그리기가 돌아온다', strokeN() === m1 + 1);
  }
  window.togglePen();   // 펜 모드 종료
  await wait(120); refit();

  /* ── 4) 빈 곳 더블탭 + 끌기 → 영역 선택 / 한 번 탭 + 끌기는 선택 없음 ── */
  {
    const paper = refit();
    // 4-1) 단일 탭 + 끌기: marquee 가 생기지 않는다 (화면 이동 우선)
    fireTouch(paper, 'touchstart', [touch(700, 300)]);
    fireTouch(paper, 'touchmove', [touch(700, 340)]);
    fireTouch(paper, 'touchmove', [touch(700, 380)]);
    fireTouch(paper, 'touchend', []);
    await wait(100);
    check('한 번 탭 + 끌기는 영역 선택을 시작하지 않는다', !document.querySelector('.marquee') && !window._sdyDblDragAt);

    // 4-2) 더블탭 + 끌기: s_in(120,120~200,200) 을 덮고 s_out(500,700~) 은 벗어난다
    fireTouch(paper, 'touchstart', [touch(60, 60)]);
    fireTouch(paper, 'touchend', []);
    await wait(60);
    fireTouch(paper, 'touchstart', [touch(62, 62)]);
    fireTouch(paper, 'touchmove', [touch(90, 90)]);
    await wait(30);
    check('더블탭 후 끌면 영역 선택 상자가 생긴다', !!document.querySelector('.marquee'));
    check('더블탭-드래그 제스처가 기록된다(줌 토글 억제용)', !!window._sdyDblDragAt);
    fireTouch(paper, 'touchmove', [touch(300, 300)]);
    await wait(30);
    const sel = document.querySelectorAll('.msel');
    check('영역 안의 객체만 선택된다 (1/2)', sel.length === 1 && sel[0].dataset.id === 's_in');
    fireTouch(paper, 'touchend', []);
    await wait(250); refit();
    check('손을 떼면 선택이 확정된다', document.querySelectorAll('.msel').length === 1 && !document.querySelector('.marquee'));
    // 선택 해제 (빈 곳 단일 탭의 pointerdown 경로)
    await wait(700);   // sdyIgnoreCompatMouse 창(650ms)이 지난 뒤
    firePointer(refit(), 'pointerdown', { pointerType: 'touch', clientX: 700, clientY: 600, button: 0 });
    firePointer(window, 'pointerup', { pointerType: 'touch', buttons: 0 });
    await wait(80);
    check('빈 곳 탭으로 선택이 해제된다', document.querySelectorAll('.msel').length === 0);
  }

  /* ── 5) 터치 pointerdown 은 빈 종이 marquee 를 시작하지 않는다 ── */
  {
    const paper = refit();
    firePointer(paper, 'pointerdown', { pointerType: 'touch', clientX: 700, clientY: 900, button: 0 });
    await wait(40);
    check('터치 pointerdown 에는 marquee 가 생기지 않는다', !document.querySelector('.marquee'));
    firePointer(window, 'pointerup', { pointerType: 'touch', buttons: 0 });
    await wait(700);
    // 데스크톱 마우스 경로(호환 mousedown)는 그대로 marquee 를 시작한다
    paper.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 700, clientY: 900 }));
    await wait(40);
    check('마우스 드래그 경로는 예전처럼 marquee 를 시작한다(데스크톱 불변)', !!document.querySelector('.marquee'));
    paper.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
    await wait(60);
  }

  /* ── 6) 글상자 선택은 '손가락을 뗄 때' — 스크롤·핀치 방해 금지 ── */
  {
    const paper = refit();
    const tb = paper.querySelector('.tb[data-id="t_ph"]');
    check('문서의 글상자가 렌더된다', !!tb);
    const c = tb.querySelector('.tb-content');
    const selN = () => document.querySelectorAll('#pagesStage .tb.sel').length;
    const PD = (x, y) => firePointer(c, 'pointerdown',
      { pointerType: 'touch', clientX: x, clientY: y, button: 0, detail: 1 });

    // 6-1) 누른 순간에는 아직 — 떼야 선택된다
    PD(100, 340);
    await wait(40);
    check('터치로 글상자를 누른 순간에는 선택되지 않는다', selN() === 0 && !tb.classList.contains('sel'));
    fireTouch(document, 'touchend', []);
    await wait(80);
    check('그대로 손을 떼면 그때 선택이 확정된다', selN() === 1 && tb.classList.contains('sel'));

    // 선택 해제 (빈 곳 탭 → 손 떼기)
    const empty = () => { firePointer(refit(), 'pointerdown', { pointerType: 'touch', clientX: 700, clientY: 620, button: 0, detail: 1 }); };
    empty(); fireTouch(document, 'touchend', []);
    await wait(700);   // 호환 mousedown 창(650ms) 지나가기
    check('빈 곳을 탭하면 선택이 풀린다', selN() === 0);

    // 6-2) 누른 채 스크롤 → 선택되지 않는다
    PD(100, 340);
    fireTouch(document, 'touchmove', [touch(100, 400)]);   // 60px = 스크롤
    fireTouch(document, 'touchmove', [touch(100, 470)]);
    fireTouch(document, 'touchend', []);
    await wait(80);
    check('누른 채 스크롤하면 글상자가 선택되지 않는다', selN() === 0);

    // 6-3) 핀치(두 손가락) 중에도 선택되지 않고, 끝나도 살아나지 않는다
    PD(100, 340);
    fireTouch(document, 'touchstart', [touch(100, 340), touch(200, 420)]);
    fireTouch(document, 'touchmove', [touch(80, 320), touch(260, 480)]);
    await wait(30);
    check('두 번째 손가락이 닿으면(핀치) 미뤄 둔 선택이 취소된다', selN() === 0);
    fireTouch(document, 'touchend', [touch(260, 480)]);
    await wait(30);
    check('핀치 중 첫 손가락을 떼도 선택되지 않는다', selN() === 0);
    fireTouch(document, 'touchend', []);
    await wait(80);
    check('핀치를 마쳐도 선택이 뒤늦게 살아나지 않는다', selN() === 0);

    // 6-4) 브라우저가 제스처를 가져간 경우(pointercancel)도 선택되지 않는다
    PD(100, 340);
    firePointer(c, 'pointercancel', { pointerType: 'touch', button: 0 });
    fireTouch(document, 'touchend', []);
    await wait(80);
    check('pointercancel(브라우저가 스크롤을 가져감) 후에는 선택되지 않는다', selN() === 0);

    // 6-5) 두 번째 탭 = 편집 진입 (미뤄도 순서는 그대로)
    PD(100, 340); fireTouch(document, 'touchend', []);
    await wait(80);
    check('첫 탭으로 선택된 뒤', selN() === 1);
    PD(110, 345);
    await wait(40);
    fireTouch(document, 'touchend', []);
    await wait(120);
    check('이미 선택된 상자를 다시 탭하면 편집 모드로 들어간다', tb.classList.contains('edit'));
    try { window.commitEditingText && window.commitEditingText(tb); } catch {}
    tb.classList.remove('edit');
    const cc = tb.querySelector('.tb-content'); if (cc) cc.contentEditable = 'false';
    await wait(60);

    // 6-6) 데스크톱(마우스)은 예전 그대로 — 누르는 순간 선택
    await wait(700);
    empty(); firePointer(window, 'pointerup', { pointerType: 'touch', buttons: 0 });
    await wait(700);
    firePointer(c, 'pointerdown', { pointerType: 'mouse', clientX: 100, clientY: 340, button: 0, detail: 1 });
    await wait(60);
    check('마우스(데스크톱)는 누르는 순간 곧장 선택된다 — 불변', selN() === 1);
    firePointer(window, 'pointerup', { pointerType: 'mouse', buttons: 0 });
    await wait(60);
  }

  const runtimeFatal = errors.filter((m) => !/net::ERR|Could not load|Not implemented|localStorage|scrollTo/i.test(m));
  check('런타임 오류 없음', runtimeFatal.length === 0);
  if (runtimeFatal.length) console.log(runtimeFatal.slice(0, 4).join('\n---\n'));

  console.log(`\n모바일 터치 조작 런타임: PASS ${pass}`);
} finally {
  for (const dm of doms) { try { closeDoms(dm); } catch {} }
  try { child.kill('SIGKILL'); } catch {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
}
process.exit(0);
