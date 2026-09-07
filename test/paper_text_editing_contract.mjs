/* 불러온 논문(tight/pdfText) 서식 칠하기 및 줄간격 재계산 계약 검증 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };

check('_isPosSpan 판별 함수가 서식 엔진 근처에 존재한다', js.includes('function _isPosSpan(el)'));
check('_isPosSpan 이 position:absolute 또는 pdfW/fs/origTop 데이터셋을 인식한다',
  js.includes("el.style.position==='absolute'") && js.includes('el.dataset.pdfW!=null'));

check('_fmtLeafBlock 이 절대좌표 배치 span(_isPosSpan)을 블록 경계로 인식한다',
  js.includes('FMT_BLOCK_TAGS.has(p.tagName)||_isPosSpan(p)'));

check('_fmtTokens 가 host 레벨 토큰화 중 배치 span 안으로 침범하지 않는다',
  js.includes('FMT_BLOCK_TAGS.has(tag)||_isPosSpan(k)'));

check('_fmtRebuildBlock 이 배치 span 간 경계를 구분한다',
  js.includes('FMT_BLOCK_TAGS.has(n.tagName)||_isPosSpan(n)'));

check('buildTextEl 이 dataset.origTop 을 기억하여 줄간격(el.lg) 복합 누적 확장을 막는다',
  js.includes('s.dataset.origTop||s.style.top') && js.includes('s.dataset.origTop=origTop.toFixed(1)'));

check('_measureTightSpans 및 _applyTightFit 이 origTop 및 el.lg 와 일관되게 좌표를 맞춘다',
  js.includes('parseFloat(s.dataset.origTop||s.style.top)') && js.includes('(t0+(baseTop-t0)*el.lg)'));

console.log(`\n불러온 논문 편집 및 줄간격 계약: PASS ${pass}`);
