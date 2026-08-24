// 16.3 · 친구 (회원끼리) — 닉네임으로 요청 → 수락하면 친구가 된다.
//
// 상태 파일: .sdy_friends.json
//   pairs    { "uidA|uidB" (정렬된 키): { since } }
//   requests { "fromUid>toUid":        { from, to, ts } }
//
// 친구 관계는 서버 디스크에 남기고(재시작해도 유지), 요청은 REQ_TTL(기본 7일)
// 지나면 자동으로 만료된다. 관계가 바뀔 때마다 notifier(라우트 계층이 등록 —
// 보통 dm.js 의 회원 SSE)에 알려 실시간으로 화면을 갱신하게 한다.
import { FILES } from './paths.js';
import { readJson, writeJsonAtomic, withLock } from './store.js';
import { userByUid, userByNick, sanitizeNick } from './userauth.js';

const REQ_TTL = Math.max(60, parseInt(process.env.SDY_FRIEND_REQ_TTL || String(7 * 24 * 3600), 10) || 7 * 24 * 3600);

let st = null;                // {pairs, requests}
let notifier = null;          // (uid, evt) => {} — 나에게 영향 있는 회원별 알림

const nowSec = () => Date.now() / 1000;
export const pairKey = (a, b) => [String(a), String(b)].sort().join('|');
const reqKey = (from, to) => `${from}>${to}`;

export function setFriendNotifier(fn) { notifier = typeof fn === 'function' ? fn : null; }
function tell(uid, evt) {
  try { if (notifier) notifier(uid, evt); } catch { /* noop */ }
}

async function load() {
  if (st) return st;
  const d = (await readJson(FILES.friends, {})) || {};
  st = {
    pairs: d.pairs && typeof d.pairs === 'object' ? d.pairs : {},
    requests: d.requests && typeof d.requests === 'object' ? d.requests : {},
  };
  gcRequests();
  return st;
}
function save() {
  return writeJsonAtomic(FILES.friends, st).catch((e) => console.error(`[friends] 저장 실패: ${e?.message || e}`));
}
export async function friendsBoot() { await load(); }

// 만료된 요청 걸러 내기
function gcRequests() {
  const now = nowSec();
  let dirty = false;
  for (const [k, r] of Object.entries(st.requests)) {
    if (!r || typeof r.ts !== 'number' || now - r.ts > REQ_TTL) { delete st.requests[k]; dirty = true; }
  }
  if (dirty) save();
}

export async function areFriends(a, b) {
  await load();
  return !!st.pairs[pairKey(a, b)];
}

async function publicOf(uid) {
  const u = await userByUid(uid);
  return u ? { uid: u.uid, nick: u.nick } : { uid, nick: '(탈퇴한 회원)' };
}

// ── 조회 ───────────────────────────────────────────────
// onlineOf: (uid) => bool — dm SSE 연결 여부를 라우트 계층에서 주입
export async function friendsList(uid, onlineOf) {
  await load();
  gcRequests();
  const out = [];
  for (const [key, p] of Object.entries(st.pairs)) {
    const [a, b] = key.split('|');
    if (a !== uid && b !== uid) continue;
    const other = a === uid ? b : a;
    const info = await publicOf(other);
    out.push({ uid: info.uid, nick: info.nick, since: p.since || 0, online: !!(onlineOf && onlineOf(other)) });
  }
  out.sort((x, y) => x.nick.localeCompare(y.nick, 'ko'));
  return out;
}

export async function requestsList(uid) {
  await load();
  gcRequests();
  const incoming = [];
  const outgoing = [];
  for (const r of Object.values(st.requests)) {
    if (!r) continue;
    if (r.to === uid) incoming.push(r);
    else if (r.from === uid) outgoing.push(r);
  }
  const mapIn = [];
  for (const r of incoming.sort((a, b) => b.ts - a.ts)) {
    const u = await publicOf(r.from);
    mapIn.push({ uid: u.uid, nick: u.nick, ts: r.ts });
  }
  const mapOut = [];
  for (const r of outgoing.sort((a, b) => b.ts - a.ts)) {
    const u = await publicOf(r.to);
    mapOut.push({ uid: u.uid, nick: u.nick, ts: r.ts });
  }
  return { incoming: mapIn, outgoing: mapOut };
}

