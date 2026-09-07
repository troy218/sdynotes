#!/usr/bin/env node
/**
 * src/app/*.js 메가 모듈을 순서대로 이어 붙여 sdynotes.js 를 만든다.
 *
 * 왜 concat 인가?
 *   메인 에디터는 `let doc` · `function toast` 같은 어휘 스코프 심볼을
 *   수천 곳에서 공유한다. ES module 로 쪼개면 전부 window./import 로
 *   바꿔야 해서 회귀 위험이 크다. 파일은 도메인 단위로 나누되,
 *   브라우저에는 예전과 같이 한 스크립트로 실어 보낸다.
 *
 * 사용:
 *   node scripts/bundle-frontend.mjs          # sdynotes.js 재생성
 *   node scripts/bundle-frontend.mjs --check  # 디스크 내용과 일치하는지만 검사 (CI)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'src', 'app');
const OUT = path.join(ROOT, 'sdynotes.js');
const MANIFEST = path.join(APP, 'MANIFEST.txt');

function listParts() {
  if (!fs.existsSync(MANIFEST)) {
    throw new Error(`missing ${path.relative(ROOT, MANIFEST)}`);
  }
  const names = fs.readFileSync(MANIFEST, 'utf8')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
  if (!names.length) throw new Error('MANIFEST.txt is empty');
  for (const n of names) {
    const p = path.join(APP, n);
    if (!fs.existsSync(p)) throw new Error(`part missing: src/app/${n}`);
  }
  return names;
}

function build() {
  const names = listParts();
  const chunks = [
    '/* 분리된 JS · 소스: src/app/*.js (scripts/bundle-frontend.mjs 가 이어 붙임) */\n',
    '/* AUTO-GENERATED — 직접 고치지 말고 src/app/ 파트를 수정한 뒤 bundle 하라 */\n\n',
  ];
  for (const n of names) {
    let body = fs.readFileSync(path.join(APP, n), 'utf8');
    // part 파일 머리 배너/마커는 번들에 남겨 디버깅·테스트 추출에 쓴다.
    if (!body.endsWith('\n')) body += '\n';
    chunks.push(body);
    if (!body.endsWith('\n\n')) chunks.push('\n');
  }
  return chunks.join('');
}

function sha(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

const mode = process.argv[2] || '';
const next = build();

if (mode === '--check') {
  if (!fs.existsSync(OUT)) {
    console.error('❌ sdynotes.js 없음 — node scripts/bundle-frontend.mjs 로 만들어라');
    process.exit(1);
  }
  const cur = fs.readFileSync(OUT, 'utf8');
  if (cur === next) {
    console.log(`✅ sdynotes.js 동기화 양호 (${sha(next)} · ${next.split(/\r?\n/).length} lines · ${listParts().length} parts)`);
    process.exit(0);
  }
  console.error('❌ sdynotes.js 가 src/app 과 어긋나 있다');
  console.error(`   disk=${sha(cur)}  bundle=${sha(next)}`);
  console.error('   → node scripts/bundle-frontend.mjs 로 다시 만들어라');
  process.exit(1);
}

fs.writeFileSync(OUT, next);
console.log(`✅ sdynotes.js 재생성 · ${listParts().length} parts · ${next.split(/\r?\n/).length} lines · ${sha(next)}`);
