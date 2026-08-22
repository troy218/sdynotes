// 엽스코드(Youpscord) 채팅 백엔드 통합 테스트 — Fastify 인스턴스를 직접 띄운다.
//   join → msg → upload → file get → react → signal(타깃 전달) → history → '펑'(TTL 초기화)
process.env.SDY_CHAT_TTL = '2';
process.env.SDY_CHAT_GC_MS = '400';

import crypto from 'node:crypto';
const { registerChat } = await import('../server/src/routes/chat.js');
const { default: Fastify } = await import('fastify');
const { default: multipart } = await import('@fastify/multipart');

const PORT = 5199;
const app = Fastify({ logger: false });
await app.register(multipart, { limits: { fileSize: 512 * 1024 * 1024, files: 1 } });
registerChat(app);
await app.listen({ port: PORT, host: '127.0.0.1' });

const post = (p, body) => fetch(`http://127.0.0.1:${PORT}${p}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json());

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };

// ── SSE 헬퍼: uid 스트림에서 type 까지 기다려 이벤트 반환 ──
async function openSse(uid) {
  const ac = new AbortController();
  const resp = await fetch(`http://127.0.0.1:${PORT}/api/chat/stream?uid=${uid}`, { signal: ac.signal });
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const next = async (type, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const idx = buf.indexOf('\n\n');
      if (idx >= 0) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const m = /^data: (.+)$/m.exec(chunk);
        if (m) { const evt = JSON.parse(m[1]); if (!type || evt.type === type) return evt; }
      } else {
        const { value, done } = await reader.read();
        if (done) return null;
        buf += dec.decode(value, { stream: true });
      }
    }
    return null;
  };
  return { next, close: () => ac.abort() };
}

// 1) 입장 + 파스텔 색
const j1 = await post('/api/chat/join', { uid: 'A', name: '연보라 까치' });
ok('join: 이름/색 반영', j1.ok && j1.me.name === '연보라 까치' && /^#[0-9a-f]{6}$/.test(j1.me.color));

// 2) 메시지
const m1 = await post('/api/chat/msg', { uid: 'A', text: '안녕 엽스코드' });
ok('msg: 발송 성공', m1.ok && m1.msg.id === 1 && m1.msg.kind === 'txt');

// 3) 이미지 업로드
const fd = new FormData();
fd.append('file', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: 'image/jpeg' }), 'pic.jpg');
fd.append('uid', 'A');
const up = await fetch(`http://127.0.0.1:${PORT}/api/chat/upload`, { method: 'POST', body: fd }).then((r) => r.json());
ok('upload: 이미지 메시지', up.ok && up.msg.kind === 'img' && up.msg.file.size === 6);

// 4) 파일 다운로드
const got = await fetch(`http://127.0.0.1:${PORT}/api/chat/file/${up.msg.file.id}`);
const buf = new Uint8Array(await got.arrayBuffer());
ok('file: 바이트 그대로 반환', got.ok && got.headers.get('content-type') === 'image/jpeg' && buf[0] === 0xff && buf.length === 6);

// 5) 이모지 반응
const r1 = await post('/api/chat/react', { uid: 'A', id: 1, emoji: '🔥' });
const jR = await post('/api/chat/join', { uid: 'B', name: '민트 제비' });
const reacted = jR.msgs.find((x) => x.id === 1);
ok('react: 반응 저장', r1.ok && reacted && (reacted.reactions['🔥'] || []).length === 1);

// 6) 시그널링 타깃 전달 (A→B 만 받는다)
const sA = await openSse('A');
const sB = await openSse('B');
await sA.next('hello'); await sB.next('hello');
const signalStarted = performance.now();
await post('/api/chat/signal', { uid: 'A', to: 'B', kind: 'ice', payload: { candidate: 'cand:1' } });
const evB = await sB.next('signal');
const signalMs = performance.now() - signalStarted;
const evA = await sA.next('signal', 600);
ok('signal: 상대에게만 전달', evB && evB.from === 'A' && evB.kind === 'ice' && !evA);
ok(`signal: 즉시 push (${Math.round(signalMs)}ms)`, signalMs < 400);

// 6-2) 노크 브로드캐스트 (접속자 전원에게)
const knockP = post('/api/chat/knock', { uid: 'B' });
const kA2 = await sA.next('knock');
ok('knock: 전원에게 알림 전달', kA2 && kA2.from && kA2.from.uid === 'B' && kA2.from.name === '민트 제비');
await knockP;

// 6-3) 수신자의 SSE가 아직 열리기 전 offer도 보관했다가 연결 즉시 전달
await post('/api/chat/join', { uid: 'D', name: '새 네트워크' });
await post('/api/chat/signal', { uid: 'A', to: 'D', kind: 'offer', payload: { sdp: { type: 'offer', sdp: 'queued' } } });
const sD = await openSse('D');
await sD.next('hello');
const queuedOffer = await sD.next('signal');
ok('signal: SSE 재접속 전 offer 보존', queuedOffer && queuedOffer.from === 'A'
  && queuedOffer.kind === 'offer' && queuedOffer.payload.sdp.sdp === 'queued');
sD.close();
sA.close(); sB.close();

// 6-4) ICE 설정 (STUN 기본)
const cfg = await fetch(`http://127.0.0.1:${PORT}/api/chat/config`).then((r) => r.json());
ok('config: ICE(STUN) 제공', cfg.ok && cfg.ice && cfg.ice.iceServers.length >= 1);

