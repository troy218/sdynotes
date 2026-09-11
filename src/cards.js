/* 암기 카드 — sdynotes.js 에서 분리
   의존: window.toast · window.esc · window.fallbackCopyText · window.closeCtxMenu(optional)
         window.sdyViewportBox · window.sdyClampFloatingRect · window.sdyUiCss · window.pushSettings
   HTML onclick / live-updates 는 window.openCards · window.loadDecks 등으로 연결한다. */
(function(){
  if(window.__sdyCardsInit) return; window.__sdyCardsInit=true;
  if(typeof window.toast!=='function'){
    window.toast=function(m,ms){ try{ var t=document.getElementById('toast'); if(!t) return;
      t.textContent=m; t.classList.add('show');
      setTimeout(function(){ if(t.isConnected) t.classList.remove('show'); }, ms||2000); }catch(e){} };
  }
  if(typeof window.esc!=='function'){
    window.esc=function(s){ var d=document.createElement('div'); d.textContent=s==null?'':s; return d.innerHTML; };
  }
  if(typeof window.fallbackCopyText!=='function'){
    window.fallbackCopyText=function(t){ try{ var ta=document.createElement('textarea'); ta.value=t;
      ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); }catch(e){} };
  }

// ===== 암기 카드 =====
// 엑셀을 올리면 카드가 되고, 틀린 카드는 자주·맞힌 카드는 뜸하게 다시 나온다.
const CARD_PROMPT = `너는 학습용 객관식 문제 제작 도우미야. 아래 [사용자 요청]과 [본문]을 읽고 코드 블록 하나만 출력해.

#DECK 묶음이름
M [보통] 질문 | 오답 보기 1 | 정답 보기* | 오답 보기 2 | 오답 보기 3 || 정답이 왜 정답인지 1~2문장. ① 오답 보기 1 — 이 보기가 왜 틀렸는지 한 문장. ② 정답 보기 — 이 보기가 왜 맞는지 한 문장. ③ 오답 보기 2 — 이 보기가 왜 틀렸는지 한 문장. ④ 오답 보기 3 — 이 보기가 왜 틀렸는지 한 문장. #태그

규칙:
- 모든 문제는 반드시 M 객관식 형식으로만 만든다. C 주관식은 만들지 않는다.
- 정답 보기 하나의 앞이나 뒤에 별표(*)를 붙인다.
- 모든 문제에 || 뒤 해설을 반드시 붙이고, 해설은 두 부분으로 쓴다.
  1) 먼저 정답이 왜 정답인지 1~2문장으로 설명한다.
  2) 이어서 ①②③④ 번호를 붙여 정답 보기를 포함한 '모든 보기'마다 개별 해설을 하나씩 쓴다.
 · 보기가 몇 개든 보기 수만큼 번호 항목이 있어야 하고, 하나도 빠지면 안 된다.
 · 각 항목에는 그 보기가 왜 맞거나(정답) 틀렸는지(오답) 한 문장 이상 근거를 쓴다.
 · ①부터의 번호 순서는 | 로 나열한 보기 순서와 같게 맞춘다.
- ①②③④ 기호는 예시와 같은 원문자를 그대로 쓰고, 해설 안에서 줄을 바꾸지 않는다 (문제 한 줄 유지).
- 질문 앞에 [쉬움], [보통], [어려움] 중 하나를 표시한다.
- 사용자가 문제 개수, 난이도, 범위·단원, 보기 개수, 출제 방식 등을 말하면 그 요청을 최우선으로 정확히 따른다.
- 사용자가 개수를 말하지 않으면 본문 분량에 맞춰 10~20문제를 만든다.
- 한 문제에는 한 가지 개념만 묻고 정답은 하나만 가능해야 한다.
- 오답은 그럴듯하지만 명확히 틀리게 만들고, 본문에 없는 사실은 만들지 않는다.
- 한 줄에 문제 하나만 출력한다.

[사용자 요청]
(예: 15문제, 어려움 위주, 2단원만, 보기 5개)

[본문]
(여기에 외울 내용을 붙여넣으세요)
`;

let _deckCur=null, _queue=[], _qi=0, _flipped=false, _studied=0, _streak=0;
let _studySession='', _cardShownAt=0, _pendingAnswer=null;
const CARD_GRADE_OUT='sdy_card_grade_outbox_8_17';
function cardOutLoad(){ try{ return JSON.parse(localStorage.getItem(CARD_GRADE_OUT)||'{}'); }catch(e){ return {}; } }
let _cardOut=cardOutLoad(), _cardFlush=false;
function cardOutSave(){ try{ localStorage.setItem(CARD_GRADE_OUT,JSON.stringify(_cardOut)); }catch(e){} }
async function flushCardGrades(){
    if(_cardFlush||!navigator.onLine) return;
    _cardFlush=true;
    try{
        for(const ev of Object.keys(_cardOut)){
            const payload=_cardOut[ev]; if(!payload) continue;
            try{
                const r=await fetch('/api/cards/grade',{method:'POST',headers:{'Content-Type':'application/json'},
                    body:JSON.stringify(payload)});
                const d=await r.json().catch(()=>({}));
                if(r.ok&&d.ok){
                    delete _cardOut[ev]; cardOutSave();
                    if(_deckCur&&_deckCur.id===payload.deck&&d.card){
                        const c=_deckCur.cards.find(x=>x.id===payload.card); if(c) Object.assign(c,d.card);
                    }
                }else if(r.status===400||r.status===404){
                    delete _cardOut[ev]; cardOutSave();
                }
            }catch(e){}
        }
    }finally{ _cardFlush=false; }
}
function queueCardGrade(c,g,selected){
    if(!_deckCur||!c) return null;
    const event='cg_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
    const payload={event,deck:_deckCur.id,card:c.id,grade:g,selected,
        response_ms:Math.max(0,Date.now()-(_cardShownAt||Date.now())),session:_studySession};
    _cardOut[event]=payload;
    const ks=Object.keys(_cardOut); if(ks.length>1200) ks.slice(0,ks.length-1200).forEach(k=>delete _cardOut[k]);
    cardOutSave();
    flushCardGrades();
    return payload;
}
setInterval(()=>{ if(Object.keys(_cardOut).length) flushCardGrades(); },12000);
window.addEventListener('online',flushCardGrades);
window.addEventListener('pagehide',()=>{
    cardOutSave();
    try{
        const first=Object.values(_cardOut)[0];
        if(first&&navigator.sendBeacon){
            navigator.sendBeacon('/api/cards/grade',new Blob([JSON.stringify(first)],{type:'application/json'}));
        }
    }catch(e){}
});

function openCards(){
    // 다른 떠 있는 창은 닫고 연다 (겹쳐 보이지 않게)
    try{ document.getElementById('srvPop').classList.remove('show'); }catch(e){}
    try{ document.getElementById('notifPop').classList.remove('show'); }catch(e){}
    try{ if(window.closeCtxMenu) window.closeCtxMenu(); }catch(e){}
    try{ if(typeof sdyMusic!=='undefined'&&sdyMusic.small){} }catch(e){}
    const win=document.querySelector('#cardsModal .fcard-win');
    document.getElementById('cardsModal').style.display='flex';
    win.classList.remove('closing');
    _fcardPlace(win);                     // 10.7 · 위치 복원
    // 15.0 · 확장 상태는 기억한다 — 닫았다 다시 열어도 그대로 확장된 모양
    win.classList.toggle('fcard-max',_fcardMax);
    if(_fcardMax) win.style.height='';
    _fcardMaxIcon();
    flushCardGrades();
    showCardsHome();
    loadDecks();
}
// ── 10.7 · 플로팅 창: 위치·크기 저장/복원 + 드래그 + 리사이즈 ──
let _fcardDrag=null, _fcardRs=null;
function _fcardPlace(win){
    // 10.8 · 완전 플로팅: 저장된 위치로. 없으면 화면 가운데.
    //   첫 위치는 CSS 의 left:50%/top:7% 에 기대지 않고 공용 실측으로 잡는다 —
    //   배율/브라우저/디바이스가 달라도 항상 화면(뷰포트) 중심이 된다.
    let p=null;
    try{ p=JSON.parse(localStorage.getItem('fcard_pos')||'null'); }catch(e){}
    const hasSaved=!!(p&&isFinite(p.x)&&isFinite(p.y));
    win.classList.add('moved');
    win.style.position='fixed'; win.style.margin='0';
    let x,y;
    if(hasSaved){ x=p.x; y=p.y; }
    else{
        const vp=window.sdyViewportBox();
        const w=parseFloat(win.style.width)||win.offsetWidth||Math.min(760,Math.max(280,(vp.w||innerWidth||1024)-16));
        const h=parseFloat(win.style.height)||win.offsetHeight||Math.min(640,Math.max(240,(vp.h||innerHeight||768)-16));
        x=Math.round((vp.w-w)/2);
        y=Math.round((vp.h-h)/2);
    }
    const c=window.sdyClampFloatingRect(win,x,y);
    win.style.left=c.x+'px'; win.style.top=c.y+'px';
}
(function(){
    const head=document.getElementById('fcardHead');
    const win=document.querySelector('#cardsModal .fcard-win');
    if(!head||!win) return;
    head.addEventListener('pointerdown',e=>{
        if(e.target.closest('button')) return;
        if(_fcardMax) return;          // 15.0 · 확장 중에는 드래그하지 않는다 (음악플레이어 전체화면과 동일)
        const r=win.getBoundingClientRect();
        const lx=window.sdyUiCss(r.left), ly=window.sdyUiCss(r.top);
        win.classList.add('moved');
        win.style.position='fixed'; win.style.margin='0';
        win.style.left=lx+'px'; win.style.top=ly+'px';
        _fcardDrag={sx:e.clientX,sy:e.clientY,ox:lx,oy:ly};
        try{ head.setPointerCapture(e.pointerId); }catch(err){}
    });
    head.addEventListener('pointermove',e=>{
        if(!_fcardDrag) return;
        const dx=window.sdyUiCss(e.clientX-_fcardDrag.sx), dy=window.sdyUiCss(e.clientY-_fcardDrag.sy);
        const c=window.sdyClampFloatingRect(win,_fcardDrag.ox+dx,_fcardDrag.oy+dy);
        win.style.left=c.x+'px'; win.style.top=c.y+'px';
    });
    const endD=()=>{ if(!_fcardDrag) return; _fcardDrag=null;
        try{ localStorage.setItem('fcard_pos',JSON.stringify(
            {x:parseFloat(win.style.left),y:parseFloat(win.style.top)})); }catch(e){}
        try{ if(window.pushSettings) window.pushSettings(); }catch(e){} };
    head.addEventListener('pointerup',endD); head.addEventListener('pointercancel',endD);
    addEventListener('resize',()=>{
        if(document.getElementById('cardsModal').style.display!=='flex') return;
        if(_fcardMax) return;          // 15.0 · 확장 중에는 뷰포트 단위 css 가 스스로 맞춘다
        /* rect 는 화면 px, style.left 는 UI CSS px — 그냥 넣으면 창이 왼쪽으로
           배율만큼 밀려나고 그 만큼 오른쪽이 좁아진다. 반드시 환산해서 넘긴다. */
        const r=win.getBoundingClientRect(),
              c=window.sdyClampFloatingRect(win,window.sdyUiCss(r.left),window.sdyUiCss(r.top));
        win.classList.add('moved'); win.style.left=c.x+'px'; win.style.top=c.y+'px';
    },{passive:true});
})();
// ── 15.0 · 확장 모드: 브라우저 전체화면이 아니라 '사이트 안에서만' 창이 화면 가득 커진다 ──
//   공부 중 다른 탭을 왔다 갔다 하는 흐름을 깨지 않기 위해 Fullscreen API 는 쓰지 않는다.
//   모양·동작은 음악플레이어 전체화면(16.0)과 같은 규칙: 같은 아이콘(ri-fullscreen-line),
//   같은 모핑 전환(창→가득), 같은 '돌아올 자리 기억' 방식. Esc 로 한 단계씩 빠져나온다.
//   (드래그 IIFE 의 pointerdown/resize 가 _fcardMax 를 참조하지만, 실행은 이벤트 시점이라
//    이 위치 선언과 TDZ 가 충돌하지 않는다 — 스크립트 평가가 끝난 뒤에만 발사되므로.)
let _fcardMax=false, _fcardMaxPre=null, _fcardPreH=null, _fcardAnimT=null;
function _fcardWinEl(){ return document.querySelector('#cardsModal .fcard-win'); }
function fcardIsMax(){ return _fcardMax; }
function _fcardMaxIcon(){
    const b=document.getElementById('fcardMaxBtn'); if(!b) return;
    b.innerHTML=_fcardMax?'<i class="ri-fullscreen-exit-line"></i>':'<i class="ri-fullscreen-line"></i>';
    b.title=_fcardMax?'원래 크기로 (F · Esc)':'사이트 안에서 크게 보기 (F)';
}
// 15.0 · 확장 틀의 크기를 '실측 뷰포트'로 직접 잰다.
//   예전엔 CSS 의 100vw/100dvh 에 기대서 배율·스크롤바·브라우저마다 오른쪽/아래가
//   잘리거나 못 가는 영역이 남았다. 14.13.8 '창 이동범위' 업데이트의 같은 자
//   (sdyViewportBox · 창과 동일한 UI CSS px) 로 재므로 모니터에 정확히 꽉 찬다.
function _fcardMaxFill(){
    const win=_fcardWinEl(); if(!win) return;
    try{
        const vp=window.sdyViewportBox?window.sdyViewportBox():null;
        if(vp&&vp.w>0&&vp.h>0){
            win.style.setProperty('--fcard-max-w',Math.round(vp.w)+'px');
            win.style.setProperty('--fcard-max-h',Math.round(vp.h)+'px');
        }
    }catch(e){}
}
// 확장 중 창 크기가 바뀌면(모니터 변경·회전·배율) 틀을 다시 잰다
addEventListener('resize',()=>{ if(_fcardMax) _fcardMaxFill(); },{passive:true});
function _fcardAnimKick(){            // 모핑 transition 은 켜질/꺼질 때만 잠깐 붙인다 (드래그 간섭 방지)
    const win=_fcardWinEl(); if(!win) return;
    win.classList.add('fcard-anim');
    clearTimeout(_fcardAnimT);
    _fcardAnimT=setTimeout(()=>win.classList.remove('fcard-anim'),560);
}
function fcardMaxSet(on){
    const win=_fcardWinEl(); if(!win) return;
    on=!!on;
    if(on===_fcardMax) return;
    const modal=document.getElementById('cardsModal');
    if(on&&(!modal||modal.style.display!=='flex')) return;   // 창이 열어 있을 때만
    _fcardMax=on;
    _fcardAnimKick();
    if(on){
        // 돌아올 자리·원래 높이를 기억한다 (음악플레이어 mpbFakeFs 와 같은 순서).
        //   위치는 인라인 style 을 우선 쓴다 — rect 가 없는 환경(테스트)에서도 안전하다.
        const lx=parseFloat(win.style.left), ly=parseFloat(win.style.top);
        if(isFinite(lx)&&isFinite(ly)) _fcardMaxPre={x:lx,y:ly};
        else{ try{ const r=win.getBoundingClientRect();
            _fcardMaxPre={x:window.sdyUiCss(r.left),y:window.sdyUiCss(r.top)}; }catch(e){ _fcardMaxPre=null; } }
        const hpx=Math.round(win.offsetHeight||0)||Math.round((win.getBoundingClientRect&&win.getBoundingClientRect().height)||0);
        if(hpx>0) win.style.height=hpx+'px';          // 높이가 auto 라 모핑이 끊기지 않게 고정
        _fcardPreH=Math.round(win.offsetHeight||0)||null;
        // 실측 뷰포트 크기로 목표 지점을 미리 잡아 둔다 (창 이동범위의 자와 같은 좌표계)
        _fcardMaxFill();
        // 클래스 css(뷰포트 단위)가 인라인 크기를 덮으므로 한 박자 늦게 붙여
        // 현재 창 자리에서 화면 가득 자라나는 모핑이 보이게 한다
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
            if(!_fcardMax) return;    // 누르자마자 다시 접은 경합은 무시
            _fcardMaxFill();
            win.classList.add('fcard-max');
            setTimeout(()=>{ if(win.classList.contains('fcard-max')) win.style.height=''; },540);
        }));
    }else{
        const hpx=Math.round(win.offsetHeight||0);
        if(hpx>0) win.style.height=hpx+'px';
        const p=_fcardMaxPre; _fcardMaxPre=null;
        win.classList.remove('fcard-max');
        // 원래 자리로 되돌린다. 클램프(화면 안 잡아두기)는 모핑(0.52s)이
        // 끝난 뒤에만 실행한다 — 모핑 중엔 창이 아직 100vw 라 clamp 가
        // 위치를 (0,0)으로 꽂아 버린다(음악 플레이어 복귀 버그와 동일한 원인).
        if(p){ win.style.left=Math.round(p.x)+'px'; win.style.top=Math.round(p.y)+'px'; }
        if(_fcardPreH){ win.style.height=_fcardPreH+'px'; _fcardPreH=null; }
        setTimeout(()=>{
            if(_fcardMax) return;     // 접자마자 다시 펼친 경합은 무시
            if(p){ win.style.left=Math.round(p.x)+'px'; win.style.top=Math.round(p.y)+'px'; }
            try{ const c=window.sdyClampFloatingRect(win,parseFloat(win.style.left)||8,parseFloat(win.style.top)||8);
                 win.style.left=c.x+'px'; win.style.top=c.y+'px'; }catch(e){}
            if(!win.classList.contains('fcard-max')) win.style.height='';
            // 확정된 자리를 저장해 드래그·리사이즈와 같은 자리를 쓴다
            try{ localStorage.setItem('fcard_pos',JSON.stringify(
                {x:parseFloat(win.style.left),y:parseFloat(win.style.top)})); }catch(e){}
            try{ if(window.pushSettings) window.pushSettings(); }catch(e){}
        },560);
    }
    _fcardMaxIcon();
}
function fcardToggleMax(e){ if(e&&e.stopPropagation) e.stopPropagation(); fcardMaxSet(!_fcardMax); }
// ── 15.0 · 세션 칩: 이번 공부의 정답 수·정답률·경과 시간 (확장 모드 머리말 오른쪽) ──
let _cdSessT=null, _cdSessT0=0;
function _cdSessFmt(ms){ const s=Math.max(0,Math.round(ms/1000));
    return ((s/60)|0)+':'+(s%60<10?'0':'')+(s%60); }
