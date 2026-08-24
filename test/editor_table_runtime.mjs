/* 표 배치/셀 범위/원자 이동의 실제 DOM 런타임 검증 */
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import jsdom from 'jsdom';
const { JSDOM, VirtualConsole } = jsdom;

const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };
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
  const ins = await q({ table: 'notebooks', op: 'insert', values: [{ title: '표 런타임', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const seedDoc = { version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {}, pages: [{ id: 'p1', els: [] }] };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: ins.data.id, content: JSON.stringify(seedDoc), font_size: 16 }], filters: [] });

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
      window.innerWidth = 1280; window.innerHeight = 800;
      window.matchMedia = query => ({ matches: query.includes('pointer:fine'), media: query,
        addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.BroadcastChannel = class { postMessage(){} close(){} addEventListener(){} };
      window.EventSource = class { close(){} addEventListener(){} };
      window.requestIdleCallback = cb => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
      window.cancelIdleCallback = clearTimeout;
      window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
      window.cancelAnimationFrame = clearTimeout;
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function(){};
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
  while (Date.now() - boot < 8_000 && !document.querySelector('.note-stack .note-card')) await wait(60);
  document.querySelector('.note-stack .note-card').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1100);
  check('표 런타임용 노트가 열린다', document.getElementById('editorView').classList.contains('open'));
  check('표 API가 전역 UI 함수로 준비된다', typeof window.insertTable === 'function' && typeof window.tblCellAlign === 'function');

  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });
  window.insertTable(2, 3, 0, 100, 120);
  await wait(120);
  check('2×3 표가 칸 6개와 하나의 조절틀로 렌더된다',
    paper.querySelectorAll('.tb.in-tbl').length === 6 && paper.querySelectorAll('.tbl-box').length === 1);

  const cells = [...paper.querySelectorAll('.tb.in-tbl')].sort((a, b) =>
    (parseFloat(a.style.top) - parseFloat(b.style.top)) || (parseFloat(a.style.left) - parseFloat(b.style.left)));
  const firstContent = cells[0].querySelector('.tb-content');
  firstContent.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1, clientX: 110, clientY: 130 }));
  document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: 460, clientY: 180 }));
  document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 460, clientY: 180 }));
  check('대각선 드래그로 2×3 직사각형 셀 범위를 선택한다', paper.querySelectorAll('.tb.tbl-cell-sel').length === 6);

  window.tblCellAlign('right');
  await wait(100);
  check('선택한 셀 범위 전체에 오른쪽 정렬이 적용된다',
    [...paper.querySelectorAll('.tb.in-tbl .tb-content')].every(n => n.style.textAlign === 'right'));
  window.tblCellVAlign('bottom');
  await wait(100);
  check('선택한 셀 범위 전체에 세로 아래 정렬이 적용된다',
    [...paper.querySelectorAll('.tb.in-tbl .tb-content')].every(n => n.style.justifyContent === 'flex-end'));

  const move = paper.querySelector('.tbl-move');
  move.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100, clientY: 120 }));
  document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: 180, clientY: 170 }));
  const previewCells = [...paper.querySelectorAll('.tb.in-tbl')];
  const previewStrokes = [...paper.querySelectorAll('.stroke-g')];
  check('이동 중 칸과 모든 테두리가 동일한 80×50 미리보기 변환을 쓴다',
    previewCells.every(n => n.style.transform === 'translate(80px,50px)')
    && previewStrokes.length > 0 && previewStrokes.every(n => n.getAttribute('transform') === 'translate(80,50)'));
  document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 180, clientY: 170 }));
  await wait(120);
  const moved = [...paper.querySelectorAll('.tb.in-tbl')].sort((a, b) =>
    (parseFloat(a.style.top) - parseFloat(b.style.top)) || (parseFloat(a.style.left) - parseFloat(b.style.left)));
  check('이동 완료 뒤에도 칸과 테두리를 canonical 표로 함께 재구성한다',
    parseFloat(moved[0].style.left) === 183 && parseFloat(moved[0].style.top) === 173
    && paper.querySelectorAll('.stroke-g').length === 7);

  window.prompt = () => '2 x 2';
  window.openTableModal();
  check('표 버튼은 즉시 삽입하지 않고 크기 고스트 배치를 시작한다',
    document.getElementById('tableGhost').style.display === 'block' && document.body.classList.contains('placing-table'));
  paper.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1, clientX: 600, clientY: 600 }));
  await wait(120);
  check('종이를 누른 위치에 새 2×2 표를 배치하고 모드를 끝낸다',
    paper.querySelectorAll('.tb.in-tbl').length === 10
    && document.getElementById('tableGhost').style.display === 'none'
    && !document.body.classList.contains('placing-table'));

  const newestCell=[...paper.querySelectorAll('.tb.in-tbl')]
    .sort((a,b)=>parseFloat(b.style.left)-parseFloat(a.style.left))[0];
  newestCell.querySelector('.tb-content').dispatchEvent(new window.MouseEvent('mousedown',
    {bubbles:true,button:0,detail:1,clientX:605,clientY:605}));
  document.dispatchEvent(new window.KeyboardEvent('keydown',{bubbles:true,key:'Delete'}));
  await wait(120);
  check('셀을 고른 뒤 Delete를 누르면 표 안쪽과 거터가 함께 완전히 사라진다',
    paper.querySelectorAll('.tb.in-tbl').length===6 && paper.querySelectorAll('.tbl-box').length===1);

  const fatal = errors.filter(Boolean);
  check('표 배치·선택·정렬·이동 중 치명적 런타임 오류가 없다', fatal.length === 0);
  if (fatal.length) console.log(fatal.slice(0, 5).join('\n---\n'));
  console.log(`\n에디터 표 런타임: PASS ${pass} / FAIL 0`);
} catch (e) {
  console.error('\n에디터 표 런타임 실패:', e);
  if (log) console.error('\nserver log:\n' + log.slice(-2500));
  process.exitCode = 1;
} finally {
  if (dom) dom.window.close();
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
