// 엽스코드(Youpscord) — 앱 전체 공용 익명 채팅방.
//   텍스트 · 사진 · 파일 · 이모지(+반응) · 실시간 음성(서버 WebSocket 릴레이).
//
// 방은 영구 저장하지 않는다(인메모리): 마지막 대화 후 CHAT_TTL(24시간)이 지나면
// 메시지·파일이 '펑' 하고 사라진다. 닉네임은 라이브 새 이름 + 파스텔 색(라이브와 동일 팔레트).
//
// 음성은 WebRTC/TURN 없이 마이크 프레임을 /api/chat/voice-ws 로 서버가 중계한다.
// 채팅(SSE)이 열리는 망이면 통화도 된다.
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { userByTokenSync, nickTaken } from '../lib/userauth.js';

// 비회원이 써도 되는 이름인지 — 회원 고정닉과 겹치면 거짓.
// (userauth 가 부팅되지 않은 테스트 환경에선 항상 참)
async function ypNickFree(name) {
  try { return !(await nickTaken(name)); } catch { return true; }
}

const CHAT_TTL = parseInt(process.env.SDY_CHAT_TTL || '86400', 10); // 마지막 대화 후 이 시간 지나면 방 초기화(펑)
const MEMBER_TTL = 70;        // 핑 없이 이 시간 지나면 접속 종료로 간주
const MAX_MSGS = 200;         // 보관할 최근 메시지 수
const MAX_FILES = 120;        // 보관할 파일 수
const IMG_MAX = 8 * 1024 * 1024;
const FILE_MAX = 20 * 1024 * 1024;
// 채팅 사진/파일은 전부 RAM(오프힙 Buffer)에 둔다. 개수 제한만으로는 대용량
// 파일 120개(최대 2.4GB)가 노려지므로 '총 바이트 예산'으로도 잠근다.
// apply.sh 가 12GB 박스에서 512MB(SDY_CHAT_FILE_MB)를 주입한다.
const FILE_BUDGET = Math.max(64, parseInt(process.env.SDY_CHAT_FILE_MB || '512', 10)) * 1024 * 1024;
const REACTIONS = ['👍', '❤️', '😂', '🔥', '😮', '🎉'];

// 라이브와 동일한 파스텔 팔레트 (닉네임 색 = 라이브 커서 색과 같은 톤)
const PASTELS = ['#f9a8d4', '#fda4af', '#fdba74', '#fcd34d', '#bef264', '#6ee7b7',
                 '#5eead4', '#7dd3fc', '#a5b4fc', '#c4b5fd', '#d8b4fe', '#f0abfc'];

const state = {
  members: new Map(),   // uid -> {uid,name,color,ts,voice,mute}
  msgs: [],             // {id,kind,uid,name,color,text?,file?,reactions?,ts}
  files: new Map(),     // fileId -> {buf,mime,name,size}
  fileBytes: 0,         // files Map 에 들고 있는 Buffer 총량 (예산 초과 시 오래된 것부터 삭제)
  bgm: null,            // {action,track,pos,ts} — 음성참가 배경음악(같이 듣기)
  lastAct: Date.now() / 1000,
  seq: 0,
};

// uid -> Set<SSE client>.  예전에는 이벤트를 배열에 넣은 뒤 1초 타이머가
// 꺼내는 방식이라 채팅이 최대 1초 늦었다. 이제 연결된 응답 스트림에 즉시
// 쓰고, 역압력 때만 큐를 쓴다.
const streams = new Map();
// LTE↔Wi-Fi 전환처럼 EventSource 가 잠깐 재접속하는 동안의 이벤트를 보관한다.
const pending = new Map(); // uid -> event[]

const nowSec = () => Date.now() / 1000;

function pickPastel() {
  const used = new Set();
  for (const m of state.members.values()) if (m.color) used.add(m.color);
  const free = PASTELS.filter((c) => !used.has(c));
  const pool = free.length ? free : PASTELS;
  return pool[Math.floor(Math.random() * pool.length)];
}

