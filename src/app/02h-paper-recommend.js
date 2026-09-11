/* === src/app/02h-paper-recommend.js ===
   설정 키워드 → arXiv 오늘의 추천 논문 띠
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:02h-paper-recommend.js:BEGIN */
    // ============ 오늘의 추천 논문 (arXiv) ============
    // 키워드는 기존 앱 설정 S 안에 작은 배열로 보관한다. appset 동기화 대상에도
    // paperKeywords 를 넣어 두었으므로, 기기를 바꿔도 같은 추천을 받는다.
    const PAPER_KEYWORD_LIMIT=8;
    const PAPER_KEYWORD_MAX=64;
    const PAPER_BROWSER_CACHE_MS=5*60*1000;
    let paperTickerCache={key:'',items:[],at:0};
    let paperTickerRequest=null, paperTickerSeq=0;

    function paperNormalizeKeyword(raw){
        const word=String(raw==null?'':raw).replace(/\s+/g,' ').trim();
        if(!word||word.length>PAPER_KEYWORD_MAX) return '';
        // 서버와 같은 보수적 문자 규칙: arXiv 검색 연산자/따옴표를 끼워 넣을 수 없다.
        try{ if(!/^[\p{L}\p{N}\s.+#/_-]+$/u.test(word)) return ''; }catch(e){
            if(!/^[\w\s.+#/_-]+$/.test(word)) return '';
        }
        return word;
    }
    function paperKeywords(){
        const seen=new Set(), out=[];
        const raw=Array.isArray(S.paperKeywords)?S.paperKeywords:[];
        raw.forEach(value=>{
            String(value==null?'':value).split(/[\n,]/).forEach(part=>{
                const word=paperNormalizeKeyword(part), key=word.toLocaleLowerCase('en-US');
                if(!word||seen.has(key)||out.length>=PAPER_KEYWORD_LIMIT) return;
                seen.add(key); out.push(word);
            });
        });
        return out;
    }
    function paperKeywordKey(words){
        return (words||[]).map(word=>String(word).toLocaleLowerCase('en-US')).sort().join('\u0001');
    }
    function paperSaveKeywords(words){
        const cleaned=(words||[]).map(paperNormalizeKeyword).filter(Boolean).slice(0,PAPER_KEYWORD_LIMIT);
        // 빈 배열도 저장한다. 다른 기기에도 '추천 끄기'가 전달되어야 한다.
        S.paperKeywords=cleaned;
        saveS();
        try{ if(typeof pushSettings==='function') pushSettings(); }catch(e){}
        paperKeywordsRender();
        paperTickerCache={key:'',items:[],at:0};
        paperTickerRefresh(true);
    }
    function paperKeywordsRender(){
        const wrap=document.getElementById('paperKeywordChips');
        if(!wrap) return;
        const words=paperKeywords();
        // 오래된 저장값을 읽어도 화면에는 정규화된 목록만 보이게 한다.
        if(JSON.stringify(S.paperKeywords||[])!==JSON.stringify(words)){
            S.paperKeywords=words;
            try{ saveS(); }catch(e){}
        }
        wrap.replaceChildren();
        if(!words.length){
            const hint=document.createElement('span');
            hint.className='paper-keyword-empty';
            hint.textContent='키워드를 등록하면 홈에 최신 논문 10편을 보여줘요.';
            wrap.appendChild(hint);
            return;
        }
        words.forEach(word=>{
            const chip=document.createElement('span');
            chip.className='paper-keyword-chip';
            const text=document.createElement('span'); text.textContent=word;
            const remove=document.createElement('button');
            remove.type='button';
            remove.className='paper-keyword-remove';
            remove.title=`${word} 삭제`;
            remove.setAttribute('aria-label',`${word} 키워드 삭제`);
            remove.innerHTML='<i class="ri-close-line" aria-hidden="true"></i>';
            remove.addEventListener('click',()=>paperRemoveKeyword(word));
            chip.append(text,remove);
            wrap.appendChild(chip);
        });
    }
    function paperAddKeyword(raw){
        const input=document.getElementById('paperKeywordInput');
        const word=paperNormalizeKeyword(raw==null?(input&&input.value):raw);
        if(!word){
            try{ toast('키워드는 1~64자의 글자·숫자와 +, #, -, _, /, .만 쓸 수 있어요',2600); }catch(e){}
            if(input) input.focus();
            return false;
        }
        const now=paperKeywords();
        if(now.some(value=>value.toLocaleLowerCase('en-US')===word.toLocaleLowerCase('en-US'))){
            try{ toast('이미 등록한 키워드예요',1600); }catch(e){}
            if(input){ input.value=''; input.focus(); }
            return false;
        }
        if(now.length>=PAPER_KEYWORD_LIMIT){
            try{ toast(`추천 키워드는 ${PAPER_KEYWORD_LIMIT}개까지 등록할 수 있어요`,2200); }catch(e){}
            return false;
        }
        now.push(word);
        paperSaveKeywords(now);
        if(input){ input.value=''; input.focus(); }
        try{ toast(`“${word}” 최신 논문을 찾고 있어요`,1800); }catch(e){}
        return true;
    }
    function paperRemoveKeyword(word){
        const key=String(word).toLocaleLowerCase('en-US');
        paperSaveKeywords(paperKeywords().filter(value=>value.toLocaleLowerCase('en-US')!==key));
    }
    function paperSetupSettings(){
        const form=document.getElementById('paperKeywordForm');
        if(form&&!form.dataset.paperBound){
            form.dataset.paperBound='1';
            form.addEventListener('submit',event=>{
                event.preventDefault();
                paperAddKeyword();
            });
        }
        paperKeywordsRender();
    }

    function paperOnHome(){
        const editor=document.getElementById('editorView');
        if(editor&&editor.classList.contains('open')) return false;
        try{ return !curFolder&&!searchQuery&&!selectMode; }catch(e){ return true; }
    }
    function paperSafeArxivUrl(value){
        try{
            const u=new URL(String(value||''));
            return u.protocol==='https:'&&u.hostname==='arxiv.org'&&/^\/abs\/[0-9]{4}\.[0-9]{4,5}(?:v\d+)?$/i.test(u.pathname)
                ?u.href:'';
        }catch(e){ return ''; }
    }
    function paperSetHidden(hidden){
        const ticker=document.getElementById('paperTicker');
        if(ticker) ticker.hidden=!!hidden;
    }
    // '오늘의' 대신 화면의 현재 날짜를 그대로 말한다. 예: 2026. 9. 11.
    function paperTickerDateText(){
        const now=new Date();
        return `${now.getFullYear()}. ${now.getMonth()+1}. ${now.getDate()}.`;
    }
    function paperAppendSet(run,items,hidden){
        const set=document.createElement('span');
        set.className='paper-ticker-set';
        if(hidden) set.setAttribute('aria-hidden','true');
        // 고정 제목 칸 대신 띠가 리드 멘트를 직접 실어 나른다 — 1번 항목 전에 먼저 흘러 나온다.
        const lead=document.createElement('span');
        lead.className='paper-ticker-lead';
        const leadIcon=document.createElement('i');
        leadIcon.className='ri-book-open-line';
        leadIcon.setAttribute('aria-hidden','true');
        const leadText=document.createElement('b');
        leadText.textContent=`${paperTickerDateText()} 따끈따끈한 최신 논문`;
        lead.append(leadIcon,leadText);
        set.appendChild(lead);
        items.forEach((paper,index)=>{
            const url=paperSafeArxivUrl(paper&&paper.url);
            const title=String(paper&&paper.title||'').replace(/\s+/g,' ').trim();
            if(!url||!title) return;
            const link=document.createElement('a');
            link.className='paper-ticker-paper';
            link.href=url;
            link.target='_blank';
            link.rel='noopener noreferrer';
            link.title=`${index+1}위 · ${title} · arXiv에서 열기`;
            if(hidden) link.tabIndex=-1;
            const rank=document.createElement('span');
            rank.className='paper-ticker-rank';
            rank.textContent=String(index+1).padStart(2,'0');
            const name=document.createElement('span');
            name.className='paper-ticker-title';
            name.textContent=title;
            const arrow=document.createElement('i');
            arrow.className='ri-external-link-line';
            arrow.setAttribute('aria-hidden','true');
            link.append(rank,name,arrow);
            set.appendChild(link);
        });
        run.appendChild(set);
    }
    function paperRenderTicker(items){
        const ticker=document.getElementById('paperTicker');
        const run=document.getElementById('paperTickerRun');
        if(!ticker||!run) return;
        const usable=(Array.isArray(items)?items:[]).filter(paper=>
            paperSafeArxivUrl(paper&&paper.url)&&String(paper&&paper.title||'').trim());
        if(!usable.length||!paperOnHome()){
            run.replaceChildren(); paperSetHidden(true); return;
        }
        run.replaceChildren();
        paperAppendSet(run,usable,false);
        // 같은 줄을 한 번 더 붙여 한 바퀴가 끝나는 점에서도 끊기지 않게 한다.
        paperAppendSet(run,usable,true);
        // 증시 현황판처럼 빠르게: 이전 ~42px/s 에서 ~140px/s 로 올린다. (리드 멘트 폭 몫 포함)
        const roughPixels=usable.reduce((total,paper)=>total+String(paper.title||'').length*7+108,0)+340;
        const seconds=Math.max(12,Math.min(60,Math.round(roughPixels/140)));
        run.style.setProperty('--paper-ticker-duration',seconds+'s');
        ticker.dataset.count=String(usable.length);
        paperSetHidden(false);
    }
    async function paperTickerRefresh(force){
        paperSetupSettings();
        if(!paperOnHome()) { paperSetHidden(true); return; }
        const words=paperKeywords(), key=paperKeywordKey(words);
        if(!words.length){
            try{ if(paperTickerRequest) paperTickerRequest.abort(); }catch(e){}
            paperSetHidden(true); return;
        }
        const now=Date.now();
        if(!force&&paperTickerCache.key===key&&now-paperTickerCache.at<PAPER_BROWSER_CACHE_MS){
            paperRenderTicker(paperTickerCache.items); return;
        }
        try{ if(paperTickerRequest) paperTickerRequest.abort(); }catch(e){}
        const control=typeof AbortController==='function'?new AbortController():null;
        paperTickerRequest=control;
        const seq=++paperTickerSeq;
        const query=words.map(word=>'keyword='+encodeURIComponent(word)).join('&');
        try{
            const response=await fetch('/api/papers/recommend?'+query,{signal:control&&control.signal,headers:{Accept:'application/json'}});
            const data=await response.json().catch(()=>null);
            if(seq!==paperTickerSeq||!data||!data.ok||!response.ok) throw new Error('paper recommendation unavailable');
            const currentKey=paperKeywordKey(paperKeywords());
            if(currentKey!==key) return;
            paperTickerCache={key,items:Array.isArray(data.items)?data.items:[],at:Date.now()};
            paperRenderTicker(paperTickerCache.items);
        }catch(error){
            // 추천은 보조 기능: 연결 실패를 토스트로 방해하지 않고, 이미 보던 목록이 있으면 유지한다.
            if(error&&error.name==='AbortError') return;
            if(paperTickerCache.key===key&&paperTickerCache.items.length) paperRenderTicker(paperTickerCache.items);
            else paperSetHidden(true);
        }finally{
            if(paperTickerRequest===control) paperTickerRequest=null;
        }
    }

    // 다른 모듈에서 설정창·홈을 다시 그릴 때 호출하는 가벼운 공개 브리지.
    try{
        window.sdyPaperKeywordsRender=paperKeywordsRender;
        window.sdyPaperTickerRefresh=paperTickerRefresh;
        window.sdyPaperAddKeyword=paperAddKeyword;
        window.sdyPaperRemoveKeyword=paperRemoveKeyword;
    }catch(e){}
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>{
        paperSetupSettings(); paperTickerRefresh();
    },{once:true});
    else setTimeout(()=>{ paperSetupSettings(); paperTickerRefresh(); },0);
/* APP-PART:02h-paper-recommend.js:END */
