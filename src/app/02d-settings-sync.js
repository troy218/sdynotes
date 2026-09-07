/* === src/app/02d-settings-sync.js ===
   북마크 · 재생목록 · 설정 LWW · 집게 애니
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:02d-settings-sync.js:BEGIN */
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
        // 버그 일지 — 해돌이가 정리해 기록한 버그(제목·증상·재현·기대·메모).
        //   모두가 보는 일지라 항목 하나를 키 하나('buglog:<id>')로 동기화한다.
        getBugEntries().forEach(x=>{
            if(x&&x.id){ const k='buglog:'+x.id; seen.add(k); out[k]=x; }
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
    const _DEL_LIMIT={bookmark:2, playlist:2, folder:2, buglog:10};
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
            if(k.indexOf('buglog:')===0){
                const id=k.slice(7), a=getBugEntries(), b=a.filter(x=>String(x.id)!==id);
                if(a.length===b.length) return false;
                saveBugEntries(b); return true;
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
            if(k.indexOf('buglog:')===0){
                const id=k.slice(7);
                if(!d||typeof d!=='object'||String(d.id||'')!==id) return false;
                const a=getBugEntries(), i=a.findIndex(x=>String(x.id)===id);
                if(i>=0){
                    if(JSON.stringify(a[i])===JSON.stringify(d)) return false;
                    a[i]=d;
                }else a.push(d);
                saveBugEntries(a); return true;
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
                // 다른 기기에서 온 버그 일지 기록/삭제도 설정 줄과 열린 목록에 반영
                try{ paintBugCount(); }catch(e){}
                try{ bugRepaintIfOpen(); }catch(e){}
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
        navigator.clipboard&&navigator.clipboard.writeText(l[i].url)
            .then(()=>{ try{ invalidateElsCopyForOsText(); }catch(_e){} })
            .catch(()=>{});
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

/* APP-PART:02d-settings-sync.js:END */
