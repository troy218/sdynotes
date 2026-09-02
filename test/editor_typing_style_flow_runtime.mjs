/* 타이핑 흐름 런타임 검증 — "글을 적다가 중간중간 스타일을 바꾸는" 실제 사용자 패턴

   사용자가 노트에 글을 적는 실제 흐름을 jsdom 에서 그대로 재현한다.

     ① 빈 글상자를 더블클릭해 편집을 시작하고 한 글자씩 타이핑한다
     ② 타이핑 도중 글자색을 바꾸고 이어서 적는다 → 새 글자만 색이 들어간다 (18.6)
     ③ 도중에 글꼴을 바꾸고 → 크기를 바꾸고 → 굵게를 켜고 이어서 적는다 (18.5)
        · 이미 적어 둔 글자는 그대로여야 한다
        · 상자 글꼴(el.font·font-family)도 풀리면 안 된다
     ④ Escape 로 커밋 → 다시 들어가 글자를 드래그해
        · 취소선을 걸고 다시 눌러 지우고 (워드식 토글)
        · 여러 span 에 걸친 선택에 다른 색을 칠한다 → 선택 밖 글자 보존
        · 부분만 서식된 선택에 같은 서식 → 워드처럼 '선택 전체'에 켠다
     ⑤ 상자 전체 형광펜 → Ctrl+Z 로 되돌리고 Ctrl+Y 로 다시 실행
     ⑥ 마지막 상태가 서버(메모)까지 저장된다 */
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

// CI/저부하 환경 차이로 고정 대기(ms)는 불안정하다 — 서버·DOM 이 원하는
// 상태가 될 때까지 폴링한다(한도 안에서). fn 은 (async 가능) truthy 를
// 돌려줘야 성공.
const pollUntil = async (fn, timeout = 8000, step = 80) => {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await Promise.resolve(fn()); } catch { /* 상태가 아직 준비 안 됨 */ }
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await wait(step);
  }
};


const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-type-'));
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

