/* 텍스트 선택 우클릭 메뉴 런타임 검증 — copy/cut/link/clear fallback

   고정 sleep 없이 실제 사용자 순서로 검증한다.
     ① 글자를 드래그 선택 → 우클릭 메뉴 → 복사: execCommand 없이도 터지지 않고 클립보드에 기록
     ② 같은 선택 → 우클릭 메뉴 → 잘라내기: 클립보드 기록 + 선택 글자 삭제 + Ctrl+Z 복원
     ③ 선택 글자에 링크 걸기: execCommand 없이 직접 <a> 생성
     ④ 링크가 걸린 선택에 서식 지우기: execCommand('unlink') 없이도 <a> 제거, 글자는 보존 */
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import jsdom from 'jsdom';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { installWindowGuard, closeDoms } from './jsdom_guard.mjs';

const { JSDOM, VirtualConsole } = jsdom;
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-txtclip-'));
process.env.SDY_BASE_DIR = TMP;
for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));

let pass = 0;
const check = (name, cond, extra = '') => {
  assert.ok(cond, name + (extra ? ` — ${extra}` : ''));
  pass++;
  console.log('  ✓ ' + name);
};

async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}
function waitForServer(child, getLog, label = 'server', timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    let done = false, timer = null;
    const onData = () => { if (/서버 실행 중|listening|브라우저에서/.test(getLog())) finish(); };
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      if (err) reject(err); else resolve();
    };
    timer = setTimeout(() => finish(new Error(`${label} start timeout\n${getLog().slice(-1200)}`)), timeoutMs);
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    onData();
    child.once('exit', () => finish(new Error(`${label} exited early\n${getLog().slice(-1200)}`)));
  });
}
function waitUntil(win, pred, label, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    let done = false, raf = 0;
    const timer = setTimeout(() => {
      if (done) return;
      done = true; cleanup(); reject(new Error(`timeout: ${label}`));
    }, timeoutMs);
    const mo = new win.MutationObserver(checkNow);
    function cleanup() { clearTimeout(timer); try { mo.disconnect(); } catch {} try { if (raf) win.cancelAnimationFrame(raf); } catch {} }
    function checkNow() {
      if (done) return;
      let v = null;
      try { v = pred(); } catch {}
      if (v) { done = true; cleanup(); resolve(v); }
    }
    function frame() { checkNow(); if (!done) raf = win.requestAnimationFrame(frame); }
    try { mo.observe(win.document, { subtree: true, childList: true, attributes: true, characterData: true }); } catch {}
    checkNow();
    if (!done) raf = win.requestAnimationFrame(frame);
  });
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/src/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', b => { log += b; });
child.stderr.on('data', b => { log += b; });
let dom;
try {
  await waitForServer(child, () => log);
  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '텍스트클립', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [{ type: 'text', id: 't1', x: 50, y: 60, w: 360, h: 80, html: 'alpha beta gamma', fontSize: 16 }] }],
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
      Object.defineProperty(window.HTMLElement.prototype, 'contentEditable', {
        get(){ const v = this.getAttribute('contenteditable'); return v == null ? 'inherit' : v; },
        set(v){ this.setAttribute('contenteditable', String(v)); },
        configurable: true, enumerable: true,
      });
      window.__clipWrites = [];
      Object.defineProperty(window.navigator, 'clipboard', {
        value: { writeText: async (t) => { window.__clipWrites.push(String(t)); } },
        configurable: true,
      });
      window.document.execCommand = undefined; // fallback 경로 강제
      window.innerWidth = 1280; window.innerHeight = 820;
      window.matchMedia = query => ({ matches: query.includes('pointer:fine'), media: query, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.BroadcastChannel = class { postMessage(){} close(){} addEventListener(){} };
      window.EventSource = class { close(){} addEventListener(){} };
      window.requestAnimationFrame = cb => setImmediate(() => cb(Date.now()));
      window.cancelAnimationFrame = clearImmediate;
      window.cancelIdleCallback = clearTimeout;
      window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect(){}, drawImage(){}, fillRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, arc(){}, fill(){}, save(){}, restore(){}, scale(){}, translate(){}, setTransform(){}, measureText(){ return { width: 10 }; }, getImageData(){ return { data: new Uint8ClampedArray(4) }; }, putImageData(){} });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class { constructor(){ this.paused = true; } play(){ return Promise.resolve(); } pause(){} addEventListener(){} removeEventListener(){} };
      window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
    },
  });

  const { window } = dom, { document } = window;
  const card = await waitUntil(window, () => [...document.querySelectorAll('.note-stack .note-card')].find(c => (c.textContent || '').includes('텍스트클립')), 'note card');
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await waitUntil(window, () => document.getElementById('editorView')?.classList.contains('open') && document.querySelector('#pagesStage .tb[data-id="t1"]'), 'editor open');

  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });
  const tb = () => document.querySelector('#pagesStage .tb[data-id="t1"]');
  const content = () => tb().querySelector('.tb-content');
  const key = (k, opt = {}) => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opt }));
  const textNodeContaining = (needle) => {
    const tw = document.createTreeWalker(content(), window.NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) if ((n.nodeValue || '').includes(needle)) return n;
    return null;
  };
  const selectWord = (needle) => {
    const n = textNodeContaining(needle);
    assert.ok(n, `select target missing: ${needle}`);
    const i = n.nodeValue.indexOf(needle);
    const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + needle.length);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
    window.saveSel();
    return r;
  };
  const openSelectionMenu = () => {
    content().dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 120, clientY: 90 }));
    check('선택 글자 우클릭 메뉴가 열린다', document.getElementById('ctxMenu').classList.contains('show'));
  };

  console.log('\n── A. 선택 글자 복사 fallback ─────────────────');
  selectWord('beta');
  openSelectionMenu();
  await window.editorAction('copy');
  check('A1 execCommand 없이도 선택 글자가 클립보드에 복사된다', window.__clipWrites.at(-1) === 'beta', window.__clipWrites.join('|'));
  check('A2 복사는 원문을 건드리지 않는다', (content().textContent || '') === 'alpha beta gamma');

  console.log('\n── B. 선택 글자 잘라내기 fallback + 되돌리기 ───');
  selectWord('beta');
  openSelectionMenu();
  await window.editorAction('cut');
  check('B1 잘라낸 글자가 클립보드에 기록된다', window.__clipWrites.at(-1) === 'beta', window.__clipWrites.join('|'));
  check('B2 잘라낸 글자는 화면에서 사라진다', !(content().textContent || '').includes('beta'), content().textContent || '');
  check('B3 잘라낸 글자는 문서 데이터에서도 사라진다', !(window.findEl(0, 't1').html || '').includes('beta'), window.findEl(0, 't1').html || '');
  key('z', { ctrlKey: true });
  await waitUntil(window, () => (document.querySelector('#pagesStage .tb[data-id="t1"] .tb-content')?.textContent || '').includes('beta'), 'cut undo restore');
  check('B4 Ctrl+Z 로 잘라내기가 복원된다', (content().textContent || '') === 'alpha beta gamma', content().textContent || '');

  console.log('\n── C. 링크 걸기 fallback → 서식 지우기로 unlink ─');
  window.prompt = () => 'https://example.com/a';
  selectWord('alpha');
  openSelectionMenu();
  await window.editorAction('sel-link');
  check('C1 execCommand 없이도 선택 글자에 링크가 걸린다', !!content().querySelector('a[href="https://example.com/a"]'), content().innerHTML);
  selectWord('alpha');
  window.clearFmt();
  check('C2 서식 지우기는 execCommand 없이도 링크 태그를 제거한다', !content().querySelector('a'), content().innerHTML);
  check('C3 링크를 지워도 글자는 남는다', (content().textContent || '').includes('alpha beta gamma'), content().textContent || '');
  check('C4 서식 지우기 뒤 style="" 빈 span 이 남지 않는다', !/<span[^>]*style=""/i.test(content().innerHTML), content().innerHTML);

  console.log('\n── D. 링크 일부만 선택해 unlink ────────────────');
  selectWord('alpha beta');
  openSelectionMenu();
  await window.editorAction('sel-link');
  check('D1 여러 단어 선택에도 링크가 걸린다', (content().querySelector('a')?.textContent || '') === 'alpha beta', content().innerHTML);
  selectWord('beta');
  window.clearFmt();
  const alphaLink = [...content().querySelectorAll('a')].find(a => (a.textContent || '').includes('alpha'));
  const betaNode = textNodeContaining('beta');
  check('D2 선택한 일부 단어 beta 만 링크에서 빠진다', !!alphaLink && !(betaNode?.parentElement?.closest('a')), content().innerHTML);
  check('D3 일부 unlink 후에도 전체 문장은 보존된다', /alpha\s+beta\s+gamma/.test(content().textContent || ''), content().textContent || '');

  check('Z 치명적 런타임 오류 없음', errors.length === 0, errors.slice(0, 3).join(' / '));
  console.log(`\n텍스트 선택 메뉴 fallback(무고정-sleep): PASS ${pass}`);
} catch (e) {
  console.error('FAIL: ' + (e && e.stack || e));
  if (log) console.error('server log:\n' + log.slice(-1600));
  throw e;
} finally {
  await closeDoms([dom]);
  try { child.kill('SIGTERM'); } catch {}
}
