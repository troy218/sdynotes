/* 대용량(서버 보관) 문서 — '마지막으로 보던 쪽' 슬라이스 정렬 런타임 검증.

   회귀: loadDocAsync 가 ?from=8 로 받은 실제 8~15쪽 본문을 문서 배열 0~7번 칸에
   꽂아 두 가지가 깨졌다.
     ① 문서 앞쪽(1~8쪽)에 엉뚱한 쪽(9~16쪽) 본문이 겹쳐 보였고, 나중에 loadBatch(0) 가
        진짜 1~8쪽을 id-병합으로 덧붙여 한 종이에 두 쪽 분량이 포개졌다.
     ② 쪽 수 자체가 total+슬라이스 길이로 늘어났다.
   여기서는 docfile 엔드포인트를 메모리로 흉내 내어 실제 열기→렌더까지 확인한다.
   (워커/파일 없음 — 서버 하나 + jsdom, 수 초 안에 끝난다) */
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-slice-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
}
let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };
async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}

// 가짜 서버 보관 문서 — 20쪽, i쪽에 하나의 글상자(id e<i>, 'P<i>본문마커')
const REF = 'slicetest01', TOTAL = 20, SLICE = 8;
const pageOf = i => ({ id: 'pg' + i, els: [{ type: 'text', id: 'e' + i, x: 40, y: 40, w: 300, h: 80, html: 'P' + i + '본문마커', fontSize: 16 }] });

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
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died');
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }

  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '슬라이스 정렬 노트', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  // 본문은 서버 보관(docfile) 마커만 — 실제 슬라이스는 아래 fetch 흉내가 대답한다
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: id, content: JSON.stringify({ serverDoc: REF, sizePreset: 'a4_portrait', paper: 'blank' }), font_size: 16 }], filters: [] });

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String(e?.message || e);
    if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errors.push(m);
  });
  vc.on('error', (...a) => errors.push(a.join(' ')));
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
      // docfile 만 흉내 — from/to 를 반드시 '그 자리' 본문으로 대답한다
      window.fetch = (input, init) => {
        const u = String(typeof input === 'string' || input instanceof URL ? input : (input && input.url) || '');
        if (u.includes('/api/import/docfile/' + REF)) {
          const qs = new URL(u, base).searchParams;
          if (qs.get('meta') === '1') {
            const d = { ok: true, version: 42, total: TOTAL };
            return Promise.resolve({ ok: true, json: () => Promise.resolve(d) });
          }
          const s0 = Math.max(0, parseInt(qs.get('from') || '0', 10) || 0);
          const to = Math.min(TOTAL, s0 + SLICE);
          const pages = [];
          for (let i = s0; i < to; i++) pages.push(pageOf(i));
          const d = { ok: true, pages, total: TOTAL };
          return Promise.resolve({ ok: true, json: () => Promise.resolve(d) });
        }
        const target = typeof input === 'string' || input instanceof URL ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
      window.addEventListener('error', e => errors.push(e.error?.stack || e.message));
      window.addEventListener('unhandledrejection', e => errors.push('unhandled: ' + (e.reason?.stack || e.reason)));
    },
  });

  const { window } = dom, { document } = window;
  const boot = Date.now();
  while (Date.now() - boot < 8_000 && document.querySelectorAll('.note-stack .note-card').length < 1) await wait(60);

  // 마지막으로 13쪽(인덱스 12)을 보고 있었다 → 첫 슬라이스는 8~15쪽
  window.localStorage.setItem('sdy_lastpg_' + id, '12');
  const card = [...document.querySelectorAll('.note-stack .note-card')]
    .find(c => (c.dataset.nbId || '').includes(String(id)) || (c.textContent || '').includes('슬라이스 정렬 노트'));
  check('노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  // 열림 + 슬라이스 프리필이 안정될 때까지 대기 (최대 6초)
  let tbs = [];
  for (let t = 0; t < 60; t++) {
    await wait(100);
    tbs = [...document.querySelectorAll('#pagesStage .tb')];
    if (tbs.length >= TOTAL) break;
  }
  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));
  const papers = [...document.querySelectorAll('#pagesStage .paper')];
  check(`종이 수가 total(20) 과 같다 (${papers.length})`, papers.length === TOTAL);

  // ① 각 본문 마커는 '원래 자리' 종이에 하나씩 — 겹침·어긋남 없다
  let misplaced = [], dup = 0;
  const seen = new Map();
  tbs.forEach(tb => {
    const pi = tb.dataset.pageIdx, pid = tb.dataset.id;
    const key = pi + ':' + pid;
    if (seen.has(key)) dup++;
    seen.set(key, 1);
    if ('e' + pi !== pid) misplaced.push(pi + ':' + pid);
  });
  check(`본문이 전부 제자리에 있다 (어긋남 ${misplaced.length}개)`, misplaced.length === 0);
  check('같은 본문이 두 종이에 겹쳐 그려지지 않는다', dup === 0);
  const firstPaperTexts = [...(papers[0] || { querySelectorAll: () => [] }).querySelectorAll('.tb')]
    .map(w => w.dataset.id).sort().join(',');
  check(`1쪽 종이에는 1쪽 본문만 있다 (${firstPaperTexts})`, firstPaperTexts === 'e0');

  // ② 해돋이 '이 페이지' — 지금 보는 쪽(13쪽) 본문으로 요약 재료를 꺼낸다
  window.goToPage(13);
  await wait(300);
  const pageText = window.__sdyAiBridge ? window.__sdyAiBridge.text('page') : '';
  check("13쪽에서 bridge.text('page') 는 13쪽 본문이다", pageText.includes('P12본문마커') && !pageText.includes('P0본문마커'));

  // ③ 상자를 눌러도 사라지지 않는다
  const tb0 = document.querySelector('#pagesStage .paper[data-page-idx="0"] .tb');
  if (tb0) {
    tb0.querySelector('.tb-content').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 60, clientY: 60 }));
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
    await wait(250);
  }
  check('글상자를 누른 뒤에도 남아 있다', !!document.querySelector('#pagesStage .paper[data-page-idx="0"] .tb[data-id="e0"]'));

  const fatal = errors.filter(Boolean);
  check('치명적 런타임 오류가 없다', fatal.length === 0);
  if (fatal.length) console.log(fatal.slice(0, 5).join('\n---\n'));
  console.log(`\n슬라이스 정렬 런타임: PASS ${pass} / FAIL 0`);
} catch (e) {
  console.error('\n슬라이스 정렬 런타임 실패:', e);
  if (log) console.error('\nserver log:\n' + log.slice(-2500));
  process.exitCode = 1;
} finally {
  await wait(80);
  await closeDoms([dom]);
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  fs.rmSync(TMP, { recursive: true, force: true });
}
