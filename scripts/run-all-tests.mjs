#!/usr/bin/env node
// npm test — package.json 의 test:* 그룹을 전부 순서대로 돌리는 통합 러너.
//
//   npm test                        전체 실행
//   npm test -- --only music,auth   일부 그룹만
//   npm test -- --strict            '알려진 깨진 그룹'도 실패로 처리
//
// 그룹 목록을 여기에 적지 않고 package.json 에서 읽어 온다 — test:* 를
// 추가/삭제하면 러너가 자동으로 따라간다.
//
// 각 그룹은 **자기만의 프로세스 그룹(setsid)** 에서 돌리고, 끝나는 대로
// 그룹 전체에 SIGKILL 을 보낸다. 테스트가 띄운 서버·자식 프로세스가
// 타임아웃·강제종료 뒤에도 고아로 남아 시스템을 메우는 사고(실제로 있었다)를
// 원천 차단하기 위해서다.
//
// 알려진 깨진 그룹(KNOWN_FAILS)은 선존재 실패를 회귀와 구별하기 위해 적어 둔다.
//   · 고쳐서 통과하면 러너가 "unexpected pass" 로 알려 주므로 바로 목록에서 지운다.
//   · 새 그룹이 깨지면 실제 실패(❌)로 보고되어 러너가 1로 끝난다 — 회귀를 놓치지 않는다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GROUP_TIMEOUT_MS = 4 * 60_000;   // 한 그룹 상한 — 정상이면 어차피 수 초 안에 끝난다
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

// ── 알려진 깨진 그룹 (CI 가 없던 시절 깨진 채 남아 있는 것들 — 25d0f75 기준) ──
// 옆의 이유를 보고 소스를 고친 뒤 이 목록에서 지운다.
// flaky: true 는 간헐적으로 통과할 수 있는 그룹 — 통과해도 실패로 세지 않고
//        경고만 한다 (타이밍 민감 테스트 때문에 CI가 무작위로 빨개지는 걸 막음).
const KNOWN_FAILS = new Map([
  ['table',  { why: 'editor_table_contract: 표 이동 중 매 프레임 rebuild 금지 계약이 소스와 어긋남' }],
  ['place',  { why: 'editor_place_runtime: 텍스트 고스트가 사이트 배율 환산 CSS px 에 놓이지 않음' }],
  ['font',   { why: 'editor_font_size_runtime: jsdom 런타임에서 "상자가 선택된다" 단계 실패' }],
  ['format', { why: 'editor_format_runtime: jsdom 런타임에서 "상자가 선택된다" 단계 실패' }],
  ['draw',   { why: 'editor_draw_contract: 그리기 시작해도 .stroke-g 획 요소가 생기지 않음 — 간헐적(타이밍 민감), 통과할 때도 있다', flaky: true }],
  ['editor', { why: 'format+draw 재실행 그룹 — format 이 먼저 깨져 도달하지 못한다' }],
  ['call',   { why: 'yp_smoke_v4.cjs 크래시(esInst null) — 채팅·음성 릴레이·nginx 패치는 모두 통과' }],
]);

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const onlyIdx = argv.indexOf('--only');
const only = onlyIdx >= 0 ? String(argv[onlyIdx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : null;

const groups = Object.entries(pkg.scripts)
  // 메타 스크립트(test:only·test:strict 처럼 러너 자신을 다시 띄우는 것)는 제외 —
  // 포함하면 러너가 자기 자신을 무한 호출하는 포크 폭탄이 된다(실제로 있었다).
  .filter(([k, v]) => k.startsWith('test:') && typeof v === 'string' && !v.includes('run-all-tests.mjs'))
  .map(([k, v]) => ({ name: k.slice(5), cmd: v }));

const picked = only ? groups.filter((g) => only.includes(g.name)) : groups;
if (only) {
  const missing = only.filter((n) => !groups.some((g) => g.name === n));
  if (missing.length) { console.error(`❌ 없는 그룹: ${missing.join(', ')}`); process.exit(2); }
}
if (!picked.length) { console.error('실행할 test:* 그룹이 없다'); process.exit(2); }

// ── 한 그룹 실행: 새 세션(프로세스 그룹)에서 돌리고 끝나면 그룹 전체 정리 ──
let current = null;
function runGroup(g) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', g.cmd], { cwd: ROOT, stdio: 'inherit', detached: true });
    current = child;
    let done = false;
    const timer = setTimeout(() => finish(null, 'TIMEOUT'), GROUP_TIMEOUT_MS);
    const killGroup = () => { try { process.kill(-child.pid, 'SIGKILL'); return true; } catch { return false; } };
    function finish(code, sig, err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const swept = killGroup();   // 그룹이 비었으면 ESRCH — 즉 남은 프로세스가 없다는 뜻
      current = null;
      resolve({ code, sig, err, swept });
    }
    child.on('error', (e) => finish(null, null, e));
    child.on('exit', (code, sig) => finish(code, sig, null));
  });
}
// 러너 자체가 신호를 받으면 지금 돌고 있는 그룹까지 치우고 끝낸다
for (const s of ['SIGINT', 'SIGTERM']) {
  process.on(s, () => {
    if (current) { try { process.kill(-current.pid, 'SIGKILL'); } catch { /* */ } }
    process.exit(130);
  });
}

