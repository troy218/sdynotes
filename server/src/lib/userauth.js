// 16.2/16.4 · 회원 인증 — 최초 등록은 이메일 OTP, 이후 로그인은 이메일+비밀번호.
//
// 새 회원은 이메일로 받은 6자리 OTP(10분)로 신원을 확인한 뒤 닉네임과
// 비밀번호를 함께 등록한다. 등록 후에는 OTP가 아니라 이메일+비밀번호로
// 로그인한다. 예전 OTP-only 회원(비밀번호 필드가 없는 레코드)은 초기
// 비밀번호 000000 으로 로그인할 수 있고, 로그인 뒤 비밀번호 설정을 유도한다.
//
//   사용자   .sdy_users.json          uid -> {uid,email,nick,pass,created_at}
//   세션     .sdy_user_sessions.json  token -> {uid,exp}
//   OTP      메모리만 (10분 뒤 소멸)
//
// 로그인한 사용자는:
//   · 엽스코드에서 서버가 고정 닉네임을 보장한다(게스트가 흉내 못 냄)
//   · 올린 곡에 '누가 올렸는지' 표시가 붙는다(worker 가 /internal/whoami 로 묻는다)
import crypto from 'node:crypto';
import { FILES } from './paths.js';
import { readJson, writeJsonAtomic, withLock } from './store.js';

export const USER_SESSION_TTL = 30 * 24 * 3600;          // 30일
const USER_SESSION_REFRESH_IF_LT = 7 * 24 * 3600;        // 7일 미만 남으면 자동 연장
const OTP_TTL = 10 * 60;                                  // 코드 유효 10분
const OTP_RESEND_COOLDOWN = Math.max(1, parseInt(process.env.SDY_AUTH_OTP_COOLDOWN || '45', 10) || 45); // 재발송 대기(초)
const OTP_MAX_TRIES = 5;                                  // 코드 확인 실패 상한
const NICK_MAX = 16;
const PASS_MIN = 6;
const PASS_MAX = 128;
const PASS_ALG = 'pbkdf2-sha256';
const PASS_ITER = 210000;
export const LEGACY_DEFAULT_PASSWORD = '000000';

// ── 저장 ────────────────────────────────────────────────
let users = null;          // uid -> record
let usersMtime = 0;
let sessions = null;       // token -> {uid, exp}

async function usersLoad() {
  if (users) return users;
  users = (await readJson(FILES.authUsers, {})) || {};
  try { usersMtime = (await import('node:fs')).statSync(FILES.authUsers).mtimeMs; } catch { usersMtime = 0; }
  return users;
}
async function usersSave() {
  await writeJsonAtomic(FILES.authUsers, users);
  try { usersMtime = (await import('node:fs')).statSync(FILES.authUsers).mtimeMs; } catch { usersMtime = 0; }
}
async function sessionsLoad() {
  const now = Date.now() / 1000;
  const d = (await readJson(FILES.authSessions, {})) || {};
  sessions = new Map();
  for (const [tok, v] of Object.entries(d)) {
    if (v && typeof v === 'object' && typeof v.exp === 'number' && v.exp > now && v.uid) {
      sessions.set(tok, { uid: v.uid, exp: v.exp });
    }
  }
  return sessions;
}
async function ensureSessions() {
  if (!sessions) await sessionsLoad();
  return sessions;
}
export async function userAuthBoot() {
  await usersLoad();
  await sessionsLoad();
}
function sessionsSave() {
  const o = {};
  for (const [tok, v] of sessions || new Map()) o[tok] = v;
  return writeJsonAtomic(FILES.authSessions, o).catch(() => {});
}

// ── 닉네임/이메일/비밀번호 규칙 ─────────────────────────
export function sanitizeNick(raw) {
  let s = String(raw == null ? '' : raw)
    .replace(/[\u200b-\u200f\ufeff\u202a-\u202e]/g, '')   // 보이지 않는 문자 제거
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.slice(0, NICK_MAX).trim();
}
const normNick = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
export const sanitizeEmail = (raw) => String(raw == null ? '' : raw).trim().toLowerCase().slice(0, 254);
export const emailValid = (e) => EMAIL_RE.test(e);
const cleanPassword = (raw) => String(raw == null ? '' : raw);
export function passwordValid(raw) {
  const p = cleanPassword(raw);
  // eslint-disable-next-line no-control-regex
  return p.length >= PASS_MIN && p.length <= PASS_MAX && !/[\u0000-\u001F\u007F]/.test(p);
}

