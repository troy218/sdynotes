/* 14.39.3 · "이미지를 이동하려고 선택하면 주변 수식이 사라짐" (사용자 보고) 런타임 계약
 *
 * 재현: 사진을 한 번 눌러 선택하는 순간 _layerLift 가 image 층(.layer-img)을
 * 통째로 z=50 으로 띄웠다. 그 층에는 (옛 구조에서) PDF 원본 배경 래스터(isBg)와
 * 흰 바탕 수식 조각(isMath, background:#fff)까지 같이 들어 있어서,
 *   ① 사진과 겹친 글자·KaTeX 수식이 그림 뒤에 숨고
 *   ② 원본 배경·수식 조각이 글자·수식 위로 떠올라 주변이 통째로 가렸다.
 * 이동이 끝나도 선택이 남아 있는 동안 가림이 유지됐다.
 *
 * 고친 것(이 테스트가 잠그는 계약):
 *   ① PDF 원본 배경·수식 조각은 '가구 층' .layer-fig 에 그린다 — 선택 끌어올림과
 *      완전히 무관하게 항상 글자(.layer-text) 아래에 있다.
 *   ② .layer-img 는 실제로 끌거나(sdy-dragging) 크기를 조절하는(sdy-resizing)
 *      동안에만 앞으로 온다. 선택만으로는 절대 올리지 않는다.
 *   ③ 따라서 사진을 선택·이동하는 내내 글상자·KaTeX 수식·인라인 수식은
 *      제 자리에 그대로 있고, 문서 데이터도 그대로다.
 */
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import jsdom from 'jsdom';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import http from 'node:http';
import { installWindowGuard, closeDoms } from './jsdom_guard.mjs';
const { JSDOM, VirtualConsole } = jsdom;

const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0;
const check = (name, cond, extra = '') => {
  assert.ok(cond, name + (extra ? ` — ${extra}` : ''));
  pass++; console.log('  ✓ ' + name);
};

const PAGES = 2;
const REF = 'imgselmath01';
let savedImportPost = null;   // 클라이언트가 POST /api/import/docfile 로 저장한 편집 쪽

// ── 가짜 워커: 가져온 문서 슬라이스 + 쪽 그림 ─────────────────────────
const SLICES = new Map();
function seedSlices() {
  const mkPage = i => ({
    id: 'p' + i,
    els: [
      // 종이 가구: 원본 배경 래스터 + 흰 바탕 수식 조각 (이동 불가 · pointer-events:none)
      { type: 'image', id: `bg${i}`, url: `/api/img/bg${i}.png`, x: 0, y: 0, w: 800, h: 1100, isBg: 1, locked: true },
      { type: 'image', id: `mf${i}_a`, url: `/api/img/mf${i}a.png`, x: 110, y: 200, w: 190, h: 54, isMath: 1, locked: true },
      { type: 'image', id: `mf${i}_b`, url: `/api/img/mf${i}b.png`, x: 120, y: 470, w: 210, h: 60, isMath: 1, locked: true },
      // 주변 수식: KaTeX 상자 2개 + 문장 안 인라인 수식
      { type: 'latex', id: `m${i}_a`, latex: 'E=mc^2', x: 120, y: 280, w: 220, h: 50, fontSize: 20 },
      { type: 'latex', id: `m${i}_b`, latex: '\\int_0^1 x^2\\,dx', x: 430, y: 430, w: 260, h: 60, fontSize: 22, displayMath: 1 },
      { type: 'text', id: `t${i}_inline`, x: 90, y: 90, w: 420, h: 40, fontSize: 14,
        html: '문장 안 수식 <span class="imath" data-latex="a^2+b^2=c^2">$a^2+b^2=c^2$</span> 테스트' },
      // 사용자가 옮기려고 선택할 사진 (수식들 바로 옆·일부 겹침)
      { type: 'image', id: `ph${i}`, url: '/api/img/photo.png', x: 330, y: 180, w: 200, h: 140 },
    ],
    tables: [],
  });
  for (let s0 = 0; s0 < PAGES; s0 += 8) {
    const chunk = [];
    for (let i = s0; i < Math.min(PAGES, s0 + 8); i++) chunk.push(mkPage(i));
    SLICES.set(s0, zlib.gzipSync(JSON.stringify({ ok: true, pages: chunk, total: PAGES })));
  }
}
seedSlices();

