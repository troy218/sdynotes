import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');
const musicPy = fs.readFileSync(new URL('../worker/sdynotes_worker/music.py', import.meta.url), 'utf8');
const musicCloudPy = fs.readFileSync(new URL('../worker/sdynotes_worker/music_cloud.py', import.meta.url), 'utf8');
assert.match(musicPy, /def _music_dedupe_recognized\(mid\):/, '로컬 음원 인식 중복 자동 정리 시스템이 있어야 한다');
assert.match(musicPy, /recog_mbid/, '인식된 곡은 MBID를 저장해 완전 동일곡 판정에 쓴다');
assert.match(musicCloudPy, /def _cloud_dedupe_recognized\(mid\):/, '클라우드 음원도 인식 중복 자동 정리를 수행해야 한다');
assert.match(js, /duplicate_removed[\s\S]{0,360}중복 음원을 자동으로 정리/, '프론트엔드는 중복 자동 삭제 응답을 사용자에게 알려야 한다');
const fullHtml = html.includes('<script src="sdynotes.js')
  ? html.replace(/<script src="sdynotes\.js(?:\?[^"]*)?"[^>]*><\/script>/, () => '<script>' + js.replace(/<\/script/gi, '<\\/script>') + '</script>')
  : html;
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', error => {
  // Network-only failures are expected: this is a browser UI unit test.
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

await new Promise(resolve => setTimeout(resolve, 300));
const { window } = dom;
const { document } = window;
assert.equal(errors.length, 0, errors.map(error => error.stack).join('\n'));
assert.ok(window.sdyMusic, 'music module should initialize');

// Every visible, fixed music action has a listener. Dynamic track/context-menu
// actions are delegated and are covered by the music module initialization above.
const actionIds = [
  'mpBRefresh', 'mpBX', 'mpBShuf', 'mpBPrev', 'mpBPP', 'mpBNext', 'mpBRep', 'mpBRate',
  'mpBTabD', 'mpBTabQ', 'mpBTabA', 'mpBTabL', 'mpBTabY', 'mpBFind', 'mpBUp',
  'mpBSearchX', 'mpBPgPrev', 'mpBPgNext',
  'mpTagX', 'mpTagUrlBtn', 'mpTagCoverPick', 'mpTagCoverFind', 'mpTagCoverReset',
  'mpTagAuto', 'mpTagSyncLrc', 'mpTagRecog', 'mpTagOrigBtn', 'mpTagSave',
  'mpAddX', 'mpAddFile', 'mpYtGo', 'mpYtCookies', 'mpYtCookiesDel',
  'mpPrev', 'mpPP', 'mpNext', 'mpList', 'mpMore', 'mpExpand', 'mpPrev2', 'mpNext2',
  'mpRep', 'mpShuf', 'mpRate', 'mpVol', 'mpUp', 'mpDel', 'mpX',
  'mpTabAll', 'mpTabArt', 'mpTabPL', 'mpAddPL', 'mpPgPrev', 'mpPgNext', 'mpReopen',
];
for (const id of actionIds) {
  const element = document.getElementById(id);
  assert.ok(element, `${id} should exist`);
  assert.equal(typeof element.onclick, 'function', `${id} should have a click handler`);
}

// The artist label explicitly promises to show the current artist. Verify it
// filters the artist tab, and the artist tab button clears that temporary filter.
const state = window.sdyMusic._state();
state.list = [
  { id: 'artist-a-1', title: 'A one', artist: 'Artist A' },
  { id: 'artist-a-2', title: 'A two', artist: 'Artist A' },
  { id: 'artist-b-1', title: 'B one', artist: 'Artist B' },
];
window.sdyMusic.play(0);
window.sdyMusic.big();
document.getElementById('mpBArtist').click();
assert.equal(state.bigTab, 'a');
assert.equal(state.bigArtist, 'Artist A');
assert.match(document.getElementById('mpBBody').textContent, /A one/);
assert.doesNotMatch(document.getElementById('mpBBody').textContent, /B one/);
document.getElementById('mpBTabA').click();
assert.equal(state.bigArtist, '');
assert.match(document.getElementById('mpBBody').textContent, /B one/);

