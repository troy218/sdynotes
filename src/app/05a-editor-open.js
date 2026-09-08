/* === src/app/05a-editor-open.js ===
   에디터 열기/닫기 · saveDoc
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:05a-editor-open.js:BEGIN */
    // ============ Editor: 열기/닫기 ============
    async function openNB(nb){
        if(window._closeEdT){ clearTimeout(window._closeEdT); window._closeEdT=null; }
        try{ _trackRecent(nb.id); }catch(_){}
        // 14.14 · 이미 같은 노트를 연 상태면 저장·동기화 왕복을 건너뛴다.
        //   (연속 클릭·스택 재진입 시 빈 저장 레이스가 돌지 않게)
        if(curNB&&doc&&curNB.id===nb.id&&
           document.getElementById('editorView').classList.contains('open')){
            try{ ensureVisiblePagesRendered(); }catch(e){}
            return;
        }
        // 14.15 · 열기 요청 순번을 찍는다.
        //   빠르게 다른 노트를 연 동안 이전 openNB 가 뒤늦게 이어져서
        //   - 이전 노트의 curMemo 본문을 새 노트에 applyServerState 로 덮고
        //   - 이전 노트의 doc 을 새 노트로 놓고
        //   - 이전 노트의 실시간 동기화를 새 노트에 걸어 버리는
        //   것을 막는다. 모든 await 뒤에서 openSeq 를 검증한다.
        const openSeq=++_sdyOpenSeq;
        const openedId=nb.id;
        if(curNB && doc){
            try{
                commitEditingText();
                flushSaveDoc();
                try{ clearTimeout(opsTimer); await pushOps(); }catch(e){}
                try{ await flushSync(); }catch(e){}
                stopLive();
                stopLiveDocSync();
            }catch(e){}
            // 이 구간의 curNB는 아직 '이전에 열었던 노트'가 정상이다. openedId와
            // 비교하면 다른 카드를 누를 때마다 여기서 반환되어 편집기가 안 열린다.
            // 겹친 새 openNB 요청이 있는지만 순번으로 판별한다.
            if(openSeq!==_sdyOpenSeq) return;
        }
        // 이전 노트의 저장은 위에서 확정했으므로 남은 디바운스 타이머를 내린다.
        // 그래야 교체 직후 그 타이머가 새 노트로 엉뚱하게 흐르지 않는다.
        clearTimeout(_saveTimer); _saveTimer=null; _saveNoteId=null;
        curNB=nb; history=[]; redoStack=[]; curPageIdx=0; _histT=0;
        // 14.15 · 이전 노트의 선택/드래그 상태를 새 노트에 옮기지 않는다.
        try{ clearMulti(); }catch(e){}
        selected=null; drag=null; resize=null; textSel=null;
        // 잠긴 노트(복호화)나 대용량 문서(서버 로드)는 시간이 걸리므로 로딩 표시
        const _cfg=getCfg(nb.id);
        const _needLoad=!!(_cfg.lock&&_cfg.lock.enc) || !!_cfg.serverDoc;
        if(_needLoad) showEdLoading(isLocked(nb.id)?'잠금 해제 중…':'문서 불러오는 중…');
        // 14.30.0 · 서버에서 여는 게 오래 걸리면 조용히 무한 대기하지 않게
        //   12초 뒤 안내 문구로 바꿔 '여는 중' 상태임을 알린다. (문서가 커서
        //   오래 걸리는 것인지, 멈춘 것인지 사용자가 알 수 있게)
        if(_needLoad&&_cfg.serverDoc&&!(_cfg.lock&&_cfg.lock.enc)){
            try{ clearTimeout(window._openLoadHintT); }catch(e){}
            window._openLoadHintT=setTimeout(()=>{
                try{ window._openLoadHintT=null; }catch(e){}
                try{
                    const _el=document.getElementById('edLoading');
                    if(_el&&_el.classList.contains('show')
                       &&document.getElementById('editorView')
                       &&!document.getElementById('editorView').classList.contains('open')
                       &&openSeq===_sdyOpenSeq){
                        showEdLoading('문서 여는 중… 서버가 준비하고 있어요 · 조금만 더 기다려 주세요');
                    }
                }catch(e){}
            },12000);
        }
        try{ closeFind(); clearActiveTbl(); cancelTablePlacement(); closePanel(); closePin();
             if(wfOn) wfOff(); wfStats=[]; wfMap=null; wfCand=[]; wfSel=new Map(); wfExtra=new Set();
             if(pinMode) togglePinMode(); }catch(e){}
        const isLocal=String(nb.id).startsWith('local_');
        let memoFor=null;
        if(!isLocal&&SB){
            syncStart();
            try{
                const{data:ms}=await SB.from('memos').select('*').eq('notebook_id',nb.id).order('created_at').limit(1);
                if(openSeq!==_sdyOpenSeq||!curNB||curNB.id!==openedId) return;
                if(ms&&ms.length) memoFor=ms[0];
                else{
                    const{data:nm}=await SB.from('memos').insert([{notebook_id:nb.id,content:'',font_size:S.defFS}]).select().single();
                    if(openSeq!==_sdyOpenSeq||!curNB||curNB.id!==openedId) return;
                    memoFor=nm;
                }
                if(memoFor&&memoFor.content) applyServerState(nb.id,memoFor.content);
            }catch(e){ memoFor={id:'local_memo_'+Date.now(),notebook_id:nb.id}; }
            finally{ syncEnd(); }
            if(openSeq!==_sdyOpenSeq||!curNB||curNB.id!==openedId) return;
            curMemo=memoFor;
        }else{
            curMemo={id:'local_memo_'+nb.id,notebook_id:nb.id};
        }
        if(isLocked(nb.id)){
            let okUnlock=false;
            // 9.1 · 잠금 해제가 예외로 끝나도 덮개는 반드시 걷는다.
            try{ okUnlock=await tryUnlock(nb.id); }
            catch(e){ console.warn('unlock failed',e); okUnlock=false; }
            if(openSeq!==_sdyOpenSeq||!curNB||curNB.id!==openedId) return;
            if(!okUnlock){ hideEdLoading(); curNB=null; curMemo=null; _docId=null; return; }
        }
        let loadedDoc=null;
        try{
            loadedDoc=await loadDocAsync(nb.id);
        }catch(e){
            // 본문을 못 불러와도 '노트 여는 중…'에서 멈추지 않게 한다.
            if(openSeq!==_sdyOpenSeq||!curNB||curNB.id!==openedId) return;
            hideEdLoading(); curNB=null; curMemo=null; _docId=null;
            try{ toast('노트를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'); }catch(_){}
            return;
        }
        // 14.15 · 로드가 끝나기 전에 다른 노트를 열었으면 이 doc 은 버린다.
        if(openSeq!==_sdyOpenSeq||!curNB||curNB.id!==openedId) return;
        doc=loadedDoc; _docId=nb.id;
        // 14.38 · 이 문서의 '마지막 위치 복구'(아래 460ms 타이머)가 끝나기 전에는
        //   열리는 길목의 updatePageInfo(renderPages 안에서도 불린다)가
        //   curPageIdx(아직 0)로 lastpg 를 덮어쓰지 못하게 막는다. 복구 전에 0이
        //   먼저 기록되면 복구가 항상 1쪽으로 풀리고, loadDocAsync 만 마지막
        //   슬라이스를 먼저 받아 '화면은 1쪽 · 데이터는 그 슬라이스'로 꼬인다.
        //   (renderPages 등 다른 경로에서는 이 플래그를 건드리지 않는다 —
        //    되돌리기·쪽 추가가 위치 저장을 막으면 안 되므로.)
        _posHydrated=false;
        setTimeout(()=>{ try{ restoreLastPos(); ensureVisiblePagesRendered(); }finally{ _posHydrated=true; } },460);
        setTimeout(async()=>{
            try{ await initSync(); }catch(e){}
            // 14.29.4 · 나머지 슬라이스 미리 받기는 '첫 화면이 다 그려진 뒤'에
            //   시작한다. 예전엔 여는 즉시 4갈래로 전 쪽을 내려받아, 느린 기기에서
            //   그 파싱/네트워크가 첫 페인트와 경쟁하며 열기가 오래 걸렸다.
            //   (받는 내용·최종 결과는 같고, 시작 시점만 뒤로 민다)
            const kick=()=>{ try{ startSlicePrefill(); }catch(e){} };
            if(window.requestIdleCallback) requestIdleCallback(kick,{timeout:2500});
            else setTimeout(kick,900);
        },60);  // 렌더 먼저, 번역 동기화 후 나머지 슬라이스
        document.getElementById('edTitle').value=nb.title||'새 노트';
        document.getElementById('sizePresetSelect').value=doc.sizePreset;
        document.querySelectorAll('.ptool').forEach(b=>b.classList.toggle('active',b.dataset.p===doc.paper));
        curFontSize=S.defFS;
        document.getElementById('fsInput').value=curFontSize;
        // 가져온 문서의 표는 격자선이 아직 없다 → 한 번 만들어 준다.
        // 14.29.4 · 열 때 전 쪽을 훑지 않는다. 쪽마다 표×요소 전수 검사라
        //   500쪽 문서에서는 이것만으로 몇 초가 걸렸다(가상화의 효과를 통째로
        //   깎아먹던 지점). 이제 그 쪽을 실제로 그릴 때 한 번만 채운다
        //   (ensureTableGrid) — 화면·저장 결과는 완전히 같다.
        _tblGridDone=new Set();
        renderPages();
        schedulePresanitize();   // 18.13 · 쪽 중복 정리(O(n²))를 유휴 시간에 미리 돌려 스크롤 첫 프레임을 가볍게
        hideEdLoading();
        updateLockUI();
        document.getElementById('editorView').classList.add('open');
        document.documentElement.classList.add('in-editor');
        document.body.classList.add('in-editor');
        setTimeout(()=>{ try{ startLive(); }catch(e){} },600);   // 실시간 커서 공유
        try{ startLiveDocSync(); }catch(e){}                     // 기기 간 실시간 반영
        // 14.14 · 슬라이드인 직후·레이아웃 확정 뒤 다시 한 번 강제 페인트
        //   (IO 가 첫 프레임을 놓쳐도 빈 종이로 남지 않게)
        const _paint=()=>{ try{ layoutPages(); ensureVisiblePagesRendered(); }catch(e){} };
        requestAnimationFrame(_paint);
        setTimeout(_paint,420);
        scheduleHiBg();                                                // 보는 쪽 배경을 점점 고화질로
        openNav(closeEditor);                                          // 뒤로가기 → 에디터 닫기
    }

    function closeEditor(){
        if(!document.getElementById('editorView').classList.contains('open')) return;   // 이미 닫힘
        // 노트 전환 fetch가 진행 중이면 그 응답이 닫힌 편집기를 다시 열지 못하게 한다.
        _sdyOpenSeq++;
        hideEdLoading();
        try{ closeFind(); clearActiveTbl(); cancelTablePlacement(); cancelPlaceMode(); closePanel(); closePin();
             if(wfOn) wfOff();
             if(pinMode) togglePinMode();
             if(presentOn) endPresent();
             if(focusMode) toggleFocus();
             const tp=document.getElementById('tintPop'); if(tp) tp.classList.remove('show');
             const fp=document.getElementById('favPop'); if(fp) fp.classList.remove('show'); }catch(e){}
        // 세션 키(sessionKeys)와 복호 캐시(decCache)는 유지 →
        // 새로고침 전까지는 다시 비밀번호를 묻지 않는다
        if(penActive) finishDrawing();
        deselectAll();
        commitEditingText();                    // 편집 중인 글자를 먼저 확정
        flushSaveDoc();                         // 기기(localStorage)에 즉시 저장
        saveLastPos();
        // 밀린 요소 연산(요소 단위 동기화)도 지금 바로 보낸다 — 나가기 전 저장
        try{ clearTimeout(opsTimer); pushOps(); }catch(e){}
        let _impFlush=null;
        try{ _impFlush=flushImportedSave(); }catch(e){}
        flushSync();                            // 서버(memo) 동기화
        stopLive();
        stopLiveDocSync();
        document.getElementById('editorView').classList.remove('open');
        document.documentElement.classList.remove('in-editor');
        document.body.classList.remove('in-editor');
        resetPageWork();
        document.getElementById('pagesStage').innerHTML='';
        if(window._closeEdT) clearTimeout(window._closeEdT);
        window._closeEdT=setTimeout(async()=>{
            try{ if(_impFlush) await _impFlush; }catch(e){}
            // 문서를 보고 홈으로 돌아오면 자동 크기의 두 줄부터 보여 준다.
            // 클래식 새 노트 버튼은 그 바로 위에 있어 휠 한 칸으로 나타난다.
            _homeEnterScroll=true;
            curNB=null;curMemo=null;doc=null;_docId=null;loadNBs();
        },400);
    }

    let saveStateTimer=null;
    function setSaveState(txt,hold){
        if(!document) return;   // 창이 닫힌 뒤 남은 비동기 잔여물 — 무시
        const el=document.getElementById('saveState');
        if(!el) return;
        el.textContent=txt;
        clearTimeout(saveStateTimer);
        if(hold) saveStateTimer=setTimeout(()=>{ el.textContent=''; },hold);
    }
    // ── 성능: saveDoc 은 디바운스(400ms)로 묶어 저장·동기화 폭주를 막는다 ──
    // 큰 문서에서 요소를 옮기거나 글을 쓸 때마다 매번 localStorage 전체 직렬화 +
    // 전체 딥카피가 돌아 버벅였다. 이제 한 번으로 합치고, 나가기 직전엔 즉시 저장.
    let _saveTimer=null;
    // 22.1 · 오토세이브(flushSaveDoc) 안의 commitEditingText 는 '마지막 편집분을
    //   디스크에 담기 위한' 커밋이다. 여기서 다시 saveDoc() 을 걸면
    //   save → commit → save → … 400ms 에코 루프가 돌아, 아무것도 치지 않아도
    //   직렬화·sanitize·동기화가 계속 돈다(똥컴 편집 렉). 플래그로 한 바퀴만 막는다.
    let _commitFromSave=false;
    function saveDoc(){
        if(!curNB||!doc) return;
        try{ bumpAiText(); }catch(e){}   // 20.1 · 문서가 바뀌었다 → 해돌이 글 캐시 무효화
        // 14.18.4 · 자동 저장은 너무 자주 일어나므로 '저장 중/저장됨'을 매번 띄우지 않는다.
        //   대신 문제 상황(불러오기 실패·오프라인·동기화 대기)만 조용히 알려 준다.
        // 14.15 · 현재 doc 가 열려 있는 노트의 것과 다르면 (노트 교체 로딩 중)
        //   저장을 예약하지 않는다. 예약하면 400ms 뒤 이전 본문을 새 노트에
        //   persistDoc 으로 덮어쓸 수 있다.
        if(_docId && _docId!==curNB.id) return;
        if(doc.__loadFailed){
            setSaveState('본문 안 불림 · 저장 건너뜀',2500);
            _armBlockedImportRetry();          // 순간 장애면 자동 복구
            return;
        }
        _saveNoteId=curNB.id;                 // 이 예약이 어느 노트 것인지 고정
        clearTimeout(_saveTimer);
        _saveTimer=setTimeout(flushSaveDoc,400);
    }
    function flushSaveDoc(){
        clearTimeout(_saveTimer); _saveTimer=null;
        if(!curNB||!doc) return;
        // 14.15 · 예약이 노트 교체를 넘어갔거나 doc 이 현재 노트 것이 아니면 무시
        if(_saveNoteId && _saveNoteId!==curNB.id){ _saveNoteId=null; return; }
        if(_docId && _docId!==curNB.id){ _saveNoteId=null; return; }
        _saveNoteId=null;
        if(doc.__loadFailed){ _armBlockedImportRetry(); return; }
        try{ _commitFromSave=true; commitEditingText(); }catch(e){} finally{ _commitFromSave=false; }
        // 14.14 · 본문이 비어 보이는데 디스크/서버에는 내용이 있는 상태면
        //   빈 문서로 덮어쓰지 않는다. (IO 미렌더·pages op 미스매치로 doc.pages 가
        //   비워진 직후 노트 전환/닫기가 일어나면 영구 유실되던 경로)
        try{
            const elN=(doc.pages||[]).reduce((n,pg)=>n+((pg&&pg.els)||[]).length,0);
            const tblN=(doc.pages||[]).reduce((n,pg)=>n+((pg&&pg.tables)||[]).length,0);
            if(elN===0&&tblN===0&&!doc.__ref){
                const cfg=getCfg(curNB.id);
                const locN=(cfg.pages||[]).reduce((n,pg)=>n+((pg&&pg.els)||[]).length,0);
                if(locN>0){
                    setSaveState('본문 복구 중 · 빈 저장 건너뜀',2500);
                    return;
                }
            }
        }catch(e){}
        persistDoc(curNB.id,doc);
        try{ queueImportedSave(); }catch(e){}
        if(sidePanel){ clearTimeout(window._spT); window._spT=setTimeout(()=>{try{renderPanel()}catch(e){}},400); }
        if(adminMode) markAdminEdited(curNB.id);      // 관리자가 고친 노트 표시
        else          clearAdminEdited(curNB.id);     // 일반 사용자가 고치면 인증 해제
        queueSync(curNB.id);
    }

    // 관리자 수정 이력 (서버 설정과 함께 동기화)
    function getAdminEdits(){
        try{ return JSON.parse(localStorage.getItem('sdy_admin_edits')||'{}'); }catch(e){ return {}; }
    }
    function isAdminEdited(id){ return !!getAdminEdits()[id]; }
    // 관리자가 아닌 상태로 수정하면 인증 표시를 없앤다
    function clearAdminEdited(id){
        const m=getAdminEdits();
        if(!m[id]) return;
        delete m[id];
        localStorage.setItem('sdy_admin_edits',JSON.stringify(m));
        tombstone('adminEdits',id);     // 서버 동기화로 되살아나지 않게
        pushSettings();
        const card=document.querySelector(`.note-card[data-nb-id="${id}"] .admin-verified`);
        if(card) card.remove();
    }
    function markAdminEdited(id){
        untombstone('adminEdits',id);   // 관리자가 다시 수정 → 인증 복구
        const m=getAdminEdits();
        const now=new Date().toISOString();
        if(m[id]&&(Date.now()-new Date(m[id]).getTime())<60000) return;   // 잦은 저장은 한 번만
        m[id]=now;
        localStorage.setItem('sdy_admin_edits',JSON.stringify(m));
        pushSettings();
        const card=document.querySelector(`.note-card[data-nb-id="${id}"]`);
        if(card&&!card.querySelector('.admin-verified')){
            const pv=card.querySelector('.note-preview');
            if(pv){
                const d=document.createElement('div');
                d.className='admin-verified';
                d.title='관리자가 검수·수정한 노트';
                d.innerHTML='<i class="ri-verified-badge-fill"></i>';
                pv.appendChild(d);
            }
        }
    }

/* APP-PART:05a-editor-open.js:END */
