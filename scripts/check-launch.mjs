#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   발매판 뼈대 검사

   세 발매처(웹 · 플레이 · 앱스토어) 폴더가 있고, 이름·도메인이 어긋나지
   않는지 본다. 발매판마다 값을 따로 적어 두면 언젠가 한 곳만 고치게 되고,
   그러면 "광고한 주소로는 안 열리는" 사고가 난다.

     node scripts/check-launch.mjs        (npm run check:launch)
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE, LAUNCH, activeDomain, origin, url, domainLine } from '../site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, 'play', 'playstore');

let fails = 0;
function check(ok, label, why) {
  if (ok) { console.log(`  ✅ ${label}`); return true; }
  fails++;
  console.log(`  ❌ ${label}${why ? ` — ${why}` : ''}`);
  return false;
}
function read(p) { return fs.readFileSync(p, 'utf8'); }
function exists(p) { return fs.existsSync(p); }

console.log('\n발매판 뼈대 검사');
console.log('─'.repeat(58));

// ── ① 세 폴더와 각자의 README ──────────────────────────────────────────
for (const [key, l] of Object.entries(LAUNCH)) {
  const dir = path.join(ROOT, l.dir);
  check(exists(dir), `${l.dir}/ — ${l.target}`, '폴더가 없음');
  check(exists(path.join(dir, l.readme)), `${l.dir}/${l.readme}`, '설명이 없음');
  void key;
}

// ── ② 각 발매처의 계획 문서 ────────────────────────────────────────────
check(exists(path.join(ROOT, 'web', 'docs', 'web_launch.md')),
  '웹 발매 준비 목록', 'web/docs/web_launch.md 없음');
check(exists(path.join(ROOT, 'appstore', 'docs', 'appstore_plan.md')),
  '앱스토어 심사·빌드 계획', 'appstore/docs/appstore_plan.md 없음');
check(exists(path.join(ROOT, 'RELEASE.md')),
  '발매판 한 장 안내(RELEASE.md)', 'RELEASE.md 없음');

// ── ③ 도메인 (자리표시자가 아닌 진짜 주소인가) ─────────────────────────
const bad = (v) => !v || /example\.com|YOUR-|TODO|xxxx/i.test(v);
check(!bad(SITE.current), `지금 도메인: ${SITE.current}`, '아직 자리표시자/빈 값');
check(!bad(SITE.next), `옮길 도메인: ${SITE.next}`, '아직 자리표시자/빈 값');
check(SITE.next !== SITE.current, '옮길 도메인이 지금과 다름', '같은 주소라 이전이 아님');
check(SITE.aliases.every((a) => !bad(a)), '함께 살릴 주소(www 등)', '별칭이 자리표시자');

// ── ④ 도메인 함수가 실제로 그 값을 돌려주는가 ─────────────────────────
check(activeDomain() === SITE.current, 'activeDomain() = 지금 도메인', activeDomain());
check(activeDomain({ SDY_SITE_DOMAIN: 'x.test' }) === 'x.test',
  'SDY_SITE_DOMAIN 로 임시 교체 가능', '환경변수를 무시함');
check(origin() === 'https://' + SITE.current, 'origin() 이 https 로 만든다', origin());
check(url('/privacy') === `https://${SITE.current}/privacy`,
  'url() 이 경로를 붙인다', url('/privacy'));
check(url('privacy') === `https://${SITE.current}/privacy`,
  '슬래시 없는 경로도 같은 결과', url('privacy'));

// ── ⑤ 이름·패키지가 발매판과 어긋나지 않는가 ──────────────────────────
const features = read(path.join(PKG, 'features.mjs'));
const brandHit = features.match(/to:\s*'([^']+)'/);
check(brandHit && brandHit[1] === SITE.brand,
  `브랜드 이름이 같음 (${SITE.brand})`, `features.mjs 는 ${brandHit && brandHit[1]}`);
const pkgHit = features.match(/packageId:\s*'([^']+)'/);
check(pkgHit && pkgHit[1] === SITE.android.package,
  `안드로이드 패키지가 같음 (${SITE.android.package})`, `features.mjs 는 ${pkgHit && pkgHit[1]}`);

const twaEx = path.join(PKG, 'twa', 'twa-manifest.example.json');
if (exists(twaEx)) {
  const man = JSON.parse(read(twaEx));
  check(man.packageId === SITE.android.package,
    'TWA 예시 매니페스트의 패키지가 같음', `예시는 ${man.packageId}`);
  // 예시(템플릿)도 지금 주소를 가리켜야 한다 — 옛 주소가 남으면 그대로 복사돼 나간다
  check(man.host === SITE.current,
    `TWA 예시 매니페스트의 host 가 지금 도메인 (${SITE.current})`, `예시는 ${man.host}`);
}

// ── ⑥ 도메인 단일 출처가 실제로 쓰이는가 (안 쓰면 또 따로 적게 된다) ────
const twaPrep = read(path.join(PKG, 'scripts', 'twa-prepare.mjs'));
check(twaPrep.includes('site.mjs') && /activeDomain/.test(twaPrep),
  'TWA 준비 스크립트가 site.mjs 를 읽음', 'twa-prepare.mjs 가 도메인을 따로 받음');

console.log('─'.repeat(58));
console.log(`  폴더   : ${Object.values(LAUNCH).map((l) => l.dir).join(' · ')}`);
console.log(`  도메인 : ${domainLine()}`);
console.log(fails
  ? `\n❌ ${fails}가지 어긋남 — 위 항목을 고치세요\n`
  : '\n✅ 전부 통과 — 발매판 뼈대가 서 있습니다\n');
process.exit(fails ? 1 : 0);
