/* 가져온 논문(tight) 상자 — 폰트 변경 · 엔터 줄바꿈 · 형광펜 런타임 검증
   사용자가 보고한 세 갈래를 그대로 재현한다.
     ① tight 상자에서 폰트를 바꾸면 글자 위치(줄·단어 좌표)가 어긋난다?
     ② 서식(글꼴 등)을 유지한 채 적다가 Enter 로 줄을 바꾸면 다음 줄에서 풀린다?
     ③ 형광펜을 칠한 뒤 서식(글꼴 등)이 사라진다?
     ④ 편집 중 상하좌우키(브라우저 기본 캐럿)가 가로채이지 않고, Shift+방향키로
        줄을 넘나들며 고른 선택에도 형광펜·서식이 이어서 칠해진다?
     ⑤ 문장 전체 선택 형광펜이 단어 사이 PDF 간격까지 끊김 없이(문장 단위로)
        이어지고, 글자 일부 선택은 이웃 간격을 덮지 않으며, 지우면 원래대로?
     ⑥ 일반 텍스트 상자에서 Tab 은 Word 식 들여쓰기(Shift+Tab 은 내어쓰기)가 된다?
     ⑦ 고정 스팬 글자에 자간을 입힌 뒤 뒤에 입력·Enter·형광펜을 해도
        자간·글꼴이 풀리지 않고, 편집 진입·입력·형광펜에도 줄 위치가 안 변한다?
     ⑧ 워드 일상 편집 동작 — 혼합 언어 입력·선택 덮어쓰기·굵게/기울임/밑줄·
        전체 선택 일괄 서식·형광펜 비파괴 제거·문단 나눔이 일반 상자에서 된다?
     ⑨ 복합 서식 — 한 단어에 크기·굵게·기울임·색 겹치기, 위에 글꼴/색/크기
        덧씌워도 나머지 보존, 밑줄+취소선 공존과 개별 제거, 형광펜·색 순서 무관
        레이어링, 서식 지우기, 캐럿 복합 서식 이어쓰기가 모두 되는가?
     ⑩ 고정 위치(논문) 원문 글자 직접 편집 — 중간 삽입·선택 덮어쓰기·단어
        뒤/줄 앞 이어쓰기·서식 지정 이어쓰기를 해도 줄 개수·세로 위치·옆 원문
        단어가 그대로이고, 새 글은 원문 단어 크기를 따르며 저장·재진입 보존?
     ⑪ 고정 위치 원문 '중간 줄'에서 Enter — 새 문단이 다음 원문 줄과 겹치지
        않고 뒤따르는 원문 줄들이 한 줄씩 내려가며, 읽는 순서·간격·위(첫 줄)는
        그대로이고 저장·재진입 후에도 내려간 위치가 유지된다?
     ⑫ 고정 위치 원문 '한 줄'에 크기·기준선이 다른 글자(제목 크기·본문·아래
        첨자)가 섞여도 편집 진입 시 한 줄로 묶여, 각자 왼쪽(left:0)에 붙어
        원문 글자와 겹치지 않는다?
     ⑬ Enter 로 만든 줄을 Backspace 한 번에 지운다 — 새 줄 머리의 서식 이어받기
        닻(ZWSP)을 백스페이스가 먼저 먹어 줄바꿈이 남지 않고, 엔터가 밀어 내린
        아래 원문 줄도 제자리로 올라온다? (일반 글상자 문단도 같다)
     ⑭ '마지막 단어가 다음 줄로 넘어가 겹침' — 편집 진입 줄 흐름(.sdy-tl)이
        공백 실측 오차로 상자 폭을 1px 미만 넘으면 줄 끝에서 접히지 않도록
        nowrap(절대 한 줄)이다? 엔터로 나눈 새 줄도 nowrap? 이전 버전
        (white-space:normal)으로 저장된 줄 흐름도 다시 그릴 때만 nowrap 으로
        바로잡고(표시 전용), 실제 수정 커밋 전까지 저장 모델은 그대로?
        14.45 · 읽기 복귀(커밋) 시 줄 흐름은 단어별 절대좌표 span 으로 역변환해
        저장·표시한다. 안 건드린 단어의 좌표는 원본과 동일해야 한다.
   jsdom 은 레이아웃이 없으므로 '위치'는 저장 모델의 좌표(절대 스팬의
   left/top·pdfW/pdfBase/origTop, .sdy-tl 줄의 top)로, 서식은 span 스타일로
   단언한다. 실물 Chromium 커버: bench 계열. */
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
const pollUntil = async (fn, timeout = 8000, step = 80) => {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await Promise.resolve(fn()); } catch { /* not ready yet */ }
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await wait(step);
  }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-tight-'));
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
let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };

async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}

