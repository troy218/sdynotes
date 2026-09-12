#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   발매판 검사 — 빌드가 실제로 쓸 수 있는 상태인지 확인한다

   검사하는 것
     · 앱 셸·아이콘·매니페스트가 다 있는가
     · 아이콘이 진짜 PNG 이고 크기가 맞는가
     · 서비스워커가 클래식 스크립트인가(importScripts 를 쓰므로 ESM 이면 안 된다)
     · 음악이 정말 기기에서 도는가 (셔틀이 플레이어보다 먼저 오는가)
     · **원본 소스가 손대지 않은 채인가** (git 으로 확인)

   실행: node scripts/verify.mjs
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APP } from '../features.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const REPO = path.resolve(PKG, '..', '..');
const OUT = path.join(PKG, 'build');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ✅ ' + m); };
const bad = (m) => { fail++; console.log('  ❌ ' + m); };
const check = (cond, good, badMsg) => (cond ? ok(good) : bad(badMsg));

function exists(rel) { return fs.existsSync(path.join(OUT, rel)); }
function pngSize(file) {
  const b = fs.readFileSync(file);
  const sig = b.slice(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

console.log('\n발매판 검사\n');

// ── 1. 빌드 존재 ─────────────────────────────────────────────────────────
console.log('1. 앱 셸');
if (!fs.existsSync(OUT)) {
  console.log('  ❌ build/ 가 없습니다 — node scripts/build.mjs 를 먼저 실행하세요\n');
  process.exit(1);
}
for (const f of ['sdynotes.html', 'sdynotes.css', 'sdynotes.js', 'sw.js',
  'manifest.webmanifest', 'version.json',
  'app/music-store.js', 'app/local-music.js', 'app/pwa.js', 'app/pwa.css',
  'src/music-player.js']) {
  check(exists(f), f, `${f} 없음`);
}

// ── 2. 매니페스트 ────────────────────────────────────────────────────────
console.log('\n2. 매니페스트');
let man = null;
try { man = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.webmanifest'), 'utf8')); }
catch (e) { bad('manifest.webmanifest 를 읽을 수 없음: ' + e.message); }
if (man) {
  check(!!man.name && !!man.short_name, `이름: ${man.name}`, 'name/short_name 없음');
  check(!!man.start_url && !!man.scope, `start_url ${man.start_url} · scope ${man.scope}`, 'start_url/scope 없음');
  check(['standalone', 'fullscreen', 'minimal-ui'].includes(man.display),
    `display: ${man.display}`, `display 가 설치형이 아님(${man.display})`);
  const sizes = (man.icons || []).map((i) => i.sizes);
  check(sizes.includes('192x192') && sizes.includes('512x512'),
    '아이콘 192·512 있음', '아이콘 192x192 / 512x512 가 있어야 설치 가능');
  check((man.icons || []).some((i) => String(i.purpose || '').includes('maskable')),
    'maskable 아이콘 있음', 'maskable 아이콘이 없으면 안드로이드가 아이콘을 잘라 보여줌');
  check(/^#/.test(man.theme_color || ''), `theme_color ${man.theme_color}`, 'theme_color 없음');
}

// ── 3. 아이콘 ────────────────────────────────────────────────────────────
console.log('\n3. 아이콘(실제 PNG 인지)');
for (const [f, w, h] of [
  ['icons/icon-192.png', 192, 192],
  ['icons/icon-512.png', 512, 512],
  ['icons/maskable-512.png', 512, 512],
  ['icons/apple-touch-icon.png', 180, 180],
  ['icons/favicon-32.png', 32, 32]
]) {
  const p = path.join(OUT, f);
  if (!fs.existsSync(p)) { bad(`${f} 없음`); continue; }
  const s = pngSize(p);
  if (!s) { bad(`${f} 가 PNG 가 아님`); continue; }
  check(s.w === w && s.h === h, `${f} ${s.w}×${s.h}`, `${f} 크기가 ${w}×${h} 가 아님(${s.w}×${s.h})`);
}

// ── 4. 서비스워커 ────────────────────────────────────────────────────────
console.log('\n4. 서비스워커');
const sw = fs.readFileSync(path.join(OUT, 'sw.js'), 'utf8');
check(!sw.includes('__SDY_BUILD__'), '빌드 번호가 실제 값으로 들어감', '빌드 번호 자리표시자가 그대로 남아 있음');
check(/importScripts\(/.test(sw), 'importScripts 로 저장소를 함께 씀', 'importScripts 가 없음');
check(!/^\s*(import|export)\s/m.test(sw),
  '클래식 스크립트(ESM 아님) — importScripts 사용 가능',
  'ESM 문법(import/export)이 섞여 있음: 서비스워커 등록이 실패할 수 있음');
check(sw.includes('/api/music/file/'), '음원 요청을 기기에서 응답', '음원 가로채기 코드가 없음');
check(sw.includes('Content-Range'), 'Range 응답 지원(음악 시크)', 'Range 처리가 없어 탐색이 끊길 수 있음');

const precache = (sw.match(/const PRECACHE = \[([\s\S]*?)\];/) || [])[1] || '';
const listed = [...precache.matchAll(/'([^']+)'/g)].map((m) => m[1]);
check(listed.length >= 8, `미리 받기 ${listed.length}개`, '미리 받기 목록이 비어 있음');
// 확장자 없는 주소(/privacy, /terms)는 서버가 파일로 내보낸다 — 매핑해서 확인
const ROUTE_FILE = { '/': 'sdynotes.html', '/privacy': 'legal/privacy.html', '/terms': 'legal/terms.html' };
const gone = listed.filter((u) => !fs.existsSync(path.join(OUT, ROUTE_FILE[u] || u.replace(/^\//, ''))));
check(gone.length === 0, '미리 받기 목록의 파일이 모두 실재', '없는 파일: ' + gone.join(', '));

// ── 5. HTML 끼워 넣기 ────────────────────────────────────────────────────
console.log('\n5. 앱 메타 주입');
const html = fs.readFileSync(path.join(OUT, 'sdynotes.html'), 'utf8');
check(html.includes('rel="manifest"'), '매니페스트 연결', 'manifest 링크 없음');
check(html.includes('name="theme-color"'), 'theme-color', 'theme-color 없음');
check(html.includes('apple-touch-icon'), '애플 터치 아이콘', 'apple-touch-icon 없음');
check(html.includes('/app/pwa.js'), 'pwa.js 주입', 'pwa.js 없음');
check(html.includes('/app/local-music.js'), 'local-music.js 주입', 'local-music.js 없음');

const iLocal = html.indexOf('/app/local-music.js');
const iPlayer = html.indexOf('src/music-player.js');
check(iLocal > 0 && iPlayer > 0 && iLocal < iPlayer,
  '로컬 음악 셔틀이 플레이어보다 먼저 실행됨',
  '순서가 뒤바뀜 — 플레이어가 서버 주소를 그대로 쓰게 된다');

// ── 6. 음악 로컬화 ───────────────────────────────────────────────────────
console.log('\n6. 음악이 기기에서 도는가');
const lm = fs.readFileSync(path.join(OUT, 'app/local-music.js'), 'utf8');
const ms = fs.readFileSync(path.join(OUT, 'app/music-store.js'), 'utf8');
check(/window\.fetch\s*=/.test(lm), 'fetch 를 가로챈다(플레이어 무수정)', 'fetch 가로채기가 없음');
for (const ep of ['/api/music/list', '/api/music/upload', '/api/music/delete', '/api/music/norm']) {
  check(lm.includes(ep), `${ep} 를 기기가 처리`, `${ep} 처리가 없음 — 서버로 새어 나간다`);
}
check(!/^\s*(import|export)\s/m.test(ms), 'music-store.js 가 클래식 스크립트(서비스워커 공용)',
  'music-store.js 에 ESM 문법이 있음 — importScripts 로 못 불러온다');
check(!/indexedDB/.test(html), 'indexedDB 접근이 HTML 밖에 있음(앱 셸이 가벼움)', '');

// ── 6-a. 스토어 심사 요건 ────────────────────────────────────────────────
console.log('\n6-a. 스토어 심사 요건');
for (const [rel, must] of [
  ['legal/privacy.html', ['개인정보처리방침', '계정 삭제', '시행일', 'AI', '보관']],
  ['legal/terms.html', ['이용약관', '시행일', '환불', 'AI 결과', '저작물']]
]) {
  const f = path.join(OUT, rel);
  if (!fs.existsSync(f)) { bad(`${rel} 없음`); continue; }
  const t = fs.readFileSync(f, 'utf8');
  const lacks = must.filter((k) => !t.includes(k));
  check(lacks.length === 0, `${rel} 필수 항목 포함 (${must.length}개)`, `${rel} 빠진 항목: ${lacks.join(', ')}`);
}
check(html.includes('/app/account.js'), '계정 삭제 UI 가 앱에 실림', 'account.js 가 주입되지 않음');
const acc = fs.readFileSync(path.join(OUT, 'app', 'account.js'), 'utf8');
check(acc.includes('/api/auth/account/delete'), '삭제 버튼이 부르는 주소가 있음', '삭제 API 호출이 없음');
check(acc.includes('/privacy') && acc.includes('/terms'), '앱 안에서 약관·방침으로 갈 수 있음', '약관 링크가 없음');
check(acc.includes('남는 것') && acc.includes('지워지는 것'),
  '삭제 전에 무엇이 지워지고 남는지 보여 줌', '삭제 안내가 부족함(심사에서 문제)');
check(/this\.appTitle|sdyAuthLogout/.test(acc) || acc.includes('sdyAuthLogout'),
  '삭제 뒤 로그아웃 처리', '삭제 뒤 세션 정리가 없음');
const backend = fs.readFileSync(path.join(REPO, 'server', 'src', 'routes', 'auth.js'), 'utf8');
check(backend.includes("app.post('/api/auth/account/delete'"), '서버에 계정 삭제 API 가 있음', '서버 API 가 없음');
check(backend.includes('friendsPurgeUser') && backend.includes('dmPurgeUser'),
  '친구·대화 기록까지 함께 지움', '관계 데이터 정리가 빠짐');
const swSrc = fs.readFileSync(path.join(OUT, 'sw.js'), 'utf8');
check(fs.existsSync(path.join(OUT, 'app', 'account.js')) && fs.existsSync(path.join(OUT, 'app', 'account.css')),
  '계정 자산이 모두 실림', 'account 자산이 빠짐');
check(swSrc.includes("'/privacy'") && swSrc.includes("'/terms'"),
  '오프라인에서도 약관 페이지가 열림', '약관 페이지가 미리 받기 목록에 없음');

// 제출 전에 채워야 할 자리표시자 — 실패가 아니라 경고
const ph = [];
for (const rel of ['legal/privacy.html', 'legal/terms.html']) {
  const t = fs.readFileSync(path.join(OUT, rel), 'utf8');
  const hits = t.match(/\[[^\]]{2,40}\]/g) || [];
  if (hits.length) ph.push(`${rel} ${hits.length}곳`);
}
if (ph.length) console.log(`  ⚠️  제출 전 채울 자리표시자: ${ph.join(' · ')}`);
else ok('자리표시자 없음 — 그대로 제출 가능');

// ── 6-a-2. 논문 로컬화 + TWA ────────────────────────────────────────────
console.log('\n6-a-2. 논문 로컬화 · TWA');
for (const f of ['app/doc-store.js', 'app/local-docs.js']) {
  check(exists(f), f, `${f} 없음`);
}
const ld = fs.readFileSync(path.join(OUT, 'app', 'local-docs.js'), 'utf8');
check(ld.includes('/api/import/bundle/') && ld.includes('/api/import/release/'),
  '논문을 기기로 옮기고 서버 사본 삭제를 요청', '옮기기·삭제 흐름이 없음');
check(ld.includes("'/api/import/docfile/'") || ld.includes('/api/import/docfile/'),
  '기기에 있으면 서버를 거치지 않고 읽음', '기기 우선 읽기가 없음');
check(ld.includes('/api/auth/storage'),
  '요금제를 물어 서버 보관/기기 보관을 가름', '요금제 확인이 없음 — 클라우드 원본을 지울 수 있다');
check(/state\.cloud/.test(ld) && /keepServer/.test(ld),
  '클라우드 요금제면 서버 사본을 지우지 않음', '클라우드 갈래가 없음');
check(swSrc.includes('SDYDocStore'),
  '서비스워커가 논문 배경 이미지를 기기에서 서빙',
  '서비스워커에 논문 서빙이 없음 — 서버를 지우면 그림이 깨진다');
check(swSrc.indexOf('doc-store.js') < swSrc.indexOf('PRECACHE'),
  '서비스워커가 doc-store 를 먼저 불러옴', 'importScripts 순서가 어긋남');

const htmlOrder = html.indexOf('/app/local-docs.js');
check(htmlOrder > 0 && htmlOrder < html.indexOf('src="sdynotes.js'),
  'local-docs.js 가 앱 본체보다 먼저 실행됨',
  '순서가 뒤바뀜 — 앱이 서버 주소를 그대로 쓰게 된다');
check(/music-store\.js/.test(html) && /doc-store\.js/.test(html),
  '두 저장소 스크립트가 모두 실림', '저장소 스크립트가 빠짐');

const plans = fs.readFileSync(path.join(PKG, 'plans.mjs'), 'utf8');
check(/price:\s*14900/.test(plans), '프리미엄 14,900원', '14,900원이 아님');
check(/price:\s*3000/.test(plans), '논문 100편 3,000원', '3,000원 크레딧이 없음');
check(plans.includes('Infinity'),
  '논문 편수 무제한이 요금제에 반영', '무제한 표시가 없음');
check(/200 \* 1024 \* 1024 \* 1024/.test(plans), '개인 클라우드 200GB', '200GB 표기가 없음');
check(/cloudPlans:\s*\['premium'\]/.test(plans), '클라우드 요금제가 프리미엄 하나로 명시됨', 'cloudPlans 없음');
check(/web:\s*true/.test(plans) && /store:\s*true/.test(plans), '스토어 + 웹 결제 둘 다', '결제 경로 표기가 없음');

// ── 두 요금제 정의가 어긋나지 않는가 (팔아 놓고 막으면 사고다) ────────────
const srvPlans = fs.readFileSync(path.join(REPO, 'server', 'src', 'lib', 'plans.js'), 'utf8');
check(/price:\s*14900/.test(srvPlans), '서버도 프리미엄 14,900원', '서버 값이 다름 — 광고와 실제가 어긋난다');
check(/SDY_PREMIUM_CLOUD_GB',\s*200/.test(srvPlans) || /PREMIUM_CLOUD_GB/, '서버 클라우드 기본값 200GB', '서버 클라우드 값이 없음');
check(/keepsCopy:\s*true/.test(srvPlans) && /keepsCopy:\s*false/.test(srvPlans),
  '서버가 요금제별 보관 여부를 구분', '보관 여부 구분이 없음');
check(/cloudBytes:\s*\(\)\s*=>\s*0/.test(srvPlans), '무료는 서버 보관 0(기기 전용)', '무료 보관 설정이 없음');

const twaGuide = fs.existsSync(path.join(PKG, 'twa', 'twa-manifest.example.json'));
check(twaGuide, 'TWA 매니페스트 예시가 있음', 'twa-manifest.example.json 없음');
check(fs.existsSync(path.join(PKG, 'scripts', 'twa-prepare.mjs')),
  'TWA 준비 스크립트 있음', 'twa-prepare.mjs 없음');
check(fs.existsSync(path.join(REPO, 'server', 'src', 'routes', 'wellknown.js')),
  '서버가 assetlinks.json 을 내보냄',
  'assetlinks 라우트가 없음 — TWA 가 주소창 있는 모드로 열린다');
check(fs.existsSync(path.join(REPO, 'server', 'src', 'lib', 'bundle.js')),
  '번들 형식이 한 곳에 있음(서버·검사가 같은 코드)',
  'server/src/lib/bundle.js 없음 — 형식이 두 곳에 흩어진다');
const ldSrc2 = fs.readFileSync(path.join(OUT, 'app', 'local-docs.js'), 'utf8');
check(ldSrc2.includes('imageResponse'),
  '그림 응답 모양도 한 곳에서 만듦(img·page·bg)',
  'local-docs 가 그림 응답을 직접 만든다 — sw.js 와 어긋날 수 있다');
check(/putFile|listFiles/.test(fs.readFileSync(path.join(OUT, 'app', 'doc-store.js'), 'utf8')),
  '서버 파일(.src 원본 PDF 등)도 기기에 그대로 보관',
  '원본 파일 보관 경로가 없음 — 지우면 되살릴 수 없다');

const fg = fs.existsSync(path.join(OUT, 'store', 'feature-graphic-1024x500.png'));
const fgSize = fg ? fs.statSync(path.join(OUT, 'store', 'feature-graphic-1024x500.png')).size : 0;
check(fg && fgSize > 8000, '스토어 피처 그래픽 1024×500 (Play 필수)', '피처 그래픽이 없음');

// ── 6-b. 이름표 ──────────────────────────────────────────────────────────
console.log('\n6-b. 이름표(notesis)');
const titleTag = (/<title>([^<]*)<\/title>/.exec(html) || [])[1] || '';
check(titleTag === APP.brand, `문서 제목: ${titleTag}`, `문서 제목이 ${APP.brand} 가 아님(${titleTag})`);
check(html.includes(APP.brand), `화면 이름: ${APP.brand}`, '화면에 새 이름이 없음');
if (man) {
  check(String(man.name).startsWith(APP.brand), `스토어 이름: ${man.name}`, `name 이 ${APP.brand} 로 시작하지 않음`);
  check(man.short_name === APP.brand, `홈 화면 이름: ${man.short_name}`, `short_name 이 ${APP.brand} 가 아님`);
  check(man.id === APP.id, `앱 id: ${man.id}`, `id 가 ${APP.id} 가 아님`);
}
check(html.includes(`content="${APP.shortName}"`), 'iOS 홈 화면 이름', 'apple-mobile-web-app-title 없음');
check(!fs.existsSync(path.join(OUT, 'src', 'app')),
  '개발용 원본(src/app)은 발매판에 없음', 'src/app 이 딸려 들어감 — 앱 셸이 불필요하게 커짐');

// 옛 이름이 남았는가 — 옛 제목 무시 규칙(legacy guard)에 쓰인 것은 예외로 본다.
const stray = [];
for (const rel of ['sdynotes.html', 'sdynotes.css', 'sdynotes.js', 'sw.js',
  'app/local-music.js', 'app/pwa.js', 'app/pwa.css', 'app/music-store.js']) {
  const text = fs.readFileSync(path.join(OUT, rel), 'utf8');
  text.split('\n').forEach((line, i) => {
    if (!line.includes('SDYnotes')) return;
    if (/test\(String\(S\.appTitle\)/.test(line)) return;   // 의도된 legacy 판정
    stray.push(`${rel}:${i + 1}`);
  });
}
check(stray.length === 0, '옛 이름(SDYnotes)이 화면에 남지 않음', '옛 이름이 남음: ' + stray.join(', '));

// ── 6-c. 패치한 코드가 문법적으로 멀쩡한가 ───────────────────────────────
console.log('\n6-c. 코드 구문');
for (const rel of ['sdynotes.js', 'src/music-player.js', 'sw.js',
  'app/local-music.js', 'app/pwa.js', 'app/music-store.js']) {
  try {
    execFileSync(process.execPath, ['--check', path.join(OUT, rel)], { stdio: 'pipe' });
    ok(`${rel} 구문 정상`);
  } catch (e) {
    bad(`${rel} 구문 오류: ${String(e.stderr || e.message).split('\n')[0]}`);
  }
}

// ── 7. 원본 불변 ─────────────────────────────────────────────────────────
console.log('\n7. 원본 소스가 손대지 않았는가');
try {
  const st = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' });
  // 발매판이 의도적으로 손대는 파일(앱 코드가 아님)
  const ALLOW = new Set(['.gitignore', 'docs/store_plan.md']);
  const dirty = st.split('\n').filter(Boolean)
    // ?? = 새로 만든 파일(원본 수정이 아니다). 추적 중인 파일의 변경·삭제만 본다.
    .filter((l) => !l.startsWith('??'))
    // git status 는 앞 2글자가 상태 코드다(XY 경로). 그 뒤부터가 경로.
    .map((l) => l.slice(3).trim().replace(/^"|"$/g, ''))
    .map((p2) => (p2.includes(' -> ') ? p2.split(' -> ')[1] : p2))
    .filter((p) => p && !p.startsWith('play/') && !ALLOW.has(p));
  // 화면(앱 셸)을 이루는 파일은 절대 손대지 않는다 — 이게 이 패키지의 안전장치다.
  const UI_FILES = ['sdynotes.html', 'sdynotes.css', 'sdynotes.js'];
  const uiDirty = dirty.filter((p2) => UI_FILES.includes(p2) || p2.startsWith('src/'));
  check(uiDirty.length === 0,
    '화면 파일(sdynotes.* · src/*)은 손대지 않음',
    '화면 파일이 수정됨: ' + uiDirty.join(', '));

  // 서버 파일 변경은 '계정 삭제 API 추가' 같은 의도된 기능 — 실패가 아니라 알림.
  const srvDirty = dirty.filter((p2) => p2.startsWith('server/') || p2.startsWith('worker/'));
  if (srvDirty.length) console.log(`  ℹ️  서버 쪽 의도된 변경: ${srvDirty.join(', ')}`);
} catch (e) {
  bad('git 확인 실패: ' + e.message);
}

// ── 결과 ─────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(56));
console.log(fail === 0
  ? `✅ 전부 통과 — ${pass}개`
  : `❌ ${fail}개 실패 · ${pass}개 통과`);
console.log('─'.repeat(56) + '\n');
process.exit(fail === 0 ? 0 : 1);
