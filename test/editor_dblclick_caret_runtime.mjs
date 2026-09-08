/* 14.39.8 · 더블클릭/탭으로 편집 진입 시 캐럿 위치 런타임 계약

   사용자 보고:
     "텍스트를 입력하려 상자를 더블클릭하면 커서 깜빡이가 해당 상자의
      제일 처음으로 이동한다. 누른 위치로 가게 해 달라."

   원인:
     · 실제 편집 진입은 .tb-content 의 dblclick 리스너가 한다 — Chrome·Edge 는
       pointerdown 의 e.detail 을 항상 0 으로 보내므로(w3c/pointerevents#98)
       onPaperDown 의 e.detail>=2 더블클릭 분기가 실제 입력에서 살아나지 않는다.
     · 그 리스너는 enterEdit(w,true) 만 불렀고, enterEdit 은 c.focus() 만 한다
       → 캐럿이 상자 맨 앞으로 간다.
     · 모바일 '이미 선택된 상자 다시 탭' 경로도 같은 이유로 맨 앞으로 갔다.

   이 테스트는 jsdom 에 layout 이 없어서 document.caretRangeFromPoint 를
   '합성 좌표계'로 대체한다(한 글자 = 10px). 실제 브라우저의 히트테스트와
   같은 계약을 흉내 내므로, 눌린 좌표 → 캐럿 오프셋 변환이 앱 로직에서
   올바른지(그리고 맨 앞으로 가지 않는지)를 검사한다. */
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-dblcaret-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
  fs.mkdirSync(path.join(TMP, 'src'), { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO, 'src'))) {
    const from = path.join(REPO, 'src', f), to = path.join(TMP, 'src', f);
    if (fs.statSync(from).isDirectory()) continue; // src/app 메가파트는 번들된 sdynotes.js 로만 제공
    fs.copyFileSync(from, to);
  }
}
let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };
async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port; await new Promise(r => s.close(r)); return p;
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

// 합성 좌표계 — 종이(0,0) 기준, 글상자는 (40,40) 320×80, 안쪽 여백 12/8, 한 글자 10px
const ORIGIN_X = 52, CHAR_W = 10, TEXT = '첫번째 단어 두번째 단어 세번째 단어';
const CLICK_IDX = 8;                       // '두번째' 의 '번'
const X_AT = idx => ORIGIN_X + idx * CHAR_W;
const Y_LINE = 60;                         // 첫 줄 안쪽
let COARSE = false;                        // (pointer:coarse) — 모바일 시나리오 토글

