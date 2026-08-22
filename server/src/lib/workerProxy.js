// Python worker HTTP proxy — forwards heavy requests (import / music tagging)
// to the local worker and streams the response back.
import { Readable } from 'node:stream';
import { WORKER_URL } from './config.js';

function isLoopback(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function createWorkerProxy({ app, logger }) {
  async function proxy(req, reply, options = {}) {
    const target = `${WORKER_URL}${req.url}`;
    const headers = {};
    for (const h of ['content-type', 'content-length', 'accept', 'authorization', 'x-admin-token', 'admin-token', 'cookie']) {
      const v = req.headers[h];
      if (v !== undefined) headers[h] = v;
    }
    let body;
    const ct = req.headers['content-type'] || '';
    if (ct.includes('multipart/form-data')) {
      // Fastify's multipart plugin and the worker cannot share the incoming
      // request stream.  In particular, handing req.raw to fetch directly can
      // race with Fastify's parser and leaves Flask with an empty file after a
      // migration/restart. Music uploads are capped at 50 MB, so buffer that
      // small upload explicitly; keep the streaming path for PDF imports.
      if (options.bufferMultipart) {
        const chunks = [];
        for await (const chunk of req.raw) chunks.push(chunk);
        body = Buffer.concat(chunks);
        headers['content-length'] = String(body.length);
      } else {
        body = Readable.toWeb(req.raw);
        headers['content-length'] = req.headers['content-length'];
      }
    } else if (req.body !== undefined && req.body !== null && typeof req.body === 'object') {
      body = JSON.stringify(req.body);
      headers['content-type'] = 'application/json';
      delete headers['content-length']; // 재직렬화하면 길이가 달라질 수 있다 → fetch 가 다시 계산
    } else {
      body = undefined;
      delete headers['content-length'];
    }
    try {
      const r = await fetch(target, {
        method: req.method,
        headers,
        body,
        ...(body ? { duplex: 'half' } : {}),
        signal: AbortSignal.timeout(30 * 60 * 1000),
        redirect: 'follow',
      });
      const rct = r.headers.get('content-type') || 'application/json';
      const bodyBuf = Buffer.from(await r.arrayBuffer());
      reply.header('Content-Type', rct);
      reply.header('Cache-Control', r.headers.get('cache-control') || 'no-store');
      if (r.headers.get('content-disposition')) reply.header('Content-Disposition', r.headers.get('content-disposition'));
      return reply.code(r.status).send(bodyBuf);
    } catch (e) {
      console.error(`[worker] proxy 실패 ${req.method} ${req.url}: ${e?.message || e} cause=${e?.cause?.message || ''}`);
      logger?.warn(`[worker] proxy 실패 ${req.url}: ${e?.message || e}`);
      return reply.code(503).send({ ok: false, error: `작업 서버 연결 실패: ${e?.message || e}` });
    }
  }

  // SSE 발행용 내부 엔드포인트 (worker -> node). loopback 전용.
  app.post('/internal/publish', async (req, reply) => {
    if (!isLoopback(req.ip)) return reply.code(403).send({ ok: false });
    const { publishLive } = await import('./sse.js');
    const b = req.body || {};
    publishLive(b.topic, b.key);
    return reply.send({ ok: true });
  });

  // 알림 추가 (worker -> node). loopback 전용. notifications.json 은 Node 가 유일한 작성자.
  app.post('/internal/notify', async (req, reply) => {
    if (!isLoopback(req.ip)) return reply.code(403).send({ ok: false });
    const { notifyAddInternal } = await import('./notifyAdd.js');
    const b = req.body || {};
    const rec = await notifyAddInternal(b.kind, b.title, b.message, b.dedupe, b.meta);
    return reply.send({ ok: rec !== null, rec });
  });

  // 관리자 토큰 검증 (worker -> node). 세션은 Node 가 단일 소유.
  app.post('/internal/verify', async (req, reply) => {
    if (!isLoopback(req.ip)) return reply.code(403).send({ ok: false });
    const { verifyToken } = await import('./admin.js');
    const ok = await verifyToken((req.body || {}).token || '');
    return reply.send({ ok });
  });

  return { proxy };
}
