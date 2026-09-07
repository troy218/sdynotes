/* === src/app/02-home.js ===
   홈 · 설정동기화 · 검색 · 폴더 · 휴지통 · 멀티선택
   (sdynotes.js 메가 분리 · 이 파일들은 scripts/bundle-frontend.mjs 가 순서대로 이어 붙인다.
    let/const 스코프를 공유하려면 반드시 concat 되어야 한다 — 단독 <script> 로드 금지) */
/* APP-PART:02-home.js:BEGIN */
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
    function setCfg(id,c){ try{localStorage.setItem('nb_'+id,JSON.stringify(c));_cfgCacheDrop(id);return true;}
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

    // ============ 스트로크 → SVG path (에디터/미리보기/내보내기 공용) ============
    function strokePath(pts,sharp){
        if(!pts||pts.length<2) return pts&&pts.length===1?`M ${pts[0][0]} ${pts[0][1]} l 0.01 0`:'';
        if(sharp){
            // 도형: 스무딩 없이 꺾은선 → 모서리가 뭉개지지 않음
            return 'M '+pts.map(p=>`${p[0]} ${p[1]}`).join(' L ');
        }
        let d=`M ${pts[0][0]} ${pts[0][1]}`;
        for(let i=1;i<pts.length-1;i++){
            const mx=(pts[i][0]+pts[i+1][0])/2, my=(pts[i][1]+pts[i+1][1])/2;
            d+=` Q ${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
        }
        const last=pts[pts.length-1];
        d+=` L ${last[0]} ${last[1]}`;
        return d;
    }
    function isEllipsePts(pts){ return pts&&pts.length>20; }
    function strokeBBox(s){
        let x1=1e9,y1=1e9,x2=-1e9,y2=-1e9;
        (s.pts||[]).forEach(([x,y])=>{ if(x<x1)x1=x; if(y<y1)y1=y; if(x>x2)x2=x; if(y>y2)y2=y; });
        const pad=(s.size||2)/2+1;
        return {x:x1-pad,y:y1-pad,w:(x2-x1)+pad*2,h:(y2-y1)+pad*2};
    }

    // 페이지 하나를 정적 HTML로 렌더 (미리보기 + 내보내기 = 에디터와 100% 동일)
    // 종이 무늬를 SVG 로 생성 (CSS repeating-gradient 는 축소 시 1px 선이
    // 반올림되며 간격/두께가 뭉개진다 → 미리보기에서 비율이 어긋나 보임)
    function paperPatternSVG(type,size){
        if(!type||type==='blank') return '';
        let d='';
        if(type==='lined'){
            for(let y=47.5;y<size.h;y+=32)
                d+=`<line x1="0" y1="${y}" x2="${size.w}" y2="${y}"/>`;
            return `<svg class="pv-bg" viewBox="0 0 ${size.w} ${size.h}" width="${size.w}" height="${size.h}" `+
                   `preserveAspectRatio="none" style="position:absolute;left:0;top:0;z-index:1;pointer-events:none;">`+
                   `<g stroke="var(--line)" stroke-width="1" shape-rendering="crispEdges">${d}</g></svg>`;
        }
        if(type==='grid'){
            for(let y=0.5;y<size.h;y+=32) d+=`<line x1="0" y1="${y}" x2="${size.w}" y2="${y}"/>`;
            for(let x=0.5;x<size.w;x+=32) d+=`<line x1="${x}" y1="0" x2="${x}" y2="${size.h}"/>`;
            return `<svg class="pv-bg" viewBox="0 0 ${size.w} ${size.h}" width="${size.w}" height="${size.h}" `+
                   `preserveAspectRatio="none" style="position:absolute;left:0;top:0;z-index:1;pointer-events:none;">`+
                   `<g stroke="var(--line)" stroke-width="1" shape-rendering="crispEdges">${d}</g></svg>`;
        }
        if(type==='dotted'){
            for(let y=12;y<size.h;y+=24)
                for(let x=12;x<size.w;x+=24) d+=`<circle cx="${x}" cy="${y}" r="1"/>`;
            return `<svg class="pv-bg" viewBox="0 0 ${size.w} ${size.h}" width="${size.w}" height="${size.h}" `+
                   `preserveAspectRatio="none" style="position:absolute;left:0;top:0;z-index:1;pointer-events:none;">`+
                   `<g fill="var(--dot)">${d}</g></svg>`;
        }
        return '';
    }

    function renderPageStatic(page, size, paperCls){
        let html='';
        const strokes=[];
        (page.els||[]).forEach(el=>{
            if(el.type==='image'){
                html+=`<div style="position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;border:2px solid transparent;box-sizing:border-box;border-radius:2px;z-index:2;transform:rotate(${normalizedRotation(el.rotation)}deg);transform-origin:50% 50%;">`+
                      `<img src="${el.url||el.localURL||''}" style="width:100%;height:100%;object-fit:fill;display:block;border-radius:2px;"></div>`;
            }else if(el.type==='legacyDraw'){
                html+=`<img src="${el.url}" style="position:absolute;left:0;top:0;width:${size.w}px;height:${size.h}px;z-index:3;">`;
            }else if(el.type==='stroke'){ strokes.push(el); }
        });
        if(strokes.length){
            html+=`<svg viewBox="0 0 ${size.w} ${size.h}" width="${size.w}" height="${size.h}" `+
                  `style="position:absolute;left:0;top:0;z-index:3;overflow:visible;pointer-events:none;">`+
                  strokes.map(s=>{
                      const tr=strokeTransform(s);
                      const d=strokePath(s.pts,s.sharp&&!isEllipsePts(s.pts));
                      return (s.fillColor?`<path d="${d}" fill="${_classicPaletteColor('draw',s.fillColor)}" fill-opacity="${s.fillOpacity==null?0.58:s.fillOpacity}" fill-rule="evenodd"${tr?` transform="${tr}"`:''}/>`:'')+
                      `<path d="${d}" fill="none" stroke="${_classicPaletteColor('draw',s.color)}" stroke-width="${s.size}" `+
                      `${s.opacity!=null?`stroke-opacity="${s.opacity}" `:''}`+
                      `stroke-linecap="round" stroke-linejoin="round"${tr?` transform="${tr}"`:''}/>`;
                  }).join('')+
                  `</svg>`;
        }
        (page.els||[]).forEach(el=>{
            if(el.type==='latex'){
                // 9.0 · 미리보기에서도 가져온 수식은 원문 잉크 상자 안에 가둔다.
                const imp=!!el.imported;
                const bw=imp?(el.inkW||el.w):el.w, bh=imp?(el.inkH||el.h):el.h;
                html+=`<div style="position:absolute;left:${el.x}px;top:${el.y}px;width:${bw}px;height:${bh}px;`+
                      `z-index:5;transform:rotate(${normalizedRotation(el.rotation)}deg);transform-origin:50% 50%;display:flex;align-items:${imp?'center':(el.displayMath?'center':'flex-end')};${el.displayMath?'justify-content:center;':''}`+
                      `font-size:${el.fontSize||20}px;line-height:1.05;color:var(--text1);overflow:hidden;">${latexHTML(el.latex||'',!!el.displayMath)}</div>`;
                return;
            }
            if(el.type!=='text') return;
            const inner=el.tight
                ? `width:100%;height:100%;padding:0;box-sizing:border-box;font-size:${el.fontSize||16}px;line-height:1;color:var(--text1);`+
                  `font-family:${fontCSS(el.font||'pretendard')};text-align:${el.align||'left'};`+
                  `overflow:visible;position:relative;`
                : `width:100%;height:100%;min-width:60px;min-height:28px;padding:8px 12px;border:2px solid transparent;`+
                  `box-sizing:border-box;font-size:${el.fontSize||16}px;line-height:1.5;color:var(--text1);`+
                  `font-family:${fontCSS(el.font||'pretendard')};text-align:${el.align||'left'};`+
                  `white-space:pre-wrap;word-break:break-word;overflow:hidden;`;
            html+=`<div style="position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;z-index:4;transform:rotate(${normalizedRotation(el.rotation)}deg);transform-origin:50% 50%;">`+
                  `<div style="${inner}">${el.html||''}</div></div>`;
        });
        // .ppv = 미리보기 전용 컨테이너 (에디터 .paper 스크립트와 충돌 방지)
        const pat=paperPatternSVG((paperCls||'').replace('paper-',''),size);
        return `<div class="ppv" data-paper="${(paperCls||'').replace('paper-','')}" `+
               `style="position:absolute;left:0;top:0;width:${size.w}px;height:${size.h}px;`+
               `background:var(--card);outline:1px solid var(--border);border-radius:3px;`+
               `overflow:hidden;box-sizing:border-box;">${pat}${html}</div>`;
    }

    // ============ Search / Emoji ============
    let searchQuery='';
    function searchNotes(q){ searchQuery=(q||'').trim().toLowerCase(); renderGrid(); }
    function docText(d){
        let t='';
        (d.pages||[]).forEach(p=>(p.els||[]).forEach(e=>{
            if(e.type==='text'){ const tmp=document.createElement('div'); tmp.innerHTML=e.html||''; t+=' '+tmp.textContent; }
            else if(e.type==='latex') t+=' '+(e.latex||'');
        }));
        return t.toLowerCase();
    }
    function getFiltered(){
        // 검색 중이면 폴더 무시하고 전체에서 찾는다 (단, 잠긴 폴더 안의 노트는 숨긴다)
        const visible=notebooks.filter(n=>{
            if(isTrashed(n.id)) return false;   // 휴지통 노트는 홈 화면에서 숨김 (설정에서 관리)
            const fid=noteFolder(n.id);
            if(!fid) return true;
            // 잠금 자체가 걸린 폴더는 이번 세션에서 열어 본 적이 있어도 검색 대상에서 제외.
            // 검색창을 통해 잠금 폴더 제목/본문이 새어 나오지 않게 한다.
            const path=folderPath(fid);
            if(!path.length) return false;
            if(searchQuery) return path.every(f=>!isFolderLocked(f.id));
            return path.every(f=>isFolderOpen(f.id));
        });
        // ★ 항상 visible(휴지통·잠긴 폴더 제외) 기준으로 필터 — notebooks 직접 참조 금지
        const base=visible.filter(n=>searchQuery || noteFolder(n.id)===curFolder);
        if(!searchQuery) return base;
        return base.filter(nb=>{
            if((nb.title||'').toLowerCase().includes(searchQuery)) return true;
            if(isLocked(nb.id)&&!isUnlocked(nb.id)) return false;   // 아직 안 푼 노트만 제외
            try{ return docText(loadDoc(nb.id)).includes(searchQuery); }catch(e){ return false; }
        });
    }
    const EMOJI_LIST=['😀','😊','🥰','😎','🤔','😢','😤','🔥','⭐','💡','✅','❤️','💜','🎯','📌','🎉','🌟','🍀','☕','📝','🎨','🎵','💪','👍'];
    function buildEmojiPicker(id){ return EMOJI_LIST.map(e=>`<div class="emoji-opt" onclick="event.stopPropagation();setNoteEmoji('${id}','${e}')">${e}</div>`).join(''); }
    function closeAllEmojiPickers(){
        document.querySelectorAll('.emoji-picker.open').forEach(p=>p.classList.remove('open'));
    }
    function toggleEmojiPicker(badge){
        const picker=badge&&badge.nextElementSibling;
        const wasOpen=picker&&picker.classList.contains('open');
        closeAllEmojiPickers();
        if(picker&&!wasOpen) picker.classList.add('open');
    }
    // 9.1 · 이모지 동기화 정리
    //  예전엔 이모지가 두 경로로 동시에 오갔다.
    //    ① 설정 채널 (emoji:<id> · rev 기반, 정확함)
    //    ② 문서 본문 채널 (applyServerState 의 st.emoji · 낡은 값이 섞임)
    //  ②가 나중에 도착하면 방금 고른 이모지를 옛 값으로 되돌려 버려서
    //  "바꿔도 원래대로 돌아간다 / 다른 기기에 안 간다" 처럼 보였다.
    //  이제 설정 채널을 유일한 주인으로 삼고, 문서 채널의 이모지는
    //  더 최신인 로컬 값이 있으면 무시한다 (emojiTs 로 판정).
    function emojiStamp(nbId){ return +(getCfg(nbId).emojiTs||0); }
    function shouldKeepLocalEmoji(nbId){
        // 아직 서버로 못 보낸 내 변경이 있으면 원격 본문 값으로 덮지 않는다
        if(_stOut['emoji:'+nbId]) return true;
        // 방금(90초 이내) 내가 바꾼 것도 보호한다
        return (Date.now()-emojiStamp(nbId))<90000;
    }
    function paintEmojiBadge(nbId,em){
        const card=document.querySelector(`.note-card[data-nb-id="${nbId}"] .emoji-badge`);
        if(!card) return false;
        card.classList.toggle('has-emoji',!!em);
        card.innerHTML=em||'<span style="font-size:16px;opacity:.35;">◌</span>';
        return true;
    }
    function setNoteEmoji(nbId,em){
        const cfg=getCfg(nbId); const d=migrate(cfg,nbId);
        d.emoji=(d.emoji===em)?'':em;
        persistDoc(nbId,d);
        // persistDoc 뒤에 찍어야 저장 과정에서 덮이지 않는다
        const c2=getCfg(nbId);
        if(d.emoji) c2.emoji=d.emoji; else delete c2.emoji;
        c2.emojiTs=Date.now();
        setCfg(nbId,c2);
        if(curNB&&curNB.id===nbId&&doc) doc.emoji=d.emoji;
        paintEmojiBadge(nbId,d.emoji);
        closeAllEmojiPickers();
        queueSync(nbId);
        pushSettingsNow();        // 이모지도 실시간 동기화 (설정 키 emoji:<id>)
    }
    // 피커 바깥을 누르면 닫는다 (점박이 동그라미/피커 내부는 제외)
    document.addEventListener('click',e=>{
        if(!e.target.closest('.emoji-picker')&&!e.target.closest('.emoji-badge')) closeAllEmojiPickers();
    });

    let _impSaveTimer=null, _impSaving=false;
    function queueImportedSave(){
        if(!doc||!doc.__ref) return;
        clearTimeout(_impSaveTimer);
        _impSaveTimer=setTimeout(flushImportedSave, 700);
    }
    async function flushImportedSave(){
        if(!doc||!doc.__ref) return;
        // 이미 저장 중이면 끝날 때까지 기다렸다가 남은 dirty 를 이어서 보낸다.
        // (닫기/번역 완료와 디바운스 저장이 겹치면 번역분이 유실되던 구멍)
        while(_impSaving){
            await new Promise(r=>setTimeout(r,80));
            if(!doc||!doc.__ref) return;
        }
        const n=(doc.pages||[]).length;
        const slices=new Set();
        (doc.pages||[]).forEach((pg,i)=>{
            if(pg&&pg.__dirty&&pg.__lazy==null) slices.add(Math.floor(i/LAZY_SLICE)*LAZY_SLICE);
        });
        if(!slices.size) return;
        _impSaving=true;
        try{
            for(const s0 of slices){
                if(!doc||!doc.__ref) break;
                // 14.6 · 슬라이스 일부가 lazy(내려놓음)라도 나머지를 불러와 온전히 저장한다.
                //  예전엔 한 쪽이라도 lazy면 통째로 건너뛰어, dirty 쪽의 번역/편집이
                //  서버에 안 올라가고 스크롤·재진입 때 원문으로 되돌아갔다.
                let hasLazy=false;
                for(let i=s0;i<Math.min(n,s0+LAZY_SLICE);i++){
                    if(doc.pages[i]&&doc.pages[i].__lazy!=null){ hasLazy=true; break; }
                }
                if(hasLazy){
                    try{ await loadBatch(s0); }catch(e){}
                }
                const chunk=[];
                let incomplete=false;
                for(let i=s0;i<Math.min(n,s0+LAZY_SLICE);i++){
                    const pg=doc.pages[i];
                    if(!pg||pg.__lazy!=null){ incomplete=true; break; }
                    chunk.push({id:pg.id, els:sanitizePageEls(pg.els||[]), tables:pg.tables||[], notes:pg.notes||[],
                                ...(pg.edited?{edited:1}:{})});
                }
                if(incomplete||!chunk.length) continue;
                let ok=false;
                for(let attempt=0; attempt<3 && !ok; attempt++){
                    try{
                        const r=await fetch('/api/import/docfile/'+encodeURIComponent(doc.__ref),{
                            method:'POST', headers:{'Content-Type':'application/json'},
                            body:JSON.stringify({from:s0, pages:chunk, total:n, sizePreset:doc.sizePreset||'a4_portrait'})
                        });
                        const d=await r.json().catch(()=>({}));
                        if(r.ok&&d.ok){
                            for(let i=s0;i<s0+chunk.length && i<n;i++){
                                if(doc.pages[i]) doc.pages[i].__dirty=false;
                            }
                            try{ if(d.version) doc.__ver=d.version; }catch(e){}
                            ok=true;
                        }
                    }catch(e){}
                    if(!ok) await new Promise(res=>setTimeout(res, 280*(attempt+1)));
                }
            }
        }catch(e){ console.warn('가져온 문서 저장 실패',e); }
        finally{ _impSaving=false; }
    }
    function persistDoc(nbId,d){
        const cfg=getCfg(nbId);
        // 잠긴 노트: 평문을 디스크에 남기지 않고 암호문만 저장
        if(cfg.lock&&cfg.lock.enc&&sessionKeys.has(nbId)){
            const key=sessionKeys.get(nbId);
            cfg.paper=d.paper; cfg.sizePreset=d.sizePreset; cfg.emoji=d.emoji;
            delete cfg.pages;
            encryptDoc(d,key).then(blob=>{
                const c2=getCfg(nbId);
                c2.paper=d.paper; c2.sizePreset=d.sizePreset; c2.emoji=d.emoji;
                c2.encBlob=blob; delete c2.pages;
                c2.orient=paperSize(d).w>paperSize(d).h?'landscape':'portrait';
                setCfg(nbId,c2);
            }).catch(e=>console.warn('암호화 실패',e));
            cfg.orient=paperSize(d).w>paperSize(d).h?'landscape':'portrait';
            delete cfg.textBoxes; delete cfg.previewImgs; delete cfg.drawing;
            setCfg(nbId,cfg);
            return;
        }
        // (관리자가 연 '평문 잠금' 노트도 여기로 온다.
        //  원래 평문이었으므로 그대로 평문 저장하되 lock 표시는 유지된다)
        cfg.paper=d.paper; cfg.sizePreset=d.sizePreset; cfg.emoji=d.emoji;
        try{
            if(Array.isArray(d.pages)){
                // 22.1 · 저장할 때마다 '전 쪽'을 다시 정리하지 않는다.
                //   sanitize 는 겹침 O(n²) 비교를 포함하는데, 이 루프는 오토세이브
                //   (400ms)마다 문서 전체 요소 ×쪽 수 만큼 돌아 '글상자를 두드리는
                //   동안 계속' 밀렸다. 렌더/프리세니타이즈가 이미 정리한 쪽은
                //   _sanDone 으로 알고 있으므로 건너뛰고, 정리가 필요한 쪽만 돌린다.
                //   ★ 드롭이 없으면 배열 신원을 그대로 둔다 — 새 배열로 덮으면
                //     WeakSet 캐시가 매번 어긋나 이 최적화가 무의미해진다.
                d.pages.forEach(pg=>{
                    if(!pg||!Array.isArray(pg.els)||!pg.els.length) return;
                    const keep=pg.els;
                    if(_sanDone.has(keep)) return;
                    const n=sanitizePageEls(keep);
                    _sanDone.add(n); _sanDone.add(keep);
                    if(n.length!==keep.length){ pg.__dirty=true; pg.els=n; }
                });
            }
        }catch(e){}
        if(d.__ref){
            // ★ 가져온 대용량 문서: 서버 보관본 참조를 반드시 함께 저장한다.
            //   이걸 빠뜨리면 다시 열었을 때 아직 안 받은 쪽(lazy)을 받아올
            //   주소가 사라져서 "첫 8쪽만 나오고 나머지는 전부 백지"가 된다.
            cfg.__ref=d.__ref;
            cfg.serverDoc=d.__ref;
            cfg.__loadedTo=d.__loadedTo||0;
            // 14.30.0 · 로컬 저장은 '편집(더티) 쪽만 실제 내용'으로, 나머지는
            //   lazy 스텁으로만 남긴다. 예전엔 d.pages 전체(프리필로 받은 전 쪽)
            //   를 localStorage 에 통째로 써서 — 수 MB~수십 MB 문서를 열 때마다
            //   저장이 쿼터에 걸리고, 저장 실패 처리(전 노트 훑기)까지 매번 돌아
            //   타이핑마다 버벅였다. 열 때는 어차피 서버 슬라이스에서 다시 받는다.
            cfg.pages=d.pages.map((pg,i)=>{
                if(pg&&pg.__dirty&&pg.__lazy==null){
                    const copy={id:pg.id,
                        els:Array.isArray(pg.els)?pg.els.slice():[],
                        tables:Array.isArray(pg.tables)?pg.tables.slice():[],
                        notes:Array.isArray(pg.notes)?pg.notes.slice():[]};
                    copy.__dirty=1;
                    if(pg.edited) copy.edited=1;
                    return copy;
                }
                return {id:(pg&&pg.id)||('lazy_'+i),els:[],tables:[],__lazy:1};
            });
        }else{
            cfg.pages=d.pages;
        }
        cfg.favPages=Array.isArray(d.favPages)?d.favPages:[];
        cfg.tint=d.tint||'';
        cfg.glossary=d.glossary||{};
        // 6.2: 관리자가 평문 복원으로 연 노트는 소유자의 옛 암호문 보존
        if(!(adminMode&&adminPlainUnlocked.has(nbId)&&cfg.encBlob)) delete cfg.encBlob;
        cfg.orient=paperSize(d).w>paperSize(d).h?'landscape':'portrait';
        delete cfg.textBoxes; delete cfg.previewImgs; delete cfg.drawing;
        try{ localStorage.removeItem('draw_'+nbId); }catch(e){}
        const saved=setCfg(nbId,cfg);
        // 편집분은 '요소 단위 연산'으로 동기화 → 전체 덮어쓰기로 씹히는 일 없음.
        // 18.8 · persistDoc 은 '열려 있지 않은 노트'에도 쓰인다(닫힌 노트 삭제/그림
        //   업로드 완료 등). 이때 queueOps 는 '지금 열린 노트'의 op 를 만들어 이
        //   노트(nbId)로 엉뚱하게 보낼 수 있으므로, '열려 있는 바로 그 노트'일 때만
        //   실행한다. 닫힌 노트는 명시적 pushOpsFor/이미지 메타 outbox 가 담당한다.
        if(curNB&&curNB.id===nbId&&doc) queueOps();
        // 노트 설정(종이·크기·배경색·즐겨찾는 쪽·사전)도 함께 공유
        try{ pushSettings(); }catch(e){}
        return saved;
    }

    function sortNBs(list){
        return [...(list||[])].sort((a,b)=>{
            const pa=getCfg(a.id).pinned?1:0, pb=getCfg(b.id).pinned?1:0;
            if(pa!==pb) return pb-pa;                       // 고정 노트 먼저
            return new Date(a.created_at||0)-new Date(b.created_at||0);
        });
    }

    async function loadNBs(){
        try{ migrateTrashFolder(); }catch(e){}  // 옛 휴지통 폴더 → 새 방식으로 정리
        try{ purgeTrash(); }catch(e){}          // 30일 지난 휴지통 항목 정리
        if(!SB){
            notebooks=sortNBs(JSON.parse(localStorage.getItem('sdy_local_nbs')||'[]'));
            renderGrid();
            try{ await pullSettings(); }catch(e){}
            _nbsLoaded=true;
            return;
        }
        syncStart();
        try{
            const{data,error}=await SB.from('notebooks').select('*').order('created_at',{ascending:true});
            if(error) throw error;
            const local=JSON.parse(localStorage.getItem('sdy_local_nbs')||'[]');
            // 영구 삭제한 노트는 서버 재조회 때도 되살아나지 않게 제외 (tombstone)
            const gone=getTombstones().notebooks||{};
            const server=(data||[]).filter(nb=>{
                if(nb.title===SETTINGS_TITLE){ settingsNbId=nb.id; return false; }  // 설정 저장용 숨김 노트
                if(gone[nb.id]) return false;                                       // 영구 삭제분 제외
                return true;
            });
            notebooks=sortNBs([...server, ...local]);   // 로컬 전용 노트도 함께 표시
            renderGrid();
            // ── 목록이 뜨면 사용자는 이미 쓸 수 있다.
            //    나머지(밀린 전송·설정·미리보기)는 화면을 막지 않고 뒤에서 처리한다.
            //    예전엔 이걸 전부 await 로 줄세워서 첫 화면이 그만큼 늦었다.
            (async()=>{
                try{
                    // 서버 설정을 먼저 복원한 뒤에만 밀린 데이터를 전송한다.
                    // 이전 기기의 오래된 localStorage가 최신 폴더/북마크를 덮어쓰던 경쟁 상태를 막는다.
                    await pullSettings().catch(()=>{});
                    await Promise.all([
                        flushOutbox(true).catch(()=>{}),
                        restoreAdmin().catch(()=>{}),
                    ]);
                    await preloadPreviews();
                    if(adminMode){ await adminUnlockAll(); renderGrid(); }
                }catch(e){}
            })();
        }catch(err){
            console.warn('서버 연결 실패 - 로컬 모드:',err);
            notebooks=sortNBs(JSON.parse(localStorage.getItem('sdy_local_nbs')||'[]'));
            renderGrid();
            await restoreAdmin();
        }finally{ syncEnd(); _nbsLoaded=true; }
    }

    async function preloadPreviews(){
        if(!SB) return;
        // 미리보기가 없는 노트만 추린다
        const need=notebooks.filter(nb=>{
            const cfg=getCfg(nb.id);
            if(cfg.trashed_at) return false;
            return !(Array.isArray(cfg.pages)&&cfg.pages.length);
        });
        if(!need.length) return;
        // 예전엔 노트를 '한 개씩 차례로' 받아서, 20개면 왕복 20번이었다
        // (첫 화면이 눈에 띄게 느려지는 주범) → 한 번에 몰아서 받는다.
        try{
            const ids=need.map(nb=>nb.id);
            const out=[];
            for(let i=0;i<ids.length;i+=40){          // URL 길이 안전선
                const{data,error}=await SB.from('memos')
                    .select('notebook_id,content,created_at')
                    .in('notebook_id',ids.slice(i,i+40))
                    .order('created_at');
                if(error) throw error;
                if(data) out.push(...data);
            }
            const first=new Map();
            out.forEach(m=>{ if(!first.has(m.notebook_id)) first.set(m.notebook_id,m.content); });
            // ★ 받아온 사이에 그 노트에 본문이 생겼을 수도 있다(가져오기 직후 등).
            //   그런 노트에 서버 내용을 덮으면 저장 공간이 꽉 차서 '다른 노트의
            //   본문'까지 밀려난다 → 반드시 아직 비어 있는 노트만 채운다.
            first.forEach((content,nbId)=>{
                if(!content) return;
                const c=getCfg(nbId);
                if(Array.isArray(c.pages)&&c.pages.some(pg=>(pg&&pg.els||[]).length)) return;
                applyServerState(nbId,content);
            });
            // 최초 목록 렌더 뒤에 미리보기 본문이 도착한다. _gridSig 는 의도적으로
            // 카드 메타만 포함하므로 일반 renderGrid() 는 "변경 없음"으로 빠지고,
            // 기존 카드의 _render 클로저는 로딩 전의 빈 d 를 계속 가리키게 된다.
            // 데이터 의존성이 바뀐 이 지점에서는 반드시 카드를 다시 만들어 새 문서를
            // 캡처한다 (React라면 preview data/revision을 effect 의존성에 넣는 것과 동일).
            renderGrid(true);
            return;
        }catch(e){ console.warn('미리보기 일괄 로드 실패 → 개별 로드',e); }
        // 실패 시에만 예전 방식 (동시 6개씩)
        let k=0;
        const worker=async()=>{
            while(k<need.length){
                const nb=need[k++];
                try{
                    const{data:ms}=await SB.from('memos').select('*')
                        .eq('notebook_id',nb.id).order('created_at').limit(1);
                    if(ms&&ms.length&&ms[0].content) applyServerState(nb.id,ms[0].content);
                }catch(e){}
            }
        };
        await Promise.all(Array.from({length:Math.min(6,need.length)},worker));
        // fallback 로드도 최초 카드가 캡처한 빈 문서 참조를 교체해야 한다.
        renderGrid(true);
    }

    function applyServerState(nbId, raw){
        let st=null;
        try{ st=JSON.parse(raw); }catch(e){ return; }
        if(!st||typeof st!=='object') return;
        const cfg=getCfg(nbId);
        // 휴지통에 있는 노트는 서버 상태로 덮어쓰지 않는다 (부활 방지)
        if(cfg.trashed_at) return;
        // 로컬에 더 최신(미전송) 편집이 있으면 서버의 옛 내용으로 덮어쓰지 않는다
        if(hasPendingLocal(nbId)) return;
        // 대용량 가져온 문서 마커: 본문은 서버에서 받아온다 (어느 기기든)
        if(st.serverDoc){
            cfg.serverDoc=st.serverDoc;
            if(st.sizePreset) cfg.sizePreset=st.sizePreset;
            if(st.paper) cfg.paper=st.paper;
            if(st.glossary) cfg.glossary=st.glossary;      // 6.1 용어 사전 공유
            if(!(cfg.pages||[]).some(p=>(p.els||[]).length)) delete cfg.pages;  // 옛 빈화면 캐시 제거
            setCfg(nbId,cfg);
            return;
        }
        // 서버 쪽이 비어 있는데 기기에 내용이 있으면 덮어쓰지 않는다.
        // (가져오기 직후 등, 아직 서버에 안 올라간 본문이 사라지는 것을 막는다)
        try{
            const cnt=(arr)=>(arr||[]).reduce((n,pg)=>n+((pg&&pg.els)||[]).length,0);
            const srvN=cnt(st.pages), locN=cnt(cfg.pages);
            const srvT=(st.pages||[]).reduce((n,pg)=>n+((pg&&pg.tables)||[]).length,0);
            if(!st.encBlob && srvN===0 && srvT===0 && locN>0) return;
        }catch(e){}
        if(st.locked&&st.encBlob){
            cfg.lock={salt:st.lock&&st.lock.salt, escrow:(st.lock&&st.lock.escrow)||undefined, enc:true};
            cfg.encBlob=st.encBlob;
            cfg.paper=st.paper||cfg.paper; cfg.sizePreset=st.sizePreset||cfg.sizePreset;
            // 9.1 · 설정 채널이 이모지의 주인. 내 최신 변경은 본문 값으로 덮지 않는다.
            if(st.emoji!==undefined && !shouldKeepLocalEmoji(nbId)) cfg.emoji=st.emoji;
            delete cfg.pages;
            setCfg(nbId,cfg);
            return;
        }
        if(Array.isArray(st.pages)){
            cfg.pages=st.pages; cfg.paper=st.paper||cfg.paper;
            cfg.sizePreset=st.sizePreset||cfg.sizePreset;
            // 9.1 · 설정 채널이 이모지의 주인. 내 최신 변경은 본문 값으로 덮지 않는다.
            if(st.emoji!==undefined && !shouldKeepLocalEmoji(nbId)) cfg.emoji=st.emoji;
            if(st.glossary) cfg.glossary=st.glossary;
            delete cfg.textBoxes; delete cfg.previewImgs; delete cfg.drawing;
            const okSet=setCfg(nbId,cfg);
            if(!okSet&&st.serverDoc){
                // 용량 초과 → 참조만 저장(열 때 서버에서 슬라이스로 로드)
                // ★ trashed_at 등 기존 플래그를 보존해야 부활/상태유실이 없다
                const rc={serverDoc:st.serverDoc,paper:cfg.paper,
                          sizePreset:cfg.sizePreset,emoji:cfg.emoji,
                          folder:cfg.folder, trashed_at:cfg.trashed_at,
                          __prevFolder:cfg.__prevFolder, pinned:cfg.pinned,
                          lock:cfg.lock, encBlob:cfg.encBlob, glossary:cfg.glossary};
                setCfg(nbId,rc);
            }
        }else{
            if(Array.isArray(st.textBoxes)) cfg.textBoxes=st.textBoxes;
            if(st.paper) cfg.paper=st.paper;
            if(st.sizePreset) cfg.sizePreset=st.sizePreset;
            // 9.1 · 설정 채널이 이모지의 주인. 내 최신 변경은 본문 값으로 덮지 않는다.
            if(st.emoji!==undefined && !shouldKeepLocalEmoji(nbId)) cfg.emoji=st.emoji;
            if(typeof st.drawing==='string'&&st.drawing) cfg.drawing=st.drawing;
            setCfg(nbId,cfg);
            persistDoc(nbId, migrate(getCfg(nbId), nbId));
        }
    }

    function renderBreadcrumb(){
        const bc=document.getElementById('breadcrumb');
        if(!bc) return;
        if(!curFolder){ bc.style.display='none'; return; }
        const path=folderPath(curFolder);
        const f=path[path.length-1];
        bc.style.display='flex';
        let trail=`<button onclick="openFolder(null)"><i class="ri-home-4-line"></i> 전체 노트</button>`;
        // 조상 폴더들 → 눌러서 그 층으로 바로 이동
        path.slice(0,-1).forEach(a=>{
            trail+=`<span style="color:var(--text3)">/</span>`+
                   `<button onclick="openFolder('${a.id}')">`+
                   `<i class="${a.icon||'ri-folder-3-fill'}" style="color:${a.color||'var(--accent)'}"></i> ${esc(a.name)}</button>`;
        });
        bc.innerHTML=trail+
            `<span style="color:var(--text3)">/</span>`+
            `<span style="font-weight:600;color:var(--text1)"><i class="${(f&&f.icon)||'ri-folder-fill'}" style="color:${(f&&f.color)||'var(--accent)'}"></i> ${esc(f?f.name:'폴더')}</span>`+
            `<button onclick="createSubFolder()" title="이 안에 새 폴더"><i class="ri-folder-add-line"></i></button>`+
            `<button onclick="renameFolder('${curFolder}')" title="이름 변경"><i class="ri-edit-line"></i></button>`+
            `<button onclick="openFolderStyle('${curFolder}')" title="색 · 아이콘"><i class="ri-palette-line"></i></button>`+
            `<button onclick="toggleFolderLock('${curFolder}')" title="${isFolderLocked(curFolder)?'폴더 잠금 해제':'폴더 잠그기'}">`+
              `<i class="${isFolderLocked(curFolder)?'ri-lock-2-fill':'ri-lock-unlock-line'}"></i></button>`+
            `<button onclick="removeFolder('${curFolder}')" title="폴더 삭제" style="color:#e74c3c"><i class="ri-delete-bin-line"></i></button>`;
    }
    function createSubFolder(){
        const name=prompt('새 폴더 이름','새 폴더');
        if(name===null) return;
        const nf=createFolder((name||'').trim()||'새 폴더',[]);
        renderGrid();
        playFolderCreateAnim(nf.id);
        toast(`'${nf.name}' 폴더를 안에 만들었습니다`,1800);
    }
    async function openFolder(fid, skipNav){
        if(fid){
            // 위쪽 조상까지 차례로 확인 (잠긴 폴더 안의 하위 폴더 보호)
            for(const f of folderPath(fid)){
                if(!(await tryOpenFolder(f.id))) return;
            }
        }else{
            // 홈(최상위)에 들어오면 두 노트 줄부터 보여 주고, 클래식 새 노트
            // 버튼은 그 바로 위에 숨겨 둔다.
            _homeEnterScroll=true;
        }
        curFolder=fid; cancelSelect(); renderGrid();
        if(!skipNav) openNav(()=>openFolder(folderParent(fid), true));   // 뒤로가기 → 상위 폴더로
    }
    const FOLDER_COLORS=['#4f6ef7','#e74c3c','#f39c12','#27ae60','#16a085','#8e44ad','#e91e63','#795548','#607d8b','#111827'];
    const FOLDER_ICONS=['ri-folder-3-fill','ri-briefcase-4-fill','ri-book-2-fill','ri-heart-3-fill',
                        'ri-star-smile-fill','ri-lightbulb-flash-fill','ri-flask-fill','ri-plane-fill',
                        'ri-home-4-fill','ri-shopping-bag-3-fill','ri-music-2-fill','ri-camera-lens-fill'];

    function openFolderMenu(e,fid){
        ctxNB=null;
        const f=getFolders().find(x=>x.id===fid); if(!f) return;
        const m=document.getElementById('ctxMenu');
        m.innerHTML=`
            <div class="ctx-item" onclick="closeCtxMenu();openFolder('${fid}')"><i class="ri-folder-open-line"></i> 열기</div>
            <div class="ctx-item" onclick="closeCtxMenu();renameFolder('${fid}')"><i class="ri-edit-line"></i> 이름 변경</div>
            <div class="ctx-item" onclick="closeCtxMenu();openFolderStyle('${fid}')"><i class="ri-palette-line"></i> 색 · 아이콘 변경</div>
            <div class="ctx-sep"></div>
            <div class="ctx-item" onclick="closeCtxMenu();toggleFolderLock('${fid}')">
                <i class="ri-lock-2-line"></i> ${isFolderLocked(fid)?'폴더 잠금 해제':'폴더 잠그기'}</div>
            <div class="ctx-item" onclick="closeCtxMenu();openFolderMoveMenu(event,'${fid}')"><i class="ri-folder-transfer-line"></i> 다른 폴더로 옮기기</div>
            <div class="ctx-item" onclick="closeCtxMenu();emptyFolder('${fid}')"><i class="ri-inbox-unarchive-line"></i> 노트 모두 꺼내기</div>
            <div class="ctx-item danger" onclick="closeCtxMenu();removeFolder('${fid}')"><i class="ri-delete-bin-6-line"></i> 폴더 삭제</div>`;
        m.classList.add('show');
        // fixed 메뉴 — 화면 px → CSS px 로 바꿔야 배율(90%)만큼 밀리지 않는다
        m.style.left=Math.min(window.sdyUiCss(e.clientX),window.sdyUiCss(window.innerWidth)-210)+'px';
        m.style.top=Math.min(window.sdyUiCss(e.clientY),window.sdyUiCss(window.innerHeight)-230)+'px';
    }

    let styleFid=null;
    function openFolderStyle(fid){
        const f=getFolders().find(x=>x.id===fid); if(!f) return;
        styleFid=fid;
        const cur=f.color||'#4f6ef7', ci=f.icon||'ri-folder-3-fill';
        document.getElementById('fsColors').innerHTML=FOLDER_COLORS.map(c=>
            `<div class="fcolor-dot ${c===cur?'on':''}" style="background:${c}" data-c="${c}"
                  onclick="pickFolderColor('${c}')">${c===cur?'<i class="ri-check-line"></i>':''}</div>`).join('');
        document.getElementById('fsIcons').innerHTML=FOLDER_ICONS.map(ic=>
            `<div class="ficon-btn ${ic===ci?'on':''}" onclick="pickFolderIcon('${ic}')"><i class="${ic}"></i></div>`).join('');
        document.getElementById('fsPreviewName').textContent=f.name;
        updateFolderPreview();
        document.getElementById('folderStyleModal').style.display='flex';
        openNav(closeFolderStyle);
    }
    function closeFolderStyle(){ document.getElementById('folderStyleModal').style.display='none'; styleFid=null; navDrop(closeFolderStyle); }
    function pickFolderColor(c){
        const f=getFolders().find(x=>x.id===styleFid); if(!f) return;
        f.color=c; saveFolders(getFolders().map(x=>x.id===styleFid?f:x));
        openFolderStyleRefresh(); renderGrid();
    }
    function pickFolderIcon(ic){
        const f=getFolders().find(x=>x.id===styleFid); if(!f) return;
        f.icon=ic; saveFolders(getFolders().map(x=>x.id===styleFid?f:x));
        openFolderStyleRefresh(); renderGrid();
    }
    function openFolderStyleRefresh(){
        const f=getFolders().find(x=>x.id===styleFid); if(!f) return;
        const cur=f.color||'#4f6ef7', ci=f.icon||'ri-folder-3-fill';
        document.querySelectorAll('#fsColors .fcolor-dot').forEach(d=>{
            const on=d.dataset.c===cur;
            d.classList.toggle('on',on); d.innerHTML=on?'<i class="ri-check-line"></i>':'';
        });
        document.querySelectorAll('#fsIcons .ficon-btn').forEach(bn=>{
            bn.classList.toggle('on', bn.querySelector('i').className===ci);
        });
        updateFolderPreview();
    }
    function updateFolderPreview(){
        const f=getFolders().find(x=>x.id===styleFid); if(!f) return;
        const c=f.color||'#4f6ef7', ic=f.icon||'ri-folder-3-fill';
        const pv=document.getElementById('fsPreview');
        pv.style.background=hexA(c,.10);
        pv.innerHTML=`<i class="${ic}" style="font-size:52px;color:${c};filter:drop-shadow(0 4px 10px ${hexA(c,.3)})"></i>`;
    }
    function emptyFolder(fid){
        // 9.3 · 잠긴 폴더는 내용물을 꺼낼 수 없다.
        //  (잠금을 안 풀고도 노트를 밖으로 빼내면 잠금이 무의미해진다)
        if(isFolderLocked(fid)&&!isFolderOpen(fid)){
            toast('🔒 잠긴 폴더에서는 노트를 꺼낼 수 없습니다',2400); return;
        }
        const list=notebooks.filter(n=>noteFolder(n.id)===fid);
        if(!list.length){ toast('폴더가 비어 있습니다',1400); return; }
        if(!confirm(`${list.length}개 노트를 폴더 밖으로 꺼낼까요? (노트는 삭제되지 않습니다)`)) return;
        list.forEach(n=>setNoteFolder(n.id,null));
        renderGrid(); toast(`${list.length}개 노트를 꺼냈습니다`);
    }

    function renameFolder(fid){
        if(isTrashFolder(fid)){ toast('휴지통 폴더는 이름을 바꿀 수 없습니다',2000); return; }
        const f=getFolders(); const t=f.find(x=>x.id===fid);
        const n=prompt('폴더 이름',t?t.name:'');
        if(n&&n.trim()){ t.name=n.trim(); saveFolders(f); renderGrid(); toast('이름 변경됨'); }
    }
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


    // ============ 자주 가는 링크 ============
    const DEFAULT_LINKS=[{name:'내 블로그',url:'https://blog.naver.com/troy218'}];
    const SETTINGS_TITLE='__sdy_settings__';
    let settingsNbId=null, settingsMemoId=null;

    // 북마크/재생목록은 배열 하나를 통째로 덮어쓰지 않고 항목별 ID로 동기화한다.
    // 서로 다른 기기에서 동시에 하나씩 추가해도 둘 다 남는다.
    function stableItemId(prefix,text){
        let h=2166136261; const s=String(text||'');
        for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); }
        return prefix+(h>>>0).toString(36);
    }
    function normalizeLinks(a){
        const seen=new Set(), out=[];
        (Array.isArray(a)?a:[]).forEach((x,i)=>{
            if(!x||!x.url) return;
            const url=String(x.url).trim(), id=x.id||stableItemId('bm_',url.replace(/\/$/,''));
            if(seen.has(id)) return; seen.add(id);
            out.push({id,name:String(x.name||'링크'),url,order:Number.isFinite(+x.order)?+x.order:i});
        });
        return out.sort((a,b)=>(a.order-b.order)||a.id.localeCompare(b.id))
                  .map((x,i)=>Object.assign(x,{order:i}));
    }
    function getLinks(){
        try{
            const raw=localStorage.getItem('sdy_links');
            const arr=normalizeLinks(raw===null?DEFAULT_LINKS:JSON.parse(raw));
            const packed=JSON.stringify(arr);
            if(raw!==packed) localStorage.setItem('sdy_links',packed);
            return arr;
        }catch(e){ return normalizeLinks(DEFAULT_LINKS); }
    }
    function saveLinks(l){
        const before=getLinks(), after=normalizeLinks(l);
        localStorage.setItem('sdy_links',JSON.stringify(after));
        try{ _queueCollectionDiff('bookmark',before,after); }catch(e){}
        pushSettingsNow();       // 북마크 변경도 즉시 서버 반영
    }

    // ===== 재생목록(플레이리스트) =====
    // 목록과 곡 소속도 각각 별도 키로 저장한다. 한 기기의 오래된 빈 목록이
    // 다른 기기의 재생목록 전체를 지우는 일을 막는다.
    function normalizePlaylists(a){
        const seen=new Set();
        return (Array.isArray(a)?a:[]).filter(Boolean).map((p,i)=>{
            const id=p.id||stableItemId('pl_',String(p.name||'재생목록')+'|'+i);
            return {id,name:String(p.name||'재생목록'),order:Number.isFinite(+p.order)?+p.order:i,
                    tracks:[...new Set(Array.isArray(p.tracks)?p.tracks.map(String):[])]};
        }).filter(p=>{ if(seen.has(p.id)) return false; seen.add(p.id); return true; })
          .sort((a,b)=>(a.order-b.order)||a.id.localeCompare(b.id))
          .map((p,i)=>Object.assign(p,{order:i}));
    }
    function getPlaylists(){
        try{
            const raw=localStorage.getItem('sdy_playlists')||'[]';
            const arr=normalizePlaylists(JSON.parse(raw));
            if(raw!==JSON.stringify(arr)) localStorage.setItem('sdy_playlists',JSON.stringify(arr));
            return arr;
        }catch(e){ return []; }
    }
    function savePlaylists(p){
        const before=getPlaylists(), after=normalizePlaylists(p);
        try{ localStorage.setItem('sdy_playlists',JSON.stringify(after)); }catch(e){}
        try{ _queuePlaylistDiff(before,after); }catch(e){}
        try{ if(typeof pushSettingsNow==='function') pushSettingsNow(); }catch(e){}
        try{ document.dispatchEvent(new CustomEvent('sdy-playlists-updated')); }catch(e){}
    }
    window.sdyGetPlaylists=getPlaylists;
    window.sdySavePlaylists=savePlaylists;

    // ===== 삭제 기록 (지운 항목이 서버 동기화로 되살아나지 않게) =====
    const TOMB_KEY='sdy_deleted';
    function getTombstones(){
        try{ return JSON.parse(localStorage.getItem(TOMB_KEY)||'{}'); }catch(e){ return {}; }
    }
    function saveTombstones(t){ localStorage.setItem(TOMB_KEY,JSON.stringify(t)); }
    function tombstone(kind,key){
        if(!key) return;
        const t=getTombstones();
        t[kind]=t[kind]||{};
        t[kind][key]=Date.now();
        saveTombstones(t);
    }
    function untombstone(kind,key){
        const t=getTombstones();
        if(t[kind]&&t[kind][key]){ delete t[kind][key]; saveTombstones(t); }
    }

    // ===== 8.17 안전 마이그레이션 =====
    // 예전 버전처럼 로컬 북마크·폴더를 먼저 비우지 않는다. 로컬을 보존한 채
    // 서버 항목과 ID 단위로 병합한 뒤에만 차이를 올려 재접속 충돌을 막는다.
    const CLIENT_CACHE_SCHEMA='sdy_client_cache_8_17';
    function resetStaleBrowserSettings(){
        try{
            if(localStorage.getItem(CLIENT_CACHE_SCHEMA)) return false;
            const links=getLinks();
            const playlists=getPlaylists();
            localStorage.setItem('sdy_links',JSON.stringify(links));
            localStorage.setItem('sdy_playlists',JSON.stringify(playlists));
            try{ sessionStorage.removeItem('sdy_settings_cursor'); }catch(e){}
            localStorage.setItem(CLIENT_CACHE_SCHEMA,'1');
            return true;
        }catch(e){ return false; }
    }

    // ===== 설정(폴더·소속·휴지통·고정·북마크) 동기화 — 키별 LWW =====
    // 예전엔 설정을 '숨김 노트 1개'에 통째로 덮어썼다. 두 기기가 동시에 바꾸면
    // 서로의 변경을 지워서: 폴더가 사라지고, 휴지통/이동이 전파되지 않았다.
    // 이제 요소 동기화(/api/sync/*)와 같은 '키별 LWW + 삭제 연산'으로 교체했다.
    //   key: folder:<id> / member:<노트id> / trash:<노트id> / pin:<노트id>
    //        bookmark:<id> / playlist:<id> / pltrack:<목록id>:<곡id>
    // 북마크·재생목록은 항목별 LWW라 서로 다른 기기의 추가/삭제가 통째로 충돌하지 않는다.
    const SET_NS=SANDBOX?'__settings_sandbox__':'__settings__';
    try{ window.SET_NS=SET_NS; }catch(e){}
    const SET_DEV=(()=>{ try{ let v=localStorage.getItem('sdy_dev');
        if(!v){ v='d_'+Math.random().toString(36).slice(2,10); localStorage.setItem('sdy_dev',v); }
        return v; }catch(e){ return 'd_x'; } })();
    try{ window.SET_DEV=SET_DEV; }catch(e){}
    let _stSince=0;                 // 서버 버전 커서
    let _stRev=Date.now();          // 로컬 rev 발생기(단조 증가)
    let _stDirty=true;              // 아직 서버에 못 보낸 로컬 설정이 있는가 (첫 로드 포함)
    const _stHash=new Map();        // key -> 직렬화 값 (마지막으로 확정된 상태)
    const _stLocalRev=new Map();    // key -> 내가 붙인 rev (echo/회귀 방지)
    const _stApplied=new Map();     // key -> 마지막으로 반영한 rev (전체 pull 재반영·깜빡임 방지)
    let _stCacheReset=true;         // 첫 pull 전에는 오래된 기기 상태를 절대 push하지 않는다
    const ST_OUT_KEY='sdy_settings_outbox_8_17';
    function _stOutLoad(){ try{ return JSON.parse(localStorage.getItem(ST_OUT_KEY)||'{}'); }catch(e){ return {}; } }
    let _stOut=_stOutLoad();
    Object.values(_stOut).forEach(o=>{ if(o&&o.id&&o.rev) _stLocalRev.set(o.id,o.rev); });

    function _stNow(){
        // 14.9 · ms 단위 시계는 기기 간 rev 충돌을 만든다. 같은 ms에 두 기기가
        //  설정을 올리면 rev가 같아져 서버 LWW가 한쪽을 버리고, 시계가 느린 기기의
        //  편집은 '이미 지난 rev'로 오인돼 다른 기기가 못 받았다(폴더 이름이 옆 값으로
        //  바뀌어 보이던 원인). 서브 ms 난수로 rev를 유일하게 만든다.
        _stRev=Math.max(_stRev+1, Date.now()+Math.random());
        return _stRev;
    }
    function _stOutSave(){
        try{ localStorage.setItem(ST_OUT_KEY,JSON.stringify(_stOut)); }catch(e){}
    }
    function _stQueueOp(id,kind,data){
        const op={id,kind,rev:_stNow(),dev:SET_DEV};
        if(kind!=='del') op.data=data;
        _stOut[id]=op; _stLocalRev.set(id,op.rev); _stDirty=true; _stOutSave();
        return op;
    }
    function _stDropOp(id){ delete _stOut[id]; _stLocalRev.delete(id); _stOutSave(); }
    function _bookmarkPayload(x){ return {id:x.id,name:x.name,url:x.url,order:+x.order||0}; }
    function _playlistPayload(x){ return {id:x.id,name:x.name,order:+x.order||0}; }
    function _queueCollectionDiff(kind,before,after){
        const a=new Map((before||[]).map(x=>[x.id,x]));
        const b=new Map((after||[]).map(x=>[x.id,x]));
        a.forEach((x,id)=>{ if(!b.has(id)) _stQueueOp(kind+':'+id,'del'); });
        b.forEach((x,id)=>{
            const data=_bookmarkPayload(x), old=a.get(id);
            if(!old||JSON.stringify(_bookmarkPayload(old))!==JSON.stringify(data))
                _stQueueOp(kind+':'+id,'put',data);
        });
    }
    function _ptKey(pid,tid){ return 'pltrack:'+encodeURIComponent(pid)+':'+encodeURIComponent(tid); }
    function _queuePlaylistDiff(before,after){
        const a=new Map((before||[]).map(x=>[x.id,x]));
        const b=new Map((after||[]).map(x=>[x.id,x]));
        a.forEach((p,id)=>{
            if(!b.has(id)){
                _stQueueOp('playlist:'+id,'del');
                (p.tracks||[]).forEach(t=>_stQueueOp(_ptKey(id,t),'del'));
            }
        });
        b.forEach((p,id)=>{
            const old=a.get(id), data=_playlistPayload(p);
            if(!old||JSON.stringify(_playlistPayload(old))!==JSON.stringify(data))
                _stQueueOp('playlist:'+id,'put',data);
            const ot=new Map(((old&&old.tracks)||[]).map((t,i)=>[String(t),i]));
            const nt=new Map((p.tracks||[]).map((t,i)=>[String(t),i]));
            ot.forEach((ord,t)=>{ if(!nt.has(t)) _stQueueOp(_ptKey(id,t),'del'); });
            nt.forEach((ord,t)=>{
                if(!ot.has(t)||ot.get(t)!==ord)
                    _stQueueOp(_ptKey(id,t),'put',{playlist:id,track:t,order:ord});
            });
        });
    }

    // 14.9 · 폴더 객체를 안정적으로 직렬화한다. 기기마다 localStorage 에
    //  JSON 키 순서가 달라서 '내용은 같은데 문자열만 다름' → 계속 재전송(에코)
    //  → 새 rev 로 낡은 폴더가 다시 이기는 rev 경쟁이 생겼다. (이름이 옆 폴더
    //  이름으로 바뀌어 보이던 원인) 키 순서를 고정해 가짜 변경 감지를 없앤다.
    function _canonFolder(f){
        const o={};
        ['id','name','color','icon','parent','created_at','order'].forEach(k=>{
            if(f[k]!==undefined) o[k]=f[k];
        });
        Object.keys(f).sort().forEach(k=>{ if(o[k]===undefined) o[k]=f[k]; });
        return o;
    }
    // 해시(마지막 확정 상태)를 만들 때도 폴더는 '적용된 로컬 객체' 기준으로
    //  정규화한다. (잠금 보존으로 로컬에 lock 이 붙어도 에코가 생기지 않는다)
    function _stHashVal(op){
        const k=op.id||'';
        if(!op.del && k.indexOf('folder:')===0){
            const f=folderById(k.slice(7));
            if(f) return JSON.stringify(_canonFolder(f));
        }
        return JSON.stringify(op.data);
    }
    // 현재 로컬 설정 상태를 key -> value|null 로 수집 (null = '없음' → 삭제 연산)
    function _stKeys(){
        const out={}; const seen=new Set();
        // 폴더는 정규화된 객체로 (lock·parent·color·icon 등 모든 필드 보존)
        getFolders().forEach(f=>{
            if(!f||!f.id) return;
            const k='folder:'+f.id; seen.add(k);
            out[k]=_canonFolder(f);
        });
        const tf=getTombstones().folders||{};
        Object.keys(tf).forEach(id=>{
            const k='folder:'+id;
            if(!seen.has(k)){ seen.add(k); out[k]=null; }
        });
        // 노트별 소속/휴지통/고정 (화면 목록 + localStorage 전체)
        const ids=new Set((notebooks||[]).map(nb=>nb.id));
        for(let i=0;i<localStorage.length;i++){
            const kk=localStorage.key(i);
            if(kk&&kk.indexOf('nb_')===0) ids.add(kk.slice(3));
        }
        ids.forEach(id=>{
            const c=getCfg(id);
            const mk='member:'+id; seen.add(mk); out[mk]=c.folder||null;
            const tk='trash:'+id; seen.add(tk); out[tk]=c.trashed_at||null;
            const pk='pin:'+id; seen.add(pk); out[pk]=c.pinned?true:null;
            const ek='emoji:'+id; seen.add(ek); out[ek]=c.emoji||null;
            // 노트별 '보기 설정' 도 기기 간에 따라오게 한다
            // (종이 무늬·용지 크기·배경색·즐겨찾는 쪽·용어 사전)
            const nk='nset:'+id; seen.add(nk);
            const ns={};
            if(c.paper&&c.paper!=='blank') ns.paper=c.paper;
            if(c.sizePreset&&c.sizePreset!=='a4_portrait') ns.sizePreset=c.sizePreset;
            if(c.tint) ns.tint=c.tint;
            if(Array.isArray(c.favPages)&&c.favPages.length) ns.favPages=c.favPages;
            if(c.glossary&&Object.keys(c.glossary).length) ns.glossary=c.glossary;
            out[nk]=Object.keys(ns).length?ns:null;
        });
        // 북마크는 URL 배열 전체가 아니라 항목 하나당 키 하나
        getLinks().forEach(x=>{ const k='bookmark:'+x.id; seen.add(k); out[k]=_bookmarkPayload(x); });
        // 재생목록 이름/순서와 곡 소속도 각각 별도 키
        getPlaylists().forEach(p=>{
            const pk='playlist:'+p.id; seen.add(pk); out[pk]=_playlistPayload(p);
            (p.tracks||[]).forEach((t,i)=>{
                const k=_ptKey(p.id,t); seen.add(k); out[k]={playlist:p.id,track:String(t),order:i};
            });
        });
        // 앱 전체 설정(테마·강조색·기본 글꼴/크기 등)도 기기 간 공유
        seen.add('appset'); out['appset']=_appSetPayload();
        seen.add('adminedits'); out['adminedits']=getAdminEdits();
        return out;
    }

    // 로컬과 마지막 확정 상태(_stHash)를 비교해 보낼 연산을 만든다 (상태 변경 없음)
    function _stDiff(){
        const cur=_stKeys(); const ops=[]; const seen=new Set();
        for(const k in cur){
            seen.add(k); const v=cur[k];
            if(v===null){
                if(_stHash.has(k)&&_stHash.get(k)!==null) ops.push({id:k,kind:'del'});
            }else{
                if(_stHash.get(k)!==JSON.stringify(v)) ops.push({id:k,kind:'put',data:v});
            }
        }
        for(const [k,v] of Array.from(_stHash.entries())){
            if(!seen.has(k)&&v!==null) ops.push({id:k,kind:'del'});
        }
        return _stGuardDeletes(ops);
    }

    // 9.4 · 대량 삭제 방화벽 ─ 사고로 컬렉션이 통째로 날아가지 않게 한다.
    //  북마크·재생목록·폴더는 사람이 한 번에 하나씩 지운다. 한 번의 동기화에서
    //  같은 종류가 여러 개 '삭제'로 나가면 그건 사용자의 뜻이 아니라 버그다
    //  (초기화된 localStorage, 잘못된 정리 코드, 테스트 스크립트 등).
    //  그럴 땐 삭제를 보내지 않고 서버 값을 정답으로 삼아 되돌려 받는다.
    const _DEL_LIMIT={bookmark:2, playlist:2, folder:2};
    function _stGuardDeletes(ops){
        const dels={};
        ops.forEach(o=>{
            if(o.kind!=='del') return;
            const kind=String(o.id).split(':')[0];
            if(_DEL_LIMIT[kind]) (dels[kind]=dels[kind]||[]).push(o.id);
        });
        const blocked=new Set();
        Object.keys(dels).forEach(kind=>{
            if(dels[kind].length>_DEL_LIMIT[kind]){
                dels[kind].forEach(id=>blocked.add(id));
                console.warn('[동기화 보호] '+kind+' 삭제 '+dels[kind].length+'건을 막았습니다 (사용자 삭제가 아님)');
                try{ toast('⚠️ 비정상적인 대량 삭제를 막았습니다 · 서버 데이터를 유지합니다',3400); }catch(e){}
                // 서버 것을 다시 받아 로컬을 복구한다
                setTimeout(()=>{ _stSince=0; _stHash.clear(); _stApplied.clear(); pullSettings(); },60);
            }
        });
        if(!blocked.size) return ops;
        return ops.filter(o=>!(o.kind==='del'&&blocked.has(o.id)));
    }

    // ══════════════════════════════════════════════════════════
    //  11.3 · '업데이트 전 화면' 보호
    //   오래 켜 둔 탭이나 옛 캐시로 들어온 화면은 새 저장 구조를 모른다.
    //   그 화면이 설정을 올리면 서버의 새 항목을 '없는 것'으로 보고 지워서
    //   북마크가 사라지거나 순서가 바뀌고, 노트가 폴더에서 튀어나왔다.
    //   → ① 보낼 때 자료 구조 판 번호(schema)를 같이 보낸다.
    //     ② 서버가 다르면 저장을 거부(409)하고, 이 화면은 쓰기를 멈춘 뒤
    //        '새로고침' 안내를 띄운다.
    //     ③ 새 판이 배포되면 스스로 알아채고(페이지 지문 비교) 같은 처리를 한다.
    // ══════════════════════════════════════════════════════════
    const SETTINGS_SCHEMA=3;
    const APP_VER=(document.querySelector('meta[name="application-version"]')||{}).content||'';
    let _stFrozen=false, _verSeen=null, _staleShown=false;
    function _markStale(info){
        if(_stFrozen) return;
        _stFrozen=true;                       // 이 화면에서 설정 쓰기 중단 (데이터 보호)
        try{ clearTimeout(pushTimer); }catch(e){}
        if(_staleShown) return;
        _staleShown=true;
        const bar=document.createElement('div');
        bar.id='staleBar';
        bar.innerHTML='<i class="ri-refresh-line"></i>'+
            '<b>새 버전이 나왔어요</b>'+
            '<span>이 화면은 예전 버전이라 설정 저장을 멈췄습니다 · 새로고침하면 정상으로 돌아와요</span>'+
            '<button id="staleReload">지금 새로고침</button>';
        document.body.appendChild(bar);
        document.getElementById('staleReload').onclick=()=>hardReload();
        try{ toast('예전 버전 화면이에요 · 새로고침해 주세요',5000); }catch(e){}
        // 편집 중이 아니면 20초 뒤 알아서 새로고침
        setTimeout(()=>{
            try{
                const editing=document.getElementById('editorView')
                    && document.getElementById('editorView').classList.contains('open');
                if(!editing && !outboxCount()) hardReload();
            }catch(e){}
        },20000);
    }
    async function hardReload(){
        try{ if(window.caches&&caches.keys){ const ks=await caches.keys();
              await Promise.all(ks.map(k=>caches.delete(k))); } }catch(e){}
        try{ location.reload(); }catch(e){ location.href=location.pathname; }
    }
    async function checkAppVersion(){
        if(_stFrozen||!isOnline()) return;
        try{
            const r=await fetch('/api/version',{cache:'no-store'});
            if(!r.ok) return;
            const d=await r.json();
            if(!d||!d.ok) return;
            const sig=d.page||d.version||'';
            if(_verSeen===null){ _verSeen=sig; }
            // ① 서버 화면 파일이 바뀌었다(배포됨) ② 저장 구조가 다르다 ③ 판 번호가 다르다
            if(sig!==_verSeen
               || (d.schema&&d.schema!==SETTINGS_SCHEMA)
               || (d.version&&APP_VER&&d.version!==APP_VER)) _markStale(d);
        }catch(e){}
    }
    setTimeout(checkAppVersion,3000);
    setInterval(checkAppVersion,60000);
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden) checkAppVersion(); });
    window.addEventListener('online',()=>setTimeout(checkAppVersion,800));
    try{ window.sdySchema=SETTINGS_SCHEMA; }catch(e){}

    async function _stPush(ops){
        if(_stFrozen) return null;            // 예전 화면은 아무것도 덮어쓰지 않는다
        const r=await fetch('/api/sync/push',{method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({nb:SET_NS, schema:SETTINGS_SCHEMA, ops})});
        if(r.status===409){                   // 서버가 '오래된 화면' 이라고 알려 줌
            const info=await r.json().catch(()=>({}));
            _markStale(info);
            return null;
        }
        const d=await r.json().catch(()=>({}));
        if(!r.ok||!d.ok) return null;
        if(Array.isArray(d.blocked)&&d.blocked.length){
            // 서버가 대량 삭제를 막았다 → 서버 값을 정답으로 삼아 되돌려 받는다
            console.warn('[동기화 보호] 서버가 삭제 '+d.blocked.length+'건을 막았습니다');
            try{ toast('⚠️ 비정상적인 대량 삭제를 막았습니다 · 서버 데이터를 유지합니다',3400); }catch(e){}
            d.blocked.forEach(id=>{ delete _stOut[id]; _stLocalRev.delete(id); });
            _stOutSave();
            setTimeout(()=>{ _stSince=0; _stHash.clear(); _stApplied.clear(); pullSettings(); },80);
        }
        // push의 서버 버전으로 pull 커서를 건너뛰지 않는다. 그래야 바로 직전에
        // 다른 기기가 보낸 변경도 다음 pull에서 반드시 받을 수 있다.
        return d;
    }

    let pushTimer=null;
    function pushSettings(){
        clearTimeout(pushTimer);
        pushTimer=setTimeout(pushSettingsNow,450);
    }
    // 지금 즉시 설정을 서버에 쓴다. 전송 전 로컬 outbox에 먼저 기록하므로
    // 탭을 닫거나 오프라인이 되어도 재접속 때 그대로 재전송된다.
    async function pushSettingsNow(){
        if(_stCacheReset) return;   // 첫 pull로 병합하기 전에는 오래된 상태를 보내지 않음
        if(_stFrozen) return;       // 11.3 · 예전 버전 화면은 설정을 덮어쓰지 않는다
        const diffs=_stDiff();
        diffs.forEach(o=>{
            const cur=_stOut[o.id];
            const same=cur&&cur.kind===o.kind&&JSON.stringify(cur.data)===JSON.stringify(o.data);
            if(!same) _stQueueOp(o.id,o.kind,o.data);
        });
        const ops=Object.values(_stOut).filter(o=>o&&o.id);
        if(!ops.length){ _stDirty=false; return; }
        const res=await _stPush(ops);
        if(!res){ _stDirty=true; return; }
        const accepted=new Set(Array.isArray(res.accepted)?res.accepted:ops.map(o=>o.id));
        const rejected=new Set(Array.isArray(res.rejected)?res.rejected:[]);
        ops.forEach(o=>{
            if(accepted.has(o.id)&&_stOut[o.id]&&_stOut[o.id].rev===o.rev){
                delete _stOut[o.id]; _stLocalRev.delete(o.id);
                _stApplied.set(o.id,o.rev);
                _stHash.set(o.id,o.kind==='del'?null:JSON.stringify(o.data));
            }
            if(rejected.has(o.id)&&_stOut[o.id]&&_stOut[o.id].rev===o.rev){
                // 서버에 더 최신 변경이 있으면 그것을 받아들이고 로컬 재전송은 중단
                delete _stOut[o.id]; _stLocalRev.delete(o.id);
            }
        });
        _stOutSave(); _stDirty=Object.keys(_stOut).length>0;
        if(rejected.size) setTimeout(pullSettings,40);
    }
    try{ window.pushSettings=pushSettings; window.pushSettingsNow=pushSettingsNow; }catch(e){}

    // 9.4 · 이름으로 사용자 데이터를 지우던 '테스트 정리' 코드는 삭제했다.
    //  예전 cleanupTestData() 는 '업무·취미·대외비…' 같은 이름의 폴더와
    //  특정 북마크를 발견하면 지우고 tombstone 까지 찍어, 그 삭제가 모든
    //  기기로 퍼졌다. 개발 중 만든 흔적을 지우려던 코드가 실제 사용자
    //  데이터를 날리는 원인이었다. 앞으로 어떤 코드도 '이름'을 근거로
    //  사용자의 북마크/폴더/재생목록을 지우지 않는다.
    function cleanupTestData(){ return false; }

    // 시작할 때 서버 설정을 불러와 병합
    // 인터넷이 돌아오면 밀린 편집을 한꺼번에 올린다
    window.addEventListener('online',()=>{
        updateOfflineUI();
        toast('인터넷 연결됨 · 동기화 중…',1800);
        setTimeout(()=>{ flushOutbox(false); pullSettings(); window.flushCardGrades&&window.flushCardGrades(); },350);
        setTimeout(()=>{ try{ retryBlockedImport(); }catch(e){} _armBlockedImportRetry(); },700);
    });
    window.addEventListener('offline',()=>{
        updateOfflineUI();
        toast('오프라인 · 변경사항은 기기에 저장됩니다',2600);
    });
    // 탭이 다시 보이거나 주기적으로도 재시도
    document.addEventListener('visibilitychange',()=>{
        if(document.hidden){
            // 나가기 전에 편집 중인 글자를 확정하고 밀린 저장을 즉시 보낸다
            try{ document.querySelectorAll('.tb.edit').forEach(w=>commitEditingText(w)); }catch(e){}
            try{ if(curNB&&doc) flushSaveDoc(); }catch(e){}
            try{ if(pendingNB) flushSync(); }catch(e){}
            try{ clearTimeout(opsTimer); pushOps(); }catch(e){}
            try{ clearTimeout(pushTimer); pushSettingsNow(); }catch(e){}   // 설정(폴더 등)도 즉시 동기화
        }else{
            flushOutbox(true);
            try{ refreshNBs(); }catch(e){}
            setTimeout(()=>{ try{ retryBlockedImport(); }catch(e){} },400);
        }
    });
    window.addEventListener('pagehide',()=>{
        try{ document.querySelectorAll('.tb.edit').forEach(w=>commitEditingText(w)); }catch(e){}
        try{ if(curNB&&doc) flushSaveDoc(); }catch(e){}
        try{ if(pendingNB) flushSync(); }catch(e){}
        try{ clearTimeout(opsTimer); pushOps(); }catch(e){}
        try{ clearTimeout(pushTimer); pushSettingsNow(); }catch(e){}   // 설정(폴더 등)도 즉시 동기화
    });
    setInterval(()=>{ if(outboxCount()) flushOutbox(true); },20000);
    // ── 실시간 설정 동기화(구글독스처럼): 다른 기기의 북마크/폴더 변경을 주기적으로 반영 ──
    setInterval(()=>{
        try{
            if(isOnline() && !document.hidden) pullSettings();
        }catch(e){}
    }, 1500);
    // 자동저장 안전망: 편집 중이면 주기적으로 확정·저장 (안될 때 보완)
    setInterval(()=>{
        try{
            if(curNB&&doc&&document.getElementById('editorView').classList.contains('open')){
                document.querySelectorAll('.tb.edit').forEach(w=>{ try{ syncTextEl(w); }catch(e){} });
                if(pendingNB) flushSync();
                // 가져온 문서 첫 슬라이스가 실패했던 경우: 주기 재시도로 복구
                if(doc.__ref&&(_nbBlocked(curNB.id)||doc.__loadFailed)) _armBlockedImportRetry();
            }
        }catch(e){}
    }, 8000);
    // 닫기 전 마지막 시도
    window.addEventListener('beforeunload',(e)=>{
        if(outboxCount()){ e.preventDefault(); e.returnValue=''; }
    });

    // ── 서버 설정을 받아 로컬에 반영 (키별 LWW, 삭제 연산 포함) ──
    function _stApplyDel(k){
        try{
            if(k.indexOf('bookmark:')===0){
                const id=k.slice(9), a=getLinks(), b=a.filter(x=>x.id!==id);
                if(a.length===b.length) return false;
                localStorage.setItem('sdy_links',JSON.stringify(normalizeLinks(b))); return true;
            }
            if(k.indexOf('playlist:')===0){
                const id=k.slice(9), a=getPlaylists(), b=a.filter(x=>x.id!==id);
                if(a.length===b.length) return false;
                localStorage.setItem('sdy_playlists',JSON.stringify(normalizePlaylists(b)));
                document.dispatchEvent(new CustomEvent('sdy-playlists-updated')); return true;
            }
            if(k.indexOf('pltrack:')===0){
                const z=k.slice(8).split(':'), pid=decodeURIComponent(z.shift()||''), tid=decodeURIComponent(z.join(':'));
                const a=getPlaylists(), p=a.find(x=>x.id===pid); if(!p) return false;
                const n=p.tracks.length; p.tracks=p.tracks.filter(x=>String(x)!==tid);
                if(n===p.tracks.length) return false;
                localStorage.setItem('sdy_playlists',JSON.stringify(normalizePlaylists(a)));
                document.dispatchEvent(new CustomEvent('sdy-playlists-updated')); return true;
            }
            if(k.indexOf('folder:')===0){
                const fid=k.slice(7);
                const fs=getFolders();
                const idx=fs.findIndex(f=>f.id===fid);
                if(idx<0) return false;
                fs.splice(idx,1);
                localStorage.setItem('sdy_folders',JSON.stringify(fs));
                tombstone('folders',fid);
                return true;
            }
            if(k.indexOf('member:')===0){
                const c=getCfg(k.slice(7));
                if(!c.folder) return false;
                delete c.folder; setCfg(k.slice(7),c); return true;
            }
            if(k.indexOf('trash:')===0){
                const c=getCfg(k.slice(6));
                if(!c.trashed_at) return false;
                delete c.trashed_at; setCfg(k.slice(6),c); return true;
            }
            if(k.indexOf('pin:')===0){
                const c=getCfg(k.slice(4));
                if(!c.pinned) return false;
                delete c.pinned; setCfg(k.slice(4),c); return true;
            }
            if(k.indexOf('emoji:')===0){
                const nbId=k.slice(6);
                const c=getCfg(nbId);
                if(!c.emoji) return false;
                delete c.emoji; setCfg(nbId,c);
                const card=document.querySelector(`.note-card[data-nb-id="${nbId}"] .emoji-badge`);
                if(card){ card.classList.remove('has-emoji'); card.innerHTML='<span style="font-size:16px;opacity:.35;">◌</span>'; }
                return false;   // DOM 직접 갱신 (전체 재렌더 불필요)
            }
        }catch(e){}
        return false;
    }
    function _stApply(op){
        const k=op.id;
        if(op.del) return _stApplyDel(k);
        const d=op.data;
        try{
            // 구버전의 통배열 키는 '병합 전용'으로만 읽고 더는 발행하지 않는다.
            // 빈 배열/오래된 배열이 최신 기기의 항목을 지울 수 없다.
            if(k==='links'){
                if(!Array.isArray(d)) return false;
                const m=new Map(getLinks().map(x=>[x.id,x]));
                normalizeLinks(d).forEach(x=>{ if(!m.has(x.id)) m.set(x.id,x); });
                localStorage.setItem('sdy_links',JSON.stringify(normalizeLinks([...m.values()])));
                return true;
            }
            if(k==='playlists'){
                if(!Array.isArray(d)) return false;
                const cur=getPlaylists(), m=new Map(cur.map(x=>[x.id,x]));
                normalizePlaylists(d).forEach(x=>{
                    const old=m.get(x.id);
                    if(old) old.tracks=[...new Set([...(old.tracks||[]),...(x.tracks||[])])];
                    else m.set(x.id,x);
                });
                localStorage.setItem('sdy_playlists',JSON.stringify(normalizePlaylists([...m.values()])));
                document.dispatchEvent(new CustomEvent('sdy-playlists-updated')); return true;
            }
            if(k.indexOf('bookmark:')===0){
                if(!d||typeof d!=='object') return false;
                const id=k.slice(9), a=getLinks(), i=a.findIndex(x=>x.id===id);
                const x=normalizeLinks([{id,name:d.name,url:d.url,order:d.order}])[0]; if(!x) return false;
                x.order=Number.isFinite(+d.order)?+d.order:a.length;
                if(i>=0) a[i]=x; else a.push(x);
                localStorage.setItem('sdy_links',JSON.stringify(normalizeLinks(a))); return true;
            }
            if(k.indexOf('playlist:')===0){
                if(!d||typeof d!=='object') return false;
                const id=k.slice(9), a=getPlaylists(), i=a.findIndex(x=>x.id===id);
                const old=i>=0?a[i]:null;
                const x={id,name:String(d.name||'재생목록'),order:Number.isFinite(+d.order)?+d.order:a.length,
                         tracks:old?(old.tracks||[]):[]};
                if(i>=0) a[i]=x; else a.push(x);
                localStorage.setItem('sdy_playlists',JSON.stringify(normalizePlaylists(a)));
                document.dispatchEvent(new CustomEvent('sdy-playlists-updated')); return true;
            }
            if(k.indexOf('pltrack:')===0){
                if(!d||typeof d!=='object') return false;
                const z=k.slice(8).split(':'), pid=decodeURIComponent(z.shift()||''), tid=decodeURIComponent(z.join(':'));
                const a=getPlaylists(); const p=a.find(x=>x.id===pid);
                if(!p) return false;   // 삭제된 목록을 늦게 도착한 곡 연산이 되살리지 않음
                p.tracks=(p.tracks||[]).filter(x=>String(x)!==tid);
                const at=Math.max(0,Math.min(+d.order||0,p.tracks.length)); p.tracks.splice(at,0,tid);
                localStorage.setItem('sdy_playlists',JSON.stringify(normalizePlaylists(a)));
                document.dispatchEvent(new CustomEvent('sdy-playlists-updated')); return true;
            }
            if(k==='adminedits'){
                if(d&&typeof d==='object'){ localStorage.setItem('sdy_admin_edits',JSON.stringify(d)); return true; }
                return false;
            }
            if(k.indexOf('folder:')===0){
                const fid=k.slice(7);
                if(!d||typeof d!=='object'||d.id!==fid) return false;
                if(getTombstones().folders&&getTombstones().folders[fid]) return false; // 삭제 우선
                const fs=getFolders();
                const idx=fs.findIndex(f=>f.id===fid);
                const f=Object.assign({}, d);   // lock 등 모든 필드 그대로 보존
                // 9.4 · 잠금이 저절로 풀리지 않게 한다.
                //  lock 없는 오래된 폴더 기록이 뒤늦게 도착하면 잠금이 사라졌다.
                //  사용자가 직접 해제했을 때만(lockCleared 표시) 잠금을 없앤다.
                if(idx>=0){
                    const old=fs[idx];
                    if(old&&old.lock&&old.lock.verifier&&!f.lock&&!d.lockCleared) f.lock=old.lock;
                }
                if(idx>=0) fs[idx]=f; else fs.push(f);
                localStorage.setItem('sdy_folders',JSON.stringify(fs));
                return true;
            }
            if(k.indexOf('member:')===0){
                const nbId=k.slice(7);
                const fid=(typeof d==='string'&&d)?d:null;
                const c=getCfg(nbId);
                if((c.folder||null)===fid) return false;
                if(fid) c.folder=fid; else delete c.folder;
                setCfg(nbId,c); return true;
            }
            if(k.indexOf('trash:')===0){
                const nbId=k.slice(6);
                const ts=(typeof d==='number')?d:null;
                const c=getCfg(nbId);
                if((c.trashed_at||null)===ts) return false;
                if(ts) c.trashed_at=ts; else delete c.trashed_at;
                setCfg(nbId,c); return true;
            }
            if(k.indexOf('pin:')===0){
                const nbId=k.slice(4);
                const c=getCfg(nbId);
                const want=!!d;
                if(!!c.pinned===want) return false;
                if(want) c.pinned=true; else delete c.pinned;
                setCfg(nbId,c); return true;
            }
            if(k.indexOf('emoji:')===0){
                const nbId=k.slice(6);
                const em=(typeof d==='string'&&d)?d:null;
                const c=getCfg(nbId);
                if((c.emoji||null)===em) return false;
                if(em) c.emoji=em; else delete c.emoji;
                // 9.1 · 원격 값을 받아들였으면 로컬 보호 타임스탬프를 지운다.
                //  (안 지우면 90초 동안 이 기기가 서버 값을 계속 무시한다)
                delete c.emojiTs;
                setCfg(nbId,c);
                // 열려 있는 노트에도 즉시 반영
                if(curNB&&curNB.id===nbId&&doc) doc.emoji=em||'';
                // 카드가 아직 안 그려졌으면 전체 재렌더로 반영시킨다
                if(!paintEmojiBadge(nbId,em)) return true;
                return false;   // DOM 직접 갱신 (전체 재렌더 불필요)
            }
            // 노트별 보기 설정 (종이·크기·배경색·즐겨찾는 쪽·용어 사전)
            if(k.indexOf('nset:')===0){
                const nbId=k.slice(5);
                const c=getCfg(nbId);
                const ns=(d&&typeof d==='object')?d:{};
                let ch=false;
                const put=(key,val,dflt)=>{
                    const now=c[key]===undefined?dflt:c[key];
                    const want=val===undefined?dflt:val;
                    if(JSON.stringify(now)!==JSON.stringify(want)){
                        if(want===dflt||want==null||(Array.isArray(want)&&!want.length)) delete c[key];
                        else c[key]=want;
                        ch=true;
                    }
                };
                put('paper',ns.paper,'blank');
                put('sizePreset',ns.sizePreset,'a4_portrait');
                put('tint',ns.tint,'');
                put('favPages',ns.favPages,[]);
                put('glossary',ns.glossary,{});
                if(!ch) return false;
                setCfg(nbId,c);
                // 지금 그 노트를 열어 두었으면 화면에도 바로 반영
                if(curNB&&curNB.id===nbId&&doc){
                    if(ns.paper) doc.paper=ns.paper;
                    if(ns.sizePreset) doc.sizePreset=ns.sizePreset;
                    doc.tint=ns.tint||'';
                    doc.favPages=Array.isArray(ns.favPages)?ns.favPages:[];
                    if(ns.glossary) doc.glossary=ns.glossary;
                    try{ applyTint&&applyTint(); }catch(e){}
                    try{ layoutPages(); }catch(e){}
                }
                return true;
            }
            // 앱 전체 설정 (테마·강조색·기본 글꼴 등)
            if(k==='appset'){ return _appSetApply(d); }
        }catch(e){}
        return false;
    }

    // ── 애니메이션 감지: 설정 변화를 '집게(뽑기 기계)' 애니메이션으로 표현 ──
    function _stSnapshotFor(op){
        const k=op.id;
        if(k.indexOf('folder:')===0){
            const fid=k.slice(7);
            return {existed:getFolders().some(f=>f.id===fid),
                    card:document.querySelector('.folder-card[data-folder-id="'+fid+'"]')};
        }
        if(k.indexOf('member:')===0){
            const id=k.slice(7);
            return {beforeFid:getCfg(id).folder||null,
                    card:document.querySelector('.note-card[data-nb-id="'+id+'"]')};
        }
        if(k.indexOf('trash:')===0){
            const id=k.slice(6);
            return {trashed:!!getCfg(id).trashed_at,
                    card:document.querySelector('.note-card[data-nb-id="'+id+'"]')};
        }
        return {};
    }
    function _stAnimFor(op, snap){
        const k=op.id;
        if(k.indexOf('folder:')===0){
            const fid=k.slice(7);
            if(op.del) return snap.existed?{type:'leave',kind:'folder',card:snap.card}:null;
            return snap.existed?null:{type:'arrive',kind:'folder',fid:fid};
        }
        if(k.indexOf('member:')===0){
            const id=k.slice(7);
            const after=op.del?null:((typeof op.data==='string'&&op.data)?op.data:null);
            if(snap.beforeFid===after) return null;
            if(snap.card) return {type:'leave',kind:'move',card:snap.card,to:after};
            return {type:'arrive',kind:'note',nbId:id,to:after};
        }
        if(k.indexOf('trash:')===0){
            const id=k.slice(6);
            const after=!op.del;
            if(snap.trashed===after) return null;
            if(after) return snap.card?{type:'leave',kind:'trash',card:snap.card}:null;
            return {type:'arrive',kind:'note',nbId:id};
        }
        return null;
    }
    // '떠나는' 애니메이션: 카드가 아직 화면에 있을 때 (renderGrid 전) 실행.
    // 집게는 한 번에 한 세션이라, 폴더 삭제가 있으면 그것만 우선한다.
    function _stFlushLeave(pending){
        if(!pending.length) return false;
        const fdel=pending.find(a=>a.kind==='folder'&&a.card);
        if(fdel){ playClawThrow(fdel.card); return true; }
        const throws=[], byFolder=new Map();
        pending.forEach(a=>{
            if(!a.card) return;
            if(a.kind==='move'&&a.to){ if(!byFolder.has(a.to)) byFolder.set(a.to,[]); byFolder.get(a.to).push(a.card); }
            else throws.push(a.card);
        });
        if(byFolder.size){
            let first=null;
            byFolder.forEach((cards,fid)=>{ if(!first) first={fid,cards}; });
            const destEl=document.querySelector('.folder-card[data-folder-id="'+first.fid+'"]');
            if(destEl) playClawToFolderMulti(first.cards, destEl);
            else playClawThrowMulti(first.cards);
            return true;
        }
        if(throws.length){ playClawThrowMulti(throws); return true; }
        return false;
    }
    // '도착하는' 애니메이션: 렌더 뒤 새 카드가 생기면 실행 (떠나는 애니메이션이 없을 때만)
    function _stFlushArrive(pending){
        if(!pending.length) return;
        const a=pending[0];
        if(a.kind==='folder'){ playFolderCreateAnim(a.fid); return; }
        if(a.nbId){
            // 아직 목록에 없는(새로 생긴) 노트는 refreshNBs 가 애니메이션을 맡는다 (중복 방지)
            if(!notebooks.some(n=>n.id===a.nbId)) return;
            const fid=a.to||null;
            if(fid && fid!==curFolder){
                // 보고 있지 않은 폴더에 온 노트 → 그 폴더 카드에 넣는 미니 애니메이션
                setTimeout(()=>{ playNoteIntoFolderAnim(fid); },120);
            }else{
                setTimeout(()=>{
                    const c=document.querySelector('.note-card[data-nb-id="'+a.nbId+'"]');
                    if(c) playClawDrop(c);
                },80);
            }
        }
    }

    async function pullSettings(){
        const cleaned=cleanupTestData();
        try{
            // 14.9 · since(전역 커서)를 쓰지 않는다. rev 는 각 기기의 시계로 찍히므로
            //  시계가 느린 기기의 폴더/고정 op가 '이미 지난 rev'로 오인돼 영영 안
            //  받히던 버그가 있었다(폴더 이름이 옆 폴더 이름으로 바뀌어 보이던 원인).
            //  항상 전체를 받고 아래 _stApplied/_stLocalRev 로 이미 반영한 것만 거른다.
            const r=await fetch('/api/sync/pull?nb='+SET_NS+'&since=0',{cache:'no-store'});
            const d=await r.json(); if(!r.ok||!d.ok) return;
            const ops=(d.ops||[]).sort((a,b)=>(a.rev||0)-(b.rev||0));
            // 이 시점부터 서버 상태를 받았으므로 이후의 새 편집만 동기화한다.
            _stCacheReset=false;
            let changed=false; const pending=[];
            for(const op of ops){
                const local=_stLocalRev.get(op.id)||0;
                if((op.rev||0)<=local) continue;        // 전송 대기 중인 내 최신 편집 우선
                const applied=_stApplied.get(op.id)||0;
                if((op.rev||0)<=applied) continue;      // 이미 반영한 rev는 건너뜀 (깜빡임 방지)
                if(local) _stDropOp(op.id);              // 서버 것이 더 최신이면 outbox도 정리
                const snap=_stSnapshotFor(op);
                if(_stApply(op)) changed=true;
                const anim=_stAnimFor(op, snap);
                if(anim) pending.push(anim);
                _stApplied.set(op.id, op.rev||0);
                _stHash.set(op.id, op.del?null:_stHashVal(op));
            }
            // 14.9 · Lamport 시계 캐치업: 서버가 본 최대 rev 로 내 시계를 올려,
            //  시계가 느린 기기의 다음 편집도 서버에서 이기게 한다.
            _stRev=Math.max(_stRev, d.version||0);
            // '떠나는' 애니메이션은 카드가 살아있는 동안(렌더 전) 먼저
            const didLeave=_clawBusy?false:_stFlushLeave(pending.filter(a=>a.type==='leave'));
            if(changed){
                // 14.4 · 여러 사람이 접속하면 appset/음악/위치 ops 가 1.5초마다 온다.
                // 그때마다 그리드·링크바를 통째로 다시 그리면 미리보기가 깜빡인다.
                const linkHit=ops.some(op=>{
                    const k=op.id||'';
                    return k==='links'||k.indexOf('bookmark:')===0;
                });
                if(linkHit) renderLinks();
                // 폴더·소속·고정·휴지통이 바뀐 때만 카드를 다시 그린다.
                const gridHit=ops.some(op=>{
                    const k=op.id||'';
                    return /^(folder:|member:|trash:|pin:)/.test(k);
                });
                if(gridHit) renderGrid();
                else { try{ requestAnimationFrame(rescalePreviews); }catch(e){} }
                try{ updateTrashCount(); }catch(e){}
                if(curFolder && !getFolders().some(f=>f.id===curFolder&&!f.trashed_at)) curFolder=null;
            }
            // '도착' 애니메이션은 떠나는 것이 없을 때만 (집게 단일 세션)
            if(!didLeave && !_clawBusy) _stFlushArrive(pending.filter(a=>a.type==='arrive'));
        }catch(e){}
        if(cleaned) _stDirty=true;          // 정리 결과도 서버에 반영
        if(!_stCacheReset && _stDirty) pushSettingsNow(); // 서버 복원 뒤의 새 변경만 전송
    }
    // 마지막의 SSE 릴레이가 스크립트 경계/브라우저에 관계없이 호출할 수 있게 노출
    try{ window.pullSettings=pullSettings; }catch(e){}

    function faviconOf(url){
        try{ return 'https://www.google.com/s2/favicons?sz=64&domain='+new URL(url).hostname; }
        catch(e){ return ''; }
    }
    function renderLinks(){
        const bar=document.getElementById('linkBar');
        if(!bar) return;
        const links=getLinks();
        bar.innerHTML=links.map((l,i)=>
            `<a class="link-chip" href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(l.url)}">`+
            `<img class="lc-ico" src="${faviconOf(l.url)}" alt="" onerror="this.style.display='none'">`+
            `<span>${esc(l.name)}</span></a>`
        ).join('')+
        `<button class="link-add" onclick="addLink()" title="링크 추가"><i class="ri-add-line"></i></button>`;

        // 삭제는 우클릭 메뉴로 (X 버튼 없음)
        bar.querySelectorAll('.link-chip').forEach((n,i)=>{
            // 10.0 · 끌어 순서 바꾸기가 진행 중(꾹 누르는 중)이면 우클릭 메뉴를
            //   띄우지 않는다. (길게 누르기 → 드래그 / 길게 누르고 그대로 떼기 →
            //   메뉴: 두 동작이 서로를 방해하지 않게 한다)
            n.oncontextmenu=(e)=>{
                e.preventDefault(); e.stopPropagation();
                if(linkLPFired||linkDrag) return;
                openLinkMenu(e,i);
            };
            // 길게 눌러 끌어서 순서 변경 (모바일/데스크톱 공용)
            // 10.0 · <a> 칩은 마우스를 움직이는 순간 브라우저 '기본 링크 드래그'가
            //   시작돼 우리 드래그의 mouseup을 삼켜 버렸다 → 끌기가 먹통이었다.
            n.draggable=false;
            n.addEventListener('dragstart',e=>{ e.preventDefault(); try{ window.getSelection().removeAllRanges(); }catch(err){} });
            n.addEventListener('touchstart',e=>onLinkDown(e,i),{passive:true});
            n.addEventListener('pointerdown',e=>{ if(e.button===0) onLinkDown(e,i); });
        });
    }

    // ===== 북마크 길게 눌러 끌어 순서 변경 =====
    let linkDrag=null, linkLP=null, linkLPFired=false, linkSX=0, linkSY=0;
    function onLinkDown(e,i){
        const pt=e.touches?e.touches[0]:e;
        linkSX=pt.clientX; linkSY=pt.clientY;
        linkLPFired=false;
        clearTimeout(linkLP);
        linkLP=setTimeout(()=>{ linkLPFired=true; beginLinkDrag(pt,i); },450);
    }
    function onLinkMove(e){
        if(!linkLP||linkLPFired) return;
        const pt=e.touches?e.touches[0]:e;
        if(Math.abs(pt.clientX-linkSX)>8||Math.abs(pt.clientY-linkSY)>8){
            clearTimeout(linkLP); linkLP=null;   // 움직이면 스크롤로 간주 → 롱프레스 취소
        }
    }
    function beginLinkDrag(pt,i){
        const bar=document.getElementById('linkBar');
        const chip=bar.querySelectorAll('.link-chip')[i];
        if(!chip) return;
        const r=chip.getBoundingClientRect();
        const ghost=chip.cloneNode(true);
        ghost.id='linkGhost'; ghost.removeAttribute('href');
        ghost.style.cssText='position:fixed;z-index:900;pointer-events:none;opacity:.92;'+
            'box-shadow:0 8px 24px rgba(0,0,0,.32);left:'+window.sdyUiCss(r.left)+'px;'+
            'top:'+window.sdyUiCss(r.top)+'px;width:'+window.sdyUiCss(r.width)+'px;';
        document.body.appendChild(ghost);
        chip.style.opacity='.35'; chip.style.touchAction='none';
        // 집은 지점과 칩 좌상단 사이 간격을 유지해야 첫 move에서 칩이 포인터로
        // 순간이동하지 않는다. grab 좌표는 elementFromPoint와 같은 화면 px로 둔다.
        linkDrag={from:i, ghost, chip, cur:i, x:pt.clientX, y:pt.clientY,
                  grabX:pt.clientX-r.left,grabY:pt.clientY-r.top,moved:false};
        if(navigator.vibrate) navigator.vibrate(18);
        document.body.style.userSelect='none';
        toast('끌어서 순서를 바꾸세요',1500);
    }
    function moveLinkDrag(x,y){
        if(!linkDrag) return;
        if(Math.abs(x-linkDrag.x)>4||Math.abs(y-linkDrag.y)>4) linkDrag.moved=true;
        linkDrag.x=x; linkDrag.y=y;
        linkDrag.ghost.style.left=window.sdyUiCss(x-linkDrag.grabX)+'px';
        linkDrag.ghost.style.top=window.sdyUiCss(y-linkDrag.grabY)+'px';
        const chips=[...document.getElementById('linkBar').querySelectorAll('.link-chip')];
        let pos=0;
        for(let k=0;k<chips.length;k++){
            if(k===linkDrag.from) continue;
            const r=chips[k].getBoundingClientRect();
            if(r.left+r.width/2 < x) pos++;
        }
        linkDrag.cur=pos;
        const rest=chips.filter((c,k)=>k!==linkDrag.from);
        chips.forEach(c=>c.classList.remove('link-insert','link-ins-before','link-ins-after'));
        // 구글 북마크바처럼: 삽입될 '사이 공간'에 세로 막대를 표시
        if(rest.length){
            if(pos<rest.length) rest[pos].classList.add('link-ins-before');
            else rest[rest.length-1].classList.add('link-ins-after');
        }
    }
    function endLinkDrag(showMenu){
        if(!linkDrag) return;
        const {from,cur,ghost,chip}=linkDrag;
        const x=linkDrag.x, y=linkDrag.y, moved=linkDrag.moved;
        try{ ghost.remove(); }catch(e){}
        if(chip){ chip.style.opacity=''; chip.style.touchAction=''; }
        document.querySelectorAll('.link-chip').forEach(c=>c.classList.remove('link-insert','link-ins-before','link-ins-after'));
        document.body.style.userSelect='';
        linkDrag=null;
        // 길게 누른 뒤 합성 click이 오지 않는 브라우저에서는 플래그가 계속 남아
        // 다음 실제 클릭까지 먹어 버렸다. 짧은 시간 뒤 반드시 해제한다.
        setTimeout(()=>{ linkLPFired=false; },320);
        if(from!==cur){
            const links=getLinks();
            if(from<links.length){
                const [moved]=links.splice(from,1);
                links.splice(Math.max(0,Math.min(cur,links.length)),0,moved);
                // 10.0 · 핵심 수정: normalizeLinks 가 'order 필드' 기준으로 다시
                //   정렬하기 때문에, 옮긴 뒤의 새 위치를 order 에 반영해야 한다.
                //   (이걸 빠뜨려 정규화가 드래그를 되돌려 버렸다 → 순서 변경이 안 된 것)
                links.forEach((l,i)=>{ l.order=i; });
                saveLinks(links); renderLinks();
                return;
            }
        }
        // 10.0 · 꾹 누른 채 그대로 뗐다면(이동 없음) 우클릭 메뉴를 열어 준다.
        //   폰에서 '길게 누르기 = 메뉴' 기능이 끌기와 겹쳐 사라지지 않게 한다.
        if(showMenu!==false && !moved){
            try{ openLinkMenu({clientX:x,clientY:y},from); }catch(e){}
        }
    }
    // 길게 누른 뒤 따라오는 클릭은 새 탭 열기로 가지 않게 막는다
    document.getElementById('linkBar').addEventListener('click',e=>{
        if(linkLPFired){ e.preventDefault(); e.stopPropagation(); linkLPFired=false; }
    },true);
    // ★ pointermove/pointerup 로 통합 — 터치 장치에서 즉시 반응
    document.addEventListener('pointermove',e=>{
        if(linkDrag) moveLinkDrag(e.clientX,e.clientY);
        else onLinkMove(e);
    });
    document.addEventListener('pointerup',()=>{
        if(linkDrag){ endLinkDrag(true); }
        else if(linkLP){ clearTimeout(linkLP); linkLP=null; }
    });
    document.addEventListener('touchmove',e=>{
        if(linkDrag){ e.preventDefault(); const t=e.touches[0]; moveLinkDrag(t.clientX,t.clientY); }
        else onLinkMove(e);
    },{passive:false});
    document.addEventListener('touchend',()=>{
        if(linkDrag){ endLinkDrag(true); }
        else if(linkLP){ clearTimeout(linkLP); linkLP=null; }
    });
    document.addEventListener('touchcancel',()=>{ if(linkDrag) endLinkDrag(false); });
    window.addEventListener('blur',()=>{ if(linkDrag) endLinkDrag(false); });

    // 바로가기 우클릭 메뉴
    function openLinkMenu(e,i){
        const links=getLinks(); const l=links[i]; if(!l) return;
        const m=document.getElementById('ctxMenu');
        m.innerHTML=
            `<div class="ctx-item" onclick="window.open('${esc(l.url)}','_blank','noopener');closeCtxMenu()">`+
                `<i class="ri-external-link-line"></i> 새 탭에서 열기</div>`+
            `<div class="ctx-item" onclick="renameLink(${i})">`+
                `<i class="ri-edit-line"></i> 이름 바꾸기</div>`+
            `<div class="ctx-item" onclick="copyLinkUrl(${i})">`+
                `<i class="ri-file-copy-line"></i> 주소 복사</div>`+
            `<div class="ctx-sep"></div>`+
            `<div class="ctx-item danger" onclick="removeLink(${i})">`+
                `<i class="ri-delete-bin-6-line"></i> 삭제</div>`;
        m.classList.add('show');
        const mw=m.offsetWidth||200, mh=m.offsetHeight||160;
        m.style.left=Math.min(window.sdyUiCss(e.clientX),window.sdyUiCss(innerWidth)-mw-8)+'px';
        m.style.top=Math.min(window.sdyUiCss(e.clientY),window.sdyUiCss(innerHeight)-mh-8)+'px';
    }
    function removeLink(i){
        closeCtxMenu();
        const l=getLinks(); if(!l[i]) return;
        if(!confirm(`'${l[i].name}' 링크를 삭제할까요?`)) return;
        tombstone('links',(l[i].url||'').replace(/\/$/,''));
        l.splice(i,1); saveLinks(l); renderLinks(); toast('링크 삭제됨',1200);
    }
    function renameLink(i){
        closeCtxMenu();
        const l=getLinks(); if(!l[i]) return;
        const nm=prompt('표시할 이름',l[i].name);
        if(!nm||!nm.trim()) return;
        l[i].name=nm.trim(); saveLinks(l); renderLinks(); toast('이름 변경됨',1200);
    }
    function copyLinkUrl(i){
        closeCtxMenu();
        const l=getLinks(); if(!l[i]) return;
        navigator.clipboard&&navigator.clipboard.writeText(l[i].url);
        toast('주소를 복사했습니다',1400);
    }
    function addLink(){
        let url=prompt('링크 주소 (URL)','https://');
        if(!url||!url.trim()) return;
        url=url.trim();
        if(!/^https?:\/\//i.test(url)) url='https://'+url;
        try{ new URL(url); }catch(e){ toast('올바른 주소가 아닙니다',1800); return; }
        let host=''; try{ host=new URL(url).hostname.replace(/^www\./,''); }catch(e){}
        const name=prompt('표시할 이름',host||'링크');
        if(!name||!name.trim()) return;
        untombstone('links',url.replace(/\/$/,''));   // 다시 추가하면 삭제 기록 해제
        const l=getLinks();
        l.push({name:name.trim(),url});
        saveLinks(l); renderLinks();
        toast('링크 추가됨 ✓',1300);
    }

    // ============ 스마트 정렬 (스냅 가이드) ============
    // 다른 요소의 가장자리/중심, 그리고 종이 중앙에 가까워지면 딱 붙는다.
    const SNAP_TOL=6;            // 스냅이 걸리는 거리 (종이 좌표 기준)
    let snapEnabled=true;

    function toggleSnap(){
        snapEnabled=!snapEnabled;
        const b=document.getElementById('snapBtn');
        if(b) b.classList.toggle('active',snapEnabled);
        clearSnapLines();
        toast(snapEnabled?'정렬 안내선 켜짐':'정렬 안내선 꺼짐',1100);
    }

    // 스냅 후보 좌표 모으기 (자기 자신과 함께 움직이는 것들은 제외)
    function snapTargets(pageIdx,excludeIds){
        const V=[], H=[];
        const sz=paperSize();
        V.push({v:sz.w/2,center:true}); H.push({v:sz.h/2,center:true});   // 종이 중앙
        (doc.pages[pageIdx].els||[]).forEach(el=>{
            if(excludeIds.includes(el.id)) return;
            const bb=elBBox(el,pageIdx);
            if(!bb) return;
            V.push({v:bb.x},{v:bb.x+bb.w/2,center:true},{v:bb.x+bb.w});
            H.push({v:bb.y},{v:bb.y+bb.h/2,center:true},{v:bb.y+bb.h});
        });
        return {V,H};
    }

    // x,y 를 스냅된 좌표로 보정하고, 걸린 안내선을 그린다
    function applySnap(pageIdx,x,y,w,h,excludeIds){
        if(!snapEnabled){ clearSnapLines(); return {x,y}; }
        const {V,H}=snapTargets(pageIdx,excludeIds||[]);
        const lines=[];
        // 가로 위치: 왼쪽 / 가운데 / 오른쪽 세 지점을 후보와 비교
        let bestX=null;
        [[x,0],[x+w/2,w/2],[x+w,w]].forEach(([edge,off])=>{
            V.forEach(t=>{
                const d=Math.abs(edge-t.v);
                if(d<=SNAP_TOL && (!bestX||d<bestX.d)) bestX={d,nx:t.v-off,line:t.v,center:!!t.center};
            });
        });
        let bestY=null;
        [[y,0],[y+h/2,h/2],[y+h,h]].forEach(([edge,off])=>{
            H.forEach(t=>{
                const d=Math.abs(edge-t.v);
                if(d<=SNAP_TOL && (!bestY||d<bestY.d)) bestY={d,ny:t.v-off,line:t.v,center:!!t.center};
            });
        });
        if(bestX){ x=Math.round(bestX.nx); lines.push({dir:'v',pos:bestX.line,center:bestX.center}); }
        if(bestY){ y=Math.round(bestY.ny); lines.push({dir:'h',pos:bestY.line,center:bestY.center}); }
        drawSnapLines(pageIdx,lines);
        return {x,y};
    }

    let _snapLineNodes=[], _snapLineSig='';
    function drawSnapLines(pageIdx,lines){
        const paper=paperAt(pageIdx); if(!paper) return;
        const sig=pageIdx+'|'+(lines||[]).map(l=>l.dir+':'+Math.round(l.pos*10)/10+':' +(l.center?1:0)).join('|');
        if(sig===_snapLineSig) return;
        clearSnapLines();
        _snapLineSig=sig;
        (lines||[]).forEach(l=>{
            const d=document.createElement('div');
            d.className='snap-line '+l.dir+(l.center?' center':'');
            if(l.dir==='v') d.style.left=l.pos+'px'; else d.style.top=l.pos+'px';
            paper.appendChild(d);
            _snapLineNodes.push(d);
        });
    }
    function clearSnapLines(){
        if(!_snapLineNodes.length){ _snapLineSig=''; return; }
        _snapLineNodes.forEach(n=>{ try{ n.remove(); }catch(e){} });
        _snapLineNodes=[]; _snapLineSig='';
    }

    // 선택한 여러 요소를 서로 맞춰 정렬 / 균등 배치
    function alignSelection(mode){
        if(multiSel.length<2){ toast('두 개 이상 선택하세요',1400); return; }
        const pi=multiSel[0].pageIdx;
        const items=multiSel.map(m=>({m,el:findEl(m.pageIdx,m.id)})).filter(o=>o.el);
        const boxes=items.map(o=>({...o,bb:elBBox(o.el,pi)}));
        let x0=Math.min(...boxes.map(b=>b.bb.x));
        let x1=Math.max(...boxes.map(b=>b.bb.x+b.bb.w));
        let y0=Math.min(...boxes.map(b=>b.bb.y));
        let y1=Math.max(...boxes.map(b=>b.bb.y+b.bb.h));
        pushHistory();
        const put=(o,nx,ny)=>{
            if(o.el.type==='stroke'){
                o.el.dx=(o.el.dx||0)+(nx-o.bb.x); o.el.dy=(o.el.dy||0)+(ny-o.bb.y);
                o.m.node.setAttribute('transform',`translate(${o.el.dx},${o.el.dy})`);
            }else{
                const c=clampEl(nx,ny,o.el.w,o.el.h);
                o.el.x=Math.round(c.x); o.el.y=Math.round(c.y);
                o.m.node.style.left=o.el.x+'px'; o.m.node.style.top=o.el.y+'px';
            }
        };
        if(mode==='left')        boxes.forEach(o=>put(o,x0,o.bb.y));
        else if(mode==='right')  boxes.forEach(o=>put(o,x1-o.bb.w,o.bb.y));
        else if(mode==='hcenter'){const cx=(x0+x1)/2; boxes.forEach(o=>put(o,cx-o.bb.w/2,o.bb.y));}
        else if(mode==='top')    boxes.forEach(o=>put(o,o.bb.x,y0));
        else if(mode==='bottom') boxes.forEach(o=>put(o,o.bb.x,y1-o.bb.h));
        else if(mode==='vcenter'){const cy=(y0+y1)/2; boxes.forEach(o=>put(o,o.bb.x,cy-o.bb.h/2));}
        else if(mode==='hdist'||mode==='vdist'){
            if(boxes.length<3){ toast('세 개 이상 선택하세요',1400); return; }
            const hor=mode==='hdist';
            const sorted=[...boxes].sort((a,b)=>hor?a.bb.x-b.bb.x:a.bb.y-b.bb.y);
            const total=hor?(x1-x0):(y1-y0);
            const used=sorted.reduce((t,o)=>t+(hor?o.bb.w:o.bb.h),0);
            const gap=(total-used)/(sorted.length-1);
            let cur=hor?x0:y0;
            sorted.forEach(o=>{
                if(hor){ put(o,cur,o.bb.y); cur+=o.bb.w+gap; }
                else   { put(o,o.bb.x,cur); cur+=o.bb.h+gap; }
            });
        }
        markPageEdited(pi); saveDoc();
        toast('정렬 완료',1000);
    }

    // ============ Multi Select ============
    let selectMode=false,selectedNBs=new Set(),longPressTimer=null;

    // ===== 폴더 =====
    // folders: [{id,name,color,created_at}] / 노트의 폴더는 cfg.folder 에 저장
    function getFolders(){ try{ return JSON.parse(localStorage.getItem('sdy_folders')||'[]'); }catch(e){ return []; } }
    function saveFolders(f){ localStorage.setItem('sdy_folders',JSON.stringify(f)); pushSettingsNow(); }   // 폴더 변경은 즉시 서버 동기화
    let curFolder=null;    // null = 최상위

    // ===== 휴지통 (삭제한 노트가 30일 후 자동 영구 삭제 — 설정에서 관리) =====
    const TRASH_TTL_MS=30*24*60*60*1000;
    function isTrashFolder(fid){ const f=folderById(fid); return !!(f&&f.trash); }   // 옛 버전 잔여 폴더 감지용
    function isTrashed(id){ return !!getCfg(id).trashed_at; }
    // 옛 버전의 '휴지통 폴더'에 담겨 있던 노트를 새 방식(trashed_at)으로 옮긴다
    function migrateTrashFolder(){
        try{
            const fs=getFolders();
            const oldTrash=fs.filter(f=>f.trash||f.id==='f_trash');
            if(!oldTrash.length) return;
            const oldIds=new Set(oldTrash.map(f=>f.id));
            notebooks.forEach(nb=>{
                const fid=noteFolder(nb.id);
                if(fid&&oldIds.has(fid)){
                    const c=getCfg(nb.id);
                    c.__prevFolder=c.__prevFolder||null;
                    if(!c.trashed_at) c.trashed_at=Date.now();
                    setCfg(nb.id,c);
                    if(c.folder===fid){        // 내부 정리 — 잠금 검사 우회 (직접 기록)
                        const pv=c.__prevFolder||null;
                        if(pv) c.folder=pv; else delete c.folder;
                        setCfg(nb.id,c);
                    }
                }
            });
            saveFolders(fs.filter(f=>!oldIds.has(f.id)));
        }catch(e){}
    }
    // 노트를 휴지통으로 (영구 삭제가 아님 — 격자에서만 숨겨짐)
    function moveToTrash(id){
        const c=getCfg(id);
        c.__prevFolder=c.folder||null;   // 복원 위치 기억
        c.trashed_at=Date.now();
        setCfg(id,c);
        pushSettingsNow();               // 휴지통 이동도 즉시 서버 반영
        saveLocalNBs();
    }
    // 휴지통에서 노트 복원. 원래 폴더가 아직 휴지통에 있으면 노트만 먼저
    // 최상위로 꺼낸다. 나중에 그 폴더를 복구하면 폴더의 삭제 스냅샷이 이
    // 노트까지 원래 자리로 다시 데려간다.
    function restoreFromTrash(id){
        const c=getCfg(id);
        const prev=c.__prevFolder||c.folder||null;
        delete c.trashed_at; delete c.__prevFolder;
        const pf=prev&&folderById(prev);
        if(prev&&pf&&!pf.trashed_at) c.folder=prev;
        else delete c.folder;
        setCfg(id,c);
        pushSettingsNow(); saveLocalNBs();
    }
    // 영구 삭제 (서버·기기에서 완전히 제거) — 서버 삭제를 기다린다
    async function permanentDeleteNB(id, purgeImgs){
        if(purgeImgs){
            try{ const d=loadDoc(id); (d.pages||[]).forEach(p=>purgeElements(p.els||[])); }catch(e){}
        }
        // 서버에서 먼저 지우고(await) → 그래야 loadNBs 재조회 때 부활하지 않는다
        if(!String(id).startsWith('local_')&&SB){
            try{ await SB.from('notebooks').delete().eq('id',id); }catch(e){}
        }
        // 혹시 서버 삭제가 실패/지연돼도 재조회 때 되살아나지 않도록 기록(tombstone)
        tombstone('notebooks', id);
        localStorage.removeItem('nb_'+id); localStorage.removeItem('draw_'+id);
        sessionKeys.delete(id); decCache.delete(id); adminPlainUnlocked.delete(id);
        notebooks=notebooks.filter(x=>x.id!==id);
        saveLocalNBs();
    }
    // 휴지통에 있는 폴더의 대표 항목. 하위 폴더도 함께 표시하면 한 번의 삭제가
    // 여러 줄로 보이므로, 사용자가 직접 지운 루트 폴더만 목록에 보여 준다.
    function trashedFolders(){
        return getFolders().filter(f=>f&&f.trashed_at&&f.trash_root)
            .sort((a,b)=>(b.trashed_at||0)-(a.trashed_at||0));
    }
    function _folderTrashIds(root){
        const snap=root&&root.trash_snapshot;
        if(snap&&Array.isArray(snap.folderIds)) return snap.folderIds.slice();
        return getFolders().filter(f=>f.trash_root_id===(root&&root.id)).map(f=>f.id);
    }
    // 폴더 영구 삭제. 폴더 휴지통 안에 남아 있던 노트도 복구 시 없는 폴더를
    // 가리키지 않도록 삭제 폴더의 바깥(부모, 없으면 최상위)으로 정리한다.
    function permanentDeleteFolder(fid){
        const fs=getFolders();
        const root=fs.find(f=>f.id===fid); if(!root) return;
        const ids=_folderTrashIds(root);
        const idset=new Set(ids);
        const p0=root.trash_snapshot&&root.trash_snapshot.parent;
        const pf=p0&&fs.find(f=>f.id===p0&&!f.trashed_at);
        const up=pf?p0:null;
        notebooks.forEach(nb=>{
            const c=getCfg(nb.id); let ch=false;
            if(idset.has(c.folder)){ if(up)c.folder=up; else delete c.folder; ch=true; }
            if(idset.has(c.__prevFolder)){ if(up)c.__prevFolder=up; else delete c.__prevFolder; ch=true; }
            if(ch) setCfg(nb.id,c);
        });
        ids.forEach(id=>tombstone('folders',id));
        saveFolders(fs.filter(f=>!idset.has(f.id)));
        if(idset.has(curFolder)) curFolder=up;
    }
    // 휴지통에 30일 넘게 있는 노트·폴더 자동 영구 삭제
    async function purgeTrash(){
        const now=Date.now(); let n=0;
        for(const nb of notebooks.slice()){
            const c=getCfg(nb.id);
            if(c.trashed_at && (now-c.trashed_at)>=TRASH_TTL_MS){
                await permanentDeleteNB(nb.id, false); n++;
            }
        }
        for(const f of trashedFolders().slice()){
            if((now-(f.trashed_at||0))>=TRASH_TTL_MS){ permanentDeleteFolder(f.id); n++; }
        }
        return n;
    }
    // 휴지통에 있는 노트 목록 (최근 삭제순)
    function trashedNotes(){
        return notebooks.filter(nb=>isTrashed(nb.id))
            .sort((a,b)=>(getCfg(b.id).trashed_at||0)-(getCfg(a.id).trashed_at||0));
    }
    function updateTrashCount(){
        const el=document.getElementById('trashCount');
        if(el){
            const n=trashedNotes().length+trashedFolders().length;
            el.textContent=n?`${n}개 항목`:'비어 있음';
        }
    }
    // ===== 휴지통 보기 (설정 안) =====
    async function openTrash(){
        await purgeTrash();           // 30일 지난 노트·폴더를 먼저 정리
        renderTrash();
        document.getElementById('trashModal').style.display='flex';
        openNav(closeTrash);
    }
    function closeTrash(){ document.getElementById('trashModal').style.display='none'; navDrop(closeTrash); }
    function renderTrash(){
        const el=document.getElementById('trashList');
        const notes=trashedNotes(), folders=trashedFolders();
        updateTrashCount();
        if(!notes.length&&!folders.length){
            el.innerHTML='<div class="vault-empty" style="padding:30px 10px;"><i class="ri-delete-bin-line"></i>휴지통이 비어 있습니다</div>';
            return;
        }
        const rows=[];
        folders.forEach(f=>{
            const left=TRASH_TTL_MS-(Date.now()-(f.trashed_at||0));
            const days=Math.max(1,Math.ceil(left/86400000));
            const n=Object.keys((f.trash_snapshot&&f.trash_snapshot.members)||{}).length;
            const countTxt=n?(' · 노트 '+n+'개'):'';
            rows.push({ts:f.trashed_at||0,html:`<div class="trash-item">
                <i class="ri-folder-3-fill" style="color:${f.color||'var(--accent)'};font-size:18px;"></i>
                <b>${esc(f.name||'폴더')} <small style="color:var(--text3);font-weight:500;">폴더${countTxt}</small></b>
                <span class="days">${days}일 후 삭제</span>
                <button onclick="restoreFolderFromTrash('${f.id}')">복구</button>
            </div>`});
        });
        notes.forEach(nb=>{
            const c=getCfg(nb.id);
            const left=TRASH_TTL_MS-(Date.now()-(c.trashed_at||0));
            const days=Math.max(1,Math.ceil(left/86400000));
            rows.push({ts:c.trashed_at||0,html:`<div class="trash-item">
                <i class="ri-file-text-line" style="color:var(--text3);font-size:16px;"></i>
                <b>${esc(nb.title||'새 노트')}</b>
                <span class="days">${days}일 후 삭제</span>
                <button onclick="restoreNoteFromTrash('${nb.id}')">복구</button>
            </div>`});
        });
        el.innerHTML=rows.sort((a,b)=>b.ts-a.ts).map(x=>x.html).join('');
    }
    function restoreNoteFromTrash(id){
        restoreFromTrash(id);
        renderTrash(); renderGrid(); toast('노트를 복원했습니다',1600);
        setTimeout(()=>{ const c=document.querySelector('.note-card[data-nb-id="'+id+'"]'); if(c) playClawDrop(c); },80);
    }
    function restoreFolderFromTrash(fid){
        const fs=getFolders();
        const root=fs.find(f=>f.id===fid&&f.trashed_at); if(!root) return;
        const snap=root.trash_snapshot||{};
        const ids=new Set(_folderTrashIds(root));
        fs.forEach(f=>{
            if(!ids.has(f.id)) return;
            delete f.trashed_at; delete f.trash_root; delete f.trash_root_id;
            if(f.id!==fid) delete f.trash_snapshot;
        });
        // 원래 부모가 없어졌거나 아직 휴지통이면 최상위에서 복원한다.
        if(root.parent){
            const parent=fs.find(f=>f.id===root.parent);
            if(!parent||parent.trashed_at) delete root.parent;
        }
        const members=snap.members||{};
        Object.keys(members).forEach(nbId=>{
            if(!notebooks.some(n=>String(n.id)===String(nbId))) return;
            const old=members[nbId];
            const c=getCfg(nbId);
            if(old&&fs.some(f=>f.id===old&&!f.trashed_at)) c.folder=old;
            else c.folder=fid;
            setCfg(nbId,c);
        });
        delete root.trash_snapshot;
        saveFolders(fs);
        pushSettingsNow(); saveLocalNBs();
        renderTrash(); renderGrid();
        toast(`'${root.name||'폴더'}' 와 안의 노트를 복원했습니다`,2200);
        setTimeout(()=>{ const c=document.querySelector('.folder-card[data-folder-id="'+fid+'"]'); if(c) playClawDrop(c); },80);
    }
    // 휴지통 비우기 (노트·폴더를 30일 대기 없이 즉시 제거)
    async function emptyTrash(){
        const notes=trashedNotes().map(nb=>nb.id);
        const folders=trashedFolders().map(f=>f.id);
        const total=notes.length+folders.length;
        if(!total){ toast('휴지통이 비어 있습니다',1600); return; }
        if(!confirm(`휴지통을 비울까요? ${total}개 항목이 되돌릴 수 없게 지워집니다.`)) return;
        folders.forEach(permanentDeleteFolder);
        for(const id of notes){ await permanentDeleteNB(id, true); }
        renderTrash(); renderGrid(); toast('휴지통을 비웠습니다');
    }
    function noteFolder(id){ return getCfg(id).folder||null; }
    function setNoteFolder(id,fid){
        const c=getCfg(id);
        // 9.3 · 잠긴 폴더 안의 노트는 밖으로 빼낼 수 없다.
        //  (드래그·메뉴·일괄이동 등 어느 경로로 와도 여기서 막힌다)
        const cur=c.folder||null;
        if(cur&&cur!==fid&&isFolderLocked(cur)&&!isFolderOpen(cur)){
            toast('🔒 잠긴 폴더에서는 노트를 꺼낼 수 없습니다',2400);
            return false;
        }
        if(fid&&!isFolderOpen(fid)){
            toast('🔒 잠긴 폴더에는 넣을 수 없습니다',2000);
            return false;
        }
        if(fid) c.folder=fid; else delete c.folder;
        setCfg(id,c);
        pushSettingsNow();      // 폴더 소속도 즉시 서버 반영
        return true;
    }
    function createFolder(name,ids){
        const f=getFolders();
        const nf={id:'f_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
                  name:name||'새 폴더',
                  color:FOLDER_COLORS[f.length%FOLDER_COLORS.length],
                  icon:'ri-folder-3-fill',created_at:new Date().toISOString()};
        if(curFolder) nf.parent=curFolder;      // 폴더 안에서 만들면 그 안에 생긴다
        untombstone('folders',nf.id);
        f.push(nf); saveFolders(f);
        (ids||[]).forEach(id=>setNoteFolder(id,nf.id));
        return nf;
    }
    function deleteFolder(fid){
        // 폴더 자체는 30일 휴지통으로 보내고, 안의 노트는 바로 폴더 바깥으로
        // 꺼낸다. 삭제 순간의 소속을 스냅샷으로 남겨 폴더를 복구하면 당시
        // 노트와 하위 폴더가 모두 원래 자리로 돌아오게 한다.
        const fs=getFolders();
        const root=fs.find(f=>f.id===fid); if(!root) return;
        const up=folderParent(fid);
        const ids=folderTree(fid);
        const idset=new Set(ids);
        const members={};
        notebooks.forEach(n=>{
            const old=noteFolder(n.id);
            if(!idset.has(old)) return;
            members[n.id]=old;
            if(isTrashed(n.id)) return;       // 노트 휴지통 상태·복원 위치는 보존
            const c=getCfg(n.id);
            if(up) c.folder=up; else delete c.folder;
            setCfg(n.id,c);
        });
        const ts=Date.now();
        fs.forEach(f=>{
            if(!idset.has(f.id)) return;
            f.trashed_at=ts;
            f.trash_root_id=fid;
            if(f.id===fid){
                f.trash_root=true;
                f.trash_snapshot={folderIds:ids.slice(),members,parent:up||null};
            }else{
                delete f.trash_root;
                delete f.trash_snapshot;
            }
        });
        saveFolders(fs);
        pushSettingsNow(); saveLocalNBs();
        if(idset.has(curFolder)) curFolder=up;
    }
    // ===== 폴더 계층 (폴더 안에 폴더) =====
    function folderParent(fid){
        const f=getFolders().find(x=>x.id===fid);
        return (f&&f.parent)||null;
    }
    function childFolders(fid){
        // 휴지통으로 간 폴더는 객체와 계층을 그대로 보관하되 일반 목록에서는
        // 숨긴다. 그래야 나중에 하위 폴더까지 정확히 복구할 수 있다.
        return getFolders().filter(f=>((f.parent||null)===(fid||null))
            &&!f.trash&&!f.trashed_at&&f.id!=='f_trash');
    }
    // fid 아래(자기 자신 포함) 모든 폴더 id
    function folderTree(fid){
        const out=[fid];
        childFolders(fid).forEach(c=>out.push(...folderTree(c.id)));
        return out;
    }
    // 최상위까지의 경로 [조상…, 자신]
    function folderPath(fid){
        const path=[]; let cur=fid, guard=0;
        while(cur&&guard++<40){
            const f=getFolders().find(x=>x.id===cur);
            if(!f) break;
            path.unshift(f);
            cur=f.parent||null;
        }
        return path;
    }
    // a 가 b 의 하위인가 (순환 방지용)
    function isDescendant(a,b){
        if(!a||!b) return false;
        return folderTree(b).indexOf(a)>=0;
    }
    // 9.3 · 마지막 방어선: 어떤 경로로 불려도 잠긴 폴더는 움직이지 않는다
    function setFolderParent(fid,pid){
        if(isFolderLocked(fid)&&!isFolderOpen(fid)) return false;
        if(pid&&!isFolderOpen(pid)) return false;
        if(fid===pid) return false;
        if(pid&&isDescendant(pid,fid)) return false;      // 자기 자손 밑으로는 못 넣는다
        const f=getFolders();
        const t=f.find(x=>x.id===fid); if(!t) return false;
        if(pid) t.parent=pid; else delete t.parent;
        saveFolders(f);
        return true;
    }
    // 안에 든 노트 수 (하위 폴더까지 합산)
    function folderCount(fid){
        const ids=folderTree(fid);
        // 휴지통으로 이동한 노트는 카운트에서 제외 (폴더 소속이 남아 있어도)
        return notebooks.filter(n=>ids.indexOf(noteFolder(n.id))>=0 && !isTrashed(n.id)).length;
    }
    function folderDirectCount(fid){ return notebooks.filter(n=>noteFolder(n.id)===fid && !isTrashed(n.id)).length; }
    function enterSelectMode(id){ selectMode=true; selectedNBs.clear(); selectedNBs.add(id);
        document.getElementById('mainView').classList.add('select-mode'); updateSelUI(); renderGrid(); }
    function toggleSelectNB(id,card){
        if(selectedNBs.has(id)){selectedNBs.delete(id);card.classList.remove('selected');}
        else{selectedNBs.add(id);card.classList.add('selected');}
        updateSelUI(); if(!selectedNBs.size) cancelSelect();
    }
    function updateSelUI(){
        document.getElementById('selectedCount2').textContent=selectedNBs.size;
        document.getElementById('selectBar').classList.toggle('show',selectMode&&selectedNBs.size>0);
    }
    function cancelSelect(){
        selectMode=false; selectedNBs.clear();
        document.getElementById('mainView').classList.remove('select-mode');
        document.getElementById('selectBar').classList.remove('show'); renderGrid();
    }
    function makeFolderFromSelection(){
        if(!selectedNBs.size){ toast('노트를 선택하세요'); return; }
        const name=prompt(`${selectedNBs.size}개 노트를 담을 폴더 이름`,'새 폴더');
        if(!name||!name.trim()) return;
        const f=createFolder(name.trim(),Array.from(selectedNBs));
        cancelSelect(); renderGrid();
        playFolderCreateAnim(f.id);
        toast(`'${f.name}' 폴더 생성됨 (${folderCount(f.id)}개)`);
    }

    function openMoveFolderMenu(ev){
        ev.stopPropagation();
        if(!selectedNBs.size){ toast('노트를 선택하세요'); return; }
        const fs=getFolders();
        const m=document.getElementById('ctxMenu');
        let html=`<div class="ctx-item" onclick="moveSelectedTo(null)"><i class="ri-home-4-line"></i> 전체 노트(폴더 밖)</div>`;
        if(fs.length) html+='<div class="ctx-sep"></div>';
        // 계층 순서대로 (들여쓰기로 깊이 표시) — 휴지통은 이동 대상에서 제외
        const walk=(pid,depth)=>{
            childFolders(pid).forEach(f=>{
                if(f.trash) return;
                const lk=isFolderLocked(f.id)&&!isFolderOpen(f.id);
                html+=`<div class="ctx-item" onclick="moveSelectedTo('${f.id}')" `+
                      `style="padding-left:${11+depth*13}px;${lk?'opacity:.5;':''}">`+
                      `<i class="${lk?'ri-folder-lock-fill':(f.icon||'ri-folder-3-fill')}" `+
                      `style="color:${f.color||'var(--accent)'}"></i> ${esc(f.name)}${lk?' 🔒':''}</div>`;
                walk(f.id,depth+1);
            });
        };
        walk(null,0);
        html+=`<div class="ctx-sep"></div><div class="ctx-item" onclick="makeFolderFromSelection()"><i class="ri-folder-add-line"></i> 새 폴더 만들기…</div>`;
        m.innerHTML=html;
        m.classList.add('show');
        const r=ev.currentTarget.getBoundingClientRect();
        m.style.left=Math.min(r.left,window.innerWidth-220)+'px';
        m.style.top=Math.max(10,r.top-Math.min(320,m.offsetHeight+10))+'px';
    }
    // 폴더 자체를 다른 폴더 안으로 옮긴다 (순환은 막는다)
    function openFolderMoveMenu(ev,fid){
        if(ev){ ev.stopPropagation(); }   // 클릭 버블링으로 메뉴가 즉시 닫히는 것 방지
        const m=document.getElementById('ctxMenu');
        const me=getFolders().find(f=>f.id===fid);
        let html=`<div class="ctx-item" onclick="doMoveFolder('${fid}',null)">`+
                 `<i class="ri-home-4-line"></i> 최상위로 꺼내기</div>`;
        const cand=getFolders().filter(f=>!f.trashed_at&&f.id!==fid&&!isDescendant(f.id,fid));
        if(cand.length) html+='<div class="ctx-sep"></div>';
        cand.forEach(f=>{
            const depth=folderPath(f.id).length-1;
            html+=`<div class="ctx-item" onclick="doMoveFolder('${fid}','${f.id}')" `+
                  `style="padding-left:${11+depth*12}px">`+
                  `<i class="${f.icon||'ri-folder-3-fill'}" style="color:${f.color||'var(--accent)'}"></i> ${esc(f.name)}</div>`;
        });
        if(!cand.length) html+=`<div class="ctx-item" style="opacity:.5;pointer-events:none">옮길 폴더가 없습니다</div>`;
        m.innerHTML=html;
        m.classList.add('show');
        const x=window.sdyUiCss((ev&&ev.clientX)||lastMouse.clientX||120);
        const y=window.sdyUiCss((ev&&ev.clientY)||lastMouse.clientY||120);
        m.style.left=Math.min(x,window.sdyUiCss(window.innerWidth)-230)+'px';
        m.style.top=Math.min(y,window.sdyUiCss(window.innerHeight)-(m.offsetHeight||260)-8)+'px';
    }
    function doMoveFolder(fid,pid){
        closeCtxMenu();
        // 9.3 · 잠긴 폴더는 옮길 수 없다 (잠금을 먼저 풀어야 한다)
        if(isFolderLocked(fid)&&!isFolderOpen(fid)){
            toast('🔒 잠긴 폴더는 옮길 수 없습니다. 먼저 잠금을 해제하세요',2600); return;
        }
        // 잠긴 폴더 '안으로' 넣는 것도 막는다
        if(pid&&!isFolderOpen(pid)){
            toast('🔒 잠긴 폴더에는 넣을 수 없습니다',2000); return;
        }
        // 순환/자기 자신 이동은 미리 막는다 (집게 애니메이션 없이 안내만)
        if(pid && (pid===fid || isDescendant(pid,fid))){
            toast('그 폴더 안으로는 넣을 수 없습니다',2000); return;
        }
        const fc=document.querySelector('.folder-card[data-folder-id="'+fid+'"]');
        const finish=()=>{
            if(!setFolderParent(fid,pid)){
                toast('그 폴더 안으로는 넣을 수 없습니다',2000); return;
            }
            renderGrid();
            const nm=pid?(getFolders().find(f=>f.id===pid)||{}).name:'최상위';
            toast(`'${nm}' 로 옮겼습니다`,1800);
        };
        if(!fc){ finish(); return; }
        if(pid){
            // 다른 폴더 안으로 → 집게가 집어서 그 폴더에 넣는다
            const dest=document.querySelector('.folder-card[data-folder-id="'+pid+'"]');
            if(dest) playClawToFolderMulti([fc], dest, finish);
            else finish();
        }else{
            // 최상위로 꺼내기 → 집게가 집어서 던져 올린다
            playClawThrow(fc, finish);
        }
    }
    function moveSelectedTo(fid){
        closeCtxMenu();
        if(fid&&!isFolderOpen(fid)){ toast('🔒 잠긴 폴더에는 넣을 수 없습니다',2000); return; }
        const ids=Array.from(selectedNBs);
        const n=ids.length;
        const nm=fid?(getFolders().find(f=>f.id===fid)||{}).name:'전체 노트';
        const finish=()=>{
            ids.forEach(id=>setNoteFolder(id,fid));
            cancelSelect(); renderGrid();
            toast(`${n}개 노트를 '${nm}' 로 이동`);
        };
        animateMoveLocal(ids, fid, finish);
    }

    async function delSelectedNBs(){
        if(!selectedNBs.size) return;
        const all=Array.from(selectedNBs);
        const locked=adminMode?[]:all.filter(id=>isLocked(id)&&!isUnlocked(id));
        const target=adminMode?all:all.filter(id=>!(isLocked(id)&&!isUnlocked(id)));
        if(!target.length){
            toast(`🔒 선택한 ${locked.length}개가 모두 잠겨 있어 삭제할 수 없습니다`,2600); return;
        }
        const n=target.length;
        const msg = locked.length
            ? `${n}개의 노트를 휴지통으로 이동하시겠습니까?\n(잠긴 노트 ${locked.length}개는 제외됩니다)`
            : `${n}개의 노트를 휴지통으로 이동하시겠습니까?`;
        if(!confirm(msg)) return;
        // 선택한 모든 노트의 실제 카드를 찾아 다중 뽑기 기계로 한꺼번에 던진다
        const _cards=target.map(id=>document.querySelector('.note-card[data-nb-id="'+id+'"]'));
        playClawThrowMulti(_cards, ()=>{
            for(const id of target) moveToTrash(id);
            cancelSelect();
            toast(locked.length?`${n}개 처리됨 (잠긴 ${locked.length}개 유지)`:`${n}개 노트를 휴지통으로 이동`);
        });
    }
    function saveLocalNBs(){
        localStorage.setItem('sdy_local_nbs',JSON.stringify(sortNBs(notebooks.filter(n=>String(n.id).startsWith('local_')))));
    }

    function renderSizePresetGrid(){
        const grid=document.getElementById('sizePresetGrid'); grid.innerHTML='';
        Object.entries(SIZE_PRESETS).forEach(([k,p])=>{
            const r=p.w/p.h;
            const tw=r>=1?60:Math.max(24,Math.round(60*r));
            const th=r>=1?Math.max(24,Math.round(60/r)):60;
            const b=document.createElement('button');
            b.className='size-preset-card';
            b.innerHTML=`<div class="size-preset-thumb" style="width:${tw}px;height:${th}px;"></div><div style="font-size:13px;font-weight:600;">${p.label}</div>`;
            b.onclick=()=>createNB(k);
            grid.appendChild(b);
        });
    }
    function openCreateModal(){ renderSizePresetGrid(); document.getElementById('createModal').style.display='flex'; openNav(closeCreateModal); }
    // 새 노트 모달에서 폴더 만들기
    function createFolderFromModal(){
        closeCreateModal();
        const name=prompt('새 폴더 이름','새 폴더');
        if(name===null) return;
        const nf=createFolder((name||'').trim()||'새 폴더', []);
        renderGrid();
        playFolderCreateAnim(nf.id);
        toast(`'${nf.name}' 폴더를 만들었습니다`,1800);
    }
    function closeCreateModal(){ document.getElementById('createModal').style.display='none'; navDrop(closeCreateModal); }
    // 폴더 생성 애니메이션: 새 폴더 카드가 놓인 자리에 뽑기 기계가 폴더를 내려놓는다
    function playFolderCreateAnim(fid){
        setTimeout(()=>{
            const fc=document.querySelector('.folder-card[data-folder-id="'+fid+'"]');
            if(fc) playClawDrop(fc);
        },60);
    }
    // ===== 관리자 키 위탁(escrow) =====
    // 노트를 잠글 때 비밀번호를 '관리자 공개키'로 한 번 더 암호화해 함께 보관한다.
    // 개인키는 관리자 비밀번호로 감싸져 있어, 관리자만 풀어서 노트를 열 수 있다.
    const ADMIN_PUB_SPKI="MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5e0mz7qtAZWqq4eW7Y+jax9h4oPr/u1oHg8aYKkWr7URAF8RxS9SvWbaUxUxusGOGr2PsQS1KjiY2QrYi92nsNIcdyeWbu+tL7kbBEtTCb3y8QICVq1S5tDYd9gQWaC1wfRsYeRYH8lq8XXVRFhTnOTMgHv51XqSEBOhv2icT/bTNWN4gvFlfyyXb6bPMPM9SmIL8sCQoyNpnpW4oQ72gQFdppIdt5wRj7H70SdrYEzbmyZmw/a0A+Vf8uNRiYPTET8Bp97KtYXlrd3aKdBzSzERV/keQYx+x+/CgtDqTsW6/75pEapfk3ixV0d4cs4SwtFgaKzAneD58gXZf9/JbQIDAQAB";
    const ADMIN_KEY_SALT="rlXkRnCS9FsQeDUWM9ufDA==";
    const ADMIN_KEY_IV="98EMpINMfMNnzz5S";
    const ADMIN_KEY_WRAPPED="O9mlisbkZrqC311lPG7wALVjjJ6hlYma6rhFeATGBPX3ocDq8xT3i4tcrFAXk6G09Yde218hcYUG1Pjbcf/4ofw9G4y50k69tYecCaEHZR8HlpVH5C+twLwniQcY99GNvzb2QtcNIW6dibUrFMB7tt6TLe7GhMi+OsIv2Xs6NPRANM92WR9TVHO/zxZuAdN54CYZMMRDf15OEp2C63RepGcuLvi+6/fc/fkqgC24VUAyZuLWb26poM+zdeQim2DlfSkVE1mJmsh9jNz73cOMQh696HbBoLn/MhaFckGL0fmlc7zeHEtTF6nNAucP51p0ip0W0F+V20yrz+5p2V2BjjGNS/T3h6IvjRGN1ND8Vd9tmHz2CoEBacoo2hLO5IfIbcFNYU9wZiJgRBXo790125nuwfQwnrFk2XmGa7+q+DggacaqoYdLJr0K4kyVpkbOtPrMprFgjj9oKYRJU1fp3OFiUWzLIXwkMRIIZjooYs6g6a25XvMNh5VG7yGxkzAXlNcppLWvNi4DkXdVWVTU/kUf0f3Tml8TAMuVIDOw2i4GdyOa9Seyz7lbdYsyzlLAi1EndhuOcUy77z/n+ChUZhz7A5GeKegXhYlQKDpvqLeKaoPHj4xgi00z/f7mshKVmFciiTFI3mfPkf1zFfTId8Yky1Mh9ulWA30h5IiY45FoHYDYDvjERd0M/dW3ejjcNfgVBU7fwB5wqgXOObj860EEyhurP1wv0m9V/kY2BxZt9DirQJoK/VS2g7SxHaFwIuzSLnMDXL3IgYgvtmz+QBn/LTVRhbcK0CrrznTPiMok3TU75RF80Fepo0CmItEkVjmyYCnhfx7qTaPhZGCe1ZLtUDyru3nQBI2TVRLxjFdDTondOoT41RS7rAtm5EnJykqb+1QpeSMohSttiDwi6gMTJTALVfb6486hWU5j6X+KNnoyA1Ku6zO4uOQV1z00fxxjrPOX+9yqdAH4goZavjS8y3nDpifzUMcDJmwTRMmxcNcznaeu4/GrgACt21jlDpbyZynS0fnysi2xRX+sG+8ohtfuXnDrqWocarBxdxeII1+Gx4QWu9HSkzaVx97GdeEcOGCD/C8uzWZ0RIQQ7j0czbPP5wdmUKXV76kN6HTs+L0Arthx3A1dXnIHofsCDPbfCn5Fm6ys/4i48LcYckiVtxJxBTIrDmXm3U1UAZQlW+1fhrKJB21OB52ISVAj3fW9dBMhuOwqN/PD4oHLhCwG2G+5uVMdA2+psBsWu7ngD/qo4pGz8DjIeUebxO0LNl6hOsrMtR1K+v1fnh60hiPtNaRaB45H5M9/DhyrD0xFwgxM4DnADkvexvmDnqaASJktE4LlY93QRHIUE6zdGQ5IxD5X4cy6Cy6HBYb3DczQ+RjjXfId/DGpW5eh8x/r9mnrpXlHO0kKaXkyx8ZgGV8oVI96Lz0UhADC/dbGOvZRIPjZDGKy32zQO8VOqlOjLZCTftYJMeuf1AQWQLd4d+Cdi906X4pNJUgF+N2rcTZdxL+9HJWoax42kBU3pUI814LHzHMXuGMJjyspn70lmhCns9htXEgwUumEV0GpL8UTp4moIyEhmhnbequtj5SX/Tqgutnv7lbSiO4KbAU9OM+DvT3U6sojAygW98Wz0Q==";

    let adminPrivKey=null;      // 로그인 중에만 메모리에 존재

    async function importAdminPub(){
        return crypto.subtle.importKey('spki',unb64(ADMIN_PUB_SPKI),
            {name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
    }
    // 잠금 비밀번호 봉인: 6.4 부터 서버 마스터키 방식 우선(누구나 봉인 가능),
    // 서버 연결이 없으면 오프라인 폴백으로 관리자 공개키(RSA) 봉인.
    async function makeEscrow(pw){
        try{
            const r=await fetch('/api/escrow/wrap',{method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({pw})});
            const d=await r.json().catch(()=>({}));
            if(d&&d.ok&&d.blob) return d.blob;
        }catch(e){}
        try{
            const pub=await importAdminPub();
            const ct=await crypto.subtle.encrypt({name:'RSA-OAEP'},pub,te.encode(pw));
            return b64(ct);
        }catch(e){ console.warn('escrow 생성 실패',e); return null; }
    }
    // 관리자 비밀번호로 개인키를 복원
    async function unwrapAdminKey(pw){
        const base=await crypto.subtle.importKey('raw',te.encode(pw),'PBKDF2',false,['deriveKey']);
        const wk=await crypto.subtle.deriveKey(
            {name:'PBKDF2',salt:unb64(ADMIN_KEY_SALT),iterations:PBKDF2_ITER,hash:'SHA-256'},
            base,{name:'AES-GCM',length:256},false,['decrypt']);
        const pkcs8=await crypto.subtle.decrypt(
            {name:'AES-GCM',iv:unb64(ADMIN_KEY_IV)},wk,unb64(ADMIN_KEY_WRAPPED));
        return crypto.subtle.importKey('pkcs8',pkcs8,{name:'RSA-OAEP',hash:'SHA-256'},false,['decrypt']);
    }
    // 봉인된 비밀번호 되찾기: S2(서버 마스터키)는 관리자 세션으로, 옛 RSA 봉인은 개인키로.
    async function recoverPw(esc){
        if(!esc) return null;
        if(String(esc).indexOf('S2:')===0){
            if(!adminMode) return null;
            try{
                const r=await fetch('/api/escrow/unwrap',{method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({blob:esc,token:adminToken||undefined})});
                const d=await r.json().catch(()=>({}));
                if(d&&d.ok&&d.pw) return d.pw;
            }catch(e){}
            return null;
        }
        if(!adminPrivKey) return null;
        try{
            const pt=await crypto.subtle.decrypt({name:'RSA-OAEP'},adminPrivKey,unb64(esc));
            return td.decode(pt);
        }catch(e){ return null; }
    }

    // 관리자 권한으로 노트 잠금 열기 (비번 없이)
    // 관리자는 모든 노트를 열 수 있어야 한다. 다만 '진짜 암호문'만은
    // 비밀번호 없이 수학적으로 복호화할 수 없으므로 그 경우만 예외.
    async function adminUnlockNote(nbId){
        if(!adminMode) return false;
        if(sessionKeys.has(nbId)) return true;
        const cfg=getCfg(nbId);
        if(!cfg.lock||!cfg.lock.salt) return true;

        // ① 위탁(escrow) 이 있으면 비밀번호를 복원해서 정상적으로 연다
        const pw=await recoverPw(cfg.lock.escrow);
        if(pw){
            try{
                const key=await deriveKey(pw,unb64(cfg.lock.salt));
                if(cfg.encBlob) await decryptDoc(cfg.encBlob,key);   // 검증
                sessionKeys.set(nbId,key);
                adminOpenedNotes.add(nbId);
                return true;
            }catch(e){ /* 아래 경로로 계속 */ }
        }

        // ② 위탁이 없는 옛 노트라도 본문이 암호문이 아니면(=평문 pages)
        //    잠금 표시만 있는 것이므로 관리자에게는 열어 준다.
        if(!cfg.encBlob){
            adminOpenedNotes.add(nbId);
            adminPlainUnlocked.add(nbId);   // 세션 키 없이 열린 상태
            return true;
        }

        // ②-2 (6.2) 구버전: 암호문이 남아 있더라도 평문 본문이 로컬/서버에
        //      남아 있으면 관리자 권한으로 복원해서 연다.
        const rec=await recoverPlain(nbId,cfg);
        if(rec){
            decCache.set(nbId,rec);
            adminOpenedNotes.add(nbId);
            adminPlainUnlocked.add(nbId);
            return true;
        }

        // ③ 여기까지 오면 비밀번호로만 풀 수 있는 진짜 암호문이다
        return false;
    }
    // 구버전 평문 본문 복원: ① 로컬 cfg.pages  ② 서버(Supabase) memo 본문
    async function recoverPlain(nbId,cfg){
        try{
            if(Array.isArray(cfg.pages)&&cfg.pages.some(p=>((p.els||[]).length)||((p.tables||[]).length))){
                return migrate(cfg,nbId);
            }
        }catch(e){}
        try{
            if(typeof SB!=='undefined'&&SB){
                const {data}=await SB.from('memos').select('content')
                    .eq('notebook_id',nbId).limit(1);
                const c=data&&data[0]&&data[0].content;
                if(c){
                    const st=JSON.parse(c);
                    if(st&&!st.encBlob&&Array.isArray(st.pages)
                       &&st.pages.some(p=>((p.els||[]).length)||((p.tables||[]).length))){
                        return {paper:st.paper||cfg.paper||'blank',
                                sizePreset:st.sizePreset||cfg.sizePreset||'a4_portrait',
                                emoji:st.emoji||'', glossary:st.glossary||{},
                                pages:st.pages};
                    }
                }
            }
        }catch(e){}
        return null;
    }
    // 관리자 권한으로 모든 잠긴 노트 열기
    async function adminUnlockAll(){
        if(!adminMode) return {ok:0,fail:0};
        let okc=0,fail=0;
        for(const nb of notebooks){
            if(!isLocked(nb.id)||isUnlocked(nb.id)) continue;
            if(await adminUnlockNote(nb.id)){
                okc++;
                try{
                    // 평문 잠금 노트는 cfg.pages 를 그대로 읽어 온다
                    const d=adminPlainUnlocked.has(nb.id)
                          ? migrate(getCfg(nb.id),nb.id)
                          : await loadDocAsync(nb.id);
                    if(d) decCache.set(nb.id,d);
                }catch(e){}
            }else fail++;
        }
        if(fail>0) toast(`⚠️ 잠긴 노트 ${fail}개는 위탁 정보가 없어 열지 못했습니다. 열어서 비밀번호를 한 번 입력하면 관리자 권한이 등록됩니다`,5000);
        return {ok:okc,fail};
    }


/* APP-PART:02-home.js:END */
