// 엽스코드(Youpscord) — 앱 전체 공용 익명 채팅방.
//   텍스트 · 사진 · 파일 · 이모지(+반응) · 실시간 음성(WebRTC 시그널링 릴레이).
//
// 방은 영구 저장하지 않는다(인메모리): 마지막 대화 후 CHAT_TTL(24시간)이 지나면
// 메시지·파일이 '펑' 하고 사라진다. 닉네임은 라이브 새 이름 + 파스텔 색(라이브와 동일 팔레트).
import crypto from 'node:crypto';

const CHAT_TTL = parseInt(process.env.SDY_CHAT_TTL || '86400', 10); // 마지막 대화 후 이 시간 지나면 방 초기화(펑)
const MEMBER_TTL = 70;        // 핑 없이 이 시간 지나면 접속 종료로 간주
const MAX_MSGS = 200;         // 보관할 최근 메시지 수
const MAX_FILES = 120;        // 보관할 파일 수
const IMG_MAX = 8 * 1024 * 1024;
const FILE_MAX = 20 * 1024 * 1024;
const REACTIONS = ['👍', '❤️', '😂', '🔥', '😮', '🎉'];

// 라이브와 동일한 파스텔 팔레트 (닉네임 색 = 라이브 커서 색과 같은 톤)
const PASTELS = ['#f9a8d4', '#fda4af', '#fdba74', '#fcd34d', '#bef264', '#6ee7b7',
                 '#5eead4', '#7dd3fc', '#a5b4fc', '#c4b5fd', '#d8b4fe', '#f0abfc'];

const state = {
  members: new Map(),   // uid -> {uid,name,color,ts,voice,mute}
  msgs: [],             // {id,kind,uid,name,color,text?,file?,reactions?,ts}
  files: new Map(),     // fileId -> {buf,mime,name,size}
  bgm: null,            // {action,track,pos,ts} — 음성참가 배경음악(같이 듣기)
  lastAct: Date.now() / 1000,
  seq: 0,
};

// uid -> Set<SSE client>.  예전에는 이벤트를 배열에 넣은 뒤 1초 타이머가
// 꺼내는 방식이라 채팅은 최대 1초, WebRTC offer/answer/ICE 는 단계마다 최대
// 1초씩 늦었다. 이제 연결된 응답 스트림에 즉시 쓰고, 역압력 때만 큐를 쓴다.
const streams = new Map();
// LTE↔Wi-Fi 전환처럼 EventSource 가 잠깐 재접속하는 동안의 이벤트를 보관한다.
// 특히 이 구간의 WebRTC offer/ICE 를 버리면 통화가 영원히 "연결 중"에 머문다.
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
  }));

function writeSse(client, evt) {
  if (!client || client.closed) return;
  if (client.queue.length >= 128) client.queue.shift();
  // presence 는 최신 값 하나면 충분하다. 재접속/느린 수신자 큐가 낡은 상태로
  // 차서 실제 메시지나 시그널을 밀어내지 않게 한다.
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
        client.raw.once('drain', () => {
          client.waitingDrain = false;
          client.flushing = false;
          flushSse(client);
        });
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
  for (const client of set) writeSse(client, evt);
}
function chatBroadcast(evt) {
  // 스트림이 잠시 끊겨도 멤버별 pending 큐에 남겨 재연결 즉시 전달한다.
  for (const uid of state.members.keys()) chatSend(uid, evt);
}
function chatPresence() {
  chatBroadcast({ type: 'presence', members: publicMembers(), ts: nowSec() });
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
      state.lastAct = now;
      chatBroadcast({ type: 'reset', ts: now });
    }
  }, parseInt(process.env.SDY_CHAT_GC_MS || '30000', 10));
  if (gcTimer.unref) gcTimer.unref();
}

