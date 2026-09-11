/* 14.45 · '찾기' 버튼 — 고른 글자 → 해돌이 설명 계약
   ---------------------------------------------------------------------------
   보고: "텍스트를 선택 후 찾기 버튼 있잖아. 그거 현재 동작 안해."
     메뉴를 누르는 순간 브라우저가 선택을 지워서, 예전 '찾기'(문서 찾기 바를
     여는 것)는 아무 일도 안 생기던 경우가 많았다.
   요청: 그 버튼을 누르면 고른 텍스트를 바로 해돌이가 설명해 주기를 원한다.
   계약:
     1) 소스 — 선택 우클릭 메뉴의 항목은 "'…' 해돌이 설명"(로봇 아이콘)이고,
        sel-find 브랜치는 더 이상 찾기 바(openFind/runFind)를 열지 않는다.
        현재 선택이 없으면 restoreSel() 로 되살려서 보내고, 그래도 없으면
        토스트로 알려 준다.
     2) 소스 — sdyAiExplain 은 검색창 Enter(sdyAiRun)의 말투 라우팅
        (!편집·/앱·/버그·/사진…)를 거치지 않고 무조건 chat 으로 보낸다 —
        고른 글이 ! 나 / 로 시작해도 편집·앱 실행으로 빠지지 않는다.
     3) 런타임(jsdom) — 글을 고르고 '해돌이 설명'을 누르면 task:'chat' 요청이
        고른 글자를 문장에 담아 나가고, 답은 해돌이 말풍선(#aiSay)에 뜬다.
        선택이 지워진 상태(버그 재현 조건)에서도 저장된 선택(savedRange)을
        되살려 같은 요청이 나가고, 찾기 바는 열리지 않는다. */
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

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };

// ── 1) 소스 계약 ────────────────────────────────────────────────────────────
const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const js = fs.readFileSync(path.join(REPO, 'sdynotes.js'), 'utf8');

