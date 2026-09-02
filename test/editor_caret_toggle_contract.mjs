/* 18.7 · 캐럿(입력 중) 서식 토글/툴바 상태/우클릭 메뉴 런타임 계약

   사용자 보고:
    ① 캐럿에서 스타일을 '꺼도' 이후 입력되는 글자가 그 스타일로 계속 입력됨.
    ⑥ 텍스트를 선택하지 않은 화면에서도 볼드 등이 '켜진 것처럼' 남아 있음.
    ⑦ 우클릭 메뉴의 '내용 편집' 제거 + 텍스트 선택 우클릭에 '서식제거' 노출.
   추가로 (②③) 굵게/형광펜/부분글꼴이 섞인 글자에도 글꼴 변경이 적용되고,
     캐럿에서 글꼴을 바꾼 뒤 입력하면 새 글꼴로 입력되는지도 회귀 막는다. */
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-caret-'));
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
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '캐럿토글', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [{ type: 'text', id: 't1', x: 40, y: 40, w: 260, h: 70, html: '안녕하세요 반갑습니다', fontSize: 16, font: 'jua' }] }],
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
  const card = [...document.querySelectorAll('.note-stack .note-card')].find(c => (c.textContent || '').includes('캐럿토글'));
  check('노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1600);
  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));

  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });
  const tb = document.querySelector('#pagesStage .tb');
  const content = tb.querySelector('.tb-content');
  const sel = () => window.getSelection();
  const textInStyle = (root, test) => {
    const s = [];
    const tw = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      let p = n.parentElement, hit = false;
      while (p && p !== root) { if (test(p)) { hit = true; break; } p = p.parentElement; }
      if (hit) s.push(n.nodeValue);
    }
    return s.join('');
  };
  // '가장 가까운' fontWeight 를 기준으로 볼드 여부를 판정한다 (중첩 span 중간에
  // font-weight:400 이 있으면 볼드로 치지 않는다 — 실제 화면 렌더링과 동일).
  const textBold = (root) => {
    const s = [];
    const tw = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      let p = n.parentElement, nearest = '';
      while (p && p !== root) {
        if ((p.tagName === 'B' || p.tagName === 'STRONG') && !p.style.fontWeight) { nearest = '700'; break; }
        const v = p.style && p.style.fontWeight;
        if (v) { nearest = v; break; }
        p = p.parentElement;
      }
      const nv = parseInt(nearest, 10);
      const isBold = nearest && (nearest === 'bold' || nearest === 'bolder' || (!isNaN(nv) && nv >= 600));
      if (isBold) s.push(n.nodeValue);
    }
    return s.join('');
  };
  const caretAt = node => {
    const r = document.createRange(); r.setStart(node, node.nodeValue.length); r.collapse(true);
    const s = sel(); s.removeAllRanges(); s.addRange(r); window.saveSel();
  };

  // ── ① 캐럿 볼드 ON → 입력 → OFF → 이후 입력은 볼드가 아니다 ─────────────
  content.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, detail: 2 }));
  await wait(200);
  check('더블클릭으로 편집 모드 진입', tb.classList.contains('edit'));
  content.innerHTML = '안녕하세요 반갑습니다';
  caretAt(content.firstChild);
  window.execFmt('bold'); await wait(80);
  const spBold = content.querySelector('span.sdy-type');
  check('볼드 ON 시 캐럿 볼드 span 이 생긴다', !!spBold && /font-weight/.test(spBold.getAttribute('style') || ''));
  // '안' 두 글자를 캐럿 span(볼드) 안에 입력
  spBold.appendChild(document.createTextNode('안'));
  content.dispatchEvent(new window.Event('input', { bubbles: true })); await wait(400);
  check('볼드 span 안 입력 글자는 볼드', textBold(content).includes('안'));

  // 캐럿을 그 span 안 끝에 두고 볼드 OFF
  const rBold = document.createRange(); rBold.selectNodeContents(spBold); rBold.collapse(false);
  sel().removeAllRanges(); sel().addRange(rBold); window.saveSel();
  window.execFmt('bold'); await wait(80);
  const spanAfter = content.querySelector('span.sdy-type');
  // 캐럿 span 중 '가장 안쪽/마지막' 이 중립(400)으로 바뀌거나 없어져서 이후 입력이 무볼드.
  const neutralSpan = [...content.querySelectorAll('span.sdy-type')]
    .find(s => /font-weight:\s*400/.test(s.getAttribute('style') || ''));
  check('볼드 OFF 하면 캐럿에서 볼드가 중립(400)으로 바뀐다', !!neutralSpan);
  // 실제로 '중립 span' 쪽에 이후 글자를 입력하면 볼드가 아니어야 한다.
  let typeTarget = neutralSpan || document.createTextNode('');
  typeTarget.appendChild(document.createTextNode('나'));
  content.dispatchEvent(new window.Event('input', { bubbles: true })); await wait(400);
  const boldAfter = textBold(content);
  check('볼드 OFF 후 입력한 글자는 볼드가 아니다', !boldAfter.includes('나'));

  // ── ② 굵게+형광펜 와중에 글꼴 변경 → 글꼴 유지(회귀) ────────────────────
  content.innerHTML = '안녕하세요 반갑습니다';
  const tn = content.firstChild;
  const rS = document.createRange(); rS.setStart(tn, 0); rS.setEnd(tn, 5);
  sel().removeAllRanges(); sel().addRange(rS); window.saveSel();
  window.execFmt('bold'); await wait(60);
  window.applyHighlight('#ffff00'); await wait(60);
  // 같은(저장된) 선택을 그대로 이용해 글꼴 변경
  window.applyFont('gaegu'); await wait(100);
  check('굵게+형광펜 입힌 글자에 글꼴이 적용된다',
    textInStyle(content, p => (p.style.fontFamily || '').includes('Gaegu')).includes('안녕하세요'));
  // 상자 글꼴(Jua)은 유지
  check('부분 글꼴 적용 후에도 상자 글꼴(Jua)이 남는다', (content.style.fontFamily || '').indexOf('Jua') >= 0);

  // ── ③ 캐럿에서 글꼴 변경 후 입력 → 새 글꼴(회귀) ─────────────────────────
  content.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, detail: 2 })); await wait(80);
  content.innerHTML = '안녕하세요 반갑습니다';
  caretAt(content.firstChild);
  window.applyFont('pretendard'); await wait(100);
  const spFont = content.querySelector('span.sdy-type');
  check('캐럿에 새 글꼴 span 이 생긴다', !!spFont && /Pretendard/.test(spFont.getAttribute('style') || ''));
  if (spFont) spFont.appendChild(document.createTextNode('새글'));
  content.dispatchEvent(new window.Event('input', { bubbles: true })); await wait(400);
  check('캐럿에서 글꼴 바꾸고 입력하면 새 글꼴로 입력된다',
    textInStyle(content, p => /Pretendard/.test(p.style.fontFamily || '')).includes('새글'));

  // ── ⑥ 텍스트 선택이 없으면 툴바 토글이 꺼진다 ─────────────────────────────
  // 편집 모드에서 빠져나와 '상자 선택' 상태로 만든다.
  if (typeof window.exitEditKeepSel === 'function') window.exitEditKeepSel(tb);
  else { tb.classList.remove('edit'); tb.classList.add('sel'); content.contentEditable = 'false'; }
  window.clearTextSelection();
  await wait(80);
  window.syncCurSel();
  check('텍스트 선택이 없으면 볼드 버튼이 꺼진다', !document.querySelector('.tb-bold').classList.contains('active'));
  check('텍스트 선택이 없으면 취소선 버튼이 꺼진다', !document.querySelector('.tb-strike').classList.contains('active'));

  // ── ⑦ 우클릭: '내용 편집' 제거 + 텍스트 선택 시 '서식제거' 노출 ───────────
  // 요소(텍스트 상자) 우클릭
  const elementMenuText = (() => {
    // onEditorContext 는 doc·paper 가 필요하다. 요소 위에서 실행해 본다.
    let items = null;
    const orig = window.editorMenu;
    window.editorMenu = (it) => { items = it; };
    try {
      const ev = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 });
      const t = tb.querySelector('.tb-content') || tb;
      t.dispatchEvent(ev);
    } catch (e) { errors.push('ctx-elem: ' + (e && e.message)); }
    window.editorMenu = orig;
    return items;
  })();
  check('요소 우클릭 메뉴가 뜬다', Array.isArray(elementMenuText));
  if (Array.isArray(elementMenuText)) {
    const flat = [];
    const walk = arr => arr.forEach(it => { if (it && it.a) flat.push(it); else if (it && it.items) walk(it.items); });
    walk(elementMenuText);
    check("우클릭 메뉴에 내용 편집 버튼이 없다", !flat.some(it => it.a === 'el-edit'));
    check("우클릭 메뉴에 이 상자 서식 지우기는 남는다", flat.some(it => it.a === 'el-clearfmt'));
  }

  // 텍스트 선택 후 우클릭 → '서식제거' 노출
  content.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, detail: 2 })); await wait(100);
  content.innerHTML = '안녕하세요 반갑습니다';
  const tnT = content.firstChild;
  const rT = document.createRange(); rT.setStart(tnT, 0); rT.setEnd(tnT, 5);
  sel().removeAllRanges(); sel().addRange(rT); window.saveSel();
  let textItems = null;
  const orig2 = window.editorMenu;
  window.editorMenu = (it) => { textItems = it; };
  try {
    const ev = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 });
    (content.querySelector('.tb-content') || content).dispatchEvent(ev);
  } catch (e) { errors.push('ctx-text: ' + (e && e.message)); }
  window.editorMenu = orig2;
  const flatT = [];
  const walkT = arr => arr.forEach(it => { if (it && it.a) flatT.push(it); else if (it && it.items) walkT(it.items); });
  walkT(textItems || []);
  check("텍스트 선택 우클릭 메뉴에 서식제거가 노출된다", flatT.some(it => it.a === 'clear' && /서식제거/.test(it.t)));

  check('치명적 런타임 오류가 없다', errors.length === 0);

  console.log(`\n캐럿 토글/툴바/우클릭: PASS ${pass}`);
} catch (e) {
  console.error('FAIL: ' + (e && e.stack || e));
  throw e;
} finally {
  try { child.kill('SIGTERM'); } catch {}
  await closeDoms([dom]);
}
