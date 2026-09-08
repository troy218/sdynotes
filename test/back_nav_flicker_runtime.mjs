/* 14.39.4 · 뒤로가기 깜빡임 회귀 테스트
   (사용자 보고: "뒤로가기 누르면 한번 화면이 프레시가 되면서 깜빡이는 버그가 있어")

   세 가지 원인을 함께 잡았다.

   ⓐ 브라우저·폰의 뒤로가기를 앱이 잡지 못했다 — 이름 가림.
      이 번들은 모든 파트가 한 어휘 스코프를 공유하는데, 01-core.js 의
      `let history=[]`(되돌리기 스택)가 `window.history` 를 가린다. 그래서
      openNav 의 `history.pushState()` 와 navBack 의 `history.back()` 은 매번
      "…is not a function" 예외를 내고 catch 에 삼켜졌다 → 히스토리 항목이
      한 번도 쌓이지 않았다. 툴바 ← 버튼은 catch 의 '직접 닫기'로 동작해서
      멀쩡해 보였지만, **브라우저 뒤로가기·옆으로 밀어 돌아가기는 앱을
      빠져나가며 문서를 통째로 다시 실었다** = 화면이 새로고침되며 깜빡임.
      → nav 코드가 window.history 를 명시적으로 부르고, '층마다 항목'이 아니라
        보초 항목 하나로 뒤로가기 한 번 = 가장 위 층 하나 닫기를 맞춘다.
   ⓑ 에디터를 닫는 순간 종이(#pagesStage)를 비웠다 → .4s 동안 빠져나가는
      패널이 빈 하얀 판 → 화면이 한 번 번쩍.
      → 슬라이드아웃이 끝난 뒤(400ms 타이머)에 teardownEditorStage() 로 정리.
   ⓒ 홈으로 돌아오면 loadNBs → renderGrid 가 카드 DOM을 새로 만들면서
      미리보기를 '빈 프레임'으로 두고 rAF/네트워크로 다시 채웠다 → 홈 전체가
      하얗게 비었다가 채워지는 새로고침 깜빡임.
      → 그려 둔 미리보기 HTML을 기억했다가 카드를 다시 만들 때 동기적으로 얹는다.

   실행: node test/back_nav_flicker_runtime.mjs   (npm run test:backnav) */
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import jsdom from 'jsdom';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { installWindowGuard, closeDoms } from './jsdom_guard.mjs';
const { JSDOM, VirtualConsole } = jsdom;

const pass = [];
const check = (name, cond, extra = '') => {
  assert.ok(cond, name + (extra ? ` → ${extra}` : ''));
  pass.push(name); console.log('  ✓ ' + name);
};
const wait = ms => new Promise(r => setTimeout(r, ms));

// 데이터 루트 격리 — 공유 db 를 쓰면 테스트가 서로 오염된다
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-backnav-'));
process.env.SDY_BASE_DIR = TMP;
{
  // 서버는 SDY_BASE_DIR 에서 프런트 파일도 읽는다 — 저장소와 함께 격리한다.
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
  fs.mkdirSync(path.join(TMP, 'src'), { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO, 'src'))) {
    const from = path.join(REPO, 'src', f), to = path.join(TMP, 'src', f);
    if (fs.statSync(from).isDirectory()) continue;   // src/app 메가파트는 번들된 sdynotes.js 로만 제공
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
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);

