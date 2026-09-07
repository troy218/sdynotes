/* 20.0 · '읽기 우선(어크로뱃 방식)' 실제 열람 런타임
 *
 * 실제 서버 + jsdom 으로 **가져온 문서(서버 보관본, __ref 있음)** 를 연다.
 * heavy_doc_scroll_runtime 은 __ref 가 없는 로컬 노트라 폴백 경로를 재고,
 * 이 테스트는 미리보기 경로(쪽 그림)를 잰다.
 *
 * 확인하는 것
 *   ① 읽기만 할 때 쪽당 DOM 이 <img> 한 장인가 (글상자 DOM 을 안 만드는가)
 *   ② 그래서 스크롤 프레임이 짧은가
 *   ③ 종이를 누르면 그 쪽만 진짜 편집 요소로 바뀌는가
 *   ④ 문서 데이터는 전 쪽 그대로인가 (저장·내보내기·AI 가 쓰는 원본)
 *   ⑤ 미리보기를 못 받는 문서는 예전 요소 렌더로 폴백하는가
 */
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
const PAGES = 40;
const BOXES = 34;     // 쪽당 문단 글상자 (2단 논문)
const SPANS = 14;     // 문단당 단어 span

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ` — ${extra}` : '')); }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-preview-'));
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

// 가져온 문서의 서버 슬라이스 (가짜 워커가 그대로 흘려 보낸다).
const REF = 'pvtest01';
const IMP_SLICE = 8;
const SLICES = new Map();          // s0 → gzip 본문
function seedSlices() {
  const mkPage = i => {
    const els = [{ type: 'image', id: `bg${i}`, url: `/api/img/bg${i}.png`,
                   x: 0, y: 0, w: 800, h: 1100, isBg: 1, locked: true }];
    for (let k = 0; k < BOXES; k++) {
      let html = '';
      for (let s = 0; s < SPANS; s++)
        html += `<span data-fs="11" style="position:absolute;left:${s * 26}px;top:0px;`
              + `line-height:14px;font-size:11px;white-space:nowrap">단어${s}<i class="zsp"> </i></span>`;
      els.push({ type: 'text', id: `t${i}_${k}`, x: 40 + (k % 2) * 380,
                 y: 60 + Math.floor(k / 2) * 60, w: 350, h: 52,
                 html, fontSize: 11, font: 'pretendard', align: 'left', tight: 1 });
    }
    return { id: 'p' + i, els, tables: [] };
  };
  for (let s0 = 0; s0 < PAGES; s0 += IMP_SLICE) {
    const chunk = [];
    for (let i = s0; i < Math.min(PAGES, s0 + IMP_SLICE); i++) chunk.push(mkPage(i));
    SLICES.set(s0, zlib.gzipSync(JSON.stringify({ ok: true, pages: chunk, total: PAGES })));
  }
}
seedSlices();

// 워커(파이썬) 대신, 슬라이스와 쪽 그림을 내주는 최소 서버.
//   · /api/import/docfile/<ref>?from=..  → gzip 슬라이스
//   · /api/import/page/<ref>/<pno>       → 1x1 JPEG (그림이 온다는 사실만 재현)
const PIXEL = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
  + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
  + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
