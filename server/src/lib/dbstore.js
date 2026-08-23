// Oracle 자체 저장소 — 프런트가 예전에 Supabase(notes/memos/images 테이블)로
// 직접 하던 CRUD 를 이 서버 디스크가 대신한다.
//
// 레이아웃: <BASE_DIR>/db/<table>/<row-id>.json  (행 1개 = 파일 1개)
//   - memos.content 처럼 수 MB 짜리 행이 있어도 한 행 저장이 곧 그 파일 하나의
//     원자적 교체라 다른 행을 다시 쓸 필요가 없다.
//   - 목록 쿼리는 디렉토리를 읽어 필요한 만큼만 파싱한다.
//   - 쓰기는 테이블별 락(store.js withLock)으로 직렬화된다.
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DIRS } from './paths.js';
import { readJson, writeJsonAtomic, withLock } from './store.js';

// 프런트 shim 이 쓸 수 있는 테이블 화이트리스트 (그 외는 전부 거절).
export const DB_TABLES = new Set(['notebooks', 'memos', 'images']);

// 프런트에서 저장하는 content 하나가 이보다 크면 거절 (파일 폭주 방지).
export const DB_ROW_MAX_BYTES = 32 * 1024 * 1024;

const FIELD_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const ID_RE = /^[0-9a-zA-Z_-]{1,80}$/;

function tableDir(table) {
  if (!DB_TABLES.has(table)) throw new Error(`허용되지 않은 테이블: ${table}`);
  return path.join(DIRS.db, table);
}

export function dbRowPath(table, id) {
  return path.join(tableDir(table), `${id}.json`);
}

function normRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('행은 객체여야 합니다');
  }
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (!FIELD_RE.test(k)) continue;          // 이상한 필드명은 조용히 버린다
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

async function listRowIds(table) {
  try {
    const names = await fsp.readdir(tableDir(table));
    return names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5));
  } catch {
    return [];
  }
}

export async function dbList(table) {
  const ids = await listRowIds(table);
  const rows = [];
  for (const id of ids) {
    const r = await readJson(dbRowPath(table, id), null);
    if (r && typeof r === 'object') rows.push(r);
  }
  return rows;
}

function matchRow(row, filters) {
  for (const f of filters || []) {
    const val = row[f.field];
    if (f.op === 'in') {
      const arr = Array.isArray(f.value) ? f.value : [f.value];
      if (!arr.some((x) => String(x) === String(val))) return false;
    } else {
      if (String(val) !== String(f.value)) return false;
    }
  }
  return true;
}

function cmpRows(field, asc) {
  return (a, b) => {
    const av = a[field];
    const bv = b[field];
    const an = parseFloat(av);
    const bn = parseFloat(bv);
    let r;
    if (Number.isFinite(an) && Number.isFinite(bn) && String(av).trim() !== '' && String(bv).trim() !== '') {
      r = an < bn ? -1 : an > bn ? 1 : 0;
    } else {
      r = String(av ?? '').localeCompare(String(bv ?? ''));
    }
    return asc ? r : -r;
  };
}

