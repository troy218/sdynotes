#!/usr/bin/env node
// 14.34.0 · 해돌이 참고 일러스트 번들 빌더
// ---------------------------------------------------------------------------
//   "해돌이 그림 수준이 너무 떨어진다" → 모델이 좌표를 즉석에서 지어내는 대신,
//   **잘 그려진 선화(일러스트)를 찾아 그 윤곽을 따라 그린다.** 이 스크립트는
//   그 '참고 일러스트' 묶음을 만든다.
//
//   재료 (둘 다 npm 레지스트리에서 받는다 — 빌드할 때만 인터넷이 필요하다)
//     · openmoji (CC BY-SA 4.0) 의 black/svg — 획(stroke)만으로 그린 선화 4,495장.
//       72×72 viewBox, 선 굵기 2, 채움 없음 → 펜 획으로 옮기기에 딱 맞는 원본이다.
//     · cldr-annotations-full + cldr-annotations-derived-full 의 ko/annotations.json —
//       이모지별 한국어 이름·키워드("고양이", "생일 케이크", "수달", 조합형 "요리사").
//       한국어 요청을 그림에 잇는 데 쓴다.
//
//   결과: server/assets/haedol_refs.json.gz (커밋한다 — 배포 서버는 인터넷 없이 읽는다)
//     { v, source, license, count, items:[ { h, e, g, s, en, tags, ko, kw, p:[[w,f,d],…] } ] }
//       h  hexcode ("1F408")            e  이모지 문자 ("🐈")
//       g/s 그룹/소그룹                  en 영어 이름, tags 영어 키워드
//       ko 한국어 이름(tts), kw 한국어 키워드
//       p  선 목록 — [굵기(72 기준), 채움(0/1), 절대좌표 경로 "M x y L … C … Z"]
//          변환(transform)·도형(rect/circle/…)·상대좌표·호(A)는 전부 여기서 구워
//          넣어 두므로, 실행 시에는 M/L/C/Z 네 가지만 읽으면 된다.
//
//   사용법
//     node scripts/build-haedol-refs.mjs             # 받아서 빌드
//     node scripts/build-haedol-refs.mjs --keep      # 내려받은 tarball 을 지우지 않음
//     OPENMOJI_VERSION=17.0.0 CLDR_VERSION=48.2.0 …  # 버전 고정(기본 latest)
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'server', 'assets', 'haedol_refs.json.gz');
const KEEP = process.argv.includes('--keep');

// ── 어떤 그림을 담을지 ───────────────────────────────────────────────────────
//   국기·키캡·글자·기호·브랜드 로고·UI 아이콘·피부색 변형은 "그려 줘" 요청에
//   나올 일이 거의 없고 크기만 차지하므로 뺀다.
const GROUP_OK = new Set(['smileys-emotion', 'people-body', 'animals-nature', 'food-drink',
  'travel-places', 'activities', 'objects', 'extras-openmoji']);
const EXTRAS_SUB_OK = new Set(['animals-nature', 'food-drink', 'gardening', 'objects', 'travel-places',
  'climate-environment', 'people', 'smileys-emotion', 'technology']);
const SUB_SKIP = new Set(['flags', 'brand', 'ui-element', 'queer-symbols', 'interaction', 'symbols',
  'symbol-other', 'emergency', 'healthcare', 'skin-tone', 'hair-style']);
// 기호 그룹에서도 "그려 줘"에 자주 나오는 것만 몇 개 — 하트·별·기하 도형·화살표.
const SYMBOL_SUB_OK = new Set(['geometric', 'arrow', 'math']);

function pick(om) {
  if (om.skintone) return false;                       // 피부색 변형 2천여 개 — 기본형만
  if (om.group === 'symbols') return SYMBOL_SUB_OK.has(om.subgroups);
  if (!GROUP_OK.has(om.group)) return false;
  if (SUB_SKIP.has(om.subgroups)) return false;
  if (om.group === 'extras-openmoji' && !EXTRAS_SUB_OK.has(om.subgroups)) return false;
  return true;
}

// ── npm tarball 내려받기 ─────────────────────────────────────────────────────
async function npmTarball(name, wantVersion) {
  const meta = await (await fetch(`https://registry.npmjs.org/${name}`)).json();
  const version = wantVersion || meta['dist-tags'].latest;
  const v = meta.versions[version];
  if (!v) throw new Error(`${name}@${version} 없음`);
  return { version, url: v.dist.tarball, license: v.license || '' };
}
async function download(url, to) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  await fsp.writeFile(to, Buffer.from(await r.arrayBuffer()));
}

