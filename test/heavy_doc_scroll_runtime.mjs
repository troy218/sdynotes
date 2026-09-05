/* 14.30.1 · 그림·글이 빽빽한 논문(가져온 PDF) 스크롤 런타임 계약
 *
 * 회귀 배경 — 쪽 가상화(14.29.x)로 "DOM 에 올리는 종이 수"는 이미 작았는데도
 * 그림이 많은 논문은 스크롤이 버벅였다. 원인은 그리는 양이 아니라 **문서 전체를
 * 훑는 선택자 질의가 스크롤/렌더 경로에서 반복**된 것이었다. 프로파일 결과:
 *
 *   ① liftLayers()  — `#pagesStage .paper` 전부 × 종이 subtree 하위선택자 3개.
 *      게다가 MutationObserver 가 `#pagesStage` 아래 **모든** class 변경마다
 *      이걸 불렀다(빈 상자 empty·가져온 상자 tight·형광펜 띠·현재 쪽 focused …).
 *      쪽 하나를 그리는 동안에도 수백 번 전수 조사가 겹쳐 스크롤 시간의 90% 를
 *      먹었다(측정: 프레임 p95 5.9초).
 *   ② findElLoc() — 요소 id 조회가 매번 문서 전체(쪽×요소) 선형 탐색. 동기화
 *      경로에서 op 하나당 여러 번 불려 배경 동기화가 스크롤을 멈춰 세웠다.
 *   ③ `document.querySelector('.tb.edit…')` — 편집 상자는 최대 하나인데도
 *      원격 op·실시간 표시 타이머마다 종이 subtree 전체를 훑었다.
 *   ④ decodeTextMarkup() — data-* 서식이 하나도 없는 html 까지 DOM 파싱.
 *
 * 이 테스트는 실제 서버 + jsdom 으로 '배경 래스터 + 그림 + 단어 span 글상자'가
 * 든 논문형 문서를 열고, 사람이 굴리듯 프레임 단위로 스크롤하며 **프레임 시간**을
 * 잰다. 느려지면(전수 조사가 되살아나면) 여기서 잡힌다.
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
const PAGES = 40;
const BOXES = 34;   // 쪽당 문단 글상자 (2단 논문 기준)
const SPANS = 14;   // 문단당 단어 span (가져오기가 만드는 절대좌표 span)

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ` — ${extra}` : '')); }
};

// ── ① 소스 계약: 전수 조사 패턴이 되살아나지 않았는가 ────────────────────
{
  const raw = fs.readFileSync(path.resolve(new URL('..', import.meta.url).pathname, 'sdynotes.js'), 'utf8');
  // 주석에 적어 둔 '예전 코드' 설명이 검사에 걸리지 않게 줄 주석을 걷어낸다.
  const js = raw.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const fnSrc = (name) => {
    const at = js.indexOf('function ' + name + '(');
    assert.ok(at >= 0, name + ' 함수가 있어야 한다');
    const end = js.indexOf('\n    }', at);
    return js.slice(at, end > 0 ? end + 6 : at + 4000);
  };

  const lift = fnSrc('liftLayers');
  check('liftLayers 는 올라와 있는 종이만 본다 (전체 .paper 훑기 금지)',
    /mountedShells/.test(lift));
  check('레이어 판정은 subtree 하위선택자가 아니라 직계 자식만 본다',
    /firstElementChild/.test(fnSrc('_layerLift'))
    && !/p\.querySelector\('\.tb\.sel/.test(js));

  const decIdx = js.indexOf('function decodeTextMarkup');
  const decSrc = js.slice(decIdx, decIdx + 900);
  check('decodeTextMarkup 은 표식이 없는 html 을 파싱하지 않는다',
    /_DEC_RE/.test(decSrc) && /return src;/.test(decSrc));

  const locSrc = fnSrc('findElLoc');
  check('findElLoc 은 캐시를 쓰되 반환 전에 그 자리를 검증한다',
    /_elLocCache/.test(locSrc) && /e\.id===id/.test(locSrc));

  check('편집 상자는 전체 훑기 대신 O(1) 캐시로 찾는다',
    /function _activeEditBox\(\)/.test(js)
    && /_activeEditBoxFor\(id\)/.test(js)
    && !/=\s*document\.querySelector\('#pagesStage \.tb\.edit\[data-id/.test(js));
  check('표 칸 선택 해제는 칠해 둔 칸만 되돌린다',
    /_tblCellPainted/.test(fnSrc('paintTblCellSelection')));
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-heavy-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
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
  const ins = await q({ table: 'notebooks', op: 'insert', values: [{ title: '그림 많은 논문', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const nid = ins.data.id;

  const pages = [];
  for (let i = 0; i < PAGES; i++) {
    const els = [];
    els.push({ type: 'image', id: `bg${i}`, url: `/api/img/bg${i}.png`, x: 0, y: 0, w: 800, h: 1100, isBg: 1, locked: true });
    for (let g = 0; g < 2; g++)
      els.push({ type: 'image', id: `f${i}_${g}`, url: `/api/img/f${i}_${g}.png`, x: 60, y: 200 + g * 380, w: 300, h: 240 });
    for (let k = 0; k < BOXES; k++) {
      let html = '';
      for (let s = 0; s < SPANS; s++)
        html += `<span data-fs="11" style="position:absolute;left:${s * 26}px;top:0px;line-height:14px;font-size:11px;white-space:nowrap">단어${s}<i class="zsp"> </i></span>`;
      els.push({ type: 'text', id: `t${i}_${k}`, x: 40 + (k % 2) * 380, y: 60 + Math.floor(k / 2) * 60,
                 w: 350, h: 52, html, fontSize: 11, font: 'pretendard', align: 'left', tight: 1 });
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

  const boot = Date.now();
  while (Date.now() - boot < 15_000 && !document.querySelector('.note-stack .note-card')) await wait(60);
  const card = [...document.querySelectorAll('.note-stack .note-card')]
    .find(c => (c.textContent || '').includes('그림 많은 논문'));
  check('홈에 논문 카드가 보인다', !!card);

  const tOpen = Date.now();
  card.click();
  const openUntil = Date.now() + 25_000;
  while (Date.now() < openUntil && ev('typeof doc==="object"&&doc?doc.pages.length:0') !== PAGES) await wait(40);
  const paintUntil = Date.now() + 15_000;
  while (Date.now() < paintUntil && !document.querySelector('#pagesStage .paper .tb')) await wait(30);
  const openMs = Date.now() - tOpen;
  console.log(`    · 열기 ${openMs}ms · page-wrap ${wraps()} · 쪽당 ${3 + BOXES}요소 / ${BOXES * SPANS} span`);
  check('그림 많은 논문이 열린다', ev('doc.pages.length') === PAGES);
  check('첫 화면 글상자가 그려진다', !!document.querySelector('#pagesStage .paper .tb'));
  // 열기 예산: 가상화 덕에 쪽수와 무관해야 한다 (넉넉한 상한 — 느려지면 잡힌다)
  check(`여는 데 8초를 넘지 않는다 (실제 ${openMs}ms)`, openMs < 8000, `${openMs}ms`);

  // 뷰포트를 흉내 낸다 (jsdom 은 레이아웃이 없어 clientHeight 가 0)
  ev(`(function(){
    const b=document.getElementById('editorBody');
    let st=0;
    Object.defineProperty(b,'clientHeight',{configurable:true,get(){return 900;}});
    Object.defineProperty(b,'clientWidth',{configurable:true,get(){return 1200;}});
    Object.defineProperty(b,'scrollTop',{configurable:true,get(){return st;},set(v){st=Math.max(0,v);}});
  })()`);

  // 초기 동기화(자기 op 에코)가 잦아든 뒤 스크롤만 잰다
  await wait(6000);

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
    const p50 = samples[Math.floor(samples.length * 0.5)];
    const p95 = samples[Math.floor(samples.length * 0.95)];
    const worst = samples[samples.length - 1];
    console.log(`    · [${label}] p50 ${p50}ms / p95 ${p95}ms / 최악 ${worst}ms · wrap ${wraps()}`);
    return { p50, p95, worst };
  };

  // 예산 근거: 고치기 전 같은 문서에서 p95 5,900ms · 최악 35,000ms 였다.
  // jsdom 은 실제 브라우저보다 훨씬 느리므로 상한은 넉넉히 두되, 전수 조사가
  // 되살아나면(=초 단위로 튀면) 반드시 걸리도록 잡는다.
  const slow = await scrollRun('느린 스크롤 40px/f', 40, 40);
  check(`느린 스크롤 p95 < 1.5초 (실제 ${slow.p95}ms)`, slow.p95 < 1500, `p95=${slow.p95}ms`);
  check(`느린 스크롤 최악 프레임 < 3초 (실제 ${slow.worst}ms)`, slow.worst < 3000, `worst=${slow.worst}ms`);

  const mid = await scrollRun('보통 스크롤 120px/f', 120, 40);
  check(`보통 스크롤 p95 < 1.5초 (실제 ${mid.p95}ms)`, mid.p95 < 1500, `p95=${mid.p95}ms`);
  check(`보통 스크롤 최악 프레임 < 3초 (실제 ${mid.worst}ms)`, mid.worst < 3000, `worst=${mid.worst}ms`);

  const fast = await scrollRun('빠른 스크롤 400px/f', 400, 40);
  check(`빠른 스크롤 p95 < 1.5초 (실제 ${fast.p95}ms)`, fast.p95 < 1500, `p95=${fast.p95}ms`);
  check(`빠른 스크롤 최악 프레임 < 3초 (실제 ${fast.worst}ms)`, fast.worst < 3000, `worst=${fast.worst}ms`);

  check('스크롤해도 종이 수는 창 크기로 유지된다', wraps() <= 30, `wrap=${wraps()}`);
  check('문서 데이터는 그대로다', ev('doc.pages.length') === PAGES
    && ev(`(doc.pages[${PAGES - 1}].els||[]).length`) === 3 + BOXES);

  // 스크롤이 멎으면 그 쪽 내용이 채워진다 (가상화 불변 조건)
  const cur = ev('curPageIdx');
  const filled = Date.now() + 4000;
  while (Date.now() < filled && !(document.querySelector(`#pagesStage .paper[data-page-idx="${cur}"] .tb`))) await wait(60);
  check('멈춘 자리의 내용이 채워진다',
    !!document.querySelector(`#pagesStage .paper[data-page-idx="${cur}"] .tb`));

  const fatal = errors.filter(m => !/Not implemented|scrollIntoView|Could not load/.test(String(m)));
  if (fatal.length) console.log(fatal.slice(0, 3).join('\n---\n'));
  check('무거운 문서 스크롤 중 치명적 런타임 오류가 없다', fatal.length === 0);
} finally {
  await closeDoms([dom]);
  child.kill('SIGTERM');
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(`\n무거운 논문 스크롤: PASS ${pass} / FAIL ${fail}`);
if (fail) process.exit(1);
