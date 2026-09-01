// 홈 두 줄/클래식 새 노트 버튼 + 큰 플레이어 진행바 검증
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../sdynotes.css', import.meta.url), 'utf8');
const fullHtml = html.includes('<script src="sdynotes.js')
  ? html.replace(/<script src="sdynotes\.js(?:\?[^"]*)?"[^>]*><\/script>/, '<script>' + js + '</script>')
  : html;
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', error => {
  if (!/Could not load (script|link|style)/.test(error.message)) errors.push(error);
});

const dom = new JSDOM(fullHtml, {
  url: 'http://sdynotes.test/',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.fetch = async () => new Response(JSON.stringify({ tracks: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    window.confirm = () => false; window.prompt = () => null; window.alert = () => {};
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    window.IntersectionObserver = class { observe() {} disconnect() {} };
    window.ResizeObserver = class { observe() {} disconnect() {} };
    window.HTMLCanvasElement.prototype.getContext = () => ({
      setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {},
      stroke() {}, moveTo() {}, lineTo() {}, save() {}, restore() {}, translate() {},
      scale() {}, rotate() {}, fillText() {},
    });
    window.HTMLElement.prototype.scrollTo = function scrollTo(options) {
      this.scrollTop = (typeof options === 'object' ? options.top : options) || 0;
    };
    window.HTMLMediaElement.prototype.play = function play() {
      this.dispatchEvent(new window.Event('play')); return Promise.resolve();
    };
    window.HTMLMediaElement.prototype.pause = function pause() {
      this.dispatchEvent(new window.Event('pause'));
    };
    window.HTMLMediaElement.prototype.load = function load() {};
    // 17.4 테스트용 로컬 노트 2개 (SB 없음 → localStorage 홈)
    window.localStorage.setItem('sdy_local_nbs', JSON.stringify([
      { id: 'local_a1', title: '라멘 노트', color: '#4f6ef7',
        created_at: '2026-08-20T01:00:00.000Z', updated_at: '2026-08-20T01:00:00.000Z' },
      { id: 'local_b2', title: '떡볶이 노트', color: '#e74c3c',
        created_at: '2026-08-21T01:00:00.000Z', updated_at: '2026-08-21T01:00:00.000Z' },
    ]));
  },
});

await new Promise(resolve => setTimeout(resolve, 300));
const { window } = dom;
const { document } = window;
assert.equal(errors.length, 0, errors.map(e => e.stack).join('\n'));

// ── ① 홈 스택: 최근 노트가 없으면 (첫 화면) 종전 구조 — 버튼은 스택 바로 위 ──
let grid = document.getElementById('noteGrid');
let area = grid.querySelector('.home-stack-area');
assert.ok(area, 'home-stack-area 있어야 한다');
assert.ok(!area.classList.contains('has-recent'), '처음에는 has-recent 아니어야 한다');
assert.ok(area.querySelector('.home-add-zone .home-add-note'), '클래식 새 노트 버튼이 있다');
assert.equal(area.querySelectorAll('.note-stack .note-card').length, 2, '스택(덩어리)에 노트 2장');
// 첫 화면(has-recent 없음)에서도 스택 폴더 썸은 노트 미리보기와 같은 높이를 쓴다.
// 고정 260px 이 body.card-l(322) / body.card-s(200) 보다 특이도로 이기면
// 폴더가 세로로 짧아지고 노트가 폴더 밖으로 튀어 보인다.
assert.ok(!/\.note-stack\s+\.folder-card\s+\.folder-thumb\s*\{[^}]*height:\s*260px/.test(css),
  '스택 폴더 썸을 260px 로 고정하지 않는다');
assert.match(css, /body\.card-s\s+\.note-preview\s*,\s*body\.card-s\s+\.folder-thumb\s*\{[^}]*height:\s*200px/,
  '작은 카드에서 노트 미리보기와 폴더 썸 높이가 같다');
assert.match(css, /body\.card-l\s+\.note-preview\s*,\s*body\.card-l\s+\.folder-thumb\s*\{[^}]*height:\s*322px/,
  '큰 카드에서 노트 미리보기와 폴더 썸 높이가 같다');
assert.match(css, /\.home-stack-area\.has-recent\s+\.note-preview\s*,\s*\.home-stack-area\.has-recent\s+\.folder-thumb\s*\{[^}]*height:calc\(var\(--home-card-w,200px\)\s*\*\s*1\.3\)!important/,
  '최근 줄이 생기면 노트·폴더 높이를 --home-card-w 로 같이 맞춘다');
assert.ok(!css.includes('새 노트는 여기서 만들어요'), '불필요한 새 노트 안내 문구가 없다');
assert.ok(!js.includes('home-scroll-hint'), '위로 올리라는 팝업 힌트가 없다');

// ── ② 노트를 열고 닫아 '최근'을 만든 뒤 홈 재진입 → has-recent 화면 ──
const card = area.querySelector('.note-stack .note-card');
card.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await new Promise(resolve => setTimeout(resolve, 250));
assert.ok(document.getElementById('editorView').classList.contains('open'), '노트가 열려야 한다');
window.closeEditor();
await new Promise(resolve => setTimeout(resolve, 800));   // closeEditor → 400ms → loadNBs → renderGrid
area = document.getElementById('noteGrid').querySelector('.home-stack-area');
assert.ok(area, '재진입 후에도 home-stack-area');
assert.ok(area.classList.contains('has-recent'), '최근 줄이 있으면 has-recent');
assert.ok(area.querySelector('.home-add-zone .home-add-note'), '휠 한 칸 위에 놓일 클래식 새 노트 버튼이 있다');
assert.equal(area.querySelectorAll('.recent-row .note-card').length, 1, '이미 본 노트는 아래 최근 줄에');
assert.equal(area.querySelectorAll('.note-stack .note-card').length, 1, '안 본 노트는 위 더미 한 줄에 남는다');
assert.match(area.style.getPropertyValue('--home-rows-h'), /^\d+px$/, '두 줄 높이를 화면에 맞춰 계산한다');
assert.match(area.style.getPropertyValue('--home-card-w'), /^\d+px$/, '두 줄 카드 폭을 자동 계산한다');
assert.match(css, /\.home-stack-area\.has-recent \.stack-scene,\s*\.home-stack-area\.has-recent \.recent-section\s*\{[^}]*height:calc\(var\(--home-rows-h,680px\) \/ 2\)/s,
  '안 본 더미와 이미 본 줄은 정확히 같은 두 줄 높이를 쓴다');

// 17.7 · 최근 줄은 그림자 여유(패딩)를 키운 만큼 음수 마진으로 흐름 높이를
// 되돌린다. 그래서 '줄 높이 + 위 마진 + 아래 마진 = 줄에 배정된 높이' 가
// 항상 성립해야 두 줄 레이아웃이 1px 도 움직이지 않는다.
{
  const px = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  const rowEl = area.querySelector('.recent-row');
  const rcs = window.getComputedStyle(rowEl);
  const rowH = px(area.style.getPropertyValue('--home-row-h'));
  const rowsH = px(area.style.getPropertyValue('--home-rows-h'));
  const sec = area.querySelector('.recent-section');
  const secPT = px(window.getComputedStyle(sec).paddingTop);
  const titleEl = sec.querySelector('.recent-title');
  const titleH = (titleEl && window.getComputedStyle(titleEl).display !== 'none') ? px(titleEl.offsetHeight) : 0;
  const flow = rowH + px(rcs.marginTop) + px(rcs.marginBottom);
  assert.ok(rowH > 0, '줄 높이(--home-row-h)가 계산되어 있다');
  // jsdom 은 계산 패딩·마진을 0 으로 주므로, 이 검증은 'JS 가 CSS 값을 읽어서
  // 그대로 썼는지(상수를 다시 쓰지 않는지)'를 본다. 실제 값(18/34/64 · -14/-68)은
  // editor_table_contract.mjs 가 CSS 원문에서 확인한다.
  assert.equal(flow, Math.round(rowsH / 2 - secPT - titleH),
    `줄의 흐름 높이는 배정된 높이와 같다 (row=${rowH} mt=${rcs.marginTop} mb=${rcs.marginBottom} → ${flow})`);
}

// ── ③ 큰 플레이어 진행바: window 추적 드래그 ──
const big = document.getElementById('mpBig');
big.classList.add('open');
const A = window.sdyMusic.audio();
Object.defineProperty(A, 'duration', { configurable: true, value: 200 });
const bar = document.getElementById('mpBProg');
const fill = document.getElementById('mpBFill');
// jsdom 의 rect 는 전부 0 — 실제 좌표를 흉내 낸다
const RECT = { left: 100, top: 10, width: 200, height: 8, right: 300, bottom: 18, x: 100, y: 10 };
bar.getBoundingClientRect = () => ({ ...RECT });
const r = RECT;
const fire = (target, type, x) => {
  const ev = new window.MouseEvent(type, {
    bubbles: true, cancelable: true, view: window,
    clientX: x, clientY: r.top + 2,
  });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  target.dispatchEvent(ev);
};
// 포인터 캡처가 없는 환경(jsdom)에서도 window 리스너가 잡아야 한다
fire(bar, 'pointerdown', r.left + r.width * 0.1);
fire(window, 'pointermove', r.left + r.width * 0.7);   // 옆으로 크게 이동
let pct = parseFloat(fill.style.width);
assert.ok(pct > 60 && pct < 80, `드래그 중 채움≈70%여야 한다 (실제 ${pct}%)`);
fire(window, 'pointerup', r.left + r.width * 0.7);
assert.ok(Math.abs(A.currentTime - 140) < 2, `놓으면 위치 확정 (실제 ${A.currentTime}s)`);
assert.ok(!bar.classList.contains('seeking'), 'seeking 클래스는 해제');

// ── ④ 진행바 위 더블클릭이 전체 화면을 풀지 않는다 ──
big.classList.add('mpb-fs');
bar.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
assert.ok(big.classList.contains('mpb-fs'), '진행바 dblclick 에는 전체화면 유지');
// (반대로 빈 스테이지 dblclick 은 종전대로 해제 — 여기서는 검증만)
window.sdyMusic.audio().pause();

// ── ⑤ 로그인 모달: 아이콘이 살아있는 버튼 ──
const verifyBtn = document.getElementById('saVerifyBtn');
assert.ok(verifyBtn.querySelector('i'), '확인하고 로그인 버튼에 아이콘');
const resend = document.getElementById('saResend');
assert.ok(resend.querySelector('i'), '코드 다시 받기 버튼에 아이콘');

// ── ⑥ 엽스코드 빈 채팅 안내: 입장하면 누가 들어왔다는 시스템 메시지가 바로 생겨서
//      빈 상태 해돌이는 보일 일이 없으므로 두지 않는다 (환영 문구만) ──
const emptyEl = document.getElementById('ypEmpty');
assert.ok(emptyEl && emptyEl.textContent.includes('엽스코드에 오신 걸 환영해요'), '빈 채팅 안내에 환영 문구가 있다');
assert.ok(!emptyEl.querySelector('.yp-otter'), '빈 채팅 안내에 해돌이가 없다');
assert.ok(!/🌶️/.test(emptyEl.textContent), '고추 이모지는 없다');

console.log('홈 두 줄 계약: PASS (클래식 새 노트 버튼 · 자동 크기 · 큰 플레이어 시크 · 로그인 버튼 · 엽스코드 빈 채팅 안내)');
dom.window.close();
// jsdom 의 남은 rAF/타이머가 close() 뒤에 깨어나며 터지는 것을 막는다
process.exit(0);
