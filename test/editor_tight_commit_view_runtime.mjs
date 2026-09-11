/* 고정 글자(tight) 상자 — 편집 → 미리보기(읽기) 복귀 시 편집 확정 회귀
   사용자 보고: "고정글자에서 편집한 뒤 미리보기 모드로 돌아가면 편집 내용이
   반영되지 않고 사라진다. 형광펜을 칠한 경우에도 형광펜은 남는데 글자가
   어긋난 채로 있다."
   원인: 14.40 줄 흐름(.sdy-tl) 전환 후에도 단어 맞춤 큐가 빈 스팬 목록을
   '완료된 맞춤'으로 처리해 _applyTightFit 이 _sdyViewHtml 을 현재(편집된)
   DOM 으로 덮어썼다. 그 뒤 syncTextEl/commitEditingText 의 viewOnly 비교가
   항상 '같음'이 되어(수정 전 el.html 과 같은 취급) 타이핑·지우기가 모델로
   확정되지 않았고, 읽기 모드 재구성(_rebuildTightToReading → buildTextEl)이
   이전 el.html 로 되돌려 고친 글자가 사라졌다.
   jsdom 은 레이아웃이 없어 clientWidth 가 0 → 맞춤 큐가 원래 안 돌므로,
   실브라우저와 똑같이 '맞춤이 빈 스팬 목록을 완료 처리'하는 경로를 흉내내려
   .tb-content 의 clientWidth/clientHeight 를 실제 값으로 리턴하게 만든 뒤
   편집한다. (편집 전/후 어느 순간에 디바운스가 끼어도 결과는 같아야 한다.)
   14.45 · 읽기 복귀 시 줄 흐름(.sdy-tl)을 단어별 절대좌표 span 으로 역변환해
   저장·표시한다. 안 건드린 단어의 left/top/pdfW/pdfBase 는 원본과 동일해야
   하고, .sdy-tl/.sdy-tg 가 저장·화면에 남으면 안 된다. */
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import jsdom from 'jsdom';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { installWindowGuard, closeDoms } from './jsdom_guard.mjs';
const { JSDOM, VirtualConsole } = jsdom;

const wait = ms => new Promise(r => setTimeout(r, ms));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-commitview-'));
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
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}

function typeAt(win, content, text) {
  const doc = win.document;
  const sel = win.getSelection();
  let r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  if (!r || !content.contains(r.startContainer)) {
    r = doc.createRange(); r.selectNodeContents(content); r.collapse(false);
  }
  if (!r.collapsed) r.deleteContents();
  r.insertNode(doc.createTextNode(text));
  r.collapse(false);
  sel.removeAllRanges(); sel.addRange(r);
  content.dispatchEvent(new win.InputEvent('input', { bubbles: true }));
}
function textNodeOf(win, content, needle) {
  const tw = win.document.createTreeWalker(content, win.NodeFilter.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode())) if ((n.nodeValue || '').includes(needle)) return n;
  return null;
}
function selectSub(win, content, needle, from = 0, to = null) {
  const tn = textNodeOf(win, content, needle);
  assert.ok(tn, `잘못된 테스트 — '${needle}' 텍스트를 찾지 못했다`);
  const at = (tn.nodeValue || '').indexOf(needle) + from;
  const r = win.document.createRange();
  r.setStart(tn, at);
  r.setEnd(tn, at + (to == null ? needle.length : to - from));
  const s = win.getSelection();
  s.removeAllRanges(); s.addRange(r);
  win.saveSel();
  return r;
}

const word = (text, left, top, pdfW) =>
  `<span data-word="1" data-fs="20" data-pdf-w="${pdfW}" data-pdf-base="${top + 16}" ` +
  `style="position:absolute;left:${left}px;top:${top}px;font-size:20px;line-height:20px;white-space:nowrap;">${text}</span>`;