function _cdSessPaint(){
    const tEl=document.getElementById('cdSessTime');
    if(tEl) tEl.innerHTML='<i class="ri-time-line"></i>'+_cdSessFmt(Date.now()-_cdSessT0);
    const aEl=document.getElementById('cdSessAcc'); if(!aEl) return;
    if(_isTest) aEl.innerHTML='<i class="ri-edit-line"></i>제출 '+_studied+'문항';        // 시험 중 정오를 알려 주면 안 된다
    else if(_mode==='match') aEl.innerHTML='<i class="ri-drag-drop-line"></i>'+_studied+'쌍 완성';
    else aEl.innerHTML='<i class="ri-checkbox-circle-line"></i>'+
        (_studied? ('정답 '+_rightN+'/'+_studied+' · '+Math.round(_rightN/_studied*100)+'%') : '이제 막 시작');
}
function _cdSessStart(){
    _cdSessT0=Date.now(); _cdSessPaint();
    clearInterval(_cdSessT);
    _cdSessT=setInterval(()=>{
        const st=document.getElementById('cardsStudy'), m=document.getElementById('cardsModal');
        if(!st||st.style.display==='none'||!m||m.style.display!=='flex'){
            clearInterval(_cdSessT); _cdSessT=null; return; }
        _cdSessPaint();
    },1000);
}
function _fcardTitle(t){ const el=document.getElementById('fcardTitle'); if(el) el.textContent=t; }
function closeCards(){
    // 9.1 · 창을 닫아도 대기 중인 답을 먼저 저장하고 나간다
    try{ if(_pendingAnswer){ const p=_pendingAnswer; _pendingAnswer=null;
          queueCardGrade(p.card,p.grade,null); } }catch(e){}
    // 10.8 · 닫힘 애니메이션 후 실제로 숨긴다
    const win=document.querySelector('#cardsModal .fcard-win');
    if(win) win.style.height='';      // 15.0 · 확장 모핑용 고정 높이는 다음 열기 전에 지운다
    const hide=()=>{ document.getElementById('cardsModal').style.display='none';
                     flushCardGrades(); };
    if(win&&!win.classList.contains('closing')){
        win.classList.add('closing');
        setTimeout(()=>{ win.classList.remove('closing'); hide(); },240);
    } else hide();
    _deckCur=null; _queue=[]; _qi=0; _pendingAnswer=null;
    _isTest=false; _answered=false;
    const tp=document.getElementById('cdTestPick'); if(tp) tp.classList.remove('show');
}
// 바깥 공간을 누르면 닫힌다 (음악플레이어의 확장창과 동일한 관례)
document.addEventListener('pointerdown',e=>{
    const modal=document.getElementById('cardsModal');
    if(!modal||modal.style.display==='none'||!modal.style.display) return;
    if(_fcardMax) return;              // 15.0 · 확장 중 바깥 좁은 틈을 눌러도 닫지 않는다 (Esc·버튼으로만)
    if(e.target.closest('#cardsModal')) return;
    // 11.1 · 카드 창이 띄운 작은 메뉴·토스트를 눌렀는데 창이 닫히던 문제
    if(e.target.closest('#plMiniMenu')||e.target.closest('.toast')) return;
    closeCards();
},true);
// 11.1 · 화면 전환은 한 곳에서 — 두 화면이 겹쳐 보이던 문제를 없앤다
const CARD_PANES=['cardsHome','cardsPaste','cardsStudy','cardsStats','cardsAnalytics','cardsBrowse'];
function showPane(id){
    CARD_PANES.forEach(p=>{ const el=document.getElementById(p);
        if(el) el.style.display=(p===id)?'':'none'; });
    const win=document.querySelector('#cardsModal .fcard-win');
    if(win) win.scrollTop=0;
}
function showCardsHome(){
    _fcardTitle('암기 카드');
    showPane('cardsHome');
}
// ── 글자 붙여넣기로 카드 만들기 ─────────────────────
function openPasteBox(){
    showPane('cardsPaste');
    _fcardTitle('텍스트로 카드 만들기');
    const ta=document.getElementById('cdPasteText');
    ta.value=''; document.getElementById('cdDeckName').value='';
    document.getElementById('cdPasteInfo').textContent='';
    document.getElementById('cdPasteInfo').className='cd-pinfo';
    setTimeout(()=>ta.focus(),80);
}
async function pasteFromClipboard(){
    try{
        const t=await navigator.clipboard.readText();
        if(!t||!t.trim()){ window.toast('클립보드가 비어 있습니다',1800); return; }
        document.getElementById('cdPasteText').value=t;
        previewCards();
    }catch(e){ window.toast('붙여넣기 권한이 없습니다 · Ctrl+V 로 넣어 주세요',2600); }
}
// 입력하는 대로 '몇 장 인식되는지' 미리 보여 준다
let _pvT=null;
function previewCards(){
    clearTimeout(_pvT);
    _pvT=setTimeout(async()=>{
        const t=document.getElementById('cdPasteText').value;
        const info=document.getElementById('cdPasteInfo');
        if(!t.trim()){ info.textContent=''; info.className='cd-pinfo'; return; }
        try{
            const r=await fetch('/api/cards/preview',{method:'POST',
                headers:{'Content-Type':'application/json'},body:JSON.stringify({text:t})});
            const d=await r.json();
            if(d&&d.ok){
                const ex=(d.sample||[])[0];
                const mix=(d.choice? ` (암기 ${d.basic} · 객관식 ${d.choice})`:'');
                info.className='cd-pinfo ok';
                info.innerHTML=`<b>${d.count}장</b>으로 인식했어요${mix}`+
                    (d.title? ` · 묶음 <b>${window.esc(d.title)}</b>`:'')+
                    (ex?`<br><span>예: ${window.esc(ex.front)} → ${window.esc(ex.back)}</span>`:'');
            }else{
                info.className='cd-pinfo bad';
                info.textContent=d.error||'형식을 알아보지 못했어요';
            }
        }catch(e){ info.textContent=''; }
    },350);
}
async function makeCardsFromText(){
    const t=document.getElementById('cdPasteText').value;
    if(!t.trim()){ window.toast('내용을 붙여넣어 주세요',1800); return; }
    const btn=document.getElementById('cdMakeBtn');
    btn.disabled=true;
    try{
        const r=await fetch('/api/cards/text',{method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({text:t,title:document.getElementById('cdDeckName').value})});
        const d=await r.json();
        if(!r.ok||!d.ok){ window.toast('실패: '+(d.error||'알 수 없는 오류'),4200); return; }
        window.toast(`${d.count}장을 만들었습니다`,2200);
        showCardsHome(); loadDecks();
        const ds=document.getElementById('cdDeckSearch'); if(ds) ds.value='';
    }catch(e){ window.toast('만들기 실패',2400); }
    finally{ btn.disabled=false; }
}
// ── 18.0 · 해설 포맷터 — '정답 근거 + ①②③ 보기별 해설'을 예쁜 목록으로 ──
// AI 프롬프트가 ① 원문자 번호로 각 보기 해설을 붙여 주므로, 그 항목을 줄로 나눠 보여 준다.
// 원문자(①)는 글꼴에 따라 깨질 수 있어 숫자 배지(.ex-n)로 바꿔 그린다.
const _EX_CIRCLED='①②③④⑤⑥⑦⑧⑨⑩';
function fmtExplain(t){
    t=(t||'').trim(); if(!t) return '';
    const parts=t.split(new RegExp('(?=[①②③④⑤⑥⑦⑧⑨⑩])')).map(s=>s.trim()).filter(Boolean);
    if(parts.length<2) return '<div class="ex-lead">'+window.esc(t)+'</div>';
    return parts.map(p=>{
        const idx=_EX_CIRCLED.indexOf(p[0]);
        if(idx<0) return '<div class="ex-lead">'+window.esc(p)+'</div>';
        return '<div class="ex-item"><span class="ex-n">'+(idx+1)+'</span>'+window.esc(p.slice(1))+'</div>';
    }).join('');
}
function copyPrompt(){
    const t=CARD_PROMPT;
    const done=()=>window.toast('복사했습니다 · AI에 본문과 원하는 문제 수·난이도를 함께 알려 주세요',3200);
    if(navigator.clipboard&&navigator.clipboard.writeText)
        navigator.clipboard.writeText(t).then(done).catch(()=>{window.fallbackCopyText(t);done();});
    else{ window.fallbackCopyText(t); done(); }
}
// ══════════════════════════════════════════════════════════
//  11.1 · 암기 카드 정리
//   · 묶음이 많아져도 편하게: 찾기 + 페이지 넘기기
//   · 문제 관리: 문제를 페이지로 넘겨 보고 하나씩 손보기(다시 풀기·초기화·삭제)
//   · 학습 방식(11.7): 빠르게 풀기 / 마스터 학습 / 짝 맞추기 / 오답 / 시험
//     (‘직접 쓰기’는 빼고, 다른 학습앱에서 가장 많이 쓰는 ‘시험(테스트)’로 교체)
//   · 학습 중 ✕ 는 그 묶음의 기본 화면으로 나간다 (전체 목록으로 튕기지 않음)
// ══════════════════════════════════════════════════════════
const DECKS_PER_PAGE=5, CARDS_PER_PAGE=8;
let _decks=[], _deckPage=0;

