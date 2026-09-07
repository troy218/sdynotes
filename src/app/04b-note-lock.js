/* === src/app/04b-note-lock.js ===
   노트 잠금 AES-GCM
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:04b-note-lock.js:BEGIN */
    // ============ 노트 잠금 (AES-GCM 256 실제 암호화) ============
    // 비밀번호는 저장하지 않는다. PBKDF2(210k)로 키를 유도하고,
    // 검증은 복호화 성공 여부로만 판단한다 → 비번 없으면 내용 복구 불가.
    const PBKDF2_ITER=210000;
    const te=new TextEncoder(), td=new TextDecoder();
    const sessionKeys=new Map();   // nbId -> CryptoKey (탭 닫으면 사라짐)

    function b64(buf){ return btoa(String.fromCharCode(...new Uint8Array(buf))); }
    function unb64(str){ return Uint8Array.from(atob(str),c=>c.charCodeAt(0)); }

    async function deriveKey(pw,salt){
        const base=await crypto.subtle.importKey('raw',te.encode(pw),'PBKDF2',false,['deriveKey']);
        return crypto.subtle.deriveKey(
            {name:'PBKDF2',salt,iterations:PBKDF2_ITER,hash:'SHA-256'},
            base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    }
    async function encryptDoc(d,key){
        const iv=crypto.getRandomValues(new Uint8Array(12));
        const data=te.encode(JSON.stringify({pages:d.pages,paper:d.paper,sizePreset:d.sizePreset,emoji:d.emoji,glossary:d.glossary||{}}));
        const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,data);
        return {iv:b64(iv), ct:b64(ct)};
    }
    async function decryptDoc(enc,key){
        const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(enc.iv)},key,unb64(enc.ct));
        return JSON.parse(td.decode(pt));
    }

    function isLocked(nbId){ const c=getCfg(nbId); return !!(c.lock&&c.lock.enc); }
    function isUnlocked(nbId){
        if(sessionKeys.has(nbId)) return true;
        // 관리자 권한으로 연 평문 잠금 노트
        return adminMode && adminPlainUnlocked.has(nbId);
    }

    // 비밀번호 입력 모달
    let pwResolve=null, pwMode='unlock';
    function askPassword(mode,title){
        pwMode=mode;
        document.getElementById('pwTitle').textContent=title||(mode==='set'?'비밀번호 설정':'비밀번호 입력');
        document.getElementById('pwSub').textContent = mode==='set'
            ? '이 비밀번호는 복구할 수 없습니다. 잊으면 내용을 열 수 없습니다.'
            : '이 노트는 잠겨 있습니다.';
        document.getElementById('pwInput').value='';
        document.getElementById('pwInput2').value='';
        document.getElementById('pwInput2').style.display = mode==='set'?'block':'none';
        document.getElementById('pwErr').textContent='';
        document.getElementById('pwModal').style.display='flex';
        openNav(closePwModal);
        setTimeout(()=>document.getElementById('pwInput').focus(),80);
        return new Promise(res=>{ pwResolve=res; });
    }
    function closePwModal(ok){
        document.getElementById('pwModal').style.display='none';
        navDrop(closePwModal);
        const r=pwResolve; pwResolve=null;
        if(r) r(ok||null);
    }
    async function submitPassword(){
        const pw=document.getElementById('pwInput').value;
        const err=document.getElementById('pwErr');
        if(!pw){ err.textContent='비밀번호를 입력하세요'; return; }
        if(pwMode==='set'){
            if(pw.length<4){ err.textContent='4자 이상 입력하세요'; return; }
            if(pw!==document.getElementById('pwInput2').value){ err.textContent='비밀번호가 일치하지 않습니다'; return; }
        }
        closePwModal(pw);
    }

    async function lockCurrentNote(){
        if(!curNB||!doc) return;
        if(isLocked(curNB.id)){
            // ── 9.1 · 폴더와 완전히 같은 방식으로 해제한다 ──────────────
            //  폴더: 비밀번호 확인(verifier) → lock 삭제.  끝.
            //  노트도 똑같이 만든다. 관리자는 확인 없이 바로 해제한다.
            //  (예전에는 세션키·위탁(escrow)·복호화가 전부 성공해야만 해제가
            //   되어서, 위탁이 없으면 '위탁 정보가 없어…' 로 영영 못 풀었다)
            const cfg=getCfg(curNB.id);
            if(!adminMode&&!isUnlocked(curNB.id)){
                // 아직 안 열린 상태 → 비밀번호로 본인 확인
                const pw=await askPassword('unlock','노트 잠금 해제');
                if(!pw) return;
                if(!(await verifyNotePw(curNB.id,pw))){
                    toast('비밀번호가 올바르지 않습니다',2000); return;
                }
            }
            if(!confirm('이 노트의 잠금을 해제할까요? 해제 후에는 비밀번호 없이 열립니다.')) return;
            // 평문 본문을 확보한다. 열려 있으면 현재 doc, 아니면 복호화해서 얻는다.
            let plain=doc;
            if(!plain||cfg.encBlob){
                try{ plain=await readNotePlain(curNB.id)||doc; }catch(e){ plain=doc; }
            }
            const c2=getCfg(curNB.id);
            delete c2.lock; delete c2.encBlob;   // 잠금·암호문·위탁 정보까지 완전히 제거
            setCfg(curNB.id,c2);
            sessionKeys.delete(curNB.id);
            decCache.delete(curNB.id);
            adminPlainUnlocked.delete(curNB.id);
            adminOpenedNotes.delete(curNB.id);
            if(plain){ doc=plain; _docId=curNB.id; persistDoc(curNB.id,plain); }
            queueSync(curNB.id);
            try{ pushSettingsNow(); }catch(e){}
            updateLockUI(); renderGrid(); toast('잠금 해제됨 🔓');
            return;
        }
        const pw=await askPassword('set','노트 잠그기');
        if(!pw) return;
        syncStart();
        try{
            const salt=crypto.getRandomValues(new Uint8Array(16));
            const saltB64=b64(salt);
            const key=await deriveKey(pw,salt);
            sessionKeys.set(curNB.id,key);
            const cfg=getCfg(curNB.id);
            // 9.1 · 폴더와 동일하게 verifier 를 함께 저장한다.
            //  이것만 있으면 암호문·위탁 없이도 비밀번호가 맞는지 확인할 수 있어
            //  '잠기기만 하고 안 풀리는' 상황이 원천적으로 생기지 않는다.
            cfg.lock={salt:saltB64, enc:true,
                      verifier:await folderVerifier(pw,saltB64),
                      escrow:await makeEscrow(pw)};
            setCfg(curNB.id,cfg);
            persistDoc(curNB.id,doc);
            await flushSync();
            queueSync(curNB.id);
            updateLockUI(); toast('노트가 잠겼습니다 🔒');
        }catch(e){ console.error(e); toast('잠금 실패'); }
        finally{ syncEnd(); }
    }

    // ── 9.1 · 노트 비밀번호 확인 (폴더 verifier 와 같은 방식) ──────────
    //  ① verifier 가 있으면 그것으로 확인 (암호문 없어도 동작)
    //  ② 옛 노트(verifier 없음)는 암호문 복호화로 확인
    //  ③ 둘 다 없으면 '잠금 표시만 있는' 노트이므로 통과
    async function verifyNotePw(nbId,pw){
        const cfg=getCfg(nbId);
        const lk=cfg.lock||{};
        if(!lk.salt) return true;
        try{
            if(lk.verifier){
                const v=await folderVerifier(pw,lk.salt);
                if(v!==lk.verifier) return false;
                sessionKeys.set(nbId,await deriveKey(pw,unb64(lk.salt)));
                return true;
            }
            const key=await deriveKey(pw,unb64(lk.salt));
            if(cfg.encBlob) await decryptDoc(cfg.encBlob,key);   // 틀리면 예외
            sessionKeys.set(nbId,key);
            // 옛 노트에 verifier 를 채워 넣어 다음부터는 확실히 풀리게 한다
            try{
                const c2=getCfg(nbId);
                if(c2.lock&&!c2.lock.verifier){
                    c2.lock.verifier=await folderVerifier(pw,c2.lock.salt);
                    if(!c2.lock.escrow) c2.lock.escrow=await makeEscrow(pw);
                    setCfg(nbId,c2); queueSync(nbId);
                }
            }catch(e){}
            return true;
        }catch(e){ return false; }
    }

    // 잠긴 노트의 평문 본문을 얻는다 (해제 직전에 쓴다)
    async function readNotePlain(nbId){
        const cfg=getCfg(nbId);
        if(cfg.encBlob&&sessionKeys.has(nbId)){
            try{ return await decryptDoc(cfg.encBlob,sessionKeys.get(nbId)); }catch(e){}
        }
        if(decCache.has(nbId)) return decCache.get(nbId);
        if(Array.isArray(cfg.pages)) return migrate(cfg,nbId);
        try{ return await loadDocAsync(nbId); }catch(e){}
        return null;
    }

    // 잠긴 노트 열기 시도 (성공하면 세션 키 보관)
    async function tryUnlock(nbId){
        if(isUnlocked(nbId)) return true;
        const cfg=getCfg(nbId);
        if(!cfg.lock||(!cfg.lock.salt&&!cfg.encBlob)){
            if(adminMode) adminPlainUnlocked.add(nbId);  // 6.2: 잠금 표기만 남은 옛 노트
            return true;
        }
        if(adminMode){
            if(await adminUnlockNote(nbId)) return true;
            toast('옛 방식으로 잠긴 노트입니다. 비밀번호를 한 번만 입력하면 다음부터 관리자 권한으로 자동으로 열립니다',4200);
        }
        for(let i=0;i<3;i++){
            const pw=await askPassword('unlock');
            if(!pw) return false;
            // 9.1 · verifier 우선 검증 (암호문이 없어도 확실히 판정된다)
            if(await verifyNotePw(nbId,pw)){
                // 위탁 정보가 없으면 지금 심어 둔다 →
                // 다음부터는 관리자 권한으로 비밀번호 없이 열린다
                try{
                    const c2=getCfg(nbId);
                    if(c2.lock&&!c2.lock.escrow){
                        c2.lock.escrow=await makeEscrow(pw);
                        setCfg(nbId,c2); queueSync(nbId);
                        if(adminMode) toast('관리자 권한 등록 완료 · 다음부터 자동으로 열립니다',3000);
                    }
                }catch(e){ console.warn('위탁 등록 실패',e); }
                return true;
            }
            toast('비밀번호가 올바르지 않습니다',1800);
        }
        return false;
    }

    let _lastPosT=0;
    let _posHydrated=true;   // 14.38 · 열림 직후 restoreLastPos 전에 '0'이 저장되는 것을 막는다
    function saveLastPos(){
        if(!curNB||!doc) return;
        const now=Date.now();
        if(now-_lastPosT<400) return;      // 스크롤 연타는 한 번만
        _lastPosT=now;
        try{ localStorage.setItem('sdy_lastpg_'+curNB.id, String(curPageIdx||0)); }catch(e){}
    }
    function restoreLastPos(){
        if(!curNB||!doc) return;
        let i=0;
        try{ i=parseInt(localStorage.getItem('sdy_lastpg_'+curNB.id)||'0')||0; }catch(e){}
        if(i>0&&i<(doc.pages||[]).length){
            curPageIdx=i;
            const doScroll=()=>{
                try{
                    const size=paperSize();
                    const body=document.getElementById('editorBody');
                    body.scrollTop=(i)*(size.h+PAGE_GAP)*pageScale;
                    updatePageInfo();
                    // 서버 슬라이스를 기다리느라 첫 화면이 멎지 않게 위치부터 옮기고 병렬 로드한다.
                    maintainPageWindow(i,true);
                }catch(e){}
            };
            doScroll();
        }
    }

    function updateLockUI(){
        const btn=document.getElementById('lockBtn');
        if(!btn||!curNB) return;
        const locked=isLocked(curNB.id);
        const ic=btn.querySelector('i');
        if(ic) ic.className=locked?'ri-lock-fill':'ri-lock-unlock-line';
        else btn.innerHTML=locked?'<i class="ri-lock-fill"></i>':'<i class="ri-lock-unlock-line"></i>';
        btn.title=locked?'비밀번호 잠금 해제':'비밀번호 잠금';
        btn.classList.toggle('active',locked);
    }

    // ── 카드에서 바로 잠금 해제 ────────────────────────────────
    // 9.1 · 폴더와 같은 매커니즘. 관리자는 바로, 일반 사용자는 비밀번호 확인 후 해제.
    //   위탁(escrow)이 없어도 반드시 풀린다. 복호화가 불가능한 옛 암호문이면
    //   본문은 비워지더라도 잠금 자체는 풀어 준다(노트가 영영 갇히지 않게).
    async function removeNoteLockFromCard(nbId){
        const cfg=getCfg(nbId);
        if(!isLocked(nbId)) return false;
        if(!adminMode){
            const pw=await askPassword('unlock','노트 잠금 해제');
            if(!pw) return false;
            if(!(await verifyNotePw(nbId,pw))){ toast('비밀번호가 올바르지 않습니다',2000); return false; }
        }else{
            await adminUnlockNote(nbId);      // 열 수 있으면 열어 둔다 (실패해도 계속)
        }
        let plain=null;
        if(cfg.encBlob && sessionKeys.has(nbId)){
            try{ plain=await decryptDoc(cfg.encBlob, sessionKeys.get(nbId)); }catch(e){ plain=null; }
        }
        if(!plain && decCache.has(nbId)) plain=decCache.get(nbId);
        if(!plain && Array.isArray(cfg.pages)) plain=migrate(cfg, nbId);
        if(!plain) plain=await recoverPlain(nbId,cfg);
        if(!plain){
            // 본문을 못 살리는 경우에도 잠금은 해제한다 (폴더와 동일하게)
            if(!confirm('이 노트의 내용은 복원할 수 없습니다.\n잠금만 해제하고 빈 노트로 만들까요?')) return false;
            plain={paper:cfg.paper||'blank',sizePreset:cfg.sizePreset||'a4_portrait',
                   emoji:cfg.emoji||'',glossary:{},pages:[blankPage()]};
        }
        // 평문으로 전환 (lock/encBlob/escrow 전부 제거)
        const c2=getCfg(nbId);
        delete c2.lock; delete c2.encBlob;
        c2.paper=plain.paper||c2.paper; c2.sizePreset=plain.sizePreset||c2.sizePreset;
        c2.emoji=plain.emoji||''; c2.glossary=plain.glossary||{};
        c2.pages=Array.isArray(plain.pages)?plain.pages:c2.pages;
        c2.favPages=Array.isArray(plain.favPages)?plain.favPages:[];
        setCfg(nbId,c2);
        sessionKeys.delete(nbId); decCache.delete(nbId); adminPlainUnlocked.delete(nbId);
        try{ localStorage.removeItem('draw_'+nbId); }catch(e){}
        // 서버에도 잠금 제거(평문)가 반영되도록 직접 기록
        if(SB && !String(nbId).startsWith('local_')){
            const content=JSON.stringify({version:3,paper:c2.paper,sizePreset:c2.sizePreset,
                                          emoji:c2.emoji,glossary:c2.glossary||{},pages:c2.pages});
            try{
                const{data:ms}=await SB.from('memos').select('id').eq('notebook_id',nbId).order('created_at').limit(1);
                const memoId=ms&&ms.length?ms[0].id:null;
                if(memoId && !String(memoId).startsWith('local_')){
                    const{error}=await SB.from('memos').update({content,updated_at:new Date().toISOString()}).eq('id',memoId);
                    if(error) enqueue({kind:'memo',nbId,memoId,content});
                }
            }catch(e){}
        }
        return true;
    }


/* APP-PART:04b-note-lock.js:END */