const publicMembers = () =>
  [...state.members.values()].map((m) => ({
    uid: m.uid, name: m.name, color: m.color, voice: !!m.voice, mute: !!m.mute,
    verified: !!m.verified,
  }));

function writeSse(client, evt) {
  // 큐가 가득 찬 스트림은 '느려서 버려졌다'는 뜻이다. 이 상태에서 shift 하며
  // 메시지를 밀어내면 재연결 시 재전송을 못 탄다 — 스트림을 죽이고
  // pending 큐(재연결 시 재전송)로 넘어가게 한다.
  if (!client || client.closed) return;
  if (client.queue.length >= 128) {
    client.closed = true;
    try { client.raw.destroy(); } catch { /* noop */ }
    return;
  }
  // presence 는 최신 값 하나면 충분하다. 재접속/느린 수신자 큐가 낡은 상태로
  // 차서 실제 메시지를 밀어내지 않게 한다.
  if (evt.type === 'presence') {
    const i = client.queue.findIndex((x) => x.type === 'presence');
    if (i >= 0) client.queue.splice(i, 1);
  }
  client.queue.push(evt);
  flushSse(client);
}

function flushSse(client) {
  if (!client || client.closed || client.flushing || client.waitingDrain) return;
  client.flushing = true;
  try {
    while (client.queue.length) {
      const evt = client.queue.shift();
      const ok = client.raw.write(`event: yp\ndata: ${JSON.stringify(evt)}\n\n`);
      if (!ok) {
        client.waitingDrain = true;
        const onDrain = () => {
          client.waitingDrain = false;
          client.flushing = false;
          flushSse(client);
        };
        client.raw.once('drain', onDrain);
        // drain 이 영영 안 오면(죽은 소켓) 스트림을 버린다.
        const drainTimer = setTimeout(() => {
          client.raw.off('drain', onDrain);
          client.closed = true;
          try { client.raw.destroy(); } catch { /* noop */ }
        }, 30000);
        if (drainTimer.unref) drainTimer.unref();
        return;
      }
    }
  } catch {
    client.closed = true;
  }
  client.flushing = false;
}

function remember(uid, evt) {
  if (!state.members.has(uid)) return;
  let q = pending.get(uid);
  if (!q) { q = []; pending.set(uid, q); }
  if (evt.type === 'presence') {
    const i = q.findIndex((x) => x.type === 'presence');
    if (i >= 0) q.splice(i, 1);
  }
  if (q.length >= 128) q.shift();
  q.push(evt);
}

function chatSend(uid, evt) {
  const set = streams.get(uid);
  if (!set || !set.size) { remember(uid, evt); return; }
  const dead = [];
  for (const client of set) {
    writeSse(client, evt);
    if (client.closed) dead.push(client);
  }
  for (const client of dead) set.delete(client);
  if (dead.length && !set.size) streams.delete(uid);
  // 스트림이 하나도 남지 않았으면 이 이벤트를 pending 큐에 남겨 재연결 시 전달한다.
  if (dead.length && set.size === 0) remember(uid, evt);
}
function chatBroadcast(evt) {
  // 스트림이 잠시 끊겨도 멤버별 pending 큐에 남겨 재연결 즉시 전달한다.
  for (const uid of state.members.keys()) chatSend(uid, evt);
}
function chatPresence() {
  chatBroadcast({ type: 'presence', members: publicMembers(), ts: nowSec() });
}

// ══════════════════════════════════════════════════════════════
// 서버 릴레이 음성 (WebSocket) — WebRTC 를 아예 안 쓰는 통화
//
// 마이크 소리를 16kHz μ-law(≈16KB/초) 프레임으로 서버에 올리고
// 서버가 음성 참가자들에게 그대로 뿌린다. NAT 통과·TURN·UDP 포트가
// 전혀 필요 없다 — 채팅(SSE)이 열리는 모든 네트워크에서 통화가 된다.
//
// 프로토콜 (/api/chat/voice-ws?uid=…)
//   클라 → 서버  binary: [0x01][μ-law bytes]                 (내 목소리)
//                  text:   {t:'mute', mute:bool} {t:'ping'}
//   서버 → 클라이언트 binary: [0x01][uidLen][uid…][μ-law bytes] (남의 목소리)
//                  text:   {t:'welcome',peers:[…]} {t:'join',…}
//                          {t:'leave',uid} {t:'mute',uid,mute} {t:'pong'}
// ══════════════════════════════════════════════════════════════
const VOICE_MAX_FRAME = 32 * 1024;   // 한 프레임 상한 (16kHz μ-law 1초 ≈ 16KB)
const VOICE_HB_MS = 20000;           // 프록시가 유휴 WS 를 끊지 않게 핑
const voiceSockets = new Map();      // uid -> WebSocket (릴레이 참가자)

