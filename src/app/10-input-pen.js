/* === src/app/10-input-pen.js ===
   배치모드 · 히스토리키 · 펜/지우개 · 핀치
   (sdynotes.js 메가 분리 · 이 파일들은 scripts/bundle-frontend.mjs 가 순서대로 이어 붙인다.
    let/const 스코프를 공유하려면 반드시 concat 되어야 한다 — 단독 <script> 로드 금지) */
/* APP-PART:10-input-pen.js:BEGIN */
    // ============ 요소 배치 모드 (그림·수식) ============
    // 예전엔 텍스트 상자·표만 '누른 자리 = 생기는 자리' 보정(pageLocal)이 돼 있었고
    //  · 그림은 도구막대에서 넣으면 늘 쪽 한가욵데에,
    //  · 수식은 마우스가 마지막으로 스쳐 지나간 자리(오래된 lastMouse)에 들어갔다.
    // 사이트 기본 배율(html zoom 90%) 아래서는 기준점과 결과의 단위가 엇갈려
    // '커서보다 한 뼘(≈1cm) 오른쪽에 생긴다'고 느껴지던 것의 실제 원인이다.
    // 그림·수식도 상자·표와 같은 방식으로 바꾼다: 커서를 따라다니는 고스트를
    // 문서 좌표로 그리고(moveTextGhost 와 같은 변환), 누른 그 지점에 똑같이 넣는다.
    let placeMode=null;   // {kind:'image',items:[{file,url,box}],idx,w,h}
                          // {kind:'latex',src,display,fontSize,w,h}
    function beginImgPlacement(items){
        if(!items||!items.length) return;
        cancelPlaceMode();
        if(penActive) finishDrawing();
        setTextTool(false); if(tablePlace) cancelTablePlacement();
        if(pinMode) togglePinMode();
        deselectAll();
        placeMode={kind:'image',items,idx:0,w:items[0].box.w,h:items[0].box.h};
        placeGhostShow();
        toast(items.length>1
            ? `종이를 눌러 그림을 차례로 배치하세요 (총 ${items.length}장)`
            : '종이에서 원하는 위치를 눌러 그림을 배치하세요',2200);
    }
    function beginLatexPlacement(src,display){
        cancelPlaceMode();
        if(penActive) finishDrawing();
        setTextTool(false); if(tablePlace) cancelTablePlacement();
        if(pinMode) togglePinMode();
        deselectAll();
        placeMode={kind:'latex',src,display,
            w:display?400:230, h:display?82:48, fontSize:display?22:18};
        placeGhostShow();
        toast('종이에서 원하는 위치를 눌러 수식을 배치하세요',2200);
    }
    function placeGhostShow(){
        const pm=placeMode, g=document.getElementById('placeGhost');
        if(!pm||!g) return;
        const body=document.getElementById('placeGhostBody');
        const ic=document.getElementById('placeGhostIcon'), lb=document.getElementById('placeGhostLabel');
        if(pm.kind==='image'){
            const it=pm.items[pm.idx];
            pm.w=it.box.w; pm.h=it.box.h;
            if(ic) ic.className='ri-image-add-line';
            if(lb) lb.textContent=pm.items.length>1?`그림 ${pm.idx+1}/${pm.items.length}`:'그림 넣기';
            body.innerHTML=`<div class="pg-scale" style="width:${it.box.w}px;height:${it.box.h}px;`+
                `background-image:url('${it.url}')"></div>`;
        }else{
            if(ic) ic.className='ri-function-line';
            if(lb) lb.textContent='수식 넣기';
            body.innerHTML=`<div class="pg-scale pg-latex" style="width:${pm.w}px;height:${pm.h}px;`+
                `font-size:${pm.fontSize}px;line-height:1.05">${latexHTML(pm.src,pm.display)}</div>`;
        }
        g.style.display='block';
        document.body.classList.add('placing-el');
        // 첫 위치: 현재 쪽 위쪽 중앙 (상자·표 고스트와 같은 규칙)
        const p=paperAt(curPageIdx), r=p&&p.getBoundingClientRect();
        movePlaceGhost(r?r.left+r.width/2:innerWidth/2,
                       r?r.top+Math.min(r.height*.22,200):innerHeight/3);
    }
    function movePlaceGhost(clientX,clientY){
        const g=document.getElementById('placeGhost'); if(!g||!placeMode) return;
        // moveTextGhost 와 같은 변환: 포인터 아래 종이의 실제 화면 사각형을 기준으로
        // 문서 좌표를 구하고, 고스트는 화면 UI CSS px 로 놓는다. 배율이 몇 %이든
        // 고스트 = 만들어질 요소 다.
        // ★ r.left/k 와 sc.x 의 /k 는 viewport px → CSS px 변환에 필수.
        //   자세한 원리는 moveTextGhost 주석 참조.
        const hit=typeof document.elementFromPoint==='function'
            ?document.elementFromPoint(clientX,clientY):null;
        const over=hit&&hit.closest&&hit.closest('.paper');
        const paper=over||paperAt(curPageIdx);
        if(!paper) return;
        const pi=+paper.dataset.pageIdx, s=paperSize();
        const p=over?pageLocal({clientX,clientY},pi):{x:s.w/2,y:Math.min(s.h*.22,180)};
        const o=clampEl(p.x-placeMode.w/2,p.y-placeMode.h/2,placeMode.w,placeMode.h);
        const r=paper.getBoundingClientRect(),sc=uiPageScale(pi),k=uiCssZoom();
        g.style.width=Math.round(placeMode.w*sc.x)+'px';
        g.style.height=Math.round(placeMode.h*sc.y)+'px';
        g.style.left=Math.round(r.left/k+o.x*sc.x)+'px';
        g.style.top=Math.round(r.top/k+o.y*sc.y)+'px';
        g.dataset.pageIdx=String(pi);
        const inner=g.querySelector('.pg-scale');
        if(inner) inner.style.transform=`scale(${sc.x})`;
    }
    // 배치 모드에서 종이를 눌렀다 — 미리보기와 똑같은 문서 좌표에 넣는다.
    // ★ x,y 는 pageLocal 로 구한 문서 px. /uiCssZoom() 하지 않는다.
    //   고스트(movePlaceGhost)는 position:fixed 이므로 /k 로 CSS px 변환하지만,
    //  둘 다 최종 화면 위치는 같다. (자세한 원리는 moveTextGhost 주석 참조)
    function commitPlaceAt(pi,x,y){
        const pm=placeMode; if(!pm) return;
        if(pm.kind==='image'){
            const it=pm.items[pm.idx];
            if(it) placeImgItem(it,pi,x,y);
            pm.idx++;
            commitImagesNow();
            if(pm.idx>=pm.items.length){ cancelPlaceMode(); toast('그림을 넣었습니다',1300); }
            else placeGhostShow();      // 다음 장 크기·미리보기로 교체
            return;
        }
        if(pm.kind==='latex'){
            pushHistory();
            const c=clampEl(x-pm.w/2,y-pm.h/2,pm.w,pm.h);
            doc.pages[pi].els.push({type:'latex',id:uid('m'),latex:pm.src,
                x:Math.round(c.x),y:Math.round(c.y),w:pm.w,h:pm.h,
                fontSize:pm.fontSize,displayMath:pm.display?1:0});
            if(renderedPages.has(pi)) renderPageEls(pi);
            markPageEdited(pi); saveDoc(); cancelPlaceMode(); toast('수식을 넣었습니다',1300);
            return;
        }
        cancelPlaceMode();
    }
    function cancelPlaceMode(){
        if(!placeMode) return;
        // v3 · 아직 배치하지 않은 그림은 이미 서버에 올라가 있다 — 주인이 없는
        //   업로드는 서버에서도 지운다 (고아 파일 방지).
        if(placeMode.kind==='image'&&placeMode.items){
            try{ discardImgItems(placeMode.items.slice(placeMode.idx)); }catch(e){}
        }
        placeMode=null;
        const g=document.getElementById('placeGhost');
        if(g){ g.style.display='none'; const b=document.getElementById('placeGhostBody'); if(b) b.innerHTML=''; }
        document.body.classList.remove('placing-el');
    }

    function toggleTextTool(){ setTextTool(!textToolActive); }
    function setTextTool(on){
        textToolActive=!!on;
        if(on) try{ activateVisiblePages(); }catch(_e){}   // 20.0
        if(on&&tablePlace) cancelTablePlacement();
        if(on) cancelPlaceMode();
        if(on&&penActive) finishDrawing();
        const g=document.getElementById('textGhost');
        g.style.display=on?'block':'none';
        document.body.classList.toggle('placing-text',!!on);
        document.getElementById('textToolBtn').classList.toggle('active',on);
        if(on){
            // 마우스를 아직 움직이지 않아도 현재 종이 위쪽 중앙에 미리보기를 보인다.
            // (좌표는 화면 px → 아래 moveTextGhost 가 문서 좌표로 바꿔 똑같이 놓는다)
            const p=paperAt(curPageIdx), r=p&&p.getBoundingClientRect();
            moveTextGhost(r?r.left+r.width/2:(lastMouse.clientX||innerWidth/2),
                          r?r.top+Math.min(r.height*.22,180):(lastMouse.clientY||innerHeight/2));
        }
    }
    // 배율이 바뀌면 고스트를 '지금 커서 자리'에 크기와 위치 모두 다시 맞춘다.
    // 예전엔 pageScale 로 크기만 다시 쟀다 — 위치는 clientX 를 그대로 style.left 에
    // 넣어 둔 값이라 배율 전환 뒤에도 어긋난 채로 남아 있었다.
    function sizeTextGhost(){
        if(textToolActive) moveTextGhost(lastMouse.clientX||0,lastMouse.clientY||0);
        if(tablePlace) moveTableGhost(lastMouse.clientX||0,lastMouse.clientY||0);
        if(placeMode) movePlaceGhost(lastMouse.clientX||0,lastMouse.clientY||0);
    }
    const TB_W=200, TB_H=48;
    function textBoxDefaultSize(fontSize){
        const fs=Math.max(2,Math.min(200,Math.round(fontSize||curFontSize||16)));
        // 기본 글상자는 현재 툴바 글자 크기가 한 줄 들어갈 높이를 우선 보장한다.
        // 큰 글씨를 고른 뒤 만들면 48px 고정 상자가 아니라 그 글씨에 맞춰 시작한다.
        return {
            w:Math.max(TB_W,Math.round(Math.min(420,fs*8))),
            h:Math.max(TB_H,Math.round(fs*1.45+22))
        };
    }

    // ============ 뒤로가기(브라우저 히스토리) 처리 ============
    // 에디터·폴더·모달을 열 때 히스토리 항목을 쌓아, 뒤로가기를 누르면
    // 사이트를 빠져나가는 대신 열려 있던 화면/모달이 닫히게 한다.
    const _nav=[];
    function openNav(close){ _nav.push({close}); try{ history.pushState({sdy:_nav.length},''); }catch(e){} }
    function navDrop(close){ const i=_nav.findIndex(x=>x.close===close); if(i>=0) _nav.splice(i,1); }
    function navBack(){
        if(!_nav.length) return;
        try{ history.back(); }
        catch(e){ const it=_nav.pop(); if(it&&it.close){ try{ it.close(); }catch(err){} } }
    }
    window.addEventListener('popstate',(e)=>{
        const target=(e.state&&typeof e.state.sdy==='number')?e.state.sdy:0;
        while(_nav.length>target){
            const it=_nav.pop();
            if(it&&it.close){ try{ it.close(); }catch(err){} }
        }
    });
    // 열려 있는 것 중 가장 위를 닫는다 (Esc / 뒤로가기 공용). 닫았으면 true.
    function closeTopOverlay(){
        if(ctxMenuOpen()){ closeCtxMenu(); return true; }
        if(presentOn){ endPresent(); return true; }
        if(wfOn){ wfOff(); return true; }
        if(document.getElementById('pinPop').classList.contains('show')){ closePin(); return true; }
        if(document.getElementById('latexModal').style.display==='flex'){ closeLatexModal(); return true; }
        if(pinMode){ togglePinMode(); return true; }
        if(findOpen){ closeFind(); return true; }
        if(tablePlace){ cancelTablePlacement(); return true; }
        if(placeMode){ cancelPlaceMode(); return true; }
        if(activeTbl){ clearActiveTbl(); return true; }
        if(focusMode){ toggleFocus(); return true; }
        if(sidePanel){ closePanel(); return true; }
        if(document.getElementById('viewer').style.display==='flex'){document.getElementById('viewer').style.display='none';return true;}
        if(textToolActive){ setTextTool(false); return true; }
        if(penActive){ finishDrawing(); return true; }
        // 변환 중에는 닫지 않는다
        if(document.getElementById('importProg').style.display==='flex') return false;
        // 주요 모달·에디터는 히스토리와 함께 닫는다 (뒤로가기와 일관)
        if(document.getElementById('cpModal').style.display==='flex'){ navBack(); return true; }
        if(document.getElementById('exportModal').style.display==='flex'){ navBack(); return true; }
        if(document.getElementById('pwModal').style.display==='flex'){ navBack(); return true; }
        if(document.getElementById('createModal').style.display==='flex'){ navBack(); return true; }
        if(document.getElementById('vaultModal').style.display==='flex'){ navBack(); return true; }
        if(document.getElementById('folderStyleModal').style.display==='flex'){ navBack(); return true; }
        if(document.getElementById('keyModal').style.display==='flex'){ navBack(); return true; }
        if(document.getElementById('delModal').style.display==='flex'){ navBack(); return true; }
        if(document.getElementById('setModal').style.display==='flex'){ navBack(); return true; }
        if(document.getElementById('stickerModal').style.display==='flex'){ navBack(); return true; }
        if(document.getElementById('infoModal').style.display==='flex'){ navBack(); return true; }
        if(document.getElementById('trashModal').style.display==='flex'){ navBack(); return true; }
        if(document.getElementById('editorView').classList.contains('open')){ navBack(); return true; }
        if(curFolder){ openFolder(folderParent(curFolder), true); return true; }
        return false;
    }

    // 해돌이 입력/말풍선에 포커스가 남은 채로 종이 요소를 눌러도 요소 선택 로직이
    // mousedown 기본 동작을 막기 때문에 포커스가 검색창에 계속 남을 수 있었다.
    // 그러면 선택은 그림에 보이는데 Delete·Ctrl+Z는 'AI UI 안'으로 판정돼 무시된다.
    // 종이 본문을 누르는 순간 키보드 소유권을 노트로 되돌린다. 말풍선은 그대로 둔다.
    function focusNoteFromAi(e){
        const t=e&&e.target;
        if(!(t&&t.closest&&t.closest('#pagesStage'))) return;
        const ae=document.activeElement;
        if(ae&&ae.closest&&ae.closest('#aiAsk,#aiSay,#aiHist')&&ae.blur) ae.blur();
    }
    document.addEventListener('pointerdown',focusNoteFromAi,true);
    document.addEventListener('mousedown',focusNoteFromAi,true); // PointerEvent 없는 환경·런타임 테스트

    document.addEventListener('keydown',e=>{
        // 발표 모드 조작
        if(presentOn){
            if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown'){ e.preventDefault(); presentStep(1); return; }
            if(e.key==='ArrowLeft'||e.key==='PageUp'){ e.preventDefault(); presentStep(-1); return; }
            if(e.key==='Escape'){ e.preventDefault(); endPresent(); return; }
        }
        if(e.ctrlKey&&!e.shiftKey&&(e.key==='h'||e.key==='H')){
            if(document.getElementById('editorView').classList.contains('open')){
                e.preventDefault();
                if(!findOpen) openFind();
                const bar=document.getElementById('findBar');
                if(!bar.classList.contains('rep')) toggleReplace();
                else document.getElementById('repInput').focus();
                return;
            }
        }
        if(e.ctrlKey&&e.shiftKey&&(e.key==='c'||e.key==='C')){
            if(document.getElementById('editorView').classList.contains('open')){
                e.preventDefault(); countSelection(); return;
            }
        }
        if(e.ctrlKey&&!e.shiftKey&&(e.key==='f'||e.key==='F')){
            if(document.getElementById('editorView').classList.contains('open')){
                e.preventDefault(); openFind(); return;
            }
        }
        // ===== 스프레드시트식: 편집 중 Enter/Tab/Escape (커밋 + 셀 이동) =====
        {
            const ae=document.activeElement;
            const inContent=!!(ae&&ae.classList&&ae.classList.contains('tb-content'));
            // 18.9 · Escape 는 '글상자 편집 중'이면 언제나 편집만 끝낸다.
            //   예전엔 포커스가 정확히 .tb-content 에 있을 때만 그렇게 했고,
            //   툴바 글자 크기칸을 만졌다가 Escape 를 누르면 편집 중인데도
            //   아래의 closeTopOverlay() 가 걸려 **노트 자체가 닫혀** 버렸다.
            const w=inContent?ae.closest('.tb'):document.querySelector('.tb.edit');
            // 한글 IME 조합 중에는 Enter(확정)를 가로채면 입력이 깨진다 → 그대로 둠
            const composing=e.isComposing||e.keyCode===229;
            if(w){
                if(e.key==='Tab' && inContent && !composing){
                    e.preventDefault();
                    exitEditKeepSel(w);
                    moveCellFrom(w, e.shiftKey?'prev':'next');
                    return;
                }
                if(e.key==='Escape' && !composing){
                    e.preventDefault();
                    if(!inContent && ae && ae.blur) ae.blur();   // 툴바 입력칸에서 빠져나온다
                    exitEditKeepSel(w);
                    return;
                }
            }
        }
        if(e.key==='Escape'){
            if(closeTopOverlay()) return;
        }
        // 표 셀 범위: 방향키로 이동, Shift+방향키로 직사각형 확장.
        // Delete는 표 전체를 제거하고 Backspace는 선택한 칸의 내용만 비운다.
        if(tblCellSelection&&!document.querySelector('.tb.edit')&&doc
           &&document.getElementById('editorView').classList.contains('open')
           &&!/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement||{}).tagName||'')){
            const dirs={ArrowLeft:[0,-1],ArrowRight:[0,1],ArrowUp:[-1,0],ArrowDown:[1,0]};
            if(dirs[e.key]){
                e.preventDefault(); moveTblCellSelection(dirs[e.key][0],dirs[e.key][1],e.shiftKey); return;
            }
            if(e.key==='Tab'){
                e.preventDefault();
                const s=tblCellSelection,t=findTbl(s.pageIdx,s.tid),n=t&&t.cw.length;
                if(t&&n){
                    const total=t.ch.length*n;
                    const at=Math.max(0,Math.min(total-1,s.r1*n+s.c1+(e.shiftKey?-1:1)));
                    s.r0=s.r1=Math.floor(at/n); s.c0=s.c1=at%n;
                    setActiveTbl(s.pageIdx,s.tid,s.r1,s.c1); paintTblCellSelection();
                }
                return;
            }
            if(e.key==='Enter'||e.key==='F2'){ e.preventDefault(); editTblSelectionCell(); return; }
            if(e.key==='Delete'){
                e.preventDefault();
                const s=tblCellSelection;
                tblDelAll(true,s.tid,s.pageIdx);
                return;
            }
            if(e.key==='Backspace'){ e.preventDefault(); clearTblCellContents(); return; }
        }
        // 단축키 도움말
        // 사용법은 설정에서만 연다 (노트 안에서는 뜨지 않음)
        if((e.key==='?'||e.key==='F1')
           && !document.getElementById('editorView').classList.contains('open')
           && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement||{}).tagName||'')){
            e.preventDefault();
            document.getElementById('keyModal').style.display==='flex'?closeKeys():openKeys();
            return;
        }
        // 방향키: 단일 텍스트 상자 = 스프레드시트식 셀 이동, 그 외/Shift·Alt = 미세 이동
        if(/^Arrow(Up|Down|Left|Right)$/.test(e.key) && !document.querySelector('.tb.edit')
           && (selected||multiSel.length) && doc
           && document.getElementById('editorView').classList.contains('open')
           && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement||{}).tagName||'')){
            const _curBox=currentSelText();
            if(_curBox && !e.shiftKey && !e.altKey){
                e.preventDefault();
                const _dir={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[e.key];
                const _nb=nearestBox(_curBox,_dir);
                if(_nb){ selectTextBoxById(_nb.pi,_nb.id); try{_nb.node.scrollIntoView({block:'nearest'});}catch(_e){} }
                return;
            }
            e.preventDefault();
            const step=e.shiftKey?10:1;
            const dx=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0;
            const dy=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;
            if(!nudgeTimer) pushHistory();
            clearTimeout(nudgeTimer);
            nudgeTimer=setTimeout(()=>{ nudgeTimer=null; saveDoc(); },500);
            const move=(id,pi,node)=>{
                const el=findEl(pi,id); if(!el) return;
                markPageEdited(pi);
                if(el.type==='stroke'){
                    el.dx=(el.dx||0)+dx; el.dy=(el.dy||0)+dy;
                    syncStrokeTransform(el,node,pi);
                }else{
                    const c=clampEl(el.x+dx,el.y+dy,el.w,el.h);
                    el.x=Math.round(c.x); el.y=Math.round(c.y);
                    node.style.left=el.x+'px'; node.style.top=el.y+'px';
                }
            };
            if(multiSel.length) multiSel.forEach(m=>move(m.id,m.pageIdx,m.node));
            else move(selected.el.dataset.id,+selected.el.dataset.pageIdx,selected.el);
            return;
        }
        // ===== 스프레드시트식: 셀 선택 상태에서 Tab/Enter/F2 =====
        if(!document.querySelector('.tb.edit') && doc
           && document.getElementById('editorView').classList.contains('open')
           && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement||{}).tagName||'')){
            const curBox=currentSelText();
            if(curBox){
                if(e.key==='Tab'){
                    e.preventDefault();
                    const nb=nextBoxInOrder(curBox, e.shiftKey?-1:1);
                    if(nb){ selectTextBoxById(nb.pi,nb.id); try{nb.node.scrollIntoView({block:'nearest'});}catch(_e){} }
                    return;
                }
                if(e.key==='Enter' || e.key==='F2'){
                    e.preventDefault();
                    enterEdit(curBox.node, true);
                    return;
                }
            }
        }
        // ── 입력칸에 포커스가 있으면 이 아래 노트 단축키들은 접는다 ──
        //   이 아래는 전부 '노트(캔버스)를 다루는' 단축키다 — Ctrl+A(전체 선택)·
        //   Ctrl+C/X/J(요소 복사·잘라내기·복제)·Delete/Backspace(요소 삭제)·
        //   Ctrl+D/E/P/Enter(쪽 복제·내보내기·새 쪽)·Ctrl+Z/Y(되돌리기).
        //   그런데 해돌이 검색창(#aiQ)처럼 글자를 치는 칸에 포커스가 있을 때도
        //   그대로 가로챘다 — Ctrl+A 를 누르면 칸 안의 글이 아니라 노트 전체가
        //   선택되고, Ctrl+Z 는 방금 친 글이 아니라 노트를 되돌렸다.
        //   그래서 노트 본문(.tb-content) 편집 중이 아닌 '바깥 입력칸'에서는
        //   브라우저·입력칸 기본 동작에 맡긴다. (Ctrl+S 저장은 예외로 살린다.
        //   찾기 Ctrl+F·바꿔치기 Ctrl+H·Esc 는 이 가드보다 위에서 먼저 본다.)
        {
            const _ae=document.activeElement, _tag=(_ae&&_ae.tagName)||'';
            const _inField=(_tag==='INPUT'||_tag==='TEXTAREA'||_tag==='SELECT')
                ||!!(_ae&&_ae.isContentEditable&&!_ae.classList.contains('tb-content'))
                // 18.13 · 해돌이 대화 UI(#aiAsk·#aiSay·#aiHist) 안쪽을 누르면
                //   편집기 단축키(Ctrl+A/Z·Delete 등)를 가로채지 않는다 — 말풍선·
                //   기록은 input 이 아니라 예전엔 포커스가 그대로 노트에 남아
                //   Ctrl+A 가 답변 글 대신 노트 전체를 골랐다. 말풍선·기록에
                //   tabindex 를 줘 클릭으로 포커스가 들어오게 하고, 여기서 그
                //   포커스를 '바깥 입력칸'처럼 다룬다. (Ctrl+S 저장은 예외)
                ||!!(_ae&&_ae.closest&&_ae.closest('#aiAsk,#aiSay,#aiHist'));
            if(_inField&&!((e.ctrlKey||e.metaKey)&&(e.key==='s'||e.key==='S'))) return;
        }
        // 요소 복사 / 잘라내기 / 붙여넣기 / 복제
        if((e.ctrlKey||e.metaKey)&&!document.querySelector('.tb.edit')&&doc
           && document.getElementById('editorView').classList.contains('open')){
            const k=e.key.toLowerCase();
            // 텍스트가 드래그 선택돼 있으면 '글자 복사'가 우선 (요소 복사로 가로채지 않는다)
            const _sel=window.getSelection();
            const textPicked=_sel&&!_sel.isCollapsed&&String(_sel).trim().length>0
                             &&_sel.anchorNode&&_sel.anchorNode.parentElement
                             &&_sel.anchorNode.parentElement.closest('.tb-content');
            if((k==='c'||k==='x')&&textPicked){
                // 아래 copy 리스너가 '순수 글자'만 클립보드에 넣는다
                if(k==='c') setTimeout(()=>toast('텍스트 복사됨',1200),0);
                return;
            }
            // 텍스트 상자를 골라 Ctrl+C → 안의 '글자만' 선택한 순서대로 복사.
            // 상자 1개만 골랐을 때도 똑같이 글자를 준다 (예전엔 요소 복사로 빠졌다).
            if(k==='c'&&(multiSel.length||selected)){
                const _ms=selectedElsData();
                if(_ms.length&&_ms.every(x=>x.type==='text')){
                    e.preventDefault(); copySelectedTextAsText(_ms); return;
                }
            }
            if(k==='c'&&(selected||multiSel.length)){ e.preventDefault(); copyElements(false); return; }
            if(k==='x'&&(selected||multiSel.length)){ e.preventDefault(); copyElements(true);  return; }
            if(k==='j'&&(selected||multiSel.length)){e.preventDefault(); duplicateSelection();  return; }
            if(k==='a'){
                e.preventDefault(); selectAllOnPage(); return;
            }
        }
        // 표가 선택된 상태면 Delete 로 표 통째 삭제
        if((e.key==='Delete'||e.key==='Backspace')&&tblSelectedForDelete()
           && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement||{}).tagName||'')){
            e.preventDefault(); tblDelAll(true); return;
        }
        if((e.key==='Delete'||e.key==='Backspace')&&multiSel.length&&!document.querySelector('.tb.edit')){
            e.preventDefault(); deleteMulti(); return;
        }
        if(e.key==='Escape'&&multiSel.length){ clearMulti(); return; }
        if((e.key==='Delete'||e.key==='Backspace')&&selected&&!document.querySelector('.tb.edit')){
            e.preventDefault();
            const lid=selected.el.dataset.id, lpi=+selected.el.dataset.pageIdx;
            const hel=findEl(lpi,lid);
            if(hel&&tblOf(hel)){
                tblDelAll(true, tblOf(hel), lpi);
                return;
            }
            if(isElLocked(lpi,lid)){ toast('잠긴 요소는 지울 수 없습니다',1800); return; }
            pushHistory();
            const id=lid, pi=lpi;
            const gone=(doc.pages[pi].els||[]).filter(x=>x.id===id);
            doc.pages[pi].els=doc.pages[pi].els.filter(x=>x.id!==id);
            const sf=paperQ(pi,`.stroke-fill[data-for="${id}"]`); if(sf) sf.remove();
            selected.el.remove(); selected=null; markPageEdited(pi); saveDoc();
            purgeElements(gone);
        }
        if(e.ctrlKey&&(e.key==='s'||e.key==='S')){
            e.preventDefault();
            // input 디바운스(300ms)가 아직 끝나기 전에도 Ctrl+S는 현재
            // contenteditable 내용을 먼저 문서에 반영해야 한다.
            // 자동 저장은 조용히, 수동 저장(Ctrl+S)만 결과를 저장 상태 글자로 보여 준다.
            if(doc){
                commitEditingText();
                flushSaveDoc();
                flushSync({manual:true}).catch(()=>{});
            }
            return;
        }
        if(e.ctrlKey&&(e.key==='d'||e.key==='D')){
            if(doc&&!document.querySelector('.tb.edit')){ e.preventDefault(); duplicatePage(); }
            return;
        }
        if(e.ctrlKey&&(e.key==='e'||e.key==='E')){
            if(doc){ e.preventDefault(); openExportModal(); }
            return;
        }
        if(e.ctrlKey&&(e.key==='p'||e.key==='P')){
            if(doc){ e.preventDefault(); exportPDF(); }
            return;
        }
        if(e.ctrlKey&&e.key==='Enter'){
            if(doc){ e.preventDefault(); addPage(); }
            return;
        }
        if((e.ctrlKey||e.metaKey)&&(e.key==='z'||e.key==='Z')){
            if(!_useAppUndo()) return;      // 20.3 · 글자 타이핑은 브라우저 기본 undo 우선
            e.preventDefault();
            _scriptEditUndoable=false;
            if(e.shiftKey) redo(); else undo();
            return;
        }
        if((e.ctrlKey||e.metaKey)&&(e.key==='y'||e.key==='Y')){
            if(!_useAppUndo()) return;
            e.preventDefault(); _scriptEditUndoable=false; redo(); return;
        }
    });

    // ============ 펜 / 지우개 ============
    let penActive=false, eraserActive=false, paintMode=false, drawColor=CLASSIC_DRAW_COLORS[0], drawSize=2;
    let shapeMode='free', markerMode=false;
    let drawing=false, curPts=null, curPathNode=null, drawPageIdx=0;
    const ERASER_MULT=6;   // 지우개 반경 = drawSize * ERASER_MULT

    function eraserRadius(){ return (drawSize*ERASER_MULT)/2; }

    function syncDrawModeButtons(){
        const p=document.getElementById('penBtn');
        const h=document.getElementById('highlighterBtn');
        const f=document.getElementById('paintBtn');
        if(p) p.classList.toggle('active',!!penActive&&!markerMode&&!paintMode);
        if(h) h.classList.toggle('active',!!penActive&&!!markerMode&&!paintMode);
        if(f) f.classList.toggle('active',!!penActive&&!!paintMode);
        const legacy=document.getElementById('markerBtn');
        if(legacy) legacy.classList.toggle('active',!!markerMode);
    }
    function startDrawMode(asMarker,asPaint){
        setTextTool(false);
        cancelPlaceMode();
        deselectAll();
        penActive=true; eraserActive=false; drawing=false; markerMode=!!asMarker; paintMode=!!asPaint;
        try{ activateVisiblePages(); }catch(_e){}   // 20.0 · 펜을 들면 보이는 쪽을 편집 상태로
        const er=document.getElementById('eraserBtn'); if(er) er.classList.remove('active');
        const bar=document.getElementById('drawToolbar'); if(bar) bar.style.display='flex';
        editorPapers().forEach(p=>p.classList.add('drawing'));
        syncDrawModeButtons();
        updateToolCursor();
        try{ saveDrawCfg(); }catch(e){}
    }
    function togglePen(){
        if(penActive&&!markerMode&&!paintMode){ finishDrawing(); return; }
        startDrawMode(false,false);
        toast('펜 모드',900);
    }
    function toggleHighlighter(){
        if(penActive&&markerMode&&!paintMode){ finishDrawing(); return; }
        startDrawMode(true,false);
        toast('형광펜 모드 (반투명·굵게)',1100);
    }
    function togglePaint(){
        if(penActive&&paintMode){ finishDrawing(); return; }
        startDrawMode(false,true);
        toast('페인트 모드 · 닫힌 그림 안쪽을 눌러 채우세요',1600);
    }
    function finishDrawing(){
        clearMorphTimer();
        penActive=false; eraserActive=false; paintMode=false; drawing=false;
        syncDrawModeButtons();
        const er=document.getElementById('eraserBtn'); if(er) er.classList.remove('active');
        const bar=document.getElementById('drawToolbar'); if(bar) bar.style.display='none';
        editorPapers().forEach(p=>p.classList.remove('drawing'));
        const tc=document.getElementById('toolCursor'); if(tc) tc.style.display='none';
        saveDoc();
    }
    function setShape(m){
        shapeMode=m; eraserActive=false; paintMode=false; markerMode=false;
        document.getElementById('eraserBtn').classList.remove('active');
        document.querySelectorAll('.shp').forEach(b=>b.classList.remove('active'));
        const map={free:'shpFree',line:'shpLine',arrow:'shpArrow',rect:'shpRect',ellipse:'shpEllipse'};
        const b=document.getElementById(map[m]); if(b) b.classList.add('active');
        updateToolCursor();
        try{ saveDrawCfg(); }catch(e){}
    }
    // 14.17 · 펜 색·굵기·도형·형광펜을 브라우저에 기억해 두면 모바일/데스크톱
    //   모두 '다음에 펜을 열 때도 같은 설정'으로 바로 그릴 수 있다.
    const DRAW_CFG_KEY='sdy_draw_cfg';
    // 14.18.4 · localStorage 에 남아 있던 예전 기본색/파스텔 펜 색도 지금의
    //   세련된 진한 팔레트로 맞춘다. 사용자가 임의로 고른 다른 색은 그대로 둔다.
    function saveDrawCfg(){
        try{ localStorage.setItem(DRAW_CFG_KEY, JSON.stringify({color:drawColor,size:drawSize,shape:shapeMode,marker:markerMode})); }catch(e){}
    }
    function restoreDrawCfg(){
        try{
            const c=JSON.parse(localStorage.getItem(DRAW_CFG_KEY)||'null');
            if(!c) return;
            if(c.color){
                c.color=_classicPaletteColor('draw',c.color);
                drawColor=c.color;
                const pc=document.getElementById('penCustom');
                if(pc){ pc.value=c.color; pc.style.setProperty('--custom-color',c.color); }
                let hit=false;
                document.querySelectorAll('.color-pick[data-c]').forEach(x=>{
                    const on=String(x.dataset.c).toLowerCase()===String(c.color).toLowerCase();
                    x.classList.toggle('sel',on); if(on) hit=true;
                });
                if(pc) pc.classList.toggle('sel',!hit);
            }
            if(c.size){
                drawSize=+c.size||drawSize;
                document.querySelectorAll('.size-opt').forEach(x=>x.classList.toggle('sel',+x.dataset.s===drawSize));
            }
            if(c.shape&&['free','line','arrow','rect','ellipse'].includes(c.shape)){
                shapeMode=c.shape;
                document.querySelectorAll('.shp').forEach(b=>b.classList.remove('active'));
                const b=document.getElementById({free:'shpFree',line:'shpLine',arrow:'shpArrow',rect:'shpRect',ellipse:'shpEllipse'}[c.shape]);
                if(b) b.classList.add('active');
            }
            if(typeof c.marker==='boolean') markerMode=c.marker;
            syncDrawModeButtons();
        }catch(e){}
    }
    function toggleMarker(){
        // 하위 호환용: 예전 툴바 안 형광펜 버튼이 호출하던 함수.
        if(penActive&&markerMode) startDrawMode(false);
        else startDrawMode(true);
        toast(markerMode?'형광펜 모드 (반투명·굵게)':'펜 모드',1200);
    }
    function setDrawColorVal(v){
        drawColor=v; eraserActive=false;
        document.querySelectorAll('.color-pick').forEach(c=>c.classList.remove('sel'));
        const pc=document.getElementById('penCustom');
        if(pc){ pc.classList.add('sel'); pc.style.setProperty('--custom-color',v); }
        const er=document.getElementById('eraserBtn'); if(er) er.classList.remove('active');
        updateToolCursor();
        try{ saveDrawCfg(); }catch(e){}
    }
    function setDrawColor(el){
        drawColor=el.dataset.c; eraserActive=false;
        const pc=document.getElementById('penCustom');
        if(pc){ pc.value=el.dataset.c; pc.classList.remove('sel'); pc.style.setProperty('--custom-color',el.dataset.c); }
        document.querySelectorAll('.color-pick').forEach(c=>c.classList.remove('sel'));
        el.classList.add('sel');
        const er=document.getElementById('eraserBtn'); if(er) er.classList.remove('active');
        updateToolCursor();
        try{ saveDrawCfg(); }catch(e){}
    }
    function setDrawSize(el){
        drawSize=+el.dataset.s;
        document.querySelectorAll('.size-opt').forEach(s=>s.classList.remove('sel'));
        el.classList.add('sel');
        updateToolCursor();
        try{ saveDrawCfg(); }catch(e){}
    }
    function toggleEraser(){
        eraserActive=!eraserActive;
        if(eraserActive){ paintMode=false; markerMode=false; }
        document.getElementById('eraserBtn').classList.toggle('active',eraserActive);
        syncDrawModeButtons();
        updateToolCursor();
    }

    // 펜촉/지우개 크기를 화면 배율에 맞춰 '실제 크기' 그대로 표시
    function updateToolCursor(){
        const tc=document.getElementById('toolCursor');
        if(!penActive){ tc.style.display='none'; return; }
        const d=(eraserActive? eraserRadius()*2 : (paintMode?12:effSize()))*pageScale;
        const px=Math.max(eraserActive?10:(paintMode?12:4), d);
        tc.style.width=px+'px'; tc.style.height=px+'px';
        tc.className='tool-cursor '+(eraserActive?'eraser':(paintMode?'paint':(markerMode?'marker':'pen')));
        // 펜에서 설정한 인라인 색이 지우개에 남지 않도록 매번 초기화
        if(eraserActive){ tc.style.background=''; tc.style.borderColor=''; }
        else { tc.style.background=hexA(drawColor,.35); tc.style.borderColor=drawColor; }
        tc.querySelector('.dot').style.display=(!eraserActive&&px<6)?'block':'none';
        tc.style.display='block';
    }
    function hexA(hex,a){
        const h=hex.replace('#',''); const f=h.length===3?h.split('').map(c=>c+c).join(''):h;
        const n=parseInt(f,16);
        return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
    }
    try{ restoreDrawCfg(); }catch(e){}
    const _toolCursorMove=('PointerEvent' in window)?'pointermove':'mousemove';
    document.addEventListener(_toolCursorMove,e=>{
        if(!penActive) return;
        const points=typeof e.getCoalescedEvents==='function'?e.getCoalescedEvents():null;
        const p=points&&points.length?points[points.length-1]:e;
        const tc=document.getElementById('toolCursor');
        // left/top을 계속 바꾸면 레이아웃이 매번 다시 계산되어 고주사율 포인터가
        // 버벅였다. 최신 좌표만 GPU transform 변수로 넘긴다.
        tc.style.setProperty('--cursor-x',uiCss(p.clientX)+'px');
        tc.style.setProperty('--cursor-y',uiCss(p.clientY)+'px');
    },{passive:true});

    function surfacePos(e,pageIdx){
        const t=(e.touches&&e.touches[0])?e.touches[0]:e;
        return pageLocal(t,pageIdx);
    }

    let shapeStart=null, curShapeKind=null, drawMorphTimer=0, drawMorphAnim=0;
    const DRAW_MORPH_HOLD_MS=620;
    function effSize(){ return markerMode? drawSize*4 : drawSize; }
    function effOpacity(){ return markerMode? 0.4 : 1; }
    function clearMorphTimer(){
        if(drawMorphTimer){ clearTimeout(drawMorphTimer); drawMorphTimer=0; }
        if(drawMorphAnim){ cancelAnimationFrame(drawMorphAnim); drawMorphAnim=0; }
    }
    function scheduleMorphHold(){
        if(shapeMode!=='free'||eraserActive||curShapeKind) return;
        if(!curPts||curPts.length<4) return;
        if(drawMorphTimer) clearTimeout(drawMorphTimer);
        drawMorphTimer=setTimeout(()=>{ drawMorphTimer=0; morphCurrentStroke(); },DRAW_MORPH_HOLD_MS);
    }
    function drawPtsBBox(pts){
        let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
        (pts||[]).forEach(p=>{ const x=p[0],y=p[1]; if(x<x1)x1=x; if(y<y1)y1=y; if(x>x2)x2=x; if(y>y2)y2=y; });
        return isFinite(x1)?{x1,y1,x2,y2,w:x2-x1,h:y2-y1,cx:(x1+x2)/2,cy:(y1+y2)/2}:null;
    }
    function ptDist(a,b){ return Math.hypot((a[0]||0)-(b[0]||0),(a[1]||0)-(b[1]||0)); }
    function lineDist(p,a,b){
        const vx=b[0]-a[0], vy=b[1]-a[1], wx=p[0]-a[0], wy=p[1]-a[1];
        const l=vx*vx+vy*vy; let t=l?((wx*vx+wy*vy)/l):0; t=Math.max(0,Math.min(1,t));
        return Math.hypot(p[0]-(a[0]+vx*t),p[1]-(a[1]+vy*t));
    }
    function rdpPts(pts,eps){
        if(!pts||pts.length<=2) return (pts||[]).slice();
        let best=0,idx=-1,a=pts[0],b=pts[pts.length-1];
        for(let i=1;i<pts.length-1;i++){ const d=lineDist(pts[i],a,b); if(d>best){ best=d; idx=i; } }
        if(best<=eps||idx<0) return [a,b];
        const left=rdpPts(pts.slice(0,idx+1),eps), right=rdpPts(pts.slice(idx),eps);
        return left.slice(0,-1).concat(right);
    }
    function pathLenPts(pts){
        let L=0; for(let i=1;i<(pts||[]).length;i++) L+=ptDist(pts[i-1],pts[i]); return L;
    }
    function resamplePts(pts,n){
        pts=(pts||[]).filter(Boolean);
        if(!pts.length) return [];
        if(pts.length===1||n<=1) return Array.from({length:Math.max(1,n)},()=>[pts[0][0],pts[0][1]]);
        const total=pathLenPts(pts)||1, step=total/(n-1), out=[[pts[0][0],pts[0][1]]];
        let seg=1, segStart=pts[0], segLen=ptDist(pts[0],pts[1]), walked=0;
        for(let i=1;i<n-1;i++){
            const target=step*i;
            while(seg<pts.length-1 && walked+segLen<target){ walked+=segLen; segStart=pts[seg]; seg++; segLen=ptDist(pts[seg-1],pts[seg]); }
            const prev=pts[seg-1], next=pts[seg];
            const t=segLen?Math.max(0,Math.min(1,(target-walked)/segLen)):0;
            out.push([prev[0]+(next[0]-prev[0])*t, prev[1]+(next[1]-prev[1])*t]);
        }
        const last=pts[pts.length-1]; out.push([last[0],last[1]]);
        return out;
    }
    function canonicalShapePoints(kind,bb){
        if(!bb) return null;
        let x1=bb.x1,y1=bb.y1,x2=bb.x2,y2=bb.y2;
        if(kind==='square'||kind==='circle'){
            const d=Math.max(bb.w,bb.h), cx=bb.cx, cy=bb.cy;
            x1=cx-d/2; x2=cx+d/2; y1=cy-d/2; y2=cy+d/2;
        }
        const a={x:round1(x1),y:round1(y1)}, b={x:round1(x2),y:round1(y2)};
        if(kind==='rect'||kind==='square') return shapePoints(a,b,'rect',false);
        if(kind==='ellipse'||kind==='circle') return shapePoints(a,b,'ellipse',false);
        if(kind==='triangle'){
            const cx=round1((x1+x2)/2);
            return [[cx,round1(y1)],[round1(x2),round1(y2)],[round1(x1),round1(y2)],[cx,round1(y1)]];
        }
        if(kind==='diamond'){
            const cx=round1((x1+x2)/2), cy=round1((y1+y2)/2);
            return [[cx,round1(y1)],[round1(x2),cy],[cx,round1(y2)],[round1(x1),cy],[cx,round1(y1)]];
        }
        return null;
    }
    function recognizeMorphShape(pts){
        pts=(pts||[]).filter(p=>p&&isFinite(p[0])&&isFinite(p[1]));
        if(pts.length<4) return null;
        const bb=drawPtsBBox(pts); if(!bb) return null;
        const diag=Math.hypot(bb.w,bb.h); if(diag<18) return null;
        const first=pts[0], last=pts[pts.length-1];
        const closed=ptDist(first,last)<=Math.max(18,diag*.22);
        if(!closed){
            const end=ptDist(first,last);
            if(end<18) return null;
            let maxD=0; pts.forEach(p=>{ maxD=Math.max(maxD,lineDist(p,first,last)); });
            if(maxD<=Math.max(5,end*.16)) return {shape:'line',pts:[[round1(first[0]),round1(first[1])],[round1(last[0]),round1(last[1])]]};
            return null;
        }
        if(bb.w<12||bb.h<12) return null;
        const body=pts.slice();
        if(ptDist(body[0],body[body.length-1])<Math.max(8,diag*.08)) body.pop();
        const nearEdge=body.filter(p=>Math.min(Math.abs(p[0]-bb.x1),Math.abs(p[0]-bb.x2),Math.abs(p[1]-bb.y1),Math.abs(p[1]-bb.y2))<=Math.max(4,diag*.075)).length/body.length;
        const simp=rdpPts(body.concat([body[0]]),Math.max(5,diag*.075)).slice(0,-1)
            .filter((p,i,a)=>i===0||ptDist(p,a[i-1])>Math.max(5,diag*.06));
        const ratio=bb.w&&bb.h?Math.min(bb.w,bb.h)/Math.max(bb.w,bb.h):0;
        if(nearEdge>.52){
            const target=canonicalShapePoints(ratio>.82?'square':'rect',bb);
            return target?{shape:ratio>.82?'square':'rect',pts:target}:null;
        }
        if(simp.length>=3&&simp.length<=4){
            if(simp.length===3){
                const target=canonicalShapePoints('triangle',bb);
                return target?{shape:'triangle',pts:target}:null;
            }
            // 마름모는 꼭짓점이 위/오른쪽/아래/왼쪽 주변에 하나씩 있을 때만 잡는다.
            const cx=bb.cx, cy=bb.cy;
            const buckets={top:0,right:0,bottom:0,left:0};
            simp.forEach(p=>{
                const ax=Math.abs(p[0]-cx), ay=Math.abs(p[1]-cy);
                if(ay>=ax && p[1]<cy) buckets.top++;
                else if(ay>=ax && p[1]>=cy) buckets.bottom++;
                else if(p[0]>=cx) buckets.right++;
                else buckets.left++;
            });
            if(buckets.top&&buckets.right&&buckets.bottom&&buckets.left){
                const target=canonicalShapePoints('diamond',bb);
                return target?{shape:'diamond',pts:target}:null;
            }
        }
        // 원/타원: 중심 기준 반지름 편차가 작으면 곡선 도형으로 다듬는다.
        const rx=bb.w/2, ry=bb.h/2; if(rx<6||ry<6) return null;
        let err=0,cnt=0;
        body.forEach(p=>{ const q=Math.hypot((p[0]-bb.cx)/rx,(p[1]-bb.cy)/ry); if(isFinite(q)){ err+=Math.abs(q-1); cnt++; } });
        err=cnt?err/cnt:9;
        if(err<.32||simp.length>5){
            const kind=ratio>.82?'circle':'ellipse';
            const target=canonicalShapePoints(kind,bb);
            return target?{shape:kind,pts:target}:null;
        }
        return null;
    }
    function morphCurrentStroke(){
        if(!drawing||!penActive||eraserActive||shapeMode!=='free'||curShapeKind||!curPts||!curPathNode) return false;
        const guess=recognizeMorphShape(curPts);
        if(!guess||!guess.pts||guess.pts.length<2) return false;
        const from=resamplePts(curPts,guess.pts.length).map(p=>[p[0],p[1]]);
        const to=guess.pts.map(p=>[p[0],p[1]]);
        curShapeKind=guess.shape;
        curPts=to;
        const sharp=!(guess.shape==='ellipse'||guess.shape==='circle');
        const t0=performance.now?performance.now():Date.now();
        const dur=170;
        const step=now=>{
            if(!curPathNode||!curPathNode.isConnected){ drawMorphAnim=0; return; }
            const t=Math.min(1,((now||Date.now())-t0)/dur);
            const ease=1-Math.pow(1-t,3);
            const mix=to.map((p,i)=>[round1(from[i][0]+(p[0]-from[i][0])*ease),round1(from[i][1]+(p[1]-from[i][1])*ease)]);
            curPathNode.setAttribute('d',strokePath(mix,sharp));
            if(t<1) drawMorphAnim=requestAnimationFrame(step);
            else { drawMorphAnim=0; curPathNode.setAttribute('d',strokePath(to,sharp)); }
        };
        if(drawMorphAnim) cancelAnimationFrame(drawMorphAnim);
        drawMorphAnim=requestAnimationFrame(step);
        try{ toast(({line:'직선',rect:'사각형',square:'정사각형',ellipse:'타원',circle:'원',triangle:'삼각형',diamond:'마름모'}[guess.shape]||'도형')+'으로 다듬었습니다',900); }catch(e){}
        return true;
    }

    // ── 14.18.3 · 그리기 되돌리기 재설계 ──────────────────────────────────────
    //  예전 문제 ①  drawStart 의 pushHistory 가 250ms 묶음에 걸려 빠르게 연속으로
    //    그린 획들이 한 덩어리로 취급 → 되돌리기 한 번에 여러 획이 통째로 사라졌다.
    //  예전 문제 ②  지우개는 pushHistory 를 '첫 획을 지운 뒤' 에야 남겼다 → 스냅샷이
    //    이미 지워진 상태라 되돌려도 그 첫 획은 영영 돌아오지 않았다.
    //  예전 문제 ③  되돌리기(undo)가 종이를 다시 그리면서 펜 모드(.drawing)가 풀렸다.
    //  이제 ① 획·지우개 제스처마다 묶음 없이 '작업 전' 상태를 남기고, ② 아무 변화가
    //  없었던 제스처(헛클릭·헛친 지우개)의 스냅샷은 도로 치워 되돌리기가 헛돌지
    //  않게 하며, ③ 되돌린 뒤에도 펜 모드를 새 종이에 다시 붙인다.
    let _drawSnap=null;       // 이번 그리기 제스처에서 남겨 둔 '작업 전' 스냅샷
    let _eraseRemoved=false;  // 이번 지우개 제스처에서 실제로 지운 획이 있는가
    function _dropDrawSnap(){
        if(_drawSnap==null) return;
        const top=history[history.length-1];
        if(top&&top.snap===_drawSnap) history.pop();
        _drawSnap=null;
    }
    function pointInPoly(p,pts){
        let inside=false;
        for(let i=0,j=pts.length-1;i<pts.length;j=i++){
            const a=pts[i],b=pts[j];
            const cross=((a[1]>p.y)!==(b[1]>p.y)) &&
                (p.x < (b[0]-a[0])*(p.y-a[1])/((b[1]-a[1])||1e-9)+a[0]);
            if(cross) inside=!inside;
        }
        return inside;
    }
    function paintLocalPoint(p,el){
        let x=p.x-(el.dx||0), y=p.y-(el.dy||0);
        const a=-normalizedRotation(el.rotation)*Math.PI/180;
        if(a){
            const bb=strokeBBox(el),cx=bb.x+bb.w/2,cy=bb.y+bb.h/2;
            const dx=x-cx,dy=y-cy;
            x=cx+dx*Math.cos(a)-dy*Math.sin(a);
            y=cy+dx*Math.sin(a)+dy*Math.cos(a);
        }
        return {x,y};
    }
    function paintAt(p,pageIdx){
        const els=(doc.pages[pageIdx]&&doc.pages[pageIdx].els)||[];
        let best=null,bestArea=Infinity;
        for(let i=els.length-1;i>=0;i--){
            const el=els[i];
            if(!el||el.type!=='stroke'||el.tbl||!Array.isArray(el.pts)||el.pts.length<3) continue;
            const first=el.pts[0],last=el.pts[el.pts.length-1];
            const closed=!!el.closed||Math.hypot(first[0]-last[0],first[1]-last[1])<=Math.max(5,(el.size||2)*2);
            if(!closed) continue;
            const q=paintLocalPoint(p,el);
            if(!pointInPoly(q,el.pts)) continue;
            const bb=strokeBBox(el),area=Math.max(1,bb.w*bb.h);
            if(area<bestArea){ best=el; bestArea=area; }
        }
        if(!best){ toast('닫힌 선 안쪽을 눌러 주세요',1300); return false; }
        if(String(best.fillColor||'').toLowerCase()===String(drawColor).toLowerCase()) return false;
        pushHistory(true);
        best.closed=1; best.fillColor=drawColor; best.fillOpacity=0.58;
        markPageEdited(pageIdx); renderPageEls(pageIdx); saveDoc();
        toast('안쪽을 채웠습니다',900);
        return true;
    }
    function drawStart(e,pageIdx){
        if(!penActive) return;
        if(e.type==='touchstart'&&_pagePointerIntent&&_pagePointerIntent.ink){ e.preventDefault(); return; }
        e.preventDefault();
        curPageIdx=pageIdx; updatePageInfo();
        drawPageIdx=pageIdx;
        const p=surfacePos(e,pageIdx);
        if(paintMode){ paintAt(p,pageIdx); return; }
        if(eraserActive){
            drawing=true; lastErase=null; _eraseRemoved=false;
            _drawSnap=pushHistory(true);      // 지우기 '전' 상태부터 보존
            eraseSweep(p,pageIdx); return;
        }
        _drawSnap=pushHistory(true);          // 획마다 개별 되돌리기 보장
        clearMorphTimer();
        drawing=true;
        shapeStart={x:round1(p.x),y:round1(p.y)};
        curShapeKind=shapeMode!=='free'?shapeMode:null;
        curPts=[[round1(p.x),round1(p.y)]];
        const svg=paperQ(pageIdx,'.layer-stroke');
        if(!svg){ drawing=false; return; }
        curPathNode=document.createElementNS('http://www.w3.org/2000/svg','path');
        curPathNode.setAttribute('fill','none');
        curPathNode.setAttribute('stroke',drawColor);
        curPathNode.setAttribute('stroke-width',effSize());
        curPathNode.setAttribute('stroke-opacity',effOpacity());
        curPathNode.setAttribute('stroke-linecap','round');
        curPathNode.setAttribute('stroke-linejoin','round');
        svg.appendChild(curPathNode);
    }
    function drawMove(e){
        if(!drawing||!penActive) return;
        e.preventDefault();
        const p=surfacePos(e,drawPageIdx);
        if(eraserActive){ eraseSweep(p,drawPageIdx); return; }
        if(shapeMode!=='free'){
            // 도형: 시작점~현재점으로 매번 다시 계산
            curShapeKind=shapeMode;
            curPts=shapePoints(shapeStart,{x:round1(p.x),y:round1(p.y)},shapeMode,e.shiftKey);
            curPathNode.setAttribute('d',strokePath(curPts,!(shapeMode==='ellipse'||shapeMode==='circle')));
            return;
        }
        // 길게 눌러 이미 도형으로 다듬어진 뒤에는 같은 포인터의 잔여 move 가
        // 다시 자유선 점을 덧붙이지 않게 한다.
        if(curShapeKind) return;
        const last=curPts[curPts.length-1];
        if(Math.abs(p.x-last[0])<0.7&&Math.abs(p.y-last[1])<0.7) return;
        curPts.push([round1(p.x),round1(p.y)]);
        curPathNode.setAttribute('d',strokePath(curPts));
        scheduleMorphHold();
    }
    function drawEnd(){
        // rAF 대기 중에 mouseup/touchend 가 먼저 온 경우, 마지막 포인트를 놓치지 않고
        // 미리 반영한다. (특히 지우개는 몇 ms 만에 끝날 수 있어 이 flush 가 없으면
        //  빠른 스와이프가 안 지워진다)
        if(drawing && (_drawEv || _drawEvT)){
            try{ if(_drawEvT) drawMove(_drawEvT); else if(_drawEv) drawMove(_drawEv); }catch(e){}
            _drawEv=null; _drawEvT=null;
        }
        lastErase=null;
        if(!drawing) return;
        drawing=false;
        clearMorphTimer();
        if(eraserActive){ if(!_eraseRemoved) _dropDrawSnap(); saveDoc(); return; }
        if(!curPts||curPts.length<1){ if(curPathNode)curPathNode.remove(); _dropDrawSnap(); return; }
        const shape=curShapeKind||(shapeMode!=='free'?shapeMode:null);
        const el={type:'stroke',id:uid('s'),pts:curPts,color:drawColor,size:effSize(),dx:0,dy:0};
        if(markerMode) el.opacity=0.4;
        if(shape){
            el.shape=shape;
            if(shape!=='ellipse'&&shape!=='circle') el.sharp=1;
            if(shape==='rect'||shape==='square'||shape==='ellipse'||shape==='circle'||shape==='triangle'||shape==='diamond') el.closed=1;
        }
        doc.pages[drawPageIdx].els.push(el);
        markPageEdited(drawPageIdx);
        if(curPathNode) curPathNode.remove();
        const svg=paperQ(drawPageIdx,'.layer-stroke');
        if(svg) svg.appendChild(buildStrokeEl(el,drawPageIdx));
        curPts=null; curPathNode=null;
        _drawSnap=null;      // 획이 실제로 추가됐다 → '작업 전' 스냅샷을 되돌림 사다리에 그대로 둔다
        saveDoc();
    }
    function round1(v){ return Math.round(v*10)/10; }

    // 도형을 점 배열로 (스트로크 모델을 그대로 재사용 → 선택/이동/내보내기 전부 호환)
    function shapePoints(a,b,mode,shift){
        let x2=b.x, y2=b.y;
        if(shift||mode==='circle'||mode==='square'){
            if(mode==='line'||mode==='arrow'){
                const dx=x2-a.x, dy=y2-a.y;
                if(Math.abs(dx)>Math.abs(dy)) y2=a.y; else x2=a.x;
            }else{
                const d=Math.max(Math.abs(x2-a.x),Math.abs(y2-a.y));
                x2=a.x+Math.sign(x2-a.x||1)*d;
                y2=a.y+Math.sign(y2-a.y||1)*d;
            }
        }
        const r=v=>Math.round(v*10)/10;
        if(mode==='line') return [[a.x,a.y],[r(x2),r(y2)]];
        if(mode==='arrow'){
            const ang=Math.atan2(y2-a.y,x2-a.x);
            const L=Math.max(9,Math.min(22,Math.hypot(x2-a.x,y2-a.y)*0.22));
            const p1=[r(x2-L*Math.cos(ang-0.42)), r(y2-L*Math.sin(ang-0.42))];
            const p2=[r(x2-L*Math.cos(ang+0.42)), r(y2-L*Math.sin(ang+0.42))];
            return [[a.x,a.y],[r(x2),r(y2)],p1,[r(x2),r(y2)],p2];
        }
        if(mode==='rect'||mode==='square') return [[a.x,a.y],[r(x2),a.y],[r(x2),r(y2)],[a.x,r(y2)],[a.x,a.y]];
        if(mode==='triangle') return [[r((a.x+x2)/2),a.y],[r(x2),r(y2)],[a.x,r(y2)],[r((a.x+x2)/2),a.y]];
        if(mode==='diamond') return [[r((a.x+x2)/2),a.y],[r(x2),r((a.y+y2)/2)],[r((a.x+x2)/2),r(y2)],[a.x,r((a.y+y2)/2)],[r((a.x+x2)/2),a.y]];
        if(mode==='ellipse'||mode==='circle'){
            const cx=(a.x+x2)/2, cy=(a.y+y2)/2, rx=Math.abs(x2-a.x)/2, ry=Math.abs(y2-a.y)/2;
            const pts=[];
            for(let i=0;i<=36;i++){
                const t=i/36*Math.PI*2;
                pts.push([r(cx+rx*Math.cos(t)), r(cy+ry*Math.sin(t))]);
            }
            return pts;
        }
        return [[a.x,a.y],[r(x2),r(y2)]];
    }

    // 지우개: 획 단위로 지움 (반경 안에 닿은 획 제거)
    // 점(px,py) 과 선분 (ax,ay)-(bx,by) 사이의 최단거리 제곱
    function distSqToSeg(px,py,ax,ay,bx,by){
        const vx=bx-ax, vy=by-ay;
        const wx=px-ax, wy=py-ay;
        const len2=vx*vx+vy*vy;
        let t = len2>0 ? (wx*vx+wy*vy)/len2 : 0;
        t = t<0?0 : t>1?1 : t;
        const dx=px-(ax+t*vx), dy=py-(ay+t*vy);
        return dx*dx+dy*dy;
    }
    // 지우개 원이 획과 실제로 겹치는가 (선분 단위로 검사)
    function eraserHitsStroke(el,p,r){
        const ox=el.dx||0, oy=el.dy||0;
        const pts=el.pts||[];
        if(!pts.length) return false;
        const reach=r+(el.size||1)/2;
        const reach2=reach*reach;
        if(pts.length===1){
            const dx=pts[0][0]+ox-p.x, dy=pts[0][1]+oy-p.y;
            return dx*dx+dy*dy<=reach2;
        }
        // 점 사이가 아무리 멀어도(직선 = 점 2개) 중간에서 지워지도록 선분으로 판정
        for(let i=0;i<pts.length-1;i++){
            const a=pts[i], b=pts[i+1];
            if(distSqToSeg(p.x,p.y, a[0]+ox,a[1]+oy, b[0]+ox,b[1]+oy)<=reach2) return true;
        }
        // 닫힌 도형(사각형/원)은 마지막→처음 변도 검사
        if(el.shape==='rect'||el.shape==='ellipse'||el.closed){
            const a=pts[pts.length-1], b=pts[0];
            if(distSqToSeg(p.x,p.y, a[0]+ox,a[1]+oy, b[0]+ox,b[1]+oy)<=reach2) return true;
        }
        return false;
    }
    // 마우스를 빨리 움직이면 이벤트 사이가 비어 '안 지워지는' 구간이 생긴다.
    // 이전 지점과 현재 지점 사이를 촘촘히 훑어서 지운다.
    let lastErase=null;
    function eraseSweep(p,pageIdx){
        const r=eraserRadius();
        const q=lastErase;
        if(q){
            const dx=p.x-q.x, dy=p.y-q.y;
            const dist=Math.hypot(dx,dy);
            const step=Math.max(2,r*0.7);
            const nSteps=Math.min(120,Math.ceil(dist/step));
            for(let i=1;i<nSteps;i++){
                eraseAt({x:q.x+dx*i/nSteps, y:q.y+dy*i/nSteps}, pageIdx);
            }
        }
        eraseAt(p,pageIdx);
        lastErase={x:p.x,y:p.y};
    }

    function eraseAt(p,pageIdx){
        const r=eraserRadius();
        const els=doc.pages[pageIdx].els||[];
        let removed=false;
        for(let i=els.length-1;i>=0;i--){
            const el=els[i];
            if(el.type!=='stroke') continue;
            if(eraserHitsStroke(el,p,r)){
                els.splice(i,1);
                const g=paperQ(pageIdx,`.stroke-g[data-id="${el.id}"]`);
                if(g) g.remove();
                const f=paperQ(pageIdx,`.stroke-fill[data-for="${el.id}"]`); if(f) f.remove();
                removed=true;
            }
        }
        if(removed){ _eraseRemoved=true; markPageEdited(pageIdx); }   // 되돌리기 스냅샷은 drawStart 가 '지우기 전'으로 이미 남겼다
    }

    // draw-surface 이벤트 위임 — ★ pointerdown 으로 통합 (터치 300ms 지연 제거)
    sdyAddPointerCompat(document,'pointerdown',e=>{
        const s=e.target.closest('.draw-surface');
        if(s&&penActive) drawStart(e,+s.closest('.paper').dataset.pageIdx);
    },true);
    let _drawRaf=0, _drawEv=null;
    let _drawRafT=0, _drawEvT=null;
    // ★ 펜 호버 필터: Apple Pencil 이 화면 위에 있지만 닿지 않았을 때
    //   (pressure===0, buttons===0) 발생하는 pointermove 를 무시한다.
    //   이렇게 하지 않으면 이전 필기 후 펜을 들어올린 채 움직이면
    //   얇은 잔상 선이 그어진다.
    sdyAddPointerCompat(document,'pointermove',e=>{
        if(!drawing) return;
        if(e.pointerType==='pen' && e.pressure===0 && e.buttons===0) return;
        _drawEv=e;
        if(_drawRaf) return;
        _drawRaf=requestAnimationFrame(()=>{ _drawRaf=0; if(drawing&&_drawEv) drawMove(_drawEv); });
    },{passive:true});
    // ★ pointercancel 추가 — 펜이 화면 밖으로 나가면 그리기 종료
    sdyAddPointerCompat(document,'pointerup',()=>{ if(drawing) drawEnd(); });
    document.addEventListener('pointercancel',()=>{ if(drawing) drawEnd(); });
    document.addEventListener('touchstart',e=>{
        if(e.touches&&e.touches.length>1) return;      // 두 손가락은 확대/축소용
        const s=e.target.closest&&e.target.closest('.draw-surface');
        if(s&&penActive) drawStart(e,+s.closest('.paper').dataset.pageIdx);
    },{passive:false});
    document.addEventListener('touchmove',e=>{
        if(e.touches&&e.touches.length>1){ if(drawing) drawEnd(); return; }
        if(!drawing) return;
        // 스크롤 차단은 이벤트 단계에서 미리 걸고, 실제 경로 계산은 rAF 로 묶어
        // 고주사율 터치(모바일)에서도 프레임마다 부드럽게 그린다.
        try{ if(e.cancelable!==false) e.preventDefault(); }catch(err){}
        _drawEvT=e;
        if(_drawRafT) return;
        _drawRafT=requestAnimationFrame(()=>{ _drawRafT=0; if(drawing&&_drawEvT) drawMove(_drawEvT); });
    },{passive:false});
    document.addEventListener('touchend',()=>{ if(drawing) drawEnd(); });
    document.addEventListener('touchcancel',()=>{ if(drawing) drawEnd(); });

    // ===== 두 손가락 확대/축소 (핀치 줌) =====
    // 예전엔 이 기능이 아예 없고 뷰포트도 user-scalable=no 라 모바일에서
    // 확대가 전혀 안 됐다. 손가락 사이 중점을 화면에 고정한 채 배율만 바꾼다.
    (function(){
        const body=document.getElementById('editorBody');
        const stage=document.getElementById('pagesStage');
        if(!body||!stage) return;
        let piv=null;
        const dist=t=>Math.hypot(t[0].clientX-t[1].clientX, t[0].clientY-t[1].clientY);
        const mid =t=>({x:(t[0].clientX+t[1].clientX)/2, y:(t[0].clientY+t[1].clientY)/2});

        body.addEventListener('touchstart',e=>{
            if(e.touches.length!==2) return;
            const m=mid(e.touches), r=body.getBoundingClientRect();
            piv={
                d0:dist(e.touches), z0:zoomPct,
                // 확대 기준점을 '문서 좌표'로 붙잡아 둔다
                cx:(body.scrollLeft+m.x-r.left)/pageScale,
                cy:(body.scrollTop +m.y-r.top )/pageScale,
                mx:m.x-r.left, my:m.y-r.top
            };
            try{ if(typeof deselectAll==='function') deselectAll(true); }catch(err){}
        },{passive:true});

        // 손가락을 움직이는 동안에는 '값싼' CSS 확대만 한다.
        // layoutPages() 는 쪽마다 DOM 을 만지므로 프레임마다 부르면
        // 손가락을 따라오지 못하고 굼떠 보인다 → 뗄 때 딱 한 번만 부른다.
        let raf=0, want=0;
        const apply=()=>{
            raf=0;
            const k=want/piv.z0;                       // 시작 배율 대비 비율
            stage.style.transformOrigin='0 0';
            stage.style.transform=`scale(${k})`;
            // 붙잡아 둔 지점이 손가락 중점에 계속 붙어 있도록 스크롤 보정
            const sc=pageScale*k;
            body.scrollLeft=piv.cx*sc-piv.mx;
            body.scrollTop =piv.cy*sc-piv.my;
        };
        body.addEventListener('touchmove',e=>{
            if(!piv||e.touches.length!==2) return;
            e.preventDefault();                       // 브라우저 기본 동작 차단
            const d=dist(e.touches);
            if(!d||!piv.d0) return;
            want=Math.max(25,Math.min(400, piv.z0*(d/piv.d0)));
            const m=mid(e.touches), r=body.getBoundingClientRect();
            piv.mx=m.x-r.left; piv.my=m.y-r.top;
            if(!raf) raf=requestAnimationFrame(apply);
        },{passive:false});

        const end=e=>{
            if(!piv) return;
            if(!e.touches||e.touches.length<2){
                if(raf){ cancelAnimationFrame(raf); raf=0; }
                const fin=want||piv.z0, mx=piv.mx, my=piv.my, cx=piv.cx, cy=piv.cy;
                piv=null; want=0;
                // 임시 CSS 확대를 걷어내고 진짜 배율로 한 번에 다시 그린다
                stage.style.transform='';
                zoomPct=fin;
                const was=body.style.scrollBehavior;
                body.style.scrollBehavior='auto';
                layoutPages();
                body.scrollLeft=cx*pageScale-mx;
                body.scrollTop =cy*pageScale-my;
                body.style.scrollBehavior=was;
                try{ sizeTextGhost(); }catch(err){}
                try{ onEditorScroll(); }catch(err){}
            }
        };
        body.addEventListener('touchend',end);
        body.addEventListener('touchcancel',end);

        // iOS Safari 는 페이지 전체를 확대하려 든다 → 에디터 안에서는 막는다
        ['gesturestart','gesturechange','gestureend'].forEach(g=>
            body.addEventListener(g,ev=>ev.preventDefault()));
    })();

    // 두 번 톡톡 → 100% ↔ 화면 폭 맞춤 (모바일에서 빠르게 오가기)
    (function(){
        const body=document.getElementById('editorBody');
        if(!body) return;
        let lastT=0,lastX=0,lastY=0;
        body.addEventListener('touchend',e=>{
            if(e.touches.length||!e.changedTouches.length) return;
            if(penActive||drawing) return;
            const t=e.changedTouches[0], now=Date.now();
            if(now-lastT<300 && Math.hypot(t.clientX-lastX,t.clientY-lastY)<28){
                if(e.target.closest('.tb,.paper-img,.stroke-g')) return;  // 요소 조작은 방해 않기
                lastT=0;
                if(Math.round(zoomPct)===100) zoomFit(); else resetZoom();
            }
            lastT=now; lastX=t.clientX; lastY=t.clientY;
        },{passive:true});
    })();


/* APP-PART:10-input-pen.js:END */
