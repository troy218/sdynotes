/* === src/app/08b-table.js ===
   표 · 쪽 북마크 드래그
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:08b-table.js:BEGIN */
    // ===== 표 만들기 =====
    // 칸마다 텍스트 상자를 놓고 선을 둘러 표처럼 보이게 한다.
    // 각 칸을 바로 클릭해 글자를 넣을 수 있고, 통째로 옮기도록 묶어 둔다.
    // ==========================================================
    //  표 크기 조절 · 행/열 추가 (Task 28)
    //  표 정보는 페이지마다 page.tables 배열에 담는다.
    //   {id, x, y, cw:[열 너비...], ch:[행 높이...]}
    //  칸(텍스트)과 선(획)에는 el.tbl={tid, r, c} 표시가 붙는다.
    // ==========================================================
    const TBL_MINW=28, TBL_MINH=20;
    // 표를 끄는 동안 화면 갱신을 프레임당 1회로 묶는다 (드래그가 매끄러워짐)
    let _tblRaf=0, _tblRafPi=-1, _tblRafDoc=null, _tblRafVersion=0;
    function tblRepaint(pi){
        _tblRafPi=pi; _tblRafDoc=doc; _tblRafVersion=doc&&doc.__rv;
        if(_tblRaf) return;
        _tblRaf=requestAnimationFrame(()=>{
            _tblRaf=0;
            const i=_tblRafPi;
            const d=_tblRafDoc,v=_tblRafVersion; _tblRafDoc=null;
            if(i>=0&&doc===d&&doc&&doc.__rv===v&&doc.pages[i]) renderPageEls(i);
        });
    }
    // 중요어 분석 상태 (아래에서 쓰는 함수보다 먼저 선언 — TDZ 방지)
    //  wfMin  : 후보로 칠 최소 등장 횟수 (문서 길이에 따라 wfFloorN 이 자동 결정)
    //  wfTopN : 실제로 색칠할 중요어 개수 상한 (14.39.3 · 기본 8개 · 3~24 조절)
    //  wfSel  : 고른 중요어 Map(낱말 → 순위) · wfExtra : 손으로 짚어 본 낱말
    let wfOn=false, wfStats=[], wfMap=null, wfPick=null, wfMin=2;
    let wfTopN=8, wfSel=new Map(), wfExtra=new Set(), wfCand=[], wfTotal=0;
    let wfAlias=new Map();   // 한 글자 차이로 쪼개진 낱말을 이어 주는 별칭
    let activeTbl=null;            // {pageIdx,tid,r,c}
    let tblCellSelection=null;     // {pageIdx,tid,r0,c0,r1,c1} 직사각형 셀 범위
    let tblCellPick=null;          // 포인터로 범위를 끄는 동안의 앵커
    let tblDrag=null, tblScale=null, tblMove=null;

    function pageTables(pi){
        const pg=doc&&doc.pages[pi]; if(!pg) return [];
        if(!Array.isArray(pg.tables)) pg.tables=[];
        return pg.tables;
    }
    function findTbl(pi,tid){ return pageTables(pi).find(t=>t.id===tid)||null; }
    function tblOf(el){ return (el&&el.tbl&&el.tbl.tid)?el.tbl.tid:null; }
    function tblCells(pi,tid){
        return (doc.pages[pi].els||[]).filter(e=>e.type==='text'&&tblOf(e)===tid);
    }
    function tblSize(t){ return {w:t.cw.reduce((a,b)=>a+b,0), h:t.ch.reduce((a,b)=>a+b,0)}; }
    function colX(t,i){ let x=t.x; for(let k=0;k<i;k++) x+=t.cw[k]; return x; }
    function rowY(t,i){ let y=t.y; for(let k=0;k<i;k++) y+=t.ch[k]; return y; }

    function selectedTblCellEls(){
        const s=tblCellSelection;
        if(!s||!doc||!doc.pages[s.pageIdx]) return [];
        const r0=Math.min(s.r0,s.r1),r1=Math.max(s.r0,s.r1);
        const c0=Math.min(s.c0,s.c1),c1=Math.max(s.c0,s.c1);
        return tblCells(s.pageIdx,s.tid).filter(el=>
            el.tbl.r>=r0&&el.tbl.r<=r1&&el.tbl.c>=c0&&el.tbl.c<=c1);
    }
    // 14.30.1 · 칠해 둔 표 칸을 기억한다. 예전에는 지울 때마다 `#pagesStage`
    //   전체에서 `.tbl-cell-sel` 을 찾느라 (칸을 하나도 안 골랐을 때조차)
    //   종이 subtree 를 통째로 훑었다 — 스크롤·렌더 경로에서 같이 불린다.
    let _tblCellPainted=[];
    function paintTblCellSelection(){
        if(_tblCellPainted.length){
            _tblCellPainted.forEach(n=>{
                try{
                    if(!n.isConnected) return;
                    n.classList.remove('tbl-cell-sel','tbl-cell-anchor');
                    n.removeAttribute('aria-selected');
                }catch(e){}
            });
            _tblCellPainted=[];
        }
        const s=tblCellSelection;
        if(!s) return;
        const paper=paperAt(s.pageIdx); if(!paper) return;
        selectedTblCellEls().forEach(el=>{
            const n=paper.querySelector(`.tb[data-id="${el.id}"]`); if(!n) return;
            n.classList.add('tbl-cell-sel'); n.setAttribute('aria-selected','true');
            if(el.tbl.r===s.r1&&el.tbl.c===s.c1) n.classList.add('tbl-cell-anchor');
            _tblCellPainted.push(n);
        });
    }
    function clearTblCellSelection(){
        tblCellSelection=null; tblCellPick=null; paintTblCellSelection();
    }
    function startTblCellSelection(e,pi,cell){
        const old=tblCellSelection;
        deselectAll(true); clearMulti(); clearTextSelection(); selected=null;
        const extend=!!(e.shiftKey&&old&&old.pageIdx===pi&&old.tid===cell.tid);
        tblCellSelection={pageIdx:pi,tid:cell.tid,
            r0:extend?old.r0:cell.r,c0:extend?old.c0:cell.c,r1:cell.r,c1:cell.c};
        tblCellPick={pageIdx:pi,tid:cell.tid,sx:e.clientX,sy:e.clientY};
        setActiveTbl(pi,cell.tid,cell.r,cell.c);
        paintTblCellSelection();
    }
    function tblCellApply(fn,msg){
        const cells=selectedTblCellEls();
        if(!cells.length){ toast('표에서 칸을 먼저 선택하세요',1400); return false; }
        pushHistory(); cells.forEach(fn);
        markPageEdited(tblCellSelection.pageIdx);
        renderPageEls(tblCellSelection.pageIdx); saveDoc();
        if(msg) toast(msg,1100);
        return true;
    }
    function tblCellAlign(dir){
        tblCellApply(el=>{ el.align=dir; },({left:'왼쪽',center:'가운데',right:'오른쪽'})[dir]+' 정렬');
    }
    function tblCellVAlign(dir){
        tblCellApply(el=>{ el.vAlign=dir; },({top:'위쪽',middle:'세로 가운데',bottom:'아래쪽'})[dir]+' 정렬');
    }
    function tblCellFill(color){
        tblCellApply(el=>{ if(color) el.cellBg=color; else delete el.cellBg; },color?'칸 배경색 적용':'칸 배경색 지움');
    }
    function clearTblCellContents(){
        tblCellApply(el=>{ el.html=''; },'선택한 칸 내용 지움');
    }
    function moveTblCellSelection(dr,dc,extend){
        const s=tblCellSelection,t=s&&findTbl(s.pageIdx,s.tid); if(!s||!t) return false;
        const nr=Math.max(0,Math.min(t.ch.length-1,s.r1+dr));
        const nc=Math.max(0,Math.min(t.cw.length-1,s.c1+dc));
        if(!extend){ s.r0=nr; s.c0=nc; }
        s.r1=nr; s.c1=nc;
        setActiveTbl(s.pageIdx,s.tid,nr,nc); paintTblCellSelection();
        return true;
    }
    function editTblSelectionCell(){
        const s=tblCellSelection,paper=s&&paperAt(s.pageIdx); if(!s||!paper) return false;
        const el=tblCells(s.pageIdx,s.tid).find(x=>x.tbl.r===s.r1&&x.tbl.c===s.c1);
        const node=el&&paper.querySelector(`.tb[data-id="${el.id}"]`); if(!node) return false;
        clearTblCellSelection(); enterEdit(node,false); return true;
    }

    // 표의 선과 칸 위치를 표 정보에 맞춰 다시 만든다
    function rebuildTable(pi,tid,opt){
        const t=findTbl(pi,tid); if(!t) return;
        const els=doc.pages[pi].els||[];
        const rows=t.ch.length, cols=t.cw.length;
        const size=tblSize(t);
        // ① 선은 통째로 다시 그린다
        doc.pages[pi].els=els.filter(e=>!(e.type==='stroke'&&tblOf(e)===tid));
        const list=doc.pages[pi].els;
        const gid=t.group||('g_'+tid);
        t.group=gid;
        const line=(x1,y1,x2,y2)=>list.push({type:'stroke',id:uid('s'),color:t.color||'#9aa1ab',
            size:t.lw||1.2,dx:0,dy:0,sharp:true,pts:[[x1,y1],[x2,y2]],group:gid,tbl:{tid}});
        for(let r=0;r<=rows;r++) line(t.x, rowY(t,r), t.x+size.w, rowY(t,r));
        for(let c=0;c<=cols;c++) line(colX(t,c), t.y, colX(t,c), t.y+size.h);
        // ② 칸은 위치·크기만 맞춘다 (글자는 그대로)
        const byRC={};
        list.forEach(e=>{ if(e.type==='text'&&tblOf(e)===tid) byRC[e.tbl.r+'_'+e.tbl.c]=e; });
        for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
            let cell=byRC[r+'_'+c];
            if(!cell){
                cell={type:'text',id:uid('t'),html:'',fontSize:Math.min(15,curFontSize||15),
                      font:curFont,group:gid,tbl:{tid,r,c}};
                list.push(cell);
            }
            cell.group=gid; cell.tbl={tid,r,c};
            cell.x=Math.round(colX(t,c)+3);
            cell.y=Math.round(rowY(t,r)+3);
            cell.w=Math.max(12,Math.round(t.cw[c]-6));
            cell.h=Math.max(12,Math.round(t.ch[r]-6));
        }
        if(!opt||!opt.quiet){ markPageEdited(pi); renderPageEls(pi); renderTblDivs(pi); saveDoc(); }
    }

    // ===== 표 테두리(선택 틀) · 꼭짓점 · 경계 잡이 · 변 중앙 늘리기 손잡이 =====
    // 조잡한 파란 막대 대신, 텍스트 상자와 같은 감각의 얇은 틀 + 손잡이로 그린다.
    function renderTblDivs(pi){
        const paper=paperAt(pi); if(!paper) return;
        const layer=paper.querySelector('.layer-tbl'); if(!layer) return;
        layer.innerHTML='';
        pageTables(pi).forEach(t=>{
            if(!t.cw||!t.ch||!t.cw.length||!t.ch.length) return;
            const size=tblSize(t);
            const on=!!(activeTbl&&activeTbl.pageIdx===pi&&activeTbl.tid===t.id);

            // ① 감지 영역 + 선택 틀 (마우스가 가까이 오면 손잡이가 나타난다)
            const box=document.createElement('div');
            box.className='tbl-box'+(on?' on':'');
            box.dataset.tid=t.id;
            box.style.cssText=`left:${t.x}px;top:${t.y}px;width:${size.w}px;height:${size.h}px;`;
            layer.appendChild(box);

            const frame=document.createElement('div');
            frame.className='tbl-frame';
            box.appendChild(frame);

            // 테두리(손잡이가 아닌 얇은 가장자리)를 잡으면 텍스트 상자처럼 표 전체 이동.
            // 보이는 이동 버튼은 두지 않는다.
            ['top','bottom','left','right'].forEach(side=>{
                const eg=document.createElement('div');
                eg.className='tbl-edge '+side;
                eg.title='표 테두리를 끌어서 이동';
                sdyAddPointerCompat(eg,'pointerdown',e=>startTblMove(e,pi,t.id));
                box.appendChild(eg);
            });

            // ② 열 경계 — 끌면 너비 조절
            for(let c=1;c<t.cw.length;c++){
                const d=document.createElement('div');
                d.className='tbl-div col';
                d.style.left='calc('+(colX(t,c)-t.x)+'px - var(--hs,12px)/2)';
                d.style.height=size.h+'px';
                d.title='끌어서 열 너비 조절';
                sdyAddPointerCompat(d,'pointerdown',e=>startTblDrag(e,pi,t.id,'col',c-1));
                box.appendChild(d);
            }
            // ③ 행 경계 — 끌면 높이 조절
            for(let r=1;r<t.ch.length;r++){
                const d=document.createElement('div');
                d.className='tbl-div row';
                d.style.top='calc('+(rowY(t,r)-t.y)+'px - var(--hs,12px)/2)';
                d.style.width=size.w+'px';
                d.title='끌어서 행 높이 조절';
                sdyAddPointerCompat(d,'pointerdown',e=>startTblDrag(e,pi,t.id,'row',r-1));
                box.appendChild(d);
            }
            // ④ 꼭짓점 4개 — 가로·세로를 자유롭게 확대/축소 (Shift 때만 비율 유지)
            [['nw',0,0],['ne',1,0],['sw',0,1],['se',1,1]].forEach(([dir,fx,fy])=>{
                const h=document.createElement('div');
                h.className='tbl-h '+dir;
                h.style.left =(fx?size.w:0)+'px';
                h.style.top  =(fy?size.h:0)+'px';
                h.title='끌어서 표 크기 조절 (Shift = 비율 유지)';
                sdyAddPointerCompat(h,'pointerdown',e=>startTblScale(e,pi,t.id,dir));
                box.appendChild(h);
            });
            // ⑤ 변 중앙 손잡이 — 한 축으로만 표 늘리기
            //    위·아래 = 세로, 왼·오른쪽 = 가로. 행/열 추가 버튼은 쓰지 않는다.
            const edge=(cls,left,top,dir)=>{
                const h=document.createElement('div');
                h.className='tbl-stretch '+cls;
                h.style.left=left+'px'; h.style.top=top+'px';
                h.title='끌어서 표 크기 조절 (한 축)';
                sdyAddPointerCompat(h,'pointerdown',e=>startTblStretch(e,pi,t.id,dir));
                box.appendChild(h);
            };
            edge('top',    size.w/2, 0,      'top');
            edge('bottom', size.w/2, size.h, 'bottom');
            edge('left',   0,        size.h/2,'left');
            edge('right',  size.w,   size.h/2,'right');
        });
        paintTblCellSelection();
    }
    // 화면에 요소를 그려 둔 쪽만 다시 그린다 (500쪽을 훑지 않는다)
    function renderAllTblDivs(){ if(doc) Array.from(renderedPages).forEach(i=>{ try{ renderTblDivs(i); }catch(e){} }); }

    // 표 가까이(22px 이내) 가면 손잡이 · ＋ 버튼이 나타난다
    const TBL_NEAR=22;
    function updateTblNear(e){
        if(!doc||tblDrag||tblScale||tblMove) return;
        const paper=e.target.closest&&e.target.closest('#pagesStage .paper');
        document.querySelectorAll('.tbl-box.near').forEach(n=>{
            if(!paper||n.closest('.paper')!==paper) n.classList.remove('near');
        });
        if(!paper) return;
        const pi=+paper.dataset.pageIdx;
        const p=pageLocal(e,pi),sc=pageScreenScale(pi);
        const x=p.x,y=p.y;
        const m=TBL_NEAR/Math.max(.2,Math.min(sc.x,sc.y));
        paper.querySelectorAll('.tbl-box').forEach(box=>{
            const t=findTbl(pi,box.dataset.tid); if(!t) return;
            const s=tblSize(t);
            const near = x>=t.x-m && x<=t.x+s.w+m && y>=t.y-m && y<=t.y+s.h+m;
            box.classList.toggle('near',near);
        });
    }
    // ★ pointermove 로 통합 — 터치 장치에서도 표 가까이 가면 손잡이가 나타남
    let _nearRaf=0;
    sdyAddPointerCompat(document,'pointermove',e=>{
        if(_nearRaf) return;
        const ev={target:e.target,clientX:e.clientX,clientY:e.clientY};
        _nearRaf=requestAnimationFrame(()=>{ _nearRaf=0; updateTblNear(ev); });
    },{passive:true});

    // ===== 열/행 경계 끌기 =====
    function startTblDrag(e,pi,tid,kind,idx){
        const t=findTbl(pi,tid); if(!t) return;
        // 손잡이는 칸 글자 위를 살짝 덮는다. 눌린 지점이 경계선에서
        // 얼마나 떨어졌는지로 '크기 조절'과 '글자 선택'을 가른다.
        const _paper=paperAt(pi); if(!_paper) return;
        const paperR=_paper.getBoundingClientRect(),sc=pageScreenScale(pi);
        const edge = (kind==='col')
            ? Math.abs(e.clientX-(paperR.left+colX(t,idx+1)*sc.x))
            : Math.abs(e.clientY-(paperR.top +rowY(t,idx+1)*sc.y));
        const GRAB=4;                       // 경계선 ±4px = 크기 조절
        if(edge>GRAB){
            // 경계에서 먼 곳 → 그 자리의 칸 글자를 선택한다
            const cell=tblCellAt(pi,e);
            if(cell){
                e.preventDefault(); e.stopPropagation();
                startTblCellSelection(e,pi,cell);
                drag=null;
                return;
            }
        }
        e.preventDefault(); e.stopPropagation();
        pushHistory();
        tblDrag={pi,tid,kind,idx,sx:e.clientX,sy:e.clientY,
                 base:(kind==='col'?t.cw[idx]:t.ch[idx]),
                 next:(kind==='col'?t.cw[idx+1]:t.ch[idx+1]),
                 shift:e.shiftKey, moved:false};
        setActiveTbl(pi,tid,kind==='row'?idx:0,kind==='col'?idx:0);
    }
    // ===== 꼭짓점으로 표 전체 확대/축소 =====
    function startTblScale(e,pi,tid,dir){
        e.preventDefault(); e.stopPropagation();
        const t=findTbl(pi,tid); if(!t) return;
        pushHistory();
        const size=tblSize(t);
        tblScale={pi,tid,dir,sx:e.clientX,sy:e.clientY,
                  ox:t.x,oy:t.y,ow:size.w,oh:size.h,
                  cw:t.cw.slice(),ch:t.ch.slice(),
                  fs:tblCells(pi,tid).map(c=>({id:c.id,fs:c.fontSize||15})),
                  moved:false};
        setActiveTbl(pi,tid,activeTbl&&activeTbl.tid===tid?activeTbl.r:0,
                             activeTbl&&activeTbl.tid===tid?activeTbl.c:0);
    }
    // ===== 변 중앙 손잡이 — 한 축으로만 표 늘리기 =====
    //   위·아래 = 세로(높이)만, 왼·오른쪽 = 가로(너비)만.
    //   행/열 추가는 표 도구 막대(tblBar)에서 하므로 손잡이는 늘리기 전용이다.
    function startTblStretch(e,pi,tid,dir){
        e.preventDefault(); e.stopPropagation();
        const t=findTbl(pi,tid); if(!t) return;
        pushHistory();
        const size=tblSize(t);
        tblScale={pi,tid,dir,sx:e.clientX,sy:e.clientY,
                  ox:t.x,oy:t.y,ow:size.w,oh:size.h,
                  cw:t.cw.slice(),ch:t.ch.slice(),
                  stretch:(dir==='top'||dir==='bottom')?'v':'h',
                  moved:false};
        setActiveTbl(pi,tid,activeTbl&&activeTbl.tid===tid?activeTbl.r:0,
                             activeTbl&&activeTbl.tid===tid?activeTbl.c:0);
    }
    // ===== 표 통째로 이동 =====
    function startTblMove(e,pi,tid){
        e.preventDefault(); e.stopPropagation();
        const t=findTbl(pi,tid),paper=paperAt(pi); if(!t||!paper) return;
        pushHistory();
        deselectAll(true); clearMulti(); clearTblCellSelection();
        // 이동 중에는 데이터/레이어를 매 프레임 재생성하지 않는다. 현재 칸·선·선택틀을
        // 같은 델타로 즉시 움직이고, mouseup에서 한 번만 canonical table로 재구성한다.
        const cells=tblCells(pi,tid).map(el=>paper.querySelector(`.tb[data-id="${el.id}"]`)).filter(Boolean);
        const strokes=(doc.pages[pi].els||[]).filter(el=>el.type==='stroke'&&tblOf(el)===tid)
            .map(el=>paper.querySelector(`.stroke-g[data-id="${el.id}"]`)).filter(Boolean);
        const box=paper.querySelector(`.tbl-box[data-tid="${tid}"]`);
        tblMove={pi,tid,sx:e.clientX,sy:e.clientY,ox:t.x,oy:t.y,moved:false,cells,strokes,box};
        setActiveTbl(pi,tid,0,0);
    }
    function previewTblMove(m,dx,dy){
        const tr=`translate(${dx}px,${dy}px)`;
        m.cells.forEach(n=>{ n.style.transform=tr; });
        m.strokes.forEach(n=>{ n.setAttribute('transform',`translate(${dx},${dy})`); });
        if(m.box) m.box.style.transform=tr;
    }

    // ★ pointermove 로 통합 — 터치 장치에서 표 핸들 즉시 반응
    // 표 리사이즈는 칸/선 DOM을 다시 계산해야 하므로 pointermove 원시 빈도 대신
    // requestAnimationFrame당 한 번만 반영한다. 손가락 이동은 놓치지 않되 화면 깜박임을 줄인다.
    let _tblMoveRaf=0, _tblMovePending=null;
    function _tblEventLite(e){ return {clientX:e.clientX,clientY:e.clientY,shiftKey:!!e.shiftKey,altKey:!!e.altKey}; }
    function _queueTblPointerMove(e){
        if(!(tblDrag||tblScale||tblMove)) return;
        e.preventDefault();
        const ev=_tblEventLite(e);
        if(tblMove&&!tblDrag&&!tblScale){ onTblPointerMoveFrame(ev); return; }
        _tblMovePending=ev;
        if(_tblMoveRaf) return;
        _tblMoveRaf=requestAnimationFrame(()=>{
            _tblMoveRaf=0;
            const ev=_tblMovePending; _tblMovePending=null;
            onTblPointerMoveFrame(ev);
        });
    }
    function _flushTblPointerMove(){
        if(_tblMoveRaf){ cancelAnimationFrame(_tblMoveRaf); _tblMoveRaf=0; }
        const ev=_tblMovePending; _tblMovePending=null;
        onTblPointerMoveFrame(ev);
    }
    sdyAddPointerCompat(document,'pointermove',_queueTblPointerMove);
    function onTblPointerMoveFrame(e){
        if(!e) return;
        // 경계 끌기
        if(tblDrag){
            const t=findTbl(tblDrag.pi,tblDrag.tid); if(!t) return;
            const dd=pageClientDelta(tblDrag.pi,e.clientX-tblDrag.sx,e.clientY-tblDrag.sy);
            const d=tblDrag.kind==='col'?dd.x:dd.y;
            if(Math.abs(d)>2) tblDrag.moved=true;
            const min=tblDrag.kind==='col'?TBL_MINW:TBL_MINH;
            const arr=tblDrag.kind==='col'?t.cw:t.ch;
            if(e.shiftKey&&tblDrag.next!=null){
                // Shift = 옆 칸에서 뺏어온다 (표 전체 폭 유지)
                const tot=tblDrag.base+tblDrag.next;
                const v=Math.max(min,Math.min(tot-min,Math.round(tblDrag.base+d)));
                arr[tblDrag.idx]=v; arr[tblDrag.idx+1]=tot-v;
            }else{
                arr[tblDrag.idx]=Math.max(min,Math.round(tblDrag.base+d));
            }
            rebuildTable(tblDrag.pi,tblDrag.tid,{quiet:true});
            tblRepaint(tblDrag.pi);
            return;
        }
        // 꼭짓점 확대/축소 · 변 중앙 한 축 늘리기
        if(tblScale){
            const t=findTbl(tblScale.pi,tblScale.tid); if(!t) return;
            const dd=pageClientDelta(tblScale.pi,e.clientX-tblScale.sx,e.clientY-tblScale.sy);
            const dx=dd.x,dy=dd.y;
            if(Math.abs(dx)>2||Math.abs(dy)>2) tblScale.moved=true;
            // 14.13.7 · 변 중앙 손잡이: 한 축으로만 늘린다
            //   위·아래 = 세로(높이)만 · 왼·오른쪽 = 가로(너비)만 (전체 비율 유지)
            if(tblScale.stretch){
                if(tblScale.stretch==='v'){
                    const grow=tblScale.dir==='bottom'?dy:-dy;
                    const nh=Math.max(TBL_MINH*tblScale.ch.length, tblScale.oh+grow);
                    const ky=nh/tblScale.oh;
                    t.ch=tblScale.ch.map(v=>Math.max(TBL_MINH,Math.round(v*ky)));
                    if(tblScale.dir==='top') t.y=Math.round(tblScale.oy+tblScale.oh-nh);
                }else{
                    const grow=tblScale.dir==='right'?dx:-dx;
                    const nw=Math.max(TBL_MINW*tblScale.cw.length, tblScale.ow+grow);
                    const kx=nw/tblScale.ow;
                    t.cw=tblScale.cw.map(v=>Math.max(TBL_MINW,Math.round(v*kx)));
                    if(tblScale.dir==='left') t.x=Math.round(tblScale.ox+tblScale.ow-nw);
                }
                rebuildTable(tblScale.pi,tblScale.tid,{quiet:true});
                tblRepaint(tblScale.pi);
                return;
            }
            const west=(tblScale.dir==='nw'||tblScale.dir==='sw'||tblScale.dir==='w');
            const north=(tblScale.dir==='nw'||tblScale.dir==='ne'||tblScale.dir==='n'||tblScale.dir==='w');
            // 꼭짓점은 끄는 대로 (가로·세로 따로) — 비율 고정 없음.
            // Shift 를 누르면 그때만 비율을 유지한다.
            let nw=Math.max(TBL_MINW*tblScale.cw.length, tblScale.ow+(west?-dx:dx));
            let nh=Math.max(TBL_MINH*tblScale.ch.length, tblScale.oh+(north?-dy:dy));
            if(e.shiftKey){
                const k=Math.max(nw/tblScale.ow, nh/tblScale.oh);
                nw=tblScale.ow*k; nh=tblScale.oh*k;
            }
            const kx=nw/tblScale.ow, ky=nh/tblScale.oh;
            t.cw=tblScale.cw.map(v=>Math.max(TBL_MINW,Math.round(v*kx)));
            t.ch=tblScale.ch.map(v=>Math.max(TBL_MINH,Math.round(v*ky)));
            const s=tblSize(t);
            // 변 중앙 손잡이(n/s/w/e)는 반대축을 중앙 기준으로 늘린다
            if(tblScale.dir==='n'||tblScale.dir==='s'){
                t.x=Math.round(tblScale.ox+(tblScale.ow-s.w)/2);
            }else{
                t.x=Math.round(west ? tblScale.ox+tblScale.ow-s.w : tblScale.ox);
            }
            if(tblScale.dir==='w'||tblScale.dir==='e'){
                t.y=Math.round(tblScale.oy+(tblScale.oh-s.h)/2);
            }else{
                t.y=Math.round(north? tblScale.oy+tblScale.oh-s.h : tblScale.oy);
            }
            // 글자 크기는 비율을 유지할 때(Shift)만 함께 조절한다
            if(e.shiftKey){
                const kf=Math.min(kx,ky);
                const map={}; tblScale.fs.forEach(f=>map[f.id]=f.fs);
                tblCells(tblScale.pi,tblScale.tid).forEach(c=>{
                    if(map[c.id]) c.fontSize=Math.max(2,Math.min(200,Math.round(map[c.id]*kf)));
                });
            }
            rebuildTable(tblScale.pi,tblScale.tid,{quiet:true});
            tblRepaint(tblScale.pi);
            return;
        }
        // 표 이동
        if(tblMove){
            const t=findTbl(tblMove.pi,tblMove.tid); if(!t) return;
            const dd=pageClientDelta(tblMove.pi,e.clientX-tblMove.sx,e.clientY-tblMove.sy);
            const dx=Math.round(dd.x),dy=Math.round(dd.y);
            if(Math.abs(dx)>2||Math.abs(dy)>2) tblMove.moved=true;
            tblMove.dx=dx; tblMove.dy=dy;
            previewTblMove(tblMove,dx,dy);
            return;
        }
    }
    // ★ pointerup 로 통합 — 터치 장치에서 표 핸들 놓기 즉시 반응
    document.addEventListener('pointerup',e=>{ sdyMarkPointerEvent(); onTblPointerUp(e); });
    document.addEventListener('pointercancel',e=>{ sdyMarkPointerEvent(); onTblPointerUp(e); });
    document.addEventListener('mouseup',e=>{ if(sdyIgnoreCompatMouse()) return; onTblPointerUp(e); });
    function onTblPointerUp(){
        _flushTblPointerMove();
        let pi=null;
        if(tblDrag){ pi=tblDrag.pi; if(tblDrag.moved){ markPageEdited(pi); saveDoc(); } tblDrag=null; }
        if(tblScale){ pi=tblScale.pi; if(tblScale.moved){ markPageEdited(pi); saveDoc(); } tblScale=null; }
        if(tblMove){
            pi=tblMove.pi;
            const t=findTbl(tblMove.pi,tblMove.tid);
            if(t&&tblMove.moved){ t.x=tblMove.ox+(tblMove.dx||0); t.y=tblMove.oy+(tblMove.dy||0); }
            else if(t){ t.x=tblMove.ox; t.y=tblMove.oy; }
            rebuildTable(tblMove.pi,tblMove.tid,{quiet:true});
            renderPageEls(tblMove.pi);
            if(tblMove.moved){ markPageEdited(pi); saveDoc(); }
            tblMove=null;
        }
        if(pi!=null){ renderTblDivs(pi); positionTblBar(); }
    }

    // ===== 표 도구 막대 =====
    function setActiveTbl(pi,tid,r,c){
        const changed=!activeTbl||activeTbl.tid!==tid||activeTbl.pageIdx!==pi;
        activeTbl={pageIdx:pi,tid,r:r||0,c:c||0};
        const bar=document.getElementById('tblBar');
        if(bar) bar.classList.add('show');
        // 표를 고르면 요소 선택은 풀어 Delete 가 표를 지우도록
        document.querySelectorAll('.tbl-box.on').forEach(n=>n.classList.remove('on'));
        const box=document.querySelector(`.layer-tbl .tbl-box[data-tid="${tid}"]`);
        if(box) box.classList.add('on');
        positionTblBar();
        return changed;
    }
    function clearActiveTbl(){
        activeTbl=null;
        clearTblCellSelection();
        const bar=document.getElementById('tblBar');
        if(bar) bar.classList.remove('show');
        document.querySelectorAll('.tbl-box.on').forEach(n=>n.classList.remove('on'));
    }
    function positionTblBar(){
        const bar=document.getElementById('tblBar');
        if(!bar||!activeTbl) return;
        const t=findTbl(activeTbl.pageIdx,activeTbl.tid);
        const paper=paperAt(activeTbl.pageIdx);
        if(!t||!paper){ clearActiveTbl(); return; }
        const r=paper.getBoundingClientRect(),sc=pageScreenScale(activeTbl.pageIdx),k=uiCssZoom();
        // 종이 기준 화면 px 로 자리를 구한 뒤, 막대가 쓰는 CSS px 로 한 번에 바꾼다.
        let left=uiCss(r.left+t.x*sc.x);         // 별도 이동 손잡이가 없어 표 왼쪽 기준에 맞춘다
        let top=uiCss(r.top+t.y*sc.y-48);
        if(top<uiCss(64)) top=uiCss(r.top+(t.y+tblSize(t).h)*sc.y+14);
        left=Math.max(uiCss(8),Math.min(left,uiCss(innerWidth-8)-(bar.offsetWidth||0)));
        top=Math.max(uiCss(60),Math.min(top,uiCss(innerHeight)-52));
        bar.style.left=left+'px'; bar.style.top=top+'px';
    }
    // 표 안을 누르면 표 도구를 띄우고, 밖을 누르면 감춘다
    function tblTouch(e,pi,t){
        const host=t.closest('.tb')||t.closest('.stroke-g');
        if(host){
            const el=findEl(pi,host.dataset.id);
            const tid=tblOf(el);
            if(tid){
                setActiveTbl(pi,tid,(el.tbl&&el.tbl.r)||0,(el.tbl&&el.tbl.c)||0);
                return;
            }
        }
        if(!t.closest('.tbl-box')&&!t.closest('.tbl-bar')) clearActiveTbl();
    }
    // 표가 '선택된 상태'인지 (칸을 편집 중이면 아니다)
    function tblSelectedForDelete(){
        return !!activeTbl && !tblCellSelection && !document.querySelector('.tb.edit')
               && !selected && !multiSel.length;
    }

    function tblAdd(kind,dir){
        if(!activeTbl){ toast('표 안을 먼저 눌러 주세요',1600); return; }
        const {pageIdx:pi,tid}=activeTbl;
        const t=findTbl(pi,tid); if(!t) return;
        pushHistory(); clearTblCellSelection();
        const list=doc.pages[pi].els||[];
        if(kind==='row'){
            if(t.ch.length>=40){ toast('행은 40개까지입니다',1600); return; }
            const at=Math.max(0,Math.min(t.ch.length,activeTbl.r+(dir>0?1:0)));
            t.ch.splice(at,0,t.ch[activeTbl.r]||40);
            list.forEach(e=>{ if(e.type==='text'&&tblOf(e)===tid&&e.tbl.r>=at) e.tbl.r++; });
            activeTbl.r=at;
        }else{
            if(t.cw.length>=20){ toast('열은 20개까지입니다',1600); return; }
            const at=Math.max(0,Math.min(t.cw.length,activeTbl.c+(dir>0?1:0)));
            t.cw.splice(at,0,t.cw[activeTbl.c]||120);
            list.forEach(e=>{ if(e.type==='text'&&tblOf(e)===tid&&e.tbl.c>=at) e.tbl.c++; });
            activeTbl.c=at;
        }
        rebuildTable(pi,tid);
        positionTblBar();
        toast(kind==='row'?'행을 추가했습니다':'열을 추가했습니다',1200);
    }
    function tblDel(kind){
        if(!activeTbl){ toast('표 안을 먼저 눌러 주세요',1600); return; }
        const {pageIdx:pi,tid}=activeTbl;
        const t=findTbl(pi,tid); if(!t) return;
        if(kind==='row'&&t.ch.length<=1){ tblDelAll(); return; }
        if(kind==='col'&&t.cw.length<=1){ tblDelAll(); return; }
        pushHistory(); clearTblCellSelection();
        const at=kind==='row'?activeTbl.r:activeTbl.c;
        if(kind==='row') t.ch.splice(at,1); else t.cw.splice(at,1);
        doc.pages[pi].els=(doc.pages[pi].els||[]).filter(e=>{
            if(!(e.type==='text'&&tblOf(e)===tid)) return true;
            return kind==='row'? e.tbl.r!==at : e.tbl.c!==at;
        });
        doc.pages[pi].els.forEach(e=>{
            if(e.type==='text'&&tblOf(e)===tid){
                if(kind==='row'&&e.tbl.r>at) e.tbl.r--;
                if(kind==='col'&&e.tbl.c>at) e.tbl.c--;
            }
        });
        if(kind==='row') activeTbl.r=Math.min(at,t.ch.length-1);
        else             activeTbl.c=Math.min(at,t.cw.length-1);
        rebuildTable(pi,tid);
        positionTblBar();
        toast(kind==='row'?'행을 지웠습니다':'열을 지웠습니다',1200);
    }
    function tblFit(){
        if(!activeTbl) return;
        const t=findTbl(activeTbl.pageIdx,activeTbl.tid); if(!t) return;
        pushHistory();
        const s=tblSize(t);
        const w=Math.max(TBL_MINW,Math.round(s.w/t.cw.length));
        const h=Math.max(TBL_MINH,Math.round(s.h/t.ch.length));
        t.cw=t.cw.map(()=>w); t.ch=t.ch.map(()=>h);
        rebuildTable(activeTbl.pageIdx,activeTbl.tid);
        renderTblDivs(activeTbl.pageIdx);
        positionTblBar();
        toast('칸 크기를 고르게 맞췄습니다',1300);
    }
    function tblDelAll(noAsk, optTid, optPi){
        let pi = optPi, tid = optTid;
        if(!tid && activeTbl){ pi = activeTbl.pageIdx; tid = activeTbl.tid; }
        if(!tid && selected && selected.el){
            const lid = selected.el.dataset.id, lpi = +selected.el.dataset.pageIdx;
            const el = findEl(lpi, lid);
            if(el && tblOf(el)){ pi = lpi; tid = tblOf(el); }
        }
        if(!tid) return;
        if(pi == null) pi = curPageIdx;
        if(!noAsk && !confirm('표를 통째로 삭제할까요?')) return;
        const table=findTbl(pi,tid);
        const group=(table&&table.group)||('g_'+tid);
        const selectedWasInTable=!!(selected&&selected.el&&(()=>{
            const el=findEl(+selected.el.dataset.pageIdx,selected.el.dataset.id);
            return el&&(tblOf(el)===tid||el.group===group);
        })());
        pushHistory();
        // 셀, 실제 테두리 stroke, 선택용 거터/손잡이까지 같은 표에 속한 것은 전부 제거한다.
        doc.pages[pi].els = (doc.pages[pi].els || []).filter(e => tblOf(e) !== tid && e.group !== group);
        doc.pages[pi].tables = (pageTables(pi) || []).filter(x => x.id !== tid);
        document.querySelectorAll('.layer-tbl .tbl-box').forEach(n=>{ if(n.dataset.tid===String(tid)) n.remove(); });
        // 18.9 · 없는 함수(clearSel)를 부르는 바람에 '표 전체 삭제'가 도중에
        //   ReferenceError 로 멈춰, 화면에는 표가 남고 저장도 안 되던 버그.
        if(selectedWasInTable){ deselectAll(true); clearMulti(); selected=null; }
        clearActiveTbl();
        markPageEdited(pi); renderPageEls(pi); renderTblDivs(pi); saveDoc();
        toast('표를 삭제했습니다 (Ctrl+Z 로 되돌리기)', 1800);
    }
    // 표를 통째로 옮기면 표 정보의 기준점도 함께 움직인다
    function shiftTable(pi,tid,dx,dy){
        const t=findTbl(pi,tid); if(!t) return;
        t.x=Math.round(t.x+dx); t.y=Math.round(t.y+dy);
    }
    // 이동/스냅이 끝난 뒤 칸 좌표에서 표 기준점을 다시 계산
    function syncTableFromCells(pi,tid){
        const t=findTbl(pi,tid); if(!t) return;
        const c0=tblCells(pi,tid).find(e=>e.tbl.r===0&&e.tbl.c===0);
        if(!c0) return;
        t.x=Math.round(c0.x-3); t.y=Math.round(c0.y-3);
    }
    function syncAllTables(pi){ pageTables(pi).forEach(t=>syncTableFromCells(pi,t.id)); }

    // ==========================================================
    //  문서에서 찾기 (Ctrl + F)
    // ==========================================================
    let findOpen=false, findHits=[], findCur=-1, findQ='';
    function toggleFind(){ findOpen?closeFind():openFind(); }
    function openFind(){
        if(!doc) return;
        findOpen=true;
        // 20.0 · 찾기는 글자 DOM 위에 하이라이트를 칠한다 → 보이는 쪽을 깨운다.
        try{ activateVisiblePages(); }catch(_e){}
        document.getElementById('findBar').classList.add('show');
        const i=document.getElementById('findInput');
        i.focus(); i.select();
        if(i.value) runFind(i.value);
    }
    function closeFind(){
        findOpen=false; findHits=[]; findCur=-1; findQ='';
        document.getElementById('findBar').classList.remove('show');
        document.getElementById('findCount').textContent='0';
        document.querySelectorAll('.find-layer').forEach(l=>l.innerHTML='');
    }
    // 글상자의 순수 글자. 찾기·개요·통계·단어분석이 같은 요소를 몇 번씩 묻기
    // 때문에 500쪽 문서에서는 이 HTML 파싱이 통째로 렉이 된다 → html 이 그대로면
    // 지난 결과를 돌려준다(요소가 사라지면 WeakMap 이 알아서 비운다).
    const _plainCache=new WeakMap();
    function elPlainText(el){
        if(!el) return '';
        if(el.type==='latex') return el.latex||'';
        const html=el.html||'';
        const hit=_plainCache.get(el);
        if(hit&&hit.html===html) return hit.text;
        const d=document.createElement('div'); d.innerHTML=html;
        const text=d.textContent||'';
        try{ _plainCache.set(el,{html,text}); }catch(e){}
        return text;
    }
    function runFind(q){
        findQ=(q||'');
        findHits=[]; findCur=-1;
        const needle=findQ.trim().toLowerCase();
        if(!doc||needle.length<1){
            document.getElementById('findCount').textContent='0';
            document.querySelectorAll('.find-layer').forEach(l=>l.innerHTML='');
            return;
        }
        doc.pages.forEach((pg,pi)=>{
            (pg.els||[]).forEach(el=>{
                if(el.type!=='text') return;
                const txt=elPlainText(el).toLowerCase();
                let from=0, at;
                while((at=txt.indexOf(needle,from))>=0){
                    findHits.push({pageIdx:pi,id:el.id,start:at,len:needle.length});
                    from=at+Math.max(1,needle.length);
                    if(findHits.length>800) break;
                }
            });
        });
        if(findHits.length){
            // 지금 보는 페이지에서 가장 가까운 것부터
            let i=findHits.findIndex(h=>h.pageIdx>=curPageIdx);
            findCur=i<0?0:i;
        }
        updateFindCount();
        paintFindHits();
        if(findCur>=0) revealHit(findHits[findCur],true);
    }
    function updateFindCount(){
        const n=findHits.length;
        document.getElementById('findCount').textContent=
            n? `${findCur+1} / ${n}` : (findQ.trim()?'없음':'0');
    }
    function findStep(d){
        if(!findHits.length){ if(findQ.trim()) toast('찾는 글자가 없습니다',1400); return; }
        findCur=(findCur+d+findHits.length)%findHits.length;
        updateFindCount();
        revealHit(findHits[findCur],false);
        paintFindHits();
    }
    function findKey(e){
        if(e.key==='Enter'){
            e.preventDefault(); e.stopPropagation();
            findStep(e.shiftKey?-1:1);
        }else if(e.key==='Escape'){
            e.preventDefault(); e.stopPropagation();
            closeFind();
        }else{
            // 글자 입력은 에디터 단축키(Delete 등)로 새어 나가면 안 된다
            e.stopPropagation();
        }
    }
    // 글자 위치를 실제 화면에서 재서 형광 사각형을 만든다
    function hitRects(hit){
        const paper=paperAt(hit.pageIdx); if(!paper) return [];
        const node=paper.querySelector(`.tb[data-id="${hit.id}"] .tb-content`);
        if(!node) return [];
        const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT,null);
        let acc=0, range=document.createRange(), started=false, n;
        const end=hit.start+hit.len;
        while((n=walker.nextNode())){
            const len=n.nodeValue.length;
            if(!started && acc+len>hit.start){
                range.setStart(n,Math.max(0,hit.start-acc)); started=true;
            }
            if(started && acc+len>=end){
                range.setEnd(n,Math.max(0,Math.min(len,end-acc)));
                break;
            }
            acc+=len;
        }
        if(!started) return [];
        const pr=paper.getBoundingClientRect(),sc=pageScreenScale(hit.pageIdx);
        if(typeof range.getClientRects!=='function') return [];   // 18.9 · 구형 웹뷰 방어
        return Array.from(range.getClientRects()).map(r=>({
            x:(r.left-pr.left)/sc.x, y:(r.top-pr.top)/sc.y,
            w:r.width/sc.x, h:r.height/sc.y }));
    }
    function paintFindHits(){
        document.querySelectorAll('.find-layer').forEach(l=>l.innerHTML='');
        if(!findOpen||!findHits.length) return;
        findHits.forEach((h,i)=>{
            // 화면에 올라와 있는 쪽만 칠한다 (가상화된 쪽은 다시 그릴 때 복원된다)
            if(!mountedShells.has(h.pageIdx)) return;
            const paper=paperAt(h.pageIdx); if(!paper) return;
            const layer=paper.querySelector('.find-layer'); if(!layer) return;
            hitRects(h).forEach(r=>{
                const d=document.createElement('div');
                d.className='find-hit'+(i===findCur?' cur':'');
                d.style.cssText=`left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;`;
                layer.appendChild(d);
            });
        });
    }
    function revealHit(hit,soft){
        if(!hit) return;
        const body=document.getElementById('editorBody');
        const size=paperSize();
        const el=findEl(hit.pageIdx,hit.id);
        const top=(hit.pageIdx*(size.h+PAGE_GAP)+((el&&el.y)||0))*pageScale;
        const far=Math.abs(hit.pageIdx-(curPageIdx|0))>2;
        curPageIdx=hit.pageIdx; updatePageInfo();
        maintainPageWindow(hit.pageIdx,true);
        _scrollBodyTo(body,Math.max(0,top-body.clientHeight*0.35),(soft||far)?'auto':'smooth');
        setTimeout(paintFindHits,soft?60:320);
    }

    // 18.9 · scrollTo 가 없는 환경(구형 웹뷰·테스트 DOM)에서도 스크롤이 죽지 않게
    function _scrollBodyTo(body,top,behavior){
        if(!body) return;
        try{
            if(typeof body.scrollTo==='function'){ body.scrollTo({top,behavior}); return; }
        }catch(e){}
        try{ body.scrollTop=top; }catch(e){}
    }

    // ==========================================================
    //  페이지 바로가기 · 즐겨찾는 페이지
    // ==========================================================
    function goToPage(n){
        if(!doc) return;
        let i=parseInt(String(n),10);
        if(isNaN(i)){ updatePageInfo(); return; }
        i=Math.max(1,Math.min(doc.pages.length,i))-1;
        const body=document.getElementById('editorBody');
        const size=paperSize();
        const far=Math.abs(i-(curPageIdx|0))>2;
        curPageIdx=i; updatePageInfo();
        // 먼 점프를 smooth로 하면 중간 수십 쪽이 차례로 로드되므로 즉시 이동한다.
        maintainPageWindow(i,true);
        _scrollBodyTo(body,i*(size.h+PAGE_GAP)*pageScale,far?'auto':'smooth');
    }
    function favList(){
        if(!doc) return [];
        if(!Array.isArray(doc.favPages)) doc.favPages=[];
        return doc.favPages;
    }
    function curPageId(){ const p=doc&&doc.pages[curPageIdx]; return p?p.id:null; }
    function isFavPage(pid){ return favList().indexOf(pid)>=0; }
    function toggleFavPage(){
        if(!doc) return;
        const pid=curPageId(); if(!pid) return;
        const l=favList(); const i=l.indexOf(pid);
        if(i>=0){ l.splice(i,1); toast('즐겨찾기에서 뺐습니다',1200); }
        else { l.push(pid); toast(`페이지 ${curPageIdx+1} 즐겨찾기 ⭐`,1300); }
        saveDoc(); updatePageInfo(); renderFavPop();
    }
    function pagePreview(pg){
        let s='';
        (pg.els||[]).forEach(e=>{
            if(s.length>26||e.type!=='text') return;
            const t=elPlainText(e).trim();
            if(t) s+=(s?' ':'')+t;
        });
        s=s.replace(/\s+/g,' ').trim();
        return s? (s.length>26?s.slice(0,26)+'…':s) : '(빈 페이지)';
    }
    function renderFavPop(){
        const pop=document.getElementById('favPop'); if(!pop) return;
        const l=favList();
        if(!l.length){
            pop.innerHTML=`<div style="padding:14px 12px;font-size:12px;color:var(--text3);text-align:center;line-height:1.6;">
                즐겨찾는 페이지가 없습니다<br>별(<i class="ri-star-line"></i>) 을 눌러 지금 페이지를 담아 보세요</div>`;
            return;
        }
        let html='';
        l.forEach(pid=>{
            const i=doc.pages.findIndex(p=>p.id===pid);
            if(i<0) return;
            html+=`<div class="fav-item" data-pid="${pid}"
                     onclick="jumpFav('${pid}')"
                     ontouchstart="favDown(event,'${pid}')"
                     ontouchmove="favMove(event)"
                     ontouchend="favUp(event)"
                     ontouchcancel="favCancel(event)"
                     onmousedown="favDown(event,'${pid}')">
                     <i class="ri-draggable fav-drag" title="꾹 눌러 끌어서 순서 변경"></i>
                     <i class="ri-star-fill" style="color:#f59e0b;font-size:13px;"></i>
                     <b style="flex:none;">${i+1}쪽</b>
                     <span style="color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(pagePreview(doc.pages[i]))}</span>
                     <i class="ri-close-line" title="빼기" style="margin-left:auto;color:var(--text3);"
                        onclick="event.stopPropagation();removeFav('${pid}')"></i>
                   </div>`;
        });
        pop.innerHTML=html||`<div style="padding:12px;font-size:12px;color:var(--text3);">표시할 페이지가 없습니다</div>`;
    }
    function jumpFav(pid){
        if(favJustDragged){ favJustDragged=false; return; }
        const i=doc.pages.findIndex(p=>p.id===pid);
        if(i<0){ toast('지워진 페이지입니다',1400); return; }
        goToPage(i+1);
        document.getElementById('favPop').classList.remove('show');
    }
    function removeFav(pid){
        const l=favList(); const i=l.indexOf(pid);
        if(i>=0){ l.splice(i,1); saveDoc(); updatePageInfo(); renderFavPop(); }
    }

    // ===== 북마크(즐겨찾는 쪽) 꾹 눌러 끌어서 순서 바꾸기 =====
    // 10.0 · 예전에는 작은 ⋮ 핸들만 즉시 끌 수 있었는데, 폰에서는 목록 스크롤과
    //   포인터가 서로 싸우면서(pointercancel) 거의 작동하지 않았다.
    //   이제 '항목 어디든 0.38초 꾹 누른 뒤 움직여 놓으면' 놓은 자리에 순서가 바뀐다.
    let favDrag=null, favJustDragged=false, favLP=null, favSX=0, favSY=0;
    function favDown(e,pid){
        const item=e.currentTarget.closest('.fav-item');
        if(!item) return;
        const pt=e.touches?e.touches[0]:e;
        favSX=pt.clientX; favSY=pt.clientY;
        clearTimeout(favLP);
        favLP=setTimeout(()=>{ favLP=null; beginFavDrag(item,pt); },380);
    }
    function favPressCancel(e){
        if(!favLP) return;
        const pt=e.touches?e.touches[0]:e;
        if(Math.abs(pt.clientX-favSX)>8||Math.abs(pt.clientY-favSY)>8){ clearTimeout(favLP); favLP=null; }
    }
    function beginFavDrag(item,pt){
        const pop=document.getElementById('favPop');
        favDrag={item,pop,popScroll:pop?pop.scrollTop:0,baseY:pt.clientY,moved:false};
        item.style.opacity='.45'; item.style.cursor='grabbing';
        if(navigator.vibrate) navigator.vibrate(18);
        toast('끌어서 순서를 바꾸세요',1400);
    }
    function favMove(e){
        if(!favDrag){ favPressCancel(e); return; }
        const pt=e.touches?e.touches[0]:e;
        try{ e.preventDefault(); }catch(err){}
        // .fav-item 은 touch-action:pan-y 라 세로 스크롤은 preventDefault 로 못 막는다.
        // 브라우저가 팝업을 스크롤시킨 만큼 되돌려 화면이 흔들리지 않게 한다.
        if(favDrag.pop&&favDrag.pop.scrollTop!==favDrag.popScroll) favDrag.pop.scrollTop=favDrag.popScroll;
        if(Math.abs(pt.clientY-favDrag.baseY)>6) favDrag.moved=true;
        const el=document.elementFromPoint(pt.clientX,pt.clientY);
        const over=el&&el.closest('.fav-item');
        if(over&&over!==favDrag.item){
            const r=over.getBoundingClientRect();
            const before=pt.clientY<r.top+r.height/2;
            over.parentElement.insertBefore(favDrag.item,before?over:over.nextSibling);
        }
    }
    function favUp(e){
        clearTimeout(favLP); favLP=null;
        if(!favDrag) return;
        const d=favDrag; favDrag=null;
        d.item.style.opacity=''; d.item.style.cursor='';
        if(!d.moved){                           // 꾹 눌렀다 뗐을 뿐이면 뒤따르는 클릭만 삼킨다
            favJustDragged=true;
            setTimeout(()=>{ favJustDragged=false; },350);
            return;
        }
        favJustDragged=true;
        setTimeout(()=>{ favJustDragged=false; },350);
        const pop=document.getElementById('favPop');
        const order=[...pop.querySelectorAll('.fav-item')].map(n=>n.dataset.pid);
        const l=favList();
        l.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
        saveDoc(); renderFavPop();
    }
    function favCancel(){
        clearTimeout(favLP); favLP=null;
        if(favDrag){ favDrag.item.style.opacity=''; favDrag.item.style.cursor=''; favDrag=null; }
    }
    // ★ pointermove/pointerup 로 통합 — 터치 장치에서 즉시 반응
    document.addEventListener('pointermove',e=>{ if(favDrag||favLP) favMove(e); });
    document.addEventListener('pointerup',()=>{ if(favDrag) favUp(); });
    function toggleFavPop(e){
        const pop=document.getElementById('favPop');
        if(pop.classList.contains('show')){ pop.classList.remove('show'); return; }
        renderFavPop();
        pop.classList.add('show');
        const r=(e&&e.currentTarget||document.getElementById('favListBtn')).getBoundingClientRect();
        pop.style.left=Math.max(8,Math.min(r.left-90,innerWidth-pop.offsetWidth-8))+'px';
        pop.style.top=(r.bottom+6)+'px';
    }
    // ★ pointerdown 으로 변경 — 터치 장치에서 팝업 닫힘 즉시 반응
    document.addEventListener('pointerdown',e=>{
        const pop=document.getElementById('favPop');
        if(pop&&pop.classList.contains('show')&&!e.target.closest('#favPop')&&!e.target.closest('#favListBtn'))
            pop.classList.remove('show');
        const tp=document.getElementById('tintPop');
        if(tp&&tp.classList.contains('show')&&!e.target.closest('#tintPop')&&!e.target.closest('#tintBtn'))
            tp.classList.remove('show');
        const pp=document.getElementById('pinPop');
        if(pp&&pp.classList.contains('show')&&!e.target.closest('#pinPop')&&!e.target.closest('.pin'))
            closePin();
    });

    function tableInsertSize(rows,cols){
        rows=Math.max(1,Math.min(40,rows|0)); cols=Math.max(1,Math.min(20,cols|0));
        const size=paperSize();
        const cw=Math.min(150,Math.max(TBL_MINW,Math.floor((size.w-120)/cols)));
        const ch=40;
        return {rows,cols,cw,ch,w:cw*cols,h:ch*rows};
    }
    // 미리보기와 실제 삽입이 반드시 같은 종이 안쪽 경계를 사용한다.
    function clampTableOrigin(dim,x,y){
        const size=paperSize();
        return {
            x:Math.max(8,Math.min(Math.round(x),Math.max(8,size.w-dim.w-8))),
            y:Math.max(8,Math.min(Math.round(y),Math.max(8,size.h-dim.h-8)))
        };
    }
    function insertTable(rows,cols,pageIdx,x,y){
        const dim=tableInsertSize(rows,cols);
        rows=dim.rows; cols=dim.cols;
        const pi=(pageIdx==null?curPageIdx:pageIdx);
        const size=paperSize(),cw=dim.cw,ch=dim.ch;
        const origin=clampTableOrigin(dim,
            x==null?(size.w-dim.w)/2:x,
            y==null?120:y);
        const ox=origin.x, oy=origin.y;

        pushHistory();
        const tid='tb_'+Math.random().toString(36).slice(2,9);
        pageTables(pi).push({
            id:tid, x:ox, y:oy,
            cw:Array.from({length:cols},()=>cw),
            ch:Array.from({length:rows},()=>ch),
            color:'#9aa1ab', lw:1.2, group:'g_'+tid
        });
        rebuildTable(pi,tid);
        setActiveTbl(pi,tid,0,0);
        toast(rows+'행 '+cols+'열 표 · 경계선을 끌어 크기 조절',2400);
    }
    // ==========================================================
    //  세로 도구막대 (Task 29) + 새 기능 10가지
    // ==========================================================
    let sideOpen=true, sidePanel=null;

    // ===== 암기 카드 =====
    // 14.38+ · src/cards.js 로 분리. HTML onclick / live-updates 는 window.* 를 쓴다.
    // (openCards·closeCards·loadDecks·flushCardGrades·fcard* 등)


    // ===== 서버 상태 계기판 + 알림 센터 =====
    // 14.38+ · src/server-status.js 로 분리 (openSrvPop · toggleNotifications · srvStart …)


/* APP-PART:08b-table.js:END */
