/* 내보내기 조립기 실행 테스트 (서버 없이 Node 만으로)

   export_align_contract.mjs 가 '소스에 규칙이 있다'를 지킨다면,
   이 파일은 번들에서 조립기를 꺼내 '실제로 돌려 보고' 결과 문자열이
   편집 화면의 CSS(.tb-content·.latex-content)와 같은 상자 모델인지 확인한다. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };

// ── 번들에서 함수 원문을 통째로 꺼낸다 (문자열·주석·${} 속 괄호 무시) ──
function extract(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} 를 번들에서 찾지 못했다`);
  const open = src.indexOf('{', start);
  let i = open;
  const stack = ['code'];
  let depth = 0;
  const N = src.length;
  const top = () => stack[stack.length - 1];
  while (i < N) {
    const st = top(), ch = src[i], nx = src[i + 1];
    if (st === 'code' || st === 'tpl-expr') {
      if (ch === '/' && nx === '/') { stack.push('line'); i += 2; continue; }
      if (ch === '/' && nx === '*') { stack.push('block'); i += 2; continue; }
      if (ch === "'") { stack.push('sq'); i++; continue; }
      if (ch === '"') { stack.push('dq'); i++; continue; }
      if (ch === '`') { stack.push('tpl'); i++; continue; }
      if (ch === '{') { depth++; i++; continue; }
      if (ch === '}') {
        depth--; i++;
        if (st === 'tpl-expr' && depth === stack.tplDepth) { stack.pop(); continue; }
        if (depth === 0 && st === 'code') break;
        continue;
      }
      i++; continue;
    }
    if (st === 'line') { if (ch === '\n') stack.pop(); i++; continue; }
    if (st === 'block') { if (ch === '*' && nx === '/') { stack.pop(); i += 2; } else i++; continue; }
    if (st === 'sq' || st === 'dq') {
      const q = st === 'sq' ? "'" : '"';
      if (ch === '\\') { i += 2; continue; }
      if (ch === q) stack.pop();
      i++; continue;
    }
    if (st === 'tpl') {
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') { stack.pop(); i++; continue; }
      if (ch === '$' && nx === '{') { stack.tplDepth = depth; stack.push('tpl-expr'); depth++; i += 2; continue; }
      i++; continue;
    }
  }
  assert.ok(depth === 0, `${name} 추출 중 괄호가 안 맞는다`);
  return src.slice(start, i);
}

const NAMES = ['_expBorderW', '_expTextMetrics', '_expVAlign', '_expTextInner', '_expLatexInner', '_expForeignReset'];
const SRC = NAMES.map(n => extract(js, n)).join('\n');
const fontCSS = (id) => ({ pretendard: 'P-FONT', times: 'T-FONT' }[id] || 'P-FONT');
// 팩토리 호출마다 새로 eval → _expBwCache 메모가 케이스끼리 섞이지 않는다
function load(getBW) {
  const document = { getElementById: (id) => (id === 'pagesStage' ? {} : null) };
  const getComputedStyle = () => ({ getPropertyValue: () => getBW });
  const f = new Function('document', 'fontCSS', 'getComputedStyle',
    'let _expBwCache=null,_expBwAt=0;\n' + SRC + `\nreturn {${NAMES.join(',')}};`);
  return f(document, fontCSS, getComputedStyle);
}

// ── ① 테두리 두께 ───────────────────────────────────────────────────
check('--bw=1.6px 이면 1.6 을 쓴다', load('1.6px')._expBorderW() === 1.6);
check('--bw 가 없으면 2 로 둔다', load('')._expBorderW() === 2);
check('--bw 가 이상하면 2 로 둔다', load('abc')._expBorderW() === 2);
check('--bw 가 범위를 벗어나면 2 로 둔다', load('99px')._expBorderW() === 2);

// ── ② 일반 글상자 ───────────────────────────────────────────────────
{
  const { _expTextInner } = load('2px');
  const s = _expTextInner({ fontSize: 16, font: 'pretendard', align: 'left' }, 2, '#111111');
  check('일반: 여백 8px 12px', s.includes('padding:8px 12px'));
  check('일반: 투명 테두리 2px', s.includes('border:2px solid transparent'));
  check('일반: 보이는 overflow + pre-wrap + 줄바꿈', s.includes('overflow:visible')
    && s.includes('white-space:pre-wrap') && s.includes('overflow-wrap:break-word'));
  check('일반: 최소 크기', s.includes('min-width:60px') && s.includes('min-height:28px'));
  check('일반: 글꼴·정렬이 들어간다', s.includes('font-family:P-FONT') && s.includes('text-align:left'));
  const b = _expTextInner({ fontSize: 16, fontWeight: '700', fontStyle: 'italic', textDecoration: 'underline' }, 2, '#111111');
  check('일반: 상자 서식을 따른다', b.includes('font-weight:700') && b.includes('font-style:italic')
    && b.includes('text-decoration:underline'));
}

// ── ③ 표 칸 ─────────────────────────────────────────────────────────
{
  const { _expTextInner } = load('2px');
  const s = _expTextInner({ fontSize: 14, tbl: 1 }, 1.6, '#111111');
  check('표 칸: 6px 8px + 세로 가운데 flex', s.includes('padding:6px 8px')
    && s.includes('display:flex') && s.includes('flex-direction:column')
    && s.includes('justify-content:center'));
  check('표 칸: 테두리 두께를 그대로 둔다', s.includes('border:1.6px solid transparent'));
  check('표 칸: vAlign=top 이면 위 맞춤', _expTextInner({ tbl: 1, vAlign: 'top' }, 2, '#111111').includes('justify-content:flex-start'));
  check('표 칸: vAlign=bottom 이면 아래 맞춤', _expTextInner({ tbl: 1, vAlign: 'bottom' }, 2, '#111111').includes('justify-content:flex-end'));
}

// ── ④ 가져온 글줄(tight) ────────────────────────────────────────────
{
  const { _expTextInner } = load('2px');
  const s = _expTextInner({ tight: 1, fontSize: 14 }, 2, '#111111');
  check('tight: 여백 0 + 줄간 1 + 보이는 overflow', s.includes('padding:0')
    && s.includes('line-height:1') && s.includes('overflow:visible') && s.includes('position:relative'));
  check('tight: 테두리를 둔다', s.includes('border:2px solid transparent'));
  const p = _expTextInner({ tight: 1, pdfText: 1, fontSize: 14 }, 2, '#111111');
  check('pdf-text: 테두리가 없다', !p.includes('border:'));
  const ls = _expTextInner({ tight: 1, ls: 0.5, wsp: 2 }, 2, '#111111');
  check('tight: 수동 자간·어간을 둔다', ls.includes('letter-spacing:0.5px') && ls.includes('word-spacing:2px'));
}

// ── ⑤ 맞춤 크기(fit·trFit) ──────────────────────────────────────────
{
  const { _expTextInner } = load('2px');
  const f = _expTextInner({ fontSize: 16, fit: 1, fitSize: 12, fitLS: '0.5px' }, 2, '#111111');
  check('fit: 캐시된 맞춤 크기를 쓴다', f.includes('font-size:12px') && f.includes('letter-spacing:0.5px'));
  const t = _expTextInner({ fontSize: 16, trFit: 1, trFS: 18, trLS: '0.02em', trFW: '700' }, 2, '#111111');
  check('trFit: 번역 맞춤값을 쓴다', t.includes('font-size:18px') && t.includes('letter-spacing:0.02em')
    && t.includes('font-weight:700'));
}

// ── ⑥ 수식 ──────────────────────────────────────────────────────────
{
  const { _expLatexInner } = load('2px');
  const im = _expLatexInner({ imported: 1 }, 2, 20);
  check('가져온 수식: 여백 0 + 보이는 overflow + 가운데 (상자 밖으로 나가도 안 자름)',
    im.includes('padding:0;overflow:visible;align-items:center;')
    && !im.includes('justify-content'));
  const dp = _expLatexInner({ displayMath: 1, fontSize: 22 }, 2, 22);
  check('display: 1px 4px + 가운데', dp.includes('padding:1px 4px;overflow:visible;align-items:center;')
    && dp.includes('justify-content:center;'));
  const il = _expLatexInner({}, 2, 18);
  check('인라인: 아래 맞춤', il.includes('padding:0 4px 1px;overflow:visible;align-items:flex-end;'));
  check('수식: 테두리 + 줄바꿈 없음 + 크기', il.includes('border:2px solid transparent')
    && il.includes('white-space:nowrap') && il.includes('font-size:18px'));
}

// ── ⑦ foreignObject 리셋 ────────────────────────────────────────────
{
  const { _expForeignReset } = load('2px');
  const s = _expForeignReset();
  check('리셋이 style 태그로 감싸진다', s.startsWith('<style>') && s.endsWith('</style>'));
  check('전역 margin·padding 리셋이 있다', s.includes('.sdyx *{margin:0;padding:0;box-sizing:border-box;}'));
  check('sup/sub 규칙이 화면과 같다', s.includes('.sdyx sup{top:-.45em;}') && s.includes('.sdyx sub{bottom:-.22em;}'));
  const inner = s.replace(/^<style>/, '').replace(/<\/style>$/, '');
  check('XML 로 깨지지 않는다 (<·& 없음)', !/[<&]/.test(inner));
}

console.log(`\n내보내기 조립기 런타임: PASS ${pass} / FAIL 0`);
