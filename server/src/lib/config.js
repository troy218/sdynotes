// Environment-derived configuration (mirrors sdynotes/common.py + per-module consts).
import crypto from 'node:crypto';

export const APP_VERSION = '14.8.0';
export const SETTINGS_SCHEMA = 3;

export const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'os8j8bnv';
export const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || '';
export const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || '';
export const CLOUD_READY = Boolean(CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);

export const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://xillsulrehkpuzyuhgcn.supabase.co').replace(/\/+$/, '');
export const SUPABASE_KEY = (
  process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_KEY
  || ''
).trim();
export const sbEnabled = () => Boolean(SUPABASE_URL && SUPABASE_KEY);

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
