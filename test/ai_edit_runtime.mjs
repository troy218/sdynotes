/* 14.24.0 · 해돌이 문서 편집 bridge 실제 런타임 검증
   14.25.0 · 서식(@st)·부분 수정(@rp·@ap)·표(@tbl·@tsz·@tmv·@tcell)·쪽 이동·
   추가(@goto·@newpage)·노트 제목(@title)·클립보드(@clip·@copy) 검증 추가.

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

  // ── 14.25.0 · 서식·부분 수정·표·쪽·제목·클립보드 ──
  window.findEl(0, 'title-box').html = '<b>굵은</b> 제목과 <span style="color:#a63f47">빨간</span> 글<br>둘째 줄';
  const cap2 = window.__sdyAiBridge.capture();
  const r2 = window.__sdyAiBridge.apply([
    { cmd: 'rp', id: 'title-box', find: '제목과 빨간', repl: '제목+파란' },
    { cmd: 'rp', id: 'title-box', find: '없는 말', repl: 'x' },
    { cmd: 'ap', id: 'title-box', dir: '뒤', text: '셋째 줄' },
    { cmd: 'st', id: 'title-box', style: 'font=gaegu, fs=22, fg=빨강, hl=노랑, bold=on, align=center' },
    { cmd: 'st', id: 'stroke-1', style: 'color=파랑, size=4' },
    { cmd: 'st', id: 'title-box', style: 'nonsense=zzz' },
  ], cap2.revision);
  await wait(400);
  check('부분 수정·덧붙이기·서식 4개 적용, 못 찾은 글·모르는 서식은 거절',
    r2.applied === 4 && r2.failed === 2, JSON.stringify(r2));
  const tb2 = window.findEl(0, 'title-box');
  check('부분 수정은 굵기·색 span·줄바꿈을 살리고 덧붙인 줄이 맨 뒤에 붙는다',
    /<b>굵은<\/b> 제목\+파란/.test(tb2.html) && /<span style="color:#a63f47">/.test(tb2.html)
    && /<br>둘째 줄<br>셋째 줄/.test(tb2.html), tb2.html.slice(0, 200));
  check('글꼴·크기·색·형광펜·굵기·정렬이 상자에 반영된다',
    tb2.font === 'gaegu' && tb2.fontSize === 22 && tb2.textColor === '#a63f47'
    && tb2.cellBg === '#efd36a' && tb2.fontWeight === '700' && tb2.align === 'center',
    JSON.stringify({ font: tb2.font, fs: tb2.fontSize, fg: tb2.textColor, hl: tb2.cellBg }));
  const st2 = window.findEl(0, 'stroke-1');
  check('그림획 펜색·굵기를 바꾼다', st2.color === '#3d6ea8' && st2.size === 4,
    JSON.stringify({ color: st2.color, size: st2.size }));

  const cap3 = window.__sdyAiBridge.capture();
  check('스냅샷에 글꼴·크기·색·형광펜·굵기·정렬이 보인다',
    /id=title-box type=글상자.*font=gaegu fs=22 al=center fg=#a63f47 hl=#efd36a st=B/.test(cap3.text));

  const r3 = window.__sdyAiBridge.apply([
    { cmd: 'tbl', page: 1, x: 60, y: 400, rows: 2, cols: 2, text: '이름|나이\n철수|7' },
  ], cap3.revision);
  await wait(400);
  check('표 만들기 1개 적용', r3.applied === 1 && r3.failed === 0, JSON.stringify(r3));
  const doc3 = window.__sdyTranslate.getDoc();
  const tbl = (doc3.pages[0].tables || [])[0];
  check('표 크기는 내용에 맞춰지고 페이지 안에 들어간다',
    !!tbl && tbl.cw.length === 2 && tbl.ch.length === 2
    && tbl.x + tbl.cw[0] + tbl.cw[1] <= 800 && tbl.y + tbl.ch[0] + tbl.ch[1] <= 1100,
    tbl && JSON.stringify({ x: tbl.x, y: tbl.y, cw: tbl.cw, ch: tbl.ch }));
  const cell00 = doc3.pages[0].els.find((e) => e.type === 'text' && e.tbl && e.tbl.tid === tbl.id && e.tbl.r === 0 && e.tbl.c === 0);
  const cell11 = doc3.pages[0].els.find((e) => e.type === 'text' && e.tbl && e.tbl.tid === tbl.id && e.tbl.r === 1 && e.tbl.c === 1);
  check('표 칸 내용이 채워진다',
    !!cell00 && !!cell11 && /이름/.test(cell00.html) && /7/.test(cell11.html));

  const cap4 = window.__sdyAiBridge.capture();
  check('스냅샷에 표 한 줄 요약(행·열·칸)이 보인다',
    new RegExp(`id=${tbl.id} type=표[^\\n]*rows=2 cols=2[^\\n]*cells="이름\\|나이;철수\\|7"`).test(cap4.text));
  const r4 = window.__sdyAiBridge.apply([
    { cmd: 'tcell', id: tbl.id, r: 2, c: 2, text: '여덟' },
    { cmd: 'st', id: cell00.id, style: 'bold=on' },
    { cmd: 'tx', id: cell00.id, text: '직접 고치기' },
    { cmd: 'tsz', id: tbl.id, w: 400, h: 120 },
    { cmd: 'tmv', id: tbl.id, x: 100, y: 500 },
  ], cap4.revision);
  await wait(400);
  check('표 칸·칸 서식·표 크기·표 이동 4개 적용, 직접 @tx는 거절',
    r4.applied === 4 && r4.failed === 1, JSON.stringify(r4));
  const tblAfter = window.__sdyTranslate.getDoc().pages[0].tables.find((t) => t.id === tbl.id);
  check('표 칸 글·칸 서식·표 크기·표 위치가 반영된다',
    /여덟/.test(cell11.html) && cell00.fontWeight === '700' && !/직접 고치기/.test(cell00.html)
    && Math.abs((tblAfter.cw[0] + tblAfter.cw[1]) - 400) <= 2
    && tblAfter.x === 100 && tblAfter.y === 500,
    JSON.stringify({ w: tblAfter.cw[0] + tblAfter.cw[1], x: tblAfter.x, y: tblAfter.y }));

  const cap5 = window.__sdyAiBridge.capture();
  const r5 = window.__sdyAiBridge.apply([{ cmd: 'del', id: tbl.id }], cap5.revision);
  await wait(300);
  const doc5 = window.__sdyTranslate.getDoc();
  check('표 id 삭제는 표·칸·테두리를 함께 지운다',
    r5.applied === 1 && (doc5.pages[0].tables || []).length === 0
    && !doc5.pages[0].els.some((e) => e.tbl && e.tbl.tid === tbl.id));

  const cap6 = window.__sdyAiBridge.capture();
  const r6 = window.__sdyAiBridge.apply([
    { cmd: 'newpage' },
    { cmd: 'add', page: 2, x: 60, y: 60, w: 300, h: 80, text: '둘째 쪽 메모' },
    { cmd: 'goto', page: 1 },
    { cmd: 'title', text: 'AI 편집 런타임 · 고침' },
  ], cap6.revision);
  await wait(400);
  const doc6 = window.__sdyTranslate.getDoc();
  check('새 쪽·둘째 쪽 상자·쪽 이동·제목 4개 적용',
    r6.applied === 4 && doc6.pages.length === 2
    && doc6.pages[1].els.some((e) => /둘째 쪽 메모/.test(e.html || ''))
    && document.getElementById('pgNow').value === '1'
    && document.getElementById('edTitle').value === 'AI 편집 런타임 · 고침');

  const cap7 = window.__sdyAiBridge.capture();
  const r7 = window.__sdyAiBridge.apply([
    { cmd: 'goto', page: 9 },
    { cmd: 'tcell', id: 'tb_없음', r: 1, c: 1, text: 'x' },
    { cmd: 'tsz', id: 'tb_없음', w: 10, h: 10 },
    { cmd: 'title', text: '   ' },
  ], cap7.revision);
  check('없는 쪽·표·빈 제목은 거절한다', r7.applied === 0 && r7.failed === 4, JSON.stringify(r7));

  // ── 14.27.0 · 형광펜(글귀 단위) ──
  window.findEl(0, 'title-box').html =
    '<b>핵심</b> 결론은 <span style="color:#a63f47">물 부족</span>이다<br>둘째 줄은 그냥 글';
  delete window.findEl(0, 'title-box').cellBg;
  const capH = window.__sdyAiBridge.capture();
  const rH = window.__sdyAiBridge.apply([
    { cmd: 'hl', id: 'title-box', find: '물 부족', color: '노랑' },
    { cmd: 'hl', id: 'title-box', find: '없는 글귀', color: '노랑' },
  ], capH.revision);
  await wait(200);
  const hlBox = window.findEl(0, 'title-box');
  check('형광펜은 그 글귀만 칠하고 굵기·글자색 span을 살린다',
    rH.applied === 1 && rH.failed === 1
    && /<span style="color:#a63f47"><span style="background-color:#efd36a">물 부족<\/span><\/span>/.test(hlBox.html)
    && /<b>핵심<\/b>/.test(hlBox.html) && /둘째 줄은 그냥 글/.test(hlBox.html),
    hlBox.html.slice(0, 220));
  check('형광펜 색을 안 적으면 노랑을 쓴다',
    !hlBox.cellBg && (hlBox.html.match(/background-color:#efd36a/g) || []).length === 1);

  const capH2 = window.__sdyAiBridge.capture();
  check('스냅샷은 칠해진 글귀를 ⟦…⟧ 로 보여 주고 아닌 곳은 그대로 둔다',
    /⟦물 부족⟧/.test(capH2.text) && !/⟦핵심⟧/.test(capH2.text)
    && /text="핵심 결론은 ⟦물 부족⟧이다 둘째 줄은 그냥 글"/.test(capH2.text),
    (capH2.text.match(/id=title-box[^\n]*/) || [''])[0]);

  const capH3 = window.__sdyAiBridge.capture();
  const rH3 = window.__sdyAiBridge.apply([
    { cmd: 'hl', id: 'title-box', find: '⟦물 부족⟧', color: '없음' },
  ], capH3.revision);
  await wait(200);
  check('스냅샷의 ⟦⟧를 그대로 베껴 와도 그 글귀 형광펜만 지운다',
    rH3.applied === 1 && !/background-color/.test(window.findEl(0, 'title-box').html)
    && /<span style="color:#a63f47">물 부족<\/span>/.test(window.findEl(0, 'title-box').html)
    && /<b>핵심<\/b>/.test(window.findEl(0, 'title-box').html),
    window.findEl(0, 'title-box').html.slice(0, 220));

  const capH4 = window.__sdyAiBridge.capture();
  const rH4 = window.__sdyAiBridge.apply([
    { cmd: 'hl', id: 'title-box', find: '연두', color: '', single: true },
  ], capH4.revision);
  await wait(150);
  check('값 하나로 오면 색으로 알아들어 상자 전체 형광펜이 된다',
    rH4.applied === 1 && window.findEl(0, 'title-box').cellBg === '#b7d97a',
    String(window.findEl(0, 'title-box').cellBg));
  const capH5 = window.__sdyAiBridge.capture();
  const rH5 = window.__sdyAiBridge.apply([
    { cmd: 'hl', id: 'title-box', find: '', color: '없음' },
    { cmd: 'hl', id: 'photo-1', find: '', color: '노랑' },
  ], capH5.revision);
  check('상자 전체 형광펜은 지우고 사진에는 칠하지 않는다',
    rH5.applied === 1 && rH5.failed === 1 && !window.findEl(0, 'title-box').cellBg);

  // ── 14.27.0 · 모델이 내보내는 @ 줄을 파서로 읽어 그대로 적용한다(이어짐 확인) ──
  window.findEl(0, 'title-box').html = '오늘의 결론: 물 부족이 가장 크다. 수치는 42%다.';
  const capP = window.__sdyAiBridge.capture();
  const planP = window.sdyAiEditParse([
    '@hl title-box | 물 부족 | 하늘',
    '@hl title-box | 42%',
    '@done 두 곳에 형광펜을 칠했어요',
  ].join('\n'));
  const rP = window.__sdyAiBridge.apply(planP.ops, capP.revision);
  await wait(200);
  const pHtml = window.findEl(0, 'title-box').html;
  check('모델의 @hl 두 줄이 파서를 지나 그대로 적용된다',
    planP.ops.length === 2 && planP.dropped === 0 && rP.applied === 2 && rP.failed === 0
    && /<span style="background-color:#83d7de">물 부족<\/span>/.test(pHtml)
    && /<span style="background-color:#efd36a">42%<\/span>/.test(pHtml),
    pHtml.slice(0, 240));

  // ── 14.27.0 · 표는 칸 id로 지워도 표 전체가 사라진다 ──
  const capT = window.__sdyAiBridge.capture();
  const rT = window.__sdyAiBridge.apply([
    { cmd: 'tbl', page: 1, x: 'auto', y: 'auto', rows: 2, cols: 2, text: '가|나\n다|라' },
  ], capT.revision);
  await wait(300);
  const docT = window.__sdyTranslate.getDoc();
  const tbl2 = (docT.pages[0].tables || [])[0];
  check('표 자리를 auto로 맡기면 페이지 안 빈자리에 정돈돼 들어간다',
    rT.applied === 1 && !!tbl2 && tbl2.x >= 0 && tbl2.y >= 0
    && tbl2.x + tbl2.cw[0] + tbl2.cw[1] <= 800
    && tbl2.y + tbl2.ch[0] + tbl2.ch[1] <= 1100
    && tbl2.x % 8 === 0 && tbl2.y % 8 === 0,
    tbl2 && JSON.stringify({ x: tbl2.x, y: tbl2.y, cw: tbl2.cw, ch: tbl2.ch }));
  const cell2 = docT.pages[0].els.find((e) => e.type === 'text' && e.tbl && e.tbl.tid === tbl2.id);
  const capT2 = window.__sdyAiBridge.capture();
  const rT2 = window.__sdyAiBridge.apply([{ cmd: 'del', id: cell2.id }], capT2.revision);
  await wait(300);
  const docT2 = window.__sdyTranslate.getDoc();
  check('표 칸 id로 지워도 표·칸·테두리가 함께 사라진다',
    rT2.applied === 1 && (docT2.pages[0].tables || []).length === 0
    && !docT2.pages[0].els.some((e) => e.tbl && e.tbl.tid === tbl2.id)
    && /표 전체를 지웠어요/.test((rT2.notes || []).join(' ')), JSON.stringify(rT2));

  // ── 14.27.0 · 보기 좋은 배치 — auto 자리·글에 맞춘 높이·쪽 정돈 ──
  const before = window.__sdyTranslate.getDoc().pages[0].els.length;
  const capA = window.__sdyAiBridge.capture();
  const longText = '새로 덧붙이는 긴 메모다. '.repeat(6);
  const rA = window.__sdyAiBridge.apply([
    { cmd: 'add', page: 1, x: 'auto', y: 'auto', w: 'auto', h: 'auto', text: longText },
  ], capA.revision);
  await wait(300);
  const docA = window.__sdyTranslate.getDoc();
  const addedAuto = docA.pages[0].els[docA.pages[0].els.length - 1];
  const boxes = docA.pages[0].els
    .filter((e) => e.type !== 'stroke' && !(e.type === 'stroke' && e.tbl))
    .map((e) => ({ id: e.id, x: e.x, y: e.y, w: e.w, h: e.h }));
  const clash = boxes.some((a) => boxes.some((b) => a !== b
    && a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2
    && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2));
  check('auto로 더한 상자는 본문 너비를 따르고 글이 넘치지 않을 만큼 크다',
    rA.applied === 1 && docA.pages[0].els.length === before + 1
    && addedAuto.w >= 120 && addedAuto.h >= 60
    && addedAuto.x >= 0 && addedAuto.y >= 0
    && addedAuto.x + addedAuto.w <= 800 && addedAuto.y + addedAuto.h <= 1100,
    JSON.stringify({ w: addedAuto.w, h: addedAuto.h, x: addedAuto.x, y: addedAuto.y }));
  check('auto로 더한 상자는 다른 상자와 겹치지 않는다', !clash,
    JSON.stringify(boxes.filter((b) => b.id === addedAuto.id)));

  const capM = window.__sdyAiBridge.capture();
  window.__sdyAiBridge.apply([{ cmd: 'mv', id: 'title-box', x: 101, y: 203 }], capM.revision);
  await wait(150);
  check('옮기기(@mv)는 요청한 좌표를 그대로 존중한다(격자를 강제로 씌우지 않는다)',
    window.findEl(0, 'title-box').x === 101 && window.findEl(0, 'title-box').y === 203,
    JSON.stringify({ x: window.findEl(0, 'title-box').x, y: window.findEl(0, 'title-box').y }));

  const tb = window.findEl(0, 'title-box');
  const lb = window.findEl(0, 'locked-box');
  tb.x = 53; tb.y = 101; lb.x = 44; lb.y = 180;
  const capY = window.__sdyAiBridge.capture();
  const rY = window.__sdyAiBridge.apply([{ cmd: 'tidy', page: 1 }], capY.revision);
  await wait(250);
  check('@tidy는 본문 왼쪽 끝·격자에 맞추고 잠긴 상자는 건드리지 않는다',
    rY.applied === 1 && window.findEl(0, 'title-box').x === 40
    && window.findEl(0, 'title-box').y % 8 === 0
    && window.findEl(0, 'locked-box').x === 44 && window.findEl(0, 'locked-box').y === 180,
    JSON.stringify({ title: { x: window.findEl(0, 'title-box').x, y: window.findEl(0, 'title-box').y },
      locked: { x: window.findEl(0, 'locked-box').x, y: window.findEl(0, 'locked-box').y } }));

  // 클립보드 — 읽기/쓰기를 흉내 내어 붙여넣기·복사 경로를 탄다
  let clipStore = '클립보드에서 온 글';
  try {
    Object.defineProperty(window.navigator, 'clipboard', {
      value: {
        readText: async () => clipStore,
        writeText: async (t) => { clipStore = String(t); },
      },
      configurable: true,
    });
  } catch (e) { /* 이 jsdom 은 navigator 를 못 바꿈 — 실패 경로만 본다 */ }
  const cap8 = window.__sdyAiBridge.capture();
  const pr8 = window.__sdyAiBridge.apply([
    { cmd: 'clip', page: 1, x: 60, y: 600, w: 300, h: 80 },
    { cmd: 'copy', id: 'title-box' },
  ], cap8.revision);
  check('클립보드 명령은 비동기로 처리한다', !!pr8 && typeof pr8.then === 'function');
  const r8 = await pr8;
  await wait(300);
  const hasClip = window.__sdyTranslate.getDoc().pages[0].els
    .some((e) => e.type === 'text' && /클립보드에서 온 글/.test(e.html || ''));
  if (hasClip && clipStore.includes('제목+파란')) {
    check('클립보드 붙여넣기는 새 상자를 만들고 복사는 글을 내보낸다',
      r8.applied === 2 && r8.failed === 0, JSON.stringify(r8));
  } else {
    check('클립보드를 못 쓰는 환경에서도 죽지 않고 센다', r8.applied + r8.failed === 2);
  }
  try { delete window.navigator.clipboard; } catch (e) {}

  // 새 명령 묶음도 Ctrl+Z 한 번으로 되돌아간다
  window.findEl(0, 'title-box').html = '되돌리기 전';
  const cap9 = window.__sdyAiBridge.capture();
  window.__sdyAiBridge.apply([
    { cmd: 'rp', id: 'title-box', find: '전', repl: '후' },
    { cmd: 'st', id: 'title-box', style: 'fs=30' },
  ], cap9.revision);
  await wait(300);
  document.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'z', ctrlKey: true, bubbles: true, cancelable: true,
  }));
  await wait(400);
  check('새 명령 묶음도 Ctrl+Z 한 번으로 되돌아간다',
    window.findEl(0, 'title-box').html === '되돌리기 전'
    && window.findEl(0, 'title-box').fontSize === 22,
    JSON.stringify({ html: window.findEl(0, 'title-box').html, fs: window.findEl(0, 'title-box').fontSize }));

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
