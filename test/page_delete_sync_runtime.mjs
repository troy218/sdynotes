/* 페이지 삭제 뒤 재진입 시 '서로 다른 쪽의 요소가 한 페이지에 뭉치는' 회귀 검증

   사용자 보고: 페이지를 삭제하고 나중에 노트를 다시 열면, 어떤 페이지들의
   내부 요소가 같은 페이지에 함께 들어가는 경우가 있다.

   원인: 요소 단위 동기화(op)의 page 필드는 '보낸 시점의 쪽 번호'다. 페이지를
   지우면 그 뒤쪽 요소들의 번호가 한 칸씩 밀리는데, 삭제 당시에는 그 요소들의
   내용이 그대로라 put op 이 다시 나가지 않는다 → 서버에는 옛 쪽 번호가 남는다.
   재진입 후 pull 이 __pages__ 로 페이지 목록을 먼저 맞춘 뒤, 옛 쪽 번호의
   put op 을 적용하며 요소를 엉뚱한 쪽(주로 마지막 쪽)으로 옮겨 겹쳐 놓았다.

   수정: upsertEl 은 이미 메모리에 있는 요소를 op.page 대로 옮기지 않고,
   그 자리에서 덮어쓴다(쪽 이동은 id 를 바꿔 복사하는 방식이라 id 가 같은 요소가
   쪽을 옮길 정상 경로가 없다).

   실행: node test/page_delete_sync_runtime.mjs   (npm run test:pages) */
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-pagedel-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
  fs.mkdirSync(path.join(TMP, 'src'), { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO, 'src'))) {
    const from = path.join(REPO, 'src', f), to = path.join(TMP, 'src', f);
    if (fs.statSync(from).isDirectory()) continue;
    fs.copyFileSync(from, to);
  }
}

let passed = 0;
const check = (name, cond, extra = '') => { assert.ok(cond, name + (extra ? ` → ${extra}` : '')); passed++; console.log('  ✓ ' + name); };

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
  cwd: path.resolve(new URL('..', import.meta.url).pathname),
  env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);

const textEl = (id, html) => ({ id, type: 'text', x: 60, y: 60, w: 220, h: 60, html, fontSize: 16 });

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
  const ins = await q({ table: 'notebooks', op: 'insert', values: [{ title: '페이지 삭제 동기화', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const nid = ins.data.id;

  // ── 삭제 '후'의 올바른 상태: 3쪽 (p1, p3, p4 — p2 는 이미 지워졌다) ──
  const seedDoc = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [
      { id: 'p1', els: [textEl('e1', '<div>하나</div>')] },
      { id: 'p3', els: [textEl('e3', '<div>셋</div>')] },
      { id: 'p4', els: [textEl('e4', '<div>넷</div>')] },
    ],
  };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: nid, content: JSON.stringify(seedDoc), font_size: 16 }], filters: [] });

  // ── 삭제가 남긴 '옛 쪽 번호' ops 기록 (서버가 이걸 그대로 돌려준다) ──
  //   p2(그리고 e2)가 있던 시절의 put: e1@0, e2@1, e3@2, e4@3 →
  //   p2 삭제 → del e2 + __pages__ [p1, p3, p4]. e3·e4 의 put 은 다시 안 나간다.
  const ops = [
    { id: 'e1', kind: 'put', page: 0, rev: 1001, dev: 'dA', data: textEl('e1', '<div>하나</div>') },
    { id: 'e2', kind: 'put', page: 1, rev: 1002, dev: 'dA', data: textEl('e2', '<div>둘</div>') },
    { id: 'e3', kind: 'put', page: 2, rev: 1003, dev: 'dA', data: textEl('e3', '<div>셋</div>') },
    { id: 'e4', kind: 'put', page: 3, rev: 1004, dev: 'dA', data: textEl('e4', '<div>넷</div>') },
    { id: 'e2', kind: 'del', rev: 1005, dev: 'dA' },
    { id: '__pages__', kind: 'pages', rev: 1006, dev: 'dA', ids: ['p1', 'p3', 'p4'] },
  ];
  const pushed = await fetch(base + '/api/sync/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nb: String(nid), ops }),
  }).then(r => r.json());
  check('옛 쪽 번호 ops 가 서버에 저장된다', pushed && pushed.ok, JSON.stringify(pushed));

  // ── 클라이언트가 나중에 노트를 연다 (재진입) ──
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
      window.cancelIdleCallback = clearTimeout;
      window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
      window.cancelAnimationFrame = clearTimeout;
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function(){};
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
  const openUntil = Date.now() + 8_000;
  let card = null;
  while (Date.now() < openUntil && !card) {
    card = [...document.querySelectorAll('.note-stack .note-card,.pro-grid .note-card')]
      .find(c => String(c.dataset.nbId || '') === String(nid));
    if (!card) await wait(60);
  }
  check('홈에 이번 노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const untilOpen = Date.now() + 6_000;
  while (Date.now() < untilOpen && !document.getElementById('editorView').classList.contains('open')) await wait(60);
  check('노트가 열린다', document.getElementById('editorView').classList.contains('open'));

  // initSync(60ms) → pullSync 가 옛 쪽 번호 ops 를 적용할 때까지 기다린다.
  await wait(2200);

  const doc = window._sdy && window._sdy.doc;
  check('문서에 접근할 수 있다', !!doc && Array.isArray(doc.pages));
  check('페이지는 3쪽으로 유지된다(지운 쪽이 되살아나지 않는다)', doc && doc.pages.length === 3,
    doc && JSON.stringify(doc.pages.map(p => p.id)));

  const pageElIds = () => (doc.pages || []).map(p => (p.els || []).map(e => e.id).join(',')).join(' | ');
  const dump = pageElIds();
  // 핵심 회귀: e3 가 e4 쪽으로 밀려 겹치지 않고, 각자 자기 쪽에 남는다.
  check('p1 쪽에는 e1 만 남는다', doc && (doc.pages[0].els || []).length === 1 && doc.pages[0].els[0].id === 'e1', dump);
  check('p3 쪽에는 e3 만 남는다(다른 쪽 요소가 섞이지 않는다)', doc && (doc.pages[1].els || []).length === 1 && doc.pages[1].els[0].id === 'e3', dump);
  check('p4 쪽에는 e4 만 남는다', doc && (doc.pages[2].els || []).length === 1 && doc.pages[2].els[0].id === 'e4', dump);
  check('지워진 쪽(e2)의 요소는 어디에도 없다',
    doc && !doc.pages.some(p => (p.els || []).some(e => e.id === 'e2')), dump);

  const fatal = errors.filter(Boolean);
  if (fatal.length) console.log('runtime errors:\n' + fatal.slice(0, 8).join('\n---\n'));
  check('재진입 중 치명적 런타임 오류가 없다', fatal.length === 0);

  console.log(`\n페이지 삭제 재진입 동기화: PASS ${passed} / FAIL 0`);
} catch (e) {
  console.error('\n페이지 삭제 재진입 동기화 실패:', e);
  if (log) console.error('\nserver log:\n' + log.slice(-2500));
  process.exitCode = 1;
} finally {
  await closeDoms([dom]);
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  fs.rmSync(TMP, { recursive: true, force: true });
}
