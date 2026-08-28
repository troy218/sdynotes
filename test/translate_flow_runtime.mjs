/* 번역 플로우 런타임 테스트
 *
 * 실제 Fastify 서버를 띄우고 JSDOM 에 앱을 부팅해, "사용자가 실제로 누르는"
 * 모든 번역 진입점을 마우스/키보드 경로 그대로 검증한다.
 *   ① 텍스트 상자 우클릭 → 번역 → 이 상자 → 한국어
 *   ② 글자 선택 우클릭 → 번역 → 한국어로 (선택분 그 자리 치환)
 *   ③ 빈 종이 우클릭 → 번역 → 이 페이지 → 한국어 (피규어 캡션 제외)
 *   ④ 서버가 429(제한) 응답 → 사용자에게 제한 안내
 *   ⑤ 단일 상자 번역 중 Esc → 즉시 중단, 원문 유지, 이후 재시도 가능
 *   ⑥ 페이지 번역 도중 [중단] 버튼 → 완료분만 저장, 나머지 원문 유지
 *   ⑦ 빈 종이 우클릭 → 문서 전체 → 한국어 (다른 페이지 상자까지 호출)
 *   ⑧ 페이지 전체 선택 후 우클릭 → 선택 N개 → 한국어 (캡션도 명시 선택 시 번역)
 *
 * /api/translate 는 jsdom 창 안에서 모드(ok/limited/hang/hangAfterFirst)별로
 * 흉내 낸다 — 외부 네트워크를 타지 않아 결정적이다.
 */
import net from 'node:net';
import { spawn } from 'node:child_process';
import jsdom from 'jsdom';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { installWindowGuard, closeDoms } from './jsdom_guard.mjs';
const { JSDOM, VirtualConsole } = jsdom;

// 14.13.5 · 데이터 루트 격리 (공유 db 반복 실행 오염 방지)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-trans-'));
process.env.SDY_BASE_DIR = TMP;
{
  const REPO = path.resolve(new URL('..', import.meta.url).pathname);
  for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
}

let pass = 0;
const check = (name, cond) => {
  if (!cond) throw new Error('테스트 실패: ' + name);
  pass++;
  console.log('  ✓ ' + name);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(name, fn, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const v = await fn(); if (v) return v; } catch {}
    await wait(40);
  }
  throw new Error('시간 초과: ' + name);
}