function passRecord(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.pbkdf2Sync(cleanPassword(password), salt, PASS_ITER, 32, 'sha256').toString('base64url');
  return { alg: PASS_ALG, iter: PASS_ITER, salt, hash, set_at: new Date().toISOString() };
}
function passDigest(password, salt, iter) {
  return crypto.pbkdf2Sync(cleanPassword(password), String(salt || ''), iter || PASS_ITER, 32, 'sha256').toString('base64url');
}
function timingEqualStr(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function hasPassword(rec) {
  return !!(rec && rec.pass && rec.pass.hash && rec.pass.salt);
}
function passwordMatches(rec, password) {
  if (!rec) return false;
  if (hasPassword(rec)) {
    const p = rec.pass;
    if (p.alg && p.alg !== PASS_ALG) return false;
    return timingEqualStr(passDigest(password, p.salt, Number(p.iter) || PASS_ITER), p.hash);
  }
  // 16.4 · 이전 OTP-only 계정: 초기 비밀번호 000000 으로 한 번 로그인 가능.
  return cleanPassword(password) === LEGACY_DEFAULT_PASSWORD;
}
function publicUser(rec) {
  if (!rec) return null;
  return { uid: rec.uid, email: rec.email, nick: rec.nick, needs_password: !hasPassword(rec) };
}
async function issueSessionFor(rec) {
  const now = Date.now() / 1000;
  await ensureSessions();
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { uid: rec.uid, exp: now + USER_SESSION_TTL });
  await sessionsSave();
  return token;
}

export async function nickTaken(nick, exceptUid) {
  const u = await usersLoad();
  const n = normNick(nick);
  if (!n) return false;
  for (const rec of Object.values(u)) {
    if (exceptUid && rec.uid === exceptUid) continue;
    if (normNick(rec.nick) === n) return true;
  }
  return false;
}
export async function userByEmail(email) {
  const u = await usersLoad();
  for (const rec of Object.values(u)) if (rec.email === email) return rec;
  return null;
}
export async function userByUid(uid) {
  const u = await usersLoad();
  return u[uid] || null;
}
// 16.3 · 닉네임으로 회원 찾기 (친구 요청 등록용 — normNick 비교와 같은 규칙)
export async function userByNick(nick) {
  const u = await usersLoad();
  const n = normNick(nick);
  if (!n) return null;
  for (const rec of Object.values(u)) {
    if (normNick(rec.nick) === n) return rec;
  }
  return null;
}

// ── OTP (메모리) ───────────────────────────────────────
const otps = new Map();     // email -> {hash,exp,tries,lastSent}
const otpRate = new Map();  // ip -> {count,reset_at}

export function otpRateStatus(ip) {
  const now = Date.now() / 1000;
  const r = otpRate.get(ip) || { count: 0, reset_at: now + 3600 };
  if (r.reset_at < now) { otpRate.delete(ip); return { blocked: false, remaining: 10 }; }
  return { blocked: r.count >= 10, remaining: Math.max(0, 10 - r.count) };
}
function otpRateHit(ip) {
  const now = Date.now() / 1000;
  const r = otpRate.get(ip) || { count: 0, reset_at: now + 3600 };
  if (r.reset_at < now) { r.count = 0; r.reset_at = now + 3600; }
  r.count += 1;
  otpRate.set(ip, r);
}

