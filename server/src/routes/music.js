// 음악 라이브러리 — 목록/스트리밍/재생/가사/표지 (로컬+클라우드).
// 무거운 작업(태깅·인식·유튜브)은 Python worker로 프록시한다.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DIRS, FILES } from '../lib/paths.js';
import { MUSIC_EXTS, MUSIC_MIME, CLOUD_READY, sbEnabled } from '../lib/config.js';
import { readJson, writeJsonAtomic, withLock, SAN_ID } from '../lib/store.js';
import { sbGet, sbRows, sbPut, sbDelete, errorText } from '../lib/supabase.js';
import { requireAdmin } from '../lib/admin.js';
import { cloudinaryUrl, destroy } from '../lib/cloudinary.js';
import { publishLive } from '../lib/sse.js';

const musicLoad = async () => {
  let m = await readJson(FILES.musicMeta, null);
  if (m && typeof m === 'object' && !Array.isArray(m)) return m;
  m = await readJson(FILES.musicBak, null);
  if (m && typeof m === 'object' && !Array.isArray(m) && Object.keys(m).length) {
    await writeJsonAtomic(FILES.musicMeta, m).catch(() => {});
    return m;
  }
  return {};
};

const musicSave = (m) => writeJsonAtomic(FILES.musicMeta, m);

// 목록 응답용 공개 레코드 (가사 본문 제외)
const musicPublic = (r) => {
  const o = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === 'lyrics' || k === 'lyrics_plain') continue;
    o[k] = v;
  }
  const sync = r.lyrics || '';
  const plain = r.lyrics_plain || '';
  o.has_sync = sync.includes('[');
  o.has_lyrics = Boolean(sync.trim() || plain.trim());
  return o;
};

const musicPublicCloud = (rec) => {
  const out = musicPublic(rec);
  if (out.cover_url) out.cover = true;
  let stream = out.stream_url || '';
  if ((!stream || stream.startsWith('/api/')) && rec.cloud_public_id && CLOUD_READY) {
    try {
      stream = cloudinaryUrl(rec.cloud_public_id, {
        resource_type: 'video', secure: true, format: rec.ext, version: rec.version,
      });
      out.stream_url = stream;
    } catch { /* ignore */ }
  }
  return out;
};

const remoteTrack = async (mid) => {
  if (!sbEnabled()) return null;
  try {
    const d = await sbGet('sdy_music_tracks', mid);
    return (d && typeof d === 'object') ? d : null;
  } catch { return null; }
};

// 로컬 목록이 비었는데 음원 파일이 있으면 가벼운 플레이스홀더로 되살린다
async function localRebuildIfNeeded(m) {
  if (Object.keys(m).length) return m;
  let files = [];
  try { files = await fsp.readdir(DIRS.music); } catch { return m; }
  const audio = files.filter((fn) => MUSIC_EXTS.has((fn.split('.').pop() || '').toLowerCase()));
  if (!audio.length) return m;
  for (const fn of audio) {
    const ext = fn.split('.').pop().toLowerCase();
    const mid = fn.slice(0, fn.lastIndexOf('.'));
    if (!mid || m[mid]) continue;
    let bytes = 0;
    try { bytes = (await fsp.stat(path.join(DIRS.music, fn))).size; } catch { /* */ }
    const coverFile = `${mid}.cover`;
    const hasCover = await fsp.access(path.join(DIRS.music, coverFile)).then(() => true).catch(() => false);
    m[mid] = {
      id: mid, title: mid.slice(0, 120), ext, bytes, cover: hasCover,
      artist: '', album: '', year: '', genre: '',
      orig_title: mid.slice(0, 120), tag_state: 'placeholder', tag_src: '',
      created_at: new Date().toISOString().slice(0, 19).replace('T', '') + 'Z',
    };
  }
  await musicSave(m).catch(() => {});
  return m;
}

