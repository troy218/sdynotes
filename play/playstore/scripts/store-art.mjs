#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   스토어 등록 이미지 만들기

   구글플레이는 **피처 그래픽 1024×500** 을 필수로 요구한다(없으면 등록 자체가 막힘).
   갤럭시스토어도 대표 이미지를 요구한다. 여기서 그 둘을 굽는다.

   왜 직접 그리나
     이 환경엔 librsvg 가 없어 ImageMagick 이 SVG 를 못 읽는다. 대신 MVG 드로잉은
     되므로 로고 패스와 도형을 직접 그린다(아이콘과 같은 방식).

     node scripts/store-art.mjs            # build/store/ 에 생성
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
import { fileURLToPath } from 'node:url';
import { APP } from '../features.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const OUT = path.join(PKG, 'build', 'store');

// 로고 패스 (sdynotes.html 의 .logo-pro, viewBox 0 0 32 32)
const PATHS = [
  { d: 'M25.2 4.8 C26.9 4.5 28.1 5.7 27.7 7.5 C27.3 9.1 25.9 10.8 24.4 12.3 C23.3 13.2 22.1 14.0 21.2 14.4 C22.1 14.7 23.0 15.2 23.4 15.9 C22.7 17.4 21.1 18.9 19.4 20.0 C18.3 20.7 17.0 21.2 16.0 21.4 C16.7 21.7 17.4 22.1 17.8 22.6 C16.4 23.2 14.5 23.2 12.9 22.3 C13.8 20.4 15.1 17.8 16.7 14.8 C18.3 11.7 20.5 7.7 22.6 5.2 C23.4 4.4 24.5 4.3 25.2 4.8 Z', w: 1.32, fill: false },
  { d: 'M25.2 4.8 C21.8 8.6 16.6 15.1 9.2 24.8', w: 1.08, fill: false },
  { d: 'M9.2 24.8 L11.7 22.4 L12.5 22.8 L10.1 25.5 Z', w: 0.88, fill: true },
  { d: 'M9.5 25.9 C11.8 24.5 13.7 23.2 16.0 23.3 C17.1 23.3 17.1 24.2 17.9 24.7 C18.7 25.2 20.2 25.4 24.9 25.0', w: 1.02, fill: false },
];

function run(args) { execFileSync('convert', args, { stdio: ['ignore', 'ignore', 'pipe'] }); }

// 글리프를 (x,y) 기준 size 크기로 그리는 MVG 조각
function glyph(x, y, size, color) {
  const k = size / 32;
  const px = (v) => Math.round((v * k + x) * 100) / 100;
  const py = (v) => Math.round((v * k + y) * 100) / 100;
  const w = (v) => Math.round(v * k * 100) / 100;
  const out = [];
  for (const p of PATHS) {
    let i = 0;
    const nums = p.d.match(/-?\d+(?:\.\d+)?/g) || [];
    const d = p.d.replace(/-?\d+(?:\.\d+)?/g, () => {
      const v = parseFloat(nums[i]);
      // 좌표는 M/C/L 로만 이뤄져 있어 x,y 순서가 번갈아 나온다
      const isX = i % 2 === 0;
      i += 1;
      return String(isX ? px(v) : py(v));
    });
    const stroke = p.fill ? `fill '${color}' stroke '${color}'` : `fill none stroke '${color}'`;
    out.push('-draw', `stroke-linecap round stroke-linejoin round stroke-width ${w(p.w)} ${stroke} path '${d}'`);
  }
  out.push('-draw', `fill '${color}' stroke none circle ${px(7.8)},${py(26.5)} ${px(7.8 + 0.88)},${py(26.5)}`);
  return out;
}

