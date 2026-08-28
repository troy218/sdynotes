/* 17.2 홈 스택 렌더/상호작용 검증 */
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
  const until = Date.now() + 12000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died');
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }
  // seed notes
  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  for (const t of ['노트 A', '노트 B', '노트 C', '노트 D']) {
    const ins = await q({ table: 'notebooks', op: 'insert', values: [{ title: t, color: '#4f6ef7' }], filters: [], returning: true, single: true });
    const doc = { version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {}, pages: [{ id: 'p1', els: [{ type: 'text', id: 't1', x: 40, y: 60, w: 500, h: 400, html: '<b>' + t + '</b>', fontSize: 22 }] }] };
    await q({ table: 'memos', op: 'insert', values: [{ notebook_id: ins.data.id, content: JSON.stringify(doc), font_size: 16 }], filters: [] });
  }

  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = String(e?.message || e); if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errs.push(m); });
  vc.on('error', (...a) => errs.push(a.join(' ')));

  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.innerWidth = 1280; window.innerHeight = 800;
      window.matchMedia = q => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
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
      window.HTMLCanvasElement.prototype.getContext = () => ({
        clearRect(){}, drawImage(){}, fillRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, arc(){}, fill(){},
        save(){}, restore(){}, scale(){}, translate(){}, setTransform(){}, measureText(){return {width:10}},
        getImageData(){return {data:new Uint8ClampedArray(4)}}, putImageData(){} });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class { constructor(){this.paused=true;} play(){return Promise.resolve()} pause(){} addEventListener(){} removeEventListener(){} };
      window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
      window.addEventListener('error', e => errs.push(e.error?.stack || e.message));
      window.addEventListener('unhandledrejection', e => errs.push('unhandled: ' + (e.reason?.stack || e.reason)));
    }
  });

  const { window } = dom, { document } = window;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000 && (!document.querySelector('.note-stack .note-card') || document.querySelectorAll('.note-stack .note-card').length < 4)) await wait(80);
  await wait(600);

  const area = document.querySelector('#noteGrid .home-stack-area');
  check('홈 스택 영역이 렌더된다', !!area);
  const stackCards = document.querySelectorAll('.note-stack .note-card');
  check('스택에 노트 카드가 모두 쌓인다', stackCards.length >= 4);
  check('새 노트 만들기 버튼이 있다', !!document.querySelector('.home-add-note'));
  check('최근 줄은 아직 비어 있다(연 노트 없음)', !document.querySelector('.recent-row .note-card'));

  // 접힌 더미는 카드 자체에서만 fan, 펼친 뒤에는 더미 전체가 선택 통로
  const stack = document.querySelector('.note-stack');
  const upper = document.querySelector('.home-stack-upper');
  const firstCard = document.querySelector('.note-stack .note-card');
  const secondCard = document.querySelectorAll('.note-stack .note-card')[1];
  upper.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  await wait(80);
  check('노트 바깥 상단 영역에서는 스택이 펼쳐지지 않는다', !stack.classList.contains('fanned'));
  firstCard.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  await wait(120);
  check('노트 자체에 진입하면 스택이 fanned 된다', stack.classList.contains('fanned'));
  secondCard.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, relatedTarget: firstCard }));
  await wait(240);
  check('펼친 노트 사이를 좌우로 이동해도 스택이 유지된다', stack.classList.contains('fanned'));
  stack.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: false }));
  await wait(300);
  check('노트 선택 통로를 나가면 스택이 접힌다', !stack.classList.contains('fanned'));

  // 첫 노트 열기
  firstCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1200);
  check('노트 카드 클릭 시 에디터가 열린다', document.getElementById('editorView').classList.contains('open'));

  // 편집기가 열린 상태에서 다른 카드 열기 요청이 들어와도 이전 curNB와 새 id를
  // 잘못 비교해 중간 반환하지 않아야 한다(14.15 회귀 방지).
  const secondTitle = secondCard.querySelector('.note-card-name span').textContent;
  secondCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1400);
  check('열린 편집기에서 다른 노트로 바로 전환된다',
    document.getElementById('edTitle').value === secondTitle);

  // 닫기
  window.navBack && window.navBack();
  await wait(900);
  check('에디터를 닫으면 홈으로 돌아온다', !document.getElementById('editorView').classList.contains('open'));

  const recent = document.querySelectorAll('.recent-row .note-card');
  check('편집하고 나온 노트는 아래 최근 줄에 놓인다', recent.length >= 2);
  check('연 노트는 스택에서는 빠진다', document.querySelectorAll('.note-stack .note-card').length === stackCards.length - 2);

  const fatal = errs.filter(Boolean);
  check('치명적 JS 오류 없음', fatal.length === 0);
  if (fatal.length) console.log('ERRORS:\n' + fatal.slice(0, 5).join('\n---\n'));

  console.log(`\nPASS ${pass.length}`);
} catch (e) {
  console.error('FAIL:', e);
  if (log) console.error('server log:\n' + log.slice(-2000));
  process.exitCode = 1;
} finally {
  if (dom) dom.window.close();
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
