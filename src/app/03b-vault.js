/* === src/app/03b-vault.js ===
   파일 보관함 · 링크/복사 · 설정 옵션
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:03b-vault.js:BEGIN */
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
        // 22.2 · 글자를 직접 복사했다 → 요소 클립보드의 붙여넣기 우선권 물리기
        try{ invalidateElsCopyForOsText(); }catch(_e){}
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
    // 14.47 · 설정창 테마 선택 UI 갱신 (프로/클래식 중 현재값에 .on)
    function paintThemePicks(){
        const wrap=document.getElementById('themePicks'); if(!wrap) return;
        const th=(typeof sdyTheme==='function')?sdyTheme():(S.theme||'pro');
        wrap.querySelectorAll('.theme-pick').forEach(b=>
            b.classList.toggle('on',b.dataset.theme===th));
    }
    function openSettings(){
        document.getElementById('setModal').style.display='flex';
        paintThemePicks();
        document.getElementById('defPaper').value=S.defPaper;
        // 강조색 스와치
        const ap=document.getElementById('accentPicks');
        ap.innerHTML=ACCENT_COLORS.map(c=>
            `<div class="accent-swatch ${c===(S.accent||'#4f6ef7')?'on':''}" data-ac="${c}" style="background:${c}" title="${c}" onclick="pickAccent('${c}')"></div>`).join('');
        // 카드 크기 항목 제거됨
        // 배경화면 미리보기
        refreshWallUI();
        // 휴지통 개수 · 버그 일지 개수
        updateTrashCount();
        paintBugCount();
        openNav(closeSettings);
    }
    function closeSettings(){ document.getElementById('setModal').style.display='none'; navDrop(closeSettings); }

    /* ===== 14.65 · 해돌이 '설정 안내' =====
       홈 검색창의 해돌이(help task)와 노트 안 해돌이(app task)가 **같은 글**을 근거로
       "설정에 무엇이 있는지 · 지금 무엇으로 되어 있는지 · 어디를 누르면 바뀌는지"를
       자세히 답한다. 설정 항목이 늘면 여기에 한 줄만 더하면 해돌이가 바로 안다.
       (모델은 여기 적힌 것만 사실로 말하도록 프롬프트에 못 박혀 있다) */
    const PAPER_NAME={blank:'빈 종이',lined:'줄 노트',grid:'격자',dotted:'도트'};
    function settingsGuideRows(){
        var themeNow='기본';
        try{ if(typeof sdyTheme==='function'&&sdyTheme()==='classic') themeNow='캐주얼'; }catch(e){}
        return [
            {name:'테마', keys:['테마','theme','기본','캐주얼','클래식','다크','라이트'], sel:'.theme-row',
             now:themeNow,
             how:'설정 → 테마에서 [기본(깔끔한 라이트)] 또는 [캐주얼(익숙한 편안한 화면)] 을 누르면 즉시 바뀝니다.'},
            {name:'강조색', keys:['강조색','포인트','accent'], sel:'.accent-row',
             now:String(S.accent||'#4f6ef7'),
             how:'설정 → 강조색에서 색 동그라미를 누르면 버튼·링크 등 앱 전체 포인트 색이 바뀝니다.'},
            {name:'배경화면', keys:['배경','배경화면','월페이퍼','wallpaper'], sel:'#setRowWall',
             now:(S.wall?(wallIsVideo()?'동영상 배경 사용 중':'사진 배경 사용 중'):'없음(기본 배경)'),
             how:'설정 → 배경화면 → [사진·동영상 선택] (캐주얼 테마에서만 보입니다). [지우기]를 누르면 기본 배경으로 돌아갑니다.'},
            {name:'기본 종이', keys:['종이','기본종이','줄','격자','도트','paper'], sel:'#defPaper',
             now:(PAPER_NAME[S.defPaper]||'빈 종이'),
             how:'설정 → 기본 종이에서 새 노트의 종이(빈 종이·줄 노트·격자·도트)를 고릅니다.'},
            {name:'휴지통', keys:['휴지통','삭제','복구'], sel:'#trashCount',
             now:(function(){ try{ return (notebooks||[]).filter(n=>n&&n.trash).length+'개'; }catch(e){ return '확인 중'; } })(),
             how:'설정 → 휴지통 → [보기]. 삭제한 노트는 30일 동안 보관되고 그 뒤 자동으로 지워집니다.'},
            {name:'버그 일지', keys:['버그','일지','신고'], sel:'#bugCount',
             now:(function(){ try{ return (typeof window.sdyBuglogCount==='function'?window.sdyBuglogCount():0)+'건'; }catch(e){ return '확인 중'; } })(),
             how:'설정 → 버그 일지 → [보기]. 노트에서 해돌이에게 "버그 신고: …"라고 말하면 정리되어 이곳에 쌓입니다.'},
            {name:'사용법·단축키', keys:['사용법','단축키','키','도움말'], sel:'#setRowKeys',
             now:'', how:'설정 → 사용법 · 단축키 → [열기] 에서 전체 단축키와 기능 안내를 봅니다.'},
            {name:'기본값 복원', keys:['초기화','기본값','리셋','복원'], sel:'#setRowReset',
             now:'', how:'설정 맨 아래 [기본값으로 복원] 을 누르면 테마·강조색·배경·종이·앱 제목이 처음 상태로 돌아갑니다.'}
        ];
    }
    // 설정 창 밖에 있는 것들 — 해돌이가 '어디서 하지?'를 답할 수 있게 함께 적어 둔다.
    const SETTINGS_ELSEWHERE=[
        ['음악·이퀄라이저','플레이어의 EQ 버튼(또는 홈 왼쪽 아래 음악 탭)에서 켜기·프리셋 10종(원음·베이스 부스트·보컬 강조·팝·록·힙합·R&B·클래식·재즈·일렉트로닉)·볼륨을 다룹니다. 말로도 됩니다 — "이퀄라이저 보컬 강조로 켜줘", "볼륨 70으로 해줘".'],
        ['곡 음량 자동 맞춤','곡마다 다른 음량은 서버가 송출할 때 자동으로 -14 LUFS 에 맞춥니다. 설정에 없는 항목이고 사용자가 고르는 옵션도 아닙니다.'],
        ['집중 화면(시계·스톱워치·타이머)','상단 시계 버튼 또는 "10분 타이머 맞춰줘" — 집중 화면 안에 셋이 함께 있습니다.'],
        ['지점 저장 / 지점 복원','노트 편집기의 더보기(⋯) 메뉴 → 지점 저장 으로 지금 상태를 남기고, 지점 복원 으로 그때로 되돌립니다.'],
        ['폴더 색·아이콘','폴더 카드를 우클릭(또는 ⋮) → 색 · 아이콘 변경. 고른 색은 홈 카드와 사이드바에 바로 반영됩니다.'],
        ['찾기·번역·내보내기','노트 편집기 도구에서 찾기(Ctrl+F), 자동 번역(쪽/문서), PDF 내보내기를 합니다.'],
        ['엽스코드(채팅)','상단 엽스코드 버튼 또는 "엽스코드 열어줘". 노트를 함께 보며 대화하는 공간입니다.'],
        ['알림','상단 종 버튼 — 읽지 않은 알림 개수가 배지로 붙고, 누르면 목록이 열립니다.']
    ];
    function settingsGuideText(){
        var lines=['[이 앱의 설정 — 이름 · 지금 값 · 바꾸는 법]'];
        settingsGuideRows().forEach(function(r){
            lines.push('- '+r.name+(r.now?(' · 지금: '+r.now):'')+' · '+r.how);
        });
        lines.push('');
        lines.push('[설정 창 밖의 주요 기능 — 어디서 하나]');
        SETTINGS_ELSEWHERE.forEach(function(it){ lines.push('- '+it[0]+' · '+it[1]); });
        return lines.join('\n');
    }
    /* 설정 창을 열고 이름이 맞는 줄로 이동한다 — 해돌이가 "@settings | 테마"
       처럼 항목까지 지정해 실행할 때 쓴다. 찾으면 항목 이름을, 못 찾으면 false 를
       돌려주어 호출한 쪽이 그냥 설정만 열 수 있게 한다. */
    function settingsJump(what){
        var q=String(what==null?'':what).trim().toLowerCase();
        if(!q) return false;
        var rows=settingsGuideRows();
        var hit=rows.find(function(r){ return r.name.toLowerCase()===q; })
             || rows.find(function(r){ return r.keys.some(function(k){ return q.indexOf(k)>=0; }); })
             || rows.find(function(r){ return r.name.toLowerCase().indexOf(q)>=0; });
        if(!hit) return false;
        try{ openSettings(); }catch(e){ return false; }
        try{
            var el=hit.sel?document.querySelector(hit.sel):null;
            var row=el&&el.closest?el.closest('.set-row'):null;
            if(row&&row.scrollIntoView) row.scrollIntoView({block:'center',behavior:'smooth'});
            if(row&&row.classList){
                row.classList.remove('set-row-hit');
                void row.offsetWidth;                    // 애니메이션 재시작
                row.classList.add('set-row-hit');
                setTimeout(function(){ try{ row.classList.remove('set-row-hit'); }catch(e){} },2200);
            }
        }catch(e){}
        return hit.name;
    }
    try{ window.sdySettingsGuideText=settingsGuideText; }catch(e){}
    try{ window.sdySettingsJump=settingsJump; }catch(e){}

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
        S={theme:'pro', defPaper:'blank', defFS:16, defFont:'pretendard',
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


/* APP-PART:03b-vault.js:END */