// ── 피처 그래픽 1024×500 ────────────────────────────────────────────────
function featureGraphic() {
  const W = 1024, H = 500;
  const ink = '#0B2149';
  const accent = '#5B8DEF';
  const args = [
    '-size', `${W}x${H}`, 'gradient:#1B47A0-#0B2149',
    // 오른쪽 아래 은은한 빛
    '-fill', 'rgba(91,141,239,0.30)', '-stroke', 'none',
    '-draw', `circle 900,430 900,120`,
    '-fill', 'rgba(91,141,239,0.16)', '-stroke', 'none',
    '-draw', `circle 980,80 980,-120`,
    // 앱 아이콘 자리 (둥근 사각 + 글리프)
    '-fill', '#2E63D6', '-stroke', 'none',
    '-draw', 'roundrectangle 72,168,244,340,30,30',
    ...glyph(104, 200, 108, '#FFFFFF'),
  ];
  // 왼쪽 정렬 텍스트 — ImageMagick 의 한글 폰트가 없을 수 있어 이미 그려 둔
  // 로마자는 caption 으로, 한글은 폰트가 있을 때만 붙인다.
  const font = pickFont();
  const KC = font.korean;
  // 제목(76pt ≈ 105px) 아래로 자막 두 줄 — 겹치지 않게 y 를 넉넉히 띄운다
  const lines = [
    { t: APP.shortName, size: 76, y: 148, color: '#FFFFFF', bold: true },
    { t: KC ? '논문 읽는 노트' : 'Papers, annotated', size: 32, y: 292, color: '#DCE8FF', bold: false },
    { t: KC ? 'PDF · 수식 · AI 요약' : 'PDF · Math · AI Summary', size: 32, y: 344, color: '#A9C4F5', bold: false }
  ];
  for (const l of lines) {
    args.push('-font', l.bold ? font.file : (font.regular || font.file),
      '-pointsize', String(l.size), '-fill', l.color,
      '-gravity', 'northwest', '-annotate', `+300+${l.y}`, l.t);
  }
  const out = path.join(OUT, 'feature-graphic-1024x500.png');
  fs.mkdirSync(OUT, { recursive: true });
  run([...args, `PNG24:${out}`]);
  console.log(`  ✅ ${path.relative(PKG, out)}  1024×500 (Play 필수)`);
  return { out, font };
}

// ── 한글 폰트 준비 ──────────────────────────────────────────────────────
//  이 환경엔 한글 폰트가 없다. npm 으로 Noto Sans KR(OFL/MIT 번들)을 받아
//  캐시해 두고 쓴다. 한 번 받으면 다음부터는 그대로 쓴다.
const FONT_CACHE = path.join(PKG, '.cache', 'fonts');

function provisionKoreanFont() {
  const bold = path.join(FONT_CACHE, 'NotoSansKR-Bold.ttf');
  const reg = path.join(FONT_CACHE, 'NotoSansKR-Regular.ttf');
  if (fs.existsSync(bold) && fs.existsSync(reg)) return { bold, reg, from: 'cache' };

  // ① 환경변수로 지정
  const env = process.env.SDY_KO_FONT;
  if (env && fs.existsSync(env)) return { bold: env, reg: env, from: 'env' };

  // ② 패키지에 직접 넣어 둔 폰트
  const own = path.join(PKG, 'assets', 'fonts');
  if (fs.existsSync(own)) {
    const f = fs.readdirSync(own).filter((n) => /\.(ttf|otf)$/i.test(n));
    const b = f.find((n) => /bold/i.test(n)) || f[0];
    if (b) return { bold: path.join(own, b), reg: path.join(own, f.find((n) => /regular/i.test(n)) || b), from: 'package' };
  }

  // ③ npm 에서 받아 캐시 (오프라인이면 조용히 포기)
  try {
    fs.mkdirSync(FONT_CACHE, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'kofont-'));
    const r = require('node:child_process').spawnSync('npm',
      ['pack', '@expo-google-fonts/noto-sans-kr', '--silent'], { cwd: tmp, encoding: 'utf8' });
    if (r.status !== 0) return null;
    const tgz = (r.stdout || '').trim().split('\n').pop();
    const ex = require('node:child_process').spawnSync('tar', ['xzf', tgz], { cwd: tmp });
    if (ex.status !== 0) return null;
    fs.copyFileSync(path.join(tmp, 'package/700Bold/NotoSansKR_700Bold.ttf'), bold);
    fs.copyFileSync(path.join(tmp, 'package/400Regular/NotoSansKR_400Regular.ttf'), reg);
    try { fs.copyFileSync(path.join(tmp, 'package/LICENSE'), path.join(FONT_CACHE, 'LICENSE.txt')); } catch { /* noop */ }
    fs.rmSync(tmp, { recursive: true, force: true });
    return { bold, reg, from: 'npm' };
  } catch { return null; }
}

