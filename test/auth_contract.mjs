// 16.2 · 회원(이메일 OTP 로그인) 통합 테스트 — Fastify 인스턴스를 직접 띄운다.
//
// 다루는 것:
//   OTP 요청(형식·개발 코드) → 코드 확인(틀림·만료 아님) → 회원가입(닉네임 필수·중복 금지)
//   → 로그인(토큰) → me → 고정 닉네임 변경(중복 금지) → 로그아웃
//   엽스코드 연동: 회원 조인(고정닉 강제·verified 배지) / 비회원이 회원 닉 흉내(409)
//   음악 연동: /internal/whoami (worker 가 '올린 사람'을 묻는 창구) + 곡 레코드 uploader 통과
process.env.SDY_BASE_DIR = process.env.SDY_BASE_DIR_TEST ||
  `${import.meta.dirname}/.tmp_auth_${Date.now().toString(36)}`;
process.env.SDY_AUTH_DEV_CODE = '1';   // SMTP 없이 코드를 응답으로 받는 개발 모드
process.env.SDY_AUTH_OTP_COOLDOWN = '1'; // 테스트용: 재발송 대기 1초

const { registerAuth } = await import('../server/src/routes/auth.js');
const { registerChat } = await import('../server/src/routes/chat.js');
const { registerMusic } = await import('../server/src/routes/music.js');
const { userAuthBoot } = await import('../server/src/lib/userauth.js');
const { default: Fastify } = await import('fastify');
const { default: multipart } = await import('@fastify/multipart');
const fs = await import('node:fs');
const path = await import('node:path');

const PORT = 5198;
const app = Fastify({ logger: false });
await app.register(multipart, { limits: { fileSize: 512 * 1024 * 1024, files: 1 } });
registerChat(app);
registerMusic(app, { worker: { proxy: async (req, reply) => reply.code(503).send({ ok: false }) } });
registerAuth(app);
await userAuthBoot();
await app.listen({ port: PORT, host: '127.0.0.1' });

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
const j = (p, opt) => fetch(`http://127.0.0.1:${PORT}${p}`, opt)
  .then(async (r) => ({ s: r.status, d: await r.json().catch(() => ({})) }));

// ── 1) OTP 요청 ──
const bad = await j('/api/auth/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: '까치' }) });
ok('otp: 형식 틀린 이메일 거절(400)', bad.s === 400);

const o1 = await j('/api/auth/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bird1@test.local' }) });
ok('otp: 코드 발급(개발 코드 포함)', o1.s === 200 && o1.d.ok && /^\d{6}$/.test(o1.d.dev_code || ''));
ok('otp: 새 이메일은 registered=false', o1.d.registered === false);

const o1b = await j('/api/auth/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bird1@test.local' }) });
ok('otp: 45초 재발송 대기(429 + retry_after)', o1b.s === 429 && o1b.d.retry_after > 0);

// ── 2) 코드 확인 ──
const wrong = await j('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bird1@test.local', code: '000000', nick: '고정닉' }) });
ok('verify: 틀린 코드 거절(401) + 남은 시도 안내', wrong.s === 401 && /남은 시도/.test(wrong.d.error || ''));

const noNick = await j('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bird1@test.local', code: o1.d.dev_code }) });
ok('verify: 새 회원은 닉네임 필수(need_nick)', noNick.s === 400 && noNick.d.need_nick === true);

// 닉네임 누락으로 한 번 실패해도 코드는 살아 있다 — 다시 시도
const good = await j('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bird1@test.local', code: o1.d.dev_code, nick: '  연보라 까치  ' }) });
ok('verify: 가입 + 토큰 발급', good.s === 200 && good.d.ok && !!good.d.token);
ok('verify: 닉네임 양쪽 공백 정리', good.d.user.nick === '연보라 까치');

// ── 3) 두 번째 사용자 · 닉네임 중복 금지 ──
const o2 = await j('/api/auth/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bird2@test.local' }) });
const dup = await j('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bird2@test.local', code: o2.d.dev_code, nick: '연보라 까치' }) });
ok('verify: 남의 고정닉은 가져갈 수 없다', dup.s === 400 && dup.d.nick_taken === true);

const o2b = await j('/api/auth/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bird2@test.local' }) });
ok('otp: 닉네임 중복 실패 뒤에도 재발송 대기 유지(429)', o2b.s === 429);