// ── 아주 작은 XML 읽기 (OpenMoji svg 는 기계가 만든 단순한 파일이라 충분하다) ─
function parseAttrs(s) {
  const out = {};
  const re = /([A-Za-z_:][-\w:.]*)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(s)) !== null) out[m[1]] = m[2];
  return out;
}
// <tag …> / </tag> / <tag …/> 순서대로 방문 — 부모 <g> 의 속성·변환을 상속한다
function walkSvg(xml, onShape) {
  const src = String(xml).replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  const re = /<\s*(\/?)\s*([A-Za-z_][\w:-]*)\s*([^>]*?)\s*(\/?)\s*>/g;
  const stack = [{ tf: IDENT, attrs: {} }];
  let m;
  while ((m = re.exec(src)) !== null) {
    const closing = m[1] === '/'; const tag = m[2].toLowerCase(); const selfClose = m[4] === '/';
    if (closing) { if (stack.length > 1) stack.pop(); continue; }
    const attrs = parseAttrs(m[3]);
    const parent = stack[stack.length - 1];
    const inherited = Object.assign({}, parent.attrs);
    for (const k of ['fill', 'stroke', 'stroke-width', 'display', 'visibility']) if (attrs[k] != null) inherited[k] = attrs[k];
    const tf = attrs.transform ? mul(parent.tf, parseTransform(attrs.transform)) : parent.tf;
    const node = { tf, attrs: inherited };
    if (tag === 'g' || tag === 'svg') { if (!selfClose) stack.push(node); continue; }
    if (tag === 'defs' || tag === 'clippath' || tag === 'mask' || tag === 'symbol') {
      // 안의 도형은 화면에 직접 나오지 않는다 — 통째로 건너뛴다
      if (!selfClose) { const end = new RegExp(`<\\s*/\\s*${tag}\\s*>`, 'i'); end.lastIndex = re.lastIndex; const e = end.exec(src); if (e) re.lastIndex = e.index + e[0].length; }
      continue;
    }
    onShape(tag, attrs, node);
    if (!selfClose && !/^(path|rect|circle|ellipse|line|polyline|polygon)$/.test(tag)) stack.push(node);
  }
}

// ── 2×3 아핀 변환 ───────────────────────────────────────────────────────────
const IDENT = [1, 0, 0, 1, 0, 0];
function mul(a, b) {          // a ∘ b  (b 를 먼저 적용하고 a 를 적용)
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
function apply(t, x, y) { return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]]; }
function scaleOf(t) { return Math.sqrt(Math.abs(t[0] * t[3] - t[1] * t[2])) || 1; }
function parseTransform(s) {
  let t = IDENT;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(String(s))) !== null) {
    const fn = m[1].toLowerCase();
    const a = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    let u = IDENT;
    if (fn === 'matrix' && a.length === 6) u = a;
    else if (fn === 'translate') u = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (fn === 'scale') u = [a[0] || 1, 0, 0, (a.length > 1 ? a[1] : a[0]) || 1, 0, 0];
    else if (fn === 'rotate') {
      const r = (a[0] || 0) * Math.PI / 180; const c = Math.cos(r); const sn = Math.sin(r);
      u = [c, sn, -sn, c, 0, 0];
      if (a.length >= 3) u = mul(mul([1, 0, 0, 1, a[1], a[2]], u), [1, 0, 0, 1, -a[1], -a[2]]);
    } else if (fn === 'skewx') u = [1, 0, Math.tan((a[0] || 0) * Math.PI / 180), 1, 0, 0];
    else if (fn === 'skewy') u = [1, Math.tan((a[0] || 0) * Math.PI / 180), 0, 1, 0, 0];
    t = mul(t, u);
  }
  return t;
}

