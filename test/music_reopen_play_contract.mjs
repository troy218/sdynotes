/* 18.4 · 크로스바 X → 플로팅 버튼 → 재생(▶)이 바로 다시 틀어지는 계약
   ---------------------------------------------------------------------------
   회귀: mpX 가 A.src='' 로 소스를 지우는데, 브라우저는 빈 src 를 '페이지 URL'로
   해석해 truthy 가 된다. 그래서 다시 열고 재생(pp)을 눌러도 !A.src 분기를 타지
   못하고 페이지 URL 을 재생하려다 아무 소리도 나지 않았다.
   이제 X 는 src 를 남겨두고(재생 시 이어서 재생), pp 는 '페이지 URL src'도
   소스 없음으로 본다. 관리자 삭제(mpDel)는 속성 제거로 진짜 빈 src 를 만든다. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');
const fullHtml = html.replace(/<script src="sdynotes\.js(?:\?[^"]*)?"[^>]*><\/script>/, () => '<script>' + js.replace(/<\/script/gi, '<\\/script>') + '</script>');

/* ── 정적 계약 ── */
assert.match(js, /function _audioSrcLive\(\)\{/, 'pp 의 소스 판정 헬퍼가 있다');
assert.match(js, /\$\(['"]mpX['"]\)\.onclick=\(\)=>\{ A\.pause\(\);\s*\n?\s*pl\.style\.display/, 'mpX 는 src 를 지우지 않는다');
assert.match(js, /A\.removeAttribute\(['"]src['"]\)/, 'mpDel 은 속성 제거로 소스를 비운다');
assert.ok(!/mpX['"]\)\.onclick=\(\)=>\{ A\.pause\(\); A\.src=''/.test(js), 'mpX 에 A.src=\'\' 가 남아 있지 않다');

/* ── 런타임 계약 ── */
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/Could not load/.test(e.message)) errors.push(e.message); });

const dom = new JSDOM(fullHtml, {
  url: 'http://sdynotes.test/',
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.fetch = async () => new Response(JSON.stringify({ tracks: [], ok: true }), {
      status: 200, headers: { 'content-type': 'application/json' } });
    window.confirm = () => false; window.prompt = () => null; window.alert = () => {};
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    window.IntersectionObserver = class { observe() {} disconnect() {} };
    window.ResizeObserver = class { observe() {} disconnect() {} };
    window.HTMLCanvasElement.prototype.getContext = () => ({
      setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {},
      stroke() {}, moveTo() {}, lineTo() {}, save() {}, restore() {}, translate() {},
      scale() {}, rotate() {}, fillText() {},
    });
    window.HTMLElement.prototype.scrollTo = function (o) { this.scrollTop = (typeof o === 'object' ? o.top : o) || 0; };
    // 리얼 브라우저처럼 paused 상태를 mock 이 유지한다.
    Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
      configurable: true, get() { return this._paused !== false; }, set(v) { this._paused = !!v; },
    });
    window.HTMLMediaElement.prototype.play = function () {
      this._paused = false;
      this.dispatchEvent(new window.Event('play')); return Promise.resolve();
    };
    window.HTMLMediaElement.prototype.pause = function () {
      this._paused = true;
      this.dispatchEvent(new window.Event('pause'));
    };
    window.HTMLMediaElement.prototype.load = function () {};
  },
});

await new Promise((r) => setTimeout(r, 400));
const { window } = dom; const { document } = window;
assert.equal(errors.length, 0, errors.map((e) => e.stack).join('\n'));
const M = window.sdyMusic; const S = M._state();
S.list = [{ id: 't1', title: 'A', artist: 'B', created_at: '20260101000000Z' }];
const A = M.audio();

/* ① 곡을 물리고 재생 */
window.sdyQueueAdd('t1');
assert.equal(M.cur().id, 't1', '곡이 선택됨');
assert.ok(A.src.indexOf('/api/music/file/t1') >= 0, '실제 곡 src 가 물려 있다');
assert.equal(A.paused, false, '재생 중');

/* ② 크로스바 X — 일시정지 + 숨기기만 하고 소스는 유지 */
let playEvents = 0;
A.addEventListener('play', () => playEvents++);
const mpX = document.getElementById('mpX');
mpX.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
assert.equal(A.paused, true, 'X → 일시정지');
assert.ok(A.src.indexOf('/api/music/file/t1') >= 0, 'X 후에도 곡 src 가 남아 있다');
assert.equal(document.getElementById('musicPlayer').style.display, 'none', '크로스바 숨김');
assert.equal(document.getElementById('mpReopen').style.display, 'flex', '플로팅 버튼 표시');

/* ③ 플로팅 버튼으로 다시 열기 */
const chip = document.getElementById('mpReopen');
chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
assert.equal(document.getElementById('musicPlayer').style.display, 'flex', '다시 열림');

/* ④ 재생 버튼 → 바로 재생 (src 가 그대로라 pp 가 곡을 다시 튼다) */
const mpPP = document.getElementById('mpPP');
mpPP.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await new Promise((r) => setTimeout(r, 250));
assert.ok(playEvents >= 1, '재생 이벤트가 발생한다');
assert.equal(A.paused, false, '재생 상태');
assert.ok(A.src.indexOf('/api/music/file/t1') >= 0, '여전히 곡 src');
assert.equal(M.cur().id, 't1', '같은 곡');

/* ⑤ 만약 어떤 경로로든 src 가 페이지 URL 로 남았어도 pp 는 곡을 다시 건다 */
A.src = window.location.href;   // 브라우저의 '빈 src' 해석 결과를 재현
A._paused = true;
const before = playEvents;
mpPP.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await new Promise((r) => setTimeout(r, 250));
assert.ok(A.src.indexOf('/api/music/file/t1') >= 0, '페이지 URL src 는 곡 src 로 교체된다');
assert.ok(playEvents > before, '그 경우에도 재생된다');

/* ⑥ mpDel(관리자 삭제) 경로: 속성 제거 → 진짜 빈 src (페이지 URL 아님) */
const delBtn = document.getElementById('mpDel');
// 관리자 여부와 무관하게 동작 확인: 핸들러가 있는지만 + 소스 정리 패턴은 정적 검증
assert.equal(typeof delBtn.onclick, 'function', 'mpDel 핸들러 존재');
A.removeAttribute('src');
assert.equal(A.src, '', 'removeAttribute 후 src 는 진짜 빈 값');

console.log('크로스바 다시열기 재생 계약: PASS');
dom.window.close();
process.exit(0);