const PIXEL = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
  + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
  + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
const fakeWorker = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let m = u.pathname.match(/^\/api\/import\/page\/([^/]+)\/(\d+)$/);
  if (m) { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(PIXEL); return; }
  m = u.pathname.match(/^\/api\/import\/docfile\/([^/]+)$/);
  if (m && req.method === 'POST') {
    // 편집된 쪽의 '진짜' 저장 경로(가져온 문서 슬라이스 저장) — 본문을 기록해 둔다.
    let body = '';
    req.on('data', b => body += b);
    req.on('end', () => {
      try { savedImportPost = JSON.parse(body); } catch (e) { savedImportPost = null; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, version: 2 }));
    });
    return;
  }
  if (m) {
    if (u.searchParams.get('meta') === '1') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, total: PAGES, version: 1 })); return;
    }
    const fr = parseInt(u.searchParams.get('from') || '0', 10);
    const body = SLICES.get(fr);
    if (!body) { res.writeHead(404); res.end('{}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', ETag: `"s${fr}"` });
    res.end(body); return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{"ok":false}');
});
await new Promise(r => fakeWorker.listen(0, '127.0.0.1', r));
process.env.SDY_WORKER_URL = `http://127.0.0.1:${fakeWorker.address().port}`;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-imgsel-'));
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
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let slog = '';
child.stdout.on('data', b => slog += b); child.stderr.on('data', b => slog += b);

