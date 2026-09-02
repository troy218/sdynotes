/* 18.8 · 글자 선택 · 툴바 동기화 UX 런타임 계약

   사용자 보고:
     ① 좌클릭으로 끌어 고른 글자에 우클릭이 먹지 않는다
        (우클릭 순간 캐럿이 옮겨져 선택이 풀렸다)
     ② 새 텍스트 상자를 만들면 글꼴·크기는 이어져야 하지만
        굵게/기울임/밑줄/취소선 같은 서식은 풀려야 한다
     ③ 아무것도 고르지 않고 빈 화면을 누른 뒤 글자 크기를 올리면
        2 와 3 만 왔다 갔다 한다 (툴바 크기가 0 으로 초기화되던 버그)
     ④ 툴바에 보이는 글꼴 = 지금 입력되는 글꼴 이어야 하고,
        글자에 속성(굵게 등)을 입힌 뒤에도 글꼴 변경이 먹어야 한다
        (반대 순서는 원래 되던 것 — 회귀 방지로 함께 검사) */
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-selux-'));
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
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '선택UX', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [{ type: 'text', id: 't1', x: 40, y: 40, w: 300, h: 80, html: '안녕하세요 반갑습니다', fontSize: 16, font: 'jua' }] }],
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
      window.matchMedia = query => ({ matches: query.includes('pointer:fine'), media: query,
        addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
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
  const card = [...document.querySelectorAll('.note-stack .note-card')].find(c => (c.textContent || '').includes('선택UX'));
  check('노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1600);
  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));

  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });
  const tb = document.querySelector('#pagesStage .tb[data-id="t1"]');
  const content = tb.querySelector('.tb-content');
  const sel = () => window.getSelection();
  const fsVal = () => Number(document.getElementById('fsInput').value);
  const fontLabel = () => (document.getElementById('fontLabel').textContent || '').trim();
  const selectChars = (node, a, b) => {
    const r = document.createRange(); r.setStart(node, a); r.setEnd(node, b);
    const s = sel(); s.removeAllRanges(); s.addRange(r); window.saveSel(); return r;
  };
  const caretAt = (node, off) => {
    const r = document.createRange();
    r.setStart(node, off == null ? node.nodeValue.length : off); r.collapse(true);
    const s = sel(); s.removeAllRanges(); s.addRange(r); window.saveSel();
  };
  // 어떤 스타일이 '실제로 걸린' 글자들만 모아 준다 (가장 가까운 조상 기준)
  const styledText = (root, prop, test) => {
    const out = [];
    const tw = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      let p = n.parentElement, v = '';
      while (p && p !== root.parentElement) {
        if (p.style && p.style[prop]) { v = p.style[prop]; break; }
        if (prop === 'fontWeight' && (p.tagName === 'B' || p.tagName === 'STRONG')) { v = '700'; break; }
        if (prop === 'textDecoration' && p.tagName === 'U') { v = 'underline'; break; }
        p = p.parentElement;
      }
      if (v && test(v)) out.push(n.nodeValue);
    }
    return out.join('');
  };
  const menuFrom = (fn) => {
    let items = null;
    const orig = window.editorMenu;
    window.editorMenu = it => { items = it; };
    try { fn(); } catch (e) { errors.push('menu: ' + (e && e.message)); }
    window.editorMenu = orig;
    const flat = [];
    const walk = arr => (arr || []).forEach(it => { if (it && it.a) flat.push(it); else if (it && it.items) walk(it.items); });
    walk(items);
    return { items, flat };
  };
  // 툴바를 '실제로 눌러' 본다 (버튼의 onmousedown=saveSel 까지 그대로 태운다)
  const pressToolbar = (selector) => {
    const b = document.querySelector(selector);
    if (!b) { errors.push('toolbar button missing: ' + selector); return; }
    b.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    b.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  };
  const pickFont = (fid) => {
    const btn = document.getElementById('fontBtn');
    btn.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    const it = document.querySelector(`#fontMenu .font-item[data-f="${fid}"]`);
    if (!it) { errors.push('font item missing: ' + fid); return; }
    it.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    it.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  };
  // 브라우저처럼 '누른 자리로 캐럿이 옮겨가는' 동작을 흉내 낸다.
  // (이게 있어야 우클릭이 선택을 지우는지 진짜로 검사할 수 있다)
  document.caretRangeFromPoint = () => {
    const edit = document.querySelector('#pagesStage .tb.edit .tb-content')
      || document.querySelector('#pagesStage .tb-content');
    const r = document.createRange();
    if (edit && edit.firstChild && edit.firstChild.nodeType === 3) r.setStart(edit.firstChild, 0);
    else if (edit) r.setStart(edit, 0);
    r.collapse(true);
    return r;
  };

  // ══ ① 드래그로 고른 글자 위에서 우클릭 ═════════════════════════════════
  content.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, detail: 2 }));
  await wait(200);
  check('더블클릭으로 편집 모드에 들어간다', tb.classList.contains('edit'));
  content.innerHTML = '안녕하세요 반갑습니다';
  selectChars(content.firstChild, 0, 5);
  // 우클릭은 pointerdown(button=2) → contextmenu 순서로 들어온다.
  content.dispatchEvent(new window.MouseEvent('pointerdown',
    { bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: 120, clientY: 120 }));
  await wait(30);
  check('우클릭 pointerdown 이 드래그 선택을 지우지 않는다',
    !sel().isCollapsed && String(sel()) === '안녕하세요');
  const m1 = menuFrom(() => content.dispatchEvent(new window.MouseEvent('contextmenu',
    { bubbles: true, cancelable: true, button: 2, clientX: 120, clientY: 120 })));
  check('선택 글자 우클릭 메뉴가 뜬다', Array.isArray(m1.items));
  for (const a of ['copy', 'cut', 'bold', 'hl', 'clear', 'italic', 'under', 'strike', 'sel-newbox']) {
    check(`우클릭 메뉴에 '${a}' 동작이 있다`, m1.flat.some(it => it.a === a));
  }
  check('우클릭 뒤에도 선택이 살아 있다', !sel().isCollapsed && String(sel()) === '안녕하세요');
  // 메뉴에서 고른 서식이 '선택한 글자'에만 걸린다
  await window.editorAction('bold');
  await wait(120);
  check('우클릭 메뉴 굵게가 선택 글자에만 걸린다',
    styledText(content, 'fontWeight', v => Number(v) >= 600 || v === 'bold') === '안녕하세요');

  // ══ ④-a 속성을 입힌 뒤에도 글꼴 변경이 먹는다 ═══════════════════════════
  content.innerHTML = '안녕하세요 반갑습니다';
  selectChars(content.firstChild, 0, 5);
  pressToolbar('.tb-bold'); await wait(100);
  pressToolbar('.tb-under'); await wait(100);
  pickFont('gaegu'); await wait(150);
  check('굵게+밑줄을 입힌 뒤에도 글꼴이 바뀐다',
    styledText(content, 'fontFamily', v => /Gaegu/.test(v)).includes('안녕하세요'));
  check('글꼴을 바꿔도 굵게가 살아 있다',
    styledText(content, 'fontWeight', v => Number(v) >= 600 || v === 'bold').includes('안녕하세요'));
  check('글꼴을 바꿔도 밑줄이 살아 있다',
    styledText(content, 'textDecoration', v => /underline/.test(v)).includes('안녕하세요'));
  check('글꼴을 바꾸면 툴바 글꼴 이름도 개구쟁이다', /개구쟁이|Gaegu/.test(fontLabel()));

  // ④-b 반대 순서(글꼴 먼저 → 속성) 도 그대로 (회귀 방지)
  content.innerHTML = '안녕하세요 반갑습니다';
  selectChars(content.firstChild, 6, 11);
  pickFont('jua'); await wait(120);
  pressToolbar('.tb-bold'); await wait(120);
  check('글꼴 먼저 바꾼 뒤 굵게도 잘 먹는다',
    styledText(content, 'fontWeight', v => Number(v) >= 600 || v === 'bold').includes('반갑습니다')
    && styledText(content, 'fontFamily', v => /Jua/.test(v)).includes('반갑습니다'));

  // ══ ④-c 툴바 글꼴 = 지금 커서가 놓인 글자의 글꼴 ════════════════════════
  content.innerHTML = '<span style="font-family:\'Gaegu\',cursive">개구</span><span style="font-family:\'Jua\',sans-serif">주아</span>';
  const gaeguNode = content.querySelector('span').firstChild;
  const juaNode = content.querySelectorAll('span')[1].firstChild;
  caretAt(gaeguNode, 2); window.syncCurSel(); await wait(60);
  check('캐럿을 개구쟁이 글자에 두면 툴바가 개구쟁이를 보여 준다', /개구쟁이|Gaegu/.test(fontLabel()));
  caretAt(juaNode, 2); window.syncCurSel(); await wait(60);
  check('캐럿을 주아 글자에 두면 툴바가 주아로 바뀐다', /주아|Jua/.test(fontLabel()));
  // 크기도 따라온다
  content.innerHTML = '<span style="font-size:28px">크게</span>';
  caretAt(content.querySelector('span').firstChild, 2); window.syncCurSel(); await wait(60);
  check('캐럿 자리 글자 크기가 툴바에 반영된다', fsVal() === 28);

  // ══ ④-d 상자만 고른 상태: 서식을 입힌 뒤에도 상자 글꼴·크기 변경이 먹는다 ══
  // (실제 보고 상황 — 상자 전체 굵게 → 글꼴 변경이 화면에 반영되지 않았다)
  window.clearTextSelection();
  window.deselectAll();
  const tbBox = document.querySelector('#pagesStage .tb[data-id="t1"]');
  tbBox.querySelector('.tb-content').innerHTML = '상자전체글자';
  tbBox.classList.add('sel');
  await wait(60);
  pressToolbar('.tb-bold'); await wait(150);
  const cBox = tbBox.querySelector('.tb-content');
  check('상자 전체 굵게가 걸린다',
    styledText(cBox, 'fontWeight', v => Number(v) >= 600 || v === 'bold').includes('상자전체글자'));
  pickFont('gaegu'); await wait(200);
  const boxEl = window.findEl(0, 't1');
  check('상자 전체 굵게 뒤에도 상자 글꼴이 바뀐다', boxEl.font === 'gaegu');
  check('안쪽 span 에 옛 글꼴이 박제돼 있지 않다',
    !styledText(cBox, 'fontFamily', v => /Jua/.test(v)).includes('상자전체글자'));
  check('상자 글꼴이 실제로 개구쟁이로 그려진다', /Gaegu/.test(cBox.style.fontFamily || ''));
  window.setFS(40); await wait(150);
  check('상자 전체 굵게 뒤에도 글자 크기 변경이 먹는다',
    parseInt(cBox.style.fontSize, 10) === 40
    && !styledText(cBox, 'fontSize', v => /px/.test(v) && parseInt(v, 10) !== 40).includes('상자전체글자'));

  // ══ ③ 아무것도 고르지 않은 빈 화면에서 글자 크기 올리기 ════════════════
  window.setFS(30); await wait(60);
  window.clearTextSelection();
  window.deselectAll();
  await wait(80);
  check('빈 화면을 눌러도 툴바 크기가 유지된다', fsVal() === 30);
  pressToolbar('button[title="글씨 크게"]'); await wait(40);
  check('빈 화면에서 + 를 누르면 32 가 된다', fsVal() === 32);
  pressToolbar('button[title="글씨 크게"]'); await wait(40);
  check('한 번 더 누르면 34 로 계속 올라간다', fsVal() === 34);
  pressToolbar('button[title="글씨 작게"]'); await wait(40);
  check('- 를 누르면 32 로 내려간다', fsVal() === 32);

  // ══ ② 새 텍스트 상자: 글꼴·크기는 잇고 서식은 푼다 ══════════════════════
  // 편집 중인 상자에서 글꼴·크기를 고르고 굵게/밑줄까지 켜 둔 상태를 만든다
  const tbOld = document.querySelector('#pagesStage .tb[data-id="t1"]');
  window.enterEdit(tbOld, true); await wait(120);
  const cOld = tbOld.querySelector('.tb-content');
  cOld.innerHTML = '앞글자';
  caretAt(cOld.firstChild, 3);
  window.setFS(24); await wait(60);
  pickFont('gaegu'); await wait(80);
  pressToolbar('.tb-bold'); await wait(80);
  pressToolbar('.tb-under'); await wait(80);
  window.applyTextColor('#e74c3c'); await wait(80);
  window.applyHighlight('#ffff00'); await wait(80);
  check('이전 상자에서는 굵게 버튼이 켜져 있다', document.querySelector('.tb-bold').classList.contains('active'));
  check('이전 상자에서는 글자색 표시가 빨강이다',
    /231|e74c3c/.test(document.getElementById('tcBar').style.background));
  check('이전 상자에서 툴바 크기는 24 다', fsVal() === 24);

  window.addTextBox(0, 300, 400); await wait(200);
  const boxes = [...document.querySelectorAll('#pagesStage .tb')];
  const fresh = boxes[boxes.length - 1];
  check('새 텍스트 상자가 편집 모드로 생긴다', !!fresh && fresh.classList.contains('edit'));
  const freshEl = window.findEl(0, fresh.dataset.id);
  check('새 상자는 이전 글꼴을 물려받는다', freshEl.font === 'gaegu');
  check('새 상자는 이전 글자 크기를 물려받는다', freshEl.fontSize === 24);
  check('새 상자에는 굵게가 남지 않는다', !freshEl.fontWeight
    && !/font-weight/.test(fresh.querySelector('.tb-content').getAttribute('style') || ''));
  check('새 상자에는 밑줄이 남지 않는다', !freshEl.textDecoration
    && !/text-decoration/.test(fresh.querySelector('.tb-content').getAttribute('style') || ''));
  await wait(60);
  check('새 상자를 만들면 툴바 굵게가 꺼진다', !document.querySelector('.tb-bold').classList.contains('active'));
  check('새 상자를 만들면 툴바 밑줄이 꺼진다', !document.querySelector('.tb-under').classList.contains('active'));
  check('새 상자를 만들면 글자색 표시가 기본(파스텔 연회색)으로 풀린다',
    /rgb\(128, 128, 128\)|#808080/.test(document.getElementById('tcBar').style.background));
  check('새 상자를 만들면 형광펜 표시가 풀린다',
    /transparent|^$/.test(document.getElementById('hlBar').style.background));
  check('새 상자에서도 툴바 글꼴은 이전 글꼴(개구쟁이)이다', /개구쟁이|Gaegu/.test(fontLabel()));
  check('새 상자에서도 툴바 크기는 이전 크기(24)다', fsVal() === 24);
  // 새 상자에 실제로 글자를 넣으면 굵지 않다
  const cNew = fresh.querySelector('.tb-content');
  const rNew = document.createRange(); rNew.selectNodeContents(cNew); rNew.collapse(false);
  sel().removeAllRanges(); sel().addRange(rNew);
  window.saveSel();
  const target = (sel().rangeCount && sel().getRangeAt(0).startContainer.nodeType === 1)
    ? sel().getRangeAt(0).startContainer : cNew;
  target.appendChild(document.createTextNode('새글자'));
  cNew.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(200);
  check('새 상자에 적은 글자는 굵지 않다',
    !styledText(cNew, 'fontWeight', v => Number(v) >= 600 || v === 'bold').includes('새글자'));
  check('새 상자에 적은 글자에 밑줄이 없다',
    !styledText(cNew, 'textDecoration', v => /underline/.test(v)).includes('새글자'));
  check('새 상자에 적은 글자에 색이 남지 않는다',
    !styledText(cNew, 'color', v => /231|e74c3c/.test(v)).includes('새글자'));
  check('새 상자에 적은 글자에 형광펜이 남지 않는다',
    !styledText(cNew, 'backgroundColor', v => /255, 255, 0|ffff00/.test(v)).includes('새글자'));
  // 새 상자를 만든 뒤 서식 버튼을 눌러도 '이전 상자'가 바뀌지 않는다
  const oldHTMLBefore = cOld.innerHTML;
  pressToolbar('.tb-bold'); await wait(120);
  check('새 상자에서 누른 굵게가 이전 상자를 건드리지 않는다', cOld.innerHTML === oldHTMLBefore);

  check('치명적 런타임 오류가 없다', errors.length === 0);
  console.log(`\n글자 선택·툴바 동기화 UX: PASS ${pass}`);
} catch (e) {
  console.error('FAIL: ' + (e && e.stack || e));
  console.error('server log:\n' + log);
  throw e;
} finally {
  try { child.kill('SIGTERM'); } catch {}
  await closeDoms([dom]);
}
