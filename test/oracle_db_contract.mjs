// Oracle 자체 저장소 계약 테스트 — dbstore/db 라우트(프런트 Supabase 대체)와
// 프런트 shim, 노트 이미지 로컬 저장 경로를 검증한다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// ── 격리된 앱 루트 준비 (SDY_BASE_DIR 는 paths.js import 전에 설정) ──────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-oracle-db-'));
process.env.SDY_BASE_DIR = TMP;
process.env.SDY_STORAGE = 'oracle';

const { dbQuery, DB_TABLES } = await import('../server/src/lib/dbstore.js');
const { registerDb } = await import('../server/src/routes/db.js');
const { registerPages } = await import('../server/src/routes/pages.js');
const Fastify = (await import('fastify')).default;

const app = Fastify({ logger: false });
await app.register((await import('@fastify/multipart')).default, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
registerDb(app);
registerPages(app);
await app.ready();

const ok = (name) => console.log(`  ✓ ${name}`);

// ── 1. dbQuery 기본 계약 (프런트 shim 이 쓰는 그대로) ───────────────────
let r = await dbQuery({ table: 'notebooks', op: 'insert', values: [{ title: '내 노트', color: '#4f6ef7' }], single: true });
assert.equal(r.error, null, 'insert 에러 없음');
assert.match(r.data.id, /^[0-9a-f-]{36}$/, '서버가 uuid 부여');
assert.equal(r.data.title, '내 노트');
assert.ok(r.data.created_at, 'created_at 자동 부여');
const nb1 = r.data;

r = await dbQuery({ table: 'notebooks', op: 'insert', values: [{ title: '두번째' }] });
assert.equal(r.error, null);
assert.equal(r.data.length, 1);
const nb2 = r.data[0];

r = await dbQuery({ table: 'notebooks', op: 'select', order: { field: 'created_at', asc: true } });
assert.equal(r.data.length, 2);
assert.equal(r.data[0].id, nb1.id, 'created_at 오름차순');
ok('notebooks insert/select/order');

r = await dbQuery({ table: 'notebooks', op: 'select', single: true, filters: [{ op: 'eq', field: 'id', value: nb2.id }] });
assert.equal(r.data.id, nb2.id);
ok('select .eq().single()');

// memos — 대용량 content + projection + in 필터
const bigContent = JSON.stringify({ pages: [{ els: [{ type: 'text', html: 'x'.repeat(120000) }] }] });
r = await dbQuery({ table: 'memos', op: 'insert', values: [
  { notebook_id: nb1.id, content: bigContent, font_size: 16 },
  { notebook_id: nb2.id, content: '{"pages":[]}', font_size: 16 },
] });
assert.equal(r.error, null);
r = await dbQuery({ table: 'memos', op: 'select', columns: ['notebook_id', 'content', 'created_at'],
  filters: [{ op: 'in', field: 'notebook_id', value: [nb1.id, nb2.id] }], order: { field: 'created_at', asc: true } });
assert.equal(r.data.length, 2);
assert.ok(!('font_size' in r.data[0]), 'projection — 요청한 열만');
const m1 = r.data.find((x) => x.notebook_id === nb1.id);
assert.equal(m1.content, bigContent, '대용량 content 보존');
ok('memos insert / .in() / projection');

r = await dbQuery({ table: 'memos', op: 'update', values: { content: '{"pages":[2]}', updated_at: '2026-01-02T00:00:00Z' },
  filters: [{ op: 'eq', field: 'notebook_id', value: nb2.id }] });
assert.equal(r.error, null);
r = await dbQuery({ table: 'memos', op: 'select', filters: [{ op: 'eq', field: 'notebook_id', value: nb2.id }], limit: 1 });
assert.equal(JSON.parse(r.data[0].content).pages[0], 2, 'update 반영');
ok('memos update .eq()');

// 방어: 화이트리스트 밖 테이블 / 조건 없는 delete / id 변경 시도
assert.equal((await dbQuery({ table: 'pg_catalog', op: 'select' })).error.message, '허용되지 않은 테이블: pg_catalog');
assert.notEqual((await dbQuery({ table: 'notebooks', op: 'delete' })).error, null, '조건 없는 delete 금지');
r = await dbQuery({ table: 'notebooks', op: 'update', values: { id: 'hacked' }, filters: [{ op: 'eq', field: 'id', value: nb1.id }] });
r = await dbQuery({ table: 'notebooks', op: 'select', filters: [{ op: 'eq', field: 'id', value: nb1.id }], single: true });
assert.equal(r.data.id, nb1.id, 'id 는 변경 불가');
ok('화이트리스트/안전장치');

// delete + images 테이블 (프런트 purgeElements 가 쓰는 경로)
r = await dbQuery({ table: 'images', op: 'insert', values: [{ public_id: 'img_abc.webp', url: '/api/img/img_abc.webp' }] });
r = await dbQuery({ table: 'images', op: 'delete', filters: [{ op: 'eq', field: 'public_id', value: 'img_abc.webp' }] });
assert.equal(r.error, null);
r = await dbQuery({ table: 'images', op: 'select' });
assert.equal(r.data.length, 0);
ok('images delete (자원 정리 경로)');

// ── 2. HTTP 라우트 — x-sdy-db 헤더 게이트 ──────────────────────────────
let res = await app.inject({ method: 'POST', url: '/api/db/query', payload: { table: 'notebooks', op: 'select' } });
assert.equal(res.statusCode, 403, '헤더 없으면 거절');
res = await app.inject({ method: 'POST', url: '/api/db/query', headers: { 'x-sdy-db': '1' },
  payload: { table: 'notebooks', op: 'select', order: { field: 'created_at', asc: false } } });
assert.equal(res.statusCode, 200);
assert.equal(res.json().data.length, 2);
ok('POST /api/db/query 헤더 게이트 + 동작');

// 행 파일 레이아웃: db/<table>/<id>.json
assert.ok(fs.existsSync(path.join(TMP, 'db', 'notebooks', `${nb1.id}.json`)));
ok('파일 레이아웃 db/<table>/<id>.json');

// ── 3. 노트 이미지 로컬 저장 (/api/upload → /api/img) ───────────────────
// 1x1 webp 버퍼
const webp = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
res = await app.inject({
  method: 'POST', url: '/api/upload',
  headers: { 'content-type': 'multipart/form-data; boundary=xx' },
  payload: Buffer.from([
    '--xx\r\nContent-Disposition: form-data; name="quality"\r\n\r\n78\r\n',
    '--xx\r\nContent-Disposition: form-data; name="file"; filename="a.webp"\r\nContent-Type: image/webp\r\n\r\n',
  ].join('') + webp.toString('binary') + '\r\n--xx--\r\n', 'binary'),
});
// (multipart payload 를 바이너리로 조립 — sharp 가 webp 통과)
assert.equal(res.statusCode, 200, `/api/upload 응답: ${res.body}`);
const up = res.json();
assert.match(up.url, /^\/api\/img\/img_[0-9a-f]{12}\.webp$/, `로컬 URL: ${up.url}`);
assert.equal(up.public_id, up.url.split('/').pop());
assert.ok(fs.existsSync(path.join(TMP, 'imported', up.url.split('/').pop())), '파일이 imported/ 에 저장됨');
ok('/api/upload 로컬 저장');

res = await app.inject({ method: 'GET', url: up.url });
assert.equal(res.statusCode, 200);
assert.equal(res.headers['content-type'], 'image/webp');
assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
ok('/api/img/:file 서빙 + immutable 캐시');

// 삭제 — public_id 로
res = await app.inject({ method: 'POST', url: '/api/delete', payload: { public_id: up.public_id } });
assert.equal(res.statusCode, 200);
assert.ok(!fs.existsSync(path.join(TMP, 'imported', up.public_id)), '파일 삭제됨');
res = await app.inject({ method: 'GET', url: up.url });
assert.equal(res.statusCode, 404);
ok('/api/delete (로컬 파일 제거)');

// 경로 조작 방어
res = await app.inject({ method: 'GET', url: '/api/img/..%2F..%2Fpackage.json' });
assert.notEqual(res.statusCode, 200);
ok('/api/img 경로 조작 방어');

// ── 4. 프런트 shim 계약 ─────────────────────────────────────────────────
const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
assert.ok(html.includes('SDB.createClient'), '로컬 DB shim 존재');
assert.ok(!html.includes('cdn.jsdelivr.net/npm/@supabase/supabase-js'), 'Supabase CDN 제거됨');
assert.ok(!html.includes('api.cloudinary.com'), 'Cloudinary 직접 업로드 제거됨');
assert.ok(!html.includes('xillsulrehkpuzyuhgcn'), 'Supabase 프로젝트 URL/키 제거됨');
for (const m of ['select(', 'single()', 'eq(', 'in(', 'order(', 'limit(', 'insert(', 'update(', 'delete(']) {
  assert.ok(html.includes(`                    ${m}`) || html.includes(m), `shim 메서드 ${m}`);
}
ok('프런트 shim — CDN/키 제거 + 체인 메서드 구비');

// ── 5. 설정 게이트 — oracle 기본에서는 원격 클라우드 비활성 ──────────────
const cfg = await import('../server/src/lib/config.js');
assert.equal(cfg.oracleStorage(), true);
assert.equal(cfg.sbEnabled(), false, 'oracle 모드에선 sbEnabled() 거짓');
assert.equal(cfg.CLOUD_READY, false, 'oracle 모드에선 CLOUD_READY 거짓');
ok('SDY_STORAGE 기본 oracle — 원격 클라우드 게이트 완전 차단');

await app.close();
try { await fsp.rm(TMP, { recursive: true, force: true }); } catch { /* */ }
console.log('\nOracle 저장소 계약 테스트: 전체 통과 ✅');
