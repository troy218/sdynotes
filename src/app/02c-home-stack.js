/* === src/app/02c-home-stack.js ===
   폴더 잠금 · 홈 스택 · 드래그 폴더
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:02c-home-stack.js:BEGIN */
    // ===== 폴더 잠금 =====
    const unlockedFolders=new Set();     // 이번 접속에서 연 폴더 (탭 닫으면 초기화)
    function folderById(fid){ return getFolders().find(f=>f.id===fid)||null; }
    function isFolderLocked(fid){ const f=folderById(fid); return !!(f&&f.lock&&f.lock.verifier); }
    function isFolderOpen(fid){ return !isFolderLocked(fid)||unlockedFolders.has(fid); }

    // 비밀번호 검증값 = PBKDF2 로 유도한 키로 고정 문자열을 암호화한 결과
    async function folderVerifier(pw,saltB64){
        const key=await deriveKey(pw,unb64(saltB64));
        const iv=new Uint8Array(12);                       // 검증용이므로 고정 IV
        const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,te.encode('sdy-folder-ok'));
        return b64(ct);
    }

    async function toggleFolderLock(fid){
        if(isTrashFolder(fid)){ toast('휴지통 폴더는 잠글 수 없습니다',2000); return; }
        const f=folderById(fid); if(!f) return;
        const all=getFolders();
        const t=all.find(x=>x.id===fid);
        if(isFolderLocked(fid)){
            if(!adminMode){
                // 해제하려면 현재 비밀번호 확인
                const pw=await askPassword('unlock','폴더 잠금 해제');
                if(!pw) return;
                const v=await folderVerifier(pw,t.lock.salt);
                if(v!==t.lock.verifier){ toast('비밀번호가 올바르지 않습니다',2000); return; }
            }
            delete t.lock;
            t.lockCleared=Date.now();   // 9.4 · '사용자가 직접 해제했다'는 표시 (동기화가 되살리지 않게)
            saveFolders(all);
            unlockedFolders.add(fid);
            renderGrid(); toast('폴더 잠금 해제됨 🔓');
            return;
        }
        // 9.1 · 남의 잠긴 노트를 내 폴더에 가둬 버리는 것을 막는다.
        //  폴더 안에 '내가 열지 못한 잠긴 노트'가 있으면 폴더 잠금을 거부한다.
        //  (그 노트 주인이 영영 못 여는 이중 잠금이 되기 때문)
        try{
            const inside=(notebooks||[]).filter(nb=>getCfg(nb.id).folder===fid);
            const blocked=inside.filter(nb=>isLocked(nb.id)&&!isUnlocked(nb.id));
            if(blocked.length){
                toast(`🔒 이 폴더에는 잠긴 노트 ${blocked.length}개가 있습니다. 먼저 그 노트를 열거나 밖으로 옮겨 주세요`,4000);
                return;
            }
        }catch(e){}
        const pw=await askPassword('set','폴더 잠그기');
        if(!pw) return;
        const salt=crypto.getRandomValues(new Uint8Array(16));
        const saltB64=b64(salt);
        t.lock={salt:saltB64, verifier:await folderVerifier(pw,saltB64), escrow:await makeEscrow(pw)};
        saveFolders(all);
        unlockedFolders.add(fid);          // 방금 잠근 사람은 계속 볼 수 있게
        renderGrid();
        toast('폴더가 잠겼습니다 🔒',2000);
    }

    async function tryOpenFolder(fid){
        if(isFolderOpen(fid)) return true;
        if(adminMode){ unlockedFolders.add(fid); adminOpenedFolders.add(fid); return true; }
        const t=folderById(fid);
        for(let i=0;i<3;i++){
            const pw=await askPassword('unlock','잠긴 폴더');
            if(!pw) return false;
            const v=await folderVerifier(pw,t.lock.salt);
            if(v===t.lock.verifier){ unlockedFolders.add(fid); return true; }
            toast('비밀번호가 올바르지 않습니다',1800);
        }
        return false;
    }

    function removeFolder(fid){
        if(isTrashFolder(fid)){ toast('휴지통 폴더는 삭제할 수 없습니다',2000); return; }
        // 잠긴 폴더(또는 잠긴 하위 폴더)는 관리자라도 삭제할 수 없다.
        // 먼저 잠금 자체를 해제해야 한다.
        if(folderTree(fid).some(id=>isFolderLocked(id))){
            toast('🔒 잠긴 폴더는 삭제할 수 없습니다. 먼저 폴더 잠금을 해제하세요',2800); return;
        }
        const c=folderCount(fid);
        const msg=c
            ? `폴더를 휴지통으로 보낼까요?\n안의 노트 ${c}개는 폴더 바깥으로 꺼내지며, 폴더를 복구하면 다시 함께 돌아옵니다.`
            : '폴더를 휴지통으로 보낼까요? 나중에 복구할 수 있습니다.';
        if(!confirm(msg)) return;
        const fc=document.querySelector('.folder-card[data-folder-id="'+fid+'"]');
        const finish=()=>{
            deleteFolder(fid);
            renderGrid(); updateTrashCount();
            toast('폴더는 휴지통으로 · 안의 노트는 폴더 밖으로 이동했습니다',2600);
        };
        if(fc) playClawThrow(fc, finish); else finish();
    }

    function _gridSig(){
        try{
            const folders=(!searchQuery?childFolders(curFolder):[]).map(f=>f.id+':'+(f.name||'')+':'+(folderCount(f.id)||0)).join('|');
            const notes=getFiltered().map(nb=>{
                const c=getCfg(nb.id);
                return [nb.id, nb.title||'', c.pinned?1:0, c.folder||'', c.trashed_at||'', c.emoji||''].join(':');
            }).join('|');
            const recent=(!searchQuery&&!curFolder&&!selectMode)?_getRecentIds().join(','):'';
            return (curFolder||'')+'/'+(searchQuery||'')+'/'+(selectMode?1:0)+'/'+folders+'/'+notes+'/'+recent;
        }catch(e){ return String(Date.now()); }
    }
    let _lastGridSig='';
    // ── 홈 재진입 레이아웃 ────────────────────────────────────────
    // 편집 후 돌아와도 새 노트 버튼과 두 노트 구역을 첫 화면에서 함께 보여 준다.
    let _homeEnterScroll=false;
    function _homeScrollEl(){
        const mv=document.getElementById('mainView');
        if(mv){
            const cs=getComputedStyle(mv);
            if((cs.overflowY==='auto'||cs.overflowY==='scroll')&&mv.scrollHeight>mv.clientHeight+2) return mv;
        }
        const de=document.scrollingElement||document.documentElement;
        return (de&&de.scrollHeight>de.clientHeight+2)?de:null;
    }
    // ── 16.1 · 홈에서만 쓰는 '이번 접속' 기록 ─────────────────────
    // 서버 설정·localStorage에는 쓰지 않는다. 노트를 열었다가 돌아오면
    // 아래 줄로 잠시 내려놓고, 새로 접속하면 다시 원래 스택으로 돌아온다.
    let _sessionRecentIds=[];
    function _getRecentIds(){ return _sessionRecentIds.slice(); }
    function _trackRecent(nbId){
        if(nbId==null||nbId==='') return;
        const id=String(nbId);
        _sessionRecentIds=_sessionRecentIds.filter(x=>String(x)!==id);
        _sessionRecentIds.unshift(id);
    }

    // 최근 노트가 생긴 홈은 두 줄이 현재 화면 높이에 꼭 맞도록 카드 폭을
    // 자동 계산한다. 위·아래 줄은 같은 높이를 쓰며, 사용자 카드 크기 설정은
    // 최대 크기로만 존중해 낮은 화면에서 줄이 잘리지 않게 한다.
    // 17.6 · 고정 상수(92) 대신 헤더~두 줄까지의 실제 높이를 전부 재서 뺀다.
    //   최근 제목이 복원된 뒤 버튼·제목·패딩이 옛 추정보다 높아져 두 줄이
    //   화면을 넘어 세로 스크롤바가 생기고 카드 아래가 잘렸었다. 이제
    //   chrome(헤더·패딩·버튼·그리드 여백) + 두 줄 = 화면 높이 가 정확히
    //   성립해 첫 화면에 꼭 들어오고, 카드도 아래 줄(제목+패딩+그림자)에
    //   들어맞는 크기로만 잡는다. 줄 높이의 자세한 값(--home-row-h)은
    //   CSS 의 음수 마진(17.7 기준 위 -14px · 아래 -60px)과 함께 클리핑
    //   경계를 카드 위로 넓혀 그림자 잘림을 없앤다. 그 마진·패딩은
    //   여기서 상수로 다시 쓰지 않고 계산값을 그대로 읽는다.
    function _fitHomeRows(area){
        if(!area||!area.classList.contains('has-recent')) return;
        const px=v=>{ const n=parseFloat(v); return isFinite(n)?n:0; };
        const de=document.scrollingElement||document.documentElement;
        const scrollEl=_homeScrollEl();
        // 레이아웃 px(엘리먼트 박스 단위)로만 재서 zoom/.9 등 배율과 무관하게 맞춘다.
        const vh=scrollEl?scrollEl.clientHeight:((de&&de.clientHeight)||(window.innerHeight||800));
        const header=document.querySelector('#mainView > .header');
        const headerH=header?(header.offsetHeight||header.getBoundingClientRect().height||0):0;
        const main=document.querySelector('#mainView > main');
        let bottomPad=0, topPad=0;
        try{ if(main){ const mcs=getComputedStyle(main); topPad=px(mcs.paddingTop); bottomPad=px(mcs.paddingBottom); } }catch(e){}
        // 떠 있는 음악바 여백까지 포함한 아래 패딩은 화면의 30%까지만 예약한다.
        bottomPad=Math.min(bottomPad,vh*.30);
        // 헤더~두 줄 사이·아래의 실제 높이를 전부 더해 chrome 으로 쓴다.
        let chrome=headerH+topPad+bottomPad;
        const grid=document.getElementById('noteGrid');
        if(grid) chrome+=px(getComputedStyle(grid).marginTop);
        chrome+=px(getComputedStyle(area).paddingBottom);
        const addZone=area.querySelector('.home-add-zone');
        if(addZone) chrome+=addZone.offsetHeight||0;
        // 두 줄 내부 여백은 줄 높이(border-box) 안에서 카드만 작아지게 한다.
        const scene=area.querySelector('.stack-scene');
        let scenePad=0;
        if(scene){ const scs=getComputedStyle(scene); scenePad=px(scs.paddingTop)+px(scs.paddingBottom); }
        const sec=area.querySelector('.recent-section');
        let secPT=0, titleH=0, rowPT=0, rowMT=0, rowMB=-60, nameH=52;
        if(sec){
            secPT=px(getComputedStyle(sec).paddingTop);
            const title=sec.querySelector('.recent-title');
            if(title&&getComputedStyle(title).display!=='none') titleH=title.offsetHeight||0;
            const row=sec.querySelector('.recent-row');
            if(row){
                const rcs=getComputedStyle(row);
                // 17.7 · 그림자 여유(패딩)와 그것을 상쇄하는 음수 마진은 CSS 가
                //   정한다. 여기서는 상수로 다시 쓰지 않고 실제 계산값을 읽어서
                //   패딩을 바꾸기만 해도 줄 높이가 따라오게 한다.
                rowPT=px(rcs.paddingTop);
                rowMT=px(rcs.marginTop); rowMB=px(rcs.marginBottom);
                const nameEl=row.querySelector('.note-card-name');
                if(nameEl) nameH=nameEl.offsetHeight||52;
            }
        }
        const rowsH=Math.max(280,Math.round(vh-chrome));
        const rowH=rowsH/2;
        const settingMax=document.body.classList.contains('card-s')?160:
                     (document.body.classList.contains('card-l')?244:200);
        const screenMax=Math.max(96,(window.innerWidth||1024)-56);
        // 카드(미리보기 1.3:1 + 이름 영역 + 테두리 2px)가 위 스택 줄과
        // 아래 최근 줄(제목·패딩·그림자 여유 포함) 모두에 들어가야 한다.
        const availScene=rowH-scenePad;
        // 제목 아래부터 카드 위까지의 실제 여백(음수 마진 + 위 패딩). 17.7 이전엔
        // 패딩 4px · 마진 0 이라 상수 4 였다.
        const rowTopGap=rowMT+rowPT;
        const availRecent=rowH-secPT-titleH-rowTopGap;
        const avail=Math.max(60,Math.min(availScene,availRecent));
        const cardW=Math.max(96,Math.min(settingMax,screenMax,Math.floor((avail-nameH-2)/1.30)));
        area.style.setProperty('--home-rows-h',rowsH+'px');
        area.style.setProperty('--home-card-w',cardW+'px');
        // CSS: 줄(border-box) = 남은 높이 - 위 마진 - 아래 마진.
        //   음수 마진(위 -14px · 아래 -60px)이 늘린 패딩을 그대로 도로 빼므로
        //   흐름 높이(= 두 줄 레이아웃)와 아래 오버플로는 그대로고, 클리핑
        //   경계만 위 14px · 좌우 18px 더 넓어져 카드 옆·위 그림자가 산다.
        area.style.setProperty('--home-row-h',Math.round(rowH-secPT-titleH-rowMT-rowMB)+'px');
    }

    // ── 홈 스택: 아래(폴더)에서 위(문서)로 한 장씩 오른쪽·위로 이동 ──
    function _stackTransforms(cards,fanned){
        const n=cards.length; if(!n) return;
        const mid=(n-1)/2;
        // 17.2 · 펼침 폭은 뷰포트가 아니라 스택 컨테이너(.note-stack) 너비를
        //   기준으로 정한다. 예전엔 창 전체 폭을 써서, 넓은 PC에서는 카드가
        //   화면 좌우 끝까지 흩어지고 좁은 폰에서는 넘쳤다.
        const container=cards[0].closest('.note-stack')||cards[0].parentElement;
        const cw=container?container.clientWidth:0;
        const cardW=Math.max(...cards.map(c=>c.offsetWidth||200));
        // 펼친 카드와 카드 사이의 빈 공간도 stack 컨테이너 안에 남겨야
        // 포인터가 좌우로 이동하는 동안 mouseleave가 나지 않는다.
        const corridorW=cw||Math.min(760,Math.max(cardW+48,(window.innerWidth||1024)-32));
        const available=Math.max(0,corridorW-cardW-48);
        // 모바일은 좌우로 덜 흩어지게, PC는 넉넉하게 (최대 230px)
        const isTouch=window.matchMedia&&window.matchMedia('(pointer:coarse)').matches;
        const maxSpread=isTouch?150:230;
        const spread=n>1?Math.min(maxSpread,available/(n-1)):0;
        const compact=!!(container&&container.closest('.home-stack-area.has-recent'));
        // 두 줄 모드에서는 카드가 많아져도 더미 자체가 한 줄 높이를 넘지 않게
        // 겹침 간격을 자동 압축한다.
        const compactX=n>1?Math.min(13,44/(n-1)):0;
        const compactY=n>1?Math.min(6,24/(n-1)):0;
        const fanY=n>1&&compact?Math.min(2.2,24/(n-1)):2.2;
        cards.forEach((c,i)=>{
            const off=i-mid;
            if(fanned){
                const x=off*spread;
                const y=off*fanY;
                const rot=Math.max(-22,Math.min(22,off*(compact?Math.min(4.2,30/Math.max(1,n-1)):4.2)));
                c.style.transform=`translate(-50%,-50%) translate3d(${x}px,${y}px,0) rotate(${rot}deg) scale(1)`;
                c.style.zIndex=i+1;
                c.style.opacity='1';
            }else{
                // item 순서 자체가 깊이 순서다: 폴더 → 문서.
                // 따라서 첫 카드(가장 아래)는 왼쪽 아래, 마지막 카드는 오른쪽 위다.
                const x=off*(compact?compactX:13);
                const y=off*(compact?-compactY:-6);
                const rot=off*(compact?Math.min(1.25,9/Math.max(1,n-1)):1.25);
                c.style.transform=`translate(-50%,-50%) translate3d(${x}px,${y}px,0) rotate(${rot}deg)`;
                c.style.zIndex=i+1;
                c.style.opacity='1';
            }
        });
    }
    function _layoutHomeStacks(){
        document.querySelectorAll('.home-stack-area.has-recent').forEach(_fitHomeRows);
        document.querySelectorAll('.note-stack').forEach(stack=>{
            const cards=Array.from(stack.children).filter(c=>
                c.classList.contains('note-card')||c.classList.contains('folder-card'));
            if(!cards.length) return;
            const compact=!!stack.closest('.home-stack-area.has-recent');
            const cardH=Math.max(...cards.map(c=>c.offsetHeight||300));
            // 두 줄 모드의 줄 높이는 CSS 변수로 고정한다. 일반 홈은 기존 높이 유지.
            if(!compact){
                const depth=Math.min(180,Math.max(0,(cards.length-1)*6));
                stack.style.height=Math.max(300,cardH+depth+30)+'px';
            }else stack.style.removeProperty('height');
            _stackTransforms(cards,stack.classList.contains('fanned'));
        });
    }
    function renderGrid(force){
        const g=document.getElementById('noteGrid');
        if(!g) return;
        const sig=_gridSig();
        if(!force && sig===_lastGridSig && g.querySelector('.home-stack-area,.note-card,.folder-card,.add-card')){
            // 17.4 · 홈에 재진입(변경 없이 돌아온 경우)도 아래쪽부터 보여 준다
            if(_homeEnterScroll) _homeEnterScroll=false;
            try{ requestAnimationFrame(()=>{ rescalePreviews(); _layoutHomeStacks(); }); }catch(e){}
            return;
        }
        _lastGridSig=sig;
        try{ cardObserver.disconnect(); }catch(e){}
        g.innerHTML='';
        renderBreadcrumb();

        /* 17.2 · 홈 스택 (복원)
           한 덩어리의 노트/폴더 카드를 화면 중앙에 살짝 겹쳐 쌓아 두고,
           마우스를 올리면(폰에서는 누르면) 부챗살처럼 펼쳐진다. 편집하고
           돌아오면(_trackRecent) 그 노트는 아래 '최근' 줄에 따로 놓인다.
           넓은 PC에서는 스택 영역에 최대 폭을 두어 카드가 한가운데
           알맞게 모이도록 CSS 로 잡았다. 폴더 안/검색 중/선택 모드에서는
           예전의 평범한 격자를 쓴다. */
        const isHomeStack=!curFolder && !searchQuery && !selectMode;
        const filtered=getFiltered();
        const recentIds=isHomeStack?_getRecentIds():[];
        const recentSet=new Set(recentIds.map(id=>String(id)));
        // 최상위 문서 중 이번 접속에 연 적이 없는 문서는 스택에 남긴다.
        const stackNotes=isHomeStack
            ?filtered.filter(nb=>!recentSet.has(String(nb.id)))
            :filtered;
        // 최근 문서는 폴더 안에서 열었더라도 홈의 두 번째 줄에 보여 준다.
        // 잠긴 폴더의 경로가 현재 접속에서 열려 있지 않으면 노출하지 않는다.
        const recentNotes=[];
        if(isHomeStack){
            const byId=new Map(notebooks.map(nb=>[String(nb.id),nb]));
            recentIds.forEach(id=>{
                const nb=byId.get(String(id));
                if(!nb||isTrashed(nb.id)) return;
                const fid=noteFolder(nb.id);
                if(fid){
                    const path=folderPath(fid);
                    if(!path.length||!path.every(f=>isFolderOpen(f.id))) return;
                }
                recentNotes.push(nb);
            });
        }

        // 폴더는 폴더 화면에서도, 홈 스택에서도 같은 카드 동작을 사용한다.
        function _makeFolderCard(f){
            const fc=document.createElement('div');
            fc.className='folder-card';
            fc.dataset.folderId=f.id;
            const fcol=f.color||'#4f6ef7';
            const fico=f.icon||'ri-folder-3-fill';
            const flock=isFolderLocked(f.id);
            const fopen=isFolderOpen(f.id);
            if(flock) fc.classList.add('locked-folder');
            fc.innerHTML=`
                <div class="folder-thumb" style="background:${hexA(fcol,.09)};">
                    <i class="${flock&&!fopen?'ri-folder-lock-fill':fico}" style="color:${fcol};filter:drop-shadow(0 4px 10px ${hexA(fcol,.32)});"></i>
                    ${flock&&fopen?`<span class="folder-lock" title="이번 접속에서 열림"><i class="ri-lock-unlock-line"></i></span>`:''}
                    ${flock&&!fopen?'':`<span class="folder-count" style="background:${fcol};">${folderCount(f.id)}</span>`}
                </div>
                <div class="note-card-name">
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span>
                    <i class="ri-more-2-fill folder-menu-btn" style="color:var(--text3);flex-shrink:0;margin-left:8px;padding:2px;border-radius:3px;"></i>
                </div>`;
            fc.onclick=(e)=>{
                if(lpFired){ lpFired=false; return; }
                if(e.target.closest('.folder-menu-btn')){ e.stopPropagation(); openFolderMenu(e,f.id); return; }
                if(!selectMode) openFolder(f.id);
            };
            fc.oncontextmenu=(e)=>{ e.preventDefault(); openFolderMenu(e,f.id); };
            // 노트를 끌어다 놓기
            fc.addEventListener('dragover',ev=>{ ev.preventDefault(); fc.classList.add('drop'); });
            fc.addEventListener('dragleave',()=>fc.classList.remove('drop'));
            fc.addEventListener('drop',ev=>{
                ev.preventDefault(); fc.classList.remove('drop');
                if(!isFolderOpen(f.id)){ toast('🔒 잠긴 폴더에는 넣을 수 없습니다',2000); return; }
                const ids=(ev.dataTransfer.getData('text/plain')||'').split(',').filter(Boolean);
                if(!ids.length) return;
                animateMoveLocal(ids, f.id, ()=>{
                    ids.forEach(id=>setNoteFolder(id,f.id));
                    cancelSelect(); renderGrid();
                    toast(`${ids.length}개 노트를 '${f.name}' 로 이동`);
                });
            });
            return fc;
        }

        // 홈에서는 폴더를 따로 앞에 놓지 않고, 아래쪽부터 시작하는 한 스택에 넣는다.
        // 폴더 → 문서 순서가 곧 카드의 깊이 순서이므로 문서가 항상 위에 놓인다.
        if(!searchQuery&&!isHomeStack){
            childFolders(curFolder).forEach(f=>g.appendChild(_makeFolderCard(f)));
        }
        function _makeCard(nb){
            const d=loadDoc(nb.id);
            const size=paperSize(d);
            const paperCls='paper-'+(d.paper||'blank');
            const cfgRaw=getCfg(nb.id);
            const hasLock=!!(cfgRaw.lock&&cfgRaw.lock.enc);
            const opened=hasLock&&isUnlocked(nb.id);
            const locked=hasLock&&!opened;
            const adminSeen=hasLock&&adminMode;
            const pinned=!!cfgRaw.pinned;
            const card=document.createElement('div');
            card.className='note-card'+(locked?' locked':'');
            card.dataset.nbId=nb.id;
            if(selectedNBs.has(nb.id)) card.classList.add('selected');
            const nPages=(d.pages||[]).length;
            card.innerHTML=`
                <div class="select-check"><i class="ri-check-line"></i></div>
                <div class="emoji-badge ${d.emoji?'has-emoji':''}" onclick="event.stopPropagation();toggleEmojiPicker(event.currentTarget)">${d.emoji||'<span style="font-size:16px;opacity:.35;">◌</span>'}</div>
                <div class="emoji-picker">${buildEmojiPicker(nb.id)}</div>
                <div class="note-preview" data-bw="${size.w}" data-bh="${size.h}">
                    <div class="note-preview-frame" style="width:${size.w}px;height:${size.h}px;"></div>
                    ${nPages>1&&!locked?`<div class="page-count-badge">${nPages}p</div>`:''}
                    ${isAdminEdited(nb.id)?'<div class="admin-verified" title="관리자가 검수·수정한 노트"><i class="ri-verified-badge-fill"></i></div>':''}
                </div>
                ${locked?'<div class="lock-overlay"><i class="ri-lock-2-fill"></i><span>잠김</span></div>':''}
                ${opened?`<div class="unlock-badge" title="${adminSeen?'관리자 권한으로 열림':'이번 접속에서 잠금 해제됨'}"><i class="${adminSeen?'ri-shield-check-fill':'ri-lock-unlock-line'}"></i></div>`:''}
                ${pinned?'<div class="pin-badge"><i class="ri-pushpin-2-fill"></i></div>':''}
                <div class="card-menu" title="메뉴"><i class="ri-more-2-fill"></i></div>
                <div class="note-card-name">
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nb.title||'새 노트')}</span>
                    <span class="live-dot" data-nb="${nb.id}" style="display:none;flex-shrink:0;margin-left:8px;font-size:10.5px;font-weight:700;color:#059669;">●</span>
                </div>`;
            const startLP=(ev)=>{
                clearTimeout(longPressTimer);
                longPressTimer=setTimeout(()=>{
                    lpFired=true;
                    if(selectMode&&selectedNBs.has(nb.id)){
                        beginLiftDrag(ev,card,nb);
                    }else{
                        enterSelectMode(nb.id);
                        if(navigator.vibrate) navigator.vibrate(18);
                    }
                },480);
            };
            card.addEventListener('pointerdown',startLP);
            card.addEventListener('pointerup',()=>clearTimeout(longPressTimer));
            card.addEventListener('pointerleave',()=>clearTimeout(longPressTimer));
            card.addEventListener('touchstart',startLP,{passive:true});
            card.addEventListener('touchend',()=>clearTimeout(longPressTimer));
            card.addEventListener('touchmove',()=>clearTimeout(longPressTimer),{passive:true});
            const touchScreen=window.matchMedia&&window.matchMedia('(pointer:coarse)').matches;
            card.draggable=!touchScreen;
            card.addEventListener('dragstart',ev=>{
                clearTimeout(longPressTimer);
                try{ window.getSelection().removeAllRanges(); }catch(e){}
                const ids=selectMode&&selectedNBs.size?Array.from(selectedNBs):[nb.id];
                ev.dataTransfer.setData('text/plain',ids.join(','));
                ev.dataTransfer.effectAllowed='move';
                try{
                    const img=new Image();
                    img.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                    ev.dataTransfer.setDragImage(img,0,0);
                }catch(e){}
                card.classList.add('dragging');
            });
            card.addEventListener('dragend',()=>{ card.classList.remove('dragging'); try{ window.getSelection().removeAllRanges(); }catch(e){} });
            card.querySelector('.card-menu').onclick=(e)=>{ e.stopPropagation(); openCardMenu(e,nb); };
            card.oncontextmenu=(e)=>{ e.preventDefault(); openCardMenu(e,nb); };
            card.onclick=(e)=>{
                if(lpFired){ lpFired=false; e.stopPropagation(); return; }
                if(selectMode){ e.stopPropagation(); toggleSelectNB(nb.id,card); }
                else openNB(nb);
            };
            card._render=async()=>{
                if(locked) return;
                const f=card.querySelector('.note-preview-frame');
                if(!f||f.dataset.done==='1'||f.dataset.loading==='1') return;
                f.dataset.loading='1';
                try{
                    let rd=d, rs=size, rp=paperCls;
                    const first=rd.pages&&rd.pages[0];
                    const empty=!first||(!(first.els||[]).length&&!(first.tables||[]).length);
                    if(empty&&(cfgRaw.serverDoc||cfgRaw.__ref)){
                        const got=await loadPreviewDoc(nb.id);
                        if(!got) throw new Error('preview unavailable');
                        rd=got; rs=paperSize(got); rp='paper-'+(got.paper||'blank');
                    }
                    if(!card.isConnected) return;
                    const pv=card.querySelector('.note-preview');
                    pv.dataset.bw=rs.w; pv.dataset.bh=rs.h;
                    f.style.width=rs.w+'px'; f.style.height=rs.h+'px';
                    f.innerHTML=renderPageStatic((rd.pages&&rd.pages[0])||blankPage(),rs,rp);
                    f.dataset.done='1';
                    rescaleOne(pv);
                }catch(e){
                    card._previewTry=(card._previewTry||0)+1;
                    f.innerHTML='<div style="padding:24px;color:var(--text3);font-size:12px">미리보기를 다시 불러오는 중…</div>';
                    if(card._previewTry<=3)
                        setTimeout(()=>{ if(f&&card.isConnected){ delete f.dataset.loading; card._render&&card._render(); } },900*card._previewTry);
                    else f.innerHTML='<div style="padding:24px;color:var(--text3);font-size:12px">노트를 열면 본문을 다시 불러옵니다</div>';
                    return;
                }finally{ delete f.dataset.loading; }
            };
            cardObserver.observe(card);
            return card;
        }

        if(isHomeStack){
            const area=document.createElement('div');
            area.className='home-stack-area';

            // 새 노트 동작과 현재 노트 구역 제목을 한 줄에 정돈한다.
            const upper=document.createElement('div');
            upper.className='home-stack-upper';
            const zone=document.createElement('div');
            zone.className='home-add-zone';
            const homeTitle=document.createElement('h2');
            homeTitle.className='home-section-title';
            homeTitle.innerHTML='<i class="ri-stack-line"></i><span>내 노트</span>';
            zone.appendChild(homeTitle);
            const add=document.createElement('button');
            add.type='button';
            add.className='home-add-note';
            add.setAttribute('aria-label','새 노트 만들기');
            add.innerHTML='<span class="home-add-icon"><i class="ri-add-line"></i></span><span>새 노트 만들기</span>';
            add.onclick=openCreateModal;
            zone.appendChild(add);
            upper.appendChild(zone);

            const scene=document.createElement('div');
            scene.className='stack-scene';
            const stackWrap=document.createElement('div');
            stackWrap.className='note-stack';
            const stackCards=[];
            const stackItems=childFolders(null).map(f=>({kind:'folder',value:f}))
                .concat(stackNotes.map(nb=>({kind:'note',value:nb})));
            stackWrap.dataset.count=String(stackItems.length);
            stackItems.forEach(item=>{
                const card=item.kind==='folder'?_makeFolderCard(item.value):_makeCard(item.value);
                stackWrap.appendChild(card);
                stackCards.push(card);
            });
            if(!stackCards.length){
                const empty=document.createElement('div');
                empty.className='stack-empty';
                empty.innerHTML='<i class="ri-stack-line"></i><span>노트를 만들면 이곳에 쌓여요</span>';
                stackWrap.appendChild(empty);
            }

            const layoutStack=()=>{
                if(!stackCards.length){
                    stackWrap.style.height='220px';
                    return;
                }
                _layoutHomeStacks();
            };
            requestAnimationFrame(layoutStack);
            setTimeout(layoutStack,120);

            let fanTimer=null;
            const fanIn=()=>{
                clearTimeout(fanTimer);
                upper.classList.add('fanned');
                stackWrap.classList.add('fanned');
                _stackTransforms(stackCards,true);
            };
            const fanOut=()=>{
                clearTimeout(fanTimer);
                fanTimer=setTimeout(()=>{
                    upper.classList.remove('fanned');
                    stackWrap.classList.remove('fanned');
                    _stackTransforms(stackCards,false);
                },180);
            };
            // 접힌 스택은 노트 자체를 정확히 가리킬 때만 펼친다. 펼친 뒤에는
            // stackWrap 전체가 선택 통로가 되어 카드 사이를 좌우로 건너도 접히지 않는다.
            const stackCardAt=e=>{
                const card=e.target.closest?.('.note-card,.folder-card');
                return card&&stackWrap.contains(card);
            };
            stackWrap.addEventListener('mouseover',e=>{ if(stackCardAt(e)) fanIn(); });
            stackWrap.addEventListener('mouseleave',fanOut);
            stackWrap.addEventListener('touchstart',e=>{ if(stackCardAt(e)) fanIn(); },{passive:true});
            scene.addEventListener('touchend',e=>{
                if(!e.target.closest('.note-card,.folder-card')) fanOut();
            },{passive:true});
            scene.appendChild(stackWrap);
            upper.appendChild(scene);
            area.appendChild(upper);

            // 아래 구역은 이번 접속에서 편집한 문서를 별도 제목과 함께 보여 준다.
            if(recentNotes.length){
                const sec=document.createElement('div');
                sec.className='recent-section';
                const recentTitle=document.createElement('h2');
                recentTitle.className='home-section-title recent-title';
                recentTitle.textContent='최근 편집';
                sec.appendChild(recentTitle);
                const row=document.createElement('div');
                row.className='recent-row';
                recentNotes.forEach(nb=>row.appendChild(_makeCard(nb)));
                sec.appendChild(row);
                area.appendChild(sec);
            }

            g.appendChild(area);
            if(recentNotes.length){
                // 두 구역 높이를 맞추되 상단 동작 버튼은 처음부터 보이게 둔다.
                area.classList.add('has-recent');
                _fitHomeRows(area);
                _homeEnterScroll=false;
            }else{
                _homeEnterScroll=false;
            }
            _schedulePreviewRender(area);
        }else{
            filtered.forEach(nb=>{ g.appendChild(_makeCard(nb)); });
            if(!selectMode){
                const add=document.createElement('div');
                add.className='add-card';
                add.innerHTML='<i class="ri-add-line" style="font-size:38px;opacity:.8"></i>';
                add.onclick=openCreateModal;
                g.appendChild(add);
            }
            _schedulePreviewRender(g);
        }
    }

    // IntersectionObserver는 초기에 컨테이너가 display:none 이거나 첫 layout 전이면
    // 첫 콜백을 늦게/아예 주지 않는 WebView가 있다. 관찰자는 스크롤 lazy-load에
    // 그대로 쓰되, mount 직후 RAF(레이아웃 뒤)와 짧은 fallback에서 화면 근처 카드를
    // 명시적으로 깨운다. 같은 카드의 _render는 loading/done으로 멱등 보호된다.
    function _schedulePreviewRender(root){
        const run=()=>{
            if(!root||!root.isConnected) return;
            const vh=window.innerHeight||document.documentElement.clientHeight||800;
            root.querySelectorAll('.note-card').forEach((c,i)=>{
                if(!c._render) return;
                let r=null;
                try{ r=c.getBoundingClientRect(); }catch(e){}
                const unmeasured=!r||(!r.width&&!r.height&&!r.top&&!r.bottom);
                if((unmeasured&&i<12)||(r&&r.bottom>-300&&r.top<vh+500)) c._render();
            });
            rescalePreviews();
        };
        // 한 번은 DOM mount 직후, 한 번은 CSS/layout 확정 뒤 실행한다.
        requestAnimationFrame(()=>{ run(); requestAnimationFrame(run); });
        setTimeout(run,140);
    }

    const cardObserver=new IntersectionObserver((ents)=>{
        ents.forEach(en=>{ if(en.isIntersecting&&en.target._render){ en.target._render(); cardObserver.unobserve(en.target); } });
    },{rootMargin:'300px 0px'});

    function rescaleOne(pv){
        if(!pv) return;
        const f=pv.querySelector('.note-preview-frame'); if(!f) return;
        const bw=parseFloat(pv.dataset.bw)||800, bh=parseFloat(pv.dataset.bh)||1100;
        const cw=pv.clientWidth, ch=pv.clientHeight;
        if(!cw||!ch) return;
        const sc=Math.min(cw/bw, ch/bh);
        f.style.transform=`scale(${sc})`;
        f.style.left=Math.round((cw-bw*sc)/2)+'px';
        f.style.top=Math.round((ch-bh*sc)/2)+'px';
    }

    function rescalePreviews(){
        document.querySelectorAll('.note-preview').forEach(pv=>{
            const f=pv.querySelector('.note-preview-frame'); if(!f) return;
            const bw=parseFloat(pv.dataset.bw)||800, bh=parseFloat(pv.dataset.bh)||1100;
            const cw=pv.clientWidth, ch=pv.clientHeight;
            if(!cw||!ch) return;
            const s=Math.min(cw/bw, ch/bh);   // 가로세로 동일 배율 → 비율 보존
            f.style.transform=`scale(${s})`;
            f.style.left=Math.round((cw-bw*s)/2)+'px';
            f.style.top=Math.round((ch-bh*s)/2)+'px';
        });
    }
    window.addEventListener('resize',()=>{ rescalePreviews(); _layoutHomeStacks(); layoutPages(); });


    // ===== 꾹 눌러 집어서 폴더로 끌어놓기 (마우스/터치 공용) =====
    let lift=null;
    let lpFired=false;      // 롱프레스가 방금 실행됨 → 직후 클릭 1회 무시
    function beginLiftDrag(ev,card,nb){
        const ids=selectedNBs.size?Array.from(selectedNBs):[nb.id];
        const pt=ev.touches?ev.touches[0]:ev;
        const ghost=document.createElement('div');
        ghost.id='liftGhost';
        ghost.innerHTML=`<i class="ri-file-copy-2-fill"></i> ${ids.length}개 노트`;
        ghost.style.cssText='position:fixed;z-index:900;pointer-events:none;padding:10px 16px;'+
            'background:var(--accent);color:#fff;border-radius:4px;font-size:13px;font-weight:600;'+
            'box-shadow:0 10px 30px rgba(0,0,0,.28);display:flex;align-items:center;gap:7px;'+
            'transform:translate(-50%,-50%) scale(.9);transition:transform .12s;';
        document.body.appendChild(ghost);
        requestAnimationFrame(()=>ghost.style.transform='translate(-50%,-50%) scale(1)');
        lift={ids,ghost};
        // 네이티브 HTML5 드래그가 시작되면 mousemove/mouseup 이 끊겨 고스트가 남는다 → 잠시 끈다
        document.querySelectorAll('.note-card').forEach(c=>c.draggable=false);
        moveLift(pt.clientX,pt.clientY);
        if(navigator.vibrate) navigator.vibrate(26);
        toast('폴더 위에 놓으면 이동됩니다',1600);
        document.body.style.userSelect='none';
    }
    function moveLift(x,y){
        if(!lift) return;
        // 고스트는 fixed — style.left/top 에는 화면 px 가 아니라 CSS px 를 넣는다
        lift.ghost.style.left=window.sdyUiCss(x)+'px';
        lift.ghost.style.top=window.sdyUiCss(y)+'px';
        document.querySelectorAll('.folder-card').forEach(f=>f.classList.remove('drop'));
        const el=document.elementFromPoint(x,y);
        const fc=el&&el.closest?el.closest('.folder-card'):null;
        if(fc) fc.classList.add('drop');
        lift.over=fc;
    }
    function endLift(){
        if(!lift) return;
        const {ids,over}=lift;
        try{ lift.ghost.remove(); }catch(e){}
        try{ window.getSelection().removeAllRanges(); }catch(e){}   // 드래그 중 생긴 텍스트 선택 제거
        // 혹시 남아 있을 고스트까지 모두 제거
        document.querySelectorAll('#liftGhost').forEach(g=>g.remove());
        document.querySelectorAll('.folder-card').forEach(f=>f.classList.remove('drop'));
        document.body.style.userSelect='';
        document.querySelectorAll('.note-card').forEach(c=>c.draggable=true);
        lift=null;
        clearTimeout(longPressTimer);
        if(over){
            const fid=over.dataset.folderId;
            const f=getFolders().find(x=>x.id===fid);
            if(!isFolderOpen(fid)){
                toast('🔒 잠긴 폴더에는 넣을 수 없습니다',2000);
                cancelSelect(); renderGrid();
                return;
            }
            // 파일 이동도 생성/삭제와 같은 금속 집게를 쓴다 (1개·여러 개 모두).
            animateMoveLocal(ids, fid, ()=>{
                ids.forEach(id=>setNoteFolder(id,fid));
                cancelSelect(); renderGrid();
                toast(`${ids.length}개 노트를 '${f?f.name:'폴더'}' 로 이동`);
            });
            return;
        }
        // 폴더에 넣든 취소하든 항상 선택 모드 해제 (선택바가 남지 않게)
        cancelSelect();
        renderGrid();
    }
    // 어떤 경로로 끝나든 고스트가 남지 않도록 모든 종료 이벤트를 잡는다
    // ★ pointermove/pointerup 로 통합 — 터치 장치에서 즉시 반응
    document.addEventListener('pointermove',e=>{ if(lift) moveLift(e.clientX,e.clientY); });
    document.addEventListener('pointerup',()=>{ if(lift) endLift(); });
    document.addEventListener('touchmove',e=>{
        if(lift){ e.preventDefault(); const t=e.touches[0]; moveLift(t.clientX,t.clientY); }
    },{passive:false});
    document.addEventListener('touchend',()=>{ if(lift) endLift(); });
    document.addEventListener('touchcancel',()=>{ if(lift) endLift(); });
    document.addEventListener('pointercancel',()=>{ if(lift) endLift(); });
    document.addEventListener('dragstart',e=>{ if(lift){ e.preventDefault(); } });
    document.addEventListener('dragend',()=>{ if(lift) endLift(); try{ window.getSelection().removeAllRanges(); }catch(e){} });
    window.addEventListener('blur',()=>{ if(lift) endLift(); });
    document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&lift) endLift(); });


/* APP-PART:02c-home-stack.js:END */
