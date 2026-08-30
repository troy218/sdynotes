/* 18.3 · 엽스코드 '해돌이 임티'(카톡 미모티콘식) 계약
   ---------------------------------------------------------------------------
   1) 유니코드 이모지 배열은 사라지고, 임티는 #ypStickerDefs 의
      <template data-stk="아이디" data-label="이름"> 블록에서만 정의된다.
   2) 선택창(ypEmoji) 버튼은 임티 목록만큼 생기고, 누르면 [hd:아이디] 코드가
      입력창에 들어간다. (채팅으로 보내면 상대에게 해돌이 그림으로 보인다)
   3) 메시지가 임티 하나로만 이뤄지면 말풍선 없이 큰 스티커(yp-stkmsg),
      텍스트 속 임티는 작은 인라인 스티커로 그린다.
   4) 반응도 유니코드 대신 hd:아이디 를 쓰고, 서버는 hd: 접두사면
      새 아이디도 받아들인다 (나중에 임티를 추가해도 서버 수정 불필요). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../sdynotes.css', import.meta.url), 'utf8');
const chat = fs.readFileSync(new URL('../server/src/routes/chat.js', import.meta.url), 'utf8');

/* ── 정적 계약 ─────────────────────────────────────────────────────────── */
const tplCount = (html.match(/<template data-stk="[a-z0-9_-]+" data-label="[^"]+">/g) || []).length;
assert.ok(tplCount >= 8, `임티 템플릿이 8개 이상이어야 한다 (실제 ${tplCount})`);
assert.match(html, /<div id="ypStickerDefs" hidden>/,
  '임티 정의 컨테이너(#ypStickerDefs)가 있어야 한다');
assert.match(html, /<template data-stk="hello" data-label="안녕">/,
  'hello(안녕) 임티가 있어야 한다');
assert.doesNotMatch(js, /var EMOJIS=\['😀/, '유니코드 이모지 배열이 사라져야 한다');
assert.match(js, /var REACTIONS=\['hd:hello',/, '반응도 해돌이 임티(hd:)여야 한다');
assert.match(js, /STK_TEXT=\/\\\[hd:\(\[a-z0-9_-\]\{1,24\}\)\\\]\/g/, '채팅 코드 [hd:아이디] 규칙이 있어야 한다');
assert.match(js, /window\.__ypStk=/, '테스트 훅 __ypStk 가 있어야 한다');
assert.match(css, /\.yp-stkmsg\{/, '임티 전용 메시지(yp-stkmsg) 스타일이 있어야 한다');
assert.match(css, /\.yp-stk-big\{/, '큰 스티커(yp-stk-big) 스타일이 있어야 한다');
assert.match(css, /\.yp-stk-chip\{/, '반응용 작은 스티커(yp-stk-chip) 스타일이 있어야 한다');
assert.match(chat, /const REACTIONS = \['hd:hello',/, '서버 반응 목록이 해돌이 임티다');
assert.match(chat, /\/\^hd:\[a-z0-9_-\]\{1,24\}\$\/\.test\(emoji\)/,
  '서버는 hd: 접두사면 새 임티 아이디도 받아들인다');
assert.match(chat, /REACT_LEGACY/, '옛 유니코드 반응은 호환용으로 남아 있다');

/* ── 런타임 계약 (jsdom) ──────────────────────────────────────────────── */
const fullHtml = html.replace(/<script src="sdynotes\.js(?:\?[^"]*)?"[^>]*><\/script>/,
  '<script>' + js + '</script>');
const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', e => { if (!/Could not load/.test(e.message)) errors.push(e.message); });
let posted = [];
const dom = new JSDOM(fullHtml, {
  url: 'http://sdynotes.test/',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.fetch = async (url, opt) => {
      if (opt && opt.method === 'POST') posted.push({ url, body: opt.body });
      return new Response(JSON.stringify({ tracks: [], ok: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };
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

await new Promise(r => setTimeout(r, 400));
const { window } = dom;
const { document } = window;
const stk = window.__ypStk;

// ① 임티 목록 = 템플릿 목록, 각각 그림(use)으로 클론된다
const list = stk.list();
assert.ok(Array.isArray(list) && list.length === tplCount,
  `__ypStk.list() 는 템플릿 수와 같아야 한다 (${list.length}/${tplCount})`);
const hello = stk.svg('hello', 'yp-stk-big');
assert.ok(hello && hello.querySelector('svg use[href="#om-m-body"]'),
  '임티는 공용 부품(use)으로 그려져야 한다');
assert.ok(hello.className.includes('yp-stk'), '임티에 yp-stk 클래스가 붙는다');
assert.ok(hello.className.includes('om-w-mail'),
  '임티는 그림이 아니라 움직이는 SVG — 동작 클래스(om-w-mail)가 유지돼야 한다');
assert.ok(/\.om-w-mail \.om-anim\{animation:om-bob/.test(css),
  '둥실(om-bob) 애니메이션 규칙이 CSS 에 남아 있어야 한다');
assert.ok(/\.om-wavehand\{animation:om-wavehand/.test(css),
  '손 흔들기(om-wavehand) 애니메이션 규칙이 있어야 한다');
const sleepy = stk.svg('sleep', 'yp-stk-big');
assert.ok(sleepy.className.includes('om-w-sleep'), '졸려 임티도 동작 클래스가 유지된다');

// ② 선택창: 목록 수만큼 버튼, 누르면 [hd:아이디] 가 입력창에 들어간다
const emo = document.getElementById('ypEmoji');
assert.equal(emo.querySelectorAll('button').length, list.length, '선택창 버튼 수 = 임티 수');
const firstBtn = emo.querySelector('button');
assert.ok(firstBtn.querySelector('.yp-stk'), '선택창 버튼 안에 임티 그림이 있다');
firstBtn.click();
const ta = document.getElementById('ypTxt');
assert.ok(ta.value.includes('[hd:' + firstBtn.getAttribute('data-e') + ']'),
  `선택하면 [hd:아이디] 가 입력창에 들어간다 (${ta.value})`);

// ③ 렌더: 임티 하나만 = 큰 스티커, 섞임 = 인라인
assert.equal(stk.only('[hd:hello]'), 'hello', '임티 하나만 온 메시지 판별');
assert.equal(stk.only('좋아 [hd:hello]!'), null, '섞인 메시지는 전체 임티가 아니다');
const mixed = document.createElement('div');
stk.render(mixed, '안녕 [hd:hello] 반가워 [hd:coffee]!');
assert.equal(mixed.querySelectorAll('.yp-stk-inline').length, 2, '섞인 텍스트는 인라인 임티로');
assert.ok(mixed.textContent.includes('안녕') && mixed.textContent.includes('반가워'),
  '주변 텍스트는 그대로 남는다');

// ④ 반응도 hd: 로 전송된다
posted = [];
window.__ypReact(7, 'hd:love');
await new Promise(r => setTimeout(r, 60));
const reactPost = posted.find(p => String(p.url).includes('/api/chat/react'));
assert.ok(reactPost && JSON.parse(reactPost.body).emoji === 'hd:love',
  '반응은 hd:아이디 로 서버에 간다');
assert.equal(errors.length, 0, '런타임 오류 없음: ' + errors.slice(0, 2).join(' | '));

console.log('엽스코드 해돌이 임티 계약: PASS');
dom.window.close();
process.exit(0);
