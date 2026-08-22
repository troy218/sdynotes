// 엽스코드(Youpscord) — 앱 전체 공용 익명 채팅방.
//   텍스트 · 사진 · 파일 · 이모지(+반응) · 실시간 음성(WebRTC 시그널링 릴레이).
//
// 방은 영구 저장하지 않는다(인메모리): 마지막 대화 후 CHAT_TTL(24시간)이 지나면
// 메시지·파일이 '펑' 하고 사라진다. 닉네임은 라이브 새 이름 + 파스텔 색(라이브와 동일 팔레트).
import crypto from 'node:crypto';
import net from 'node:net';
import dgram from 'node:dgram';

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

// ── TURN 진단용 STUN 바인딩 요청 (UDP liveness) ──
// coturn 은 인증 없이도 STUN Binding request 에 응답하므로, UDP 로 한 방
// 보내서 응답이 오는지만 본다. TCP 는 net.connect 로 검사한다.
function stunPing(host, port, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let sock;
    try { sock = dgram.createSocket('udp4'); } catch { return resolve({ ok: false, err: 'socket 생성 실패' }); }
    const finish = (ok, err) => {
      if (done) return;
      done = true;
      clearTimeout(tm);
      try { sock.close(); } catch { /* noop */ }
      resolve(ok ? { ok: true } : { ok: false, err: err || 'timeout' });
    };
    const tm = setTimeout(() => finish(false), timeoutMs);
    sock.once('message', (msg) => {
      // 내 transaction id 가 실린 응답이어야 정상. (응답 0x0101 / 오류 0x0111 둘 다 liveness 확인)
      const t = msg.length >= 20 ? msg.readUInt16BE(0) : 0;
      const sameTx = msg.length >= 20 && txid.equals(msg.subarray(8, 20));
      if (sameTx && (t === 0x0101 || t === 0x0111)) return finish(true);
    });
    sock.once('error', (e) => finish(false, String((e && e.message) || e)));
    const tx = Buffer.alloc(20);
    tx.writeUInt16BE(0x0001, 0);            // STUN Binding request
    tx.writeUInt16BE(0x0000, 2);            // message length = 0
    tx.writeUInt32BE(0x2112a442, 4);        // magic cookie
    const txid = crypto.randomBytes(12);
    txid.copy(tx, 8);                       // transaction id
    sock.send(tx, 0, tx.length, port, host, (e) => {
      if (e) finish(false, String((e && e.message) || e));
    });
  });
}