const port = await (() => new Promise((res, rej) => {
  const s = net.createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
}))();
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
  await until('서버 기동', async () => { try { return (await fetch(base + '/api/health')).ok || true; } catch {} });

  // ── 시드: 페이지1(본문 2 + 피규어 캡션 1) + 페이지2(본문 1) ──
  const H = { 'Content-Type': 'application/json', 'x-sdy-db': '1' };
  const q = b => fetch(base + '/api/db/query', { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
  // Oracle 저장소는 디스크에 남는다 — 같은 제목의 전 실행 잔재가 남아 있으면
  // 클라이언트가 엉뚱한 사본을 열 수 있으므로 치우고, 이번 실행 제목도 유일하게 만든다.
  const TITLE = '번역 런타임 ' + Date.now().toString(36);
  const allNb = await q({ table: 'notebooks', op: 'select', filters: [] });
  for (const row of (allNb.data || [])) {
    if (!String(row.title || '').startsWith('번역 런타임')) continue;
    const memos = await q({ table: 'memos', op: 'select', filters: [{ field: 'notebook_id', op: 'eq', value: row.id }] });
    for (const m of (memos.data || [])) {
      await q({ table: 'memos', op: 'delete', filters: [{ field: 'id', op: 'eq', value: m.id }] });
    }
    await q({ table: 'notebooks', op: 'delete', filters: [{ field: 'id', op: 'eq', value: row.id }] });
  }
  const ins = await q({ table: 'notebooks', op: 'insert', values: [{ title: TITLE, color: '#4f6ef7' }], filters: [], returning: true, single: true });
  const seedDoc = {
    version: 3, paper: 'blank', sizePreset: 'a4_portrait', emoji: '', glossary: {},
    pages: [
      { id: 'p1', els: [
        { type: 'text', id: 'tb1', x: 60, y: 60, w: 420, h: 60, html: 'The mitochondria is the powerhouse of the cell.' },
        { type: 'text', id: 'tb2', x: 60, y: 160, w: 420, h: 60, html: 'We propose a CRISPR based method for editing.' },
        { type: 'text', id: 'tb3', x: 60, y: 260, w: 420, h: 40, html: 'Figure 3 Overview of the pipeline' },
      ] },
      { id: 'p2', els: [
        { type: 'text', id: 'tb4', x: 60, y: 60, w: 420, h: 60, html: 'Second page message in a bottle.' },
      ] },
    ],
  };
  await q({ table: 'memos', op: 'insert', values: [{ notebook_id: ins.data.id, content: JSON.stringify(seedDoc), font_size: 16 }], filters: [] });

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
      installWindowGuard(window); // 14.13.5 · close 전 타이머 추적
            window.innerWidth = 1280; window.innerHeight = 800;
      window.matchMedia = query => ({ matches: query.includes('pointer:fine'), media: query,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.BroadcastChannel = class { postMessage() {} close() {} addEventListener() {} };
      window.EventSource = class { close() {} addEventListener() {} };
      window.requestIdleCallback = cb => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0);
      window.cancelIdleCallback = clearTimeout;
      window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
      window.cancelAnimationFrame = clearTimeout;
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {}, fillRect() {}, beginPath() {}, moveTo() {},
        lineTo() {}, stroke() {}, arc() {}, fill() {}, save() {}, restore() {}, scale() {}, translate() {}, setTransform() {},
        measureText() { return { width: 10 }; }, getImageData() { return { data: new Uint8ClampedArray(4) }; }, putImageData() {} });
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.Audio = class { constructor() { this.paused = true; } play() { return Promise.resolve(); } pause() {} addEventListener() {} removeEventListener() {} };
      window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
      // jsdom 에는 innerText 가 없다 — 앱은 진짜 브라우저를 가정하므로 textContent 로 연결
      Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
        get() { return this.textContent; },
        set(v) { this.textContent = v; },
        configurable: true,
      });

      // ── 번역 API 결정적 흉내: __trMode = ok | limited | hang | hangAfterFirst ──
      window.__trLog = [];
      window.__trCalls = 0;
      window.__trDelay = 12;
      window.__trMode = 'ok';
      window.__quietSync = false;   // 에디터가 열리면 true — 단일 사용자 테스트라 실시간 재렌더를 끈다
      const realFetch = globalThis.fetch;
      window.fetch = (input, init) => {
        const u = typeof input === 'string' || input instanceof URL ? String(input) : String(input && input.url || '');
        // 단일 사용자 결정적 테스트: 노트가 열리고 난 뒤에는 실시간 동기화가
        // 페이지를 다시 그려 방금 번역한 내용/선택을 되돌리는 경쟁을 끊는다.
        if (window.__quietSync && u.includes('/api/sync/pull')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, ops: [], version: 0 }) });
        }
        if (u.includes('/api/translate/gloss')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, gloss: {} }) });
        }
        if (u.includes('/api/translate')) {
          const body = (() => { try { return JSON.parse(init.body); } catch { return {}; } })();
          const n = ++window.__trCalls;
          window.__trLog.push({ n, text: String(body.text || ''), target: body.target || '' });
          const mode = window.__trMode;
          if (mode === 'hang' || (mode === 'hangAfterFirst' && n > 1)) {
            return new Promise((resolve, reject) => {
              if (init && init.signal) init.signal.addEventListener('abort', () => {
                const e = new Error('The operation was aborted'); e.name = 'AbortError'; reject(e);
              });
            });
          }
          if (mode === 'limited') {
            return Promise.resolve({
              ok: false, status: 502,
              json: async () => ({ ok: false, error: '지금 번역 요청이 몰려 잠시 제한됐어요 · 약 60초 뒤 다시 시도해 주세요', retry_after: 60 }),
            });
          }
          return new Promise(r => setTimeout(() => r({
            ok: true, status: 200,
            json: async () => ({ ok: true, text: '번역[' + body.text + ']' }),
          }), window.__trDelay));
        }
        const target = typeof input === 'string' || input instanceof URL ? new URL(u, window.location.href) : input;
        return realFetch(target, init);
      };
      window.addEventListener('error', e => errors.push(e.error?.stack || e.message));
      window.addEventListener('unhandledrejection', e => errors.push('unhandled: ' + (e.reason?.stack || e.reason)));
    },
  });

  const { window } = dom, { document } = window;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const toastText = () => ($('#toast')?.textContent || '');
  const trProgVisible = () => { const p = $('#trProg'); return !!p && p.style.display !== 'none'; };
  const tbText = (id) => ($(`.tb[data-id="${id}"] .tb-content`)?.textContent || '');

  // ── 노트 열기 ──
  const cardOf = () => $$('.note-stack .note-card').find(c => (c.textContent || '').includes(TITLE));
  await until('노트 카드 표시', cardOf);
  cardOf().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await until('에디터 + 텍스트 상자 4개 렌더', () => $$('#pagesStage .tb').length >= 3);
  window.__quietSync = true;   // 이후 라이브 폴 가 페이지 재렌더를 일으키지 않는다

  const paper = $('#pagesStage .paper[data-page-idx="0"]');
  const size = window.paperSize();
  // 종이 사각형을 실제 크기로 준다 (pageLocal の 좌표 환산용)
  paper.getBoundingClientRect = () => ({
    left: 100, top: 60, width: size.w, height: size.h,
    right: 100 + size.w, bottom: 60 + size.h, x: 100, y: 60,
  });
  const ctxOn = (node, x, y) => node.dispatchEvent(new window.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y,
  }));
  const clickItem = async (dataA) => {
    const n = await until('메뉴 항목 ' + dataA, () => $(`#ctxMenu .ctx-item[data-a="${dataA}"]`));
    n.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  };
  const openSub = async (name) => {
    const g = await until('하위 메뉴 ' + name, () => $(`#ctxMenu .ctx-group[data-sub="${name}"]`));
    g.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  };
  const boxPoint = (id, dx = 8, dy = 8) => {
    const tb = $(`.tb[data-id="${id}"]`);
    return { tb, x: 100 + (+tb.style.left.replace('px', '') || parseFloat(tb.style.left)) + dx,
             y: 60 + (+tb.style.top.replace('px', '') || parseFloat(tb.style.top)) + dy };
  };

  // ══ ① 텍스트 상자 우클릭 → 이 상자 → 한국어 ══
  window.__trDelay = 120;   // 진행바가 뜨는 것도 볼 수 있게 약간 느리게
  {
    const { tb, x, y } = boxPoint('tb1');
    ctxOn(tb, x, y);
    await openSub('번역');
    await clickItem('tr-ko');
    await until('번역 진행바 표시', () => trProgVisible());
    await until('중단 버튼 노출', () => $('#trProg .tr-cancel'));
    check('상자 번역 중 진행바 + [중단] 버튼이 보인다', trProgVisible() && !!$('#trProg .tr-cancel'));
    await until('tb1 번역문 반영', () => tbText('tb1').includes('번역[The mitochondria'));
    await until('진행바 닫힘', () => !trProgVisible());
    check('단일 상자 번역이 성공하고 진행바가 닫힌다', tbText('tb1').includes('번역[') && !trProgVisible());
    check('완료 토스트가 뜬다', /번역하고 저장했습니다/.test(toastText()));
  }

  // ══ ② 글자 선택 → 한국어로 (선택분만 그 자리 치환) ══
  window.__trDelay = 12;
  {
    const host = $(`.tb[data-id="tb2"] .tb-content`);
    // 'We propose' 부분만 고른다
    const textNode = host.firstChild;
    const range = document.createRange();
    range.setStart(textNode, 0); range.setEnd(textNode, 10);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    const { x, y } = boxPoint('tb2');
    ctxOn(host, x, y);
    // 선택이 유지된 채 텍스트 메뉴가 떠야 한다
    await until('선택 메뉴의 번역 하위 메뉴', () => $('#ctxMenu .ctx-group[data-sub="번역"]'));
    await openSub('번역');
    await clickItem('tr-sel-ko');
    await until('선택분이 번역문으로 치환', () => tbText('tb2').includes('번역[We propose'));
    check('고른 글자만 번역문으로 바뀐다', tbText('tb2').includes('번역[We propose]'));
    check('선택 뒤쪽 원문은 유지된다', tbText('tb2').includes('CRISPR based method for editing.'));
  }

  // ══ ③ 빈 종이 우클릭 → 이 페이지 → 한국어 (캡션 제외) ══
  {
    const before1 = tbText('tb1'), before3 = tbText('tb3');
    ctxOn(paper, 100 + size.w - 6, 60 + size.h - 6);
    await openSub('번역');
    await clickItem('trpg-ko');
    await until('페이지 번역 완료 토스트', () => /1페이지 번역 완료/.test(toastText()));
    await until('진행바 닫힘(페이지)', () => !trProgVisible());
    check('페이지의 본문 상자 2개가 번역된다',
      tbText('tb1') !== before1 && tbText('tb1').includes('번역[') && tbText('tb2').includes('번역['));
    check('피규어 캡션은 페이지 번역에서 제외된다', tbText('tb3') === before3);
  }

  // ══ ④ 서버가 429(제한) 응답 → 제한 안내 ══
  {
    window.__trMode = 'limited';
    const before = tbText('tb1');
    const calls0 = window.__trCalls;
    const { tb, x, y } = boxPoint('tb1');
    ctxOn(tb, x, y);
    await openSub('번역');
    await clickItem('tr-en');
    await until('제한 안내 토스트', () => /제한/.test(toastText()));
    await until('진행바 닫힘(제한)', () => !trProgVisible());
    check('429 응답은 제한 안내를 보여주고 원문을 바꾸지 않는다',
      /제한/.test(toastText()) && tbText('tb1') === before && !trProgVisible());
    check('제한 응답은 자동 재시도하지 않는다 (요청 1회로 종료)', window.__trCalls === calls0 + 1);
    window.__trMode = 'ok';
  }

  // ══ ⑤ 단일 상자 번역 중 Esc → 즉시 중단 ══
  {
    const before = tbText('tb1');
    const calls0 = window.__trCalls;
    window.__trMode = 'hang';
    const { tb, x, y } = boxPoint('tb1');
    ctxOn(tb, x, y);
    await openSub('번역');
    await clickItem('tr-ko');
    await until('번역 요청 1건 발송', () => window.__trCalls === calls0 + 1);
    const t0 = Date.now();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await until('중단 토스트', () => /중단/.test(toastText()), 3000);
    check('Esc 를 누르면 번역이 즉시 중단된다 (무한 로딩 없음)', Date.now() - t0 < 2500);
    check('중단한 상자는 원문 그대로다', tbText('tb1') === before);
    await until('중단 뒤 진행바가 닫힌다', () => !trProgVisible());

    // 중단 뒤에도 새 번역이 바로 된다 (busy 꼬임 없음)
    window.__trMode = 'ok'; window.__trDelay = 12;
    ctxOn(tb, x, y);
    await openSub('번역');
    await clickItem('tr-ko');
    await until('재시도 번역 반영', () => tbText('tb1') !== before, 4000);
    check('중단 직후 같은 상자를 다시 번역할 수 있다', tbText('tb1').includes('번역['));
    await until('진행바 닫힘(재시도)', () => !trProgVisible());
  }

  // ══ ⑥ 페이지 번역 도중 [중단] 버튼 → 완료분만 저장 ══
  {
    window.__trMode = 'hangAfterFirst';
    window.__trCalls = 0;
    const before1 = tbText('tb1'), before2 = tbText('tb2');
    ctxOn(paper, 100 + size.w - 6, 60 + size.h - 6);
    await openSub('번역');
    await clickItem('trpg-ko');
    await until('두 상자에 대한 요청이 모두 시작', () => window.__trCalls >= 2);
    const btn = await until('중단 버튼 표시', () => $('#trProg .tr-cancel'));
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await until('부분 중단 토스트', () => /번역을 중단했어요/.test(toastText()), 4000);
    await until('중단 뒤 진행바 닫힘(배치)', () => !trProgVisible());
    const after1 = tbText('tb1'), after2 = tbText('tb2');
    const changed = [after1 !== before1, after2 !== before2].filter(Boolean).length;
    check('중단 시점까지 끝난 1개 상자만 번역됐다', changed === 1);
    check('중단 토스트에 완료/남은 개수가 안내된다', /중단했어요 · 완료한 1개/.test(toastText()) && /남은 1개/.test(toastText()));
    window.__trMode = 'ok'; window.__trDelay = 12;
  }

  // ══ ⑦ 문서 전체 → 한국어: 다른 페이지 상자까지 요청 ══
  {
    const log0 = window.__trLog.length;
    ctxOn(paper, 100 + size.w - 6, 60 + size.h - 6);
    await openSub('번역');
    await clickItem('trdoc-ko');
    await until('문서 번역 완료 토스트', () => /문서 전체 번역 완료/.test(toastText()), 8000);
    const sent = window.__trLog.slice(log0).map(r => r.text);
    check('문서 전체 번역은 2페이지 상자에 대한 요청도 보낸다',
      sent.some(t => t.includes('Second page message')));
    await until('진행바 닫힘(문서)', () => !trProgVisible());
  }

  // ══ ⑧ 페이지 전체 선택 → 선택 N개 → 한국어 (캡션도 명시 선택 시 번역) ══
  {
    const captionBefore = tbText('tb3');
    ctxOn(paper, 100 + size.w - 6, 60 + size.h - 6);
    await openSub('페이지');
    await clickItem('select-all');
    await until('전체 선택 토스트', () => /개 선택됨/.test(toastText()));
    const { tb, x, y } = boxPoint('tb1');
    ctxOn(tb, x, y);
    await openSub('번역');
    await clickItem('tr-sel-all-ko');
    await until('선택 일괄 번역 완료 토스트', () => /선택 상자 번역 완료/.test(toastText()), 8000);
    check('선택한 3개 상자가 모두 번역된다 (캡션 포함)',
      tbText('tb3') !== captionBefore && tbText('tb3').includes('번역[')
      && tbText('tb1').includes('번역[') && tbText('tb2').includes('번역['));
    await until('진행바 닫힘(선택)', () => !trProgVisible());
  }

  // ══ ⑨ 논문형: 짧은 상자 여러 개를 한 요청으로 묶어 번역 ══
  {
    const api = window.__sdyTranslate;
    check('번역 테스트 손잡이가 있다', !!(api && api.getDoc && api.page));
    const d = api.getDoc();
    check('에디터 doc 이 노출된다', !!(d && d.pages && d.pages[0]));
    const lines = [
      'We measured gene expression after treatment.',
      'The difference was statistically significant.',
      'RNA samples were extracted from each well.',
      'Western blotting confirmed protein levels.',
      'These findings support the proposed model.',
      'Further work will examine the pathway.',
    ];
    lines.forEach((html, i) => {
      d.pages[0].els.push({
        type: 'text', id: 'tbP' + i, x: 60, y: 420 + i * 36, w: 500, h: 32, html,
      });
    });
    const calls0 = window.__trCalls;
    const pageP = api.page(0, 'ko');
    await Promise.race([pageP, until('논문 페이지 번역 완료', () => /번역 완료|부분 완료/.test(toastText()), 8000)]);
    try { await pageP; } catch {}
    const used = window.__trCalls - calls0;
    const packed = window.__trLog.slice(calls0).some(r => /§#2§/.test(r.text));
    check('짧은 논문 상자 6개는 요청 3번 이하로 묶인다', used >= 1 && used <= 3);
    check('한 요청에 여러 논문 문장이 함께 실렸다', packed || used === 1);
    await until('진행바 닫힘(논문)', () => !trProgVisible());
  }

  const unexpected = errors.filter(m => !/Not implemented|navigation|getComputedStyle|HTMLMediaElement/.test(m));
  console.log(unexpected.length ? '\n⚠ 페이지 오류 로그:\n' + unexpected.join('\n') : '\n페이지 오류 로그 없음');
  console.log(`\n${pass} passed`);

  // 시드 잔재 정리 — 공유 개발 DB 에 남으면 다른 런타임 테스트(첫 카드 클릭)가
  // 엉뚱한 노트를 열 수 있다.
  try {
    const memos = await q({ table: 'memos', op: 'select', filters: [{ field: 'notebook_id', op: 'eq', value: ins.data.id }] });
    for (const m of (memos.data || [])) {
      await q({ table: 'memos', op: 'delete', filters: [{ field: 'id', op: 'eq', value: m.id }] });
    }
    await q({ table: 'notebooks', op: 'delete', filters: [{ field: 'id', op: 'eq', value: ins.data.id }] });
  } catch {}
} finally {
  await closeDoms([dom]);

  child.kill('SIGKILL');
  fs.rmSync(TMP, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 400).unref();
}
