// Shared helper: read all frontend JS (main bundle + extracted modules).
// Tests that pattern-match the frontend source should use readAllJS()
// instead of reading sdynotes.js alone, so code extracted to src/*.js
// is still covered.
import fs from 'node:fs';

const PARTS = [
  '../sdynotes.js',
  '../src/music-player.js',
  '../src/focus-clock.js',
  '../src/live-updates.js',
  '../src/idle-worker.js',
  '../src/mobile-viewport.js',
  '../src/auth.js',
  '../src/ai-assistant.js',
  '../src/chat.js',
  '../src/translate.js',
];

export function readAllJS() {
  return PARTS
    .map(p => {
      try { return fs.readFileSync(new URL(p, import.meta.url), 'utf8'); }
      catch { return ''; }
    })
    .join('\n');
}