// 코드 생성 + 저장. 발송은 호출자(auth 라우트)가 맡는다.
// 반환: {ok, code?, retry_after?, registered?} — 등록 OTP 전용이라 기존 이메일은 거절한다.
export async function otpIssue(email) {
  const existing = await userByEmail(email);
  if (existing) {
    return { ok: false, registered: true, error: '이미 등록된 이메일이에요' };
  }
  const now = Date.now() / 1000;
  const prev = otps.get(email);
  if (prev && prev.lastSent && now - prev.lastSent < OTP_RESEND_COOLDOWN) {
    return { ok: false, retry_after: Math.ceil(OTP_RESEND_COOLDOWN - (now - prev.lastSent)) };
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  otps.set(email, {
    hash: crypto.createHash('sha256').update(code).digest('hex'),
    exp: now + OTP_TTL, tries: 0, lastSent: now,
  });
  return { ok: true, code, expires_in: OTP_TTL, registered: false };
}

// 코드 확인 + 신규 회원 등록. OTP는 최초 등록에만 쓰고, 등록 시 비밀번호도 저장한다.
// 반환: {ok, user?, token?} 또는 {ok:false, error, tries_left?}
export async function otpVerifyAndLogin(email, code, nickWanted, passwordWanted) {
  const now = Date.now() / 1000;
  const rec = otps.get(email);
  if (!rec || rec.exp < now) return { ok: false, error: '인증 코드가 만료되었어요. 다시 받아 주세요' };
  if (rec.tries >= OTP_MAX_TRIES) {
    otps.delete(email);
    return { ok: false, error: '시도 횟수를 초과했어요. 새 코드로 다시 시도해 주세요' };
  }
  const given = String(code == null ? '' : code).replace(/\D/g, '');
  const hash = crypto.createHash('sha256').update(given).digest('hex');
  if (!given || hash !== rec.hash) {
    rec.tries += 1;
    const left = OTP_MAX_TRIES - rec.tries;
    if (left <= 0) otps.delete(email);
    return { ok: false, error: `코드가 맞지 않아요 (남은 시도 ${Math.max(0, left)}회)`, tries_left: Math.max(0, left) };
  }

  return withLock('userauth', async () => {
    await usersLoad();
    let user = await userByEmail(email);
    if (user) {
      otps.delete(email);
      return { ok: false, error: '이미 등록된 이메일이에요', registered: true };
    }
    const nick = sanitizeNick(nickWanted);
    // 코드는 살려 둔다 — 닉네임/비밀번호만 고쳐 다시 시도할 수 있게.
    if (!nick) return { ok: false, error: '새 회원은 고정 닉네임이 필요해요', need_nick: true };
    if (await nickTaken(nick)) return { ok: false, error: '이미 쓰이는 닉네임이에요. 다른 닉네임을 적어 주세요', need_nick: true, nick_taken: true };
    if (!passwordValid(passwordWanted)) return { ok: false, error: `비밀번호는 ${PASS_MIN}자 이상으로 입력해 주세요`, need_password: true };
    user = {
      uid: 'u_' + crypto.randomBytes(9).toString('hex'),
      email, nick,
      pass: passRecord(passwordWanted),
      created_at: new Date().toISOString(),
    };
    users[user.uid] = user;
    await usersSave();
    otps.delete(email);   // 등록 성공 확정 → 일회용 코드 폐기
    const token = await issueSessionFor(user);
    return { ok: true, token, isNew: true, user: publicUser(user) };
  });
}

// ── 비밀번호 로그인/변경 ───────────────────────────────
export async function passwordLogin(email, password) {
  await usersLoad();
  const user = await userByEmail(email);
  if (!user || !passwordMatches(user, password)) {
    return { ok: false, error: '이메일 또는 비밀번호가 맞지 않아요' };
  }
  const token = await issueSessionFor(user);
  return { ok: true, token, isNew: false, needs_password: !hasPassword(user), user: publicUser(user) };
}

export function userChangePassword(user, oldPassword, newPassword) {
  return withLock('userauth', async () => {
    await usersLoad();
    const rec = users[user.uid];
    if (!rec) return { ok: false, error: '회원 정보를 찾을 수 없어요' };
    if (!passwordMatches(rec, oldPassword)) return { ok: false, error: '현재 비밀번호가 맞지 않아요' };
    if (!passwordValid(newPassword)) return { ok: false, error: `새 비밀번호는 ${PASS_MIN}자 이상으로 입력해 주세요` };
    rec.pass = passRecord(newPassword);
    rec.password_changed_at = new Date().toISOString();
    await usersSave();
    return { ok: true, needs_password: false };
  });
}

// ── 세션 ───────────────────────────────────────────────
function sessionUser(tok) {
  const now = Date.now() / 1000;
  const s = (sessions || new Map()).get(String(tok || ''));
  if (!s || s.exp <= now) return null;
  // 여유가 얼마 없으면 자동 연장(쓰기는 비동기로)
  if (s.exp - now < USER_SESSION_REFRESH_IF_LT) {
    s.exp = now + USER_SESSION_TTL;
    sessionsSave();
  }
  return users ? (users[s.uid] || null) : null;
}

// 동기 조회(파일은 boot 때 한 번 읽는다). chat 조인 같은 곳에서 쓴다.
export function userByTokenSync(token) {
  if (!token) return null;
  const u = sessionUser(String(token));
  return u ? publicUser(u) : null;
}

// 요청에서 토큰 뽑기: Authorization: Bearer / x-sdy-auth / 쿼리 token
export function extractUserToken(req) {
  let tok = '';
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) tok = auth.slice(7).trim();
  if (!tok) tok = String(req.headers['x-sdy-auth'] || '').trim();
  if (!tok && req.query) tok = String(req.query.token || '').trim();
  return tok;
}
export function requireUser(req) {
  return userByTokenSync(extractUserToken(req));
}

export function userLogout(token) {
  return withLock('userauth', async () => {
    await ensureSessions();
    if (sessions) sessions.delete(String(token || ''));
    await sessionsSave();
    return { ok: true };
  });
}

// 고정 닉네임 변경 (유일해야 함)
export function userChangeNick(user, nickWanted) {
  return withLock('userauth', async () => {
    await usersLoad();
    const rec = users[user.uid];
    if (!rec) return { ok: false, error: '회원 정보를 찾을 수 없어요' };
    const nick = sanitizeNick(nickWanted);
    if (!nick) return { ok: false, error: '닉네임을 입력해 주세요' };
    if (nick === rec.nick) return { ok: true, nick: rec.nick };
    if (await nickTaken(nick, user.uid)) return { ok: false, error: '이미 쓰이는 닉네임이에요' };
    rec.nick = nick;
    await usersSave();
    return { ok: true, nick: rec.nick };
  });
}

// 서버 재시작해도 세션 파일에 있던 토큰이 살아 있게 — 부팅 시 호출.
// (usersLoad 는 mtime 변화를 안 보기 때문에, 외부에서 파일을 고치면
//  프로세스를 다시 띄우는 게 정석이다. 회원 수가 적어 충분하다.)
export { otpRateHit };
