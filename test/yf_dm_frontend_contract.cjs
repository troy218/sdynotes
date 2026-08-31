/* 16.3 · 친구 + 1:1 대화(DM) 프런트 계약 테스트 (jsdom)
   sdynotes.html 의 엽스코드 DOM + sdynotes.js 의 script block 10(엽스코드)·12(인증)을
   인라인으로 실행하고, mock fetch/EventSource 로 다음을 검증한다:
     · 헤더에 친구 버튼/뒤로 버튼 — 친구 패널 표시·로그인 안내
     · 로그인 → 친구 목록 렌더(닉네임·온라인 점·안 읽은 뱃지)
     · 친구 클릭 → 1:1 대화 뷰(제목·placeholder·버블·읽음 '1')
     · 텍스트 전송 → /api/dm/msg 호출 계약
     · 회원 SSE dm_msg 이벤트 → 칩 뱃지 갱신
     · 뒤로가기 → 공용방 뷰 복귀
*/
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const htmlFull = fs.readFileSync(path.join(root, 'sdynotes.html'), 'utf8');
const jsFull = fs.readFileSync(path.join(root, 'sdynotes.js'), 'utf8');

// ── 필요한 DOM 만 추출: 인증 모달 · 입장 게이트 · 엽스코드 앱 ──
function extractHtml() {
  const s = htmlFull.indexOf('<div id="sdyAuthWrap"');
  if (s < 0) throw new Error('sdyAuthWrap 을 찾지 못했습니다');
  const e = htmlFull.indexOf('id="ypFileInp"');
  if (e < 0) throw new Error('ypFileInp 를 찾지 못했습니다');
  const e2 = htmlFull.indexOf('</div>', e);
  return htmlFull.slice(s, e2 + 6);
}
// ── 필요한 script block 만 추출 (다른 블록은 음악 등 무관한 DOM 을 많이 탐) ──
function extractBlock(name, next) {
  const s = jsFull.indexOf(`/* === script block ${name} === */`);
  if (s < 0) throw new Error(`script block ${name} 을 찾지 못했습니다`);
  const e = jsFull.indexOf(`/* === script block ${next} === */`);
  return jsFull.slice(s, e < 0 ? jsFull.length : e);
}
const block10 = extractBlock('10', '11');
const block12 = extractBlock('12', null);
if (!/var YF=/.test(block10)) throw new Error('block 10 에 16.3(YF) 코드가 없습니다');
if (!/ypFrBtn/.test(block10)) throw new Error('친구 버튼 배선이 block 10 에 없습니다');

// ── mock 네트워크 ──
const ME = { uid: 'u_me', email: 'me@test.local', nick: '첫째새' };
const FRIEND = { uid: 'u_b', nick: '둘째새' };
const calls = { dmMsg: [], dmRead: [], chatJoin: [] };
let dmSse = null;

function json(o) { return { ok: true, json: () => Promise.resolve(o) }; }
function makeFetch() {
  return (url, opts = {}) => {
    url = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    try { body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : {}; } catch { body = {}; }
    if (url.startsWith('/api/auth/me')) return Promise.resolve(json({ ok: true, user: ME }));
    if (url.startsWith('/api/friends/list')) {
      return Promise.resolve(json({ ok: true, friends: [{ uid: FRIEND.uid, nick: FRIEND.nick, since: 1, online: true }], requests: { incoming: [], outgoing: [] } }));
    }
    if (url.startsWith('/api/dm/threads')) {
      return Promise.resolve(json({ ok: true, threads: [{ uid: FRIEND.uid, nick: FRIEND.nick, online: true, last: null, unread: 2 }] }));
    }
    if (url.startsWith('/api/dm/history/')) {
      return Promise.resolve(json({
        ok: true, more: false, last: 2, peer_read: 0,
        peer: { uid: FRIEND.uid, nick: FRIEND.nick, online: true },
        msgs: [
          { id: 1, from: 'u_me', kind: 'txt', text: '먼저 보낸 말', ts: 100 },
          { id: 2, from: FRIEND.uid, name: FRIEND.nick, kind: 'txt', text: '응 받았어', ts: 120 },
        ],
      }));
    }
    if (url.startsWith('/api/dm/msg')) {
      calls.dmMsg.push(body);
      return Promise.resolve(json({ ok: true, msg: { id: 3, from: 'u_me', kind: 'txt', text: body.text, ts: 130 } }));
    }
    if (url.startsWith('/api/dm/read')) { calls.dmRead.push(body); return Promise.resolve(json({ ok: true, read: body.id })); }
    if (url.startsWith('/api/chat/join')) {
      calls.chatJoin.push(body);
      return Promise.resolve(json({
        ok: true, ttl: 86400, bgm: null, voice: 'relay', reactions: [],
        me: { uid: 'yp_x', name: ME.nick, color: '#a5b4fc', verified: true },
        members: [], msgs: [],
      }));
    }
    return Promise.resolve(json({ ok: true }));
  };
}
class FakeES {
  constructor(url) { this.url = url; this.listeners = {}; FakeES.all.push(this); }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  close() { this.closed = true; }
  fire(t, obj) { (this.listeners[t] || []).forEach((fn) => fn({ data: JSON.stringify(obj) })); }
}
FakeES.all = [];

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/not implemented|scrollTo/i.test(String(e.message || ''))) errors.push(String(e && e.message || e)); });
vc.on('error', (...a) => errors.push(a.join(' ')));

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? '✅ ' : '❌ ') + name); };

