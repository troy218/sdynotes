/* ═══════════ 11.2 · 집중 화면 (시계 · 스톱워치 · 타이머) ═══════════ */
(function(){
  const $=id=>document.getElementById(id);
  const ov=$('focusClock');
  if(!ov) return;
  const S={mode:'clock', open:false,
           sw:{run:false, base:0, acc:0, laps:[]},
           tm:{run:false, total:1500000, left:1500000, end:0, done:false, label:'집중 25분'}};
  let raf=null, idleT=null, wlock=null, ac=null;
  try{ const sv=JSON.parse(localStorage.getItem('sdy_focus_mode')||'null');
       if(sv&&['clock','stop','timer'].includes(sv.mode)) S.mode=sv.mode;
       if(sv&&sv.total) { S.tm.total=sv.total; S.tm.left=sv.total; S.tm.label=sv.label||S.tm.label; }
  }catch(e){}
  const save=()=>{ try{ localStorage.setItem('sdy_focus_mode',
      JSON.stringify({mode:S.mode,total:S.tm.total,label:S.tm.label})); }catch(e){}
      try{ if(window.pushSettings) window.pushSettings(); }catch(e){} };

  const p2=n=>String(n).padStart(2,'0');
  function swMs(){ return S.sw.acc + (S.sw.run? (performance.now()-S.sw.base) : 0); }
  function tmLeft(){ return S.tm.run? Math.max(0,S.tm.end-Date.now()) : S.tm.left; }
  function fmtSW(ms){
    const t=Math.max(0,ms), h=Math.floor(t/3600000), m=Math.floor(t/60000)%60,
          s=Math.floor(t/1000)%60, cs=Math.floor(t/10)%100;
    return (h? h+':'+p2(m) : String(m))+':'+p2(s)+'<span class="ms">.'+p2(cs)+'</span>';
  }
  function fmtGap(ms){
    const t=Math.max(0,ms), h=Math.floor(t/3600000), m=Math.floor(t/60000)%60,
          s=Math.floor(t/1000)%60, cs=Math.floor(t/10)%100;
    return (h? h+':'+p2(m) : String(m))+':'+p2(s)+'.'+p2(cs);
  }
  function fmtTM(ms){
    const t=Math.ceil(Math.max(0,ms)/1000), h=Math.floor(t/3600),
          m=Math.floor(t/60)%60, s=t%60;
    return h? (h+':'+p2(m)+':'+p2(s)) : (m+':'+p2(s));
  }

  // ── 화면 그리기 ──────────────────────────────────────────
  function paintClock(){
    const d=new Date();
    const h=d.getHours(), m=d.getMinutes(), s=d.getSeconds();
    $('fcClockTime').innerHTML=p2(h)+'<span class="cl">:</span>'+p2(m)+
        '<span class="sec">'+p2(s)+'</span>';
    const wk=['일','월','화','수','목','금','토'][d.getDay()];
    $('fcClockAP').textContent=(h<12?'오전':'오후')+' '+(((h+11)%12)+1)+'시';
    $('fcClockDate').textContent=`${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 ${wk}요일`;
  }
  function paintSW(){
    $('fcStopTime').innerHTML=fmtSW(swMs());
    $('fcStopTime').classList.toggle('run',S.sw.run);
  }
  function paintTM(){
    const left=tmLeft(), tot=Math.max(1,S.tm.total);
    $('fcTimerTime').textContent=fmtTM(left);
    $('fcTimerSub').textContent=S.tm.label||'';
    const bar=$('fcBar'), ring=$('fcRing'), C=289.03;
    const ratio=Math.max(0,Math.min(1,left/tot));
    bar.style.strokeDashoffset=String(C*(1-ratio));
    ring.classList.toggle('warn',ratio<=0.2&&left>0);
    ring.classList.toggle('over',left<=0);
    const done=(S.tm.done&&left<=0);
    ov.classList.toggle('done',done);
    $('fcDoneMsg').style.display=done?'':'none';
    $('fcTimerSub').style.display=done?'none':'';
  }
  function paint(){
    if(S.mode==='clock') paintClock();
    else if(S.mode==='stop') paintSW();
    else paintTM();
  }
  function loop(){
    if(!S.open){ raf=null; return; }
    paint();
    raf=requestAnimationFrame(loop);
  }

  // ── 조작 버튼 ────────────────────────────────────────────
  function btn(id,label,icon,cls){
    return `<button class="fc-btn ${cls||''}" data-fcb="${id}"><i class="${icon}"></i>${label}</button>`;
  }
  function renderControls(){
    const bt=$('fcBtns'), ps=$('fcPresets');
    ov.querySelectorAll('.fc-modes button').forEach(b=>
        b.classList.toggle('on',b.dataset.fcm===S.mode));
    $('fcClock').style.display=S.mode==='clock'?'':'none';
    $('fcStop').style.display =S.mode==='stop' ?'':'none';
    $('fcTimer').style.display=S.mode==='timer'?'':'none';
    if(S.mode==='clock'){
      ps.style.display='none';
      bt.innerHTML='';
      $('fcHint').textContent='';
    }else if(S.mode==='stop'){
      ps.style.display='none';
      bt.innerHTML=(S.sw.run
          ? btn('swPause','멈춤','ri-pause-fill','primary')+btn('swLap','구간 기록','ri-flag-line')
          : btn('swStart',(S.sw.acc?'이어서':'시작'),'ri-play-fill','primary')
            +(S.sw.acc?btn('swReset','초기화','ri-restart-line','ghost'):''));
      $('fcHint').textContent='';
      renderLaps();
    }else{
      ps.style.display='flex';
      const cur=S.tm.total;
      const P=[[60,'1분'],[180,'3분'],[300,'5분'],[600,'10분'],[900,'15분'],
               [1500,'25분','뽀모도로'],[2700,'45분'],[3600,'1시간']];
      ps.innerHTML=P.map(([sec,lb,tag])=>
        `<button class="fc-preset${cur===sec*1000?' on':''}" data-fcp="${sec}">${lb}${tag?`<em>${tag}</em>`:''}</button>`).join('')
        +`<span class="fc-custom"><input id="fcCM" type="number" min="0" max="999" inputmode="numeric" placeholder="분">`
        +`<span>:</span><input id="fcCS" type="number" min="0" max="59" inputmode="numeric" placeholder="초">`
        +`<button class="fc-preset" data-fcp="custom">맞춤</button></span>`;
      bt.innerHTML=(S.tm.run
          ? btn('tmPause','일시정지','ri-pause-fill','primary')
          : btn('tmStart',(tmLeft()>0&&tmLeft()<S.tm.total?'이어서':'시작'),'ri-play-fill','primary'))
          +btn('tmReset','초기화','ri-restart-line','ghost')
          +btn('tmPlus','+1분','ri-add-line','ghost');
      $('fcHint').textContent='';
    }
    paint();
  }
  function renderLaps(){
    const box=$('fcLaps'); const L=S.sw.laps;
    if(!L.length){ box.innerHTML=''; return; }
    const gaps=L.map(x=>x.gap);
    const mn=Math.min(...gaps), mx=Math.max(...gaps);
    box.innerHTML=L.map((x,i)=>{
      const cls=L.length>1?(x.gap===mn?' best':(x.gap===mx?' worst':'')):'';
      return `<div class="fc-lap${cls}"><b>#${i+1}</b>`+
             `<span class="gap">${fmtGap(x.gap)}</span>`+
             `<span class="tot">${fmtGap(x.total)}</span></div>`;
    }).reverse().join('');
    box.scrollTop=0;
  }

  // ── 동작 ────────────────────────────────────────────────
  function swStart(){ if(S.sw.run) return; S.sw.run=true; S.sw.base=performance.now();
    keepAwake(true); renderControls(); dot(); }
  function swPause(){ if(!S.sw.run) return; S.sw.acc=swMs(); S.sw.run=false;
    keepAwake(false); renderControls(); dot(); }
  function swReset(){ S.sw.run=false; S.sw.acc=0; S.sw.laps=[];
    keepAwake(false); renderControls(); dot(); }
  function swLap(){ if(!S.sw.run) return;
    const tot=swMs(), prev=S.sw.laps.length?S.sw.laps[S.sw.laps.length-1].total:0;
    S.sw.laps.push({total:tot,gap:tot-prev});
    if(S.sw.laps.length>200) S.sw.laps.shift();
    renderLaps(); }
  function tmStart(){
    if(S.tm.run) return;
    let left=S.tm.left;
    if(left<=0){ left=S.tm.total; }
    if(left<=0) return;
    S.tm.run=true; S.tm.done=false; S.tm.end=Date.now()+left;
    ov.classList.remove('done');
    keepAwake(true); renderControls(); dot(); tickTimer();
  }
  function tmPause(){ if(!S.tm.run) return; S.tm.left=tmLeft(); S.tm.run=false;
    keepAwake(false); renderControls(); dot(); }
  function tmReset(){ S.tm.run=false; S.tm.done=false; S.tm.left=S.tm.total;
    ov.classList.remove('done'); keepAwake(false); renderControls(); dot(); }
  function tmSet(ms,label){
    S.tm.run=false; S.tm.done=false; S.tm.total=Math.max(1000,ms); S.tm.left=S.tm.total;
    S.tm.label=label||''; ov.classList.remove('done'); save(); renderControls(); dot();
  }
  function tmPlus(){
    S.tm.total+=60000;
    if(S.tm.run) S.tm.end+=60000; else S.tm.left+=60000;
    S.tm.done=false; ov.classList.remove('done'); renderControls();
  }
  // 타이머는 창을 닫아도 계속 흐른다 (끝나면 알림음 + 배지)
  let tmT=null;
  function tickTimer(){
    clearTimeout(tmT);
    if(!S.tm.run) return;
    const left=tmLeft();
    if(left<=0){
      S.tm.run=false; S.tm.left=0; S.tm.done=true;
      keepAwake(false); ding(); dot();
      if(S.open){ ov.classList.add('done'); renderControls(); wake(); }
      else if(window.toast) toast('⏰ 타이머가 끝났어요',3200);
      return;
    }
    tmT=setTimeout(tickTimer,Math.min(1000,left));
  }
  function dot(){
    const el=$('clockDot');
    if(el) el.style.display=(S.sw.run||S.tm.run||(S.tm.done&&S.tm.left<=0))?'':'none';
  }
  // 끝났을 때 부드러운 알림음 (파일 없이 웹오디오로)
  function ding(){
    try{
      ac=ac||new (window.AudioContext||window.webkitAudioContext)();
      if(ac.state==='suspended') ac.resume();
      const t0=ac.currentTime;
      [0,0.42,0.84].forEach((off,i)=>{
        const o=ac.createOscillator(), g=ac.createGain();
        o.type='sine'; o.frequency.value=[880,1174.7,1567.9][i];
        g.gain.setValueAtTime(0.0001,t0+off);
        g.gain.exponentialRampToValueAtTime(0.22,t0+off+0.04);
        g.gain.exponentialRampToValueAtTime(0.0001,t0+off+0.38);
        o.connect(g).connect(ac.destination); o.start(t0+off); o.stop(t0+off+0.42);
      });
    }catch(e){}
    try{ if(navigator.vibrate) navigator.vibrate([180,90,180]); }catch(e){}
  }
  // 타이머·스톱워치가 도는 동안 화면이 꺼지지 않게
  async function keepAwake(on){
    try{
      if(on){
        if(!('wakeLock' in navigator)||wlock) return;
        wlock=await navigator.wakeLock.request('screen');
        wlock.addEventListener('release',()=>{ wlock=null; });
      }else if(wlock&&!S.sw.run&&!S.tm.run){ await wlock.release(); wlock=null; }
    }catch(e){ wlock=null; }
  }

  // ── 열기 / 닫기 / 조용해지면 버튼 숨기기 ──────────────────
  function wake(){
    ov.classList.remove('idle');
    clearTimeout(idleT);
    idleT=setTimeout(()=>{ if(S.open) ov.classList.add('idle'); },3500);
  }
  function open(mode){
    if(mode) S.mode=mode;
    S.open=true;
    ov.classList.add('show'); ov.classList.remove('closing');
    ov.setAttribute('aria-hidden','false');
    // 다른 떠 있는 창은 접어 둔다 (집중 화면이니까)
    try{ document.getElementById('srvPop').classList.remove('show'); }catch(e){}
    try{ document.getElementById('notifPop').classList.remove('show'); }catch(e){}
    renderControls(); wake();
    if(!raf) raf=requestAnimationFrame(loop);
    save();
  }
  function close(){
    if(!S.open) return;
    S.open=false;
    ov.classList.add('closing');
    setTimeout(()=>{ ov.classList.remove('show','closing','idle');
                     ov.setAttribute('aria-hidden','true'); },210);
    clearTimeout(idleT);
    if(raf){ cancelAnimationFrame(raf); raf=null; }
    save(); dot();
  }
  function setMode(m){
    if(S.mode===m) return;
    S.mode=m; ov.classList.toggle('done',m==='timer'&&S.tm.done&&S.tm.left<=0);
    renderControls(); wake(); save();
  }
  function toggleFull(){
    try{
      if(!document.fullscreenElement) ov.requestFullscreen&&ov.requestFullscreen();
      else document.exitFullscreen&&document.exitFullscreen();
    }catch(e){}
  }

  // ── 이벤트 ──────────────────────────────────────────────
  ov.addEventListener('click',e=>{
    wake();
    const m=e.target.closest('[data-fcm]'); if(m){ setMode(m.dataset.fcm); return; }
    const b=e.target.closest('[data-fcb]');
    if(b){
      const a=b.dataset.fcb;
      ({swStart,swPause,swReset,swLap,tmStart,tmPause,tmReset,tmPlus}[a]||(()=>{}))();
      return;
    }
    const p=e.target.closest('[data-fcp]');
    if(p){
      if(p.dataset.fcp==='custom'){
        const mm=parseInt($('fcCM').value||'0',10)||0, ss=parseInt($('fcCS').value||'0',10)||0;
        const ms=(mm*60+ss)*1000;
        if(ms<1000){ if(window.toast) toast('시간을 입력해 주세요',1600); return; }
        tmSet(ms,(mm?mm+'분 ':'')+(ss?ss+'초':'').trim()||'맞춤');
      }else{
        const sec=+p.dataset.fcp;
        tmSet(sec*1000, sec===1500?'집중 25분':(sec>=3600?(sec/3600)+'시간':(sec/60)+'분'));
      }
      return;
    }
  });
  ['mousemove','pointerdown','keydown','touchstart','wheel'].forEach(ev=>
    ov.addEventListener(ev,()=>{ if(S.open) wake(); },{passive:true}));
  $('fcCloseBtn').onclick=close;
  $('fcFullBtn').onclick=toggleFull;
  document.addEventListener('keydown',e=>{
    if(!S.open) return;
    const el=document.activeElement;
    const typing=el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.isContentEditable);
    if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); close(); return; }
    if(typing) return;
    const k=e.key.toLowerCase();
    if(k==='1'){ e.preventDefault(); setMode('clock'); }
    else if(k==='2'){ e.preventDefault(); setMode('stop'); }
    else if(k==='3'){ e.preventDefault(); setMode('timer'); }
    else if(k==='f'){ e.preventDefault(); toggleFull(); }
    else if(e.key===' '){
      e.preventDefault(); e.stopPropagation();
      if(S.mode==='stop') (S.sw.run?swPause:swStart)();
      else if(S.mode==='timer') (S.tm.run?tmPause:tmStart)();
    }
    else if(k==='l'){ if(S.mode==='stop') swLap(); }
    else if(k==='r'){ if(S.mode==='stop') swReset(); else if(S.mode==='timer') tmReset(); }
    wake();
  },true);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&S.open) paint(); });
  window.openFocusClock=m=>open(typeof m==='string'?m:null);
  window.closeFocusClock=close;
  // 14.26.0 · 해돌이 앱 실행용 손잡이 — 타이머 시작(분)·정지, 스톱워치 시작, 상태 읽기.
  //   화면을 직접 눌렀을 때와 같은 함수(tmSet·tmStart·swStart·open)를 그대로 부른다.
  window.sdyTimerStart=(min,label)=>{ try{
    const m=Math.max(1,Math.min(1440,Math.round(+min||25)));
    tmSet(m*60000,String(label||m+'분')); setMode('timer'); open('timer'); tmStart(); return true;
  }catch(e){ return false; } };
  window.sdyTimerStop=()=>{ try{ tmReset(); close(); return true; }catch(e){ return false; } };
  window.sdySwStart=()=>{ try{ setMode('stop'); open('stop'); swStart(); return true; }catch(e){ return false; } };
  window.sdyTimerState=()=>{ try{
    return {open:!!S.open,mode:S.mode,run:!!S.tm.run,left:tmLeft(),label:S.tm.label||''};
  }catch(e){ return null; } };
  dot();
})();
