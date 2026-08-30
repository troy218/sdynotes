/* 16.2 · 엽스코드 입장 게이트 + 이메일 OTP 로그인 계약 테스트
   (jsdom · yp 스크립트 블록과 로그인 블록만 갈라 넣는다 — yp_smoke_v4 방식)

   다루는 것:
     ① 페이지를 열자마자 자동 입장하지 않는다 (칩을 눌러야 시작)
     ② 칩 → 게이트(#ypGate): '로그인하고 입장' / '비회원으로 입장' 두 문
     ③ 비회원 입장 → 조인(fetch 에 토큰 없음) → 창 열림
     ④ 로그인하고 입장 → OTP 모달 → 코드 확인 → 자동 입장(토큰 헤더)
     ⑤ 이미 로그인한 상태 → 게이트 없이 바로 고정닉 입장
     ⑥ 곡 올리기/목록 마크의 소스 계약 (sdyAuthHeaders · mp-upmark)
*/
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const htmlAll = fs.readFileSync(path.join(ROOT, 'sdynotes.html'), 'utf8');
const jsAll = fs.readFileSync(path.join(ROOT, 'sdynotes.js'), 'utf8');
const cssAll = fs.readFileSync(path.join(ROOT, 'sdynotes.css'), 'utf8');

// ── HTML 조각: 로그인 모달 + 게이트 + 엽스코드 앱 ──
const hs = htmlAll.indexOf('<!-- ═══════════════ 16.2 · 로그인/회원');
const he = htmlAll.indexOf('</body>', hs);
if (hs < 0 || he < 0) throw new Error('로그인/엽스코드 HTML 블록을 찾지 못했습니다');
const htmlBlock = htmlAll.slice(hs, he);

// ── JS 조각: yp 블록(10) + 로그인 블록(12) ──
const b10 = jsAll.indexOf('/* === script block 10 === */');
const b11 = jsAll.indexOf('/* === script block 11 === */');
const b12 = jsAll.indexOf('/* === script block 12 === */');
if (b10 < 0 || b11 < 0 || b12 < 0) throw new Error('스크립트 블록 경계를 찾지 못했습니다');
const jsBlock = jsAll.slice(b10, b11) + '\n' + jsAll.slice(b12);

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? '✅ ' : '❌ ') + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function makeEnv({ presetAuth } = {}) {
  const calls = { join: [], otp: [], verify: [], me: [] };
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { const m = String(e.message || e); if (!/not implemented|scrollTo/i.test(m)) errors.push(m.slice(0, 100)); });

  let esInst = null;
  class FakeEventSource {
    constructor(url) { this.url = url; this.listeners = {}; esInst = this; }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    close() {}
  }
  function json(o) { return { status: 200, ok: true, json: () => Promise.resolve(o) }; }
  const fetchMock = (url, opts = {}) => {
    url = String(url);
    let body = {};
    try { body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : {}; } catch (e) { /* */ }
    const h = opts.headers || {};
    if (url.startsWith('/api/chat/join')) { calls.join.push({ body, header: h['x-sdy-auth'] || '' }); return Promise.resolve(json({ ok: true, ttl: 86400, bgm: null, voice: 'relay', me: { uid: body.uid, name: body.name, color: '#fda4af', verified: !!h['x-sdy-auth'] }, members: [], msgs: [] })); }
    if (url.startsWith('/api/chat/ping')) return Promise.resolve(json({ ok: true }));
    if (url.startsWith('/api/auth/otp')) { calls.otp.push(body); return Promise.resolve(json({ ok: true, registered: false, dev_code: '246810', expires_in: 600 })); }
    if (url.startsWith('/api/auth/verify')) { calls.verify.push(body); return Promise.resolve(json({ ok: true, token: 'tok123', user: { uid: 'u_1', email: 'a@b.local', nick: '고정닉새' } })); }
    if (url.startsWith('/api/auth/me')) { calls.me.push({}); return Promise.resolve(json({ ok: true, user: { uid: 'u_1', email: 'a@b.local', nick: '고정닉새' } })); }
    return Promise.resolve(json({ ok: true }));
  };

  const dom = new JSDOM('<div id="musicPlayer" class="mp-bar" style="display:none"></div><button id="mpReopen" style="display:none"></button>' +
    '<button id="sdyAccBtn" class="tool-btn"><i class="ri-user-3-line"></i><span id="sdyAccDot"></span></button>' +
    htmlBlock, {
    url: 'http://localhost:5000/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.sessionStorage.setItem('sdy_yp_uid', 'yp_test');
      w.fetch = fetchMock;
      w.EventSource = FakeEventSource;
      w.Element.prototype.scrollTo = function () {};
      if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      if (!w.requestAnimationFrame) w.requestAnimationFrame = (fn) => setTimeout(fn, 16);
    },
  });
  const w = dom.window;
  const d = w.document;
  const $ = (id) => d.getElementById(id);
  if (presetAuth) {
    w.localStorage.setItem('sdy_auth_v1', JSON.stringify({ token: 'tok123', user: { uid: 'u_1', email: 'a@b.local', nick: '고정닉새' } }));
  }
  const s = d.createElement('script');
  s.textContent = jsBlock;
  d.body.appendChild(s);
  return { w, d, $, calls, errors, es: () => esInst };
}