async function loadDecks(keepPage){
    const box=document.getElementById('cardsList');
    if(!keepPage) _deckPage=0;
    box.innerHTML='<div class="cd-empty">불러오는 중…</div>';
    try{
        const r=await fetch('/api/cards/list',{cache:'no-store'});
        const d=await r.json();
        _decks=(d&&d.decks)||[];
    }catch(e){
        _decks=[];
        box.innerHTML='<div class="cd-empty">목록을 불러오지 못했습니다</div>';
        _show('cdDeckBar',false); _show('cdDeckPager',false);
        return;
    }
    renderDeckPage(keepPage?_deckPage:0);
}
try{ window.loadDecks=loadDecks; }catch(e){}
function _show(id,on,disp){ const el=document.getElementById(id);
    if(el) el.style.display=on?(disp||''):'none'; }
function renderDeckPage(page){
    const box=document.getElementById('cardsList');
    if(!box) return;
    if(typeof page==='number') _deckPage=page;
    const qEl=document.getElementById('cdDeckSearch');
    const q=((qEl&&qEl.value)||'').trim().toLowerCase();
    if(!_decks.length){
        box.innerHTML='<div class="cd-empty">아직 카드 묶음이 없습니다.<br><br>'+
            '① <b>AI 프롬프트 복사</b> 를 누르고<br>'+
            '② AI 에 붙여넣어 외울 내용을 주면<br>'+
            '③ 받은 텍스트를 <b>텍스트로 카드 만들기</b>에 넣으세요.</div>';
        _show('cdDeckBar',false); _show('cdDeckPager',false);
        return;
    }
    // 묶음이 몇 개 안 되면 검색칸으로 화면을 어지럽히지 않는다
    _show('cdDeckBar',(_decks.length>DECKS_PER_PAGE||!!q),'flex');
    const list=q? _decks.filter(k=>(k.title||'').toLowerCase().includes(q)) : _decks;
    const pages=Math.max(1,Math.ceil(list.length/DECKS_PER_PAGE));
    _deckPage=Math.max(0,Math.min(_deckPage,pages-1));
    const start=_deckPage*DECKS_PER_PAGE;
    const cnt=document.getElementById('cdDeckCount');
    if(cnt) cnt.textContent=list.length+'묶음';
    box.innerHTML=list.length? list.slice(start,start+DECKS_PER_PAGE).map(k=>{
        // 9.1 · 서버가 계산한 부분 점수 진행률을 그대로 쓴다.
        const pct=(k.progress!=null)?k.progress
                 :(k.count?Math.round(k.learned/k.count*100):0);
        const seen=k.seen||0;
        return `<div class="cd-deck" data-deck="${k.id}">
            <div class="cd-ring" style="background:conic-gradient(var(--accent) ${pct*3.6}deg,color-mix(in srgb,var(--accent) 18%,var(--bg2)) 0)">
              <span style="background:var(--bg2);width:28px;height:28px;border-radius:50%;
                    display:flex;align-items:center;justify-content:center;">${pct}%</span></div>
            <div class="t"><b>${window.esc(k.title)}</b>
              <span>${k.count}장 · 지금 볼 것 ${k.due}장 · 푼 것 ${seen}장 · 익힘 ${k.learned}장</span></div>
            <button class="more" data-menu="${k.id}" title="묶음 관리">
              <i class="ri-more-2-fill"></i></button>
        </div>`;
    }).join('') : `<div class="cd-empty">‘${window.esc(q)}’ 과(와) 맞는 묶음이 없어요</div>`;
    const pager=document.getElementById('cdDeckPager');
    if(pager){
        pager.style.display=pages>1?'flex':'none';
        document.getElementById('cdDeckPageInfo').textContent=(_deckPage+1)+' / '+pages+' 쪽';
        const pv=pager.querySelector('[data-p="prev"]'), nx=pager.querySelector('[data-p="next"]');
        if(pv) pv.disabled=_deckPage<=0;
        if(nx) nx.disabled=_deckPage>=pages-1;
    }
}
function deckPage(d){ renderDeckPage(_deckPage+d);
    const b=document.getElementById('cardsHome'); if(b) b.scrollTop=0; }
// 제목에 따옴표가 들어가도 안전하도록 클릭은 위임으로 처리한다 (예전엔 깨졌다)
(function(){
    const box=document.getElementById('cardsList'); if(!box) return;
    box.addEventListener('click',e=>{
        const mb=e.target.closest('[data-menu]');
        if(mb){ e.stopPropagation();
            const k=_decks.find(x=>x.id===mb.dataset.menu);
            deckMenu(mb,mb.dataset.menu,(k&&k.title)||''); return; }
        const row=e.target.closest('[data-deck]');
        if(row) startStudy(row.dataset.deck);
    });
})();
function _miniMenu(anchor,items,onPick){
    const old=document.getElementById('plMiniMenu'); if(old) old.remove();
    const m=document.createElement('div');
    m.id='plMiniMenu'; m.className='pl-mini';
    m.innerHTML=items.map(it=>`<button data-a="${it.a}"${it.danger?' class="d"':''}>${it.t}</button>`).join('');
    document.body.appendChild(m);
    const r=anchor.getBoundingClientRect();
    const w=Math.max(140,m.offsetWidth), h=m.offsetHeight;
    m.style.left=Math.max(8,Math.min(innerWidth-w-8,r.right-w))+'px';
    m.style.top=Math.max(8,Math.min(r.bottom+4,innerHeight-h-8))+'px';
    m.onclick=e=>{ e.stopPropagation();
        const a=e.target.closest('button')&&e.target.closest('button').dataset.a;
        if(!a) return; m.remove(); onPick(a); };
    setTimeout(()=>{
        const off=e2=>{ if(!e2.target.closest('#plMiniMenu')){ m.remove();
            document.removeEventListener('pointerdown',off,true);} };
        document.addEventListener('pointerdown',off,true);
    },0);
    return m;
}
function deckMenu(anchor,id,title){
    _miniMenu(anchor,[{a:'rename',t:'이름 변경'},{a:'reset',t:'진도 초기화'},
                      {a:'del',t:'삭제',danger:true}],async a=>{
        try{
            if(a==='rename'){
                const t=prompt('묶음 이름',title); if(!t||!t.trim()) return;
                await fetch('/api/cards/rename',{method:'POST',headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({deck:id,title:t.trim()})});
            }else if(a==='reset'){
                if(!confirm('진도를 처음부터 다시 시작할까요?')) return;
                await fetch('/api/cards/reset',{method:'POST',headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({deck:id})});
                window.toast('진도를 초기화했어요',1800);
            }else{
                if(!confirm(`"${title}" 묶음을 삭제할까요?`)) return;
                await fetch('/api/cards/delete',{method:'POST',headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({deck:id})});
                if(_deckCur&&_deckCur.id===id) _deckCur=null;
            }
        }catch(e){ window.toast('처리하지 못했습니다',2000); }
        loadDecks(true);
    });
}

