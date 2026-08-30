/* 글자색/형광펜(선택 구간만 칠하기 + 글꼴 보존)과 표 '한 축 늘리기' 런타임 검증

   사용자가 겪던 일:
     ① 글꼴을 바꿔 쓴 뒤 글자색/형광펜을 칠하면 글꼴이 기본으로 풀렸다.
     ② 글자를 드래그해 선택해도 상자 전체가 칠해졌다 (선택 구간만 칠해지지 않음).
     ③ 표의 변 중앙 ＋ 버튼(행/열 추가)이 거슬린다 → 그 자리에서
        가로 또는 세로로만 늘릴 수 있게 바꿔 달라.

   여기서는 실제 DOM 에서
     ① 글자 선택 구간만 색/형광펜이 입혀지고 상자 글꼴(el.font·font-family)이
        그대로 남는지
     ② 선택 없이 상자만 고르면 상자 전체에만 칠해지는지
     ③ 형광펜 '색 없음'이 배경만 지우는지
     ④ 표에 ＋ 버튼이 없고 변 중앙 손잡이가 한 축(위·아래=세로, 왼·오른쪽=가로)으로만
        표를 늘리는지
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-fmt-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
}
let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };
// 서식을 '글자 단위'로 쪼개 적용하면 같은 문장이 여러 span 으로 나뉠 수 있어
// 버튼 동작 검증은 해당 스타일 span 들의 텍스트를 합쳐 원래 문자열로 확인한다.
const joinedText = arr => (arr||[]).map(x=>x.textContent||'').join('');
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
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '서식 런타임', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{ id: 'p1', els: [{ type: 'text', id: 't1', x: 40, y: 40, w: 220, h: 70, html: '첫 줄 둘째 줄', fontSize: 16 }] }],
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
    .find(c => (c.textContent || '').includes('서식 런타임'));
  check('노트 카드가 보인다', !!card);
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1600);
  check('에디터가 열린다', document.getElementById('editorView').classList.contains('open'));
  check('상단 툴바에 취소선 버튼이 있다', !!document.querySelector('.tb-strike'));

  const paper = document.querySelector('#pagesStage .paper[data-page-idx="0"]');
  paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 1100, width: 800, height: 1100, x: 0, y: 0 });
  const tb = document.querySelector('#pagesStage .tb');
  const content = tb && tb.querySelector('.tb-content');
  check('글상자가 그려진다', !!content);

  // ── ① 상자를 고르고 글꼴(주아)을 상자에 적용 ─────────────────────────
  content.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1, clientX: 60, clientY: 60 }));
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await wait(80);
  check('상자가 선택된다', tb.classList.contains('sel'));
  window.applyFont('jua');
  await wait(120);
  check('상자에 글꼴이 적용된다', (content.style.fontFamily || '').indexOf('Jua') >= 0);

  // ── ② '첫 줄'만 선택 → 글자색: 선택 구간만 칠해져야 한다 ──────────────
  const firstText = content.firstChild;
  const r1 = document.createRange();
  r1.setStart(firstText, 0); r1.setEnd(firstText, 3);      // '첫 줄' (3자)
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(r1);
  window.saveSel();
  window.applyTextColor('#e74c3c');
  await wait(120);

  const colorSpans = [...content.querySelectorAll('span[style*="color"]')];
  const picked = colorSpans.find(s => (s.textContent || '').trim() === '첫 줄');
  check('선택한 글자에만 색이 입혀진다', !!picked);
  check('선택 밖 글자는 색 span 안에 없다',
    [...content.childNodes].some(n => n.nodeType === 3 && (n.nodeValue || '').includes('둘째 줄')));
  check('색을 칠해도 상자 글꼴이 풀리지 않는다', (content.style.fontFamily || '').indexOf('Jua') >= 0);
  const colorHtml = content.innerHTML;
  check('저장되는 본문에도 선택 구간만 색 span 이다',
    colorHtml.includes('color') && colorHtml.includes('둘째 줄'));

  // ── ③ 선택 구간에 형광펜 → 선택 구간만, 그리고 '색 없음' → 배경만 제거 ──
  const pickedSpan = picked;
  const r2 = document.createRange();
  r2.selectNodeContents(pickedSpan);
  sel.removeAllRanges(); sel.addRange(r2);
  window.saveSel();
  window.applyHighlight('#ffff00');
  await wait(120);
  const hlSpans = [...content.querySelectorAll('span[style*="background"]')];
  check('선택한 글자에만 형광펜이 입혀진다',
    hlSpans.length === 1 && (hlSpans[0].textContent || '') === '첫 줄');
  window.applyHighlight(null);
  await wait(120);
  check('형광펜 색 없음은 배경만 지운다 (글자색은 남는다)',
    content.querySelectorAll('span[style*="background"]').length === 0
    && !!content.querySelector('span[style*="color"]'));
  check('형광펜을 지워도 글꼴이 풀리지 않는다', (content.style.fontFamily || '').indexOf('Jua') >= 0);

  // ── ④ 선택 없이 상자만 고른 상태 → 상자 전체에만 칠해진다 ─────────────
  window.clearTextSelection();
  content.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1, clientX: 60, clientY: 60 }));
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await wait(80);
  window.applyTextColor('#3498db');
  await wait(120);
  check('상자 전체 칠하기는 내용 전체를 덮는다',
    content.querySelectorAll('span[style*="color"]').length >= 2);
  check('상자 전체를 칠해도 글꼴이 풀리지 않는다', (content.style.fontFamily || '').indexOf('Jua') >= 0);

  // ── ⑤ 인라인 글꼴(부분) + 이후 색/형광펜 → 글꼴 보존 ───────────────────
  //   상자 글꼴(Jua)뿐 아니라 '둘째 줄'에만 입힌 부분 글꼴(Gaegu)도
  //   그 뒤 색/형광펜을 입혀도 유지되는지 확인한다.
  window.clearTextSelection();
  const tailSpan = [...content.querySelectorAll('span')].find(s => (s.textContent || '').includes('둘째 줄'));
  const tailText = tailSpan && [...tailSpan.childNodes].find(n => n.nodeType === 3 && (n.nodeValue || '').includes('둘째 줄'));
  check('색칠한 뒤에도 선택 밖 텍스트 노드가 남아 있다', !!tailText);
  if (tailText) {
    const rr = document.createRange();
    const startOff = (tailText.nodeValue || '').indexOf('둘째 줄');
    rr.setStart(tailText, startOff); rr.setEnd(tailText, startOff + 4);
    sel.removeAllRanges(); sel.addRange(rr);
    window.saveSel();
    window.applyFont('gaegu');
    await wait(120);
    const gaeguSpans = [...content.querySelectorAll('span[style*="font-family"]')]
      .filter(s => (s.style.fontFamily || '').includes('Gaegu') && (s.textContent || '').includes('둘째 줄'));
    check('부분 글꼴(Gaegu) 선택이 입혀진다', gaeguSpans.length >= 1);
    check('부분 글꼴 적용 후에도 상자 글꼴(Jua)이 남는다', (content.style.fontFamily || '').indexOf('Jua') >= 0);

    // 부분 글꼴 구간을 다시 선택해 색을 입힌다
    if (gaeguSpans.length) {
      const rr2 = document.createRange();
      rr2.selectNodeContents(gaeguSpans[0]);
      sel.removeAllRanges(); sel.addRange(rr2);
      window.saveSel();
      window.applyTextColor('#3498db');
      await wait(120);
      const stillGaegu = [...content.querySelectorAll('span[style*="font-family"]')]
        .some(s => (s.style.fontFamily || '').includes('Gaegu') && (s.textContent || '').includes('둘째 줄'));
      check('부분 글꼴에 색을 입혀도 Gaegu 가 남는다', stillGaegu);
      check('부분 글꼴에 색을 입혀도 상자 글꼴(Jua)이 남는다', (content.style.fontFamily || '').indexOf('Jua') >= 0);
    }

    // ── ⑥ 부분 글꼴 + 굵게/기울임/밑줄(execFmt) → 글꼴 보존 ──────────────
    // execCommand 대신 직접 span 으로 토글해도 부분 글꼴(Gaegu)이
    // 풀리지 않는지 확인한다.
    if (gaeguSpans.length) {
      const gg = gaeguSpans[0];
      const rrB = document.createRange();
      rrB.selectNodeContents(gg);
      sel.removeAllRanges(); sel.addRange(rrB);
      window.saveSel();
      window.execFmt('bold');
      await wait(120);
      const gaeguFont = s => (s.style.fontFamily || '').includes('Gaegu');
      const gaeguAll = () => [...content.querySelectorAll('span[style*="font-family"]')].filter(gaeguFont);
      const hasGaeguText = () => joinedText(gaeguAll()).includes('둘째 줄');
      const boldAll = () => [...content.querySelectorAll('span[style*="font-weight"]')]
        .filter(s => s.style.fontWeight === '700' || s.style.fontWeight === 'bold');
      const italicAll = () => [...content.querySelectorAll('span[style*="font-style"]')]
        .filter(s => s.style.fontStyle === 'italic' || s.style.fontStyle === 'oblique');
      const underAll = () => [...content.querySelectorAll('span[style*="text-decoration"]')]
        .filter(s => /underline/.test(s.style.textDecoration || ''));
      const pickTextSel = () => {
        const gg = gaeguAll().find(s => (s.textContent || '').includes('둘째')) || gaeguAll().find(s => (s.textContent || '').includes('줄'))
          || [...content.querySelectorAll('span')].find(s => (s.textContent || '').includes('둘째') || (s.textContent || '').includes('줄'));
        if (!gg) return null;
        const r = document.createRange(); r.selectNodeContents(gg); return r;
      };
      check('굵게 해도 부분 글꼴(Gaegu)이 남는다', hasGaeguText());
      check('굵게가 선택 구간에 입혀진다', joinedText(boldAll()).includes('둘째 줄'));
      check('굵게 후에도 상자 글꼴(Jua)이 남는다', (content.style.fontFamily || '').indexOf('Jua') >= 0);

      const rrI = pickTextSel();
      if (rrI) { sel.removeAllRanges(); sel.addRange(rrI); }
      window.saveSel();
      window.execFmt('italic');
      await wait(120);
      check('기울임이 선택 구간에 입혀진다', joinedText(italicAll()).includes('둘째 줄'));
      check('기울임 후에도 부분 글꼴(Gaegu)이 남는다', hasGaeguText());
      check('기울임 후에도 상자 글꼴(Jua)이 남는다', (content.style.fontFamily || '').indexOf('Jua') >= 0);

      const rrU = pickTextSel();
      if (rrU) { sel.removeAllRanges(); sel.addRange(rrU); }
      window.saveSel();
      window.execFmt('underline');
      await wait(120);
      check('밑줄 후에도 부분 글꼴(Gaegu)이 남는다', hasGaeguText());
      check('밑줄 후에도 상자 글꼴(Jua)이 남는다', (content.style.fontFamily || '').indexOf('Jua') >= 0);

      // ── 14.17 · 같은 글자에 '밑줄 + 형광펜'을 함께 걸어도 서로 지우지 않는다 ──
      const rrH = pickTextSel();
      if (rrH) { sel.removeAllRanges(); sel.addRange(rrH); }
      window.saveSel();
      window.applyHighlight('#ffff00');
      await wait(120);
      const hlAll = () => [...content.querySelectorAll('span[style*="background"]')]
        .filter(s => (s.style.backgroundColor || '') !== 'transparent');
      check('밑줄 위에 형광펜을 겹쳐도 밑줄이 남는다', joinedText(underAll()).includes('둘째 줄'));
      check('밑줄 위에 형광펜을 겹쳐도 형광펜이 남는다', joinedText(hlAll()).includes('둘째 줄'));
      check('밑줄+형광펜을 겹쳐도 부분 글꼴(Gaegu)이 남는다', hasGaeguText());
      check('밑줄+형광펜을 겹쳐도 상자 글꼴(Jua)이 남는다', (content.style.fontFamily || '').indexOf('Jua') >= 0);

      // 토글 해제도 부분 글꼴을 풀지 않아야 한다
      const rrU2 = pickTextSel();
      if (rrU2) { sel.removeAllRanges(); sel.addRange(rrU2); }
      window.saveSel();
      window.execFmt('underline');
      await wait(120);
      check('밑줄을 다시 눌러 지워도 부분 글꼴(Gaegu)이 남는다', hasGaeguText());
      check('밑줄을 지워도 상자 글꼴(Jua)이 남는다', (content.style.fontFamily || '').indexOf('Jua') >= 0);
      check('밑줄을 다시 눌러 지우면 밑줄 span 이 사라진다', joinedText(underAll()).indexOf('둘째 줄') < 0);
    }
  }

  // 상자 전체 형광펜을 입혀도 부분 글꼴 유지
  window.clearTextSelection();
  content.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1, clientX: 60, clientY: 60 }));
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await wait(80);
  window.applyHighlight('#ffff00');
  await wait(120);
  check('상자 전체 형광펜 후에도 부분 글꼴(Gaegu)이 남는다',
    [...content.querySelectorAll('span[style*="font-family"]')]
      .some(s => (s.style.fontFamily || '').includes('Gaegu') && (s.textContent || '').includes('둘째 줄')));
  check('상자 전체 형광펜 후에도 상자 글꼴(Jua)이 남는다', (content.style.fontFamily || '').indexOf('Jua') >= 0);

  // ── 상자만 고른 상태에서 굵게/기울임/밑줄 버튼도 동작 ─────────────────
  window.clearTextSelection();
  content.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1, clientX: 60, clientY: 60 }));
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await wait(80);
  const boxItalicBefore = [...content.querySelectorAll('span[style*="font-style"]')].length;
  window.execFmt('italic');
  await wait(120);
  const boxItalicAfter = [...content.querySelectorAll('span[style*="font-style"]')].length;
  check('상자 전체를 고르고 기울임을 누르면 글자에 기울임이 생긴다', boxItalicAfter > boxItalicBefore);
  window.execFmt('italic');
  await wait(120);
  const boxItalicAfter2 = [...content.querySelectorAll('span[style*="font-style"]')].length;
  check('같은 버튼을 다시 누르면 상자 전체 기울임이 해제된다', boxItalicAfter2 < boxItalicAfter);
  check('상자 전체 서식 토글 후에도 상자 글꼴(Jua)이 남는다', (content.style.fontFamily || '').indexOf('Jua') >= 0);

  // ── 서버(메모)에 el.font 가 그대로 남아 있는지 ─────────────────────────
  await wait(1400);
  const sel2 = await q({ table: 'memos', op: 'select', values: [], filters: [{ field: 'notebook_id', op: 'eq', value: String(id) }], limit: 1, single: true });
  const row = Array.isArray(sel2?.data) ? sel2.data[0] : sel2?.data;
  const memo = row?.content ? JSON.parse(row.content) : null;
  const el0 = memo?.pages?.[0]?.els?.[0];
  check('저장된 본문에도 상자 글꼴(el.font)이 남는다', el0 && el0.font === 'jua');
  check('저장된 본문에 색 span 이 남는다', (el0 && el0.html || '').includes('color'));

  // ── ⑤ 표: ＋ 버튼 제거 + 변 중앙 손잡이(한 축 늘리기) ─────────────────
  window.insertTable(2, 3, 0, 100, 120);
  await wait(200);
  check('2×3 표가 만들어진다', paper.querySelectorAll('.tb.in-tbl').length === 6);
  check('표에 ＋ 버튼이 없다', paper.querySelectorAll('.tbl-plus').length === 0);
  const stretches = [...paper.querySelectorAll('.tbl-stretch')];
  check('변 중앙 손잡이가 4개 있다 (위·아래·왼·오른쪽)', stretches.length === 4);

  const tblBox = () => paper.querySelector('.tbl-box');
  const boxStyle = () => {
    const b = tblBox();
    return { w: parseFloat(b.style.width), h: parseFloat(b.style.height),
             x: parseFloat(b.style.left), y: parseFloat(b.style.top) };
  };
  const s0 = boxStyle();

  // 아래 변: 아래로 60px → 높이만 커진다
  const btm = paper.querySelector('.tbl-stretch.bottom');
  btm.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: s0.x + s0.w / 2, clientY: s0.y + s0.h }));
  document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: s0.x + s0.w / 2, clientY: s0.y + s0.h + 60 }));
  document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await wait(200);
  const s1 = boxStyle();
  check(`아래 손잡이 = 세로로만 늘어난다 (높이 ${s0.h} → ${s1.h})`, s1.h > s0.h + 30);
  check('아래로 늘려도 가로 폭은 그대로다', s1.w === s0.w);

  // 오른쪽 변: 오른쪽으로 70px → 폭만 커진다
  const rgt = paper.querySelector('.tbl-stretch.right');
  rgt.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: s1.x + s1.w, clientY: s1.y + s1.h / 2 }));
  document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: s1.x + s1.w + 70, clientY: s1.y + s1.h / 2 }));
  document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await wait(200);
  const s2 = boxStyle();
  check(`오른쪽 손잡이 = 가로로만 늘어난다 (폭 ${s1.w} → ${s2.w})`, s2.w > s1.w + 40);
  check('오른쪽으로 늘려도 높이는 그대로다', s2.h === s1.h);

  // 왼쪽 위 꼭짓점은 여전히 양축 조절 (회귀 확인) — 안쪽(오른쪽 아래)으로 끌면
  // 표가 가로·세로 함께 작아져야 한다. (가로만 줄어들면 한 축 버그)
  const nw = paper.querySelector('.tbl-h.nw');
  nw.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: s2.x, clientY: s2.y }));
  document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: s2.x + 40, clientY: s2.y + 30 }));
  document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await wait(200);
  const s3 = boxStyle();
  check('꼭짓점은 가로·세로를 함께 조절한다 (회귀)', s3.w < s2.w && s3.h < s2.h);

  // 늘린 크기가 저장된 표 데이터(tables[].cw/ch)에도 남는다
  await wait(1200);
  const sel3 = await q({ table: 'memos', op: 'select', values: [], filters: [{ field: 'notebook_id', op: 'eq', value: String(id) }], limit: 1, single: true });
  const row3 = Array.isArray(sel3?.data) ? sel3.data[0] : sel3?.data;
  const memo3 = row3?.content ? JSON.parse(row3.content) : null;
  const tbl3 = memo3?.pages?.[0]?.tables?.[0];
  check('늘린 크기가 표 데이터에도 저장된다',
    !!tbl3 && Math.round(tbl3.cw.reduce((a, b) => a + b, 0)) === s3.w
          && Math.round(tbl3.ch.reduce((a, b) => a + b, 0)) === s3.h);

  const fatal = errors.filter(Boolean);
  check('서식·표 늘리기 중 치명적 런타임 오류가 없다', fatal.length === 0);
  if (fatal.length) console.log(fatal.slice(0, 5).join('\n---\n'));
  console.log(`\n에디터 서식(색·형광펜·글꼴 보존) + 표 한 축 늘리기: PASS ${pass} / FAIL 0`);
} catch (e) {
  console.error('\n에디터 서식 런타임 실패:', e);
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
