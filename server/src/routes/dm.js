// 16.3 · 1:1 대화(DM) 라우트 — 회원 전용, 친구끼리만.
//
//   GET  /api/dm/stream?token=   회원 SSE — 새 메시지·읽음·친구변화·접속상태 실시간
//   GET  /api/dm/threads         내 대화 목록 (상대·마지막 메시지·안 읽은 수·온라인)
//   GET  /api/dm/history/:peer   스레드 히스토리 (?before=<id>&limit=)
//   POST /api/dm/msg             {to,text}
//   POST /api/dm/upload          사진/파일 (multipart, 필드 to)
//   GET  /api/dm/file/:id        첨부 내려 받기 (참여자만)
//   POST /api/dm/read            {to,id}  읽음 처리
//   POST /api/dm/del             {to,id}  내 메시지 삭제
//
// 실시간은 회원 SSE 하나로 끝낸다: 엽스코드를 열지 않아도 로그인만 돼 있으면
// 스트림이 열리고, 스트림이 열린 회원은 '온라인'으로 표시된다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { requireUser, extractUserToken, userByTokenSync, userByUid } from '../lib/userauth.js';
import { areFriends, pairKey, setFriendNotifier, friendUids } from '../lib/friends.js';
import {
  dmPush, dmHistory, dmLast, dmUnread, dmMarkRead, dmDelete,
  dmFileAdd, dmFileGet, dmUnreadTotal, setDmNotifier, participants,
  dmLastRead, DM_IMG_MAX, DM_FILE_MAX,
} from '../lib/dmstore.js';
import { setFriendsOnline } from './friends.js';

const nowSec = () => Date.now() / 1000;

// ── 회원 SSE 스트림 (엽스코드 채팅과 같은 즉시-push 구조) ──
const streams = new Map();   // uid -> Set<client>
const pending = new Map();   // uid -> event[] (재연결 중 보관)

export const dmOnline = (uid) => {
  const set = streams.get(uid);
  return !!(set && set.size);
};

function remember(uid, evt) {
  let q = pending.get(uid);
  if (!q) { q = []; pending.set(uid, q); }
  if (evt.type === 'presence') {
    const i = q.findIndex((x) => x.type === 'presence' && x.uid === evt.uid);
    if (i >= 0) q.splice(i, 1);
  }
  if (q.length >= 128) q.shift();
  q.push(evt);
}

function writeSse(client, evt) {
  if (!client || client.closed) return;
  // 큐가 가득 찬 스트림은 죽이고 pending 큐로 넘긴다 (재연결 시 재전송)
  if (client.queue.length >= 128) {
    client.closed = true;
    try { client.raw.destroy(); } catch { /* noop */ }
    return;
  }
  client.queue.push(evt);
  flushSse(client);
}
// (엽스코드 채팅(chat.js)과 같은 역압력 처리 — 죽은 소켓이 수신자를 막지 못하게)
function flushSse(client) {
  if (!client || client.closed || client.flushing || client.waitingDrain) return;
  client.flushing = true;
  try {
    while (client.queue.length) {
      const evt = client.queue.shift();
      const ok = client.raw.write(`event: dm\ndata: ${JSON.stringify(evt)}\n\n`);
      if (!ok) {
        client.queue.unshift(evt);
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
        client.flushing = false;
        return;
      }
    }
  } catch {
    client.closed = true;
  }
  client.flushing = false;
}

function dmSend(uid, evt) {
  const set = streams.get(uid);
  if (!set || !set.size) { remember(uid, evt); return; }
  for (const client of set) writeSse(client, evt);
}

// 보낸 메시지를 두 참여자에게 전파 (수신자에게는 안 읽은 수 포함)
async function fanoutMsg(pk, msg) {
  for (const uid of participants(pk)) {
    const peer = participants(pk).find((x) => x !== uid);
    const evt = { type: 'dm_msg', peer, msg };
    if (msg.from !== uid) evt.unread = dmUnread(pk, uid);
    dmSend(uid, evt);
  }
}

function wireNotifiers() {
  setDmNotifier((uids, evt) => {
    for (const uid of uids) {
      const peer = participants(evt.pk || '').find((x) => x !== uid);
      const { pk, ...rest } = evt;
      dmSend(uid, { ...rest, peer });
    }
  });
  setFriendNotifier((uid, evt) => dmSend(uid, evt));
}

// 내 친구들 중 온라인인 사람에게 내 접속 상태를 알린다
async function announcePresence(uid, online) {
  const friends = await friendUids(uid);
  for (const f of friends) {
    if (dmOnline(f)) dmSend(f, { type: 'presence', uid, online });
  }
}

function sanitizeText(s) {
  // eslint-disable-next-line no-control-regex
  return String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, 2000);
}

