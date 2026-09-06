/* 22.1 · '글상자를 누르는 순간' 렉 제거 — 실제 열람 런타임 검증
 *
 * 똥컴 경량 모드(sdy_lowend=1)로 무거운 노트를 열고, 글상자를 골라 편집에
 * 들어간 뒤 한 글자를 치는 동안 실제로 어떤 일이 일어나는지 잰다.
 *
 *   ① 쪽을 그릴 때 글상자 장식(테두리·손잡이)을 만들지 않는다 — 상자를 고르는
 *      순간에만 그 상자 것만 12개가 생긴다
 *   ② 편집 진입(더블클릭) 동작용지에서 문서 전체 JSON 스냅샷을 만들지 않는다
 *   ③ 되돌리기 기록은 '그 상자' 패치고, Ctrl+Z / 다시 실행이 실제로 글자가
 *      되돌아간다 (속도만 내고 동작이 깨지면 안 된다)
 *   ④ 편집 중 가만히 있으면 저장이 되풀이되지 않는다 (오토세이브 에코 루프 차단)
 *   ⑤ 편집 중 실시간 커서 ping 이 40ms 진동이 아니라 경량 모드 간격으로 흐른다
 *   ⑥ 선택 해제가 '모든 글상자'를 훑지 않는다
 *
 * 실행: node test/editor_edit_lag_runtime.mjs
 */
import net from 'node:net';
import { spawn } from 'node:child_process';
import jsdom from 'jsdom';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { installWindowGuard, closeDoms } from './jsdom_guard.mjs';
const { JSDOM, VirtualConsole } = jsdom;

const wait = ms => new Promise(r => setTimeout(r, ms));
const PAGES = 5;
const BOXES = 140;            // 쪽당 글상자 — 장식 노드는 ×12 배로 늘어난다

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ` — ${extra}` : '')); }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-editlag-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css'])
    fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
}
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
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);

