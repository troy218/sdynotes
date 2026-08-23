// 14.14 · 멜론식 대기열 + '이전에 듣던 곡' 복원 계약
//
// 고친 증상 4가지를 그대로 단언한다.
//   ① 탭을 옮겼다 돌아오면 듣던 곡이 대기열 첫 곡으로 바뀐다
//   ② 사이트를 새로 열면 듣던 곡이 아니라 대기열 첫 곡부터 시작한다
//   ③ 정렬을 바꿔 놓고 곡을 고르면 '다음 곡'이 화면 순서와 다르게 간다
//   ④ 섞기를 켜면 대기열 순서가 통째로 뒤집히고, 껐을 때 원래 순서를 잃는다
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
const pass = [];
const ok = (name, cond) => {
  assert.ok(cond, `FAIL: ${name}`);
  pass.push(name);
};

// ─────────────────────────────────────────────────────────
// 1부 · 소스 계약 (구조가 되돌아가는 것을 막는 잠금장치)
// ─────────────────────────────────────────────────────────
const flat = html.replace(/\s+/g, ' ');

ok('설정 동기화 payload 가 sdy_music_state 를 실어 보내지 않는다',
  !/music:_readJsonLS\('sdy_music_state'/.test(flat));
ok('설정 동기화 payload 는 재생 환경(repeat/shuffle/rate/vol)만 담는다',
  /music:\s*\{ repeat:\+\(localStorage\.getItem\('mp_repeat'\)/.test(flat));
ok('원격 설정이 sdy_music_state 를 덮어쓰지 않는다',
  !/localStorage\.setItem\('sdy_music_state',JSON\.stringify\(ui\.music\)\)/.test(flat));
ok('원격 설정은 sdyApplyMusicPrefs(환경 전용)로만 들어온다',
  /window\.sdyApplyMusicPrefs\(ui\.music\)/.test(flat)
  && !/window\.sdyApplyMusicState\(ui\.music\)/.test(flat));
ok('이미 곡을 물고 있으면 원격 상태가 대기열/현재곡을 갈아끼우지 못한다 (busy 가드)',
  /const busy=!force&&!!\(\(A&&A\.src\)\|\|P\.currentId\|\|P\.queue\)/.test(flat));
ok('부팅 복원은 force 로 저장된 이전 곡을 되살린다',
  /_applyMusicStateObject\(d,\{force:true\}\)/.test(flat));
ok('복원 전에는 저장하지 않는다 (초기화가 지난 곡 기록을 지우지 못하게)',
  /let _mpRestored=false;/.test(flat)
  && /function saveMusicState\(push\)\{ if\(!_mpRestored\) return;/.test(flat)
  && /_mpRestored=true;/.test(flat));

ok('구 셔플 방식(orderBak 배열 뒤섞기)이 사라졌다', !/orderBak/.test(flat));
ok('멜론식 대기열 엔진 함수가 있다',
  /function _qNextIndex\(auto\)/.test(flat) && /function _qPrevIndex\(\)/.test(flat)
  && /function playNext\(auto\)/.test(flat) && /function playPrev\(\)/.test(flat));
ok('보인 순서로 대기열을 세우는 playFrom/setQueue 가 있다',
  /function playFrom\(tracks,id,plName\)/.test(flat) && /function setQueue\(tracks,plName\)/.test(flat));
ok('삭제·목록갱신 뒤 대기열/기록을 정리하는 pruneQueue 가 있다',
  /function pruneQueue\(\)/.test(flat));
ok('정렬은 select 가 아니라 아이콘 버튼이다',
  !/<select id="mpSort"/.test(flat)
  && /<button id="mpSort" class="mp-sortbtn"/.test(flat)
  && /<button id="mpBSort" class="mpb-icon mp-sortbtn"/.test(flat));
ok('북마크 바가 유리(backdrop blur)다',
  /\.link-bar\{[^}]*backdrop-filter:blur\(12px\)/.test(flat));
ok('엽스코드 음성바가 유리이고 채팅이 그 밑으로 흐른다',
  /\.yp-voice\{[^}]*backdrop-filter:blur\(14px\)/.test(flat)
  && /#ypApp \.yp-body\{margin-top:var\(--ypv-neg,-40px\);padding-top:var\(--ypv-pad,52px\);?\}/.test(flat)
  && /#ypApp\.yp-has-bgm \.yp-body\{margin-top:0/.test(flat)
  && /app\.style\.setProperty\('--ypv-neg', \(-vh\)\+'px'\)/.test(flat));

// ─────────────────────────────────────────────────────────
// 2부 · 실제 동작 (jsdom)
// ─────────────────────────────────────────────────────────
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

const dom = new JSDOM(html, {
  url: 'http://sdynotes.test/',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.fetch = async (url) => {
      const body = String(url).includes('/api/music/list')
        ? { ok: true, tracks: TRACKS, count: TRACKS.length }
        : { ok: true, tracks: [] };
      return new Response(JSON.stringify(body), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };
    window.confirm = () => true;
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
    window.HTMLElement.prototype.scrollTo = function scrollTo(options) {
      this.scrollTop = (typeof options === 'object' ? options.top : options) || 0;
    };
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

await new Promise((resolve) => setTimeout(resolve, 400));
const { window } = dom;
const { document } = window;
assert.equal(errors.length, 0, errors.map((e) => e.stack).join('\n'));

const M = window.sdyMusic;
const S = M._state();
S.list = TRACKS.slice();

// ── ③ 정렬을 바꾸면 '보인 순서' 그대로가 대기열이 된다 ──
const sortBtn = document.getElementById('mpSort');
ok('정렬 버튼 기본은 최근 추가(시계 아이콘)', /ri-time-line/.test(sortBtn.innerHTML));
sortBtn.click();                                        // recent → title
ok('정렬 버튼을 누르면 제목순으로 순환', S.sort === 'title');
ok('제목순이면 아이콘/강조가 바뀐다',
  /ri-sort-alphabet-asc/.test(sortBtn.innerHTML) && sortBtn.classList.contains('on'));

// 제목순 = Apple(t2) · Banana(t3) · Cherry(t1) · Durian(t4)
window.sdyPlayFrom(window.sdySearchTracks ? S.list.slice().sort(
  (x, y) => x.title.localeCompare(y.title)) : [], 't3', '');
ok('고른 곡이 현재 곡이 된다', M.cur().id === 't3');
ok('보인 순서가 그대로 대기열이 된다',
  S.queue.map((t) => t.id).join(',') === 't2,t3,t1,t4');

// '다음'은 원본 목록이 아니라 대기열(=화면 순서)을 따른다
document.getElementById('mpNext').click();
ok('다음 곡은 화면 순서를 따른다 (t3 → t1)', M.cur().id === 't1');
document.getElementById('mpBPrev').click();
ok('이전 곡도 화면 순서를 따른다 (t1 → t3)', M.cur().id === 't3');

// ── ④ 섞기는 대기열을 재배치하지 않는다 ──
const beforeShuffle = S.queue.map((t) => t.id).join(',');
document.getElementById('mpShuf').click();
ok('섞기 켜짐', S.shuffle === true);
ok('섞기를 켜도 대기열 순서는 그대로다',
  S.queue.map((t) => t.id).join(',') === beforeShuffle);

// 한 바퀴 안에 같은 곡이 두 번 나오지 않는다
const seen = new Set([M.cur().id]);
let dup = false;
for (let i = 0; i < 3; i += 1) {
  document.getElementById('mpNext').click();
  const id = M.cur().id;
  if (seen.has(id)) dup = true;
  seen.add(id);
}
ok('섞기 한 바퀴에 같은 곡이 두 번 나오지 않는다', !dup && seen.size === 4);

document.getElementById('mpShuf').click();
ok('섞기를 꺼도 대기열 순서는 여전히 그대로다',
  S.shuffle === false && S.queue.map((t) => t.id).join(',') === beforeShuffle);

// ── 반복 꺼짐: 대기열 끝에서 자동으로 첫 곡으로 돌아가지 않는다 ──
S.repeat = 0;
window.sdyPlayFrom(S.queue.slice(), 't4', '');   // 마지막 곡
const A = M.audio();
A.dispatchEvent(new window.Event('ended'));
ok('반복 꺼짐 + 대기열 끝 → 첫 곡으로 튀지 않는다', M.cur().id === 't4');

// 전체 반복이면 처음으로 돌아간다
S.repeat = 1;
window.sdyPlayFrom(S.queue.slice(), 't4', '');
A.dispatchEvent(new window.Event('ended'));
ok('전체 반복 → 대기열 처음으로 돌아간다', M.cur().id === 't2');

// ── ① 원격 설정 동기화가 듣던 곡을 갈아엎지 못한다 ──
window.sdyPlayFrom(S.queue.slice(), 't1', '');
const playing = M.cur().id;
window.sdyApplyMusicPrefs({ repeat: 2, shuffle: false, rate: 1.5, vol: 40 });
ok('원격 환경 동기화는 반복/배속/음량만 바꾼다',
  S.repeat === 2 && Math.abs(S.rate - 1.5) < 1e-9);
ok('원격 환경 동기화가 현재 곡을 바꾸지 않는다', M.cur().id === playing);

// 남의 오래된 '대기열 첫 곡' 상태가 밀고 들어와도 재생 중이면 무시한다
window.sdyApplyMusicState({ queue: ['t2', 't3'], idx: 0, current: 't2', position: 0 });
ok('재생 중에는 원격 대기열/현재곡을 받아들이지 않는다', M.cur().id === playing);

// ── ② 부팅 복원: 대기열 첫 곡이 아니라 이전에 듣던 곡 ──
const saved = JSON.parse(window.localStorage.getItem('sdy_music_state') || 'null');
ok('현재 상태가 sdy_music_state 에 저장돼 있다', saved && saved.current === playing);
ok('저장 상태에 대기열 순서가 그대로 담긴다',
  Array.isArray(saved.queue) && saved.queue.join(',') === beforeShuffle);

// 정지 상태(=새로 연 탭)에서는 저장된 곡을 그대로 되살린다
S.queue = null; S.idx = -1; S.currentId = ''; A._trackId = ''; A.removeAttribute('src'); A.src = '';
window.sdyApplyMusicState({ queue: ['t2', 't3', 't1', 't4'], idx: 2, current: 't1', position: 41 },
  { force: true });
ok('부팅 복원은 대기열 첫 곡이 아니라 이전에 듣던 곡을 고른다', M.cur().id === 't1');
ok('부팅 복원은 대기열 순서도 함께 되살린다',
  S.queue.map((t) => t.id).join(',') === 't2,t3,t1,t4' && S.idx === 2);
ok('부팅 복원 뒤 크로스바 제목이 그 곡을 가리킨다',
  /Cherry/.test(document.getElementById('mpTitle').textContent));

// ─────────────────────────────────────────────────────────
// 3부 · 진짜 '새로 접속' — 저장된 상태만 들고 페이지를 처음부터 띄운다
//   (② 증상: 사이트를 새로 열면 대기열 첫 곡부터 시작하던 문제)
// ─────────────────────────────────────────────────────────
const bootErrors = [];
const bootVc = new VirtualConsole();
bootVc.on('jsdomError', (error) => {
  if (!/Could not load (script|link|style)/.test(error.message)) bootErrors.push(error);
});
// 지난 세션: 대기열 2번째 곡(t2)을 41초까지 듣다가 창을 닫았다
const lastSession = JSON.stringify({
  queue: ['t1', 't2', 't3', 't4'], idx: 1, current: 't2', plName: '',
  position: 41, played: ['t2'], repeat: 0, shuffle: false, rate: 1, vol: 100,
});
const boot = new JSDOM(html, {
  url: 'http://sdynotes.test/',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: bootVc,
  beforeParse(window) {
    window.fetch = async (url) => new Response(JSON.stringify(
      String(url).includes('/api/music/list')
        ? { ok: true, tracks: TRACKS, count: TRACKS.length }
        : { ok: true, tracks: [] },
    ), { status: 200, headers: { 'content-type': 'application/json' } });
    window.confirm = () => true;
    window.prompt = () => null;
    window.alert = () => {};
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    window.IntersectionObserver = class { observe() {} disconnect() {} };
    window.ResizeObserver = class { observe() {} disconnect() {} };
    window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
    window.HTMLElement.prototype.scrollTo = function scrollTo() {};
    window.HTMLMediaElement.prototype.play = function play() { return Promise.resolve(); };
    window.HTMLMediaElement.prototype.pause = function pause() {};
    window.HTMLMediaElement.prototype.load = function load() {};
    window.localStorage.setItem('sdy_music_state', lastSession);
  },
});
await new Promise((resolve) => setTimeout(resolve, 900));
const bw = boot.window;
const BM = bw.sdyMusic;
const BS = BM._state();
assert.equal(bootErrors.length, 0, bootErrors.map((e) => e.stack).join('\n'));

ok('새로 접속하면 대기열 첫 곡이 아니라 이전에 듣던 곡이 걸린다',
  BM.cur() && BM.cur().id === 't2');
ok('새로 접속해도 대기열 순서가 그대로 살아난다',
  (BS.queue || []).map((t) => t.id).join(',') === 't1,t2,t3,t4' && BS.idx === 1);
ok('크로스바 제목이 이전에 듣던 곡을 가리킨다',
  /Apple/.test(bw.document.getElementById('mpTitle').textContent));
ok('확장 플레이어 제목도 이전에 듣던 곡을 가리킨다',
  /Apple/.test(bw.document.getElementById('mpBTitle').textContent));
ok('오디오에 물린 파일도 이전에 듣던 곡이다',
  String(BM.audio().getAttribute('src') || '').includes('t2'));
ok('부팅 초기화가 지난 곡 기록을 지우지 않았다',
  JSON.parse(bw.localStorage.getItem('sdy_music_state')).current === 't2');

console.log(`\n음악 대기열 계약: PASS ${pass.length} / FAIL 0`);
// jsdom 의 남은 rAF/타이머가 close() 뒤에 깨어나며 터지는 것을 막는다
process.exit(0);
