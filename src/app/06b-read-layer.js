/* === src/app/06b-read-layer.js ===
   읽기 우선 레이어 · 고화질 배경 · 자원 정리
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:06b-read-layer.js:BEGIN */
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
                // 14.39.1 · 빠른 스크롤 시 다른 페이지 글자가 겹쳐 보이는 버그 방지:
                //   flush 직전에 paper가 여전히 살아 있고 같은 idx의 shell인지 재확인.
                //   unmount/재사용 경합 시 이전 페이지 텍스트가 새 페이지에 붙는 것을 차단.
                const flushBags=()=>{
                    if(!_pageJobLive(job)||_pageRenderTok[idx]!==tok) return false;
                    if(!paper.isConnected||paperAt(idx)!==paper) return false;
                    // 각 레이어가 여전히 같은 paper에 속해 있는지 확인 (detach 방지)
                    if(imgL.parentNode!==paper||txtL.parentNode!==paper) return false;
                    imgL.appendChild(bags.img);
                    if(fillL) fillL.appendChild(bags.fill);
                    svg.appendChild(bags.svg);
                    txtL.appendChild(bags.txt);
                    return true;
                };
                if(!flushBags()){ _cancelPageRender(idx); return; }
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

/* APP-PART:06b-read-layer.js:END */
