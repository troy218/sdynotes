/* === src/app/12d-ai-hl-layout.js ===
   해돌이 형광펜 부분강조
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:12d-ai-hl-layout.js:BEGIN */
    // ── 14.27.0 · 형광펜(부분 강조) ──────────────────────────────────────
    // 해돌이가 형광펜을 못 알아듣던 이유는 '상자 전체 배경(el.cellBg)'밖에
    // 못 건드렸기 때문이다. 이제 저장 포맷과 같은 글자 span(background-color)으로
    // 글귀 단위로 칠하고, 스냅샷에도 칠해진 곳을 ⟦…⟧ 로 보여 준다.
    const AI_HL_MARK=['\u27e6','\u27e7'];               // ⟦ ⟧ — 스냅샷의 형광펜 표시
    const AI_HL_DEFAULT='#ffff00';                     // 색을 안 적으면 노랑 형광펜
    const AI_HL_BG_RE=/background(?:-color)?\s*:\s*[^;"']+\s*;?/gi;
    const AI_VOID_TAGS={br:1,hr:1,img:1,input:1,meta:1,link:1,area:1,base:1,col:1,
        embed:1,source:1,track:1,wbr:1};
    // span·font 같은 글자 꾸밈 태그에 형광펜(배경색)이 들어 있는가.
    function aiEditTagBg(tagStr){
        const s=String(tagStr||'');
        const m=/background(?:-color)?\s*:\s*([^;"']+)/i.exec(s);
        if(m){
            // rgb(…)·이름으로 적혀 있어도 알아본다(가져온 문서에 그런 경우가 있다).
            let raw=String(m[1]).trim();
            try{
                if(typeof _colorToHex==='function'){
                    const hx=_colorToHex(raw);
                    if(hx&&hx!=='transparent') raw=hx;
                }
            }catch(e){}
            const c=aiEditColor(raw,true);
            if(c) return c;
        }
        const d=/data-(?:highlight|background-color)\s*=\s*"([^"]+)"/i.exec(s);
        if(d){
            const c2=aiEditColor(d[1],true);
            if(c2) return c2;
        }
        return '';
    }
    // 태그 문자열에서 배경색만 걷어낸다(다른 서식은 그대로).
    function aiEditStripBg(tagStr){
        return String(tagStr||'')
            .replace(/(<[a-zA-Z][^>]*?\sstyle\s*=\s*")([^"]*)(")/gi,(all,pre,css,post)=>{
                const next=css.replace(AI_HL_BG_RE,'').replace(/;;+/g,';')
                    .replace(/^\s*;|;\s*$/g,'').trim();
                return pre+next+post;
            })
            .replace(/\sdata-(?:highlight|background-color)\s*=\s*"[^"]*"/gi,'');
    }
    // 스냅샷 미리보기 — 칠해진 글귀를 ⟦…⟧ 로 감싸 모델에게 보여 준다.
    function aiEditHlPreview(html){
        const parts=String(html==null?'':html).split(/(<[^>]*>)/g);
        const stack=[]; let out='',open=false;
        parts.forEach(part=>{
            if(!part) return;
            if(part.charAt(0)==='<'){
                if(/^<br\s*\/?>$/i.test(part)){ if(open){ out+=AI_HL_MARK[1]; open=false; } out+='\n'; return; }
                const m=/^<\s*(\/?)\s*([a-zA-Z][0-9]*)([^>]*?)(\/?)\s*>$/.exec(part);
                if(!m) return;
                const tag=m[2].toLowerCase();
                if(m[1]){
                    for(let k=stack.length-1;k>=0;k--){
                        if(stack[k].tag===tag){ stack.length=k; break; }
                    }
                    return;
                }
                if(m[4]||AI_VOID_TAGS[tag]) return;
                stack.push({tag:tag,bg:tag==='mark'||!!aiEditTagBg(part)});
                return;
            }
            let bg=false;
            for(const s of stack){ if(s.bg){ bg=true; break; } }
            const txt=aiEditDecodeEntities(part).replace(/\s+/g,' ');
            if(!txt) return;
            if(bg&&!open){ out+=AI_HL_MARK[0]; open=true; }
            else if(!bg&&open){ out+=AI_HL_MARK[1]; open=false; }
            out+=txt.replace(/</g,'‹').replace(/>/g,'›');
        });
        if(open) out+=AI_HL_MARK[1];
        return out.replace(/\s+/g,' ').trim();
    }
    // 모델이 스냅샷의 ⟦⟧ 표시를 그대로 베껴 와도 찾을 수 있게 털어 낸다.
    function aiEditLooseFind(value){
        const mark=new RegExp('['+AI_HL_MARK[0]+AI_HL_MARK[1]+']','g');
        return String(value==null?'':value).replace(mark,'').replace(/\s+/g,' ').trim();
    }
    // 글귀에 형광펜 span을 씌운다. 기존 굵기·색 span과 어긋나게 중첩되지 않도록
    // 글 토큰 단위로 감싼다(태그를 반쯤 걸친 span을 만들지 않는다).
    function aiEditMarkHtml(html,find,color){
        const src=String(html==null?'':html);
        const needle=String(find==null?'':find);
        if(!needle) return {html:src,count:0};
        const toks=[];
        src.split(/(<[^>]*>)/g).forEach(part=>{
            if(!part) return;
            if(part.charAt(0)==='<'){
                if(/^<br\s*\/?>$/i.test(part)) toks.push({t:'br'});
                else toks.push({t:'tag',s:part});
            }else toks.push({t:'txt',s:aiEditDecodeEntities(part)});
        });
        let joined=''; const pos=[];
        toks.forEach((tk,i)=>{
            if(tk.t==='txt'){ for(let k=0;k<tk.s.length;k++) pos.push({i:i,o:k}); joined+=tk.s; }
            else if(tk.t==='br'){ pos.push({i:i,o:-1}); joined+='\n'; }
        });
        const spans=[]; let from=0;
        for(;;){
            const at=joined.indexOf(needle,from);
            if(at<0||spans.length>=50) break;
            spans.push([at,at+needle.length]);
            from=at+Math.max(1,needle.length);
        }
        if(!spans.length) return {html:src,count:0};
        const open='<span style="background-color:'+color+'">';
        for(let s=spans.length-1;s>=0;s--){
            const a=spans[s][0],b=spans[s][1];
            const hit=[];
            for(let k=a;k<b;k++){
                const p=pos[k];
                if(!p||p.o<0) continue;                 // 줄바꿈은 건너뛴다(줄별로 칠한다)
                if(!hit.length||hit[hit.length-1].i!==p.i) hit.push({i:p.i,from:p.o,to:p.o});
                else hit[hit.length-1].to=p.o;
            }
            for(let k=hit.length-1;k>=0;k--){
                const i=hit[k].i,tk=toks[i];
                if(!tk||tk.t!=='txt') continue;
                const mid=tk.s.slice(hit[k].from,hit[k].to+1);
                if(!mid) continue;
                const before=tk.s.slice(0,hit[k].from),after=tk.s.slice(hit[k].to+1);
                const parts=[];
                if(before) parts.push({t:'txt',s:before});
                parts.push({t:'raw',s:open},{t:'txt',s:mid},{t:'raw',s:'</span>'});
                if(after) parts.push({t:'txt',s:after});
                toks.splice.apply(toks,[i,1].concat(parts));
            }
        }
        let out='';
        toks.forEach(tk=>{
            if(tk.t==='tag'||tk.t==='raw') out+=tk.s;
            else if(tk.t==='br') out+='<br>';
            else if(tk.t==='txt') out+=esc(tk.s).replace(/\n/g,'<br>');
        });
        return {html:out,count:spans.length};
    }
    // 형광펜을 지운 자리에 남는 빈 꾸밈 span은 털어 낸다(문서가 지저분해지지 않게).
    function aiEditDropEmptyTags(html){
        let out=String(html==null?'':html),prev='';
        for(let i=0;i<3&&out!==prev;i++){
            prev=out;
            out=out.replace(/<(span|b|strong|i|em|u|font)\b[^>]*>\s*<\/\1>/gi,'');
            // 배경만 있던 span은 빈 style="" 이 남는다 — 속성을 지우고,
            // 속성 없는 span 은 알맹이만 남긴다(안에 태그가 있으면 건드리지 않는다).
            out=out.replace(/(<[a-zA-Z][a-zA-Z0-9]*)\s+style=""(?=[\s>])/g,'$1');
            out=out.replace(/<span>((?:(?!<)[\s\S])*)<\/span>/gi,'$1');
        }
        return out;
    }
    // 형광펜 지우기 — 찾을 글이 있으면 그 글귀만, 없으면 상자 전체.
    // 글귀 지우기는 그 글귀를 감싸고 있던 span을 경계에서 끊고 다시 이어 붙인다:
    //   <span S>AB CD</span> 에서 AB만 지우면 <span S></span><span S′>AB</span><span S> CD</span>
    //   (S′=S에서 배경색만 뺀 것) → 나머지 글의 형광펜·서식은 그대로 남는다.
    function aiEditUnmarkHtml(html,find){
        const src=String(html==null?'':html);
        const needle=String(find==null?'':find);
        const toks=[];
        src.split(/(<[^>]*>)/g).forEach(part=>{
            if(!part) return;
            if(part.charAt(0)==='<'){
                if(/^<br\s*\/?>$/i.test(part)) toks.push({t:'br'});
                else toks.push({t:'tag',s:part});
            }else toks.push({t:'txt',s:aiEditDecodeEntities(part)});
        });
        let touched=0;
        if(!needle){
            toks.forEach(tk=>{
                if(tk.t!=='tag') return;
                const next=aiEditStripBg(tk.s);
                if(next!==tk.s){ tk.s=next; touched++; }
            });
        }else{
            let joined=''; const pos=[];
            toks.forEach((tk,i)=>{
                if(tk.t==='txt'){ for(let k=0;k<tk.s.length;k++) pos.push({i:i,o:k}); joined+=tk.s; }
                else if(tk.t==='br'){ pos.push({i:i,o:-1}); joined+='\n'; }
            });
            const spans=[]; let from=0;
            for(;;){
                const at=joined.indexOf(needle,from);
                if(at<0||spans.length>=50) break;
                spans.push([at,at+needle.length]);
                from=at+Math.max(1,needle.length);
            }
            if(!spans.length) return {html:src,count:0};
            for(let s=spans.length-1;s>=0;s--){
                const a=spans[s][0],b=spans[s][1];
                const pA=pos[a]; if(!pA) continue;
                const pB=b<pos.length?pos[b]:null;
                const stTok=pA.i, endTok=pB?pB.i:toks.length;
                // ① 이 범위를 감싸고 있는 span(형광펜이 있는 것만)
                const stack=[],wrap=[];
                for(let i=0;i<stTok;i++){
                    const tk=toks[i];
                    if(tk.t!=='tag') continue;
                    const m=/^<\s*(\/?)\s*([a-zA-Z][0-9]*)([^>]*?)(\/?)\s*>$/.exec(tk.s);
                    if(!m) continue;
                    const tag=m[2].toLowerCase();
                    if(m[1]){
                        for(let k=stack.length-1;k>=0;k--){
                            if(stack[k].tag===tag){ stack.length=k; break; }
                        }
                    }else if(!m[4]&&!AI_VOID_TAGS[tag]) stack.push({tag:tag,i:i,s:tk.s});
                }
                stack.forEach(o=>{ if(aiEditTagBg(o.s)) wrap.push(o); });
                // ② 범위 안에 들어 있는 태그의 배경색도 지운다
                let inside=0;
                for(let i=stTok;i<endTok&&i<toks.length;i++){
                    if(toks[i].t!=='tag') continue;
                    const next=aiEditStripBg(toks[i].s);
                    if(next!==toks[i].s){ toks[i].s=next; inside++; }
                }
                if(!wrap.length&&!inside) continue;      // 이 글귀엔 칠해진 곳이 없다
                const closeAll=wrap.map(function(){ return '<'+'/span>'; }).join('');
                const reopen=arr=>arr.map(o=>o.s).join('');
                const plain=wrap.map(o=>({s:aiEditStripBg(o.s)}));
                // 찾은 글귀는 '배경 없는 span'으로, 그 앞뒤는 원래 배경으로 이어 붙인다.
                const head=closeAll+reopen(plain);
                const tail=closeAll+reopen(wrap);
                // ③ 글 토큰을 잘라 경계를 넣는다(뒤에서부터 — 앞쪽 색인은 그대로)
                const hit=[];
                for(let k=a;k<b;k++){
                    const p=pos[k];
                    if(!p||p.o<0) continue;
                    if(!hit.length||hit[hit.length-1].i!==p.i) hit.push({i:p.i,from:p.o,to:p.o});
                    else hit[hit.length-1].to=p.o;
                }
                for(let k=hit.length-1;k>=0;k--){
                    const i=hit[k].i,tk=toks[i];
                    if(!tk||tk.t!=='txt') continue;
                    const mid=tk.s.slice(hit[k].from,hit[k].to+1);
                    if(!mid) continue;
                    const before=tk.s.slice(0,hit[k].from),after=tk.s.slice(hit[k].to+1);
                    const parts=[];
                    if(before) parts.push({t:'txt',s:before});
                    parts.push({t:'raw',s:head},{t:'txt',s:mid},{t:'raw',s:tail});
                    if(after) parts.push({t:'txt',s:after});
                    toks.splice.apply(toks,[i,1].concat(parts));
                }
                touched+=hit.length+inside;
            }
        }
        if(!touched) return {html:src,count:0};
        let out='';
        toks.forEach(tk=>{
            if(tk.t==='tag'||tk.t==='raw') out+=tk.s;
            else if(tk.t==='br') out+='<br>';
            else if(tk.t==='txt') out+=esc(tk.s).replace(/\n/g,'<br>');
        });
        return {html:aiEditDropEmptyTags(out),count:touched};
    }

/* APP-PART:12d-ai-hl-layout.js:END */
