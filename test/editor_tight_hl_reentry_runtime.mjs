/* 고정 글자(tight) + 형광펜 — 두 번째 왕복에서 편집 모드가 굳는 회귀 (14.45.1)

   사용자 보고: "형광펜은 한 번 칠하고 나가면 미리보기로 잘 복구된다. 그런데 그
   텍스트상자를 다시 더블클릭한 뒤 나가면 그다음번에는 편집 모드 그대로다.
   형광펜을 칠할 때에만 생기는 문제야."

   원인: 읽기 복귀(_rebuildTightToReading)를 부르는 퇴장 경로들이 'enterEdit 이
   붙인 편집 플래그(_sdyTightLine/_sdyTightEdit)'만 봤다. 형광펜·글자색처럼
   pushHistory() 로 서식하는 길은 커맨드 *앞에서* commitEditingText() 를 태우는데,
   그 안의 '편집 종료 플래그 정리'가 아직 편집 중인데도 _sdyTightEdit 를 지워
   버린다(맞춤·되돌리기·협업 재그리기가 .tb 노드를 교체해도 플래그는 사라진다).
   플래그가 없으면 퇴장이 복구를 통째로 건너뛰고 .sdy-tl 줄 흐름 편집 DOM 이
   el.html 그대로 확정·저장된다 → 다시 그릴 때마다 '편집 모드 그대로'가 복원되고,
   그 상태에서는 진입/퇴장이 계속 흐져 혼자 회복되지 않는다.

   검증:
     ① 형광펜 1회차 왕복 → 미리보기(단어 절대좌표) 복구
     ② 같은 상자 재진입 → 퇴장 → 여전히 미리보기
     ③ '플래그가 사라진' 상태(위 원인)를 흉내내서 칠하고 나가도 복구되는지
     ④ 이미 줄 흐름이 굳어 저장된 문서는 그릴 때 자가 치유되는지
     ⑤ 읽기 상자를 골라 서식을 주면 캐럿 때문에 임시로 열린 편집 상태가 닫히는지
     ⑥ 읽기 상자에 서식을 입힐 때 줄 흐름이 저장본(el.html)으로 굳지 않는지 */
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-hl-reentry-'));
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

async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}

function textNodeOf(win, content, needle) {
  const tw = win.document.createTreeWalker(content, win.NodeFilter.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode())) if ((n.nodeValue || '').includes(needle)) return n;
  return null;
}
function selectSub(win, content, needle) {
  const tn = textNodeOf(win, content, needle);
  assert.ok(tn, `잘못된 테스트 — '${needle}' 텍스트를 찾지 못했다`);
  const at = (tn.nodeValue || '').indexOf(needle);
  const r = win.document.createRange();
  r.setStart(tn, at);
  r.setEnd(tn, at + needle.length);
  const s = win.getSelection();
  s.removeAllRanges(); s.addRange(r);
  win.saveSel();
  return r;
}

// 원문 단어 배치(절대좌표 span) 두 줄 — 14.45 의 왕복 대상과 같은 모양
const word = (text, left, top, pdfW) =>
  `<span data-word="1" data-fs="20" data-pdf-w="${pdfW}" data-pdf-base="${top + 16}" ` +
  `style="position:absolute;left:${left}px;top:${top}px;font-size:20px;line-height:20px;white-space:nowrap;">${text}</span>`;
