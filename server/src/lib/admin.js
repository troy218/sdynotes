// Admin auth (rate-limited login) + master-key escrow. Port of admin.py.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { FILES } from './paths.js';
import { ADMIN_PW_HASH, MAX_TRIES, BLOCK_SECONDS, SESSION_TTL, SESSION_REFRESH_IF_LT } from './config.js';
import { readJson, writeJsonAtomic } from './store.js';
import { withLock } from './store.js';

// ── login rate limit + sessions ────────────────────────────────────────
const attempts = new Map(); // ip -> {count, blocked_until}
let sessions = new Map();   // token -> expires_at (sec)

export async function sessionsLoad() {
  const data = await readJson(FILES.adminSessions, {});
  const now = Date.now() / 1000;
  sessions = new Map();
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'number' && v > now) sessions.set(k, v);
  }
}

function sessionsSave() {
  return writeJsonAtomic(FILES.adminSessions, Object.fromEntries(sessions)).catch(() => {});
}

function purgeExpired(now) {
  for (const [ip, v] of attempts) {
    if ((v.blocked_until || 0) < now && (v.count || 0) === 0) attempts.delete(ip);
  }
  for (const [tok, exp] of sessions) {
    if (exp < now) sessions.delete(tok);
  }
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return String(req.headers['x-real-ip'] || req.ip || 'unknown');
}

export function adminStatus(ip) {
  const now = Date.now() / 1000;
  return withLock('admin', () => {
    purgeExpired(now);
    const rec = attempts.get(ip) || {};
    const until = rec.blocked_until || 0;
    if (until > now) return { blocked: true, retry_after: Math.floor(until - now) };
    return { blocked: false, remaining: MAX_TRIES - (rec.count || 0) };
  });
}

export function adminLogin(ip, password) {
  const now = Date.now() / 1000;
  return withLock('admin', async () => {
    purgeExpired(now);
    const rec = attempts.get(ip) || { count: 0, blocked_until: 0 };
    attempts.set(ip, rec);

    if (rec.blocked_until > now) {
      const wait = Math.floor(rec.blocked_until - now);
      return {
        status: 429,
        body: { ok: false, blocked: true, retry_after: wait,
                error: `${Math.floor(wait / 60)}분 ${wait % 60}초 후에 다시 시도하세요` },
      };
    }
    const given = crypto.createHash('sha256').update(String(password)).digest('hex');
    if (crypto.timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(ADMIN_PW_HASH, 'hex'))) {
      rec.count = 0;
      rec.blocked_until = 0;
      const token = crypto.randomBytes(32).toString('base64url');
      sessions.set(token, now + SESSION_TTL);
      await sessionsSave();
      return { status: 200, body: { ok: true, token, expires_in: SESSION_TTL } };
    }
    rec.count += 1;
    const left = MAX_TRIES - rec.count;
    if (left <= 0) {
      rec.blocked_until = now + BLOCK_SECONDS;
      rec.count = 0;
      return {
        status: 429,
        body: { ok: false, blocked: true, retry_after: BLOCK_SECONDS,
                error: '3회 실패 · 10분간 차단되었습니다' },
      };
    }
    return {
      status: 401,
      body: { ok: false, blocked: false, remaining: left,
              error: `비밀번호가 올바르지 않습니다 (남은 시도 ${left}회)` },
    };
  });
}

export function adminVerify(token) {
  const now = Date.now() / 1000;
  return withLock('admin', () => {
    purgeExpired(now);
    return { ok: Boolean(token) && (sessions.get(String(token)) || 0) > now };
  });
}

export function adminLogout(token) {
  return withLock('admin', async () => {
    sessions.delete(String(token || ''));
    await sessionsSave();
    return { ok: true };
  });
}

