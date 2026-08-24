/* 14.14 · 미리보기는 있는데 에디터 본문이 비는 버그 / 노트 전환 덮어쓰기 재현
 *  - IntersectionObserver 를 침묵시켜 ensureVisible 경로만으로 렌더
 *  - sync pages id 를 memo 와 다르게 심어 applyPagesOp 미스매치 상황을 만든다
 */
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import jsdom from 'jsdom';
const { JSDOM, VirtualConsole } = jsdom;

const pass = [];
const check = (name, cond) => { assert.ok(cond, name); pass.push(name); console.log('  ✓ ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));

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
child.stdout.on('data', b => log += b);
child.stderr.on('data', b => log += b);

let dom;
try {
  const until = Date.now() + 12000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died: ' + log);
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }

  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());

  const seeded = [];
  for (const t of ['노트알파', '노트베타']) {
    const ins = await q({
      table: 'notebooks', op: 'insert',
      values: [{ title: t, color: '#4f6ef7' }],
      filters: [], returning: true, single: true,
    });
    const pageId = 'p1_' + t;
    const els = [
      { type: 'text', id: 't1_' + t, x: 40, y: 60, w: 500, h: 120, html: '<p>본문내용:' + t + '</p>', fontSize: 22 },
      { type: 'text', id: 't2_' + t, x: 40, y: 200, w: 400, h: 80, html: '<p>두번째 ' + t + '</p>', fontSize: 16 },
    ];
    const doc = {
      version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '📝', glossary: {},
      pages: [{ id: pageId, els, tables: [] }],
    };
    await q({
      table: 'memos', op: 'insert',
      values: [{ notebook_id: ins.data.id, content: JSON.stringify(doc), font_size: 16 }],
      filters: [],
    });
    await fetch(base + '/api/sync/push', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nb: ins.data.id,
        ops: [
          { id: '__pages__', kind: 'pages', rev: Date.now(), ids: ['sync_' + pageId], dev: 'seed' },
          ...els.map((el, i) => ({
            id: el.id, kind: 'put', page: 0, rev: Date.now() + 1 + i, data: el, dev: 'seed',
          })),
        ],
      }),
    });
    seeded.push({ id: ins.data.id, title: t });
  }

  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String(e?.message || e);
    if (!/HTMLMediaElement|Could not load (link|script)|not implemented|navigation|Local storage/i.test(m)) errs.push(m);
  });
  vc.on('error', (...a) => errs.push(a.join(' ')));

  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.innerWidth = 1280; window.innerHeight = 800;
      window.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      // IO 침묵 → ensureVisiblePagesRendered 강제 경로만 검증
      window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
      window.BroadcastChannel = class { postMessage(){} close(){} addEventListener(){} };
      window.EventSource = class { close(){} addEventListener(){} };
      window.requestIdleCallback = cb => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
      window.cancelIdleCallback = clearTimeout;
      window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 16);
      window.cancelAnimationFrame = clearTimeout;
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function(){};
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get() { return this.id === 'editorBody' ? 1000 : (parseInt(this.style?.width) || 200); },
      });
      Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', {
        configurable: true,
        get() { return this.id === 'editorBody' ? 700 : (parseInt(this.style?.height) || 200); },
      });
      window.HTMLCanvasElement.prototype.getContext = () => ({
        clearRect(){}, drawImage(){}, fillRect(){}, beginPath(){}, moveTo(){}, lineTo(){},
        stroke(){}, arc(){}, fill(){}, save(){}, restore(){}, scale(){}, translate(){}, setTransform(){},
        measureText(){ return { width: 10 }; },
        getImageData(){ return { data: new Uint8ClampedArray(4) }; }, putImageData(){},
      });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class { constructor(){ this.paused = true; } play(){ return Promise.resolve(); } pause(){} addEventListener(){} removeEventListener(){} };
      window.URL.createObjectURL = () => 'blob:test';
      window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL
          ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
      window.addEventListener('error', e => errs.push(e.error?.stack || e.message));
      window.addEventListener('unhandledrejection', e => errs.push('unhandled: ' + (e.reason?.stack || e.reason)));
    },
  });

  const { window } = dom;
  const { document } = window;

  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    if (document.querySelector(`.note-card[data-nb-id="${seeded[0].id}"]`)
      && document.querySelector(`.note-card[data-nb-id="${seeded[1].id}"]`)) break;
    await wait(80);
  }
  await wait(900);

  const cardA = document.querySelector(`.note-card[data-nb-id="${seeded[0].id}"]`);
  const cardB = document.querySelector(`.note-card[data-nb-id="${seeded[1].id}"]`);
  check('노트 카드가 렌더된다', !!(cardA && cardB));

  if (cardA._render) await cardA._render();
  await wait(200);
  const prevHtml = cardA.querySelector('.note-preview-frame')?.innerHTML || '';
  check('홈 미리보기에 본문 힌트가 있다', prevHtml.length > 40);

  cardA.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(1800);

  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));
  check('_renderVersion 이 유한 숫자다', Number.isFinite(window._renderVersion) && window._renderVersion >= 1);

  const domHtmlA = [...document.querySelectorAll('#pagesStage .tb-content')].map(c => c.innerHTML).join('|');
  check('IO 없이도 DOM 에 텍스트 상자가 그려진다', document.querySelectorAll('#pagesStage .tb').length >= 2);
  check('DOM 에 알파 본문 글자가 보인다',
    domHtmlA.includes('노트알파') || domHtmlA.includes('본문내용:노트알파'));

  cardB.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(2200);

  const domHtmlB = [...document.querySelectorAll('#pagesStage .tb-content')].map(c => c.innerHTML).join('|');
  check('B 노트 본문이 보인다',
    domHtmlB.includes('노트베타') || domHtmlB.includes('본문내용:노트베타'));
  check('B 화면에 A 본문이 덮어씌워지지 않는다', !domHtmlB.includes('노트알파'));

  const cfgA = JSON.parse(window.localStorage.getItem('nb_' + seeded[0].id) || '{}');
  check('B 전환 후에도 A 로컬 본문이 유지된다', JSON.stringify(cfgA).includes('노트알파'));

  const memA = await q({
    table: 'memos', op: 'select',
    filters: [{ op: 'eq', field: 'notebook_id', value: seeded[0].id }],
    limit: 1,
  });
  check('서버 메모 A 가 빈 문서로 덮이지 않았다',
    (memA.data?.[0]?.content || '').includes('노트알파'));

  cardA.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(1800);
  const domHtmlA2 = [...document.querySelectorAll('#pagesStage .tb-content')].map(c => c.innerHTML).join('|');
  check('A 재오픈 시 본문이 다시 보인다',
    domHtmlA2.includes('노트알파') || domHtmlA2.includes('본문내용:노트알파'));

  const fatal = errs.filter(Boolean);
  if (fatal.length) console.log('ERRS:\n' + fatal.slice(0, 6).join('\n---\n'));
  check('치명적 JS 오류 없음', fatal.length === 0);

  console.log(`\nPASS ${pass.length}`);
} catch (e) {
  console.error('FAIL:', e);
  if (log) console.error('server:\n' + log.slice(-2500));
  process.exitCode = 1;
} finally {
  if (dom) try { dom.window.close(); } catch {}
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
