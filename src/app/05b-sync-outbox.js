/* === src/app/05b-sync-outbox.js ===
   서버 동기화 · 오프라인 아웃박스
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:05b-sync-outbox.js:BEGIN */
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


/* APP-PART:05b-sync-outbox.js:END */
