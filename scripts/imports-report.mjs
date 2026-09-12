#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   논문 보관 현황 — 운영자용

   "구독자는 논문 무제한" 을 팔면 디스크가 유일한 상한이다.
   그 상한이 어디까지 왔는지 서버에서 바로 볼 수 있어야 한다.

     node scripts/imports-report.mjs              # 현황
     node scripts/imports-report.mjs --reconcile  # 사라진 문서 기록 정리하고 현황

   서버를 멈추지 않고 볼 수 있다(읽기만 한다). --reconcile 만 기록을 고친다.
   ═══════════════════════════════════════════════════════════════════════════ */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const mb = (b) => (b / 1048576).toFixed(1) + 'MB';
const gb = (b) => (b / 1073741824).toFixed(2) + 'GB';

const store = await import(path.join(REPO, 'server/src/lib/imports.js'));
await store.importsBoot();

if (process.argv.includes('--reconcile')) {
  const r = await store.importsReconcile();
  console.log(`기록 정리 — 확인 ${r.seen}건 · 삭제 ${r.dropped}건\n`);
}

const rep = await store.importsReport();
const quota = store.importsQuotaBytes();

console.log('='.repeat(56));
console.log('  논문 보관 현황');
console.log('='.repeat(56));
console.log(`  문서      : ${rep.docs}편`);
console.log(`  차지 용량 : ${mb(rep.total)}${rep.total > 1073741824 ? ` (${gb(rep.total)})` : ''}`);
console.log(`  회원당 상한: ${quota ? mb(quota) : '무제한'}`);
if (rep.anonymous) console.log(`  임자 없음 : ${rep.anonymous}편 — 계정 삭제로 지울 수 없음`);

if (rep.users.length) {
  console.log('\n  회원별 (많은 순)');
  for (const u of rep.users.slice(0, 20)) {
    const label = u.uid || '(임자 없음)';
    console.log(`    ${label.padEnd(24)} ${String(u.count).padStart(4)}편 ${mb(u.bytes).padStart(10)}`);
  }
  if (rep.users.length > 20) console.log(`    … 그 밖에 ${rep.users.length - 20}명`);
}
console.log('='.repeat(56) + '\n');
