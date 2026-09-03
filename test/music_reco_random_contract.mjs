// ── 음악 추천/대기열 신기능 계약 ─────────────────────────────────────
//  ① 백엔드 태그 추천 엔진: 곡마다 태그를 왕창 뽑아, 태그가 겹치는 곡 묶음
//     (groups)과 곡별 유사곡(sims)을 만든다. 태그 원문은 절대 노출하지 않는다.
//  ② 처음 접속하면 랜덤 20곡이 대기열에 자동으로 채워진다 (자동재생은 없음).
//  ③ 추천 화면 맨 위 '랜덤 믹스' 히어로 — 누르면 아무 곡 20곡으로 대기열 교체 후 재생.
//  ④ 추천 화면에 서버 태그 묶음('나를 위한 추천 믹스') 행이 뜬다.
//  ⑤ 노래를 새로 올리면 (대기열이 있어도) '그 곡'이 바로 재생된다.
//  ⑥ 해돌이 싱크 가사: 호버가 아니라 클릭 토글 — 다시 누를 때까지 계속 부른다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

// ═══ ① 백엔드 추천 엔진 ═══
process.env.SDY_BASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-reco-'));
const { recoBuild, recoExtractTags } = await import('../server/src/routes/music.js');
const routeSrc = fs.readFileSync(new URL('../server/src/routes/music.js', import.meta.url), 'utf8');
assert.match(routeSrc, /app\.get\('\/api\/music\/reco'/, '/api/music/reco 라우트가 있어야 한다');

const mk = (id, title, artist, album, genre, year, lyr, plays = 0) =>
  ({ id, title, artist, album, genre, year, lyrics_plain: lyr, play_count: plays });
const RECS = [
  mk('a1', '밤편지', '아이유', 'Palette', '발라드', '2017', '이 밤 그날의 반딧불을 당신의 창 가까이 사랑한다는 말이에요 사랑 사랑 사랑 밤 밤 밤', 9),
  mk('a2', 'Love poem', '아이유', 'Love poem', '발라드', '2019', '내가 너의 사랑 노래가 되어 줄게 사랑 사랑 사랑 밤 밤 밤', 5),
  mk('b1', 'Dynamite', 'BTS', 'BE', 'K-Pop Dance', '2020', 'in the stars tonight dance dance dance party party party night night night', 20),
  mk('b2', 'Butter', 'BTS', 'Butter', 'K-Pop Dance', '2021', 'smooth like butter dance dance dance party party party night night night', 15),
  mk('c1', 'Shape of You', 'Ed Sheeran', 'Divide', 'Pop', '2017', 'i m in love with the shape of you love love love dance dance dance', 3),
  mk('c2', 'Perfect', 'Ed Sheeran', 'Divide', 'Pop Ballad', '2017', 'i found a love for me darling love love love slow slow ballad', 2),
  mk('d1', '비도 오고 그래서', '헤이즈', '비도', 'R&B', '2017', '비도 오고 그래서 네 생각이 났어 비 비 비 눈물 눈물 눈물 이별 이별 이별', 7),
  mk('d2', 'You Clouds Rain', 'Heize', '비가 오는 날엔', 'R&B Soul', '2017', 'rain rain rain tears tears tears 비 비 비 이별 이별 이별 눈물 눈물 눈물', 4),
];

const tags = recoExtractTags(RECS[0]);
assert.ok(tags.size >= 8, '한 곡에서 태그를 여러 개(언어·템포·무드·장르·가수·연대·가사 키워드…) 뽑아야 한다');
assert.ok(tags.has('lang:kr') && tags.has('genre:발라드'), '언어·장르 태그가 뽑혀야 한다');
assert.ok([...tags].some((t) => t.startsWith('w:')), '가사 키워드 태그도 뽑아야 한다');

const reco = recoBuild(RECS);
assert.equal(reco.count, RECS.length);
assert.ok(Array.isArray(reco.sims.a1) && reco.sims.a1.length >= 3, '곡별 유사곡 목록이 있어야 한다');
assert.equal(reco.sims.a1[0], 'a2', '같은 가수·장르·무드 곡이 가장 비슷해야 한다 (밤편지→Love poem)');
assert.ok(reco.groups.length >= 2, '태그가 겹치는 곡 묶음(그룹)이 나와야 한다');
for (const g of reco.groups) {
  assert.ok(g.ids.length >= 3, '그룹은 3곡 이상이어야 한다');
  assert.doesNotMatch(g.id + ' ' + g.name, /(?:^|[^a-z])(?:lang|tempo|mood|style|vocal|genre|era|artist|album):/,
    '태그 원문(mood:… 같은 내부 표기)은 밖으로 노출하면 안 된다');
  assert.match(g.name, /‘.+’/, '그룹 이름은 태그가 아니라 대표곡 제목으로 짓는다');
}

// ═══ 프런트 (jsdom) ═══
const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');
const fullHtml = html.replace(/<script src="sdynotes\.js(?:\?[^"]*)?"[^>]*><\/script>/, () => '<script>' + js.replace(/<\/script>/g, '<\\/script>') + '</script>');

