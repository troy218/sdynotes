/* === src/app/02g-home-ai.js
   홈 검색창의 해돌이 — 노트 검색과 **같은 칸**에서 묻고 답한다 (14.65)
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:02g-home-ai.js:BEGIN */
    // ============ 14.65 · 홈 검색창 해돌이 ============
    //  사용자 요청: "홈 화면 검색 기능에 기본적인 AI 기능 탑재 — 노트해돌이처럼,
    //  설정 관련 내용을 더 자세히."
    //   · 노트 안 해돌이(ai-assistant.js)는 노트가 열려 있을 때만 말풍선을 띄운다.
    //     홈에는 노트가 없으므로 같은 AI 를 부르되 답은 홈에 앉는 카드(#homeAiCard)로
    //     보여 준다 — 검색창을 새로 만들지 않고 '검색'과 '묻기'를 한 칸에 겹쳤다.
    //   · 설정·사용법 질문은 서버 task 'help'(앱 도움말)가 맡는다. 앱 상태(스냅샷)
    //     와 설정 안내(window.sdySettingsGuideText)를 근거로만 답하므로 없는 기능을
    //     지어내지 않는다. "설정 열어줘"처럼 실행이 필요하면 서버가 @ 명령을 함께
    //     주고, 여기서 노트 해돌이와 **같은 실행기**(sdyAiAppParse/Apply)로 돌린다.
    //   · 검색 결과가 있으면 노트가 먼저다. 물음표 말투이거나 결과가 하나도 없을 때만
    //     Enter 가 해돌이에게 간다(그 외 Enter 는 첫 번째 노트를 연다).
    const HOME_AI_ASKQ=/[?？]\s*$|(어떻게|어떡|뭐야|뭐지|뭔가요|무엇|무슨|왜|언제|어디|얼마|있나요|있어요|되나요|돼요|인가요|일까요|알려\s*줘|가르쳐|설명해|방법|사용법|단축키|설정|기능|도와줘|추천)/;
    const HOME_AI_CMD=/열어|켜줘|켜\s*줘|틀어|재생|꺼줘|꺼\s*줘|보여줘|보여\s*줘|만들어|추가해|삭제해|바꿔|바꾸|정리해|내보내|번역해|시작해|멈춰|해줘|해\s*줘/;
    let _homeAiCtl=null, _homeAiLast='', _homeAiBusy=false;
    let _homeAiTurns=[], _homeAiTask='help';

    function homeAiEl(id){ try{ return document.getElementById(id); }catch(e){ return null; } }
    function homeAiQuery(){
        const el=homeAiEl('searchInput');
        return String(el&&el.value!=null?el.value:'').trim();
    }
    function homeAiToken(){
        try{ return (window.__sdyAuthState&&window.__sdyAuthState.token)||''; }catch(e){ return ''; }
    }
    // 홈에 보이는 노트/폴더 카드 수 — 검색 결과가 있는지 판단용
    function homeAiHits(){
        try{ return document.querySelectorAll('#noteGrid .note-card,#noteGrid .folder-card').length; }catch(e){ return 0; }
    }
    function homeAiLooksLikeQuestion(q){
        const t=String(q||'');
        if(t.length<2) return false;
        if(HOME_AI_ASKQ.test(t)) return true;
        if(HOME_AI_CMD.test(t)) return true;
        if(/^\s*[/!]/.test(t)) return true;                 // /앱 · !편집 같은 접두사
        if(typeof window.sdyAiLooksLikeApp==='function'){
            try{ if(window.sdyAiLooksLikeApp(t)) return true; }catch(e){}
        }
        return false;
    }
    // 해돌이에게 물어볼 상황인가 — 물음표 말투거나, 검색 결과가 없거나, 접두사가 있을 때
    function homeAiWanted(q){
        const t=String(q||'').trim();
        if(t.length<2) return false;
        if(homeAiLooksLikeQuestion(t)) return true;
        if(/^\s*\/앱|^\s*앱:/.test(t)) return true;
        return homeAiHits()===0;
    }
    function homeAiPaintBar(){
        const bar=homeAiEl('homeAiBar'), sub=homeAiEl('homeAiSub');
        if(!bar) return;
        const q=homeAiQuery();
        const want=homeAiWanted(q);
        bar.hidden=!want;
        if(!want||!sub) return;
        const hits=homeAiHits();
        sub.textContent=hits
            ? ('노트 '+hits+'개 찾음 · Enter 는 해돌이에게 물어봐요')
            : '검색 결과 없음 · Enter 로 해돌이에게 물어보기';
    }
    function homeAiKind(kind){
        const el=homeAiEl('homeAiKind');
        if(!el) return;
        el.hidden=!kind;
        el.textContent=kind||'';
    }
    function homeAiMeta(t){
        const el=homeAiEl('homeAiMeta');
        if(!el) return;
        el.hidden=!t;
        el.textContent=t||'';
    }
    function homeAiBusy(on){
        _homeAiBusy=!!on;
        const st=homeAiEl('homeAiStop'), cp=homeAiEl('homeAiCopy');
        if(st) st.hidden=!on;
        if(cp) cp.hidden=on||!_homeAiLast;
    }
    function homeAiSayHtml(t){
        try{ if(typeof mdToHtml==='function') return mdToHtml(String(t||'')); }catch(e){}
        const d=document.createElement('div');
        d.textContent=String(t==null?'':t);
        return '<span style="white-space:pre-wrap">'+d.innerHTML+'</span>';
    }
    function homeAiOut(t,busy){
        const o=homeAiEl('homeAiOut');
        if(!o) return;
        if(busy){ o.classList.add('busy'); o.innerHTML='<span class="home-ai-dots"><i></i><i></i><i></i></span>'; return; }
        o.classList.remove('busy');
        o.innerHTML=busy?'':homeAiSayHtml(t);
    }
    function homeAiShowActs(list){
        const box=homeAiEl('homeAiActs');
        if(!box) return;
        box.innerHTML='';
        (list||[]).forEach(function(a){
            const b=document.createElement('button');
            b.type='button'; b.className='home-ai-act';
            b.innerHTML=a.icon?('<i class="'+a.icon+'" aria-hidden="true"></i>'):'';
            b.appendChild(document.createTextNode(a.label));
            b.onclick=a.onClick;
            box.appendChild(b);
        });
        box.hidden=!(list&&list.length);
    }
    function homeAiOpenCard(){ const c=homeAiEl('homeAiCard'); if(c) c.hidden=false; }
    function sdyHomeAiClose(){
        try{ if(_homeAiCtl) _homeAiCtl.abort(); }catch(e){}
        _homeAiCtl=null; homeAiBusy(false);
        const c=homeAiEl('homeAiCard'); if(c) c.hidden=true;
    }
    function sdyHomeAiStop(){
        try{ if(_homeAiCtl) _homeAiCtl.abort(); }catch(e){}
        _homeAiCtl=null; homeAiBusy(false);
        homeAiMeta('멈췄어요');
    }
    function sdyHomeAiCopy(){
        if(!_homeAiLast) return;
        try{
            navigator.clipboard.writeText(_homeAiLast);
            if(typeof toast==='function') toast('답을 복사했어요',1200);
        }catch(e){}
    }
    // 검색창 입력 → 필터(기존 searchNotes) + 해돌이 줄 갱신
    function sdyHomeAiInput(){ try{ homeAiPaintBar(); }catch(e){} }
    // 검색창 Enter — 해돌이에게 갈지, 첫 노트를 열지
    function sdyHomeAiKey(ev){
        if(!ev) return true;
        try{ if(ev.isComposing||ev.keyCode===229) return true; }catch(e){}
        if(ev.key!=='Enter'||ev.shiftKey||ev.altKey||ev.ctrlKey||ev.metaKey) return true;
        const q=homeAiQuery();
        if(!q) return true;
        const bar=homeAiEl('homeAiBar');
        if(bar&&!bar.hidden){
            ev.preventDefault();
            sdyHomeAiAsk();
            return false;
        }
        // 물음표 말투가 아니고 결과가 있으면 → 첫 번째 카드를 연다(검색창의 자연스러운 기대)
        let first=null;
        try{ first=document.querySelector('#noteGrid .note-card,#noteGrid .folder-card'); }catch(e){}
        if(first){
            ev.preventDefault();
            try{ first.click(); }catch(e){}
            return false;
        }
        return true;
    }
    /* 해돌이에게 묻는다 — /앱 접두사나 '시켜 달라'는 말투면 앱 실행(app),
       나머지는 도움말(help). 두 task 모두 앱 상태(+설정 안내)를 근거로 받는다. */
    function sdyHomeAiAsk(){
        const q0=homeAiQuery();
        if(!q0){ const el=homeAiEl('searchInput'); if(el) try{ el.focus(); }catch(e){} return; }
        if(_homeAiBusy){ homeAiMeta('아직 답하는 중이에요 · 멈추기를 누르면 멈춰요'); return; }
        let text=q0, forced=false;
        const m=/^\s*(\/앱|앱:)\s*/.exec(text);
        if(m){ forced=true; text=text.slice(m[0].length).trim(); }
        if(!text) text=q0;
        let task='help';
        if(forced) task='app';
        else{
            try{ if(typeof window.sdyAiLooksLikeApp==='function'&&window.sdyAiLooksLikeApp(text)) task='app'; }catch(e){}
        }
        _homeAiTask=task;
        let snap='';
        try{ if(typeof window.sdyAiAppSnapshot==='function') snap=String(window.sdyAiAppSnapshot()||''); }catch(e){}
        let guide='';
        try{ if(typeof window.sdySettingsGuideText==='function') guide=String(window.sdySettingsGuideText()||''); }catch(e){}
        const ctx=[snap,guide].filter(Boolean).join('\n\n');

        homeAiOpenCard();
        homeAiKind(task==='app'?'앱 실행':'앱 도움말');
        _homeAiLast='';
        homeAiOut('',true);
        homeAiMeta('');
        homeAiShowActs([]);
        homeAiBusy(true);
        _homeAiCtl=new AbortController();
        const myCtl=_homeAiCtl;

        fetch('/api/ai/ask',{
            method:'POST',
            headers:{'Content-Type':'application/json','x-sdy-auth':homeAiToken()},
            body:JSON.stringify({task:task,text:ctx,question:text,
                                 context:_homeAiTurns.slice(-4).join('\n\n'),stream:false}),
            signal:myCtl.signal
        }).then(function(r){ return r.json().catch(function(){ return {}; }); })
        .then(function(d){
            if(myCtl!==_homeAiCtl) return;                  // 그 사이 닫거나 다시 물었으면 무시
            _homeAiCtl=null; homeAiBusy(false);
            if(!d||!d.ok){
                homeAiSayHtml('');
                homeAiOut(String((d&&d.error)||'답을 받지 못했어요 · 잠시 뒤에 다시 물어봐 주세요'),false);
                return;
            }
            const raw=String(d.text||'');
            // 서버가 실행 명령(@…)을 함께 줬으면 노트 해돌이와 같은 실행기로 돌린다
            const hasOps=/^\s*@/m.test(raw);
            if(hasOps&&typeof window.sdyAiAppParse==='function'&&typeof window.sdyAiAppApply==='function'){
                const parsed=window.sdyAiAppParse(raw);
                const say=String(parsed.say||'').trim();
                homeAiOut(say||'실행할게요…',false);
                Promise.resolve(window.sdyAiAppApply(parsed.ops)).then(function(res){
                    res=res||{applied:0,failed:0,notes:[]};
                    const counts=[];
                    if(res.applied) counts.push('실행 '+res.applied+'개');
                    if(res.failed) counts.push('건너뜀 '+res.failed+'개');
                    const out=[say||'요청대로 했어요 해돌~'];
                    if(counts.length) out.push(counts.join(' · '));
                    if(res.notes&&res.notes.length) out.push('· '+res.notes.join('\n· '));
                    _homeAiLast=out.join('\n\n');
                    homeAiOut(_homeAiLast,false);
                    homeAiBusy(false);
                    homeAiMeta('명령 '+(parsed.ops.length||0)+'개 처리');
                    if(/설정/.test(text)) homeAiShowActs(homeAiActsFor(text));
                }).catch(function(){
                    homeAiMeta('실행 중 문제가 생겼어요');
                });
            }else{
                _homeAiLast=raw;
                homeAiOut(raw,false);
                homeAiMeta(d.cached?'미리 준비해 둔 답':'');
            }
            if(_homeAiTask==='help'&&/설정/.test(text)) homeAiShowActs(homeAiActsFor(text));
            _homeAiTurns.push('Q: '+text+'\nA: '+String(_homeAiLast||raw).slice(0,600));
            _homeAiTurns=_homeAiTurns.slice(-6);
        })
        .catch(function(err){
            if(myCtl!==_homeAiCtl) return;
            _homeAiCtl=null; homeAiBusy(false);
            if(err&&err.name==='AbortError'){ homeAiMeta('멈췄어요'); return; }
            homeAiOut('답을 받지 못했어요 · 인터넷이나 AI 키를 확인해 주세요',false);
        });
    }
    // 설정 관련 질문이면 답 카드 아래에 '설정 열기'를 붙인다 — 답을 읽고 바로 눌러 확인
    function homeAiActsFor(q){
        const acts=[];
        acts.push({label:'설정 열기',icon:'ri-settings-3-line',onClick:function(){
            try{
                if(/테마|강조|배경|종이|휴지통|버그|단축키|복원/.test(String(q||''))&&typeof window.sdySettingsJump==='function'){
                    if(window.sdySettingsJump(q)!==false) return;
                }
                if(typeof openSettings==='function') openSettings();
            }catch(e){}
        }});
        return acts;
    }
    try{
        window.sdyHomeAiAsk=sdyHomeAiAsk;
        window.sdyHomeAiClose=sdyHomeAiClose;
        window.sdyHomeAiStop=sdyHomeAiStop;
        window.sdyHomeAiCopy=sdyHomeAiCopy;
        window.sdyHomeAiInput=sdyHomeAiInput;
        window.sdyHomeAiKey=sdyHomeAiKey;
    }catch(e){}
    // 검색창에 포커스가 오거나 홈 그리드가 다시 그려질 때 줄 상태를 맞춘다
    //   (검색어는 화면을 오가도 남아 있을 수 있다 — renderGrid 가 sdyHomeAiInput 을 부른다)
    (function(){
        var el=homeAiEl('searchInput');
        if(el&&el.addEventListener) el.addEventListener('focus',function(){ try{ homeAiPaintBar(); }catch(e){} });
    })();
    try{ homeAiPaintBar(); }catch(e){}
/* APP-PART:02g-home-ai.js:END */
