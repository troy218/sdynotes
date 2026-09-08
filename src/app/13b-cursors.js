/* === src/app/13b-cursors.js ===
   실시간 커서 공유
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:13b-cursors.js:BEGIN */
    // ============ 실시간 커서 공유 ============
    // 같은 노트를 여러 사람이 열면 서로의 마우스를 색깔 화살표로 보여준다.
    const LIVE_ME=(()=>{ try{
        let v=localStorage.getItem('sdy_uid');
        if(!v){ v='u_'+Math.random().toString(36).slice(2,10); localStorage.setItem('sdy_uid',v); }
        return v;
    }catch(e){ return 'u_'+Math.random().toString(36).slice(2,10); } })();
    // 이름을 따로 정하지 않았으면 '푸른 두루미' 같은 이름을 하나 지어 준다.
    const LIVE_ADJ=['연보라','복숭아빛','민트색','하늘색','살구색','라벤더','코랄빛',
                    '레몬색','장미빛','청포도','피치','시나몬','솜사탕','아이보리',
                    '라일락','청옥','버터','멜론','구름빛','연분홍'];
    const LIVE_ANI=['까치','참새','박새','멧비둘기','직박구리','제비','백로','왜가리',
                    '뻐꾸기','물총새','두루미','기러기','청둥오리','저어새','꾀꼬리',
                    '동박새','오목눈이','수리부엉이','팔색조','호반새','파랑새','후투티',
                    '원앙','종달새'];
    function makeLiveName(){
        const a=LIVE_ADJ[Math.floor(Math.random()*LIVE_ADJ.length)];
        const b=LIVE_ANI[Math.floor(Math.random()*LIVE_ANI.length)];
        return a+' '+b;
    }
    function liveName(){
        try{
            let v=localStorage.getItem('sdy_uname_v2');
            if(!v||!v.trim()||v==='사용자'||v==='익명'){
                v=makeLiveName();
                localStorage.setItem('sdy_uname_v2',v);
            }
            return v;
        }catch(e){ return makeLiveName(); }
    }
    let liveTimer=null, liveRateTimer=null, liveLast={x:null,y:null,page:0},
        liveOn=false, liveMoved=false, _liveBusy=false, _liveQueued=false,
        _liveLastPoll=0, liveMyColor='';
    const liveInkTimers={};       // uid → 실시간 잉크 정리 타이머(펜을 뗀 뒤 잠시 유지)
    // 상대가 있을 때는 25fps로 왕복하고, 혼자일 때도 600ms마다 가볍게 확인한다.
    // 내 마우스가 멈췄다고 polling까지 4초 멈추면 움직이는 상대 커서가 내 화면에서
    // 4초씩 얼어 보였던 것이 '현재 위치가 바로 안 오는' 핵심 원인이었다.
    const LIVE_RATE_MS=40, LIVE_DISCOVER_MS=600, LIVE_HEARTBEAT_MS=4000;
    // 22.1 · '글 쓰는 중'에는 상대가 없어도 매 틱(40ms)마다 울렸다. 편집 중에는
    //   캐럿 좌표를 다시 재야 하는데(종이 레이아웃 읽기) 그 진동이 그대로 입력
    //   지연이 됐다. → 글자 크기가 섞인 문서에서도 눈에 띄지 않는 간격으로 늘린다.
    const LIVE_EDIT_MS=(typeof sdyTurbo==='function'&&sdyTurbo())?700:250;
    const LIVE_MOVE_EVENT=('PointerEvent' in window)?'pointermove':'mousemove';
    const livePeerCount={};        // 노트별 동시 접속자 수

    function startLive(){
        if(liveOn||!curNB) return;
        liveOn=true; liveMoved=true; _liveLastPoll=0;
        document.addEventListener(LIVE_MOVE_EVENT,onLiveMove,{passive:true});
        liveTimer=setInterval(livePing,LIVE_HEARTBEAT_MS);
        clearInterval(liveRateTimer);
        liveRateTimer=setInterval(liveFastTick,LIVE_RATE_MS);
        livePing();
    }
    function stopLive(){
        if(!liveOn) return;
        liveOn=false;
        document.removeEventListener(LIVE_MOVE_EVENT,onLiveMove);
        clearInterval(liveTimer); liveTimer=null;
        clearInterval(liveRateTimer); liveRateTimer=null;
        _liveBusy=false; _liveQueued=false;
        const bd=document.getElementById('liveBadge'); if(bd) bd.style.display='none';
        const nb=curNB&&curNB.id;
        if(nb) fetch('/api/live/leave',{method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({note:nb,uid:LIVE_ME}),keepalive:true}).catch(()=>{});
        document.querySelectorAll('.live-cur').forEach(n=>n.remove());
        Object.keys(liveInkTimers).forEach(k=>{ clearTimeout(liveInkTimers[k]); delete liveInkTimers[k]; });
        document.querySelectorAll('[id^="liveInk_"]').forEach(n=>n.remove());
        const lg=document.getElementById('liveLegend'); if(lg) lg.remove();
    }
    // 상대가 보이는 동안에는 내가 가만히 있어도 계속 받아야 한다. 혼자일 때만
    // 발견 주기로 낮춰 서버와 배터리 부담을 줄인다.
    function liveFastTick(){
        if(!liveOn||!curNB) return;
        const now=performance.now();
        const hasPeer=(livePeerCount[curNB.id]||1)>1;
        const act=liveAct();
        // 22.1 · 진동 간격을 '지금 내가 무엇을 하나'로 정한다.
        //   · 마우스를 움직였다 → 즉시 (커서가 뚝뚝 끊기지 않게)
        //   · 상대가 보는 중   → 평소처럼 빠르게, 단 편집 중엔 캐럿을 다시 재는
        //     비용(레이아웃 읽기)이 매 40ms 들어오니 LIVE_EDIT_MS 로 줄인다.
        //   · 아무도 없고 가만히 → 발견 주기(600ms)로만 확인.
        let need=LIVE_DISCOVER_MS;
        if(hasPeer) need=act?LIVE_EDIT_MS:LIVE_RATE_MS;
        else if(liveMoved) need=LIVE_RATE_MS;
        else if(act) need=LIVE_EDIT_MS;
        if(!liveMoved && now-_liveLastPoll<need) return;
        liveMoved=false; _liveLastPoll=now;
        livePing();
    }
    function onLiveMove(e){
        const paper=e.target.closest&&e.target.closest('#pagesStage .paper');
        if(!paper) return;
        // 고주사율 마우스/펜은 한 이벤트에 좌표가 여럿 묶인다. 가장 최신 좌표를
        // 사용해야 커서가 한 프레임 뒤를 따라오지 않는다.
        const samples=typeof e.getCoalescedEvents==='function'?e.getCoalescedEvents():null;
        const point=samples&&samples.length?samples[samples.length-1]:e;
        const pi=+paper.dataset.pageIdx||0,p=pageLocal(point,pi);
        liveLast={ x:p.x,y:p.y,page:pi };
        liveMoved=true;
    }
    // 지금 하고 있는 일을 한 마디로 (다른 사람 화면에 함께 표시)
    function liveAct(){
        try{
            // 14.30.1 · 실시간 표시는 타이머로 자주 불린다 → 전체 훑기 대신 O(1) 캐시
            if(_activeEditBox()) return '글 쓰는 중';
            if(typeof penActive!=='undefined'&&penActive) return '그리는 중';
            if(typeof eraserActive!=='undefined'&&eraserActive) return '지우는 중';
            if(typeof textToolActive!=='undefined'&&textToolActive) return '글상자 놓는 중';
            if(typeof activeTbl!=='undefined'&&activeTbl) return '표 다루는 중';
            if(typeof drag!=='undefined'&&drag) return '옮기는 중';
            if(typeof findOpen!=='undefined'&&findOpen) return '찾는 중';
            const sel=getSelection();
            // 상태 표시에 선택 문자열은 필요 없다. 원문 전체를 직렬화/레이아웃하지 않는다.
            if(sel&&sel.rangeCount&&!sel.isCollapsed) return '글 고르는 중';
            return '';
        }catch(e){ return ''; }
    }
    // 14.18.4 · 지금 하는 일의 '종류' — 상대 화면에서 내 표시 모양을 정한다.
    //   ''     : 평소(마우스 화살표)
    //   'draw' : 펜으로 그리는 중 → 상대 화면에서 내 커서가 '펜촉'으로 바뀌고
    //            지금 긋는 획(liveInk)이 실시간 미리보기로 같이 보인다.
    //   'type' : 글 입력 중 → 상대 화면에서 내 커서 대신 '깜빡이는 캐럿'이 보인다.
    function liveMode(){
        try{
            if(_activeEditBox()) return 'type';
            if(typeof penActive!=='undefined'&&penActive
                &&!(typeof eraserActive!=='undefined'&&eraserActive)) return 'draw';
            return '';
        }catch(e){ return ''; }
    }
    // 편집 중인 캐럿의 위치를 종이 좌표로 — 상대에게 '마우스'가 아니라
    // '지금 글이 쓰이는 곳'을 보내야 깜빡이 캐럿이 제자리에 보인다.
    let _caretKey='', _caretVal=null;
    function liveCaretPos(){
        try{
            const sel=getSelection();
            if(!sel||!sel.rangeCount) return null;
            const anc=sel.getRangeAt(0).commonAncestorContainer;
            const cEl=anc.nodeType===1?anc:anc.parentElement;
            const content=cEl&&cEl.closest&&cEl.closest('.tb-content');
            const box=content&&content.closest('.tb.edit');
            if(!content||!box) return null;
            // 22.1 · 선택이 하나도 안 바뀌었으면(같은 노드·같은 오프셋) 지난 값을
            //   그대로 쓴다. 예전엔 편집 중 틱마다 Range 사각형과 종이 사각형을
            //   다시 쟀고, 특히 '종이 전부 훑기'가 문제였다(종이마다 레이아웃 읽기).
            //   열쇠는 '캐럿이 실제로 움직인 사건'만 본다 — 선택 객체를 문자열로
            //   굽는 것(getSelection().toString())은 문서 전체를 훑는 일이라
            //   이 경로에서 절대 쓰지 않는다. 상자 안 입력은 input 리스너가
            //   box._caretV 를 올린다(아래 buildTextEl ), 배율은 pageScale 로 잡힌다.
            const key=(sel.anchorOffset||0)+':'+(sel.focusOffset||0)+':'+(box._caretV||0)
                      +':'+box.dataset.id+':'+pageScale;
            if(key===_caretKey&&_caretVal) return _caretVal;
            let r=null;
            try{ r=sel.getRangeAt(0).getBoundingClientRect(); }catch(e){}
            if(!r||(r.top===0&&r.bottom===0)) r=content.getBoundingClientRect();
            let out=null;
            const own=content.closest('.paper');       // 편집 상자가 올라탄 종이 한 장만 재면 된다
            const cand=own?[own]:editorPapers();
            for(let i=0;i<cand.length;i++){
                const pr=cand[i].getBoundingClientRect();
                if(r.left>=pr.left-2&&r.left<=pr.right+2&&r.bottom>=pr.top-2&&r.bottom<=pr.bottom+2){
                    const ps=paperSize();
                    out={x:(r.left-pr.left)*(ps.w/Math.max(1,pr.width)),
                         y:(r.bottom-pr.top)*(ps.h/Math.max(1,pr.height)),
                         page:+cand[i].dataset.pageIdx||0};
                    break;
                }
            }
            _caretKey=key; _caretVal=out;
            return out;
        }catch(e){ return null; }
    }
    // 그리고 있는 획의 '지금까지' 모양 — 완성을 기다리지 않고 실시간으로 보낸다.
    //   트래픽을 줄이려고 점을 단순화(RDP)하고 최대 96점으로 자른다. 최종 획은
    //   기존 요소 동기화 경로로 확실히 도착하므로 미리보기는 근삿값이어도 된다.
    function liveInkPayload(){
        try{
            if(!drawing||!penActive||eraserActive) return null;
            if(!curPts||curPts.length<2) return null;
            let pts=rdpPts(curPts,1.1);
            if(pts.length>96){
                const step=(pts.length-1)/95,out=[];
                for(let i=0;i<95;i++) out.push(pts[Math.round(i*step)]);
                out.push(pts[pts.length-1]);
                pts=out;
            }
            pts=pts.map(pt=>[round1(pt[0]),round1(pt[1])]);
            return {pts,color:drawColor,size:round1(effSize()),op:effOpacity(),page:drawPageIdx||0};
        }catch(e){ return null; }
    }
    async function livePing(){
        if(!liveOn||!curNB) return;
        // 응답이 뒤섞여 커서가 뒤로 튀지 않게 하나씩 직렬 전송한다.
        // 이동 중 연속 호출은 busy 면 다음 완료 직후 최신 좌표로 한 번 이어 보낸다.
        if(_liveBusy){ _liveQueued=true; return; }
        const noteId=curNB.id;       // await 사이 노트 전환 시 옛 응답을 새 문서에 그리지 않음
        _liveBusy=true;
        // 14.18.4 · 글 쓰는 중에는 마우스가 아니라 '캐럿 위치'를 상대에게 보낸다.
        const mode=liveMode();
        if(mode==='type'){
            const cp=liveCaretPos();
            if(cp){ liveLast=cp; liveMoved=true; }
        }
        try{
            const r=await fetch('/api/live/ping',{method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({note:noteId,uid:LIVE_ME,name:liveName(),
                    x:liveLast.x,y:liveLast.y,page:liveLast.page,on:true,
                    act:liveAct(),mode,
                    ink:mode==='draw'?liveInkPayload():null,
                    ts:Date.now()})});
            const d=await r.json().catch(()=>({}));
            if(!liveOn||!curNB||curNB.id!==noteId) return;
            if(d&&d.ok){
                if(d.color) liveMyColor=d.color;
                // 5.35: 표시 순서를 매번 완전 랜덤으로 (같은 순서 고정 방지)
                const peers=(d.peers||[]).slice();
                for(let i=peers.length-1;i>0;i--){
                    const j=(Math.random()*(i+1))|0;
                    const t=peers[i]; peers[i]=peers[j]; peers[j]=t;
                }
                drawPeers(peers);
                const n=peers.length+1;
                const bd=document.getElementById('liveBadge');
                const nm=document.getElementById('liveNum');
                if(bd&&nm){ nm.textContent=n; bd.style.display=n>1?'inline-flex':'none'; }
                livePeerCount[noteId]=n;
            }
        }catch(e){ /* 서버 없으면 조용히 무시 */ }
        finally{
            _liveBusy=false;
            if(_liveQueued && liveOn){
                _liveQueued=false;
                setTimeout(()=>{ if(liveOn) livePing(); },0);
            }
        }
    }
    // 14.18.4 · 실시간 잉크 — 상대가 그리고 있는 획을 상대의 종이 위에 임시 SVG로.
    //   펜을 뗀 뒤에는 최종 획이 요소 동기화로 도착할 시간(3.5초)을 주고 지운다.
    function _dropLiveInk(uid){
        if(liveInkTimers[uid]) return;
        liveInkTimers[uid]=setTimeout(()=>{
            delete liveInkTimers[uid];
            const el=document.getElementById('liveInk_'+uid);
            if(el) el.remove();
        },3500);
    }
    function _updateLiveInk(p){
        const uid=p.uid, ink=p.ink;
        if(!ink||!ink.pts||ink.pts.length<2){ _dropLiveInk(uid); return; }
        if(liveInkTimers[uid]){ clearTimeout(liveInkTimers[uid]); delete liveInkTimers[uid]; }
        const pageIdx=(ink.page!=null&&isFinite(+ink.page))?+ink.page:(+p.page||0);
        const paper=paperAt(pageIdx);
        if(!paper) return;
        let svg=document.getElementById('liveInk_'+uid);
        if(!svg||!svg.isConnected||svg.parentElement!==paper){
            if(svg) svg.remove();
            svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
            svg.id='liveInk_'+uid;
            const ps=paperSize();
            svg.setAttribute('viewBox','0 0 '+ps.w+' '+ps.h);
            svg.setAttribute('preserveAspectRatio','none');
            svg.style.cssText='position:absolute;inset:0;width:100%;height:100%;'+
                              'pointer-events:none;z-index:30;overflow:visible;';
            const path=document.createElementNS('http://www.w3.org/2000/svg','path');
            path.setAttribute('fill','none');
            path.setAttribute('stroke-linecap','round');
            path.setAttribute('stroke-linejoin','round');
            svg.appendChild(path);
            paper.appendChild(svg);
        }
        const path=svg.firstChild;
        try{ path.setAttribute('d',strokePath(ink.pts)); }catch(e){ return; }
        path.setAttribute('stroke',String(ink.color||'#888888').slice(0,24));
        path.setAttribute('stroke-width',Math.max(.5,Math.min(200,+ink.size||2)));
        path.setAttribute('stroke-opacity',ink.op==null?1:Math.max(.05,Math.min(1,+ink.op)));
    }
    // 14.18.4 · 왼쪽 범례 — 누가 어떤 색인지 한눈에. 커서에는 이름표 없이 색만 단다.
    function _liveEsc(v){
        return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
    function renderLiveLegend(rows){
        let lg=document.getElementById('liveLegend');
        if(!rows||!rows.length){ if(lg) lg.remove(); return; }
        if(!lg){
            lg=document.createElement('div');
            lg.id='liveLegend'; lg.className='live-legend';
            document.body.appendChild(lg);
        }
        const all=[{color:liveMyColor||'#4f6ef7',name:liveName(),act:liveAct(),me:true}].concat(rows);
        lg.innerHTML=all.map(r=>
            '<div class="ll-row'+(r.me?' me':'')+'">'+
                '<span class="ll-dot" style="background:'+_liveEsc(r.color)+'"></span>'+
                '<span class="ll-nm">'+_liveEsc(r.name)+(r.me?' (나)':'')+'</span>'+
                (r.act?'<span class="ll-act">'+_liveEsc(r.act)+'</span>':'')+
            '</div>').join('');
    }
    // 14.18.4 · 상대 커서 — 이름표 없이 색만. 그리는 중엔 펜촉, 글 쓰는 중엔 깜빡이 캐럿.
    function drawPeers(peers){
        const stage=document.getElementById('pagesStage');
        if(!stage) return;
        const seen=new Set(), rows=[];
        // 22.1 · 혼자 보는 노트에서 매 틱마다 '.live-cur' 를 찾고 범례를 다시
        //   그리던 일은 전부 헛수고였다. 보여 줄 커서도, 이미 떠 있는 커서도
        //   없는 상태라면 DOM 을 아예 건드리지 않고 나간다.
        //   (남의 커서는 전부 #liveLayer 안에 뜨므로, 레이어·범례가 둘 다
        //   없으면 지울 것도 그릴 것이 없다는 뜻이다 — class 로 문서 전체를
        //   훑는 것(.live-cur)은 오히려 이 경로에서 가장 비싼 조사였다.)
        if((!peers||!peers.length)
           &&!document.getElementById('liveLayer')&&!document.getElementById('liveLegend')) return;
        peers.forEach(p=>{
            if(p.x==null||p.y==null) return;
            seen.add(p.uid);
            const paper=paperAt(p.page||0);
            if(!paper) return;
            let layer=document.getElementById('liveLayer');
            if(!layer||!layer.isConnected){
                layer=document.createElement('div');
                layer.id='liveLayer';
                layer.style.cssText='position:fixed;left:0;top:0;width:100%;height:100%;'+
                                    'pointer-events:none;z-index:1050;';
                document.body.appendChild(layer);
            }
            let n=document.getElementById('live_'+p.uid);
            const isNew=!n;
            if(!n){
                n=document.createElement('div');
                n.id='live_'+p.uid; n.className='live-cur';
                n.innerHTML='<svg class="lc lc-arrow" viewBox="0 0 24 24" width="20" height="20">'+
                    '<path d="M4 2 L20 12 L13 13 L16 21 L13 22 L10 14 L4 18 Z" '+
                    'fill="currentColor" stroke="#475569" stroke-width="1.4"/></svg>'+
                    '<i class="lc lc-pen ri-pen-nib-fill"></i>'+
                    '<span class="lc lc-caret"></span>';
                layer.appendChild(n);
            }
            n.style.color=p.color||'#ef4444';
            n.style.zIndex=String(1+((Math.random()*40)|0));   // 5.35: 겹침 순서도 매번 랜덤
            const mode=(p.mode==='draw'||p.mode==='type')?p.mode:'';
            n.classList.toggle('draw',mode==='draw');
            n.classList.toggle('type',mode==='type');
            _updateLiveInk(p);
            rows.push({color:p.color||'#ef4444',name:p.name||'익명',act:p.act||'',me:false});
            const pr=paper.getBoundingClientRect(), ps=paperSize();
            // pageScale은 루트 90% zoom과 전환 중 배율을 모른다. 실제 종이 사각형으로
            // 문서 좌표→화면 좌표를 구한 뒤 fixed 레이어의 CSS px로 변환한다.
            const screenX=pr.left+(Number(p.x)||0)*(pr.width/Math.max(1,ps.w));
            const screenY=pr.top +(Number(p.y)||0)*(pr.height/Math.max(1,ps.h));
            const x=_clawCss(screenX), y=_clawCss(screenY);
            if(isNew) n.style.transition='none';
            n.style.setProperty('--live-x',x.toFixed(2)+'px');
            n.style.setProperty('--live-y',y.toFixed(2)+'px');
            if(isNew){
                // 첫 등장만 원점에서 날아오지 않게 즉시 놓고, 다음 프레임부터 보간.
                void n.offsetWidth;
                n.style.transition='';
            }
        });
        document.querySelectorAll('.live-cur').forEach(n=>{
            const uid=n.id.replace('live_','');
            if(!seen.has(uid)){ n.remove(); _dropLiveInk(uid); }
        });
        renderLiveLegend(rows);
    }
    addEventListener('beforeunload',()=>{ if(liveOn) stopLive(); });

    async function renderPageCanvas(pageIdx,opt){
        opt=opt||{};
        const size=paperSize();
        const page=JSON.parse(JSON.stringify(doc.pages[pageIdx]));
        await _pdfLoadExportFonts(page.els||[]);
        if(opt.onlyIds) page.els=(page.els||[]).filter(e=>opt.onlyIds.has(e.id));
        (page.els||[]).forEach(el=>{ if(el.type==='text'&&!el.pdfText) el.html=fixDarkColors(el.html); });
        for(const el of page.els||[]){
            if(el.type==='image'||el.type==='legacyDraw') el.url=await toDataURL(el.url);
        }

        const sc=Math.max(2,Math.min(3,window.devicePixelRatio||2));
        const c=document.createElement('canvas');
        c.width=Math.ceil(size.w*sc); c.height=Math.ceil(size.h*sc);
        const ctx=c.getContext('2d');
        ctx.scale(sc,sc);
        if(!opt.transparent){
            ctx.fillStyle=(doc&&doc.tint)?doc.tint:'#ffffff';
            ctx.fillRect(0,0,size.w,size.h);
            // ① 종이 배경 — 캔버스에 직접 (SVG 실패와 무관하게 항상 그려짐)
            drawPaperBg(ctx,doc.paper,size);
        }

        // ② 이미지 — 캔버스에 직접 (foreignObject 안 거침 → 훨씬 안정적)
        //    편집 화면의 .paper-img 는 투명 테두리(bw) 안쪽에 그림을 채운다 → 같이 들여쓴다
        const bw=_expBorderW();
        for(const el of page.els||[]){
            if(el.type==='image'&&el.url){
                try{
                    const im=await loadImg(el.url);
                    const a=normalizedRotation(el.rotation);
                    const ix=el.x+bw, iy=el.y+bw, iw=Math.max(1,el.w-bw*2), ih=Math.max(1,el.h-bw*2);
                    if(a){ ctx.save(); ctx.translate(el.x+el.w/2,el.y+el.h/2); ctx.rotate(a*Math.PI/180); ctx.drawImage(im,-iw/2,-ih/2,iw,ih); ctx.restore(); }
                    else ctx.drawImage(im,ix,iy,iw,ih);
                }catch(e){ console.warn('이미지 건너뜀',e); }
            }else if(el.type==='legacyDraw'&&el.url){
                try{
                    const im=await loadImg(el.url);
                    ctx.drawImage(im,0,0,size.w,size.h);
                }catch(e){}
            }
        }

        // ③-a 펜 채움 — 편집 화면(layer-fill)이 글자보다 아래인 것과 같은 순서
        (page.els||[]).forEach(st=>{
            if(st.type!=='stroke'||!st.fillColor) return;
            drawStrokeOnCanvas(ctx,st,'fill');
        });

        // ④ 텍스트 — foreignObject(서식 유지). 실패하면 캔버스 텍스트로 폴백.
        const texts=(page.els||[]).filter(e=>e.type==='text'&&(e.html||'').trim());
        const formulas=(page.els||[]).filter(e=>e.type==='latex'&&(e.latex||'').trim());
        if(texts.length||formulas.length){
            let done=false;
            try{
                let body='';
                texts.forEach(el=>{
                    body+=`<div style="position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;transform:rotate(${normalizedRotation(el.rotation)}deg);transform-origin:50% 50%;">`+
                          `<div style="${_expTextInner(el,bw,el.__c||'#111111')}">`+
                          htmlToXhtml(imathExpandHtml(_pdfStaticHtml(el)))+`</div></div>`;
                });
                formulas.forEach(el=>{
                    let mh;
                    // 9.0 · 내보낼 때도 화면과 똑같은 KaTeX(HTML+MathML)로 그린다.
                    //  mathml 만 쓰면 브라우저 기본 수식 글꼴로 대체돼 폭이 달라지고
                    //  그만큼 옆 본문 위로 번져 글자가 겹쳐 보였다.
                    // 화면과 동일하게 tidyLatex 로 고친 뒤 그린다 — 그렇지 않으면
                    // 내보낸 PDF/JPG 에만 빨간 KaTeX 오류가 남는다.
                    try{ mh=window.katex?katex.renderToString(tidyLatex(el.latex||''),{displayMode:!!el.displayMath,throwOnError:false,strict:'ignore',output:'html'}):esc(el.latex||''); }
                    catch(e){ mh=esc(el.latex||''); }
                    // 상자는 화면(buildLatexEl)과 같은 el.w×el.h, 맞춤은 paintLatex 과
                    // 같은 latexFitScale — 가져온 수식뿐 아니라 직접 넣은 수식도 화면처럼.
                    const fs=Math.max(6,(el.fontSize||20)*(latexFitScale(el)||1));
                    body+=`<div style="position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;`+
                          `transform:rotate(${normalizedRotation(el.rotation)}deg);transform-origin:50% 50%;">`+
                          `<div style="${_expLatexInner(el,bw,fs)}">${htmlToXhtml(mh)}</div></div>`;
                });
                const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}" viewBox="0 0 ${size.w} ${size.h}">`+
                    `<foreignObject x="0" y="0" width="${size.w}" height="${size.h}">`+
                    `<div xmlns="http://www.w3.org/1999/xhtml" class="sdyx" style="width:${size.w}px;height:${size.h}px;position:relative;`+
                    `font-family:'Pretendard Variable','Pretendard',sans-serif;">${_expForeignReset()}${body}</div></foreignObject></svg>`;
                const img=await svgToImage(svg);
                ctx.drawImage(img,0,0,size.w,size.h);
                done=true;
            }catch(e){
                console.warn('텍스트 SVG 렌더 실패 → 캔버스 폴백',e);
            }
            if(!done){
                texts.forEach(el=>drawTextOnCanvas(ctx,el));
                formulas.forEach(el=>{
                    ctx.save();
                    const a=normalizedRotation(el.rotation);
                    if(a){ const cx=el.x+el.w/2, cy=el.y+el.h/2; ctx.translate(cx,cy); ctx.rotate(a*Math.PI/180); ctx.translate(-cx,-cy); }
                    ctx.fillStyle='#111';
                    // 9.0 · 폴백에서도 화면 상자(el.w)를 넘지 않게 글씨를 줄여 그린다.
                    const bw2=Math.max(8,el.w), bh2=Math.max(8,el.h);
                    let fs=(el.fontSize||20)*(latexFitScale(el)||1);
                    ctx.font=`${fs}px "Times New Roman",serif`;
                    const raw=(el.latex||'').replace(/[{}\\]|\$/g,'');
                    const tw=ctx.measureText(raw).width||1;
                    const avail=Math.max(8,bw2-(el.imported?0:8));
                    if(tw>avail){ fs=Math.max(6,fs*(avail/tw)); ctx.font=`${fs}px "Times New Roman",serif`; }
                    ctx.textBaseline='middle';ctx.textAlign=el.displayMath?'center':'left';
                    ctx.fillText(raw,el.displayMath?el.x+bw2/2:el.x+(el.imported?0:4),el.y+bh2/2);
                    ctx.restore();
                });
            }
        }
        // ③-b 펜 선 — 편집 화면(layer-stroke)이 글자보다 위인 것과 같은 순서
        (page.els||[]).forEach(st=>{
            if(st.type!=='stroke') return;
            drawStrokeOnCanvas(ctx,st,'line');
        });
        return c;
    }

    function loadImg(src){
        return new Promise((res,rej)=>{
            const i=new Image();
            i.onload=()=>res(i);
            i.onerror=rej;
            i.src=src;
        });
    }

    function drawStrokeOnCanvas(ctx,st,pass){
        const pts=st.pts||[];
        if(!pts.length) return;
        // 편집 화면과 같은 겹침 순서 (채움 layer-fill < 글자 < 선 layer-stroke)를
        // 맞추려고 채우기와 선을 나눠 그릴 수 있다. pass 없이 부르면 둘 다 그린다.
        if(pass==='fill'&&!st.fillColor) return;
        ctx.save();
        ctx.translate(st.dx||0, st.dy||0);
        const a=normalizedRotation(st.rotation);
        if(a){ const bb=strokeBBox(st),cx=bb.x+bb.w/2,cy=bb.y+bb.h/2; ctx.translate(cx,cy);ctx.rotate(a*Math.PI/180);ctx.translate(-cx,-cy); }
        ctx.strokeStyle=st.color; ctx.lineWidth=st.size;
        ctx.lineCap='round'; ctx.lineJoin='round';
        ctx.beginPath();
        ctx.moveTo(pts[0][0],pts[0][1]);
        if(st.sharp&&!isEllipsePts(pts)){
            for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]);
        }else{
            for(let i=1;i<pts.length-1;i++){
                const mx=(pts[i][0]+pts[i+1][0])/2, my=(pts[i][1]+pts[i+1][1])/2;
                ctx.quadraticCurveTo(pts[i][0],pts[i][1],mx,my);
            }
            const last=pts[pts.length-1];
            ctx.lineTo(last[0],last[1]);
        }
        if(st.fillColor&&pass!=='line'){
            ctx.save(); ctx.globalAlpha=st.fillOpacity==null?0.58:st.fillOpacity; ctx.fillStyle=st.fillColor; ctx.fill('evenodd'); ctx.restore();
        }
        if(pass!=='fill'){
            if(st.opacity!=null) ctx.globalAlpha=st.opacity;
            ctx.stroke();
        }
        ctx.restore();
    }

    // 서식 없는 순수 텍스트 폴백 (SVG 렌더가 막혔을 때도 글자는 남긴다)
    function drawTextOnCanvas(ctx,el){
        // SVG 렌더가 막혔을 때의 최후 수단 — 그래도 자리·자세·맞춤 크기는 화면과 같이.
        const a=normalizedRotation(el.rotation);
        const bw=_expBorderW(), m=_expTextMetrics(el);
        ctx.save();
        if(a){ const cx=el.x+el.w/2, cy=el.y+el.h/2; ctx.translate(cx,cy); ctx.rotate(a*Math.PI/180); ctx.translate(-cx,-cy); }
        try{ _drawTextFallback(ctx,el,bw,m); }finally{ ctx.restore(); }
    }
    function _drawTextFallback(ctx,el,bw,m){
        const tmp=document.createElement('div');
        tmp.innerHTML=(el.html||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(div|p)>/gi,'\n');
        const text=(tmp.textContent||'').replace(/\u00a0/g,' ');
        if(!text.trim()) return;
        if(el.pdfText&&el.tight){
            for(const s of tmp.querySelectorAll(':scope > span[data-pdf-w]')){
                const st=s.style, fs=parseFloat(st.fontSize)||m.fs||parseFloat(s.dataset.fs)||14;
                const text=(s.textContent||'').trimEnd(), width=parseFloat(s.dataset.pdfW);
                const baseline=parseFloat(s.dataset.pdfBase);
                if(!(width>0)||!Number.isFinite(baseline)) continue;
                ctx.save();
                ctx.font=[st.fontStyle||'normal',st.fontWeight||'400',fs+'px',st.fontFamily||fontCSS(el.font)].join(' ');
                ctx.fillStyle=st.color||'#111'; ctx.textAlign='left'; ctx.textBaseline='alphabetic';
                const natural=ctx.measureText(text).width;
                ctx.translate(el.x+bw+(parseFloat(st.left)||0),el.y+bw+baseline);
                if(natural>0) ctx.scale(width/natural,1);
                ctx.fillText(text,0,0); ctx.restore();
            }
            return;
        }
        // 단어 상자(tight): 패딩·줄바꿈 없이 상자 중앙에 한 줄로
        if(el.tight){
            const fs=m.fs||16;
            ctx.save();
            ctx.fillStyle='#111111';
            ctx.font=`${fs}px ${fontCSS(el.font||'pretendard')}`;
            ctx.textBaseline='middle';
            const al=el.align||'left';
            ctx.textAlign=al==='center'?'center':al==='right'?'right':'left';
            const ox=al==='center'?el.x+el.w/2:al==='right'?el.x+el.w-bw:el.x+bw;
            ctx.fillText(text.replace(/\s+/g,' '), ox, el.y+el.h/2);
            ctx.restore();
            return;
        }
        const fs=m.fs||16, lh=fs*1.5;
        ctx.save();
        ctx.fillStyle='#111111';
        ctx.font=`${fs}px ${fontCSS(el.font||'pretendard')}`;
        ctx.textBaseline='top';
        const al=el.align||'left';
        ctx.textAlign=al==='center'?'center':al==='right'?'right':'left';
        const maxW=el.w-24-bw*2;
        const ox=al==='center'?el.x+el.w/2:al==='right'?el.x+el.w-12-bw:el.x+12+bw;
        let y=el.y+8+bw;
        text.split('\n').forEach(para=>{
            let line='';
            for(const ch of para){
                if(ctx.measureText(line+ch).width>maxW && line){
                    ctx.fillText(line, ox, y); y+=lh; line=ch;
                }else line+=ch;
            }
            if(line) { ctx.fillText(line, ox, y); y+=lh; }
        });
        ctx.restore();
    }

    function drawPaperBg(ctx,type,size){
        ctx.save();
        if(type==='lined'){
            ctx.strokeStyle='#e8e8e8'; ctx.lineWidth=1;
            for(let y=47.5;y<size.h;y+=32){
                ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(size.w,y); ctx.stroke();
            }
        }else if(type==='grid'){
            ctx.strokeStyle='#e8e8e8'; ctx.lineWidth=1;
            for(let y=0.5;y<size.h;y+=32){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(size.w,y); ctx.stroke(); }
            for(let x=0.5;x<size.w;x+=32){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,size.h); ctx.stroke(); }
        }else if(type==='dotted'){
            ctx.fillStyle='#cfcfcf';
            for(let y=12;y<size.h;y+=24)
                for(let x=12;x<size.w;x+=24){ ctx.beginPath(); ctx.arc(x,y,1,0,6.284); ctx.fill(); }
        }
        ctx.restore();
    }

    // 종이 배경을 SVG 도형으로 직접 그린다 (화면 CSS와 동일한 간격/색)
    function paperBgSVG(type,size){
        let out='';
        if(type==='lined'){
            for(let y=47.5;y<size.h;y+=32) out+=`<line x1="0" y1="${y}" x2="${size.w}" y2="${y}" stroke="#e8e8e8" stroke-width="1"/>`;
        }else if(type==='grid'){
            for(let y=0.5;y<size.h;y+=32) out+=`<line x1="0" y1="${y}" x2="${size.w}" y2="${y}" stroke="#e8e8e8" stroke-width="1"/>`;
            for(let x=0.5;x<size.w;x+=32) out+=`<line x1="${x}" y1="0" x2="${x}" y2="${size.h}" stroke="#e8e8e8" stroke-width="1"/>`;
        }else if(type==='dotted'){
            for(let y=12;y<size.h;y+=24) for(let x=12;x<size.w;x+=24) out+=`<circle cx="${x}" cy="${y}" r="1" fill="#cfcfcf"/>`;
        }
        return out;
    }

    function downloadBlob(blob,name){
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a');
        a.href=url; a.download=name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(()=>URL.revokeObjectURL(url),4000);
    }
    function canvasToBlob(c,type,q){
        return new Promise(res=>{
            if(c.toBlob) c.toBlob(b=>res(b),type,q);
            else{
                const d=c.toDataURL(type,q), bin=atob(d.split(',')[1]);
                const u=new Uint8Array(bin.length);
                for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
                res(new Blob([u],{type}));
            }
        });
    }
    function safeTitle(){
        return ((curNB&&curNB.title)||'노트').replace(/[\\/:*?"<>|]/g,'').trim()||'노트';
    }

    // 내보내기 진행 표시
    function expProgress(cur,total,label){
        const el=document.getElementById('expProg');
        if(!el) return;
        if(cur<0){ el.style.display='none'; return; }
        el.style.display='flex';
        el.querySelector('.ep-txt').textContent=label||`내보내는 중... ${cur}/${total}`;
        el.querySelector('.ep-fill').style.width=total?Math.round(cur/total*100)+'%':'0%';
    }

    function openExportModal(){
        if(!doc){ toast('노트를 먼저 열어주세요'); return; }
        document.getElementById('expInfo').textContent=`총 ${doc.pages.length}페이지 · 현재 ${curPageIdx+1}페이지`;
        document.getElementById('exportModal').style.display='flex';
        openNav(closeExportModal);
    }
    function closeExportModal(){ document.getElementById('exportModal').style.display='none'; navDrop(closeExportModal); }

    async function exportCurrentJPG(){
        if(!doc) return;
        if(penActive) finishDrawing();
        commitEditingText();
        expProgress(0,1);
        try{
            const c=await renderPageCanvas(curPageIdx);
            const blob=await canvasToBlob(c,'image/jpeg',0.95);
            downloadBlob(blob, `${safeTitle()}_${curPageIdx+1}.jpg`);
            toast('현재 페이지 저장 완료 ✓',1600);
        }catch(e){ console.error(e); toast('내보내기 실패: '+(e.message||e),3000); }
        finally{ expProgress(-1); }
    }

    async function copyPageToClipboard(){
        if(!doc) return;
        if(penActive) finishDrawing();
        commitEditingText();
        expProgress(0,1,'클립보드로 복사 중...');
        try{
            const c=await renderPageCanvas(curPageIdx);
            const blob=await canvasToBlob(c,'image/png');
            if(navigator.clipboard&&window.ClipboardItem){
                await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
                toast('클립보드에 복사됨 ✓',1600);
            }else{
                downloadBlob(blob,`${safeTitle()}_${curPageIdx+1}.png`);
                toast('클립보드 미지원 → 파일로 저장됨',2200);
            }
        }catch(e){ console.error(e); toast('복사 실패: '+(e.message||e),3000); }
        finally{ expProgress(-1); }
    }

    async function exportJPG(){
        if(!doc){ toast('노트를 먼저 열어주세요'); return; }
        if(penActive) finishDrawing();
        commitEditingText();
        const n=doc.pages.length;
        expProgress(0,n);
        try{
            const title=safeTitle();
            for(let i=0;i<n;i++){
                expProgress(i,n);
                const c=await renderPageCanvas(i);
                const blob=await canvasToBlob(c,'image/jpeg',0.95);
                if(!blob) throw new Error('이미지 생성 실패');
                downloadBlob(blob, n>1?`${title}_${i+1}.jpg`:`${title}.jpg`);
                await new Promise(r=>setTimeout(r,320));   // 브라우저 다중 다운로드 여유
            }
            toast(`JPG ${n}장 저장 완료 ✓`,1800);
        }catch(e){
            console.error('JPG 내보내기 실패:',e);
            toast('내보내기 실패: '+(e.message||e),3200);
        }finally{ expProgress(-1); }
    }

    // 진짜 PDF 파일을 직접 생성 (외부 라이브러리/팝업 없이)
    function buildPDF(pages,w,h){
        // pages: [{jpg:Uint8Array}]
        const enc=new TextEncoder();
        const chunks=[]; let len=0;
        const push=(d)=>{ const u=(typeof d==='string')?enc.encode(d):d; chunks.push(u); len+=u.length; return len; };
        const offsets=[];
        push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

        const nPages=pages.length;
        const objTotal=2+nPages*3;           // catalog, pages, then (page,content,image)*n
        const startObj=(i)=>{ offsets[i]=len; push(`${i} 0 obj\n`); };
        const endObj=()=>push('endobj\n');

        startObj(1);
        push(`<< /Type /Catalog /Pages 2 0 R >>\n`); endObj();

        const kids=[]; for(let i=0;i<nPages;i++) kids.push(`${3+i*3} 0 R`);
        startObj(2);
        push(`<< /Type /Pages /Count ${nPages} /Kids [${kids.join(' ')}] >>\n`); endObj();

        for(let i=0;i<nPages;i++){
            const pageObj=3+i*3, contentObj=pageObj+1, imgObj=pageObj+2;
            startObj(pageObj);
            push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] `+
                 `/Resources << /XObject << /Im0 ${imgObj} 0 R >> >> /Contents ${contentObj} 0 R >>\n`);
            endObj();

            const stream=`q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`;
            startObj(contentObj);
            push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream\n`); endObj();

            const jpg=pages[i].jpg;
            startObj(imgObj);
            push(`<< /Type /XObject /Subtype /Image /Width ${pages[i].w} /Height ${pages[i].h} `+
                 `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
            push(jpg);
            push('\nendstream\n'); endObj();
        }

        const xrefPos=len;
        let xref=`xref\n0 ${objTotal+1}\n0000000000 65535 f \n`;
        for(let i=1;i<=objTotal;i++){
            xref+=String(offsets[i]||0).padStart(10,'0')+' 00000 n \n';
        }
        push(xref);
        push(`trailer\n<< /Size ${objTotal+1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

        const out=new Uint8Array(len); let o=0;
        chunks.forEach(c=>{ out.set(c,o); o+=c.length; });
        return new Blob([out],{type:'application/pdf'});
    }

    async function exportPDF(){
        if(!doc){ toast('노트를 먼저 열어주세요'); return; }
        if(penActive) finishDrawing();
        commitEditingText();
        const n=doc.pages.length;
        expProgress(0,n);
        try{
            const size=paperSize();
            const pages=[];
            for(let i=0;i<n;i++){
                expProgress(i,n);
                const c=await renderPageCanvas(i);
                const blob=await canvasToBlob(c,'image/jpeg',0.92);
                const buf=new Uint8Array(await blob.arrayBuffer());
                pages.push({jpg:buf,w:c.width,h:c.height});
            }
            expProgress(n,n,'PDF 만드는 중...');
            const pdf=buildPDF(pages,size.w,size.h);
            downloadBlob(pdf, safeTitle()+'.pdf');
            toast(`PDF 저장 완료 ✓ (${n}쪽)`,2000);
            fetch('/api/notifications/event',{method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({kind:'pdf',event:'pdf_'+Date.now().toString(36),
                    title:'PDF를 만들었어요',message:`${safeTitle()} · ${n}쪽 저장 완료`})}).catch(()=>{});
        }catch(e){
            console.error('PDF 내보내기 실패:',e);
            toast('PDF 실패: '+(e.message||e),3200);
        }finally{ expProgress(-1); }
    }


/* APP-PART:13b-cursors.js:END */