// ── 도형 → 절대좌표 세그먼트 (M/L/C/Z) ───────────────────────────────────────
//   결과 세그먼트: ['M',x,y] ['L',x,y] ['C',x1,y1,x2,y2,x,y] ['Z']
const K = 0.5522847498;   // 사분원 베지어 상수
function ellipseSegs(cx, cy, rx, ry) {
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + ry * K, cx + rx * K, cy + ry, cx, cy + ry],
    ['C', cx - rx * K, cy + ry, cx - rx, cy + ry * K, cx - rx, cy],
    ['C', cx - rx, cy - ry * K, cx - rx * K, cy - ry, cx, cy - ry],
    ['C', cx + rx * K, cy - ry, cx + rx, cy - ry * K, cx + rx, cy],
    ['Z'],
  ];
}
function rectSegs(x, y, w, h, rx, ry) {
  rx = Math.min(Math.max(0, rx || 0), w / 2); ry = Math.min(Math.max(0, ry || 0), h / 2);
  if (!rx && !ry) return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
  if (!rx) rx = ry; if (!ry) ry = rx;
  return [
    ['M', x + rx, y], ['L', x + w - rx, y],
    ['C', x + w - rx + rx * K, y, x + w, y + ry - ry * K, x + w, y + ry],
    ['L', x + w, y + h - ry],
    ['C', x + w, y + h - ry + ry * K, x + w - rx + rx * K, y + h, x + w - rx, y + h],
    ['L', x + rx, y + h],
    ['C', x + rx - rx * K, y + h, x, y + h - ry + ry * K, x, y + h - ry],
    ['L', x, y + ry],
    ['C', x, y + ry - ry * K, x + rx - rx * K, y, x + rx, y],
    ['Z'],
  ];
}
// SVG 호(A) → 3차 베지어 (표준 엔드포인트→중심 변환, 90° 이하로 쪼갬)
function arcSegs(x1, y1, rx, ry, rot, large, sweep, x2, y2) {
  const out = [];
  if (x1 === x2 && y1 === y2) return out;
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) { out.push(['L', x2, y2]); return out; }
  const phi = rot * Math.PI / 180; const cp = Math.cos(phi); const sp = Math.sin(phi);
  const dx = (x1 - x2) / 2; const dy = (y1 - y2) / 2;
  const xp = cp * dx + sp * dy; const yp = -sp * dx + cp * dy;
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  let coef = den ? Math.sqrt(Math.max(0, num / den)) : 0;
  if (large === sweep) coef = -coef;
  const cxp = coef * (rx * yp) / ry; const cyp = coef * (-ry * xp) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2; const cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const d = ux * vx + uy * vy; const l = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy)) || 1;
    let a = Math.acos(Math.max(-1, Math.min(1, d / l))); if (ux * vy - uy * vx < 0) a = -a; return a;
  };
  const th1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dth = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2)));
  const step = dth / n;
  const pt = (t) => [cp * rx * Math.cos(t) - sp * ry * Math.sin(t) + cx, sp * rx * Math.cos(t) + cp * ry * Math.sin(t) + cy];
  const dpt = (t) => [-cp * rx * Math.sin(t) - sp * ry * Math.cos(t), -sp * rx * Math.sin(t) + cp * ry * Math.cos(t)];
  let t = th1;
  const alpha = Math.sin(step) * (Math.sqrt(4 + 3 * Math.tan(step / 2) ** 2) - 1) / 3;
  for (let i = 0; i < n; i++) {
    const p0 = pt(t); const p1 = pt(t + step); const d0 = dpt(t); const d1 = dpt(t + step);
    out.push(['C', p0[0] + alpha * d0[0], p0[1] + alpha * d0[1], p1[0] - alpha * d1[0], p1[1] - alpha * d1[1], p1[0], p1[1]]);
    t += step;
  }
  return out;
}
function pathSegs(d) {
  const toks = []; const re = /([AaCcHhLlMmQqSsTtVvZz])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
  let m;
  while ((m = re.exec(String(d || ''))) !== null) toks.push(m[1] ? m[1] : parseFloat(m[2]));
  const out = [];
  let i = 0; let cx = 0; let cy = 0; let sx = 0; let sy = 0; let px = 0; let py = 0; let prev = '';
  const num = (n) => { const a = []; for (let k = 0; k < n; k++) { if (typeof toks[i] !== 'number') throw new Error('path'); a.push(toks[i++]); } return a; };
  const more = () => i < toks.length && typeof toks[i] === 'number';
  try {
    while (i < toks.length) {
      const c = toks[i]; if (typeof c !== 'string') { i++; continue; }
      i++;
      const rel = c === c.toLowerCase(); const cmd = c.toUpperCase();
      if (cmd === 'M') {
        let a = num(2); let x = rel ? cx + a[0] : a[0]; let y = rel ? cy + a[1] : a[1];
        out.push(['M', x, y]); cx = sx = x; cy = sy = y; prev = 'M';
        while (more()) { a = num(2); x = rel ? cx + a[0] : a[0]; y = rel ? cy + a[1] : a[1]; out.push(['L', x, y]); cx = x; cy = y; prev = 'L'; }
      } else if (cmd === 'L') {
        while (more()) { const a = num(2); const x = rel ? cx + a[0] : a[0]; const y = rel ? cy + a[1] : a[1]; out.push(['L', x, y]); cx = x; cy = y; prev = 'L'; }
      } else if (cmd === 'H') {
        while (more()) { const v = num(1)[0]; const x = rel ? cx + v : v; out.push(['L', x, cy]); cx = x; prev = 'L'; }
      } else if (cmd === 'V') {
        while (more()) { const v = num(1)[0]; const y = rel ? cy + v : v; out.push(['L', cx, y]); cy = y; prev = 'L'; }
      } else if (cmd === 'C') {
        while (more()) {
          const a = num(6); const b = rel ? [cx + a[0], cy + a[1], cx + a[2], cy + a[3], cx + a[4], cy + a[5]] : a;
          out.push(['C', b[0], b[1], b[2], b[3], b[4], b[5]]); px = b[2]; py = b[3]; cx = b[4]; cy = b[5]; prev = 'C';
        }
      } else if (cmd === 'S') {
        while (more()) {
          const a = num(4); const x2 = rel ? cx + a[0] : a[0]; const y2 = rel ? cy + a[1] : a[1]; const x = rel ? cx + a[2] : a[2]; const y = rel ? cy + a[3] : a[3];
          const x1 = (prev === 'C') ? 2 * cx - px : cx; const y1 = (prev === 'C') ? 2 * cy - py : cy;
          out.push(['C', x1, y1, x2, y2, x, y]); px = x2; py = y2; cx = x; cy = y; prev = 'C';
        }
      } else if (cmd === 'Q') {
        while (more()) {
          const a = num(4); const qx = rel ? cx + a[0] : a[0]; const qy = rel ? cy + a[1] : a[1]; const x = rel ? cx + a[2] : a[2]; const y = rel ? cy + a[3] : a[3];
          out.push(['C', cx + 2 / 3 * (qx - cx), cy + 2 / 3 * (qy - cy), x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), x, y]);
          px = qx; py = qy; cx = x; cy = y; prev = 'Q';
        }
      } else if (cmd === 'T') {
        while (more()) {
          const a = num(2); const x = rel ? cx + a[0] : a[0]; const y = rel ? cy + a[1] : a[1];
          const qx = (prev === 'Q') ? 2 * cx - px : cx; const qy = (prev === 'Q') ? 2 * cy - py : cy;
          out.push(['C', cx + 2 / 3 * (qx - cx), cy + 2 / 3 * (qy - cy), x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), x, y]);
          px = qx; py = qy; cx = x; cy = y; prev = 'Q';
        }
      } else if (cmd === 'A') {
        while (more()) {
          const a = num(7); const x = rel ? cx + a[5] : a[5]; const y = rel ? cy + a[6] : a[6];
          for (const s of arcSegs(cx, cy, a[0], a[1], a[2], !!a[3], !!a[4], x, y)) out.push(s);
          cx = x; cy = y; prev = 'A';
        }
      } else if (cmd === 'Z') {
        out.push(['Z']); cx = sx; cy = sy; prev = 'Z';
      }
    }
  } catch (e) { /* 어긋난 d 는 여기까지만 */ }
  return out;
}
function transformSegs(segs, t) {
  return segs.map((s) => {
    if (s[0] === 'Z') return s;
    const o = [s[0]];
    for (let i = 1; i < s.length; i += 2) { const p = apply(t, s[i], s[i + 1]); o.push(p[0], p[1]); }
    return o;
  });
}
const fmt = (n) => { const r = Math.round(n * 100) / 100; return (Object.is(r, -0) ? 0 : r).toString(); };
function segsToD(segs) {
  return segs.map((s) => s[0] + (s.length > 1 ? ' ' + s.slice(1).map(fmt).join(' ') : '')).join(' ');
}

