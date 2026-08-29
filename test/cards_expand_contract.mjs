/* 15.0 · 암기 카드 확장 모드(사이트 안 가득) 계약
   ---------------------------------------------------------------------------
   1) 확장은 브라우저 Fullscreen API 가 아니다 — 창이 뷰포트 단위 css 로만 커진다.
      (공부 중 다른 탭을 왔다 갔다 하는 흐름을 깨지 않기 위해서다.)
   2) 펼침 아이콘은 음악플레이어 전체화면과 같은 ri-fullscreen-line / exit 으로 바뀐다.
   3) 창↔확장은 transition 모핑(.fcard-anim)으로 부드럽게 이어진다.
   4) 확장에서 나올 때는 진입 전 창 위치로 돌아온다 (음악플레이어 mpbFakeFs 와 같은 방식).
   5) Esc = 확장이 먼저 접히고, F = 확장/원래대로, 뒤집기 카드 1·2 = 아직/알아요.
   6) 확장 중엔 드래그·바깥 클릭 닫힘·창 위치 보정이 멈춘다 (전체화면 관례와 동일).
   7) 확장 모드에만 세션 칩(정답률·시간)과 키보드 안내가 붙는다.
   다루지 않은 기존 계약(열기 위치·드래그 경계)은 그대로 둔다. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../sdynotes.css', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');

/* ── 정적 계약 ─────────────────────────────────────────────────────────── */
assert.match(html,
  /<button id="fcardMaxBtn"[^>]*title="사이트 안에서 크게 보기 \(F\)"[^>]*><i class="ri-fullscreen-line"><\/i><\/button>/,
  '머리말에 음악플레이어와 같은 펼침 아이콘(ri-fullscreen-line) 버튼이 있어야 한다');
assert.match(html, /<span id="cdSessAcc" class="cd-chip"/,
  '확장 모드 세션 칩(정답률) 자리가 있어야 한다');
assert.match(html, /<span id="cdSessTime" class="cd-chip"/,
  '확장 모드 세션 칩(공부 시간) 자리가 있어야 한다');
assert.match(html, /<div class="cd-keyhints"/,
  '확장 모드 키보드 안내 자리가 있어야 한다');

assert.match(css, /\.fcard-win\.fcard-anim\{[^}]*transition:[^}]*left \.52s[^}]*top \.52s[^}]*width \.52s[^}]*height \.52s/,
  '확장 모핑은 left/top/width/height 전환이 있어야 한다 (음악플레이어 .mpb-anim 과 같은 곡선)');
assert.match(css, /\.fcard-win\.fcard-max\{[^}]*left:0!important[^}]*top:0!important[^}]*width:var\(--fcard-max-w,calc\(100vw\)\)!important[^}]*height:var\(--fcard-max-h,calc\(100dvh\)\)!important/,
  '확장 틀은 실측 뷰포트(--fcard-max-w/h)로 모니터를 빈틈없이 채워야 한다 (100vw/100dvh 의 배율·스크롤바 어긋남을 없앰)');
assert.match(css, /\.fcard-win\.fcard-max #cardsStudy \.cd-sess\{display:inline-flex;\}/,
  '세션 칩은 확장 모드 + 학습 화면에서만 보여야 한다');
assert.match(css, /@media \(max-width:640px\)[^{]*\{[^}]*\.fcard-win\.fcard-max\{[^}]*left:0!important[^}]*width:100vw!important/,
  '폰에서는 여백 없이 정말 꽉 차야 한다');
assert.doesNotMatch(css, /\.fcard-win[^{,]*:fullscreen/,
  '암기 카드는 진짜 Fullscreen css 를 쓰면 안 된다 (사이트 안 확장이어야 한다)');
assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^}]*\.fcard-win\.fcard-anim\{transition:none/,
  '움직임 줄이기에서는 모핑이 꺼져야 한다');