let dom;
let polling = false;
try {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died');
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }
  // 노트 4개 + 본문 (미리보기가 실제로 그려져야 깜빡임을 잴 수 있다)
  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  for (const t of ['라면 노트', '떡볶이 노트', '초밥 노트', '김밥 노트']) {
    const ins = await q({ table: 'notebooks', op: 'insert', values: [{ title: t, color: '#4f6ef7' }], filters: [], returning: true, single: true });
    const doc = { version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
      pages: [{ id: 'p1', els: [{ type: 'text', id: 't1', x: 40, y: 60, w: 500, h: 300, html: '<b>' + t + '</b> 본문', fontSize: 22 }] }] };
    await q({ table: 'memos', op: 'insert', values: [{ notebook_id: ins.data.id, content: JSON.stringify(doc), font_size: 16 }], filters: [] });
  }

  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = String(e?.message || e); if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errs.push(m); });
  vc.on('error', (...a) => errs.push(a.join(' ')));

  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      installWindowGuard(window);   // close 전 타이머 추적
      window.innerWidth = 1280; window.innerHeight = 800;
      window.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.ResizeObserver = class { observe(){} disconnect(){} };
      window.BroadcastChannel = class { postMessage(){} close(){} addEventListener(){} };
      window.EventSource = class { close(){} addEventListener(){} };
      window.requestIdleCallback = cb => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
      window.cancelIdleCallback = clearTimeout;
      window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
      window.cancelAnimationFrame = clearTimeout;
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function(){};
      window.HTMLCanvasElement.prototype.getContext = () => ({
        clearRect(){}, drawImage(){}, fillRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, arc(){}, fill(){},
        save(){}, restore(){}, scale(){}, translate(){}, setTransform(){}, measureText(){return {width:10}},
        getImageData(){return {data:new Uint8ClampedArray(4)}}, putImageData(){} });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class { constructor(){this.paused=true;} play(){return Promise.resolve()} pause(){} addEventListener(){} removeEventListener(){} };
      window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
      window.addEventListener('error', e => errs.push(e.error?.stack || e.message));
      window.addEventListener('unhandledrejection', e => errs.push('unhandled: ' + (e.reason?.stack || e.reason)));
    }
  });

  const { window } = dom, { document } = window;
  const ev = code => window.eval(code);
  const editorOpen = () => document.getElementById('editorView').classList.contains('open');
  const cards = () => [...document.querySelectorAll('.note-card')];
  const cardOf = word => cards().find(c => (c.textContent || '').includes(word));
  const hState = () => { try { return window.history.state; } catch { return undefined; } };
  const guardN = () => { const s = hState(); return (s && s.sdyNavGuard) ? (s.n ?? -1) : null; };
  const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  // 두 문자열이 어디에서 갈리는지 (미리보기 비교 실패 시 원인 확인용)
  const firstDiff = (a, b) => {
    if (a === b) return '';
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return `@${i} before=…${a.slice(Math.max(0, i - 40), i + 60)}… after=…${b.slice(Math.max(0, i - 40), i + 60)}…`;
  };
  const openNote = async (word) => {
    click(cardOf(word));
    const t = Date.now();
    while (Date.now() - t < 15000 && !editorOpen()) await wait(60);
    await wait(700);                       // 종이 렌더·저장이 자리 잡을 시간
    return editorOpen();
  };
  const waitHome = async () => {
    const t = Date.now();
    while (Date.now() - t < 10000 && ev('typeof curNB==="object"&&!!curNB')) await wait(60);
    await wait(1200);                      // 400ms 타이머 → loadNBs → renderGrid
  };

  // ── 홈이 카드를 다 그리고 미리보기까지 채울 때까지 ──
  const t0 = Date.now();
  while (Date.now() - t0 < 15000 && cards().length < 4) await wait(80);
  const framesReady = () => [...document.querySelectorAll('.note-preview-frame')]
    .filter(f => (f.innerHTML || '').trim().length > 0).length;
  const t1 = Date.now();
  while (Date.now() - t1 < 15000 && framesReady() < 4) await wait(80);
  await wait(600);

  console.log('\n── ① 시작 상태: 홈 미리보기가 다 그려져 있다 ───────────────');
  check('홈에 노트 카드 4장이 있다', cards().length >= 4, `${cards().length}장`);
  check('미리보기 4장이 다 그려져 있다(빈 프레임 없음)', framesReady() >= 4, `${framesReady()}/4`);
  const histBase = window.history.length;
  check('아직 히스토리에 보초 항목이 없다', guardN() === null, JSON.stringify(hState()));

  const grid = document.getElementById('noteGrid');
  const previewBefore = new Map(cards().map(c =>
    [c.dataset.nbId, (c.querySelector('.note-preview-frame') || {}).innerHTML || '']));

  // ── 뒤로가기를 누른 순간부터 홈이 다시 그려지는 전 과정을 촘촘히 관찰 ──
  const samples = [];
  let pollT0 = Date.now();
  const poll = () => {
    if (!polling) return;
    // 검증이 실패해 dom 이 먼저 닫힐 수 있다 — 그때도 폴링이 프로세스를 깨뜨리지 않게
    try {
      const stage = document.getElementById('pagesStage');
      const frames = [...grid.querySelectorAll('.note-preview-frame')];
      samples.push({
        t: Date.now() - pollT0,
        stage: stage ? stage.children.length : -1,
        open: editorOpen(),
        empty: frames.filter(f => !(f.innerHTML || '').trim()).length,
        frames: frames.length,
      });
    } catch { polling = false; return; }
    setTimeout(poll, 3);
  };

  console.log('\n── ② 툴바 뒤로가기(←)로 노트를 닫는다 ─────────────────────');
  check('라면 노트 카드를 찾았다', !!cardOf('라면'));
  check('노트가 열린다', await openNote('라면'));
  check('종이(#pagesStage)에 본문이 그려져 있다',
    document.getElementById('pagesStage').querySelectorAll('.paper').length > 0);
  check('노트를 열면 히스토리 보초가 쌓인다', guardN() === 1, JSON.stringify(hState()));

  const backBtn = document.querySelector('button[onclick="navBack()"]');
  check('툴바에 뒤로가기 버튼이 있다 (onclick=navBack)', !!backBtn);

  polling = true; pollT0 = Date.now(); setTimeout(poll, 3);
  click(backBtn);
  await wait(150);
  check('뒤로가기를 누르면 에디터가 닫히기 시작한다', !editorOpen());
  await wait(1900);
  polling = false;

  // ⓑ 슬라이드아웃(.4s) 동안 종이가 남아 있어야 패널이 하얀 판이 되지 않는다
  const slideOut = samples.filter(s => !s.open && s.t < 340);
  check('닫히는 동안(.4s 슬라이드아웃) 종이 본문이 그대로 남아 있다',
    slideOut.length > 0 && slideOut.every(s => s.stage > 0),
    slideOut.length ? `샘플 ${slideOut.length}개, stage=${slideOut.map(s => s.stage).join('/')}` : '샘플 없음');
  const last = samples[samples.length - 1];
  check('슬라이드아웃이 끝난 뒤에는 종이를 정리한다(홈 뒤에 남지 않는다)',
    last && last.stage === 0, last ? `stage=${last.stage}` : '샘플 없음');
  check('에디터가 완전히 닫히고 홈으로 돌아온다', !editorOpen());
  await waitHome();

  console.log('\n── ③ 홈이 다시 그려지는 동안 미리보기가 한 프레임도 비지 않는다 ──');
  const blank = samples.filter(s => s.frames > 0 && s.empty > 0);
  check('다시 그리는 동안 빈 미리보기 프레임이 관측되지 않는다', blank.length === 0,
    blank.length ? `${blank.length}회 관측 (첫 t+${blank[0].t}ms, 최대 ${Math.max(...blank.map(b => b.empty))}장)` : '');
  check('카드가 아예 사라지는 순간도 없다', samples.every(s => s.frames > 0),
    (samples.find(s => s.frames === 0) || {}).t + 'ms');
  check('방금 본 노트는 최근 편집 줄에 놓인다(기능은 그대로)',
    !!document.querySelector('.recent-row .note-card'));
  const cardA2 = cardOf('라면');
  check('닫고 나면 방금 본 노트가 홈에 보인다', !!cardA2);
  const pvA2 = ((cardA2 && cardA2.querySelector('.note-preview-frame')) || {}).innerHTML || '';
  const pvA1 = (cardA2 && previewBefore.get(cardA2.dataset.nbId)) || '';
  check('미리보기 내용이 열기 전과 같다(빈 프레임 없이 그대로 얹었다)',
    !!cardA2 && pvA2 === pvA1, firstDiff(pvA1, pvA2));

  console.log('\n── ④ 본문을 고치고 돌아오면 미리보기는 새 내용으로 갱신된다 ──');
  check('떡볶이 노트가 열린다', await openNote('떡볶이'));
  ev(`(function(){
        doc.pages[0].els.push({type:'text',id:'t_probe',x:60,y:420,w:420,h:60,fontSize:20,html:'프로브추가문구'});
        flushSaveDoc();
      })()`);
  await wait(400);
  window.navBack();
  await waitHome();
  const cardB2 = cardOf('떡볶이');
  check('편집 후 홈으로 돌아온다', !!cardB2 && !editorOpen());
  const pvB = ((cardB2 && cardB2.querySelector('.note-preview-frame')) || {}).innerHTML || '';
  check('고친 본문이 홈 미리보기에 반영된다(기억해 둔 옛 미리보기에 붙들리지 않는다)',
    pvB.includes('프로브추가문구'), pvB.slice(0, 120));

  console.log('\n── ⑤ 브라우저·폰 뒤로가기: 문서가 다시 실리지 않고 화면만 닫힌다 ──');
  // ⓐ 회귀 — `let history=[]`(되돌리기 스택)가 window.history 를 가려서
  //   pushState/back 이 매번 예외로 삼켜지던 자리.
  ev('openSettings()');
  await wait(200);
  check('설정창이 열린다', document.getElementById('setModal').style.display === 'flex');
  check('window.history 에 보초 항목이 실제로 쌓인다(이름 가림 회귀)',
    guardN() === 1, JSON.stringify(hState()));
  check('보초는 하나다 — 히스토리가 층 수만큼 늘지 않는다',
    window.history.length === histBase + 1, `base=${histBase} now=${window.history.length}`);
  ev('closeSettings()');
  await wait(300);
  check('설정창을 X로 닫는다', document.getElementById('setModal').style.display === 'none');
  check('X로 닫으면 보초도 함께 걷는다(죽은 뒤로가기가 남지 않는다)',
    guardN() === null, JSON.stringify(hState()));

  check('초밥 노트가 열린다', await openNote('초밥'));
  window.__aliveProbe = 'alive';
  const lenBefore = window.history.length;
  window.history.back();          // 브라우저 뒤로가기 버튼·폰 뒤로가기와 같은 길
  await wait(400);
  check('브라우저 뒤로가기 한 번에 에디터가 닫힌다', !editorOpen());
  check('페이지가 다시 실리지 않는다(문서가 그대로 살아 있다)',
    window.__aliveProbe === 'alive' && window.history.length === lenBefore,
    `probe=${window.__aliveProbe} len=${lenBefore}→${window.history.length}`);
  await waitHome();
  check('홈이 정상으로 돌아온다', cards().length >= 4);

  console.log('\n── ⑥ 층이 둘이면 뒤로가기는 한 번에 하나씩 닫는다 ──────────');
  check('김밥 노트가 열린다', await openNote('김밥'));
  ev('openExportModal()');
  await wait(200);
  check('내보내기 창이 열린다', document.getElementById('exportModal').style.display === 'flex');
  check('층이 둘이어도 히스토리 보초는 하나다', guardN() === 2 && window.history.length === histBase + 1,
    `n=${guardN()} len=${window.history.length}`);
  window.history.back();
  await wait(300);
  check('뒤로가기 한 번은 가장 위 층(내보내기 창)만 닫는다',
    document.getElementById('exportModal').style.display === 'none' && editorOpen());
  check('남은 층이 있으니 보초를 다시 얹는다', guardN() === 1, JSON.stringify(hState()));
  window.history.back();
  await wait(300);
  check('다음 뒤로가기는 그 아래 층(에디터)을 닫는다', !editorOpen());
  check('닫을 층이 없으면 보초를 남기지 않는다(다음 뒤로가기는 앱을 나간다)',
    guardN() === null, JSON.stringify(hState()));
  await waitHome();

  console.log('\n── ⑦ 히스토리를 못 쓰는 환경에서는 페이지를 이탈하지 않는다 ──');
  // 샌드박스 iframe·file:// 등: pushState 가 실패하면 history.back() 도 부르면
  // 안 된다 — 앱 밖으로 나가면서 문서가 통째로 다시 실린다(= 화면 깜빡임).
  const hist = window.history;
  const realPush = hist.pushState, realBack = hist.back;
  let backCalls = 0;
  hist.pushState = () => { throw new window.DOMException('blocked', 'SecurityError'); };
  hist.back = function () { backCalls++; return realBack.apply(this, arguments); };
  try {
    ev('openSettings()');
    await wait(200);
    check('pushState가 실패해도 화면(설정창)은 열린다',
      document.getElementById('setModal').style.display === 'flex');
    window.navBack();
    await wait(200);
    check('히스토리를 못 쌓았으면 history.back() 대신 곧바로 닫는다',
      document.getElementById('setModal').style.display === 'none' && backCalls === 0,
      `history.back 호출 ${backCalls}회`);
  } finally {
    hist.pushState = realPush; hist.back = realBack;
    // 내부 상태도 되돌린다 (이 환경 플래그는 끈적하다)
    ev('_navNoHist=false; _navGuard=false; _navCollapsing=false; _nav.length=0;');
    await wait(150);
  }
  ev('openSettings()'); await wait(200);
  check('되돌린 뒤 히스토리 경로가 다시 산다', guardN() === 1, JSON.stringify(hState()));
  ev('closeSettings()'); await wait(300);

  console.log('\n── ⑧ 닫는 길 전부 같은 마무리를 쓴다 (소스 계약) ────────────');
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  const src = f => fs.readFileSync(path.join(REPO, 'src/app', f), 'utf8');
  const nav = src('10a-place-keys.js');
  const navBlock = nav.slice(nav.indexOf('// ============ 뒤로가기(브라우저 히스토리) 처리'),
                             nav.indexOf('// 열려 있는 것 중 가장 위를 닫는다'));
  // 주석에는 옛 버그를 설명하려고 'history.pushState' 같은 글이 그대로 있다 —
  // 실제 코드 줄만 추려서 본다.
  const navCode = navBlock.split('\n')
    .map(l => l.replace(/\s*\/\/.*$/, ''))   // 이 블록에는 '//' 가 들어간 문자열이 없다
    .filter(l => l.trim().length)
    .join('\n');
  check('nav 코드는 window.history 를 명시적으로 쓴다',
    /window\.history\.pushState\(/.test(navCode) && /window\.history\.back\(\)/.test(navCode));
  check('되돌리기 스택(history)에 가려진 맨 history.pushState/back 호출이 없다',
    !/(^|[^.\w])history\.(pushState|replaceState|back)\(/.test(navCode));
  check('보초 항목 방식 — 층이 늘어도 replaceState 로 하나만 쓴다',
    /window\.history\.replaceState\(\{\[_NAV_GUARD\]:1,n:_nav\.length\}/.test(navCode));
  check('히스토리를 못 쓰는 환경에서는 곧바로 닫는 갈래가 있다',
    /if\(_navNoHist\|\|!_navGuard\)\{ _navClose\(_nav\.pop\(\)\); _navStamp\(\); return; \}/.test(navBlock));

  const edOpen = src('05a-editor-open.js');
  const closeFn = edOpen.slice(edOpen.indexOf('function closeEditor()'), edOpen.indexOf('let saveStateTimer'));
  check('closeEditor 가 종이를 즉시 비우지 않는다',
    !/resetPageWork\(\);\s*\n\s*document\.getElementById\('pagesStage'\)\.innerHTML='';/.test(closeFn));
  check('closeEditor 는 슬라이드아웃 뒤에 teardownEditorStage() 로 정리한다',
    /_closeEdT=setTimeout\(async\(\)=>\{\s*\n\s*window\._closeEdT=null;[\s\S]{0,200}?teardownEditorStage\(\);/.test(closeFn));
  check('openNB 가 닫기 예약을 취소할 때도 종이를 정리한다',
    /clearTimeout\(window\._closeEdT\);[\s\S]{0,400}teardownEditorStage\(\);/.test(edOpen));
  const ctx = src('14a-ctx-menu.js');
  const delFn = ctx.slice(ctx.indexOf('async function delNB()'), ctx.indexOf("document.getElementById('edTitle')"));
  check('노트 삭제 길도 in-editor 를 풀고 종이를 정리한다',
    delFn.includes("classList.remove('in-editor')") && /teardownEditorStage\(\);/.test(delFn));

  const stack = src('02c-home-stack.js');
  check('홈 카드는 그려 둔 미리보기를 동기적으로 얹는다',
    /pvPaintApply\(card,nb\.id,cfgRevOf\(nb\.id\)\)/.test(stack)
    && /pvPaintStore\(nb\.id,cfgRevOf\(nb\.id\),f\.innerHTML,rs\.w,rs\.h,f\)/.test(stack));
  check('미리보기 배율(transform)도 함께 기억한다 — 제자리 뛰는 프레임이 없게',
    /tf:\(fst&&fst\.transform\)\|\|''/.test(stack)
    && /if\(e\.tf\)\{ f\.style\.transform=e\.tf;/.test(stack));
  check('잠긴 노트는 미리보기 기억을 쓰지 않는다', /if\(locked\) pvPaintDrop\(nb\.id\);/.test(stack));
  check('nb_* 를 쓸 때마다 개정 번호가 오른다(미리보기 기억 무효화)',
    /function setCfg\(id,c\)\{ _cfgRevBump\(id\);/.test(src('02a-home-shell.js')));

  const fatal = errs.filter(Boolean);
  check('치명적 JS 오류 없음', fatal.length === 0, fatal.slice(0, 3).join(' | '));
  if (fatal.length) console.log('ERRORS:\n' + fatal.slice(0, 5).join('\n---\n'));

  console.log(`\nPASS ${pass.length}`);
} catch (e) {
  console.error('FAIL:', e);
  if (log) console.error('server log:\n' + log.slice(-2000));
  process.exitCode = 1;
} finally {
  polling = false;
  await closeDoms([dom]);
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  fs.rmSync(TMP, { recursive: true, force: true });
}
