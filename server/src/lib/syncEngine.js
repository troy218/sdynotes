// Element-level LWW sync engine (settings + notes). Port of sync.py +
// cloud_routes sync state helpers. Durable store = Supabase when enabled,
// local JSON file otherwise.
import path from 'node:path';
import { DIRS } from './paths.js';
import { SETTINGS_SCHEMA, APP_VERSION } from './config.js';
import { sbGet, sbPut, sbEnabled } from './supabase.js';
import { readJson, writeJsonAtomic, withLock } from './store.js';
import { mergeText3 } from './textmerge.js';

export function syncPath(nb) {
  return path.join(DIRS.sync, String(nb).replace(/[^0-9a-zA-Z-]/g, '') + '.json');
}

// 짧은 메모리 캐시. 여러 기기가 같은 노트를 동시에 편집하면 1초에도 여러 번
// pullSync(전체 상태 getState)이 돈다. Supabase 모드에선 매번 원격에서 문서
// 전체를 받아오고, 로컬 모드도 파일 전체를 JSON.parse 한다. 12GB 박스에서도
// 이 반복이 CPU/대역폭을 잡아먹어 협업 입력이 밀릴 수 있다.
// push 는 즉시 캐시를 갱신하고, pull 은 아주 짧은 TTL(=최대 지연) 안에서
// 캐시를 재사용한다.
const STATE_CACHE = new Map(); // nb -> {state, at}
const LOCAL_TTL = 700;
const SB_TTL = 1500;

function cacheGet(nb) {
  const hit = STATE_CACHE.get(nb);
  if (!hit) return null;
  const ttl = sbEnabled() ? SB_TTL : LOCAL_TTL;
  if (Date.now() - hit.at > ttl) return null;
  return hit.state;
}

function cacheSet(nb, state) {
  STATE_CACHE.set(nb, { state, at: Date.now() });
  if (STATE_CACHE.size > 200) STATE_CACHE.delete(STATE_CACHE.keys().next().value);
}

export function syncCacheInvalidate(nb) {
  STATE_CACHE.delete(nb);
}

export async function getState(nb) {
  const cached = cacheGet(nb);
  if (cached) return cached;
  if (sbEnabled()) {
    try {
      const s = (await sbGet('sdy_sync_states', nb)) || {};
      cacheSet(nb, s);
      return s;
    } catch (e) { throw e; }
  }
  const s = await readJson(syncPath(nb), {});
  cacheSet(nb, s);
  return s;
}

export async function putState(nb, state) {
  cacheSet(nb, state);
  if (sbEnabled()) {
    await sbPut('sdy_sync_states', nb, state);
    return;
  }
  await writeJsonAtomic(syncPath(nb), state);
}

