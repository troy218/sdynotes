/* 텍스트 편집 엣지 런타임 검증 — sleep 없는 단계형 사용자 동작 테스트

   고정 sleep(ms) 없이 MutationObserver/requestAnimationFrame/즉시 조건 검증으로
   실제 사용자 흐름을 빠르게 밟는다.

     A. Ctrl+클릭으로 여러 텍스트 상자를 고른 뒤 글자 크기 입력칸을 바꾸면
        선택한 모든 상자의 fontSize 와 DOM 이 함께 바뀐다.
     B. 구버전 box-level 글자색(textColor)과 형광펜(cellBg)을
        "자동(검정) / 색 없음"으로 지우면 데이터 필드까지 사라진다.
     C. "서식 지우기"는 구버전 box-level 굵기·기울임·밑줄·색·배경·글꼴을
        화면과 저장 데이터 양쪽에서 모두 제거한다.
     D. 상자 전체 굵게를 적용한 뒤 다시 상자를 선택하면 툴바 굵게 버튼이
        실제 상태대로 켜져 보인다. */
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-txtedge-'));
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
    const onData = () => {
      if (/서버 실행 중|listening|브라우저에서/.test(getLog())) finish();
    };
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
      done = true;
      cleanup();
      reject(new Error(`timeout: ${label}`));
    }, timeoutMs);
    const mo = new win.MutationObserver(checkNow);
    function cleanup() {
      clearTimeout(timer);
      try { mo.disconnect(); } catch {}
      try { if (raf) win.cancelAnimationFrame(raf); } catch {}
    }
    function checkNow() {
      if (done) return;
      let v = null;
      try { v = pred(); } catch {}
      if (v) {
        done = true;
        cleanup();
        resolve(v);
      }
    }
    function frame() {
      checkNow();
      if (!done) raf = win.requestAnimationFrame(frame);
    }
    try { mo.observe(win.document, { subtree: true, childList: true, attributes: true, characterData: true }); } catch {}
    checkNow();
    if (!done) raf = win.requestAnimationFrame(frame);
  });
}

function clickBox(win, content, opts = {}) {
  const ev = { bubbles: true, cancelable: true, button: 0, detail: 1, clientX: 90, clientY: 90, ...opts };
  content.dispatchEvent(new win.MouseEvent('mousedown', ev));
  win.document.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, ...opts }));
}

function pressToolbar(win, selector) {
  const b = win.document.querySelector(selector);
  assert.ok(b, `toolbar button missing: ${selector}`);
  b.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  b.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}

