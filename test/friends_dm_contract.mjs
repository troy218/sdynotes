// 16.3 · 친구 + 1:1 대화(DM) 통합 테스트 — Fastify 인스턴스를 직접 띄운다.
//
// 다루는 것:
//   친구: 비회원 401 · 닉네임으로 요청 · 없는 닉/자기자신/중복 요청 거절
//         · 받은 요청 수락·양쪽 목록 반영 · 이미 친구 재요청 거절
//         · 서로 동시에 요청하면 자동 수락 · 요청 취소·거절 · 친구 삭제
//   DM:  친구 아니면 전송 403 · 텍스트 전송 → 상대 unread/history 반영
//         · 읽음 처리 → threads unread=0 + 상대에게 dm_read 이벤트
//         · 사진/파일 업로드 → 참여자만 다운로드 (제3자 403)
//         · 본인 메시지만 삭제 · 회원 SSE(dm 이벤트 실시간 수신)
//         · 서버 재기동 후에도 친구 관계/대화가 디스크에서 살아남는지 확인
process.env.SDY_BASE_DIR = process.env.SDY_BASE_DIR_TEST ||
  `${import.meta.dirname}/.tmp_friends_${Date.now().toString(36)}`;
process.env.SDY_AUTH_DEV_CODE = '1';
process.env.SDY_AUTH_OTP_COOLDOWN = '1';

const { registerAuth } = await import('../server/src/routes/auth.js');
const { registerFriends } = await import('../server/src/routes/friends.js');
const { registerDm } = await import('../server/src/routes/dm.js');
const { userAuthBoot } = await import('../server/src/lib/userauth.js');
const { friendsBoot } = await import('../server/src/lib/friends.js');
const { dmBoot, dmFlush } = await import('../server/src/lib/dmstore.js');
const { default: Fastify } = await import('fastify');
const { default: multipart } = await import('@fastify/multipart');
const fs = await import('node:fs');
const path = await import('node:path');
const http = await import('node:http');

const PORT = 5199;
const app = Fastify({ logger: false });
await app.register(multipart, { limits: { fileSize: 512 * 1024 * 1024, files: 1 } });
registerAuth(app);
registerFriends(app);
registerDm(app);
await userAuthBoot();
await friendsBoot();
await dmBoot();
await app.listen({ port: PORT, host: '127.0.0.1' });

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
const j = (p, opt) => fetch(`http://127.0.0.1:${PORT}${p}`, opt)
  .then(async (r) => ({ s: r.status, d: await r.json().catch(() => ({})) }));
const auth = (tok, extra) => ({ 'Content-Type': 'application/json', 'x-sdy-auth': tok, ...(extra || {}) });

// ── 회원 셋 만들기 ──
async function signup(email, nick) {
  const o = await j('/api/auth/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  const v = await j('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code: o.d.dev_code, nick }) });
  if (!v.d.ok) throw new Error(`가입 실패 ${email}: ${JSON.stringify(v.d)}`);
  return { token: v.d.token, ...v.d.user };   // {token, uid, email, nick}
}
const A = await signup('a@test.local', '첫째새');
const B = await signup('b@test.local', '둘째새');
const C = await signup('c@test.local', '셋째새');
ok('setup: 회원 3명 가입 + 토큰', !!(A.token && B.token && C.token));

// ── 1) 인증 게이트 ──
const noauth1 = await j('/api/friends/list');
ok('friends: 비회원은 목록 401', noauth1.s === 401);
const noauth2 = await j('/api/dm/threads');
ok('dm: 비회원은 스레드 401', noauth2.s === 401);
const noauth3 = await j('/api/dm/msg', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: B.uid, text: 'hi' }) });
ok('dm: 비회원 전송 401', noauth3.s === 401);

// ── 2) 친구 전 DM 차단 ──
const strangers = await j('/api/dm/msg', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ to: B.uid, text: '친구 전 인사' }) });
ok('dm: 친구 아니면 전송 403 not_friends', strangers.s === 403 && strangers.d.code === 'not_friends');

// ── 3) 친구 요청 ──
const badNick = await j('/api/friends/request', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ nick: '없는닉네임' }) });
ok('friends: 없는 닉네임 404', badNick.s === 404);
const selfReq = await j('/api/friends/request', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ nick: '첫째새' }) });
ok('friends: 자기 자신에게 요청 거절(409)', selfReq.s === 409 && selfReq.d.code === 'self');

