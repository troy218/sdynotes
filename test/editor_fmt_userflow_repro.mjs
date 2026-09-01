/* 사용자 보고 재현 · SDY-FMT v2 (18.11 회귀 검증)
   ① 텍스트를 쳤다 → 상자 나감 → 재진입 → 친 글자 일부 선택 → 바로 볼드
      (iOS 식: 툴바 탭으로 포커스 도난 → Selection 이 고스트 위치로 접힘)
   ② 뉴라인(Enter) 다음 줄에서 글꼴이 풀림
   ③ 가나다라 + 띄어쓰기 → 글꼴 변경 → 바로 입력 시 새 글꼴이 안 씌워짐
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

const wait = ms => new Promise(r => setTimeout(r, ms));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-fmtuf-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
}
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + extra : '')); }
};

async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/src/index.js'], {
  cwd: path.resolve(new URL('..', import.meta.url).pathname),
  env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
let dom;
try {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died');
    try { const r = await fetch(base + '/api/health'); if (r.ok) break; } catch (e) {}
    await wait(150);
  }
  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '유저흐름', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [
      { type: 'text', id: 't1', x: 40, y: 40, w: 360, h: 120, html: '', fontSize: 16 },
      { type: 'text', id: 't2', x: 40, y: 200, w: 360, h: 120, html: '', fontSize: 16 },
      { type: 'text', id: 't3', x: 40, y: 360, w: 360, h: 120, html: '', fontSize: 16 },
      { type: 'text', id: 't4', x: 40, y: 520, w: 360, h: 120, html: '', fontSize: 16 },
      { type: 'text', id: 't5', x: 40, y: 680, w: 360, h: 120, html: '', fontSize: 16 },
    ] }],
  };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: nb.data.id, content: JSON.stringify(doc0), font_size: 16 }], filters: [] });

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', m => { if (!/HTMLMediaElement|Could not load (link|script)/.test(String(m))) errors.push(String(m)); });
  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      installWindowGuard(window);
      // jsdom 의 contentEditable 프로퍼티가 속성에 반영되지 않아 focus() 가
      // 먹지 않는 문제를 브라우저처럼 만든다 (실제 브라우저는 반영됨).
      Object.defineProperty(window.HTMLElement.prototype, 'contentEditable', {
        get(){ const v = this.getAttribute('contenteditable'); return v == null ? 'inherit' : v; },
        set(v){ this.setAttribute('contenteditable', String(v)); },
        configurable: true, enumerable: true,
      });
      // jsdom 의 Range.compareBoundaryPoints 는 (요소,0) 과 (첫 자식,0) 처럼
      // 같은 위치를 다른 위치로 판정한다 — 브라우저와 같게 보정한다.
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
      window.Audio = class { constructor(){this.paused=true;} play(){return Promise.resolve()} pause(){} load(){} addEventListener(){} removeEventListener(){} };
      window.HTMLMediaElement.prototype.pause = function(){};
      window.HTMLMediaElement.prototype.load = function(){};
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
  const card = [...document.querySelectorAll('.note-stack .note-card')].find(c => (c.textContent || '').includes('유저흐름'));
  check('노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1600);
  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));

  // ── 공통 유틸 ──────────────────────────────────────────────────────
  const tbOf = id => document.querySelector(`#pagesStage .tb[data-id="${id}"]`);
  const textNodes = c => {
    const tw = document.createTreeWalker(c, window.NodeFilter.SHOW_TEXT);
    const arr = []; let n; while ((n = tw.nextNode())) arr.push(n);
    return arr;
  };
  const charStyle = (c, ch, nth = 0) => {
    const full = c.textContent || '';
    let at = -1;
    for (let k = 0; k <= nth; k++) { at = full.indexOf(ch, at + 1); }
    if (at < 0) return { __missing: ch };
    let off = 0;
    for (const n of textNodes(c)) {
      const v = n.nodeValue || '';
      if (off + v.length > at) {
        const st = {};
        let p = n.parentElement;
        while (p && p !== c) {
          if (p.style) for (const key of ['fontWeight','fontStyle','textDecoration','color','backgroundColor','fontFamily','fontSize'])
            if (p.style[key] && !(key in st)) st[key] = p.style[key];
          p = p.parentElement;
        }
        if (c.style) for (const key of ['fontWeight','fontStyle','textDecoration','color','backgroundColor','fontFamily','fontSize'])
          if (c.style[key] && !(key in st)) st[key] = c.style[key];
        return st;
      }
      off += v.length;
    }
    return {};
  };
  const selectSpan = (c, a, b) => {
    let off = 0, sn = null, so = 0, en = null, eo = 0;
    for (const n of textNodes(c)) {
      const v = n.nodeValue || '';
      if (!sn && off + v.length > a) { sn = n; so = a - off; }
      if (sn && !en && off + v.length >= b) { en = n; eo = b - off; break; }
      off += v.length;
    }
    const r = document.createRange();
    r.setStart(sn, so); r.setEnd(en, eo);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
    window.saveSel();
    return r;
  };
  const caretEnd = (c) => {
    let off = 0, last = null, lastOff = 0;
    for (const n of textNodes(c)) {
      const v = n.nodeValue || '';
      if (v.length) { last = n; lastOff = v.length; }
      off += v.length;
    }
    const r = document.createRange();
    if (last) { r.setStart(last, lastOff); } else { r.setStart(c, 0); }
    r.collapse(true);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
    window.saveSel();
    return r;
  };
  // 캐럿 위치에 글자 입력 (beforeinput → DOM → input) — 브라우저 타이핑 흉내
  const typeText = (c, text) => {
    c.dispatchEvent(new window.InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true }));
    const s = window.getSelection();
    if (!s.rangeCount) { caretEnd(c); }
    const r = s.getRangeAt(0);
    if (!r.collapsed) r.deleteContents();
    r.insertNode(document.createTextNode(text));
    r.collapse(false);
    s.removeAllRanges(); s.addRange(r);
    c.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  // Enter: Chrome 식 <div> 분할 흉내 (keydown → 캐럿 뒤의 줄 나머지 를 새 블록으로
  // 이동 → input). 인라인 span 이 중첩돼 있어도 추출(extractContents)로 처리한다.
  const pressEnter = (c) => {
    c.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const s = window.getSelection();
    const r = s.rangeCount ? s.getRangeAt(0) : null;
    if (!r || !r.collapsed) return;
    let nextDiv = null;
    for (const d of [...c.children]) {
      if (d.tagName !== 'DIV') continue;
      const dr = document.createRange(); dr.selectNode(d);
      if (r.compareBoundaryPoints(window.Range.END_TO_START, dr) < 0) { nextDiv = d; break; }
    }
    const rest = document.createRange();
    if (nextDiv) { rest.setStart(r.startContainer, r.startOffset); rest.setEndBefore(nextDiv); }
    else { rest.selectNodeContents(c); rest.setStart(r.startContainer, r.startOffset); }
    const nd = document.createElement('div');
    nd.appendChild(rest.extractContents());
    if (!nd.textContent && !nd.childElementCount) nd.appendChild(document.createElement('br'));
    c.insertBefore(nd, nextDiv);
    const nr = document.createRange();
    nr.selectNodeContents(nd); nr.collapse(true);
    s.removeAllRanges(); s.addRange(nr);
    c.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  // iOS 식 '고스트 접힘': 툴바 탭으로 포커스 도난 → blur → Selection 이
  // 임의 지점(여기선 상자 시작)으로 접히는 실제 브라우저 동작 흉내.
  const ghostBlur = (c) => {
    c.focus();
    // (선택 상태는 그대로 — blur 는 선택을 건드리지 않고 포커스만 뺀다)
    c.blur();                                  // blur 이벤트 → 앱이 고스트 창(300ms) 설치
    const r = document.createRange();          // 그 다음 브라우저가 Selection 을 접는다
    if (c.firstChild) r.setStart(c.firstChild, 0); else r.setStart(c, 0);
    r.collapse(true);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
  };
  const boldBtn = () => document.querySelector('.tb-bold');
  const clickBold = () => {
    // 실제 버튼: onmousedown="saveSel();event.preventDefault()" + onclick="execFmt('bold')"
    boldBtn().dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
    boldBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true, button: 0 }));
  };

  console.log('\n── ① 입력 → 상자 나감 → 재진입 → 일부 선택 → 볼드 ──');
  {
    const tb = tbOf('t1');
    const c = tb.querySelector('.tb-content');
    window.enterEdit(tb);
    await wait(30);
    typeText(c, '안녕하세요 반갑습니다');
    await wait(50);
    check('① 텍스트가 입력됐다', (c.textContent || '').includes('안녕하세요 반갑습니다'));
    window.deselectAll();                      // 상자 나감
    await wait(30);
    window.enterEdit(tb, true);                 // 재진입
    await wait(30);
    selectSpan(c, 6, 9);                       // '반갑습' 선택
    await wait(30);
    clickBold();                                // 포커스 유지(데스크톱) — 회귀
    await wait(80);
    check('①a 선택한 "반갑습" 이 굵어진다 (데스크톱)', charStyle(c, '반').fontWeight === '700' && charStyle(c, '습').fontWeight === '700');
    check('①a 선택 밖 글자는 그대로다', !charStyle(c, '안').fontWeight && !charStyle(c, '니').fontWeight);

    // ①b iOS 식: 선택 후 바 탭 → 포커스 도난 → 고스트 접힘 → 볼드
    window.deselectAll();
    await wait(20);
    c.innerHTML = '안녕하세요 반갑습니다';
    window.enterEdit(tb, true);
    await wait(20);
    selectSpan(c, 6, 9);
    await wait(20);
    ghostBlur(c);
    await wait(50);
    clickBold();
    await wait(80);
    check('①b 고스트 접힘 뒤에도 "반갑습" 만 굵어진다 (iOS 식)',
      charStyle(c, '반').fontWeight === '700' && charStyle(c, '습').fontWeight === '700',
      'innerHTML: ' + c.innerHTML);
    check('①b 고스트 위치(선두 "안") 에 엉뚱한 볼드가 없다', !charStyle(c, '안').fontWeight);
    check('①b 선택 밖 글자는 그대로다', !charStyle(c, '니').fontWeight);
  }

  console.log('\n── ② 뉴라인 다음 줄 글꼴 유지 ──');
  {
    // ②a 캐럿 글꼴(Jua) 로 입력 → Enter → 다음 줄도 Jua
    const tb = tbOf('t2');
    const c = tb.querySelector('.tb-content');
    window.enterEdit(tb);
    await wait(20);
    typeText(c, '첫');
    window.applyFont('jua');
    await wait(30);
    typeText(c, '줄입니다');
    await wait(50);
    check('②a Jua 로 입력된다', (charStyle(c, '줄').fontFamily || '').includes('Jua'));
    pressEnter(c);
    await wait(30);
    typeText(c, '두번째');
    await wait(50);
    check('②a 다음 줄에도 Jua 가 유지된다', (charStyle(c, '두').fontFamily || '').includes('Jua'),
      'innerHTML: ' + c.innerHTML);

    // ②b 선택에 입힌 글꼴(Jua) → Enter → 다음 줄도 Jua (보고 이슈②)
    const tb2 = tbOf('t3');
    const c2 = tb2.querySelector('.tb-content');
    window.enterEdit(tb2);
    await wait(20);
    typeText(c2, '첫줄');
    await wait(30);
    selectSpan(c2, 0, 2);
    window.applyFont('jua');
    await wait(60);
    check('②b 선택 "첫줄" 에 Jua 가 먹는다', (charStyle(c2, '첫').fontFamily || '').includes('Jua'));
    caretEnd(c2);                               // 줄 끝으로 캐럿
    await wait(20);
    pressEnter(c2);
    await wait(30);
    typeText(c2, '두번째');
    await wait(50);
    check('②b 선택 글꼴이어도 다음 줄이 Jua 로 이어진다', (charStyle(c2, '두').fontFamily || '').includes('Jua'),
      'innerHTML: ' + c2.innerHTML);
    check('②b 첫 줄 "첫줄" 의 Jua 는 보존된다', (charStyle(c2, '첫').fontFamily || '').includes('Jua'));
  }

  console.log('\n── ③ 가나다라 + 띄어쓰기 → 글꼴 변경 → 즉시 입력 ──');
  {
    // ③a 포커스 유지(데스크톱) — 회귀
    const tb = tbOf('t4');
    const c = tb.querySelector('.tb-content');
    window.enterEdit(tb);
    await wait(20);
    typeText(c, '가나다라');
    typeText(c, ' ');
    await wait(30);
    caretEnd(c);
    window.applyFont('gaegu');
    await wait(30);
    typeText(c, '마바');
    await wait(50);
    check('③a 띄어쓰기 뒤 새 글꼴(Gaegu) 이 즉시 적용된다 (데스크톱)',
      (charStyle(c, '마').fontFamily || '').includes('Gaegu'), 'innerHTML: ' + c.innerHTML);
    check('③a 앞의 "가나다라" 는 옛 글꼴 유지', !(charStyle(c, '가').fontFamily || '').includes('Gaegu'));

    // ③b iOS 식: 글꼴 메뉴 탭 → 포커스 도난 + 고스트 접힘 → 글꼴 변경 → 이어 입력
    const tb2 = tbOf('t5');
    const c2 = tb2.querySelector('.tb-content');
    window.enterEdit(tb2);
    await wait(20);
    typeText(c2, '가나다라');
    typeText(c2, ' ');
    await wait(30);
    caretEnd(c2);
    ghostBlur(c2);                               // 폰트 메뉴 탭 (포커스 도난)
    await wait(30);
    window.applyFont('gaegu');                   // 폰트 항목 탭
    await wait(30);
    // 사용자가 상자 끝을 다시 탭해 입력을 이은다
    c2.focus();
    caretEnd(c2);
    await wait(30);
    typeText(c2, '마바');
    await wait(50);
    check('③b 고스트 접힘 뒤에도 새 글꼴(Gaegu) 이 즉시 적용된다 (iOS 식)',
      (charStyle(c2, '마').fontFamily || '').includes('Gaegu'), 'innerHTML: ' + c2.innerHTML);
    check('③b 앞의 "가나다라" 는 옛 글꼴 유지', !(charStyle(c2, '가').fontFamily || '').includes('Gaegu'));
  }

  if (errors.length) { console.log('\n  페이지 오류:'); errors.slice(0, 5).forEach(e => console.log('   ' + String(e).slice(0, 400))); }
  console.log(`\n통과 ${pass}건 · 실패 ${fail}건`);
  process.exitCode = fail ? 1 : 0;
} finally {
  await closeDoms([dom], { syncDrainMs: 1500, tailMs: 200 });
  try { child.kill('SIGKILL'); } catch (e) {}
}
