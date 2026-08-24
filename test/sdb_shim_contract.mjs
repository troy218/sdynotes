// 프런트 SDB shim(sdynotes.js 안) ↔ 서버 dbQuery 계약 테스트.
// HTML 에서 shim 블록을 뽑아내 실제로 실행하고, 프런트가 쓰는 호출 패턴
// 그대로가 서버 descriptor 로 직렬화되는지 검증한다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-sdb-shim-'));
process.env.SDY_BASE_DIR = TMP;
process.env.SDY_STORAGE = 'oracle';

const html = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');
const m = html.match(/const SDB=\{[\s\S]*?\n    \};/);
assert.ok(m, 'SDB shim 블록이 sdynotes.js 에 있어야 함');

const { dbQuery } = await import('../server/src/lib/dbstore.js');

// fetch 스텁: shim 이 보내는 요청을 그대로 dbQuery 로 실행 (서버 역할)
let lastBody = null;
globalThis.fetch = async (url, init) => {
  assert.equal(url, '/api/db/query');
  assert.equal(init.headers['x-sdy-db'], '1', 'shim 은 x-sdy-db 헤더를 붙인다');
  lastBody = JSON.parse(init.body);
  const r = await dbQuery(lastBody);
  return {
    ok: !r.error || !('message' in (r.error || {})),
    status: 200,
    json: async () => r,
  };
};

// shim 실행
const SDB = new Function(`${m[0]}; return SDB;`)();
const sb = SDB.createClient();
const ok = (name) => console.log(`  ✓ ${name}`);

// ── 프런트가 실제로 쓰는 패턴 그대로 ────────────────────────────────────
// loadNBs: 노트 목록
let r = await sb.from('notebooks').select('*').order('created_at', { ascending: true });
assert.equal(r.error, null);
assert.ok(Array.isArray(r.data));
assert.equal(lastBody.table, 'notebooks');
assert.equal(lastBody.op, 'select');
assert.deepEqual(lastBody.order, { field: 'created_at', asc: true });
ok('.from(notebooks).select(*).order(created_at,{ascending:true})');

// 미리보기 일괄: in + order
r = await sb.from('memos').select('notebook_id,content,created_at')
  .in('notebook_id', ['a', 'b']).order('created_at');
assert.deepEqual(lastBody.filters, [{ op: 'in', field: 'notebook_id', value: ['a', 'b'] }]);
assert.deepEqual(lastBody.columns, ['notebook_id', 'content', 'created_at']);
ok('.from(memos).select(cols).in(field,[...]).order()');

// 개별 미리보기: eq + order + limit
r = await sb.from('memos').select('*').eq('notebook_id', 'a').order('created_at').limit(1);
assert.deepEqual(lastBody.filters, [{ op: 'eq', field: 'notebook_id', value: 'a' }]);
assert.equal(lastBody.limit, 1);
ok('.from(memos).select(*).eq().order().limit(1)');

// 노트 생성: insert().select().single() → 서버가 만든 행이 data 로
r = await sb.from('notebooks').insert([{ title: '테스트', color: '#fff' }]).select().single();
assert.equal(r.error, null);
assert.ok(r.data && r.data.id, 'single() 은 삽입된 행을 돌려준다');
assert.equal(r.data.title, '테스트');
assert.ok(r.data.created_at);
const nbId = r.data.id;
ok('.from(notebooks).insert([...]).select().single()');

// 본문 저장: insert (반환값 없이)
r = await sb.from('memos').insert([{ notebook_id: nbId, content: '{"pages":[]}', font_size: 16 }]);
assert.equal(r.error, null);
ok('.from(memos).insert([...])');

// 저장 outbox: update().eq()
r = await sb.from('memos').update({ content: '{"pages":[1]}', updated_at: '2026-01-01T00:00:00Z' }).eq('id', 'x');
assert.equal(r.error, null);
assert.equal(lastBody.op, 'update');
ok('.from(memos).update({...}).eq(id,...)');

// 제목 변경
r = await sb.from('notebooks').update({ title: '바뀜', updated_at: '2026-01-01T00:00:00Z' }).eq('id', nbId);
assert.equal(r.error, null);
ok('.from(notebooks).update({...}).eq(id)');

// 삭제
r = await sb.from('notebooks').delete().eq('id', nbId);
assert.equal(r.error, null);
assert.equal(lastBody.op, 'delete');
r = await sb.from('images').delete().eq('public_id', 'img_x.webp');
assert.equal(r.error, null);
ok('.delete().eq(...) — notebooks / images');

// 네트워크 실패 시 error.message 형태 (supabase-js 와 동일하게 소비됨)
globalThis.fetch = async () => { throw new Error('offline'); };
r = await sb.from('notebooks').select('*');
assert.equal(r.data, null);
assert.ok(r.error && r.error.message === 'offline');
ok('실패 응답 {data:null,error:{message}}');

try { await fsp.rm(TMP, { recursive: true, force: true }); } catch { /* */ }
console.log('\nSDB shim ↔ dbQuery 계약: 전체 통과 ✅');