const t0 = Date.now();
const results = [];
for (const g of picked) {
  process.stdout.write(`\n▶ test:${g.name} — ${g.cmd}\n`);
  const r = await runGroup(g);
  const state = r.err ? 'spawn-error'
    : r.code === 0 ? 'pass'
    : r.sig === 'TIMEOUT' ? 'timeout'
    : 'fail';
  results.push({ ...g, state, sec: Math.round((Date.now() - t0) / 1000) });
  if (r.swept) console.log(`  🧹 test:${g.name} 이 남긴 프로세스를 정리했다`);
  if (state === 'timeout') console.log(`  ⏱ ${GROUP_TIMEOUT_MS / 1000}초 안에 끝나지 않아 강제 종료했다`);
}

// ── 요약 ─────────────────────────────────────────────────────
const pass = [], known = [], bad = [], flakyOk = [];
for (const r of results) {
  const kf = KNOWN_FAILS.get(r.name);
  if (r.state === 'pass' && kf) (kf.flaky ? flakyOk : bad).push({ ...r, why: 'unexpected-pass' });
  else if (r.state === 'pass') pass.push(r);
  else if (kf && r.state === 'fail' && !strict) known.push(r);
  else bad.push(r);
}

console.log('\n' + '─'.repeat(64));
for (const r of results) {
  const kf = KNOWN_FAILS.get(r.name);
  const mark = r.state === 'pass' ? (kf ? '⚠️ ' : '✅') : (kf && r.state === 'fail' && !strict ? '🐛' : '❌');
  console.log(`  ${mark} test:${r.name.padEnd(10)} ${String(r.sec).padStart(4)}s  ${r.state}`);
}
console.log('─'.repeat(64));
console.log(`  ${results.length} 그룹 · 통과 ${pass.length} · 알려진 실패 ${known.length} · 실패 ${bad.length}${flakyOk.length ? ` · flaky 통과 ${flakyOk.length}` : ''}  (총 ${(((Date.now() - t0) / 1000) | 0)}s)`);

if (known.length) {
  console.log('\n  🐛 알려진 깨진 그룹 — 소스를 고치고 scripts/run-all-tests.mjs 의 KNOWN_FAILS 에서 지우세요:');
  for (const r of known) console.log(`     · ${r.name}: ${KNOWN_FAILS.get(r.name).why}`);
}
if (flakyOk.length) {
  console.log('\n  ⚠️ flaky 로 표시된 그룹이 이번엔 통과했다 — 목록에서 지워도 되는지 확인하세요:');
  for (const r of flakyOk) console.log(`     · ${r.name}`);
}
if (bad.some((r) => r.why === 'unexpected-pass')) {
  console.log('\n  🎉 전에 깨진 그룹이 이제 통과한다 — KNOWN_FAILS 에서 지워야 할 목록:');
  for (const r of bad) if (r.why === 'unexpected-pass') console.log(`     · ${r.name}`);
}

process.exit(bad.length > 0 ? 1 : 0);
