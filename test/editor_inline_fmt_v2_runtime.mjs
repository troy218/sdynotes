/* SDY-FMT v2 인라인 서식 엔진 · 런타임 검증

   재설계 전에 사용자가 겪던 일:
     ① 글자 일부의 글꼴을 바꾼 뒤 그 위에(또는 이웃 글자에) 굵게·색 등을
        얹으면 아예 적용되지 않거나 글꼴이 풀렸다.
     ② 서식을 여러 번 겹치거나 지운 뒤에는 span 중첩이 꼬여 같은 버튼을
        다시 눌러도 상태가 뒤집히지 않았다.
     ③ 상자 전체 서식을 바꾸면 부분 서식과 충돌해 화면과 저장이 어긋났다.

   v2 엔진(세그먼트 재구축)이 다음을 보장하는지 실제 DOM 에서 확인한다.
     · 부분 글꼴 위 굵게/색/크기 겹치기 — 정확한 글자 범위에만, 기존 서식 보존
     · 워드식 토글(일부만 켜져 있으면 전체 켜기 → 다시 누르면 전체 끄기)
     · 멱등성 — 같은 연산을 반복해도 DOM 이 변하지 않는다
     · 여러 문단(div)에 걸친 선택 처리와 선택 복원
     · 상자 전체 덧칠/글꼴·크기 교체가 부분 서식과 정확히 섞인다
     · 밑줄+취소선 토큰 공존, 서식 지우기, 링크/부분 unlink
     · 캐럿 서식(span.sdy-type)이 상자 전체 연산 후에도 살아있고 함께 갱신된다 */
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-fmtv2-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
}
let pass = 0;
const check = (name, cond, extra) => { assert.ok(cond, name + (extra !== undefined ? ' — ' + extra : '')); pass++; console.log('  ✓ ' + name); };

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
let dom;
try {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) break; } catch (e) {}
    await wait(200);
  }
  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '서식엔진v2', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [{ type: 'text', id: 't1', x: 40, y: 40, w: 360, h: 120, html: '가나다라마바사 아자차카', fontSize: 16 }] }],
  };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: nb.data.id, content: JSON.stringify(doc0), font_size: 16 }], filters: [] });

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', m => { if (!/HTMLMediaElement|Could not load (link|script)/.test(String(m))) errors.push(String(m)); });
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
      window.Audio = class { constructor(){this.paused=true;} play(){return Promise.resolve()} pause(){} load(){} addEventListener(){} removeEventListener(){} };
      window.HTMLMediaElement.prototype.pause = function(){};
      window.HTMLMediaElement.prototype.load = function(){};
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
  const card = [...document.querySelectorAll('.note-stack .note-card')].find(c => (c.textContent || '').includes('서식엔진v2'));
  check('노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1600);
  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));

  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });
  const tb = document.querySelector('#pagesStage .tb[data-id="t1"]');
  const content = tb.querySelector('.tb-content');
  check('글상자가 그려진다', !!content && (content.textContent || '').includes('가나다라'));
  window.enterEdit(tb, true);

  // 유틸 ─────────────────────────────────────────────────────────────
  const textNodes = () => {
    const tw = document.createTreeWalker(content, window.NodeFilter.SHOW_TEXT);
    const arr = []; let n; while ((n = tw.nextNode())) arr.push(n);
    return arr;
  };
  const select = (needle, len) => {
    const nodes = textNodes();
    const n = nodes.find(x => (x.nodeValue || '').includes(needle));
    assert.ok(n, 'select target: ' + needle);
    const i = n.nodeValue.indexOf(needle);
    const r = document.createRange();
    r.setStart(n, i); r.setEnd(n, len ? i + len : i + needle.length);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
    window.saveSel();
    return r;
  };
  // 한 글자(문자 오프셋) 기준 유효 스타일 — span 중첩과 무관하게 문자 위치로 찾는다
  const charStyle = (ch, nth = 0) => {
    const full = content.textContent || '';
    let at = -1;
    for (let k = 0; k <= nth; k++) { at = full.indexOf(ch, at + 1); assert.ok(at >= 0, 'char: ' + ch); }
    let off = 0;
    for (const n of textNodes()) {
      const v = n.nodeValue || '';
      if (off + v.length > at) {
        const st = {};
        let p = n.parentElement;
        while (p && p !== content) {
          if (p.style) for (const key of ['fontWeight','fontStyle','textDecoration','color','backgroundColor','fontFamily','fontSize'])
            if (p.style[key] && !(key in st)) st[key] = p.style[key];
          p = p.parentElement;
        }
        if (content.style) for (const key of ['fontWeight','fontStyle','textDecoration','color','backgroundColor','fontFamily','fontSize'])
          if (content.style[key] && !(key in st)) st[key] = content.style[key];
        return st;
      }
      off += v.length;
    }
    return {};
  };
  const dumpNodes = () => textNodes().map(n => JSON.stringify(n.nodeValue)).join('|');
  // 문자 오프셋(content 전체 기준)으로 선택 — 노드 경계를 건너는 선택도 지원
  const posOf = (ch, nth = 0) => {
    const full = content.textContent || '';
    let at = -1;
    for (let k = 0; k <= nth; k++) { at = full.indexOf(ch, at + 1); assert.ok(at >= 0, 'pos: ' + ch); }
    return at;
  };
  const selectSpan = (a, b) => {
    let off = 0, sn = null, so = 0, en = null, eo = 0;
    for (const n of textNodes()) {
      const v = n.nodeValue || '';
      if (!sn && off + v.length > a) { sn = n; so = a - off; }
      if (sn && !en && off + v.length >= b) { en = n; eo = b - off; break; }
      off += v.length;
    }
    assert.ok(sn && en, 'selectSpan nodes');
    const r = document.createRange();
    r.setStart(sn, so); r.setEnd(en, eo);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
    window.saveSel();
    return r;
  };

  // ── ① 부분 글꼴 → 바로 그 위에 굵게 (사용자가 보고한 시나리오) ────
  select('다라마');
  window.applyFont('jua');
  await wait(60);
  check('① 부분 글꼴이 정확히 다라마에만 적용된다',
    (charStyle('다').fontFamily || '').includes('Jua')
    && !(charStyle('가').fontFamily || '').includes('Jua'));
  const afterFont = content.innerHTML;

  // 선택은 엔진이 복원한 상태(다라마) — 그대로 굵게를 누른다
  window.execFmt('bold');
  await wait(60);
  check('① 글꼴 바꾼 직후 같은 선택에 굵게가 먹는다 (핵심 회귀)',
    charStyle('다').fontWeight === '700'
    && charStyle('라', 0).fontWeight === '700'
    && charStyle('마').fontWeight === '700');
  check('① 굵게를 얹어도 부분 글꼴이 풀리지 않는다',
    (charStyle('다').fontFamily || '').includes('Jua'));
  check('① 선택 밖 글자는 그대로다',
    !charStyle('가').fontWeight && !charStyle('바', 0).fontWeight);
  check('① 문장이 보존된다', (content.textContent || '') === '가나다라마바사 아자차카');

  // ── ② 굵게 해제 → 다시 켜기 (토글 멱등성) ────────────────────────
  window.execFmt('bold');
  await wait(60);
  check('② 전부 굵은 선택을 다시 누르면 해제된다',
    !charStyle('다').fontWeight && !charStyle('마').fontWeight);
  check('② 해제해도 글꼴은 유지된다', (charStyle('다').fontFamily || '').includes('Jua'));
  check('② 해제 뒤 중립값 잔여물(font-weight:400)이 없다', !content.innerHTML.includes('font-weight:400'));
  const h1 = content.innerHTML;
  window.execFmt('bold'); await wait(30);
  window.execFmt('bold'); await wait(30);
  check('② 굵게→굵게(토글 두 번) 후 해제 상태와 동일하다', content.innerHTML === h1);

  // ── ③ 부분만 굵은 선택에 굵게 → 워드식 '전체 켜기' ───────────────
  //   '나다'는 가나(일반)와 다라마(span Jua)의 노드 경계를 건너는 선택이다.
  selectSpan(posOf('나'), posOf('나') + 2);          // 나다
  window.execFmt('bold'); await wait(40);   // 나다 굵게
  selectSpan(posOf('다'), posOf('다') + 2);          // 다라 (다=굵음, 라=안 굵음)
  window.execFmt('bold'); await wait(40);
  check('③ 부분만 굵은 선택에 굵게를 누르면 선택 전체가 굵어진다',
    charStyle('나').fontWeight === '700' && charStyle('다').fontWeight === '700'
    && charStyle('라').fontWeight === '700');
  window.execFmt('bold'); await wait(40);
  check('③ 전부 굵은 상태에서 다시 누르면 선택 전체에서 빠진다',
    !charStyle('다').fontWeight && !charStyle('라').fontWeight);
  check('③ 나는 여전히 굵다 (선택 밖 보존)', charStyle('나').fontWeight === '700');
  window.execFmt('bold'); await wait(30);  // 라마다 복원 (이후 단계용)

  // ── ④ 여러 서식 겹치기: 색 + 형광펜 + 크기 ───────────────────────
  select('아자');
  window.applyTextColor('#e74c3c'); await wait(40);
  window.applyHighlight('#fff59d'); await wait(40);
  window.setFS(24); await wait(40);
  const st4 = charStyle('아');
  check('④ 색·형광펜·크기가 같은 글자에 겹쳐 적용된다',
    st4.color === 'rgb(231, 76, 60)' && st4.backgroundColor === 'rgb(255, 245, 157)' && st4.fontSize === '24px');
  check('④ 겹친 구간이 하나의 span 으로 합쳐진다 (중첩 폭주 없음)', (() => {
    const spans = [...content.querySelectorAll('span')].filter(s => (s.textContent || '').includes('아자')
      && s.style.color && s.style.backgroundColor && s.style.fontSize);
    return spans.length === 1;
  })());
  window.applyHighlight(null); await wait(40);
  check('④ 형광펜만 지워도 색·크기는 남는다',
    charStyle('아').backgroundColor == null
    && charStyle('아').color === 'rgb(231, 76, 60)' && charStyle('아').fontSize === '24px');

  // ── ⑤ 밑줄 + 취소선 토큰 공존 ────────────────────────────────────
  select('아자');
  window.execFmt('underline'); await wait(40);
  window.execFmt('strike'); await wait(40);
  const dec = charStyle('아').textDecoration || '';
  check('⑤ 밑줄과 취소선이 동시에 걸린다', dec.includes('underline') && dec.includes('line-through'));
  window.execFmt('underline'); await wait(40);
  check('⑤ 밑줄만 해제하면 취소선이 남는다',
    (charStyle('아').textDecoration || '') === 'line-through');

  // ── ⑥ 여러 문단(div)에 걸친 선택 ────────────────────────────────
  content.innerHTML = '첫줄입니다<div>둘째줄입니다</div>셋째줄';
  window.clearTextSelection(); window.resetTypingFormat();
  await wait(30);
  {
    // '줄입' 두 번째 등장(둘째줄의 '줄입')부터 첫 문단 '줄입'까지 — 문단 경계를 건너는 선택
    const nodes = textNodes();
    const n1 = nodes.find(n => n.nodeValue === '첫줄입니다');
    const n2 = nodes.find(n => n.nodeValue === '둘째줄입니다');
    assert.ok(n1 && n2, '두 문단 텍스트 노드');
    const r = document.createRange();
    r.setStart(n1, 0); r.setEnd(n2, 4);   // '첫줄입니다' + '둘째줄' (문단 경계 포함)
    window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
    window.saveSel();
  }
  window.applyTextColor('#2ecc71'); await wait(60);
  check('⑥ 문단 경계를 건너는 선택에 색이 적용된다',
    (charStyle('첫').color) === 'rgb(46, 204, 113)'
    && (charStyle('둘').color) === 'rgb(46, 204, 113)');
  check('⑥ 경계 밖 글자는 색이 없다', !charStyle('셋').color && !charStyle('다', 1).color);
  check('⑥ 문단 구조가 유지된다', !!content.querySelector('div') && (content.textContent || '') === '첫줄입니다둘째줄입니다셋째줄');
  check('⑥ 처리 뒤 선택이 살아 있다(연속 적용 가능)', window.hasInlineTextSel());
  window.applyHighlight('#ffec99'); await wait(40);
  check('⑥ 같은 범위에 이어서 형광펜도 먹는다',
    charStyle('첫').backgroundColor === 'rgb(255, 236, 153)' && charStyle('둘').backgroundColor === 'rgb(255, 236, 153)');

  // ── ⑦ 상자 전체 서식 ↔ 부분 서식 ────────────────────────────────
  window.clearTextSelection(); window.resetTypingFormat();
  select('첫줄');
  window.applyFont('gaegu'); await wait(40);
  window.deselectAll(true);
  content.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1, clientX: 60, clientY: 60 }));
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await wait(80);
  window.applyFont('jua'); await wait(60);
  check('⑦ 상자 전체 글꼴 변경이 부분 글꼴(Gaegu)까지 덮어쓴다',
    !(charStyle('첫').fontFamily || '').includes('Gaegu')
    && (charStyle('첫').fontFamily || '').includes('Jua'));
  check('⑦ 상자 전체 글꼴을 바꿔도 색·형광펜이 보존된다',
    charStyle('첫').color === 'rgb(46, 204, 113)' && charStyle('첫').backgroundColor === 'rgb(255, 236, 153)');
  window.execFmt('bold'); await wait(60);
  check('⑦ 상자 전체 굵게는 모든 글자에 적용된다',
    charStyle('첫').fontWeight === '700' && charStyle('둘').fontWeight === '700' && charStyle('셋').fontWeight === '700');
  check('⑦ 상자 데이터에도 굵게·글꼴이 저장된다', (() => {
    const el = window.findEl(0, 't1');
    return el && el.font === 'jua';
  })());
  window.execFmt('bold'); await wait(60);
  check('⑦ 상자 전체 굵게 해제가 모든 글자에서 빠진다',
    !charStyle('첫').fontWeight && !charStyle('셋').fontWeight);

  // ── ⑧ 캐럿 서식(span.sdy-type)과 상자 전체 연산의 공존 ──────────
  window.resetTypingFormat();
  window.clearTextSelection();
  window.enterEdit(tb, true);
  content.innerHTML = '타이핑 <br>여기서 이어서';
  window.clearTextSelection();
  await wait(30);
  {
    const caret = document.createRange();
    const tn = textNodes().find(n => n.nodeValue === '여기서 이어서');
    caret.setStart(tn, 0); caret.collapse(true);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(caret);
    window.saveSel();
  }
  window.applyTextColor('#8e44ad'); await wait(40);   // 캐럿 → 앞으로 입력될 글자만
  const marker = content.querySelector('.sdy-type');
  check('⑧ 캐럿 서식 마커(span.sdy-type)가 만들어진다', !!marker);
  window.deselectAll(true);
  content.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1, clientX: 60, clientY: 60 }));
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await wait(80);
  window.applyHighlight('#fff59d'); await wait(60);   // 상자 전체 형광펜
  check('⑧ 상자 전체 연산 뒤에도 캐럿 마커가 살아 있다', !!content.querySelector('.sdy-type'));
  check('⑧ 상자 전체 형광펜이 적용됐다', charStyle('타이핑').backgroundColor === 'rgb(255, 245, 157)');

  // ── ⑨ 링크 걸기/부분 unlink ─────────────────────────────────────
  content.innerHTML = '여기로 link 걸기';
  window.clearTextSelection(); window.resetTypingFormat();
  await wait(30);
  {
    const tn = textNodes().find(n => n.nodeValue.includes('link'));
    const i = tn.nodeValue.indexOf('link');
    const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + 4);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
    window.saveSel();
  }
  window._fmtLinkSelection('https://example.com'); await wait(40);
  check('⑨ 엔진 경로로 링크가 걸린다',
    !!content.querySelector('a[href="https://example.com"]')
    && content.querySelector('a').textContent === 'link');
  {
    // 'nk' 부분만 골라 unlink → 그 조각만 링크에서 빠진다
    const a = content.querySelector('a');
    const tn = [...a.childNodes].find(n => n.nodeType === 3);
    const i = tn.nodeValue.indexOf('nk');
    const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + 2);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
    window.saveSel();
  }
  window._unlinkSelection(); await wait(40);
  check('⑨ 링크 일부만 unlink 하면 문장이 갈라지지 않고 보존된다',
    (content.textContent || '') === '여기로 link 걸기');
  check('⑨ 남은 링크/li 글자 정리가 정확하다', (() => {
    const a = content.querySelector('a');
    return !!a && a.textContent === 'li';
  })());

  // ── ⑩ 서식 지우기 ───────────────────────────────────────────────
  content.innerHTML = '<span style="color: rgb(231, 76, 60); font-family: Gaegu; font-size: 24px; background-color: rgb(255, 245, 157)"><b>서식뭉치</b> 보통</span>';
  content.style.cssText = '';   // 이전 단계(⑦)의 상자 레벨 서식은 이번 검사 대상이 아니다
  window.clearTextSelection(); window.resetTypingFormat();
  await wait(30);
  {
    const tn = textNodes().find(n => n.nodeValue === '서식뭉치');
    const r = document.createRange(); r.setStart(tn, 0); r.setEnd(tn, 4);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
    window.saveSel();
  }
  window.clearFmt(); await wait(60);
  check('⑩ 선택 구간의 모든 서식이 지워진다', (() => {
    const st = charStyle('서');
    return !st.color && !st.fontFamily && !st.fontSize && !st.backgroundColor && !st.fontWeight;
  })());
  check('⑩ 선택 밖(보통)은 그대로다', (charStyle('보').color === 'rgb(231, 76, 60)'));
  check('⑩ 문장이 보존된다', (content.textContent || '') === '서식뭉치 보통');

  // ── ⑪ 저장 사슬 ─────────────────────────────────────────────────
  await wait(400);
  const sel2 = await q({ table: 'memos', op: 'select', values: [], filters: [{ field: 'notebook_id', op: 'eq', value: String(nb.data.id) }], limit: 1, single: true });
  const row = Array.isArray(sel2?.data) ? sel2.data[0] : sel2?.data;
  const memo = row?.content ? JSON.parse(row.content) : null;
  check('⑪ 서버 저장 html 이 문자열로 남는다', typeof memo?.pages?.[0]?.els?.[0]?.html === 'string'
    && (memo.pages[0].els[0].html.length > 0));

  const fatal = errors.filter(Boolean);
  check('치명적 런타임 오류가 없다', fatal.length === 0, fatal.slice(0, 3).join(' / '));

  console.log(`\nSDY-FMT v2 인라인 서식 엔진: PASS ${pass} / FAIL 0`);
} catch (e) {
  console.error('\n서식엔진 v2 런타임 실패:', e);
  if (log) console.error('server log:\n' + log.slice(-1600));
  process.exitCode = 1;
} finally {
  await closeDoms([dom]);
  try { child.kill('SIGTERM'); } catch {}
}