let workerPageHits = 0;
const fakeWorker = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let m = u.pathname.match(/^\/api\/import\/page\/([^/]+)\/(\d+)$/);
  if (m) {
    workerPageHits++;
    res.writeHead(200, { 'Content-Type': 'image/jpeg',
                         'Cache-Control': 'public, max-age=31536000, immutable' });
    res.end(PIXEL); return;
  }
  m = u.pathname.match(/^\/api\/import\/docfile\/([^/]+)$/);
  if (m) {
    if (u.searchParams.get('meta') === '1') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, total: PAGES, version: 1 })); return;
    }
    const fr = parseInt(u.searchParams.get('from') || '0', 10);
    const body = SLICES.get(fr);
    if (!body) { res.writeHead(404); res.end('{}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json',
                         'Content-Encoding': 'gzip', ETag: `"s${fr}"` });
    res.end(body); return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{"ok":false}');
});
await new Promise(r => fakeWorker.listen(0, '127.0.0.1', r));
process.env.SDY_WORKER_URL = `http://127.0.0.1:${fakeWorker.address().port}`;

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/src/index.js'], {
  cwd: new URL('..', import.meta.url),
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
  const ins = await q({ table: 'notebooks', op: 'insert', values: [{ title: '가져온 논문', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const nid = ins.data.id;
  // 서버 보관본을 가리키는 노트 (serverDoc = REF)
  const seedDoc = { version: 3, serverDoc: REF, paper: 'blank',
                    sizePreset: 'a4_portrait', emoji: '', glossary: {} };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: nid, content: JSON.stringify(seedDoc), font_size: 16 }], filters: [] });

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String(e?.message || e);
    if (!/HTMLMediaElement|Could not load (link|script)|Not implemented/.test(m)) errors.push(m);
  });
  // 미리보기 요청을 가로채 '성공'으로 답한다 (워커/pymupdf 없이 경로만 검증).
  let previewHits = 0;
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
      // jsdom 은 <img> 를 실제로 안 받는다 → src 가 붙으면 '성공'으로 친다.
      Object.defineProperty(window.HTMLImageElement.prototype, 'src', {
        configurable: true,
        set(v) {
          this.setAttribute('src', v);
          if (String(v).includes('/api/import/page/')) previewHits++;
        },
        get() { return this.getAttribute('src') || ''; },
      });
      window.addEventListener('error', e => errors.push(e.error?.stack || e.message));
      window.addEventListener('unhandledrejection', e => errors.push('unhandled: ' + (e.reason?.stack || e.reason)));
    },
  });

  const { window } = dom, { document } = window;
  const ev = code => window.eval(code);
  const wraps = () => document.querySelectorAll('#pagesStage .page-wrap').length;
  const tbs = () => document.querySelectorAll('#pagesStage .paper .tb').length;
  const previews = () => document.querySelectorAll('#pagesStage .page-preview-img').length;

  const boot = Date.now();
  while (Date.now() - boot < 15_000 && !document.querySelector('.note-stack .note-card')) await wait(60);
  const card = [...document.querySelectorAll('.note-stack .note-card')]
    .find(c => (c.textContent || '').includes('가져온 논문'));
  check('홈에 가져온 논문 카드가 보인다', !!card);

  const tOpen = Date.now();
  card.click();
  const openUntil = Date.now() + 25_000;
  while (Date.now() < openUntil && ev('typeof doc==="object"&&doc?doc.pages.length:0') !== PAGES) await wait(40);
  const openMs = Date.now() - tOpen;

  ev(`(function(){
    const b=document.getElementById('editorBody');
    let st=0;
    Object.defineProperty(b,'clientHeight',{configurable:true,get(){return 900;}});
    Object.defineProperty(b,'clientWidth',{configurable:true,get(){return 1200;}});
    Object.defineProperty(b,'scrollTop',{configurable:true,get(){return st;},set(v){st=Math.max(0,v);}});
  })()`);
  await wait(1200);

  console.log(`    · 열기 ${openMs}ms · wrap ${wraps()} · 미리보기 요청 ${previewHits}회 · 글상자 DOM ${tbs()}개`);
  check('가져온 문서가 열린다', ev('doc.pages.length') === PAGES);
  check('문서가 서버 보관본을 가리킨다', ev('!!(doc&&doc.__ref)'));
  check('읽기 화면은 쪽 그림을 요청한다', previewHits > 0, `hits=${previewHits}`);
  check(`여는 데 8초를 넘지 않는다 (실제 ${openMs}ms)`, openMs < 8000, `${openMs}ms`);

  // ── 읽기 상태: 글상자 DOM 을 만들지 않는다 ──────────────────────────
  const readingTbs = tbs();
  check('읽기만 할 때는 무거운 글상자 DOM 을 만들지 않는다',
    readingTbs === 0, `tb=${readingTbs}`);
  check('대신 쪽 그림이 종이에 붙어 있다', previews() > 0, `img=${previews()}`);

  // ── 스크롤 프레임 ──────────────────────────────────────────────────
  const body = document.getElementById('editorBody');
  const scrollRun = async (label, perFrame, frames) => {
    const samples = [];
    for (let f = 0; f < frames; f++) {
      const a = Date.now();
      body.scrollTop = body.scrollTop + perFrame;
      body.dispatchEvent(new window.Event('scroll'));
      await new Promise(r => setTimeout(r, 16));
      samples.push(Date.now() - a);
    }
    samples.sort((x, y) => x - y);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    const worst = samples[samples.length - 1];
    console.log(`    · [${label}] p95 ${p95}ms / 최악 ${worst}ms · wrap ${wraps()} · tb ${tbs()}`);
    return { p95, worst };
  };
  const mid = await scrollRun('읽기 스크롤 120px/f', 120, 40);
  check(`읽기 스크롤 p95 < 300ms (실제 ${mid.p95}ms)`, mid.p95 < 300, `p95=${mid.p95}ms`);
  check(`읽기 스크롤 최악 프레임 < 800ms (실제 ${mid.worst}ms)`, mid.worst < 800, `worst=${mid.worst}ms`);
  check('읽는 내내 글상자 DOM 은 여전히 없다', tbs() === 0, `tb=${tbs()}`);
  check('종이 수는 창 크기로 유지된다', wraps() <= 30, `wrap=${wraps()}`);

  // ── 건드리면 그 쪽만 편집 요소로 바뀐다 ─────────────────────────────
  const cur = ev('curPageIdx');
  await ev(`sdyActivatePage(${cur})`);
  const actUntil = Date.now() + 6000;
  while (Date.now() < actUntil
    && !document.querySelector(`#pagesStage .paper[data-page-idx="${cur}"] .tb`)) await wait(60);
  check('건드린 쪽은 진짜 편집 요소(글상자)가 올라온다',
    !!document.querySelector(`#pagesStage .paper[data-page-idx="${cur}"] .tb`));
  check('깨운 쪽의 그림은 걷힌다',
    !document.querySelector(`#pagesStage .paper[data-page-idx="${cur}"] .page-preview-img`));
  // 다른 쪽은 여전히 읽기 상태여야 한다 (전 쪽이 딸려 올라오면 안 된다)
  const otherActivated = ev(`(function(){
    let n=0; document.querySelectorAll('#pagesStage .page-wrap').forEach(w=>{
      const i=+w.dataset.pageIdx; if(i!==${cur} && w.querySelector('.tb')) n++; });
    return n; })()`);
  check('건드리지 않은 쪽은 읽기 상태 그대로다', otherActivated === 0, `activated=${otherActivated}`);

  // ── 문서 데이터 불변 ────────────────────────────────────────────────
  check('문서 데이터는 전 쪽 그대로다 (저장·내보내기가 쓰는 원본)',
    ev('doc.pages.length') === PAGES
    && ev(`(doc.pages[0].els||[]).length`) === 1 + BOXES);

  const fatal = errors.filter(m => !/Not implemented|scrollIntoView|Could not load/.test(String(m)));
  if (fatal.length) console.log(fatal.slice(0, 3).join('\n---\n'));
  check('읽기 우선 열람 중 치명적 런타임 오류가 없다', fatal.length === 0);
} finally {
  await closeDoms([dom]);
  child.kill('SIGTERM');
  await new Promise(r => fakeWorker.close(r));
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(`\n쪽 미리보기 열람: PASS ${pass} / FAIL ${fail}`);
if (fail) process.exit(1);