function turnHostPort(urlText) {
  // turn:host:3478?transport=tcp / turns:host:3478 → {host, port}
  const m = String(urlText || '').replace(/^turns?:/i, '').split(/[\/?#]/)[0].split(':');
  return { host: m[0] || '', port: parseInt(m[1], 10) || 3478 };
}

// ── TURN Allocate 실측 (RFC 5766 + long-term credential) ──
// STUN binding 이 성공해도 "TURN 릴레이 할당"은 인증·포트 정책 때문에 별도로
// 실패할 수 있다. 브라우저가 하는 것과 동일한 흐름(401 챌린지 → Allocate →
// Refresh)을 직접 수행해서 "TURN 으로 실제 통화가 가능한가"를 판정한다.
function stunAttrs(buf, start) {
  // buf: STUN 메시지. start: 20(헤더). → Map<type, Buffer>
  const out = new Map();
  let off = start;
  while (off + 4 <= buf.length) {
    const type = buf.readUInt16BE(off);
    const len = buf.readUInt16BE(off + 2);
    if (off + 4 + len > buf.length) break;
    out.set(type, buf.subarray(off + 4, off + 4 + len));
    off += 4 + len + (len % 4 ? 4 - (len % 4) : 0);
  }
  return out;
}
function stunMsg(type, txid, attrParts) {
  // RFC 5389: 모든 속성 값은 4바이트 정렬로 패딩해야 한다. 패딩을 빼먹으면
  // 속성 경계가 어긋나 coturn/브라우저가 MESSAGE-INTEGRITY 를 못 찾는다.
  const parts = attrParts.map((p) => {
    const v = p.value;
    const pad = (4 - (v.length % 4)) % 4;
    const buf = Buffer.alloc(4 + v.length + pad);
    buf.writeUInt16BE(p.type, 0);
    buf.writeUInt16BE(v.length, 2);
    v.copy(buf, 4);
    return buf;
  });
  const body = Buffer.concat(parts);
  const msg = Buffer.alloc(20 + body.length);
  msg.writeUInt16BE(type, 0);
  msg.writeUInt16BE(body.length, 2);
  msg.writeUInt32BE(0x2112a442, 4);
  txid.copy(msg, 8);
  body.copy(msg, 20);
  return msg;
}
function stunStrAttr(type, s) {
  return { type, value: Buffer.from(String(s), 'utf8') };
}
function stunRawAttr(type, buf) {
  return { type, value: buf };
}
function stunAttrWithMi(type, txid, attrs, miKey) {
  // MESSAGE-INTEGRITY 는 마지막 자리에 20바이트 0 으로 채워 넣고 HMAC 을 계산한다.
  let msg = stunMsg(type, txid, [...attrs, { type: 0x0008, value: Buffer.alloc(20) }]);
  const key = crypto.createHash('md5').update(miKey, 'utf8').digest();
  const mi = crypto.createHmac('sha1', key).update(msg).digest();
  mi.copy(msg, msg.length - 20);
  return msg;
}
function turnAllocate(host, port, username, password, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let sock;
    try { sock = dgram.createSocket('udp4'); } catch { return resolve({ ok: false, err: 'socket 생성 실패' }); }
    const finish = (ok, err) => {
      if (done) return;
      done = true;
      clearTimeout(tm);
      try { sock.close(); } catch { /* noop */ }
      // 성공이면 err 에 상세(relay=...)를 실어 보낸다.
      resolve(ok ? { ok: true, err } : { ok: false, err: err || 'timeout' });
    };
    const tm = setTimeout(() => finish(false, 'timeout'), timeoutMs);
    sock.once('error', (e) => finish(false, String((e && e.message) || e)));
    const txid = crypto.randomBytes(12);
    const reqTransport = stunRawAttr(0x0019, Buffer.from([0x11, 0x00, 0x00, 0x00])); // UDP
    const first = stunMsg(0x0003, txid, [reqTransport]); // Allocate (no auth → 401)
    sock.once('message', (msg) => {
      // 1차: (a) 인증 없는 TURN 이면 곧바로 성공, (b) 401 챌린지 → REALM/NONCE 추출
      const t0 = msg.length >= 2 ? msg.readUInt16BE(0) : 0;
      if (t0 === 0x0103) {
        const ra = stunAttrs(msg, 20).get(0x0016);
        const addr = ra && ra.length >= 8
          ? `${ra.readUInt8(2)}.${ra.readUInt8(3)}.${ra.readUInt8(4)}.${ra.readUInt8(5)}:${ra.readUInt16BE(6)}`
          : '?';
        return finish(true, `relay=${addr}`);
      }
      const attrs = stunAttrs(msg, 20);
      const realm = attrs.get(0x0014);
      const nonce = attrs.get(0x0015);
      if (!realm || !nonce) return finish(false, '401 응답에 realm/nonce 없음');
      const miKey = `${username}:${realm.toString('utf8')}:${password}`;
      const authAttrs = [
        reqTransport,
        stunStrAttr(0x0006, username),          // USERNAME
        stunRawAttr(0x0014, realm),             // REALM
        stunRawAttr(0x0015, nonce),             // NONCE
      ];
      const txid2 = crypto.randomBytes(12);
      const second = stunAttrWithMi(0x0003, txid2, authAttrs, miKey);
      sock.once('message', (msg2) => {
        const type2 = msg2.length >= 2 ? msg2.readUInt16BE(0) : 0;
        const attrs2 = stunAttrs(msg2, 20);
        if (type2 === 0x0103) {
          // 성공 → RELAYED-ADDRESS 확인 후 Refresh 로 할당 해제
          const relayed = attrs2.get(0x0016);
          const txid3 = crypto.randomBytes(12);
          const refresh = stunAttrWithMi(0x0004, txid3, [
            stunStrAttr(0x0006, username),
            stunRawAttr(0x0014, realm),
            stunRawAttr(0x0015, nonce),
          ], miKey);
          try { sock.send(refresh, 0, refresh.length, port, host, () => {}); } catch { /* noop */ }
          // RELAYED-ADDRESS 값(8바이트): family(1) + reserved(1) + IPv4(4) + port(2)
          const addr = relayed && relayed.length >= 8
            ? `${relayed.readUInt8(2)}.${relayed.readUInt8(3)}.${relayed.readUInt8(4)}.${relayed.readUInt8(5)}:${relayed.readUInt16BE(6)}`
            : '?';
          return finish(true, `relay=${addr}`);
        }
        const errCode = attrs2.get(0x0009);
        // ERROR-CODE 값: 예약 2바이트 + 클래스(백의 자리) 1바이트 + 번호 1바이트
        const code = errCode && errCode.length >= 4 ? (errCode[2] * 100 + errCode[3]) : type2;
        return finish(false, `Allocate 실패 type=${type2} code=${code}`);
      });
      try { sock.send(second, 0, second.length, port, host, (e) => { if (e) finish(false, String((e && e.message) || e)); }); } catch (e) { finish(false, String((e && e.message) || e)); }
    });
    try { sock.send(first, 0, first.length, port, host, (e) => { if (e) finish(false, String((e && e.message) || e)); }); } catch (e) { finish(false, String((e && e.message) || e)); }
  });
}