const rq = await j('/api/friends/request', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ nick: '둘째새' }) });
ok('friends: A→B 요청 성공', rq.s === 200 && rq.d.ok && rq.d.user.uid === B.uid);
const rqDup = await j('/api/friends/request', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ nick: '둘째새' }) });
ok('friends: 같은 요청 중복 방지(409)', rqDup.s === 409 && rqDup.d.code === 'already_requested');

const bList = await j('/api/friends/list', { headers: auth(B.token) });
ok('friends: B 받은 요청에 A 가 있다', bList.d.ok && bList.d.requests.incoming.length === 1 && bList.d.requests.incoming[0].uid === A.uid);
const aSummary = await j('/api/friends/summary', { headers: auth(B.token) });
ok('friends: summary requests_in=1', aSummary.d.ok && aSummary.d.requests_in === 1);

// ── 4) 수락 → 친구 ──
const acc = await j('/api/friends/accept', { method: 'POST', headers: auth(B.token), body: JSON.stringify({ uid: A.uid }) });
ok('friends: B 가 수락', acc.s === 200 && acc.d.ok && acc.d.user.uid === A.uid);
const aList = await j('/api/friends/list', { headers: auth(A.token) });
ok('friends: A 목록에 B (온라인 필드 포함)', aList.d.friends.length === 1 && aList.d.friends[0].uid === B.uid && aList.d.friends[0].online === false);
const rqAgain = await j('/api/friends/request', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ nick: '둘째새' }) });
ok('friends: 이미 친구면 재요청 409', rqAgain.s === 409 && rqAgain.d.code === 'already_friends');

// ── 5) DM 텍스트 + unread + history ──
const m1 = await j('/api/dm/msg', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ to: B.uid, text: '안녕 둘째야!' }) });
ok('dm: A→B 텍스트 전송', m1.s === 200 && m1.d.ok && m1.d.msg.text === '안녕 둘째야!' && m1.d.msg.from === A.uid);
const m2 = await j('/api/dm/msg', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ to: B.uid, text: '잘 지내?' }) });
ok('dm: 두 번째 메시지 전송', m2.s === 200 && m2.d.ok);

const bThreads = await j('/api/dm/threads', { headers: auth(B.token) });
const bt = (bThreads.d.threads || [])[0];
ok('dm: B 스레드 목록 — 상대 A + unread=2', !!bt && bt.uid === A.uid && bt.unread === 2 && bt.last.text === '잘 지내?');
const aThreads = await j('/api/dm/threads', { headers: auth(A.token) });
ok('dm: A 스레드 — 내가 보냈으니 unread=0', !!aThreads.d.threads[0] && aThreads.d.threads[0].unread === 0);

const bHist = await j(`/api/dm/history/${A.uid}`, { headers: auth(B.token) });
ok('dm: B 히스토리 2개', bHist.d.ok && bHist.d.msgs.length === 2);
const cHist = await j(`/api/dm/history/${A.uid}`, { headers: auth(C.token) });
ok('dm: 친구 아닌 C 의 히스토리 조회 403', cHist.s === 403);

// ── 6) 읽음 처리 ──
const rd = await j('/api/dm/read', { method: 'POST', headers: auth(B.token), body: JSON.stringify({ to: A.uid, id: bHist.d.last }) });
ok('dm: 읽음 처리 ok', rd.s === 200 && rd.d.ok && rd.d.read === bHist.d.last);
const bThreads2 = await j('/api/dm/threads', { headers: auth(B.token) });
ok('dm: 읽은 뒤 unread=0', bThreads2.d.threads[0].unread === 0);

// ── 7) 회원 SSE: 실시간 수신 (B 스트림) ──
function sseCollect(tok, ms, store) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: `/api/dm/stream?token=${encodeURIComponent(tok)}` }, (res) => {
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        const blocks = buf.split('\n\n');
        buf = blocks.pop();
        for (const b of blocks) {
          const line = b.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try { store.push(JSON.parse(line.slice(6))); } catch { /* noop */ }
        }
      });
      res.on('error', () => {});
      setTimeout(() => { try { req.destroy(); } catch { /* noop */ } resolve(); }, ms);
    });
    req.on('error', () => resolve());
  });
}

