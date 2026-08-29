/* 17.4 · 음악 확장 플레이어 / 시간 오버레이 / 이퀄라이저 / 암기카드 배치 계약
   ---------------------------------------------------------------------------
   1) 진행바를 잡을 때 현재|전체 시간이 나타나도 막대가 아래로 밀리지 않는다.
      (#mpBTime 은 #mpBProg 안의 position:absolute 오버레이로만 보여야 한다.)
   2) 확장 플레이어와 암기카드는 첫 열 때 화면 가운데에 뜬다 (배율·브라우저와
      무관하게 공용 실측 sdyViewportBox 를 쓴다).
   3) 확장 플레이어 전체 화면에서 나올 때는 진입 전 창 위치로 돌아온다.
   4) 이퀄라이저 시각화는 저역을 과하게 키우지 않도록 로그 주파수+가중치를 쓴다.
   엽스코드의 여는 위치는 건드리지 않는다. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../sdynotes.css', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');

/* ── 정적 계약 ─────────────────────────────────────────────────────────── */
assert.match(html,
  /<div class="mpb-prog" id="mpBProg">\s*<div class="mpb-time" id="mpBTime">/,
  'mpBTime은 #mpBProg 안에 있어야 진행바를 밀지 않는다');

assert.match(css, /\.mpb-time\{[^}]*position:absolute/,
  'mpb-time은 진행바 안의 절대 위치 오버레이여야 한다');
assert.match(css, /\.mpb-time\{[^}]*bottom:calc\(100% \+ 8px\)/,
  'mpb-time은 진행바 바로 위(오버레이)에 떠야 한다');
assert.match(css, /\.mpb-time\.show\{[^}]*display:flex[^}]*\}\s*/,
  'mpb-time은 잡는 동안에만 보인다');
assert.doesNotMatch(css, /\.mpb-time\{[^}]*display:flex[^}]*/,
  'mpb-time 기본값은 레이아웃에서 빠진 display:none 이어야 한다');

