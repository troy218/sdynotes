/* === src/app/12e-ai-ops.js ===
   해돌이 배치·쪽/@명령·문서브릿지
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:12e-ai-ops.js:BEGIN */
    // ── 14.27.0 · 사람이 보기 좋은 배치 ────────────────────────────────
    // 모델이 준 좌표를 그대로 쓰면 상자마다 왼쪽 끝이 다르고 서로 겹친다.
    // 그래서 ① 8px 격자에 맞추고 ② 이웃·본문 왼쪽 끝에 붙이고 ③ 새 요소는
    // 겹치지 않는 첫 빈자리로 내린다. 명시 좌표(@mv·@bx)는 ①·②만 적용해
    // '옮겨 달라'는 요청을勝手に 뒤집지 않는다.
    const AI_GRID=8, AI_EDGE=28, AI_GAP=12, AI_MARGIN=40;
    /* 14.31.0 · 펜 그림 기본 크기 — 예전엔 본문 폭의 62%로 그려 "그림이 너무
       크다"는 말이 많았다. 이제 본문 폭의 40% · 최대 320px · 높이 360px 로
       담백하게 잡는다(요청에 크기가 있으면 그 값을 쓴다). */
    const AI_DRAW_W_RATIO=0.40, AI_DRAW_MAX_W=320, AI_DRAW_MIN_W=150, AI_DRAW_MAX_H=360;
    // 쪽에서 자리를 차지하는 상자들(표 테두리 획은 표 상자로 한 번만 센다).
    function aiEditOccupied(pi,skipId){
        const out=[];
        const pg=doc&&doc.pages&&doc.pages[pi];
        if(!pg) return out;
        (pg.els||[]).forEach(el=>{
            if(!el||el.id===skipId) return;
            if(el.type==='stroke'&&el.tbl) return;
            const b=aiEditBox(el);
            if(b.w>0||b.h>0) out.push({x:b.x,y:b.y,w:b.w,h:b.h,id:el.id});
        });
        (pg.tables||[]).forEach(t=>{
            if(!t||t.id===skipId) return;
            const s=tblSize(t);
            out.push({x:+t.x||0,y:+t.y||0,w:s.w,h:s.h,id:t.id});
        });
        return out;
    }
    const aiEditHits=(a,b,pad)=>a.x<b.x+b.w+pad&&b.x<a.x+a.w+pad
        &&a.y<b.y+b.h+pad&&b.y<a.y+a.h+pad;
    // 본문이 쓰는 왼쪽 끝·너비 — 새 상자를 이 값에 맞춘다(문서가 정돈돼 보인다).
    function aiEditMargins(pi){
        const boxes=aiEditOccupied(pi).filter(b=>b.w>10&&b.h>6);
        const count=(list,key)=>{
            const map={};
            list.forEach(b=>{ const k=Math.round(b[key]/AI_GRID)*AI_GRID; map[k]=(map[k]||0)+1; });
            let best=null,n=0;
            for(const k in map){ if(map[k]>n){ n=map[k]; best=+k; } }
            return best;
        };
        const texts=boxes.filter(b=>b.w<aiEditPageSize().w-8);
        return {
            left:count(texts.length?texts:boxes,'x'),
            width:count(texts,'w'),
            top:boxes.length?Math.min.apply(null,boxes.map(b=>b.y)):AI_MARGIN,
        };
    }
    const aiEditPageSize=()=>paperSize();
    // 겹치지 않는 첫 빈자리 — 위부터 훑고, 왼쪽 끝 → 가운데 → 오른쪽 순으로 본다.
    function aiEditFreeSpot(pi,w,h,startY){
        const size=aiEditPageSize();
        const m=aiEditMargins(pi);
        const list=aiEditOccupied(pi);
        const left=m.left==null?AI_MARGIN:Math.min(m.left,Math.max(0,size.w-w));
        // 후보 자리도 격자에 맞춘다 — 본문 왼쪽 끝 → 가운데 → 오른쪽 순.
        // 왼쪽 줄을 먼저 훑어야 새 상자가 본문과 왼쪽이 맞아 정돈돼 보인다.
        const xs=[left,Math.round(Math.max(0,size.w-w)/2),Math.max(0,size.w-w-left)]
            .map(v=>Math.max(0,Math.min(Math.round(v/AI_GRID)*AI_GRID,Math.max(0,size.w-w))));
        const yEnd=Math.max(AI_MARGIN,Math.round(size.h-h));
        const y0=Math.max(AI_MARGIN,Math.min(Math.round(+startY)||AI_MARGIN,yEnd));
        const scan=(from,to)=>{
            for(let i=0;i<xs.length;i++){
                for(let y=from;y<=to;y+=AI_GRID){
                    const box={x:xs[i],y:y,w:w,h:h};
                    if(!list.some(o=>aiEditHits(box,o,AI_GAP))) return box;
                }
            }
            return null;
        };
        // 요청한 높이부터 아래로 훑고, 없으면 페이지 맨 위부터 다시 본다.
        const hit=scan(y0,yEnd)||scan(AI_MARGIN,yEnd);
        if(hit) return hit;
        // 빈자리가 없으면 맨 아래 내용 밑에 둔다(그래도 페이지 안).
        let bottom=AI_MARGIN;
        list.forEach(o=>{ bottom=Math.max(bottom,o.y+o.h+AI_GAP); });
        return {x:left,y:Math.max(AI_MARGIN,Math.min(bottom,yEnd)),w:w,h:h};
    }
    // 격자·왼쪽 끝 맞추기(+ 필요하면 겹침 피하기). 페이지 밖으로 나가지 않는다.
    function aiEditNeat(pi,x,y,w,h,opt){
        const size=aiEditPageSize();
        const o=opt||{};
        const d={w:Math.max(20,Math.min(Math.round(w),size.w)),
                 h:Math.max(20,Math.min(Math.round(h),size.h))};
        const m=aiEditMargins(pi);
        let nx=Math.round(+x||0),ny=Math.round(+y||0);
        // 격자는 새 요소에만 — '그 좌표로 옮겨 달라'는 요청은 좌표를 존중한다.
        if(o.snap){
            nx=Math.round(nx/AI_GRID)*AI_GRID;
            ny=Math.round(ny/AI_GRID)*AI_GRID;
        }
        if(o.align!==false&&m.left!=null&&Math.abs(nx-m.left)<=AI_EDGE) nx=m.left;
        let box={x:nx,y:ny,w:d.w,h:d.h};
        if(o.avoid){
            const list=aiEditOccupied(pi,o.skipId);
            let guard=0;
            while(list.some(ob=>aiEditHits(box,ob,AI_GAP))&&guard++<400){
                const clash=list.filter(ob=>aiEditHits(box,ob,AI_GAP));
                const below=Math.min.apply(null,clash.map(ob=>ob.y+ob.h+AI_GAP));
                const ny2=Math.round(below/AI_GRID)*AI_GRID;
                if(ny2<=box.y||ny2+d.h>size.h) break;
                box={x:box.x,y:ny2,w:d.w,h:d.h};
            }
        }
        box.x=Math.max(0,Math.min(box.x,Math.max(0,size.w-box.w)));
        box.y=Math.max(0,Math.min(box.y,Math.max(0,size.h-box.h)));
        return box;
    }
    // 새 상자의 높이 어림 — 글이 상자 밖으로 새는 게 제일 보기 나쁘다.
    // 한글은 1자, 영숫자는 0.55자 폭으로 세고 줄 간격 1.5 + 위아래 여백을 더한다.
    function aiEditGuessH(text,w,fontSize){
        const size=aiEditPageSize();
        const fs=Math.max(8,Math.min(200,+fontSize||16));
        const bw=Math.max(40,Math.min(+w||size.w-2*AI_MARGIN,size.w-8))-16;
        const perLine=Math.max(4,Math.floor(bw/fs));
        let lines=0;
        String(text==null?'':text).split('\n').forEach(line=>{
            let units=0;
            for(const ch of line){
                units+=/[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(ch)?1:0.55;
            }
            lines+=Math.max(1,Math.ceil(units/perLine));
        });
        return Math.max(28,Math.min(size.h-8,Math.round(lines*fs*1.5+18)));
    }
    const aiEditIsAuto=v=>{
        const s=String(v==null?'':v).trim().toLowerCase();
        return s==='auto'||s==='자동'||s==='알아서'||s==='-'||s==='*'||s==='?';
    };
    // @goto·@newpage 뒤 화면 이동 — addPage와 같은 규칙(교체된 노트면 무시).
    function aiEditScrollToPage(pi){
        try{
            const d=doc,_pi=pi;
            setTimeout(()=>{
                if(doc!==d||!curNB) return;
                // AI가 먼 쪽으로 이동해도 중간 페이지를 연쇄 로드하지 않는다(즉시 이동).
                try{ maintainPageWindow(_pi,true); }catch(e){}
                try{ scrollPageIntoView(_pi,'auto'); }catch(e){}
            },60);
        }catch(e){}
    }
    function aiEditApply(ops,expectedRevision){
        const res={applied:0,failed:0,notes:[],stale:false};
        const note=msg=>{ if(msg&&res.notes.length<4&&res.notes.indexOf(msg)<0) res.notes.push(msg); };
        const bad=msg=>{ res.failed++; note(msg); };
        if(!doc||!curNB){ bad('열린 노트가 없어요'); return res; }
        if(!Array.isArray(ops)||!ops.length) return res;
        // 모델을 기다리는 동안 사용자가 타이핑한 글도 먼저 doc에 반영한 뒤 비교한다.
        try{ commitEditingText(); }catch(e){}
        if(expectedRevision&&expectedRevision!==aiEditRevision()){
            res.stale=true;
            note('기다리는 동안 문서가 바뀌어서 오래된 편집 계획은 적용하지 않았어요 · 다시 요청해 주세요');
            return res;
        }
        const size=paperSize();
        const finite=v=>v!==''&&v!=null&&Number.isFinite(Number(v));
        const round=v=>Math.round(Number(v));
        const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
        const text=v=>String(v==null?'':v).slice(0,AI_EDIT_MAX_TEXT);
        const html=v=>esc(text(v)).replace(/\n/g,'<br>');
        const findAny=id=>{
            id=String(id||'').trim();
            if(!id) return null;
            for(let pi=0;pi<doc.pages.length;pi++){
                const pg=doc.pages[pi]; if(!pg||pg.__lazy!=null) continue;
                const el=(pg.els||[]).find(item=>item&&item.id===id);
                if(el) return {el,pi};
            }
            return null;
        };
        const findTblAny=tid=>{
            tid=String(tid||'').trim();
            if(!tid) return null;
            for(let pi=0;pi<doc.pages.length;pi++){
                const pg=doc.pages[pi]; if(!pg||pg.__lazy!=null) continue;
                const t=(pg.tables||[]).find(item=>item&&item.id===tid);
                if(t) return {t,pi};
            }
            return null;
        };
        const touched=new Set(); let historyStarted=false;
        const beforeChange=()=>{
            if(historyStarted) return;
            // 첫 유효 명령이 확인된 뒤에만 선택을 접고 undo 지점을 만든다.
            // 전부 잘못된 계획은 사용자의 편집 상태조차 건드리지 않는다.
            try{ deselectAll(true); clearMulti(); selected=null; }catch(e){}
            pushHistory(true); historyStarted=true;
        };
        const boxSize=(w,h)=>({
            w:clamp(round(w),20,Math.max(20,size.w)),
            h:clamp(round(h),20,Math.max(20,size.h)),
        });
        // 좌표 다듬기. 새 요소(opt.snap·opt.avoid)는 격자에 맞추고 겹치지 않는
        // 자리로 내린다. 옮기기(@mv·@bx)는 '그 자리로 옮겨 달라'는 요청이라
        // 격자까지는 씌우지 않고 본문 왼쪽 끝과 가까울 때만 붙인다.
        const place=(x,y,w,h,opt)=>{
            const d=boxSize(w,h);
            const o=opt||{};
            const pi=(o.pi==null)?(curPageIdx|0):o.pi;
            if(o.neat===false)
                return {x:clamp(round(x),0,Math.max(0,size.w-d.w)),
                    y:clamp(round(y),0,Math.max(0,size.h-d.h)),w:d.w,h:d.h};
            return aiEditNeat(pi,x,y,d.w,d.h,{snap:!!o.snap,avoid:!!o.avoid,
                align:o.align!==false,skipId:o.skipId});
        };
        // 표 전체 삭제 — 칸·테두리 획까지 함께 지운다(@del·@tdel 모두).
        const dropTable=tf=>{
            beforeChange();
            doc.pages[tf.pi].tables=(doc.pages[tf.pi].tables||[]).filter(x=>x!==tf.t);
            doc.pages[tf.pi].els=(doc.pages[tf.pi].els||[])
                .filter(e=>!(e&&e.tbl&&e.tbl.tid===tf.t.id));
            try{ clearActiveTbl(); }catch(e){}
            touched.add(tf.pi);
            try{ if(renderedPages.has(tf.pi)) renderTblDivs(tf.pi); }catch(e){}
        };
        const limited=ops.slice(0,AI_EDIT_MAX_OPS);
        if(ops.length>AI_EDIT_MAX_OPS){
            res.failed+=ops.length-AI_EDIT_MAX_OPS;
            note('명령이 많아 앞의 '+AI_EDIT_MAX_OPS+'개만 확인했어요');
        }
        limited.forEach(op=>{
            const cmd=String(op&&op.cmd||'').toLowerCase();
            // ── 쪽·제목·표 — 요소 id 없이 쪽 단위로 돈다 ──
            if(cmd==='goto'){
                if(!finite(op.page)||!Number.isInteger(Number(op.page))){
                    bad('이동할 쪽 번호가 올바르지 않아요'); return;
                }
                const page=round(op.page);
                if(page<1||page>doc.pages.length){
                    bad('그런 쪽은 없어요 · 총 '+doc.pages.length+'쪽이에요'); return;
                }
                // 화면만 옮긴다 — 문서·undo에 손대지 않는다.
                curPageIdx=page-1;
                try{ updatePageInfo(); }catch(e){}
                aiEditScrollToPage(page-1);
                res.applied++; return;
            }
            if(cmd==='newpage'){
                if(doc.pages.length>=200){ bad('쪽이 너무 많아 더 만들지 않았어요'); return; }
                beforeChange();
                doc.pages.push(blankPage());
                curPageIdx=doc.pages.length-1;
                try{ updatePageInfo(); }catch(e){}
                try{ renderPages(); }catch(e){}
                aiEditScrollToPage(curPageIdx);
                touched.add(curPageIdx); res.applied++; return;
            }
            // 14.27.0 · @tidy — 쪽을 보기 좋게 정돈한다. ① 8px 격자에 맞추고
            //   ② 본문 왼쪽 끝에 가까운 상자는 그 끝에 붙이고 ③ 절반 넘게
            //   겹친 상자만 아래로 내린다(나란히 세운 두 칸은 건드리지 않는다).
            if(cmd==='tidy'){
                let tpi=curPageIdx|0;
                if(finite(op.page)){
                    if(!Number.isInteger(Number(op.page))){
                        bad('정돈할 쪽 번호가 올바르지 않아요'); return;
                    }
                    tpi=round(op.page)-1;
                }
                const tpg=doc.pages[tpi];
                if(tpi<0||tpi>=doc.pages.length||!tpg||tpg.__lazy!=null){
                    bad('그 쪽을 찾거나 불러오지 못했어요'); return;
                }
                const tleft=(aiEditMargins(tpi).left);
                const margin=tleft==null?AI_MARGIN:tleft;
                const items=[];
                (tpg.els||[]).forEach(el=>{
                    if(!el||el.locked||el.tbl) return;
                    if(!['text','image','latex','stroke'].includes(el.type)) return;
                    const b=aiEditBox(el);
                    if(b.w<=0&&b.h<=0) return;
                    let nx=Math.round(b.x/AI_GRID)*AI_GRID,ny=Math.round(b.y/AI_GRID)*AI_GRID;
                    if(Math.abs(nx-margin)<=Math.round(AI_EDGE*1.5)) nx=margin;
                    nx=clamp(nx,0,Math.max(0,size.w-Math.round(b.w)));
                    ny=clamp(ny,0,Math.max(0,size.h-Math.round(b.h)));
                    items.push({el:el,base:b,box:{x:nx,y:ny,w:b.w,h:b.h}});
                });
                items.sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x);
                const placed=[];
                items.forEach(item=>{
                    let guard=0;
                    for(;;){
                        const clash=placed.find(o=>{
                            if(!aiEditHits(item.box,o.box,AI_GAP/2)) return false;
                            const ow=Math.min(item.box.x+item.box.w,o.box.x+o.box.w)
                                -Math.max(item.box.x,o.box.x);
                            const oh=Math.min(item.box.y+item.box.h,o.box.y+o.box.h)
                                -Math.max(item.box.y,o.box.y);
                            return ow*oh>0.5*Math.min(item.box.w*item.box.h,o.box.w*o.box.h);
                        });
                        if(!clash||guard++>60) break;
                        const below=Math.round((clash.box.y+clash.box.h+AI_GAP)/AI_GRID)*AI_GRID;
                        if(below<=item.box.y) break;
                        item.box.y=Math.min(below,Math.max(0,size.h-Math.round(item.box.h)));
                    }
                    placed.push(item);
                });
                const moves=items.filter(item=>Math.round(item.base.x)!==item.box.x
                    ||Math.round(item.base.y)!==item.box.y);
                // 표도 같은 규칙으로(칸은 rebuildTable이 따라온다).
                const tbls=[];
                (tpg.tables||[]).forEach(t=>{
                    if(!t||!Array.isArray(t.cw)||!Array.isArray(t.ch)) return;
                    const ts=tblSize(t);
                    let nx=Math.round((+t.x||0)/AI_GRID)*AI_GRID;
                    if(Math.abs(nx-margin)<=Math.round(AI_EDGE*1.5)) nx=margin;
                    nx=clamp(nx,0,Math.max(0,size.w-ts.w));
                    const ny=clamp(Math.round((+t.y||0)/AI_GRID)*AI_GRID,
                        0,Math.max(0,size.h-ts.h));
                    if(Math.round(+t.x||0)!==nx||Math.round(+t.y||0)!==ny)
                        tbls.push({t:t,x:nx,y:ny});
                });
                if(!moves.length&&!tbls.length){ bad('이미 정돈돼 있어요'); return; }
                beforeChange();
                moves.forEach(item=>{
                    if(item.el.type==='stroke'){
                        item.el.dx=item.box.x-item.base.baseX;
                        item.el.dy=item.box.y-item.base.baseY;
                    }else{ item.el.x=item.box.x; item.el.y=item.box.y; }
                });
                tbls.forEach(item=>{
                    item.t.x=item.x; item.t.y=item.y;
                    try{ rebuildTable(tpi,item.t.id,{quiet:true}); }catch(e){}
                });
                if(tbls.length){ try{ if(renderedPages.has(tpi)) renderTblDivs(tpi); }catch(e){} }
                touched.add(tpi); res.applied++; return;
            }
            if(cmd==='title'){
                const t=text(op.text).replace(/\s+/g,' ').trim().slice(0,100);
                if(!t){ bad('노트 제목이 비어 있어요'); return; }
                const input=document.getElementById('edTitle');
                if(!input){ bad('제목 입력칸을 찾지 못했어요'); return; }
                // 기존 change 리스너가 노트 이름 저장·동기화를 맡는다.
                input.value=t;
                try{ input.dispatchEvent(new Event('change',{bubbles:true})); }
                catch(e){ try{ if(curNB){ curNB.title=t; queueSync(curNB.id); } }catch(e2){} }
                res.applied++; return;
            }
            if(cmd==='tbl'){
                const posOk=v=>finite(v)||aiEditIsAuto(v);
                if(!finite(op.page)||!Number.isInteger(Number(op.page))
                   ||!posOk(op.x)||!posOk(op.y)||!finite(op.rows)||!finite(op.cols)){
                    bad('표를 만들 위치나 크기가 올바르지 않아요'); return;
                }
                const page=round(op.page),pi=page-1,pg=doc.pages[pi];
                if(page<1||page>doc.pages.length||!pg||pg.__lazy!=null){
                    bad('해당 페이지를 찾거나 불러오지 못했어요'); return;
                }
                const body=String(op.text==null?'':op.text).slice(0,8000);
                const grid=body.split('\n').map(line=>line.split('|').map(c=>c.trim()));
                // 내용이 선언보다 많으면 행·열을 자동으로 늘린다.
                let rows=Math.max(clamp(Math.round(Number(op.rows)),1,20),
                    Math.min(20,grid.filter(r=>r.some(c=>c)).length||0));
                let cols=clamp(Math.round(Number(op.cols)),1,12);
                grid.forEach(r=>{ cols=Math.max(cols,Math.min(12,r.length)); });
                rows=Math.max(1,rows); cols=Math.max(1,cols);
                // 칸 글 길이에 맞춰 너비·높이를 어림잡는다.
                const cw=[],ch=[];
                for(let c=0;c<cols;c++){
                    let mx=0;
                    for(let r=0;r<rows;r++) mx=Math.max(mx,(((grid[r]||[])[c])||'').length);
                    cw.push(clamp(60+mx*9,60,260));
                }
                for(let r=0;r<rows;r++){
                    let mx=0;
                    for(let c=0;c<cols;c++) mx=Math.max(mx,(((grid[r]||[])[c])||'').length);
                    ch.push(mx>28?60:40);
                }
                let tw=cw.reduce((a,b)=>a+b,0),th=ch.reduce((a,b)=>a+b,0);
                const maxW=Math.max(120,size.w-16),maxH=Math.max(80,size.h-16);
                if(tw>maxW){ const k=maxW/tw; for(let i=0;i<cw.length;i++) cw[i]=Math.max(TBL_MINW,Math.round(cw[i]*k)); tw=cw.reduce((a,b)=>a+b,0); }
                if(th>maxH){ const k=maxH/th; for(let i=0;i<ch.length;i++) ch[i]=Math.max(TBL_MINH,Math.round(ch[i]*k)); th=ch.reduce((a,b)=>a+b,0); }
                // 14.27.0 · auto면 겹치지 않는 빈자리를 고르고, 좌표를 주면
                // 격자·본문 왼쪽 끝에 맞춰 정돈된 자리에 둔다.
                let ox,oy;
                if(aiEditIsAuto(op.x)||aiEditIsAuto(op.y)){
                    const spot=aiEditFreeSpot(pi,tw,th,aiEditIsAuto(op.y)?0:round(op.y));
                    ox=spot.x; oy=spot.y;
                }else{
                    const neat=aiEditNeat(pi,clamp(round(op.x),8,Math.max(8,size.w-tw-8)),
                        clamp(round(op.y),8,Math.max(8,size.h-th-8)),tw,th,{snap:true,avoid:false});
                    ox=neat.x; oy=neat.y;
                }
                beforeChange();
                if(!Array.isArray(pg.tables)) pg.tables=[];
                const tid='tb_'+Math.random().toString(36).slice(2,9);
                pg.tables.push({id:tid,x:ox,y:oy,cw:cw.slice(),ch:ch.slice(),
                    color:'#9aa1ab',lw:1.2,group:'g_'+tid});
                try{ rebuildTable(pi,tid,{quiet:true}); }
                catch(e){
                    pg.tables=pg.tables.filter(t=>t.id!==tid);
                    bad('표를 만들지 못했어요'); return;
                }
                const list=doc.pages[pi].els||[];
                for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
                    const v=(((grid[r]||[])[c])||'').slice(0,500);
                    if(!v) continue;
                    const cell=list.find(e=>e&&e.type==='text'&&e.tbl
                        &&e.tbl.tid===tid&&e.tbl.r===r&&e.tbl.c===c);
                    if(cell) cell.html=aiMdToHtml(v,cell.fontSize||16);   // 14.29.2 · 칸 안의 **굵게**·$수식$
                }
                touched.add(pi);
                try{ if(renderedPages.has(pi)) renderTblDivs(pi); }catch(e){}
                res.applied++; return;
            }
            if(cmd==='tsz'||cmd==='tmv'){
                const tf=findTblAny(op&&op.id);
                if(!tf){ bad('그런 표를 찾지 못했어요'); return; }
                if(cmd==='tsz'&&(!finite(op.w)||!finite(op.h))){
                    bad('표 크기가 올바르지 않아요'); return;
                }
                if(cmd==='tmv'&&(!finite(op.x)||!finite(op.y))){
                    bad('표 위치가 올바르지 않아요'); return;
                }
                beforeChange();
                if(cmd==='tsz'){
                    const old=tblSize(tf.t);
                    if(old.w<1||old.h<1){ bad('표 크기를 읽지 못했어요'); return; }
                    const kw=clamp(round(op.w),40,size.w)/old.w;
                    const kh=clamp(round(op.h),20,size.h)/old.h;
                    tf.t.cw=tf.t.cw.map(v=>Math.max(TBL_MINW,Math.round(v*kw)));
                    tf.t.ch=tf.t.ch.map(v=>Math.max(TBL_MINH,Math.round(v*kh)));
                }else{
                    const s=tblSize(tf.t);
                    tf.t.x=clamp(round(op.x),0,Math.max(0,size.w-s.w));
                    tf.t.y=clamp(round(op.y),0,Math.max(0,size.h-s.h));
                }
                const now=tblSize(tf.t);
                tf.t.x=clamp(Math.round(tf.t.x),0,Math.max(0,size.w-now.w));
                tf.t.y=clamp(Math.round(tf.t.y),0,Math.max(0,size.h-now.h));
                try{ rebuildTable(tf.pi,tf.t.id,{quiet:true}); }catch(e){}
                touched.add(tf.pi);
                try{ if(renderedPages.has(tf.pi)) renderTblDivs(tf.pi); }catch(e){}
                res.applied++; return;
            }
            if(cmd==='tcell'){
                const tf=findTblAny(op&&op.id);
                if(!tf){ bad('그런 표를 찾지 못했어요'); return; }
                if(!finite(op.r)||!finite(op.c)
                   ||!Number.isInteger(Number(op.r))||!Number.isInteger(Number(op.c))){
                    bad('표 칸 위치가 올바르지 않아요'); return;
                }
                const r=round(op.r)-1,c=round(op.c)-1;
                if(r<0||c<0||r>=tf.t.ch.length||c>=tf.t.cw.length){
                    bad('표에 그런 칸은 없어요'); return;
                }
                const cell=(doc.pages[tf.pi].els||[]).find(e=>e&&e.type==='text'
                    &&e.tbl&&e.tbl.tid===tf.t.id&&e.tbl.r===r&&e.tbl.c===c);
                if(!cell){ bad('표 칸을 찾지 못했어요'); return; }
                if(cell.locked){ bad('잠긴 요소는 고칠 수 없어요'); return; }
                beforeChange();
                cell.html=aiMdToHtml(text(op.text),cell.fontSize||16);   // 14.29.2
                delete cell.fit; delete cell.fitDown; delete cell.trFS; delete cell.trLS; delete cell.trFW;
                touched.add(tf.pi); res.applied++; return;
            }
            if(cmd==='add'){
                const numOk=v=>finite(v)||aiEditIsAuto(v);
                if(!finite(op.page)||!Number.isInteger(Number(op.page))
                   ||!numOk(op.x)||!numOk(op.y)||!numOk(op.w)||!numOk(op.h)){
                    bad('새 글상자의 페이지나 위치가 올바르지 않아요'); return;
                }
                const page=round(op.page),pi=page-1,pg=doc.pages[pi];
                if(page<1||page>doc.pages.length||!pg||pg.__lazy!=null){
                    bad('해당 페이지를 찾거나 불러오지 못했어요'); return;
                }
                if(!text(op.text).trim()){ bad('내용이 없는 새 글상자는 만들지 않았어요'); return; }
                // ~id 가 있으면 그 상자의 글꼴·서식을 물려받아 이웃과 어울리게 한다.
                let font=curFont||'pretendard',fontSize=curFontSize||16,styleSrc=null;
                if(op.inherit){
                    const src=findAny(op.inherit);
                    if(src&&src.el&&src.el.type==='text'){
                        font=src.el.font||font; fontSize=src.el.fontSize||fontSize;
                        styleSrc=src.el;
                    }
                }
                // 14.27.0 · auto 크기·자리 — 본문 너비를 따르고, 글이 넘치지
                // 않을 만큼 높이를 잡은 뒤 겹치지 않는 첫 빈자리에 둔다.
                const body=aiMdPlain(text(op.text));
                const mg=aiEditMargins(pi);
                const wide=Math.max(120,Math.min(size.w-2*AI_MARGIN,
                    (mg.width&&mg.width>=120)?mg.width:(size.w-2*AI_MARGIN)));
                const bw=aiEditIsAuto(op.w)?wide:clamp(round(op.w),20,size.w);
                const guess=aiEditGuessH(body,bw,fontSize)+aiMdTitleExtra(text(op.text),fontSize);
                const bh=clamp(aiEditIsAuto(op.h)?guess
                    :Math.max(round(op.h),guess),20,size.h);
                let p;
                if(aiEditIsAuto(op.x)||aiEditIsAuto(op.y)){
                    p=aiEditFreeSpot(pi,bw,bh,aiEditIsAuto(op.y)?0:round(op.y));
                    p.w=bw; p.h=bh;
                }else p=place(op.x,op.y,bw,bh,{pi:pi,snap:true,avoid:true});
                beforeChange(); pg.els=pg.els||[];
                const body0=text(op.text);
                // 14.29.2 · 제목과 본문을 상자 안에서 갈라 쓴다.
                //   · 글 전체가 제목 한 줄이면 → 상자째 크게·굵게(가운데)
                //   · 제목+본문이 섞여 오면 → 제목 줄만 크게·굵게, 본문은 보통 굵기
                //   · **중요어** 는 그 낱말만 굵게, 문장 안 $수식$ 은 인라인 수식으로
                const rich=aiMdBox(body0,fontSize);
                let useHtml=rich.html, useFs=fontSize, useFont=font,
                    useAlign=rich.align||null, useBold=!!rich.bold;
                if(rich.level) useFs=rich.fs;
                else if(pg.els.length===0&&pi===0&&body0.length<=60&&body0.indexOf('\n')<0
                        &&p.y<=AI_MARGIN+AI_GRID+1){
                    // 첫 쪽 맨 위 짧은 한 줄 = 노트 제목으로 본다(예전 규칙 유지)
                    useHtml='<b>'+aiMdInline(body0)+'</b>';
                    useFs=28; useBold=true; useAlign='center';
                }
                const nel={type:'text',id:uid('t'),x:p.x,y:p.y,w:p.w,h:p.h,
                    html:useHtml,fontSize:useFs,font:useFont};
                if(useAlign) nel.align=useAlign;
                if(useBold) nel.fontWeight='700';

                if(styleSrc){
                    if(styleSrc.align) nel.align=styleSrc.align;
                    if(styleSrc.textColor) nel.textColor=styleSrc.textColor;
                    if(styleSrc.cellBg) nel.cellBg=styleSrc.cellBg;
                    // 14.29.2 · 본문 상자는 이웃의 '굵게'까지 물려받지 않는다 —
                    //   제목 옆에 쓴 본문이 통째로 굵어져 제목과 안 구분되던 문제.
                    if(styleSrc.fontWeight&&(rich.level||useBold)) nel.fontWeight=styleSrc.fontWeight;
                    if(styleSrc.fontStyle) nel.fontStyle=styleSrc.fontStyle;
                    if(styleSrc.textDecoration) nel.textDecoration=styleSrc.textDecoration;
                }
                pg.els.push(nel);
                touched.add(pi); res.applied++; return;
            }
            // @math — 새 수식(LaTeX) 상자
            if(cmd==='math'||cmd==='ltx'||cmd==='formula'){
                const numOkM=v=>finite(v)||aiEditIsAuto(v);
                if(!finite(op.page)||!Number.isInteger(Number(op.page))
                   ||!numOkM(op.x)||!numOkM(op.y)||!numOkM(op.w)||!numOkM(op.h)){
                    bad('새 수식의 페이지나 위치가 올바르지 않아요'); return;
                }
                const page=round(op.page),pi=page-1,pg=doc.pages[pi];
                if(page<1||page>doc.pages.length||!pg||pg.__lazy!=null){
                    bad('해당 페이지를 찾거나 불러오지 못했어요'); return;
                }
                const latex=String(op.latex==null?'':op.latex).trim().slice(0,2000);
                if(!latex){ bad('LaTeX 수식이 비어 있어요'); return; }
                const isDisplay=!!op.display||latex.length>40||/\\(int|sum|prod|lim|frac|sqrt|begin|matrix)/.test(latex);
                const estW=()=>{
                    const approx=Math.max(60,Math.min(size.w-2*AI_MARGIN,Math.round(10+latex.length*(isDisplay?9:7))));
                    return isDisplay?Math.min(size.w-2*AI_MARGIN,Math.max(200,approx)):Math.min(size.w/2,approx);
                };
                const estH=()=>isDisplay?Math.max(48,Math.min(140,Math.round(40+(latex.match(/\\(frac|sqrt)|\^|_/g)||[]).length*6))):44;
                const mg=aiEditMargins(pi);
                const wideM=Math.max(200,Math.min(size.w-2*AI_MARGIN,(mg.width&&mg.width>=200)?mg.width:(size.w-2*AI_MARGIN)));
                const bw=aiEditIsAuto(op.w)?(isDisplay?wideM:estW()):clamp(round(op.w),40,size.w);
                const bh=aiEditIsAuto(op.h)?estH():clamp(round(op.h),28,size.h);
                let p;
                if(aiEditIsAuto(op.x)||aiEditIsAuto(op.y)){
                    p=aiEditFreeSpot(pi,bw,bh,aiEditIsAuto(op.y)?0:round(op.y));
                    p.w=bw; p.h=bh;
                }else p=place(op.x,op.y,bw,bh,{pi:pi,snap:true,avoid:true});
                beforeChange(); pg.els=pg.els||[];
                const nm={type:'latex',id:uid('m'),x:p.x,y:p.y,w:p.w,h:p.h,
                    latex:latex,fontSize:isDisplay?22:18,displayMath:isDisplay?1:0};
                pg.els.push(nm);
                touched.add(pi); res.applied++; return;
            }
            // 14.30.0 · @img(→addimg) — 서버가 찾아 저장한 사진(/api/img/…)을 넣는다.
            //   모델은 검색어만 주고(파서가 cmd:'img'로 바꿈), bridge.apply 가
            //   /api/ai/imgadd 로 사진을 받아온 뒤 이 addimg 명령으로 바꿔 부른다.
            if(cmd==='addimg'){
                if(!finite(op.page)||!Number.isInteger(Number(op.page))){
                    bad('사진을 넣을 쪽 번호가 올바르지 않아요'); return;
                }
                const page=round(op.page),pi=page-1,pg=doc.pages[pi];
                if(page<1||page>doc.pages.length||!pg||pg.__lazy!=null){
                    bad('해당 페이지를 찾거나 불러오지 못했어요'); return;
                }
                const url=String(op.url||'').trim();
                if(!url||!/^(?:\/api\/img\/|https?:\/\/)/i.test(url)){
                    bad('사진 주소가 올바르지 않아요'); return;
                }
                const natW=Math.max(1,Number(op.natW)||4), natH=Math.max(1,Number(op.natH)||3);
                const mg=aiEditMargins(pi);
                const wide=Math.max(140,Math.min(size.w-2*AI_MARGIN,
                    (mg.width&&mg.width>=140)?mg.width:(size.w-2*AI_MARGIN)));
                let bw,bh;
                if(aiEditIsAuto(op.w)||aiEditIsAuto(op.h)){
                    bw=Math.max(120,Math.min(Math.round(size.w*0.52),Math.round(wide*0.94)));
                    bh=Math.round(bw*natH/natW);
                    if(bh>size.h*0.55){ bh=Math.round(size.h*0.55); bw=Math.max(80,Math.round(bh*natW/natH)); }
                    bw=clamp(bw,60,Math.max(60,size.w-8));
                    bh=clamp(bh,40,Math.max(40,size.h-8));
                }else{
                    bw=clamp(round(op.w),40,size.w);
                    bh=clamp(round(op.h),30,size.h);
                }
                let p;
                if(aiEditIsAuto(op.x)||aiEditIsAuto(op.y)){
                    p=aiEditFreeSpot(pi,bw,bh,aiEditIsAuto(op.y)?0:round(op.y));
                }else p=place(op.x,op.y,bw,bh,{pi:pi,snap:true,avoid:true});
                beforeChange(); pg.els=pg.els||[];
                const nel={type:'image',id:uid('i'),url:url,
                    x:Math.round(p.x),y:Math.round(p.y),w:Math.round(p.w),h:Math.round(p.h)};
                if(op.public_id) nel.public_id=String(op.public_id);
                pg.els.push(nel);
                touched.add(pi); res.applied++; return;
            }
            // 14.30.0 · @draw op — SVG에서 만든 펜 획 묶음을 종이에 그린다.
            //   좌표는 svg 좌표계라서 요청 크기(또는 기본 폭)로 스케일한 뒤
            //   auto/지정 자리에 옮긴다. 획마다 별도 요소(실제 펜과 동일 모델).
            if(cmd==='draw'){
                const sts=Array.isArray(op&&op.strokes)
                    ?op.strokes.filter(s=>s&&Array.isArray(s.pts)&&s.pts.length>=2):[];
                if(!sts.length){ bad('그릴 그림 획을 만들지 못했어요'); return; }
                let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
                sts.forEach(s=>s.pts.forEach(pt=>{
                    const px=Number(pt&&pt[0]),py=Number(pt&&pt[1]);
                    if(!Number.isFinite(px)||!Number.isFinite(py)) return;
                    if(px<x1)x1=px; if(py<y1)y1=py; if(px>x2)x2=px; if(py>y2)y2=py;
                }));
                if(!Number.isFinite(x1)||x2<=x1||y2<=y1){ bad('그릴 그림 좌표가 이상해요'); return; }
                const rawW=x2-x1,rawH=y2-y1;
                const aW=Math.max(80,size.w-2*AI_MARGIN), aH=Math.max(60,size.h-2*AI_MARGIN);
                // 14.31.0 · 쪽을 반이나 차지하지 않게 — 본문 폭의 40% · 최대
                //   320px · 높이 360px. 요청에 폭이 있으면 그 값을 존중한다.
                const capW=Math.min(aW,AI_DRAW_MAX_W), capH=Math.min(aH,AI_DRAW_MAX_H);
                let tw;
                if(finite(op.w)&&Number(op.w)>0) tw=clamp(round(op.w),60,aW);
                else tw=Math.max(AI_DRAW_MIN_W,Math.min(capW,Math.round(aW*AI_DRAW_W_RATIO)));
                let th=tw*rawH/rawW;
                if(th>capH){ th=capH; tw=Math.max(AI_DRAW_MIN_W,Math.round(th*rawW/rawH)); }
                if(tw>capW){ tw=capW; th=Math.round(tw*rawH/rawW); }
                const tpi=(op.page!=null&&Number.isInteger(Number(op.page)))
                    ?clamp(round(op.page)-1,0,doc.pages.length-1):(curPageIdx|0);
                const tpg=doc.pages[tpi];
                if(!tpg||tpg.__lazy!=null){ bad('그 페이지를 찾거나 불러오지 못했어요'); return; }
                let p;
                if(aiEditIsAuto(op.x)||aiEditIsAuto(op.y)||op.x==null||op.y==null){
                    p=aiEditFreeSpot(tpi,Math.round(tw),Math.round(th),0);
                }else p=place(op.x,op.y,tw,th,{pi:tpi,snap:true,avoid:true});
                const k=tw/rawW;
                const ox=(p.x||0)-x1*k, oy=(p.y||0)-y1*k;
                const r1=v=>Math.round(v*10)/10;
                beforeChange(); tpg.els=tpg.els||[];
                let added=0;
                sts.forEach(s=>{
                    const sz=Math.max(0.7,Math.min(22,(Number(s.size)||3)*k));
                    const pts=s.pts.map(pt=>[r1(Number(pt[0])*k+ox),r1(Number(pt[1])*k+oy)])
                        .filter((pt,i,arr)=>i===0||pt[0]!==arr[i-1][0]||pt[1]!==arr[i-1][1]);
                    if(pts.length<2) return;
                    const col=String(s.color||'#1a1a1a').trim();
                    tpg.els.push({type:'stroke',id:uid('s'),pts:pts,
                        color:/^#[0-9a-fA-F]{3,8}$/.test(col)?col:'#1a1a1a',
                        size:r1(sz),dx:0,dy:0,closed:s.closed?1:0});
                    added++;
                });
                if(!added){ bad('그릴 획을 만들지 못했어요'); return; }
                touched.add(tpi); res.applied++; return;
            }
            const found=findAny(op&&op.id);

            if(!found){
                // 표 id로 지우면 표 전체(칸·테두리)를 함께 지운다.
                if(cmd==='del'){
                    const tf=findTblAny(op&&op.id);
                    if(tf){ dropTable(tf); res.applied++; return; }
                }
                bad('문서 상태에 없는 요소라 건너뛰었어요'); return;
            }
            const {el,pi}=found;
            if(el.locked){ bad('잠긴 요소는 고칠 수 없어요'); return; }
            // 14.27.0 · 표 칸이나 테두리 획을 지우라는 말은 '그 표를 지워 달라'로
            //   알아듣는다 — 칸만 떼어 지우면 테두리가 남아 결국 표 전체 삭제다.
            if(cmd==='del'&&el.tbl){
                const tf=findTblAny(el.tbl.tid);
                if(tf){ dropTable(tf); note('표 칸이라 표 전체를 지웠어요'); res.applied++; return; }
                bad('표를 찾지 못했어요 · 다시 요청해 주세요'); return;
            }
            // 표 테두리 선은 표를 고치면 자동 재생성되니 직접 건드리지 않는다.
            if(el.type==='stroke'&&el.tbl){ bad('표 테두리는 표 명령(@tsz·@tmv)으로만 다룰 수 있어요'); return; }
            if(cmd==='del'){
                if(el.tbl){ bad('표 칸은 낱개로 지울 수 없어요 · 표 전체는 표 id로 지워요'); return; }
                beforeChange();
                doc.pages[pi].els=(doc.pages[pi].els||[]).filter(item=>item!==el);
                touched.add(pi); res.applied++; return;
            }
            if(cmd==='tx'){
                if(el.tbl){ bad('표 칸 내용은 @tcell로 바꿔 주세요'); return; }
                if(el.type!=='text'){ bad('글상자만 내용을 바꿀 수 있어요'); return; }
                // 14.29.2 · **중요어**·# 제목 줄·문장 안 $수식$ 을 노트 서식으로 옮긴다
                beforeChange(); el.html=aiMdToHtml(text(op.text),el.fontSize||16);
                delete el.fit; delete el.fitDown; delete el.trFS; delete el.trLS; delete el.trFW;
                touched.add(pi); res.applied++; return;
            }
            if(cmd==='mtx'||cmd==='latex'){
                if(el.type!=='latex'){ bad('@mtx는 수식 요소에만 쓸 수 있어요'); return; }
                const newLatex=String(op.latex==null?'':op.latex).trim().slice(0,2000);
                if(!newLatex){ bad('바꿀 LaTeX 수식이 비어 있어요'); return; }
                beforeChange();
                el.latex=newLatex;
                if(op.display==1||op.display===true) el.displayMath=1;
                else if(op.display===0||op.display===false) el.displayMath=0;
                touched.add(pi); res.applied++; return;
            }
            if(cmd==='rp'){
                if(el.tbl){ bad('표 칸 내용은 @tcell로 바꿔 주세요'); return; }
                if(el.type!=='text'){ bad('글상자만 내용을 바꿀 수 있어요'); return; }
                const find=text(op.find),repl=text(op.repl);
                if(!find){ bad('찾을 글이 비어 있어 바꿀 곳을 찾지 못했어요'); return; }
                const got=aiEditReplaceHtml(el.html,find,repl);
                if(!got.count){ bad('상자에서 찾을 글을 찾지 못했어요'); return; }
                beforeChange(); el.html=got.html;
                delete el.fit; delete el.fitDown; delete el.trFS; delete el.trLS; delete el.trFW;
                touched.add(pi); res.applied++; return;
            }
            if(cmd==='ap'){
                if(el.tbl){ bad('표 칸은 @tcell로 내용을 바꿔 주세요'); return; }
                if(el.type!=='text'){ bad('글상자에만 덧붙일 수 있어요'); return; }
                const body=text(op.text);
                if(!body.trim()){ bad('덧붙일 글이 비어 있어요'); return; }
                const front=/^(앞|앞쪽|prepend|pre|start|top|first)/i.test(String(op.dir||'뒤'));
                const piece=aiMdToHtml(body,el.fontSize||16);   // 14.29.2 · 마크다운 표시를 서식으로
                beforeChange();
                el.html=!aiEditText(el).trim()?piece
                    :(front?piece+'<br>'+(el.html||''):(el.html||'')+'<br>'+piece);
                delete el.fit; delete el.fitDown; delete el.trFS; delete el.trLS; delete el.trFW;
                touched.add(pi); res.applied++; return;
            }
            // 14.27.0 · @hl — 형광펜. 글귀를 주면 '그 글귀만' 칠한다(저장 포맷과
            //   같은 background-color span). 글귀가 없으면 상자 전체 배경이다.
            //   색을 안 적으면 노랑, '없음·지우기'면 지우기다.
            if(cmd==='hl'){
                if(el.type!=='text'){ bad('형광펜은 글상자(표 칸 포함)에만 칠할 수 있어요'); return; }
                let find=aiEditLooseFind(op.find);
                let colorV=String(op.color==null?'':op.color).trim();
                // "@hl id | 노랑" 처럼 값 하나만 오면 색으로, 아니면 찾을 글로 본다.
                if(op.single&&find
                   &&(aiEditColor(find,true)!=null||AI_CLEAR_WORDS[find.toLowerCase()])){
                    colorV=find; find='';
                }
                // "@hl id | 노랑 | 중요한 글" 처럼 순서가 뒤집혀 오면 바꿔 준다.
                if(find&&colorV&&aiEditColor(colorV,true)==null
                   &&!AI_CLEAR_WORDS[colorV.toLowerCase()]&&aiEditColor(find,true)!=null){
                    const swap=find; find=colorV; colorV=swap;
                }
                const whole=!find||find==='*'||find==='전체'||find==='모두'||find==='all';
                const clearing=!!colorV&&!!AI_CLEAR_WORDS[colorV.toLowerCase()];
                const color=aiEditColor(colorV,true)||AI_HL_DEFAULT;
                if(clearing){
                    if(whole){
                        const had=!!el.cellBg||/background(?:-color)?\s*:/i.test(String(el.html||''));
                        if(!had){ bad('지울 형광펜이 없어요'); return; }
                        beforeChange();
                        delete el.cellBg;
                        el.html=aiEditUnmarkHtml(el.html,'').html;
                    }else{
                        const got=aiEditUnmarkHtml(el.html,find);
                        if(!got.count){ bad('상자에서 찾을 글을 찾지 못했어요'); return; }
                        beforeChange();
                        el.html=got.html;
                        if(el.cellBg){ delete el.cellBg; note('상자 전체 배경 형광펜도 함께 지웠어요'); }
                    }
                }else if(whole){
                    beforeChange();
                    el.cellBg=color;
                }else{
                    const got=aiEditMarkHtml(el.html,find,color);
                    if(!got.count){ bad('상자에서 찾을 글을 찾지 못했어요'); return; }
                    beforeChange();
                    el.html=got.html;
                }
                delete el.fit; delete el.fitDown; delete el.trFS; delete el.trLS; delete el.trFW;
                touched.add(pi); res.applied++; return;
            }
            if(cmd==='st'){
                const changes=aiEditStyleOps(op.style);
                if(!changes.length){ bad('알 수 없는 서식이라 건너뛰었어요'); return; }
                if(el.type==='text'){
                    const use=changes.filter(ch=>['font','fs','fg','hl','bold','italic',
                        'underline','strike','align'].indexOf(ch.k)>=0);
                    if(!use.length){ bad('이 상자에는 적용할 서식이 없어요'); return; }
                    beforeChange();
                    use.forEach(ch=>{
                        if(ch.k==='font') el.font=ch.v;
                        else if(ch.k==='fs') el.fontSize=ch.v;
                        else if(ch.k==='fg'){ if(ch.v) el.textColor=ch.v; else delete el.textColor; }
                        else if(ch.k==='hl'){ if(ch.v) el.cellBg=ch.v; else delete el.cellBg; }
                        else if(ch.k==='bold'){ if(ch.v) el.fontWeight='700'; else delete el.fontWeight; }
                        else if(ch.k==='italic'){ if(ch.v) el.fontStyle='italic'; else delete el.fontStyle; }
                        else if(ch.k==='underline'||ch.k==='strike'){
                            const tok=ch.k==='underline'?'underline':'line-through';
                            const cur=String(el.textDecoration||'').split(/\s+/)
                                .filter(t=>t&&t!=='none'&&t!==tok);
                            if(ch.v) cur.push(tok);
                            if(cur.length) el.textDecoration=cur.join(' ');
                            else delete el.textDecoration;
                        }
                        else if(ch.k==='align') el.align=ch.v;
                    });
                    delete el.fit; delete el.fitDown; delete el.trFS; delete el.trLS; delete el.trFW;
                    touched.add(pi); res.applied++; return;
                }
                if(el.type==='stroke'){
                    let did=false;
                    changes.forEach(ch=>{
                        if((ch.k==='fg'||ch.k==='pencolor')&&ch.v){ el.color=ch.v; did=true; }
                        else if(ch.k==='fs'||ch.k==='pensize'){
                            el.size=Math.max(0.5,Math.min(30,Number(ch.v)||el.size||2)); did=true;
                        }
                    });
                    if(!did){ bad('그림획은 펜색·굵기만 바꿀 수 있어요'); return; }
                    beforeChange(); touched.add(pi); res.applied++; return;
                }
                if(el.type==='latex'){
                    const fs=changes.find(ch=>ch.k==='fs');
                    if(!fs){ bad('수식은 글자 크기만 바꿀 수 있어요'); return; }
                    beforeChange(); el.fontSize=Math.max(5,Math.min(200,fs.v));
                    touched.add(pi); res.applied++; return;
                }
                bad('이 요소에는 서식을 적용할 수 없어요'); return;
            }
            // 표 칸은 내용(@tcell)·서식(@st)까지만 — 위치·크기·삭제는 표가 깨진다.
            if(el.tbl){ bad('표 칸은 @tcell·@st로만 다룰 수 있어요'); return; }
            if(cmd!=='mv'&&cmd!=='sz'&&cmd!=='bx'){
                bad('알 수 없는 편집 명령을 건너뛰었어요'); return;
            }
            if(!['text','image','latex','stroke','legacyDraw'].includes(el.type)){
                bad('지원하지 않는 요소 종류라 건너뛰었어요'); return;
            }
            if(el.type==='legacyDraw'){
                bad('배경그림은 이동하거나 크기를 바꿀 수 없어요'); return;
            }
            if(el.type==='stroke'&&cmd!=='mv'){
                bad('그림획은 이동만 할 수 있어요'); return;
            }
            if((cmd==='mv'||cmd==='bx')&&(!finite(op.x)||!finite(op.y))){
                bad('이동 좌표가 올바르지 않아요'); return;
            }
            if((cmd==='sz'||cmd==='bx')&&(!finite(op.w)||!finite(op.h))){
                bad('크기가 올바르지 않아요'); return;
            }
            if(el.type==='stroke'){
                const b=aiEditStrokeBox(el);
                const x=clamp(round(op.x),0,Math.max(0,size.w-b.w));
                const y=clamp(round(op.y),0,Math.max(0,size.h-b.h));
                beforeChange(); el.dx=x-b.baseX; el.dy=y-b.baseY;
                touched.add(pi); res.applied++; return;
            }
            const b=aiEditBox(el);
            let p;
            if(cmd==='mv') p=place(op.x,op.y,Math.max(20,b.w),Math.max(20,b.h),{pi:pi,skipId:el.id});
            else if(cmd==='sz'){
                // 크기만 바꾸라는 요청은 x/y를 움직이지 않는다. 가장자리까지 남은
                // 폭이 20px보다 작으면 그 여유만큼까지 허용해 페이지 밖으로 새지 않게 한다.
                if(!finite(b.x)||!finite(b.y)||b.x<0||b.y<0||b.x>=size.w||b.y>=size.h){
                    bad('요소의 현재 위치가 페이지 밖이라 크기를 바꾸지 않았어요'); return;
                }
                const maxW=Math.max(1,size.w-b.x),maxH=Math.max(1,size.h-b.y);
                p={x:b.x,y:b.y,w:clamp(round(op.w),Math.min(20,maxW),maxW),
                    h:clamp(round(op.h),Math.min(20,maxH),maxH)};
            }else p=place(op.x,op.y,op.w,op.h,{pi:pi,skipId:el.id});
            beforeChange();
            if(cmd!=='sz'){ el.x=p.x; el.y=p.y; }
            if(cmd!=='mv'){ el.w=p.w; el.h=p.h; }
            touched.add(pi); res.applied++;
        });
        if(res.applied>0){
            touched.forEach(pi=>{
                try{ markPageEdited(pi); }catch(e){}
                try{ if(renderedPages.has(pi)) renderPageEls(pi); }catch(e){}
            });
            // @goto·@title은 화면·노트 이름만 건드린다 — 문서 저장은 실제 변경 때만.
            if(historyStarted){
                try{ syncBoost(); }catch(e){}
                saveDoc(); queueOps();
            }
        }
        return res;
    }

    // 20.1 · 해돌이에게 넘길 노트 글 캐시.
    //   text('doc') 는 문서 전체(논문이면 수백 쪽 × 상자 수백 개)를 훑는다.
    //   해돌이의 warm 예약·버튼 상태 칠하기가 스크롤·DOM 변화마다 이걸 다시 부르면
    //   메인 스레드가 통째로 잠긴다. 문서가 실제로 바뀔 때만 다시 만든다.
    //
    // 20.2 · 쪽 단위로 쪼개 캐시한다. 문서 전체 글은 '쪽 글'을 이어 붙인 것이므로
    //   ① 한 쪽만 고쳐도 그 쪽만 다시 뽑으면 되고,
    //   ② 처음 만들 때도 한 번에 다 하지 않고 조금씩 나눠 만들 수 있다.
    let _aiTextSeq=0;
    let _aiPageText=[];          // 쪽 글 (인덱스별) — 이 노트/이 seq 의 것
    let _aiPageOwner='';         // 어느 노트·어느 seq 의 캐시인지
    function _aiOwner(){ return (curNB&&curNB.id||'')+'|'+_aiTextSeq; }
    function _aiReset(){ _aiPageText=[]; _aiPageOwner=_aiOwner(); }
    function bumpAiText(){ _aiTextSeq++; _aiReset(); }
    // 20.2 · 고친 쪽 하나만 버린다. 글자를 칠 때마다 문서 전체를 버리면
    //   쪽 캐시를 둔 의미가 없다(논문에서 다시 전부 뽑게 된다).
    function aiInvalidatePage(i){
        if(_aiPageOwner!==_aiOwner()){ _aiReset(); return; }
        i=+i; if(i>=0) _aiPageText[i]=null;
    }
    try{ window.__sdyBumpAiText=bumpAiText; }catch(e){}

    // 쪽 하나의 글 — 캐시가 있으면 그대로, 없으면 뽑아서 저장.
    function aiPageText(i){
        if(_aiPageOwner!==_aiOwner()) _aiReset();
        const c=_aiPageText[i];
        if(c!=null) return c;
        const out=[];
        try{ collectPageEls(i).forEach(o=>{ if(o.src) out.push(o.src); }); }catch(e){}
        const s=out.join('\n');
        _aiPageText[i]=s;
        return s;
    }
    // 아직 안 뽑은 쪽이 있나?
    function aiTextPending(){
        if(!doc||!doc.pages) return 0;
        if(_aiPageOwner!==_aiOwner()) return doc.pages.length;
        let n=0;
        for(let i=0;i<doc.pages.length;i++) if(_aiPageText[i]==null) n++;
        return n;
    }
    /* 20.2 · 문서 전체 글을 '조금씩' 만들어 둔다.
       노트를 연 직후 해돌이가 전체 요약을 준비하려면 결국 모든 쪽을 읽어야 하는데,
       그걸 한 번에 하면 논문에서 1초 가까이 메인 스레드가 잠긴다(첫 동작이 굼뜬 이유).
       한 번에 몇 쪽씩만, 그것도 브라우저가 한가할 때만 뽑아 두면
       버튼을 누를 즈음엔 이미 다 준비돼 있고 화면은 한 프레임도 멎지 않는다.
       보고 있는 쪽 주변부터 채운다 — 사용자가 실제로 먼저 물어볼 곳이다. */
    let _aiFillTok=0;
    function aiFillDocText(){
        const tok=++_aiFillTok;
        const owner=_aiOwner();
        const idle=(cb)=>{
            if(typeof requestIdleCallback==='function') requestIdleCallback(cb,{timeout:2000});
            else setTimeout(()=>cb({timeRemaining:()=>8}),32);
        };
        const step=(dl)=>{
            if(tok!==_aiFillTok||!doc||!doc.pages||_aiOwner()!==owner) return;   // 노트가 바뀌었다 → 중단
            const n=doc.pages.length;
            // 보고 있는 쪽에서 바깥으로 퍼져 나가며 채운다
            const cur=Math.max(0,Math.min(n-1,curPageIdx|0));
            let did=0;
            for(let r=0;r<n;r++){
                for(const i of (r===0?[cur]:[cur-r,cur+r])){
                    if(i<0||i>=n) continue;
                    if(_aiPageText[i]!=null) continue;
                    aiPageText(i); did++;
                    // 한가한 시간이 남아 있는 동안만, 최대 4쪽씩 (프레임 예산 보호)
                    const left=(dl&&typeof dl.timeRemaining==='function')?dl.timeRemaining():0;
                    if(did>=4||left<3){ idle(step); return; }
                }
            }
            if(did) paintOutlineReadySafe();      // 다 채워졌으면 버튼 표시를 한 번 갱신
        };
        idle(step);
    }
    function paintOutlineReadySafe(){
        try{ if(typeof window.sdyAiPaintReady==='function') window.sdyAiPaintReady(); }catch(e){}
    }
    try{ window.__sdyAiFillText=aiFillDocText; window.__sdyAiTextPending=aiTextPending; }catch(e){}
    try{
        window.__sdyAiBridge={
            text:(scope)=>{
                try{
                    if(!doc||!doc.pages||!doc.pages.length) return '';
                    if(scope==='page') return aiPageText(Math.max(0,Math.min(doc.pages.length-1,curPageIdx|0)));
                    const out=[];
                    for(let i=0;i<doc.pages.length;i++){
                        const s=aiPageText(i);
                        if(s) out.push(s);
                    }
                    return out.join('\n');
                }catch(e){ return ''; }
            },
            // 20.2 · 아직 안 뽑은 쪽이 없을 때만 문서 전체 글을 준다.
            //   해돌이 warm(미리 준비)은 이걸 써서 '조용히 다 준비된 뒤'에만 서버로 간다 —
            //   준비가 덜 됐으면 억지로 다 뽑지 않고(=멈춤 없이) 다음 기회로 미룬다.
            textIfReady:(scope)=>{
                try{
                    if(!doc||!doc.pages||!doc.pages.length) return null;
                    if(scope==='page') return aiPageText(Math.max(0,Math.min(doc.pages.length-1,curPageIdx|0)));
                    if(aiTextPending()>0){ aiFillDocText(); return null; }
                    return window.__sdyAiBridge.text('doc');
                }catch(e){ return null; }
            },
            title:()=>String((document.getElementById('edTitle')||{}).value||'').trim(),
            snapshot:()=>{ try{ commitEditingText(); return aiEditSnapshot(); }catch(e){ return ''; } },
            capture:()=>{
                try{
                    commitEditingText();
                    return {text:aiEditSnapshot(),revision:aiEditRevision()};
                }catch(e){ return {text:'',revision:''}; }
            },
            apply:(ops,revision)=>{
                try{
                    const list=Array.isArray(ops)?ops:[];
                    const needsClip=list.some(o=>o&&(o.cmd==='clip'||o.cmd==='clipin'||o.cmd==='copy'));
                    const needsImg=list.some(o=>o&&String(o.cmd||'').toLowerCase()==='img');
                    // 클립보드·사진(@img)이 없으면 동기 그대로 — 있으면 읽어/받아
                    // @add·@addimg로 바꾼 뒤 적용한다.
                    if(!needsClip&&!needsImg) return aiEditApply(list,revision);
                    return (async()=>{
                        let preFailed=0; const preNotes=[];
                        // 14.30.0 · @img — 서버(/api/ai/imgadd)가 사진을 찾아
                        //   저장소에 받아 주소를 돌려준다(캐시됨). 실패한 장만 센다.
                        const imgOps=list.filter(o=>o&&String(o.cmd||'').toLowerCase()==='img');
                        const imgGot={};
                        for(const io of imgOps.slice(0,3)){
                            try{
                                const iq=String(io.q||'').trim().slice(0,160);
                                if(!iq) throw new Error('찾을 사진 검색어가 비어 있어요');
                                const ir=await fetch('/api/ai/imgadd',{method:'POST',
                                    headers:{'Content-Type':'application/json'},
                                    body:JSON.stringify({q:iq})});
                                const ij=await ir.json().catch(()=>null);
                                if(!ir.ok||!ij||!ij.ok||!ij.url)
                                    throw new Error((ij&&ij.error)||'사진을 찾지 못했어요');
                                imgGot[io]=ij;
                            }catch(e){
                                preFailed++;
                                const em=String((e&&e.message)||e||'사진을 찾지 못했어요');
                                if(preNotes.indexOf(em)<0&&preNotes.length<4) preNotes.push(em);
                            }
                        }
                        let clip='',clipErr='';
                        if(list.some(o=>o&&(o.cmd==='clip'||o.cmd==='clipin'))){
                            try{
                                if(navigator.clipboard&&navigator.clipboard.readText)
                                    clip=String(await navigator.clipboard.readText()||'');
                                else clipErr='이 브라우저에서는 클립보드를 읽지 못해요';
                            }catch(e){ clipErr='클립보드를 읽지 못했어요 · 복사 권한을 확인해 주세요'; }
                            clip=clip.slice(0,AI_EDIT_MAX_TEXT);
                            if(!clip&&!clipErr) clipErr='클립보드가 비어 있어요 · 먼저 복사해 주세요';
                        }
                        const mapped=[];
                        const copies=[];
                        list.forEach(o=>{
                            const cmd=String(o&&o.cmd||'').toLowerCase();
                            if(cmd==='img'){
                                const jj=imgGot[o];
                                if(!jj){ return; }          // 실패는 위에서 이미 세었다
                                mapped.push({cmd:'addimg',page:o.page,x:o.x,y:o.y,w:o.w,h:o.h,
                                    url:jj.url,public_id:jj.public_id||'',
                                    natW:jj.width||null,natH:jj.height||null});
                                return;
                            }
                            if(cmd==='clip'){
                                if(!clip){ preFailed++; if(preNotes.indexOf(clipErr)<0) preNotes.push(clipErr); return; }
                                mapped.push({cmd:'add',page:o.page,x:o.x,y:o.y,w:o.w,h:o.h,
                                    text:clip,inherit:o.inherit});
                            }else if(cmd==='clipin'){
                                if(!clip){ preFailed++; if(preNotes.indexOf(clipErr)<0) preNotes.push(clipErr); return; }
                                mapped.push({cmd:'ap',id:o.id,dir:o.dir,text:clip});
                            }else if(cmd==='copy'){ copies.push(o); }
                            else mapped.push(o);
                        });
                        const res=aiEditApply(mapped,revision);
                        res.failed+=preFailed;
                        preNotes.forEach(m=>{ if(m&&res.notes.length<4&&res.notes.indexOf(m)<0) res.notes.push(m); });
                        // 복사는 문서 변경 뒤 최종 글 기준으로 내보낸다.
                        for(const cp of copies){
                            const found=(()=>{ 
                                const id=String(cp&&cp.id||'').trim();
                                if(!id) return null;
                                for(let pi=0;pi<doc.pages.length;pi++){
                                    const el=((doc.pages[pi]||{}).els||[]).find(item=>item&&item.id===id);
                                    if(el) return el;
                                }
                                return null;
                            })();
                            if(!found||(found.type!=='text'&&found.type!=='latex')){
                                res.failed++;
                                if(res.notes.length<4) res.notes.push('복사할 글상자를 찾지 못했어요');
                                continue;
                            }
                            try{
                                if(!(navigator.clipboard&&navigator.clipboard.writeText))
                                    throw new Error('no clipboard');
                                await navigator.clipboard.writeText(aiEditText(found));
                                res.applied++;
                            }catch(e){
                                res.failed++;
                                if(res.notes.length<4&&res.notes.indexOf('클립보드에 복사하지 못했어요')<0)
                                    res.notes.push('클립보드에 복사하지 못했어요');
                            }
                        }
                        return res;
                    })();
                }
                catch(e){ return {applied:0,failed:Array.isArray(ops)?ops.length:0,stale:false,
                    notes:['적용 중 오류 · '+String(e&&e.message||'다시 시도해 주세요')]}; }
            },
        };
    }catch(e){}
    /* ============ /6.1 번역 ============ */

    // 가져온(tight) 상자에서 복사 시: 절대스팬 사이 줄바꿈을 공백으로 정돈해
    // 외부에 붙여넣어도 깔끔한 문장으로 나가게 한다.
    document.addEventListener('copy',e=>{
        try{
            const sel=window.getSelection();
            if(!sel||sel.isCollapsed) return;
            const n=sel.anchorNode
                ? (sel.anchorNode.nodeType===1?sel.anchorNode:sel.anchorNode.parentElement)
                : null;
            const host=n&&n.closest('.tb-content');
            if(!host||!host.closest('.tight')) return;
            // 외부(구글 등) 붙여넣기용: 공백 재조립 + 줄바꿈→공백
            const clean=tightSelectionText(sel).replace(/\n+/g,' ').replace(/\s{2,}/g,' ').trim();
            if(!clean) return;
            e.clipboardData.setData('text/plain',clean);
            e.preventDefault();
        }catch(err){}
    });


/* APP-PART:12e-ai-ops.js:END */