// ── 객관식 카드 치유: 보기 순서·답 인덱스가 어긋난 카드를 고친다 ──
//   서버가 고쳐 주기 전에(혹은 서버가 옛 버전이어도) 클라이언트에서 한 번 더
//   정리한다. 보기를 섞어도 항상 '답 보기 텍스트' 기준으로 판정되게 하는 게 핵심.
function healChoiceCard(card){
    if(!card||card.type!=='choice') return false;
    if(!Array.isArray(card.opts)) card.opts=[];
    let changed=false;
    const starTexts=[];
    const clean=[];
    for(const o0 of card.opts){
        const s=String(o0==null?'':o0);
        const had=/^\s*[*＊]+\s*/.test(s)||/\s*[*＊]+[\s。.．,，、;；)）]?$/.test(s);
        const t=s.replace(/^\s*[*＊]+\s*/,'').replace(/\s*[*＊]+([\s。.．,，、;；)）]?)$/,'$1').trim();
        if(had&&t) starTexts.push(t);
        if(t!==s.trim()) changed=true;
        if(t) clean.push(t);
    }
    card.opts=clean;
    const n=card.opts.length;
    const valid=i=>Number.isInteger(i)&&i>=0&&i<n;
    const starAt=starTexts.map(t=>card.opts.indexOf(t)).filter(i=>i>=0);
    // 신뢰도 순서: ① 별표 보기 ② back 텍스트와 일치하는 보기 ③ 기존 answer
    let ans=-1;
    if(starAt.length) ans=starAt[starAt.length-1];
    if(ans<0){
        const back=String(card.back==null?'':card.back).trim();
        if(back){ const bi=card.opts.findIndex(o=>String(o).trim()===back); if(bi>=0) ans=bi; }
    }
    if(ans<0&&valid(card.answer)) ans=card.answer;
    if(!valid(ans)) return changed;   // 고칠 수 없는 카드(보기 1개 등)는 studyPool 에서 걸러진다
    if(card.answer!==ans){ card.answer=ans; changed=true; }
    if(card.back!==card.opts[ans]){ card.back=card.opts[ans]; changed=true; }
    return changed;
}

// ── 묶음을 열면 '학습 방식 고르기' 화면 ──────────────
let _stats=null;
async function startStudy(id){
    try{
        const r=await fetch('/api/cards/deck/'+encodeURIComponent(id),{cache:'no-store'});
        const d=await r.json();
        if(!d||!d.ok){ window.toast('묶음을 열 수 없습니다',2200); return; }
        _deckCur=d.deck;
        try{ (d.deck.cards||[]).forEach(healChoiceCard); }catch(e){}
        let st=null;
        try{ st=await (await fetch('/api/cards/stats/'+encodeURIComponent(id),{cache:'no-store'})).json(); }catch(e){}
        _stats=st&&st.ok?st:null;
        showPane('cardsStats');
        renderStudyPick();
    }catch(e){ window.toast('묶음을 열 수 없습니다',2200); }
}
function studyPool(){
    // 풀 수 있는 문제만 (객관식 + 예전 뒤집기 카드)
    return ((_deckCur&&_deckCur.cards)||[]).filter(c=>c&&(
        c.type==='choice' ? (Array.isArray(c.opts)&&c.opts.length>=2&&c.answer>=0&&c.answer<c.opts.length)
                          : !!((c.front||'').trim()&&(c.back||'').trim())));
}
function renderStudyPick(){
    const d=_deckCur; if(!d) { showCardsHome(); return; }
    document.getElementById('cdStTitle').textContent=d.title||'카드';
    _fcardTitle(d.title||'암기 카드');
    const scEl=document.getElementById('cdStCount');
    if(scEl) scEl.textContent=((d.cards||[]).length)+'문제';
    const now=Date.now()/1000;
    const cards=d.cards||[];
    const due=cards.filter(c=>(c.due||0)<=now).length;
    const nw=cards.filter(c=>!(c.seen||0)).length;
    const mature=cards.filter(c=>(c.ivl||0)>=21).length;
    document.getElementById('cdStatRow').innerHTML=
        `<div class="cd-stat due"><b>${due}</b><span>지금 볼 것</span></div>`+
        `<div class="cd-stat"><b>${nw}</b><span>처음 보는 것</span></div>`+
        `<div class="cd-stat"><b>${mature}</b><span>기억 중</span></div>`;
    document.getElementById('cdTagPick').innerHTML='';
    const tp=document.getElementById('cdTestPick'); if(tp) tp.classList.remove('show');
    // 자주 틀린 문제 — 눌러서 그 문제만 바로 다시 본다 (너무 길지 않게 6개)
    const hard=cards.filter(c=>(c.lapses||0)>0)
        .sort((a,b)=>(b.lapses||0)-(a.lapses||0)).slice(0,6);
    const hl=document.getElementById('cdHardList');
    if(hard.length){
        hl.innerHTML='<div class="ana-title" style="margin:4px 0 2px;">자주 틀린 문제 <span style="font-weight:400;color:var(--text3)">눌러서 바로 복습</span></div>'+
            hard.map(c=>`<div class="h" onclick="reviewOne('${c.id}')" style="cursor:pointer">`+
                `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;">${window.esc(c.front)}</span>`+
                `<b>✗ ${c.lapses}</b><i class="ri-arrow-right-s-line go"></i></div>`).join('')+
            (cards.filter(c=>(c.lapses||0)>0).length>6
                ?'<div style="font-size:10.5px;color:var(--text3);margin:5px 2px 0;">더 보려면 오른쪽 위 <b>문제 관리</b> → 틀린 것</div>':'');
    } else hl.innerHTML='';
}
function reviewOne(cid){
    if(!_deckCur) return;
    const c=(_deckCur.cards||[]).find(x=>x.id===cid); if(!c) return;
    _startQueue([c],'hard');
}

// ── 문제 관리 (11.1) ──────────────────────────────────
let _brPage=0;
function openBrowse(){
    if(!_deckCur){ window.toast('묶음을 먼저 고르세요',1800); return; }
    showPane('cardsBrowse');
    _fcardTitle(_deckCur.title||'암기 카드');
    renderBrowse(0);
}
function browseList(){
    const now=Date.now()/1000;
    const f=(document.getElementById('cdBrFilter')||{}).value||'all';
    const q=((document.getElementById('cdBrSearch')||{}).value||'').trim().toLowerCase();
    let arr=((_deckCur&&_deckCur.cards)||[]).slice();
    if(f==='due') arr=arr.filter(c=>(c.due||0)<=now);
    else if(f==='wrong') arr=arr.filter(c=>(c.lapses||0)>0||(c.ng||0)>0);
    else if(f==='new') arr=arr.filter(c=>!(c.seen||0));
    if(q) arr=arr.filter(c=>((c.front||'')+' '+((c.opts||[]).join(' '))+' '+(c.back||'')
        +' '+(c.tag||'')+' '+(c.note||'')).toLowerCase().includes(q));
    return arr;
}
function renderBrowse(page){
    if(!_deckCur) return;
    if(typeof page==='number') _brPage=page;
    const all=(_deckCur.cards||[]);
    const list=browseList();
    const pages=Math.max(1,Math.ceil(list.length/CARDS_PER_PAGE));
    _brPage=Math.max(0,Math.min(_brPage,pages-1));
    const start=_brPage*CARDS_PER_PAGE;
    const now=Date.now()/1000;
    const box=document.getElementById('cdBrList');
    const cnt=document.getElementById('cdBrCount');
    if(cnt) cnt.textContent=list.length+' / '+all.length+'문제';
    box.innerHTML=list.length? list.slice(start,start+CARDS_PER_PAGE).map(c=>{
        const no=all.indexOf(c)+1;
        const tries=(c.ok||0)+(c.ng||0);
        const acc=tries?Math.round((c.ok||0)/tries*100):null;
        const chips=[];
        if(c.tag) chips.push(`<em>#${window.esc(c.tag)}</em>`);
        if(c.difficulty) chips.push(`<em>${window.esc(c.difficulty)}</em>`);
        if(!(c.seen||0)) chips.push('<em>안 푼 문제</em>');
        else if((c.due||0)<=now) chips.push('<em class="due">지금 볼 것</em>');
        else chips.push(`<em>${_gapText((c.due||0)-now)} 뒤</em>`);
        if(acc!=null) chips.push(`<em class="${acc>=70?'good':'bad'}">정답률 ${acc}% (${tries}회)</em>`);
        if((c.lapses||0)>0) chips.push(`<em class="bad">✗ ${c.lapses}</em>`);
        if(c.type!=='choice') chips.push('<em>뒤집기</em>');
        return `<div class="cd-br" data-card="${c.id}" title="눌러서 이 문제만 풀기">
            <span class="n">${no}</span>
            <div class="q"><b>${window.esc(c.front||'(빈 문제)')}</b><div class="cs">${chips.join('')}</div></div>
            <button class="mo" data-cmenu="${c.id}" title="이 문제 관리"><i class="ri-more-2-fill"></i></button>
        </div>`;
    }).join('') : '<div class="cd-empty">조건에 맞는 문제가 없어요</div>';
    const pager=document.getElementById('cdBrPager');
    if(pager){
        pager.style.display=pages>1?'flex':'none';
        document.getElementById('cdBrPageInfo').textContent=(_brPage+1)+' / '+pages+' 쪽';
        const pv=pager.querySelector('[data-p="prev"]'), nx=pager.querySelector('[data-p="next"]');
        if(pv) pv.disabled=_brPage<=0;
        if(nx) nx.disabled=_brPage>=pages-1;
    }
}
function brPage(d){ renderBrowse(_brPage+d);
    const b=document.getElementById('cardsBrowse'); if(b) b.scrollTop=0; }
