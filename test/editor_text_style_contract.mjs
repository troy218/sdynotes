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
  // 18.8 · 새 span 은 텍스트 노드를 '그 자리에서' 감싸므로 조상 서식은 저절로
  //   상속된다. 예전처럼 상속 서식을 span 에 복사하면 상자 글꼴·크기가 글자마다
  //   인라인으로 박제돼, 그 뒤로 '상자 전체 글꼴/크기 바꾸기'가 먹지 않았다.
  const b = body('_applyOne');
  check('새 span 은 상속 서식을 복사하지 않는다 (상자 글꼴·크기 변경을 막지 않음)',
    !b.includes('for(const k in styles){ if(k!==prop) target.style[k] = styles[k]; }'));
  check('새 span 은 텍스트 노드를 제자리에서 감싼다 (조상 서식은 상속으로 유지)',
    b.includes('tn.parentNode.insertBefore(target, tn)') && b.includes('target.appendChild(tn)'));
}
{
  // 18.8 · 상자 전체 글꼴/크기는 안쪽 인라인 값을 걷어내고 적용해야 실제로 보인다.
  const bf = body('applyFont'), bs = body('setFS');
  check("applyFont: 상자 전체 글꼴은 안쪽 인라인 글꼴을 걷어낸다",
    bf.includes("_stripInlineProp(c,'fontFamily',null,{skipRoot:true})"));
  check("setFS: 상자 전체 크기는 안쪽 인라인 크기를 걷어낸다",
    bs.includes("_stripInlineProp(c,'fontSize',null,{skipRoot:true})"));
  check('setFS: Ctrl+클릭 다중 선택한 모든 텍스트 상자의 크기를 바꾼다',
    bs.includes('multiSel.length') && bs.includes('targets.forEach') && bs.includes('el.fontSize=curFontSize'));
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
  check('활성 캐럿 서식을 DOM 밖 상태에도 기억한다', b.includes('_rememberTypingStyles(span,c)'));
}
{
  const b = body('_ensurePendingTypingSpan');
  check('브라우저가 빈 span 을 제거해도 pending style 로 wrapper를 복구한다',
    b.includes('_pendingTyping') && b.includes("span.className='sdy-type'") && b.includes('_setInlineProp'));
}
{
  const b = body('buildTextEl');
  check('keydown/beforeinput/input에서 캐럿 wrapper를 입력 생명주기에 동기화한다',
    b.includes("c.addEventListener('beforeinput'") && b.includes("c.addEventListener('keydown'")
    && b.includes('_ensurePendingTypingSpan(c)'));
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
  check('툴바 포커스로 생긴 일시적 collapse는 저장한 드래그 범위를 덮지 않는다',
    b.includes('_toolbarSelLockUntil'));
}
{
  check('touch/pen도 버튼 기본 포커스 전에 pointerdown capture로 선택을 저장한다',
    js.includes("document.addEventListener('pointerdown',e=>{")
    && js.includes('_isFormatToolbarTarget(e.target)')
    && js.includes('_toolbarSelLockUntil=Date.now()+1500'));
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
  const b = body('_cleanupInline');
  check('정리 단계는 style="" 만 남은 span 도 풀어낸다', b.includes('meaningfulAttrs') && b.includes("a.name==='style'"));
}
{
  const b = body('_boxFmtTargets');
  check('상자 전체 대상에 다중 선택(.tb.msel)도 포함된다', b.includes('.tb.msel'));
}
{
  const b = body('toggleMultiSelect');
  check('Ctrl+클릭 다중 선택은 이전 글자 선택(savedRange)을 먼저 비운다', b.includes('clearTextSelection()'));
}
{
  const b = body('clearTextColor');
  check('글자색 지우기는 상자 내부 color 와 구버전 el.textColor 를 함께 제거한다',
    b.includes("_clearBoxStyleAll(w,'color')"));
}
{
  const b = body('_activeToggleStates');
  check('상자 전체 서식 툴바 상태는 글자별 span 전체 적용도 읽는다',
    b.includes("_boxHasAllStyle(node,'fontWeight','700')")
    && b.includes("_boxHasAllStyle(node,'textDecoration','underline')"));
}
{
  const b = body('clearBoxFormatting');
  check('상자 서식 지우기는 구버전 box-level 스타일 필드를 모두 제거한다',
    b.includes('delete el.textColor') && b.includes('delete el.cellBg') && b.includes('delete el.font')
    && b.includes('delete el.fontWeight') && b.includes('delete el.fontStyle') && b.includes('delete el.textDecoration'));
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

// ── ⑧ 18.8 · 선택/툴바 UX 규칙 ───────────────────────────────────────────
{
  const b = body('onPaperDown');
  check('우클릭(pointerdown button=2)은 선택을 건드리지 않고 곧바로 빠져나온다',
    /if\(e\.button===2\)\{[^}]*saveSel\(\);?[^}]*\}[^\n]*\n?[^\n]*return;|if\(e\.button===2\)\{ try\{ saveSel\(\); \}catch\(_e\)\{\} return; \}/.test(b));
}
{
  const b = body('addTextBox');
  check('새 글상자는 글꼴·크기만 물려받고 나머지 서식은 푼다',
    b.includes('resetTypingFormat()') && b.includes('fontSize:curFontSize') && b.includes('font:curFont'));
  check('새 글상자를 만들면 툴바를 지금 입력될 서식에 맞춘다',
    b.includes('syncToolbarFromCaret()'));
}
{
  const b = body('resetTypingFormat');
  check('서식 풀기는 캐럿 span·저장 선택과 툴바 토글을 함께 비운다',
    b.includes('_typingSpan=null') && b.includes('savedCaret=null')
    && b.includes(".tb-bold") && b.includes("classList.remove('active')"));
}
{
  const b = body('setToolbarFS');
  check('잴 대상이 없으면(0) 툴바 글자 크기를 건드리지 않는다 (2·3 만 오가던 버그)',
    b.includes('if(!n||n<1) return;'));
  check("같은 숫자로 돌아와도 mixed '-' 표시를 정상 숫자로 복원한다",
    b.indexOf("inp.classList.remove('mixed')") < b.indexOf('if(v===curFontSize) return;'));
}
{
  const b = body('syncCurSel');
  check('글자 선택이 없어도 툴바 글꼴·크기를 지금 입력 위치에 맞춘다',
    b.includes('syncToolbarFromCaret()'));
  check("선택에 여러 글자 크기가 섞이면 Word처럼 '-'를 표시한다",
    b.includes('else if(fsU.mixed)') && b.includes("inp.value='-'") && b.includes("classList.add('mixed')"));
  const b2 = body('syncToolbarFromCaret');
  check('툴바 동기화는 캐럿 → 고른 상자 순으로 기준을 잡는다',
    b2.indexOf('_typingHost()') >= 0 && b2.indexOf('_typingHost()') < b2.indexOf('syncFSFromTarget()'));
  const b3 = body('enterEdit');
  check('편집에 들어가면 툴바 글꼴도 그 상자 글꼴로 맞춘다', b3.includes('setToolbarFont(_fid)'));
}

