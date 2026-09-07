/* === src/app/05-editor-shell.js ===
   에디터 열기/닫기 · 저장 · 동기화 · 아웃박스
   (sdynotes.js 메가 분리 · 이 파일들은 scripts/bundle-frontend.mjs 가 순서대로 이어 붙인다.
    let/const 스코프를 공유하려면 반드시 concat 되어야 한다 — 단독 <script> 로드 금지) */
/* APP-PART:05-editor-shell.js:BEGIN */
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
             if(wfOn) wfOff(); wfStats=[]; wfMap=null;
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

    // ============ 서버 동기화 ============
    let syncTimer=null, pendingNB=null;
    // 14.15 · 동기화 직전 이미지 요소 정리: blob URL 은 다른 기기·새로고침 뒤에
    //   깨지므로 url 에서 제거하고, 로컬 전용 임시 필드(localURL·pending·failed)는
    //   서버로 보내지 않는다. (data: URL 은 스티커·PDF 배경 등 정상 데이터이므로 유지)
    // 14.17 · 붙여넣기/파일로 넣은 이미지가 아직 서버에 못 올라갔으면 data: 로컬
    //   소스를 '로컬 전용'이 아니라 메모 스냅샷에도 싣는다. 그래서 어느 기기에서
    //   열어도 사진이 안 보이는 대신 원본이 보이고, 그 기기가 서버(/api/img)로
    //   다시 올려 자동 복구한다. (blob: 은 새로고침 뒤엔 소용없으므로 보내지 않는다)
    function serverImageElement(el){
        if(!el||el.type!=='image') return el;
        const c={...el};
        let u=String(c.url||'');
        const l=String(c.localURL||'');
        delete c.pending; delete c.failed;
        if(u.startsWith('blob:')) u='';     // blob: 은 그 문서에서만 유효 → 절대 공유하지 않는다
        if(u){
            // 확정 URL(/api/img/…)이 있으면 로컬 소스는 버리고 서버 주소만 싣는다.
            c.url=u; delete c.localURL;
            return c;
        }
        // url 이 아직 없는 이미지:
        //  · 옛 방식으로 data: 원본을 물고 있으면 그것만 보존한다(레거시 자가복구용).
        //  · 그 외(새 방식의 pending·blob 미리보기)는 공유 상태에 내보내지 않는다.
        //    → 다른 기기에 '깨진 자리/있었다는 표시'를 만들지 않고, 업로드가 끝난
        //      뒤에만 사진이 나타난다. (업로드-선행: 단일 진실 공급원)
        if(l.startsWith('data:image/')){ c.localURL=l; return c; }
        return null;
    }
    function sanitizeSyncPages(pages){
        if(!Array.isArray(pages)) return pages;
        let dirty=false;
        outer:
        for(const pg of pages){
            if(!pg||!Array.isArray(pg.els)) continue;
            for(const el of pg.els){
                if(!el||el.type!=='image') continue;
                const u=String(el.url||'');
                const l=String(el.localURL||'');
                // 새 방식 pending(공유할 소스가 없는 이미지)은 스냅샷에서 뺀다.
                if(!u && !l.startsWith('data:image/')){ dirty=true; break outer; }
                if(('localURL' in el)&&!l.startsWith('data:')){ dirty=true; break outer; }
                if(('pending' in el)||('failed' in el)||u.startsWith('blob:')){ dirty=true; break outer; }
            }
        }
        if(!dirty) return pages;
        return pages.map(pg=>{
            if(!pg||!Array.isArray(pg.els)) return pg;
            const els=[];
            for(const el of pg.els){
                if(!el||el.type!=='image'){ els.push(el); continue; }
                const clean={...el};
                const l=String(clean.localURL||'');
                const u=String(clean.url||'');
                if(!u && !l.startsWith('data:image/')){
                    // 업로드 전(공유 소스 없음) → 공유 스냅샷에 아예 싣지 않는다.
                    continue;
                }
                if(l.startsWith('data:') && !u){
                    // 옛 방식: 원본 data 보존(다른 기기에서 표시 + 재업로드).
                    delete clean.failed;
                    clean.pending=true;
                    if(!clean.localURL) clean.localURL=l;
                    els.push(clean);
                    continue;
                }
                delete clean.localURL; delete clean.pending; delete clean.failed;
                if(u.startsWith('blob:')) clean.url='';
                els.push(clean);
            }
            return {...pg, els};
        });
    }
    function serializeDoc(d,nbId){
        const cfg=getCfg(nbId);
        // 가져온 문서(서버 보관본 참조)는 본문 없이 마커만 →
        // 다른 기기의 localStorage 용량을 태우지 않는다.
        // ★ 참조 마커는 '일부만 로드된 상태'에서도 반드시 올려야 한다.
        //   (안 올리면 다른 기기에서 본문 주소를 몰라 전부 백지가 된다)
        if(d.__ref){
            return JSON.stringify({version:3,serverDoc:d.__ref,paper:d.paper,
                                   sizePreset:d.sizePreset,emoji:d.emoji,glossary:d.glossary||{}});
        }
        // 참조 없는 일반 문서가 일부만 로드된 상태라면 부분 저장은 위험 → 건너뜀
        if((d.pages||[]).some(p=>p.__lazy!=null)) return '';
        if(cfg.lock&&cfg.lock.enc&&cfg.encBlob){
            // 서버에는 절대 평문을 올리지 않는다.
            // escrow(관리자 위탁 봉인)도 함께 올려야 어느 기기에서든
            // 관리자가 비밀번호 없이 잠금을 열 수 있다 (6.6 수정).
            return JSON.stringify({version:3,locked:true,lock:{salt:cfg.lock.salt,escrow:cfg.lock.escrow||null},
                                   encBlob:cfg.encBlob,paper:d.paper,sizePreset:d.sizePreset,emoji:d.emoji,glossary:d.glossary||{}});
        }
        return JSON.stringify({version:3,paper:d.paper,sizePreset:d.sizePreset,emoji:d.emoji,glossary:d.glossary||{},pages:sanitizeSyncPages(d.pages)});
    }
    // ===== 오프라인 아웃박스 =====
    // 서버 전송에 실패하면 여기에 쌓아 두고, 인터넷이 돌아오면 한꺼번에 올린다.
    const OUTBOX_KEY='sdy_outbox';
    function getOutbox(){ try{ return JSON.parse(localStorage.getItem(OUTBOX_KEY)||'[]'); }catch(e){ return []; } }
    function saveOutbox(o){ try{ localStorage.setItem(OUTBOX_KEY,JSON.stringify(o.slice(-200))); }catch(e){} }
    function outboxCount(){ return getOutbox().length; }
    // 이 노트에 아직 서버로 못 보낸(더 최신) 로컬 편집이 남아 있는가
    function hasPendingLocal(nbId){
        try{
            if(pendingNB&&pendingNB.id===nbId) return true;
            return getOutbox().some(j=>j.kind==='memo'&&j.nbId===nbId);
        }catch(e){ return false; }
    }

    // 같은 대상의 오래된 작업은 새 것으로 대체 (계속 쌓이지 않게)
    function jobKey(job){ return job.kind+':'+(job.nbId||job.memoId||''); }
    function enqueue(job){
        const o=getOutbox();
        const key=jobKey(job);
        const i=o.findIndex(x=>jobKey(x)===key);
        job.ts=Date.now();
        if(i>=0) o[i]=job; else o.push(job);
        saveOutbox(o);
        updateOfflineUI();
    }
    // 요청을 보내기 전에 outbox에 먼저 기록한다. 페이지 종료가 fetch 완료보다
    // 빠르면 온라인 직송만 하던 예전 방식은 '저장됨'을 보인 뒤 내용을 잃을 수 있었다.
    // 같은 대상에 더 새 편집이 들어온 경우에는 그것을 지우지 않는다.
    function acknowledgeJob(job){
        const o=getOutbox();
        const key=jobKey(job);
        const i=o.findIndex(x=>jobKey(x)===key && x.ts===job.ts);
        if(i>=0){ o.splice(i,1); saveOutbox(o); }
        updateOfflineUI();
    }

    function isOnline(){ return navigator.onLine!==false; }

    function updateOfflineUI(){
        if(!document) return;   // 창이 닫힌 뒤 남은 비동기 잔여물 — 무시
        const n=outboxCount();
        const el=document.getElementById('offlineBadge');
        if(!el) return;
        if(!isOnline()){
            el.style.display='flex';
            el.className='offline-badge off';
            el.innerHTML=`<i class="ri-cloud-off-line"></i> 오프라인${n?` · 대기 ${n}`:''}`;
        }else if(n){
            el.style.display='flex';
            el.className='offline-badge wait';
            el.innerHTML=`<i class="ri-upload-cloud-2-line"></i> 동기화 대기 ${n}`;
        }else{
            el.style.display='none';
        }
    }

    // 한 건 전송 (성공 true / 실패 false)
    async function runJob(j){
        if(!SB) return false;
        try{
            if(j.kind==='memo'){
                if(!j.memoId||String(j.memoId).startsWith('local_')) return true;
                const{error}=await SB.from('memos').update({content:j.content,updated_at:new Date().toISOString()}).eq('id',j.memoId);
                if(error) throw error;
            }else if(j.kind==='title'){
                const{error}=await SB.from('notebooks').update({title:j.title,updated_at:new Date().toISOString()}).eq('id',j.nbId);
                if(error) throw error;
            }else if(j.kind==='settings'){
                return true;   // 옛 '설정 통째 덮어쓰기' 방식 잔여 작업 → 폐기
            }else if(j.kind==='deleteNB'){
                const{error}=await SB.from('notebooks').delete().eq('id',j.nbId);
                if(error) throw error;
            }
            return true;
        }catch(e){ return false; }
    }

    let flushingOutbox=false;
    async function flushOutbox(silent){
        if(flushingOutbox||!SB||!isOnline()) return;
        const queued=getOutbox();
        if(!queued.length){ updateOfflineUI(); return; }
        flushingOutbox=true;
        syncStart();
        let sent=0;
        try{
            // 각 성공 건만 확인 응답 뒤 제거한다. 전송 중 새 편집이 enqueue돼도
            // 처음 읽은 배열로 outbox 전체를 덮어쓰지 않아 최신 글이 보존된다.
            for(const j of queued){
                if(await runJob(j)){ acknowledgeJob(j); sent++; }
            }
        }finally{
            flushingOutbox=false;
            syncEnd();
            updateOfflineUI();
        }
        const rest=outboxCount();
        if(sent>0&&!silent) toast(`오프라인 편집 ${sent}건을 서버에 저장했습니다 ☁️`,2600);
        if(rest&&!silent) setSaveState('일부 항목 대기 중',3000);
    }

    function queueSync(nbId){
        // 14.15 · 노트 교체 중에 이전 노트의 doc 이 새 노트 id 로 올라가지 않게
        if(_docId && _docId!==nbId) return;
        // 14.30.0 · 가져온(서버 보관) 문서는 serializeDoc 이 참조 마커만 올리므로
        //   doc 전체를 JSON 직렬화해 복제할 필요가 없다. 수십 MB 문서에서 매
        //   동기화마다 통째로 복사하던 비용을 없앤다. (로컬 저장은 persistDoc 의
        //   더티 쪽 선택 저장이 담당 — 여기 복제본은 동기화 페이로드용이다.)
        let _syncD=null;
        if(doc&&doc.__ref){
            _syncD={__ref:doc.__ref,paper:doc.paper,sizePreset:doc.sizePreset,
                    emoji:doc.emoji||'',glossary:doc.glossary||{}};
        }
        // 22.1 · 일반 문서는 여기서 doc 을 통째로 복제하지 않는다.
        //   예전엔 save 한 번(=타이핑 중에는 400ms 한 번)마다
        //   JSON.parse(JSON.stringify(doc)) 이 돌아, 500쪽 논문에서 입력창이
        //   열려 있는 내내 직렬화 두 번이 이어졌다. 디바운스가 여러 save 를
        //   한 페이로드로 합치는 만큼, '보내기 직전'에 한 번만 굽는 게
        //   비용에도 정확성에도 맞는다(가장 최신 상태를 보낸다).
        pendingNB={id:nbId, memo:curMemo, d:_syncD,
                   _snap:_syncD?null:'1',
                   title:(document.getElementById('edTitle').value||'').trim()};
        clearTimeout(syncTimer);
        syncTimer=setTimeout(flushSync,250);
    }
    async function flushSync(){
        const opt=arguments[0]||{};
        const manual=!!opt.manual;
        clearTimeout(syncTimer);
        const p=pendingNB; pendingNB=null;
        if(!p) return;
        if(p._snap){
            // 위에서 미뤄 둔 '동기화 페이로드용 스냅샷'을 여기서 한 번만 만든다.
            try{
                p.d=(doc&&_docId===p.id&&!doc.__loadFailed&&!doc.__ref)
                    ?JSON.parse(JSON.stringify(doc)):loadDoc(p.id);
            }catch(e){ try{ p.d=loadDoc(p.id); }catch(_e){} }
        }
        if(!SB||String(p.id).startsWith('local_')){
            if(manual) setSaveState('저장됨 ✓',2000);
            return;
        }
        if(p.id===settingsNbId||p.title===SETTINGS_TITLE) return;                 // 설정 행 보호
        if(_nbBlocked(p.id)){
            setSaveState('동기화 차단됨 · 본문 안 불림',2500);
            _armBlockedImportRetry();          // 영구 차단 아님: 복구되면 풀린다
            return;
        }
        if(p.memo&&p.memo.id&&settingsMemoId&&p.memo.id===settingsMemoId) return;

        const jobs=[];
        if(p.title) jobs.push({kind:'title',nbId:p.id,title:p.title});
        if(p.memo&&p.memo.id&&!String(p.memo.id).startsWith('local_')){
            jobs.push({kind:'memo',nbId:p.id,memoId:p.memo.id,content:serializeDoc(p.d,p.id)});
        }
        if(!jobs.length){
            if(manual) setSaveState('저장됨 ✓',1400);
            return;
        }

        // 네트워크 전송보다 먼저 브라우저 저장소에 기록한다. 탭을 바로 닫거나
        // 앱이 백그라운드에서 중단돼도 다음 실행에서 재전송할 수 있다.
        jobs.forEach(enqueue);
        if(!isOnline()){
            setSaveState('오프라인 · 기기에 저장됨',3000);
            return;
        }
        if(manual) setSaveState('저장 중...',1500);
        syncStart();
        let failed=false;
        try{
            for(const j of jobs){
                if(await runJob(j)) acknowledgeJob(j);
                else failed=true;
            }
            // 전송 도중 새 입력이 같은 outbox 항목을 교체했다면 아직 '저장됨'이
            // 아니다. 최신 입력이 다음 동기화에서 확인될 때까지 대기로 표시한다.
            const waiting=outboxCount()>0;
            if(failed||waiting){
                setSaveState('동기화 대기 · 기기에 저장됨',3000);
            }else if(manual){
                setSaveState('저장됨 ✓',2000);
            }
        }catch(e){
            console.warn('동기화 실패:',e);
            setSaveState('동기화 대기 · 기기에 저장됨',3000);
        }finally{ syncEnd(); updateOfflineUI(); }
        // 밀린 게 있으면 같이 올린다
        if(!failed&&outboxCount()) flushOutbox(true);
    }

    // 포인터 이벤트를 기본으로 쓰되, jsdom/구형 브라우저/마우스 전용 테스트에서는
    // 같은 로직을 마우스 이벤트로도 받는다. 실제 브라우저의 pointer→mouse 호환
    // 이중 이벤트는 짧은 시간창으로 눌러 한 동작이 두 번 실행되지 않게 한다.
    const SDY_HAS_POINTER_EVENTS=('PointerEvent' in window);
    let SDY_LAST_POINTER_EVENT_AT=0;
    function sdyPointerFallbackType(type){
        return type==='pointerdown'?'mousedown':type==='pointermove'?'mousemove':type==='pointerup'?'mouseup':null;
    }
    function sdyMarkPointerEvent(){ SDY_LAST_POINTER_EVENT_AT=Date.now(); }
    function sdyIgnoreCompatMouse(){ return SDY_HAS_POINTER_EVENTS && Date.now()-SDY_LAST_POINTER_EVENT_AT<650; }
    function sdyAddPointerCompat(target,type,handler,opts){
        target.addEventListener(type,e=>{ sdyMarkPointerEvent(); handler(e); },opts);
        const mt=sdyPointerFallbackType(type);
        if(mt) target.addEventListener(mt,e=>{ if(sdyIgnoreCompatMouse()) return; handler(e); },opts);
    }


/* APP-PART:05-editor-shell.js:END */
