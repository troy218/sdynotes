/* ═══════════════════════════════════════════════════════════════════════════
   변환 결과를 기기로 내보내고, 서버에서는 지운다

   왜 이렇게 하나 (사용자 결정 16.7)
     "서버에서 변환해서 그 로컬 기기에 보내준 후 내 서버에서는 지우는 방향으로."
     논문 PDF 한 편이 서버에 만드는 파일은 실측 0.7MB(텍스트)~16MB(스캔)다.
     보관하면 원가가 선형으로 늘고, 무엇보다 연구자에게 "논문이 서버에 남는다"는
     것이 곧 거부감이다. 그래서 **서버는 변환(CPU)만 하고 보관은 기기가 한다.**

   흐름
     ① 기기: PDF 업로드 → 서버(워커)가 변환
     ② 기기: GET /api/import/bundle/:jid  ← 문서 본문 + 배경 이미지를 한 줄로 받음
     ③ 기기: 매니페스트와 대조해 다 받았는지 확인 → IndexedDB 에 저장
     ④ 기기: POST /api/import/release/:jid {bytes}  ← "다 받았다"
     ⑤ 서버: 그때 문서 파일과 (다른 문서가 안 쓰는) 배경 이미지를 지운다

   안전 원칙 — 지우는 쪽이 아니라 남기는 쪽으로 실패한다
     · ③이 실패하면 ④를 부르지 않는다 → 서버에 그대로 남는다(다시 받으면 된다)
     · ④에서 크기가 다르면 서버가 거절한다(size_mismatch) → 지우지 않는다
     · 다른 문서·다른 회원이 함께 쓰는 배경 이미지는 남긴다

   번들 형식 (바이너리 · base64 없음)
     magic "SDYB1\n"
     반복:  u32 이름길이 | 이름(utf8) | u32 크기 | 내용
     마지막: 이름 "#manifest" 인 항목 하나 (JSON)
     끝:    u32 0
     이름 앞 d/ = 문서 본문 파일, i/ = 배경 이미지
   ═══════════════════════════════════════════════════════════════════════════ */
import { importsBundleList, importsRelease, importsLocalList, importsOwnerOf } from '../lib/imports.js';
import { bundleChunks } from '../lib/bundle.js';
import { extractUserToken, userByTokenSync } from '../lib/userauth.js';

function uidOf(req) {
  try {
    const tok = extractUserToken(req);
    const u = tok ? userByTokenSync(tok) : null;
    return (u && u.uid) || '';
  } catch { return ''; }
}

export function registerImportBundle(app) {
  // ── ② 번들 내려보내기 ────────────────────────────────────────────────────
  //   큰 문서는 수백 MB 가 될 수 있어 전부 메모리에 올리지 않는다.
  //   파일마다 헤더를 쓰고 그 파일만 읽어 흘려보낸다(메모리 사용은 파일 하나 크기).
  app.get('/api/import/bundle/:jid', async (req, reply) => {
    const jid = req.params.jid;
    const me = uidOf(req);
    const owner = importsOwnerOf(jid);
    if (owner && owner.uid && me && String(owner.uid) !== me) {
      return reply.code(403).send({ ok: false, error: '이 문서를 가져온 회원이 아니에요', code: 'not_owner' });
    }

    const list = await importsBundleList(jid);
    if (!list) return reply.code(404).send({ ok: false, error: '없는 문서예요', code: 'gone' });

    reply
      .code(200)
      .header('Content-Type', 'application/vnd.sdy.bundle')
      .header('Cache-Control', 'no-store')
      .header('X-SDY-Bundle-Files', String(list.files))
      .header('X-SDY-Bundle-Bytes', String(list.bytes));

    // 형식은 lib/bundle.js 한 곳에만 있다 (서버·검사가 같은 코드를 쓴다)
    return reply.send((async function* () {
      for (const chunk of bundleChunks(list)) yield chunk;
    })());
  });

  // ── ④⑤ 다 받았다고 알리면 서버 사본 삭제 ────────────────────────────────
  app.post('/api/import/release/:jid', async (req, reply) => {
    const me = uidOf(req);
    const d = req.body || {};
    const r = await importsRelease(req.params.jid, me, {
      files: Number(d.files) || 0,
      bytes: Number(d.bytes) || 0,
    });
    if (!r.ok) return reply.code(r.code === 'not_owner' ? 403 : 409).send(r);
    if (r.docs || r.images) {
      console.log(`[imports] 기기로 옮기고 서버 사본 삭제 — ${req.params.jid} · 문서 ${r.docs} · 이미지 ${r.images} · ${Math.round(r.bytes / 1048576)}MB` +
        (r.kept_shared ? ` (공유 이미지 ${r.kept_shared}개는 남김)` : ''));
    }
    return reply.send(r);
  });

  // ── 서버에 없는 문서인지 먼저 물어보는 용도 ─────────────────────────────
  //   기기가 다른 기기에서 가져온 논문을 열려 할 때, "이 기기에는 없고
  //   서버에도 없다"를 분명히 알려 주기 위한 얇은 확인 창구다.
  app.get('/api/import/where/:jid', async (req, reply) => {
    const jid = req.params.jid;
    const onServer = !!(await importsBundleList(jid));
    const owner = importsOwnerOf(jid);
    return reply.send({
      ok: true, jid,
      on_server: onServer,
      on_device_only: !onServer && !!(owner && owner.local),
      owner: owner ? { uid: owner.uid, at: owner.at, name: owner.name || '' } : null,
    });
  });

  // ── 내가 기기로 옮긴 논문 목록 ─────────────────────────────────────────
  app.get('/api/import/local', async (req, reply) => {
    const me = uidOf(req);
    if (!me) return reply.code(401).send({ ok: false, error: '로그인이 필요해요' });
    return reply.send({ ok: true, docs: await importsLocalList(me) });
  });
}
