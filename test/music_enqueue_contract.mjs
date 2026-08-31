/* 18.3 · '곡을 누르면 대기열에 담고 재생' + 대기열 관리 계약
   ---------------------------------------------------------------------------
   1) 전체 곡/추천/검색/가수별에서 곡을 누르면 기존 대기열을 갈아끼우지 않고
      그 곡을 대기열 끝에 담아 바로 재생한다 (중복은 그 자리로 이동).
   2) 대기열 탭에는 위로/아래로/다음에 재생/빼기 / 전체 비우기 버튼이 있다.
   3) '전체 비우기'는 재생 중인 곡만 남겨 '다음 곡'이 라이브러리로 새지 않게 한다. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../sdynotes.css', import.meta.url), 'utf8');
const fullHtml = html.includes('<script src="sdynotes.js')
  ? html.replace(/<script src="sdynotes\.js(?:\?[^"]*)?"[^>]*><\/script>/, '<script>' + js + '</script>')
  : html;

/* ── 정적 계약 ─────────────────────────────────────────────────────────── */
const flat = (html + ' ' + js + ' ' + css).replace(/\s+/g, ' ');
assert.match(js, /function queueAdd\(id\)\{/, 'queueAdd(대기열에 담고 재생)가 있어야 한다');
assert.match(js, /function queueMove\(i,d\)\{/, 'queueMove(위로/아래로)가 있어야 한다');
assert.match(js, /function queueRemove\(i\)\{/, 'queueRemove(빼기)가 있어야 한다');
assert.match(js, /function queueClear\(\)\{/, 'queueClear(전체 비우기)가 있어야 한다');
assert.match(js, /data-reco-album=/, '추천 앨범 카드는 곡 1개가 아니라 앨범 묶음 키를 가진다');
assert.match(js, /data-reco-playlist=/, '추천 플레이리스트 카드가 있다');
assert.match(js, /function _queueRecoIds\(ids,name\)/, '추천 묶음은 대기열 교체 헬퍼로 재생한다');
assert.match(js, /playFrom\(q,q\[0\]\.id,name\|\|'추천 플레이리스트'\)/, '추천 묶음 선택은 기존 대기열을 갈아끼운다');
assert.match(js, /window\.sdyQueueAdd=queueAdd/, '테스트 훅 sdyQueueAdd 가 있다');
assert.match(js, /queueAdd\(id\);[\s\S]{0,60}\}\);/, '큰 플레이어 목록 클릭이 queueAdd 를 부른다');
assert.match(js, /if\(\(el=hit\('data-i'\)\)\)\{ queueAdd/, '작은 목록 클릭도 queueAdd 를 부른다');
assert.match(js, /data-qop="up"/, '대기열 행에 위로 버튼이 있다');
assert.match(js, /data-qop="down"/, '대기열 행에 아래로 버튼이 있다');
assert.match(js, /data-qop="next"/, '대기열 행에 다음에 재생 버튼이 있다');
assert.match(js, /data-qop="del"/, '대기열 행에 빼기 버튼이 있다');
assert.match(js, /data-qclear="1"/, '대기열에 전체 비우기 버튼이 있다');
assert.match(css, /\.mpb-qops\{/, '관리 버튼 스타일이 있다');
assert.match(css, /\.mpb-qclear\{/, '전체 비우기 스타일이 있다');

/* ── 런타임 계약 (jsdom) ──────────────────────────────────────────────── */
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (error) => {
  if (!/Could not load (script|link|style)/.test(error.message)) errors.push(error);
});
const TRACKS = [
  { id: 't1', title: 'Cherry', artist: 'Zeta', created_at: '20260101000000Z' },
  { id: 't2', title: 'Apple', artist: 'Yankee', created_at: '20260102000000Z' },
  { id: 't3', title: 'Banana', artist: 'Xray', created_at: '20260103000000Z' },
  { id: 't4', title: 'Durian', artist: 'Whiskey', created_at: '20260104000000Z' },
];
const dom = new JSDOM(fullHtml, {
  url: 'http://sdynotes.test/',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.fetch = async () => new Response(JSON.stringify({ tracks: [], ok: true }), {
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
    window.HTMLElement.prototype.scrollTo = function scrollTo(o) {
      this.scrollTop = (typeof o === 'object' ? o.top : o) || 0;
    };
    window.HTMLMediaElement.prototype.play = function play() {
      this.dispatchEvent(new window.Event('play')); return Promise.resolve();
    };
    window.HTMLMediaElement.prototype.pause = function pause() {};
    window.HTMLMediaElement.prototype.load = function load() {};
  },
});

await new Promise((r) => setTimeout(r, 400));
const { window } = dom;
const { document } = window;
assert.equal(errors.length, 0, errors.map((e) => e.stack).join('\n'));
const M = window.sdyMusic;
const S = M._state();
S.list = TRACKS.slice();

/* ① 클릭(또는 sdyQueueAdd) = 대기열에 담고 재생 — 기존 대기열 유지 */
window.sdyQueueAdd('t2');
assert.equal(M.cur().id, 't2', '첫 곡: 바로 재생');
assert.equal(S.queue.map(t => t.id).join(','), 't2', '대기열 = [t2]');
window.sdyQueueAdd('t4');
window.sdyQueueAdd('t1');
assert.equal(S.queue.map(t => t.id).join(','), 't2,t4,t1', '끝에 차곡차곡 담긴다');
assert.equal(M.cur().id, 't1', '마지막에 담은 곡이 재생 중');

/* 중복은 아무리 눌러도 한 번만 (그 자리로 이동해 재생) */
window.sdyQueueAdd('t2');
assert.equal(S.queue.map(t => t.id).join(','), 't2,t4,t1', '중복 곡은 대기열에 다시 안 쌓인다');
assert.equal(M.cur().id, 't2', '이미 있으면 그 자리를 재생');

/* ② 큰 플레이어 행 클릭도 같은 동작 — 기존 대기열 유지 + 끝에 담고 재생 */
const body = document.getElementById('mpBBody');
body.innerHTML = '<div class="mpb-li" data-bl="t3">Banana</div>';
body.querySelector('.mpb-li')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
assert.equal(S.queue.map(t => t.id).join(','), 't2,t4,t1,t3', '행 클릭 = 대기열 끝에 담고 재생');
assert.equal(M.cur().id, 't3', '행 클릭한 곡이 재생 중');

/* 추천 앨범/플레이리스트 클릭 = 기존 대기열을 싹 비우고 그 묶음만 대기열 */
const RECO_TRACKS = [
  { id: 'old', title: 'Old queue', artist: 'Queue', album: 'Before', genre: 'rock', created_at: '20260101000000Z' },
  { id: 'a1', title: 'Dream one', artist: 'Band A', album: 'Dream Album', genre: 'ballad', created_at: '20260102000000Z' },
  { id: 'a2', title: 'Dream two', artist: 'Band A', album: 'Dream Album', genre: 'ballad', created_at: '20260103000000Z' },
  { id: 'p1', title: 'Focus one', artist: 'Focus', album: 'Study', genre: 'lofi', created_at: '20260104000000Z' },
  { id: 'p2', title: 'Focus two', artist: 'Focus', album: 'Study', genre: 'lofi', created_at: '20260105000000Z' },
];
S.list = RECO_TRACKS.slice();
window.localStorage.setItem('sdy_playlists', JSON.stringify([{ id: 'mypl', name: 'My Focus Mix', tracks: ['p1', 'p2'] }]));
window.sdyPlayFrom([RECO_TRACKS[0]], 'old', '기존 대기열');
S.bigTab = 'd'; S.recoFilter = 'all';
M.bigList();
const albumCard = [...document.querySelectorAll('#mpBBody [data-reco-album]')]
  .find(el => /Dream Album/.test(el.textContent));
assert.ok(albumCard, '추천 앨범 카드가 렌더된다');
albumCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
assert.equal(S.queue.map(t => t.id).join(','), 'a1,a2', '추천 앨범 선택 → 기존 대기열 제거 + 앨범 전체만 등록');
assert.equal(M.cur().id, 'a1', '추천 앨범 첫 곡부터 재생');
window.sdyPlayFrom([RECO_TRACKS[0]], 'old', '기존 대기열');
M.bigList();
const playlistCard = [...document.querySelectorAll('#mpBBody [data-reco-playlist]')]
  .find(el => /My Focus Mix/.test(el.textContent));
assert.ok(playlistCard, '저장/자동 추천 플레이리스트 카드가 렌더된다');
playlistCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
assert.equal(S.queue.map(t => t.id).join(','), 'p1,p2', '추천 플레이리스트 선택 → 기존 대기열 제거 + 플레이리스트 전체만 등록');
// 아래 대기열 관리 검사는 원래 4곡 상태로 되돌려 이어간다.
S.list = TRACKS.slice();
S.queue = ['t2', 't4', 't1', 't3'].map(id => S.list.find(t => t.id === id));
S.idx = 3; S.currentId = 't3'; M.audio()._trackId = 't3';

/* ③ 대기열 관리: 위로/아래로/빼기 */
window.sdyQueueMove(3, -1);                      // t3 한 칸 위로
assert.equal(S.queue.map(t => t.id).join(','), 't2,t4,t3,t1', '아래 곡을 위로');
window.sdyQueueMove(0, 1);                       // t2 한 칸 아래
assert.equal(S.queue.map(t => t.id).join(','), 't4,t2,t3,t1', '위 곡을 아래로');
window.sdyQueueRemove(3);                        // t1 빼기
assert.equal(S.queue.map(t => t.id).join(','), 't4,t2,t3', '대기열에서 빼기');
assert.equal(M.cur().id, 't3', '빼도 현재 곡은 유지');
// 행의 관리 버튼(위로/빼기)도 실제 클릭 경로로 동작한다
body.innerHTML = '<div class="mpb-li" data-bq="1" data-tid="t2">' +
  '<span class="mpb-qops"><button class="mpb-qop" data-qop="up" data-bqidx="1"></button></span></div>';
body.querySelector('[data-qop]')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
assert.equal(S.queue.map(t => t.id).join(','), 't2,t4,t3', '위로 버튼 클릭이 동작한다');
body.innerHTML = '<div class="mpb-li" data-bq="0" data-tid="t2">' +
  '<span class="mpb-qops"><button class="mpb-qop" data-qop="del" data-bqidx="0"></button></span></div>';
body.querySelector('[data-qop]')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
assert.equal(S.queue.map(t => t.id).join(','), 't4,t3', '빼기 버튼 클릭이 동작한다');
// 전체 비우기 버튼 클릭
body.innerHTML = '<button data-qclear="1">비우기</button>';
body.querySelector('[data-qclear]')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
assert.equal(S.queue.map(t => t.id).join(','), 't3', '전체 비우기 클릭 → 재생 중인 곡만 남는다');

/* ④ 비운 뒤: 재생 중인 곡만 남아 '다음'이 라이브러리로 새지 않는다 */
const A = M.audio();
A.dispatchEvent(new window.Event('ended'));
assert.equal(M.cur().id, 't3', '비운 뒤 다음 곡이 라이브러리로 새지 않는다 (같은 곡 반복 설정 기준 유지)');

console.log('음악 대기열 담기/관리 계약: PASS');
dom.window.close();
process.exit(0);
