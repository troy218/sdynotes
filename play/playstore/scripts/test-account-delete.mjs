#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   계정 삭제가 실제로 지우는가 — 임시 폴더에서 그대로 돌려 본다

   왜 이 검사가 필요한가
     스토어 심사에서 "계정 삭제"가 요구되는 이유는, 남은 개인정보가 있으면
     안 되기 때문이다. 화면에 버튼이 있는지가 아니라 **서버 파일에서 정말
     사라졌는지**를 봐야 한다. 그래서 임시 SDY_BASE_DIR 를 만들어 회원·세션·
     친구·대화를 심어 두고 삭제를 돌린 뒤, 남은 것을 전부 확인한다.

   실행: node scripts/test-account-delete.mjs
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const REPO = path.resolve(PKG, '..', '..');

// 임시 저장소 — 운영 데이터는 절대 건드리지 않는다
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-del-test-'));
process.env.SDY_BASE_DIR = TMP;
process.env.SDY_ENV_FILE = path.join(TMP, '없는.env');
process.env.SDY_STORAGE = 'oracle';

const ME = { uid: 'u_me', email: 'me@example.com', nick: '나', pass: 'x', created_at: 1 };
const OTHER = { uid: 'u_other', email: 'other@example.com', nick: '친구', pass: 'x', created_at: 1 };

fs.writeFileSync(path.join(TMP, '.sdy_users.json'), JSON.stringify({ u_me: ME, u_other: OTHER }));
fs.writeFileSync(path.join(TMP, '.sdy_user_sessions.json'), JSON.stringify({
  tok_me1: { uid: 'u_me', exp: 4102444800 },   // 2100년 — 만료 전
  tok_me2: { uid: 'u_me', exp: 4102444800 },   // 다른 기기
  tok_other: { uid: 'u_other', exp: 4102444800 }
}));
fs.writeFileSync(path.join(TMP, '.sdy_friends.json'), JSON.stringify({
  pairs: { 'u_me|u_other': { since: 1 } },
  requests: { 'u_other|u_me': { from: 'u_other', to: 'u_me', ts: 1 } }
}));
// 실제 형식 그대로 — 메시지에 ts 가 없으면 dmBoot 의 gc 가 대화를 지워 버린다.
// (이걸 놓쳐서 처음엔 '무관한 대화까지 지워짐'처럼 보였다)
const TS = Math.floor(Date.now() / 1000);
fs.writeFileSync(path.join(TMP, '.sdy_dm.json'), JSON.stringify({
  seq: 3,
  threads: {
    // 파일은 '메시지가 참조할 때만' 살아 있다(gc 규칙) — 양쪽 다 살려 두고 시작한다
    'u_me|u_other': {
      msgs: [{ id: 1, ts: TS, from: 'u_me', text: '안녕', file: { id: 'f1', name: '내 사진' } }],
      reads: { u_me: 1 }
    },
    'u_other|u_x': {
      msgs: [{ id: 2, ts: TS, from: 'u_other', text: '남의 대화', file: { id: 'f2', name: '남의 사진' } }],
      reads: {}
    }
  },
  files: {
    f1: { id: 'f1', pair: 'u_me|u_other', size: 10 },
    f2: { id: 'f2', pair: 'u_other|u_x', size: 10 }
  }
}));

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ✅ ' + m); };
const bad = (m) => { fail++; console.log('  ❌ ' + m); };
const check = (c, g, b) => (c ? ok(g) : bad(b));
const read = (f) => JSON.parse(fs.readFileSync(path.join(TMP, f), 'utf8'));

console.log(`\n계정 삭제 검사 (임시 폴더: ${TMP})\n`);

const userauth = await import(path.join(REPO, 'server/src/lib/userauth.js'));
const friends = await import(path.join(REPO, 'server/src/lib/friends.js'));
const dm = await import(path.join(REPO, 'server/src/lib/dmstore.js'));

await userauth.userAuthBoot();
await friends.friendsBoot();
await dm.dmBoot();

// ── 삭제 전 상태 확인 ────────────────────────────────────────────────────
check(!!(await userauth.userByUid('u_me')), '삭제 전: 회원이 있음', '삭제 전인데 회원이 없음');
check(await friends.areFriends('u_me', 'u_other'), '삭제 전: 친구 관계가 있음', '친구 관계가 없음');

// ── 삭제 실행 (라우트가 하는 순서 그대로) ────────────────────────────────
const nFriends = await friends.friendsPurgeUser('u_me');
const nThreads = await dm.dmPurgeUser('u_me');
const res = await userauth.userDeleteAccount('u_me');

check(res.ok, '삭제 응답 ok', '삭제 실패: ' + (res.error || ''));

// ── 파일에 정말 남지 않았는가 ────────────────────────────────────────────
const users = read('.sdy_users.json');
check(!users.u_me, '회원 기록이 파일에서 사라짐', '회원 기록이 남아 있음');
check(!!users.u_other, '다른 회원은 그대로', '다른 회원까지 지워짐 — 큰 사고');

const sess = read('.sdy_user_sessions.json');
const mine = Object.entries(sess).filter(([, v]) => v && v.uid === 'u_me');
check(mine.length === 0, '내 세션이 전부 무효화됨(다른 기기 포함)', `내 세션 ${mine.length}개가 남아 있음`);
check(!!sess.tok_other, '다른 회원의 세션은 그대로', '다른 회원 세션까지 지워짐');

const fr = read('.sdy_friends.json');
check(nFriends >= 1, `친구 관계·요청 ${nFriends}건 정리`, '친구 데이터 정리가 안 됨');
check(!Object.keys(fr.pairs).some((k) => k.split('|').includes('u_me')),
  '친구 목록에서 사라짐', '친구 목록에 남아 있음');
check(!Object.keys(fr.requests).some((k) => k.split('|').includes('u_me')),
  '친구 요청에서도 사라짐', '친구 요청에 남아 있음');

const d = read('.sdy_dm.json');
check(nThreads >= 1, `대화방 ${nThreads}건 삭제`, '대화방 정리가 안 됨');
check(!d.threads['u_me|u_other'], '내 대화가 사라짐', '내 대화가 남아 있음');
check(!!d.threads['u_other|u_x'], '나와 무관한 대화는 그대로', '무관한 대화까지 지워짐');
check(!d.files.f1, '내 대화의 파일도 정리됨', '내 파일 기록이 남아 있음');
check(!!d.files.f2, '무관한 파일은 그대로', '무관한 파일까지 지워짐');

// ── 두 번 불러도 안전한가 (멱등성) ───────────────────────────────────────
const again = await userauth.userDeleteAccount('u_me');
check(again.ok === false, '이미 지운 계정을 또 지우면 실패로 응답(조용히 넘어가지 않음)',
  '없는 계정 삭제가 성공으로 응답됨');

// ── 기기 노트는 손대지 않는다는 약속 ─────────────────────────────────────
const touched = ['sync', 'db', 'imported', 'imported_docs', 'music', 'vault']
  .filter((d2) => fs.existsSync(path.join(TMP, d2)));
check(touched.length === 0, '기기·문서 저장 폴더는 건드리지 않음',
  '문서 폴더가 생기거나 지워짐: ' + touched.join(', '));

fs.rmSync(TMP, { recursive: true, force: true });

console.log('\n' + '─'.repeat(56));
console.log(fail === 0 ? `✅ 전부 통과 — ${pass}개` : `❌ ${fail}개 실패 · ${pass}개 통과`);
console.log('─'.repeat(56) + '\n');
process.exit(fail === 0 ? 0 : 1);
