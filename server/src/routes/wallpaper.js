// 홈 배경화면 업로드 (사진 + 동영상(mp4·webm·mov). Cloudinary 또는 로컬, 자동 리사이즈, 최근 5개 유지).
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { DIRS } from '../lib/paths.js';
import { CLOUD_READY } from '../lib/config.js';
import { WALL_EXTS, WALL_VIDEO_EXTS, WALL_MAX_MB, WALL_VIDEO_MAX_MB, WALL_MAX_WIDTH } from '../lib/config.js';
import { uploadStream } from '../lib/cloudinary.js';

const WALL_VIDEO_MIME = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };

// 로컬 저장소에서 사진/동영상 각각 최근 5개만 남긴다
async function pruneLocal(exts) {
  try {
    const files = (await fs.readdir(DIRS.wallpaper)).filter((n) => exts.has((n.split('.').pop() || '').toLowerCase()));
    const stats = await Promise.all(files.map(async (n) => ({ n, t: (await fs.stat(path.join(DIRS.wallpaper, n))).mtimeMs })));
    stats.sort((a, b) => b.t - a.t);
    for (const old of stats.slice(5)) await fs.unlink(path.join(DIRS.wallpaper, old.n)).catch(() => {});
  } catch { /* ignore */ }
}

export function registerWallpaper(app) {
  app.post('/api/wallpaper/upload', async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ ok: false, error: '파일이 없습니다' });
    const name = data.filename || '';
    const ext = (name.split('.').pop() || '').toLowerCase();
    const isVideo = WALL_VIDEO_EXTS.has(ext);
    if (!isVideo && !WALL_EXTS.has(ext)) {
      return reply.code(400).send({ ok: false, error: '사진(jpg·png·webp·heic) 또는 동영상(mp4)만 올릴 수 있어요' });
    }
    const buf = await data.toBuffer();
    const capMB = isVideo ? WALL_VIDEO_MAX_MB : WALL_MAX_MB;
    if (buf.length > capMB * 1024 * 1024) {
      return reply.code(400).send({ ok: false, error: `${capMB}MB 이하만 올릴 수 있어요` });
    }

    const wid = crypto.randomBytes(6).toString('hex');

    // ── 동영상: 변환 없이 원본 그대로 저장 ──
    if (isVideo) {
      if (CLOUD_READY) {
        try {
          const res = await uploadStream(buf, {
            folder: 'sdy_wallpaper', public_id: wid, resource_type: 'video', format: ext,
          });
          return reply.send({
            ok: true, id: wid, kind: 'video',
            url: res.secure_url || '', public_id: res.public_id || wid, storage: 'cloudinary',
          });
        } catch (e) {
          return reply.code(400).send({ ok: false, error: `배경 클라우드 저장 실패: ${e?.message || e}` });
        }
      }
      const filePath = path.join(DIRS.wallpaper, `${wid}.${ext}`);
      try {
        await fs.writeFile(filePath, buf);
      } catch (e) {
        return reply.code(400).send({ ok: false, error: `동영상을 저장하지 못했습니다: ${e?.message || e}` });
      }
      await pruneLocal(WALL_VIDEO_EXTS);
      return reply.send({ ok: true, id: wid, kind: 'video', url: `/api/wallpaper/${wid}`, storage: 'local' });
    }

    // ── 사진: 리사이즈 후 jpg (기존 동작) ──
    if (CLOUD_READY) {
      try {
        let img = sharp(buf).rotate();
        const meta = await img.metadata();
        if ((meta.width || 0) > WALL_MAX_WIDTH) {
          img = img.resize({ width: WALL_MAX_WIDTH });
        }
        const out = await img.jpeg({ quality: 86 }).toBuffer();
        const res = await uploadStream(out, {
          folder: 'sdy_wallpaper', public_id: wid, resource_type: 'image', format: 'jpg',
        });
        return reply.send({
          ok: true, id: wid, kind: 'image',
          url: res.secure_url || '', public_id: res.public_id || wid, storage: 'cloudinary',
        });
      } catch (e) {
        return reply.code(400).send({ ok: false, error: `배경 클라우드 저장 실패: ${e?.message || e}` });
      }
    }

    const filePath = path.join(DIRS.wallpaper, `${wid}.jpg`);
    try {
      let img = sharp(buf).rotate();
      const meta = await img.metadata();
      if ((meta.width || 0) > WALL_MAX_WIDTH) {
        img = img.resize({ width: WALL_MAX_WIDTH });
      }
      await img.jpeg({ quality: 86 }).toFile(filePath);
    } catch (e) {
      return reply.code(400).send({ ok: false, error: `사진을 읽을 수 없습니다: ${e?.message || e}` });
    }
    await pruneLocal(WALL_EXTS);
    return reply.send({ ok: true, id: wid, kind: 'image', url: `/api/wallpaper/${wid}`, storage: 'local' });
  });

  app.get('/api/wallpaper/:wid', async (req, reply) => {
    const wid = String(req.params.wid || '').replace(/[^0-9a-zA-Z]/g, '');
    // 사진(jpg) 우선, 없으면 동영상 확장자를 찾는다
    let filePath = null;
    let mime = 'image/jpeg';
    for (const c of [{ p: path.join(DIRS.wallpaper, `${wid}.jpg`), mime: 'image/jpeg' },
      ...[...WALL_VIDEO_EXTS].map((ve) => ({ p: path.join(DIRS.wallpaper, `${wid}.${ve}`), mime: WALL_VIDEO_MIME[ve] }))]) {
      try {
        const st = await fs.stat(c.p);
        if (st.isFile()) { filePath = c.p; mime = c.mime; break; }
      } catch { /* keep looking */ }
    }
    if (!filePath) return reply.code(404).send({ ok: false, error: '없음' });

    // 동영상은 Range 스트리밍 (Safari/iOS 에서 autoplay·탐색 호환)
    if (mime !== 'image/jpeg') {
      const stat = await fs.stat(filePath);
      const size = stat.size;
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        if (m) {
          const start = m[1] ? parseInt(m[1], 10) : 0;
          const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
          if (start >= size) {
            return reply.code(416).header('Content-Range', `bytes */${size}`).send();
          }
          reply.code(206);
          reply.header('Content-Range', `bytes ${start}-${end}/${size}`);
          reply.header('Accept-Ranges', 'bytes');
          reply.header('Content-Length', String(end - start + 1));
          reply.type(mime);
          return reply.send(createReadStream(filePath, { start, end }));
        }
      }
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Content-Length', String(size));
      reply.type(mime);
      return reply.send(createReadStream(filePath));
    }

    const buf = await fs.readFile(filePath);
    reply.type('image/jpeg');
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.send(buf);
  });
}
