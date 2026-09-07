/* === src/app/07c-undo.js ===
   되돌리기 재설계
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:07c-undo.js:BEGIN */
    // ── 20.3 · 되돌리기 재설계 ───────────────────────────────────────────────
    //  예전 문제 ①  undo 가 문서를 스냅샷으로 **통째 교체**했다. 그래서 같이
    //    편집 중이던 다른 사람이 그 사이에 적은 글·그림이 통째로 사라졌다
    //    ("여러 명이 편집하면 되돌리기가 남의 작업을 먹는다").
    //  예전 문제 ②  되돌린 뒤 reviveDocMaps 가 rehashAll 로 '이미 보낸 것' 표를
    //    현재 내용으로 새로 써 버려서, 되돌린 결과가 **서버로 전송되지 않았다**.
    //    서버에는 되돌리기 전 내용이 남아 있으니 다음 pull 이 그걸 도로 끌고 와
    //    "되돌렸는데 잠시 뒤 되살아난다 / 해돌이 작업은 되돌리기가 안 먹는다"
    //    처럼 보였다(30초 에코 가드는 글자 서식만 막아 줬다).
    //  이제 되돌리기는 doc 객체를 그대로 두고 **바뀐 요소만 골라 되돌린다**.
    //   · 스냅샷 이후 원격(다른 기기/사람)이 건드린 요소는 건드리지 않는다.
    //   · 원격이 새로 만든 요소·쪽은 지우지 않는다.
    //   · 해시 표를 유지하므로 되돌린 내용이 정상적으로 동기화된다.
    // 히스토리 한 칸 = {snap, remote:Set(원격이 건드린 요소 id), remotePages}
    //   22.1 · 글상자 한 칸 편집은 snap 대신 patch 를 담는다 — 그 상자의 '적기 전'
    //   필드뿐이라 문서 크기(쪽 500개)가 아니라 상자 크기(수백 바이트)다.
    function _histEntry(snap,patch){ return {snap:patch?null:snap,patch:patch||null,remote:new Set(),remotePages:false}; }
    // 원격 동기화가 요소를 건드리면 쌓여 있는 모든 되돌리기 지점에 표시한다.
    function histMarkRemote(id){
        if(!id) return;
        try{
            history.forEach(e=>{ if(e&&e.remote) e.remote.add(id); });
            redoStack.forEach(e=>{ if(e&&e.remote) e.remote.add(id); });
        }catch(e){}
    }
    function histMarkRemotePages(){
        try{
            history.forEach(e=>{ if(e) e.remotePages=true; });
            redoStack.forEach(e=>{ if(e) e.remotePages=true; });
        }catch(e){}
    }
    // 스냅샷 문서에 그 id 의 요소가 있는지 (쪽을 옮겼을 수도 있어 전체를 본다)
    function _snapElIds(T){
        const s=new Set();
        ((T&&T.pages)||[]).forEach(pg=>((pg&&pg.els)||[]).forEach(el=>{ if(el&&el.id) s.add(el.id); }));
        return s;
    }
    // 한 쪽 병합: 스냅샷의 요소로 되돌리되, 원격이 건드린 요소는 지금 것을 남긴다.
    function _histMergePage(livePage,tPage,remote,tIds){
        const live=(livePage.els||[]);
        const liveById=new Map(); live.forEach(el=>{ if(el&&el.id) liveById.set(el.id,el); });
        const out=[]; const done=new Set(); let changed=false;
        ((tPage&&tPage.els)||[]).forEach(tel=>{
            if(!tel||!tel.id) return;
            done.add(tel.id);
            if(remote.has(tel.id)){
                // 그 사이 남이 고친 요소 — 되돌리지 않고 지금 내용을 지킨다.
                const cur=liveById.get(tel.id);
                if(cur) out.push(cur);          // 남이 지웠으면 되살리지도 않는다
                return;
            }
            const h=JSON.stringify(tel);
            if(h!==JSON.stringify(liveById.get(tel.id))) changed=true;
            out.push(JSON.parse(h));
        });
        // 스냅샷에 없던 요소 = 그 뒤에 생긴 것. 남이 만든 것만 남긴다.
        live.forEach(el=>{
            if(!el||!el.id||done.has(el.id)) return;
            if(tIds.has(el.id)) return;          // 다른 쪽으로 옮겨간 요소는 위에서 처리됨
            if(remote.has(el.id)) out.push(el);
        });
        if(out.length!==live.length||JSON.stringify(livePage.tables||[])!==JSON.stringify((tPage&&tPage.tables)||[])) changed=true;
        if(changed&&(!tPage||tPage.__lazy==null)){ livePage.__dirty=true; livePage.edited=1; }
        livePage.els=out;
        if(tPage&&tPage.tables) livePage.tables=JSON.parse(JSON.stringify(tPage.tables));
        else if(livePage.tables) livePage.tables=[];
        if(tPage&&tPage.__lazy!=null) livePage.__lazy=tPage.__lazy; else delete livePage.__lazy;
        return livePage;
    }
    // 스냅샷을 '지금 문서 위에' 되돌려 붙인다 (doc 객체는 그대로 둔다).
    function histRestore(entry){
        if(!doc||!entry) return false;
        let T=null;
        if(!entry.snap) return false;          // 22.1 · 패치 칸은 문서 스냅샷이 없다
        try{ T=JSON.parse(entry.snap); }catch(e){ return false; }
        if(!T) return false;
        const remote=entry.remote||new Set();
        const tIds=_snapElIds(T);
        const livePages=(doc.pages||[]).slice();
        const byId=new Map(); livePages.forEach(p=>{ if(p&&p.id) byId.set(p.id,p); });
        const used=new Set(); const outPages=[];
        ((T.pages)||[]).forEach((tp,i)=>{
            if(!tp) return;
            let lp=byId.get(tp.id);
            if(!lp){
                // 그 사이 남이 지운 쪽은 되살리지 않는다 (원격 쪽 변경이 있었을 때만)
                if(entry.remotePages) return;
                lp={id:tp.id,els:[],tables:[]};
            }
            used.add(tp.id);
            outPages.push(_histMergePage(lp,tp,remote,tIds));
        });
        // 스냅샷 뒤에 생긴 쪽 — 남이 만든 것이면 지우지 않는다.
        livePages.forEach(p=>{ if(p&&!used.has(p.id)&&entry.remotePages) outPages.push(p); });
        doc.pages=outPages.length?outPages:[blankPage()];
        // 문서 수준 설정(용지·크기·이모지·용어집·즐겨찾기 쪽…)은 스냅샷 값으로
        Object.keys(T).forEach(k=>{
            if(k==='pages'||k.indexOf('__')===0) return;
            doc[k]=T[k];
        });
        return true;
    }
    // 14.25.0 · 되돌리기 에코 가드. since=0 풀은 방금 되돌린 내 op 를 다시 들고
    //   오는데, html 은 3-way 병합이 지켜 주지만 _tbMergeRemote 가 서식
    //   (fontSize·font…)은 원격 값으로 덮어써 서식 되돌리기가 풀려 보였다.
    //   undo/redo 직후 30초(조용한 동기화 15초 주기 + 여유) 동안은 같은 기기의
    //   같은 rev 에코를 건너뛴다. 남의 기기 op·새 rev 는 그대로 적용한다.
    let _undoGuardUntil=0;
    // force=true 면 250ms 묶음을 건너뛰고 무조건 기록한다. 그리기(획·지우개)가
    // 쓴다 — 빠르게 연속으로 그려도 한 획씩 각자 되돌아가야 하기 때문이다.
    // 리턴값 = 방금 쌓은 스냅샷 문자열 (아무것도 안 쌓았으면 null). 그리기 쪽에서
    // "결국 아무 변화가 없던 제스처"의 스냅샷을 도로 치울 때 쓴다.
    function pushHistory(force){
        if(!doc) return null;
        // 18.9/20.3 · 편집 중 상자가 있으면 '적기 전' 스냅샷을 먼저 사다리에
        //   올린다. (타이핑 → 툴바 서식 순서일 때 타이핑분이 통째로 빠지던 문제)
        //   이때는 250ms 묶음도 건너뛴다 — 방금 올린 '적기 전'과 지금 상태는
        //   서로 다른 되돌리기 지점이어야 한다.
        try{ if(commitEditSnapshot()) force=true; }catch(e){}
        // 편집 중 툴바/우클릭 메뉴가 스크립트로 DOM 을 바꾼 작업은 브라우저 기본
        // contenteditable undo 스택에 안 들어가는 환경이 있다. 이 경우 바로 Ctrl+Z 를
        // 누르면 앱 히스토리로 되돌릴 수 있게 표시해 둔다. 실제 타이핑 input 이 오면
        // 위 input 리스너에서 다시 false 로 돌려 브라우저 기본 undo 를 우선한다.
        try{ if(document.querySelector('.tb.edit')) _scriptEditUndoable=true; }catch(e){}
        const now=Date.now();
        // 잦은 변화는 한 덩어리로 묶는다 (큰 문서에서 JSON.stringify 폭주 방지)
        if(!force&&now-_histT<250){ redoStack=[]; return null; }
        _histT=now;
        // 20.3 · 편집 중이던 글자는 아직 DOM 에만 있을 수 있다 → 스냅샷 전에 확정.
        //   (안 그러면 되돌리기 지점이 '방금 친 글자가 빠진 상태'로 찍혀,
        //    되돌리면 엉뚱하게 글자가 되살아나거나 사라진다)
        try{ commitEditingText(); }catch(e){}
        const snap=JSON.stringify(doc);
        history.push(_histEntry(snap));
        if(history.length>histMax()) history.shift();
        redoStack=[];                       // 새 작업이 생기면 다시 실행 기록은 무효
        return snap;
    }
    // 되돌리기는 문서를 JSON 으로 통째 복원한다. 그런데 동기화용 Map
    // (__localRev/__lastHash) 은 JSON 을 거치면 그냥 {} 가 되어 버려서
    // 이후 .get/.forEach 호출이 터지고 편집 동기화가 멈춘다.
    // → 복원 직후 Map 을 되살리고, 내용은 현재 문서 기준으로 다시 만든다.
    function reviveDocMaps(keep){
        if(!doc) return;
        const oldRev=keep&&keep.__localRev instanceof Map?keep.__localRev:null;
        const oldHash=keep&&keep.__lastHash instanceof Map?keep.__lastHash:null;
        const oldBase=keep&&keep.__base instanceof Map?keep.__base:null;
        const oldBaseRev=keep&&keep.__baseRev instanceof Map?keep.__baseRev:null;
        doc.__localRev=oldRev||new Map();
        doc.__lastHash=oldHash||new Map();
        doc.__base=oldBase||new Map();
        doc.__baseRev=oldBaseRev||new Map();
        doc.__pagesRev=keep?keep.__pagesRev||0:0;
        doc.__since=keep?keep.__since||0:0;
        if(keep&&keep.__ref){ doc.__ref=keep.__ref; doc.__loadedTo=keep.__loadedTo||0; }
        try{ rehashAll(); }catch(e){}     // 현재 내용으로 해시 재작성 → 변경분만 전송
    }
    // 20.3 · undo/redo 공통 — doc 을 교체하지 않고 '바뀐 것만' 되돌린다.
    //   되돌린 결과는 __lastHash 를 그대로 두고 saveDoc/queueOps 로 올라가므로
    //   서버에도 반영된다(예전에는 rehashAll 이 전송을 막아 도로 되살아났다).
    // 22.1 · '글상자 패치' 칸은 여기서 한 걸 더 들어간다 — 문서 전체를
    //   직렬화·파싱·재렌더하지 않고 그 상자와 그 쪽만 되돌린다. 되돌리기 자체가
    //   렉이 되지 않게 하기 위한 것으로, 저사양에서는 한 칸이 더 늘어나는 일도 없다.
    //   반환: null = 이 칸은 되돌릴 수 없다(사다리에서 건너뜀)
    //         {back, changed, patch?} = 되돌림 성공(back 은 반대 방향 기록)
    function _histApply(entry,label){
        const isPatch=!!(entry&&entry.patch);
        // 22.1 · 패치 칸에서는 JSON.stringify(doc) 를 아예 하지 않는다.
        const before=isPatch?null:JSON.stringify(doc);
        try{ commitEditingText(); }catch(e){}
        // 편집 중이던 상자는 되돌린 내용이 DOM 에 다시 그려져야 하므로 편집 종료
        try{ document.querySelectorAll('.tb.edit').forEach(o=>{
            o.classList.remove('edit');
            const c=o.querySelector('.tb-content'); if(c) c.contentEditable='false';
        }); _editScanDirty=true; _editBoxEl=null; }catch(e){}
        _editSnap=null; _editSnapUsed=true;
        if(isPatch) return _histApplyPatch(entry);
        if(!histRestore(entry)) return null;
        _docId=(curNB&&curNB.id)||null;
        try{ syncState(); }catch(e){}
        _undoGuardUntil=Date.now()+30000;   // 14.25.0 · 내 에코가 되돌리기를 덮지 않게
        selected=null; clearMulti();
        try{ clearActiveTbl(); }catch(e){}
        if(!doc.pages.length) doc.pages=[blankPage()];
        if(curPageIdx>=doc.pages.length) curPageIdx=doc.pages.length-1;
        if(curPageIdx<0) curPageIdx=0;
        try{ doc.__rv=(doc.__rv||0)+1; }catch(e){}
        renderPages();
        try{ updatePageInfo(); }catch(e){}
        saveDoc();
        try{ queueOps(); }catch(e){}        // 되돌린 내용을 다른 기기에도 반영
        // 되돌리기가 종이를 통째로 다시 그리므로, 펜 모드 중이었다면 그리기
        // 레이어(.drawing)를 새 종이에 다시 붙여야 한다. 예전엔 이게 빠져
        // 되돌린 뒤 펜이 먹통 → 펜을 끄고 다시 켜야 하는 불편이 있었다.
        if(penActive){ editorPapers().forEach(pp=>pp.classList.add('drawing')); try{ updateToolCursor(); }catch(e){} }
        return {back:before,changed:JSON.stringify(doc)!==before};
    }
    // 쪽 패치 칸 하나를 되돌린다 — 상자만 원상복구, 그 쪽만 다시 그린다.
    //   쪽·상자가 이미 없어진 칸(남이 지운 뒤 등)은 null → 사다리에서 건너뛴다.
    function _histApplyPatch(entry){
        const pt=entry.patch;
        const r=_applyEditPatch(pt,entry.remote);
        if(!r) return null;
        if(!r.changed) return {back:null,changed:false};
        const back=_editPatch(pt.pi,pt.id,r.cur);
        _docId=(curNB&&curNB.id)||null;
        _undoGuardUntil=Date.now()+30000;
        selected=null; clearMulti();
        try{ clearActiveTbl(); }catch(e){}
        // 쪽 하나만 다시 그린다 — renderPageEls 가 .drawing 층도 같이 챙긴다.
        try{ if(renderedPages.has(pt.pi)){ renderPageEls(pt.pi); renderTblDivs(pt.pi); } }catch(e){}
        saveDoc();
        try{ queueOps(); }catch(e){}        // 되돌린 내용이 다른 기기에도 반영
        return {back:back,changed:true,patch:true};
    }
    // 사다리에서 '지금과 다른' 지점이 나올 때까지 내려간다.
    //   같이 편집하던 중 남이 내 변경을 이미 덮었거나, 아무 변화가 없던 제스처가
    //   섞여 있으면 예전에는 Ctrl+Z 가 헛돌았다("눌러도 아무 일도 안 일어난다").
    function _histStep(from,to,label){
        if(!doc){ toast('열린 노트가 없습니다',900); return; }
        let tries=0;
        while(from.length&&tries<60){
            tries++;
            const entry=from.pop();
            const r=_histApply(entry,label);
            if(!r) continue;                                   // 되돌릴 수 없는 칸
            if(!r.changed) continue;                           // 실질 변화 없음 → 한 칸 더
            const back=r.patch?_histEntry(null,r.back):_histEntry(r.back);
            back.remote=entry.remote; back.remotePages=entry.remotePages;
            to.push(back);
            if(to.length>histMax()) to.shift();
            toast(penActive?(label==='되돌림'?'그리기 되돌림':'그리기 다시 실행'):label,900);
            return;
        }
        toast(label==='되돌림'?'되돌릴 작업이 없습니다':'다시 실행할 작업이 없습니다',900);
    }
    function undo(){ _histStep(history,redoStack,'되돌림'); }
    function redo(){ _histStep(redoStack,history,'다시 실행'); }
    // 20.3 · Ctrl+Z 를 앱 히스토리로 처리할지 판단한다.
    //   글상자에 커서를 두고 **글자를 치는 중**일 때만 브라우저 기본 undo 에
    //   양보한다. 그 밖에는(문서 편집·해돌이 편집·번역·서식·표·그림…) 앱이 받는다.
    //   예전에는 '편집 상자에 포커스가 있다'는 이유만으로 무조건 양보해서,
    //   해돌이가 고친 내용이나 스크립트로 바꾼 서식이 되돌아가지 않았다.
    function _useAppUndo(){
        try{
            const editing=document.querySelector('.tb.edit');
            const inBox=editing&&document.activeElement&&document.activeElement.classList
                &&document.activeElement.classList.contains('tb-content');
            if(!inBox) return true;
            if(_scriptEditUndoable) return true;
            // 마지막 타이핑보다 뒤에 생긴 앱 되돌리기 지점이 있으면 앱이 처리한다.
            if(history.length&&_histT>_lastTypeT) return true;
            return false;
        }catch(e){ return true; }
    }


/* APP-PART:07c-undo.js:END */