// ── 편집 도우미 (타이핑 흐름 테스트와 같은 흉내) ─────────────────────────
function typeAt(win, content, text) {
  const doc = win.document;
  const sel = win.getSelection();
  let r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  if (!r || !content.contains(r.startContainer)) {
    r = doc.createRange(); r.selectNodeContents(content); r.collapse(false);
  }
  if (!r.collapsed) r.deleteContents();
  r.insertNode(doc.createTextNode(text));
  r.collapse(false);
  sel.removeAllRanges(); sel.addRange(r);
  content.dispatchEvent(new win.InputEvent('input', { bubbles: true }));
}
function caretEnd(win, content) {
  const r = win.document.createRange();
  if (content.childNodes.length) r.setStartAfter(content.lastChild);
  else r.setStart(content, 0);
  r.collapse(true);
  const s = win.getSelection();
  s.removeAllRanges(); s.addRange(r);
  win.saveSel();
}
// needle 을 포함한 가장 깊은 텍스트 노드
function textNodeOf(win, content, needle) {
  const tw = win.document.createTreeWalker(content, win.NodeFilter.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode())) if ((n.nodeValue || '').includes(needle)) return n;
  return null;
}
// 마지막 '실글자' 텍스트 노드 (줄/상자 끝으로 캐럿을 옮길 때)
// typeAt 의 insertNode 는 빈 텍스트 노드 껍데기를 남길 수 있어 그건 건너뛴다.
function lastTextNode(root) {
  const tw = root.ownerDocument.createTreeWalker(root, root.ownerDocument.defaultView.NodeFilter.SHOW_TEXT);
  let n, last = null;
  while ((n = tw.nextNode())) {
    if (String(n.nodeValue || '').replace(/[\u200b\u200c\u200d\ufeff]/g, '') === '') continue;
    last = n;
  }
  return last;
}
// needle 텍스트 노드 안 from..to(문자)를 드래그 선택
function selectSub(win, content, needle, from = 0, to = null) {
  const tn = textNodeOf(win, content, needle);
  assert.ok(tn, `선택 대상 '${needle}' 텍스트를 찾지 못했다`);
  const at = (tn.nodeValue || '').indexOf(needle) + from;
  const r = win.document.createRange();
  r.setStart(tn, at);
  r.setEnd(tn, at + (to == null ? needle.length : to - from));
  const s = win.getSelection();
  s.removeAllRanges(); s.addRange(r);
  win.saveSel();
  return r;
}
// 14.45 · 단어 절대좌표 저장 단언 도우미 (읽기 복귀 시 원본 형식 복원)
const spanOf = (h, t) => {
  const i = h.indexOf('>' + t + '<');
  if (i < 0) return null;
  const s = h.lastIndexOf('<span', i);
  return s < 0 ? null : h.slice(s, i + 1);
};
// 중첩 run span 속 글자의 바깥 절대 스팬 (data-pdf-w 를 가진 조상까지)
const outerSpanOf = (h, t) => {
  const i = h.indexOf(t);
  if (i < 0) return null;
  let s = h.lastIndexOf('<span', i);
  for (let k = 0; k < 3 && s >= 0; k++) {
    const e = h.indexOf('>', s);
    if (h.slice(s, e + 1).includes('data-pdf-w')) return h.slice(s, i + t.length + 1);
    s = s > 0 ? h.lastIndexOf('<span', s - 1) : -1;
  }
  return null;
};
const hasGeom = (h, t, l, tp, w, b) => {
  const s = spanOf(h, t);
  return !!s && new RegExp('left:\\s*' + l + 'px').test(s)
    && new RegExp('top:\\s*' + tp + 'px').test(s)
    && s.includes('data-pdf-w="' + w + '"') && s.includes('data-pdf-base="' + b + '"');
};
const spanLeft = (h, t) => {
  const s = spanOf(h, t);
  const m = s && s.match(/left:\s*([0-9.]+)px/);
  return m ? parseFloat(m[1]) : null;
};
const spanTop = (h, t) => {
  const s = spanOf(h, t);
  const m = s && s.match(/top:\s*([0-9.]+)px/);
  return m ? parseFloat(m[1]) : null;
};
const outerSpanLeft = (h, t) => {
  const s = outerSpanOf(h, t);
  const m = s && s.match(/left:\s*([0-9.]+)px/);
  return m ? parseFloat(m[1]) : null;
};
// 한 글자에 실제로 먹은 인라인 스타일
function effStyle(win, content, needle) {
  const tn = textNodeOf(win, content, needle);
  assert.ok(tn, `스타일 조회 대상 '${needle}' 텍스트를 찾지 못했다`);
  const out = {};
  let p = tn.parentElement;
  while (p && p !== content) {
    if (p.nodeType === 1 && p.style) {
      for (const k of ['color', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration', 'backgroundColor', 'letterSpacing', 'verticalAlign']) {
        const v = p.style[k];
        if (v && !(k in out)) out[k] = v;
      }
    }
    p = p.parentElement;
  }
  return out;
}

// 절대좌표 단어 3개짜리 문장 한 줄. PDF 는 단어마다 정확한 진행 폭/기준선을 안다.
const word = (text, left, top, pdfW) =>
  `<span data-word="1" data-fs="20" data-pdf-w="${pdfW}" data-pdf-base="${top + 16}" ` +
  `style="position:absolute;left:${left}px;top:${top}px;font-size:20px;line-height:20px;white-space:nowrap;">${text}</span>`;
const row1 = word('alpha', 0, 0, 46) + word('beta', 60, 0, 38) + word('gamma', 120, 0, 48);
const row2 = word('delta', 0, 24, 44) + word('epsilon', 58, 24, 60) + word('zeta', 140, 24, 36);
// ⑩ 전용 — 손대지 않은 새 고정 위치(논문) 상자
const rowS1 = word('south', 0, 0, 46) + word('north', 52, 0, 44) + word('east', 104, 0, 36);
const rowS2 = word('west', 0, 24, 40) + word('code', 52, 24, 38) + word('data', 96, 24, 36);
// ⑪ 전용 — 중간 줄 Enter 검증용 새 고정 위치(논문) 상자
const rowP1 = word('lorem', 0, 0, 50) + word('ipsum', 58, 0, 42);
const rowP2 = word('dolor', 0, 24, 44) + word('sit', 52, 24, 32);

// ⑫⑬ 전용 — importer(pdf_layout.py)가 만드는 꼴 그대로: top = 기준선 - 글자크기*0.8
//   한 줄 안에 '제목 크기(16) + 본문(11) + 아래첨자(7, 기준선이 2.5px 내려감)'가
//   섞인 원문. top 이 제각각이어도 '세로 구간'은 겹치므로 한 줄로 묶여야 한다.
const wordAt = (text, left, base, fs, pdfW) =>
  `<span data-word="1" data-fs="${fs}" data-pdf-w="${pdfW}" data-pdf-base="${base}" ` +
  `style="position:absolute;left:${left}px;top:${(base - fs * 0.8).toFixed(3)}px;` +
  `font-size:${fs}px;line-height:${fs}px;white-space:nowrap;">${text}<i class="zsp"> </i></span>`;
const rowM1 = wordAt('Results', 0, 16, 16, 60) + wordAt('of', 70, 16, 11, 16)
  + wordAt('the', 92, 16, 11, 24) + wordAt('H', 122, 16, 11, 9)
  + wordAt('2', 132, 18.5, 7, 5) + wordAt('O', 139, 16, 11, 10)
  + wordAt('study', 155, 16, 11, 38);
const rowM2 = wordAt('We', 0, 40, 11, 20) + wordAt('measured', 26, 40, 11, 62);
// ⑬ 전용 — Enter → Backspace 검증용 (두 줄 · 글자 크기 균일)
const rowK1 = word('alpha', 0, 0, 46) + word('beta', 60, 0, 38);
const rowK2 = word('gamma', 0, 24, 44) + word('delta', 58, 24, 40);

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
    try { if ((await fetch(base + '/api/health')).ok) break; } catch { }
    await wait(80);
  }
  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '논문 편집', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{
      id: 'p1', els: [
        { type: 'text', id: 't1', x: 40, y: 40, w: 260, h: 80, html: row1 + row2, fontSize: 16, tight: 1 },
        { type: 'text', id: 't3', x: 330, y: 40, w: 240, h: 70, html: rowS1 + rowS2, fontSize: 16, tight: 1 },
        { type: 'text', id: 't4', x: 40, y: 170, w: 200, h: 70, html: rowP1 + rowP2, fontSize: 16, tight: 1 },
        { type: 'text', id: 't5', x: 300, y: 170, w: 300, h: 90, html: rowM1 + rowM2, fontSize: 16, tight: 1, pdfText: 1 },
        { type: 'text', id: 't6', x: 40, y: 300, w: 240, h: 70, html: rowK1 + rowK2, fontSize: 16, tight: 1 },
        // ⑭ 전용 — 14.40~14.43 시절 white-space:normal 로 저장된 '줄 흐름' 본문
        //   (줄은 이미 .sdy-tl div 이고 모델도 그대로). 다시 그릴 때 nowrap 으로
        //   바로잡혀야 하고, 실제로 고치기 전까지 저장 모델은 바뀌면 안 된다.
        { type: 'text', id: 't7', x: 360, y: 300, w: 260, h: 70, fontSize: 16, tight: 1,
          html: '<div class="sdy-tl" style="position:absolute;left:0;width:100%;top:0px;height:22px;line-height:20px;white-space:normal;">alpha beta</div>'
              + '<div class="sdy-tl" style="position:absolute;left:0;width:100%;top:24px;height:22px;line-height:20px;white-space:normal;">gamma delta</div>' },
        { type: 'text', id: 't2', x: 520, y: 300, w: 220, h: 70, html: '가나다', fontSize: 16 },
      ],
    }],
  };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: id, content: JSON.stringify(doc0), font_size: 16 }], filters: [] });

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('log', (...a) => console.log('PAGE:', ...a));
  vc.on('jsdomError', e => {
    const m = String(e?.message || e);
    if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errors.push(m);
  });
  vc.on('error', (...a) => errors.push(a.join(' ')));
  dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      installWindowGuard(window);
      Object.defineProperty(window.HTMLElement.prototype, 'contentEditable', {
        get() { const v = this.getAttribute('contenteditable'); return v == null ? 'inherit' : v; },
        set(v) { this.setAttribute('contenteditable', String(v)); },
        configurable: true, enumerable: true,
      });
      window.innerWidth = 1280; window.innerHeight = 800;
      window.matchMedia = query => ({ matches: query.includes('pointer:fine'), media: query, addListener() { }, removeListener() { }, addEventListener() { }, removeEventListener() { } });
      window.IntersectionObserver = class { observe() { } unobserve() { } disconnect() { } };
      window.ResizeObserver = class { observe() { } unobserve() { } disconnect() { } };
      window.BroadcastChannel = class { postMessage() { } close() { } addEventListener() { } };
      window.EventSource = class { close() { } addEventListener() { } };
      window.requestIdleCallback = cb => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
      window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() { }, drawImage() { }, fillRect() { }, beginPath() { }, moveTo() { }, lineTo() { }, stroke() { }, arc() { }, fill() { }, save() { }, restore() { }, scale() { }, translate() { }, setTransform() { }, measureText() { return { width: 10 }; }, getImageData() { return { data: new Uint8ClampedArray(4) }; }, putImageData() { } });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class { constructor() { this.paused = true; } play() { return Promise.resolve(); } pause() { } addEventListener() { } removeEventListener() { } };
      window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => { };
      window.confirm = () => true; window.alert = () => { }; window.prompt = () => null;
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
  while (Date.now() - boot < 8_000 && document.querySelectorAll('.note-stack .note-card,.pro-grid .note-card').length < 1) await wait(60);
  const card = [...document.querySelectorAll('.note-stack .note-card,.pro-grid .note-card')]
    .find(c => (c.textContent || '').includes('논문 편집'));
  check('노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1600);
  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));

  const tb = document.querySelector('#pagesStage .tb[data-id="t1"]');
  const content = tb && tb.querySelector('.tb-content');
  check('tight 글상자가 그려진다', !!content && tb.classList.contains('tight'));
  check('절대좌표 단어 span 6개로 그려진다', content.querySelectorAll(':scope>span[data-pdf-w]').length === 6);
  const absTop = () => [...content.querySelectorAll(':scope>span[data-pdf-w]')].map(s => parseFloat(s.style.top));
  const absLeft = () => [...content.querySelectorAll(':scope>span[data-pdf-w]')].map(s => parseFloat(s.style.left));
  const pdfBase = () => [...content.querySelectorAll(':scope>span[data-pdf-w]')].map(s => s.dataset.pdfBase);
  const pdfW = () => [...content.querySelectorAll(':scope>span[data-pdf-w]')].map(s => s.dataset.pdfW);
  const originals = { top: [0, 0, 0, 24, 24, 24], left: [0, 60, 120, 0, 58, 140] };

  // ══ ① 상자 선택(비편집) 상태에서 상자 전체 폰트 변경 ──
  content.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 80, clientY: 60 }));
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await wait(120);
  check('① 상자가 선택된다', tb.classList.contains('sel'));
  window.applyFont('gaegu');
  await wait(200);
  {
    const el1 = window.findEl(0, 't1');
    check('① 상자 전체 폰트가 문서(el.font)에 저장된다', el1 && el1.font === 'gaegu');
    check('① 절대 단어 span 이 전부 그대로 남는다', content.querySelectorAll(':scope>span[data-pdf-w]').length === 6);
    check('① 단어 가로 좌표(left)가 어긋나지 않는다',
      JSON.stringify(absLeft()) === JSON.stringify(originals.left));
    check('① 단어 세로 좌표(top)가 어긋나지 않는다',
      JSON.stringify(absTop()) === JSON.stringify(originals.top));
    check('① PDF 원본 진행 폭(pdfW)·기준선(pdfBase) 데이터가 보존된다',
      JSON.stringify(pdfW()) === JSON.stringify(['46', '38', '48', '44', '60', '36'])
      && pdfBase().every((b, i) => b === String(originals.top[i] + 16)));
  }
  // 저장·다시 그리기(리렌더) 후에도 같은 배치
  await wait(500);
  const contentAfter = await pollUntil(() => {
    const tbA = document.querySelector('#pagesStage .tb[data-id="t1"]');
    const cA = tbA && tbA.querySelector('.tb-content');
    return cA ? cA : null;
  });
  check('① 폰트 변경 후에도 상자 본문이 남는다', contentAfter && (contentAfter.textContent || '').includes('alpha'));
  check('① 폰트 변경은 표시 전용 — 저장된 원문에 임의 인라인 폰트를 깔지 않는다',
    !(window.findEl(0, 't1').html || '').includes('font-family: Gaegu')
    && !(window.findEl(0, 't1').html || '').includes('font-family: gaegu'));

  // ══ ② 편집 진입(줄 흐름 변환) 후 도중 폰트 → Enter → 이어 쓰기 ──
  const tb2 = document.querySelector('#pagesStage .tb[data-id="t1"]');
  const content2 = tb2.querySelector('.tb-content');
  content2.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(120);
  check('② 더블클릭으로 편집 모드에 들어간다', tb2.classList.contains('edit'));
  check('② tight 상자가 줄 흐름(.sdy-tl)으로 바뀐다',
    content2.querySelectorAll(':scope>.sdy-tl').length >= 2);
  const rowTopsBefore = () => [...content2.querySelectorAll(':scope>.sdy-tl')].map(r => parseFloat(r.style.top));
  const rowTop0 = rowTopsBefore();
  check('② 첫 줄의 원문 세로 위치가 보존된다', rowTop0[0] === 0);
  // 14.44 · 원문 줄은 절대 '한 줄' — 공백 실측 오차로 상자 폭을 1px 미만 넘어가도
  //   마지막 단어가 다음 줄로 접혀 아래 원문 줄과 겹치지 않도록 nowrap 이다.
  check('② 줄 흐름의 각 줄이 nowrap(줄 안 절대 줄바꿈 없음)이다',
    [...content2.querySelectorAll(':scope>.sdy-tl')].every(r => r.style.whiteSpace === 'nowrap'));

  // 2-1 마지막 원문 줄 끝에 서식 없이 한 글자 → 이어 쓰기
  const rows0 = content2.querySelectorAll(':scope>.sdy-tl');
  const lastRow = rows0[rows0.length - 1];
  {
    const last = lastTextNode(lastRow);
    const r = document.createRange();
    r.setStart(last, (last.nodeValue || '').length); r.collapse(true);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    window.saveSel();
  }
  typeAt(window, content2, '일');
  await wait(80);
  check('② 줄 흐름에서도 입력이 마지막 줄에 들어간다',
    (lastRow.textContent || '').includes('일'));
  {
    const fam0 = effStyle(window, content2, '일').fontFamily || '';
    check('② 서식 없이 친 글자는 상자 기본 폰트다',
      fam0 === '' || fam0.indexOf('Pretendard') >= 0);
  }

  // 2-2 그 자리에서 폰트를 바꾸고(캐럿 서식) 이어 적는다
  {
    const last = lastTextNode(lastRow);
    const r = document.createRange();
    r.setStart(last, (last.nodeValue || '').length); r.collapse(true);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    window.saveSel();
  }
  window.applyFont('jua');
  await wait(80);
  typeAt(window, content2, '둘');
  await wait(80);

  check('② 캐럿에 정한 폰트로 새 글자가 들어간다',
    (effStyle(window, content2, '둘').fontFamily || '').includes('Jua'));
  check('② 이전 글자(일) 폰트는 그대로다',
    !(effStyle(window, content2, '일').fontFamily || '').includes('Jua'));

  // 2-3 Enter — 새 줄을 만들고 이어 적는다 (서식 유지가 핵심)
  {
    const last = lastTextNode(lastRow);
    const r = document.createRange();
    r.setStart(last, (last.nodeValue || '').length); r.collapse(true);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    window.saveSel();
  }
  content2.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Enter', bubbles: true, cancelable: true,
  }));
  await wait(120);
  const rowsAfterEnter = [...content2.querySelectorAll(':scope>.sdy-tl')];
  check('② Enter 로 새 줄이 생긴다', rowsAfterEnter.length >= 3);
  const newRow = rowsAfterEnter[rowsAfterEnter.length - 1];
  check('② 새 줄이 마지막 원문 줄 아래(원문 줄은 안 움직임)에 붙는다',
    parseFloat(newRow.style.top) > parseFloat(lastRow.style.top)
    && Math.abs(parseFloat(rowsAfterEnter[0].style.top) - rowTop0[0]) < 0.01);
  check('② Enter 후에도 원문 줄 위치가 그대로다',
    JSON.stringify(rowsAfterEnter.slice(0, rowTop0.length).map(r => parseFloat(r.style.top)))
    === JSON.stringify(rowTop0));
  typeAt(window, content2, '셋');
  await wait(80);

  check('② Enter 뒤에 적은 글자가 새 줄(원문 아래)에 들어간다',
    newRow.isConnected && (newRow.textContent || '').includes('셋'));

  check('② Enter 뒤에 적은 글자가 Enter 전 폰트(Jua)를 유지한다',
    (effStyle(window, content2, '셋').fontFamily || '').includes('Jua'));
  check('② 기존 단어(gamma)는 엔터로도 폰트가 풀리지 않는다',
    effStyle(window, content2, 'gamma').fontFamily == null
    && (content2.textContent || '').includes('gamma'));


  // Escape 커밋 — 14.45 · 저장된 html 은 단어별 절대좌표로 복원된다
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(300);
  {
    const el2 = window.findEl(0, 't1');
    const h2 = (el2 && el2.html) || '';
    check('② 저장된 html 에 줄 흐름(.sdy-tl)·간격(.sdy-tg)이 남지 않는다',
      !h2.includes('sdy-tl') && !h2.includes('sdy-tg') && h2.includes('data-pdf-w'));
    check('② 저장된 html 에 새 줄·입력 글자와 Jua 서식이 남는다',
      h2.includes('셋') && h2.includes('Jua'));
    check('② 저장 문자열에 입력 닻(ZWSP)이 남지 않는다', !h2.includes('\u200B'));
    check('② 안 건드린 첫 줄(alpha·beta·gamma) 좌표가 그대로다',
      hasGeom(h2, 'alpha', 0, 0, 46, 16) && hasGeom(h2, 'beta', 60, 0, 38, 16)
      && hasGeom(h2, 'gamma', 120, 0, 48, 16));
    check('② 안 건드린 단어(delta·epsilon) 좌표가 그대로다',
      hasGeom(h2, 'delta', 0, 24, 44, 40) && hasGeom(h2, 'epsilon', 58, 24, 60, 40));
    check('② 이어 쓴 단어(zeta일둘)는 zeta 자리(left 140)에 들어간다',
      outerSpanLeft(h2, 'zeta일') === 140 && (h2.match(/data-pdf-w/g) || []).length === 7);
    check('② 엔터로 만든 줄의 새 글자(셋)가 마지막 줄에 들어간다',
      spanLeft(h2, '셋') === 0 && spanTop(h2, '셋') > 24);
  }

  // ══ ③ 다시 열어 드래그 선택 + 형광펜 → 글꼴/크기 보존 ──
  const tb3 = document.querySelector('#pagesStage .tb[data-id="t1"]');
  const content3 = tb3.querySelector('.tb-content');
  content3.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(120);
  selectSub(window, content3, '일');       // 서식 없는 원문 글자 선택
  window.applyFont('gaegu');               // 부분 선택 폰트
  await wait(120);
  check('③ 선택 구간 폰트가 바뀐다',
    (effStyle(window, content3, '일').fontFamily || '').includes('Gaegu'));
  selectSub(window, content3, '둘');       // Jua 로 입력된 글자 선택
  window.applyHighlight('#fff59d');        // 형광펜
  await wait(200);
  check('③ 형광펜을 친 둘에만 배경이 생긴다',
    (effStyle(window, content3, '둘').backgroundColor || '').includes('255, 245, 157'));
  check('③ 형광펜을 쳐도 같은 글자의 폰트(Jua)가 풀리지 않는다',
    (effStyle(window, content3, '둘').fontFamily || '').includes('Jua'));
  check('③ 형광펜이 칠해지지 않은 이웃(일)의 서식이 그대로다',
    (effStyle(window, content3, '일').fontFamily || '').includes('Gaegu')
    && effStyle(window, content3, '일').backgroundColor == null);
  check('③ 서식 엔진 재구축 후에도 줄 위치·텍스트가 보존된다',
    content3.querySelectorAll(':scope>.sdy-tl').length >= 3
    && (content3.textContent || '').includes('gamma'));
  selectSub(window, content3, 'beta');     // 다른 줄의 원문 단어
  window.applyHighlight('#ffd54f');
  await wait(120);
  check('③ 형광펜을 다시 칠해도 먼저 칠한 폰트/배경이 유지된다',
    (effStyle(window, content3, '둘').fontFamily || '').includes('Jua')
    && (effStyle(window, content3, '둘').backgroundColor || '').includes('255, 245, 157')
    && (effStyle(window, content3, 'beta').backgroundColor || '').includes('255, 213, 79'));

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(300);
  {
    const el3 = window.findEl(0, 't1');
    const h3 = (el3 && el3.html) || '';
    check('③ 저장된 html 에 형광펜 배경이 남는다',
      h3.includes('255, 245, 157') || h3.includes('fff59d'));
    check('③ 저장된 html 에 부분 폰트(Gaegu)가 남는다', h3.includes('Gaegu'));
    check('③ 저장된 html 에 줄 흐름이 남지 않는다(단어 절대좌표)',
      !h3.includes('sdy-tl') && !h3.includes('sdy-tg'));
  }

  // ══ ④ 방향키(브라우저 기본 캐럿) 흘려보냄 + 교차 줄 Shift+선택→형광펜 ══
  //   편집 중 상하좌우키는 앱이 가로채면 안 된다(스프레드시트 상자 이동 금지,
  //   브라우저 기본 캐럿 이동·Shift 선택으로 흘려보낸다). jsdom 은 네이티브
  //   캐럿을 못 움직이므로, 대신 ① 가로챔이 없는지 ② 그 '결과 선택'(두 줄에
  //   걸친 Range)에 형광펜/서식이 이어서 칠해지는지 단언한다.
  const tb4 = document.querySelector('#pagesStage .tb[data-id="t1"]');
  const content4 = tb4.querySelector('.tb-content');
  const boxXY4 = () => { const e4 = window.findEl(0, 't1'); return String(e4.x) + ',' + String(e4.y); };
  const beforeXY4 = boxXY4();
  content4.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(150);
  check('④ 편집 모드에 다시 들어간다', tb4.classList.contains('edit'));
  let arrowsFree = true;
  for (const opt of [{}, { shiftKey: true }]) {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      const ev = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opt });
      content4.dispatchEvent(ev);
      if (ev.defaultPrevented) arrowsFree = false;
    }
  }
  check('④ 방향키(Shift 포함)가 편집 중 앱에 가로채이지 않는다', arrowsFree);
  check('④ 방향키를 눌러도 상자가 이동(스프레드시트 모드)하지 않고 편집이 유지된다',
    boxXY4() === beforeXY4 && tb4.classList.contains('edit'));
  const tnA = textNodeOf(window, content4, '둘');   // Jua 로 적은 글자 (원문 줄)
  const tnB = textNodeOf(window, content4, '셋');   // Enter 로 만든 새 줄
  assert.ok(tnA && tnB, '④ 형광펜 대상 글자(둘·셋)를 찾지 못했다');
  const rowA = tnA.parentElement.closest('.sdy-tl') || tnA.parentElement;
  const rowB = tnB.parentElement.closest('.sdy-tl') || tnB.parentElement;
  check('④ 둘과 셋이 서로 다른 줄에 있다', rowA !== rowB);
  const topBefore4 = [...content4.querySelectorAll(':scope>.sdy-tl')].map(r => parseFloat(r.style.top));
  // ④-1 드래그/Shift+방향키로 '둘 처음 → 셋 끝'까지 두 줄에 걸쳐 고른 선택
  const r4 = window.document.createRange();
  r4.setStart(tnA, 0);
  r4.setEnd(tnB, (tnB.nodeValue || '').length);
  const sel4 = window.getSelection();
  sel4.removeAllRanges(); sel4.addRange(r4);
  window.saveSel();
  check('④ 교차 줄 선택이 텍스트 선택으로 인식된다',
    !sel4.isCollapsed && r4.commonAncestorContainer.nodeType === 1
    && !!r4.commonAncestorContainer.closest('.tb-content'));
  window.applyHighlight('#ce93d8');
  await wait(200);
  check('④ 교차 줄 선택에 형광펜이 한 번에 칠해진다',
    (effStyle(window, content4, '둘').backgroundColor || '').includes('206, 147, 216')
    && (effStyle(window, content4, '셋').backgroundColor || '').includes('206, 147, 216'));
  check('④ 형광펜을 쳐도 두 줄 모두 Jua 가 풀리지 않는다',
    (effStyle(window, content4, '둘').fontFamily || '').includes('Jua')
    && (effStyle(window, content4, '셋').fontFamily || '').includes('Jua'));
  check('④ 선택 밖(일)의 서식은 그대로다',
    (effStyle(window, content4, '일').fontFamily || '').includes('Gaegu'));
  const topMid4 = [...content4.querySelectorAll(':scope>.sdy-tl')].map(r => parseFloat(r.style.top));
  check('④ 교차 줄 형광펜 후에도 줄 세로 위치가 하나도 안 움직인다',
    JSON.stringify(topMid4) === JSON.stringify(topBefore4));
  // ④-2 줄 끝 캐럿에서 Shift+ArrowDown — '아랫줄 전체'만 선택된다 (윗줄 글자 불포함)
  //   형광펜은 줄을 리렌더하므로(span 교체) 다시 실제 노드를 조회해 Range 를 만든다.
  {
    const a2 = textNodeOf(window, content4, '둘');   // 윗줄 끝 글자 (형광펜 후 리렌더된 노드)
    const b2 = textNodeOf(window, content4, '셋');
    assert.ok(a2 && b2, '④-2 대상 글자(둘·셋)를 찾지 못했다');
    const r5 = window.document.createRange();
    r5.setStart(a2, (a2.nodeValue || '').length);   // 둘 끝 = 원문 줄 끝 (둘은 선택에 안 든다)
    r5.setEnd(b2, (b2.nodeValue || '').length);     // 셋 줄 끝 → 셋 전체 선택
    const s5 = window.getSelection();
    s5.removeAllRanges(); s5.addRange(r5);
    window.saveSel();
    window.applyHighlight('#81c784');
    await wait(200);
    check('④ 줄 끝에서 Shift+ArrowDown 식 선택은 아랫줄에만 형광펜이 칠해진다',
      (effStyle(window, content4, '셋').backgroundColor || '').includes('129, 199, 132')
      && !(effStyle(window, content4, '둘').backgroundColor || '').includes('129, 199, 132'));
    check('④ 다시 칠해도 윗줄(둘)의 Jua·형광펜이 유지된다',
      (effStyle(window, content4, '둘').fontFamily || '').includes('Jua')
      && (effStyle(window, content4, '둘').backgroundColor || '').includes('206, 147, 216'));
  }
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(300);
  {
    const el4 = window.findEl(0, 't1');
    const h4 = (el4 && el4.html) || '';
    check('④ 저장된 html 에 교차 줄 형광펜이 남는다',
      h4.includes('206, 147, 216') || h4.includes('ce93d8'));
    check('④ 저장된 html 에 새 줄·Jua 서식이 남고 줄 흐름은 남지 않는다',
      h4.includes('Jua') && !h4.includes('sdy-tl') && !h4.includes('sdy-tg'));
  }

  // ══ ⑤ 문장(한 줄 전체) 선택 형광펜 — 단어 사이 간격까지 이어서 칠해진다 ══
  //   PDF 줄은 단어마다 글꼴 고정 span + 단어 사이 실측 간격 스페이서(.sdy-tg).
  //   문장 전체를 선택해 칠하면 ① 글자 단위가 아니라 연속 띠(문장 단위)로,
  //   단어 사이 간격에도 배경이 끊김 없이 이어지고 ② 좁은(글자 일부) 선택은
  //   이웃 간격까지 덮지 않으며 ③ 지우면 스페이서 원래 높이로 되돌아간다.
  // 14.45 · 읽기 복귀 rebuild 가 노드를 교체하므로 매번 live 노드를 다시 조회한다
  let tb5 = document.querySelector('#pagesStage .tb[data-id="t1"]');
  let content5 = tb5.querySelector('.tb-content');
  const requery5 = () => {
    tb5 = document.querySelector('#pagesStage .tb[data-id="t1"]');
    content5 = tb5.querySelector('.tb-content');
  };
  content5.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(150);
  const rowA5 = () => [...content5.querySelectorAll(':scope>.sdy-tl')]
    .find(r => (r.textContent || '').includes('alpha'));
  assert.ok(rowA5(), '⑤ alpha 줄을 찾지 못했다');
  const selRow5 = (row, fromFirst = true) => {
    const tw = window.document.createTreeWalker(row, window.NodeFilter.SHOW_TEXT);
    const tns = []; let n;
    while ((n = tw.nextNode())) tns.push(n);
    const real = tns.filter(t => String(t.nodeValue || '').replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim() !== '');
    const r = window.document.createRange();
    if (fromFirst) {
      r.setStart(real[0], 0);
      r.setEnd(real[real.length - 1], (real[real.length - 1].nodeValue || '').length);
    } else {
      // 'beta' 단어 글자만 (첫 3글자) — 이웃 간격은 선택 밖이어야 한다
      const bt = real.find(t => (t.nodeValue || '').includes('beta'));
      r.setStart(bt, 0);
      r.setEnd(bt, 3);
    }
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    window.saveSel();
  };
  const tgState5 = (row) => [...row.querySelectorAll('.sdy-tg')].map(g => ({
    bg: (g.style && g.style.backgroundColor) || '',
    h: parseFloat((g.style && g.style.height) || '0') || 0,
  }));
  // ⑤-1 문장 전체 → 간격까지 연속 형광펜
  selRow5(rowA5(), true);
  window.applyHighlight('#ffab40');
  await wait(250);
  {
    const row = rowA5();
    const tgs = tgState5(row);
    check('⑤ 문장 전체 선택 시 단어 사이 간격 스페이서에도 형광펜이 칠해진다',
      tgs.length >= 2 && tgs.every(t => (t.bg || '').includes('255, 171, 64')));
    check('⑤ 간격 스페이서 배경이 보이도록 줄 높이만큼 커진다(레이아웃은 줄 간격과 동일)',
      tgs.every(t => t.h > 0));
    check('⑤ 문장 전체가 한 색으로 이어진다(alpha·beta·gamma·간격 전부 같은 배경)',
      ['alpha', 'beta', 'gamma'].every(w =>
        (effStyle(window, content5, w).backgroundColor || '').includes('255, 171, 64')));
  }
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(300);
  {
    const h5 = (window.findEl(0, 't1').html) || '';
    check('⑤ 저장된 html 에 간격까지 이어진 문장 형광펜이 남는다(단어 절대좌표)',
      h5.includes('255, 171, 64') && !h5.includes('sdy-tg') && !h5.includes('sdy-tl')
      && (h5.match(/255, 171, 64/g) || []).length >= 3);
  }
  // ⑤-2 단어 일부(좁은 선택) → 이웃 간격은 덮지 않는다
  requery5();
  content5.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(150);
  check('⑤ 다시 편집에 들어가도 문장 형광펜이 보인다', tb5.classList.contains('edit') && !!rowA5());
  selRow5(rowA5(), false);
  window.applyHighlight('#90caf9');
  await wait(250);
  {
    const row = rowA5();
    const tgs = tgState5(row);
    check('⑤ 글자 일부 선택에는 그 글자에만 새 색이 칠해진다',
      (effStyle(window, content5, 'bet').backgroundColor || '').includes('144, 202, 249'));
    check('⑤ 좁은 선택이 이웃 단어 사이 간격까지 덮지 않는다(기존 문장 색 유지)',
      tgs.every(t => (t.bg || '').includes('255, 171, 64') && !(t.bg || '').includes('144, 202, 249')));
  }
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(300);
  // ⑤-3 문장 전체 다시 선택해 형광펜 지우기 → 스페이서도 원래대로
  requery5();
  content5.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(150);
  selRow5(rowA5(), true);
  window.applyHighlight(null);
  await wait(250);
  {
    const row = rowA5();
    const tgs = tgState5(row);
    check('⑤ 형광펜을 지우면 문장 글자 배경이 사라진다',
      ['alpha', 'beta', 'gamma'].every(w => !effStyle(window, content5, w).backgroundColor));
    check('⑤ 형광펜을 지우면 간격 스페이서 배경·높이가 원래대로 돌아간다',
      tgs.every(t => !t.bg && t.h === 0));
  }
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(300);

  // ══ ⑥ 일반 텍스트 상자 — Tab = 들여쓰기 (Word 식), Shift+Tab = 내어쓰기 ══
  const tb6 = document.querySelector('#pagesStage .tb[data-id="t2"]');
  const content6 = tb6.querySelector('.tb-content');
  const tabCount6 = () => content6.querySelectorAll('.sdy-tab').length;
  const caretAtTextStart = () => {
    const tn = textNodeOf(window, content6, '가나다');
    const r = window.document.createRange();
    r.setStart(tn, 0); r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    window.saveSel();
  };
  const pressTab = (shift) => {
    const ev = new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: !!shift, bubbles: true, cancelable: true });
    content6.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  content6.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(150);
  check('⑥ 일반 텍스트 상자가 편집 모드에 들어간다', tb6.classList.contains('edit'));
  caretAtTextStart();
  check('⑥ Tab 누르면 들여쓰기가 생기고(글자는 그대로) 브라우저 이동이 막힌다',
    pressTab(false) && tabCount6() === 1 && (content6.textContent || '').includes('가나다'));
  {
    // 커서를 글자 앞에 두면 빈 텍스트 노드 껍데기가 남을 수 있어, '들여쓰기
    // 단위가 원문 글자 바로 앞(커서 자리)에 놓였는지'로 본다.
    const tabEl6 = content6.querySelector('.sdy-tab');
    check('⑥ 들여쓰기 단위는 커서 위치(원문 바로 앞)에 놓인다',
      !!tabEl6 && String((tabEl6.nextSibling && tabEl6.nextSibling.nodeValue) || '').includes('가나다'));
  }
  caretAtTextStart();
  check('⑥ Tab 을 한 번 더 누르면 들여쓰기가 한 단계 더해진다', pressTab(false) && tabCount6() === 2);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(300);
  {
    const h6 = (window.findEl(0, 't2').html) || '';
    check('⑥ 저장된 html 에 들여쓰기(.sdy-tab)가 남는다', h6.includes('sdy-tab') && h6.includes('가나다'));
  }
  content6.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(150);
  caretAtTextStart();
  check('⑥ Shift+Tab 은 커서 앞 들여쓰기를 한 단계 지운다', pressTab(true) && tabCount6() === 1);
  caretAtTextStart();
  check('⑥ Shift+Tab 을 다시 누르면 들여쓰기가 모두 빠진다', pressTab(true) && tabCount6() === 0);
  caretAtTextStart();
  check('⑥ 들여쓰기가 없을 때 Shift+Tab 은 아무 일도 하지 않는다(상자가 이동하지 않는다)',
    pressTab(true) && tabCount6() === 0
    && window.findEl(0, 't2').x === 520 && tb6.classList.contains('edit'));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(300);
  {
    const h6b = (window.findEl(0, 't2').html) || '';
    check('⑥ 내어쓰기 후 저장된 html 에 들여쓰기가 남지 않는다', !h6b.includes('sdy-tab'));
  }

  // ══ ⑦ 고정 스팬(논문) — 자간을 입힌 글자 뒤에 입력·Enter·형광펜을 해도
  //      자간(letter-spacing)·글꼴이 풀리지 않고, 줄 위치도 변하지 않는다 ══
  const tb7 = document.querySelector('#pagesStage .tb[data-id="t1"]');
  const content7 = tb7.querySelector('.tb-content');
  const rowTops7 = () => [...content7.querySelectorAll(':scope>.sdy-tl')].map(r => parseFloat(r.style.top));
  content7.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(150);
  // 14.45 · 편집 진입 시 절대좌표→줄 흐름 변환이 일어나므로 진입 뒤에 조회한다
  const tnDul = textNodeOf(window, content7, '둘');
  assert.ok(tnDul, '⑦ 자간 대상 글자(둘)를 찾지 못했다');
  const spanDul = tnDul.parentElement;
  spanDul.style.letterSpacing = '3px';
  check('⑦ 자간(letter-spacing)이 글자 스팬에 적용된다',
    (effStyle(window, content7, '둘').letterSpacing || '').includes('3px'));
  const topsBefore7 = rowTops7();
  // '둘' 끝에 캐럿 → Enter(새 줄) → '차' 입력
  {
    const r = window.document.createRange();
    r.setStart(tnDul, (tnDul.nodeValue || '').length); r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    window.saveSel();
  }
  content7.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await wait(150);
  typeAt(window, content7, '차');
  await wait(120);
  check('⑦ 자간 글자 뒤 Enter+입력 시 새 글자에 Jua·자간이 그대로 이어진다',
    (effStyle(window, content7, '차').fontFamily || '').includes('Jua')
    && (effStyle(window, content7, '차').letterSpacing || '').includes('3px'));
  check('⑦ 자간 글자 뒤 Enter+입력 시 원문 줄 위치가 하나도 안 움직인다',
    JSON.stringify(rowTops7().slice(0, topsBefore7.length)) === JSON.stringify(topsBefore7));
  // 같은 글자에 형광펜 → 자간·글꼴이 풀리지 않는다
  selectSub(window, content7, '둘');
  window.applyHighlight('#fff59d');
  await wait(200);
  check('⑦ 형광펜을 쳐도 자간·글꼴이 풀리지 않는다',
    (effStyle(window, content7, '둘').letterSpacing || '').includes('3px')
    && (effStyle(window, content7, '둘').fontFamily || '').includes('Jua')
    && (effStyle(window, content7, '둘').backgroundColor || '').includes('255, 245, 157'));
  check('⑦ 형광펜 후에도 새 줄 글자(차)의 자간·글꼴이 유지된다',
    (effStyle(window, content7, '차').letterSpacing || '').includes('3px')
    && (effStyle(window, content7, '차').fontFamily || '').includes('Jua'));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(300);
  {
    const h7 = (window.findEl(0, 't1').html) || '';
    check('⑦ 저장된 html 에 자간(letter-spacing)이 남는다', h7.includes('letter-spacing'));
    check('⑦ 저장된 html 에 형광펜·Jua 가 남고 줄 흐름은 남지 않는다',
      h7.includes('255, 245, 157') && h7.includes('Jua')
      && !h7.includes('sdy-tl') && !h7.includes('sdy-tg'));
  }

  // ══ ⑧ 워드에서 매일 쓰는 편집 동작 — 일반 글상자에서 그대로 재현 ══
  //   (자료: MS Word 기능 테스트/실습 가이드 — 타이핑·선택 덮어쓰기·굵게/
  //   기울임/밑줄·전체 선택 일괄 서식·색/형광펜·서식 보존·문단 전환)
  const tb8 = document.querySelector('#pagesStage .tb[data-id="t2"]');
  const content8 = tb8.querySelector('.tb-content');
  const savedHtml8 = () => (window.findEl(0, 't2').html) || '';
  content8.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(150);
  content8.innerHTML = '';
  caretEnd(window, content8);
  const w8 = '문서작성 Ver2.0 · 「인용문」 100% 확인';
  typeAt(window, content8, w8);
  await wait(150);
  check('⑧ 한글·영문·숫자·기호가 섞인 문장을 그대로 입력할 수 있다',
    (content8.textContent || '').replace(/\u00a0/g, ' ') === w8);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(300);
  check('⑧ 입력한 문장이 저장된 html 에 그대로 남는다', savedHtml8().includes(w8));
  // ⑧-2 선택한 글자 위에 바로 타이핑 = 덮어쓰기 (워드 '입력하면 선택이 대체')
  content8.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(150);
  selectSub(window, content8, '100%');
  typeAt(window, content8, '완료');
  await wait(150);
  check('⑧ 선택한 글자 위에 타이핑하면 그 구간만 새 글로 바뀐다',
    !(content8.textContent || '').includes('100%')
    && (content8.textContent || '').includes('완료')
    && (content8.textContent || '').includes('문서작성'));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(300);
  check('⑧ 덮어쓴 결과가 저장된 html 에 반영된다',
    savedHtml8().includes('완료') && !savedHtml8().includes('100%'));
  // ⑧-3 한 단어에 굵게 + 기울임 + 밑줄 동시 (워드 기본 글자 서식)
  content8.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(150);
  selectSub(window, content8, '완료');
  window.execFmt('bold'); await wait(100);
  window.execFmt('italic'); await wait(100);
  window.execFmt('underline'); await wait(120);
  check('⑧ 단어에 굵게·기울임·밑줄이 한꺼번에 남는다',
    effStyle(window, content8, '완료').fontWeight === '700'
    && effStyle(window, content8, '완료').fontStyle === 'italic'
    && (effStyle(window, content8, '완료').textDecoration || '').includes('underline'));
  check('⑧ 이웃 글자(인용문)는 서식이 안 묻는다',
    !(effStyle(window, content8, '인용문').fontWeight || '').includes('700')
    && !(effStyle(window, content8, '인용문').fontStyle || '').includes('italic'));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(300);
  check('⑧ 저장된 html 에 굵게·기울임·밑줄 세 서식이 남는다',
    /font-weight:\s*700/.test(savedHtml8()) && /font-style:\s*italic/.test(savedHtml8())
    && savedHtml8().includes('text-decoration'));
  // ⑧-4 전체 선택(Ctrl+A 와 같은 범위) → 글꼴·크기·색·형광펜 일괄
  content8.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(150);
  {
    const r = window.document.createRange();
    r.selectNodeContents(content8);
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    window.saveSel();
  }
  window.applyFont('gaegu'); await wait(120);
  window.setFS(21); await wait(120);
  window.applyTextColor('#e67e22'); await wait(120);
  window.applyHighlight('#c5e1a5'); await wait(200);
  check('⑧ 전체 선택에 글꼴·크기·색·형광펜이 모두 들어간다',
    (effStyle(window, content8, '문서작성').fontFamily || '').includes('Gaegu')
    && effStyle(window, content8, '문서작성').fontSize === '21px'
    && effStyle(window, content8, '문서작성').color === 'rgb(230, 126, 34)'
    && (effStyle(window, content8, '문서작성').backgroundColor || '').includes('197, 225, 165'));
  check('⑧ 일괄 서식을 입혀도 단어의 굵게·기울임·밑줄이 풀리지 않는다',
    effStyle(window, content8, '완료').fontWeight === '700'
    && effStyle(window, content8, '완료').fontStyle === 'italic'
    && (effStyle(window, content8, '완료').textDecoration || '').includes('underline')
    && effStyle(window, content8, '완료').fontSize === '21px');
  // ⑧-5 같은 범위에서 형광펜만 제거 → 색·글꼴·크기는 남는다 (서식 비파괴)
  {
    const r = window.document.createRange();
    r.selectNodeContents(content8);
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    window.saveSel();
  }
  window.applyHighlight(null);
  await wait(200);
  check('⑧ 형광펜을 지워도 글자색·글꼴·크기가 그대로 남는다',
    !effStyle(window, content8, '문서작성').backgroundColor
    && effStyle(window, content8, '문서작성').color === 'rgb(230, 126, 34)'
    && (effStyle(window, content8, '문서작성').fontFamily || '').includes('Gaegu')
    && effStyle(window, content8, '문서작성').fontSize === '21px');
  // ⑧-6 문단 나눔(일반 상자) — 브라우저 기본 줄바꿈 결과(<br>)로 저장까지 이어짐
  {
    const tn = lastTextNode(content8);
    const br = window.document.createElement('br');
    tn.parentNode.insertBefore(br, tn.nextSibling);
    const r = window.document.createRange();
    r.setStartAfter(br); r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    content8.dispatchEvent(new window.InputEvent('input', { bubbles: true, inputType: 'insertLineBreak' }));
    await wait(120);
  }
  typeAt(window, content8, '둘째 문단');
  await wait(150);
  check('⑧ 문단을 나누고 이어 쓰면 앞 문단·뒤 문단이 모두 남는다',
    (content8.textContent || '').includes('문서작성')
    && (content8.textContent || '').includes('둘째 문단'));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(300);
  check('⑧ 저장된 html 에 문단 나눔(<br>)과 두 문단이 남는다',
    savedHtml8().includes('<br>')
    && savedHtml8().includes('문서작성') && savedHtml8().includes('둘째 문단'));
  // ⑧-7 문단 정렬 (워드 '커서를 두고 정렬 버튼' — 가운데/오른쪽/왼쪽)
  content8.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(150);
  caretEnd(window, content8);
  window.setAlign('center');
  await wait(150);
  check('⑧ 가운데 정렬을 누르면 그 문단(상자)이 가운데 정렬로 저장된다',
    content8.style.textAlign === 'center' && window.findEl(0, 't2').align === 'center');
  window.setAlign('right');
  await wait(150);
  check('⑧ 다시 오른쪽 정렬로 바꾸면 정렬이 바뀐다',
    content8.style.textAlign === 'right' && window.findEl(0, 't2').align === 'right');
  window.setAlign('left');
  await wait(150);
  check('⑧ 왼쪽 정렬로 되돌릴 수 있다', content8.style.textAlign === 'left');

  // ══ ⑨ 복합 서식 — 한 텍스트에 여러 서식 겹치기 · 덧씌우기 · 부분 제거 ══
  //   (자료: Word 기능 가이드 — '14pt 굵게·기울임·빨강' 한 단어 복합 서식,
  //   한 단어에 굵게+기울임+색 등 다중 효과, 위에 다른 서식 덧씌우면
  //   해당 속성만 교체되고 나머지 보존, 밑줄·취소선 같은 textEffect 공존과
  //   개별 제거, 형광펜은 마지막에 칠해도 글자 서식을 안 지움, 서식 지우기)
  const tb9 = document.querySelector('#pagesStage .tb[data-id="t2"]');
  const content9 = tb9.querySelector('.tb-content');
  content9.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(150);
  content9.innerHTML = '';
  caretEnd(window, content9);
  typeAt(window, content9, '빠른 갈색 여우가');
  await wait(150);
  // ⑨-1 한 단어에 크기+굵게+기울임+글자색을 한꺼번에
  selectSub(window, content9, '갈색');
  window.setFS(26); await wait(80);
  window.execFmt('bold'); await wait(80);
  window.execFmt('italic'); await wait(80);
  window.applyTextColor('#c0392b'); await wait(150);
  check('⑨ 한 단어에 크기·굵게·기울임·글자색이 모두 들어간다',
    effStyle(window, content9, '갈색').fontSize === '26px'
    && effStyle(window, content9, '갈색').fontWeight === '700'
    && effStyle(window, content9, '갈색').fontStyle === 'italic'
    && effStyle(window, content9, '갈색').color === 'rgb(192, 57, 43)');
  check('⑨ 이웃 단어(빠른)에는 서식이 하나도 안 묻는다',
    !effStyle(window, content9, '빠른').color
    && !(effStyle(window, content9, '빠른').fontWeight || '').includes('700'));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(300);
  {
    const h9 = (window.findEl(0, 't2').html) || '';
    check('⑨ 저장된 html 에 네 서식이 모두 남는다',
      h9.includes('26px') && /font-weight:\s*700/.test(h9)
      && /font-style:\s*italic/.test(h9) && h9.includes('192, 57, 43'));
  }
  // ⑨-2 덧씌우기 — 글꼴·색·크기를 바꿔도 굵게/기울임은 그대로 (속성별 교체)
  content9.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(150);
  selectSub(window, content9, '갈색');
  window.applyFont('gaegu'); await wait(80);
  window.applyTextColor('#2980b9'); await wait(80);
  window.setFS(30); await wait(120);
  check('⑨ 글꼴·색·크기를 덧씌우면 해당 속성만 새 값으로 교체된다',
    (effStyle(window, content9, '갈색').fontFamily || '').includes('Gaegu')
    && effStyle(window, content9, '갈색').color === 'rgb(41, 128, 185)'
    && effStyle(window, content9, '갈색').fontSize === '30px');
  check('⑨ 덧씌워도 굵게·기울임이 풀리지 않는다',
    effStyle(window, content9, '갈색').fontWeight === '700'
    && effStyle(window, content9, '갈색').fontStyle === 'italic');
  check('⑨ 옛 글자색(빨강)은 남지 않고 새 색만 남는다',
    !JSON.stringify(effStyle(window, content9, '갈색')).includes('192, 57, 43'));
  // ⑨-3 밑줄+취소선 공존, 하나만 골라 지우기 (textEffect 토큰)
  selectSub(window, content9, '갈색');
  window.execFmt('underline'); await wait(80);
  window.execFmt('strike'); await wait(120);
  check('⑨ 밑줄과 취소선이 한 단어에 함께 남는다',
    (effStyle(window, content9, '갈색').textDecoration || '').includes('underline')
    && (effStyle(window, content9, '갈색').textDecoration || '').includes('line-through'));
  selectSub(window, content9, '갈색');
  window.execFmt('underline');
  await wait(120);
  check('⑨ 밑줄만 다시 눌러 지우면 취소선은 그대로 남는다',
    !(effStyle(window, content9, '갈색').textDecoration || '').includes('underline')
    && (effStyle(window, content9, '갈색').textDecoration || '').includes('line-through'));
  selectSub(window, content9, '갈색');
  window.execFmt('underline'); await wait(80);
  window.execFmt('strike');
  await wait(120);
  check('⑨ 반대로 취소선만 지우면 밑줄은 남는다',
    !(effStyle(window, content9, '갈색').textDecoration || '').includes('line-through')
    && (effStyle(window, content9, '갈색').textDecoration || '').includes('underline'));
  selectSub(window, content9, '갈색');
  window.execFmt('strike');   // 저장 시점엔 밑줄+취소선 공존 상태로 남긴다
  await wait(100);
  // ⑨-4 형광펜은 글자 서식 위/아래 어느 순서로 칠해도 안 지운다 (Word 조언)
  selectSub(window, content9, '갈색');
  window.applyHighlight('#fff59d'); await wait(150);
  check('⑨ 복합 서식 글자 위에 형광펜을 칠해도 글자 서식이 전부 남는다',
    (effStyle(window, content9, '갈색').backgroundColor || '').includes('255, 245, 157')
    && effStyle(window, content9, '갈색').fontWeight === '700'
    && effStyle(window, content9, '갈색').fontStyle === 'italic'
    && effStyle(window, content9, '갈색').fontSize === '30px'
    && (effStyle(window, content9, '갈색').fontFamily || '').includes('Gaegu')
    && effStyle(window, content9, '갈색').color === 'rgb(41, 128, 185)');
  selectSub(window, content9, '여우');
  window.applyHighlight('#ffd54f'); await wait(80);
  window.execFmt('bold'); await wait(80);
  window.applyTextColor('#8e44ad'); await wait(120);
  check('⑨ 형광펜을 먼저 칠한 뒤 색·굵게를 덧씌워도 배경이 안 지워진다',
    (effStyle(window, content9, '여우').backgroundColor || '').includes('255, 213, 79')
    && effStyle(window, content9, '여우').color === 'rgb(142, 68, 173)'
    && effStyle(window, content9, '여우').fontWeight === '700');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(300);
  {
    const h9b = (window.findEl(0, 't2').html) || '';
    check('⑨ 저장된 html 에 밑줄·취소선·형광펜·색이 함께 남는다',
      h9b.includes('line-through') && h9b.includes('underline')
      && h9b.includes('255, 245, 157') && h9b.includes('41, 128, 185'));
  }
  // ⑨-5 서식 지우기 (Word Ctrl+SpaceBar 'Clear Formatting'과 같은 동작)
  content9.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(150);
  selectSub(window, content9, '갈색');
  window.clearFmt();
  await wait(200);
  check('⑨ 서식 지우기를 하면 그 구간의 모든 글자 서식이 사라진다',
    !(effStyle(window, content9, '갈색').fontWeight || '').includes('700')
    && !(effStyle(window, content9, '갈색').fontStyle || '').includes('italic')
    && !(effStyle(window, content9, '갈색').fontFamily || '').includes('Gaegu')
    && !effStyle(window, content9, '갈색').color
    && !effStyle(window, content9, '갈색').backgroundColor);
  check('⑨ 서식 지우기 후에도 글자 내용은 그대로 남는다',
    (content9.textContent || '').includes('갈색'));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(300);
  // ⑨-6 캐럿에 서식을 겹쳐 정한 뒤 이어 쓰면 새 글자에 전부 이어진다 (Word run)
  content9.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(150);
  caretEnd(window, content9);
  window.applyFont('jua'); await wait(60);
  window.setFS(22); await wait(60);
  window.applyTextColor('#16a085'); await wait(60);
  window.execFmt('bold'); await wait(60);
  window.execFmt('italic'); await wait(60);
  typeAt(window, content9, ' 끝맺음');
  await wait(150);
  check('⑨ 캐럿에 모아둔 서식(글꼴·크기·색·굵게·기울임)이 새 글자에 모두 묻는다',
    (effStyle(window, content9, '끝맺').fontFamily || '').includes('Jua')
    && effStyle(window, content9, '끝맺').fontSize === '22px'
    && effStyle(window, content9, '끝맺').color === 'rgb(22, 160, 133)'
    && effStyle(window, content9, '끝맺').fontWeight === '700'
    && effStyle(window, content9, '끝맺').fontStyle === 'italic');
  check('⑨ 새로 적은 글자에만 서식이 묻고 앞 문장은 그대로다',
    !(effStyle(window, content9, '여우').fontFamily || '').includes('Jua'));

  // ══ ⑩ 고정 위치(논문) 원문 글자를 직접 편집 + 그 주변/뒤에 글 추가 ══
  //   새로 둔 t3 상자(건드린 적 없음)로 검증: 원문 단어 '중간에 끼워 넣기',
  //   '선택해 덮어쓰기', 단어 '끝(뒤)에 이어 쓰기', 줄 '앞(첫 글자 앞)에 붙이기',
  //   그리고 서식 지정 채로 이어 쓰기 — 어느 경우든
  //    · 줄(원문 라인) 개수·세로 위치가 절대 변하지 않고,
  //    · 옆/다른 줄 원문 단어 텍스트는 그대로이며,
  //    · 고정 단어 자리에 붙은 새 글은 그 단어의 크기(20px)를 그대로 따른다.
  const tbA = document.querySelector('#pagesStage .tb[data-id="t3"]');
  const tcA = tbA.querySelector('.tb-content');
  const rowListA = () => [...tcA.querySelectorAll(':scope>.sdy-tl')];
  const topsA = () => rowListA().map(r => parseFloat(r.style.top));
  const setCaret = (node, off) => {
    const r = window.document.createRange();
    r.setStart(node, off); r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    window.saveSel();
  };
  tcA.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(180);
  check('⑩ 손대지 않은 고정 위치 상자가 편집 모드로 들어간다',
    tbA.classList.contains('edit') && rowListA().length === 2);
  const topsBaseA = topsA();
  // ⑩-1 원문 단어 중간에 끼워 넣기 (south → soXYuth)
  {
    const tn = textNodeOf(window, tcA, 'south');
    assert.ok(tn, '⑩ 원문 단어(south)를 찾지 못했다');
    setCaret(tn, 2);
    typeAt(window, tcA, 'XY');
    await wait(120);
    check('⑩ 원문 단어 중간에 글자를 끼워 넣으면 그 자리에 합쳐진다',
      (rowListA()[0].textContent || '').includes('soXYuth'));
    check('⑩ 단어를 고쳐도 옆 원문 단어(north·east)는 그대로다',
      (rowListA()[0].textContent || '').includes('north')
      && (rowListA()[0].textContent || '').includes('east'));
    check('⑩ 원문 단어 안에 붙은 새 글자는 그 단어의 크기(20px)를 따른다',
      (effStyle(window, tcA, 'XY').fontSize || '') === '20px');
    check('⑩ 중간에 끼워 넣어도 줄 수·세로 위치가 안 변한다',
      rowListA().length === 2 && JSON.stringify(topsA()) === JSON.stringify(topsBaseA));
  }
  // ⑩-2 원문 단어 앞부분을 선택해 덮어쓰기 (north → Nrth)
  {
    selectSub(window, tcA, 'north', 0, 2);
    typeAt(window, tcA, 'N');
    await wait(120);
    check('⑩ 원문 단어 일부를 지우고 덮어쓰면 그 단어만 바뀐다',
      !(rowListA()[0].textContent || '').includes('north')
      && (rowListA()[0].textContent || '').includes('Nrth'));
    check('⑩ 덮어쓴 글자도 원문 단어 크기(20px)를 따른다',
      (effStyle(window, tcA, 'N').fontSize || '') === '20px');
    check('⑩ 덮어써도 줄 위치·옆 단어가 안 변한다',
      rowListA().length === 2 && JSON.stringify(topsA()) === JSON.stringify(topsBaseA)
      && (rowListA()[0].textContent || '').includes('east'));
  }
  // ⑩-3 원문 단어 '뒤(끝)'에 바로 이어 쓰기 (Nrth → NrthQ)
  {
    const tn = textNodeOf(window, tcA, 'rth');   // 덮어쓰기 후 남은 조각
    assert.ok(tn, '⑩ 덮어쓴 단어 조각(rth)을 찾지 못했다');
    setCaret(tn, (tn.nodeValue || '').length);
    typeAt(window, tcA, 'Q');
    await wait(120);
    check('⑩ 원문 단어 끝에 바로 이어 쓰면 같은 단어로 이어진다',
      (rowListA()[0].textContent || '').includes('NrthQ'));
    check('⑩ 뒤에 붙인 글자도 원문 단어 크기(20px)를 따른다',
      (effStyle(window, tcA, 'Q').fontSize || '') === '20px');
    check('⑩ 이어 써도 줄 위치가 안 변한다',
      rowListA().length === 2 && JSON.stringify(topsA()) === JSON.stringify(topsBaseA));
  }
  // ⑩-4 줄 맨 앞(첫 원문 단어 앞)에 붙이기 (west → Kwest)
  {
    const tn = textNodeOf(window, tcA, 'west');
    assert.ok(tn, '⑩ 둘째 줄 첫 단어(west)를 찾지 못했다');
    setCaret(tn, 0);
    typeAt(window, tcA, 'K');
    await wait(120);
    check('⑩ 줄 맨 앞에 붙여도 그 줄 안에 머문다',
      (rowListA()[1].textContent || '').includes('Kwest'));
    check('⑩ 옆 원문 단어(code·data)와 윗줄(south…)은 그대로다',
      (rowListA()[1].textContent || '').includes('code')
      && (rowListA()[1].textContent || '').includes('data')
      && (rowListA()[0].textContent || '').includes('soXYuth'));
    check('⑩ 줄 맨 앞에 붙여도 줄 수·세로 위치가 안 변한다',
      rowListA().length === 2 && JSON.stringify(topsA()) === JSON.stringify(topsBaseA));
  }
  // ⑩-5 고정 단어 뒤에 서식 지정 채로 이어 쓰기 (Jua)
  {
    const tn = textNodeOf(window, tcA, 'Q');
    setCaret(tn, (tn.nodeValue || '').length);
    window.applyFont('jua');
    await wait(100);
    typeAt(window, tcA, 'R');
    await wait(150);
    check('⑩ 고정 단어 뒤에 서식(Jua)을 정하고 이어 쓰면 새 글자에만 적용된다',
      (effStyle(window, tcA, 'R').fontFamily || '').includes('Jua'));
    check('⑩ 이어 쓴 새 글자(R)의 크기도 원문 단어 크기(20px)를 따른다',
      (effStyle(window, tcA, 'R').fontSize || '') === '20px');
    check('⑩ 원문 단어들(east·code 등)에는 Jua가 묻지 않는다',
      !(effStyle(window, tcA, 'east').fontFamily || '').includes('Jua')
      && !(effStyle(window, tcA, 'code').fontFamily || '').includes('Jua'));
    check('⑩ 서식 지정 이어쓰기 후에도 줄 위치가 안 변한다',
      rowListA().length === 2 && JSON.stringify(topsA()) === JSON.stringify(topsBaseA));
  }
  // ⑩-6 커밋(Escape) → 저장 html · 다시 편집 진입 보존
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(300);
  {
    const hA = (window.findEl(0, 't3').html) || '';
    check('⑩ 저장된 html 에 중간 삽입·덮어쓰기·이어쓰기 결과가 모두 남는다(줄 흐름 잔류 없음)',
      hA.includes('soXYuth') && hA.includes('NrthQ')
      && hA.includes('Kwest') && hA.includes('R')
      && !hA.includes('sdy-tl') && !hA.includes('sdy-tg'));
    check('⑩ 저장된 html 에 안 건드린 원문 단어가 그대로 남는다',
      hA.includes('east') && hA.includes('code'));
    check('⑩ 안 건드린 원문 단어(east·code·data) 좌표가 그대로다',
      hasGeom(hA, 'east', 104, 0, 36, 16) && hasGeom(hA, 'code', 52, 24, 38, 40)
      && hasGeom(hA, 'data', 96, 24, 36, 40));
    // NrthQR 은 부분 서식으로 중첩 분리돼 통짜로 못 찾으므로 분리 전 조각으로 조회
    check('⑩ 고친 단어는 제자리(soXYuth 0·NrthQR 52·Kwest 0)에 들어간다',
      spanLeft(hA, 'soXYuth') === 0 && outerSpanLeft(hA, 'NrthQ') === 52
      && spanLeft(hA, 'Kwest') === 0);
  }
  const tbA2 = document.querySelector('#pagesStage .tb[data-id="t3"]');
  const tcA2 = tbA2.querySelector('.tb-content');
  tcA2.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(180);
  check('⑩ 편집을 끝냈다 다시 들어가도 고친 원문이 그대로 보인다',
    tbA2.classList.contains('edit')
    && (tcA2.textContent || '').includes('soXYuth')
    && (tcA2.textContent || '').includes('Kwest')
    && [...tcA2.querySelectorAll(':scope>.sdy-tl')].length === 2);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(250);

  // ══ ⑪ 고정 위치 원문 '중간 줄'에서 Enter → 새 문단 끼우기 ══
  //   마지막 줄 뒤 Enter(②⑦)와 달리, 중간 줄을 나누면 새 줄이 절대 위치라
  //   그대로 두면 다음 원문 줄과 겹친다. 검증: ① 새 줄이 '다음 원문 줄 자리'에
  //   놓이되 뒤따르는 원문 줄들은 한 줄씩 아래로 내려가 겹치지 않고, ② 읽는
  //   순서가 그대로이며(원문 줄·글자는 안 움직임), ③ 그 자리에 이어 쓸 수 있고
  //   (크기 20px), ④ 저장 후 다시 열어도 내려간 줄 위치가 유지된다.
  const tbB = document.querySelector('#pagesStage .tb[data-id="t4"]');
  const tcB = tbB.querySelector('.tb-content');
  const rowsB = () => [...tcB.querySelectorAll(':scope>.sdy-tl')];
  const topsB = () => rowsB().map(r => parseFloat(r.style.top));
  const putCaret = (node, off) => {
    const r = window.document.createRange();
    r.setStart(node, off); r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    window.saveSel();
  };
  const pressEnterB = async () => {
    tcB.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true,
    }));
    await wait(130);
  };
  tcB.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(180);
  check('⑪ 새 고정 위치 상자(t4)가 두 줄로 편집 모드에 들어간다',
    tbB.classList.contains('edit') && rowsB().length === 2);
  const topsBaseB = topsB();   // [0, 24]
  // ⑪-1 첫째 줄 'lorem' 끝(둘째 단어 앞)에서 Enter → 새 줄에 'ipsum' 이동
  {
    const tn = textNodeOf(window, tcB, 'lorem');
    assert.ok(tn, '⑪ 원문 단어(lorem)를 찾지 못했다');
    putCaret(tn, (tn.nodeValue || '').length);
    await pressEnterB();
    check('⑪ 중간 줄에서 Enter 하면 줄이 하나 늘어난다(2→3)', rowsB().length === 3);
    const t = topsB();
    check('⑪ 새 줄은 다음 원문 줄 자리(24)에 놓이고, 다음 원문 줄은 48로 내려간다',
      JSON.stringify(t) === JSON.stringify([0, 24, 48]));
    check('⑪ 줄 top 이 모두 달라 겹치는 줄이 없다', new Set(t).size === 3);
    check('⑪ 나뉜 뒤 읽는 순서가 그대로다(첫 줄 lorem / 새 줄 ipsum / 원문 둘째 줄 dolor sit)',
      (rowsB()[0].textContent || '').includes('lorem')
      && !(rowsB()[0].textContent || '').includes('ipsum')
      && (rowsB()[1].textContent || '').includes('ipsum')
      && (rowsB()[2].textContent || '').includes('dolor')
      && (rowsB()[2].textContent || '').includes('sit'));
    check('⑪ 위로는 아무 줄도 움직이지 않았다(첫 줄 top 0)',
      Math.abs(topsB()[0] - topsBaseB[0]) < 0.01);
  }
  // ⑪-2 새 줄 맨 앞에 이어 쓰기 → 새 글자는 20px, 줄 위치 불변
  {
    typeAt(window, tcB, 'X');
    await wait(130);
    check('⑪ 새 줄 맨 앞에 이어 쓰면 같은 줄(ipsum 앞)에 들어간다',
      (rowsB()[1].textContent || '').includes('X')
      && (rowsB()[1].textContent || '').includes('ipsum')
      && (rowsB()[2].textContent || '').includes('dolor sit'));
    check('⑪ 새로 적은 글자가 원문 단어 크기(20px)를 따른다',
      (effStyle(window, tcB, 'X').fontSize || '') === '20px');
    check('⑪ 이어 써도 내려간 줄 위치가 그대로다',
      JSON.stringify(topsB()) === JSON.stringify([0, 24, 48]));
  }
  // ⑪-3 첫 줄 맨 끝(빈 꼬리)에서 또 Enter → 빈 문단이 끼고 뒤따르는 줄은 또 내려간다
  {
    const tn = textNodeOf(window, tcB, 'lorem');
    putCaret(tn, (tn.nodeValue || '').length);
    await pressEnterB();
    check('⑪ 줄 끝에서 Enter 하면 빈 문단이 끼워진다(3→4)', rowsB().length === 4);
    check('⑪ 빈 문단 아래 줄들이 한 줄씩 더 내려가 겹치지 않는다',
      JSON.stringify(topsB()) === JSON.stringify([0, 24, 48, 72]));
    check('⑪ 끼워 넣어도 읽는 순서가 그대로다',
      (rowsB()[0].textContent || '').includes('lorem')
      && (rowsB()[1].textContent || '').replace(/[\u200b\u200c\u200d\ufeff]/g, '') === ''
      && (rowsB()[2].textContent || '').includes('X ipsum')
      && (rowsB()[3].textContent || '').includes('dolor sit'));
  }
  // ⑪-4 빈 문단에 글을 적으면 새 문단이 된다
  {
    rowsB()[1].innerHTML = '';   // 입력 대기 닻(ZWSP) 정리 후 새 문단 입력
    caretEnd(window, rowsB()[1]);
    typeAt(window, tcB, '중');
    await wait(130);
    check('⑪ 빈 문단에 적은 글자가 새 문단으로 남고 아래 줄도 그대로다',
      (rowsB()[1].textContent || '').includes('중')
      && (rowsB()[2].textContent || '').includes('X ipsum')
      && JSON.stringify(topsB()) === JSON.stringify([0, 24, 48, 72]));
  }
  // ⑪-5 커밋 후 저장 html — 내려간 줄 위치(top)와 순서가 그대로 저장된다
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(300);
  {
    const elB = window.findEl(0, 't4');
    const hB = (elB && elB.html) || '';
    // 14.45 · 줄 위치는 단어 절대 스팬의 top 으로 저장된다
    const tmpB = document.createElement('div'); tmpB.innerHTML = hB;
    const topsSaved = [...new Set([...tmpB.querySelectorAll(':scope>span[data-pdf-w]')]
      .map(s => parseFloat(s.style.top)))].sort((a, b) => a - b);
    check('⑪ 저장된 html 에 내려간 줄 위치(top 0·24·48·72)가 남는다(단어 절대좌표)',
      !hB.includes('sdy-tl') && !hB.includes('sdy-tg')
      && JSON.stringify(topsSaved) === JSON.stringify([0, 24, 48, 72]));
    check('⑪ 저장된 html 에 새 문단·이동한 단어가 모두 남는다',
      hB.includes('중') && hB.includes('ipsum') && hB.includes('X')
      && hB.includes('dolor') && hB.includes('sit'));
  }
  // ⑪-6 다시 열어도 내려간 줄 위치와 순서가 그대로다
  {
    const tbB2 = document.querySelector('#pagesStage .tb[data-id="t4"]');
    const tcB2 = tbB2.querySelector('.tb-content');
    tcB2.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    await wait(180);
    const t2 = [...tcB2.querySelectorAll(':scope>.sdy-tl')].map(r => parseFloat(r.style.top));
    check('⑪ 다시 편집을 열어도 줄 4개·위치 0·24·48·72가 그대로다',
      t2.length === 4 && JSON.stringify(t2) === JSON.stringify([0, 24, 48, 72]));
    check('⑪ 다시 열어도 읽는 순서가 그대로다',
      (tcB2.textContent || '').includes('lorem')
      && (tcB2.textContent || '').includes('중')
      && (tcB2.textContent || '').includes('X ipsum')
      && (tcB2.textContent || '').includes('dolor sit'));
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(250);
  }

  // ══ ⑫ 고정 위치 원문 '한 줄'에 크기·기준선이 다른 글자가 섞여도 '한 줄'로 ══
  //   PDF 한 줄에는 제목 크기 글자·본문·위/아래 첨자가 섞인다. 예전엔 'top 이 2px
  //   안'으로만 줄을 묶어 그런 글자들이 딴 줄로 튀었고, 각 줄(.sdy-tl)은 left:0
  //   에서 펼쳐지므로 원래 그 자리에 있던 원문 글자와 겹쳐 보였다(보고).
  const tbM = document.querySelector('#pagesStage .tb[data-id="t5"]');
  const tcM = tbM.querySelector('.tb-content');
  const rowsM = () => [...tcM.querySelectorAll(':scope>.sdy-tl')];
  const topsM = () => rowsM().map(r => parseFloat(r.style.top));
  const flat = node => String(node.textContent || '').replace(/\s+/g, ' ').trim();
  tcM.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(180);
  check('⑫ 크기·첨자가 섞인 고정 위치 상자가 편집 모드로 들어간다', tbM.classList.contains('edit'));
  check('⑫ 크기·기준선이 달라도 원문 두 줄이 그대로 두 줄로 묶인다', rowsM().length === 2);
  check('⑫ 첫 줄 글자가 왼쪽에 붙지 않고 읽는 순서대로 한 줄에 놓인다',
    flat(rowsM()[0]) === 'Results of the H 2 O study'
    && rowsM()[0].querySelectorAll(':scope>span:not(.sdy-tg):not(.sdy-ts)').length === 7);
  check('⑫ 둘째 줄도 그대로다', flat(rowsM()[1]) === 'We measured');
  check('⑫ 줄의 세로 위치가 원문 그대로다(3.2 / 31.2)',
    Math.abs(topsM()[0] - 3.2) < 0.01 && Math.abs(topsM()[1] - 31.2) < 0.01);
  check('⑫ 겹치는 줄이 없다(서로 다른 top)', new Set(topsM()).size === rowsM().length);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(250);

  // ══ ⑬ Enter 로 만든 줄을 Backspace 한 번에 지운다 ══
  //   새 줄 머리에는 서식 이어받기용 .sdy-type 닻(ZWSP)이 놓인다(14.41). 그 닻을
  //   백스페이스가 '글자 하나'로 먼저 먹으면 화면은 그대로인데 줄은 그대로 남고,
  //   input 핸들러가 닻을 다시 심어 줄바꿈이 영영 안 지워졌다(보고).
  const tbK = document.querySelector('#pagesStage .tb[data-id="t6"]');
  const tcK = tbK.querySelector('.tb-content');
  const rowsK = () => [...tcK.querySelectorAll(':scope>.sdy-tl')];
  const topsK = () => rowsK().map(r => parseFloat(r.style.top));
  // 브라우저 기본 Backspace 흉내 (jsdom 은 편집 명령이 없다)
  //   · 캐럿 앞 글자 하나를 지운다
  //   · 블록(tight 줄 .sdy-tl / 글상자 직계 div) 맨 앞이면 이전 블록과 합친다
  const pressBackspace = async (content) => {
    const ev = new window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    content.dispatchEvent(ev);
    if (!ev.defaultPrevented) {          // 앱이 직접 합쳤으면 브라우저 기본 동작은 없다
      const sel = window.getSelection();
      const r = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      if (r && r.collapsed && r.startContainer.nodeType === 3 && r.startOffset > 0) {
        // 주의: jsdom 의 live selection 은 글자를 줄이면 오프셋을 되돌려 놓는다 → 먼저 떠 둔다
        const n = r.startContainer, v = n.nodeValue || '', off = r.startOffset;
        n.nodeValue = v.slice(0, off - 1) + v.slice(off);
        const nr = window.document.createRange();
        nr.setStart(n, off - 1); nr.collapse(true);
        sel.removeAllRanges(); sel.addRange(nr);
      } else if (r && r.collapsed && r.startContainer.nodeType === 1 && r.startOffset === 0
        && r.startContainer.parentNode === content) {
        const blk = r.startContainer, prev = blk.previousElementSibling;
        if (prev) {
          const mark = prev.lastChild;
          while (blk.firstChild) prev.appendChild(blk.firstChild);
          blk.remove();
          const nr = window.document.createRange();
          if (mark && mark.parentNode === prev) nr.setStartAfter(mark); else nr.setStart(prev, 0);
          nr.collapse(true);
          sel.removeAllRanges(); sel.addRange(nr);
        }
      }
      content.dispatchEvent(new window.InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    }
    await wait(130);
  };
  tcK.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(180);
  check('⑬ 고정 위치 상자(t6)가 두 줄로 편집 모드에 들어간다',
    tbK.classList.contains('edit') && rowsK().length === 2);
  const topsBaseK = topsK();      // [0, 24]
  // ⑬-1 첫째 줄 'alpha' 끝에서 Enter → 새 줄 + 아래 원문 줄은 한 줄 내려간다
  {
    const tn = textNodeOf(window, tcK, 'alpha');
    assert.ok(tn, '⑬ 원문 단어(alpha)를 찾지 못했다');
    putCaret(tn, (tn.nodeValue || '').length);
    tcK.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(130);
    check('⑬ Enter 로 새 줄이 생기고 아래 원문 줄이 내려간다(2→3)',
      rowsK().length === 3 && JSON.stringify(topsK()) === JSON.stringify([0, 24, 48]));
    check('⑬ 엔터로 만든 새 줄도 nowrap 단일 줄이다(줄 안에서 접히지 않는다)',
      rowsK()[1].style.whiteSpace === 'nowrap');
    const mk = rowsK()[1].querySelector('.sdy-type');
    check('⑬ 새 줄 머리에 서식 이어받기 닻(ZWSP)이 놓인다',
      !!mk && (mk.textContent || '').includes('\u200B'));
  }
  // ⑬-2 Backspace 한 번 → 줄바꿈이 지워지고 내려갔던 원문 줄도 제자리로
  await pressBackspace(tcK);
  check('⑬ Backspace 한 번에 엔터 줄바꿈이 지워진다(3→2)', rowsK().length === 2);
  check('⑬ 내려갔던 원문 줄도 제자리로 올라온다(빈 칸이 안 남는다)',
    JSON.stringify(topsK()) === JSON.stringify(topsBaseK));
  check('⑬ 지운 뒤 읽는 순서·글자가 그대로다',
    flat(rowsK()[0]) === 'alpha beta' && flat(rowsK()[1]) === 'gamma delta');
  check('⑬ 지운 자리에 입력 닻(ZWSP)·빈 서식 span 이 남지 않는다',
    !tcK.innerHTML.includes('\u200B') && !tcK.querySelector('.sdy-type'));
  // ⑬-3 (회귀) 글자 가운데 백스페이스는 여전히 '한 글자'만 지운다
  {
    const tn = textNodeOf(window, tcK, 'beta');
    assert.ok(tn, '⑬ 원문 단어(beta)를 찾지 못했다');
    putCaret(tn, (tn.nodeValue || '').length);
    await pressBackspace(tcK);
    check('⑬ 글자 가운데 백스페이스는 한 글자만 지운다',
      rowsK().length === 2 && (rowsK()[0].textContent || '').includes('bet')
      && !(rowsK()[0].textContent || '').includes('beta'));
  }
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(300);
  {
    const hK = (window.findEl(0, 't6').html) || '';
    check('⑬ 저장된 html 에 빈 줄·닻·줄 흐름이 남지 않고 두 줄 단어만 남는다(단어 절대좌표)',
      !hK.includes('sdy-tl') && !hK.includes('sdy-tg') && !hK.includes('\u200B')
      && hK.includes('bet') && !hK.includes('beta') && hK.includes('gamma')
      && (hK.match(/data-pdf-w/g) || []).length === 4);
    check('⑬ 안 건드린 단어(alpha·gamma·delta) 좌표가 그대로다',
      hasGeom(hK, 'alpha', 0, 0, 46, 16) && hasGeom(hK, 'gamma', 0, 24, 44, 40)
      && hasGeom(hK, 'delta', 58, 24, 40, 40));
    check('⑬ 고친 단어(bet)는 beta 자리(left 60)에 들어간다', spanLeft(hK, 'bet') === 60);
  }
  // ⑬-4 일반 글상자 — 새 문단 머리의 닻 때문에 백스페이스가 먹지 않던 경우
  //   (엔터로 문단을 나누는 것은 브라우저 몫이라 jsdom 이 못 만든다 → 앱이 심는
  //    '닻 있는 빈 문단'을 직접 두고 캐럿을 그 뒤에 놓아 검증한다)
  {
    const tbN = document.querySelector('#pagesStage .tb[data-id="t2"]');
    const tcN = tbN.querySelector('.tb-content');
    tcN.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    await wait(150);
    check('⑬ 일반 글상자가 편집 모드에 들어간다', tbN.classList.contains('edit'));
    tcN.innerHTML = '<div>첫째</div><div><span class="sdy-type" style="font-family:Jua">\u200B</span></div>';
    const anchor = tcN.querySelectorAll(':scope>div')[1].querySelector('.sdy-type');
    const rN = window.document.createRange();
    rN.setStart(anchor.firstChild, 1); rN.collapse(true);
    const sN = window.getSelection(); sN.removeAllRanges(); sN.addRange(rN);
    window.saveSel();
    const evN = new window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    tcN.dispatchEvent(evN);
    check('⑬ 일반 상자 백스페이스를 앱이 가로채지 않는다(브라우저 기본 동작 유지)',
      !evN.defaultPrevented);
    check('⑬ 백스페이스가 닻(ZWSP)을 먼저 걷어 문단 합치기가 일어난다',
      !tcN.innerHTML.includes('\u200B'));
    await pressBackspace(tcN);
    check('⑬ 일반 상자도 백스페이스 한 번에 문단이 합쳐진다',
      tcN.querySelectorAll(':scope>div').length === 1
      && tcN.querySelectorAll(':scope>div')[0].textContent.includes('첫째'));
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(250);
  }

  // ══ ⑭ '마지막 단어가 다음 줄로 넘어가 겹침' — 줄 흐름 행은 nowrap 이다 ══
  //   14.44 · 보고: "논문 고정글자를 편집하려 들어가면 위치는 그대로인데 단어 간격이
  //   미세하게 변하고, 상자 폭을 살짝 넘는 판정이 나 마지막 단어가 다음 줄로 넘어가
  //   아래 줄 글자와 겹친다." 원인 — 편집 진입 줄 흐름(.sdy-tl)을 white-space:normal
  //   로 만들어, 실공백·스페이서 실측 오차로 줄 폭이 상자 폭을 아주 조금(1px 미만)
  //   넘으면 브라우저가 줄 끝 공백에서 마지막 단어를 둘째 줄로 접었다.
  //   → 새로 만드는 줄 흐름·엔터로 나누는 줄 모두 nowrap(절대 한 줄)이고,
  //     이전 버전(white-space:normal)으로 저장된 줄 흐름은 다시 그릴 때만
  //     nowrap 으로 바로잡는다(표시 전용 — 저장 모델은 실제 수정 전까지 그대로).
  //   14.45 · 실제 수정을 커밋하면 줄 흐름이 아니라 단어별 절대좌표로 확정된다
  //     (스태시 없는 best-effort 역변환 — 마이그레이션은 범위 아님).
  const tbL = document.querySelector('#pagesStage .tb[data-id="t7"]');
  const tcL = tbL.querySelector('.tb-content');
  const rowsL = () => [...tcL.querySelectorAll(':scope>.sdy-tl')];
  const allNowrapL = () => rowsL().length > 0
    && rowsL().every(r => r.style.whiteSpace === 'nowrap');
  check('⑭ 구버전 줄 흐름(white-space:normal) 저장본도 다시 그릴 때 nowrap 으로 고쳐진다',
    rowsL().length === 2 && allNowrapL());
  check('⑭ 그릴 때 바로잡기는 표시 전용 — 실제로 고치기 전 저장 모델(html)은 그대로다',
    ((window.findEl(0, 't7') || {}).html || '').includes('white-space:normal'));
  tcL.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await wait(160);
  check('⑭ 구버전 줄 흐름 상자가 편집 모드로 들어가도 줄이 여전히 nowrap 이다',
    tbL.classList.contains('edit') && allNowrapL());
  {
    const tnL = textNodeOf(window, tcL, 'alpha');
    assert.ok(tnL, '⑭ 원문 단어(alpha)를 찾지 못했다');
    putCaret(tnL, (tnL.nodeValue || '').length);
    typeAt(window, tcL, '!');
    await wait(140);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(300);
    const hL = (window.findEl(0, 't7') || {}).html || '';
    check('⑭ 수정을 커밋하면 저장 html 이 단어 절대좌표로 확정된다(줄 흐름 잔류 없음)',
      !hL.includes('sdy-tl') && !hL.includes('sdy-tg')
      && (hL.match(/data-pdf-w/g) || []).length === 4 && hL.includes('beta!'));
  }

  const fatal = errors.filter(e => !/isTrBusy|undefined is not an object/.test(String(e)));
  check('치명적 런타임 오류가 없다', fatal.length === 0);
  if (fatal.length) console.log(fatal.slice(0, 5).join('\n---\n'));
  console.log(`\n텍스트 엔진(논문 tight + 일반 상자 — 폰트·엔터·형광펜·탭·자간): PASS ${pass} / FAIL 0`);
} catch (e) {
  console.error('\n논문(tight) 텍스트 엔진 런타임 실패:', e && (e.stack || e.message || String(e)), e && e.name);
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
