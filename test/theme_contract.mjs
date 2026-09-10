/* 14.47 · PRO 테마 계약 — 기본값 pro · 전환 · 설정 UI · 구 S.dark 이전 검증
   실행: npm run test:theme (서버를 띄우고 실제 페이지를 jsdom 으로 열어 확인) */
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import jsdom from 'jsdom';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { installWindowGuard, closeDoms } from './jsdom_guard.mjs';
const { JSDOM, VirtualConsole } = jsdom;

const pass = [];
const check = (name, cond) => { assert.ok(cond, name); pass.push(name); console.log('  ✓ ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const REPO = '/home/user/sdynotes';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-theme-'));
process.env.SDY_BASE_DIR = TMP;
for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
fs.mkdirSync(path.join(TMP, 'src'), { recursive: true });
for (const f of fs.readdirSync(path.join(REPO, 'src'))) {
  const from = path.join(REPO, 'src', f), to = path.join(TMP, 'src', f);
  if (fs.statSync(from).isDirectory()) continue;
  fs.copyFileSync(from, to);
}

async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port; await new Promise(r => s.close(r)); return p;
}
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/src/index.js'], {
  cwd: REPO, env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);

function mkBeforeParse(errs, presetLS) {
  return (window) => {
    installWindowGuard(window);
    window.innerWidth = 1280; window.innerHeight = 800;
    if (presetLS) window.localStorage.setItem('sdy3', presetLS);
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
  };
}

async function loadPage(presetLS) {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = String(e?.message || e); if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errs.push(m); });
  vc.on('error', (...a) => errs.push(a.join(' ')));
  const dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse: mkBeforeParse(errs, presetLS),
  });
  const { window } = dom, { document } = window;
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if (document.querySelector('#noteGrid .home-stack-area') || document.getElementById('splash')?.classList.contains('hide')) break;
    await wait(150);
  }
  await wait(800);
  return { dom, window, document, errs };
}

let dom1, dom2;
try {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died: ' + log.slice(-2000));
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(100);
  }

  // ── 1) 첫 방문(저장값 없음) → 프로 기본 ──
  ({ dom: dom1 } = await loadPage(null));
  const w1 = dom1.window, d1 = dom1.window.document;
  check('첫 진입 data-theme=pro', d1.documentElement.dataset.theme === 'pro');
  check('첫 진입 .theme-pro 있음', d1.documentElement.classList.contains('theme-pro'));
  check('호환 .dark 별칭 함께 켜짐', d1.documentElement.classList.contains('dark'));
  check('sdyTheme()=pro', w1.sdyTheme() === 'pro');
  check('pickTheme/paintThemePicks 전역 노출', typeof w1.pickTheme === 'function' && typeof w1.paintThemePicks === 'function');
  check('구 darkTgl 요소 제거됨', !d1.getElementById('darkTgl'));
  const bg1 = w1.getComputedStyle(d1.documentElement).getPropertyValue('--bg').trim().toLowerCase();
  console.log('    --bg = ' + JSON.stringify(bg1));
  check('프로 --bg 토큰이 다크값', bg1 === '#0a0d14');

  // ── 2) 설정창 테마 UI ──
  w1.openSettings();
  await wait(200);
  check('테마 선택 UI 렌더', !!d1.getElementById('themePicks'));
  check('프로 카드에 .on', !!d1.querySelector('.theme-pick[data-theme=pro].on'));
  check('클래식 카드 .on 없음', !d1.querySelector('.theme-pick[data-theme=classic].on'));

  // ── 3) 클래식으로 전환 ──
  w1.pickTheme('classic');
  await wait(200);
  check('전환 후 data-theme=classic', d1.documentElement.dataset.theme === 'classic');
  check('전환 후 .theme-classic', d1.documentElement.classList.contains('theme-classic'));
  check('전환 후 .theme-pro/.dark 꺼짐', !d1.documentElement.classList.contains('theme-pro') && !d1.documentElement.classList.contains('dark'));
  check('클래식 카드에 .on 이동', !!d1.querySelector('.theme-pick[data-theme=classic].on'));
  const saved = JSON.parse(w1.localStorage.getItem('sdy3'));
  check('localStorage에 theme=classic 저장', saved && saved.theme === 'classic');
  check('구 S.dark 키 정리됨', !('dark' in saved));
  const bgC = w1.getComputedStyle(d1.documentElement).getPropertyValue('--bg').trim().toLowerCase();
  console.log('    classic --bg = ' + JSON.stringify(bgC));
  check('클래식 --bg 토큰이 라이트값', bgC === '#ffffff');

  // ── 4) 다시 프로로 ──
  w1.pickTheme('pro');
  await wait(200);
  check('복귀 후 pro', d1.documentElement.dataset.theme === 'pro' && w1.sdyTheme() === 'pro');
  w1.closeSettings();

  // ── 5) 구버전 저장값(S.dark, theme 없음) 이전 ──
  const legacy = JSON.stringify({ dark: true, defPaper: 'blank', defFS: 16, defFont: 'pretendard', accent: '#4f6ef7', appTitle: '', cardSize: 'l' });
  ({ dom: dom2 } = await loadPage(legacy));
  const w2 = dom2.window, d2 = dom2.window.document;
  check('구 dark 저장값도 pro로 시작', d2.documentElement.dataset.theme === 'pro' && w2.sdyTheme() === 'pro');

  console.log(`\n✅ theme_smoke — ${pass.length}개 항목 통과`);
} finally {
  try { await closeDoms(); } catch {}
  try { dom1?.window?.close(); } catch {}
  try { dom2?.window?.close(); } catch {}
  try { child.kill('SIGKILL'); } catch {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
}
