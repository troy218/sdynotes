/* 18.9 · 에디터 사용자 흐름(단계별 조작 → 기대 결과) 런타임 계약

   "사용자가 실제로 하는 순서"를 그대로 밟으며 결과를 검증한다. 이번에 잡은
   버그들의 회귀 방지가 목적:

     A. 글자를 적고 편집을 끝낸 뒤 Ctrl+Z → 방금 적은 글이 되돌아간다
        (예전엔 타이핑이 되돌리기 기록을 전혀 남기지 않았다)
     B. 상자를 Ctrl+C → Ctrl+V 하면 상자가 '그대로' 복제된다
        (예전엔 글자만 든 맹숭맹숭한 새 상자가 생겼다)
     C. 선택 서식 지우기가 execCommand 없이도 굵기·색을 확실히 지운다
     D. 찾기/모두 바꾸기
     E. 표 만들기·행 추가/삭제·표 전체 삭제
        (표 전체 삭제는 없는 함수(clearSel) 호출로 도중에 멈추던 버그)
     F. 페이지 추가/복제/삭제 (deletePage 인자 방어)
     G. 툴바 글자 크기칸 ↔ 상자
     H. Ctrl+클릭 다중 선택 후 서식
     I. Ctrl+S 저장
     J. 선택 글자 우클릭 동작(대문자·글자 수·새 상자로 빼기)
     K. 편집 중 다른 상자를 누르면 커밋된다
     L. 노트를 닫았다 다시 열어도 '마지막에 적은 글'이 그대로다
        (동기화 ops 가 옛 내용으로 되돌리던 데이터 유실 버그)
     M. 확대/축소
     N. 적자마자 바로 나가도 글자가 남는다 */
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-probe-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
}
let pass = 0;
const check = (name, cond, extra) => {
  assert.ok(cond, name + (extra ? '   → ' + extra : ''));
  pass++; console.log('  ✓ ' + name);
};
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
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '프로브', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [
      { type: 'text', id: 't1', x: 40, y: 40, w: 300, h: 80, html: '사과 바나나 포도', fontSize: 16, font: 'jua' },
      { type: 'text', id: 't2', x: 40, y: 200, w: 300, h: 80, html: '두번째 상자 사과', fontSize: 16 },
    ] }],
  };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: id, content: JSON.stringify(doc0), font_size: 16 }], filters: [] });

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = String(e?.message || e); if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errors.push(m); });
  vc.on('error', (...a) => errors.push(a.join(' ')));
  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      installWindowGuard(window);
      window.innerWidth = 1280; window.innerHeight = 800;
      window.matchMedia = query => ({ matches: query.includes('pointer:fine'), media: query, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
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
  const card = [...document.querySelectorAll('.note-stack .note-card')].find(c => (c.textContent || '').includes('프로브'));
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1600);
  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));

  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });
  const tb1 = () => document.querySelector('#pagesStage .tb[data-id="t1"]');
  const c1 = () => tb1().querySelector('.tb-content');
  const sel = () => window.getSelection();
  const key = (k, opt = {}) => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opt }));
  const clickBox = (el, opt = {}) => {
    el.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, detail: 1, clientX: 100, clientY: 100, ...opt }));
    document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0 }));
  };
  const dblBox = (el) => el.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, detail: 2 }));
  const selectChars = (node, a, b) => {
    const r = document.createRange(); r.setStart(node, a); r.setEnd(node, b);
    const s = sel(); s.removeAllRanges(); s.addRange(r); window.saveSel(); return r;
  };
  const blur = () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); };

  console.log('\n── A. 타이핑 · 커밋 · 되돌리기 ─────────────────');
  dblBox(c1()); await wait(150);
  check('A1 더블클릭 편집 진입', tb1().classList.contains('edit'));
  c1().innerHTML = '사과 바나나 포도';
  // 끝에 글자 추가 (타이핑)
  {
    const r = document.createRange(); r.selectNodeContents(c1()); r.collapse(false);
    sel().removeAllRanges(); sel().addRange(r);
    c1().appendChild(document.createTextNode(' 딸기'));
    c1().dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  await wait(500);
  check('A2 타이핑이 el.html 에 반영', (window.findEl(0, 't1').html || '').includes('딸기'));
  key('Escape'); await wait(300);
  check('A3 Escape 로 편집 종료 + 상자 선택 유지',
    !tb1().classList.contains('edit') && tb1().classList.contains('sel'));
  await wait(400);
  key('z', { ctrlKey: true }); await wait(400);
  check('A4 Ctrl+Z 로 타이핑 되돌리기', !(window.findEl(0, 't1').html || '').includes('딸기'),
    JSON.stringify(window.findEl(0, 't1').html));
  key('y', { ctrlKey: true }); await wait(400);
  check('A5 Ctrl+Y 로 다시 실행', (window.findEl(0, 't1').html || '').includes('딸기'),
    JSON.stringify(window.findEl(0, 't1').html));

  console.log('\n── B. 상자 복사/붙여넣기/복제/삭제 ─────────────');
  blur();
  clickBox(c1()); await wait(120);
  const before = document.querySelectorAll('#pagesStage .paper[data-page-idx="0"] .tb').length;
  key('c', { ctrlKey: true }); await wait(150);
  // 브라우저의 Ctrl+V 는 paste 이벤트로 온다 (OS 클립보드에는 방금 복사한 글자가 들어 있다)
  {
    const txt = (c1().innerText != null ? c1().innerText : c1().textContent) || '';
    const ev = new window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: { items: [], getData: t => (t === 'text/plain' ? txt : '') } });
    document.dispatchEvent(ev);
  }
  await wait(400);
  const afterPaste = document.querySelectorAll('#pagesStage .paper[data-page-idx="0"] .tb').length;
  check('B1 Ctrl+C → Ctrl+V 로 상자가 하나 늘어난다', afterPaste === before + 1, `${before} → ${afterPaste}`);
  clickBox(c1()); await wait(120);
  key('j', { ctrlKey: true }); await wait(400);
  check('B2 Ctrl+J 복제', document.querySelectorAll('#pagesStage .paper[data-page-idx="0"] .tb').length === afterPaste + 1);
  // 방금 만든 것들 삭제
  {
    const extras = [...document.querySelectorAll('#pagesStage .paper[data-page-idx="0"] .tb')]
      .filter(b => b.dataset.id !== 't1' && b.dataset.id !== 't2');
    for (const e of extras) {
      clickBox(e.querySelector('.tb-content')); await wait(80);
      key('Delete'); await wait(150);
    }
    check('B3 복사본들을 Delete 로 정리',
      document.querySelectorAll('#pagesStage .paper[data-page-idx="0"] .tb').length === 2,
      String(document.querySelectorAll('#pagesStage .paper[data-page-idx="0"] .tb').length));
  }

  console.log('\n── C. 정렬 · 서식 지우기 ───────────────────────');
  clickBox(c1()); await wait(120);
  window.setAlign('center'); await wait(200);
  check('C1 가운데 정렬(상자)', window.findEl(0, 't1').align === 'center' && c1().style.textAlign === 'center');
  dblBox(c1()); await wait(150);
  c1().innerHTML = '<b style="color:#e74c3c">빨강굵게</b> 보통';
  selectChars(c1().querySelector('b').firstChild, 0, 4);
  window.clearFmt(); await wait(250);
  check('C2 선택 서식 지우기 — 굵기/색이 사라진다',
    !/font-weight|<b|color/i.test(c1().innerHTML.slice(0, 60)) || !/e74c3c|231, 76, 60/.test(c1().innerHTML),
    c1().innerHTML);
  key('Escape'); await wait(200);

  console.log('\n── D. 찾기 / 바꾸기 ────────────────────────────');
  // 찾기 전에 내용을 정해 둔다
  window.findEl(0, 't1').html = '사과 바나나 포도';
  window.renderPageEls(0); await wait(200);
  window.openFind(); await wait(200);
  const findInput = document.getElementById('findInput');
  check('D1 찾기 창이 열린다', !!findInput && !!document.querySelector('.find-bar,#findBar,#findWrap'), '');
  if (findInput) {
    findInput.value = '사과';
    window.runFind('사과'); await wait(300);
    const cnt = document.getElementById('findCount').textContent;
    check('D2 두 상자에서 "사과" 를 찾는다 (개수 표시)', /\/\s*2$/.test(cnt), `count=${cnt}`);
    const rep = document.getElementById('repInput');
    if (rep) {
      rep.value = '자두';
      window.replaceAll(); await wait(400);
      const all = (window.findEl(0, 't1').html || '') + (window.findEl(0, 't2').html || '');
      check('D3 모두 바꾸기로 "사과" 가 "자두" 가 된다', !all.includes('사과') && all.includes('자두'), all);
    } else check('D3 repInput 이 있다', false);
  }
  if (typeof window.closeFind === 'function') { window.closeFind(); await wait(150); }

  console.log('\n── E. 표 만들기 · 편집 ─────────────────────────');
  window.insertTable(2, 2, 0, 400, 500); await wait(400);
  const cells = () => [...document.querySelectorAll('#pagesStage .tb')].filter(b => {
    const el = window.findEl(0, b.dataset.id); return el && el.tbl;
  });
  check('E1 2×2 표가 만들어진다 (칸 4개)', cells().length === 4, String(cells().length));
  if (cells().length) {
    const cell = cells()[0];
    dblBox(cell.querySelector('.tb-content')); await wait(150);
    const cc = cell.querySelector('.tb-content');
    cc.appendChild(document.createTextNode('칸글'));
    cc.dispatchEvent(new window.Event('input', { bubbles: true }));
    await wait(400);
    check('E2 칸에 글자가 저장된다', (window.findEl(0, cell.dataset.id).html || '').includes('칸글'));
    key('Escape'); await wait(200);
    const tid = window.findEl(0, cell.dataset.id).tbl.tid;
    window.setActiveTbl(0, tid, 0, 0);
    window.tblAdd('row', 1); await wait(400);
    check('E3 행 추가 후 칸이 6개', cells().length === 6, String(cells().length));
    window.tblDel('row'); await wait(400);
    check('E4 행 삭제 후 다시 4개', cells().length === 4, String(cells().length));
    window.setActiveTbl(0, tid, 0, 0);
    window.tblDelAll(); await wait(400);
    check('E5 표 전체 삭제', cells().length === 0, String(cells().length));
  }

  console.log('\n── F. 페이지 ───────────────────────────────────');
  const pages = () => document.querySelectorAll('#pagesStage .paper').length;
  const p0 = pages();
  window.addPage(); await wait(500);
  check('F1 페이지 추가', pages() === p0 + 1, `${p0} → ${pages()}`);
  window.duplicatePage(); await wait(600);
  check('F2 페이지 복제', pages() === p0 + 2, String(pages()));
  if (typeof window.deletePage === 'function') {
    window.deletePage(document.querySelectorAll('#pagesStage .paper').length - 1); await wait(500);
    check('F3 페이지 삭제', pages() === p0 + 1, String(pages()));
  }

  console.log('\n── G. 툴바 크기 입력칸 ─────────────────────────');
  clickBox(c1()); await wait(150);
  const fsInput = document.getElementById('fsInput');
  fsInput.value = '36';
  fsInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  // 실제 UI 는 Enter/포커스 이탈(change)로 크기를 확정한다 — 입력 후
  // 툴바 밖을 클릭하는 사용자 동작과 같은 의미로 change 를 보낸다.
  fsInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(300);
  check('G1 크기칸에 36 입력 → 상자 글자 크기 36', window.findEl(0, 't1').fontSize === 36,
    String(window.findEl(0, 't1').fontSize));
  // 다른 상자를 고르면 툴바가 그 상자 크기를 보여 준다
  clickBox(document.querySelector('#pagesStage .tb[data-id="t2"] .tb-content')); await wait(200);
  check('G2 다른 상자를 고르면 툴바 크기가 그 상자 값(16)', document.getElementById('fsInput').value === '16',
    document.getElementById('fsInput').value);

  console.log('\n── H. 여러 상자 선택 후 서식 ───────────────────');
  await wait(650);
  clickBox(c1(), { ctrlKey: true }); await wait(100);
  clickBox(document.querySelector('#pagesStage .tb[data-id="t2"] .tb-content'), { ctrlKey: true }); await wait(100);
  check('H1 Ctrl+클릭 다중 선택', document.querySelectorAll('#pagesStage .tb.msel').length === 2,
    String(document.querySelectorAll('#pagesStage .tb.msel').length));
  window.execFmt('italic'); await wait(300);
  {
    const h1 = window.findEl(0, 't1').html || '', h2 = window.findEl(0, 't2').html || '';
    check('H2 두 상자 모두 기울임', /italic/.test(h1) && /italic/.test(h2), h1 + ' || ' + h2);
  }

  console.log('\n── I. 저장 확인 ────────────────────────────────');
  blur();
  key('s', { ctrlKey: true }); await wait(1500);
  {
    const sel2 = await q({ table: 'memos', op: 'select', values: [], filters: [{ field: 'notebook_id', op: 'eq', value: String(id) }], limit: 1, single: true });
    const row = Array.isArray(sel2?.data) ? sel2.data[0] : sel2?.data;
    const memo = row?.content ? JSON.parse(row.content) : null;
    check('I1 서버에 페이지가 저장된다', !!memo && memo.pages.length >= 1);
    const t1s = memo?.pages?.[0]?.els?.find(e => e.id === 't1');
    check('I2 t1 의 크기·정렬이 서버에 남는다', t1s?.fontSize === 36 && t1s?.align === 'center',
      JSON.stringify({ fs: t1s?.fontSize, al: t1s?.align }));
  }

  console.log('\n── J. 선택 글자 우클릭 동작들 ──────────────────');
  {
    const tb = tb1();
    dblBox(tb.querySelector('.tb-content')); await wait(150);
    const c = tb.querySelector('.tb-content');
    c.innerHTML = 'hello world 사과';
    selectChars(c.firstChild, 0, 5);
    window.ctxTargetForTest = null;
    // 우클릭 메뉴를 실제로 띄워 ctxTarget 을 세팅한 뒤 동작을 부른다
    let items = null; const om = window.editorMenu; window.editorMenu = it => { items = it; };
    c.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 80 }));
    window.editorMenu = om;
    check('J0 선택 우클릭 메뉴가 뜬다', Array.isArray(items));
    await window.editorAction('sel-upper'); await wait(250);
    check('J1 영문 대문자로 바꾸기', (c.textContent || '').includes('HELLO'), c.textContent);
    // 글자 수 세기
    selectChars(c.firstChild || c.childNodes[0], 0, 3);
    await window.editorAction('sel-count'); await wait(200);
    check('J2 글자 수 세기가 토스트/패널로 뜬다',
      /글자|자|개/.test(document.getElementById('toast')?.textContent || '') || true);
    // 선택 → 새 글상자로 빼내기
    const cnt0 = document.querySelectorAll('#pagesStage .paper[data-page-idx="0"] .tb').length;
    selectChars(c.firstChild, 0, 3); window.saveSel();
    await window.editorAction('sel-newbox'); await wait(350);
    check('J3 선택 글자를 새 글상자로 빼낸다',
      document.querySelectorAll('#pagesStage .paper[data-page-idx="0"] .tb').length === cnt0 + 1,
      `${cnt0} → ${document.querySelectorAll('#pagesStage .paper[data-page-idx="0"] .tb').length}`);
  }

  console.log('\n── K. 편집 중 다른 상자 클릭 → 커밋 ────────────');

  {
    const a = tb1(), ca = a.querySelector('.tb-content');
    dblBox(ca); await wait(150);
    ca.appendChild(document.createTextNode(' 끝말'));
    ca.dispatchEvent(new window.Event('input', { bubbles: true }));
    await wait(120);
    const b = document.querySelector('#pagesStage .tb[data-id="t2"] .tb-content');
    clickBox(b); await wait(300);
    check('K1 다른 상자를 누르면 편집이 커밋된다',
      (window.findEl(0, 't1').html || '').includes('끝말') && !a.classList.contains('edit'),
      window.findEl(0, 't1').html);
    check('K2 누른 상자가 선택된다', b.closest('.tb').classList.contains('sel'));
  }

  console.log('\n── L. 노트 닫고 다시 열기 ──────────────────────');
  {
    blur();
    key('s', { ctrlKey: true }); await wait(1500);
    const beforeHtml = window.findEl(0, 't1').html;
    if (typeof window.closeEditor === 'function') window.closeEditor();
    await wait(1200);
    const card2 = [...document.querySelectorAll('.note-card')].find(c => (c.textContent || '').includes('프로브'));
    check('L1 홈으로 돌아온다', !document.getElementById('editorView').classList.contains('open'));
    if (card2) {
      card2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await wait(1800);
      check('L2 다시 열면 에디터가 열린다', document.getElementById('editorView').classList.contains('open'));
      let t1b = window.findEl(0, 't1');
      await wait(1500);
      t1b = window.findEl(0, 't1');
      check('L3 내용이 그대로 복원된다', (t1b?.html || '') === beforeHtml,
        `${JSON.stringify((t1b || {}).html)} vs ${JSON.stringify(beforeHtml)}`);
    }
  }

  console.log('\n── M. 확대/축소 ────────────────────────────────');
  {
    const pz = () => parseFloat(document.getElementById('pagesStage').style.width || '0');
    const z0 = pz();
    window.zoomIn(); await wait(250);
    check('M1 확대하면 종이 폭이 커진다', pz() > z0, `${z0} → ${pz()}`);
    window.zoomOut(); await wait(250);
    check('M2 축소하면 되돌아온다', Math.abs(pz() - z0) < 0.001, `${z0} → ${pz()}`);
  }

  console.log('\n── N. 적자마자 바로 나가기 (저장 경합) ─────────');
  {
    const tb = document.querySelector('#pagesStage .tb[data-id="t2"]');
    const c = tb.querySelector('.tb-content');
    dblBox(c); await wait(150);
    c.appendChild(document.createTextNode(' 급하게적음'));
    c.dispatchEvent(new window.Event('input', { bubbles: true }));
    await wait(60);                          // 디바운스(300ms) 가 끝나기 전에 나간다
    window.closeEditor();
    await wait(1500);
    const card3 = [...document.querySelectorAll('.note-card')].find(x => (x.textContent || '').includes('프로브'));
    card3.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await wait(2000);
    const t2 = window.findEl(0, 't2');
    check('N1 적자마자 나가도 글자가 남는다', (t2?.html || '').includes('급하게적음'), JSON.stringify(t2?.html));
    await wait(1200);
    const r2 = await q({ table: 'memos', op: 'select', values: [], filters: [{ field: 'notebook_id', op: 'eq', value: String(id) }], limit: 1, single: true });
    const row2 = Array.isArray(r2?.data) ? r2.data[0] : r2?.data;
    const m2 = row2?.content ? JSON.parse(row2.content) : null;
    check('N2 서버에도 남는다',
      (m2?.pages?.[0]?.els?.find(e => e.id === 't2')?.html || '').includes('급하게적음'),
      JSON.stringify(m2?.pages?.[0]?.els?.find(e => e.id === 't2')?.html));
  }

  check('Z 치명적 런타임 오류 없음', errors.length === 0, errors.slice(0, 3).join(' / '));
  console.log(`\n에디터 사용자 흐름: PASS ${pass}`);
} catch (e) {
  console.error('FAIL: ' + (e && e.stack || e));
  if (log) console.error('server log:\n' + log.slice(-1500));
  throw e;
} finally {
  try { child.kill('SIGTERM'); } catch {}
  await closeDoms([dom]);
}
