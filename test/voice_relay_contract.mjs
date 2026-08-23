// 15.0 · 서버 릴레이 음성(WebSocket) 계약 테스트
//   WebRTC 없이 /api/chat/voice-ws 로 마이크 프레임을 주고받는 통로를 검증한다.
//   Node 22 내장 WebSocket 클라이언트를 쓴다.
import assert from 'node:assert/strict';

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

// 텍스트 메시지를 (timeout 안에) 한 개 받을 때까지 읽기
function msgReader(ws) {
  const q = [];
  let wait = null;   // (m) => consumed?
  ws.addEventListener('message', (ev) => {
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
// 바이너리 프레임 한 개 기다리기
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

// ── 0) 두 명 입장 ──
await post('/api/chat/join', { uid: 'A', name: '연보라 까치' });
await post('/api/chat/join', { uid: 'B', name: '민트 제비' });

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
// 새 소켓으로 프레임이 계속 흐른다
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

// ── 7) 입장 안 한 uid 는 거부 ──
const wsC = new WebSocket(`ws://127.0.0.1:${PORT}/api/chat/voice-ws?uid=GHOST`);
const rejected = await new Promise((res) => {
  const tm = setTimeout(() => res(null), 2500);
  wsC.addEventListener('close', (ev) => { clearTimeout(tm); res(ev.code); });
});
ok('미가입 uid 거부 (4001)', rejected === 4001);

// ── 8) 프론트엔드에 릴레이 통화 코드가 있는지 (HTML 계약) ──
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
ok('클라이언트: 릴레이 음성 엔진 존재', /ypRelayStart/.test(html) && /voice-ws\?uid=/.test(html));
ok('클라이언트: 기본값이 릴레이 (YPS.relay)', /relay:true/.test(html));
ok('클라이언트: 릴레이 중 P2P 연결 생성 금지', /if\(YP\.relayOn\)\{ ypRenderStatus\(\); return; \}/.test(html));

wsB.close();
await app.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
