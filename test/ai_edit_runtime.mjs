/* 14.24.0 · 해돌이 문서 편집 bridge 실제 런타임 검증

   AI 공급사는 부르지 않는다. 진짜 편집기를 열고 capture/apply를 직접 호출해
   스냅샷, 허용 명령, 좌표 제한, 평문 이스케이프, stale 방지, Ctrl+Z 원복을 본다. */
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import jsdom from 'jsdom';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { installWindowGuard, closeDoms } from './jsdom_guard.mjs';

const { JSDOM, VirtualConsole } = jsdom;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-ai-edit-'));
process.env.SDY_BASE_DIR = TMP;
for (const file of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) {
  fs.copyFileSync(path.join(REPO, file), path.join(TMP, file));
}

let passed = 0;
const check = (name, condition, extra = '') => {
  assert.ok(condition, name + (extra ? ` → ${extra}` : ''));
  passed++;
  console.log('  ✓ ' + name);
};
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/src/index.js'], {
  cwd: REPO,
  env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', chunk => { serverLog += chunk; });
child.stderr.on('data', chunk => { serverLog += chunk; });
let dom;
try {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('server exited before ready');
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }

  const headers = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const db = body => fetch(base + '/api/db/query', {
    method: 'POST', headers, body: JSON.stringify(body),
  }).then(response => response.json());
  const inserted = await db({
    table: 'notebooks', op: 'insert', values: [{ title: 'AI 편집 런타임', color: '#4f6ef7' }],
    filters: [], returning: true, single: true,
  });
  const notebookId = inserted.data.id;
  const original = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'page-1', els: [
      { type: 'text', id: 'title-box', x: 40, y: 50, w: 300, h: 80, html: '<b>옛 제목</b>', fontSize: 16 },
      { type: 'text', id: 'locked-box', x: 40, y: 180, w: 260, h: 60, html: '잠긴 글', fontSize: 16, locked: true },
      { type: 'text', id: 'table-cell', x: 40, y: 270, w: 120, h: 40, html: '표 칸', fontSize: 16,
        tbl: { tid: 'tbl-1', r: 0, c: 0 } },
      { type: 'image', id: 'photo-1', x: 790, y: 50, w: 10, h: 150, url: '' },
      { type: 'stroke', id: 'stroke-1', pts: [[10, 10], [30, 30]], dx: 0, dy: 0, color: '#111', size: 2 },
    ], tables: [] }],
  };
  await db({
    table: 'memos', op: 'insert',
    values: [{ notebook_id: notebookId, content: JSON.stringify(original), font_size: 16 }], filters: [],
  });

  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => {
    const message = String(error?.message || error);
    if (!/HTMLMediaElement|Could not load (link|script)/.test(message)) errors.push(message);
  });
  virtualConsole.on('error', (...args) => errors.push(args.join(' ')));
  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
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
      window.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 0);
      window.cancelAnimationFrame = clearTimeout;
      window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect(){}, drawImage(){}, fillRect(){},
        beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, arc(){}, fill(){}, save(){}, restore(){},
        scale(){}, translate(){}, setTransform(){}, measureText(){ return { width: 10 }; },
        getImageData(){ return { data: new Uint8ClampedArray(4) }; }, putImageData(){} });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class { constructor(){ this.paused = true; } play(){ return Promise.resolve(); }
        pause(){} addEventListener(){} removeEventListener(){} };
      window.URL.createObjectURL = () => 'blob:test';
      window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL
          ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
      window.addEventListener('error', event => errors.push(event.error?.stack || event.message));
      window.addEventListener('unhandledrejection', event => errors.push('unhandled: ' + event.reason));
    },
  });

  const { window } = dom;
  const { document } = window;
  const bootDeadline = Date.now() + 8_000;
  let card;
  while (Date.now() < bootDeadline) {
    card = [...document.querySelectorAll('.note-stack .note-card')]
      .find(node => (node.textContent || '').includes('AI 편집 런타임'));
    if (card) break;
    await wait(60);
  }
  check('테스트 노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const openDeadline = Date.now() + 8_000;
  while (Date.now() < openDeadline) {
    if (document.getElementById('editorView').classList.contains('open') && window.__sdyAiBridge?.capture) break;
    await wait(60);
  }
  await wait(700);
  check('실제 편집기와 AI bridge가 열린다',
    document.getElementById('editorView').classList.contains('open')
    && typeof window.__sdyAiBridge?.apply === 'function');

  const captured = window.__sdyAiBridge.capture();
  check('스냅샷에 페이지 크기·현재 쪽·요소 id/종류/좌표가 있다',
    /페이지 크기: \d+x\d+/.test(captured.text) && /\[1쪽 · 현재\]/.test(captured.text)
    && /id=title-box type=글상자 x=40 y=50/.test(captured.text));
  check('스냅샷은 HTML 대신 평문 미리보기와 잠금/표 제한을 표시한다',
    !captured.text.includes('<b>') && /text="옛 제목"/.test(captured.text)
    && /locked-box[\s\S]*잠김/.test(captured.text) && /table-cell[\s\S]*표 칸/.test(captured.text));
  check('요청 시점 revision을 함께 캡처한다', typeof captured.revision === 'string' && captured.revision.length > 3);

  const result = window.__sdyAiBridge.apply([
    { cmd: 'bx', id: 'title-box', x: -50, y: 5000, w: 300, h: 200 },
    { cmd: 'tx', id: 'title-box', text: '<script>위험</script>\n새 부제' },
    { cmd: 'sz', id: 'photo-1', w: 250, h: 180 },
    { cmd: 'mv', id: 'stroke-1', x: 100, y: 120 },
    { cmd: 'add', page: 1, x: 700, y: 1080, w: 400, h: 200, text: '새 상자' },
    { cmd: 'tx', id: 'locked-box', text: '잠금 우회' },
    { cmd: 'del', id: 'table-cell' },
    { cmd: 'sz', id: 'stroke-1', w: 100, h: 100 },
    { cmd: 'add', page: 99, x: 0, y: 0, w: 100, h: 40, text: '잘못된 쪽' },
  ], captured.revision);
  await wait(500);
  check('허용된 다섯 변경만 적용하고 잠금·표·획 크기·없는 쪽은 거절한다',
    result.applied === 5 && result.failed === 4, JSON.stringify(result));

  const title = window.findEl(0, 'title-box');
  const photo = window.findEl(0, 'photo-1');
  const stroke = window.findEl(0, 'stroke-1');
  const currentDoc = window.__sdyTranslate.getDoc();
  const added = currentDoc.pages[0].els.find(element => element.id !== 'title-box' && element.type === 'text'
    && (element.html || '').includes('새 상자'));
  check('큰/음수 좌표와 크기는 페이지 안으로 제한된다',
    title.x >= 0 && title.y >= 0 && title.x + title.w <= 800 && title.y + title.h <= 1100,
    JSON.stringify({ x: title.x, y: title.y, w: title.w, h: title.h }));
  check('모델 텍스트는 HTML 실행 없이 이스케이프되고 줄바꿈만 보존된다',
    /&lt;script&gt;위험&lt;\/script&gt;<br>새 부제/.test(title.html)
    && !document.querySelector('#pagesStage script'));
  check('사진 크기·그림획 위치·새 글상자가 실제 문서에 반영된다',
    photo.x === 790 && photo.w === 10 && photo.x + photo.w <= 800 && photo.h === 180
    && stroke.dx === 90 && stroke.dy === 110 && !!added);
  check('잠금 요소와 표 칸은 그대로 남는다',
    /잠긴 글/.test(window.findEl(0, 'locked-box').html)
    && !!window.findEl(0, 'table-cell'));

  document.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'z', ctrlKey: true, bubbles: true, cancelable: true,
  }));
  await wait(500);
  const undoneDoc = window.__sdyTranslate.getDoc();
  check('Ctrl+Z 한 번으로 AI 편집 전체가 원래대로 돌아간다',
    window.findEl(0, 'title-box').html === '<b>옛 제목</b>'
    && window.findEl(0, 'photo-1').w === 10
    && !undoneDoc.pages[0].els.some(element => (element.html || '').includes('새 상자')));

  const staleCapture = window.__sdyAiBridge.capture();
  window.findEl(0, 'title-box').html = '사용자가 방금 고친 제목';
  const beforeX = window.findEl(0, 'title-box').x;
  const stale = window.__sdyAiBridge.apply([
    { cmd: 'mv', id: 'title-box', x: 333, y: 333 },
  ], staleCapture.revision);
  check('모델 대기 중 문서가 바뀌면 오래된 계획을 통째로 거절한다',
    stale.stale === true && stale.applied === 0 && window.findEl(0, 'title-box').x === beforeX);

  const fatal = errors.filter(Boolean);
  check('AI 실제 편집 중 치명적 브라우저 오류가 없다', fatal.length === 0, fatal.slice(0, 2).join('\n'));
  console.log(`\n해돌이 문서 편집 런타임: PASS ${passed} / FAIL 0`);
} catch (error) {
  console.error('\n해돌이 문서 편집 런타임 실패:', error);
  if (serverLog) console.error('\nserver log:\n' + serverLog.slice(-2500));
  process.exitCode = 1;
} finally {
  await wait(80);
  await closeDoms([dom]);
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  fs.rmSync(TMP, { recursive: true, force: true });
}
