// Environment-derived configuration (mirrors sdynotes/common.py + per-module consts).
import crypto from 'node:crypto';

// ── 버전 · 작업마다 반드시 올려라 ─────────────────────────────────────
// 작업 하나가 끝나면 아래 5곳을 '같은 번호로' 함께 올린다 (x.y.z 의 z +1).
//   ① package.json                     "version"
//   ② package-lock.json                "version" 2곳 (최상단 + packages."")
//   ③ server/src/lib/config.js         APP_VERSION            ← 여기
//   ④ worker/sdynotes_worker/common.py APP_VERSION
//   ⑤ sdynotes.html                    <meta application-version>
//                                      + sdynotes.css?v=  /  sdynotes.js?v=
// 하나라도 빠지면 → apply.sh 의 버전 검사가 배포를 중단한다.
// ⑤의 ?v= 를 안 올리면 → nginx 가 sdynotes.js/css 를 1년 immutable 로 캐싱하므로
//   이미 접속한 브라우저가 옛 JS/CSS 를 1년 동안 계속 쓴다(조용히 깨진다).
//   그래서 내리는 쪽이 아니라 '올리는' 쪽으로 맞춘다.
export const APP_VERSION = '14.16.4';
export const SETTINGS_SCHEMA = 3;

// ── 저장소 모드 ────────────────────────────────────────────────────────
// 'oracle'  (기본) : 모든 상태·파일을 이 Oracle 서버 디스크에 저장한다.
//                    Supabase/Cloudinary 로 나가는 트래픽이 전혀 없다.
// 'cloud'   (롤백) : 예전처럼 Supabase(상태) + Cloudinary(파일) 를 쓴다.
//                    .env 의 SUPABASE_*/CLOUDINARY_* 키는 이 모드에서만 읽힌다.
export const STORAGE_MODE = (process.env.SDY_STORAGE || 'oracle').trim().toLowerCase();
export const oracleStorage = () => STORAGE_MODE !== 'cloud';

export const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'os8j8bnv';
export const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || '';
export const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || '';
export const CLOUD_READY = STORAGE_MODE === 'cloud' && Boolean(CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);

export const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://xillsulrehkpuzyuhgcn.supabase.co').replace(/\/+$/, '');
export const SUPABASE_KEY = (
  process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_KEY
  || ''
).trim();
// oracle 모드에선 키가 남아 있어도 Supabase 를 쓰지 않는다 (쿼터 초과 방지).
export const sbEnabled = () => STORAGE_MODE === 'cloud' && Boolean(SUPABASE_URL && SUPABASE_KEY);

export const TABLES = {
  sync: 'sdy_sync_states',
  cards: 'sdy_card_decks',
  music: 'sdy_music_tracks',
  stickers: 'sdy_stickers',
};
export const SB_TABLES = new Set(Object.values(TABLES));

// admin
export const ADMIN_PW_HASH = process.env.ADMIN_PW_HASH || crypto.createHash('sha256').update('818988').digest('hex');
export const MAX_TRIES = 3;
export const BLOCK_SECONDS = 600;
export const SESSION_TTL = 30 * 24 * 3600;          // 30 days
export const SESSION_REFRESH_IF_LT = 7 * 24 * 3600;  // extend if <7d left

// misc
export const QUOTA_BYTES = parseInt(process.env.SDY_QUOTA_MB || '2048', 10) * 1024 * 1024;

// stickers
export const STICKER_MAX_BYTES = 8 * 1024 * 1024;

// wallpaper
export const WALL_MAX_MB = 12;
export const WALL_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'bmp']);
export const WALL_MAX_WIDTH = 2560;
export const WALL_VIDEO_EXTS = new Set(['mp4', 'webm', 'mov']);
export const WALL_VIDEO_MAX_MB = 40;

// music
export const MUSIC_MAX_MB = 50;
export const MUSIC_EXTS = new Set(['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'webm', 'weba']);
export const MUSIC_MIME = {
  mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
  ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm', weba: 'audio/webm',
};
export const TAG_ALGO = '13.0';

// translate
export const LT_URL = (process.env.LIBRETRANSLATE_URL || '').replace(/\/+$/, '');
export const LT_KEY = (process.env.LIBRETRANSLATE_KEY || '').trim();
export const TR_ENGINE = (process.env.TRANSLATE_ENGINE || 'auto').toLowerCase();

// presence
export const PRESENCE_TTL = 45; // seconds

// python worker (heavy jobs: import, music tagging/yt/acoustid)
export const WORKER_URL = (process.env.SDY_WORKER_URL || 'http://127.0.0.1:5100').replace(/\/+$/, '');