// 파일 하나 → p 목록. 채움만 있는 도형(눈동자 같은 검은 점)은 f=1 로 표시한다.
function normalizeSvg(xml) {
  const out = [];
  walkSvg(xml, (tag, attrs, node) => {
    const a = Object.assign({}, node.attrs, attrs);
    if (a.display === 'none' || a.visibility === 'hidden') return;
    const fill = String(a.fill == null ? '#000' : a.fill).trim().toLowerCase();   // SVG 기본 fill 은 검정
    const stroke = String(a.stroke == null ? 'none' : a.stroke).trim().toLowerCase();
    const filled = fill !== 'none' && fill !== 'transparent' && fill !== '#fff' && fill !== '#ffffff' && fill !== 'white';
    const stroked = stroke !== 'none' && stroke !== 'transparent' && stroke !== '#fff' && stroke !== '#ffffff' && stroke !== 'white';
    if (!filled && !stroked) return;
    let segs = null;
    const n = (k, d = 0) => { const v = parseFloat(attrs[k]); return Number.isFinite(v) ? v : d; };
    if (tag === 'path') segs = pathSegs(attrs.d);
    else if (tag === 'rect') { if (n('width') > 0 && n('height') > 0) segs = rectSegs(n('x'), n('y'), n('width'), n('height'), n('rx', n('ry')), n('ry', n('rx'))); }
    else if (tag === 'circle') { if (n('r') > 0) segs = ellipseSegs(n('cx'), n('cy'), n('r'), n('r')); }
    else if (tag === 'ellipse') { if (n('rx') > 0 && n('ry') > 0) segs = ellipseSegs(n('cx'), n('cy'), n('rx'), n('ry')); }
    else if (tag === 'line') segs = [['M', n('x1'), n('y1')], ['L', n('x2'), n('y2')]];
    else if (tag === 'polyline' || tag === 'polygon') {
      const pts = String(attrs.points || '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
      if (pts.length >= 4) { segs = []; for (let i = 0; i + 1 < pts.length; i += 2) segs.push([i ? 'L' : 'M', pts[i], pts[i + 1]]); if (tag === 'polygon') segs.push(['Z']); }
    }
    if (!segs || !segs.length) return;
    segs = transformSegs(segs, node.tf);
    let w = parseFloat(a['stroke-width']); if (!Number.isFinite(w) || w <= 0) w = 1;
    w = Math.round(w * scaleOf(node.tf) * 100) / 100;
    out.push([stroked ? w : 0, filled ? 1 : 0, segsToD(segs)]);
  });
  return out;
}

// ── 한국어 이름·키워드 (CLDR) ────────────────────────────────────────────────
//   이모지 문자 대신 hexcode(변이 선택자 FE0F 제거)로 맞춘다 — OpenMoji 의 emoji
//   문자열과 CLDR 키는 FE0F 유무가 제각각이라 문자 비교는 자주 어긋난다.
//   ZWJ 조합(👨‍🍳 요리사 등)은 derived 파일에 있어 둘을 합친다.
const hexOf = (s) => [...String(s || '')].map((c) => c.codePointAt(0).toString(16).toUpperCase()).join('-').replace(/-FE0F/g, '');
const normHex = (h) => String(h || '').toUpperCase().replace(/-FE0F/g, '');
function loadKo(files) {
  const map = new Map();
  for (const file of files) {
    const j = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const a = (j.annotations || j.annotationsDerived || {}).annotations || {};
    for (const [k, v] of Object.entries(a)) {
      const key = hexOf(k);
      if (map.has(key)) continue;
      map.set(key, { tts: (v.tts || [])[0] || '', kw: v.default || [] });
    }
  }
  return map;
}

// ── 메인 ────────────────────────────────────────────────────────────────────
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'haedol-refs-'));
try {
  const om = await npmTarball('openmoji', process.env.OPENMOJI_VERSION || '');
  const cldr = await npmTarball('cldr-annotations-full', process.env.CLDR_VERSION || '');
  const cldrD = await npmTarball('cldr-annotations-derived-full', process.env.CLDR_VERSION || cldr.version);
  console.log(`openmoji ${om.version} (${om.license}) · cldr-annotations(-derived)-full ${cldr.version} (${cldr.license})`);
  const omTgz = path.join(tmp, 'openmoji.tgz'); const cldrTgz = path.join(tmp, 'cldr.tgz'); const cldrDTgz = path.join(tmp, 'cldr-derived.tgz');
  console.log('내려받는 중…'); await download(om.url, omTgz); await download(cldr.url, cldrTgz); await download(cldrD.url, cldrDTgz);
  console.log('푸는 중…');
  execFileSync('tar', ['-xzf', omTgz, '-C', tmp, 'package/black/svg', 'package/data/openmoji.json', 'package/LICENSE.txt']);
  execFileSync('tar', ['-xzf', cldrTgz, '-C', tmp, '--transform', 's,^package,cldr,', 'package/annotations/ko/annotations.json']);
  execFileSync('tar', ['-xzf', cldrDTgz, '-C', tmp, '--transform', 's,^package,cldr-derived,', 'package/annotationsDerived/ko/annotations.json']);
  const data = JSON.parse(fs.readFileSync(path.join(tmp, 'package/data/openmoji.json'), 'utf-8'));
  const ko = loadKo([path.join(tmp, 'cldr/annotations/ko/annotations.json'),
    path.join(tmp, 'cldr-derived/annotationsDerived/ko/annotations.json')]);

  const items = []; let skipped = 0; let noKo = 0;
  for (const e of data) {
    if (!pick(e)) { skipped++; continue; }
    const file = path.join(tmp, 'package/black/svg', e.hexcode + '.svg');
    if (!fs.existsSync(file)) { skipped++; continue; }
    const p = normalizeSvg(fs.readFileSync(file, 'utf-8'));
    // 별·구름·초승달처럼 한 획짜리 그림도 있다 — 경로가 너무 짧은 것만 뺀다
    if (!p.length || p.reduce((n, x) => n + String(x[2]).length, 0) < 40) { skipped++; continue; }
    const k = ko.get(normHex(e.hexcode)) || ko.get(hexOf(e.emoji)) || null;
    if (!k) noKo++;
    items.push({
      h: e.hexcode, e: e.emoji, g: e.group, s: e.subgroups,
      en: e.annotation, tags: [e.tags, e.openmoji_tags].filter(Boolean).join(', '),
      ko: k ? k.tts : '', kw: k ? k.kw.filter((w) => w !== k.tts) : [],
      p,
    });
  }
  const bundle = {
    v: 1,
    source: `OpenMoji ${om.version} black line art (https://openmoji.org) · CLDR ${cldr.version} ko annotations`,
    license: 'OpenMoji: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/) · CLDR: Unicode License v3',
    built: new Date().toISOString().slice(0, 10),
    count: items.length,
    items,
  };
  const json = JSON.stringify(bundle);
  const gz = zlib.gzipSync(Buffer.from(json), { level: 9 });
  await fsp.mkdir(path.dirname(OUT), { recursive: true });
  await fsp.writeFile(OUT, gz);
  const lic = path.join(ROOT, 'server', 'assets', 'haedol_refs.LICENSE.txt');
  await fsp.writeFile(lic,
    `해돌이 참고 일러스트 번들(haedol_refs.json.gz)의 출처와 라이선스\n\n`
    + `· 선화: OpenMoji ${om.version} — https://openmoji.org\n`
    + `  All emojis designed by OpenMoji – the open-source emoji and icon project.\n`
    + `  License: CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/\n`
    + `· 한국어 이름·키워드: Unicode CLDR ${cldr.version} annotations (ko) — Unicode License v3\n\n`
    + `노트에 그려지는 획은 위 선화의 윤곽을 따라 그린 것이며, 해돌이는 그릴 때마다\n`
    + `출처(OpenMoji · CC BY-SA 4.0)를 말풍선에 함께 알린다.\n\n`
    + `----- OpenMoji LICENSE.txt -----\n${fs.readFileSync(path.join(tmp, 'package/LICENSE.txt'), 'utf-8')}`);
  console.log(`→ ${path.relative(ROOT, OUT)}  ${items.length}장 (뺀 것 ${skipped}, 한국어 이름 없음 ${noKo}) · JSON ${(json.length / 1048576).toFixed(2)}MB → gz ${(gz.length / 1048576).toFixed(2)}MB`);
} finally {
  if (!KEEP) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } } else console.log('임시 폴더 유지:', tmp);
}
