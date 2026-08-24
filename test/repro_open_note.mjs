/* Repro: 노트 카드를 눌렀는데 편집기로 안 넘어가는 버그 재현 */
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import jsdom from 'jsdom';
const { JSDOM, VirtualConsole } = jsdom;

const pass = [];
const check = (name, cond) => { assert.ok(cond, name); pass.push(name); console.log('  ✓ ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));

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
child.stdout.on('data', b => log += b);
child.stderr.on('data', b => log += b);

let dom;
try {
  const until = Date.now() + 12000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died: ' + log);
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }

  const runtimeErrors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String(e?.message || e);
    if (!/HTMLMediaElement|Could not load (?:link|script)/.test(m)) runtimeErrors.push(m + '\n' + (e.detail?.stack || ''));
  });
  vc.on('error', (...a) => runtimeErrors.push(a.join(' ')));

  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.innerWidth = 1280; window.innerHeight = 800;
      window.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.BroadcastChannel = class { postMessage(){} close(){} addEventListener(){} };
      window.EventSource = class { constructor(){ throw new Error('no SSE in test'); } close(){} addEventListener(){} };
      window.requestIdleCallback = cb => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
      window.cancelIdleCallback = clearTimeout;
      window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
      window.cancelAnimationFrame = clearTimeout;
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function(){};
      window.HTMLCanvasElement.prototype.getContext = () => ({
        clearRect(){}, drawImage(){}, fillRect(){}, beginPath(){}, moveTo(){}, lineTo(){},
        stroke(){}, arc(){}, fill(){}, save(){}, restore(){}, scale(){}, translate(){}, setTransform(){},
        measureText(){return {width:10}}, getImageData(){return {data:new Uint8ClampedArray(4)}}, putImageData(){}
      });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class { constructor(){this.paused=true;} play(){return Promise.resolve()} pause(){} addEventListener(){} removeEventListener(){} };
      window.URL.createObjectURL = () => 'blob:test';
      window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      // jsdom has no fetch; route to Node's global fetch against the test server
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL
          ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
      window.addEventListener('error', e => runtimeErrors.push(e.error?.stack || e.message));
      window.addEventListener('unhandledrejection', e => runtimeErrors.push('unhandled: ' + (e.reason?.stack || e.reason)));
    }
  });

  const { window } = dom; const { document } = window;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000 && (typeof window.openSettings !== 'function' || !document.querySelector('.add-card'))) await wait(50);
  await wait(500);

  console.log('sandbox?', window.SANDBOX, 'SB?', !!window.SB);
  // 샌드박스 모드에서는 SB 가 null 이라 로컬 노트로 만들어진다. 노트를 하나 만든다.
  window.createNB('a4_portrait');
  await wait(500);
  const card = document.querySelector('#noteGrid .note-card');
  check('노트 카드가 렌더된다', !!card);
  console.log('card count:', document.querySelectorAll('#noteGrid .note-card').length);

  // 카드를 클릭한다
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(1500);

  const ed = document.getElementById('editorView');
  console.log('editor classes:', ed.className);
  check('에디터가 .open 을 받는다', ed.classList.contains('open'));

  const fatal = runtimeErrors.filter(Boolean);
  check('치명적 JS 오류 없음', fatal.length === 0);
  if (fatal.length) console.log('ERRORS:\n' + fatal.slice(0, 5).join('\n---\n'));

  console.log(`\nPASS ${pass.length}`);
} catch (e) {
  console.error('REPRO FAILED:', e);
  if (log) console.error('server log tail:\n' + log.slice(-2000));
  process.exitCode = 1;
} finally {
  if (dom) dom.window.close();
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
