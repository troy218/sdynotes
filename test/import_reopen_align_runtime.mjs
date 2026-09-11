/* 14.38 · 가져온(서버 보관) 문서를 '마지막으로 보던 쪽'에서 다시 열 때
 *        슬라이스가 **제 자리**에 붙는지 검증하는 실제 열람 런타임.
 *
 * 사용자가 겪던 일 (논문 열람):
 *   논문을 열어 아래로 스크롤 → 위로가기로 나감 → 다시 연다.
 *   이때 마지막으로 본 쪽이 9쪽 이상이면 loadDocAsync 가 그 쪽의 슬라이스를
 *   먼저 받아 오는데, 예전 코드는 이 슬라이스를 **문서 맨 앞(cfg.pages[0..])**에
 *   놓았다. 그래서
 *     · 문서 앞쪽 쪽들이 전부 엉뚱한(뒤쪽) 쪽 내용으로 열리고
 *     · 그 상태에서 같은 슬라이스가 반쯤 lazy인 채 loadBatch 되면 id 보강
 *       병합이 **다른 쪽의 글상자를 이어 붙여** 한 종이에 두 쪽의 글상자가
 *       겹쳐지며, 그대로 저장(POST)되어 서버 보관본까지 영구적으로 섞였다.
 *
 * 확인하는 것
 *   ① 다시 열면 마지막으로 본 쪽(여기서는 20)이 즉시 실내용으로 열린다
 *   ② 문서 앞쪽(1~8쪽)은 'lazy stub' 이지 절대 다른 쪽의 내용이 아니다
 *   ③ 스크롤 위로 → 0번 슬라이스를 받아도 모든 쪽의 요소 id 는 제 쪽 번호다
 *   ④ (회귀 주입) 메모리의 한 쪽이 서버와 **다른 쪽 신원(id)** 을 물고 있으면
 *      loadBatch 는 이어 붙이지 않고 서버 본문으로 교체한다 — 예전엔
 *      두 쪽의 글상자가 한 쪽에 concat 되어 '합성·저장' 사고로 이어졌다.
 *   ⑤ 저장(POST)된 슬라이스는 언제나 자기 범위의 쪽만 담는다
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
const PAGES = 36;      // 36쪽 → 슬라이스 0(0-7) · 16(16-23) … 마지막 슬라이스는 4쪽
const BOXES = 4;       // 쪽당 글상자 (id 가 쪽 번호를 물고 있다: t{i}_{k})
const LASTPG = 20;     // 마지막으로 보던 쪽 (슬라이스 16)

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ` — ${extra}` : '')); }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-realign-'));
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

// ── 가짜 워커: 슬라이스 GET + 저장 POST 기록 ────────────────────────────
const REF = 'aligntest01';
const IMP_SLICE = 8;
const SLICES = new Map();
const mkPage = i => {
  const els = [];
  for (let k = 0; k < BOXES; k++)
    els.push({ type: 'text', id: `t${i}_${k}`, x: 40 + k * 60, y: 60 + k * 40,
               w: 220, h: 30, html: `<span>쪽${i} 상자${k}</span>`, fontSize: 14 });
  return { id: 'p' + i, els, tables: [] };
};
for (let s0 = 0; s0 < PAGES; s0 += IMP_SLICE) {
  const chunk = [];
  for (let i = s0; i < Math.min(PAGES, s0 + IMP_SLICE); i++) chunk.push(mkPage(i));
  SLICES.set(s0, zlib.gzipSync(JSON.stringify({ ok: true, pages: chunk, total: PAGES })));
}
const sliceBody = s0 => SLICES.get(s0) || null;
const GETs = [], POSTs = [];
const fakeWorker = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const m = u.pathname.match(/^\/api\/import\/docfile\/([^/]+)$/);
  if (m) {
    if (u.searchParams.get('meta') === '1') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, total: PAGES, version: 1 })); return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', b => body += b);
      req.on('end', () => {
        try {
          const d = JSON.parse(body || '{}');
          POSTs.push({ from: d.from, pages: d.pages || [] });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, slice: d.from, version: Date.now() / 1000 }));
        } catch { res.writeHead(400); res.end('{}'); }
      });
      return;
    }
    const fr = parseInt(u.searchParams.get('from') || '0', 10);
    GETs.push(fr);
    const gz = sliceBody(fr);
    if (!gz) { res.writeHead(404); res.end('{}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json',
                         'Content-Encoding': 'gzip', ETag: `"a${fr}"` });
    res.end(gz); return;
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
  const ins = await q({ table: 'notebooks', op: 'insert', values: [{ title: '재열람 정렬 논문', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const nid = ins.data.id;
  const seedDoc = { version: 3, serverDoc: REF, paper: 'blank',
                    sizePreset: 'a4_portrait', emoji: '', glossary: {} };
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
      window.addEventListener('error', e => errors.push(e.error?.stack || e.message));
      window.addEventListener('unhandledrejection', e => errors.push('unhandled: ' + (e.reason?.stack || e.reason)));
    },
  });

  const { window } = dom, { document } = window;
  const ev = code => window.eval(code);

  const boot = Date.now();
  while (Date.now() - boot < 15_000 && !document.querySelector('.note-card')) await wait(60);
  // 홈 스택 구조(17.2) 에서는 연 노트가 '최근' 줄로 옮겨진다 — 노트 목록 전체에서 id 로 찾는다.
  const findCard = () => [...document.querySelectorAll('.note-card')]
    .find(c => String(c.dataset.nbId || '') === String(nid));
  check('홈에 가져온 논문 카드가 보인다', !!findCard());

  // 모든 쪽 검사: 실내용(비-lazy) 쪽은 반드시 '제 쪽 번호'의 요소만 담는다
  const pageOk = pg => pg && pg.__lazy == null && (pg.els || []).length > 0;
  const foreignPages = () => ev(`(function(){
    const bad=[];
    (doc.pages||[]).forEach((pg,i)=>{
      if(!pg||pg.__lazy!=null) return;
      if(pg.id!=='p'+i){ bad.push(i+':id='+pg.id); return; }
      const re=new RegExp('^t'+i+'_');
      ((pg.els)||[]).forEach(e=>{ if(!re.test(e.id||'')) bad.push(i+':el='+e.id); });
    });
    return bad;
  })()`);

  // ── 첫 열람: lastpg 없음 → 슬라이스 0 부터 정렬 오픈 ──────────────────
  findCard().click();
  const o1 = Date.now() + 25_000;
  while (Date.now() < o1 && ev('typeof doc==="object"&&doc?(doc.pages||[]).length:0') !== PAGES) await wait(40);
  check('가져온 문서가 36쪽으로 열린다', ev('(doc.pages||[]).length') === PAGES);
  await wait(600);
  check('첫 열람(1번 슬라이스)은 정렬돼 있다', foreignPages().length === 0,
    JSON.stringify(foreignPages().slice(0, 4)));

  // ── '아래로 스크롤 → 위로가기 → 다시 열기' 재현 ─────────────────────
  // 실제 흐름처럼: 20번 쪽까지 내려 간 상태(curPageIdx) 에서 나간다.
  //   closeEditor → saveLastPos 가 'sdy_lastpg_<id>' = 20 을 남긴다.
  ev(`curPageIdx=${LASTPG}; saveLastPos();`);
  check('마지막 위치(21번째 쪽)를 기억했다',
    ev(`localStorage.getItem('sdy_lastpg_'+curNB.id)`) === String(LASTPG),
    `lastpg=${ev(`localStorage.getItem('sdy_lastpg_'+curNB.id)`)}`);
  ev('closeEditor()');
  const c1 = Date.now() + 8_000;
  while (Date.now() < c1 && ev('typeof curNB==="object"&&!!curNB')) await wait(60);
  check('위로가기로 편집기를 닫는다', ev('!curNB'));
  const c2 = Date.now() + 8_000;
  while (Date.now() < c2 && !findCard()) await wait(60);
  if (!findCard()) console.log('    · [debug] cards=' + document.querySelectorAll('.note-stack .note-card,.pro-grid .note-card').length
    + ' stack=' + !!document.querySelector('.note-stack')
    + ' editorOpen=' + document.getElementById('editorView').classList.contains('open')
    + ' notebooks=' + ev('(typeof notebooks==="object"&&notebooks||[]).length'));
  check('홈으로 돌아와 카드가 다시 보인다', !!findCard());

  // ── 재열람: lastpg=20 → 슬라이스 16 을 '먼저' 받는다 ──────────────────
  const tRe = Date.now();
  findCard().click();
  const o2 = Date.now() + 25_000;
  while (Date.now() < o2 && ev('typeof doc==="object"&&doc?(doc.pages||[]).length:0') !== PAGES) await wait(40);
  // restoreLastPos(460ms 타이머) 가 마지막으로 본 쪽으로 옮겨 주길 기다린다
  const o3 = Date.now() + 8_000;
  while (Date.now() < o3 && !pageOk(ev('doc.pages[20]'))) await wait(60);
  const o3b = Date.now() + 3_000;
  while (Date.now() < o3b && ev('curPageIdx') !== LASTPG) await wait(60);
  console.log(`    · 재열람 ${Date.now() - tRe}ms`);
  check('재열람 직후 마지막으로 본 21번째 쪽이 실내용으로 떠 있다', pageOk(ev('doc.pages[20]')));
  check('재열람 위치(curPageIdx)도 그 쪽이다', ev('curPageIdx') === LASTPG, `cur=${ev('curPageIdx')}`);
  check('슬라이스 16(마지막으로 본 쪽)을 먼저 받았다', GETs.includes(16), JSON.stringify(GETs));
  check('재열람 문서 전체에 다른 쪽 내용이 섞이지 않는다', foreignPages().length === 0,
    JSON.stringify(foreignPages().slice(0, 4)));

  // ── 위로 스크롤 → 0번 슬라이스 로드 → 여전히 정렬 ────────────────────
  const b = document.getElementById('editorBody');
  ev(`(function(){ const b=document.getElementById('editorBody');
    let st=${LASTPG}*1000;
    Object.defineProperty(b,'clientHeight',{configurable:true,get(){return 900;}}); 
    Object.defineProperty(b,'clientWidth',{configurable:true,get(){return 1200;}});
    Object.defineProperty(b,'scrollTop',{configurable:true,get(){return st;},set(v){st=Math.max(0,v);}});
  })()`);
  b.scrollTop = 0;
  b.dispatchEvent(new window.Event('scroll'));
  const o4 = Date.now() + 10_000;
  while (Date.now() < o4 && !pageOk(ev('doc.pages[3]'))) await wait(60);
  check('맨 위로 가면 0번 슬라이스를 받아 온다', GETs.includes(0), JSON.stringify(GETs));
  check('위로 올려도 모든 쪽이 제 내용이다 (앞쪽이 뒤쪽 내용으로 열리지 않는다)',
    foreignPages().length === 0, JSON.stringify(foreignPages().slice(0, 4)));

  // ── 회귀 주입: 메모리의 한 쪽이 '다른 쪽 신원'일 때 loadBatch ──────────
  //   (예전 코드는 이 상황에서 cur.els.concat(extra) 로 두 쪽의 글상자를
  //    한 쪽에 겹쳐 붙였고, 그대로 저장되어 서버 보관본이 영구히 섞였다)
  const injected = ev(`(function(){
    const src=doc.pages[19];                    // 19번 쪽 내용을
    doc.pages[3]={id:'p19',els:src.els.slice(),tables:[]};  // 3번 자리에 잘못 둔다
    doc.pages[7]={id:'lazy_7',els:[],tables:[],__lazy:1};   // 슬라이스 0 이 반쯤 lazy
    return true;
  })()`);
  check('회귀 상태(3번 자리에 19번 쪽)를 주입했다', !!injected);
  await ev('loadBatch(0)');
  await wait(200);
  const p3 = ev('doc.pages[3]');
  check('다른 쪽 신원(id)이면 이어붙이지 않고 서버 본문으로 교체한다',
    p3 && p3.id === 'p3' && (p3.els || []).every(e => /^t3_/.test(e.id || '')) && (p3.els || []).length === BOXES,
    `id=${p3 && p3.id} els=${p3 && (p3.els || []).map(e => e.id).join(',')}`);
  const p7 = ev('doc.pages[7]');
  check('반쯤 lazy 였던 이웃 쪽도 서버 본문으로 채워진다',
    p7 && p7.id === 'p7' && (p7.els || []).length === BOXES);

  // ── 저장(POST)된 슬라이스는 언제나 자기 범위의 쪽만 담는다 ────────────
  const badPosts = POSTs.filter(({ from, pages }) =>
    !Array.isArray(pages) || pages.some((pg, k) => !pg || pg.id !== 'p' + ((from | 0) + k)));
  check(`저장 POST(${POSTs.length}회)에 다른 쪽 내용이 실리지 않는다`, badPosts.length === 0,
    JSON.stringify(badPosts.map(p => ({ from: p.from, ids: p.pages.map(x => x && x.id) }))));

  check('런타임 오류가 없다', errors.length === 0, errors[0] || '');
} catch (e) {
  fail++;
  console.log('  ✗ 테스트 자체가 깨졌다: ' + (e?.stack || e));
} finally {
  try { dom && closeDoms(dom); } catch {}
  try { child.kill('SIGKILL'); } catch {}
  try { fakeWorker.close(); } catch {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
}
console.log(`\n재열람 정렬 런타임: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