(async () => {
  const dom = new JSDOM(
    '<body>' + extractHtml() +
    '<scr' + 'ipt>' + block10.replace(/<\/script/gi, '<\\/script') + '</scr' + 'ipt>' +
    '<scr' + 'ipt>' + block12.replace(/<\/script/gi, '<\\/script') + '</scr' + 'ipt>' +
    '</body>',
    {
      url: 'http://localhost:5000/',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole: vc,
      beforeParse(w) {
        w.fetch = makeFetch();
        w.EventSource = FakeES;
        // 로그인 상태로 부팅 (sdy_auth_v1 — 인증 모듈이 부팅 때 /api/auth/me 로 확인)
        w.localStorage.setItem('sdy_auth_v1', JSON.stringify({ token: 'tok_test', user: ME }));
        w.toast = function () {};
        w.confirm = function () { return true; };
        w.Element.prototype.scrollTo = function () {};
        w.alert = function () {};
      },
    }
  );
  const w = dom.window; const d = w.document;
  const $ = (id) => d.getElementById(String(id).replace(/^#/, ''));

  await wait(120);   // 인증 확인 + 친구/스레드 로드 마무리 대기

  // 1) 인증 모듈이 토큰을 살리고 YF 가 회원 SSE 를 열었는가
  dmSse = FakeES.all.find((es) => es.url.includes('/api/dm/stream'));
  ok('회원 SSE(/api/dm/stream) 연결', !!dmSse);
  ok('칩에 안 읽은 뱃지 2 표시', (() => { const b = $('ypChipDm'); return b && b.style.display !== 'none' && b.textContent === '2'; })());

  // 2) 헤더 친구 버튼 → 친구 화면
  ok('친구 버튼이 헤더에 있다', !!$('ypFrBtn') && !!$('ypBack'));
  $('ypReopen').click();          // 로그인 상태라 바로 입장 + 열기
  await wait(60);
  $('ypFrBtn').click();
  await wait(60);
  ok('친구 화면 표시 + 공용방 숨김', $('ypFriends').style.display !== 'none' && $('ypBody').style.display === 'none');
  ok('제목이 "친구 · 1:1 대화"', $('ypTtlTxt').textContent.includes('친구'));
  ok('뒤로 버튼 보임', $('ypBack').style.display !== 'none');
  const rows = [...d.querySelectorAll('#ypFriends .ypfr-item[data-open]')];
  ok('친구 행이 그려졌다 (둘째새)', rows.length === 1 && rows[0].textContent.includes('둘째새'));
  ok('온라인 점이 켜져 있다', !!d.querySelector('#ypFriends .on-dot.on'));
  ok('행에 안 읽은 뱃지 2', (() => { const u = d.querySelector('#ypFriends .ypfr-unread'); return u && u.textContent === '2'; })());
  ok('친구 화면에선 입력창 숨김', (() => { const f = d.querySelector('#ypApp .yp-foot'); return f && f.style.display === 'none'; })());
  ok('닉네임 입력칸이 있다', !!$('ypFrAddInp'));

  // 3) 친구 행 클릭 → 1:1 대화 뷰
  rows[0].click();
  await wait(80);
  ok('대화 뷰 표시 (ypDmBody)', $('ypDmBody').style.display !== 'none' && $('ypFriends').style.display === 'none');
  ok('제목이 온라인 표시+닉네임', $('ypTtlTxt').textContent.includes('둘째새') && $('ypTtlTxt').textContent.includes('🟢'));
  ok('placeholder 가 "…님에게 메시지…"', $('ypTxt').placeholder.includes('둘째새'));
  const bubbles = [...$('ypDmBody').querySelectorAll('.yp-bub')].map((el) => el.textContent);
  ok('히스토리 버블 2개 렌더', bubbles.length === 2 && bubbles[0] === '먼저 보낸 말' && bubbles[1] === '응 받았어');
  ok('내 메시지에 읽음 "1" 표시 (peer_read=0)', $('ypDmBody').querySelectorAll('.yp-dm-cnt').length === 1);
  ok('읽은 뒤엔 열었으니 read 가 서버로 간다', calls.dmRead.length >= 1 && calls.dmRead[calls.dmRead.length - 1].to === 'u_b');

  // 4) 텍스트 전송 계약
  $('ypTxt').value = '실시간 테스트야';
  $('ypSend').click();
  await wait(60);
  ok('/api/dm/msg 로 {to:u_b} 전송', calls.dmMsg.length === 1 && calls.dmMsg[0].to === 'u_b' && calls.dmMsg[0].text === '실시간 테스트야');
  const after = [...$('ypDmBody').querySelectorAll('.yp-bub')].map((el) => el.textContent);
  ok('전송 버블이 화면에 붙는다', after[after.length - 1] === '실시간 테스트야');

  // 5) SSE 수신: 친구가 보낸 메시지 → 뱃지/버블
  dmSse.fire('dm', { type: 'dm_msg', peer: 'u_b', msg: { id: 4, from: 'u_b', name: '둘째새', kind: 'txt', text: '나도 왔어', ts: 140 }, unread: 1 });
  await wait(30);
  const now = [...$('ypDmBody').querySelectorAll('.yp-bub')].map((el) => el.textContent);
  ok('SSE 메시지 즉시 렌더', now[now.length - 1] === '나도 왔어');

  // 6) 뒤로가기 → 공용방
  $('ypBack').click();
  await wait(20);
  ok('공용방으로 복귀', $('ypBody').style.display !== 'none' && $('ypDmBody').style.display === 'none');
  ok('제목이 다시 엽스코드', $('ypTtlTxt').textContent === '엽스코드');
  ok('placeholder 복구', $('ypTxt').placeholder === '메시지 보내기…');

  // 7) 친구 버튼 다시 → 목록 재진입 가능
  $('ypFrBtn').click();
  await wait(40);
  ok('친구 화면 재진입', $('ypFriends').style.display !== 'none');

  ok('콘솔 에러 없음', errors.length === 0);
  if (errors.length) console.log('  에러:', errors.slice(0, 3));

  // ═══ 시나리오 B: 비로그인 — 친구 버튼 → 로그인 안내 ═══
  FakeES.all.length = 0;
  const dom2 = new JSDOM(
    '<body>' + extractHtml() +
    '<scr' + 'ipt>' + block10.replace(/<\/script/gi, '<\\/script') + '</scr' + 'ipt>' +
    '<scr' + 'ipt>' + block12.replace(/<\/script/gi, '<\\/script') + '</scr' + 'ipt>' +
    '</body>',
    {
      url: 'http://localhost:5000/',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole: vc,
      beforeParse(w) {
        w.fetch = makeFetch();
        w.EventSource = FakeES;
        // 토큰 없음 — 비로그인
        w.toast = function () {};
        w.confirm = function () { return true; };
        w.Element.prototype.scrollTo = function () {};
        w.alert = function () {};
      },
    }
  );
  const w2 = dom2.window; const d2 = w2.document;
  const $2 = (id) => d2.getElementById(String(id).replace(/^#/, ''));
  await wait(80);
  ok('비로그인: 회원 SSE 를 열지 않는다', !FakeES.all.some((es) => es.url.includes('/api/dm/stream')));
  ok('비로그인: 칩 뱃지 없음', (() => { const b = $2('ypChipDm'); return b && b.style.display === 'none'; })());
  $2('ypFrBtn').click();
  await wait(40);
  ok('비로그인: 친구 화면에 로그인 안내 카드', (() => { const c = $2('ypFrLoginBtn'); return !!c && $2('ypFriends').textContent.includes('로그인'); })());
  $2('ypFrLoginBtn').click();
  await wait(30);
  // 인증 모달(진짜 sdyAuthOpen)이 열리는지로 확인 — 로그인 입력칸이 보여야 한다
  ok('비로그인: 안내 카드 버튼이 로그인 모달을 연다',
    $2('sdyAuthWrap').style.display === 'flex' && $2('saStepLogin').style.display !== 'none');

  console.log(`\n프런트 친구/DM 테스트: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
