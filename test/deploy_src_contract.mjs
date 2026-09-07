/* 14.38.1 · 브라우저 분리 JS(src/*.js) 배포 계약 — apply.sh 가 절대 src/ 를 빼먹지 않게
   ---------------------------------------------------------------------------
   배경: 14.38 대형 파일 분리 때 해돌이 AI(ai-assistant.js)·서버 상태 계기판/알림
   (server-status.js) 등이 sdynotes.js 밖 src/*.js 로 나갔다. 그런데 배포 스크립트
   (apply.sh)는 src/ 를 서버로 안 옮겨서, 실제 배포본에서는 이 모듈들이 404 나고
   '해돌이 AI 연결 불'과 '서버 상태 알림 불'이 전부 꺼진 채 보였다(사용자 보고).

   계약:
     1) sdynotes.html 이 <script src="src/...js"> 로 받는 파일이 실제 src/ 에 있고,
     2) 서버(page.js)의 정적 에셋 목록에도 있어야 하며(개발·자체호스팅 경로),
     3) apply.sh(배포 스크립트)가 src/ 폴더를 /var/www/memo(=APP_DIR) 로 복사하고,
     4) 각 파일은 문법(node --check)이 맞다.
   ---------------------------------------------------------------------------
   실행: node test/deploy_src_contract.mjs  (npm run test:deploy) */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(REPO, 'sdynotes.html'), 'utf8');
const pageJs = fs.readFileSync(path.join(REPO, 'server/src/lib/page.js'), 'utf8');
const applySh = fs.readFileSync(path.join(REPO, 'apply.sh'), 'utf8');

let pass = 0;
const check = (name, cond, extra = '') => {
  assert.ok(cond, name + (extra ? ` → ${extra}` : ''));
  pass++;
  console.log('  ✓ ' + name);
};

// ── 1) HTML 이 받는 src/*.js ────────────────────────────────────────────────
const htmlRefs = [...html.matchAll(/src="src\/([^"]*\.js)[^"]*"/g)]
  .map((m) => m[1]).sort();
check('sdynotes.html 이 src/*.js 분리 모듈을 받는다 (0개면 분리 자체가 없음)',
  htmlRefs.length >= 11, `현재 ${htmlRefs.length}개: ${htmlRefs.join(', ')}`);

for (const f of htmlRefs) {
  check(`파일 존재: src/${f}`, fs.existsSync(path.join(REPO, 'src', f)));
}

// ── 2) 서버(page.js) 정적 에셋 목록과 HTML 참조가 일치한다 ───────────────────
const assetRefs = [...pageJs.matchAll(/\/src\/([a-z0-9-]+\.js)'/g)]
  .map((m) => m[1]).sort();
check('page.js 가 HTML 과 같은 src/*.js 를 내보낸다',
  JSON.stringify(assetRefs) === JSON.stringify(htmlRefs),
  `page.js=${assetRefs.length}개 / html=${htmlRefs.length}개`);

// ── 3) apply.sh(배포 스크립트)가 src/ 를 복사한다 ─────────────────────────────
check('apply.sh: 배포 전 src/ 존재 검사가 있다',
  /\[ -d "\$SRC\/src" \]/.test(applySh));
check('apply.sh: HTML 이 받는 src/*.js 하나도 빠지지 않게 검사한다',
  /SRC_JS=\$\(sed -n 's\/\.\*src="src\\\/\\\(\[\^"?\]\*\\\.js\\\)"\.\*\/\\1\/p'/.test(applySh)
  || (applySh.includes('SRC_JS=$(sed') && applySh.includes('참조하는 src/')));
check('apply.sh: src/ 를 서버(APP_DIR)로 복사한다',
  /cp -r "\$SRC\/src" "\$APP_DIR\/src\.new"/.test(applySh));
check('apply.sh: 배포 후 src/ 를 검증한다(ok 메시지)',
  applySh.includes('브라우저 분리 JS'));

// ── 4) 문법 검사 ────────────────────────────────────────────────────────────
for (const f of htmlRefs) {
  const r = spawnSync(process.execPath, ['--check', path.join(REPO, 'src', f)],
    { encoding: 'utf8' });
  check(`문법 OK: src/${f}`, r.status === 0, r.stderr?.slice(0, 200));
}

console.log(`\n✅ deploy_src_contract — ${pass}개 항목 통과`);