// ── 쿼리 실행기 (routes/db.js 의 descriptor 를 처리) ─────────────────────
// descriptor: { table, op: 'select'|'insert'|'update'|'delete',
//               columns?: [..], filters: [{op:'eq'|'in', field, value}],
//               order?: {field, asc}, limit?: n, single?: bool,
//               values?: row | [rows] }
export async function dbQuery(q) {
  const table = String(q?.table || '');
  const op = String(q?.op || 'select');
  const filters = Array.isArray(q?.filters) ? q.filters.filter((f) => f && FIELD_RE.test(String(f.field))) : [];

  if (!DB_TABLES.has(table)) return { data: null, error: { message: `허용되지 않은 테이블: ${table}` } };
  if (!['select', 'insert', 'update', 'delete'].includes(op)) {
    return { data: null, error: { message: `알 수 없는 연산: ${op}` } };
  }

  try {
    if (op === 'insert') {
      const raw = Array.isArray(q.values) ? q.values : [q.values];
      if (!raw.length) return { data: null, error: { message: '빈 insert' } };
      const inserted = await withLock('db:' + table, async () => {
        const out = [];
        // 같은 배치에서 같은 밀리초로 들어가면 created_at 정렬이 불안정해진다
        // (Supabase 는 timestamptz 마이크로초). 1행당 1ms 씩 밀어 순서를 보존.
        let ts = Date.now();
        for (const item of raw) {
          const row = normRow(item);
          if (!row.id) row.id = crypto.randomUUID();
          else if (!ID_RE.test(String(row.id))) row.id = crypto.randomUUID();
          if (!row.created_at) row.created_at = new Date(ts).toISOString();
          ts += 1;
          const size = Buffer.byteLength(JSON.stringify(row));
          if (size > DB_ROW_MAX_BYTES) throw new Error(`행이 너무 큽니다 (${size}B > ${DB_ROW_MAX_BYTES}B)`);
          await writeJsonAtomic(dbRowPath(table, row.id), row);
          out.push(row);
        }
        return out;
      });
      if (q.returning === false) return { data: null, error: null };
      if (q.single) return { data: inserted[0] ?? null, error: null };
      return { data: inserted, error: null };
    }

    if (op === 'update') {
      const set = normRow(q.values);
      delete set.id;                                  // id 는 못 바꾼다
      if (!Object.keys(set).length) return { data: null, error: { message: '갱신 내용이 비었습니다' } };
      if (!filters.length) return { data: null, error: { message: 'update 는 조건이 필요합니다' } };
      const size = Buffer.byteLength(JSON.stringify(set));
      if (size > DB_ROW_MAX_BYTES) return { data: null, error: { message: `갱신 내용이 너무 큽니다 (${size}B)` } };
      const changed = await withLock('db:' + table, async () => {
        const ids = await listRowIds(table);
        let n = 0;
        for (const id of ids) {
          const p = dbRowPath(table, id);
          const row = await readJson(p, null);
          if (!row || !matchRow(row, filters)) continue;
          await writeJsonAtomic(p, { ...row, ...set });
          n += 1;
        }
        return n;
      });
      return { data: null, error: null, count: changed };
    }

    if (op === 'delete') {
      if (!filters.length) return { data: null, error: { message: 'delete 는 조건이 필요합니다' } };
      const removed = await withLock('db:' + table, async () => {
        const ids = await listRowIds(table);
        let n = 0;
        for (const id of ids) {
          const p = dbRowPath(table, id);
          const row = await readJson(p, null);
          if (!row || !matchRow(row, filters)) continue;
          await fsp.unlink(p).catch(() => {});
          n += 1;
        }
        return n;
      });
      return { data: null, error: null, count: removed };
    }

    // select
    let rows = await dbList(table);
    if (filters.length) rows = rows.filter((r) => matchRow(r, filters));
    if (q.order && FIELD_RE.test(String(q.order.field))) {
      const field = String(q.order.field);
      const asc = q.order.asc !== false;
      const primary = cmpRows(field, asc);
      const tie = cmpRows('id', asc);
      rows = rows.sort((a, b) => primary(a, b) || tie(a, b));
    }
    const limit = parseInt(q.limit || 0, 10) || 0;
    if (limit > 0) rows = rows.slice(0, limit);
    // 열 projection ('a,b,c' 형식만 — 와일드카드/집계는 무시)
    const cols = Array.isArray(q.columns) ? q.columns.map(String).filter((c) => FIELD_RE.test(c)) : null;
    if (cols && cols.length) {
      rows = rows.map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])));
    }
    if (q.single) return { data: rows[0] ?? null, error: rows.length ? null : { message: '행이 0개입니다' } };
    return { data: rows, error: null };
  } catch (e) {
    return { data: null, error: { message: String(e?.message || e) } };
  }
}
