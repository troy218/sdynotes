#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   TWA 준비 — 서명 지문 등록 + 빌드 명령 안내

   TWA(Trusted Web Activity)는 "이 안드로이드 앱은 이 사이트의 앱이다"를
   증명해야 주소창이 사라진다. 증명서가 /.well-known/assetlinks.json 이고,
   그 안에 **서명 키의 SHA-256 지문**이 들어간다.

   쓰는 법
     node scripts/twa-prepare.mjs                 # 도메인은 site.mjs 에서 온다
     node scripts/twa-prepare.mjs --host 다른주소
     node scripts/twa-prepare.mjs --keystore android.keystore --alias notesis
     node scripts/twa-prepare.mjs --fingerprint AB:CD:... [--fingerprint ...]
     node scripts/twa-prepare.mjs --print        # 지금 설정만 보기

   이 스크립트가 하는 일
     ① twa/twa-manifest.json 의 host 를 채운다 (없으면 만든다)
     ② 지문을 모아 저장소 루트의 .well-known/assetlinks.json 을 쓴다
     ③ 서버가 그 파일을 그대로 내보낸다 (server/src/routes/wellknown.js)
     ④ bubblewrap 빌드 명령을 알려 준다 — JDK·Android SDK 가 있으면 실제로 실행

   ⚠ 지문을 넣지 않으면 앱은 열리되 **주소창이 남는다.** 스토어 심사에서 지적된다.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APP } from '../features.mjs';
// 도메인은 발매판 공통 출처(site.mjs)에서 온다 — 옛 주소 → notesis.com 이전도 그 한 줄이다.
import { activeDomain } from '../../../site.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const REPO = path.resolve(PKG, '..', '..');
const WELL_KNOWN = path.join(REPO, '.well-known');
const ASSETLINKS = path.join(WELL_KNOWN, 'assetlinks.json');
const MANIFEST = path.join(PKG, 'twa', 'twa-manifest.json');

// ── 인자 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : null;
};
const all = (f) => {
  const out = [];
  argv.forEach((a, i) => { if (a === f && argv[i + 1]) out.push(argv[i + 1]); });
  return out;
};

const norm = (s) => String(s || '').replace(/^SHA256:/i, '').replace(/:/g, '').trim().toUpperCase();
const pretty = (hex) => (hex.match(/.{2}/g) || []).join(':');

function have(cmd) {
  const r = spawnSync(cmd, ['-version'], { stdio: 'ignore' });
  if (r.error) return false;
  return true;
}

// ── 지문 모으기 ─────────────────────────────────────────────────────────
let prints = all('--fingerprint').map(norm).filter(Boolean);

const keystore = val('--keystore');
if (keystore && fs.existsSync(keystore)) {
  if (!have('keytool')) {
    console.warn('⚠️  keytool(JDK)이 없어 키스토어에서 지문을 읽지 못했습니다.');
  } else {
    const r = spawnSync('keytool', [
      '-list', '-v', '-keystore', keystore,
      '-alias', val('--alias') || APP.packageId.split('.').pop(),
      '-storepass', process.env.SDY_KEYSTORE_PASS || val('--storepass') || ''
    ], { encoding: 'utf8' });
    if (r.status === 0) {
      const m = /SHA256:\s*([0-9A-Fa-f:]{95})/.exec(r.stdout || '');
      if (m) { prints.push(norm(m[1])); console.log(`키스토어에서 지문을 읽었습니다: ${pretty(norm(m[1]))}`); }
      else console.warn('⚠️  키스토어는 열렸지만 SHA256 지문을 찾지 못했습니다.');
    } else {
      console.warn('⚠️  keytool 실패 — 비밀번호를 확인하세요.');
    }
  }
}

// 기존 파일이 있으면 유지 (지문을 새로 주지 않았을 때)
if (!prints.length && fs.existsSync(ASSETLINKS)) {
  try {
    const cur = JSON.parse(fs.readFileSync(ASSETLINKS, 'utf8'));
    const t = cur[0] && cur[0].target;
    prints = ((t && t.sha256_cert_fingerprints) || []).map(norm).filter(Boolean);
    if (prints.length) console.log(`이미 등록된 지문 ${prints.length}개를 유지합니다.`);
  } catch { /* noop */ }
}

const host = val('--host') || activeDomain();

// ── --print ─────────────────────────────────────────────────────────────
if (has('--print') || (!prints.length && !host)) {
  console.log('\nTWA 준비 상태');
  console.log('─'.repeat(56));
  console.log(`  앱 이름   : ${APP.name}`);
  console.log(`  패키지    : ${APP.packageId}`);
  console.log(`  도메인    : ${host || '(아직 없음 — --host 로 지정하세요)'}`);
  console.log(`  지문      : ${prints.length ? prints.map(pretty).join('\n              ') : '(아직 없음)'}`);
  console.log(`  assetlinks: ${fs.existsSync(ASSETLINKS) ? ASSETLINKS : '(아직 없음)'}`);
  console.log('─'.repeat(56));
  if (!host || !prints.length) {
    console.log(`
다음 두 가지가 있어야 TWA 가 '주소창 없는 앱'으로 열립니다.

  1) 서버 도메인 (HTTPS 로 열리는 실제 주소)
       node scripts/twa-prepare.mjs --host <도메인>

  2) 서명 키의 SHA-256 지문
     · 아직 키가 없다면 (이 명령으로 만들어집니다):
         keytool -genkey -v -keystore android.keystore -alias notesis \\
           -keyalg RSA -keysize 2048 -validity 10000
     · 키가 있으면 지문을 읽어 등록:
         node scripts/twa-prepare.mjs --keystore android.keystore --alias notesis
     · 지문만 알고 있으면:
         node scripts/twa-prepare.mjs --fingerprint <SHA256>

  ※ 구글플레이에 올린 뒤에는 **플레이 앱 서명 키의 지문**도 함께 넣으세요
    (Play Console → 출시 → 앱 무결성 → 앱 서명 키 인증서).
    두 지문을 다 넣으면 어느 쪽으로 설치돼도 주소창이 사라집니다.
`);
  }
  process.exit(0);
}

