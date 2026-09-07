/* === src/app/14-menus-init.js ===
   우클릭 메뉴 · 삭제 · Init · 노트목록 동기화 · block4
   (sdynotes.js 메가 분리 · 이 파일들은 scripts/bundle-frontend.mjs 가 순서대로 이어 붙인다.
    let/const 스코프를 공유하려면 반드시 concat 되어야 한다 — 단독 <script> 로드 금지) */
/* APP-PART:14-menus-init.js:BEGIN */
    // ============ 에디터 우클릭 메뉴 ============
    let ctxTarget=null;   // {kind:'blank'|'el'|'text', pageIdx, x, y, el}
    // ── 우클릭 메뉴 ────────────────────────────────────────
    // 항목이 {sub:'번역', items:[...]} 이면 하위 메뉴로 접힌다.
    // 접힌 묶음을 누르면 그 자리에서 펼쳐진다 (창을 새로 띄우지 않음).
    let _ctxItems=null, _ctxOpenSub=null;
    function ctxRender(){
        const m=document.getElementById('ctxMenu');
        const rowHTML=(it)=>{
            if(it==='-') return '<div class="ctx-sep"></div>';
            if(it.sub){
                const on=_ctxOpenSub===it.sub;
                let h=`<div class="ctx-item ctx-group${on?' open':''}" data-sub="${esc(it.sub)}">`+
                      `<i class="${it.i||'ri-more-line'}"></i> ${esc(it.sub)}`+
                      `<i class="ri-arrow-right-s-line ctx-caret"></i></div>`;
                if(on) h+='<div class="ctx-subwrap">'+it.items.map(rowHTML).join('')+'</div>';
                return h;
            }
            return `<div class="ctx-item${it.danger?' danger':''}" data-a="${it.a}">`+
                   `<i class="${it.i}"></i> ${it.t}`+
                   (it.k?`<span class="ctx-key">${it.k}</span>`:'')+
                   `</div>`;
        };
        m.innerHTML=_ctxItems.map(rowHTML).join('');
        m.querySelectorAll('.ctx-item[data-a]').forEach(n=>{
            n.onclick=(ev)=>{ ev.stopPropagation(); closeCtxMenu(); editorAction(n.dataset.a); };
        });
        m.querySelectorAll('.ctx-item[data-sub]').forEach(n=>{
            n.onclick=(ev)=>{ ev.stopPropagation();
                _ctxOpenSub=(_ctxOpenSub===n.dataset.sub)?null:n.dataset.sub;
                ctxRender(); ctxPlace(true); };
        });
    }
    // 화면 안에 반드시 들어오도록 놓는다.
    //  · 위/아래가 잘리던 문제: 아래로 넘치면 위로 붙이고, 그래도 길면
    //    스스로 스크롤되게 최대 높이를 준다 (예전엔 top 이 음수가 돼 잘렸다).
    //  · 확대(zoom)를 켜면 메뉴도 같은 비율로 커진다.
    function ctxPlace(keepAnchor){
        const m=document.getElementById('ctxMenu');
        const pad=8;
        // 9.0 · 우클릭 메뉴는 종이 확대율을 따라가지 않는다.
        //  예전에는 pageScale 을 그대로 써서, 종이를 2~3배로 키워 보면
        //  메뉴까지 같이 부풀어 화면을 다 덮었다. 메뉴는 '화면 UI' 이므로
        //  종이가 아무리 커져도 항상 읽기 좋은 고정 크기로 둔다.
        //  터치 기기에서만 손가락에 맞춰 아주 살짝 키운다.
        const touch=matchMedia('(pointer:coarse)').matches;
        const z=touch?1.06:1;
        m.style.setProperty('--ctxz', z.toFixed(3));
        m.style.maxHeight='';
        // lastMouse(화면 px)와 offsetWidth(메뉴가 쓰는 CSS px)는 사이트 기본
        // 배율(90%) 때문에 단위가 다르다. 전부 CSS px 로 맞춰 재야 메뉴가
        // 눌린 바로 그 자리에 뜨고 화면 밖으로 나가지 않는다.
        const vw=uiCss(window.innerWidth), vh=uiCss(window.innerHeight);
        const maxH=vh-pad*2;
        if(m.offsetHeight>maxH) m.style.maxHeight=maxH+'px';
        const w=m.offsetWidth||210, h=m.offsetHeight||300;
        const ax=(keepAnchor&&_ctxAnchor)?_ctxAnchor.x:lastMouse.clientX;
        const ay=(keepAnchor&&_ctxAnchor)?_ctxAnchor.y:lastMouse.clientY;
        _ctxAnchor={x:ax,y:ay};
        let x=uiCss(ax), y=uiCss(ay);
        // 가로: 오른쪽에 자리가 없으면 왼쪽으로 펼친다
        let L=(x+w+pad>vw)? x-w : x;
        L=Math.max(pad, Math.min(L, vw-w-pad));
        // 세로: 아래가 모자라면 위로 올리되, 절대 음수로 가지 않는다
        let T=(y+h+pad>vh)? y-h : y;
        T=Math.max(pad, Math.min(T, vh-h-pad));
        m.style.left=Math.round(L)+'px';
        m.style.top =Math.round(T)+'px';
    }
    let _ctxAnchor=null;
    function editorMenu(items){
        _ctxItems=items; _ctxOpenSub=null; _ctxAnchor=null;
        const m=document.getElementById('ctxMenu');
        ctxRender();
        m.classList.add('show');
        ctxPlace(false);
    }

    function onEditorContext(e){
        if(!doc) return;
        const paper=e.target.closest('#pagesStage .paper');
        if(!paper) return;
        e.preventDefault();
        closePops();
        const pageIdx=+paper.dataset.pageIdx;
        curPageIdx=pageIdx; updatePageInfo();
        const p=pageLocal(e,pageIdx),px=p.x,py=p.y;
        lastMouse.clientX=e.clientX; lastMouse.clientY=e.clientY;
        lastMouse.pageIdx=pageIdx; lastMouse.x=px; lastMouse.y=py;

        // ① 글자를 드래그해 고른 상태 (편집 중이 아니어도 동작)
        //    우클릭 순간 브라우저가 선택을 지우는 경우가 있어,
        //    직전에 저장해 둔 선택(savedRange)까지 함께 살펴본다.
        const editing=document.querySelector('.tb.edit');
        let sel=window.getSelection();
        let selHost=(sel&&!sel.isCollapsed&&sel.anchorNode)
            ? (sel.anchorNode.nodeType===1?sel.anchorNode:sel.anchorNode.parentElement)
            : null;
        let selBox=selHost?selHost.closest('.tb-content'):null;
        let selText=selBox?String(sel):'';
        if((!selBox||!selText.trim()) && savedRange && savedHost
           && document.body.contains(savedHost) && String(savedRange).trim()){
            // 저장된 선택을 되살려 그대로 이어서 쓴다
            selBox=savedHost;
            selText=String(savedRange);
            const s2=window.getSelection();
            s2.removeAllRanges(); s2.addRange(savedRange.cloneRange());
            sel=s2;
        }
        if(selBox && selText.trim()){
            // 편집 모드가 아니었다면 지금 진입시켜 그 자리에서 바로 고칠 수 있게 한다
            const w=selBox.closest('.tb');
            if(w && !w.classList.contains('edit')){
                const r0=sel.getRangeAt(0).cloneRange();
                enterEdit(w,true);
                enableTextSelect(selBox);
                const s2=window.getSelection();
                s2.removeAllRanges(); s2.addRange(r0);
            }
            saveSel();
            const txt=selText.trim();
            const short=txt.length>12?txt.slice(0,12)+'…':txt;
            ctxTarget={kind:'text',pageIdx,el:selBox.closest('.tb')};
            editorMenu([
                {a:'copy',   i:'ri-file-copy-line', t:'복사',      k:'Ctrl+C'},
                {a:'cut',    i:'ri-scissors-line',  t:'잘라내기',   k:'Ctrl+X'},
                {a:'bold',   i:'ri-bold',           t:'굵게',      k:'Ctrl+B'},
                {a:'hl',     i:'ri-mark-pen-line',  t:'형광펜'},
                {a:'clear',  i:'ri-format-clear',   t:'서식제거'},
                {a:'sel-find',  i:'ri-search-line', t:`'${esc(short)}' 찾기`},
                '-',
                {sub:'서식', i:'ri-font-color', items:[
                    {a:'italic', i:'ri-italic',        t:'기울임',  k:'Ctrl+I'},
                    {a:'under',  i:'ri-underline',     t:'밑줄',   k:'Ctrl+U'},
                    {a:'strike', i:'ri-strikethrough', t:'취소선'},
                    {a:'color',  i:'ri-font-color',    t:'글자색 적용'},
                    {a:'clear',  i:'ri-format-clear',  t:'서식 지우기'},
                ]},
                {sub:'번역', i:'ri-translate-2', items:[
                    {a:'tr-sel-ko', i:'ri-translate-2', t:'한국어로'},
                    {a:'tr-sel-en', i:'ri-translate',   t:'영어로'},
                    {a:'tr-sel-ja', i:'ri-translate',   t:'일본어로'},
                    {a:'tr-sel-zh', i:'ri-translate',   t:'중국어로'},
                ]},
                {sub:'더보기', i:'ri-more-line', items:[
                    {a:'sel-clip',  i:'ri-inbox-archive-line', t:'모아두기에 담기'},
                    {a:'sel-upper', i:'ri-font-size-2', t:'영문 대문자로'},
                    {a:'sel-lower', i:'ri-font-size',   t:'영문 소문자로'},
                    {a:'sel-link',  i:'ri-link',        t:'링크 걸기'},
                    {a:'sel-count', i:'ri-calculator-line', t:'글자 수 세기'},
                    {a:'sel-newbox',i:'ri-text-block',  t:'새 글상자로 빼내기'},
                ]},
            ]);
            return;
        }

        // ② 요소 위
        const host=e.target.closest('.tb')||e.target.closest('.paper-img')||e.target.closest('.stroke-g');
        if(host){
            const kind=host.classList.contains('latex-box')?'latex'
                      :host.classList.contains('tb')?'text-el'
                      :host.classList.contains('paper-img')?'img':'stroke';
            // 다중 선택 상태에서 그 안의 요소를 우클릭하면 선택을 유지한다
            const inMulti=multiSel.some(m=>m.node===host);
            deselectAll(true);
            if(!inMulti) clearMulti();
            if(kind==='img') _ensureImgControls(host); else _ensureTbControls(host);   // 수식은 .tb 라 같은 장식
            host.classList.add('sel');
            selected={type:kind==='img'?'image':(kind==='stroke'?'stroke':'text'),el:host};
            ctxTarget={kind:'el',pageIdx,el:host,elKind:kind};
            const multi=multiSel.length>1;
            const items=[
                {a:'el-copy',  i:'ri-file-copy-line', t:'복사', k:'Ctrl+C'},
                {a:'el-cut',   i:'ri-scissors-line',  t:'잘라내기', k:'Ctrl+X'},
                {a:'el-dup',   i:'ri-file-copy-2-line', t:'복제', k:'Ctrl+J'},
            ];
            // 18.7 · 보고: 우클릭 메뉴에서 '내용 편집' 버튼을 없앤다.
            //   텍스트 편집은 더블클릭/텍스트 도구로만 들어가는 것으로 충분하다.
            //   (LaTeX 수식 편집 버튼은 유지 — 수식은 더블클릭이 없으므로)
            if(kind==='latex' && !multi) items.push({a:'latex-edit', i:'ri-function-line', t:'LaTeX 수식 편집'});
            items.push('-');

            // 표 안이면 표 편집을 하위 메뉴로
            {
                const hel=findEl(pageIdx,host.dataset.id);
                const tid=(hel&&hel.tbl&&hel.tbl.tid)||null;
                if(tid){
                    setActiveTbl(pageIdx,tid,(hel.tbl.r)||0,(hel.tbl.c)||0);
                    items.push({sub:'표 편집', i:'ri-table-line', items:[
                        {a:'tbl-row-up',   i:'ri-insert-row-top',      t:'위에 행 추가'},
                        {a:'tbl-row-down', i:'ri-insert-row-bottom',   t:'아래에 행 추가'},
                        {a:'tbl-col-left', i:'ri-insert-column-left',  t:'왼쪽에 열 추가'},
                        {a:'tbl-col-right',i:'ri-insert-column-right', t:'오른쪽에 열 추가'},
                        {a:'tbl-fit',      i:'ri-layout-column-line',  t:'열 너비 고르게'},
                        {a:'tbl-del-row',  i:'ri-delete-row',    t:'이 행 삭제', danger:true},
                        {a:'tbl-del-col',  i:'ri-delete-column', t:'이 열 삭제', danger:true},
                        {a:'tbl-del',      i:'ri-delete-bin-6-line', t:'표 전체 삭제', danger:true},
                    ]});
                }
            }
            if(kind==='text-el'){
                items.push({sub:'정렬·서식', i:'ri-align-left', items:[
                    {a:'el-align-left',   i:'ri-align-left',   t:'왼쪽 정렬'},
                    {a:'el-align-center', i:'ri-align-center', t:'가운데 정렬'},
                    {a:'el-align-right',  i:'ri-align-right',  t:'오른쪽 정렬'},
                    {a:'el-clearfmt',     i:'ri-format-clear', t:'이 상자 서식 지우기'},
                ]});
                const tr=[
                    {a:'tr-ko', i:'ri-translate-2', t:'이 상자 → 한국어'},
                    {a:'tr-en', i:'ri-translate',   t:'이 상자 → 영어'},
                ];
                if(multi){
                    tr.push({a:'tr-sel-all-ko', i:'ri-translate-2', t:`선택 ${multiSel.length}개 → 한국어`});
                    tr.push({a:'tr-sel-all-en', i:'ri-translate',   t:`선택 ${multiSel.length}개 → 영어`});
                }
                tr.push({a:'trpg-ko', i:'ri-file-list-3-line', t:'이 페이지 → 한국어'});
                tr.push({a:'trpg-en', i:'ri-file-list-3-line', t:'이 페이지 → 영어'});
                tr.push({a:'trdoc-ko', i:'ri-book-open-line', t:'문서 전체 → 한국어'});
                tr.push({a:'trdoc-en', i:'ri-book-open-line', t:'문서 전체 → 영어'});
                items.push({sub:'번역', i:'ri-translate-2', items:tr});
            }
            items.push({sub:'회전', i:'ri-clockwise-2-line', items:[
                {a:'el-rot-left',  i:'ri-anticlockwise-2-line', t:'왼쪽으로 15°', k:'Alt+Shift+휠'},
                {a:'el-rot-right', i:'ri-clockwise-2-line',     t:'오른쪽으로 15°'},
                {a:'el-rot-reset', i:'ri-restart-line',         t:'각도 초기화'},
            ]});
            if(multi){
                items.push({sub:'여러 개 맞춤', i:'ri-align-item-left-line', items:[
                    {a:'al-left',    i:'ri-align-item-left-line',     t:'왼쪽 맞춤'},
                    {a:'al-hcenter', i:'ri-align-item-horizontal-center-line', t:'가로 가운데'},
                    {a:'al-right',   i:'ri-align-item-right-line',    t:'오른쪽 맞춤'},
                    {a:'al-top',     i:'ri-align-item-top-line',      t:'위쪽 맞춤'},
                    {a:'al-vcenter', i:'ri-align-item-vertical-center-line', t:'세로 가운데'},
                    {a:'al-bottom',  i:'ri-align-item-bottom-line',   t:'아래쪽 맞춤'},
                    ...(multiSel.length>2?[
                        {a:'al-hdist', i:'ri-space', t:'가로 균등 배치'},
                        {a:'al-vdist', i:'ri-space', t:'세로 균등 배치'}]:[]),
                ]});
            }
            // 기타: 순서·잠금·스티커·묶기
            const more=[
                {a:'el-front', i:'ri-bring-to-front', t:'맨 앞으로'},
                {a:'el-back',  i:'ri-send-to-back',   t:'맨 뒤로'},
                {a:'el-sticker', i:'ri-sticky-note-line', t:'스티커로 만들기'},
            ];
            if(!multi){
                more.push({a:'el-lock', i:'ri-lock-2-line',
                    t:(findEl(pageIdx,host.dataset.id)||{}).locked?'잠금 풀기':'움직이지 않게 잠그기'});
            }else{
                // 14.16.6 · '스티커로 합치기'(원본을 지우고 스티커로 갈아끼우기)는
                //   객체 묶기와 겹치는 기능이라 뺐다 — 여러 개는 객체 묶기로 묶고,
                //   스티커는 '스티커로 만들기'(원본 유지)로만 만든다.
                more.push({a:'el-group', i:'ri-links-line', t:'객체 묶기'});
            }
            if(selectionHasGroup()) more.push({a:'el-ungroup', i:'ri-link-unlink', t:'묶음 해제'});
            if(kind==='img'){
                const im=findEl(pageIdx,host.dataset.id);
                const lk=!(im&&im.freeRatio);
                items.push({a:'el-view', i:'ri-zoom-in-line', t:'크게 보기'});
                more.push({a:'el-ratio', i:lk?'ri-lock-line':'ri-lock-unlock-line',
                           t:lk?'비율 고정 해제':'비율 고정하기'});
            }
            items.push({sub:'더보기', i:'ri-more-line', items:more});
            items.push('-',{a:'el-del', i:'ri-delete-bin-6-line', t:'삭제', k:'Del', danger:true});
            editorMenu(items);
            return;
        }

        // ③ 빈 종이
        ctxTarget={kind:'blank',pageIdx,x:px,y:py};
        editorMenu([
            {a:'new-text', i:'ri-text',           t:'텍스트 상자'},
            {a:'paste',    i:'ri-clipboard-line', t:'붙여넣기', k:'Ctrl+V'},
            {a:'img',      i:'ri-image-add-line', t:'이미지 넣기'},
            {a:'sticker',  i:'ri-sticky-note-line', t:'스티커 넣기'},
            {a:'new-latex',i:'ri-function-line',  t:'LaTeX 수식 넣기'},
            {a:'new-table',i:'ri-table-line',     t:'표 넣기'},
            {a:'pen',      i:'ri-pen-nib-line',   t:'펜 / 도형'},
            '-',
            {sub:'페이지', i:'ri-file-list-3-line', items:[
                {a:'select-all',i:'ri-checkbox-multiple-line', t:'이 페이지 전체 선택', k:'Ctrl+A'},
                {a:'page-dup', i:'ri-file-copy-line', t:'페이지 복제', k:'Ctrl+D'},
                {a:'page-add', i:'ri-file-add-line',  t:'페이지 추가', k:'Ctrl+Enter'},
            ]},
            {sub:'번역', i:'ri-translate-2', items:[
                {a:'trpg-ko', i:'ri-file-list-3-line', t:'이 페이지 → 한국어'},
                {a:'trpg-en', i:'ri-file-list-3-line', t:'이 페이지 → 영어'},
                {a:'trdoc-ko', i:'ri-book-open-line', t:'문서 전체 → 한국어'},
                {a:'trdoc-en', i:'ri-book-open-line', t:'문서 전체 → 영어'},
            ]},
            {a:'export',   i:'ri-share-box-line',t:'내보내기',   k:'Ctrl+E'},
        ]);
    }

    function inlineSelectionForAction(){
        let host=restoreSel();
        const s=window.getSelection();
        if(!s||s.isCollapsed||!s.rangeCount) return null;
        if(!host){
            const n=s.anchorNode ? (s.anchorNode.nodeType===1?s.anchorNode:s.anchorNode.parentElement) : null;
            host=n&&n.closest?n.closest('.tb-content'):null;
        }
        if(!host) return null;
        return {sel:s,host,text:String(s)};
    }
    async function writeClipboardTextSafe(txt){
        txt=String(txt||'');
        if(!txt) return false;
        try{
            if(navigator.clipboard&&navigator.clipboard.writeText){
                await navigator.clipboard.writeText(txt);
                return true;
            }
        }catch(e){}
        // 권한이 없거나 execCommand 가 사라진 환경에서도 메뉴 동작이 터지면 안 된다.
        try{ fallbackCopyText(txt); return true; }catch(e){ return false; }
    }
    async function copyInlineSelectionForAction(){
        const cur=inlineSelectionForAction();
        if(!cur||!cur.text.trim()){
            try{ if(document.execCommand) document.execCommand('copy'); }catch(e){}
            return false;
        }
        await writeClipboardTextSafe(cur.text);
        saveSel();
        toast('텍스트 복사됨',1200);
        return true;
    }
    async function cutInlineSelectionForAction(wHint){
        const cur=inlineSelectionForAction();
        if(!cur||!cur.text.trim()){
            try{ if(document.execCommand) document.execCommand('cut'); }catch(e){}
            return false;
        }
        await writeClipboardTextSafe(cur.text);
        pushHistory();
        const r=cur.sel.getRangeAt(0);
        r.deleteContents();
        r.collapse(true);
        cur.sel.removeAllRanges(); cur.sel.addRange(r);
        const w=cur.host.closest('.tb')||wHint;
        if(w) syncTextEl(w);
        saveSel();
        toast('텍스트 잘라냄',1200);
        return true;
    }

    async function editorAction(a){
        const t=ctxTarget; if(!t) return;
        const pi=t.pageIdx;
        if(a==='new-text'){
            const dim=textBoxDefaultSize();
            const c=clampEl(t.x-dim.w/2,t.y-dim.h/2,dim.w,dim.h);
            addTextBox(pi,c.x,c.y,dim);
        }
        else if(a==='paste'){
            try{
                const items=await navigator.clipboard.read();
                for(const it of items){
                    const imgType=it.types.find(x=>x.startsWith('image/'));
                    if(imgType){
                        const bl=await it.getType(imgType);
                        await uploadImgs([new File([bl],'paste.png',{type:imgType})],true);
                        return;
                    }
                }
                const txt=await navigator.clipboard.readText();
                if(txt&&txt.trim()){
                    const s=paperSize();
                    const w=Math.min(s.w-96,Math.max(220,Math.min(560,txt.length*11)));
                    const h=Math.max(52,txt.split(/\n/).length*(curFontSize*1.5)+26);
                    const c=clampEl(t.x-w/2,t.y-h/2,w,h);
                    pushHistory();
                    doc.pages[pi].els.push({type:'text',id:uid('t'),x:Math.round(c.x),y:Math.round(c.y),
                        w:Math.round(w),h:Math.round(h),html:esc(txt).replace(/\n/g,'<br>'),fontSize:curFontSize});
                    markPageEdited(pi); renderPageEls(pi); saveDoc();
                }else toast('클립보드가 비어 있습니다',1400);
            }catch(err){ toast('Ctrl+V 로 붙여넣어 주세요',1800); }
        }
        else if(a==='img'){ triggerImgUpload({pageIdx:pi,x:t.x,y:t.y}); }
        // 빈 종이 우클릭 → 스티커 넣기 : 보관함을 열고, 우클릭한 자리를 기억한다.
        // 보관함에서 스티커를 고르면 그 자리에 붙는다(툴바로 열면 기본 자리).
        else if(a==='sticker'){ _stickerAnchor={pageIdx:pi,x:t.x,y:t.y}; openStickers(); }
        else if(a==='new-latex'){ openLatexModal(); _latexAnchor={pageIdx:pi,x:t.x,y:t.y}; }
        else if(a==='latex-edit'){ openLatexModal(t.el.dataset.id,pi); }
        else if(a==='pen'){ togglePen(); }
        else if(a==='page-dup'){ duplicatePage(); }
        else if(a==='page-add'){ addPage(); }
        else if(a==='export'){ openExportModal(); }
        else if(a==='copy'){
            await copyInlineSelectionForAction();
        }
        else if(a==='cut'){
            await cutInlineSelectionForAction(t.el);
        }
        else if(a==='bold'){ execFmt('bold'); }
        else if(a==='italic'){ execFmt('italic'); }
        else if(a==='under'){ execFmt('underline'); }
        else if(a==='color'){ applyTextColor(currentTextColor); }
        else if(a==='hl'){ applyHighlight(currentHlColor); }
        else if(a==='clear'){ clearFmt(); }
        else if(a==='el-rot-left'||a==='el-rot-right'||a==='el-rot-reset'){
            const items=selEntries(); if(!items.length) return;
            pushHistory();
            if(a==='el-rot-reset') rotateSelectionTo(0,items);
            else rotateSelection(a==='el-rot-left'?-15:15,items);
            saveDoc(); toast(a==='el-rot-reset'?'각도를 초기화했습니다':(a==='el-rot-left'?'왼쪽으로 15° 회전':'오른쪽으로 15° 회전'),1100);
        }
        else if(a==='el-del'){
            pushHistory();
            const gone=(doc.pages[pi].els||[]).filter(x=>x.id===t.el.dataset.id);
            doc.pages[pi].els=doc.pages[pi].els.filter(x=>x.id!==t.el.dataset.id);
            const sf=paperQ(pi,`.stroke-fill[data-for="${t.el.dataset.id}"]`); if(sf) sf.remove();
            t.el.remove(); selected=null; saveDoc();
            purgeElements(gone);
        }
        else if(a==='select-all'){ selectAllOnPage(); }
        else if(a&&a.startsWith('al-')){ alignSelection(a.slice(3)); }
        else if(a==='el-copy'){ copyElements(false); }
        else if(a==='el-cut'){  copyElements(true); }
        else if(a==='el-align-left'||a==='el-align-center'||a==='el-align-right'){
            setAlign(a.replace('el-align-',''));
        }
        else if(a==='el-dup'){
            pushHistory();
            const src=findEl(pi,t.el.dataset.id);
            const cp=JSON.parse(JSON.stringify(src));
            cp.id=uid(cp.type[0]);
            if(cp.type==='stroke'){ cp.dx=(cp.dx||0)+16; cp.dy=(cp.dy||0)+16; }
            else { cp.x=Math.min(paperSize().w-cp.w, cp.x+16); cp.y=Math.min(paperSize().h-cp.h, cp.y+16); }
            doc.pages[pi].els.push(cp);
            markPageEdited(pi); renderPageEls(pi); saveDoc(); toast('복제됨',1000);
        }
        else if(a==='el-front'||a==='el-back'){
            pushHistory();
            const arr=doc.pages[pi].els;
            const i=arr.findIndex(x=>x.id===t.el.dataset.id);
            if(i>=0){
                const [it]=arr.splice(i,1);
                if(a==='el-front') arr.push(it); else arr.unshift(it);
                markPageEdited(pi); renderPageEls(pi); saveDoc();
                toast(a==='el-front'?'맨 앞으로':'맨 뒤로',900);
            }
        }
        else if(a==='el-edit'){ enterEdit(t.el,false); }
        else if(a==='el-clearfmt'){
            pushHistory();
            clearBoxFormatting(t.el);
            saveDoc(); toast('서식 지움',1200);
        }
        else if(a==='new-table'){
            const v=prompt('표 크기를 입력하세요 (행 x 열)','3 x 3');
            if(v){ const m=String(v).match(/(\d+)\s*[x\u00d7,\s]\s*(\d+)/);
                   if(m) insertTable(+m[1],+m[2],pi,lastMouse.x,lastMouse.y);
                   else toast('예: 3 x 4 형식으로 입력해 주세요',2200); }
        }
        else if(a==='tbl-row-up'){ tblAdd('row',-1); }
        else if(a==='tbl-row-down'){ tblAdd('row',1); }
        else if(a==='tbl-col-left'){ tblAdd('col',-1); }
        else if(a==='tbl-col-right'){ tblAdd('col',1); }
        else if(a==='tbl-del-row'){ tblDel('row'); }
        else if(a==='tbl-del-col'){ tblDel('col'); }
        else if(a==='tbl-fit'){ tblFit(); }
        else if(a==='tbl-del'){ tblDelAll(); }
        else if(a==='el-lock'){ toggleLockEl(); }
        else if(a==='el-sticker'){ makeSticker(); }
        else if(a==='el-view'){
            // ★ 14.28.1 · 이미지 크게 보기는 더블클릭/재탭으로 자동 진입하지 않고
            //   우클릭 메뉴에서 명시적으로 고를 때만 전체화면 뷰어를 연다.
            const t=ctxTarget&&ctxTarget.el;
            if(t){
                const el2=findEl(+t.dataset.pageIdx,t.dataset.id);
                document.getElementById('vImg').src=(el2&&el2.url)||(el2&&el2.localURL)||'';
                document.getElementById('viewer').style.display='flex';
            }
        }
        else if(a==='el-group'){ groupSelection(); }
        else if(a==='el-ungroup'){ ungroupSelection(); }
            else if(a==='tr-ko'||a==='tr-en'){ translateElement(t.el,a==='tr-ko'?'ko':'en'); }
            else if(a==='tr-sel-all-ko') translateSelection('ko');
            else if(a==='tr-sel-all-en') translateSelection('en');
            else if(a==='trpg-ko') translatePageAction(t.pageIdx,'ko');
            else if(a==='trpg-en') translatePageAction(t.pageIdx,'en');
            else if(a==='trdoc-ko') translateDocAction('ko');
            else if(a==='trdoc-en') translateDocAction('en');
        else if(a==='tr-sel-ko') translateSelectedText('ko');
        else if(a==='tr-sel-en') translateSelectedText('en');
        else if(a==='tr-sel-ja') translateSelectedText('ja');
        else if(a==='tr-sel-zh') translateSelectedText('zh-CN');
        else if(a==='strike'){
            // 18.6 · 취소선 토글 — 굵게/기울임/밑줄과 같은 엔진으로
            execFmt('strike');
        }
        else if(a==='sel-upper'||a==='sel-lower'){
            // 18.9 · execCommand('insertText') 는 환경에 따라 없거나(구형 웹뷰)
            //   선택 구간의 서식(굵기·색·글꼴)을 통째로 날린다. 텍스트 노드의
            //   글자만 바꾸면 서식은 그대로 두고 대소문자만 바뀐다.
            const up=(a==='sel-upper');
            const host=restoreSel();
            const s=window.getSelection();
            if(!host||!s||s.isCollapsed){ toast('텍스트를 드래그해 선택하세요',1300); return; }
            pushHistory();
            const r=s.getRangeAt(0);
            const parts=_selContacts(r);
            parts.forEach(ct=>{
                const v=String(ct.node.nodeValue||'');
                const seg=v.slice(ct.s,ct.e);
                ct.node.nodeValue=v.slice(0,ct.s)+(up?seg.toUpperCase():seg.toLowerCase())+v.slice(ct.e);
            });
            const w=host.closest('.tb'); if(w) syncTextEl(w);
            saveSel();
            toast(up?'대문자로 바꿨습니다':'소문자로 바꿨습니다',1400);
        }
        else if(a==='sel-link'){
            const s=window.getSelection();
            const cur=String(s||'').trim();
            const url=prompt('연결할 주소를 입력하세요', /^https?:\/\//i.test(cur)?cur:'https://');
            if(url&&url.trim()){
                const host=restoreSel();
                if(!host){ toast('텍스트를 드래그해 선택하세요',1300); return; }
                pushHistory();
                // v2 엔진: execCommand(createLink) 없이 선택 구간에 <a> 를 짓는다.
                try{ _fmtLinkSelection(url.trim()); }catch(e){}
                const w=host.closest('.tb'); if(w) syncTextEl(w);
                saveSel(); syncCurSel();
                toast('링크를 걸었습니다',1400);
            }
        }
        else if(a==='sel-find'){
            const q=String(window.getSelection()||'').trim();
            if(!q) return;
            openFind();
            const inp=document.getElementById('findInput');
            inp.value=q; runFind(q);
        }
        else if(a==='sel-count'){ countSelection(); }
        else if(a==='sel-clip'){ clipAdd(); if(sidePanel!=='clip') openPanel('clip'); }
        else if(a==='sel-newbox'){
            const s=window.getSelection();
            const txt=String(s||'').trim();
            if(!txt) return;
            pushHistory();
            const size=paperSize();
            const w=Math.min(size.w-96,Math.max(220,Math.min(520,txt.length*11)));
            const h=Math.max(52,Math.ceil(txt.length*11/w)*(curFontSize*1.6)+24);
            doc.pages[pi].els.push({type:'text',id:uid('t'),
                x:Math.round(lastMouse.x||80), y:Math.round((lastMouse.y||100)+30),
                w:Math.round(w), h:Math.round(h), html:esc(txt),
                fontSize:curFontSize, font:curFont});
            markPageEdited(pi); renderPageEls(pi); saveDoc();
            toast('새 글상자로 빼냈습니다',1600);
        }
        else if(a==='el-ratio'){
            const el=findEl(pi,t.el.dataset.id);
            el.freeRatio=!el.freeRatio;
            markPageEdited(pi); renderPageEls(pi); saveDoc();
            toast(el.freeRatio
                ? '비율 자유 · 꼭짓점으로도 자유롭게 조절'
                : '비율 고정 · 꼭짓점=비율유지, 변중앙=자유', 1800);
        }
    }
    // 우클릭 직전에 현재 선택을 확보해 둔다 (브라우저가 지우기 전에)
    document.addEventListener('pointerdown',e=>{ if(e.button===2) saveSel(); },true);
    document.addEventListener('contextmenu',onEditorContext);

    // ============ 카드 컨텍스트 메뉴 / 부가 기능 ============
    let ctxNB=null;
    function openCardMenu(e,nb){
        ctxNB=nb;
        const cfg=getCfg(nb.id);
        const m=document.getElementById('ctxMenu');
        m.innerHTML=`
            <div class="ctx-item" onclick="ctxAction('open')"><i class="ri-external-link-line"></i> 열기</div>
            <div class="ctx-item" onclick="ctxAction('pin')"><i class="ri-pushpin-2-line"></i> ${cfg.pinned?'고정 해제':'상단 고정'}</div>
            <div class="ctx-item" onclick="ctxAction('rename')"><i class="ri-edit-line"></i> 이름 변경</div>
            <div class="ctx-item" onclick="ctxAction('duplicate')"><i class="ri-file-copy-line"></i> 노트 복제</div>
            <div class="ctx-item" onclick="ctxAction('info')"><i class="ri-information-line"></i> 노트 정보</div>
            <div class="ctx-sep"></div>
            <div class="ctx-item" onclick="ctxAction('lock')"><i class="ri-lock-2-line"></i> ${(cfg.lock&&cfg.lock.enc)?(adminMode?'잠금 해제':'비밀번호 해제'):'비밀번호 잠금'}</div>
            <div class="ctx-item" onclick="ctxAction('export')"><i class="ri-share-box-line"></i> 백업(JSON) 내보내기</div>
            <div class="ctx-sep"></div>
            <div class="ctx-item danger" onclick="ctxAction('delete')"><i class="ri-delete-bin-6-line"></i> 휴지통으로 이동</div>`;
        m.classList.add('show');
        // 화면 밖으로 나가지 않게 (예전엔 위쪽이 잘릴 수 있었다)
        lastMouse.clientX=e.clientX; lastMouse.clientY=e.clientY;
        _ctxAnchor=null;
        ctxPlace(false);
    }
    function closeCtxMenu(){
        const m=document.getElementById('ctxMenu');
        if(m){ m.classList.remove('show'); m.style.display=''; }
    }
    try{ window.closeCtxMenu=closeCtxMenu; }catch(e){}
    function ctxMenuOpen(){
        const m=document.getElementById('ctxMenu');
        return !!m && m.classList.contains('show');
    }
    // 메뉴 밖을 누르면(좌·우 버튼 모두) 닫는다.
    // ★ pointerdown 으로 변경 — 터치 장치에서 메뉴 닫힘 즉시 반응
    document.addEventListener('pointerdown',e=>{
        if(e.target.closest('.ctx-menu')||e.target.closest('.card-menu')) return;
        closeCtxMenu();
    },true);
    document.addEventListener('click',e=>{
        if(!e.target.closest('.ctx-menu')&&!e.target.closest('.card-menu')) closeCtxMenu();
    });
    document.addEventListener('scroll',closeCtxMenu,true);
    document.addEventListener('wheel',()=>{ if(ctxMenuOpen()) closeCtxMenu(); },{passive:true});
    addEventListener('blur',closeCtxMenu);
    addEventListener('resize',closeCtxMenu);

    async function ctxAction(act){
        const nb=ctxNB; closeCtxMenu();
        if(!nb) return;
        const cfg=getCfg(nb.id);
        if(act==='info'){ showNoteInfo(nb); return; }
        if(act==='open'){ openNB(nb); }
        else if(act==='pin'){ cfg.pinned=!cfg.pinned; setCfg(nb.id,cfg); pushSettingsNow(); notebooks=sortNBs(notebooks); renderGrid(); toast(cfg.pinned?'상단에 고정됨 📌':'고정 해제됨'); }
        else if(act==='rename'){
            const t=prompt('새 이름',nb.title||'새 노트');
            if(t&&t.trim()){
                const want=t.trim();
                nb.title=uniqueTitle(want,noteFolder(nb.id),nb.id);
                if(nb.title!==want) toast(`같은 이름이 있어 '${nb.title}' 로 저장했어요`,2200);
                if(String(nb.id).startsWith('local_')) saveLocalNBs();
                else if(SB){ syncStart(); try{ await SB.from('notebooks').update({title:nb.title,updated_at:new Date().toISOString()}).eq('id',nb.id); }catch(e){} syncEnd(); }
                renderGrid(); toast('이름 변경됨');
            }
        }
        else if(act==='duplicate'){ await duplicateNote(nb); }
        else if(act==='lock'){
            if(cfg.lock&&cfg.lock.enc){
                if(adminMode){
                    // 관리자: 위탁(escrow)으로 바로 잠금 해제
                    if(!confirm(`"${nb.title||'새 노트'}" 의 잠금을 해제할까요?`)) return;
                    if(await removeNoteLockFromCard(nb.id)){ renderGrid(); toast('잠금 해제됨 🔓'); }
                }else{
                    toast('노트를 열어서 해제해주세요',2200); openNB(nb);
                }
            }
            else { openNB(nb).then(()=>setTimeout(lockCurrentNote,350)); }
        }
        else if(act==='export'){ exportNoteJSON(nb); }
        else if(act==='delete'){
            if(isLocked(nb.id)&&!isUnlocked(nb.id)&&!adminMode){
                toast('🔒 잠긴 노트는 삭제할 수 없습니다. 먼저 잠금을 해제하세요',2600); return;
            }
            // 항상 휴지통으로 (영구 삭제 없음 — 30일 후 자동 삭제)
            if(!confirm(`"${nb.title||'새 노트'}" 을(를) 휴지통으로 이동할까요?`)) return;
            const _c=document.querySelector('.note-card[data-nb-id="'+nb.id+'"]');
            playClawThrow(_c, ()=>{
                moveToTrash(nb.id);
                renderGrid(); toast('휴지통으로 이동했습니다 · 30일 후 자동 삭제');
            });
        }
        else if(act==='restore'){
            restoreFromTrash(nb.id);
            renderGrid(); toast('복원했습니다');
            setTimeout(()=>{ const c=document.querySelector('.note-card[data-nb-id="'+nb.id+'"]'); if(c) playClawDrop(c); },80);
        }
    }

    async function duplicateNote(nb){
        if(isLocked(nb.id)&&!isUnlocked(nb.id)){ toast('잠긴 노트는 복제할 수 없습니다'); return; }
        const src=await loadDocAsync(nb.id);
        const copy=JSON.parse(JSON.stringify(src));
        // 요소 id 재발급 (충돌 방지)
        (copy.pages||[]).forEach(pg=>{ pg.id=blankPage().id; (pg.els||[]).forEach(el=>{ el.id=uid(el.type[0]); }); });
        const title=uniqueTitle(nb.title||'새 노트',noteFolder(nb.id),null);
        syncStart();
        try{
            if(SB&&!String(nb.id).startsWith('local_')){
                const{data}=await SB.from('notebooks').insert([{title,color:nb.color||'#4f6ef7'}]).select().single();
                if(data){
                    await SB.from('memos').insert([{notebook_id:data.id,content:'',font_size:S.defFS}]);
                    persistDoc(data.id,copy); notebooks.push(data);
                    const fsrc=noteFolder(nb.id); if(fsrc) setNoteFolder(data.id,fsrc);
                }
            }else{
                const id='local_'+Date.now();
                const nnb={id,title,color:nb.color||'#4f6ef7',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
                persistDoc(id,copy); notebooks.push(nnb); saveLocalNBs();
                const fsrc=noteFolder(nb.id); if(fsrc) setNoteFolder(id,fsrc);
            }
            notebooks=sortNBs(notebooks); renderGrid(); toast('노트 복제됨');
        }catch(e){ console.error(e); toast('복제 실패'); }
        finally{ syncEnd(); }
    }

    async function exportNoteJSON(nb){
        if(isLocked(nb.id)&&!isUnlocked(nb.id)){ toast('잠긴 노트는 먼저 열어주세요'); return; }
        const d=await loadDocAsync(nb.id);
        const blob=new Blob([JSON.stringify({title:nb.title,doc:d,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});
        const a=document.createElement('a');
        a.href=URL.createObjectURL(blob);
        a.download=(nb.title||'노트').replace(/[^가-힣a-zA-Z0-9_ -]/g,'')+'.json';
        a.click();
        setTimeout(()=>URL.revokeObjectURL(a.href),1000);
        toast('백업 파일 저장됨');
    }

    // 현재 페이지 복제
    function duplicatePage(){
        if(!doc) return;
        pushHistory();
        const copy=JSON.parse(JSON.stringify(doc.pages[curPageIdx]));
        copy.id=blankPage().id;
        (copy.els||[]).forEach(el=>{ el.id=uid(el.type[0]); });
        // 표도 새 id 로 (원본과 섞이지 않게)
        const remap={};
        (copy.tables||[]).forEach(t=>{ const n='tb_'+Math.random().toString(36).slice(2,9);
                                       remap[t.id]=n; t.id=n; t.group='g_'+n; });
        (copy.els||[]).forEach(el=>{ if(el.tbl&&remap[el.tbl.tid]){ el.tbl.tid=remap[el.tbl.tid];
                                       el.group='g_'+el.tbl.tid; } });
        doc.pages.splice(curPageIdx+1,0,copy);
        curPageIdx++;
        renderPages(); saveDoc(); toast('페이지 복제됨');
    }

    // ============ 삭제 / 기타 ============
    // ═══════════════════════════════════════════════════════════════
    //  9.1 · 사용법 다시 씀
    //  실제로 동작하는 것만 적는다. 예전 도움말에는 Ctrl+C/V/J/A 처럼
    //  코드에 없는 단축키가 섞여 있었다 → 전부 걷어내고, 새 2단 툴바
    //  기준으로 다시 정리했다.
    // ═══════════════════════════════════════════════════════════════
    const KEY_HELP=[
        ['화면 구성 (새로워졌어요)',[
            ['툴바는 <b>한 줄</b>입니다','왼쪽은 노트, 가운데는 도구, 오른쪽은 쪽·서랍'],
            ['<b>왼쪽</b> — 뒤로 · 제목 · 저장 상태',''],
            ['<b>가운데</b> — 늘 화면 정중앙','글상자 · 펜 · 사진 · 스티커 · 메모 │ 주요어 · 검색 │ 되돌리기'],
            ['<b>오른쪽</b> — 쪽 이동 · 확대 · 네 서랍 · 내보내기','넣기 · 페이지 · 보기 · 노트'],
            ['<b>글자 서식은 글상자 옆에 떠요</b>','글상자를 고르면 그 위에 막대가 나타납니다 (툴바가 늘어나지 않아요)'],
            ['서식 막대','글꼴 · 크기 · 굵게 · 기울임 · 밑줄 · 글자색 · 형광펜'],
            ['글씨 크기는 숫자칸에 직접 입력','− / ＋ 로 2씩 조절'],
        ]],
        ['쪽 이동',[
            ['오른쪽 쪽 번호칸에 숫자 입력 후 <b>Enter</b>','그 쪽으로 바로 이동'],
            ['번호칸 위/아래 화살표','이전 쪽 / 다음 쪽'],
            ['페이지 서랍 · 페이지 목록','미리보기를 보고 이동'],
            ['<i class="ri-star-line"></i> 별표 · <i class="ri-bookmark-line"></i> 책갈피','즐겨찾는 쪽으로 바로 가기'],
        ]],
        ['꼭 외울 단축키',[
            ['Ctrl + Z','되돌리기'],
            ['Ctrl + Shift + Z  ·  Ctrl + Y','다시 실행'],
            ['Ctrl + F','문서에서 찾기'],
            ['Ctrl + H','찾아 바꾸기'],
            ['Ctrl + S','바로 저장'],
            ['Ctrl + Enter','쪽 추가'],
            ['Ctrl + D','쪽 복제'],
            ['Ctrl + E','내보내기'],
            ['Ctrl + P','PDF 로 저장'],
            ['Ctrl + Shift + C','고른 글자 수 세기'],
            ['Ctrl + 휠','확대 / 축소 (확대율을 누르면 100%)'],
            ['Esc','선택 해제 · 열린 창 닫기'],
            ['? 또는 F1','이 사용법 (노트 밖에서)'],
        ]],
        ['요소 다루기',[
            ['방향키','1px 이동'],
            ['Shift + 방향키','10px 이동'],
            ['Delete · Backspace','고른 요소 삭제'],
            ['Alt + 드래그','자동 맞춤(스냅) 잠시 끄기'],
            ['끌 때 나오는 분홍/보라 선','가장자리 · 가운데 정렬 안내'],
            ['여러 개 고른 뒤 우클릭','맞춤 · 균등 배치'],
            ['<i class="ri-lock-2-line"></i> 요소 잠그기','실수로 움직이거나 지워지지 않게'],
        ]],
        ['텍스트 상자',[
            ['상자 안을 드래그','미리 클릭하지 않아도 글자가 바로 선택돼요'],
            ['더블클릭','편집 모드 · 낱말 선택'],
            ['왼쪽 위 <i class="ri-drag-move-2-fill"></i> 손잡이','상자 옮기기'],
            ['글자를 고르고 우클릭','번역 · 서식 · 글자색 · 링크 · 찾기 · 새 상자로 빼내기'],
            ['글자를 고르고 Ctrl + C','고른 글자만 깔끔하게 복사 (가져온 PDF 도 정상)'],
        ]],
        ['표',[
            ['표에 마우스를 올리면','테두리 · 손잡이가 나타남'],
            ['변 가운데 손잡이','위·아래 = 세로로만, 왼·오른쪽 = 가로로만 늘리기'],
            ['표를 고르면 나오는 막대','행 · 열 추가/삭제 · 칸 정렬 · 배경색'],
            ['꼭짓점 끌기','가로 · 세로 조절 (Shift = 비율 유지)'],
            ['경계 끌기','그 열 너비 · 행 높이만 조절'],
            ['경계 끌 때 Shift','옆 칸에서 나눠 가짐 (전체 크기 유지)'],
            ['Tab · Enter','다음 칸 · 아래 칸으로 (표 안에서)'],
            ['왼쪽 위 손잡이 → Delete','표 통째로 삭제'],
        ]],
        ['펜 · 그리기',[
            ['가운데의 <i class="ri-pen-nib-line"></i> 펜','펜 도구 켜기 / 끄기'],
            ['아래 펜 툴바','색 · 굵기 · 직선 · 화살표 · 사각형 · 원'],
            ['형광펜 단추','반투명하고 굵게'],
            ['지우개','펜 굵기의 6배 반경으로 지움'],
        ]],
        ['주요어 분석',[
            ['가운데의 <i class="ri-contrast-2-line"></i> 주요어','문서 전체 낱말을 세어 파랑 농도로 색칠'],
            ['진한 남색 = 많이 나온 말','연한 하늘색 = 적게 (4단계)'],
            ['목록에서 낱말 클릭','그 낱말만 노랗게 · 첫 위치로 이동'],
            ['− / ＋','몇 번 이상 나온 말만 칠할지 조절'],
            ['Esc','색칠 끄기 (원래 글자는 그대로)'],
        ]],
        ['암기카드',[
            ['빠르게 풀기','오늘 볼 것부터 가볍게 한 바퀴'],
            ['마스터 학습','연속 2번 맞힐 때까지 되풀이 — 가장 확실하게 외워집니다'],
            ['짝 맞추기','문제와 정답을 짝지어 없애는 시간 재기 게임 (묶음별 최고 기록)'],
            ['오답 / 시험','틀린 것만 골라 풀기 · 모아 풀고 채점(오답 노트)'],
            ['1 ~ 9','객관식 보기 고르기 (번호 키)'],
            ['Enter','다음 문제로'],
            ['Space','뒤집기 카드 답 보기'],
            ['Esc','한 단계 뒤로 — <b>문제 풀던 중이면 그 묶음 화면으로</b>'],
            ['묶음 화면 오른쪽 위 <i class="ri-list-check-2"></i>','문제 관리 — 찾기 · 쪽 넘기기 · 한 문제만 풀기 · 초기화 · 삭제'],
            ['시험 모드','10 · 20 · 전체 문항을 모아 풀고, 끝나면 점수와 오답 노트'],
            ['진행률','한 번이라도 맞힌 카드부터 조금씩 채워집니다'],
            ['복습 알림','아침 9시 · 저녁 8시에만, 밀린 카드가 5장 이상일 때'],
        ]],
        ['음악',[
            ['확장 플레이어 왼쪽 위 <i class="ri-refresh-line"></i>','노래가 안 보일 때 · 파일·쪽지·올린 이름으로 목록을 되살립니다'],
            ['곡 찾기','띄어쓰기 없이 · 초성(ㅂㅍㅈ)으로도 · 예전 파일 이름으로도 찾힙니다'],
            ['정보 편집 → <i class="ri-mic-2-line"></i> 소리로 인식','이름·태그가 없어도 소리 자체로 곡을 알아냅니다 (AcoustID)'],
            ['확장 플레이어 <i class="ri-search-line"></i>','제목·가수·앨범으로 곡 찾기'],
            ['정보 편집 → 자동으로 찾기','다시 누르면 다음 후보 · 표지만 따로 찾기도 가능'],
        ]],
        ['집중 화면 (시계 · 스톱워치 · 타이머)',[
            ['머리말의 <i class="ri-time-line"></i> 시계','화면 전체가 시계로 — 뒤 화면은 은은하게 비쳐 보여요'],
            ['1 · 2 · 3','시계 · 스톱워치 · 타이머 바로 전환'],
            ['Space','스톱워치·타이머 시작/멈춤 · L 구간 기록 · R 초기화'],
            ['F','전체 화면 · Esc 닫기'],
            ['가만히 두면','버튼이 사라져 숫자만 남아요 (움직이면 다시 나타남)'],
            ['타이머','창을 닫아도 계속 흐르고, 끝나면 소리로 알려 줘요'],
        ]],
        ['노트 · 폴더 (홈)',[
            ['카드를 꾹 누르기','선택 모드 (여러 개 고르기)'],
            ['고른 카드를 폴더로 끌기','폴더에 넣기'],
            ['폴더 ⋮ 또는 우클릭','이름 · 색 · 아이콘 · 폴더 잠그기'],
            ['<i class="ri-lock-2-line"></i> 잠금','노트와 폴더 모두 같은 방식 · 비밀번호로 바로 해제'],
            ['잠긴 노트 · 폴더','먼저 잠금을 풀어야 삭제할 수 있어요'],
            ['잠긴 폴더는 손댈 수 없어요','옮기기 · 안의 노트 꺼내기 · 비우기 모두 잠금을 풀어야 해요'],
            ['남의 잠긴 노트가 든 폴더','통째로 잠글 수 없어요 (가둬두기 방지)'],
            ['헤더의 주황 · 빨강 배지','아직 못 보낸 변경분 (눌러서 즉시 동기화)'],
            ['설정 → 관리자 모드','모든 잠금 해제 · 3회 틀리면 10분 차단'],
        ]],
        ['보기 서랍',[
            ['<i class="ri-list-unordered"></i> 개요','제목 · 글 목록에서 눌러 이동'],
            ['<i class="ri-stack-line"></i> 요소','이 쪽의 글 · 그림 목록'],
            ['<i class="ri-inbox-archive-line"></i> 모아두기','어느 노트에서든 꺼내 쓰는 조각 보관함'],
            ['<i class="ri-bar-chart-2-line"></i> 통계','글자 수 · 낱말 수 · 읽는 시간'],
            ['<i class="ri-focus-mode"></i> 집중 모드','도구를 숨김 (Esc 해제)'],
            ['<i class="ri-slideshow-line"></i> 발표 모드','전체 화면 · ← → 로 넘김 · Esc 종료'],
            ['<i class="ri-expand-width-line"></i> 폭 맞춤','화면 너비에 쪽을 딱 맞춤'],
            ['<i class="ri-eye-line"></i> 눈 편한 색','화면만 부드럽게 (저장물은 그대로)'],
            ['<i class="ri-save-3-line"></i> / <i class="ri-history-line"></i>','되돌리기 지점 저장 · 그 시점으로 복구'],
        ]],
        ['PDF 가져오기 · 수식',[
            ['논문 PDF 를 넣으면','글자는 글상자로, 수식은 진짜 수식으로 들어와요'],
            ['큰 적분 · 큰 시그마','∫ ∑ ∏ 가 위·아래 범위까지 그대로 들어와요'],
            ['키 큰 분수','분자 · 분모가 큰 식도 분수 모양 그대로'],
            ['대입 기호','큰 세로 막대와 그 아래 조건까지 함께'],
            ['수식을 두 번 누르면','LaTeX 로 직접 고칠 수 있어요'],
            ['수식이 사진으로 들어왔다면','원본 PDF 가 글자가 아닌 그림인 경우예요'],
        ]],
        ['배경화면 · 음악',[
            ['설정 → 배경화면','내 사진을 홈 화면 배경으로 (모든 기기에 함께 적용)'],
            ['노트를 열면','배경 사진은 자동으로 숨겨져 글쓰기에 방해되지 않아요'],
            ['음악 ＋ 버튼','파일 선택창에서 여러 곡을 한 번에 골라 올릴 수 있어요'],
        ]],
    ];
    function openKeys(){
        const b=document.getElementById('keyBody');
        b.innerHTML=KEY_HELP.map(([sec,rows])=>
            `<div class="key-sec">${sec}</div>`+
            rows.map(([k,d])=>`<div class="key-row"><span>${d}</span><kbd>${k}</kbd></div>`).join('')
        ).join('');
        // 18.2 · 졸리는 해돌이는 설명을 가장 아래까지 스크롤했을 때만 보이도록
        //   스크롤 영역(keyBody) 맨 끝에 붙인다. (모달 바깥에 있던 노드를 매번 옮긴다)
        const ko=document.querySelector('#keyModal .keys-otter');
        if(ko){ b.appendChild(ko); b.scrollTop=0; }
        document.getElementById('keyModal').style.display='flex';
        openNav(closeKeys);
    }
    function closeKeys(){ document.getElementById('keyModal').style.display='none'; navDrop(closeKeys); }

    function showDelModal(){ document.getElementById('delModal').style.display='flex'; openNav(closeDelModal); }
    function closeDelModal(){ document.getElementById('delModal').style.display='none'; navDrop(closeDelModal); }
    async function delNB(){
        if(!curNB) return;
        if(isLocked(curNB.id)&&!isUnlocked(curNB.id)&&!adminMode){
            closeDelModal();
            toast('🔒 잠긴 노트는 삭제할 수 없습니다',2400); return;
        }
        closeDelModal();
        const nbId=curNB.id;
        try{ if(doc) flushSaveDoc(); }catch(e){}   // 나가기 전 편집분 즉시 저장
        document.getElementById('editorView').classList.remove('open');
        navDrop(closeEditor);
        const _c=document.querySelector('.note-card[data-nb-id="'+nbId+'"]');
        playClawThrow(_c, ()=>{
            // 항상 휴지통으로 (영구 삭제 없음)
            moveToTrash(nbId);
            curNB=null;curMemo=null;doc=null;_docId=null;renderGrid();
            toast('휴지통으로 이동했습니다 · 30일 후 자동 삭제');
        });
    }

    document.getElementById('edTitle').addEventListener('change',function(){
        if(!curNB) return;
        curNB.title=this.value.trim()||'새 노트';
        queueSync(curNB.id);
    });
    document.getElementById('setModal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeSettings();});
    document.getElementById('delModal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeDelModal();});
    document.getElementById('createModal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeCreateModal();});
    document.getElementById('exportModal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeExportModal();});
    document.getElementById('pwModal').addEventListener('click',e=>{if(e.target===e.currentTarget)closePwModal(null);});
    window.addEventListener('beforeunload',()=>{ if(pendingNB) flushSync(); });

    // ============ Init ============
    resetStaleBrowserSettings();
    _stCacheReset=true;   // 성공한 첫 pull 뒤에만 false가 된다
    applyTheme();
    renderLinks();
    updateOfflineUI();

    // ===== 첫 진입 로딩 화면: 노트를 불러오는 동안 도구·글꼴을 미리 준비 =====
    const _spMsg=document.getElementById('splashMsg');
    const _spFill=document.getElementById('splashFill');
    function _sp(m,p){
        if(_spMsg) _spMsg.textContent=m;
        if(_spFill) _spFill.style.width=Math.round(Math.min(100,Math.max(0,p)))+'%';
    }
    // 미리 불러올 글꼴 (문서·에디터에서 쓰이는 것들)
    const _SP_FONTS=[
        '400 16px "Pretendard Variable"','500 16px "Pretendard Variable"','700 16px "Pretendard Variable"',
        '400 16px "Gaegu"','400 16px "Jua"',
        '400 16px "Nanum Pen Script"','400 16px "Do Hyeon"',
        '400 16px "Gowun Dodum"','400 16px "Poor Story"',
        '400 16px "Black Han Sans"','400 16px "Nanum Myeongjo"',
        '400 16px "Nanum Gothic Coding"','400 16px "Inter"',
        '400 16px "Roboto Mono"','400 16px "Playfair Display"','400 16px "Caveat"'
    ];
    const _sleep=ms=>new Promise(r=>setTimeout(r,ms));
    // 본문에 바로 보이는 글꼴만 (이것만 잠깐 기다린다)
    function _coreFontsReady(){
        if(!document.fonts||!document.fonts.load) return Promise.resolve();
        return Promise.all([
            document.fonts.load('400 16px "Pretendard Variable"').catch(()=>{}),
            document.fonts.load('700 16px "Pretendard Variable"').catch(()=>{}),
            document.fonts.load('16px remixicon').catch(()=>{}),
        ]).catch(()=>{});
    }
    function _preloadFonts(){
        let done=0;
        const total=_SP_FONTS.length+1;
        return new Promise(res=>{
            const tick=()=>{ done++; if(done>=total) res(); };
            if(!document.fonts||!document.fonts.load){
                res(); return;
            }
            _SP_FONTS.forEach(f=>{
                document.fonts.load(f).then(()=>tick()).catch(()=>tick());
            });
            // 아이콘 폰트(remixicon) 미리 로드 → 에디터 아이콘이 늦게 떠서 번쩍이는 것 방지
            document.fonts.load('16px remixicon').then(()=>tick()).catch(()=>tick());
            // 2.5초 내에 끝나지 않으면 강제 진행 (폰트는 백그라운드로 계속 로드됨)
            setTimeout(res,2500);
        });
    }
    function _hideSplash(){
        const s=document.getElementById('splash');
        if(!s){ document.body.classList.remove('sdy-booting'); _clawReady=true; return; }
        s.classList.add('hide');
        setTimeout(()=>{ try{ s.remove(); }catch(e){} },500);
        // 스플래시 전환과 첫 목록 렌더가 완전히 끝난 뒤에만 사용자 동작용
        // 집게를 허용한다. 따라서 로딩 중에는 노트가 움직이는 모션이 없다.
        setTimeout(()=>{
            document.body.classList.remove('sdy-booting');
            _clawCleanup(); _clawHide();
            _clawReady=true;
        },700);
    }
    // 노트(에디터) 열 때 잠깐 뜨는 로딩 표시 (잠긴 노트 복호화·대용량 서버 문서 로드 중)
    let _edLoadT=null;
    function showEdLoading(txt){
        const el=document.getElementById('edLoading');
        if(!el) return;
        const t=el.querySelector('.ed-txt'); if(t) t.textContent=txt||'노트 여는 중…';
        el.classList.add('show');
    }
    function hideEdLoading(){
        const el=document.getElementById('edLoading');
        if(el) el.classList.remove('show');
    }

    // ===== 노트 추가/삭제 뽑기 기계(크레인) 애니메이션 =====
    // 위쪽 쇠 와이어 + 금속 집게가 '실제 노트 카드'를 잡아 옮긴다.
    // 14.13.2 · 집게는 카드 폭에 비례해 크기가 변한다(어떤 화면·카드 크기에서도
    //   같은 비율로 양쪽을 감싸고, 들고 내려오는 미리보기는 실제 카드와 박스가
    //   완전히 동일해 놓는 순간에 크기가 튀지 않는다).
    const CLAW_W=100, CLAW_H=60, CLAW_GRIP=53;   // SVG viewBox 단위 (발끝 y=53)
    // 카드 폭(UI px) → 집게 배율. 200px 카드 ≈ 1.6 (집게 160px, 발끝 ±56px).
    function _clawScaleFor(w){ return Math.max(.75, Math.min(2.4, (Number(w)||125)/125)); }
    function _clawGripD(s){ return CLAW_GRIP*(Number(s)||1); }   // 머리 윗변 → 발끝 깊이
    // 첫 파일의 금속 집게 SVG. 복제할 때마다 그라데이션 id 를 다르게 해서
    // 숨겨진 원본 url(#cMetal) 을 가리키지 않게 한다 (파일 이동 때 집게가 안 보이던 원인).
    // 팔은 좌우 대칭(±35)이고, viewBox 100 의 70% 폭을 펴서 카드 양쪽을 감싼다.
    function _clawSvgHtml(){
        const gid='cMetal_'+Math.random().toString(36).slice(2,9);
        const armL='M36 18 C 19 30, 12 40, 15 53', armR='M64 18 C 81 30, 88 40, 85 53';
        return '<svg width="100" height="60" viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
            +'<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1">'
            +'<stop offset="0" stop-color="#eaeef3"/><stop offset=".5" stop-color="#b7c1cc"/>'
            +'<stop offset="1" stop-color="#66717e"/></linearGradient></defs>'
            +'<rect x="46.5" y="0" width="7" height="8" rx="2" fill="#5b6570"/>'
            +'<rect x="28" y="5" width="44" height="13" rx="5" fill="url(#'+gid+')" stroke="#4a5460" stroke-width="1.5"/>'
            +'<rect x="32.5" y="8" width="35" height="3.5" rx="1.75" fill="rgba(255,255,255,.55)"/>'
            +'<circle cx="36" cy="18" r="4.5" fill="url(#'+gid+')" stroke="#4a5460" stroke-width="1.2"/>'
            +'<circle cx="64" cy="18" r="4.5" fill="url(#'+gid+')" stroke="#4a5460" stroke-width="1.2"/>'
            +'<path d="'+armL+'" fill="none" stroke="#4a5460" stroke-width="9.5" stroke-linecap="round"/>'
            +'<path d="'+armR+'" fill="none" stroke="#4a5460" stroke-width="9.5" stroke-linecap="round"/>'
            +'<path d="'+armL+'" fill="none" stroke="url(#'+gid+')" stroke-width="6.5" stroke-linecap="round"/>'
            +'<path d="'+armR+'" fill="none" stroke="url(#'+gid+')" stroke-width="6.5" stroke-linecap="round"/>'
            +'</svg>';
    }
    // 첫 데이터·폴더 동기화가 끝날 때까지는 집게를 아예 만들지 않는다.
    // 단순히 display만 숨기면 로딩 뒤 진행 중이던 rAF가 나타날 수 있다.
    let _clawReady=false;
    function _clawEl(id){ return document.getElementById(id); }
    let _clawBusy=false;
    function _clawShow(){
        if(!_clawReady||document.body.classList.contains('sdy-booting')) return false;
        const splash=document.getElementById('splash');
        if(splash&&!splash.classList.contains('hide')) return false;
        const f=_clawEl('clawFx');
        if(f){ try{ f.style.setProperty('display','block','important'); }catch(e){ f.style.display='block'; } }
        try{
            const hd=_clawEl('clawHead');
            if(hd && !hd.dataset.metalOk){ hd.innerHTML=_clawSvgHtml(); hd.dataset.metalOk='1'; }
        }catch(e){}
        _clawBusy=true;
        return true;
    }
    function _clawHide(){ const f=_clawEl('clawFx'); if(f){ try{ f.style.setProperty('display','none','important'); }catch(e){ f.style.display='none'; } } _clawBusy=false; }
    // 이전 집게 애니메이션이 다른 애니메이션과 겹쳐 중단됐을 때 남는
    // 클론 카드(파일 이름)와 숨겨진 원본 카드를 모두 원상복구한다.
    function _clawCleanup(){
        try{
            const fx=_clawEl('clawFx');
            if(fx) fx.querySelectorAll('.claw-unit').forEach(u=>u.remove());
            const hn=_clawEl('clawNote'); if(hn){ hn.innerHTML=''; hn.style.opacity=''; hn.style.transform=''; hn.style.display=''; }
            const hd=_clawEl('clawHead'); if(hd){
                hd.style.top=''; hd.style.left=''; hd.style.transform=''; hd.style.display='';
                hd.style.removeProperty('--claw-angle'); hd.style.removeProperty('--claw-scale');
            }
            const w=_clawEl('clawWire'); if(w){
                w.style.height=''; w.style.left=''; w.style.top=''; w.style.transform=''; w.style.display='';
                w.style.removeProperty('--claw-angle');
            }
        }catch(e){}
        try{ document.querySelectorAll('.note-card,.folder-card').forEach(c=>{ c.style.visibility=''; }); }catch(e){}
    }
    // easeOutCubic
    function _ease(t){ return 1-Math.pow(1-t,3); }
    let _clawToken=0;
    // 실제 카드를 클론해서 '뽑기 기계가 잡을 노트'로 만든다
    function _clawNoteVisual(card, r){
        try{ if(card._render) card._render(); }catch(e){}   // 미리보기 강제 렌더
        const geom=_clawCardGeom(card);
        const clone=card.cloneNode(true);
        clone.classList.add('claw-grab');
        // 10.0 · '빈 집게' 수정: 이 클론은 원본과 같은 data-nb-id/data-folder-id 를
        //   가지고 있어, playClawDrop 의 hideCard() 가 document 전체 검색으로
        //   실제 카드를 숨길 때 집게가 들고 있는 클론까지 함께 잡혀 보이지 않았다.
        //   신원 속성을 떼어 내고 무조건 보이게 한다.
        try{
            clone.removeAttribute('data-nb-id');
            clone.removeAttribute('data-folder-id');
            clone.removeAttribute('id');
            clone.classList.remove('home-open','home-lift','home-peek','claw-landed');
            clone.style.visibility='visible';
            clone.style.opacity='1';
        }catch(e){}
        clone.querySelectorAll('.emoji-picker,.select-check,.card-menu,.pin-badge,'
            +'.unlock-badge,.lock-overlay,.admin-verified,.live-dot,'
            +'.folder-menu-btn,.folder-lock').forEach(n=>n.remove());
        // 14.13.6 · 홈 스택은 translate(-50%,-50%)+rotate 를 인라인으로 심는다.
        //   AABB 폭·그 변환을 클론에 남기면 집게 안 노트가 작고 휘어 보였다.
        //   레이아웃 크기만 강제하고 변환은 부모 .claw-note 의 매달림 회전에 맡긴다.
        const w=Math.round(geom.width), h=Math.round(geom.height);
        clone.style.position='relative';
        clone.style.left='auto';
        clone.style.top='auto';
        clone.style.right='auto';
        clone.style.bottom='auto';
        clone.style.margin='0';
        clone.style.transform='none';
        clone.style.transformOrigin='50% 0';
        clone.style.width=w+'px';
        clone.style.height=h+'px';
        clone.style.minWidth=w+'px';
        clone.style.maxWidth='none';
        clone.style.flex='0 0 '+w+'px';
        clone.style.zIndex='1';
        if(geom.pvH){
            const pv=clone.querySelector('.note-preview, .folder-thumb');
            if(pv){
                pv.style.height=Math.round(geom.pvH)+'px';
                pv.style.minHeight=Math.round(geom.pvH)+'px';
            }
        }
        try{ rescaleOne(clone.querySelector('.note-preview')); }catch(e){}
        return clone;
    }
    // getBoundingClientRect()는 화면 px, zoom 된 fixed 레이어의 left/top은 UI CSS px다.
    // 두 단위를 섞으면 90% 데스크톱 환경에서 집게가 카드 오른쪽 아래로 밀린다.
    function _clawCss(v){
        return window.sdyUiCss?window.sdyUiCss(v):(Number(v)||0);
    }
    function _clawRect(el){
        const r=el.getBoundingClientRect();
        return {left:_clawCss(r.left),top:_clawCss(r.top),
                width:_clawCss(r.width),height:_clawCss(r.height)};
    }
    // 화면 가운데 위쪽의 크레인 레일에서 가장자리 카드 쪽으로 아주 조금
    // 벌어지게 한다(최대 3.2°). 과한 사선은 피하면서 현재 뷰포트에 자연스럽게
    // 맞고, 줄의 끝점과 집게 윗중심은 정확히 같은 좌표를 사용한다.
    function _clawRig(headX,headY){
        const vw=Math.max(1,window.innerWidth||document.documentElement.clientWidth||1);
        const edge=Math.max(-1,Math.min(1,(headX-vw/2)/(vw/2)));
        const lean=edge*3.2;
        const y=Math.max(0,headY);
        const rad=lean*Math.PI/180;
        const anchorX=headX-Math.tan(rad)*y;
        return {angle:-lean,anchorX,length:y/Math.max(.98,Math.cos(rad)),lean};
    }
    // 14.13.6 · 홈 스택/부채꼴처럼 카드 각도가 있으면 줄·집게를 그 각도로 맞춘다.
    //   CSS rotate(θ) 에서 아래 방향 벡터는 (-sin θ, cos θ).
    function _clawRigAt(headX,headY,angleDeg){
        const th=(Number(angleDeg)||0)*Math.PI/180;
        const y=Math.max(0,headY);
        const c=Math.max(.5,Math.cos(th));
        const length=y/c;
        const ang=Number(angleDeg)||0;
        return {angle:ang,anchorX:headX+Math.sin(th)*length,length,lean:-ang};
    }
    function _clawCardRot(el){
        try{
            const tr=getComputedStyle(el).transform;
            if(!tr||tr==='none') return 0;
            let a,b;
            if(typeof DOMMatrixReadOnly==='function'){
                const m=new DOMMatrixReadOnly(tr); a=m.a; b=m.b;
            }else{
                const nums=tr.match(/matrix(?:3d)?\(([^)]+)\)/);
                if(!nums) return 0;
                const p=nums[1].split(',').map(Number);
                a=p[0]; b=p[1];
            }
            const deg=Math.atan2(b,a)*180/Math.PI;
            return Math.abs(deg)<.08?0:deg;
        }catch(e){ return 0; }
    }
    function _clawCardGeom(el){
        const r=_clawRect(el);
        const width=Math.max(1, el.offsetWidth||Math.round(r.width)||200);
        const height=Math.max(1, el.offsetHeight||Math.round(r.height)||1);
        const rot=_clawCardRot(el);
        let gripX=r.left+r.width/2, gripY=r.top;
        try{
            const probe=document.createElement('i');
            probe.setAttribute('aria-hidden','true');
            probe.style.cssText='position:absolute;left:50%;top:0;width:0;height:0;margin:0;padding:0;border:0;pointer-events:none;visibility:hidden;';
            el.appendChild(probe);
            const pr=probe.getBoundingClientRect();
            probe.remove();
            if(pr){
                gripX=_clawCss(pr.left+pr.width/2);
                gripY=_clawCss(pr.top);
            }
        }catch(e){}
        let pvH=0;
        try{
            const pv=el.querySelector('.note-preview, .folder-thumb');
            if(pv) pvH=pv.offsetHeight||0;
        }catch(e){}
        return {width,height,rot,gripX,gripY,left:r.left,top:r.top,aabbW:r.width,aabbH:r.height,pvH};
    }
    function _clawUseRot(rot){ return Math.abs(Number(rot)||0)>.2; }
    function _clawHeadFromGrip(gripX,gripY,angleDeg,scale){
        const grab=_clawGripD(scale);
        const th=(Number(angleDeg)||0)*Math.PI/180;
        return {x:gripX+Math.sin(th)*grab, y:gripY-Math.cos(th)*grab, grab};
    }
    function _clawAim(el){
        const g=_clawCardGeom(el);
        const noteW=Math.max(g.width,60);
        const scale=_clawScaleFor(noteW);
        const useRot=_clawUseRot(g.rot);
        const hd=_clawHeadFromGrip(g.gripX,g.gripY,useRot?g.rot:0,scale);
        return {g,noteW,scale,useRot,ang:useRot?g.rot:null,targetX:hd.x,headY:hd.y};
    }
    function _clawPlaceParts(head,wire,note,headX,headY,noteW,withNote,cardAngle){
        if(!head||!wire) return;
        const useCard=cardAngle!=null && isFinite(Number(cardAngle));
        const rig=useCard?_clawRigAt(headX,headY,Number(cardAngle)):_clawRig(headX,headY);
        const scale=_clawScaleFor(noteW);        // 카드 폭 비례 배율
        const angle=rig.angle.toFixed(3)+'deg';
        head.style.left=headX+'px'; head.style.top=headY+'px';
        head.style.setProperty('--claw-angle',angle);
        head.style.setProperty('--claw-scale',String(scale));
        wire.style.left=rig.anchorX+'px'; wire.style.top='0px';
        wire.style.height=rig.length+'px';
        wire.style.setProperty('--claw-angle',angle);
        if(note&&withNote){
            // 회전된 집게의 실제 발끝을 카드 중앙 상단에 붙인다.
            // CSS rotate(θ) · 발끝 = head + (-sin θ, cos θ) * grab
            const grab=_clawGripD(scale), th=rig.angle*Math.PI/180;
            const gripX=headX-Math.sin(th)*grab;
            const gripY=headY+Math.cos(th)*grab;
            note.style.left=Math.round(gripX-noteW/2)+'px';
            note.style.top=Math.round(gripY)+'px';
            // 14.13.2 · 들고 있는 노트도 집게와 같은 각도로 매달린다.
            //   예전엔 줄·집게만 기울고 노트만 똑바르게 떠 있어서 어색했는데,
            //   줄-집게-노트가 한 세트처럼 보이고 놓는 순간에 바로 선다.
            note.style.transform='rotate('+angle+')';
        }
    }
    // 집게 머리 + 와이어 + 노트를 특정 좌표로 정렬
    function _clawPos(headX, headY, note, noteW, cardAngle){
        _clawPlaceParts(_clawEl('clawHead'),_clawEl('clawWire'),note,
                        headX,headY,noteW,!!note,cardAngle);
    }
    // ① 노트 추가: 크레인이 실제 노트를 잡고 내려와 카드가 놓인 자리에 두고 간다
    function playClawDrop(card, done){
        if(sdyTurbo()){ if(done)done(); return; }   // 22.x · 똥컴 모드는 장식 애니메이션 생략
        if(!_clawReady||document.body.classList.contains('sdy-booting')){ if(done)done(); return; }
        const head=_clawEl('clawHead'), note=_clawEl('clawNote');
        if(!_clawEl('clawFx')||!head||!note){ if(done)done(); return; }
        if(!card){ if(done)done(); return; }
        const tok=++_clawToken;
        _clawCleanup();
        let settled=false;
        // 9.3 · 순서 교정: 카드는 집게가 "놓는 순간"에 비로소 생긴다.
        //   (기존) 실제 카드가 먼저 보이고 → 그 위에 클론을 놓는 시늉 → 순서가 거꾸로
        //   (수정) 실제 카드를 먼저 숨기고 → 집게가 클론을 들고 내려와 자리에 놓고
        //          그 순간 실제 카드를 드러낸 뒤 → 빈 집게만 올라간다
        // 목록이 다시 그려지면 카드 DOM 노드가 통째로 교체된다.
        // 그래서 노드를 붙잡지 말고 매 프레임 '지금 살아 있는 카드'를 다시 찾아서 숨긴다.
        const _cardSel=(()=>{
            try{
                if(card.dataset&&card.dataset.nbId) return '.note-card[data-nb-id="'+card.dataset.nbId+'"]';
                if(card.dataset&&card.dataset.folderId) return '.folder-card[data-folder-id="'+card.dataset.folderId+'"]';
            }catch(e){}
            return null;
        })();
        const _liveCards=()=>{
            const out=[card];
            // 10.0 · #clawFx 안의 클론(집게가 든 카드)은 숨기면 안 된다.
            if(_cardSel){ try{ document.querySelectorAll(_cardSel).forEach(n=>{
                if(!out.includes(n) && !(n.closest&&n.closest('#clawFx'))) out.push(n);
            }); }catch(e){} }
            return out;
        };
        let placed=false;
        const hideCard  =()=>{ if(placed)return; _liveCards().forEach(n=>{ try{ n.style.visibility='hidden'; }catch(e){} }); };
        // 놓이는 순간 실제 카드가 살짝 '착지'하면서 안정되는 느낌
        const revealCard=()=>{ placed=true; _liveCards().forEach(n=>{ try{
            n.style.visibility='';
            // 스택/부채꼴 카드는 transform 이 각도 그 자체라 clawLand 애니를 씌우면 휘어진다.
            if(!(n.closest&&n.closest('.note-stack'))){
                n.classList.add('claw-landed');
                setTimeout(()=>n.classList.remove('claw-landed'),360);
            }
        }catch(e){} }); };
        const finish=()=>{ if(settled)return; settled=true; revealCard(); if(done)done(); };
        setTimeout(finish, 2600);              // rAF 멈춤 대비 안전장치
        try{ card.scrollIntoView({block:'center', behavior:'auto'}); }catch(e){}
        const aim=_clawAim(card);
        const noteW=aim.noteW, scale=aim.scale, cardAng=aim.ang;
        const targetX=aim.targetX, targetHeadY=aim.headY;
        // 실제 카드 클론 (숨기기 전에 떠야 미리보기가 그대로 복사된다)
        const clone=_clawNoteVisual(card, aim.g);
        note.innerHTML=''; note.appendChild(clone);
        note.style.width=noteW+'px';
        note.style.height=Math.round(aim.g.height)+'px';
        note.style.opacity='1';
        hideCard();                                        // 아직 "존재하지 않는" 상태
        const startY=-(CLAW_H*scale)-140;      // 화면 위에서 시작
        _clawPos(targetX, startY, note, noteW, cardAng);
        if(!_clawShow()){ revealCard(); finish(); return; }
        const t0=performance.now();
        const MOVE_T=260, DROP_T=620, RELEASE_T=240, UP_T=430;
        const landAngle=cardAng!=null?cardAng:_clawRig(targetX,targetHeadY).angle;
        function step(now){
            if(tok!==_clawToken){ revealCard(); finish(); return; }
            const t=now-t0;
            if(t<MOVE_T){                      // 상단에서 목표 x로 이동(노트를 든 채)
                hideCard();                    // 재렌더로 카드가 되살아나도 계속 숨긴다
                _clawPos(targetX, startY, note, noteW, cardAng);
            }else if(t<MOVE_T+DROP_T){         // 아래로 내려옴(노트를 잡은 채)
                hideCard();
                const p=_ease((t-MOVE_T)/DROP_T);
                _clawPos(targetX, startY+(targetHeadY-startY)*p, note, noteW, cardAng);
            }else if(t<MOVE_T+DROP_T+RELEASE_T){ // 놓는 순간: 스택이면 카드 각도 유지, 격자면 바로 선다
                hideCard();
                _clawPos(targetX, targetHeadY, note, noteW, cardAng);
                if(cardAng==null){
                    const pr=_ease((t-MOVE_T-DROP_T)/RELEASE_T);
                    note.style.transform='rotate('+(landAngle*(1-pr)).toFixed(3)+'deg)';
                }
            }else if(t<MOVE_T+DROP_T+RELEASE_T+UP_T){ // 실제 카드로 교대 + 빈 집게 상승
                if(!placed){                    // 클론 → 실제 카드 교대 (크기·각도 완벽 일치)
                    revealCard();
                    note.style.opacity='0';
                }
                const p=_ease((t-MOVE_T-DROP_T-RELEASE_T)/UP_T);
                _clawPos(targetX, targetHeadY-p*(targetHeadY+260), null, noteW, cardAng);
            }else{
                _clawHide();
                note.innerHTML=''; note.style.opacity='';
                head.style.top=''; head.style.left='';
                finish();
                return;
            }
            requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }
    // ② 노트 삭제: 크레인이 빈 손으로 내려와 실제 노트를 집어 위로 끌어올려 던진다
    function playClawThrow(card, done){
        if(sdyTurbo()){ if(done)done(); return; }   // 22.x · 똥컴 모드는 장식 애니메이션 생략
        if(!_clawReady||document.body.classList.contains('sdy-booting')){ if(done)done(); return; }
        const head=_clawEl('clawHead'), note=_clawEl('clawNote');
        if(!_clawEl('clawFx')||!head||!note){ if(done)done(); return; }
        let ghost=null;
        if(!card){
            ghost=document.createElement('div');
            ghost.className='note-card';
            ghost.style.cssText='position:fixed;left:50%;top:42%;transform:translate(-50%,-50%);width:168px;min-height:70px;opacity:0;pointer-events:none;z-index:1;';
            ghost.innerHTML='<div class="note-card-name"><span>노트</span></div>';
            document.body.appendChild(ghost);
            card=ghost;
        }
        const tok=++_clawToken;
        _clawCleanup();
        let settled=false;
        const finish=()=>{ if(settled)return; settled=true; try{ card.style.visibility=''; }catch(e){} try{ if(ghost) ghost.remove(); }catch(e){} if(done)done(); };
        setTimeout(finish, 2400);              // rAF 멈춤 대비 안전장치
        try{ card.scrollIntoView({block:'center', behavior:'auto'}); }catch(e){}
        const aim=_clawAim(card);
        const noteW=aim.noteW, scale=aim.scale, cardAng=aim.ang;
        const targetX=aim.targetX, grabHeadY=aim.headY;
        const clone=_clawNoteVisual(card, aim.g);
        note.innerHTML=''; note.appendChild(clone);
        note.style.width=noteW+'px';
        note.style.height=Math.round(aim.g.height)+'px';
        note.style.opacity='0';
        note.style.display='none';
        const startY=-(CLAW_H*scale)-140;
        _clawPos(targetX, startY, null, noteW, cardAng);
        _clawShow();
        const t0=performance.now();
        const MOVE_T=260, DROP_T=560, GRAB_T=180, LIFT_T=560;
        // 14.13.2 · 화면 가까운 쪽으로 살짝 비스듬히 던진다 (예전엔 항상 오른쪽으로만)
        const dir=targetX<=innerWidth/2?-1:1;
        let grabbed=false;
        function step(now){
            if(tok!==_clawToken){ finish(); return; }
            const t=now-t0;
            if(t<MOVE_T){                      // 빈 집게가 상단에서 목표 위치로 수평 이동
                _clawPos(targetX, startY, null, noteW, cardAng);
            }else if(t<MOVE_T+DROP_T){         // 빈 집게가 노트 위로 하강
                const p=_ease((t-MOVE_T)/DROP_T);
                _clawPos(targetX, startY+(grabHeadY-startY)*p, null, noteW, cardAng);
            }else if(t<MOVE_T+DROP_T+GRAB_T){  // 노트를 집는 순간 (실제 노트를 숨기고 집게 클론 활성화)
                if(!grabbed){
                    grabbed=true;
                    try{ card.style.visibility='hidden'; }catch(e){}
                    note.style.display='';
                    note.style.opacity='1';
                }
                _clawPos(targetX, grabHeadY, note, noteW, cardAng);
            }else if(t<MOVE_T+DROP_T+GRAB_T+LIFT_T){ // 노트를 쥔 채 끌어올려 던짐
                const p=_ease((t-MOVE_T-DROP_T-GRAB_T)/LIFT_T);
                const x=p*innerWidth*0.5*dir;
                const y=grabHeadY-p*(innerHeight*1.2);
                // 14.13.2 · 560도 돌려던지던 것을 한 바퀴 미만의 자연스러운 회전으로
                const rot=p*150*dir;
                // 던지는 동안에도 줄 끝과 집게 윗중심을 같은 기하로 계산한다.
                _clawPos(targetX+x,y,note,noteW);
                note.style.transform='rotate('+rot+'deg)';
                note.style.opacity=String(Math.max(0,1-p*1.4));
            }else{
                _clawHide();
                note.innerHTML=''; note.style.opacity=''; note.style.transform=''; note.style.display='';
                head.style.top=''; head.style.left='';
                if(grabbed){ try{ card.style.visibility=''; }catch(e){} }
                finish();
                return;
            }
            requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }
    // ②-b 노트 1개를 폴더로: 삭제와 같은 단일 집게가 내려와 잡아 폴더로 넣는다
    function playClawToFolder(card, folderEl, done){
        if(sdyTurbo()){ if(done)done(); return; }   // 22.x · 똥컴 모드는 장식 애니메이션 생략
        if(!_clawReady||document.body.classList.contains('sdy-booting')){ if(done)done(); return; }
        const head=_clawEl('clawHead'), note=_clawEl('clawNote'), wire=_clawEl('clawWire');
        if(!_clawEl('clawFx')||!head||!note||!wire){ if(done)done(); return; }
        if(!card){ playClawThrow(card, done); return; }
        const tok=++_clawToken;
        _clawCleanup();
        let settled=false;
        const finish=()=>{ if(settled)return; settled=true; try{ card.style.visibility=''; }catch(e){} if(done)done(); };
        setTimeout(finish, 3200);
        try{ card.scrollIntoView({block:'center', behavior:'auto'}); }catch(e){}
        const aim=_clawAim(card);
        const noteW=aim.noteW, scale=aim.scale, cardAng=aim.ang;
        const targetX=aim.targetX, grabHeadY=aim.headY;
        let fX=innerWidth/2, fY=innerHeight*0.38;
        if(folderEl){
            try{ folderEl.scrollIntoView({block:'center', behavior:'auto'}); }catch(e){}
            const fa=_clawAim(folderEl);
            fX=fa.targetX; fY=fa.headY;
        }
        const clone=_clawNoteVisual(card, aim.g);
        note.innerHTML=''; note.appendChild(clone);
        note.style.width=noteW+'px';
        note.style.height=Math.round(aim.g.height)+'px';
        note.style.opacity='0';
        note.style.display='none';
        note.style.transform='';
        const startY=-(CLAW_H*scale)-140;
        _clawPos(targetX, startY, null, noteW, cardAng);
        if(!_clawShow()){ finish(); return; }
        const t0=performance.now();
        const MOVE_T=220, DROP_T=520, GRAB_T=160, CARRY_T=640, SINK_T=260;
        let grabbed=false;
        function step(now){
            if(tok!==_clawToken){ finish(); return; }
            const t=now-t0;
            if(t<MOVE_T){
                _clawPos(targetX, startY, null, noteW, cardAng);
            }else if(t<MOVE_T+DROP_T){
                const p=_ease((t-MOVE_T)/DROP_T);
                _clawPos(targetX, startY+(grabHeadY-startY)*p, null, noteW, cardAng);
            }else if(t<MOVE_T+DROP_T+GRAB_T){
                if(!grabbed){
                    grabbed=true;
                    try{ card.style.visibility='hidden'; }catch(e){}
                    note.style.display='';
                    note.style.opacity='1';
                }
                _clawPos(targetX, grabHeadY, note, noteW, cardAng);
            }else if(t<MOVE_T+DROP_T+GRAB_T+CARRY_T){
                const p=_ease((t-MOVE_T-DROP_T-GRAB_T)/CARRY_T);
                const hx=targetX+(fX-targetX)*p;
                const hy=grabHeadY+(fY-grabHeadY)*p;
                _clawPos(hx, hy, note, noteW, cardAng);
            }else if(t<MOVE_T+DROP_T+GRAB_T+CARRY_T+SINK_T){
                const p=_ease((t-MOVE_T-DROP_T-GRAB_T-CARRY_T)/SINK_T);
                const shrink=1-p*0.65;
                _clawPos(fX, fY, note, noteW, cardAng);
                note.style.opacity=String(Math.max(0,1-p));
                note.style.transform='rotate('+(cardAng||0)+'deg) scale('+shrink+')';
                // 집게도 현재(노트 비례) 크기를 기준으로 같이 줄어든다
                head.style.setProperty('--claw-scale',String(scale*shrink));
            }else{
                _clawHide();
                note.innerHTML=''; note.style.opacity=''; note.style.transform=''; note.style.display='';
                head.style.top=''; head.style.left='';
                head.style.removeProperty('--claw-angle'); head.style.removeProperty('--claw-scale');
                if(grabbed){ try{ card.style.visibility=''; }catch(e){} }
                finish();
                return;
            }
            requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }
    // ③ 여러 노트 삭제: 빈 집게 여러 대가 내려와 한꺼번에 잡아 던진다
    function playClawThrowMulti(cards, done){
        if(sdyTurbo()){ if(done)done(); return; }   // 22.x · 똥컴 모드는 장식 애니메이션 생략
        if(!_clawReady||document.body.classList.contains('sdy-booting')){ if(done)done(); return; }
        const fx=_clawEl('clawFx');
        if(!fx){ if(done)done(); return; }
        const valid=(cards||[]).filter(c=>c);
        if(!valid.length){ if(done)done(); return; }
        const tok=++_clawToken;
        _clawCleanup();
        let settled=false;
        const finish=()=>{ if(settled)return; settled=true; if(done)done(); };
        setTimeout(finish, 3400);              // rAF 멈춤 대비 안전장치
        // 단일용 고정 요소는 숨긴다 (다중 유닛이 대신 표시)
        const fxHead=_clawEl('clawHead'), fxWire=_clawEl('clawWire'), fxNote=_clawEl('clawNote');
        if(fxHead) fxHead.style.display='none';
        if(fxWire) fxWire.style.display='none';
        if(fxNote) fxNote.style.display='none';
        // 최대 12개까지만 시각화 (너무 많으면 화면이 어지러움)
        const show=valid.slice(0,12);
        const units=show.map(card=>{
            try{ card.scrollIntoView({block:'center',behavior:'auto'}); }catch(e){}
            const aim=_clawAim(card);
            const clone=_clawNoteVisual(card, aim.g);
            const unit=document.createElement('div');
            unit.className='claw-unit';
            const wire=document.createElement('div'); wire.className='claw-wire';
            const head=document.createElement('div'); head.className='claw-head';
            head.innerHTML=_clawSvgHtml();
            const note=document.createElement('div'); note.className='claw-note';
            note.style.display='none';
            note.style.opacity='0';
            note.style.width=aim.noteW+'px';
            note.style.height=Math.round(aim.g.height)+'px';
            note.appendChild(clone);
            unit.appendChild(wire); unit.appendChild(head); unit.appendChild(note);
            fx.appendChild(unit);
            return {card,unit,wire,head,note,targetX:aim.targetX,grabHeadY:aim.headY,noteW:aim.noteW,
                    cardAng:aim.ang, startY:-(CLAW_H*aim.scale)-160-(Math.random()*60), grabbed:false};
        });
        _clawShow();
        const place=(u,headY,headX,withNote)=>{
            _clawPlaceParts(u.head,u.wire,u.note,headX,headY,u.noteW,withNote,u.cardAng);
        };
        const t0=performance.now();
        const MOVE_T=260, DROP_T=560, GRAB_T=200, LIFT_T=620;
        function step(now){
            if(tok!==_clawToken){   // 세션이 넘어가면 유닛·숨긴 카드 정리
                units.forEach(u=>{ try{ u.unit.remove(); }catch(e){} try{ u.card.style.visibility=''; }catch(e){} });
                if(fxHead) fxHead.style.display='';
                if(fxWire) fxWire.style.display='';
                if(fxNote) fxNote.style.display='';
                finish(); return;
            }
            const t=now-t0;
            units.forEach(u=>{
                if(t<MOVE_T){ place(u,u.startY,u.targetX,false); }
                else if(t<MOVE_T+DROP_T){
                    const p=_ease((t-MOVE_T)/DROP_T);
                    place(u, u.startY+(u.grabHeadY-u.startY)*p, u.targetX, false);
                }else if(t<MOVE_T+DROP_T+GRAB_T){
                    if(!u.grabbed){
                        u.grabbed=true;
                        try{ u.card.style.visibility='hidden'; }catch(e){}
                        u.note.style.display='';
                        u.note.style.opacity='1';
                    }
                    place(u,u.grabHeadY,u.targetX,true);
                }else if(t<MOVE_T+DROP_T+GRAB_T+LIFT_T){
                    const p=_ease((t-MOVE_T-DROP_T-GRAB_T)/LIFT_T);
                    // 14.13.2 · 가까운 쪽으로 한 바퀴 미만 회전 (예전 560도)
                    const dir=u.targetX<=innerWidth/2?-1:1;
                    const x=p*innerWidth*0.5*dir, y=u.grabHeadY-p*(innerHeight*1.2), rot=p*150*dir;
                    place(u,y,u.targetX+x,true);
                    u.note.style.transform='rotate('+rot+'deg)';
                    u.note.style.opacity=String(Math.max(0,1-p*1.4));
                }
            });
            if(t>=MOVE_T+DROP_T+GRAB_T+LIFT_T){
                units.forEach(u=>{ try{ u.unit.remove(); }catch(e){} try{ u.card.style.visibility=''; }catch(e){} });
                if(fxHead) fxHead.style.display='';
                if(fxWire) fxWire.style.display='';
                if(fxNote) fxNote.style.display='';
                _clawHide();
                finish();
                return;
            }
            requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }
    // ④ 여러 노트를 폴더로 끌어넣을 때: 빈 집게 여러 대가 내려와 잡고 해당 폴더 카드로 넣는 모션
    function playClawToFolderMulti(cards, folderEl, done){
        if(sdyTurbo()){ if(done)done(); return; }   // 22.x · 똥컴 모드는 장식 애니메이션 생략
        const valid=(cards||[]).filter(c=>c);
        if(valid.length===1){ playClawToFolder(valid[0], folderEl, done); return; }
        if(!_clawReady||document.body.classList.contains('sdy-booting')){ if(done)done(); return; }
        const fx=_clawEl('clawFx');
        if(!fx){ if(done)done(); return; }
        if(!valid.length){ if(done)done(); return; }
        const tok=++_clawToken;
        _clawCleanup();
        let settled=false;
        const finish=()=>{ if(settled)return; settled=true; if(done)done(); };
        setTimeout(finish, 3600);
        const fxHead=_clawEl('clawHead'), fxWire=_clawEl('clawWire'), fxNote=_clawEl('clawNote');
        if(fxHead) fxHead.style.display='none';
        if(fxWire) fxWire.style.display='none';
        if(fxNote) fxNote.style.display='none';
        const show=valid.slice(0,12);
        // 목표 폴더 위치 (집게들이 모두 이곳으로 모인다)
        let fX=innerWidth/2, fY=innerHeight*0.4;
        if(folderEl){
            try{ folderEl.scrollIntoView({block:'center',behavior:'auto'}); }catch(e){}
            const fa=_clawAim(folderEl);
            fX=fa.targetX; fY=fa.headY;
        }
        const units=show.map(card=>{
            try{ card.scrollIntoView({block:'center',behavior:'auto'}); }catch(e){}
            const aim=_clawAim(card);
            const clone=_clawNoteVisual(card, aim.g);
            const unit=document.createElement('div');
            unit.className='claw-unit';
            const wire=document.createElement('div'); wire.className='claw-wire';
            const head=document.createElement('div'); head.className='claw-head';
            head.innerHTML=_clawSvgHtml();
            const note=document.createElement('div'); note.className='claw-note';
            note.style.display='none';
            note.style.opacity='0';
            note.style.width=aim.noteW+'px';
            note.style.height=Math.round(aim.g.height)+'px';
            note.appendChild(clone);
            unit.appendChild(wire); unit.appendChild(head); unit.appendChild(note);
            fx.appendChild(unit);
            return {card,unit,wire,head,note,targetX:aim.targetX,grabHeadY:aim.headY,noteW:aim.noteW,
                    cardAng:aim.ang, startY:-(CLAW_H*aim.scale)-160-(Math.random()*60), grabbed:false};
        });
        _clawShow();
        const place=(u,headY,headX,withNote)=>{
            _clawPlaceParts(u.head,u.wire,u.note,headX,headY,u.noteW,withNote,u.cardAng);
        };
        const t0=performance.now();
        const MOVE_T=260, DROP_T=520, GRAB_T=180, CARRY_T=700, SINK_T=280;
        function step(now){
            if(tok!==_clawToken){
                units.forEach(u=>{ try{ u.unit.remove(); }catch(e){} try{ u.card.style.visibility=''; }catch(e){} });
                if(fxHead) fxHead.style.display='';
                if(fxWire) fxWire.style.display='';
                if(fxNote) fxNote.style.display='';
                finish(); return;
            }
            const t=now-t0;
            units.forEach(u=>{
                if(t<MOVE_T){ place(u,u.startY,u.targetX,false); }
                else if(t<MOVE_T+DROP_T){
                    const p=_ease((t-MOVE_T)/DROP_T);
                    place(u, u.startY+(u.grabHeadY-u.startY)*p, u.targetX, false);
                }else if(t<MOVE_T+DROP_T+GRAB_T){
                    if(!u.grabbed){
                        u.grabbed=true;
                        try{ u.card.style.visibility='hidden'; }catch(e){}
                        u.note.style.display='';
                        u.note.style.opacity='1';
                    }
                    place(u,u.grabHeadY,u.targetX,true);
                }else if(t<MOVE_T+DROP_T+GRAB_T+CARRY_T){
                    // 폴더 위로 모여든다
                    const p=_ease((t-MOVE_T-DROP_T-GRAB_T)/CARRY_T);
                    const hx=u.targetX+(fX-u.targetX)*p;
                    const hy=u.grabHeadY+(fY-u.grabHeadY)*p;
                    place(u,hy,hx,true);
                }else if(t<MOVE_T+DROP_T+GRAB_T+CARRY_T+SINK_T){
                    // 폴더 안으로 가라앉듯 사라진다
                    const p=_ease((t-MOVE_T-DROP_T-GRAB_T-CARRY_T)/SINK_T);
                    const shrink=1-p*0.6;
                    u.note.style.opacity=String(Math.max(0,1-p));
                    u.note.style.transform='rotate('+(u.cardAng||0)+'deg) scale('+shrink+')';
                    // 집게도 현재(노트 비례) 크기를 기준으로 같이 줄어든다
                    u.head.style.setProperty('--claw-scale',String(_clawScaleFor(u.noteW)*shrink));
                }
            });
            if(t>=MOVE_T+DROP_T+GRAB_T+CARRY_T+SINK_T){
                units.forEach(u=>{ try{ u.unit.remove(); }catch(e){} try{ u.card.style.visibility=''; }catch(e){} });
                if(fxHead) fxHead.style.display='';
                if(fxWire) fxWire.style.display='';
                if(fxNote) fxNote.style.display='';
                _clawHide();
                finish();
                return;
            }
            requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }
    // ============ 실시간 노트 목록 동기화 (새 노트/제목 변경/영구 삭제) ============
    // 다른 기기에서 만든 노트가 실시간으로 나타나고(집게로 내려놓기),
    // 사라진 노트는 던져서 보여준다. 북마크·폴더·고정·휴지통은 설정 동기화가 담당.
    let _refreshingNBs=false;
    let _nbsLoaded=false;   // loadNBs 가 끝나기 전엔 목록 폴링을 멈춘다 (첫 로드 일괄 애니메이션 방지)
    async function refreshNBs(){
        if(_clawBusy||_refreshingNBs||!_nbsLoaded||!SB||!isOnline()||document.hidden) return;
        _refreshingNBs=true;
        try{
            const{data,error}=await SB.from('notebooks').select('*').order('created_at',{ascending:true});
            if(error) return;
            const gone=getTombstones().notebooks||{};
            const server=(data||[]).filter(nb=>{
                if(nb.title===SETTINGS_TITLE){ settingsNbId=nb.id; return false; }
                if(gone[nb.id]) return false;
                return true;
            });
            const serverIds=new Set(server.map(nb=>nb.id));
            const curIds=new Set(notebooks.map(nb=>nb.id));
            const newNbs=[], removedIds=[], titleUpd=[];
            server.forEach(nb=>{
                if(!curIds.has(nb.id)) newNbs.push(nb);
                else{
                    const cur=notebooks.find(x=>x.id===nb.id);
                    if(cur&&cur.title!==nb.title){ cur.title=nb.title; titleUpd.push(nb); }
                }
            });
            notebooks.forEach(nb=>{
                if(String(nb.id).startsWith('local_')) return;
                if(isTrashed(nb.id)) return;
                if(!serverIds.has(nb.id)) removedIds.push(nb.id);
            });
            // 제목만 바뀐 경우: 카드 글자만 갱신 (전체 재렌더로 선택/스크롤 흔들림 방지)
            if(titleUpd.length){
                titleUpd.forEach(nb=>{
                    const card=document.querySelector('.note-card[data-nb-id="'+nb.id+'"]');
                    const t=card&&card.querySelector('.note-card-name span');
                    if(t) t.textContent=nb.title;
                });
            }
            if(!newNbs.length&&!removedIds.length) return;
            // 새 노트의 소속(폴더) 정보를 최신으로 맞춘다 (member 연산이 늦게 도착해도 정확히)
            if(newNbs.length){ try{ await pullSettings(); }catch(e){} }
            const removedCards=removedIds.map(id=>document.querySelector('.note-card[data-nb-id="'+id+'"]')).filter(Boolean);
            const local=notebooks.filter(n=>String(n.id).startsWith('local_'));
            notebooks=sortNBs([...server, ...local]);
            if(removedCards.length) playClawThrowMulti(removedCards);
            renderGrid();
            newNbs.forEach(nb=>{           // 새 노트: 어느 위치에 보이는지에 따라 애니메이션
                const fid=noteFolder(nb.id);
                if(fid && fid!==curFolder){
                    // 보고 있지 않은 폴더에 온 노트 → 그 폴더 카드(보이면)에 넣는 애니메이션
                    setTimeout(()=>{ playNoteIntoFolderAnim(fid); },120);
                }else{
                    setTimeout(()=>{
                        const c=document.querySelector('.note-card[data-nb-id="'+nb.id+'"]');
                        if(c) playClawDrop(c);
                    },80);
                }
            });
            preloadPreviews();
        }catch(e){}finally{ _refreshingNBs=false; }
    }
    // 폴더 카드에 '노트가 새로 들어왔다'는 미니 애니메이션 (집게가 노트를 폴더에 넣는다)
    function playNoteIntoFolderAnim(fid){
        if(sdyTurbo()) return;   // 22.x · 똥컴 모드는 장식 애니메이션 생략
        const fc=document.querySelector('.folder-card[data-folder-id="'+fid+'"]');
        if(!fc) return;
        const r=_clawRect(fc);
        const holder=document.createElement('div');
        holder.style.cssText='position:fixed;z-index:1049;pointer-events:none;'+
                            'left:'+Math.max(8,r.left+8)+'px;top:'+Math.max(8,r.top-46)+'px;';
        const tmp=document.createElement('div');
        tmp.className='note-card';
        tmp.style.width='120px';
        tmp.innerHTML='<div class="note-preview" style="height:76px;background:var(--bg2);"></div>'+
                      '<div class="note-card-name"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">새 노트</span></div>';
        holder.appendChild(tmp);
        document.body.appendChild(holder);
        playClawToFolderMulti([tmp], fc, ()=>{ try{ holder.remove(); }catch(e){} });
    }
    // 로컬 이동 애니메이션 공용 (메뉴 이동/드래그/드롭에서 사용)
    function animateMoveLocal(ids, toFid, done){
        const cards=ids.map(id=>document.querySelector('.note-card[data-nb-id="'+id+'"]')).filter(Boolean);
        const destEl=toFid?document.querySelector('.folder-card[data-folder-id="'+toFid+'"]'):null;
        const finish=done||function(){};
        if(!cards.length){ playClawThrow(null, finish); return; }
        // 1개는 삭제와 같은 단일 집게 경로를 쓴다 (다중 유닛은 집게가 안 보이던 원인)
        if(cards.length===1){
            if(destEl) playClawToFolder(cards[0], destEl, finish);
            else playClawThrow(cards[0], finish);
            return;
        }
        if(destEl) playClawToFolderMulti(cards, destEl, finish);
        else playClawThrowMulti(cards, finish);
    }
    // 노트 목록 실시간 반영 (3초 주기 폴링 — 새 노트 집게/삭제/제목)
    setInterval(()=>{ try{ if(SB&&isOnline()&&!document.hidden) refreshNBs(); }catch(e){} },3000);

    async function _boot(){
        const t0=Date.now();
        try{
            // 개인화된 앱 제목이 있으면 스플래시에도 반영
            const st=document.querySelector('#splash .sp-title');
            if(st){
                const t=(S.appTitle&&String(S.appTitle).trim())?S.appTitle.trim():'동엽신의 끄적끄적';
                st.textContent=t;
            }
            _sp('노트 불러오는 중…',30);
            // 글꼴은 화면을 막지 않는다. 본문 글꼴 2개만 짧게 기다리고
            // 나머지(장식 글꼴 10여 개)는 뒤에서 계속 받는다.
            // 예전엔 13개를 모두 기다리느라 시작이 그만큼 늦었다.
            _preloadFonts();                // (기다리지 않음)
            await Promise.race([_coreFontsReady(), _sleep(600)]);
            _sp('노트 불러오는 중…',70);
            await loadNBs();                // 노트 목록 (미리보기는 뒤에서)
            _sp('완료',100);
        }catch(e){
            try{ console.warn('부팅 실패',e); }catch(_){}
        }
        // 스플래시가 깜빡이지 않도록 최소 표시 시간 보장
        const wait=Math.max(0, 450-(Date.now()-t0));
        setTimeout(_hideSplash, wait);
        try{ if(window.srvStart) window.srvStart(); }catch(e){}          // 서버 상태 계기판 시작
    }

    // 가져온 텍스트 선택 시 간격 조절 바 표시/숨김 (선택 경로 무관)
    try{
        new MutationObserver(()=>{
            clearTimeout(window._tbarT);
            window._tbarT=setTimeout(updateTightBar,80);
        }).observe(document.getElementById('pagesStage'),
            {subtree:true,attributes:true,attributeFilter:['class']});
    }catch(e){}
    document.getElementById('tcBar').style.background=currentTextColor;
    document.getElementById('tcGlyph').style.color=currentTextColor;
    _boot();
    

/* === script block 4 === */
(function(){function c(){var b=a.contentDocument||(a.contentWindow&&a.contentWindow.document);if(b){var d=b.createElement('script');d.innerHTML="window.__CF$cv$params={r:'a2a781b7af7de89c',t:'MTc4NjYyMTg3Mw=='};var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.getElementsByTagName('head')[0].appendChild(a);";b.getElementsByTagName('head')[0].appendChild(d)}}if(document.body){var a=document.createElement('iframe');a.height=1;a.width=1;a.style.position='absolute';a.style.top=0;a.style.left=0;a.style.border='none';a.style.visibility='hidden';document.body.appendChild(a);if('loading'!==document.readyState)c();else if(window.addEventListener)document.addEventListener('DOMContentLoaded',c);else{var e=document.onreadystatechange||function(){};document.onreadystatechange=function(b){e(b);'loading'!==document.readyState&&(document.onreadystatechange=e,c())}}}})();

/* APP-PART:14-menus-init.js:END */
