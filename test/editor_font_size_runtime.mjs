/* 글상자 글자 크기 런타임 검증

   사용자가 겪던 일:
     Alt+휠로 상자를 키우면 겉테두리뿐 아니라 안의 글씨도 같이 커진다(좋음).
     그런데 그 뒤 툴바의 '+'를 누르면 툴바가 기억하던 옛 값(처음 16)에서 다시
     세어 방금 키운 글씨가 도로 작아졌다(나쁨).

   여기서는 실제 DOM 에서
     ① Alt+휠 배율이 상자의 '글자 크기'로 저장되고
     ② 이어서 '+'를 눌러도 지금 보이는 크기에서 더 커지며
     ③ 그 값이 서버(메모)까지 저장되고
     ④ 글꼴 목록의 미리보기 문구가 'abc 가나다' 인지
   를 확인한다. */
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-fs-'));
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
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '글자 크기 노트', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [{ type: 'text', id: 't1', x: 40, y: 40, w: 200, h: 60, html: '가나다', fontSize: 16 }] }],
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
  const boot = Date.now();
  while (Date.now() - boot < 8_000 && document.querySelectorAll('.note-stack .note-card').length < 1) await wait(60);

  const card = [...document.querySelectorAll('.note-stack .note-card')]
    .find(c => (c.dataset.nbId || '').includes(String(id)) || (c.textContent || '').includes('글자 크기 노트'));
  check('노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1600);
  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));

  const tb = document.querySelector('#pagesStage .tb');
  const content = tb && tb.querySelector('.tb-content');
  check('글상자가 그려진다', !!content);

  // ① 상자 선택 → 툴바 글자 크기가 이 상자 값(16)로 맞춰진다
  content.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 60, clientY: 60 }));
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await wait(80);
  check('상자가 선택된다', tb.classList.contains('sel'));
  check('툴바가 상자의 글자 크기를 보여 준다', document.getElementById('fsInput').value === '16');

  // ② Alt+휠 : 상자와 글씨가 함께 커지고, 그 크기가 상자에 저장된다
  const body = document.getElementById('editorBody');
  for (let i = 0; i < 6; i++) {
    body.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, altKey: true, deltaY: -100 }));
    await wait(20);
  }
  const afterWheel = parseInt(content.style.fontSize, 10);
  check(`Alt+휠로 글씨도 함께 커진다 (16 → ${afterWheel})`, afterWheel > 16);
  check(`커진 크기가 툴바에도 반영된다 (${document.getElementById('fsInput').value})`,
    Number(document.getElementById('fsInput').value) === afterWheel);

  // ③ '+' 를 눌러도 도로 작아지지 않고 지금 크기에서 더 커진다
  const plus = [...document.querySelectorAll('button')].find(b => (b.getAttribute('onclick') || '') === 'chFS(2)');
  check('글씨 크게(+) 버튼이 있다', !!plus);
  plus.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(80);
  const afterPlus = parseInt(content.style.fontSize, 10);
  check(`'+' 를 눌러도 작아지지 않는다 (${afterWheel} → ${afterPlus})`, afterPlus > afterWheel);

  // ④ 서버(메모)에도 그 크기로 저장된다
  await wait(1600);
  const sel = await q({ table: 'memos', op: 'select', values: [], filters: [{ field: 'notebook_id', op: 'eq', value: String(id) }], limit: 1, single: true });
  const row = Array.isArray(sel?.data) ? sel.data[0] : sel?.data;
  const memo = row?.content ? JSON.parse(row.content) : null;
  const savedFS = memo?.pages?.[0]?.els?.[0]?.fontSize;
  check(`저장된 본문에도 글자 크기가 남는다 (${savedFS}px)`, savedFS === afterPlus);

  // ⑤ 글꼴 미리보기 문구
  document.getElementById('fontBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(80);
  const samples = [...document.querySelectorAll('#fontMenu .fi-sample')].map(n => (n.textContent || '').trim());
  check('글꼴 미리보기가 그려진다', samples.length > 0);
  check('미리보기 문구는 "abc 가나다" 다', samples.every(s => s === 'abc 가나다'));
  check('미리보기에 "한글" 이 없다', samples.every(s => s.indexOf('한글') < 0));

  const fatal = errors.filter(Boolean);
  check('치명적 런타임 오류가 없다', fatal.length === 0);
  if (fatal.length) console.log(fatal.slice(0, 5).join('\n---\n'));
  console.log(`\n글자 크기(Alt 배율 → 툴바): PASS ${pass} / FAIL 0`);
} catch (e) {
  console.error('\n글자 크기 런타임 실패:', e);
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
