// 서버 릴레이 음성(WebSocket) 계약 테스트
//   WebRTC 없이 /api/chat/voice-ws 로 마이크 프레임을 주고받는 통로를 검증한다.
import fs from 'node:fs';

process.env.SDY_CHAT_TTL = '3600';

const { registerChat } = await import('../server/src/routes/chat.js');
const { default: Fastify } = await import('fastify');
const { default: multipart } = await import('@fastify/multipart');

const PORT = 5196;
const app = Fastify({ logger: false });
await app.register(multipart, { limits: { fileSize: 512 * 1024 * 1024, files: 1 } });
registerChat(app);
await app.listen({ port: PORT, host: '127.0.0.1' });

const post = (p, body) => fetch(`http://127.0.0.1:${PORT}${p}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json());

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };

function msgReader(ws) {
  const q = [];
  let wait = null;
  ws.addEventListener('message', (ev) => {
    if (typeof ev.data !== 'string') return;
    let m = null;
    try { m = JSON.parse(String(ev.data)); } catch { return; }
    if (wait) { if (wait(m)) wait = null; return; }
    q.push(m);
  });
  return {
    next(type, timeoutMs = 3000) {
      const i = q.findIndex((m) => !type || m.t === type);
      if (i >= 0) return Promise.resolve(q.splice(i, 1)[0]);
      return new Promise((res) => {
        const tm = setTimeout(() => { wait = null; res(null); }, timeoutMs);
        wait = (m) => {
          if (type && m.t !== type) { q.push(m); return false; }
          clearTimeout(tm); res(m); return true;
        };
      });
    },
  };
}
function binOnce(ws, timeoutMs = 3000) {
  return new Promise((res) => {
    const tm = setTimeout(() => res(null), timeoutMs);
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data === 'string') return;
      clearTimeout(tm);
      res(new Uint8Array(ev.data));
    }, { once: true });
  });
}
function closed(ws, timeoutMs = 2500) {
  return new Promise((res) => {
    const tm = setTimeout(() => res(null), timeoutMs);
    ws.addEventListener('close', (ev) => { clearTimeout(tm); res(ev.code); });
  });
}

// ── 0) 두 명 입장 ──
const jA = await post('/api/chat/join', { uid: 'A', name: '연보라 까치' });
await post('/api/chat/join', { uid: 'B', name: '민트 제비' });
ok('join 이 voice:relay 를 알림', jA.voice === 'relay');

const cfg = await fetch(`http://127.0.0.1:${PORT}/api/chat/config`).then((r) => r.json());
ok('config 는 {ok, voice:relay}', cfg.ok === true && cfg.voice === 'relay' && !cfg.ice && !cfg.turn);

const noSignal = await fetch(`http://127.0.0.1:${PORT}/api/chat/signal`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ uid: 'A', to: 'B', kind: 'offer' }),
});
ok('P2P 시그널 엔드포인트 없음', noSignal.status === 404);

// ── 1) 음성 소켓 연결 → welcome + presence 에 voice=true ──
const wsA = new WebSocket(`ws://127.0.0.1:${PORT}/api/chat/voice-ws?uid=A`);
const rdA = msgReader(wsA);
await new Promise((res, rej) => { wsA.onopen = res; wsA.onerror = rej; });
const hello = await rdA.next('welcome');
ok('welcome 수신', !!hello && hello.uid === 'A');
ok('welcome 에 참가자 목록', Array.isArray(hello.peers));

let jb = await post('/api/chat/join', { uid: 'B', name: '민트 제비' });
ok('WS 연결만으로 voice=true 참여 알림', jb.members.find((m) => m.uid === 'A')?.voice === true);

// ── 2) B 입장 → A 에게 join 이벤트 ──
const wsB = new WebSocket(`ws://127.0.0.1:${PORT}/api/chat/voice-ws?uid=B`);
const rdB = msgReader(wsB);
await new Promise((res, rej) => { wsB.onopen = res; wsB.onerror = rej; });
const helloB = await rdB.next('welcome');
ok('B welcome 에 A 가 보임', Array.isArray(helloB.peers) && helloB.peers.some((p) => p.uid === 'A'));
const joined = await rdA.next('join');
ok('A 에게 B 입장(join) 전달', !!joined && joined.uid === 'B' && joined.name === '민트 제비');

// ── 3) 음성 프레임 릴레이: A → 서버 → B (uid 붙여서), A 는 자기 소리 안 받음 ──
const frame = new Uint8Array(2048);
frame[0] = 0x01;
for (let i = 1; i < frame.length; i++) frame[i] = (i * 7) & 0xff;
wsA.send(frame);
const got = await binOnce(wsB);
ok('프레임 [0x01][uidLen][uid][payload] 형식', !!got && got[0] === 0x01 && got[1] === 1);
const uid = got ? String.fromCharCode(got[2]) : '';
ok('보낸 사람 uid(A) 표기', uid === 'A');
ok('페이로드 그대로 전달', !!got && got.length === 2 + 1 + (frame.length - 1)
  && got.subarray(3).every((v, i) => v === frame[i + 1]));
