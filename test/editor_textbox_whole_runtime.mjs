/* 텍스트 상자 '전체' 런타임 검증 — 상자를 만들고, 통째로 꾸미고, 옮기고, 지우는 흐름

   실제 사용자가 한 글자가 아니라 '상자 단위'로 할 때의 동작을 jsdom 에서 확인한다.

     ① 상자를 클릭해 고른다 → 툴바가 이 상자의 글자 크기를 보여 준다
     ② 선택 없이 버튼을 누르면 상자 전체에 서식이 칠해진다
        · 글자색 → 상자 안 모든 글자
        · 굵게 → 전체 켜짐, 다시 누르면 전체 해제(워드식 토글)
        · 형광펜 → 전체 칠하고 '색 없음'으로 지우기
        · 정렬·글꼴·글자 크기 → 상자(el.align/el.font/el.fontSize)까지 저장
     ③ 텍스트 도구로 새 상자를 만들어 바로 적는다 (도구는 한 번 쓰면 꺼진다)
     ④ 빈 상자도 사라지지 않고 남는다 (연한 점선 안내 규칙)
     ⑤ Ctrl+클릭으로 두 상자를 함께 고르면 서식이 두 상자 모두에 칠해진다
     ⑥ 방향키로 상자(들)를 옮기고, 손잡이를 끌어 크기를 조절한다
     ⑦ Delete 로 지운 상자는 Ctrl+Z 로 되살아나고, 잠긴 상자는 지워지지 않는다
     ⑧ Ctrl+S 로 강제 저장하면 서버(메모)까지 그대로 저장된다 */
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-box-'));
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