let dom = null;
const errors = [];
try {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died: ' + slog);
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }
  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const ins = await q({ table: 'notebooks', op: 'insert', values: [{ title: '그림선택수식', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const nid = ins.data.id;
  const seedDoc = { version: 3, serverDoc: REF, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {} };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: nid, content: JSON.stringify(seedDoc), font_size: 16 }], filters: [] });

  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = String(e?.message || e); if (!/HTMLMediaElement|Could not load (link|script)|Not implemented/.test(m)) errors.push(m); });
  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      installWindowGuard(window);
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
      Object.defineProperty(window.HTMLImageElement.prototype, 'src', {
        configurable: true,
        set(v) { this.setAttribute('src', v); },
        get() { return this.getAttribute('src') || ''; },
      });
      window.addEventListener('error', e => errors.push(e.error?.stack || e.message));
      window.addEventListener('unhandledrejection', e => errors.push('unhandled: ' + (e.reason?.stack || e.reason)));
    },
  });

  const { window } = dom, { document } = window;
  const ev = code => window.eval(code);
  const $$ = s => [...document.querySelectorAll(s)];

  // ── 열기 ────────────────────────────────────────────────────────────
  const boot = Date.now();
  while (Date.now() - boot < 15_000 && !document.querySelector('.note-stack .note-card')) await wait(60);
  const card = [...document.querySelectorAll('.note-stack .note-card')].find(c => (c.textContent || '').includes('그림선택수식'));
  check('홈에 노트 카드가 보인다', !!card);
  card.click();
  const openUntil = Date.now() + 25_000;
  while (Date.now() < openUntil && ev('typeof doc==="object"&&doc?doc.pages.length:0') !== PAGES) await wait(40);
  check('가져온 문서가 열린다', ev('doc.pages.length') === PAGES);
  ev(`(function(){
    const b=document.getElementById('editorBody');
    Object.defineProperty(b,'clientHeight',{configurable:true,get(){return 900;}});
    Object.defineProperty(b,'clientWidth',{configurable:true,get(){return 1200;}});
    let st=0; Object.defineProperty(b,'scrollTop',{configurable:true,get(){return st;},set(v){st=Math.max(0,v);}});
  })()`);
  // 0번 쪽이 그려질 때까지 (청크 렌더 — 수식 상자 2개가 모두 올라올 때까지 기다린다)
  const rUntil = Date.now() + 15_000;
  while (Date.now() < rUntil && $$('#pagesStage .paper[data-page-idx="0"] .latex-box').length < 2) await wait(60);
  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  check('0번 쪽에 요소가 그려진다', !!paper && $$('#pagesStage .paper[data-page-idx="0"] .latex-box').length >= 2);
  // jsdom 좌표계: 종이 사각형을 (0,0,800,1100) 으로 고정 → 문서 px == client px
  paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });
  await wait(400);

  // ── ① 가구 층 분리: 원본 배경·수식 조각은 .layer-fig, 사진은 .layer-img ──
  const fig = paper.querySelector('.layer-fig');
  const imgL = paper.querySelector('.layer-img');
  check('종이 셸에 가구 층(.layer-fig)이 있다', !!fig);
  check('가구 층은 미리보기 위·글자 아래 순서로 놓인다',
    fig && imgL && fig.nextElementSibling === imgL
    && !!(fig.previousElementSibling && fig.previousElementSibling.classList.contains('layer-preview')));
  check('PDF 원본 배경은 가구 층에 그려진다',
    !!fig.querySelector('.paper-img.pdf-bg[data-id="bg0"]'));
  check('PDF 수식 조각(isMath)은 가구 층에 그려진다',
    fig.querySelectorAll('.paper-img.math').length === 2);
  check('사진은 이미지 층(.layer-img)에 그려진다',
    !!imgL.querySelector('.paper-img[data-id="ph0"]'));
  check('가구 층에는 사진이 없다', !fig.querySelector('[data-id="ph0"]'));
  check('KaTeX 수식 상자는 글자 층에 그려진다',
    paper.querySelectorAll('.layer-text .latex-box').length === 2);

  // ── ② 사진을 '선택'만 해도 층이 올라가지 않는다 ─────────────────────
  const im = imgL.querySelector('.paper-img[data-id="ph0"]');
  check('사진 노드가 있다', !!im);
  const tap = (x, y) => im.dispatchEvent(new window.MouseEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: x, clientY: y, isPrimary: true }));
  const lift = (x, y) => document.dispatchEvent(new window.MouseEvent('pointerup', {
    bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: x, clientY: y, isPrimary: true }));

  tap(430, 250);                                   // 사진 한 번 누르기 = 선택
  await wait(300);                                  // lift 관찰자의 rAF 한 프레임
  check('1차 탭으로 사진이 선택된다', im.classList.contains('sel'));
  check('선택만으로는 이미지 층이 올라가지 않는다 (버그 본체)',
    imgL.style.zIndex !== '50', `z=${imgL.style.zIndex || '(없음)'}`);
  check('선택만으로 가구 층이 올라가지 않는다',
    fig.style.zIndex !== '50' && fig.style.zIndex !== '51', `z=${fig.style.zIndex || '(없음)'}`);
  check('선택 후에도 수식 상자 2개가 그대로 있다',
    $$('#pagesStage .paper[data-page-idx="0"] .latex-box').length === 2);
  check('선택 후에도 문장 안 인라인 수식이 그대로 있다',
    $$('#pagesStage .paper[data-page-idx="0"] span.imath[data-latex]').length >= 1);

  // ── ③ 이동(드래그)하는 동안엔 이미지 층이 올라간다 ──────────────────
  tap(430, 250);                                   // 선택된 사진을 다시 누르기 = 이동 시작
  await wait(120);
  document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: 480, clientY: 300, isPrimary: true }));
  await wait(200);
  check('끄는 동안에는 이미지 층이 앞으로 온다 (그림이 보이게)',
    imgL.style.zIndex === '50', `z=${imgL.style.zIndex || '(없음)'}`);
  check('끄는 동안에도 가구 층은 제자리다 (배경·수식 조각이 뜨지 않는다)',
    fig.style.zIndex !== '50' && fig.style.zIndex !== '51', `z=${fig.style.zIndex || '(없음)'}`);
  check('끄는 동안에도 수식 상자가 DOM 에 남는다',
    $$('#pagesStage .paper[data-page-idx="0"] .latex-box').length === 2);
  lift(480, 300);
  await wait(400);
  check('손을 떼면 이미지 층이 내려온다 (수식이 다시 그림 위로)',
    imgL.style.zIndex !== '50', `z=${imgL.style.zIndex || '(없음)'}`);
  check('이동이 문서 데이터에 반영된다', (() => {
    const el = ev('doc.pages[0].els.find(e=>e.id==="ph0")');
    return el && (el.x !== 330 || el.y !== 180);
  })());

  // ── ④ 문서 데이터는 수식을 잃지 않는다 ─────────────────────────────
  //   가져온 문서는 편집 쪽을 POST /api/import/docfile 로 저장한다(메모 본문이 아님).
  check('이동한 쪽이 편집(dirty) 표시다', ev('!!doc.pages[0].__dirty'));
  const sUntil = Date.now() + 8000;
  while (Date.now() < sUntil && !savedImportPost) await wait(120);
  let latexInDoc = -1, mathCropInDoc = -1, photoInDoc = null;
  try {
    const els0 = ((savedImportPost || {}).pages || [])[0].els || [];
    latexInDoc = els0.filter(e => e.type === 'latex').length;
    mathCropInDoc = els0.filter(e => e.type === 'image' && e.isMath).length;
    const ph = els0.find(e => e.id === 'ph0');
    if (ph) photoInDoc = { x: ph.x, y: ph.y };
  } catch (e) { errors.push('import-save parse: ' + e.message); }
  check('이동·저장을 거쳐도 문서의 KaTeX 수식이 유지된다', latexInDoc === 2, `latex=${latexInDoc}`);
  check('이동·저장을 거쳐도 문서의 수식 조각이 유지된다', mathCropInDoc === 2, `math=${mathCropInDoc}`);
  check('저장 본문의 사진도 옮겨진 자리다', !!photoInDoc && (photoInDoc.x !== 330 || photoInDoc.y !== 180),
    JSON.stringify(photoInDoc));

  // ── ⑤ 다른 쪽(1쪽)도 같은 구조다 ───────────────────────────────────
  ev(`(function(){
    const p=document.querySelector('#pagesStage .paper[data-page-idx="1"]');
    if(p) p.getBoundingClientRect=()=>({left:0,top:0,right:800,bottom:1100,width:800,height:1100,x:0,y:0});
  })()`);
  const p1 = document.querySelector('#pagesStage .paper[data-page-idx="1"]');
  if (p1 && p1.querySelector('.layer-fig')) {
    check('1쪽 가구 층에도 배경·수식 조각이 그려진다',
      !!p1.querySelector('.layer-fig .paper-img.pdf-bg')
      && p1.querySelectorAll('.layer-fig .paper-img.math').length === 2);
  } else {
    console.log('  · 1쪽은 아직 그려지지 않음(가상화) — 건너뜀');
  }

  check('런타임 치명 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`\n그림 선택·수식 유지 런타임: PASS ${pass}`);
} catch (e) {
  console.error('\n✗ FAIL:', e && e.message);
  if (errors.length) console.error('page errors:', errors.slice(0, 5));
  console.error('server log tail:', slog.slice(-400));
  try { await closeDoms(dom ? [dom] : []); } catch {}
  child.kill('SIGTERM'); fakeWorker.close();
  process.exit(1);
} finally {
  await closeDoms(dom ? [dom] : []);
  child.kill('SIGTERM');
  fakeWorker.close();
}