// ── ⑨ 18.9 · 편집 흐름/동기화 안전장치 ────────────────────────────────────
{
  const b = body('_tbMergeRemote');
  check('아직 서버에 없는 내 편집을 \'보낸 것\'으로 표시하지 않는다 (마지막 편집 유실 방지)',
    b.includes('if(hasBase && theirs===mine) doc.__lastHash.set(id,JSON.stringify(el));')
    && b.includes('else doc.__lastHash.delete(id);'));
}
{
  const b = body('tblDelAll');
  check('표 전체 삭제가 없는 함수(clearSel)를 부르지 않는다',
    !b.includes('clearSel()') && b.includes('deselectAll(true)'));
}
{
  const b = body('clearFmt');
  check('선택 서식 지우기는 execCommand 없이도 동작한다 (인라인 엔진)',
    b.includes("_removeFromSelection(p)") && b.includes("'fontWeight','fontStyle','textDecoration'"));
  check('선택 서식 지우기는 execCommand 없이도 링크(<a>)를 벗긴다', b.includes('_unlinkSelection()'));
}
{
  const bCopy = body('copyInlineSelectionForAction');
  const bCut = body('cutInlineSelectionForAction');
  const bAct = body('editorAction');
  check('선택 글자 복사/잘라내기는 execCommand 없이도 안전한 helper 를 쓴다',
    bCopy.includes('writeClipboardTextSafe') && bCut.includes('r.deleteContents()')
    && bAct.includes('await copyInlineSelectionForAction()') && bAct.includes('await cutInlineSelectionForAction(t.el)'));
  check('스크립트로 바꾼 편집 내용은 편집 중 Ctrl+Z 로 앱 히스토리 되돌리기를 탄다',
    js.includes('_scriptEditUndoable=true') && js.includes('editContent&&!_scriptEditUndoable'));
}
{
  const b = body('_expandLinkRange');
  check('링크 전체를 선택했으면 <a> 바깥까지 범위를 넓혀 unlink 한다',
    b.includes("p.tagName==='A'") && b.includes('_rangeCoversContents(out,p)'));
}
{
  const b = body('_unlinkSingleLinkSelection');
  check('링크 일부만 선택해도 선택 조각만 링크에서 빼낸다',
    b.includes('beforeFrag') && b.includes('selFrag') && b.includes('afterFrag') && b.includes('_cloneLinkShell(a,beforeFrag)'));
}
{
  const b = body('deletePage');
  check('페이지 삭제는 인자가 없거나 잘못돼도 안전하다',
    b.includes('if(i==null||isNaN(+i)) i=curPageIdx;') && b.includes('if(!doc||!doc.pages[i]) return;'));
}
{
  check('타이핑도 되돌리기 지점을 남긴다 (편집 시작 스냅샷)',
    js.includes('function markEditSnapshot()') && js.includes('function commitEditSnapshot()')
    && js.includes('if(w.classList.contains(\'edit\')) commitEditSnapshot();'));
}
{
  const b = body('copySelectedTextAsText');
  check('상자를 복사하면 요소 자체도 함께 기억한다 (붙여넣기 = 상자 복제)',
    b.includes('clipboardEls=JSON.parse(JSON.stringify(els))') && b.includes('_lastCopyText=text'));
  check('같은 글자를 붙여넣으면 상자로 복원한다',
    js.includes("if(clipboardEls.length&&plain&&_lastCopyText&&plain.trim()===_lastCopyText.trim())"));
}
{
  check('편집 중 Escape 는 노트를 닫지 않고 편집만 끝낸다',
    js.includes("const w=inContent?ae.closest('.tb'):document.querySelector('.tb.edit');"));
}
{
  const b = body('_rangeCoversContents');
  check('경계가 안쪽 텍스트 노드여도 \'내용 전체 선택\'을 알아본다 (<b> 벗기기)',
    b.includes("String(r.toString())!==txt"));
}

console.log(`\n텍스트 서식 엔진 계약: PASS ${pass} / FAIL 0`);