// direct token check (used by /internal/verify for the Python worker)
// synchronous — single-threaded Node, Map reads are atomic (no awaits here).
export function verifyToken(token) {
  const now = Date.now() / 1000;
  purgeExpired(now);
  const exp = sessions.get(String(token)) || 0;
  if (!token || exp <= now) return false;
  if (exp - now < SESSION_REFRESH_IF_LT) {
    sessions.set(String(token), now + SESSION_TTL);
    sessionsSave().catch(() => {});
  }
  return true;
}

// token extraction: Bearer / X-Admin-Token / admin-token / form / query / body / cookie
export function extractToken(req, body) {
  let tok = '';
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) tok = auth.slice(7).trim();
  if (!tok) tok = String(req.headers['x-admin-token'] || req.headers['admin-token'] || '').trim();
  if (!tok && req.query) tok = String(req.query.token || '').trim();
  if (!tok && body && body.token) tok = String(body.token).trim();
  if (!tok) tok = String(req.cookies?.sdy_admin || req.cookies?.admin_token || '').trim();
  return tok;
}

// synchronous — single-threaded Node, Map reads are atomic (no awaits here).
export function requireAdmin(req, body) {
  const tok = extractToken(req, body);
  const now = Date.now() / 1000;
  purgeExpired(now);
  const exp = sessions.get(tok) || 0;
  if (!tok || exp <= now) return false;
  // extend while in use so long jobs don't drop mid-way
  if (exp - now < SESSION_REFRESH_IF_LT) {
    sessions.set(tok, now + SESSION_TTL);
    sessionsSave().catch(() => {});
  }
  return true;
}

// ── escrow v2 (S2: HMAC-SHA256 keystream) ──────────────────────────────
let escrowKey = null;
const escrowFile = FILES.escrowKey;

function escrowMaster() {
  if (escrowKey) return escrowKey;
  try {
    escrowKey = fs.readFileSync(escrowFile);
  } catch {
    escrowKey = crypto.randomBytes(32);
    try {
      fs.writeFileSync(escrowFile, escrowKey, { mode: 0o600 });
    } catch { /* ignore */ }
  }
  return escrowKey;
}

function keystream(master, nonce, n) {
  const out = [];
  let ctr = 0;
  let produced = 0;
  while (produced < n) {
    const h = crypto.createHmac('sha256', master)
      .update(Buffer.concat([nonce, Buffer.from([(ctr >>> 24) & 255, (ctr >>> 16) & 255, (ctr >>> 8) & 255, ctr & 255])]))
      .digest();
    out.push(h);
    produced += h.length;
    ctr += 1;
  }
  return Buffer.concat(out).subarray(0, n);
}

export function escrowWrap(pw) {
  const m = escrowMaster();
  const nonce = crypto.randomBytes(16);
  const pb = Buffer.from(String(pw), 'utf-8');
  const ks = keystream(m, nonce, pb.length);
  const ct = Buffer.alloc(pb.length);
  for (let i = 0; i < pb.length; i++) ct[i] = pb[i] ^ ks[i];
  const tag = crypto.createHmac('sha256', m).update(Buffer.concat([nonce, ct])).digest().subarray(0, 16);
  return 'S2:' + Buffer.concat([nonce, ct, tag]).toString('base64');
}

export function escrowUnwrap(blob) {
  if (typeof blob !== 'string' || !blob.startsWith('S2:')) return null;
  try {
    const raw = Buffer.from(blob.slice(3), 'base64');
    const nonce = raw.subarray(0, 16);
    const ct = raw.subarray(16, raw.length - 16);
    const tag = raw.subarray(raw.length - 16);
    const m = escrowMaster();
    const want = crypto.createHmac('sha256', m).update(Buffer.concat([nonce, ct])).digest().subarray(0, 16);
    if (!crypto.timingSafeEqual(want, tag)) return null;
    const ks = keystream(m, nonce, ct.length);
    const out = Buffer.alloc(ct.length);
    for (let i = 0; i < ct.length; i++) out[i] = ct[i] ^ ks[i];
    return out.toString('utf-8');
  } catch {
    return null;
  }
}
