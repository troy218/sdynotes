/* === src/app/08-selection-table.js ===
   선택/드래그 · 표 · 스프레드시트 셀
   (sdynotes.js 메가 분리 · 이 파일들은 scripts/bundle-frontend.mjs 가 순서대로 이어 붙인다.
    let/const 스코프를 공유하려면 반드시 concat 되어야 한다 — 단독 <script> 로드 금지) */
/* APP-PART:08-selection-table.js:BEGIN */
    // ============ 선택/드래그 ============
    let selected=null, drag=null, resize=null;
    let textToolActive=false, tablePlace=null, curFontSize=16, _textPointerBlockUntil=0;

    // 선택된 것이 항상 맨 앞으로 오도록 해당 레이어를 끌어올린다.
    //
    // ★ 14.30.1 성능 — 예전에는 `#pagesStage 안의 모든 종이`를 훑으면서 종이마다
    //   하위 선택자 3개(`.tb.sel,.tb.edit,.tb.msel` 등)를 **종이 subtree 전체**에
    //   돌렸다. 논문처럼 글상자·단어 span 이 쪽당 수백~수천 개인 문서에서는 한 번
    //   부를 때마다 수만 번의 선택자 대조가 일어나고, 아래 MutationObserver 가
    //   렌더 중 생기는 모든 class 변경(empty·tight·형광펜 띠·현재 쪽 focused …)
    //   마다 이걸 불러서 스크롤이 통째로 멎었다.
    //   (프로파일: 무거운 논문 스크롤 시간의 90% 이상이 이 함수였다)
    //
    //   지금은 ① 화면에 올라와 있는 종이만 보고 ② 레이어의 **직계 자식**만
    //   확인한다. `.tb`/`.paper-img`/`.stroke-g` 는 언제나 각 레이어의 직계
    //   자식이므로 판정 결과는 예전과 완전히 같고, 비용만 subtree 크기와
    //   무관해진다.
    function _layerLift(layer){
        if(!layer) return;
        let on=false;
        for(let n=layer.firstElementChild;n;n=n.nextElementSibling){
            const cl=n.classList;
            if(cl&&(cl.contains('sel')||cl.contains('edit')||cl.contains('msel'))){ on=true; break; }
        }
        const v=on?'50':'';
        // 같은 값을 다시 쓰면 브라우저가 불필요하게 스타일을 무효화한다.
        if(layer.style.zIndex!==v) layer.style.zIndex=v;
    }
    function _liftPaper(p){
        if(!p) return;
        _layerLift(p.querySelector('.layer-text'));
        _layerLift(p.querySelector('.layer-img'));
        _layerLift(p.querySelector('.layer-stroke'));
    }
    function liftLayers(){
        // 올라와 있는 종이는 mountedShells 가 O(1) 로 알고 있다 (가상화 규칙 4).
        if(mountedShells&&mountedShells.size){
            mountedShells.forEach(w=>{ try{ _liftPaper(w.querySelector('.paper')); }catch(e){} });
            return;
        }
        document.querySelectorAll('#pagesStage .paper').forEach(_liftPaper);
    }
    // 세로 도구막대 · 가이드 상태 복원
    addEventListener('DOMContentLoaded',()=>{
        try{
            initSide();
            guidesOn=localStorage.getItem('sdy_guides')==='1';
            if(localStorage.getItem('sdy_sepia')==='1') setTimeout(toggleSepia,50);
            const st=document.getElementById('pagesStage');
            if(st) st.classList.toggle('guides',guidesOn);
            const gb=document.getElementById('guideBtn');
            if(gb) gb.classList.toggle('active',guidesOn);
        }catch(e){}
    });
    // 선택 상태가 바뀔 때마다 자동으로 정리
    //
    // ★ 14.30.1 성능 — 이 관찰자는 `#pagesStage` 아래 **모든** class 변경에
    //   반응한다. 그런데 쪽을 그리는 동안에도 class 는 쉴 새 없이 바뀐다
    //   (빈 상자 `empty`, 가져온 상자 `tight`, 형광펜 띠 `sdy-hl-band-on`,
    //   현재 쪽 `focused` …). 예전에는 그 하나하나가 전체 종이 재스캔을
    //   불러서, 쪽을 하나 그릴 때마다 수백 번의 전수 조사가 겹쳤다.
    //   이제 ① 선택 상태와 무관한 변경은 즉시 버리고 ② 남은 것도 그 종이만
    //   ③ 프레임당 한 번(rAF)으로 모아서 처리한다. 화면 결과는 동일하다.
    (function(){
        const SEL_CLS=['sel','edit','msel'];
        let pend=null,raf=0;
        const flush=()=>{
            raf=0;
            const set=pend; pend=null;
            if(!set) return;
            set.forEach(p=>{ try{ if(p.isConnected) _liftPaper(p); }catch(e){} });
        };
        const mo=new MutationObserver(recs=>{
            for(const r of recs){
                const t=r.target;
                if(!t||t.nodeType!==1) continue;
                // 편집 상자 캐시(_activeEditBox)도 같은 신호로 무효화한다 —
                // 'edit' 가 붙거나 떨어지는 순간을 여기서 전부 본다.
                if(r.attributeName==='class'){
                    const now=t.classList&&t.classList.contains('edit');
                    const was=/(^|\s)edit(\s|$)/.test(r.oldValue||'');
                    if(now||was) _editScanDirty=true;
                    // 22.1 · 테두리·손잡이는 '고려진 상자'에만 만든다. 위 선택 경로들을
                    //   지나치지 않고 class 만 바뀌는 경로(찾기·AI 서식·테이블 셀 등)도
                    //   여기 걸린다. 렌더 중에 붙이는 게 아니라 고를 때만 붙인다.
                    if(now||t.classList&&(t.classList.contains('sel')||t.classList.contains('msel'))){
                        if(t.classList&&(t.classList.contains('tb')||t.classList.contains('latex-box'))){
                            try{ _ensureTbControls(t); }catch(_e){}
                        }
                    }
                }
                // 선택 표시가 붙고 떨어지는 건 .tb / .paper-img / .stroke-g 뿐이다.
                const cl=t.classList; if(!cl) continue;
                if(!cl.contains('tb')&&!cl.contains('paper-img')&&!cl.contains('stroke-g')){
                    // 지금 선택 클래스가 없더라도 '방금 떨어진' 경우가 있으므로
                    // 이전 값(oldValue)에 선택 클래스가 있었는지도 본다.
                    const ov=r.oldValue||'';
                    if(!SEL_CLS.some(c=>ov.split(/\s+/).indexOf(c)>=0)) continue;
                }
                const p=t.closest&&t.closest('.paper');
                if(!p) continue;
                (pend||(pend=new Set())).add(p);
            }
            if(pend&&!raf) raf=requestAnimationFrame(flush);
        });
        addEventListener('DOMContentLoaded',()=>{
            const st=document.getElementById('pagesStage');
            if(st){
                mo.observe(st,{subtree:true,attributes:true,attributeFilter:['class'],attributeOldValue:true});
                _editObsOn=true;   // 이제부터 편집 상자 캐시를 믿어도 된다
            }
        });
    })();

    function deselectAll(keepTool){
        document.querySelectorAll('.tb.sel,.tb.edit').forEach(w=>{
            if(w.classList.contains('edit')) commitEditingText(w);
            w.classList.remove('sel','edit'); _editScanDirty=true;
            const c=w.querySelector('.tb-content');
            if(c){ c.contentEditable='false'; disableTextSelect(c); }
        });
        // 상자 선택뿐 아니라 '글자 선택(하이라이트)' 도 함께 해제
        clearTextSelection();
        document.querySelectorAll('.paper-img.sel').forEach(w=>w.classList.remove('sel'));
        document.querySelectorAll('.stroke-g.sel').forEach(g=>g.classList.remove('sel'));
        selected=null;
        if(!keepTool) setTextTool(false);
    }

    function commitEditingText(only){
        // 14.15 · 노트 교체 중(새 doc 이 아직 안 왔거나 이전 doc 이 남은 상태)에는
        //   이전 편집 상자를 새 노트/다른 노트 본문에 커밋하지 않는다.
        if(!doc||!curNB) return;
        if(_docId && _docId!==curNB.id) return;
        const list=only?[only]:Array.from(document.querySelectorAll('.tb.edit'));
        // 색칠 상태였다면 편집이 끝난 상자에 색을 다시 입힌다
        if(wfOn) setTimeout(()=>{
            try{
                wfAnalyze();
                const max=wfStats.length?wfStats[0].n:1;
                list.forEach(w=>{
                    if(!w||w.classList.contains('edit')) return;
                    const c=w.querySelector('.tb-content');
                    if(c&&!c.querySelector('.wf')) wfPaintNode(c,max);
                });
                if(sidePanel==='words') renderPanel();
            }catch(e){}
        },60);
        // 22.1 · '실제로 바뀐 상자'만 문서를 더럽히고 저장을 다시 예약한다.
        //   예전에는 오토세이브(flushSaveDoc)가 커밋을 부르고, 커밋이 또 saveDoc 을
        //   걸어 400ms 주기가 편집 중 계속 도는 에코 루프였다 — 글자 하나 안 쳐도
        //   직렬화·동기화·전수 sanitize 가 되풀이됐고, 그게 똥컴 편집 렉의 일부였다.
        let changed=false;
        list.forEach(w=>{
            if(!w) return;
            const el=findEl(+w.dataset.pageIdx,w.dataset.id); if(!el) return;
            const c=w.querySelector('.tb-content');
            const nh=c.innerHTML===w._sdyViewHtml?el.html:imathCollapse(stripWF(c.innerHTML));
            const nfs=parseFloat(c.style.fontSize)||16;
            if(nh!==el.html||nfs!==el.fontSize){
                el.html=nh; el.fontSize=nfs; changed=true;
                w._sdyModelHtml=el.html; w._sdyViewHtml=c.innerHTML; w._sdyModelKey=JSON.stringify(el);
                // 14.6 · 커밋된 편집분도 dirty 로 표시 → 가져온 문서(서버 보관본)에서
                //  나가기 직전 커밋된 글자가 슬라이스 저장에서 빠져 유실되지 않는다.
                try{ markPageEdited(+w.dataset.pageIdx); }catch(e){}
            }
            // 빈 상자도 남겨둔다 (연한 점선 + 안내 문구로 위치 표시)
            const plain=String((c.innerText!=null?c.innerText:c.textContent)||'');
            const isEmpty=!plain.trim()&&!c.querySelector('img');
            w.classList.toggle('empty',isEmpty);
            if(isEmpty) c.setAttribute('data-empty','true');
        });
        if(changed){
            if(_commitFromSave){ try{ bumpAiText(); }catch(e){} }   // 저장은 직전 단계에서 한다
            else saveDoc();
        }
    }

    function enterEdit(w,keepSel){
        // 중요어 색칠 상태에서 글을 고치면 색이 원문에 섞일 수 있다.
        // → 편집에 들어가는 상자는 원래 글자로 되돌린다.
        if(wfOn&&w){
            const el=findEl(+w.dataset.pageIdx,w.dataset.id);
            const c0=w.querySelector('.tb-content');
            if(el&&c0&&c0.querySelector('.wf')) c0.innerHTML=el.html||'';
        }
        // 14.13.7 · 다른 상자에 남아 있던 글자 선택(저장된 범위)은 이제 무효다.
        //   이걸 지우지 않으면 편집 중 색/형광펜을 칠할 때 엉뚱한 상자의
        //   선택이 복원되어 그쪽이 칠해진다.
        clearTextSelection();
        document.querySelectorAll('.tb.edit').forEach(o=>{ if(o!==w){ commitEditingText(o); o.classList.remove('edit'); _editScanDirty=true; const c=o.querySelector('.tb-content'); if(c)c.contentEditable='false'; }});
        document.querySelectorAll('.tb.sel,.paper-img.sel,.stroke-g.sel').forEach(o=>{ if(o!==w) o.classList.remove('sel'); });
        w.classList.add('edit'); w.classList.remove('sel');
        _ensureTbControls(w);            // 22.1 · 장식은 지금 이 순간 붙인다
        // MutationObserver 는 마이크로태스크라 같은 실행 흐름 안에서는 아직
        // 오지 않는다 → 편집 상자 캐시를 지금 바로 확정한다.
        _editBoxEl=w; _editScanDirty=false;
        selected={type:'text',el:w};
        markEditSnapshot(w);         // 18.9 · 이 상자를 고치기 '직전' 상태를 기억 (22.1 · 상자 하나만 — doc 전체 직렬화 아님)
        syncFSFromTarget();          // 편집에 들어간 상자의 글자 크기를 툴바에
        // 18.8 · 툴바 글꼴도 이 상자의 글꼴로 맞춘다 (툴바 = 지금 입력될 글꼴)
        try{
            const _el=findEl(+w.dataset.pageIdx,w.dataset.id);
            const _c=w.querySelector('.tb-content');
            const _fid=(_el&&_el.font)||(_c?_fontIdFromCSS(_c.style.fontFamily||''):'');
            if(_fid) setToolbarFont(_fid);
        }catch(e){}
        const c=w.querySelector('.tb-content');
        c.contentEditable='true';
        if(c.getAttribute('data-empty')==='true') c.innerHTML='';
        if(keepSel){ c.focus({preventScroll:true}); return; }
        c.focus();
        try{
            const r=document.createRange(), s=window.getSelection();
            if(c.childNodes.length) r.setStartAfter(c.lastChild); else r.setStart(c,0);
            r.collapse(true); s.removeAllRanges(); s.addRange(r);
        }catch(e){}
    }

    // ============ 스프레드시트식 셀 이동/편집 ============
    // 현재 페이지의 텍스트 상자들을 좌표 기준으로 모은다
    function collectTextBoxes(pi){
        if(pi==null) pi=curPageIdx;
        const page=doc.pages[pi];
        if(!page) return [];
        const out=[];
        (page.els||[]).forEach(el=>{
            if(el.type!=='text') return;
            const node=paperQ(pi,'.tb[data-id="'+el.id+'"]');
            out.push({id:el.id, pi, el, node, x:el.x||0, y:el.y||0, w:el.w||0, h:el.h||0});
        });
        return out;
    }
    // 현재 선택된 '단일 텍스트 상자' (다중 선택이면 null)
    function currentSelText(){
        if(multiSel.length) return null;
        if(!selected||!selected.el||selected.type!=='text') return null;
        const pi=+selected.el.dataset.pageIdx;
        const el=findEl(pi,selected.el.dataset.id);
        if(!el||el.type!=='text') return null;
        return {id:el.id, pi, el, node:selected.el, x:el.x||0, y:el.y||0, w:el.w||0, h:el.h||0};
    }
    // 특정 상자를 '선택' 상태로 만든다
    function selectTextBoxById(pi,id){
        const node=paperQ(pi,'.tb[data-id="'+id+'"]');
        if(!node) return false;
        deselectAll(true); clearMulti();
        node.classList.add('sel'); _ensureTbControls(node);
        selected={type:'text',el:node};
        return true;
    }
    // 방향(up/down/left/right) 기준 가장 가까운 상자 찾기
    function nearestBox(cur,dir){
        const boxes=collectTextBoxes(cur.pi);
        let best=null, bestScore=Infinity;
        const cx=cur.x+cur.w/2, cy=cur.y+cur.h/2;
        for(const b of boxes){
            if(b.id===cur.id) continue;
            const bx=b.x+b.w/2, by=b.y+b.h/2;
            let ok=false, score=0;
            if(dir==='left'){ ok=bx<cx-1; if(ok) score=(cx-bx)+Math.abs(cy-by)*2; }
            else if(dir==='right'){ ok=bx>cx+1; if(ok) score=(bx-cx)+Math.abs(cy-by)*2; }
            else if(dir==='up'){ ok=by<cy-1; if(ok) score=(cy-by)+Math.abs(cx-bx)*2; }
            else { ok=by>cy+1; if(ok) score=(by-cy)+Math.abs(cx-bx)*2; }
            if(ok && score<bestScore){ bestScore=score; best=b; }
        }
        return best;
    }
    // 읽는 순서(위→아래, 왼→오) 기준 다음/이전 상자 (Tab 이동용)
    function nextBoxInOrder(cur,delta){
        const boxes=collectTextBoxes(cur.pi).sort((a,b)=>(a.y-b.y)||(a.x-b.x));
        const i=boxes.findIndex(b=>b.id===cur.id);
        if(i<0) return boxes[0]||null;
        const j=i+delta;
        if(j<0||j>=boxes.length) return null;
        return boxes[j];
    }
    // 편집 종료 + 상자를 '선택' 상태로 유지 (Enter/Tab/Escape 커밋용)
    function exitEditKeepSel(w){
        commitEditingText(w);
        w.classList.remove('edit'); _editScanDirty=true;
        const c=w.querySelector('.tb-content');
        if(c){ c.contentEditable='false'; disableTextSelect(c); }
        w.classList.add('sel'); _ensureTbControls(w);
        selected={type:'text',el:w};
    }
    // 커밋 후 다른 셀로 선택 이동
    function moveCellFrom(w,mode){
        const pi=+w.dataset.pageIdx;
        const el=findEl(pi,w.dataset.id);
        if(!el) return;
        const cur={id:el.id,pi,el,node:w,x:el.x||0,y:el.y||0,w:el.w||0,h:el.h||0};
        let nb=null;
        if(mode==='down') nb=nearestBox(cur,'down');
        else if(mode==='next') nb=nextBoxInOrder(cur,1);
        else if(mode==='prev') nb=nextBoxInOrder(cur,-1);
        if(nb){ selectTextBoxById(nb.pi,nb.id); try{nb.node.scrollIntoView({block:'nearest'});}catch(e){} }
    }
    // 선택된 상자(들) 일괄 번역
    async function translateSelection(target){
        closeCtxMenu();
        const items=[];
        if(multiSel.length){
            multiSel.forEach(m=>{
                const el=findEl(m.pageIdx,m.id);
                if(!el||el.type!=='text') return;
                let src=el.tight? tightTextFromHtml(el.html): plainTextFromHtml(el.html);
                src=(src||'').replace(/\s+/g,' ').trim();
                if(src) items.push({el,src,pi:m.pageIdx,node:m.node});
            });
        }else{
            const cur=currentSelText();
            if(cur){
                const el=cur.el, node=cur.node;
                const c=node.querySelector('.tb-content');
                let src=el.tight? tightTextFromHtml(el.html): (c?c.innerText:'');
                src=(src||'').replace(/\s+/g,' ').trim();
                if(src) items.push({el,src,pi:cur.pi,node});
            }
        }
        if(!items.length){ toast('번역할 텍스트 상자를 선택해 주세요',1800); return; }
        await translateEls(items,target,'선택 상자');
    }

    // 화면 좌표 → 캐럿 위치 (표준/구형 API 모두 지원)
    function caretRangeAt(x,y,host){
        // 자식 요소(핸들/버튼)가 히트테스트를 가로채면 좌표가 엉키므로
        // 측정 동안만 host 를 최우선으로 만든다
        let saved=null;
        if(host){
            saved=host.style.pointerEvents;
            host.style.pointerEvents='auto';
        }
        let r=null;
        try{
            if(document.caretRangeFromPoint) r=document.caretRangeFromPoint(x,y);
            else if(document.caretPositionFromPoint){
                const p=document.caretPositionFromPoint(x,y);
                if(p){ r=document.createRange(); r.setStart(p.offsetNode,p.offset); r.collapse(true); }
            }
        }catch(e){}
        if(host&&saved!==null) host.style.pointerEvents=saved;
        if(!r) return null;
        // host 밖이면 가장 가까운 경계로 보정 (드래그가 상자 밖으로 나가도 선택 유지)
        if(host&&!host.contains(r.startContainer)) return clampRangeToHost(host,x,y);
        return r;
    }
    // 좌표가 상자 밖일 때 시작/끝으로 스냅
    function clampRangeToHost(host,x,y){
        const rc=host.getBoundingClientRect();
        const r=document.createRange();
        const before=(y<rc.top)||(y<=rc.bottom&&x<rc.left);
        try{
            if(before){ r.setStart(host,0); }
            else{ r.selectNodeContents(host); r.collapse(false); }
            r.collapse(before);
        }catch(e){ return null; }
        return r;
    }
    function expandToWord(range,host){
        const node=range.startContainer;
        if(node.nodeType!==3){ const r=range.cloneRange(); r.selectNodeContents(host); return r; }
        const txt=node.textContent||'';
        let a=range.startOffset, b=range.startOffset;
        const isW=ch=>ch&&!/[\s\u00a0]/.test(ch);
        while(a>0&&isW(txt[a-1])) a--;
        while(b<txt.length&&isW(txt[b])) b++;
        const r=document.createRange();
        r.setStart(node,a); r.setEnd(node,b);
        return r;
    }
    let textSel=null;
    let savedRange=null, savedHost=null;   // 선택 영역 기억 (툴바 클릭 시 복원용)
    let savedCaret=null;                   // 편집 중 캐럿 기억 (글자 서식: 앞으로 입력될 글자용)
    let _typingSpan=null;                  // 캐럿 서식용 span (계속 입력되는 글자가 들어감)
    // 빈 inline span에만 의존하면 Safari/일부 WebView가 입력 직전에 span을 정리하거나
    // 캐럿을 span 밖으로 밀어 다음 글자가 기본 서식으로 들어간다. 활성 입력 서식을
    // DOM과 별도 상태로도 보관하고 beforeinput/keydown 때 캐럿 wrapper를 복구한다.
    let _pendingTyping=null;               // {host, styles} — 현재 편집 세션의 이후 입력 서식

    // 테두리 8px 는 '이동 손잡이', 안쪽은 '글자 선택' 영역으로 구분
    function innerTextArea(c,x,y){
        const r=c.getBoundingClientRect();
        const m=8;
        return x>r.left+m && x<r.right-m && y>r.top+m && y<r.bottom-m;
    }
    // 파란 하이라이트 + 저장된 선택 범위를 모두 비운다
    // 22.1 · '글자 선택을 임시로 허용한' 상자 목록 — clearTextSelection 을 O(1) 로
    //   만들 때 쓴다. (함수보다 먼저 선언해야 초기 로드 경로에서도 안전하다)
    const _selOnHosts=new Set();
    function clearTextSelection(){
        try{
            const sel=window.getSelection();
            if(sel&&sel.rangeCount) sel.removeAllRanges();
        }catch(e){}
        savedRange=null; savedHost=null; textSel=null; savedCaret=null; _typingSpan=null; _pendingTyping=null;
        // 22.1 · 예전엔 '화면의 모든 글상자'를 훑어 userSelect 를 지웠다. 글상자
        //   수백 개인 쪽에서 상자를 하나 누를 때마다 수백 개 요소에 inline 스타일을
        //   다시 쓰는 셈이라, 편집 진입 직전 프레임이 통째로 밀렸다(측정 결과: 
        //   enterEdit 안에서만 이 루프가 14ms). 실제로 선택 허락을 받은 상자는
        //   아래 Set 이 알고 있으므로 그 것만 되돌린다.
        _selOnHosts.forEach(c=>{
            if(!c||!c.isConnected){ _selOnHosts.delete(c); return; }
            const box=c.closest?c.closest('.tb'):null;
            if(box&&box.classList.contains('edit')) return;   // 편집 상자는 선택 허용 유지
            disableTextSelect(c);
        });
    }

    // 편집 모드가 아니어도 드래그로 글자를 고를 수 있게 임시 허용
    function enableTextSelect(c){
        if(!c) return;
        _selOnHosts.add(c);
        c.style.userSelect='text';
        c.style.webkitUserSelect='text';
        c.style.cursor='text';
    }
    function disableTextSelect(c){
        if(!c) return;
        _selOnHosts.delete(c);
        if(!c.style) return;
        c.style.userSelect='';
        c.style.webkitUserSelect='';
        c.style.cursor='';
    }

    // 마지막 마우스 위치 (붙여넣기 기준점)
    let lastMouse={clientX:0,clientY:0,pageIdx:0,x:null,y:null};
    // ★ pointermove 로 통합 — 터치 장치에서 커서 위치 추적 즉시 반응
    function trackLastPointer(e){
        lastMouse.clientX=e.clientX; lastMouse.clientY=e.clientY;
        const paper=e.target.closest&&e.target.closest('#pagesStage .paper');
        if(paper){
            const i=+paper.dataset.pageIdx;
            const p=pageLocal(e,i);
            lastMouse.pageIdx=i;
            lastMouse.x=p.x;
            lastMouse.y=p.y;
        }
    }
    sdyAddPointerCompat(document,'pointermove',trackLastPointer,true);

    // 붙여넣기 지점: 마우스가 종이 위면 그 위치, 아니면 현재 페이지 중앙 상단
    function pastePoint(w,h){
        const s=paperSize();
        let pi=curPageIdx, x=null, y=null;
        if(lastMouse.x!=null && lastMouse.y!=null &&
           lastMouse.x>=0 && lastMouse.x<=s.w && lastMouse.y>=0 && lastMouse.y<=s.h){
            pi=lastMouse.pageIdx; x=lastMouse.x-w/2; y=lastMouse.y-h/2;
        }else{
            x=(s.w-w)/2; y=Math.min(s.h-h, 80);
        }
        const c=clampEl(x,y,w,h);
        return {pageIdx:pi, x:Math.round(c.x), y:Math.round(c.y)};
    }

    function pageLocal(e,pageIdx){
        const paper=paperAt(pageIdx)||ensurePageShell(pageIdx);
        if(!paper) return {x:0,y:0};
        const r=paper.getBoundingClientRect();
        const s=paperSize();
        // 실제 화면 사각형을 기준으로 환산한다. 임시 핀치 확대나 브라우저 배율이
        // pageScale과 잠깐 달라도, 텍스트 상자 위를 누른 정확한 지점을 얻는다.
        // ★ clientX 와 r.left 는 둘 다 viewport px 이므로 뺄셈이 정확하다.
        //   결과는 문서 px (종이 좌표) — /uiCssZoom() 불필요.
        //   종이 안의 실제 요소(el.x)는 이 문서 px 를 그대로 쓰고,
        //   종이의 CSS 변환(scale)이 화면 배율을 처리한다.
        const sx=r.width? s.w/r.width : 1/Math.max(.001,pageScale);
        const sy=r.height? s.h/r.height : 1/Math.max(.001,pageScale);
        return {x:(e.clientX-r.left)*sx, y:(e.clientY-r.top)*sy};
    }
    // 브라우저/CSS 배율과 페이지 자체 배율을 모두 포함한 화면→문서 델타.
    // pageScale로만 나누면 사이트 기본 90%에서 포인터와 요소가 점점 어긋난다.
    // ★ dx,dy 는 clientX 차이 = viewport px. r.width 도 viewport px.
    //   dx * s.w / r.width = viewport px → 문서 px 변환. /uiCssZoom() 불필요.
    function pageClientDelta(pageIdx,dx,dy){
        const paper=paperAt(pageIdx), r=paper&&paper.getBoundingClientRect();
        const s=paperSize();
        return {x:r&&r.width?dx*s.w/r.width:dx/Math.max(.001,pageScale),
                y:r&&r.height?dy*s.h/r.height:dy/Math.max(.001,pageScale)};
    }
    function pageScreenScale(pageIdx){
        const paper=paperAt(pageIdx), r=paper&&paper.getBoundingClientRect();
        const s=paperSize();
        return {x:r&&s.w?r.width/s.w:pageScale,y:r&&s.h?r.height/s.h:pageScale};
    }
    // ── 화면 px ↔ 화면 UI 가 쓰는 CSS px ──────────────────────────────
    // 데스크톱은 html{zoom:.9} 로 그려진다. 이 배율 때문에 같은 'px' 가 두 가지다.
    //   · clientX·getBoundingClientRect → 배율이 적용된 화면 px (viewport px)
    //   · style.left·offsetWidth          → 배율 전 CSS px  (Element.currentCSSZoom)
    //   · innerWidth·clientWidth          → 엔진·배율에 따라 둘 중 어느 쪽도 될 수
    //     있다. 그래서 이 값으로 화면 범위를 '추정'하면 어떤 환경에서든 한쪽으로
    //     어긋난다. 창 경계는 파일 맨 앞의 공용 실측(sdyViewportBox) 을 쓰고,
    //     아래 uiCss 는 '화면 px → UI CSS px' 환산에만 쓴다.
    // 그래서 화면 px 를 그대로 style.left 에 넣으면 고스트·도구막대가 커서에서
    // (1-배율)×거리 만큼 어긋나고, 눌러서 만든 상자·표는 커서 자리에 생긴다.
    // '미리보기는 여기, 결과는 저기' 가 되는 직접 원인이다. 배율은 고정 상수로
    // 두지 않고 100px 프로브로 그때그때 직접 잰다 (기본 90%·브라우저 배율·
    // currentCSSZoom 미지원 브라우저까지 같은 코드로 맞는다).
    //
    // ★ 좌표계 3종 — 이 구분을 어긋나게 섞으면 커서와 결과가 어긋난다 ★
    //   1. viewport px (화면 px)
    //      clientX, clientY, getBoundingClientRect() 가 반환하는 값.
    //      html{zoom} 이 적용된 '눈에 보이는' 픽셀.
    //   2. CSS px (UI px)
    //      position:fixed 의 style.left/top, offsetWidth 등이 쓰는 값.
    //      html{zoom} 이 적용되기 전의 레이아웃 픽셀.
    //      변환: CSS px = viewport px / uiCssZoom()
    //   3. 문서 px (종이 좌표)
    //      종이의 width/height 단위. el.x, el.y 가 이 단위.
    //      pageLocal() 이 viewport px → 문서 px 로 변환한다.
    //
    // ★ 고스트(텍스트·표·그림·수식 미리보기)는 position:fixed 이므로
    //   style.left 에 CSS px 를 넣어야 한다. 따라서 viewport px 인
    //   getBoundingClientRect().left 에 / uiCssZoom() 를 반드시 해야 한다.
    //   이 나눗셈을 빼면 html{zoom:.9} 에서 고스트가 커서보다
    //   (1/0.9 − 1) ≈ 11% 오른쪽(아래)으로 어긋난다.
    //
    // ★ 종이 안의 실제 요소(el.x, el.y)는 종이 좌표(문서 px)를 쓰므로
    //   / uiCssZoom() 가 필요 없다. 종이 자체의 CSS 변환(scale)이
    //   화면 배율을 이미 처리한다. pageLocal → clampEl → addTextBox 경로는
    //   이 변환을 거치지 않는다 — 이것도 정확한 이유다.
    let _uiZoomProbe=null;
    function uiCssZoom(){
        if(!_uiZoomProbe||!_uiZoomProbe.isConnected){
            _uiZoomProbe=document.getElementById('uiZoomProbe');
            if(!_uiZoomProbe){
                _uiZoomProbe=document.createElement('div');
                _uiZoomProbe.id='uiZoomProbe';
                _uiZoomProbe.setAttribute('aria-hidden','true');
                _uiZoomProbe.style.cssText='position:fixed;left:0;top:0;width:100px;height:0;'+
                                           'overflow:hidden;visibility:hidden;pointer-events:none;';
                (document.body||document.documentElement).appendChild(_uiZoomProbe);
            }
        }
        const w=_uiZoomProbe.getBoundingClientRect().width;   // 100 CSS px = 몇 화면 px
        const k=w?w/100:1;
        return (k>0.05&&k<20)?k:1;
    }
    // 화면 px → 화면 UI CSS px (position:fixed 요소의 style.left/top 에 넣을 값)
    function uiCss(v){ return v/uiCssZoom(); }
    // 문서 px → 화면 UI CSS px (종이 배율과 사이트 배율을 함께 반영)
    // ★ 고스트가 position:fixed 의 style.left 에 쓸 때 사용한다.
    //   sc.x = (r.width/s.w)/k = 문서 px 당 CSS px.
    //   o.x * sc.x = 문서 px → CSS px 변환.
    function uiPageScale(pageIdx){
        const sc=pageScreenScale(pageIdx),k=uiCssZoom();
        return {x:sc.x/k,y:sc.y/k};
    }

    // 모바일 터치에서 상자 이동/크기조절이 깜박이던 핵심 원인: pointermove마다
    // left/top/width/height를 직접 바꿔 레이아웃을 강제로 다시 계산했다.
    // 드래그 중에는 GPU transform으로만 미리보기하고(pointermove는 rAF로 1프레임 1회),
    // 손을 떼는 순간 canonical 위치/크기를 한 번만 커밋한다.
    let _editorMoveRaf=0, _editorMovePending=null;
    function _eventLite(e,kind){
        return {kind,clientX:e.clientX,clientY:e.clientY,altKey:!!e.altKey,shiftKey:!!e.shiftKey};
    }
    function _queueEditorMove(kind,e){
        _editorMovePending=_eventLite(e,kind);
        if(_editorMoveRaf) return;
        _editorMoveRaf=requestAnimationFrame(()=>{
            _editorMoveRaf=0;
            const ev=_editorMovePending; _editorMovePending=null;
            _applyEditorMove(ev);
        });
    }
    function _flushEditorMove(){
        if(_editorMoveRaf){ cancelAnimationFrame(_editorMoveRaf); _editorMoveRaf=0; }
        const ev=_editorMovePending; _editorMovePending=null;
        _applyEditorMove(ev);
    }
    function _previewBegin(node,cls){
        if(!node||node._sdyPreview) return;
        node._sdyPreview={
            cls,
            transform:node.style.transform||'',
            transformOrigin:node.style.transformOrigin||'',
            willChange:node.style.willChange||'',
            touchAction:node.style.touchAction||''
        };
        node.classList.add(cls);
        node.style.transformOrigin='0 0';
        node.style.willChange='transform';
        node.style.touchAction='none';
        try{ document.body.classList.add('sdy-editor-gesturing'); }catch(e){}
    }
    function _previewSet(node,tx,ty,sx=1,sy=1){
        if(!node) return;
        const x=Math.round((tx||0)*100)/100, y=Math.round((ty||0)*100)/100;
        const sc=(Math.abs(sx-1)>0.0005||Math.abs(sy-1)>0.0005)
            ? ` scale(${(sx||1).toFixed(4)},${(sy||1).toFixed(4)})` : '';
        node.style.transform=`translate3d(${x}px,${y}px,0)`+sc;
    }
    function _previewEnd(node){
        if(!node||!node._sdyPreview) return;
        const p=node._sdyPreview; delete node._sdyPreview;
        node.classList.remove(p.cls);
        node.style.transform=p.transform;
        node.style.transformOrigin=p.transformOrigin;
        node.style.willChange=p.willChange;
        node.style.touchAction=p.touchAction;
    }
    function _clearGestureClass(){
        if(drag||resize||multiDrag) return;
        try{ document.body.classList.remove('sdy-editor-gesturing'); }catch(e){}
    }
    function _beginDragPreview(st){
        if(!st) return st;
        st.w=st.w||st.el.offsetWidth||30; st.h=st.h||st.el.offsetHeight||24;
        st.nx=st.ox; st.ny=st.oy;
        if(!st.isStroke) _previewBegin(st.el,'sdy-dragging');
        else { try{ document.body.classList.add('sdy-editor-gesturing'); }catch(e){} }
        return st;
    }
    function _beginResizePreview(st){
        if(!st) return st;
        st.nx=st.ox; st.ny=st.oy; st.nw=st.sw; st.nh=st.sh;
        _previewBegin(st.el,'sdy-resizing');
        return st;
    }
    function _finishDragPreview(st,commit){
        if(!st) return;
        if(!st.isStroke){
            if(commit){
                st.el.style.left=Math.round(st.nx!=null?st.nx:st.ox)+'px';
                st.el.style.top =Math.round(st.ny!=null?st.ny:st.oy)+'px';
            }
            _previewEnd(st.el);
        }
        // 14.18.2 · 이동 확정 → 형광펜 띠를 새 위치에 다시 그린다
        if(commit){ try{ _hlRepaintAll(); }catch(_e){} }
    }
    function _finishResizePreview(st,commit){
        if(!st) return;
        if(commit){
            st.el.style.left=Math.round(st.nx!=null?st.nx:st.ox)+'px';
            st.el.style.top =Math.round(st.ny!=null?st.ny:st.oy)+'px';
            st.el.style.width =Math.round(Math.max(30,st.nw!=null?st.nw:st.sw))+'px';
            st.el.style.height=Math.round(Math.max(24,st.nh!=null?st.nh:st.sh))+'px';
        }
        _previewEnd(st.el);
        // 14.18.2 · 리사이즈 확정 → 형광펜 띠를 새 크기/위치에 다시 그린다
        if(commit){ try{ _hlRepaintAll(); }catch(_e){} }
    }
    function _beginMultiPreview(st){
        if(!st) return;
        st.items.forEach(it=>{
            if(!it||!it.el||it.el.type==='stroke') return;
            it.w=it.el.w||it.node.offsetWidth||30; it.h=it.el.h||it.node.offsetHeight||24;
            it.nx=it.ox; it.ny=it.oy;
            _previewBegin(it.node,'sdy-dragging');
        });
    }
    function _finishMultiPreview(st,commit){
        if(!st) return;
        st.items.forEach(it=>{
            if(!it||!it.el||it.el.type==='stroke') return;
            if(commit){
                const nx=Math.round(it.nx!=null?it.nx:it.ox), ny=Math.round(it.ny!=null?it.ny:it.oy);
                it.el.x=nx; it.el.y=ny;
                it.node.style.left=nx+'px'; it.node.style.top=ny+'px';
            }
            _previewEnd(it.node);
        });
        // 14.18.2 · 다중 이동 확정 → 형광펜 띠 재배치
        if(commit){ try{ _hlRepaintAll(); }catch(_e){} }
    }
    function _applyEditorMove(ev){
        if(!ev) return;
        if(ev.kind==='multi'&&multiDrag) return _applyMultiDragMove(ev);
        if(ev.kind==='drag'&&drag) return _applyDragMove(ev);
        if(ev.kind==='resize'&&resize) return _applyResizeMove(ev);
    }
    function _applyMultiDragMove(e){
        const dd=pageClientDelta(multiDrag.pageIdx,e.clientX-multiDrag.sx,e.clientY-multiDrag.sy);
        const dx=dd.x,dy=dd.y;
        if(!multiDrag.moved){
            if(Math.abs(e.clientX-multiDrag.sx)<3&&Math.abs(e.clientY-multiDrag.sy)<3) return;
            multiDrag.moved=true; pushHistory();
        }
        let sdx=dx, sdy=dy;
        if(!e.altKey && multiDrag.bb){
            const bb=multiDrag.bb;
            const ids=multiDrag.items.map(it=>it.el&&it.el.id).filter(Boolean);
            const sn=applySnap(multiDrag.pageIdx, bb.x+dx, bb.y+dy, bb.w, bb.h, ids);
            sdx=sn.x-bb.x; sdy=sn.y-bb.y;
        }else clearSnapLines();
        multiDrag.items.forEach(it=>{
            if(it.el.type==='stroke'){
                it.el.dx=it.ox+sdx; it.el.dy=it.oy+sdy;
                it.node.setAttribute('transform',`translate(${it.el.dx},${it.el.dy})`);
            }else{
                const c=clampEl(it.ox+sdx,it.oy+sdy,it.w||it.el.w,it.h||it.el.h);
                it.nx=Math.round(c.x); it.ny=Math.round(c.y);
                _previewSet(it.node,it.nx-it.ox,it.ny-it.oy);
            }
        });
    }
    function _applyDragMove(e){
        const dd=pageClientDelta(drag.pageIdx,e.clientX-drag.sx,e.clientY-drag.sy);
        const dx=dd.x,dy=dd.y;
        if(drag.pending){
            if(Math.abs(e.clientX-drag.sx)<3&&Math.abs(e.clientY-drag.sy)<3) return;
            drag.pending=false; pushHistory();
        }
        drag.moved=true;
        if(drag.isStroke){
            const el=findEl(drag.pageIdx,drag.el.dataset.id); if(!el) return;
            const bb=strokeBBox(el);
            let nx=drag.ox+dx, ny=drag.oy+dy;
            if(!e.altKey){
                const sn=applySnap(drag.pageIdx, bb.x+nx, bb.y+ny, bb.w, bb.h, [el.id]);
                nx=sn.x-bb.x; ny=sn.y-bb.y;
            }else clearSnapLines();
            el.dx=nx; el.dy=ny; drag.nx=nx; drag.ny=ny;
            drag.el.setAttribute('transform',`translate(${el.dx},${el.dy})`);
            return;
        }
        const w=drag.w||drag.el.offsetWidth, h=drag.h||drag.el.offsetHeight;
        let c=clampEl(drag.ox+dx,drag.oy+dy,w,h);
        if(!e.altKey){
            const sn=applySnap(drag.pageIdx,c.x,c.y,w,h,[drag.el.dataset.id]);
            c=clampEl(sn.x,sn.y,w,h);
        }else clearSnapLines();
        drag.nx=Math.round(c.x); drag.ny=Math.round(c.y);
        _previewSet(drag.el,drag.nx-drag.ox,drag.ny-drag.oy);
    }
    function _applyResizeMove(e){
        const dd=pageClientDelta(resize.pageIdx,e.clientX-resize.sx,e.clientY-resize.sy);
        const dx=dd.x,dy=dd.y;
        let nw=resize.sw, nh=resize.sh;
        let nx=resize.ox, ny=resize.oy;
        const dir=resize.dir;
        const west =(dir==='h-w'||dir==='h-nw'||dir==='h-sw');
        const east =(dir==='h-e'||dir==='h-ne'||dir==='h-se');
        const north=(dir==='h-n'||dir==='h-nw'||dir==='h-ne');
        const south=(dir==='h-s'||dir==='h-sw'||dir==='h-se');
        if(east) nw=resize.sw+dx;
        if(west){ nw=resize.sw-dx; nx=resize.ox+dx; }
        if(south) nh=resize.sh+dy;
        if(north){ nh=resize.sh-dy; ny=resize.oy+dy; }
        if(nw<30){ if(west) nx=resize.ox+(resize.sw-30); nw=30; }
        if(nh<24){ if(north) ny=resize.oy+(resize.sh-24); nh=24; }
        if(resize.keepRatio && !e.shiftKey){
            const ar=resize.sw/resize.sh;
            if(Math.abs(nw-resize.sw) >= Math.abs(nh-resize.sh)) nh=nw/ar;
            else nw=nh*ar;
            if(nw<30){ nw=30; nh=nw/ar; }
            if(nh<24){ nh=24; nw=nh*ar; }
            nx = west  ? resize.ox+(resize.sw-nw) : resize.ox;
            ny = north ? resize.oy+(resize.sh-nh) : resize.oy;
        }
        nw=Math.max(30,nw); nh=Math.max(24,nh);
        if(!e.altKey&&snapEnabled){
            const el0=findEl(resize.pageIdx,resize.el.dataset.id);
            const bx=el0?el0.x:resize.ox;
            const by=el0?el0.y:resize.oy;
            const {V,H}=snapTargets(resize.pageIdx,[resize.el.dataset.id]);
            const lines=[];
            let best=null;
            V.forEach(t=>{ const d=Math.abs(bx+nw-t.v);
                if(d<=SNAP_TOL&&(!best||d<best.d)) best={d,v:t.v,center:!!t.center}; });
            if(best&&east){ nw=best.v-bx; lines.push({dir:'v',pos:best.v,center:best.center}); }
            let bh=null;
            H.forEach(t=>{ const d=Math.abs(by+nh-t.v);
                if(d<=SNAP_TOL&&(!bh||d<bh.d)) bh={d,v:t.v,center:!!t.center}; });
            if(bh&&south){ nh=bh.v-by; lines.push({dir:'h',pos:bh.v,center:bh.center}); }
            drawSnapLines(resize.pageIdx,lines);
        }else clearSnapLines();
        resize.nx=Math.round(nx); resize.ny=Math.round(ny);
        resize.nw=Math.round(Math.max(30,nw)); resize.nh=Math.round(Math.max(24,nh));
        // 18.7 · 텍스트 상자는 '모눈 스케일' 미리보기 대신 실제 폭/높이로 즉시
        //   리플로우한다. 스케일(scale)로는 내부 텍스트가 찌부됐다가 놓으면 돌아오는
        //   현상이 있어서(보고 이슈⑤) 텍스트는 리플로우 방식을 쓴다. 이미지/도형은
        //   계속 GPU scale 로 가볍게 그린다.
        if(resize.el.classList&&resize.el.classList.contains('tb')){
            resize.el.style.left=Math.round(resize.nx)+'px';
            resize.el.style.top =Math.round(resize.ny)+'px';
            resize.el.style.width=resize.nw+'px';
            resize.el.style.height=resize.nh+'px';
        }else{
            _previewSet(resize.el,resize.nx-resize.ox,resize.ny-resize.oy,resize.nw/resize.sw,resize.nh/resize.sh);
        }
    }

    // 종이 밖으로 나가는 것도 허용한다 (내보낼 때 잘린다).
    // 완전히 사라져 되찾지 못하는 것만 막는다.
    function clampEl(x,y,w,h){
        const s=paperSize();
        const M=Math.max(200,Math.max(w,h));      // 이만큼은 밖으로 나갈 수 있다
        return {x:Math.max(-M,Math.min(x,s.w+M-20)),
                y:Math.max(-M,Math.min(y,s.h+M-20))};
    }

    function onPaperDown(e,pageIdx){
        // 18.8 · 오른쪽 버튼(우클릭)은 선택을 절대 건드리지 않는다.
        //   예전에는 우클릭 pointerdown 이 캐럿을 눌린 자리로 옮겨서,
        //   좌클릭으로 끌어 고른 글자가 그 순간 풀려 버렸다. 그래서
        //   '선택한 글자' 우클릭 메뉴(복사/굵게/형광펜…)가 뜨지 않았다.
        //   선택은 그대로 두고 contextmenu(onEditorContext)가 이어받는다.
        if(e.button===2){ try{ saveSel(); }catch(_e){} return; }
        if(!tablePlace && (Date.now()<_pinPointerBlockUntil||Date.now()<_textPointerBlockUntil)){
            e.preventDefault(); e.stopPropagation(); return;
        }
        if(deferPagePointer(e,pageIdx)) return;
        if(penActive) return;   // 그리기 모드는 draw-surface가 처리
        curPageIdx=pageIdx; updatePageInfo();
        const t=e.target;
        // 표 배치 모드: 미리보기와 실제 표가 똑같은 문서 좌표를 사용한다.
        // ★ pageLocal 로 구한 문서 px 를 그대로 쓴다. /uiCssZoom() 불필요.
        if(tablePlace){
            e.preventDefault(); e.stopPropagation();
            const cfg=tablePlace, p=pageLocal(e,pageIdx);
            const c=clampTableOrigin(cfg,p.x-cfg.w/2,p.y-cfg.h/2);
            cancelTablePlacement();
            insertTable(cfg.rows,cfg.cols,pageIdx,Math.round(c.x),Math.round(c.y));
            return;
        }
        // 메모 붙이기 모드
        if(pinMode&&!t.closest('.pin')){
            e.preventDefault();
            const p=pageLocal(e,pageIdx);
            addPin(pageIdx,p.x,p.y);
            return;
        }
        // 10.4 · 잠긴 요소도 바로 선택해 움직일 수 있다
        //   (안내 토스트 제거 — 잠금은 삭제·내용편집 방지 용도로만 남는다)
        try{ tblTouch(e,pageIdx,t); }catch(err){}

        if(textToolActive){
            if(!t.closest('.paper-img')&&!t.closest('.tb')&&!t.closest('.stroke-g')){
                e.preventDefault();
                // ★ pageLocal → clampEl 로 문서 px 를 구한다. /uiCssZoom() 불필요.
                //   addTextBox 가 종이 안에 문서 px 로 놓고, 종이의 scale 이 화면 배율 처리.
                //   고스트(moveTextGhost)는 /k 로 CSS px 변환 — 둘 다 화면 위치는 같다.
                const dim=textBoxDefaultSize();
                const p=pageLocal(e,pageIdx);
                const c=clampEl(p.x-dim.w/2, p.y-dim.h/2, dim.w, dim.h);
                addTextBox(pageIdx,c.x,c.y,dim);
                setTextTool(false);
                return;
            }
            setTextTool(false);
        }

        // 칸 안을 직접 누르면 '표 선택'은 풀어 Delete 가 글자를 지우게 한다
        if(t.closest('.tb-content')) { /* 편집 진입은 아래 로직이 처리 */ }
        // 묶인(그룹) 요소를 누르면 묶음 전체를 선택
        const gHost=t.closest('.tb')||t.closest('.paper-img')||t.closest('.stroke-g');
        if(gHost && !t.closest('.handle') && !t.closest('.tb-edge')
           && !document.querySelector('.tb.edit')){
            const gEl=findEl(pageIdx,gHost.dataset.id);
            // 표의 group은 선·칸을 원자적으로 보관하기 위한 내부 묶음이다.
            // 일반 객체 그룹처럼 펼치면 셀 선택보다 다중 이동이 먼저 시작된다.
            if(gEl&&gEl.group&&!tblOf(gEl)&&!multiSel.some(m=>m.id===gHost.dataset.id)){
                e.preventDefault();
                if(expandGroupSelection(pageIdx,gHost.dataset.id)){ startMultiDrag(e); return; }
            }
        }
        // 다중 선택된 객체 위에서 드래그 → 함께 이동 (개별 선택보다 우선)
        if(multiSel.length && hitMultiSel(e) && !t.closest('.el-del') && !t.closest('.handle')){
            e.preventDefault();
            startMultiDrag(e);
            return;
        }
        // 삭제 버튼
        if(t.closest('.el-del')){
            e.preventDefault(); e.stopPropagation();
            const host=t.closest('.tb')||t.closest('.paper-img');
            pushHistory();
            const gone=(doc.pages[pageIdx].els||[]).filter(x=>x.id===host.dataset.id);
            doc.pages[pageIdx].els=doc.pages[pageIdx].els.filter(x=>x.id!==host.dataset.id);
            host.remove(); selected=null; markPageEdited(pageIdx); saveDoc();
            purgeElements(gone);
            return;
        }
        // 리사이즈
        if(t.closest('.handle')){
            e.preventDefault();
            const host=t.closest('.tb')||t.closest('.paper-img');
            if(host.classList.contains('edit')){
                commitEditingText(host);
                host.classList.remove('edit'); _editScanDirty=true;
                const cc=host.querySelector('.tb-content');
                if(cc) cc.contentEditable='false';
                host.classList.add('sel'); _ensureTbControls(host);
                selected={type:'text',el:host};
            }
            pushHistory();
            const hEl=t.closest('.handle');
            const mdl=findEl(pageIdx,host.dataset.id);
            const dir=(hEl&&hEl.dataset.dir)||'h-se';
            // 꼭짓점(대각선)은 비율 유지, 변 중앙은 가로/세로만 자유롭게
            const corner=(dir==='h-nw'||dir==='h-ne'||dir==='h-sw'||dir==='h-se');
            const isImg=host.classList.contains('paper-img');
            resize={el:host,pageIdx,sx:e.clientX,sy:e.clientY,sw:host.offsetWidth,sh:host.offsetHeight,
                    ox:parseFloat(host.style.left)||0, oy:parseFloat(host.style.top)||0,
                    isImg, dir,
                    // 이미지: 꼭짓점이면 비율 유지(잠금 해제 시엔 자유),
                    //         변 중앙이면 언제나 자유
                    keepRatio: isImg && corner && !(mdl&&mdl.freeRatio)};
            _beginResizePreview(resize);
            return;
        }
        // 테두리를 잡고 이동
        if(t.closest('.tb-edge')){
            e.preventDefault();
            const w=t.closest('.tb')||t.closest('.paper-img');
            // 편집 중이었다면 편집을 끝내고 '상자 선택' 상태로 바꾼다
            // (이래야 Delete 키가 글자가 아니라 상자를 지운다)
            if(w.classList.contains('edit')){
                commitEditingText(w);
                w.classList.remove('edit'); _editScanDirty=true;
                const cc=w.querySelector('.tb-content');
                if(cc) cc.contentEditable='false';
            }
            if(!w.classList.contains('sel')){ deselectAll(true); w.classList.add('sel'); }
            else { w.classList.add('sel'); }
            _ensureTbControls(w);
            selected={type:w.classList.contains('paper-img')?'image':'text',el:w};
            drag={el:w,pageIdx,sx:e.clientX,sy:e.clientY,
                  ox:parseFloat(w.style.left)||0,oy:parseFloat(w.style.top)||0,pending:true};
            _beginDragPreview(drag);
            return;
        }
        // 텍스트 이동 손잡이
        if(t.closest('.tb-move')){
            e.preventDefault();
            const w=t.closest('.tb');
            deselectAll(); w.classList.add('sel'); _ensureTbControls(w); selected={type:'text',el:w};
            syncFSFromTarget();
            drag={el:w,pageIdx,sx:e.clientX,sy:e.clientY,
                  ox:parseFloat(w.style.left)||0,oy:parseFloat(w.style.top)||0,pending:true};
            _beginDragPreview(drag);
            return;
        }
        // 표 칸은 한 번 눌러 셀 선택, 그대로 끌어 Word식 직사각형 범위 선택.
        // 더블클릭할 때만 글자 편집으로 들어가므로 셀을 가로질러 끌 수 있다.
        {
            const tbHit=t.closest('.tb');
            if(tbHit && e.button===0 && !e.altKey && !penActive && !textToolActive
               && !t.closest('.handle') && !t.closest('.tb-edge')){
                const hitEl=findEl(pageIdx,tbHit.dataset.id);
                if(hitEl && hitEl.tbl){
                    const cell=tblCellAt(pageIdx,e);
                    if(cell){
                        e.preventDefault();
                        const node=paperQ(pageIdx,`.tb[data-id="${cell.id}"]`);
                        if(node){
                            drag=null;
                            if(e.detail>=2){
                                clearTblCellSelection();
                                deselectAll(true); clearMulti();
                                const c=node.querySelector('.tb-content');
                                enterEdit(node,true); enableTextSelect(c);
                                const r=caretRangeAt(e.clientX,e.clientY,c);
                                if(r){
                                    const wr=expandToWord(r,c),sel=window.getSelection();
                                    sel.removeAllRanges(); sel.addRange(wr);
                                    textSel={host:c,anchor:{node:wr.startContainer,off:wr.startOffset},
                                        focusEnd:{node:wr.endContainer,off:wr.endOffset},mode:'word',
                                        wordStart:{node:wr.startContainer,off:wr.startOffset},
                                        wordEnd:{node:wr.endContainer,off:wr.endOffset},cellDrag:{pageIdx,tid:cell.tid}};
                                    saveSel();
                                }
                            }else{
                                startTblCellSelection(e,pageIdx,cell);
                            }
                            return;
                        }
                    }
                }
            }
        }
        // LaTeX 수식은 글자 선택 대신 요소 선택. 더블클릭/편집 버튼으로 원문을 고친다.
        const latexHost=t.closest('.latex-box');
        if(latexHost){
            e.preventDefault();
            deselectAll(true); clearMulti(); latexHost.classList.add('sel'); _ensureTbControls(latexHost);
            selected={type:'text',el:latexHost};
            // 10.4 · 수식은(잠긴 것도) 누른 채 바로 끌어 옮긴다.
            //   원래는 테두리/손잡이를 잡아야만 움직일 수 있었다.
            drag={el:latexHost,pageIdx,sx:e.clientX,sy:e.clientY,
                  ox:parseFloat(latexHost.style.left)||0,
                  oy:parseFloat(latexHost.style.top)||0,pending:true};
            _beginDragPreview(drag);
            return;
        }
        // 텍스트
        const tb=t.closest('.tb');
        if(tb){
            if(tb.classList.contains('edit')){
                drag=null;
                const c=tb.querySelector('.tb-content');
                const r=caretRangeAt(e.clientX,e.clientY,c);
                if(r){
                    const sel=window.getSelection();
                    sel.removeAllRanges(); sel.addRange(r);
                    textSel={host:c, anchor:{node:r.startContainer,off:r.startOffset}, focusEnd:null};
                    e.preventDefault();
                }
                return;
            }
            // 상자 안의 링크는 눌러도 이동하지 않는다 (글자 선택이 우선)
            //  → 링크로 가려면 Ctrl(⌘)+클릭
            if(t.closest('.tb-content a') && !(e.ctrlKey||e.metaKey)) e.preventDefault();

            // 스프레드시트식: 한 번 클릭 = 선택만 (편집은 더블클릭/F2/Enter)
            // Ctrl(⌘)+클릭 = 다중 선택 토글
            // t 가 <b>/<a>/<span> 같은 자식 태그여도 안쪽이면 동일하게 동작
            if(e.detail<2 && !tb.classList.contains('edit') && !e.altKey
               && t.closest('.tb-content')){
                e.preventDefault();
                if(e.ctrlKey||e.metaKey){
                    toggleMultiSelect(pageIdx,tb);
                }else if(tb.classList.contains('sel')
                         && matchMedia('(pointer:coarse)').matches){
                    // ★ 모바일: 이미 선택된 상자를 다시 누르면 편집 모드 진입.
                    //   더블탭은 브라우저 확대와 충돌해 인식이 불안정하다.
                    enterEdit(tb,true);
                }else{
                    deselectAll(true); clearMulti();
                    tb.classList.add('sel'); _ensureTbControls(tb);
                    selected={type:'text',el:tb};
                    syncFSFromTarget();          // 툴바 글자 크기를 이 상자 값으로
                }
                drag=null;
                return;
            }
            if(e.detail>=2){
                drag=null;
                enterEdit(tb,true);
                // 더블클릭 단어 선택 + 끌어서 확장을 직접 구현
                // (편집 모드 진입과 동시에 일어나는 기본 동작은 브라우저마다 불안정)
                const c=tb.querySelector('.tb-content');
                enableTextSelect(c);
                const r=caretRangeAt(e.clientX,e.clientY,c);
                if(r){
                    const wr=expandToWord(r,c);
                    const sel=window.getSelection();
                    sel.removeAllRanges(); sel.addRange(wr);
                    // mode:'word' → 드래그하면 띄어쓰기 단위로 확장 (브라우저 기본 동작과 동일)
                    textSel={host:c, anchor:{node:wr.startContainer,off:wr.startOffset},
                             focusEnd:{node:wr.endContainer,off:wr.endOffset}, mode:'word',
                             wordStart:{node:wr.startContainer,off:wr.startOffset},
                             wordEnd:{node:wr.endContainer,off:wr.endOffset}};
                    saveSel();
                }
                e.preventDefault();
                return;
            }
            // 여기까지 왔다면 Alt+드래그 또는 테두리 → 이동
            e.preventDefault();
            deselectAll(true); tb.classList.add('sel'); _ensureTbControls(tb);
            selected={type:'text',el:tb};
            syncFSFromTarget();
            drag={el:tb,pageIdx,sx:e.clientX,sy:e.clientY,ox:parseFloat(tb.style.left)||0,oy:parseFloat(tb.style.top)||0,pending:true};
            _beginDragPreview(drag);
            return;
        }
        // 이미지
        const im=t.closest('.paper-img');
        if(im){
            e.preventDefault();
            if(e.ctrlKey||e.metaKey){                 // Ctrl+클릭 = 다중 선택 토글
                toggleMultiSelect(pageIdx,im);
                drag=null;
                return;
            }
            if(!im.classList.contains('sel')){          // 1차 클릭 = 선택만
                deselectAll(); _ensureImgControls(im); im.classList.add('sel'); selected={type:'image',el:im};
                drag=null;
                return;
            }
            // ★ 14.28.1 · 모바일에서도 '이미 선택된 이미지 다시 탭'으로 전체화면 뷰어가
            //   뜨면 주변 글/획이 싹 사라진다. 뷰어 자동 진입은 막고, 두 번째 탭부터는
            //   데스크톱과 똑같이 바로 이동/크기 조절로 들어간다.
            selected={type:'image',el:im};              // 2차 탭/클릭부터 이동
            drag={el:im,pageIdx,sx:e.clientX,sy:e.clientY,ox:parseFloat(im.style.left)||0,oy:parseFloat(im.style.top)||0,pending:true};
            _beginDragPreview(drag);
            return;
        }
        // 펜 획 (얇은 hit 영역에 정확히 닿았을 때만)
        const sg=t.closest('.stroke-g');
        if(sg){
            const sgEl=findEl(pageIdx,sg.dataset.id);
            if(sgEl&&tblOf(sgEl)&&e.button===0&&!e.altKey){
                const cell=tblCellAt(pageIdx,e);
                if(cell){ e.preventDefault(); startTblCellSelection(e,pageIdx,cell); drag=null; return; }
            }
            e.preventDefault();
            if(e.ctrlKey||e.metaKey){                 // Ctrl+클릭 = 다중 선택 토글
                toggleMultiSelect(pageIdx,sg);
                drag=null;
                return;
            }
            if(!sg.classList.contains('sel')){
                deselectAll(); sg.classList.add('sel'); selected={type:'stroke',el:sg};
                drag=null;
                return;
            }
            selected={type:'stroke',el:sg};
            const el=findEl(pageIdx,sg.dataset.id);
            drag={el:sg,pageIdx,sx:e.clientX,sy:e.clientY,ox:el.dx||0,oy:el.dy||0,pending:true,isStroke:true};
            _beginDragPreview(drag);
            return;
        }
        // 표의 투명한 안쪽 여백에서 시작해도 가장 가까운 셀 범위를 고른다.
        if(e.button===0 && !penActive && !textToolActive){
            const cell=tblCellAt(pageIdx,e);
            if(cell){
                e.preventDefault(); startTblCellSelection(e,pageIdx,cell); drag=null; return;
            }
        }
        // 빈 종이에서 드래그 → 영역 선택
        deselectAll();
        clearMulti();
        if(e.button===0){
            e.preventDefault();
            startMarquee(e,pageIdx);
        }
    }

    // 표 영역 안의 좌표라면 그 자리에 해당하는 칸을 돌려준다.
    // 칸과 칸 사이 선·여백을 눌러도 가장 가까운 칸을 고른다.
    function tblCellAt(pageIdx,e){
        const tbls=pageTables(pageIdx);
        if(!tbls.length) return null;
        const p=pageLocal(e,pageIdx);
        // 표 테두리 바로 바깥에서 긁기 시작하는 경우가 많아 약간의 여유를 둔다
        const M=14;
        for(const t of tbls){
            const s=tblSize(t);
            if(p.x<t.x-M||p.x>t.x+s.w+M||p.y<t.y-M||p.y>t.y+s.h+M) continue;
            // 여유 범위에서 시작했으면 표 안쪽 좌표로 당겨서 칸을 고른다
            const px=Math.max(t.x+1,Math.min(p.x,t.x+s.w-1));
            const py=Math.max(t.y+1,Math.min(p.y,t.y+s.h-1));
            p.x=px; p.y=py;
            // 열 찾기 — 경계 근처면 오른쪽 칸으로 붙인다
            //  (칸 왼쪽 테두리 바깥에서 긁기 시작하는 경우가 가장 흔하다)
            const NEAR=10;
            let c=0,acc=t.x;
            for(let i=0;i<t.cw.length;i++){
                const left=acc, right=acc+t.cw[i];
                if(p.x<right-((i<t.cw.length-1)?0:-NEAR)){
                    // 오른쪽 경계에 아주 가까우면 다음 칸으로
                    c=(i<t.cw.length-1 && p.x>right-NEAR)? i+1 : i;
                    break;
                }
                acc=right; c=i;
            }
            c=Math.max(0,Math.min(t.cw.length-1,c));
            // 행 찾기 — 같은 방식
            let r=0; acc=t.y;
            for(let i=0;i<t.ch.length;i++){
                const top=acc, bot=acc+t.ch[i];
                if(p.y<bot-((i<t.ch.length-1)?0:-NEAR)){
                    r=(i<t.ch.length-1 && p.y>bot-NEAR)? i+1 : i;
                    break;
                }
                acc=bot; r=i;
            }
            r=Math.max(0,Math.min(t.ch.length-1,r));
            const cell=(doc.pages[pageIdx].els||[]).find(el=>
                el.type==='text'&&el.tbl&&el.tbl.tid===t.id&&el.tbl.r===r&&el.tbl.c===c);
            if(cell) return {id:cell.id,tid:t.id,r,c};
        }
        return null;
    }

    // ★ pointermove 로 통합 — 터치 장치에서 mousedown→mousemove 사이300ms 지연 제거
    sdyAddPointerCompat(document,'pointermove',e=>{
        const ghost=document.getElementById('textGhost');
        if(textToolActive&&ghost) moveTextGhost(e.clientX,e.clientY);
        if(tablePlace) moveTableGhost(e.clientX,e.clientY);
        if(placeMode) movePlaceGhost(e.clientX,e.clientY);

        if(tblCellPick){
            const cell=tblCellAt(tblCellPick.pageIdx,e);
            if(cell&&cell.tid===tblCellPick.tid&&tblCellSelection){
                tblCellSelection.r1=cell.r; tblCellSelection.c1=cell.c;
                setActiveTbl(tblCellPick.pageIdx,cell.tid,cell.r,cell.c);
                paintTblCellSelection();
            }
            e.preventDefault();
            return;
        }

        if(textSel){
            // 드래그로 선택 확장. mode==='word' 면 띄어쓰기(단어) 단위로 스냅.
            let mx=e.clientX, my=e.clientY;
            if(textSel.cellDrag){
                // 표 칸은 좁아서 조금만 움직여도 밖으로 나간다.
                // → 좌표를 칸 안쪽으로 붙여 계속 선택이 이어지게 한다.
                const hb=textSel.host.getBoundingClientRect();
                mx=Math.max(hb.left+1, Math.min(mx, hb.right-1));
                my=Math.max(hb.top+1,  Math.min(my, hb.bottom-1));
            }
            let r=caretRangeAt(mx,my,textSel.host);
            if(r){
                const sel=window.getSelection();
                const nr=document.createRange();
                const a=textSel.anchor;
                const after=(a.node.compareDocumentPosition(r.startContainer)&Node.DOCUMENT_POSITION_FOLLOWING)
                    || (a.node===r.startContainer && r.startOffset>=a.off);

                if(textSel.mode==='word'){
                    // 커서가 있는 단어 전체를 포함하도록 확장
                    const w=expandToWord(r,textSel.host);
                    const ws=textSel.wordStart, we=textSel.wordEnd;
                    try{
                        if(after){ nr.setStart(ws.node,ws.off); nr.setEnd(w.endContainer,w.endOffset); }
                        else     { nr.setStart(w.startContainer,w.startOffset); nr.setEnd(we.node,we.off); }
                    }catch(err){ nr.setStart(ws.node,ws.off); nr.setEnd(we.node,we.off); }
                }else{
                    if(after){
                        const e0=textSel.focusEnd&&textSel.focusEnd.node?textSel.focusEnd:a;
                        nr.setStart(a.node,a.off);
                        try{ nr.setEnd(r.startContainer,r.startOffset); }catch(err){ nr.setEnd(e0.node,e0.off); }
                    }else{
                        nr.setStart(r.startContainer,r.startOffset);
                        const e0=textSel.focusEnd&&textSel.focusEnd.node?textSel.focusEnd:a;
                        try{ nr.setEnd(e0.node,e0.off); }catch(err){ nr.setEnd(a.node,a.off); }
                    }
                }
                sel.removeAllRanges(); sel.addRange(nr);
                saveSel();
            }
            e.preventDefault();
            return;
        }
        if(marquee){ e.preventDefault(); updateMarquee(e); return; }
        if(multiDrag){ e.preventDefault(); _queueEditorMove('multi',e); return; }
        if(drag){ e.preventDefault(); _queueEditorMove('drag',e); return; }
        if(resize){ e.preventDefault(); _queueEditorMove('resize',e); return; }
    });


    // ★ pointerup 로 통합 — 터치 장치에서 즉시 반응
    function finishEditorPointer(){
        _flushEditorMove();
        clearSnapLines();
        if(tblCellPick) tblCellPick=null;
        if(marquee){ endMarquee(); }
        if(multiDrag){
            if(multiDrag.moved){
                markPageEdited(multiDrag.pageIdx);
                _finishMultiPreview(multiDrag,true);
                try{ syncAllTables(multiDrag.pageIdx); renderTblDivs(multiDrag.pageIdx); positionTblBar(); }catch(e){}
                saveDoc();
            }else{
                _finishMultiPreview(multiDrag,false);
            }
            multiDrag=null; _clearGestureClass();
        }
        if(textSel){
            saveSel();
            if(textSel.readonly){
                const host=textSel.host;
                // 선택 영역이 없으면 원래대로 (드래그 안 하고 클릭만 한 경우)
                const sel=window.getSelection();
                if(!sel||sel.isCollapsed) disableTextSelect(host);
            }
            textSel=null;
        }
        if(drag){
            if(drag.moved){
                markPageEdited(drag.pageIdx);
                if(!drag.isStroke){
                    _finishDragPreview(drag,true);
                    const el=findEl(drag.pageIdx,drag.el.dataset.id);
                    if(el){ el.x=drag.nx!=null?drag.nx:(parseFloat(drag.el.style.left)||0);
                            el.y=drag.ny!=null?drag.ny:(parseFloat(drag.el.style.top)||0); }
                }
                try{ syncAllTables(drag.pageIdx); renderTblDivs(drag.pageIdx); positionTblBar(); }catch(e){}
                saveDoc();
            }else{
                _finishDragPreview(drag,false);
            }
            drag=null; _clearGestureClass();
        }
        if(resize){
            _finishResizePreview(resize,true);
            const el=findEl(resize.pageIdx,resize.el.dataset.id);
            if(el){
                el.w=resize.nw!=null?resize.nw:resize.sw;
                el.h=resize.nh!=null?resize.nh:resize.sh;
                el.x=resize.nx!=null?resize.nx:resize.ox;
                el.y=resize.ny!=null?resize.ny:resize.oy;
            }
            const rpi=resize.pageIdx;
            if(resize.nw!==undefined||resize.nh!==undefined) markPageEdited(rpi);
            resize=null; _clearGestureClass(); saveDoc();
            try{ syncAllTables(rpi); renderTblDivs(rpi); positionTblBar(); }catch(e){}
        }
    }
    sdyAddPointerCompat(document,'pointerup',finishEditorPointer);
    document.addEventListener('pointercancel',e=>{ sdyMarkPointerEvent(); finishEditorPointer(e); });


    // 18.8 · 새 글상자를 만들 때: 글꼴·글자 크기는 쓰던 대로 이어가되,
    //   굵게/기울임/밑줄/취소선·글자색·형광펜 같은 '글자 꾸밈'은 모두 푼다.
    //   (툴바 표시와 앞으로 입력될 글자 서식을 함께 초기화한다)
    function resetTypingFormat(){
        try{
            _typingSpan=null; _pendingTyping=null; savedCaret=null; savedRange=null; savedHost=null; textSel=null;
            currentTextColor=TEXT_COLORS[0];
            const bar=document.getElementById('tcBar'), glyph=document.getElementById('tcGlyph');
            if(bar) bar.style.background=currentTextColor;
            if(glyph) glyph.style.color=currentTextColor;
            const hb=document.getElementById('hlBar');
            if(hb) hb.style.background='transparent';
            ['.tb-bold','.tb-italic','.tb-under','.tb-strike'].forEach(s=>{
                const b=document.querySelector(s); if(b) b.classList.remove('active');
            });
        }catch(e){}
    }

    function addTextBox(pageIdx,x,y,dim){
        // ★ x,y 는 pageLocal → clampEl 로 구한 문서 px (종이 좌표).
        //   /uiCssZoom() 하지 않는다 — 종이 안의 style.left 는 문서 px 를 쓰고,
        //   종이의 CSS 변환(scale)이 화면 배율을 처리한다.
        //   고스트(moveTextGhost)는 position:fixed 이므로 /k 로 CSS px 로 변환하지만,
        //  둘 다 최종 화면 위치는 같다. (자세한 원리는 moveTextGhost 주석 참조)
        pushHistory();
        const sz=dim||textBoxDefaultSize();
        // 글꼴·크기만 물려주고 나머지 서식은 푼다 (보고 이슈②)
        resetTypingFormat();
        const el={type:'text',id:uid('t'),x,y,w:sz.w,h:sz.h,html:'',fontSize:curFontSize,font:curFont};
        doc.pages[pageIdx].els.push(el);
        markPageEdited(pageIdx);
        const node=buildTextEl(el,pageIdx);
        // 가상화로 종이가 내려가 있으면 먼저 올린다 (창 밖 쪽에 글상자를 넣는 경로 방어)
        const _txtL=(ensurePageShell(pageIdx)||{querySelector:()=>null}).querySelector('.layer-text');
        if(!_txtL) return null;
        _txtL.appendChild(node);
        enterEdit(node,false);
        // 새 상자에서도 툴바가 '지금 입력될 글꼴·크기'를 그대로 보여 준다
        try{ syncToolbarFromCaret(); syncCurSel(); }catch(e){}
        saveDoc();
        return node;
    }
    // ===== 표 만들기 =====
    // 칸마다 텍스트 상자를 놓고 선을 둘러 표처럼 보이게 한다.
    // 각 칸을 바로 클릭해 글자를 넣을 수 있고, 통째로 옮기도록 묶어 둔다.
    // ==========================================================
    //  표 크기 조절 · 행/열 추가 (Task 28)
    //  표 정보는 페이지마다 page.tables 배열에 담는다.
    //   {id, x, y, cw:[열 너비...], ch:[행 높이...]}
    //  칸(텍스트)과 선(획)에는 el.tbl={tid, r, c} 표시가 붙는다.
    // ==========================================================
    const TBL_MINW=28, TBL_MINH=20;
    // 표를 끄는 동안 화면 갱신을 프레임당 1회로 묶는다 (드래그가 매끄러워짐)
    let _tblRaf=0, _tblRafPi=-1, _tblRafDoc=null, _tblRafVersion=0;
    function tblRepaint(pi){
        _tblRafPi=pi; _tblRafDoc=doc; _tblRafVersion=doc&&doc.__rv;
        if(_tblRaf) return;
        _tblRaf=requestAnimationFrame(()=>{
            _tblRaf=0;
            const i=_tblRafPi;
            const d=_tblRafDoc,v=_tblRafVersion; _tblRafDoc=null;
            if(i>=0&&doc===d&&doc&&doc.__rv===v&&doc.pages[i]) renderPageEls(i);
        });
    }
    // 중요어 분석 상태 (아래에서 쓰는 함수보다 먼저 선언 — TDZ 방지)
    let wfOn=false, wfStats=[], wfMap=null, wfPick=null, wfMin=2;
    let activeTbl=null;            // {pageIdx,tid,r,c}
    let tblCellSelection=null;     // {pageIdx,tid,r0,c0,r1,c1} 직사각형 셀 범위
    let tblCellPick=null;          // 포인터로 범위를 끄는 동안의 앵커
    let tblDrag=null, tblScale=null, tblMove=null;

    function pageTables(pi){
        const pg=doc&&doc.pages[pi]; if(!pg) return [];
        if(!Array.isArray(pg.tables)) pg.tables=[];
        return pg.tables;
    }
    function findTbl(pi,tid){ return pageTables(pi).find(t=>t.id===tid)||null; }
    function tblOf(el){ return (el&&el.tbl&&el.tbl.tid)?el.tbl.tid:null; }
    function tblCells(pi,tid){
        return (doc.pages[pi].els||[]).filter(e=>e.type==='text'&&tblOf(e)===tid);
    }
    function tblSize(t){ return {w:t.cw.reduce((a,b)=>a+b,0), h:t.ch.reduce((a,b)=>a+b,0)}; }
    function colX(t,i){ let x=t.x; for(let k=0;k<i;k++) x+=t.cw[k]; return x; }
    function rowY(t,i){ let y=t.y; for(let k=0;k<i;k++) y+=t.ch[k]; return y; }

    function selectedTblCellEls(){
        const s=tblCellSelection;
        if(!s||!doc||!doc.pages[s.pageIdx]) return [];
        const r0=Math.min(s.r0,s.r1),r1=Math.max(s.r0,s.r1);
        const c0=Math.min(s.c0,s.c1),c1=Math.max(s.c0,s.c1);
        return tblCells(s.pageIdx,s.tid).filter(el=>
            el.tbl.r>=r0&&el.tbl.r<=r1&&el.tbl.c>=c0&&el.tbl.c<=c1);
    }
    // 14.30.1 · 칠해 둔 표 칸을 기억한다. 예전에는 지울 때마다 `#pagesStage`
    //   전체에서 `.tbl-cell-sel` 을 찾느라 (칸을 하나도 안 골랐을 때조차)
    //   종이 subtree 를 통째로 훑었다 — 스크롤·렌더 경로에서 같이 불린다.
    let _tblCellPainted=[];
    function paintTblCellSelection(){
        if(_tblCellPainted.length){
            _tblCellPainted.forEach(n=>{
                try{
                    if(!n.isConnected) return;
                    n.classList.remove('tbl-cell-sel','tbl-cell-anchor');
                    n.removeAttribute('aria-selected');
                }catch(e){}
            });
            _tblCellPainted=[];
        }
        const s=tblCellSelection;
        if(!s) return;
        const paper=paperAt(s.pageIdx); if(!paper) return;
        selectedTblCellEls().forEach(el=>{
            const n=paper.querySelector(`.tb[data-id="${el.id}"]`); if(!n) return;
            n.classList.add('tbl-cell-sel'); n.setAttribute('aria-selected','true');
            if(el.tbl.r===s.r1&&el.tbl.c===s.c1) n.classList.add('tbl-cell-anchor');
            _tblCellPainted.push(n);
        });
    }
    function clearTblCellSelection(){
        tblCellSelection=null; tblCellPick=null; paintTblCellSelection();
    }
    function startTblCellSelection(e,pi,cell){
        const old=tblCellSelection;
        deselectAll(true); clearMulti(); clearTextSelection(); selected=null;
        const extend=!!(e.shiftKey&&old&&old.pageIdx===pi&&old.tid===cell.tid);
        tblCellSelection={pageIdx:pi,tid:cell.tid,
            r0:extend?old.r0:cell.r,c0:extend?old.c0:cell.c,r1:cell.r,c1:cell.c};
        tblCellPick={pageIdx:pi,tid:cell.tid,sx:e.clientX,sy:e.clientY};
        setActiveTbl(pi,cell.tid,cell.r,cell.c);
        paintTblCellSelection();
    }
    function tblCellApply(fn,msg){
        const cells=selectedTblCellEls();
        if(!cells.length){ toast('표에서 칸을 먼저 선택하세요',1400); return false; }
        pushHistory(); cells.forEach(fn);
        markPageEdited(tblCellSelection.pageIdx);
        renderPageEls(tblCellSelection.pageIdx); saveDoc();
        if(msg) toast(msg,1100);
        return true;
    }
    function tblCellAlign(dir){
        tblCellApply(el=>{ el.align=dir; },({left:'왼쪽',center:'가운데',right:'오른쪽'})[dir]+' 정렬');
    }
    function tblCellVAlign(dir){
        tblCellApply(el=>{ el.vAlign=dir; },({top:'위쪽',middle:'세로 가운데',bottom:'아래쪽'})[dir]+' 정렬');
    }
    function tblCellFill(color){
        tblCellApply(el=>{ if(color) el.cellBg=color; else delete el.cellBg; },color?'칸 배경색 적용':'칸 배경색 지움');
    }
    function clearTblCellContents(){
        tblCellApply(el=>{ el.html=''; },'선택한 칸 내용 지움');
    }
    function moveTblCellSelection(dr,dc,extend){
        const s=tblCellSelection,t=s&&findTbl(s.pageIdx,s.tid); if(!s||!t) return false;
        const nr=Math.max(0,Math.min(t.ch.length-1,s.r1+dr));
        const nc=Math.max(0,Math.min(t.cw.length-1,s.c1+dc));
        if(!extend){ s.r0=nr; s.c0=nc; }
        s.r1=nr; s.c1=nc;
        setActiveTbl(s.pageIdx,s.tid,nr,nc); paintTblCellSelection();
        return true;
    }
    function editTblSelectionCell(){
        const s=tblCellSelection,paper=s&&paperAt(s.pageIdx); if(!s||!paper) return false;
        const el=tblCells(s.pageIdx,s.tid).find(x=>x.tbl.r===s.r1&&x.tbl.c===s.c1);
        const node=el&&paper.querySelector(`.tb[data-id="${el.id}"]`); if(!node) return false;
        clearTblCellSelection(); enterEdit(node,false); return true;
    }

    // 표의 선과 칸 위치를 표 정보에 맞춰 다시 만든다
    function rebuildTable(pi,tid,opt){
        const t=findTbl(pi,tid); if(!t) return;
        const els=doc.pages[pi].els||[];
        const rows=t.ch.length, cols=t.cw.length;
        const size=tblSize(t);
        // ① 선은 통째로 다시 그린다
        doc.pages[pi].els=els.filter(e=>!(e.type==='stroke'&&tblOf(e)===tid));
        const list=doc.pages[pi].els;
        const gid=t.group||('g_'+tid);
        t.group=gid;
        const line=(x1,y1,x2,y2)=>list.push({type:'stroke',id:uid('s'),color:t.color||'#9aa1ab',
            size:t.lw||1.2,dx:0,dy:0,sharp:true,pts:[[x1,y1],[x2,y2]],group:gid,tbl:{tid}});
        for(let r=0;r<=rows;r++) line(t.x, rowY(t,r), t.x+size.w, rowY(t,r));
        for(let c=0;c<=cols;c++) line(colX(t,c), t.y, colX(t,c), t.y+size.h);
        // ② 칸은 위치·크기만 맞춘다 (글자는 그대로)
        const byRC={};
        list.forEach(e=>{ if(e.type==='text'&&tblOf(e)===tid) byRC[e.tbl.r+'_'+e.tbl.c]=e; });
        for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
            let cell=byRC[r+'_'+c];
            if(!cell){
                cell={type:'text',id:uid('t'),html:'',fontSize:Math.min(15,curFontSize||15),
                      font:curFont,group:gid,tbl:{tid,r,c}};
                list.push(cell);
            }
            cell.group=gid; cell.tbl={tid,r,c};
            cell.x=Math.round(colX(t,c)+3);
            cell.y=Math.round(rowY(t,r)+3);
            cell.w=Math.max(12,Math.round(t.cw[c]-6));
            cell.h=Math.max(12,Math.round(t.ch[r]-6));
        }
        if(!opt||!opt.quiet){ markPageEdited(pi); renderPageEls(pi); renderTblDivs(pi); saveDoc(); }
    }

    // ===== 표 테두리(선택 틀) · 꼭짓점 · 경계 잡이 · 변 중앙 늘리기 손잡이 =====
    // 조잡한 파란 막대 대신, 텍스트 상자와 같은 감각의 얇은 틀 + 손잡이로 그린다.
    function renderTblDivs(pi){
        const paper=paperAt(pi); if(!paper) return;
        const layer=paper.querySelector('.layer-tbl'); if(!layer) return;
        layer.innerHTML='';
        pageTables(pi).forEach(t=>{
            if(!t.cw||!t.ch||!t.cw.length||!t.ch.length) return;
            const size=tblSize(t);
            const on=!!(activeTbl&&activeTbl.pageIdx===pi&&activeTbl.tid===t.id);

            // ① 감지 영역 + 선택 틀 (마우스가 가까이 오면 손잡이가 나타난다)
            const box=document.createElement('div');
            box.className='tbl-box'+(on?' on':'');
            box.dataset.tid=t.id;
            box.style.cssText=`left:${t.x}px;top:${t.y}px;width:${size.w}px;height:${size.h}px;`;
            layer.appendChild(box);

            const frame=document.createElement('div');
            frame.className='tbl-frame';
            box.appendChild(frame);

            // 테두리(손잡이가 아닌 얇은 가장자리)를 잡으면 텍스트 상자처럼 표 전체 이동.
            // 보이는 이동 버튼은 두지 않는다.
            ['top','bottom','left','right'].forEach(side=>{
                const eg=document.createElement('div');
                eg.className='tbl-edge '+side;
                eg.title='표 테두리를 끌어서 이동';
                sdyAddPointerCompat(eg,'pointerdown',e=>startTblMove(e,pi,t.id));
                box.appendChild(eg);
            });

            // ② 열 경계 — 끌면 너비 조절
            for(let c=1;c<t.cw.length;c++){
                const d=document.createElement('div');
                d.className='tbl-div col';
                d.style.left='calc('+(colX(t,c)-t.x)+'px - var(--hs,12px)/2)';
                d.style.height=size.h+'px';
                d.title='끌어서 열 너비 조절';
                sdyAddPointerCompat(d,'pointerdown',e=>startTblDrag(e,pi,t.id,'col',c-1));
                box.appendChild(d);
            }
            // ③ 행 경계 — 끌면 높이 조절
            for(let r=1;r<t.ch.length;r++){
                const d=document.createElement('div');
                d.className='tbl-div row';
                d.style.top='calc('+(rowY(t,r)-t.y)+'px - var(--hs,12px)/2)';
                d.style.width=size.w+'px';
                d.title='끌어서 행 높이 조절';
                sdyAddPointerCompat(d,'pointerdown',e=>startTblDrag(e,pi,t.id,'row',r-1));
                box.appendChild(d);
            }
            // ④ 꼭짓점 4개 — 가로·세로를 자유롭게 확대/축소 (Shift 때만 비율 유지)
            [['nw',0,0],['ne',1,0],['sw',0,1],['se',1,1]].forEach(([dir,fx,fy])=>{
                const h=document.createElement('div');
                h.className='tbl-h '+dir;
                h.style.left =(fx?size.w:0)+'px';
                h.style.top  =(fy?size.h:0)+'px';
                h.title='끌어서 표 크기 조절 (Shift = 비율 유지)';
                sdyAddPointerCompat(h,'pointerdown',e=>startTblScale(e,pi,t.id,dir));
                box.appendChild(h);
            });
            // ⑤ 변 중앙 손잡이 — 한 축으로만 표 늘리기
            //    위·아래 = 세로, 왼·오른쪽 = 가로. 행/열 추가 버튼은 쓰지 않는다.
            const edge=(cls,left,top,dir)=>{
                const h=document.createElement('div');
                h.className='tbl-stretch '+cls;
                h.style.left=left+'px'; h.style.top=top+'px';
                h.title='끌어서 표 크기 조절 (한 축)';
                sdyAddPointerCompat(h,'pointerdown',e=>startTblStretch(e,pi,t.id,dir));
                box.appendChild(h);
            };
            edge('top',    size.w/2, 0,      'top');
            edge('bottom', size.w/2, size.h, 'bottom');
            edge('left',   0,        size.h/2,'left');
            edge('right',  size.w,   size.h/2,'right');
        });
        paintTblCellSelection();
    }
    // 화면에 요소를 그려 둔 쪽만 다시 그린다 (500쪽을 훑지 않는다)
    function renderAllTblDivs(){ if(doc) Array.from(renderedPages).forEach(i=>{ try{ renderTblDivs(i); }catch(e){} }); }

    // 표 가까이(22px 이내) 가면 손잡이 · ＋ 버튼이 나타난다
    const TBL_NEAR=22;
    function updateTblNear(e){
        if(!doc||tblDrag||tblScale||tblMove) return;
        const paper=e.target.closest&&e.target.closest('#pagesStage .paper');
        document.querySelectorAll('.tbl-box.near').forEach(n=>{
            if(!paper||n.closest('.paper')!==paper) n.classList.remove('near');
        });
        if(!paper) return;
        const pi=+paper.dataset.pageIdx;
        const p=pageLocal(e,pi),sc=pageScreenScale(pi);
        const x=p.x,y=p.y;
        const m=TBL_NEAR/Math.max(.2,Math.min(sc.x,sc.y));
        paper.querySelectorAll('.tbl-box').forEach(box=>{
            const t=findTbl(pi,box.dataset.tid); if(!t) return;
            const s=tblSize(t);
            const near = x>=t.x-m && x<=t.x+s.w+m && y>=t.y-m && y<=t.y+s.h+m;
            box.classList.toggle('near',near);
        });
    }
    // ★ pointermove 로 통합 — 터치 장치에서도 표 가까이 가면 손잡이가 나타남
    let _nearRaf=0;
    sdyAddPointerCompat(document,'pointermove',e=>{
        if(_nearRaf) return;
        const ev={target:e.target,clientX:e.clientX,clientY:e.clientY};
        _nearRaf=requestAnimationFrame(()=>{ _nearRaf=0; updateTblNear(ev); });
    },{passive:true});

    // ===== 열/행 경계 끌기 =====
    function startTblDrag(e,pi,tid,kind,idx){
        const t=findTbl(pi,tid); if(!t) return;
        // 손잡이는 칸 글자 위를 살짝 덮는다. 눌린 지점이 경계선에서
        // 얼마나 떨어졌는지로 '크기 조절'과 '글자 선택'을 가른다.
        const _paper=paperAt(pi); if(!_paper) return;
        const paperR=_paper.getBoundingClientRect(),sc=pageScreenScale(pi);
        const edge = (kind==='col')
            ? Math.abs(e.clientX-(paperR.left+colX(t,idx+1)*sc.x))
            : Math.abs(e.clientY-(paperR.top +rowY(t,idx+1)*sc.y));
        const GRAB=4;                       // 경계선 ±4px = 크기 조절
        if(edge>GRAB){
            // 경계에서 먼 곳 → 그 자리의 칸 글자를 선택한다
            const cell=tblCellAt(pi,e);
            if(cell){
                e.preventDefault(); e.stopPropagation();
                startTblCellSelection(e,pi,cell);
                drag=null;
                return;
            }
        }
        e.preventDefault(); e.stopPropagation();
        pushHistory();
        tblDrag={pi,tid,kind,idx,sx:e.clientX,sy:e.clientY,
                 base:(kind==='col'?t.cw[idx]:t.ch[idx]),
                 next:(kind==='col'?t.cw[idx+1]:t.ch[idx+1]),
                 shift:e.shiftKey, moved:false};
        setActiveTbl(pi,tid,kind==='row'?idx:0,kind==='col'?idx:0);
    }
    // ===== 꼭짓점으로 표 전체 확대/축소 =====
    function startTblScale(e,pi,tid,dir){
        e.preventDefault(); e.stopPropagation();
        const t=findTbl(pi,tid); if(!t) return;
        pushHistory();
        const size=tblSize(t);
        tblScale={pi,tid,dir,sx:e.clientX,sy:e.clientY,
                  ox:t.x,oy:t.y,ow:size.w,oh:size.h,
                  cw:t.cw.slice(),ch:t.ch.slice(),
                  fs:tblCells(pi,tid).map(c=>({id:c.id,fs:c.fontSize||15})),
                  moved:false};
        setActiveTbl(pi,tid,activeTbl&&activeTbl.tid===tid?activeTbl.r:0,
                             activeTbl&&activeTbl.tid===tid?activeTbl.c:0);
    }
    // ===== 변 중앙 손잡이 — 한 축으로만 표 늘리기 =====
    //   위·아래 = 세로(높이)만, 왼·오른쪽 = 가로(너비)만.
    //   행/열 추가는 표 도구 막대(tblBar)에서 하므로 손잡이는 늘리기 전용이다.
    function startTblStretch(e,pi,tid,dir){
        e.preventDefault(); e.stopPropagation();
        const t=findTbl(pi,tid); if(!t) return;
        pushHistory();
        const size=tblSize(t);
        tblScale={pi,tid,dir,sx:e.clientX,sy:e.clientY,
                  ox:t.x,oy:t.y,ow:size.w,oh:size.h,
                  cw:t.cw.slice(),ch:t.ch.slice(),
                  stretch:(dir==='top'||dir==='bottom')?'v':'h',
                  moved:false};
        setActiveTbl(pi,tid,activeTbl&&activeTbl.tid===tid?activeTbl.r:0,
                             activeTbl&&activeTbl.tid===tid?activeTbl.c:0);
    }
    // ===== 표 통째로 이동 =====
    function startTblMove(e,pi,tid){
        e.preventDefault(); e.stopPropagation();
        const t=findTbl(pi,tid),paper=paperAt(pi); if(!t||!paper) return;
        pushHistory();
        deselectAll(true); clearMulti(); clearTblCellSelection();
        // 이동 중에는 데이터/레이어를 매 프레임 재생성하지 않는다. 현재 칸·선·선택틀을
        // 같은 델타로 즉시 움직이고, mouseup에서 한 번만 canonical table로 재구성한다.
        const cells=tblCells(pi,tid).map(el=>paper.querySelector(`.tb[data-id="${el.id}"]`)).filter(Boolean);
        const strokes=(doc.pages[pi].els||[]).filter(el=>el.type==='stroke'&&tblOf(el)===tid)
            .map(el=>paper.querySelector(`.stroke-g[data-id="${el.id}"]`)).filter(Boolean);
        const box=paper.querySelector(`.tbl-box[data-tid="${tid}"]`);
        tblMove={pi,tid,sx:e.clientX,sy:e.clientY,ox:t.x,oy:t.y,moved:false,cells,strokes,box};
        setActiveTbl(pi,tid,0,0);
    }
    function previewTblMove(m,dx,dy){
        const tr=`translate(${dx}px,${dy}px)`;
        m.cells.forEach(n=>{ n.style.transform=tr; });
        m.strokes.forEach(n=>{ n.setAttribute('transform',`translate(${dx},${dy})`); });
        if(m.box) m.box.style.transform=tr;
    }

    // ★ pointermove 로 통합 — 터치 장치에서 표 핸들 즉시 반응
    // 표 리사이즈는 칸/선 DOM을 다시 계산해야 하므로 pointermove 원시 빈도 대신
    // requestAnimationFrame당 한 번만 반영한다. 손가락 이동은 놓치지 않되 화면 깜박임을 줄인다.
    let _tblMoveRaf=0, _tblMovePending=null;
    function _tblEventLite(e){ return {clientX:e.clientX,clientY:e.clientY,shiftKey:!!e.shiftKey,altKey:!!e.altKey}; }
    function _queueTblPointerMove(e){
        if(!(tblDrag||tblScale||tblMove)) return;
        e.preventDefault();
        const ev=_tblEventLite(e);
        if(tblMove&&!tblDrag&&!tblScale){ onTblPointerMoveFrame(ev); return; }
        _tblMovePending=ev;
        if(_tblMoveRaf) return;
        _tblMoveRaf=requestAnimationFrame(()=>{
            _tblMoveRaf=0;
            const ev=_tblMovePending; _tblMovePending=null;
            onTblPointerMoveFrame(ev);
        });
    }
    function _flushTblPointerMove(){
        if(_tblMoveRaf){ cancelAnimationFrame(_tblMoveRaf); _tblMoveRaf=0; }
        const ev=_tblMovePending; _tblMovePending=null;
        onTblPointerMoveFrame(ev);
    }
    sdyAddPointerCompat(document,'pointermove',_queueTblPointerMove);
    function onTblPointerMoveFrame(e){
        if(!e) return;
        // 경계 끌기
        if(tblDrag){
            const t=findTbl(tblDrag.pi,tblDrag.tid); if(!t) return;
            const dd=pageClientDelta(tblDrag.pi,e.clientX-tblDrag.sx,e.clientY-tblDrag.sy);
            const d=tblDrag.kind==='col'?dd.x:dd.y;
            if(Math.abs(d)>2) tblDrag.moved=true;
            const min=tblDrag.kind==='col'?TBL_MINW:TBL_MINH;
            const arr=tblDrag.kind==='col'?t.cw:t.ch;
            if(e.shiftKey&&tblDrag.next!=null){
                // Shift = 옆 칸에서 뺏어온다 (표 전체 폭 유지)
                const tot=tblDrag.base+tblDrag.next;
                const v=Math.max(min,Math.min(tot-min,Math.round(tblDrag.base+d)));
                arr[tblDrag.idx]=v; arr[tblDrag.idx+1]=tot-v;
            }else{
                arr[tblDrag.idx]=Math.max(min,Math.round(tblDrag.base+d));
            }
            rebuildTable(tblDrag.pi,tblDrag.tid,{quiet:true});
            tblRepaint(tblDrag.pi);
            return;
        }
        // 꼭짓점 확대/축소 · 변 중앙 한 축 늘리기
        if(tblScale){
            const t=findTbl(tblScale.pi,tblScale.tid); if(!t) return;
            const dd=pageClientDelta(tblScale.pi,e.clientX-tblScale.sx,e.clientY-tblScale.sy);
            const dx=dd.x,dy=dd.y;
            if(Math.abs(dx)>2||Math.abs(dy)>2) tblScale.moved=true;
            // 14.13.7 · 변 중앙 손잡이: 한 축으로만 늘린다
            //   위·아래 = 세로(높이)만 · 왼·오른쪽 = 가로(너비)만 (전체 비율 유지)
            if(tblScale.stretch){
                if(tblScale.stretch==='v'){
                    const grow=tblScale.dir==='bottom'?dy:-dy;
                    const nh=Math.max(TBL_MINH*tblScale.ch.length, tblScale.oh+grow);
                    const ky=nh/tblScale.oh;
                    t.ch=tblScale.ch.map(v=>Math.max(TBL_MINH,Math.round(v*ky)));
                    if(tblScale.dir==='top') t.y=Math.round(tblScale.oy+tblScale.oh-nh);
                }else{
                    const grow=tblScale.dir==='right'?dx:-dx;
                    const nw=Math.max(TBL_MINW*tblScale.cw.length, tblScale.ow+grow);
                    const kx=nw/tblScale.ow;
                    t.cw=tblScale.cw.map(v=>Math.max(TBL_MINW,Math.round(v*kx)));
                    if(tblScale.dir==='left') t.x=Math.round(tblScale.ox+tblScale.ow-nw);
                }
                rebuildTable(tblScale.pi,tblScale.tid,{quiet:true});
                tblRepaint(tblScale.pi);
                return;
            }
            const west=(tblScale.dir==='nw'||tblScale.dir==='sw'||tblScale.dir==='w');
            const north=(tblScale.dir==='nw'||tblScale.dir==='ne'||tblScale.dir==='n'||tblScale.dir==='w');
            // 꼭짓점은 끄는 대로 (가로·세로 따로) — 비율 고정 없음.
            // Shift 를 누르면 그때만 비율을 유지한다.
            let nw=Math.max(TBL_MINW*tblScale.cw.length, tblScale.ow+(west?-dx:dx));
            let nh=Math.max(TBL_MINH*tblScale.ch.length, tblScale.oh+(north?-dy:dy));
            if(e.shiftKey){
                const k=Math.max(nw/tblScale.ow, nh/tblScale.oh);
                nw=tblScale.ow*k; nh=tblScale.oh*k;
            }
            const kx=nw/tblScale.ow, ky=nh/tblScale.oh;
            t.cw=tblScale.cw.map(v=>Math.max(TBL_MINW,Math.round(v*kx)));
            t.ch=tblScale.ch.map(v=>Math.max(TBL_MINH,Math.round(v*ky)));
            const s=tblSize(t);
            // 변 중앙 손잡이(n/s/w/e)는 반대축을 중앙 기준으로 늘린다
            if(tblScale.dir==='n'||tblScale.dir==='s'){
                t.x=Math.round(tblScale.ox+(tblScale.ow-s.w)/2);
            }else{
                t.x=Math.round(west ? tblScale.ox+tblScale.ow-s.w : tblScale.ox);
            }
            if(tblScale.dir==='w'||tblScale.dir==='e'){
                t.y=Math.round(tblScale.oy+(tblScale.oh-s.h)/2);
            }else{
                t.y=Math.round(north? tblScale.oy+tblScale.oh-s.h : tblScale.oy);
            }
            // 글자 크기는 비율을 유지할 때(Shift)만 함께 조절한다
            if(e.shiftKey){
                const kf=Math.min(kx,ky);
                const map={}; tblScale.fs.forEach(f=>map[f.id]=f.fs);
                tblCells(tblScale.pi,tblScale.tid).forEach(c=>{
                    if(map[c.id]) c.fontSize=Math.max(2,Math.min(200,Math.round(map[c.id]*kf)));
                });
            }
            rebuildTable(tblScale.pi,tblScale.tid,{quiet:true});
            tblRepaint(tblScale.pi);
            return;
        }
        // 표 이동
        if(tblMove){
            const t=findTbl(tblMove.pi,tblMove.tid); if(!t) return;
            const dd=pageClientDelta(tblMove.pi,e.clientX-tblMove.sx,e.clientY-tblMove.sy);
            const dx=Math.round(dd.x),dy=Math.round(dd.y);
            if(Math.abs(dx)>2||Math.abs(dy)>2) tblMove.moved=true;
            tblMove.dx=dx; tblMove.dy=dy;
            previewTblMove(tblMove,dx,dy);
            return;
        }
    }
    // ★ pointerup 로 통합 — 터치 장치에서 표 핸들 놓기 즉시 반응
    document.addEventListener('pointerup',e=>{ sdyMarkPointerEvent(); onTblPointerUp(e); });
    document.addEventListener('pointercancel',e=>{ sdyMarkPointerEvent(); onTblPointerUp(e); });
    document.addEventListener('mouseup',e=>{ if(sdyIgnoreCompatMouse()) return; onTblPointerUp(e); });
    function onTblPointerUp(){
        _flushTblPointerMove();
        let pi=null;
        if(tblDrag){ pi=tblDrag.pi; if(tblDrag.moved){ markPageEdited(pi); saveDoc(); } tblDrag=null; }
        if(tblScale){ pi=tblScale.pi; if(tblScale.moved){ markPageEdited(pi); saveDoc(); } tblScale=null; }
        if(tblMove){
            pi=tblMove.pi;
            const t=findTbl(tblMove.pi,tblMove.tid);
            if(t&&tblMove.moved){ t.x=tblMove.ox+(tblMove.dx||0); t.y=tblMove.oy+(tblMove.dy||0); }
            else if(t){ t.x=tblMove.ox; t.y=tblMove.oy; }
            rebuildTable(tblMove.pi,tblMove.tid,{quiet:true});
            renderPageEls(tblMove.pi);
            if(tblMove.moved){ markPageEdited(pi); saveDoc(); }
            tblMove=null;
        }
        if(pi!=null){ renderTblDivs(pi); positionTblBar(); }
    }

    // ===== 표 도구 막대 =====
    function setActiveTbl(pi,tid,r,c){
        const changed=!activeTbl||activeTbl.tid!==tid||activeTbl.pageIdx!==pi;
        activeTbl={pageIdx:pi,tid,r:r||0,c:c||0};
        const bar=document.getElementById('tblBar');
        if(bar) bar.classList.add('show');
        // 표를 고르면 요소 선택은 풀어 Delete 가 표를 지우도록
        document.querySelectorAll('.tbl-box.on').forEach(n=>n.classList.remove('on'));
        const box=document.querySelector(`.layer-tbl .tbl-box[data-tid="${tid}"]`);
        if(box) box.classList.add('on');
        positionTblBar();
        return changed;
    }
    function clearActiveTbl(){
        activeTbl=null;
        clearTblCellSelection();
        const bar=document.getElementById('tblBar');
        if(bar) bar.classList.remove('show');
        document.querySelectorAll('.tbl-box.on').forEach(n=>n.classList.remove('on'));
    }
    function positionTblBar(){
        const bar=document.getElementById('tblBar');
        if(!bar||!activeTbl) return;
        const t=findTbl(activeTbl.pageIdx,activeTbl.tid);
        const paper=paperAt(activeTbl.pageIdx);
        if(!t||!paper){ clearActiveTbl(); return; }
        const r=paper.getBoundingClientRect(),sc=pageScreenScale(activeTbl.pageIdx),k=uiCssZoom();
        // 종이 기준 화면 px 로 자리를 구한 뒤, 막대가 쓰는 CSS px 로 한 번에 바꾼다.
        let left=uiCss(r.left+t.x*sc.x);         // 별도 이동 손잡이가 없어 표 왼쪽 기준에 맞춘다
        let top=uiCss(r.top+t.y*sc.y-48);
        if(top<uiCss(64)) top=uiCss(r.top+(t.y+tblSize(t).h)*sc.y+14);
        left=Math.max(uiCss(8),Math.min(left,uiCss(innerWidth-8)-(bar.offsetWidth||0)));
        top=Math.max(uiCss(60),Math.min(top,uiCss(innerHeight)-52));
        bar.style.left=left+'px'; bar.style.top=top+'px';
    }
    // 표 안을 누르면 표 도구를 띄우고, 밖을 누르면 감춘다
    function tblTouch(e,pi,t){
        const host=t.closest('.tb')||t.closest('.stroke-g');
        if(host){
            const el=findEl(pi,host.dataset.id);
            const tid=tblOf(el);
            if(tid){
                setActiveTbl(pi,tid,(el.tbl&&el.tbl.r)||0,(el.tbl&&el.tbl.c)||0);
                return;
            }
        }
        if(!t.closest('.tbl-box')&&!t.closest('.tbl-bar')) clearActiveTbl();
    }
    // 표가 '선택된 상태'인지 (칸을 편집 중이면 아니다)
    function tblSelectedForDelete(){
        return !!activeTbl && !tblCellSelection && !document.querySelector('.tb.edit')
               && !selected && !multiSel.length;
    }

    function tblAdd(kind,dir){
        if(!activeTbl){ toast('표 안을 먼저 눌러 주세요',1600); return; }
        const {pageIdx:pi,tid}=activeTbl;
        const t=findTbl(pi,tid); if(!t) return;
        pushHistory(); clearTblCellSelection();
        const list=doc.pages[pi].els||[];
        if(kind==='row'){
            if(t.ch.length>=40){ toast('행은 40개까지입니다',1600); return; }
            const at=Math.max(0,Math.min(t.ch.length,activeTbl.r+(dir>0?1:0)));
            t.ch.splice(at,0,t.ch[activeTbl.r]||40);
            list.forEach(e=>{ if(e.type==='text'&&tblOf(e)===tid&&e.tbl.r>=at) e.tbl.r++; });
            activeTbl.r=at;
        }else{
            if(t.cw.length>=20){ toast('열은 20개까지입니다',1600); return; }
            const at=Math.max(0,Math.min(t.cw.length,activeTbl.c+(dir>0?1:0)));
            t.cw.splice(at,0,t.cw[activeTbl.c]||120);
            list.forEach(e=>{ if(e.type==='text'&&tblOf(e)===tid&&e.tbl.c>=at) e.tbl.c++; });
            activeTbl.c=at;
        }
        rebuildTable(pi,tid);
        positionTblBar();
        toast(kind==='row'?'행을 추가했습니다':'열을 추가했습니다',1200);
    }
    function tblDel(kind){
        if(!activeTbl){ toast('표 안을 먼저 눌러 주세요',1600); return; }
        const {pageIdx:pi,tid}=activeTbl;
        const t=findTbl(pi,tid); if(!t) return;
        if(kind==='row'&&t.ch.length<=1){ tblDelAll(); return; }
        if(kind==='col'&&t.cw.length<=1){ tblDelAll(); return; }
        pushHistory(); clearTblCellSelection();
        const at=kind==='row'?activeTbl.r:activeTbl.c;
        if(kind==='row') t.ch.splice(at,1); else t.cw.splice(at,1);
        doc.pages[pi].els=(doc.pages[pi].els||[]).filter(e=>{
            if(!(e.type==='text'&&tblOf(e)===tid)) return true;
            return kind==='row'? e.tbl.r!==at : e.tbl.c!==at;
        });
        doc.pages[pi].els.forEach(e=>{
            if(e.type==='text'&&tblOf(e)===tid){
                if(kind==='row'&&e.tbl.r>at) e.tbl.r--;
                if(kind==='col'&&e.tbl.c>at) e.tbl.c--;
            }
        });
        if(kind==='row') activeTbl.r=Math.min(at,t.ch.length-1);
        else             activeTbl.c=Math.min(at,t.cw.length-1);
        rebuildTable(pi,tid);
        positionTblBar();
        toast(kind==='row'?'행을 지웠습니다':'열을 지웠습니다',1200);
    }
    function tblFit(){
        if(!activeTbl) return;
        const t=findTbl(activeTbl.pageIdx,activeTbl.tid); if(!t) return;
        pushHistory();
        const s=tblSize(t);
        const w=Math.max(TBL_MINW,Math.round(s.w/t.cw.length));
        const h=Math.max(TBL_MINH,Math.round(s.h/t.ch.length));
        t.cw=t.cw.map(()=>w); t.ch=t.ch.map(()=>h);
        rebuildTable(activeTbl.pageIdx,activeTbl.tid);
        renderTblDivs(activeTbl.pageIdx);
        positionTblBar();
        toast('칸 크기를 고르게 맞췄습니다',1300);
    }
    function tblDelAll(noAsk, optTid, optPi){
        let pi = optPi, tid = optTid;
        if(!tid && activeTbl){ pi = activeTbl.pageIdx; tid = activeTbl.tid; }
        if(!tid && selected && selected.el){
            const lid = selected.el.dataset.id, lpi = +selected.el.dataset.pageIdx;
            const el = findEl(lpi, lid);
            if(el && tblOf(el)){ pi = lpi; tid = tblOf(el); }
        }
        if(!tid) return;
        if(pi == null) pi = curPageIdx;
        if(!noAsk && !confirm('표를 통째로 삭제할까요?')) return;
        const table=findTbl(pi,tid);
        const group=(table&&table.group)||('g_'+tid);
        const selectedWasInTable=!!(selected&&selected.el&&(()=>{
            const el=findEl(+selected.el.dataset.pageIdx,selected.el.dataset.id);
            return el&&(tblOf(el)===tid||el.group===group);
        })());
        pushHistory();
        // 셀, 실제 테두리 stroke, 선택용 거터/손잡이까지 같은 표에 속한 것은 전부 제거한다.
        doc.pages[pi].els = (doc.pages[pi].els || []).filter(e => tblOf(e) !== tid && e.group !== group);
        doc.pages[pi].tables = (pageTables(pi) || []).filter(x => x.id !== tid);
        document.querySelectorAll('.layer-tbl .tbl-box').forEach(n=>{ if(n.dataset.tid===String(tid)) n.remove(); });
        // 18.9 · 없는 함수(clearSel)를 부르는 바람에 '표 전체 삭제'가 도중에
        //   ReferenceError 로 멈춰, 화면에는 표가 남고 저장도 안 되던 버그.
        if(selectedWasInTable){ deselectAll(true); clearMulti(); selected=null; }
        clearActiveTbl();
        markPageEdited(pi); renderPageEls(pi); renderTblDivs(pi); saveDoc();
        toast('표를 삭제했습니다 (Ctrl+Z 로 되돌리기)', 1800);
    }
    // 표를 통째로 옮기면 표 정보의 기준점도 함께 움직인다
    function shiftTable(pi,tid,dx,dy){
        const t=findTbl(pi,tid); if(!t) return;
        t.x=Math.round(t.x+dx); t.y=Math.round(t.y+dy);
    }
    // 이동/스냅이 끝난 뒤 칸 좌표에서 표 기준점을 다시 계산
    function syncTableFromCells(pi,tid){
        const t=findTbl(pi,tid); if(!t) return;
        const c0=tblCells(pi,tid).find(e=>e.tbl.r===0&&e.tbl.c===0);
        if(!c0) return;
        t.x=Math.round(c0.x-3); t.y=Math.round(c0.y-3);
    }
    function syncAllTables(pi){ pageTables(pi).forEach(t=>syncTableFromCells(pi,t.id)); }

    // ==========================================================
    //  문서에서 찾기 (Ctrl + F)
    // ==========================================================
    let findOpen=false, findHits=[], findCur=-1, findQ='';
    function toggleFind(){ findOpen?closeFind():openFind(); }
    function openFind(){
        if(!doc) return;
        findOpen=true;
        // 20.0 · 찾기는 글자 DOM 위에 하이라이트를 칠한다 → 보이는 쪽을 깨운다.
        try{ activateVisiblePages(); }catch(_e){}
        document.getElementById('findBar').classList.add('show');
        const i=document.getElementById('findInput');
        i.focus(); i.select();
        if(i.value) runFind(i.value);
    }
    function closeFind(){
        findOpen=false; findHits=[]; findCur=-1; findQ='';
        document.getElementById('findBar').classList.remove('show');
        document.getElementById('findCount').textContent='0';
        document.querySelectorAll('.find-layer').forEach(l=>l.innerHTML='');
    }
    // 글상자의 순수 글자. 찾기·개요·통계·단어분석이 같은 요소를 몇 번씩 묻기
    // 때문에 500쪽 문서에서는 이 HTML 파싱이 통째로 렉이 된다 → html 이 그대로면
    // 지난 결과를 돌려준다(요소가 사라지면 WeakMap 이 알아서 비운다).
    const _plainCache=new WeakMap();
    function elPlainText(el){
        if(!el) return '';
        if(el.type==='latex') return el.latex||'';
        const html=el.html||'';
        const hit=_plainCache.get(el);
        if(hit&&hit.html===html) return hit.text;
        const d=document.createElement('div'); d.innerHTML=html;
        const text=d.textContent||'';
        try{ _plainCache.set(el,{html,text}); }catch(e){}
        return text;
    }
    function runFind(q){
        findQ=(q||'');
        findHits=[]; findCur=-1;
        const needle=findQ.trim().toLowerCase();
        if(!doc||needle.length<1){
            document.getElementById('findCount').textContent='0';
            document.querySelectorAll('.find-layer').forEach(l=>l.innerHTML='');
            return;
        }
        doc.pages.forEach((pg,pi)=>{
            (pg.els||[]).forEach(el=>{
                if(el.type!=='text') return;
                const txt=elPlainText(el).toLowerCase();
                let from=0, at;
                while((at=txt.indexOf(needle,from))>=0){
                    findHits.push({pageIdx:pi,id:el.id,start:at,len:needle.length});
                    from=at+Math.max(1,needle.length);
                    if(findHits.length>800) break;
                }
            });
        });
        if(findHits.length){
            // 지금 보는 페이지에서 가장 가까운 것부터
            let i=findHits.findIndex(h=>h.pageIdx>=curPageIdx);
            findCur=i<0?0:i;
        }
        updateFindCount();
        paintFindHits();
        if(findCur>=0) revealHit(findHits[findCur],true);
    }
    function updateFindCount(){
        const n=findHits.length;
        document.getElementById('findCount').textContent=
            n? `${findCur+1} / ${n}` : (findQ.trim()?'없음':'0');
    }
    function findStep(d){
        if(!findHits.length){ if(findQ.trim()) toast('찾는 글자가 없습니다',1400); return; }
        findCur=(findCur+d+findHits.length)%findHits.length;
        updateFindCount();
        revealHit(findHits[findCur],false);
        paintFindHits();
    }
    function findKey(e){
        if(e.key==='Enter'){
            e.preventDefault(); e.stopPropagation();
            findStep(e.shiftKey?-1:1);
        }else if(e.key==='Escape'){
            e.preventDefault(); e.stopPropagation();
            closeFind();
        }else{
            // 글자 입력은 에디터 단축키(Delete 등)로 새어 나가면 안 된다
            e.stopPropagation();
        }
    }
    // 글자 위치를 실제 화면에서 재서 형광 사각형을 만든다
    function hitRects(hit){
        const paper=paperAt(hit.pageIdx); if(!paper) return [];
        const node=paper.querySelector(`.tb[data-id="${hit.id}"] .tb-content`);
        if(!node) return [];
        const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT,null);
        let acc=0, range=document.createRange(), started=false, n;
        const end=hit.start+hit.len;
        while((n=walker.nextNode())){
            const len=n.nodeValue.length;
            if(!started && acc+len>hit.start){
                range.setStart(n,Math.max(0,hit.start-acc)); started=true;
            }
            if(started && acc+len>=end){
                range.setEnd(n,Math.max(0,Math.min(len,end-acc)));
                break;
            }
            acc+=len;
        }
        if(!started) return [];
        const pr=paper.getBoundingClientRect(),sc=pageScreenScale(hit.pageIdx);
        if(typeof range.getClientRects!=='function') return [];   // 18.9 · 구형 웹뷰 방어
        return Array.from(range.getClientRects()).map(r=>({
            x:(r.left-pr.left)/sc.x, y:(r.top-pr.top)/sc.y,
            w:r.width/sc.x, h:r.height/sc.y }));
    }
    function paintFindHits(){
        document.querySelectorAll('.find-layer').forEach(l=>l.innerHTML='');
        if(!findOpen||!findHits.length) return;
        findHits.forEach((h,i)=>{
            // 화면에 올라와 있는 쪽만 칠한다 (가상화된 쪽은 다시 그릴 때 복원된다)
            if(!mountedShells.has(h.pageIdx)) return;
            const paper=paperAt(h.pageIdx); if(!paper) return;
            const layer=paper.querySelector('.find-layer'); if(!layer) return;
            hitRects(h).forEach(r=>{
                const d=document.createElement('div');
                d.className='find-hit'+(i===findCur?' cur':'');
                d.style.cssText=`left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;`;
                layer.appendChild(d);
            });
        });
    }
    function revealHit(hit,soft){
        if(!hit) return;
        const body=document.getElementById('editorBody');
        const size=paperSize();
        const el=findEl(hit.pageIdx,hit.id);
        const top=(hit.pageIdx*(size.h+PAGE_GAP)+((el&&el.y)||0))*pageScale;
        const far=Math.abs(hit.pageIdx-(curPageIdx|0))>2;
        curPageIdx=hit.pageIdx; updatePageInfo();
        maintainPageWindow(hit.pageIdx,true);
        _scrollBodyTo(body,Math.max(0,top-body.clientHeight*0.35),(soft||far)?'auto':'smooth');
        setTimeout(paintFindHits,soft?60:320);
    }

    // 18.9 · scrollTo 가 없는 환경(구형 웹뷰·테스트 DOM)에서도 스크롤이 죽지 않게
    function _scrollBodyTo(body,top,behavior){
        if(!body) return;
        try{
            if(typeof body.scrollTo==='function'){ body.scrollTo({top,behavior}); return; }
        }catch(e){}
        try{ body.scrollTop=top; }catch(e){}
    }

    // ==========================================================
    //  페이지 바로가기 · 즐겨찾는 페이지
    // ==========================================================
    function goToPage(n){
        if(!doc) return;
        let i=parseInt(String(n),10);
        if(isNaN(i)){ updatePageInfo(); return; }
        i=Math.max(1,Math.min(doc.pages.length,i))-1;
        const body=document.getElementById('editorBody');
        const size=paperSize();
        const far=Math.abs(i-(curPageIdx|0))>2;
        curPageIdx=i; updatePageInfo();
        // 먼 점프를 smooth로 하면 중간 수십 쪽이 차례로 로드되므로 즉시 이동한다.
        maintainPageWindow(i,true);
        _scrollBodyTo(body,i*(size.h+PAGE_GAP)*pageScale,far?'auto':'smooth');
    }
    function favList(){
        if(!doc) return [];
        if(!Array.isArray(doc.favPages)) doc.favPages=[];
        return doc.favPages;
    }
    function curPageId(){ const p=doc&&doc.pages[curPageIdx]; return p?p.id:null; }
    function isFavPage(pid){ return favList().indexOf(pid)>=0; }
    function toggleFavPage(){
        if(!doc) return;
        const pid=curPageId(); if(!pid) return;
        const l=favList(); const i=l.indexOf(pid);
        if(i>=0){ l.splice(i,1); toast('즐겨찾기에서 뺐습니다',1200); }
        else { l.push(pid); toast(`페이지 ${curPageIdx+1} 즐겨찾기 ⭐`,1300); }
        saveDoc(); updatePageInfo(); renderFavPop();
    }
    function pagePreview(pg){
        let s='';
        (pg.els||[]).forEach(e=>{
            if(s.length>26||e.type!=='text') return;
            const t=elPlainText(e).trim();
            if(t) s+=(s?' ':'')+t;
        });
        s=s.replace(/\s+/g,' ').trim();
        return s? (s.length>26?s.slice(0,26)+'…':s) : '(빈 페이지)';
    }
    function renderFavPop(){
        const pop=document.getElementById('favPop'); if(!pop) return;
        const l=favList();
        if(!l.length){
            pop.innerHTML=`<div style="padding:14px 12px;font-size:12px;color:var(--text3);text-align:center;line-height:1.6;">
                즐겨찾는 페이지가 없습니다<br>별(<i class="ri-star-line"></i>) 을 눌러 지금 페이지를 담아 보세요</div>`;
            return;
        }
        let html='';
        l.forEach(pid=>{
            const i=doc.pages.findIndex(p=>p.id===pid);
            if(i<0) return;
            html+=`<div class="fav-item" data-pid="${pid}"
                     onclick="jumpFav('${pid}')"
                     ontouchstart="favDown(event,'${pid}')"
                     ontouchmove="favMove(event)"
                     ontouchend="favUp(event)"
                     ontouchcancel="favCancel(event)"
                     onmousedown="favDown(event,'${pid}')">
                     <i class="ri-draggable fav-drag" title="꾹 눌러 끌어서 순서 변경"></i>
                     <i class="ri-star-fill" style="color:#f59e0b;font-size:13px;"></i>
                     <b style="flex:none;">${i+1}쪽</b>
                     <span style="color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(pagePreview(doc.pages[i]))}</span>
                     <i class="ri-close-line" title="빼기" style="margin-left:auto;color:var(--text3);"
                        onclick="event.stopPropagation();removeFav('${pid}')"></i>
                   </div>`;
        });
        pop.innerHTML=html||`<div style="padding:12px;font-size:12px;color:var(--text3);">표시할 페이지가 없습니다</div>`;
    }
    function jumpFav(pid){
        if(favJustDragged){ favJustDragged=false; return; }
        const i=doc.pages.findIndex(p=>p.id===pid);
        if(i<0){ toast('지워진 페이지입니다',1400); return; }
        goToPage(i+1);
        document.getElementById('favPop').classList.remove('show');
    }
    function removeFav(pid){
        const l=favList(); const i=l.indexOf(pid);
        if(i>=0){ l.splice(i,1); saveDoc(); updatePageInfo(); renderFavPop(); }
    }

    // ===== 북마크(즐겨찾는 쪽) 꾹 눌러 끌어서 순서 바꾸기 =====
    // 10.0 · 예전에는 작은 ⋮ 핸들만 즉시 끌 수 있었는데, 폰에서는 목록 스크롤과
    //   포인터가 서로 싸우면서(pointercancel) 거의 작동하지 않았다.
    //   이제 '항목 어디든 0.38초 꾹 누른 뒤 움직여 놓으면' 놓은 자리에 순서가 바뀐다.
    let favDrag=null, favJustDragged=false, favLP=null, favSX=0, favSY=0;
    function favDown(e,pid){
        const item=e.currentTarget.closest('.fav-item');
        if(!item) return;
        const pt=e.touches?e.touches[0]:e;
        favSX=pt.clientX; favSY=pt.clientY;
        clearTimeout(favLP);
        favLP=setTimeout(()=>{ favLP=null; beginFavDrag(item,pt); },380);
    }
    function favPressCancel(e){
        if(!favLP) return;
        const pt=e.touches?e.touches[0]:e;
        if(Math.abs(pt.clientX-favSX)>8||Math.abs(pt.clientY-favSY)>8){ clearTimeout(favLP); favLP=null; }
    }
    function beginFavDrag(item,pt){
        const pop=document.getElementById('favPop');
        favDrag={item,pop,popScroll:pop?pop.scrollTop:0,baseY:pt.clientY,moved:false};
        item.style.opacity='.45'; item.style.cursor='grabbing';
        if(navigator.vibrate) navigator.vibrate(18);
        toast('끌어서 순서를 바꾸세요',1400);
    }
    function favMove(e){
        if(!favDrag){ favPressCancel(e); return; }
        const pt=e.touches?e.touches[0]:e;
        try{ e.preventDefault(); }catch(err){}
        // .fav-item 은 touch-action:pan-y 라 세로 스크롤은 preventDefault 로 못 막는다.
        // 브라우저가 팝업을 스크롤시킨 만큼 되돌려 화면이 흔들리지 않게 한다.
        if(favDrag.pop&&favDrag.pop.scrollTop!==favDrag.popScroll) favDrag.pop.scrollTop=favDrag.popScroll;
        if(Math.abs(pt.clientY-favDrag.baseY)>6) favDrag.moved=true;
        const el=document.elementFromPoint(pt.clientX,pt.clientY);
        const over=el&&el.closest('.fav-item');
        if(over&&over!==favDrag.item){
            const r=over.getBoundingClientRect();
            const before=pt.clientY<r.top+r.height/2;
            over.parentElement.insertBefore(favDrag.item,before?over:over.nextSibling);
        }
    }
    function favUp(e){
        clearTimeout(favLP); favLP=null;
        if(!favDrag) return;
        const d=favDrag; favDrag=null;
        d.item.style.opacity=''; d.item.style.cursor='';
        if(!d.moved){                           // 꾹 눌렀다 뗐을 뿐이면 뒤따르는 클릭만 삼킨다
            favJustDragged=true;
            setTimeout(()=>{ favJustDragged=false; },350);
            return;
        }
        favJustDragged=true;
        setTimeout(()=>{ favJustDragged=false; },350);
        const pop=document.getElementById('favPop');
        const order=[...pop.querySelectorAll('.fav-item')].map(n=>n.dataset.pid);
        const l=favList();
        l.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
        saveDoc(); renderFavPop();
    }
    function favCancel(){
        clearTimeout(favLP); favLP=null;
        if(favDrag){ favDrag.item.style.opacity=''; favDrag.item.style.cursor=''; favDrag=null; }
    }
    // ★ pointermove/pointerup 로 통합 — 터치 장치에서 즉시 반응
    document.addEventListener('pointermove',e=>{ if(favDrag||favLP) favMove(e); });
    document.addEventListener('pointerup',()=>{ if(favDrag) favUp(); });
    function toggleFavPop(e){
        const pop=document.getElementById('favPop');
        if(pop.classList.contains('show')){ pop.classList.remove('show'); return; }
        renderFavPop();
        pop.classList.add('show');
        const r=(e&&e.currentTarget||document.getElementById('favListBtn')).getBoundingClientRect();
        pop.style.left=Math.max(8,Math.min(r.left-90,innerWidth-pop.offsetWidth-8))+'px';
        pop.style.top=(r.bottom+6)+'px';
    }
    // ★ pointerdown 으로 변경 — 터치 장치에서 팝업 닫힘 즉시 반응
    document.addEventListener('pointerdown',e=>{
        const pop=document.getElementById('favPop');
        if(pop&&pop.classList.contains('show')&&!e.target.closest('#favPop')&&!e.target.closest('#favListBtn'))
            pop.classList.remove('show');
        const tp=document.getElementById('tintPop');
        if(tp&&tp.classList.contains('show')&&!e.target.closest('#tintPop')&&!e.target.closest('#tintBtn'))
            tp.classList.remove('show');
        const pp=document.getElementById('pinPop');
        if(pp&&pp.classList.contains('show')&&!e.target.closest('#pinPop')&&!e.target.closest('.pin'))
            closePin();
    });

    function tableInsertSize(rows,cols){
        rows=Math.max(1,Math.min(40,rows|0)); cols=Math.max(1,Math.min(20,cols|0));
        const size=paperSize();
        const cw=Math.min(150,Math.max(TBL_MINW,Math.floor((size.w-120)/cols)));
        const ch=40;
        return {rows,cols,cw,ch,w:cw*cols,h:ch*rows};
    }
    // 미리보기와 실제 삽입이 반드시 같은 종이 안쪽 경계를 사용한다.
    function clampTableOrigin(dim,x,y){
        const size=paperSize();
        return {
            x:Math.max(8,Math.min(Math.round(x),Math.max(8,size.w-dim.w-8))),
            y:Math.max(8,Math.min(Math.round(y),Math.max(8,size.h-dim.h-8)))
        };
    }
    function insertTable(rows,cols,pageIdx,x,y){
        const dim=tableInsertSize(rows,cols);
        rows=dim.rows; cols=dim.cols;
        const pi=(pageIdx==null?curPageIdx:pageIdx);
        const size=paperSize(),cw=dim.cw,ch=dim.ch;
        const origin=clampTableOrigin(dim,
            x==null?(size.w-dim.w)/2:x,
            y==null?120:y);
        const ox=origin.x, oy=origin.y;

        pushHistory();
        const tid='tb_'+Math.random().toString(36).slice(2,9);
        pageTables(pi).push({
            id:tid, x:ox, y:oy,
            cw:Array.from({length:cols},()=>cw),
            ch:Array.from({length:rows},()=>ch),
            color:'#9aa1ab', lw:1.2, group:'g_'+tid
        });
        rebuildTable(pi,tid);
        setActiveTbl(pi,tid,0,0);
        toast(rows+'행 '+cols+'열 표 · 경계선을 끌어 크기 조절',2400);
    }
    // ==========================================================
    //  세로 도구막대 (Task 29) + 새 기능 10가지
    // ==========================================================
    let sideOpen=true, sidePanel=null;

    // ===== 암기 카드 =====
    // 14.38+ · src/cards.js 로 분리. HTML onclick / live-updates 는 window.* 를 쓴다.
    // (openCards·closeCards·loadDecks·flushCardGrades·fcard* 등)


    // ===== 서버 상태 계기판 + 알림 센터 =====
    // 14.38+ · src/server-status.js 로 분리 (openSrvPop · toggleNotifications · srvStart …)


/* APP-PART:08-selection-table.js:END */
