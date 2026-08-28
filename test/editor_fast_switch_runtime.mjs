/* 에디터 빠른 연속 노트 전환 런타임 검증

   사용자가 노트 A 를 누르자마자 B 를 누르는 것처럼 '두 열기가 겹치는' 상황을
   실제 DOM 으로 재현한다. 14.15 전에는 뒤늦게 끝난 이전 openNB 가
   - 새 노트의 제목/문서를 이전 노트 것으로 덮거나
   - 이전 노트의 memo 를 새 노트에 applyServerState 로 끼워 넣는
   데이터 섞임이 생길 수 있었다. 여기서는 B 가 최종적으로 열리고, A 의 서버
   메모가 그대로 남는지 검증한다. */
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
  const insA = await q({ table: 'notebooks', op: 'insert', values: [{ title: '빠른 전환 A', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const insB = await q({ table: 'notebooks', op: 'insert', values: [{ title: '빠른 전환 B', color: '#e74c3c' }], filters: [], returning: true, single: true });
  const idA = insA.data.id, idB = insB.data.id;

  const docA = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'pa1', els: [{ type: 'text', id: 'taA', x: 20, y: 20, w: 180, h: 48, html: '<b>A 내용</b>', fontSize: 16 }] }],
  };
  const docB = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'pb1', els: [{ type: 'text', id: 'tbB', x: 30, y: 30, w: 180, h: 48, html: '<b>B 내용</b>', fontSize: 16 }] }],
  };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: idA, content: JSON.stringify(docA), font_size: 16 }], filters: [] });
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: idB, content: JSON.stringify(docB), font_size: 16 }], filters: [] });

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
  while (Date.now() - boot < 8_000 && document.querySelectorAll('.note-stack .note-card').length < 2) await wait(60);

  const cards = [...document.querySelectorAll('.note-stack .note-card')];
  check('두 노트가 홈에 보인다', cards.length >= 2);
  const cardA = cards.find(c => (c.dataset.nbId || '').includes(String(idA))) ||
                cards.find(c => (c.textContent || '').includes('빠른 전환 A'));
  const cardB = cards.find(c => (c.dataset.nbId || '').includes(String(idB))) ||
                cards.find(c => (c.textContent || '').includes('빠른 전환 B'));
  check('A/B 카드를 찾는다', !!cardA && !!cardB);

  // 14.15 · 연속 클릭: A 누르자마자 B 를 누른다 (A 의 첫 번째 await 가 끝나기 전).
  cardA.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  cardB.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1800);

  const eOpen = document.getElementById('editorView').classList.contains('open');
  check('빠른 연속 전환에서 마지막으로 연 B 가 열린다', eOpen);
  check('제목줄은 B 노트다', document.getElementById('edTitle').value === '빠른 전환 B');
  // jsdom 은 innerText 를 계산하지 않으므로 textContent 로 검증한다.
  const text = (document.querySelectorAll('#pagesStage .tb-content')[0]?.textContent || '').trim();
  check('열린 본문은 B 내용이다', text.includes('B 내용'));
  check('A 내용이 B 화면에 섞이지 않았다', !text.includes('A 내용'));

  // 서버(메모)에도 A 는 원본 그대로 남아 있어야 한다.
  const selA = await q({ table: 'memos', op: 'select', values: [], filters: [{ field: 'notebook_id', op: 'eq', value: String(idA) }], limit: 1, single: true });
  const rowA = Array.isArray(selA?.data) ? selA.data[0] : selA?.data;
  const memoA = rowA?.content ? JSON.parse(rowA.content) : null;
  check('A 의 서버 본문이 그대로 남는다', !!memoA && JSON.stringify(memoA).includes('A 내용'));
  const selB = await q({ table: 'memos', op: 'select', values: [], filters: [{ field: 'notebook_id', op: 'eq', value: String(idB) }], limit: 1, single: true });
  const rowB = Array.isArray(selB?.data) ? selB.data[0] : selB?.data;
  const memoB = rowB?.content ? JSON.parse(rowB.content) : null;
  check('B 의 서버 본문은 B 내용이다', !!memoB && JSON.stringify(memoB).includes('B 내용'));

  const fatal = errors.filter(Boolean);
  check('빠른 전환 중 치명적 런타임 오류가 없다', fatal.length === 0);
  if (fatal.length) console.log(fatal.slice(0, 5).join('\n---\n'));
  console.log(`\n에디터 빠른 전환: PASS ${pass} / FAIL 0`);
} catch (e) {
  console.error('\n에디터 빠른 전환 실패:', e);
  if (log) console.error('\nserver log:\n' + log.slice(-2500));
  process.exitCode = 1;
} finally {
  await wait(80);
  if (dom) dom.window.close();
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