const echo = await binOnce(wsA, 900);
ok('자기 프레임은 자신에게 돌아오지 않음', echo === null);

// ── 4) 음소거 상태 전파 ──
wsA.send(JSON.stringify({ t: 'mute', mute: true }));
const mu = await rdB.next('mute');
ok('음소거 전달', !!mu && mu.uid === 'A' && mu.mute === true);
jb = await post('/api/chat/join', { uid: 'B' });
ok('presence 에도 mute 반영', jb.members.find((m) => m.uid === 'A')?.mute === true);
wsA.send(JSON.stringify({ t: 'mute', mute: false }));

// ── 4b) ping → pong (프록시 유휴 끊김 방지) ──
wsA.send(JSON.stringify({ t: 'ping' }));
const pong = await rdA.next('pong');
ok('ping 에 pong', !!pong && pong.t === 'pong');

// ── 5) 같은 uid 재접속 → 옛 소켓 교체 ──
const wsA2 = new WebSocket(`ws://127.0.0.1:${PORT}/api/chat/voice-ws?uid=A`);
const rdA2 = msgReader(wsA2);
await new Promise((res, rej) => { wsA2.onopen = res; wsA2.onerror = rej; });
await rdA2.next('welcome');
const oldClosed = await new Promise((res) => {
  const tm = setTimeout(() => res(false), 2500);
  wsA.addEventListener('close', () => { clearTimeout(tm); res(true); });
});
ok('재접속 시 옛 소켓 종료', oldClosed === true);
const f2 = new Uint8Array([0x01, 0xff, 0x11, 0x22]);
wsA2.send(f2);
const got2 = await binOnce(wsB);
ok('교체된 소켓으로 프레임 릴레이 지속', !!got2 && got2[2] === 65 /* 'A' */ && got2[3] === 0xff && got2[4] === 0x11);

// ── 6) 퇴장 → leave + voice=false ──
wsA2.close();
const left = await rdB.next('leave');
ok('퇴장(leave) 전달', !!left && left.uid === 'A');
jb = await post('/api/chat/join', { uid: 'B' });
ok('퇴장 후 voice=false', jb.members.find((m) => m.uid === 'A')?.voice === false);

// ── 6b) /api/chat/leave 가 음성 소켓을 닫는다 ──
const wsLeave = new WebSocket(`ws://127.0.0.1:${PORT}/api/chat/voice-ws?uid=A`);
const rdLeave = msgReader(wsLeave);
await new Promise((res, rej) => { wsLeave.onopen = res; wsLeave.onerror = rej; });
await rdLeave.next('welcome');
const leaveCloseP = closed(wsLeave);
await post('/api/chat/join', { uid: 'A', name: '연보라 까치' });
await post('/api/chat/leave', { uid: 'A' });
const leaveCode = await leaveCloseP;
ok('leave 가 음성 WS 를 닫음', leaveCode === 4004);

// ── 6c) /api/chat/voice {on:false} 도 소켓을 닫는다 ──
await post('/api/chat/join', { uid: 'A', name: '연보라 까치' });
const wsOff = new WebSocket(`ws://127.0.0.1:${PORT}/api/chat/voice-ws?uid=A`);
const rdOff = msgReader(wsOff);
await new Promise((res, rej) => { wsOff.onopen = res; wsOff.onerror = rej; });
await rdOff.next('welcome');
const offCloseP = closed(wsOff);
await post('/api/chat/voice', { uid: 'A', on: false });
const offCode = await offCloseP;
ok('voice off 가 음성 WS 를 닫음', offCode === 4005);

// ── 7) 입장 안 한 uid 는 거부 ──
const wsC = new WebSocket(`ws://127.0.0.1:${PORT}/api/chat/voice-ws?uid=GHOST`);
const rejected = await closed(wsC);
ok('미가입 uid 거부 (4001)', rejected === 4001);

// ── 8) 프론트엔드 릴레이 전용 계약 ──
const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
ok('클라이언트: 릴레이 음성 엔진 존재', /ypRelayStart/.test(html) && /voice-ws\?uid=/.test(html));
ok('클라이언트: P2P 토글/ICE 없음', !/YPS\.relay/.test(html) && !/RTCPeerConnection/.test(html));
ok('클라이언트: 재접속 시 캡처 그래프 유지', /YP\.relayNodes \? Promise\.resolve\(\) : ypRelayCapture/.test(html));
ok('클라이언트: 유휴 ping', /YP\._relayHb/.test(html) && /t:'ping'/.test(html));

wsB.close();
await app.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
