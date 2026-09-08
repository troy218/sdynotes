/* === src/app/02f-buglog.js ===
   버그 일지 — 해돌이에게 말한 버그를 정리해 기록하고 설정에서 보는 일지
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:02f-buglog.js:BEGIN */
    // ============ 버그 일지 (14.39.0) ============
    // 노트 안의 해돌이에게 "버그 신고: …" 또는 "버그가 있어요 — …"처럼 말하면
    //   서버 AI(task=bug)가 제목·증상·재현 방법·기대 동작·메모로 정리해 주고,
    //   이 일지에 기록된다(어느 노트와도 무관한 앱 전체 문제). 기록은 02d 의
    //   설정 동기화와 같은 LWW 키('buglog:<id>')를 타고 모든 기기·모든 사람이
    //   함께 본다 — 누구나 보되, 지우기(X)는 관리자로 로그인한 경우에만 노출·동작한다.
    //   설정 → '버그 일지' 줄의 [보기]를 눌러야 목록이 열리고(스크롤), 열린
    //   목록에서 항목마다 X 로 그 기록만 지운다.
    // 로컬 배열은 기기 사본이다. 서버는 sync/settings.json(Oracle 기본)에 영구
    // 저장하며 apply.sh는 sync/를 교체하지 않는다. tmp는 원자 저장 중에만 쓴다.
    const BUGLOG_KEY='sdy_buglog';
    function getBugEntries(){
        try{
            const raw=localStorage.getItem(BUGLOG_KEY);
            const a=raw?JSON.parse(raw):[];
            return Array.isArray(a)?a.filter(x=>x&&x.id):[];
        }catch(e){ return []; }
    }
    function saveBugEntries(a){
        const arr=(Array.isArray(a)?a.filter(x=>x&&x.id):[]).slice()
            .sort((x,y)=>(y.t||0)-(x.t||0));
        // 실패를 숨기면 실제로 아무것도 저장하지 않고 '기록 완료'라고 안내하게 된다.
        localStorage.setItem(BUGLOG_KEY,JSON.stringify(arr));
        try{ document.dispatchEvent(new CustomEvent('sdy-buglog-changed')); }catch(e){}
    }
    function paintBugCount(){
        const el=document.getElementById('bugCount');
        if(!el) return;
        const n=getBugEntries().length;
        el.textContent=n?`${n}건`:'없음';
    }
    // 해돌이(ai-assistant.js)가 정리한 내용을 일지에 기록한다. id·시각은 여기서.
    async function buglogAdd(data){
        const id='bug_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
        const e={
            id,
            t:Date.now(),
            title:String((data&&data.title)||'').trim()||'버그 신고',
            text:String((data&&data.text)||'').trim(),
            raw:String((data&&data.raw)||'').trim(),
            who:String((data&&data.who)||'').trim(),
            ver:String((data&&data.ver)||'').trim()
        };
        const a=getBugEntries();
        a.unshift(e);
        saveBugEntries(a);
        try{ _stQueueOp('buglog:'+id,'put',e); }catch(err){}
        paintBugCount();
        let result=null;
        try{ result=await pushSettingsNow(); }catch(err){}
        // synced는 응답용 상태일 뿐 일지 본문/설정 payload에는 저장하지 않는다.
        const synced=!!(result&&Array.isArray(result.accepted)&&result.accepted.includes('buglog:'+id));
        return {...e,synced};
    }
    try{ window.sdyBuglogAdd=buglogAdd; }catch(e){}
    // 목록에서 X — 그 기록 하나만 지운다 (관리자로 로그인한 경우에만 노출·동작)
    async function delBugEntry(id){
        // 모두가 지울 수 없게 — 관리자 전용 동작
        if(!isAdmin()){ try{ toast('관리자로 로그인해야 지울 수 있어요',1800); }catch(e){} return; }
        id=String(id||'');
        const a=getBugEntries(), b=a.filter(x=>String(x.id)!==id);
        if(a.length===b.length) return;
        try{ saveBugEntries(b); }catch(err){
            try{ toast('삭제 요청을 저장하지 못했어요 · 브라우저 저장 공간을 확인해 주세요',2600); }catch(e){}
            return;
        }
        try{ _stQueueOp('buglog:'+id,'del',undefined,true); }catch(err){}
        paintBugCount();
        if(isBuglogOpen()) renderBugList();
        let result=null;
        try{ result=await pushSettingsNow(); }catch(err){}
        const key='buglog:'+id;
        const saved=result&&Array.isArray(result.accepted)&&result.accepted.includes(key);
        const blocked=result&&Array.isArray(result.blocked)&&result.blocked.includes(key);
        try{ toast(saved?'버그 기록을 지웠어요':(blocked
            ?'삭제가 차단됐어요 · 관리자 로그인 상태를 확인해 주세요'
            :'삭제 요청을 기기에 보관했어요 · 서버 반영 대기 중'),2200); }catch(err){}
    }
    function isBuglogOpen(){
        const el=document.getElementById('buglogModal');
        return !!(el&&el.style.display==='flex');
    }
    // 설정의 [보기] — 새 창처럼 목록이 뜨고 안에서 스크롤한다
    function openBuglog(){
        renderBugList();
        const el=document.getElementById('buglogModal');
        if(el) el.style.display='flex';
        try{ openNav(closeBuglog); }catch(e){}
    }
    function closeBuglog(){
        const el=document.getElementById('buglogModal');
        if(el) el.style.display='none';
        try{ navDrop(closeBuglog); }catch(e){}
    }
    function bugRepaintIfOpen(){ if(isBuglogOpen()) renderBugList(); }
    try{ window.bugRepaintIfOpen=bugRepaintIfOpen; }catch(e){}
    function bugFmtTime(t){
        try{
            const d=new Date(t);
            return String(d.getFullYear()%100).padStart(2,'0')+'.'
                +String(d.getMonth()+1).padStart(2,'0')+'.'
                +String(d.getDate()).padStart(2,'0')+' '
                +String(d.getHours()).padStart(2,'0')+':'
                +String(d.getMinutes()).padStart(2,'0');
        }catch(e){ return ''; }
    }
    function escBug(t){
        try{
            return String(t==null?'':t).replace(/[&<>"']/g,c=>(
                {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
            ));
        }catch(e){ return ''; }
    }
    function bugBodyHtml(t){
        // 정리본의 '항목: 내용' 줄을 띄워 읽기 좋게 · 줄바꿈 보존
        const s=String(t==null?'':t).trim();
        if(!s) return '';
        return s.split('\n').map(line=>{
            const m=/^([^:：]{1,12})[:：]\s*/.exec(line);
            if(m) return '<div class="buglog-line"><b>'+escBug(m[1])+'</b><span>'+escBug(line.slice(m[0].length))+'</span></div>';
            return '<div class="buglog-line"><span>'+escBug(line)+'</span></div>';
        }).join('');
    }
    function renderBugList(){
        const el=document.getElementById('bugList');
        if(!el) return;
        const a=getBugEntries().slice().sort((x,y)=>(y.t||0)-(x.t||0));
        if(!a.length){
            el.innerHTML='<div class="vault-empty" style="padding:34px 10px;">'
                +'<i class="ri-bug-line"></i>아직 기록된 버그가 없어요<br>'
                +'<span style="font-size:12px;color:var(--text3);margin-top:6px;display:inline-block;">'
                +'노트에서 해돌이에게 "버그 신고: …" 또는 "버그가 있어요 — …"라고 말해 보세요 해돌~</span></div>';
            paintBugCount();
            return;
        }
        el.innerHTML=a.map(x=>{
            const who=x.who?('<span class="buglog-who">'+escBug(x.who)+'</span>'):'';
            const ver=x.ver?('<span class="buglog-ver">v'+escBug(x.ver)+'</span>'):'';
            // X 버튼은 관리자로 로그인한 경우에만 — 모두가 지울 수 없게 막는다
            const xBtn=isAdmin()
                ? '<button type="button" class="buglog-x" title="이 기록 지우기" onclick="delBugEntry(\''+escBug(x.id)+'\')"><i class="ri-close-line"></i></button>'
                : '';
            return '<div class="buglog-item">'
                +'<div class="buglog-head">'
                +'<i class="ri-bug-line" aria-hidden="true"></i>'
                +'<b class="buglog-title">'+escBug(x.title||'버그 신고')+'</b>'
                +xBtn
                +'</div>'
                +'<div class="buglog-meta">'+bugFmtTime(x.t)+' '+who+' '+ver+'</div>'
                +(x.text?'<div class="buglog-body">'+bugBodyHtml(x.text)+'</div>':'')
                +(x.raw?'<div class="buglog-raw">원문 보고: '+escBug(x.raw)+'</div>':'')
                +'</div>';
        }).join('');
        paintBugCount();
    }
    // 기록이 바뀌면(내 기기/다른 기기) 설정 줄과 열려 있는 목록을 새로 그린다
    document.addEventListener('sdy-buglog-changed',function(){
        try{ paintBugCount(); }catch(e){}
        try{ if(isBuglogOpen()) renderBugList(); }catch(e){}
    });
    // 첫 화면에서도 설정 줄 숫자는 맞춰 둔다 (요소는 설정을 열 때 생기지만 없으면 무해)
    paintBugCount();
    try{ window.sdyBuglogCount=function(){ return getBugEntries().length; }; }catch(e){}
/* APP-PART:02f-buglog.js:END */
