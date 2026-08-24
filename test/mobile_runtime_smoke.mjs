/* 17.0 · 모바일 런타임 스모크
 *
 * 실제 Fastify 서버에서 HTML/CSS/외부 sdynotes.js를 받은 뒤 JSDOM을 390×844
 * 터치 폰으로 구성한다. 단순 문자열 검사가 아니라 앱 전체 스크립트가 부팅되고
 * 주요 창을 열고 닫으며 visualViewport/회전/PC 복귀에 반응하는지 확인한다.
 */
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import jsdom from 'jsdom';
const { JSDOM, VirtualConsole } = jsdom;

let pass = 0;
const check = (name, cond) => {
  assert.ok(cond, name);
  pass++;
  console.log('  ✓ ' + name);
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForServer(url, child) {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`server exited (${child.exitCode})`);
    try {
      const r = await fetch(url + '/api/health');
      if (r.ok) return;
    } catch (_) {}
    await wait(80);
  }
  throw new Error('mobile smoke server start timeout');
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/src/index.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', b => { serverLog += b; });
child.stderr.on('data', b => { serverLog += b; });

let dom;
try {
  await waitForServer(base, child);

  const runtimeErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => {
    const msg = String(e?.message || e);
    if (!/HTMLMediaElement|Could not load (?:link|script)/.test(msg)) runtimeErrors.push(msg);
  });
  virtualConsole.on('error', (...args) => runtimeErrors.push(args.join(' ')));

  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      Object.defineProperty(window, 'innerWidth', { value: 390, writable: true, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 844, writable: true, configurable: true });
      Object.defineProperty(window.navigator, 'maxTouchPoints', { value: 5, writable: true, configurable: true });

      window.matchMedia = query => {
        const maxW = [...query.matchAll(/max-width\s*:\s*(\d+)px/g)].map(m => +m[1]);
        const maxH = [...query.matchAll(/max-height\s*:\s*(\d+)px/g)].map(m => +m[1]);
        const widthPart = maxW.some(v => window.innerWidth <= v);
        const coarsePart = query.includes('pointer:coarse') && window.navigator.maxTouchPoints > 0;
        const heightPart = maxH.length === 0 || maxH.some(v => window.innerHeight <= v);
        const matches = query.includes(',')
          ? widthPart || (coarsePart && heightPart)
          : (maxW.length ? widthPart : true) && heightPart && (!query.includes('pointer:coarse') || coarsePart);
        return { matches, media: query, onchange: null, addListener() {}, removeListener() {},
          addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
      };

      const vv = new window.EventTarget();
      vv.height = 844;
      vv.offsetTop = 0;
      window.visualViewport = vv;

      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL
          ? new URL(String(input), window.location.href)
          : input;
        return globalThis.fetch(target, init);
      };
      window.IntersectionObserver = class {
        constructor(cb) { this.cb = cb; }
        observe(el) { this.cb([{ isIntersecting: true, target: el }]); }
        unobserve() {}
        disconnect() {}
      };
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.BroadcastChannel = class { postMessage() {} close() {} addEventListener() {} };
      window.EventSource = class { close() {} addEventListener() {} };
      window.requestIdleCallback = cb => window.setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
      window.cancelIdleCallback = id => window.clearTimeout(id);
      // jsdom의 pretendVisual RAF는 window.close 직후 남은 콜백에서 location을 읽는
      // 문제가 있어, 테스트에서는 같은 의미의 window timer로 격리한다.
      window.requestAnimationFrame = cb => window.setTimeout(() => cb(Date.now()), 0);
      window.cancelAnimationFrame = id => window.clearTimeout(id);
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.HTMLCanvasElement.prototype.getContext = function () {
        return { clearRect() {}, drawImage() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
          stroke() {}, arc() {}, fill() {}, save() {}, restore() {}, scale() {}, translate() {}, setTransform() {},
          measureText() { return { width: 10 }; }, getImageData() { return { data: new Uint8ClampedArray(4) }; },
          putImageData() {} };
      };
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class {
        constructor() { this.paused = true; this.currentTime = 0; this.duration = 0; this.volume = 1; }
        play() { this.paused = false; return Promise.resolve(); }
        pause() { this.paused = true; }
        addEventListener() {}
        removeEventListener() {}
      };
      window.URL.createObjectURL = () => 'blob:test';
      window.URL.revokeObjectURL = () => {};
      window.confirm = () => true;
      window.alert = () => {};
      window.addEventListener('error', e => runtimeErrors.push(e.error?.stack || e.message));
      window.addEventListener('unhandledrejection', e => runtimeErrors.push(String(e.reason)));
    },
  });

  const { window } = dom;
  const { document } = window;
  const until = Date.now() + 8_000;
  while (Date.now() < until && typeof window.openSettings !== 'function') await wait(50);
  await wait(350);

  console.log('\n모바일 런타임 스모크');
  check('Fastify가 HTML/CSS/JS 세 파일을 정상 제공한다',
    (await fetch(base + '/')).ok && (await fetch(base + '/sdynotes.css')).ok && (await fetch(base + '/sdynotes.js')).ok);
  check('외부 sdynotes.js 전체가 모바일 DOM에서 부팅된다',
    typeof window.openSettings === 'function' && typeof window.openCards === 'function' && typeof window.sdyPlayFrom === 'function');
  check('390px 터치 화면에 sdy-mobile-ui가 붙는다', document.body.classList.contains('sdy-mobile-ui'));
  check('초기 visualViewport 높이 844px이 CSS 변수에 반영된다',
    document.documentElement.style.getPropertyValue('--sdy-mobile-vh') === '844px');
  check('홈이 겹친 카드 스택 없이 원래 격자로 렌더된다',
    !document.querySelector('#noteGrid .home-stack-area') && !!document.querySelector('#noteGrid .add-card'));

  window.openSettings();
  check('설정 창 열기', document.getElementById('setModal').style.display === 'flex');
  window.closeSettings();
  check('설정 창 닫기', document.getElementById('setModal').style.display === 'none');

  window.openCreateModal();
  check('새 노트 창과 크기 프리셋 열기',
    document.getElementById('createModal').style.display === 'flex' && document.querySelectorAll('#sizePresetGrid .size-preset-card').length >= 3);
  window.closeCreateModal();

  window.openCards();
  check('암기카드 창 열기', document.getElementById('cardsModal').style.display === 'flex');
  window.closeCards();

  window.openFocusClock();
  check('집중 시계 열기', document.getElementById('focusClock').classList.contains('show'));
  document.getElementById('fcCloseBtn').click();

  window.sdyAuthOpen();
  check('로그인 창 열기', document.getElementById('sdyAuthWrap').style.display === 'flex');
  window.sdyAuthClose();

  window.__ypEnter();
  check('엽스코드 입장 게이트 열기', document.getElementById('ypGate').style.display === 'flex');
  document.getElementById('ypGate').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  const player = document.getElementById('musicPlayer');
  player.style.display = 'flex';
  await wait(20);
  check('음악바 표시 시 플로팅 칩 쌓기 상태가 동기화된다', document.body.classList.contains('has-mpbar'));
  player.style.display = 'none';
  player.classList.remove('mp-bar');
  window.dispatchEvent(new window.Event('resize'));
  await wait(20);
  check('음악바 숨김 상태도 동기화된다', !document.body.classList.contains('has-mpbar'));

  window.visualViewport.height = 522;
  window.visualViewport.dispatchEvent(new window.Event('resize'));
  check('가상 키보드/주소창 높이 변화가 즉시 반영된다',
    document.documentElement.style.getPropertyValue('--sdy-mobile-vh') === '522px');

  window.innerWidth = 844;
  window.innerHeight = 390;
  window.visualViewport.height = 390;
  window.dispatchEvent(new window.Event('orientationchange'));
  await wait(260);
  check('844×390 가로 터치 폰에서도 모바일 UI를 유지한다', document.body.classList.contains('sdy-mobile-ui'));

  window.innerWidth = 1280;
  window.innerHeight = 800;
  window.visualViewport.height = 800;
  window.navigator.maxTouchPoints = 0;
  window.dispatchEvent(new window.Event('resize'));
  check('1280px fine-pointer PC로 돌아가면 모바일 class/높이 변수를 제거한다',
    !document.body.classList.contains('sdy-mobile-ui') &&
    document.documentElement.style.getPropertyValue('--sdy-mobile-vh') === '');

  const fatal = runtimeErrors.filter(Boolean);
  check('앱 부팅/주요 창 조작 중 JS 런타임 오류가 없다', fatal.length === 0);

  console.log(`\n모바일 런타임 스모크: PASS ${pass} / FAIL 0`);
} catch (error) {
  console.error('\n모바일 런타임 스모크 실패:', error);
  if (serverLog) console.error('\nserver log:\n' + serverLog.slice(-3000));
  process.exitCode = 1;
} finally {
  if (dom) dom.window.close();
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
