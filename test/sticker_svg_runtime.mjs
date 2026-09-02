/* SVG 벡터 스티커 런타임 검증

   실제 서버 + DOM 에서 끝까지 흐름을 밟는다.

     ① 서버는 URL 인코딩된 SVG data: URL 을 받아 .svg 로 저장하고
        image/svg+xml 로 돌려준다 — 저장 시 <script>·onclick 은 잘라 낸다
     ② base64 PNG 스티커도 여전히 image/png 로 저장·서빙된다
     ③ 글상자 + 펜 획을 함께 선택해 '스티커로 만들기'를 돌리면
        · 종이에는 새 스티커가 자동으로 붙지 않는다
        · 구워진 SVG 안에 화면과 같은 <path>(펜 획)와 foreignObject(글자)가 있다
        · 보관함에 fmt:'svg' 로 바로 저장된다
     ④ 보관함에서 그 스티커를 붙이면 SVG 로 표시된다 — 벡터라 확대해도 안 깨진다 */
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-stksvg-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
}
let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };
// 고정 대기 대신 조건이 맞을 때까지 짧게 폴링 — 전체 테스트가 몰릴 때의 타이밍 흔들림 방지
const pollUntil = async (fn, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await fn()) return true; } catch {}
    await wait(100);
  }
  try { return !!await fn(); } catch { return false; }
};

async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}

// 악성 코드가 섞인 SVG (sanitize 검증용)
const EVIL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
  '<script>alert(1)<\/script><rect onclick="evil()" width="10" height="10" fill="#f00"/>' +
  '<a xlink:href="javascript:alert(2)"><text x="1" y="5">x</text></a></svg>';