// 6-5) apply.sh coturn용 임시 인증(HMAC-SHA1)
process.env.SDY_LOCAL_TURN_URL = 'turn:203.0.113.10:3478?transport=udp,turn:203.0.113.10:3478?transport=tcp';
process.env.SDY_TURN_SECRET = 'chat-test-secret';
const turnCfg = await fetch(`http://127.0.0.1:${PORT}/api/chat/config?uid=device-A`).then((r) => r.json());
const turn = turnCfg.ice.iceServers.find((x) => (Array.isArray(x.urls) ? x.urls : [x.urls]).some((u) => String(u).startsWith('turn:')));
const expectedCredential = turn && crypto.createHmac('sha1', process.env.SDY_TURN_SECRET)
  .update(turn.username).digest('base64');
ok('config: TURN 임시 인증 제공', turnCfg.turn === true && turn && /^\d+:device-A$/.test(turn.username)
  && turn.credential === expectedCredential);
delete process.env.SDY_LOCAL_TURN_URL;
delete process.env.SDY_TURN_SECRET;

// 6-6) transport= 쿼리가 한 줄 안에 콤마와 섞여 와도 UDP(쿼리 없음) + TCP 를
//      별도 iceServers 엔트리로 나눠야 한다 (브라우저가 한쪽만 시도하는 함정 방지).
const turnUrlsOf = (s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).map(String);
process.env.SDY_LOCAL_TURN_URL = 'turn:198.51.100.7:3478?transport=udp,turn:198.51.100.7:3478?transport=tcp';
process.env.SDY_TURN_SECRET = 'split-secret';
const splitCfg = await fetch(`http://127.0.0.1:${PORT}/api/chat/config?uid=split-test`).then((r) => r.json());
const splitTurns = splitCfg.ice.iceServers.filter((x) => turnUrlsOf(x).some((u) => u.includes('198.51.100.7')));
const splitUrlList = splitTurns.flatMap(turnUrlsOf);
ok('config: UDP/TCP TURN 별도 엔트리', splitTurns.length >= 2
  && splitUrlList.includes('turn:198.51.100.7:3478')
  && splitUrlList.includes('turn:198.51.100.7:3478?transport=tcp')
  && !splitUrlList.some((u) => u.includes('?transport=udp')));
const expected = (username) => crypto.createHmac('sha1', 'split-secret').update(username).digest('base64');
ok('config: TURN HMAC 인증 일관', splitTurns.length >= 2
  && splitTurns.every((x) => x.credential === expected(x.username) && /^\d+:split-test$/.test(x.username)));
delete process.env.SDY_LOCAL_TURN_URL;
delete process.env.SDY_TURN_SECRET;

// 6-6b) apply.sh 가 넣는 베이스 URL(쿼리 없음) 만으로도 TCP 엔트리가 생겨야 한다.
process.env.SDY_LOCAL_TURN_URL = 'turn:203.0.113.88:3478';
process.env.SDY_TURN_SECRET = 'bare-secret';
const bareCfg = await fetch(`http://127.0.0.1:${PORT}/api/chat/config?uid=bare-test`).then((r) => r.json());
const bareTurns = bareCfg.ice.iceServers.filter((x) => turnUrlsOf(x).some((u) => u.includes('203.0.113.88')));
const bareUrls = bareTurns.flatMap(turnUrlsOf);
ok('config: 베이스 URL 에서 TCP TURN 자동 추가', bareCfg.turn === true && bareTurns.length === 2
  && bareUrls.includes('turn:203.0.113.88:3478')
  && bareUrls.includes('turn:203.0.113.88:3478?transport=tcp'));
delete process.env.SDY_LOCAL_TURN_URL;
delete process.env.SDY_TURN_SECRET;

// 6-7) 외부 TURN(정적 인증)과 로컬 TURN(HMAC)이 같은 호스트면 두 줄 다 push
process.env.SDY_TURN_URL = 'turn:192.0.2.55:3478';
process.env.SDY_TURN_USER = 'extuser';
process.env.SDY_TURN_PASS = 'extpass';
process.env.SDY_LOCAL_TURN_URL = 'turn:192.0.2.55:3478';
process.env.SDY_TURN_SECRET = 'dup-secret';
const dupCfg = await fetch(`http://127.0.0.1:${PORT}/api/chat/config?uid=dup-test`).then((r) => r.json());
const dupTurns = dupCfg.ice.iceServers.filter((x) => (Array.isArray(x.urls) ? x.urls : [x.urls])
  .some((u) => String(u).startsWith('turn:192.0.2.55')));
ok('config: 같은 호스트라도 외부/로컬 두 줄', dupTurns.length >= 2
  && dupTurns.some((x) => x.username === 'extuser' && x.credential === 'extpass')
  && dupTurns.some((x) => /^\d+:dup-test$/.test(x.username)));
delete process.env.SDY_TURN_URL;
delete process.env.SDY_TURN_USER;
delete process.env.SDY_TURN_PASS;
delete process.env.SDY_LOCAL_TURN_URL;
delete process.env.SDY_TURN_SECRET;

// 7) 히스토리 보존
ok('history: 재입장 시 최근 메시지', jR.msgs.length >= 2);

// 8) '펑' — TTL(2초) 경과 후 방 초기화
await new Promise((r) => setTimeout(r, 2600));
const jC = await post('/api/chat/join', { uid: 'C', name: '백로' });
ok('pop: 대화 종료 후 방 초기화', jC.msgs.length === 0);
const gone = await fetch(`http://127.0.0.1:${PORT}/api/chat/file/${up.msg.file.id}`);
ok('pop: 파일도 함께 제거', gone.status === 404);

await app.close();
console.log(`\n채팅 테스트: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
