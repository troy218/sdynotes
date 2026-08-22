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
};

export const FILES = {
  stickerMeta: path.join(DIRS.stickers, '_index.json'),
  musicMeta:   path.join(DIRS.music, '_index.json'),
  musicBak:    path.join(DIRS.music, '_index.json.bak'),
  vaultMeta:   path.join(DIRS.vault, '_index.json'),
  adminSessions: path.join(BASE_DIR, '.admin_sessions.json'),
  escrowKey:   path.join(BASE_DIR, '.sdy_escrow.key'),
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
