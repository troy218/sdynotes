/* === src/app/11-text-format.js ===
   글자색/형광펜 · 인라인 서식 · 종이크기
   (sdynotes.js 메가 분리 · 이 파일들은 scripts/bundle-frontend.mjs 가 순서대로 이어 붙인다.
    let/const 스코프를 공유하려면 반드시 concat 되어야 한다 — 단독 <script> 로드 금지) */
/* APP-PART:11-text-format.js:BEGIN */
    // ============ 워드식 글자색 / 형광펜 ============
    // 14.18.4 · 글자색/형광펜 팔레트는 파스텔보다 조금 더 세련된 진한 톤으로 맞춘다.
    //   예전 기본색/파스텔값이 저장돼 있어도 렌더링 때 아래 팔레트 계열로 자연스럽게 맞춘다.
    const TEXT_COLORS=CLASSIC_TEXT_COLORS.slice();
    const HL_COLORS=CLASSIC_HL_COLORS.slice();
    let currentTextColor=TEXT_COLORS[0], currentHlColor=HL_COLORS[0];
    // 실제 브라우저(특히 iOS Safari)는 툴바 버튼 pointerdown 순간 편집기의
    // Selection을 접어 버린다. jsdom 테스트에서 함수를 직접 호출할 때는 드러나지
    // 않는 차이다. pointerdown 전에 저장한 Range를 click handler가 끝날 때까지 잠근다.
    let _toolbarSelLockUntil=0;

    function saveSel(){
        const s=window.getSelection();
        if(!s||!s.rangeCount) return;
        if(_fmtBusy) return;   // 서식 재구축 중의 선택 변화는 저장 상태를 덮지 않는다
        const r=s.getRangeAt(0);
        const host=r.commonAncestorContainer.nodeType===1
            ? r.commonAncestorContainer.closest?.('.tb-content')
            : r.commonAncestorContainer.parentElement?.closest('.tb-content');
        if(!host) return;
        if(s.isCollapsed){
            // 툴바가 포커스를 가져가며 생긴 일시적 collapse로 실제 드래그 범위를
            // 덮어쓰지 않는다. 사용자가 종이에서 직접 캐럿을 옮긴 경우에는 lock이 없다.
            if(savedRange&&savedHost&&Date.now()<_toolbarSelLockUntil) return;
            // 편집 중 캐럿(글자 선택 없음)도 기억한다 — 이때 바꾼 색/글꼴/크기는
            // '상자 전체'가 아니라 '앞으로 입력될 글자'에만 적용하기 위함.
            const w=host.closest('.tb');
            if(w&&w.classList.contains('edit')){
                savedCaret={c:host,r:r.cloneRange()};
                savedRange=null; savedHost=null;   // 캐럿으로 접은 뒤엔 이전 선택은 무효
            }
            return;
        }
        savedRange=r.cloneRange(); savedHost=host;
        savedCaret=null; _typingSpan=null; _pendingTyping=null; // 글자 선택이 생기면 예전 캐럿 서식은 더 이상 우선하지 않는다.
    }
    function restoreSel(){
        if(!savedRange||!savedHost) return null;
        if(!document.body.contains(savedHost)) return null;
        // 저장 Range보다 사용자가 나중에 고른 상자가 우선이다. 메뉴를 여는 동안
        // selectionchange가 늦게 도착하면 이전 상자의 Range가 살아나 새 상자에
        // 적용할 글꼴/크기/색을 가로채는 일이 있었다.
        const rangeBox=savedHost.closest&&savedHost.closest('.tb');
        const picked=multiSel.length
            ? multiSel.map(m=>m.node).filter(n=>n&&n.isConnected&&n.classList.contains('tb'))
            : Array.from(document.querySelectorAll('#pagesStage .tb.sel,#pagesStage .tb.msel'));
        if(picked.length&&picked.indexOf(rangeBox)<0){
            savedRange=null; savedHost=null;
            return null;
        }
        savedHost.contentEditable='true';
        savedHost.focus({preventScroll:true});
        const s=window.getSelection();
        s.removeAllRanges(); s.addRange(savedRange);
        return savedHost;
    }
    document.addEventListener('selectionchange',()=>{ saveSel(); syncCurSel(); });
    function _isFormatToolbarTarget(target){
        return !!(target&&target.closest&&target.closest(
            '#editorView .fmt-group,#fontMenu,#textColorPop,#hlPop'));
    }
    // mousedown만 사용하면 touch/pen에서 저장 시점이 늦다. capture pointerdown은
    // 버튼 기본 포커스보다 먼저 실행되므로 실제 Range/caret를 확실히 보관한다.
    document.addEventListener('pointerdown',e=>{
        if(!_isFormatToolbarTarget(e.target)) return;
        saveSel();
        _toolbarSelLockUntil=Date.now()+1500;
    },true);
    document.addEventListener('click',e=>{
        if(!_isFormatToolbarTarget(e.target)) return;
        // target onclick(applyFont/execFmt 등)이 먼저 끝난 뒤 잠금을 푼다.
        setTimeout(()=>{ _toolbarSelLockUntil=0; },0);
    });
    // 14.13.4 · 글상자 옆에 떠 있던 서식 막대(fmtBar)를 없앴다 — 상단 바와 항목이
    //   중복됐기 때문. 글자 서식(글꼴·크기·굵기·색·형광펜)은 전부 상단 바에서 한다.

    // ===== 글꼴 선택 =====
    // 각 항목을 '해당 글꼴 자체'로 렌더링해 이름만 보고도 어떤 폰트인지 바로 알 수 있게 한다.
    //   좌측: 실제 글꼴로 그린 미리보기 문구 (abc 가나다)
    //   우측: 글꼴 이름 (항상 기본 글꼴로 표시해 항상 가독) + 현재 선택 시 체크
    function buildFontMenu(){
        const m=document.getElementById('fontMenu');
        if(m.dataset.ready==='1') return;
        FONTS.forEach(f=>{
            const it=document.createElement('div');
            it.className='font-item'; it.dataset.f=f.id;
            it.innerHTML=`<span class="fi-sample" style="font-family:${f.css}">abc 가나다</span>`+
                         `<span class="fi-name">${f.label}</span>`+
                         `<i class="ri-checkbox-fill fi-check"></i>`;
            it.onmousedown=e=>e.preventDefault();
            it.onclick=(e)=>{ e.stopPropagation(); applyFont(f.id); closeFontMenu(); };
            m.appendChild(it);
        });
        m.dataset.ready='1';
        // 미리보기가 실제 폰트로 그려지도록, 아직 안 불러온 글꼴은 여기에서 선제 로드
        if(document.fonts&&document.fonts.load){
            FONTS.forEach(f=>{
                const fam=f.css.split(',')[0];           // 주 패밀리 (따옴표 포함)
                try{ document.fonts.load('16px '+fam).catch(()=>{}); }catch(e){}
            });
        }
    }
    function toggleFontMenu(){
        buildFontMenu();
        const m=document.getElementById('fontMenu');
        const willShow=!m.classList.contains('show');
        closePops();
        m.classList.toggle('show',willShow);
        if(willShow){
            // 툴바의 블러(글래스)가 fixed 의 기준점을 바꾸어 위치가 어긋나므로
            // 색 팝오버와 같은 방식으로 body 로 옮긴 뒤 배치한다.
            if(m.parentElement!==document.body) document.body.appendChild(m);
            const r=document.getElementById('fontBtn').getBoundingClientRect();
            const cw=v=>window.sdyUiCss?window.sdyUiCss(v):(Number(v)||0);  // html zoom(.9) 보정
            m.style.left=Math.min(cw(r.left),cw(window.innerWidth)-240)+'px';
            m.style.top=(cw(r.bottom)+6)+'px';
            // 현재 선택된 글꼴 표시 (강조 + 체크)
            m.querySelectorAll('.font-item').forEach(n=>n.classList.toggle('sel',n.dataset.f===curFont));
        }
    }
    function closeFontMenu(){ document.getElementById('fontMenu').classList.remove('show'); }

    // 18.8 · 툴바(글꼴 이름·미리보기·메뉴 체크)를 한 곳에서 갱신한다.
    //   "사용자가 보는 툴바 글꼴 = 지금 입력되는 글꼴" 을 항상 지키기 위한 창구.
    function setToolbarFont(id){
        const f=FONTS.find(x=>x.id===id)||FONTS[0];
        curFont=f.id;
        const lb=document.getElementById('fontLabel');
        const btn=document.getElementById('fontBtn');
        if(lb) lb.textContent=f.label;
        if(btn) btn.style.fontFamily=f.css;
        document.querySelectorAll('#fontMenu .font-item')
            .forEach(n=>n.classList.toggle('sel',n.dataset.f===f.id));
        return f;
    }

    function applyFont(id){
        const f=setToolbarFont(id);
        id=f.id;

        // ① 글자 선택이 있으면 그 부분만 (새 인라인 엔진 사용 — 다른 서식 풀림 없음)
        const host=restoreSel();
        const sel=window.getSelection();
        if(host&&sel&&!sel.isCollapsed){
            pushHistory();
            try{
                wrapSelStyle('fontFamily',f.css);
                const w=host.closest('.tb'); if(w) syncTextEl(w);
                saveSel();
                syncCurSel();
            }catch(e){}
            toast(`글꼴: ${f.label}`,1100);
            return;
        }
        // ② 선택한 표 셀 범위 전체
        if(selectedTblCellEls().length){
            tblCellApply(el=>{ el.font=id; },`선택한 칸 글꼴: ${f.label}`);
            return;
        }
        // 18.5 · 편집 중 캐럿(선택 없음) → 상자 전체가 아니라 앞으로 입력될 글자에만
        if(_typingHost()){
            caretWrapStyle({fontFamily:f.css});
            toast(`앞으로 입력할 글꼴: ${f.label}`,1100);
            return;
        }
        // ③ 선택된 텍스트 상자(들)
        let targets=[];
        if(multiSel.length) targets=multiSel.map(m=>m.node).filter(n=>n.classList.contains('tb'));
        if(!targets.length) targets=Array.from(document.querySelectorAll('#pagesStage .tb.edit,#pagesStage .tb.sel'));
        if(targets.length){
            pushHistory();
            targets.forEach(w=>{
                const el=findEl(+w.dataset.pageIdx,w.dataset.id);
                const c=w.querySelector('.tb-content');
                if(el&&c){
                    el.font=id; c.style.fontFamily=f.css;
                    // 18.8 · 상자 전체 글꼴은 '안쪽 부분 글꼴'보다 세다.
                    //   굵게/색 등을 먼저 입히며 생긴 span 에 옛 글꼴이 박제돼 있어도
                    //   상자 글꼴 변경이 화면에 그대로 보이도록 인라인 글꼴을 걷어낸다.
                    // v2 엔진: 인라인으로 박제된 부분 글꼴만 새 값으로 갱신하고,
                    //   나머지는 상자 값 상속을 유지한다 (글자마다 span 을 깔지 않는다).
                    try{ _fmtApplyBox(c,'fontFamily',f.css,true); }catch(_e){}
                    syncTextEl(w);
                }
            });
            saveDoc();
            setToolbarFont(id);
            toast(`${targets.length}개 상자 글꼴 변경`,1200);
            return;
        }
        toast(`이후 입력 글꼴: ${f.label}`,1200);
    }

    function buildPop(id,colors,kind){
        const pop=document.getElementById(id);
        if(pop.dataset.ready==='1') return;
        const title=document.createElement('div');
        title.className='cp-title';
        title.textContent=kind==='text'?'글자 색':'형광펜 색';
        pop.appendChild(title);
        const grid=document.createElement('div'); grid.className='cp-grid';
        colors.forEach(c=>{
            const b=document.createElement('button');
            b.className='color-swatch'; b.style.background=c; b.dataset.c=c;
            b.onmousedown=e=>e.preventDefault();
            b.onclick=(e)=>{
                e.stopPropagation();
                if(kind==='text'){ currentTextColor=c; document.getElementById('tcBar').style.background=c; document.getElementById('tcGlyph').style.color=c; applyTextColor(c); }
                else { currentHlColor=c; document.getElementById('hlBar').style.background=c; applyHighlight(c); }
                pop.querySelectorAll('.color-swatch').forEach(s=>s.classList.toggle('sel',s.dataset.c===c));
                closePops();
            };
            grid.appendChild(b);
        });
        pop.appendChild(grid);
        const none=document.createElement('button');
        none.className='cp-none';
        none.innerHTML=kind==='text'?'<i class="ri-format-clear"></i> 자동(검정)':'<i class="ri-drop-line"></i> 색 없음';
        none.onmousedown=e=>e.preventDefault();
        none.onclick=(e)=>{ e.stopPropagation(); if(kind==='text') clearTextColor(); else applyHighlight(null); closePops(); };
        pop.appendChild(none);
        pop.dataset.ready='1';
    }
    function togglePop(id){
        const kind=id==='textColorPop'?'text':'hl';
        buildPop(id, kind==='text'?TEXT_COLORS:HL_COLORS, kind);
        const pop=document.getElementById(id);
        const other=document.getElementById(id==='textColorPop'?'hlPop':'textColorPop');
        other.classList.remove('show');
        const willShow=!pop.classList.contains('show');
        pop.classList.toggle('show',willShow);
        if(willShow){
            // 툴바의 overflow 에 잘리지 않도록 body 로 이동 + 버튼 아래에 고정 배치
            if(pop.parentElement!==document.body) document.body.appendChild(pop);
            const btn=document.getElementById(kind==='text'?'textColorWrap':'hlWrap');
            const r=btn.getBoundingClientRect();
            pop.style.left=Math.min(r.left, window.innerWidth-210)+'px';
            pop.style.top=(r.bottom+6)+'px';
        }
    }
    function closePops(){
        document.getElementById('textColorPop').classList.remove('show');
        document.getElementById('hlPop').classList.remove('show');
    }
    document.addEventListener('click',e=>{
        if(!e.target.closest('.split-btn')) closePops();
        if(!e.target.closest('.font-wrap')) closeFontMenu();
    });

    // 서식 연산의 공통 진입 래퍼. 저장해 둔 선택을 살려 fn 에게 host 를 넘기고,
    // 끝나면 저장 사슬(syncTextEl→saveDoc)과 선택·툴바 상태를 맞춘다.
    // 구버전이 여기서 하던 execCommand 보정(captureSelFonts/restoreSelFonts/
    // _keepFontOnSel)은 v2 엔진이 execCommand 를 아예 쓰지 않게 되어 필요 없어졌다.
    function withSelection(fn){
        const host=restoreSel();
        if(!host){ toast('텍스트를 드래그해 선택하세요',1300); return false; }
        fn(host);
        const w=host.closest('.tb');
        if(w) syncTextEl(w);
        saveSel();
        syncCurSel();
        return true;
    }
    // 14.13.4 · 글자 선택 없이 '상자'만 고른 상태 → 상자 전체에 서식을 칠할 대상
    function _boxFmtTargets(){
        let t=multiSel.length
            ? multiSel.map(m=>m.node).filter(n=>n&&n.classList&&n.classList.contains('tb')&&!n.classList.contains('latex-box'))
            : [];
        if(!t.length) t=Array.from(document.querySelectorAll('#pagesStage .tb.sel,#pagesStage .tb.msel,#pagesStage .tb.edit'))
            .filter(n=>!n.classList.contains('latex-box'));
        return t;
    }
    // ═══════════════════════════════════════════════════════════════════
    // 18.10 · SDY-FMT v2 — 인라인 서식 엔진 (2026-09 전면 재설계)
    //
    //   [구조를 갈아엎은 이유]
    //   구버전 엔진은 "선택 조각을 extractContents 로 떼어내고 → 새 span 으로
    //   감싸고 → _stripInlineProp 로 걷어내고 → _cleanupInline 로 치운다" 는
    //   수술형이었다. span 이 중첩될수록 '어느 조상이 어떤 속성을 담당하는지'
    //   상태가 꼬여서, 일부 글꼴을 바꾼 뒤 굵게가 안 먹히는 식의
    //   순서·환경 의존 버그가 계속 재발했다. execCommand 병행 경로와 그 오류를
    //   감싸는 보정(captureSelFonts·restoreSelFonts·_keepFontOnSel)까지 얹혀
    //   구조가 더 복잡해졌다.
    //
    //   [v2 · 선언형 재구축(rebuild)]
    //     1) 상자(.tb-content) 안 글자를 '문자 오프셋 지도'로 잰다.
    //     2) 편집 범위와 겹치는 문단(리프 블록)마다 토큰 스트림을 만든다.
    //        토큰 = 글자 세그먼트{텍스트, 유효 스타일, 링크} / <br> / <img> 같은
    //        원자 노드 / 빈 타이핑 마커 span(.sdy-type).
    //     3) 편집은 토큰의 스타일 사전을 고치는 것뿐이다. DOM 수술이 없다.
    //     4) 문단을 정규형으로 다시 그린다(_fmtRender): 유효 스타일이 같은 이웃
    //        세그먼트는 하나의 <span style="..."> 로 합친다. 링크는 <a> 로 감싸고,
    //        <br>·<img>·타이핑 마커는 원본 노드를 그대로 옮긴다.
    //     5) 문자 오프셋으로 선택(캐럿)을 복원한다(_fmtRestoreSelection).
    //
    //   - 같은 연산을 여러 번 겹쳐도 항상 평탄한 정규형으로 수렴한다(멱등).
    //     → "글꼴 바꾼 뒤 굵게가 안 먹힘" 같은 상태 누적 버그가 원천 차단된다.
    //   - 글자 서식에 execCommand 를 전혀 쓰지 않는다(브라우저/웹뷰 편차 제거).
    //   - 상자 전체 서식도 같은 경로(전체 범위 적용)라 특수 처리가 없다.
    //   - 굵게 해제 시에도 '상자 자체가 굵게'인 경우에만 중립값(400)을 적는다.
    //     평범한 글자는 속성을 삭제해 상속으로 되돌린다(font-weight:400 덧대기 제거).
    // ═══════════════════════════════════════════════════════════════════
    const FMT_PROPS=['fontWeight','fontStyle','textDecoration','color','backgroundColor','fontFamily','fontSize','verticalAlign'];
    const INLINE_STYLE_PROPS=FMT_PROPS;          // 하위 호환 이름
    const FMT_BLOCK_TAGS=new Set(['DIV','P','H1','H2','H3','H4','H5','H6','LI','BLOCKQUOTE','PRE','UL','OL','TABLE','TR','TD','TH','SECTION','ARTICLE']);
    function _isPosSpan(el){
        if(!el||el.nodeType!==1||el.tagName!=='SPAN') return false;
        if(el.dataset&&(el.dataset.pdfW!=null||el.dataset.fs!=null||el.dataset.origTop!=null)) return true;
        if(el.style&&(el.style.position==='absolute'||(el.style.left&&el.style.top))) return true;
        return false;
    }
    const FMT_ATOMIC_TAGS=new Set(['IMG','SVG','CANVAS','VIDEO','AUDIO','IFRAME','HR','INPUT','TEXTAREA','SELECT','BUTTON','OBJECT','EMBED']);
    let _fmtBusy=false;    // 재구축 중 selectionchange 가 저장 선택을 덮지 않게 하는 잠금

    // 의미 태그(b/i/u/s/mark)가 뜻하는 canonical 스타일
    function _tagStyle(tag){
        tag=String(tag||'').toUpperCase();
        if(tag==='B'||tag==='STRONG') return {fontWeight:'700'};
        if(tag==='I'||tag==='EM')     return {fontStyle:'italic'};
        if(tag==='U')                 return {textDecoration:'underline'};
        if(tag==='S'||tag==='STRIKE') return {textDecoration:'line-through'};
        if(tag==='MARK')              return {backgroundColor:'#ffff00'};
        if(tag==='SUB')               return {verticalAlign:'sub'};
        if(tag==='SUP')               return {verticalAlign:'super'};
        return null;
    }
    function _fwVal(v){
        v=String(v||'').toLowerCase();
        if(v==='bold'||v==='bolder') return 700;
        const n=parseInt(v,10);
        if(!isNaN(n)) return n;
        return 0;
    }
    function _propMatch(prop,actual,desired){
        actual=String(actual||'').toLowerCase();
        desired=String(desired||'').toLowerCase();
        if(!actual) return false;
        if(prop==='fontWeight'){
            const a=_fwVal(actual),d=_fwVal(desired);
            if(a>=600&&d>=600) return true;
            return a===d&&a>0;
        }
        if(prop==='textDecoration'){
            const toks=actual.split(/\s+/);
            return toks.indexOf(desired)>=0;
        }
        return actual===desired;
    }
    function _kebabProp(prop){ return String(prop||'').replace(/([A-Z])/g,'-$1').toLowerCase(); }
    // prop=value 를 요소 style 에 적는다 (textDecoration 은 토큰 병합)
    function _setInlineProp(el,prop,value){
        if(!el||!el.style) return;
        if(prop==='textDecoration'){
            const toks=String(value||'').split(/\s+/).filter(t=>t&&t!=='none');
            el.style.textDecoration=[...new Set(toks)].join(' ');
        }else{
            el.style[prop]=value;
        }
    }
    // 요소 style 에서 prop 을 지운다 (textDecoration 토큰 제거 지원)
    function _clearInlineProp(el,prop,value){
        if(!el||!el.style) return;
        if(prop==='textDecoration'&&value){
            const toks=String(el.style.textDecoration||'').split(/\s+/).filter(t=>t&&t!==value);
            if(toks.length) el.style.textDecoration=toks.join(' ');
            else el.style.removeProperty('text-decoration');
            return;
        }
        const kebab=_kebabProp(prop);
        try{ el.style.removeProperty(kebab); }catch(e){}
        try{ el.style[prop]=''; }catch(e){}
    }

    // ── 경계(boundary) 아래 인라인 조상들만의 유효 스타일 ──────────────
    //   재구축 시 세그먼트에 '다시 선언할' 속성만 모은다. 상자(.tb-content)
    //   레벨 스타일은 여기에 넣지 않는다 — 상자 글꼴/크기는 상속으로 그대로
    //   흘러야 나중에 '상자 전체 글꼴 바꾸기'가 막히지 않는다. (18.8 규칙 유지)
    function _fmtChainStyle(tn,boundary){
        const styles={};
        const chain=[];
        let p=tn.parentElement;
        while(p&&p!==boundary){ if(p.nodeType===1) chain.push(p); p=p.parentElement; }
        for(let i=chain.length-1;i>=0;i--){
            const el=chain[i];
            const t=_tagStyle(el.tagName);
            if(t) for(const k in t) if(!(k in styles)) styles[k]=t[k];
            if(el.style) for(const k of FMT_PROPS){ const v=el.style[k]; if(v&&!(k in styles)) styles[k]=v; }
            if(el.tagName==='FONT'&&el.getAttribute){
                const face=el.getAttribute('face'); if(face&&!styles.fontFamily) styles.fontFamily=face;
                const fc=el.getAttribute('color'); if(fc&&!styles.color) styles.color=fc;
            }
        }
        return styles;
    }
    // 텍스트 노드에 상속되는 유효 스타일 (상자 레벨 포함) — 판정/표시용.
    // 구버전과 같은 시맨틱을 유지해 툴바 상태·토글 판정이 그대로 동작한다.
    function _inheritedStyles(tn,host){
        const styles=_fmtChainStyle(tn,host);
        let link=null;
        let p=tn.parentElement;
        while(p&&p!==host){ if(p.nodeType===1&&p.tagName==='A'&&!link) link=p; p=p.parentElement; }
        if(host&&host.nodeType===1&&host.style){
            for(const k of FMT_PROPS){
                if(!(k in styles)){
                    const v=host.style[k];
                    if(v) styles[k]=v;
                }
            }
        }
        return {styles,link};
    }

    // ── 선택/범위 기본 도구 ─────────────────────────────────────────
    function _selContacts(r){
        const out=[];
        if(!r) return out;
        const root=r.commonAncestorContainer;
        const walkRoot=root.nodeType===3?root.parentNode:root;
        if(!walkRoot) return out;
        try{
            const tw=document.createTreeWalker(walkRoot,NodeFilter.SHOW_TEXT);
            let n;
            while(n=tw.nextNode()){
                if(!r.intersectsNode(n)) continue;
                let s=0,e=n.nodeValue.length;
                if(r.startContainer===n) s=r.startOffset;
                if(r.endContainer===n) e=r.endOffset;
                if(s>=e) continue;
                out.push({node:n,s,e});
            }
        }catch(e){}
        return out;
    }
    function _selectionCtx(){
        const s=window.getSelection();
        if(!s||s.isCollapsed||!s.rangeCount) return null;
        const r=s.getRangeAt(0);
        const root=r.commonAncestorContainer;
        const el=root.nodeType===1?root:root.parentElement;
        const host=el&&el.closest&&el.closest('.tb-content');
        if(!host) return null;
        try{
            const sc=r.startContainer.nodeType===1?r.startContainer:r.startContainer.parentElement;
            const ec=r.endContainer.nodeType===1?r.endContainer:r.endContainer.parentElement;
            if((sc&&!host.contains(sc)&&sc!==host)||(ec&&!host.contains(ec)&&ec!==host)) return null;
        }catch(e){}
        return {sel:s,range:r,host};
    }

    // ── ① 문자 오프셋 지도 ─────────────────────────────────────────
    //   host 안 모든 텍스트 노드를 문서 순으로 [start,end) 절대 오프셋과 함께.
    function _fmtTextMap(host){
        const map=[]; let off=0;
        try{
            const tw=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);
            let n;
            while(n=tw.nextNode()){
                const len=String(n.nodeValue||'').length;
                if(len>0){ map.push({node:n,start:off,end:off+len}); off+=len; }
            }
        }catch(e){}
        map.total=off;
        return map;
    }
    function _fmtTextLen(host){ return _fmtTextMap(host).total; }
    // '어떤 지점(컨테이너,오프셋)' → host 기준 문자 오프셋.
    //   지점~host 끝까지의 텍스트 길이를 재서 total 에서 빼는 방식이라
    //   요소 경계/텍스트 중간 어디서 시작해도 정확하다.
    function _fmtOffsetAt(host,container,offset){
        try{
            const total=_fmtTextLen(host);
            const r=document.createRange();
            r.setStart(container,offset);
            r.setEnd(host,host.childNodes.length);
            const tail=String(r.toString()).length;
            return Math.max(0,total-tail);
        }catch(e){ return 0; }
    }
    function _fmtOffsets(host,range){
        const start=_fmtOffsetAt(host,range.startContainer,range.startOffset);
        let end=_fmtOffsetAt(host,range.endContainer,range.endOffset);
        if(end<start) end=start;
        return {start,end};
    }
    // 문자 오프셋 → (노드,노드오프셋). 경계에서는 '다음 글자의 시작'을 택해
    // 뒤이어 입력할 글자가 앞 서식 span 안으로 들어가지 않게 한다.
    function _fmtPointFromOffset(host,offset){
        const map=_fmtTextMap(host);
        for(const t of map){
            if(offset<t.end) return {node:t.node,offset:offset-t.start};
        }
        const last=map[map.length-1];
        if(last) return {node:last.node,offset:last.node.nodeValue.length};
        return {node:host,offset:host.childNodes.length};
    }
    function _fmtRestoreSelection(host,start,end){
        try{
            const a=_fmtPointFromOffset(host,start), b=_fmtPointFromOffset(host,end);
            const nr=document.createRange();
            nr.setStart(a.node,a.offset);
            nr.setEnd(b.node,b.offset);
            const s=window.getSelection();
            s.removeAllRanges(); s.addRange(nr);
            savedRange=nr.cloneRange(); savedHost=host;
        }catch(e){}
    }

    // ── ② 리프 블록(문단) 찾기 ─────────────────────────────────────
    //   텍스트 노드가 속한 '가장 안쪽 블록'. 블록이 없으면 host 자체(암시 영역).
    function _fmtLeafBlock(node,host){
        let p=(node.nodeType===3)?node.parentElement:node;
        while(p&&p!==host){
            if(FMT_BLOCK_TAGS.has(p.tagName)||_isPosSpan(p)) return p;
            p=p.parentElement;
        }
        return host;
    }
    // [start,end) 와 글자가 겹치는 리프 블록들을 문서 순으로 그룹핑.
    //   host 암시 영역은 블록 요소 사이의 '연속 구간'마다 별개 그룹이 된다.
    function _fmtGroups(host,map,start,end){
        const groups=[];
        for(const t of map){
            if(t.end<=start||t.start>=end) continue;
            const blk=_fmtLeafBlock(t.node,host);
            const g=groups[groups.length-1];
            if(g&&g.el===blk) g.last=t.node;
            else groups.push({el:blk,first:t.node,last:t.node});
        }
        return groups;
    }

    // ── ③ 문단 토큰화 ──────────────────────────────────────────────
    //   block 하위를 문서 순으로 walk 해 토큰 스트림을 만든다.
    //   block===host 이면 다른 블록 요소 안으로는 내려가지 않는다(암시 영역만).
    function _fmtTokens(block,host){
        const tokens=[];
        (function walk(el,link){
            for(let k=el.firstChild;k;k=k.nextSibling){
                if(k.nodeType===3){ tokens.push({t:'text',node:k,link:link||null}); continue; }
                if(k.nodeType!==1) continue;
                const tag=k.tagName;
                if(block===host&&(FMT_BLOCK_TAGS.has(tag)||_isPosSpan(k))) continue;
                if(tag==='BR'){ tokens.push({t:'br',node:k}); continue; }
                if(FMT_ATOMIC_TAGS.has(tag)){ tokens.push({t:'atom',node:k,link:link||null}); continue; }
                const hasInner=!!(String(k.textContent||'').length
                    ||(k.querySelector&&k.querySelector('img,br,svg,canvas,video,audio,iframe,hr')));
                if(!hasInner){
                    // 빈 span. 입력 대기 마커(.sdy-type)만 원자 토큰으로 살려 둔다.
                    if(k.classList&&k.classList.contains('sdy-type')) tokens.push({t:'type',node:k});
                    continue;
                }
                walk(k, tag==='A'?k:(link||null));
            }
        })(block,null);
        return tokens;
    }

    // ── ④ 세그먼트 편집 + 정규형 렌더 ──────────────────────────────
    function _fmtStyleKey(style){
        const keys=Object.keys(style||{}).filter(k=>String(style[k]||'').trim()!=='');
        keys.sort();
        return keys.map(k=>k+'='+_normComparable(k,style[k])).join('|');
    }
    function _fmtLinkKey(l){
        if(!l) return '';
        return l.el
            ? 'E|'+(l.el.getAttribute('href')||'')+'|'+(l.el.getAttribute('target')||'')
            : 'N|'+(l.href||'')+'|'+(l.target||'');
    }
    function _fmtLinkClone(l){
        let a;
        if(l&&l.el&&l.el.cloneNode) a=l.el.cloneNode(false);
        else{
            a=document.createElement('a');
            a.setAttribute('href',(l&&l.href)||'#');
            a.setAttribute('target',(l&&l.target)||'_blank');
            a.setAttribute('rel',(l&&l.rel)||'noopener');
        }
        return a;
    }
    // 토큰(이미 편집 완료된 세그먼트) → DOM. 같은 스타일+같은 링크의 이웃
    // 세그먼트는 하나의 text node(+span)로 합쳐 span 이 누적되지 않는다.
    function _fmtRender(tokens){
        const frag=document.createDocumentFragment();
        const flush=grp=>{
            if(!grp) return;
            let parent=frag;
            if(grp.link){ const a=_fmtLinkClone(grp.link); frag.appendChild(a); parent=a; }
            const style=grp.style||{};
            const cssKeys=Object.keys(style).filter(k=>String(style[k]||'').trim()!=='');
            const tn=document.createTextNode(grp.texts.join(''));
            if(cssKeys.length){
                const sp=document.createElement('span');
                // CSSOM 으로 적는다 — setAttribute 문자열 대신 쓰면 브라우저·jsdom 이
                // 같은 방식으로 값을 정규화·직렬화한다(#fff59d → rgb(255,245,157) 등).
                for(const k of cssKeys){
                    try{ sp.style.setProperty(_kebabProp(k),String(style[k]).trim()); }catch(_e){}
                }
                sp.appendChild(tn);
                parent.appendChild(sp);
            }else parent.appendChild(tn);
        };
        let grp=null;
        for(const tk of tokens){
            if(tk.t==='text'){
                const key=_fmtStyleKey(tk.style)+'\u0000'+_fmtLinkKey(tk.link);
                if(grp&&grp.key===key){ grp.texts.push(tk.text); continue; }
                flush(grp);
                grp={key,style:tk.style,link:tk.link,texts:[tk.text]};
            }else{
                flush(grp); grp=null;
                const n=tk.node;
                if(tk.link){ const a=_fmtLinkClone(tk.link); a.appendChild(n); frag.appendChild(a); }
                else frag.appendChild(n);
            }
        }
        flush(grp);
        return frag;
    }

    // 문단 하나를 다시 그린다. op 는 {type:'set'|'remove'|'clear'|'link'|'unlink', ...}
    function _fmtRebuildBlock(host,g,map,start,end,op){
        const block=g.el;
        const isHost=(block===host);
        let tokens=_fmtTokens(block,host);
        const byNode=new Map();
        for(const t of map) byNode.set(t.node,t);
        for(const tk of tokens){
            if(tk.t!=='text') continue;
            const m=byNode.get(tk.node);
            tk.start=m?m.start:0;
            tk.end=tk.start+String(tk.node.nodeValue||'').length;
            tk.style=_fmtChainStyle(tk.node,block);   // 상자(블록) 레벨 스타일은 재선언하지 않는다
        }
        let kids=null,i0=0,i1=-1;
        if(isHost){
            // 암시 영역: 이 그룹이 속한 '연속된 비블록 구간(암시 문단)' 전체를
            //   다시 그린다. 선택된 글자의 직계 범위만 바꾸면 문단 나머지 글자가
            //   밖에 고립돼 이웃 세그먼트와 합쳐지지 않은 채 남는다.
            kids=Array.from(host.childNodes);
            const topIdx=n=>{
                let p=n;
                while(p&&p.parentNode!==host) p=p.parentNode;
                return kids.indexOf(p);
            };
            const isBlk=n=>n.nodeType===1&&(FMT_BLOCK_TAGS.has(n.tagName)||_isPosSpan(n));
            i0=topIdx(g.first); i1=topIdx(g.last);
            if(i0<0||i1<0||i1<i0) return false;
            while(i0>0&&!isBlk(kids[i0-1])) i0--;
            while(i1<kids.length-1&&!isBlk(kids[i1+1])) i1++;
            tokens=tokens.filter(tk=>{ const i=topIdx(tk.node); return i>=i0&&i<=i1; });
        }
        // 세그먼트 분할 + 연산 적용
        const out=[];
        for(const tk of tokens){
            if(tk.t!=='text'){ out.push(tk); continue; }
            const s=tk.start,e=tk.end,v=String(tk.node.nodeValue||'');
            if(e<=s||!v) continue;
            if(e<=start||s>=end){
                out.push({t:'text',text:v,style:tk.style,link:tk.link});
                continue;
            }
            const a=Math.max(s,start), b=Math.min(e,end);
            if(a>s) out.push({t:'text',text:v.slice(0,a-s),style:tk.style,link:tk.link});
            const st=Object.assign({},tk.style);
            let lk=tk.link;
            if(op.type==='set'||op.type==='setbox'){
                const had=Object.prototype.hasOwnProperty.call(st,op.prop);
                if(op.prop==='textDecoration'){
                    // 밑줄+취소선처럼 여러 토큰이 한 세그먼트에 공존한다 (토큰 병합)
                    const toks=new Set(String(st.textDecoration||'').split(/\s+/).filter(t=>t&&t!=='none'));
                    String(op.value||'').split(/\s+/).filter(t=>t&&t!=='none').forEach(t=>toks.add(t));
                    st.textDecoration=[...toks].join(' ');
                }else{
                    st[op.prop]=op.value;
                }
                if(op.type==='setbox'&&!had){
                    // setbox(상자 전체 값 교체)는 인라인 오버라이드가 없던 글자를
                    // 새로 만들지 않는다 — 상자 값 상속을 유지하기 위함.
                    delete st[op.prop];
                }
            }
            else if(op.type==='remove'){
                if(op.prop==='textDecoration'&&op.value){
                    const toks=String(st.textDecoration||'').split(/\s+/).filter(t=>t&&t!==op.value);
                    if(toks.length) st.textDecoration=toks.join(' ');
                    else delete st.textDecoration;
                }
                else if(op.neutral) st[op.prop]=op.neutral;   // 상자 상속을 끊는 명시적 중립값
                else delete st[op.prop];
            }
            else if(op.type==='clear'){ FMT_PROPS.forEach(p=>{ delete st[p]; }); }
            else if(op.type==='unlink') lk=null;
            else if(op.type==='link') lk={href:op.href,target:'_blank',rel:'noopener'};
            out.push({t:'text',text:v.slice(a-s,b-s),style:st,link:lk});
            if(b<e) out.push({t:'text',text:v.slice(b-s),style:tk.style,link:tk.link});
        }
        // 타이핑 마커 span 도 연산을 함께 받는다 (다음 입력 글자의 서식 유지)
        if(op&&op.type!=='unlink'&&op.type!=='link'){
            out.forEach(tk=>{
                if(tk.t!=='type') return;
                if(op.type==='set') _setInlineProp(tk.node,op.prop,op.value);
                else if(op.type==='remove') _clearInlineProp(tk.node,op.prop,op.value);
                else if(op.type==='clear') FMT_PROPS.forEach(p=>_clearInlineProp(tk.node,p,''));
            });
        }
        const frag=_fmtRender(out);
        // 다시 끼우기
        if(isHost){
            const ref=kids[i1+1]||null;
            for(let i=i0;i<=i1;i++){ if(kids[i].parentNode===host) host.removeChild(kids[i]); }
            host.insertBefore(frag,ref);
        }else{
            while(block.firstChild) block.removeChild(block.firstChild);
            block.appendChild(frag);
        }
        return true;
    }

    // ── ⑤ 실행기 ───────────────────────────────────────────────────
    //   범위 연산 (선택 복원 없음 — 상자 전체/맞춤 검사 등에서 사용)
    function _fmtRunRange(host,start,end,op){
        if(!host||end<=start) return false;
        const map=_fmtTextMap(host);
        if(!map.total) return false;
        const groups=_fmtGroups(host,map,start,end);
        if(!groups.length) return false;
        _fmtBusy=true;
        try{
            groups.forEach(g=>_fmtRebuildBlock(host,g,map,start,end,op));
        }finally{ _fmtBusy=false; }
        return true;
    }
    //   현재 선택 구간 연산 + 선택 복원
    function _fmtApply(op){
        const ctx=_selectionCtx();
        if(!ctx) return false;
        const host=ctx.host;
        const o=_fmtOffsets(host,ctx.range);
        if(o.end<=o.start) return false;
        const map=_fmtTextMap(host);
        const groups=_fmtGroups(host,map,o.start,o.end);
        if(!groups.length) return false;
        _fmtBusy=true;
        try{
            groups.forEach(g=>_fmtRebuildBlock(host,g,map,o.start,o.end,op));
            _fmtRestoreSelection(host,o.start,o.end);
        }finally{ _fmtBusy=false; }
        return true;
    }
    //   굵게/기울임 '해제'가 상자 레벨 상속과 충돌할 때만 중립값을 쓴다.
    function _fmtNeutralFor(host,prop){
        if(!host||!host.style) return '';
        if(prop==='fontWeight'&&_fwVal(host.style.fontWeight)>=600) return '400';
        if(prop==='fontStyle'&&String(host.style.fontStyle||'').toLowerCase()==='italic') return 'normal';
        return '';
    }

    // ── ⑥ 선택 구간 공개 API (기존 호출부와 이름 호환) ─────────────
    function _applyToSelection(prop,value){
        return _fmtApply({type:'set',prop,value});
    }
    function _removeFromSelection(prop,value){
        const ctx=_selectionCtx();
        const neutral=ctx?_fmtNeutralFor(ctx.host,prop):'';
        return _fmtApply({type:'remove',prop,value:String(value||''),neutral});
    }
    // 선택 영역이 전부 해당 스타일인가? (토글 off 판정)
    function _selHasAll(prop,value){
        const s=window.getSelection();
        if(!s||s.isCollapsed||!s.rangeCount) return false;
        const r=s.getRangeAt(0);
        const hostEl=r.commonAncestorContainer.nodeType===1?r.commonAncestorContainer:r.commonAncestorContainer.parentElement;
        const host=hostEl&&hostEl.closest&&hostEl.closest('.tb-content');
        if(!host) return false;
        const contacts=_selContacts(r);
        if(!contacts.length) return false;
        for(const c of contacts){
            const {styles}=_inheritedStyles(c.node,host);
            if(!_propMatch(prop,styles[prop]||'',value)) return false;
        }
        return true;
    }
    // 선택 영역이 하나라도 해당 스타일을 갖고 있는가?
    function _selHasAny(prop,value){
        const s=window.getSelection();
        if(!s||s.isCollapsed||!s.rangeCount) return false;
        const r=s.getRangeAt(0);
        const hostEl=r.commonAncestorContainer.nodeType===1?r.commonAncestorContainer:r.commonAncestorContainer.parentElement;
        const host=hostEl&&hostEl.closest&&hostEl.closest('.tb-content');
        if(!host) return false;
        const contacts=_selContacts(r);
        for(const c of contacts){
            const {styles}=_inheritedStyles(c.node,host);
            if(_propMatch(prop,styles[prop]||'',value)) return true;
        }
        return false;
    }
    // 워드프로세서 규칙: 전부 켜져 있으면 끄고, 아니면 (부분이든) 켠다.
    // v2 재구축이라 '일부만 적용된 상태에서 켜기'도 항상 통일된 결과를 낸다.
    function toggleSelStyle(prop,value){
        const all=_selHasAll(prop,value);
        if(all) _removeFromSelection(prop,value);
        else _applyToSelection(prop,value);
        syncCurSel();
    }
    function wrapSelStyle(prop,value){
        try{ _applyToSelection(prop,value); }catch(e){}
        syncCurSel();
    }
    function clearSelStyle(prop){
        try{ _removeFromSelection(prop); }catch(e){}
        syncCurSel();
    }
    function clearSelBg(){
        try{ _removeFromSelection('backgroundColor'); }catch(e){}
        syncCurSel();
    }
    // 선택 영역에서 글자색 제거 (상속으로 되돌리기)
    function clearSelColor(){
        try{ _removeFromSelection('color'); }catch(e){}
        syncCurSel();
    }

    // ── ⑦ 링크 ─────────────────────────────────────────────────────
    //   execCommand(createLink/unlink) 없이 엔진 경로 하나로 처리한다.
    //   링크 중간 일부만 골라 해제해도 그 조각만 벗겨진다.
    function _fmtLinkSelection(href){
        return _fmtApply({type:'link',href:String(href||'')});
    }
    function _unlinkSelection(){
        return _fmtApply({type:'unlink'});
    }

    // ── ⑧ 문단 정렬 ────────────────────────────────────────────────
    //   execCommand(justify*) 대신 대상 블록에 text-align 을 직접 적는다.
    function _fmtAlignRange(host,start,end,dir){
        if(!host) return false;
        const map=_fmtTextMap(host);
        const blocks=new Set();
        for(const t of map){
            if(t.end<=start||t.start>=end) continue;
            blocks.add(_fmtLeafBlock(t.node,host));
        }
        if(!blocks.size) return false;
        blocks.forEach(b=>{
            b.style.textAlign=dir;
            if(b===host){
                // 암시 영역(블록 요소 없이 상자에 바로 든 글)은 상자 정렬로 기록
                const w=b.closest&&b.closest('.tb');
                const el=w?findEl(+w.dataset.pageIdx,w.dataset.id):null;
                if(el) el.align=dir;
            }
        });
        return true;
    }
    function _fmtAlignSelection(dir){
        const ctx=_selectionCtx();
        if(!ctx) return false;
        const o=_fmtOffsets(ctx.host,ctx.range);
        return _fmtAlignRange(ctx.host,o.start,o.end,dir);
    }

    // ── ⑨ 상자 전체 연산 (선택 없이 상자만 골랐을 때) ──────────────
    //   구버전의 _applyOne/_removeOne 루프+걷어내기를 버리고, 엔진의 전체
    //   범위 적용 하나로 통일했다. 부분 서식(span)이 있어도 문단 정규형으로
    //   다시 그려지므로 덮어쓰기/보존이 항상 정확하다.
    function _fmtUnpaintWF(host){
        // 중요어 색칠(.wf)은 저장되지 않는 임시 레이어다. 서식 연산 전에 원문으로
        // 되돌려 색칠 span 이 서식 결과에 섞이지 않게 한다(enterEdit 과 같은 규칙).
        try{
            if(host.querySelector&&host.querySelector('.wf')){
                const w=host.closest&&host.closest('.tb');
                const el=w?findEl(+w.dataset.pageIdx,w.dataset.id):null;
                if(el) host.innerHTML=el.html||'';
            }
        }catch(e){}
    }
    function _fmtApplyBox(c,prop,value,override){
        if(!c) return false;
        _fmtUnpaintWF(c);
        // override=true : 상자 전체 값(글꼴·크기) 변경 — 이미 인라인 오버라이드가
        //   있는 부분만 갱신하고 나머지는 상자 값 상속을 유지한다.
        // override=false : 상자 전체 덧칠(굵게·색 등) — 모든 글자에 값을 심는다.
        const type=override?'setbox':'set';
        return _fmtRunRange(c,0,_fmtTextLen(c),{type,prop,value});
    }
    function _fmtRemoveBox(c,prop,value){
        if(!c) return false;
        _fmtUnpaintWF(c);
        return _fmtRunRange(c,0,_fmtTextLen(c),{type:'remove',prop,value:String(value||''),neutral:''});
    }

    // ── 값 정규화 비교 (툴바 표시·토글 판정이 쓰는 공용 도구) ──────
    function _normFontCSS(v){
        return String(v||'').toLowerCase().replace(/["']/g,'').replace(/\s*,\s*/g,',').replace(/\s+/g,' ').trim();
    }
    function _fontIdFromCSS(css){
        const n=_normFontCSS(css);
        if(!n) return '';
        const f=FONTS.find(x=>_normFontCSS(x.css)===n || n.indexOf(_normFontCSS(x.css).split(',')[0])===0);
        return f?f.id:'';
    }
    function _colorToHex(v){
        v=String(v||'').trim().toLowerCase();
        if(!v||v==='inherit'||v==='initial') return '';
        if(v==='transparent'||v==='rgba(0, 0, 0, 0)'||v==='rgba(0,0,0,0)') return 'transparent';
        if(/^#[0-9a-f]{3}$/i.test(v)) return '#'+v.slice(1).split('').map(ch=>ch+ch).join('').toLowerCase();
        if(/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
        const m=v.match(/^rgba?\(([^)]+)\)$/i);
        if(m){
            const parts=m[1].split(',').map(x=>x.trim());
            if(parts.length>=4 && parseFloat(parts[3])===0) return 'transparent';
            const nums=parts.slice(0,3).map(x=>Math.max(0,Math.min(255,parseInt(x,10)||0)));
            return '#'+nums.map(n=>n.toString(16).padStart(2,'0')).join('');
        }
        return v;
    }
    function _normComparable(prop,v){
        if(prop==='color'||prop==='backgroundColor') return _colorToHex(v);
        if(prop==='fontFamily') return _normFontCSS(v);
        if(prop==='fontSize'){
            const n=parseFloat(v); return isNaN(n)?String(v||'').trim().toLowerCase():String(Math.round(n*100)/100)+'px';
        }
        if(prop==='fontWeight') return _fwVal(v)>=600?'700':String(v||'').trim().toLowerCase();
        if(prop==='textDecoration'){
            return String(v||'').toLowerCase().split(/\s+/).filter(t=>t&&t!=='none').sort().join(' ');
        }
        return String(v||'').trim().toLowerCase();
    }
    // 선택한 모든 글자가 한 속성값을 공유하는가? (툴바에 단일 값으로 표시할지 판정)
    function _selUniformStyle(prop){
        const ctx=_selectionCtx();
        if(!ctx) return {ok:false};
        const contacts=_selContacts(ctx.range);
        if(!contacts.length) return {ok:false};
        let firstNorm=null, firstVal='', any=false;
        for(const c of contacts){
            const seg=String(c.node.nodeValue||'').slice(c.s,c.e);
            if(!seg.length) continue;
            const {styles}=_inheritedStyles(c.node,ctx.host);
            let v=styles[prop]||'';
            if((prop==='fontFamily'||prop==='fontSize'||prop==='color') && !v && ctx.host.style) v=ctx.host.style[prop]||'';
            const norm=_normComparable(prop,v);
            if(!any){ firstNorm=norm; firstVal=v; any=true; }
            else if(norm!==firstNorm) return {ok:false,mixed:true};
        }
        return any?{ok:true,value:firstVal,norm:firstNorm}:{ok:false};
    }

    // ── ⑩ 정규화 (기존 _cleanupInline 역할) ────────────────────────
    //   스크립트가 만든 DOM(붙여넣기 등)의 빈 span/빈 서식 태그를 풀고
    //   인접 텍스트 노드를 합친다. 본격적인 정규형 병합은 엔진 재구축이 한다.
    function _cleanupInline(host){
        if(!host||!host.querySelectorAll) return;
        const toRemove=[];
        host.querySelectorAll('span,b,strong,i,em,u,s,strike,mark,font').forEach(el=>{
            if(!el.textContent&&!el.querySelector('img,br,svg,canvas')){ toRemove.push(el); return; }
            if(el.tagName==='SPAN'){
                const style=el.getAttribute('style')||'';
                if(!style.trim()&&!el.getAttribute('class')){
                    const p=el.parentNode;
                    while(el.firstChild) p.insertBefore(el.firstChild,el);
                    toRemove.push(el);
                }
            }
        });
        toRemove.forEach(el=>{ if(el.parentNode) el.parentNode.removeChild(el); });
        try{ host.normalize(); }catch(e){}
    }
    // 선택 영역의 현재 스타일 상태를 툴바 버튼에 반영
    // 18.7 · '지금 서식'을 판단하는 대상: ① 실제 글자 선택 → 선택 전체가 같은가,
    //   없으면 ② 편집 중 캐럿(앞으로 입력될 글자) ③ 선택된 텍스트 상자 전체.
    //   아무것도 아니면 전부 꺼진 상태로 정리한다. (보고 이슈⑥)
    function _activeToggleStates(){
        // ② 캐럿(선택 없음) → 앞으로 입력될 글자 기준
        if(_typingHost()){
            return {
                bold:_caretHasStyle('fontWeight','700'),
                italic:_caretHasStyle('fontStyle','italic'),
                underline:_caretHasStyle('textDecoration','underline'),
                strike:_caretHasStyle('textDecoration','line-through'),
            };
        }
        // ③ 선택된/편집 중 텍스트 상자 → 상자 전체 서식 기준
        let node=null;
        if(selected&&selected.type==='text'&&selected.el) node=selected.el;
        if(!node&&multiSel.length===1) node=multiSel[0].node;
        if(!node) node=document.querySelector('#pagesStage .tb.edit,#pagesStage .tb.sel,#pagesStage .tb.msel');
        if(node&&node.classList&&node.classList.contains('tb')){
            const pageIdx=+node.dataset.pageIdx, id=node.dataset.id;
            const el=(!isNaN(pageIdx)&&id)?findEl(pageIdx,id):null;
            const c=node.querySelector('.tb-content');
            // 상자 단위 서식은 wrapper(.tb)가 아니라 실제 글자가 있는 .tb-content
            // 또는 글자별 span 에 남는다. 예전엔 node.style 만 봐서 상자 전체를
            // 굵게/기울임/밑줄로 만든 뒤 다시 선택하면 툴바 불이 꺼져 보였다.
            const fw=el&&el.fontWeight?el.fontWeight:(c&&c.style?c.style.fontWeight:'');
            const fst=el&&el.fontStyle?el.fontStyle:(c&&c.style?c.style.fontStyle:'');
            const dec=el&&el.textDecoration?el.textDecoration:(c&&c.style?c.style.textDecoration:'');
            return {
                bold:_propMatch('fontWeight',fw,'700') || _boxHasAllStyle(node,'fontWeight','700'),
                italic:_propMatch('fontStyle',fst,'italic') || _boxHasAllStyle(node,'fontStyle','italic'),
                underline:_propMatch('textDecoration',dec,'underline') || _boxHasAllStyle(node,'textDecoration','underline'),
                strike:_propMatch('textDecoration',dec,'line-through') || _boxHasAllStyle(node,'textDecoration','line-through'),
            };
        }
        return {bold:false,italic:false,underline:false,strike:false};
    }
    // 18.8 · 캐럿(앞으로 입력될 글자) 자리에서 실제로 먹고 있는 인라인 스타일 값
    function _caretStyleValue(prop){
        try{
            const t=_typingHost(); if(!t) return '';
            let p=t.r.startContainer;
            p=(p&&p.nodeType===3)?p.parentElement:p;
            while(p&&p!==t.c){
                if(p.style&&p.style[prop]) return p.style[prop];
                if(prop==='fontFamily'&&p.tagName==='FONT'&&p.getAttribute('face')) return p.getAttribute('face');
                p=p.parentElement;
            }
            if(t.c&&t.c.style&&t.c.style[prop]) return t.c.style[prop];
        }catch(e){}
        return '';
    }
    // 18.8 · "툴바에 보이는 글꼴·크기 = 지금 입력되는 글꼴·크기" 를 지킨다.
    //   글자 선택이 없을 때(캐럿 / 상자 선택)의 툴바 동기화 담당.
    function syncToolbarFromCaret(){
        try{
            const t=_typingHost();
            if(t){
                const fam=_caretStyleValue('fontFamily');
                const fid=fam?_fontIdFromCSS(fam):'';
                if(fid) setToolbarFont(fid);
                else{
                    // 상자 자체 글꼴(el.font)이 기준
                    const w=t.c&&t.c.closest?t.c.closest('.tb'):null;
                    const el=w?findEl(+w.dataset.pageIdx,w.dataset.id):null;
                    if(el&&el.font) setToolbarFont(el.font);
                }
                const fs=parseFloat(_caretStyleValue('fontSize'));
                if(fs) setToolbarFS(fs);
                return true;
            }
            // 캐럿이 없으면 '고른 상자' 기준
            syncFSFromTarget();
            return true;
        }catch(e){}
        return false;
    }
    function syncCurSel(){
        try{
            const ctx=_selectionCtx();
            const btnOn=(sel,on)=>{
                const b=document.querySelector(sel);
                if(b) b.classList.toggle('active',!!on);
            };
            if(!ctx){
                // 텍스트(글자) 선택이 없는 화면 → 눌려 있던 서식 버튼을 정리한다.
                //   사용자 이전 설정(글꼴·크기·색·형광펜)은 유지하되, '켜짐' 상태만
                //   실제 캐럿/상자 서식에 맞춘다. (보고 이슈⑥)
                const st=_activeToggleStates();
                btnOn('.tb-bold',st.bold);
                btnOn('.tb-italic',st.italic);
                btnOn('.tb-under',st.underline);
                btnOn('.tb-strike',st.strike);
                // 18.8 · 글꼴·크기는 '지금 입력될 자리' 기준으로 계속 맞춘다.
                syncToolbarFromCaret();
                return;
            }
            // 선택한 모든 글자가 같은 속성을 공유할 때만 툴바에 단일 값으로 표시한다.
            // 섞여 있으면 기존 선택값을 그대로 두어 잘못된 단일 값 표시를 피한다.
            const states={
                bold:_selHasAll('fontWeight','700'),
                italic:_selHasAll('fontStyle','italic'),
                underline:_selHasAll('textDecoration','underline'),
                strike:_selHasAll('textDecoration','line-through'),
            };
            btnOn('.tb-bold',states.bold);
            btnOn('.tb-italic',states.italic);
            btnOn('.tb-under',states.underline);
            btnOn('.tb-strike',states.strike);

            const fU=_selUniformStyle('fontFamily');
            if(fU.ok && fU.norm){
                const id=_fontIdFromCSS(fU.value||fU.norm);
                if(id) setToolbarFont(id);
            }
            const fsU=_selUniformStyle('fontSize');
            if(fsU.ok && fsU.norm){
                const n=parseFloat(fsU.value||fsU.norm);
                if(!isNaN(n)){
                    curFontSize=Math.round(n);
                    const inp=document.getElementById('fsInput');
                    if(inp){ inp.value=curFontSize; inp.classList.remove('mixed'); inp.removeAttribute('aria-label'); }
                }
            }else if(fsU.mixed){
                // Word처럼 선택 범위에 서로 다른 크기가 있으면 임의의 한 값을
                // 보여 주지 않고 '-'로 표시한다. curFontSize는 유지해 +/- 동작의
                // 기준값을 잃지 않으며, 사용자가 숫자를 입력하면 즉시 단일 크기로 바뀐다.
                const inp=document.getElementById('fsInput');
                if(inp&&document.activeElement!==inp){
                    inp.value='-'; inp.classList.add('mixed');
                    inp.setAttribute('aria-label','여러 글자 크기가 선택됨');
                }
            }
            const cU=_selUniformStyle('color');
            if(cU.ok){
                const hex=_colorToHex(cU.value||cU.norm)||'#000000';
                if(hex&&hex!=='transparent'){
                    currentTextColor=hex;
                    const bar=document.getElementById('tcBar'), glyph=document.getElementById('tcGlyph');
                    if(bar) bar.style.background=hex;
                    if(glyph) glyph.style.color=hex;
                    document.querySelectorAll('#textColorPop .color-swatch').forEach(n=>n.classList.toggle('sel',_colorToHex(n.dataset.c)===hex));
                }
            }
            const hU=_selUniformStyle('backgroundColor');
            if(hU.ok){
                const hex=_colorToHex(hU.value||hU.norm);
                const bar=document.getElementById('hlBar');
                if(hex&&hex!=='transparent'){
                    currentHlColor=hex;
                    if(bar) bar.style.background=hex;
                    document.querySelectorAll('#hlPop .color-swatch').forEach(n=>n.classList.toggle('sel',_colorToHex(n.dataset.c)===hex));
                }else if(bar){
                    bar.style.background='transparent';
                }
            }
        }catch(e){}
    }
    // 상자 안 내용 전체에 스타일을 입힌다 (prop=null 이면 형광펜 전체 지우기)
    // 편집 모드 여부와 무관하게 DOM 을 직접 고치므로 글꼴이 풀리지 않는다.
    function _boxTextNodes(c){
        const tw=document.createTreeWalker(c,NodeFilter.SHOW_TEXT);
        const nodes=[]; let n;
        while(n=tw.nextNode()){ if(String(n.nodeValue||'').trim()) nodes.push(n); }
        return nodes;
    }
    // 상자 전체가 해당 스타일로 덮여 있는가 (상자 레벨 + 글자별 span 모두 고려)
    function _boxHasAllStyle(w,prop,value){
        const c=w&&w.querySelector('.tb-content'); if(!c) return false;
        const nodes=_boxTextNodes(c); if(!nodes.length) return false;
        return nodes.every(tn=>_propMatch(prop, _inheritedStyles(tn,c).styles[prop]||'', value));
    }
    // 상자 안 내용 전체에 스타일을 입힌다 (prop=null 이면 형광펜 전체 지우기)
    // v2 엔진의 전체 범위 적용을 쓴다 — 세그먼트 재구축이라 부분 서식(중첩 span)과
    // 겹쳐도 덮어쓰기/보존이 항상 정확하다.
    function _paintBoxAll(w,prop,value){
        const c=w.querySelector('.tb-content'); if(!c) return;
        if(!prop){
            c.querySelectorAll('*').forEach(n=>{
                const bg=n.style&&n.style.backgroundColor;
                if(bg&&bg!=='transparent'&&bg!=='rgba(0, 0, 0, 0)')
                    n.style.removeProperty('background-color');
            });
            if(c.style) c.style.removeProperty('background-color');
            // 구버전 문서/표 셀은 배경색이 el.cellBg 로 저장돼 있었다.
            // 화면 DOM 만 지우면 다시 렌더링하거나 저장 후 열 때 배경이 되살아난다.
            const el=findEl(+w.dataset.pageIdx,w.dataset.id);
            if(el) delete el.cellBg;
            syncTextEl(w);
            return;
        }
        _fmtApplyBox(c,prop,value);
        syncTextEl(w);
    }
    // 상자 전체에서 스타일 제거 (box-level el.fontStyle 같은 옛 데이터도 치운다)
    function _clearBoxStyleAll(w,prop,value){
        const c=w&&w.querySelector('.tb-content'); if(!c) return;
        if(c.style){
            if(prop==='textDecoration'){
                const toks=String(c.style.textDecoration||'').split(/\s+/).filter(t=>t&&t!=='none'&&t!==value);
                if(toks.length) c.style.textDecoration=toks.join(' ');
                else c.style.removeProperty('text-decoration');
            }else c.style.removeProperty(prop);
        }
        const el=findEl(+w.dataset.pageIdx,w.dataset.id);
        if(el){
            if(prop==='textDecoration'){
                const toks=String(el.textDecoration||'').split(/\s+/).filter(t=>t&&t!=='none'&&t!==value);
                if(toks.length) el.textDecoration=toks.join(' ');
                else delete el.textDecoration;
            }else{
                const key={fontWeight:'fontWeight',fontStyle:'fontStyle',color:'textColor',backgroundColor:'cellBg'}[prop];
                if(key) delete el[key];
            }
        }
        _fmtRemoveBox(c,prop,value);
        syncTextEl(w);
    }
    // 상자 전체 토글: 전부 켜져 있으면 끄고, 아니면 전체 적용 (선택 서식과 동일 규칙)
    function _toggleBoxAllStyle(w,prop,value){
        if(_boxHasAllStyle(w,prop,value)) _clearBoxStyleAll(w,prop,value);
        else _paintBoxAll(w,prop,value);
    }
    // 14.13.7 · 순서: ① 표 셀 → ② 글자 선택 범위(저장된 선택 포함) → ③ 상자만 고른 상태(상자 전체)
    function applyTextColor(c){
        currentTextColor=c;
        document.getElementById('tcBar').style.background=c;
        document.getElementById('tcGlyph').style.color=c;
        if(selectedTblCellEls().length){ tblCellApply(el=>{ el.textColor=c; },'선택한 칸 글자색 적용'); return; }
        if(hasInlineTextSel()){
            pushHistory();
            withSelection(()=>wrapSelStyle('color',c));
            return;
        }
        // 18.6 · 캐럿(선택 없음) → 앞으로 입력될 글자에만
        if(_typingHost()){ caretWrapStyle({color:c}); return; }
        const targets=_boxFmtTargets();
        if(targets.length){
            pushHistory();
            targets.forEach(w=>_paintBoxAll(w,'color',c));
            saveDoc();
            toast(targets.length>1?targets.length+'개 상자 글자색 적용':'상자 전체 글자색 적용',1000);
            return;
        }
        toast('텍스트를 드래그하거나 상자를 고르세요',1300);
    }
    function applyHighlight(c){
        if(c){ currentHlColor=c; document.getElementById('hlBar').style.background=c; }
        if(selectedTblCellEls().length){ tblCellFill(c||''); return; }
        if(hasInlineTextSel()){
            pushHistory();
            withSelection(()=>{ if(c) wrapSelStyle('backgroundColor',c); else clearSelBg(); });
            return;
        }
        // 18.6 · 캐럿 → 앞으로 입력될 글자에만
        if(_typingHost()){ caretWrapStyle({backgroundColor:c||'transparent'}); return; }
        const targets=_boxFmtTargets();
        if(targets.length){
            pushHistory();
            targets.forEach(w=>_paintBoxAll(w, c?'backgroundColor':null, c||''));
            saveDoc();
            toast(targets.length>1?targets.length+'개 상자 형광펜 적용':'상자 전체 형광펜 적용',1000);
            return;
        }
        toast('텍스트를 드래그하거나 상자를 고르세요',1300);
    }
    // 18.6 · 글자색 지우기 (부모 상속으로 되돌리기)
    function clearTextColor(){
        if(selectedTblCellEls().length){ tblCellApply(el=>{ delete el.textColor; },'선택한 칸 글자색 지움'); return; }
        if(hasInlineTextSel()){
            pushHistory();
            withSelection(()=>clearSelColor());
            return;
        }
        if(_typingHost()){ caretWrapStyle({color:''}); return; }
        const targets=_boxFmtTargets();
        if(targets.length){
            pushHistory();
            targets.forEach(w=>_clearBoxStyleAll(w,'color'));
            saveDoc();
            toast(targets.length>1?targets.length+'개 상자 글자색 지움':'상자 전체 글자색 지움',1000);
        }
    }
    function execFmt(cmd){
        const cells=selectedTblCellEls();
        if(cells.length){
            const spec={bold:['fontWeight','700'],italic:['fontStyle','italic'],underline:['textDecoration','underline'],
                        strike:['textDecoration','line-through']}[cmd];
            if(spec){
                const [key,val]=spec,remove=cells.every(el=>el[key]===val);
                tblCellApply(el=>{ if(remove) delete el[key]; else el[key]=val; },'선택한 칸 글자 서식 적용');
                return;
            }
        }
        const spec={bold:['fontWeight','700'],italic:['fontStyle','italic'],underline:['textDecoration','underline'],
                    strike:['textDecoration','line-through']}[cmd];
        if(spec){
            // ① 글자 선택(드래그·저장된 범위) → 선택 구간만 토글한다.
            //    예전 캐럿(savedCaret)이 남아 있어도 실제 선택이 있으면 항상 선택을 우선한다.
            if(hasInlineTextSel()){
                pushHistory();
                withSelection(()=>toggleSelStyle(spec[0],spec[1]));
                setTimeout(syncCurSel,0);
                return;
            }
            // ② 캐럿(선택 없음) → 앞으로 입력될 글자만 토글
            if(_typingHost()){
                const [key,val]=spec;
                // 18.7 · 캐럿에서 '꺼짐' 상태는 '속성 제거'가 아니라 '중립값'으로 써야 한다.
                //   - 중립값을 가진 빈 span 을 캐럿 자리에 남기면 이후 입력되는 글자가
                //     바로 앞(부모) 서식에 물려(예: 볼드 span 안에 다시 글자를 입력) 같은
                //     서식으로 계속 입력되는 문제를 막는다. (보고 이슈①)
                //   - fontWeight:400 / fontStyle:normal 처럼 '명시적 중립'이 브라우저가
                //     다음 입력 글자를 이전 서식으로 되돌리는 것까지 막아 준다.
                const off={fontWeight:'400',fontStyle:'normal',textDecoration:''}[key];
                // textDecoration 에는 이미 다른 값(underline 등)이 있을 수 있으니
                // 토글 off 시에만 해당 토큰을 빼는 식으로 처리
                if(_caretHasStyle(key,val)){
                    if(key==='textDecoration'){
                        // 토큰 제거
                        const span=_typingSpan;
                        if(span){
                            const toks=String(span.style.textDecoration||'').split(/\s+/).filter(t=>t&&t!=='none'&&t!==val);
                            span.style.textDecoration=toks.join(' ')||'';
                            const host=span.closest&&span.closest('.tb-content');
                            if(host) _rememberTypingStyles(span,host);
                            const w=(span.closest&&span.closest('.tb'))||(_typingHost()&&_typingHost().w);
                            if(w&&w.isConnected) syncTextEl(w);
                        }
                    }else{
                        caretWrapStyle({[key]:off});
                    }
                }else{
                    // 켜기: 기존 textDecoration 에 추가
                    if(key==='textDecoration'&&_typingSpan){
                        const cur=String(_typingSpan.style.textDecoration||'').split(/\s+/).filter(t=>t&&t!=='none');
                        if(cur.indexOf(val)<0) cur.push(val);
                        _typingSpan.style.textDecoration=cur.join(' ');
                        const host=_typingSpan.closest&&_typingSpan.closest('.tb-content');
                        if(host) _rememberTypingStyles(_typingSpan,host);
                        const w=_typingSpan.closest&&_typingSpan.closest('.tb');
                        if(w&&w.isConnected) syncTextEl(w);
                    }else{
                        caretWrapStyle({[key]:val});
                    }
                }
                return;
            }
            // ③ 상자만 고른 상태 → 상자 전체에 덧씌우고, 이미 전체 적용 상태면 뺀다.
            //    (이제 상자를 클릭한 뒤 굵게/기울임/밑줄 버튼이 '안 되는' 일이 없다)
            const targets=_boxFmtTargets();
            if(targets.length){
                pushHistory();
                targets.forEach(w=>_toggleBoxAllStyle(w,spec[0],spec[1]));
                saveDoc();
                toast(targets.length>1?targets.length+'개 상자에 서식 적용':'상자 전체에 서식 적용',1000);
                setTimeout(syncCurSel,0);
                return;
            }
        }
        // ④ 안전망 — 위 어느 경로로도 처리되지 않았는데 글자 선택이 있으면 토글한다.
        //   구버전은 여기서 execCommand(bold/…) 을 썼는데, execCommand 는 환경마다
        //   선택지의 span 을 제멋대로 다시 짜는 원인이었다. v2 엔진으로 통일한다.
        if(spec&&hasInlineTextSel()){
            pushHistory();
            withSelection(()=>toggleSelStyle(spec[0],spec[1]));
            setTimeout(syncCurSel,0);
        }
    }

    // 문단 정렬 — execCommand(justify*) 없이 대상 블록에 text-align 을 직접 적는다.
    //   (justify* 는 브라우저/웹뷰마다 동작 편차가 컸다. v2 엔진 경로로 통일.)
    //   순서: ① 글자 선택 범위의 문단들 → ② 캐럿 문단 → ③ 표 칸 → ④ 선택한 상자 전체
    function setAlign(dir){
        const sel=window.getSelection();
        const live=sel&&!sel.isCollapsed&&document.querySelector('.tb.edit');
        if(live&&hasInlineTextSel()){
            pushHistory();
            withSelection(()=>_fmtAlignSelection(dir));
            toast(({left:'왼쪽',center:'가운데',right:'오른쪽'})[dir]+' 정렬',1000);
            return;
        }
        const t=_typingHost();
        if(t){
            pushHistory();
            const blk=_fmtLeafBlock(t.r.startContainer.nodeType===3?t.r.startContainer.parentElement:t.r.startContainer,t.c);
            blk.style.textAlign=dir;
            if(blk===t.c){
                const w=blk.closest&&blk.closest('.tb');
                const el=w?findEl(+w.dataset.pageIdx,w.dataset.id):null;
                if(el) el.align=dir;
            }
            const w=t.c.closest('.tb'); if(w) syncTextEl(w);
            toast(({left:'왼쪽',center:'가운데',right:'오른쪽'})[dir]+' 정렬',1000);
            return;
        }
        if(selectedTblCellEls().length){ tblCellAlign(dir); return; }
        let targets=multiSel.length
            ? multiSel.map(m=>m.node).filter(nd=>nd.classList.contains('tb'))
            : [];
        if(!targets.length) targets=Array.from(document.querySelectorAll('#pagesStage .tb.edit,#pagesStage .tb.sel'));
        if(!targets.length){ toast('텍스트 상자를 먼저 선택하세요',1300); return; }
        pushHistory();
        targets.forEach(w=>{
            const c=w.querySelector('.tb-content'); if(!c) return;
            c.style.textAlign=dir;
            const el=findEl(+w.dataset.pageIdx,w.dataset.id);
            if(el) el.align=dir;
        });
        saveDoc();
        toast(({left:'왼쪽',center:'가운데',right:'오른쪽'})[dir]+' 정렬',1000);
    }
    // ── 편집 중 '캐럿' 서식 ─────────────────────────────────────────
    // 글자 선택 없이 상자 안에서 입력 중일 때 색/글꼴/크기/볼드 등을 바꾸면
    // '상자 전체'가 아니라 '앞으로 입력될 글자'에만 적용한다.
    // 캐럿 자리에 빈 span 을 넣고 커서를 그 안에 두면 이후 입력이 span 안으로 들어간다.
    function _typingHost(){
        try{
            const s=window.getSelection();
            if(s&&s.rangeCount&&s.isCollapsed){
                const r=s.getRangeAt(0);
                const el=r.startContainer.nodeType===3?r.startContainer.parentElement:r.startContainer;
                const c=el&&el.closest&&el.closest('.tb-content');
                if(c&&c.closest('.tb').classList.contains('edit')) return {c,r};
            }
        }catch(e){}
        if(savedCaret&&savedCaret.c&&document.body.contains(savedCaret.c)){
            const w=savedCaret.c.closest('.tb');
            if(w&&w.classList.contains('edit')) return savedCaret;
        }
        return null;
    }
    // 캐럿 위치가 '이미 그 스타일' 안인가 (토글 판정용)
    function _caretHasStyle(prop,value){
        try{
            const t=_typingHost(); if(!t) return false;
            const tn=t.r.startContainer;
            let p=tn.nodeType===3?tn.parentElement:tn;
            while(p&&p!==t.c){
                const v=p.style&&p.style[prop];
                if(v&&(String(v).toLowerCase()===String(value).toLowerCase()
                    ||(prop==='fontWeight'&&(v==='bold'||Number(v)>=600)))) return true;
                p=p.parentElement;
            }
            // 상자 전체 서식(box-level)이 켜져 있으면 캐럿에서도 '켜진 상태'로 본다.
            if(t.c&&t.c.style){
                const v=t.c.style[prop];
                if(v&&(String(v).toLowerCase()===String(value).toLowerCase()
                    ||(prop==='fontWeight'&&(v==='bold'||Number(v)>=600)))) return true;
            }
        }catch(e){}
        return false;
    }
    function _typingStylesFromNode(node,host){
        const out={};
        let p=node&&(node.nodeType===3?node.parentElement:node);
        while(p&&p!==host){
            if(p.nodeType===1){
                const tag=_tagStyle(p.tagName);
                if(tag) for(const k in tag){ if(!(k in out)) out[k]=tag[k]; }
                for(const k of INLINE_STYLE_PROPS){
                    const v=p.style&&p.style[k];
                    if(v&&!(k in out)) out[k]=v;
                }
            }
            p=p.parentElement;
        }
        return out;
    }
    function _typingStylesAt(span,host){
        return _typingStylesFromNode(span,host);
    }
    function _rememberTypingStyles(span,host){
        if(!span||!host){ _pendingTyping=null; return; }
        const styles=_typingStylesAt(span,host);
        _pendingTyping=Object.keys(styles).length?{host,styles}:null;
    }
    function _restoreTypingRange(host,range){
        if(!host||!range) return false;
        try{ host.contentEditable='true'; }catch(e){}
        try{ if(document.activeElement!==host&&host.focus) host.focus({preventScroll:true}); }catch(e){}
        try{
            const s=window.getSelection();
            if(!s) return false;
            s.removeAllRanges();
            s.addRange(range);
            savedCaret={c:host,r:range.cloneRange()};
            return true;
        }catch(e){ return false; }
    }
    // 브라우저가 빈 span을 없애거나 입력 후 캐럿을 형제 위치로 옮겨도, 별도로 기억한
    // active state를 사용해 입력 직전 같은 스타일 wrapper를 다시 만든다.
    function _ensurePendingTypingSpan(host){
        const p=_pendingTyping;
        if(!p||p.host!==host||!host||!host.isConnected) return false;
        const w=host.closest&&host.closest('.tb');
        if(!w||!w.classList.contains('edit')) return false;
        const s=window.getSelection();
        if(!s||!s.rangeCount||!s.isCollapsed) return false;
        const live=s.getRangeAt(0);
        const point=live.startContainer;
        const inHost=point===host||host.contains(point);
        if(!inHost) return false;
        if(_typingSpan&&_typingSpan.isConnected&&host.contains(_typingSpan)&&
           (point===_typingSpan||_typingSpan.contains(point))){
            savedCaret={c:host,r:live.cloneRange()};
            return true;
        }
        try{
            const span=document.createElement('span');
            span.className='sdy-type';
            for(const k in p.styles) _setInlineProp(span,k,p.styles[k]);
            const r=live.cloneRange();
            r.insertNode(span);
            const nr=document.createRange(); nr.selectNodeContents(span); nr.collapse(false);
            _typingSpan=span;
            _restoreTypingRange(host,nr);
            return true;
        }catch(e){ return false; }
    }
    // 캐럿에 서식 span 삽입 (이미 같은 span 안이면 스타일만 갱신)
    function caretWrapStyle(styles){
        const t=_typingHost(); if(!t) return false;
        const c=t.c;
        try{
            const s=window.getSelection();
            const dot=tn=>tn&&(tn===_typingSpan||(_typingSpan&&_typingSpan.contains(tn)));
            // 빈 span 만 재사용한다. 이미 글자가 들어간 span 을 뒤집으면
            // '앞으로 입력될 글자'뿐 아니라 '이미 입력된 글자'까지 바뀌기 때문.
            const spanEmpty=_typingSpan&&!_typingSpan.textContent&&!_typingSpan.childElementCount;
            let span=null;
            if(spanEmpty&&_typingSpan.isConnected&&c.contains(_typingSpan)){
                const r0=s.rangeCount?s.getRangeAt(0):null;
                if(dot(r0&&r0.startContainer)) span=_typingSpan;
                else if(savedCaret&&savedCaret.c===c&&dot(savedCaret.r.startContainer)) span=_typingSpan;
            }
            if(!span){
                span=document.createElement('span');
                span.className='sdy-type';
                const src=(s.rangeCount?s.getRangeAt(0):t.r).cloneRange();
                // 14.18.4 · 도중 스타일 변경: 새 빈 span 을 만들 때도 직전까지의
                // 캐럿 서식(색·크기·굵기·밑줄·형광펜·부분 글꼴)을 모두 먼저 심어 둔다.
                // 예전엔 font-family 만 옮겨 "크기만 바꾼 뒤 다시 색 변경" 같은 흐름에서
                // 앞에서 고른 24px/굵게가 빠지는 경우가 있었다.
                const seed=(_pendingTyping&&_pendingTyping.host===c&&_pendingTyping.styles)
                    ? _pendingTyping.styles
                    : _typingStylesFromNode(src.startContainer,c);
                for(const k in seed) _setInlineProp(span,k,seed[k]);
                src.insertNode(span);
                const nr=document.createRange();
                nr.selectNodeContents(span); nr.collapse(true);
                _typingSpan=span;
                _restoreTypingRange(c,nr);
            }else{
                // 캐럿을 서식 span 안으로 되돌린다 (툴바 입력창을 쓰다 돌아와도 이어짐)
                const nr=document.createRange();
                nr.selectNodeContents(span); nr.collapse(true);
                _restoreTypingRange(c,nr);
            }
            const _removeStyleSafe=(name)=>{
                // jsdom·일부 WebView 는 camelCase removeProperty 를 무시한다.
                // kebab-case 로 지우면 브라우저·테스트 모두에서 일관되게 동작한다.
                const kebab=String(name||'').replace(/([A-Z])/g,'-$1').toLowerCase();
                try{ span.style.removeProperty(kebab); }catch(_e){}
                try{ span.style.removeProperty(name); }catch(_e){}
            };
            for(const k in styles){
                if(styles[k]===''||styles[k]==null) _removeStyleSafe(k);
                else span.style[k]=styles[k];
            }
            // 서식을 전부 지우면 빈 span 은 남길 이유가 없다 → 풀어낸다.
            //   단, 캐럿이 '이전 서식에 물리지 않도록' 만들려면 스타일이 전부 없더라도
            //   sdy-type 빈 span 을 하나 남겨 두는 편이 안전하다. 여기서는 '진짜 빈
            //   스타일' + '아직 입력 전'일 때만 지우고, '이전 서식 차단용'으로 쓴
            //   중립값(400/normal)이 남아 있으면(즉 cssText 가 있으면) 반드시 유지한다.
            if(span.classList.contains('sdy-type')&&!span.style.cssText&&!span.textContent&&!span.childElementCount){
                span.remove(); _typingSpan=null; savedCaret=null; _pendingTyping=null;
                return true;
            }
            // DOM wrapper와 별도로 이후 입력 상태를 보관한다. 새 글꼴을 고르는 등
            // wrapper가 중첩돼도 조상 bold/color까지 합쳐 다음 글자에 그대로 이어진다.
            _rememberTypingStyles(span,c);
            const w=c.closest('.tb');
            if(w&&w.isConnected) syncTextEl(w);
            return true;
        }catch(e){ return false; }
    }

    function clearBoxFormatting(w){
        const c=w&&w.querySelector&&w.querySelector('.tb-content'); if(!c) return;
        const el=findEl(+w.dataset.pageIdx,w.dataset.id); if(!el) return;
        const fs=Math.max(2,Math.min(200,Math.round(parseFloat(c.style.fontSize)||el.fontSize||curFontSize||16)));
        c.innerHTML=stripFormatting(c.innerHTML);
        c.style.fontSize=fs+'px';
        c.style.fontFamily=fontCSS('pretendard');
        ['color','background-color','font-weight','font-style','text-decoration'].forEach(p=>{
            try{ c.style.removeProperty(p); }catch(e){}
        });
        el.html=c.innerHTML;
        el.fontSize=fs;
        delete el.textColor; delete el.cellBg; delete el.font;
        delete el.fontWeight; delete el.fontStyle; delete el.textDecoration;
        try{ markPageEdited(+w.dataset.pageIdx); }catch(e){}
        syncTextEl(w);
    }

    // 서식 지우기 (고도화)
    //  - 텍스트를 드래그해 선택했으면 그 부분만
    //  - 선택이 없으면 텍스트 상자 전체 (여러 개 선택 시 전부)
    function clearFmt(){
        const host=restoreSel();
        const sel=window.getSelection();
        if(host && sel && !sel.isCollapsed){
            pushHistory();
            // 18.9 · execCommand('removeFormat') 은 브라우저/웹뷰마다 동작이 제각각이고
            //   일부 환경(구형 WebView·테스트 DOM)에는 아예 없다. 인라인 엔진으로
            //   선택 구간의 서식 속성을 하나씩 확실히 걷어낸다.
            ['fontWeight','fontStyle','textDecoration','color','backgroundColor',
             'fontFamily','fontSize','verticalAlign'].forEach(p=>{
                try{ _removeFromSelection(p); }catch(e){}
            });
            // 링크 해제도 직접 처리한다. execCommand('unlink') 가 없는 WebView/jsdom 에서도
            // 선택한 링크 글자는 남기고 <a> 만 벗겨야 한다.
            try{ _unlinkSelection(); }catch(e){}   // v2 엔진: <a> 만 벗기고 글자는 남긴다
            const w=host.closest('.tb'); if(w) syncTextEl(w);
            saveSel(); syncCurSel();
            toast('선택 영역 서식 지움',1200);
            return;
        }
        if(selectedTblCellEls().length){
            tblCellApply(el=>{
                el.html=stripFormatting(el.html||''); el.fontSize=curFontSize;
                delete el.textColor; delete el.font; delete el.fontWeight;
                delete el.fontStyle; delete el.textDecoration; delete el.cellBg;
            },'선택한 칸 글자 서식 지움');
            return;
        }
        // 18.5 · 캐럿(선택 없음) → 앞으로 입력될 글자의 서식만 지운다
        if(_typingHost()){
            caretWrapStyle({fontWeight:'',fontStyle:'',textDecoration:'',color:'',
                            backgroundColor:'',fontFamily:'',fontSize:''});
            toast('앞으로 입력될 글자 서식 지움',1000);
            return;
        }
        // 상자 단위
        let targets=[];
        if(multiSel.length) targets=multiSel.map(m=>m.node).filter(n=>n.classList.contains('tb'));
        if(!targets.length){
            targets=Array.from(document.querySelectorAll('#pagesStage .tb.edit,#pagesStage .tb.sel,#pagesStage .tb.msel'));
        }
        if(!targets.length){ toast('텍스트 상자를 선택하거나 글자를 드래그하세요',1800); return; }
        pushHistory();
        targets.forEach(w=>clearBoxFormatting(w));
        saveDoc();
        toast(`${targets.length}개 상자 서식 지움`,1400);
    }

    // 줄바꿈만 남기고 모든 서식 제거
    function stripFormatting(html){
        const box=document.createElement('div');
        box.innerHTML=html||'';
        box.querySelectorAll('br').forEach(b=>b.replaceWith('\n'));
        box.querySelectorAll('div,p,li').forEach(n=>{ n.after('\n'); });
        const text=(box.textContent||'').replace(/\n{3,}/g,'\n\n').replace(/[ \t]+\n/g,'\n').trim();
        return esc(text).replace(/\n/g,'<br>');
    }
    // 14.16 · 툴바의 글자 크기칸과 '지금 보고 있는 글자'를 맞추는 장치
    //  상자를 Alt+휠로 키우거나 다른 상자를 집었을 때 툴바 값이 낡은 채로 남아
    //  '+' 를 누르면 도로 작아지던 것을 막는다.
    function setToolbarFS(v){
        // 18.8 · 잴 대상이 없으면(0/빈 값) 툴바 값을 건드리지 않는다.
        //   예전엔 0 이 들어와도 2 로 깎여 저장되는 바람에, 아무것도 고르지 않은
        //   화면에서 '＋' 를 누르면 2 ↔ 3 만 오가는 버그가 있었다. (보고 이슈③)
        const n=Math.round(Number(v)||0);
        if(!n||n<1) return;
        v=Math.max(2,Math.min(200,n));
        const inp=document.getElementById('fsInput');
        // 같은 숫자여도 직전 상태가 mixed('-')였다면 표시를 반드시 복원한다.
        if(inp){
            inp.classList.remove('mixed'); inp.removeAttribute('aria-label');
            if(document.activeElement!==inp) inp.value=v;
        }
        if(v===curFontSize) return;
        curFontSize=v;
    }
    // 지금 글자 크기를 물어볼 대상: 표 칸 → 편집 중인 상자 → 선택한 상자
    function activeTextFS(){
        try{
            const cells=selectedTblCellEls();
            if(cells.length&&cells[0]&&cells[0].fontSize) return cells[0].fontSize;
        }catch(e){}
        let node=null;
        if(selected&&selected.type==='text'&&selected.el) node=selected.el;   // 편집 중/방금 집은 상자
        if(!node&&multiSel.length===1) node=multiSel[0].node;
        if(!node) node=document.querySelector('#pagesStage .tb.edit');
        if(!node) node=document.querySelector('#pagesStage .tb.sel');
        if(!node||!node.isConnected) return 0;
        const c=node.querySelector('.tb-content'); if(!c) return 0;
        // 화면에 실제로 그려진 크기를 우선한다 (자동 맞춤 상자도 헷갈리지 않게)
        let v=parseFloat(c.style.fontSize);
        if(!v){ try{ const el=findEl(+node.dataset.pageIdx,node.dataset.id); v=el&&el.fontSize; }catch(e){} }
        return Math.round(Number(v)||0);
    }
    // 18.8 · 같은 기준으로 '지금 대상'의 글꼴 id 도 구한다 (툴바 글꼴 동기화)
    function activeTextFont(){
        try{
            const cells=selectedTblCellEls();
            if(cells.length&&cells[0]&&cells[0].font) return cells[0].font;
        }catch(e){}
        let node=null;
        if(selected&&selected.type==='text'&&selected.el) node=selected.el;
        if(!node&&multiSel.length===1) node=multiSel[0].node;
        if(!node) node=document.querySelector('#pagesStage .tb.edit');
        if(!node) node=document.querySelector('#pagesStage .tb.sel');
        if(!node||!node.isConnected||!node.classList.contains('tb')) return '';
        try{
            const el=findEl(+node.dataset.pageIdx,node.dataset.id);
            if(el&&el.font) return el.font;
        }catch(e){}
        const c=node.querySelector('.tb-content');
        return c?_fontIdFromCSS(c.style.fontFamily||''):'';
    }
    function syncFSFromTarget(){
        setToolbarFS(activeTextFS());
        const fid=activeTextFont();
        if(fid) setToolbarFont(fid);
    }
    // 상자 안의 '일부 글자'를 드래그해 골라 둔 상태면 그쪽 크기를 기준으로 삼는다
    function hasInlineTextSel(){
        try{
            const s=window.getSelection();
            if(s&&s.rangeCount&&!s.isCollapsed){
                const r=s.getRangeAt(0);
                const n=r.commonAncestorContainer;
                const host=n.nodeType===1?n:n.parentElement;
                if(host&&host.closest&&host.closest('.tb-content')) return true;
            }
            if(savedRange&&!savedRange.collapsed&&savedHost&&document.body.contains(savedHost)) return true;
        }catch(e){}
        return false;
    }
    function chFS(d){
        if(!hasInlineTextSel()) syncFSFromTarget();   // 지금 보이는 크기에서 증감
        setFS(curFontSize + (curFontSize<=10 ? (d>0?1:-1) : d));
    }
    function setFS(v){
        curFontSize=Math.max(2,Math.min(200,Math.round(v)));
        const fsInput=document.getElementById('fsInput');
        fsInput.value=curFontSize; fsInput.classList.remove('mixed'); fsInput.removeAttribute('aria-label');
        if(selectedTblCellEls().length){
            tblCellApply(el=>{ el.fontSize=curFontSize; },`선택한 칸 글자 ${curFontSize}px`);
            return;
        }
        const host=restoreSel();
        if(host){
            pushHistory();
            try{
                withSelection(()=>wrapSelStyle('fontSize',curFontSize+'px'));
            }catch(e){}
            return;
        }
        // 18.5 · 편집 중 캐럿(선택 없음) → 상자 전체가 아니라 앞으로 입력될 글자에만
        if(_typingHost()){ caretWrapStyle({fontSize:curFontSize+'px'}); return; }
        const targets=multiSel.length
            ? multiSel.map(m=>m.node).filter(n=>n&&n.classList&&n.classList.contains('tb'))
            : [];
        const single=document.querySelector('.tb.sel,.tb.edit');
        if(!targets.length&&single) targets.push(single);
        if(targets.length){
            pushHistory();
            targets.forEach(sel=>{
                const c=sel.querySelector('.tb-content');
                const el=findEl(+sel.dataset.pageIdx,sel.dataset.id);
                if(c){
                    c.style.fontSize=curFontSize+'px';
                    // 18.8 · 상자 전체 크기는 안쪽 부분 크기보다 세다 —
                    //   서식 span 에 박제된 옛 크기를 걷어내야 실제로 커/작아진다.
                    // v2 엔진: 인라인으로 박제된 부분 크기만 새 값으로 갱신하고,
                    //   나머지는 상자 값 상속을 유지한다.
                    try{ _fmtApplyBox(c,'fontSize',curFontSize+'px',true); }catch(_e){}
                }
                if(el) el.fontSize=curFontSize;
                syncTextEl(sel);
            });
            saveDoc();
        }
    }

    // ============ 종이 / 크기 ============
    function setPaper(type){
        if(!doc) return;
        doc.paper=type;
        document.querySelectorAll('.ptool').forEach(b=>b.classList.toggle('active',b.dataset.p===type));
        editorPapers().forEach(p=>{
            p.classList.remove('paper-blank','paper-lined','paper-grid','paper-dotted');
            p.classList.add('paper-'+type);
        });
        saveDoc();
    }
    function changeSizePreset(key){
        if(!doc) return;
        doc.sizePreset=key;
        renderPages(); saveDoc();
    }


/* APP-PART:11-text-format.js:END */
