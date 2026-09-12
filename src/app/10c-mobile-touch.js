/* === src/app/10c-mobile-touch.js ===
   모바일 터치 조작 · 손바닥 거부 · 더블탭 영역 선택
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:10c-mobile-touch.js:BEGIN */
    // ============ 14.68 · 모바일 터치 조작 ============
    // 이 파일의 모든 동작은 '터치 입력'(pointerType==='touch' / touch 이벤트)과
    // '터치 기기'에서만 게이트된다. 마우스·키보드 경로(데스크톱)는 완전히 그대로다.
    //
    //   ① 자동 손바닥 거부 — 펜(Apple Pencil 등)이 화면에 닿아 있는 동안과
    //      떼고 나서 아주 짧은 순간(320ms)에는 손가락/손바닥 터치를 전부 무시한다.
    //      (그리기·지우기·스크롤·선택 모두 차단 → 필기 중에 손바닥이 쓱 지나가도
    //       선이 그어지거나 화면이 밀리지 않는다)
    //   ② 손바닥 차단(연필 모드) 토글 — 그리기 도구막대(폰/태블릿에서만 주입)에
    //      버튼을 넣어, 켜면 펜 모드에서 '손가락 = 화면 이동'이 되고 펜만 그린다.
    //   ③ 빈 곳 더블탭 + 끌기 → 영역 선택(marquee).
    //      한 손가락 끌기는 언제나 화면 이동(브라우저 스크롤)이 우선한다.
    //      (데스크톱의 '빈 종이 드래그 = marquee' 는 마우스에서 그대로 유지된다)

    // 이 기기가 펜/터치 입력을 쓰는 폰·태블릿인가.
    //   iPadOS 데스크톱 모드 Safari 는 pointer:fine 을 보고하므로
    //   platform 이 Mac 계열인데 maxTouchPoints>1 인 경우도 태블릿으로 본다.
    //   (Windows 터치 노트북 — platform Win32 + pointer:fine — 은 제외: 데스크톱 취급)
    function sdyPenDevice(){
        try{
            const tp=navigator.maxTouchPoints||0;
            if(!tp) return false;
            const plat=String(navigator.platform||'');
            const ipadOS=/Mac/.test(plat)&&tp>1;
            return !!(window.matchMedia&&matchMedia('(pointer:coarse)').matches)||ipadOS;
        }catch(e){ return false; }
    }

    // ── ① 자동 손바닥 거부 ─────────────────────────────────────
    let _palmPenDown=false;       // 펜 포인터가 지금 화면에 닿아 있는가
    let _palmLastPenAt=0;         // 마지막 펜 이벤트 시각 (호버 포함)
    function _sdyPalmNow(){ return _palmPenDown||(Date.now()-_palmLastPenAt<320); }
    function _palmTrack(e){
        if(e.pointerType!=='pen') return;
        if(e.type==='pointerdown'){ _palmPenDown=true; }
        else if(e.type==='pointerup'||e.type==='pointercancel'){ _palmPenDown=false; }
        _palmLastPenAt=Date.now();
    }
    // window 캡처 = document 캡처(그리기 위임)보다 먼저 돈다. 여기가 최전방 게이트.
    window.addEventListener('pointerdown',_palmTrack,{capture:true,passive:true});
    window.addEventListener('pointermove',_palmTrack,{capture:true,passive:true});
    window.addEventListener('pointerup',_palmTrack,{capture:true,passive:true});
    window.addEventListener('pointercancel',_palmTrack,{capture:true,passive:true});

    function _palmInEditor(t){
        return !!(t&&t.closest&&t.closest('#editorBody'));
    }
    // 펜이 쓰는 동안의 손바닥/손가락 터치 — 에디터 본문에서는 이벤트 자체를 묻는다.
    function _palmGateTouch(e){
        if(!_sdyPalmNow()) return;
        if(!_palmInEditor(e.target)) return;
        try{ e.preventDefault(); }catch(err){}      // 스크롤·브라우저 제스처 차단
        e.stopPropagation();                        // 아래 계층(그리기·핀치·선택) 차단
    }
    function _palmGatePointer(e){
        if(e.pointerType!=='touch') return;
        if(!_sdyPalmNow()) return;
        if(!_palmInEditor(e.target)) return;
        e.stopPropagation();                        // pointerdown→drawStart 경로 차단
    }
    window.addEventListener('touchstart',_palmGateTouch,{capture:true,passive:false});
    window.addEventListener('touchmove',_palmGateTouch,{capture:true,passive:false});
    window.addEventListener('pointerdown',_palmGatePointer,{capture:true,passive:true});
    window.addEventListener('pointermove',_palmGatePointer,{capture:true,passive:true});

    // drawStart(10b-pen.js)가 호출하는 공용 판정 — 펜 입력·마우스는 항상 통과.
    function _sdyPalmIgnore(e){
        if(!e) return false;
        const isTouch=(e.pointerType==='touch')||(typeof e.type==='string'&&e.type.indexOf('touch')===0);
        if(!isTouch) return false;
        if(_sdyPalmNow()) return true;                       // 자동 손바닥 거부
        if(_palmStrictOn) return true;                       // ② 연필 모드: 손가락은 그리지 않는다
        return false;
    }

    // ── ② 손바닥 차단(연필 모드) 토글 ──────────────────────────
    let _palmStrictOn=false;
    try{ _palmStrictOn=localStorage.getItem('sdy_palm_strict')==='1'; }catch(e){}
    function _palmStrictApply(){
        try{ document.body.classList.toggle('palm-strict',!!_palmStrictOn); }catch(e){}
        const b=document.getElementById('palmBtn');
        if(b){
            b.classList.toggle('active',!!_palmStrictOn);
            b.setAttribute('aria-pressed',_palmStrictOn?'true':'false');
        }
    }
    function togglePalmStrict(){
        _palmStrictOn=!_palmStrictOn;
        try{ localStorage.setItem('sdy_palm_strict',_palmStrictOn?'1':'0'); }catch(e){}
        _palmStrictApply();
        toast(_palmStrictOn
            ? '손바닥 차단 켬 · 펜으로만 그려지고 손가락은 화면을 옮깁니다'
            : '손바닥 차단 끔 · 손가락으로도 그릴 수 있습니다',1600);
    }
    // 그리기 도구막대에 버튼 주입 — 터치 기기(폰·태블릿)에서만. 데스크톱은 그대로.
    // startDrawMode(10b)가 막대를 열 때마다(멱등) 부른다.
    function sdyPenBarReady(){
        try{
            const bar=document.getElementById('drawToolbar');
            if(!bar){ return; }
            if(document.getElementById('palmBtn')){ _palmStrictApply(); return; }
            if(!sdyPenDevice()){ return; }
            const sep=document.createElement('div');
            sep.className='tool-sep';
            const b=document.createElement('button');
            b.id='palmBtn'; b.type='button'; b.className='tool-btn palm-btn';
            b.title='손바닥 차단 · 펜(Apple Pencil 등)으로 쓸 때 손바닥/손가락 입력 무시 (손가락은 화면 이동만)';
            b.setAttribute('aria-label','손바닥 차단 켜기/끄기');
            b.innerHTML='<i class="ri-hand-coin-line"></i>';
            b.addEventListener('click',e=>{ e.stopPropagation(); togglePalmStrict(); });
            bar.appendChild(sep);
            bar.appendChild(b);
            _palmStrictApply();
        }catch(e){}
    }
    try{ sdyPenBarReady(); _palmStrictApply(); }catch(e){}

    // ── ③ 빈 곳 더블탭 + 끌기 → 영역 선택 ──────────────────────
    // 한 손가락 끌기는 화면 이동(네이티브 스크롤)에 양보한다. 예전에는 빈 종이를
    // 누르는 순간 pointerdown 이 marquee 를 시작해서 스크롤과 선택이 싸웠다.
    // 이제 선택은 '빈 곳을 더블탭한 뒤 두 번째 탭에서 끄는' 제스처 하나로만 한다.
    (function(){
        // 요소(글상자·이미지·획·표·손잡이…) 위에서는 이 제스처를 쓰지 않는다
        const SKIP='.tb,.paper-img,.stroke-g,.pin,.tbl-box,.tbl-edge,.tbl-div,.tbl-h,.tbl-stretch,'
                  +'.handle,.el-del,.tb-move,.add-page-zone,.page-label,.marquee,button,a,input,textarea';
        let lastTap=null;      // 마지막 '빈 종이 탭' {t,x,y}
        let g=null;            // 진행 중인 더블탭-드래그 제스처

        function modeBusy(){
            // 배치/글상자/메모 모드에서는 탭이 '놓기' 동작이라 제스처를 켜지 않는다
            try{ return !!(penActive||textToolActive||pinMode||placeMode||tablePlace); }catch(e){ return true; }
        }

        window.addEventListener('touchstart',e=>{
            g=null;
            if(!e.touches||e.touches.length!==1){ lastTap=null; return; }
            const t=e.touches[0], el=e.target;
            if(!(el&&el.closest)) return;
            if(!_palmInEditor(el)) return;
            if(_sdyPalmNow()) return;
            const paper=el.closest('#pagesStage .paper');
            if(!paper||el.closest(SKIP)){ lastTap=null; return; }
            if(modeBusy()) return;
            const now=Date.now(), x=t.clientX, y=t.clientY;
            if(lastTap&&now-lastTap.t<380&&Math.hypot(x-lastTap.x,y-lastTap.y)<40){
                g={pi:+paper.dataset.pageIdx, x0:x, y0:y, lx:x, ly:y, on:false, dead:false};
                lastTap=null;
            }else{
                lastTap={t:now,x:x,y:y};
            }
        },{capture:true,passive:true});

        window.addEventListener('touchmove',e=>{
            if(!g||g.dead) return;
            if(_sdyPalmNow()){ g.dead=true; return; }
            if(!e.touches||e.touches.length!==1){ g.dead=true; return; }
            const t=e.touches[0];
            g.lx=t.clientX; g.ly=t.clientY;
            if(!g.on){
                // 더블탭 직후의 미세한 스크롤 시도를 먼저 눌러야 브라우저가
                // 제스처를 가져가지 않는다(가져가면 pointercancel → 선택 불가).
                if(e.cancelable===false){ g.dead=true; return; }   // 이미 스크롤에 넘어감
                try{ e.preventDefault(); }catch(err){}
                if(Math.hypot(t.clientX-g.x0,t.clientY-g.y0)<9) return;  // 아직은 '탭'으로 둔다
                try{ activatePage(g.pi); }catch(err){}             // 미리보기 쪽이면 깨운다
                try{ startMarquee({clientX:g.x0,clientY:g.y0},g.pi); }catch(err){ g.dead=true; return; }
                g.on=true;
                window._sdyDblDragAt=Date.now();                   // 더블탭 줌 토글 억제용
            }else{
                if(e.cancelable===false){ try{ endMarquee(); }catch(err){} g.on=false; g.dead=true; return; }
                try{ e.preventDefault(); }catch(err){}
                try{ updateMarquee({clientX:t.clientX,clientY:t.clientY}); }catch(err){}
            }
        },{capture:true,passive:false});

        function finish(cancel){
            const ges=g; g=null;
            if(!ges||!ges.on) return;
            // 쪽이 늦게 깨어난(무거운 문서) 경우를 위해 마지막 좌표로 한 번 더 훑는다.
            const done=()=>{
                try{
                    if(cancel){ clearMulti(); }
                    else{ updateMarquee({clientX:ges.lx,clientY:ges.ly}); }
                }catch(err){}
                try{ endMarquee(); }catch(err){}
            };
            let pr=null;
            try{ pr=activatePage(ges.pi); }catch(err){}
            if(pr&&typeof pr.then==='function') pr.then(done,done);
            else done();
        }
        window.addEventListener('touchend',()=>finish(false),{capture:true,passive:true});
        window.addEventListener('touchcancel',()=>finish(true),{capture:true,passive:true});
    })();

    // ── ④ 누르고 '떼야' 선택 — 스크롤·핀치 중에 글상자가 덥석 잡히지 않게 ──
    // 14.69 · 폰에서 화면을 스크롤/핀치하다가 손가락이 글상자 위를 지나가면
    //   예전엔 pointerdown 순간에 선택(손잡이·작업판까지)이 붙었다. 그 때문에
    //   종이 위에 손가락을 얹는 것만으로도 조작이 엉켰다.
    //   이제 터치에서는 '선택'을 손가락을 뗄 때까지 미룬다:
    //     · 누르는 동안은 아무것도 선택하지 않는다 → 스크롤·핀치는 방해받지 않는다
    //     · 손가락이 12px 이상 움직이거나(스크롤) 두 번째 손가락이 닿으면(핀치) 취소
    //     · 그대로 떼면 그때 onPaperDown 을 다시 돌려 선택을 확정한다
    //   끌기/리사이즈 손잡이·편집 중인 상자·표 조작점은 즉시 처리(끌기가 살아야 한다).
    //   마우스·펜(데스크톱)은 e.pointerType 이 달라 이 게이트를 아예 타지 않는다.
    let _tapSel=null;          // 미뤄 둔 선택 {e,pi,x,y,touch}
    let _tapSelReplay=false;   // 손 뗀 뒤 확정 실행 중 (재귀 방지)
    let _tapSelMulti=false;    // 두 손가락 이상 제스처(핀치) 중
    let _touchActive=false;    // 지금 제스처에 touch 이벤트가 실제로 흐르는가
    const _TAP_SLOP=12;        // 이만큼 움직이면 '탭'이 아니라 스크롤로 본다

    function _sdyTapHoldSelect(e,pageIdx){
        if(_tapSelReplay) return false;                       // 확정 실행 중 — 그대로 진행한다
        if(!e||e.pointerType!=='touch') return false;         // 마우스·펜(데스크톱)은 즉시 선택
        // 배치/붙이기 모드에서의 탭은 '놓기' 동작이라 미루지 않는다
        try{ if(textToolActive||pinMode||placeMode||tablePlace) return false; }catch(err){ return false; }
        if(_tapSelMulti) return true;                         // 핀치 중 — 아무것도 선택하지 않는다
        if(_sdyPalmNow()) return false;                       // 손바닥 거부 중이면 _palmGate 가 이미 막는다
        const t=e.target;
        if(!t||!t.closest||!_palmInEditor(t)) return false;
        // 잡아서 끄는 손잡이·표 조작점·편집 중인 상자(캐럿)는 즉시 — 끌기가 살아 있어야 한다
        if(t.closest('.handle,.tb-edge,.tb-move,.el-del,.tbl-box,.tbl-edge,.tbl-div,.tbl-h,.tbl-stretch')) return false;
        const host=t.closest('.tb')||t.closest('.paper-img')||t.closest('.stroke-g')||t.closest('.latex-box');
        if(!host) return false;                               // 빈 종이 — 기존 경로(스크롤 우선) 그대로
        if(host.classList.contains('edit')) return false;     // 글자 편집 중 캐럿은 즉시
        // 이미 선택된 요소: '글자 위 탭 = 편집 진입'만 미룬다.
        //   나머지는 그 자리에서 끌기(이동)가 시작되므로 즉시 처리해야 한다.
        try{
            const already=host.classList.contains('sel')||host.classList.contains('msel')
                ||(typeof multiSel!=='undefined'&&multiSel.some(m=>m.id===host.dataset.id));
            if(already&&!(host.classList.contains('tb')&&t.closest('.tb-content'))) return false;
        }catch(err){}
        _tapSel={e:e,pi:pageIdx,x:e.clientX,y:e.clientY,touch:_touchActive};
        return true;                                          // 선택은 손 뗄 때로 미룬다
    }

    function _tapSelDrop(){ _tapSel=null; }
    function _tapSelMove(e){
        if(!_tapSel) return;
        if(!e.touches||e.touches.length!==1){ _tapSel=null; return; }      // 두 번째 손가락 = 핀치
        const t=e.touches[0];
        if(Math.hypot(t.clientX-_tapSel.x,t.clientY-_tapSel.y)>_TAP_SLOP) _tapSel=null;  // 스크롤
    }
    function _tapSelCommit(){
        const j=_tapSel; _tapSel=null;
        if(!j) return;
        if(_sdyPalmNow()) return;
        if(!j.e.target||j.e.target.isConnected===false) return;   // 그 사이 쪽이 다시 그려졌다
        _tapSelReplay=true;
        try{
            onPaperDown(j.e,j.pi);                            // 지금 확정 — 1탭 = 선택, 2탭 = 편집
            // 상자를 눌러 '끌기 준비'까지 생긴 경우(상자 몸통 탭) 여기서 정리한다.
            // 진짜 pointerup 은 이미 지나갔으므로 그대로 두면 다음 탭까지 끌기가 남는다.
            try{ if(typeof finishEditorPointer==='function') finishEditorPointer(); }catch(err){}
        }catch(err){}
        _tapSelReplay=false;
    }
    function _tapSelUp(e){
        if(e&&e.touches&&e.touches.length) return;            // 아직 손가락이 남아 있다
        _tapSelMulti=false; _touchActive=false;
        _tapSelCommit();
    }
    window.addEventListener('touchstart',e=>{
        _touchActive=true;
        if(e.touches&&e.touches.length>1){ _tapSel=null; _tapSelMulti=true; }
    },{capture:true,passive:true});
    window.addEventListener('touchmove',_tapSelMove,{capture:true,passive:true});
    window.addEventListener('touchend',_tapSelUp,{capture:true,passive:true});
    window.addEventListener('touchcancel',e=>{
        _tapSel=null;
        if(!e||!e.touches||!e.touches.length){ _tapSelMulti=false; _touchActive=false; }
    },{capture:true,passive:true});
    // 브라우저가 제스처(스크롤·핀치)를 가져갔다는 확정 신호
    window.addEventListener('pointercancel',e=>{ if(!e||e.pointerType==='touch') _tapSel=null; },{capture:true,passive:true});
    // touchend 가 아예 오지 않는 포인터 — 읽기 쪽(미리보기)을 탭하면 pointerdown 은
    // 쪽 준비로 넘어가고, 준비가 끝난 뒤 pointerdown+pointerup 만 '재생'된다
    // (06b-read-layer._replayPagePointer). 그때는 pointerup 에서 확정한다.
    // 실제 터치(touchstart 가 흐른 제스처)는 위에서 본 대로 touchend 가 맡는다.
    window.addEventListener('pointerup',e=>{
        if(!e||e.pointerType!=='touch'||_touchActive) return;
        if(_tapSel&&!_tapSel.touch) _tapSelCommit();
    },{capture:true,passive:true});

/* APP-PART:10c-mobile-touch.js:END */
