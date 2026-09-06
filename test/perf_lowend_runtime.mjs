/* 22.0 · '똥컴 경량 모드' 실제 열람 런타임
 *
 * page_preview_runtime 을 'sdy_lowend=1 강제' 상태로 돌린다.
 * 확인하는 것
 *   ① body.sdy-turbo 가 자동으로 붙는다 (판정 → CSS/JS 협력)
 *   ② 미리보기 URL 이 ?w=480 을 쓴다 (읽는 동안 디코드·레이아웃 비용 최소화)
 *   ③ 셸 여유분/상한이 줄어 종이 DOM 이 더 작게 유지된다
 *   ④ 스크롤해도 글상자 DOM 을 만들지 않는다 (읽기 우선 유지)
 *   ⑤ 치명적 런타임 오류가 없다
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
const PAGES = 12;
const BOXES = 6;
const SPANS = 6;

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ` — ${extra}` : '')); }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-lowend-'));
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

const REF = 'lowend01';
const IMP_SLICE = 4;
const SLICES = new Map();
function seedSlices() {
  const mkPage = i => {
    const els = [];
    for (let k = 0; k < BOXES; k++) {
      let html = '';
      for (let s = 0; s < SPANS; s++)
        html += `<span data-fs="11" style="font-size:11px">단어${s}<i class="zsp"> </i></span>`;
      els.push({ type: 'text', id: `t${i}_${k}`, x: 40, y: 60 + k * 40, w: 350, h: 40,
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

const PIXEL = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
  + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
  + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
let previewHits = 0;
let previewWidths = new Set();
const fakeWorker = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let m = u.pathname.match(/^\/api\/import\/page\/([^/]+)\/(\d+)$/);
  if (m) {
    res.writeHead(200, { 'Content-Type': 'image/jpeg',
                         'Cache-Control': 'public, max-age=31536000, immutable' });
    res.end(PIXEL); return;
  }
  m = u.pathname.match(/^\/api\/import\/docfile\/([^/]+)$/);
  if (m) {
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
  const ins = await q({ table: 'notebooks', op: 'insert', values: [{ title: '똥컴 논문', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const nid = ins.data.id;
  const seedDoc = { version: 3, serverDoc: REF, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {} };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: nid, content: JSON.stringify(seedDoc), font_size: 16 }], filters: [] });

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
      Object.defineProperty(window.HTMLImageElement.prototype, 'src', {
        configurable: true,
        set(v) {
          this.setAttribute('src', v);
          if (String(v).includes('/api/import/page/')) {
            previewHits++;
            const w = new URL(String(v), window.location.href).searchParams.get('w');
            if (w) previewWidths.add(w);
          }
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

  const boot = Date.now();
  while (Date.now() - boot < 15_000 && !document.querySelector('.note-stack .note-card')) await wait(60);
  const card = [...document.querySelectorAll('.note-stack .note-card')].find(c => (c.textContent || '').includes('똥컴 논문'));
  check('똥컴 판정이 즉시 body.sdy-turbo 를 붙인다', document.body.classList.contains('sdy-turbo'));
  card.click();
  const openUntil = Date.now() + 20_000;
  while (Date.now() < openUntil && ev('typeof doc==="object"&&doc?doc.pages.length:0') !== PAGES) await wait(40);

  check('가져온 문서가 열린다', ev('doc.pages.length') === PAGES);
  check('읽기 우선으로 쪽 그림을 요청한다', previewHits > 0, `hits=${previewHits}`);
  check('미리보기는 똥컴용 480px 로 받는다', previewWidths.has('480'), [...previewWidths].join(','));

  ev(`(function(){
    const b=document.getElementById('editorBody');
    if(!b) return;
    let st=0;
    Object.defineProperty(b,'clientHeight',{configurable:true,get(){return 900;}});
    Object.defineProperty(b,'clientWidth',{configurable:true,get(){return 1200;}});
    Object.defineProperty(b,'scrollTop',{configurable:true,get(){return st;},set(v){st=Math.max(0,v);}});
  })()`);
  await wait(600);
  check('셸 상한이 줄어 종이 DOM 이 아주 작게 유지된다', wraps() <= 9, `wrap=${wraps()}`);

  const body = document.getElementById('editorBody');
  for (let f = 0; f < 20; f++) {
    body.scrollTop = body.scrollTop + 120;
    body.dispatchEvent(new window.Event('scroll'));
    await wait(16);
  }
  check('스크롤해도 글상자 DOM 은 만들지 않는다', tbs() === 0, `tb=${tbs()}`);
  check('스크롤해도 종이 DOM 은 작다', wraps() <= 9, `wrap=${wraps()}`);

  const fatal = errors.filter(m => !/Not implemented|scrollIntoView|Could not load/.test(String(m)));
  if (fatal.length) console.log(fatal.slice(0, 3).join('\n---\n'));
  check('똥컴 열람 중 치명적 런타임 오류가 없다', fatal.length === 0);
} finally {
  await closeDoms([dom]);
  child.kill('SIGTERM');
  await new Promise(r => fakeWorker.close(r));
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(`\n똥컴 경량 열람: PASS ${pass} / FAIL ${fail}`);
if (fail) process.exit(1);