const row1 = word('alpha', 0, 0, 46) + word('beta', 60, 0, 38) + word('gamma', 120, 0, 48);
const row2 = word('delta', 0, 24, 44) + word('epsilon', 58, 24, 60) + word('zeta', 140, 24, 36);
// ④ 에서 쓸 '굳어버린 저장본' — 줄 흐름(.sdy-tl) 이 그대로 확정된 문서
const stuck = `<div class="sdy-tl" style="position:absolute;left:0;width:100%;top:0px;height:24px;line-height:20px;white-space:nowrap;">`
  + `<span style="font-size:20px;line-height:1;white-space:nowrap;background-color:rgb(255,255,0);">alpha</span>`
  + `<span class="sdy-ts" style="font-size:20px;line-height:1;white-space:nowrap;"> </span>`
  + `<span style="font-size:20px;line-height:1;white-space:nowrap;">beta</span></div>`
  + `<div class="sdy-tl" style="position:absolute;left:0;width:100%;top:24px;height:20px;line-height:20px;white-space:nowrap;">`
  + `<span style="font-size:20px;line-height:1;white-space:nowrap;">delta</span></div>`;

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/src/index.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(port), SDY_STORAGE: 'oracle' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);
let dom, pass = 0;
const failures = [];
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { failures.push(name + (extra ? ` — ${extra}` : '')); console.log('  ✗ ' + name + (extra ? ` — ${extra}` : '')); }
};
try {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server died');
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await wait(80);
  }
  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  const nb = await q({ table: 'notebooks', op: 'insert', values: [{ title: '형광펜 재진입', color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const id = nb.data.id;
  const doc0 = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [{
      id: 'p1', els: [
        { type: 'text', id: 't1', x: 40, y: 40, w: 260, h: 80, html: row1 + row2, fontSize: 16, tight: 1 },
        { type: 'text', id: 't2', x: 40, y: 300, w: 260, h: 80, html: stuck, fontSize: 16, tight: 1 },
      ],
    }],
  };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: id, content: JSON.stringify(doc0), font_size: 16 }], filters: [] });

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String(e?.message || e);
    if (!/HTMLMediaElement|Could not load (link|script)/.test(m)) errors.push(m);
  });
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
      window.matchMedia = query => ({ matches: query.includes('pointer:fine'), media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.BroadcastChannel = class { postMessage() {} close() {} addEventListener() {} };
      window.EventSource = class { close() {} addEventListener() {} };
      window.requestIdleCallback = cb => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
      window.fetch = (input, init) => {
        const target = typeof input === 'string' || input instanceof URL ? new URL(String(input), window.location.href) : input;
        return globalThis.fetch(target, init);
      };
    },
  });

  const { window } = dom, { document } = window;
  const boot = Date.now();
  while (Date.now() - boot < 8_000 && document.querySelectorAll('.note-stack .note-card').length < 1) await wait(60);
  const card = [...document.querySelectorAll('.note-stack .note-card')].find(c => (c.textContent || '').includes('형광펜 재진입'));
  assert.ok(card, '노트 카드가 보인다');
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1600);

  const box = bid => document.querySelector(`#pagesStage .tb[data-id="${bid}"]`);
  const content = bid => { const b = box(bid); return b && b.querySelector('.tb-content'); };
  const modelHtml = bid => String((window.findEl(0, bid) || {}).html || '');
  const flowRows = bid => document.querySelectorAll(`#pagesStage .tb[data-id="${bid}"] .tb-content > .sdy-tl`).length;
  const absWords = bid => document.querySelectorAll(`#pagesStage .tb[data-id="${bid}"] .tb-content > span[data-pdf-w]`).length;
  const enterEdit = bid => {
    const c = content(bid);
    c.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    return { b: box(bid), c };
  };
  const exitEdit = () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const previewOk = (tag, bid) => {
    const b = box(bid), c = content(bid), h = modelHtml(bid);
    const dbg = `cls=${b ? b.className : 'nobox'} editable=${c ? c.getAttribute('contenteditable') : '?'} tl=${flowRows(bid)} abs=${absWords(bid)}`;
    check(`${tag}: 편집 클래스가 없다`, !!b && !b.classList.contains('edit'), dbg);
    check(`${tag}: 편집 가능(contenteditable) 상태가 아니다`, !!c && c.getAttribute('contenteditable') !== 'true', dbg);
    check(`${tag}: 화면에 줄 흐름(.sdy-tl) 잔류가 없다`, flowRows(bid) === 0, dbg + ' html=' + ((c && c.innerHTML) || '').slice(0, 180));
    check(`${tag}: 화면이 단어 절대좌표 span 이다`, absWords(bid) === 6, dbg);
    check(`${tag}: 저장 모델이 단어 절대좌표다`, !h.includes('sdy-tl') && !h.includes('sdy-tg') && h.includes('data-pdf-w'), dbg);
  };
  const painted = (bid, t) => {
    const c = content(bid);
    const sp = c && [...c.querySelectorAll('span')].find(s => (s.textContent || '').includes(t));
    return !!(sp && (sp.style.backgroundColor || ''));
  };

  // ① 형광펜 한 번 칠하고 나가기 — 미리보기로 복구된다 (14.45 에서 고친 동작)
  let cur = enterEdit('t1');
  await wait(180);
  check('① 편집 진입 + 줄 흐름 변환', cur.b.classList.contains('edit') && flowRows('t1') === 2);
  selectSub(window, cur.c, 'beta');
  window.applyHighlight('#ffff00');
  await wait(140);
  check('① 형광펜이 모델로 확정된다(칠한 글자가 사라지지 않는다)', modelHtml('t1').includes('background-color'));
  exitEdit();
  await wait(500);
  previewOk('① 나간 뒤', 't1');
  check('① 형광펜이 미리보기 화면에도 남는다', painted('t1', 'beta'));

  // ② 같은 상자를 다시 더블클릭 → 나가기 — 여기서 예전엔 편집 모드가 굳었다
  cur = enterEdit('t1');
  await wait(180);
  check('② 재진입', cur.b.classList.contains('edit'));
  exitEdit();
  await wait(500);
  previewOk('② 재진입 후 나간 뒤', 't1');
  check('② 1회차 형광펜이 그대로 남는다', painted('t1', 'beta'));
  if (typeof window.renderPages === 'function') { window.renderPages(); await wait(400); previewOk('② 쪽을 다시 그려도', 't1'); }

  // ③ 회귀의 심장 — '플래그가 사라진' 상태. pushHistory(publishHistory 로 인한
  //    편집 중 commitEditingText)·맞춤/되돌리기의 노드 교체가 실제로 만든다.
  cur = enterEdit('t1');
  await wait(180);
  check('③ 재진입(3회차) 후에도 줄 흐름으로 열린다', flowRows('t1') === 2);
  delete cur.b._sdyTightEdit; delete cur.b._sdyTightLine;     // 플래그 소실 흉내
  selectSub(window, cur.c, 'gamma');
  window.applyHighlight('#ffcc00');
  await wait(700);                                            // 오토세이브(400ms)가 한 번 더 커밋한다
  exitEdit();
  await wait(500);
  previewOk('③ 플래그가 없어도 나간 뒤엔 미리보기로 복구된다', 't1');
  check('③ 3회차 형광펜이 남는다', painted('t1', 'gamma'));
  check('③ 앞선 형광펜도 남는다', painted('t1', 'beta'));
  if (typeof window.renderPages === 'function') { window.renderPages(); await wait(400); previewOk('③ 다시 그려도', 't1'); }

  // ④ 이미 줄 흐름이 굳어 저장된 노트는 그리는 순간 자가 치유된다
  {
    const el2 = window.findEl(0, 't2');
    el2.html = stuck;
    window.markPageEdited(0);
    if (typeof window.renderPages === 'function') { window.renderPages(); await wait(500); }
    const h = modelHtml('t2');
    check('④ 굳은 저장본(줄 흐름)을 그릴 때 단어 절대좌표로 되돌린다',
      !h.includes('sdy-tl') && h.includes('data-pdf-w'), h.slice(0, 200));
    check('④ 되돌린 뒤 형광펜이 단어에 남는다', painted('t2', 'alpha'));
    check('④ 화면도 절대좌표 배치가 된다', flowRows('t2') === 0 && absWords('t2') === 3, `tl=${flowRows('t2')} abs=${absWords('t2')}`);
    // 치유된 상자는 편집 왕복이 정상 경로로 돌아온다
    const cur4 = enterEdit('t2');
    await wait(180);
    check('④ 치유 후 편집 진입에 다시 줄 흐름을 연다', cur4.b.classList.contains('edit') && flowRows('t2') === 2);
    exitEdit();
    await wait(500);
    const b4 = box('t2'), c4 = content('t2');
    check('④ 치유 후 왕복도 미리보기로 끝난다', !!b4 && !b4.classList.contains('edit') && flowRows('t2') === 0
      && c4.getAttribute('contenteditable') !== 'true');
  }

  // ⑤ 미리보기(읽기) 상자를 골라 서식 커맨드를 쓰면 — 서식 엔진은 선택을 되살리며
  //    상자를 '임시로' 편집 가능하게 연다(restoreSel). 커맨드 래퍼(withSelection)가
  //    그것을 다시 닫지 않으면 미리보기 상자가 캐럿이 깜빡이는 편집 상태로 남는다.
  {
    window.deselectAll();
    await wait(80);
    const c5 = content('t1');
    selectSub(window, c5, 'delta');
    await wait(60);
    check('⑤ 전제 — restoreSel 은 읽기 상자를 임시로 편집 가능하게 연다',
      window.restoreSel() === c5 && c5.getAttribute('contenteditable') === 'true');
    const ret = window.withSelection(() => { });        // 서식 커맨드와 같은 마무리
    await wait(120);
    check('⑤ 커맨드가 끝난 상자는 편집 상태로 남지 않는다',
      ret === true && c5.getAttribute('contenteditable') !== 'true');
    check('⑤ 닫은 뒤에도 골라 둔 범위는 살아 있다(다음 커맨드가 같은 범위를 쓴다)',
      window.hasInlineTextSel() === true);
    check('⑤ 미리보기 배치는 그대로다', flowRows('t1') === 0 && absWords('t1') === 6);
  }

  // ⑥ 서식 커맨드가 '편집 중이 아닌' 상자(노드가 교체돼 플래그가 사라진 경우를
  //    포함)의 syncTextEl 을 태워도 줄 흐름이 저장본으로 굳지 않는다 — syncTextEl
  //    안의 마지막 방어선이 절대좌표로 되돌려 확정한다.
  {
    const cur6 = enterEdit('t1');
    await wait(180);
    cur6.b.classList.remove('edit');                       // 편집 중이 아닌 것처럼 만든다
    delete cur6.b._sdyTightEdit; delete cur6.b._sdyTightLine;
    selectSub(window, cur6.c, 'zeta');
    window.applyHighlight('#ff99cc');
    await wait(400);
    const h6 = modelHtml('t1');
    check('⑥ 편집 중이 아닌 상자에서 줄 흐름이 모델로 확정되지 않는다',
      !h6.includes('sdy-tl') && h6.includes('data-pdf-w'), h6.slice(0, 180));
    check('⑥ 그래도 방금 칠한 형광펜은 남는다', painted('t1', 'zeta'));
    // 화면도 다시 그리는 순간 절대좌표 배치로 돌아온다.
    if (typeof window.renderPages === 'function') { window.renderPages(); await wait(400); }
    check('⑥ 다시 그리면 절대좌표 배치다', flowRows('t1') === 0 && absWords('t1') === 6,
      `tl=${flowRows('t1')} abs=${absWords('t1')}`);
  }

  const fatal = errors.filter(e => !/isTrBusy|undefined is not an object|getContext/.test(String(e)));
  check('치명적 런타임 오류가 없다', fatal.length === 0, fatal.slice(0, 2).join(' | '));
  assert.equal(failures.length, 0, `실패 ${failures.length}건:\n` + failures.join('\n'));
  console.log(`\n고정 글자 형광펜 재진입(읽기 복구) 회귀: PASS ${pass} / FAIL 0`);
} catch (e) {
  console.error('\n고정 글자 형광펜 재진입 실패:', e && (e.stack || e.message || String(e)));
  if (log) console.error('server log:\n' + log.slice(-1200));
  process.exitCode = 1;
} finally {
  await wait(80);
  await closeDoms([dom]);
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), wait(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  fs.rmSync(TMP, { recursive: true, force: true });
}