function _gapText(sec){
    if(sec<=0) return '지금';
    if(sec<3600) return Math.max(1,Math.round(sec/60))+'분';
    if(sec<86400) return Math.round(sec/3600)+'시간';
    const d=sec/86400;
    return d<30? Math.round(d)+'일' : Math.round(d/30)+'달';
}
(function(){
    const box=document.getElementById('cdBrList'); if(!box) return;
    box.addEventListener('click',e=>{
        const mb=e.target.closest('[data-cmenu]');
        if(mb){ e.stopPropagation(); cardMenu(mb,mb.dataset.cmenu); return; }
        const row=e.target.closest('[data-card]');
        if(row) reviewOne(row.dataset.card);
    });
})();
function cardMenu(anchor,cid){
    _miniMenu(anchor,[{a:'study',t:'이 문제만 풀기'},{a:'reset',t:'이 문제 진도 초기화'},
                      {a:'del',t:'이 문제 삭제',danger:true}],async a=>{
        const c=(_deckCur&&_deckCur.cards||[]).find(x=>x.id===cid); if(!c) return;
        if(a==='study'){ reviewOne(cid); return; }
        try{
            if(a==='reset'){
                if(!confirm('이 문제의 진도를 처음으로 되돌릴까요?')) return;
                await fetch('/api/cards/card/reset',{method:'POST',headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({deck:_deckCur.id,card:cid})});
                Object.assign(c,{box:0,due:0,seen:0,ok:0,ng:0,lapses:0,ease:2.5,ivl:0});
                window.toast('이 문제를 처음 상태로 되돌렸어요',1800);
            }else{
                if(!confirm('이 문제를 삭제할까요? (되돌릴 수 없어요)')) return;
                const r=await fetch('/api/cards/card/delete',{method:'POST',headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({deck:_deckCur.id,card:cid})});
                const d=await r.json().catch(()=>({}));
                if(!r.ok||!d.ok){ window.toast('삭제하지 못했습니다',2000); return; }
                const i=_deckCur.cards.indexOf(c); if(i>=0) _deckCur.cards.splice(i,1);
                window.toast('문제를 삭제했어요',1600);
            }
        }catch(e){ window.toast('처리하지 못했습니다',2000); return; }
        renderBrowse();
    });
}

function anaTime(ms){
    if(!ms) return '–';
    const s=ms/1000; return s<60?s.toFixed(s<10?1:0)+'초':Math.round(s/60)+'분';
}
async function openCardAnalytics(){
    if(!_deckCur) return;
    await flushCardGrades();
    showPane('cardsAnalytics');
    const body=document.getElementById('cdAnaBody');
    body.innerHTML='<div class="cd-empty">통계를 불러오는 중…</div>';
    try{
        const r=await fetch('/api/cards/stats/'+encodeURIComponent(_deckCur.id),{cache:'no-store'});
        const s=await r.json(); if(!r.ok||!s.ok) throw new Error(); _stats=s;
        const o=s.overview||{}, per=s.periods||{}, days=s.daily||[];
        if(!(o.attempts||0)){
            body.innerHTML='<div class="cd-empty"><i class="ri-seedling-line" style="font-size:32px;color:var(--accent)"></i><br>아직 풀이 기록이 없습니다.<br>몇 장 풀면 정답률과 약한 개념이 여기에 보여요.</div>';
            return;
        }
        const maxDay=Math.max(1,...days.map(x=>x.attempts||0));
        const period=(name,x)=>`<div class="ana-row"><span>${name}</span><div class="track"><i style="width:${x&&x.attempts?x.accuracy:0}%"></i></div><em>${x&&x.attempts?`${x.accuracy}% · ${x.attempts}회`:'기록 없음'}</em></div>`;
        const groups=(title,arr)=>!arr||!arr.length?'':`<div class="ana-sec"><div class="ana-title">${title}</div>`+
            arr.slice(0,8).map(x=>`<div class="ana-row"><span>${window.esc(x.name)}</span><div class="track"><i style="width:${x.accuracy}%"></i></div><em>${x.accuracy}% · ${x.attempts}</em></div>`).join('')+'</div>';
        body.innerHTML=`
          <div class="ana-kpis">
            <div class="ana-kpi"><b>${o.accuracy||0}%</b><span>전체 정답률</span></div>
            <div class="ana-kpi"><b>${o.attempts||0}</b><span>누적 풀이</span></div>
            <div class="ana-kpi"><b>${o.streakDays||0}일</b><span>연속 학습</span></div>
            <div class="ana-kpi"><b>${anaTime(o.avgResponseMs)}</b><span>평균 풀이</span></div>
            <div class="ana-kpi"><b>${o.sessions||0}</b><span>학습 세션</span></div>
            <div class="ana-kpi"><b>${s.mature||0}</b><span>장기 기억</span></div>
          </div>
          <div class="ana-sec"><div class="ana-title">기간별 정답률</div>
            ${period('오늘',per.today)}${period('최근 7일',per.week)}${period('최근 30일',per.month)}
          </div>
          <div class="ana-sec"><div class="ana-title">최근 14일 풀이량</div><div class="ana-days">
            ${days.map((x,i)=>`<div class="ana-day" title="${x.date} · ${x.attempts}회 · ${x.accuracy}%"><i style="height:${Math.max(3,(x.attempts||0)/maxDay*72)}px;opacity:${x.attempts?0.95:0.2}"></i><span>${i%2===0?x.date.slice(5).replace('-','/'):''}</span></div>`).join('')}
          </div></div>
          ${groups('단원·태그별',s.byTag)}
          ${groups('난이도별',s.byDifficulty)}
          <div class="ana-sec"><div class="ana-title">다시 보면 좋은 문제</div>
            ${(s.weak||[]).length?(s.weak||[]).map(x=>{const cc=(_deckCur.cards||[]).find(z=>z.id===x.id||z.front===x.front);
                return `<div class="ana-weak"${cc?` style="cursor:pointer" onclick="reviewOne('${cc.id}')"`:''}>`+
                `<span>${window.esc(x.front)}</span><b>오답 ${x.wrong} · ${x.accuracy}%${cc?' <i class="ri-arrow-right-s-line"></i>':''}</b></div>`;}).join(''):'<div style="font-size:12px;color:var(--text3)">아직 뚜렷한 약점이 없어요. 잘하고 있습니다 ✨</div>'}
          </div>`;
    }catch(e){ body.innerHTML='<div class="cd-empty">통계를 불러오지 못했습니다</div>'; }
}

// ── 학습 시작 ─────────────────────────────────────────
let _mode='smart', _isTest=false, _testLog=[], _testStart=0, _testN=0;
let _mastery={}, _masterPool=[];         // 11.7 · 마스터 학습 진행도
let _match=null;                          // 11.7 · 짝 맞추기 상태
function toggleTestPick(){
    const el=document.getElementById('cdTestPick'); if(!el) return;
    el.classList.toggle('show');
    if(el.classList.contains('show')&&el.scrollIntoView)
        el.scrollIntoView({block:'nearest',behavior:'smooth'});
}
function beginStudy(mode,opt){
    if(!_deckCur){ window.toast('묶음을 먼저 고르세요',1800); return; }
    const now=Date.now()/1000;
    const pool=studyPool();
    if(!pool.length){ window.toast('풀 수 있는 문제가 없습니다. 새 묶음은 M(객관식) 형식으로 만들어 주세요',2600); return; }
    let q;
    if(mode==='match'){ startMatch(pool); return; }
    if(mode==='learn'){
        // 11.7 · 마스터 학습: 연속 2번 맞힐 때까지 되풀이 (Quizlet Learn 방식)
        q=pool.filter(c=>(c.box||0)<4);
        if(!q.length) q=pool.slice();
        shuffle(q);
        q=q.slice(0,20);
        _mastery={}; q.forEach(c=>{ _mastery[c.id]=0; });
        _masterPool=q.slice();
        _startQueue(q.slice(0,7),'learn');
        return;
    }
    if(mode==='quiz'){ q=pool.slice(); shuffle(q); }
    else if(mode==='hard'){
        q=pool.filter(c=>(c.lapses||0)>0||(c.ng||0)>0)
              .sort((a,b)=>((b.lapses||0)-(a.lapses||0))||((b.ng||0)-(a.ng||0)));
        if(!q.length){ window.toast('아직 틀린 문제가 없어요 · 먼저 한 바퀴 풀어 볼까요?',2400); return; }
    }
    else if(mode==='cram'){
        q=pool.slice().sort((a,b)=>((a.ivl||0)-(b.ivl||0))||((a.seen||0)-(b.seen||0))).slice(0,20);
        shuffle(q);
    }
    else if(mode==='test'){
        q=pool.slice(); shuffle(q);
        const n=(opt&&opt.n)|0;
        if(n>0) q=q.slice(0,n);
        _testN=q.length;
    }
    else if(mode==='wrongonly'){
        q=(opt&&opt.cards)||[];
        if(!q.length){ window.toast('다시 풀 문제가 없어요',1800); return; }
        mode='hard';
    }
    else{  // smart
        q=pool.filter(c=>(c.due||0)<=now);
        if(!q.length) q=pool.slice().sort((a,b)=>(a.box||0)-(b.box||0)).slice(0,20);
        shuffle(q);
    }
    _startQueue(q,mode);
}
function _startQueue(q,mode){
    _mode=mode; _isTest=(mode==='test');
    _queue=q.slice(); _qi=0; _studied=0; _rightN=0; _streak=0; _pendingAnswer=null;
    _testLog=[]; _testStart=Date.now();
    _studySession='cs_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
    _cdSessStart();                       // 15.0 · 세션 칩(정답률·시간) 시작
    _queue.forEach(c=>{ delete c.__roundRetry; });
    const streakEl=document.getElementById('cdStreak');
    if(streakEl){ streakEl.style.display='none'; streakEl.textContent='✨ 0'; }
    showPane('cardsStudy');
    document.getElementById('cdDone').style.display='none';
    document.getElementById('cdTestReport').style.display='none';
    _fcardTitle((_isTest?'시험 · ':'')+((_deckCur&&_deckCur.title)||'암기 카드'));
    showCard();
    otterSay(_isTest?'긴장되지? 지켜볼게 해돌이~':'시~작! 같이 해보자 해돌이~','love',1600);
}

/* ── 해달 '해돌이' 컨트롤 ─────────────────────────
   18.1 · CodePen '초귀요미 해달 마스코트'로 교체.
   기존 무드 이름(idle/think/happy/love/sad/wow)은 그대로 두고
   새 마스코트의 상태 클래스(om-*)로 번역해 svg 에 건다.
   · happy/love → om-correct (폴짝·반짝이·볼터치)
   · sad       → om-wrong   (흐느적·눈물)
   · think/wow → om-idea    (전구 번쩍·유레카)
   · idle      → 기본 불가사리 안은 모습 (상태 클래스 없음) */
const OTTER_STATE={idle:'',sleep:'',think:'om-idea',happy:'om-correct',
                   love:'om-correct',sad:'om-wrong',wow:'om-idea'};
