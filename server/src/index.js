// SDYnotes backend — Fastify main server (14.8.0 renewed).
// Lightweight endpoints run here; heavy jobs (PDF import, music tagging,
// AcoustID, YouTube) run in the Python worker and are proxied.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { ensureDirs } from './lib/paths.js';
import { APP_VERSION, sbEnabled, CLOUD_READY } from './lib/config.js';
import { sessionsLoad } from './lib/admin.js';
import { createWorkerProxy } from './lib/workerProxy.js';

import { registerPages } from './routes/pages.js';
import { registerSync } from './routes/sync.js';
import { registerAdmin } from './routes/admin.js';
import { registerVault } from './routes/vault.js';
import { registerCards } from './routes/cards.js';
import { registerStickers } from './routes/stickers.js';
import { registerWallpaper } from './routes/wallpaper.js';
import { registerTranslate } from './routes/translate.js';
import { registerNotify } from './routes/notify.js';
import { registerLive } from './routes/live.js';
import { registerMisc } from './routes/misc.js';
import { registerMusic } from './routes/music.js';
import { registerChat } from './routes/chat.js';

ensureDirs();

const app = Fastify({
  logger: false,
  bodyLimit: 512 * 1024 * 1024,
  keepAliveTimeout: 900000,
  connectionTimeout: 0,
  trustProxy: true,
});

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 512 * 1024 * 1024, files: 1 } });

const worker = createWorkerProxy({ app });

registerPages(app);
registerSync(app);
registerAdmin(app);
registerVault(app);
registerCards(app);
registerStickers(app);
registerWallpaper(app);
registerTranslate(app);
registerNotify(app);
registerLive(app);
registerMisc(app);
registerMusic(app, { worker });
registerChat(app);

// worker proxy for the import pipeline (kept verbatim in Python)
for (const [method, url] of [
  ['POST', '/api/import/upload'],
  ['POST', '/api/import/doc'],
  ['POST', '/api/import/reconv'],
  ['GET', '/api/import/status'],
  ['GET', '/api/import/docfile/:jid'],
  ['GET', '/api/import/img/*'],
  ['GET', '/api/import/bg/:ref/:pno'],
]) {
  app.route({ method, url, handler: (req, reply) => worker.proxy(req, reply) });
}

await sessionsLoad();

const port = parseInt(process.env.PORT || '5000', 10);

app.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log('='.repeat(52));
  console.log(`  SDYnotes ${APP_VERSION} 서버 실행 중 (Fastify)`);
  console.log(`  브라우저에서 http://localhost:${port} 로 접속하세요`);
  console.log(`  cloud sync: ${sbEnabled() && CLOUD_READY ? 'ready' : 'local fallback'}`);
  console.log('='.repeat(52));
});