export function registerChat(app) {
  startGC();

  // ── 입장 (닉네임 = 새 이름, 색 = 파스텔) ──
  app.post('/api/chat/join', async (req, reply) => {
    const d = req.body || {};
    const uid = String(d.uid || '').trim().slice(0, 40);
    if (!uid) return reply.code(400).send({ ok: false, error: 'uid 필요' });
    const name = sanitizeName(d.name);
    let me = state.members.get(uid);
    if (!me) {
      me = { uid, name, color: pickPastel(), ts: nowSec(), voice: false, mute: false };
      state.members.set(uid, me);
      chatPresence();
    } else {
      if (me.name !== name) { me.name = name; chatPresence(); }
      me.ts = nowSec();
    }
    return reply.send({
      ok: true,
      me: { uid: me.uid, name: me.name, color: me.color },
      members: publicMembers(),
      msgs: state.msgs.slice(-80),
      ttl: CHAT_TTL,
      lastAct: state.lastAct,
      reactions: REACTIONS,
      bgm: state.bgm || null,
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
    const msg = pushMsg({ kind: 'txt', uid, name: me.name, color: me.color, text, reactions: {} });
    return reply.send({ ok: true, msg });
  });

  // ── 사진/파일 업로드 ──
  app.post('/api/chat/upload', async (req, reply) => {
    let data;
    try { data = await req.file(); } catch { data = null; }
    if (!data) return reply.code(400).send({ ok: false, error: '파일 없음' });
    let uid = '';
    try { uid = String((data.fields && data.fields.uid && data.fields.uid.value) || '').trim(); } catch { uid = ''; }
    const me = state.members.get(uid);
    if (!me) return reply.code(400).send({ ok: false, error: '먼저 입장해 주세요' });
    let buf;
    try { buf = await data.toBuffer(); } catch { buf = null; }
    if (!buf || !buf.length) return reply.code(400).send({ ok: false, error: '빈 파일입니다' });
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
    while (state.files.size > MAX_FILES) {
      const k = state.files.keys().next().value;
      state.files.delete(k);
    }
    const msg = pushMsg({
      kind, uid, name: me.name, color: me.color,
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
    if (msg.file && msg.file.id) state.files.delete(msg.file.id);
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
      type: 'bgm', from: { uid, name: me.name, color: me.color },
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
    chatBroadcast({ type: 'knock', from: { uid, name: me.name, color: me.color }, ts: nowSec() });
    return reply.send({ ok: true });
  });

  // ── WebRTC ICE 설정 (STUN 다중 + TURN 환경변수) ──
  app.get('/api/chat/config', async (req, reply) => {
    // STUN 은 '공인 IP 확인'만 도와준다. 방화벽·대칭 NAT·통신사(CGNAT) 뒤에서는
    // STUN 으로는 P2P 가 맺어지지 않아 '연결 중'에서 멈춘다 → TURN 이 필수.
    const iceServers = [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: ['stun:stun.cloudflare.com:3478'] },
    ];
    const externalTurn = (process.env.SDY_TURN_URL || '').trim();
    const localTurn = (process.env.SDY_LOCAL_TURN_URL || '').trim();
    const secret = (process.env.SDY_TURN_SECRET || '').trim();
    const uid = String((req.query && req.query.uid) || 'guest')
      .replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 40) || 'guest';
    let turnReady = false;

    const addTurn = (urlsText, preferStatic) => {
      if (!urlsText) return;
      let username = preferStatic ? (process.env.SDY_TURN_USER || '').trim() : '';
      let credential = preferStatic ? (process.env.SDY_TURN_PASS || '').trim() : '';
      // coturn REST 방식의 1시간짜리 임시 자격 증명. 고정 비밀번호를 브라우저에
      // 계속 노출하지 않으며 apply.sh 가 설치한 자체 TURN 과 바로 호환된다.
      if ((!username || !credential) && secret) {
        username = `${Math.floor(nowSec()) + 3600}:${uid}`;
        credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
      }
      turnReady = turnReady || Boolean(username && credential);
      iceServers.push({
        urls: urlsText.split(',').map((s) => s.trim()).filter(Boolean),
        username, credential, credentialType: 'password',
      });
    };

    addTurn(externalTurn, true);       // 사용자가 지정한 외부 TURN(있으면 그대로 보존)
    if (localTurn !== externalTurn) addTurn(localTurn, false); // apply.sh 가 만든 Oracle TURN
    reply.header('Cache-Control', 'no-store');
    return reply.send({ ok: true, turn: turnReady, ice: { iceServers } });
  });

  // ── 음성 상태 ──
  app.post('/api/chat/voice', async (req, reply) => {
    const d = req.body || {};
    const uid = String(d.uid || '').trim();
    const me = state.members.get(uid);
    if (!me) return reply.code(400).send({ ok: false, error: '먼저 입장해 주세요' });
    me.voice = !!d.on;
    me.mute = !!d.mute;
    me.ts = nowSec();
    chatPresence();
    return reply.send({ ok: true, members: publicMembers() });
  });

  // ── WebRTC 시그널링 릴레이 (peer → peer) ──
  app.post('/api/chat/signal', async (req, reply) => {
    const d = req.body || {};
    const uid = String(d.uid || '').trim();
    const to = String(d.to || '').trim();
    if (!state.members.has(uid)) return reply.code(400).send({ ok: false, error: '먼저 입장해 주세요' });
    if (!state.members.has(to)) return reply.code(404).send({ ok: false, error: '상대가 없습니다' });
    chatSend(to, { type: 'signal', from: uid, kind: String(d.kind || ''), payload: d.payload || null });
    return reply.send({ ok: true });
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

    // 네트워크 전환 중 쌓인 채팅/offer/ICE 를 hello 직후 순서대로 보낸다.
    const held = pending.get(uid) || [];
    pending.delete(uid);
    for (const evt of held) writeSse(client, evt);

    const keepAlive = setInterval(() => {
      if (client.closed) return;
      try { reply.raw.write(': keep-alive\n\n'); } catch { client.closed = true; }
    }, 15000);
    if (keepAlive.unref) keepAlive.unref();

    req.raw.on('close', () => {
      clearInterval(keepAlive);
      client.closed = true;
      const set = streams.get(uid);
      if (set) { set.delete(client); if (!set.size) streams.delete(uid); }
    });
  });
}
