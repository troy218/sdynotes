/* ═══════════════════════════════════════════════════════════════════════════
   /.well-known/assetlinks.json — TWA(안드로이드 앱)가 주소창 없이 열리게 하는 열쇠

   왜 필요한가
     TWA(Trusted Web Activity)는 "이 앱은 이 사이트의 앱이다"를 증명해야
     주소창이 사라진다. 그 증명서가 이 파일이다. 없으면 스토어 앱을 열어도
     크롬이 주소창을 그대로 보여 준다 — 심사에서도 지적된다.

   값은 어디서 오나
     ① 앱 루트의 .well-known/assetlinks.json 파일 (scripts/twa-prepare.mjs 가 만들어 둔다)
     ② 환경변수 SDY_ANDROID_SHA256 / SDY_ANDROID_PACKAGE (여러 개는 쉼표로)

   ⚠ 지문은 **서명 키(keystore)의 SHA-256** 이다.
     구글플레이에 올려 심사용 키로 다시 서명된 앱은 **플레이 앱 서명 키의 지문도**
     함께 넣어야 한다(Play Console → 앱 무결성). 둘 다 넣으면 어느 쪽으로 설치돼도 열린다.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { BASE_DIR } from '../lib/paths.js';

function fromEnv() {
  const raw = String(process.env.SDY_ANDROID_SHA256 || '').trim();
  if (!raw) return null;
  const pkg = String(process.env.SDY_ANDROID_PACKAGE || 'app.notesis.notes').trim();
  const prints = raw.split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => (s.startsWith('SHA256:') ? s : 'SHA256:' + s.replace(/:/g, '')));
  if (!prints.length) return null;
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: pkg,
      sha256_cert_fingerprints: prints,
    },
  }];
}

function fromFile() {
  const p = path.join(BASE_DIR, '.well-known', 'assetlinks.json');
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(j) && j.length ? j : null;
  } catch { return null; }
}

export function assetLinks() {
  return fromEnv() || fromFile() || null;
}

export function registerWellKnown(app) {
  // 안드로이드가 요구하는 경로 그대로 (/.well-known/assetlinks.json)
  app.get('/.well-known/assetlinks.json', async (req, reply) => {
    const list = assetLinks();
    if (!list) {
      // 아직 준비 안 됨 — 404 로 두면 TWA 가 '주소창 있는 모드'로 열린다(앱은 정상 동작).
      return reply.code(404).send({
        ok: false,
        error: '아직 서명 지문이 등록되지 않았습니다',
        how: 'node scripts/twa-prepare.mjs --fingerprint <SHA256> 로 등록하세요'
      });
    }
    reply.header('Content-Type', 'application/json');
    reply.header('Cache-Control', 'no-store');
    return reply.send(JSON.stringify(list, null, 2));
  });

  // 상태 확인용 — 운영자가 "TWA 가 붙었나"를 바로 볼 수 있게
  app.get('/api/app/status', async (req, reply) => {
    const list = assetLinks();
    return reply.send({
      ok: true,
      twa: {
        ready: !!list,
        package: (list && list[0] && list[0].target && list[0].target.package_name) || null,
        fingerprints: (list && list[0] && list[0].target && list[0].target.sha256_cert_fingerprints) || [],
      },
    });
  });
}
