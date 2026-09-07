/* ══════════════════════════════════════════════════════════════════════
   14.23.0 · 노트 해돌이 — 창 없이 바로 말하는 AI 노트 도우미
   ─────────────────────────────────────────────────────────────────────
   · 아이콘 버튼·뜨는 창이 없다. 노트(편집기)를 열으면 왼쪽 아래 해돌이 옆에 한 줄
     검색창(#aiAsk)이 붙어 있다. 질문을 적고 Enter 를 누르면 바로 묻는다(보내기
     버튼 없음). '개요 정리' 대신 검색창 바로 위 버튼 둘 — '이 페이지'(지금 보는
     쪽만) 와 '전체 페이지'(문서 전체) 로 나눠 묻는다.
   · 노트 질문/자유 질문은 사용자가 고르지 않는다 — 해돌이(task=chat)가 질문이 노트
     본문과 관련 있는지 스스로 판단해 답하고(서버 프롬프트가 첫 줄에 [[note]]/[[free]]
     표식을 실어 준다), 말풍선 머리에 '노트 질문 / 자유 질문' 딱지로 달아 준다.
   · 답은 해돌이 말풍선(#aiSay) — 창이 아니라 해돌이가 바로 말하는 느낌. 말풍선은
     X(#aiSayX)를 눌러 닫기 전까지 계속 떠 있다(자동 숨김 없음). 답이 길면 말풍선
     본문(#aiSayBody)을 아래로 스크롤해 전부 읽는다 — 다 말한 답은 맨 위부터
     보여 주고, 말하는 중에만(내가 위로 올려 보지 않았다면) 끝을 따라간다.
   · 해돌이에게 커서를 올리면 아이디어(전구)로 변신하고(18.0 블록), 해돌이를
     누르면 대화기록(#aiHist) — 지금까지 나눈 질문과 답을 다시 본다.
   · 모델 이름·소요 초 같은 기술 정보는 화면에 보여주지 않는다.
   · 모델 키는 여기에 없다. 브라우저는 /api/ai/ask 만 부르고, 키·프롬프트는
     server/src/routes/ai.js 가 들고 있다. 검색창 점(#aiDot) = 키 상태.
   · '이 페이지'·'전체 페이지' 는 노트를 여는 순간 미리 준비(warm) 해 둔다 —
     누르면 기다림 없이 바로 나온다(준비된 답이 없으면 SSE 스트림으로 말하듯 만든다).
   · 14.24.0 · ! 로 시작한 요청은 문서 상태와 revision을 캡처해 편집한다. 모델의
     @ 명령은 스트림 완료 뒤 허용 목록으로 검증하고, 한 번의 undo로 묶어 적용한다.
   · 14.26.0 · /앱 으로 시작한 요청이나 '시켜 달라'는 말은 앱 상태 스냅샷을
     잡아 앱 실행(task=app) 으로 보낸다. 노래·타이머·노트·발표·내보내기·찾기·
     창 열기 @ 명령을 순서대로 실행한다(음악 자동재생 확인은 0.7초 대기).
   ══════════════════════════════════════════════════════════════════════ */
