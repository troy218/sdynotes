/* === src/app/13a-collab-sync.js ===
   적응형 폴링 · 요소 LWW
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:13a-collab-sync.js:BEGIN */
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

/* APP-PART:13a-collab-sync.js:END */
