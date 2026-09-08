/* === src/app/11b-inline-fmt.js ===
   인라인 서식 엔진 (오프셋·토큰·실행기)
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:11b-inline-fmt.js:BEGIN */
    // ── ① 문자 오프셋 지도 ─────────────────────────────────────────
    //   host 안 모든 텍스트 노드를 문서 순으로 [start,end) 절대 오프셋과 함께.
    function _fmtTextMap(host){
        const map=[]; let off=0;
        try{
            const tw=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);
            let n;
            while(n=tw.nextNode()){
                const len=String(n.nodeValue||'').length;
                if(len>0){ map.push({node:n,start:off,end:off+len}); off+=len; }
            }
        }catch(e){}
        map.total=off;
        return map;
    }
    function _fmtTextLen(host){ return _fmtTextMap(host).total; }
    // '어떤 지점(컨테이너,오프셋)' → host 기준 문자 오프셋.
    //   지점~host 끝까지의 텍스트 길이를 재서 total 에서 빼는 방식이라
    //   요소 경계/텍스트 중간 어디서 시작해도 정확하다.
    function _fmtOffsetAt(host,container,offset){
        try{
            const total=_fmtTextLen(host);
            const r=document.createRange();
            r.setStart(container,offset);
            r.setEnd(host,host.childNodes.length);
            const tail=String(r.toString()).length;
            return Math.max(0,total-tail);
        }catch(e){ return 0; }
    }
    function _fmtOffsets(host,range){
        const start=_fmtOffsetAt(host,range.startContainer,range.startOffset);
        let end=_fmtOffsetAt(host,range.endContainer,range.endOffset);
        if(end<start) end=start;
        return {start,end};
    }
    // 문자 오프셋 → (노드,노드오프셋). 경계에서는 '다음 글자의 시작'을 택해
    // 뒤이어 입력할 글자가 앞 서식 span 안으로 들어가지 않게 한다.
    function _fmtPointFromOffset(host,offset){
        const map=_fmtTextMap(host);
        for(const t of map){
            if(offset<t.end) return {node:t.node,offset:offset-t.start};
        }
        const last=map[map.length-1];
        if(last) return {node:last.node,offset:last.node.nodeValue.length};
        return {node:host,offset:host.childNodes.length};
    }
    function _fmtRestoreSelection(host,start,end){
        try{
            const a=_fmtPointFromOffset(host,start), b=_fmtPointFromOffset(host,end);
            const nr=document.createRange();
            nr.setStart(a.node,a.offset);
            nr.setEnd(b.node,b.offset);
            const s=window.getSelection();
            s.removeAllRanges(); s.addRange(nr);
            savedRange=nr.cloneRange(); savedHost=host;
        }catch(e){}
    }

    // ── ② 리프 블록(문단) 찾기 ─────────────────────────────────────
    //   텍스트 노드가 속한 '가장 안쪽 블록'. 블록이 없으면 host 자체(암시 영역).
    function _fmtLeafBlock(node,host){
        let p=(node.nodeType===3)?node.parentElement:node;
        while(p&&p!==host){
            if(FMT_BLOCK_TAGS.has(p.tagName)||_isPosSpan(p)) return p;
            p=p.parentElement;
        }
        return host;
    }
    // [start,end) 와 글자가 겹치는 리프 블록들을 문서 순으로 그룹핑.
    //   host 암시 영역은 블록 요소 사이의 '연속 구간'마다 별개 그룹이 된다.
    function _fmtGroups(host,map,start,end){
        const groups=[];
        for(const t of map){
            if(t.end<=start||t.start>=end) continue;
            const blk=_fmtLeafBlock(t.node,host);
            const g=groups[groups.length-1];
            if(g&&g.el===blk) g.last=t.node;
            else groups.push({el:blk,first:t.node,last:t.node});
        }
        return groups;
    }

    // ── ③ 문단 토큰화 ──────────────────────────────────────────────
    //   block 하위를 문서 순으로 walk 해 토큰 스트림을 만든다.
    //   block===host 이면 다른 블록 요소 안으로는 내려가지 않는다(암시 영역만).
    function _fmtTokens(block,host){
        const tokens=[];
        (function walk(el,link){
            for(let k=el.firstChild;k;k=k.nextSibling){
                if(k.nodeType===3){ tokens.push({t:'text',node:k,link:link||null}); continue; }
                if(k.nodeType!==1) continue;
                const tag=k.tagName;
                if(block===host&&(FMT_BLOCK_TAGS.has(tag)||_isPosSpan(k))) continue;
                if(tag==='BR'){ tokens.push({t:'br',node:k}); continue; }
                if(FMT_ATOMIC_TAGS.has(tag)){ tokens.push({t:'atom',node:k,link:link||null}); continue; }
                // 아직 입력 전인 타이핑 span(빈칸 또는 닻 ZWSP 1글자)은 원자 토큰으로
                // 통째로 옮긴다 — 안을 토큰화하면 닻이 '진짜 글자'로 취급된다.
                if(tag==='SPAN'&&k.classList&&k.classList.contains('sdy-type')&&_isTypeMarkOnly(k)){
                    tokens.push({t:'type',node:k}); continue;
                }
                const hasInner=!!(String(k.textContent||'').length
                    ||(k.querySelector&&k.querySelector('img,br,svg,canvas,video,audio,iframe,hr')));
                if(!hasInner){
                    // 빈 span. 입력 대기 마커(.sdy-type)만 원자 토큰으로 살려 둔다.
                    if(k.classList&&k.classList.contains('sdy-type')) tokens.push({t:'type',node:k});
                    continue;
                }
                walk(k, tag==='A'?k:(link||null));
            }
        })(block,null);
        return tokens;
    }

    // ── ④ 세그먼트 편집 + 정규형 렌더 ──────────────────────────────
    function _fmtStyleKey(style){
        const keys=Object.keys(style||{}).filter(k=>String(style[k]||'').trim()!=='');
        keys.sort();
        return keys.map(k=>k+'='+_normComparable(k,style[k])).join('|');
    }
    function _fmtLinkKey(l){
        if(!l) return '';
        return l.el
            ? 'E|'+(l.el.getAttribute('href')||'')+'|'+(l.el.getAttribute('target')||'')
            : 'N|'+(l.href||'')+'|'+(l.target||'');
    }
    function _fmtLinkClone(l){
        let a;
        if(l&&l.el&&l.el.cloneNode) a=l.el.cloneNode(false);
        else{
            a=document.createElement('a');
            a.setAttribute('href',(l&&l.href)||'#');
            a.setAttribute('target',(l&&l.target)||'_blank');
            a.setAttribute('rel',(l&&l.rel)||'noopener');
        }
        return a;
    }
    // 토큰(이미 편집 완료된 세그먼트) → DOM. 같은 스타일+같은 링크의 이웃
    // 세그먼트는 하나의 text node(+span)로 합쳐 span 이 누적되지 않는다.
    function _fmtRender(tokens){
        const frag=document.createDocumentFragment();
        const flush=grp=>{
            if(!grp) return;
            let parent=frag;
            if(grp.link){ const a=_fmtLinkClone(grp.link); frag.appendChild(a); parent=a; }
            const style=grp.style||{};
            const cssKeys=Object.keys(style).filter(k=>String(style[k]||'').trim()!=='');
            const tn=document.createTextNode(grp.texts.join(''));
            if(cssKeys.length){
                const sp=document.createElement('span');
                // CSSOM 으로 적는다 — setAttribute 문자열 대신 쓰면 브라우저·jsdom 이
                // 같은 방식으로 값을 정규화·직렬화한다(#fff59d → rgb(255,245,157) 등).
                for(const k of cssKeys){
                    try{ sp.style.setProperty(_kebabProp(k),String(style[k]).trim()); }catch(_e){}
                }
                sp.appendChild(tn);
                parent.appendChild(sp);
            }else parent.appendChild(tn);
        };
        let grp=null;
        for(const tk of tokens){
            if(tk.t==='text'){
                const key=_fmtStyleKey(tk.style)+'\u0000'+_fmtLinkKey(tk.link);
                if(grp&&grp.key===key){ grp.texts.push(tk.text); continue; }
                flush(grp);
                grp={key,style:tk.style,link:tk.link,texts:[tk.text]};
            }else{
                flush(grp); grp=null;
                const n=tk.node;
                if(tk.link){ const a=_fmtLinkClone(tk.link); a.appendChild(n); frag.appendChild(a); }
                else frag.appendChild(n);
            }
        }
        flush(grp);
        return frag;
    }

    // 문단 하나를 다시 그린다. op 는 {type:'set'|'remove'|'clear'|'link'|'unlink', ...}
    function _fmtRebuildBlock(host,g,map,start,end,op){
        const block=g.el;
        const isHost=(block===host);
        let tokens=_fmtTokens(block,host);
        const byNode=new Map();
        for(const t of map) byNode.set(t.node,t);
        for(const tk of tokens){
            if(tk.t!=='text') continue;
            const m=byNode.get(tk.node);
            tk.start=m?m.start:0;
            tk.end=tk.start+String(tk.node.nodeValue||'').length;
            tk.style=_fmtChainStyle(tk.node,block);   // 상자(블록) 레벨 스타일은 재선언하지 않는다
        }
        let kids=null,i0=0,i1=-1;
        if(isHost){
            // 암시 영역: 이 그룹이 속한 '연속된 비블록 구간(암시 문단)' 전체를
            //   다시 그린다. 선택된 글자의 직계 범위만 바꾸면 문단 나머지 글자가
            //   밖에 고립돼 이웃 세그먼트와 합쳐지지 않은 채 남는다.
            kids=Array.from(host.childNodes);
            const topIdx=n=>{
                let p=n;
                while(p&&p.parentNode!==host) p=p.parentNode;
                return kids.indexOf(p);
            };
            const isBlk=n=>n.nodeType===1&&(FMT_BLOCK_TAGS.has(n.tagName)||_isPosSpan(n));
            i0=topIdx(g.first); i1=topIdx(g.last);
            if(i0<0||i1<0||i1<i0) return false;
            while(i0>0&&!isBlk(kids[i0-1])) i0--;
            while(i1<kids.length-1&&!isBlk(kids[i1+1])) i1++;
            tokens=tokens.filter(tk=>{ const i=topIdx(tk.node); return i>=i0&&i<=i1; });
        }
        // 세그먼트 분할 + 연산 적용
        const out=[];
        for(const tk of tokens){
            if(tk.t!=='text'){ out.push(tk); continue; }
            const s=tk.start,e=tk.end,v=String(tk.node.nodeValue||'');
            if(e<=s||!v) continue;
            if(e<=start||s>=end){
                out.push({t:'text',text:v,style:tk.style,link:tk.link});
                continue;
            }
            const a=Math.max(s,start), b=Math.min(e,end);
            if(a>s) out.push({t:'text',text:v.slice(0,a-s),style:tk.style,link:tk.link});
            const st=Object.assign({},tk.style);
            let lk=tk.link;
            if(op.type==='set'||op.type==='setbox'){
                const had=Object.prototype.hasOwnProperty.call(st,op.prop);
                if(op.prop==='textDecoration'){
                    // 밑줄+취소선처럼 여러 토큰이 한 세그먼트에 공존한다 (토큰 병합)
                    const toks=new Set(String(st.textDecoration||'').split(/\s+/).filter(t=>t&&t!=='none'));
                    String(op.value||'').split(/\s+/).filter(t=>t&&t!=='none').forEach(t=>toks.add(t));
                    st.textDecoration=[...toks].join(' ');
                }else{
                    st[op.prop]=op.value;
                }
                if(op.type==='setbox'&&!had){
                    // setbox(상자 전체 값 교체)는 인라인 오버라이드가 없던 글자를
                    // 새로 만들지 않는다 — 상자 값 상속을 유지하기 위함.
                    delete st[op.prop];
                }
            }
            else if(op.type==='remove'){
                if(op.prop==='textDecoration'&&op.value){
                    const toks=String(st.textDecoration||'').split(/\s+/).filter(t=>t&&t!==op.value);
                    if(toks.length) st.textDecoration=toks.join(' ');
                    else delete st.textDecoration;
                }
                else if(op.neutral) st[op.prop]=op.neutral;   // 상자 상속을 끊는 명시적 중립값
                else delete st[op.prop];
            }
            else if(op.type==='clear'){ FMT_PROPS.forEach(p=>{ delete st[p]; }); }
            else if(op.type==='unlink') lk=null;
            else if(op.type==='link') lk={href:op.href,target:'_blank',rel:'noopener'};
            out.push({t:'text',text:v.slice(a-s,b-s),style:st,link:lk});
            if(b<e) out.push({t:'text',text:v.slice(b-s),style:tk.style,link:tk.link});
        }
        // 타이핑 마커 span 도 연산을 함께 받는다 (다음 입력 글자의 서식 유지)
        if(op&&op.type!=='unlink'&&op.type!=='link'){
            out.forEach(tk=>{
                if(tk.t!=='type') return;
                if(op.type==='set') _setInlineProp(tk.node,op.prop,op.value);
                else if(op.type==='remove') _clearInlineProp(tk.node,op.prop,op.value);
                else if(op.type==='clear') FMT_PROPS.forEach(p=>_clearInlineProp(tk.node,p,''));
            });
        }
        const frag=_fmtRender(out);
        // 다시 끼우기
        if(isHost){
            const ref=kids[i1+1]||null;
            for(let i=i0;i<=i1;i++){ if(kids[i].parentNode===host) host.removeChild(kids[i]); }
            host.insertBefore(frag,ref);
        }else{
            while(block.firstChild) block.removeChild(block.firstChild);
            block.appendChild(frag);
        }
        return true;
    }

    // ── ⑤ 실행기 ───────────────────────────────────────────────────
    //   범위 연산 (선택 복원 없음 — 상자 전체/맞춤 검사 등에서 사용)
    function _fmtRunRange(host,start,end,op){
        if(!host||end<=start) return false;
        const map=_fmtTextMap(host);
        if(!map.total) return false;
        const groups=_fmtGroups(host,map,start,end);
        if(!groups.length) return false;
        _fmtBusy=true;
        try{
            groups.forEach(g=>_fmtRebuildBlock(host,g,map,start,end,op));
        }finally{ _fmtBusy=false; }
        return true;
    }
    //   현재 선택 구간 연산 + 선택 복원
    function _fmtApply(op){
        const ctx=_selectionCtx();
        if(!ctx) return false;
        const host=ctx.host;
        const o=_fmtOffsets(host,ctx.range);
        if(o.end<=o.start) return false;
        const map=_fmtTextMap(host);
        const groups=_fmtGroups(host,map,o.start,o.end);
        if(!groups.length) return false;
        _fmtBusy=true;
        try{
            groups.forEach(g=>_fmtRebuildBlock(host,g,map,o.start,o.end,op));
            _fmtRestoreSelection(host,o.start,o.end);
        }finally{ _fmtBusy=false; }
        return true;
    }
    //   굵게/기울임 '해제'가 상자 레벨 상속과 충돌할 때만 중립값을 쓴다.
    function _fmtNeutralFor(host,prop){
        if(!host||!host.style) return '';
        if(prop==='fontWeight'&&_fwVal(host.style.fontWeight)>=600) return '400';
        if(prop==='fontStyle'&&String(host.style.fontStyle||'').toLowerCase()==='italic') return 'normal';
        return '';
    }

    // ── ⑥ 선택 구간 공개 API (기존 호출부와 이름 호환) ─────────────
    function _applyToSelection(prop,value){
        return _fmtApply({type:'set',prop,value});
    }
    function _removeFromSelection(prop,value){
        const ctx=_selectionCtx();
        const neutral=ctx?_fmtNeutralFor(ctx.host,prop):'';
        return _fmtApply({type:'remove',prop,value:String(value||''),neutral});
    }
    // 선택 영역이 전부 해당 스타일인가? (토글 off 판정)
    function _selHasAll(prop,value){
        const s=window.getSelection();
        if(!s||s.isCollapsed||!s.rangeCount) return false;
        const r=s.getRangeAt(0);
        const hostEl=r.commonAncestorContainer.nodeType===1?r.commonAncestorContainer:r.commonAncestorContainer.parentElement;
        const host=hostEl&&hostEl.closest&&hostEl.closest('.tb-content');
        if(!host) return false;
        const contacts=_selContacts(r);
        if(!contacts.length) return false;
        for(const c of contacts){
            const {styles}=_inheritedStyles(c.node,host);
            if(!_propMatch(prop,styles[prop]||'',value)) return false;
        }
        return true;
    }
    // 선택 영역이 하나라도 해당 스타일을 갖고 있는가?
    function _selHasAny(prop,value){
        const s=window.getSelection();
        if(!s||s.isCollapsed||!s.rangeCount) return false;
        const r=s.getRangeAt(0);
        const hostEl=r.commonAncestorContainer.nodeType===1?r.commonAncestorContainer:r.commonAncestorContainer.parentElement;
        const host=hostEl&&hostEl.closest&&hostEl.closest('.tb-content');
        if(!host) return false;
        const contacts=_selContacts(r);
        for(const c of contacts){
            const {styles}=_inheritedStyles(c.node,host);
            if(_propMatch(prop,styles[prop]||'',value)) return true;
        }
        return false;
    }
    // 워드프로세서 규칙: 전부 켜져 있으면 끄고, 아니면 (부분이든) 켠다.
    // v2 재구축이라 '일부만 적용된 상태에서 켜기'도 항상 통일된 결과를 낸다.
    function toggleSelStyle(prop,value){
        const all=_selHasAll(prop,value);
        if(all) _removeFromSelection(prop,value);
        else _applyToSelection(prop,value);
        syncCurSel();
    }
    function wrapSelStyle(prop,value){
        try{ _applyToSelection(prop,value); }catch(e){}
        syncCurSel();
    }
    function clearSelStyle(prop){
        try{ _removeFromSelection(prop); }catch(e){}
        syncCurSel();
    }
    function clearSelBg(){
        try{ _removeFromSelection('backgroundColor'); }catch(e){}
        syncCurSel();
    }
    // 선택 영역에서 글자색 제거 (상속으로 되돌리기)
    function clearSelColor(){
        try{ _removeFromSelection('color'); }catch(e){}
        syncCurSel();
    }

    // ── ⑦ 링크 ─────────────────────────────────────────────────────
    //   execCommand(createLink/unlink) 없이 엔진 경로 하나로 처리한다.
    //   링크 중간 일부만 골라 해제해도 그 조각만 벗겨진다.
    function _fmtLinkSelection(href){
        return _fmtApply({type:'link',href:String(href||'')});
    }
    function _unlinkSelection(){
        return _fmtApply({type:'unlink'});
    }

    // ── ⑧ 문단 정렬 ────────────────────────────────────────────────
    //   execCommand(justify*) 대신 대상 블록에 text-align 을 직접 적는다.
    function _fmtAlignRange(host,start,end,dir){
        if(!host) return false;
        const map=_fmtTextMap(host);
        const blocks=new Set();
        for(const t of map){
            if(t.end<=start||t.start>=end) continue;
            blocks.add(_fmtLeafBlock(t.node,host));
        }
        if(!blocks.size) return false;
        blocks.forEach(b=>{
            b.style.textAlign=dir;
            if(b===host){
                // 암시 영역(블록 요소 없이 상자에 바로 든 글)은 상자 정렬로 기록
                const w=b.closest&&b.closest('.tb');
                const el=w?findEl(+w.dataset.pageIdx,w.dataset.id):null;
                if(el) el.align=dir;
            }
        });
        return true;
    }
    function _fmtAlignSelection(dir){
        const ctx=_selectionCtx();
        if(!ctx) return false;
        const o=_fmtOffsets(ctx.host,ctx.range);
        return _fmtAlignRange(ctx.host,o.start,o.end,dir);
    }

    // ── ⑨ 상자 전체 연산 (선택 없이 상자만 골랐을 때) ──────────────
    //   구버전의 _applyOne/_removeOne 루프+걷어내기를 버리고, 엔진의 전체
    //   범위 적용 하나로 통일했다. 부분 서식(span)이 있어도 문단 정규형으로
    //   다시 그려지므로 덮어쓰기/보존이 항상 정확하다.
    function _fmtUnpaintWF(host){
        // 중요어 색칠(.wf)은 저장되지 않는 임시 레이어다. 서식 연산 전에 원문으로
        // 되돌려 색칠 span 이 서식 결과에 섞이지 않게 한다(enterEdit 과 같은 규칙).
        try{
            if(host.querySelector&&host.querySelector('.wf')){
                const w=host.closest&&host.closest('.tb');
                const el=w?findEl(+w.dataset.pageIdx,w.dataset.id):null;
                if(el) host.innerHTML=el.html||'';
            }
        }catch(e){}
    }
    function _fmtApplyBox(c,prop,value,override){
        if(!c) return false;
        _fmtUnpaintWF(c);
        // override=true : 상자 전체 값(글꼴·크기) 변경 — 이미 인라인 오버라이드가
        //   있는 부분만 갱신하고 나머지는 상자 값 상속을 유지한다.
        // override=false : 상자 전체 덧칠(굵게·색 등) — 모든 글자에 값을 심는다.
        const type=override?'setbox':'set';
        return _fmtRunRange(c,0,_fmtTextLen(c),{type,prop,value});
    }
    function _fmtRemoveBox(c,prop,value){
        if(!c) return false;
        _fmtUnpaintWF(c);
        return _fmtRunRange(c,0,_fmtTextLen(c),{type:'remove',prop,value:String(value||''),neutral:''});
    }

    // ── 값 정규화 비교 (툴바 표시·토글 판정이 쓰는 공용 도구) ──────
    function _normFontCSS(v){
        return String(v||'').toLowerCase().replace(/["']/g,'').replace(/\s*,\s*/g,',').replace(/\s+/g,' ').trim();
    }
    function _fontIdFromCSS(css){
        const n=_normFontCSS(css);
        if(!n) return '';
        const f=FONTS.find(x=>_normFontCSS(x.css)===n || n.indexOf(_normFontCSS(x.css).split(',')[0])===0);
        return f?f.id:'';
    }
    function _colorToHex(v){
        v=String(v||'').trim().toLowerCase();
        if(!v||v==='inherit'||v==='initial') return '';
        if(v==='transparent'||v==='rgba(0, 0, 0, 0)'||v==='rgba(0,0,0,0)') return 'transparent';
        if(/^#[0-9a-f]{3}$/i.test(v)) return '#'+v.slice(1).split('').map(ch=>ch+ch).join('').toLowerCase();
        if(/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
        const m=v.match(/^rgba?\(([^)]+)\)$/i);
        if(m){
            const parts=m[1].split(',').map(x=>x.trim());
            if(parts.length>=4 && parseFloat(parts[3])===0) return 'transparent';
            const nums=parts.slice(0,3).map(x=>Math.max(0,Math.min(255,parseInt(x,10)||0)));
            return '#'+nums.map(n=>n.toString(16).padStart(2,'0')).join('');
        }
        return v;
    }
    function _normComparable(prop,v){
        if(prop==='color'||prop==='backgroundColor') return _colorToHex(v);
        if(prop==='fontFamily') return _normFontCSS(v);
        if(prop==='fontSize'){
            const n=parseFloat(v); return isNaN(n)?String(v||'').trim().toLowerCase():String(Math.round(n*100)/100)+'px';
        }
        if(prop==='fontWeight') return _fwVal(v)>=600?'700':String(v||'').trim().toLowerCase();
        if(prop==='textDecoration'){
            return String(v||'').toLowerCase().split(/\s+/).filter(t=>t&&t!=='none').sort().join(' ');
        }
        return String(v||'').trim().toLowerCase();
    }
    // 선택한 모든 글자가 한 속성값을 공유하는가? (툴바에 단일 값으로 표시할지 판정)
    function _selUniformStyle(prop){
        const ctx=_selectionCtx();
        if(!ctx) return {ok:false};
        const contacts=_selContacts(ctx.range);
        if(!contacts.length) return {ok:false};
        let firstNorm=null, firstVal='', any=false;
        for(const c of contacts){
            const seg=String(c.node.nodeValue||'').slice(c.s,c.e);
            if(!seg.length) continue;
            const {styles}=_inheritedStyles(c.node,ctx.host);
            let v=styles[prop]||'';
            if((prop==='fontFamily'||prop==='fontSize'||prop==='color') && !v && ctx.host.style) v=ctx.host.style[prop]||'';
            const norm=_normComparable(prop,v);
            if(!any){ firstNorm=norm; firstVal=v; any=true; }
            else if(norm!==firstNorm) return {ok:false,mixed:true};
        }
        return any?{ok:true,value:firstVal,norm:firstNorm}:{ok:false};
    }

    // ── ⑩ 정규화 (기존 _cleanupInline 역할) ────────────────────────
    //   스크립트가 만든 DOM(붙여넣기 등)의 빈 span/빈 서식 태그를 풀고
    //   인접 텍스트 노드를 합친다. 본격적인 정규형 병합은 엔진 재구축이 한다.
    function _cleanupInline(host){
        if(!host||!host.querySelectorAll) return;
        const toRemove=[];
        host.querySelectorAll('span,b,strong,i,em,u,s,strike,mark,font').forEach(el=>{
            if(!el.textContent&&!el.querySelector('img,br,svg,canvas')){ toRemove.push(el); return; }
            if(el.tagName==='SPAN'){
                const style=el.getAttribute('style')||'';
                if(!style.trim()&&!el.getAttribute('class')){
                    const p=el.parentNode;
                    while(el.firstChild) p.insertBefore(el.firstChild,el);
                    toRemove.push(el);
                }
            }
        });
        toRemove.forEach(el=>{ if(el.parentNode) el.parentNode.removeChild(el); });
        try{ host.normalize(); }catch(e){}
    }
    // 선택 영역의 현재 스타일 상태를 툴바 버튼에 반영
    // 18.7 · '지금 서식'을 판단하는 대상: ① 실제 글자 선택 → 선택 전체가 같은가,
    //   없으면 ② 편집 중 캐럿(앞으로 입력될 글자) ③ 선택된 텍스트 상자 전체.
    //   아무것도 아니면 전부 꺼진 상태로 정리한다. (보고 이슈⑥)
    function _activeToggleStates(){
        // ② 캐럿(선택 없음) → 앞으로 입력될 글자 기준
        if(_typingHost()){
            return {
                bold:_caretHasStyle('fontWeight','700'),
                italic:_caretHasStyle('fontStyle','italic'),
                underline:_caretHasStyle('textDecoration','underline'),
                strike:_caretHasStyle('textDecoration','line-through'),
            };
        }
        // ③ 선택된/편집 중 텍스트 상자 → 상자 전체 서식 기준
        let node=null;
        if(selected&&selected.type==='text'&&selected.el) node=selected.el;
        if(!node&&multiSel.length===1) node=multiSel[0].node;
        if(!node) node=document.querySelector('#pagesStage .tb.edit,#pagesStage .tb.sel,#pagesStage .tb.msel');
        if(node&&node.classList&&node.classList.contains('tb')){
            const pageIdx=+node.dataset.pageIdx, id=node.dataset.id;
            const el=(!isNaN(pageIdx)&&id)?findEl(pageIdx,id):null;
            const c=node.querySelector('.tb-content');
            // 상자 단위 서식은 wrapper(.tb)가 아니라 실제 글자가 있는 .tb-content
            // 또는 글자별 span 에 남는다. 예전엔 node.style 만 봐서 상자 전체를
            // 굵게/기울임/밑줄로 만든 뒤 다시 선택하면 툴바 불이 꺼져 보였다.
            const fw=el&&el.fontWeight?el.fontWeight:(c&&c.style?c.style.fontWeight:'');
            const fst=el&&el.fontStyle?el.fontStyle:(c&&c.style?c.style.fontStyle:'');
            const dec=el&&el.textDecoration?el.textDecoration:(c&&c.style?c.style.textDecoration:'');
            return {
                bold:_propMatch('fontWeight',fw,'700') || _boxHasAllStyle(node,'fontWeight','700'),
                italic:_propMatch('fontStyle',fst,'italic') || _boxHasAllStyle(node,'fontStyle','italic'),
                underline:_propMatch('textDecoration',dec,'underline') || _boxHasAllStyle(node,'textDecoration','underline'),
                strike:_propMatch('textDecoration',dec,'line-through') || _boxHasAllStyle(node,'textDecoration','line-through'),
            };
        }
        return {bold:false,italic:false,underline:false,strike:false};
    }
    // 18.8 · 캐럿(앞으로 입력될 글자) 자리에서 실제로 먹고 있는 인라인 스타일 값
    function _caretStyleValue(prop){
        try{
            const t=_typingHost(); if(!t) return '';
            let p=t.r.startContainer;
            p=(p&&p.nodeType===3)?p.parentElement:p;
            while(p&&p!==t.c){
                if(p.style&&p.style[prop]) return p.style[prop];
                if(prop==='fontFamily'&&p.tagName==='FONT'&&p.getAttribute('face')) return p.getAttribute('face');
                p=p.parentElement;
            }
            if(t.c&&t.c.style&&t.c.style[prop]) return t.c.style[prop];
        }catch(e){}
        return '';
    }
    // 18.8 · "툴바에 보이는 글꼴·크기 = 지금 입력되는 글꼴·크기" 를 지킨다.
    //   글자 선택이 없을 때(캐럿 / 상자 선택)의 툴바 동기화 담당.
    function syncToolbarFromCaret(){
        try{
            const t=_typingHost();
            if(t){
                const fam=_caretStyleValue('fontFamily');
                const fid=fam?_fontIdFromCSS(fam):'';
                if(fid) setToolbarFont(fid);
                else{
                    // 상자 자체 글꼴(el.font)이 기준
                    const w=t.c&&t.c.closest?t.c.closest('.tb'):null;
                    const el=w?findEl(+w.dataset.pageIdx,w.dataset.id):null;
                    if(el&&el.font) setToolbarFont(el.font);
                }
                const fs=parseFloat(_caretStyleValue('fontSize'));
                if(fs) setToolbarFS(fs);
                return true;
            }
            // 캐럿이 없으면 '고른 상자' 기준
            syncFSFromTarget();
            return true;
        }catch(e){}
        return false;
    }
    function syncCurSel(){
        try{
            const ctx=_selectionCtx();
            const btnOn=(sel,on)=>{
                const b=document.querySelector(sel);
                if(b) b.classList.toggle('active',!!on);
            };
            if(!ctx){
                // 텍스트(글자) 선택이 없는 화면 → 눌려 있던 서식 버튼을 정리한다.
                //   사용자 이전 설정(글꼴·크기·색·형광펜)은 유지하되, '켜짐' 상태만
                //   실제 캐럿/상자 서식에 맞춘다. (보고 이슈⑥)
                const st=_activeToggleStates();
                btnOn('.tb-bold',st.bold);
                btnOn('.tb-italic',st.italic);
                btnOn('.tb-under',st.underline);
                btnOn('.tb-strike',st.strike);
                // 18.8 · 글꼴·크기는 '지금 입력될 자리' 기준으로 계속 맞춘다.
                syncToolbarFromCaret();
                return;
            }
            // 선택한 모든 글자가 같은 속성을 공유할 때만 툴바에 단일 값으로 표시한다.
            // 섞여 있으면 기존 선택값을 그대로 두어 잘못된 단일 값 표시를 피한다.
            const states={
                bold:_selHasAll('fontWeight','700'),
                italic:_selHasAll('fontStyle','italic'),
                underline:_selHasAll('textDecoration','underline'),
                strike:_selHasAll('textDecoration','line-through'),
            };
            btnOn('.tb-bold',states.bold);
            btnOn('.tb-italic',states.italic);
            btnOn('.tb-under',states.underline);
            btnOn('.tb-strike',states.strike);

            const fU=_selUniformStyle('fontFamily');
            if(fU.ok && fU.norm){
                const id=_fontIdFromCSS(fU.value||fU.norm);
                if(id) setToolbarFont(id);
            }
            const fsU=_selUniformStyle('fontSize');
            if(fsU.ok && fsU.norm){
                const n=parseFloat(fsU.value||fsU.norm);
                if(!isNaN(n)){
                    curFontSize=Math.round(n);
                    const inp=document.getElementById('fsInput');
                    if(inp){ inp.value=curFontSize; inp.classList.remove('mixed'); inp.removeAttribute('aria-label'); }
                }
            }else if(fsU.mixed){
                // Word처럼 선택 범위에 서로 다른 크기가 있으면 임의의 한 값을
                // 보여 주지 않고 '-'로 표시한다. curFontSize는 유지해 +/- 동작의
                // 기준값을 잃지 않으며, 사용자가 숫자를 입력하면 즉시 단일 크기로 바뀐다.
                const inp=document.getElementById('fsInput');
                if(inp&&document.activeElement!==inp){
                    inp.value='-'; inp.classList.add('mixed');
                    inp.setAttribute('aria-label','여러 글자 크기가 선택됨');
                }
            }
            const cU=_selUniformStyle('color');
            if(cU.ok){
                const hex=_colorToHex(cU.value||cU.norm)||'#000000';
                if(hex&&hex!=='transparent'){
                    currentTextColor=hex;
                    const bar=document.getElementById('tcBar'), glyph=document.getElementById('tcGlyph');
                    if(bar) bar.style.background=hex;
                    if(glyph) glyph.style.color=hex;
                    document.querySelectorAll('#textColorPop .color-swatch').forEach(n=>n.classList.toggle('sel',_colorToHex(n.dataset.c)===hex));
                }
            }
            const hU=_selUniformStyle('backgroundColor');
            if(hU.ok){
                const hex=_colorToHex(hU.value||hU.norm);
                const bar=document.getElementById('hlBar');
                if(hex&&hex!=='transparent'){
                    currentHlColor=hex;
                    if(bar) bar.style.background=hex;
                    document.querySelectorAll('#hlPop .color-swatch').forEach(n=>n.classList.toggle('sel',_colorToHex(n.dataset.c)===hex));
                }else if(bar){
                    bar.style.background='transparent';
                }
            }
        }catch(e){}
    }
    // 상자 안 내용 전체에 스타일을 입힌다 (prop=null 이면 형광펜 전체 지우기)
    // 편집 모드 여부와 무관하게 DOM 을 직접 고치므로 글꼴이 풀리지 않는다.
    function _boxTextNodes(c){
        const tw=document.createTreeWalker(c,NodeFilter.SHOW_TEXT);
        const nodes=[]; let n;
        while(n=tw.nextNode()){ if(String(n.nodeValue||'').trim()) nodes.push(n); }
        return nodes;
    }
    // 상자 전체가 해당 스타일로 덮여 있는가 (상자 레벨 + 글자별 span 모두 고려)
    function _boxHasAllStyle(w,prop,value){
        const c=w&&w.querySelector('.tb-content'); if(!c) return false;
        const nodes=_boxTextNodes(c); if(!nodes.length) return false;
        return nodes.every(tn=>_propMatch(prop, _inheritedStyles(tn,c).styles[prop]||'', value));
    }
    // 상자 안 내용 전체에 스타일을 입힌다 (prop=null 이면 형광펜 전체 지우기)
    // v2 엔진의 전체 범위 적용을 쓴다 — 세그먼트 재구축이라 부분 서식(중첩 span)과
    // 겹쳐도 덮어쓰기/보존이 항상 정확하다.
    function _paintBoxAll(w,prop,value){
        const c=w.querySelector('.tb-content'); if(!c) return;
        if(!prop){
            c.querySelectorAll('*').forEach(n=>{
                const bg=n.style&&n.style.backgroundColor;
                if(bg&&bg!=='transparent'&&bg!=='rgba(0, 0, 0, 0)')
                    n.style.removeProperty('background-color');
            });
            if(c.style) c.style.removeProperty('background-color');
            // 구버전 문서/표 셀은 배경색이 el.cellBg 로 저장돼 있었다.
            // 화면 DOM 만 지우면 다시 렌더링하거나 저장 후 열 때 배경이 되살아난다.
            const el=findEl(+w.dataset.pageIdx,w.dataset.id);
            if(el) delete el.cellBg;
            syncTextEl(w);
            return;
        }
        _fmtApplyBox(c,prop,value);
        syncTextEl(w);
    }
    // 상자 전체에서 스타일 제거 (box-level el.fontStyle 같은 옛 데이터도 치운다)
    function _clearBoxStyleAll(w,prop,value){
        const c=w&&w.querySelector('.tb-content'); if(!c) return;
        if(c.style){
            if(prop==='textDecoration'){
                const toks=String(c.style.textDecoration||'').split(/\s+/).filter(t=>t&&t!=='none'&&t!==value);
                if(toks.length) c.style.textDecoration=toks.join(' ');
                else c.style.removeProperty('text-decoration');
            }else c.style.removeProperty(prop);
        }
        const el=findEl(+w.dataset.pageIdx,w.dataset.id);
        if(el){
            if(prop==='textDecoration'){
                const toks=String(el.textDecoration||'').split(/\s+/).filter(t=>t&&t!=='none'&&t!==value);
                if(toks.length) el.textDecoration=toks.join(' ');
                else delete el.textDecoration;
            }else{
                const key={fontWeight:'fontWeight',fontStyle:'fontStyle',color:'textColor',backgroundColor:'cellBg'}[prop];
                if(key) delete el[key];
            }
        }
        _fmtRemoveBox(c,prop,value);
        syncTextEl(w);
    }
    // 상자 전체 토글: 전부 켜져 있으면 끄고, 아니면 전체 적용 (선택 서식과 동일 규칙)
    function _toggleBoxAllStyle(w,prop,value){
        if(_boxHasAllStyle(w,prop,value)) _clearBoxStyleAll(w,prop,value);
        else _paintBoxAll(w,prop,value);
    }
    // 14.13.7 · 순서: ① 표 셀 → ② 글자 선택 범위(저장된 선택 포함) → ③ 상자만 고른 상태(상자 전체)
    function applyTextColor(c){
        currentTextColor=c;
        document.getElementById('tcBar').style.background=c;
        document.getElementById('tcGlyph').style.color=c;
        if(selectedTblCellEls().length){ tblCellApply(el=>{ el.textColor=c; },'선택한 칸 글자색 적용'); return; }
        if(hasInlineTextSel()){
            pushHistory();
            withSelection(()=>wrapSelStyle('color',c));
            return;
        }
        // 18.6 · 캐럿(선택 없음) → 앞으로 입력될 글자에만
        if(_typingHost()){ caretWrapStyle({color:c}); return; }
        const targets=_boxFmtTargets();
        if(targets.length){
            pushHistory();
            targets.forEach(w=>_paintBoxAll(w,'color',c));
            saveDoc();
            toast(targets.length>1?targets.length+'개 상자 글자색 적용':'상자 전체 글자색 적용',1000);
            return;
        }
        toast('텍스트를 드래그하거나 상자를 고르세요',1300);
    }
    function applyHighlight(c){
        if(c){ currentHlColor=c; document.getElementById('hlBar').style.background=c; }
        if(selectedTblCellEls().length){ tblCellFill(c||''); return; }
        if(hasInlineTextSel()){
            pushHistory();
            withSelection(()=>{ if(c) wrapSelStyle('backgroundColor',c); else clearSelBg(); });
            return;
        }
        // 18.6 · 캐럿 → 앞으로 입력될 글자에만
        if(_typingHost()){ caretWrapStyle({backgroundColor:c||'transparent'}); return; }
        const targets=_boxFmtTargets();
        if(targets.length){
            pushHistory();
            targets.forEach(w=>_paintBoxAll(w, c?'backgroundColor':null, c||''));
            saveDoc();
            toast(targets.length>1?targets.length+'개 상자 형광펜 적용':'상자 전체 형광펜 적용',1000);
            return;
        }
        toast('텍스트를 드래그하거나 상자를 고르세요',1300);
    }
    // 18.6 · 글자색 지우기 (부모 상속으로 되돌리기)
    function clearTextColor(){
        if(selectedTblCellEls().length){ tblCellApply(el=>{ delete el.textColor; },'선택한 칸 글자색 지움'); return; }
        if(hasInlineTextSel()){
            pushHistory();
            withSelection(()=>clearSelColor());
            return;
        }
        if(_typingHost()){ caretWrapStyle({color:''}); return; }
        const targets=_boxFmtTargets();
        if(targets.length){
            pushHistory();
            targets.forEach(w=>_clearBoxStyleAll(w,'color'));
            saveDoc();
            toast(targets.length>1?targets.length+'개 상자 글자색 지움':'상자 전체 글자색 지움',1000);
        }
    }
    function execFmt(cmd){
        const cells=selectedTblCellEls();
        if(cells.length){
            const spec={bold:['fontWeight','700'],italic:['fontStyle','italic'],underline:['textDecoration','underline'],
                        strike:['textDecoration','line-through']}[cmd];
            if(spec){
                const [key,val]=spec,remove=cells.every(el=>el[key]===val);
                tblCellApply(el=>{ if(remove) delete el[key]; else el[key]=val; },'선택한 칸 글자 서식 적용');
                return;
            }
        }
        const spec={bold:['fontWeight','700'],italic:['fontStyle','italic'],underline:['textDecoration','underline'],
                    strike:['textDecoration','line-through']}[cmd];
        if(spec){
            // ① 글자 선택(드래그·저장된 범위) → 선택 구간만 토글한다.
            //    예전 캐럿(savedCaret)이 남아 있어도 실제 선택이 있으면 항상 선택을 우선한다.
            if(hasInlineTextSel()){
                pushHistory();
                withSelection(()=>toggleSelStyle(spec[0],spec[1]));
                setTimeout(syncCurSel,0);
                return;
            }
            // ② 캐럿(선택 없음) → 앞으로 입력될 글자만 토글
            if(_typingHost()){
                const [key,val]=spec;
                // 18.7 · 캐럿에서 '꺼짐' 상태는 '속성 제거'가 아니라 '중립값'으로 써야 한다.
                //   - 중립값을 가진 빈 span 을 캐럿 자리에 남기면 이후 입력되는 글자가
                //     바로 앞(부모) 서식에 물려(예: 볼드 span 안에 다시 글자를 입력) 같은
                //     서식으로 계속 입력되는 문제를 막는다. (보고 이슈①)
                //   - fontWeight:400 / fontStyle:normal 처럼 '명시적 중립'이 브라우저가
                //     다음 입력 글자를 이전 서식으로 되돌리는 것까지 막아 준다.
                const off={fontWeight:'400',fontStyle:'normal',textDecoration:''}[key];
                // textDecoration 에는 이미 다른 값(underline 등)이 있을 수 있으니
                // 토글 off 시에만 해당 토큰을 빼는 식으로 처리
                if(_caretHasStyle(key,val)){
                    if(key==='textDecoration'){
                        // 토큰 제거
                        const span=_typingSpan;
                        if(span){
                            const toks=String(span.style.textDecoration||'').split(/\s+/).filter(t=>t&&t!=='none'&&t!==val);
                            span.style.textDecoration=toks.join(' ')||'';
                            const host=span.closest&&span.closest('.tb-content');
                            if(host) _rememberTypingStyles(span,host);
                            const w=(span.closest&&span.closest('.tb'))||(_typingHost()&&_typingHost().w);
                            if(w&&w.isConnected) syncTextEl(w);
                        }
                    }else{
                        caretWrapStyle({[key]:off});
                    }
                }else{
                    // 켜기: 기존 textDecoration 에 추가
                    if(key==='textDecoration'&&_typingSpan){
                        const cur=String(_typingSpan.style.textDecoration||'').split(/\s+/).filter(t=>t&&t!=='none');
                        if(cur.indexOf(val)<0) cur.push(val);
                        _typingSpan.style.textDecoration=cur.join(' ');
                        const host=_typingSpan.closest&&_typingSpan.closest('.tb-content');
                        if(host) _rememberTypingStyles(_typingSpan,host);
                        const w=_typingSpan.closest&&_typingSpan.closest('.tb');
                        if(w&&w.isConnected) syncTextEl(w);
                    }else{
                        caretWrapStyle({[key]:val});
                    }
                }
                return;
            }
            // ③ 상자만 고른 상태 → 상자 전체에 덧씌우고, 이미 전체 적용 상태면 뺀다.
            //    (이제 상자를 클릭한 뒤 굵게/기울임/밑줄 버튼이 '안 되는' 일이 없다)
            const targets=_boxFmtTargets();
            if(targets.length){
                pushHistory();
                targets.forEach(w=>_toggleBoxAllStyle(w,spec[0],spec[1]));
                saveDoc();
                toast(targets.length>1?targets.length+'개 상자에 서식 적용':'상자 전체에 서식 적용',1000);
                setTimeout(syncCurSel,0);
                return;
            }
        }
        // ④ 안전망 — 위 어느 경로로도 처리되지 않았는데 글자 선택이 있으면 토글한다.
        //   구버전은 여기서 execCommand(bold/…) 을 썼는데, execCommand 는 환경마다
        //   선택지의 span 을 제멋대로 다시 짜는 원인이었다. v2 엔진으로 통일한다.
        if(spec&&hasInlineTextSel()){
            pushHistory();
            withSelection(()=>toggleSelStyle(spec[0],spec[1]));
            setTimeout(syncCurSel,0);
        }
    }

    // 문단 정렬 — execCommand(justify*) 없이 대상 블록에 text-align 을 직접 적는다.
    //   (justify* 는 브라우저/웹뷰마다 동작 편차가 컸다. v2 엔진 경로로 통일.)
    //   순서: ① 글자 선택 범위의 문단들 → ② 캐럿 문단 → ③ 표 칸 → ④ 선택한 상자 전체
    function setAlign(dir){
        const sel=window.getSelection();
        const live=sel&&!sel.isCollapsed&&document.querySelector('.tb.edit');
        if(live&&hasInlineTextSel()){
            pushHistory();
            withSelection(()=>_fmtAlignSelection(dir));
            toast(({left:'왼쪽',center:'가운데',right:'오른쪽'})[dir]+' 정렬',1000);
            return;
        }
        const t=_typingHost();
        if(t){
            pushHistory();
            const blk=_fmtLeafBlock(t.r.startContainer.nodeType===3?t.r.startContainer.parentElement:t.r.startContainer,t.c);
            blk.style.textAlign=dir;
            if(blk===t.c){
                const w=blk.closest&&blk.closest('.tb');
                const el=w?findEl(+w.dataset.pageIdx,w.dataset.id):null;
                if(el) el.align=dir;
            }
            const w=t.c.closest('.tb'); if(w) syncTextEl(w);
            toast(({left:'왼쪽',center:'가운데',right:'오른쪽'})[dir]+' 정렬',1000);
            return;
        }
        if(selectedTblCellEls().length){ tblCellAlign(dir); return; }
        let targets=multiSel.length
            ? multiSel.map(m=>m.node).filter(nd=>nd.classList.contains('tb'))
            : [];
        if(!targets.length) targets=Array.from(document.querySelectorAll('#pagesStage .tb.edit,#pagesStage .tb.sel'));
        if(!targets.length){ toast('텍스트 상자를 먼저 선택하세요',1300); return; }
        pushHistory();
        targets.forEach(w=>{
            const c=w.querySelector('.tb-content'); if(!c) return;
            c.style.textAlign=dir;
            const el=findEl(+w.dataset.pageIdx,w.dataset.id);
            if(el) el.align=dir;
        });
        saveDoc();
        toast(({left:'왼쪽',center:'가운데',right:'오른쪽'})[dir]+' 정렬',1000);
    }
/* APP-PART:11b-inline-fmt.js:END */