(function(){
  if(window.__sdyAiInit) return; window.__sdyAiInit=true;
  var $=function(id){ return document.getElementById(id); };
  // 서버 AI_TASKS(outline·chat·edit)와 맞물린다 — outline 은 범위에 따라 딱지만 나뉜다.
  var KIND={note:'노트 질문',free:'자유 질문',outlinePage:'이 페이지',outlineDoc:'전체 페이지',edit:'문서 편집',app:'앱 실행',search:'인터넷 검색',draw:'그림',bug:'버그 신고'};
  var ctl=null, enabled=false, closedByUser=false;
  var lastText='', lastKind='', lastQ='';

  function meta(t){ var m=$('aiMeta'); if(m) m.textContent=t||''; }
  /* 말풍선 머리 딱지 — 노트 질문인지 자유 질문인지 해돌이가 판단한 결과 */
  function kindChip(k){
    var c=$('aiKind'); if(!c) return;
    if(k&&KIND[k]){ c.textContent=KIND[k]; c.hidden=false; }
    else c.hidden=true;
  }
  /* 말풍선 — 보여 줄 게 생기면 열리고, 닫기(#aiSayX) 전까지 계속 떠 있다.
     답이 길면 말풍선 본문(#aiSayBody)을 아래로 스크롤해서 전부 읽는다 —
     말하는 중엔 내가 끝을 보고 있을 때만 따라오고(위로 올려 보면 안 건드림),
     다 말한 답·기록에서 다시 연 답은 맨 위부터 보여 준다. */
  /* 다 말한 답을 말풍선에 그릴 HTML. 마크다운 렌더러(mdToHtml)가 곁에 없으면
     (조각만 떼어 돌리는 환경) 평문으로라도 반드시 보여 준다 — 말풍선이 통째로
     터지는 것보다 낫다. */
  function sayHtml(s){
    try{ if(typeof mdToHtml==='function') return mdToHtml(s); }catch(e){}
    var d=document.createElement('div');
    d.textContent=String(s==null?'':s);
    return '<span style="white-space:pre-wrap">'+d.innerHTML+'</span>';
  }
  function out(t,cls){
    var o=$('aiOut'), say=$('aiSay'), ty=$('aiTyping'), body=$('aiSayBody');
    if(!o||!say) return;
    if(closedByUser){ say.hidden=true; return; }          // 닫은 뒤엔 새 질문 전까지 조용히
    if(!inNote()){ say.hidden=true; return; }             // 해돌이는 노트 친구 — 노트 밖에 없다
    var s=(t==null?'':String(t));
    var follow=false;                                     // 스트림을 끝까지 따라갈지
    if(body&&cls&&s){
      try{ follow=(body.scrollHeight-body.scrollTop-body.clientHeight)<28; }
      catch(e){ follow=true; }
    }
    // 14.28.2 · 말하는 중(cls truthy)에는 평문으로 빠르게 흘리고,
    //   다 말한 뒤에만 마크다운(# 제목·**굵게**·목록·`코드`)을 렌더링한다 —
    //   스트림 중간에 토큰이 잘려 **짝이 안 맞거나 제목이 깜빡이는 걸 막기 위함.
    if(cls){
      o.textContent=s;
    }else{
      o.innerHTML=sayHtml(s);
    }
    o.classList.toggle('busy',!!cls);
    say.hidden=false;
    if(ty) ty.hidden=!(cls&&!s);                          // 첫 글자 전: 생각하는 점 세 개
    if(body){
      try{
        if(cls&&s){ if(follow) body.scrollTop=body.scrollHeight; }  // 말하는 중: 끝 따라가기
        else body.scrollTop=0;                            // 완성된 답: 맨 위부터 스크롤해 읽기
      }catch(e){}
    }
  }
  function busy(on){
    var st=$('aiStop'), cp=$('aiCopy');
    if(st) st.hidden=!on;
    if(cp) cp.hidden=on||!lastText;
  }

  // 로그인 토큰 — 있으면 uid 로, 없으면 ip 로 서버가 사용량을 센다
  function token(){
    try{ return (window.__sdyAuthState&&window.__sdyAuthState.token)||''; }catch(e){ return ''; }
  }
  // 노트 글은 편집기 다리(bridge)에게만 부탁한다 — 문서 구조를 직접 건드리지 않게.
  // scope:'page' = 지금 보고 있는 쪽, 'doc' = 문서 전체(기본).
  function noteText(scope){
    try{
      if(window.__sdyAiBridge&&typeof window.__sdyAiBridge.text==='function'){
        return String(window.__sdyAiBridge.text(scope==='page'?'page':'doc')||'');
      }
    }catch(e){}
    return '';
  }
  /* 20.2 · 멈추지 않는 글 읽기 — 아직 준비가 안 됐으면 null 을 돌려준다.
     미리 준비(warm)·버튼 표시처럼 '지금 당장 필요하진 않은' 일에 쓴다.
     null 이면 편집기가 한가할 때 조금씩 채워 두고, 다음 기회에 다시 묻는다.
     (사용자가 버튼을 실제로 눌렀을 때는 noteText 로 곧바로 읽는다 — 그땐 기다려도 된다) */
  function noteTextIfReady(scope){
    try{
      var b=window.__sdyAiBridge;
      if(b&&typeof b.textIfReady==='function'){
        var v=b.textIfReady(scope==='page'?'page':'doc');
        return v==null?null:String(v);
      }
    }catch(e){}
    return noteText(scope);
  }
  function inNote(){
    var ev=$('editorView');
    return !ev||ev.classList.contains('open');       // 편집기가 없으면(=테스트/구버전) 노트 안으로 본다
  }
  /* 해돌이 혼잣말(작은 말풍선) — 큰 답변 말풍선과 별개로 잠깐 뜨는 한마디.
     AI 가 대답하는 동안(ctl 이 살아 있는 동안)에는 아예 띄우지 않는다 — 답이
     이미 큰 말풍선(#aiSay)에 다 보이고 있는데 해돌이 머리 아래에 작은 말풍선이
     하나 더 떠서 같은 말이 두 번, 지저분하게 겹쳐 보이기 때문이다. */
  function otterLine(t){
    if(ctl) return;                                     // 대답 중엔 조용히 — 아래쪽 겹침 방지
    var b=$('noteOtterBubble'); if(!b||!t) return;
    b.textContent=String(t);
    b.classList.add('show');
    if(b._t) clearTimeout(b._t);
    b._t=setTimeout(function(){ b.classList.remove('show'); },2600);
  }
  /* 떠 있던 작은 말풍선을 바로 접는다 — 대답을 시작하는 순간 쓴다
     (말풍선(#aiSay)이 이미 열려 있으면 hidden 이 안 바뀌어 관찰자가 못 잡는다) */
  function otterHide(){
    var b=$('noteOtterBubble'); if(!b) return;
    if(b._t) clearTimeout(b._t);
    b.classList.remove('show');
  }

  /* ── 대화기록(#aiHist) — 해돌이를 누르면 열린다. 나눈 이야기는 최대 40개 ── */
  var hist=[], HIST_MAX=40;
  function fmtTime(at){
    try{
      var d=new Date(at);
      return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
    }catch(e){ return ''; }
  }
  function histPush(kind,q,a){
    hist.unshift({kind:kind||'', q:String(q||''), a:String(a||''), at:Date.now()});
    if(hist.length>HIST_MAX) hist.length=HIST_MAX;
    histPaint();
  }
  function histPaint(){
    var box=$('aiHistList'); if(!box) return;
    box.textContent='';
    if(!hist.length){
      var empty=document.createElement('div');
      empty.className='ai-hist-empty';
      empty.textContent='아직 나눈 이야기가 없어요. 옆 검색창에 적고 Enter 를 눌러 봐요.';
      box.appendChild(empty);
      return;
    }
    hist.forEach(function(h){
      var b=document.createElement('button');
      b.type='button'; b.className='ai-hist-item';
      var row=document.createElement('span'); row.className='ai-hist-row';
      if(KIND[h.kind]){
        var k=document.createElement('span'); k.className='ai-kind';
        k.textContent=KIND[h.kind];
        row.appendChild(k);
      }
      var t=document.createElement('span'); t.className='ai-hist-t';
      t.textContent=fmtTime(h.at);
      row.appendChild(t);
      var q=document.createElement('span'); q.className='ai-hist-q';
      var qtxt=String(h.q||'').trim();
      q.textContent=qtxt||(h.kind==='outlineDoc'?'전체 페이지 정리해 줘':'이 페이지 정리해 줘');
      var a=document.createElement('span'); a.className='ai-hist-a';
      a.textContent=String(h.a||'').replace(/\s+/g,' ').trim();
      b.appendChild(row); b.appendChild(q); b.appendChild(a);
      b.onclick=function(){ histShow(h); };
      box.appendChild(b);
    });
  }
  /* 기록에서 고륵면 그 답을 말풍선으로 다시 보여 준다 */
  function histShow(h){
    window.sdyAiStop();
    closedByUser=false;
    lastText=String(h.a||''); lastKind=h.kind||''; lastQ=h.q||'';
    kindChip(lastKind);
    out(lastText); busy(false);
    meta('대화기록 · '+fmtTime(h.at)+' 에 나눈 이야기예요');
    var hh=$('aiHist'); if(hh) hh.hidden=true;
  }
  window.sdyAiHistToggle=function(){
    var h=$('aiHist'); if(!h) return;
    h.hidden=!h.hidden;
    if(!h.hidden) histPaint();
  };

  /* ── 해돌이 판단 표식 — 서버가 답 첫 줄에 [[note]] / [[free]] 를 달아 준다 ──
     조각이 흘러오는 중간에는 표식이 깨진 채 화면에 나오지 않도록,
     표식 길이(8자)가 찰 때까지는 내용을 참는다. */
  function parseChat(acc){
    var s=String(acc==null?'':acc);
    var m=/^\[\[(note|free|edit|app|search|draw)\]\][ \t]*\r?\n?/.exec(s);
    if(m) return {kind:m[1], text:s.slice(m[0].length)};
    var head=s.slice(0,10);
    if(s&&('[[note]]'.indexOf(head)===0||'[[free]]'.indexOf(head)===0||'[[edit]]'.indexOf(head)===0||'[[app]]'.indexOf(head)===0||'[[search]]'.indexOf(head)===0||'[[draw]]'.indexOf(head)===0)) return {wait:true};
    return {kind:'', text:s};                     // 표식이 없으면 딱지 없이 그대로
  }

  /* ── 14.24.0 · 해돌이 문서 편집 — ! 요청 → 검증된 @ 명령 → 한 번에 적용 ──
     14.25.0 · !, /편집, /edit, "편집:" 접두사는 편집을 강제한다. 접두사가 없어도
     '고쳐 달라'는 말(아래 EDIT_HINT)이면 편집으로 자동 라우팅하고, 애매하면
     chat 서버가 [[edit]] 표식으로 넘긴다(노트/자유 질문과 같은 방식).
     스트림 중에는 명령 원문을 노출하거나 부분 적용하지 않고, done을 받은 뒤에만
     파싱한다. 편집기 bridge가 요청 시점 revision을 다시 확인해 오래된 계획도 막는다. */
  var EDIT_PRE=/^\s*(?:[!！]+|\/(?:edit|수정|편집)(?=\s|$)|(?:수정|편집)\s*[:：])\s*/;
  function editCmdOf(q){
    if(!EDIT_PRE.test(q||'')) return null;
    return String(q).replace(EDIT_PRE,'').trim();
  }
  // '고쳐 달라'는 말인지 — 맞으면 ! 없이도 편집으로 보낸다. 물음 말투(?, 어떻게,
  // 왜, 알려줘…)가 섞여 있으면 질문으로 둔다. 노트 밖이나 편집 준비 전에는 안 쓴다.
  var EDIT_HINT=/(바꿔|변경해|수정해|고쳐|편집해|옮겨|이동해|이동시켜|지워|삭제해|없애|추가해|넣어|만들어|키워|줄여|크게 해|작게 해|늘려|맨 위|맨 아래|위쪽으로|아래쪽으로|왼쪽으로|오른쪽으로|가운데로|중앙으로|정렬해|맞춰|글꼴|글자 ?크기|글씨 ?크기|굵게|밑줄|취소선|기울임|형광펜|하이라이트|칠해|강조|중요한 (내용|부분|곳)|빨갛게|파랗게|노랗게|초록색으로|표(를| 만들어| 그려| 추가| 지워)|표 ?(전체)? ?(지우|삭제|없애)|정돈|깔끔하|보기 좋|가지런|줄 ?맞춰|겹치(지|는) ?(않|않게|만)|쪽으로 (가|이동|넘어가|보내)|페이지.*이동|붙여넣|클립보드|복사해|오타|맞춤법|띄어쓰기|줄바꿈|제목을|부제를|제목으로|제목만|덧붙여|이어서 써|마지막에 써|수식 (넣어|만들어|추가해|써줘|그려줘)|공식 (넣어|만들어|추가해|써줘)|분수|적분|시그마|루트|근의 ?공식|매스|LaTeX|라텍)/;;
  var QUESTION_HINT=/[?？]|어떻게|어떤|왜|무엇|뭐야|뭔지|뭔가|언제|어디|누가|누구|몇|얼마|인지|인가요|인가\b|알려줘|설명해|뜻이|의미가|방법|차이가|이유가|물어|질문|요약해줘|정리해줘|알려줄래|해석해|번역해/;
  function canEdit(){
    return inNote()&&(window.__sdyAiBridge&&typeof window.__sdyAiBridge.apply==='function');
  }
  function looksLikeEdit(q){
    q=String(q||'');
    if(!q||editCmdOf(q)!=null) return false;
    if(!canEdit()) return false;
    return EDIT_HINT.test(q)&&!QUESTION_HINT.test(q);
  }
  // 14.27.0 · 여러 대화를 묶어 문맥으로 — 예전엔 직전 편집 1턴만 실었다.
  //   이제 대화기록(질문·편집·실행 전부)에서 최근 CTX_TURNS턴을 오래된
  //   순서로 싣는다. "@ask 되묻기 → 짧은 답"은 물론 "아까 그 상자",
  //   "방금 만든 표" 같은 이어서 하기도 해돌이가 알아듣는다.
  var CTX_TURNS=5, CTX_Q=240, CTX_A=300, CTX_MAX=5200;
  function ctxCut(value,max){
    var v=String(value==null?'':value).replace(/\s+/g,' ').trim();
    return v.length>max?v.slice(0,max)+'…':v;
  }
  function aiCtxText(){
    var turns=[],i;
    for(i=0;i<hist.length&&turns.length<CTX_TURNS;i++){
      var h=hist[i]; if(!h) continue;
      var q=String(h.q||'').trim();
      if(!q) continue;                      // 개요 정리(요청 없는 답)는 문맥에서 뺀다
      turns.push({kind:h.kind,q:q,a:String(h.a||'').trim()});
    }
    if(!turns.length) return '';
    var out=[],n=turns.length;
    for(i=n-1;i>=1;i--){                    // hist는 최신이 앞 — 오래된 것부터 적는다
      out.push((n-i)+') 앞선 대화('+(KIND[turns[i].kind]||'대화')+'): '
        +ctxCut(turns[i].q,CTX_Q)+' → '+ctxCut(turns[i].a,CTX_A));
    }
    out.push('이전 요청: '+ctxCut(turns[0].q,CTX_Q));
    out.push('이전 결과: '+ctxCut(turns[0].a,CTX_A));
    return out.join('\n').slice(0,CTX_MAX);
  }
  function editCtxText(){ return aiCtxText(); }
  window.sdyAiLooksLikeEdit=looksLikeEdit;   // 테스트·디버그용 말투 감지 노출
  /* 14.30.0 · 해돌이 펜 그림 — /그림·/draw 접두사 또는 "그려 줘" 말투면
     run('draw') 로 보낸다. 표·수식·그래프·차트처럼 문서 편집이 자연스러운
     말은 편집으로 남겨 둔다. chat 서버가 [[draw]] 로 넘기는 경로도 있다. */
  var DRAW_PRE=/^\s*(?:\/(?:draw|그림)(?=\s|$)|그림\s*[:：])\s*/;
  function drawCmdOf(q){
    if(!DRAW_PRE.test(q||'')) return null;
    return String(q).replace(DRAW_PRE,'').trim();
  }
  var DRAW_HINT=/(그려 ?(줘|주|라|봐|줄래)|그려 ?달라|그림(을|을 ?그려| ?그려| ?하나| ?한 ?장)|스케치|캐리커처|일러스트|낙서)/;
  var DRAW_NO=/(표|수식|그래프|차트|도표|다이어그램|순서도|플로우 ?차트|마인드 ?맵|타임라인|개체 ?관계)/;
  function looksLikeDraw(q){
    q=String(q||'');
    if(!q||drawCmdOf(q)!=null) return false;
    if(!canEdit()) return false;                 // 펜 그림은 노트가 열려 있어야 한다
    if(QUESTION_HINT.test(q)) return false;      // 물어보는 말투는 질문으로
    if(!DRAW_HINT.test(q)) return false;
    if(DRAW_NO.test(q)) return false;            // 표·그래프 류는 문서 편집으로
    return true;
  }
  window.sdyAiLooksLikeDraw=looksLikeDraw;   // 테스트·디버그용

  /* 14.31.0 · 해돌이 사진 넣기 — "○○ 사진 넣어 줘" 는 펜으로 그리는 일이
     아니라 인터넷에서 찾은 **실제 사진**을 노트에 넣는 일이다.
     '그려 줘'와 갈라야 하므로 ① 사진 낱말(사진·이미지·포토·짤)과
     ② 넣어/추가해/찾아 달라는 말이 함께 있을 때만 사진으로 본다
     ("고양이 사진 그려 줘" 처럼 '그리기' 동사가 있으면 펜 그림이다).
     사진만 부탁하면 모델을 거치지 않고 곧바로 넣고(runPhoto),
     글도 함께 부탁하면 편집기가 글(@add)과 사진(@img)을 함께 놓는다. */
  var PHOTO_PRE=/^\s*(?:\/(?:img|photo|pic|이미지|사진)(?=\s|$)|(?:사진|이미지)\s*[:：])\s*/;
  var PHOTO_NOUN=/(사진|이미지|포토|짤)/;
  var PHOTO_VERB=/(넣|추가|찾|붙|삽입|올려|올리|실어|실고|집어 ?넣|첨부|가져|보여 ?줘)/;
  // "설명하고 사진도" 처럼 글까지 부탁한 요청 — 편집기가 글 아래에 사진을 놓는다.
  var PHOTO_WITH_TEXT=/(설명|정리|요약|소개|정의|개요|항목|특징|써 ?줘|적어|작성|만들어|글(도|을|을 ?써)|내용|아래에 ?(글|설명|정리)|위에 ?(글|설명))/;
  // 편집기에 붙이는 한 줄 지침 — 모델이 사진을 '글로 적은 주소'로 대신하는 사고를 막는다.
  var PHOTO_GUIDE='(사진은 반드시 @img 명령으로만 넣어 줘 — 사진 주소(URL)를 글로 적거나 [사진] 같은 빈 칸을 만들지 마. 글도 부탁했으면 @add로 글을 먼저 쓰고 그 아래 같은 쪽에 @img를 놓아 줘.)';
  function photoCmdOf(q){
    if(!PHOTO_PRE.test(q||'')) return null;
    return String(q).replace(PHOTO_PRE,'').trim();
  }
  function looksLikePhoto(q){
    q=String(q||'');
    if(!q) return false;
    if(!canEdit()) return false;                 // 사진을 넣을 노트가 열려 있어야 한다
    if(QUESTION_HINT.test(q)) return false;      // 물어보는 말투는 질문으로
    if(!PHOTO_NOUN.test(q)) return false;        // '사진·이미지' 낱말이 없으면 그림/편집이다
    if(/그려|그리기|스케치|낙서|캐리커처/.test(q)) return false;   // '사진 그려 줘'는 펜 그림
    if(!PHOTO_VERB.test(q)) return false;        // 넣어·추가해·찾아 달라는 말이 있어야 사진
    return true;
  }
  window.sdyAiLooksLikePhoto=looksLikePhoto;   // 테스트·디버그용

  /* ── 14.26.0 · 해돌이 앱 실행 — 음악·타이머·노트·발표·내보내기·찾기·창 열기 ──
     /앱, /app, "앱:" 접두사는 앱 실행을 강제한다. 접두사가 없어도 앱 기능을
     시키는 말(아래 APP_HINT)이면 앱 실행으로 자동 라우팅하고, 애매하면
     chat 서버가 [[app]] 표식으로 넘긴다(질문·편집과 같은 방식).
     편집과 겹치는 말("발표 자료 만들어줘")은 문서 동사가 있으면 편집으로 둔다.
     단 "새 노트"는 앱이다. 스트림 중에는 부분 실행하지 않고, done을 받은
     뒤에만 파싱해 순서대로 실행한다. */
  var APP_PRE=/^\s*(?:\/(?:app|앱)(?=\s|$)|앱\s*[:：])\s*/;
  function appCmdOf(q){
    if(!APP_PRE.test(q||'')) return null;
    return String(q).replace(APP_PRE,'').trim();
  };
  // 앱 명사 — 노래·타이머·노트·발표·내보내기·찾기·창 열기·이퀄라이저 말투.
  var APP_HINT=/(틀어|재생해|일시 ?정지|멈춰|정지해|다음 ?곡|이전 ?곡|노래|음악|BGM|랜덤 ?믹스|믹스로|플레이어|볼륨|소리 (키워|줄여|크게|작게)|이퀄라이저|이큐|equalizer|\bEQ\b|베이스 ?부스트|보컬 ?강조|타이머|스톱워치|스탑워치|집중 ?시계|시계 (열어|보여|틀어)|새 노트|노트를? (열어|닫아|만들어)|노트 (목록|열어|닫아|만들어)|다른 노트|발표(를| 모드| 시작| 해)|프레젠테이션|내보내|PDF로|피디에프|찾기 (열어|보여)|스티커|단어 ?카드|설정(을| 화면| 열어| 보여))/;
  // 앱 동사 — 명사만 있고 이 동사가 없는데 문서 동사가 있으면 편집으로 둔다.
  var APP_VERB=/(틀어|재생|멈춰|정지|일시정지|다음 ?곡|이전 ?곡|열어|보여|닫아|시작해|내보내|찾아|검색해|보여줘|켜줘|꺼줘|켜|꺼|키워|줄여|맞춰|재줘|설정|바꿔|초기화|리셋)/;
  var APP_DOCVERB=/(만들|고치|바꾸|옮기|지우|삭제|추가|정리)/;
  /* 14.29.3 · 번역은 뜻이 둘이다.
       (가) "이 페이지(노트·문서)를 한국어로 바꿔 줘" → 노트에 있는 기능 그대로,
            그 쪽/문서의 글상자를 번역문으로 바꾸는 '네이티브 번역'을 실행한다(앱 실행).
       (나) 그냥 "번역해 줘" → 해돌이가 번역해서 말풍선으로 말한다(질문).
     가르는 기준: 번역하라는 말 + 대상이 '페이지·쪽·노트·문서·본문·전체' 처럼
     노트 자체일 것. 단 '알려 줘·말해 줘·뜻이 뭐야'처럼 말로 듣겠다는 낌새가 있으면
     (나)로 둔다. 노트를 열지 않았으면 바꿀 문서가 없으니 역시 (나)다. */
  var TR_WORD=/(번역|translate|한국어로|한글로|영어로|일본어로|중국어로)/i;
  var TR_SCOPE=/(페이지|페이지들|쪽|노트|문서|본문|전체|여기 ?있는 ?(글|내용))/;
  var TR_SAY=/(알려|말해|설명|읽어|들려|보여 ?줘|무슨 ?뜻|뜻이|의미가|해석해서 ?(알려|말)|답만)/;
  function looksLikeTranslateApp(q){
    q=String(q||'');
    if(!TR_WORD.test(q)) return false;
    if(!TR_SCOPE.test(q)) return false;
    if(TR_SAY.test(q)) return false;
    if(!inNote()) return false;                 // 바꿀 노트가 없으면 말로 답한다
    return true;
  }
  window.sdyAiLooksLikeTranslate=looksLikeTranslateApp;   // 테스트·디버그용
  function looksLikeApp(q){
    q=String(q||'');
    if(!q||appCmdOf(q)!=null) return false;
    if(looksLikeTranslateApp(q)) return true;   // '이 쪽을 한국어로' = 기능 실행
    if(QUESTION_HINT.test(q)) return false;
    if(!APP_HINT.test(q)) return false;
    if(/새 ?노트/.test(q)) return true;
    if(/노트(를)? 만들어/.test(q)) return true;
    if(!APP_VERB.test(q)&&APP_DOCVERB.test(q)) return false;
    return true;
  }
  // 실행 문맥도 같은 대화 뭉치를 쓴다 — @ask 되묻기 뒤의 짧은 답도 이어진다.
  function appCtxText(){ return aiCtxText(); }
  window.sdyAiLooksLikeApp=looksLikeApp;   // 테스트·디버그용 말투 감지 노출

  /* 14.39.0 · 버그 일지 — 앱에서 겪은 문제를 말로 알려 주면 서버(task=bug)가
     정리하고 설정 → 버그 일지에 기록한다(누구나 볼 수 있는 일지).
     명시적 신고(/버그·버그 신고:·신고:…)뿐 아니라 '버그·오류·에러·고장' 낱말,
     또는 기능 이름 + '안 돼/멈춰/겹쳐…' 불만이면 신고로 알아듣는다.
     문서를 고치는 부탁('버그 단어 지워 줘')은 버그 신고가 아니라 편집이다. */
  var BUG_PRE=/^\s*(?:\/(?:bug|버그|신고)(?=\s|$)|(?:버그\s*신고|신고|버그)\s*[:：])\s*/;
  function bugCmdOf(q){
    if(!BUG_PRE.test(q||'')) return null;
    return String(q).replace(BUG_PRE,'').trim();
  }
  window.sdyAiBugCmdOf=bugCmdOf;                 // 테스트·디버그용
  var BUG_WORD=/(?:버그|오류|에러|고장|렉|버벅|말썽)/;
  var BUG_THING=/(?:표|글(?:자|상자)?|사진|이미지|그림|페이지|쪽|노트|저장|동기화|붙여넣기|복사|붙이기|이동|삭제|폴더|휴지통|음악|노래|소리|재생|타이머|알람|검색|내보내기|가져오기|발표|스티커|단어 ?카드|설정|배경(?:화면)?|글꼴|크기|스크롤|확대|축소|펜|지우개|링크|북마크|재생 ?목록|미리보기|업로드|채팅|친구|로그인|화면|버튼|창|입력|타이핑|줄바꿈|모드|기능|동작|방식|영상|동영상|이상)/;
  var BUG_BAD=/(?:안|못|자꾸|계속|갑자기)\s*(?:돼|되는데|되네|먹혀|들어가|넘어가|보여|나와|열려|눌러|지워|저장|받아|붙어|움직여|사라져|튀어|멈춰|꺼져|닫혀|겹쳐|깨져|느려|떠|나가|켜져)|(?:멈춰|멈춰 ?버려|멈추(?:네|는데|었)?|튕겨|튕김|다운 ?(?:돼|됨|먹어))|겹쳐 ?(?:보여|서|요)?|겹치(?:네|는데|고|더라)|사라져 ?(?:요|버려)?|안 보여|안 열려|안 눌러|안 지워|안 움직여|깨지(?:네|는데)|느려 ?(?:요|지|진)?|렉 ?(?:이|이)? ?걸려|이상(?:해(?:요)?|한데|하게|하네)/;
  var BUG_EDIT_ASK=/(?:지워 ?줘|삭제해 ?줘|없애 ?줘|넣어 ?줘|추가해 ?줘|바꿔 ?줘|고쳐 ?줘|지워 ?주세요|삭제해 ?주세요)/;
  function looksLikeBug(q){
    q=String(q||'');
    if(!q||bugCmdOf(q)!=null) return false;
    if(QUESTION_HINT.test(q)) return false;
    if(BUG_WORD.test(q)){
      // '문서에서 버그라는 단어를 지워 줘' 류는 노트 편집 부탁이지 신고가 아니다
      if(!BUG_BAD.test(q)&&BUG_EDIT_ASK.test(q)) return false;
      return true;
    }
    return BUG_THING.test(q)&&BUG_BAD.test(q);
  }
  window.sdyAiLooksLikeBug=looksLikeBug;   // 테스트·디버그용

  function aiCapture(){
    try{
      var bridge=window.__sdyAiBridge;
      if(bridge&&typeof bridge.capture==='function'){
        var got=bridge.capture()||{};
        return {text:String(got.text||''),revision:String(got.revision||'')};
      }
      if(bridge&&typeof bridge.snapshot==='function')
        return {text:String(bridge.snapshot()||''),revision:''};
    }catch(e){}
    return {text:'',revision:''};
  }
  function editProgress(acc){
    var count=(String(acc||'').match(/^\s*@(?:mv|sz|bx|tx|rp|ap|st|hl|add|math|ltx|formula|mtx|latex|수식|tbl|tsz|tmv|tcell|tdel|del|tidy|goto|newpage|title|clip|clipin|copy)\b/gmi)||[]).length;
    return count?('문서 편집안을 만드는 중… · 변경 '+count+'개'):'문서를 살펴보는 중…';
  }
  // 클립보드 명령(@clip·@clipin·@copy)이 섞이면 bridge.apply가 Promise를
  // 돌려준다 — 그때는 문자열 대신 Promise를 돌려주고 run()이 이어받는다.
  function editApplyDone(raw,capture){
    var parsed=window.sdyAiEditParse
      ?window.sdyAiEditParse(raw):{ops:[],say:'',ask:'',dropped:0};
    var finish=function(res){
      res=res||{applied:0,failed:0,notes:[],stale:false};
      if(res.stale){
        return (res.notes&&res.notes[0])
          ||'기다리는 동안 문서가 바뀌어서 적용하지 않았어요 · 다시 요청해 주세요';
      }
      var applied=Number(res.applied||0),failed=Number(res.failed||0)+Number(parsed.dropped||0);
      var ask=String(parsed.ask||'').trim();
      var say=String(parsed.say||'').trim()
        ||(applied?'요청대로 문서를 고쳤어요 해돌~':(ask?'':'바꿀 내용을 찾지 못했어요'));
      var counts=[];
      if(applied) counts.push('적용 '+applied+'개');
      if(failed) counts.push('건너뜀 '+failed+'개');
      var output=say+(counts.length?'\n\n'+counts.join(' · '):'');
      if(res.notes&&res.notes.length) output+=(output?'\n':'')+res.notes.join('\n');
      // @ask — 되묻기. 답을 적어 보내면 이전 대화 문맥과 함께 이어서 한다.
      if(ask) output+=(output?'\n\n':'')+ask+'\n(알려주면 바로 이어서 할게요 해돌~)';
      if(applied){
        try{ if(window.toast) window.toast('해돌이가 문서를 고쳤어요 · Ctrl+Z로 되돌릴 수 있어요',2600); }catch(e){}
      }
      return output;
    };
    if(parsed.ops.length){
      try{
        var bridge=window.__sdyAiBridge;
        if(bridge&&typeof bridge.apply==='function'){
          var r=bridge.apply(parsed.ops,capture&&capture.revision);
          if(r&&typeof r.then==='function') return r.then(finish,finish);
          return finish(r);
        }
        return finish({applied:0,failed:parsed.ops.length,stale:false,
          notes:['문서 편집 연결을 찾지 못했어요 · 페이지를 새로고침해 주세요']});
      }catch(e){
        return finish({applied:0,failed:parsed.ops.length,stale:false,
          notes:['문서에 적용하지 못했어요 · 다시 시도해 주세요']});
      }
    }
    return finish(null);
  }

  /* ── 14.26.0 · 앱 상태 스냅샷 — 모델이 고를 수 있게 노트 목록·음악·집중 화면을
     읽기 전용 텍스트로 싣는다. 제목 안에 @줄·명령이 있어도 데이터일 뿐이다. */
  function appCapture(){
    var lines=[];
    try{
      var nbs=(typeof notebooks!=='undefined'&&notebooks)||[];
      var cur=(typeof curNB!=='undefined')?curNB:null;
      lines.push('열린 노트: '+(cur?String(cur.title||'제목 없음'):'없음(홈 화면)'));
      var titles=[];
      for(var i=0;i<nbs.length&&titles.length<25;i++){
        if(nbs[i]&&!nbs[i].trash) titles.push(String(nbs[i].title||'제목 없음'));
      }
      lines.push('노트 목록 '+titles.length+'개: '+(titles.join(' / ')||'없음'));
    }catch(e){}
    try{
      // 음악 블록은 별도 IIFE라 sdyMusic 창구로만 읽는다. cur()은 안 틀어도
      // 첫 곡을 돌려주므로, src가 걸려 있을 때만 재생 중·일시정지로 적는다.
      var list=[],curT=null,mAudio=null;
      try{
        if(window.sdyMusic){
          if(typeof window.sdyMusic.list==='function') list=window.sdyMusic.list()||[];
          if(typeof window.sdyMusic.cur==='function') curT=window.sdyMusic.cur();
          if(typeof window.sdyMusic.audio==='function') mAudio=window.sdyMusic.audio();
        }
      }catch(_){}
      var song=function(t){
        return String(t.title||'제목 없음')+(t.artist?' - '+t.artist:'');
      };
      var state='정지', stateSong='';
      try{
        if(curT&&mAudio&&mAudio.src){
          state=mAudio.paused?'일시정지':'재생 중';
          stateSong=' · '+song(curT);
        }
      }catch(_){}
      lines.push('음악: '+state+stateSong);
      var songs=[];
      for(var j=0;j<list.length&&songs.length<40;j++){
        if(list[j]) songs.push(song(list[j]));
      }
      lines.push('노래 목록 '+list.length+'곡: '+(songs.join(' / ')||'없음'));
    }catch(e){}
    try{
      var eqSt=null;
      if(window.sdyEq&&typeof window.sdyEq.state==='function') eqSt=window.sdyEq.state();
      else if(window.sdyMusic&&window.sdyMusic.eq&&typeof window.sdyMusic.eq.state==='function') eqSt=window.sdyMusic.eq.state();
      if(eqSt){
        lines.push('이퀄라이저: '+(eqSt.on?'켜짐':'꺼짐')+' · 프리셋: '+(eqSt.presetName||'원음'));
      }
    }catch(e){}
    try{
      var st=(window.sdyTimerState&&window.sdyTimerState())||null;
      if(st) lines.push('집중 화면: '+(st.open?'열림':'닫힘')+' · 모드 '+st.mode
        +(st.run?(' · 타이머 실행 중(약 '+Math.max(1,Math.round(st.left/60000))+'분 남음)'):''));
    }catch(e){}
    return lines.join('\n');
  }
  window.sdyAiAppSnapshot=function(){ try{ return appCapture(); }catch(e){ return ''; } };
  function appProgress(acc){
    var count=(String(acc||'').match(/^\s*@(music|note|timer|clock|sw|present|export|find|translate|stickers|cards|settings|eq)\b/gmi)||[]).length;
    return count?('앱 실행안을 만드는 중… · 동작 '+count+'개'):'앱 상태를 살펴보는 중…';
  }
  // 앱 실행 마무리 — editApplyDone과 같은 모양. 음악 재생은 자동재생 확인을
  // 위해 Promise를 돌려줄 수 있어 run()이 기다렸다 마무리한다.
  function appApplyDone(raw){
    var parsed=window.sdyAiAppParse
      ?window.sdyAiAppParse(raw):{ops:[],say:'',ask:'',dropped:0};
    var finish=function(res){
      res=res||{applied:0,failed:0,notes:[]};
      var applied=Number(res.applied||0),failed=Number(res.failed||0)+Number(parsed.dropped||0);
      var ask=String(parsed.ask||'').trim();
      var say=String(parsed.say||'').trim()
        ||(applied?'요청대로 실행했어요 해돌~':(ask?'':'실행할 내용을 찾지 못했어요'));
      var counts=[];
      if(applied) counts.push('실행 '+applied+'개');
      if(failed) counts.push('건너뜀 '+failed+'개');
      var output=say+(counts.length?'\n\n'+counts.join(' · '):'');
      if(res.notes&&res.notes.length) output+=(output?'\n':'')+res.notes.join('\n');
      if(ask) output+=(output?'\n\n':'')+ask+'\n(알려주면 바로 이어서 할게요 해돌~)';
      if(applied){
        try{ if(window.toast) window.toast('해돌이가 실행했어요 해돌~',2000); }catch(e){}
      }
      return output;
    };
    if(parsed.ops.length){
      try{
        if(window.sdyAiAppApply){
          var r=window.sdyAiAppApply(parsed.ops);
          if(r&&typeof r.then==='function') return r.then(finish,finish);
          return finish(r);
        }
        return finish({applied:0,failed:parsed.ops.length,
          notes:['앱 실행 연결을 찾지 못했어요 · 페이지를 새로고침해 주세요']});
      }catch(e){
        return finish({applied:0,failed:parsed.ops.length,
          notes:['실행하지 못했어요 · 다시 시도해 주세요']});
      }
    }
    return finish(null);
  }

  /* 14.30.0 · 인터넷 검색 → 결과를 붙여 다시 질문 ([[search]] 뒤 한 번만)
     검색 API 키가 필요 없다 — 서버가 무료 소스를 순서대로 시도한다. */
  function searchThenChat(q,scope){
    out('인터넷에서 찾아보는 중…',true);
    var q2;
    fetch('/api/ai/web?q='+encodeURIComponent(String(q||'').slice(0,180)),{
      headers:{'x-sdy-auth':token()}
    }).then(function(r){ return r.json(); }).then(function(d){
      if(!d||!d.ok||!d.results||!d.results.length){
        q2=String(q||'')+'\n\n(방금 인터넷 검색을 시도했지만 결과를 찾지 못했어요. [[search]] 표식 없이 아는 대로 답하되, 최신 정보가 필요한 내용이면 최신 여부를 확실히 모른다고 솔직히 말해 줘.)';
        run('chat',q2,scope,true);
        return;
      }
      var lines=d.results.slice(0,8).map(function(it,i){
        var sn=String(it.snippet||'').trim().replace(/\s+/g,' ').slice(0,220);
        return (i+1)+'. '+String(it.title||'').trim()+' — '+String(it.url||'')+(sn?' · '+sn:'');
      });
      q2=String(q||'')+'\n\n[방금 가져온 인터넷 검색 결과]\n'+lines.join('\n')
        +'\n\n이 검색 결과를 근거로 답해 줘. 이 결과에서 인용한 곳은 [1]처럼 결과 번호를 붙이고,'
        +'답 마지막에 \"출처\" 목록으로 번호·제목·링크를 적어 줘. [[search]] 표식은 다시 쓰지 말고 바로 답해 줘.';
      run('chat',q2,scope,true);
    }).catch(function(){
      q2=String(q||'')+'\n\n(인터넷 검색에 일시적으로 실패했어요. [[search]] 표식 없이 아는 대로 답해 줘.)';
      run('chat',q2,scope,true);
    });
  }
  function drawProgress(acc){
    if(!acc) return '그림을 구상하는 중…';
    if(String(acc).indexOf('<svg')>=0||String(acc).indexOf('<path')>=0) return '그림을 그리고 있어요…';
    return '그림을 구상하는 중…';
  }
  /* 그림 마무리 — SVG 원문 → 펜 획 ops → bridge.apply (editApplyDone과 같은 모양).
     @done 요약 줄이 없으므로 실제 획 수를 요약으로 쓴다. */
  function drawApplyDone(raw,revision){
    var parsed=window.sdyAiDrawParse
      ?window.sdyAiDrawParse(raw):{ok:false,error:'그림을 해석하지 못했어요',ops:[]};
    var finish=function(res){
      res=res||{applied:0,failed:0,notes:[],stale:false};
      if(res.stale){
        return (res.notes&&res.notes[0])
          ||'기다리는 동안 문서가 바뀌어서 그리지 않았어요 · 다시 요청해 주세요';
      }
      var applied=Number(res.applied||0),failed=Number(res.failed||0);
      var output='';
      if(applied&&parsed.strokes){
        output='요청한 그림을 펜으로 '+parsed.strokes+'획 그렸어요 해돌~ · Ctrl+Z로 되돌릴 수 있어요';
      }else if(applied){
        output='요청한 그림을 그렸어요 해돌~ · Ctrl+Z로 되돌릴 수 있어요';
      }else{
        output=String(parsed.error||'그림을 그리지 못했어요 · 다시 시도해 주세요');
      }
      if(failed) output+='\n\n건너뜀 '+failed+'개';
      if(res.notes&&res.notes.length) output+=(output?'\n':'')+res.notes.join('\n');
      if(applied){
        try{ if(window.toast) window.toast('해돌이가 그림을 그렸어요 해돌~ · Ctrl+Z로 되돌릴 수 있어요',2600); }catch(e){}
      }
      return output;
    };
    if(parsed.ops.length){
      try{
        var bridge=window.__sdyAiBridge;
        if(bridge&&typeof bridge.apply==='function'){
          var r=bridge.apply(parsed.ops,revision);
          if(r&&typeof r.then==='function') return r.then(finish,finish);
          return finish(r);
        }
        return finish({applied:0,failed:parsed.ops.length,stale:false,
          notes:['그림 그리기 연결을 찾지 못했어요 · 페이지를 새로고침해 주세요']});
      }catch(e){
        return finish({applied:0,failed:parsed.ops.length,stale:false,
          notes:['그림을 그리지 못했어요 · 다시 시도해 주세요']});
      }
    }
    return finish(null);
  }

  /* 14.30.0 · SVG 선화 → 펜 획 변환기 (해돌이 그림).
     모델이 만든 <svg>를 DOMParser 로 읽고, 각 path/도형을 폴리라인으로
     평탄화한다. 그 뒤 같은 색 획끼리 '끝점이 (거의) 맞닿은 것'을 한 획으로
     이어 붙인다 — 그림이 조각조각 분해돼 보이지 않게. 반환 op:
       {cmd:'draw', strokes:[{pts:[[x,y],…],color:'#…',size:n}], svgW, svgH}
     (실제 좌표는 적용기가 페이지 크기·빈자리에 맞춰 옮기고 스케일한다.) */
  window.sdyAiDrawParse=function(raw){
    var out={ok:false,error:'',ops:[],strokes:0,svgW:0,svgH:0};
    var COLOR={black:'#1a1a1a',white:'#ffffff',gray:'#7f8c8d',grey:'#7f8c8d',
      red:'#e74c3c',orange:'#e67e22',yellow:'#f1c40f',green:'#2ecc71',
      blue:'#3498db',purple:'#9b59b6',pink:'#e84393',brown:'#795548',navy:'#34495e'};
    function toHex(v){
      var s=String(v==null?'':v).trim().toLowerCase();
      if(!s||s==='none') return null;
      if(COLOR[s]) return COLOR[s];
      var m=/^#([0-9a-f]{3})$/i.exec(s);
      if(m) return '#'+m[1].split('').map(function(c){return c+c;}).join('');
      m=/^#([0-9a-f]{6})$/i.exec(s);
      if(m) return s;
      m=/^rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*\)$/.exec(s);
      if(m) return '#'+[m[1],m[2],m[3]].map(function(n){ var x=Math.max(0,Math.min(255,Number(n))); return ('0'+x.toString(16)).slice(-2); }).join('');
      return null;
    }
    function strokeInfo(el){
      var st=toHex(el.getAttribute('stroke'))||'#1a1a1a';
      var sw=parseFloat(el.getAttribute('stroke-width'));
      sw=(Number.isFinite(sw)&&sw>0)?sw:3;
      return {color:st,size:sw};
    }
    function src(){ return String(raw||'').replace(/```(?:xml|svg|html|json)?/gi,'').trim(); }
    var html=src();
    var mm=/<svg[\s\S]*?<\/svg>/i.exec(html);
    if(!mm) { out.error='그림(SVG)을 만들지 못했어요 · 다시 시도해 주세요'; return out; }
    var dom=null;
    try{ dom=new DOMParser().parseFromString(mm[0],'image/svg+xml'); }
    catch(e){}
    if(!dom||dom.documentElement&&dom.documentElement.nodeName==='parsererror'){
      try{ dom=new DOMParser().parseFromString(mm[0],'text/xml'); }catch(e2){}
    }
    if(!dom){ out.error='그림을 해석하지 못했어요 · 다시 시도해 주세요'; return out; }
    var svg=dom.querySelector('svg')||dom.documentElement;
    if(!svg){ out.error='그림(SVG)을 찾지 못했어요'; return out; }
    // viewBox / 크기 — 좌표는 viewBox 기준으로 읽는다
    var vb=String(svg.getAttribute('viewBox')||'').trim().split(/[\s,]+/).map(Number);
    var W=0,H=0;
    if(vb.length>=4&&vb.every(function(n){return Number.isFinite(n);})){ W=vb[2]; H=vb[3]; }
    if(!W||!H){ W=parseFloat(svg.getAttribute('width'))||480; H=parseFloat(svg.getAttribute('height'))||360; }
    W=Math.max(10,W); H=Math.max(10,H);
    var polylines=[];      // {pts,color,size,closed}
    function pushPts(pts,color,size,closed){
      var arr=[];
      for(var i=0;i<pts.length;i++){
        var x=Number(pts[i]&&pts[i][0]),y=Number(pts[i]&&pts[i][1]);
        if(!Number.isFinite(x)||!Number.isFinite(y)) continue;
        arr.push([Math.round(x*10)/10,Math.round(y*10)/10]);
      }
      if(arr.length>=2) polylines.push({pts:arr,color:color,size:size,closed:!!closed});
    }
    // ---- path d → 폴리라인 (M/L/H/V/C/S/Q/T/A/Z 지원, 곡선은 4px 단위로 샘플) ----
    function parsePath(d,color,size){
      d=String(d||'');
      var pcolor=color||'#1a1a1a', psize=(Number(size)||3);
      var toks=[],m,re=/([AaCcHhLlMmQqSsTtVvZz])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
      while((m=re.exec(d))!==null){
        if(m[1]) toks.push(m[1]);
        else if(m[2]!=='') toks.push(parseFloat(m[2]));
      }
      var i=0,cx=0,cy=0,sx=0,sy=0,px2=0,py2=0,prev='';
      var cur=null,curObj=null;
      function ensureCur(){
        if(!cur){ cur=[]; curObj={pts:cur,color:pcolor,size:psize}; polylines.push(curObj); }
      }
      function nxt(n){
        var out2=[];
        for(var k=0;k<n;k++){ var v=toks[i]; if(typeof v!=='number') throw 0; out2.push(v); i++; }
        return out2;
      }
      function lineTo(x,y){
        ensureCur(); cur.push([x,y]); cx=x; cy=y; prev='L';
      }
      function cubic(x1,y1,x2,y2,x,y){
        ensureCur();
        var dist=Math.hypot(x1-cx,y1-cy)+Math.hypot(x2-x1,y2-y1)+Math.hypot(x-x2,y-y2);
        // 부드럽고 유기적인 손그림 곡선을 위해 촘촘하고 매끄럽게 샘플링
        var n=Math.max(10,Math.min(120,Math.ceil(dist/2)));
        for(var k=1;k<=n;k++){
          var t=k/n, it=1-t;
          var a=it*it*it, b=3*it*it*t, c=3*it*t*t, dd=t*t*t;
          cur.push([Math.round((a*cx+b*x1+c*x2+dd*x)*10)/10,Math.round((a*cy+b*y1+c*y2+dd*y)*10)/10]);
        }
        px2=x2; py2=y2; cx=x; cy=y; prev='C';
      }
      function quad(x1,y1,x,y){
        ensureCur();
        var dist=Math.hypot(x1-cx,y1-cy)+Math.hypot(x-x1,y-y1);
        var n=Math.max(8,Math.min(80,Math.ceil(dist/2)));
        for(var k=1;k<=n;k++){
          var t=k/n,it=1-t;
          cur.push([Math.round((it*it*cx+2*it*t*x1+t*t*x)*10)/10,Math.round((it*it*cy+2*it*t*y1+t*t*y)*10)/10]);
        }
        px2=x1; py2=y1; cx=x; cy=y; prev='Q';
      }
      function arcTo(rx,ry,rot,large,sweep,x,y){
        ensureCur();
        var x1=cx,y1=cy;
        var phi=rot*Math.PI/180;
        var cp=Math.cos(phi),sp=Math.sin(phi);
        var dx=(x1-x)/2,dy=(y1-y)/2;
        var xp=cp*dx+sp*dy, yp=-sp*dx+cp*dy;
        var rx0=Math.abs(rx),ry0=Math.abs(ry);
        var lam=xp*xp/(rx0*rx0)+yp*yp/(ry0*ry0);
        if(lam>1){ var s2=Math.sqrt(lam); rx0*=s2; ry0*=s2; }
        var num=rx0*rx0*ry0*ry0-rx0*rx0*yp*yp-ry0*ry0*xp*xp;
        var den=rx0*rx0*yp*yp+ry0*ry0*xp*xp;
        var coef=(num<0?0:num)/Math.max(1,den);
        var rad=Math.sqrt(coef);
        var sign=(large===sweep)?-1:1;
        var cxp=sign*rad*rx0*yp/ry0, cyp=sign*rad*-ry0*xp/rx0;
        var cxr=cp*cxp-sp*cyp+(x1+x)/2, cyr=sp*cxp+cp*cyp+(y1+y)/2;
        function ang(ux,uy,vx,vy){
          var dot=ux*vx+uy*vy, len=Math.sqrt((ux*ux+uy*uy)*(vx*vx+vy*vy))||1;
          var a=Math.acos(Math.max(-1,Math.min(1,dot/len)));
          if(ux*vy-uy*vx<0) a=-a;
          return a;
        }
        var th1=ang(1,0,(xp-cxp)/rx0,(yp-cyp)/ry0);
        var dth=ang((xp-cxp)/rx0,(yp-cyp)/ry0,(-xp-cxp)/rx0,(-yp-cyp)/ry0);
        if(!sweep&&dth>0) dth-=2*Math.PI;
        if(sweep&&dth<0) dth+=2*Math.PI;
        var seg=Math.max(8,Math.ceil(Math.abs(dth)/(Math.PI/48)));
        for(var k=1;k<=seg;k++){
          var t=th1+dth*k/seg;
          var px=cp*rx0*Math.cos(t)-sp*ry0*Math.sin(t)+cxr;
          var py=sp*rx0*Math.cos(t)+cp*ry0*Math.sin(t)+cyr;
          cur.push([Math.round(px*10)/10,Math.round(py*10)/10]);
        }
        cx=x; cy=y; prev='A';
      }
      try{
        while(i<toks.length){
          var c=toks[i];
          if(typeof c==='string'){
            i++;
            var rel=c===c.toLowerCase();
            var cmd=c.toUpperCase();
            var rx,ry,rot,large,sweep,x,y,x1,y1,x2,y2;
            if(cmd==='M'){
              var p=nxt(2); if(rel){ x=cx+p[0]; y=cy+p[1]; } else { x=p[0]; y=p[1]; }
              sx=x; sy=y; cur=null; curObj=null; lineTo(x,y); prev='M';
              while(i<toks.length&&typeof toks[i]==='number'){
                p=nxt(2); if(rel){ x=cx+p[0]; y=cy+p[1]; } else { x=p[0]; y=p[1]; }
                lineTo(x,y);
              }
            }else if(cmd==='L'){
              while(i<toks.length&&typeof toks[i]==='number'){
                p=nxt(2); if(rel){ x=cx+p[0]; y=cy+p[1]; } else { x=p[0]; y=p[1]; }
                lineTo(x,y);
              }
            }else if(cmd==='H'||cmd==='V'){
              while(i<toks.length&&typeof toks[i]==='number'){
                var v=nxt(1)[0]; if(cmd==='H'){ x=rel?cx+v:v; y=cy; } else { x=cx; y=rel?cy+v:v; }
                lineTo(x,y);
              }
            }else if(cmd==='C'){
              while(i<toks.length&&typeof toks[i]==='number'){
                p=nxt(6);
                if(rel){ x1=cx+p[0]; y1=cy+p[1]; x2=cx+p[2]; y2=cy+p[3]; x=cx+p[4]; y=cy+p[5]; }
                else { x1=p[0]; y1=p[1]; x2=p[2]; y2=p[3]; x=p[4]; y=p[5]; }
                cubic(x1,y1,x2,y2,x,y);
              }
            }else if(cmd==='S'){
              while(i<toks.length&&typeof toks[i]==='number'){
                p=nxt(4);
                var cx2=rel?cx+p[0]:p[0], cy2=rel?cy+p[1]:p[1];
                var ex=rel?cx+p[2]:p[2], ey=rel?cy+p[3]:p[3];
                var dx1,dy1;
                if(prev==='C'||prev==='S'){ dx1=cx-px2; dy1=cy-py2; }
                else { dx1=0; dy1=0; }
                cubic(cx+dx1,cy+dy1,cx2,cy2,ex,ey);
                prev='S';
              }
            }else if(cmd==='Q'){
              while(i<toks.length&&typeof toks[i]==='number'){
                p=nxt(4);
                if(rel){ x1=cx+p[0]; y1=cy+p[1]; x=cx+p[2]; y=cy+p[3]; }
                else { x1=p[0]; y1=p[1]; x=p[2]; y=p[3]; }
                quad(x1,y1,x,y);
              }
            }else if(cmd==='T'){
              while(i<toks.length&&typeof toks[i]==='number'){
                p=nxt(2);
                if(rel){ x=cx+p[0]; y=cy+p[1]; } else { x=p[0]; y=p[1]; }
                var rx1,ry1;
                if(prev==='Q'||prev==='T'){ rx1=cx+(cx-px2); ry1=cy+(cy-py2); }
                else { rx1=cx; ry1=cy; }
                quad(rx1,ry1,x,y);
                prev='T';
              }
            }else if(cmd==='A'){
              while(i<toks.length&&typeof toks[i]==='number'){
                p=nxt(7);
                rx=p[0]; ry=p[1]; rot=p[2]; large=!!p[3]; sweep=!!p[4];
                if(rel){ x=cx+p[5]; y=cy+p[6]; } else { x=p[5]; y=p[6]; }
                arcTo(rx,ry,rot,large,sweep,x,y);
              }
            }else if(cmd==='Z'){
              ensureCur(); if(cur&&cur.length){ cur.push([sx,sy]); }
              cx=sx; cy=sy; cur=null; curObj=null; prev='Z';
            }
          }else break;
        }
      }catch(e){ /* 어긋난 d 는 지금까지 만든 획만 쓴다 */ }
    }
    // ---- SVG 요소 → 획 ----
    var els=svg.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse');
    for(var ei=0;ei<els.length;ei++){
      var el=els[ei],info=strokeInfo(el),tag=String(el.tagName||'').toLowerCase();
      try{
        if(tag==='path'){ parsePath(el.getAttribute('d'),info.color,info.size); continue; }
        if(tag==='line'){
          var xa=parseFloat(el.getAttribute('x1')),ya=parseFloat(el.getAttribute('y1'));
          var xb=parseFloat(el.getAttribute('x2')),yb=parseFloat(el.getAttribute('y2'));
          if(Number.isFinite(xa)&&Number.isFinite(xb)) pushPts([[xa,ya],[xb,yb]],info.color,info.size,false);
        }else if(tag==='polyline'||tag==='polygon'){
          var pl=(el.getAttribute('points')||'').trim().split(/[\s,]+/).map(Number);
          var pts=[];
          for(var q=0;q+1<pl.length;q+=2) if(Number.isFinite(pl[q])) pts.push([pl[q],pl[q+1]]);
          if(pts.length>=2) pushPts(pts,info.color,info.size,tag==='polygon');
        }else if(tag==='rect'){
          var rx0=parseFloat(el.getAttribute('x'))||0, ry0=parseFloat(el.getAttribute('y'))||0;
          var rw=parseFloat(el.getAttribute('width'))||0, rh=parseFloat(el.getAttribute('height'))||0;
          if(rw>0&&rh>0) pushPts([[rx0,ry0],[rx0+rw,ry0],[rx0+rw,ry0+rh],[rx0,ry0+rh],[rx0,ry0]],info.color,info.size,true);
        }else if(tag==='circle'||tag==='ellipse'){
          var cxx=parseFloat(el.getAttribute('cx'))||0, cyy=parseFloat(el.getAttribute('cy'))||0;
          var rrx=parseFloat(tag==='circle'?el.getAttribute('r'):el.getAttribute('rx'))||0;
          var rry=parseFloat(tag==='circle'?el.getAttribute('r'):el.getAttribute('ry'))||rrx;
          if(rrx>0&&rry>0){
            var pts2=[];
            for(var w2=0;w2<=64;w2++){ var ang2=w2/64*Math.PI*2; pts2.push([cxx+rrx*Math.cos(ang2),cyy+rry*Math.sin(ang2)]); }
            pushPts(pts2,info.color,info.size,true);
          }
        }
      }catch(e2){}
    }
    // ---- 끝점 정합 — 같은 색 획끼리 끝이 (거의) 맞닿으면 한 획으로 이어 붙인다.
    //    (그림이 조각조각 분해돼 보이는 걸 막는다. 서로 다른 덩어리는 프롬프트상
    //     10px 이상 떨어져 있어 병합되지 않는다.)
    var diag=Math.hypot(W,H);
    var eps=Math.max(1.2,Math.min(3.5,diag*0.006));
    var guard=0;
    for(;;){
      var joined=false; guard++;
      if(guard>polylines.length*3||polylines.length>700) break;
      outer:
      for(var a=0;a<polylines.length;a++){
        for(var b=a+1;b<polylines.length;b++){
          var A=polylines[a],B=polylines[b];
          if(A.color!==B.color||!A.pts.length||!B.pts.length) continue;
          if(Math.abs((Number(A.size)||3)-(Number(B.size)||3))>0.05) continue;   // 굵기가 다르면 다른 획
          var ah=A.pts[A.pts.length-1],at=A.pts[0],bh=B.pts[B.pts.length-1],bt=B.pts[0];
          var best=null;
          var d1=Math.hypot(ah[0]-bt[0],ah[1]-bt[1]);   // A끝-B시작
          var d2=Math.hypot(at[0]-bh[0],at[1]-bh[1]);   // A시작-B끝
          var d3=Math.hypot(ah[0]-bh[0],ah[1]-bh[1]);   // A끝-B끝
          var d4=Math.hypot(at[0]-bt[0],at[1]-bt[1]);   // A시작-B시작
          var bestD=Math.min(d1,d2,d3,d4);
          if(bestD<=eps){
            if(bestD===d1) best={pts:A.pts.concat(B.pts.slice(1)),closed:A.closed||B.closed};
            else if(bestD===d2) best={pts:B.pts.concat(A.pts.slice(1)),closed:A.closed||B.closed};
            else if(bestD===d3) best={pts:A.pts.concat(B.pts.slice().reverse().slice(1)),closed:A.closed||B.closed};
            else best={pts:B.pts.concat(A.pts.slice().reverse().slice(1)),closed:A.closed||B.closed};
            // 14.36.0 · 이어 붙인 획도 색·굵기를 그대로 — 예전엔 여기서 빠져 검정·기본 굵기로 돌아갔다
            best.color=A.color; best.size=A.size;
            polylines[a]=best;
            polylines.splice(b,1);
            joined=true;
            break outer;
          }
        }
      }
      if(!joined) break;
    }
    // ---- 걸러 내기: 너무 짧은 획·중복 점 제거 ----
    //   14.36.0 · 긴 직선은 3.5px 간격으로 점을 채운다 — 종이 위 획은 점 사이를
    //   곡선(Q)으로 매끈하게 잇기 때문에, 꼭짓점만 있는 직선(집·상자)은 모서리가
    //   둥글게 뭉개졌다. 점이 촘촘하면 모서리가 그대로 산다.
    var DENS=3.5;
    var kept=[];
    for(var k2=0;k2<polylines.length&&kept.length<320;k2++){
      var S=polylines[k2];
      if(!S||!S.pts||S.pts.length<2) continue;
      var clean=[],total=0;
      for(var p3=0;p3<S.pts.length;p3++){
        var pt=S.pts[p3];
        if(!pt) continue;
        var prevPt=clean.length?clean[clean.length-1]:null;
        if(prevPt&&prevPt[0]===pt[0]&&prevPt[1]===pt[1]) continue;
        if(prevPt){
          var segLen=Math.hypot(pt[0]-prevPt[0],pt[1]-prevPt[1]);
          total+=segLen;
          if(segLen>DENS*1.5){
            var nseg=Math.min(400,Math.ceil(segLen/DENS));
            for(var si=1;si<nseg;si++){
              var tt=si/nseg;
              clean.push([Math.round((prevPt[0]+(pt[0]-prevPt[0])*tt)*10)/10,Math.round((prevPt[1]+(pt[1]-prevPt[1])*tt)*10)/10]);
            }
          }
        }
        clean.push(pt);
      }
      if(clean.length<2||total<3) continue;
      if(total>24000){ // 지나치게 긴 궤적은 절반 간격으로 추린다
        var step=Math.max(1,Math.floor(clean.length/16000));
        var th2=[];
        for(var qq=0;qq<clean.length;qq+=step) th2.push(clean[qq]);
        if(th2.length<2) th2=clean;
        clean=th2;
      }
      kept.push({pts:clean,color:S.color,size:S.size,closed:S.closed?1:0});
    }
    if(!kept.length){
      out.error='그림을 그리지 못했어요 · 다시 시도해 주세요(다른 그림을 부탁해 보세요)';
      return out;
    }
    out.ok=true; out.strokes=kept.length;
    out.svgW=Math.round(W*10)/10; out.svgH=Math.round(H*10)/10;
    out.ops=[{cmd:'draw',page:null,x:'auto',y:'auto',w:null,h:null,
      svgW:out.svgW,svgH:out.svgH,strokes:kept}];
    return out;
  };

  /* 모델 응답 파서. 허용 목록 밖의 줄은 버리고, 문서에는 HTML이 아니라 평문만
     전달한다. @tx의 빈 본문은 "상자 내용 비우기"라서 정상 명령으로 허용한다. */
  window.sdyAiEditParse=function(raw){
    var ops=[],say='',ask='',dropped=0;
    var src=String(raw==null?'':raw).replace(/\r\n?/g,'\n');
    src=src.replace(/^\s*```[^\n]*\n?/gm,'').replace(/^\s*```\s*$/gm,'');
    var number=function(value){
      var s=String(value==null?'':value).trim();
      if(!/^-?\d+(?:\.\d+)?(?:px)?$/i.test(s)) return null;
      var n=Number(s.replace(/px$/i,'')); return isFinite(n)?n:null;
    };
    var decode=function(value){
      return String(value==null?'':value).replace(/\\(n|t|\\)/g,function(all,ch){
        return ch==='n'?'\n':(ch==='t'?'\t':'\\');
      }).trim();
    };
    // 앞의 n개 필드만 자르고 나머지는 본문으로 — 본문 안의 | 는 살린다.
    var cutN=function(s,n){
      var cuts=[],from=0;
      for(var i=0;i<n;i++){
        var next=s.indexOf('|',from); if(next<0) break;
        cuts.push(s.slice(from,next).trim()); from=next+1;
      }
      return {cuts:cuts,rest:s.slice(from)};
    };
    // 14.27.0 · auto — 좌표·크기를 문서에게 맡긴다(겹치지 않는 정돈된 자리).
    var numAuto=function(value){
      var s=String(value==null?'':value).trim().toLowerCase();
      if(s==='auto'||s==='자동'||s==='알아서'||s==='-'||s==='*'||s==='?') return 'auto';
      return number(value);
    };
    // "~상자id | 본문" — 새 상자가 이웃 상자 서식을 물려받을 때.
    var inheritOf=function(s){
      s=String(s==null?'':s).replace(/^\s+/,'');
      var m=/^~(\S+?)\s*(?:\||$)/.exec(s);
      if(!m) return {inherit:'',rest:s};
      return {inherit:m[1],rest:s.slice(m[0].length)};
    };
    src.split('\n').forEach(function(original){
      var line=original.replace(/\s*｜\s*/g,'|').trim();
      if(line.charAt(0)!=='@') return;
      var split=line.search(/[\s|]/);
      var head=(split<0?line.slice(1):line.slice(1,split)).replace(/:$/,'').toLowerCase();
      var rest=split<0?'':line.slice(split+1).trim();
      var fields=rest.split('|').map(function(v){ return v.trim(); });
      var at=function(i){ return fields[i]==null?'':fields[i]; };
      var nums=function(values){ return values.every(function(v){ return v!==null; }); };
      if(head==='done'||head==='end'||head==='say'||head==='완료'){
        if(rest) say=decode(rest).replace(/\n/g,' ').slice(0,400);
        return;
      }
      // @ask — 되묻기. 실행 없이 질문만 말풍선에 싣고 다음 요청에 문맥으로 전달한다.
      if(head==='ask'||head==='q'||head==='물음'||head==='질문'){
        if(rest) ask=decode(rest).replace(/\n/g,' ').slice(0,400);
        else dropped++;
        return;
      }
      if(head==='mv'||head==='move'||head==='이동'){
        var x=number(at(1)),y=number(at(2));
        if(at(0)&&nums([x,y])) ops.push({cmd:'mv',id:at(0),x:x,y:y}); else dropped++;
        return;
      }
      if(head==='sz'||head==='size'||head==='resize'||head==='rs'||head==='크기'){
        var w=number(at(1)),h=number(at(2));
        if(at(0)&&nums([w,h])) ops.push({cmd:'sz',id:at(0),w:w,h:h}); else dropped++;
        return;
      }
      if(head==='bx'||head==='box'||head==='rect'||head==='place'){
        var x2=number(at(1)),y2=number(at(2)),w2=number(at(3)),h2=number(at(4));
        if(at(0)&&nums([x2,y2,w2,h2])) ops.push({cmd:'bx',id:at(0),x:x2,y:y2,w:w2,h:h2});
        else dropped++;
        return;
      }
      if(head==='tx'||head==='text'||head==='set'||head==='put'||head==='글'){
        var bar=rest.indexOf('|');
        var id=bar<0?'':rest.slice(0,bar).trim();
        if(id) ops.push({cmd:'tx',id:id,text:decode(rest.slice(bar+1))}); else dropped++;
        return;
      }
      // @rp — 서식을 살린 부분 바꾸기. 찾을 글은 | 를 포함할 수 없고 바꿀 글은 된다.
      // "@rp id | 찾을글" 처럼 바꿀 글이 없으면 그 부분 지우기로 본다.
      if(head==='rp'||head==='replace'||head==='바꿈'||head==='교체'){
        var rcut=cutN(rest,2);
        var rid=rcut.cuts[0]||'',find=decode(rcut.cuts[1]||'');
        if(rcut.cuts.length===2&&rid&&find)
          ops.push({cmd:'rp',id:rid,find:find,repl:decode(rcut.rest)});
        else if(rcut.cuts.length===1&&rid&&decode(rcut.rest))
          ops.push({cmd:'rp',id:rid,find:decode(rcut.rest),repl:''});
        else dropped++;
        return;
      }
      // @ap — 맨 앞·뒤에 덧붙이기.
      if(head==='ap'||head==='append'||head==='prepend'||head==='덧붙'){
        var acut=cutN(rest,2);
        var aid=acut.cuts[0]||'',adir=(acut.cuts[1]||'').toLowerCase(),atext=decode(acut.rest);
        if(acut.cuts.length===2&&aid&&atext)
          ops.push({cmd:'ap',id:aid,dir:adir,text:atext});
        else dropped++;
        return;
      }
      // @st — 서식. "속=값, 속=값" 덩어리는 통째로 넘겨 적용기가 검증한다.
      if(head==='st'||head==='style'||head==='서식'){
        var scut=cutN(rest,1);
        if(scut.cuts.length===1&&scut.cuts[0]&&decode(scut.rest))
          ops.push({cmd:'st',id:scut.cuts[0],style:decode(scut.rest)});
        else dropped++;
        return;
      }
      if(head==='add'||head==='new'||head==='추가'){
        var gcut=cutN(rest,5),inh=inheritOf(gcut.rest);
        var page=number(gcut.cuts[0]),ax=numAuto(gcut.cuts[1]),ay=numAuto(gcut.cuts[2]);
        var aw=numAuto(gcut.cuts[3]),ah=numAuto(gcut.cuts[4]),body=decode(inh.rest);
        if(gcut.cuts.length===5&&nums([page,ax,ay,aw,ah])&&body)
          ops.push({cmd:'add',page:page,x:ax,y:ay,w:aw,h:ah,text:body,inherit:inh.inherit});
        else dropped++;
        return;
      }
      // @math / @ltx / @formula / @수식 — 새 수식(LaTeX) 상자.
      if(head==='math'||head==='ltx'||head==='formula'||head==='madd'||head==='수식'||head==='수식넣기'||head==='수식추가'){
        var mcut=cutN(rest,5);
        var mpage=number(mcut.cuts[0]),mx=numAuto(mcut.cuts[1]),my=numAuto(mcut.cuts[2]);
        var mw=numAuto(mcut.cuts[3]),mh=numAuto(mcut.cuts[4]),msrc=decode(mcut.rest);
        var mdisp=0;
        msrc=String(msrc||'').trim();
        var mdbl=/^\$\$([\s\S]+)\$\$$/.exec(msrc);
        if(mdbl){ msrc=mdbl[1].trim(); mdisp=1; }
        else{ var msng=/^\$([^$\n]+)\$$/.exec(msrc); if(msng){ msrc=msng[1].trim(); mdisp=0; } }
        if(mcut.cuts.length===5&&nums([mpage,mx,my,mw,mh])&&msrc)
          ops.push({cmd:'math',page:mpage,x:mx,y:my,w:mw,h:mh,latex:msrc,display:mdisp});
        else dropped++;
        return;
      }
      // @mtx / @latex / @mtext — 기존 수식의 LaTeX 원문 변경.
      if(head==='mtx'||head==='latex'||head==='mtext'||head==='수식내용'||head==='수식텍스트'){
        var mbar=rest.indexOf('|');
        var mid2=mbar<0?'':rest.slice(0,mbar).trim();
        var msrc2=decode(mbar<0?'':rest.slice(mbar+1));
        var mdisp2=0;
        msrc2=String(msrc2||'').trim();
        var mdbl2=/^\$\$([\s\S]+)\$\$$/.exec(msrc2);
        if(mdbl2){ msrc2=mdbl2[1].trim(); mdisp2=1; }
        else{ var msng2=/^\$([^$\n]+)\$$/.exec(msrc2); if(msng2){ msrc2=msng2[1].trim(); mdisp2=0; } }
        if(mid2&&msrc2) ops.push({cmd:'mtx',id:mid2,latex:msrc2,display:mdisp2});
        else dropped++;
        return;
      }
      // @tbl — 표 만들기. 본문은 행(\n)·칸(|) 구분이라 통째로 넘긴다.
      // @img — 인터넷에서 사진을 찾아 노트에 넣는다. 실제 사진은 서버가 찾아
      //   저장하므로 검색어만 보낸다(@add와 같은 위치·크기 규칙, auto 지원).
      if(head==='img'||head==='photo'||head==='picture'||head==='image'
         ||head==='사진'||head==='이미지'){
        var icut=cutN(rest,5);
        var ipage=number(icut.cuts[0]),ix=numAuto(icut.cuts[1]),iy=numAuto(icut.cuts[2]);
        var iw=numAuto(icut.cuts[3]),ih=numAuto(icut.cuts[4]),iq=decode(icut.rest);
        if(icut.cuts.length===5&&nums([ipage,ix,iy,iw,ih])&&iq)
          ops.push({cmd:'img',page:ipage,x:ix,y:iy,w:iw,h:ih,q:iq});
        else dropped++;
        return;
      }
      if(head==='tbl'||head==='table'||head==='표'){
        var tcut=cutN(rest,5);
        var tpage=number(tcut.cuts[0]),tx=numAuto(tcut.cuts[1]),ty=numAuto(tcut.cuts[2]);
        var trows=number(tcut.cuts[3]),tcols=number(tcut.cuts[4]),tbody=decode(tcut.rest);
        if(tcut.cuts.length===5&&nums([tpage,tx,ty,trows,tcols])&&tbody)
          ops.push({cmd:'tbl',page:tpage,x:tx,y:ty,rows:trows,cols:tcols,text:tbody});
        else dropped++;
        return;
      }
      if(head==='tsz'||head==='tablesize'||head==='표크기'){
        var sw=number(at(1)),sh=number(at(2));
        if(at(0)&&nums([sw,sh])) ops.push({cmd:'tsz',id:at(0),w:sw,h:sh}); else dropped++;
        return;
      }
      if(head==='tmv'||head==='tablemove'||head==='표이동'){
        var mx=number(at(1)),my=number(at(2));
        if(at(0)&&nums([mx,my])) ops.push({cmd:'tmv',id:at(0),x:mx,y:my}); else dropped++;
        return;
      }
      if(head==='tcell'||head==='cell'||head==='칸'){
        var ccut=cutN(rest,3);
        var ctid=ccut.cuts[0]||'',cr=number(ccut.cuts[1]),cc=number(ccut.cuts[2]);
        if(ccut.cuts.length===3&&ctid&&nums([cr,cc]))
          ops.push({cmd:'tcell',id:ctid,r:cr,c:cc,text:decode(ccut.rest)});
        else dropped++;
        return;
      }
      // @hl — 형광펜. "@hl id | 찾을 글 | 색"(글귀만) · "@hl id | 색"(상자 전체)
      //   · "@hl id | 찾을 글 | 없음"(그 글귀 지우기). 값이 하나면 적용기가
      //   색인지 찾을 글인지 가린다.
      if(head==='hl'||head==='highlight'||head==='highlighter'||head==='mark'
         ||head==='형광펜'||head==='형광'||head==='강조'){
        var hbars=(rest.match(/\|/g)||[]).length;
        var hf=rest.split('|').map(function(v){ return v.trim(); });
        if(!hf[0]){ dropped++; return; }
        if(hbars>=2)
          ops.push({cmd:'hl',id:hf[0],find:decode(hf[1]),color:decode(hf[2]||'')});
        else if(hbars===1)
          ops.push({cmd:'hl',id:hf[0],find:decode(hf[1]),color:'',single:true});
        else ops.push({cmd:'hl',id:hf[0],find:'',color:'',single:true});
        return;
      }
      // @tdel — 표 삭제 별칭. 표 칸 id를 넣어도 적용기가 표 전체를 지운다.
      if(head==='del'||head==='rm'||head==='delete'||head==='remove'||head==='삭제'
         ||head==='tdel'||head==='deltable'||head==='tabledel'||head==='표삭제'||head==='표지우기'){
        if(at(0)) ops.push({cmd:'del',id:at(0)}); else dropped++;
        return;
      }
      // @tidy — 쪽 정돈(격자·왼쪽 끝 맞추기 + 심한 겹침 풀기). 쪽번호는 생략 가능.
      if(head==='tidy'||head==='neat'||head==='정돈'||head==='가지런히'){
        var yp=number(at(0));
        ops.push({cmd:'tidy',page:yp==null?'':yp});
        return;
      }
      if(head==='goto'||head==='go'||head==='page'||head==='페이지'||head==='쪽'){
        var gp=number(at(0));
        if(nums([gp])) ops.push({cmd:'goto',page:gp}); else dropped++;
        return;
      }
      if(head==='newpage'||head==='새쪽'||head==='새페이지'){
        ops.push({cmd:'newpage'}); return;
      }
      if(head==='title'||head==='제목'){
        if(rest) ops.push({cmd:'title',text:decode(rest)}); else dropped++;
        return;
      }
      // @clip — 클립보드를 새 상자로. "@clip 쪽 | x | y | w | h" 뒤에 붙는
      // 글은 무시하고 "~id"만 물려받기로 읽는다.
      if(head==='clip'||head==='paste'||head==='붙여넣기'){
        var pcut=cutN(rest,4);
        var ppage=number(pcut.cuts[0]),px=numAuto(pcut.cuts[1]),py=numAuto(pcut.cuts[2]);
        var pw=numAuto(pcut.cuts[3]);
        var ptail=cutN(String(pcut.rest||''),1),ph,pinh;
        if(ptail.cuts.length===1){ ph=numAuto(ptail.cuts[0]); pinh=inheritOf(ptail.rest); }
        else{ ph=numAuto(pcut.rest); pinh={inherit:''}; }
        if(pcut.cuts.length===4&&nums([ppage,px,py,pw,ph]))
          ops.push({cmd:'clip',page:ppage,x:px,y:py,w:pw,h:ph,inherit:pinh.inherit});
        else dropped++;
        return;
      }
      if(head==='clipin'||head==='pastein'){
        var icut=cutN(rest,1);
        if(icut.cuts.length===1&&icut.cuts[0])
          ops.push({cmd:'clipin',id:icut.cuts[0],dir:decode(icut.rest)||'뒤'});
        else dropped++;
        return;
      }
      if(head==='copy'||head==='복사'){
        if(at(0)) ops.push({cmd:'copy',id:at(0)}); else dropped++;
        return;
      }
      dropped++;
    });
    return {ops:ops.slice(0,160),say:say,ask:ask,dropped:dropped+Math.max(0,ops.length-160)};
  };

  /* ── 14.26.0 · 앱 실행 파서 — 허용 목록 밖의 줄은 버린다. 한 번에 10개까지. ── */
  window.sdyAiAppParse=function(raw){
    var ops=[],say='',ask='',dropped=0;
    var src=String(raw==null?'':raw).replace(/\r\n?/g,'\n');
    src=src.replace(/^\s*```[^\n]*\n?/gm,'').replace(/^\s*```\s*$/gm,'');
    var decode=function(value){
      return String(value==null?'':value).replace(/\\(n|t|\\)/g,function(all,ch){
        return ch==='n'?'\n':(ch==='t'?'\t':'\\');
      }).trim();
    };
    // 앞의 n개 필드만 자르고 나머지는 값으로 — 값 안의 | 는 살린다.
    var cutN=function(s,n){
      var cuts=[],from=0;
      for(var i=0;i<n;i++){
        var next=s.indexOf('|',from); if(next<0) break;
        cuts.push(s.slice(from,next).trim()); from=next+1;
      }
      return {cuts:cuts,rest:s.slice(from)};
    };
    var number=function(value,min,max){
      var s=String(value==null?'':value).trim();
      if(!/^-?\d+(?:\.\d+)?$/.test(s)) return null;
      var n=Number(s);
      if(!isFinite(n)||n<min||n>max) return null;
      return n;
    };
    src.split('\n').forEach(function(line){
      var t=String(line||'').trim();
      if(!t) return;
      var m=/^@([a-z가-힣]+)\s*([\s\S]*)$/i.exec(t);
      if(!m){ dropped++; return; }
      var cmd=m[1].toLowerCase(), rest=String(m[2]||'').trim();
      if(cmd==='done'){ if(!say) say=decode(rest).slice(0,300); return; }
      if(cmd==='ask'){ if(!ask) ask=decode(rest).slice(0,300); return; }
      if(cmd==='music'){
        var f=cutN(rest,1);
        // '|'가 없으면 줄 전체가 동작이다(@music mix·@music pause처럼).
        var act=String(f.cuts.length?f.cuts[0]:f.rest).toLowerCase(), v=f.cuts.length?decode(f.rest):'';
        if(act==='play'){ ops.push({cmd:'music',act:'play',q:v.slice(0,100)}); return; }
        if(act==='pause'||act==='resume'||act==='next'||act==='prev'||act==='big'){
          ops.push({cmd:'music',act:act}); return;
        }
        if(act==='mix'){ var n=v?number(v,1,200):20; if(n==null){ dropped++; return; } ops.push({cmd:'music',act:'mix',n:n}); return; }
        if(act==='vol'||act==='volume'){ var vv=number(v,0,100); if(vv==null){ dropped++; return; } ops.push({cmd:'music',act:'vol',v:vv}); return; }
        if(act==='eq'||act==='equalizer'||act==='이퀄라이저'||act==='이큐'||/^(?:eq|equalizer|이퀄라이저|이큐)\b/i.test(act)){
          var sub=act.replace(/^(?:eq|equalizer|이퀄라이저|이큐)\s*/i,'').trim();
          var eqf=cutN(v||sub,1);
          var eqAct=String(eqf.cuts.length?eqf.cuts[0]:(eqf.rest||sub)).toLowerCase().trim();
          var eqV=eqf.cuts.length?decode(eqf.rest):'';
          if(eqAct==='on'||eqAct==='켜기'||eqAct==='켜'||eqAct==='켜줘'){ ops.push({cmd:'eq',act:'on'}); return; }
          if(eqAct==='off'||eqAct==='끄기'||eqAct==='꺼'||eqAct==='꺼줘'){ ops.push({cmd:'eq',act:'off'}); return; }
          if(eqAct==='toggle'||eqAct==='토글'){ ops.push({cmd:'eq',act:'toggle'}); return; }
          if(eqAct==='reset'||eqAct==='초기화'||eqAct==='리셋'||eqAct==='원음'){ ops.push({cmd:'eq',act:'reset'}); return; }
          if(eqAct==='open'||eqAct==='show'||eqAct==='pop'||eqAct==='열기'||eqAct==='열어'||eqAct==='열어줘'||eqAct==='보여줘'){ ops.push({cmd:'eq',act:'open'}); return; }
          if(eqAct==='close'||eqAct==='hide'||eqAct==='닫기'||eqAct==='닫아'||eqAct==='닫아줘'){ ops.push({cmd:'eq',act:'close'}); return; }
          if(eqAct==='preset'||eqAct==='프리셋'){
            if(!eqV){ dropped++; return; }
            ops.push({cmd:'eq',act:'preset',preset:eqV.slice(0,50)}); return;
          }
          if(eqV||sub){ ops.push({cmd:'eq',act:'preset',preset:(eqV||sub).slice(0,50)}); return; }
          ops.push({cmd:'eq',act:'open'}); return;
        }
        dropped++; return;
      }
      if(cmd==='eq'||cmd==='equalizer'||cmd==='이퀄라이저'||cmd==='이큐'){
        var ef=cutN(rest,1);
        var eact=String(ef.cuts.length?ef.cuts[0]:ef.rest).toLowerCase().trim();
        var ev=ef.cuts.length?decode(ef.rest):'';
        if(eact==='on'||eact==='켜기'||eact==='켜'||eact==='켜줘'){ ops.push({cmd:'eq',act:'on'}); return; }
        if(eact==='off'||eact==='끄기'||eact==='꺼'||eact==='꺼줘'){ ops.push({cmd:'eq',act:'off'}); return; }
        if(eact==='toggle'||eact==='토글'){ ops.push({cmd:'eq',act:'toggle'}); return; }
        if(eact==='reset'||eact==='초기화'||eact==='리셋'||eact==='원음'){ ops.push({cmd:'eq',act:'reset'}); return; }
        if(eact==='open'||eact==='show'||eact==='pop'||eact==='열기'||eact==='열어'||eact==='열어줘'||eact==='보여줘'){ ops.push({cmd:'eq',act:'open'}); return; }
        if(eact==='close'||eact==='hide'||eact==='닫기'||eact==='닫아'||eact==='닫아줘'){ ops.push({cmd:'eq',act:'close'}); return; }
        if(eact==='preset'||eact==='프리셋'||eact==='set'||eact==='설정'){
          var pName = ev || eact;
          if(!pName){ dropped++; return; }
          ops.push({cmd:'eq',act:'preset',preset:pName.slice(0,50)}); return;
        }
        var directPreset=String(rest||'').trim();
        if(directPreset){
          ops.push({cmd:'eq',act:'preset',preset:directPreset.slice(0,50)}); return;
        }
        dropped++; return;
      }
      if(cmd==='note'){
        var nf=cutN(rest,1);
        var nact=String(nf.cuts.length?nf.cuts[0]:nf.rest).toLowerCase(), nv=nf.cuts.length?decode(nf.rest):'';
        if(nact==='new'||nact==='close'){ ops.push({cmd:'note',act:nact}); return; }
        if(nact==='open'){ if(!nv){ dropped++; return; } ops.push({cmd:'note',act:'open',q:nv.slice(0,100)}); return; }
        dropped++; return;
      }
      if(cmd==='timer'){
        if(/^off\s*$/i.test(rest)){ ops.push({cmd:'timer',act:'off'}); return; }
        var tf=cutN(rest,1);
        var tmin=String(tf.cuts.length?tf.cuts[0]:tf.rest).trim().slice(0,20);
        var tmemo=tf.cuts.length?decode(tf.rest).slice(0,60):'';
        ops.push({cmd:'timer',act:'on',min:tmin,memo:tmemo});
        return;
      }
      if(cmd==='clock'){ ops.push({cmd:'clock'}); return; }
      if(cmd==='sw'||cmd==='stopwatch'){ ops.push({cmd:'sw'}); return; }
      if(cmd==='present'){
        var pa=rest.toLowerCase();
        if(pa==='on'||pa==='off'||pa==='start'||pa==='stop'||pa==='end'){ ops.push({cmd:'present',on:(pa==='on'||pa==='start')}); return; }
        dropped++; return;
      }
      if(cmd==='export'){
        var ea=rest.toLowerCase();
        if(!ea){ ops.push({cmd:'export',pdf:false}); return; }
        if(ea==='pdf'){ ops.push({cmd:'export',pdf:true}); return; }
        dropped++; return;
      }
      if(cmd==='find'){
        var fq=decode(rest);
        if(!fq){ dropped++; return; }
        ops.push({cmd:'find',q:fq.slice(0,100)}); return;
      }
      // 14.29.3 · @translate 범위 | 언어 — 노트의 '자동 번역' 기능을 그대로 실행한다
      if(cmd==='translate'||cmd==='tr'||cmd==='번역'){
        var rf2=cutN(rest,1);
        var rscope=String(rf2.cuts.length?rf2.cuts[0]:rf2.rest).toLowerCase().trim();
        var rlang=String(rf2.cuts.length?decode(rf2.rest):'').toLowerCase().trim();
        if(rscope==='doc'||rscope==='all'||rscope==='문서'||rscope==='전체') rscope='doc';
        else if(rscope==='page'||rscope==='쪽'||rscope==='페이지'||rscope==='') rscope='page';
        else { dropped++; return; }
        var LANG={ko:'ko','한국어':'ko','한글':'ko',korean:'ko',en:'en','영어':'en',english:'en',
                  ja:'ja','일본어':'ja',japanese:'ja','zh':'zh-CN','zh-cn':'zh-CN','중국어':'zh-CN',chinese:'zh-CN'};
        var lang=LANG[rlang]||'';
        if(!lang){ dropped++; return; }
        ops.push({cmd:'translate',scope:rscope,lang:lang}); return;
      }
      if(cmd==='stickers'||cmd==='sticker'){ ops.push({cmd:'stickers'}); return; }
      if(cmd==='cards'||cmd==='card'){ ops.push({cmd:'cards'}); return; }
      if(cmd==='settings'||cmd==='setting'){ ops.push({cmd:'settings'}); return; }
      dropped++;
    });
    return {ops:ops.slice(0,10),say:say,ask:ask,dropped:dropped+Math.max(0,ops.length-10)};
  };

  /* ── 14.26.0 · 앱 실행 적용기 — 화면의 버튼을 누른 것과 같은 함수를 순서대로
     부른다. 목록 대조·노트 열림·숫자 범위를 다시 검사하고, 하나가 실패해도
     나머지는 이어서 실행한다. 음악 재생이 섞이면 자동재생 확인을 위해
     Promise를 돌려준다. */
  window.sdyAiAppApply=function(ops){
    var res={applied:0,failed:0,notes:[]};
    var note=function(s){ if(res.notes.length<6) res.notes.push(s); };
    var ok=function(){ res.applied++; };
    var bad=function(s){ res.failed++; note(s); };
    var needFn=function(name){
      try{
        var f=null;
        if(typeof window!=='undefined'&&window&&typeof window[name]==='function') f=window[name];
        else { try{ f=eval(name); }catch(_){ f=null; } }
        if(typeof f==='function') return f;
      }catch(e){}
      return null;
    };
    // 음악 블록은 별도 IIFE라 window.sdyMusic·sdySearchTracks·sdyPlayFrom·
    // sdyPlayRandomMix 창구로만 다룬다. bare P·cur·A·playFrom은 여기서 안 보인다.
    var musicList=function(){
      try{
        if(window.sdyMusic&&typeof window.sdyMusic.list==='function'){
          var L=window.sdyMusic.list();
          if(Array.isArray(L)) return L;
        }
      }catch(e){}
      return [];
    };
    var musicCur=function(){
      try{
        if(window.sdyMusic&&typeof window.sdyMusic.cur==='function') return window.sdyMusic.cur();
      }catch(e){}
      return null;
    };
    var musicAudio=function(){
      try{
        if(window.sdyMusic&&typeof window.sdyMusic.audio==='function') return window.sdyMusic.audio();
      }catch(e){}
      return null;
    };
    var played=false;   // 이번 실행에서 재생을 시도했는지 — 자동재생 확인용
    var chain=Promise.resolve();
    (ops||[]).forEach(function(op){
      chain=chain.then(function(){
        if(op.cmd==='music') return musicOp(op);
        if(op.cmd==='eq') return eqOp(op);
        if(op.cmd==='note') return noteOp(op);
        if(op.cmd==='timer') return timerOp(op);
        if(op.cmd==='clock'){ var f=needFn('openFocusClock'); if(!f){ bad('시계 화면을 열지 못했어요'); return; } f('clock'); ok(); return; }
        if(op.cmd==='sw'){ var sw=needFn('sdySwStart'); if(!sw||!sw()){ bad('스톱워치를 시작하지 못했어요'); return; } ok(); return; }
        if(op.cmd==='present') return presentOp(op);
        if(op.cmd==='export') return exportOp(op);
        if(op.cmd==='find') return findOp(op);
        if(op.cmd==='translate') return translateOp(op);
        if(op.cmd==='stickers'){ var st=needFn('openStickers'); if(!st){ bad('스티커 창을 열지 못했어요'); return; } try{ st(); }catch(e){ bad('스티커 창을 열지 못했어요'); return; } ok(); return; }
        if(op.cmd==='cards'){ var cd=needFn('openCards'); if(!cd){ bad('단어카드 창을 열지 못했어요'); return; } try{ cd(); }catch(e){ bad('단어카드 창을 열지 못했어요'); return; } ok(); return; }
        if(op.cmd==='settings'){ var sg=needFn('openSettings'); if(!sg){ bad('설정 창을 열지 못했어요'); return; } try{ sg(); }catch(e){ bad('설정 창을 열지 못했어요'); return; } ok(); return; }
        bad('알 수 없는 동작이에요');
      }).catch(function(){ bad('실행 중 문제가 생겼어요'); });
    });
    function musicOp(op){
      var list=musicList(), A=musicAudio(), curT=musicCur();
      var m=null;
      try{ m=(window.sdyMusic&&typeof window.sdyMusic==='object')?window.sdyMusic:null; }catch(e){ m=null; }
      if(op.act==='play'){
        if(!list.length){ bad('노래 목록이 비어 있어요 · 음악 탭에서 노래를 먼저 넣어 주세요'); return; }
        var st=needFn('sdySearchTracks'), pf=needFn('sdyPlayFrom');
        if(!st||!pf){ bad('음악 재생 준비가 안 됐어요'); return; }
        var hits=op.q?st(list,op.q):[];
        if(op.q&&!hits.length){ bad('‘'+op.q+'’와 맞는 노래를 찾지 못했어요'); return; }
        var pool=hits.length?hits:list;
        var t=hits.length?hits[0]:(curT||list[0]);
        if(!t){ bad('틀 노래를 찾지 못했어요'); return; }
        try{ pf(pool,t.id,'해돌이'); }catch(e){ bad('노래를 틀지 못했어요'); return; }
        played=true; ok(); return;
      }
      if(op.act==='pause'){
        if(!m||typeof m.pause!=='function'||!A){ bad('일시정지하지 못했어요'); return; }
        try{ if(!A.paused) m.pause(); }catch(e){ bad('일시정지하지 못했어요'); return; }
        ok(); return;
      }
      if(op.act==='resume'){
        if(!A){ bad('계속 틀지 못했어요'); return; }
        try{
          if(A.paused){
            if(!A.src&&list.length){
              var playedId='';
              try{ playedId=(curT&&curT.id)||''; }catch(_){}
              var pf2=needFn('sdyPlayFrom');
              if(pf2){ pf2(list,playedId||list[0].id,'해돌이'); played=true; }
            }
            else if(A.src){ var r=A.play(); if(r&&typeof r.catch==='function') r.catch(function(){}); }
          }
        }catch(e){ bad('계속 틀지 못했어요'); return; }
        ok(); return;
      }
      if(op.act==='next'||op.act==='prev'){
        if(!list.length){ bad('노래 목록이 비어 있어요'); return; }
        var fn=m?(m[op.act==='next'?'next':'prev']):null;
        if(typeof fn!=='function'){ bad('곡을 넘기지 못했어요'); return; }
        try{ fn(); }catch(e){ bad('곡을 넘기지 못했어요'); return; }
        ok(); return;
      }
      if(op.act==='mix'){
        if(!list.length){ bad('노래 목록이 비어 있어요'); return; }
        var mx=needFn('sdyPlayRandomMix');
        if(!mx){ bad('랜덤 믹스를 만들지 못했어요'); return; }
        try{ mx(op.n||20); }catch(e){ bad('랜덤 믹스를 만들지 못했어요'); return; }
        played=true; ok(); return;
      }
      if(op.act==='big'){
        var bg=m?m.big:null;
        if(typeof bg!=='function'){ bad('큰 플레이어를 열지 못했어요'); return; }
        try{ bg(); }catch(e){ bad('큰 플레이어를 열지 못했어요'); return; }
        ok(); return;
      }
      if(op.act==='vol'){
        var sv=m?m.vol:null;
        if(typeof sv!=='function'){ bad('볼륨을 바꾸지 못했어요'); return; }
        try{ sv(Math.max(0,Math.min(1,op.v/100))); }catch(e){ bad('볼륨을 바꾸지 못했어요'); return; }
        ok(); return;
      }
      bad('알 수 없는 음악 동작이에요');
    }
    function eqOp(op){
      var eq=null;
      try{
        if(typeof window!=='undefined'&&window.sdyEq&&typeof window.sdyEq==='object') eq=window.sdyEq;
        else if(typeof window!=='undefined'&&window.sdyMusic&&window.sdyMusic.eq) eq=window.sdyMusic.eq;
      }catch(e){ eq=null; }
      if(!eq){ bad('이퀄라이저 준비가 안 됐어요'); return Promise.resolve(); }
      if(op.act==='on'){
        return Promise.resolve().then(function(){ return eq.on(); }).then(function(res){
          if(res===false){ bad('이 브라우저나 음원에서는 이퀄라이저를 켤 수 없어요'); return; }
          ok();
        },function(){ bad('이퀄라이저를 켜지 못했어요'); });
      }
      if(op.act==='off'){
        try{ eq.off(); ok(); }catch(e){ bad('이퀄라이저를 끄지 못했어요'); }
        return Promise.resolve();
      }
      if(op.act==='toggle'){
        return Promise.resolve().then(function(){ return eq.toggle(); }).then(function(res){
          if(res===false){ bad('이 브라우저나 음원에서는 이퀄라이저를 켤 수 없어요'); return; }
          ok();
        },function(){ bad('이퀄라이저를 전환하지 못했어요'); });
      }
      if(op.act==='reset'){
        try{ eq.reset(); ok(); }catch(e){ bad('이퀄라이저를 초기화하지 못했어요'); }
        return Promise.resolve();
      }
      if(op.act==='open'||op.act==='show'){
        return Promise.resolve().then(function(){ return eq.open(); }).then(function(res){
          if(res===false){ bad('이퀄라이저 창을 열지 못했어요'); return; }
          ok();
        },function(){ bad('이퀄라이저 창을 열지 못했어요'); });
      }
      if(op.act==='close'||op.act==='hide'){
        try{ eq.close(); ok(); }catch(e){ bad('이퀄라이저 창을 닫지 못했어요'); }
        return Promise.resolve();
      }
      if(op.act==='preset'){
        return Promise.resolve().then(function(){ return eq.preset(op.preset); }).then(function(res){
          if(res===false){ bad('‘'+op.preset+'’ 프리셋을 찾을 수 없거나 켤 수 없어요'); return; }
          ok();
        },function(){ bad('이퀄라이저 프리셋을 변경하지 못했어요'); });
      }
      bad('알 수 없는 이퀄라이저 동작이에요');
      return Promise.resolve();
    }
    function noteOp(op){
      if(op.act==='new'){
        var cn=needFn('createNB');
        if(!cn){ bad('새 노트를 만들지 못했어요'); return Promise.resolve(); }
        return Promise.resolve().then(function(){ return cn(); }).then(function(){ ok(); },function(){ bad('새 노트를 만들지 못했어요'); });
      }
      if(op.act==='open'){
        var nbs=[]; try{ nbs=(typeof notebooks!=='undefined'&&notebooks)||[]; }catch(e){ nbs=[]; }
        var q=String(op.q||'').trim().toLowerCase();
        var hit=null;
        for(var i=0;i<nbs.length;i++){
          if(nbs[i]&&!nbs[i].trash&&String(nbs[i].title||'').trim().toLowerCase()===q){ hit=nbs[i]; break; }
        }
        if(!hit){
          for(var j=0;j<nbs.length;j++){
            if(nbs[j]&&!nbs[j].trash&&String(nbs[j].title||'').toLowerCase().indexOf(q)>=0){ hit=nbs[j]; break; }
          }
        }
        if(!hit){ bad('‘'+op.q+'’ 노트를 찾지 못했어요'); return Promise.resolve(); }
        var ob=needFn('openNB');
        if(!ob){ bad('노트를 열지 못했어요'); return Promise.resolve(); }
        return Promise.resolve().then(function(){ return ob(hit); }).then(function(){ ok(); },function(){ bad('노트를 열지 못했어요'); });
      }
      if(op.act==='close'){
        var ed=null;
        try{ ed=document.getElementById('editorView'); }catch(e){ ed=null; }
        if(!ed||!ed.classList.contains('open')){ bad('이미 홈 화면이에요'); return; }
        var ce=needFn('closeEditor');
        if(!ce){ bad('노트를 닫지 못했어요'); return; }
        try{ ce(); }catch(e){ bad('노트를 닫지 못했어요'); return; }
        ok(); return;
      }
      bad('알 수 없는 노트 동작이에요');
    }
    function timerOp(op){
      if(op.act==='off'){
        var ts=needFn('sdyTimerStop');
        if(!ts||!ts()){ bad('타이머를 멈추지 못했어요'); return; }
        ok(); return;
      }
      var raw=String(op.min||'').trim(), min=null;
      var h=/(\d+)\s*시간/.exec(raw), mi=/(\d+)\s*분/.exec(raw), se=/(\d+)\s*초/.exec(raw);
      if(h||mi||se){
        min=(h?parseInt(h[1],10)*60:0)+(mi?parseInt(mi[1],10):0)+(se?Math.ceil(parseInt(se[1],10)/60):0);
      }else if(/^\d+(\.\d+)?$/.test(raw)){
        min=Math.round(parseFloat(raw));
      }
      if(min==null||min<1||min>1440){ bad('타이머 시간은 1분에서 24시간 사이로 말해 주세요'); return; }
      var tt=needFn('sdyTimerStart');
      if(!tt||!tt(min,op.memo||'')){ bad('타이머를 시작하지 못했어요'); return; }
      ok(); return;
    }
    function presentOp(op){
      if(!inNote()){ bad('노트를 연 다음에 발표해 주세요 해돌~'); return; }
      if(op.on){
        var sp2=needFn('startPresent');
        if(!sp2){ bad('발표를 시작하지 못했어요'); return; }
        // 모드 켜짐·화면 표시까지는 동기라 바로 확인할 수 있고, 쪽 그리기는
        // 백그라운드에서 이어진다(끝날 때까지 @done을 붙잡지 않는다).
        try{
          var pr=sp2();
          if(pr&&typeof pr.catch==='function') pr.catch(function(){});
        }catch(e){ bad('발표를 시작하지 못했어요'); return; }
        ok(); return;
      }
      var on=false; try{ on=(typeof presentOn!=='undefined')&&!!presentOn; }catch(e){ on=false; }
      if(!on){ bad('발표 중이 아니에요'); return; }
      var ep=needFn('endPresent');
      if(!ep){ bad('발표를 끝내지 못했어요'); return; }
      try{ ep(); }catch(e){ bad('발표를 끝내지 못했어요'); return; }
      ok(); return;
    }
    function exportOp(op){
      if(!inNote()){ bad('노트를 연 다음에 내보내 주세요 해돌~'); return; }
      if(op.pdf){
        var ex=needFn('exportPDF');
        if(!ex){ bad('PDF로 저장하지 못했어요'); return; }
        return Promise.resolve().then(function(){ return ex(); }).then(function(){ ok(); },function(){ bad('PDF로 저장하지 못했어요'); });
      }
      var em=needFn('openExportModal');
      if(!em){ bad('내보내기 창을 열지 못했어요'); return; }
      try{ em(); }catch(e){ bad('내보내기 창을 열지 못했어요'); return; }
      ok(); return;
    }
    /* 14.29.3 · 노트의 자동 번역(우클릭 '이 페이지 번역'과 같은 함수)을 실행한다.
       오래 걸리는 일이라 기다리지 않는다 — 진행바와 [중단] 버튼이 알아서 안내한다. */
    function translateOp(op){
      if(!inNote()){ bad('노트를 연 다음에 번역해 주세요 해돌~'); return; }
      var T=null;
      try{ T=window.__sdyTranslate||null; }catch(e){ T=null; }
      if(!T||typeof T.page!=='function'||typeof T.doc!=='function'){ bad('번역 기능을 찾지 못했어요'); return; }
      try{
        if(op.scope==='doc') T.doc(op.lang);
        else T.page((typeof T.curPage==='function'?T.curPage():0),op.lang);
      }catch(e){ bad('번역을 시작하지 못했어요'); return; }
      note(op.scope==='doc'?'문서 전체를 번역하고 있어요 · 진행바에서 멈출 수 있어요'
                           :'이 페이지를 번역하고 있어요 · 진행바에서 멈출 수 있어요');
      ok(); return;
    }
    function findOp(op){
      if(!inNote()){ bad('노트를 연 다음에 찾아 주세요 해돌~'); return; }
      var of=needFn('openFind'), rf=needFn('runFind');
      if(!of){ bad('찾기를 열지 못했어요'); return; }
      try{
        of();
        var inp=document.getElementById('findInput');
        if(inp){ inp.value=op.q; }
        if(rf) rf(op.q);
      }catch(e){ bad('찾기를 실행하지 못했어요'); return; }
      ok(); return;
    }
    return chain.then(function(){
      // 음악 재생을 시도했으면 자동재생이 막혔는지 확인한다 — 막혔으면
      // 곡은 골라 둔 상태라 ▶ 만 누르면 바로 나온다.
      if(!played) return res;
      return new Promise(function(resolve){
        setTimeout(function(){
          try{
            var A=null;
            try{ A=(window.sdyMusic&&window.sdyMusic.audio)?window.sdyMusic.audio():null; }catch(e){ A=null; }
            if(A&&A.src&&A.paused) note('브라우저 정책상 자동재생이 막히면 아래 바의 ▶ 를 눌러 주세요');
          }catch(e){}
          resolve(res);
        },700);
      });
    });
  };

  /* ── 미리 준비(warm) — '이 페이지'·'전체 페이지' 정리를 노트를 여는 순간
     슬쩍 만들어 둔다. 같은 글로는 두 번 묻지 않는다(쪽 하나뿐인 노트는 이 페이지
     글 = 전체 글이라 한 번만 간다). 준비된 답은 브라우저에도 들고 있어서,
     버튼을 누르면 서버까지 갈 일 없이 그 자리에서 바로 나온다. */
  var warmCache={}, warmPend={}, warmTimer=null, warmCount=0;
  var WARM_MIN=40;      // 이보다 짧은 노트는 준비하지 않는다(의미 없는 호출 방지)
  var WARM_MAX=40;      // 한 페이지에서 준비하는 최대 횟수
  function hash(s){
    var h=5381, str=String(s||'');
    for(var i=0;i<str.length;i++) h=((h<<5)+h+str.charCodeAt(i))|0;
    return (h>>>0).toString(36)+'-'+str.length;
  }
  function warmKey(txt){ return 'outline|'+hash(txt); }
  function warmGet(txt){ return warmCache[warmKey(txt)]||null; }
  function warmSet(txt,v){
    warmCache[warmKey(txt)]=v;
    var ks=Object.keys(warmCache);
    if(ks.length>24) delete warmCache[ks[0]];        // 오래된 것부터 버린다
  }
  /* 20.1 · 버튼에 '준비됨' 표시를 칠하는 일은 노트 글 전체를 읽어야 알 수 있다.
     예전엔 스크롤·렌더마다 이걸 곧바로 불러 문서 전체(논문 수백 쪽)를 훑었다 —
     한 동작에 수 초씩 멎던 원인. 이제 한가할 때(idle) 한 번만 계산하고,
     연달아 부르면 하나로 합친다. */
  var paintTimer=null;
  function paintOutlineReadyNow(){
    [['aiOutlinePage','page','지금 보고 있는 이 페이지를 정리해 줘요'],
     ['aiOutlineDoc','doc','전체 페이지를 한 번에 정리해 줘요']].forEach(function(it){
      var b=$(it[0]); if(!b) return;
      var ready=false;
      if(enabled){
        // 20.2 · 표시 하나 칠하려고 문서 전체를 뽑아 화면을 멎게 하지 않는다.
        //   준비가 덜 됐으면 '아직 아님'으로 두고, 채워지면 다시 칠한다.
        try{ var t=noteTextIfReady(it[1]); ready=(t!=null)&&!!warmGet(t); }catch(e){ ready=false; }
      }
      b.classList.toggle('ready',ready);
      b.title=ready?'미리 준비해 뒀어요 · 누르면 바로 나와요':it[2];
    });
  }
  function paintOutlineReady(){
    if(paintTimer) return;                     // 이미 예약됨 — 겹쳐 부르지 않는다
    var run=function(){ paintTimer=null; paintOutlineReadyNow(); };
    paintTimer=setTimeout(run,16)||1;          // 다음 틈에 한 번만 (연타를 하나로 합침)
  }
  function warmOne(txt){
    if(!enabled||!txt) return Promise.resolve(null);
    var k=warmKey(txt);
    if(warmCache[k]||warmPend[k]) return Promise.resolve(warmCache[k]||null);
    if(warmCount>=WARM_MAX) return Promise.resolve(null);
    warmCount++; warmPend[k]=1;
    return fetch('/api/ai/ask',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-sdy-auth':token()},
      body:JSON.stringify({task:'outline',text:txt,question:'',warm:true})
    }).then(function(r){ return r.json(); }).then(function(d){
      delete warmPend[k];
      if(d&&d.ok&&d.text){
        warmSet(txt,{text:String(d.text),provider:d.provider||'',model:d.model||''});
        paintOutlineReady();
      }
      return warmCache[k]||null;
    }).catch(function(){ delete warmPend[k]; return null; });
  }
  function warmAll(){
    if(!enabled||ctl) return;
    if(!inNote()) return;
    try{ if(document.visibilityState==='hidden') return; }catch(e){}
    // 20.1 · 문서 전체 글을 뽑는 건 논문에서 제일 비싼 한 방이다.
    //   손가락이 움직이는 동안 하면 그대로 멈춤으로 보이므로, 브라우저가
    //   한가해질 때까지 기다렸다 한다.
    // 20.2 · 문서 전체 글이 아직 다 안 뽑혔으면 억지로 뽑지 않는다.
    //   편집기가 한가할 때 몇 쪽씩 채워 두고(aiFillDocText), 채워지면 그때 준비한다.
    var run=function(){
      if(!enabled||ctl||!inNote()) return;
      var again=false;
      ['page','doc'].forEach(function(sc){      // 쪽이 하나뿐인 노트는 글이 같아 한 번만 간다
        var txt=noteTextIfReady(sc);
        if(txt==null){ again=true; return; }    // 아직 준비 중 — 다음 기회에
        if(txt.length>=WARM_MIN) warmOne(txt);
      });
      if(again) scheduleWarm(1500);             // 다 채워질 때까지 느긋하게 다시 본다
    };
    if(typeof requestIdleCallback==='function') requestIdleCallback(run,{timeout:4000});
    else run();
  }
  function scheduleWarm(delay){
    if(warmTimer) clearTimeout(warmTimer);
    warmTimer=setTimeout(function(){ warmTimer=null; warmAll(); },delay==null?900:delay);
  }
  // 20.2 · 편집기가 쪽 글을 다 채우면 버튼 표시를 갱신해 달라고 부른다
  window.sdyAiPaintReady=function(){ paintOutlineReady(); };
  // 테스트·디버그: 기다리지 말고 지금 바로 준비 / 준비해 둔 답 비우기
  window.sdyAiWarmNow=function(){ warmAll(); };
  window.sdyAiWarmReset=function(){ warmCache={}; warmPend={}; warmCount=0; paintOutlineReady(); };

  /* ── 스트리밍 읽기 (SSE) ─────────────────────────────────────────────
     서버가 event: meta/delta/done/error 로 흘려 본다. JSON 으로 오면
     (검증 오류 400·503·429, 또는 스트림을 못 주는 서버) 그냥 그대로 읽는다. */
  function readSSE(r,onDelta){
    var ct='';
    try{ ct=String((r.headers&&r.headers.get)?(r.headers.get('content-type')||''):''); }catch(e){}
    if(r.status>=400||ct.indexOf('application/json')>=0
       ||!(r.body&&typeof r.body.getReader==='function')){
      return r.json().then(function(d){ return {status:r.status,d:d||{}}; },
        function(){ return {status:r.status,d:{ok:false,error:'AI 답을 읽지 못했어요'}}; });
    }
    var reader=r.body.getReader(), dec=new TextDecoder(), buf='', got=null;
    function evt(raw){
      var ev='message', data='', ln=String(raw).split('\n');
      for(var i=0;i<ln.length;i++){
        var s=ln[i];
        if(s.indexOf('event:')===0) ev=s.slice(6).trim();
        else if(s.indexOf('data:')===0) data+=s.slice(5).trim();
      }
      if(!data) return;
      var j=null; try{ j=JSON.parse(data); }catch(e){ return; }
      if(!j) return;
      if(ev==='delta'){ if(j.t) onDelta(String(j.t)); }
      else if(ev==='done'){
        got={status:200,d:{ok:true,status:200,text:String(j.text||''),provider:j.provider||'',
          model:j.model||'',cached:!!j.cached,truncated:!!j.truncated,chars:j.chars||0}};
      }else if(ev==='error'){
        var st=Number(j.status||502)||502;
        got={status:st,d:{ok:false,status:st,limited:!!j.limited,
          error:String(j.error||'AI에 닿지 못했어요'),hint:String(j.hint||''),
          retry_after:Number(j.retry_after||0)||0}};
      }
    }
    function pump(){
      if(got) return Promise.resolve(got);
      return reader.read().then(function(ch){
        if(ch.done) return got||{status:200,d:{ok:false,error:'AI 답이 끊겼어요 · 다시 시도해 주세요'}};
        buf+=dec.decode(ch.value,{stream:true});
        var i, guard=0;
        while((i=buf.indexOf('\n\n'))>=0&&guard++<800){
          evt(buf.slice(0,i)); buf=buf.slice(i+2);
          if(got) break;
        }
        return pump();
      });
    }
    return pump();
  }

  /* ── 묻고 답하기 — 정리(outline: 이 페이지/전체 페이지) 와 질문(chat) ──
     14.26.0 · chat 답이 [[edit]]·[[app]] 이면(서버가 편집·실행 요청이라 판단)
     스냅샷을 잡아 해당 일로 한 번만 자동 넘기기한다. edit·app 요청에는 직전
     1턴을 context 로 싣는다(@ask 되묻기 뒤의 짧은 답도 이어진다). */
  function run(task,q,scope,hopped,hint){
    if(ctl) return;                                   // 말하는 중엔 또 묻지 않는다
    q=String(q||'').trim();
    // 14.31.0 · hint — 화면·기록에는 안 보이지만 모델에게만 붙이는 한 줄 지침
    //   (예: '사진은 반드시 @img 로만 넣어 줘'). 요청 원문(q)은 그대로 남는다.
    var askQ=hint?(q+'\n\n'+hint):q;
    scope=(scope==='page')?'page':'doc';              // outline 의 범위 — chat/edit/app 은 문서 전체
    var editCapture=task==='edit'?aiCapture():null;
    var drawRevision=task==='draw'?(function(){ try{ var c=aiCapture(); return c?c.revision:''; }catch(e){ return ''; } })():'';
    var appText=task==='app'?appCapture():'';
    var txt=editCapture?editCapture.text:(task==='app'?appText:noteText(task==='outline'?scope:'doc'));
    closedByUser=false;
    if(task==='outline'&&!txt){
      kindChip(''); meta('');
      busy(false);
      out(scope==='page'?'이 페이지에 글이 없어요. 글을 적고 나면 정리해 줄게요 해돌~'
        :'열린 노트에 글이 없어요. 글을 적고 나면 정리해 줄게요 해돌~',true);
      return;
    }
    if(task==='chat'&&!q) return;                     // 빈 질문 Enter — 조용히 무시
    if(task==='edit'&&(!q||!txt)){
      otterLine(!txt?'문서 상태를 읽지 못했어요 · 노트를 다시 열어 주세요':'어떻게 고칠지 적어 줘 해돌~');
      return;
    }
    if(task==='app'&&(!q||!txt)){
      otterLine(!txt?'앱 상태를 읽지 못했어요 · 페이지를 새로고침해 주세요':'무엇을 실행할지 적어 줘 해돌~');
      return;
    }
    if(task==='draw'){
      if(!q) return;
      if(!canEdit()){
        otterLine('노트를 연 다음에 그려 달라고 해 줘 해돌~');
        return;
      }
    }
    // ① 정리 — 미리 준비해 둔 답이 있으면 기다림 없이 그 자리에서 바로
    if(task==='outline'){
      var ready=warmGet(txt);
      if(ready&&ready.text){
        lastText=ready.text;
        lastKind=(scope==='page'?'outlinePage':'outlineDoc'); lastQ='';
        kindChip(lastKind);
        out(lastText); busy(false);
        meta('미리 준비해 둔 답이에요 해돌~');
        histPush(lastKind,'',lastText);
        return;
      }
    }
    ctl=new AbortController();
    busy(true); lastText=''; lastKind=''; lastQ=q;
    kindChip(task==='edit'?'edit':(task==='app'?'app':''));
    otterHide();                                       // 대답 시작 — 작은 말풍선은 접는다
    out('',true); meta('');
    var acc='';
    // ② 말하는 대로: stream:true → SSE 조각이 올 때마다 말풍선에 붙인다
    var moved=false;                                   // chat → edit 자동 넘기기 여부
    fetch('/api/ai/ask',{
      method:'POST', signal:ctl.signal,
      headers:{'Content-Type':'application/json','x-sdy-auth':token()},
      body:JSON.stringify({task:task,text:txt,question:askQ,stream:true,
        context:task==='edit'?editCtxText():(task==='app'?appCtxText():'')})
    }).then(function(r){
      return readSSE(r,function(d){
        acc+=d;
        if(task==='edit'){ out(editProgress(acc),true); return; }
        if(task==='app'){ out(appProgress(acc),true); return; }
        if(task==='draw'){ out(drawProgress(acc),true); return; }
        if(task==='chat'){
          var p=parseChat(acc);
          if(p.wait){ out('',true); return; }          // 표식이 채 안 왔으면 아직 생각 중
          if(p.kind==='edit'){                         // 서버가 편집 요청이라 판단 — 넘기는 중
            kindChip('edit');
            out('문서 편집 요청으로 보여서 넘기는 중…',true);
            return;
          }
          if(p.kind==='app'){                          // 서버가 앱 실행 요청이라 판단 — 넘기는 중
            kindChip('app');
            out('앱 실행 요청으로 보여서 넘기는 중…',true);
            return;
          }
          if(p.kind==='search'){                       // 인터넷 검색이 필요한 질문 — 찾는 중
            kindChip('search');
            out('인터넷에서 찾아보는 중…',true);
            return;
          }
          if(p.kind==='draw'){                         // 펜 그림 요청 — 넘기는 중
            kindChip('draw');
            out('그림 그리기로 넘기는 중…',true);
            return;
          }
          if(p.kind) kindChip(p.kind);
          out(p.text,true);
        }else{
          out(acc,true);
        }
      });
    }).then(function(res){
      var d=res.d||{};
      if(d.ok){
        var text=String(d.text||acc||'');
        var kind=(scope==='page'?'outlinePage':'outlineDoc');
        if(task==='chat'){
          var p=parseChat(text);
          if(p.wait) p={kind:'',text:text};            // 표식만 달랑 오면 표식 없는 셈 친다
          text=p.text; kind=p.kind;
          // 서버 [[edit]] — 노트가 열려 있으면 편집으로 한 번만 넘긴다.
          if(kind==='edit'&&!hopped){
            if(canEdit()){ ctl=null; moved=true; run('edit',q,scope,true); return; }
            kind='';
            text='편집 요청 같은데 · 노트를 연 다음에 다시 말해 줘 해돌~';
          }
          // 서버 [[search]] — 인터넷 검색을 실행한 뒤 결과를 붙여 한 번만 다시 묻는다.
          if(kind==='search'&&!hopped){
            ctl=null; moved=true; searchThenChat(q,scope); return;
          }
          // 서버 [[draw]] — 펜 그림으로 한 번만 넘긴다(노트가 열려 있을 때만).
          //   14.36.0 · 참고 일러스트 경로(runDraw)가 먼저, 없으면 모델 직접 그리기.
          if(kind==='draw'&&!hopped){
            if(canEdit()){ ctl=null; moved=true; runDraw(q,true); return; }
            kind='';
            text='그림은 노트를 연 다음에 그려 줄게요 해돌~';
          }
          // 서버 [[app]] — 앱 실행으로 한 번만 넘긴다(노트 밖에서도 된다).
          if(kind==='app'&&!hopped){
            ctl=null; moved=true; run('app',q,scope,true); return;
          }
        }
        var doneAll=function(finalText){
          lastText=finalText; lastKind=kind;
          kindChip(kind);
          out(lastText);
          meta('');                                    // 모델·소요 초 같은 기술 정보는 안 보여 준다
          if(task==='outline'){
            warmSet(txt,{text:lastText,provider:d.provider||'',model:d.model||''});
            paintOutlineReady();
          }
          // 대화 문맥은 histPush로 쌓인 대화기록에서 만든다(aiCtxText) —
          // 편집·실행·질문이 한 뭉치로 이어진다.
          histPush(kind,q,lastText);
          // 답은 큰 말풍선(#aiSay)이 다 말하고 있다 — 같은 말을 작은 말풍선으로
          //   아래에 한 번 더 띄우면 겹쳐 보이기만 해서 여기서는 조용히 넘긴다.
        };
        if(task==='edit'){
          kind='edit';
          var applied=editApplyDone(text,editCapture);   // 완성된 계획만 원자적으로 적용
          if(applied&&typeof applied.then==='function'){ // 클립보드 명령 — 읽고 나서 마무리
            out('문서에 적용하는 중…',true);
            applied.then(doneAll,function(){ doneAll('문서에 적용하지 못했어요 · 다시 시도해 주세요'); });
            return;
          }
          doneAll(applied);
        }else if(task==='app'){
          kind='app';
          var ran=appApplyDone(text);                    // 완성된 계획만 순서대로 실행
          if(ran&&typeof ran.then==='function'){        // 음악 재생 — 자동재생 확인하고 마무리
            out('앱에서 실행하는 중…',true);
            ran.then(doneAll,function(){ doneAll('실행하지 못했어요 · 다시 시도해 주세요'); });
            return;
          }
          doneAll(ran);
        }else if(task==='draw'){
          kind='draw';
          var drew=drawApplyDone(text,drawRevision);     // SVG → 펜 획 → 한 번에 적용
          if(drew&&typeof drew.then==='function'){
            out('종이에 그리고 있는 중…',true);
            drew.then(doneAll,function(){ doneAll('그림을 그리지 못했어요 · 다시 시도해 주세요'); });
            return;
          }
          doneAll(drew);
        }else doneAll(text);
      }else{
        // 말하다 끊겼으면 그까지라도 남겨 둔다(복사·읽기는 되게)
        lastText=(task==='edit'||task==='app'||task==='draw')?'':(acc?(task==='chat'?(parseChat(acc).text||''):acc):'');
        kindChip('');
        out(String(d.error||'AI에 닿지 못했어요'),true);
        // 401/404 는 설정 문제 — 어디를 봐야 하는지 서버가 짚어 준 걸 그대로 띄운다.
        meta(d.hint?String(d.hint):(d.retry_after?('약 '+d.retry_after+'초 뒤에 다시 시도해 주세요'):''));
      }
    }).catch(function(e){
      if(e&&e.name==='AbortError'&&closedByUser){ return; }   // 말풍선을 닫으며 멈춘 것
      lastText=(task==='edit'||task==='app'||task==='draw')?'':(acc?(task==='chat'?(parseChat(acc).text||''):acc):'');
      kindChip('');
      out((e&&e.name==='AbortError')?'멈췄어요.':'네트워크 오류 · 잠시 뒤 다시 시도해 주세요',true);
      meta('');
    }).then(function(){
      if(moved) return;                                // edit 으로 넘겼으니 새 실행 것을 둔다
      ctl=null; busy(false);
    });
  }

  /* 14.31.0 · 사진 곧바로 넣기 — 모델을 거치지 않고 서버(/api/ai/imgadd)가
     찾아 저장한 사진을 현재 쪽 빈자리에 넣는다.
     왜 모델을 거치지 않나: "고양이 사진 넣어 줘" 처럼 사진만 부탁한 요청은
     모델이 할 일이 @img 한 줄뿐인데, 그 한 줄을 빼먹으면 아무 일도 일어나지
     않는다. 서버가 검색어까지 다듬어 주니(영어 번역·관련도 순위) 이 경로가
     훨씬 빠르고 정확하다. 글도 함께 부탁한 요청은 편집기(run 'edit')가
     글과 사진을 함께 놓는다 — sdyAiRun 이 갈라 준다. */
  function runPhoto(q){
    if(ctl) return;
    if(!canEdit()){ otterLine('노트를 연 다음에 사진을 넣어 달라고 해 줘 해돌~'); return; }
    var page=(typeof curPageIdx!=='undefined'?(curPageIdx|0)+1:1);
    var what=photoCmdOf(q)!=null?photoCmdOf(q):q;
    ctl=new AbortController();
    busy(true); lastText=''; lastKind='edit'; lastQ=q;
    kindChip('edit');
    otterHide(); out('',true); meta('');
    out('사진을 찾고 있어요…',true);
    var finish=function(say,applied){
      ctl=null; busy(false);
      lastText=say; lastKind='edit'; kindChip('edit');
      out(say); meta('');
      if(applied){ try{ if(window.toast) window.toast('해돌이가 사진을 넣었어요 해돌~ · Ctrl+Z로 되돌릴 수 있어요',2600); }catch(e3){} }
      histPush('edit',q,say);
    };
    fetch('/api/ai/imgadd',{method:'POST',signal:ctl.signal,
      headers:{'Content-Type':'application/json','x-sdy-auth':token()},
      body:JSON.stringify({q:String(what||'').slice(0,200)})})
    .then(function(r){
      return r.json().catch(function(){ return null; })
        .then(function(j){ return {ok:r.ok,j:j}; });
    })
    .then(function(got){
      var j=got&&got.j;
      if(!got||!got.ok||!j||!j.ok||!j.url){
        finish(String((j&&j.error)||'사진을 찾지 못했어요 · 무엇의 사진인지 조금 더 구체적으로 알려 줘 해돌~'),false);
        return;
      }
      var ops=[{cmd:'addimg',page:page,x:'auto',y:'auto',w:'auto',h:'auto',
        url:j.url,public_id:j.public_id||'',natW:j.width||null,natH:j.height||null}];
      var applied=function(res){
        res=res||{applied:0,notes:[],stale:false};
        if(res.stale){ finish((res.notes&&res.notes[0])||'기다리는 동안 문서가 바뀌어 사진을 넣지 않았어요 · 다시 요청해 주세요',false); return; }
        var say;
        if(res.applied){
          var nm=String(j.title||'').trim();
          say='‘'+(nm?nm.slice(0,40):String(what).slice(0,40))+'’ 사진을 넣었어요 해돌~ · Ctrl+Z로 되돌릴 수 있어요';
        }else say='사진을 넣지 못했어요 · 다시 시도해 주세요';
        if(res.notes&&res.notes.length) say+='\n'+res.notes.join('\n');
        finish(say,!!res.applied);
      };
      try{
        var r2=window.__sdyAiBridge.apply(ops);
        if(r2&&typeof r2.then==='function') r2.then(applied,applied); else applied(r2);
      }catch(e){ applied(null); }
    })
    .catch(function(e){
      if(e&&e.name==='AbortError'&&closedByUser) return;
      finish('사진을 찾지 못했어요 · 잠시 뒤 다시 시도해 주세요',false);
    });
  }
  window.sdyAiRunPhoto=function(q){ runPhoto(String(q||'').trim()); };

  /* 14.36.0 · 참고 일러스트를 따라 그리기 — 그림 요청의 1순위 경로.
     "그림 수준이 너무 떨어진다"는 원인은 모델이 좌표를 즉석에서 지어내는 데
     있었다. 이제 서버(/api/ai/refdraw)가 잘 그려진 선화(OpenMoji, CC BY-SA)
     묶음에서 요청에 맞는 참고 그림을 찾아(후보가 여럿이면 모델이 번호로 고름)
     그 윤곽을 SVG 로 돌려주고, 브라우저는 그것을 펜 획으로 옮겨 그린다 —
     사람이 그림을 배울 때 트레이싱하듯 윤곽이 원본 그대로라 퀄리티가 보장된다.
     참고 그림이 없는 주제(404 nomatch)일 때만 예전처럼 모델이 직접 그린다
     (run 'draw'). 사용자에게는 어느 경로였는지 말풍선 한 줄로 알려 준다. */
  function runDraw(q,hopped){
    if(ctl) return;
    q=String(q||'').trim();
    if(!q) return;
    if(!canEdit()){ otterLine('노트를 연 다음에 그려 달라고 해 줘 해돌~'); return; }
    var revision=(function(){ try{ var c=aiCapture(); return c?c.revision:''; }catch(e){ return ''; } })();
    ctl=new AbortController();
    busy(true); lastText=''; lastKind='draw'; lastQ=q;
    kindChip('draw');
    otterHide(); out('',true); meta('');
    out('그릴 모양을 고르고 있어요…',true);
    var fallback=function(){                          // 참고 그림이 없다 → 모델이 직접 그린다
      ctl=null; busy(false);
      run('draw',q,'doc',!!hopped);
    };
    var finish=function(say,applied){
      ctl=null; busy(false);
      lastText=say; lastKind='draw'; kindChip('draw');
      out(say); meta('');
      if(applied){ try{ if(window.toast) window.toast('해돌이가 그림을 그렸어요 해돌~ · Ctrl+Z로 되돌릴 수 있어요',2600); }catch(e3){} }
      histPush('draw',q,say);
    };
    fetch('/api/ai/refdraw',{method:'POST',signal:ctl.signal,
      headers:{'Content-Type':'application/json','x-sdy-auth':token()},
      body:JSON.stringify({q:q.slice(0,200)})})
    .then(function(r){
      return r.json().catch(function(){ return null; })
        .then(function(j){ return {ok:r.ok,status:r.status,j:j}; });
    })
    .then(function(got){
      var j=got&&got.j;
      if(!got||!got.ok||!j||!j.ok||!j.svg){
        // 404(nomatch·noterms) 는 '못 찾음' — 모델이 직접 그리는 길로 내려간다.
        // 그 밖(429·5xx) 도 그림을 아예 못 그리는 것보다는 직접 그리기가 낫다.
        fallback(); return;
      }
      out('컬러 펜으로 그리는 중…',true);
      var parsed=window.sdyAiDrawParse?window.sdyAiDrawParse(j.svg):{ok:false,ops:[]};
      if(!parsed.ok||!parsed.ops.length){ fallback(); return; }
      var name=String(j.name||'').trim();
      var applied=function(res){
        res=res||{applied:0,notes:[],stale:false};
        if(res.stale){ finish((res.notes&&res.notes[0])||'기다리는 동안 문서가 바뀌어서 그리지 않았어요 · 다시 요청해 주세요',false); return; }
        var say;
        if(res.applied){
          say='‘'+(name?name.slice(0,30):q.slice(0,30))+'’ 그림을 컬러 펜으로 '+parsed.strokes+'획 그렸어요 해돌~ · Ctrl+Z로 되돌릴 수 있어요';
        }else say=String((res.notes&&res.notes[0])||'그림을 그리지 못했어요 · 다시 시도해 주세요');
        if(res.applied&&res.notes&&res.notes.length) say+='\n'+res.notes.join('\n');
        finish(say,!!res.applied);
      };
      try{
        var bridge=window.__sdyAiBridge;
        if(!(bridge&&typeof bridge.apply==='function')){ finish('그림 그리기 연결을 찾지 못했어요 · 페이지를 새로고침해 주세요',false); return; }
        var r2=bridge.apply(parsed.ops,revision);
        if(r2&&typeof r2.then==='function') r2.then(applied,applied); else applied(r2);
      }catch(e){ applied(null); }
    })
    .catch(function(e){
      if(e&&e.name==='AbortError'&&closedByUser){ ctl=null; busy(false); return; }
      fallback();                                     // 네트워크 문제 — 모델 직접 그리기로
    });
  }
  window.sdyAiRunDraw=function(q){ runDraw(String(q||'').trim()); };

  /* 14.39.0 · 버그 일지 신고 — 사용자가 말한 버그를 서버(task=bug)가
     제목·증상·재현 방법·기대 동작·메모로 정리해 돌려주고, 02f 의 sdyBuglogAdd
     가 설정 → 버그 일지에 기록한다. 기록되면 말풍선에 정리본과 안내를 띄운다. */
  function runBug(q){
    if(ctl){ meta('다 말하고 나서 말해 주세요 해돌~'); return; }
    q=String(q||'').trim();
    if(!q){ otterLine('어떤 버그인지 알려 줘 해돌~ · 예) /버그 표를 만들면 글자가 겹쳐요'); return; }
    closedByUser=false;
    ctl=new AbortController();
    busy(true); lastText=''; lastKind='bug'; lastQ=q;
    kindChip('bug');
    otterHide();
    out('버그를 정리해서 일지에 적는 중…',true); meta('');
    var acc='';
    fetch('/api/ai/ask',{
      method:'POST', signal:ctl.signal,
      headers:{'Content-Type':'application/json','x-sdy-auth':token()},
      body:JSON.stringify({task:'bug', question:q, stream:false})
    }).then(function(r){
      return readSSE(r,function(){});        // 비스트림 — 서버가 JSON 한 방으로 준다
    }).then(function(res){
      var d=res.d||{};
      if(d.ok){
        var text=String(d.text||acc||'').trim();
        var m=/^제목[:：]\s*(.+)$/m.exec(text);
        var stored=null;
        if(window.sdyBuglogAdd){
          try{
            var who='';
            try{ var u=window.sdyUser&&window.sdyUser(); if(u&&u.nick) who=String(u.nick); }catch(e){}
            var ver=((document.querySelector('meta[name="application-version"]')||{}).content)||'';
            stored=window.sdyBuglogAdd({
              title:m?m[1].trim():'',
              text:text,
              raw:q,
              who:who,
              ver:ver
            });
          }catch(e){}
        }
        lastText=text+(stored
          ?'\n\n— 버그 일지에 기록했어요 · 설정 → 버그 일지에서 볼 수 있어요 해돌~'
          :'');
        lastKind='bug';
        kindChip('bug');
        out(lastText);
        meta('');
        histPush('bug',q,lastText);
      }else{
        lastText=''; kindChip('');
        out(String(d.error||'AI에 닿지 못했어요'),true);
        meta(d.hint?String(d.hint):(d.retry_after?('약 '+d.retry_after+'초 뒤에 다시 시도해 주세요'):'버그 일지를 적지 못했어요 · 잠시 뒤 다시 말해 줘 해돌~'));
      }
    }).catch(function(e){
      if(e&&e.name==='AbortError'&&closedByUser){ return; }   // 말풍선을 닫으며 멈춘 것
      lastText=''; kindChip('');
      out((e&&e.name==='AbortError')?'멈췄어요.':'네트워크 오류 · 잠시 뒤 다시 시도해 주세요',true);
      meta('');
    }).then(function(){
      ctl=null; busy(false);
    });
  }
  window.sdyAiRunBug=function(q){ runBug(String(q||'').trim()); };

  /* 검색창 Enter → 바로 질문 (보내기 버튼 없음). 노트 질문인지 자유 질문인지는
     해돌이가 스스로 판단한다 — 사용자가 딱지를 고르는 일은 없다.
     14.26.0 · '시켜 달라'는 말투면 앱 실행으로, '고쳐 달라'는 말투면 편집으로
     자동 라우팅한다. 겹치는 말은 looksLikeApp 안의 문서-동사 규칙이 가른다. */
  window.sdyAiRun=function(){
    var qEl=$('aiQ'), q=qEl?String(qEl.value||'').trim():'';
    if(ctl){ meta('다 말하고 나서 물어봐 주세요 해돌~'); return; }   // 말하는 중 — 말풍선 안 한 줄로만
    if(!q){ otterLine('뭐라도 적어 줘 해돌~'); return; }
    var editCommand=editCmdOf(q);
    var bugCommand=bugCmdOf(q);
    var appCommand=appCmdOf(q);
    var drawCommand=drawCmdOf(q);
    if(qEl){ qEl.value=''; aiQGrow(); }                 // 본 요청은 말풍선(과 기록)에 남으니 칸은 비운다
    if(editCommand!=null){
      if(!editCommand){ otterLine('! 뒤에 어떻게 고칠지 적어 줘 해돌~ · 예) !제목을 맨 위로 옮겨 줘'); return; }
      if(!inNote()){ otterLine('노트를 연 다음에 고쳐 달라고 해 줘 해돌~'); return; }
      if(!(window.__sdyAiBridge&&typeof window.__sdyAiBridge.apply==='function')){
        otterLine('문서 편집 준비가 안 됐어요 · 페이지를 새로고침해 주세요'); return;
      }
      run('edit',editCommand); return;
    }
    // 14.39.0 · 명시적 버그 신고(/버그·버그 신고:·신고:) — 정리해 일지에 기록
    if(bugCommand!=null){
      if(!bugCommand){ otterLine('/버그 뒤에 어떤 버그인지 적어 줘 해돌~ · 예) /버그 표를 만들면 글이 겹쳐요'); return; }
      runBug(bugCommand); return;
    }
    if(drawCommand!=null){
      if(!drawCommand){ otterLine('/그림 뒤에 무엇을 그릴지 적어 줘 해돌~ · 예) /그림 웃는 얼굴'); return; }
      if(!inNote()){ otterLine('노트를 연 다음에 그려 달라고 해 줘 해돌~'); return; }
      if(!(window.__sdyAiBridge&&typeof window.__sdyAiBridge.apply==='function')){
        otterLine('그림 그리기 준비가 안 됐어요 · 페이지를 새로고침해 주세요'); return;
      }
      runDraw(drawCommand); return;                     // 14.36.0 · 참고 그림 → 없으면 모델
    }
    // 14.31.0 · /사진·/이미지 접두사 — 무조건 사진을 찾아 넣는다(펜 그림과 혼동 방지).
    if(photoCmdOf(q)!=null){
      var photoCommand=photoCmdOf(q);
      if(!photoCommand){ otterLine('/사진 뒤에 무엇의 사진인지 적어 줘 해돌~ · 예) /사진 고양이'); return; }
      if(!inNote()){ otterLine('노트를 연 다음에 사진을 넣어 달라고 해 줘 해돌~'); return; }
      if(!(window.__sdyAiBridge&&typeof window.__sdyAiBridge.apply==='function')){
        otterLine('사진 넣기 준비가 안 됐어요 · 페이지를 새로고침해 주세요'); return;
      }
      runPhoto(photoCommand); return;
    }
    if(appCommand!=null){
      if(!appCommand){ otterLine('/앱 뒤에 무엇을 실행할지 적어 줘 해돌~ · 예) /앱 노래 틀어줘'); return; }
      run('app',appCommand); return;
    }
    // 14.39.0 · 말로 하는 버그 신고 — '버그가 있어요', '○○가 안 돼요' 류는
    //   편집·실행보다 먼저 가른다(사진 넣기·그리기·문서 고치기와 헷갈리지 않게).
    if(looksLikeBug(q)){ runBug(q); return; }
    if(looksLikeApp(q)){ run('app',q); return; }        // '시켜 달라'는 말이면 앱 실행으로
    // 14.31.0 · 사진과 그림을 먼저 가른다 — 둘 다 '넣어 줘'로 들리지만 완전히
    //   다른 일이다(사진 = 인터넷에서 찾은 실제 사진, 그림 = 펜으로 그리는 선화).
    if(looksLikePhoto(q)){                              // '사진 넣어 줘' → 사진
      if(PHOTO_WITH_TEXT.test(q)) run('edit',q,'doc',false,PHOTO_GUIDE);  // 글 + 사진
      else runPhoto(q);                                 // 사진만 → 곧바로 넣기
      return;
    }
    if(looksLikeDraw(q)){ runDraw(q); return; }         // '그려 줘'는 말이면 펜 그림으로(참고 그림 → 모델)
    if(looksLikeEdit(q)){ run('edit',q); return; }      // ! 없어도 '고쳐 달라'는 말이면 편집으로
    run('chat',q);
  };
  window.sdyAiOutline=function(scope){
    if(ctl){ meta('다 말하고 나서 눌러 주세요 해돌~'); return; }     // 말하는 중 — 말풍선 안 한 줄로만
    run('outline','',scope);
  };
  window.sdyAiStop=function(){ if(ctl){ try{ ctl.abort(); }catch(e){} } };
  window.sdyAiSayClose=function(){
    closedByUser=true;
    window.sdyAiStop();                                 // 말하는 중에 닫으면 말하기도 멈춘다
    sayHide();
  };
  function sayHide(){ var s=$('aiSay'); if(s) s.hidden=true; }
  window.sdyAiCopy=function(){
    if(!lastText) return;
    var done=function(){ if(window.toast) window.toast('결과를 복사했어요',1400); };
    try{
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(lastText).then(done,function(){}); return;
      }
    }catch(e){}
    try{
      var ta=document.createElement('textarea');
      ta.value=lastText; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); done();
    }catch(e){}
  };

  /* 질문칸 크기 — 글이 길어지면 옆으로 늘고, 폭을 넘으면 줄이 늘어나며
     위로 자란다(검색창이 아래 고정이라 상자는 위를 향해 큰다).
     폭은 #aiQ 와 같은 글꼴인 숨은 자(.ai-q-mirror)로 한 줄 길이를 재서
     --ai-q-w 에 싣고, 높이는 textarea 의 scrollHeight 로 잰다(최대 96px). */
  var aiQMir=null;
  function aiQGrow(){
    var q=$('aiQ'); if(!q||!q.parentNode) return;
    var field=q.parentNode;                              // .ai-askbar-field
    try{
      if(!aiQMir||!aiQMir.parentNode){
        aiQMir=document.createElement('span');
        aiQMir.className='ai-q-mirror';
        document.body.appendChild(aiQMir);
      }
      var cs=(window.getComputedStyle)?window.getComputedStyle(q):null;
      if(cs){
        aiQMir.style.fontSize=cs.fontSize||'';
        aiQMir.style.fontFamily=cs.fontFamily||'';
        aiQMir.style.fontWeight=cs.fontWeight||'';
        aiQMir.style.letterSpacing=cs.letterSpacing||'';
      }
      aiQMir.textContent=q.value||q.placeholder||'';     // 비면 안내 글씨 너비만큼
      var textW=Math.ceil(aiQMir.getBoundingClientRect().width);
      // 글씨 + 좌우 패딩(30) + 상태 점(9) + 사이(8) + 여유(14)
      var want=Math.max(180,Math.min(360,textW+61));
      field.style.setProperty('--ai-q-w',want+'px');
      q.style.height='auto';
      var h=q.scrollHeight||0;
      q.style.height=(h>0?Math.min(h,96):19)+'px';       // 96px 넘으면 칸 안에서 스크롤
      field.classList.toggle('multi',h>24);              // 두 줄부터는 각진 모서리
      // 질문칸이 여러 줄로 자라면 이 기둥(범위 버튼 + 질문칸)이
      //   위를 향해 자라면서 답변 말풍선(#aiSay) 자리까지 올라온다 — 버튼이
      //   말풍선에 깔리지 않도록 말풍선을 그만큼만 위로 양보시킨다.
      //   (기둥 높이 ≈ 질문칸 높이 + 88px, 말풍선 기본 자리 = 아래에서 122px)
      var say=$('aiSay');
      if(say){
        var lift=(h>24)?Math.max(0,Math.min(48,h-28)):0;
        say.style.setProperty('--ai-lift',lift+'px');
      }
      // !, /편집, "편집:" — 또는 '고쳐 달라'·'시켜 달라'는 말투를 입력하는 동안
      // 모드를 색과 딱지로 즉시 알린다. 앱 실행은 같은 자리에 '앱 실행' 딱지.
      // 14.31.0 · 문서를 고치는 일은 편집만이 아니다 — 사진을 넣는 것도,
      // 펜으로 그림을 그리는 것도 결국 문서 편집이라 같은 보라색으로 알린다.
      var v=q.value||'';
      var bugOn=looksLikeBug(v)&&bugCmdOf(v)==null;
      var photoOn=!bugOn&&(PHOTO_PRE.test(v)||looksLikePhoto(v));
      var drawOn=!bugOn&&!photoOn&&(DRAW_PRE.test(v)||looksLikeDraw(v));
      var editOn=!bugOn&&!photoOn&&!drawOn&&(EDIT_PRE.test(v)||looksLikeEdit(v));
      var appOn=!bugOn&&!photoOn&&!drawOn&&!editOn&&(APP_PRE.test(v)||looksLikeApp(v));
      var modeOn=editOn||appOn||drawOn||photoOn||bugOn;
      var ask=$('aiAsk'); if(ask) ask.classList.toggle('edit-on',modeOn);
      var tag=$('aiEditTag');
      if(tag){
        tag.hidden=!modeOn;
        tag.textContent=bugOn?'버그 신고':(appOn?'앱 실행':(drawOn?'그림':(photoOn?'사진':'편집')));
      }
    }catch(e){}
  }
  document.addEventListener('input',function(e){
    if(e.target&&e.target.id==='aiQ') aiQGrow();
  });

  // 검색창에서 Enter = 바로 물어보기 (한글 조합 중 제외 · Shift+Enter = 줄바꿈)
  document.addEventListener('keydown',function(e){
    if(!e.target||e.target.id!=='aiQ') return;
    if(e.key!=='Enter'||e.shiftKey) return;
    if(e.isComposing||e.keyCode===229) return;          // ㄱ·ㅏ 조합 중 Enter 는 조합 끝이 아니다
    e.preventDefault();
    window.sdyAiRun();
  });
  // Esc = 대화기록 닫기 (말풍선은 X 를 누를 때까지 계속 떠 있다)
  document.addEventListener('keydown',function(e){
    if(e.key!=='Escape') return;
    var h=$('aiHist'); if(h&&!h.hidden) h.hidden=true;
  });

  /* 서버 키 상태 — 검색창 점(#aiDot) 초록=켜짐 / 주황=키 아직 미등록.
     키가 등록돼도 안 돼도 이 호출이 전부다. */
  function refreshStatus(){
    fetch('/api/ai/status',{cache:'no-store'}).then(function(r){ return r.json(); }).then(function(d){
      enabled=!!(d&&d.enabled);
      var bar=$('aiAsk'), dot=$('aiDot');
      if(bar) bar.classList.toggle('ai-on',enabled);
      if(dot) dot.title=enabled?'AI 켜짐'
        :'AI 키 아직 미등록 — 서버 .env 에 GEMINI_API_KEY(구글) 를 넣으면 켜짐';
      paintOutlineReady();
      scheduleWarm(400);
    }).catch(function(){});
  }

  /* 그리기 툴바가 하단을 차지하면 해돌이와 같이 검색창·말풍선·기록도 위로 피신 */
  function syncDrawOn(){
    var no=$('noteOtter');
    var on=!!(no&&no.classList.contains('draw-on'));
    ['aiAsk','aiSay','aiHist'].forEach(function(id){
      var el=$(id); if(el) el.classList.toggle('draw-on',on);
    });
  }

  function boot(){
    refreshStatus(); paintOutlineReady(); syncDrawOn(); aiQGrow();
    // 해돌이를 누르면 대화기록 — 창이 아니라 해돌이 곁에 작게 열린다
    var no=$('noteOtter');
    if(no){
      no.addEventListener('click',function(){ window.sdyAiHistToggle(); });
      if(typeof MutationObserver!=='undefined'){
        new MutationObserver(syncDrawOn).observe(no,{attributes:true,attributeFilter:['class']});
      }
    }
    // 노트를 열고 닫을 때 — 열으면 상태를 다시 확인하고 정리를 슬쩍 준비해 두고,
    // 닫으면 말풍선·기록도 같이 닫는다(해돌이는 노트 친구라 노트 밖에 없다)
    var ed=$('editorView');
    if(ed&&typeof MutationObserver!=='undefined'){
      new MutationObserver(function(){
        if(inNote()){
          refreshStatus();
          // 20.2 · 노트를 연 순간부터 한가한 틈에 쪽 글을 조금씩 뽑아 둔다.
          //   버튼을 누를 즈음엔 이미 다 준비돼 있고, 화면은 한 프레임도 멎지 않는다.
          try{ if(typeof window.__sdyAiFillText==='function') window.__sdyAiFillText(); }catch(e){}
          scheduleWarm(700);
        }
        else{
          sayHide();
          var h=$('aiHist'); if(h) h.hidden=true;
        }
      }).observe(ed,{attributes:true,attributeFilter:['class']});
    }
    // 글을 고치면(타이핑 멈춘 뒤) 준비해 둔 정리를 다시 만든다.
    // 20.1 · 예전엔 #pagesStage 아래 '모든' 변화에 반응했다. 그런데 쪽 가상화는
    //   스크롤할 때마다 종이(.page-wrap)와 그 안 레이어를 통째로 넣었다 뺐다 한다 —
    //   글을 한 글자도 안 고쳤는데 스크롤 내내 warm 예약이 다시 걸렸고, 그때마다
    //   문서 전체 글을 다시 뽑아 한 동작이 수 초씩 멎었다. 이제 '사람이 글을 고친
    //   변화'만 본다: 글자 바뀜(characterData)과 글상자(.tb) 안쪽 노드 변화.
    var stage=$('pagesStage');
    if(stage&&typeof MutationObserver!=='undefined'){
      var tt=null;
      var isEdit=function(m){
        if(m.type==='characterData') return true;
        var t=m.target;
        // 종이·레이어를 통째로 올리고 내리는 가상화 움직임은 편집이 아니다
        if(t&&t.nodeType===1){
          if(t.id==='pagesStage') return false;
          if(t.classList&&(t.classList.contains('page-wrap')||t.classList.contains('paper')
             ||t.classList.contains('layer'))) return false;
          try{ if(t.closest&&t.closest('.tb')) return true; }catch(e){}
        }
        return false;
      };
      new MutationObserver(function(muts){
        var edited=false;
        for(var i=0;i<muts.length;i++){ if(isEdit(muts[i])){ edited=true; break; } }
        if(!edited) return;                    // 스크롤로 종이만 오르내린 경우 — 무시
        if(tt) clearTimeout(tt);
        tt=setTimeout(function(){ scheduleWarm(1200); },1200);
      }).observe(stage,{childList:true,subtree:true,characterData:true});
    }
  }
  window.sdyAiBoot=boot;
  // DOM 이 이미 있으면 바로, 아니면 load 에 맞춰 한 번만.
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot);
  else boot();
})();
