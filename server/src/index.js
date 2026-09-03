// SDYnotes backend — Fastify main server (14.8.0 renewed).
// Lightweight endpoints run here; heavy jobs (PDF import, music tagging,
// AcoustID, YouTube) run in the Python worker and are proxied.
import './lib/env.js';   // 16.2 · .env 로더 — config 가 env 를 읽기 전에(가장 먼저)
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import compress from '@fastify/compress';
import { ensureDirs } from './lib/paths.js';
import { APP_VERSION, oracleStorage } from './lib/config.js';
import { compressOptions, noCompressForBinaryRoutes } from './lib/perf.js';
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
import { registerAi } from './routes/ai.js';
import { registerNotify } from './routes/notify.js';
import { registerLive } from './routes/live.js';
import { registerMisc } from './routes/misc.js';
import { registerMusic } from './routes/music.js';
import { registerChat } from './routes/chat.js';
import { registerDb } from './routes/db.js';
import { registerAuth } from './routes/auth.js';
import { registerFriends } from './routes/friends.js';
import { registerDm } from './routes/dm.js';
import { userAuthBoot } from './lib/userauth.js';
import { friendsBoot } from './lib/friends.js';
import { dmBoot } from './lib/dmstore.js';

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
// 14.13.5 · 2코어 박스 — JSON 응답 압축을 켠다. MB 단위 동기화/목록 페이로드의
// 대역폭을 크게 줄이고, 압축 CPU 는 2코어에서 감당할 여유가 생겼다.
// 파일·바이너리 스트림(이미지/음성/영상/다운로드)은 압축 이득이 없는데 큰 파일을
// 압축기로 돌리면 CPU 만 태우므로 제외한다 (compress 플러그인보다 먼저 등록).
app.addHook('onRoute', noCompressForBinaryRoutes());
await app.register(compress, compressOptions());

const worker = createWorkerProxy({ app });

registerPages(app);
registerSync(app);
registerAdmin(app);
registerVault(app);
registerCards(app);
registerStickers(app);
registerWallpaper(app);
registerTranslate(app);
registerAi(app);      // 14.20.0 · AI 노트 도우미 (요약·질문)
registerNotify(app);
registerLive(app);
registerMisc(app);
registerMusic(app, { worker });
registerChat(app);
registerDb(app);
registerAuth(app);
registerFriends(app);   // 16.3 · 친구 (회원끼리)
registerDm(app);        // 16.3 · 친구와의 1:1 대화 + 회원 SSE

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
await userAuthBoot();   // 16.4 · 회원(등록 OTP + 비밀번호) 사용자·세션 읽어 두기
await friendsBoot();    // 16.3 · 친구 관계 읽어 두기
await dmBoot();         // 16.3 · 1:1 대화 저장소 읽어 두기

const port = parseInt(process.env.PORT || '5000', 10);

app.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log('='.repeat(52));
  console.log(`  SDYnotes ${APP_VERSION} 서버 실행 중 (Fastify)`);
  console.log(`  브라우저에서 http://localhost:${port} 로 접속하세요`);
  console.log(`  저장소: ${oracleStorage()
    ? `oracle (이 서버 디스크 — Supabase/Cloudinary 미사용)`
    : `legacy cloud (Supabase+Cloudinary)`}`);
  console.log('='.repeat(52));
});