const row1 = word('alpha', 0, 0, 46) + word('beta', 60, 0, 38) + word('gamma', 120, 0, 48);
const row2 = word('delta', 0, 24, 44) + word('epsilon', 58, 24, 60) + word('zeta', 140, 24, 36);

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/src/index.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);
let dom, pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };
try {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died');
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }
  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '편집→미리보기 확정', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{
      id: 'p1', els: [
        { type: 'text', id: 't1', x: 40, y: 40, w: 260, h: 80, html: row1 + row2, fontSize: 16, tight: 1 },
      ],
    }],
  };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: id, content: JSON.stringify(doc0), font_size: 16 }], filters: [] });

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String(e?.message || e);
    if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errors.push(m);
  });
  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      installWindowGuard(window);
      Object.defineProperty(window.HTMLElement.prototype, 'contentEditable', {
        get() { const v = this.getAttribute('contenteditable'); return v == null ? 'inherit' : v; },
        set(v) { this.setAttribute('contenteditable', String(v)); },
        configurable: true, enumerable: true,
      });
      window.innerWidth = 1280; window.innerHeight = 800;
      window.matchMedia = query => ({ matches: query.includes('pointer:fine'), media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.BroadcastChannel = class { postMessage() {} close() {} addEventListener() {} };
      window.EventSource = class { close() {} addEventListener() {} };
      window.requestIdleCallback = cb => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
      window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}, save() {}, restore() {}, scale() {}, translate() {}, setTransform() {}, measureText() { return { width: 10 }; }, getImageData() { return { data: new Uint8ClampedArray(4) }; }, putImageData() {} });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class { constructor() { this.paused = true; } play() { return Promise.resolve(); } pause() {} addEventListener() {} removeEventListener() {} };
      window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
    },
  });

  const { window } = dom, { document } = window;
  const boot = Date.now();
  while (Date.now() - boot < 8_000 && document.querySelectorAll('.note-stack .note-card,.pro-grid .note-card').length < 1) await wait(60);
  const card = [...document.querySelectorAll('.note-stack .note-card,.pro-grid .note-card')].find(c => (c.textContent || '').includes('편집→미리보기 확정'));
  assert.ok(card, '노트 카드가 보인다');
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1600);

  const tb = document.querySelector('#pagesStage .tb[data-id="t1"]');
  const c = tb && tb.querySelector('.tb-content');
  check('고정 글자 상자가 그려진다', !!c && tb.classList.contains('tight'));

  // 실브라우저처럼 레이아웃 값이 있는 것처럼 — 이 상태에서 맞춤 큐가
  // '빈 스팬 목록 = 완료된 맞춤'을 내고 _applyTightFit 을 태우던 경로를 재현한다.
  Object.defineProperty(c, 'clientWidth', { get: () => 236, configurable: true });
  Object.defineProperty(c, 'clientHeight', { get: () => 80, configurable: true });

  const modelHas = s => (String((window.findEl(0, 't1') || {}).html || '')).includes(s);
  const readText = () => {
    const tbR = document.querySelector('#pagesStage .tb[data-id="t1"]');
    return tbR ? (tbR.querySelector('.tb-content') || {}).textContent || '' : '';
  };
  // 14.45 · 단어 절대좌표 저장 단언 도우미
  const spanOf = (h, t) => {
    const i = h.indexOf('>' + t + '<');
    if (i < 0) return null;
    const s = h.lastIndexOf('<span', i);
    return s < 0 ? null : h.slice(s, i + 1);
  };
  const hasGeom = (h, t, l, tp, w, b) => {
    const s = spanOf(h, t);
    return !!s && new RegExp('left:\\s*' + l + 'px').test(s)
      && new RegExp('top:\\s*' + tp + 'px').test(s)
      && s.includes('data-pdf-w="' + w + '"') && s.includes('data-pdf-base="' + b + '"');
  };
  const spanLeft = (h, t) => {
    const s = spanOf(h, t);
    const m = s && s.match(/left:\s*([0-9.]+)px/);
    return m ? parseFloat(m[1]) : null;
  };
  const enterEdit = () => {
    const tbN = document.querySelector('#pagesStage .tb[data-id="t1"]');
    const cN = tbN.querySelector('.tb-content');
    const cw = cN.clientWidth, ch = cN.clientHeight;   // 재빌드 후에도 mock 유지
    Object.defineProperty(cN, 'clientWidth', { get: () => cw || 236, configurable: true });
    Object.defineProperty(cN, 'clientHeight', { get: () => ch || 80, configurable: true });
    cN.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    return { tbN, cN };
  };

  // ① 1회차 — beta → BETA1 (기존 글자 지우고 새 글자 넣기)
  let cur = enterEdit();
  await wait(160);
  check('① 편집 모드 진입 + 줄 흐름 변환', cur.tbN.classList.contains('edit')
    && cur.cN.querySelectorAll(':scope>.sdy-tl').length === 2);
  selectSub(window, cur.cN, 'beta', 0, 4);
  typeAt(window, cur.cN, 'BETA1');
  await wait(500);   // syncTextEl 디바운스보다 충분히
  check('① 편집이 모델(el.html)로 확정된다(사라지지 않는다)', modelHas('BETA1'));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(400);
  check('① 미리보기(읽기) 복귀 후 화면에 편집 내용이 남는다',
    !document.querySelector('.tb.edit') && readText().includes('BETA1'));
  // 14.45 · 읽기 복귀 시 원본 미리보기 형식(단어 절대좌표 span) 복원
  check('① 미리보기 화면이 단어 절대좌표로 복원된다(줄 흐름 잔류 없음)',
    document.querySelectorAll('#pagesStage .tb[data-id="t1"] .tb-content > .sdy-tl').length === 0
    && document.querySelectorAll('#pagesStage .tb[data-id="t1"] .tb-content > span[data-pdf-w]').length === 6);
  {
    const h1 = String((window.findEl(0, 't1') || {}).html || '');
    check('① 저장 모델이 단어 절대좌표로 복원된다(줄 흐름·간격 잔류 없음)',
      !h1.includes('sdy-tl') && !h1.includes('sdy-tg') && h1.includes('data-pdf-w'));
    check('① 안 건드린 단어(alpha·gamma·delta·epsilon·zeta) 좌표가 그대로다',
      hasGeom(h1, 'alpha', 0, 0, 46, 16) && hasGeom(h1, 'gamma', 120, 0, 48, 16)
      && hasGeom(h1, 'delta', 0, 24, 44, 40) && hasGeom(h1, 'epsilon', 58, 24, 60, 40)
      && hasGeom(h1, 'zeta', 140, 24, 36, 40));
    check('① 고친 단어(BETA1)는 beta 자리(left 60)에 들어간다',
      spanLeft(h1, 'BETA1') === 60 && !h1.includes('beta'));
  }

  // ② 2회차 — gamma → GAMMA2, 다시 미리보기
  cur = enterEdit();
  await wait(160);
  check('② 두 번째 편집 진입에도 고친 내용이 보인다',
    cur.tbN.classList.contains('edit') && (cur.cN.textContent || '').includes('BETA1'));
  selectSub(window, cur.cN, 'gamma', 0, 5);
  typeAt(window, cur.cN, 'GAMMA2');
  await wait(500);
  check('② 두 번째 편집도 모델로 확정된다', modelHas('GAMMA2') && modelHas('BETA1'));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(400);
  check('② 다시 미리보기로 돌아가도 두 편집이 모두 남는다',
    readText().includes('GAMMA2') && readText().includes('BETA1'));
  {
    const h1b = String((window.findEl(0, 't1') || {}).html || '');
    check('② 저장 모델이 단어 절대좌표로 유지된다',
      !h1b.includes('sdy-tl') && !h1b.includes('sdy-tg') && h1b.includes('data-pdf-w'));
    check('② 첫 편집(BETA1)·안 건드린 단어(alpha) 좌표가 그대로다',
      spanLeft(h1b, 'BETA1') === 60 && hasGeom(h1b, 'alpha', 0, 0, 46, 16));
    check('② 두 번째 고친 단어(GAMMA2)는 gamma 자리(left 120)에 들어간다',
      spanLeft(h1b, 'GAMMA2') === 120 && !h1b.includes('gamma'));
  }

  const fatal = errors.filter(e => !/isTrBusy|undefined is not an object/.test(String(e)));
  check('치명적 런타임 오류가 없다', fatal.length === 0);
  if (fatal.length) console.log(fatal.slice(0, 3).join('\n---\n'));
  console.log(`\n고정 글자 편집→미리보기 확정: PASS ${pass} / FAIL 0`);
} catch (e) {
  console.error('\n고정 글자 편집→미리보기 확정 실패:', e && (e.stack || e.message || String(e)));
  if (log) console.error('server log:\n' + log.slice(-1500));
  process.exitCode = 1;
} finally {
  await wait(80);
  await closeDoms([dom]);
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  fs.rmSync(TMP, { recursive: true, force: true });
}
