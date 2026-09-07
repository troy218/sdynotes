/* === src/app/03-admin.js ===
   관리자 모드 · 파일 보관함
   (sdynotes.js 메가 분리 · 이 파일들은 scripts/bundle-frontend.mjs 가 순서대로 이어 붙인다.
    let/const 스코프를 공유하려면 반드시 concat 되어야 한다 — 단독 <script> 로드 금지) */
/* APP-PART:03-admin.js:BEGIN */
    // ============ 관리자 모드 ============
    // 비밀번호 검증과 IP 차단은 서버(app.py)에서 처리한다. 프런트는 토큰만 보관.
    let adminMode=false, adminToken=null;

    function isAdmin(){ return adminMode; }

    // 관리자 비밀번호 SHA-256 (평문은 코드에 두지 않는다)
    const ADMIN_PW_SHA='3fefee1eb597160149949f663d622fbcd0824095775b63647e312550872abbdb';
    const LOCAL_BLOCK_KEY='sdy_admin_block';
    let serverAdmin=true;      // 백엔드(app.py) 사용 가능 여부

    async function sha256Hex(str){
        const buf=await crypto.subtle.digest('SHA-256',te.encode(str));
        return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
    }

    // 서버가 없을 때 쓰는 로컬 시도 기록 (이 브라우저 기준)
    function localBlockState(){
        try{ return JSON.parse(localStorage.getItem(LOCAL_BLOCK_KEY)||'{}'); }catch(e){ return {}; }
    }
    function saveLocalBlock(o){ localStorage.setItem(LOCAL_BLOCK_KEY,JSON.stringify(o)); }

    async function adminApi(path,body){
        try{
            const r=await fetch('/api/admin/'+path,{
                method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify(body||{})
            });
            // 백엔드가 없으면 404/501 또는 HTML 이 돌아온다 → 로컬 검증으로 전환
            const ct=r.headers.get('Content-Type')||'';
            if(!ct.includes('application/json')||r.status===404||r.status===501){
                serverAdmin=false;
                return localAdminApi(path,body);
            }
            let d={}; try{ d=await r.json(); }catch(e){ serverAdmin=false; return localAdminApi(path,body); }
            serverAdmin=true;
            return {status:r.status, ...d};
        }catch(e){
            serverAdmin=false;              // 네트워크 실패 → 로컬 검증
            return localAdminApi(path,body);
        }
    }

    // 백엔드 없이 동작하는 대체 구현 (차단은 이 브라우저 기준)
    async function localAdminApi(path,body){
        const now=Date.now();
        const st=localBlockState();
        if(path==='login'){
            if(st.until&&st.until>now){
                const w=Math.ceil((st.until-now)/1000);
                return {status:429,ok:false,blocked:true,retry_after:w,
                        error:`${Math.floor(w/60)}분 ${w%60}초 후에 다시 시도하세요`};
            }
            const hash=await sha256Hex(body.password||'');
            if(hash===ADMIN_PW_SHA){
                saveLocalBlock({});
                const tok='local-'+Math.random().toString(36).slice(2)+Date.now().toString(36);
                sessionStorage.setItem('sdy_admin_local',tok);
                return {status:200,ok:true,token:tok,expires_in:3600,local:true};
            }
            const cnt=(st.count||0)+1;
            if(cnt>=3){
                saveLocalBlock({count:0,until:now+600000});
                return {status:429,ok:false,blocked:true,retry_after:600,
                        error:'3회 실패 · 10분간 차단되었습니다'};
            }
            saveLocalBlock({count:cnt});
            return {status:401,ok:false,blocked:false,remaining:3-cnt,
                    error:`비밀번호가 올바르지 않습니다 (남은 시도 ${3-cnt}회)`};
        }
        if(path==='verify'){
            const t=sessionStorage.getItem('sdy_admin_local');
            return {status:200,ok:!!t&&t===(body&&body.token)};
        }
        if(path==='logout'){
            sessionStorage.removeItem('sdy_admin_local');
            return {status:200,ok:true};
        }
        return {status:404,ok:false};
    }

    function adminButtonClick(){
        if(adminMode){ adminLogout(); return; }
        openAdminModal();
    }
    async function openAdminModal(){
        document.getElementById('adminPw').value='';
        document.getElementById('adminErr').textContent='';
        document.getElementById('adminModal').style.display='flex';
        openNav(closeAdminModal);
        setTimeout(()=>document.getElementById('adminPw').focus(),80);
        // 이미 차단 중이면 미리 알려준다
        try{
            const r=await fetch('/api/admin/status');
            const ct=r.headers.get('Content-Type')||'';
            if(ct.includes('application/json')&&r.ok){
                const d=await r.json();
                serverAdmin=true;
                if(d.blocked) showAdminBlocked(d.retry_after);
            }else throw new Error('no backend');
        }catch(e){
            serverAdmin=false;
            const st=localBlockState();
            if(st.until&&st.until>Date.now()) showAdminBlocked(Math.ceil((st.until-Date.now())/1000));
        }

    }
    function closeAdminModal(){ document.getElementById('adminModal').style.display='none'; navDrop(closeAdminModal); }

    // 로그인 성공 인사
    function showWelcome(unlocked){
        const el=document.getElementById('welcomeToast');
        if(!el) return;
        el.innerHTML=`<div class="wc-ico"><i class="ri-shield-check-fill"></i></div>`+
            `<div><div class="wc-title">엽동구리님 환영합니다</div>`+
            `<div class="wc-sub">관리자 모드 · ${unlocked?`잠긴 항목 ${unlocked}개를 열었습니다`:'모든 잠금이 해제되었습니다'}</div></div>`;
        el.classList.add('show');
        clearTimeout(showWelcome._t);
        showWelcome._t=setTimeout(()=>el.classList.remove('show'),4200);
    }

    let blockTimer=null;
    function showAdminBlocked(sec){
        const err=document.getElementById('adminErr');
        const btn=document.getElementById('adminSubmitBtn');
        const inp=document.getElementById('adminPw');
        inp.disabled=true; btn.disabled=true; btn.style.opacity='.5';
        clearInterval(blockTimer);
        const tick=()=>{
            if(sec<=0){
                clearInterval(blockTimer);
                inp.disabled=false; btn.disabled=false; btn.style.opacity='1';
                err.textContent=''; err.style.color='#e74c3c';
                return;
            }
            const m=Math.floor(sec/60), ss=String(sec%60).padStart(2,'0');
            err.textContent=`🚫 차단됨 · ${m}:${ss} 후에 다시 시도할 수 있습니다`;
            sec--;
        };
        tick();
        blockTimer=setInterval(tick,1000);
    }

    async function submitAdmin(){
        const pw=document.getElementById('adminPw').value;
        const err=document.getElementById('adminErr');
        if(!pw){ err.textContent='비밀번호를 입력하세요'; return; }
        err.textContent='확인 중…'; err.style.color='var(--text3)';
        let d;
        try{ d=await adminApi('login',{password:pw}); }
        catch(e){ err.style.color='#e74c3c'; err.textContent='서버에 연결할 수 없습니다'; return; }

        if(d.ok&&d.token){
            adminToken=d.token; adminMode=true;
            sessionStorage.setItem('sdy_admin',adminToken);
            sessionStorage.setItem('sdy_admin_k',pw);
            localStorage.setItem('sdy_admin',adminToken);
            localStorage.setItem('sdy_admin_tok',adminToken);
            try{ adminPrivKey=await unwrapAdminKey(pw); }catch(e){ adminPrivKey=null; }
            closeAdminModal();
            applyAdminMode();
            const r=await adminUnlockAll();
            renderGrid();
            showWelcome(r.ok);
            return;
        }
        err.style.color='#e74c3c';
        if(d.blocked){ showAdminBlocked(d.retry_after||600); return; }
        err.textContent=d.error||'비밀번호가 올바르지 않습니다';
        document.getElementById('adminPw').value='';
        document.getElementById('adminPw').focus();
    }

    async function adminLogout(){
        if(adminToken){ try{ await adminApi('logout',{token:adminToken}); }catch(e){} }
        adminMode=false; adminToken=null; adminPrivKey=null;
        sessionStorage.removeItem('sdy_admin');
        sessionStorage.removeItem('sdy_admin_k');
        localStorage.removeItem('sdy_admin');
        localStorage.removeItem('sdy_admin_tok');
        // 관리자 권한으로 열어 둔 것들을 되돌린다
        adminOpenedFolders.forEach(f=>unlockedFolders.delete(f));
        adminOpenedFolders.clear();
        adminOpenedNotes.forEach(id=>{ sessionKeys.delete(id); decCache.delete(id); });
        adminOpenedNotes.clear();
        adminPlainUnlocked.clear();
        applyAdminMode();
        toast('관리자 모드를 종료했습니다',2000);
    }

    // 관리자 권한으로 연 항목 (종료 시 원복용)
    const adminOpenedFolders=new Set();
    const adminOpenedNotes=new Set();

    function applyAdminMode(){
        document.body.classList.toggle('admin-on',adminMode);
        const ban=document.getElementById('adminBanner');
        if(ban) ban.style.display=adminMode?'flex':'none';
        // 보관함 버튼은 항상 보이되, 관리자가 아니면 잠긴 모양으로 표시
        const vb=document.getElementById('vaultBtn');
        if(vb){
            vb.style.display='flex';
            vb.classList.toggle('locked',!adminMode);
            vb.title=adminMode?'파일 보관함':'파일 보관함 (관리자 전용 · 잠김)';
        }
        try{ if(typeof renderListPop==='function') renderListPop(); }catch(e){}
        try{ if(typeof renderTitle==='function') renderTitle(); }catch(e){}
        if(!adminMode) closeVault();
        const btn=document.getElementById('adminToggleBtn');
        if(btn){
            btn.innerHTML=adminMode
                ? '<i class="ri-shield-check-fill"></i>'
                : '<i class="ri-shield-keyhole-line"></i>';
            btn.title=adminMode?'관리자 모드 종료':'관리자 모드';
            btn.classList.toggle('on',adminMode);
        }
        if(adminMode){
            // 잠긴 폴더를 모두 열어 둔다
            getFolders().forEach(f=>{
                if(f.lock&&f.lock.verifier&&!unlockedFolders.has(f.id)){
                    unlockedFolders.add(f.id); adminOpenedFolders.add(f.id);
                }
            });
        }
        renderGrid();
        if(typeof updateLockUI==='function'&&curNB) updateLockUI();
    }

    // 새로고침해도 이번 세션 동안은 유지 (서버 토큰 재검증)
    async function restoreAdmin(){
        const t=sessionStorage.getItem('sdy_admin')||localStorage.getItem('sdy_admin')||localStorage.getItem('sdy_admin_tok');
        if(!t) return;
        try{
            const d=await adminApi('verify',{token:t});
            if(d.ok){
                adminToken=t; adminMode=true;
                sessionStorage.setItem('sdy_admin',t);
                localStorage.setItem('sdy_admin',t);
                const pw=sessionStorage.getItem('sdy_admin_k')||localStorage.getItem('sdy_admin_k');
                if(pw){ try{ adminPrivKey=await unwrapAdminKey(pw); }catch(e){} }
                applyAdminMode();
                await adminUnlockAll();
                renderGrid();
            }else{
                sessionStorage.removeItem('sdy_admin');
                sessionStorage.removeItem('sdy_admin_k');
                localStorage.removeItem('sdy_admin');
                localStorage.removeItem('sdy_admin_tok');
            }
        }catch(e){}
    }

    // ============ 파일 보관함 (관리자 전용) ============
    let vaultFiles=[], vaultTotal=0, vaultStorage='';
    let vaultSel=null;
    let vaultView=(()=>{ try{ return localStorage.getItem('sdy_vault_view')||'grid'; }
                         catch(e){ return 'grid'; } })();

    const VAULT_ICONS=[
        [/\.(jpe?g|png|gif|webp|bmp|svg|ico|heic|heif|avif|tiff?)$/i,'ri-image-fill','#10b981'],
        [/\.(mp4|mov|avi|mkv|webm|m4v)$/i,                          'ri-film-fill','#8b5cf6'],
        [/\.(mp3|wav|ogg|flac|aac|m4a)$/i,                          'ri-music-2-fill','#ec4899'],
        [/\.pdf$/i,                                                  'ri-file-pdf-2-fill','#ef4444'],
        [/\.(docx?|hwpx?|rtf|odt)$/i,                                'ri-file-word-2-fill','#2563eb'],
        [/\.(xlsx?|csv|ods)$/i,                                      'ri-file-excel-2-fill','#16a34a'],
        [/\.(pptx?|odp)$/i,                                          'ri-file-ppt-2-fill','#ea580c'],
        [/\.(zip|rar|7z|tar|gz|bz2)$/i,                              'ri-file-zip-fill','#f59e0b'],
        [/\.(js|ts|py|java|c|cpp|cs|go|rb|php|html?|css|json|xml|yml|yaml|sh)$/i,'ri-code-s-slash-fill','#0ea5e9'],
        [/\.(txt|md|log)$/i,                                         'ri-file-text-fill','#64748b'],
    ];
    function vaultIcon(name){
        for(const [re,ic,col] of VAULT_ICONS) if(re.test(name)) return {ic,col};
        return {ic:'ri-file-3-fill',col:'#6b7280'};
    }
    // 서버 디스크에 저장된 파일은 인증 토큰을 붙여야 열람 가능
    function vaultUrl(f){
        const u=f.url||'';
        if(u.startsWith('/api/files/raw/')) return u+'?token='+encodeURIComponent(adminToken||'');
        return u;
    }
    function fmtBytes(b){
        b=+b||0;
        if(b<1024) return b+' B';
        if(b<1048576) return (b/1024).toFixed(1)+' KB';
        if(b<1073741824) return (b/1048576).toFixed(1)+' MB';
        return (b/1073741824).toFixed(2)+' GB';
    }

    async function openVault(){
        if(!adminMode){
            toast('관리자 전용 기능입니다. 관리자 모드로 로그인해 주세요',2600);
            setTimeout(()=>openAdminModal(),350);
            return;
        }
        if(!serverAdmin){
            toast('파일 보관함은 app.py 를 실행하고 localhost:5000 으로 접속해야 합니다',3400);
            return;
        }
        document.getElementById('vaultModal').style.display='flex';
        document.getElementById('vaultList').className='vault-grid'+(vaultView==='rows'?' rows':'');
        document.getElementById('vaultList').innerHTML=
            '<div class="vault-empty"><i class="ri-loader-4-line"></i>불러오는 중…</div>';
        document.getElementById('vaultActBar').style.display='none';
        document.getElementById('vaultViewGrid').classList.toggle('on',vaultView==='grid');
        document.getElementById('vaultViewList').classList.toggle('on',vaultView==='rows');
        vaultSel=null;
        openNav(closeVault);
        await loadVault();
    }
    function closeVault(){
        document.getElementById('vaultModal').style.display='none';
        vaultSel=null;
        const b=document.getElementById('vaultActBar'); if(b) b.style.display='none';
        navDrop(closeVault);
    }

    async function loadVault(_retry){
        if(!adminToken){ return (await vaultAuthLost()) && !_retry ? loadVault(true) : false; }
        try{
            const r=await fetch('/api/files/list?token='+encodeURIComponent(adminToken),
                                {cache:'no-store'});
            const d=await r.json().catch(()=>({}));
            if(r.status===403){
                if(_retry) return false;
                return (await vaultAuthLost()) ? true : false;
            }
            if(!r.ok||!d.ok){
                vaultFiles=[]; vaultTotal=0;   // 옛 목록이 되살아나지 않게 비운다
                document.getElementById('vaultList').innerHTML=
                    `<div class="vault-empty">목록을 불러오지 못했습니다<br>`+
                    `<span style="font-size:11px">${esc(d.error||'')}</span></div>`;
                return false;
            }
            vaultFiles=d.files||[];
            vaultTotal=d.total_bytes||0;
            loadStorageInfo();
            vaultStorage=d.storage||'';
            renderVault();
            return true;
        }catch(e){
            vaultFiles=[]; vaultTotal=0;
            document.getElementById('vaultList').innerHTML=
                '<div class="vault-empty">서버에 연결할 수 없습니다</div>';
            return false;
        }
    }

    // 보관함 사용량 표시
    async function loadStorageInfo(){
        try{
            const r=await fetch('/api/storage/info?token='+encodeURIComponent(adminToken||''),
                                {cache:'no-store'});
            if(!r.ok) return;
            const d=await r.json();
            if(!d.ok) return;
            const pct=d.total?Math.min(100,(d.used+d.stickers)/d.total*100):0;
            const bar=document.getElementById('stgBar');
            const txt=document.getElementById('stgTxt');
            if(bar) bar.style.width=pct.toFixed(1)+'%';
            if(bar) bar.style.background = pct>90
                ? 'linear-gradient(90deg,#ef4444,#f97316)'
                : 'linear-gradient(90deg,#3b82f6,#8b5cf6)';
            if(txt) txt.innerHTML=
                `<b>${fmtBytes(d.used+d.stickers)}</b> 사용 / ${fmtBytes(d.total)} `+
                `<span style="color:#059669">· ${fmtBytes(d.free)} 남음</span>`+
                ` · 파일 ${d.files}개`+
                (d.stickers?` · 스티커 ${fmtBytes(d.stickers)}`:'')+
                ` · ${d.storage==='cloudinary'?'클라우드':'서버 디스크'}`;
        }catch(e){}
    }

    // 서버 세션이 끊겨도 관리자 모드는 절대 풀지 않는다.
    // 이 탭에 비밀번호가 남아 있으면 조용히 다시 로그인해서 그대로 이어간다.
    let vaultRelogging=false;
    async function vaultAuthLost(){
        if(vaultRelogging) return false;
        vaultRelogging=true;
        try{
            const pw=sessionStorage.getItem('sdy_admin_k');
            if(pw){
                try{
                    const d=await adminApi('login',{password:pw});
                    if(d&&d.ok&&d.token){
                        adminToken=d.token;
                        sessionStorage.setItem('sdy_admin',d.token);
                        adminMode=true; serverAdmin=true;
                        applyAdminMode();
                        await loadVault();          // 끊긴 작업을 이어서 새로고침
                        return true;                // 사용자는 아무것도 못 느낀다
                    }
                }catch(e){}
            }
            // 비밀번호가 없을 때만(다른 탭 등) 안내 — 그래도 모드는 유지
            const el=document.getElementById('vaultList');
            if(el) el.innerHTML='<div class="vault-empty">서버 인증이 필요합니다<br>'+
                '<span style="font-size:11px">관리자 비밀번호를 다시 입력해 주세요</span></div>';
            toast('서버 인증이 필요합니다. 비밀번호를 다시 입력해 주세요',3000);
            setTimeout(()=>openAdminModal(),400);
            return false;
        }finally{ vaultRelogging=false; }
    }

    function setVaultView(v){
        vaultView=v;
        try{ localStorage.setItem('sdy_vault_view',v); }catch(e){}
        try{ pushSettings(); }catch(e){}
        document.getElementById('vaultViewGrid').classList.toggle('on',v==='grid');
        document.getElementById('vaultViewList').classList.toggle('on',v==='rows');
        renderVault();
    }

    // 파일 하나를 고르면 아래에 열기/저장/삭제 막대가 나타난다
    function vaultSelect(id){
        vaultSel=id;
        document.querySelectorAll('#vaultList .v-file').forEach(n=>
            n.classList.toggle('sel',n.dataset.id===id));
        const bar=document.getElementById('vaultActBar');
        const f=vaultFiles.find(x=>x.id===id);
        if(!f){ bar.style.display='none'; return; }
        bar.style.display='flex';
        document.getElementById('vaultSelName').textContent=f.name;
    }
    function openVaultFileMenu(e,id){
        if(e){ e.preventDefault(); e.stopPropagation(); }
        vaultSelect(id);
        const f=vaultSelFile(); if(!f) return;
        const m=document.getElementById('ctxMenu');
        m.innerHTML=`<div class="ctx-item" onclick="closeCtxMenu();vaultOpenSel()"><i class="ri-external-link-line"></i> 열기</div>
            <div class="ctx-item" onclick="closeCtxMenu();vaultDownloadSel()"><i class="ri-download-2-line"></i> 기기에 저장</div>
            <div class="ctx-sep"></div>
            <div class="ctx-item danger" onclick="closeCtxMenu();vaultDeleteSel()"><i class="ri-delete-bin-6-line"></i> 삭제</div>`;
        m.classList.add('show');
        lastMouse.clientX=(e&&e.clientX)||innerWidth/2;
        lastMouse.clientY=(e&&e.clientY)||innerHeight*.72;
        _ctxAnchor=null; ctxPlace(false);
    }
    function vaultSelFile(){ return vaultFiles.find(x=>x.id===vaultSel); }
    function vaultOpenSel(){
        const f=vaultSelFile(); if(!f) return;
        window.open(vaultUrl(f),'_blank','noopener');
    }
    function vaultDownloadSel(){
        const f=vaultSelFile(); if(!f) return;
        vaultDownload(f.id,f.resource_type,f.name);
    }
    function vaultDeleteSel(){
        const f=vaultSelFile(); if(!f) return;
        vaultDelete(f.id,f.resource_type,f.name);
    }

    function renderVault(){
        const q=(document.getElementById('vaultSearch').value||'').trim().toLowerCase();
        const list=vaultFiles.filter(f=>!q||(f.name||'').toLowerCase().includes(q));
        const el=document.getElementById('vaultList');
        el.className='vault-grid'+(vaultView==='rows'?' rows':'');

        document.getElementById('vaultCount').textContent=
            vaultFiles.length?`${list.length} / ${vaultFiles.length}개 · ${fmtBytes(vaultTotal)}`:'';

        if(!list.length){
            el.innerHTML=vaultFiles.length
                ? '<div class="vault-empty"><i class="ri-search-line"></i>검색 결과가 없습니다</div>'
                : '<div class="vault-empty"><i class="ri-folder-open-line"></i>보관된 파일이 없습니다<br>'+
                  '<span style="font-size:11.5px">파일 올리기 버튼을 누르거나 끌어다 놓으세요</span></div>';
            vaultSelect(null);
            return;
        }

        el.innerHTML=list.map(f=>{
            const {ic,col}=vaultIcon(f.name||'');
            const src=vaultUrl(f);
            const isImg=f.resource_type==='image';
            const thumb=isImg
                ? `<img class="v-thumb" src="${esc(src)}" alt="" loading="lazy" `+
                  `onerror="this.outerHTML='<div class=\'v-ico\' style=\'background:${col}\'><i class=\'${ic}\'></i></div>'">`
                : `<div class="v-ico" style="background:${col}"><i class="${ic}"></i></div>`;
            const dt=f.created_at
                ? new Date(f.created_at).toLocaleDateString('ko-KR',{month:'short',day:'numeric'}) : '';
            return `<div class="v-file" data-id="${esc(f.id)}" title="${esc(f.name)}"
                 onclick="vaultSelect('${esc(f.id)}')"
                 oncontextmenu="openVaultFileMenu(event,'${esc(f.id)}')"
                 ondblclick="vaultSelect('${esc(f.id)}');vaultOpenSel()">
                ${thumb}
                <div class="v-name">${esc(f.name)}</div>
                <div class="v-size">${fmtBytes(f.bytes)}</div>
                <div class="v-date">${dt}</div>
            </div>`;
        }).join('');

        // 목록이 바뀌어도 선택은 유지
        if(vaultSel&&list.some(f=>f.id===vaultSel)) vaultSelect(vaultSel);
        else vaultSelect(null);
    }

    async function vaultUpload(files){
        if(!files||!files.length) return;
        if(!adminToken&&!(await vaultAuthLost())) return;
        const arr=Array.from(files);
        const prog=document.getElementById('vaultProg');
        const bar=document.getElementById('vaultBar');
        const txt=document.getElementById('vaultProgTxt');
        prog.style.display='block';
        let done=0, fail=0, authLost=false;
        for(const f of arr){
            txt.textContent=`${f.name} 업로드 중… (${done+1}/${arr.length})`;
            bar.style.width=Math.round(done/arr.length*100)+'%';
            try{
                const fd=new FormData();
                fd.append('file',f);
                fd.append('token',adminToken);
                const r=await fetch('/api/files/upload',{method:'POST',body:fd});
                if(r.status===403){ authLost=true; break; }
                const d=await r.json().catch(()=>({}));
                if(!r.ok||!d.ok) fail++;
            }catch(e){ fail++; }
            done++;
        }
        if(authLost){
            document.getElementById('vaultInput').value='';
            const back=await vaultAuthLost();
            if(back){
                // 조용히 다시 로그인됨 → 못 올린 파일만 이어서 업로드
                const rest=arr.slice(done);
                prog.style.display='none'; bar.style.width='0';
                if(rest.length) return vaultUpload(rest);
                await loadVault();
                return;
            }
            prog.style.display='none'; bar.style.width='0';
            return;
        }
        bar.style.width='100%';
        txt.textContent=fail?`${done-fail}개 완료 · ${fail}개 실패`:`${done}개 업로드 완료`;
        setTimeout(()=>{ prog.style.display='none'; bar.style.width='0'; },2200);
        document.getElementById('vaultInput').value='';
        await loadVault();
        toast(fail?`${done-fail}개 업로드 (${fail}개 실패)`:`${done}개 파일을 보관했습니다`,2200);
    }

    async function vaultDownload(fid,kind,name){
        // 언제나 우리 서버를 거쳐 내려받는다.
        //  · 크롬은 다른 도메인 링크에 download 속성이 안 먹혀
        //    '금지됨 / 사이트에서 사용할 수 없는 파일'로 막아 버린다.
        //  · 클라우드가 PDF·ZIP 전송을 막아둔 경우에도 서버가 대신 받아 넘긴다.
        try{
            const url=`/api/files/raw/${encodeURIComponent(fid)}`+
                      `?dl=1&token=${encodeURIComponent(adminToken)}`;
            const r=await fetch(url);
            if(r.status===403){
                if(await vaultAuthLost()) return vaultDownload(fid,kind,name);
                return;
            }
            if(!r.ok){
                let msg='다운로드에 실패했습니다';
                try{ const j=await r.json(); if(j.error) msg=j.error; }catch(e){}
                toast(msg,3200);
                return;
            }
            // 내용을 직접 받아서 저장한다 → 브라우저가 막지 않는다
            const blob=await r.blob();
            const obj=URL.createObjectURL(blob);
            const a=document.createElement('a');
            a.href=obj; a.download=name||'download';
            a.style.display='none';
            document.body.appendChild(a);
            a.click();
            setTimeout(()=>{ a.remove(); URL.revokeObjectURL(obj); },4000);
            toast('다운로드를 시작했습니다',1600);
        }catch(e){ toast('다운로드 실패',2000); }
    }

    async function vaultDelete(fid,kind,name,_skipConfirm){
        if(!_skipConfirm&&!confirm(`'${name}' 을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
        try{
            const r=await fetch('/api/files/delete',{
                method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({token:adminToken,id:fid})});
            if(r.status===403){
                if(await vaultAuthLost()) return vaultDelete(fid,kind,name,true);
                return;
            }
            const d=await r.json().catch(()=>({}));
            if(d.ok){
                vaultFiles=vaultFiles.filter(f=>f.id!==fid);
                vaultTotal=vaultFiles.reduce((t,f)=>t+(+f.bytes||0),0);
                if(vaultSel===fid) vaultSel=null;
                renderVault(); toast('삭제되었습니다',1600);
            }else toast('삭제 실패: '+(d.error||''),2400);
        }catch(e){ toast('삭제 실패',2000); }
    }

    // ===== 노트 안의 링크는 클릭해도 이동하지 않는다 =====
    // 글자를 긁어 복사하는 것이 우선. 링크로 가려면 Ctrl(⌘)+클릭.
    document.addEventListener('click',e=>{
        const a=e.target.closest&&e.target.closest('.tb-content a');
        if(!a) return;
        if(e.ctrlKey||e.metaKey) return;      // 일부러 이동하려는 경우만 허용
        e.preventDefault();
        e.stopPropagation();
    },true);

    // ===== 글자 복사는 '순수 텍스트'로만 =====
    // 링크(<a>)나 굵게(<b>) 등이 섞여 있어도, 다른 곳에 붙여넣을 때
    // 링크·서식이 따라가지 않고 눈에 보이는 글자만 복사되게 한다.
    document.addEventListener('copy',e=>{
        const sel=window.getSelection();
        if(!sel||sel.isCollapsed) return;
        const host=sel.anchorNode&&sel.anchorNode.parentElement
                 &&sel.anchorNode.parentElement.closest('.tb-content');
        if(!host) return;                      // 노트 글자가 아니면 건드리지 않음
        // tight(가져온 PDF) 상자는 절대좌표 스팬이라 sel.toString()이 뒤죽박죽 → 재조립
        const txt = host.closest('.tight') ? tightSelectionText(sel) : sel.toString();
        if(!txt) return;
        e.clipboardData.setData('text/plain',txt);
        e.clipboardData.setData('text/html',esc(txt));   // 서식·링크 제거
        e.preventDefault();
    });

    // 드래그 앤 드롭 업로드
    (function(){
        const dz=()=>document.getElementById('vaultDrop');
        document.addEventListener('dragover',e=>{
            const z=dz(); if(!z||document.getElementById('vaultModal').style.display!=='flex') return;
            if(e.target.closest('#vaultModal')){ e.preventDefault(); z.classList.add('over'); }
        });
        document.addEventListener('dragleave',e=>{
            const z=dz(); if(z&&!e.relatedTarget) z.classList.remove('over');
        });
        document.addEventListener('drop',e=>{
            const z=dz(); if(!z||document.getElementById('vaultModal').style.display!=='flex') return;
            if(e.target.closest('#vaultModal')){
                e.preventDefault(); z.classList.remove('over');
                if(e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files.length)
                    vaultUpload(e.dataTransfer.files);
            }
        });
    })();

    const ACCENT_COLORS=['#4f6ef7','#8b5cf6','#e0619b','#ef4444','#f59e0b','#10b981','#14b8a6','#0ea5e9','#111827'];
    function openSettings(){
        document.getElementById('setModal').style.display='flex';
        document.getElementById('darkTgl').classList.toggle('on',S.dark);
        document.getElementById('defPaper').value=S.defPaper;
        // 강조색 스와치
        const ap=document.getElementById('accentPicks');
        ap.innerHTML=ACCENT_COLORS.map(c=>
            `<div class="accent-swatch ${c===(S.accent||'#4f6ef7')?'on':''}" data-ac="${c}" style="background:${c}" title="${c}" onclick="pickAccent('${c}')"></div>`).join('');
        // 카드 크기 항목 제거됨
        // 배경화면 미리보기
        refreshWallUI();
        // 휴지통 개수
        updateTrashCount();
        openNav(closeSettings);
    }
    function closeSettings(){ document.getElementById('setModal').style.display='none'; navDrop(closeSettings); }

    // ===== 설정 옵션 동작 =====
    function pickAccent(c){
        S.accent=c; saveS(); applyTheme();
        try{ pushSettings(); }catch(e){}
        document.querySelectorAll('.accent-swatch').forEach(el=>el.classList.toggle('on',el.dataset.ac===c));
        renderGrid();
    }
    // 9.4 · 설정창에서는 없앴지만, 글상자 도구에서 크기를 바꾸면 여기로 들어온다
    function chDefFS(v){
        v=parseInt(v); if(!v||v<8) v=8; if(v>80) v=80;
        S.defFS=v; saveS();
        try{ pushSettings(); }catch(e){}
        const el=document.getElementById('defFSNum'); if(el) el.value=v;
    }
    // 설정을 전부 기본값으로 되돌린다 (노트 데이터는 건드리지 않음)
    function resetSettings(){
        if(!confirm('설정을 기본값으로 되돌릴까요?\n(노트·폴더·휴지통 데이터는 그대로 유지됩니다)')) return;
        S={dark:false, defPaper:'blank', defFS:16, defFont:'pretendard',
           accent:'#4f6ef7', appTitle:'', cardSize:'m', wall:'', wallVeil:34, wallVideo:false};
        saveS();
        try{ pushSettings(); }catch(e){}
        applyTheme();
        closeSettings();      // 현재 설정창을 닫고 히스토리 정리
        openSettings();       // 기본값이 반영된 설정창을 다시 연다
        renderGrid();
        toast('설정을 기본값으로 복원했습니다',2000);
    }

    // 같은 이름이 이미 있으면 '이름 (1)', '이름 (2)' … 로 (같은 폴더 기준)
    // 9.4 · 휴지통에 있는 노트는 이름 세기에서 뺀다.
    //   (예전엔 '새 노트'를 버려도 다음 노트가 '새 노트 (1)' 부터 시작해서
    //    번호가 영영 초기화되지 않았다 → 버린 노트는 없는 것으로 친다)
    function uniqueTitle(base,folderId,excludeId){
        base=(base||'새 노트').trim()||'새 노트';
        const fid=folderId===undefined?curFolder:folderId;
        const taken=new Set(
            notebooks.filter(n=>n.id!==excludeId && !isTrashed(n.id) && noteFolder(n.id)===fid)
                     .map(n=>(n.title||'새 노트').trim())
        );
        if(!taken.has(base)) return base;                 // 안 겹치면 그대로
        for(let i=1;i<1000;i++){
            const cand=`${base} (${i})`;
            if(!taken.has(cand)) return cand;
        }
        return `${base} (${Date.now().toString(36)})`;
    }


/* APP-PART:03-admin.js:END */
