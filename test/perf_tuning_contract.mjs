// 14.13.5 · 2코어/12GB 박스 성능 튜닝 계약
//   ① @fastify/compress — JSON 응답 압축 (브로틀리 우선/gzip 폴백, 바이너리는 그대로)
//   ② syncEngine 캐시 — lib/perf.js 한계 사용, TTL 만료 후에도 데이터 정확
//   ③ dbstore — 행 파일 유계 병렬 읽기 (40행 정합)
//   ④ page.js — 버전화된 sdynotes.js/css 는 immutable 장기 캐시
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

// 격리 앱 루트 (paths.js import 전) — dbstore/syncEngine 은 여기
const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-perf-'));
process.env.SDY_BASE_DIR = TMP;
process.env.SDY_STORAGE = 'oracle';
// syncEngine 캐시는 작게/짧게 → TTL 만료 경로까지 검증
process.env.SDY_SYNC_CACHE_MAX = '3';
process.env.SDY_SYNC_CACHE_TTL_MS = '150';

// 페이지 에셋 테스트용: 실제 프런트 파일을 임시 루트에 복사
for (const f of ['sdynotes.html', 'sdynotes.js', 'sdynotes.css']) {
  fs.copyFileSync(path.join(REPO, f), path.join(TMP, f));
}

const Fastify = (await import('fastify')).default;
const compress = (await import('@fastify/compress')).default;
const { compressOptions, noCompressForBinaryRoutes } = await import('../server/src/lib/perf.js');

let pass = 0;
const ok = (name) => { pass++; console.log(`  ✓ ${name}`); };

// ═══  응답 압축 ═══════════════════════════════════════════════════════
// (브라우저처럼 자동 decompress 해 주는 fetch 가 아니라 raw TCP 로 실제 와이어
//  바이트를 검사한다 — content-encoding 헤더 + 압축본이 그대로 와야 한다)
import net from 'node:net';
function rawGet(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const lines = [`GET ${path} HTTP/1.1`, 'Host: 127.0.0.1', ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), 'Connection: close', '', ''];
    const sock = net.connect(port, '127.0.0.1', () => sock.write(lines.join('\r\n')));
    const chunks = [];
    sock.on('data', (c) => chunks.push(c));
    sock.on('end', () => {
      const all = Buffer.concat(chunks);
      const hidx = all.indexOf('\r\n\r\n');
      const headerText = all.slice(0, hidx).toString();
      const h = (n) => { const m = new RegExp(`^${n}: (.*)$`, 'mi').exec(headerText); return m ? m[1] : null; };
      let body = all.slice(hidx + 4);
      if (/^chunked$/i.test(h('Transfer-Encoding') || '')) {
        const out = [];
        let i = 0;
        while (i < body.length) {
          const eol = body.indexOf('\r\n', i);
          const size = parseInt(body.slice(i, eol).toString(), 16);
          if (!Number.isFinite(size)) break;
          out.push(body.slice(eol + 2, eol + 2 + size));
          i = eol + 2 + size + 2;
          if (size === 0) break;
        }
        body = Buffer.concat(out);
      } else {
        const cl = parseInt(h('Content-Length') || '0', 10);
        if (cl) body = body.slice(0, cl);
      }
      resolve({ status: /HTTP\/1\.1 (\d+)/.exec(headerText)[1], headers: h, body });
    });
    sock.on('error', reject);
  });
}

const app = Fastify({ logger: false });
app.addHook('onRoute', noCompressForBinaryRoutes());   // index.js 와 동일한 순서
await app.register(compress, compressOptions());
app.get('/json', async () => ({ hello: 'sdynotes', pad: 'x'.repeat(4096) }));
app.get('/tiny', async () => ({ ok: true }));
app.get('/api/img/sample.bin', async (req, reply) => {   // BINARY_ROUTES 에 걸리는 경로
  reply.type('application/octet-stream');
  return Buffer.alloc(4096, 7);
});
await app.listen({ port: 0, host: '127.0.0.1' });
const PORT = app.server.address().port;

// 브라우저 헤더 → brotli 우선, 본문은 진짜 압축본
let r = await rawGet(PORT, '/json', { 'Accept-Encoding': 'gzip, deflate, br' });
assert.equal(r.headers('Content-Encoding'), 'br', '브라우저 헤더 → br 우선');
assert.equal(JSON.parse(zlib.brotliDecompressSync(r.body).toString()).hello, 'sdynotes');
ok('JSON 응답은 브로틀리로 압축 전송 (와이어 확인)');

// gzip만 받는 클라이언트
r = await rawGet(PORT, '/json', { 'Accept-Encoding': 'gzip' });
assert.equal(r.headers('Content-Encoding'), 'gzip');
assert.equal(JSON.parse(zlib.gunzipSync(r.body).toString()).hello, 'sdynotes');
ok('gzip 폴백 클라이언트 대응');

// 512B 미만 → 압축 생략 (CPU 절약)
r = await rawGet(PORT, '/tiny', { 'Accept-Encoding': 'gzip, br' });
assert.equal(r.headers('Content-Encoding'), null, '미미한 페이로드는 압축 생략');
ok('threshold 이하 페이로드는 압축 생략');

