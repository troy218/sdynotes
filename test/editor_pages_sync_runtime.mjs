/* 두 클라이언트가 같은 노트를 열어 둔 채, 한 쪽에서 새 페이지를 추가하면
   다른 쪽 화면에도 즉시 페이지가 생기는지 검증한다.

   회귀: 서버 /api/sync/pull 은 페이지 목록을 별도 필드(pages)로 주는데
   클라이언트 pullSync 는 ops 만 봐서, 늦게/실시간 pull 한 쪽은 추가·삭제된
   페이지를 못 받았다. 14.15 는 이 pages 필드를 __pages__ op으로 합성해 적용한다. */
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
let domA = null, domB = null;
try {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died');
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }

  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const ins = await q({ table: 'notebooks', op: 'insert', values: [{ title: '페이지 동기화', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const nid = ins.data.id;
  const seedDoc = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [] }],
  };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: nid, content: JSON.stringify(seedDoc), font_size: 16 }], filters: [] });

  const common = () => ({
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true,
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
    },
  });

  async function boot() {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => {
      const m = String(e?.message || e);
      if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errors.push(m);
    });
    vc.on('error', (...a) => errors.push(a.join(' ')));
    const d = await JSDOM.fromURL(base + '/', { ...common(), virtualConsole: vc });
    d.window.addEventListener('error', e => errors.push(e.error?.stack || e.message));
    d.window.addEventListener('unhandledrejection', e => errors.push('unhandled: ' + (e.reason?.stack || e.reason)));
    d.__errors = errors;
    return d;
  }

  async function openNote(d, nid, title) {
    const { document } = d.window;
    const boot2 = Date.now();
    const want = String(nid || '');
    // 기존 테스트가 남긴 같은 제목의 노트가 섞여 있어도 id 로만 골라
    // 이번 실행의 카드를 연다 (예전 실행의 2쪽 노트를 열지 않도록).
    let card = null;
    while (Date.now() - boot2 < 8_000 && !card) {
      card = [...document.querySelectorAll('.note-stack .note-card')].find(c =>
        String(c.dataset.nbId || '') === want);
      if (!card) await wait(60);
    }
    check('홈에 이번 노트 카드가 보인다', !!card);
    card.dispatchEvent(new d.window.MouseEvent('click', { bubbles: true }));
    const untilOpen = Date.now() + 6_000;
    while (Date.now() < untilOpen && !document.getElementById('editorView').classList.contains('open')) await wait(60);
    check('노트가 열린다', document.getElementById('editorView').classList.contains('open'));
  }

  domA = await boot();
  await openNote(domA, nid, '페이지 동기화');
  // 두 번째 클라이언트를 엽니다. 1쪽 상태로 들어오게 하기 위해 여기서 열고,
  // 페이지 추가가 일어나기 전에 "둘 다 열려 있는" 시점을 만든다.
  domB = await boot();
  await openNote(domB, nid, '페이지 동기화');

  const A = domA.window, B = domB.window;
  const aStage = A.document.getElementById('pagesStage');
  const bStage = B.document.getElementById('pagesStage');
  // 두 클라이언트 모두 최소 1쪽이 그려질 때까지 기다린 뒤 시작 상태를 잰다.
  const untilR = Date.now() + 4_000;
  while (Date.now() < untilR &&
    (aStage.querySelectorAll('.paper').length < 1 || bStage.querySelectorAll('.paper').length < 1)) {
    await wait(60);
  }
  const aStart = aStage.querySelectorAll('.paper').length;
  const bStart = bStage.querySelectorAll('.paper').length;
  check('두 클라이언트 모두 1쪽으로 시작한다', aStart === 1 && bStart === 1);

  // A 가 빠르게 새 페이지를 추가한다 (이 직후 B 의 live fast pull 이 잡도록 즉시).
  // addPage 는 클로저 안에 있어 전역 노출이 없으므로 '새 페이지 추가' 영역 클릭으로 호출한다.
  A.document.getElementById('addPageZone').click();
  check('A 가 즉시 2쪽이 된다', aStage.querySelectorAll('.paper').length === 2);

  // B 에게는 최대 3초까지 실시간 반영을 기다린다.
  const untilB = Date.now() + 5_000;
  let bPages = bStage.querySelectorAll('.paper').length;
  while (Date.now() < untilB && bPages < 2) {
    await wait(120);
    bPages = bStage.querySelectorAll('.paper').length;
  }
  check('B 화면에도 새 페이지가 실시간으로 생긴다', bPages === 2);
  check('B 의 doc.pages 길이도 2이다',
    B.document.querySelectorAll('#pagesStage .page-wrap').length === 2);

  const fatal = [...(domA.__errors || []), ...(domB.__errors || [])].filter(Boolean);
  if (fatal.length) console.log('runtime errors:\n' + fatal.slice(0, 8).join('\n---\n'));
  check('페이지 추가·실시간 반영 중 치명적 런타임 오류가 없다', fatal.length === 0);
  console.log(`\n에디터 페이지 실시간 동기화: PASS ${pass} / FAIL 0`);
} catch (e) {
  console.error('\n에디터 페이지 실시간 동기화 실패:', e);
  if (log) console.error('\nserver log:\n' + log.slice(-2500));
  process.exitCode = 1;
} finally {
  await wait(80);
  if (domA) domA.window.close();
  if (domB) domB.window.close();
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