let dom;
try {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died: ' + log.slice(-400));
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }
  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '더블클릭캐럿', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [{ type: 'text', id: 't1', x: 40, y: 40, w: 320, h: 80, html: TEXT, fontSize: 16, font: 'jua' }] }],
  };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: id, content: JSON.stringify(doc0), font_size: 16 }], filters: [] });

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
      installWindowGuard(window);
      window.innerWidth = 1280; window.innerHeight = 800;
      window.matchMedia = query => ({ matches: COARSE ? /pointer:coarse/.test(query) : /pointer:fine/.test(query),
        media: query, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.BroadcastChannel = class { postMessage(){} close(){} addEventListener(){} };
      window.EventSource = class { close(){} addEventListener(){} };
      window.cancelIdleCallback = clearTimeout;
      window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
      window.cancelAnimationFrame = clearTimeout;
      window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect(){}, drawImage(){}, fillRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, arc(){}, fill(){}, save(){}, restore(){}, scale(){}, translate(){}, setTransform(){}, measureText(){return {width:10}}, getImageData(){return {data:new Uint8ClampedArray(4)}}, putImageData(){} });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class { constructor(){this.paused=true;} play(){return Promise.resolve()} pause(){} addEventListener(){} removeEventListener(){} };
      window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
    },
  });
  const { window } = dom, { document } = window;
  const boot = Date.now();
  while (Date.now() - boot < 8_000 && document.querySelectorAll('.note-stack .note-card').length < 1) await wait(60);
  const card = [...document.querySelectorAll('.note-stack .note-card')].find(c => (c.textContent || '').includes('더블클릭캐럿'));
  check('노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1600);
  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));

  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });
  const tb = document.querySelector('#pagesStage .tb');
  const content = tb.querySelector('.tb-content');
  check('원문 그대로 그려진다', content.textContent === TEXT);

  // ── 합성 히트테스트: 좌표 → 글상자 안 텍스트 오프셋 ─────────────────────────
  const textNodes = root => {
    const out = [], tw = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT);
    let n; while ((n = tw.nextNode())) out.push(n);
    return out;
  };
  const caretIndex = () => {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return -1;
    const r = s.getRangeAt(0);
    let acc = 0;
    for (const n of textNodes(content)) {
      if (n === r.startContainer) return acc + r.startOffset;
      acc += n.nodeValue.length;
    }
    return -1;   // 캐럿이 이 글상자 밖에 있다
  };
  document.caretRangeFromPoint = (x, y) => {
    if (y < 0) return null;
    const nodes = textNodes(content);
    let idx = Math.round((x - ORIGIN_X) / CHAR_W), acc = 0;
    idx = Math.max(0, Math.min(TEXT.length, idx));
    for (const n of nodes) {
      if (acc + n.nodeValue.length >= idx) {
        const r = document.createRange(); r.setStart(n, idx - acc); r.collapse(true); return r;
      }
      acc += n.nodeValue.length;
    }
    const r = document.createRange(); r.selectNodeContents(content); r.collapse(false); return r;
  };
  // pointer 이벤트 체인 — Chrome·Edge 의 실제 값대로 detail 은 항상 0 이다.
  const down = (x, y) => content.dispatchEvent(new window.MouseEvent('pointerdown',
    { bubbles: true, cancelable: true, button: 0, buttons: 1, detail: 0, clientX: x, clientY: y }));
  const up = (x, y) => document.dispatchEvent(new window.MouseEvent('pointerup',
    { bubbles: true, cancelable: true, button: 0, buttons: 0, detail: 0, clientX: x, clientY: y }));
  const dbl = (x, y) => content.dispatchEvent(new window.MouseEvent('dblclick',
    { bubbles: true, cancelable: true, button: 0, detail: 2, clientX: x, clientY: y }));

  // ── ① 데스크톱 더블클릭: 눌린 자리에 캐럿 ─────────────────────────────────
  const x1 = X_AT(CLICK_IDX);
  down(x1, Y_LINE); up(x1, Y_LINE); await wait(60);
  check('첫 클릭은 상자를 선택만 한다', tb.classList.contains('sel') && !tb.classList.contains('edit'));
  check('첫 클릭으로는 편집에 들어가지 않는다', !tb.classList.contains('edit'));
  down(x1, Y_LINE); up(x1, Y_LINE); dbl(x1, Y_LINE);
  await wait(200);
  check('더블클릭으로 편집 모드 진입', tb.classList.contains('edit'));
  const sel = window.getSelection();
  check('편집 진입 직후 캐럿이 존재한다', !!sel && sel.rangeCount === 1);
  check('캐럿이 눌린 자리에 선다', caretIndex() === CLICK_IDX);
  check('캐럿이 상자 맨 앞으로 가지 않는다', caretIndex() !== 0);
  check('캐럿은 접혀 있다(단어 전체 선택 아님)', sel.isCollapsed);

  // 편집 중에 다른 자리를 다시 누르면 그 자리로 이동한다 (회귀 방지)
  const x2 = X_AT(15);
  down(x2, Y_LINE); up(x2, Y_LINE); await wait(80);
  check('편집 중 재클릭도 눌린 자리로 캐럿이 이동한다', caretIndex() === 15);

  // ── ② 모바일: 이미 선택된 상자를 다시 탭 → 눌린 자리에 캐럿 ────────────────
  COARSE = true;
  window.eval('exitEditKeepSel(paperQ(0,".tb")); clearTextSelection(); deselectAll(true)');
  await wait(120);
  check('편집을 끝내고 선택도 푼다', !tb.classList.contains('edit') && !tb.classList.contains('sel'));
  const x3 = X_AT(4);
  down(x3, Y_LINE); up(x3, Y_LINE); await wait(80);
  check('모바일 첫 탭은 선택만', tb.classList.contains('sel') && !tb.classList.contains('edit'));
  down(x3, Y_LINE); up(x3, Y_LINE); await wait(200);
  check('모바일 다시 탭으로 편집 모드 진입', tb.classList.contains('edit'));
  check('모바일 다시 탭도 눌린 자리에 캐럿', caretIndex() === 4);
  check('모바일 캐럿이 상자 맨 앞으로 가지 않는다', caretIndex() !== 0);
  COARSE = false;

  check('치명적 런타임 오류가 없다', errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5).join('\n'));

  console.log(`\n더블클릭 캐럿 위치: PASS ${pass}`);
} catch (e) {
  console.error('FAIL: ' + (e && e.stack || e));
  throw e;
} finally {
  try { child.kill('SIGTERM'); } catch {}
  await closeDoms([dom]);
}
