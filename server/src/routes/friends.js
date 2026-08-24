// 16.3 · 친구 라우트 — 회원 전용 (이메일 OTP 로그인, x-sdy-auth 토큰).
//
//   GET  /api/friends/list      내 친구 목록 + 받은/보낸 요청
//   GET  /api/friends/summary   뱃지용 경량 요약 {requests_in, unread_dm}
//   POST /api/friends/request   {nick}     닉네임으로 친구 요청
//   POST /api/friends/accept    {uid}      받은 요청 수락
//   POST /api/friends/decline   {uid}      받은 요청 거절
//   POST /api/friends/cancel    {uid}      내가 보낸 요청 취소
//   POST /api/friends/remove    {uid}      친구 삭제
//
// '온라인' 표시는 회원 SSE(/api/dm/stream) 연결 여부 — dm.js 가
// onlineOf 를 등록해 준다 (등록 전이면 전부 false 로 낼 뿐, 목록은 정상).
import {
  friendsList, requestsList, friendRequest, friendRespond,
  friendCancel, friendRemove,
} from '../lib/friends.js';
import { dmUnreadTotal } from '../lib/dmstore.js';
import { requireUser } from '../lib/userauth.js';

let onlineOf = null;   // (uid) => bool — dm.js 에서 주입
export function setFriendsOnline(fn) { onlineOf = typeof fn === 'function' ? fn : null; }
export const friendsOnline = (uid) => !!(onlineOf && onlineOf(uid));

function me(req, reply) {
  const u = requireUser(req);
  if (!u) reply.code(401).send({ ok: false, error: '로그인이 필요해요 · 회원끼리만 친구를 맺을 수 있어요' });
  return u;
}

export function registerFriends(app) {
  app.get('/api/friends/list', async (req, reply) => {
    const u = me(req, reply); if (!u) return;
    const [friends, requests] = await Promise.all([
      friendsList(u.uid, friendsOnline),
      requestsList(u.uid),
    ]);
    return reply.send({ ok: true, friends, requests });
  });

  app.get('/api/friends/summary', async (req, reply) => {
    const u = me(req, reply); if (!u) return;
    const requests = await requestsList(u.uid);
    const unread = await dmUnreadTotal(u.uid);
    return reply.send({ ok: true, requests_in: requests.incoming.length, unread_dm: unread });
  });

  app.post('/api/friends/request', async (req, reply) => {
    const u = me(req, reply); if (!u) return;
    const r = await friendRequest(u.uid, (req.body || {}).nick);
    if (!r.ok) return reply.code(r.code === 'not_found' ? 404 : 409).send(r);
    return reply.send(r);
  });

  app.post('/api/friends/accept', async (req, reply) => {
    const u = me(req, reply); if (!u) return;
    const r = await friendRespond(u.uid, String((req.body || {}).uid || ''), true);
    if (!r.ok) return reply.code(404).send(r);
    return reply.send(r);
  });

  app.post('/api/friends/decline', async (req, reply) => {
    const u = me(req, reply); if (!u) return;
    const r = await friendRespond(u.uid, String((req.body || {}).uid || ''), false);
    if (!r.ok) return reply.code(404).send(r);
    return reply.send(r);
  });

  app.post('/api/friends/cancel', async (req, reply) => {
    const u = me(req, reply); if (!u) return;
    const r = await friendCancel(u.uid, String((req.body || {}).uid || ''));
    if (!r.ok) return reply.code(404).send(r);
    return reply.send(r);
  });

  app.post('/api/friends/remove', async (req, reply) => {
    const u = me(req, reply); if (!u) return;
    const r = await friendRemove(u.uid, String((req.body || {}).uid || ''));
    if (!r.ok) return reply.code(404).send(r);
    return reply.send(r);
  });
}
