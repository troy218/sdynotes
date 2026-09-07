/* === src/app/07b-hl-band.js ===
   부드러운 형광펜 표시 레이어
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:07b-hl-band.js:BEGIN */
    // ── 14.18.2 · 부드러운 형광펜(하이라이트) 표시 레이어 ──────────────────
    // 저장 데이터·편집 엔진은 글자 span 의 background-color 를 그대로 쓴다
    // (동기화·되돌리기·툴바 판정·계약 테스트 불변). 대신 '화면 표시'만 실제
    // 레이아웃(Range.getClientRects)을 재서, 글자 크기가 섞여도 줄 단위로
    // 끊긴 연속 띠 + 둥근 끝으로 한 겹 더 그린다. 레이어는 .tb-content 바깥
    // (.tb 아래)에 두므로 el.html·서버 저장에는 절대 섞이지 않는다.
    // 레이아웃을 못 재는 환경(구형 웹뷰·테스트 DOM)에서는 레이어가 생기지
    // 않고 기존 span 배경이 그대로 폴백으로 남는다.
    const _HL_NS='http://www.w3.org/2000/svg';

    function _hlLayer(w){
        let lyr=w&&w.querySelector(':scope > .sdy-hl-layer');
        if(!lyr&&w){
            try{
                lyr=document.createElementNS(_HL_NS,'svg');
                lyr.setAttribute('class','sdy-hl-layer');
                lyr.style.cssText='position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none;z-index:-1;';
                w.appendChild(lyr);
            }catch(e){ lyr=null; }
        }
        return lyr||null;
    }
    // 글자에서 가장 가까운 span 의 배경색을 따른다. '투명' span 은 차단.
    function _hlColorOf(node,c,baseHex){
        let el=node&&(node.nodeType===3?node.parentNode:node);
        while(el&&el!==c&&el.nodeType===1){
            const v=el.style&&el.style.backgroundColor;
            if(v&&String(v).trim()){
                const h=_colorToHex(_classicPaletteColor('hl',v));
                return (h&&h!=='transparent')?h:null;
            }
            el=el.parentNode;
        }
        return baseHex||null;
    }
    // 같은 색으로 연속된 텍스트 노드 묶음
    function _hlRuns(c,baseHex){
        const runs=[]; let cur=null;
        const walker=document.createTreeWalker(c,NodeFilter.SHOW_TEXT);
        for(let n;(n=walker.nextNode());){
            const color=_hlColorOf(n,c,baseHex);
            if(color){
                if(cur&&cur.color===color) cur.nodes.push(n);
                else { cur={color:color,nodes:[n]}; runs.push(cur); }
            }else cur=null;
        }
        return runs;
    }
    // 텍스트 노드를 실제 화면 선 조각(뷰 좌표)으로 잰다
    function _hlFragRects(run){
        const out=[], range=document.createRange();
        for(const n of run.nodes){
            try{ range.selectNodeContents(n); }catch(e){ continue; }
            let rs=[];
            try{ rs=Array.from(range.getClientRects()); }catch(e){ rs=[]; }
            for(const r of rs){
                if(r&&r.width>0.3&&r.height>0.3)
                    out.push({l:r.left,t:r.top,rr:r.right,b:r.bottom,color:run.color});
            }
        }
        return out;
    }
    // 같은 줄 조각을 세로 겹침으로 묶고, 가로로 닿은 조각은 한 띠로 합친다
    function _hlBands(frags){
        const rows=[];
        for(const f of frags){
            let row=null;
            for(const r of rows){ if(f.t<r.maxT+2&&f.b>r.minT-2){ row=r; break; } }
            if(!row){ row={minT:f.t,maxT:f.b,items:[]}; rows.push(row); }
            if(f.t<row.minT) row.minT=f.t;
            if(f.b>row.maxT) row.maxT=f.b;
            row.items.push(f);
        }
        const bands=[];
        for(const row of rows){
            const items=row.items.slice().sort((a,b)=>a.l-b.l);
            let band=null;
            for(const f of items){
                if(band&&f.l-band.rr<=2.5){
                    if(f.rr>band.rr) band.rr=f.rr;
                    if(f.t<band.t) band.t=f.t;
                    if(f.b>band.b) band.b=f.b;
                }else{ band={l:f.l,t:f.t,rr:f.rr,b:f.b,color:f.color}; bands.push(band); }
            }
        }
        return bands;
    }
    // 22.1 · 형광펜 띠를 '다시 잴 가치'가 있는 상자인가?
    //   띠는 저장 HTML 과 무관한 표시 전용 레이어라, 배경색이 하나도 없는 상자는
    //   재든 아니든 결과가 '아무 것도 안 그림'이다. 글상자 수백 개인 쪽에서
    //   이 판정 하나가 레이아웃 읽기(상자 × 텍스트 노드)를 통째로 없앤다.
    //   편집 중인 상자는 글자마다 배경이 생길 수 있으니 항상 계산 대상.
    function _hlMayHave(c,w){
        try{
            if(w.classList&&w.classList.contains('edit')) return true;
            const el=(w.dataset&&w.dataset.id!=null)?findEl(+w.dataset.pageIdx,w.dataset.id):null;
            if(el&&(el.cellBg||el.hl)) return true;
            if(c.style&&c.style.backgroundColor) return true;
            return /background/i.test((el&&el.html)||'');
        }catch(e){ return true; }
    }
    // 22.1 · 웹폰트 로드는 한 번만 기다린다. 예전엔 글상자·표시 레이어마다
    //   document.fonts.ready.then(...) 을 걸어, 쪽 하나를 그릴 때 수백 개의
    //   Promise 와 그만큼의 재측정이 쌓였다. 이제 단일 구독 + 콜백 목록.
    const _fontsReadyCbs=[];
    let _fontsReadyArmed=false;
    function _onFontsReady(cb){
        try{
            if(!(document.fonts&&document.fonts.ready)){ cb(); return; }
            if(document.fonts.status!=='loading'){ cb(); return; }   // 이미 떠 있으면 즉시
            _fontsReadyCbs.push(cb);
            if(_fontsReadyArmed) return;
            _fontsReadyArmed=true;
            document.fonts.ready.then(()=>{
                _fontsReadyArmed=false;
                const list=_fontsReadyCbs.splice(0);
                list.forEach(f=>{ try{ f(); }catch(e){} });
            }).catch(()=>{ _fontsReadyArmed=false; _fontsReadyCbs.length=0; });
        }catch(e){ try{ cb(); }catch(_e){} }
    }
    function _hlSchedule(c,w){
        if(!c||!w||!c.isConnected) return;
        if(c._sdyHlT) return;
        // 22.1 · 이미 띠 레이어가 있는 상자는(지금은 배경이 없어도) 지워 주려면
        //   계산이 필요하므로 통과시킨다.
        if(!_hlMayHave(c,w)&&!(w.querySelector&&w.querySelector(':scope > .sdy-hl-layer'))) return;
        c._sdyHlT=setTimeout(()=>{ c._sdyHlT=0; try{ _hlPaint(c,w); }catch(_e){} },60);
    }
    function _hlWatch(c,w){
        if(typeof MutationObserver==='undefined'||c._sdyHlMO) return;
        const mo=new MutationObserver(()=>_hlSchedule(c,w));
        try{
            mo.observe(c,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','class']});
            c._sdyHlMO=mo;
        }catch(e){}
    }
    function _hlRepaintAll(){
        try{
            document.querySelectorAll('#pagesStage .tb').forEach(w=>{
                const c=w&&w.querySelector('.tb-content');
                if(c&&w.dataset&&w.dataset.id!=null) _hlSchedule(c,w);
            });
        }catch(_e){}
    }
    function _hlPaint(c,w){
        if(!c||!w) return;
        let baseHex='';
        try{ baseHex=_colorToHex(_classicPaletteColor('hl',(c.style&&c.style.backgroundColor)||'')); }catch(_e){}
        let frags=[];
        try{
            for(const run of _hlRuns(c,baseHex)) frags=frags.concat(_hlFragRects(run));
        }catch(e){ frags=[]; }
        if(!frags.length){
            w.classList.remove('sdy-hl-band-on');
            const old=w.querySelector(':scope > .sdy-hl-layer');
            if(old){ try{ old.remove(); }catch(_e){} }
            // 22.1 · 칠할 띠가 남지 않은 상자는 관찰도 멈춘다. (형광펜을 지운
            //   상자에서 글자마다 레이아웃을 다시 재지 않게)
            if(c._sdyHlMO){ try{ c._sdyHlMO.disconnect(); }catch(_e){} c._sdyHlMO=null; }
            return;
        }
        // 22.1 · 띠가 실제로 필요한 상자만 이때부터 관찰한다. 렌더 시점에 상자마다
        //   관찰자를 붙이던 것의 대체 — 형광펜을 방금 칠한 상자도 이 경로로
        //   관찰자가 붙으므로 서식 변경 후 재그림은 예전대로 동작한다.
        if(!c._sdyHlMO){ try{ _hlWatch(c,w); }catch(_e){} }
        // 레이아웃을 아직 못 재는 순간(숨김·폰트 로딩 전)에는 다음 사이클에서
        const crect=c.getBoundingClientRect();
        if(!crect||(!crect.width&&!crect.height)) return;
        const wrect=w.getBoundingClientRect();
        const sc=pageScreenScale(parseInt(w.dataset&&w.dataset.pageIdx,10));
        const sx=(sc&&sc.x>0)?sc.x:1, sy=(sc&&sc.y>0)?sc.y:1;
        const ox=(crect.left-wrect.left)/sx-(w.clientLeft||0);
        const oy=(crect.top-wrect.top)/sy-(w.clientTop||0);
        const lyr=_hlLayer(w);
        if(!lyr) return;
        w.classList.add('sdy-hl-band-on');
        lyr.style.cssText='position:absolute;left:'+ox+'px;top:'+oy+'px;width:1px;height:1px;overflow:visible;pointer-events:none;z-index:-1;';
        while(lyr.firstChild) lyr.removeChild(lyr.firstChild);
        const bands=_hlBands(frags);
        for(const b of bands){
            const x=(b.l-crect.left)/sx, y=(b.t-crect.top)/sy;
            const wd=(b.rr-b.l)/sx, h=(b.b-b.t)/sy;
            if(wd<=0.2||h<=0.2) continue;
            const rr=document.createElementNS(_HL_NS,'rect');
            rr.setAttribute('x',x.toFixed(2));
            rr.setAttribute('y',y.toFixed(2));
            rr.setAttribute('width',wd.toFixed(2));
            rr.setAttribute('height',h.toFixed(2));
            const rad=Math.max(1.2,Math.min(5,h*0.5));
            rr.setAttribute('rx',rad.toFixed(2));
            rr.setAttribute('ry',rad.toFixed(2));
            rr.setAttribute('fill',_classicPaletteColor('hl',b.color));
            lyr.appendChild(rr);
        }
    }
    function buildTextEl(el,pageIdx){
        const w=document.createElement('div');
        w.className='tb'; w.dataset.id=el.id; w.dataset.pageIdx=pageIdx;
        // 14.15 · 이 DOM 이 어느 노트의 그리기인지 기록 → 교체 후 남은 타이머가
        //   새 노트 doc 을 잘못 수정하지 않도록 syncTextEl 이 검증한다.
        w.dataset.nbId=(curNB&&curNB.id)||'';
        w._sdyRv=doc&&doc.__rv;
        w.style.cssText=`left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;`;
        const c=document.createElement('div');
        c.className='tb-content'; c.contentEditable='false';
        c.style.fontSize=(el.fontSize||16)+'px';
        c.style.fontFamily=fontCSS(el.font||'pretendard');
        if(el.align) c.style.textAlign=el.align;
        if(el.textColor) c.style.color=_classicPaletteColor('text',el.textColor);
        if(el.cellBg) c.style.backgroundColor=_classicPaletteColor('hl',el.cellBg);
        if(el.fontWeight) c.style.fontWeight=el.fontWeight;
        if(el.fontStyle) c.style.fontStyle=el.fontStyle;
        if(el.textDecoration) c.style.textDecoration=el.textDecoration;
        if(el.tbl){
            const va={top:'flex-start',middle:'center',bottom:'flex-end'}[el.vAlign||'middle'];
            c.style.justifyContent=va||'center';
        }
        // 18.10 · 텍스트는 상자 하나의 style 로 그리지 않고, 저장된 인라인
        // 속성을 DOM 에 다시 풀어낸다. 예전 렌더러는 HTML 문자열을 그대로 꽂은
        // 뒤 상자 style 을 먼저 적용해, 연속 서식 변경 뒤에도 화면이 마지막
        // 값만 보이거나(특히 구형 <font> 데이터) 일부 글자가 기본값으로
        // 돌아가는 경우가 있었다. decodeTextMarkup 은 각 요소의 속성을
        // 독립적으로 복원하므로 저장/재렌더링이 반복돼도 글자별 값이 유지된다.
        const _tHtml=decodeTextMarkup(_normalizePaletteHtml(el.html||''));
        c.innerHTML=_tHtml;
        // 14.29.2 · 문장 안에 섞인 $수식$ 그리기 — 수식 표식(imath)이 없으면
        //   querySelectorAll 조차 돌리지 않는다(대부분의 가져온 상자는 수식이 없다).
        if(_tHtml.indexOf('imath')>=0) imathFill(c);
        // 가져온(tight) 상자: 저장된 자간/띄어쓰기/줄간격 반영 + 자동 안겹침
        if(el.tight){
            if(el.ls) c.style.letterSpacing=el.ls+'px';
            if(el.wsp) c.style.wordSpacing=el.wsp+'px';
            if(el.lg&&Math.abs(el.lg-1)>0.001){
                const sps=Array.from(c.querySelectorAll(':scope>span'));
                if(sps.length){
                    const t0=Math.min(...sps.map(s=>parseFloat(s.dataset.origTop||s.style.top)||0));
                    sps.forEach(s=>{
                        const origTop=parseFloat(s.dataset.origTop||s.style.top)||0;
                        if(!s.dataset.origTop) s.dataset.origTop=origTop.toFixed(1);
                        s.style.top=(t0+(origTop-t0)*el.lg).toFixed(1)+'px';
                    });
                }
            }
            _queueTightFit(c,el);  // 단어 단위 재개 가능 큐; 늦은 웹폰트는 공용 loadingdone에서 갱신
        }
        // 14.14 · innerText 는 일부 환경(구형 WebView·테스트 DOM)에서 undefined.
        //   .trim() 이 그대로 터지면 텍스트 상자 전체가 안 그려져 빈 종이가 된다.
        const _tbPlain=()=>String((c.innerText!=null?c.innerText:c.textContent)||'');
        if(!String(c.textContent||'').trim()){ c.setAttribute('data-empty','true'); w.classList.add('empty'); }
        if(el.locked) w.classList.add('el-lock');
        c.addEventListener('dblclick',e=>{ e.stopPropagation(); if(pageReady(pageIdx)&&!w.classList.contains('edit')) enterEdit(w,true); });
        // 활성 캐럿 서식은 실제 입력 직전에 wrapper를 확인한다. 빈 span을 브라우저가
        // 정리했더라도 beforeinput 단계에서 복구되므로 첫 글자부터 서식이 빠지지 않는다.
        c.addEventListener('beforeinput',e=>{
            if(w.classList.contains('edit') && (!e.inputType||e.inputType.indexOf('insert')===0))
                _ensurePendingTypingSpan(c);
        });
        // beforeinput이 없는 구형 WebView용 선행 fallback (조합 중에는 keydown이 없어도
        // 표준 beforeinput이 오며, 둘 다 없는 환경은 아래 input에서 다음 글자를 복구).
        c.addEventListener('keydown',e=>{
            if(w.classList.contains('edit')&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&
               (e.key.length===1||e.key==='Enter')) _ensurePendingTypingSpan(c);
        });
        c.addEventListener('input',()=>{
            w._caretV=(w._caretV||0)+1;   // 22.1 · 실시간 캐럿 좌표 캐시를 무효화하는 신호
            if(w.classList.contains('edit')){
                commitEditSnapshot();   // 18.9 · 첫 타이핑 = 되돌리기 지점
                _armTypingCheckpoint(w);// 20.3 · 타자를 잠깐 쉬면 새 되돌리기 지점
            }
            _scriptEditUndoable=false;        // 실제 타이핑 뒤 Ctrl+Z 는 브라우저 기본 undo 를 우선
            _lastTypeT=Date.now();            // 20.3 · 앱/브라우저 undo 판정용
            const em=!_tbPlain().trim();
            if(em) c.setAttribute('data-empty','true'); else c.removeAttribute('data-empty');
            w.classList.toggle('empty',em);
            // 엔진이 입력 뒤 캐럿을 inline 밖으로 옮긴 경우 다음 입력 전에 다시 준비한다.
            if(w.classList.contains('edit')) _ensurePendingTypingSpan(c);
            clearTimeout(w._t); w._t=setTimeout(()=>{ syncTextEl(w); },300);
        });
        // 편집 상자에서 포커스를 벗어나면 즉시 반영 (자동저장 신뢰성)
        c.addEventListener('blur',()=>{
            if(w.classList.contains('edit')){
                clearTimeout(w._t);
                try{ syncTextEl(w); }catch(e){}
            }
        });
        if(el.tbl) w.classList.add('in-tbl');
        if(el.tight) w.classList.add('tight');
        if(el.pdfText) w.classList.add('pdf-text');
        w.appendChild(c);
        if(el.fit||el.fitDown) fitTextToBox(w,c,el);
        else if(el.trFit&&!el.trPending){            // 6.1: 번역 맞춤값 적용
            if(el.trLS) c.style.letterSpacing=el.trLS;
            if(el.trFW) c.style.fontWeight=el.trFW;
            if(el.trFS) c.style.fontSize=el.trFS+'px';
        }
        if(el.trPending){ fitTranslated(w,c,el); delete el.trPending; }
        // 이동 버튼과 X 버튼은 두지 않는다.
        //  · 이동 → 테두리를 잡고 끌기 (또는 Alt+드래그)
        //  · 삭제 → 선택 후 Delete 키
        // 22.1 · 테두리·손잡이는 여기서 만들지 않는다(위 _ensureTbControls).
        //   상자를 고르거나 편집에 들어가는 순간에 붙이며, 붙이는 곳은
        //   선택 경로 전부 + 아래 쪽(stage) MutationObserver 안전망이다.
        // 14.18.2 · 부드러운 형광펜 표시 레이어 — 형광펜이 있는 상자만 다시 잰다.
        //   관찰자(MutationObserver)는 띠가 실제로 그려질 때 _hlPaint 가 붙인다.
        //   웹폰트가 늦게 뜨는 경우에도 한 번 더 그린다.
        try{ _hlSchedule(c,w); }catch(_e){}
        _onFontsReady(()=>{ if(w.isConnected) _hlSchedule(c,w); });
        w._sdyViewHtml=c.innerHTML; w._sdyModelHtml=el.html;
        w._sdyModelKey=JSON.stringify(el);
        return w;
    }

    // 18.9 · 글자 입력도 '되돌리기(Ctrl+Z)' 로 되돌아가게 한다.
    //   예전에는 타이핑이 pushHistory 를 전혀 부르지 않아서, 편집을 끝내고
    //   Ctrl+Z 를 눌러도 방금 적은 글이 되돌아가지 않았다(브라우저 기본 undo 는
    //   편집 중일 때만 듣는다). 편집을 시작할 때 '적기 전' 문서를 기억해 두고,
    //   그 세션에서 처음 글자가 바뀌는 순간 한 번만 기록한다.
    //
    // ★ 22.1 · 똥컴에서 '글상자를 누르는 순간' 멈추던 핵심이 여기 있었다.
    //   예전 기록은 doc 전체 JSON.stringify — 논문처럼 쪽이 많은 문서에서
    //   편집에 들어갈 때마다 수백 KB~수십 MB 를 직렬화했고(동작이 끝나기 전까지
    //   화면이 얼음), 그 문자열을 60개까지 쌓아 두어 GC 까지 무거웠다.
    //   글자 편집이 바꿀 수 있는 것은 **그 상자 하나**뿐이므로, 그 상자의
    //   필드만 기억하는 '쪽 패치' 기록으로 바꾼다. 비용은 문서 크기(쪽 500개)가
    //   아니라 상자 크기(수백 바이트)이고, 되돌리기/다시 실행도 같은 패치로 처리한다.
    let _editSnap=null, _editSnapUsed=true;
    function histMax(){
        // 기록은 통째 직렬화(doc)라 한 장이 아주 크다. 저사양·대용량 문서에서는
        // 깊이를 줄여 기억에 붙드는 문자열 총량(= GC 부담)을 아낀다.
        try{
            if(sdyTurbo()) return 12;
            const n=(doc&&doc.pages)?doc.pages.length:0;
            return n>120?24:60;
        }catch(e){ return 60; }
    }
    // 요소의 '지금 상태' 얕은 복사 — 중첩 객체(표 셀 정보 등)만 본따서 복제한다.
    function _snapEl(el){
        const o={};
        if(!el) return o;
        for(const k in el){
            const v=el[k];
            if(typeof v==='function') continue;
            if(v&&typeof v==='object'){
                try{ o[k]=JSON.parse(JSON.stringify(v)); }catch(e){ o[k]=v; }
            }else o[k]=v;
        }
        return o;
    }
    function _editPatch(pi,id,before){ return {__sdyEdit:1,pi:+pi,id,before}; }
    // 패치를 그 상자에 입히고, 반대 방향 기록에 쓸 '바뀌기 직전 상태'를 돌려준다.
    //   remote = 그 사이 남(다른 기기·다른 탭)이 고친 요소 id 표시(20.3 계약) →
    //   남의 작업을 되돌리기가 덮어쓰지 않는다. 이미 그 상태라면 다시 그리지도 않는다.
    function _applyEditPatch(pt,remote){
        const pg=doc&&doc.pages&&doc.pages[pt.pi];
        if(!pg||!Array.isArray(pg.els)) return null;
        const el=pg.els.find(e=>e&&e.id===pt.id);
        if(!el) return null;
        if(remote&&remote.has(pt.id)) return null;
        const cur=_snapEl(el);
        let now='', want='';
        try{ now=JSON.stringify(cur); want=JSON.stringify(pt.before||{}); }catch(e){}
        if(now===want) return {cur:cur,changed:false};
        const b=pt.before||{};
        for(const k in el){ if(!(k in b)) delete el[k]; }
        for(const k in b) el[k]=b[k];
        try{ markPageEdited(pt.pi); }catch(e){}
        return {cur:cur,changed:true};
    }
    function markEditSnapshot(w){
        _editSnap=null; _editSnapUsed=true;
        try{
            if(!doc) return;
            if(!w) w=_activeEditBox();   // 20.3 · 인자 없이 불리면 '지금 편집 중인 상자'
            if(!w||!w.dataset) return;
            const pi=+w.dataset.pageIdx, id=w.dataset.id;
            if(!doc.pages||!doc.pages[pi]||id==null) return;
            const el=findEl(pi,id); if(!el) return;
            _editSnap=_editPatch(pi,id,_snapEl(el));
            _editSnapUsed=!_editSnap;
        }catch(e){ _editSnap=null; _editSnapUsed=true; }
    }
    // 20.3 · 긴 타이핑이 되돌리기 한 칸이 되지 않게, 1.2초 이상 멈추면 그때까지
    //   친 글을 하나의 되돌리기 지점으로 확정한다(워드프로세서와 같은 감각).
    //   예전에는 상자 하나를 열어 한참 쓰고 나오면 Ctrl+Z 한 번에 그 글이 통째로
    //   날아가거나(브라우저 기본 undo 가 안 듣는 환경) 아예 안 되돌아갔다.
    let _typingCkT=null;
    function _armTypingCheckpoint(w){
        clearTimeout(_typingCkT);
        _typingCkT=setTimeout(()=>{
            _typingCkT=null;
            try{
                if(!doc||!w||!w.isConnected||!w.classList.contains('edit')) return;
                syncTextEl(w);              // DOM → 문서 확정
                markEditSnapshot();         // 다음 타이핑의 '적기 전' 상태
            }catch(e){}
        },1200);
    }
    function commitEditSnapshot(){
        if(_editSnapUsed||!_editSnap) return false;
        _editSnapUsed=true;
        history.push(_histEntry(null,_editSnap));   // 22.1 · 글상자 패치 한 칸(문서 통째 아님)
        if(history.length>histMax()) history.shift();
        redoStack=[];
        _histT=Date.now();
        return true;
    }

    function syncTextEl(w){
        // 14.15 · 노트를 빠르게 바꾸거나 되돌리기로 다시 그린 뒤에 남은 타이머가
        //   새 노트/새 doc 의 같은 id 요소를 건드리지 않게 한다.
        //   - DOM 이 떨어져 있으면 무시 (다시 그린 화면은 새 타이머를 쓴다)
        //   - 속한 노트나 renderVersion 이 다르면 무시
        if(!w||!w.isConnected) return;
        if(curNB&&w.dataset.nbId&&curNB.id!==w.dataset.nbId) return;
        if(doc&&doc.__rv!=null&&w._sdyRv!=null&&doc.__rv!==w._sdyRv) return;
        const el=findEl(+w.dataset.pageIdx,w.dataset.id); if(!el) return;
        const c=w.querySelector('.tb-content'); if(!c) return;
        const viewOnly=c.innerHTML===w._sdyViewHtml;
        const html=viewOnly?el.html:imathCollapse(stripWF(c.innerHTML));
        const fs=parseFloat(c.style.fontSize)||16;
        // Formatting commands may have changed model-only fields (font, align,
        // cellBg, etc.) before calling us. Those edits still need a dirty page;
        // only a genuinely unchanged view/model pair can take the no-op path.
        if(html===el.html&&fs===el.fontSize&&w._sdyModelKey===JSON.stringify(el)) return;
        markPageEdited(+w.dataset.pageIdx);
        el.html=html; el.fontSize=fs;
        el.x=parseFloat(w.style.left)||0; el.y=parseFloat(w.style.top)||0;
        el.w=w.offsetWidth; el.h=w.offsetHeight;
        w._sdyModelHtml=el.html; w._sdyViewHtml=c.innerHTML; w._sdyModelKey=JSON.stringify(el);
        w.classList.toggle('empty',!String((c.innerText!=null?c.innerText:c.textContent)||'').trim());
        saveDoc();
    }

    let _histT=0, _lastTypeT=0, _scriptEditUndoable=false;
/* APP-PART:07b-hl-band.js:END */
