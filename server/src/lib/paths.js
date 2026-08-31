// Shared path constants. BASE_DIR = project root (where sdynotes.html lives).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// server/src/lib -> project root
export const BASE_DIR = process.env.SDY_BASE_DIR
  || path.resolve(__dirname, '..', '..', '..');

export const DIRS = {
  img:        path.join(BASE_DIR, 'imported'),
  docs:       path.join(BASE_DIR, 'imported_docs'),
  upload:     path.join(BASE_DIR, 'import_uploads'),
  jobs:       path.join(BASE_DIR, 'import_jobs'),
  stickers:   path.join(BASE_DIR, 'stickers'),
  cards:      path.join(BASE_DIR, 'cards'),
  wallpaper:  path.join(BASE_DIR, 'wallpaper'),
  music:      path.join(BASE_DIR, 'music'),
  sync:       path.join(BASE_DIR, 'sync'),
  vault:      path.join(BASE_DIR, 'vault'),
  db:         path.join(BASE_DIR, 'db'),
  dm:         path.join(BASE_DIR, 'dm'),        // 16.3 · 1:1 대화 사진/파일
};

export const FILES = {
  stickerMeta: path.join(DIRS.stickers, '_index.json'),
  musicMeta:   path.join(DIRS.music, '_index.json'),
  musicBak:    path.join(DIRS.music, '_index.json.bak'),
  vaultMeta:   path.join(DIRS.vault, '_index.json'),
  adminSessions: path.join(BASE_DIR, '.admin_sessions.json'),
  escrowKey:   path.join(BASE_DIR, '.sdy_escrow.key'),
  // 16.4 · 회원(등록 OTP + 비밀번호 로그인)
  authUsers:    path.join(BASE_DIR, '.sdy_users.json'),
  authSessions: path.join(BASE_DIR, '.sdy_user_sessions.json'),
  // 16.3 · 친구 + 1:1 대화
  friends:      path.join(BASE_DIR, '.sdy_friends.json'),
  dm:           path.join(BASE_DIR, '.sdy_dm.json'),
  notifications: path.join(BASE_DIR, 'notifications.json'),
  acoustid:    path.join(DIRS.music, '_acoustid.json'),
  ytCookies:   path.join(DIRS.music, '_yt_cookies.txt'),
  ytCookiesBak: path.join(BASE_DIR, '_yt_cookies.txt.bak'),
};

export function ensureDirs() {
  for (const d of Object.values(DIRS)) {
    try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ }
  }
}

export const HTML_PATH = path.join(BASE_DIR, 'sdynotes.html');
