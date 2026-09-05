/* 대용량 노트(500쪽+) 열람 런타임 검증 — '셸 가상화'
 *
 * 회귀 배경: 예전 renderPages 는 문서의 모든 쪽에 대해 page-wrap/paper/레이어를
 * 통째로 만들고 IntersectionObserver 두 개에 전부 observe 했다. 500쪽이면
 * 노드 5천 개 + observe 1000회라 노트를 여는 순간 화면이 멎었다.
 *
 * 지금 구조:
 *   · 스테이지 높이는 전체 쪽수로 잡아 스크롤 길이를 정확히 유지하고
 *   · 화면에 걸치는 쪽 ± 여유분만 DOM 에 올리며(셸 창)
 *   · 그 안에서 현재 쪽 ±1 만 요소를 그린다(요소 창).
 * 문서 데이터(doc.pages)는 어떤 경우에도 그대로 남아야 한다.
 */
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
const PAGES = 520;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-large-'));
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
    if (child.exitCode !== null) throw new Error('server died: ' + log);
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }

  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const ins = await q({ table: 'notebooks', op: 'insert', values: [{ title: '대용량 500쪽', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const nid = ins.data.id;

  const pages = [];
  for (let i = 0; i < PAGES; i++) {
    const els = [];
    for (let k = 0; k < 4; k++) {
      els.push({ type: 'text', id: `t${i}_${k}`, x: 40, y: 60 + k * 90, w: 320, h: 60,
                 html: `<b>${i + 1}쪽 ${k + 1}번째 줄</b>`, fontSize: 16 });
    }
    pages.push({ id: 'p' + i, els });
  }
  const seedDoc = { version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {}, pages };
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
  const wraps = () => document.querySelectorAll('#pagesStage .page-wrap').length;
  const paperOf = i => document.querySelector(`#pagesStage .paper[data-page-idx="${i}"]`);

  const boot = Date.now();
  while (Date.now() - boot < 10_000 && !document.querySelector('.note-stack .note-card')) await wait(60);
  const card = [...document.querySelectorAll('.note-stack .note-card')]
    .find(c => (c.textContent || '').includes('대용량 500쪽'));
  check('홈에 대용량 노트 카드가 보인다', !!card);

  const t0 = Date.now();
  card.click();
  const openUntil = Date.now() + 12_000;
  while (Date.now() < openUntil && ev('typeof doc==="object"&&doc?doc.pages.length:0') !== PAGES) await wait(60);
  const openMs = Date.now() - t0;
  check(`${PAGES}쪽 노트가 열린다`, ev('doc.pages.length') === PAGES);
  await wait(700);

  // ① 문서는 전부 있지만 DOM 에는 창만 올라온다
  const mounted = wraps();
  console.log(`    · 열기 ${openMs}ms · page-wrap ${mounted}개 / ${PAGES}쪽 · 요소 렌더 ${ev('renderedPages.size')}쪽`);
  check('종이(page-wrap)는 전체 쪽수가 아니라 창 크기만 DOM 에 올라온다', mounted > 0 && mounted <= 30);
  check('요소를 그린 쪽도 한 줌뿐이다', ev('renderedPages.size') <= 6);
  check('문서 데이터는 500쪽 그대로다', ev('doc.pages.length') === PAGES && ev('(doc.pages[499].els||[]).length') === 4);

  // ② 스크롤 길이는 전체 쪽수만큼 유지된다 (스크롤 막대가 짧아지면 안 된다)
  const stageH = parseFloat(document.getElementById('pagesStage').style.height) || 0;
  const step = ev('pageStep()');
  check('스테이지 높이는 전체 쪽수 기준으로 잡힌다', stageH > step * (PAGES - 2));

  // ③ 첫 쪽 내용은 바로 보인다
  const p0 = paperOf(0);
  check('1쪽 종이가 있다', !!p0);
  check('1쪽 글상자가 그려져 있다', !!p0 && p0.querySelectorAll('.layer-text .tb').length === 4);

  // ④ 먼 쪽으로 점프 — 중간 쪽을 연쇄 로드하지 않고 목적 쪽만 올린다
  ev('goToPage(400)');
  const jumpUntil = Date.now() + 5_000;
  while (Date.now() < jumpUntil && !(paperOf(399) && paperOf(399).querySelectorAll('.layer-text .tb').length)) await wait(60);
  check('400쪽으로 바로 이동해 종이가 올라온다', !!paperOf(399));
  check('400쪽 글상자가 그려진다', paperOf(399).querySelectorAll('.layer-text .tb').length === 4);
  check('점프 뒤에도 DOM 의 종이 수는 그대로 작다', wraps() <= 30);
  check('멀어진 1쪽은 DOM 에서 내려간다', !paperOf(0));
  check('내려간 쪽의 문서 데이터는 남아 있다', ev('(doc.pages[0].els||[]).length') === 4);
  check('현재 쪽 표시가 400쪽을 가리킨다', ev('curPageIdx') === 399);

  // ⑤ 마지막 쪽까지 이동해도 같다
  ev(`goToPage(${PAGES})`);
  const lastUntil = Date.now() + 5_000;
  while (Date.now() < lastUntil && !(paperOf(PAGES - 1) && paperOf(PAGES - 1).querySelectorAll('.layer-text .tb').length)) await wait(60);
  check('마지막 쪽도 열린다', !!paperOf(PAGES - 1));
  check('마지막 쪽에서도 종이 수가 작다', wraps() <= 30);

  // ⑥ 되돌아오면 다시 그려진다 (데이터·표시 모두 복구)
  ev('goToPage(1)');
  const backUntil = Date.now() + 5_000;
  while (Date.now() < backUntil && !(paperOf(0) && paperOf(0).querySelectorAll('.layer-text .tb').length)) await wait(60);
  check('1쪽으로 돌아오면 내용이 되살아난다', !!paperOf(0) && paperOf(0).querySelectorAll('.layer-text .tb').length === 4);

  // ⑦ 확대/축소도 전 쪽을 건드리지 않는다
  ev('zoomIn(); zoomIn();');
  await wait(150);
  check('확대 뒤에도 종이 수가 작다', wraps() <= 30);
  check('확대해도 문서는 그대로다', ev('doc.pages.length') === PAGES);

  // ⑦-2 진짜 브라우저처럼 '뷰포트 높이 + 스크롤'을 흉내 내 창이 따라오는지 본다
  //     (jsdom 은 레이아웃이 없어 clientHeight 가 0 이라 직접 만들어 준다)
  ev(`(function(){
    const b=document.getElementById('editorBody');
    let st=0;
    Object.defineProperty(b,'clientHeight',{configurable:true,get(){return 900;}});
    Object.defineProperty(b,'scrollTop',{configurable:true,get(){return st;},set(v){st=Math.max(0,v);}});
    window.__scrollPage=(n)=>{ b.scrollTop=pageStep()*n; b.dispatchEvent(new Event('scroll')); };
  })()`);
  ev('__scrollPage(120)');
  const scrollUntil = Date.now() + 5_000;
  while (Date.now() < scrollUntil && ev('curPageIdx') !== 120) await wait(60);
  check('스크롤 위치만으로 현재 쪽을 찾아낸다', ev('curPageIdx') === 120);
  await wait(400);
  check('스크롤한 자리의 종이가 올라와 있다', !!paperOf(120));
  check('스크롤해도 DOM 의 종이 수는 창 크기로 유지된다', wraps() <= 30);
  check('화면 위아래 여유분까지만 올린다', !!paperOf(119) && !!paperOf(121) && !paperOf(100));
  const filled = Date.now() + 3_000;
  while (Date.now() < filled && !(paperOf(120) && paperOf(120).querySelectorAll('.layer-text .tb').length)) await wait(60);
  check('스크롤이 멎으면 그 쪽 내용이 채워진다', paperOf(120).querySelectorAll('.layer-text .tb').length === 4);
  ev('__scrollPage(0)');
  const backTop = Date.now() + 5_000;
  while (Date.now() < backTop && !(paperOf(0) && paperOf(0).querySelectorAll('.layer-text .tb').length)) await wait(60);
  check('맨 위로 돌아오면 1쪽이 다시 그려진다', !!paperOf(0) && ev('curPageIdx') === 0);
  check('되돌아온 뒤에도 종이 수가 작다', wraps() <= 30);

  // ⑧ 쪽 추가는 마지막 쪽 뒤에 붙는다
  const before = ev('doc.pages.length');
  ev('addPage()');
  await wait(300);
  check('페이지 추가가 동작한다', ev('doc.pages.length') === before + 1);
  check('추가 뒤에도 종이 수가 작다', wraps() <= 30);

  const fatal = errors.filter(m => !/Not implemented|scrollIntoView|Could not load/.test(String(m)));
  if (fatal.length) console.log(fatal.slice(0, 5).join('\n---\n'));
  check('대용량 열람 중 치명적 런타임 오류가 없다', fatal.length === 0);
} finally {
  await closeDoms([dom]);
  child.kill('SIGTERM');
}
console.log(`\n대용량(500쪽) 열람: PASS ${pass}`);
