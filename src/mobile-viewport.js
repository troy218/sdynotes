/* 14.14 · 폰 화면 위치 바로잡기 (CSS 로 안 되는 부분만)
   ① 음악바가 떠 있는지에 따라 엽스코드 칩을 위로 올린다 (body.has-mpbar)
   ② 드래그로 옮긴 인라인 좌표가 화면 밖에 남는 것을 막는다.
      폰은 화면을 돌리면 폭·높이가 통째로 바뀌는데, 예전엔 옮긴 좌표가
      px 로 그대로 남아 패널이 화면 밖으로 사라졌다. */
(function(){
  /* 세로 폰뿐 아니라 가로로 돌린 폰도 모바일 UI를 유지한다.
     낮은 화면 조건에는 coarse pointer를 함께 걸어 낮게 줄인 PC 창은 건드리지 않는다. */
  var PHONE_QUERY='(max-width:640px), (max-height:560px) and (pointer:coarse)';
  /* matchMedia 가 없는 환경(구형 WebView·테스트용 DOM)에서도 죽지 않게 */
  var PHONE=function(){
    try{
      if(window.matchMedia) return window.matchMedia(PHONE_QUERY).matches;
    }catch(e){}
    var touch=!!(window.navigator&&window.navigator.maxTouchPoints>0);
    return (window.innerWidth||1024)<=640 || (touch&&(window.innerHeight||768)<=560);
  };

  /* iOS 주소창·가상 키보드로 visual viewport가 바뀌어도 시트와 에디터가
     실제 보이는 높이를 쓴다. 이 변수는 모바일 미디어쿼리 안에서만 소비된다. */
  function syncViewport(){
    var root=document.documentElement,body=document.body;
    if(!root||!body) return;
    var mobile=PHONE();
    body.classList.toggle('sdy-mobile-ui',mobile);
    if(!mobile){ root.style.removeProperty('--sdy-mobile-vh'); return; }
    var vv=window.visualViewport;
    var h=vv&&vv.height ? vv.height : (window.innerHeight||0);
    if(h>0) root.style.setProperty('--sdy-mobile-vh',Math.round(h)+'px');
  }

  /* ① 음악바 표시 여부 → body.has-mpbar */
  function syncBar(){
    var pl=document.getElementById('musicPlayer');
    var on=!!(pl && pl.style.display!=='none' && pl.classList.contains('mp-bar'));
    document.body.classList.toggle('has-mpbar',on);
  }
  /* ② 떠 있는 창이 화면 밖에 있으면 도로 끌어들인다 */
  function clampFloats(){
    var app=document.getElementById('ypApp');
    if(app){
      if(PHONE()){
        /* 폰에서는 CSS 가 위치를 잡으므로 드래그가 남긴 좌표를 지운다 */
        app.style.left='';app.style.top='';app.style.right='';app.style.bottom='';
      }else if(app.classList.contains('open')){
        var l=parseFloat(app.style.left),t=parseFloat(app.style.top);
        if(isFinite(l)||isFinite(t)){
          /* 공용 경계 함수에만 판정을 맡긴다. 예전엔 여기서 innerWidth·innerHeight
             (화면 px) 로 한 번 먼저 잘라 냈는데, 창 폭·높이는 UI CSS px 라
             90% 배율에서 오른쪽·아래 10% 는 애초에 후보에서 사라졌다.
             미리 자르지 않으면 회전·리사이즈 뒤에도 같은 쪽에 남는다. */
          var c=sdyClampFloatingRect(app,isFinite(l)?l:window.sdyUiCss(app.getBoundingClientRect().left),
                                        isFinite(t)?t:window.sdyUiCss(app.getBoundingClientRect().top));
          app.style.left=c.x+'px'; app.style.top=c.y+'px';
        }
      }
    }
    var pl=document.getElementById('musicPlayer');
    if(pl && pl.classList.contains('mp-float')){
      if(PHONE()){ pl.style.right='';pl.style.left=''; }
      var t2=parseFloat(pl.style.top);
      if(isFinite(t2)){
        var pr=pl.getBoundingClientRect();
        var pc=sdyClampFloatingRect(pl,window.sdyUiCss(pr.left),t2);
        pl.style.top=pc.y+'px';
      }
    }
    var big=document.getElementById('mpBig');
    if(big && big.classList.contains('open')){
      var bl=parseFloat(big.style.left),bt=parseFloat(big.style.top);
      if(isFinite(bl)||isFinite(bt)){
        var br=big.getBoundingClientRect();
        var bc=sdyClampFloatingRect(big,isFinite(bl)?bl:window.sdyUiCss(br.left),isFinite(bt)?bt:window.sdyUiCss(br.top));
        big.style.left=bc.x+'px'; big.style.top=bc.y+'px';
      }
    }
  }
  function tick(){ syncViewport(); syncBar(); clampFloats(); }

  function boot(){
    var pl=document.getElementById('musicPlayer');
    if(pl) new MutationObserver(syncBar).observe(pl,{attributes:true,attributeFilter:['style','class']});
    var app=document.getElementById('ypApp');
    if(app) new MutationObserver(clampFloats).observe(app,{attributes:true,attributeFilter:['class']});
    addEventListener('resize',tick,{passive:true});
    addEventListener('orientationchange',function(){ setTimeout(tick,220); },{passive:true});
    if(window.visualViewport){
      window.visualViewport.addEventListener('resize',tick,{passive:true});
      window.visualViewport.addEventListener('scroll',syncViewport,{passive:true});
    }
    tick();
  }
  if(document.readyState==='loading') addEventListener('DOMContentLoaded',boot);
  else boot();
})();