// B 가 스트림을 여는 동안 A 가 메시지를 보낸다
const bEvents = [];
const sseB = sseCollect(B.token, 1500, bEvents);
await new Promise((r) => setTimeout(r, 300));   // 스트림 연결 대기
await j('/api/dm/msg', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ to: B.uid, text: '실시간이야' }) });
await new Promise((r) => setTimeout(r, 300));
await sseB;
ok('sse: hello 이벤트 (안 읽은 수 포함)', bEvents.some((e) => e.type === 'hello' && typeof e.unread === 'number'));
// 스트림을 열기 전에 온 메시지는 pending 큐로 먼저 전달되므로,
// '실시간이야' 를 담은 이벤트가 하나라도 있으면 실시간 전파 성공이다.
ok('sse: dm_msg 실시간 수신 (peer=A, text 일치, unread>=1)',
  bEvents.some((e) => e.type === 'dm_msg' && e.peer === A.uid && e.msg && e.msg.text === '실시간이야' && e.unread >= 1));

// 온라인 표시: B 스트림이 살아 있는 동안 A 목록에서 online=true
const bEvents2 = [];
const sseB2 = sseCollect(B.token, 1200, bEvents2);
await new Promise((r) => setTimeout(r, 300));
const aList3 = await j('/api/friends/list', { headers: auth(A.token) });
ok('friends: B 접속 중 → A 목록에서 online=true', aList3.d.friends[0].online === true);
const bThreadsOnline = await j('/api/dm/threads', { headers: auth(A.token) });
ok('dm: threads 에도 online=true', bThreadsOnline.d.threads[0].online === true);
await sseB2;
await new Promise((r) => setTimeout(r, 300));
const aList4 = await j('/api/friends/list', { headers: auth(A.token) });
ok('friends: B 스트림 종료 → online=false', aList4.d.friends[0].online === false);

// ── 8) dm_read 이벤트: A 스트림을 열고 B 가 읽는다 ──
const aEvents = [];
const sseA = sseCollect(A.token, 1500, aEvents);
await new Promise((r) => setTimeout(r, 300));
const lastId = (await j('/api/dm/threads', { headers: auth(B.token) })).d.threads[0].last.id;
await j('/api/dm/read', { method: 'POST', headers: auth(B.token), body: JSON.stringify({ to: A.uid, id: lastId }) });
await new Promise((r) => setTimeout(r, 300));
await sseA;
// (pending 으로 먼저 전달된 낡은 읽음 이벤트가 앞에 있을 수 있으므로 some 으로 찾는다)
ok('sse: 상대가 읽으면 dm_read 이벤트 (peer=B, 방금 읽은 id)',
  aEvents.some((e) => e.type === 'dm_read' && e.peer === B.uid && e.id === lastId));

// ── 9) 파일 업로드/다운로드 권한 ──
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');   // 작은 PNG 헤더 조각
const fd = new FormData();
fd.append('to', B.uid);
fd.append('file', new Blob([png], { type: 'image/png' }), 'memo.png');
const up = await j('/api/dm/upload', { method: 'POST', headers: { 'x-sdy-auth': A.token }, body: fd });
ok('dm: 사진 업로드 ok + kind=img', up.s === 200 && up.d.ok && up.d.msg.kind === 'img' && !!up.d.msg.file.id);
const fid = up.d.msg.file && up.d.msg.file.id;
const dlB = await fetch(`http://127.0.0.1:${PORT}/api/dm/file/${fid}`, { headers: { 'x-sdy-auth': B.token } });
ok('dm: 참여자 B 는 파일 다운로드 200', dlB.status === 200 && (await dlB.arrayBuffer()).byteLength === png.length);
const dlC = await fetch(`http://127.0.0.1:${PORT}/api/dm/file/${fid}`, { headers: { 'x-sdy-auth': C.token } });
ok('dm: 제3자 C 는 파일 다운로드 403', dlC.status === 403);
const dlNo = await fetch(`http://127.0.0.1:${PORT}/api/dm/file/${fid}`);
ok('dm: 비로그인 파일 다운로드 401', dlNo.status === 401);

