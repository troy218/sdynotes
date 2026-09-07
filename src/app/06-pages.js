/* === src/app/06-pages.js ===
   페이지 렌더 · 가상화 · 읽기우선 · 다중선택
   (sdynotes.js 메가 분리 · 이 파일들은 scripts/bundle-frontend.mjs 가 순서대로 이어 붙인다.
    let/const 스코프를 공유하려면 반드시 concat 되어야 한다 — 단독 <script> 로드 금지) */
/* APP-PART:06-pages.js:BEGIN */
    // ============ 페이지 렌더 · 셸 가상화 ============
    // 500쪽이 넘는 문서를 열어도 한 번에 500장의 종이를 만들지 않는다.
    //   ① 스테이지 높이만 전체 쪽수로 잡아 스크롤 막대 길이는 정확히 유지한다.
    //   ② 화면에 걸치는 쪽 ± 여유분만 실제 DOM(page-wrap)으로 올린다 → '셸 창'
    //   ③ 그 안에서 다시 현재 쪽 ±1 만 요소를 그린다              → '요소 창'
    // 종이는 absolute + top 계산 배치라서 중간이 비어도 스크롤 위치가 어긋나지
    // 않는다(스페이서가 필요 없다). 그래서 5쪽이든 5000쪽이든 DOM 비용이 같다.
    //
    // 예전 구조(전 쪽 셸 생성 + IntersectionObserver 두 개)는 지웠다.
    //   · 셸 500개 = 노드 5천 개 + observe 1000회 → 여는 순간 멎었다.
    //   · IO 는 transform 조상·빠른 점프에서 콜백을 놓쳐 빈 종이 회귀가 잦았다.
    //   지금은 스크롤 위치에서 창을 '계산'하므로 놓칠 콜백 자체가 없다.
    const renderedPages=new Set();    // 요소까지 그려 둔 쪽
    const mountedShells=new Map();    // 화면에 올려 둔 종이 (pageIdx → .page-wrap)
    // 14.30.0 · 저사양 기기 감지 — 코어/메모리가 적으면 배경 작업을 줄이고
    //   렌더 청크를 작게 해 '입력이 밀리는 버벅임'을 막는다.
    //   (localStorage sdy_lowend/sdy_perf = '1'/'0' 으로 강제할 수 있다.
    //    감지가 애매한 기기에서는 실제 지연을 재서 한 번만 판정한다.)
    let _lowEnd=null;
    function sdyLowEnd(){
        if(_lowEnd!==null) return _lowEnd;
        let v=null;
        try{ v=localStorage.getItem('sdy_perf')||localStorage.getItem('sdy_lowend'); }catch(e){}
        if(v==='1'||v==='turbo'){ _lowEnd=true; return _lowEnd; }
        if(v==='0'||v==='off'){ _lowEnd=false; return _lowEnd; }
        try{ if(/[?&]turbo=1/.test(location.search)){ _lowEnd=true; return _lowEnd; } }catch(e){}
        let score=0;
        try{
            const nav=navigator||{};
            if(nav.hardwareConcurrency){
                if(nav.hardwareConcurrency<=2) score+=4;
                else if(nav.hardwareConcurrency<=4) score+=2;
                else if(nav.hardwareConcurrency<=8) score+=1;
            }else score+=1;                     // 모름 → 보수적으로 취급
            if(nav.deviceMemory){
                if(nav.deviceMemory<=2) score+=5;
                else if(nav.deviceMemory<=4) score+=3;
                else if(nav.deviceMemory<=8) score+=1;
            }
            if(nav.platform&&/MacIntel|Win32|Linux x86_64/.test(nav.platform)&&!nav.deviceMemory&&score===0) score=0;
        }catch(e){ score=1; }
        // 22.x · '아주 똥컴'도 바로 잡히도록 임계를 낮춘다: 2코어+2GB, 4코어+4GB
        //   같은 주요 저성능 조합이면 자동으로 경량 모드가 켜진다.
        _lowEnd=score>=5;
        return _lowEnd;
    }
    // 저사양/경량 모드로 판정되면 추가로 UI 장식(오로라·집게 애니메이션·blur)을
    //   끄고, 쪽 DOM·미리보기·프리필을 더 아낀다. '지난번(읽기 우선 + 셸 가상화)
    //   의 결과를 유지하면서 그 창을 더 작게, 그리고 더 싸게' 하는 구조다.
    function sdyTurbo(){ return sdyLowEnd(); }
    try{ window.sdyTurbo=sdyTurbo; window.sdyLowEnd=sdyLowEnd; }catch(e){}
    function _applyTurboMode(){
        try{
            const on=sdyTurbo();
            document.body.classList.toggle('sdy-turbo',on);
            if(on) document.documentElement.setAttribute('data-sdy-perf','turbo');
            else document.documentElement.removeAttribute('data-sdy-perf');
        }catch(e){}
    }
    try{ _applyTurboMode(); }catch(e){}
    // 경량 모드의 셸/요소 창 상수는 '판정 후' 값이어야 한다 (고정 const 를
    //   여러 곳에서 복사하지 않도록 함수 한 곳에서만 계산한다)
    function shellPad(){ return sdyTurbo()?0:2; }
    function shellMax(){ return sdyTurbo()?8:24; }
    function renderRadius(){ return sdyTurbo()?0:1; }
    function keepRadius(){ return sdyTurbo()?1:2; }
    function fillIdle(){ return sdyTurbo()?70:90; }
    function fillMaxGap(){ return sdyTurbo()?160:220; }
    let _nbrTimer=null;               // 이웃 쪽 요소 렌더 지연 타이머 (현재 쪽 우선)
    const UNLOAD_GRACE=1200;          // 방금 그린 쪽은 이 시간 안에 경계를 넘어도 바로 내리지 않는다
    const _pageRenderTok={};          // 같은 쪽을 다시 그리거나 비우면 이전 청크 루프를 버린다
    const _renderedAt={};             // 쪽별 마지막 요소 렌더 시각 — 회수 유예 판단용
    // 준비 중과 준비 완료를 구분한다. renderedPages 는 DOM을 가진 쪽(부분 렌더 포함),
    // _pageRenderJobs 는 진행 중 작업이다. 활성화는 요청이지 완료 신호가 아니다.
    const _pageRenderJobs=new Map();
    let _pageRenderFrame=0;
    let _virtualTimer=null;
    let _lastFillAt=0;
    let _shellWin={first:0,last:-1};

    function pageStep(){ const s=paperSize(); return (s.h+PAGE_GAP)*pageScale; }
    function pageTopPx(i){ const s=paperSize(); return i*(s.h+PAGE_GAP)*pageScale; }

    // 종이 한 장(셸)을 만든다 — 내용(요소)은 renderPageEls 가 따로 채운다.
    function buildPageShell(i){
        const size=paperSize();
        const wrap=document.createElement('div');
        wrap.className='page-wrap';
        wrap.dataset.pageIdx=i;

        const label=document.createElement('div');
        label.className='page-label';
        label.innerHTML=`<span>페이지 ${i+1} / ${doc.pages.length}</span>`;
        const del=document.createElement('button');
        del.className='page-del';
        del.innerHTML='<i class="ri-delete-bin-line"></i> 삭제';
        del.disabled=doc.pages.length<=1;
        del.onclick=(e)=>{ e.stopPropagation(); deletePage(i); };
        label.appendChild(del);
        wrap.appendChild(label);

        const paper=document.createElement('div');
        paper.className='paper paper-'+doc.paper;
        paper.dataset.pageIdx=i;
        paper.style.width=size.w+'px';
        paper.style.height=size.h+'px';
        paper.innerHTML=`<div class="layer layer-preview"></div>
                         <div class="layer layer-img"></div>
                         <svg class="stroke-svg layer-fill" viewBox="0 0 ${size.w} ${size.h}" preserveAspectRatio="none" aria-hidden="true"></svg>
                         <svg class="stroke-svg layer-stroke" viewBox="0 0 ${size.w} ${size.h}" preserveAspectRatio="none"></svg>
                         <div class="layer layer-text"></div>
                         <div class="layer find-layer"></div>
                         <div class="layer layer-tbl"></div>
                         <div class="draw-surface"></div>`;
        // 20.0 · 읽기 우선(어크로뱃 방식): 가져온 문서는 편집 DOM 을 만들기 전에
        //   쪽 그림 한 장을 먼저 띄운다. 종이가 올라오는 즉시 내용이 보인다.
        try{ mountPagePreview(paper,i); }catch(e){}
        // 메모 모드는 pointer 캡처 단계에서 먼저 받는다. 텍스트 상자·이미지
        // 위에서도 자식 선택/드래그 이벤트에 빼앗기지 않고 그 지점에 붙는다.
        const onPaperPlacementDown=e=>{
            if(e.button===2) return;   // 18.8 · 우클릭은 배치/메모 모드를 건드리지 않는다
            if(deferPagePointer(e,i)) return;
            // 요소 배치 모드(그림·수식)도 캡처 단계에서 받는다 — 자식 요소가
            // 이벤트를 가로채도 누른 바로 그 지점(pageLocal 문서 좌표)에 놓인다.
            if(placeMode){
                e.preventDefault(); e.stopPropagation();
                const p=pageLocal(e,i); commitPlaceAt(i,p.x,p.y); return;
            }
            if(pinMode&&!e.target.closest('.pin')){
                e.preventDefault(); e.stopPropagation();
                const p=pageLocal(e,i); _pinPointerBlockUntil=Date.now()+500;
                addPin(i,p.x,p.y); return;
            }
            if(textToolActive){
                e.preventDefault(); e.stopPropagation();
                const dim=textBoxDefaultSize();
                const p=pageLocal(e,i), c=clampEl(p.x-dim.w/2,p.y-dim.h/2,dim.w,dim.h);
                _textPointerBlockUntil=Date.now()+500;
                addTextBox(i,c.x,c.y,dim); setTextTool(false);
            }
        };
        sdyAddPointerCompat(paper,'pointerdown',onPaperPlacementDown,true);
        // ★ pointerdown 로 변경 — 터치 장치에서 300ms 지연 제거
        sdyAddPointerCompat(paper,'pointerdown',e=>onPaperDown(e,i));
        wrap.appendChild(paper);

        const on=(i===curPageIdx&&doc.pages.length>1);
        wrap.classList.toggle('focused',on);
        paper.classList.toggle('focused',on);
        paper.setAttribute('aria-current',on?'page':'false');
        // 새로 올라온 종이도 지금 켜져 있는 모드를 그대로 물려받는다.
        // (펜/형광펜 모드로 스크롤하면 새 쪽에는 그리기 판이 없던 회귀 방지)
        try{ if(penActive) paper.classList.add('drawing'); }catch(e){}
        return wrap;
    }

    // 배치는 계산값 그대로 — 앞쪽 쪽이 DOM 에 없어도 자리가 밀리지 않는다.
    function positionPageWrap(wrap,i){
        const size=paperSize();
        wrap.style.transform=`scale(${pageScale})`;
        wrap.style.left='0px';
        wrap.style.top=pageTopPx(i)+'px';
        wrap.style.width=size.w+'px';
        wrap.style.height=size.h+'px';
    }

    // 이 쪽의 종이를 DOM 에 올리고 .paper 를 돌려준다 (이미 있으면 그대로).
    function ensurePageShell(i){
        if(!doc||!doc.pages||!doc.pages[i]) return null;
        const stage=document.getElementById('pagesStage');
        if(!stage) return null;
        let wrap=mountedShells.get(i);
        if(wrap&&wrap.isConnected) return wrap.querySelector('.paper');
        wrap=buildPageShell(i);
        mountedShells.set(i,wrap);
        positionPageWrap(wrap,i);
        stage.appendChild(wrap);
        // 20.0 · 편집 도구가 켜져 있거나 이미 깨운 쪽이면, 새로 올라온 종이도
        //   곧바로 편집 상태로 만든다(펜을 든 채 스크롤해도 빈 종이가 없다).
        try{ if(activatedPages.has(i)||editingModeOn()) activatePage(i); }catch(e){}
        return wrap.querySelector('.paper');
    }

    // 종이를 통째로 내린다 (문서 데이터 doc.pages 는 절대 건드리지 않는다).
    function unmountPageShell(i){
        const wrap=mountedShells.get(i);
        if(!wrap) return false;
        if(!canUnloadPage(i)) return false;
        _pageRenderTok[i]=(_pageRenderTok[i]||0)+1;   // 예약된 청크 렌더까지 취소
        _cancelPageRender(i);
        renderedPages.delete(i);
        mountedShells.delete(i);
        _dropPageTightFits(wrap.querySelector('.paper'));
        releasePageActivation(i);
        try{ wrap.remove(); }catch(e){}
        return true;
    }

    // 지금 화면에 걸쳐 있는 쪽 번호 범위 (스크롤 위치로 '계산'한다)
    function visiblePageRange(){
        const n=(doc&&doc.pages&&doc.pages.length)||0;
        const cur=Math.max(0,Math.min(n-1,curPageIdx|0));
        if(n<=0) return {first:0,last:-1};
        const body=document.getElementById('editorBody');
        const step=pageStep();
        // 레이아웃이 아직 0 인 순간(에디터 슬라이드인·테스트 DOM)에는 현재 쪽 기준.
        if(!body||!(step>0)||!(body.clientHeight>0)) return {first:cur,last:cur};
        const top=Math.max(0,body.scrollTop||0), bottom=top+body.clientHeight;
        return {
            first:Math.max(0,Math.min(n-1,Math.floor(top/step))),
            last :Math.max(0,Math.min(n-1,Math.floor(bottom/step)))
        };
    }

    // 셸 창을 지금 위치에 맞춘다 — 스크롤 프레임마다 불러도 싼 연산이다.
    function syncPageShells(){
        if(!doc||!doc.pages||!doc.pages.length) return _shellWin;
        const n=doc.pages.length, cur=Math.max(0,Math.min(n-1,curPageIdx|0));
        const vis=visiblePageRange();
        const pad=shellPad(), max=shellMax();
        let first=Math.max(0,Math.min(vis.first,cur)-pad);
        let last =Math.min(n-1,Math.max(vis.last ,cur)+pad);
        if(last-first+1>max){          // 극단 축소·먼 점프 직후 방어
            first=Math.max(0,cur-(max>>1));
            last =Math.min(n-1,first+max-1);
            first=Math.max(0,last-max+1);
        }
        if(first!==_shellWin.first||last!==_shellWin.last){
            mountedShells.forEach((w,i)=>{ if(i<first||i>last) unmountPageShell(i); });
        }
        for(let i=first;i<=last;i++) ensurePageShell(i);
        _shellWin={first,last};
        return _shellWin;
    }

    function renderPages(){
        const stage=document.getElementById('pagesStage');
        if(!stage) return;
        resetPageWork();
        clearTimeout(_virtualTimer); _virtualTimer=null;
        clearTimeout(_nbrTimer); _nbrTimer=null;
        renderedPages.clear();
        mountedShells.clear();
        // 20.0 · 노트를 바꾸면 읽기/편집 상태도 새 문서 기준으로 초기화한다.
        activatedPages.clear(); _pvFailed.clear(); _pvUnsupported=false;
        for(const _k in _renderedAt) delete _renderedAt[_k];   // 18.13 · 노트 전환 시 유예 시각 초기화
        _tblGridDone=new Set();   // 표 격자선은 쪽을 그릴 때 다시 확인한다
        _shellWin={first:0,last:-1};
        // 14.12 · 노트 전환 시 기존 DOM과 비동기 콜백이 새 노트에 영향을 주지 못하게
        // renderVersion 은 콜백에서 확인하여 옛 콜백이 새 페이지를 건드리는 것을 막는다.
        // 14.14 · 반드시 숫자로 초기화한다. 예전엔 window._renderVersion 이 undefined 인
        //   첫 오픈에서 ++undefined → NaN 이 되고, NaN !== NaN 이라 renderPageEls 가
        //   전부 즉시 return 해 **빈 종이만** 보였다.
        const rv=(window._renderVersion|0)+1;
        window._renderVersion=rv;
        // doc 에도 버전을 기록하여 renderPageEls 에서 doc===_d 외에 추가로 검증
        if(doc) doc.__rv=rv;
        stage.innerHTML='';
        if(!doc||!doc.pages||!doc.pages.length) return;

        const zone=document.createElement('div');
        zone.className='add-page-zone';
        zone.id='addPageZone';
        zone.innerHTML='<i class="ri-add-circle-line" style="font-size:22px;"></i><span>새 페이지 추가</span>';
        zone.onclick=addPage;
        stage.appendChild(zone);

        layoutPages();        // 전체 쪽수만큼 스테이지 높이를 먼저 잡는다(스크롤 길이 유지)
        syncPageShells();     // 화면에 걸치는 종이만 올린다
        updatePageInfo();
        try{ applyTint(); renderAllTblDivs(); if(sidePanel) renderPanel(); }catch(e){}
        try{ if(wfOn) setTimeout(()=>{ wfAnalyze(); wfPaint(); },30); }catch(e){}
        // 14.14 · 현재 쪽은 스크롤 콜백을 기다리지 않고 바로 그린다.
        try{ ensureVisiblePagesRendered(); }catch(e){}
    }

    // 화면에 바로 보여야 하는 쪽을 강제 렌더
    function ensureVisiblePagesRendered(){
        if(!doc||!doc.pages||!doc.pages.length) return;
        const i=Math.max(0,Math.min(doc.pages.length-1,curPageIdx|0));
        // 이미 그렸다고 표시됐지만 DOM이 빈 경우(노트 전환 경쟁)를 현재 쪽만 복구한다.
        try{
            if(renderedPages.has(i)&&!_pageRenderJobs.has(i)){
                const paper=paperAt(i),txt=paper&&paper.querySelector('.layer-text');
                const els=((doc.pages[i]||{}).els)||[];
                if(!paper||(els.some(e=>e.type==='text'||e.type==='latex')&&txt&&!txt.childElementCount)) renderedPages.delete(i);
            }
        }catch(e){}
        maintainPageWindow(i,true);
    }

    // ===== 유동 로딩 =====
    // ① 화면 근처 쪽만 종이를 올리고, ② 그중 현재 쪽 근처만 요소를 그리고,
    // ③ 요소가 아주 많은 쪽은 한 번에 다 그리지 않고 나눠서 채운다.
    function canUnloadPage(i){
        if(i===(curPageIdx|0)) return false;
        const paper=paperAt(i);
        if(!paper) return true;                       // 이미 화면에 없다
        if(paper.querySelector('.tb.edit,.sel,.msel')) return false;
        if(activeTbl&&activeTbl.pageIdx===i) return false;
        try{ if(drawing&&drawPageIdx===i) return false; }catch(e){}
        return true;
    }
    // 요소만 비운다 (종이는 그대로 — 찾기·형광 띠는 다시 그릴 때 복원된다)
    function unloadPage(i){
        if(Math.abs(i-(curPageIdx|0))<=keepRadius()) return false;
        // 18.13 · 방금 그린 쪽은 경계를 막 넘었어도 곧바로 회수하지 않는다. 요소
        //   회수는 즉시, 이웃 렌더는 지연이라 스크롤을 되돌렸을 때 같은 쪽을
        //   '내렸다가 다시 그리는' 왕복이 반복되던 지점. 짧은 유예를 두면
        //   되돌아왔을 때 이미 그려진 그대로라 재렌더가 없다.
        if(Date.now()-(_renderedAt[i]||0)<UNLOAD_GRACE) return false;
        if(!renderedPages.has(i)||!canUnloadPage(i)) return false;
        // setTimeout뿐 아니라 이미 RAF 큐에 들어간 step도 토큰으로 무효화한다.
        _pageRenderTok[i]=(_pageRenderTok[i]||0)+1;
        _cancelPageRender(i);
        clearPageEls(i);
        renderedPages.delete(i);
        delete _renderedAt[i];
        releasePageActivation(i);
        try{ mountPagePreview(paperAt(i),i); }catch(e){}
        return true;
    }

    // 셸 창은 즉시, 요소 창은 스크롤이 멎은 뒤에 맞춘다.
    // (관성 스크롤 도중에 무거운 쪽을 그리면 그게 곧 렉이다)
    function maintainPageWindow(center,immediate){
        if(!doc||!doc.pages||!doc.pages.length) return;
        center=Math.max(0,Math.min(doc.pages.length-1,center|0));
        syncPageShells();
        clearTimeout(_virtualTimer); _virtualTimer=null;
        clearTimeout(_nbrTimer); _nbrTimer=null;
        const fill=()=>{
            _lastFillAt=Date.now();
            if(!doc||!doc.pages||!doc.pages[center]) return;
            // 먼저 먼 요소 DOM과 진행 중 청크를 회수해 메모리·프레임을 양보한다.
            const keepR=keepRadius();
            Array.from(renderedPages).forEach(i=>{
                if(Math.abs(i-center)>keepR) unloadPage(i);
            });
            // 14.30.0 · 현재 쪽(지금 보이는 종이)을 먼저 그린다. 이웃 쪽은 짧은
            //   지연 뒤에 채워 스크롤을 멈춘 첫 프레임이 현재 쪽에만 집중되게
            //   한다. (무거운 이웃 쪽을 동시에 그리면 저사양 기기에서 버벅임)
            // 14.37.0 · 읽기도 '진짜 글자'로 한다. 쪽 그림(래스터)은 원본을 축소해
            //   구운 것이라 확대하면 흐릿하고 글자를 고를 수도 없었다. 로딩이
            //   충분히 빨라진 지금은, 그림은 요소가 붙기 전까지만 깔아 두는
            //   '자리 채움'이고 화면에 남는 것은 항상 텍스트 DOM 이다.
            const needEls=i=>true;
            if(needEls(center)){
                if(editingModeOn()) activatedPages.add(center);
                if(!renderedPages.has(center)) try{ renderPageEls(center); }catch(e){}
            }
            if(!needEls(center)) return;   // 이웃 쪽 예열도 필요 없다
            if(!_nbrTimer){
                const gap=sdyLowEnd()?320:110;
                _nbrTimer=setTimeout(()=>{
                    _nbrTimer=null;
                    try{
                        if(!doc||!doc.pages||!doc.pages.length) return;
                        if(window._renderVersion!==(doc&&doc.__rv)) return;
                        const c=Math.max(0,Math.min(doc.pages.length-1,(curPageIdx|0)));
                        const rr=renderRadius();
                        for(let d=1;d<=rr;d++){
                            [c-d,c+d].forEach(i=>{
                                if(i<0||i>=doc.pages.length) return;
                                if(!needEls(i)) return;      // 읽기 쪽은 그림만
                                if(!renderedPages.has(i))
                                    try{ renderPageEls(i); }catch(e){}
                            });
                        }
                    }catch(e){}
                },gap);
            }
        };
        if(immediate) fill();
        // 계속 스크롤하는 동안에도 fillMaxGap() 마다 한 번은 채운다 —
        // 디바운스만 걸면 '손을 뗄 때까지 백지'가 되어 더 답답하다.
        else if(Date.now()-_lastFillAt>=fillMaxGap()) fill();
        else _virtualTimer=setTimeout(()=>{ _virtualTimer=null; if(center===(curPageIdx|0)) fill(); },fillIdle());
    }

    function clearPageEls(idx){
        const paper=paperAt(idx); if(!paper) return;
        const imgL=paper.querySelector('.layer-img');
        const fill=paper.querySelector('.layer-fill');
        const svg=paper.querySelector('.layer-stroke');
        const txtL=paper.querySelector('.layer-text');
        const tbl=paper.querySelector('.layer-tbl');
        const pin=paper.querySelector('.layer-pin');
        if(imgL) imgL.innerHTML='';
        if(fill) fill.innerHTML='';
        if(svg)  svg.innerHTML='';
        if(txtL) txtL.innerHTML='';
        if(tbl)  tbl.innerHTML='';
        if(pin)  pin.innerHTML='';
        paper._sdyReady=false;
    }

    function _elBox(el){
        return {x:+el.x||0,y:+el.y||0,w:+el.w||0,h:+el.h||0};
    }
    function _boxOverlap(a,b){
        const ox=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
        const oy=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
        if(ox<=0||oy<=0) return 0;
        return ox*oy;
    }
    // 18.4 · 이 이미지 요소가 '진짜로 볼 수 있는 주소'를 물고 있는가.
    //   업로드 전(pending) 상태는 url:'' + blob localURL 이라 여기서 거짓이 된다.
    function _imgRealURL(el){
        const u=String((el&&el.url)||'');
        return !!(u && !/^blob:/i.test(u));
    }
    const _sanDone=new WeakSet();   // 이미 중복 정리를 끝낸 els 배열
    // 18.13 성능 — 쪽의 중복 정리(겹침 제거)는 O(n²)라서 그 쪽을 '처음 그리는
    //   프레임'에 동기로 들어가면 스크롤 버벅임이 된다. 그래서:
    //   ① 결과는 한 번만 계산(_sanDone)하고,
    //   ② 쪽이 메모리에 들어오는 즉시(열기·슬라이스 로드 뒤) 백그라운드에서
    //      미리 돌려 둔다. → 스크롤로 도착했을 땐 이미 정리돼 있어 skip.
    function _ensureSanitized(idx){
        const pg=doc&&doc.pages&&doc.pages[idx];
        if(!pg) return [];
        let els=pg.els||[];
        if(!_sanDone.has(els)){
            const cleaned=sanitizePageEls(els);
            if(cleaned!==els && cleaned.length!==els.length) pg.els=cleaned;
            els=pg.els||[];
            _sanDone.add(els);
        }
        return els;
    }
    let _presanTimer=null, _presanFrom=0;
    function _presanitizeDoc(){
        // 메모리에 이미 올라와 있는 쪽의 중복 정리를, 화면·스크롤을 막지 않게
        // 유휴 시간에 나눠서 미리 돌린다(lazy 쪽은 아직 데이터가 없으니 제외).
        const d=doc;
        if(!d||!Array.isArray(d.pages)) return;
        const n=d.pages.length, until=performance.now()+5;
        let i=_presanFrom, guard=0;
        for(;i<n&&guard<24&&performance.now()<until;i++,guard++){     // 한 번에 최대 24쪽(무거운 쪽은 그 자체가 큼)
            const pg=d.pages[i];
            if(!pg||pg.__lazy!=null) continue;
            const els=pg.els||[];
            if(_sanDone.has(els)) continue;
            const cleaned=sanitizePageEls(els);
            if(cleaned!==els && cleaned.length!==els.length) pg.els=cleaned;
            _sanDone.add(pg.els||[]);
        }
        _presanFrom=i;
        if(i<n){                     // 남았으면 다음 유휴 틱으로
            try{
                if(window.requestIdleCallback) _presanTimer=window.requestIdleCallback(_presanitizeDoc,{timeout:sdyLowEnd()?900:600});
                else _presanTimer=setTimeout(_presanitizeDoc,sdyLowEnd()?120:40);
            }catch(e){}
        }
    }
    function schedulePresanitize(){
        if(!doc||!Array.isArray(doc.pages)) return;
        _presanFrom=0;
        if(_presanTimer){ try{ if(window.cancelIdleCallback) window.cancelIdleCallback(_presanTimer); else clearTimeout(_presanTimer); }catch(e){} _presanTimer=null; }
        try{
            if(window.requestIdleCallback) _presanTimer=window.requestIdleCallback(_presanitizeDoc,{timeout:sdyLowEnd()?900:600});
            else _presanTimer=setTimeout(_presanitizeDoc,sdyLowEnd()?120:40);
        }catch(e){}
    }
    function sanitizePageEls(els){
        if(!els||!els.length) return els||[];
        const seen=new Set();
        let out=els.filter(el=>{
            if(!el||!el.id) return false;
            if(seen.has(el.id)) return false;
            seen.add(el.id);
            return true;
        });
        // 14.30.0 · 겹침 제거는 서로 비교(O(n²))라서 요소가 아주 많은 쪽에서
        //   처음 그릴 때 한 번에 수십만 회 돌면 저사양 기기에서 버벅인다.
        //   일반 가져오기 문서는 쪽당 300~500개 언저리라 상한 안에 들어오고,
        //   그 이상은 어차피 겹침이 구조적으로 거의 없으므로 건너뛴다.
        if(out.length<=1500){
        const drop=new Set();
        // 표 셀은 서로 맞닿고 기존 글상자 위에 놓일 수도 있는 정상 구조다.
        // 일반 가져오기 중복 제거에 섞으면 작은 셀이 전부 사라져 선만 남는다.
        const texts=out.filter(e=>e.type==='text'&&!e.tbl&&!e.pdfText&&e.x!=null&&(e.w||0)>2&&(e.h||0)>2);
        // PDF paragraphs can geometrically contain separate equation numbers,
        // captions or another fragment. Their glyphs were already deduplicated
        // by the importer; bbox containment must not delete different words.
        const latexs=out.filter(e=>e.type==='latex'&&e.x!=null);
        // 글상자 수가 지나치게 많으면(O(n²) 폭발) 가까운 이웃(최대 60개)끼리만
        //   비교한다 — PDF 행 단위 배치는 겹침 후보가 항상 가까이 있기 때문이다.
        const many=texts.length>600;
        for(let i=0;i<texts.length;i++){
            const a=texts[i], A=_elBox(a), aa=Math.max(1,A.w*A.h);
            const jmax=many?Math.min(texts.length,i+61):texts.length;
            for(let j=0;j<jmax;j++){
                if(i===j||drop.has(a.id)) continue;
                const b=texts[j]; if(drop.has(b.id)) continue;
                const oa=_boxOverlap(A,_elBox(b));
                if(oa/aa>=0.88 && aa<=(_elBox(b).w*_elBox(b).h)+4) drop.add(a.id);
            }
            if(drop.has(a.id)) continue;
            for(const lx of latexs){
                const oa=_boxOverlap(A,_elBox(lx));
                if(oa/aa>=0.72){ drop.add(a.id); break; }
            }
        }
        if(drop.size) out=out.filter(e=>!drop.has(e.id));
        }
        return out;
    }
    // 14.29.4 · 표 격자선 지연 생성.
    //   예전엔 노트를 열 때 모든 쪽의 표를 훑어 격자선을 만들었다(열기 지연의
    //   큰 몫). 이제 그 쪽을 처음 그릴 때 딱 한 번 만든다. 만든 선은 doc 에
    //   남으므로 두 번 돌지 않고, 결과물은 예전과 동일하다.
    let _tblGridDone=new Set();
    function ensureTableGrid(pi){
        try{
            if(_tblGridDone.has(pi)) return;
            _tblGridDone.add(pi);
            const pg=doc&&doc.pages&&doc.pages[pi];
            if(!pg||!Array.isArray(pg.tables)||!pg.tables.length) return;
            pg.tables.forEach(t=>{
                // 10.4 · PDF에서 가져온 표(bg:1)는 격자가 배경 래스터에
                //   원본 그대로 있으므로 클라이언트가 따로 그리지 않는다.
                if(t.bg) return;
                const hasLine=(pg.els||[]).some(e=>e.type==='stroke'&&tblOf(e)===t.id);
                if(!hasLine) rebuildTable(pi,t.id,{quiet:true});
            });
        }catch(e){}
    }
    // ============ 읽기 우선 레이어 (20.0 · '어크로뱃처럼') ============
    // 논문 한 쪽은 글상자 수백 개 + 단어 span 수천 개다. 예전에는 그 DOM 을 다
    // 만들어야 비로소 글자가 보였고, 그 비용이 곧 '여는 데 오래 걸림 / 스크롤이
    // 안 됨'이었다. 쪽 수를 줄이는 가상화로는 잡히지 않는, 쪽 '안'의 비용이다.
    //
    // 그래서 순서를 뒤집는다.
    //   ① 종이가 올라오면 서버가 구운 쪽 그림(<img> 하나)을 즉시 붙인다  → 읽기
    //   ② 사용자가 그 쪽을 실제로 건드릴 때만 편집 요소 DOM 을 만든다   → 편집
    // 읽는 동안 쪽당 DOM 은 노드 한 개라 500쪽이든 스크롤이 손끝을 따라온다.
    //
    // 규칙
    //   · 문서 데이터(doc.pages)는 전혀 건드리지 않는다. 저장·동기화·내보내기·
    //     AI·찾기는 예전 그대로 전 쪽 데이터를 쓴다.
    //   · 그림을 못 받는 문서(가져오기가 아닌 노트, 원본이 지워진 문서)는
    //     자동으로 예전 경로(요소 렌더)로 되돌아간다 — 기능 손실이 없다.
    const activatedPages=new Set();   // 편집 활성화 요청(준비/완료는 별도)
    const _pvFailed=new Set();        // 그림을 못 받은 쪽 → 요소 렌더로 폴백
    let _pvUnsupported=false;         // 이 문서는 미리보기 자체가 없다

    // 이 문서가 쪽 그림을 쓸 수 있는가 (서버에 원본이 남아 있는 가져온 문서)
    function previewCapable(){
        return !!(doc&&doc.__ref&&!_pvUnsupported&&!S.noPagePreview);
    }
    let _previewTimer=null;
    function previewWidth(draft){
        // 자리 채움 그림이라 크게 받을 이유가 없다 — 저사양은 더 작게.
        if(draft&&sdyTurbo()) return 480;
        const w=paperSize().w*pageScale*(window.devicePixelRatio||1);
        return w<=480?480:(w>900?1600:900);
    }
    function previewURL(pi,width){
        return '/api/import/page/'+encodeURIComponent(doc.__ref)+'/'+pi
              +'?w='+(width||previewWidth());
    }
    function mountPagePreview(paper,pi){
        if(!paper||!previewCapable()||_pvFailed.has(pi)) return false;
        if(pageEdited(pi)) return false;
        const layer=paper.querySelector('.layer-preview');
        if(!layer||layer.firstChild||paper._sdyReady) return false;
        const d=doc, img=document.createElement('img');
        img.className='page-preview-img'; img.decoding='async'; img.loading='eager';
        img.alt=''; img.draggable=false; img.dataset.width=previewWidth(true);
        const live=()=>doc===d&&paper.isConnected&&paperAt(pi)===paper&&layer.firstChild===img;
        img.onload=()=>{ if(live()) schedulePreviewQuality(); };
        img.onerror=()=>{
            // 노트 전환/언마운트 뒤 늦게 도착한 오류는 새 노트를 폴백시키면 안 된다.
            if(!live()) return;
            _pvFailed.add(pi);
            if(_pvFailed.size>=3) _pvUnsupported=true;
            layer.innerHTML=''; paper.classList.remove('preview-on');
            if(!renderedPages.has(pi)) renderPageEls(pi);
        };
        img.src=previewURL(pi,+img.dataset.width);
        layer.appendChild(img); paper.classList.add('preview-on');
        return true;
    }
    // 14.37.0 · 그림 화질 승급(upgradePagePreview)은 사라졌다. 화면에 남는 것은
    //   글자 DOM 이므로, 더 큰 래스터를 다시 받아 봐야 곧 걷힐 그림만 무거워진다.
    //   대역폭은 본문 데이터(loadBatch)를 먼저 받는 데 쓴다.
    function schedulePreviewQuality(){
        clearTimeout(_previewTimer);
        const d=doc, rv=window._renderVersion;
        if(!d||!d.__ref) return;
        _previewTimer=setTimeout(()=>{
            _previewTimer=null;
            if(doc!==d||window._renderVersion!==rv) return;
            if(_isScrolling()){ schedulePreviewQuality(); return; }
            const vis=visiblePageRange(), batches=new Set();
            for(let i=vis.first;i<=vis.last;i++){
                // 14.37.0 · 더 선명한 '그림'을 받아오지 않는다. 흐린 초벌 그림은
                //   글자 DOM 이 붙는 순간 걷히므로, 대신 그 쪽의 본문 데이터를
                //   받아 진짜 글자로 교체하는 쪽에 대역폭을 쓴다.
                if(d.pages[i]&&d.pages[i].__lazy!=null) batches.add(Math.floor(i/LAZY_SLICE)*LAZY_SLICE);
                else if(paperAt(i)&&!renderedPages.has(i)) try{ renderPageEls(i); }catch(e){}
            }
            batches.forEach(s0=>loadBatch(s0).then(()=>{
                if(doc!==d||window._renderVersion!==rv) return;
                // 데이터 예열도 제한된 창만 유지한다(읽으며 문서 전체를 붙잡지 않음).
                evictFar(curPageIdx|0);
                for(let i=vis.first;i<=vis.last;i++) if(paperAt(i)&&!renderedPages.has(i)){
                    try{ renderPageEls(i); }catch(e){}
                }
            }));
        },180);
    }
    // 이 쪽을 '편집 가능' 상태로 올린다 — 실제로 건드린 쪽에서만 부른다.
    function pageReady(pi){
        const paper=paperAt(pi);
        return !!(paper&&paper._sdyReady&&renderedPages.has(pi)&&!_pageRenderJobs.has(pi));
    }
    function activatePage(pi){
        pi=+pi;
        if(!doc||!doc.pages||!doc.pages[pi]) return Promise.resolve(false);
        activatedPages.add(pi);
        const paper=paperAt(pi);
        if(paper) paper.classList.add('page-active');
        const job=_pageRenderJobs.get(pi);
        if(job) return job.promise;                 // 중복 클릭·도구 전환도 같은 작업을 기다린다
        if(pageReady(pi)) return Promise.resolve(true);
        return renderPageEls(pi);                   // 내려갔다 돌아온 쪽도 다시 준비한다
    }
    function dropPagePreview(pi){
        const layer=paperQ(pi,'.layer-preview');
        if(layer&&layer.firstChild) layer.innerHTML='';
        const paper=paperAt(pi);
        if(paper) paper.classList.remove('preview-on');
    }
    // 편집 모드(펜·글상자·메모·배치·표)나 찾기·단어분석처럼 요소가 반드시
    // 있어야 하는 상황에서는 보이는 쪽을 통째로 깨운다.
    function activateVisiblePages(){
        if(!doc||!doc.pages) return;
        const vis=visiblePageRange();
        for(let i=vis.first;i<=vis.last;i++) activatePage(i);
    }
    // 편집 도구가 켜져 있으면 새로 올라오는 쪽도 바로 편집 상태여야 한다.
    function editingModeOn(){
        try{
            return !!(penActive||eraserActive||textToolActive||pinMode
                      ||placeMode||tablePlace||findOpen||wfOn);
        }catch(e){ return false; }
    }
    // 20.0 · 이 쪽은 원본 PDF 와 더 이상 같지 않다(편집·번역됨) → 쪽 그림을
    //   쓰면 안 된다. 표시는 문서 데이터에 남아 저장·재열람까지 이어진다.
    function markPageEdited(pi){
        pi=+pi;
        const pg=doc&&doc.pages&&doc.pages[pi];
        if(!pg) return;
        pg.__dirty=true;
        try{ aiInvalidatePage(pi); }catch(e){}   // 20.2 · 고친 쪽 글만 다시 뽑는다
        if(!pg.edited){
            pg.edited=1;
            // 그림을 보고 있던 중이라면 즉시 진짜 요소로 교체한다.
            try{ if(!activatedPages.has(pi)) activatePage(pi); }catch(e){}
        }
    }
    function releasePageActivation(pi){
        // 단순 선택/열람은 편집이 아니다. 실제로 고친 쪽만 원본 그림으로 복귀 금지.
        if(!pageEdited(pi)) activatedPages.delete(pi);
    }
    function pageEdited(pi){
        const pg=doc&&doc.pages&&doc.pages[pi];
        return !!(pg&&(pg.edited||pg.__dirty));
    }
    try{ window.sdyActivatePage=activatePage; }catch(e){}

    // 미리보기에서 누른 첫 동작을 버리지 않는다. 준비가 끝난 같은 종이의 같은
    // 좌표에 전달한다. 스크롤/드래그 취소/다른 노트/다른 도구 뒤에는 절대 재생하지 않는다.
    let _pagePointerIntent=null, _lastPageTap=null;
    function cancelPagePointer(){ _pagePointerIntent=null; _lastPageTap=null; }
    function _pagePointerMode(){ return [penActive,eraserActive,textToolActive,pinMode,placeMode,tablePlace,shapeMode]; }
    function _pagePointerScrolled(it){
        return it.body.scrollTop!==it.scrollTop||it.body.scrollLeft!==it.scrollLeft;
    }
    function _pagePointerValid(it){
        return _pagePointerIntent===it&&!_pagePointerScrolled(it)&&it.scale===pageScale&&doc===it.doc&&window._renderVersion===it.rv
            &&it.paper.isConnected&&paperAt(it.pi)===it.paper
            &&it.mode.every((v,i)=>v===_pagePointerMode()[i]);
    }
    function _pagePointerCopy(e,detail){
        return {bubbles:true,cancelable:true,button:0,buttons:1,detail:detail||1,
            clientX:e.clientX,clientY:e.clientY,ctrlKey:!!e.ctrlKey,metaKey:!!e.metaKey,
            shiftKey:!!e.shiftKey,altKey:!!e.altKey,pointerId:e.pointerId||1,
            pointerType:e.pointerType||'mouse',isPrimary:true};
    }
    function _pagePointerTarget(it){
        if(it.ink) return it.paper.querySelector('.draw-surface');
        const hit=document.elementFromPoint&&document.elementFromPoint(it.event.clientX,it.event.clientY);
        if(hit&&it.paper.contains(hit)) return hit;
        // DOM을 배치하지 않는 테스트/구형 WebView의 좌표 폴백. 배경 이미지는 선택 대상 아님.
        const p=pageLocal(it.event,it.pi), els=it.doc.pages[it.pi].els||[];
        for(let i=els.length-1;i>=0;i--){
            const el=els[i]; if(el.isBg) continue;
            const b=elBBox(el);
            if(b&&p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h){
                const node=paperQ(it.pi,'[data-id="'+el.id+'"]');
                if(node) return node.querySelector('.tb-content')||node;
            }
        }
        return it.paper;
    }
    function _replayPagePointer(it){
        if(!_pagePointerValid(it)){ if(_pagePointerIntent===it) cancelPagePointer(); return; }
        if(!it.ready||(!it.up&&!it.ink)) return;
        const target=_pagePointerTarget(it);
        if(!target) return;
        _pagePointerIntent=null;
        const EventType=window.PointerEvent||window.MouseEvent;
        // 기존 선택/표/배치/그리기 핸들러를 그대로 탄다. 별도 편집 엔진을 만들지 않는다.
        target.dispatchEvent(new EventType('pointerdown',it.event));
        if(it.ink){
            for(const point of it.moves) drawMove({...point,preventDefault(){}});
        }
        if(it.up) document.dispatchEvent(new EventType('pointerup',{...it.event,buttons:0}));
    }
    function _preparePagePointer(it){
        activatePage(it.pi).then(ok=>{
            if(!_pagePointerValid(it)){ if(_pagePointerIntent===it) cancelPagePointer(); return; }
            if(!ok&&!pageReady(it.pi)){
                if(_pageRenderJobs.has(it.pi)) _preparePagePointer(it); // 원격 변경으로 교체된 작업을 따라감
                else cancelPagePointer();
                return;
            }
            it.ready=true; _replayPagePointer(it);
        });
    }
    function deferPagePointer(e,pi){
        if(e.button!==0||pageReady(pi)) return false;
        if(e.isPrimary===false){ cancelPagePointer(); e.stopImmediatePropagation(); return true; }
        // 작은 일반 노트는 동기로 준비되므로 기존 네이티브 이벤트를 그대로 보낸다.
        const touch=e.pointerType==='touch'&&!penActive&&!textToolActive&&!pinMode&&!placeMode&&!tablePlace;
        if(!touch){ activatePage(pi); if(pageReady(pi)) return false; }
        const now=Date.now(), prev=_lastPageTap;
        const detail=e.detail>=2||prev&&prev.doc===doc&&prev.pi===pi&&now-prev.at<450
            &&Math.hypot(e.clientX-prev.x,e.clientY-prev.y)<8?2:1;
        _lastPageTap={doc,pi,at:now,x:e.clientX,y:e.clientY};
        const body=document.getElementById("editorBody");
        const it={doc,rv:window._renderVersion,paper:paperAt(pi),pi,
            body,scrollTop:body.scrollTop,scrollLeft:body.scrollLeft,scale:pageScale,
            event:_pagePointerCopy(e,detail),mode:_pagePointerMode(),ink:!!penActive,
            moves:[],up:false,ready:false,touch};
        _pagePointerIntent=it;
        if(!touch) _preparePagePointer(it);       // 터치 스크롤은 편집 활성화가 아니다
        if(!touch) e.preventDefault();
        e.stopImmediatePropagation();
        return true;
    }
    sdyAddPointerCompat(document,'pointerdown',e=>{
        const p=e.target.closest&&e.target.closest('#pagesStage .paper');
        if(!p){ cancelPagePointer(); return; }
        deferPagePointer(e,+p.dataset.pageIdx);
    },true);
    sdyAddPointerCompat(document,'pointermove',e=>{
        const it=_pagePointerIntent;
        if(!it||it.up) return;
        if(it.ink){
            // 준비 동안 들어온 첫 펜 획도 버리지 않는다(예열이 끝나면 실시간 그리기로 인계).
            if(it.moves.length>=512) it.moves=it.moves.filter((_,i)=>i%2===0);
            it.moves.push(_pagePointerCopy(e));
        }else if(Math.hypot(e.clientX-it.event.clientX,e.clientY-it.event.clientY)>8) cancelPagePointer();
    },{capture:true,passive:true});
    sdyAddPointerCompat(document,'pointerup',()=>{
        const it=_pagePointerIntent; if(!it) return;
        it.up=true;
        if(it.touch) _preparePagePointer(it);
        else _replayPagePointer(it);
    },true);
    document.addEventListener('dblclick',e=>{
        const it=_pagePointerIntent;
        if(it&&it.paper.contains(e.target)){
            it.event.detail=2; e.preventDefault(); e.stopImmediatePropagation();
        }
    },true);
    document.addEventListener('pointercancel',cancelPagePointer,true);
    document.getElementById('editorBody').addEventListener('wheel',cancelPagePointer,{passive:true});
    document.getElementById('editorBody').addEventListener('scroll',()=>{
        // A scroll event queued BEFORE this down must not discard a tap on the
        // already-settled page. Cancel only if its captured viewport moved.
        if(!_pagePointerIntent||_pagePointerScrolled(_pagePointerIntent)) cancelPagePointer();
    },{passive:true});
    document.addEventListener('keydown',e=>{ if(e.key==='Escape') cancelPagePointer(); },true);

    function _cancelPageRender(idx){
        const job=_pageRenderJobs.get(idx);
        if(!job) return;
        _pageRenderJobs.delete(idx);
        job.paper.classList.remove('page-preparing');
        job.paper.removeAttribute('aria-busy');
        job.resolve(false);
    }
    function resetPageWork(){
        cancelAnimationFrame(_pageRenderFrame); _pageRenderFrame=0;
        Array.from(_pageRenderJobs.keys()).forEach(_cancelPageRender);
        cancelAnimationFrame(_tightRaf); _tightRaf=0;
        clearTimeout(_tightWait); _tightWait=0; _tightQueue.clear();
        cancelPagePointer();
        clearTimeout(_previewTimer); _previewTimer=null;
        clearTimeout(_hiBgTimer); _hiBgTimer=null; _hiBgDone.clear(); _hiBgBusy.clear();
    }
    function _pageJobLive(job){
        return _pageRenderJobs.get(job.idx)===job&&doc===job.doc
            &&window._renderVersion===job.rv&&job.doc.__rv===job.rv
            &&job.paper.isConnected&&paperAt(job.idx)===job.paper;
    }
    function _queuePageRender(){
        if(!_pageRenderFrame) _pageRenderFrame=requestAnimationFrame(_drainPageRenders);
    }
    function _drainPageRenders(){
        _pageRenderFrame=0;
        // 여러 쪽을 동시에 깨워도 쪽마다 타이머/청크 예산이 곱해지지 않는다.
        const until=performance.now()+5;
        const jobs=Array.from(_pageRenderJobs.values()).filter(j=>!j.loading);
        jobs.sort((a,b)=>(b.idx===curPageIdx)-(a.idx===curPageIdx));
        for(const job of jobs){
            if(!_pageJobLive(job)){ _cancelPageRender(job.idx); continue; }
            try{ job.step(until); }catch(e){
                console.warn('페이지 렌더 실패',job.idx,e);
                _cancelPageRender(job.idx); renderedPages.delete(job.idx);
            }
            if(performance.now()>=until) break;
        }
        if(Array.from(_pageRenderJobs.values()).some(j=>!j.loading)) _queuePageRender();
    }
    function renderPageEls(idx){
        const d=doc, paper=paperAt(idx), rv=window._renderVersion;
        if(!d||!d.pages[idx]||!paper||!paper.isConnected||rv!==d.__rv)
            return Promise.resolve(false);
        _cancelPageRender(idx);                     // 명시적 재렌더는 이전 작업을 교체
        const tok=_pageRenderTok[idx]=(_pageRenderTok[idx]||0)+1;
        const job={idx,doc:d,paper,rv,loading:false,step:null,resolve:null,promise:null};
        job.promise=new Promise(resolve=>{ job.resolve=resolve; });
        _pageRenderJobs.set(idx,job);
        renderedPages.add(idx);
        _renderedAt[idx]=Date.now();
        paper._sdyReady=false;
        paper.classList.add('page-preparing'); paper.setAttribute('aria-busy','true');

        const begin=()=>{
            if(!_pageJobLive(job)) return;
            const pg=d.pages[idx];
            if(!pg||pg.__lazy!=null){               // 요청 실패를 재귀 렌더/재요청으로 바꾸지 않는다
                _cancelPageRender(idx); renderedPages.delete(idx); return;
            }
            job.loading=false;
            const size=paperSize();
            const imgL=paper.querySelector('.layer-img'), fillL=paper.querySelector('.layer-fill'),
                svg=paper.querySelector('.layer-stroke'), txtL=paper.querySelector('.layer-text');
            _dropPageTightFits(paper);
            imgL.innerHTML=''; if(fillL) fillL.innerHTML=''; svg.innerHTML=''; txtL.innerHTML='';
            if(fillL) fillL.setAttribute('viewBox',`0 0 ${size.w} ${size.h}`);
            svg.setAttribute('viewBox',`0 0 ${size.w} ${size.h}`);
            ensureTableGrid(idx);
            const els=_ensureSanitized(idx);
            let at=0;
            const finish=()=>{
                if(!_pageJobLive(job)||_pageRenderTok[idx]!==tok) return;
                _pageRenderJobs.delete(idx);
                paper._sdyReady=true;
                paper.classList.remove('page-preparing'); paper.removeAttribute('aria-busy');
                dropPagePreview(idx);              // 준비 도중 두 번째 클릭이 그림을 걷지 못한다
                try{ renderTblDivs(idx); renderPins(idx); }catch(e){}
                try{ if(findOpen) paintFindHits(); }catch(e){}
                try{ if(wfOn) wfPaintPage(idx); }catch(e){}
                scheduleHiBg();
                job.resolve(true);
            };
            job.step=until=>{
                if(!_pageJobLive(job)||_pageRenderTok[idx]!==tok){ _cancelPageRender(idx); return; }
                // 데이터가 교체됐으면 오래된 청크를 새 문서 위에 붙이지 않는다.
                if(d.pages[idx]!==pg||(pg.els&&pg.els!==els)){ renderPageEls(idx); return; }
                const bags={img:document.createDocumentFragment(),fill:document.createDocumentFragment(),svg:document.createDocumentFragment(),txt:document.createDocumentFragment()};
                let weight=0;
                do{
                    const el=els[at++];
                    if(!el) break;
                    if(el.type==='image') bags.img.appendChild(buildImageEl(el,idx));
                    else if(el.type==='legacyDraw'){
                        const im=document.createElementNS('http://www.w3.org/2000/svg','image');
                        im.setAttribute('href',el.url); im.setAttribute('x',0); im.setAttribute('y',0);
                        im.setAttribute('width',size.w); im.setAttribute('height',size.h); bags.svg.appendChild(im);
                    }else if(el.type==='stroke'){
                        if(el.fillColor&&fillL) bags.fill.appendChild(buildStrokeFillEl(el,idx));
                        bags.svg.appendChild(buildStrokeEl(el,idx));
                    }
                    else if(el.type==='text') bags.txt.appendChild(buildTextEl(el,idx));
                    else if(el.type==='latex') bags.txt.appendChild(buildLatexEl(el,idx));
                    weight+=256+(el.html||'').length+(el.pts||[]).length*24;
                    // DOM 삽입 뒤 브라우저가 할 스타일/레이아웃 비용도 제한한다.
                    // 글상자 36개라도 단어가 2160개면 '가벼운 쪽'이 아니다.
                }while(at<els.length&&performance.now()<until&&weight<12000);
                const flushBags=()=>{ imgL.appendChild(bags.img); if(fillL) fillL.appendChild(bags.fill); svg.appendChild(bags.svg); txtL.appendChild(bags.txt); };
                flushBags();
                if(at>=els.length) finish();
            };
            const cheap=els.length<=120&&els.reduce((n,e)=>n+256+(e.html||'').length+(e.pts||[]).length*24,0)<6000;
            if(cheap) job.step(performance.now()+5); // 작은 일반 노트/표는 기존 동기 동작 유지
            if(_pageJobLive(job)) _queuePageRender();
        };
        if(d.pages[idx].__lazy!=null){
            job.loading=true;
            ensureLazyPage(idx).then(begin,()=>{
                if(_pageJobLive(job)){ _cancelPageRender(idx); renderedPages.delete(idx); }
            });
        }else{
            // 무거운 쪽의 sanitize/DOM 생성은 포인터 핸들러 바깥에서 시작한다.
            const els=d.pages[idx].els||[];
            const cheap=els.length<=120&&els.reduce((n,e)=>n+256+(e.html||'').length+(e.pts||[]).length*24,0)<6000;
            if(cheap) begin();
            else{ job.step=begin; _queuePageRender(); }
        }
        return job.promise;
    }

    function layoutPages(){
        if(!doc) return;
        const body=document.getElementById('editorBody');
        const stage=document.getElementById('pagesStage');
        if(!body||!stage) return;
        const size=paperSize();
        const cs=getComputedStyle(body);
        const availW=Math.max(120, body.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight));
        fitScale=Math.max(0.05, Math.min(availW/size.w, 1));
        pageScale=fitScale*(zoomPct/100);

        const totalH=doc.pages.length*size.h+(doc.pages.length-1)*PAGE_GAP+PAGE_GAP+ADD_ZONE_H;
        stage.style.width=(size.w*pageScale)+'px';
        stage.style.height=(totalH*pageScale)+'px';

        // 손잡이·테두리가 확대율과 무관하게 같은 크기로 보이도록
        const isTouch=matchMedia('(pointer:coarse)').matches;
        const hs=Math.max(6,Math.min(22,(isTouch?16:12)/Math.max(.2,pageScale)));
        stage.style.setProperty('--hs',hs.toFixed(2)+'px');
        stage.style.setProperty('--bw',(1.6/Math.max(.2,pageScale)).toFixed(2)+'px');
        stage.style.setProperty('--pz',Math.max(.2,pageScale).toFixed(3));
        stage.style.setProperty('--pin-inv',(1/Math.max(.2,pageScale)).toFixed(4));

        // 올라와 있는 종이만 다시 놓는다 (자리는 쪽 번호로 계산 — 배열 순서가 아니다)
        mountedShells.forEach((w,i)=>positionPageWrap(w,i));
        // 배율이 바뀌면 화면에 걸치는 쪽 수도 달라진다 → 셸 창을 다시 맞춘다
        try{ syncPageShells(); schedulePreviewQuality(); }catch(e){}
        const zone=document.getElementById('addPageZone');
        if(zone){
            zone.style.top=(doc.pages.length*(size.h+PAGE_GAP)*pageScale)+'px';
            zone.style.width=(size.w*pageScale)+'px';
            zone.style.height=(ADD_ZONE_H*pageScale*0.8)+'px';
        }
        // 9.2 단일 툴바 개편으로 확대율 라벨이 '더보기' 서랍 안으로 들어갔다.
        // 서랍이 아직 그려지지 않았거나(저사양 기기) 요소가 없어도 layoutPages 가
        // 통째로 던져지면 openNB 의 에디터 열기 자체가 실패하므로 방어한다.
        const _zl=document.getElementById('zoomLabel');
        if(_zl) _zl.textContent=Math.round(pageScale*100)+'%';
        try{ positionTblBar(); }catch(e){}
        try{ if(findOpen) paintFindHits(); }catch(e){}
        // 14.18.2 · 확대/축소 후 형광펜 띠 좌표를 새 배율로 다시 맞춘다
        try{ _hlRepaintAll(); }catch(_e){}
    }

    let fitScale=1, pageScale=1, zoomPct=100;

    // Ctrl(⌘) + 휠 → 커서 위치 기준 확대/축소
    // Alt + 휠 : 선택한 것들을 비율 그대로 크게/작게 (묶음처럼 함께)
    let sclTimer=null,rotTimer=null;
    document.getElementById('editorBody').addEventListener('wheel',e=>{
        if(!e.altKey||e.ctrlKey||e.metaKey||!doc) return;
        const items=selEntries();
        if(!items.length) return;
        e.preventDefault(); e.stopPropagation();
        // Alt+휠은 기존 크기 조절, Alt+Shift+휠은 선택 요소 회전.
        if(e.shiftKey){
            if(!rotTimer) pushHistory();
            clearTimeout(rotTimer);
            rotTimer=setTimeout(()=>{ rotTimer=null; saveDoc(); },400);
            rotateSelection(e.deltaY<0?-5:5,items);
            return;
        }
        if(!sclTimer) pushHistory();
        clearTimeout(sclTimer);
        sclTimer=setTimeout(()=>{ sclTimer=null; saveDoc(); },400);
        scaleSelection(e.deltaY<0?1.06:1/1.06,items);
    },{passive:false});

    document.getElementById('editorBody').addEventListener('wheel',e=>{
        if(!(e.ctrlKey||e.metaKey)||!doc) return;
        e.preventDefault();
        const body=document.getElementById('editorBody');
        // 화면 중심을 기준으로 확대/축소 (떨림 없이 중심 고정)
        const centerX=body.scrollLeft+body.clientWidth/2;
        const centerY=body.scrollTop +body.clientHeight/2;
        const before=pageScale;
        const step=e.deltaY<0?1.1:1/1.1;
        zoomPct=Math.max(25,Math.min(400,zoomPct*step));
        // 잠깐 스무스 스크롤을 꺼야 scrollTop 지정이 즉시 반영되어 떨리지 않는다
        const wasSmooth=body.style.scrollBehavior;
        body.style.scrollBehavior='auto';
        layoutPages();
        const k=pageScale/before;
        body.scrollLeft=centerX*k-body.clientWidth/2;
        body.scrollTop =centerY*k-body.clientHeight/2;
        body.style.scrollBehavior=wasSmooth;
        sizeTextGhost();
    },{passive:false});
    // ★ 확대/축소 시 보고 있는 화면 중심을 기준으로 줌 (모바일 포함)
    function _zoomCentered(fn){
        const body=document.getElementById('editorBody');
        if(!body){ fn(); return; }
        const centerX=body.scrollLeft+body.clientWidth/2;
        const centerY=body.scrollTop +body.clientHeight/2;
        const before=pageScale;
        const wasSmooth=body.style.scrollBehavior;
        body.style.scrollBehavior='auto';
        fn();
        if(before>0){
            const k=pageScale/before;
            body.scrollLeft=centerX*k-body.clientWidth/2;
            body.scrollTop =centerY*k-body.clientHeight/2;
        }
        body.style.scrollBehavior=wasSmooth;
    }
    function zoomIn(){ _zoomCentered(()=>{ zoomPct=Math.min(400,zoomPct+10); layoutPages(); }); sizeTextGhost(); }
    function zoomOut(){ _zoomCentered(()=>{ zoomPct=Math.max(25,zoomPct-10); layoutPages(); }); sizeTextGhost(); }
    function resetZoom(){ _zoomCentered(()=>{ zoomPct=100; layoutPages(); }); sizeTextGhost(); toast('확대 100%',900); }

    function editorPapers(){ return Array.from(document.querySelectorAll('#pagesStage .paper')); }
    // 14.12 · paperAt 은 DOM 에서 찾되, 부모가 없으면 (이미 제거됨) null 반환
    // 19.x · 셸 가상화 후에는 '창 밖의 쪽'도 정상적으로 null 이다 — 부르는 쪽은
    //        반드시 null 을 견뎌야 한다. paperQ 는 그 방어를 한 줄로 해 준다.
    function paperAt(i){
        const wrap=mountedShells.get(+i);
        if(wrap&&wrap.isConnected){
            const p=wrap.querySelector('.paper');
            if(p) return p;
        }
        // 창 안의 종이는 전부 mountedShells 에 있다 → 없으면 DOM 을 뒤질 필요도 없다.
        // (500쪽 문서에서 '전 쪽 훑기' 코드가 querySelector 를 500번 때리던 비용 제거)
        if(mountedShells.size) return null;
        const el=document.querySelector(`#pagesStage .paper[data-page-idx="${i}"]`);
        return (el && el.parentNode) ? el : null;
    }
    // 그 쪽 종이 안에서 찾기 (종이가 화면에 없으면 null)
    function paperQ(i,sel){
        const p=paperAt(i);
        return p?p.querySelector(sel):null;
    }

    function updatePageInfo(){
        const pinfo=document.getElementById('pageInfo');
        if(pinfo) pinfo.textContent=`/ ${doc.pages.length}`;
        // 9.1 · 제목줄의 쪽 이동칸 (입력 중에는 건드리지 않는다)
        const pn=document.getElementById('pgNow');
        if(pn){
            // 페이지 번호 입력은 일반 숫자칸이라 기본 Enter 동작만으로는
            // 스크롤 위치를 바꾸지 않는다. 한 번만 직접 이동을 연결하고,
            // Enter 없이 입력을 끝내면(blur/change) 실제 현재 쪽을 되돌려
            // 입력 중인 숫자가 화면의 현재 쪽과 어긋나지 않게 한다.
            if(!pn.__sdyPageJumpBound){
                pn.__sdyPageJumpBound=true;
                const restoreCurrentPage=()=>{
                    if(document.activeElement===pn) pn.blur();
                    updatePageInfo();
                    // 테스트 DOM/구형 웹뷰처럼 blur가 activeElement를 바꾸지
                    // 못해도 입력칸은 반드시 실제 현재 쪽을 보여야 한다.
                    if(document.activeElement===pn) pn.value=curPageIdx+1;
                };
                pn.addEventListener('keydown',e=>{
                    if(e.key!=='Enter'||e.isComposing||e.keyCode===229) return;
                    e.preventDefault();
                    const n=parseInt(String(pn.value||''),10);
                    if(Number.isFinite(n)) goToPage(n);
                    restoreCurrentPage();
                });
                pn.addEventListener('blur',restoreCurrentPage);
                pn.addEventListener('change',restoreCurrentPage);
            }
            pn.max=doc.pages.length;
            if(document.activeElement!==pn) pn.value=curPageIdx+1;
        }
        const pt=document.getElementById('pgTot');
        if(pt) pt.textContent=`/ ${doc.pages.length}`;
        // 마지막 보던 쪽을 기억해 둔다 (다시 열면 그 자리로 복구)
        // 14.38 · 복구(restoreLastPos, 열림 +460ms) 가 끝나기 전에는 저장하지
        //   않는다. 예전엔 열리는 길목의 updatePageInfo 가 curPageIdx(아직 0)를
        //   먼저 기록해 두어 복구가 항상 1쪽으로 풀렸고, loadDocAsync 만 마지막
        //   슬라이스를 받아 와 '정작 화면은 1쪽 · 데이터는 그 슬라이스'로 뒤엉켰다.
        if(curNB&&doc&&_posHydrated) saveLastPos();
        const jp=document.getElementById('pageJump');
        if(jp&&document.activeElement!==jp) jp.value=curPageIdx+1;
        const fb=document.getElementById('favBtn');
        if(fb){
            const on=isFavPage(curPageId());
            fb.classList.toggle('active',on);
            // 서랍 버튼은 <i>아이콘</i><span>글자</span> 구조 → 아이콘만 갈아끼운다
            const ic=fb.querySelector('i');
            if(ic) ic.className=on?'ri-star-fill':'ri-star-line';
            else fb.innerHTML=on?'<i class="ri-star-fill"></i>':'<i class="ri-star-line"></i>';
            fb.title=on?'즐겨찾기에서 빼기':'이 페이지 즐겨찾기';
        }
        const fl=document.getElementById('favListBtn');
        if(fl){
            const n=favList().length;
            fl.title=n?`즐겨찾는 페이지 ${n}개`:'즐겨찾는 페이지';
            fl.style.color=n?'#f59e0b':'';
        }
        // 가상화 후 DOM 에는 창 안의 종이만 있다 → 배열 순서가 아니라 쪽 번호로 판정한다
        mountedShells.forEach((wrap,i)=>{
            const on=(i===(curPageIdx|0))&&doc.pages.length>1;
            wrap.classList.toggle('focused',on);
            const p=wrap.querySelector('.paper');
            if(p){ p.classList.toggle('focused',on); p.setAttribute('aria-current',on?'page':'false'); }
        });
        // 쪽수가 바뀌면 라벨('페이지 3 / 500')과 삭제 버튼 상태도 같이 갱신한다
        mountedShells.forEach((wrap,i)=>{
            const lb=wrap.querySelector('.page-label>span');
            if(lb) lb.textContent=`페이지 ${i+1} / ${doc.pages.length}`;
            const del=wrap.querySelector('.page-del');
            if(del) del.disabled=doc.pages.length<=1;
        });
    }
    // 쪽 번호로 종이를 화면에 올리고 스크롤로 데려간다 (가상화된 먼 쪽도 안전)
    function scrollPageIntoView(pi,behavior){
        if(!doc||!doc.pages||!doc.pages[pi]) return;
        curPageIdx=pi; updatePageInfo();
        maintainPageWindow(pi,true);
        const body=document.getElementById('editorBody');
        const w=mountedShells.get(pi);
        if(w&&typeof w.scrollIntoView==='function'){ w.scrollIntoView({behavior:behavior||'auto',block:'center'}); return; }
        _scrollBodyTo(body,pageTopPx(pi),behavior||'auto');
    }

    function addPage(){
        pushHistory();
        doc.pages.push(blankPage());
        curPageIdx=doc.pages.length-1;
        renderPages(); saveDoc();
        // 14.15 · 빠른 노트 전환 뒤에 스크롤이 새 노트의 엉뚱한 쪽을 옮기지 않게
        const _d=doc, _pi=curPageIdx;
        setTimeout(()=>{
            if(doc!==_d||!curNB) return;
            scrollPageIntoView(_pi,'smooth');
        },60);
        toast(`페이지 ${doc.pages.length} 추가됨`,1200);
    }

    function deletePage(i){
        // 18.9 · 인자 없이 불러도(단축키/메뉴 확장) 지금 보는 페이지를 지운다
        if(i==null||isNaN(+i)) i=curPageIdx;
        i=+i;
        if(!doc||!doc.pages[i]) return;
        if(doc.pages.length<=1){ toast('마지막 페이지는 삭제할 수 없습니다'); return; }
        const n=(doc.pages[i].els||[]).length;
        if(n>0&&!confirm(`페이지 ${i+1} 에 ${n}개의 요소가 있습니다. 삭제할까요?`)) return;
        pushHistory();
        purgeElements(doc.pages[i].els||[]);
        const goneId=doc.pages[i].id;
        doc.pages.splice(i,1);
        if(Array.isArray(doc.favPages)) doc.favPages=doc.favPages.filter(x=>x!==goneId);
        clearActiveTbl();
        if(curPageIdx>=doc.pages.length) curPageIdx=doc.pages.length-1;
        selected=null;
        renderPages(); saveDoc();
        toast('페이지 삭제됨',1200);
    }

    // 스크롤로 현재 페이지 추적
    let _scrRaf=0;
    document.getElementById('editorBody').addEventListener('scroll',()=>{
        if(!doc||_scrRaf) return;
        _markScrolling();                              // 무거운 단어 맞춤·레이아웃 읽기를 미룬다
        _scrRaf=requestAnimationFrame(()=>{ _scrRaf=0; onEditorScroll(); });
    },{passive:true});
    // ===== 읽는 동안 배경 점점 고화질 (대용량 가져온 문서) =====
    const _hiBgDone=new Set();   // 이미 고화질로 바꾼 쪽
    const _hiBgBusy=new Set();   // 요청 중인 쪽
    let _hiBgTimer=null;
    async function upgradeHiBg(pi){
        if(!doc||!doc.__ref) return;                     // 가져온(서버 보관) 문서만
        if(_hiBgDone.has(pi)||_hiBgBusy.has(pi)) return;
        const d0=doc, rv=window._renderVersion;
        const page=d0.pages[pi];
        if(!page||page.__lazy!=null) return;             // 아직 안 불린 쪽은 제외
        // 이 쪽에 저화질 배경(가져오기 배경)이 있는지 확인
        const paper=paperAt(pi);
        const bg=paper&&paper.querySelector('.paper-img.pdf-bg img');
        if(!bg) return;
        const bgEl=(page.els||[]).find(e=>e.type==='image'&&e.isBg);
        if(!bgEl||bgEl.pdfBg!==2||/\.svg(?:[?#]|$)/i.test(bg.getAttribute('src')||'')){
            _hiBgDone.add(pi); return;
        }
        const sourcePage=Number.isInteger(bgEl.pdfPage)?bgEl.pdfPage:pi;
        const sourceRef=bgEl.pdfRef||doc.__ref;
        _hiBgBusy.add(pi);
        try{
            const r=await fetch('/api/import/bg/'+encodeURIComponent(sourceRef)+'/'+sourcePage,{cache:'no-store'});
            const d=await r.json().catch(()=>({}));
            if(doc!==d0||window._renderVersion!==rv) return;
            if(d0.pages[pi]!==page){ _hiBgBusy.delete(pi); return; }
            if(d&&d.ok&&d.url){
                // 저장된 요소 URL 도 갱신해 다음 열 때부터 고화질 유지
                const el=(page.els||[]).find(e=>e.type==='image'&&e.isBg);
                if(el) el.url=d.url;
                if(bg.isConnected) bg.src=d.url;         // 화면에 보이면 즉시 교체
                _hiBgDone.add(pi);
            }else if(r.status===404||r.status===410){
                _hiBgDone.add(pi); // expired source/missing legacy plan: no retry storm
            }
        }catch(e){}
        if(doc===d0&&window._renderVersion===rv) _hiBgBusy.delete(pi);
    }
    function scheduleHiBg(){
        clearTimeout(_hiBgTimer);
        _hiBgTimer=setTimeout(()=>{
            if(!doc||!doc.__ref) return;
            // 현재 쪽 + 위아래 한 쪽씩 우선 고화질로
            for(let i=curPageIdx-1;i<=curPageIdx+1;i++){
                if(i>=0&&i<(doc.pages||[]).length) upgradeHiBg(i);
            }
        },500);
    }

    // 화면에서 실제로 가장 많이 보이는 종이를 현재 페이지로 잡는다.
    // 한 기준점 반올림 방식은 1쪽이 더 많이 보여도 2쪽으로 넘어가는 오판이 있었다.
    function mostVisiblePageIndex(scrollTop,viewportH,count,pageH,gap,scale,current){
        if(count<=1) return 0;
        const step=(pageH+gap)*scale,ph=pageH*scale;
        if(!(step>0)||!(ph>0)) return Math.max(0,Math.min(count-1,current|0));
        const top=Math.max(0,Number(scrollTop)||0),bottom=top+Math.max(0,Number(viewportH)||0);
        const first=Math.max(0,Math.min(count-1,Math.floor((top-ph)/step)));
        const last=Math.max(first,Math.min(count-1,Math.floor(bottom/step)));
        let best=Math.max(first,Math.min(last,current|0)),bestSeen=-1;
        for(let i=first;i<=last;i++){
            const pt=i*step,pb=pt+ph;
            const seen=Math.max(0,Math.min(bottom,pb)-Math.max(top,pt));
            // 더 많이 보일 때만 교체한다. 정확한 동률은 기존 쪽을 유지해 경계 떨림 방지.
            if(seen>bestSeen||(seen===bestSeen&&i===(current|0))){ best=i; bestSeen=seen; }
        }
        return best;
    }
    try{ window.sdyMostVisiblePageIndex=mostVisiblePageIndex; }catch(e){}

    function onEditorScroll(){
        if(!doc) return;
        const size=paperSize();
        const body=document.getElementById('editorBody');
        const idx=mostVisiblePageIndex(body.scrollTop,body.clientHeight,doc.pages.length,
            size.h,PAGE_GAP,pageScale,curPageIdx);
        if(idx!==curPageIdx){ curPageIdx=idx; updatePageInfo(); }
        // 종이(셸)는 매 프레임 값싸게 맞추고, 무거운 내용은 스크롤이 멎은 뒤에 채운다.
        syncPageShells();
        maintainPageWindow(idx,false);
        scheduleHiBg();
        schedulePreviewQuality();                          // 읽기 화질과 편집 준비는 별개
        try{ positionTblBar(); }catch(e){}
        const zone=document.getElementById('addPageZone');
        if(zone){
            const near=body.scrollTop+body.clientHeight >= body.scrollHeight-90;
            zone.classList.toggle('near',near);
        }
    }



    // ============ 삭제된 요소의 서버 자원 정리 ============
    // 이미지가 지워지면 Cloudinary 원본과 images 테이블 행도 함께 제거한다.
    function publicIdFromURL(url){
        try{
            // 14.12 · 오라클 서버 저장 이미지(/api/img/파일명) — 파일명 그대로
            const lm=String(url).match(/\/api\/img\/([0-9a-zA-Z._-]+)$/);
            if(lm) return lm[1];
            // 예전 Cloudinary URL (이관 전 노트 정리용)
            const m=String(url).match(/\/upload\/(?:[^/]+\/)*?(?:v\d+\/)?(.+)\.[a-z0-9]+$/i);
            return m? m[1] : null;
        }catch(e){ return null; }
    }
    async function purgeElements(els){
        const list=(els||[]).filter(e=>e&&e.type==='image'&&e.url&&!String(e.url).startsWith('blob:')
                                        &&!String(e.url).startsWith('data:'));
        if(!list.length) return;
        // 다른 페이지/노트에서 같은 URL 을 쓰고 있으면 건드리지 않는다
        const stillUsed=new Set();
        const scan=(d)=>{ (d&&d.pages||[]).forEach(p=>(p.els||[]).forEach(e=>{
            if(e.type==='image'&&e.url) stillUsed.add(e.url); })); };
        if(doc) scan(doc);
        notebooks.forEach(nb=>{
            if(curNB&&nb.id===curNB.id) return;
            if(isLocked(nb.id)&&!isUnlocked(nb.id)) return;
            try{ scan(loadDoc(nb.id)); }catch(e){}
        });

        const targets=list.filter(e=>!stillUsed.has(e.url));
        if(!targets.length) return;

        syncStart();
        try{
            for(const el of targets){
                const pid=el.public_id||publicIdFromURL(el.url);
                // 1) 백엔드에 삭제 요청 (app.py 의 /api/delete)
                try{
                    await fetch('/api/delete',{
                        method:'POST',headers:{'Content-Type':'application/json'},
                        body:JSON.stringify({public_id:pid,url:el.url})
                    });
                }catch(err){ /* 백엔드 없으면 무시 */ }
                // 2) Supabase images 테이블 정리
                if(SB){
                    try{
                        if(pid) await SB.from('images').delete().eq('public_id',pid);
                        else    await SB.from('images').delete().eq('url',el.url);
                    }catch(err){}
                }
            }
            console.info(`서버 자원 ${targets.length}건 정리 요청 완료`);
        }finally{ syncEnd(); }
    }

    // ============ 드래그 다중 선택 (완전히 포함된 객체만) ============
    let marquee=null, multiSel=[];

    // ===== 선택된 요소들을 '한 덩어리'로 다루기 =====
    // 여러 개를 골랐을 때 통째로 비율을 유지한 채 키우거나 줄인다.
    // 펜으로 그린 획도 점 좌표를 함께 배율 조정해 모양이 찌그러지지 않는다.
    function selEntries(){
        if(multiSel.length) return multiSel.map(m=>({id:m.id,pageIdx:m.pageIdx,node:m.node}));
        if(selected&&selected.el) return [{id:selected.el.dataset.id,
            pageIdx:+selected.el.dataset.pageIdx,node:selected.el}];
        return [];
    }
    function unionBBox(items,pi){
        let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9,any=false;
        items.forEach(it=>{
            const el=findEl(it.pageIdx!=null?it.pageIdx:pi,it.id); if(!el) return;
            const b=elBBox(el); if(!b) return;
            any=true;
            x0=Math.min(x0,b.x); y0=Math.min(y0,b.y);
            x1=Math.max(x1,b.x+b.w); y1=Math.max(y1,b.y+b.h);
        });
        return any?{x:x0,y:y0,w:x1-x0,h:y1-y0}:null;
    }
    // 묶음 전체를 기준점(cx,cy) 중심으로 f 배 확대/축소
    function scaleSelection(f,items){
        items=items||selEntries();
        if(!items.length) return false;
        const pi=items[0].pageIdx;
        const bb=unionBBox(items,pi); if(!bb) return false;
        const cx=bb.x+bb.w/2, cy=bb.y+bb.h/2;
        // 너무 작아지거나 커지지 않게
        if(f<1 && Math.min(bb.w,bb.h)*f<12) return false;
        if(f>1 && Math.max(bb.w,bb.h)*f>4000) return false;
        let lastFS=0;        // 마지막으로 키운/줄인 글상자의 글자 크기 (툴바 동기화용)
        items.forEach(it=>{
            const el=findEl(it.pageIdx,it.id); if(!el) return;
            if(el.type==='stroke'){
                const dx=el.dx||0, dy=el.dy||0;
                el.pts=(el.pts||[]).map(p=>[
                    cx+((p[0]+dx)-cx)*f - dx,
                    cy+((p[1]+dy)-cy)*f - dy ]);
                el.size=Math.max(.5,(el.size||2)*f);
                const node=it.node;
                if(node){
                    const d=strokePath(el.pts,el.sharp&&!isEllipsePts(el.pts));
                    node.querySelectorAll('path').forEach(pn=>pn.setAttribute('d',d));
                    const fp=paperQ(it.pageIdx,`.stroke-fill[data-for="${el.id}"]`); if(fp) fp.setAttribute('d',d);
                    syncStrokeTransform(el,node,it.pageIdx);
                    const vis=node.querySelector('.stroke-vis');
                    if(vis) vis.setAttribute('stroke-width',el.size);
                    const halo=node.querySelector('.stroke-halo');
                    if(halo) halo.setAttribute('stroke-width',el.size+8);
                    const hit=node.querySelector('.stroke-hit');
                    if(hit) hit.setAttribute('stroke-width',Math.max(8,el.size+6));
                }
            }else{
                const nw=Math.max(12,(el.w||1)*f), nh=Math.max(12,(el.h||1)*f);
                el.x=Math.round(cx+((el.x||0)-cx)*f);
                el.y=Math.round(cy+((el.y||0)-cy)*f);
                el.w=Math.round(nw); el.h=Math.round(nh);
                // 14.16 · Alt+휠로 상자를 키우면 겉모양만 커지고 글씨는 옛 크기로
                //   남아, 그 뒤 '+' 를 누르면 툴바의 낡은 값(처음 16)으로 되돌아갔다.
                //   → 상자에 적용한 배율을 '그 상자의 글자 크기'로 같이 저장한다.
                if(el.type==='text'){
                    el.fontSize=Math.max(6,Math.round((el.fontSize||16)*f));
                    lastFS=el.fontSize;
                }
                const node=it.node;
                if(node){
                    node.style.left=el.x+'px'; node.style.top=el.y+'px';
                    node.style.width=el.w+'px'; node.style.height=el.h+'px';
                    const c=node.querySelector('.tb-content');
                    if(c&&el.type==='text'&&el.fontSize){
                        c.style.fontSize=el.fontSize+'px';
                        // 상자 안에서 '이 단어만' 키워 둔 글자도 같은 배율로 함께
                        if(scaleInlineFS(c,f)) el.html=imathCollapse(stripWF(c.innerHTML));
                    }
                }
            }
        });
        // 방금 바뀐 글자 크기를 툴바에도 옮겨 둔다 → 이어서 '+' 를 눌러도
        //   지금 보이는 크기에서 더 커진다 (작아지지 않는다).
        if(lastFS) setToolbarFS(lastFS);
        return true;
    }
    function rotateSelection(delta,items){
        items=items||selEntries();
        if(!items.length) return false;
        items.forEach(it=>{
            const el=findEl(it.pageIdx,it.id); if(!el) return;
            el.rotation=normalizedRotation((Number(el.rotation)||0)+delta);
            markPageEdited(it.pageIdx);
            if(el.type==='stroke') syncStrokeTransform(el,it.node,it.pageIdx);
            else if(it.node) applyBoxRotation(it.node,el);
        });
        return true;
    }
    function rotateSelectionTo(angle,items){
        items=items||selEntries();
        if(!items.length) return false;
        items.forEach(it=>{
            const el=findEl(it.pageIdx,it.id); if(!el) return;
            el.rotation=normalizedRotation(angle); markPageEdited(it.pageIdx);
            if(el.type==='stroke') syncStrokeTransform(el,it.node,it.pageIdx);
            else if(it.node) applyBoxRotation(it.node,el);
        });
        return true;
    }

    // 상자 안에 '부분적으로만' 지정된 글자 크기(span style="font-size")가 있으면
    // 상자 배율과 같은 비율로 함께 키우고, 실제로 바꾼 것이 있으면 true 를 준다.
    function _scalePdfSpan(sp,f,v){
        if(!sp.dataset||!(parseFloat(sp.dataset.pdfW)>0)) return false;
        // Resize source geometry together, not just its painted font.
        const fs=Math.max(1,+(v*f).toFixed(3));
        for(const key of ['pdfW','pdfBase']){
            const old=parseFloat(sp.dataset[key]);
            if(Number.isFinite(old)) sp.dataset[key]=String(+(old*f).toFixed(3));
        }
        for(const key of ['left','top']){
            const old=parseFloat(sp.style[key]);
            if(Number.isFinite(old)) sp.style[key]=(old*f).toFixed(3)+'px';
        }
        sp.dataset.fs=String(fs); sp.style.lineHeight=fs+'px'; sp.style.fontSize=fs+'px';
        return true;
    }
    function scaleInlineFS(c,f){
        if(!c||!f) return false;
        let spans=null;
        try{ spans=c.querySelectorAll('[style*="font-size"]'); }catch(e){ return false; }
        if(!spans||!spans.length) return false;
        let n=0;
        spans.forEach(sp=>{
            const v=parseFloat(sp.style.fontSize); if(!v) return;
            if(_scalePdfSpan(sp,f,v)){ n++; return; }
            sp.style.fontSize=Math.max(2,Math.round(v*f))+'px'; n++;
        });
        return n>0;
    }

    // ===== 객체 묶기 (그룹) =====
    // 같은 group 값을 가진 요소는 하나만 클릭해도 함께 선택된다.
    function groupSelection(){
        const items=selEntries();
        if(items.length<2){ toast('두 개 이상 선택해 주세요',1800); return; }
        pushHistory();
        const gid='g_'+Math.random().toString(36).slice(2,9);
        items.forEach(it=>{ const el=findEl(it.pageIdx,it.id); if(el){ el.group=gid; markPageEdited(it.pageIdx); } });
        saveDoc();
        toast(`${items.length}개를 묶었습니다`,1600);
    }
    function ungroupSelection(){
        const items=selEntries();
        if(!items.length) return;
        pushHistory();
        let cnt=0;
        items.forEach(it=>{ const el=findEl(it.pageIdx,it.id);
            if(el&&el.group){ delete el.group; cnt++; markPageEdited(it.pageIdx); } });
        saveDoc();
        toast(cnt?`묶음을 해제했습니다`:'묶인 항목이 없습니다',1600);
    }
    function selectionHasGroup(){
        return selEntries().some(it=>{ const el=findEl(it.pageIdx,it.id); return el&&el.group; });
    }
    // 그룹에 속한 요소를 고르면 같은 그룹 전체를 선택 상태로 만든다
    function expandGroupSelection(pageIdx,id){
        const el=findEl(pageIdx,id);
        if(!el||!el.group) return false;
        const paper=paperAt(pageIdx); if(!paper) return false;
        deselectAll(true); clearMulti();
        (doc.pages[pageIdx].els||[]).forEach(e=>{
            if(e.group!==el.group) return;
            const node=paper.querySelector(`[data-id="${e.id}"]`);
            if(node){ node.classList.add('msel'); multiSel.push({id:e.id,pageIdx,node}); }
        });
        return multiSel.length>1;
    }



    function clearMulti(){
        document.querySelectorAll('.msel').forEach(n=>n.classList.remove('msel'));
        multiSel=[];
    }
    // Ctrl(⌘)+클릭: 요소를 다중 선택에 토글 (이미 있으면 빼고, 없으면 더한다)
    function toggleMultiSelect(pageIdx,node){
        if(!node) return;
        // Ctrl+클릭으로 상자/이미지 다중 선택을 시작하는 순간, 이전에 드래그해
        // 두었던 글자 선택(savedRange)은 더 이상 사용자 의도가 아니다. 남겨 두면
        // 글자 크기/색 버튼이 보이는 다중 선택 대신 예전 글자 조각에 적용된다.
        clearTextSelection();
        const idx=multiSel.findIndex(m=>m.node===node);
        if(idx>=0){                        // 이미 선택됨 → 해제
            node.classList.remove('msel');
            multiSel.splice(idx,1);
        }else{                             // 새로 추가
            node.classList.add('msel');
            multiSel.push({id:node.dataset.id,pageIdx,node});
        }
        if(multiSel.length){
            selected=null;                 // 단일 선택은 해제 (다중 모드로)
        }
        document.querySelectorAll('.tb.sel,.paper-img.sel,.stroke-g.sel')
            .forEach(n=>n.classList.remove('sel'));
        return multiSel.length;
    }
    function elBBox(el,pageIdx){
        if(el.type==='stroke'){
            const pts=el.pts||[]; if(!pts.length) return null;
            const bb=strokeBBox(el);
            return {x:bb.x+(el.dx||0), y:bb.y+(el.dy||0), w:bb.w, h:bb.h};
        }
        return {x:el.x||0, y:el.y||0, w:el.w||1, h:el.h||1};
    }
    function startMarquee(e,pageIdx){
        const p=pageLocal(e,pageIdx);
        const paper=paperAt(pageIdx);
        const box=document.createElement('div');
        box.className='marquee';
        paper.appendChild(box);
        marquee={pageIdx, x0:p.x, y0:p.y, box, moved:false};
    }
    function updateMarquee(e){
        if(!marquee) return;
        const p=pageLocal(e,marquee.pageIdx);
        const x=Math.min(marquee.x0,p.x), y=Math.min(marquee.y0,p.y);
        const w=Math.abs(p.x-marquee.x0), h=Math.abs(p.y-marquee.y0);
        if(w>3||h>3) marquee.moved=true;
        Object.assign(marquee.box.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});
        marquee.rect={x,y,w,h};

        // 완전히 포함된 것만 선택 (일부만 걸치면 무시)
        clearMulti();
        const pi=marquee.pageIdx;
        (doc.pages[pi].els||[]).forEach(el=>{
            const b=elBBox(el,pi);
            const inside = b.x>=x && b.y>=y && (b.x+b.w)<=(x+w) && (b.y+b.h)<=(y+h);
            if(!inside) return;
            const node=paperQ(pi,`[data-id="${el.id}"]`);
            if(node){ node.classList.add('msel'); multiSel.push({id:el.id,pageIdx:pi,node}); }
        });
    }
    function endMarquee(){
        if(!marquee) return;
        const had=marquee.moved;
        marquee.box.remove();
        const n=multiSel.length;
        marquee=null;
        if(!had){ clearMulti(); return; }
        if(n) toast(`${n}개 선택됨 · 드래그로 이동, Del 로 삭제`,1800);
        else clearMulti();
    }

    // 다중 선택 이동
    let multiDrag=null;
    function startMultiDrag(e){
        const pi=multiSel[0].pageIdx;
        multiDrag={sx:e.clientX,sy:e.clientY,pageIdx:pi,moved:false,
            items:multiSel.map(m=>{
                const el=findEl(m.pageIdx,m.id);
                if(!el) return null;
                return {id:m.id,node:m.node,el,
                        ox:(el.type==='stroke')?(el.dx||0):el.x,
                        oy:(el.type==='stroke')?(el.dy||0):el.y};
            }).filter(Boolean)};
        if(!multiDrag.items.length){ multiDrag=null; return; }
        // 묶음 전체의 바운딩 박스 (스냅 기준)
        let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
        multiDrag.items.forEach(it=>{
            const bb=elBBox(it.el,pi); if(!bb) return;
            x0=Math.min(x0,bb.x); y0=Math.min(y0,bb.y);
            x1=Math.max(x1,bb.x+bb.w); y1=Math.max(y1,bb.y+bb.h);
        });
        if(isFinite(x0)) multiDrag.bb={x:x0,y:y0,w:x1-x0,h:y1-y0};
        _beginMultiPreview(multiDrag);
    }
    function hitMultiSel(e){
        let n=e.target.closest('.msel');
        if(!n){
            // SVG 획 등은 부모 g 로 올라가서 확인
            const g=e.target.closest('.stroke-g,.tb,.paper-img');
            if(g&&g.classList.contains('msel')) n=g;
        }
        return !!n && multiSel.some(m=>m.node===n);
    }
    // ===== 요소 클립보드 (앱 내부) =====
    let clipboardEls=[], nudgeTimer=null;

    function selectedElsData(){
        const out=[];
        if(multiSel.length){
            multiSel.forEach(m=>{ const el=findEl(m.pageIdx,m.id); if(el) out.push(el); });
        }else if(selected&&selected.el&&selected.el.dataset){
            const el=findEl(+selected.el.dataset.pageIdx,selected.el.dataset.id);
            if(el) out.push(el);
        }
        return out;
    }
    // 선택된 텍스트상자들의 '안의 글자'를 선택 순서대로 OS 클립보드에 복사한다
    function htmlToPlain(h,tight){
        const d=document.createElement('div'); d.innerHTML=h||'';
        d.querySelectorAll('br').forEach(b=>b.replaceWith('\n'));
        d.querySelectorAll('div,p').forEach(b=>b.append('\n'));
        // 가져온 PDF 상자(tight)는 단어마다 절대좌표 <span> 이라 그냥 이으면
        // 단어가 다 붙어버린다 → 스팬 사이에 공백을 한 칸 넣어 문장으로 되살린다.
        if(tight) d.querySelectorAll('span[data-fs]').forEach(s=>s.append(' '));
        // sup/sub 는 지우지 않는다 (x² 의 ² 가 사라지던 문제)
        let t=(d.textContent||'').replace(/\u00a0/g,' ');
        if(tight) t=t.replace(/[ \t]{2,}/g,' ').replace(/ +\n/g,'\n');
        return t.trim();
    }
    function fallbackCopyText(t){
        try{
            const ta=document.createElement('textarea');
            ta.value=t; ta.style.position='fixed'; ta.style.opacity='0';
            document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); ta.remove();
        }catch(e){}
    }
    try{ window.fallbackCopyText=fallbackCopyText; }catch(e){}
    function copySelectedTextAsText(els){
        const parts=els.map(el=>htmlToPlain(el.html,el.tight)).filter(t=>t.length);
        const text=parts.join('\n');
        // 18.9 · OS 클립보드에는 '글자'를 주되, 앱 안에서 붙여넣을 때를 대비해
        //   원본 상자(위치·크기·글꼴·서식)도 함께 기억한다. 같은 글자를 그대로
        //   붙여넣으면 맹숭맹숭한 새 상자가 아니라 '상자 복제'가 되도록.
        try{ clipboardEls=JSON.parse(JSON.stringify(els)); _lastCopyText=text; }catch(e){}
        if(!text){ toast('복사할 글자가 없습니다',1600); return; }
        const done=()=>toast(els.length>1?`${els.length}개 상자 복사됨`:'복사됨',1200);
        if(navigator.clipboard&&navigator.clipboard.writeText){
            navigator.clipboard.writeText(text)
                .then(done).catch(()=>{ fallbackCopyText(text); done(); });
        }else{ fallbackCopyText(text); done(); }
    }
    let _lastCopyText='';           // 18.9 · 방금 우리가 OS 클립보드에 넣은 글자
    // 18.12 · 사진을 복사/잘라내면 내부 클립보드(앱 안 붙여넣기)뿐 아니라
    //   OS 클립보드에도 실제 이미지(PNG)를 올려 워드 등 외부 앱에 바로 붙여넣는다.
    async function copyImageToClipboard(el){
        try{
            if(!el||el.type!=='image') return false;
            // 소스: 확정 서버 URL → data:(레거시) 순서. blob: 은 쓰지 않는다.
            const src=_imgRealURL(el)
                ? el.url
                : (String(el.localURL||'').startsWith('data:')
                    ? el.localURL
                    : '');
            if(!src) return false;
            let blob=null;
            if(String(src).startsWith('data:')){
                blob=dataURLToFile(src,'copy.png');
            }else{
                const r=await fetch(src,{cache:'force-cache'});
                if(!r.ok) return false;
                blob=await r.blob();
            }
            if(!blob) return false;
            // 브라우저 ClipboardItem 호환성(공통)을 위해 PNG 로 다시 그린다.
            const url=URL.createObjectURL(blob);
            const img=await new Promise((res,rej)=>{
                const i=new Image();
                i.onload=()=>res(i);
                i.onerror=()=>rej(new Error('img load fail'));
                i.src=url;
            });
            const c=document.createElement('canvas');
            const w=img.naturalWidth||img.width||1, h=img.naturalHeight||img.height||1;
            c.width=w; c.height=h;
            c.getContext('2d').drawImage(img,0,0,w,h);
            try{ URL.revokeObjectURL(url); }catch(e){}
            const png=await canvasToBlob(c,'image/png');
            if(!png) return false;
            if(!(navigator.clipboard&&window.ClipboardItem)) return false;
            await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);
            return true;
        }catch(e){ console.warn('[사진 복사] OS 클립보드에 넣지 못했습니다', e); return false; }
    }
    function osCopyImageToClipboard(el,cut){
        try{
            copyImageToClipboard(el).then(ok=>{
                toast(ok
                    ? (cut?'잘라내기 · 이미지를 클립보드에 복사했습니다':'이미지를 클립보드에 복사했습니다')
                    : (cut?'잘라냄':'복사됨'), cut?1500:1400);
            });
        }catch(e){ toast(cut?'잘라냄':'복사됨',1200); }
    }
    function copyElements(cut){
        const els=selectedElsData();
        if(!els.length) return;
        clipboardEls=JSON.parse(JSON.stringify(els));
        _lastCopyText='';
        const singleImg=els.length===1&&els[0].type==='image';
        if(cut){
            pushHistory();
            const pi=multiSel.length?multiSel[0].pageIdx:+selected.el.dataset.pageIdx;
            const ids=els.map(x=>x.id);
            doc.pages[pi].els=(doc.pages[pi].els||[]).filter(x=>!ids.includes(x.id));
            clearMulti(); deselectAll();
            markPageEdited(pi); renderPageEls(pi); saveDoc();
            if(singleImg) osCopyImageToClipboard(els[0], true);
            else toast(`${els.length}개 잘라냄`,1200);
        }else{
            if(singleImg) osCopyImageToClipboard(els[0], false);
            else toast(`${els.length}개 복사됨`,1200);
        }
    }
    function pasteElements(){
        if(!clipboardEls.length||!doc) return;
        const pi=(lastMouse.pageIdx>=0&&lastMouse.pageIdx<doc.pages.length)?lastMouse.pageIdx:curPageIdx;
        pushHistory();
        // 클립보드 묶음의 좌상단을 기준점으로 삼아 마우스 위치로 옮김
        let minX=Infinity,minY=Infinity;
        clipboardEls.forEach(el=>{
            const b=el.type==='stroke'
                ? {x:Math.min(...el.pts.map(q=>q[0]))+(el.dx||0), y:Math.min(...el.pts.map(q=>q[1]))+(el.dy||0)}
                : {x:el.x,y:el.y};
            minX=Math.min(minX,b.x); minY=Math.min(minY,b.y);
        });
        const tx=(lastMouse.x!=null?lastMouse.x:minX+20)-minX;
        const ty=(lastMouse.y!=null?lastMouse.y:minY+20)-minY;
        const made=[];
        clipboardEls.forEach(src=>{
            const el=JSON.parse(JSON.stringify(src));
            el.id=uid(el.type==='text'?'t':el.type==='latex'?'m':el.type==='image'?'i':'s');
            if(el.type==='stroke'){ el.dx=(el.dx||0)+tx; el.dy=(el.dy||0)+ty; }
            else{
                const c=clampEl(el.x+tx,el.y+ty,el.w,el.h);
                el.x=Math.round(c.x); el.y=Math.round(c.y);
            }
            doc.pages[pi].els.push(el); made.push(el);
        });
        markPageEdited(pi); renderPageEls(pi); saveDoc();
        clearMulti(); deselectAll(true);
        // 붙여넣은 것들을 선택 상태로
        const paper=paperAt(pi);
        made.forEach(el=>{
            const node=paper.querySelector(`[data-id="${el.id}"]`);
            if(node){ node.classList.add('msel'); multiSel.push({id:el.id,pageIdx:pi,node}); }
        });
        if(multiSel.length===1){ multiSel[0].node.classList.remove('msel'); multiSel[0].node.classList.add('sel');
            if(clipboardEls[0].type==='image') _ensureImgControls(multiSel[0].node);
            else _ensureTbControls(multiSel[0].node);
            selected={type:clipboardEls[0].type==='image'?'image':clipboardEls[0].type,el:multiSel[0].node}; multiSel=[]; }
        toast(`${made.length}개 붙여넣음`,1200);
    }
    function duplicateSelection(){
        const els=selectedElsData();
        if(!els.length) return;
        const keep=clipboardEls;
        clipboardEls=JSON.parse(JSON.stringify(els));
        const pi=multiSel.length?multiSel[0].pageIdx:+selected.el.dataset.pageIdx;
        // 원본에서 살짝 어긋나게
        const sx=lastMouse.x, sy=lastMouse.y, spi=lastMouse.pageIdx;
        let minX=Infinity,minY=Infinity;
        clipboardEls.forEach(el=>{
            const b=el.type==='stroke'
                ? {x:Math.min(...el.pts.map(q=>q[0]))+(el.dx||0), y:Math.min(...el.pts.map(q=>q[1]))+(el.dy||0)}
                : {x:el.x,y:el.y};
            minX=Math.min(minX,b.x); minY=Math.min(minY,b.y);
        });
        lastMouse.pageIdx=pi; lastMouse.x=minX+16; lastMouse.y=minY+16;
        pasteElements();
        lastMouse.x=sx; lastMouse.y=sy; lastMouse.pageIdx=spi;
        clipboardEls=keep;
    }
    function selectAllOnPage(){
        const pi=curPageIdx;
        const paper=paperAt(pi); if(!paper) return;
        deselectAll(true); clearMulti();
        (doc.pages[pi].els||[]).forEach(el=>{
            const node=paper.querySelector(`[data-id="${el.id}"]`);
            if(node){ node.classList.add('msel'); multiSel.push({id:el.id,pageIdx:pi,node}); }
        });
        if(multiSel.length) toast(`${multiSel.length}개 선택됨`,1100);
    }

    async function deleteMulti(){
        if(!multiSel.length) return;
        pushHistory();
        const pi=multiSel[0].pageIdx;
        const ids=new Set(multiSel.map(m=>m.id));
        const all=doc.pages[pi].els||[];
        const tableIds=new Set();
        all.forEach(el=>{ if(ids.has(el.id)){ const tid=tblOf(el); if(tid) tableIds.add(tid); } });
        // 표의 일부 칸/선만 다중 선택 후 삭제해도 표 메타데이터와 모든 테두리를 함께 제거한다.
        const tableGroups=new Set(pageTables(pi).filter(t=>tableIds.has(t.id)).map(t=>t.group).filter(Boolean));
        const shouldRemove=el=>ids.has(el.id)||tableIds.has(tblOf(el))||(el.group&&tableGroups.has(el.group));
        const removed=all.filter(shouldRemove);
        if(removed.length) markPageEdited(pi);
        doc.pages[pi].els=all.filter(el=>!shouldRemove(el));
        const activeTableRemoved=!!(activeTbl&&activeTbl.pageIdx===pi&&tableIds.has(activeTbl.tid));
        if(tableIds.size) doc.pages[pi].tables=pageTables(pi).filter(t=>!tableIds.has(t.id));
        clearMulti();
        if(activeTableRemoved) clearActiveTbl();
        renderPageEls(pi);
        renderTblDivs(pi);
        positionTblBar();
        await purgeElements(removed);       // 서버 자원도 정리
        saveDoc();
        toast(`${removed.length}개 삭제됨`,1400);
    }


/* APP-PART:06-pages.js:END */
