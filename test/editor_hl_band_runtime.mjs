/* 14.18.2 · 부드러운 형광펜(연속 띠) 표시 레이어 런타임 검증

   저장 데이터/편집 엔진은 글자 span 의 background-color 를 그대로 쓰고(불변),
   화면 표시만 .tb 아래의 절대 svg 레이어(.sdy-hl-layer)로 한 겹 더 그린다.

   jsdom 은 레이아웃이 없어 Range.getClientRects 가 항상 [] 이다. 그래서
   테스트가 지정한 글상자(tb.dataset.__fakeLayout)의 텍스트 노드에 한해
   결정적 의사-레이아웃(글자 크기 비례 폭 + 줄/행)을 돌려주는 가짜
   getClientRects 를 올려 두고, 실제 파이프라인(_hlRuns → _hlFragRects →
   _hlBands → svg rect)이 아래를 지키는지 확인한다.

     ① 크기가 다른 글자가 한 형광펜 안에 이웃하면 한 띠로 합쳐진다
        (작은 글자 구간이 '계단'으로 떨어지지 않도록 세로 범위를 합침)
     ② 형광펜이 끊긴 곳(다른 색/글자 사이)은 띠도 끊긴다
     ③ 줄이 바뀌면 띠도 줄 단위로 갈라진다
     ④ 띠는 둥근 끝(rx/ry)을 가진다
     ⑤ 레이어는 .tb-content 안(저장 HTML)이 아니라 .tb 아래에 붙고,
        pointer-events:none + z-index:-1 로 편집/저장을 건드리지 않는다
     ⑥ MutationObserver 가 글자 색/서식 변경을 받아 띠를 다시 그린다
     ⑦ 형광펜이 모두 사라지면 레이어도 제거된다(기존 span 폴백은 그대로)
     ⑧ _hlBands 순수 로직: 가로로 닿은 조각 병합·끊김 분리·줄 분리 */
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
const freePort = () => new Promise(res => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ` — ${extra}` : '')); }
};
const approx = (a, b, eps = 0.25) => Math.abs(a - b) <= eps;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hlband-'));
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/src/index.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', b => serverLog += b);
child.stderr.on('data', b => serverLog += b);

