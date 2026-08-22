// 관리자 파일 보관함 (Cloudinary or local disk).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DIRS, FILES } from '../lib/paths.js';
import { CLOUD_READY } from '../lib/config.js';
import { requireAdmin } from '../lib/admin.js';
import { readJson, writeJsonAtomic, withLock, nowISO } from '../lib/store.js';
import { uploadStream, destroy, cldDlUrl } from '../lib/cloudinary.js';

const VAULT_FOLDER = 'sdy_vault';

const vaultKind = (filename) => {
  const ext = (String(filename).split('.').pop() || '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'heic', 'heif', 'avif', 'tiff'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'].includes(ext)) return 'video';
  return 'raw';
};

const metaLoad = () => readJson(FILES.vaultMeta, {});
const metaSave = (m) => writeJsonAtomic(FILES.vaultMeta, m);
const pub = (rec) => {
  const { stored, ...rest } = rec;
  return rest;
};

export function registerVault(app) {
  app.post('/api/files/upload', async (req, reply) => {
    // multipart/form-data 는 req.body 로 파싱되지 않으므로(attachFieldsToBody 없음),
    // 프론트가 FormData 의 'token' 필드로 보낸 관리자 토큰을 parts 에서 직접 꺼낸다.
    // (Flask 시절 request.form.get('token') 과 동일한 경로)
    let token = '';
    let data = null;
    try {
      for await (const part of req.parts()) {
        if (part.type === 'field') {
          if (part.fieldname === 'token' && !token) token = String(part.value || '').trim();
        } else if (part.type === 'file' && !data) {
          data = part;
          await part.toBuffer(); // 파일 스트림을 소비해야 뒤의 token 필드를 읽을 수 있다
        }
      }
    } catch (e) {
      return reply.code(400).send({ error: String(e?.message || e) });
    }
    if (!requireAdmin(req, { token })) return reply.code(403).send({ error: '관리자 인증이 필요합니다' });
    if (!data) return reply.code(400).send({ error: '파일 없음' });
    try {
      const name = data.filename || 'file';
      const kind = vaultKind(name);
      const safe = (String(name).replace(/[^\w.\-가-힣 ]/g, '_').trim() || 'file');
      const fid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

      let rec;
      if (CLOUD_READY) {
        let publicId = `${VAULT_FOLDER}/${fid}_${safe}`;
        if (kind !== 'raw') publicId = publicId.replace(/\.[^.]+$/, '');
        const buf = await data.toBuffer();
        const res = await uploadStream(buf, {
          resource_type: kind, public_id: publicId,
          use_filename: false, unique_filename: false, overwrite: false,
          context: { original: name },
        });
        rec = {
          id: fid, public_id: res.public_id, url: res.secure_url, bytes: res.bytes || 0,
          resource_type: kind, name, storage: 'cloudinary', version: res.version,
          created_at: nowISO(),
        };
      } else {
        await fsp.mkdir(DIRS.vault, { recursive: true });
        const stored = `${fid}_${safe}`;
        const filePath = path.join(DIRS.vault, stored);
        const buf = await data.toBuffer();
        await fsp.writeFile(filePath, buf);
        rec = {
          id: fid, public_id: `${VAULT_FOLDER}/${stored}`, url: `/api/files/raw/${fid}`,
          bytes: buf.length, resource_type: kind, name, storage: 'local', stored,
          created_at: nowISO(),
        };
      }
      await withLock('vault', async () => {
        const m = await metaLoad();
        m[fid] = rec;
        await metaSave(m);
      });
      console.log(`[vault] 업로드 ${name} (${rec.bytes}B, ${rec.storage})`);
      return reply.send({ ok: true, ...pub(rec) });
    } catch (e) {
      console.error('[vault] 업로드 에러:', e);
      return reply.code(500).send({ error: String(e?.message || e) });
    }
  });

  app.get('/api/files/list', async (req, reply) => {
    if (!requireAdmin(req, req.query || {})) return reply.code(403).send({ error: '관리자 인증이 필요합니다' });
    try {
      const m = await withLock('vault', metaLoad);
      const items = Object.values(m).map(pub).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const total = items.reduce((s, i) => s + (parseInt(i.bytes || 0, 10) || 0), 0);
      return reply.send({ ok: true, files: items, total_bytes: total, storage: CLOUD_READY ? 'cloudinary' : 'local' });
    } catch (e) {
      return reply.code(500).send({ error: String(e?.message || e) });
    }
  });

  app.get('/api/files/raw/:fid', async (req, reply) => {
    if (!requireAdmin(req, req.query || {})) return reply.code(403).send({ error: '관리자 인증이 필요합니다' });
    const fid = req.params.fid;
    const rec = await withLock('vault', async () => (await metaLoad())[fid]);
    if (!rec) return reply.code(404).send({ error: '파일을 찾을 수 없습니다' });
    const asDl = req.query.dl === '1';

    const disposition = (name) =>
      `${asDl ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`;

    if (rec.storage === 'cloudinary') {
      try {
        const src = rec.url || cldDlUrl(rec);
        const up = await fetch(src, { redirect: 'follow' });
        if (up.status >= 400) {
          return reply.code(502).send({
            error: `클라우드에서 파일을 가져오지 못했습니다 (${up.status}). Cloudinary 보안 설정에서 'Allow delivery of PDF and ZIP files' 를 켜주세요.`,
          });
        }
        const name = rec.name || 'download';
        const buf = Buffer.from(await up.arrayBuffer());
        reply.header('Content-Type', up.headers.get('content-type') || 'application/octet-stream');
        reply.header('Content-Disposition', disposition(name));
        return reply.send(buf);
      } catch (e) {
        return reply.code(502).send({ error: `내려받기 실패: ${e?.message || e}` });
      }
    }
    // local
    const filePath = path.join(DIRS.vault, rec.stored);
    try {
      const buf = await fsp.readFile(filePath);
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Disposition', disposition(rec.name || 'download'));
      return reply.send(buf);
    } catch {
      return reply.code(404).send({ error: '파일을 찾을 수 없습니다' });
    }
  });

  app.post('/api/files/delete', async (req, reply) => {
    if (!requireAdmin(req, req.body || {})) return reply.code(403).send({ error: '관리자 인증이 필요합니다' });
    const data = req.body || {};
    let fid = data.id || '';
    const pid = data.public_id || '';
    try {
      return await withLock('vault', async () => {
        const m = await metaLoad();
        if (!fid) {
          for (const [k, v] of Object.entries(m)) {
            if (v.public_id === pid) { fid = k; break; }
          }
        }
        const rec = m[fid];
        if (!rec) return reply.code(404).send({ ok: false, error: '없는 파일' });
        if (rec.storage === 'cloudinary') {
          await destroy(rec.public_id, { resource_type: rec.resource_type || 'raw', invalidate: true });
        } else {
          try { await fsp.unlink(path.join(DIRS.vault, rec.stored)); } catch { /* already gone */ }
        }
        delete m[fid];
        await metaSave(m);
        console.log(`[vault] 삭제 ${rec.name}`);
        return reply.send({ ok: true });
      });
    } catch (e) {
      return reply.code(500).send({ error: String(e?.message || e) });
    }
  });

  app.get('/api/files/download', async (req, reply) => {
    if (!requireAdmin(req, req.query || {})) return reply.code(403).send({ error: '관리자 인증이 필요합니다' });
    const fid = req.query.id || '';
    const rec = await withLock('vault', async () => (await metaLoad())[fid]);
    if (!rec) return reply.code(404).send({ error: '없는 파일' });
    try {
      const tok = req.query.token || '';
      if (rec.storage === 'cloudinary') {
        const proxy = { ok: true, proxied: true, url: `/api/files/raw/${fid}?dl=1&token=${encodeURIComponent(tok)}` };
        let url;
        try { url = cldDlUrl(rec); }
        catch (e) { proxy.note = String(e?.message || e); return reply.send(proxy); }
        try {
          const probe = await fetch(url, { method: 'HEAD', redirect: 'follow' });
          if (probe.status >= 400) {
            proxy.note = probe.headers.get('x-cld-error') || `HTTP ${probe.status}`;
            return reply.send(proxy);
          }
        } catch { /* ignore probe failure */ }
        return reply.send({ ok: true, url });
      }
      const url = `/api/files/raw/${fid}?dl=1&token=${encodeURIComponent(tok)}`;
      return reply.send({ ok: true, url });
    } catch (e) {
      return reply.code(500).send({ error: String(e?.message || e) });
    }
  });
}
