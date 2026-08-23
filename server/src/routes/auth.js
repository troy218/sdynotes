// 16.2 · 회원 인증 라우트 — 이메일 OTP 로그인 (비밀번호 없음).
//
// 흐름:
//   ① POST /api/auth/otp    {email}          → 6자리 코드 발송(SMTP)
//   ② POST /api/auth/verify {email,code,nick} → 세션 토큰 발급 (새 이메일이면 닉네임 등록)
//   ③ GET  /api/auth/me     (Bearer 토큰)     → 내 정보 (세션 자동 연장)
//
// SMTP(SDY_SMTP_*) 가 설정돼 있지 않으면 메일은 못 보내고 서버 콘솔에 코드를
// 찍는다. SDY_AUTH_DEV_CODE=1 이면(개발/점검용) 응답에 코드를 실어 준다.
import { clientIp } from '../lib/admin.js';
import { smtpConfigured, sendMail } from '../lib/mailer.js';
import {
  otpIssue, otpVerifyAndLogin, otpRateStatus, otpRateHit,
  emailValid, sanitizeEmail, sanitizeNick,
  requireUser, extractUserToken, userLogout, userChangeNick, userByTokenSync,
} from '../lib/userauth.js';

const DEV_CODE = ['1', 'true', 'yes'].includes(String(process.env.SDY_AUTH_DEV_CODE || '').toLowerCase());

function bearerUser(req) {
  return requireUser(req);
}

export function registerAuth(app) {
  // ── ① 인증 코드 요청 ──
  app.post('/api/auth/otp', async (req, reply) => {
    const d = req.body || {};
    const email = sanitizeEmail(d.email);
    if (!email || !emailValid(email)) {
      return reply.code(400).send({ ok: false, error: '이메일 주소를 바르게 입력해 주세요' });
    }
    const ip = clientIp(req);
    const rate = otpRateStatus(ip);
    if (rate.blocked) {
      return reply.code(429).send({ ok: false, error: '잠시 후 다시 시도해 주세요' });
    }
    otpRateHit(ip);
    const r = await otpIssue(email);
    if (!r.ok) {
      return reply.code(429).send({ ok: false, error: `코드는 ${r.retry_after}초 뒤에 다시 받을 수 있어요`, retry_after: r.retry_after });
    }
    // 메일 본문
    const subject = 'SDYnotes 로그인 인증 코드';
    const text = `인증 코드: ${r.code}\n\n` +
      `10분 안에 입력해 주세요. 코드는 한 번만 쓸 수 있어요.\n` +
      `본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다.\n\n— SDYnotes`;
    let delivered = false;
    if (smtpConfigured()) {
      try { await sendMail({ to: email, subject, text }); delivered = true; }
      catch (e) {
        console.error(`[auth] 메일 발송 실패 (${email}): ${e?.message || e}`);
        // 개발 모드면 코드를 응답으로 돌려 진행하게 한다(미리보기/점검용)
        if (!DEV_CODE) {
          return reply.code(502).send({ ok: false, error: '메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요' });
        }
        console.log(`[auth] 개발 모드 · ${email} 인증 코드: ${r.code}`);
      }
    } else {
      // SMTP 미설정 — 운영자가 서버 콘솔로 확인할 수 있게 찍는다.
      console.log(`[auth] SMTP 미설정 · ${email} 인증 코드: ${r.code}`);
    }
    return reply.send({
      ok: true, delivered, registered: !!r.registered, expires_in: r.expires_in,
      ...(DEV_CODE && !delivered ? { dev_code: r.code } : {}),
    });
  });

  // ── ② 코드 확인 + 로그인(또는 회원가입) ──
  //   nick 은 '새 이메일'일 때만 필요하다 — 등록된 회원은 빈 값으로 와도 통과.
  //   (새 회원 닉네임 검증은 userauth.otpVerifyAndLogin 이 맡는다)
  app.post('/api/auth/verify', async (req, reply) => {
    const d = req.body || {};
    const email = sanitizeEmail(d.email);
    if (!email || !emailValid(email)) {
      return reply.code(400).send({ ok: false, error: '이메일 주소가 올바르지 않아요' });
    }
    const r = await otpVerifyAndLogin(email, d.code, d.nick);
    if (!r.ok) {
      const code = r.need_nick ? 400 : 401;
      return reply.code(code).send(r);
    }
    return reply.send({ ok: true, token: r.token, user: r.user });
  });

  // ── ③ 내 정보 ──
  app.get('/api/auth/me', async (req, reply) => {
    const u = bearerUser(req);
    if (!u) return reply.code(401).send({ ok: false, error: '로그인이 필요해요' });
    return reply.send({ ok: true, user: { uid: u.uid, email: u.email, nick: u.nick } });
  });

  // ── 고정 닉네임 변경 ──
  app.post('/api/auth/nick', async (req, reply) => {
    const u = bearerUser(req);
    if (!u) return reply.code(401).send({ ok: false, error: '로그인이 필요해요' });
    const r = await userChangeNick(u, (req.body || {}).nick);
    if (!r.ok) return reply.code(409).send(r);
    return reply.send(r);
  });

  // ── 로그아웃 ──
  app.post('/api/auth/logout', async (req, reply) => {
    await userLogout(extractUserToken(req));
    return reply.send({ ok: true });
  });

  // ── 닉네임 중복 확인 (회원가입 화면에서 미리 검사) ──
  app.post('/api/auth/nick-check', async (req, reply) => {
    const nick = sanitizeNick((req.body || {}).nick);
    if (!nick) return reply.send({ ok: true, available: false });
    const { nickTaken } = await import('../lib/userauth.js');
    return reply.send({ ok: true, available: !(await nickTaken(nick)) });
  });

  // ── Python worker 용 내부 엔드포인트 (loopback 전용) ──
  //   곡 업로드에 '누가 올렸는지' 표시를 붙이기 위해 worker 가 묻는다.
  app.post('/internal/whoami', async (req, reply) => {
    const ip = req.ip;
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      return reply.code(403).send({ ok: false });
    }
    const u = userByTokenSync(String((req.body || {}).token || ''));
    if (!u) return reply.send({ ok: false });
    return reply.send({ ok: true, user: { uid: u.uid, nick: u.nick } });
  });
}