// sel-find 브랜치의 중괄호 바디를 균형 맞춰 잘라 낸다
function branchBody(marker) {
  const i = js.indexOf(marker);
  if (i < 0) return null;
  const b = js.indexOf('{', i);
  let depth = 0;
  for (let k = b; k < js.length; k++) {
    if (js[k] === '{') depth++;
    else if (js[k] === '}') { depth--; if (depth === 0) return js.slice(i, k + 1); }
  }
  return null;
}
const body = branchBody("else if(a==='sel-find'){");
check('소스: sel-find 브랜치가 있다', !!body);
check("'찾기'는 더 이상 문서 찾기 바를 안 연다 (openFind/runFind 없음)",
  /sel-find/.test(body) && !/openFind\(\)/.test(body) && !/runFind\(/.test(body));
check('현재 선택이 없으면 restoreSel() 로 되살려서 보낸다',
  /restoreSel\(\)/.test(body) && /String\(window\.getSelection\(\)/.test(body));
check('고른 글자를 담은 설명 요청을 sdyAiExplain 으로 보낸다',
  /window\.sdyAiExplain\(/.test(body) && /설명해 줘/.test(body));
check('아무것도 고르지 않았다면 토스트로 알려 준다 (아무 일도 없이 죽지 않음)',
  /toast\(/.test(body));
check("메뉴: 항목은 \"'…' 해돌이 설명\"(로봇 아이콘)",
  /\{a:'sel-find',\s*i:'ri-robot-line',\s*t:`'\$\{esc\(short\)\}' 해돌이 설명`\}/.test(js));
check('메뉴: 예전 "… 찾기" 라벨은 사라졌다',
  !/\{a:'sel-find'[\s\S]{0,120}?찾기`/.test(js));
check('도움말: 선택 우클릭 줄이 "해돌이 설명" 이다',
  /'글자를 고르고 우클릭','번역 · 서식 · 글자색 · 링크 · 해돌이 설명 · 새 상자로 빼내기'/.test(js));
check('sdyAiExplain: 무조건 chat (검색창 말투 라우팅 sdyAiRun 을 안 거친다)',
  /window\.sdyAiExplain=function\(q\)\{[\s\S]{0,600}?run\('chat',q\);/.test(js)
  && !/sdyAiExplain=function\(q\)\{[\s\S]{0,600}?sdyAiRun\(/.test(js)
  && !/sdyAiExplain=function\(q\)\{[\s\S]{0,600}?editCmdOf\(/.test(js));
check('회귀: Ctrl+F 문서에서 찾기(바)는 그대로다',
  /function toggleFind\(\)/.test(js) && /function openFind\(\)/.test(js)
  && /function runFind\(q\)/.test(js) && /\['Ctrl \+ F','문서에서 찾기'\]/.test(js));

// ── 2) 런타임 (jsdom) ───────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-selexplain-'));
process.env.SDY_BASE_DIR = TMP;
for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
fs.mkdirSync(path.join(TMP, 'src'), { recursive: true });
for (const f of fs.readdirSync(path.join(REPO, 'src'))) {
  const from = path.join(REPO, 'src', f), to = path.join(TMP, 'src', f);
  if (fs.statSync(from).isDirectory()) continue;
  fs.copyFileSync(from, to);
}
async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port; await new Promise(r => s.close(r)); return p;
}
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/src/index.js'], {
  cwd: REPO,
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
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '설명계약', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [{ type: 'text', id: 't1', x: 40, y: 40, w: 340, h: 80,
      html: '광합성은 식물이 빛을 쓰는 과정입니다', fontSize: 16, font: 'jua' }] }],
  };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: id, content: JSON.stringify(doc0), font_size: 16 }], filters: [] });

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
      window.cancelIdleCallback = clearTimeout;
      window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
      window.cancelAnimationFrame = clearTimeout;
      window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect(){}, drawImage(){}, fillRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, arc(){}, fill(){}, save(){}, restore(){}, scale(){}, translate(){}, setTransform(){}, measureText(){return {width:10}}, getImageData(){return {data:new Uint8ClampedArray(4)}}, putImageData(){} });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class { constructor(){this.paused=true;} play(){return Promise.resolve()} pause(){} addEventListener(){} removeEventListener(){} };
      window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
    },
  });
  const { window } = dom, { document } = window;
  const boot = Date.now();
  while (Date.now() - boot < 8_000 && document.querySelectorAll('.note-stack .note-card,.pro-grid .note-card').length < 1) await wait(60);
  const card = [...document.querySelectorAll('.note-stack .note-card,.pro-grid .note-card')].find(c => (c.textContent || '').includes('설명계약'));
  check('런타임: 노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1600);
  check('런타임: 에디터가 열린다', document.getElementById('editorView').classList.contains('open'));

  const tb = document.querySelector('#pagesStage .tb[data-id="t1"]');
  const content = tb.querySelector('.tb-content');
  const sel = () => window.getSelection();
  check('런타임: 고를 글자가 그려졌다', (content.textContent || '').includes('광합성'));
  content.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, detail: 2 }));
  await wait(200);
  check('런타임: 더블클릭으로 편집 모드에 들어간다', tb.classList.contains('edit'));
  content.innerHTML = '광합성은 식물이 빛을 쓰는 과정입니다';
  const r = document.createRange(); r.setStart(content.firstChild, 0); r.setEnd(content.firstChild, 3);
  sel().removeAllRanges(); sel().addRange(r); window.saveSel();
  check('런타임: "광합성" 을 골랐다', String(sel()) === '광합성');

  // 우클릭 메뉴 열기 (pointerdown button=2 → contextmenu)
  let items = null;
  const origMenu = window.editorMenu;
  window.editorMenu = it => { items = it; };
  content.dispatchEvent(new window.MouseEvent('pointerdown',
    { bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: 120, clientY: 120 }));
  await wait(30);
  content.dispatchEvent(new window.MouseEvent('contextmenu',
    { bubbles: true, cancelable: true, button: 2, clientX: 120, clientY: 120 }));
  window.editorMenu = origMenu;
  const flat = [];
  const walk = arr => (arr || []).forEach(it => { if (it && it.a) flat.push(it); else if (it && it.items) walk(it.items); });
  walk(items);
  const item = flat.find(it => it.a === 'sel-find');
  check('런타임: 우클릭 메뉴에 "해돌이 설명" 항목이 있다',
    !!item && item.i === 'ri-robot-line' && /해돌이 설명/.test(item.t) && /광합성/.test(item.t));

  // /api/ai/ask 만 가로채서 요청 본문을 잡아 둔다 (나머지는 실제 서버로)
  const askCalls = [];
  const realFetch = window.fetch;
  const AI_ANSWER = '광합성은 식물이 빛 에너지를 화학 에너지로 바꾸는 과정이에요.';
  window.fetch = (input, init) => {
    const url = String(typeof input === 'string' ? input : (input && input.url) || input);
    if (url.includes('/api/ai/ask')) {
      askCalls.push(JSON.parse((init && init.body) || '{}'));
      const done = { ok: true, text: AI_ANSWER, provider: 'test', model: 'test-model', cached: false };
      const raw = `event: delta\ndata: ${JSON.stringify({ t: AI_ANSWER })}\n\nevent: done\ndata: ${JSON.stringify(done)}\n\n`;
      const bytes = new TextEncoder().encode(raw);
      let sent = false;
      return Promise.resolve({
        status: 200,
        headers: { get: () => 'text/event-stream; charset=utf-8' },
        body: { getReader: () => ({ read: async () =>
          sent ? { done: true } : ((sent = true), { done: false, value: bytes }) }) },
      });
    }
    return realFetch(input, init);
  };
  const say = () => document.getElementById('aiSay');
  const outEl = () => document.getElementById('aiOut');

  // ① 선택이 살아 있는 상태에서 '해돌이 설명' 을 누른다
  askCalls.length = 0;
  await window.editorAction('sel-find');
  await wait(200);
  check('런타임: 고른 글자가 chat 질문으로 나간다 (task:chat)',
    askCalls.length === 1 && askCalls[0].task === 'chat', JSON.stringify(askCalls));
  check('런타임: 질문에는 고른 글자("광합성")와 설명 요청이 담겨 있다',
    askCalls[0] && /광합성/.test(askCalls[0].question) && /설명해 줘/.test(askCalls[0].question));
  check('런타임: 노트 글도 같이 간다 (문맥 설명)',
    askCalls[0] && /광합성은 식물이 빛을 쓰는 과정입니다/.test(askCalls[0].text));
  check('런타임: 답은 해돌이 말풍선(#aiSay)에 뜬다',
    say().hidden === false && outEl().textContent.includes(AI_ANSWER));

  // ② 메뉴를 누르는 순간 브라우저가 선택을 지운 경우 — 저장된 선택으로 되살려야 한다
  sel().removeAllRanges();
  check('런타임: 선택이 지워졌다 (예전 "동작 안 함" 조건 재현)', sel().isCollapsed);
  askCalls.length = 0;
  await window.editorAction('sel-find');
  await wait(200);
  check('런타임: 선택이 지워져도 savedRange 로 되살려 같은 설명 요청이 나간다',
    askCalls.length === 1 && askCalls[0].task === 'chat'
    && /광합성/.test(askCalls[0].question), JSON.stringify(askCalls));
  check('런타임: "해돌이 설명" 은 문서 찾기 바를 열지 않는다',
    !document.getElementById('findBar').classList.contains('show'));

  // ③ 아무것도 고르지 않았다면 조용히 죽지 않고 토스트가 보인다
  //   (편집 중인 상자에 캐럿만 있으면 saveSel 이 savedRange 를 비운다)
  const rc = document.createRange(); rc.setStart(content.firstChild, 0); rc.collapse(true);
  sel().removeAllRanges(); sel().addRange(rc); window.saveSel();
  check('런타임: 선택·저장 선택이 모두 비었다 (아무것도 안 고른 상태)',
    sel().isCollapsed && !String(sel()));
  askCalls.length = 0;
  await window.editorAction('sel-find');
  await wait(60);
  const toastEl = document.getElementById('toast');
  check('런타임: 아무것도 안 고르면 요청이 안 나가고 토스트가 보인다',
    askCalls.length === 0 && toastEl.classList.contains('show')
    && /텍스트를 드래그해 선택하세요/.test(toastEl.textContent),
    `calls=${askCalls.length} toast="${toastEl.textContent}"`);

  check('런타임: 치명적 런타임 오류가 없다', errors.length === 0, errors.join(' | '));
  console.log(`\n'찾기' 버튼 → 해돌이 설명: PASS ${pass}`);
} catch (e) {
  console.error('FAIL: ' + (e && e.stack || e));
  console.error('server log:\n' + log);
  throw e;
} finally {
  try { child.kill('SIGTERM'); } catch {}
  await closeDoms([dom]);
}
