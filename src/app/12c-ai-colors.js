/* === src/app/12c-ai-colors.js ===
   해돌이 색이름·팔레트 매핑
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:12c-ai-colors.js:BEGIN */
    // ── 14.25.0 · 똑똑한 해돌이 도우미 ──────────────────────────────────
    // 색이름 → 실제 팔레트. 화면의 글자색·형광펜·펜 목록(CLASSIC_*_COLORS)과
    // 같은 값이라, AI가 고른 색이 도구막대 색과 어긋나지 않는다.
    const AI_TEXT_COLOR_NAMES={검정:'#000000',검은색:'#000000',까망:'#000000',
        빨강:'#e74c3c',빨간색:'#e74c3c',주황:'#e67e22',주황색:'#e67e22',갈색:'#e67e22',
        노랑:'#f1c40f',노란색:'#f1c40f',초록:'#2ecc71',초록색:'#2ecc71',녹색:'#2ecc71',
        청록:'#1abc9c',파랑:'#3498db',파란색:'#3498db',남색:'#3498db',하늘:'#3498db',
        보라:'#9b59b6',보라색:'#9b59b6',분홍:'#e84393',분홍색:'#e84393',핑크:'#e84393',
        회색:'#7f8c8d',회색빛:'#7f8c8d',흰색:'#ffffff',하양:'#ffffff',하얀색:'#ffffff'};
    const AI_HL_COLOR_NAMES={노랑:'#ffff00',노란색:'#ffff00',연두:'#a8ff60',연두색:'#a8ff60',
        하늘:'#7bfdff',하늘색:'#7bfdff',파랑:'#9cc9ff',파란색:'#9cc9ff',
        보라:'#ff9cf5',보라색:'#ff9cf5',분홍:'#ffb3c1',분홍색:'#ffb3c1',핑크:'#ffb3c1',
        빨강:'#ffb3c1',빨간색:'#ffb3c1',주황:'#ffc98b',주황색:'#ffc98b',
        초록:'#b6ff8c',초록색:'#b6ff8c',회색:'#dfe4ea',황금:'#ffd700',금색:'#ffd700'};
    const AI_CLEAR_WORDS={없음:1,지우기:1,지워:1,투명:1,none:1,clear:1,off:1};
    function aiEditColor(value,hl){
        let v=String(value==null?'':value).trim().toLowerCase();
        if(!v) return null;
        if(AI_CLEAR_WORDS[v]) return '';
        if(/^#[0-9a-f]{3}$/.test(v))
            return '#'+v.slice(1).split('').map(ch=>ch+ch).join('');
        if(/^#[0-9a-f]{6}$/.test(v)) return v;
        const map=hl?AI_HL_COLOR_NAMES:AI_TEXT_COLOR_NAMES;
        v=String(value==null?'':value).trim().replace(/색$/,'');
        if(AI_CLEAR_WORDS[v.toLowerCase()]) return '';
        if(hl&&map[v]) return map[v];
        if(!hl&&map[v]) return map[v];
        // 형광펜에 글자색 이름을 적었으면 글자색 팔레트에서도 찾아본다(관대하게).
        if(hl&&AI_TEXT_COLOR_NAMES[v]) return AI_TEXT_COLOR_NAMES[v];
        return null;
    }
    // 글꼴 id·라벨 모두 받는다 ("개구쟁이체"처럼 체가 붙어도 된다).
    function aiEditFont(value){
        const v=String(value==null?'':value).trim().toLowerCase();
        if(!v) return null;
        let hit=FONTS.find(f=>f.id.toLowerCase()===v);
        if(hit) return hit.id;
        const bare=v.replace(/체$/,'');
        hit=FONTS.find(f=>f.label.toLowerCase()===v||f.label.toLowerCase()===bare
            ||f.label.replace(/체$/,'').toLowerCase()===bare);
        return hit?hit.id:null;
    }
    const AI_ON_WORDS={on:1,true:1,1:1,켜:1,켜기:1,적용:1,yes:1};
    const AI_OFF_WORDS={off:1,false:1,0:1,꺼:1,끄기:1,해제:1,없음:1,no:1};
    function aiEditBool(value){
        const v=String(value==null?'':value).trim().toLowerCase();
        if(AI_ON_WORDS[v]) return true;
        if(AI_OFF_WORDS[v]) return false;
        return null;
    }
    // @st 서식 문자열("font=gaegu, fs=20, bold=on") → 검증된 변경 목록.
    // 모르는 속성은 버리고(rule: 조용히 버리되 전부 못 알아들으면 실패),
    // 값 검증을 통과한 것만 돌려준다.
    function aiEditStyleOps(style){
        const out=[];
        String(style==null?'':style).split(/[,;]/).forEach(piece=>{
            const m=/^\s*([^=:]+?)\s*[=：:]\s*(.+?)\s*$/.exec(piece);
            if(!m) return;
            let key=String(m[1]).trim().toLowerCase(), val=String(m[2]).trim();
            if(!key||!val) return;
            key=key.replace(/\s+/g,'');
            if(key==='font'||key==='글꼴'){
                const id=aiEditFont(val);
                if(id) out.push({k:'font',v:id});
            }else if(key==='fs'||key==='size'||key==='fontsize'||key==='크기'
                     ||key==='글자크기'||key==='글씨크기'){
                const n=Number(String(val).replace(/px$/i,''));
                if(Number.isFinite(n)) out.push({k:'fs',v:Math.max(2,Math.min(200,Math.round(n)))});
            }else if(key==='fg'||key==='color'||key==='textcolor'||key==='색'
                     ||key==='글자색'||key==='글씨색'){
                const c=aiEditColor(val,false);
                if(c!=null) out.push({k:'fg',v:c});
            }else if(key==='hl'||key==='bg'||key==='background'||key==='backgroundcolor'
                     ||key==='형광펜'||key==='형광'||key==='배경'||key==='배경색'){
                const c=aiEditColor(val,true);
                if(c!=null) out.push({k:'hl',v:c});
            }else if(key==='bold'||key==='굵게'||key==='굵기'){
                const b=aiEditBool(val);
                if(b!=null) out.push({k:'bold',v:b});
            }else if(key==='italic'||key==='기울임'||key==='기울기'){
                const b=aiEditBool(val);
                if(b!=null) out.push({k:'italic',v:b});
            }else if(key==='underline'||key==='밑줄'){
                const b=aiEditBool(val);
                if(b!=null) out.push({k:'underline',v:b});
            }else if(key==='strike'||key==='strikethrough'||key==='취소선'){
                const b=aiEditBool(val);
                if(b!=null) out.push({k:'strike',v:b});
            }else if(key==='align'||key==='정렬'){
                const a=val.toLowerCase();
                if(a==='left'||a==='왼쪽') out.push({k:'align',v:'left'});
                else if(a==='center'||a==='middle'||a==='가운데'||a==='중앙') out.push({k:'align',v:'center'});
                else if(a==='right'||a==='오른쪽') out.push({k:'align',v:'right'});
            }else if(key==='pencolor'||key==='펜색'||key==='펜'){
                const c=aiEditColor(val,false);
                if(c) out.push({k:'pencolor',v:c});
            }else if(key==='pensize'||key==='굵기px'){
                const n=Number(val);
                if(Number.isFinite(n)) out.push({k:'pensize',v:Math.max(0.5,Math.min(30,n))});
            }
        });
        return out;
    }
    function aiEditDecodeEntities(s){
        try{
            const ta=document.createElement('textarea');
            ta.innerHTML=String(s==null?'':s);
            return ta.value;
        }catch(e){ return String(s==null?'':s); }
    }
    // 서식을 살린 부분 바꾸기(@rp). html을 태그·글·줄바꿈 토큰으로 나눈 뒤
    // 글 토큰 위에서 찾을 글을 찾아 바꾼다 — 굵기·색 span은 그대로 남는다.
    // 찾을 글이 span 경계를 가로질러도(앞 토큰 끝+뒤 토큰 앞) 이어서 찾는다.
    function aiEditReplaceHtml(html,find,repl){
        const src=String(html==null?'':html);
        const needle=String(find==null?'':find);
        const rep=String(repl==null?'':repl);
        if(!needle) return {html:src,count:0};
        const raws=src.split(/(<[^>]*>)/g);
        const toks=[];
        raws.forEach(part=>{
            if(!part) return;
            if(part.charAt(0)==='<'){
                if(/^<br\s*\/?>$/i.test(part)) toks.push({t:'br'});
                else toks.push({t:'tag',s:part});
            }else{
                toks.push({t:'txt',s:aiEditDecodeEntities(part)});
            }
        });
        let joined='';
        const pos=[];
        toks.forEach((tk,i)=>{
            if(tk.t==='txt'){
                for(let k=0;k<tk.s.length;k++){ pos.push({i,o:k}); }
                joined+=tk.s;
            }else if(tk.t==='br'){ pos.push({i,o:-1}); joined+='\n'; }
        });
        const spans=[];
        let from=0;
        for(;;){
            const at=joined.indexOf(needle,from);
            if(at<0||spans.length>=50) break;
            spans.push([at,at+needle.length]);
            from=at+Math.max(1,needle.length);
        }
        if(!spans.length) return {html:src,count:0};
        // 뒤에서부터 고쳐 앞쪽 오프셋이 밀리지 않게 한다.
        for(let s=spans.length-1;s>=0;s--){
            const a=spans[s][0],b=spans[s][1];
            const pA=pos[a],pB=b<pos.length?pos[b]:null;
            const endTok=pB?pB.i:toks.length, endOff=pB?(pB.o<0?0:pB.o):0;
            const stTok=pA.i, stOff=pA.o<0?0:pA.o;
            for(let i=stTok+1;i<endTok;i++){
                if(toks[i].t==='txt') toks[i].s='';
                else if(toks[i].t==='br') toks[i].dead=true;
            }
            if(pA.o<0){
                // 줄바꿈부터 시작 — <br>을 지우고 그 앞에 바꾼 글을 넣는다.
                toks[stTok].dead=true;
                toks.splice(stTok,0,{t:'txt',s:rep});
                if(endTok<toks.length-1&&toks[endTok+1]&&toks[endTok+1].t==='txt')
                    toks[endTok+1].s=toks[endTok+1].s.slice(endOff);
            }else if(stTok===endTok){
                toks[stTok].s=toks[stTok].s.slice(0,stOff)+rep+toks[stTok].s.slice(stOff+(b-a));
            }else{
                toks[stTok].s=toks[stTok].s.slice(0,stOff)+rep;
                if(endTok<toks.length&&toks[endTok]&&toks[endTok].t==='txt')
                    toks[endTok].s=toks[endTok].s.slice(endOff);
            }
        }
        let out='';
        toks.forEach(tk=>{
            if(tk.dead) return;
            if(tk.t==='tag') out+=tk.s;
            else if(tk.t==='br') out+='<br>';
            else if(tk.t==='txt') out+=esc(tk.s).replace(/\n/g,'<br>');
        });
        return {html:out,count:spans.length};
    }

/* APP-PART:12c-ai-colors.js:END */