// 서버 목록: 30곡 (부팅 자동 대기열 검사용)
const tracks = [];
for (let i = 1; i <= 30; i++) {
  tracks.push({ id: 't' + i, title: '곡 ' + i, artist: '가수 ' + ((i % 5) + 1), album: '', created_at: '2026010100' + String(i).padStart(2, '0') + '00Z' });
}
const uploaded = { id: 'new1', title: '방금 올린 곡', artist: '새 가수', created_at: '20260201000000Z' };
let uploadedVisible = false;

const vc = new VirtualConsole();
vc.on('jsdomError', () => {});
const dom = new JSDOM(fullHtml, {
  url: 'http://sdynotes.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(window) {
    window.fetch = async (url) => {
      const u = String(url);
      const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
      if (u.includes('/api/music/list')) {
        const list = uploadedVisible ? tracks.concat([uploaded]) : tracks;
        return json({ ok: true, tracks: list, tagging: false, count: list.length });
      }
      if (u.includes('/api/music/upload')) { uploadedVisible = true; return json({ ok: true, id: 'new1' }); }
      if (u.includes('/api/music/reco')) {
        return json({ ok: true, count: 30, sims: { t1: ['t6', 't11', 't16'] },
          groups: [{ id: 'g1', name: '‘곡 1’ 같은 분위기', size: 4, ids: ['t1', 't6', 't11', 't16'] },
                   { id: 'g2', name: '‘곡 2’ 좋아하면 이것도', size: 3, ids: ['t2', 't7', 't12'] }] });
      }
      return json({ ok: true, tracks: [] });
    };
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
      this._played = true; this.dispatchEvent(new window.Event('play')); return Promise.resolve();
    };
    window.HTMLMediaElement.prototype.pause = function pause() { this.dispatchEvent(new window.Event('pause')); };
    window.HTMLMediaElement.prototype.load = function load() {};
  },
});
await new Promise((r) => setTimeout(r, 450));
const { window } = dom;
const { document } = window;
assert.ok(window.sdyMusic, 'music module should initialize');
const state = window.sdyMusic._state();

// ═══ ② 처음 접속: 랜덤 20곡이 대기열에 자동으로 담긴다 (재생은 안 한다) ═══
assert.ok(Array.isArray(state.queue), '부팅 뒤 대기열이 채워져 있어야 한다');
assert.equal(state.queue.length, 20, '처음 접속하면 정확히 20곡이 대기열에 담긴다');
assert.equal(state.plName, '랜덤 믹스');
assert.equal(new Set(state.queue.map((t) => t.id)).size, 20, '대기열에 같은 곡이 두 번 있으면 안 된다');
assert.ok(!window.sdyMusic.audio()._played, '자동 대기열은 재생을 시작하지 않는다');

// ═══ ③④ 추천 화면: 랜덤 믹스 히어로 + 서버 태그 묶음 행 ═══
window.sdyMusic.big();
state.bigTab = 'd';
window.sdyMusic.bigList();
await new Promise((r) => setTimeout(r, 150));    // /api/music/reco 도착 → 재렌더
window.sdyMusic.bigList();
const body = document.getElementById('mpBBody');
const hero = body.querySelector('[data-reco-random]');
assert.ok(hero, '추천 맨 위에 랜덤 믹스 버튼이 있어야 한다');
assert.equal(hero.dataset.recoRandom, '20');
assert.ok(body.textContent.includes('나를 위한 추천 믹스'), '서버 태그 묶음 행이 보여야 한다');
assert.ok(body.textContent.includes('‘곡 1’ 같은 분위기'), '태그 묶음 카드(대표곡 이름)가 보여야 한다');
assert.doesNotMatch(body.textContent, /(?:mood|tempo|lang|genre|vocal|style):/, '화면에 태그 원문이 보이면 안 된다');

hero.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 60));
assert.equal(state.queue.length, 20, '랜덤 믹스를 누르면 대기열이 20곡으로 교체된다');
assert.equal(state.plName, '랜덤 믹스');
assert.equal(window.sdyMusic.cur().id, state.queue[0].id, '교체된 대기열의 첫 곡이 재생된다');
assert.ok(window.sdyMusic.audio()._played, '랜덤 믹스는 바로 재생을 시작한다');

// 서버 묶음 카드를 누르면 그 묶음 전체로 대기열이 교체된다
state.bigTab = 'd';
window.sdyMusic.bigList();
const grpCard = body.querySelector('[data-reco-playlist^="srv%3A"], [data-reco-playlist^="srv:"]');
assert.ok(grpCard, '서버 태그 묶음 카드가 있어야 한다');
grpCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 60));
assert.ok(state.queue.length >= 3 && state.queue.length <= 4, '태그 묶음 곡들만 대기열에 남는다');
assert.equal(window.sdyMusic.cur().id, state.queue[0].id);