// 바이너리(파일/음성/이미지 스트림) → 그대로 (onRoute 에서 compress:false)
r = await rawGet(PORT, '/api/img/sample.bin', { 'Accept-Encoding': 'gzip, br' });
assert.equal(r.headers('Content-Encoding'), null, '바이너리 라우트는 압축 제외');
assert.equal(r.body.length, 4096);
ok('바이너리 스트림은 그대로 전송');

// accept-encoding 없는 클라이언트 → 원본
r = await rawGet(PORT, '/json', {});
assert.equal(r.headers('Content-Encoding'), null);
assert.equal(r.body.length > 4000, true, '원본 JSON 그대로');
ok('accept-encoding 없는 클라이언트는 원본 전송');

await app.close();

await app.close();

// ═══ ② syncEngine 캐시 ═════════════════════════════════════════════════
const { syncPush, syncPull, syncCacheInvalidate } = await import('../server/src/lib/syncEngine.js');
const { SETTINGS_SCHEMA } = await import('../server/src/lib/config.js');

// 3개 nb push → 캐시 한계(3) 안에서 순환
for (const k of ['nb-a', 'nb-b', 'nb-c', 'nb-d']) {
  const res = await syncPush({ nb: k, schema: SETTINGS_SCHEMA, ops: [{ id: 't1', rev: 1, data: { type: 'text', html: `hello ${k}` } }] });
  assert.equal(res.body.ok, true, `${k} push 성공`);
}
// 직전 push 직후 pull → 캐시에서 바로 (정확한 데이터)
let pr = await syncPull('nb-d', 0);
assert.equal(pr.body.ops.length, 1);
assert.equal(pr.body.ops[0].data.html, 'hello nb-d');
ok('push 직후 pull 은 최신 상태 반환 (캐시 갱신)');

// TTL(150ms) 만료 대기 → 캐시 이탈 후 디스크 재읽기, 데이터는 그대로
await new Promise((res) => setTimeout(res, 220));
pr = await syncPull('nb-d', 0);
assert.equal(pr.body.ops.length, 1, 'TTL 만료 후에도 동일 상태');
assert.equal(pr.body.ops[0].data.html, 'hello nb-d');
ok('TTL 만료 후 디스크 재읽기로도 데이터 정확');

// ═══  dbstore 병렬 읽기 ══════════════════════════════════════════════
const { dbQuery } = await import('../server/src/lib/dbstore.js');
const N = 40;
const rows = Array.from({ length: N }, (_, i) => ({
  id: `perf-${i.toString().padStart(3, '0')}`,
  title: `노트 ${i}`,
  seq: i,
  content: 'payload'.repeat(200),   // 행 1개 ~1.4KB × 40
}));
let ir = await dbQuery({ table: 'notebooks', op: 'insert', values: rows });
assert.equal(ir.error, null, '40행 병렬 insert');
assert.equal(ir.data.length, N);

let sr = await dbQuery({ table: 'notebooks', op: 'select', order: { field: 'seq', asc: true } });
assert.equal(sr.error, null, 'select');
assert.equal(sr.data.length, N, '40행 전부 반환');
assert.equal(sr.data[0].title, '노트 0');
assert.equal(sr.data[N - 1].title, `노트 ${N - 1}`);
assert.equal(sr.data[5].content, 'payload'.repeat(200), '행 내용 무손상');
ok('40행 유계 병렬 읽기 — 순서·내용 무손상');

let ur = await dbQuery({
  table: 'notebooks', op: 'update',
  filters: [{ op: 'in', field: 'seq', value: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }],
  values: { tag: 'perf' },
});
assert.equal(ur.error, null, 'update(필터)');
assert.equal(ur.count, 10, '10행 갱신');
sr = await dbQuery({ table: 'notebooks', op: 'select', filters: [{ op: 'eq', field: 'tag', value: 'perf' }] });
assert.equal(sr.data.length, 10, '갱신된 행 조회');
ok('병렬 스캔 기반 update — 조건·카운트 정확');

// ═══ ④ 페이지 에셋 캐시 ════════════════════════════════════════════════
const { registerPages } = await import('../server/src/routes/pages.js');
const app2 = Fastify({ logger: false });
registerPages(app2);
await app2.listen({ port: 0, host: '127.0.0.1' });
const P2 = app2.server.address().port;

r = await fetch(`http://127.0.0.1:${P2}/sdynotes.js`, { headers: { 'Accept-Encoding': 'gzip' } });
assert.equal(r.status, 200);
assert.match(r.headers.get('cache-control'), /immutable/, 'sdynotes.js → immutable');
assert.equal(r.headers.get('content-encoding'), 'gzip', '사전 gzip 유지');
const etag = r.headers.get('etag');
r = await fetch(`http://127.0.0.1:${P2}/sdynotes.js`, { headers: { 'If-None-Match': etag } });
assert.equal(r.status, 304, 'ETag 재확인 304');
assert.match(r.headers.get('cache-control'), /immutable/, '304 도 immutable');
ok('버전화된 프런트 에셋: 장기 캐시(immutable) + gzip + ETag 304');

// HTML 은 여전히 no-cache (버전을 싣는 페이지)
r = await fetch(`http://127.0.0.1:${P2}/`);
assert.match(r.headers.get('cache-control'), /no-cache/, 'HTML 은 no-cache 유지');
ok('HTML(버전 페이지)은 no-cache 유지');

await app2.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n성능 튜닝 계약: PASS ${pass}`);
