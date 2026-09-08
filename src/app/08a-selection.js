/* === src/app/08a-selection.js ===
   선택/드래그 · 스프레드시트 셀
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:08a-selection.js:BEGIN */
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
    //
    // ★ 14.39.3 · 이미지 층(layer-img)은 '실제로 끌거나 크기를 조절하는 동안'만
    //   올린다 (사용자 보고 — "이미지를 이동하려고 선택하면 주변 수식이 사라짐").
    //   예전에는 사진을 한 번만 선택해도 층 전체가 z=50 으로 떠올라, 글자·수식
    //   층 위에 그림이 얹혔다. 그 결과 ① 사진과 겹친 수식·글자가 그림 뒤에
    //   숨고, ② (옛 구조에선 같은 층에 있던) 원본 배경 래스터와 흰 바탕 수식
    //   조각까지 함께 떠올라 주변이 통째로 가려졌다. 이제 선택만으로는
    //   올리지 않고, sdy-dragging / sdy-resizing 이 붙은 동안(실제 제스처)
    //   만 앞으로 온다 — 옮기는 그림은 끝까지 보이되, 놓거나 손을 떼면
    //   곧바로 글자·수식이 다시 그림 위로 돌아온다. 그림 층이 올라가 있어도
    //   글자는 여전히 그 아래에서 읽힌다(아래 layer-fig 분리 참고).
    function _layerLift(layer){
        if(!layer) return;
        const imgGesture=layer.classList.contains('layer-img');
        let on=false;
        for(let n=layer.firstElementChild;n;n=n.nextElementSibling){
            const cl=n.classList;
            if(!cl) continue;
            if(imgGesture){
                if(cl.contains('sdy-dragging')||cl.contains('sdy-resizing')){ on=true; break; }
            }else if(cl.contains('sel')||cl.contains('edit')||cl.contains('msel')){ on=true; break; }
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

    // 불러온 논문(tight/pdfText)의 '단어마다 절대좌표 배치된 span'을, 폰트·
    // 글자 크기·색·굵기·기울임 등 단어별 서식을 보존한 채 브라우저가 줄을
    // 재계산할 수 있는 '흐름 텍스트' HTML 로 펼친다. 행(줄)은 원문의 세로
    // 위치로, 단어 순서는 가로 위치로 복원한다. 자리만 옮기는 표시 작업이라
    // 절대 모델(el.html)을 바꾸지 않는다 — 편집 중에 쓰고, 실제 수정이
    // 저장될 때만 확정된다.
    function _pdfTightToEditHtml(c){
        try{
            const sps=Array.from(c.children).filter(s=>s&&s.nodeType===1&&s.tagName==='SPAN');
            if(!sps.length) return '';
            const num=v=>{ const n=parseFloat(v); return isNaN(n)?0:n; };
            sps.sort((a,b)=>{
                const at=num(a.dataset.origTop||a.style.top)||a.offsetTop||0;
                const bt=num(b.dataset.origTop||b.style.top)||b.offsetTop||0;
                if(Math.abs(at-bt)>2) return at-bt;
                return (num(a.style.left)||a.offsetLeft||0)-(num(b.style.left)||b.offsetLeft||0);
            });
            const rows=[]; let cur=[]; let lastTop=null;
            sps.forEach(s=>{
                let t='';
                try{
                    const cl=s.cloneNode(true);
                    cl.querySelectorAll('.zsp,br,img').forEach(z=>z.remove());
                    t=(cl.textContent||'').replace(/[\u200b\ufeff]/g,'').trim();
                }catch(e){ t=(s.textContent||'').replace(/[\u200b\ufeff]/g,'').trim(); }
                if(!t) return;
                const top=num(s.dataset.origTop||s.style.top)||s.offsetTop||0;
                if(lastTop!=null&&Math.abs(top-lastTop)>2){ if(cur.length) rows.push(cur); cur=[]; }
                cur.push({t,s}); lastTop=top;
            });
            if(cur.length) rows.push(cur);
            if(!rows.length) return '';
            return rows.map(row=>{
                const parts=[];
                row.forEach(({t,s},idx)=>{
                    if(idx>0) parts.push(' ');
                    // 인라인 서식은 그대로 두고, 절대좌표·변형만 흐름에서 빠뜨린다.
                    const sp=s.cloneNode(false);
                    sp.removeAttribute('data-fs'); sp.removeAttribute('data-pdf-w'); sp.removeAttribute('data-pdf-base');
                    sp.style.position=''; sp.style.left=''; sp.style.top='';
                    sp.style.transform=''; sp.style.transformOrigin='';
                    sp.style.whiteSpace=''; sp.style.lineHeight=''; sp.style.display='';
                    sp.textContent=t;
                    parts.push(sp.outerHTML);
                });
                return parts.join('');
            }).join('<br>');
        }catch(e){ return ''; }
    }
    // 실제 수정이 커밋/저장될 때만 이 상자를 '흐름 텍스트 상자'로 확정한다.
    // 원문 pdf 배치 깃발(tight/pdfText)을 끄고 그에 딸린 클래스도 지운다.
    function _finalizeTightEdit(w,el){
        try{
            if(!w||!(w._sdyWasTight||w._sdyTightEdit)) return;
            if(el) el.tight=0;
            if(el) delete el.pdfText;
            w.classList.remove('tight'); w.classList.remove('pdf-text');
            delete w._sdyWasTight;
            delete w._sdyTightEdit;
        }catch(e){}
    }
    // 14.39.9 · tight 상자를 '원본 절대좌표 배치' 그대로 두고 편집 모드로 들어간다.
    //   글꼴·색·크기·굵기 같은 서식만 바꿀 때는 배치가 바뀌지 않는다.
    //   실제 글자 입력(타이핑·붙여넣기·삭제)이 일어나는 순간에만 흐름 텍스트로
    //   펼쳐(_pdfTightToEditHtml) 일반 편집과 같은 줄·캐럿 동작을 제공한다.
    function _convertTightToFlow(w){
        if(!w||!w._sdyTightEdit||w._sdyWasTight) return;
        const c=w.querySelector('.tb-content');
        if(!c) return;
        const _html=_pdfTightToEditHtml(c);
        if(_html){
            c.innerHTML=_html;
            c.style.letterSpacing=''; c.style.wordSpacing='';
            w._sdyWasTight=1;
            delete w._sdyTightEdit;
            try{ if(typeof _tightQueue!=='undefined'&&_tightQueue.delete) _tightQueue.delete(c); }catch(e){}
            w._sdyViewHtml=c.innerHTML;
        }
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
                list.forEach(w=>{
                    if(!w||w.classList.contains('edit')) return;
                    const c=w.querySelector('.tb-content');
                    if(c&&!c.querySelector('.wf')) wfPaintNode(c);
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
            // 타이핑 닻(ZWSP·빈 sdy-type span)은 저장 문자열에서 걷어낸다 — 문서에 남지 않게.
            const nh=c.innerHTML===w._sdyViewHtml?el.html:_stripTypingMarkersHtml(imathCollapse(stripWF(c.innerHTML)));
            const nfs=parseFloat(c.style.fontSize)||16;
            if(nh!==el.html||nfs!==el.fontSize){
                const textChanged=nh!==el.html;   // 글자 본문이 실제로 바뀌었는가 (저장 전 비교)
                el.html=nh; el.fontSize=nfs; changed=true;
                // 14.39.9 · tight 상자는 텍스트를 고쳐도 절대좌표 배치를 유지한다.
                //   흐름 텍스트로 변환했던 옛 경로(_sdyWasTight)만 확정한다.
                if(w._sdyWasTight&&textChanged) _finalizeTightEdit(w,el);
                w._sdyModelHtml=el.html; w._sdyViewHtml=c.innerHTML; w._sdyModelKey=JSON.stringify(el);
                // tight 편집 후 단어 맞춤 재실행 — 새 글자 폭에 맞춰 scaleX 재계산
                if(w._sdyTightEdit&&el.tight&&typeof _queueTightFit==='function'){
                    try{ _queueTightFit(c,el); }catch(_e){}
                }
                // 14.6 · 커밋된 편집분도 dirty 로 표시 → 가져온 문서(서버 보관본)에서
                //  나가기 직전 커밋된 글자가 슬라이스 저장에서 빠져 유실되지 않는다.
                try{ markPageEdited(+w.dataset.pageIdx); }catch(e){}
            }
            // 편집 종료 시 _sdyTightEdit 플래그 정리 (tight 배치는 유지)
            if(w._sdyTightEdit) delete w._sdyTightEdit;
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
        // 14.40 · 가져온 PDF 상자(tight) — 편집 진입 시 '줄 단위 절대위치 + 줄 내
        //   인라인 흐름'으로 한 번만 변환한다. 줄(원본 세로 위치)은 절대위치라
        //   절대 이동하지 않고, 줄 안은 일반 텍스트처럼 흘러 드래그 선택·방향키
        //   (상하=줄 이동)·형광펜·드래그가 자연스럽다. 엔터는 캐럿 위치에서 줄을
        //   나눠 아래에 새 줄을 만든다(_tightLineEnter). 커밋 시 이 HTML 이
        //   el.html 로 확정된다(tight·pdfText 플래그는 유지).
        try{
            const _el=findEl(+w.dataset.pageIdx,w.dataset.id);
            if(_el&&_el.tight&&!w._sdyTightEdit){
                w._sdyTightEdit=1;
                const _lf=(typeof _tightToLineFlow==='function')?_tightToLineFlow(c):null;
                if(_lf){ c.innerHTML=''; c.appendChild(_lf); w._sdyTightLine=1; }
                else if(c.querySelector&&c.querySelector(':scope>.sdy-tl')) w._sdyTightLine=1; // 이미 줄 흐름
                w._sdyViewHtml=c.innerHTML;
            }
        }catch(e){}
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
    // 14.39.8 · 더블클릭/탭으로 편집에 들어갈 때 캐럿을 '누른 자리'에 둔다.
    //   enterEdit(w,true) 는 c.focus() 만 하므로 캐럿이 상자 맨 앞으로 간다
    //   (보고된 버그: 더블클릭하면 깜빡이가 항상 첫 글자 앞에 선다).
    //   게다가 Chrome·Edge 는 pointerdown 의 e.detail 을 항상 0 으로 보내므로
    //   (w3c/pointerevents#98 — compat mousedown 이 pointer 환경에서 눌려 있다)
    //   onPaperDown 의 e.detail>=2 더블클릭 분기는 실제 입력에서 살아나지 않고,
    //   편집 진입은 .tb-content 의 dblclick 리스너가 한다. 그래서 '누른 좌표'를
    //   받는 자리를 하나로 모아 어느 경로로 들어가든 캐럿이 눌린 자리에 선다.
    //   단어 선택이 아니라 접힌(collapsed) 캐럿 — 눌린 위치로 간다는 요구 그대로.
    function placeCaretFromPointer(c,x,y){
        if(!c) return false;
        enableTextSelect(c);
        const r=caretRangeAt(x,y,c);
        if(!r) return false;
        try{
            const cr=r.cloneRange(); cr.collapse(true);
            const sel=window.getSelection();
            if(!sel) return false;
            sel.removeAllRanges(); sel.addRange(cr);
        }catch(e){ return false; }
        // 캐럿 위치를 기억해야 툴바의 글꼴·색·크기가 '앞으로 입력될 글자'에 붙는다.
        try{ saveSel(); }catch(e){}
        return true;
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
                                enterEdit(node,true);
                                // 14.39.8 · 칸 더블클릭도 '누른 자리에 캐럿'
                                placeCaretFromPointer(node.querySelector('.tb-content'),e.clientX,e.clientY);
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
                    //   14.39.8 · 캐럿은 상자 맨 앞이 아니라 '누른 자리'로.
                    enterEdit(tb,true);
                    placeCaretFromPointer(tb.querySelector('.tb-content'),e.clientX,e.clientY);
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
                // 14.39.8 · 더블클릭 = '누른 자리에 캐럿' (단어 선택 아님).
                //   dblclick 리스너·모바일 다시탭과 같은 규칙을 쓴다.
                //   (이 분기는 준비 중 쪽의 pointer 재생처럼 detail 이 살아 있는
                //    경로에서만 탄다 — 실제 포인터 입력은 dblclick 리스너가 맡는다)
                placeCaretFromPointer(tb.querySelector('.tb-content'),e.clientX,e.clientY);
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
/* APP-PART:08a-selection.js:END */
