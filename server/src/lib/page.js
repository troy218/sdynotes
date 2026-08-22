// Frontend page serving: gzip + ETag/304 (mirrors sdynotes/pages.py).
import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { HTML_PATH } from './paths.js';

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
