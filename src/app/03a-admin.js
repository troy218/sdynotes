/* === src/app/03a-admin.js ===
   관리자 모드
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:03a-admin.js:BEGIN */
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
        // 열려 있는 버그 일지 목록도 관리자 여부에 맞춰 X 노출을 갱신한다
        try{ if(typeof bugRepaintIfOpen==='function') bugRepaintIfOpen(); }catch(e){}
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

/* APP-PART:03a-admin.js:END */
