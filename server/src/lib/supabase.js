// Supabase (PostgREST) client. service_role key lives only on the server.
import { SUPABASE_URL, SUPABASE_KEY, sbEnabled, TABLES, SB_TABLES } from './config.js';

export { sbEnabled, TABLES, SB_TABLES };

const TIMEOUT = 8000;

export function headers(prefer) {
  const h = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (prefer) h.Prefer = prefer;
  return h;
}

export function filterId(ident) {
  return encodeURIComponent(String(ident));
}

export function errorText(exc) {
  const s = String(exc?.message || exc || '');
  return s.slice(0, 220);
}

export async function sbGet(table, ident) {
  if (!sbEnabled() || !SB_TABLES.has(table)) return null;
  const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${filterId(ident)}&select=id,data,updated_at`;
  const r = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  const rows = await r.json();
  if (!rows?.length) return null;
  const data = rows[0].data;
  return (data && typeof data === 'object') ? data : {};
}

export async function sbRows(table) {
  if (!sbEnabled() || !SB_TABLES.has(table)) return [];
  const out = [];
  const step = 1000;
  for (let start = 0; start < 10000; start += step) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=id,data,updated_at&order=updated_at.asc&limit=${step}&offset=${start}`;
    const r = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(TIMEOUT) });
    if (!r.ok) throw new Error(`supabase ${r.status}`);
    const page = await r.json();
    out.push(...(page || []));
    if ((page || []).length < step) break;
  }
  return out;
}

export async function sbPut(table, ident, data) {
  if (!sbEnabled() || !SB_TABLES.has(table)) throw new Error('Supabase 서비스 키가 없습니다');
  if (!data || typeof data !== 'object') throw new Error('cloud state must be an object');
  const row = { id: String(ident), data, updated_at: new Date().toISOString() };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, {
    method: 'POST',
    headers: headers('resolution=merge-duplicates,return=representation'),
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  const body = await r.json().catch(() => []);
  return Array.isArray(body) ? (body[0] || {}) : {};
}

export async function sbDelete(table, ident) {
  if (!sbEnabled() || !SB_TABLES.has(table)) throw new Error('Supabase 서비스 키가 없습니다');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${filterId(ident)}`, {
    method: 'DELETE',
    headers: headers('return=minimal'),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
}