function _otterEl(){ return document.getElementById('cdOtter'); }
function otterSet(mood){
    const o=_otterEl(); if(!o) return;
    o.dataset.mood=mood||'idle';
    const svg=o.querySelector('svg'); if(!svg) return;
    const st=OTTER_STATE[o.dataset.mood]||'';
    svg.classList.remove('om-correct','om-wrong','om-music','om-doc','om-idea');
    void svg.getBoundingClientRect();   // 같은 무드를 다시 걸어도 애니메이션이 재시작되게
    if(st) svg.classList.add(st);
}
let _otterBubTimer=null,_otterHideTimer=null;
function otterSay(text,mood,dur){
    const o=_otterEl(), b=document.getElementById('otterBubble');
    if(!o||!b) return;
    otterSet(mood||'idle');
    if(text){
        b.textContent=text;
        b.classList.add('show');
        clearTimeout(_otterBubTimer);
        _otterBubTimer=setTimeout(()=>b.classList.remove('show'), dur||2200);
    }
    if(mood==='happy'||mood==='love') otterBurst(mood==='love'?8:5,mood==='love'?'❤⭐💖':'⭐✨🎉');
}
function otterBurst(n,emojis){
    const fx=document.getElementById('otterFx'); if(!fx) return;
    const pool=(emojis||'⭐✨').split('');
    for(let i=0;i<(n||5);i++){
        const s=document.createElement('span'); s.className='p';
        s.textContent=pool[i%pool.length];
        const ang=Math.random()*Math.PI*2, dist=40+Math.random()*60;
        s.style.setProperty('--px',(Math.cos(ang)*dist).toFixed(0)+'px');
        s.style.setProperty('--py',(-Math.abs(Math.sin(ang))*dist-10).toFixed(0)+'px');
        s.style.setProperty('--pr',(Math.random()*80-40).toFixed(0)+'deg');
        s.style.animationDuration=(700+Math.random()*500)+'ms';
        fx.appendChild(s);
        setTimeout(()=>s.remove(),1300);
    }
}
function otterThink(){ otterSay('음… 생각 좀 해볼게 해돌이~','think',1500); }
function otterCheer(streak){
    if(streak>=5)      otterSay('와! 연속 '+streak+'개! 천재 해돌이~!','love',2400);
    else if(streak>=3) otterSay('흐름 좋아! 계속 가자 해돌이~!','happy',1800);
    else               otterSay('좋아! 기억 속에 쏙~ 해돌이!','happy',1500);
}
function otterSad(){ otterSay('괜찮아~ 한 번 더 보면 돼 해돌이~!','sad',2000); }
function otterHint(){ otterSay('힌트 살짝! 👀 해돌이~','think',1600); }
function otterFinish(pct){
    if(pct>=90) otterSay('대박! 완벽 마스터 해돌이~! 🏆','love',3200);
    else if(pct>=60) otterSay('수고했어! 해돌이 칭찬해~','happy',2600);
    else otterSay('다음에 또 같이 공부하자 해돌이~!','happy',2200);
}
document.addEventListener('DOMContentLoaded',()=>{
    // hint 버튼 이벤트 훅
    const hbtn=document.getElementById('cdHintBtn');
    if(hbtn){
        hbtn.addEventListener('click',()=>{ otterHint(); },true);
    }
});
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=(Math.random()*(i+1))|0;[a[i],a[j]]=[a[j],a[i]];} }
// ══════════════════════════════════════════════════════════
//  11.7 · 짝 맞추기 (Quizlet Match 식)
//   문제와 정답 조각을 섞어 놓고 짝을 지어 없앤다. 기록은 묶음별로 저장.
// ══════════════════════════════════════════════════════════
function _answerOf(c){
    if(c.type==='choice') return (c.opts||[])[c.answer]||'';
    return c.back||'';
}
function startMatch(pool){
    // 정답이 서로 겹치지 않는 카드만 (짝이 헷갈리지 않게)
    const seen=new Set(), cand=[], mix=pool.slice();
    shuffle(mix);
    mix.forEach(c=>{
        const a=(_answerOf(c)||'').trim(), q=(c.front||'').trim();
        if(!a||!q||seen.has(a)) return;
        seen.add(a); cand.push(c);
    });
    if(cand.length<3){ window.toast('짝 맞추기는 서로 다른 정답이 3개 이상 필요해요',2600); return; }
    const use=cand.slice(0,6);
    _mode='match'; _isTest=false; _queue=[]; _qi=0; _pendingAnswer=null;
    _studied=0; _rightN=0; _streak=0;
    _studySession='cs_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
    _cdSessStart();                       // 15.0 · 세션 칩(정답률·시간) 시작
    showPane('cardsStudy');
    _fcardTitle('짝 맞추기 · '+((_deckCur&&_deckCur.title)||'암기 카드'));
    ['cdFlip','cdQuiz','cdDone','cdTestReport','cdFlipGrade','cdMastery','cdNextBtn','cdExplain','cdQBar']
        .forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; });
    const ar=document.getElementById('cdAutoResult'); if(ar){ ar.textContent=''; ar.className='cd-typeres'; }
    document.getElementById('cdMatch').style.display='';
    document.getElementById('cdMatchDone').style.display='none';
    document.getElementById('cdProgFill').style.width='0%';
    document.getElementById('cdCount').textContent=use.length+'쌍';
    const tiles=[];
    use.forEach(c=>{
        tiles.push({cid:c.id,kind:'q',text:c.front});
        tiles.push({cid:c.id,kind:'a',text:_answerOf(c)});
    });
    shuffle(tiles);
    _match={cards:use,left:use.length,pick:null,start:Date.now(),timer:null,
            miss:{},total:use.length};
    const grid=document.getElementById('cdMatchGrid');
    grid.innerHTML=tiles.map((t,i)=>
        `<button class="cd-tile${t.kind==='a'?' ans':''}" data-mi="${i}" data-cid="${t.cid}" data-kind="${t.kind}">`+
        `<span>${window.esc(t.text)}</span></button>`).join('');
    document.getElementById('cdMatchInfo').textContent='짝을 지어 없애 보세요';
    clearInterval(_match.timer);
    _match.timer=setInterval(()=>{
        const el=document.getElementById('cdMatchTime');
        if(!el||!_match){ return; }
        el.textContent=((Date.now()-_match.start)/1000).toFixed(1)+'초';
    },100);
}
function matchTap(btn){
    if(!_match||btn.classList.contains('gone')) return;
    const prev=_match.pick;
    if(!prev){ _match.pick=btn; btn.classList.add('pick'); return; }
    if(prev===btn){ btn.classList.remove('pick'); _match.pick=null; return; }
    const same=(prev.dataset.cid===btn.dataset.cid);
    const pair=(prev.dataset.kind!==btn.dataset.kind);
    _match.pick=null; prev.classList.remove('pick');
    if(same&&pair){
        [prev,btn].forEach(el=>{ el.classList.add('gone'); });
        _match.left--;
        const c=(_deckCur.cards||[]).find(x=>x.id===btn.dataset.cid);
        if(c){
            _studied++; _rightN++;
            const g=_match.miss[c.id]?1:2;      // 헤맸으면 낮은 점수로 기록
            queueCardGrade(c,g,null);
        }
        document.getElementById('cdProgFill').style.width=
            ((_match.total-_match.left)/_match.total*100)+'%';
        document.getElementById('cdCount').textContent=_match.left+'쌍 남음';
        _cdSessPaint();                        // 15.0 · 세션 칩 갱신 (완성한 짝)
        if(_match.left<=0) matchFinish();
    }else{
        _match.miss[btn.dataset.cid]=1; _match.miss[prev.dataset.cid]=1;
        [prev,btn].forEach(el=>{ el.classList.add('bad');
            setTimeout(()=>el.classList.remove('bad'),340); });
    }
}
function matchFinish(){
    if(!_match) return;
    clearInterval(_match.timer);
    const sec=(Date.now()-_match.start)/1000;
    const key='sdy_match_best_'+((_deckCur&&_deckCur.id)||'x');
    let best=0; try{ best=+(localStorage.getItem(key)||0); }catch(e){}
    const isBest=!best||sec<best;
    if(isBest){ try{ localStorage.setItem(key,sec.toFixed(1)); }catch(e){} }
    const box=document.getElementById('cdMatchDone');
    box.style.display='';
    box.innerHTML='<b>'+sec.toFixed(1)+'초</b>'+
        '<span>'+(isBest?'<span class="best">새 기록이에요! 🎉</span>'
                        :('최고 기록 '+best+'초'))+'</span>'+
        '<div class="cards-actions" style="justify-content:center;margin-top:12px;">'+
        '<button class="cd-btn primary" onclick="beginStudy(\'match\')">다시 하기</button>'+
        '<button class="cd-btn" onclick="backToPick()">묶음 화면으로</button></div>';
    document.getElementById('cdMatchInfo').textContent='다 맞췄어요!';
    flushCardGrades();
    _match=null;
}
(function(){
    const g=document.getElementById('cdMatchGrid');
    if(!g) return;
    g.addEventListener('click',e=>{
        const b=e.target.closest('.cd-tile'); if(b) matchTap(b);
    });
})();
function studyAgain(){
    if(_mode==='match'){ beginStudy('match'); return; }
    if(_isTest){ beginStudy('test',{n:_testN}); return; }
    beginStudy(_mode==='hard'&&_queue.length<=1?'smart':_mode);
}

