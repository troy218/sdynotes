// 22.0 · '똥컴 경량 모드' 계약
//
// 이전 최적화(14.29 셸 가상화 → 14.30.1 전수 조사 제거 → 20.0 읽기 우선/쪽 그림)로
// '그리는 양'은 이미 줄였다. 남은 비용은 ① 장식 GPU(blur·애니메이션·벽지·집게)
// ② 읽기/스크롤이 만드는 쪽 DOM·미리보기 크기 ③ 열자마자 몰아치는 슬라이스 프리필.
// 똥컴 판정이면 이 셋을 한 번에 아끼는 게 이 계약의 목표다.
//
// 실행: node test/perf_lowend_contract.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = fs.readFileSync(path.join(REPO, 'sdynotes.js'), 'utf8');
const css = fs.readFileSync(path.join(REPO, 'sdynotes.css'), 'utf8');
const worker = fs.readFileSync(path.join(REPO, 'worker/sdynotes_worker/importer.py'), 'utf8');
const html = fs.readFileSync(path.join(REPO, 'sdynotes.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ` — ${extra}` : '')); }
};

console.log('\n똥컴 경량 모드 계약');

/* ── 1. 판정(감지) ─────────────────────────────────────────── */
ok('판정은 기존 sdy_lowend 외에 sdy_perf=turbo/1 도 강제할 수 있다',
  /localStorage\.getItem\('sdy_perf'\)/.test(js));
ok('URL ?turbo=1 로도 강제할 수 있다',
  /turbo=1\/\.test\(location\.search\)/.test(js));
ok('저사양 임계를 낮춰 4코어+4GB 조합도 똥컴으로 판정한다',
  /score>=5/.test(js));
ok('판정 결과를 window.sdyTurbo 로 노출한다', /window\.sdyTurbo=sdyTurbo/.test(js));

/* ── 2. 셸/요소 창을 더 좁게 ───────────────────────────────── */
ok('셸 여유(pad)와 상한(max)이 동적 함수로 바뀌었다',
  /function shellPad\(\)/.test(js) && /function shellMax\(\)/.test(js));
ok('보이는 쪽 ±0 · 최대 8장으로 줄인다',
  /function shellPad\(\)\{\s*return sdyTurbo\(\)\?0:2;/.test(js) &&
  /function shellMax\(\)\{\s*return sdyTurbo\(\)\?8:24;/.test(js));
ok('요소 창도 현재 쪽 ±0 · 회수 경계 ±1로 줄인다',
  /function renderRadius\(\)\{\s*return sdyTurbo\(\)\?0:1;/.test(js) &&
  /function keepRadius\(\)\{\s*return sdyTurbo\(\)\?1:2;/.test(js));
ok('낡은 고정 상수가 소스에 남아 있지 않다',
  !/SHELL_PAD|SHELL_MAX|VIRTUAL_RENDER_RADIUS|VIRTUAL_KEEP_RADIUS|FILL_IDLE|FILL_MAX_GAP/.test(js));

/* ── 3. 읽기 우선 쪽 그림을 더 작게 ─────────────────────────── */
ok('똥컴 모드는 미리보기를 480px 로 요청한다 (확대한 경우만 900)',
  /if\(sdyTurbo\(\)\) return pageScale>1\.4\?900:480;/.test(js));
ok('서버가 480px 미리보기를 실제로 구울 수 있게 단계에 추가했다',
  /PREVIEW_WIDTHS = \(480, 900, 1600\)/.test(worker));

/* ── 4. 슬라이스 프리필 / 이웃 예열을 줄인다 ─────────────────── */
ok('똥컴 모드는 전체 슬라이스 프리필을 생략한다',
  /if\(sdyTurbo\(\)\) return;/.test(js) &&
  /function startSlicePrefill\(\)/.test(js));
ok('스크롤 로드 직후의 이웃 배치 프리필도 생략한다',
  /if\(!sdyTurbo\(\)\)\{/.test(js));

/* ── 5. 장식(blur·애니메이션·집게·오로라)을 끈다 ─────────────── */
ok('body.sdy-turbo 클래스를 즉시 붙인다', /_applyTurboMode\(\)/.test(js) && /classList\.toggle\('sdy-turbo'/.test(js));
ok('오로라/벽지/집게를 숨긴다',
  /body\.sdy-turbo #sdyAmbient/.test(css) &&
  /body\.sdy-turbo #wallLayer/.test(css) &&
  /body\.sdy-turbo #clawFx/.test(css));
ok('헤더·툴바·모달·플로팅 창의 backdrop blur를 끈다',
  /body\.sdy-turbo[\s\S]*backdrop-filter:none!important/.test(css));
ok('애니메이션·전환을 즉시 완료로 보낸다',
  /animation-duration:0s!important/.test(css) &&
  /transition-duration:0s!important/.test(css));
ok('장식 그림자/텍스트 그림자를 끈다',
  /body\.sdy-turbo [^\{]*\{\s*box-shadow:none!important/.test(css));
ok('집게 장식 애니메이션도 JS에서 생략한다',
  /playClawDrop\(card, done\)\{[\s\S]{0,80}sdyTurbo/.test(js) &&
  /playClawThrow\(card, done\)\{[\s\S]{0,80}sdyTurbo/.test(js));

/* ── 6. 버전/배포 정합성 ────────────────────────────────────── */
ok('package.json 과 meta/asset 버전이 같다',
  html.includes('application-version" content="' + pkg.version + '"') &&
  html.includes('sdynotes.css?v=' + pkg.version) &&
  html.includes('sdynotes.js?v=' + pkg.version));
ok('서버/워커 APP_VERSION 이 같다',
  fs.readFileSync(path.join(REPO, 'server/src/lib/config.js'), 'utf8')
    .includes(`APP_VERSION = '${pkg.version}'`) &&
  fs.readFileSync(path.join(REPO, 'worker/sdynotes_worker/common.py'), 'utf8')
    .includes(`APP_VERSION = "${pkg.version}"`));

console.log(`\n똥컴 경량 모드 계약: PASS ${pass} / FAIL ${fail}`);
if (fail) process.exit(1);
