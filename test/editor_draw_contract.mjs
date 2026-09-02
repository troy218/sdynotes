/* 14.17 · 펜 그리기: 도구 상태 저장/복원, 획 추가, 지우개, 완료 동작 계약
   ---------------------------------------------------------------------------
   맥락: 모바일/데스크톱 공통으로 펜을 더 쓰기 쉽게 다듬는 작업의 회귀 검증.
   1) 펜 켜기 → 펜 툴바 표시 + 커서 모드
   2) 색·굵기·도형·형광펜 설정이 localStorage 에 남는다 (다음 사용 시 복원)
   3) 자유선을 그리면 문서(stroke element)·화면(.stroke-g)에 실제 획이 생긴다
   4) 지우개가 그 획을 지운다
   5) 완료하면 펜 모드가 종료된다
   6) 툴바의 되돌리기 버튼이 존재한다 (실행 취소 가능한 UI)
   7) 14.18.3 되돌리기 재설계 — 빠른 연속 획도 1획씩 되돌아가고, 지우개의
      '첫 획'도 되돌아오며, 되돌린 뒤에도 펜 모드가 살아 있다 */
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-draw-'));
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
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '펜 그리기', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [] }],
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
  while (Date.now() - boot < 8_000 && document.querySelectorAll('.note-stack .note-card').length < 1) await wait(60);
  const card = [...document.querySelectorAll('.note-stack .note-card')]
    .find((c) => (c.textContent || '').includes('펜 그리기'));
  check('노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1600);
  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));

  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });
  const draw = paper.querySelector('.draw-surface');
  check('펜 전용 드로잉 레이어가 있다', !!draw);
  // undo/redo 는 종이를 다시 그리므로, 그때마다 paper/draw 를 새로 잡는 헬퍼
  const refit = () => {
    const pp = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
    pp.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });
    return { paper: pp, draw: pp.querySelector('.draw-surface') };
  };
  const strokeN = () => document.querySelectorAll('#pagesStage .stroke-g').length;

  // ── 1) 펜 켜기 ─────────────────────────────────────────
  window.togglePen();
  await wait(80);
  check('펜 버튼에 active 가 붙는다', document.getElementById('penBtn').classList.contains('active'));
  check('형광펜 버튼은 펜과 별도 툴바 버튼이다', !!document.getElementById('highlighterBtn'));
  check('그리기 툴바가 보인다', document.getElementById('drawToolbar').style.display === 'flex');
  check('종이에 drawing 클래스가 붙는다', paper.classList.contains('drawing'));
  check('그리기 툴바 안에는 형광펜 토글/저장 완료 버튼이 없다',
    !document.getElementById('markerBtn') && !document.getElementById('drawToolbar').querySelector('.done'));

  window.toggleHighlighter();
  await wait(80);
  check('형광펜 모드는 상단 형광펜 버튼만 active 로 켜진다',
    document.getElementById('highlighterBtn').classList.contains('active') && !document.getElementById('penBtn').classList.contains('active'));
  window.togglePen();
  await wait(80);
  check('펜 버튼을 누르면 일반 펜 모드로 돌아온다',
    document.getElementById('penBtn').classList.contains('active') && !document.getElementById('highlighterBtn').classList.contains('active'));

  // ── 2) 설정 저장 ─────────────────────────────────────────
  const red = document.querySelector('.color-pick[data-c="#f3a69e"]');
  red.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('펜 굵기는 더 얇은 단계 포함 4단계다',
    document.querySelectorAll('.size-opt').length === 4 && !!document.querySelector('.size-opt[data-s="1"]'));
  document.querySelector('.size-opt[data-s="4"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const custom = document.getElementById('penCustom');
  custom.value = '#123456';
  custom.dispatchEvent(new window.Event('input', { bubbles: true }));
  red.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(60);
  const saved = JSON.parse(window.localStorage.getItem('sdy_draw_cfg') || '{}');
  check('색 설정이 저장된다', saved.color === '#f3a69e');
  check('사용자 색 선택기도 원형 color-pick 으로 표시된다', custom.classList.contains('color-pick'));
  check('굵기 설정이 저장된다', saved.size === 4);

  // ── 3) 자유선을 그린다 ────────────────────────────────────
  draw.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 80, clientY: 90 }));
  draw.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 150, clientY: 130 }));
  draw.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 220, clientY: 170 }));
  draw.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await wait(150);
  const strokeG = document.querySelector('#pagesStage .stroke-g');
  check('화면에 획 요소(.stroke-g)가 생긴다', !!strokeG);
  check('획 데이터가 문서에 저장된다', strokeN() >= 1);

  // ── 3.5) 되돌리기: 빠르게 연속으로 그린 획도 한 획씩 되돌아간다 ─────────
  // (undo/redo 는 종이를 다시 그리므로 매 동작 뒤 paper/draw 를 새로 잡는다)
  {
    const before = strokeN();
    let d = refit().draw;
    for (let k = 0; k < 3; k++) {
      d.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 60 + k * 40, clientY: 500 }));
      d.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 90 + k * 40, clientY: 520 }));
      d.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
      await wait(30);   // 250ms 묶음에 걸릴 만큼 빠른 연속 그리기
    }
    check('빠르게 연속으로 그린 3획이 모두 남는다', strokeN() === before + 3);
    window.undo(); await wait(150);
    check('되돌리기 한 번에 마지막 1획만 사라진다', strokeN() === before + 2);
    check('되돌린 뒤에도 펜 모드(종이 .drawing)가 살아 있다', refit().paper.classList.contains('drawing'));
    window.undo(); await wait(150);
    window.undo(); await wait(150);
    check('되돌리기를 세 번 누르면 연속 획이 전부 사라진다', strokeN() === before);
    window.redo(); await wait(150);
    check('다시 실행으로 마지막 획이 하나 돌아온다', strokeN() === before + 1);
  }

  // ── 4) 지우개 ────────────────────────────────────────────
  window.toggleEraser();
  await wait(40);
  check('지우개가 active 가 된다', document.getElementById('eraserBtn').classList.contains('active'));
  const drawE = refit().draw;   // 3.5 의 undo/redo 로 종이가 다시 그려졌으므로 새로 잡는다
  const beforeErase = strokeN();
  drawE.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 120, clientY: 110 }));
  drawE.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 180, clientY: 145 }));
  drawE.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await wait(200);
  check('지우개가 그린 획을 지운다', strokeN() < beforeErase);
  // 지우개로 지운 '첫 획'도 되돌리기로 살아나야 한다 (예전엔 스냅샷을 지운 뒤에
  // 남겨 첫 획이 영영 돌아오지 않았다)
  {
    const afterErase = strokeN();
    window.undo(); await wait(200);
    check('지우개로 지운 첫 획도 되돌리기로 살아난다', strokeN() > afterErase);
    check('지우개 되돌리기 뒤에도 펜 모드가 유지된다', refit().paper.classList.contains('drawing'));
    if (document.getElementById('eraserBtn').classList.contains('active')) window.toggleEraser();
    await wait(40);
  }

  // ── 5) 자유선으로 비슷하게 그린 도형을 길게 누르면 자동으로 다듬는다 ───
  window.setShape('free');
  if (document.getElementById('eraserBtn').classList.contains('active')) window.toggleEraser();
  await wait(40);
  const draw2 = refit().draw;
  draw2.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 300, clientY: 300 }));
  for (const [x, y] of [[360, 298], [410, 305], [408, 360], [398, 382], [335, 380], [300, 365], [298, 315], [300, 300]]) {
    draw2.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
    await wait(20);
  }
  await wait(760);
  draw2.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await wait(1400);
  const rows = await q({ table: 'memos', op: 'select', values: [], filters: [{ field: 'notebook_id', op: 'eq', value: String(id) }], limit: 1, single: true });
  const row = Array.isArray(rows?.data) ? rows.data[0] : rows?.data;
  const memo = row?.content ? JSON.parse(row.content) : null;
  const lastStroke = (memo?.pages?.[0]?.els || []).filter((e) => e.type === 'stroke').at(-1);
  check('길게 누른 자유선은 사각형/원/타원 같은 도형으로 모핑 저장된다',
    !!lastStroke && ['rect', 'square', 'ellipse', 'circle', 'triangle', 'diamond', 'line'].includes(lastStroke.shape || ''));

  // ── 6) 되돌리기 버튼 + 종료 ──────────────────────────────
  const undoBtn = document.getElementById('drawToolbar').querySelector('button[title*="되돌리기"], button[title*="실행 취소"]');
  check('툴바에 되돌리기 버튼이 존재한다', !!undoBtn);
  window.finishDrawing();
  await wait(80);
  check('완료하면 펜/형광펜 모드가 꺼진다',
    !document.getElementById('penBtn').classList.contains('active') && !document.getElementById('highlighterBtn').classList.contains('active'));
  check('완료하면 툴바가 사라진다', document.getElementById('drawToolbar').style.display === 'none');

  check('런타임 오류 없음', errors.length === 0);
  console.log(`펜 그리기 계약: PASS ${pass}`);
} catch (e) {
  console.error('FAIL:', e.message);
  console.error((e.stack || '').split('\n').slice(0, 4).join('\n'));
  process.exitCode = 1;
} finally {
  try { child.kill('SIGTERM'); } catch {}
  await wait(300);
  try { child.kill('SIGKILL'); } catch {}
  closeDoms(doms);
  process.exit(process.exitCode || 0);
}