// ═══ ⑤ 새로 올린 곡이 (대기열 첫 곡이 아니라) 바로 재생된다 ═══
const beforeQueueLen = state.queue.length;
const file = new window.File(['x'], '방금올린곡.mp3', { type: 'audio/mpeg' });
await document.getElementById('musicFile').onchange({ target: { files: [file], value: '' } });
await new Promise((r) => setTimeout(r, 120));
assert.equal(window.sdyMusic.cur().id, 'new1', '업로드 직후에는 방금 올린 그 곡이 재생돼야 한다');
assert.ok(state.queue.some((t) => t.id === 'new1'), '올린 곡이 대기열에 끼워져 있어야 한다');
assert.equal(state.queue.length, beforeQueueLen + 1, '기존 대기열은 유지한 채 한 곡만 끼운다');

// ═══ ⑥ 해돌이: 클릭 토글로 계속 부른다 ═══
const mpOtter = document.querySelector('.mp-otter');
const mpBubble = document.getElementById('mpOtterBubble');
assert.ok(mpOtter && mpBubble);
Object.defineProperty(mpOtter, 'offsetParent', { configurable: true, get() { return document.getElementById('musicPlayer'); } });
const otterTrack = [{ id: 'sy1', title: 'Sync Song', artist: 'Art', lyrics: '[00:01.00]첫 소절이야\n[00:05.00]둘째 소절이야' }];
window.sdyPlayFrom(otterTrack, 'sy1', '');
document.getElementById('musicPlayer').style.display = 'flex';
document.getElementById('musicPlayer').classList.add('mp-bar');
await new Promise((r) => setTimeout(r, 60));
const audio = window.sdyMusic.audio();
Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 1.2 });
await new Promise((r) => setTimeout(r, 200));     // 120ms 주기 루프가 첫 줄을 띄운다

// 14.23.x · 기본값은 '켜짐' — 음악바가 뜨면 곧바로 따라 부른다(클릭 전에도)
assert.ok(mpOtter.classList.contains('singing'), '기본값: 음악바가 뜨면 부르기 모드가 켜져야 한다');
assert.equal(mpOtter.getAttribute('aria-pressed'), 'true');
assert.match(mpBubble.textContent, /첫 소절이야~/, '기본 켜짐 상태에서 현재 싱크 가사를 부른다');
assert.ok(mpBubble.classList.contains('show'));

// 계속: 시간이 흘러 줄이 바뀌면 알아서 다음 줄을 부른다
audio.currentTime = 5.2;
await new Promise((r) => setTimeout(r, 300));
assert.match(mpBubble.textContent, /둘째 소절이야~/, '부르기 모드가 유지되는 동안 다음 줄로 넘어가야 한다');
assert.ok(mpBubble.classList.contains('show'), '부르는 동안 말풍선이 꺼지지 않는다');

// 끄기: 클릭 → 조용해진다
mpOtter.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 80));
assert.ok(!mpOtter.classList.contains('singing'), '클릭하면 부르기 모드가 꺼져야 한다');
assert.equal(mpOtter.getAttribute('aria-pressed'), 'false');
assert.ok(!mpBubble.classList.contains('show'), '끄면 말풍선이 사라진다');
audio.currentTime = 1.2;
await new Promise((r) => setTimeout(r, 300));
assert.ok(!mpBubble.classList.contains('show'), '꺼진 뒤에는 가사를 따라 부르지 않는다');

// 다시 켜기: 또 클릭 → 다시 부른다
mpOtter.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 80));
assert.ok(mpOtter.classList.contains('singing'), '다시 클릭하면 부르기 모드가 켜져야 한다');
assert.equal(mpOtter.getAttribute('aria-pressed'), 'true');
assert.match(mpBubble.textContent, /첫 소절이야~/, '다시 켜면 현재 싱크 가사를 부른다');

// 호버로는 부르지 않는다 (클릭 토글 전용) — 꺼진 상태에서 호버해도 켜지지 않는다
mpOtter.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));   // 먼저 끈다
await new Promise((r) => setTimeout(r, 80));
assert.ok(!mpOtter.classList.contains('singing'), '끈 상태를 확인한다');
mpOtter.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
mpOtter.dispatchEvent(new window.MouseEvent('mouseenter'));
await new Promise((r) => setTimeout(r, 250));
assert.ok(!mpOtter.classList.contains('singing'), '호버링으로는 부르기 모드가 켜지지 않는다');

dom.window.close();
console.log('Music reco/random/queue/otter contract: backend tag engine + random-20 boot queue + hero + server mixes + upload-plays-new + otter click toggle all verified.');
