/* 14.26.0 · 해돌이 앱 실행 실제 런타임 검증
   AI 공급사는 부르지 않는다. 진짜 앱을 열고 sdyAiAppSnapshot/sdyAiAppApply를
   직접 호출해 음악·타이머·노트·발표·내보내기·찾기·창 열기를 본다. */
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-ai-app-'));
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
  const mkDoc = html => ({
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'page-1', els: [
      { type: 'text', id: 'box-1', x: 40, y: 50, w: 300, h: 80, html, fontSize: 16 },
    ], tables: [] }],
  });
  const nbA = await db({
    table: 'notebooks', op: 'insert', values: [{ title: 'AI 앱 런타임', color: '#4f6ef7' }],
    filters: [], returning: true, single: true,
  });
  await db({
    table: 'memos', op: 'insert',
    values: [{ notebook_id: nbA.data.id, content: JSON.stringify(mkDoc('찾을 말 해돌이')), font_size: 16 }],
    filters: [],
  });
  const nbB = await db({
    table: 'notebooks', op: 'insert', values: [{ title: '두 번째 노트', color: '#27ae60' }],
    filters: [], returning: true, single: true,
  });
  await db({
    table: 'memos', op: 'insert',
    values: [{ notebook_id: nbB.data.id, content: JSON.stringify(mkDoc('두 번째 내용')), font_size: 16 }],
    filters: [],
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
      // 음악 목록은 가짜 3곡으로 고정 — 부팅 로드·새로고침이 와도
      // 테스트 곡이 사라지지 않고 대기열 가지치기에도 살아남는다.
      const fakeTracks = [
        { id: 'song-a', title: '봄날 가짜', artist: '해돌이' },
        { id: 'song-b', title: '밤편지 가짜', artist: '아이유' },
        { id: 'song-c', title: 'NIGHT 가짜', artist: 'imase' },
      ];
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL
          ? new URL(String(input), window.location.href) : input;
        if (target instanceof URL && target.pathname === '/api/music/list'
          && (!init || !init.method || init.method === 'GET')) {
          return Promise.resolve(new Response(
            JSON.stringify({ ok: true, tracks: fakeTracks, tagging: false }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
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
      .find(node => (node.textContent || '').includes('AI 앱 런타임'));
    if (card) break;
    await wait(60);
  }
  check('테스트 노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const openDeadline = Date.now() + 8_000;
  while (Date.now() < openDeadline) {
    if (document.getElementById('editorView').classList.contains('open')
      && window.sdyAiAppApply) break;
    await wait(60);
  }
  await wait(700);
  check('실제 앱과 AI 앱 실행기가 열린다',
    document.getElementById('editorView').classList.contains('open')
    && typeof window.sdyAiAppApply === 'function'
    && typeof window.sdyAiAppSnapshot === 'function');

  const snap = window.sdyAiAppSnapshot();
  check('스냅샷에 열린 노트·노트 목록이 있다',
    /열린 노트: AI 앱 런타임/.test(snap) && /노트 목록 2개/.test(snap)
    && /AI 앱 런타임 \/ 두 번째 노트/.test(snap), snap.split('\n').slice(0, 2).join(' / '));
  check('스냅샷에 음악 상태·집중 화면이 있다',
    /음악: (정지|일시정지)/.test(snap) && /노래 목록 \d+곡/.test(snap) && /집중 화면:/.test(snap));

  // ── 음악: 가짜 3곡 목록으로 틀기·넘기기·볼륨·믹스를 본다 ──
  const curId = () => (window.sdyMusic.cur() || {}).id || '';
  const run = ops => window.sdyAiAppApply(window.sdyAiAppParse(ops).ops);
  const songsDeadline = Date.now() + 8_000;
  while (Date.now() < songsDeadline) {
    if (window.sdyMusic.list().length >= 3) break;
    await wait(60);
  }
  check('가짜 노래 3곡이 목록에 들어온다', window.sdyMusic.list().length >= 3);
  let r = await run('@music play | 밤편지\n@done 틀었어요');
  await wait(100);
  check('노래 검색 1위를 골라 튼다',
    r.applied === 1 && r.failed === 0 && curId() === 'song-b',
    JSON.stringify({ r, cur: curId() }));
  r = await run('@music play\n@music next\n@music prev\n@music vol | 70\n@done 묶음');
  check('계속 틀기·다음 곡·이전 곡·볼륨 4개가 적용된다',
    r.applied === 4 && r.failed === 0
    && curId() === 'song-b'
    && window.sdyMusic.audio().volume === 0.7,
    JSON.stringify({ applied: r.applied, cur: curId(), vol: window.sdyMusic.audio().volume }));
  r = await run('@music pause\n@music resume\n@done 멈췄다 계속');
  check('일시정지·계속 듣기가 적용된다', r.applied === 2 && r.failed === 0, JSON.stringify(r));
  r = await run('@music mix | 2\n@done 섞었어요');
  check('랜덤 믹스가 대기열을 올려 튼다',
    r.applied === 1 && !!window.sdyMusic.cur(), JSON.stringify(r));
  r = await run('@music play | 없는노래zzz\n@done 못 찾음');
  check('목록에 없는 노래는 거절한다', r.applied === 0 && r.failed === 1, JSON.stringify(r));
  r = await run('@music big\n@done 크게');
  check('큰 플레이어를 연다',
    r.applied === 1 && document.getElementById('mpBig').classList.contains('open'));
  window.sdyMusic.closeBig();

  // ── 집중 화면: 타이머 시작·단위·거절·정지, 스톱워치·시계 ──
  r = await run('@timer 25 | 집중\n@done 시작');
  let tst = window.sdyTimerState();
  check('25분 타이머가 메모와 함께 시작된다',
    r.applied === 1 && tst.run === true && tst.mode === 'timer'
    && tst.label === '집중' && tst.left > 20 * 60000 && tst.left <= 25 * 60000,
    JSON.stringify(tst));
  r = await run('@timer 1시간 30분\n@done 긴 타이머');
  tst = window.sdyTimerState();
  check('1시간 30분은 90분으로 계산된다',
    r.applied === 1 && tst.left > 80 * 60000 && tst.left <= 90 * 60000,
    JSON.stringify({ left: tst.left }));
  r = await run('@timer 0\n@done 안 됨');
  check('0분 타이머는 거절한다', r.applied === 0 && r.failed === 1, JSON.stringify(r));
  r = await run('@timer off\n@done 정지');
  tst = window.sdyTimerState();
  check('타이머 정지는 실행을 멈추고 화면을 닫는다',
    r.applied === 1 && tst.run === false && tst.open === false);
  r = await run('@sw\n@done 재기 시작');
  check('스톱워치가 시작된다',
    r.applied === 1 && window.sdyTimerState().mode === 'stop');
  window.closeFocusClock();
  r = await run('@clock\n@done 시계');
  check('큰 시계 화면이 열린다',
    r.applied === 1 && document.getElementById('focusClock').classList.contains('show'));
  window.closeFocusClock();

  // ── 문서 도구: 찾기·발표·내보내기 창 ──
  r = await run('@find 해돌이\n@done 찾았어요');
  check('노트 안에서 찾을 말을 검색해 표시한다',
    r.applied === 1 && document.getElementById('findBar').classList.contains('show')
    && document.getElementById('findCount').textContent !== '0',
    document.getElementById('findCount').textContent);
  r = await run('@present on\n@done 발표 시작');
  check('발표 모드가 시작된다',
    r.applied === 1 && document.getElementById('presentView').classList.contains('show'),
    JSON.stringify(r));
  r = await run('@present off\n@done 발표 끝');
  check('발표 모드가 끝난다',
    r.applied === 1 && !document.getElementById('presentView').classList.contains('show'));
  r = await run('@present off\n@done 또 끝');
  check('발표 중이 아니면 끝내기를 거절한다', r.applied === 0 && r.failed === 1);
  r = await run('@export\n@done 고르기 창');
  check('내보내기 형식 창이 열린다',
    r.applied === 1 && document.getElementById('exportModal').style.display === 'flex');
  window.closeExportModal();

  // ── 창 열기: 스티커·단어카드·설정 ──
  r = await run('@stickers\n@cards\n@settings\n@done 창 셋');
  await wait(300);
  check('스티커·단어카드·설정 창이 열린다',
    r.applied === 3 && r.failed === 0
    && document.getElementById('stickerModal').style.display === 'flex'
    && document.getElementById('cardsModal').style.display === 'flex'
    && document.getElementById('setModal').style.display === 'flex',
    JSON.stringify(r));
  window.closeStickers(); window.closeCards(); window.closeSettings();

  // ── 노트: 새로 만들기·제목으로 열기·닫기 ──
  r = await run('@note new\n@done 새 노트');
  const newDeadline = Date.now() + 8_000;
  while (Date.now() < newDeadline) {
    const t = document.getElementById('edTitle');
    if (t && /새 노트/.test(t.value || '')) break;
    await wait(100);
  }
  check('새 노트를 만들고 연다',
    r.applied === 1 && /새 노트/.test(document.getElementById('edTitle').value || ''),
    JSON.stringify(r));
  r = await run('@note open | 두 번째\n@done 열었어요');
  const openDeadline2 = Date.now() + 8_000;
  while (Date.now() < openDeadline2) {
    const t = document.getElementById('edTitle');
    if (t && (t.value || '') === '두 번째 노트') break;
    await wait(100);
  }
  check('제목으로 노트를 찾아 연다',
    r.applied === 1 && document.getElementById('edTitle').value === '두 번째 노트',
    JSON.stringify(r));
  r = await run('@note open | 없는노트zzz\n@done 못 찾음');
  check('목록에 없는 노트는 거절한다', r.applied === 0 && r.failed === 1, JSON.stringify(r));
  r = await run('@note close\n@done 닫았어요');
  await wait(300);
  check('노트를 닫고 홈으로 간다',
    r.applied === 1 && !document.getElementById('editorView').classList.contains('open'));
  r = await run('@note close\n@done 또 닫기');
  check('홈 화면에서 닫기는 거절한다', r.applied === 0 && r.failed === 1);

  // ── 모르는 동작은 추락 없이 거절 ──
  r = await window.sdyAiAppApply([{ cmd: 'bogus' }, { cmd: 'music', act: 'dance' }, { cmd: 'note', act: 'delete' }]);
  check('모르는 동작 3개는 실행 없이 거절한다', r.applied === 0 && r.failed === 3, JSON.stringify(r));

  const fatal = errors.filter(Boolean);
  check('AI 실제 실행 중 치명적 브라우저 오류가 없다', fatal.length === 0, fatal.slice(0, 2).join('\n'));
  console.log(`\n해돌이 앱 실행 런타임: PASS ${passed} / FAIL 0`);
} catch (error) {
  console.error('\n해돌이 앱 실행 런타임 실패:', error);
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