(async () => {
  // ── 1부 · 소스 계약 ──
  ok('소스: 칩 클릭이 입장 게이트(ypEnter)로 간다', /chip\.onclick=function\(\)\{ if\(YP\.open\) ypClose\(\); else ypEnter\(\); \}/.test(jsAll));
  ok('소스: 페이지 로드 시 자동 ypJoin() 이 사라졌다 (게이트로 이동)', !/\n  ypDrag\(\);\n  ypJoin\(\);\n\}\)\(\);/.test(jsAll));
  ok('소스: 곡 올리기가 로그인 토큰을 함께 보낸다', /fetch\('\/api\/music\/upload',\{method:'POST',body:fd,headers:auH\}\)/.test(jsAll));
  ok('소스: 유튜브 담기도 토큰을 함께 보낸다', /Object\.assign\(\{'Content-Type':'application\/json'\},window\.sdyAuthHeaders\?window\.sdyAuthHeaders\(\):\{\}\)/.test(jsAll));
  ok('소스: 목록 행에 올린 사람 마크(mp-upmark)가 있다', /t\.uploader\?`<span class="mp-upmark"/.test(jsAll));
  ok('소스: 로그인 모달·게이트·계정 버튼이 HTML에 있다', htmlAll.includes('id="sdyAuthWrap"') && htmlAll.includes('id="ypGate"') && htmlAll.includes('id="sdyAccBtn"') && htmlAll.includes('id="ypgLogin"') && htmlAll.includes('id="ypgGuest"'));
  ok('소스: 회원 배지·마크 CSS가 있다', cssAll.includes('.yp-verified') && cssAll.includes('.mp-upmark') && cssAll.includes('#ypGate'));
  // 18.3 · 게이트 편지 해돌이 혼잣말: 말풍선 + 주기 멘트 배열이 들어 있어야 한다
  ok('소스: 게이트 편지 해돌이 혼잣말(18.3)이 있다', jsAll.includes("18.3 · 엽스코드/집중(스톱워치·타이머)/비행기 해돌이 혼잣말") && jsAll.includes('#ypGate .yp-otter'));
  ok('소스: 비행기 해돌이에 말풍선이 추가됐다', /id="planeOtter"[\s\S]{0,2000}<span class="om-say"><\/span>/.test(htmlAll));
  ok('소스: 사용법(졸리는) 해돌이는 혼잣말 대상이 아니다', !/18\.3[\s\S]{0,1200}keys-otter/.test(jsAll));

  // ── 2부 · 비회원 흐름 ──
  {
    const e = makeEnv();
    const $ = e.$;
    await wait(120);
    ok('초기: 자동 입장하지 않는다 (join 0회)', e.calls.join.length === 0);
    ok('초기: 게이트도 창도 닫혀 있다', $('ypGate').style.display === 'none' && !$('ypApp').classList.contains('open'));
    $('ypReopen').click();
    ok('칩 클릭 → 게이트 등장', $('ypGate').style.display === 'flex' && !$('ypApp').classList.contains('open'));
    ok('게이트: 두 선택지가 있다', !!$('ypgLogin') && !!$('ypgGuest'));
    $('ypgGuest').click();
    await wait(80);
    ok('비회원 입장 → 게이트 닫힘 + 창 열림', $('ypGate').style.display === 'none' && $('ypApp').classList.contains('open'));
    ok('비회원 입장 → 토큰 없이 조인', e.calls.join.length === 1 && !e.calls.join[0].header);
    $('ypFold').click();
    await wait(340);
    ok('접고 다시 칩 → 재게이트 없이 바로 열림', (() => { $('ypReopen').click(); return $('ypApp').classList.contains('open') && $('ypGate').style.display === 'none'; })());
    ok('이미 입장했으면 조인을 다시 안 한다', e.calls.join.length === 1);
  }

  // ── 3부 · 게이트에서 로그인 흐름 ──
  {
    const e = makeEnv();
    const { w } = e;
    const $ = e.$;
    await wait(120);
    $('ypReopen').click();
    $('ypgLogin').click();
    ok('로그인 선택 → OTP 모달 열림 + 게이트 닫힘', $('sdyAuthWrap').style.display === 'flex' && $('ypGate').style.display === 'none');
    $('saEmail').value = 'bird@test.local';
    w.sdyAuthSend();
    await wait(40);
    ok('OTP: 코드 단계 + 새 회원 닉네임 칸 노출', $('saStepCode').style.display === 'block' && $('saNickRow').style.display === 'block');
    ok('OTP: 요청이 서버에 닿았다', e.calls.otp.length === 1 && e.calls.otp[0].email === 'bird@test.local');
    $('saCode').value = '246810';
    $('saNick').value = '고정닉새';
    w.sdyAuthVerify();
    await wait(80);
    ok('로그인 성공 → 모달 닫힘 + 엽스코드 자동 입장', $('sdyAuthWrap').style.display === 'none' && $('ypApp').classList.contains('open'));
    ok('로그인 입장 → 조인에 토큰 헤더', e.calls.join.length === 1 && e.calls.join[0].header === 'tok123');
    ok('sdyUser() 가 고정닉을 안다', w.sdyUser() && w.sdyUser().nick === '고정닉새');
    ok('계정 버튼에 on 표시', $('sdyAccBtn').classList.contains('on'));
  }

  // ── 4부 · 이미 로그인한 상태 → 게이트 생략 ──
  {
    const e = makeEnv({ presetAuth: true });
    const $ = e.$;
    await wait(140);
    ok('로그인 상태 부팅 → 세션 확인(me) 호출', e.calls.me.length >= 1);
    $('ypReopen').click();
    await wait(40);
    ok('로그인 상태 칩 클릭 → 게이트 없이 바로 입장', $('ypGate').style.display === 'none' && $('ypApp').classList.contains('open'));
    ok('로그인 상태 조인 → 토큰 헤더', e.calls.join.length >= 1 && e.calls.join[e.calls.join.length - 1].header === 'tok123');
  }

  console.log(`\n엽스코드 게이트+로그인 계약: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
