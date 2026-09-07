/* === src/app/14b-init.js ===
   Init · 크레인 애니 · 노트목록 동기화
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:14b-init.js:BEGIN */
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


/* APP-PART:14b-init.js:END */
