/* === src/app/02a-home-shell.js ===
   홈 배경 · 앱설정 · 동기화 로딩바 · 슬라이스 로드
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:02a-home-shell.js:BEGIN */
    // ===== 9.4 · 홈 화면 배경 사진 =====
    function wallIsVideo(){
        return S.wallVideo===true || /\.(mp4|webm|mov)([?#]|$)/i.test(S.wall||'') || /\/video\/upload\//.test(S.wall||'');
    }
    function applyWallpaper(){
        const el=document.getElementById('wallLayer');
        if(!el) return;
        const url=S.wall||'';
        document.body.classList.toggle('has-wall',!!url);
        const isVideo=url?wallIsVideo():false;
        el.style.backgroundImage=(!url||isVideo)?'':`url("${url}")`;
        const v=document.getElementById('wallVideo');
        if(v){
            if(isVideo){
                if(v.getAttribute('src')!==url) v.src=url;
                v.style.display='block';
                try{ v.play().catch(()=>{}); }catch(e){}
            }else{
                try{ v.pause(); }catch(e){}
                v.removeAttribute('src'); try{ v.load(); }catch(e){}
                v.style.display='none';
            }
        }
        const veil=(S.wallVeil===undefined?34:+S.wallVeil)/100;
        document.documentElement.style.setProperty('--wall-veil',String(veil));
    }
    async function pickWallpaper(file){
        if(!file) return;
        const isVideo=(file.type||'').indexOf('video/')===0||/\.(mp4|webm|mov)$/i.test(file.name||'');
        const isImg=/^image\//.test(file.type||'')||/\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(file.name||'');
        if(!isVideo&&!isImg){
            toast('사진(JPG·PNG·WEBP) 또는 동영상(MP4) 파일만 올릴 수 있어요',2600); return;
        }
        const cap=isVideo?40:12; // MB
        if(file.size>cap*1024*1024){ toast((isVideo?'40MB 이하 동영상':'12MB 이하 사진')+'만 올릴 수 있어요',2600); return; }
        toast('배경 올리는 중…',1500);
        const fd=new FormData(); fd.append('file',file);
        try{
            const r=await fetch('/api/wallpaper/upload',{method:'POST',body:fd});
            const d=await r.json();
            if(!r.ok||!d.ok){ toast('배경 업로드 실패: '+(d.error||''),2800); return; }
            S.wall=d.url; S.wallVideo=(d.kind==='video'); saveS(); applyWallpaper();
            try{ pushSettings(); }catch(e){}      // 다른 기기에도 같은 배경
            refreshWallUI();
            toast('배경화면을 바꿨습니다 '+(d.kind==='video'?'🎬':'🖼️'),1800);
        }catch(e){ toast('배경 업로드 실패',2200); }
    }
    function clearWallpaper(){
        S.wall=''; S.wallVideo=false; saveS(); applyWallpaper();
        try{ pushSettings(); }catch(e){}
        refreshWallUI();
        toast('기본 배경으로 되돌렸습니다',1600);
    }
    function refreshWallUI(){
        const p=document.getElementById('wallPrev');
        if(p){
            if(S.wall&&wallIsVideo()){
                p.style.backgroundImage='';
                p.textContent='▶';
                p.style.display='flex'; p.style.alignItems='center'; p.style.justifyContent='center';
                p.style.color='#fff'; p.style.background='linear-gradient(135deg,#3a3f4b,#1f232b)';
                p.style.fontSize='16px';
            }else{
                p.style.backgroundImage=S.wall?`url("${S.wall}")`:'';
                p.textContent=''; p.style.color=''; p.style.background=''; p.style.fontSize='';
            }
        }
        const rm=document.getElementById('wallRmBtn');
        if(rm) rm.style.display=S.wall?'':'none';
    }
    function tglDark(){S.dark=!S.dark;saveS();applyTheme();document.getElementById('darkTgl').classList.toggle('on',S.dark);renderGrid();
        try{ pushSettings(); }catch(e){}}

    // ── 앱 전체 설정 동기화 ────────────────────────────────
    // 테마·강조색·기본 글꼴/크기·제목·카드 크기와 함께 브라우저에서
    // 기억하던 작은 UI 상태도 한 묶음으로 동기화한다.
    const APPSET_KEYS=['defPaper','defFS','defFont','accent','appTitle','cardSize','wall','wallVeil','wallVideo'];
    function _readJsonLS(k,dflt){ try{ const x=JSON.parse(localStorage.getItem(k)||'null'); return x==null?dflt:x; }catch(e){ return dflt; } }
    function _uiSetPayload(){
        return {
            dark:!!S.dark,
            guides:localStorage.getItem('sdy_guides')==='1',
            sepia:localStorage.getItem('sdy_sepia')==='1',
            side:localStorage.getItem('sdy_side')!=='0',
            vaultView:localStorage.getItem('sdy_vault_view')||'grid',
            focus:_readJsonLS('sdy_focus_mode',{}),
            positions:{
                music:_readJsonLS('mp_pos',null),
                musicBig:_readJsonLS('mp_big_pos',null),
                cards:_readJsonLS('fcard_pos',null)
            },
            // 14.14 · 기기 사이로는 '재생 환경'만 나눈다.
            //   대기열·현재곡·재생 위치까지 동기화하면, 다른 탭/기기의 오래된 상태가
            //   지금 듣고 있는 곡을 대기열 첫 곡으로 되돌려 버린다. (곡은 각 기기의 것)
            music:{
                repeat:+(localStorage.getItem('mp_repeat')||0),
                shuffle:localStorage.getItem('mp_shuffle')==='1',
                rate:+(localStorage.getItem('mp_rate')||1),
                vol:+(localStorage.getItem('mp_vol')||100)
            }
        };
    }
    function _appSetPayload(){
        const o={};
        // 'wall' 은 빈 값도 뜻이 있는 값이라 배경 삭제가 전달되어야 한다.
        const KEEP_EMPTY={wall:1};
        APPSET_KEYS.forEach(k=>{
            if(S[k]===undefined) return;
            if(S[k]===''&&!KEEP_EMPTY[k]) return;
            o[k]=S[k];
        });
        o.ui=_uiSetPayload();
        return o;
    }
    function _appSetApply(d){
        if(!d||typeof d!=='object') return false;
        let ch=false;
        APPSET_KEYS.forEach(k=>{
            if(d[k]!==undefined && JSON.stringify(S[k])!==JSON.stringify(d[k])){
                S[k]=d[k]; ch=true;
            }
        });
        const ui=(d.ui&&typeof d.ui==='object')?d.ui:null;
        if(ui){
            if(ui.dark!==undefined && !!S.dark!==!!ui.dark){ S.dark=!!ui.dark; ch=true; }
            const put=(k,v)=>{ if(v!==undefined&&v!==null) localStorage.setItem(k,String(v)); };
            put('sdy_guides',ui.guides?'1':'0');
            put('sdy_sepia',ui.sepia?'1':'0');
            put('sdy_side',ui.side===false?'0':'1');
            if(ui.vaultView) put('sdy_vault_view',ui.vaultView);
            if(ui.focus) localStorage.setItem('sdy_focus_mode',JSON.stringify(ui.focus));
            if(ui.positions){
                if(ui.positions.music) localStorage.setItem('mp_pos',JSON.stringify(ui.positions.music));
                if(ui.positions.musicBig) localStorage.setItem('mp_big_pos',JSON.stringify(ui.positions.musicBig));
                if(ui.positions.cards) localStorage.setItem('fcard_pos',JSON.stringify(ui.positions.cards));
                try{ if(window.sdyApplyMusicPositions) window.sdyApplyMusicPositions(ui.positions); }catch(e){}
            }
            if(ui.music){
                // 14.14 · 원격에서 받는 건 반복·섞기·배속·음량 뿐이다.
                //   sdy_music_state(내 대기열·현재곡·재생 위치)는 절대 덮어쓰지 않는다.
                //   (탭을 옮겼다 돌아오면 대기열 첫 곡으로 튀던 버그의 원인)
                if(ui.music.repeat!==undefined) put('mp_repeat',ui.music.repeat);
                if(ui.music.shuffle!==undefined) put('mp_shuffle',ui.music.shuffle?'1':'0');
                if(ui.music.rate!==undefined) put('mp_rate',ui.music.rate);
                if(ui.music.vol!==undefined) put('mp_vol',ui.music.vol);
                try{ if(window.sdyApplyMusicPrefs) window.sdyApplyMusicPrefs(ui.music); }catch(e){}
            }
            // 이미 열린 편집 화면에도 UI 토글을 즉시 반영한다.
            try{
                if(typeof guidesOn!=='undefined'){
                    guidesOn=!!ui.guides;
                    const st=document.getElementById('pagesStage'); if(st) st.classList.toggle('guides',guidesOn);
                    const gb=document.getElementById('guideBtn'); if(gb) gb.classList.toggle('active',guidesOn);
                }
                if(typeof sepiaOn!=='undefined'){
                    sepiaOn=!!ui.sepia;
                    const eb=document.getElementById('editorBody'); if(eb) eb.style.filter=sepiaOn?'sepia(.22) saturate(.92) brightness(.98)':'';
                    const sb=document.getElementById('sepiaBtn'); if(sb) sb.classList.toggle('active',sepiaOn);
                }
                if(typeof sideOpen!=='undefined'){
                    sideOpen=ui.side!==false;
                    const ev=document.getElementById('editorView'); if(ev) ev.classList.toggle('side-off',!sideOpen);
                }
            }catch(e){}
        }
        if(!ch && !ui) return false;
        saveS(); applyTheme();
        return true;
    }

    // ============ 동기화 로딩바 ============
    let syncCount=0;
    function setSyncPct(p){
        if(!document) return;   // 창이 닫힌 뒤 남은 타이머 — DOM 이 없으면 그냥 무시
        const f=document.getElementById('syncFill');
        if(f) f.style.width=Math.max(0,Math.min(100,p))+'%'; }
    function syncStart(){ syncCount++; const b=document.getElementById('syncBar');
        b.classList.add('on'); setSyncPct(35); }
    function syncEnd(){ syncCount=Math.max(0,syncCount-1);
        if(!syncCount){ setSyncPct(100);
            setTimeout(()=>{
                if(!document) return;   // 창이 닫힌 뒤의 잔여 타이머 방어
                const b=document.getElementById('syncBar');
                if(b){ b.classList.remove('on'); setSyncPct(0); }
            },450); } }

    // 14.29.4 · 노트 설정(nb_*) 파싱 캐시 (한 칸)
    //   큰 노트를 열 때 getCfg 가 같은 노트에 대해 여러 번 불린다
    //   (openNB · isLocked · loadDocAsync · migrate · updateLockUI …).
    //   본문(pages)이 들어 있는 수 MB JSON 을 그때마다 다시 파싱하면
    //   느린 기기에서 이것만으로 몇 초가 날아간다.
    //   → 저장된 '원문 문자열'이 그대로면 파싱 결과를 재사용한다.
    //     (문자열 비교는 파싱보다 수십 배 싸다. 저장이 일어나면 원문이
    //      달라지므로 캐시는 자동으로 무효가 된다 — 다른 탭/기기의 변경도 안전)
    //   반환은 항상 얕은 복사본이라, 호출부가 최상위 필드를 고쳐도
    //   캐시(=디스크 내용)가 오염되지 않는다.
    let _cfgCacheId=null,_cfgCacheRaw=null,_cfgCacheObj=null;
    function _cfgRaw(id){ try{ return localStorage.getItem('nb_'+id)||'{}'; }catch(e){ return '{}'; } }
    function getCfg(id){
        const raw=_cfgRaw(id);
        if(_cfgCacheId===id&&_cfgCacheObj&&_cfgCacheRaw===raw) return {..._cfgCacheObj};
        let o; try{ o=JSON.parse(raw)||{}; }catch(e){ o={}; }
        _cfgCacheId=id; _cfgCacheRaw=raw; _cfgCacheObj=o;
        return {...o};
    }
    function _cfgCacheDrop(id){ if(id==null||_cfgCacheId===id){ _cfgCacheId=null; _cfgCacheRaw=null; _cfgCacheObj=null; } }
    // ── 14.39.1 · 노트 설정(nb_*) '개정 번호' ────────────────────────────
    //   홈 카드의 미리보기는 한 번 그려 둔 HTML을 기억했다가 홈을 다시 그릴 때
    //   그대로 얹는다(빈 프레임 = 깜빡임 방지). 그 기억을 언제 버릴지를 이
    //   번호로 판단한다 — nb_* 에 쓰는 모든 변경(setCfg)이 번호를 올린다.
    const _cfgRev=new Map();          // nbId(String) -> 숫자
    function _cfgRevBump(id){ if(id==null||id==='') return; const k=String(id); _cfgRev.set(k,(_cfgRev.get(k)||0)+1); }
    function cfgRevOf(id){ return (id==null||id==='')?0:(_cfgRev.get(String(id))||0); }
    function setCfg(id,c){ _cfgRevBump(id); try{localStorage.setItem('nb_'+id,JSON.stringify(c));_cfgCacheDrop(id);return true;}
        catch(e){
            // 용량 부족: 절대 '다른 노트의 캐시를 통째로' 지우지 않는다.
            // (그러면 그 노트의 폴더 소속·고정·휴지통 정보까지 날아가
            //  폴더에서 튕겨 나가고 내용이 꼬이는 버그가 생겼다.)
            // ① 옛 그림/그리기 캐시(서버에 원본이 있음) 먼저 정리
            try{
                for(let i=localStorage.length-1;i>=0;i--){
                    const k=localStorage.key(i);
                    if(k&&(k.indexOf('draw_')===0||k.indexOf('img_')===0)) localStorage.removeItem(k);
                }
                // 그림·이미지 사본이 사라졌으니 그려 둔 미리보기 기억도 버린다
                // (안 그러면 홈 카드에 지워진 그림이 계속 남아 있게 된다)
                try{ pvPaintClear(); }catch(e){}
                localStorage.setItem('nb_'+id,JSON.stringify(c)); return true;
            }catch(e2){}
            // ② 그래도 부족하면 다른 노트의 '본문(pages)'만 비워 서버에서 다시 받게 한다
            //    (folder·pinned·trashed_at·lock 등 메타는 그대로 보존 → 소속이 유지됨)
            //    ★ 단, '서버에 사본이 없는 노트'(기기 전용 local_*, 아직 못 올린
            //      노트, 잠긴 노트)는 절대 비우지 않는다. 비우면 그 내용은
            //      어디에서도 되찾을 수 없어 영영 사라진다.
            const _safeToDrop=(k,o)=>{
                const nid=k.slice(3);
                if(String(nid).indexOf('local_')===0) return false;   // 기기 전용
                if(o.lock||o.encBlob) return false;                    // 잠긴 노트
                if(o.serverDoc||o.__ref) return true;                  // 서버 보관본 있음
                try{ if(hasPendingLocal(nid)) return false; }catch(e){} // 아직 못 올림
                return true;
            };
            try{
                // 지금 열려 있는 노트도 보호 대상
                const openId=(typeof curNB!=='undefined'&&curNB)?curNB.id:null;
                for(let i=0;i<localStorage.length;i++){
                    const k=localStorage.key(i);
                    if(k&&k.indexOf('nb_')===0&&k!=='nb_'+id&&k!=='nb_'+openId){
                        try{
                            const o=JSON.parse(localStorage.getItem(k)||'{}');
                            if(o.pages&&_safeToDrop(k,o)){
                                delete o.pages; delete o.textBoxes; delete o.previewImgs; delete o.drawing;
                                localStorage.setItem(k,JSON.stringify(o));
                                // 본문을 비운 노트는 파싱 캐시·미리보기 기억도 어긋난다
                                const _nid=k.slice(3); _cfgRevBump(_nid); _cfgCacheDrop(_nid);
                            }
                        }catch(err){}
                    }
                }
                localStorage.setItem('nb_'+id,JSON.stringify(c)); return true;
            }catch(e3){}
            console.warn('로컬 저장 실패',e);return false;
        } }
    const decCache=new Map();   // nbId -> 복호화된 doc (세션 한정)
    const previewDocCache=new Map(); // 서버 보관(import) 문서의 첫 쪽 미리보기
    async function loadPreviewDoc(nbId){
        if(previewDocCache.has(nbId)) return previewDocCache.get(nbId);
        const cfg=getCfg(nbId), ref=cfg.serverDoc||cfg.__ref;
        if(!ref) return null;
        const task=(async()=>{
            try{
                const r=await fetch('/api/import/docfile/'+encodeURIComponent(ref)+'?from=0&to=1',{cache:'no-store'});
                const d=await r.json();
                if(!r.ok||!d||!Array.isArray(d.pages)||!d.pages[0]) return null;
                return _normalizeDocPalette({paper:cfg.paper||'blank',sizePreset:d.sizePreset||cfg.sizePreset||'a4_portrait',
                        pages:[d.pages[0]]});
            }catch(e){ return null; }
        })();
        previewDocCache.set(nbId,task);
        const out=await task;
        if(!out) previewDocCache.delete(nbId); else previewDocCache.set(nbId,out);
        return out;
    }
    // 세션 키 없이 관리자 권한으로 열린 노트 (평문 잠금)
    const adminPlainUnlocked=new Set();

    // 14.13.9 · '본문을 못 받았다'는 일시적인 실패도 영구 차단으로 만들지 않는다.
    //   예전엔 __blockedNB 가 세션당 Set 이어서, 첫 3회 실패(순간 네트워크·서버
    //   재시작·느린 응답)가 한 번이라도 나면 새로고침 전까지 저장/동기화가 막혔다.
    //   → Map(nbId → 시각)으로 바꾸고, 성공 시 즉시 풀며, 온라인/재시도에서
    //     자동으로 다시 받아온다.
    function _nbBlocked(id){
        try{
            const b=window.__blockedNB;
            if(!b) return false;
            if(b instanceof Map) return b.has(String(id));
            return b.has?b.has(String(id)):false;
        }catch(e){ return false; }
    }
    function _nbMarkBlocked(id){
        try{
            window.__blockedNB=window.__blockedNB||new Map();
            if(!(window.__blockedNB instanceof Map)) window.__blockedNB=new Map();
            window.__blockedNB.set(String(id), Date.now());
        }catch(e){}
    }
    function _nbClearBlocked(id){
        try{
            const b=window.__blockedNB;
            if(!b) return;
            if(b instanceof Map) b.delete(String(id));
            else if(b.delete) b.delete(String(id));
        }catch(e){}
    }
    function _docHasContent(d){
        try{
            if(!d||!Array.isArray(d.pages)) return false;
            return d.pages.some(pg=>
                ((pg&&pg.els)||[]).length>0 ||
                ((pg&&pg.tables)||[]).length>0 ||
                ((pg&&pg.notes)||[]).length>0
            );
        }catch(e){ return false; }
    }
    // 슬라이스가 실제로 채워지면 '본문 안 불림' 플래그를 해제한다.
    function _importLoaded(d,nbId){
        if(!_docHasContent(d)) return false;
        _nbClearBlocked(nbId);
        try{ if(d) d.__loadFailed=false; }catch(e){}
        return true;
    }
    let _blockedRetryTimer=null;
    function _armBlockedImportRetry(){
        if(_blockedRetryTimer) return;
        _blockedRetryTimer=setTimeout(()=>{
            _blockedRetryTimer=null;
            try{ retryBlockedImport(); }catch(e){}
            // 현재 열어 둔 가져온 문서가 아직 막혀 있을 때만 이어서 재시도
            if(curNB&&doc&&doc.__ref&&(_nbBlocked(curNB.id)||doc.__loadFailed))
                _armBlockedImportRetry();
        },4000);
    }

    function loadDoc(nbId){
        const cfg=getCfg(nbId);
        if(cfg.lock&&cfg.lock.enc){
            if(decCache.has(nbId)) return decCache.get(nbId);
            // 관리자가 연 '평문 잠금' 노트는 본문이 그대로 남아 있다
            if(!cfg.encBlob && adminMode && adminPlainUnlocked.has(nbId))
                return migrate(cfg,nbId);
            return {...blankDoc(cfg.sizePreset), paper:cfg.paper||'blank', emoji:cfg.emoji||'', locked:true};
        }
        return migrate(cfg,nbId);
    }
    async function loadDocAsync(nbId){
        const cfg=getCfg(nbId);
        // 대용량 가져온 문서: 본문이 서버에 있으면 '첫 슬라이스만' 먼저 연다.
        // 나머지는 스크롤 시 슬라이스 단위로_lazy 로드 (한 번에 열다 뻗는 것 방지)
        let firstSliceFailed=false;
        if(cfg.serverDoc&&!(Array.isArray(cfg.pages)&&cfg.pages.length&&cfg.pages.some(p=>(p.els||[]).length))){
            // 사용자가 마지막으로 보던 쪽이 담긴 슬라이스를 '먼저'
            let lastPg=0;
            try{ lastPg=parseInt(localStorage.getItem('sdy_lastpg_'+nbId)||'0')||0; }catch(e){}
            const firstSlice=Math.max(0,Math.floor(lastPg/LAZY_SLICE)*LAZY_SLICE);
            let dd=null;
            for(let tryN=0;tryN<4&&!dd;tryN++){
                try{
                    dd=await fetchSlice(9000,cfg.serverDoc,firstSlice,0);
                    if(!dd) await new Promise(r=>setTimeout(r,[500,1000,2000,3500][tryN]||400));
                }catch(e){ await new Promise(r=>setTimeout(r,[500,1000,2000,3500][tryN]||400)); }
            }
            if(dd){
                _nbClearBlocked(nbId);
                const total=dd.total||dd.pages.length;
                // 14.38 · 받아 온 슬라이스는 문서 맨 앞이 아니라 **제 자리**에 둔다.
                //   마지막으로 보던 쪽이 9쪽 이상이면 firstSlice>0 인데, 예전엔 이
                //   슬라이스를 cfg.pages[0..] 에 그대로 놓아 문서 앞쪽 쪽들이 전부
                //   엉뚱한 내용으로 열렸다. 잘못 놓인 쪽은 lazy 표시가 아니라 다시
                //   받아 오지도 않고, 그 슬라이스가 반쯤 lazy인 채 loadBatch 되면
                //   id 보강 병합이 **다른 쪽의 글상자를 이어 붙여** 두 쪽의 내용이
                //   한 종이 위에 겹쳐진 채 저장되는 사고(사용자 보고)로 이어졌다.
                const pages=[];
                for(let i=0;i<total;i++)
                    pages.push({id:'lazy_'+i,els:[],tables:[],__lazy:1});
                dd.pages.forEach((p,k)=>{
                    const i=firstSlice+k;
                    if(i<total) pages[i]=p;
                });
                cfg.pages=pages;
                if(dd.sizePreset) cfg.sizePreset=dd.sizePreset;
                cfg.__ref=cfg.serverDoc;
                cfg.__loadedTo=firstSlice+dd.pages.length;
                try{ setCfg(nbId,cfg); }catch(e){}   // 옛 빈화면 캐시 덮어쓰기
            }else{
                // 본문을 못 받으면 빈 화면 역저장을 막되, 영구 차단 대신
                // 백그라운드 재시도를 걸어 순간 장애가 끝나면 바로 복구한다.
                firstSliceFailed=true;
                _nbMarkBlocked(nbId);
                _armBlockedImportRetry();
                if(window.toast)toast('본문을 받지 못했습니다 · 잠시 후 자동으로 다시 시도합니다',3200);
            }
        }
        if(cfg.lock&&cfg.lock.enc){
            if(decCache.has(nbId)) return decCache.get(nbId);
            if(!cfg.encBlob && adminMode && adminPlainUnlocked.has(nbId))
                return migrate(cfg,nbId);
            const key=sessionKeys.get(nbId);
            if(!key) return loadDoc(nbId);
            if(cfg.encBlob){
                try{
                    const plain=await decryptDoc(cfg.encBlob,key);
                    const d=_normalizeDocPalette({paper:plain.paper||cfg.paper||'blank', sizePreset:plain.sizePreset||cfg.sizePreset||'a4_portrait',
                             emoji:plain.emoji||'', glossary:plain.glossary||{}, pages:Array.isArray(plain.pages)&&plain.pages.length?plain.pages:[blankPage()]});
                    decCache.set(nbId,d);
                    return d;
                }catch(e){ console.warn('복호화 실패',e); }
            }
            const d=blankDoc(cfg.sizePreset); d.paper=cfg.paper||'blank';
            decCache.set(nbId,d);
            return d;
        }
        const d=migrate(cfg,nbId);
        // 서버 참조가 있는데 '실제로 본문을 하나도 못 받은' 경우만 로드 실패로
        // 저장을 차단한다. 첫 슬라이스가 성공했는데 앞쪽이 비어 보이는 것은
        // lazy 문서의 정상적인 모습일 수 있으므로 차단하지 않는다.
        const elN0=(d.pages||[]).reduce((n,pg)=>n+((pg.els||[]).length),0);
        if((cfg.serverDoc||d.__ref)&&elN0===0&&firstSliceFailed) d.__loadFailed=true;
        // lazy 스텁 마커 복원 (migrate 는 id/els 만 옮기므로)
        if(cfg.__ref||cfg.serverDoc){
            d.__ref=cfg.__ref||cfg.serverDoc;
            d.__loadedTo=cfg.__loadedTo||0;
            // 내용이 비어 있는 쪽은 '아직 안 받은 쪽'으로 되돌린다.
            // (evict 로 비워진 쪽은 id 가 lazy_N 이 아니어서 예전엔
            //  영영 백지로 남았다 → 이것이 9쪽부터 빈 종이가 되던 원인)
            (d.pages||[]).forEach(p=>{
                if(/^lazy_\d+$/.test(p.id||'')) p.__lazy=1;
                else if(!(p.els||[]).length&&!(p.tables||[]).length
                        &&!(p.notes||[]).length) p.__lazy=1;
            });
        }
        return d;
    }

    // ===== 대용량 문서 슬라이스 로드 (스크롤 시 조금씩) =====
    const LAZY_SLICE=8;   // 작은 배치: 첫 화면 즉시 + 스크롤 스트리밍
    // 서버 슬라이스 저장소에서 s0 부터 LAZY_SLICE 개 쪽을 받는다.
    // (대용량 가져온 문서 본문을 열 때/스크롤할 때 쓰는 공용 헬퍼)
    // 이 요청은 '첫 슬라이스 심문'에 쓰이므로 서버가 느려도 무한정 매달리지
    // 않게 타임아웃을 준다. (타임아웃은 실패로 처리해 다음 재시도로 넘어간다)
    // 14.29.4 · 슬라이스 요청은 'no-store'(항상 통째로 다시 받기) 대신
    //   'no-cache'(항상 서버에 물어보되, 안 바뀌었으면 브라우저 캐시 재사용)를
    //   쓴다. 서버는 ETag 로 답하므로 이미 본 슬라이스는 304 (본문 0바이트) 가
    //   되어, 두 번째부터 노트가 눈에 띄게 빨리 열린다.
    //   '최신 여부'는 매번 서버가 판정하므로 오래된 본문이 보일 일은 없다.
    const SLICE_FETCH={cache:'no-cache'};
    async function fetchSlice(ms, ref, s0, total){
        try{
            const url='/api/import/docfile/'+encodeURIComponent(ref)
                +'?from='+s0+'&to='+(s0+LAZY_SLICE);
            let rr;
            if(window.AbortController&&ms){
                const ctl=new AbortController();
                const timer=setTimeout(()=>{ try{ ctl.abort(); }catch(e){} }, ms);
                try{ rr=await fetch(url,{cache:'no-cache',signal:ctl.signal}); }
                finally{ clearTimeout(timer); }
            }else{
                rr=await fetch(url,SLICE_FETCH);
            }
            const dd=await rr.json().catch(()=>({}));
            if(rr.ok && dd && dd.ok!==false && Array.isArray(dd.pages)) return dd;
            return null;
        }catch(e){ return null; }
    }
    // 실패했던 가져온 문서를 백그라운드에서 다시 받는다.
    // 온라인 복귀·화면 복귀·블록 직후 일정 시간 뒤에 호출된다.
    async function retryBlockedImport(){
        try{
            const nbId=curNB&&curNB.id, d=doc;
            if(!nbId||!d||!d.__ref) return;
            if(!_nbBlocked(nbId)&&!d.__loadFailed) return;
            const dbg=document.getElementById('saveState');
            if(dbg) setSaveState('본문 다시 불러오는 중…');
            const dd=await fetchSlice(9000,d.__ref,0,(d.pages||[]).length);
            if(!dd||!Array.isArray(dd.pages)||!dd.pages.length) return;
            if(doc!==d||!curNB||curNB.id!==nbId) return;
            let filled=false;
            dd.pages.forEach((p,j)=>{
                const i=j; if(i>=(d.pages||[]).length) return;
                const cur=d.pages[i];
                if(cur&&(cur.__dirty||(cur.__lazy==null&&((cur.els||[]).length||(cur.tables||[]).length)))) return;
                d.pages[i]=p; filled=true;
            });
            if(!filled) return;
            if(_importLoaded(d,nbId)){
                if(dbg) setSaveState('본문 불러옴 ✓',2400);
                if(doc===d){ try{ ensureVisiblePagesRendered(); }catch(e){} }
                try{ if(doc===d) startSlicePrefill(); }catch(e){}
                try{ if(curNB&&curNB.id===nbId) queueSync(nbId); }catch(e){}
            }
        }catch(e){}
    }
    async function ensureLazyPage(idx){
        const d=doc;                    // 14.9 · 노트 전환 후 이어지는 로드를 차단
        if(!d||!d.__ref) return;
        const pg=d.pages[idx];
        if(!pg||pg.__lazy==null) return;
        const s0=Math.floor(idx/LAZY_SLICE)*LAZY_SLICE;
        await loadBatch(s0);
        if(doc!==d) return;
        // 22.x · 똥컴 모드는 이웃 슬라이스 프리필도 생략하고 '그때 그때'만 받는다.
        if(!sdyTurbo()){
            prefetchBatch(s0+LAZY_SLICE);   // 다음 배치는 백그라운드에서 미리
            prefetchBatch(s0-LAZY_SLICE);
        }
        evictFar(idx);                  // 먼 쪽은 메모리에서 비움
    }
    async function loadBatch(s0){
        // 14.9 · 노트 전환 방지: 로드 중 다른 노트를 열면(doc 가 바뀌면)
        //  이전 노트의 슬라이스를 새 노트에 덮어쓰지 않도록 문서 참조를 고정한다.
        const d=doc;
        if(!d||!d.__ref) return;
        const n=(d.pages||[]).length;
        if(s0<0||s0>=n) return;
        // 14.6 · 첫 쪽만이 아니라 슬라이스 전체를 본다.
        //  evictFar 는 쪽을 하나씩 내려놓으므로 슬라이스가 '일부만 lazy'가 될 수
        //  있다. 첫 쪽이 이미 받아져 있으면 나머지 lazy 쪽이 영영 백지로 남던
        //  문제를 막기 위해 슬라이스 안에 lazy 쪽이 하나라도 있으면 로드한다.
        const anyLazy=()=>{
            for(let i=s0;i<Math.min(n,s0+LAZY_SLICE);i++)
                if(d.pages[i]&&d.pages[i].__lazy!=null) return true;
            return false;
        };
        if(!anyLazy()) return;
        d.__lazyLoading=d.__lazyLoading||new Set();
        // 14.30.0 · 같은 슬라이스를 기다리는 다른 로더가 있으면 '무한정' 대기하지
        //   않는다. 서버가 그 요청을 처리하다 멈췄을 때 뒤에 줄선 요청 전부가
        //   영영 돌지 못하는(백지 쪽) 길을 막는다 — 상한만큼 기다린 뒤 직접 받는다.
        if(d.__lazyLoading.has(s0)){
            for(let w=0;w<80;w++){                 // 최대 120ms×80 ≈ 9.6초 대기
                if(!d.__lazyLoading.has(s0)) break;
                await new Promise(r=>setTimeout(r,120));
                if(doc!==d||!anyLazy()) return;
            }
        }
        if(doc!==d||!anyLazy()) return;
        d.__lazyLoading.add(s0);
        // 14.30.0 · 대화형(스크롤) 로드에도 타임아웃을 준다. fetchSlice 처럼
        //   9초 안에 못 받으면 실패로 처리해 잠금을 풀고 한 번만 다시 시도한다.
        //   (예전엔 fetch 가 멈추면 __lazyLoading 잠금이 남아 그 슬라이스를
        //    다시 부르는 모든 경로가 while 에서 영영 대기 — '불러오는 중' 지속.)
        try{
            let dd=null, ok=false;
            for(let attempt=0;attempt<2&&!dd;attempt++){
                if(doc!==d||!anyLazy()) break;
                const rr=await fetchSlice(9000,d.__ref,s0,(d.pages||[]).length);
                if(doc!==d) break;          // 14.9 · 그 사이 다른 노트를 열었으면 무시
                if(rr&&Array.isArray(rr.pages)){ dd=rr; ok=true; break; }
            }
            if(doc===d&&ok&&Array.isArray(dd.pages)){
                dd.pages.forEach((p,k)=>{
                    const i=s0+k; if(i>=n) return;
                    const cur=d.pages[i];
                    // 14.4 · 번역/편집된 쪽은 서버 원본으로 덮지 않는다.
                    if(cur&&cur.__dirty) return;
                    if(cur&&cur.__lazy==null&&(cur.els||[]).length){
                        // 14.38 · id 보강 병합은 '같은 쪽'일 때만 한다. 쪽 신원(id)이
                        //   다르면 지금 메모리에 있는 이 쪽은 서버의 이 쪽이 아니다
                        //   (슬라이스가 어긋난 자리에 적재된 적 있음). 이어 붙이면
                        //   두 쪽의 글상자가 한 쪽에 겹쳐진 채 저장된다. 편집되지
                        //   않은(__dirty 아님) 쪽은 서버 본문이 항상 옳으니 교체한다.
                        if(cur.id&&p.id&&cur.id!==p.id){ d.pages[i]=p; return; }
                        // 이미 있는 내용은 id 기준으로만 보강 (원본이 번역을 지우지 않게)
                        const have=new Set((cur.els||[]).map(e=>e.id));
                        const extra=(p.els||[]).filter(e=>e&&e.id&&!have.has(e.id));
                        if(extra.length) cur.els=(cur.els||[]).concat(extra);
                        return;
                    }
                    d.pages[i]=p;
                });
                _importLoaded(d, curNB&&curNB.id);
                if(doc===d) schedulePresanitize();   // 18.13 · 새로 받은 쪽을 미리 정리
            }else if(doc===d){
                // 받지 못한 슬라이스: 잠시 뒤 화면의 그 쪽을 다시 그려 재시도하게 한다.
                // (직접 ensureLazyPage 를 부르면 실패 시 무한 재귀가 될 수 있다.)
                setTimeout(()=>{
                    try{ if(doc===d) ensureVisiblePagesRendered(); }catch(e){}
                },2500);
            }
        }catch(e){ console.warn('배치 로드 실패',s0,e); }
        finally{
            if(doc===d) d.__lazyLoading.delete(s0);
        }
    }
    function prefetchBatch(s0){
        if(!doc||!doc.__ref) return;
        const n=(doc.pages||[]).length;
        if(s0<0||s0>=n) return;
        if(doc.pages[s0].__lazy==null) return;
        doc.__pf=doc.__pf||new Set();
        if(doc.__pf.has(s0)) return;
        doc.__pf.add(s0);
        setTimeout(()=>{ loadBatch(s0); },60);
    }
    // 현재 위치에서 먼 페이지는 메모리에서 내려놓는다(서버에 원본 있으니 안전)
    function evictFar(idx){
        if(!doc||!doc.__ref) return;
        // 저사양 기기는 메모리에 붙잡는 쪽 수를 줄여 GC·저장 스캔 부담을 낮춘다.
        const R=sdyTurbo()?12:(sdyLowEnd()?22:40);
        (doc.pages||[]).forEach((p,i)=>{
            if(Math.abs(i-idx)<=R||!canUnloadPage(i)||_pageRenderJobs.has(i)) return;
            if(p&&p.__lazy==null&&!p.__dirty&&(p.els||[]).length){
                // 원래 자리(index)로 다시 받아오므로 id 는 lazy_N 으로 통일한다.
                // → 저장/복원 어느 경로로 돌아와도 '안 받은 쪽'으로 인식된다.
                doc.pages[i]={id:'lazy_'+i,els:[],tables:[],__lazy:1};
            }
        });
    }
    function docHasLazy(){ return !!(doc&&doc.__ref&&(doc.pages||[]).some(p=>p.__lazy!=null)); }
    async function loadAllLazy(){
        if(!doc||!doc.__ref) return;
        for(let i=0;i<(doc.pages||[]).length;i+=LAZY_SLICE){
            if(doc.pages[i]&&doc.pages[i].__lazy!=null) await ensureLazyPage(i);
        }
    }
    // 전부 불러오되 쪽을 내려놓지(evict) 않는다 — 전체 번역처럼 전 쪽을 동시에 다뤄야 할 때
    async function loadAllLazyNoEvict(){
        if(!doc||!doc.__ref) return;
        const n=(doc.pages||[]).length;
        for(let s=0;s<n;s+=LAZY_SLICE*6){
            const jobs=[];
            for(let s0=s;s0<Math.min(n,s+LAZY_SLICE*6);s0+=LAZY_SLICE){
                if(doc.pages[s0]&&doc.pages[s0].__lazy!=null) jobs.push(loadBatch(s0));
            }
            await Promise.all(jobs);
        }
    }

/* APP-PART:02a-home-shell.js:END */
