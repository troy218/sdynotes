#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   발매판 조립 — 원본 소스는 손대지 않는다

   원칙
     · 읽기만 한다. 원본(sdynotes.html·css·js·src/*)에는 한 바이트도 쓰지 않는다.
     · 결과물은 전부 build/ 안에만 생긴다. build/ 는 통째로 지우고 다시 만든다.
     · 그래서 원본 사이트는 지금과 똑같이 돌아간다.

   실행
     node scripts/build.mjs            # build/ 생성
     node scripts/build.mjs --no-icons # 아이콘 굽기 건너뛰기(빠름)
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP, BRAND, rebrand, brandLine } from '../features.mjs';
import { buildIcons } from './icons.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..');            // play/playstore
const REPO = path.resolve(PKG_DIR, '..', '..');      // 저장소 루트
const OUT = path.join(PKG_DIR, 'build');

const SKIP_ICONS = process.argv.includes('--no-icons');

const log = (...a) => console.log(...a);
const die = (msg) => { console.error('❌ ' + msg); process.exit(1); };

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); }
function copyFile(rel) {
  const src = path.join(REPO, rel), dst = path.join(OUT, rel);
  if (!fs.existsSync(src)) die(`원본에 ${rel} 이 없습니다`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
function copyDir(rel, filter) {
  const src = path.join(REPO, rel);
  if (!fs.existsSync(src)) die(`원본에 ${rel} 이 없습니다`);
  fs.cpSync(src, path.join(OUT, rel), {
    recursive: true,
    filter: (s) => (filter ? filter(s, src) : true)
  });
}

// ── 정리 ──────────────────────────────────────────────────────────────────
if (!fs.existsSync(path.join(REPO, 'sdynotes.html'))) die('저장소 루트를 찾지 못했습니다');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ── 버전 ──────────────────────────────────────────────────────────────────
const pkg = JSON.parse(read(path.join(REPO, 'package.json')));
const VERSION = pkg.version;
const STAMP = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);   // 20260912T1030
const BUILD = `${VERSION}+${STAMP}`;
log(`\n발매판 조립 — ${APP.shortName} ${VERSION} (build ${BUILD})\n`);

// ── ① 원본 그대로 복사 ────────────────────────────────────────────────────
log('① 원본 파일 복사');
for (const f of ['sdynotes.html', 'sdynotes.css', 'sdynotes.js']) copyFile(f);
// src/ 최상위 .js 만 가져온다. src/app/*.js 는 sdynotes.js 로 이미 이어 붙여져
// 있어서(개발용 원본) 빼는 게 맞다 — 앱 셸이 그만큼 가벼워진다.
fs.mkdirSync(path.join(OUT, 'src'), { recursive: true });
const srcFiles = fs.readdirSync(path.join(REPO, 'src')).filter((f) => f.endsWith('.js'));
for (const f of srcFiles) copyFile('src/' + f);
copyDir('assets');
log(`   sdynotes.html · css · js · src/*.js ${srcFiles.length}개 · assets/`);

// ── ② 발매판 자체 파일 ────────────────────────────────────────────────────
// app/ · legal/ 은 원본이 아니라 이 패키지 안에 있다.
fs.cpSync(path.join(PKG_DIR, 'app'), path.join(OUT, 'app'), { recursive: true });
fs.cpSync(path.join(PKG_DIR, 'legal'), path.join(OUT, 'legal'), { recursive: true });

// ── ③ 이름표 바꾸기 (복사본 트리 전체 · 원본은 그대로) ───────────────────
log(`③ 이름표: ${brandLine()}`);
const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.svg', '.json', '.txt']);
let brandFiles = 0, brandHits = 0, guardHits = 0;
(function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) { walk(abs); continue; }
    if (!TEXT_EXT.has(path.extname(ent.name).toLowerCase())) continue;
    const before = read(abs);
    const after = rebrand(before);
    if (after === before) continue;
    brandFiles += 1;
    brandHits += before.split(BRAND.from).length - 1;
    if (after !== before && /동엽신의 끄적끄적/.test(after)) guardHits += 1;
    write(abs, after);
  }
})(OUT);
log(`   ${brandFiles}개 파일 · 표시 이름 ${brandHits}곳 · 옛 제목 무시 규칙 ${guardHits}곳`);

// ── ④ 아이콘 (서비스워커의 미리 받기 목록보다 먼저 만들어야 한다) ─────────
if (SKIP_ICONS) log('④ 아이콘 — 건너뜀(--no-icons)');
else { log('④'); buildIcons(); }

// ── ⑤ HTML 에 앱 메타와 로컬 음악·PWA 스크립트 끼워 넣기 ──────────────────
log('⑤ sdynotes.html 에 앱(PWA) 부분 끼워 넣기');
let html = read(path.join(OUT, 'sdynotes.html'));
const before = html;

const HEAD_ANCHOR = /(<meta name="application-version"[^>]*>)/;
if (!HEAD_ANCHOR.test(html)) die('sdynotes.html 에서 application-version 메타를 찾지 못했습니다');

const headBlock = `<link rel="manifest" href="/manifest.webmanifest">
    <meta name="description" content="${APP.description}">
    <meta name="theme-color" content="${APP.themeColor}">
    <meta name="color-scheme" content="light dark">
    <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
    <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png">
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="${APP.shortName}">
    <meta name="mobile-web-app-capable" content="yes">
    <link rel="stylesheet" href="/app/pwa.css">
    <link rel="stylesheet" href="/app/account.css">
    <meta name="sdy-build" content="${BUILD}">`;
html = html.replace(HEAD_ANCHOR, `$1\n    ${headBlock}`);
if (html === before) die('앱 메타를 끼워 넣지 못했습니다');

// 로컬 음악 셔틀은 반드시 music-player.js 보다 먼저 실행돼야 한다.
//   (플레이어가 fetch 를 가로채인 상태에서 시작해야 한다)
const MUSIC_ANCHOR = /(\s*)(<script src="src\/music-player\.js[^"]*" defer><\/script>)/;
if (!MUSIC_ANCHOR.test(html)) die('sdynotes.html 에서 music-player.js 스크립트 태그를 찾지 못했습니다');
html = html.replace(MUSIC_ANCHOR,
  `\n<script src="/app/pwa.js?v=${VERSION}" defer></script>` +
  `\n<script src="/app/account.js?v=${VERSION}" defer></script>` +
  `\n<script src="/app/local-music.js?v=${VERSION}" defer></script>$1$2`);

write(path.join(OUT, 'sdynotes.html'), html);
log('   메타 주입 · pwa.js·account.js·local-music.js 를 플레이어 앞에 배치');

// ── ⑥ 매니페스트 ──────────────────────────────────────────────────────────
log('⑥ 매니페스트');
const manifest = {
  id: APP.id,
  name: APP.name,
  short_name: APP.shortName,
  description: APP.description,
  lang: APP.lang,
  dir: APP.dir,
  start_url: APP.startUrl,
  scope: APP.scope,
  display: APP.display,
  display_override: ['standalone', 'minimal-ui'],
  orientation: APP.orientation,
  theme_color: APP.themeColor,
  background_color: APP.backgroundColor,
  categories: ['productivity', 'education', 'utilities'],
  icons: [
    { src: '/icons/icon-144.png', sizes: '144x144', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ],
  shortcuts: [
    { name: '새 노트', short_name: '새 노트', url: `${APP.startUrl}&new=1` }
  ],
  prefer_related_applications: false
};
write(path.join(OUT, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
log('   /manifest.webmanifest (아이콘 4종 · 바로가기 1개)');

// ── ⑦ 서비스워커 (빌드 값·미리 받기 목록 주입) ────────────────────────────
log('⑦ 서비스워커');
let sw = read(path.join(PKG_DIR, 'app', 'sw.js'));
if (!sw.includes("__SDY_BUILD__")) die('sw.js 에 __SDY_BUILD__ 자리표시자가 없습니다');

// 미리 받을 목록 = 앱 셸 그대로. 실제 파일이 없으면 설치가 계속 실패하므로
// 목록에 넣기 전에 존재를 확인한다.
const shell = new Set(['/', '/manifest.webmanifest', '/icons/favicon-32.png',
  '/privacy', '/terms', '/legal/privacy.html', '/legal/terms.html',
  '/icons/icon-144.png', '/icons/icon-192.png', '/icons/icon-512.png',
  '/icons/maskable-512.png', '/icons/apple-touch-icon.png']);

// HTML 은 'src/music-player.js' 처럼 상대 경로를 쓴다. 앞 슬래시를 붙여 담는다.
for (const m of html.matchAll(/(?:src|href)="((?:\/)?(?:src|app)\/[^"?]+)(?:\?[^"]*)?"/g)) {
  shell.add(m[1].startsWith('/') ? m[1] : '/' + m[1]);
}
for (const f of ['/sdynotes.js', '/sdynotes.css']) shell.add(f);

// 확장자 없는 주소는 서버가 파일로 내보내는 경로다 — 실제 파일로 바꿔서 확인한다.
const ROUTE_FILE = { '/': 'sdynotes.html', '/privacy': 'legal/privacy.html', '/terms': 'legal/terms.html' };
const fileOf = (u) => path.join(OUT, (ROUTE_FILE[u] || u.replace(/^\//, '')));
const missing = [...shell].filter((u) => !fs.existsSync(fileOf(u)));
if (missing.length) die('미리 받기 목록에 없는 파일이 있습니다: ' + missing.join(', '));

sw = sw.replace('__SDY_BUILD__', BUILD)
  .replace("const PRECACHE = ['/'];",
    'const PRECACHE = [\n' + [...shell].map((u) => `  '${u}'`).join(',\n') + '\n];');
// 이 파일은 템플릿에서 새로 만들어지므로 이름표를 여기서도 입힌다
write(path.join(OUT, 'sw.js'), rebrand(sw));

let shellBytes = 0;
for (const u of shell) shellBytes += fs.statSync(fileOf(u)).size;
log(`   /sw.js — 미리 받기 ${shell.size}개 · ${(shellBytes / 1048576).toFixed(2)}MB`);

// ── ⑧ 빌드 기록 ──────────────────────────────────────────────────────────
write(path.join(OUT, 'version.json'), JSON.stringify({
  app: APP.shortName,
  version: VERSION,
  build: BUILD,
  builtAt: new Date().toISOString(),
  shellFiles: [...shell],
  audience: APP.audience,
  packageId: APP.packageId,
  storeRequirements: {
    privacyPolicyUrl: '/privacy',
    termsUrl: '/terms',
    accountDeletion: 'POST /api/auth/account/delete (앱: 계정 화면 → 계정 삭제)',
    offlineAppShell: true,
    aiDataNotice: '개인정보처리방침 1-다 · 이용약관 제5조'
  },
  note: '원본 저장소에서 조립한 발매판. 원본 코드는 수정되지 않았다.'
}, null, 2) + '\n');

log(`\n✅ 완료 — ${path.relative(REPO, OUT)}/\n`);
log('   미리 보기:  node scripts/serve.mjs');
log('   검사:      node scripts/verify.mjs\n');