// ── 카드 보여 주기 ────────────────────────────────────
let _rightN=0, _answered=false;
function showCard(){
    if(_mode==='learn'&&_masterPool.length
       &&_masterPool.every(c=>(_mastery[c.id]||0)>=2)){ finishStudy(); return; }
    if(!_queue.length){ finishStudy(); return; }
    if(_qi>=_queue.length){ finishStudy(); return; }
    const c=_queue[_qi];
    _flipped=false; _answered=false; _pendingAnswer=null; _cardShownAt=Date.now();
    const flip=document.getElementById('cdFlip');
    const quiz=document.getElementById('cdQuiz');
    flip.style.display='none'; quiz.style.display='none';
    const mt=document.getElementById('cdMatch'); if(mt) mt.style.display='none';
    flip.classList.remove('flipped');
    document.getElementById('cdFlipGrade').style.display='none';
    document.getElementById('cdTestReport').style.display='none';
    document.getElementById('cdDone').style.display='none';
    const autoResult=document.getElementById('cdAutoResult');
    if(autoResult){ autoResult.textContent=''; autoResult.className='cd-typeres'; }
    const explain=document.getElementById('cdExplain');
    if(explain){ explain.style.display='none'; explain.textContent=''; }
    const next=document.getElementById('cdNextBtn'); if(next) next.style.display='none';
    document.getElementById('cdCount').textContent=(_qi+1)+' / '+_queue.length;
    document.getElementById('cdProgFill').style.width=(_qi/_queue.length*100)+'%';
    renderMastery();
    const body=document.getElementById('cardsStudy'); if(body) body.scrollTop=0;

    // 15.4 · 문제는 항상 위에 — 뒤집기/객관식 공용 질문 바
    const qbar=document.getElementById('cdQBar');
    if(qbar){
        qbar.style.display='';
        const qtitle=document.getElementById('cdQuestion');
        if(qtitle) qtitle.textContent=c.front||'';
        const qchip=document.getElementById('cdQType');
        if(qchip) qchip.textContent=(c.type==='choice')?'객관식':'뒤집기 카드';
        // 질문 바 입장 애니메이션 다시 재생
        qbar.classList.remove('cd-qin'); void qbar.offsetWidth; qbar.classList.add('cd-qin');
    }

    if(c.type==='choice'){
        quiz.style.display='';
        // 15.4 · 문제는 위 cdQBar 에 이미 표시된다 — 객관식 패널 안에 또 보여주지 않는다.
        const quizQ=document.getElementById('cdQuizQ');
        quizQ.textContent=''; quizQ.style.display='none';
        const order=c.opts.map((o,i)=>i);
        shuffle(order);
        c.__order=order;
        document.getElementById('cdOpts').innerHTML=order.map((oi,k)=>
            `<button class="cd-opt" data-i="${oi}" onclick="pickOpt(${oi},this)">
               <i class="num">${k+1}</i><span>${window.esc(c.opts[oi])}</span></button>`).join('');
        return;
    }
    // 뒤집기 카드 (예전 엑셀 카드도 그냥 넘기지 않고 제대로 풀 수 있게)
    flip.style.display='';
    // 15.4 · 문제는 위 cdQBar 에 이미 표시된다 — 앞면에 중복 출력하지 않는다.
    const frontTxt=document.getElementById('cdFrontTxt');
    frontTxt.textContent=''; frontTxt.style.display='none';
    const hint=document.getElementById('cdHint');
    const hbtn=document.getElementById('cdHintBtn');
    hint.textContent='';
    hbtn.style.display=c.hint?'':'none';
    document.getElementById('cdBackTxt').textContent=c.back||'';
    document.getElementById('cdNote').innerHTML=fmtExplain(c.note);
}
function showHint(){
    const c=_queue[_qi]; if(!c||!c.hint) return;
    document.getElementById('cdHint').textContent='힌트 · '+c.hint;
    document.getElementById('cdHintBtn').style.display='none';
    otterHint();
}
function flipCard(){
    const c=_queue[_qi];
    if(!c||c.type==='choice') return;
    _flipped=!_flipped;
    document.getElementById('cdFlip').classList.toggle('flipped',_flipped);
    // 답을 본 뒤에만 '알아요 / 아직이에요' 를 묻는다
    if(_flipped&&!_answered) document.getElementById('cdFlipGrade').style.display='grid';
    if(_flipped&&!_answered) otterSay('답 기억나? 해돌이~','wow',1200);
    else if(!_flipped) otterSet('think');
}
function flipGrade(g){
    if(_answered) return;
    const c=_queue[_qi]; if(!c) return;
    _answered=true; _studied++;
    const right=g>=2;
    if(right){ _rightN++; _streak++; } else _streak=0;
    _pendingAnswer={card:c,grade:g};
    queueCardGrade(c,g,null);
    cardCheer(right);
    document.getElementById('cdFlipGrade').style.display='none';
    const result=document.getElementById('cdAutoResult');
    if(result){ result.className='cd-typeres '+(right?'ok':'no');
        result.textContent=right?'좋아요, 이 카드는 천천히 다시 만나요':'괜찮아요 · 곧 한 번 더 보여 드릴게요'; }
    document.getElementById('cdNextBtn').style.display='flex';
    _cdSessPaint();                        // 15.0 · 세션 칩 갱신
}
function cardCheer(right){
    const quiz=document.getElementById('cdQuiz');
    const streak=document.getElementById('cdStreak');
    if(streak){
        streak.textContent='✨ '+_streak;
        streak.style.display=(_streak>=2&&!_isTest)?'':'none';
    }
    if(right){ otterCheer(_streak); }
    else { if(!_isTest) otterSad(); }
    if(!right||!quiz||_isTest) return;
    quiz.classList.remove('cd-cheer'); void quiz.offsetWidth; quiz.classList.add('cd-cheer');
    const pts=[[-72,-42],[-34,-64],[36,-62],[74,-38]];
    pts.forEach((p,i)=>{
        const s=document.createElement('span'); s.className='cd-spark';
        s.textContent=i%2?'✦':'✨';
        s.style.setProperty('--sx',p[0]+'px'); s.style.setProperty('--sy',p[1]+'px');
        quiz.appendChild(s); setTimeout(()=>s.remove(),700);
    });
    setTimeout(()=>quiz.classList.remove('cd-cheer'),520);
}
// 객관식 답 고르기 — 난이도를 따로 고르지 않아도 자동 기록한다.
function pickOpt(i,btn){
    if(_answered) return;
    _answered=true;
    const c=_queue[_qi];
    // 표시를 섞었을 때에도 '답 보기 텍스트'로 판정한다 — 인덱스만 비교하면
    // 보기가 섞인 화면에서 엉뚱한 보기가 정답이 될 수 있다.
    const opts=Array.isArray(c.opts)?c.opts:[];
    const pickText=String(opts[i]||'');
    const ansText=String(opts[c.answer]!=null?opts[c.answer]:(c.back||''));
    const right=(i===c.answer)||(!!pickText&&pickText===ansText);
    if(right){ _rightN++; _streak++; } else _streak=0;
    _studied++;
    const grade=right?3:0;
    _pendingAnswer={card:c,grade};
    queueCardGrade(c,grade,i);       // 답을 고른 즉시 outbox+서버 저장
    if(_isTest){
        // 시험: 맞았는지 알려 주지 않고 바로 다음 문제 (성적표에서 한 번에 확인)
        _testLog.push({id:c.id,front:c.front,pick:(c.opts||[])[i],
                       real:(c.opts||[])[c.answer]||c.back||'',note:c.note||'',right});
        document.querySelectorAll('#cdOpts .cd-opt').forEach(b=>{
            b.disabled=true; if(+b.dataset.i===i) b.classList.add('pick');
        });
        const st=document.getElementById('cdStreak');
        if(st){ st.style.display=''; st.textContent=(_qi+1)+'문항 제출'; }
        setTimeout(()=>{ if(_isTest) nextStudyCard(); },230);
        _cdSessPaint();                        // 15.0 · 세션 칩 갱신 (제출 수)
        return;
    }
    document.querySelectorAll('#cdOpts .cd-opt').forEach(b=>{
        b.disabled=true;
        const bi=+b.dataset.i;
        const txt=String((c.opts||[])[bi]||'');
        // 답 표시도 인덱스 대신 '답 보기 텍스트'로 판정 (섞임·옛 데이터에도 정확)
        if(bi===c.answer||(txt&&txt===ansText)) b.classList.add('ok');
        else if(bi===i) b.classList.add('no');
    });
    cardCheer(right);
    const result=document.getElementById('cdAutoResult');
    if(result){
        result.className='cd-typeres '+(right?'ok':'no');
        const happy=['좋아요, 기억이 또렷해졌어요 ✨','정답! 한 걸음 더 익숙해졌어요','멋져요, 이 카드는 천천히 다시 만나요'];
        result.textContent=right?happy[Math.min(happy.length-1,Math.max(0,_streak-1))]
            :'괜찮아요 · 해설을 읽고 한 번만 더 만나볼게요';
    }
    const ex=document.getElementById('cdExplain');
    if(ex){
        ex.innerHTML=fmtExplain(c.note)||('<div class="ex-lead">'+window.esc('정답은 “'+((c.opts||[])[c.answer]||c.back||'')+'”입니다. 핵심 개념을 한 번 더 확인해 보세요.')+'</div>');
        // 18.0 · 보기를 섞은 화면(위 ①②③…)과 해설의 번호가 어긋나 보이지 않게,
        //   해설 항목을 '보이는 보기 순서'로 재정렬하고 번호를 다시 붙인다.
        //   fmtExplain 은 보기 '원래' 순서로 ①.. 를 숫자 배지(.ex-n=원본 인덱스+1)로
        //   바꾸는데, 화면 위 보기 번호는 섞인 c.__order 의 표시 위치(k+1)라
        //   그대로 두면 위 문제번호와 해설 번호가 달라 보인다.
        const ord=Array.isArray(c.__order)?c.__order:null;
        const exItems=Array.prototype.slice.call(ex.querySelectorAll('.ex-item'));
        if(ord&&exItems.length){
            // 배지를 '원본 인덱스'의 키로 삼아 항목을 찾는다 (본문이 ①③ 처럼
            //   건너뛰더라도 배열 위치가 아니라 실제 원문자 번호로 맞춘다.)
            const byOrig=new Map();
            exItems.forEach(el=>{
                const n=el.querySelector('.ex-n');
                const orig=parseInt((n&&n.textContent)||'0',10);
                if(orig>=1) byOrig.set(orig-1,el);
            });
            const leads=Array.prototype.slice.call(ex.children)
                .filter(el=>!el.classList.contains('ex-item'));
            ex.textContent='';
            leads.forEach(l=>ex.appendChild(l));
            ord.forEach((origIdx,dispIdx)=>{
                const el=byOrig.get(origIdx);
                if(!el) return;
                const n=el.querySelector('.ex-n');
                if(n) n.textContent=String(dispIdx+1);
                el.classList.add(origIdx===c.answer?'ex-right':'ex-wrong');
                ex.appendChild(el);
            });
        }else{
            exItems.forEach((el,k)=>el.classList.add(k===c.answer?'ex-right':'ex-wrong'));
        }
        ex.style.display='block';
    }
    document.getElementById('cdNextBtn').style.display='flex';
    _cdSessPaint();                        // 15.0 · 세션 칩 갱신
}
function nextStudyCard(){
    const p=_pendingAnswer; if(!p) return;
    const c=p.card, g=p.grade; _pendingAnswer=null;
    if(_mode==='learn'){
        // 11.7 · 연속 2번 맞히면 '익힘'. 틀리면 처음부터 다시.
        _mastery[c.id]=(g>0)?((_mastery[c.id]||0)+1):0;
        if((_mastery[c.id]||0)<2) _queue.push(c);      // 아직이면 뒤에 다시
        _qi++;
        if(_qi>=_queue.length){                        // 이번 묶음 끝 → 다음 묶음
            const left=_masterPool.filter(x=>(_mastery[x.id]||0)<2);
            if(left.length){
                const next=left.slice(0,7);
                _queue=next; _qi=0;
                shuffle(_queue);
            }
        }
        showCard(); return;
    }
    // 헷갈린 카드는 회차 끝에 딱 한 번만 다시 보여 준다 (시험은 그대로 진행)
    if(g===0&&!_isTest){
        c.__roundRetry=(c.__roundRetry||0)+1;
        if(c.__roundRetry<=1) _queue.push(c);
    }else delete c.__roundRetry;
    _qi++; showCard();
}
// 11.7 · 마스터 학습 진행 막대
function renderMastery(){
    const box=document.getElementById('cdMastery');
    if(!box) return;
    if(_mode!=='learn'||!_masterPool.length){ box.style.display='none'; return; }
    const done=_masterPool.filter(c=>(_mastery[c.id]||0)>=2).length;
    const pct=Math.round(done/_masterPool.length*100);
    box.style.display='flex';
    box.innerHTML='<span>익힘</span><div class="bar"><i style="width:'+pct+'%"></i></div>'+
                  '<b>'+done+' / '+_masterPool.length+'</b>';
}
function finishStudy(){
    document.getElementById('cdFlip').style.display='none';
    document.getElementById('cdQuiz').style.display='none';
    document.getElementById('cdFlipGrade').style.display='none';
    { const qb=document.getElementById('cdQBar'); if(qb) qb.style.display='none'; }   // 15.4
    document.getElementById('cdProgFill').style.width='100%';
    document.getElementById('cdExplain').style.display='none';
    document.getElementById('cdNextBtn').style.display='none';
    const auto=document.getElementById('cdAutoResult');
    if(auto){ auto.textContent=''; auto.className='cd-typeres'; }
    const st=document.getElementById('cdStreak'); if(st) st.style.display='none';
    const acc=_studied?Math.round(_rightN/_studied*100):0;
    if(_isTest){ renderTestReport(acc); otterFinish(acc); }
    else{
        document.getElementById('cdTestReport').style.display='none';
        document.getElementById('cdDone').style.display='';
        const title=document.querySelector('#cdDone b');
        const mastered=_mode==='learn'?_masterPool.filter(c=>(_mastery[c.id]||0)>=2).length:0;
        if(title) title.textContent=_mode==='learn'
            ? (mastered+'개를 익혔어요 🎓')
            : (acc>=80?'오늘의 기억이 반짝여요 ✨':acc>=50?'좋아요, 오늘 몫을 해냈어요':'천천히 익숙해지는 중이에요 🌱');
        document.getElementById('cdDoneSub').textContent=
            `${_studied}문제를 확인했어요 · 정답 ${_rightN}문제 (${acc}%)`;
        otterFinish(acc);
    }
    flushCardGrades();
    if(_studied) fetch('/api/notifications/study',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({session:_studySession,title:_deckCur&&_deckCur.title,
            studied:_studied,accuracy:acc})}).catch(()=>{});
}
// ── 시험 성적표 (11.1) ───────────────────────────────
function renderTestReport(acc){
    document.getElementById('cdDone').style.display='none';
    const el=document.getElementById('cdTestReport');
    const wrong=_testLog.filter(x=>!x.right);
    const sec=Math.max(1,Math.round((Date.now()-_testStart)/1000));
    const tstr=sec<60?sec+'초':Math.floor(sec/60)+'분 '+(sec%60)+'초';
    const word=acc>=90?'훌륭해요! 시험 준비 끝 🎉':acc>=70?'좋아요 · 오답만 한 번 더 보면 완벽해요':
               acc>=40?'절반은 잡았어요 · 오답 노트를 확인해 볼까요':'지금부터가 진짜 공부예요 🌱';
    el.innerHTML=`
      <div class="rep-top">
        <div class="rep-score" style="--rep-deg:${acc*3.6}deg">
          <span>${acc}점</span></div>
        <div class="rep-sum"><b>${word}</b>
          <span>${_testLog.length}문제 중 <b style="color:var(--accent)">${_testLog.length-wrong.length}문제</b> 정답 ·
          걸린 시간 ${tstr}<br>틀린 문제 ${wrong.length}개</span></div>
      </div>
      ${wrong.length?`<div class="ana-title" style="margin:2px 2px -4px;">오답 노트</div>
      <div class="rep-wrong">`+wrong.map(w=>`
        <div class="rep-w"><b>${window.esc(w.front)}</b>
          <div class="a"><i class="mine">내 답 · ${window.esc(w.pick||'(선택 없음)')}</i><br>
                         <i class="real">정답 · ${window.esc(w.real)}</i></div>
          ${w.note?`<div class="why">${fmtExplain(w.note)}</div>`:''}
        </div>`).join('')+`</div>`:''}
      <div class="cards-actions" style="justify-content:center;margin-top:4px;">
        ${wrong.length?'<button class="cd-btn primary" onclick="retryWrong()">오답만 다시 풀기</button>':''}
        <button class="cd-btn" onclick="studyAgain()">다시 시험</button>
        <button class="cd-btn" onclick="backToPick()">묶음 화면으로</button>
      </div>`;
    el.style.display='flex';
}
function retryWrong(){
    const ids=_testLog.filter(x=>!x.right).map(x=>x.id);
    const cards=((_deckCur&&_deckCur.cards)||[]).filter(c=>ids.indexOf(c.id)>=0);
    if(!cards.length){ window.toast('다시 풀 문제가 없어요',1800); return; }
    shuffle(cards);
    _startQueue(cards,'hard');
}
// 남아 있는 구버전 호출 호환. 새 UI는 '다음 문제' 버튼을 쓴다.
function gradeCard(g){
    if(!_pendingAnswer){
        const c=_queue[_qi]; if(!c) return;
        if(g===true) g=3; else if(g===false) g=0;
        _studied++; _pendingAnswer={card:c,grade:g}; queueCardGrade(c,g,null);
    }
    nextStudyCard();
}
// 9.1 · 문제를 풀다 나가도 진행률이 반드시 올라가게 한다.
function _stopMatch(){ if(_match){ clearInterval(_match.timer); _match=null; } }
function _savePending(){
    _stopMatch();
    try{ if(_pendingAnswer){ const p=_pendingAnswer; _pendingAnswer=null;
          queueCardGrade(p.card,p.grade,null); } }catch(e){}
}
async function endStudy(){          // 전체 목록으로
    _savePending();
    _queue=[]; _qi=0; _answered=false; _isTest=false;
    showCardsHome();
    await flushCardGrades();
    await loadDecks(true);
}
// 11.1 · 학습 중 ✕ → 전체 목록이 아니라 '이 묶음' 기본 화면으로 나간다
async function exitStudy(){
    if(!_deckCur){ await endStudy(); return; }
    await backToPick();
}
async function backToPick(){
    _savePending();
    _queue=[]; _qi=0; _answered=false; _isTest=false;
    if(!_deckCur){ showCardsHome(); await loadDecks(true); return; }
    showPane('cardsStats');
    _fcardTitle((_deckCur&&_deckCur.title)||'암기 카드');
    await flushCardGrades();
    try{
        const r=await fetch('/api/cards/deck/'+encodeURIComponent(_deckCur.id),{cache:'no-store'});
        const d=await r.json(); if(d&&d.ok&&d.deck) _deckCur=d.deck;
    }catch(e){}
    renderStudyPick();
}
// 학습 중 단축키: 1~9 보기 고르기 · Space 뒤집기 · Enter 다음 · Esc 나가기
document.addEventListener('keydown',e=>{
    const m=document.getElementById('cardsModal');
    if(!m||m.style.display==='none'||!m.style.display) return;
    const el=document.activeElement;
    if(el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.isContentEditable)) return;
    const studying=document.getElementById('cardsStudy').style.display!=='none';
    if(e.key==='Escape'){
        e.preventDefault(); e.stopPropagation();
        // 15.0 · 확장 모드가 먼저 접힌다 (음악플레이어 가짜 전체화면과 같은 우선순위)
        if(_fcardMax){ fcardMaxSet(false); return; }
        if(studying) exitStudy();
        else if(document.getElementById('cardsBrowse').style.display!=='none'
             || document.getElementById('cardsAnalytics').style.display!=='none') backToPick();
        else if(document.getElementById('cardsStats').style.display!=='none') showCardsHome();
        else closeCards();
        return;
    }
    if(e.key==='f'||e.key==='F'){      // 15.0 · F = 사이트 안에서 크게 / 원래대로
        e.preventDefault(); e.stopPropagation();
        fcardToggleMax();
        return;
    }
    if(!studying) return;
    const c=_queue[_qi];
    if(c&&c.type==='choice'&&!_answered&&/^[1-9]$/.test(e.key)){
        const btn=document.querySelectorAll('#cdOpts .cd-opt')[+e.key-1];
        if(btn){ e.preventDefault(); btn.click(); }
        return;
    }
    // 15.0 · 뒤집기 카드: 답을 본 뒤 1=아직이에요 · 2=알아요 (Anki 식 빠른 채점)
    if(c&&c.type!=='choice'&&_flipped&&!_answered&&(e.key==='1'||e.key==='2')){
        e.preventDefault(); flipGrade(e.key==='1'?0:3);
        return;
    }
    if(e.key===' '&&c&&c.type!=='choice'){ e.preventDefault(); e.stopPropagation(); flipCard(); return; }
    if(e.key==='Enter'){
        const nb=document.getElementById('cdNextBtn');
        if(nb&&nb.style.display!=='none'){ e.preventDefault(); nb.click(); }
    }
},true);