assert.match(js, /function fcardMaxSet\(on\)\{/,
  'fcardMaxSet 이 정의돼 있어야 한다');
assert.match(js, /function _fcardMaxFill\(\)\{[\s\S]{0,300}sdyViewportBox/,
  '확장 크기는 창 이동범위와 같은 실측(sdyViewportBox)으로 재야 한다');
const maxSetBody = (js.match(/function fcardMaxSet\(on\)\{[\s\S]*?\n    \}\n/) || [''])[0];
assert.ok(maxSetBody.length > 100, 'fcardMaxSet 본문을 잘라 낼 수 있어야 한다');
assert.ok(!/requestFullscreen|webkitRequestFullscreen/.test(maxSetBody),
  'fcardMaxSet 본문에 Fullscreen API 호출이 없어야 한다');
assert.ok(!/requestFullscreen|webkitRequestFullscreen/.test(
  (js.match(/function fcardToggleMax\([\s\S]*?\n    \}\n/) || [''])[0]),
  'fcardToggleMax 에도 Fullscreen API 호출이 없어야 한다');

assert.match(js, /ri-fullscreen-exit-line[\s\S]{0,80}ri-fullscreen-line/,
  '아이콘은 음악플레이어처럼 line ↔ exit-line 으로 바뀌어야 한다');
assert.match(js, /if\(_fcardMax\) return;[\s\S]{0,80}const r=win\.getBoundingClientRect\(\)/,
  '확장 중엔 머리말 드래그가 멈춰야 한다');
assert.match(js, /if\(_fcardMax\) return;[\s\S]{0,120}\/\* rect 는 화면 px/,
  '확장 중엔 창 위치 보정(resize)이 멈춰야 한다');
assert.match(js, /if\(_fcardMax\) return;[\s\S]{0,80}if\(e\.target\.closest\('#cardsModal'\)\) return;/,
  '확장 중엔 바깥 클릭 닫힘이 멈춰야 한다');
assert.match(js,
  /if\(e\.key==='Escape'\)\{[\s\S]{0,200}if\(_fcardMax\)\{ fcardMaxSet\(false\); return; \}/,
  'Esc 는 확장 해제가 가장 먼저여야 한다');
assert.match(js, /if\(e\.key==='f'\|\|e\.key==='F'\)\{[\s\S]{0,120}fcardToggleMax\(\)/,
  'F 키는 확장/원래대로 토글이어야 한다');
assert.match(js, /_flipped&&!_answered&&\(e\.key==='1'\|\|e\.key==='2'\)[\s\S]{0,80}flipGrade/,
  '뒤집기 카드는 1=아직이에요 · 2=알아요 키가 있어야 한다');
assert.match(js, /if\(_isTest\) aEl\.innerHTML='<i class="ri-edit-line"><\/i>제출 '/,
  '시험 중 세션 칩은 정답률 대신 제출 수만 보여야 한다 (정오를 새면 안 된다)');

/* ── 런타임 계약 ───────────────────────────────────────────────────────── */
const fullHtml = html.replace(/<script src="sdynotes\.js(?:\?[^"]*)?"[^>]*><\/script>/,
  '<script>' + js + '</script>');
const vc = new VirtualConsole();
vc.on('jsdomError', error => {
  if (!/Could not load (script|link|style)/.test(error.message)) {
    process.stderr.write('jsdom: ' + error.message + '\n');
  }
});

const dom = new JSDOM(fullHtml, {
  url: 'http://sdynotes.test/',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.fetch = async () => new Response(JSON.stringify({ tracks: [], decks: [], ok: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    window.confirm = () => false;
    window.prompt = () => null;
    window.alert = () => {};
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    window.IntersectionObserver = class { observe() {} disconnect() {} };
    window.ResizeObserver = class { observe() {} disconnect() {} };
    window.HTMLCanvasElement.prototype.getContext = () => ({
      setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {},
      stroke() {}, moveTo() {}, lineTo() {}, save() {}, restore() {}, translate() {},
      scale() {}, rotate() {}, fillText() {},
    });
    window.HTMLMediaElement.prototype.play = function play() {
      this.dispatchEvent(new window.Event('play'));
      return Promise.resolve();
    };
    window.HTMLMediaElement.prototype.pause = function pause() {
      this.dispatchEvent(new window.Event('pause'));
    };
    window.HTMLMediaElement.prototype.load = function load() {};
  },
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
await wait(300);
const { window } = dom;
const { document } = window;

/* 1) 창을 열고 — 첫 위치 저장 */
document.querySelector('button[title="암기 카드"]').click();
await wait(80);
const modal = document.getElementById('cardsModal');
const win = document.querySelector('#cardsModal .fcard-win');
const maxBtn = document.getElementById('fcardMaxBtn');
assert.equal(modal.style.display, 'flex', '암기 카드 창이 열여야 한다');
assert.ok(maxBtn, '펼침 버튼이 있어야 한다');
assert.ok(/ri-fullscreen-line/.test(maxBtn.innerHTML), '처음 아이콘은 펼침');
const pre = { x: parseFloat(win.style.left), y: parseFloat(win.style.top) };
assert.ok(isFinite(pre.x) && isFinite(pre.y), '열린 창 위치가 인라인으로 잡혀 있어야 한다');
assert.ok(!win.classList.contains('fcard-max'), '처음엔 확장 클래스가 없어야 한다');
assert.equal(document.fullscreenElement || null, null, 'Fullscreen API 는 전혀 쓰지 않는다');

/* 2) 펼치기 — 클래스만 붙고, 아이콘이 바뀌고, 자리를 기억한다 */
maxBtn.click();
await wait(140);                       // rAF × 2 까지 기다린다
assert.ok(win.classList.contains('fcard-max'), '펼치면 fcard-max 가 붙어야 한다');
assert.ok(win.classList.contains('fcard-anim'), '모핑 transition 클래스가 잠깐 붙어야 한다');
assert.ok(/ri-fullscreen-exit-line/.test(maxBtn.innerHTML), '펼친 뒤 아이콘은 접힘(exit)');
assert.ok(/원래 크기로/.test(maxBtn.title), '펼친 뒤 툴팁도 바뀌어야 한다');
assert.equal(document.fullscreenElement || null, null, '펼쳐도 Fullscreen 은 켜지지 않는다');
assert.equal(modal.style.display, 'flex', '모달은 그대로 열린 상태다 (사이트 안 확장)');

/* 3) 다시 눌러 원래대로 — 클래스가 빠지고 진입 전 자리로 돌아온다 */
maxBtn.click();
await wait(160);
assert.ok(!win.classList.contains('fcard-max'), '원래대로 누륨면 fcard-max 가 빠져야 한다');
assert.ok(/ri-fullscreen-line/.test(maxBtn.innerHTML), '접힌 뒤 아이콘은 다시 펼침');
const back = { x: parseFloat(win.style.left), y: parseFloat(win.style.top) };
assert.ok(Math.abs(back.x - pre.x) <= 2 && Math.abs(back.y - pre.y) <= 2,
  `확장에서 나오면 진입 전 위치로 복원(진입 ${JSON.stringify(pre)} → 복원 ${JSON.stringify(back)})`);

/* 4) F 키 토글 */
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true }));
await wait(140);
assert.ok(win.classList.contains('fcard-max'), 'F 키로도 펼쳐져야 한다');

/* 5) Esc = 확장이 먼저 접힌다 (창은 닫히지 않는다) */
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
await wait(80);
assert.ok(!win.classList.contains('fcard-max'), 'Esc 는 확장부터 접어야 한다');
assert.equal(modal.style.display, 'flex', 'Esc 한 번에 창까지 닫히면 안 된다 (한 단계씩)');
const back2 = { x: parseFloat(win.style.left), y: parseFloat(win.style.top) };
assert.ok(Math.abs(back2.x - pre.x) <= 2 && Math.abs(back2.y - pre.y) <= 2,
  'Esc 로 접어도 진입 전 위치로 복원돼야 한다');

/* 6) 확장 상태는 열고 닫아도 유지된다 (세션 기억) */
maxBtn.click();
await wait(140);
assert.ok(win.classList.contains('fcard-max'), '다시 펼쳐져 있어야 한다');
win.querySelector('.fcard-head .cards-x:last-child').click();   // 작게 접기(창 닫기)
await wait(320);                                                // 닫힘 애니메이션(240ms) 포함
assert.equal(modal.style.display, 'none', '창이 닫혀야 한다');
document.querySelector('button[title="암기 카드"]').click();
await wait(80);
assert.equal(modal.style.display, 'flex', '다시 열여야 한다');
assert.ok(win.classList.contains('fcard-max'), '다시 열어도 확장 모양이 유지돼야 한다');
assert.ok(/ri-fullscreen-exit-line/.test(maxBtn.innerHTML), '아이콘도 유지돼야 한다');

dom.window.close();
console.log('cards expand contract: ok');
