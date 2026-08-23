// 엽스코드(Youpscord) 채팅 백엔드 통합 테스트 — Fastify 인스턴스를 직접 띄운다.
//   join → msg → upload → file get → react → knock → pending 큐 → history → '펑'(TTL 초기화)
process.env.SDY_CHAT_TTL = '2';
process.env.SDY_CHAT_GC_MS = '400';

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
ok('join: 음성은 서버 릴레이', j1.voice === 'relay');

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

// 6) 노크 브로드캐스트 (접속자 전원에게)
const sA = await openSse('A');
const sB = await openSse('B');
await sA.next('hello'); await sB.next('hello');
const knockP = post('/api/chat/knock', { uid: 'B' });
const kA2 = await sA.next('knock');
ok('knock: 전원에게 알림 전달', kA2 && kA2.from && kA2.from.uid === 'B' && kA2.from.name === '민트 제비');
await knockP;

// 6-2) 수신자의 SSE가 아직 열리기 전 메시지도 보관했다가 연결 즉시 전달
await post('/api/chat/join', { uid: 'D', name: '새 네트워크' });
await post('/api/chat/msg', { uid: 'A', text: '대기 큐에 남을 말' });
const sD = await openSse('D');
await sD.next('hello');
const queuedMsg = await sD.next('msg');
ok('msg: SSE 재접속 전 메시지 보존', queuedMsg && queuedMsg.msg && queuedMsg.msg.text === '대기 큐에 남을 말');
sD.close();

// 6-3) 끊긴 스트림이 streams 맵에 남아 있으면 이벤트가 죽은 소켓으로 쓰여
// 유실되고, 재연결한 상대에게는 아무것도 안 온다. close 감지 → 제거 → pending
// 보존 순서를 확인한다.
await post('/api/chat/join', { uid: 'E', name: '끊김 테스트' });
const sE = await openSse('E');
await sE.next('hello');
sE.close();
await new Promise((r) => setTimeout(r, 600)); // 서버가 close 를 감지할 시간
await post('/api/chat/msg', { uid: 'A', text: '끊긴 뒤에 온 말' });
const sE2 = await openSse('E');
await sE2.next('hello');
const afterClose = await sE2.next('msg');
ok('msg: close 후 메시지도 pending 보존', afterClose && afterClose.msg && afterClose.msg.text === '끊긴 뒤에 온 말');
sE2.close();
sA.close(); sB.close();

// 6-4) 통화 설정은 릴레이 전용 (ICE/TURN 없음)
const cfg = await fetch(`http://127.0.0.1:${PORT}/api/chat/config`).then((r) => r.json());
ok('config: voice=relay, ICE 없음', cfg.ok && cfg.voice === 'relay' && !cfg.ice && !cfg.turn);

const sig = await fetch(`http://127.0.0.1:${PORT}/api/chat/signal`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ uid: 'A', to: 'B', kind: 'offer' }),
});
ok('signal: P2P 시그널 라우트 제거', sig.status === 404);

const diag = await fetch(`http://127.0.0.1:${PORT}/api/chat/diag`);
ok('diag: TURN 진단 라우트 제거', diag.status === 404);

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