const EVIL_URL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(EVIL_SVG);
const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

  // ── ① URL 인코딩 SVG 저장 → image/svg+xml 서빙 + sanitize ─────────────
  const sv1 = await fetch(base + '/api/stickers/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: EVIL_URL, name: '악성 검사용' }),
  }).then(r => r.json());
  check('URL 인코딩 SVG 스티커가 저장된다', !!sv1.ok && sv1.fmt === 'svg');
  {
    const r = await fetch(base + '/api/stickers/raw/' + sv1.id);
    const body = await r.text();
    check('SVG 는 image/svg+xml 로 돌려준다', (r.headers.get('content-type') || '').includes('image/svg+xml'));
    check('SVG 원본 열기 차단 CSP 가 붙는다', (r.headers.get('content-security-policy') || '').includes('sandbox'));
    check('본문은 그대로 SVG 다', body.includes('<svg'));
    check('저장되면서 <script> 가 잘라낸다', !body.includes('<script'));
    check('저장되면서 onclick 이 잘라낸다', !body.includes('onclick'));
    check('javascript: 링크가 무력화된다', !/href="javascript:/i.test(body));
  }

  // ── ② base64 PNG 도 여전히 된다 ──────────────────────────────────────
  const sv2 = await fetch(base + '/api/stickers/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: PNG1, name: '비트맵' }),
  }).then(r => r.json());
  check('base64 PNG 스티커도 저장된다', !!sv2.ok && sv2.fmt === 'png');
  {
    const r = await fetch(base + '/api/stickers/raw/' + sv2.id);
    await r.arrayBuffer();
    check('PNG 는 image/png 로 돌려준다', (r.headers.get('content-type') || '').includes('image/png'));
  }

  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: 'SVG 스티커', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [
      { type: 'text', id: 't1', x: 40, y: 40, w: 220, h: 60, html: '안녕 스티커', fontSize: 16, font: 'jua' },
      { type: 'stroke', id: 's1', color: '#e91e63', size: 3, sharp: true, dx: 0, dy: 0,
        pts: [[100, 100], [200, 150], [300, 120]] },
    ] }],
  };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: id, content: JSON.stringify(doc0), font_size: 16 }], filters: [] });

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String(e?.message || e);
    if (!/HTMLMediaElement|Could not load (link|script|img)/.test(m)) errors.push(m);
  });
  vc.on('error', (...a) => errors.push(a.join(' ')));
  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      installWindowGuard(window);
      Object.defineProperty(window.HTMLElement.prototype, 'contentEditable', {
        get(){ const v = this.getAttribute('contenteditable'); return v == null ? 'inherit' : v; },
        set(v){ this.setAttribute('contenteditable', String(v)); },
        configurable: true, enumerable: true,
      });
      // jsdom 은 그림을 디코드하지 못한다 — useSticker 가 기다리는 onload 를 일정한
      // 크기(120×90)로 즉시 불러 준다
      window.Image = class {
        constructor(){ this.width = 120; this.height = 90; }
        set src(v){ this._src = v; setTimeout(() => { if (this.onload) this.onload(); }, 0); }
        get src(){ return this._src; }
      };
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
    .find(c => (c.textContent || '').includes('SVG 스티커'));
  check('노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await pollUntil(() => document.getElementById('editorView').classList.contains('open'));
  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));

  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });

  // ── ③ 글상자 + 펜 획 선택 → 스티커로 만들기 ────────────────────────────
  window.selectAllOnPage();
  await wait(80);
  check('글상자와 펜 획이 함께 선택된다', window.document.querySelectorAll('#pagesStage .tb.msel, #pagesStage .stroke-g.msel').length === 2);
  await window.makeSticker();
  // 보관함 저장(fetch)까지 — 목록에 나타날 때까지 기다린다
  await pollUntil(async () => {
    const l = await fetch(base + '/api/stickers/list', { cache: 'no-store' }).then(r => r.json());
    return (l.stickers || []).some(x => x.name === '스티커' && x.fmt === 'svg');
  });

  let imgs = [...paper.querySelectorAll('.paper-img')];
  check('스티커로 만들기 직후에는 종이에 새 스티커가 자동으로 생기지 않는다', imgs.length === 0);
  check('원본 글상자와 펜 획은 그대로 남아 있다',
    paper.querySelectorAll('.tb, .stroke-g').length === 2);
  let mine = null;
  {
    const list = await fetch(base + '/api/stickers/list', { cache: 'no-store' }).then(r => r.json());
    mine = (list.stickers || []).find(s => s.name === '스티커');
    check('보관함에 fmt:svg 로 저장된다', !!mine && mine.fmt === 'svg');
    const r = await fetch(base + '/api/stickers/raw/' + mine.id);
    const body = await r.text();
    check('보관함 원본도 image/svg+xml 이다', (r.headers.get('content-type') || '').includes('image/svg+xml'));
    check('보관함 원본에도 글자·획이 있다', body.includes('안녕 스티커') && body.includes('M 100 100'));
    check('구워진 SVG 에 viewBox 가 있다', /viewBox="\d+ \d+ \d+ \d+"/.test(body));
    check('펜 획이 화면과 같은 <path> 지오메트리로 들어간다',
      body.includes('M 100 100 L 200 150 L 300 120'));
    check('획 색·굵기·끝모양이 그대로다',
      body.includes('stroke="#e91e63"') && body.includes('stroke-width="3"')
      && body.includes('stroke-linecap="round"'));
    check('글자가 foreignObject 로 들어간다', body.includes('<foreignObject'));
    check('글자 내용이 살아 있다', body.includes('안녕 스티커'));
    check('글꼴·크기 서식이 유지된다', body.includes('Jua') && body.includes('font-size:16px'));
  }

  // ── ④ 보관함에서 붙이기 → SVG 로 표시 ─────────────────────────────────
  window.openStickers();
  const modal = document.getElementById('stickerModal');
  await pollUntil(() => modal.style.display === 'flex' && modal.querySelectorAll('.v-file').length >= 2);
  check('보관함이 열린다', modal.style.display === 'flex');
  const file = [...modal.querySelectorAll('.v-file')].find(f => (f.querySelector('.v-name') || {}).textContent === '스티커');
  check('구운 SVG 스티커가 보관함에 보인다', !!file);
  file.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await pollUntil(() => paper.querySelectorAll('.paper-img').length === 1);
  imgs = [...paper.querySelectorAll('.paper-img')];
  check('보관함에서 붙이면 종이에 스티커가 생긴다', imgs.length === 1);
  {
    const el = window.findEl(0, imgs[0].dataset.id);
    // 보관함에서 붙이면 서버 라우트(/api/stickers/raw/…)를 가리킨다 — 그 라우트가
    // image/svg+xml 로 SVG 를 돌려주므로 화면에선 벡터로 그려진다
    check('붙은 스티커는 SVG 를 가리킨다 (보관함 라우트 또는 data:URL)',
      /^data:image\/svg\+xml/.test(el.url || '') || /\/api\/stickers\/raw\//.test(el.url || ''));
    check('붙은 요소는 sticker 표시를 가진다', el.sticker === true);
    check('기본 자리(80,100)에 붙는다', el.x === 80 && el.y === 100);
    const dom = imgs[0].querySelector('img');
    check('화면 <img> 가 그 SVG 를 가리킨다 — 브라우저가 벡터로 그린다',
      (dom.getAttribute('src') || '') === (el.localURL || el.url || ''));
  }

  const fatal = errors.filter(Boolean);
  check('SVG 스티커 흐름 중 치명적 런타임 오류가 없다', fatal.length === 0);
  if (fatal.length) console.log(fatal.slice(0, 5).join('\n---\n'));
  console.log(`\nSVG 벡터 스티커(굽기·저장·서빙·붙이기): PASS ${pass} / FAIL 0`);
} catch (e) {
  console.error('\nSVG 스티커 런타임 실패:', e);
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
