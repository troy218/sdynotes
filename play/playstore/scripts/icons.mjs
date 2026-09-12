#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   앱 아이콘 만들기 — SVG 를 그려서 PNG 로 굽는다

   왜 직접 그리나
     이 환경엔 librsvg(rsvg-convert)가 없어 ImageMagick 이 SVG 를 못 읽는다.
     대신 ImageMagick 의 MVG 드로잉(-draw "path '…'")은 되므로, 로고의
     패스 좌표를 직접 키워서 그린다. 외부 의존성이 하나도 없다.

   그리는 것 (안드로이드·PWA 가 요구하는 전부)
     icons/icon-512.png            any       — 둥근 모서리
     icons/icon-192.png            any
     icons/icon-144.png            any
     icons/maskable-512.png        maskable  — 꽉 찬 사각(안드로이드가 오려 씀)
     icons/apple-touch-icon.png    iOS 180   — 투명 없이(애플은 알파를 무시한다)
     icons/favicon-32.png          브라우저 탭
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/* 로고 원본 (sdynotes.html 의 .logo-pro, viewBox 0 0 32 32) */
const PATHS = [
  { d: 'M25.2 4.8 C26.9 4.5 28.1 5.7 27.7 7.5 C27.3 9.1 25.9 10.8 24.4 12.3 C23.3 13.2 22.1 14.0 21.2 14.4 C22.1 14.7 23.0 15.2 23.4 15.9 C22.7 17.4 21.1 18.9 19.4 20.0 C18.3 20.7 17.0 21.2 16.0 21.4 C16.7 21.7 17.4 22.1 17.8 22.6 C16.4 23.2 14.5 23.2 12.9 22.3 C13.8 20.4 15.1 17.8 16.7 14.8 C18.3 11.7 20.5 7.7 22.6 5.2 C23.4 4.4 24.5 4.3 25.2 4.8 Z', w: 1.32, fill: false },
  { d: 'M25.2 4.8 C21.8 8.6 16.6 15.1 9.2 24.8', w: 1.08, fill: false },
  { d: 'M9.2 24.8 L11.7 22.4 L12.5 22.8 L10.1 25.5 Z', w: 0.88, fill: true },
  { d: 'M9.5 25.9 C11.8 24.5 13.7 23.2 16.0 23.3 C17.1 23.3 17.1 24.2 17.9 24.7 C18.7 25.2 20.2 25.4 24.9 25.0', w: 1.02, fill: false },
];
const DOT = { cx: 7.8, cy: 26.5, r: 0.88 };

/* viewBox 좌표를 목표 픽셀로 옮긴다.
   32×32 상자를 (S × glyphRatio) 크기로 키우고 정중앙에 놓는다. */
function transform(S, glyphRatio) {
  const k = (S * glyphRatio) / 32;
  const t = S / 2 - 16 * k;
  return {
    k,
    p: (x) => Math.round((x * k + t) * 100) / 100,
    w: (x) => Math.round(x * k * 100) / 100,
  };
}

/* 패스 문자열의 숫자를 좌표쌍으로 보고 전부 옮긴다.
   여기 쓰인 명령(M·C·L·Z)은 모든 숫자가 좌표라 이 방식으로 충분하다. */
function scalePath(d, T) {
  const nums = d.match(/-?\d+(?:\.\d+)?/g) || [];
  let i = 0;
  return d.replace(/-?\d+(?:\.\d+)?/g, () => {
    const v = parseFloat(nums[i]); i += 1;
    return String(T.p(v));
  });
}

function drawGlyph(T, color, alpha) {
  const cmds = [];
  for (const p of PATHS) {
    const d = scalePath(p.d, T);
    const stroke = p.fill ? `fill '${color}' stroke '${color}'` : `fill none stroke '${color}'`;
    if (alpha != null) {
      cmds.push(`-draw`, `stroke-linecap round stroke-linejoin round fill-opacity ${alpha} stroke-opacity ${alpha} stroke-width ${T.w(p.w)} ${stroke} path '${d}'`);
    } else {
      cmds.push(`-draw`, `stroke-linecap round stroke-linejoin round stroke-width ${T.w(p.w)} ${stroke} path '${d}'`);
    }
  }
  cmds.push('-draw', `fill '${color}' stroke none circle ${T.p(DOT.cx)},${T.p(DOT.cy)} ${T.p(DOT.cx + DOT.r)},${T.p(DOT.cy)}`);
  return cmds;
}

