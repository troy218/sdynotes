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
check((await store.importsCheckQuota({ uid: 'u_me', plan: 'premium' })).unlimited,
  'SDY_IMPORT_QUOTA_MB=0 → 무제한(운영자 비상 스위치)', '무제한인데 막음');

// ── ③ 용량이 꽉 차면 막는다 ──────────────────────────────────────────────
process.env.SDY_IMPORT_QUOTA_MB = '3';        // 3MB — 이미 16MB 넘게 씀
const q = await store.importsCheckQuota({ uid: 'u_me', plan: 'premium' });
check(!q.ok && q.quota === 3 * 1024 * 1024,
  '용량 초과면 막고 남은 양을 알려 줌', '용량을 넘었는데 통과시킴');
check(q.over_by > 0, `초과분 ${mb(q.over_by)} 를 계산해 줌`, '초과분을 안 알려 줌');
check((await store.importsCheckQuota({ uid: 'u_new', plan: 'premium' })).ok, '논문이 없는 새 회원은 통과', '새 회원을 막음');
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
// u_other 의 논문은 위에서 '기기로 옮김'으로 정상 삭제됐다.
//  여기서 확인할 것은 **계정 삭제가 다른 회원 문서를 건드리지 않는가** 다.
const beforeOther = fs.readdirSync(DOCS).length;
const purgedMe = await store.importsPurgeUser('u_me');
check(purgedMe.docs === 0, '이미 옮긴 회원은 계정 삭제로 지울 문서가 없음', `문서 ${purgedMe.docs}개를 지움`);
check(fs.readdirSync(DOCS).length === beforeOther, '다른 회원 문서는 그대로', '남의 문서를 지움 — 큰 사고');
check((await store.importsUsage('u_other')).count === 1,
  '다른 회원 사용량은 그대로', '남의 사용량이 잘못 바뀜');

// ── ⑤-a 요금제에 따라 갈리는가 (17.0 · 컴퓨터 위주 + 클라우드) ───────────
const { PLANS, planSummary, planKeepsCopy, planCloudBytes } = await import(path.join(REPO, 'server/src/lib/plans.js'));
const free = { uid: 'u_free', plan: 'free' };
const prem = { uid: 'u_prem', plan: 'premium' };

check(planKeepsCopy(free) === false && planKeepsCopy(prem) === true,
  '무료는 기기 보관 · 프리미엄은 서버 보관',
  `보관 구분이 틀림: free=${planKeepsCopy(free)} premium=${planKeepsCopy(prem)}`);
check(planCloudBytes(prem) === 200 * 1024 * 1024 * 1024,
  '프리미엄 클라우드 200GB', `클라우드 값이 다름: ${planCloudBytes(prem)}`);
check(planCloudBytes(free) === 0,
  '무료는 서버 보관 0 — 변환 후 지운다', `무료 보관 값이 다름: ${planCloudBytes(free)}`);

const qFree = await store.importsCheckQuota(free);
check(qFree.ok && qFree.keeps_copy === false && qFree.papers_per_month === 5,
  '무료는 용량이 아니라 편수(월 5편)로 막는다', `무료 정책 이상: ${JSON.stringify(qFree).slice(0, 80)}`);
const qPrem = await store.importsCheckQuota(prem);
check(qPrem.ok && qPrem.keeps_copy === true && qPrem.quota === 200 * 1024 * 1024 * 1024,
  '프리미엄은 200GB 상한으로 막는다', `프리미엄 정책 이상: ${JSON.stringify(qPrem).slice(0, 80)}`);

// 이번 달 편수 세기 (무료 월 5편 판정의 근거)
const nNow = await store.importsPapersThisMonth('u_other');
check(nNow >= 1, `이번 달 가져온 편수를 센다 (${nNow}편)`, '편수 집계가 0');
const nOld = await store.importsPapersThisMonth('없는회원');
check(nOld === 0, '가져온 것이 없는 회원은 0편', `0이 아님: ${nOld}`);

const sum = planSummary(prem);
check(sum.price === 14900 && sum.cloud_bytes === 200 * 1024 * 1024 * 1024,
  '요약(계정 화면·상태 확인용)도 같은 값', `요약이 다름: ${JSON.stringify(sum)}`);

// ── ⑤-b 기기로 내보내기 → 서버 사본 삭제 (16.7 의 핵심) ──────────────────
const list = await store.importsBundleList(other.jid);
// 이 픽스처의 문서는 4개 파일(.json.gz · .s0.gz · .s1.gz · .meta.json) + 배경 이미지
check(!!list && list.docs.length === 4 && list.images.length === other.pages && list.files === 4 + other.pages,
  `번들 목록: 문서 ${list && list.docs.length}개 + 배경 ${list && list.images.length}개 = ${list && list.files}개`,
  `번들 목록이 이상함: ${list ? `문서 ${list.docs.length} · 배경 ${list.images.length} · 합 ${list.files}` : 'null'}`);
check(list && list.bytes === other.bytes,
  `번들 용량이 문서 용량과 같음 (${mb(list.bytes)})`,
  `번들 용량이 다름: ${mb(list ? list.bytes : 0)} vs ${mb(other.bytes)}`);

// 크기가 안 맞으면 지우지 않는다 (반쯤 받은 것을 지우면 논문이 사라진다)
const mismatch = await store.importsRelease(other.jid, 'u_other', { bytes: other.bytes - 1234 });
check(!mismatch.ok && mismatch.code === 'size_mismatch',
  '내려받은 크기가 다르면 삭제를 거절', '크기가 다른데 지워 버림(위험)');
check(fs.existsSync(path.join(DOCS, 'cccc333.json.gz')),
  '거절했으면 파일이 그대로 남음', '거절했는데 파일이 사라짐');

// 남의 문서는 지울 수 없다
const notMine = await store.importsRelease(other.jid, 'u_me', { bytes: other.bytes });
check(!notMine.ok && notMine.code === 'not_owner',
  '임자가 아니면 삭제 거절', '남의 논문을 지울 수 있음(큰 사고)');

// 올바른 요청 — 다 받았다고 알리면 지운다
const rel = await store.importsRelease(other.jid, 'u_other', { bytes: other.bytes, files: list.files });
check(rel.ok && rel.docs >= 1, `기기로 옮긴 뒤 문서 ${rel.docs}개 삭제`, `삭제 실패: ${rel.error || ''}`);
check(!fs.existsSync(path.join(DOCS, 'cccc333.json.gz')),
  '서버에서 문서 본문이 사라짐', '문서가 아직 남음');
check(rel.bytes === other.bytes, `삭제한 용량 ${mb(rel.bytes)}`, `삭제 용량이 다름(${mb(rel.bytes)})`);

// 기록은 남는다 — "이 논문은 그 기기에 있다"를 서버도 알아야 한다
const localList = await store.importsLocalList('u_other');
check(localList.some((d) => d.jid === other.jid),
  '기기로 옮긴 논문을 기록해 둠(기기 간 안내에 필요)', '옮긴 논문 기록이 없음');
check((await store.importsUsage('u_other')).bytes === 0,
  '옮긴 뒤에는 서버 사용량이 0', '옮겼는데 사용량이 남음');

// 두 번 불러도 안전한가
const again2 = await store.importsRelease(other.jid, 'u_other', {});
check(again2.ok && again2.already, '같은 삭제를 다시 불러도 안전(already)', '두 번째 삭제가 실패로 응답');

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