// ── ① twa-manifest.json ─────────────────────────────────────────────────
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
let man = {};
if (fs.existsSync(MANIFEST)) {
  try { man = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { man = {}; }
}
man.packageId = APP.packageId;
man.host = host || man.host || '';
man.name = APP.name;
man.launcherName = APP.shortName;
man.display = 'standalone';
man.themeColor = APP.themeColor;
man.navigationColor = APP.themeColor;
man.backgroundColor = APP.backgroundColor;
man.startUrl = '/';
man.iconUrl = `https://${man.host}/icons/icon-512.png`;
man.maskableIconUrl = `https://${man.host}/icons/maskable-512.png`;
man.monochromeIconUrl = '';
man.webManifestUrl = `https://${man.host}/manifest.webmanifest`;
man.appVersionName = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
man.appVersionCode = Number(String(man.appVersionName).split('.').reduce((a, b) => a * 1000 + Number(b), 0)) || 1;
man.shortcuts = [];
man.generatorApp = 'bubblewrap-cli';
man.enableNotifications = false;
man.enableSiteSettingsShortcut = true;
man.isChromeOSOnly = false;
man.isMetaQuestApp = false;
man.orientation = 'any';
man.fingerprints = prints.map((p) => ({ name: '서명 키', value: pretty(p) }));
man.additionalTrustedOrigins = [];
man.webviewFallback = 'none';   // 주소창 있는 웹뷰로 떨어지지 않게(사이트가 이미 반응형)
write(MANIFEST, JSON.stringify(man, null, 2) + '\n');
console.log(`✅ twa/twa-manifest.json 갱신 (host: ${man.host})`);

// ── ② assetlinks.json ───────────────────────────────────────────────────
const links = [{
  relation: ['delegate_permission/common.handle_all_urls'],
  target: {
    namespace: 'android_app',
    package_name: APP.packageId,
    sha256_cert_fingerprints: prints.map(pretty),
  },
}];
fs.mkdirSync(WELL_KNOWN, { recursive: true });
write(ASSETLINKS, JSON.stringify(links, null, 2) + '\n');
console.log(`✅ .well-known/assetlinks.json 기록 (지문 ${prints.length}개)`);
console.log('   서버가 /.well-known/assetlinks.json 으로 그대로 내보냅니다.');

// ── ③ 확인 ──────────────────────────────────────────────────────────────
if (man.host) {
  console.log(`\n배포 후 이 주소가 열리는지 확인하세요 (앱 열기 전 필수):`);
  console.log(`   https://${man.host}/.well-known/assetlinks.json`);
  console.log(`   https://${man.host}/api/app/status`);
}

// ── ④ 빌드 ──────────────────────────────────────────────────────────────
const jdkOK = have('keytool') || have('java');
const sdkOK = !!(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT ||
  fs.existsSync(path.join(process.env.HOME || '', 'Android')));

console.log('\n' + '─'.repeat(56));
console.log('  AAB 빌드 (안드로이드 앱 묶음 — 갤럭시스토어·플레이 공용)');
console.log('─'.repeat(56));
console.log(`  JDK       : ${jdkOK ? '있음' : '없음'}`);
console.log(`  Android SDK: ${sdkOK ? '있음' : '없음'}`);
console.log(`
  준비물이 있으면 이 순서로 (한 번만 하면 됩니다):

    npm i -g @bubblewrap/cli
    cd play/playstore/twa
    bubblewrap init --manifest twa-manifest.json --directory android
    bubblewrap build            # → app-release-bundle.aab · app-release-signed.apk

  처음 build 할 때 키스토어를 만들라고 물어봅니다 — 그때 만든 키를 **꼭 보관**하세요.
  잃어버리면 앱을 영영 업데이트할 수 없습니다.

  만든 키의 지문을 다시 등록해야 합니다(그래야 주소창이 사라짐):
    node ../scripts/twa-prepare.mjs --keystore android.keystore --alias <별칭>

  그다음 .well-known/assetlinks.json 을 서버에 배포하고, 위 주소로 확인한 뒤
  AAB 를 갤럭시스토어 Seller Portal / Play Console 에 올리면 됩니다.
`);
if (!jdkOK || !sdkOK) {
  console.log('  ⚠️  이 환경에는 JDK/Android SDK 가 없어 여기서는 AAB 를 만들 수 없습니다.');
  console.log('      위 명령을 JDK(17 이상)와 Android SDK 가 있는 기기에서 실행하세요.\n');
}

function write(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
}
