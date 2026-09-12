/* === src/app/11a-text-style.js ===
   글자색/형광펜 팔레트 · 글꼴 · 상자 서식
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:11a-text-style.js:BEGIN */
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
    // 각 항목은 '한국어 이름 + 영어 이름'을 해당 글꼴 자체로 그린다.
    //   예시 문구(abc 가나다)는 쓰지 않는다 — 이름만 보고도 어떤 폰트인지 바로 알 수 있게.
    //   좌측: 한국어·영어 이름 (둘 다 해당 글꼴, .fi-sample 의 font-family 를 상속)
    //   우측: 현재 선택 시 체크
    // 메뉴를 열었는데 장식 글꼴 CSS 를 아직 안 받았으면(첫 화면 뒤 여유 로드 중)
    // 지금 바로 받고, 다 받아지는 순간 미리보기를 다시 그린다 — 글꼴이 늦게 떠서
    // 목록이 전부 기본 글꼴로 보이는 일이 없게.
    function positionFontMenu(){
        const m=document.getElementById('fontMenu');
        if(!m||!m.classList.contains('show')) return;
        if(m.parentElement!==document.body) document.body.appendChild(m);
        const r=document.getElementById('fontBtn').getBoundingClientRect();
        const cw=v=>window.sdyUiCss?window.sdyUiCss(v):(Number(v)||0);  // html zoom(.9) 보정
        m.style.left=Math.min(cw(r.left),cw(window.innerWidth)-288)+'px';
        m.style.top=(cw(r.bottom)+6)+'px';
    }
    function refreshFontMenu(){
        const m=document.getElementById('fontMenu');
        if(!m) return;
        const wasShow=m.classList.contains('show');
        const cur=curFont;
        m.innerHTML='';
        delete m.dataset.ready;
        buildFontMenu();
        m.querySelectorAll('.font-item').forEach(n=>n.classList.toggle('sel',n.dataset.f===cur));
        if(wasShow) positionFontMenu();
    }
    function buildFontMenu(){
        const m=document.getElementById('fontMenu');
        if(m.dataset.ready==='1') return;
        // 아직 늦게 로드 중인 장식 글꼴이면 지금 당겨 온다 (00-boot 의 멱등 로더)
        if(window.sdyLoadUiFonts) try{ window.sdyLoadUiFonts(); }catch(e){}
        FONTS.forEach(f=>{
            const it=document.createElement('div');
            it.className='font-item'; it.dataset.f=f.id;
            const ko=esc(f.ko||f.label||'');
            const en=esc(f.en||'');
            const showEn=en&&en!==ko;
            it.innerHTML=`<span class="fi-sample" style="font-family:${f.css}">`+
                         `<span class="fi-ko">${ko}</span>`+
                         (showEn?`<span class="fi-en">${en}</span>`:'')+
                         `</span>`+
                         `<i class="ri-checkbox-fill fi-check"></i>`;
            it.onmousedown=e=>e.preventDefault();
            it.onclick=(e)=>{ e.stopPropagation(); applyFont(f.id); closeFontMenu(); };
            m.appendChild(it);
        });
        m.dataset.ready='1';
        // 이름이 실제 폰트로 그려지도록, 아직 안 불러온 글꼴은 여기에서 선제 로드
        if(document.fonts&&document.fonts.load){
            FONTS.forEach(f=>{
                const fam=f.css.split(',')[0];           // 주 패밀리 (따옴표 포함)
                try{ document.fonts.load('16px '+fam).catch(()=>{}); }catch(e){}
            });
            // 폰트가 방금 요청이라 아직 안 떴으면, 다 떠오르는 순간 목록을 다시 그린다.
            try{
                if(document.fonts.status!=='loaded'&&document.fonts.ready){
                    document.fonts.ready.then(()=>{ try{ refreshFontMenu(); }catch(_e){} }).catch(()=>{});
                }
            }catch(e){}
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
            positionFontMenu();
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
        // 14.69 · 폰 세로에서는 글꼴 버튼이 툴바에 없고 더보기 서랍('도구' 칸)에 있다.
        //   그 버튼은 .font-wrap 밖이라 그대로면 '방금 연 클릭'이 곧장 메뉴를 닫는다.
        if(!e.target.closest('.font-wrap')&&!e.target.closest('[data-sdy-font-open]')) closeFontMenu();
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
    const FMT_PROPS=['fontWeight','fontStyle','textDecoration','color','backgroundColor','fontFamily','fontSize','letterSpacing','verticalAlign'];
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

/* APP-PART:11a-text-style.js:END */
