/* === src/app/06a-page-virtual.js ===
   페이지 렌더 · 셸 가상화 · 유동 로딩
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:06a-page-virtual.js:BEGIN */
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
    // 14.39.1 · 빠른 스크롤 고스팅 방지: scale + translateZ(0) 으로 각 페이지를
    //   독립 컴포지터 레이어로 승격시켜 다른 페이지 글자가 겹쳐 보이는 현상 차단.
    //   will-change:transform 은 글자를 비트맵으로 래스터화해 확대 시 흐릿해지므로
    //   translateZ(0) + isolation:isolate + contain:paint 조합을 사용한다.
    function positionPageWrap(wrap,i){
        const size=paperSize();
        wrap.style.transform=`scale(${pageScale}) translateZ(0)`;
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
/* APP-PART:06a-page-virtual.js:END */
// 14.39.2 verified: fast-scroll ghosting fix present (translateZ + isolation + overflow-anchor)