assert.match(js, /if\(!isFinite\(x\)\)\{[\s\S]{0,240}vp\.w[\s\S]{0,240}if\(!isFinite\(y\)\)\{[\s\S]{0,200}vp\.h/,
  '확장 플레이어 첫 위치는 공용 실측으로 가로·세로 모두 가운데여야 한다');

assert.match(js, /function mpbFakeFs\(on\)\{[\s\S]{0,700}try\{ clampMpb\(\); \}catch\(e\)\{\}/,
  '전체 화면 진입 전에 창 위치를 확정해 저장해야 돌아올 자리가 남는다');
assert.match(js, /const p=_mpbPrePos\|\|_mpbSavedPos\(\)/,
  '전체 화면에서 나올 때 진입 전 위치(없으면 저장 위치)로 복원해야 한다');

assert.match(js, /function _fcardPlace\(win\)\{[\s\S]{0,1400}const hasSaved=!!\(p&&isFinite\(p\.x\)&&isFinite\(p\.y\)\)/,
  '암기카드 첫 열기는 저장 위치가 없을 때 공용 실측으로 가운데를 잡아야 한다');

assert.match(js, /const weight=Math\.min\(1\.15,0\.42\+0\.58\*Math\.sqrt\(f\/12000\)\)/,
  '이퀄라이저는 저역 에너지를 눌러주는 라우드니스 가중치를 써야 한다');
assert.match(js, /const f=lo\*Math\.pow\(hi\/lo,i\/\(n-1\)\)/,
  '이퀄라이저는 선형 대신 로그 주파수 축으로 읽어야 한다');

/* ── 런타임 계약 ───────────────────────────────────────────────────────── */
const fullHtml = html.includes('<script src="sdynotes.js')
  ? html.replace(/<script src="sdynotes\.js(?:\?[^\"]*)?\"[^>]*><\/script>/, '<script>' + js + '</script>')
  : html;
const vc = new VirtualConsole();
vc.on('jsdomError', error => {
  if (!/Could not load (script|link|style)/.test(error.message)) {
    // Runtime code is still exercised; keep the boot error visible for debugging.
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
    window.fetch = async () => new Response(JSON.stringify({ tracks: [], decks: [] }), {
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

await new Promise(resolve => setTimeout(resolve, 300));
const { window } = dom;
const { document } = window;
assert.ok(window.sdyMusic, 'music module should initialize');

const vp = window.sdyViewportBox();

/* 확장 플레이어: 첫 열기 = 화면 가운데 + 전체 화면 왕복 시 원위치 복원 */
const big = document.getElementById('mpBig');
window.sdyMusic.big();
await new Promise(resolve => setTimeout(resolve, 60));
const openPos = { left: parseFloat(big.style.left), top: parseFloat(big.style.top) };
assert.ok(isFinite(openPos.left) && isFinite(openPos.top), '확장 플레이어 첫 위치가 잡혀야 한다');
const w = parseFloat(big.style.width), h = parseFloat(big.style.height);
assert.ok(w > 0 && h > 0, '확장 플레이어 크기가 설정되어야 한다');
assert.ok(Math.abs((openPos.left + w / 2) - vp.w / 2) <= 2,
  `확장 플레이어는 세로 가운데 정렬(현재 좌표 ${openPos.left}, 중심 ${openPos.left + w / 2} / ${vp.w / 2})`);
assert.ok(openPos.top + h / 2 >= vp.h / 2 - 18, '확장 플레이어는 세로도 중앙 근처에 열린다');

document.getElementById('mpBFull').click();
await new Promise(resolve => setTimeout(resolve, 100));
assert.ok(big.classList.contains('mpb-fs'), '가짜 전체 화면이 켜져야 한다');
document.getElementById('mpBFull').click();
await new Promise(resolve => setTimeout(resolve, 160));
assert.ok(!big.classList.contains('mpb-fs'), '가짜 전체 화면이 꺼져야 한다');
const backPos = { left: parseFloat(big.style.left), top: parseFloat(big.style.top) };
assert.ok(Math.abs(backPos.left - openPos.left) <= 2 && Math.abs(backPos.top - openPos.top) <= 2,
  `전체 화면에서 나오면 진입 전 위치로 복원(진입 ${JSON.stringify(openPos)} → 복원 ${JSON.stringify(backPos)})`);

/* 음악 바의 시간 말풍선이 진행바를 밀지 않는 구조는 위 정적 검사로 확인. */

/* 암기카드: 첫 열기 = 공용 실측 가운데(저장 위치가 없으므로) */
const cardsBtn = document.querySelector('button[title="암기 카드"]');
assert.ok(cardsBtn, '암기카드 버튼이 있어야 한다');
cardsBtn.click();
await new Promise(resolve => setTimeout(resolve, 60));
const cardWin = document.querySelector('#cardsModal .fcard-win');
assert.ok(cardWin, '암기카드 창이 있어야 한다');
assert.ok(cardWin.classList.contains('moved'), '첫 열기부터 떠 있는 창 이동 모드여야 한다');
const cardLeft = parseFloat(cardWin.style.left), cardTop = parseFloat(cardWin.style.top);
assert.ok(isFinite(cardLeft) && isFinite(cardTop), '암기카드 첫 위치가 인라인으로 잡혀야 한다');
assert.ok(cardLeft > 0 && cardLeft < vp.w && cardTop > 0 && cardTop < vp.h,
  `암기카드가 화면 안 중앙 영역에 열려야 한다 (${cardLeft},${cardTop} / ${vp.w}×${vp.h})`);
assert.ok(Math.abs(cardLeft - (vp.w - 760) / 2) <= 2,
  '암기카드 가로 중심은 공용 실측 기반이어야 한다');

dom.window.close();
console.log('music/eq/card layout contract: ok');
