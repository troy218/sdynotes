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
    // 줄 상자가 닿거나 글꼴 bbox가 조금 겹쳐도 서로 다른 줄은 합치지 않는다.
    // 고정 화면 px 대신 작은 조각 높이의 절반을 기준으로 해 확대/축소에도 같다.
    function _hlSameLine(a,b){
        return Math.min(a.b,b.b)-Math.max(a.t,b.t)>Math.min(a.b-a.t,b.b-b.t)*0.5;
    }
    // PDF 단어 끝의 .zsp(복사/검색용 공백)는 폭이 0이다. 서식 정규화 후에는
    // 일반 trailing space로 남기도 한다. 그 공백이 실제로 칠해진 경우에만
    // 이웃한 절대좌표 단어 사이의 빈 영역을 표시용 조각으로 보충한다.
    // 공백만 선택해도 동작하며, 원문/단어 좌표/공백 문자는 전혀 바꾸지 않는다.
    function _hlSpaceRect(n,c,boxes){
        if(!/[^\S\r\n]$/.test(n.nodeValue||'')) return null;
        const positioned=s=>s&&s.nodeType===1&&s.tagName==='SPAN'&&s.style.position==='absolute';
        let s=n.parentElement;
        while(s&&s!==c&&!positioned(s)) s=s.parentElement;
        if(!s||s===c) return null;
        // 선택한 공백 뒤에 다른 글자/공백이나 줄바꿈이 있으면 단어 끝이 아니다.
        // 빈 편집 마커는 무시하되, 선택하지 않은 뒤쪽 글자를 건너뛰지는 않는다.
        for(let tail=n;tail!==s;tail=tail.parentNode){
            for(let k=tail.nextSibling;k;k=k.nextSibling){
                if(k.textContent||(k.nodeType===1&&(k.tagName==='BR'||k.querySelector('br')))) return null;
            }
        }
        let next=s.nextSibling;
        while(next&&next.nodeType===3&&!next.nodeValue) next=next.nextSibling;
        // 같은 부모 아래 바로 다음 단어만: 문단/열/줄바꿈/이미지 경계를 넘지 않는다.
        if(!positioned(next)) return null;
        const bounds=el=>{
            if(!boxes.has(el)){
                const r=el.getBoundingClientRect();
                boxes.set(el,{l:r.left,t:r.top,rr:r.right,b:r.bottom});
            }
            return boxes.get(el);
        };
        const a=bounds(s), b=bounds(next);
        if(a.rr-a.l<=0.3||b.rr-b.l<=0.3||a.b-a.t<=0.3||b.b-b.t<=0.3
            ||b.l<=a.rr||!_hlSameLine(a,b)) return null;
        return {l:a.rr,t:Math.min(a.t,b.t),rr:b.l,b:Math.max(a.b,b.b)};
    }
    // 텍스트 노드를 실제 화면 선 조각(뷰 좌표)으로 잰다
    function _hlFragRects(run,c){
        const out=[], range=document.createRange();
        const boxes=c&&c.parentElement&&c.parentElement.classList.contains('tight')?new Map():null;
        for(const n of run.nodes){
            let rs=[];
            try{ range.selectNodeContents(n); rs=Array.from(range.getClientRects()); }catch(e){ continue; }
            for(const r of rs){
                if(r&&r.width>0.3&&r.height>0.3)
                    out.push({l:r.left,t:r.top,rr:r.right,b:r.bottom,color:run.color,run:run});
            }
            const space=boxes&&_hlSpaceRect(n,c,boxes);
            if(space) out.push({...space,color:run.color,run:run});
        }
        return out;
    }
    // 같은 줄 조각을 세로 겹침으로 묶고, 같은 선택/색의 닿은 조각만 합친다.
    function _hlBands(frags){
        const rows=[];
        for(const f of frags){
            let row=null;
            for(const r of rows){ if(_hlSameLine(f,r)){ row=r; break; } }
            if(!row){ row={t:f.t,b:f.b,items:[]}; rows.push(row); }
            if(f.t<row.t) row.t=f.t;
            if(f.b>row.b) row.b=f.b;
            row.items.push(f);
        }
        const bands=[];
        for(const row of rows){
            const items=row.items.slice().sort((a,b)=>a.l-b.l);
            let band=null;
            for(const f of items){
                if(band&&band.run===f.run&&band.color===f.color&&f.l-band.rr<=2.5){
                    if(f.rr>band.rr) band.rr=f.rr;
                    if(f.t<band.t) band.t=f.t;
                    if(f.b>band.b) band.b=f.b;
                }else{ band={l:f.l,t:f.t,rr:f.rr,b:f.b,color:f.color,run:f.run}; bands.push(band); }
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
            for(const run of _hlRuns(c,baseHex)) frags=frags.concat(_hlFragRects(run,c));
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
        // 회전한 글상자도 그림·수식처럼 다시 그릴 때 자세를 유지한다
        // (유지하지 않으면 다시 그릴 때마다 똑바로 서서 내보내기와 어긋난다)
        applyBoxRotation(w,el);
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
        c.addEventListener('dblclick',e=>{
            e.stopPropagation();
            if(!pageReady(pageIdx)||w.classList.contains('edit')) return;
            enterEdit(w,true);
            // 14.39.8 · enterEdit 은 focus() 만 하므로 캐럿이 상자 맨 앞으로 간다.
            //   실제 더블클릭은 이 리스너가 편집 진입을 맡으므로(포인터 이벤트의
            //   e.detail 은 Chrome·Edge 에서 항상 0), 캐럿을 눌린 자리로 옮긴다.
            //   preventDefault 는 브라우저의 기본 단어 선택이 이 캐럿을 덮지 않게 막는다.
            e.preventDefault();
            placeCaretFromPointer(w.querySelector('.tb-content')||c,e.clientX,e.clientY);
        });
        // 활성 캐럿 서식은 실제 입력 직전에 wrapper를 확인한다. 빈 span을 브라우저가
        // 정리했더라도 beforeinput 단계에서 복구되므로 첫 글자부터 서식이 빠지지 않는다.
        c.addEventListener('beforeinput',e=>{
            if(!w.classList.contains('edit')) return;
            const it=e.inputType||'';
            // 14.43 · 지우기(Backspace) — 표준 beforeinput 경로(소프트 키보드·IME)에서도
            //   새 줄 머리의 닻(ZWSP)을 먼저 걷어 줄바꿈이 한 번에 지워지게 한다.
            //   (keydown 분기와 같은 일을 한다 — 둘 다 불려도 닻은 한 번만 걷힌다.)
            if(it==='deleteContentBackward'){
                if(w._sdyTightLine&&_tightLineBackspace(c,w)){ e.preventDefault(); return; }
                _dropAnchorsBeforeCaret(c);
                return;
            }
            if(it==='insertParagraph'||it==='insertLineBreak'){
                // Enter(Shift+Enter) 줄바꿈: 캐럿 앞 글자의 서식을 다음 줄 입력으로
                // 이어받는다. 예전엔 앞 글자가 서식된 채로 줄만 바꾸면 다음 줄이
                // 기본 서식으로 풀렸다(_pendingTyping 이 '툴바로 방금 정한 서식'만
                // 기억했기 때문). 서식이 없으면 아무것도 하지 않는다.
                _captureLineBreakInherit(c);
                _ensurePendingTypingSpan(c);
            }else if(!it||it.indexOf('insert')===0){
                _ensurePendingTypingSpan(c);
            }
        });
        // beforeinput이 없는 구형 WebView용 선행 fallback (조합 중에는 keydown이 없어도
        // 표준 beforeinput이 오며, 둘 다 없는 환경은 아래 input에서 다음 글자를 복구).
        c.addEventListener('keydown',e=>{
            // 14.40 · 줄 흐름(논문) 상자 — 엔터=캐럿 위치 줄 분할.
            //   브라우저 기본 <div> 대신 원문 줄 간격에 맞춘 .sdy-tl 을 만들고,
            //   원문 줄은 절대 위치라 이동하지 않는다.
            if(w.classList.contains('edit')&&w._sdyTightLine&&e.key==='Enter'
               &&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!(e.isComposing||e.keyCode===229)){
                e.preventDefault();
                _tightLineEnter(c,w);
                return;
            }
            // 14.43 · Backspace — '눈에 안 보이는 입력 닻'을 먼저 걷어낸다.
            //   Enter 로 줄을 나누면(14.41) 새 줄 머리에 서식 이어받기용 .sdy-type
            //   닻(ZWSP)이 놓인다. 그대로 두면 Backspace 는 그 닻을 '글자 하나'로
            //   먼저 지운다 → 화면은 그대로인데 줄은 남고, input 핸들러가 닻을 다시
            //   심어 줄바꿈이 영영 안 지워졌다(보고: "엔터 후 백스페이스가 안 먹고
            //   이전 글자로 가서 딜리트를 눌러야 지워진다").
            //   → 캐럿 앞이 '닻뿐'이면 닻을 미리 걷어 Backspace 한 번에 줄이 합쳐지게
            //   한다. 실제 글자가 앞에 있으면 아무것도 건드리지 않는다(한 글자 지우기).
            if(w.classList.contains('edit')&&e.key==='Backspace'
               &&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!(e.isComposing||e.keyCode===229)){
                if(w._sdyTightLine&&_tightLineBackspace(c,w)){ e.preventDefault(); return; }
                _dropAnchorsBeforeCaret(c);   // 닻만 걷고 브라우저 기본(줄 합치기)에 맡긴다
                return;
            }
            // 14.39.11 · 일반 글상자: Enter(Shift+Enter) 줄바꿈 시 앞 글자의
            //   인라인 서식을 다음 줄로 이어받는다(서식 풀림 버그 수정).
            if(!w.classList.contains('edit')||e.ctrlKey||e.metaKey||e.altKey
               ||e.isComposing||e.keyCode===229) return;
            if(e.key==='Enter'){
                _captureLineBreakInherit(c);
                _ensurePendingTypingSpan(c);
            }else if(e.key.length===1){
                _ensurePendingTypingSpan(c);
            }
        });
        // 한글 IME 조합 중에는 타이핑 span 안 텍스트 노드를 건드리지 않는다 —
        // 조합 중인 노드를 고치면 조합이 끊겨 자모가 따로 확정되기 때문.
        // 조합이 끝나는 순간(input isComposing=false·compositionend) 닻을 치운다.
        c.addEventListener('compositionstart',()=>{ c._sdyComposing=true; });
        c.addEventListener('compositionend',()=>{
            c._sdyComposing=false;
            try{ _cleanTypingMarks(c); }catch(e){}
        });
        c.addEventListener('input',e=>{
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
            // 14.43 · 지우기(Backspace/Delete) 뒤에는 닻을 다시 심지 않는다 — 방금
            //   걷어낸 자리에 닻이 되살아나면 Backspace 가 또 닻만 먹고 줄바꿈을
            //   지우지 못한다. (서식은 _pendingTyping 에 남아 다음 글자에 되살아난다.)
            const _delIt=String((e&&e.inputType)||'');
            if(w.classList.contains('edit')&&!(_delIt&&_delIt.indexOf('delete')===0))
                _ensurePendingTypingSpan(c);
            // 타이핑 span 에 실제 글자가 들어왔으면 눈에 안 보이는 닻(ZWSP)을 치운다.
            // 조합 중에는 건드리지 않는다(위 compositionstart/end 참조).
            if(!c._sdyComposing&&!(e&&e.isComposing)){ try{ _cleanTypingMarks(c); }catch(_e){} }
            // 14.39.9 · tight 편집 중 타이핑 후 즉시 단어 맞춤 재실행.
            //   syncTextEl(300ms 뒤)까지 기다리면 그 사이 글자가 span 을 넘어 보인다.
            if(w._sdyTightEdit&&el.tight&&typeof _queueTightFit==='function'){
                try{ _queueTightFit(c,el); }catch(_e){}
            }
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
        // 14.40 · 줄 흐름 상자는 다시 그려도(콜라보 동기화 등) 엔터 분할이 살아야 한다
        if(el.tight&&c.querySelector(':scope>.sdy-tl')) w._sdyTightLine=1;
        const viewOnly=c.innerHTML===w._sdyViewHtml;
        // 타이핑 닻(ZWSP·빈 sdy-type span)은 저장 문자열에서 걷어낸다 — 문서에 남지 않게.
        const html=viewOnly?el.html:_stripTypingMarkersHtml(imathCollapse(stripWF(c.innerHTML)));
        const fs=parseFloat(c.style.fontSize)||16;
        // Formatting commands may have changed model-only fields (font, align,
        // cellBg, etc.) before calling us. Those edits still need a dirty page;
        // only a genuinely unchanged view/model pair can take the no-op path.
        if(html===el.html&&fs===el.fontSize&&w._sdyModelKey===JSON.stringify(el)) return;
        const textChanged=html!==el.html;   // 글자 본문이 실제로 바뀌었는가 (저장 전 비교)
        markPageEdited(+w.dataset.pageIdx);
        el.html=html; el.fontSize=fs;
        // 14.39.9 · tight 상자는 텍스트를 고쳐도 절대좌표 배치를 유지한다.
        //   흐름 텍스트로 변환했던 옛 경로(_sdyWasTight)만 확정한다.
        if(w._sdyWasTight&&textChanged) _finalizeTightEdit(w,el);
        el.x=parseFloat(w.style.left)||0; el.y=parseFloat(w.style.top)||0;
        // 회전한 상자의 offset 크기는 외접 박스라서 그대로 쓰면 상자가 부풀며
        // 자리가 어긋난다 → 똑바로 선 상자만 실측 크기를 되받는다.
        if(!normalizedRotation(el.rotation)){ el.w=w.offsetWidth; el.h=w.offsetHeight; }
        w._sdyModelHtml=el.html; w._sdyViewHtml=c.innerHTML; w._sdyModelKey=JSON.stringify(el);
        w.classList.toggle('empty',!String((c.innerText!=null?c.innerText:c.textContent)||'').trim());
        // 14.39.9 · tight 상자 서식 변경 후 단어 맞춤을 다시 돌린다.
        //   글꼴·크기가 바뀌면 각 span 의 자연 폭이 달라지므로 scaleX 를 재계산해야
        //   원본 배치가 유지된다. 편집 중(_sdyTightEdit)과 선택 상태 모두 포함.
        if(el.tight&&w.classList.contains('tight')&&!w._sdyWasTight&&typeof _queueTightFit==='function'){
            try{ _queueTightFit(c,el); }catch(_e){}
        }
        saveDoc();
    }

/* ════════════════════════════════════════════════════════════════
   14.40 · 논문(tight) 상자 편집: 줄 단위 절대위치 + 줄 내 인라인 흐름
   ─────────────────────────────────────────────────────────────
   편집 진입 시 단어별 절대 스팬을 한 번만 변환한다:
     · 줄 = <div class="sdy-tl" style="position:absolute;top:원본위치">
       → 줄이 절대 위치에 박혀 어떤 입력에도 세로로 이동하지 않는다.
     · 줄 안 단어 = 인라인 스팬(원본 폰트/크기/굵기/색/이탈릭 보존)
       → 드래그 선택·방향키(상하=줄 이동)·형광펜이 일반 텍스트처럼 동작.
     · 단어 간격 = 실공백 + (.sdy-tg) 실측 스페이서로 원본 갭 복원.
   그 뒤는 브라우저 기본 동작 그대로다. tight fit 의 scaleX 재계산은
   '직접 자식 절대 스팬'만 대상이라 줄 흐름에서는 아무것도 안 움직인다.
   엔터만 캐럿 위치에서 줄을 나누어 아래(원문 줄 간격)에 새 줄을 만든다.
   ════════════════════════════════════════════════════════════════ */
function _tightWordW(s){
    if(s.dataset&&s.dataset.pdfW){ const n=parseFloat(s.dataset.pdfW); if(n>0) return n; }
    let w=s.scrollWidth;
    if(s.style.transform&&s.style.transform.indexOf('scaleX')>=0){
        const m=s.style.transform.match(/scaleX\(\s*([0-9.]+)\s*\)/);
        if(m&&+m[1]>0) w=w*(+m[1]);
    }
    return w;
}
function _tightWordText(s){
    const cl=s.cloneNode(true);
    cl.querySelectorAll('.zsp,br,img').forEach(z=>z.remove());
    return (cl.textContent||'').replace(/[\u200b\u200c\u200d\ufeff]/g,'').trim();
}
// '자연 공백 폭' 실측 — 같은 글꼴 환경에서 공백 하나를 넣어 재는 것.
// 스페이서 폭 = 원본 갭 − 이 값 으로 계산해 화면이 겉보기 그대로다.
function _tightGapW(c,ff,fs){
    try{
        const p=document.createElement('span');
        p.style.cssText='position:absolute;left:-9999px;top:0;visibility:hidden;line-height:1;white-space:pre;'+
            (ff?('font-family:'+ff+';'):'')+'font-size:'+(fs||16)+'px;';
        p.textContent=' ';
        c.appendChild(p);
        const w=p.offsetWidth;
        p.remove();
        return w;
    }catch(e){ return (fs||16)*0.28; }
}
function _tightToLineFlow(c){
    if(!c) return null;
    const sps=Array.from(c.children).filter(s=>s.tagName==='SPAN');
    if(!sps.length) return null;   // 이미 줄 흐름(DIV 자식)이면 그대로
    const pos=sps.filter(s=>{
        const st=s.style;
        return (st&&st.position==='absolute')
            ||(st&&(parseFloat(st.top)>0||parseFloat(st.left)>0))
            ||(s.dataset&&s.dataset.pdfW);
    });
    if(!pos.length) return null;
    // 이전 맞춤(scaleX) 배율 — '있는 그대로'의 폭을 되돌린다
    const scale=pos.map(s=>{
        const t=s.style.transform; let k=1;
        if(t&&t.indexOf('scaleX')>=0){ const m=t.match(/scaleX\(\s*([0-9.]+)\s*\)/); if(m) k=Math.max(0.05,+m[1]); }
        return k;
    });
    const words=[];
    pos.forEach((s,i)=>{
        const st=s.style;
        const t=parseFloat(s.dataset.origTop!=null?s.dataset.origTop:st.top);
        const l=parseFloat(st.left)||0;
        const fs=parseFloat(st.fontSize)||16;
        const txt=_tightWordText(s);
        if(!txt) return;
        const top=isNaN(t)?0:t;
        const style=[
            st.fontSize?'font-size:'+st.fontSize:'',
            st.fontFamily?'font-family:'+st.fontFamily:'',
            st.fontWeight?'font-weight:'+st.fontWeight:'',
            st.fontStyle&&st.fontStyle!=='normal'?'font-style:'+st.fontStyle:'',
            st.color?'color:'+st.color:'',
            st.backgroundColor&&st.backgroundColor!=='rgba(0, 0, 0, 0)'?'background-color:'+st.backgroundColor:'',
            st.textDecoration&&st.textDecoration!=='none'?'text-decoration:'+st.textDecoration:'',
            st.verticalAlign&&st.verticalAlign!=='baseline'?'vertical-align:'+st.verticalAlign:''
        ].filter(Boolean).join(';');
        // bot = 글자 칸의 아래쪽(원문 글자 크기만큼). 줄 묶음이 '세로로 겹치는가' 를
        //   볼 때 쓴다 — 위/아래 첨자·기호는 top 이 홀로 튀므로 top 만 보면 안 된다.
        words.push({top:top, bot:top+Math.max(2,fs), left:isNaN(l)?0:l, fs:fs,
            adv:_tightWordW(s)*scale[i], txt:txt, style:style, ff:st.fontFamily||''});
    });
    if(!words.length) return null;
    // 14.43 · 줄 묶음은 'top 이 2px 안'이 아니라 '세로 구간이 겹치는가'로 판정한다.
    //   PDF 한 줄에는 크기가 다른 글자(제목·기호)나 위/아래 첨자가 섞인다. top 만
    //   보면 그런 글자들이 딴 줄로 튀고, 각 줄(.sdy-tl)은 left:0 에 붙어 펼쳐지므로
    //   원래 그 자리에 있던 원문 글자와 겹쳐 보였다(보고: "더블클릭하면 일부 글자가
    //   왼쪽에 붙어 다른 글자와 겹친다"). 겹치는 폭이 '작은 쪽 글자 칸'의 절반
    //   이상이면 같은 줄로 묶는다 — 반대로 줄 간격이 촘촘한 두 원문 줄은 겹치는
    //   폭이 작아 갈리므로 절대 합쳐지지 않는다.
    const rows=[];
    words.sort((a,b)=>a.top-b.top||a.left-b.left);
    for(const wd of words){
        const last=rows[rows.length-1];
        if(last){
            const ov=Math.min(last.bot,wd.bot)-Math.max(last.top,wd.top);
            const small=Math.min(last.bot-last.top,wd.bot-wd.top);
            if(ov>0&&ov>=small*0.5){
                last.items.push(wd);
                if(wd.top<last.top) last.top=wd.top;      // 줄의 위쪽 = 가장 높은 글자
                if(wd.bot>last.bot) last.bot=wd.bot;
                continue;
            }
        }
        rows.push({top:wd.top, bot:wd.bot, items:[wd]});
    }
    rows.forEach(r=>r.items.sort((a,b)=>a.left-b.left));
    const gapCache=new Map();
    const gapOf=(ff,fs)=>{
        const k=ff+'|'+fs;
        if(!gapCache.has(k)) gapCache.set(k,_tightGapW(c,ff,fs));
        return gapCache.get(k);
    };
    const frag=document.createDocumentFragment();
    rows.forEach((r,ri)=>{
        const nextTop=ri<rows.length-1?rows[ri+1].top:Infinity;
        const maxFs=r.items.reduce((m,x)=>Math.max(m,x.fs),0);
        const h=nextTop===Infinity?Math.max(maxFs*1.6,4):Math.max(2,nextTop-r.top);
        const d=document.createElement('div');
        d.className='sdy-tl';
        d.style.cssText='position:absolute;left:0;width:100%;top:'+r.top.toFixed(1)+'px;height:'+h.toFixed(1)+'px;line-height:'+maxFs.toFixed(1)+'px;white-space:normal;';
        r.items.forEach((wd,wi)=>{
            if(wi>0){
                const gap=wd.left-(r.items[wi-1].left+r.items[wi-1].adv);
                const nat=gapOf(r.items[wi-1].ff||wd.ff,r.items[wi-1].fs||wd.fs);
                const extra=Math.round((Math.max(0,gap)-nat)*4)/4;
                d.appendChild(document.createTextNode(' '));
                if(extra>0.5){
                    const g=document.createElement('span');
                    g.className='sdy-tg';
                    g.style.cssText='display:inline-block;width:'+extra.toFixed(1)+'px;height:0;overflow:hidden;vertical-align:bottom;';
                    d.appendChild(g);
                }
            }
            const sp=document.createElement('span');
            sp.style.cssText=wd.style+';line-height:1;white-space:nowrap;';
            sp.textContent=wd.txt;
            d.appendChild(sp);
        });
        frag.appendChild(d);
    });
    return frag;
}
// 14.40 · 줄 흐름 상자 엔터 — 캐럿 위치에서 줄을 나눈 뒤, 그 아래(원문 줄
// 간격만큼)에 새 줄을 만든다. 원문 줄은 절대 위치라 어느 쪽도 이동하지 않는다.
function _tightLineEnter(c,w){
    try{
        const sel=window.getSelection();
        if(!sel||!sel.rangeCount) return;
        let r=sel.getRangeAt(0).cloneRange();
        if(!r.collapsed){
            r.deleteContents();
            sel.removeAllRanges();
            r=sel.rangeCount?sel.getRangeAt(0).cloneRange():document.createRange();
            r.collapse(true);
            if(!c.contains(r.startContainer)) return;
        }
        // 14.41 · Enter 전 '이어받을 서식': 캐럿이 서식 입력 span(.sdy-type) 안이면
        //   그 span 의 서식, 아니면 캐럿 앞 글자에 실제로 먹은 유효 서식.
        //   예전엔 여기서 아무것도 물려주지 않아 '서식 유지 채로 Enter' 한 뒤
        //   새 줄에 치는 글자가 상자 기본 서식으로 풀렸다 (보고).
        let carry=null;
        try{
            const cc=r.startContainer;
            let mk=null;
            if(cc&&cc.nodeType===3&&cc.parentElement&&cc.parentElement.classList
               &&cc.parentElement.classList.contains('sdy-type')) mk=cc.parentElement;
            else if(cc&&cc.nodeType===1&&cc.classList&&cc.classList.contains('sdy-type')) mk=cc;
            if(mk&&mk.style&&mk.style.cssText){
                carry={};
                for(const k of INLINE_STYLE_PROPS){
                    const v=mk.style[k];
                    if(v&&String(v).trim()) carry[k]=String(v).trim();
                }
            }
            if((!carry||!Object.keys(carry).length)&&cc&&cc.nodeType===3){
                // 캐럿이 빈 텍스트 노드(입력 직후 남는 껍데기 등)에 걸렸으면
                // '그 앞 글자'의 서식을 이어받는다 — 빈 노드는 서식이 없어
                // 엔터 뒤 새 줄이 기본 서식으로 풀리는 원인이 된다.
                let t=cc;
                const bare=String(t.nodeValue||'').replace(/[\u200b\u200c\u200d\ufeff]/g,'');
                if(!bare&&t.previousSibling&&t.previousSibling.nodeType===3) t=t.previousSibling;
                const st=(typeof _typingStylesFromNode==='function')
                    ?(_typingStylesFromNode(t,c)||{})
                    :{};
                if(Object.keys(st).length) carry=st;
            }
        }catch(_e){}
        let p=(r.startContainer.nodeType===3)?r.startContainer.parentElement:r.startContainer;
        let line=null;
        while(p&&p!==c){
            if(p.classList&&p.classList.contains('sdy-tl')){ line=p; break; }
            p=p.parentElement;
        }
        if(!line){
            const lines=Array.from(c.children).filter(x=>x.classList&&x.classList.contains('sdy-tl'));
            if(!lines.length) return;
            line=lines[lines.length-1];
            const er=document.createRange();
            er.selectNodeContents(line); er.collapse(false);
            sel.removeAllRanges(); sel.addRange(er);
            r=er;
        }
        const top=parseFloat(line.style.top)||0;
        const pitch=parseFloat(line.style.height)||line.offsetHeight||20;
        const afterR=document.createRange();
        afterR.setStart(r.startContainer,r.startOffset);
        afterR.setEnd(line,line.childNodes.length);
        const afterFrag=afterR.extractContents();
        const afterText=String(afterFrag.textContent||'').replace(/[\u200b\u200c\u200d\ufeff]/g,'').trim();
        const nl=document.createElement('div');
        nl.className='sdy-tl';
        nl.style.cssText='position:absolute;left:0;width:100%;top:'+(top+pitch).toFixed(1)+'px;height:'+pitch.toFixed(1)+'px;white-space:normal;';
        if(!afterText){ while(afterFrag.firstChild) afterFrag.removeChild(afterFrag.firstChild); nl.appendChild(document.createElement('br')); }
        nl.appendChild(afterFrag);
        if(line.parentNode) line.parentNode.insertBefore(nl,line.nextSibling);
        // 14.42 · 원문 '중간 줄'에서 Enter — 방금 끼운 새 줄이 절대 위치라
        //   그대로 두면 다음 원문 줄과 같은 top 에 놓여 겹친다. 그래서 이 줄
        //   아래의 모든 .sdy-tl 을 새 줄 높이만큼 아래로 내린다.
        //   (원칙 '원문 줄은 입력에 절대 안 움직인다'는 의도치 않은 이동 금지
        //   를 위한 것이고, 사용자가 중간에 문단을 끼워 넣는 명시적 Enter 는
        //   뒤따르는 원문 줄이 한 줄 내려가 공간을 만드는 것이 자연스럽다 —
        //   읽는 순서·줄 간격은 그대로 유지된다.) 마지막 줄 뒤라면 밀 줄이 없다.
        if(line.nextSibling&&nl.nextSibling){
            let nx=nl.nextSibling;
            while(nx){
                if(nx.nodeType===1&&nx.classList&&nx.classList.contains('sdy-tl')){
                    const cur=parseFloat(nx.style.top)||0;
                    nx.style.top=(cur+pitch).toFixed(1)+'px';
                }
                nx=nx.nextSibling;
            }
        }
        if(!String(line.textContent||'').replace(/[\u200b\u200c\u200d\ufeff]/g,'').trim()&&!line.querySelector('img')) line.appendChild(document.createElement('br'));
        // 캐럿 → 새 줄의 맨 앞. 물려줄 서식이 있고, 새 줄 첫 글자가 이미 그
        //   서식을 갖고 있지 않으면 입력 대기 span(.sdy-type + 닻)을 새 줄
        //   머리에 심고 그 안(닻 뒤)에 캐럿을 둔다 — 다음 글자부터 서식 유지.
        let placed=false;
        if(carry&&Object.keys(carry).length){
            // 물려줄 서식이 있으면 새 줄 맨 앞에 입력 대기 span(.sdy-type+닻)을
            // 항상 심고 그 안(닻 뒤)에 캐럿을 둔다. (빈 껍데기 span 이나 공백으로
            // 시작하는 꼬리·빈 문단이어도 상관없다 — 다음 글자부터 carry 서식으로
            // 시작된다.) 새 줄 첫 꼬리 글자가 이미 그 서식이어도 마커 span 하나가
            // 더 붙는 것뿐이며, 캐럿이 '서식 span 안'에서 시작돼야 이어 쓰는
            // 글자의 크기·글꼴이 보장된다(줄 바깥 기본 서식으로 튀지 않는다).
            try{
                const sp=document.createElement('span');
                sp.className='sdy-type';
                for(const k in carry){
                    try{ _setInlineProp(sp,k,carry[k]); }catch(_e){}
                }
                sp.appendChild(document.createTextNode('\u200B'));
                nl.insertBefore(sp,nl.firstChild);
                const tn=sp.firstChild;
                const cr=document.createRange();
                cr.setStart(tn,1); cr.collapse(true);
                sel.removeAllRanges(); sel.addRange(cr);
                _typingSpan=sp;
                try{ if(typeof _rememberTypingStyles==='function') _rememberTypingStyles(sp,c); }
                catch(_e){ _pendingTyping={host:c,styles:carry}; }
                placed=true;
            }catch(_e){}
        }
        if(!placed){
            const cr=document.createRange();
            const f0=afterFrag.firstChild;
            if(f0&&f0.nodeType===3) cr.setStart(f0,0);
            else if(f0&&f0.nodeType===1&&f0.tagName!=='BR'){ cr.selectNodeContents(f0); cr.collapse(true); }
            else cr.setStart(nl,0);
            cr.collapse(true);
            sel.removeAllRanges(); sel.addRange(cr);
        }
        w._caretV=(w._caretV||0)+1;
        try{ saveSel(); }catch(e2){}
        if(w.classList.contains('edit')){ commitEditSnapshot(); _armTypingCheckpoint(w); }
    }catch(e){}
}

/* ════════════════════════════════════════════════════════════════
   14.43 · Backspace 로 '엔터 줄바꿈'을 한 번에 지우기
   ─────────────────────────────────────────────────────────────
   Enter 는 새 줄 머리에 서식 이어받기용 .sdy-type 닻(ZWSP)을 심는다(14.41).
   그 닻은 눈에 보이지 않지만 '글자 하나'이므로 Backspace 가 그것을 먼저 먹고
   줄바꿈은 남는다 → 사용자는 "백스페이스가 안 먹는다"고 느낀다.
   그래서 Backspace 를 누른 순간 '캐럿 앞이 닻뿐'인지 먼저 보고
     · 닻뿐이면 닻을 걷어 브라우저 기본 동작(줄 합치기)이 그대로 일어나게 한다.
     · 줄 흐름(tight · .sdy-tl)이면 14.42 가 내려놓은 아래 원문 줄까지 올려
       직접 합친다(안 그러면 줄은 지워져도 빈 칸이 남는다).
     · 실제 글자가 앞에 있으면 아무것도 건드리지 않는다(한 글자 지우기 그대로).
   ════════════════════════════════════════════════════════════════ */
const _SDY_ANCHOR_RE=/[\u200b\u200c\u200d\ufeff]/g;
// 캐럿이 속한 '줄/문단' 요소 (줄 흐름은 .sdy-tl, 일반 상자는 div/p 또는 상자 자신)
function _caretBlock(host,r){
    let n=(r.startContainer&&r.startContainer.nodeType===3)
        ?r.startContainer.parentElement:r.startContainer;
    while(n&&n!==host){
        if(n.classList&&(n.classList.contains('sdy-tl')||n.tagName==='DIV'||n.tagName==='P')) return n;
        n=n.parentElement;
    }
    return host;
}
// '블록 맨 앞 ~ 캐럿' 사이에 실제 글자는 없고 닻(ZWSP)만 있는가
function _anchorOnlyBefore(block,r){
    try{
        const seg=document.createRange();
        seg.setStart(block,0);
        seg.setEnd(r.startContainer,r.startOffset);
        const raw=String(seg.toString()||'');
        return raw.length>0&&raw.replace(_SDY_ANCHOR_RE,'').length===0;
    }catch(e){ return false; }
}
// 닻만 걷어 브라우저 기본 Backspace(줄 합치기)가 일어나게 한다. 먹은 닻이 있으면 true.
function _dropAnchorsBeforeCaret(host){
    try{
        const s=window.getSelection();
        if(!s||!s.rangeCount||!s.isCollapsed) return false;      // 선택 지우기는 기본 동작
        const r=s.getRangeAt(0);
        if(!r||!host.contains(r.startContainer)) return false;
        const block=_caretBlock(host,r);
        if(!_anchorOnlyBefore(block,r)) return false;            // 앞에 실제 글자가 있다
        const seg=document.createRange();
        seg.setStart(block,0); seg.setEnd(r.startContainer,r.startOffset);
        seg.deleteContents();
        const cr=document.createRange();
        cr.setStart(block,0); cr.collapse(true);
        s.removeAllRanges(); s.addRange(cr);
        return true;
    }catch(e){ return false; }
}
// 14.43 · 줄 흐름(tight) 전용 — 캐럿이 줄 맨 앞일 때 윗줄과 합치고,
//   Enter 가 밀어 내린 아래 원문 줄들을 다시 올린다(빈 칸이 남지 않게).
function _tightLineBackspace(c,w){
    try{
        const sel=window.getSelection();
        if(!sel||!sel.rangeCount||!sel.isCollapsed) return false;
        const r=sel.getRangeAt(0);
        if(!r||!c.contains(r.startContainer)) return false;
        let line=(r.startContainer.nodeType===3)?r.startContainer.parentElement:r.startContainer;
        while(line&&line!==c&&!(line.classList&&line.classList.contains('sdy-tl'))) line=line.parentElement;
        if(!line||line===c) return false;
        if(!_anchorOnlyBefore(line,r)) return false;             // 앞에 실제 글자 → 한 글자 지우기
        const prev=line.previousElementSibling;
        if(!prev||!prev.classList||!prev.classList.contains('sdy-tl')) return false;   // 첫 줄
        const pitch=(parseFloat(line.style.top)||0)-(parseFloat(prev.style.top)||0);
        // ① 줄 머리의 닻(ZWSP)을 걷어낸다 — 남으면 윗줄 끝에 빈 span 이 붙는다.
        const seg=document.createRange();
        seg.setStart(line,0); seg.setEnd(r.startContainer,r.startOffset);
        seg.deleteContents();
        // ② 남은 내용을 윗줄 끝으로 옮긴다 (엔터 직후의 빈 줄이면 옮길 것이 없다)
        const rest=String(line.textContent||'').replace(_SDY_ANCHOR_RE,'');
        const keep=rest.length>0||!!line.querySelector('img,svg,canvas');
        if(keep){
            // 윗줄이 '빈 줄'(<br> 하나)이면 그 <br> 을 먼저 걷어낸다
            if(!String(prev.textContent||'').replace(_SDY_ANCHOR_RE,'').trim()
               &&prev.lastChild&&prev.lastChild.tagName==='BR') prev.lastChild.remove();
            while(line.firstChild){
                const ch=line.firstChild;
                // 닻을 걷어내고 남은 '빈 입력 대기 span' 은 옮기지 않는다
                if(ch.nodeType===1&&ch.classList&&ch.classList.contains('sdy-type')
                   &&!String(ch.textContent||'').replace(_SDY_ANCHOR_RE,'')){ ch.remove(); continue; }
                prev.appendChild(ch);
            }
        }
        const mark=prev.lastChild;
        line.remove();
        // ③ 아래 원문 줄을 한 줄 위로 — 14.42 가 내려놓은 만큼을 되돌린다.
        if(pitch>0){
            for(let nx=prev.nextElementSibling;nx;nx=nx.nextElementSibling){
                if(nx.classList&&nx.classList.contains('sdy-tl'))
                    nx.style.top=((parseFloat(nx.style.top)||0)-pitch).toFixed(1)+'px';
            }
        }
        // ④ 캐럿 → 두 줄이 합쳐진 자리
        const cr=document.createRange();
        if(mark&&mark.parentNode===prev) cr.setStartAfter(mark); else cr.setStart(prev,0);
        cr.collapse(true);
        sel.removeAllRanges(); sel.addRange(cr);
        w._caretV=(w._caretV||0)+1;
        try{ saveSel(); }catch(_e){}
        if(w.classList.contains('edit')){ commitEditSnapshot(); _armTypingCheckpoint(w); }
        clearTimeout(w._t); w._t=setTimeout(()=>{ syncTextEl(w); },300);
        return true;
    }catch(e){ return false; }
}

    let _histT=0, _lastTypeT=0, _scriptEditUndoable=false;
/* APP-PART:07b-hl-band.js:END */
