/* Repro: 쪽이 많은 가져온(서버 보관) 문서를 '마지막으로 보던 쪽'에서 다시 열 때
   첫 슬라이스가 배열 [0] 자리에 잘못 앉는 버그의 실제 DOM 재현.

   사용자가 겪던 일 (14.23 접수):
     1) 논문(쪽 많은 문서)을 읰다가 닫고, 마지막으로 보던 쪽에서 다시 열면
        앞쪽(1~8쪽)에 마지막 슬라이스의 내용이 이중으로 끼워져 보인다.
     2) 그 상태에서 슬라이스를 다시 받으면 서로 다른 쪽의 글상자가 한 쪽에
        겹쳐진다 (loadBatch 의 id 보강 경로).
     3) 해돌이 '이 페이지' 정리가 '지금 보는 쪽'이 아니라 잘못 끼워진 쪽
        글을 서버에 보낸다.
   원인: loadDocAsync 가 ?from=firstSlice 로 받은 슬라이스를 pages[0] 에 넣는다.
   이 파일은 고친 뒤에도 같은 경로가 정확히 붙는지 지키는 회귀 테스트다. */
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-lazy-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
}
let pass = 0;
const check = (name, cond, extra) => { assert.ok(cond, name + (extra ? ' :: ' + extra : '')); pass++; console.log('  ✓ ' + name); };
async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}

