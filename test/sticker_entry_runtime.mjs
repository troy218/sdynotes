/* 스티커 넣기 진입점 런타임 검증

   실제 DOM 에서 끝까지 흐름을 밟는다.

     ① 빈 종이를 우클릭하면 메뉴에 '스티커 넣기'가 있다 (이미지 넣기 다음)
     ② 누르면 스티커 보관함이 열리고, 우클릭한 그 자리가 기억된다
     ③ 보관함에서 스티커를 고르면 우클릭한 자리에 붙는다
     ④ 툴바의 스티커 넣기 버튼(사진 추가 옆)으로 열면 기본 자리에 붙는다
     ⑤ 여러 개 선택 우클릭 → 더보기 : '스티커로 합치기'는 사라지고
        '객체 묶기'·'스티커로 만들기'는 남아 있다. 객체 묶기도 실제로 묶인다 */
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-stk-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
}
let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };

async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}
function clickBox(win, content, opts = {}) {
  content.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1, clientX: 60, clientY: 20, ...opts }));
  win.document.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, button: 0, ...opts }));
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

  // 스티커 하나를 보관함에 미리 넣어 둔다 (1×1 png)
  const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const saved = await fetch(base + '/api/stickers/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: PNG1, name: '하트' }),
  }).then(r => r.json());
  check('보관함에 스티커가 저장된다', !!saved.ok && !!saved.id && !!saved.url);

  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '스티커 넣기', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [
      { type: 'text', id: 't1', x: 40, y: 40, w: 220, h: 60, html: '메모 하나', fontSize: 16 },
      { type: 'text', id: 't2', x: 420, y: 140, w: 200, h: 60, html: '메모 둘', fontSize: 16 },
    ] }],
  };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: id, content: JSON.stringify(doc0), font_size: 16 }], filters: [] });

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String(e?.message || e);
    if (!/HTMLMediaElement|Could not load (link|script|img)/.test(m)) errors.push(m);
  });
  vc.on('error', (...a) => errors.push(a.join(' ')));
  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      installWindowGuard(window);
      // jsdom 은 contentEditable 프로퍼티를 속성에 반영하지 않는다 — 보강
      Object.defineProperty(window.HTMLElement.prototype, 'contentEditable', {
        get(){ const v = this.getAttribute('contenteditable'); return v == null ? 'inherit' : v; },
        set(v){ this.setAttribute('contenteditable', String(v)); },
        configurable: true, enumerable: true,
      });
      // jsdom 은 그림을 디코드하지 못한다 — useSticker 가 기다리는 onload 를
      // 일정한 크기(120×90)로 즉시 불러 준다
      window.Image = class {
        constructor(){ this.width = 120; this.height = 90; }
        set src(v){ this._src = v; setTimeout(() => { if (this.onload) this.onload(); }, 0); }
        get src(){ return this._src; }
      };
      window.innerWidth = 1280; window.innerHeight = 800;
      window.matchMedia = query => ({ matches: query.includes('pointer:fine'), media: query,
        addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.BroadcastChannel = class { postMessage(){} close(){} addEventListener(){} };
      window.EventSource = class { close(){} addEventListener(){} };
      window.requestIdleCallback = cb => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
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
  while (Date.now() - boot < 8_000 && document.querySelectorAll('.note-stack .note-card').length < 1) await wait(60);

  const card = [...document.querySelectorAll('.note-stack .note-card')]
    .find(c => (c.textContent || '').includes('스티커 넣기'));
  check('노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1600);
  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));

  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });

  // ── ① 빈 종이 우클릭 → 스티커 넣기 ─────────────────────────────────────
  paper.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 650, clientY: 900 }));
  await wait(120);
  const menu = document.getElementById('ctxMenu');
  check('우클릭 메뉴가 열린다', menu.classList.contains('show'));
  const actions = [...menu.querySelectorAll('.ctx-item[data-a]')].map(n => n.dataset.a);
  check("메뉴에 '스티커 넣기'(sticker)가 있다", actions.includes('sticker'));
  check('스티커 넣기는 이미지 넣기 바로 다음 순서다', actions.indexOf('sticker') === actions.indexOf('img') + 1);

  // ── ② 누르면 보관함이 열리고 자리가 기억된다 ──────────────────────────
  menu.querySelector('.ctx-item[data-a="sticker"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(400);
  const modal = document.getElementById('stickerModal');
  check('스티커 보관함이 열린다', modal.style.display === 'flex');
  const files = [...modal.querySelectorAll('.v-file')];
  check('보관함에 저장한 스티커가 보인다', files.length === 1 && (files[0].textContent || '').includes('하트'));

  // ── ③ 고르면 우클릭한 자리에 붙는다 (650,900 중앙 → 590,855) ──────────
  files[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(300);
  check('스티커를 붙이면 보관함이 닫힌다', modal.style.display === 'none');
  let imgs = [...paper.querySelectorAll('.paper-img')];
  check('종이에 스티커(이미지)가 생긴다', imgs.length === 1);
  {
    const el = window.findEl(0, imgs[0].dataset.id);
    check('붙은 요소는 스티커 표시(sticker)를 가진다', !!el && el.sticker === true);
    check(`우클릭한 자리에 붙는다 (${el && el.x},${el && el.y})`, el && el.x === 590 && el.y === 855);
  }

  // ── ④ 툴바 버튼(사진 추가 옆) → 기본 자리 ─────────────────────────────
  const stkBtn = document.getElementById('stkBtn');
  const imgBtn = stkBtn && stkBtn.previousElementSibling;
  check('툴바에 스티커 넣기 버튼이 있다', !!stkBtn);
  check('스티커 버튼은 사진 추가(그림) 버튼 바로 옆이다',
    !!imgBtn && (imgBtn.getAttribute('onclick') || '').includes('triggerImgUpload()'));
  stkBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(400);
  check('툴바 버튼으로도 보관함이 열린다', modal.style.display === 'flex');
  modal.querySelector('.v-file').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(300);
  imgs = [...paper.querySelectorAll('.paper-img')];
  check('두 번째 스티커가 생긴다', imgs.length === 2);
  {
    // 첫 스티커는 (590,855) — 그 외의 것이 툴바로 붙인 두 번째 스티커다
    const second = imgs.find(n => {
      const e = window.findEl(0, n.dataset.id);
      return !(e && e.x === 590 && e.y === 855);
    });
    const e2 = second && window.findEl(0, second.dataset.id);
    check('툴바로 열면 기본 자리(80,100)에 붙는다', !!e2 && e2.x === 80 && e2.y === 100);
  }

  // ── ⑤ 여러 개 선택 우클릭 → 객체 묶기만 남는다 ─────────────────────────
  window.clearTextSelection();
  const c1 = document.querySelector('#pagesStage .tb[data-id="t1"] .tb-content');
  const c2 = document.querySelector('#pagesStage .tb[data-id="t2"] .tb-content');
  clickBox(window, c1, { ctrlKey: true });
  await wait(80);
  clickBox(window, c2, { ctrlKey: true });
  await wait(80);
  check('Ctrl+클릭으로 두 상자가 함께 선택된다',
    document.querySelectorAll('#pagesStage .tb.msel').length === 2);
  c1.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 100, clientY: 70 }));
  await wait(120);
  check('우클릭 메뉴가 다시 열린다', menu.classList.contains('show'));
  menu.querySelector('.ctx-item[data-sub="더보기"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(120);
  const subActions = [...menu.querySelectorAll('.ctx-item[data-a]')].map(n => n.dataset.a);
  check('더보기에 스티커로 합치기가 사라졌다', !subActions.includes('el-sticker-rep'));
  check('더보기에 객체 묶기(el-group)가 남아 있다', subActions.includes('el-group'));
  check("더보기에 '스티커로 만들기'(el-sticker)도 남아 있다", subActions.includes('el-sticker'));
  menu.querySelector('.ctx-item[data-a="el-group"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(200);
  {
    const e1 = window.findEl(0, 't1'), e2 = window.findEl(0, 't2');
    check('객체 묶기로 두 상자가 실제로 묶인다', !!e1.group && e1.group === e2.group);
  }

  const fatal = errors.filter(Boolean);
  check('스티커 넣기 흐름 중 치명적 런타임 오류가 없다', fatal.length === 0);
  if (fatal.length) console.log(fatal.slice(0, 5).join('\n---\n'));
  console.log(`\n스티커 넣기 진입점(우클릭·툴바·객체 묶기): PASS ${pass} / FAIL 0`);
} catch (e) {
  console.error('\n스티커 넣기 런타임 실패:', e);
  if (log) console.error('\nserver log:\n' + log.slice(-2500));
  process.exitCode = 1;
} finally {
  await wait(80);
  await closeDoms([dom]);
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  fs.rmSync(TMP, { recursive: true, force: true });
}