// 한 글자(구간)에 실제로 먹은 스타일 — 조상 span 의 inline 스타일을 위로 모은다
function effStyle(win, content, needle) {
  const tw = win.document.createTreeWalker(content, win.NodeFilter.SHOW_TEXT);
  let tn = null, n;
  while ((n = tw.nextNode())) if ((n.nodeValue || '').includes(needle)) { tn = n; break; }
  assert.ok(tn, `스타일 조회 대상 '${needle}' 텍스트를 찾지 못했다`);
  const out = {};
  let p = tn.parentElement;
  while (p && p !== content) {
    if (p.nodeType === 1 && p.style) {
      for (const k of ['color', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration', 'backgroundColor']) {
        const v = p.style[k];
        if (v && !(k in out)) out[k] = v;
      }
    }
    p = p.parentElement;
  }
  return out;
}
// 상자 안 '모든' 글자의 유효 스타일이 하나라도 조건을 벗어나면 실패
function allChars(win, content, needle) {
  const tw = win.document.createTreeWalker(content, win.NodeFilter.SHOW_TEXT);
  const arr = [];
  let n;
  while ((n = tw.nextNode())) if ((n.nodeValue || '').trim()) arr.push(n.nodeValue);
  return arr.join('');
}
function clickBox(win, content, opts = {}) {
  content.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1, clientX: 60, clientY: 20, ...opts }));
  // mouseup 은 document 로 — 종료 처리(finishEditorPointer)가 document 에 붙어 있다
  win.document.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, button: 0, ...opts }));
}
function blur(win) {
  const ae = win.document.activeElement;
  if (ae && ae.blur) ae.blur();
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
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '상자 전체', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [{ type: 'text', id: 't1', x: 60, y: 60, w: 220, h: 60, html: '메모 시작', fontSize: 16 }] }],
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
      // jsdom 은 contentEditable 프로퍼티를 contenteditable 속성에 반영하지 않아
      // 편집 상자 focus() 가 먹지 않는다(실제 브라우저는 반영됨) — 보강한다.
      Object.defineProperty(window.HTMLElement.prototype, 'contentEditable', {
        get(){ const v = this.getAttribute('contenteditable'); return v == null ? 'inherit' : v; },
        set(v){ this.setAttribute('contenteditable', String(v)); },
        configurable: true, enumerable: true,
      });
      // jsdom 의 Range.compareBoundaryPoints 는 (요소,0) 과 (첫 자식,0) 처럼
      // 같은 위치를 다른 위치로 판정한다(브라우저는 0) — 브라우저처럼 보정한다.
      {
        const proto = window.Range.prototype;
        const orig = proto.compareBoundaryPoints;
        const preIndex = node => {
          let i = 0;
          const tw = node.ownerDocument.createTreeWalker(node.ownerDocument.documentElement, window.NodeFilter.SHOW_ALL);
          let n;
          while ((n = tw.nextNode())) { if (n === node) return i; i++; }
          return -1;
        };
        const canon = (node, off) => {
          while (node.nodeType === 1 && off < node.childNodes.length) { node = node.childNodes[off]; off = 0; }
          return [node, off];
        };
        const cmpPts = (n1, o1, n2, o2) => {
          if (n1 === n2) return o1 < o2 ? -1 : o1 > o2 ? 1 : 0;
          const a = canon(n1, o1), b = canon(n2, o2);
          if (a[0] === b[0]) return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
          const ka = 2 * preIndex(a[0]) + (a[1] > 0 ? 1 : 0);
          const kb = 2 * preIndex(b[0]) + (b[1] > 0 ? 1 : 0);
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        };
        proto.compareBoundaryPoints = function (how, other) {
          try {
            const useA = (how === 0 || how === 2) ? 'start' : 'end';
            const useB = (how === 0 || how === 3) ? 'start' : 'end';
            const a = useA === 'start' ? [this.startContainer, this.startOffset] : [this.endContainer, this.endOffset];
            const b = useB === 'start' ? [other.startContainer, other.startOffset] : [other.endContainer, other.endOffset];
            if (a[0] && b[0] && a[0].nodeType != null && b[0].nodeType != null
                && a[0].ownerDocument === b[0].ownerDocument) {
              return cmpPts(a[0], a[1], b[0], b[1]);
            }
          } catch {}
          return orig.call(this, how, other);
        };
      }
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
    .find(c => (c.textContent || '').includes('상자 전체'));
  check('노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1600);
  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));

  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  // 종이 실사 크기 = 문서 좌표 1:1 (A4 세로 800×1100)
  paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });
  let tb = document.querySelector('#pagesStage .tb[data-id="t1"]');
  let content = tb.querySelector('.tb-content');
  check('글상자가 그려진다', !!content && (content.textContent || '').includes('메모 시작'));
  // jsdom 에는 layout 이 없어 offsetWidth/Height 가 0 — 상자 실제 크기(220×60)를 심어 둔다
  Object.defineProperty(tb, 'offsetWidth', { value: 220, configurable: true });
  Object.defineProperty(tb, 'offsetHeight', { value: 60, configurable: true });

  // ── ① 클릭으로 상자 고르기 ────────────────────────────────────────────
  clickBox(window, content);
  await wait(80);
  check('클릭하면 상자가 선택된다', tb.classList.contains('sel'));
  check('툴바 글자 크기칸이 이 상자 값(16)을 보여 준다', document.getElementById('fsInput').value === '16');

  // ── ② 상자 전체 서식 ──────────────────────────────────────────────────
  window.clearTextSelection();
  window.applyTextColor('#8e44ad');
  await wait(120);
  check('상자 전체 글자색 — 모든 글자가 보라색이다',
    effStyle(window, content, '메모').color === 'rgb(142, 68, 173)'
    && effStyle(window, content, '시작').color === 'rgb(142, 68, 173)');
  {
    const el = window.findEl(0, 't1');
    check('상자 글자색이 문서(el)에도 반영된다', (el.html || '').includes('142, 68, 173'));
  }

  window.execFmt('bold');
  await wait(120);
  check('상자 전체 굵게 — 모든 글자가 700 이다',
    effStyle(window, content, '메모').fontWeight === '700' && effStyle(window, content, '시작').fontWeight === '700');
  window.execFmt('bold');
  await wait(120);
  check('다시 누르면 상자 전체 굵게가 해제된다',
    effStyle(window, content, '메모').fontWeight !== '700' && effStyle(window, content, '시작').fontWeight !== '700');
  check('굵게 토글 후에도 글자색은 남는다', effStyle(window, content, '메모').color === 'rgb(142, 68, 173)');

  window.applyHighlight('#fff59d');
  await wait(120);
  check('상자 전체 형광펜이 칠해진다', effStyle(window, content, '메모').backgroundColor === 'rgb(255, 245, 157)');
  window.applyHighlight(null);
  await wait(120);
  check("형광펜 '색 없음'은 배경만 지운다",
    effStyle(window, content, '메모').backgroundColor == null
    && effStyle(window, content, '메모').color === 'rgb(142, 68, 173)');

  window.setAlign('center');
  await wait(120);
  {
    const el = window.findEl(0, 't1');
    check('가운데 정렬이 상자(el.align)에 저장된다',
      content.style.textAlign === 'center' && el.align === 'center');
  }
  window.applyFont('jua');
  await wait(120);
  {
    const el = window.findEl(0, 't1');
    check('글꼴이 상자(el.font·style)에 저장된다',
      el.font === 'jua' && (content.style.fontFamily || '').includes('Jua'));
  }
  window.setFS(22);
  await wait(120);
  {
    const el = window.findEl(0, 't1');
    check('글자 크기가 상자(el.fontSize·style)에 저장된다',
      el.fontSize === 22 && content.style.fontSize === '22px');
    check('툴바 글자 크기칸도 22 를 보여 준다', document.getElementById('fsInput').value === '22');
  }

  // ── ③ 텍스트 도구로 새 상자 만들어 바로 적기 ──────────────────────────
  window.setTextTool(true);
  await wait(80);
  check('텍스트 도구가 켜진다',
    document.getElementById('textToolBtn').classList.contains('active')
    && document.body.classList.contains('placing-text'));
  paper.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 300, clientY: 300 }));
  document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await wait(150);
  const els0 = window.findEl(0, 't1') ? (function(){
    // 페이지 요소 수는 doc 에서 직접 못 읽으니 DOM 으로 센다
    return document.querySelectorAll('#pagesStage .paper[data-page-idx="0"] .tb').length;
  })() : 0;
  check('종이를 누른 자리에 새 상자가 생기고 바로 편집 모드다',
    document.querySelectorAll('#pagesStage .paper[data-page-idx="0"] .tb').length === 2
    && document.querySelector('#pagesStage .tb.edit') != null);
  check('상자를 만들면 텍스트 도구는 저절로 꺼진다',
    !document.getElementById('textToolBtn').classList.contains('active')
    && !document.body.classList.contains('placing-text'));
  {
    const editBox = document.querySelector('#pagesStage .tb.edit');
    const ec = editBox.querySelector('.tb-content');
    // 캐럿을 끝으로 (브라우저라 클릭 지점에 놓이는 자리)
    const r = document.createRange();
    if (ec.childNodes.length) r.setStartAfter(ec.lastChild); else r.setStart(ec, 0);
    r.collapse(true);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); window.saveSel();
    ec.dispatchEvent(new window.InputEvent('input', { bubbles: true }));
    // 두 단어로 나눠 쳐 본다 (input 이벤트 여러 번)
    const put = t => {
      const rr = window.getSelection().rangeCount ? window.getSelection().getRangeAt(0) : null;
      if (rr && !rr.collapsed) rr.deleteContents();
      rr.insertNode(document.createTextNode(t));
      rr.collapse(false);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(rr);
      ec.dispatchEvent(new window.InputEvent('input', { bubbles: true }));
    };
    put('두 번째'); await wait(30); put(' 메모');
    await wait(420);                                   // input 디바운스 저장
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(200);
    check('새 상자에 적은 글이 저장된다',
      !editBox.classList.contains('edit') && (ec.textContent || '').includes('두 번째 메모'));
  }

  // ── ④ 빈 상자도 남는다 ────────────────────────────────────────────────
  window.setTextTool(true);
  await wait(60);
  paper.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 300, clientY: 480 }));
  document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await wait(150);
  const emptyBox = document.querySelector('#pagesStage .tb.edit');
  check('세 번째 상자가 편집 모드로 생긴다', !!emptyBox);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(200);
  check('아무 글도 안 적은 상자는 빈 상자 표시가 붙는다',
    emptyBox.classList.contains('empty') && emptyBox.querySelector('.tb-content').getAttribute('data-empty') === 'true');
  check('빈 상자도 사라지지 않고 남는다',
    document.querySelectorAll('#pagesStage .paper[data-page-idx="0"] .tb').length === 3);

  // ── ⑤ Ctrl+클릭 다중 선택 → 두 상자 모두에 서식 ──────────────────────
  window.clearTextSelection();
  {
    const boxA = document.querySelector('#pagesStage .tb[data-id="t1"] .tb-content');
    const boxes = [...document.querySelectorAll('#pagesStage .paper[data-page-idx="0"] .tb')]
      .filter(b => b.dataset.id !== 't1' && (b.querySelector('.tb-content').textContent || '').includes('두 번째'));
    const boxB = boxes[0];
    // 상자를 만든 직후에는 500ms 포인터 블록이 걸린다(앱 규칙) — 사용자도
    // 바로 다음 클릭이 먹지 않음을 알고 잠시 뒤에 누른다.
    await wait(620);
    clickBox(window, boxA, { ctrlKey: true });
    await wait(60);
    clickBox(window, boxB.querySelector('.tb-content'), { ctrlKey: true });
    await wait(60);
    check('Ctrl+클릭 두 번으로 두 상자가 함께 선택된다',
      document.querySelectorAll('#pagesStage .tb.msel').length === 2);
    window.applyTextColor('#d35400');
    await wait(150);
    check('다중 선택 서식이 두 상자 모두에 칠해진다',
      effStyle(window, boxA, '메모').color === 'rgb(211, 84, 0)'
      && effStyle(window, boxB.querySelector('.tb-content'), '두 번째').color === 'rgb(211, 84, 0)');
  }

  // ── ⑥ 방향키 이동 + 손잡이 리사이즈 ───────────────────────────────────
  blur(window);
  paper.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 700, clientY: 1000 }));
  document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await wait(120);
  check('빈 종이를 누르면 선택이 모두 풀린다',
    document.querySelectorAll('#pagesStage .tb.sel, #pagesStage .tb.msel').length === 0);
  clickBox(window, content);
  await wait(80);
  {
    // 방향키(Shift 없음)는 스프레드시트처럼 '다음 상자'로 선택을 옮긴다
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await wait(120);
    const boxesNow = [...document.querySelectorAll('#pagesStage .paper[data-page-idx="0"] .tb')];
    const selBox = boxesNow.find(b => b.classList.contains('sel'));
    check('방향키 오른쪽이면 선택이 오른쪽 이웃 상자로 옮겨간다',
      !!selBox && selBox.dataset.id !== 't1');
    // Shift+방향키는 그 상자를 미세 이동한다
    const before = window.findEl(0, selBox.dataset.id).x;
    blur(window);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
    await wait(150);
    check('Shift+방향키 오른쪽으로 상자가 10px 움직인다',
      window.findEl(0, selBox.dataset.id).x === before + 10);
  }
  {
    const el0 = window.findEl(0, 't1');
    const h = tb.querySelector('.handle.h-se');
    h.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: el0.x + 220, clientY: el0.y + 60 }));
    await wait(80);
    document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1, clientX: el0.x + 320, clientY: el0.y + 110 }));
    await wait(120);
    document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
    await wait(250);
    const el1 = window.findEl(0, 't1');
    check(`오른쪽 아래 손잡이를 끌면 상자가 커진다 (220×60 → ${el1.w}×${el1.h})`,
      el1.w === 320 && el1.h === 110);
    check('리사이즈 후에도 내용은 그대로다', (content.textContent || '').includes('메모 시작'));
  }

  // ── ⑦ Delete 로 지우고 Ctrl+Z 로 되살리기, 잠금 보호 ──────────────────
  {
    const boxes = [...document.querySelectorAll('#pagesStage .paper[data-page-idx="0"] .tb')];
    const boxB = boxes.find(b => (b.querySelector('.tb-content').textContent || '').includes('두 번째'));
    clickBox(window, boxB.querySelector('.tb-content'));
    await wait(100);
    blur(window);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    await wait(200);
    check('Delete 키로 선택한 상자가 지워진다',
      !document.querySelector(`#pagesStage .tb[data-id="${boxB.dataset.id}"]`)
      && !window.findEl(0, boxB.dataset.id));
    await wait(350);                       // 히스토리 묶음 분리
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    await wait(300);
    const revived = document.querySelector(`#pagesStage .tb[data-id="${boxB.dataset.id}"]`);
    check('Ctrl+Z 로 지운 상자가 되살아난다', !!revived && !!window.findEl(0, boxB.dataset.id));
    check('되살아난 상자에 색도 그대로다',
      !!revived && effStyle(window, revived.querySelector('.tb-content'), '두 번째').color === 'rgb(211, 84, 0)');
    // 잠금 보호
    clickBox(window, revived.querySelector('.tb-content'));
    await wait(80);
    window.toggleLockEl();
    await wait(120);
    check('잠금 명령으로 el.locked 가 붙는다', window.findEl(0, boxB.dataset.id).locked === true);
    blur(window);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    await wait(200);
    check('잠긴 상자는 Delete 로 지워지지 않는다',
      !!document.querySelector(`#pagesStage .tb[data-id="${boxB.dataset.id}"]`));
    // 잠금 명령은 실행 뒤 선택을 푼다 → 사용자처럼 다시 고르고 해제한다
    clickBox(window, document.querySelector(`#pagesStage .tb[data-id="${boxB.dataset.id}"] .tb-content`));
    await wait(80);
    window.toggleLockEl();
    await wait(120);
    check('다시 잠금 명령을 내리면 풀린다', !window.findEl(0, boxB.dataset.id).locked);
  }

  // ── ⑧ Ctrl+S 강제 저장 → 서버 확인 ───────────────────────────────────
  blur(window);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
  await wait(1200);
  {
    const sel2 = await q({ table: 'memos', op: 'select', values: [], filters: [{ field: 'notebook_id', op: 'eq', value: String(id) }], limit: 1, single: true });
    const row = Array.isArray(sel2?.data) ? sel2.data[0] : sel2?.data;
    const memo = row?.content ? JSON.parse(row.content) : null;
    const els = memo?.pages?.[0]?.els || [];
    const t1 = els.find(e => e.id === 't1');
    const second = els.find(e => (e.html || '').includes('두 번째'));
    const empty = els.find(e => !(e.html || '').replace(/\u00a0/g, '').trim());
    check('서버에 세 상자가 모두 저장된다', els.filter(e => e.type === 'text').length === 3 && !!empty);
    // 18.8 · 첫 상자는 ⑤ 다중 선택에서 주황(#d35400)으로 다시 칠해졌다.
    //   예전에는 서식 span 이 겹겹이 쌓이며 옛 보라색이 바깥 span 에 남아 있었지만,
    //   이제는 상자 전체 서식이 한 겹으로 정리돼 '마지막에 칠한 색'만 남는다.
    check('첫 상자의 색·정렬·글꼴·크기가 서버에 남는다',
      (t1?.html || '').includes('211, 84, 0') && !(t1?.html || '').includes('142, 68, 173')
      && t1?.align === 'center' && t1?.font === 'jua' && t1?.fontSize === 22);
    check('첫 상자의 이동·리사이즈 결과가 서버에 남는다', t1?.w === 320 && t1?.h === 110);
    check('두 번째 상자의 글자색도 서버에 남는다', (second?.html || '').includes('211, 84, 0'));
  }

  const fatal = errors.filter(Boolean);
  check('상자 전체 흐름 중 치명적 런타임 오류가 없다', fatal.length === 0);
  if (fatal.length) console.log(fatal.slice(0, 5).join('\n---\n'));
  console.log(`\n텍스트 상자 전체(선택·전체 서식·생성·이동·삭제·저장): PASS ${pass} / FAIL 0`);
} catch (e) {
  console.error('\n상자 전체 런타임 실패:', e);
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
