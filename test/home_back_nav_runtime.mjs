/* 14.65 · 뒤로가기가 '홈까지' 올라가는지 고정하는 회귀 테스트

   사용자 보고: "폴더 안에 들어간 상태에서 문서를 열고 뒤로가기를 누르면
   문서는 닫히는데 한 번 더 누르면 그냥 사이트가 나가져버린다. 그렇게 하지 말고
   홈까지 이동할 수 있게 해줘."

   원인 두 가지를 함께 잡았다.

   ⓐ 뒤로가기(popstate)가 부른 닫기 동작이 장부에서 이미 빠진 층인데도
      navDrop → '보초 걷기'(history.back())를 한 번 더 불렀다. 그 back() 이
      뒤로가기를 하나 더 먹어, 층 하나를 건너뛰거나 앱 밖으로 밀어냈다.
      → popstate 가 부른 닫기 동안에는 navDrop 이 보초를 건드리지 않는다
        (_navCloseFromPop / _navInClose).
   ⓑ 어떤 길로 폴더에 들어왔든(장부에 층이 없는 상태 — 예: 예전 화면 복원,
      폴더로 바로 진입) 뒤로가기가 사이트를 나가 버렸다.
      → 열린 층이 없어도 폴더 안이면 한 단계 위(결국 홈)로 올리고, 에디터가
        열려 있으면 닫는다. 정말 홈에서 눌렀을 때만 앱을 나간다.

   실행: node test/home_back_nav_runtime.mjs   (npm run test:homeback) */
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
const check = (name, cond, extra = '') => {
  assert.ok(cond, name + (extra ? ` → ${extra}` : ''));
  pass.push(name); console.log('  ✓ ' + name);
};
const wait = ms => new Promise(r => setTimeout(r, ms));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-homeback-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
  fs.mkdirSync(path.join(TMP, 'src'), { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO, 'src'))) {
    const from = path.join(REPO, 'src', f), to = path.join(TMP, 'src', f);
    if (fs.statSync(from).isDirectory()) continue;
    fs.copyFileSync(from, to);
  }
}

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
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died');
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }
  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  for (const t of ['폴더노트 A', '홈노트 B']) {
    const ins = await q({ table: 'notebooks', op: 'insert', values: [{ title: t, color: '#4f6ef7' }], filters: [], returning: true, single: true });
    const doc = { version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
      pages: [{ id: 'p1', els: [{ type: 'text', id: 't1', x: 40, y: 60, w: 500, h: 300, html: '<b>' + t + '</b> 본문', fontSize: 22 }] }] };
    await q({ table: 'memos', op: 'insert', values: [{ notebook_id: ins.data.id, content: JSON.stringify(doc), font_size: 16 }], filters: [] });
  }

  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = String(e?.message || e); if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errs.push(m); });
  vc.on('error', (...a) => errs.push(a.join(' ')));

  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.localStorage.setItem('sdy3', JSON.stringify({ theme: 'pro', defPaper: 'blank', defFS: 16, defFont: 'pretendard', accent: '#4f6ef7', appTitle: '', cardSize: 'l' }));
      installWindowGuard(window);
      window.innerWidth = 1400; window.innerHeight = 900;
      window.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      window.IntersectionObserver = class { observe(){} unobserve(){} disconnect() {} };
      window.ResizeObserver = class { observe(){} disconnect(){} };
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
  const ev = code => window.eval(code);
  const editorOpen = () => document.getElementById('editorView').classList.contains('open');
  const cards = () => [...document.querySelectorAll('.note-card')];
  const homeUp = () => {
    const bc = document.getElementById('breadcrumb');
    return !bc || window.getComputedStyle(bc).display === 'none' || !(bc.textContent || '').trim();
  };
  const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const guardN = () => { const s = window.history.state; return (s && s.sdyNavGuard) ? (s.n ?? -1) : null; };

  const t0 = Date.now();
  while (Date.now() - t0 < 15000 && cards().length < 2) await wait(80);
  await wait(500);

  console.log('\n── ① 준비: 노트 2개 + 폴더 하나(노트 하나 담기) ────────────');
  check('홈에 노트 카드 2장이 있다', cards().length >= 2, `${cards().length}장`);
  const fid = ev(`(function(){
      var nb=document.querySelector('.note-card');
      var f=createFolder('테스트폴더', nb?[nb.dataset.nbId]:[]);
      renderGrid();
      return f.id;
  })()`);
  await wait(500);
  check('폴더 카드가 생겼다', !!document.querySelector('.folder-card'), fid);
  const openFolder = (skip) => { ev(`openFolder(${JSON.stringify(fid)}, ${skip ? 'true' : 'false'})`); };
  const openNoteInFolder = async () => {
    // 폴더 안의 노트 카드(폴더에 담긴 하나)를 연다
    const nc = [...document.querySelectorAll('.note-card')].find(c => !homeUp());
    click(nc || cards()[0]);
    const t = Date.now();
    while (Date.now() - t < 15000 && !editorOpen()) await wait(60);
    await wait(700);
    return editorOpen();
  };
  const closeWait = async () => {
    const t = Date.now();
    while (Date.now() - t < 8000 && editorOpen()) await wait(60);
    await wait(700);   // 400ms 슬라이드아웃 → loadNBs
  };

  console.log('\n── ② 폴더 → 문서 → 뒤로가기 → 뒤로가기 (정상 경로) ─────────');
  openFolder(false);
  await wait(400);
  check('폴더 안으로 들어왔다(브레드크럼 표시)', !homeUp());
  check('폴더 진입이 히스토리 보초를 쌓았다', guardN() === 1, JSON.stringify(window.history.state));
  window.__alive = 'yes';
  check('폴더 안에서 노트가 열린다', await openNoteInFolder());
  window.history.back();
  await closeWait();
  check('뒤로가기 한 번에 문서가 닫힌다', !editorOpen());
  check('아직 폴더 안이다(홈으로 튕기지 않는다)', !homeUp(), document.getElementById('breadcrumb')?.textContent);
  check('남은 층이 있으니 보초를 다시 얹는다', guardN() === 1, JSON.stringify(window.history.state));
  window.history.back();
  await wait(600);
  check('뒤로가기 두 번째에 홈까지 올라온다(사이트를 나가지 않는다)', homeUp());
  check('문서가 다시 실리지 않았다(앱이 살아 있다)', window.__alive === 'yes' && !!document.getElementById('noteGrid'));
  check('홈에서는 보초를 남기지 않는다(다음 뒤로가기는 앱을 나간다)', guardN() === null, JSON.stringify(window.history.state));

  console.log('\n── ③ 보초 없는 폴더(직접 진입)에서도 홈까지 올라간다 ───────');
  // ⓑ 회귀 재현: 예전 화면 복원·직접 진입처럼 장부에 층이 없는 폴더.
  //    예전에는 두 번째 뒤로가기가 아무 일도 하지 않았고(= 실제 브라우저에서는
  //    사이트 이탈), 사용자가 "그냥 사이트가 나가진다"고 본 자리다.
  ev('history.length;');   // no-op
  openFolder(true);
  await wait(400);
  check('보초 없이도 폴더 화면이다', !homeUp() && guardN() === null, JSON.stringify(window.history.state));
  check('보초 없는 폴더에서도 노트가 열린다', await openNoteInFolder());
  window.history.back();
  await closeWait();
  check('첫 뒤로가기 — 문서가 닫힌다', !editorOpen());
  check('아직 폴더 안이다', !homeUp());
  window.history.back();
  await wait(600);
  check('둘째 뒤로가기 — 사이트를 나가는 대신 홈으로 올라온다', homeUp());
  check('앱이 그대로 살아 있다', window.__alive === 'yes' && !!document.getElementById('noteGrid'));

  console.log('\n── ④ 소스 계약: popstate 닫기가 뒤로가기를 하나 더 먹지 않는다 ──');
  const src = f => fs.readFileSync(path.join(new URL('..', import.meta.url).pathname, 'src', 'app', f), 'utf-8');
  const nav = src('10a-place-keys.js');
  check('popstate 는 _navCloseFromPop 으로 닫는다', /while\(_nav\.length>n\) _navCloseFromPop\(_nav\.pop\(\)\);/.test(nav)
    && /_navCloseFromPop\(_nav\.pop\(\)\);/.test(nav));
  check('닫는 동안 navDrop 은 보초를 걷지 않는다', /if\(_navInClose\) return;/.test(nav));
  check('열린 층이 없으면 _navHomeStep 이 폴더를 한 단계 올린다', /function _navHomeStep\(\)\{[\s\S]*?openFolder\(folderParent\(curFolder\), true\);/.test(nav));

  const fatal = errs.filter(Boolean);
  check('치명적 JS 오류 없음', fatal.length === 0, fatal.slice(0, 3).join(' | '));
  if (fatal.length) console.log('ERRORS:\n' + fatal.slice(0, 5).join('\n---\n'));

  console.log(`\nPASS ${pass.length}`);
} catch (e) {
  console.error('FAIL:', e);
  if (log) console.error('server log:\n' + log.slice(-2000));
  process.exitCode = 1;
} finally {
  await closeDoms([dom]);
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  fs.rmSync(TMP, { recursive: true, force: true });
}