let dom = null;
try {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died: ' + log);
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }
  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const ins = await q({ table: 'notebooks', op: 'insert',
    values: [{ title: '편집 렉 확인', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const nid = ins.data.id;
  const pages = [];
  for (let i = 0; i < PAGES; i++) {
    const els = [];
    for (let k = 0; k < BOXES; k++) {
      els.push({ type: 'text', id: `t${i}_${k}`, x: 40 + (k % 2) * 380, y: 20 + k * 6, w: 360, h: 5,
                 html: `글상자 ${i}-${k} 내용`, fontSize: 11, font: 'pretendard', align: 'left' });
    }
    pages.push({ id: 'p' + i, els, tables: [] });
  }
  const doc0 = { version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {}, pages };
  await q({ table: 'memos', op: 'insert',
    values: [{ notebook_id: nid, content: JSON.stringify(doc0), font_size: 16 }], filters: [] });

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String(e?.message || e);
    if (!/HTMLMediaElement|Could not load (link|script)|Not implemented/.test(m)) errors.push(m);
  });
  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      installWindowGuard(window);
      window.innerWidth = 1280; window.innerHeight = 800;
      // 똥컴 강제 — 이 최적화는 저사양 판정에서 더 강하게 걸린다
      try { window.localStorage.setItem('sdy_lowend', '1'); } catch {}
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
      // jsdom 은 contentEditable 프로퍼티를 contenteditable 속성에 반영하지 않는다
      Object.defineProperty(window.HTMLElement.prototype, 'contentEditable', {
        get() { const v = this.getAttribute('contenteditable'); return v == null ? 'inherit' : v; },
        set(v) { this.setAttribute('contenteditable', String(v)); },
        configurable: true, enumerable: true,
      });
      window.__m = { measure: false, docSnap: 0, ping: 0, persist: 0, contentScan: 0 };
      const rawStr = window.JSON.stringify.bind(window.JSON);
      window.JSON.stringify = function (v, r, s) {
        if (window.__m.measure && v && typeof v === 'object' && Array.isArray(v.pages) && v.version) window.__m.docSnap++;
        return rawStr(v, r, s);
      };
      const rawQSA = window.Document.prototype.querySelectorAll;
      window.Document.prototype.querySelectorAll = function (sel) {
        if (window.__m.measure && String(sel).indexOf('#pagesStage .tb-content') >= 0) window.__m.contentScan++;
        return rawQSA.call(this, sel);
      };
      window.addEventListener('error', e => errors.push(e.error?.stack || e.message));
      window.addEventListener('unhandledrejection', e => errors.push('unhandled: ' + (e.reason?.stack || e.reason)));
    },
  });

  const { window } = dom, { document } = window;
  const ev = code => window.eval(code);
  const M = () => window.__m;
  const reset = () => { const m = M(); m.docSnap = 0; m.ping = 0; m.persist = 0; m.contentScan = 0; };

  const boot = Date.now();
  while (Date.now() - boot < 15_000 && !document.querySelector('.note-stack .note-card')) await wait(60);
  const card = [...document.querySelectorAll('.note-stack .note-card')].find(c => (c.textContent || '').includes('편집 렉 확인'));
  check('똥컴 판정(body.sdy-turbo)으로 시작한다', document.body.classList.contains('sdy-turbo'));
  card.click();
  const openUntil = Date.now() + 25_000;
  while (Date.now() < openUntil && !document.querySelector('#pagesStage .tb')) await wait(50);

  // 페이로드 계측용 감쌈 (앱은 최상위 function 선언을 이름으로 부른다 → 창 교체로 계측된다)
  ev(`(function(){
    window.__m.persist = 0;
    const o = window.persistDoc;
    window.persistDoc = function(){ window.__m.persist++; return o.apply(this, arguments); };
    const f = window.fetch;
    window.fetch = function(u, i){
      try { if (String(u).indexOf('/api/live/ping') >= 0) window.__m.ping++; } catch(e){}
      return f.apply(this, arguments);
    };
  })()`);

  const tbs = () => document.querySelectorAll('#pagesStage .tb').length;
  const chrome = () => document.querySelectorAll('#pagesStage .tb .handle').length
                      + document.querySelectorAll('#pagesStage .tb .tb-edge').length;
  { // 청크 렌더(똥컴은 프레임당 24개)가 끝날 때까지 기다린다
    const renderUntil = Date.now() + 15_000;
    while (Date.now() < renderUntil && tbs() < 100) await wait(100);
  }
  check('무거운 쪽이 그려진다', tbs() >= 100, `tb=${tbs()}`);
  check('① 쪽을 그릴 때 글상자 장식은 하나도 만들지 않는다', chrome() === 0, `chrome=${chrome()} / tb=${tbs()}`);

  const paper0 = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  paper0.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });
  const mk = (type, detail) => {
    const E = type.startsWith('pointer') ? (window.PointerEvent || window.MouseEvent) : window.MouseEvent;
    return new E(type, { bubbles: true, cancelable: true, button: 0, detail, clientX: 60, clientY: 60 });
  };
  const tb = document.querySelector('#pagesStage .tb[data-id="t0_3"]');
  const content = tb.querySelector('.tb-content');
  const before = ev(`JSON.stringify({html:findEl(0,'t0_3').html, before:1})`);

  // ── ② 상자를 고른다 → 장식은 그 상자만 ─────────────────────────────
  reset(); M().measure = true;
  content.dispatchEvent(mk('pointerdown', 1));
  content.dispatchEvent(mk('mousedown', 1));
  document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 60, clientY: 60 }));
  const selectScan = M().contentScan;
  M().measure = false;
  await wait(150);
  check('① 고른 상자에만 장식 12개(테두리 4 + 손잡이 8)가 붙는다',
    tb.querySelectorAll(':scope > .handle').length === 8 && tb.querySelectorAll(':scope > .tb-edge').length === 4,
    `handle=${tb.querySelectorAll('.handle').length} edge=${tb.querySelectorAll('.tb-edge').length}`);
  check('① 다른 상자는 여전히 장식 없이 가볍다', chrome() === 12, `chrome=${chrome()}`);
  check('⑥ 선택 해제가 모든 글상자를 훑지 않는다', selectScan === 0, `scan=${selectScan}`);

  // ── ③ 편집 진입 — 문서 통째 스냅샷이 없어야 한다 ────────────────────
  reset(); M().measure = true;
  content.dispatchEvent(mk('pointerdown', 2));
  content.dispatchEvent(mk('mousedown', 2));
  document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 60, clientY: 60 }));
  const snapAtEdit = M().docSnap;
  M().measure = false;
  check('글상자를 더블클릭하면 편집이 켜진다', !!document.querySelector('#pagesStage .tb.edit'));
  check('② 편집 진입 동작용지에서 문서 전체 스냅샷을 만들지 않는다', snapAtEdit === 0, `docSnap=${snapAtEdit}`);

  // ── ④ 되돌리기 기록은 '그 상자' 패치 + 실제로 되돌아간다 ───────────
  const hist0 = ev('history.length');
  content.appendChild(document.createTextNode('추가'));
  content.dispatchEvent(new window.InputEvent('input', { bubbles: true }));
  await wait(420);        // syncTextEl 의 300ms 디바운스가 지난 뒤에 문서 데이터를 본다
  const top = ev(`(function(){
      const e = history[history.length - 1];
      if (!e) return null;
      const p = e.patch || null;
      return JSON.stringify({ t: !!(p && p.__sdyEdit === 1), nosnap: !e.snap, pi: p && p.pi, id: p && p.id,
                              len: JSON.stringify(e).length, html: p && p.before && p.before.html });
    })()`);
  check('③ 첫 타이핑 때 되돌리기 기록이 쌓인다', ev('history.length') > hist0, `n=${ev('history.length')} old=${hist0}`);
  const patchEntry = top ? JSON.parse(top) : null;
  check('③ 기록은 문서 통째가 아니라 글상자 패치다',
    !!(patchEntry && patchEntry.t === true && patchEntry.nosnap === true
       && patchEntry.id === 't0_3' && patchEntry.pi === 0), String(top));
  check('③ 기록 크기가 상자 하나 분량이다 (문서 전체 직렬화가 아니다)',
    !!patchEntry && patchEntry.len < 4096, `len=${patchEntry && patchEntry.len}`);
  // 20.3 의 '타자 쉬면 새 되돌리기 지점' 체크포인트도 같은 패치를 쓴다 —
  //   편집 중 1.2초마다 문서 통째 직렬화가 돌면 렉이 그대로 살아 있는 셈이다.
  ev('markEditSnapshot()');
  const ckSnap = (M().measure = true, M().docSnap, ev('markEditSnapshot()'), M().docSnap);
  M().measure = false;
  check('③ 타이핑 체크포인트도 문서 전체를 직렬화하지 않는다', ckSnap[1] === ckSnap[0], `docSnap=${ckSnap[1]-ckSnap[0]}`);
  check('③ 체크포인트가 기억하는 것도 편집 상자 패치다', ev(`!!(_editSnap && _editSnap.__sdyEdit === 1 && _editSnap.id === 't0_3')`));
  check('③ 패치 이후 문서 데이터에 입력이 반영됐다',
    ev(`findEl(0,'t0_3').html`).includes('추가'), ev(`findEl(0,'t0_3').html`).slice(0, 40));
  ev('undo()');
  await wait(220);
  check('③ Ctrl+Z(되돌리기)가 방금 적은 글자를 되돌린다',
    !ev(`findEl(0,'t0_3').html`).includes('추가') && ev(`findEl(0,'t0_3').html`) === JSON.parse(before).html,
    ev(`findEl(0,'t0_3').html`).slice(0, 40));
  ev('redo()');
  await wait(220);
  check('③ 다시 실행하면 적었던 글자가 돌아온다', ev(`findEl(0,'t0_3').html`).includes('추가'),
    ev(`findEl(0,'t0_3').html`).slice(0, 40));

  // ── ⑤ 편집 중 가만히 → 저장이 반복되지 않는다 ───────────────────────
  await wait(700);                                   // 앞서 예약된 저장은 흘려보낸다
  reset();
  await wait(1600);
  check('④ 편집 중 아무것도 치지 않으면 저장이 되풀이되지 않는다', M().persist === 0, `persist=${M().persist}`);
  check('⑤ 편집 중 실시간 커서 ping 이 40ms 진동으로 돌지 않는다',
    M().ping <= 6, `ping=${M().ping} / 1.6s`);
  check('⑤ 그래도 실시간 공유는 살아 있다 (ping 이 아예 멈추면 안 된다)', M().ping >= 1, `ping=${M().ping}`);

  const fatal = errors.filter(m => !/Not implemented|scrollIntoView|Could not load/.test(String(m)));
  if (fatal.length) console.log(fatal.slice(0, 3).join('\n---\n'));
  check('편집·되돌리기 런타임 오류가 없다', fatal.length === 0);
} finally {
  await closeDoms([dom]);
  child.kill('SIGTERM');
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(`\n편집 진입 렉 제거 런타임: PASS ${pass} / FAIL ${fail}`);
if (fail) process.exit(1);
