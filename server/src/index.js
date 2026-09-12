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
import { extractUserToken, userByTokenSync } from './lib/userauth.js';
import { importsBoot, importsRecord, importsCheckQuota } from './lib/imports.js';

import { registerPages } from './routes/pages.js';
import { registerSync } from './routes/sync.js';
import { registerAdmin } from './routes/admin.js';
import { registerVault } from './routes/vault.js';
import { registerCards } from './routes/cards.js';
import { registerStickers } from './routes/stickers.js';
import { registerWallpaper } from './routes/wallpaper.js';
import { registerTranslate } from './routes/translate.js';
import { registerAi } from './routes/ai.js';
import { registerAiTools } from './routes/aiTools.js';
import { registerNotify } from './routes/notify.js';
import { registerLive } from './routes/live.js';
import { registerMisc } from './routes/misc.js';
import { registerPapers } from './routes/papers.js';
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
registerAiTools(app); // 14.30.0 · 해돌이 인터넷 도구 (웹 검색 · 사진 검색/저장)
registerNotify(app);
registerLive(app);
registerMisc(app);
registerPapers(app); // 등록한 키워드로 찾는 arXiv 오늘의 추천 논문
registerMusic(app, { worker });
registerChat(app);
registerDb(app);
registerAuth(app);
registerFriends(app);   // 16.3 · 친구 (회원끼리)
registerDm(app);        // 16.3 · 친구와의 1:1 대화 + 회원 SSE

// worker proxy for the import pipeline (kept verbatim in Python)
// 16.6 · /api/import/doc 만 전용으로 등록한다 (아래 목록에서 뺐다) —
//   잡을 만든 순간 '누가 가져왔는지'를 적어 두고, 구독자 용량을 넘었는지 본다.
//   응답이 작은 JSON(수 KB)이라 통째로 받아 읽어도 부담이 없다.
app.post('/api/import/doc', (req, reply) => importDocGuard(req, reply, worker));

for (const [method, url] of [
  ['POST', '/api/import/upload'],
  ['POST', '/api/import/reconv'],
  ['GET', '/api/import/status'],
  ['GET', '/api/import/docfile/:jid'],
  // 14.39.3 · 편집된 쪽 저장. 워커는 이 경로의 GET(슬라이스 읽기)과 POST(편집 쪽
  //  저장)을 같은 경로로 받는데(methods=["GET","POST"]), 프록시 목록에는 GET 만
  //  올라 있었다. 그 덕분에 가져온 문서(PDF/문서 가져오기)에서 그림 옮기기·글자
  //  고치기·번역 저장이 전부 404 로 막혀 클라이언트 재시도 3회 후 조용히 버려졌고,
  //  다시 열면 편집이 증발했다 (사용자 보고 "이미지를 이동하려고 선택하면 주변
  //  수식이 사라짐" — 화면 가림 버그와 함께 이 저장 누락까지 수정).
  ['POST', '/api/import/docfile/:jid'],
  ['GET', '/api/import/img/*'],
  ['GET', '/api/import/bg/:ref/:pno'],
  ['GET', '/api/import/page/:ref/:pno'],   // 쪽 미리보기 래스터(읽기 화면 즉시 표시)
]) {
  app.route({ method, url, handler: (req, reply) => worker.proxy(req, reply) });
}

await sessionsLoad();
await userAuthBoot();   // 16.4 · 회원(등록 OTP + 비밀번호) 사용자·세션 읽어 두기
await friendsBoot();    // 16.3 · 친구 관계 읽어 두기
await dmBoot();         // 16.3 · 1:1 대화 저장소 읽어 두기
await importsBoot();    // 16.6 · 가져온 문서의 임자·용량 기록

// ── 16.6 · 가져오기 전용 입구 ────────────────────────────────────────────
//  ① 용량이 꽉 찬 회원이면 워커에 넘기지 않고 바로 알린다(CPU·디스크를 쓰지 않는다)
//  ② 잡이 만들어지면 그 회원을 임자로 적어 둔다 — 계정 삭제 때 함께 지우기 위해서
async function importDocGuard(req, reply, worker) {
  let uid = '';
  try {
    const tok = extractUserToken(req);
    const u = tok ? userByTokenSync(tok) : null;
    uid = (u && u.uid) || '';
  } catch { uid = ''; }

  if (uid) {
    try {
      const q = await importsCheckQuota(uid);
      if (!q.ok) {
        return reply.code(413).send({
          ok: false, code: 'import_quota',
          error: '보관 용량이 가득 찼어요 · 오래된 논문을 정리하면 다시 가져올 수 있어요',
          used: q.usage.bytes, quota: q.quota,
        });
      }
    } catch (e) {
      console.error(`[imports] 용량 확인 실패: ${e?.message || e}`);   // 확인이 안 되면 통과시킨다
    }
  }

  // 응답에서 jid 를 읽어야 하므로 이 요청만 작은 본문을 모아서 본다
  const send = reply.send.bind(reply);
  reply.send = (payload) => {
    try {
      if (payload && typeof payload.pipe === 'function') {
        const chunks = [];
        payload.on('data', (c) => chunks.push(c));
        payload.on('end', () => {
          const buf = Buffer.concat(chunks);
          recordFrom(buf, uid);
          send(buf);
        });
        payload.on('error', () => send(payload));
        return reply;
      }
      recordFrom(payload, uid);
    } catch (e) {
      console.error(`[imports] 임자 기록 실패: ${e?.message || e}`);
    }
    return send(payload);
  };

  return worker.proxy(req, reply);
}

function recordFrom(payload, uid) {
  if (!payload) return;
  let j = null;
  try {
    const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
    j = JSON.parse(text);
  } catch { return; }
  if (!j || !j.jid) return;
  importsRecord(j.jid, uid, { pages: j.pages || j.total || 0, name: j.name || '' })
    .catch((e) => console.error(`[imports] 기록 실패: ${e?.message || e}`));
}

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
