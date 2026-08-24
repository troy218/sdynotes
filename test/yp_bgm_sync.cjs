/* 엽스코드 '같이 듣기' 동기화 검증 — 멈추면 양쪽이 같은 시점에서 멈추고,
   고른 곡만 반복된다(다음 곡으로 넘어가지 않는다).
   실제 코드를 jsdom 에서 돌리고, 한 기기는 버튼으로(보내는 쪽)·다른 기기는
   서버 브로드캐스트 이벤트로(받는 쪽) 흉내 낸다. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');

const js = fs.readFileSync(path.join(__dirname, '..', 'sdynotes.js'), 'utf8');
const full = fs.readFileSync(path.join(__dirname, '..', 'sdynotes.html'), 'utf8');
const s = full.indexOf('<!-- ═══════════════ 엽스코드');
const e = full.indexOf('</body>', s);
if (s < 0 || e < 0) throw new Error('엽스코드 블록을 찾지 못했습니다');
const block = full.slice(s, e);
// 엽스코드 IIFE 만 꺼내 돌린다 (에디터 전체를 jsdom 에서 부팅할 필요가 없다).
// 블록은 'window.__ypInit' 가드로 시작하고, 들여쓰기 없는 '})();' 로 끝난다.
const ypStart = js.indexOf('(function(){\n  if(window.__ypInit) return;');
if (ypStart < 0) throw new Error('엽스코드 스크립트 블록을 찾지 못했습니다');
const ypEnd = js.indexOf('\n})();', ypStart);
const ypJs = js.slice(ypStart, ypEnd + '\n})();'.length);
if (!ypJs.includes('function ypBgmApply(') || !ypJs.includes('function ypBgmPause(')) {
  throw new Error('엽스코드 블록 추출이 잘못되었습니다');
}

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (err) => { if (!/scrollTo|not implemented/i.test(String(err.message || err))) errors.push(String(err.message || err)); });
vc.on('error', (...a) => errors.push(a.join(' ')));

const sent = { bgm: [] };
const T_윤하 = { id: 'y1', title: '사건의 지평선', artist: '윤하' };
const T_기타 = { id: 'b2', title: '다른 곡', artist: '누군가' };
const json = (o) => ({ ok: true, json: () => Promise.resolve(o) });

let esInst = null;
class FakeEventSource {
  constructor(url) { this.url = url; this.listeners = {}; esInst = this; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  close() {}
}
class FakeAudio {
  constructor() {
    this.volume = 0.3; this._src = ''; this.currentTime = 0;
    this.loop = false; this.playing = false; this._ls = {};
    FakeAudio.instances.push(this);
  }
  play() { this.playing = true; return Promise.resolve(); }
  pause() { this.playing = false; }
  addEventListener(t, fn) { (this._ls[t] = this._ls[t] || []).push(fn); }
  removeEventListener(t, fn) { this._ls[t] = (this._ls[t] || []).filter((f) => f !== fn); }
  setAttribute(k, v) { if (k === 'src') { this._src = v; this._meta(); } }
  getAttribute(k) { return k === 'src' ? this._src : null; }
  set src(v) { this._src = v; this._meta(); }
  get src() { return this._src; }
  // 실제 Audio 처럼 새 곡을 넣으면 곧 메타가 도착한다 (seek 는 그 뒤에 잡힌다)
  _meta() { setTimeout(() => (this._ls['loadedmetadata'] || []).slice().forEach((fn) => fn()), 0); }
}
FakeAudio.instances = [];
class FakeNode {
  constructor() { this.port = { onmessage: null }; this.gain = { value: 0 }; }
  connect() { return this; }
  disconnect() {}
}
class FakeAudioContext {
  constructor() {
    this.state = 'running'; this.sampleRate = 48000; this.currentTime = 0; this.destination = {};
    this.audioWorklet = { addModule: () => Promise.reject(new Error('no worklet')) };
  }
  resume() { return Promise.resolve(); }
  createMediaStreamSource() { return new FakeNode(); }
  createAnalyser() {
    const n = new FakeNode();
    n.fftSize = 512; n.smoothingTimeConstant = 0.4; n.frequencyBinCount = 256;
    n.getByteTimeDomainData = (buf) => { buf.fill(128); };
    return n;
  }
  createGain() { return new FakeNode(); }
  createScriptProcessor() { return new FakeNode(); }
  createMediaStreamDestination() { return { stream: { getTracks: () => [] }, connect() {} }; }
  createBuffer() { return { duration: 0.1, copyChannel() {}, getChannelData: () => new Float32Array(1) }; }
  createBufferSource() { return { buffer: null, connect() {}, start() {} }; }
}
class FakeWebSocket {
  constructor(url) {
    this.url = url; this.readyState = 0; this.binaryType = 'arraybuffer'; this._listeners = {};
    FakeWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1;
      if (typeof this.onopen === 'function') this.onopen();
      (this._listeners.open || []).forEach((fn) => fn({}));
      const welcome = { data: JSON.stringify({ t: 'welcome', uid: 'yp_a', peers: [] }) };
      if (typeof this.onmessage === 'function') this.onmessage(welcome);
      (this._listeners.message || []).forEach((fn) => fn(welcome));
    }, 0);
  }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  send() {}
  close() { this.readyState = 3; }
}
FakeWebSocket.instances = [];
FakeWebSocket.OPEN = 1;
const fakeStream = { getTracks: () => [{ stop() {}, enabled: true }], getAudioTracks: () => [{ enabled: true }] };

function makeFetch() {
  return (url, opts = {}) => {
    url = String(url);
    let body = null;
    try { body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : (opts.body || {}); } catch (err) { body = {}; }
    if (url.startsWith('/api/chat/join')) {
      return Promise.resolve(json({
        ok: true, ttl: 86400, bgm: null, voice: 'relay',
        me: { uid: 'yp_a', name: '연보라 까치', color: '#a5b4fc' },
        members: [{ uid: 'yp_a', name: '연보라 까치', color: '#a5b4fc', voice: false, mute: false }],
        msgs: [],
      }));
    }
    if (url.startsWith('/api/chat/bgm')) { sent.bgm.push(body); return Promise.resolve(json({ ok: true })); }
    if (url.startsWith('/api/chat/voice')) return Promise.resolve(json({ ok: true }));
    if (url.startsWith('/api/chat/ping')) return Promise.resolve(json({ ok: true }));
    if (url.startsWith('/api/chat/config')) return Promise.resolve(json({ ok: true, voice: 'relay' }));
    if (url.startsWith('/api/music/list')) return Promise.resolve(json({ ok: true, tracks: [T_윤하, T_기타] }));
    return Promise.resolve(json({ ok: true }));
  };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const html = '<div id="musicPlayer" class="mp-bar" style="display:none"></div><button id="mpReopen" style="display:none"></button>' + block + '<script>' + ypJs + '</script>';
  const dom = new JSDOM(html, {
    url: 'http://localhost:5000/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.sessionStorage.setItem('sdy_yp_uid', 'yp_a');
      w.fetch = makeFetch();
      w.EventSource = FakeEventSource;
      w.Audio = FakeAudio;
      w.AudioContext = FakeAudioContext;
      w.webkitAudioContext = FakeAudioContext;
      w.WebSocket = FakeWebSocket;
      w.toast = function () {};
      w.Element.prototype.scrollTo = function () {};
      w.navigator.mediaDevices = { getUserMedia: () => Promise.resolve(fakeStream) };
      if (!w.requestAnimationFrame) w.requestAnimationFrame = (fn) => setTimeout(fn, 16);
    },
  });
  const w = dom.window; const d = w.document;
  const $ = (id) => d.getElementById(String(id).replace(/^#/, ''));
  // 엽스코드는 칩을 눌러야 방에 입장한다(게이트) → SSE 가 그때 연결된다
  w.__ypEnter();
  await wait(30);
  if ($('ypGate') && $('ypGate').style.display !== 'none') $('ypgGuest').click();
  await wait(80);
  assert.ok(esInst, '엽스코드 SSE(이벤트 스트림)가 연결되어 있어야 한다');

  let pass = 0;
  const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };
  const lastBgm = () => sent.bgm[sent.bgm.length - 1];
  const fire = (m) => (esInst.listeners['yp'] || []).forEach((fn) => fn({ data: JSON.stringify(m) }));
  const btnIcon = () => $('ypBgmPause').innerHTML;

  // 음성참가 → 배경음악 바
  $('ypVJoin').click();
  await wait(80);
  $('ypBgmBtn').click();
  await wait(60);
  ok('음성참가 후 배경음악 바가 열린다', $('ypBgm').style.display !== 'none');

  // ① 곡 선택 — 고른 곡만 반복
  $('ypBgmSearch').value = '윤하';
  $('ypBgmSearch').dispatchEvent(new w.Event('input', { bubbles: true }));
  await wait(40);
  $('ypBgmRes').querySelector('button').click();
  await wait(40);
  const audio = FakeAudio.instances[FakeAudio.instances.length - 1];
  ok('고른 곡이 재생된다', audio.playing === true && audio.getAttribute('src') === '/api/music/file/y1');
  ok('고른 곡은 loop 로 계속 반복된다 (다음 곡 없음)', audio.loop === true);
  ok('다음 곡으로 넘기는 코드가 사라졌다', !js.includes('ypBgmRandomNext') && !/BGM\.audio\.onended/.test(js));
  ok('곡 선택은 play 를 브로드캐스트한다', lastBgm().action === 'play' && lastBgm().track.id === 'y1');

  // ② 내가 멈추면 — 멈춘 '시점'을 그대로 실어 보낸다
  audio.currentTime = 37.5;
  $('ypBgmPause').click();
  await wait(40);
  ok('멈추면 내 기기에서도 멈춘다', audio.playing === false);
  ok('멈춤 브로드캐스트에 곡과 멈춘 시점이 담긴다',
    lastBgm().action === 'pause' && lastBgm().track.id === 'y1' && lastBgm().pos === 37.5);
  ok('멈추면 버튼이 재생 모양으로 바뀐다', btnIcon().includes('ri-play-fill'));

  // ③ 상대가 멈춘 이벤트를 받으면 — 같은 시점으로 이동해 멈춘다
  audio.currentTime = 5;                       // 어긋나 있던 상태
  audio.playing = true;
  fire({ type: 'bgm', action: 'pause', from: { uid: 'yp_b', name: '하늘색 박새' },
    track: { id: 'y1', title: '사건의 지평선', artist: '윤하' }, pos: 42.25, ts: Date.now() / 1000 });
  await wait(40);
  ok('상대 멈춤을 받으면 같은 시점(42.25초)으로 맞춘다', Math.abs(audio.currentTime - 42.25) < 0.001);
  ok('상대 멈춤을 받으면 나도 멈춘다', audio.playing === false);
  ok('상대 멈춤을 받으면 버튼도 재생 모양이 된다', btnIcon().includes('ri-play-fill'));

  // ④ 다시 재생 — 같은 시점에서 이어지고, 곡 정보도 온전히 전달된다
  $('ypBgmPause').click();
  await wait(40);
  ok('다시 누르면 내 기기에서 이어 재생된다', audio.playing === true);
  ok('재생 브로드캐스트는 곡 id 와 이어 들을 시점을 싣는다',
    lastBgm().action === 'play' && lastBgm().track.id === 'y1'
    && lastBgm().track.title === '사건의 지평선' && lastBgm().pos === 42.25);
  ok('재생 브로드캐스트에 src 를 곡 id 로 잘못 넣지 않는다',
    !String(lastBgm().track.id).includes('/api/music/file/'));
  ok('다시 재생하면 버튼이 일시정지 모양으로 돌아온다', btnIcon().includes('ri-pause-fill'));

  // ⑤ 상대의 재생 이벤트를 받으면 — 그 시점에서 함께 돈다
  audio.currentTime = 0; audio.playing = false;
  fire({ type: 'bgm', action: 'play', from: { uid: 'yp_b', name: '하늘색 박새' },
    track: { id: 'y1', title: '사건의 지평선', artist: '윤하' }, pos: 10, ts: Date.now() / 1000 });
  await wait(40);
  ok('상대 재생을 받으면 같은 시점에서 재생된다', audio.playing === true && Math.abs(audio.currentTime - 10) <= 2);

  // ⑥ 늦게 참가한 사람도 '멈춤 상태'를 그대로 이어받는다
  fire({ type: 'bgm', action: 'stop', from: { uid: 'yp_b', name: '하늘색 박새' }, track: null, pos: 0, ts: Date.now() / 1000 });
  await wait(30);
  fire({ type: 'bgm', action: 'pause', from: { uid: 'yp_b', name: '하늘색 박새' },
    track: { id: 'b2', title: '다른 곡', artist: '누군가' }, pos: 77, ts: Date.now() / 1000 });
  await wait(40);
  ok('늦게 들어와도 멈춘 곡·멈춘 시점을 그대로 받는다',
    audio.playing === false && audio.getAttribute('src') === '/api/music/file/b2'
    && Math.abs(audio.currentTime - 77) < 0.001 && $('ypBgmTitle').textContent === '다른 곡');

  ok('동작 중 런타임 오류가 없다', errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 3).join('\n---\n'));
  console.log(`\n엽스코드 같이 듣기 동기화: PASS ${pass} / FAIL 0`);
  dom.window.close();
  process.exit(0);
})().catch((err) => {
  console.error('\n엽스코드 같이 듣기 동기화 실패:', err);
  if (errors.length) console.error(errors.slice(0, 3).join('\n---\n'));
  process.exit(1);
});