function me(req, reply) {
  const u = requireUser(req);
  if (!u) reply.code(401).send({ ok: false, error: '로그인이 필요해요 · 친구와의 1:1 대화는 회원 전용이에요' });
  return u;
}

async function peerInfo(uid) {
  const u = await userByUid(uid);
  return u ? { uid: u.uid, nick: u.nick } : null;
}

export function registerDm(app) {
  wireNotifiers();
  setFriendsOnline(dmOnline);

  // ── 대화 목록 ──
  app.get('/api/dm/threads', async (req, reply) => {
    const u = me(req, reply); if (!u) return;
    const friends = await friendUids(u.uid);
    const out = [];
    for (const f of friends) {
      const pk = pairKey(u.uid, f);
      const last = dmLast(pk);
      const info = await peerInfo(f);
      if (!info) continue;
      out.push({
        uid: f, nick: info.nick, online: dmOnline(f),
        last: last ? { id: last.id, kind: last.kind || 'txt', text: last.text || '', from: last.from, ts: last.ts, file: last.file ? { name: last.file.name, gone: !!last.file.gone } : null } : null,
        unread: dmUnread(pk, u.uid),
      });
    }
    out.sort((a, b) => ((b.last && b.last.ts) || 0) - ((a.last && a.last.ts) || 0));
    return reply.send({ ok: true, threads: out });
  });

  // ── 히스토리 ──
  app.get('/api/dm/history/:peer', async (req, reply) => {
    const u = me(req, reply); if (!u) return;
    const peer = String(req.params.peer || '');
    if (!(await areFriends(u.uid, peer))) {
      return reply.code(403).send({ ok: false, error: '친구끼리만 대화할 수 있어요', code: 'not_friends' });
    }
    const info = await peerInfo(peer);
    if (!info) return reply.code(404).send({ ok: false, error: '없는 회원이에요' });
    const pk = pairKey(u.uid, peer);
    const h = dmHistory(pk, { before: Math.max(0, parseInt(req.query.before, 10) || 0), limit: parseInt(req.query.limit, 10) || 60 });
    return reply.send({
      ok: true, msgs: h.msgs, more: h.more, last: h.last,
      peer: { ...info, online: dmOnline(peer) },
      peer_read: dmLastRead(pk, peer),   // 상대가 읽은 마지막 메시지 id ('1' 표시용)
    });
  });

  // ── 텍스트 보내기 ──
  app.post('/api/dm/msg', async (req, reply) => {
    const u = me(req, reply); if (!u) return;
    const d = req.body || {};
    const to = String(d.to || '').trim();
    if (!to || to === u.uid) return reply.code(400).send({ ok: false, error: '받는 사람이 올바르지 않아요' });
    if (!(await areFriends(u.uid, to))) {
      return reply.code(403).send({ ok: false, error: '친구끼리만 대화할 수 있어요 · 먼저 친구를 맺어 주세요', code: 'not_friends' });
    }
    const text = sanitizeText(d.text);
    if (!text) return reply.code(400).send({ ok: false, error: '내용이 없습니다' });
    const meInfo = await peerInfo(u.uid);
    const msg = dmPush(pairKey(u.uid, to), { from: u.uid, name: meInfo ? meInfo.nick : '', kind: 'txt', text });
    await fanoutMsg(pairKey(u.uid, to), msg);
    return reply.send({ ok: true, msg });
  });

  // ── 사진/파일 보내기 ──
  // (채팅 업로드와 같이 파일을 먼저 소비한 뒤 fields 를 읽는다 — 필드 순서 무관)
  app.post('/api/dm/upload', async (req, reply) => {
    const u = me(req, reply); if (!u) return;
    let data;
    try { data = await req.file(); } catch { data = null; }
    if (!data) return reply.code(400).send({ ok: false, error: '파일 없음' });
    let buf;
    try { buf = await data.toBuffer(); } catch { buf = null; }
    if (!buf || !buf.length) return reply.code(400).send({ ok: false, error: '빈 파일입니다' });
    let to = '';
    try { to = String((data.fields && data.fields.to && data.fields.to.value) || '').trim(); } catch { to = ''; }
    if (!to || to === u.uid) return reply.code(400).send({ ok: false, error: '받는 사람이 올바르지 않아요' });
    if (!(await areFriends(u.uid, to))) {
      return reply.code(403).send({ ok: false, error: '친구끼리만 대화할 수 있어요', code: 'not_friends' });
    }
    const mime = String(data.mimetype || 'application/octet-stream').toLowerCase();
    const kind = mime.startsWith('image/') ? 'img' : 'file';
    const cap = kind === 'img' ? DM_IMG_MAX : DM_FILE_MAX;
    if (buf.length > cap) {
      return reply.code(400).send({
        ok: false,
        error: `${kind === 'img' ? '사진은' : '파일은'} ${Math.round(cap / 1048576)}MB 이하만 가능해요`,
      });
    }
    const pk = pairKey(u.uid, to);
    const fileId = Date.now().toString(36) + crypto.randomBytes(6).toString('hex');
    const file = await dmFileAdd(pk, fileId, { name: data.filename || (kind === 'img' ? 'image.jpg' : 'file'), mime }, buf);
    const meInfo = await peerInfo(u.uid);
    const msg = dmPush(pk, { from: u.uid, name: meInfo ? meInfo.nick : '', kind, file });
    await fanoutMsg(pk, msg);
    return reply.send({ ok: true, msg });
  });

  // ── 첨부 내려 받기 (스레드 참여자만) ──
  app.get('/api/dm/file/:id', async (req, reply) => {
    const u = me(req, reply); if (!u) return;
    const rec = dmFileGet(req.params.id);
    if (!rec) return reply.code(404).send({ ok: false, error: '파일이 사라졌어요 (오래돼 지워졌거나 없는 파일)' });
    if (!participants(rec.pair).includes(u.uid)) {
      return reply.code(403).send({ ok: false, error: '이 대화의 참여자만 열 수 있어요' });
    }
    let buf;
    try { buf = fs.readFileSync(rec.path); } catch { buf = null; }
    if (!buf) return reply.code(404).send({ ok: false, error: '파일이 사라졌어요 (오래돼 지워졌어요)' });
    reply.header('Cache-Control', 'private, max-age=3600');
    reply.header('Content-Type', rec.mime);
    reply.header('Content-Length', buf.length);
    const inline = rec.mime.startsWith('image/');
    reply.header('Content-Disposition',
      inline ? 'inline' : `attachment; filename*=UTF-8''${encodeURIComponent(rec.name)}`);
    return reply.send(buf);
  });

  // ── 읽음 처리 ──
  app.post('/api/dm/read', async (req, reply) => {
    const u = me(req, reply); if (!u) return;
    const d = req.body || {};
    const to = String(d.to || '').trim();
    if (!to) return reply.code(400).send({ ok: false, error: '상대가 필요해요' });
    const upto = dmMarkRead(pairKey(u.uid, to), u.uid, d.id);
    return reply.send({ ok: true, read: upto });
  });

  // ── 메시지 삭제 (본인 것만) ──
  app.post('/api/dm/del', async (req, reply) => {
    const u = me(req, reply); if (!u) return;
    const d = req.body || {};
    const to = String(d.to || '').trim();
    const id = parseInt(d.id, 10);
    if (!to || !id) return reply.code(400).send({ ok: false, error: '잘못된 요청이에요' });
    const r = dmDelete(pairKey(u.uid, to), id, u.uid);
    if (!r.ok) {
      return reply.code(r.code === 'forbidden' ? 403 : 404).send({
        ok: false,
        error: r.code === 'forbidden' ? '내 메시지만 지울 수 있어요' : '메시지가 없습니다',
      });
    }
    return reply.send({ ok: true });
  });

  // ── 회원 SSE (실시간 수신) ──
  app.get('/api/dm/stream', async (req, reply) => {
    const u = userByTokenSync(extractUserToken(req));
    if (!u) return reply.code(401).send({ ok: false, error: '로그인이 필요해요' });
    const uid = u.uid;
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (typeof reply.raw.flushHeaders === 'function') reply.raw.flushHeaders();

    const first = !dmOnline(uid);
    const client = { raw: reply.raw, queue: [], closed: false, flushing: false };
    if (!streams.has(uid)) streams.set(uid, new Set());
    streams.get(uid).add(client);

    const unread = await dmUnreadTotal(uid).catch(() => 0);
    writeSse(client, { type: 'hello', ts: nowSec(), unread });

    // 재연결 동안 보관된 이벤트 전달
    const held = pending.get(uid) || [];
    pending.delete(uid);
    for (const evt of held) writeSse(client, evt);

    // 첫 스트림이면 친구들에게 '온라인' 통지
    if (first) announcePresence(uid, true);

    const keepAlive = setInterval(() => {
      if (client.closed) return;
      try { reply.raw.write(': keep-alive\n\n'); } catch { client.closed = true; }
    }, 15000);
    if (keepAlive.unref) keepAlive.unref();

    const cleanup = () => {
      clearInterval(keepAlive);
      client.closed = true;
      const set = streams.get(uid);
      if (set) {
        set.delete(client);
        if (!set.size) {
          streams.delete(uid);
          announcePresence(uid, false);   // 마지막 스트림이 끊기면 오프라인
        }
      }
    };
    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);
  });
}