function voiceClose(uid, code, reason) {
  const ws = voiceSockets.get(uid);
  if (!ws) return;
  try { ws.close(code || 1000, reason || ''); } catch { /* noop */ }
}

function voiceSendAll(evt, exceptUid) {
  const s = JSON.stringify(evt);
  for (const [uid, ws] of voiceSockets) {
    if (uid === exceptUid) continue;
    if (ws.readyState === 1) { try { ws.send(s); } catch { /* noop */ } }
  }
}
function voicePeers() {
  const out = [];
  for (const [uid, ws] of voiceSockets) {
    const m = state.members.get(uid);
    if (m && ws.readyState === 1) out.push({ uid, name: m.name, color: m.color, mute: !!m.mute, verified: !!m.verified });
  }
  return out;
}
function voiceDetach(uid, ws) {
  if (voiceSockets.get(uid) !== ws) return;   // 이미 새 소켓으로 교체됨
  voiceSockets.delete(uid);
  const m = state.members.get(uid);
  if (m) { m.voice = false; m.ts = nowSec(); }
  chatPresence();
  voiceSendAll({ t: 'leave', uid }, uid);
}
function registerVoiceRelay(app) {
  app.addHook('onReady', () => {
    const srv = app.server;
    if (!srv) return;
    const wss = new WebSocketServer({ noServer: true, maxPayload: VOICE_MAX_FRAME });
    srv.on('upgrade', (req, socket, head) => {
      let path = '';
      let uid = '';
      try {
        const u = new URL(req.url, 'http://localhost');
        path = u.pathname;
        uid = String(u.searchParams.get('uid') || '').trim().slice(0, 40);
      } catch { /* noop */ }
      // 다른 upgrade(없으면 그냥 무시)는 건드리지 않는다.
      if (path !== '/api/chat/voice-ws') return;
      wss.handleUpgrade(req, socket, head, (ws) => {
        const m = state.members.get(uid);
        if (!uid || !m) {
          try { ws.close(4001, '먼저 채팅에 입장해 주세요'); } catch { /* noop */ }
          return;
        }
        const old = voiceSockets.get(uid);
        if (old && old !== ws) { try { old.close(4002, '새 연결로 교체'); } catch { /* noop */ } }
        voiceSockets.set(uid, ws);
        m.voice = true;
        m.ts = nowSec();
        chatPresence();
        try { ws.send(JSON.stringify({ t: 'welcome', uid, peers: voicePeers() })); } catch { /* noop */ }
        voiceSendAll({ t: 'join', uid, name: m.name, color: m.color, mute: !!m.mute, verified: !!m.verified }, uid);

        const hb = setInterval(() => {
          if (ws.readyState !== 1) return;
          try { ws.ping(); } catch { /* noop */ }
        }, VOICE_HB_MS);
        if (hb.unref) hb.unref();

        ws.on('message', (data, isBinary) => {
          if (isBinary) {
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
            if (!buf.length || buf[0] !== 0x01) return;
            // 내 프레임에 보낸 사람 uid 를 붙여 다른 참가자에게 릴레이
            const uidBytes = Buffer.from(uid, 'utf8');
            if (uidBytes.length > 40) return;
            const frame = Buffer.allocUnsafe(2 + uidBytes.length + buf.length - 1);
            frame[0] = 0x01;
            frame[1] = uidBytes.length;
            uidBytes.copy(frame, 2);
            buf.copy(frame, 2 + uidBytes.length, 1);
            for (const [peer, pws] of voiceSockets) {
              if (peer === uid) continue;
              if (pws.readyState === 1) { try { pws.send(frame); } catch { /* noop */ } }
            }
            return;
          }
          let d = null;
          try { d = JSON.parse(String(data)); } catch { return; }
          if (!d || !d.t) return;
          if (d.t === 'ping') {
            try { ws.send(JSON.stringify({ t: 'pong' })); } catch { /* noop */ }
            const mm = state.members.get(uid);
            if (mm) mm.ts = nowSec();
            return;
          }
          if (d.t === 'mute') {
            const mm = state.members.get(uid);
            if (mm) { mm.mute = !!d.mute; mm.ts = nowSec(); }
            chatPresence();
            voiceSendAll({ t: 'mute', uid, mute: !!d.mute }, uid);
          }
        });
        const done = () => { clearInterval(hb); voiceDetach(uid, ws); };
        ws.on('close', done);
        ws.on('error', () => { try { ws.terminate(); } catch { /* noop */ } done(); });
      });
    });
  });
}