// ── 요청 보내기 (닉네임으로) ────────────────────────────
// 상대가 이미 나에게 요청해 둔 상태면 서로 수락한 것으로 본다(자동 수락).
export function friendRequest(fromUid, nickRaw) {
  return withLock('friends', async () => {
    await load();
    gcRequests();
    const nick = sanitizeNick(nickRaw);
    if (!nick) return { ok: false, error: '닉네임을 입력해 주세요' };
    const mine = await userByUid(fromUid);
    if (!mine) return { ok: false, error: '회원 정보를 찾을 수 없어요' };
    // 닉네임으로 회원 찾기 (userauth 의 고정닉 규칙과 같은 비교)
    const target = await userByNick(nick);
    if (!target) return { ok: false, error: `닉네임 "${nick}" 회원을 찾을 수 없어요`, code: 'not_found' };
    if (target.uid === fromUid) return { ok: false, error: '나 자신에게는 보낼 수 없어요', code: 'self' };
    const pk = pairKey(fromUid, target.uid);
    if (st.pairs[pk]) return { ok: false, error: '이미 친구예요', code: 'already_friends', user: { uid: target.uid, nick: target.nick } };
    // 반대편 요청이 달려 있으면 즉시 친구 (서로 요청한 셈)
    const back = st.requests[reqKey(target.uid, fromUid)];
    if (back) {
      delete st.requests[reqKey(target.uid, fromUid)];
      st.pairs[pk] = { since: nowSec() };
      await save();
      const meInfo = { uid: mine.uid, nick: mine.nick };
      const youInfo = { uid: target.uid, nick: target.nick };
      tell(fromUid, { type: 'friend', action: 'accepted', user: youInfo });
      tell(target.uid, { type: 'friend', action: 'accepted', user: meInfo });
      return { ok: true, auto_accepted: true, user: youInfo };
    }
    if (st.requests[reqKey(fromUid, target.uid)]) {
      return { ok: false, error: '이미 친구 요청을 보냈어요 · 상대가 수락하면 친구가 돼요', code: 'already_requested', user: { uid: target.uid, nick: target.nick } };
    }
    st.requests[reqKey(fromUid, target.uid)] = { from: fromUid, to: target.uid, ts: nowSec() };
    await save();
    tell(target.uid, { type: 'friend', action: 'req_in', user: { uid: mine.uid, nick: mine.nick } });
    return { ok: true, user: { uid: target.uid, nick: target.nick } };
  });
}

// ── 받은 요청 처리 ─────────────────────────────────────
export function friendRespond(uid, fromUid, accept) {
  return withLock('friends', async () => {
    await load();
    const key = reqKey(fromUid, uid);
    const r = st.requests[key];
    if (!r) return { ok: false, error: '없는 요청이에요 (취소됐거나 만료됐어요)', code: 'not_found' };
    delete st.requests[key];
    let you = null;
    if (accept) {
      st.pairs[pairKey(uid, fromUid)] = { since: nowSec() };
      you = await publicOf(fromUid);
      const me = await publicOf(uid);
      tell(fromUid, { type: 'friend', action: 'accepted', user: me });
      tell(uid, { type: 'friend', action: 'accepted', user: you });
    } else {
      you = await publicOf(fromUid);
      const me = await publicOf(uid);
      tell(fromUid, { type: 'friend', action: 'declined', user: me });
      tell(uid, { type: 'friend', action: 'req_out_done', user: you });
    }
    await save();
    return { ok: true, user: you };
  });
}

// ── 보낸 요청 취소 ─────────────────────────────────────
export function friendCancel(uid, toUid) {
  return withLock('friends', async () => {
    await load();
    const key = reqKey(uid, toUid);
    if (!st.requests[key]) return { ok: false, error: '없는 요청이에요', code: 'not_found' };
    delete st.requests[key];
    await save();
    tell(toUid, { type: 'friend', action: 'req_cancel', user: { uid } });
    return { ok: true };
  });
}

// ── 친구 삭제 ──────────────────────────────────────────
export function friendRemove(uid, otherUid) {
  return withLock('friends', async () => {
    await load();
    const pk = pairKey(uid, otherUid);
    if (!st.pairs[pk]) return { ok: false, error: '친구가 아니에요', code: 'not_friends' };
    delete st.pairs[pk];
    await save();
    const me = await publicOf(uid);
    tell(otherUid, { type: 'friend', action: 'removed', user: me });
    return { ok: true };
  });
}

// 특정 회원의 친구 uid 목록 (presence 전파용)
export async function friendUids(uid) {
  await load();
  const out = [];
  for (const key of Object.keys(st.pairs)) {
    const [a, b] = key.split('|');
    if (a === uid) out.push(b);
    else if (b === uid) out.push(a);
  }
  return out;
}
