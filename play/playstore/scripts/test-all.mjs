#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   발매판 전체 검사 — 조립하고, 확인하고, 동작까지 돌려 본다

     node scripts/test-all.mjs            # 아이콘 다시 굽고 전부
     node scripts/test-all.mjs --fast     # 아이콘 건너뛰기(빠름)

   순서
     ① 조립        build.mjs
     ② 구조 검사    verify.mjs       (앱 셸·아이콘·이름표·심사 요건·원본 불변)
     ③ 계정 삭제     test-account-delete.mjs  (서버 파일에서 정말 사라지는가)
     ④ 삭제 화면     test-account-ui.mjs      (눌러서 끝까지 되는가 · jsdom)
   ═══════════════════════════════════════════════════════════════════════════ */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAST = process.argv.includes('--fast');

const STEPS = [
  ['조립', 'build.mjs', FAST ? ['--no-icons'] : []],
  ['구조 검사', 'verify.mjs', []],
  ['계정 삭제(서버)', 'test-account-delete.mjs', []],
  ['계정 삭제(화면)', 'test-account-ui.mjs', []]
];

let failed = 0;
const results = [];

for (const [label, script, args] of STEPS) {
  process.stdout.write(`\n▶ ${label} — ${script}\n`);
  const r = spawnSync(process.execPath, [path.join(HERE, script), ...args], {
    cwd: path.dirname(HERE),
    stdio: 'inherit'
  });
  const code = r.status == null ? 1 : r.status;
  if (code !== 0) failed += 1;
  results.push([label, code]);
}

console.log('\n' + '='.repeat(56));
for (const [label, code] of results) {
  console.log(`  ${code === 0 ? '✅' : '❌'} ${label}`);
}
console.log('='.repeat(56));
console.log(failed === 0
  ? '  전부 통과 — 이 상태로 스토어 등록 준비가 됩니다\n'
  : `  ${failed}단계 실패\n`);
process.exit(failed === 0 ? 0 : 1);
