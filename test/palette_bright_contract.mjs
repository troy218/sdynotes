// 14.29.5 · 기본 팔레트(글자색 · 펜색 · 형광펜) 밝기 계약
//
//   ① 세 팔레트가 '선명한 표준색'이다 — 어두워서 안 보이던 톤이 아니다
//   ② 저장된 색을 렌더링 때 몰래 바꾸지 않는다 (별칭 매핑 해제)
//   ③ 펜 도구막대 스와치(HTML)와 JS 팔레트가 어긋나지 않는다
//   ④ 해돌이(AI)가 고르는 색이름도 같은 팔레트를 쓴다
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const js = fs.readFileSync(path.join(REPO, 'sdynotes.js'), 'utf8');
const html = fs.readFileSync(path.join(REPO, 'sdynotes.html'), 'utf8');

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log(`  ✓ ${name}`); };

const arr = (name) => {
  const m = new RegExp(`const ${name}=\\[([^\\]]*)\\]`).exec(js);
  assert.ok(m, `${name} 을 찾을 수 없다`);
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
};
const DRAW = arr('CLASSIC_DRAW_COLORS');
const TEXT = arr('CLASSIC_TEXT_COLORS');
const HL = arr('CLASSIC_HL_COLORS');

// 상대 휘도 (WCAG) — '얼마나 밝게 보이는가'의 표준 척도
const lum = (hex) => {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
// 채도 (HSV S) — 회색빛으로 죽었는지
const sat = (hex) => {
  const n = hex.replace('#', '');
  const v = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  const mx = Math.max(...v), mn = Math.min(...v);
  return mx === 0 ? 0 : (mx - mn) / mx;
};

// ═══ ① 팔레트가 선명한가 ═════════════════════════════════════════════
ok('세 팔레트 모두 #rrggbb 로 정상 표기된다',
  [...DRAW, ...TEXT, ...HL].every((c) => /^#[0-9a-f]{6}$/.test(c)));

const GRAYS = new Set(['#7f8c8d', '#ffffff', '#000000']);   // 무채색은 채도 검사 제외
for (const [label, list] of [['글자색', TEXT], ['펜색', DRAW]]) {
  // [0] 은 검정(본문 기본) — 나머지 '유채색'이 죽지 않았는지 본다
  const chroma = list.slice(1).filter((c) => !GRAYS.has(c));
  ok(`${label} 유채색이 충분히 선명하다 (채도 ≥ 0.5)`,
    chroma.length >= 5 && chroma.every((c) => sat(c) >= 0.5));
  ok(`${label} 기본값은 순검정이다`, list[0] === '#000000');
  // 예전 톤(#a63f47 등)은 채도가 0.4 근처로 낮아 탁했다
  ok(`${label} 에 예전의 탁한 톤이 남아 있지 않다`,
    !list.some((c) => ['#a63f47', '#3d6ea8', '#2f7a5d', '#b7792b', '#7550a6',
      '#c06e34', '#9a8527', '#1c8a7a', '#b44f7a', '#5f6772', '#111111'].includes(c)));
}

// 형광펜은 '글자가 비쳐 보여야' 하므로 밝아야 한다
ok('형광펜은 전부 밝다 (휘도 ≥ 0.5 — 검은 글자가 잘 읽힌다)',
  HL.every((c) => lum(c) >= 0.5));
ok('형광펜 기본값은 노랑(#ffff00)이다', HL[0] === '#ffff00');
ok('형광펜에 예전의 어두운 파스텔이 남아 있지 않다',
  !HL.some((c) => ['#efd36a', '#b7d97a', '#83d7de', '#d8ade8', '#f2bcc5',
    '#b7cdf7', '#f2c796', '#cfd4dd', '#c5e1a5', '#e6c15d'].includes(c)));

// 팔레트 안에서 색끼리 구분이 되는가 (중복 없음)
for (const [label, list] of [['글자색', TEXT], ['펜색', DRAW], ['형광펜', HL]]) {
  ok(`${label} 팔레트에 중복이 없다`, new Set(list).size === list.length);
}

// 밝아졌는지 '예전 대비'로 직접 확인 (글자색 빨강 기준)
ok('빨강 글자색이 예전(#a63f47)보다 선명해졌다',
  TEXT.includes('#e74c3c') && sat('#e74c3c') > sat('#a63f47'));
ok('노랑 형광펜이 예전(#efd36a)보다 밝아졌다',
  lum('#ffff00') > lum('#efd36a'));

// ═══ ② 저장된 색을 바꾸지 않는다 ═════════════════════════════════════
ok('색 별칭 매핑 세 개가 모두 비어 있다',
  /const DRAW_COLOR_ALIASES=\{\};/.test(js)
  && /const TEXT_COLOR_ALIASES=\{\};/.test(js)
  && /const HL_COLOR_ALIASES=\{\};/.test(js));
ok('매핑이 없으면 색 정규화를 통째로 건너뛴다',
  /const PALETTE_REMAP_ON=/.test(js)
  && /if\(!PALETTE_REMAP_ON\) return v;/.test(js)
  && /if\(!PALETTE_REMAP_ON\) return html;/.test(js)
  && /if\(!PALETTE_REMAP_ON\) return d;/.test(js));

// 실제로 '저장된 색이 그대로 나오는지' 실행으로 확인
{
  const src = js.slice(js.indexOf('const CLASSIC_DRAW_COLORS'),
    js.indexOf('function _normalizeDocPalette'));
  const fn = new Function(`
    ${src}
    return { _classicPaletteColor, PALETTE_REMAP_ON };
  `);
  const { _classicPaletteColor, PALETTE_REMAP_ON } = fn();
  ok('매핑 스위치가 꺼져 있다', PALETTE_REMAP_ON === false);
  for (const [kind, v] of [['text', '#e74c3c'], ['text', '#000000'], ['draw', '#3498db'],
    ['hl', '#ffff00'], ['text', 'rgb(231, 76, 60)'], ['hl', '#ff0000']]) {
    assert.equal(_classicPaletteColor(kind, v), v, `${kind}/${v} 는 그대로여야 한다`);
  }
  ok('예전에 빨강으로 써 둔 글자가 검붉게 바뀌지 않는다', true);
  ok('사용자 지정색(색상 선택기)도 손대지 않는다',
    _classicPaletteColor('draw', '#ff00aa') === '#ff00aa');
}

// ═══ ③ HTML 스와치 ↔ JS 팔레트 일치 ══════════════════════════════════
const bar = html.slice(html.indexOf('id="drawToolbar"'), html.indexOf('id="penCustom"'));
const swatches = [...bar.matchAll(/data-c="(#[0-9a-f]{6})"/gi)].map((m) => m[1].toLowerCase());
ok('펜 도구막대 스와치가 펜 팔레트와 정확히 같다',
  swatches.length === DRAW.length && swatches.every((c, i) => c === DRAW[i]));
ok('첫 스와치가 기본 선택(sel)이다', /class="color-pick sel"[^>]*data-c="#000000"/.test(html));
ok('색상 선택기 초기값도 기본 펜색이다', /id="penCustom"[\s\S]{0,80}value="#000000"/.test(html));
ok('형광펜 표시줄 초기색이 새 기본 노랑이다',
  /id="hlBar"[^>]*background:#ffff00/.test(html));

// ═══ ④ 해돌이(AI) 색이름 ═════════════════════════════════════════════
{
  const t = js.slice(js.indexOf('const AI_TEXT_COLOR_NAMES'), js.indexOf('const AI_CLEAR_WORDS'));
  const used = [...t.matchAll(/'(#[0-9a-f]{6})'/gi)].map((m) => m[1].toLowerCase());
  const allowed = new Set([...TEXT, ...HL, '#ffffff']);
  ok('AI 색이름이 전부 새 팔레트(+흰색) 안의 색을 가리킨다',
    used.length > 0 && used.every((c) => allowed.has(c)));
  ok('AI 가 "빨강"이라 하면 선명한 빨강이다', /빨강:'#e74c3c'/.test(t));
  ok('AI 형광펜 "노랑"도 선명한 노랑이다', /노랑:'#ffff00'/.test(t));
}
ok('AI 형광펜 기본색이 새 노랑이다', /const AI_HL_DEFAULT='#ffff00';/.test(js));

// ═══ 회귀: 색을 쓰는 다른 경로가 살아 있는가 ═════════════════════════
ok('팔레트는 여전히 TEXT_COLORS / HL_COLORS 로 연결된다',
  /const TEXT_COLORS=CLASSIC_TEXT_COLORS\.slice\(\);/.test(js)
  && /const HL_COLORS=CLASSIC_HL_COLORS\.slice\(\);/.test(js));
ok('기본 펜색은 팔레트 첫 색을 쓴다', /drawColor=CLASSIC_DRAW_COLORS\[0\]/.test(js));
ok('기본 글자색/형광펜색도 팔레트 첫 색을 쓴다',
  /currentTextColor=TEXT_COLORS\[0\], currentHlColor=HL_COLORS\[0\]/.test(js));
ok('"자동(검정)" · "색 없음" 지우기 경로는 그대로다',
  /clearTextColor\(\)/.test(js) && /applyHighlight\(null\)/.test(js));

console.log(`\n밝은 기본 팔레트 계약: PASS ${pass}`);
