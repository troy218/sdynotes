// 스티커 보관함 (Supabase+Cloudinary 또는 로컬 디스크).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DIRS, FILES } from '../lib/paths.js';
import { CLOUD_READY } from '../lib/config.js';
import { sbEnabled, sbGet, sbPut, sbDelete, sbRows, errorText } from '../lib/supabase.js';
import { readJson, writeJsonAtomic, withLock, nowISO } from '../lib/store.js';
import { uploadStream, destroy } from '../lib/cloudinary.js';
import { publishLive } from '../lib/sse.js';

const stkLoad = () => readJson(FILES.stickerMeta, {});
const stkSave = (m) => writeJsonAtomic(FILES.stickerMeta, m);

const STICKER_MAX_BYTES = 8 * 1024 * 1024;

// SVG 스티커를 문서로 바로 열었을 때 스크립트가 돌지 않게 기본적인 무력화만 한다.
// (이미지로 쓸 때는 어차피 실행되지 않지만, 원본 파일 열기 대비)
function sanitizeSvg(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s"'>]+/gi, '')
    .replace(/(href|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}

// data: URL 디코드 — base64(PNG 등)와 URL 인코딩(SVG) 둘 다 받는다 (14.16.7)
function decodeDataUrl(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const head = comma >= 0 ? dataUrl.slice(0, comma) : '';
  const body = comma >= 0 ? dataUrl.slice(comma + 1) : '';
  let raw;
  if (/;base64/i.test(head)) {
    raw = Buffer.from(body, 'base64');
  } else {
    let text = body;
    try { text = decodeURIComponent(body); } catch { /* 이미 디코딩된 문자열 */ }
    raw = Buffer.from(text, 'utf8');
  }
  const m = head.match(/^data:image\/([a-z0-9.+-]+)/i);
  const kind = (m && m[1] || 'png').toLowerCase();
  const isSvg = kind === 'svg' || kind === 'svg+xml';
  return { raw, kind, isSvg };
}

export function registerStickers(app) {
  app.post('/api/stickers/save', async (req, reply) => {
    const b = req.body || {};
    const dataUrl = b.data || '';
    const name = String(b.name || '스티커').trim().slice(0, 60);
    if (!dataUrl.startsWith('data:image/')) return reply.code(400).send({ ok: false, error: '이미지가 아닙니다' });
    try {
      const dec = decodeDataUrl(dataUrl);
      let raw = dec.raw;
      const isSvg = dec.isSvg;
      if (isSvg) raw = Buffer.from(sanitizeSvg(raw.toString('utf8')), 'utf8');
      if (raw.length > STICKER_MAX_BYTES) return reply.code(400).send({ ok: false, error: '스티커가 너무 큽니다 (8MB)' });
      const sid = crypto.randomBytes(6).toString('hex');
      const rec = { id: sid, name, bytes: raw.length, created_at: nowISO(), fmt: isSvg ? 'svg' : 'png' };

      // 클라우드 모드: Cloudinary 에 이미지, Supabase 에 메타데이터 (원본 sticker_save_cloud)
      if (sbEnabled() && CLOUD_READY) {
        const res = await uploadStream(raw, { folder: 'sdy_stickers', public_id: sid, resource_type: 'image' });
        rec.url = res.secure_url;
        rec.public_id = res.public_id;
        rec.storage = 'cloudinary';
        await sbPut('sdy_stickers', sid, rec);
        publishLive('stickers', sid);
        return reply.send({ ok: true, ...rec });
      }

      // 로컬 폴백 (Cloudinary 키만 있으면 이미지는 클라우드, 메타는 로컬)
      if (CLOUD_READY) {
        const res = await uploadStream(raw, { folder: 'sdy_stickers', public_id: sid, resource_type: 'image' });
        rec.url = res.secure_url; rec.public_id = res.public_id; rec.storage = 'cloudinary';
      } else {
        await fs.mkdir(DIRS.stickers, { recursive: true });
        const fn = `${sid}.${isSvg ? 'svg' : 'png'}`;
        await fs.writeFile(path.join(DIRS.stickers, fn), raw);
        rec.url = `/api/stickers/raw/${sid}`; rec.stored = fn; rec.storage = 'local';
      }
      await withLock('stickers', async () => {
        const m = await stkLoad();
        m[sid] = rec;
        await stkSave(m);
      });
      publishLive('stickers', sid);
      return reply.send({ ok: true, ...rec });
    } catch (e) {
      console.error('[sticker] 저장 실패:', e);
      return reply.code(500).send({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/stickers/list', async (req, reply) => {
    if (sbEnabled()) {
      try {
        const rows = await sbRows('sdy_stickers');
        const items = rows.map((r) => r.data).filter((d) => d && typeof d === 'object')
          .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
        return reply.send({
          ok: true, stickers: items,
          total_bytes: items.reduce((s, r) => s + (parseInt(r.bytes || 0, 10) || 0), 0),
        });
      } catch (e) {
        return reply.code(502).send({ ok: false, error: `스티커 목록 연결 실패: ${errorText(e)}` });
      }
    }
    const m = await withLock('stickers', stkLoad);
    const items = Object.values(m).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return reply.send({
      ok: true, stickers: items,
      total_bytes: items.reduce((s, r) => s + (parseInt(r.bytes || 0, 10) || 0), 0),
    });
  });

  app.get('/api/stickers/raw/:sid', async (req, reply) => {
    if (sbEnabled()) {
      let rec = null;
      try { rec = await sbGet('sdy_stickers', req.params.sid); } catch (e) {
        return reply.code(502).send({ error: `스티커 연결 실패: ${errorText(e)}` });
      }
      if (!rec || !rec.url) return reply.code(404).send({ error: '없는 스티커' });
      return reply.redirect(rec.url, 302);
    }
    const rec = (await stkLoad())[req.params.sid];
    if (!rec || !rec.stored) return reply.code(404).send({ error: '없는 스티커' });
    try {
      const buf = await fs.readFile(path.join(DIRS.stickers, rec.stored));
      if (/\.svg$/i.test(rec.stored)) {
        // SVG 를 원본 문서로 직접 열 때 스크립트가 돌지 않게 한다.
        // <img src> 로 쓸 때는 이 헤더가 영향을 주지 않는다.
        reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
        reply.type('image/svg+xml');
      } else {
        reply.type('image/png');
      }
      return reply.send(buf);
    } catch {
      return reply.code(404).send({ error: '없는 스티커' });
    }
  });

  app.post('/api/stickers/delete', async (req, reply) => {
    const sid = (req.body || {}).id;
    if (sbEnabled()) {
      let rec = null;
      try { rec = await sbGet('sdy_stickers', sid); } catch (e) {
        return reply.code(502).send({ ok: false, error: `스티커 삭제 실패: ${errorText(e)}` });
      }
      if (!rec) return reply.code(404).send({ ok: false, error: '없는 스티커' });
      if (CLOUD_READY && rec.public_id) {
        await destroy(rec.public_id, { resource_type: 'image', invalidate: true }).catch(() => {});
      }
      await sbDelete('sdy_stickers', sid);
      publishLive('stickers', sid);
      return reply.send({ ok: true });
    }
    let rec;
    await withLock('stickers', async () => {
      const m = await stkLoad();
      rec = m[sid];
      if (rec) {
        delete m[sid];
        await stkSave(m);
      }
    });
    if (!rec) return reply.code(404).send({ ok: false, error: '없는 스티커' });
    try {
      if (rec.storage === 'cloudinary' && rec.public_id) {
        await destroy(rec.public_id, { resource_type: 'image' });
      } else if (rec.stored) {
        await fs.unlink(path.join(DIRS.stickers, rec.stored)).catch(() => {});
      }
    } catch { /* ignore */ }
    publishLive('stickers', sid);
    return reply.send({ ok: true });
  });
}