const runtimeErrors = [];
let dom = null;
try {
  // ── 서버 + 노트 준비 ────────────────────────────────────────────────
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died');
    try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* retry */ }
    await wait(80);
  }
  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '형광펜 띠', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;

  // 한 줄: [36px '큰'][12px '작'] 형광펜(닿아 있음) → ' 가운데 '(형광펜 아님) →
  // [20px '뒤'] 형광펜(끊김) / 다음 줄: [20px '파랑'] 파란 형광펜(줄 분리)
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [{
      type: 'text', id: 't1', x: 40, y: 40, w: 300, h: 90, fontSize: 16,
      html: '<span style="background-color:rgb(255,225,77);font-size:36px">큰</span>'
          + '<span style="background-color:rgb(255,225,77);font-size:12px">작</span>'
          + ' 가운데 '
          + '<span style="background-color:rgb(255,225,77);font-size:20px">뒤</span><br>'
          + '<span style="background-color:rgb(0,150,255);font-size:20px">파랑</span>',
    }] }],
  };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: id, content: JSON.stringify(doc0), font_size: 16 }], filters: [] });

  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String(e?.message || e);
    if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) runtimeErrors.push(m);
  });
  vc.on('error', (...a) => runtimeErrors.push(a.join(' ')));

  // ── 의사-레이아웃 ──
  // tb.dataset.__fakeLayout='1' 인 글상자 속 텍스트 노드에만, 글자 크기에
  // 비례한 폭(px)과 세로 가운데 정렬 행을 돌려준다. 행 높이 40, <br> 줄 간격 50.
  const fakeLayouts = new WeakMap(); // Text node -> [{l,t,rr,b}]
  const layoutFor = (window, textNode) => {
    let tb = textNode.parentElement;
    while (tb && !(tb.classList && tb.classList.contains('tb') && tb.dataset && tb.dataset.__fakeLayout === '1')) tb = tb.parentElement;
    if (!tb) return null;
    const c = tb.querySelector('.tb-content');
    if (!c || !c.contains(textNode)) return null;
    const baseSize = parseFloat(c.style && c.style.fontSize) || 16;
    const fontOf = el => {
      while (el && el !== c && el.nodeType === 1) {
        const v = el.style && el.style.fontSize;
        const n = parseFloat(v);
        if (n > 0) return n;
        el = el.parentElement;
      }
      return baseSize;
    };
    // 텍스트 노드 순서대로 커서를 옮기며 각 노드의 의사 rect 를 한 번만 만든다
    const cache = fakeLayouts.get(tb);
    if (cache) return cache.get(textNode) || null;
    const out = new Map();
    // 실제 getClientRects 는 뷰포트 좌표를 준다 → 내용 원점 = c 테두리 + padding
    let cr = { left: 0, top: 0 };
    try { cr = c.getBoundingClientRect() || cr; } catch (e) { /* 기본 0 */ }
    let x = (cr.left || 0) + 12, y = (cr.top || 0) + 8;
    const walk = node => {
      for (const ch of node.childNodes) {
        if (ch.nodeType === 1) {
          if (ch.tagName === 'BR') { x = 0; y += 50; continue; }
          walk(ch);
        } else if (ch.nodeType === 3) {
          const v = ch.nodeValue || '';
          const size = fontOf(ch.parentElement);
          const w = [...v].reduce((s, ch2) => s + size * (ch2 === ' ' ? 0.3 : 0.55), 0);
          const top = y + (40 - size) / 2;   // 행(40px) 안 세로 가운데
          // Range.getClientRects 가 돌려주는 DOMRect 와 같은 모양
          out.set(ch, [{ left: x, top, right: x + w, bottom: top + size, width: w, height: size }]);
          x += w;
        }
      }
    };
    walk(c);
    fakeLayouts.set(tb, out);
    return out.get(textNode) || null;
  };

  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      installWindowGuard(window);
      Object.defineProperty(window.HTMLElement.prototype, 'contentEditable', {
        get() { const v = this.getAttribute('contenteditable'); return v == null ? 'inherit' : v; },
        set(v) { this.setAttribute('contenteditable', String(v)); },
        configurable: true, enumerable: true,
      });
      {
        const proto = window.Range.prototype;
        const orig = proto.compareBoundaryPoints;
        const preIndex = node => {
          let i = 0;
          const tw = node.ownerDocument.createTreeWalker(node.ownerDocument.documentElement, window.NodeFilter.SHOW_ALL);
          let n;
          while ((n = tw.nextNode())) { if (n === node) return i; i++; }
          return -1;
        };
        const canon = (node, off) => {
          while (node.nodeType === 1 && off < node.childNodes.length) { node = node.childNodes[off]; off = 0; }
          return [node, off];
        };
        const cmpPts = (n1, o1, n2, o2) => {
          if (n1 === n2) return o1 < o2 ? -1 : o1 > o2 ? 1 : 0;
          const a = canon(n1, o1), b = canon(n2, o2);
          if (a[0] === b[0]) return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
          const ka = 2 * preIndex(a[0]) + (a[1] > 0 ? 1 : 0);
          const kb = 2 * preIndex(b[0]) + (b[1] > 0 ? 1 : 0);
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        };
        proto.compareBoundaryPoints = function (how, other) {
          try {
            const useA = (how === 0 || how === 2) ? 'start' : 'end';
            const useB = (how === 0 || how === 3) ? 'start' : 'end';
            const a = useA === 'start' ? [this.startContainer, this.startOffset] : [this.endContainer, this.endOffset];
            const b = useB === 'start' ? [other.startContainer, other.startOffset] : [other.endContainer, other.endOffset];
            if (a[0] && b[0] && a[0].nodeType != null && b[0].nodeType != null
                && a[0].ownerDocument === b[0].ownerDocument) {
              return cmpPts(a[0], a[1], b[0], b[1]);
            }
          } catch { /* fall through */ }
          return orig.call(this, how, other);
        };
      }
      // jsdom 은 getClientRects 가 항상 [] — 지정 글상자만 의사 레이아웃을 준다
      Object.defineProperty(window.Range.prototype, 'getClientRects', {
        configurable: true, writable: true,
        value() {
          if (!this.startContainer || this.startContainer.nodeType !== 3) return [];
          const rects = layoutFor(window, this.startContainer);
          return rects ? rects.slice() : [];
        },
      });
      window.innerWidth = 1280; window.innerHeight = 800;
      window.matchMedia = query => ({ matches: query.includes('pointer:fine'), media: query,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.BroadcastChannel = class { postMessage() {} close() {} addEventListener() {} };
      window.EventSource = class { close() {} addEventListener() {} };
      window.requestIdleCallback = cb => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
      window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {}, fillRect() {}, beginPath() {}, moveTo() {},
        lineTo() {}, stroke() {}, arc() {}, fill() {}, save() {}, restore() {}, scale() {}, translate() {}, setTransform() {},
        measureText() { return { width: 10 }; }, getImageData() { return { data: new Uint8ClampedArray(4) }; }, putImageData() {} });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class { constructor() { this.paused = true; } play() { return Promise.resolve(); } pause() {} addEventListener() {} removeEventListener() {} };
      window.URL.createObjectURL = () => 'blob:test';
      window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
      window.addEventListener('error', e => runtimeErrors.push(e.error?.stack || e.message));
      window.addEventListener('unhandledrejection', e => runtimeErrors.push('unhandled: ' + (e.reason?.stack || e.reason)));
    },
  });

  const { window } = dom;
  const { document } = window;
  const boot = Date.now();
  while (Date.now() - boot < 8_000 && document.querySelectorAll('.note-stack .note-card').length < 1) await wait(60);
  const card = [...document.querySelectorAll('.note-stack .note-card')].find(c => (c.textContent || '').includes('형광펜 띠'));
  check('노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1400);
  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));

  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });
  const tb = document.querySelector('#pagesStage .tb[data-id="t1"]');
  const content = tb && tb.querySelector('.tb-content');
  check('글상자가 그려진다', !!content);
  check('형광펜 span 이 저장 형태 그대로 남아 있다',
    content.querySelectorAll('span[style*="background-color"]').length === 4,
    content ? `spans=${content.querySelectorAll('span').length}` : '');

  // 레이아웃 후킹: 이 글상자만 의사 rect, c/w 는 고정 화면 좌표
  tb.dataset.__fakeLayout = '1';
  tb.getBoundingClientRect = () => ({ left: 10, top: 6, right: 310, bottom: 96, width: 300, height: 90, x: 10, y: 6 });
  content.getBoundingClientRect = () => ({ left: 12, top: 8, right: 272, bottom: 78, width: 260, height: 70, x: 12, y: 8 });
  // 내용 원점: c 테두리(12,8) + .tb-content padding(12,8) → 글자 시작 (24,16)

  // ── ① 실제 파이프라인으로 그리기 ─────────────────────────────────────
  window._hlPaint(content, tb);
  await wait(120);
  const layer = tb.querySelector(':scope > .sdy-hl-layer');
  check('표시 레이어(svg .sdy-hl-layer)가 .tb 아래에 생긴다', !!layer);
  check('레이어는 .tb-content 안(저장 HTML)에 없다', content.querySelector('.sdy-hl-layer') == null);
  if (layer) {
    check('레이어 위치는 .tb-content 기준으로 맞춰진다',
      approx(parseFloat(layer.style.left), 2) && approx(parseFloat(layer.style.top), 2),
      `left=${layer.style.left} top=${layer.style.top}`);
    const s = layer.style;
    check('레이어는 편집·선택을 방해하지 않는다(pointer-events:none)',
      s.pointerEvents === 'none' && s.zIndex === '-1' && s.position === 'absolute');
  }

  const rects = layer ? [...layer.querySelectorAll('rect')] : [];
  check('띠 개수 = 형광펜 덩어리 수(① 36px+12px 병합 · ② 20px 끊김 · ③ 다음 줄 파랑)',
    rects.length === 3, `rects=${rects.length}`);
  if (rects.length === 3) {
    const [r0, r1, r2] = rects;
    // ① 크기가 다른(36px·12px) 글자가 이웃 → 하나로 이어진 띠
    //    세로는 둘을 모두 덮는 [top 18-8=10 .. bottom 54-8=46] → 높이 36
    //    (작은 글자가 '계단'으로 갈라지지 않는 연속 띠)
    check('① 36px+12px 가 한 띠로 합쳐진다 (가로 26.4)',
      approx(parseFloat(r0.getAttribute('x')), 12) && approx(parseFloat(r0.getAttribute('width')), 26.4),
      `x=${r0.getAttribute('x')} w=${r0.getAttribute('width')}`);
    check('① 띠 높이는 큰 글자까지 부드럽게 덮는다 (세로 연속, 높이 36)',
      approx(parseFloat(r0.getAttribute('y')), 10) && approx(parseFloat(r0.getAttribute('height')), 36),
      `y=${r0.getAttribute('y')} h=${r0.getAttribute('height')}`);
    check('① 띠는 둥근 끝을 가진다(rx>0)', parseFloat(r0.getAttribute('rx')) > 0);
    check('① 형광펜 색이 보존된다', (r0.getAttribute('fill') || '').toLowerCase() === '#ffe14d', r0.getAttribute('fill'));
    // ② 형광펜이 끊긴 구간(' 가운데 ')은 띠도 끊긴다
    check('② 끊긴 형광펜은 별도 띠로 분리된다',
      approx(parseFloat(r1.getAttribute('x')), 74.4) && approx(parseFloat(r1.getAttribute('width')), 11),
      `x=${r1.getAttribute('x')} w=${r1.getAttribute('width')}`);
    check('② 분리된 띠 사이는 비어 있다', parseFloat(r1.getAttribute('x')) - (parseFloat(r0.getAttribute('x')) + parseFloat(r0.getAttribute('width'))) > 30);
    // ③ 줄이 바뀌면(<br>) 띠도 줄 단위로 갈라진다
    check('③ 다음 줄 형광펜은 별도 행의 띠다 (y 68, 높이 20)',
      approx(parseFloat(r2.getAttribute('y')), 68) && approx(parseFloat(r2.getAttribute('height')), 20),
      `y=${r2.getAttribute('y')} h=${r2.getAttribute('height')}`);
    check('③ 다른 줄 띠와 세로로 겹치지 않는다',
      parseFloat(r2.getAttribute('y')) > parseFloat(r0.getAttribute('y')) + parseFloat(r0.getAttribute('height')));
    check('③ 색이 다른 형광펜도 각자 색을 유지한다',
      (r2.getAttribute('fill') || '').toLowerCase() === '#0096ff', r2.getAttribute('fill'));
  }

  // ── ⑥ MutationObserver 가 색 변경을 받아 다시 그린다 ───────────────
  const bigSpan = [...content.querySelectorAll('span')].find(s => s.style.fontSize === '36px');
  const smallSpan = [...content.querySelectorAll('span')].find(s => s.style.fontSize === '12px');
  bigSpan.style.backgroundColor = 'rgb(255, 0, 0)';
  smallSpan.style.backgroundColor = 'rgb(255, 0, 0)';
  await wait(450); // 입력 디바운스(60ms)+여유 — MO → 재그림
  const rects2 = layer ? [...layer.querySelectorAll('rect')] : [];
  check('⑥ 색을 바꾸면 띠가 다시 그려진다 (첫 띠가 빨강으로)',
    rects2.length === 3 && (rects2[0].getAttribute('fill') || '').toLowerCase() === '#ff0000',
    `rects=${rects2.length} fill0=${rects2[0] && rects2[0].getAttribute('fill')}`);

  // ── ⑦ 형광펜이 모두 사라지면 레이어도 제거된다 ─────────────────────
  for (const s of [...content.querySelectorAll('span[style*="background-color"]')]) s.style.backgroundColor = '';
  await wait(450);
  check('⑦ 형광펜이 없으면 표시 레이어가 제거된다(span 폴백 유지)',
    tb.querySelector(':scope > .sdy-hl-layer') == null
    && content.querySelectorAll('span').length === 4);

  // ── ⑧ 순수 병합 로직(_hlBands): 조각 → 행 → 띠 ─────────────────────
  {
    const B = window._hlBands;
    const bands = B([
      { l: 100, t: 0, rr: 140, b: 30, color: '#a' },   // 큰 글자
      { l: 140, t: 10, rr: 160, b: 25, color: '#a' },  // 작은 글자 (닿음)
      { l: 260, t: 0, rr: 300, b: 30, color: '#a' },   // 끊긴 조각(간격 100)
      { l: 100, t: 60, rr: 200, b: 90, color: '#a' },  // 다음 줄
    ]);
    check('⑧ 같은 줄·닿은 조각은 한 띠(세로 합침 t0..b30)', bands.length === 3
      && approx(bands[0].l, 100) && approx(bands[0].rr, 160)
      && approx(bands[0].t, 0) && approx(bands[0].b, 30), JSON.stringify(bands));
    check('⑧ 가로로 끊긴 조각은 별도 띠', bands.length === 3 && approx(bands[1].l, 260) && approx(bands[1].rr, 300));
    check('⑧ 세로로 겹치지 않는 줄은 별도 행의 띠', bands.length === 3 && approx(bands[2].t, 60) && approx(bands[2].b, 90));
    const mixed = B([
      { l: 0, t: 0, rr: 10, b: 40, color: '#x' },
      { l: 10, t: 8, rr: 22, b: 20, color: '#x' },
    ]);
    check('⑧ 크기 차이가 커도 한 띠로 부드럽게 이어진다', mixed.length === 1
      && approx(mixed[0].t, 0) && approx(mixed[0].b, 40), JSON.stringify(mixed));
    const gap = B([
      { l: 0, t: 0, rr: 10, b: 30, color: '#x' },
      { l: 14, t: 0, rr: 20, b: 30, color: '#x' },   // 간격 4 > 2.5
    ]);
    check('⑧ 눈에 보이는 간격(>2.5px)은 병합하지 않는다', gap.length === 2);
  }

  check('런타임 오류가 없다', runtimeErrors.length === 0, runtimeErrors.slice(0, 3).join(' | '));

  console.log(`\n형광펜 연속 띠 런타임: PASS ${pass} / FAIL ${fail}`);
} catch (error) {
  console.error('\n형광펜 연속 띠 런타임 실패:', error);
  if (serverLog) console.error('\nserver log:\n' + serverLog.slice(-3000));
  process.exitCode = 1;
} finally {
  await closeDoms([dom]);
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  fs.rmSync(TMP, { recursive: true, force: true });
}
if (fail > 0) process.exitCode = 1;
