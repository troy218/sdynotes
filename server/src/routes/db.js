// 로컬 DB API — 프런트의 Supabase 직접 접속을 이 Oracle 서버로 대체한다.
// 프런트 shim(sdynotes.html 의 SDB) 이 supabase-js 와 같은 체인을
// {table, op, filters, ...} descriptor 로 직렬화해 POST 한다.
import { dbQuery, DB_TABLES } from '../lib/dbstore.js';

export function registerDb(app) {
  app.get('/api/db/status', async (req, reply) => {
    return reply.send({ ok: true, storage: 'oracle', tables: [...DB_TABLES] });
  });

  app.post('/api/db/query', async (req, reply) => {
    // 같은 오리진(이 앱을 내려준 서버)에서 온 요청만 받는다.
    // 예전엔 anon 키가 HTML 에 박혀 있어 사실상 무방비였다 — 이 헤더 검사로
    // 우연히 딸려온 교차 사이트 요청 정도는 걸러진다.
    if (req.headers['x-sdy-db'] !== '1') {
      return reply.code(403).send({ data: null, error: { message: '금지된 요청' } });
    }
    const q = req.body || {};
    if (!q || typeof q !== 'object') {
      return reply.code(400).send({ data: null, error: { message: '쿼리 형식 오류' } });
    }
    const r = await dbQuery(q);
    if (r.error && /허용되지 않은 테이블|알 수 없는 연산/.test(r.error.message || '')) {
      return reply.code(400).send(r);
    }
    return reply.send(r);
  });
}
