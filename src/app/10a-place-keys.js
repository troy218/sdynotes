/* === src/app/10a-place-keys.js ===
   배치 모드 · 뒤로가기 · 단축키
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:10a-place-keys.js:BEGIN */
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
        const r=paper.getBoundingClientRect(),k=uiCssZoom();
        // Keep the preview tied to the exact paper hit by the pointer. This is
        // important while virtualized page shells are being mounted/unmounted.
        const sc={x:r.width/s.w/k,y:r.height/s.h/k};
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
        // 14.39.9 · 글상자 높이를 글자 크기에 비례하게 조정한다.
        //   예전에는 TB_H=48px 고정 최소값이라 작은 글씨(12px 등)에서 상자가
        //   텍스트보다 훨씬 커서 커서가 상자 위쪽에 치우쳤다.
        //   이제 상자 높이 = 글줄 높이(line-height 1.5) + 위아래 패딩(8px×2) + 여유(4px)
        //   로 글자 크기에 맞춰 유동적으로 변한다.
        const h=Math.max(36,Math.round(fs*1.5+20));
        // Keep the normal 16px insertion box at the long-standing 200×48
        // default. Other font sizes still use the proportional sizing above.
        // This keeps placement predictable when the tool is first activated
        // while avoiding the oversized fixed box for genuinely small text.
        return {
            w:fs===16?TB_W:Math.max(Math.round(TB_W*0.8),Math.round(Math.min(420,fs*8))),
            h:fs===16?TB_H:h
        };
    }

    // ============ 뒤로가기(브라우저 히스토리) 처리 ============
    // 에디터·폴더·모달을 열 때 히스토리 항목을 쌓아, 뒤로가기를 누르면
    // 사이트를 빠져나가는 대신 열려 있던 화면/모달이 닫히게 한다.
    //
    // 14.39.5 · **진짜 뒤로가기를 되찾았다.** (사용자 보고: "뒤로가기 누르면
    //   화면이 한 번 새로고침되면서 깜빡인다")
    //   원인은 이름 가림이었다. 이 묶음(번들)은 모든 파트가 한 어휘 스코프를
    //   공유하는데, 01-core.js 의 `let history=[]`(되돌리기 스택)가
    //   `window.history` 를 가린다. 그래서
    //     · openNav 의 history.pushState() → "pushState is not a function"
    //       예외 → catch 에 삼켜짐 → **히스토리 항목이 한 번도 쌓이지 않았다**
    //     · navBack 의 history.back() → 같은 예외 → catch 의 '직접 닫기'로 동작
    //     · popstate 처리부는 불릴 일이 없어 죽은 코드였다
    //   겉보기엔 툴바 ← 버튼이 잘 닫는 것 같았지만, **브라우저·폰의 뒤로가기와
    //   옆으로 밀어 돌아가기는 앱이 전혀 잡지 못했다.** 그래서 뒤로가기를 누르면
    //   앱이 화면을 닫는 대신 사이트를 빠져나갔고, 브라우저가 문서를 다시
    //   실으면서 화면이 통째로 새로고침되며 깜빡였다. 이제 window.history 를
    //   명시적으로 부른다.
    //
    //   쌓는 방식은 '층마다 항목 하나'가 아니라 **보초 항목 하나**다.
    //   모달을 X 로 닫으면(navDrop) 우리 장부에서는 빠져도 히스토리 항목은
    //   지울 방법이 없어 남는다. 층마다 쌓으면 그 남은 항목 수만큼 '아무 일도
    //   하지 않는 뒤로가기'가 쌓여, 앱을 나가려면 뒤로가기를 여러 번 눌러야
    //   했다. 보초는 하나뿐이라 남는 항목도 최대 하나고, 뒤로가기는 언제나
    //   '한 번 = 가장 위에 열린 것 하나 닫기'로 동작한다.
    const _nav=[];
    const _NAV_GUARD='sdyNavGuard';   // 보초 항목에 찍는 도장
    let _navGuard=false;              // 지금 히스토리 항목이 우리가 얹은 보초인가
    let _navNoHist=false;             // pushState 를 못 쓰는 환경(샌드박스 iframe·file://)
    let _navCollapsing=false;         // 보초를 걷는 history.back() 의 popstate 는 무시한다
    let _navCollapseT=null;           // …그 popstate 가 끝내 안 오는 환경 대비 안전망
    function _navClose(it){ if(it&&it.close){ try{ it.close(); }catch(err){} } }
    // 보초를 얹거나(첫 층) 이미 얹힌 보초의 층 수만 고친다(다음 층부터).
    // replaceState 라서 층이 늘어도 히스토리 항목은 하나다.
    function _navStamp(){
        if(_navNoHist) return;
        try{
            if(_navGuard) window.history.replaceState({[_NAV_GUARD]:1,n:_nav.length},'');
            else { window.history.pushState({[_NAV_GUARD]:1,n:_nav.length},''); _navGuard=true; }
        }catch(e){ _navNoHist=true; _navGuard=false; }
    }
    function openNav(close){ _nav.push({close}); _navStamp(); }
    function navDrop(close){
        const i=_nav.findIndex(x=>x.close===close);
        if(i>=0) _nav.splice(i,1);
        if(_nav.length){ _navStamp(); return; }
        // 층이 하나도 남지 않았다 → 보초도 함께 걷는다. 안 그러면 다음
        // 뒤로가기 한 번이 '아무 일도 안 하는' 누름이 된다.
        if(_navGuard&&!_navNoHist){
            _navCollapsing=true;
            try{ window.history.back(); }catch(e){ _navCollapsing=false; }
            // popstate 를 주지 않는 이상한 브라우저에서도 다음 '진짜' 뒤로가기를
            // 삼키지 않게, 잠시 뒤 스스로 푼다.
            clearTimeout(_navCollapseT);
            _navCollapseT=setTimeout(()=>{ _navCollapseT=null; _navCollapsing=false; },1500);
        }
    }
    function navBack(){
        if(!_nav.length) return;
        // 히스토리를 못 쓰는 환경에서 history.back() 을 부르면 앱 밖으로 나가
        // 페이지가 다시 실린다(= 그 자체가 화면 깜빡임). 그럴 땐 곧바로 닫는다.
        if(_navNoHist||!_navGuard){ _navClose(_nav.pop()); _navStamp(); return; }
        try{ window.history.back(); }
        catch(e){ _navClose(_nav.pop()); _navStamp(); }
    }
    window.addEventListener('popstate',(e)=>{
        // 보초를 걷으려고 우리가 부른 back() 이다 — 화면은 이미 닫혔다.
        if(_navCollapsing){
            _navCollapsing=false; _navGuard=false;
            clearTimeout(_navCollapseT); _navCollapseT=null;
            // 걷는 사이에 새 층이 열렸으면 보초를 다시 얹어 장부를 맞춘다.
            if(_nav.length) _navStamp();
            return;
        }
        const st=e&&e.state;
        if(st&&st[_NAV_GUARD]){
            // 앞으로가기 등으로 보초 항목에 다시 도착 — 닫힌 층을 되살릴 수는
            // 없으므로, 열려 있는 것 중 보초가 기억하는 층 수를 넘는 것만 정리한다.
            _navGuard=true;
            const n=(typeof st.n==='number')?st.n:_nav.length;
            while(_nav.length>n) _navClose(_nav.pop());
            return;
        }
        // 보초 아래(앱이 처음 실린 항목)로 내려왔다.
        _navGuard=false;
        if(!_nav.length) return;      // 열린 것이 없다 → 다음 뒤로가기가 앱을 나간다
        // 뒤로가기 한 번 = 가장 위 열린 것 하나 닫기.
        _navClose(_nav.pop());
        // 아직 층이 남았다면 보초를 다시 얹는다 — 다음 뒤로가기도 앱을
        // 빠져나가는 대신 그다음 층을 닫아야 한다.
        if(_nav.length) _navStamp();
    });

    // 열려 있는 것 중 가장 위를 닫는다 (Esc / 뒤로가기 공용). 닫았으면 true.
    function closeTopOverlay(){
        if(ctxMenuOpen()){ closeCtxMenu(); return true; }
        if(presentOn){ endPresent(); return true; }
        if(wfOn){ wfOff(); return true; }
        if(document.getElementById('pinPop').classList.contains('show')){ closePin(); return true; }
        if(document.getElementById('latexModal').style.display==='flex'){ closeLatexModal(); return true; }
        if(document.getElementById('tableSizeModal').style.display==='flex'){ closeTableSizeModal(); return true; }
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

    // 글상자(일반 텍스트) 편집 중 Tab — Word 식 들여쓰기.
    //   들여쓰기 단위는 .sdy-tab span(고정 폭) — 공백 문자가 아니라
    //   '한 번에 지워지는' 토큰이라 Backspace 한 번에 단위째 사라진다.
    //   PDF 줄 흐름(tight) 상자는 예외 — 거기선 기존처럼 편집 확정+상자 이동을 쓴다.
    function sdyTabUnit(c){
        const tab=document.createElement('span');
        tab.className='sdy-tab';
        tab.textContent='\u00A0';        // 폭은 CSS(.sdy-tab)가 고정
        return tab;
    }
    function sdyTabInputNotify(c,type){
        try{
            if(typeof window!=='undefined'&&window.InputEvent)
                c.dispatchEvent(new window.InputEvent('input',{bubbles:true,inputType:type,cancelable:false}));
            else c.dispatchEvent(new Event('input',{bubbles:true}));
        }catch(e){}
    }
    function sdyEditTabAt(c,shift){
        try{
            const sel=window.getSelection();
            if(!sel||!sel.rangeCount) return false;
            const r=sel.getRangeAt(0);
            if(!c.contains(r.startContainer)) return false;
            if(shift){
                // 커서 바로 앞 들여쓰기 단위 하나 제거 (Shift+Tab = 내어쓰기).
                // 입력 대기 마커(빈 .sdy-type)·빈 텍스트 껍데기가 사이에 껴 있어도
                // 건너뛰고 가장 가까운 .sdy-tab 을 찾는다 — 실글자/단락 요소 앞에
                // 들여쓰기가 없으면 아무 일도 하지 않는다.
                const sc=r.startContainer, so=r.startOffset;
                const blank=v=>String(v||'').replace(/[\u200b\u200c\u200d\ufeff]/g,'')==='';
                const findBack=n=>{
                    let hops=0;
                    while(n&&hops<6){
                        if(n.nodeType===1&&n.classList){
                            if(n.classList.contains('sdy-tab')) return n;
                            const empty=n.classList.contains('sdy-type')&&blank(n.textContent);
                            if(!empty) return null;   // 실내용 요소 앞이면 멈춘다
                        }else if(n.nodeType===3){
                            if(!blank(n.nodeValue)) return null;
                        }else return null;
                        n=n.previousSibling; hops++;
                    }
                    return null;
                };
                let tab=null, wasTextStart=false;
                if(sc.nodeType===3){
                    if(so===0){ tab=findBack(sc.previousSibling); wasTextStart=true; }
                }else if(sc.nodeType===1){
                    if(so>0) tab=findBack(sc.childNodes[so-1]);
                    else tab=findBack(sc.previousSibling);
                }
                if(!tab) return false;
                const par=tab.parentNode;
                par.removeChild(tab);
                const nr=document.createRange();
                if(wasTextStart&&sc.isConnected){ nr.setStart(sc,0); nr.collapse(true); }
                else{
                    const ref=tab.nextSibling;
                    if(ref) nr.setStart(ref,0); else nr.setStart(par,par.childNodes.length);
                    nr.collapse(true);
                }
                sel.removeAllRanges(); sel.addRange(nr);
                sdyTabInputNotify(c,'deleteContentBackward');
                return true;
            }
            const tab=sdyTabUnit(c);
            if(!r.collapsed) r.deleteContents();
            r.insertNode(tab);
            const nr=document.createRange();
            nr.setStartAfter(tab); nr.collapse(true);
            sel.removeAllRanges(); sel.addRange(nr);
            sdyTabInputNotify(c,'insertText');
            return true;
        }catch(e){ return false; }
    }
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
            const _tg=e.target;
            // 포커스가 .tb-content 일 때가 기본이지만, 이벤트 원천(target)이
            // .tb-content 인 경우(테스트·포커스가 늦게 따라붙는 환경)도 편집으로 본다.
            const _src=(ae&&ae.classList&&ae.classList.contains('tb-content'))
                ?ae:((_tg&&_tg.classList&&_tg.classList.contains('tb-content'))?_tg:null);
            const inContent=!!_src;
            // 18.9 · Escape 는 '글상자 편집 중'이면 언제나 편집만 끝낸다.
            //   예전엔 포커스가 정확히 .tb-content 에 있을 때만 그렇게 했고,
            //   툴바 글자 크기칸을 만졌다가 Escape 를 누르면 편집 중인데도
            //   아래의 closeTopOverlay() 가 걸려 **노트 자체가 닫혀** 버렸다.
            const w=inContent?_src.closest('.tb'):document.querySelector('.tb.edit');
            // 한글 IME 조합 중에는 Enter(확정)를 가로채면 입력이 깨진다 → 그대로 둠
            const composing=e.isComposing||e.keyCode===229;
            if(w){
                if(e.key==='Tab' && inContent && !composing){
                    e.preventDefault();
                    // Tab = 들여쓰기 (일반 텍스트 상자). PDF 줄 흐름(tight)·표·LaTeX
                    //   상자는 기존처럼 편집 확정 후 다음/이전 상자로 이동한다.
                    const tightBox=w.classList&&(w.classList.contains('tight')
                        ||w.classList.contains('pdf-text')||w._sdyTightLine);
                    if(!tightBox){
                        const c=w.querySelector('.tb-content');
                        if(!(c&&sdyEditTabAt(c,e.shiftKey))) return;   // 못 지운 Shift+Tab 은 그대로
                        return;
                    }
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

/* APP-PART:10a-place-keys.js:END */
