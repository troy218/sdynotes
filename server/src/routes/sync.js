// 설정/문서 동기화 (요소 단위 LWW).
import { syncPush, syncPull, syncCacheInvalidate } from '../lib/syncEngine.js';
import { publishLive } from '../lib/sse.js';

export function registerSync(app) {
  app.post('/api/sync/push', async (req, reply) => {
    const body = req.body || {};
    const r = await syncPush(body);
    if (r.status === 200 && r.body?.ok && (r.body.accepted?.length || 0) > 0) {
      const nb = String(body.nb || '');
      // 다른 기기가 SSE 를 받고 즉시 pull 하므로, push 후엔 캐시를 지워
      // 갓 저장한 상태를 곧바로 받아가게 한다.
      syncCacheInvalidate(nb);
      publishLive(String(nb).startsWith('__settings') ? 'settings' : 'notes', nb);
    }
    return reply.code(r.status).send(r.body);
  });

  app.get('/api/sync/pull', async (req, reply) => {
    const nb = String(req.query.nb || '');
    let since = parseFloat(req.query.since || '0');
    if (!Number.isFinite(since)) since = 0;
    const r = await syncPull(nb, since);
    return reply.code(r.status).send(r.body);
  });
}