function isPlainHtml(html) {
  return !/<\/?(span|b|strong|i|em|u|s|strike|mark|font)\b/i.test(String(html || ''));
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
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '텍스트엣지', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [
      { type: 'text', id: 't1', x: 40, y: 40, w: 240, h: 70, html: '첫 상자', fontSize: 16 },
      { type: 'text', id: 't2', x: 320, y: 40, w: 240, h: 70, html: '둘째 상자', fontSize: 18 },
      { type: 'text', id: 't3', x: 40, y: 150, w: 260, h: 70, html: '오래된 색 상자', fontSize: 16, textColor: '#e74c3c', cellBg: '#ffff00' },
      { type: 'text', id: 't4', x: 40, y: 260, w: 320, h: 90,
        html: '<b><i><span style="color:#3498db;background-color:#00ff00;text-decoration:underline">구버전 서식</span></i></b>',
        fontSize: 20, font: 'gaegu', textColor: '#9b59b6', cellBg: '#ffcc99', fontWeight: '700', fontStyle: 'italic', textDecoration: 'underline' },
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
      Object.defineProperty(window.HTMLElement.prototype, 'contentEditable', {
        get(){ const v = this.getAttribute('contenteditable'); return v == null ? 'inherit' : v; },
        set(v){ this.setAttribute('contenteditable', String(v)); },
        configurable: true, enumerable: true,
      });
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
  const card = await waitUntil(window, () => [...document.querySelectorAll('.note-stack .note-card')].find(c => (c.textContent || '').includes('텍스트엣지')), 'note card');
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await waitUntil(window, () => document.getElementById('editorView')?.classList.contains('open') && document.querySelector('#pagesStage .tb[data-id="t4"]'), 'editor open');

  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });
  const tb = id => document.querySelector(`#pagesStage .tb[data-id="${id}"]`);
  const content = id => tb(id).querySelector('.tb-content');
  const el = id => window.findEl(0, id);

  console.log('\n── A. 다중 선택 → 글자 크기 입력 ───────────────');
  window.clearTextSelection(); window.deselectAll(true); window.clearMulti();
  // 일부 사용자는 글자를 드래그해 둔 직후 Ctrl+클릭으로 상자 다중 선택을 한다.
  // 이때 예전 글자 선택(savedRange)이 남아 있으면 이후 서식이 엉뚱한 글자에 먹는다.
  {
    const r = document.createRange();
    r.setStart(content('t3').firstChild, 0); r.setEnd(content('t3').firstChild, 3);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(r); window.saveSel();
    check('A0 이전 글자 드래그 선택을 재현해 둔다', String(window.getSelection()) === '오래된');
  }
  clickBox(window, content('t1'), { ctrlKey: true });
  clickBox(window, content('t2'), { ctrlKey: true });
  check('A1 Ctrl+클릭 두 번으로 두 상자가 다중 선택된다', document.querySelectorAll('#pagesStage .tb.msel').length === 2);
  const fsInput = document.getElementById('fsInput');
  fsInput.value = '28';
  fsInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  // 실제 UI 는 Enter/포커스 이탈(change)로 크기를 확정한다 — 사용자가
  // 숫자를 적고 툴바 밖을 클릭하는 동작과 같은 의미로 change 를 보낸다.
  fsInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('A2 글자 크기 입력칸 변경이 첫 상자 데이터에 반영된다', el('t1').fontSize === 28, String(el('t1').fontSize));
  check('A3 글자 크기 입력칸 변경이 둘째 상자 데이터에도 반영된다', el('t2').fontSize === 28, String(el('t2').fontSize));
  check('A4 두 상자의 DOM 글자 크기도 28px 이다', parseInt(content('t1').style.fontSize, 10) === 28 && parseInt(content('t2').style.fontSize, 10) === 28);

  console.log('\n── B. 구버전 box-level 색/형광펜 지우기 ─────────');
  window.clearTextSelection(); window.deselectAll(true); window.clearMulti();
  clickBox(window, content('t3'));
  check('B1 클릭한 구버전 상자가 선택된다', tb('t3').classList.contains('sel'));
  window.clearTextColor();
  check('B2 자동(검정)은 el.textColor 를 지운다', !('textColor' in el('t3')), JSON.stringify(el('t3')));
  check('B3 자동(검정)은 DOM color 도 지운다', !content('t3').style.color);
  window.applyHighlight(null);
  check('B4 색 없음은 el.cellBg 를 지운다', !('cellBg' in el('t3')), JSON.stringify(el('t3')));
  check('B5 색 없음은 DOM background 도 지운다', !content('t3').style.backgroundColor);

  console.log('\n── C. 서식 지우기 → 화면/데이터 모두 정리 ───────');
  window.clearTextSelection(); window.deselectAll(true); window.clearMulti();
  clickBox(window, content('t4'));
  check('C1 서식 많은 구버전 상자가 선택된다', tb('t4').classList.contains('sel'));
  window.clearFmt();
  const e4 = el('t4'), c4 = content('t4');
  check('C2 HTML 은 줄바꿈만 남기는 평문이 된다', isPlainHtml(e4.html), e4.html);
  check('C3 box-level 색·배경·글꼴·굵기·기울임·밑줄 필드가 삭제된다',
    !('textColor' in e4) && !('cellBg' in e4) && !('font' in e4) && !('fontWeight' in e4) && !('fontStyle' in e4) && !('textDecoration' in e4), JSON.stringify(e4));
  check('C4 DOM 에도 box-level 색·배경·굵기·기울임·밑줄이 남지 않는다',
    !c4.style.color && !c4.style.backgroundColor && !c4.style.fontWeight && !c4.style.fontStyle && !c4.style.textDecoration,
    c4.getAttribute('style') || '');

  console.log('\n── D. 상자 전체 굵게 → 재선택 시 툴바 active ─────');
  window.clearTextSelection(); window.deselectAll(true); window.clearMulti();
  clickBox(window, content('t1'));
  pressToolbar(window, '.tb-bold');
  check('D1 상자 전체 굵게가 실제 HTML 에 들어간다', /font-weight:\s*(700|bold)/i.test(el('t1').html || ''), el('t1').html);
  window.clearTextSelection(); window.deselectAll(true); window.clearMulti();
  clickBox(window, content('t1'));
  window.syncCurSel();
  check('D2 다시 선택하면 툴바 굵게 버튼이 켜진다', document.querySelector('.tb-bold').classList.contains('active'));

  check('Z 치명적 런타임 오류 없음', errors.length === 0, errors.slice(0, 3).join(' / '));
  console.log(`\n텍스트 편집 엣지(무고정-sleep): PASS ${pass}`);
} catch (e) {
  console.error('FAIL: ' + (e && e.stack || e));
  if (log) console.error('server log:\n' + log.slice(-1600));
  throw e;
} finally {
  await closeDoms([dom]);
  try { child.kill('SIGTERM'); } catch {}
}
