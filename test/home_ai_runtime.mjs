/* 14.65 · 홈 검색창 해돌이 실제 런타임 검증 (일반테마 다듬기 반영)
   AI 공급사는 부르지 않는다(가짜 응답). 진짜 앱을 홈에서 열고
     · 전용 물어보기 버튼/줄(#homeAiBar)은 사라졌는지
     · 검색창 Enter 는 항상 해돌이에게 가는지(노트를 여는 대신)
     · 답이 홈 카드(#homeAiCard)에 앉는지(노트 말풍선 아님)
     · 서버가 함께 준 @settings | 테마 를 실행해 설정 창이 그 줄로 이동하는지
     · 설정 안내가 앱 상태(스냅샷)에 실려 나가는지
   를 본다. */
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-home-ai-'));
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

  // 홈에 노트 하나 (검색 결과가 있는 상태를 만들기 위해)
  const headers = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const db = body => fetch(base + '/api/db/query', {
    method: 'POST', headers, body: JSON.stringify(body),
  }).then(response => response.json());
  const nb = await db({
    table: 'notebooks', op: 'insert', values: [{ title: '홈 해돌이 테스트', color: '#4f6ef7' }],
    filters: [], returning: true, single: true,
  });
  await db({
    table: 'memos', op: 'insert',
    values: [{ notebook_id: nb.data.id, content: JSON.stringify({ version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {}, pages: [{ id: 'page-1', els: [{ type: 'text', id: 'box-1', x: 40, y: 50, w: 300, h: 80, html: '홈 해돌이 본문', fontSize: 16 }], tables: [] }] }), font_size: 16 }],
    filters: [],
  });

  const errors = [];
  const asked = [];
  dom = new JSDOM(fs.readFileSync(path.join(TMP, 'sdynotes.html'), 'utf8'), {
    url: base + '/',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    beforeParse(window) {
      installWindowGuard(window);
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.requestIdleCallback = callback => setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 8 }), 0);
      window.BroadcastChannel = class { postMessage() {} close() {} addEventListener() {} };
      window.EventSource = class { close() {} addEventListener() {} };
      window.cancelIdleCallback = clearTimeout;
      window.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 0);
      window.cancelAnimationFrame = clearTimeout;
      window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {}, fillRect() {},
        beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}, save() {}, restore() {},
        scale() {}, translate() {}, setTransform() {}, measureText() { return { width: 10 }; },
        getImageData() { return { data: new Uint8ClampedArray(4) }; }, putImageData() {},
        createLinearGradient() { return { addColorStop() {} }; } });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class { constructor() { this.paused = true; } play() { return Promise.resolve(); }
        pause() {} addEventListener() {} removeEventListener() {} };
      window.AudioContext = class {
        constructor() { this.destination = {}; this.currentTime = 0; }
        createMediaElementSource() { return { connect() {} }; }
        createGain() { return { gain: { value: 1, setTargetAtTime() {}, cancelScheduledValues() {} }, connect() {} }; }
        createBiquadFilter() { return { frequency: { value: 0 }, Q: { value: 0 },
          gain: { value: 0, cancelScheduledValues() {}, setTargetAtTime() {} }, connect() {} }; }
        createAnalyser() { return { connect() {}, fftSize: 1024, frequencyBinCount: 512, smoothingTimeConstant: .5,
          minDecibels: -85, maxDecibels: -25, getByteFrequencyData() {}, getFloatTimeDomainData(buf) { if (buf) buf.fill(0); } }; }
        resume() { return Promise.resolve(); }
      };
      window.URL.createObjectURL = () => 'blob:test';
      window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL
          ? new URL(String(input), window.location.href) : input;
        if (target instanceof URL && target.pathname === '/api/ai/ask') {
          const body = JSON.parse(String((init && init.body) || '{}'));
          asked.push(body);
          // 설정을 여는 요청 → 서버(app/help)가 @ 명령을 함께 준다
          const text = /열어|보여/.test(String(body.question || ''))
            ? '@settings | 테마\n@done 설정 창을 테마 자리로 열었어요'
            : '설정 창(오른쪽 위 **⚙**)에서 **테마**를 누르면 기본/캐주얼이 바뀝니다.';
          return Promise.resolve(new Response(JSON.stringify({ ok: true, task: body.task, text }),
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
  const bootDeadline = Date.now() + 12_000;
  let card;
  while (Date.now() < bootDeadline) {
    card = [...document.querySelectorAll('.note-stack .note-card,.pro-grid .note-card')]
      .find(node => (node.textContent || '').includes('홈 해돌이 테스트'));
    if (card) break;
    await wait(60);
  }
  check('홈에 노트 카드가 보인다(검색 결과 있는 상태)', !!card,
    'grid=' + String(document.getElementById('noteGrid') && document.getElementById('noteGrid').textContent || '').slice(0, 80));

  // ① 홈에 해돌이 UI 가 살아 있다 — 물어보기 버튼/줄은 사라졌다
  check('검색창·답 카드가 홈에 있다',
    !!document.getElementById('searchInput') && !!document.getElementById('homeAiCard')
    && typeof window.sdyHomeAiAsk === 'function' && typeof window.sdyHomeAiKey === 'function');
  check('물어보기 전용 버튼·줄은 없다',
    !document.getElementById('homeAiBar') && !document.getElementById('homeAiAsk'));
  check('답 카드는 처음엔 숨어 있다', document.getElementById('homeAiCard').hidden === true);

  // ② 검색 결과가 걸려도 Enter 는 노트가 아니라 해돌이에게 간다
  const input = document.getElementById('searchInput');
  input.value = '홈 해돌이';
  window.searchNotes(input.value);
  const ev = { key: 'Enter', preventDefault() { this.prevented = true; }, shiftKey: false };
  const handled = window.sdyHomeAiKey(ev);
  check('검색창 Enter 가 해돌이에게 간다', handled === false && ev.prevented === true);
  check('노트가 걸려도 노트를 열지 않는다(에디터 닫힘)',
    !document.getElementById('editorView').classList.contains('open'));
  check('질문은 앱 도움말(help) task 로 나간다', asked.length === 1 && asked[0].task === 'help',
    JSON.stringify(asked[0] && asked[0].task));
  check('서버로 가는 앱 상태에 설정 안내가 실린다',
    asked[0] && /\[이 앱의 설정/.test(String(asked[0].text))
    && /테마 · 지금: 기본/.test(String(asked[0].text))
    && /지금: 기본 종이|지금: 빈 종이/.test(String(asked[0].text)));
  await wait(300);
  check('답이 홈 카드에 앉는다(노트 말풍선 아님)',
    document.getElementById('homeAiCard').hidden === false
    && /테마/.test(document.getElementById('homeAiOut').textContent)
    && document.getElementById('aiSay').hidden === true,
    document.getElementById('homeAiOut').textContent.slice(0, 60));

  // ③ 실행 요청 → 서버가 준 @settings | 테마 를 실제로 실행해 그 줄로 이동
  window.sdyHomeAiClose();
  input.value = '설정 열어줘';
  window.searchNotes(input.value);
  const ev2 = { key: 'Enter', preventDefault() { this.prevented = true; }, shiftKey: false };
  window.sdyHomeAiKey(ev2);
  check('실행 말투도 물어본다', ev2.prevented === true && asked.length === 2);
  await wait(600);
  const modal = document.getElementById('setModal');
  const row = document.querySelector('.theme-row');
  check('@settings | 테마 가 설정 창을 실제로 연다',
    window.getComputedStyle(modal).display === 'flex', window.getComputedStyle(modal).display);
  check('설정 창이 그 줄(테마)을 짚어 준다', row && row.classList.contains('set-row-hit'));
  check('실행 결과가 카드에 남는다',
    /설정/.test(document.getElementById('homeAiOut').textContent)
    || /실행/.test(document.getElementById('homeAiOut').textContent),
    document.getElementById('homeAiOut').textContent.slice(0, 80));
  check('설정 실행 뒤 답 카드에 [설정 열기] 가 붙는다',
    [...document.querySelectorAll('#homeAiActs .home-ai-act')].some(b => /설정 열기/.test(b.textContent)));

  // ④ 설정 안내·이동 창구가 앱 전체에서 쓰인다
  const guide = window.sdySettingsGuideText ? window.sdySettingsGuideText() : '';
  check('설정 안내에 8개 항목이 모두 있다',
    ['테마', '강조색', '배경화면', '기본 종이', '휴지통', '버그 일지', '사용법·단축키', '기본값 복원']
      .every(n => guide.includes(n)),
    guide.slice(0, 40));
  check('설정 안내가 설정 창 밖 기능도 알려 준다', /이퀄라이저/.test(guide) && /지점 저장/.test(guide));
  check('이름으로 설정 줄을 찾아 이동한다',
    window.sdySettingsJump('배경화면') === '배경화면'
    && document.getElementById('setRowWall').closest('.set-row').classList.contains('set-row-hit'));

  // ⑤ 노트 안 해돌이의 설정 실행도 같은 창구를 쓴다
  const parsed = window.sdyAiAppParse('@settings | 휴지통\n@done 열었어요');
  check('@settings | 항목 이 항목까지 파싱된다',
    parsed.ops.length === 1 && parsed.ops[0].cmd === 'settings' && parsed.ops[0].item === '휴지통');
  await window.sdyAiAppApply(parsed.ops);
  check('노트 해돌이 실행도 같은 줄로 이동한다',
    document.getElementById('trashCount').closest('.set-row').classList.contains('set-row-hit'));

  check('치명적 브라우저 오류가 없다', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (err) {
  console.error('\n홈 해돌이 런타임 실패:', err && err.stack ? err.stack : err);
  console.error('\nserver log:\n' + serverLog.slice(-1500));
  process.exitCode = 1;
} finally {
  await closeDoms([dom]);
  child.kill('SIGTERM');
  await wait(200);
  if (child.exitCode === null) child.kill('SIGKILL');
  if (!process.exitCode) console.log(`\n홈 해돌이 런타임: PASS ${passed} / FAIL 0`);
}
