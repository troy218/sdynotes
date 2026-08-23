/* Youpscord v4.1 jsdom 스모크 — 보라 그라데이션(버튼 제외·빈 배경), 보내기 버튼 두께 정렬, 음성/채팅 동작 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

let block;
const candidates = ['/home/user/yp_block.html', path.join(__dirname, '..', 'yp_block.html')];
const found = candidates.find((p) => fs.existsSync(p));
if (found) {
  block = fs.readFileSync(found, 'utf8');
} else {
  // 블록 파일이 없으면 주입된 sdynotes.html 에서 추출
  const full = fs.readFileSync(path.join(__dirname, '..', 'sdynotes.html'), 'utf8');
  const s = full.indexOf('<!-- ═══════════════ 엽스코드');
  const e = full.indexOf('</body>', s);
  if (s < 0 || e < 0) throw new Error('엽스코드 블록을 찾지 못했습니다');
  block = full.slice(s, e);
}

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/scrollTo|not implemented/i.test(String(e.message || e))) errors.push(String(e.message || e)); });
vc.on('error', (...a) => errors.push(a.join(' ')));

const sent = { bgm: [], voice: [], knock: [], msg: [], join: [] };
const T_윤하 = { id: 'y1', title: '사건의 지평선', artist: '윤하' };
const T_기타 = { id: 'b2', title: '다른 곡', artist: '누군가' };

function json(o) { return { ok: true, json: () => Promise.resolve(o) }; }

let esInst = null;

class FakeEventSource {
  constructor(url) { this.url = url; this.listeners = {}; esInst = this; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  close() {}
}
class FakeAudio {
  constructor() { this.volume = 0.3; this._src = ''; this.currentTime = 0; }
  play() { return Promise.resolve(); }
  pause() {}
  setAttribute(k, v) { if (k === 'src') this._src = v; }
  getAttribute(k) { return k === 'src' ? this._src : null; }
  set src(v) { this._src = v; }
  get src() { return this._src; }
}
class FakePC {
  constructor(cfg) { this.cfg = cfg; this.connectionState = 'new'; this.__pendingIce = []; }
  addTrack() {} close() {} setLocalDescription() { return Promise.resolve(); } setRemoteDescription() { return Promise.resolve(); } addIceCandidate() { return Promise.resolve(); } createOffer() { return Promise.resolve({ sdp: '', type: 'offer' }); } createAnswer() { return Promise.resolve({ sdp: '', type: 'answer' }); }
}
const fakeStream = {
  getTracks: () => [{ stop() {}, enabled: true }],
  getAudioTracks: () => [{ enabled: true }],
};

function makeFetch() {
  return (url, opts = {}) => {
    url = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    try { body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : (opts.body || {}); } catch (e) { body = {}; }
    if (url.startsWith('/api/chat/join')) {
      sent.join.push(body);
      return Promise.resolve(json({
        ok: true, ttl: 86400, bgm: null,
        me: { uid: 'yp_a', name: '연보라 까치', color: '#a5b4fc' },
        members: [{ uid: 'yp_a', name: '연보라 까치', color: '#a5b4fc', voice: false, mute: false }],
        msgs: [],
      }));
    }
    if (url.startsWith('/api/chat/voice')) { sent.voice.push(body); return Promise.resolve(json({ ok: true })); }
    if (url.startsWith('/api/chat/ping')) return Promise.resolve(json({ ok: true }));
    if (url.startsWith('/api/chat/knock')) { sent.knock.push(body); return Promise.resolve(json({ ok: true })); }
    if (url.startsWith('/api/chat/msg')) { sent.msg.push(body); return Promise.resolve(json({ ok: true, msg: { id: 1, uid: 'yp_a', name: '연보라 까치', color: '#a5b4fc', kind: 'text', text: body.text, ts: Date.now() / 1000 } })); }
    if (url.startsWith('/api/chat/bgm')) { sent.bgm.push(body); return Promise.resolve(json({ ok: true })); }
    if (url.startsWith('/api/chat/del')) return Promise.resolve(json({ ok: true }));
    if (url.startsWith('/api/chat/leave')) return Promise.resolve(json({ ok: true }));
    if (url.startsWith('/api/chat/config')) return Promise.resolve(json({ ok: true, ice: { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: ['stun:stun.cloudflare.com:3478'] }] } }));
    if (url.startsWith('/api/music/list')) return Promise.resolve(json({ ok: true, tracks: [T_윤하, T_기타] }));
    return Promise.resolve(json({ ok: true }));
  };
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  // 호스트 페이지가 제공하는 음악바 요소를 블록 앞에 주입 (블록 스크립트가 이를 참조)
  const html = '<div id="musicPlayer" class="mp-bar" style="display:none"></div><button id="mpReopen" style="display:none"></button>' + block;
  const dom = new JSDOM(html, {
    url: 'http://localhost:5000/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.sessionStorage.setItem('sdy_yp_uid', 'yp_a');
      // 15.0 · 이 스모크 테스트는 WebRTC(P2P) 경로를 흉내 낸다 — 여기선
      // 서버 릴레이 통화(WebSocket+AudioWorklet)를 끈 상태로 검증한다.
      // (릴레이 서버 동작은 test/voice_relay_contract.mjs 가 담당)
      w.localStorage.setItem('sdy_yp_settings', JSON.stringify({ relay: false }));
      w.fetch = makeFetch();
      w.EventSource = FakeEventSource;
      w.Audio = FakeAudio;
      w.RTCPeerConnection = FakePC;
      w.toast = function () {};
      w.Element.prototype.scrollTo = function () {};
      w.navigator.mediaDevices = { getUserMedia: () => Promise.resolve(fakeStream) };
    },
  });
  const w = dom.window; const d = w.document;
  const $ = (id) => d.getElementById(String(id).replace(/^#/, ''));

  await wait(60); // ypJoin fetch 처리

  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? '✅ ' : '❌ ') + name); };

  // 1) 음성 자동참가 없음
  ok('음성 자동참가 없음 (join off)', $('#ypVJoin').classList.contains('off') && !$('#ypVoice').classList.contains('invoice'));

  // 2) 버튼 순서: 참가 → 노크 → 배경음악
  {
    const kids = [...$('#ypVoice').children].map((el) => el.id);
    const iJoin = kids.indexOf('ypVJoin'), iKnock = kids.indexOf('ypKnockBtn'), iBgm = kids.indexOf('ypBgmBtn');
    ok('버튼 순서 [참가, 노크, 배경음악]', iJoin >= 0 && iJoin < iKnock && iKnock < iBgm);
  }

  // 3) 음성참가 버튼 아이콘 전용 (텍스트 라벨 없음)
  ok('음성참가 버튼 아이콘 전용', !/참가|노크/.test($('#ypVJoin').textContent));

  // 4) 참가자 수: 나 제외
  {
    const fn = (esInst.listeners['yp'] || []).find(() => true);
    fn({ data: JSON.stringify({ type: 'presence', members: [
      { uid: 'yp_a', name: '연보라 까치', color: '#a5b4fc', voice: true, mute: false },
      { uid: 'yp_b', name: '하늘색 박새', color: '#7dd3fc', voice: true, mute: false },
    ] }) });
    ok('음성 배지 나 제외 = 1', $('#ypVCnt').textContent === '1');
    ok('접힘 아이콘 배지(초록) = 1', $('#ypChipVoice').textContent.trim() === '1');
  }

  // 5) 접힘 아이콘: 채팅 카운트(빨강) 배지 없음, 초록 음성 배지만
  {
    const chip = $('#ypReopen');
    const badges = chip.querySelectorAll('.yp-badge');
    ok('접힘 아이콘 배지 1개(음성만)', badges.length === 1 && badges[0].classList.contains('yp-voice'));
  }

  // 6) 보라 그라데이션: 버튼 제외·빈 배경 / 버튼 틴트 제거
  {
    const styleText = d.getElementById('ypStyle').textContent;
    ok('invoice → 빈 배경 그라데이션', /\.yp-voice\.invoice\s*\{[^}]*linear-gradient/.test(styleText.replace(/\s+/g, ' ')));
    ok('@keyframes ypNeonBg 존재', styleText.includes('ypNeonBg'));
    ok('버튼 틴트(.ypv-join 등 배경) 제거됨', !/\.yp-voice\.invoice\s+\.ypv-(join|icon|mute|gear)\s*\{[^}]*linear-gradient/.test(styleText.replace(/\s+/g, ' ')));
  }

  // 7) 설정: 배경 선택/타임스탬프 없음 + 새 닉네임(⟳) 있음
  {
    $('#ypSetBtn').click();
    const st = $('#ypSettings').innerHTML;
    ok('설정에 배경 선택 없음', !/배경/.test(st));
    ok('설정에 타임스탬프 없음', !/타임스탬프/.test(st));
    ok('새 닉네임 ⟳ 버튼 있음', st.includes('yp-set-refresh'));
  }

  // 8) 음성참가 시 BGM 바 표시 + invoice 클래스
  {
    $('#ypVJoin').click(); // join voice
    await wait(30);
    ok('음성참가 시 invoice 클래스', $('#ypVoice').classList.contains('invoice'));
    ok('음성참가 시 뮤트 버튼 노출', $('#ypVMute').style.display !== 'none');
    $('#ypBgmBtn').click();
    await wait(30);
    ok('음성 중 BGM 바 표시', $('#ypBgm').style.display !== 'none');
  }

  // 9) 검색 "윤하" → 1곡
  {
    const inp = $('#ypBgmSearch');
    inp.value = '윤하';
    inp.dispatchEvent(new w.Event('input', { bubbles: true }));
    await wait(30);
    const btns = $('#ypBgmRes').querySelectorAll('button');
    ok('검색 "윤하" → 1곡', btns.length === 1 && btns[0].textContent.includes('사건의 지평선'));
  }

  // 10) 곡 선택 → bgm play 브로드캐스트
  {
    $('#ypBgmRes').querySelector('button').click();
    await wait(20);
    const last = sent.bgm[sent.bgm.length - 1];
    ok('곡 선택 → /api/chat/bgm play', last && last.action === 'play' && last.track && last.track.id === 'y1');
    ok('BGM 제목 표시', $('#ypBgmTitle').textContent === '사건의 지평선');
  }

  // 11) 열기 → 닫기 애니메이션 (closing → 사라짐 → 접힘 아이콘 복귀)
  {
    $('#ypReopen').click(); // 열기
    await wait(20);
    const opened = $('#ypApp').classList.contains('open');
    $('#ypFold').click();   // 닫기
    const hasClosing = $('#ypApp').classList.contains('closing');
    await wait(300);
    const closed = !$('#ypApp').classList.contains('open') && !$('#ypApp').classList.contains('closing');
    ok('열기 → 닫기: closing 클래스 → 정리됨', opened && hasClosing && closed);
    ok('닫히면 접힘 아이콘 복귀', $('#ypReopen').style.display === 'flex');
  }

  // 12) 음악바 open 애니메이션 클래스 (엽스코드와 통일)
  {
    const pl = $('#musicPlayer');
    pl.style.display = 'flex';
    await wait(40);
    ok('음악바 yp-mp-open 애니메이션', pl.classList.contains('yp-mp-open'));
  }

  // 13) 보내기 버튼: 아이콘 전용 + 입력창 두께에 맞춤
  {
    const st = d.getElementById('ypStyle').textContent.replace(/\s+/g, ' ');
    ok('보내기 버튼 34px(두께 정렬)', /\.yp-send\s*\{[^}]*width:\s*34px;height:\s*34px/.test(st));
    ok('입력창 min-height 32px', /\.yp-input textarea\s*\{[^}]*min-height:\s*32px/.test(st));
    ok('보내기 버튼 아이콘 전용', $('#ypSend').querySelector('i') !== null && !/보내기/.test($('#ypSend').textContent));
  }

  // 14) 런타임 에러 0
  ok('런타임 에러 0', errors.length === 0);

  console.log(`\nYoupscord v4.1 스모크: PASS ${pass} / FAIL ${fail}`);
  if (errors.length) console.log('  jsdom 에러:', errors.slice(0, 5));
  process.exit(fail ? 1 : 0);
})();