function pushMsg(m) {
  state.seq += 1;
  m.id = state.seq;
  m.ts = nowSec();
  state.msgs.push(m);
  while (state.msgs.length > MAX_MSGS) state.msgs.shift();
  state.lastAct = nowSec();
  chatBroadcast({ type: 'msg', msg: m });
  return m;
}

// 채팅 파일 RAM 예산: 개수(기본 120) 와 총 바이트(FILE_BUDGET) 를 모두 지킨다.
// 새로 들어온 파일이 예산보다 크면 최신 1개는 남겨 둔다(메시지가 참조하는 파일이
// 즉시 사라지는 것보다 낫다). 12GB 박스에서 채팅 파일이 메모리를 다 먹는 것을 막는다.
function fileEvict() {
  while (state.files.size > 1 && (state.files.size > MAX_FILES || state.fileBytes > FILE_BUDGET)) {
    const k = state.files.keys().next().value;
    const f = state.files.get(k);
    state.files.delete(k);
    state.fileBytes -= (f && f.buf && f.buf.length) || 0;
  }
  // 단일 파일이 예산을 넘는 경우: 그 1개는 남긴다(위 조건이 size>1 이므로)
}
function fileDrop(fileId) {
  const f = state.files.get(String(fileId || ''));
  if (!f) return;
  state.files.delete(String(fileId));
  state.fileBytes -= (f.buf && f.buf.length) || 0;
}

function sanitizeName(s) {
  return String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24) || '익명 새';
}
function sanitizeText(s) {
  // eslint-disable-next-line no-control-regex
  return String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, 2000);
}

let gcTimer = null;
function startGC() {
  if (gcTimer) return;
  gcTimer = setInterval(() => {
    const now = nowSec();
    // 1) 오래 핑 안 온 멤버 제거
    let removed = false;
    for (const [uid, m] of state.members) {
      if (now - m.ts > MEMBER_TTL) {
        // bye 는 활성 스트림에 먼저 보내고 멤버/대기 큐를 정리한다.
        chatSend(uid, { type: 'bye' });
        voiceClose(uid, 4003, '입장 만료');
        state.members.delete(uid);
        pending.delete(uid);
        removed = true;
      }
    }
    if (removed) chatPresence();
    // 2) 대화 종료 후 TTL 지나면 '펑' — 메시지·파일만 날린다
    if (now - state.lastAct > CHAT_TTL && (state.msgs.length || state.files.size)) {
      state.msgs = [];
      state.files.clear();
      state.fileBytes = 0;
      state.lastAct = now;
      chatBroadcast({ type: 'reset', ts: now });
    }
  }, parseInt(process.env.SDY_CHAT_GC_MS || '30000', 10));
  if (gcTimer.unref) gcTimer.unref();
}