// ── 가짜 서버 보관 문서: 16쪽, 각 쪽마다 고유 문장 3개 (P{쪽번호}-a/b/c) ──
const TOTAL = 16, REF = 'tstref01';
const mkPage = i => ({
  id: 'srv_p' + i,
  els: ['a', 'b', 'c'].map((s, k) => ({
    type: 'text', id: `srv_e${i}_${k}`, x: 40 + k * 10, y: 60 + k * 120,
    w: 700, h: 90, fontSize: 16,
    html: `<span>P${i + 1}-${s} 고유 문장 ${i + 1}쪽의 ${k + 1}번째 문단입니다.</span>`,
  })),
});
const STORE = { pages: Array.from({ length: TOTAL }, (_, i) => mkPage(i)), version: 1 };
const sliceGet = (from, to) => STORE.pages.slice(from, Math.min(to, from + 8, TOTAL));
const posted = [];   // 클라이언트가 저장한 슬라이스 기록 (오염 검사용)

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
  const ins = await q({ table: 'notebooks', op: 'insert', values: [{ title: '논문 재현', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const nid = ins.data.id;
  // 대용량 문서 마커: 본문은 서버(docfile)에, 노트에는 참조만
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: nid, content: JSON.stringify({ serverDoc: REF, paper: 'blank', sizePreset: 'a4_portrait' }), font_size: 16 }], filters: [] });

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String(e?.message || e);
    if (!/HTMLMediaElement|Could not load (?:link|script)/.test(m)) errors.push(m);
  });
  vc.on('error', (...a) => errors.push(a.join(' ')));

  const aiAsks = [];   // 해돌이가 보낸 요청 본문 기록
  dom = await JSDOM.fromURL(base + '/?sandbox=0', {
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
        const u = typeof input === 'string' || input instanceof URL ? new URL(String(input), window.location.href) : input;
        const us = u.pathname + (u.search || '');
        // ── 파이썬 워커 대신: 서버 보관 문서 슬라이스 저장소 ──
        const jres = o => ({ ok: true, status: 200, json: () => Promise.resolve(o),
          headers: { get: () => 'application/json' } });
        if (us.startsWith('/api/import/docfile/' + REF)) {
          if (u.searchParams.get('meta') === '1')
            return Promise.resolve(jres({ ok: true, version: STORE.version, total: TOTAL }));
          if ((init || {}).method === 'POST') {
            const b = JSON.parse(init.body || '{}');
            posted.push(b);
            (b.pages || []).forEach((p, k) => { if ((b.from || 0) + k < TOTAL) STORE.pages[(b.from || 0) + k] = p; });
            STORE.version += 1;
            return Promise.resolve(jres({ ok: true, slice: b.from || 0, version: STORE.version }));
          }
          const from = Math.max(0, parseInt(u.searchParams.get('from') || '0', 10) || 0);
          const to = parseInt(u.searchParams.get('to') || String(from + 8), 10);
          return Promise.resolve(jres({ ok: true, pages: sliceGet(from, to), total: TOTAL }));
        }
        // ── 해돌이: 요청 본문을 기록하고 짧은 답만 돌려준다 ──
        if (us === '/api/ai/ask') {
          aiAsks.push(JSON.parse((init || {}).body || '{}'));
          return Promise.resolve(jres({ ok: true, text: '정리', provider: 't', model: 'm', cached: false }));
        }
        if (us === '/api/ai/status')
          return Promise.resolve(jres({ ok: true, enabled: false }));
        const target = (typeof input === 'string' || input instanceof URL) ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
      window.addEventListener('error', e => errors.push(e.error?.stack || e.message));
      window.addEventListener('unhandledrejection', e => errors.push('unhandled: ' + (e.reason?.stack || e.reason)));
    },
  });

  const { window } = dom; const { document } = window;
  const t0 = Date.now();
  while (Date.now() - t0 < 8_000 && !document.querySelector('#noteGrid .note-card, .note-stack .note-card')) await wait(60);
  // 마지막으로 보던 쪽 = 13쪽(0-based 12) → 첫 슬라이스는 8쪽부터 받는다
  window.localStorage.setItem('sdy_lastpg_' + nid, '12');
  const card = document.querySelector('#noteGrid .note-card, .note-stack .note-card');
  check('노트 카드가 렌더된다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(2500);
  check('편집기가 열린다', document.getElementById('editorView').classList.contains('open'));

  const paperTxt = i => {
    const p = document.querySelector(`#pagesStage .paper[data-page-idx="${i}"]`);
    return p ? (p.textContent || '') : '';
  };
  // ① 마지막으로 보던 13쪽이 제자리(배열 12)에 와 있다
  check('13쪽 내용이 13쪽 자리에 렌더된다', /P13-a/.test(paperTxt(12)), paperTxt(12).slice(0, 80));

  // ② 문서 앞쪽(1쪽 자리)이 마지막 슬라이스(9쪽)로 뒤바뀌지 않는다
  const bridge = () => window.__sdyAiBridge && window.__sdyAiBridge.text('page');
  check('브릿지(해돌이 다리)가 있다', typeof bridge() === 'string');
  const body = document.getElementById('editorBody');
  body.scrollTop = 0;
  body.dispatchEvent(new window.Event('scroll'));
  await wait(120);
  const pageTxt = String(bridge() || '');
  check('맨 위로 가면 해돌이는 1쪽 글을 본다', /P1-a/.test(pageTxt) && !/P9-a/.test(pageTxt), pageTxt.slice(0, 90));

  // ③ 문서 전체 글에서 어느 쪽 문장도 두 번 나오지 않는다 (한 쪽에 겹침=이중)
  const docTxt = String((window.__sdyAiBridge && window.__sdyAiBridge.text('doc')) || '');
  const dup = [];
  for (let n = 1; n <= TOTAL; n++) {
    const c = docTxt.split(`P${n}-a`).length - 1;
    if (c !== 1) dup.push(`P${n}:${c}`);
  }
  check('모든 쪽의 글이 정확히 한 번만 있다 (겹침 없음)', dup.length === 0, dup.join(','));

  // ④ 13쪽에서 텍스트상자를 눌러도 사라지지 않는다
  const tb12 = document.querySelector(`#pagesStage .paper[data-page-idx="12"] .tb`);
  check('13쪽에 글상자가 있다', !!tb12);
  const tbId = tb12 && tb12.dataset.id;
  tb12.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1, clientX: 60, clientY: 90 }));
  await wait(150);
  const tbAfter = tbId ? document.querySelector(`#pagesStage .paper[data-page-idx="12"] .tb[data-id="${tbId}"]`) : null;
  check('누른 글상자가 그 자리에 남는다 (사라지지 않음)', !!tbAfter && tbAfter.isConnected && tbAfter.classList.contains('sel'));
  document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  await wait(100);

  // ⑤ '이 페이지' 정리 요청은 지금 보는 쪽(13쪽)의 글을 보낸다
  window.goToPage(13);   // 페이지 바로가기 → curPageIdx=12
  await wait(120);
  aiAsks.length = 0;
  if (typeof window.sdyAiOutline === 'function') { try { window.sdyAiOutline('page'); } catch (e) {} }
  await wait(400);
  const outlineAsk = aiAsks.find(a => a.task === 'outline');
  check('이 페이지 정리 요청이 서버에 갔다', !!outlineAsk);
  check('요청 본문은 13쪽 글이고 다른 쪽이 섞이지 않았다',
    !!outlineAsk && /P13-a/.test(outlineAsk.text) && !/P1-a|P9-a/.test(outlineAsk.text),
    outlineAsk && outlineAsk.text.slice(0, 80));

  // ⑥ 서버 원본 슬라이스가 두 쪽의 글이 섞인 채로 저장되지 않았다
  await wait(1200);
  const badSave = posted.filter(b => (b.pages || []).some(p => {
    const t = JSON.stringify(p);
    const nums = [...t.matchAll(/P(\d+)-a/g)].map(m => +m[1]);
    return new Set(nums).size > 1;
  }));
  check('서버 슬라이스에 서로 다른 쪽이 겹쳐 저장되지 않았다', badSave.length === 0, `posts=${posted.length}`);

  const fatal = errors.filter(Boolean);
  check('치명적 JS 오류 없음', fatal.length === 0, fatal.slice(0, 3).join(' | '));
  console.log(`\nPASS ${pass}`);
} catch (e) {
  console.error('REPRO FAILED:', e);
  if (log) console.error('server log tail:\n' + log.slice(-1500));
  process.exitCode = 1;
} finally {
  await closeDoms([dom]).catch(() => {});
  if (dom) { try { dom.window.close(); } catch {} }
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