export function registerMusic(app, { worker }) {
  app.get('/api/music/list', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (sbEnabled()) {
      try {
        const rows = await sbRows('sdy_music_tracks');
        const items = rows.map((r) => r.data).filter((d) => d && typeof d === 'object')
          .map(musicPublicCloud)
          .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
        return reply.send({ ok: true, tracks: items, tagging: false, count: items.length });
      } catch (e) {
        return reply.code(502).send({ ok: false, error: `음악 목록 연결 실패: ${errorText(e)}` });
      }
    }
    const m = await withLock('music', async () => {
      const mm = await musicLoad();
      return localRebuildIfNeeded(mm);
    });
    const items = Object.values(m).map(musicPublic)
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    return reply.send({ ok: true, tracks: items, tagging: false, count: items.length });
  });

  app.get('/api/music/file/:mid', async (req, reply) => {
    const mid = SAN_ID(req.params.mid, 80);
    if (sbEnabled()) {
      const rec = await remoteTrack(mid);
      if (!rec) return reply.code(404).send({ error: '없는 곡입니다' });
      let url = rec.stream_url || '';
      if (!url && rec.cloud_public_id) {
        try {
          url = cloudinaryUrl(rec.cloud_public_id, { resource_type: 'video', secure: true, format: rec.ext, version: rec.version });
        } catch { /* */ }
      }
      if (!url) return reply.code(404).send({ error: '음원 주소가 없습니다' });
      return reply.redirect(url, 302);
    }
    // 로컬 Range 스트리밍
    let hits = [];
    try {
      const files = await fsp.readdir(DIRS.music);
      hits = files.filter((fn) => fn.startsWith(mid + '.') && !fn.endsWith('.cover') && !fn.endsWith('.meta.json')
        && MUSIC_EXTS.has((fn.split('.').pop() || '').toLowerCase()));
    } catch { /* */ }
    if (!hits.length) return reply.code(404).send({ error: '없는 곡입니다' });
    const filePath = path.join(DIRS.music, hits[0]);
    const stat = await fsp.stat(filePath);
    const size = stat.size;
    const ext = hits[0].split('.').pop().toLowerCase();
    const mime = MUSIC_MIME[ext] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        let start = m[1] ? parseInt(m[1], 10) : 0;
        let end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
        if (start >= size) {
          return reply.code(416).header('Content-Range', `bytes */${size}`).send();
        }
        reply.code(206);
        reply.header('Content-Range', `bytes ${start}-${end}/${size}`);
        reply.header('Accept-Ranges', 'bytes');
        reply.header('Content-Length', String(end - start + 1));
        reply.type(mime);
        return reply.send(fs.createReadStream(filePath, { start, end }));
      }
    }
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Length', String(size));
    reply.type(mime);
    return reply.send(fs.createReadStream(filePath));
  });

  app.post('/api/music/play', async (req, reply) => {
    // 클라우드: Supabase 레코드에 직접 반영. 로컬: music/_index.json 의 단일
    // 작성자인 Python worker 가 처리한다 (Node 는 읽기 전용).
    if (sbEnabled()) {
      const mid = SAN_ID((req.body || {}).id, 80);
      if (!mid) return reply.code(400).send({ ok: false, error: 'id 없음' });
      const rec = await remoteTrack(mid);
      if (!rec) return reply.code(404).send({ ok: false, error: '없는 곡입니다' });
      rec.play_count = (parseInt(rec.play_count || 0, 10) || 0) + 1;
      rec.last_played = Date.now() / 1000;
      await sbPut('sdy_music_tracks', mid, rec);
      return reply.send({ ok: true, play_count: rec.play_count });
    }
    return worker.proxy(req, reply);
  });

  app.get('/api/music/lyrics/:mid', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const mid = SAN_ID(req.params.mid, 80);
    let r;
    if (sbEnabled()) r = await remoteTrack(mid);
    else r = await withLock('music', async () => (await musicLoad())[mid]);
    if (!r) return reply.code(404).send({ ok: false, error: '없는 곡' });
    return reply.send({
      ok: true, id: mid,
      lyrics: r.lyrics || '', lyrics_plain: r.lyrics_plain || '',
      lyrics_src: r.lyrics_src || '', lyrics_tries: r.lyrics_tries || 0,
    });
  });

  app.get('/api/music/cover/:mid', async (req, reply) => {
    const mid = SAN_ID(req.params.mid, 80);
    if (sbEnabled()) {
      const rec = await remoteTrack(mid);
      if (!rec) return reply.code(404).send({ error: '없는 곡' });
      let url = rec.cover_url;
      if (!url && rec.cover_public_id) {
        try { url = cloudinaryUrl(rec.cover_public_id, { resource_type: 'image', secure: true }); } catch { /* */ }
      }
      if (!url) return reply.code(404).send({ error: '없음' });
      return reply.redirect(url, 302);
    }
    const filePath = path.join(DIRS.music, `${mid}.cover`);
    try {
      const buf = await fsp.readFile(filePath);
      reply.header('Cache-Control', 'public, max-age=31536000');
      return reply.send(buf);
    } catch {
      return reply.code(404).send({ error: '없음' });
    }
  });

  // 삭제 (관리자 전용) — 클라우드는 원본과 동일 계약, 로컬은 worker 가 처리
  app.post('/api/music/delete', async (req, reply) => {
    if (!requireAdmin(req, req.body || {})) return reply.code(403).send({ ok: false, error: '관리자 인증이 필요합니다' });
    if (sbEnabled()) {
      const mid = SAN_ID((req.body || {}).id, 80);
      const rec = await remoteTrack(mid);
      if (!rec) return reply.code(404).send({ ok: false, error: '없는 곡입니다' });
      try {
        if (CLOUD_READY && rec.cloud_public_id) {
          await destroy(rec.cloud_public_id, { resource_type: 'video', invalidate: true }).catch(() => {});
        }
        if (rec.cover_public_id) await destroy(rec.cover_public_id, { resource_type: 'image' }).catch(() => {});
        await sbDelete('sdy_music_tracks', mid);
        publishLive('music', mid);
        return reply.send({ ok: true });
      } catch (e) {
        return reply.code(502).send({ ok: false, error: `음악 삭제 실패: ${errorText(e)}` });
      }
    }
    return worker.proxy(req, reply);
  });

  // ── 무거운 음악 작업 → Python worker 프록시 ──
  const heavyMusicRoutes = [
    ['POST', '/api/music/upload'],
    ['POST', '/api/music/youtube'],
    ['POST', '/api/music/lookup'],
    ['POST', '/api/music/recognize'],
    ['POST', '/api/music/recognize/key'],
    ['GET', '/api/music/recognize/status'],
    ['POST', '/api/music/rescan'],
    ['POST', '/api/music/reset'],
    ['POST', '/api/music/synced-lyrics'],
    ['POST', '/api/music/meta'],
    ['POST', '/api/music/cover'],
    ['POST', '/api/music/from_url'],
    ['POST', '/api/music/background-work'],
    ['GET', '/api/music/youtube/status'],
    ['POST', '/api/music/youtube/cookies'],
    ['DELETE', '/api/music/youtube/cookies'],
  ];
  for (const [method, url] of heavyMusicRoutes) {
    app.route({ method, url, handler: (req, reply) => worker.proxy(req, reply) });
  }
}
