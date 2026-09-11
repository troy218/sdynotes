/* === src/app/14a-ctx-menu.js ===
   우클릭 메뉴 · 카드 컨텍스트 · 삭제
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:14a-ctx-menu.js:BEGIN */
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
                {a:'sel-find',  i:'ri-robot-line', t:`'${esc(short)}' 해돌이 설명`},
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
                // 22.2 · 글자 복사가 OS 클립보드를 가져갔으니 요소 클립보드 우선권 해제
                try{ invalidateElsCopyForOsText(); }catch(_e){}
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
            // 22.2 · 앱에서 복사/잘라낸 요소 붙여넣기 — 예전엔 OS 클립보드
            //   글자만 봐서, 요소를 복사한 뒤 우클릭 붙여넣기를 하면 오래된
            //   글자가 글상자로 붙거나 '클립보드가 비어 있습니다'가 떴다.
            //   지금은 클립보드가 '우리 것'이면 우클릭한 자리에 요소를 붙인다.
            try{
                if(clipboardEls.length){
                    let mine=false, _osTxt=null;
                    try{ _osTxt=String(await navigator.clipboard.readText()||''); }catch(_e){}
                    if(_elsOsWrite) mine=(_osTxt.trim()===String(_lastCopyText||'').trim());
                    else mine=(Date.now()-_elsCopyAt<_ELS_PASTE_WIN);
                    // OS 클립보드가 비어 보이는데 사진을 담고 있으면 사진이 우선
                    if(mine&&_osTxt.trim()===''){
                        try{
                            const _items=await navigator.clipboard.read();
                            if(_items.some(it=>it.types.some(x=>x.startsWith('image/')))) mine=false;
                        }catch(_e){}
                    }
                    if(mine){
                        lastMouse.pageIdx=pi; lastMouse.x=t.x; lastMouse.y=t.y;
                        pasteElements(); return;
                    }
                }
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
            // 14.39.2 · 브라우저 prompt(크롬 알림) 대신 앱 자체 모달로 크기를 고르고,
            //   우클릭한 자리에 곧바로 놓는다. 도구 막대'표 삽입'과 같은 모달(UI 통일).
            openTableSizeModal({pageIdx:pi,x:lastMouse.x,y:lastMouse.y});
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
            // 14.45 · '찾기' 버튼 → 해돌이가 고른 글을 설명.
            //   예전엔 '문서 찾기' 바를 열었는데, 메뉴를 누르는 순간 브라우저가
            //   선택을 지워 그대로 아무 일도 안 생기는 경우가 많았다. 지금은
            //   저장해 둔 선택(savedRange)을 되살려 그대로 해돌이 설명 요청으로
            //   보낸다 — 답은 해돌이 말풍선(#aiSay)에 뜬다.
            let q=String(window.getSelection()||'').trim();
            if(!q && restoreSel()){ q=String(window.getSelection()||'').trim(); }
            if(!q){ toast('텍스트를 드래그해 선택하세요',1300); return; }
            if(q.length>1200) q=q.slice(0,1200)+'…';
            if(typeof window.sdyAiExplain==='function'){
                window.sdyAiExplain('고른 글자를 쉽게 설명해 줘:\n"'+q+'"');
            } else {
                toast('해돌이 준비가 안 됐어요 · 페이지를 새로고침해 주세요',1800);
            }
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
            <div class="ctx-item" onclick="ctxAction('export')"><i class="ri-share-box-line"></i> 내보내기</div>
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
        else if(act==='export'){
            // 14.65.1 · 편집기 안의 '내보내기'와 동일하게 동작한다: 노트를 연 뒤
            //   PDF/JPG/현재 쪽 복사 등이 담긴 내보내기 창을 띄운다(JSON 백업 대체).
            if(isLocked(nb.id)&&!isUnlocked(nb.id)){ toast('잠긴 노트는 먼저 열어주세요'); return; }
            await openNB(nb);
            try{ openExportModal(); }catch(e){}
        }
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
            ['글자를 고르고 우클릭','번역 · 서식 · 글자색 · 링크 · 해돌이 설명 · 새 상자로 빼내기'],
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
        // 14.39.5 · closeEditor 를 거치지 않는 닫기 길도 똑같이 마무리한다.
        //   예전엔 html/body 의 in-editor 가 그대로 남아(overflow:hidden !important)
        //   노트를 지우고 홈으로 돌아오면 홈이 스크롤되지 않았다.
        //   종이 정리는 슬라이드아웃(.4s)이 끝난 뒤 — 닫는 동안 화면이 하얗게
        //   비는 깜빡임이 없게 closeEditor 와 같은 규칙을 쓴다.
        document.documentElement.classList.remove('in-editor');
        document.body.classList.remove('in-editor');
        setTimeout(()=>{ try{ teardownEditorStage(); }catch(e){} },420);
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
    // 14.62 · 제목 줄에서 Enter — 저장(change)은 그대로 가고 포커스도 바로 푼다.
    //   예전엔 저장은 되지만 마우스로 다른 곳을 눌러야 커서가 남았다.
    document.getElementById('edTitle').addEventListener('keydown',function(e){
        if(e.key==='Enter'){ e.preventDefault(); this.blur(); }
    });
    document.getElementById('setModal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeSettings();});
    document.getElementById('delModal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeDelModal();});
    document.getElementById('createModal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeCreateModal();});
    document.getElementById('exportModal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeExportModal();});
    document.getElementById('pwModal').addEventListener('click',e=>{if(e.target===e.currentTarget)closePwModal(null);});
    window.addEventListener('beforeunload',()=>{ if(pendingNB) flushSync(); });

/* APP-PART:14a-ctx-menu.js:END */
