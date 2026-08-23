// 엽스코드(Youpscord) — 앱 전체 공용 익명 채팅방.
//   텍스트 · 사진 · 파일 · 이모지(+반응) · 실시간 음성(WebRTC 시그널링 릴레이).
//
// 방은 영구 저장하지 않는다(인메모리): 마지막 대화 후 CHAT_TTL(24시간)이 지나면
// 메시지·파일이 '펑' 하고 사라진다. 닉네임은 라이브 새 이름 + 파스텔 색(라이브와 동일 팔레트).
import crypto from 'node:crypto';
import net from 'node:net';
import dgram from 'node:dgram';
import os from 'node:os';

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
function stunUInt32Attr(type, n) {
  const value = Buffer.alloc(4);
  value.writeUInt32BE(n >>> 0, 0);
  return { type, value };
}
function xorRelayedAddress(value) {
  // XOR-RELAYED-ADDRESS: reserved(1), family(1), XOR-port(2), XOR-address(4).
  if (!value || value.length < 8 || value.readUInt8(1) !== 0x01) return '?';
  const cookie = Buffer.from([0x21, 0x12, 0xa4, 0x42]);
  const port = value.readUInt16BE(2) ^ 0x2112;
  const octets = [];
  for (let i = 0; i < 4; i++) octets.push(value.readUInt8(4 + i) ^ cookie[i]);
  return `${octets.join('.')}:${port}`;
}
function stunAttrWithMi(type, txid, attrs, miKey) {
  // RFC 5389 §15.4: 헤더의 length 는 MESSAGE-INTEGRITY 끝까지 포함해야 하지만,
  // HMAC 입력은 MI 속성 자체(4바이트 헤더 + 20바이트 값) 직전까지만이다.
  // 0으로 채운 MI까지 HMAC에 넣으면 coturn은 패킷을 무결성 오류로 버린다.
  const msg = stunMsg(type, txid, [...attrs, { type: 0x0008, value: Buffer.alloc(20) }]);
  const key = crypto.createHash('md5').update(miKey, 'utf8').digest();
  const miOffset = msg.length - 24;
  const mi = crypto.createHmac('sha1', key).update(msg.subarray(0, miOffset)).digest();
  mi.copy(msg, miOffset + 4);
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
        return finish(true, `relay=${xorRelayedAddress(ra)}`);
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
            stunUInt32Attr(0x000d, 0), // LIFETIME=0: 진단이 만든 allocation 즉시 해제
          ], miKey);
          try { sock.send(refresh, 0, refresh.length, port, host, () => {}); } catch { /* noop */ }
          return finish(true, `relay=${xorRelayedAddress(relayed)}`);
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

function localTurnAddresses(configured) {
  // Oracle VM의 coturn은 보통 listening-ip=10.x.x.x 로 떠서 127.0.0.1에는
  // 일부러 바인딩하지 않는다. localhost만 검사하면 정상 서버도 fail로 오진한다.
  const out = [];
  const add = (v) => {
    const ip = String(v || '').trim();
    if (net.isIPv4(ip) && !out.includes(ip)) out.push(ip);
  };
  add(configured);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item && item.family === 'IPv4' && !item.internal) add(item.address);
    }
  }
  add('127.0.0.1');
  return out;
}