// ── 외부 노출: HTML onclick · live-updates · 메인 번들 ──
try{ window.openCards=openCards; }catch(e){}
try{ window.closeCards=closeCards; }catch(e){}
try{ window.showCardsHome=showCardsHome; }catch(e){}
try{ window.openPasteBox=openPasteBox; }catch(e){}
try{ window.pasteFromClipboard=pasteFromClipboard; }catch(e){}
try{ window.previewCards=previewCards; }catch(e){}
try{ window.makeCardsFromText=makeCardsFromText; }catch(e){}
try{ window.copyPrompt=copyPrompt; }catch(e){}
try{ window.loadDecks=loadDecks; }catch(e){}
try{ window.renderDeckPage=renderDeckPage; }catch(e){}
try{ window.deckPage=deckPage; }catch(e){}
try{ window.startStudy=startStudy; }catch(e){}
try{ window.renderStudyPick=renderStudyPick; }catch(e){}
try{ window.openBrowse=openBrowse; }catch(e){}
try{ window.renderBrowse=renderBrowse; }catch(e){}
try{ window.brPage=brPage; }catch(e){}
try{ window.openCardAnalytics=openCardAnalytics; }catch(e){}
try{ window.toggleTestPick=toggleTestPick; }catch(e){}
try{ window.beginStudy=beginStudy; }catch(e){}
try{ window.startMatch=startMatch; }catch(e){}
try{ window.matchTap=matchTap; }catch(e){}
try{ window.studyAgain=studyAgain; }catch(e){}
try{ window.showCard=showCard; }catch(e){}
try{ window.showHint=showHint; }catch(e){}
try{ window.flipCard=flipCard; }catch(e){}
try{ window.flipGrade=flipGrade; }catch(e){}
try{ window.pickOpt=pickOpt; }catch(e){}
try{ window.nextStudyCard=nextStudyCard; }catch(e){}
try{ window.finishStudy=finishStudy; }catch(e){}
try{ window.retryWrong=retryWrong; }catch(e){}
try{ window.endStudy=endStudy; }catch(e){}
try{ window.exitStudy=exitStudy; }catch(e){}
try{ window.backToPick=backToPick; }catch(e){}
try{ window.flushCardGrades=flushCardGrades; }catch(e){}
try{ window.fcardToggleMax=fcardToggleMax; }catch(e){}
try{ window.fcardMaxSet=fcardMaxSet; }catch(e){}
try{ window.fcardIsMax=fcardIsMax; }catch(e){}
try{ window.queueCardGrade=queueCardGrade; }catch(e){}
try{ window.healChoiceCard=healChoiceCard; }catch(e){}
try{ window.fmtExplain=fmtExplain; }catch(e){}
try{ window.deckMenu=deckMenu; }catch(e){}
try{ window.cardMenu=cardMenu; }catch(e){}
try{ window.reviewOne=reviewOne; }catch(e){}
})();
