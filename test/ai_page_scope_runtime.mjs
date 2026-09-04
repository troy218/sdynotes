/* 14.23.1 · 해돌이 '이 페이지' 범위 회귀 테스트 (빠른 런타임 확인)
   - 여러 쪽 노트에서 스크롤/클릭로 보는 쪽을 바꾼 뒤 __sdyAiBridge.text('page') 가
     '지금 보는 쪽'의 글만 주는지 검증한다. (첫 쪽만 요약되던 버그 방지)
   - 쪽을 바꾼 뒤 텍스트상자를 눌러도 상자가 사라지지 않고, 다른 쪽 글이
     섞여 들어가지 않는지도 같이 확인한다. */
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-aipage-'));
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

  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const ins = await q({ table: 'notebooks', op: 'insert', values: [{ title: '해돌이 페이지 범위', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const nid = ins.data.id;
  const MARK = ['강아지첫째', '고양이둘째', '햄스터셋째', '토끼넷째'];
  const pages = MARK.map((mk, i) => ({
    id: 'ap_' + i,
    els: [{ type: 'text', id: 'apt' + i, html: '이것은 ' + mk + ' 쪽의 본문입니다. 몇 글자 더 적어 둡니다.',
      x: 60, y: 60 + i * 20, w: 500, h: 60, fontSize: 16 }],
  }));
  const seedDoc = { version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {}, pages };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: nid, content: JSON.stringify(seedDoc), font_size: 16 }], filters: [] });

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
      window.matchMedia = query => ({ matches: query.includes('pointer:fine'), media: query,
        addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.BroadcastChannel = class { postMessage(){} close(){} addEventListener(){} };
      window.EventSource = class { close(){} addEventListener(){} };
      window.requestIdleCallback = cb => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
    },
  });
  dom.window.addEventListener('error', e => errors.push(e.error?.stack || e.message));
  const W = dom.window, D = W.document;

  // 노트 카드를 열어 편집기 진입
  const t0 = Date.now();
  let card = null;
  while (Date.now() - t0 < 8_000 && !card) {
    card = [...D.querySelectorAll('.note-stack .note-card')].find(c => String(c.dataset.nbId || '') === String(nid));
    if (!card) await wait(60);
  }
  check('노트 카드가 보인다', !!card);
  card.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
  const tOpen = Date.now() + 6_000;
  while (Date.now() < tOpen && !D.getElementById('editorView').classList.contains('open')) await wait(60);
  check('편집기가 열렸다', D.getElementById('editorView').classList.contains('open'));
  const tR = Date.now() + 5_000;
  while (Date.now() < tR && D.querySelectorAll('#pagesStage .page-wrap').length < 4) await wait(60);
  check('4개의 쪽이 만들어졌다', D.querySelectorAll('#pagesStage .page-wrap').length === 4);

  check('다리(bridge)가 노출돼 있다', typeof W.__sdyAiBridge?.text === 'function');

  // 맨 처음: 1쪽을 보고 있으니 '이 페이지' 글은 첫째 쪽 글만
  let pageTxt = W.__sdyAiBridge.text('page');
  check('처음에는 1쪽 글만 준다', pageTxt.includes(MARK[0]) && !pageTxt.includes(MARK[3]));

  // 스크롤로 4쪽으로 이동 — onEditorScroll 이 curPageIdx 를 갱신해야 한다
  const wraps = [...D.querySelectorAll('#pagesStage .page-wrap')];
  const body = D.getElementById('editorBody');
  body.scrollTop = (parseFloat(wraps[3].style.top) || 0) + 2;
  body.dispatchEvent(new W.Event('scroll'));
  await wait(250);   // rAF + onEditorScroll
  check('스크롤 뒤 4쪽 글만 준다', (() => {
    const t = W.__sdyAiBridge.text('page');
    return t.includes(MARK[3]) && !t.includes(MARK[0]) && !t.includes(MARK[1]);
  })());

  // 전체(doc) 범위는 네 쪽 글을 모두
  const docTxt = W.__sdyAiBridge.text('doc');
  check('전체 범위는 네 쪽 글을 모두 준다', MARK.every(mk => docTxt.includes(mk)));

  // ---- 이어서: 페이지 이동 직후 텍스트상자를 눌러도 안 사라지는지 ----
  const tRender = Date.now() + 4_000;
  while (Date.now() < tRender && D.querySelectorAll('#pagesStage .paper[data-page-idx="3"] .tb').length < 1) await wait(80);
  const tb4 = D.querySelector('#pagesStage .paper[data-page-idx="3"] .tb');
  check('4쪽 상자가 화면에 그려졌다', !!tb4);
  if (tb4) {
    const id4 = tb4.dataset.id;
    tb4.querySelector('.tb-content').dispatchEvent(new W.MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1, clientX: 100, clientY: 100 }));
    D.dispatchEvent(new W.MouseEvent('mouseup', { bubbles: true, button: 0 }));
    await wait(350);
    const still = D.querySelector(`#pagesStage .tb[data-id="${id4}"]`);
    check('누른 텍스트상자가 사라지지 않는다', !!(still && still.isConnected));

    // 쪽 겹침: 각 쪽의 layer-text 에는 자기 쪽 글만 있다 (다른 쪽 글이 섞이면 겹침)
    let clean = true, culprit = '';
    D.querySelectorAll('#pagesStage .paper').forEach(p => {
      const i = +p.dataset.pageIdx;
      const txt = (p.querySelector('.layer-text')?.textContent) || '';
      MARK.forEach((mk, j) => {
        if (i !== j && txt.includes(mk)) { clean = false; culprit = `paper${i + 1}에 ${mk}`; }
      });
    });
    check('다른 쪽 글이 한 쪽에 겹쳐 들어가지 않는다', clean && culprit === '');
  }

  const fatal = errors.filter(Boolean);
  if (fatal.length) console.log('runtime errors:\n' + fatal.slice(0, 6).join('\n---\n'));
  console.log(`\n해돌이 페이지 범위 런타임: PASS ${pass} / FAIL 0`);
} catch (e) {
  console.error('\n해돌이 페이지 범위 런타임 실패:', e);
  if (log) console.error('\nserver log:\n' + log.slice(-2000));
  process.exitCode = 1;
} finally {
  await closeDoms([dom]);
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  fs.rmSync(TMP, { recursive: true, force: true });
}
