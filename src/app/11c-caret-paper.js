/* === src/app/11c-caret-paper.js ===
   캐럿 서식 · 종이/크기
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:11c-caret-paper.js:BEGIN */
    // ── 편집 중 '캐럿' 서식 ─────────────────────────────────────────
    // 글자 선택 없이 상자 안에서 입력 중일 때 색/글꼴/크기/볼드 등을 바꾸면
    // '상자 전체'가 아니라 '앞으로 입력될 글자'에만 적용한다.
    // 캐럿 자리에 빈 span 을 넣고 커서를 그 안에 두면 이후 입력이 span 안으로 들어간다.
    function _typingHost(){
        try{
            const s=window.getSelection();
            if(s&&s.rangeCount&&s.isCollapsed){
                const r=s.getRangeAt(0);
                const el=r.startContainer.nodeType===3?r.startContainer.parentElement:r.startContainer;
                const c=el&&el.closest&&el.closest('.tb-content');
                if(c&&c.closest('.tb').classList.contains('edit')) return {c,r};
            }
        }catch(e){}
        if(savedCaret&&savedCaret.c&&document.body.contains(savedCaret.c)){
            const w=savedCaret.c.closest('.tb');
            if(w&&w.classList.contains('edit')) return savedCaret;
        }
        return null;
    }
    // 캐럿 위치가 '이미 그 스타일' 안인가 (토글 판정용)
    function _caretHasStyle(prop,value){
        try{
            const t=_typingHost(); if(!t) return false;
            const tn=t.r.startContainer;
            let p=tn.nodeType===3?tn.parentElement:tn;
            while(p&&p!==t.c){
                const v=p.style&&p.style[prop];
                if(v&&(String(v).toLowerCase()===String(value).toLowerCase()
                    ||(prop==='fontWeight'&&(v==='bold'||Number(v)>=600)))) return true;
                p=p.parentElement;
            }
            // 상자 전체 서식(box-level)이 켜져 있으면 캐럿에서도 '켜진 상태'로 본다.
            if(t.c&&t.c.style){
                const v=t.c.style[prop];
                if(v&&(String(v).toLowerCase()===String(value).toLowerCase()
                    ||(prop==='fontWeight'&&(v==='bold'||Number(v)>=600)))) return true;
            }
        }catch(e){}
        return false;
    }
    function _typingStylesFromNode(node,host){
        const out={};
        let p=node&&(node.nodeType===3?node.parentElement:node);
        while(p&&p!==host){
            if(p.nodeType===1){
                const tag=_tagStyle(p.tagName);
                if(tag) for(const k in tag){ if(!(k in out)) out[k]=tag[k]; }
                for(const k of INLINE_STYLE_PROPS){
                    const v=p.style&&p.style[k];
                    if(v&&!(k in out)) out[k]=v;
                }
            }
            p=p.parentElement;
        }
        return out;
    }
    function _typingStylesAt(span,host){
        return _typingStylesFromNode(span,host);
    }
    function _rememberTypingStyles(span,host){
        if(!span||!host){ _pendingTyping=null; return; }
        const styles=_typingStylesAt(span,host);
        _pendingTyping=Object.keys(styles).length?{host,styles}:null;
    }
    function _restoreTypingRange(host,range){
        if(!host||!range) return false;
        try{ host.contentEditable='true'; }catch(e){}
        try{ if(document.activeElement!==host&&host.focus) host.focus({preventScroll:true}); }catch(e){}
        try{
            const s=window.getSelection();
            if(!s) return false;
            s.removeAllRanges();
            s.addRange(range);
            savedCaret={c:host,r:range.cloneRange()};
            return true;
        }catch(e){ return false; }
    }
    // ── 캐럿 서식 span 의 '닻(anchor)' ────────────────────────────────
    // 빈 span 에 커서(요소,0)를 두면 Chrome·Safari 가 입력 위치를 부모(상자)로
    // 정규화해 버린다. 그래서 글꼴·색을 바꾼 뒤 치는 글자가 span 밖(기본 서식)으로
    // 들어갔다. span 안에 눈에 안 보이는 ZWSP 1글자를 넣고 그 뒤(텍스트,1)에
    // 커서를 두면 입력이 반드시 span 안으로 들어간다. 닻은 실제 글자가 들어오면
    // input 에서 바로 지우고, 저장할 때는 문자열 단계에서 걷어내 문서에 남기지 않는다.
    // (조합 중에는 텍스트 노드를 건드리지 않는다 — IME 조합이 끊기기 때문.)
    const _TYPE_MARK='\u200B';
    function _typeMarkText(){ return document.createTextNode(_TYPE_MARK); }
    // '아직 입력 전'인 타이핑 span 인가 (완전 빈칸 또는 닻 1글자만)
    function _isTypeMarkOnly(span){
        if(!span) return false;
        try{
            if(span.childElementCount) return false;
            const t=String(span.textContent||'');
            return t===''||t===_TYPE_MARK;
        }catch(e){ return false; }
    }
    // 타이핑 span 안의 '모호하지 않은' 캐럿 위치를 돌려준다.
    // 아직 입력 전이면 닻 뒤, 글자가 들어갔으면 그 맨 끝(둘 다 텍스트 노드 안).
    function _typingCaretRange(span){
        if(!_isTypeMarkOnly(span)){
            const nr=document.createRange();
            try{
                const tw=document.createTreeWalker(span,NodeFilter.SHOW_TEXT);
                let last=null,n;
                while(n=tw.nextNode()) last=n;
                if(last) nr.setStart(last,String(last.nodeValue||'').length);
                else nr.setStart(span,span.childNodes.length);
            }catch(e){ try{ nr.selectNodeContents(span); }catch(_e){} }
            nr.collapse(false);
            return nr;
        }
        let tn=span.firstChild;
        if(!tn||tn.nodeType!==3){
            tn=_typeMarkText();
            span.insertBefore(tn,span.firstChild);
        }else if(String(tn.nodeValue||'').charAt(0)!==_TYPE_MARK){
            tn.nodeValue=_TYPE_MARK+String(tn.nodeValue||'');
        }
        const nr=document.createRange();
        nr.setStart(tn,1); nr.collapse(true);
        return nr;
    }
    // span 안의 닻을 지운다. 캐럿이 같은 텍스트 노드 안에 있으면 지운 글자 수만큼 당긴다.
    function _stripTypeMarks(span){
        if(!span) return;
        let tw=null;
        try{ tw=document.createTreeWalker(span,NodeFilter.SHOW_TEXT); }catch(e){ return; }
        const nodes=[]; let n;
        while(n=tw.nextNode()) nodes.push(n);
        if(!nodes.length) return;
        const s=window.getSelection();
        let caret=null;
        try{ caret=(s&&s.rangeCount)?s.getRangeAt(0):null; }catch(e){}
        nodes.forEach(tn=>{
            const v=String(tn.nodeValue||'');
            if(v.indexOf(_TYPE_MARK)<0) return;
            let cutS=0,cutE=0;
            try{
                if(caret&&caret.startContainer===tn)
                    cutS=String(v.slice(0,caret.startOffset)).split(_TYPE_MARK).length-1;
                if(caret&&!caret.collapsed&&caret.endContainer===tn)
                    cutE=String(v.slice(0,caret.endOffset)).split(_TYPE_MARK).length-1;
            }catch(e){}
            tn.nodeValue=v.split(_TYPE_MARK).join('');
            if(!caret) return;
            try{
                if(caret.startContainer===tn||(!caret.collapsed&&caret.endContainer===tn)){
                    const r=caret.cloneRange();
                    if(r.startContainer===tn) r.setStart(tn,Math.max(0,caret.startOffset-cutS));
                    if(!caret.collapsed&&r.endContainer===tn) r.setEnd(tn,Math.max(0,caret.endOffset-cutE));
                    s.removeAllRanges(); s.addRange(r);
                    caret=r;
                }
            }catch(e){}
        });
    }
    // 실제 글자가 들어온 타이핑 span 에서 닻을 치운다.
    // 아직 입력 전(닻만)인 span 은 둔다 — 다음 글자의 자리 표시다.
    function _cleanTypingMarks(host){
        if(!host||!host.querySelector) return;
        if(!_typingSpan&&!_pendingTyping) return;
        try{
            host.querySelectorAll('.sdy-type').forEach(sp=>{
                if(_isTypeMarkOnly(sp)) return;
                _stripTypeMarks(sp);
            });
        }catch(e){}
    }
    // 저장 문자열에서 타이핑 닻을 걷어낸다. 빈(닻뿐인) span 은 통째로 뺀다.
    // 라이브 DOM 은 건드리지 않는다 — 편집 중 캐럿이 그 안에 있을 수 있다.
    function _stripTypingMarkersHtml(html){
        if(!html||html.indexOf('sdy-type')<0) return html;
        const d=document.createElement('div');
        d.innerHTML=html;
        let touched=false;
        try{
            d.querySelectorAll('.sdy-type').forEach(sp=>{
                const tw=document.createTreeWalker(sp,NodeFilter.SHOW_TEXT);
                const nodes=[]; let n;
                while(n=tw.nextNode()) nodes.push(n);
                nodes.forEach(tn=>{
                    const v=String(tn.nodeValue||'');
                    if(v.indexOf(_TYPE_MARK)>=0){ tn.nodeValue=v.split(_TYPE_MARK).join(''); touched=true; }
                });
                if(!sp.textContent&&!sp.querySelector('img,br,svg,canvas')){ sp.remove(); touched=true; }
            });
        }catch(e){}
        return touched?d.innerHTML:html;
    }
    // 브라우저가 빈 span을 없애거나 입력 후 캐럿을 형제 위치로 옮겨도, 별도로 기억한
    // active state를 사용해 입력 직전 같은 스타일 wrapper를 다시 만든다.
    function _ensurePendingTypingSpan(host){
        const p=_pendingTyping;
        if(!p||p.host!==host||!host||!host.isConnected) return false;
        const w=host.closest&&host.closest('.tb');
        if(!w||!w.classList.contains('edit')) return false;
        const s=window.getSelection();
        if(!s||!s.rangeCount||!s.isCollapsed) return false;
        const live=s.getRangeAt(0);
        const point=live.startContainer;
        const inHost=point===host||host.contains(point);
        if(!inHost) return false;
        if(_typingSpan&&_typingSpan.isConnected&&host.contains(_typingSpan)&&
           (point===_typingSpan||_typingSpan.contains(point))){
            // 텍스트 안(모호하지 않은 위치)이면 그대로 둔다. span 요소 자체를
            // 가리키는 (요소,오프셋) 캐럿은 브라우저가 부모로 정규화해 다음 글자를
            // 밖으로 빼 버리므로 span 안 '닻 뒤(아직 입력 전) / 맨 끝'으로 확정한다.
            if(point.nodeType!==3){
                try{ _restoreTypingRange(host,_typingCaretRange(_typingSpan)); }
                catch(e){ savedCaret={c:host,r:live.cloneRange()}; }
            }else savedCaret={c:host,r:live.cloneRange()};
            return true;
        }
        try{
            const span=document.createElement('span');
            span.className='sdy-type';
            for(const k in p.styles) _setInlineProp(span,k,p.styles[k]);
            const r=live.cloneRange();
            r.insertNode(span);
            _typingSpan=span;
            _restoreTypingRange(host,_typingCaretRange(span));
            return true;
        }catch(e){ return false; }
    }
    // 캐럿에 서식 span 삽입 (이미 같은 span 안이면 스타일만 갱신)
    function caretWrapStyle(styles){
        const t=_typingHost(); if(!t) return false;
        const c=t.c;
        try{
            const s=window.getSelection();
            const dot=tn=>tn&&(tn===_typingSpan||(_typingSpan&&_typingSpan.contains(tn)));
            // 닻만 있는 span 은 '아직 입력 전'이므로 재사용한다. 이미 글자가 들어간
            // span 을 뒤집으면 '앞으로 입력될 글자'뿐 아니라 '이미 입력된 글자'까지
            // 바뀌기 때문.
            const spanEmpty=_typingSpan&&_isTypeMarkOnly(_typingSpan);
            let span=null;
            if(spanEmpty&&_typingSpan.isConnected&&c.contains(_typingSpan)){
                const r0=s.rangeCount?s.getRangeAt(0):null;
                if(dot(r0&&r0.startContainer)) span=_typingSpan;
                else if(savedCaret&&savedCaret.c===c&&dot(savedCaret.r.startContainer)) span=_typingSpan;
            }
            if(!span){
                span=document.createElement('span');
                span.className='sdy-type';
                // 삽입 위치는 '상자 안 실제 캐럿'으로만 잡는다. 툴바 글자 크기칸처럼
                // 상자 밖에 포커스가 있으면 live Selection 이 상자 밖을 가리킨다 —
                // 그걸 그대로 쓰면 span 이 엉뚱한 곳에 들어가 서식이 증발한다.
                let srcBase=null;
                try{
                    if(s.rangeCount){
                        const lr=s.getRangeAt(0);
                        const sc=lr.startContainer;
                        if(sc===c||(c.contains&&c.contains(sc))) srcBase=lr;
                    }
                }catch(e){}
                const src=(srcBase||t.r).cloneRange();
                // 14.18.4 · 도중 스타일 변경: 새 빈 span 을 만들 때도 직전까지의
                // 캐럿 서식(색·크기·굵기·밑줄·형광펜·부분 글꼴)을 모두 먼저 심어 둔다.
                // 예전엔 font-family 만 옮겨 "크기만 바꾼 뒤 다시 색 변경" 같은 흐름에서
                // 앞에서 고른 24px/굵게가 빠지는 경우가 있었다.
                const seed=(_pendingTyping&&_pendingTyping.host===c&&_pendingTyping.styles)
                    ? _pendingTyping.styles
                    : _typingStylesFromNode(src.startContainer,c);
                for(const k in seed) _setInlineProp(span,k,seed[k]);
                src.insertNode(span);
                _typingSpan=span;
                // 빈 (요소,0)이 아니라 '닻 뒤(텍스트,1)'에 캐럿을 둔다 — 그래야
                // 다음 글자가 span 안으로 들어간다.
                _restoreTypingRange(c,_typingCaretRange(span));
            }else{
                // 캐럿을 서식 span 안으로 되돌린다 (툴바 입력창을 쓰다 돌아와도 이어짐)
                _restoreTypingRange(c,_typingCaretRange(span));
            }
            const _removeStyleSafe=(name)=>{
                // jsdom·일부 WebView 는 camelCase removeProperty 를 무시한다.
                // kebab-case 로 지우면 브라우저·테스트 모두에서 일관되게 동작한다.
                const kebab=String(name||'').replace(/([A-Z])/g,'-$1').toLowerCase();
                try{ span.style.removeProperty(kebab); }catch(_e){}
                try{ span.style.removeProperty(name); }catch(_e){}
            };
            for(const k in styles){
                if(styles[k]===''||styles[k]==null) _removeStyleSafe(k);
                else span.style[k]=styles[k];
            }
            // 서식을 전부 지우면 빈 span 은 남길 이유가 없다 → 풀어낸다.
            //   단, 캐럿이 '이전 서식에 물리지 않도록' 만들려면 스타일이 전부 없더라도
            //   sdy-type 빈 span 을 하나 남겨 두는 편이 안전하다. 여기서는 '진짜 빈
            //   스타일' + '아직 입력 전'일 때만 지우고, '이전 서식 차단용'으로 쓴
            //   중립값(400/normal)이 남아 있으면(즉 cssText 가 있으면) 반드시 유지한다.
            if(span.classList.contains('sdy-type')&&!span.style.cssText&&_isTypeMarkOnly(span)){
                span.remove(); _typingSpan=null; savedCaret=null; _pendingTyping=null;
                return true;
            }
            // DOM wrapper와 별도로 이후 입력 상태를 보관한다. 새 글꼴을 고르는 등
            // wrapper가 중첩돼도 조상 bold/color까지 합쳐 다음 글자에 그대로 이어진다.
            _rememberTypingStyles(span,c);
            const w=c.closest('.tb');
            if(w&&w.isConnected) syncTextEl(w);
            return true;
        }catch(e){ return false; }
    }

    function clearBoxFormatting(w){
        const c=w&&w.querySelector&&w.querySelector('.tb-content'); if(!c) return;
        const el=findEl(+w.dataset.pageIdx,w.dataset.id); if(!el) return;
        const fs=Math.max(2,Math.min(200,Math.round(parseFloat(c.style.fontSize)||el.fontSize||curFontSize||16)));
        c.innerHTML=stripFormatting(c.innerHTML);
        c.style.fontSize=fs+'px';
        c.style.fontFamily=fontCSS('pretendard');
        ['color','background-color','font-weight','font-style','text-decoration'].forEach(p=>{
            try{ c.style.removeProperty(p); }catch(e){}
        });
        el.html=c.innerHTML;
        el.fontSize=fs;
        delete el.textColor; delete el.cellBg; delete el.font;
        delete el.fontWeight; delete el.fontStyle; delete el.textDecoration;
        try{ markPageEdited(+w.dataset.pageIdx); }catch(e){}
        syncTextEl(w);
    }

    // 서식 지우기 (고도화)
    //  - 텍스트를 드래그해 선택했으면 그 부분만
    //  - 선택이 없으면 텍스트 상자 전체 (여러 개 선택 시 전부)
    function clearFmt(){
        const host=restoreSel();
        const sel=window.getSelection();
        if(host && sel && !sel.isCollapsed){
            pushHistory();
            // 18.9 · execCommand('removeFormat') 은 브라우저/웹뷰마다 동작이 제각각이고
            //   일부 환경(구형 WebView·테스트 DOM)에는 아예 없다. 인라인 엔진으로
            //   선택 구간의 서식 속성을 하나씩 확실히 걷어낸다.
            ['fontWeight','fontStyle','textDecoration','color','backgroundColor',
             'fontFamily','fontSize','verticalAlign'].forEach(p=>{
                try{ _removeFromSelection(p); }catch(e){}
            });
            // 링크 해제도 직접 처리한다. execCommand('unlink') 가 없는 WebView/jsdom 에서도
            // 선택한 링크 글자는 남기고 <a> 만 벗겨야 한다.
            try{ _unlinkSelection(); }catch(e){}   // v2 엔진: <a> 만 벗기고 글자는 남긴다
            const w=host.closest('.tb'); if(w) syncTextEl(w);
            saveSel(); syncCurSel();
            toast('선택 영역 서식 지움',1200);
            return;
        }
        if(selectedTblCellEls().length){
            tblCellApply(el=>{
                el.html=stripFormatting(el.html||''); el.fontSize=curFontSize;
                delete el.textColor; delete el.font; delete el.fontWeight;
                delete el.fontStyle; delete el.textDecoration; delete el.cellBg;
            },'선택한 칸 글자 서식 지움');
            return;
        }
        // 18.5 · 캐럿(선택 없음) → 앞으로 입력될 글자의 서식만 지운다
        if(_typingHost()){
            caretWrapStyle({fontWeight:'',fontStyle:'',textDecoration:'',color:'',
                            backgroundColor:'',fontFamily:'',fontSize:''});
            toast('앞으로 입력될 글자 서식 지움',1000);
            return;
        }
        // 상자 단위
        let targets=[];
        if(multiSel.length) targets=multiSel.map(m=>m.node).filter(n=>n.classList.contains('tb'));
        if(!targets.length){
            targets=Array.from(document.querySelectorAll('#pagesStage .tb.edit,#pagesStage .tb.sel,#pagesStage .tb.msel'));
        }
        if(!targets.length){ toast('텍스트 상자를 선택하거나 글자를 드래그하세요',1800); return; }
        pushHistory();
        targets.forEach(w=>clearBoxFormatting(w));
        saveDoc();
        toast(`${targets.length}개 상자 서식 지움`,1400);
    }

    // 줄바꿈만 남기고 모든 서식 제거
    function stripFormatting(html){
        const box=document.createElement('div');
        box.innerHTML=html||'';
        box.querySelectorAll('br').forEach(b=>b.replaceWith('\n'));
        box.querySelectorAll('div,p,li').forEach(n=>{ n.after('\n'); });
        const text=(box.textContent||'').replace(/\n{3,}/g,'\n\n').replace(/[ \t]+\n/g,'\n').replace(/\u200B/g,'').trim();
        return esc(text).replace(/\n/g,'<br>');
    }
    // 14.16 · 툴바의 글자 크기칸과 '지금 보고 있는 글자'를 맞추는 장치
    //  상자를 Alt+휠로 키우거나 다른 상자를 집었을 때 툴바 값이 낡은 채로 남아
    //  '+' 를 누르면 도로 작아지던 것을 막는다.
    function setToolbarFS(v){
        // 18.8 · 잴 대상이 없으면(0/빈 값) 툴바 값을 건드리지 않는다.
        //   예전엔 0 이 들어와도 2 로 깎여 저장되는 바람에, 아무것도 고르지 않은
        //   화면에서 '＋' 를 누르면 2 ↔ 3 만 오가는 버그가 있었다. (보고 이슈③)
        const n=Math.round(Number(v)||0);
        if(!n||n<1) return;
        v=Math.max(2,Math.min(200,n));
        const inp=document.getElementById('fsInput');
        // 같은 숫자여도 직전 상태가 mixed('-')였다면 표시를 반드시 복원한다.
        if(inp){
            inp.classList.remove('mixed'); inp.removeAttribute('aria-label');
            if(document.activeElement!==inp) inp.value=v;
        }
        if(v===curFontSize) return;
        curFontSize=v;
    }
    // 지금 글자 크기를 물어볼 대상: 표 칸 → 편집 중인 상자 → 선택한 상자
    function activeTextFS(){
        try{
            const cells=selectedTblCellEls();
            if(cells.length&&cells[0]&&cells[0].fontSize) return cells[0].fontSize;
        }catch(e){}
        let node=null;
        if(selected&&selected.type==='text'&&selected.el) node=selected.el;   // 편집 중/방금 집은 상자
        if(!node&&multiSel.length===1) node=multiSel[0].node;
        if(!node) node=document.querySelector('#pagesStage .tb.edit');
        if(!node) node=document.querySelector('#pagesStage .tb.sel');
        if(!node||!node.isConnected) return 0;
        const c=node.querySelector('.tb-content'); if(!c) return 0;
        // 화면에 실제로 그려진 크기를 우선한다 (자동 맞춤 상자도 헷갈리지 않게)
        let v=parseFloat(c.style.fontSize);
        if(!v){ try{ const el=findEl(+node.dataset.pageIdx,node.dataset.id); v=el&&el.fontSize; }catch(e){} }
        return Math.round(Number(v)||0);
    }
    // 18.8 · 같은 기준으로 '지금 대상'의 글꼴 id 도 구한다 (툴바 글꼴 동기화)
    function activeTextFont(){
        try{
            const cells=selectedTblCellEls();
            if(cells.length&&cells[0]&&cells[0].font) return cells[0].font;
        }catch(e){}
        let node=null;
        if(selected&&selected.type==='text'&&selected.el) node=selected.el;
        if(!node&&multiSel.length===1) node=multiSel[0].node;
        if(!node) node=document.querySelector('#pagesStage .tb.edit');
        if(!node) node=document.querySelector('#pagesStage .tb.sel');
        if(!node||!node.isConnected||!node.classList.contains('tb')) return '';
        try{
            const el=findEl(+node.dataset.pageIdx,node.dataset.id);
            if(el&&el.font) return el.font;
        }catch(e){}
        const c=node.querySelector('.tb-content');
        return c?_fontIdFromCSS(c.style.fontFamily||''):'';
    }
    function syncFSFromTarget(){
        setToolbarFS(activeTextFS());
        const fid=activeTextFont();
        if(fid) setToolbarFont(fid);
    }
    // 상자 안의 '일부 글자'를 드래그해 골라 둔 상태면 그쪽 크기를 기준으로 삼는다
    function hasInlineTextSel(){
        try{
            const s=window.getSelection();
            if(s&&s.rangeCount&&!s.isCollapsed){
                const r=s.getRangeAt(0);
                const n=r.commonAncestorContainer;
                const host=n.nodeType===1?n:n.parentElement;
                if(host&&host.closest&&host.closest('.tb-content')) return true;
            }
            if(savedRange&&!savedRange.collapsed&&savedHost&&document.body.contains(savedHost)) return true;
        }catch(e){}
        return false;
    }
    function chFS(d){
        if(!hasInlineTextSel()) syncFSFromTarget();   // 지금 보이는 크기에서 증감
        setFS(curFontSize + (curFontSize<=10 ? (d>0?1:-1) : d));
    }
    function setFS(v){
        curFontSize=Math.max(2,Math.min(200,Math.round(v)));
        const fsInput=document.getElementById('fsInput');
        fsInput.value=curFontSize; fsInput.classList.remove('mixed'); fsInput.removeAttribute('aria-label');
        if(selectedTblCellEls().length){
            tblCellApply(el=>{ el.fontSize=curFontSize; },`선택한 칸 글자 ${curFontSize}px`);
            return;
        }
        const host=restoreSel();
        if(host){
            pushHistory();
            try{
                withSelection(()=>wrapSelStyle('fontSize',curFontSize+'px'));
            }catch(e){}
            return;
        }
        // 18.5 · 편집 중 캐럿(선택 없음) → 상자 전체가 아니라 앞으로 입력될 글자에만
        if(_typingHost()){ caretWrapStyle({fontSize:curFontSize+'px'}); return; }
        const targets=multiSel.length
            ? multiSel.map(m=>m.node).filter(n=>n&&n.classList&&n.classList.contains('tb'))
            : [];
        const single=document.querySelector('.tb.sel,.tb.edit');
        if(!targets.length&&single) targets.push(single);
        if(targets.length){
            pushHistory();
            targets.forEach(sel=>{
                const c=sel.querySelector('.tb-content');
                const el=findEl(+sel.dataset.pageIdx,sel.dataset.id);
                if(c){
                    c.style.fontSize=curFontSize+'px';
                    // 18.8 · 상자 전체 크기는 안쪽 부분 크기보다 세다 —
                    //   서식 span 에 박제된 옛 크기를 걷어내야 실제로 커/작아진다.
                    // v2 엔진: 인라인으로 박제된 부분 크기만 새 값으로 갱신하고,
                    //   나머지는 상자 값 상속을 유지한다.
                    try{ _fmtApplyBox(c,'fontSize',curFontSize+'px',true); }catch(_e){}
                }
                if(el) el.fontSize=curFontSize;
                syncTextEl(sel);
            });
            saveDoc();
        }
    }

    // ============ 종이 / 크기 ============
    function setPaper(type){
        if(!doc) return;
        doc.paper=type;
        document.querySelectorAll('.ptool').forEach(b=>b.classList.toggle('active',b.dataset.p===type));
        editorPapers().forEach(p=>{
            p.classList.remove('paper-blank','paper-lined','paper-grid','paper-dotted');
            p.classList.add('paper-'+type);
        });
        saveDoc();
    }
    function changeSizePreset(key){
        if(!doc) return;
        doc.sizePreset=key;
        renderPages(); saveDoc();
    }


/* APP-PART:11c-caret-paper.js:END */