// 14.13 · 자체 TURN 살아있기 확인(로컬 TCP, 30초 캐시).
//   .env 에 turns:…:5349 이 남아 있는데 coturn 이 TLS(인증서 유실·갱신 실패 등)를
//   안 켜고 있으면, 브라우저는 반드시 실패하는 후보를 계속 시도한다. 그러면
//   ICE candidate error 로 "TURN 서버에 닿지 못했어요" 오해가 뜨고, 되는
//   turn:3478 과 섞여 통화 자체가 굳어 보였다(실제 보고).
//   coturn 은 TCP 도 같은 포트로 함께 여는 것이 기본이라, 로컬 NIC 기준
//   TCP 연결 실패 = 그 포트를 아무도 안 듣고 있다는 뜻이다. (공인 IP hairpin
//   은 OCI 에서 막히는 일이 흔하니 사설 NIC/localhost 로만 확인한다.)
const turnAliveCache = { at: 0, ok: new Map() };
async function localTurnAlive(urlText) {
  const u = String(urlText || '').trim();
  if (!u || !/^turns?:/i.test(u)) return true;
  const now = Date.now();
  if (now - turnAliveCache.at > 30000) { turnAliveCache.ok.clear(); turnAliveCache.at = now; }
  if (turnAliveCache.ok.has(u)) return turnAliveCache.ok.get(u);
  const { port } = turnHostPort(u);
  const addrs = localTurnAddresses(process.env.SDY_TURN_PRIVATE_IP);
  const checks = await Promise.all(addrs.map((a) => tcpCheck(a, port, 700)));
  const alive = checks.some((c) => c && c.ok);
  turnAliveCache.ok.set(u, alive);
  console.log(`[chat] 자체 TURN ${u} → ${alive ? '정상' : '응답 없음, 이번엔 광고에서 제외'}`);
  return alive;
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
  // 큐가 가득 찬 스트림은 '느려서 버려졌다'는 뜻이다. 이 상태에서 shift 하며
  // offer/ICE 를 밀어내면 통화가 영원히 '연결 중'에 멈춘다 — 스트림을 죽이고
  // pending 큐(재연결 시 재전송)로 넘어가게 한다.
  if (!client || client.closed) return;
  if (client.queue.length >= 128) {
    client.closed = true;
    try { client.raw.destroy(); } catch { /* noop */ }
    return;
  }
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
        const onDrain = () => {
          client.waitingDrain = false;
          client.flushing = false;
          flushSse(client);
        };
        client.raw.once('drain', onDrain);
        // drain 이 영영 안 오면(죽은 소켓) 스트림을 버린다 — 15초 keep-alive
        // 까지 기다리면 그 사이 offer/ICE 가 이 쓰레기 스트림에 쌓여 유실된다.
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
    const externalTlsTurn = (process.env.SDY_TURN_TLS_URL || '').trim();
    const localTurn = (process.env.SDY_LOCAL_TURN_URL || '').trim();
    const localTlsTurn = (process.env.SDY_LOCAL_TURN_TLS_URL || '').trim();
    const secret = (process.env.SDY_TURN_SECRET || '').trim();
    const uid = String((req.query && req.query.uid) || 'guest')
      .replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 40) || 'guest';
    let turnReady = false;

    // TURN 호스트 결정: SDY_TURN_HOST(명시) → 접속 도메인(Host 헤더) → 공인 IP.
    // HTTPS 도메인으로 접속 중이라면 IP 대신 도메인을 쓰는 게 좋다 — 통신사가
    // IP:3478 을 막는 정책이 있어도 DNS 이름은 뚫리는 경우가 많고, turns:(5349)
    // TLS 인증서 SNI 도 도메인으로만 맞기 때문이다.
    const explicitTurnHost = (process.env.SDY_TURN_HOST || '').trim()
      .split(':')[0].toLowerCase();
    const headerHost = String((req.headers && req.headers.host) || '')
      .split(':')[0].trim().toLowerCase();
    const turnHost = explicitTurnHost
      || (/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(headerHost)
          && headerHost.includes('.')
          && !/^\d+(\.\d+){3}$/.test(headerHost) ? headerHost : '')
      || (process.env.SDY_TURN_PUBLIC_IP || '').trim();
    // apply.sh 가 만든 자체 TURN(turn/turns:공인IP:포트)만 도메인으로 바꾼다.
    // 외부 TURN(SDY_TURN_URL)은 사용자가 준 주소를 그대로 쓴다.
    const rewriteLocalHost = (txt) => {
      const u = String(txt || '').trim();
      if (!u || !turnHost) return u;
      const m = u.match(/^(turns?:)([^:]+)([:].*)?$/i);
      if (!m) return u;
      const hostNow = m[2];
      const hostIsIp = /^\d+(\.\d+){3}$/.test(hostNow);
      const pub = (process.env.SDY_TURN_PUBLIC_IP || '').trim();
      if (explicitTurnHost || hostIsIp || (pub && hostNow === pub)) {
        return `${m[1]}${turnHost}${m[3] || ''}`;
      }
      return u;
    };

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
    // 평문(turn:)과 TLS(turns:)는 각각 별도 iceServer 로 내려 준다.
    addTurn(externalTurn, true);
    addTurn(externalTlsTurn, true);
    // apply.sh 가 만든 Oracle TURN. SDY_LOCAL_TURN_URL 이 비어있지 않으면
    // 외부와 같은 호스트라도 항상 push 한다 — 사용자가 명시적으로 두 라인을
    // 켠 의도(고정 인증 + HMAC 임시 인증)를 그대로 전달하는 게 안전하다.
    // 브라우저는 같은 호스트 + 다른 credential 을 별도 iceServer 로 받아도
    // 한쪽이 실패하면 다른쪽으로 candidate 를 다시 만든다.
    // 14.13 · 단, 살아 있는 것만 내려준다 — 죽은 turns:5349 이 섞여 나가면
    //   브라우저가 그 후보에서 반드시 실패해 'TURN 불통' 오해가 떴다.
    const droppedTurn = [];
    if (localTurn) {
      if (await localTurnAlive(localTurn)) addTurn(rewriteLocalHost(localTurn), false);
      else droppedTurn.push(localTurn);
    }
    if (localTlsTurn) {
      if (await localTurnAlive(localTlsTurn)) addTurn(rewriteLocalHost(localTlsTurn), false);
      else droppedTurn.push(localTlsTurn);
    }
    reply.header('Cache-Control', 'no-store');
    return reply.send({ ok: true, turn: turnReady, host: turnHost || null,
                        droppedTurn, ice: { iceServers } });
  });

  // ── 통화(TURN) 진단 — curl http://127.0.0.1:5000/api/chat/diag ──
  // 포트를 다 열었는데도 서로 다른 망 통화가 안 될 때, 서버 안에서 coturn 이
  // 살아 있는지 / 외부 경로(공인IP)가 닿는지를 한 번에 보여 준다.
  app.get('/api/chat/diag', async (req, reply) => {
    const env = process.env;
    const localTurn = (env.SDY_LOCAL_TURN_URL || '').trim();
    const externalTurn = (env.SDY_TURN_URL || '').trim();
    const localTlsTurn = (env.SDY_LOCAL_TURN_TLS_URL || '').trim();
    const externalTlsTurn = (env.SDY_TURN_TLS_URL || '').trim();
    const secret = (env.SDY_TURN_SECRET || '').trim();
    const publicIp = (env.SDY_TURN_PUBLIC_IP || '').trim();
    const configuredLocalIp = (env.SDY_TURN_PRIVATE_IP || '').trim();
    const localAddresses = localTurnAddresses(configuredLocalIp);
    const targets = [];
    const seen = new Set();
    for (const t of [localTurn, externalTurn, localTlsTurn, externalTlsTurn]) {
      const u = String(t || '').trim();
      if (!u || seen.has(u)) continue;
      seen.add(u);
      targets.push(u);
    }
    const out = {
      ok: false,
      ts: new Date().toISOString(),
      note: 'local=서버의 실제 NIC/localhost(서버 안) · public=공인IP(외부 경로, hairpin 이면 서버 안에서는 실패로 보일 수 있음) · tls=5349/tcp(turns:) 는 TCP 개방 여부만 확인',
      env: {
        SDY_LOCAL_TURN_URL: localTurn || null,
        SDY_TURN_URL: externalTurn || null,
        SDY_LOCAL_TURN_TLS_URL: localTlsTurn || null,
        SDY_TURN_TLS_URL: externalTlsTurn || null,
        SDY_TURN_PUBLIC_IP: publicIp || null,
        SDY_TURN_PRIVATE_IP: configuredLocalIp || null,
        hasSecret: !!secret,
      },
      checks: {},
    };
    // HMAC 임시 인증이 가능하면 브라우저와 동일한 TURN Allocate 를 실제로 시도한다.
    const expiry = Math.floor(nowSec()) + 3600;
    const uname = `${expiry}:diag-${crypto.randomBytes(4).toString('hex')}`;
    const password = secret ? crypto.createHmac('sha1', secret).update(uname).digest('base64') : '';
    for (const u of targets) {
      const isTls = /^turns:/i.test(u);
      const { host, port } = turnHostPort(u);
      const key = u;
      const rec = { host, port, tls: !!isTls };
      // 서버 자신 → coturn 프로세스가 실제로 3478(또는 5349 TLS)에 떠 있는지
      // 확인한다. listening-ip가 사설 NIC로 고정된 Oracle 구성에서는
      // 127.0.0.1 검사가 실패하는 것이 정상이므로 모든 로컬 IPv4를 동시에
      // 검사해 응답 주소를 고른다. turns: 는 TLS/TCP 이므로 TCP 개방만 본다.
      const localProbe = await Promise.all(localAddresses.map(async (address) => {
        if (isTls) {
          const tcpTls = await tcpCheck(address, port, 4000);
          return { address, tcp: tcpTls, udp: { ok: false, err: 'tls' } };
        }
        const [tcp, udp] = await Promise.all([
          tcpCheck(address, port, 4000), stunPing(address, port, 4000),
        ]);
        return { address, tcp, udp };
      }));
      const tcpHit = localProbe.find((x) => x.tcp.ok);
      const udpHit = localProbe.find((x) => x.udp.ok);
      const localHit = localProbe.find((x) => x.tcp.ok && x.udp.ok) || udpHit || tcpHit;
      rec.localAddress = localHit ? localHit.address : localAddresses.join(',');
      rec.localTcp = tcpHit ? 'ok' : `fail(${localProbe.map((x) => `${x.address}:${x.tcp.err || 'fail'}`).join(', ')})`;
      rec.localUdp = udpHit ? 'ok' : `fail(${localProbe.map((x) => `${x.address}:${x.udp.err || 'fail'}`).join(', ')})`;
      // 공인 경로와 로컬 Allocate를 병렬 실행한다. 공인 IP hairpin이 timeout이어도
      // 배포 스크립트의 15초 진단 제한 안에 결과가 돌아오게 한다.
      const allocAddress = udpHit ? udpHit.address : (localHit ? localHit.address : localAddresses[0]);
      // turns:(TLS) 는 STUN Binding/Allocate(평문)와 다른 프로토콜이라
      // 여기서는 TCP 개방까지만 확인한다(브라우저 TLS 핸드셰이크는 별개).
      const localAllocP = (!isTls && secret)
        ? turnAllocate(allocAddress, port, uname, password, 8000)
        : Promise.resolve(null);
      let publicP = Promise.resolve(null);
      // 공인 IP → VCN 인그레스 규칙이 실제로 열려 있는지 (서버 밖에서만 확정 가능)
      if (publicIp && host !== '127.0.0.1' && host !== 'localhost') {
        publicP = isTls
          ? Promise.all([tcpCheck(host, port, 5000)])
          : Promise.all([
            tcpCheck(host, port, 5000),
            stunPing(host, port, 5000),
            secret ? turnAllocate(host, port, uname, password, 8000) : Promise.resolve(null),
          ]);
      }
      const [la, publicResult] = await Promise.all([localAllocP, publicP]);
      if (publicResult) {
        if (isTls) {
          const [pt] = publicResult;
          rec.publicTlsTcp = pt.ok ? 'ok' : `fail(${pt.err})`;
        } else {
          const [pt, pu, pa] = publicResult;
          rec.publicTcp = pt.ok ? 'ok' : `fail(${pt.err})`;
          rec.publicUdp = pu.ok ? 'ok' : `fail(${pu.err})`;
          rec.publicAlloc = secret
            ? (pa.ok ? `ok(${pa.err})` : `fail(${pa.err})`)
            : 'skip(secret 없음)';
        }
      }
      if (isTls) {
        rec.localAlloc = 'skip(tls)';
      } else {
        rec.localAlloc = secret
          ? (la.ok ? `ok(${la.err})` : `fail(${la.err})`)
          : 'skip(secret 없음)';
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

    // close/error 어느 쪽으로 끊겨도 스트림 집합에서 바로 제거한다. 제거가
    // 늦으면 offer/ICE 가 죽은 소켓에 쓰여 '재연결 시 재전송'을 못 타고 유실된다.
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