// ── 14.13 · 수동 버튼 결과가 편집창에 반영되는지 (소리 인식 · 가사 · 표지) ──
// 증상: '소리 인식' 을 누르면 토스트에는 결과가 떴지만 편집창 위쪽 입력칸이
// 계속 옛 제목 그대로였다. 버튼이 보낸/받은 값과 화면 반영을 단언한다.
const apiCalls = [];
window.fetch = async (url, opts = {}) => {
  const u = String(url);
  apiCalls.push({ url: u, method: opts.method || 'GET', body: opts.body || null });
  const json = (obj) => new Response(JSON.stringify(obj), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
  if (u.includes('/api/music/recognize/status'))
    return json({ ok: true, fpcalc: true, key: true, ready: true });
  if (u.includes('/api/music/recognize')) {
    // 서버는 force 반영 뒤의 곡 레코드와 인식 결과를 함께 돌려준다
    return json({ ok: true, track: { id: 'rec1', title: '인식된 제목', artist: '인식된 가수' },
                  recog: { title: '인식된 제목', artist: '인식된 가수', score: 0.93 } });
  }
  if (u.includes('/api/music/synced-lyrics'))
    return json({ ok: true, lyrics: '[00:01.00] 첫 줄', src: 'LRCLIB' });
  if (u.includes('/api/music/lookup'))
    return json({ ok: true, track: { id: 'rec1', title: '인식된 제목', artist: '인식된 가수' },
                  cover: true, count: 1 });
  if (u.includes('/api/music/list'))
    // 일부러 '예전 서버'처럼: 인식 결과를 아직 목록에 안 붙인 응답.
    // 이 경우에도 화면은 응답의 recog 값을 반영해야 한다 (원래 증상 재현).
    return json({ ok: true, tracks: [
      { id: 'rec1', title: '잘못된 이전 제목', artist: '이전 가수', created_at: '20260101000000Z' },
    ], tagging: false, count: 1 });
  return json({ ok: true, tracks: [] });
};

state.list = [{ id: 'rec1', title: '잘못된 이전 제목', artist: '이전 가수', tag_state: 'done' }];
window.sdyMusic.tagEditor('rec1');
document.getElementById('mpTagTitle').value = '잘못된 이전 제목';
document.getElementById('mpTagArtist').value = '이전 가수';
document.getElementById('mpTagRecog').click();
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(document.getElementById('mpTagTitle').value, '인식된 제목',
  '소리 인식 결과가 제목 칸에 반영되어야 한다');
assert.equal(document.getElementById('mpTagArtist').value, '인식된 가수',
  '소리 인식 결과가 가수 칸에 반영되어야 한다');
assert.ok(apiCalls.some((c) => c.url.includes('/api/music/recognize') && c.method === 'POST'
  && !(c.url.includes('status') || c.url.includes('key'))), '인식 API 를 호출해야 한다');
const recCall = apiCalls.find((c) => c.url.includes('/api/music/recognize') && c.method === 'POST');
assert.ok(recCall, 'recognize 호출 기록');

// 싱크 가사 버튼 — 편집창에 적어둔 제목/가수를 검색어로 보내는지
document.getElementById('mpTagSyncLrc').click();
await new Promise((resolve) => setTimeout(resolve, 100));
const lrcCall = apiCalls.find((c) => c.url.includes('/api/music/synced-lyrics'));
assert.ok(lrcCall, '싱크 가사 API 를 호출해야 한다');
assert.match(String(lrcCall.body || ''), /"q_title":"인식된 제목"/,
  '편집창 제목을 가사 검색 힌트로 보내야 한다');
assert.match(String(lrcCall.body || ''), /"q_artist":"인식된 가수"/);
assert.equal(document.getElementById('mpTagLyrics').value, '[00:01.00] 첫 줄',
  '찾은 싱크 가사가 가사 칸에 반영되어야 한다');

// 표지만 찾기 버튼 — 마찬가지로 편집창 값을 검색어로 보내는지
document.getElementById('mpTagCoverFind').click();
await new Promise((resolve) => setTimeout(resolve, 100));
const covCall = apiCalls.find((c) => c.url.includes('/api/music/lookup')
  && String(c.body || '').includes('cover_only'));
assert.ok(covCall, '표지 찾기 API 를 호출해야 한다');
assert.match(String(covCall.body || ''), /"q_title":"인식된 제목"/,
  '편집창 제목을 표지 검색 힌트로 보내야 한다');

// 전체 곡 화면 우클릭의 '자동으로 태그 찾기'도 편집창 자동 찾기와 같은
// 소리 인식 → 빈칸 채우기 파이프라인을 타야 한다 (예전에는 lookup 한 번뿐).
document.getElementById('mpTagX').click();
apiCalls.length = 0;
window.sdyMusic.menu(20, 20, 'rec1');
const menuAuto = document.querySelector('#mpCtx .ci[data-a="find"]');
assert.ok(menuAuto, '곡 우클릭 메뉴에 자동 찾기가 있다');
menuAuto.click();
await new Promise((resolve) => setTimeout(resolve, 250));
const menuRecog = apiCalls.find((c) => c.url.includes('/api/music/recognize')
  && c.method === 'POST' && !c.url.includes('/status') && !c.url.includes('/key'));
assert.ok(menuRecog, '우클릭 자동 찾기도 먼저 음원 소리 인식을 호출해야 한다');
assert.match(String(menuRecog.body || ''), /"force":true/,
  '우클릭 자동 찾기의 음원 인식은 편집창과 같은 강제 인식 옵션을 쓴다');
assert.ok(apiCalls.some((c) => c.url.includes('/api/music/lookup')
  && String(c.body || '').includes('"fill_only":true')),
  '우클릭 자동 찾기도 기존 값을 보존하는 빈칸 채우기를 쓴다');
assert.ok(!document.getElementById('mpTagModal').classList.contains('show'),
  '우클릭 자동 찾기는 편집창을 억지로 띄우지 않는다');

// 음악 해돌이 — 마우스로 건드리면 현재 싱크 가사를 따라 부른다.
const mpOtter = document.querySelector('.mp-otter');
const mpBubble = document.getElementById('mpOtterBubble');
assert.ok(mpOtter, '음악 해돌이 루트가 있어야 한다');
assert.equal(mpOtter.getAttribute('role'), 'button', '음악 해돌이는 상호작용 가능한 버튼이어야 한다');
assert.equal(mpOtter.getAttribute('tabindex'), '0', '음악 해돌이는 키보드 포커스도 가능해야 한다');
Object.defineProperty(mpOtter, 'offsetParent', { configurable: true, get(){ return document.getElementById('musicPlayer'); } });
const otterTrack = [{ id:'t2', title:'Song 2', artist:'Art 2', lyrics:'[00:01.00]가사 2 첫줄\n[00:02.00]가사 2 둘째줄' }];
state.queue = null; state.currentId = ''; state.idx = 0;
window.sdyPlayFrom(otterTrack, 't2', '');
document.getElementById('musicPlayer').style.display = 'flex';
document.getElementById('musicPlayer').classList.add('mp-bar');
await new Promise(resolve => setTimeout(resolve, 60));
const audio = window.sdyMusic.audio();
Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 1.12 });
audio.dispatchEvent(new window.Event('timeupdate'));
await new Promise(resolve => setTimeout(resolve, 200));   // 120ms 주기 루프가 첫 줄을 띄운다
// 14.23.x · 기본값은 '켜짐' — 음악바가 뜨면 클릭 없이도 따라 부른다
assert.match(mpBubble.textContent, /가사 2 첫줄/, '기본 켜짐 상태에서 현재 싱크 가사를 말해야 한다');
assert.match(mpBubble.textContent, /~\s*$/, '해돌이가 부르는 가사 끝에는 물결표가 붙어야 한다');
// 잠시 기다려 '곡 우클릭 → 첫 클릭은 메뉴 닫기' 600ms 창을 지나가게 한다.
// (바로 앞에서 window.sdyMusic.menu() 로 메뉴를 열었기 때문에, 이 창 안에
//  해돌이를 클릭하면 메뉴 닫기로 삼켜져 토글이 안 먹는다.)
await new Promise(resolve => setTimeout(resolve, 650));
// 클릭하면 꺼진다 (다시 클릭해 켜는 건 별도 — 여기선 꺼짐만 확인)
mpOtter.dispatchEvent(new window.MouseEvent('click', { bubbles:true }));
await new Promise(resolve => setTimeout(resolve, 80));
assert.ok(!mpOtter.classList.contains('singing'), '클릭하면 부르기 모드가 꺼져야 한다');

dom.window.close();
console.log(`Music controls: ${actionIds.length} fixed actions wired; artist filter + identical editor/context auto-find + otter synced lyric verified.`);
