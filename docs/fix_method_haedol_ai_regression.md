# 해돌 AI 이후 회귀 버그 수정 방법론 (다른 개발자용)

이 문서는 `troy218/sdynotes` 에서 해돌 AI 기능 추가 이후 생긴 회귀를
“코드 부풀리기 없이, 잘못된 부분을 삭제하고 정확하게 다시 쓰는” 방식으로
빠르게 고치는 방법을 정리한다. 이번 수정에서 실제로 적용한 절차 그대로 적는다.

## 1. 버그 정의 (사용자 관점)

- 해돌 질문 입력창(#aiAsk)이 너무 아래에 붙어 있음 → 살짝 위로 올린다.
- 텍스트 박스를 클릭하면 사라짐.
- 여러 쪽 문서를 읽을 때 페이지들이 한 곳에 겹쳐 보임.
- 현재 페이지 요약이 항상 첫 페이지만 요약함.

빠른 테스트만 사용: `test:textbox`, `test:pages`, `test:ai` (ai_frontend_contract).

## 2. 코드 읽기 — 어디를 봐야 하는가

- `sdynotes.css` AI 블록 (6360-6550 라인 근처):
  - `.ai-askbar { bottom:14px }`, `.draw-on { bottom:calc(64+32) }`
  - `.ai-say/.ai-hist { bottom:calc(122+var(--ai-lift)) }`, draw-on 64+140
  - 모바일 `@media max-width:640px` bottom 10 / 88
  - `ph-safe` variant bottom `+10` / `+88`
  - `#editorView > .editor-main[relative]` 안에 `.editor-body#editorBody[overflow auto] > #pagesStage` 와
    `#noteOtter`, `#aiAsk`, `#aiSay`, `#aiHist` 가 absolute 형제 → 오버레이.
- `sdynotes.js`
  - `curPageIdx` 관리: `restoreLastPos` (5407) 는 localStorage 에서 idx 를 읽고 scrollTop 을
    `(size.h+PAGE_GAP)*pageScale` 로 세팅하지만, scroll 이벤트가 오기 전까지 `curPageIdx` 가 stale.
  - `onEditorScroll` (6581) : `idx = round((scrollTop+clientHeight*0.35)/((size.h+PAGE_GAP)*pageScale))`
    → body 가 hidden 이거나 pageScale 이 0/NaN 이면 NaN → `curPageIdx|0 == 0` 고정.
  - `__sdyAiBridge.text` (17012) : `scope==='page' ? [curPageIdx|0] : all` → stale 0 때문에 항상 첫 페이지만 요약.
  - `layoutPages` (6353) : `stage.querySelectorAll('.page-wrap').forEach((w,i)=> w.style.top = i*(h+GAP)*pageScale)`
    → i 는 NodeList 순서, data-page-idx 와 다를 수 있고, pageScale 이 NaN/0 이면 top 이 모두 0 → 겹침.
    CSS `.page-wrap { contain:layout }` (1288) 는 각 페이지를 별도 stacking context 로 만들어
    겹침 시 z-index 60 인 `.tb.sel` 도 다른 wrap 뒤에 가려져 “사라짐” 으로 보임.
  - `deselectAll` (7957) : `.tb.sel/.edit` → commit → remove sel/edit, `.paper-img.sel` 해제.
  - `onPaperDown` (8605) : `.tb-content` 클릭 시 `deselectAll(true)` + sel, double-click → edit.
    논리 자체는 정상이지만, 페이지가 렌더되지 않은 상태(visible 감지 실패)에서는
    `closest('.tb')` 가 null → 빈 종이 분기로 빠져 marquee 시작 → 선택 안 됨.
  - `ensureVisiblePagesRendered` : want = `[0, cur, cur±1]` → cur 가 0 고정 시 0,1 만 렌더.
    IntersectionObserver 가 700px margin 으로 보정하지만, 초기 cur 가 NaN 이면 보호 실패.
  - `pageObserver` / `pageUnloader` : root `#editorBody`, margin 700 / 2400.

## 3. 잘못된 부분을 삭제하고 정확하게 다시 쓰기 (부풀리지 않기)

원칙: 줄 수를 늘리지 않는다. 잘못된 계산을 지우고, DOM 실측 기반의 정확한 계산으로 교체.

### 3-1. AI 입력창 올리기 — CSS만 최소 수정

변경 전:
```
.ai-askbar bottom:14px, draw-on 96px (64+32)
.ai-say/.ai-hist bottom:122px, draw-on 204px (64+140)
mobile bottom 10px / 88px
ph-safe bottom +10 / +88
```
변경 후 (20px 상승):
```
.ai-askbar bottom:34px, draw-on 116px (64+52)
.ai-say/.ai-hist bottom:142px, draw-on 224px (64+160)
mobile bottom 30px / 108px
ph-safe bottom +30 / +108
```
`note-otter` 는 그대로 둔다. 질문창만 올리라는 요구에 맞춤.

### 3-2. 현재 페이지 감지 — scrollTop 추정이 아니라 실측

삭제: `onEditorScroll` 의 `scrollTop+clientHeight*0.35 / step` 근사식.
재작성:
```js
function getVisiblePageIdx(){
  const body = document.getElementById('editorBody');
  if(!body||!doc||!doc.pages) return curPageIdx|0;
  const papers = body.querySelectorAll('#pagesStage .paper');
  if(!papers.length) return curPageIdx|0;
  const br = body.getBoundingClientRect();
  const vhMid = br.top + body.clientHeight*0.5;
  let best=curPageIdx|0, bestScore=-1e12;
  papers.forEach(p=>{
    const pi=+p.dataset.pageIdx; if(isNaN(pi)) return;
    const r=p.getBoundingClientRect();
    const visTop=Math.max(r.top,br.top), visBot=Math.min(r.bottom,br.bottom);
    const visH=Math.max(0,visBot-visTop);
    const center=(r.top+r.bottom)/2;
    const score=visH - Math.abs(center-vhMid)*0.35;
    if(score>bestScore){ bestScore=score; best=pi; }
  });
  // 교차 정보가 없으면 기존 step 추정으로 fallback
  if(bestScore<0){ /* step 계산 후 clamp */ }
  return clamp(best);
}
function onEditorScroll(){
  const idx=getVisiblePageIdx();
  if(idx!==curPageIdx){ curPageIdx=idx; updatePageInfo(); }
  ...
}
```
`__sdyAiBridge.text` 도 `getVisiblePageIdx()` 로 교체:
```js
let pi=curPageIdx|0;
try{ if(typeof getVisiblePageIdx==='function') pi=getVisiblePageIdx(); }catch{}
const idx=(scope==='page')?[pi]:doc.pages.map((_,i)=>i);
```

### 3-3. 페이지 겹침 — layoutPages 정확한 top, NaN 가드, contain:layout 제거

삭제: `forEach((w,i)=> top = i*... )` 및 `contain:layout`.
재작성:
```js
if(!isFinite(fitScale)||fitScale<=0) fitScale=1;
pageScale=fitScale*(zoomPct/100);
if(!isFinite(pageScale)||pageScale<=0) pageScale=0.5;
stage.querySelectorAll('.page-wrap').forEach(w=>{
  const pi=+w.dataset.pageIdx; const idx=isNaN(pi)?0:pi;
  w.style.top = (idx*(size.h+PAGE_GAP)*pageScale)+'px';
});
```
CSS:
```css
.page-wrap{position:absolute;left:0;top:0;transform-origin:top left;}
/* contain:layout 제거 — 각 wrap 이 stacking context 가 되어 겹침 시 sel 이 가려지던 원인 */
```

### 3-4. ensureVisiblePagesRendered 도 visible 기반

```
let vis = curPageIdx|0; try{ vis=getVisiblePageIdx(); }catch{}
want = [0, vis, vis±1, cur]
```

이렇게 하면 cur 가 stale 이어도 실제로 보이는 쪽이 렌더되고, unloader 가 sel 을 가진 페이지를 지우지 않으므로
“클릭 시 사라짐” 이 사라진다.

## 4. 빠른 테스트

- `npm run test:textbox` — 텍스트 상자 선택/편집/빈 상자 유지/다중 선택 등 46개, ~15s
- `npm run test:pages` — 페이지 추가·실시간 반영 9개, ~8s
- `node test/ai_frontend_contract.mjs` — AI 프런트 93개, ~2.5s

전체 `npm test` 는 오래 걸리므로, 수정 중에는 위 3개만 돌리고, 마지막에 한 번만 전체를 돌린다.
`sleep` 없는 `waitFor` / `MutationObserver` 기반 테스트를 유지한다.

## 5. 다른 개발자가 따라할 체크리스트

1. CSS 위치 버그 → `sdynotes.css` 에서 bottom 값만 20px 올리기, draw-on 도 동일 비율.
2. JS 현재 페이지 버그 → `getVisiblePageIdx()` 를 새로 쓰고, `onEditorScroll` 과 `__sdyAiBridge.text` 에서만 사용.
3. 겹침 버그 → `layoutPages` 에서 `i` 대신 `dataset.pageIdx`, NaN/0 가드, CSS `contain:layout` 삭제.
4. 렌더 보호 → `ensureVisiblePagesRendered` 가 visible idx 를 쓰도록.
5. 테스트 3개가 PASS 면 커밋, PR.

이 방식은 “덧붙이기” 가 아니라 “틀린 식을 지우고 실측 기반 정확한 식으로 교체” 이므로 파일이 부풀지 않는다.
