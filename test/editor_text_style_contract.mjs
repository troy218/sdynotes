/* 텍스트 서식 엔진 · 편집 흐름 소스 계약 검증

   "사용자가 글을 적다가 중간에 스타일을 바꾸는" 전체 편집 패턴이 깨지지 않게
   sdynotes.js 가 지켜야 하는 불변 규칙들을 소스에서 확인한다.

     ① 서식 적용 우선순위: 표 칸 → 글자 선택 → 캐럿(앞으로 입력될 글자) → 상자 전체
     ② 인라인 엔진은 선택 조각만 떼어 새 span 으로 감싸므로 선택 밖 글자와
        다른 서식(글꼴·색·굵기…)이 풀리지 않는다
     ③ 토글은 워드프로세서 규칙(전부 켜져 있으면 끄고, 아니면 켠다)
     ④ 캐럿 서식(18.5/18.6): 선택 없이 스타일을 바꾸면 상자 전체가 아니라
        '앞으로 입력될 글자'에만 적용된다 — 빈 span 만 재사용한다
     ⑤ 저장 선택(savedRange)과 남아 있던 캐럿(savedCaret)의 우선순위 규칙
     ⑥ 상자 전체 칠하기/토글은 글자 단위 엔진을 재사용해 기존 인라인 서식을 보존한다
     ⑦ 타이핑 → input 디바운스 → syncTextEl → 커밋까지의 저장 사슬 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };
const idxOf = (needle, from = 0) => js.indexOf(needle, from);
const body = (name) => {
  const m = js.match(new RegExp(`function ${name}\\([^)]*\\)\\{`));
  assert.ok(m, `${name} 함수가 존재해야 한다`);
  return js.slice(m.index, m.index + 6000);
};

// ── ① 서식 적용 우선순위 (표 칸 → 글자 선택 → 캐럿 → 상자 전체) ──────────
for (const fn of ['applyTextColor', 'applyHighlight']) {
  const b = body(fn);
  const iCell = b.indexOf('selectedTblCellEls()');
  const iSel = b.indexOf('hasInlineTextSel()');
  const iCaret = b.indexOf('_typingHost()');
  const iBox = b.indexOf('_boxFmtTargets()');
  check(`${fn}: 표 칸 → 글자 선택 → 캐럿 → 상자 전체 순서를 지킨다`,
    iCell >= 0 && iCell < iSel && iSel < iCaret && iCaret < iBox);
}
{
  const b = body('applyFont');
  const iSel = b.indexOf('restoreSel()');
  const iCaret = b.indexOf('_typingHost()');
  const iBox = b.indexOf('targets.forEach');
  check('applyFont: 글자 선택 → 캐럿 → 상자 전체 순서를 지킨다', iSel >= 0 && iSel < iCaret && iCaret < iBox);
}
{
  const b = body('execFmt');
  const iCell = b.indexOf('selectedTblCellEls()');
  const iSel = b.indexOf('hasInlineTextSel()');
  const iCaret = b.indexOf('_typingHost()');
  const iBox = b.indexOf('_boxFmtTargets()');
  check('execFmt: 표 칸 → 글자 선택 → 캐럿 → 상자 전체 순서를 지킨다',
    iCell >= 0 && iCell < iSel && iSel < iCaret && iCaret < iBox);
}

// ── ② 인라인 엔진: 선택 밖 글자·다른 서식 보존 ───────────────────────────
{
  const b = body('_applyToSelection');
  check('선택 서식은 조각을 떼어내 감싸는 방식이라 선택 밖이 안전하다',
    b.includes('r.extractContents()') && b.includes('span.appendChild(frag)'));
  check('선택 안의 같은 속성만 벗겨내고 다른 속성은 그대로 둔다',
    b.includes('_stripInlineProp(frag,prop,value)'));
}
{
  const b = body('_applyOne');
  check('새 span 을 만들 때 기존 상속 서식을 복사해 다른 서식이 풀리지 않는다',
    b.includes('for(const k in styles){ if(k!==prop) target.style[k] = styles[k]; }'));
}
{
  const b = body('_removeFromSelection');
  check('굵기/기울임 제거는 normal span 으로 상속을 끊는다',
    b.includes("span.style[prop]=(prop==='fontWeight')?'400':'normal'"));
}

// ── ③ 워드프로세서식 토글 규칙 ───────────────────────────────────────────
{
  const b = body('toggleSelStyle');
  check('선택 토글: 전부 켜져 있으면 끄고, 아니면 (부분이든) 켠다',
    b.includes('if(all) _removeFromSelection(prop,value);') && b.includes('else _applyToSelection(prop,value);'));
}
{
  const b = body('_toggleBoxAllStyle');
  check('상자 전체 토글도 같은 규칙(전부 켜짐이면 제거)을 쓴다',
    b.includes('if(_boxHasAllStyle(w,prop,value)) _clearBoxStyleAll(w,prop,value);')
    && b.includes('else _paintBoxAll(w,prop,value);'));
}

// ── ④ 캐럿 서식: '앞으로 입력될 글자'에만 적용 ───────────────────────────
{
  const b = body('caretWrapStyle');
  check('캐럿 서식 span(sdy-type)을 만들어 이후 입력이 그 안에 들어간다',
    b.includes("span.className='sdy-type'"));
  check('서식 span 은 빈 span 만 재사용한다 (이미 입력된 글자까지 바꾸지 않는다)',
    b.includes('빈 span 만 재사용한다') && b.includes('_typingSpan&&!_typingSpan.textContent&&!_typingSpan.childElementCount'));
  check('캐럿 부모의 부분 글꼴을 새 span 에 고정해 글꼴이 풀리지 않는다',
    b.includes('p.style.fontFamily') && b.includes('span.style.fontFamily=font'));
  check('서식 span 을 커밋(syncTextEl)해 저장 사슬을 잇는다', b.includes('syncTextEl(w)'));
}
{
  const b = body('_typingHost');
  check('살아 있는 캐럿이 편집 중 상자 안에 있으면 그 자리를 우선한다',
    b.indexOf("classList.contains('edit')") >= 0 && b.indexOf('savedCaret') > b.indexOf("classList.contains('edit')"));
}
{
  const b = body('setFS');
  check('글자 크기도 캐럿에서는 상자 전체가 아니라 앞으로 입력될 글자에만 적용된다',
    b.includes('if(_typingHost()){ caretWrapStyle({fontSize:curFontSize+\'px\'}); return; }'));
}
{
  const b = body('chFS');
  check('증감 버튼은 지금 보이는 크기에서 증감한다 (선택이 없을 때)',
    b.includes('if(!hasInlineTextSel()) syncFSFromTarget();'));
}

// ── ⑤ savedRange / savedCaret 우선순위 ──────────────────────────────────
{
  const b = body('saveSel');
  const iCollapsed = b.indexOf('s.isCollapsed');
  const iInvalidate = b.indexOf('savedCaret=null; _typingSpan=null;');
  const iStore = b.indexOf('savedRange=r.cloneRange();');
  check('글자 선택이 생기면 남아 있던 캐럿 서식은 더 이상 우선하지 않는다',
    iInvalidate >= 0 && iInvalidate > iCollapsed && iStore >= 0);
  check('접힌 캐럿도 편집 중 상자 안이면 기억한다', b.includes("classList.contains('edit')"));
}
{
  const b = body('enterEdit');
  check('편집에 들어가면 이전 상자의 저장된 선택/캐럿을 먼저 지운다',
    b.indexOf('clearTextSelection()') >= 0);
}

// ── ⑥ 상자 전체 칠하기 ──────────────────────────────────────────────────
{
  const b = body('_paintBoxAll');
  check('상자 전체 칠하기는 글자 단위 엔진(_applyOne)을 그대로 쓴다',
    b.includes('_boxTextNodes(c).forEach(tn=>_applyOne(tn,c,prop,value))'));
  check('칠한 뒤 빈 span 을 정리한다', b.includes('_cleanupInline(c)'));
}
{
  const b = body('_boxFmtTargets');
  check('상자 전체 대상에 다중 선택(.tb.msel)도 포함된다', b.includes('.tb.msel'));
}
{
  const b = body('clearTextColor');
  check('글자색 지우기는 color 속성만 제거한다', b.includes("n.style.removeProperty('color')"));
}

// ── ⑦ 타이핑 → 저장 사슬 ────────────────────────────────────────────────
{
  const b = body('buildTextEl');
  const iInput = b.indexOf("c.addEventListener('input'");
  const iBlur = b.indexOf("c.addEventListener('blur'");
  check('타이핑(input)과 포커스 이탈(blur) 모두 저장 사슬과 연결돼 있다', iInput >= 0 && iBlur > iInput);
}
{
  const b = body('commitEditingText');
  check('커밋은 내용을 el.html/폰트크기로 옮긴다',
    b.includes('el.html=stripWF(c.innerHTML)') && b.includes('el.fontSize=parseInt(c.style.fontSize)||16'));
  check('빈 상자도 남겨둔다 (위치 표시 유지)', b.includes('빈 상자도 남겨둔다'));
}
{
  const b = body('exitEditKeepSel');
  check('편집 종료 후에도 상자가 선택 상태로 남는다',
    b.includes('commitEditingText(w)') && b.includes("w.classList.add('sel')"));
}
{
  const bUndo = body('undo'), bRedo = body('redo');
  check('되돌리기/다시 실행이 문서 Map 을 되살려 동기화가 멈추지 않는다',
    bUndo.includes('reviveDocMaps(keep)') && bRedo.includes('reviveDocMaps(keep)'));
}

console.log(`\n텍스트 서식 엔진 계약: PASS ${pass} / FAIL 0`);
