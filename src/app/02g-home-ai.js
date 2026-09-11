/* === src/app/02g-home-ai.js
   홈 검색창의 해돌이 — 노트 검색과 **같은 칸**에서 묻고 답한다 (14.65)
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:02g-home-ai.js:BEGIN */
    // ============ 홈 검색창 해돌이 (14.65 → 일반테마 다듬기) ============
    //  사용자 요청: 홈 화면 검색 기능에 기본적인 AI 를 탑재하되,
    //   · 검색창 Enter 는 **항상** 해돌이에게 묻는다 — 물어보기 전용 떠 있는
    //     버튼/줄(#homeAiBar)은 없앴다. 검색과 묻기는 같은 칸에서 겹친다.
    //   · 답은 검색 결과 **위**(#homeAiCard)에 산문으로 앉는다(노트 말풍선 아님).
    //   · 설정·사용법 질문은 서버 task 'help'(앱 도움말)가 맡는다. 앱 상태
    //     (스냅샷)와 설정 안내(window.sdySettingsGuideText)를 근거로만 답하므로
    //     없는 기능을 지어내지 않는다. "설정 열어줘"처럼 실행이 필요하면 서버가
    //     @ 명령을 함께 주고, 여기서 노트 해돌이와 **같은 실행기**
    //     (sdyAiAppParse/Apply)로 돌린다.
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
    // ai-assistant.js가 먼저 준비한 공통 보정기를 쓰고, 단독 로드 때도 같은
    // 말끝을 지킨다. 이름 자체(해돌이)는 바꾸지 않고 말끝 표기만 고친다.
    function homeAiVoice(t){
        try{ if(typeof window.sdyHaedolVoice==='function') return window.sdyHaedolVoice(t); }catch(e){}
        return String(t==null?'':t).replace(/해돌이~([!?]?)/g,'해돌~$1').replace(/해돌이([!?])/g,'해돌~$1');
    }
    function homeAiSayHtml(t){
        t=String(t==null?'':t);
        try{ if(typeof mdToHtml==='function') return mdToHtml(t); }catch(e){}
        const d=document.createElement('div');
        d.textContent=t;
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
    // 검색창 입력 → 필터(기존 searchNotes)와 함께 불린다.
    // 전용 물어보기 줄/버튼이 사라지며 갱신할 게 없어져 빈 훅으로 남긴다
    // (renderGrid 등이 여전히 부를 수 있게 호환용으로 노출).
    function sdyHomeAiInput(){ }
    // 검색창 Enter — 항상 해돌이에게 묻는다(전용 버튼·줄 없이).
    function sdyHomeAiKey(ev){
        if(!ev) return true;
        try{ if(ev.isComposing||ev.keyCode===229) return true; }catch(e){}
        if(ev.key!=='Enter'||ev.shiftKey||ev.altKey||ev.ctrlKey||ev.metaKey) return true;
        if(!homeAiQuery()) return true;
        ev.preventDefault();
        sdyHomeAiAsk();
        return false;
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
            let raw=String(d.text||'');
            // help은 해돌이가 직접 말하는 답, app은 @명령 원문이다. 명령 안의
            // 노트 제목·사용자 텍스트가 바뀌지 않도록 전자에만 보정을 적용한다.
            if(_homeAiTask==='help') raw=homeAiVoice(raw);
            // 서버가 실행 명령(@…)을 함께 줬으면 노트 해돌이와 같은 실행기로 돌린다
            const hasOps=/^\s*@/m.test(raw);
            if(hasOps&&typeof window.sdyAiAppParse==='function'&&typeof window.sdyAiAppApply==='function'){
                const parsed=window.sdyAiAppParse(raw);
                const say=homeAiVoice(String(parsed.say||'').trim());
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
/* APP-PART:02g-home-ai.js:END */
