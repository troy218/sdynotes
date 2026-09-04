/* 14.23.1 · 가져온 논문(대용량·lazy 슬라이스) 회귀 테스트 — 워커 없이 시뮬레이션.
   - /api/import/docfile 을 가로채 12쪽짜리 '논문'을 슬라이스(8쪽 단위)로 내어준다.
   - 먼 쪽으로 이동한 뒤: ① 해돌이 '이 페이지' 글이 '지금 보는 쪽'과 일치하는지,
     ② 겹쳐 놓은(옮겨 쌓은) 텍스트상자가 슬라이스 다시 그리기에서 사라지지 않는지,
     ③ 각 쪽에 다른 쪽 글이 섞이지 않는지 검증한다. */
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
const TOTAL = 12, LAZY = 8;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-aiimp-'));
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

// 시뮬레이션 논문: 쪽마다 고유 마커 문장. 3쪽에는 사용자가 '겹쳐 놓은' 상자 2개가 있다.
const MARK = i => `이것은 논문 ${i + 1}쪽 본문입니다 마커렌즈${i + 1}번.`;
// 가져오기와 같은 tight 글상자 모양: 절대위치 span (tightTextFromHtml 이 읽는 형식)
function tightHtml(text) {
  let x = 0;
  return text.split(' ').map(w =>
    `<span style="position:absolute;left:${(x += 8) + 30}px;top:0px">${w}</span>`).join('');
}
const SIM = {
  version: 1,
  total: TOTAL,
  page(i) {
    const els = [{ type: 'text', id: `imp_t${i}`, html: tightHtml(MARK(i)), x: 50, y: 60, w: 520, h: 40, fontSize: 11, tight: 1 }];
    if (i === 2) {
      // 사용자가 취소선 안내·캡션처럼 큰 상자 위에 겹쳐 놓은 작은 상자
      els.push({ type: 'text', id: 'imp_small', html: '위에 겹쳐 둔 작은 메모 상자', x: 60, y: 62, w: 300, h: 18, fontSize: 10 });
    }
    return { id: `ip_${i}`, els, tables: [] };
  },
};

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
    if (child.exitCode !== null) throw new Error('server died');
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String(e?.message || e);
    if (!/HTMLMediaElement|Could not load (?:link|script)/.test(m)) errors.push(m);
  });
  vc.on('error', (...a) => errors.push(a.join(' ')));
  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      installWindowGuard(window);
      window.innerWidth = 1280; window.innerHeight = 800;
      window.__simNid = null;   // DB 시드 뒤 카드 클릭 직전에 cfg 를 심는다 (아래 openNote 참고)
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
      const jresp = o => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(o))) });
      window.fetch = (input, init) => {
        const u = typeof input === 'string' || input instanceof URL ? String(input) : String(input.url);
        if (u.includes('/api/import/docfile/job_sim')) {
          const url = new URL(u, window.location.href);
          if (url.searchParams.get('meta') === '1') return jresp({ ok: true, version: SIM.version, total: SIM.total });
          const from = parseInt(url.searchParams.get('from') || '0', 10) || 0;
          const to = parseInt(url.searchParams.get('to') || '0', 10) || 0;
          if ((init && init.method) === 'POST') { SIM.version += 1; return jresp({ ok: true, version: SIM.version }); }
          const pages = [];
          for (let i = from; i < Math.min(to, SIM.total); i++) pages.push(SIM.page(i));
          return jresp({ ok: true, total: SIM.total, version: SIM.version, sizePreset: 'a4_portrait', pages });
        }
        const target = typeof input === 'string' || input instanceof URL ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
    },
  });
  dom.window.addEventListener('error', e => errors.push(e.error?.stack || e.message));
  const W = dom.window, D = W.document;

  // DB에 노트를 심고, 열기 직전에 '서버 보관본 있다'는 cfg 를 심는다 (가져오기 완료 상태)
  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => globalThis.fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const ins = await q({ table: 'notebooks', op: 'insert', values: [{ title: '논문 시뮬', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const nid = ins.data.id;
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: nid, content: JSON.stringify({ version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {}, pages: [{ id: 'p1', els: [] }] }), font_size: 16 }], filters: [] });
  const t0 = Date.now();
  let card = null;
  while (Date.now() - t0 < 8_000 && !card) {
    card = [...D.querySelectorAll('.note-stack .note-card')].find(c => String(c.dataset.nbId || '') === String(nid));
    if (!card) await wait(60);
  }
  check('논문 노트 카드가 보인다', !!card);
  W.localStorage.setItem('nb_' + nid, JSON.stringify({ serverDoc: 'job_sim', paper: 'blank', sizePreset: 'a4_portrait' }));
  card.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
  const tOpen = Date.now() + 8_000;
  while (Date.now() < tOpen && !D.getElementById('editorView').classList.contains('open')) await wait(60);
  check('편집기가 열렸다', D.getElementById('editorView').classList.contains('open'));
  const tP = Date.now() + 8_000;
  while (Date.now() < tP && D.querySelectorAll('#pagesStage .page-wrap').length < TOTAL) await wait(80);
  check('12쪽 몸통이 만들어졌다', D.querySelectorAll('#pagesStage .page-wrap').length === TOTAL);
  const tSlice = Date.now() + 8_000;
  while (Date.now() < tSlice && (D.querySelector('#pagesStage .paper[data-page-idx="0"] .tb-content')?.textContent || '').indexOf('논문1쪽') < 0) await wait(80);
  check('첫 슬라이스(1~8쪽) 본문을 받았다', (D.querySelector('#pagesStage .paper[data-page-idx="0"] .tb-content')?.textContent || '').includes('논문1쪽'));


  // ── 먼 쪽(12쪽)으로 이동: goToPage 전역 함수 + ensureVisiblePagesRendered ──
  check('goToPage 가 전역 노출돼 있다', typeof W.goToPage === 'function');
  W.goToPage(TOTAL);
  await wait(120);
  try { W.ensureVisiblePagesRendered(); } catch (e) {}
  const tFar = Date.now() + 8_000;
  while (Date.now() < tFar && (D.querySelector('#pagesStage .paper[data-page-idx="11"] .tb-content')?.textContent || '').indexOf('논문12쪽') < 0) await wait(80);
  check('먼 슬라이스(9~12쪽)를 받아 그렸다', (D.querySelector('#pagesStage .paper[data-page-idx="11"] .tb-content')?.textContent || '').includes('논문12쪽'));

  // ① 해돌이 '이 페이지' — 12쪽을 보고 있으니 12쪽 글이어야 한다
  const pageTxt = W.__sdyAiBridge.text('page');
  check('이 페이지 글 = 지금 보는 12쪽', pageTxt.includes('논문 12쪽') && !pageTxt.includes('논문 1쪽') && !pageTxt.includes('논문 2쪽'));

  // ② 다시 3쪽으로 돌아와 겹쳐 놓은 작은 상자가 살아 있는지 (재렌더/슬라이스 저장 뒤)
  W.goToPage(3);
  await wait(120);
  try { W.ensureVisiblePagesRendered(); } catch (e) {}
  await wait(600);   // 재렌더(+저장) 타이밍 기다림
  const smallAfter = D.querySelector('#pagesStage .tb[data-id="imp_small"]');
  check('3쪽으로 돌아와도 겹칩 상자가 사라지지 않는다', !!smallAfter);

  // (스크롤 경로) 5쪽으로 스크롤 → curPageIdx 가 5쪽을 가리키는지
  const wraps = [...D.querySelectorAll('#pagesStage .page-wrap')];
  const body = D.getElementById('editorBody');
  body.scrollTop = (parseFloat(wraps[4].style.top) || 0) + 2;
  body.dispatchEvent(new W.Event('scroll'));
  await wait(300);
  const t5 = W.__sdyAiBridge.text('page');
  check('스크롤로 5쪽을 보면 이 페이지 글도 5쪽', t5.includes('논문 5쪽') && !t5.includes('논문 12쪽'));

  // ③ 쪽 겹침: 12쪽 종이에 다른 쪽 글이 섞였는지
  const p12 = (D.querySelector('#pagesStage .paper[data-page-idx="11"] .layer-text')?.textContent) || '';
  check('12쪽에 다른 쪽 글이 섞이지 않는다', p12.includes('논문12쪽') && !p12.includes('논문1쪽') && !p12.includes('논문 5쪽'));

  const fatal = errors.filter(Boolean);
  if (fatal.length) console.log('runtime errors:\n' + fatal.slice(0, 6).join('\n---\n'));
  console.log(`\n가져온 논문 lazy 슬라이스 런타임: PASS ${pass} / FAIL 0`);
} catch (e) {
  console.error('\n가져온 논문 lazy 슬라이스 런타임 실패:', e);
  if (log) console.error('\nserver log:\n' + log.slice(-2000));
  process.exitCode = 1;
} finally {
  await closeDoms([dom]);
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  fs.rmSync(TMP, { recursive: true, force: true });
}
