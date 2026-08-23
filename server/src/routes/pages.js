// Page serving + note-image upload/delete (Oracle 자체 저장소 또는 Cloudinary).
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { servePage, serveAsset } from '../lib/page.js';
import { DIRS } from '../lib/paths.js';
import { CLOUD_READY } from '../lib/config.js';
import { uploadStream, destroy } from '../lib/cloudinary.js';

const IMG_MIME = {
  webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
};

// ── 로컬 노트 이미지 (오라클 서버 저장) ─────────────────────────────────
function imgFile(file) {
  const clean = String(file || '').replace(/[^0-9a-zA-Z._-]/g, '');
  if (!clean || clean.includes('..')) return null;
  return path.join(DIRS.img, clean);
}

function localPublicId(url) {
  const m = String(url || '').match(/\/api\/img\/([0-9a-zA-Z._-]+)/);
  return m ? m[1] : null;
}

export function registerPages(app) {
  app.get('/', (req, reply) => servePage(req, reply));
  app.get('/sdynotes.html', (req, reply) => servePage(req, reply));

  // 16.2 · 정적 에셋 (운영은 nginx 가 먼저 준다 — 여기는 개발/미리보기 경로)
  app.get('/sdynotes.js', (req, reply) => { if (!serveAsset(req, reply, '/sdynotes.js')) reply.code(404).send(); });
  app.get('/sdynotes.css', (req, reply) => { if (!serveAsset(req, reply, '/sdynotes.css')) reply.code(404).send(); });

  // 노트에 붙이는 이미지 업로드 (HEIF 변환 + 오라클 서버 저장 또는 Cloudinary)
  app.post('/api/upload', async (req, reply) => {
    try {
      const data = await req.file();
      if (!data) return reply.code(400).send({ error: '파일 없음' });
      const buf = await data.toBuffer();
      const quality = parseInt((await data.fields?.quality)?.value || '70', 10) || 70;
      const maxWidth = parseInt((await data.fields?.max_width)?.value || '1920', 10) || 1920;

      let img = sharp(buf).rotate(); // auto-orient (EXIF)
      const meta = await img.metadata();
      const originalSize = buf.length;

      if (maxWidth < 9999 && (meta.width || 0) > maxWidth) {
        img = img.resize({ width: maxWidth, withoutEnlargement: false });
      }

      // WEBP 압축 (원본은 HEIF 사용 — WEBP 는 브라우저 호환성이 더 좋고 용량도 작음)
      const out = await img.webp({ quality }).toBuffer();

      // ── 오라클 자체 저장소(기본): 이 서버 디스크에 저장 ──
      if (!CLOUD_READY) {
        const fid = `img_${crypto.randomBytes(6).toString('hex')}`;
        const fn = `${fid}.webp`;
        await fsp.mkdir(DIRS.img, { recursive: true });
        await fsp.writeFile(path.join(DIRS.img, fn), out);
        const url = `/api/img/${fn}`;
        const savedPercent = originalSize > 0 ? Math.round((1 - out.length / originalSize) * 1000) / 10 : 0;
        return reply.send({
          url,
          original_url: url,
          public_id: fn,
          original_size: originalSize,
          heif_size: out.length,
          saved_percent: savedPercent,
          stored_as: 'webp',
          display_format: 'webp',
          storage: 'oracle',
        });
      }

      // ── legacy 클라우드 모드 ──
      const res = await uploadStream(out, {
        folder: 'sdynotes',
        resource_type: 'image',
      });
      const originalUrl = res.secure_url;
      const displayUrl = originalUrl.replace('/upload/', '/upload/f_auto,q_auto/');
      const savedPercent = originalSize > 0 ? Math.round((1 - out.length / originalSize) * 1000) / 10 : 0;
      return reply.send({
        url: displayUrl,
        original_url: originalUrl,
        public_id: res.public_id,
        original_size: originalSize,
        heif_size: out.length,
        saved_percent: savedPercent,
        stored_as: 'webp',
        display_format: 'auto',
      });
    } catch (e) {
      console.error('[upload]', e);
      return reply.code(500).send({ error: String(e?.message || e) });
    }
  });

  // 로컬에 저장한 노트 이미지 서빙 (파일명은 서버가 만든 토큰이라 경로 조작 불가)
  app.get('/api/img/:file', async (req, reply) => {
    const fp = imgFile(req.params.file);
    if (!fp) return reply.code(400).send({ error: '잘못된 파일명' });
    try {
      const buf = await fsp.readFile(fp);
      const ext = String(req.params.file).split('.').pop().toLowerCase();
      reply.type(IMG_MIME[ext] || 'application/octet-stream');
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return reply.send(buf);
    } catch {
      return reply.code(404).send({ error: '없는 이미지' });
    }
  });

  // 노트에서 지운 이미지 → 저장소에서도 제거
  app.post('/api/delete', async (req, reply) => {
    try {
      const data = req.body || {};
      let publicId = data.public_id;
      const url = data.url || '';
      if (!publicId && url) {
        // 로컬 URL 이면 그대로 파일명, cloudinary URL 이면 /upload/ 뒤에서 추출
        const local = localPublicId(url);
        if (local) publicId = local;
        else {
          const m = url.match(/\/upload\/(?:[^/]+\/)*?(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
          if (m) publicId = m[1];
        }
      }
      if (!publicId) return reply.code(400).send({ error: 'public_id 없음' });

      // 로컬 파일명(폴더 없음)이면 오라클 저장소에서 삭제
      if (!CLOUD_READY || !String(publicId).includes('/')) {
        const fp = imgFile(publicId);
        if (fp) {
          try { await fsp.unlink(fp); } catch { /* already gone */ }
          return reply.send({ ok: true, public_id: publicId, result: 'deleted' });
        }
        return reply.code(400).send({ error: '잘못된 파일명' });
      }

      const result = await destroy(publicId, { invalidate: true });
      return reply.send({ ok: true, public_id: publicId, result: result?.result });
    } catch (e) {
      console.error('[delete]', e);
      return reply.code(500).send({ error: String(e?.message || e) });
    }
  });
}
