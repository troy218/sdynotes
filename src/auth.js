/* ═══════════════════════════════════════════════════════════════════
     16.2/16.4 · 로그인/회원 — 등록 OTP + 비밀번호 로그인
     로그인 없이도 사이트 전부를 쓸 수 있다. 로그인하면:
       · 엽스코드에서 고정 닉네임(회원 배지)
       · 내가 올린 곡에 작은 '올린 사람' 표시
     최초 등록만 이메일 인증 코드(OTP)를 쓰고 이후에는 이메일+비밀번호로 로그인한다.
     ═══════════════════════════════════════════════════════════════════ */
(function(){
  if(window.__sdyAuthInit) return; window.__sdyAuthInit=true;
  var $=function(id){return document.getElementById(id);};
  var KEY='sdy_auth_v1';
  var SDYA={token:'',user:null};
  try{
    var v=JSON.parse(localStorage.getItem(KEY)||'null');
    if(v&&v.token) SDYA=v;
  }catch(e){}

  function save(){ try{ localStorage.setItem(KEY,JSON.stringify({token:SDYA.token,user:SDYA.user})); }catch(e){} }
  function emit(){ try{ window.dispatchEvent(new CustomEvent('sdy-auth',{detail:{user:SDYA.user}})); }catch(e){} }
  function setUser(u){
    SDYA.user=u||null;
    if(SDYA.user && typeof SDYA.user.needs_password==='undefined') SDYA.user.needs_password=false;
  }

  window.sdyUser=function(){ return SDYA.user||null; };
  window.sdyAuthToken=function(){ return SDYA.token||''; };
  window.sdyAuthHeaders=function(){ return SDYA.token?{'x-sdy-auth':SDYA.token}:{}; };

  function paintBtn(){
    var b=$('sdyAccBtn'), d=$('sdyAccDot');
    if(!b) return;
    if(SDYA.user){
      b.classList.add('on');
      b.title='회원 · '+SDYA.user.nick+' (클릭하면 내 계정)';
      if(d) d.style.display='block';
    }else{
      b.classList.remove('on');
      b.title='로그인 · 회원 (선택)';
      if(d) d.style.display='none';
    }
  }

  // 부팅: 저장된 토큰 확인 (유효하면 세션 연장은 서버가)
  paintBtn();
  if(SDYA.token){
    fetch('/api/auth/me',{headers:{'x-sdy-auth':SDYA.token}})
      .then(function(r){ if(!r.ok) throw new Error('401'); return r.json(); })
      .then(function(d){
        if(d&&d.ok&&d.user){ setUser(d.user); save(); paintBtn(); emit(); }
        else throw new Error('bad');
      })
      .catch(function(){ SDYA.token=''; SDYA.user=null; save(); paintBtn(); emit(); });
  }

  // ── 모달 상태 ──
  var SA_EMAIL='', SA_COOL=0, SA_MODE='login';
  function saErr(msg){ var e=$('saErr'); if(!e) return; e.textContent=msg||''; e.style.display=msg?'block':'none'; }
  function show(id,on){ var el=$(id); if(el) el.style.display=on?'flex':'none'; }
  function saStep(step){
    show('saStepLogin',step==='login');
    show('saStepRegister',step==='register');
    show('saStepCode',step==='code');
    show('saStepDone',step==='done');
    var tabs=$('saTabs'); if(tabs) tabs.style.display=step==='done'?'none':'flex';
    saErr('');
  }
  function saPaintMode(){
    var log=$('saLoginTab'), reg=$('saRegisterTab'), sub=$('saSub'), ttl=$('saTtl');
    if(log) log.classList.toggle('on',SA_MODE==='login');
    if(reg) reg.classList.toggle('on',SA_MODE==='register');
    if(ttl) ttl.textContent=SA_MODE==='register'?'등록하기':'로그인';
    if(sub) sub.textContent=SA_MODE==='register'?'이메일 인증 뒤 비밀번호를 정해요':'이메일과 비밀번호로 로그인해요';
  }
  function saMode(mode){
    SA_MODE=mode==='register'?'register':'login';
    saPaintMode();
    saStep(SA_MODE==='register'?'register':'login');
    setTimeout(function(){
      try{ (SA_MODE==='register'?$('saRegEmail'):$('saEmail')).focus(); }catch(e){}
    },60);
  }
  window.sdyAuthMode=saMode;
  function clearPwFields(){
    ['saPw','saRegPw','saRegPw2','saOldPw','saNewPw','saNewPw2'].forEach(function(id){ try{ var x=$(id); if(x) x.value=''; }catch(e){} });
  }
  function saShowDone(){
    saStep('done');
    $('saTtl').textContent='내 계정';
    var sub=$('saSub'); if(sub) sub.textContent='계정 정보를 관리해요';
    if($('saMeNick')) $('saMeNick').textContent=SDYA.user.nick;
    if($('saMeEmail')) $('saMeEmail').textContent=SDYA.user.email;
    if($('saNickEdit')) $('saNickEdit').value=SDYA.user.nick;
    var need=$('saPwNeed'); if(need) need.style.display=SDYA.user.needs_password?'block':'none';
    clearPwFields();
  }
  function afterAuthSuccess(d, fromGate){
    SDYA.token=d.token;
    setUser(d.user);
    if(SDYA.user && (d.needs_password || SDYA.user.needs_password)) SDYA.user.needs_password=true;
    save(); paintBtn(); emit();
    if(window.toast) toast('로그인됐어요 · '+SDYA.user.nick,2000);
    var f=window.__sdyAfterLogin;
    if(f){ window.__sdyAfterLogin=null; try{ f(); }catch(e){} }
    // 비밀번호 설정이 필요한 기존 회원은 계정 화면에 남겨 자연스럽게 변경하도록 한다.
    if(SDYA.user.needs_password){ saShowDone(); return; }
    if(f||fromGate){ window.sdyAuthClose(); return; }
    saShowDone();
  }

  window.sdyAuthOpen=function(afterLogin){
    var w=$('sdyAuthWrap'); if(!w) return;
    if(typeof afterLogin==='function') window.__sdyAfterLogin=afterLogin;
    w.style.display='flex';
    if(SDYA.user){ saShowDone(); }
    else saMode('login');
  };
  window.sdyAuthClose=function(){
    var w=$('sdyAuthWrap'); if(w) w.style.display='none';
    window.__sdyAfterLogin=null; saErr('');
  };
  window.sdyAccClick=function(e){ if(e&&e.stopPropagation) e.stopPropagation(); window.sdyAuthOpen(); };

  function coolPaint(){
    var b=$('saResend'); if(!b) return;
    var left=Math.max(0,Math.ceil(SA_COOL-(Date.now()/1000)));
    b.disabled=left>0;
    b.innerHTML='<i class="'+(left>0?'ri-time-line':'ri-mail-send-line')+'"></i>'+
      (left>0?('다시 받기 · '+left+'초'):'코드 다시 받기');
  }
  setInterval(function(){
    try{
      if($('sdyAuthWrap').style.display==='flex'&&$('saStepCode').style.display==='block') coolPaint();
    }catch(e){}
  },1000);

  var EMAIL_RE=/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
  function validEmail(v){ return EMAIL_RE.test(String(v||'').trim().toLowerCase()); }
  function pwVal(id){ return ($(id)&&$(id).value)||''; }

  window.sdyAuthLogin=function(){
    saErr('');
    var email=($('saEmail').value||'').trim().toLowerCase();
    var pw=pwVal('saPw');
    if(!validEmail(email)){ saErr('이메일 주소를 바르게 입력해 주세요'); return; }
    if(!pw){ saErr('비밀번호를 입력해 주세요'); return; }
    var b=$('saLoginBtn'); if(b) b.disabled=true;
    fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:email,password:pw})})
      .then(function(r){ return r.json().then(function(j){ return {s:r.status,d:j}; }); })
      .then(function(res){
        var d=res.d; if(b) b.disabled=false;
        if(!d||!d.ok){ saErr((d&&d.error)||'로그인하지 못했어요'); return; }
        afterAuthSuccess(d,!!window.__sdyAfterLogin);
      })
      .catch(function(){ if(b) b.disabled=false; saErr('서버에 연결하지 못했어요'); });
  };

  window.sdyAuthSend=function(again){
    saErr('');
    var email=($('saRegEmail').value||'').trim().toLowerCase();
    if(!validEmail(email)){ saErr('이메일 주소를 바르게 입력해 주세요'); return; }
    SA_EMAIL=email;
    var btn=again?$('saResend'):$('saSendBtn'); if(btn) btn.disabled=true;
    fetch('/api/auth/otp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email})})
      .then(function(r){ return r.json().then(function(j){ return {s:r.status,d:j}; }); })
      .then(function(res){
        var d=res.d;
        if(btn) btn.disabled=false;
        if(!d||!d.ok){ saErr((d&&d.error)||'코드를 보내지 못했어요'); coolPaint(); return; }
        $('saSent').textContent=email+' 로 인증 코드를 보냈어요 · 10분 안에 입력해 주세요'+(d.dev_code?' · (개발 모드: 코드를 넣어뒀어요)':'');
        saPaintMode();
        saStep('code');
        SA_COOL=Date.now()/1000+45; coolPaint();
        if(d.dev_code){ $('saCode').value=d.dev_code; }
        setTimeout(function(){ try{ $('saCode').focus(); }catch(e){} },60);
      })
      .catch(function(){ if(btn) btn.disabled=false; saErr('서버에 연결하지 못했어요'); });
  };

  window.sdyAuthVerify=function(){
    saErr('');
    var code=($('saCode').value||'').replace(/\D/g,'');
    if(code.length!==6){ saErr('이메일에서 받은 6자리 코드를 입력해 주세요'); return; }
    var nick=($('saNick').value||'').trim();
    if(!nick){ saErr('고정 닉네임을 정해 주세요 (최대 16자)'); return; }
    var pw=pwVal('saRegPw'), pw2=pwVal('saRegPw2');
    if(pw.length<6){ saErr('비밀번호는 6자 이상으로 입력해 주세요'); return; }
    if(pw!==pw2){ saErr('비밀번호 확인이 맞지 않아요'); return; }
    var b=$('saVerifyBtn'); if(b) b.disabled=true;
    fetch('/api/auth/verify',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:SA_EMAIL,code:code,nick:nick,password:pw})})
      .then(function(r){ return r.json().then(function(j){ return {s:r.status,d:j}; }); })
      .then(function(res){
        var d=res.d;
        if(b) b.disabled=false;
        if(!d||!d.ok){ saErr((d&&d.error)||'등록하지 못했어요'); return; }
        afterAuthSuccess(d,!!window.__sdyAfterLogin);
      })
      .catch(function(){ if(b) b.disabled=false; saErr('서버에 연결하지 못했어요'); });
  };

  window.sdyAuthLogout=function(){
    fetch('/api/auth/logout',{method:'POST',headers:{'x-sdy-auth':SDYA.token}}).catch(function(){});
    SDYA.token=''; SDYA.user=null; save(); paintBtn(); emit();
    $('saTtl').textContent='로그인';
    try{
      ['saEmail','saRegEmail','saCode','saNick'].forEach(function(id){ var x=$(id); if(x) x.value=''; });
      clearPwFields();
    }catch(e){}
    saMode('login');
    if(window.toast) toast('로그아웃했어요',1600);
  };

  window.sdyNickChange=function(){
    saErr('');
    var nick=($('saNickEdit').value||'').trim();
    if(!nick){ saErr('닉네임을 입력해 주세요'); return; }
    fetch('/api/auth/nick',{method:'POST',
      headers:{'Content-Type':'application/json','x-sdy-auth':SDYA.token},
      body:JSON.stringify({nick:nick})})
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(!d||!d.ok){ saErr((d&&d.error)||'변경하지 못했어요'); return; }
        SDYA.user.nick=d.nick; save(); paintBtn(); emit(); saShowDone();
        if(window.toast) toast('고정 닉네임을 "'+d.nick+'" 로 바꿨어요',1800);
      })
      .catch(function(){ saErr('서버에 연결하지 못했어요'); });
  };

  window.sdyPwChange=function(){
    saErr('');
    var old=pwVal('saOldPw'), nw=pwVal('saNewPw'), nw2=pwVal('saNewPw2');
    if(!old){ saErr('현재 비밀번호를 입력해 주세요'); return; }
    if(nw.length<6){ saErr('새 비밀번호는 6자 이상으로 입력해 주세요'); return; }
    if(nw!==nw2){ saErr('새 비밀번호 확인이 맞지 않아요'); return; }
    var b=$('saPwChangeBtn'); if(b) b.disabled=true;
    fetch('/api/auth/password',{method:'POST',headers:{'Content-Type':'application/json','x-sdy-auth':SDYA.token},
      body:JSON.stringify({old_password:old,password:nw})})
      .then(function(r){ return r.json().then(function(j){ return {s:r.status,d:j}; }); })
      .then(function(res){
        var d=res.d; if(b) b.disabled=false;
        if(!d||!d.ok){ saErr((d&&d.error)||'변경하지 못했어요'); return; }
        if(SDYA.user) SDYA.user.needs_password=false;
        save(); paintBtn(); emit(); saShowDone();
        if(window.toast) toast('비밀번호를 변경했어요',1700);
      })
      .catch(function(){ if(b) b.disabled=false; saErr('서버에 연결하지 못했어요'); });
  };

  // Enter 로 다음 단계로, 오버레이 밖을 누르면 닫기
  document.addEventListener('keydown',function(e){
    if(e.key!=='Enter') return;
    var w=$('sdyAuthWrap'); if(!w||w.style.display!=='flex') return;
    if($('saStepLogin')&&$('saStepLogin').style.display!=='none'&&($('saStepLogin').contains(document.activeElement))){ e.preventDefault(); window.sdyAuthLogin(); }
    else if($('saStepRegister')&&$('saStepRegister').style.display!=='none'&&($('saStepRegister').contains(document.activeElement))){ e.preventDefault(); window.sdyAuthSend(); }
    else if($('saStepCode')&&$('saStepCode').style.display!=='none'&&($('saStepCode').contains(document.activeElement))){ e.preventDefault(); window.sdyAuthVerify(); }
    else if($('saStepDone')&&$('saStepDone').style.display!=='none'&&($('saStepDone').contains(document.activeElement))){ e.preventDefault(); window.sdyPwChange(); }
  });
  document.addEventListener('click',function(e){
    var w=$('sdyAuthWrap');
    if(w&&w.style.display==='flex'&&e.target===w) window.sdyAuthClose();
  },true);
  // 엽스코드 로그인 진입(게이트)에서 열 수 있게 전역 노출
  window.__sdyAuthState=SDYA;
})();
