/* ═══════════════════════════════════════════════════════════════════════════
   SDYnotes 발매판 · 서비스워커

   이 파일이 하는 네 가지
     ① 앱 셸을 미리 받아 둔다        → 비행기 모드에서도 앱이 열린다
     ② 음원·표지를 기기에서 흘려보낸다 → <audio src="/api/music/file/…">
                                        요청이 서버로 가지 않고 IndexedDB 에서 나온다
     ③ 정적 파일(stale-while-revalidate) → 두 번째 실행부터 즉시 뜬다
     ④ 읽기 API 는 온라인 우선, 끊기면 캐시 → 지하철에서도 노트를 읽는다

   ⚠ 캐시를 함부로 지우지 않는다
     이 캐시에는 사용자의 노트 본문이 들어간다. 새 버전이 올라오면 '앱 셸'만
     갈아끼우고, 오프라인 읽기 캐시(sdy-offline-api)는 그대로 둔다.
   ═══════════════════════════════════════════════════════════════════════════ */

importScripts('/app/music-store.js');

// 빌드가 아래 두 줄을 실제 값으로 바꾼다.
const BUILD = '__SDY_BUILD__';
const PRECACHE = ['/'];

const SHELL = 'sdy-shell-' + BUILD;
const STATIC = 'sdy-static-' + BUILD;
const API = 'sdy-offline-api-v1';     // 버전을 붙이지 않는다(위 주석 참고)
const CDN = 'sdy-cdn-v1';

const OFFLINE_API_MAX = 400;          // 항목 수 상한 — 넘으면 오래된 것부터 버린다

// 오프라인 읽기 캐시에 담아도 되는 GET (읽기 전용 경로만)
const READ_API = [
  '/api/sync/',
  '/api/pages/',
  '/api/db/',
  '/api/notifications/',
  '/api/cards/',
  '/api/papers/',
  '/api/import/docfile/'
];

const CDN_HOSTS = [
  'cdn.jsdelivr.net',
  'fonts.gstatic.com',
  'fonts.googleapis.com'
];

// ── 설치: 앱 셸 미리 받기 ─────────────────────────────────────────────────
// addAll 은 하나라도 실패하면 전부 버린다. 느린 회선에서 설치가 통째로
// 실패하지 않게 하나씩 담고, 실패한 것은 기록만 남긴다.
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    const failed = [];
    await Promise.all(PRECACHE.map(async (u) => {
      try { await cache.add(new Request(u, { cache: 'reload' })); }
      catch (err) { failed.push(u); }
    }));
    if (failed.length) console.warn('[sw] 미리 받기 실패', failed);
    await self.skipWaiting();
  })());
});

// ── 활성화: 옛 셸·옛 정적 캐시만 정리 ──────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((n) => {
      if (n === SHELL || n === STATIC || n === API || n === CDN) return null;
      if (n.indexOf('sdy-') !== 0) return null;
      return caches.delete(n);
    }));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (err) {}
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'sdy-skip-waiting') self.skipWaiting();
});

// ── 도우미 ────────────────────────────────────────────────────────────────
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const over = keys.length - max;
  for (let i = 0; i < over; i++) await cache.delete(keys[i]);
}

function isReadApi(pathname) {
  return READ_API.some((p) => pathname.indexOf(p) === 0);
}

function withRange(blob, rangeHeader, mime) {
  // <audio> 는 탐색할 때 Range 를 보낸다. 전체를 200 으로 주면 시크가 뚝뚝 끊긴다.
  if (!rangeHeader) {
    return new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': mime || blob.type || 'application/octet-stream',
        'Content-Length': String(blob.size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store'
      }
    });
  }
  const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
  let start = 0, end = blob.size - 1;
  if (m) {
    if (m[1]) start = parseInt(m[1], 10);
    if (m[2]) end = parseInt(m[2], 10);
    else if (!m[1]) { start = Math.max(0, blob.size - parseInt(m[2], 10)); end = blob.size - 1; }
  }
  if (!(start >= 0 && start <= end && end < blob.size)) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': 'bytes */' + blob.size }
    });
  }
  const slice = blob.slice(start, end + 1);
  return new Response(slice, {
    status: 206,
    headers: {
      'Content-Type': mime || blob.type || 'application/octet-stream',
      'Content-Length': String(slice.size),
      'Content-Range': 'bytes ' + start + '-' + end + '/' + blob.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store'
    }
  });
}

// ── fetch ────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;   // 쓰기는 손대지 않는다(앱의 outbox 가 처리)

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // ① 음원 — 기기(IndexedDB)에서 흘려보낸다
  const mFile = /^\/api\/music\/file\/([^/]+)$/.exec(url.pathname);
  if (mFile) {
    event.respondWith((async () => {
      const id = decodeURIComponent(mFile[1]);
      const blob = await self.SDYMusicStore.blob(id);
      if (!blob) return new Response('기기에 없는 곡입니다', { status: 404 });
      return withRange(blob, req.headers.get('range'), blob.type || 'audio/mpeg');
    })());
    return;
  }

  // ② 표지 — 기기에서
  const mCover = /^\/api\/music\/cover\/([^/]+)$/.exec(url.pathname);
  if (mCover) {
    event.respondWith((async () => {
      const id = decodeURIComponent(mCover[1]);
      const blob = await self.SDYMusicStore.coverBlob(id);
      if (!blob) return new Response('없음', { status: 404, headers: { 'Cache-Control': 'no-store' } });
      return withRange(blob, null, blob.type || 'image/jpeg');
    })());
    return;
  }

  // ③ 다른 사이트(폰트 CDN) — 한 번 받으면 캐시에서
  if (CDN_HOSTS.indexOf(url.hostname) >= 0) {
    event.respondWith((async () => {
      const cache = await caches.open(CDN);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch (e) {
        return hit || Response.error();
      }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  // ④ 읽기 API — 온라인 우선, 끊기면 캐시
  if (isReadApi(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(API);
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          cache.put(req, res.clone()).then(() => trim(API, OFFLINE_API_MAX)).catch(() => {});
        }
        return res;
      } catch (e) {
        const hit = await cache.match(req);
        if (hit) {
          // 오프라인에서 읽은 응답임을 앱이 알 수 있게 표시
          const body = await hit.blob();
          const headers = new Headers(hit.headers);
          headers.set('X-SDY-Offline', '1');
          return new Response(body, { status: hit.status, headers });
        }
        return new Response(JSON.stringify({ ok: false, offline: true, error: '오프라인' }), {
          status: 503, headers: { 'Content-Type': 'application/json' }
        });
      }
    })());
    return;
  }

  // ⑤ 그 밖의 /api/ — 서버로 그대로
  if (url.pathname.indexOf('/api/') === 0) return;

  // ⑥ 화면 이동 — 온라인 우선, 끊기면 저장해 둔 앱 셸
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put('/', res.clone()).catch(() => {});
        return res;
      } catch (e) {
        const hit = (await cache.match('/')) || (await cache.match('/sdynotes.html'));
        if (hit) return hit;
        return new Response('<h1>오프라인</h1><p>앱을 한 번 열어 두면 다음부터는 열립니다.</p>',
          { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // ⑦ 정적 파일 — 캐시 먼저(즉시), 뒤에서 갱신
  event.respondWith((async () => {
    const cache = await caches.open(STATIC);
    const hit = await cache.match(req);
    const net = fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);
    return hit || (await net) || new Response('', { status: 504 });
  }));
});