// ── 3.5) 등록된 회원 재로그인 — nick 없이(빈 값)도 통과해야 한다 ──
//  (프런트가 등록 회원에게 nick:'' 을 보내는 계약 — 16.2 수정)
await new Promise((r) => setTimeout(r, 1300));    // 재발송 대기(테스트: 1초) 지나가기
const o1c = await j('/api/auth/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bird1@test.local' }) });
ok('otp: 대기 후 재발급 성공 + registered=true', o1c.s === 200 && o1c.d.ok && o1c.d.registered === true);
const relogin = await j('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bird1@test.local', code: o1c.d.dev_code, nick: '' }) });
ok('verify: 등록 회원은 빈 nick 로 재로그인 가능', relogin.s === 200 && relogin.d.ok && relogin.d.user.nick === '연보라 까치');

// ── 4) me / 닉네임 변경 / 로그아웃 ──
const tok = good.d.token;
const me = await j('/api/auth/me', { headers: { 'x-sdy-auth': tok } });
ok('me: 토큰으로 내 정보', me.s === 200 && me.d.user.nick === '연보라 까치');

const meBad = await j('/api/auth/me', { headers: { 'x-sdy-auth': 'nope' } });
ok('me: 못 믿는 토큰은 401', meBad.s === 401);

const nck = await j('/api/auth/nick', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sdy-auth': tok }, body: JSON.stringify({ nick: '백로' }) });
ok('nick: 고정 닉네임 변경', nck.s === 200 && nck.d.nick === '백로');

// ── 5) 엽스코드: 회원 조인은 고정닉 강제 + verified ──
const cj = await j('/api/chat/join', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', authorization: `Bearer ${tok}` },
  body: JSON.stringify({ uid: 'mA', name: '가짜이름' }),
});
ok('chat: 회원 조인 → 보낸 이름 무시하고 고정닉', cj.s === 200 && cj.d.me.name === '백로');
ok('chat: 회원 조인 → verified=true', cj.d.me.verified === true);

const cm = await j('/api/chat/msg', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: 'mA', text: '안녕!' }) });
ok('chat: 회원 메시지에 verified 가 붙는다', cm.d.ok && cm.d.msg.verified === true);

const cg = await j('/api/chat/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: 'mB', name: '백로' }) });
ok('chat: 비회원이 회원 고정닉 흉내 → 409 nickname_protected', cg.s === 409 && cg.d.nickname_protected === true);

const cg2 = await j('/api/chat/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: 'mB', name: '민트색 참새' }) });
ok('chat: 비회원 보통 이름은 통과(verified=false)', cg2.s === 200 && cg2.d.me.verified === false);
ok('chat: 멤버 목록에 verified 표시', (cg2.d.members || []).some((m) => m.uid === 'mA' && m.verified));

// ── 6) worker 창구: /internal/whoami (loopback) ──
const who = await j('/internal/whoami', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tok }) });
ok('whoami: 토큰 → 회원 신원', who.s === 200 && who.d.ok && who.d.user.nick === '백로');
const whoBad = await j('/internal/whoami', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'nope' }) });
ok('whoami: 못 믿는 토큰 → ok=false', whoBad.s === 200 && whoBad.d.ok === false);

// ── 7) 음악 목록: uploader 필드가 그대로 흐른다 ──
const musicDir = path.join(process.env.SDY_BASE_DIR, 'music');
fs.mkdirSync(musicDir, { recursive: true });
fs.writeFileSync(path.join(musicDir, '_index.json'), JSON.stringify({
  abc123: { id: 'abc123', title: '노래', ext: 'mp3', created_at: '2026-01-01T00:00:00Z', uploader: '백로', uploader_uid: 'u_x' },
}, null, 0), 'utf8');
const ml = await j('/api/music/list');
const t = (ml.d.tracks || []).find((x) => x.id === 'abc123');
ok('music: 목록 응답에 uploader 가 살아 있다', !!t && t.uploader === '백로' && t.uploader_uid === 'u_x');

// ── 8) 로그아웃 ──
const lo = await j('/api/auth/logout', { method: 'POST', headers: { 'x-sdy-auth': tok } });
const meAfter = await j('/api/auth/me', { headers: { 'x-sdy-auth': tok } });
ok('logout: 토큰 무효화', lo.s === 200 && meAfter.s === 401);

await app.close();
try { fs.rmSync(process.env.SDY_BASE_DIR, { recursive: true, force: true }); } catch { /* */ }
console.log(`\n회원 인증 테스트: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