// Push: apply ops with per-key LWW. Returns {ok, version, accepted, rejected, blocked}
export async function syncPush(body) {
  const nb = String(body.nb || '');
  let ops = body.ops || [];
  if (!nb) return { status: 400, body: { ok: false, error: 'nb 없음' } };

  const isSettings = String(nb).startsWith('__settings');
  if (isSettings) {
    const clientSchema = parseInt(body.schema || 0, 10) || 0;
    if (clientSchema !== SETTINGS_SCHEMA) {
      return {
        status: 409,
        body: {
          ok: false, stale: true, schema: SETTINGS_SCHEMA, version: APP_VERSION,
          error: '업데이트 전 화면이라 설정을 저장하지 않았습니다. 새로고침 해 주세요',
        },
      };
    }
  }
  if (!ops || !Array.isArray(ops)) return { status: 400, body: { ok: false, error: 'ops 형식 오류' } };
  if (!ops.length) return { status: 200, body: { ok: true, version: 0 } };

  // bulk-delete firewall
  let blocked = [];
  if (isSettings) {
    const limits = { bookmark: 4, playlist: 4, folder: 4 };
    const counts = {};
    for (const op of ops) {
      if (op.kind !== 'del') continue;
      const kind = String(op.id || '').split(':')[0];
      if (kind in limits) counts[kind] = (counts[kind] || 0) + 1;
    }
    const bad = Object.keys(counts).filter((k) => counts[k] > limits[k]);
    if (bad.length) {
      const keep = [];
      for (const op of ops) {
        if (op.kind === 'del') { blocked.push(op.id); continue; }
        keep.push(op);
      }
      ops = keep;
    }
  }

  try {
    return await withLock('sync:' + nb, async () => {
      const state = await getState(nb);
      const els = state.els || (state.els = {});
      const accepted = [];
      const rejected = [];
      for (const op of ops) {
        const oid = String(op.id || '').slice(0, 240);
        if (!oid) continue;
        const rev = parseFloat(op.rev || 0);
        if (!Number.isFinite(rev)) continue;
        const cur = els[oid];
        if (cur && parseFloat(cur.rev || 0) >= rev) {
          rejected.push(oid);
          continue;
        }
        if (op.kind === 'del') {
          els[oid] = { rev, dev: op.dev, del: 1 };
        } else if (op.kind === 'pages') {
          state.pages = { rev, ids: op.ids || [] };
        } else {
          // 14.9 · 텍스트 op 는 최근 버전들(hist, 유계)을 보관한다. 같은 공통
          //  조상에서 갈라진 동시 편집(prevRev 가 hist 에 존재)이면 서버가 3-way
          //  병합해 양쪽 편집을 모두 남긴다. (prevRev 미전송 = 옛 클라이언트 → LWW)
          const HIST_MAX = 4;
          const isCurText = cur && !cur.del && cur.data && typeof cur.data === 'object' && cur.data.type === 'text';
          const curHtml = isCurText ? String(cur.data.html || '') : '';
          let data = op.data;
          const prevRev = parseFloat(op.prevRev);
          let hist = (cur && Array.isArray(cur.hist)) ? cur.hist.slice() : [];
          if (Number.isFinite(prevRev) && isCurText && data && typeof data === 'object' && data.type === 'text') {
            const curRev = parseFloat(cur.rev || 0);
            if (prevRev !== curRev) {
              const anc = hist.find((h) => parseFloat(h.rev || 0) === prevRev);
              if (anc && typeof anc.html === 'string') {
                // 동시 편집 → 3-way 병합 (base=공통 조상). 결정적 결과로 양 기기 수렴.
                const mine = String(data.html || '');
                const theirs = String(cur.data.html || '');
                const lo = mine <= theirs ? mine : theirs;
                const hi = mine <= theirs ? theirs : mine;
                data = { ...data, html: mergeText3(anc.html, lo, hi) };
              }
            }
            hist.push({ rev: curRev, html: curHtml });
            if (hist.length > HIST_MAX) hist = hist.slice(hist.length - HIST_MAX);
            els[oid] = { rev, dev: op.dev, page: op.page || 0, data, hist };
          } else {
            els[oid] = { rev, dev: op.dev, page: op.page || 0, data };
          }
        }
        accepted.push(oid);
      }
      const revs = Object.values(els).map((v) => parseFloat(v.rev || 0));
      revs.push(parseFloat((state.pages || {}).rev || 0), 0);
      const ver = Math.max(...revs);
      state.version = ver;
      await putState(nb, state);
      return { status: 200, body: { ok: true, version: ver, accepted, rejected, blocked } };
    });
  } catch (e) {
    if (!sbEnabled()) {
      // should not happen in local mode, but keep original fallback semantics
      return { status: 200, body: { ok: false, error: `sync failed: ${e.message}` } };
    }
    return { status: 502, body: { ok: false, error: `Supabase 동기화 연결 실패: ${e.message}` } };
  }
}

export async function syncPull(nb, since) {
  if (!nb) return { status: 200, body: { ok: true, ops: [], pages: null, version: 0 } };
  try {
    const state = await getState(nb);
    const els = state.els || {};
    const ops = Object.entries(els)
      .filter(([, v]) => parseFloat(v.rev || 0) > since)
      .map(([id, v]) => {
        const o = { id, ...v };
        delete o.hist;   // 병합용 서버 내부 히스토리는 클라이언트로 보내지 않는다
        return o;
      });
    let pages = state.pages;
    if (!pages || parseFloat(pages.rev || 0) <= since) pages = null;
    return { status: 200, body: { ok: true, ops, pages, version: parseFloat(state.version || 0) } };
  } catch (e) {
    if (!sbEnabled()) return { status: 200, body: { ok: true, ops: [], pages: null, version: 0 } };
    return { status: 502, body: { ok: false, error: `Supabase 동기화 연결 실패: ${e.message}` } };
  }
}
