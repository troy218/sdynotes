/* === src/app/09-tools-ui.js ===
   더보기 서랍 · 체크포인트 · 패널
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:09-tools-ui.js:BEGIN */
    // ===== 더보기 서랍 =====
    function openMore(tab){
        const s=document.getElementById('moreSheet');
        if(!s) return;
        const want=tab||_moreTab||'insert';
        if(s.classList.contains('show')&&want===_moreTab){ closeMore(); return; }
        s.classList.add('show');
        moreTab(want);
        // 열 때 토글류 버튼의 현재 상태를 반영
        try{ updatePageInfo(); updateLockUI(); }catch(e){}
        try{ document.querySelectorAll('#moreSheet .ptool').forEach(b=>
                b.classList.toggle('active',b.dataset.p===(doc&&doc.paper))); }catch(e){}
    }
    function closeMore(){
        const s=document.getElementById('moreSheet');
        if(s) s.classList.remove('show');
        document.querySelectorAll('.tool-cat').forEach(b=>b.classList.remove('on'));
    }
    let _moreTab='insert';
    function moreTab(name){
        _moreTab=name;
        document.querySelectorAll('#moreSheet .more-tabs button')
            .forEach(b=>b.classList.toggle('on',b.dataset.mt===name));
        document.querySelectorAll('.tool-cat').forEach(b=>b.classList.toggle('on',b.dataset.cat===name));
        document.querySelectorAll('#moreSheet .more-sec')
            .forEach(sec=>{ sec.hidden = sec.dataset.ms!==name; });
    }
    // 서랍 항목 실행 후 닫기 (mi = more item)
    function mi(fn){ try{ fn(); }finally{ closeMore(); } }

    function toggleSide(){
        sideOpen=!sideOpen;
        document.getElementById('editorView').classList.toggle('side-off',!sideOpen);
        try{ localStorage.setItem('sdy_side',sideOpen?'1':'0'); }catch(e){}
        try{ pushSettings(); }catch(e){}
        setTimeout(()=>{ layoutPages(); },260);
    }
    function initSide(){
        // 세로 도구막대는 제거됐다. 패널은 위 툴바에서 열며 항상 정상 위치에 둔다.
        sideOpen=true;
        document.getElementById('editorView').classList.remove('side-off');
        try{ localStorage.removeItem('sdy_side'); }catch(e){}
    }
    // 패널 열고 닫기 (개요 · 요소 목록 · 페이지 미리보기 …)
    function openPanel(name){
        if(sidePanel===name){ closePanel(); return; }
        sidePanel=name;
        const el=document.getElementById('sidePanel');
        el.classList.add('show');
        document.querySelectorAll('.side-btn,.panel-trigger').forEach(b=>
            b.classList.toggle('active', b.dataset.panel===name));
        renderPanel();
    }
    function closePanel(){
        sidePanel=null;
        document.getElementById('sidePanel').classList.remove('show');
        document.querySelectorAll('.side-btn,.panel-trigger').forEach(b=>b.classList.remove('active'));
    }
    function renderPanel(){
        if(!sidePanel||!doc) return;
        const box=document.getElementById('sidePanel');
        const title={outline:'개요',pages:'페이지',elements:'요소',clip:'모아두기',stats:'통계',
                     words:'중요어 분석'}[sidePanel]||'';
        let body='';
        if(sidePanel==='outline')  body=panelOutline();
        if(sidePanel==='pages')    body=panelPages();
        if(sidePanel==='elements') body=panelElements();
        if(sidePanel==='clip')     body=panelClip();
        if(sidePanel==='stats')    body=panelStats();
        if(sidePanel==='words')    body=panelWords();
        box.innerHTML=`<div class="sp-head"><b>${title}</b>
            <button onclick="closePanel()" title="닫기"><i class="ri-close-line"></i></button></div>
            <div class="sp-body">${body}</div>`;
    }

    // ---------- ① 개요 (문서 구조 한눈에) ----------
    function panelOutline(){
        let html='';
        doc.pages.forEach((pg,pi)=>{
            const texts=(pg.els||[]).filter(e=>e.type==='text'&&elPlainText(e).trim()
                                               &&!(e.tbl));
            html+=`<div class="sp-sec" onclick="goToPage(${pi+1})">
                     <i class="ri-file-text-line"></i> ${pi+1}쪽
                     <span class="sp-dim">${(pg.els||[]).length}개</span></div>`;
            texts.slice(0,8).forEach(e=>{
                const t=elPlainText(e).trim().replace(/\s+/g,' ');
                const big=(e.fontSize||16)>=22;
                html+=`<div class="sp-item${big?' big':''}" onclick="focusEl(${pi},'${e.id}')">
                         ${esc(t.length>30?t.slice(0,30)+'…':t)}</div>`;
            });
            if(texts.length>8) html+=`<div class="sp-item sp-dim">… 외 ${texts.length-8}개</div>`;
        });
        return html||'<div class="sp-empty">글자가 없습니다</div>';
    }
    // ---------- ② 페이지 미리보기 ----------
    function panelPages(){
        let html='<div class="sp-pages">';
        const size=paperSize();
        doc.pages.forEach((pg,pi)=>{
            const nEl=(pg.els||[]).length;
            const fav=isFavPage(pg.id);
            html+=`<div class="sp-page${pi===curPageIdx?' cur':''}" onclick="goToPage(${pi+1})">
                     <div class="sp-thumb" style="aspect-ratio:${size.w}/${size.h}">
                       <span>${pi+1}</span></div>
                     <div class="sp-ord">
                       <button title="앞으로" onclick="event.stopPropagation();movePage(${pi},-1)"><i class="ri-arrow-up-s-line"></i></button>
                       <button title="뒤로" onclick="event.stopPropagation();movePage(${pi},1)"><i class="ri-arrow-down-s-line"></i></button>
                     </div>
                     <div class="sp-plabel">${fav?'<i class="ri-star-fill" style="color:#f59e0b"></i> ':''}${nEl}개</div>
                   </div>`;
        });
        return html+'</div>';
    }
    // ---------- ③ 요소 목록 ----------
    function panelElements(){
        const pg=doc.pages[curPageIdx]; if(!pg) return '';
        const ico={text:'ri-text',image:'ri-image-line',stroke:'ri-pen-nib-line',legacyDraw:'ri-brush-line'};
        let html=`<div class="sp-sec"><i class="ri-stack-line"></i> ${curPageIdx+1}쪽 요소
                   <span class="sp-dim">${(pg.els||[]).length}개</span></div>`;
        (pg.els||[]).forEach(e=>{
            let label=e.type==='text'?(elPlainText(e).trim()||'(빈 글상자)')
                     :e.type==='image'?(e.sticker?'스티커':'이미지')
                     :e.type==='stroke'?'펜 그림':'그림';
            if(e.tbl) label='표 '+(e.type==='text'?`${e.tbl.r+1}행 ${e.tbl.c+1}열`:'선');
            html+=`<div class="sp-item row" onclick="focusEl(${curPageIdx},'${e.id}')">
                     <i class="${ico[e.type]||'ri-shape-line'}"></i>
                     <span>${esc(label.length>22?label.slice(0,22)+'…':label)}</span>
                   </div>`;
        });
        return html;
    }
    // ---------- ④ 모아두기 (자주 쓰는 조각) ----------
    function getClips(){
        try{ return JSON.parse(localStorage.getItem('sdy_clips')||'[]'); }catch(e){ return []; }
    }
    function setClips(l){
        try{ localStorage.setItem('sdy_clips',JSON.stringify(l.slice(0,60))); }catch(e){}
    }
    function panelClip(){
        const l=getClips();
        let html=`<div class="sp-sec"><i class="ri-inbox-archive-line"></i> 모아둔 조각
                   <span class="sp-dim">${l.length}</span></div>
                  <button class="sp-btn" onclick="clipAdd()">
                    <i class="ri-add-line"></i> 선택한 것 담기</button>`;
        if(!l.length) html+='<div class="sp-empty">글자를 고르거나 요소를 선택한 뒤<br>담아 두면 어느 노트에서든 꺼내 쓸 수 있어요</div>';
        l.forEach((c,i)=>{
            html+=`<div class="sp-item row" onclick="clipUse(${i})" title="눌러서 지금 페이지에 넣기">
                     <i class="${c.kind==='els'?'ri-shape-2-line':'ri-file-copy-line'}"></i>
                     <span>${esc(c.label)}</span>
                     <i class="ri-close-line sp-x" onclick="event.stopPropagation();clipDel(${i})"></i>
                   </div>`;
        });
        return html;
    }
    function clipAdd(){
        const sel=window.getSelection();
        if(sel&&!sel.isCollapsed&&String(sel).trim()){
            const txt=String(sel).trim();
            const l=getClips();
            l.unshift({kind:'text',label:txt.length>24?txt.slice(0,24)+'…':txt,text:txt});
            setClips(l); renderPanel(); toast('글자를 담았습니다',1400); return;
        }
        const items=selEntries();
        if(!items.length){ toast('먼저 글자를 고르거나 요소를 선택해 주세요',2000); return; }
        const data=items.map(it=>findEl(it.pageIdx,it.id)).filter(Boolean)
                        .map(e=>JSON.parse(JSON.stringify(e)));
        if(!data.length) return;
        const l=getClips();
        l.unshift({kind:'els',label:`요소 ${data.length}개`,els:data});
        setClips(l); renderPanel(); toast(`${data.length}개를 담았습니다`,1400);
    }
    function clipDel(i){ const l=getClips(); l.splice(i,1); setClips(l); renderPanel(); }
    function clipUse(i){
        const c=getClips()[i]; if(!c||!doc) return;
        pushHistory();
        const pi=curPageIdx, size=paperSize();
        if(c.kind==='text'){
            const w=Math.min(size.w-96,Math.max(220,Math.min(560,c.text.length*11)));
            doc.pages[pi].els.push({type:'text',id:uid('t'),x:80,y:100,w,h:Math.max(52,TB_H),
                                    html:esc(c.text),fontSize:curFontSize,font:curFont});
        }else{
            const bb=(()=>{let x0=1e9,y0=1e9;c.els.forEach(e=>{const b=elBBox(e);if(b){x0=Math.min(x0,b.x);y0=Math.min(y0,b.y);}});
                           return{x:x0===1e9?0:x0,y:y0===1e9?0:y0};})();
            c.els.forEach(e=>{
                const n=JSON.parse(JSON.stringify(e));
                n.id=uid(n.type[0]); delete n.group; delete n.tbl;
                if(n.type==='stroke'){ n.dx=(n.dx||0)+(80-bb.x); n.dy=(n.dy||0)+(100-bb.y); }
                else { n.x=(n.x||0)+(80-bb.x); n.y=(n.y||0)+(100-bb.y); }
                doc.pages[pi].els.push(n);
            });
        }
        markPageEdited(pi); renderPageEls(pi); saveDoc(); toast('넣었습니다',1200);
    }
    // ---------- ⑤ 통계 ----------
    function panelStats(){
        let chars=0, words=0, texts=0, imgs=0, strokes=0, tables=0;
        doc.pages.forEach(pg=>{
            tables+=(pg.tables||[]).length;
            (pg.els||[]).forEach(e=>{
                if(e.type==='text'){ texts++;
                    const t=elPlainText(e).trim();
                    chars+=t.replace(/\s/g,'').length;
                    if(t) words+=t.split(/\s+/).length;
                }
                else if(e.type==='image') imgs++;
                else if(e.type==='stroke') strokes++;
            });
        });
        const min=Math.max(1,Math.round(chars/500));
        const row=(i,k,v)=>`<div class="sp-stat"><i class="${i}"></i><span>${k}</span><b>${v}</b></div>`;
        return row('ri-file-text-line','글자 수',chars.toLocaleString())
             + row('ri-double-quotes-l','낱말 수',words.toLocaleString())
             + row('ri-time-line','읽는 시간',`약 ${min}분`)
             + row('ri-pages-line','페이지',doc.pages.length)
             + row('ri-text','글상자',texts)
             + row('ri-image-line','이미지',imgs)
             + row('ri-pen-nib-line','펜 그림',strokes)
             + row('ri-table-line','표',tables);
    }
    // 목록에서 요소를 누르면 그 자리로 이동 + 잠깐 반짝
    function focusEl(pi,id){
        goToPage(pi+1);
        setTimeout(()=>{
            const paper=paperAt(pi); if(!paper) return;
            const n=paper.querySelector(`[data-id="${id}"]`); if(!n) return;
            n.classList.add('flash');
            setTimeout(()=>n.classList.remove('flash'),1300);
        },420);
    }

    // ---------- ⑥ 집중 모드 ----------
    let focusMode=false;
    function toggleFocus(){
        focusMode=!focusMode;
        document.getElementById('editorView').classList.toggle('focus-on',focusMode);
        document.getElementById('focusBtn').classList.toggle('active',focusMode);
        toast(focusMode?'집중 모드 · 도구를 숨겼습니다 (다시 눌러 해제)':'집중 모드 해제',1800);
        setTimeout(layoutPages,260);
    }
    // ---------- ⑦ 화면 폭에 맞추기 ----------
    function zoomFit(){
        if(!doc) return;
        const body=document.getElementById('editorBody');
        const size=paperSize();
        const cs=getComputedStyle(body);
        const availW=Math.max(120, body.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight));
        _zoomCentered(()=>{
            zoomPct=Math.round(Math.max(25,Math.min(400,(availW/size.w)/Math.max(.05,fitScale)*100)));
            layoutPages();
        });
        sizeTextGhost();
        toast('화면 폭에 맞췄습니다 · '+Math.round(pageScale*100)+'%',1500);
    }
    // ---------- ⑧ 눈금자(안내선) ----------
    let guidesOn=false;
    function toggleGuides(){
        guidesOn=!guidesOn;
        document.getElementById('pagesStage').classList.toggle('guides',guidesOn);
        document.getElementById('guideBtn').classList.toggle('active',guidesOn);
        try{ localStorage.setItem('sdy_guides',guidesOn?'1':'0'); }catch(e){}
        try{ pushSettings(); }catch(e){}
        toast(guidesOn?'가이드 격자를 켰습니다 (인쇄에는 안 나옵니다)':'가이드 격자를 껐습니다',1600);
    }
    // ---------- ⑨ 페이지 배경색 ----------
    const PAGE_TINTS=[['','기본'],['#fffdf5','미색'],['#f4faf4','연녹'],['#f3f7ff','연청'],
                      ['#fdf3f7','연분홍'],['#f7f4fb','연보라'],['#1f2024','짙은 회색']];
    function openTint(e){
        const pop=document.getElementById('tintPop');
        if(pop.classList.contains('show')){ pop.classList.remove('show'); return; }
        pop.innerHTML=PAGE_TINTS.map(([c,n])=>
            `<div class="tint-opt${(doc.tint||'')===c?' on':''}" onclick="setTint('${c}')">
               <span style="background:${c||'var(--card)'}"></span>${n}</div>`).join('');
        pop.classList.add('show');
        const r=(e&&e.currentTarget||document.getElementById('tintBtn')).getBoundingClientRect();
        pop.style.left=(r.right+8)+'px';
        pop.style.top=Math.min(r.top,innerHeight-260)+'px';
    }
    function setTint(c){
        if(!doc) return;
        pushHistory();
        doc.tint=c||'';
        applyTint(); saveDoc();
        document.getElementById('tintPop').classList.remove('show');
        toast(c?'페이지 색을 바꿨습니다':'기본 색으로 되돌렸습니다',1400);
    }
    function applyTint(){
        const st=document.getElementById('pagesStage'); if(!st) return;
        st.style.setProperty('--paper-tint',(doc&&doc.tint)?doc.tint:'');
        st.classList.toggle('tinted',!!(doc&&doc.tint));
    }
    // ---------- ⑩ 자동 저장 백업 / 되돌리기 지점 ----------
    // 10.0 · 지점 저장이 "저장 공간이 부족합니다"로 실패하던 문제 수정.
    //   localStorage(≈5MB)에는 노트 본문(nb_*)이 이미 대부분 들어 있어,
    //   PDF 등 큰 노트의 지점 5개를 통째로 담으면 그냥 튕겨 나갔다.
    //   IndexedDB 는 용량 제한이 사실상 없어 큰 노트도 안전하다.
    let _cpDB=null;
    function cpDB(){
        if(_cpDB) return _cpDB;
        _cpDB=new Promise((res,rej)=>{
            try{
                const rq=indexedDB.open('sdy_cp',1);
                rq.onupgradeneeded=()=>{ try{ rq.result.createObjectStore('cp'); }catch(e){} };
                rq.onsuccess=()=>res(rq.result);
                rq.onerror=()=>rej(rq.error);
            }catch(e){ rej(e); }
        }).catch(()=>null);
        return _cpDB;
    }
    async function cpGetAll(id){
        try{
            const db=await cpDB();
            if(db){
                const out=await new Promise((res)=>{
                    try{
                        const tx=db.transaction('cp','readonly');
                        const rq=tx.objectStore('cp').get(id);
                        rq.onsuccess=()=>res(rq.result||null);
                        rq.onerror=()=>res(null);
                    }catch(e){ res(null); }
                });
                if(Array.isArray(out)) return out;
            }
        }catch(e){}
        // 옛 버전이 localStorage 에 남겨 둔 지점도 읽어 온다
        try{ const l=JSON.parse(localStorage.getItem('sdy_cp_'+id)||'[]'); if(Array.isArray(l)&&l.length) return l; }catch(e){}
        return [];
    }
    async function cpPutAll(id,list){
        try{
            const db=await cpDB();
            if(db){
                await new Promise((res)=>{
                    try{
                        const tx=db.transaction('cp','readwrite');
                        tx.objectStore('cp').put(list,id);
                        tx.oncomplete=()=>res(true);
                        tx.onerror=()=>res(false);
                        tx.onabort=()=>res(false);
                    }catch(e){ res(false); }
                });
                try{ localStorage.removeItem('sdy_cp_'+id); }catch(e){}
                return true;
            }
        }catch(e){}
        return false;
    }
    async function makeCheckpoint(){
        if(!curNB||!doc) return;
        let l=await cpGetAll(curNB.id);
        l.unshift({t:Date.now(),pg:curPageIdx||0,data:JSON.stringify(doc)});
        l=l.slice(0,5);
        const ok=await cpPutAll(curNB.id,l);
        if(!ok){ toast('지점을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요',2000); return; }
        toast('지금 상태를 저장했습니다 · 되돌리기 지점 '+l.length+'개',2200);
    }
    async function openCheckpoints(){
        if(!curNB){ return; }
        let l=await cpGetAll(curNB.id);
        const box=document.getElementById('cpModal');
        const body=document.getElementById('cpList');
        if(!l.length){
            body.innerHTML='<div class="sp-empty" style="padding:26px 10px;">저장해 둔 지점이 없습니다<br>아래 버튼으로 지금 상태를 남겨 두세요</div>';
        }else{
            body.innerHTML=l.map((c,i)=>{
                const d=new Date(c.t);
                const pg=(()=>{try{return JSON.parse(c.data).pages.length;}catch(e){return '?';}})();
                return `<div class="cp-item">
                    <div><b>${d.getMonth()+1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}</b>
                         <span class="sp-dim">${pg}쪽 · ${fmtBytes(new Blob([c.data]).size)}</span></div>
                    <button onclick="restoreCheckpoint(${i})">되돌리기</button></div>`;
            }).join('');
        }
        box.style.display='flex';
        openNav(closeCheckpoints);
    }
    function closeCheckpoints(){ document.getElementById('cpModal').style.display='none'; navDrop(closeCheckpoints); }
    async function restoreCheckpoint(i){
        let l=await cpGetAll(curNB.id);
        const c=l[i]; if(!c) return;
        if(!confirm('이 시점으로 되돌릴까요? 지금 내용은 되돌리기(Ctrl+Z)로 복구할 수 있습니다.')) return;
        pushHistory(true);
        const keep=doc;
        try{ doc=JSON.parse(c.data); }catch(e){ doc=keep; toast('복원할 수 없습니다',2000); return; }
        _docId=(curNB&&curNB.id)||null;
        reviveDocMaps(keep);      // 20.3 · 동기화용 Map 복원(없으면 이후 동기화가 멈춘다)
        curPageIdx=Math.min(c.pg||0,(doc.pages||[]).length-1);
        renderPages(); saveDoc(); closeCheckpoints();
        // 저장해 둔 쪽으로 스크롤 이동 (노트 전환 뒤에는 새 노트를 건드리지 않는다)
        const _rd=doc, _rpi=curPageIdx;
        setTimeout(()=>{
            try{
                if(doc!==_rd||!curNB) return;
                const size=paperSize();
                const body=document.getElementById('editorBody');
                body.scrollTop=(_rpi)*(size.h+PAGE_GAP)*pageScale;
                updatePageInfo();
            }catch(e){}
        },80);
        toast('되돌렸습니다',1800);
    }

    // ==========================================================
    //  추가 기능 10가지 (Task 30)
    // ==========================================================

    // ---------- ① 찾아 바꾸기 ----------
    function toggleReplace(){
        const bar=document.getElementById('findBar');
        const on=!bar.classList.contains('rep');
        bar.classList.toggle('rep',on);
        if(on){
            if(!findOpen) openFind();
            setTimeout(()=>{const r=document.getElementById('repInput'); if(r) r.focus();},60);
        }
    }
    function replaceOne(){
        if(!findHits.length||findCur<0){ toast('바꿀 대상이 없습니다',1500); return; }
        const rep=document.getElementById('repInput').value;
        const h=findHits[findCur];
        const el=findEl(h.pageIdx,h.id);
        if(!el){ toast('대상을 찾지 못했습니다',1500); return; }
        pushHistory();
        if(replaceInEl(el,findQ.trim(),rep,1)){
            markPageEdited(h.pageIdx); renderPageEls(h.pageIdx); saveDoc();
            const keep=findCur;
            runFind(findQ);
            if(findHits.length) findCur=Math.min(keep,findHits.length-1);
            updateFindCount(); paintFindHits();
            toast('1개를 바꿨습니다',1300);
        }
    }
    function replaceAll(){
        const needle=findQ.trim();
        if(!needle){ toast('찾을 글자를 입력해 주세요',1600); return; }
        const rep=document.getElementById('repInput').value;
        pushHistory();
        let n=0; const pages=new Set();
        doc.pages.forEach((pg,pi)=>{
            (pg.els||[]).forEach(el=>{
                if(el.type!=='text') return;
                const c=replaceInEl(el,needle,rep,Infinity);
                if(c){ n+=c; pages.add(pi); }
            });
        });
        if(!n){ toast('바꿀 것이 없습니다',1600); return; }
        pages.forEach(pi=>{ markPageEdited(pi); renderPageEls(pi); });
        saveDoc(); runFind(findQ);
        toast(`${n}개를 바꿨습니다 (Ctrl+Z 로 되돌리기)`,2400);
    }
    // 태그는 건드리지 않고 글자 노드만 바꾼다 (서식·링크 보존)
    function replaceInEl(el,needle,rep,limit){
        if(!needle) return 0;
        const box=document.createElement('div');
        box.innerHTML=el.html||'';
        let done=0;
        const walk=(node)=>{
            if(done>=limit) return;
            for(const ch of Array.from(node.childNodes)){
                if(done>=limit) return;
                if(ch.nodeType===3){
                    const low=ch.nodeValue.toLowerCase(), nl=needle.toLowerCase();
                    let out='', from=0, at;
                    while((at=low.indexOf(nl,from))>=0 && done<limit){
                        out+=ch.nodeValue.slice(from,at)+rep;
                        from=at+needle.length; done++;
                    }
                    if(from>0){ out+=ch.nodeValue.slice(from); ch.nodeValue=out; }
                }else walk(ch);
            }
        };
        walk(box);
        if(done) el.html=box.innerHTML;
        return done;
    }

    // ---------- ② 체크리스트 ----------
    // ---------- 체크상자 ----------
    // 글을 쓰다가 누르면 커서 자리에 ☐ 가 들어간다.
    function insertCheckbox(){
        if(!doc) return;
        const w=document.querySelector('.tb.edit');
        if(w){
            // 편집 중 → 커서 위치에 그대로 끼워 넣는다
            const c=w.querySelector('.tb-content');
            c.focus({preventScroll:true});
            const sel=window.getSelection();
            let rng=(sel&&sel.rangeCount&&c.contains(sel.anchorNode))
                    ? sel.getRangeAt(0) : null;
            if(!rng){ rng=document.createRange(); rng.selectNodeContents(c); rng.collapse(false); }
            rng.deleteContents();
            const box=document.createElement('span');
            box.setAttribute('data-ck','0');
            box.textContent='☐';
            const sp=document.createTextNode('\u00a0');
            rng.insertNode(sp); rng.insertNode(box);
            const r2=document.createRange();
            r2.setStartAfter(sp); r2.collapse(true);
            sel.removeAllRanges(); sel.addRange(r2);
            syncTextEl(w); saveDoc();
            toast('체크상자를 넣었습니다 · 눌러서 체크',1800);
            return;
        }
        // 편집 중이 아니면 새 글상자를 만들어 체크상자로 시작한다
        pushHistory();
        const pi=curPageIdx, size=paperSize();
        const x=Math.round(lastMouse.pageIdx===pi&&lastMouse.x?lastMouse.x:(size.w-300)/2);
        const y=Math.round(lastMouse.pageIdx===pi&&lastMouse.y?lastMouse.y:140);
        const dim=textBoxDefaultSize();
        const el={type:'text',id:uid('t'),x,y,w:Math.max(300,dim.w),h:dim.h,
                  html:'<span data-ck="0">☐</span>&nbsp;',
                  fontSize:curFontSize||16,font:curFont};
        doc.pages[pi].els.push(el);
        markPageEdited(pi); renderPageEls(pi); saveDoc();
        const node=paperQ(pi,`.tb[data-id="${el.id}"]`);
        if(node){
            enterEdit(node,false);
            const c=node.querySelector('.tb-content');
            const r=document.createRange(); r.selectNodeContents(c); r.collapse(false);
            const s2=window.getSelection(); s2.removeAllRanges(); s2.addRange(r);
        }
        toast('체크상자를 넣었습니다 · 이어서 입력하세요',2000);
    }

    // 체크 박스 클릭 (편집 중이 아니어도 눌린다)
    document.addEventListener('click',e=>{
        const ck=e.target.closest('[data-ck]');
        if(!ck||!doc) return;
        const w=ck.closest('.tb'); if(!w) return;
        e.preventDefault(); e.stopPropagation();
        const on=ck.getAttribute('data-ck')==='1';
        ck.setAttribute('data-ck',on?'0':'1');
        ck.textContent=on?'☐':'☑';
        const el=findEl(+w.dataset.pageIdx,w.dataset.id);
        if(el){ el.html=w.querySelector('.tb-content').innerHTML; markPageEdited(+w.dataset.pageIdx); saveDoc(); }
    },true);

    // ---------- ③ 요소 잠그기 ----------
    function toggleLockEl(){
        const items=selEntries();
        if(!items.length){ toast('먼저 요소를 선택해 주세요',1700); return; }
        pushHistory();
        let on=0;
        items.forEach(it=>{
            const el=findEl(it.pageIdx,it.id); if(!el) return;
            el.locked=!el.locked;
            if(el.locked) on++;
        });
        const pi=items[0].pageIdx;
        deselectAll(true); clearMulti();
        markPageEdited(pi); renderPageEls(pi); saveDoc();
        toast(on?`${on}개를 잠갔습니다 · 실수로 움직이지 않아요`:'잠금을 풀었습니다',2000);
    }
    function isElLocked(pi,id){ const e=findEl(pi,id); return !!(e&&e.locked); }

    // ---------- ④ 메모 핀 ----------
    let pinMode=false, curPin=null, _pinPointerBlockUntil=0;
    function togglePinMode(){
        pinMode=!pinMode;
        if(pinMode) try{ activateVisiblePages(); }catch(_e){}   // 20.0
        if(pinMode) cancelPlaceMode();
        document.body.classList.toggle('pin-mode',pinMode);
        document.querySelectorAll('.js-pin').forEach(b=>b.classList.toggle('active',pinMode));
        toast(pinMode?'메모 붙이기 · 종이의 원하는 곳을 클릭하세요':'메모 붙이기 해제',2000);
    }
    function pageNotes(pi){
        const pg=doc&&doc.pages[pi]; if(!pg) return [];
        if(!Array.isArray(pg.notes)) pg.notes=[];
        return pg.notes;
    }
    function addPin(pi,x,y){
        pushHistory();
        const n={id:'n_'+Math.random().toString(36).slice(2,8),x:Math.round(x),y:Math.round(y),text:''};
        pageNotes(pi).push(n);
        pinMode=false;
        document.body.classList.remove('pin-mode');
        document.querySelectorAll('.js-pin').forEach(b=>b.classList.remove('active'));
        markPageEdited(pi); renderPins(pi); saveDoc();
        setTimeout(()=>openPin(pi,n.id),60);
    }
    function renderPins(pi){
        const paper=paperAt(pi); if(!paper) return;
        let layer=paper.querySelector('.layer-pin');
        if(!layer){
            layer=document.createElement('div');
            layer.className='layer-pin';
            paper.appendChild(layer);
        }
        layer.innerHTML='';
        pageNotes(pi).forEach(n=>{
            const d=document.createElement('div');
            d.className='pin'+(n.text?'':' on');
            d.style.left=n.x+'px'; d.style.top=n.y+'px';
            d.title=n.text?n.text.slice(0,40):'메모 (비어 있음)';
            d.innerHTML='<i class="ri-chat-1-fill"></i>';
            d.addEventListener('pointerdown',e=>e.stopPropagation());
            d.addEventListener('click',e=>{ e.stopPropagation(); openPin(pi,n.id); });
            layer.appendChild(d);
        });
    }
    function renderAllPins(){ if(doc) Array.from(mountedShells.keys()).forEach(i=>{ try{ renderPins(i); }catch(e){} }); }
    function openPin(pi,id){
        const n=pageNotes(pi).find(x=>x.id===id); if(!n) return;
        curPin={pi,id};
        const pop=document.getElementById('pinPop');
        document.getElementById('pinText').value=n.text||'';
        pop.classList.add('show');
        const paper=paperAt(pi);
        if(paper){
            // 팝업은 fixed(CSS px) — 종이 사각(화면 px)과 단위를 맞춰야
            // 사이트 기본 배율(90%)에서도 메모 바로 옆에 붙는다.
            const r=paper.getBoundingClientRect(), psc=uiPageScale(pi), k=uiCssZoom();
            let L=r.left/k+n.x*psc.x+14, T=r.top/k+n.y*psc.y-10;
            L=Math.max(8,Math.min(L,uiCss(innerWidth)-268));
            T=Math.max(60,Math.min(T,uiCss(innerHeight)-190));
            pop.style.left=L+'px'; pop.style.top=T+'px';
        }
        setTimeout(()=>document.getElementById('pinText').focus(),50);
    }
    function savePin(){
        if(!curPin) return;
        const n=pageNotes(curPin.pi).find(x=>x.id===curPin.id); if(!n) return;
        n.text=document.getElementById('pinText').value;
        markPageEdited(curPin.pi); renderPins(curPin.pi); saveDoc(); closePin();
        toast('메모를 저장했습니다',1200);
    }
    function delPin(){
        if(!curPin) return;
        pushHistory();
        doc.pages[curPin.pi].notes=pageNotes(curPin.pi).filter(x=>x.id!==curPin.id);
        markPageEdited(curPin.pi); renderPins(curPin.pi); saveDoc(); closePin();
        toast('메모를 지웠습니다',1200);
    }
    function closePin(){
        curPin=null;
        document.getElementById('pinPop').classList.remove('show');
    }

    // ---------- ⑤ 템플릿 ----------
    // ---------- ⑥ 발표(읽기) 모드 ----------
    let presentIdx=0, presentOn=false;
    async function startPresent(){
        if(!doc) return;
        presentOn=true; presentIdx=curPageIdx;
        const v=document.getElementById('presentView');
        v.classList.add('show');
        await showPresent();
    }
    async function showPresent(){
        const img=document.getElementById('presentImg');
        const lbl=document.getElementById('presentNum');
        const ld=document.getElementById('presentLoad');
        lbl.textContent=`${presentIdx+1} / ${doc.pages.length}`;
        ld.style.display='block'; img.style.display='none';
        try{
            const c=await renderPageCanvas(presentIdx,{});
            img.src=c.toDataURL('image/png');
            img.style.display='block';
        }catch(e){ toast('페이지를 그리지 못했습니다',1800); }
        ld.style.display='none';
    }
    function presentStep(d){
        const n=presentIdx+d;
        if(n<0||n>=doc.pages.length) return;
        presentIdx=n; showPresent();
    }
    function endPresent(){
        presentOn=false;
        document.getElementById('presentView').classList.remove('show');
        goToPage(presentIdx+1);
    }

    // ---------- ⑦ 페이지 순서 바꾸기 ----------
    function movePage(i,d){
        if(!doc) return;
        const j=i+d;
        if(j<0||j>=doc.pages.length) return;
        pushHistory();
        const [p]=doc.pages.splice(i,1);
        doc.pages.splice(j,0,p);
        if(curPageIdx===i) curPageIdx=j;
        else if(curPageIdx===j) curPageIdx=i;
        renderPages(); saveDoc();
        if(sidePanel==='pages') renderPanel();
        toast(`${i+1}쪽 → ${j+1}쪽 으로 옮겼습니다`,1600);
    }

    // ---------- ⑧ 글자 수 세기(선택 영역) ----------
    function countSelection(){
        const sel=window.getSelection();
        const s=sel?String(sel):'';
        if(!s.trim()){
            openPanel('stats');
            return;
        }
        const ch=s.replace(/\s/g,'').length;
        const wd=s.trim().split(/\s+/).length;
        toast(`선택한 글자 ${ch}자 · ${wd}낱말`,2600);
    }

    // ---------- ⑨ 눈 편한 모드(세피아) ----------
    let sepiaOn=false;
    function toggleSepia(){
        sepiaOn=!sepiaOn;
        document.getElementById('editorBody').style.filter=
            sepiaOn?'sepia(.22) saturate(.92) brightness(.98)':'';
        const b=document.getElementById('sepiaBtn');
        if(b) b.classList.toggle('active',sepiaOn);
        try{ localStorage.setItem('sdy_sepia',sepiaOn?'1':'0'); }catch(e){}
        try{ pushSettings(); }catch(e){}
        toast(sepiaOn?'눈이 편한 색으로 보여 줍니다 (화면만 · 저장물은 그대로)':'원래 색으로 되돌렸습니다',2200);
    }

    // ---------- ⑩ 자동 백업 내려받기 ----------
    // ==========================================================
    //  단어 빈도 분석 — 중요어 히트맵 (Task 31)
    //  자주 나온 낱말일수록 진한 파랑으로 물들여, 문서의 핵심어를
    //  한눈에 알아볼 수 있게 한다. (화면 표시 전용 · 원문 변경 없음)
    // ==========================================================
    // 화면 색칠용 <span class="wf"> 를 걷어내 원래 글자로 되돌린다.
    // (저장 경로에서 항상 통과시켜 색이 문서에 스며들지 않게 한다)
    function stripWF(html){
        if(!html||html.indexOf('class="wf')<0&&html.indexOf("class='wf")<0) return html;
        const d=document.createElement('div');
        d.innerHTML=html;
        d.querySelectorAll('span.wf').forEach(s=>{
            s.replaceWith(document.createTextNode(s.textContent));
        });
        d.normalize();
        return d.innerHTML;
    }

    // 조사·접속사 등 뜻이 옅은 말은 세지 않는다
    const WF_STOP=new Set([
        '그리고','그러나','하지만','그래서','또한','또는','및','등','수','것','때','더','좀','매우',
        '하다','한다','했다','합니다','입니다','이다','있다','없다','되다','된다','같다','통해','대한',
        '위해','대해','에서','에게','으로','까지','부터','보다','처럼','이런','저런','그런','어떤',
        '우리','저희','당신','자신','여기','거기','저기','오늘','내일','어제','정말','아주','너무',
        '이것','그것','저것','이때','그때','경우','가지','통한','따라','따른','관련','기타','이상','이하',
        '때문','대하','위하','그림','다음','이번','지금','모두','각각','서로','다시','먼저','또','즉',
        'the','and','for','are','but','not','you','all','any','can','has','had','was','were',
        'this','that','with','from','have','will','your','they','their','then','than','into',
        'been','when','what','which','also','more','some','such','only','over','very','just'
    ]);

    // 한글은 조사를 떼어 어간을 얻는다 (형태소 분석기 없이 쓰는 간단한 방법)
    // ※ 긴 것부터 검사해야 '으로서'가 '로'로 잘못 잘리지 않는다.
    const WF_JOSA=['으로서','으로써','에서는','에게서','이라고','라고는','까지도','부터는',
                   '에서도','에게는','으로는','이라는','에게도','으로도','만으로','라는',
                   '에서','에게','께서','으로','로서','로써','이라','까지','부터','마다',
                   '조차','밖에','처럼','보다','하고','이나','거나','와의','과의','에는','에도',
                   '의','를','을','이','가','은','는','에','도','만','로','과','와','랑'];
    // 용언 어미 (검토하였습니다 → 검토). 긴 것부터.
    const WF_VERB=['하였습니다','되었습니다','하겠습니다','되겠습니다','했습니다','합니다','됩니다',
                   '하였다','되었다','하였고','하였으며','시켰다','시키는','하려는','하려고','하면서',
                   '하기로','했지만','하지만','했었다','되어야','해야만',
                   '했다','한다','하고','하는','하며','하면','해서','해야','했던','하러','하자','하지',
                   '되는','되어','된다','됐다','되고','되며','있다','있는','없다','없는'];
    // 그 자체가 통째로 기능어인 말 (조사·어미를 떼면 껍데기만 남는 것)
    const WF_FUNC=new Set(['것이다','것이','것은','것을','수가','수는','수를','있다','없다',
        '되었습니다','하였습니다','합니다','됩니다','했습니다','이었다','이라','에서','으로']);
    function wfStem(w){
        if(!/[가-힣]/.test(w)) return wfStemEn(w);
        if(WF_FUNC.has(w)) return '';        // 통째로 버린다
        let prev=w;
        // 어미 → 조사 순으로 각 1회 (분석하였다 → 분석)
        for(let pass=0;pass<2;pass++){
            for(const v of WF_VERB){
                if(prev.length>v.length+1 && prev.endsWith(v)){ prev=prev.slice(0,-v.length); break; }
            }
            for(const j of WF_JOSA){
                if(prev.length>j.length+1 && prev.endsWith(j)){ prev=prev.slice(0,-j.length); break; }
            }
        }
        // 복수 접미사 '들' (학생들 → 학생)
        if(prev.length>2 && prev.endsWith('들')) prev=prev.slice(0,-1);
        return prev;
    }
    // 영문은 단·복수와 흔한 어미를 합쳐 같은 말로 센다 (Systems = system)
    function wfStemEn(w){
        const s=w.toLowerCase();
        if(s.length<4) return s;
        if(/[^aeiou]ies$/.test(s)) return s.slice(0,-3)+'y';   // studies → study
        if(/(s|x|z|ch|sh)es$/.test(s)) return s.slice(0,-2);   // analyses → analys
        if(/[^s]s$/.test(s)) return s.slice(0,-1);             // systems → system
        return s;
    }
    // 뜻이 옅어 세어도 의미 없는 말 (조사를 뗀 뒤에도 남는 것들)
    const WF_THIN=new Set(['것','수','때','곳','점','바','줄','things','thing','way','ways']);
    function wfValid(w){
        if(!w) return false;
        const s=w.toLowerCase();
        if(WF_STOP.has(s)||WF_THIN.has(s)) return false;
        if(/^[0-9]+$/.test(s)) return false;             // 숫자만
        if(/^[0-9]+[a-z가-힣]?$/.test(s)) return false;   // 1, 2쪽 같은 것
        if(/[가-힣]/.test(w)) return w.length>=2;         // 한글은 2글자 이상
        return /[a-z]/i.test(w) && w.length>=3;           // 영문은 3글자 이상
    }
    // 글자에서 낱말을 뽑는다 → [{raw, key, start}]
    function wfTokens(text){
        const out=[];
        const re=/[0-9A-Za-z가-힣]+/g;
        let m;
        while((m=re.exec(text))){
            const raw=m[0];
            const key=wfStem(raw).toLowerCase();
            if(wfValid(wfStem(raw))) out.push({raw,key,start:m.index,len:raw.length});
        }
        return out;
    }

    // 문서 전체를 훑어 낱말별 등장 횟수를 센다
    function wfAnalyze(){
        const count=new Map(), label=new Map();
        doc.pages.forEach(pg=>{
            (pg.els||[]).forEach(el=>{
                if(el.type!=='text') return;
                wfTokens(elPlainText(el)).forEach(t=>{
                    count.set(t.key,(count.get(t.key)||0)+1);
                    // 보여 줄 이름은 조사를 뗀 기본형 (보고서를 → 보고서)
                    if(!label.has(t.key)) label.set(t.key,wfStem(t.raw));
                });
            });
        });
        wfStats=[...count.entries()]
            .map(([k,n])=>({key:k,word:label.get(k),n}))
            .sort((a,b)=>b.n-a.n||a.word.localeCompare(b.word));
        wfMap=new Map(wfStats.map(s=>[s.key,s.n]));
        wfBuildLevels();
        return wfStats;
    }
    // 횟수 → 파랑 농도 (적으면 연하게, 많으면 진하게)
    // 등장 횟수 → 0~1 단계값.
    // 횟수만 쓰면 '5번'과 '4번'이 거의 같은 색이 되어 구분이 안 된다.
    // → 실제 존재하는 '횟수의 종류'를 줄 세워 단계를 고르게 벌린다.
    let wfLevels=[];              // [2,3,4,6,9] 처럼 오름차순
    function wfBuildLevels(){
        wfLevels=[...new Set(wfStats.filter(s=>s.n>=wfMin).map(s=>s.n))].sort((a,b)=>a-b);
    }
    function wfTone(n){
        if(!wfLevels.length) return 1;
        // 단계가 하나뿐이면 가장 진하게
        if(wfLevels.length===1) return 1;
        const i=wfLevels.indexOf(n);
        const rank=i<0?wfLevels.length-1:i;
        // 순위를 0~1 로 고르게 편다 (최저=연한 하늘, 최고=짙은 남색)
        let t=rank/(wfLevels.length-1);
        // 단계가 많으면 아래쪽이 몰려 보이므로 살짝 밀어 올려 대비를 키운다
        if(wfLevels.length>4) t=Math.pow(t,0.78);
        return t;
    }
    // 0~1 → 파랑 그라데이션.
    //  · 가장 적게 나온 말  = 아주 연한 하늘색
    //  · 가장 많이 나온 말  = 짙은 남색
    // 사이 단계도 확실히 구분되도록 밝기를 큰 폭으로 벌린다.
    // (완전한 검정까지는 가지 않아 본문 검은 글자와 구분된다)
    const WF_RAMP=[
        [0.00,[168,214,255]],   // 아주 연한 하늘
        [0.20,[109,178,250]],   // 하늘
        [0.40,[56,130,246]],    // 파랑
        [0.60,[29,86,214]],     // 진한 파랑
        [0.80,[18,48,140]],     // 감청
        [1.00,[10,22,72]]       // 짙은 남색
    ];
    function wfColor(n,max){
        const t=wfTone(n);
        let a=WF_RAMP[0], b=WF_RAMP[WF_RAMP.length-1];
        for(let i=0;i<WF_RAMP.length-1;i++){
            if(t>=WF_RAMP[i][0]&&t<=WF_RAMP[i+1][0]){ a=WF_RAMP[i]; b=WF_RAMP[i+1]; break; }
        }
        const k=(t-a[0])/Math.max(.0001,(b[0]-a[0]));
        const rgb=[0,1,2].map(i=>Math.round(a[1][i]+(b[1][i]-a[1][i])*k));
        // 굵기도 함께 5단계로 → 색과 겹쳐 차이가 더 또렷해진다
        const w = t>=.85?900 : t>=.65?800 : t>=.45?700 : t>=.22?600 : 500;
        return {c:`rgb(${rgb.join(',')})`, w, t};
    }

    function toggleWordFreq(){ wfOn?wfOff():wfRun(); }
    function wfRun(){
        if(!doc){ return; }
        commitEditingText(); deselectAll(true); clearMulti();
        wfAnalyze();
        const rep=wfStats.filter(s=>s.n>=wfMin);
        if(!wfStats.length){ toast('분석할 글자가 없습니다',2000); return; }
        wfOn=true; wfPick=null;
        document.getElementById('editorView').classList.add('wf-on');
        document.querySelectorAll('.js-wf').forEach(b=>b.classList.add('active'));
        wfPaint();
        document.getElementById('wfBar').classList.add('show');
        // 심플하게: 가장 많이 나온 말 하나만
        document.getElementById('wfInfo').innerHTML=
            `<b>${esc(wfStats[0].word)}</b> ${wfStats[0].n}번 · 낱말 ${rep.length}개`;
        if(sidePanel!=='words') openPanel('words'); else renderPanel();
    }
    function wfOff(){
        wfOn=false; wfPick=null;
        document.getElementById('editorView').classList.remove('wf-on');
        document.querySelectorAll('.js-wf').forEach(b=>b.classList.remove('active'));
        document.getElementById('wfBar').classList.remove('show');
        wfClear();
        if(sidePanel==='words') renderPanel();
    }
    // 색칠 제거 → 원래 글자 그대로 다시 그린다
    function wfClear(){
        if(!doc) return;
        // 가상화된 빈 종이까지 전부 다시 그리지 않고 현재 DOM에 있는 쪽만 복원한다.
        Array.from(renderedPages).forEach(i=>renderPageEls(i));
        maintainPageWindow(curPageIdx,true);
    }
    // 화면의 글자에만 색을 입힌다 (문서 데이터는 절대 건드리지 않음)
    function wfPaintPage(pi){
        if(!doc||!wfMap||!wfOn) return;
        const pg=doc.pages[pi]; if(!pg) return;
        const paper=paperAt(pi); if(!paper) return;
        const max=wfStats.length?wfStats[0].n:1;
        (pg.els||[]).forEach(el=>{
            if(el.type!=='text') return;
            const node=paper.querySelector(`.tb[data-id="${el.id}"] .tb-content`);
            if(!node) return;
            wfPaintNode(node,max);
        });
    }
    function wfPaint(){
        if(!doc||!wfMap) return;
        try{ activateVisiblePages(); }catch(_e){}   // 20.0 · 색칠은 글자 DOM 이 필요하다
        // 500쪽을 전부 훑지 않는다 — 지금 화면에 올라와 있는 쪽만 칠하고,
        // 나머지는 그 쪽이 다시 그려질 때(renderPageEls) 자동으로 칠해진다.
        Array.from(mountedShells.keys()).forEach(pi=>wfPaintPage(pi));
    }
    function wfPaintNode(root,max){
        const texts=[];
        const walk=(n)=>{
            for(const ch of Array.from(n.childNodes)){
                if(ch.nodeType===3){ if(ch.nodeValue.trim()) texts.push(ch); }
                else if(ch.nodeType===1 && !ch.classList.contains('wf')) walk(ch);
            }
        };
        walk(root);
        texts.forEach(tn=>{
            const text=tn.nodeValue;
            const toks=wfTokens(text).filter(t=>(wfMap.get(t.key)||0)>=wfMin);
            if(!toks.length) return;
            const frag=document.createDocumentFragment();
            let at=0;
            toks.forEach(t=>{
                if(t.start>at) frag.appendChild(document.createTextNode(text.slice(at,t.start)));
                const n=wfMap.get(t.key)||0;
                const col=wfColor(n,max);
                const s=document.createElement('span');
                s.className='wf'+(col.t>=.75?' top':col.t>=.45?' hot':'')
                            +(wfPick===t.key?' pick':'');
                s.dataset.k=t.key;
                s.style.color=col.c;
                s.style.fontWeight=col.w;
                s.title=`'${wfStats.find(x=>x.key===t.key)?.word||t.raw}' · ${n}번 나옴`;
                s.textContent=text.substr(t.start,t.len);
                frag.appendChild(s);
                at=t.start+t.len;
            });
            if(at<text.length) frag.appendChild(document.createTextNode(text.slice(at)));
            tn.parentNode.replaceChild(frag,tn);
        });
    }
    // 특정 낱말만 노랗게 집어내기
    function wfPickWord(key){
        if(!wfOn) wfRun();
        wfPick=(wfPick===key)?null:key;
        document.querySelectorAll('.wf').forEach(s=>
            s.classList.toggle('pick', !!wfPick && s.dataset.k===wfPick));
        if(sidePanel==='words') renderPanel();
        if(wfPick){
            const first=document.querySelector(`.wf.pick`);
            if(first){
                const wrap=first.closest('.page-wrap');
                const pi=wrap?+wrap.dataset.pageIdx:curPageIdx;
                goToPage(pi+1);
            }
            const s=wfStats.find(x=>x.key===wfPick);
            if(s) toast(`'${s.word}' · 문서에서 ${s.n}번 나왔습니다`,2400);
        }
    }
    // 최소 등장 횟수 조절
    function wfSetMin(v){
        wfMin=Math.max(1,Math.min(9,v));
        wfBuildLevels();
        if(wfOn){ wfClear(); wfPaint(); renderPanel(); }
        const lb=document.getElementById('wfMinLbl');
        if(lb) lb.textContent=wfMin+'번';
    }
    // ---------- 패널 ----------
    function panelWords(){
        if(!doc) return '';
        if(!wfStats.length) wfAnalyze();
        const list=wfStats.filter(s=>s.n>=wfMin);
        const max=wfStats.length?wfStats[0].n:1;
        let html=`<div class="wf-top">
                    <button class="wf-toggle${wfOn?' on':''}" onclick="toggleWordFreq()">
                      <i class="ri-${wfOn?'eye-off-line':'contrast-2-line'}"></i>${wfOn?'색칠 끄기':'색칠하기'}</button>
                    <span class="wf-min">
                      <button class="sp-mini" onclick="wfSetMin(wfMin-1)">−</button>
                      <b>${wfMin}</b>번↑
                      <button class="sp-mini" onclick="wfSetMin(wfMin+1)">＋</button>
                    </span>
                  </div>`;
        if(!list.length)
            return html+'<div class="sp-empty">여러 번 나온 낱말이 없습니다</div>';
        list.slice(0,60).forEach((s,i)=>{
            const col=wfColor(s.n,max);
            html+=`<div class="wf-item${wfPick===s.key?' on':''}" onclick="wfPickWord('${s.key}')">
                     <span class="bar" style="width:${Math.max(6,(s.n/max)*100)}%"></span>
                     <span class="wf-rank">${i+1}</span>
                     <span class="w" style="color:${col.c};font-weight:${col.w}">${esc(s.word)}</span>
                     <span class="c">${s.n}</span>
                   </div>`;
        });
        if(list.length>60) html+=`<div class="sp-item sp-dim">… 외 ${list.length-60}개</div>`;
        return html;
    }

    // ===== 표 크기 모달 (14.39.2 · 사용자 보고) =====
    // '표 삽입'을 누르면 예전엔 브라우저 prompt(크롬 알림)가 떠 UI 통일성이 깨졌다.
    // 이제 수식 넣기와 같은 앱 자체 모달(#tableSizeModal)에서 격자 미리보기와
    // 행/열 스피너로 크기를 고른다. 확인 경로는 둘이다.
    //   · 도구 막대 '표 삽입' 버튼·더보기 서랍 → 모달 → 넣기 → 고스트 배치 모드
    //   · 우클릭 '표 넣기' → 같은 모달 → 넣기 → 우클릭한 자리에 곧바로 삽입
    let tblSizeRows=3, tblSizeCols=3, tblSizeTarget=null;
    // 격자 프리셋은 8행×10열 — 그 이상은 스피너로 40행×20열(tableInsertSize 상한)까지
    const TBL_SIZE_GRID_R=8, TBL_SIZE_GRID_C=10;
    // 마우스 환경에서는 격자를 미리 보고 클릭 한 번으로 넣는다. 터치는 미리보기가
    // 없으므로 첫 탭은 고르기만 하고 '넣기'로 확정한다(1×1 오삽입 방지).
    function tblSizeCanHover(){
        try{ return typeof matchMedia==='function'&&matchMedia('(hover:hover) and (pointer:fine)').matches; }
        catch(e){ return false; }
    }
    function openTableModal(){
        // 도구 막대 경로 — 크기만 정하고 종이에서 자리를 눌러 배치한다(기존 흐름 유지).
        openTableSizeModal(null);
    }
    function openTableSizeModal(target){
        tblSizeTarget=target||null;
        tblSizeSet(3,3);
        const g=document.getElementById('tableSizeGrid');
        if(g&&!g.childElementCount){
            let h='';
            for(let r=1;r<=TBL_SIZE_GRID_R;r++) for(let c=1;c<=TBL_SIZE_GRID_C;c++)
                h+='<div class="ts-cell" data-r="'+r+'" data-c="'+c+'" role="gridcell" aria-label="'+r+'행 '+c+'열"></div>';
            g.innerHTML=h;
        }
        const m=document.getElementById('tableSizeModal');
        if(!m){ // 모달이 없는 환경(임베드 등) — 예전 흐름으로 폴백
            if(tblSizeTarget) insertTable(tblSizeRows,tblSizeCols,tblSizeTarget.pageIdx,tblSizeTarget.x,tblSizeTarget.y);
            else beginTablePlacement(tblSizeRows,tblSizeCols);
            tblSizeTarget=null; return;
        }
        m.style.display='flex';
        openNav(closeTableSizeModal);
    }
    function closeTableSizeModal(){
        const m=document.getElementById('tableSizeModal');
        if(m) m.style.display='none';
        tblSizeTarget=null;
        navDrop(closeTableSizeModal);
    }
    function tblSizeSet(r,c){
        // tableInsertSize 와 같은 상한(40행·20열) — 모달에서 고른 크기가 곧삽입 크기
        tblSizeRows=Math.max(1,Math.min(40,r|0||1));
        tblSizeCols=Math.max(1,Math.min(20,c|0||1));
        tblSizePaint();
    }
    function tblSizeStep(k,d){
        if(k==='rows') tblSizeSet(tblSizeRows+d,tblSizeCols);
        else tblSizeSet(tblSizeRows,tblSizeCols+d);
    }
    function tblSizePaint(){
        const rb=document.getElementById('tableSizeRows'),cb=document.getElementById('tableSizeCols'),
              b=document.getElementById('tableSizeBadge');
        if(rb) rb.textContent=tblSizeRows;
        if(cb) cb.textContent=tblSizeCols;
        if(b) b.textContent=tblSizeRows+' × '+tblSizeCols;
        document.querySelectorAll('#tableSizeGrid .ts-cell').forEach(n=>
            n.classList.toggle('on',+n.dataset.r<=tblSizeRows&&+n.dataset.c<=tblSizeCols));
    }
    // 격자 위를 지나며 크기를 미리 본다(마우스). 값만 바뀔 뿐 확정은 아니다.
    function tblSizeCellHover(e){
        const c=e.target.closest&&e.target.closest('.ts-cell'); if(!c) return;
        tblSizeSet(+c.dataset.r,+c.dataset.c);
    }
    // 격자를 누른 뒤 — 마우스는 미리보기를 보고 누른 것이므로 곧바로 넣고,
    // 터치는 선택만 하고 '넣기' 버튼으로 확정한다.
    function tblSizeCellClick(e){
        const c=e.target.closest&&e.target.closest('.ts-cell'); if(!c) return;
        tblSizeSet(+c.dataset.r,+c.dataset.c);
        if(tblSizeCanHover()) confirmTableSizeModal();
    }
    function confirmTableSizeModal(){
        const r=tblSizeRows,c=tblSizeCols,t=tblSizeTarget;
        closeTableSizeModal();
        if(t) insertTable(r,c,t.pageIdx,t.x,t.y);
        else beginTablePlacement(r,c);
    }
    function beginTablePlacement(rows,cols){
        const dim=tableInsertSize(rows,cols),g=document.getElementById('tableGhost');
        setTextTool(false);
        if(penActive) finishDrawing();
        cancelPlaceMode();
        tablePlace=dim;
        if(!g) return;
        g.style.setProperty('--tbl-rows',dim.rows);
        g.style.setProperty('--tbl-cols',dim.cols);
        g.style.display='block';
        const lb=document.getElementById('tableGhostLabel');
        if(lb) lb.textContent=dim.rows+' × '+dim.cols+' 표';
        document.body.classList.add('placing-table');
        const p=paperAt(curPageIdx),r=p&&p.getBoundingClientRect();
        moveTableGhost(r?r.left+r.width/2:innerWidth/2,
                       r?r.top+Math.min(r.height*.25,200):innerHeight/2);
        toast('종이에서 원하는 위치를 눌러 표를 배치하세요',2200);
    }
    function moveTableGhost(clientX,clientY){
        const g=document.getElementById('tableGhost'); if(!g||!tablePlace) return;
        // 포인터 아래 종이의 실제 화면 배율을 사용한다. 브라우저 90% zoom이나
        // 사용자 확대 상태에서도 클릭 후 만들어지는 표와 픽셀 단위로 일치한다.
        // ★ r.left/k 와 sc.x 의 /k 는 viewport px → CSS px 변환에 필수.
        //   자세한 원리는 moveTextGhost 주석 참조.
        const hit=typeof document.elementFromPoint==='function'
            ?document.elementFromPoint(clientX,clientY):null;
        const paper=(hit&&hit.closest&&hit.closest('.paper'))||paperAt(curPageIdx);
        if(!paper) return;
        const pi=+paper.dataset.pageIdx;
        const p=pageLocal({clientX,clientY},pi);
        const origin=clampTableOrigin(tablePlace,p.x-tablePlace.w/2,p.y-tablePlace.h/2);
        const r=paper.getBoundingClientRect(),sc=uiPageScale(pi),k=uiCssZoom();
        g.style.width=Math.round(tablePlace.w*sc.x)+'px';
        g.style.height=Math.round(tablePlace.h*sc.y)+'px';
        // 종이 원점(화면 px)도 고스트가 쓰는 CSS px 로 바꾼 뒤 문서 좌표를 더한다.
        g.style.left=Math.round(r.left/k+origin.x*sc.x)+'px';
        g.style.top=Math.round(r.top/k+origin.y*sc.y)+'px';
        g.dataset.pageIdx=String(pi);
    }
    // 텍스트 상자 고스트 — '눌렀을 때 실제로 생길 자리'를 그대로 미리 보인다.
    // 삽입 경로(pageLocal → clampEl → addTextBox)와 같은 계산을 쓰기 때문에
    // 배율이 몇 %이든, 커서가 종이 어디에 있든 고스트 = 만들어질 상자 다.
    // 예전엔 커서 clientX 를 곧장 style.left 에 넣고 화면 가장자리로 clamp 해서
    //  · 사이트 기본 배율(90%) 만큼 커서에서 어긋나고
    //  · 확대가 클수록 화면 끝에서 고스트만 안으로 밀려
    // 만들어진 상자와 고스트가 서로 다른 자리에 있었다.
    //
    // ★ 좌표 변환 원리 (moveTableGhost, movePlaceGhost 도 동일):
    //   r.left          = 종이 좌상단의 viewport px
    //   o.x             = 문서 px (pageLocal → clampEl 결과)
    //   sc.x            = 문서 px → CSS px 배율 = (r.width/s.w) / k
    //   r.left / k      = 종이 좌상단의 CSS px  ← ★ /k 필수!
    //   o.x * sc.x      = 문서 px → CSS px 변환
    //   합계             = 고스트의 style.left (CSS px)
    //
    //   /k 를 빼면 r.left 가 viewport px 채로 style.left 에 들어가서
    //   html{zoom:.9} 에서 고스트가 커서보다 ≈11% 오른쪽으로 밀린다.
    //   종이 안의 실제 요소는 종이 좌표를 쓰므로 /k 가 필요 없다 —
    //  둘 다 최종 화면 위치는 같다.
    function moveTextGhost(clientX,clientY){
        const g=document.getElementById('textGhost'); if(!g||!textToolActive) return;
        const hit=typeof document.elementFromPoint==='function'
            ?document.elementFromPoint(clientX,clientY):null;
        const over=hit&&hit.closest&&hit.closest('.paper');
        const paper=over||paperAt(curPageIdx);
        if(!paper) return;
        const pi=+paper.dataset.pageIdx, s=paperSize();
        // 종이 밖(도구막대 위 등)에서는 지금 쪽 위쪽 중앙에 '준비' 미리보기를 둔다.
        const p=over?pageLocal({clientX,clientY},pi):{x:s.w/2,y:Math.min(s.h*.22,180)};
        const dim=textBoxDefaultSize();
        const o=clampEl(p.x-dim.w/2,p.y-dim.h/2,dim.w,dim.h);
        const r=paper.getBoundingClientRect(),sc=uiPageScale(pi),k=uiCssZoom();
        g.style.width=Math.round(dim.w*sc.x)+'px';
        g.style.height=Math.round(dim.h*sc.y)+'px';
        const c=g.querySelector('.tg-caret');
        if(c) c.style.height=Math.round((curFontSize*1.4)*sc.y)+'px';
        g.style.left=Math.round(r.left/k+o.x*sc.x)+'px';
        g.style.top=Math.round(r.top/k+o.y*sc.y)+'px';
        g.dataset.pageIdx=String(pi);
    }
    function cancelTablePlacement(){
        tablePlace=null;
        const g=document.getElementById('tableGhost'); if(g) g.style.display='none';
        document.body.classList.remove('placing-table');
    }


/* APP-PART:09-tools-ui.js:END */