export function registerChat(app) {
  startGC();
  registerVoiceRelay(app);

  // ── 입장 (닉네임 = 새 이름, 색 = 파스텔) ──
  // 16.2 · 회원 토큰을 들고 오면(Authorization: Bearer … 또는 body.token)
  // 고정 닉네임이 강제되고 회원 배지가 붙는다. 비회원이 회원 닉네임을
  // 흉내 내는 것은 서버가 거절한다(409 nickname_protected).
  app.post('/api/chat/join', async (req, reply) => {
    const d = req.body || {};
    const uid = String(d.uid || '').trim().slice(0, 40);
    if (!uid) return reply.code(400).send({ ok: false, error: 'uid 필요' });
    let authToken = String(d.token || '').trim();
    if (!authToken) authToken = String(req.headers['x-sdy-auth'] || '').trim();
    if (!authToken) {
      const auth = req.headers.authorization || '';
      if (auth.startsWith('Bearer ')) authToken = auth.slice(7).trim();
    }
    const user = authToken ? userByTokenSync(authToken) : null;
    let name = sanitizeName(d.name);
    if (user) {
      name = user.nick;   // 회원은 무조건 고정 닉네임
    } else if (name && !(await ypNickFree(name))) {
      // 비회원이 회원 고정닉을 쓰려 함 — 새 이름으로 바꿔 달라는 안내
      return reply.code(409).send({
        ok: false, nickname_protected: true,
        error: '그 닉네임은 회원 고정닉이에요. 로그인하거나 다른 이름을 써 주세요',
      });
    }
    let me = state.members.get(uid);
    if (!me) {
      me = { uid, name, color: pickPastel(), ts: nowSec(), voice: false, mute: false, verified: !!user };
      state.members.set(uid, me);
      chatPresence();
    } else {
      if (me.name !== name || !!me.verified !== !!user) { me.name = name; me.verified = !!user; chatPresence(); }
      me.ts = nowSec();
    }
    return reply.send({
      ok: true,
      me: { uid: me.uid, name: me.name, color: me.color, verified: !!me.verified },
      members: publicMembers(),
      msgs: state.msgs.slice(-80),
      ttl: CHAT_TTL,
      lastAct: state.lastAct,
      reactions: REACTIONS,
      bgm: state.bgm || null,
      voice: 'relay',
    });
  });

  app.post('/api/chat/ping', async (req, reply) => {
    const d = req.body || {};
    const me = state.members.get(String(d.uid || '').trim());
    if (me) me.ts = nowSec();
    return reply.send({ ok: true });
  });

  app.post('/api/chat/leave', async (req, reply) => {
    const d = req.body || {};
    const uid = String(d.uid || '').trim();
    voiceClose(uid, 4004, '퇴장');
    if (state.members.delete(uid)) chatPresence();
    pending.delete(uid);
    return reply.send({ ok: true });
  });

  // ── 메시지 ──
  app.post('/api/chat/msg', async (req, reply) => {
    const d = req.body || {};
    const uid = String(d.uid || '').trim();
    const me = state.members.get(uid);
    if (!me) return reply.code(400).send({ ok: false, error: '먼저 입장해 주세요' });
    const text = sanitizeText(d.text);
    if (!text) return reply.code(400).send({ ok: false, error: '내용이 없습니다' });
    const msg = pushMsg({ kind: 'txt', uid, name: me.name, color: me.color, verified: !!me.verified, text, reactions: {} });
    return reply.send({ ok: true, msg });
  });

  // ── 사진/파일 업로드 ──
  app.post('/api/chat/upload', async (req, reply) => {
    let data;
    try { data = await req.file(); } catch { data = null; }
    if (!data) return reply.code(400).send({ ok: false, error: '파일 없음' });
    // FormData 는 현재 file 필드를 uid 보다 먼저 붙인다. @fastify/multipart 는
    // 파일 스트림을 전부 소비하기 전에는 뒤에 있는 field 를 data.fields 에
    // 채우지 않으므로, uid 를 먼저 읽으면 항상 "먼저 입장"으로 실패한다.
    // 파일을 소비한 뒤 fields 를 확인해 필드 순서와 무관하게 처리한다.
    let buf;
    try { buf = await data.toBuffer(); } catch { buf = null; }
    if (!buf || !buf.length) return reply.code(400).send({ ok: false, error: '빈 파일입니다' });
    let uid = '';
    try { uid = String((data.fields && data.fields.uid && data.fields.uid.value) || '').trim(); } catch { uid = ''; }
    const me = state.members.get(uid);
    if (!me) return reply.code(400).send({ ok: false, error: '먼저 입장해 주세요' });
    const mime = String(data.mimetype || 'application/octet-stream').toLowerCase();
    const kind = mime.startsWith('image/') ? 'img' : 'file';
    const cap = kind === 'img' ? IMG_MAX : FILE_MAX;
    if (buf.length > cap) {
      return reply.code(400).send({
        ok: false,
        error: `${kind === 'img' ? '사진은' : '파일은'} ${Math.round(cap / 1048576)}MB 이하만 가능해요`,
      });
    }
    const fileId = crypto.randomBytes(8).toString('hex');
    const fname = String(data.filename || (kind === 'img' ? 'image.jpg' : 'file')).slice(0, 120);
    state.files.set(fileId, { buf, mime, name: fname, size: buf.length });
    state.fileBytes += buf.length;
    fileEvict();   // 개수 + 총 바이트 예산 모두 적용
    const msg = pushMsg({
      kind, uid, name: me.name, color: me.color, verified: !!me.verified,
      file: { id: fileId, name: fname, size: buf.length, mime }, reactions: {},
    });
    return reply.send({ ok: true, msg });
  });

  // ── 파일 내려받기/이미지 표시 ──
  app.get('/api/chat/file/:id', async (req, reply) => {
    const f = state.files.get(String(req.params.id || ''));
    if (!f) return reply.code(404).send({ error: '파일이 사라졌어요 (방이 펑 했거나 오래된 파일)' });
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Type', f.mime);
    reply.header('Content-Length', f.size);
    const inline = f.mime.startsWith('image/');
    reply.header('Content-Disposition',
      inline ? 'inline' : `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    return reply.send(f.buf);
  });

  // ── 이모지 반응 ──
  app.post('/api/chat/react', async (req, reply) => {
    const d = req.body || {};
    const uid = String(d.uid || '').trim();
    const me = state.members.get(uid);
    if (!me) return reply.code(400).send({ ok: false, error: '먼저 입장해 주세요' });
    const id = parseInt(d.id, 10);
    const emoji = String(d.emoji || '');
    if (!REACTIONS.includes(emoji)) return reply.code(400).send({ ok: false, error: '지원하지 않는 이모지' });
    const msg = state.msgs.find((m) => m.id === id);
    if (!msg) return reply.code(404).send({ ok: false, error: '메시지가 없습니다' });
    msg.reactions = msg.reactions || {};
    const list = msg.reactions[emoji] || (msg.reactions[emoji] = []);
    const i = list.indexOf(uid);
    if (i >= 0) list.splice(i, 1); else list.push(uid);
    if (!list.length) delete msg.reactions[emoji];
    state.lastAct = nowSec();
    chatBroadcast({ type: 'react', id, reactions: msg.reactions });
    return reply.send({ ok: true });
  });

  // ── 메시지 삭제 (본인 메시지만) ──
  app.post('/api/chat/del', async (req, reply) => {
    const d = req.body || {};
    const uid = String(d.uid || '').trim();
    const me = state.members.get(uid);
    if (!me) return reply.code(400).send({ ok: false, error: '먼저 입장해 주세요' });
    const id = parseInt(d.id, 10);
    const i = state.msgs.findIndex((m) => m.id === id);
    if (i < 0) return reply.code(404).send({ ok: false, error: '메시지가 없습니다' });
    const msg = state.msgs[i];
    if (msg.uid !== uid) return reply.code(403).send({ ok: false, error: '내 메시지만 지울 수 있어요' });
    state.msgs.splice(i, 1);
    if (msg.file && msg.file.id) fileDrop(msg.file.id);
    state.lastAct = nowSec();
    chatBroadcast({ type: 'del', id });
    return reply.send({ ok: true });
  });

  // ── 음성참가 배경음악(같이 듣기) — 재생 상태를 방 전체에 동기화 ──
  app.post('/api/chat/bgm', async (req, reply) => {
    const d = req.body || {};
    const uid = String(d.uid || '').trim();
    const me = state.members.get(uid);
    if (!me) return reply.code(400).send({ ok: false, error: '먼저 입장해 주세요' });
    const action = String(d.action || 'play');
    if (!['play', 'pause', 'stop'].includes(action)) {
      return reply.code(400).send({ ok: false, error: '잘못된 동작입니다' });
    }
    let track = null;
    if (action !== 'stop') {
      const t = (d.track && typeof d.track === 'object') ? d.track : {};
      track = {
        id: String(t.id || '').slice(0, 80),
        title: String(t.title || '').slice(0, 120),
        artist: String(t.artist || '').slice(0, 120),
      };
      if (!track.id) return reply.code(400).send({ ok: false, error: '곡이 없습니다' });
    }
    const evt = {
      type: 'bgm', from: { uid, name: me.name, color: me.color, verified: !!me.verified },
      action, track, pos: Math.max(0, parseFloat(d.pos) || 0), ts: nowSec(),
    };
    state.bgm = action === 'stop' ? null : { action, track, pos: evt.pos, ts: evt.ts };
    chatBroadcast(evt);
    return reply.send({ ok: true });
  });

  // ── 노크 (접속 중인 모두에게 알림) ──
  app.post('/api/chat/knock', async (req, reply) => {
    const d = req.body || {};
    const uid = String(d.uid || '').trim();
    const me = state.members.get(uid);
    if (!me) return reply.code(400).send({ ok: false, error: '먼저 입장해 주세요' });
    chatBroadcast({ type: 'knock', from: { uid, name: me.name, color: me.color, verified: !!me.verified }, ts: nowSec() });
    return reply.send({ ok: true });
  });

  // ── 통화 설정 (릴레이 전용 — WebRTC/TURN 은 제거됨) ──
  app.get('/api/chat/config', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return reply.send({ ok: true, voice: 'relay' });
  });

  // ── 음성 상태 (WS 가 권위. 이 엔드포인트는 폴백/정리용) ──
  app.post('/api/chat/voice', async (req, reply) => {
    const d = req.body || {};
    const uid = String(d.uid || '').trim();
    const me = state.members.get(uid);
    if (!me) return reply.code(400).send({ ok: false, error: '먼저 입장해 주세요' });
    me.voice = !!d.on;
    me.mute = !!d.mute;
    me.ts = nowSec();
    if (!d.on) voiceClose(uid, 4005, '음성 종료');
    chatPresence();
    return reply.send({ ok: true, members: publicMembers() });
  });

  // ── SSE 스트림 (즉시 push + 재접속 중 이벤트 보존) ──
  app.get('/api/chat/stream', async (req, reply) => {
    const uid = String(req.query.uid || '').trim().slice(0, 40);
    if (!uid) return reply.code(400).send({ ok: false, error: 'uid 필요' });
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // 프록시가 헤더/첫 이벤트를 즉시 내보내도록 한다.
    if (typeof reply.raw.flushHeaders === 'function') reply.raw.flushHeaders();

    const client = {
      raw: reply.raw, queue: [], closed: false, flushing: false, waitingDrain: false,
    };
    if (!streams.has(uid)) streams.set(uid, new Set());
    streams.get(uid).add(client);
    writeSse(client, { type: 'hello', ts: nowSec() });

    // 네트워크 전환 중 쌓인 채팅을 hello 직후 순서대로 보낸다.
    const held = pending.get(uid) || [];
    pending.delete(uid);
    for (const evt of held) writeSse(client, evt);

    const keepAlive = setInterval(() => {
      if (client.closed) return;
      try { reply.raw.write(': keep-alive\n\n'); } catch { client.closed = true; }
    }, 15000);
    if (keepAlive.unref) keepAlive.unref();

    // close/error 어느 쪽으로 끊겨도 스트림 집합에서 바로 제거한다.
    const cleanup = () => {
      clearInterval(keepAlive);
      client.closed = true;
      const set = streams.get(uid);
      if (set) { set.delete(client); if (!set.size) streams.delete(uid); }
    };
    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);
  });
}
