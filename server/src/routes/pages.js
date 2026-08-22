// Page serving + note-image upload/delete (Cloudinary).
import sharp from 'sharp';
import { servePage } from '../lib/page.js';
import { uploadStream, destroy } from '../lib/cloudinary.js';

export function registerPages(app) {
  app.get('/', (req, reply) => servePage(req, reply));
  app.get('/sdynotes.html', (req, reply) => servePage(req, reply));

  // 노트에 붙이는 이미지 업로드 (HEIF 변환 + Cloudinary, 원본과 같은 계약)
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

  // 노트에서 지운 이미지 → Cloudinary 에서도 제거
  app.post('/api/delete', async (req, reply) => {
    try {
      const data = req.body || {};
      let publicId = data.public_id;
      const url = data.url || '';
      if (!publicId && url) {
        const m = url.match(/\/upload\/(?:[^/]+\/)*?(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
        if (m) publicId = m[1];
      }
      if (!publicId) return reply.code(400).send({ error: 'public_id 없음' });
      const result = await destroy(publicId, { invalidate: true });
      return reply.send({ ok: true, public_id: publicId, result: result?.result });
    } catch (e) {
      console.error('[delete]', e);
      return reply.code(500).send({ error: String(e?.message || e) });
    }
  });
}
