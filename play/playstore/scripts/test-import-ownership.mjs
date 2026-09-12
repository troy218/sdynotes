#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   가져온 논문의 임자·용량이 제대로 세어지는가

   왜 필요한가
     "구독자는 논문 무제한" 을 팔려면 서버가 ① 누가 가져왔는지 ② 얼마나
     차지하는지 알아야 한다. 그리고 계정을 지웠을 때 그 논문이 **디스크에서
     진짜 사라져야** 한다(스토어 심사 요건). 세는 값이 틀리면 요금제도 틀린다.

   실행: node scripts/test-import-ownership.mjs
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const REPO = path.resolve(PKG, '..', '..');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sdy-imports-test-'));
process.env.SDY_BASE_DIR = TMP;
process.env.SDY_ENV_FILE = path.join(TMP, '없는.env');
process.env.SDY_STORAGE = 'oracle';
delete process.env.SDY_IMPORT_QUOTA_MB;

const DOCS = path.join(TMP, 'imported_docs');
const IMG = path.join(TMP, 'imported');
fs.mkdirSync(DOCS, { recursive: true });
fs.mkdirSync(IMG, { recursive: true });

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ✅ ' + m); };
const bad = (m) => { fail++; console.log('  ❌ ' + m); };
const check = (c, g, b) => (c ? ok(g) : bad(b));
const mb = (b) => (b / 1048576).toFixed(1) + 'MB';

console.log(`\n가져온 논문 임자·용량 검사 (임시 폴더: ${TMP})\n`);

// ── 가짜 문서 두 편 만들기 ───────────────────────────────────────────────
//  A4 한 쪽을 200 DPI 로 그리면 대략 이 정도 — 텍스트 논문(SVG)과 스캔본(PNG)
function makeDoc(jid, { pages, rasterBytes, rasterExt, label }) {
  const refs = [];
  const total = [];
  for (let p = 0; p < pages; p++) {
    // 실제 파일 이름은 16진 16자 (importer 의 uuid4().hex[:16])
    const hex = (jid + p).replace(/[^a-f0-9]/g, '') .padEnd(16, 'a').slice(0, 16);
    const name = hex + '.' + rasterExt;
    fs.writeFileSync(path.join(IMG, name), Buffer.alloc(rasterBytes, 7));
    refs.push(`/api/import/img/${name}`);
    total.push({ p, bg: refs[refs.length - 1] });
  }
  // 본문은 gzip JSON — 실제 저장 형식과 같게
  const body = JSON.stringify({ jid, label, elements: total });
  fs.writeFileSync(path.join(DOCS, `${jid}.json.gz`), zlib.gzipSync(Buffer.from(body)));
  // 조각 파일 몇 개 + 메타
  for (let s = 0; s < 2; s++) {
    fs.writeFileSync(path.join(DOCS, `${jid}.s${s}.gz`), zlib.gzipSync(Buffer.from(JSON.stringify(refs))));
  }
  fs.writeFileSync(path.join(DOCS, `${jid}.meta.json`), JSON.stringify({ jid, pages, label }));
  let bytes = 0;
  for (const n of fs.readdirSync(DOCS)) if (n.startsWith(jid + '.')) bytes += fs.statSync(path.join(DOCS, n)).size;
  bytes += pages * rasterBytes;
  return { jid, bytes, pages };
}

// 텍스트 논문(벡터 SVG, 작음)과 스캔본(PNG, 큼) — 실제로 100배 차이가 난다
const text = makeDoc('aaaa111', { pages: 12, rasterBytes: 60 * 1024, rasterExt: 'svg', label: '텍스트 논문' });
const scan = makeDoc('bbbb222', { pages: 8, rasterBytes: 2 * 1024 * 1024, rasterExt: 'png', label: '스캔 논문' });
const other = makeDoc('cccc333', { pages: 3, rasterBytes: 100 * 1024, rasterExt: 'png', label: '다른 사람 논문' });

console.log('가짜 문서:');
console.log(`   텍스트 논문 ${text.pages}쪽 → 약 ${mb(text.bytes)}`);
console.log(`   스캔 논문   ${scan.pages}쪽 → 약 ${mb(scan.bytes)}`);
console.log(`   (같은 편수라도 ${Math.round(scan.bytes / text.bytes)}배 차이)\n`);

const store = await import(path.join(REPO, 'server/src/lib/imports.js'));
await store.importsBoot();

// ── ① 임자 기록과 용량 계산 ──────────────────────────────────────────────
const r1 = await store.importsRecord(text.jid, 'u_me', { pages: text.pages, name: '텍스트 논문.pdf' });
await store.importsRecord(scan.jid, 'u_me', { pages: scan.pages, name: '스캔본.pdf' });
await store.importsRecord(other.jid, 'u_other', { pages: other.pages, name: '남의 논문.pdf' });

check(r1.ok, '가져온 문서에 임자를 기록함', '기록 실패');
check(store.importsOwnerOf(text.jid).uid === 'u_me', '임자 조회가 됨', '임자가 다름');

const size = await store.importsSizeOf(text.jid);
check(size.bytes === text.bytes,
  `용량 계산 정확 (문서+배경 ${mb(size.bytes)})`,
  `용량이 다름: 계산 ${mb(size.bytes)} vs 실제 ${mb(text.bytes)}`);