// ── 테스트 전용 편집 도우미 (실제 키 입력/드래그를 흉내 낸다) ─────────────
// 캐럿 위치에 글자를 넣고 input 이벤트를 낸다 (브라우저의 타이핑에 해당).
// 캐럿이 서식 span(.sdy-type) 안에 있으면 그 안으로 들어가는 것도 브라우저와 같다.
function typeAt(win, content, text) {
  const doc = win.document;
  const sel = win.getSelection();
  let r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  if (!r || !content.contains(r.startContainer)) {
    r = doc.createRange(); r.selectNodeContents(content); r.collapse(false);
  }
  if (!r.collapsed) r.deleteContents();          // 선택 위에 타이핑하면 지우고 쓴다
  r.insertNode(doc.createTextNode(text));
  r.collapse(false);
  sel.removeAllRanges(); sel.addRange(r);
  content.dispatchEvent(new win.InputEvent('input', { bubbles: true }));
}
// 편집 상자 맨 끝으로 캐럿을 옮긴다 (브라우저가 클릭 지점에 캐럿을 놓는 것에 해당)
function caretEnd(win, content) {
  const r = win.document.createRange();
  if (content.childNodes.length) r.setStartAfter(content.lastChild);
  else r.setStart(content, 0);
  r.collapse(true);
  const s = win.getSelection();
  s.removeAllRanges(); s.addRange(r);
  win.saveSel();
}
// 인접 텍스트 노드를 합치고 캐럿을 다시 잡는다 — 글자별 타이핑으로 쪼개진
// 텍스트 노드를 하나의 문장으로 만든다(앱의 _cleanupInline 이 하는 normalize 와 같다).
function settle(win, content) {
  try { content.normalize(); } catch {}
  caretEnd(win, content);
}
// '문자열 needle' 이 들어 있는 텍스트 노드 (가장 깊은 곳)
function textNodeOf(win, content, needle) {
  const tw = win.document.createTreeWalker(content, win.NodeFilter.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode())) if ((n.nodeValue || '').includes(needle)) return n;
  return null;
}
// needle 구간을 드래그로 선택한 것처럼 범위를 만들어 저장한다
function selectSub(win, content, needle, from = 0, to = null) {
  const tn = textNodeOf(win, content, needle);
  assert.ok(tn, `선택 대상 '${needle}' 텍스트를 찾지 못했다`);
  const at = (tn.nodeValue || '').indexOf(needle) + from;
  const r = win.document.createRange();
  r.setStart(tn, at);
  r.setEnd(tn, at + (to == null ? needle.length : to - from));
  const s = win.getSelection();
  s.removeAllRanges(); s.addRange(r);
  win.saveSel();
  return r;
}
// 서로 다른 텍스트 노드에 걸친 드래그 선택 — startNeedle 시작부터
// endNeedle 끝(endLen 만큼)까지를 범위로 잡아 저장한다.
function rangeAcross(win, content, startNeedle, endNeedle, endLen) {
  const tnS = textNodeOf(win, content, startNeedle);
  const tnE = textNodeOf(win, content, endNeedle);
  const miss = [!tnS && startNeedle, !tnE && endNeedle].filter(Boolean).join(', ');
  assert.ok(tnS && tnE, `범위 앵커 텍스트를 찾지 못했다: ${miss}`);
  const r = win.document.createRange();
  r.setStart(tnS, (tnS.nodeValue || '').indexOf(startNeedle));
  r.setEnd(tnE, (tnE.nodeValue || '').indexOf(endNeedle) + (endLen == null ? endNeedle.length : endLen));
  const s = win.getSelection();
  s.removeAllRanges(); s.addRange(r);
  win.saveSel();
  return r;
}
// 한 글자(구간)에 실제로 먹은 스타일 — 조상 span 의 inline 스타일을 위로 모은다
function effStyle(win, content, needle) {
  const tn = textNodeOf(win, content, needle);
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
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '타이핑 흐름', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  // 빈 글상자 하나뿐인 새 노트 — 사용자가 방금 만든 노트라고 하자
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [{ type: 'text', id: 't1', x: 40, y: 40, w: 260, h: 70, html: '', fontSize: 16 }] }],
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
      // 편집 상자 focus() 가 먹지 않는다(실제 브라우저는 반영됨) — 브라우저처럼
      // 속성을 반영하는 접근자를 올려 둔다.
      Object.defineProperty(window.HTMLElement.prototype, 'contentEditable', {
        get(){ const v = this.getAttribute('contenteditable'); return v == null ? 'inherit' : v; },
        set(v){ this.setAttribute('contenteditable', String(v)); },
        configurable: true, enumerable: true,
      });
      // jsdom 의 Range.compareBoundaryPoints 는 (요소,0) 과 (첫 자식,0) 처럼
      // 같은 위치를 다른 위치로 판정한다(브라우저는 0). 서식 엔진의
      // _rangeCoversContents 같은 경계 비교가 브라우저와 같게 나오도록 보정한다.
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
        // 경계점을 '가장 깊은 리프의 시작/끝'으로 내려 정규화하면
        // (요소,0) == (첫 자식,0), (요소,자식수) == (마지막 자식,끝) 이 성립한다.
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
            const useA = (how === 0 || how === 2) ? 'start' : 'end';   // START_TO_START(0), END_TO_END(2)
            const useB = (how === 0 || how === 3) ? 'start' : 'end';   // START_TO_END(1), END_TO_START(3)
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
    .find(c => (c.textContent || '').includes('타이핑 흐름'));
  check('노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1600);
  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));

  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });
  const tb = document.querySelector('#pagesStage .tb[data-id="t1"]');
  const content = tb && tb.querySelector('.tb-content');
  check('빈 글상자가 그려진다', !!content);
  check('아직 아무 글자 없으면 빈 상자 표시가 붙는다',
    tb.classList.contains('empty') && content.getAttribute('data-empty') === 'true');

  // ── ① 더블클릭으로 편집 시작 → 한 글자씩 타이핑 ────────────────────────
  content.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(80);
  check('더블클릭하면 편집 모드로 들어간다', tb.classList.contains('edit') && content.contentEditable === 'true');
  caretEnd(window, content);
  for (const ch of '오늘 아침 ') { typeAt(window, content, ch); await wait(6); }
  settle(window, content);               // 쪼개진 텍스트 노드를 한 문장으로
  await wait(450);                       // input 디바운스(300ms) 후 저장 반영까지
  check('빈 상자 표시가 풀린다', !tb.classList.contains('empty') && !content.hasAttribute('data-empty'));
  check('타이핑한 글자가 상자에 남는다', (content.textContent || '').includes('오늘 아침'));
  {
    const el = window.findEl(0, 't1');
    check('타이핑한 글이 문서(el.html)에도 반영된다', (el && el.html || '').includes('오늘 아침'));
  }

  // ── ② 타이핑 도중 글자색 → 이어서 적으면 새 글자만 색이 들어간다 (18.6) ──
  window.applyTextColor('#e74c3c');
  await wait(120);
  const typeSpan = content.querySelector('.sdy-type');
  check('선택 없이 색을 고르면 캐럿에 서식 span 이 생긴다', !!typeSpan && typeSpan.style.color === 'rgb(231, 76, 60)');
  typeAt(window, content, '에 소금빵');
  await wait(80);
  check('새 글자에만 색이 들어간다', effStyle(window, content, '소금빵').color === 'rgb(231, 76, 60)');
  check('전에 적어 둔 글자는 색이 없다', effStyle(window, content, '오늘').color == null);

  // ── ③ 도중에 글꼴 → 크기 → 굵게, 계속 이어서 적기 (18.5) ──────────────
  window.applyFont('gaegu');
  await wait(120);
  typeAt(window, content, '을 먹었다');
  await wait(80);
  check('글꼴을 바꾼 뒤 적은 글자에만 그 글꼴이 들어간다',
    (effStyle(window, content, '먹었다').fontFamily || '').includes('Gaegu'));
  check('앞 글자의 글꼴은 그대로다', effStyle(window, content, '소금빵').fontFamily == null);
  check('글꼴을 바꿔도 상자 글꼴(style)은 그대로다',
    (content.style.fontFamily || '').indexOf('Pretendard') >= 0);
  check('앞 글자의 색도 살아 있다', effStyle(window, content, '소금빵').color === 'rgb(231, 76, 60)');

  window.setFS(24);
  await wait(120);
  typeAt(window, content, ' 정말');
  await wait(80);
  check('크기를 바꾼 뒤 적은 글자만 24px 다', effStyle(window, content, '정말').fontSize === '24px');
  check('앞 글자 크기는 상자 기본(16px)이다', effStyle(window, content, '먹었다').fontSize == null);

  window.execFmt('bold');
  await wait(120);
  typeAt(window, content, ' 맛있었다!');
  await wait(80);
  check('굵게를 켠 뒤 적은 글자만 굵다', effStyle(window, content, '맛있').fontWeight === '700');
  check('그 앞 글자는 굵지 않다', effStyle(window, content, '정말').fontWeight == null);
  check('캐럿 서식은 겹쳐 진다 (24px 글자에 굵게)',
    effStyle(window, content, '맛있').fontSize === '24px');

  // ── Escape 로 커밋 ────────────────────────────────────────────────────
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(200);
  check('Escape 로 편집이 끝나고 상자가 선택 상태로 남는다',
    !tb.classList.contains('edit') && tb.classList.contains('sel') && content.contentEditable === 'false');
  {
    const el = window.findEl(0, 't1');
    const html = el && el.html || '';
    check('커밋된 문장이 통째로 저장된다',
      (content.textContent || '').replace(/\u00a0/g, ' ') === '오늘 아침 에 소금빵을 먹었다 정말 맛있었다!');
    check('저장된 html 에 색·글꼴·크기·굵기 span 이 남는다',
      html.includes('231, 76, 60') && html.includes('Gaegu') && html.includes('24px') && html.includes('700'));
    check('캐럿 서식이라도 상자 크기·글꼴은 그대로 저장된다', el.fontSize === 16 && el.font !== 'gaegu');
  }

  // ── ④ 다시 들어가 드래그 선택으로 서식 ─────────────────────────────────
  content.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(80);
  check('다시 더블클릭하면 편집 모드다', tb.classList.contains('edit'));

  // ④-1 '소금빵'에 취소선 → 툴바 표시 → 다시 눌러 해제 (워드식 토글)
  selectSub(window, content, '소금빵');
  window.execFmt('strike');
  await wait(120);
  check('드래그한 구간에만 취소선이 생긴다',
    (effStyle(window, content, '소금빵').textDecoration || '').includes('line-through')
    && !(effStyle(window, content, '먹었다').textDecoration || '').includes('line-through'));
  await wait(60);
  check('취소선을 건 뒤 툴바 취소선 버튼이 켜진다', document.querySelector('.tb-strike').classList.contains('active'));
  selectSub(window, content, '소금빵');
  window.execFmt('strike');
  await wait(120);
  check('취소선 구간에서 다시 누르면 취소선이 사라진다',
    !(effStyle(window, content, '소금빵').textDecoration || '').includes('line-through'));
  check('취소선을 지워도 색은 그대로다', effStyle(window, content, '소금빵').color === 'rgb(231, 76, 60)');

  // ④-2 여러 span 에 걸친 선택에 새 색 → 선택 구간만, 선택 밖 보존
  {
    const start = textNodeOf(window, content, '오늘');
    const tnSb = textNodeOf(window, content, '소금빵');
    const r = document.createRange();
    r.setStart(start, 0);
    r.setEnd(tnSb, (tnSb.nodeValue || '').indexOf('소금빵') + 3);
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    window.saveSel();
    window.applyTextColor('#2ecc71');
    await wait(120);
    check('여러 span 에 걸친 선택 전체가 새 색이 된다',
      effStyle(window, content, '오늘').color === 'rgb(46, 204, 113)'
      && effStyle(window, content, '소금빵').color === 'rgb(46, 204, 113)');
    check('선택 밖 글자(을 먹었다)는 옛 색이 남는다',
      effStyle(window, content, '먹었다').color === 'rgb(231, 76, 60)');
    check('선택에 새 색을 칠해도 글꼴이 풀리지 않는다',
      (effStyle(window, content, '먹었다').fontFamily || '').includes('Gaegu'));
  }

  // ④-3 부분만 굵은 선택 → 워드처럼 선택 전체에 켜기 → 다시 누르면 전체 해제
  {
    rangeAcross(window, content, '정말', '맛있었다', 2);   // '정말 맛있'
    window.execFmt('bold');                 // '정말' 은 안 굵음 → 전체에 켜진다
    await wait(120);
    check('부분만 굵은 선택에 굵게를 누르면 선택 전체가 굵어진다',
      effStyle(window, content, '정말').fontWeight === '700'
      && effStyle(window, content, '맛있').fontWeight === '700');
    // 굵기를 넣는 바람에 '맛있었다' 텍스트 노드는 '맛있'+'었다!' 로 쪼개져 있다
    rangeAcross(window, content, '정말', '맛있', 2);       // 같은 '정말 맛있'
    window.execFmt('bold');                 // 이제 전부 굵음 → 전체 해제
    await wait(120);
    check('전부 굵은 선택에 다시 누르면 선택 전체에서 해제된다',
      effStyle(window, content, '정말').fontWeight !== '700'
      && effStyle(window, content, '맛있').fontWeight !== '700');
    check('굵기를 해제해도 24px 크기는 남는다', effStyle(window, content, '정말').fontSize === '24px');
  }

  // ── ⑤ 상자 전체 형광펜 → Ctrl+Z 되돌리기 → Ctrl+Y 다시 실행 ────────────
  window.clearTextSelection();
  await wait(400);                        // 히스토리 묶음(250ms) 분리용
  window.applyHighlight('#fff59d');       // 선택 없음 + 상자 선택 → 상자 전체
  // 전체-상자 페인트는 즉시지만, 직전 입력의 저장 디바운스(300ms)가 겹치면
  // DOM 이 잠시 뒤 다시 그려질 수 있다 — 배경이 실제로 보일 때까지 기다린다.
  const hlPainted = await pollUntil(() =>
    effStyle(window, content, '오늘').backgroundColor === 'rgb(255, 245, 157)'
    && effStyle(window, content, '맛있').backgroundColor === 'rgb(255, 245, 157)');
  check('상자 전체에 형광펜이 칠해진다', !!hlPainted);
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
  // 되돌리기는 문서를 통째로 복원하며 DOM 을 다시 그린다 → 참조를 새로 얻는다
  const contentU = await pollUntil(() => {
    const tbU = document.querySelector('#pagesStage .tb[data-id="t1"]');
    const cu = tbU && tbU.querySelector('.tb-content');
    if (!cu) return null;
    return effStyle(window, cu, '오늘').backgroundColor == null ? cu : null;
  });
  check('Ctrl+Z 로 상자 전체 형광펜이 되돌려진다', !!contentU);
  check('되돌려도 글자 내용은 그대로다', !!contentU && (contentU.textContent || '').includes('오늘 아침'));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true }));
  const contentR = await pollUntil(() => {
    const tbR = document.querySelector('#pagesStage .tb[data-id="t1"]');
    const cr = tbR && tbR.querySelector('.tb-content');
    if (!cr) return null;
    return effStyle(window, cr, '오늘').backgroundColor === 'rgb(255, 245, 157)' ? cr : null;
  });
  check('Ctrl+Y 로 형광펜이 다시 살아난다', !!contentR);

  // ── ⑥ 서버(메모)까지 저장 ─────────────────────────────────────────────
  // 저장은 디바운스 + flushSaveDoc 를 거치므로 부하가 걸리면 지연될 수 있다.
  // 고정 대기 대신 서버 메모에 문장+중간 스타일이 전부 남을 때까지 폴링한다.
  const saved = await pollUntil(async () => {
    const sel2 = await q({ table: 'memos', op: 'select', values: [], filters: [{ field: 'notebook_id', op: 'eq', value: String(id) }], limit: 1, single: true }).catch(() => null);
    const row = sel2 && (Array.isArray(sel2.data) ? sel2.data[0] : sel2.data);
    const memo = row?.content ? JSON.parse(row.content) : null;
    const el0 = memo?.pages?.[0]?.els?.[0];
    const h = el0?.html || '';
    return h.includes('오늘 아침')
      && h.includes('46, 204, 113') && h.includes('Gaegu')
      && h.includes('24px') && h.includes('255, 245, 157');
  }, 30000, 250);
  check('서버에도 문장이 저장된다', !!saved);
  check('서버에도 중간에 바꾼 스타일이 남는다', !!saved);

  // ── ⑦ 실제 요청 문장: 쓰는 도중 글꼴·크기·굵기를 차례로 변경 ──────────
  const liveTb = document.querySelector('#pagesStage .tb[data-id="t1"]');
  const liveContent = liveTb.querySelector('.tb-content');
  window.clearTextSelection();
  window.resetTypingFormat();
  window.enterEdit(liveTb, true);
  liveContent.innerHTML = '';
  caretEnd(window, liveContent);
  typeAt(window, liveContent, '가나다라');
  window.applyFont('jua'); await wait(40);

  // Safari/WebView가 빈 span을 지운 상황을 재현한다. beforeinput이 pending state로
  // wrapper를 복원해야 바로 다음 " 마바사"부터 주아 글꼴이 적용된다.
  const emptyFontSpan = liveContent.querySelector('.sdy-type');
  if (emptyFontSpan && !emptyFontSpan.textContent) emptyFontSpan.remove();
  caretEnd(window, liveContent);
  liveContent.dispatchEvent(new window.InputEvent('beforeinput', {
    bubbles: true, cancelable: true, inputType: 'insertText', data: ' '
  }));
  typeAt(window, liveContent, ' 마바사');
  window.setFS(24); await wait(40);
  typeAt(window, liveContent, ' 아자차카');
  window.execFmt('bold'); await wait(40);
  typeAt(window, liveContent, ' 타파하.');
  await wait(100);

  check('도중 서식 변경 타이핑 결과 문장이 정확하다',
    (liveContent.textContent || '').replace(/\u00a0/g, ' ') === '가나다라 마바사 아자차카 타파하.');
  check('먼저 쓴 가나다라는 이후 선택한 주아 글꼴의 영향을 받지 않는다',
    !(effStyle(window, liveContent, '가나다라').fontFamily || '').includes('Jua'));
  check('글꼴 변경 뒤 쓴 마바사부터 주아가 즉시 적용된다',
    (effStyle(window, liveContent, '마바사').fontFamily || '').includes('Jua'));
  check('크기 변경 뒤 쓴 아자차카부터 24px이 적용된다',
    effStyle(window, liveContent, '아자차카').fontSize === '24px'
    && effStyle(window, liveContent, '마바사').fontSize == null);
  check('굵게 변경 뒤 쓴 타파하만 굵고 앞 서식도 누적된다',
    effStyle(window, liveContent, '타파하').fontWeight === '700'
    && effStyle(window, liveContent, '타파하').fontSize === '24px'
    && effStyle(window, liveContent, '아자차카').fontWeight == null);

  const fatal = errors.filter(Boolean);
  check('타이핑·중간 스타일 변경 중 치명적 런타임 오류가 없다', fatal.length === 0);
  if (fatal.length) console.log(fatal.slice(0, 5).join('\n---\n'));
  console.log(`\n타이핑 흐름(도중 스타일 변경 · 선택 서식 · 되돌리기): PASS ${pass} / FAIL 0`);
} catch (e) {
  console.error('\n타이핑 흐름 런타임 실패:', e);
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
