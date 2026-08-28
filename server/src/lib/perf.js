// 14.13.5 · 2코어/12GB 박스 대응 성능 튜닝 — 값이 한곳에 모인다.
//   apply.sh(systemd) 가 RAM/CPU 를 보고 env 를 주입하고, 여기서는 그 env 를
//   읽지 않으면 합리적 기본값을 쓴다. (테스트도 같은 기본값으로 동작한다)
import os from 'node:os';
import zlib from 'node:zlib';

export const CPU_N = os.availableParallelism
  ? os.availableParallelism()
  : (os.cpus()?.length || 2);

// ── @fastify/compress (API 응답 압축) ────────────────────────────────────
// 노트 동기화/목록 같은 MB 단위 JSON 이 압축 없이 날아가면 대역폭을 태운다.
// 1코어 박스에서는 압축 CPU 가 아까웠는데 2코어가 되니 여유가 생겼다.
//   · application/json · text/* 만 압축한다 — 이미지/음성/영상/파일 스트림
//     (가져오기·음악·보관함) 는 커스텀 타입이 아니라 그대로 흘려보낸다.
//   · 이미 Content-Encoding 을 둔 응답(프런트 에셋 사전 gzip) 은 건드리지 않는다
//     (플러그인 내장 동작).
//   · 브로틀리(압축률 ↑) 우선, gzip 폴백. 레벨은 '여유 있게 빠르게'.
export const COMPRESSIBLE_RE =
  /^application\/json|^application\/vnd\.fastify\+json|^text\//i;

export function compressOptions() {
  return {
    global: true,
    threshold: 512,                                  // 512B 미만은 아깝다
    encodings: ['br', 'gzip'],
    customTypes: (t) => COMPRESSIBLE_RE.test(String(t || '')),
    brotliOptions: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } },
    zlibOptions: { level: 5 },
  };
}

// 파일·바이너리 스트림(이미지/음성/영상/다운로드/가져오기 결과물)은 압축 이득이
// 없고 큰 파일을 압축기로 넘기면 CPU·지연만 늘린다 → 그 라우트들은 압축 제외.
// ※ compress 플러그인의 onRoute 훅보다 먼저 등록돼야 config.compress 를 읽는다.
export const BINARY_ROUTES =
  /^\/api\/(img\/|files\/(raw|download)|music\/(file|cover)|stickers\/raw\/|wallpaper\/:wid$|chat\/file\/|dm\/file\/|import\/)/;

export function noCompressForBinaryRoutes() {
  return (routeOptions) => {
    if (BINARY_ROUTES.test(String(routeOptions.url || ''))) {
      routeOptions.config = { ...(routeOptions.config || {}), compress: false };
    }
  };
}

// ── 동기화 상태 캐시 (syncEngine) ───────────────────────────────────────
// 협업 중 1초에도 여러 번 pullSync(전체 상태) 가 돈다. 캐시 한계를 넉넉히.
export const SYNC_CACHE_MAX =
  Math.max(100, parseInt(process.env.SDY_SYNC_CACHE_MAX || '1500', 10) || 1500);
export const SYNC_CACHE_TTL_LOCAL =
  Math.max(200, parseInt(process.env.SDY_SYNC_CACHE_TTL_MS || '1200', 10) || 1200);
export const SYNC_CACHE_TTL_SB =
  Math.max(300, parseInt(process.env.SDY_SYNC_CACHE_TTL_MS_SB || '2500', 10) || 2500);

// ── DB 행 파일 병렬 읽기 (dbstore) ──────────────────────────────────────
// 목록 쿼리가 행을 하나씩 순차로 JSON.parse 했는데, 읽기는 무조건 안전하므로
// CPU 수에 비례한 폭으로 병렬화한다. (쓰기만 락 안에서 순차 유지)
export const DB_READ_CONCURRENCY =
  Math.min(64, Math.max(8, CPU_N * 16));
