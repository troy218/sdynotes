// Admin login/verify/logout + master-key escrow.
import {
  adminStatus, adminLogin, adminVerify, adminLogout,
  clientIp, requireAdmin, escrowWrap, escrowUnwrap,
} from '../lib/admin.js';

export function registerAdmin(app) {
  app.get('/api/admin/status', async (req, reply) => {
    const r = await adminStatus(clientIp(req));
    return reply.send(r);
  });

  app.post('/api/admin/login', async (req, reply) => {
    const ip = clientIp(req);
    const pw = (req.body || {}).password || '';
    const r = await adminLogin(ip, pw);
    if (r.status === 200) console.log(`[admin] 로그인 성공 ip=${ip}`);
    else console.log(`[admin] 로그인 실패/차단 ip=${ip}`);
    return reply.code(r.status).send(r.body);
  });

  app.post('/api/admin/verify', async (req, reply) => {
    const tok = (req.body || {}).token || '';
    return reply.send(await adminVerify(tok));
  });

  app.post('/api/admin/logout', async (req, reply) => {
    const tok = (req.body || {}).token || '';
    return reply.send(await adminLogout(tok));
  });

  // escrow: wrap = public, unwrap = admin only
  app.post('/api/escrow/wrap', async (req, reply) => {
    const pw = (req.body || {}).pw || '';
    if (!pw || pw.length > 200) return reply.code(400).send({ ok: false, error: 'bad pw' });
    return reply.send({ ok: true, blob: escrowWrap(pw) });
  });

  app.post('/api/escrow/unwrap', async (req, reply) => {
    if (!requireAdmin(req, req.body || {})) {
      return reply.code(403).send({ ok: false, error: '관리자 권한이 필요합니다' });
    }
    const pw = escrowUnwrap((req.body || {}).blob || '');
    if (pw === null) return reply.send({ ok: false, error: '복원 실패' });
    return reply.send({ ok: true, pw });
  });
}
