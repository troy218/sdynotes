#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   발매판 배포 서버 — 의존성 0개

   왜 Fastify 를 안 쓰나
     이 서버가 하는 일은 딱 두 가지다. ① build/ 안의 파일을 내보낸다.
     ② /api/* 를 기존 백엔드(SDYnotes)로 넘긴다. 그 정도는 node 기본 모듈로
     충분하고, 의존성이 없으면 기기·서버 어디서든 그대로 뜬다.
     (기존 백엔드는 그대로 돌아간다 — 이 서버는 그 앞에 서는 얇은 껍데기다.)

   실행
     SDY_UPSTREAM=http://127.0.0.1:5000 PORT=8080 node index.mjs
       SDY_UPSTREAM  기존 백엔드 주소 (없으면 앱은 열리지만 서버 기능이 꺼진다)
       PORT          들을 포트 (기본 8080)
       SDY_ROOT      내보낼 폴더 (기본 ../build)
   ═══════════════════════════════════════════════════════════════════════════ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.SDY_ROOT || path.join(HERE, '..', 'build'));
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const UPSTREAM = (process.env.SDY_UPSTREAM || '').replace(/\/$/, '');

if (!fs.existsSync(path.join(ROOT, 'sdynotes.html'))) {
  console.error(`❌ ${ROOT} 에 발매판이 없습니다 — 먼저 node scripts/build.mjs 를 실행하세요`);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.gz': 'application/gzip', '.zip': 'application/zip', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

// 서비스워커·매니페스트·HTML 은 절대 캐시하면 안 된다(새 빌드가 안 먹는다).
function cacheFor(urlPath) {
  if (urlPath === '/' || urlPath.endsWith('.html')) return 'no-cache';
  if (urlPath === '/sw.js' || urlPath === '/manifest.webmanifest' || urlPath === '/version.json') return 'no-cache';
  // 나머지 정적 파일은 URL 에 ?v= 가 붙어 있어 오래 캐시해도 안전하다.
  return 'public, max-age=31536000, immutable';
}

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, headers || {}));
  res.end(body);
}

function safeJoin(rootDir, urlPath) {
  const p = decodeURIComponent(urlPath.split('?')[0]);
  const abs = path.join(rootDir, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(rootDir)) return null;
  return abs;
}

// ── 정적 파일 (Range 지원: 음원·PDF 시크용) ───────────────────────────────
function serveStatic(req, res, urlPath) {
  let file = safeJoin(ROOT, urlPath);
  if (!file) return send(res, 403, '금지된 경로');

  let stat = null;
  try { stat = fs.statSync(file); } catch (e) { stat = null; }
  if (stat && stat.isDirectory()) {
    file = path.join(file, 'sdynotes.html');
    try { stat = fs.statSync(file); } catch (e) { stat = null; }
  }
  if (!stat) return false;   // 없으면 호출한 쪽이 판단

  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = 0, end = stat.size - 1;
    if (m) {
      if (m[1]) start = parseInt(m[1], 10);
      if (m[2]) end = parseInt(m[2], 10);
    }
    if (start > end || end >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheFor(urlPath)
    });
    fs.createReadStream(file, { start, end }).pipe(res);
    return true;
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheFor(urlPath),
    'Service-Worker-Allowed': '/'
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
  return true;
}

// ── API 넘기기 ───────────────────────────────────────────────────────────
function proxy(req, res) {
  if (!UPSTREAM) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      ok: false, offline: true,
      error: '서버가 연결되지 않았습니다 (SDY_UPSTREAM 미설정)'
    }));
  }
  let target;
  try { target = new URL(req.url, UPSTREAM); }
  catch (e) { return send(res, 500, '업스트림 주소 오류'); }

  const headers = Object.assign({}, req.headers, {
    host: target.host,
    'x-forwarded-host': req.headers.host || '',
    'x-forwarded-proto': (req.socket.encrypted ? 'https' : 'http')
  });

  const up = http.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: target.pathname + target.search,
    method: req.method,
    headers
  }, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });

  up.on('error', (e) => {
    if (res.headersSent) return res.end();
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, offline: true, error: '서버 연결 실패: ' + e.message }));
  });
  req.pipe(up);
}

// ── 서버 ─────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = new URL(req.url, 'http://x').pathname; }
  catch (e) { return send(res, 400, '잘못된 요청'); }

  // 오프라인에서도 앱이 열려야 하므로 서비스워커·매니페스트를 최우선으로 보낸다
  if (urlPath.indexOf('/api/') === 0) return proxy(req, res);

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'GET 만');

  try {
    if (serveStatic(req, res, urlPath)) return;
  } catch (e) {
    return send(res, 500, '파일 오류: ' + e.message);
  }

  // 화면 이동은 앱 셸로 (해시·경로 라우팅 모두)
  if (req.headers.accept && req.headers.accept.indexOf('text/html') >= 0) {
    const shell = path.join(ROOT, 'sdynotes.html');
    const body = fs.readFileSync(shell);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache'
    });
    return res.end(body);
  }
  send(res, 404, '없음');
});

server.listen(PORT, HOST, () => {
  console.log('='.repeat(56));
  console.log('  notesis 발매판 서버 (원본 SDYnotes 백엔드 앞단)');
  console.log(`  주소    : http://${HOST}:${PORT}`);
  console.log(`  내보냄  : ${ROOT}`);
  console.log(`  백엔드  : ${UPSTREAM || '(없음 — 앱은 열리지만 서버 기능 꺼짐)'}`);
  console.log('='.repeat(56));
});
