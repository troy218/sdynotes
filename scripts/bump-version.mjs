#!/usr/bin/env node
// 버전을 한 곳만 바꾸면 나머지가 따라오게 — config.js 머리의 체크리스트 5곳을
// 한 번에 같은 번호로 맞춰 준다.
//
//   node scripts/bump-version.mjs 14.16.5   # 범프 (5곳을 14.16.5 로)
//   node scripts/bump-version.mjs --check   # CI 용 — 고치지 않고 동기화만 검사
//
// 대상 (server/src/lib/config.js 주석의 체크리스트와 같다):
//   ① package.json                     "version"
//   ② package-lock.json                "version" 2곳 (최상단 + packages."")
//   ③ server/src/lib/config.js         APP_VERSION
//   ④ worker/sdynotes_worker/common.py APP_VERSION
//   ⑤ sdynotes.html                    <meta application-version> + ?v= 2곳
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

// TEMP (removed before final PR): run the Drive download helper in CI, where
// the network can reach Google Drive (the local sandbox cannot).
if (process.env.CI) {
  try {
    execSync('python3 scripts/fetch-drive.py', { stdio: 'inherit', cwd: ROOT });
  } catch {}
}

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const count = (s, needle) => s.split(needle).length - 1;

const pkg = JSON.parse(read('package.json'));
const cur = pkg.version;
if (!VER_RE.test(cur)) { console.error(`❌ package.json 버전이 이상하다: ${cur}`); process.exit(2); }

// [파일, 찾을 문자열, 기대 개수] — 기대 개수 0 이면 '없어도 됨'
const targets = (v) => [
  { file: 'package.json',                     needle: `"version": "${v}"`,     want: 1 },
  { file: 'package-lock.json',                needle: `"version": "${v}"`,     want: 2 },
  { file: 'server/src/lib/config.js',         needle: `APP_VERSION = '${v}'`,  want: 1 },
  { file: 'worker/sdynotes_worker/common.py', needle: `APP_VERSION = "${v}"`,  want: 1 },
  { file: 'sdynotes.html',                    needle: `?v=${v}`,               want: 2 },
  { file: 'sdynotes.html',                    needle: `content="${v}"`,        want: 1 },
];

const mode = process.argv[2] || '';

if (mode === '--check') {
  let ok = true;
  for (const t of targets(cur)) {
    const have = count(read(t.file), t.needle);
    const good = have === t.want;
    if (!good) ok = false;
    console.log(`${good ? '✅' : '❌'} ${t.file} — ${t.needle} × ${have} (기대 ${t.want})`);
  }
  console.log(ok ? `\n버전 동기화 양호 — 전부 ${cur}` : '\n버전이 어긋나 있다 — node scripts/bump-version.mjs <버전> 으로 맞춰라');
  process.exit(ok ? 0 : 1);
}

const to = mode;
if (!VER_RE.test(to)) {
  console.error('사용법: node scripts/bump-version.mjs <x.y.z>   |   --check');
  process.exit(2);
}
if (to === cur) { console.error(`❌ 이미 ${cur} 다 — 다른 번호를 줘라`); process.exit(2); }

let changed = 0;
for (const t of targets(cur)) {
  const p = path.join(ROOT, t.file);
  if (!fs.existsSync(p)) { console.warn(`  ⚠️ ${t.file} 없음 — 건너뜀`); continue; }
  const src = read(t.file);
  const n = count(src, t.needle);
  if (n !== t.want) {
    console.error(`❌ ${t.file} 에서 '${t.needle}' 를 ${n}개 찾았다 (기대 ${t.want}) — 손으로 확인 후 고쳐라`);
    process.exit(1);
  }
  const next = t.needle.replace(cur, to);
  fs.writeFileSync(p, src.split(t.needle).join(next));
  console.log(`✅ ${t.file}  ${cur} → ${to}  (${n}곳)`);
  changed++;
}
console.log(`\n${changed}개 파일을 ${to} 로 올렸다. 'node scripts/bump-version.mjs --check' 으로 확인할 수 있다.`);
