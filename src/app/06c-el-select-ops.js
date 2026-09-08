/* === src/app/06c-el-select-ops.js ===
   드래그 다중선택 · 그룹 · 요소 클립보드
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:06c-el-select-ops.js:BEGIN */
    // ============ 드래그 다중 선택 (완전히 포함된 객체만) ============
    let marquee=null, multiSel=[];

    // ===== 선택된 요소들을 '한 덩어리'로 다루기 =====
    // 여러 개를 골랐을 때 통째로 비율을 유지한 채 키우거나 줄인다.
    // 펜으로 그린 획도 점 좌표를 함께 배율 조정해 모양이 찌그러지지 않는다.
    function selEntries(){
        if(multiSel.length) return multiSel.map(m=>({id:m.id,pageIdx:m.pageIdx,node:m.node}));
        if(selected&&selected.el) return [{id:selected.el.dataset.id,
            pageIdx:+selected.el.dataset.pageIdx,node:selected.el}];
        return [];
    }
    function unionBBox(items,pi){
        let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9,any=false;
        items.forEach(it=>{
            const el=findEl(it.pageIdx!=null?it.pageIdx:pi,it.id); if(!el) return;
            const b=elBBox(el); if(!b) return;
            any=true;
            x0=Math.min(x0,b.x); y0=Math.min(y0,b.y);
            x1=Math.max(x1,b.x+b.w); y1=Math.max(y1,b.y+b.h);
        });
        return any?{x:x0,y:y0,w:x1-x0,h:y1-y0}:null;
    }
    // 묶음 전체를 기준점(cx,cy) 중심으로 f 배 확대/축소
    function scaleSelection(f,items){
        items=items||selEntries();
        if(!items.length) return false;
        const pi=items[0].pageIdx;
        const bb=unionBBox(items,pi); if(!bb) return false;
        const cx=bb.x+bb.w/2, cy=bb.y+bb.h/2;
        // 너무 작아지거나 커지지 않게
        if(f<1 && Math.min(bb.w,bb.h)*f<12) return false;
        if(f>1 && Math.max(bb.w,bb.h)*f>4000) return false;
        let lastFS=0;        // 마지막으로 키운/줄인 글상자의 글자 크기 (툴바 동기화용)
        items.forEach(it=>{
            const el=findEl(it.pageIdx,it.id); if(!el) return;
            if(el.type==='stroke'){
                const dx=el.dx||0, dy=el.dy||0;
                el.pts=(el.pts||[]).map(p=>[
                    cx+((p[0]+dx)-cx)*f - dx,
                    cy+((p[1]+dy)-cy)*f - dy ]);
                el.size=Math.max(.5,(el.size||2)*f);
                const node=it.node;
                if(node){
                    const d=strokePath(el.pts,el.sharp&&!isEllipsePts(el.pts));
                    node.querySelectorAll('path').forEach(pn=>pn.setAttribute('d',d));
                    const fp=paperQ(it.pageIdx,`.stroke-fill[data-for="${el.id}"]`); if(fp) fp.setAttribute('d',d);
                    syncStrokeTransform(el,node,it.pageIdx);
                    const vis=node.querySelector('.stroke-vis');
                    if(vis) vis.setAttribute('stroke-width',el.size);
                    const halo=node.querySelector('.stroke-halo');
                    if(halo) halo.setAttribute('stroke-width',el.size+8);
                    const hit=node.querySelector('.stroke-hit');
                    if(hit) hit.setAttribute('stroke-width',Math.max(8,el.size+6));
                }
            }else{
                const nw=Math.max(12,(el.w||1)*f), nh=Math.max(12,(el.h||1)*f);
                el.x=Math.round(cx+((el.x||0)-cx)*f);
                el.y=Math.round(cy+((el.y||0)-cy)*f);
                el.w=Math.round(nw); el.h=Math.round(nh);
                // 14.16 · Alt+휠로 상자를 키우면 겉모양만 커지고 글씨는 옛 크기로
                //   남아, 그 뒤 '+' 를 누르면 툴바의 낡은 값(처음 16)으로 되돌아갔다.
                //   → 상자에 적용한 배율을 '그 상자의 글자 크기'로 같이 저장한다.
                if(el.type==='text'){
                    el.fontSize=Math.max(6,Math.round((el.fontSize||16)*f));
                    lastFS=el.fontSize;
                }
                const node=it.node;
                if(node){
                    node.style.left=el.x+'px'; node.style.top=el.y+'px';
                    node.style.width=el.w+'px'; node.style.height=el.h+'px';
                    const c=node.querySelector('.tb-content');
                    if(c&&el.type==='text'&&el.fontSize){
                        c.style.fontSize=el.fontSize+'px';
                        // 상자 안에서 '이 단어만' 키워 둔 글자도 같은 배율로 함께
                        // (타이핑 닻도 함께 걷어낸다 — 문서에 남지 않게)
                        if(scaleInlineFS(c,f)) el.html=_stripTypingMarkersHtml(imathCollapse(stripWF(c.innerHTML)));
                    }
                }
            }
        });
        // 방금 바뀐 글자 크기를 툴바에도 옮겨 둔다 → 이어서 '+' 를 눌러도
        //   지금 보이는 크기에서 더 커진다 (작아지지 않는다).
        if(lastFS) setToolbarFS(lastFS);
        return true;
    }
    // 한 점(px,py)을 중심(cx,cy) 기준으로 deg 도만큼 회전한 좌표를 돌려준다.
    function _rotPt(px,py,cx,cy,deg){
        if(!deg) return [px,py];
        const r=deg*Math.PI/180, c=Math.cos(r), s=Math.sin(r);
        const dx=px-cx, dy=py-cy;
        return [cx + dx*c - dy*s, cy + dx*s + dy*c];
    }
    // 묶음 회전: 선택한 여러 요소를 '하나의 덩어리'로 보고 공통 피벗(묶음
    // 바운딩 박스의 중심) 둘레로 강체처럼 함께 돌린다. Alt(비율 크기조절)가
    // 묶음을 그대로 키우는 것과 같은 느낌 — 각 요소가 제자리에서 따로
    // 돌지 않고, 배치 그대로 피벗 주위를 공전한다.
    function rotateSelection(delta,items){
        items=items||selEntries();
        if(!items.length) return false;
        const pi=items[0].pageIdx;
        const bb=unionBBox(items,pi); if(!bb) return false;
        const cx=bb.x+bb.w/2, cy=bb.y+bb.h/2;   // 공통 피벗
        items.forEach(it=>{
            const el=findEl(it.pageIdx,it.id); if(!el) return;
            if(el.type==='stroke'){
                // 획은 '자신의 중심' 기준 회전(a) + (dx,dy) 이동으로 그려진다.
                // 피벗 둘레 강체 회전 = 획 중심을 피벗 주위로 공전 + a 에 delta 가산.
                const bbL=strokeBBox(el);
                const Cx=bbL.x+bbL.w/2, Cy=bbL.y+bbL.h/2;   // 획 로컬 중심
                const dx=el.dx||0, dy=el.dy||0;
                const Sx=Cx+dx, Sy=Cy+dy;                    // 현재 페이지 중심
                const [nsx,nsy]=_rotPt(Sx,Sy,cx,cy,delta);
                el.dx=nsx-Cx; el.dy=nsy-Cy;
                el.rotation=normalizedRotation((Number(el.rotation)||0)+delta);
                markPageEdited(it.pageIdx);
                syncStrokeTransform(el,it.node,it.pageIdx);
            }else{
                // 상자(글상자·이미지·수식): 중심을 피벗 주위로 공전 + a 에 delta 가산.
                const Cx=el.x+(el.w||0)/2, Cy=el.y+(el.h||0)/2;
                const [ncx,ncy]=_rotPt(Cx,Cy,cx,cy,delta);
                el.x=Math.round(ncx-(el.w||0)/2);
                el.y=Math.round(ncy-(el.h||0)/2);
                el.rotation=normalizedRotation((Number(el.rotation)||0)+delta);
                markPageEdited(it.pageIdx);
                if(it.node){
                    it.node.style.left=el.x+'px'; it.node.style.top=el.y+'px';
                    applyBoxRotation(it.node,el);
                }
            }
        });
        return true;
    }
    // 절댓값 회전(주로 '각도 초기화'). 요소별로 회전만 0 으로 되돌리고
    // 자리는 그대로 둔다 — 묶음 회전 뒤에도 각 요소가 '똑바로' 서게 한다.
    function rotateSelectionTo(angle,items){
        items=items||selEntries();
        if(!items.length) return false;
        items.forEach(it=>{
            const el=findEl(it.pageIdx,it.id); if(!el) return;
            el.rotation=normalizedRotation(angle); markPageEdited(it.pageIdx);
            if(el.type==='stroke') syncStrokeTransform(el,it.node,it.pageIdx);
            else if(it.node) applyBoxRotation(it.node,el);
        });
        return true;
    }

    // 상자 안에 '부분적으로만' 지정된 글자 크기(span style="font-size")가 있으면
    // 상자 배율과 같은 비율로 함께 키우고, 실제로 바꾼 것이 있으면 true 를 준다.
    function _scalePdfSpan(sp,f,v){
        if(!sp.dataset||!(parseFloat(sp.dataset.pdfW)>0)) return false;
        // Resize source geometry together, not just its painted font.
        const fs=Math.max(1,+(v*f).toFixed(3));
        for(const key of ['pdfW','pdfBase']){
            const old=parseFloat(sp.dataset[key]);
            if(Number.isFinite(old)) sp.dataset[key]=String(+(old*f).toFixed(3));
        }
        for(const key of ['left','top']){
            const old=parseFloat(sp.style[key]);
            if(Number.isFinite(old)) sp.style[key]=(old*f).toFixed(3)+'px';
        }
        sp.dataset.fs=String(fs); sp.style.lineHeight=fs+'px'; sp.style.fontSize=fs+'px';
        return true;
    }
    function scaleInlineFS(c,f){
        if(!c||!f) return false;
        let spans=null;
        try{ spans=c.querySelectorAll('[style*="font-size"]'); }catch(e){ return false; }
        if(!spans||!spans.length) return false;
        let n=0;
        spans.forEach(sp=>{
            const v=parseFloat(sp.style.fontSize); if(!v) return;
            if(_scalePdfSpan(sp,f,v)){ n++; return; }
            sp.style.fontSize=Math.max(2,Math.round(v*f))+'px'; n++;
        });
        return n>0;
    }

    // ===== 객체 묶기 (그룹) =====
    // 같은 group 값을 가진 요소는 하나만 클릭해도 함께 선택된다.
    function groupSelection(){
        const items=selEntries();
        if(items.length<2){ toast('두 개 이상 선택해 주세요',1800); return; }
        pushHistory();
        const gid='g_'+Math.random().toString(36).slice(2,9);
        items.forEach(it=>{ const el=findEl(it.pageIdx,it.id); if(el){ el.group=gid; markPageEdited(it.pageIdx); } });
        saveDoc();
        toast(`${items.length}개를 묶었습니다`,1600);
    }
    function ungroupSelection(){
        const items=selEntries();
        if(!items.length) return;
        pushHistory();
        let cnt=0;
        items.forEach(it=>{ const el=findEl(it.pageIdx,it.id);
            if(el&&el.group){ delete el.group; cnt++; markPageEdited(it.pageIdx); } });
        saveDoc();
        toast(cnt?`묶음을 해제했습니다`:'묶인 항목이 없습니다',1600);
    }
    function selectionHasGroup(){
        return selEntries().some(it=>{ const el=findEl(it.pageIdx,it.id); return el&&el.group; });
    }
    // 그룹에 속한 요소를 고르면 같은 그룹 전체를 선택 상태로 만든다
    function expandGroupSelection(pageIdx,id){
        const el=findEl(pageIdx,id);
        if(!el||!el.group) return false;
        const paper=paperAt(pageIdx); if(!paper) return false;
        deselectAll(true); clearMulti();
        (doc.pages[pageIdx].els||[]).forEach(e=>{
            if(e.group!==el.group) return;
            const node=paper.querySelector(`[data-id="${e.id}"]`);
            if(node){ node.classList.add('msel'); multiSel.push({id:e.id,pageIdx,node}); }
        });
        return multiSel.length>1;
    }


    function clearMulti(){
        document.querySelectorAll('.msel').forEach(n=>n.classList.remove('msel'));
        multiSel=[];
    }
    // Ctrl(⌘)+클릭: 요소를 다중 선택에 토글 (이미 있으면 빼고, 없으면 더한다)
    function toggleMultiSelect(pageIdx,node){
        if(!node) return;
        // Ctrl+클릭으로 상자/이미지 다중 선택을 시작하는 순간, 이전에 드래그해
        // 두었던 글자 선택(savedRange)은 더 이상 사용자 의도가 아니다. 남겨 두면
        // 글자 크기/색 버튼이 보이는 다중 선택 대신 예전 글자 조각에 적용된다.
        clearTextSelection();
        const idx=multiSel.findIndex(m=>m.node===node);
        if(idx>=0){                        // 이미 선택됨 → 해제
            node.classList.remove('msel');
            multiSel.splice(idx,1);
        }else{                             // 새로 추가
            node.classList.add('msel');
            multiSel.push({id:node.dataset.id,pageIdx,node});
        }
        if(multiSel.length){
            selected=null;                 // 단일 선택은 해제 (다중 모드로)
        }
        document.querySelectorAll('.tb.sel,.paper-img.sel,.stroke-g.sel')
            .forEach(n=>n.classList.remove('sel'));
        return multiSel.length;
    }
    function elBBox(el,pageIdx){
        if(el.type==='stroke'){
            const pts=el.pts||[]; if(!pts.length) return null;
            const bb=strokeBBox(el);
            return {x:bb.x+(el.dx||0), y:bb.y+(el.dy||0), w:bb.w, h:bb.h};
        }
        return {x:el.x||0, y:el.y||0, w:el.w||1, h:el.h||1};
    }
    function startMarquee(e,pageIdx){
        const p=pageLocal(e,pageIdx);
        const paper=paperAt(pageIdx);
        const box=document.createElement('div');
        box.className='marquee';
        paper.appendChild(box);
        marquee={pageIdx, x0:p.x, y0:p.y, box, moved:false};
    }
    function updateMarquee(e){
        if(!marquee) return;
        const p=pageLocal(e,marquee.pageIdx);
        const x=Math.min(marquee.x0,p.x), y=Math.min(marquee.y0,p.y);
        const w=Math.abs(p.x-marquee.x0), h=Math.abs(p.y-marquee.y0);
        if(w>3||h>3) marquee.moved=true;
        Object.assign(marquee.box.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});
        marquee.rect={x,y,w,h};

        // 완전히 포함된 것만 선택 (일부만 걸치면 무시)
        clearMulti();
        const pi=marquee.pageIdx;
        (doc.pages[pi].els||[]).forEach(el=>{
            const b=elBBox(el,pi);
            const inside = b.x>=x && b.y>=y && (b.x+b.w)<=(x+w) && (b.y+b.h)<=(y+h);
            if(!inside) return;
            const node=paperQ(pi,`[data-id="${el.id}"]`);
            if(node){ node.classList.add('msel'); multiSel.push({id:el.id,pageIdx:pi,node}); }
        });
    }
    function endMarquee(){
        if(!marquee) return;
        const had=marquee.moved;
        marquee.box.remove();
        const n=multiSel.length;
        marquee=null;
        if(!had){ clearMulti(); return; }
        if(n) toast(`${n}개 선택됨 · 드래그로 이동, Del 로 삭제`,1800);
        else clearMulti();
    }

    // 다중 선택 이동
    let multiDrag=null;
    function startMultiDrag(e){
        const pi=multiSel[0].pageIdx;
        multiDrag={sx:e.clientX,sy:e.clientY,pageIdx:pi,moved:false,
            items:multiSel.map(m=>{
                const el=findEl(m.pageIdx,m.id);
                if(!el) return null;
                return {id:m.id,node:m.node,el,
                        ox:(el.type==='stroke')?(el.dx||0):el.x,
                        oy:(el.type==='stroke')?(el.dy||0):el.y};
            }).filter(Boolean)};
        if(!multiDrag.items.length){ multiDrag=null; return; }
        // 묶음 전체의 바운딩 박스 (스냅 기준)
        let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
        multiDrag.items.forEach(it=>{
            const bb=elBBox(it.el,pi); if(!bb) return;
            x0=Math.min(x0,bb.x); y0=Math.min(y0,bb.y);
            x1=Math.max(x1,bb.x+bb.w); y1=Math.max(y1,bb.y+bb.h);
        });
        if(isFinite(x0)) multiDrag.bb={x:x0,y:y0,w:x1-x0,h:y1-y0};
        _beginMultiPreview(multiDrag);
    }
    function hitMultiSel(e){
        let n=e.target.closest('.msel');
        if(!n){
            // SVG 획 등은 부모 g 로 올라가서 확인
            const g=e.target.closest('.stroke-g,.tb,.paper-img');
            if(g&&g.classList.contains('msel')) n=g;
        }
        return !!n && multiSel.some(m=>m.node===n);
    }
    // ===== 요소 클립보드 (앱 내부) =====
    let clipboardEls=[], nudgeTimer=null;

    function selectedElsData(){
        const out=[];
        if(multiSel.length){
            multiSel.forEach(m=>{ const el=findEl(m.pageIdx,m.id); if(el) out.push(el); });
        }else if(selected&&selected.el&&selected.el.dataset){
            const el=findEl(+selected.el.dataset.pageIdx,selected.el.dataset.id);
            if(el) out.push(el);
        }
        return out;
    }
    // 선택된 텍스트상자들의 '안의 글자'를 선택 순서대로 OS 클립보드에 복사한다
    function htmlToPlain(h,tight){
        const d=document.createElement('div'); d.innerHTML=h||'';
        d.querySelectorAll('br').forEach(b=>b.replaceWith('\n'));
        d.querySelectorAll('div,p').forEach(b=>b.append('\n'));
        // 가져온 PDF 상자(tight)는 단어마다 절대좌표 <span> 이라 그냥 이으면
        // 단어가 다 붙어버린다 → 스팬 사이에 공백을 한 칸 넣어 문장으로 되살린다.
        if(tight) d.querySelectorAll('span[data-fs]').forEach(s=>s.append(' '));
        // sup/sub 는 지우지 않는다 (x² 의 ² 가 사라지던 문제)
        let t=(d.textContent||'').replace(/\u00a0/g,' ');
        if(tight) t=t.replace(/[ \t]{2,}/g,' ').replace(/ +\n/g,'\n');
        return t.trim();
    }
    function fallbackCopyText(t){
        try{
            const ta=document.createElement('textarea');
            ta.value=t; ta.style.position='fixed'; ta.style.opacity='0';
            document.body.appendChild(ta); ta.select();
            const ok=document.execCommand('copy'); ta.remove();
            return !!ok;
        }catch(e){ return false; }
    }
    try{ window.fallbackCopyText=fallbackCopyText; }catch(e){}
    function copySelectedTextAsText(els){
        const parts=els.map(el=>htmlToPlain(el.html,el.tight)).filter(t=>t.length);
        const text=parts.join('\n');
        // 18.9 · OS 클립보드에는 '글자'를 주되, 앱 안에서 붙여넣을 때를 대비해
        //   원본 상자(위치·크기·글꼴·서식)도 함께 기억한다. 같은 글자를 그대로
        //   붙여넣으면 맹숭맹숭한 새 상자가 아니라 '상자 복제'가 되도록.
        try{ clipboardEls=JSON.parse(JSON.stringify(els)); _lastCopyText=text; }catch(e){}
        markElsCopied();
        if(!text){ toast('복사할 글자가 없습니다',1600); return; }
        const done=()=>toast(els.length>1?`${els.length}개 상자 복사됨`:'복사됨',1200);
        if(navigator.clipboard&&navigator.clipboard.writeText){
            navigator.clipboard.writeText(text)
                .then(()=>{ _elsOsWrite=true; done(); })
                .catch(()=>{ if(fallbackCopyText(text)) _elsOsWrite=true; done(); });
        }else{ if(fallbackCopyText(text)) _elsOsWrite=true; done(); }
    }
    let _lastCopyText='';           // 18.9 · 방금 우리가 OS 클립보드에 넣은 글자
    // ===== 요소 클립보드의 'OS 클립보드 소유' 추적 (22.2) =====
    //   예전엔 요소 복사(비텍스트·혼합·드래그 다중 선택)가 OS 클립보드를
    //   건드리지 않았다. 그래서 클립보드에 예전 글자가 남아 있으면 Ctrl+V 때
    //   복사한 요소 대신 그 오래된 글자가 새 글상자로 붙었다 — '드래그해서
    //   골라 복사한 뒤 붙여넣기가 잘 안 된다'는 보고의 정체.
    //   - _elsCopyAt  : 마지막 요소 복사/붙여넣기 시각
    //   - _elsOsWrite : 요소 복사 때 OS 클립보드 쓰기에 성공했는가
    //       true  → OS 클립보드 텍스트가 _lastCopyText 와 같은지 비교해 판정
    //       false → OS 클립보드에 뭐가 들었는지 알 수 없으므로, _ELS_PASTE_WIN
    //               안의 Ctrl+V 는 요소 붙여넣기를 우선한다
    let _elsCopyAt=0, _elsOsWrite=false;
    const _ELS_PASTE_WIN=60000;     // 쓰기 실패(권한 없음 등)일 때만 쓰는 안전창
    function markElsCopied(){ _elsCopyAt=Date.now(); _elsOsWrite=false; }
    // 사용자가 '글자'를 직접 복사했다(본문 드래그 복사·링크 주소 복사 등) →
    // 요소 클립보드의 우선권은 물러난다. 이후 Ctrl+V 는 글자 붙여넣기로 간다.
    function invalidateElsCopyForOsText(){ _elsCopyAt=0; _elsOsWrite=true; }
    // 요소 복사/잘라내기 때 OS 클립보드에도 '요소의 글자'(없으면 빈 글자)를
    // 올려 둔다. 빈 글자는 클립보드를 비우는 효과가 있어, 예전 글자가 남아
    // 요소 붙여넣기를 가로막는 일이 없다. 실패해도 요소 복사 자체는 계속된다.
    function writeOsTextForEls(txt){
        if(navigator.clipboard&&navigator.clipboard.writeText){
            navigator.clipboard.writeText(txt)
                .then(()=>{ _elsOsWrite=true; })
                .catch(()=>{ if(fallbackCopyText(txt)) _elsOsWrite=true; });
        }else if(fallbackCopyText(txt)) _elsOsWrite=true;
    }
    // 18.12 · 사진을 복사/잘라내면 내부 클립보드(앱 안 붙여넣기)뿐 아니라
    //   OS 클립보드에도 실제 이미지(PNG)를 올려 워드 등 외부 앱에 바로 붙여넣는다.
    async function copyImageToClipboard(el){
        try{
            if(!el||el.type!=='image') return false;
            // 소스: 확정 서버 URL → data:(레거시) 순서. blob: 은 쓰지 않는다.
            const src=_imgRealURL(el)
                ? el.url
                : (String(el.localURL||'').startsWith('data:')
                    ? el.localURL
                    : '');
            if(!src) return false;
            let blob=null;
            if(String(src).startsWith('data:')){
                blob=dataURLToFile(src,'copy.png');
            }else{
                const r=await fetch(src,{cache:'force-cache'});
                if(!r.ok) return false;
                blob=await r.blob();
            }
            if(!blob) return false;
            // 브라우저 ClipboardItem 호환성(공통)을 위해 PNG 로 다시 그린다.
            const url=URL.createObjectURL(blob);
            const img=await new Promise((res,rej)=>{
                const i=new Image();
                i.onload=()=>res(i);
                i.onerror=()=>rej(new Error('img load fail'));
                i.src=url;
            });
            const c=document.createElement('canvas');
            const w=img.naturalWidth||img.width||1, h=img.naturalHeight||img.height||1;
            c.width=w; c.height=h;
            c.getContext('2d').drawImage(img,0,0,w,h);
            try{ URL.revokeObjectURL(url); }catch(e){}
            const png=await canvasToBlob(c,'image/png');
            if(!png) return false;
            if(!(navigator.clipboard&&window.ClipboardItem)) return false;
            await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);
            return true;
        }catch(e){ console.warn('[사진 복사] OS 클립보드에 넣지 못했습니다', e); return false; }
    }
    function osCopyImageToClipboard(el,cut){
        try{
            copyImageToClipboard(el).then(ok=>{
                toast(ok
                    ? (cut?'잘라내기 · 이미지를 클립보드에 복사했습니다':'이미지를 클립보드에 복사했습니다')
                    : (cut?'잘라냄':'복사됨'), cut?1500:1400);
            });
        }catch(e){ toast(cut?'잘라냄':'복사됨',1200); }
    }
    function copyElements(cut){
        const els=selectedElsData();
        if(!els.length) return;
        clipboardEls=JSON.parse(JSON.stringify(els));
        markElsCopied();
        const singleImg=els.length===1&&els[0].type==='image';
        // 22.2 · 요소 복사/잘라내기 때도 OS 클립보드에 '요소의 글자'를 올려
        //   둔다(_lastCopyText 도 같이). 안 그러면 예전에 복사해 둔 글자가
        //   클립보드에 남아 Ctrl+V 때 복사한 요소 대신 글상자로 붙는다.
        //   글자가 아예 없으면 빈 글자를 써 클립보드를 비운다.
        //   단, 사진 1장은 OS 클립보드에 PNG 를 올리는 게 이득이라 그대로 둔다.
        if(singleImg){
            _lastCopyText='';
        }else{
            const txt=els.map(el=>htmlToPlain(el.html,el.tight)).filter(t=>t.length).join('\n');
            _lastCopyText=txt;
            writeOsTextForEls(txt);
        }
        if(cut){
            pushHistory();
            const pi=multiSel.length?multiSel[0].pageIdx:+selected.el.dataset.pageIdx;
            const ids=els.map(x=>x.id);
            doc.pages[pi].els=(doc.pages[pi].els||[]).filter(x=>!ids.includes(x.id));
            clearMulti(); deselectAll();
            markPageEdited(pi); renderPageEls(pi); saveDoc();
            if(singleImg) osCopyImageToClipboard(els[0], true);
            else toast(`${els.length}개 잘라냄`,1200);
        }else{
            if(singleImg) osCopyImageToClipboard(els[0], false);
            else toast(`${els.length}개 복사됨`,1200);
        }
    }
    function pasteElements(){
        if(!clipboardEls.length||!doc) return;
        const pi=(lastMouse.pageIdx>=0&&lastMouse.pageIdx<doc.pages.length)?lastMouse.pageIdx:curPageIdx;
        // 22.2 · 여러 곳에 이어 붙일 때도 요소 붙여넣기가 계속 우선하도록
        //   안전창을 다시 연다 (OS 쓰기 상태(_elsOsWrite)는 그대로 둔다 —
        //   true 면 여전히 글자 일치로 판정한다)
        _elsCopyAt=Date.now();
        pushHistory();
        // 클립보드 묶음의 좌상단을 기준점으로 삼아 마우스 위치로 옮김
        let minX=Infinity,minY=Infinity;
        clipboardEls.forEach(el=>{
            const b=el.type==='stroke'
                ? {x:Math.min(...el.pts.map(q=>q[0]))+(el.dx||0), y:Math.min(...el.pts.map(q=>q[1]))+(el.dy||0)}
                : {x:el.x,y:el.y};
            minX=Math.min(minX,b.x); minY=Math.min(minY,b.y);
        });
        const tx=(lastMouse.x!=null?lastMouse.x:minX+20)-minX;
        const ty=(lastMouse.y!=null?lastMouse.y:minY+20)-minY;
        const made=[];
        clipboardEls.forEach(src=>{
            const el=JSON.parse(JSON.stringify(src));
            el.id=uid(el.type==='text'?'t':el.type==='latex'?'m':el.type==='image'?'i':'s');
            if(el.type==='stroke'){ el.dx=(el.dx||0)+tx; el.dy=(el.dy||0)+ty; }
            else{
                const c=clampEl(el.x+tx,el.y+ty,el.w,el.h);
                el.x=Math.round(c.x); el.y=Math.round(c.y);
            }
            doc.pages[pi].els.push(el); made.push(el);
        });
        markPageEdited(pi); renderPageEls(pi); saveDoc();
        clearMulti(); deselectAll(true);
        // 붙여넣은 것들을 선택 상태로
        const paper=paperAt(pi);
        made.forEach(el=>{
            const node=paper.querySelector(`[data-id="${el.id}"]`);
            if(node){ node.classList.add('msel'); multiSel.push({id:el.id,pageIdx:pi,node}); }
        });
        if(multiSel.length===1){ multiSel[0].node.classList.remove('msel'); multiSel[0].node.classList.add('sel');
            if(clipboardEls[0].type==='image') _ensureImgControls(multiSel[0].node);
            else _ensureTbControls(multiSel[0].node);
            selected={type:clipboardEls[0].type==='image'?'image':clipboardEls[0].type,el:multiSel[0].node}; multiSel=[]; }
        toast(`${made.length}개 붙여넣음`,1200);
    }
    function duplicateSelection(){
        const els=selectedElsData();
        if(!els.length) return;
        const keep=clipboardEls;
        clipboardEls=JSON.parse(JSON.stringify(els));
        const pi=multiSel.length?multiSel[0].pageIdx:+selected.el.dataset.pageIdx;
        // 원본에서 살짝 어긋나게
        const sx=lastMouse.x, sy=lastMouse.y, spi=lastMouse.pageIdx;
        let minX=Infinity,minY=Infinity;
        clipboardEls.forEach(el=>{
            const b=el.type==='stroke'
                ? {x:Math.min(...el.pts.map(q=>q[0]))+(el.dx||0), y:Math.min(...el.pts.map(q=>q[1]))+(el.dy||0)}
                : {x:el.x,y:el.y};
            minX=Math.min(minX,b.x); minY=Math.min(minY,b.y);
        });
        lastMouse.pageIdx=pi; lastMouse.x=minX+16; lastMouse.y=minY+16;
        pasteElements();
        lastMouse.x=sx; lastMouse.y=sy; lastMouse.pageIdx=spi;
        clipboardEls=keep;
    }
    function selectAllOnPage(){
        const pi=curPageIdx;
        const paper=paperAt(pi); if(!paper) return;
        deselectAll(true); clearMulti();
        (doc.pages[pi].els||[]).forEach(el=>{
            const node=paper.querySelector(`[data-id="${el.id}"]`);
            if(node){ node.classList.add('msel'); multiSel.push({id:el.id,pageIdx:pi,node}); }
        });
        if(multiSel.length) toast(`${multiSel.length}개 선택됨`,1100);
    }

    async function deleteMulti(){
        if(!multiSel.length) return;
        pushHistory();
        const pi=multiSel[0].pageIdx;
        const ids=new Set(multiSel.map(m=>m.id));
        const all=doc.pages[pi].els||[];
        const tableIds=new Set();
        all.forEach(el=>{ if(ids.has(el.id)){ const tid=tblOf(el); if(tid) tableIds.add(tid); } });
        // 표의 일부 칸/선만 다중 선택 후 삭제해도 표 메타데이터와 모든 테두리를 함께 제거한다.
        const tableGroups=new Set(pageTables(pi).filter(t=>tableIds.has(t.id)).map(t=>t.group).filter(Boolean));
        const shouldRemove=el=>ids.has(el.id)||tableIds.has(tblOf(el))||(el.group&&tableGroups.has(el.group));
        const removed=all.filter(shouldRemove);
        if(removed.length) markPageEdited(pi);
        doc.pages[pi].els=all.filter(el=>!shouldRemove(el));
        const activeTableRemoved=!!(activeTbl&&activeTbl.pageIdx===pi&&tableIds.has(activeTbl.tid));
        if(tableIds.size) doc.pages[pi].tables=pageTables(pi).filter(t=>!tableIds.has(t.id));
        clearMulti();
        if(activeTableRemoved) clearActiveTbl();
        renderPageEls(pi);
        renderTblDivs(pi);
        positionTblBar();
        await purgeElements(removed);       // 서버 자원도 정리
        saveDoc();
        toast(`${removed.length}개 삭제됨`,1400);
    }


/* APP-PART:06c-el-select-ops.js:END */
