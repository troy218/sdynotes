/* 텍스트 서식 엔진(SDY-FMT v2) · 편집 흐름 소스 계약 검증

   "사용자가 글을 적다가 중간에 스타일을 바꾸는" 전체 편집 패턴이 깨지지 않게
   sdynotes.js 가 지켜야 하는 불변 규칙들을 소스에서 확인한다.

     ① 서식 적용 우선순위: 표 칸 → 글자 선택 → 캐럿(앞으로 입력될 글자) → 상자 전체
     ② v2 엔진은 '세그먼트 재구축' 방식이다 — 선택 조각 수술(extract/감싸기/
        걷어내기)과 execCommand 는 글자 서식에 더 이상 존재하지 않는다
     ③ 같은 연산은 멱등이다 — 이웃 세그먼트 병합으로 span 이 누적되지 않는다
     ④ 선택(캐럿)은 문자 오프셋으로 복원된다 — DOM 이 어떻게 다시 그려져도
        재구축 중에는 저장 선택이 덮이지 않는다(_fmtBusy 잠금)
     ⑤ 토글은 워드프로세서 규칙(전부 켜져 있으면 끄고, 아니면 켠다).
        굵게/기울임 '해제'는 상자 상속과 충돌할 때만 중립값을 쓴다
     ⑥ 캐럿 서식(18.5/18.6): 선택 없이 바꾸면 '앞으로 입력될 글자'에만 적용
     ⑦ 상자 전체 칠하기/교체도 같은 엔진 경로를 쓴다
     ⑧ 타이핑 → input 디바운스 → syncTextEl → 커밋까지의 저장 사슬 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../sdynotes.js', import.meta.url), 'utf8');

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };
const idxOf = (needle, from = 0) => js.indexOf(needle, from);
const body = (name) => {
  const m = js.match(new RegExp(`function ${name}\\([^)]*\\)\\{`));
  assert.ok(m, `${name} 함수가 존재해야 한다`);
  const next = js.indexOf('\n    function ', m.index + 10);
  const end = next >= 0 ? Math.min(next, m.index + 9000) : m.index + 7000;
  return js.slice(m.index, end);
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

// ── ② v2 엔진: 세그먼트 재구축 방식 ─────────────────────────────────────
{
  check('v2 엔진 선언(18.10)이 존재한다', js.includes('SDY-FMT v2'));
  const b = body('_fmtRebuildBlock');
  check('편집은 문단 토큰을 다시 그리는 방식이다 (_fmtTokens → _fmtRender)',
    b.includes('_fmtTokens(block,host)') && b.includes('_fmtRender(out)'));
  check('글자 세그먼트에만 연산을 적고 원자 노드(<br>·<img>·타이핑 마커)는 그대로 옮긴다',
    b.includes("tk.t!=='text'") && b.includes("out.push(tk)"));
  check('타이핑 마커(.sdy-type)도 연산을 함께 받는다',
    b.includes("tk.t!=='type'") && b.includes("_setInlineProp(tk.node,op.prop,op.value)"));
}
{
  const b = body('_applyToSelection');
  check('선택 서식 적용은 v2 재구축 한 갈래다 (수술용 extractContents 없음)',
    b.includes('_fmtApply({type:\'set\',prop,value})')
    && !b.includes('extractContents'));
}
{
  const b = body('_fmtRender');
  check('같은 스타일·링크의 이웃 세그먼트는 하나의 text node 로 합쳐진다 (멱등)',
    b.includes('grp.texts.push(tk.text)') && b.includes("grp.texts.join('')"));
  check('스타일은 CSSOM 으로 적어 브라우저·jsdom 직렬화가 같다',
    b.includes('style.setProperty(_kebabProp(k)'));
  check('링크 세그먼트는 <a> 로 감싸진다', b.includes('_fmtLinkClone(grp.link)'));
}
{
  // 구 엔진의 수술·보정 도구들이 완전히 제거됐는지 — 재발 방지의 핵심
  for (const gone of ['function _applyOne', 'function _removeOne', 'function _stripInlineProp',
                      'function captureSelFonts', 'function restoreSelFonts', 'function _keepFontOnSel',
                      'function _splitAtBoundaries', 'function _expandRemovalRange',
                      'function _unlinkSingleLinkSelection', 'function _expandLinkRange']) {
    check(`구 엔진 잔재 제거: ${gone.replace('function ', '')}`, !js.includes(gone));
  }
}
{
  // 글자 서식 경로에 execCommand 가 남아 있지 않다 (클립보드 copy/cut 폴백만 허용)
  const code = (s) => s.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const fmtFns = ['applyFont', 'applyTextColor', 'applyHighlight', 'clearTextColor', 'execFmt',
                  'clearFmt', 'setAlign', 'setFS', 'toggleSelStyle', 'wrapSelStyle'];
  for (const fn of fmtFns) {
    const b = code(body(fn));
    check(`${fn}: execCommand 를 쓰지 않는다`, !b.includes('execCommand'));
  }
  check('링크 걸기(우클릭 sel-link)도 execCommand 없이 엔진으로 처리한다',
    body('editorAction').includes('_fmtLinkSelection(url.trim())'));
}

// ── ③④ 오프셋 지도와 선택 복원 ─────────────────────────────────────────
{
  const b = body('_fmtTextMap');
  check('상자 안 모든 텍스트 노드의 절대 문자 오프셋 지도를 만든다',
    b.includes('createTreeWalker(host,NodeFilter.SHOW_TEXT)') && b.includes('map.total=off'));
}
{
  const b = body('_fmtOffsetAt');
  check('어떤 지점이든 host 끝까지의 텍스트 길이로 오프셋을 잰다 (요소 경계 안전)',
    b.includes('r.setEnd(host,host.childNodes.length)') && b.includes('total-tail'));
}
{
  const b = body('_fmtRestoreSelection');
  check('연산 뒤 선택은 문자 오프셋으로 복원된다',
    b.includes('_fmtPointFromOffset(host,start)') && b.includes('savedRange=nr.cloneRange()'));
}
{
  const b = body('saveSel');
  check('재구축 중(_fmtBusy)에는 selectionchange 가 저장 선택을 덮지 않는다',
    b.includes('if(_fmtBusy) return;'));
}
{
  const b = body('_fmtRebuildBlock');
  check('host 암시 문단은 연속된 비블록 구간 전체를 다시 그린다 (고립 세그먼트 방지)',
    b.includes('while(i0>0&&!isBlk(kids[i0-1])) i0--') && b.includes('while(i1<kids.length-1&&!isBlk(kids[i1+1])) i1++'));
  check('세그먼트 스타일은 상자(블록) 레벨을 재선언하지 않는다 (_fmtChainStyle)',
    b.includes('_fmtChainStyle(tk.node,block)'));
  check('textDecoration set 은 토큰 병합이다 (밑줄+취소선 공존)',
    b.includes('toks=new Set(String(st.textDecoration') );
}
{
  const b = body('_fmtApply');
  check('선택 연산은 범위 산출 → 그룹 재구축 → 선택 복원 순서다',
    b.indexOf('_fmtOffsets(host,ctx.range)') >= 0
    && b.indexOf('_fmtGroups(host,map,o.start,o.end)') > b.indexOf('_fmtOffsets(host,ctx.range)')
    && b.indexOf('_fmtRestoreSelection(host,o.start,o.end)') > b.indexOf('_fmtGroups(host,map,o.start,o.end)'));
  check('재구축 중에는 _fmtBusy 잠금이 걸린다', b.includes('_fmtBusy=true') && b.includes('finally{ _fmtBusy=false; }'));
}

// ── ⑤ 토글 규칙과 중립값 ────────────────────────────────────────────────
{
  const b = body('toggleSelStyle');
  check('선택 토글: 전부 켜져 있으면 끄고, 아니면 (부분이든) 켠다',
    b.includes('if(all) _removeFromSelection(prop,value);') && b.includes('else _applyToSelection(prop,value);'));
}
{
  const b = body('_fmtNeutralFor');
  check('굵게/기울임 해제의 중립값은 상자 상속이 굵게/기울임일 때만 쓴다',
    b.includes('_fwVal(host.style.fontWeight)>=600') && b.includes("fontStyle"));
  const b2 = body('_removeFromSelection');
  check('해제 연산은 중립값을 엔진 op 로 넘긴다 (font-weight:400 무분별 덧대기 금지)',
    b2.includes('_fmtNeutralFor(ctx.host,prop)') && b2.includes("type:'remove'"));
}
{
  const b = body('_toggleBoxAllStyle');
  check('상자 전체 토글도 같은 규칙(전부 켜짐이면 제거)을 쓴다',
    b.includes('if(_boxHasAllStyle(w,prop,value)) _clearBoxStyleAll(w,prop,value);')
    && b.includes('else _paintBoxAll(w,prop,value);'));
}

// ── ⑥ 캐럿 서식: '앞으로 입력될 글자'에만 적용 ──────────────────────────
{
  const b = body('caretWrapStyle');
  check('캐럿 서식 span(sdy-type)을 만들어 이후 입력이 그 안에 들어간다',
    b.includes("span.className='sdy-type'"));
  check('서식 span 은 빈 span 만 재사용한다 (이미 입력된 글자까지 바꾸지 않는다)',
    b.includes('빈 span 만 재사용한다') && b.includes('_typingSpan&&!_typingSpan.textContent&&!_typingSpan.childElementCount'));
  check('캐럿 부모의 부분 글꼴을 새 span 에 고정해 글꼴이 풀리지 않는다',
    b.includes('p.style.fontFamily') && b.includes('span.style.fontFamily=font'));
  check('활성 캐럿 서식을 DOM 밖 상태에도 기억한다', b.includes('_rememberTypingStyles(span,c)'));
}
{
  const b = body('_ensurePendingTypingSpan');
  check('브라우저가 빈 span 을 제거해도 pending style 로 wrapper를 복구한다',
    b.includes('_pendingTyping') && b.includes("span.className='sdy-type'") && b.includes('_setInlineProp'));
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

// ── ⑦ 상자 전체 칠하기/교체도 같은 엔진 경로 ────────────────────────────
{
  const b = body('_paintBoxAll');
  check('상자 전체 덧칠은 엔진 전체 범위 적용을 쓴다',
    b.includes('_fmtApplyBox(c,prop,value)'));
}
{
  const b = body('_fmtApplyBox');
  check('override 모드(상자 글꼴·크기 교체)는 setbox op 를 쓴다',
    b.includes("override?'setbox':'set'"));
}
{
  const b = body('_fmtRebuildBlock');
  check('setbox 는 인라인 오버라이드가 있던 부분만 갱신한다 (상자 상속 유지)',
    b.includes("op.type==='setbox'&&!had") && b.includes('delete st[op.prop]'));
}
{
  const bf = body('applyFont'), bs = body('setFS');
  check('applyFont: 상자 전체 글꼴 교체도 엔진 override 로 처리한다',
    bf.includes("_fmtApplyBox(c,'fontFamily',f.css,true)"));
  check('setFS: 상자 전체 크기 교체도 엔진 override 로 처리한다',
    bs.includes("_fmtApplyBox(c,'fontSize',curFontSize+'px',true)"));
}
{
  const b = body('_fmtUnpaintWF');
  check('상자 전체 연산 전에 중요어 색칠(.wf 임시 레이어)을 원문으로 되돌린다',
    b.includes("host.querySelector('.wf')") && b.includes('host.innerHTML=el.html'));
}
{
  const b = body('_boxFmtTargets');
  check('상자 전체 대상에 다중 선택(.tb.msel)도 포함된다', b.includes('.tb.msel'));
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

// ── ⑧ 타이핑 → 저장 사슬 ────────────────────────────────────────────────
{
  const b = body('buildTextEl');
  const iInput = b.indexOf("c.addEventListener('input'");
  const iBlur = b.indexOf("c.addEventListener('blur'");
  check('타이핑(input)과 포커스 이탈(blur) 모두 저장 사슬과 연결돼 있다', iInput >= 0 && iBlur > iInput);
  check('keydown/beforeinput/input에서 캐럿 wrapper를 입력 생명주기에 동기화한다',
    b.includes("c.addEventListener('beforeinput'") && b.includes("c.addEventListener('keydown'")
    && b.includes('_ensurePendingTypingSpan(c)'));
}
{
  const b = body('commitEditingText');
  check('커밋은 내용을 el.html/폰트크기로 옮긴다',
    b.includes('el.html=stripWF(c.innerHTML)') && b.includes('el.fontSize=parseInt(c.style.fontSize)||16'));
  check('빈 상자도 남겨둔다 (위치 표시 유지)', b.includes('빈 상자도 남겨둔다'));
}
{
  const bUndo = body('undo'), bRedo = body('redo');
  check('되돌리기/다시 실행이 문서 Map 을 되살려 동기화가 멈추지 않는다',
    bUndo.includes('reviveDocMaps(keep)') && bRedo.includes('reviveDocMaps(keep)'));
}
{
  const b = body('syncTextEl');
  check('syncTextEl 을 부를 수 없는 화면(DOM 분리·노트 전환)에서는 무시한다',
    b.includes('w.isConnected') && js.includes('doc.__rv!==w._sdyRv'));
}

// ── ⑨ 18.8 · 선택/툴바 UX 규칙 ───────────────────────────────────────────
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
  check('편집에 들어가면 툴바 글꼴도 그 상자 글꼴로 맞춘다', b.includes('setToolbarFont(_fid)'));
}
{
  const b = body('setToolbarFS');
  check('잴 대상이 없으면(0) 툴바 글자 크기를 건드리지 않는다 (2·3 만 오가던 버그)',
    b.includes('if(!n||n<1) return;'));
  const b2 = body('syncCurSel');
  check('글자 선택이 없어도 툴바 글꼴·크기를 지금 입력 위치에 맞춘다',
    b2.includes('syncToolbarFromCaret()'));
  check("선택에 여러 글자 크기가 섞이면 Word처럼 '-'를 표시한다",
    b2.includes('else if(fsU.mixed)') && b2.includes("inp.value='-'"));
}

// ── ⑩ 18.9 · 편집 흐름/동기화 안전장치 ───────────────────────────────────
{
  const b = body('_tbMergeRemote');
  check('아직 서버에 없는 내 편집을 \'보낸 것\'으로 표시하지 않는다 (마지막 편집 유실 방지)',
    b.includes('if(hasBase && theirs===mine) doc.__lastHash.set(id,JSON.stringify(el));')
    && b.includes('else doc.__lastHash.delete(id);'));
}
{
  const b = body('clearFmt');
  check('선택 서식 지우기는 엔진 remove 로 속성을 하나씩 확실히 걷어낸다',
    b.includes('_removeFromSelection(p)') && b.includes("'fontWeight','fontStyle','textDecoration'"));
  check('선택 서식 지우기는 링크(<a>)도 엔진 unlink 로 벗긴다', b.includes('_unlinkSelection()'));
}
{
  const b = body('_unlinkSelection');
  check('unlink 는 엔진 op 한 갈래다', b.includes("type:'unlink'"));
}
{
  const b = body('_fmtAlignSelection');
  check('문단 정렬도 선택→오프셋→블록 경로다', b.includes('_fmtOffsets(ctx.host,ctx.range)'));
  const b2 = body('setAlign').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  check('문단 정렬은 execCommand(justify*) 를 쓰지 않는다', !b2.includes('execCommand'));
}

console.log(`\n텍스트 서식 엔진(v2) 소스 계약: PASS ${pass}`);