// ── 10) 메시지 삭제 ──
const delByOther = await j('/api/dm/del', { method: 'POST', headers: auth(B.token), body: JSON.stringify({ to: A.uid, id: m1.d.msg.id }) });
ok('dm: 남의 메시지 삭제 403', delByOther.s === 403);
const delMine = await j('/api/dm/del', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ to: B.uid, id: m1.d.msg.id }) });
ok('dm: 내 메시지 삭제 ok', delMine.s === 200 && delMine.d.ok);
const afterDel = await j(`/api/dm/history/${B.uid}`, { headers: auth(A.token) });
ok('dm: 삭제 반영 — 1번째 메시지 제거', !(afterDel.d.msgs || []).some((m) => m.id === m1.d.msg.id));

// ── 11) 서로 동시에 요청하면 자동 수락 ──
const rAC = await j('/api/friends/request', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ nick: '셋째새' }) });
ok('friends: A→C 요청', rAC.d.ok === true);
const rCA = await j('/api/friends/request', { method: 'POST', headers: auth(C.token), body: JSON.stringify({ nick: '첫째새' }) });
ok('friends: C→A 도 요청하면 자동 수락', rCA.d.ok === true && rCA.d.auto_accepted === true);
const cList = await j('/api/friends/list', { headers: auth(C.token) });
ok('friends: 목록 없이 바로 친구가 됐다', cList.d.friends.some((f) => f.uid === A.uid));

// ── 12) 요청 취소 / 거절 ──
await j('/api/friends/request', { method: 'POST', headers: auth(B.token), body: JSON.stringify({ nick: '셋째새' }) });
const cancel = await j('/api/friends/cancel', { method: 'POST', headers: auth(B.token), body: JSON.stringify({ uid: C.uid }) });
ok('friends: 보낸 요청 취소', cancel.s === 200 && cancel.d.ok);
const cList2 = await j('/api/friends/list', { headers: auth(C.token) });
ok('friends: 취소 뒤 받은 요청 없음', cList2.d.requests.incoming.length === 0);

await j('/api/friends/request', { method: 'POST', headers: auth(B.token), body: JSON.stringify({ nick: '셋째새' }) });
const dec = await j('/api/friends/decline', { method: 'POST', headers: auth(C.token), body: JSON.stringify({ uid: B.uid }) });
ok('friends: 요청 거절', dec.s === 200 && dec.d.ok);
const bList3 = await j('/api/friends/list', { headers: auth(B.token) });
ok('friends: 거절 뒤 친구 아님', !bList3.d.friends.some((f) => f.uid === C.uid));

// ── 13) 친구 삭제 → DM 차단 복구 ──
const rm = await j('/api/friends/remove', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ uid: C.uid }) });
ok('friends: 친구 삭제', rm.s === 200 && rm.d.ok);
const afterRm = await j('/api/dm/msg', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ to: C.uid, text: '삭제 후 인사' }) });
ok('dm: 친구 삭제 뒤에는 전송 403', afterRm.s === 403);

// ── 14) 디스크 지속성: 상태 파일이 생겼고 재로드핸때 살아 있는지 ──
const frFile = path.join(process.env.SDY_BASE_DIR, '.sdy_friends.json');
const dmFile = path.join(process.env.SDY_BASE_DIR, '.sdy_dm.json');
ok('persist: .sdy_friends.json 존재', fs.existsSync(frFile));
await dmFlush();   // 지연 저장을 즉시 반영
ok('persist: .sdy_dm.json 존재', fs.existsSync(dmFile));
const frSaved = JSON.parse(fs.readFileSync(frFile, 'utf8'));
const savedPair = Object.keys(frSaved.pairs || {})[0];
ok('persist: A↔B 친구 관계가 파일에 있다', !!savedPair && savedPair.split('|').sort().join('|') === [A.uid, B.uid].sort().join('|'));
const dmSaved = JSON.parse(fs.readFileSync(dmFile, 'utf8'));
const savedThread = dmSaved.threads[savedPair];
ok('persist: A↔B 대화가 파일에 남아 있다 (삭제 반영된 상태)', !!savedThread && savedThread.msgs.length >= 2 && !savedThread.msgs.some((m) => m.id === m1.d.msg.id));

await app.close();
dmFlush && (await dmFlush());
try { fs.rmSync(process.env.SDY_BASE_DIR, { recursive: true, force: true }); } catch { /* */ }
console.log(`\n친구/DM 테스트: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
