// Frontend page serving: gzip + ETag/304 (mirrors sdynotes/pages.py).
import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { HTML_PATH, BASE_DIR } from './paths.js';

const cache = { mtime: 0, raw: null, gz: null, etag: '' };

function pageBytes() {
  const st = fs.statSync(HTML_PATH);
  if (cache.mtime !== st.mtimeMs) {
    const raw = fs.readFileSync(HTML_PATH);
    cache.mtime = st.mtimeMs;
    cache.raw = raw;
    cache.gz = zlib.gzipSync(raw, { level: 6 });
    cache.etag = `"${crypto.createHash('md5').update(raw).digest('hex').slice(0, 16)}"`;
  }
  return cache;
}

export function pageEtag() {
  return pageBytes().etag;
}

export function servePage(req, reply) {
  const c = pageBytes();
  const ifNone = req.headers['if-none-match'];
  if (ifNone && ifNone === c.etag) {
    reply.code(304)
      .header('ETag', c.etag)
      .header('Cache-Control', 'no-cache, must-revalidate')
      .send();
    return;
  }
  const acceptGzip = /gzip/.test((req.headers['accept-encoding'] || '').toLowerCase());
  if (acceptGzip) {
    reply.type('text/html; charset=utf-8')
      .header('Content-Encoding', 'gzip')
      .header('ETag', c.etag)
      .header('Cache-Control', 'no-cache, must-revalidate')
      .send(c.gz);
  } else {
    reply.type('text/html; charset=utf-8')
      .header('ETag', c.etag)
      .header('Cache-Control', 'no-cache, must-revalidate')
      .send(c.raw);
  }
}

// 16.2 · 정적 에셋(sdynotes.js · sdynotes.css) — 개발/미리보기용 셀프 호스팅.
// 운영 배포에선 nginx location / 이 디스크에서 먼저 주므로 여기는 예비 경로다.
const ASSETS = {
  '/sdynotes.js': { file: 'sdynotes.js', type: 'text/javascript; charset=utf-8' },
  '/sdynotes.css': { file: 'sdynotes.css', type: 'text/css; charset=utf-8' },
};
// 14.13.5 · sdynotes.js/css 는 항상 ?v= 버전과 함께 불러오므로 URL 자체가 버전
// 스탬프다 → 브라우저가 장기 캐시(immutable)해도 배포 시 새 버전 URL 로 갱신된다.
// (HTML 은 버전을 싣는 페이지라 no-cache 유지.) 예전 no-cache 매번 재확인
// 왕복을 없애서 로딩이 빨라진다.
const IMMUTABLE = 'public, max-age=31536000, immutable';
const assetCache = new Map(); // path -> {mtime, raw, gz, etag}

export function serveAsset(req, reply, urlPath) {
  const a = ASSETS[urlPath];
  if (!a) return false;
  const full = `${BASE_DIR}/${a.file}`;
  let c = assetCache.get(urlPath);
  let st;
  try {
    st = fs.statSync(full);
  } catch {
    return false;
  }
  if (!c || c.mtime !== st.mtimeMs) {
    const raw = fs.readFileSync(full);
    c = {
      mtime: st.mtimeMs, raw,
      gz: zlib.gzipSync(raw, { level: 6 }),
      etag: `"${crypto.createHash('md5').update(raw).digest('hex').slice(0, 16)}"`,
    };
    assetCache.set(urlPath, c);
  }
  if (req.headers['if-none-match'] === c.etag) {
    reply.code(304).header('ETag', c.etag).header('Cache-Control', IMMUTABLE).send();
    return true;
  }
  const gzip = /gzip/.test((req.headers['accept-encoding'] || '').toLowerCase());
  reply.type(a.type).header('ETag', c.etag).header('Cache-Control', IMMUTABLE);
  if (gzip) reply.header('Content-Encoding', 'gzip').send(c.gz);
  else reply.send(c.raw);
  return true;
}