function run(args) {
  execFileSync('convert', args, { stdio: ['ignore', 'ignore', 'pipe'] });
}

function buildIcon({ file, size, radius, bgFrom, bgTo, glyphRatio, color, forceOpaque, alpha }) {
  const S = 1024;
  const tmpBg = path.join(ROOT, 'build', '.icon-bg.png');
  const tmpOut = path.join(ROOT, 'build', '.icon-out.png');

  // ① 배경 — 그라데이션 + 둥근 사각 마스크
  const maskArgs = radius > 0
    ? ['-size', `${S}x${S}`, 'xc:none', '-fill', 'white', '-stroke', 'none',
      '-draw', `roundrectangle 0,0,${S - 1},${S - 1},${Math.round(S * radius)},${Math.round(S * radius)}`]
    : ['-size', `${S}x${S}`, 'xc:white'];
  run(['-size', `${S}x${S}`, `gradient:${bgFrom}-${bgTo}`, '(', ...maskArgs, ')',
    '-alpha', 'set', '-compose', 'DstIn', '-composite', tmpBg]);

  // ② 글리프
  const T = transform(S, glyphRatio);
  const args = [tmpBg, ...drawGlyph(T, color, alpha)];

  // ③ 애플은 알파를 무시하고 검게 채우는 경우가 있어 배경을 깔아 준다
  if (forceOpaque) {
    args.push('-background', bgFrom, '-alpha', 'remove', '-alpha', 'off');
  }
  args.push(tmpOut);
  run(args);

  // ④ 목표 크기로 굽기
  fs.mkdirSync(path.dirname(file), { recursive: true });
  run([tmpOut, '-filter', 'Lanczos', '-resize', `${size}x${size}`, `PNG32:${file}`]);
  console.log(`  ✅ ${path.relative(ROOT, file)}  ${size}×${size}`);
}

export function buildIcons() {
  const dir = path.join(ROOT, 'build', 'icons');
  const from = '#2E63D6';   // 밝은 쪽
  const to = '#14366E';     // 어두운 쪽
  const white = '#FFFFFF';

  console.log('아이콘 굽는 중…');

  const common = { bgFrom: from, bgTo: to, color: white };
  // any — 둥근 모서리, 글리프 72%
  buildIcon({ ...common, file: path.join(dir, 'icon-512.png'), size: 512, radius: 0.22, glyphRatio: 0.72 });
  buildIcon({ ...common, file: path.join(dir, 'icon-192.png'), size: 192, radius: 0.22, glyphRatio: 0.72 });
  buildIcon({ ...common, file: path.join(dir, 'icon-144.png'), size: 144, radius: 0.22, glyphRatio: 0.72 });
  // maskable — 꽉 찬 사각에 글리프 58%(안전 영역 안). 안드로이드가 알아서 오린다.
  buildIcon({ ...common, file: path.join(dir, 'maskable-512.png'), size: 512, radius: 0, glyphRatio: 0.58 });
  // iOS — 알파 없이
  buildIcon({ ...common, file: path.join(dir, 'apple-touch-icon.png'), size: 180, radius: 0.22, glyphRatio: 0.72, forceOpaque: true });
  // 탭 아이콘 — 작아서 글리프를 조금 크게
  buildIcon({ ...common, file: path.join(dir, 'favicon-32.png'), size: 32, radius: 0.22, glyphRatio: 0.78 });

  for (const t of ['.icon-bg.png', '.icon-out.png']) {
    try { fs.unlinkSync(path.join(ROOT, 'build', t)); } catch (e) {}
  }
  return dir;
}

if (process.argv[1] && process.argv[1].endsWith('icons.mjs')) {
  try {
    buildIcons();
  } catch (e) {
    console.error('❌ 아이콘 생성 실패:', e.message);
    console.error('   ImageMagick(`convert`)이 있는지 확인하세요.');
    process.exit(1);
  }
}
