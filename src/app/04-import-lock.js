/* === src/app/04-import-lock.js ===
   문서 가져오기 · 노트 잠금
   (sdynotes.js 메가 분리 · 이 파일들은 scripts/bundle-frontend.mjs 가 순서대로 이어 붙인다.
    let/const 스코프를 공유하려면 반드시 concat 되어야 한다 — 단독 <script> 로드 금지) */
/* APP-PART:04-import-lock.js:BEGIN */
    // ============ 문서 가져오기 (PDF / Word → 편집 가능한 노트) ============
    // 진행률은 '절대 뒤로 가지 않게' 한 곳에서만 만진다.
    // (예전엔 업로드 10% → 변환 0% 로 되돌아가 보였다)
    function setImpPct(v){
        const p=Math.max(0,Math.min(100,v));
        window.__impPct=Math.max(window.__impPct||0,p);
        const shown=window.__impPct;
        const ib=document.getElementById('impBar'); if(ib) ib.style.width=shown+'%';
        const ip=document.getElementById('impPct'); if(ip) ip.textContent=Math.round(shown)+'%';
    }
    async function importDoc(file){
        if(!file) return;
        const ext=(file.name.split('.').pop()||'').toLowerCase();
        if(!['pdf','docx','docm'].includes(ext)){
            toast('PDF 또는 Word(.docx) 파일만 가져올 수 있습니다',2800); return;
        }
        closeCreateModal();
        const prog=document.getElementById('importProg');
        const msg=document.getElementById('importMsg');
        const sub=document.getElementById('importSub');
        prog.style.display='flex';
        msg.textContent=(ext==='pdf'?'PDF':'Word')+' 를 읽는 중…';
        sub.textContent='파일이 크면 조금 걸릴 수 있습니다';

        try{
            // 큰 파일도 되게: 2MB 청크로 나눠 올린 뒤 변환 요청
            window.__convT0=0; window.__convP0=0; window.__convEta=null;
            window.__convTot=0; window.__impPct=0;
            const CH=8*1024*1024;
            const tot=Math.max(1,Math.ceil(file.size/CH));
            const uid='u'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
            for(let i=0;i<tot;i++){
                const fu=new FormData();
                fu.append('uploadId',uid);
                fu.append('chunk',String(i));
                fu.append('total',String(tot));
                fu.append('name',file.name||'document.pdf');
                fu.append('file',file.slice(i*CH,(i+1)*CH),file.name||'blob');
                setImpPct((i/tot)*10);
                sub.textContent=`올리는 중 ${Math.round((i/tot)*100)}%`;
                const ur=await fetch('/api/import/upload',{method:'POST',body:fu});
                const ud=await ur.json().catch(()=>({}));
                if(!ur.ok||!ud.ok){
                    prog.style.display='none';
                    toast('업로드 실패: '+(ud.error||('HTTP '+ur.status)),4200);
                    return;
                }
            }
            const fd=new FormData();
            fd.append('uploadId',uid);
            fd.append('name',file.name||'document.pdf');
            const r=await fetch('/api/import/doc',{method:'POST',body:fd});
            const d=await r.json().catch(()=>({}));
            if(!r.ok||!d.ok){
                prog.style.display='none';
                let why=d.error||'';
                if(!why){
                    if(r.status===502||r.status===504) why='서버가 응답하지 않습니다 (파일이 너무 큰지 확인해 주세요)';
                    else if(r.status===413) why='파일이 너무 큽니다';
                    else if(r.status===500) why='서버에서 변환에 실패했습니다';
                    else why='서버 오류 ('+r.status+')';
                }
                toast('가져오기 실패: '+why,5200);
                console.error('[import] 실패',r.status,d);
                return;
            }

            // 비동기 잡: 1초마다 진행 상황을 받아온다.
            // → 아무리 긴 변환도 타임아웃으로 죽지 않고, 쪽 수가 보인다.
            if(d.job){
                let done=null;
                while(true){
                    await new Promise(rs=>setTimeout(rs,1000));
                    const sr=await fetch('/api/import/status?id='+encodeURIComponent(d.job),{cache:'no-store'});
                    const sd=await sr.json().catch(()=>({}));
                    if(sr.ok&&sd.status==='working'){
                        msg.textContent=(ext==='pdf'?'PDF':'Word')+' 변환 중…';
                        const pgN=sd.page||0;
                        // 총 쪽수를 아직 모르면(0) 이전에 알던 값을 쓴다 →
                        // 분모가 흔들려 막대가 뒤로 가는 일이 없다
                        if(sd.total>0) window.__convTot=sd.total;
                        const totN=Math.max(1, window.__convTot||sd.total||1);
                        setImpPct(10+90*pgN/totN);
                        // 남은 시간: 최근 속도로만 재고(초반 튐 방지), 표시값은
                        // 한 번 정해지면 크게 늘지 않도록 부드럽게 깎는다.
                        if(pgN>0){
                            if(!window.__convT0){ window.__convT0=Date.now(); window.__convP0=pgN; }
                            const el=(Date.now()-window.__convT0)/1000;
                            const dp=pgN-(window.__convP0||0);
                            if(el>1.2&&dp>0){
                                const raw=(totN-pgN)/(dp/el);
                                const prev=window.__convEta;
                                // 이전 예상보다 커지려 하면 아주 조금만 반영 (오락가락 방지)
                                window.__convEta = (prev==null) ? raw
                                    : (raw>prev ? prev*0.9+raw*0.1 : prev*0.6+raw*0.4);
                            }
                        }
                        const etaS=window.__convEta;
                        const eta = etaS==null ? ''
                            : ` · ${etaS>=60?Math.ceil(etaS/60)+'분':Math.max(1,Math.round(etaS))+'초'} 남음`;
                        sub.textContent=`${pgN}/${totN}쪽${eta}`;
                        continue;
                    }
                    if(sr.ok&&sd.status==='done'){ done=sd; break; }
                    prog.style.display='none';
                    const why=(sd.status==='gone')
                        ? '서버가 변환 도중 재시작되었습니다 (파일이 서버 메모리보다 큰 경우가 많아요). 쪽수를 나눠서 올려주세요'
                        : (sd.error||'서버에서 변환에 실패했습니다');
                    toast('가져오기 실패: '+why,6000);
                    if(sd.detail) console.error('[import] 상세 원인',sd.detail);
                    return;
                }
                Object.assign(d,done);
                setImpPct(100);
            }

            msg.textContent='노트를 만드는 중…';
            sub.textContent='본문 조립 중…';

            // 잡은 본문 대신 참조만 준다 → 서버에서 첫 슬라이스를 받아 온다
            if(!Array.isArray(d.pages)&&d.docRef){
                try{
                    const rr=await fetch('/api/import/docfile/'
                        +encodeURIComponent(d.docRef)+'?from=0&to='+LAZY_SLICE,
                        {cache:'no-store'});
                    const dd=await rr.json().catch(()=>({}));
                    if(rr.ok&&dd.ok!==false&&Array.isArray(dd.pages)){
                        d.pages=dd.pages;
                        d.__total=dd.total||dd.pages.length;
                    }
                }catch(e){}
            }
            if(!Array.isArray(d.pages)||!d.pages.length){
                prog.style.display='none';
                toast('가져온 본문을 받지 못했습니다. 다시 시도해 주세요',3000);
                return;
            }
            const totalP=Math.max(d.pages.length,d.__total||0);
            for(let i=d.pages.length;i<totalP;i++)
                d.pages.push({id:'lazy_'+i,els:[],tables:[],__lazy:1});
            sub.textContent=`${d.pages.length}쪽 로드 · 전체 ${totalP}쪽 · 요소 ${d.count}개`;
            const doc2={paper:'blank', sizePreset:d.sizePreset||'a4_portrait',
                        emoji:'', pages:d.pages};
            if(d.docRef){ doc2.__ref=d.docRef; doc2.__loadedTo=d.pages.length; }
            const title=uniqueTitle(d.title||'가져온 문서');
            const colors=['#4f6ef7','#e74c3c','#27ae60','#f39c12','#8e44ad','#2c3e50'];
            const c=colors[Math.floor(Math.random()*colors.length)];

            const finish=(nb)=>{
                const okP=persistDoc(nb.id,doc2);
                // 기기 저장소가 너무 작아 실패 → 서버 보관본 참조만 저장
                if(!okP&&d.docRef){
                    setCfg(nb.id,{serverDoc:d.docRef,paper:doc2.paper,
                        sizePreset:doc2.sizePreset,emoji:doc2.emoji||'',
                        orient:paperSize(doc2).w>paperSize(doc2).h?'landscape':'portrait',
                        favPages:[],tint:''});
                    toast('문서가 커서 서버에 보관했습니다 · 열 때 자동으로 불러와요',2800);
                }
                if(curFolder) setNoteFolder(nb.id,curFolder);
                notebooks.push(nb); notebooks=sortNBs(notebooks);
                prog.style.display='none';
                renderGrid();
                toast(`${d.pages.length}쪽을 가져왔습니다 · 바로 편집할 수 있어요`,3000);
                openNB(nb);
            };

            if(!SB){
                finish({id:'local_'+Date.now(),title,color:c,
                        created_at:new Date().toISOString(),
                        updated_at:new Date().toISOString()});
                return;
            }
            try{
                const{data,error}=await SB.from('notebooks').insert([{title,color:c}]).select().single();
                if(error||!data){
                    finish({id:'local_'+Date.now(),title,color:c,
                            created_at:new Date().toISOString(),
                            updated_at:new Date().toISOString()});
                    return;
                }
                // 본문을 먼저 기기에 저장한 뒤, 그 내용 그대로 서버에 넣는다.
                persistDoc(data.id,doc2);
                let content='';
                try{ content=serializeDoc(doc2,data.id); }catch(e){ content=''; }
                // 대용량은 본문 대신 '서버 보관본 참조' 마커만 동기화 →
                // 어떤 기기에서 열어도 서버에서 본문을 받아온다.
                const marker=d.docRef? JSON.stringify({serverDoc:d.docRef,
                    sizePreset:doc2.sizePreset,paper:doc2.paper}) : '';
                if(d.docRef) content=marker;   // 대용량 본문은 서버에만 둔다
                let saved=false;
                try{
                    const{error:me}=await SB.from('memos').insert([{notebook_id:data.id,
                        content:content, font_size:S.defFS}]);
                    saved=!me;
                    if(me) console.error('[import] 서버 저장 실패',me);
                }catch(e){ console.error('[import] 서버 저장 예외',e); }
                if(!saved&&marker&&content!==marker){
                    try{
                        const{error:me2}=await SB.from('memos').insert([{notebook_id:data.id,
                            content:marker, font_size:S.defFS}]);
                        saved=!me2;
                    }catch(e){}
                }
                if(!saved){
                    // 서버에 못 올렸다. 그대로 두면 다음에 열 때 백지가 되므로
                    // 기기 전용 노트로 바꿔 내용을 지킨다.
                    try{ await SB.from('notebooks').delete().eq('id',data.id); }catch(e){}
                    const lid='local_'+Date.now();
                    persistDoc(lid,doc2);
                    toast('문서가 커서 이 기기에만 저장했습니다',3600);
                    finish({id:lid,title,color:c,
                            created_at:new Date().toISOString(),
                            updated_at:new Date().toISOString()});
                    return;
                }
                finish(data);
            }catch(e){
                finish({id:'local_'+Date.now(),title,color:c,
                        created_at:new Date().toISOString(),
                        updated_at:new Date().toISOString()});
            }
        }catch(e){
            prog.style.display='none';
            toast('가져오기 실패 · 서버(app.py)가 실행 중인지 확인해 주세요',3400);
        }
    }

    // 9.4 · 새 노트 폭주 방지.
    //  버튼 연타·자동화(테스트 스크립트)·이벤트 중복 바인딩으로 createNB 가
    //  연달아 호출되면 노트가 끝없이 만들어졌다. 만드는 동안에는 잠그고,
    //  직전 생성으로부터 900ms 안의 재호출은 무시한다.
    let _mkNBBusy=false, _mkNBLast=0;
    async function createNB(preset='a4_portrait'){
        const now=Date.now();
        if(_mkNBBusy||now-_mkNBLast<900){ closeCreateModal(); return; }
        _mkNBBusy=true; _mkNBLast=now;
        try{ return await _createNB(preset); }
        finally{ _mkNBBusy=false; _mkNBLast=Date.now(); }
    }
    async function _createNB(preset='a4_portrait'){
        closeCreateModal();
        const colors=['#4f6ef7','#e74c3c','#27ae60','#f39c12','#8e44ad','#2c3e50'];
        const c=colors[Math.floor(Math.random()*colors.length)];
        const title=uniqueTitle('새 노트');
        const mk=(id)=>{
            persistDoc(id, blankDoc(preset));
            if(curFolder) setNoteFolder(id,curFolder);   // 폴더 안에서 만들면 그 폴더에 담기
        };
        const local=()=>{
            const nb={id:'local_'+Date.now(),title,color:c,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
            notebooks.push(nb); notebooks=sortNBs(notebooks); saveLocalNBs(); mk(nb.id);
            renderGrid();
            const _card=document.querySelector('.note-card[data-nb-id="'+nb.id+'"]');
            playClawDrop(_card, ()=>openNB(nb));
        };
        if(!SB){ local(); return; }
        syncStart();
        try{
            const{data,error}=await SB.from('notebooks').insert([{title,color:c}]).select().single();
            if(error||!data){ local(); return; }
            await SB.from('memos').insert([{notebook_id:data.id,content:'',font_size:S.defFS}]);
            notebooks.push(data); notebooks=sortNBs(notebooks); mk(data.id);
            renderGrid();
            const _card=document.querySelector('.note-card[data-nb-id="'+data.id+'"]');
            playClawDrop(_card, ()=>openNB(data));
        }catch(err){ local(); }
        finally{ syncEnd(); }
    }


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


/* APP-PART:04-import-lock.js:END */