function tcpCheck(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: timeoutMs });
    let done = false;
    const finish = (ok, err) => {
      if (done) return;
      done = true;
      try { s.destroy(); } catch { /* noop */ }
      resolve(ok ? { ok: true } : { ok: false, err: err || 'timeout' });
    };
    s.once('connect', () => finish(true));
    s.once('error', (e) => finish(false, String((e && e.message) || e)));
    s.once('timeout', () => finish(false, 'timeout'));
  });
}

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

    // turn:host:3478 (쿼리 없음) 은 브라우저에서 UDP 전용이다. 통신사 CGNAT·
    // UDP 차단 망은 TCP 3478 이 열려 있어도 브라우저가 시도하지 않아 '연결 중'에
    // 멈춘다. 베이스 URL 만 오면 UDP 엔트리와 `?transport=tcp` 엔트리를 따로 만든다.
    // `?transport=` 를 같은 urls[] 에 섞으면 일부 브라우저가 한쪽만 시도하고
    // 끝나므로 iceServers 를 URL 당 한 줄로 분리한다.
    const expandTurnUrls = (txt) => {
      const udp = [];
      const tcp = [];
      const seen = new Set();
      const add = (arr, u) => {
        const key = String(u || '').toLowerCase();
        if (!u || seen.has(key)) return;
        seen.add(key);
        arr.push(u);
      };
      for (const raw of String(txt).split(',')) {
        let u = raw.trim();
        if (!u || !/^turns?:/i.test(u)) continue;
        let transport = '';
        const q = u.indexOf('?');
        if (q >= 0) {
          const qs = u.slice(q + 1);
          u = u.slice(0, q);
          const t = qs.split('&').find((s) => s.startsWith('transport='));
          transport = t ? t.slice('transport='.length).toLowerCase() : '';
        }
        if (transport === 'tcp') add(tcp, `${u}?transport=tcp`);
        else add(udp, u); // udp / 미지정 → 쿼리 없는 UDP (브라우저 기본)
      }
      // 베이스 URL 만 온 경우 TCP 를 빠뜨리면 열어 둔 TCP 3478 이 영원히 안 쓰인다.
      if (udp.length && !tcp.length) {
        for (const u of udp) {
          if (!/^turns:/i.test(u)) add(tcp, `${u}?transport=tcp`);
        }
      }
      return [...udp, ...tcp];
    };

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
      const urls = expandTurnUrls(urlsText);
      if (!urls.length) return;
      turnReady = turnReady || Boolean(username && credential);
      for (const url of urls) {
        iceServers.push({
          urls: [url], username, credential, credentialType: 'password',
        });
      }
    };

    // 외부 TURN(있으면) → 같은 호스트라도 별도 엔트리로 추가해 인증 방식 차이를 보존.
    addTurn(externalTurn, true);
    // apply.sh 가 만든 Oracle TURN. SDY_LOCAL_TURN_URL 이 비어있지 않으면
    // 외부와 같은 호스트라도 항상 push 한다 — 사용자가 명시적으로 두 라인을
    // 켠 의도(고정 인증 + HMAC 임시 인증)를 그대로 전달하는 게 안전하다.
    // 브라우저는 같은 호스트 + 다른 credential 을 별도 iceServer 로 받아도
    // 한쪽이 실패하면 다른쪽으로 candidate 를 다시 만든다.
    if (localTurn) {
      addTurn(localTurn, false);
    }
    reply.header('Cache-Control', 'no-store');
    return reply.send({ ok: true, turn: turnReady, ice: { iceServers } });
  });

  // ── 통화(TURN) 진단 — curl http://127.0.0.1:5000/api/chat/diag ──
  // 포트를 다 열었는데도 서로 다른 망 통화가 안 될 때, 서버 안에서 coturn 이
  // 살아 있는지 / 외부 경로(공인IP)가 닿는지를 한 번에 보여 준다.
  app.get('/api/chat/diag', async (req, reply) => {
    const env = process.env;
    const localTurn = (env.SDY_LOCAL_TURN_URL || '').trim();
    const externalTurn = (env.SDY_TURN_URL || '').trim();
    const secret = (env.SDY_TURN_SECRET || '').trim();
    const publicIp = (env.SDY_TURN_PUBLIC_IP || '').trim();
    const targets = [];
    const seen = new Set();
    for (const t of [localTurn, externalTurn]) {
      const u = String(t || '').trim();
      if (!u || seen.has(u)) continue;
      seen.add(u);
      targets.push(u);
    }
    const out = {
      ok: false,
      ts: new Date().toISOString(),
      note: 'local=127.0.0.1(서버 안) · public=공인IP(외부 경로, hairpin 이면 서버 안에서는 실패로 보일 수 있음)',
      env: {
        SDY_LOCAL_TURN_URL: localTurn || null,
        SDY_TURN_URL: externalTurn || null,
        SDY_TURN_PUBLIC_IP: publicIp || null,
        hasSecret: !!secret,
      },
      checks: {},
    };
    // HMAC 임시 인증이 가능하면 브라우저와 동일한 TURN Allocate 를 실제로 시도한다.
    const expiry = Math.floor(nowSec()) + 3600;
    const uname = `${expiry}:diag-${crypto.randomBytes(4).toString('hex')}`;
    const password = secret ? crypto.createHmac('sha1', secret).update(uname).digest('base64') : '';
    for (const u of targets) {
      const { host, port } = turnHostPort(u);
      const key = u;
      const rec = { host, port };
      // 서버 자신(localhost) → coturn 프로세스가 실제로 3478 에 떠 있는지
      const lt = await tcpCheck('127.0.0.1', port, 4000);
      const lu = await stunPing('127.0.0.1', port, 4000);
      rec.localTcp = lt.ok ? 'ok' : 'fail';
      rec.localUdp = lu.ok ? 'ok' : `fail(${lu.err})`;
      // 공인 IP → VCN 인그레스 규칙이 실제로 열려 있는지 (서버 밖에서만 확정 가능)
      if (publicIp && host !== '127.0.0.1' && host !== 'localhost') {
        const pt = await tcpCheck(host, port, 5000);
        const pu = await stunPing(host, port, 5000);
        rec.publicTcp = pt.ok ? 'ok' : `fail(${pt.err})`;
        rec.publicUdp = pu.ok ? 'ok' : `fail(${pu.err})`;
        if (secret) {
          const pa = await turnAllocate(host, port, uname, password, 8000);
          rec.publicAlloc = pa.ok ? `ok(${pa.err})` : `fail(${pa.err})`;
        } else {
          rec.publicAlloc = 'skip(secret 없음)';
        }
      }
      if (secret) {
        const la = await turnAllocate('127.0.0.1', port, uname, password, 8000);
        rec.localAlloc = la.ok ? `ok(${la.err})` : `fail(${la.err})`;
      } else {
        rec.localAlloc = 'skip(secret 없음)';
      }
      out.checks[key] = rec;
    }
    out.ok = Object.keys(out.checks).length > 0;
    reply.header('Cache-Control', 'no-store');
    return reply.send(out);
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