check(size.images === text.pages, `배경 이미지 ${size.images}장을 본문에서 찾아냄`, `이미지 ${size.images}장만 찾음(기대 ${text.pages})`);

const usage = await store.importsUsage('u_me');
check(usage.count === 2, `내 논문 ${usage.count}편`, `편수가 다름(${usage.count})`);
check(usage.bytes === text.bytes + scan.bytes,
  `내 사용량 ${mb(usage.bytes)} (문서별 합과 일치)`, `합이 안 맞음: ${mb(usage.bytes)}`);
const otherUsage = await store.importsUsage('u_other');
check(otherUsage.bytes === other.bytes && otherUsage.count === 1,
  '다른 회원은 자기 것만 셈', '남의 문서까지 세어짐');

// ── ② 무제한(기본값)에서는 통과 ──────────────────────────────────────────
process.env.SDY_IMPORT_QUOTA_MB = '0';
check((await store.importsCheckQuota('u_me')).unlimited,
  'SDY_IMPORT_QUOTA_MB=0 → 무제한(통과)', '무제한인데 막음');

// ── ③ 용량이 꽉 차면 막는다 ──────────────────────────────────────────────
process.env.SDY_IMPORT_QUOTA_MB = '3';        // 3MB — 이미 16MB 넘게 씀
const q = await store.importsCheckQuota('u_me');
check(!q.ok && q.quota === 3 * 1024 * 1024,
  '용량 초과면 막고 남은 양을 알려 줌', '용량을 넘었는데 통과시킴');
check(q.over_by > 0, `초과분 ${mb(q.over_by)} 를 계산해 줌`, '초과분을 안 알려 줌');
check((await store.importsCheckQuota('u_new')).ok, '논문이 없는 새 회원은 통과', '새 회원을 막음');
delete process.env.SDY_IMPORT_QUOTA_MB;

// ── ④ 계정 삭제 → 디스크에서 진짜 사라지는가 ─────────────────────────────
const before = fs.readdirSync(IMG).length;
const purged = await store.importsPurgeUser('u_me');
check(purged.docs === 2, `내 논문 ${purged.docs}편을 지움`, `편수가 다름(${purged.docs})`);

const docLeft = fs.readdirSync(DOCS).filter((n) => n.startsWith('aaaa111.') || n.startsWith('bbbb222.'));
check(docLeft.length === 0, '문서 본문 파일이 디스크에서 사라짐', `남은 파일: ${docLeft.slice(0, 3).join(', ')}`);

const images = fs.readdirSync(IMG);
check(images.length === before - (text.pages + scan.pages),
  `배경 이미지 ${text.pages + scan.pages}장도 함께 삭제`, `이미지가 ${images.length}장 남음`);

const after = await store.importsUsage('u_me');
check(after.bytes === 0 && after.count === 0, '내 사용량이 0 이 됨', `아직 ${mb(after.bytes)} 남음`);

// ── ⑤ 남의 것은 건드리지 않는가 (가장 중요) ──────────────────────────────
const otherLeft = fs.readdirSync(DOCS).filter((n) => n.startsWith('cccc333.'));
check(otherLeft.length > 0, '다른 회원 논문은 그대로', '남의 논문까지 지움 — 큰 사고');
check((await store.importsUsage('u_other')).count === 1, '다른 회원 사용량도 그대로', '남의 사용량이 사라짐');

// ── ⑥ 임자 없는 문서는 보고되는가 (운영자가 확인할 수 있게) ─────────────
await store.importsRecord('dddd444', '', { name: '임자 미상' });
fs.writeFileSync(path.join(DOCS, 'dddd444.json.gz'), zlib.gzipSync(Buffer.from('{"x":1}')));
const orphans = await store.importsOrphans();
check(orphans.some((o) => o.jid === 'dddd444'),
  '임자 없는 문서를 따로 알려 줌(계정 삭제로 못 지우는 것)', '임자 없는 문서를 못 찾음');

// ── ⑦ 전체 현황 (임자 없는 문서를 지우기 전에 본다) ──────────────────────
const report = await store.importsReport();
check(report.docs >= 1 && report.users.length >= 1,
  `전체 현황: ${report.docs}편 · ${mb(report.total)}`, '현황 집계 실패');
check(report.anonymous >= 1, '임자 없는 문서 수를 현황에 표시', '임자 없는 문서를 안 셈');
check(report.users.some((u) => u.uid === ''),
  '임자 없는 문서를 빈 uid 로 묶어 보여 줌', '임자 없는 문서가 현황에서 빠짐');

// ── ⑧ 파일이 사라진 기록은 정리되는가 ────────────────────────────────────
fs.rmSync(path.join(DOCS, 'dddd444.json.gz'));
const rec = await store.importsReconcile();
check(rec.dropped >= 1, `사라진 문서 기록 ${rec.dropped}건 정리`, '죽은 기록이 남음');

fs.rmSync(TMP, { recursive: true, force: true });

console.log('\n' + '─'.repeat(56));
console.log(fail === 0 ? `✅ 전부 통과 — ${pass}개` : `❌ ${fail}개 실패 · ${pass}개 통과`);
console.log('─'.repeat(56) + '\n');
process.exit(fail === 0 ? 0 : 1);
