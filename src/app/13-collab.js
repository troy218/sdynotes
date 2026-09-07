/* === src/app/13-collab.js ===
   실시간 동기화 · 커서 공유
   (sdynotes.js 메가 분리 · 이 파일들은 scripts/bundle-frontend.mjs 가 순서대로 이어 붙인다.
    let/const 스코프를 공유하려면 반드시 concat 되어야 한다 — 단독 <script> 로드 금지) */
/* APP-PART:13-collab.js:BEGIN */
    // ============ 여러 기기 실시간 반영 (적응형 폴링) ============
    // 예전엔 20초 고정이라 다른 기기의 변경이 한참 뒤에 보였다.
    // 지금은 '방금 뭔가 오갔으면 빠르게(1.2초), 조용하면 천천히(15초)'.
    // 화면이 가려져 있으면 아예 쉰다 → 배터리·버벅임 없음.
    let liveSyncTimer=null, _syncGap=1200, _syncBusy=false, _syncQuiet=0;
    const SYNC_FAST=1200, SYNC_SLOW=15000;
    function stopLiveDocSync(){
        if(liveSyncTimer){ clearTimeout(liveSyncTimer); liveSyncTimer=null; }
    }
    function _armSync(gap){
        stopLiveDocSync();
        liveSyncTimer=setTimeout(liveDocTick, gap==null?_syncGap:gap);
    }
    // 내가 편집했을 때: 잠시 빠른 주기로 (상대 변경도 곧바로 받도록)
    function syncBoost(){
        _syncQuiet=0;
        if(_syncGap!==SYNC_FAST){ _syncGap=SYNC_FAST; _armSync(SYNC_FAST); }
    }
    async function startLiveDocSync(){
        // 14.15 · 요청을 보내는 사이에 다른 노트를 열었으면 이 결과를
        //   새 노트 doc 에 넣지 않는다.
        const d=doc, nid=(curNB&&curNB.id)||null;
        stopLiveDocSync();
        try{
            if(d&&d.__ref){
                const r=await fetch('/api/import/docfile/'
                    +encodeURIComponent(d.__ref)+'?meta=1',{cache:'no-store'});
                const m=await r.json().catch(()=>({}));
                if(doc!==d||!curNB||curNB.id!==nid) return;
                if(m&&m.ok) d.__ver=m.version;
            }else if(SB&&curMemo&&curMemo.updated_at&&doc===d){
                d.__sbVer=curMemo.updated_at;
            }
        }catch(e){}
        if(doc!==d||!curNB||curNB.id!==nid) return;
        _syncGap=SYNC_FAST; _syncQuiet=0;
        _armSync(SYNC_FAST);
    }
    let _impReloading=false;
    async function reloadImportedIfNewer(){
        // 가져온 PDF: 요소 ops 없이 슬라이스만 갱신된 번역/편집을 받는다.
        const d=doc;                    // 14.9 · 노트 전환 후 이어지는 리로드를 차단
        if(!d||!d.__ref||isTrBusy()||_impReloading) return 0;
        _impReloading=true;
        try{
            const r=await fetch('/api/import/docfile/'+encodeURIComponent(d.__ref)+'?meta=1',{cache:'no-store'});
            const m=await r.json().catch(()=>({}));
            if(!(m&&m.ok&&m.version)) return 0;
            if(doc!==d) return 0;
            const prev=d.__ver||0;
            if(!(prev && m.version>prev+0.05)){
                d.__ver=m.version;
                return 0;
            }
            let got=0;
            const n=(d.pages||[]).length;
            for(let s0=0;s0<n;s0+=LAZY_SLICE){
                if(doc!==d) return got;
                let dirty=false;
                for(let i=s0;i<Math.min(n,s0+LAZY_SLICE);i++){
                    if(d.pages[i]&&d.pages[i].__dirty){ dirty=true; break; }
                }
                if(dirty) continue;
                for(let i=s0;i<Math.min(n,s0+LAZY_SLICE);i++){
                    if(d.pages[i]&&d.pages[i].__lazy==null)
                        d.pages[i]={id:'lazy_'+i,els:[],tables:[],__lazy:1};
                }
                await loadBatch(s0);
                if(doc!==d) return got;
                for(let i=s0;i<Math.min(n,s0+LAZY_SLICE);i++){
                    if(renderedPages.has(i)) renderPageEls(i);
                }
                got++;
            }
            d.__ver=m.version;
            return got;
        }catch(e){ return 0; }
        finally{ _impReloading=false; }
    }
    async function liveDocTick(){
        if(!doc||!curNB){ _armSync(SYNC_SLOW); return; }
        // 안 보이는 탭에서는 쉬고, 편집·번역 중에는 건드리지 않는다
        if(document.hidden||document.querySelector('#pagesStage .tb.edit')||isTrBusy()){
            _armSync(SYNC_FAST); return;
        }
        if(_syncBusy){ _armSync(); return; }
        _syncBusy=true;
        let got=0;
        try{ const ops=await pullSync(false); got=(ops&&ops.length)||0; }
        catch(e){}
        try{ got+=await reloadImportedIfNewer(); }
        catch(e){}
        finally{ _syncBusy=false; }
        // 변화가 있으면 계속 빠르게, 조용한 시간이 이어지면 서서히 늦춘다
        if(got){ _syncQuiet=0; _syncGap=SYNC_FAST; }
        else if(++_syncQuiet>=6) _syncGap=Math.min(SYNC_SLOW, _syncGap*1.6);
        _armSync();
    }
    // 다른 탭/창으로 갔다 오면 즉시 한 번 맞춘다
    document.addEventListener('visibilitychange',()=>{
        if(!document.hidden&&curNB&&doc){ _syncGap=SYNC_FAST; _armSync(120); }
    });

    // ===== 요소 단위 실시간 동기화 (구글독스식 LWW, 전체 덮어쓰기 없음) =====
    const SYNC_DEV=(()=>{ try{ let v=localStorage.getItem('sdy_dev');
        if(!v){ v='d_'+Math.random().toString(36).slice(2,10);
            localStorage.setItem('sdy_dev',v); } return v; }catch(e){ return 'd_x'; } })();
    function syncState(){
        doc.__localRev=doc.__localRev||new Map();
        doc.__lastHash=doc.__lastHash||new Map();
        doc.__base=doc.__base||new Map();      // 14.9 · 요소별 '공통 조상 html' (협업 병합용)
        doc.__baseRev=doc.__baseRev||new Map();// 14.9 · 공통 조상의 서버 rev (prevRev 전송용)
        return doc;
    }
    // 14.13 · 노트 요소 rev 시계 — 단조 증가 + pull 뒤 Lamport 캐치업.
    //   예전엔 Date.now() 원값을 써서, 시계가 몇 초 느린 기기(LTE 폰·PC 오차)의
    //   편집 rev 가 서버에 이미 있는 rev 보다 계속 작아졌다. 그러면 서버 LWW 가
    //   그 기기의 모든 이후 편집을 버려 "처음 몇 번만 동기화되고 이후엔 아예 안
    //   되고, 써 놓은 게 지워져 보이는" 증상이 생긴다. (설정 동기화는 14.9 에서
    //   이미 같은 문제를 이 방식으로 고쳤다 — 노트 편집기에만 빠져 있었다.)
    let _nbRev=Date.now();
    function _nbNow(){ _nbRev=Math.max(_nbRev+1, Date.now()+Math.random()); return _nbRev; }
    // ══════════════════════════════════════════════════════════════
    //  14.9 · 같은 텍스트상자 협업 편집 (구글독스식 3-way 병합)
    //   예전엔 상자 단위 LWW라서, 두 기기가 같은 상자를 동시에 타이핑하면
    //   한쪽 내용이 통째로 사라졌다. 이제 요소별로 '공통 조상(__base)'을
    //   기억하고, 원격 편집이 오면 3-way 병합(base·내것·상대것)으로
    //   양쪽 편집을 모두 남긴다. 충돌(같은 위치)은 결정적·대칭 규칙으로
    //   이어 붙여 양 기기가 같은 결과로 수렴한다.
    // ══════════════════════════════════════════════════════════════
    // HTML 을 '태그는 1단위, 글자는 1단위'로 쪼갠다 (태그를 반으로 자르지 않기 위함)
    function _sdyUnits(html){
        const units=[]; let buf='';
        for(let i=0;i<html.length;i++){
            const ch=html[i];
            if(ch==='<'){
                const end=html.indexOf('>',i);
                if(end>=0){ if(buf){ for(const c of buf) units.push(c); buf=''; } units.push(html.slice(i,end+1)); i=end; }
                else buf+=ch;
            }else buf+=ch;
        }
        if(buf) for(const c of buf) units.push(c);
        return units;
    }
    // base → v 의 편집 연산(들). 각 연산: {pos, del, ins[]} (base 기준, 겹치지 않음)
    function _sdyDiff(base,v){
        // 공통 접두/접미를 먼저 잘라 DP 범위를 줄인다 (덧붙임·끝삭제가 O(n)이 된다)
        const n=base.length, m=v.length;
        let p=0;
        while(p<n&&p<m&&base[p]===v[p]) p++;
        let s=0;
        while(s<n-p&&s<m-p&&base[n-1-s]===v[m-1-s]) s++;
        const bm=base.slice(p,n-s), vm=v.slice(p,m-s);
        const n2=bm.length, m2=vm.length;
        const dp=Array.from({length:n2+1},()=>new Int32Array(m2+1));
        for(let i=n2-1;i>=0;i--)
            for(let j=m2-1;j>=0;j--)
                dp[i][j]= bm[i]===vm[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j],dp[i][j+1]);
        const ops=[]; let i=0, j=0;
        while(i<n2&&j<m2){
            if(bm[i]===vm[j]){ i++; j++; continue; }
            const st=i, tj=j;
            while(i<n2&&j<m2&&bm[i]!==vm[j]){
                if(dp[i+1][j]>=dp[i][j+1]) i++; else j++;
            }
            ops.push({pos:p+st, del:i-st, ins:vm.slice(tj,j)});
        }
        if(i<n2) ops.push({pos:p+i, del:n2-i, ins:[]});
        else if(j<m2) ops.push({pos:p+i, del:0, ins:vm.slice(j)});
        // 인접한 '삭제'와 '삽입'을 하나의 '교체' hunk 로 합친다.
        // (안 합치면 같은 변경이 두 기기에서 중복 반영될 수 있다)
        const norm=[];
        for(const o of ops){
            if(!o.del&&!o.ins.length) continue;
            if(norm.length){
                const last=norm[norm.length-1];
                if(last.del>0&&last.ins.length===0&&o.del===0&&o.pos===last.pos+last.del){
                    last.ins=o.ins.slice(); continue;      // 삭제→삽입 = 교체
                }
                if(last.del===0&&o.del>0&&o.pos===last.pos){
                    last.del=o.del; continue;              // 삽입→삭제 = 교체
                }
            }
            norm.push({pos:o.pos, del:o.del, ins:o.ins.slice()});
        }
        return norm;
    }
    // 충돌 해소: 두 조각을 사전순으로 이어 붙인다. 병합 호출부가 (mine,theirs)를
    // 내용 기준으로 정렬해 부르므로 양 기기가 항상 같은 결과로 수렴한다.
    function _sdyResolve(a,b){
        const A=a.join(''),B=b.join('');
        return A<=B ? a.concat(b) : b.concat(a);
    }
    // hunk 들을 base[start..end) 구간에 적용해 그 구간의 '한쪽 버전 내용'을 만든다
    function _sdyApplyHunks(base,start,end,hunks,fromIdx){
        const out=[]; let p=start, k=fromIdx;
        while(k<hunks.length && hunks[k].pos<end){
            const h=hunks[k++];
            const delStart=Math.max(start,h.pos);
            const delEnd=Math.min(end, h.pos+h.del);
            out.push(...base.slice(p,delStart));
            out.push(...h.ins);
            p=delEnd;
        }
        out.push(...base.slice(p,end));
        return out;
    }
    // 3-way 병합: 두 diff(hunk 목록)를 base 위에서 합친다. 겹치는 구간만 충돌.
    function _sdyMerge3(o,a,b){
        const ha=_sdyDiff(o,a), hb=_sdyDiff(o,b);
        const res=[]; let pos=0, i=0, j=0;
        while(i<ha.length||j<hb.length){
            const A=i<ha.length?ha[i]:null;
            const B=j<hb.length?hb[j]:null;
            if(A&&(!B||A.pos+A.del<=B.pos)){
                res.push(...o.slice(pos,A.pos)); res.push(...A.ins);
                pos=A.pos+A.del; i++; continue;
            }
            if(B&&(!A||B.pos+B.del<=A.pos)){
                res.push(...o.slice(pos,B.pos)); res.push(...B.ins);
                pos=B.pos+B.del; j++; continue;
            }
            // 겹침 → 충돌 구간 [start,end) 확정 (연쇄 겹침까지 확장)
            const start=Math.min(A.pos,B.pos);
            let end=Math.max(A.pos+A.del,B.pos+B.del);
            const i0=i, j0=j;
            for(;;){
                let ext=false;
                while(i<ha.length&&ha[i].pos<end){ end=Math.max(end,ha[i].pos+ha[i].del); i++; ext=true; }
                while(j<hb.length&&hb[j].pos<end){ end=Math.max(end,hb[j].pos+hb[j].del); j++; ext=true; }
                if(!ext) break;
            }
            const ca=_sdyApplyHunks(o,start,end,ha,i0);
            const cb=_sdyApplyHunks(o,start,end,hb,j0);
            res.push(...o.slice(pos,start));
            res.push(...(ca.join('')===cb.join('') ? ca : _sdyResolve(ca,cb)));
            pos=end;
        }
        res.push(...o.slice(pos));
        return res;
    }
    function mergeText3(baseHtml,mineHtml,theirsHtml){
        const o=_sdyUnits(baseHtml||''), a=_sdyUnits(mineHtml||''), b=_sdyUnits(theirsHtml||'');
        return _sdyMerge3(o,a,b).join('');
    }
    function _elById(id){
        const loc=findElLoc(id); if(!loc) return null;
        return doc.pages[loc.i].els[loc.k];
    }
    // 내가 이 상자를 마지막 확정 상태 이후로 바꿨는가
    function _tbHasLocal(id){
        if(!doc||!doc.__base||!doc.__base.has(id)) return false;
        const el=_elById(id); if(!el) return false;
        return (el.html||'')!==doc.__base.get(id);
    }
    // ── 캐럿(커서) 유틸: textContent 기준 오프셋 ──
    function _tbCaretTextOffset(c){
        try{
            const sel=window.getSelection();
            if(sel&&sel.anchorNode&&c.contains(sel.anchorNode)){
                const walker=document.createTreeWalker(c,NodeFilter.SHOW_TEXT,null);
                let acc=0,n;
                while((n=walker.nextNode())){
                    if(n===sel.anchorNode) return acc+sel.anchorOffset;
                    acc+=n.nodeValue.length;
                }
            }
        }catch(e){}
        return (c.textContent||'').length;
    }
    function _tbSetCaretTextOffset(c,off){
        try{
            const walker=document.createTreeWalker(c,NodeFilter.SHOW_TEXT,null);
            let acc=0,n;
            while((n=walker.nextNode())){
                const len=n.nodeValue.length;
                if(acc+len>=off){
                    const r=document.createRange();
                    r.setStart(n,Math.max(0,off-acc)); r.collapse(true);
                    const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
                    return;
                }
                acc+=len;
            }
        }catch(e){}
        try{
            const r=document.createRange();
            if(c.childNodes.length) r.setStartAfter(c.lastChild); else r.setStart(c,0);
            r.collapse(true);
            const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        }catch(e){}
    }
    // 지금 편집 중인 글상자 (문서에 최대 하나)
    //
    // ★ 14.30.1 성능 — 동기화가 원격 op 를 처리할 때마다
    //   `document.querySelector('#pagesStage .tb.edit[data-id=…]')` 로 종이
    //   subtree 전체를 훑었다. 논문처럼 단어 span 이 수천 개인 문서에서는 op
    //   하나당 수만 노드를 대조하는 셈이라, 남의 편집이 들어오거나 자기 op
    //   에코가 돌아오는 동안 스크롤이 끊겼다.
    //   편집 상자는 어차피 **한 개뿐**이므로 그 참조를 기억해 두고, class 가
    //   바뀔 때만(아래 MutationObserver) 다시 찾는다. 결과는 같고 비용은 O(1).
    let _editBoxEl=null,_editScanDirty=true,_editObsOn=false;
    function _activeEditBox(){
        if(_editObsOn&&!_editScanDirty){
            const w=_editBoxEl;
            if(!w) return null;
            if(w.isConnected&&w.classList.contains('edit')) return w;
        }
        _editScanDirty=false;
        _editBoxEl=document.querySelector('#pagesStage .tb.edit')||null;
        return _editBoxEl;
    }
    function _activeEditBoxFor(id){
        const w=_activeEditBox();
        return (w&&w.dataset&&w.dataset.id===String(id))?w:null;
    }
    try{ window._sdyActiveEditBox=_activeEditBox; }catch(e){}
    // 편집 중인 상자 DOM 에 새 html 을 넣되, 내 커서를 최대한 보존한다
    function _tbApplyToActiveBox(id,newHtml){
        const box=_activeEditBoxFor(id);
        if(!box) return false;
        const c=box.querySelector('.tb-content'); if(!c) return false;
        const off=_tbCaretTextOffset(c);
        const mineText=c.textContent||'';
        c.innerHTML=newHtml;
        const newText=c.textContent||'';
        let no=off;
        if(mineText!==newText){
            for(const e of _sdyDiff(Array.from(mineText),Array.from(newText))){
                if(e.pos<off) no+= e.ins.length - e.del;
            }
            if(no<0) no=0; if(no>newText.length) no=newText.length;
        }
        _tbSetCaretTextOffset(c,no);
        const em=!newText.trim();
        if(em) c.setAttribute('data-empty','true'); else c.removeAttribute('data-empty');
        box.classList.toggle('empty',em);
        return true;
    }
    // 원격 텍스트 op 를 내 로컬 편집과 3-way 병합한다. 변경 있으면 true.
    function _tbMergeRemote(op){
        const id=op.data.id, el=_elById(id); if(!el) return false;
        const theirs=op.data.html||'';
        const mine=el.html||'';
        const hasBase=doc.__base&&doc.__base.has(id);
        const base=hasBase?doc.__base.get(id):undefined;
        let merged;
        if(base===undefined || mine===base){
            merged=theirs;   // 로컬 변경 없음 → 원격 그대로 수용
        }else{
            const big=Math.max(base.length,mine.length,theirs.length);
            if(big>20000){ merged=theirs; }                     // 초대형 상자는 LWW 폴백
            else{                                               // (mine,theirs)를 내용 기준 정렬해
                const lo=mine<=theirs?mine:theirs;              //  부르면 양 기기가 같은 입력으로
                const hi=mine<=theirs?theirs:mine;              //  같은 병합 결과를 얻어 수렴한다.
                merged=mergeText3(base,lo,hi);
            }
        }
        // 원격 서식/스타일은 반영하되, 편집 중인 기하(x,y,w,h)는 내 것을 유지
        ['fontSize','font','align','color','bg','ls','wsp','lg','tight','tbl','locked','fit','fitDown'].forEach(k=>{
            if(op.data[k]!==undefined) el[k]=op.data[k];
        });
        const isActive=_activeEditBoxFor(id)!==null;
        if(merged!==mine){
            el.html=merged;
            if(isActive) _tbApplyToActiveBox(id,merged);
            doc.__lastHash.delete(id);          // 병합본을 다시 push 하도록
            doc.__base.set(id,theirs);          // rebase: 내 편집은 이제 상대것 위에
            if(doc.__baseRev) doc.__baseRev.set(id, op.rev||0);
            return true;
        }
        doc.__base.set(id,theirs);
        if(doc.__baseRev) doc.__baseRev.set(id, op.rev||0);
        // 18.9 · '이미 보낸 것' 표시(__lastHash)는 서버가 가진 내용(theirs)이
        //   내 내용과 정말 같을 때만 한다. 예전에는 병합 결과가 내 것과 같다는
        //   이유만으로(=서버에는 아직 옛 내용) 해시를 갱신해 버려서, 내 마지막
        //   편집이 영영 push 되지 않았다. 그러면 노트를 닫았다 다시 열 때
        //   옛 ops 가 그대로 적용돼 **방금 적은 글이 사라진 것처럼** 보였다.
        if(hasBase && theirs===mine) doc.__lastHash.set(id,JSON.stringify(el));
        else doc.__lastHash.delete(id);      // 아직 안 보낸 편집 → 다음 genOps 가 반드시 보낸다
        return false;
    }
    async function initSync(){
        if(!doc||!curNB) return;
        // 14.14 · 노트 전환 중 이전 노트의 initSync 가 이어지면 새 노트 맵을
        //   비우거나 엉뚱한 ops 를 푸시할 수 있다. 시작 시점 신원을 고정.
        const _d0=doc, _nb0=curNB.id;
        syncState();
        // v3 · 옛 저장물에 data: 원본(pending 레거시)이 남아 있으면 열 때 1회,
        //   같은 확실한 경로(uploadImageStrict)로 서버(/api/img)에 올려 복구한다.
        try{ repairLegacyImages(); }catch(e){}
        // 18.4 · pull 전(메모·로컬이 아는) 이미지의 진짜 URL 을 기억한다.
        //   ops 스토어에 업로드 전(pending·빈 url) 상태가 남아 있어도
        //   이 URL 로 되돌려 "사진이 있었다는 표시"가 남지 않게 한다.
        const imgUrls=new Map();
        (doc.pages||[]).forEach(pg=>(pg.els||[]).forEach(el=>{
            if(el&&el.type==='image'&&_imgRealURL(el)) imgUrls.set(el.id,el.url);
        }));
        doc.__localRev.clear(); doc.__lastHash.clear();
        doc.__base.clear(); doc.__baseRev.clear();
        doc.__pagesRev=0; doc.__since=0;
        const pulled=await pullSync(false);
        if(doc!==_d0||!curNB||curNB.id!==_nb0) return;
        // 18.4 · pull 이 이미지를 업로드 전 상태로 되돌렸어도 복원한다.
        const healed=[];
        (doc.pages||[]).forEach((pg,pi)=>(pg.els||[]).forEach(el=>{
            if(el&&el.type==='image'&&!_imgRealURL(el)&&imgUrls.has(el.id)){
                el.url=imgUrls.get(el.id);
                delete el.pending; delete el.failed; delete el.localURL;
                healed.push({el,pi});
            }
        }));
        if(healed.length){
            const hOps=healed.map(({el,pi})=>({id:el.id,kind:'put',page:pi,rev:_nbNow(),data:serverImageElement(el),dev:SYNC_DEV}));
            healed.forEach((h,i)=>{
                doc.__lastHash.set(h.el.id,JSON.stringify(h.el));
                doc.__localRev.set(h.el.id,hOps[i].rev);
            });
            if(!doc.__ref){ try{ pushOpsFor(_nb0,hOps); }catch(e){} }
            try{
                healed.forEach(h=>{ if(renderedPages.has(h.pi)) renderPageEls(h.pi); });
            }catch(e){}
        }
        // 원격에서 받은 요소는 해시 등록(재푸시 방지),
        // 서버에 없던 로컬 요소는 초기 상태로 푸시(양방향 기반 공유)
        const remoteIds=new Set((pulled||[]).map(o=>o.id));
        const ops=[];
        const skipPush=!!doc.__ref; // 가져온 PDF: 슬라이스가 원본. 열자마자 원문을 푸시하면 번역이 덮인다.
        (doc.pages||[]).forEach((pg,pi)=>{(pg.els||[]).forEach(el=>{
            doc.__lastHash.set(el.id,JSON.stringify(el));
            doc.__base.set(el.id, el.html||'');   // 14.9 · 초기 공통 조상 = 현재 내용
            doc.__baseRev.set(el.id, doc.__localRev.get(el.id)||0);
            if(skipPush) return;
            if(!remoteIds.has(el.id)){
                const data=serverImageElement(el);
                if(!data) return;   // 업로드 전 이미지는 공유하지 않는다
                const rev=_nbNow();
                doc.__localRev.set(el.id,rev);
                ops.push({id:el.id,kind:'put',page:pi,rev,data,dev:SYNC_DEV});
            }
        });});
        doc.__lastPages=(doc.pages||[]).map(p=>p.id).join(',');
        if(doc!==_d0||!curNB||curNB.id!==_nb0) return;
        if(ops.length) await pushOps(ops);
        // pull 로 본문이 채워졌을 수 있으니 다시 한 번 강제 페인트
        if(doc===_d0) try{ ensureVisiblePagesRendered(); }catch(e){}
        // v3 · pull 로 받은 이미지가 아직 서버 주소가 없는 레거시(data: 원본)면
        //   지금 서버(/api/img)로 재업로드해 url 을 확정한다.
        if(doc===_d0) try{ repairLegacyImages(); }catch(e){}
    }
    async function startSlicePrefill(){
        // 22.x · 똥컴 모드에서는 전체 프리필을 아예 하지 않는다. 어차피 스크롤로
        //   보이는 슬라이스는 renderPageEls → ensureLazyPage 에서 그때 받고,
        //   프리필을 생략하면 ① 첫 페인트가 네트워크/파싱과 경쟁하지 않고
        //   ② 먼 쪽을 미리 다 받아 메모리·저장 스캔·동기화를 무겁게 만들지도
        //   않는다. (번역·내보내기처럼 전 쪽이 필요한 기능은 loadAllLazyNoEvict
        //   경로가 그때 그대로 모두 받는다.)
        if(sdyTurbo()) return;
        // 14.30.0 · 대화형 로드를 굶기지 않게 프리필을 '조용한 틈'마다 하나씩만
        //   내려받는다. 예전엔 열자마자 4개 워커가 남은 슬라이스를 줄줄이 요청해,
        //   단일 스레드 워커(또는 변환/태깅으로 바쁜 서버)에서는 그 프리필 큐가
        //   사용자가 스크롤로 부르는 슬라이스까지 밀어내 '불러오는 중'이 길어졌다.
        //   이제 ① idle(또는 300ms 틈)마다 1배치씩, ② 그 사이 사용자 로드가
        //   먼저 처리된다. 끝나면 먼 쪽은 내려놓아(evictFar) 문서 전체가 메모리에
        //   남아 모든 저장·동기화 패스가 느려지는 것도 막는다.
        const d=doc;                    // 14.9 · 노트 전환 후 이어지는 프리필을 차단
        if(!d||!d.__ref) return;
        try{
            const mr=await fetch('/api/import/docfile/'+encodeURIComponent(d.__ref)
                +'?meta=1',{cache:'no-store'});
            const m=await mr.json().catch(()=>({}));
            const total=m.total||0; if(!total) return;
            if(doc!==d) return;
            const loaded=new Set();
            (d.pages||[]).forEach((p,i)=>{
                if(p.__lazy==null) loaded.add(Math.floor(i/LAZY_SLICE)*LAZY_SLICE); });
            const q=[]; for(let s=0;s<total;s+=LAZY_SLICE) if(!loaded.has(s)) q.push(s);
            let k=0, inFlight=null;
            const pause=()=>new Promise(r=>{
                // ① 화면이 보일 때: 입력·스크롤 이벤트가 먼저 처리되게 최소
                //   90ms 간격으로 양보. (예전처럼 한꺼번에 4개씩 쏘면 단일
                //   스레드 워커의 큐를 사용자 로드가 기다리게 된다.)
                // ② 탭이 숨겨져 있으면 UI 를 방해할 일이 없으므로 곧바로 간다.
                let done=false;
                const go=()=>{ if(done) return; done=true; r(); };
                if(document&&document.hidden){ go(); return; }
                try{ if(window.requestIdleCallback) requestIdleCallback(go,{timeout:sdyLowEnd()?700:260}); }
                catch(e){}
                setTimeout(go,sdyLowEnd()?400:90);
            });
            while(k<q.length){
                if(doc!==d) return;     // 14.9 · 그 사이 다른 노트를 열었으면 중단
                await pause();          // 입력·스크롤 이벤트가 먼저 처리되게 양보
                if(doc!==d) return;
                const s=q[k++];
                inFlight=s;
                try{
                    // 같은 슬라이스를 지금 화면이 필요로 하면 fetchSlice 로
                    // 이미 받아졌을 수 있다 → 다시 안 받는다.
                    let need=false;
                    for(let j=0;j<LAZY_SLICE;j++){
                        const i=s+j;
                        if(i<(d.pages||[]).length&&d.pages[i]&&d.pages[i].__lazy!=null
                           &&!d.pages[i].__dirty){ need=true; break; }
                    }
                    if(need){
                        const dd=await fetchSlice(9000,d.__ref,s,(d.pages||[]).length);
                        if(doc!==d) return;
                        if(dd&&Array.isArray(dd.pages)){
                            dd.pages.forEach((p,j)=>{
                                const i=s+j;
                                if(i<(d.pages||[]).length&&d.pages[i].__lazy!=null&&!d.pages[i].__dirty){
                                    d.pages[i]=p;
                                    if(doc===d&&renderedPages.has(i)) renderPageEls(i);
                                }
                            });
                            _importLoaded(d, curNB&&curNB.id);
                        }
                    }
                }catch(e){}
                finally{ inFlight=null; }
            }
            // 전부 받은 뒤에는 문서 전체를 메모리에 붙잡지 않는다 — 화면 주변만
            // 남기고 나머지는 lazy 로 돌려, 뒤의 저장·동기화가 전 쪽을 훑지 않게.
            if(doc===d){
                try{
                    const cur=(curPageIdx|0)||0;
                    evictFar(cur);
                    if(renderedPages.has(cur)){ /* 현재 쪽은 유지 */ }
                    else{ try{ ensureVisiblePagesRendered(); }catch(e){} }
                }catch(e){}
            }
        }catch(e){}
    }
    async function pullSync(init){
        try{
            if(!curNB||!doc) return [];
            // 14.13 · 노트 전환 경쟁 방지: pull 사이에 다른 노트를 열면 응답 ops 가
            //   새 노트의 doc 에 적용돼 '다른 문서 내용이 덮어 나오는' 사고가 난다.
            //   (push 는 14.6 에서 막았지만 pull 에는 가드가 없었다)
            const _d0=doc, _nb0=curNB.id;
            // 14.8 · since(전역 커서)로 걸러내지 않는다. rev 는 각 기기의 시계로
            //   찍히므로, 시계가 조금만 느린 기기의 편집은 '이미 지난 rev'로 오인돼
            //   영영 안 받아지던 버그가 있었다. 항상 전체를 받고, 아래 __localRev
            //   (요소별 LWW)로 이미 반영한 것/내 최신 편집만 걸러낸다.
            const r=await fetch('/api/sync/pull?nb='+encodeURIComponent(curNB.id)
                +'&since=0',{cache:'no-store'});
            const d=await r.json(); if(!r.ok||!d.ok) return [];
            if(doc!==_d0||!curNB||curNB.id!==_nb0) return [];
            // 14.13 · Lamport 시계 캐치업: 서버가 본 최대 rev 로 내 시계를 올려,
            //   시계가 느린 기기의 다음 편집도 서버 LWW 에서 이기게 한다.
            _nbRev=Math.max(_nbRev, d.version||0);
            let ops=(d.ops||[]).slice().sort((a,b)=>(a.rev||0)-(b.rev||0));
            // 14.15 · 서버 pull 은 __pages__ 를 별도 필드(pages)로 돌려준다.
            //   ops 에는 pages 가 포함되지 않으므로, 처음 열거나 늦게 pull 한
            //   기기는 추가/삭제된 페이지를 전혀 못 받았다. 여기서 상태 페이지를
            //   __pages__ op 으로 합성해 맨 앞에 붙여 같은 적용 경로를 태운다.
            {
                const rp=(d&&d.pages)||null;
                if(rp && parseFloat(rp.rev||0) > (doc.__pagesRev||0)){
                    ops=[{id:'__pages__',kind:'pages',dev:'server',
                          rev:parseFloat(rp.rev||0),
                          ids:Array.isArray(rp.ids)?rp.ids:[]}, ...ops];
                }
            }
            // 14.13 · __pages__ op(페이지 목록)을 요소 op 보다 먼저 적용한다.
            //   새 페이지가 생긴 직후의 요소 op 이 페이지 목록보다 먼저 오면
            //   upsertEl 이 index 를 '마지막 페이지'로 잘라 붙여, 한 페이지의
            //   내용이 엉뚱한 페이지/문서 위에 복사돼 보였다.
            const _pgs=ops.filter(o=>o.id==='__pages__');
            const ordered=_pgs.length?_pgs.concat(ops.filter(o=>o.id!=='__pages__')):ops;
            _stCacheReset=false;
            let changed=false; const chPages=new Set();

            // 현재 로컬 사용자가 편집 중인 텍스트 상자 ID 파악
            const activeEditEl=document.querySelector('#pagesStage .tb.edit');
            const activeEditId=activeEditEl?activeEditEl.dataset.id:null;
            const activeEditPage=activeEditEl?parseInt(activeEditEl.dataset.pageIdx,10):-1;

            for(const op of ordered){
                if(doc!==_d0) return [];   // 14.13 · 루프 안 await(loadBatch) 너머로 노트가 바뀌면 중단
                if(op.id==='__pages__'){
                    if((op.rev||0)>(doc.__pagesRev||0)){
                        applyPagesOp(op);
                        if(op.dev!==SYNC_DEV) histMarkRemotePages();   // 20.3
                        // 14.15 · 방금 받은 페이지 목록을 '_lastPages' 에 반영해
                        //   같은 목록을 곧장 재푸시(pages rev 소모)하지 않는다.
                        if(doc) doc.__lastPages=(doc.pages||[]).map(p=>p.id).join(',');
                        changed=true; chPages.add(-1);
                    }
                    continue;
                }
                const local=doc.__localRev.get(op.id)||0;
                const isText=op.data&&op.data.type==='text';
                if(isText){
                    // 14.9 · 텍스트는 서버가 3-way 병합한다. 내 rev 와 같아도
                    //  내용이 다르면(=서버가 병합한 결과) 적용하고, 같으면(echo) 건너뛴다.
                    if((op.rev||0)<local) continue;
                    if((op.rev||0)===local){
                        const el=_elById(op.data.id);
                        if(!el||(el.html||'')===(op.data.html||'')) continue;
                        // An exact echo of our sent revision is not a remote edit.
                        // Preserve any newer, not-yet-sent text or box formatting.
                        if(op.dev===SYNC_DEV&&doc.__lastHash.get(op.id)===JSON.stringify(op.data)) continue;
                        // 14.25.0 · 되돌리기 에코 가드: 같은 기기의 같은 rev 면
                        //   방금 되돌린 내 op 가 돌아온 것이므로 건너뛴다.
                        if(op.dev&&op.dev===SYNC_DEV&&Date.now()<_undoGuardUntil) continue;
                    }
                }else{
                    if((op.rev||0)<=local) continue;
                }
                // 14.8 · 삭제 대신 반영한 rev 를 기억한다. since=0 로 매번 전체를
                //  받으므로, 이미 반영한 원격 op 를 또 적용하는 낭비/깜빡임을 막는다.
                doc.__localRev.set(op.id, op.rev||0);
                const activeBox=activeEditId&&op.id===activeEditId;
                const hasLocal=isText&&_tbHasLocal(op.id);
                if(op.del){
                    // 14.9 · 내가 편집 중이거나 로컬 수정이 있는 텍스트상자의 원격
                    //  삭제는 무시하고 내 최신본을 다시 올려 상자를 되살린다.
                    if(activeBox||hasLocal){
                        doc.__lastHash.delete(op.id);
                        doc.__base.delete(op.id); doc.__baseRev.delete(op.id);
                        queueOps();
                        continue;
                    }
                    if(removeElById(op.id)){ changed=true; chPages.add(op.page||0);
                        // 20.3 · 남이 지운 요소는 내 되돌리기가 되살리지 않는다
                        if(op.dev!==SYNC_DEV) histMarkRemote(op.id);
                        doc.__lastHash.delete(op.id);
                        doc.__base.delete(op.id); doc.__baseRev.delete(op.id); }
                }else if(op.data){
                    // 18.4 · '아직 업로드 전'(pending·빈 url·blob) 이미지 op 가 도착했는데
                    //   이 기기가 이미 진짜 URL 을 알고 있으면 덮어쓰지 않는다.
                    //   (memo·로컬에는 업로드 완료 상태가 있고 ops 스토어만 옛 pending
                    //    상태로 남은 경우 — 노트가 닫힌 뒤 업로드가 끝난 타이밍)
                    if(op.data.type==='image' && !_imgRealURL(op.data)){
                        const loc=findElLoc(op.data.id);
                        const curEl=loc?doc.pages[loc.i].els[loc.k]:null;
                        const curData=curEl&&String(curEl.localURL||'').startsWith('data:image/');
                        if(curEl && (_imgRealURL(curEl) || curData)){
                            doc.__localRev.set(op.data.id, op.rev||0);
                            doc.__lastHash.set(op.data.id, JSON.stringify(curEl));
                            // 14.17 · 로컬에 data 원본이 있으면 옛 pending op 가 그 원본을
                            //   덮어쓰지 않는다. (메모 스냅샷이 원본을 보관하고, 어느 기기든
                            //   자동 재업로드로 /api/img 로 바꾼다)
                            if(_imgRealURL(curEl) && !doc.__ref){
                                try{
                                    pushOpsFor(curNB.id,[{id:curEl.id,kind:'put',page:loc.i,rev:_nbNow(),data:serverImageElement(curEl),dev:SYNC_DEV}]);
                                }catch(e){}
                            }
                            continue;
                        }
                    }
                    if(isText&&(activeBox||hasLocal)&&_elById(op.data.id)){
                        // 14.9 · 협업 병합: 내/상대 편집을 모두 남긴다
                        if(_tbMergeRemote(op)){ changed=true; chPages.add(op.page||0);
                            if(op.dev!==SYNC_DEV) histMarkRemote(op.data.id);
                            queueOps(); }
                    }else if(await upsertEl(op.data,op.page||0)){
                        changed=true; chPages.add(op.page||0);
                        // 20.3 · 남이 만들거나 고친 요소는 내 되돌리기가 건드리지 않는다
                        if(op.dev!==SYNC_DEV) histMarkRemote(op.data.id);
                        doc.__lastHash.set(op.data.id,JSON.stringify(op.data));
                        if(isText){
                            doc.__base.set(op.data.id, op.data.html||'');
                            doc.__baseRev.set(op.data.id, op.rev||0);
                        }
                    }
                }
            }
            if(doc!==_d0) return [];   // 14.13 · 마지막 await 뒤에도 노트가 같은지 확인
            doc.__since=d.version||0;
            if(changed){
                if(chPages.has(-1)){
                    renderPages();
                }else{
                    chPages.forEach(pi=>{
                        if(renderedPages.has(pi)){
                            if(activeEditEl&&activeEditPage===pi){
                                _selectiveRenderPage(pi,activeEditId);
                            }else{
                                renderPageEls(pi);
                            }
                        }
                    });
                    // 14.14 · pull 로 새 요소가 들어왔는데 해당 쪽이 아직 IO 로
                    //   안 그려져 있으면 강제 페인트 (빈 종이 유지 방지)
                    try{ ensureVisiblePagesRendered(); }catch(e){}
                }
            }
            // 요소 ops 가 비어도 가져온 문서 슬라이스(번역)가 갱신됐을 수 있다.
            if(doc.__ref && !isTrBusy()){
                try{ await reloadImportedIfNewer(); }catch(e){}
            }
            return ops;
        }catch(e){ console.warn('sync pull 실패',e); return []; }
    }

    function _selectiveRenderPage(idx, activeId){
        // 원격 변경이 준비 도중 도착하면 이전 청크와 섞거나 동기로 전부 만들지 않는다.
        if(_pageRenderJobs.has(idx)){ renderPageEls(idx); return; }
        const paper=paperAt(idx); if(!paper) return;
        const txtL=paper.querySelector('.layer-text');
        const svg=paper.querySelector('.layer-stroke');
        const fillL=paper.querySelector('.layer-fill');
        const imgL=paper.querySelector('.layer-img');
        const els=(doc.pages&&doc.pages[idx]&&doc.pages[idx].els)||[];
        els.forEach(el=>{
            if(el.id===activeId) return;
            let domEl=paper.querySelector(`[data-id="${el.id}"]`);
            if(domEl){
                if(el.type==='image'){
                    const im=domEl.querySelector('img');
                    const remote=String(el.url||'');
                    const local=String(el.localURL||'');
                    const src=(remote&&!/^blob:/i.test(remote))?remote:(local&&!/^blob:/i.test(local)?local:'');
                    if(im&&im.getAttribute('src')!==src) im.src=src;
                    domEl.classList.toggle('pending',!!el.pending&&!remote);
                    domEl.classList.toggle('failed',!!el.failed); applyBoxRotation(domEl,el);
                }else if(el.type==='stroke'){
                    const d=strokePath(el.pts,el.sharp&&!isEllipsePts(el.pts));
                    domEl.querySelectorAll('path').forEach(p=>p.setAttribute('d',d));
                    syncStrokeTransform(el,domEl,idx);
                    let fp=fillL&&fillL.querySelector(`.stroke-fill[data-for="${el.id}"]`);
                    if(el.fillColor&&!fp&&fillL){ fp=buildStrokeFillEl(el,idx); fillL.appendChild(fp); }
                    else if(!el.fillColor&&fp) fp.remove();
                    else if(fp){ fp.setAttribute('fill',_classicPaletteColor('draw',el.fillColor)); fp.setAttribute('fill-opacity',el.fillOpacity==null?0.58:el.fillOpacity); }
                }else if(el.type==='text'||el.type==='latex'){
                    domEl.style.left=el.x+'px'; domEl.style.top=el.y+'px';
                    domEl.style.width=el.w+'px'; domEl.style.height=el.h+'px'; applyBoxRotation(domEl,el);
                    const c=domEl.querySelector('.tb-content');
                    if(c&&domEl._sdyModelHtml!==el.html){
                        c.innerHTML=decodeTextMarkup(_normalizePaletteHtml(el.html||''));
                        domEl._sdyModelHtml=el.html; domEl._sdyViewHtml=c.innerHTML;
                        if(el.tight) _queueTightFit(c,el);
                    }
                }
            }else{
                if(el.type==='text'&&txtL) txtL.appendChild(buildTextEl(el,idx));
                else if(el.type==='stroke'&&svg){ if(el.fillColor&&fillL) fillL.appendChild(buildStrokeFillEl(el,idx)); svg.appendChild(buildStrokeEl(el,idx)); }
                else if(el.type==='image'&&imgL) imgL.appendChild(buildImageEl(el,idx));
                else if(el.type==='latex'&&txtL) txtL.appendChild(buildLatexEl(el,idx));
            }
        });
        const currentDomEls=paper.querySelectorAll('[data-id]');
        const validIds=new Set(els.map(e=>e.id));
        currentDomEls.forEach(d=>{
            if(d.dataset.id!==activeId&&!validIds.has(d.dataset.id)) d.remove();
        });
    }
    async function retryPage(idx){
        const d=doc;                    // 14.9 · 노트 전환 후 이어지는 재시도를 차단
        if(!d||!d.__ref) return;
        // 14.12 · renderVersion 도 함께 검증
        if(window._renderVersion !== (d&&d.__rv)) return;
        const s0=Math.floor(idx/LAZY_SLICE)*LAZY_SLICE;
        try{
            const dd=await fetchSlice(9000,d.__ref,s0,(d.pages||[]).length);
            if(doc!==d) return;
            if(window._renderVersion !== (d&&d.__rv)) return;
            if(dd&&Array.isArray(dd.pages)){
                dd.pages.forEach((p,j)=>{ const i=s0+j;
                    if(i>=(d.pages||[]).length) return;
                    const cur=d.pages[i];
                    if(cur&&(cur.__dirty||(cur.__lazy==null&&(cur.els||[]).length))) return;
                    d.pages[i]=p; });
                _importLoaded(d, curNB&&curNB.id);
            }
        }catch(e){}
        // renderPageEls 에서도 검증하므로 여기서는 doc===d 만 확인
        if(doc===d) renderPageEls(idx);
    }
    function rehashAll(){
        doc.__lastHash.clear();
        (doc.pages||[]).forEach(pg=>(pg.els||[]).forEach(el=>{
            doc.__lastHash.set(el.id,JSON.stringify(el)); }));
        doc.__lastPages=(doc.pages||[]).map(p=>p.id).join(',');
    }
    // ★ 14.30.1 성능 — 요소 id 로 위치를 찾는 이 함수는 동기화 경로의 핵심이라
    //   원격 op 하나마다 여러 번 불린다(_elById · _tbHasLocal · upsertEl …).
    //   예전 구현은 그때마다 **문서 전체**(쪽 × 요소)를 훑었다. 논문 한 편이
    //   500쪽 × 수백 요소면 조회 한 번이 수십만 번 비교라, 배경 동기화가 도는
    //   동안 스크롤이 통째로 끊겼다(프로파일 2위).
    //
    //   이제 id → {i,k} 를 캐시하되, **돌려주기 전에 그 자리에 정말 그 요소가
    //   있는지 확인**한다. 어긋나면(요소가 옮겨졌거나 지워졌으면) 예전처럼
    //   전체를 훑어 다시 캐시한다. 캐시를 따로 무효화할 필요가 없으므로
    //   요소를 옮기고 지우는 수많은 경로를 건드리지 않아도 결과가 항상 정확하다.
    let _elLocCache=new Map(), _elLocDoc=null;
    function findElLoc(id){
        const pages=(doc&&doc.pages)||[];
        if(_elLocDoc!==doc){ _elLocCache=new Map(); _elLocDoc=doc; }
        const hit=_elLocCache.get(id);
        if(hit){
            const pg=pages[hit.i], els=pg&&pg.els;
            const e=els&&els[hit.k];
            if(e&&e.id===id) return hit;         // 캐시 적중 (검증 완료)
            _elLocCache.delete(id);
        }
        for(let i=0;i<pages.length;i++){
            const els=pages[i].els||[];
            for(let k=0;k<els.length;k++){
                if(els[k]&&els[k].id===id){
                    const loc={i,k};
                    _elLocCache.set(id,loc);
                    return loc;
                }
            }
        }
        return null;
    }
    function removeElById(id){
        const loc=findElLoc(id); if(!loc) return false;
        doc.pages[loc.i].els.splice(loc.k,1); return true;
    }
    async function upsertEl(data,page){
        let pi=Math.min(page,(doc.pages||[]).length-1);
        if(pi<0) return false;
        if(doc.pages[pi]&&doc.pages[pi].__lazy!=null) await loadBatch(pi);
        const loc=findElLoc(data.id);
        if(loc){
            if(loc.i!==pi){
                doc.pages[loc.i].els.splice(loc.k,1);
                (doc.pages[pi].els=doc.pages[pi].els||[]).push(data);
            }else{
                doc.pages[loc.i].els[loc.k]=data;
            }
        }else{
            (doc.pages[pi].els=doc.pages[pi].els||[]).push(data);
        }
        return true;
    }
    function applyPagesOp(op){
        doc.__pagesRev=op.rev||0;
        const ids=op.ids||[];
        const oldPages=(doc.pages||[]).slice();
        const byId={}; oldPages.forEach(p=>{ if(p&&p.id) byId[p.id]=p; });
        // 14.14 · 페이지 id 가 기기마다 다르게 찍힌 경우(옛 버그·복제·충돌),
        //   id 로 못 찾으면 같은 자리(index)에 있던 본문을 살려 빈 페이지로
        //   교체하지 않는다. 예전엔 byId 미스 → {id,els:[]} 로 바꿔
        //   메모 채널에 있던 글·그림이 실시간 pull 한 번에 통째로 사라졌다.
        doc.pages=ids.map((id,i)=>{
            if(byId[id]) return byId[id];
            const old=oldPages[i];
            const hasBody=old&&(
                ((old.els||[]).length)>0||
                ((old.tables||[]).length)>0||
                ((old.notes||[]).length)>0||
                old.__lazy!=null
            );
            if(hasBody){
                // 서버 순서의 id 로만 맞추고 본문·lazy 마커는 유지
                if(old.id!==id) old.id=id;
                return old;
            }
            return {id,els:[],tables:[]};
        });
    }
    function genOps(){
        syncState();
        const ops=[];
        const seen=new Set();
        (doc.pages||[]).forEach((pg,pi)=>{
            (pg.els||[]).forEach(el=>{
                seen.add(el.id);
                const data=serverImageElement(el);
                if(!data) return;   // 업로드 전 이미지(공유 소스 없음)는 op 로 내보내지 않는다
                const h=JSON.stringify(el);
                if(doc.__lastHash.get(el.id)!==h){
                    doc.__lastHash.set(el.id,h);
                    const rev=_nbNow();
                    doc.__localRev.set(el.id,rev);
                    // Each revision owns its payload. A live element reference can
                    // change while fetch is pending: its ACK would then establish
                    // an UNSENT edit as __base, and the echo would erase that edit.
                    const payload=JSON.parse(data===el?h:JSON.stringify(data));
                    ops.push({id:el.id,kind:'put',page:pi,rev,data:payload,dev:SYNC_DEV,
                              prevRev:(doc.__baseRev&&doc.__baseRev.get(el.id))||0});
                }
            });
        });
        doc.__lastHash.forEach((h,id)=>{
            if(!seen.has(id)){
                const rev=_nbNow();
                doc.__localRev.set(id,rev);
                ops.push({id,kind:'del',rev,dev:SYNC_DEV});
                doc.__lastHash.delete(id);
            }
        });
        const ph=(doc.pages||[]).map(p=>p.id).join(',');
        if(doc.__lastPages!==ph){
            doc.__lastPages=ph;
            const rev=_nbNow();
            doc.__pagesRev=rev;
            ops.push({id:'__pages__',kind:'pages',rev,
                ids:(doc.pages||[]).map(p=>p.id),dev:SYNC_DEV});
        }
        return ops;
    }
    // 18.4 · 지금 열려 있지 않은 노트에도 요소 ops 를 직접 올린다.
    //   (이미지 업로드 완료처럼 doc/curNB 를 건드릴 수 없는 백그라운드 작업용)
    async function pushOpsFor(nbId,ops){
        const list=Array.isArray(ops)?ops.slice(0,40):[];
        if(!nbId||!list.length) return false;
        for(let attempt=0; attempt<3; attempt++){
            try{
                const r=await fetch('/api/sync/push',{method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({nb:String(nbId),ops:list})});
                const d=await r.json().catch(()=>({}));
                if(r.ok&&d.ok) return true;
            }catch(e){}
            await new Promise(res=>setTimeout(res,250*(attempt+1)));
        }
        return false;
    }
    let opsTimer=null;
    function queueOps(){
        clearTimeout(opsTimer);
        // 400ms → 180ms: 상대 화면에 더 빨리 뜬다.
        // (그래도 묶어서 보내므로 타자 칠 때마다 요청이 나가진 않는다)
        opsTimer=setTimeout(pushOps,180);
        try{ syncBoost(); }catch(e){}
    }
    async function pushOps(pre){
        if(!doc||!curNB) return;
        const d0=doc;
        const ops=pre?JSON.parse(JSON.stringify(pre)):genOps();
        if(!ops.length) return;
        // 14.6 · 노트 id 를 시작 시점에 고정한다. 전송 중 다른 노트로 넘어가면
        //  curNB.id 가 바뀌어 이 노트의 요소 ops 가 엉뚱한 노트로 저장되던 버그 방지.
        const nbId=curNB.id;
        const send=async(batch)=>{
            for(let attempt=0; attempt<3; attempt++){
                try{
                    const r=await fetch('/api/sync/push',{method:'POST',
                        headers:{'Content-Type':'application/json'},
                        body:JSON.stringify({nb:nbId,ops:batch})});
                    const d=await r.json().catch(()=>({}));
                    if(r.ok&&d.ok){
                        // 14.7 · 서버 전역 version 으로 doc.__since 를 올리지 않는다.
                        //  예전엔 여기서 since 를 서버 version(모든 요소의 최대 rev)으로
                        //  끌어올려서, 그 사이 다른 기기가 올린 rev 를 '이미 본 것'으로
                        //  오인해 실시간 동시 편집에서 상대 변경이 안 보였다.
                        // 14.9 · 수용된 텍스트 put 은 공통 조상(__base)으로 확정한다.
                        const acc=new Set(Array.isArray(d.accepted)?d.accepted:batch.map(o=>o.id));
                        if(doc!==d0||!curNB||curNB.id!==nbId) return true;
                        batch.forEach(o=>{
                            const rev=parseFloat(o.rev||0)||0;
                            if(acc.has(o.id)&&o.kind==='put'&&o.data&&o.data.type==='text'&&d0.__base
                                &&rev>=((d0.__baseRev&&d0.__baseRev.get(o.id))||0)){
                                d0.__base.set(o.id, o.data.html||'');
                                if(d0.__baseRev) d0.__baseRev.set(o.id,rev);
                            }
                        });
                        return true;
                    }
                }catch(e){}
                await new Promise(res=>setTimeout(res, 250*(attempt+1)));
            }
            return false;
        };
        const CHUNK_OPS=40;
        const failedIds=[];
        for(let i=0;i<ops.length;i+=CHUNK_OPS){
            const batch=ops.slice(i,i+CHUNK_OPS);
            if(!(await send(batch))) failedIds.push(...batch.filter(o=>o.kind==='put').map(o=>o.id));
        }
        // 14.13 · 전송 실패한 put 은 '이미 보낸 상태' 표시(__lastHash)를 걷어낸다.
        //   genOps 가 보내기 전에 해시를 갱신하므로, LTE 순단처럼 push 가 실패하면
        //   편집이 영영 재전송되지 않고 뒤늦은 pull 이 서버 쪽 옛 내용으로 화면을
        //   덮어 '써 놓은 게 지워진' 것처럼 보였다.
        if(failedIds.length){
            failedIds.forEach(id=>{ try{ d0.__lastHash.delete(id); }catch(e){} });
            if(doc===d0&&curNB&&curNB.id===nbId)
                setTimeout(()=>{ try{ if(doc===d0&&curNB&&curNB.id===nbId) pushOps(); }catch(e){} },3000);
        }
        // 14.7 · push 직후 pull 로 맞춘다. 내 ops 는 __localRev 로 건너뛰고,
        //  그 사이 온 다른 기기의 변경만 받아 적용해 동시 편집이 어긋나지 않게 한다.
        try{ if(curNB&&curNB.id===nbId) await pullSync(false); }catch(e){}
        try{ queueImportedSave(); }catch(e){}
    }

    // ============ 실시간 커서 공유 ============
    // 같은 노트를 여러 사람이 열면 서로의 마우스를 색깔 화살표로 보여준다.
    const LIVE_ME=(()=>{ try{
        let v=localStorage.getItem('sdy_uid');
        if(!v){ v='u_'+Math.random().toString(36).slice(2,10); localStorage.setItem('sdy_uid',v); }
        return v;
    }catch(e){ return 'u_'+Math.random().toString(36).slice(2,10); } })();
    // 이름을 따로 정하지 않았으면 '푸른 두루미' 같은 이름을 하나 지어 준다.
    const LIVE_ADJ=['연보라','복숭아빛','민트색','하늘색','살구색','라벤더','코랄빛',
                    '레몬색','장미빛','청포도','피치','시나몬','솜사탕','아이보리',
                    '라일락','청옥','버터','멜론','구름빛','연분홍'];
    const LIVE_ANI=['까치','참새','박새','멧비둘기','직박구리','제비','백로','왜가리',
                    '뻐꾸기','물총새','두루미','기러기','청둥오리','저어새','꾀꼬리',
                    '동박새','오목눈이','수리부엉이','팔색조','호반새','파랑새','후투티',
                    '원앙','종달새'];
    function makeLiveName(){
        const a=LIVE_ADJ[Math.floor(Math.random()*LIVE_ADJ.length)];
        const b=LIVE_ANI[Math.floor(Math.random()*LIVE_ANI.length)];
        return a+' '+b;
    }
    function liveName(){
        try{
            let v=localStorage.getItem('sdy_uname_v2');
            if(!v||!v.trim()||v==='사용자'||v==='익명'){
                v=makeLiveName();
                localStorage.setItem('sdy_uname_v2',v);
            }
            return v;
        }catch(e){ return makeLiveName(); }
    }
    let liveTimer=null, liveRateTimer=null, liveLast={x:null,y:null,page:0},
        liveOn=false, liveMoved=false, _liveBusy=false, _liveQueued=false,
        _liveLastPoll=0, liveMyColor='';
    const liveInkTimers={};       // uid → 실시간 잉크 정리 타이머(펜을 뗀 뒤 잠시 유지)
    // 상대가 있을 때는 25fps로 왕복하고, 혼자일 때도 600ms마다 가볍게 확인한다.
    // 내 마우스가 멈췄다고 polling까지 4초 멈추면 움직이는 상대 커서가 내 화면에서
    // 4초씩 얼어 보였던 것이 '현재 위치가 바로 안 오는' 핵심 원인이었다.
    const LIVE_RATE_MS=40, LIVE_DISCOVER_MS=600, LIVE_HEARTBEAT_MS=4000;
    // 22.1 · '글 쓰는 중'에는 상대가 없어도 매 틱(40ms)마다 울렸다. 편집 중에는
    //   캐럿 좌표를 다시 재야 하는데(종이 레이아웃 읽기) 그 진동이 그대로 입력
    //   지연이 됐다. → 글자 크기가 섞인 문서에서도 눈에 띄지 않는 간격으로 늘린다.
    const LIVE_EDIT_MS=(typeof sdyTurbo==='function'&&sdyTurbo())?700:250;
    const LIVE_MOVE_EVENT=('PointerEvent' in window)?'pointermove':'mousemove';
    const livePeerCount={};        // 노트별 동시 접속자 수

    function startLive(){
        if(liveOn||!curNB) return;
        liveOn=true; liveMoved=true; _liveLastPoll=0;
        document.addEventListener(LIVE_MOVE_EVENT,onLiveMove,{passive:true});
        liveTimer=setInterval(livePing,LIVE_HEARTBEAT_MS);
        clearInterval(liveRateTimer);
        liveRateTimer=setInterval(liveFastTick,LIVE_RATE_MS);
        livePing();
    }
    function stopLive(){
        if(!liveOn) return;
        liveOn=false;
        document.removeEventListener(LIVE_MOVE_EVENT,onLiveMove);
        clearInterval(liveTimer); liveTimer=null;
        clearInterval(liveRateTimer); liveRateTimer=null;
        _liveBusy=false; _liveQueued=false;
        const bd=document.getElementById('liveBadge'); if(bd) bd.style.display='none';
        const nb=curNB&&curNB.id;
        if(nb) fetch('/api/live/leave',{method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({note:nb,uid:LIVE_ME}),keepalive:true}).catch(()=>{});
        document.querySelectorAll('.live-cur').forEach(n=>n.remove());
        Object.keys(liveInkTimers).forEach(k=>{ clearTimeout(liveInkTimers[k]); delete liveInkTimers[k]; });
        document.querySelectorAll('[id^="liveInk_"]').forEach(n=>n.remove());
        const lg=document.getElementById('liveLegend'); if(lg) lg.remove();
    }
    // 상대가 보이는 동안에는 내가 가만히 있어도 계속 받아야 한다. 혼자일 때만
    // 발견 주기로 낮춰 서버와 배터리 부담을 줄인다.
    function liveFastTick(){
        if(!liveOn||!curNB) return;
        const now=performance.now();
        const hasPeer=(livePeerCount[curNB.id]||1)>1;
        const act=liveAct();
        // 22.1 · 진동 간격을 '지금 내가 무엇을 하나'로 정한다.
        //   · 마우스를 움직였다 → 즉시 (커서가 뚝뚝 끊기지 않게)
        //   · 상대가 보는 중   → 평소처럼 빠르게, 단 편집 중엔 캐럿을 다시 재는
        //     비용(레이아웃 읽기)이 매 40ms 들어오니 LIVE_EDIT_MS 로 줄인다.
        //   · 아무도 없고 가만히 → 발견 주기(600ms)로만 확인.
        let need=LIVE_DISCOVER_MS;
        if(hasPeer) need=act?LIVE_EDIT_MS:LIVE_RATE_MS;
        else if(liveMoved) need=LIVE_RATE_MS;
        else if(act) need=LIVE_EDIT_MS;
        if(!liveMoved && now-_liveLastPoll<need) return;
        liveMoved=false; _liveLastPoll=now;
        livePing();
    }
    function onLiveMove(e){
        const paper=e.target.closest&&e.target.closest('#pagesStage .paper');
        if(!paper) return;
        // 고주사율 마우스/펜은 한 이벤트에 좌표가 여럿 묶인다. 가장 최신 좌표를
        // 사용해야 커서가 한 프레임 뒤를 따라오지 않는다.
        const samples=typeof e.getCoalescedEvents==='function'?e.getCoalescedEvents():null;
        const point=samples&&samples.length?samples[samples.length-1]:e;
        const pi=+paper.dataset.pageIdx||0,p=pageLocal(point,pi);
        liveLast={ x:p.x,y:p.y,page:pi };
        liveMoved=true;
    }
    // 지금 하고 있는 일을 한 마디로 (다른 사람 화면에 함께 표시)
    function liveAct(){
        try{
            // 14.30.1 · 실시간 표시는 타이머로 자주 불린다 → 전체 훑기 대신 O(1) 캐시
            if(_activeEditBox()) return '글 쓰는 중';
            if(typeof penActive!=='undefined'&&penActive) return '그리는 중';
            if(typeof eraserActive!=='undefined'&&eraserActive) return '지우는 중';
            if(typeof textToolActive!=='undefined'&&textToolActive) return '글상자 놓는 중';
            if(typeof activeTbl!=='undefined'&&activeTbl) return '표 다루는 중';
            if(typeof drag!=='undefined'&&drag) return '옮기는 중';
            if(typeof findOpen!=='undefined'&&findOpen) return '찾는 중';
            const sel=getSelection();
            // 상태 표시에 선택 문자열은 필요 없다. 원문 전체를 직렬화/레이아웃하지 않는다.
            if(sel&&sel.rangeCount&&!sel.isCollapsed) return '글 고르는 중';
            return '';
        }catch(e){ return ''; }
    }
    // 14.18.4 · 지금 하는 일의 '종류' — 상대 화면에서 내 표시 모양을 정한다.
    //   ''     : 평소(마우스 화살표)
    //   'draw' : 펜으로 그리는 중 → 상대 화면에서 내 커서가 '펜촉'으로 바뀌고
    //            지금 긋는 획(liveInk)이 실시간 미리보기로 같이 보인다.
    //   'type' : 글 입력 중 → 상대 화면에서 내 커서 대신 '깜빡이는 캐럿'이 보인다.
    function liveMode(){
        try{
            if(_activeEditBox()) return 'type';
            if(typeof penActive!=='undefined'&&penActive
                &&!(typeof eraserActive!=='undefined'&&eraserActive)) return 'draw';
            return '';
        }catch(e){ return ''; }
    }
    // 편집 중인 캐럿의 위치를 종이 좌표로 — 상대에게 '마우스'가 아니라
    // '지금 글이 쓰이는 곳'을 보내야 깜빡이 캐럿이 제자리에 보인다.
    let _caretKey='', _caretVal=null;
    function liveCaretPos(){
        try{
            const sel=getSelection();
            if(!sel||!sel.rangeCount) return null;
            const anc=sel.getRangeAt(0).commonAncestorContainer;
            const cEl=anc.nodeType===1?anc:anc.parentElement;
            const content=cEl&&cEl.closest&&cEl.closest('.tb-content');
            const box=content&&content.closest('.tb.edit');
            if(!content||!box) return null;
            // 22.1 · 선택이 하나도 안 바뀌었으면(같은 노드·같은 오프셋) 지난 값을
            //   그대로 쓴다. 예전엔 편집 중 틱마다 Range 사각형과 종이 사각형을
            //   다시 쟀고, 특히 '종이 전부 훑기'가 문제였다(종이마다 레이아웃 읽기).
            //   열쇠는 '캐럿이 실제로 움직인 사건'만 본다 — 선택 객체를 문자열로
            //   굽는 것(getSelection().toString())은 문서 전체를 훑는 일이라
            //   이 경로에서 절대 쓰지 않는다. 상자 안 입력은 input 리스너가
            //   box._caretV 를 올린다(아래 buildTextEl ), 배율은 pageScale 로 잡힌다.
            const key=(sel.anchorOffset||0)+':'+(sel.focusOffset||0)+':'+(box._caretV||0)
                      +':'+box.dataset.id+':'+pageScale;
            if(key===_caretKey&&_caretVal) return _caretVal;
            let r=null;
            try{ r=sel.getRangeAt(0).getBoundingClientRect(); }catch(e){}
            if(!r||(r.top===0&&r.bottom===0)) r=content.getBoundingClientRect();
            let out=null;
            const own=content.closest('.paper');       // 편집 상자가 올라탄 종이 한 장만 재면 된다
            const cand=own?[own]:editorPapers();
            for(let i=0;i<cand.length;i++){
                const pr=cand[i].getBoundingClientRect();
                if(r.left>=pr.left-2&&r.left<=pr.right+2&&r.bottom>=pr.top-2&&r.bottom<=pr.bottom+2){
                    const ps=paperSize();
                    out={x:(r.left-pr.left)*(ps.w/Math.max(1,pr.width)),
                         y:(r.bottom-pr.top)*(ps.h/Math.max(1,pr.height)),
                         page:+cand[i].dataset.pageIdx||0};
                    break;
                }
            }
            _caretKey=key; _caretVal=out;
            return out;
        }catch(e){ return null; }
    }
    // 그리고 있는 획의 '지금까지' 모양 — 완성을 기다리지 않고 실시간으로 보낸다.
    //   트래픽을 줄이려고 점을 단순화(RDP)하고 최대 96점으로 자른다. 최종 획은
    //   기존 요소 동기화 경로로 확실히 도착하므로 미리보기는 근삿값이어도 된다.
    function liveInkPayload(){
        try{
            if(!drawing||!penActive||eraserActive) return null;
            if(!curPts||curPts.length<2) return null;
            let pts=rdpPts(curPts,1.1);
            if(pts.length>96){
                const step=(pts.length-1)/95,out=[];
                for(let i=0;i<95;i++) out.push(pts[Math.round(i*step)]);
                out.push(pts[pts.length-1]);
                pts=out;
            }
            pts=pts.map(pt=>[round1(pt[0]),round1(pt[1])]);
            return {pts,color:drawColor,size:round1(effSize()),op:effOpacity(),page:drawPageIdx||0};
        }catch(e){ return null; }
    }
    async function livePing(){
        if(!liveOn||!curNB) return;
        // 응답이 뒤섞여 커서가 뒤로 튀지 않게 하나씩 직렬 전송한다.
        // 이동 중 연속 호출은 busy 면 다음 완료 직후 최신 좌표로 한 번 이어 보낸다.
        if(_liveBusy){ _liveQueued=true; return; }
        const noteId=curNB.id;       // await 사이 노트 전환 시 옛 응답을 새 문서에 그리지 않음
        _liveBusy=true;
        // 14.18.4 · 글 쓰는 중에는 마우스가 아니라 '캐럿 위치'를 상대에게 보낸다.
        const mode=liveMode();
        if(mode==='type'){
            const cp=liveCaretPos();
            if(cp){ liveLast=cp; liveMoved=true; }
        }
        try{
            const r=await fetch('/api/live/ping',{method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({note:noteId,uid:LIVE_ME,name:liveName(),
                    x:liveLast.x,y:liveLast.y,page:liveLast.page,on:true,
                    act:liveAct(),mode,
                    ink:mode==='draw'?liveInkPayload():null,
                    ts:Date.now()})});
            const d=await r.json().catch(()=>({}));
            if(!liveOn||!curNB||curNB.id!==noteId) return;
            if(d&&d.ok){
                if(d.color) liveMyColor=d.color;
                // 5.35: 표시 순서를 매번 완전 랜덤으로 (같은 순서 고정 방지)
                const peers=(d.peers||[]).slice();
                for(let i=peers.length-1;i>0;i--){
                    const j=(Math.random()*(i+1))|0;
                    const t=peers[i]; peers[i]=peers[j]; peers[j]=t;
                }
                drawPeers(peers);
                const n=peers.length+1;
                const bd=document.getElementById('liveBadge');
                const nm=document.getElementById('liveNum');
                if(bd&&nm){ nm.textContent=n; bd.style.display=n>1?'inline-flex':'none'; }
                livePeerCount[noteId]=n;
            }
        }catch(e){ /* 서버 없으면 조용히 무시 */ }
        finally{
            _liveBusy=false;
            if(_liveQueued && liveOn){
                _liveQueued=false;
                setTimeout(()=>{ if(liveOn) livePing(); },0);
            }
        }
    }
    // 14.18.4 · 실시간 잉크 — 상대가 그리고 있는 획을 상대의 종이 위에 임시 SVG로.
    //   펜을 뗀 뒤에는 최종 획이 요소 동기화로 도착할 시간(3.5초)을 주고 지운다.
    function _dropLiveInk(uid){
        if(liveInkTimers[uid]) return;
        liveInkTimers[uid]=setTimeout(()=>{
            delete liveInkTimers[uid];
            const el=document.getElementById('liveInk_'+uid);
            if(el) el.remove();
        },3500);
    }
    function _updateLiveInk(p){
        const uid=p.uid, ink=p.ink;
        if(!ink||!ink.pts||ink.pts.length<2){ _dropLiveInk(uid); return; }
        if(liveInkTimers[uid]){ clearTimeout(liveInkTimers[uid]); delete liveInkTimers[uid]; }
        const pageIdx=(ink.page!=null&&isFinite(+ink.page))?+ink.page:(+p.page||0);
        const paper=paperAt(pageIdx);
        if(!paper) return;
        let svg=document.getElementById('liveInk_'+uid);
        if(!svg||!svg.isConnected||svg.parentElement!==paper){
            if(svg) svg.remove();
            svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
            svg.id='liveInk_'+uid;
            const ps=paperSize();
            svg.setAttribute('viewBox','0 0 '+ps.w+' '+ps.h);
            svg.setAttribute('preserveAspectRatio','none');
            svg.style.cssText='position:absolute;inset:0;width:100%;height:100%;'+
                              'pointer-events:none;z-index:30;overflow:visible;';
            const path=document.createElementNS('http://www.w3.org/2000/svg','path');
            path.setAttribute('fill','none');
            path.setAttribute('stroke-linecap','round');
            path.setAttribute('stroke-linejoin','round');
            svg.appendChild(path);
            paper.appendChild(svg);
        }
        const path=svg.firstChild;
        try{ path.setAttribute('d',strokePath(ink.pts)); }catch(e){ return; }
        path.setAttribute('stroke',String(ink.color||'#888888').slice(0,24));
        path.setAttribute('stroke-width',Math.max(.5,Math.min(200,+ink.size||2)));
        path.setAttribute('stroke-opacity',ink.op==null?1:Math.max(.05,Math.min(1,+ink.op)));
    }
    // 14.18.4 · 왼쪽 범례 — 누가 어떤 색인지 한눈에. 커서에는 이름표 없이 색만 단다.
    function _liveEsc(v){
        return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
    function renderLiveLegend(rows){
        let lg=document.getElementById('liveLegend');
        if(!rows||!rows.length){ if(lg) lg.remove(); return; }
        if(!lg){
            lg=document.createElement('div');
            lg.id='liveLegend'; lg.className='live-legend';
            document.body.appendChild(lg);
        }
        const all=[{color:liveMyColor||'#4f6ef7',name:liveName(),act:liveAct(),me:true}].concat(rows);
        lg.innerHTML=all.map(r=>
            '<div class="ll-row'+(r.me?' me':'')+'">'+
                '<span class="ll-dot" style="background:'+_liveEsc(r.color)+'"></span>'+
                '<span class="ll-nm">'+_liveEsc(r.name)+(r.me?' (나)':'')+'</span>'+
                (r.act?'<span class="ll-act">'+_liveEsc(r.act)+'</span>':'')+
            '</div>').join('');
    }
    // 14.18.4 · 상대 커서 — 이름표 없이 색만. 그리는 중엔 펜촉, 글 쓰는 중엔 깜빡이 캐럿.
    function drawPeers(peers){
        const stage=document.getElementById('pagesStage');
        if(!stage) return;
        const seen=new Set(), rows=[];
        // 22.1 · 혼자 보는 노트에서 매 틱마다 '.live-cur' 를 찾고 범례를 다시
        //   그리던 일은 전부 헛수고였다. 보여 줄 커서도, 이미 떠 있는 커서도
        //   없는 상태라면 DOM 을 아예 건드리지 않고 나간다.
        //   (남의 커서는 전부 #liveLayer 안에 뜨므로, 레이어·범례가 둘 다
        //   없으면 지울 것도 그릴 것이 없다는 뜻이다 — class 로 문서 전체를
        //   훑는 것(.live-cur)은 오히려 이 경로에서 가장 비싼 조사였다.)
        if((!peers||!peers.length)
           &&!document.getElementById('liveLayer')&&!document.getElementById('liveLegend')) return;
        peers.forEach(p=>{
            if(p.x==null||p.y==null) return;
            seen.add(p.uid);
            const paper=paperAt(p.page||0);
            if(!paper) return;
            let layer=document.getElementById('liveLayer');
            if(!layer||!layer.isConnected){
                layer=document.createElement('div');
                layer.id='liveLayer';
                layer.style.cssText='position:fixed;left:0;top:0;width:100%;height:100%;'+
                                    'pointer-events:none;z-index:1050;';
                document.body.appendChild(layer);
            }
            let n=document.getElementById('live_'+p.uid);
            const isNew=!n;
            if(!n){
                n=document.createElement('div');
                n.id='live_'+p.uid; n.className='live-cur';
                n.innerHTML='<svg class="lc lc-arrow" viewBox="0 0 24 24" width="20" height="20">'+
                    '<path d="M4 2 L20 12 L13 13 L16 21 L13 22 L10 14 L4 18 Z" '+
                    'fill="currentColor" stroke="#475569" stroke-width="1.4"/></svg>'+
                    '<i class="lc lc-pen ri-pen-nib-fill"></i>'+
                    '<span class="lc lc-caret"></span>';
                layer.appendChild(n);
            }
            n.style.color=p.color||'#ef4444';
            n.style.zIndex=String(1+((Math.random()*40)|0));   // 5.35: 겹침 순서도 매번 랜덤
            const mode=(p.mode==='draw'||p.mode==='type')?p.mode:'';
            n.classList.toggle('draw',mode==='draw');
            n.classList.toggle('type',mode==='type');
            _updateLiveInk(p);
            rows.push({color:p.color||'#ef4444',name:p.name||'익명',act:p.act||'',me:false});
            const pr=paper.getBoundingClientRect(), ps=paperSize();
            // pageScale은 루트 90% zoom과 전환 중 배율을 모른다. 실제 종이 사각형으로
            // 문서 좌표→화면 좌표를 구한 뒤 fixed 레이어의 CSS px로 변환한다.
            const screenX=pr.left+(Number(p.x)||0)*(pr.width/Math.max(1,ps.w));
            const screenY=pr.top +(Number(p.y)||0)*(pr.height/Math.max(1,ps.h));
            const x=_clawCss(screenX), y=_clawCss(screenY);
            if(isNew) n.style.transition='none';
            n.style.setProperty('--live-x',x.toFixed(2)+'px');
            n.style.setProperty('--live-y',y.toFixed(2)+'px');
            if(isNew){
                // 첫 등장만 원점에서 날아오지 않게 즉시 놓고, 다음 프레임부터 보간.
                void n.offsetWidth;
                n.style.transition='';
            }
        });
        document.querySelectorAll('.live-cur').forEach(n=>{
            const uid=n.id.replace('live_','');
            if(!seen.has(uid)){ n.remove(); _dropLiveInk(uid); }
        });
        renderLiveLegend(rows);
    }
    addEventListener('beforeunload',()=>{ if(liveOn) stopLive(); });

    async function renderPageCanvas(pageIdx,opt){
        opt=opt||{};
        const size=paperSize();
        const page=JSON.parse(JSON.stringify(doc.pages[pageIdx]));
        await _pdfLoadExportFonts(page.els||[]);
        if(opt.onlyIds) page.els=(page.els||[]).filter(e=>opt.onlyIds.has(e.id));
        (page.els||[]).forEach(el=>{ if(el.type==='text'&&!el.pdfText) el.html=fixDarkColors(el.html); });
        for(const el of page.els||[]){
            if(el.type==='image'||el.type==='legacyDraw') el.url=await toDataURL(el.url);
        }

        const sc=Math.max(2,Math.min(3,window.devicePixelRatio||2));
        const c=document.createElement('canvas');
        c.width=Math.ceil(size.w*sc); c.height=Math.ceil(size.h*sc);
        const ctx=c.getContext('2d');
        ctx.scale(sc,sc);
        if(!opt.transparent){
            ctx.fillStyle=(doc&&doc.tint)?doc.tint:'#ffffff';
            ctx.fillRect(0,0,size.w,size.h);
            // ① 종이 배경 — 캔버스에 직접 (SVG 실패와 무관하게 항상 그려짐)
            drawPaperBg(ctx,doc.paper,size);
        }

        // ② 이미지 — 캔버스에 직접 (foreignObject 안 거침 → 훨씬 안정적)
        for(const el of page.els||[]){
            if(el.type==='image'&&el.url){
                try{
                    const im=await loadImg(el.url);
                    const a=normalizedRotation(el.rotation);
                    if(a){ ctx.save(); ctx.translate(el.x+el.w/2,el.y+el.h/2); ctx.rotate(a*Math.PI/180); ctx.drawImage(im,-el.w/2,-el.h/2,el.w,el.h); ctx.restore(); }
                    else ctx.drawImage(im,el.x,el.y,el.w,el.h);
                }catch(e){ console.warn('이미지 건너뜀',e); }
            }else if(el.type==='legacyDraw'&&el.url){
                try{
                    const im=await loadImg(el.url);
                    ctx.drawImage(im,0,0,size.w,size.h);
                }catch(e){}
            }
        }

        // ③ 펜 획 — 캔버스 경로로 직접
        (page.els||[]).forEach(st=>{
            if(st.type!=='stroke') return;
            drawStrokeOnCanvas(ctx,st);
        });

        // ④ 텍스트 — foreignObject(서식 유지). 실패하면 캔버스 텍스트로 폴백.
        const texts=(page.els||[]).filter(e=>e.type==='text'&&(e.html||'').trim());
        const formulas=(page.els||[]).filter(e=>e.type==='latex'&&(e.latex||'').trim());
        if(texts.length||formulas.length){
            let done=false;
            try{
                let body='';
                texts.forEach(el=>{
                    const inner=el.tight
                        ? `width:100%;height:100%;padding:0;box-sizing:border-box;`+
                          `font-size:${el.fontSize||16}px;line-height:1;color:${el.__c||'#111111'};`+
                          `overflow:visible;font-family:${fontCSS(el.font||'pretendard')};`+
                          `text-align:${el.align||'left'};position:relative;`
                        : `width:100%;height:100%;padding:8px 12px;box-sizing:border-box;`+
                          `font-size:${el.fontSize||16}px;line-height:1.5;color:${el.__c||'#111111'};white-space:pre-wrap;`+
                          `word-break:break-word;overflow:hidden;font-family:${fontCSS(el.font||'pretendard')};`+
                          `text-align:${el.align||'left'};`;
                    body+=`<div style="position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;">`+
                          `<div style="${inner}">`+
                          htmlToXhtml(imathExpandHtml(_pdfStaticHtml(el)))+`</div></div>`;
                });
                formulas.forEach(el=>{
                    let mh;
                    // 9.0 · 내보낼 때도 화면과 똑같은 KaTeX(HTML+MathML)로 그린다.
                    //  mathml 만 쓰면 브라우저 기본 수식 글꼴로 대체돼 폭이 달라지고
                    //  그만큼 옆 본문 위로 번져 글자가 겹쳐 보였다.
                    try{ mh=window.katex?katex.renderToString(el.latex||'',{displayMode:!!el.displayMath,throwOnError:false,strict:'ignore',output:'html'}):esc(el.latex||''); }
                    catch(e){ mh=esc(el.latex||''); }
                    // 가져온 수식은 원문 잉크 상자를 넘지 않도록 넘치는 만큼 축소해 그린다.
                    const imp=!!el.imported;
                    const bw=imp?(el.inkW||el.w):el.w, bh=imp?(el.inkH||el.h):el.h;
                    const k=imp?Math.min(1,(latexFitScale(el)||1)):1;
                    const fs=Math.max(6,(el.fontSize||20)*k);
                    body+=`<div style="position:absolute;left:${el.x}px;top:${el.y}px;width:${bw}px;height:${bh}px;`+
                          `transform:rotate(${normalizedRotation(el.rotation)}deg);transform-origin:50% 50%;display:flex;align-items:center;${el.displayMath?'justify-content:center;':''}font-size:${fs}px;`+
                          `line-height:1.05;font-family:'Times New Roman',serif;color:#111;`+
                          `overflow:${imp?'hidden':'visible'};">${htmlToXhtml(mh)}</div>`;
                });
                const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}" viewBox="0 0 ${size.w} ${size.h}">`+
                    `<foreignObject x="0" y="0" width="${size.w}" height="${size.h}">`+
                    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${size.w}px;height:${size.h}px;position:relative;`+
                    `font-family:'Pretendard Variable','Pretendard',sans-serif;">${body}</div></foreignObject></svg>`;
                const img=await svgToImage(svg);
                ctx.drawImage(img,0,0,size.w,size.h);
                done=true;
            }catch(e){
                console.warn('텍스트 SVG 렌더 실패 → 캔버스 폴백',e);
            }
            if(!done){
                texts.forEach(el=>drawTextOnCanvas(ctx,el));
                formulas.forEach(el=>{
                    ctx.save();ctx.fillStyle='#111';
                    // 9.0 · 폴백에서도 원문 잉크 폭을 넘지 않게 글씨를 줄여 그린다.
                    const bw=Math.max(8,(el.imported?(el.inkW||el.w):el.w));
                    let fs=el.fontSize||20;
                    ctx.font=`${fs}px "Times New Roman",serif`;
                    const raw=(el.latex||'').replace(/[{}\\]|\$/g,'');
                    const tw=ctx.measureText(raw).width||1;
                    if(tw>bw){ fs=Math.max(6,fs*(bw/tw)); ctx.font=`${fs}px "Times New Roman",serif`; }
                    ctx.textBaseline='middle';ctx.textAlign=el.displayMath?'center':'left';
                    ctx.fillText(raw,el.displayMath?el.x+bw/2:el.x,el.y+(el.imported?(el.inkH||el.h):el.h)/2);
                    ctx.restore();
                });
            }
        }
        return c;
    }

    function loadImg(src){
        return new Promise((res,rej)=>{
            const i=new Image();
            i.onload=()=>res(i);
            i.onerror=rej;
            i.src=src;
        });
    }

    function drawStrokeOnCanvas(ctx,st){
        const pts=st.pts||[];
        if(!pts.length) return;
        ctx.save();
        ctx.translate(st.dx||0, st.dy||0);
        const a=normalizedRotation(st.rotation);
        if(a){ const bb=strokeBBox(st),cx=bb.x+bb.w/2,cy=bb.y+bb.h/2; ctx.translate(cx,cy);ctx.rotate(a*Math.PI/180);ctx.translate(-cx,-cy); }
        ctx.strokeStyle=st.color; ctx.lineWidth=st.size;
        ctx.lineCap='round'; ctx.lineJoin='round';
        ctx.beginPath();
        ctx.moveTo(pts[0][0],pts[0][1]);
        if(st.sharp&&!isEllipsePts(pts)){
            for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]);
        }else{
            for(let i=1;i<pts.length-1;i++){
                const mx=(pts[i][0]+pts[i+1][0])/2, my=(pts[i][1]+pts[i+1][1])/2;
                ctx.quadraticCurveTo(pts[i][0],pts[i][1],mx,my);
            }
            const last=pts[pts.length-1];
            ctx.lineTo(last[0],last[1]);
        }
        if(st.fillColor){
            ctx.save(); ctx.globalAlpha=st.fillOpacity==null?0.58:st.fillOpacity; ctx.fillStyle=st.fillColor; ctx.fill('evenodd'); ctx.restore();
        }
        if(st.opacity!=null) ctx.globalAlpha=st.opacity;
        ctx.stroke();
        ctx.restore();
    }

    // 서식 없는 순수 텍스트 폴백 (SVG 렌더가 막혔을 때도 글자는 남긴다)
    function drawTextOnCanvas(ctx,el){
        const tmp=document.createElement('div');
        tmp.innerHTML=(el.html||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(div|p)>/gi,'\n');
        const text=(tmp.textContent||'').replace(/\u00a0/g,' ');
        if(!text.trim()) return;
        if(el.pdfText&&el.tight){
            for(const s of tmp.querySelectorAll(':scope > span[data-pdf-w]')){
                const st=s.style, fs=parseFloat(st.fontSize)||el.fontSize||parseFloat(s.dataset.fs)||14;
                const text=(s.textContent||'').trimEnd(), width=parseFloat(s.dataset.pdfW);
                const baseline=parseFloat(s.dataset.pdfBase);
                if(!(width>0)||!Number.isFinite(baseline)) continue;
                ctx.save();
                ctx.font=[st.fontStyle||'normal',st.fontWeight||'400',fs+'px',st.fontFamily||fontCSS(el.font)].join(' ');
                ctx.fillStyle=st.color||'#111'; ctx.textAlign='left'; ctx.textBaseline='alphabetic';
                const natural=ctx.measureText(text).width;
                ctx.translate(el.x+(parseFloat(st.left)||0),el.y+baseline);
                if(natural>0) ctx.scale(width/natural,1);
                ctx.fillText(text,0,0); ctx.restore();
            }
            return;
        }
        // 단어 상자(tight): 패딩·줄바꿈 없이 상자 중앙에 한 줄로
        if(el.tight){
            const fs=el.fontSize||16;
            ctx.save();
            ctx.fillStyle='#111111';
            ctx.font=`${fs}px ${fontCSS(el.font||'pretendard')}`;
            ctx.textBaseline='middle';
            const al=el.align||'left';
            ctx.textAlign=al==='center'?'center':al==='right'?'right':'left';
            const ox=al==='center'?el.x+el.w/2:al==='right'?el.x+el.w:el.x;
            ctx.fillText(text.replace(/\s+/g,' '), ox, el.y+el.h/2);
            ctx.restore();
            return;
        }
        const fs=el.fontSize||16, lh=fs*1.5;
        ctx.save();
        ctx.fillStyle='#111111';
        ctx.font=`${fs}px ${fontCSS(el.font||'pretendard')}`;
        ctx.textBaseline='top';
        const al=el.align||'left';
        ctx.textAlign=al==='center'?'center':al==='right'?'right':'left';
        const maxW=el.w-24;
        const ox=al==='center'?el.x+el.w/2:al==='right'?el.x+el.w-12:el.x+12;
        let y=el.y+8;
        text.split('\n').forEach(para=>{
            let line='';
            for(const ch of para){
                if(ctx.measureText(line+ch).width>maxW && line){
                    ctx.fillText(line, ox, y); y+=lh; line=ch;
                }else line+=ch;
            }
            if(line) { ctx.fillText(line, ox, y); y+=lh; }
        });
        ctx.restore();
    }

    function drawPaperBg(ctx,type,size){
        ctx.save();
        if(type==='lined'){
            ctx.strokeStyle='#e8e8e8'; ctx.lineWidth=1;
            for(let y=47.5;y<size.h;y+=32){
                ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(size.w,y); ctx.stroke();
            }
        }else if(type==='grid'){
            ctx.strokeStyle='#e8e8e8'; ctx.lineWidth=1;
            for(let y=0.5;y<size.h;y+=32){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(size.w,y); ctx.stroke(); }
            for(let x=0.5;x<size.w;x+=32){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,size.h); ctx.stroke(); }
        }else if(type==='dotted'){
            ctx.fillStyle='#cfcfcf';
            for(let y=12;y<size.h;y+=24)
                for(let x=12;x<size.w;x+=24){ ctx.beginPath(); ctx.arc(x,y,1,0,6.284); ctx.fill(); }
        }
        ctx.restore();
    }

    // 종이 배경을 SVG 도형으로 직접 그린다 (화면 CSS와 동일한 간격/색)
    function paperBgSVG(type,size){
        let out='';
        if(type==='lined'){
            for(let y=47.5;y<size.h;y+=32) out+=`<line x1="0" y1="${y}" x2="${size.w}" y2="${y}" stroke="#e8e8e8" stroke-width="1"/>`;
        }else if(type==='grid'){
            for(let y=0.5;y<size.h;y+=32) out+=`<line x1="0" y1="${y}" x2="${size.w}" y2="${y}" stroke="#e8e8e8" stroke-width="1"/>`;
            for(let x=0.5;x<size.w;x+=32) out+=`<line x1="${x}" y1="0" x2="${x}" y2="${size.h}" stroke="#e8e8e8" stroke-width="1"/>`;
        }else if(type==='dotted'){
            for(let y=12;y<size.h;y+=24) for(let x=12;x<size.w;x+=24) out+=`<circle cx="${x}" cy="${y}" r="1" fill="#cfcfcf"/>`;
        }
        return out;
    }

    function downloadBlob(blob,name){
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a');
        a.href=url; a.download=name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(()=>URL.revokeObjectURL(url),4000);
    }
    function canvasToBlob(c,type,q){
        return new Promise(res=>{
            if(c.toBlob) c.toBlob(b=>res(b),type,q);
            else{
                const d=c.toDataURL(type,q), bin=atob(d.split(',')[1]);
                const u=new Uint8Array(bin.length);
                for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
                res(new Blob([u],{type}));
            }
        });
    }
    function safeTitle(){
        return ((curNB&&curNB.title)||'노트').replace(/[\\/:*?"<>|]/g,'').trim()||'노트';
    }

    // 내보내기 진행 표시
    function expProgress(cur,total,label){
        const el=document.getElementById('expProg');
        if(!el) return;
        if(cur<0){ el.style.display='none'; return; }
        el.style.display='flex';
        el.querySelector('.ep-txt').textContent=label||`내보내는 중... ${cur}/${total}`;
        el.querySelector('.ep-fill').style.width=total?Math.round(cur/total*100)+'%':'0%';
    }

    function openExportModal(){
        if(!doc){ toast('노트를 먼저 열어주세요'); return; }
        document.getElementById('expInfo').textContent=`총 ${doc.pages.length}페이지 · 현재 ${curPageIdx+1}페이지`;
        document.getElementById('exportModal').style.display='flex';
        openNav(closeExportModal);
    }
    function closeExportModal(){ document.getElementById('exportModal').style.display='none'; navDrop(closeExportModal); }

    async function exportCurrentJPG(){
        if(!doc) return;
        if(penActive) finishDrawing();
        commitEditingText();
        expProgress(0,1);
        try{
            const c=await renderPageCanvas(curPageIdx);
            const blob=await canvasToBlob(c,'image/jpeg',0.95);
            downloadBlob(blob, `${safeTitle()}_${curPageIdx+1}.jpg`);
            toast('현재 페이지 저장 완료 ✓',1600);
        }catch(e){ console.error(e); toast('내보내기 실패: '+(e.message||e),3000); }
        finally{ expProgress(-1); }
    }

    async function copyPageToClipboard(){
        if(!doc) return;
        if(penActive) finishDrawing();
        commitEditingText();
        expProgress(0,1,'클립보드로 복사 중...');
        try{
            const c=await renderPageCanvas(curPageIdx);
            const blob=await canvasToBlob(c,'image/png');
            if(navigator.clipboard&&window.ClipboardItem){
                await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
                toast('클립보드에 복사됨 ✓',1600);
            }else{
                downloadBlob(blob,`${safeTitle()}_${curPageIdx+1}.png`);
                toast('클립보드 미지원 → 파일로 저장됨',2200);
            }
        }catch(e){ console.error(e); toast('복사 실패: '+(e.message||e),3000); }
        finally{ expProgress(-1); }
    }

    async function exportJPG(){
        if(!doc){ toast('노트를 먼저 열어주세요'); return; }
        if(penActive) finishDrawing();
        commitEditingText();
        const n=doc.pages.length;
        expProgress(0,n);
        try{
            const title=safeTitle();
            for(let i=0;i<n;i++){
                expProgress(i,n);
                const c=await renderPageCanvas(i);
                const blob=await canvasToBlob(c,'image/jpeg',0.95);
                if(!blob) throw new Error('이미지 생성 실패');
                downloadBlob(blob, n>1?`${title}_${i+1}.jpg`:`${title}.jpg`);
                await new Promise(r=>setTimeout(r,320));   // 브라우저 다중 다운로드 여유
            }
            toast(`JPG ${n}장 저장 완료 ✓`,1800);
        }catch(e){
            console.error('JPG 내보내기 실패:',e);
            toast('내보내기 실패: '+(e.message||e),3200);
        }finally{ expProgress(-1); }
    }

    // 진짜 PDF 파일을 직접 생성 (외부 라이브러리/팝업 없이)
    function buildPDF(pages,w,h){
        // pages: [{jpg:Uint8Array}]
        const enc=new TextEncoder();
        const chunks=[]; let len=0;
        const push=(d)=>{ const u=(typeof d==='string')?enc.encode(d):d; chunks.push(u); len+=u.length; return len; };
        const offsets=[];
        push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

        const nPages=pages.length;
        const objTotal=2+nPages*3;           // catalog, pages, then (page,content,image)*n
        const startObj=(i)=>{ offsets[i]=len; push(`${i} 0 obj\n`); };
        const endObj=()=>push('endobj\n');

        startObj(1);
        push(`<< /Type /Catalog /Pages 2 0 R >>\n`); endObj();

        const kids=[]; for(let i=0;i<nPages;i++) kids.push(`${3+i*3} 0 R`);
        startObj(2);
        push(`<< /Type /Pages /Count ${nPages} /Kids [${kids.join(' ')}] >>\n`); endObj();

        for(let i=0;i<nPages;i++){
            const pageObj=3+i*3, contentObj=pageObj+1, imgObj=pageObj+2;
            startObj(pageObj);
            push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] `+
                 `/Resources << /XObject << /Im0 ${imgObj} 0 R >> >> /Contents ${contentObj} 0 R >>\n`);
            endObj();

            const stream=`q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`;
            startObj(contentObj);
            push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream\n`); endObj();

            const jpg=pages[i].jpg;
            startObj(imgObj);
            push(`<< /Type /XObject /Subtype /Image /Width ${pages[i].w} /Height ${pages[i].h} `+
                 `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
            push(jpg);
            push('\nendstream\n'); endObj();
        }

        const xrefPos=len;
        let xref=`xref\n0 ${objTotal+1}\n0000000000 65535 f \n`;
        for(let i=1;i<=objTotal;i++){
            xref+=String(offsets[i]||0).padStart(10,'0')+' 00000 n \n';
        }
        push(xref);
        push(`trailer\n<< /Size ${objTotal+1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

        const out=new Uint8Array(len); let o=0;
        chunks.forEach(c=>{ out.set(c,o); o+=c.length; });
        return new Blob([out],{type:'application/pdf'});
    }

    async function exportPDF(){
        if(!doc){ toast('노트를 먼저 열어주세요'); return; }
        if(penActive) finishDrawing();
        commitEditingText();
        const n=doc.pages.length;
        expProgress(0,n);
        try{
            const size=paperSize();
            const pages=[];
            for(let i=0;i<n;i++){
                expProgress(i,n);
                const c=await renderPageCanvas(i);
                const blob=await canvasToBlob(c,'image/jpeg',0.92);
                const buf=new Uint8Array(await blob.arrayBuffer());
                pages.push({jpg:buf,w:c.width,h:c.height});
            }
            expProgress(n,n,'PDF 만드는 중...');
            const pdf=buildPDF(pages,size.w,size.h);
            downloadBlob(pdf, safeTitle()+'.pdf');
            toast(`PDF 저장 완료 ✓ (${n}쪽)`,2000);
            fetch('/api/notifications/event',{method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({kind:'pdf',event:'pdf_'+Date.now().toString(36),
                    title:'PDF를 만들었어요',message:`${safeTitle()} · ${n}쪽 저장 완료`})}).catch(()=>{});
        }catch(e){
            console.error('PDF 내보내기 실패:',e);
            toast('PDF 실패: '+(e.message||e),3200);
        }finally{ expProgress(-1); }
    }



/* APP-PART:13-collab.js:END */
