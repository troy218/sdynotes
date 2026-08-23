// 버전/헬스/보관함 사용량/저장소 상태.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { APP_VERSION, SETTINGS_SCHEMA, QUOTA_BYTES, CLOUD_READY, STORAGE_MODE, TABLES, SUPABASE_URL, sbEnabled } from '../lib/config.js';
import { requireAdmin } from '../lib/admin.js';
import { readJson } from '../lib/store.js';
import { FILES, DIRS, BASE_DIR } from '../lib/paths.js';
import { pageEtag } from '../lib/page.js';

export function registerMisc(app) {
  app.get('/api/version', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return reply.send({ ok: true, version: APP_VERSION, schema: SETTINGS_SCHEMA, page: pageEtag() });
  });

  app.get('/api/health', async (req, reply) => {
    return reply.send({ status: 'ok', version: APP_VERSION, schema: SETTINGS_SCHEMA, heif_support: true });
  });

  app.get('/api/storage/info', async (req, reply) => {
    if (!requireAdmin(req, req.query || {})) return reply.code(403).send({ error: '관리자 인증이 필요합니다' });
    let used = 0;
    let files = 0;
    for (const rec of Object.values(await readJson(FILES.vaultMeta, {}))) {
      used += parseInt(rec.bytes || 0, 10) || 0;
      files += 1;
    }
    let stk = 0;
    for (const rec of Object.values(await readJson(FILES.stickerMeta, {}))) {
      stk += parseInt(rec.bytes || 0, 10) || 0;
    }
    const total = QUOTA_BYTES;
    let freeDisk = null;
    try {
      const st = fs.statfsSync(BASE_DIR);
      freeDisk = st.bavail * st.bsize;
    } catch { /* ignore */ }
    return reply.send({
      ok: true, used, stickers: stk, files, total,
      free: Math.max(0, total - used - stk),
      disk_free: freeDisk,
      storage: CLOUD_READY ? 'cloudinary' : 'oracle',
    });
  });

  app.get('/api/cloud/status', async (req, reply) => {
    // oracle 모드(기본): 이 서버 디스크가 영구 저장소다. 외부 클라우드는
    // 아예 조회하지 않는다(쿼터/과금 이슈 원천 차단).
    if (STORAGE_MODE !== 'cloud') {
      let rows = 0;
      let bytes = 0;
      const addDir = async (dir, recursive) => {
        try {
          for (const n of await fsp.readdir(dir)) {
            const p = path.join(dir, n);
            let st = null;
            try { st = await fsp.stat(p); } catch { /* */ }
            if (!st) continue;
            if (st.isDirectory()) {
              if (recursive) await addDir(p, false);
              continue;
            }
            rows += 1;
            bytes += st.size;
          }
        } catch { /* no dir yet */ }
      };
      for (const dir of [DIRS.sync, DIRS.cards, DIRS.stickers, DIRS.wallpaper, DIRS.vault, DIRS.music]) {
        await addDir(dir, false);
      }
      await addDir(DIRS.db, true);   // db/<table>/<row>.json
      return reply.send({
        ok: true,
        storage: 'oracle',
        supabase: false,
        cloudinary: false,
        schema: true,
        durable: true,
        mode: 'oracle',
        local: { files: rows, bytes },
        tables: { settings: TABLES.sync, cards: TABLES.cards, music: TABLES.music, stickers: TABLES.stickers },
      });
    }
    const enabled = sbEnabled();
    let probes = {};
    if (enabled) {
      // light probe of the three durable tables
      for (const [name, table] of Object.entries({ settings: TABLES.sync, cards: TABLES.cards, music: TABLES.music, stickers: TABLES.stickers })) {
        try {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id&limit=0`, {
            headers: { apikey: process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '' },
            signal: AbortSignal.timeout(3000),
          });
          probes[table] = r.ok;
        } catch { probes[table] = false; }
      }
    }
    const schemaOk = enabled && Object.values(probes).every(Boolean);
    return reply.send({
      ok: true,
      storage: 'cloud',
      supabase: enabled,
      cloudinary: CLOUD_READY,
      schema: schemaOk,
      durable: enabled && CLOUD_READY && schemaOk,
      mode: 'cloud',
      tables: { settings: TABLES.sync, cards: TABLES.cards, music: TABLES.music, stickers: TABLES.stickers },
    });
  });
}
