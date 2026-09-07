#!/usr/bin/env node
/**
 * src/app 메가 모듈에서 함수/심볼 정의 위치를 찾는다.
 *
 *   node scripts/find-app-symbol.mjs openNB
 *   node scripts/find-app-symbol.mjs saveDoc flushSync renderPageEls
 *   node scripts/find-app-symbol.mjs --grep 형광펜
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'src', 'app');
const MANIFEST = path.join(APP, 'MANIFEST.txt');

const args = process.argv.slice(2);
if (!args.length) {
  console.log(`사용법:
  node scripts/find-app-symbol.mjs <심볼> [심볼…]
  node scripts/find-app-symbol.mjs --grep <부분문자열>

예: node scripts/find-app-symbol.mjs openNB saveDoc
    node scripts/find-app-symbol.mjs --grep 형광펜`);
  process.exit(2);
}

const parts = fs.readFileSync(MANIFEST, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);

function scan(pred) {
  const hits = [];
  for (const name of parts) {
    const file = path.join(APP, name);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = pred(lines[i], name, i + 1);
      if (m) hits.push({ file: `src/app/${name}`, line: i + 1, text: lines[i].trim().slice(0, 120), kind: m });
    }
  }
  return hits;
}

if (args[0] === '--grep') {
  const q = args.slice(1).join(' ');
  if (!q) { console.error('--grep 문자열 필요'); process.exit(2); }
  const hits = scan((line) => line.includes(q) ? 'match' : null);
  if (!hits.length) { console.log(`(없음) ${q}`); process.exit(1); }
  // group by file
  const by = new Map();
  for (const h of hits) {
    if (!by.has(h.file)) by.set(h.file, []);
    by.get(h.file).push(h);
  }
  for (const [file, list] of by) {
    console.log(`\n${file}  (${list.length})`);
    for (const h of list.slice(0, 12)) console.log(`  L${h.line}: ${h.text}`);
    if (list.length > 12) console.log(`  … +${list.length - 12} more`);
  }
  process.exit(0);
}

for (const sym of args) {
  const defRe = new RegExp(
    String.raw`(?:^|\s)(?:async\s+)?function\s+${sym}\b|` +
    String.raw`(?:^|\s)(?:const|let|var)\s+${sym}\s*=|` +
    String.raw`window\.${sym}\s*=`
  );
  const hits = scan((line) => defRe.test(line) ? 'def' : null);
  console.log(`\n▸ ${sym}`);
  if (!hits.length) {
    // fallback: any mention count per file
    const mentions = scan((line) => {
      try { return new RegExp(String.raw`\b${sym}\b`).test(line) ? 'ref' : null; }
      catch { return null; }
    });
    if (!mentions.length) { console.log('  (정의·참조 없음)'); continue; }
    const count = new Map();
    for (const h of mentions) count.set(h.file, (count.get(h.file) || 0) + 1);
    console.log('  정의는 없고 참조만:');
    for (const [f, n] of [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`    ${f}  ×${n}`);
    }
    continue;
  }
  for (const h of hits) console.log(`  ${h.file}:${h.line}  ${h.text}`);
}