// 한글이 그려지는 폰트를 찾는다. 없으면 로마자만 남기고 알린다.
function pickFont() {
  const cands = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'];
  let korean = null;
  try {
    const all = execFileSync('fc-list', [':lang=ko', 'file'], { encoding: 'utf8' }).trim().split('\n');
    if (all.length && all[0]) korean = all[0].split(':')[0].trim();
  } catch { /* fc-list 없음 */ }

  const own = provisionKoreanFont();
  if (own) {
    return {
      file: own.bold, regular: own.reg, korean: true, from: own.from,
      label: own.from === 'npm' ? 'npm 에서 받은 Noto Sans KR' : own.from === 'cache' ? '캐시된 Noto Sans KR' : '직접 지정한 폰트'
    };
  }
  const file = korean || cands.find((f) => fs.existsSync(f)) || cands[0];
  return { file, regular: file, korean: !!korean, from: 'system', label: '시스템 폰트(한글 없음)' };
}

// ── 대표 이미지(갤럭시스토어·OG) 1200×630 ───────────────────────────────
function ogImage() {
  const W = 1200, H = 630;
  const out = path.join(OUT, 'cover-1200x630.png');
  const font = pickFont();
  const KC = font.korean;
  const args = [
    '-size', `${W}x${H}`, 'gradient:#1B47A0-#0B2149',
    '-fill', 'rgba(91,141,239,0.28)', '-stroke', 'none', '-draw', `circle 1060,540 1060,150`,
    '-fill', '#2E63D6', '-draw', 'roundrectangle 96,110,272,286,30,30',
    ...glyph(128, 142, 112, '#FFFFFF'),
    '-font', font.file, '-pointsize', '84', '-fill', '#FFFFFF', '-gravity', 'northwest',
    '-annotate', '+330+130', APP.shortName,
    '-font', font.regular || font.file, '-pointsize', '34', '-fill', '#DCE8FF',
    '-annotate', '+334+272', KC ? '논문 읽는 노트' : 'Papers, annotated',
    '-font', font.regular || font.file, '-pointsize', '34', '-fill', '#A9C4F5',
    '-annotate', '+334+326', KC ? 'PDF · 수식 · AI 요약' : 'PDF · Math · AI Summary',
  ];
  run([...args, `PNG24:${out}`]);
  console.log(`  ✅ ${path.relative(PKG, out)}  1200×630 (갤럭시스토어 대표 이미지)`);
}

console.log('\n스토어 등록 이미지 만드는 중…');
const f = featureGraphic();
ogImage();
if (f.font.korean) {
  console.log(`\n  한글 폰트: ${f.font.label}`);
} else {
  console.log('\n  ⚠️  한글 폰트를 찾지 못해 자막을 영문으로 그렸습니다.');
  console.log('      한글 문구로 바꾸려면 폰트를 지정하고 다시 실행하세요:');
  console.log('        SDY_KO_FONT=/경로/NotoSansKR-Bold.ttf node play/playstore/scripts/store-art.mjs');
}
console.log(`  결과: ${path.relative(PKG, OUT)}/\n`);
