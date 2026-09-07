(function(){
    // ============ 자동 번역 (영어 <-> 한국어) ============
    // ---- 번역 작업 중단(취소) ----
    // 진행 중인 번역은 진행바의 [중단] 버튼이나 Esc 로 언제든 멈출 수 있다.
    // 취소는 '실패'가 아니므로 별도 신호(TR_CANCEL)를 던져 '번역 실패' 토스트나
    // 긴 재시도 로직과 섞이지 않게 한다. 이 신호 덕분에 "무한 로딩" 도 없다.
    const TR_CANCEL='번역 중단됨';   // 낮은 수준 신호 — 실패 문구/재시도 정규식과 절대 겹치지 않게
    let trCtl=null;                  // 실행 중인 번역 작업의 AbortController (한 번에 하나)
    let trCancel=false;              // 사용자가 중단을 눌렀는가
    function cancelTranslation(){
        if(!trCtl||trCancel) return;
        trCancel=true;
        try{ trCtl.abort(); }catch(e){}
        const p=document.getElementById('trProg');
        const l=p&&p.querySelector('.tr-label');
        if(p&&p.style.display!=='none'&&l) l.textContent='번역을 중단하는 중…';
    }
    function beginTrTask(){
        if(trCtl) endTrTask();       // 방어: 이전 작업 꼬리 정리
        trCtl=new AbortController(); trCancel=false;
        document.addEventListener('keydown',trEscKey,true);
    }
    function endTrTask(){
        if(trCtl) document.removeEventListener('keydown',trEscKey,true);
        trCtl=null;
        hideTrProg();
    }
    function trEscKey(e){
        if(e.key==='Escape'&&trCtl){
            e.preventDefault(); e.stopPropagation();
            cancelTranslation();
        }
    }
    // 중단하면 재시도 대기·간격 유지 잠도 바로 깬다 (취소가 대기 시간만큼 늦어지지 않게)
    function trSleep(ms){
        return new Promise(res=>{
            const ctl=trCtl;
            const t=setTimeout(fin,ms);
            function fin(){ clearTimeout(t); if(ctl) ctl.signal.removeEventListener('abort',fin); res(); }
            if(ctl){
                if(ctl.signal.aborted||trCancel) fin();
                else ctl.signal.addEventListener('abort',fin);
            }
        });
    }
    async function apiTranslate(text,target,gloss){
        // 프록시/서버가 잠깐 끊긴 경우 한 번만 재시도한다. 무한 재시도는
        // 사용자가 취소할 수 없고 무료 번역 엔진의 429를 더 악화시킨다.
        let last;
        for(let attempt=0;attempt<2;attempt++){
            if(trCancel) throw new Error(TR_CANCEL);
            const ctl=new AbortController();
            const task=trCtl;                       // 이 요청을 거는 작업 핸들
            const timer=setTimeout(()=>ctl.abort(),30000);
            // 사용자 중단 → 이 요청도 즉시 끊는다 (30초 타임아웃을 기다리지 않는다)
            const kick=()=>{ try{ctl.abort();}catch(e){} };
            if(task){
                if(task.signal.aborted){ clearTimeout(timer); throw new Error(TR_CANCEL); }
                task.signal.addEventListener('abort',kick);
            }
            try{
                const r=await fetch('/api/translate',{method:'POST',signal:ctl.signal,
                    headers:{'Content-Type':'application/json','Accept':'application/json'},
                    body:JSON.stringify({text,target,gloss:gloss||undefined})});
                const d=await r.json().catch(()=>({}));
                if(r.ok&&d.ok&&typeof d.text==='string') return d.text;
                // 4xx와 제한 응답은 재시도해도 성공하지 않는다.
                const msg=d.error||('번역 요청 실패 ('+r.status+')');
                if(r.status<500||/제한|429/.test(msg)) throw new Error(msg);
                last=new Error(msg);
            }catch(e){
                if(trCancel) throw new Error(TR_CANCEL);
                last=e&&e.name==='AbortError'?new Error('번역 서버 응답 시간이 초과됐어요. 잠시 후 다시 시도해 주세요.'):e;
                if(/제한|429|문자열이어야|내용이 없습니다|5000자/.test(String(last&&last.message||''))) throw last;
            }finally{
                clearTimeout(timer);
                if(task) task.signal.removeEventListener('abort',kick);
            }
            if(attempt===0) await trSleep(700);
            if(trCancel) throw new Error(TR_CANCEL);
        }
        throw last||new Error('번역 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    }

    async function persistTranslatedChange(){
        // 로컬 저장은 즉시 예약하고, 가져온 문서는 원격 슬라이스 저장까지 완료한 뒤
        // 성공 안내를 낸다. 따라서 다시 열었을 때 원문으로 돌아가지 않는다.
        saveDoc(); queueOps();
        try{ flushSaveDoc(); await flushImportedSave(); }
        catch(e){ throw new Error('번역 결과를 저장하지 못했어요. 네트워크를 확인해 주세요.'); }
    }

    // 텍스트 상자 전체 번역 (서식은 유지하기 어려우므로 글자만 바꾼다)
    // 가져온(tight) 상자는 innerText 가 절대스팬 사이를 줄바꿈으로 잇기 때문에
    // 줄/단어 구조를 살린 클린 텍스트를 만들고, 결과도 가지런한 일반 상자로 변환.
    // tight 상자의 단어 스팬을 '시각적 읽기 순서'로 정렬한다.
    // PDF 가져오기에서 스팬은 절대좌표로 배치되므로 DOM 순서 ≠ 눈에 보이는 순서.
    // → 위(top)에서 아래로, 같은 줄은 왼쪽(left)에서 오른쪽으로 정렬해야
    //   복사·번역·검색 때 글자 순서와 띄어쓰기가 정확해진다.
    function tightSpansSorted(host){
        const sps=Array.from(host.querySelectorAll(':scope>span'));
        const num=(v)=>{ const n=parseFloat(v); return isNaN(n)?0:n; };
        const pos=(s)=>[num(s.style.top), num(s.style.left)];
        // inline top/left 가 없으면 offsetTop/offsetLeft 로 대체 (옛 노트 호환)
        const noInline=sps.some(s=>s.style.left===''&&s.style.top==='');
        sps.sort((a,b)=>{
            const [at,al]=pos(a), [bt,bl]=pos(b);
            if(noInline){
                const aot=a.offsetTop||0, bot=b.offsetTop||0;
                if(Math.abs(aot-bot)>2) return aot-bot;
                return (a.offsetLeft||0)-(b.offsetLeft||0);
            }
            if(Math.abs(at-bt)>2) return at-bt;
            return al-bl;
        });
        return sps;
    }
    function tightCleanText(c){
        const sps=tightSpansSorted(c);
        const num=(v)=>{ const n=parseFloat(v); return isNaN(n)?0:n; };
        const topOf=(s)=>num(s.style.top)||s.offsetTop||0;
        const lines=[]; let cur=[]; let lastTop=null;
        sps.forEach(s=>{
            const t=(s.textContent||'').replace(/[\s\u00a0\u200b\ufeff]+$/,'');
            if(!t) return;
            const top=topOf(s);
            if(lastTop!=null&&Math.abs(top-lastTop)>2){
                lines.push(cur.join(' ')); cur=[];
            }
            cur.push(t); lastTop=top;
        });
        if(cur.length) lines.push(cur.join(' '));
        return lines.join('\n');
    }
    // 선택 범위에서 공백을 '재조립' (zsp 유무·옛 노트 무관):
    // 선택과 교차하는 단어 스팬을 시각 순서로 정렬한 뒤 줄 단위로 묶어 공백으로 잇는다.
    function tightSelectionText(sel){
        try{
            if(!sel||!sel.rangeCount) return String(sel||'');
            const rng=sel.getRangeAt(0);
            const rootEl=(sel.anchorNode&&sel.anchorNode.nodeType===1)
                ? sel.anchorNode : (sel.anchorNode&&sel.anchorNode.parentElement);
            const host=rootEl&&rootEl.closest('.tb-content');
            if(!host||!host.closest('.tight')) return String(sel);
            const spans=tightSpansSorted(host).filter(s=>{
                try{ return rng.intersectsNode(s); }catch(e){ return false; }
            });
            if(!spans.length) return String(sel);
            const num=(v)=>{ const n=parseFloat(v); return isNaN(n)?0:n; };
            const topOf=(s)=>num(s.style.top)||s.offsetTop||0;
            const lines=[]; let cur=[]; let lastTop=null;
            spans.forEach(s=>{
                const t=(s.textContent||'').replace(/[\s\u00a0\u200b\ufeff]+$/,'');
                if(!t) return;
                const top=topOf(s);
                if(lastTop!=null&&Math.abs(top-lastTop)>2){
                    lines.push(cur.join(' ')); cur=[];
                }
                cur.push(t); lastTop=top;
            });
            if(cur.length) lines.push(cur.join(' '));
            return lines.join('\n');
        }catch(e){ return String(sel||''); }
    }
    async function translateElement(node,target){
        closeCtxMenu();
        const pi=+node.dataset.pageIdx;
        const el=findEl(pi,node.dataset.id);
        if(!el||el.type!=='text'){ toast('텍스트 상자를 선택해 주세요',1800); return; }
        const c=node.querySelector('.tb-content');
        const isTight=node.classList.contains('tight');
        // 번역기는 뉴라인을 줄바꿈/문장 끝으로 취급하므로 공백으로 이어
        // 마침표 기준의 자연스러운 문장으로 보낸다.
        const src=isTight? tightCleanText(c).replace(/\n+/g,' ')
                         : (c?c.innerText:'').trim();
        if(!src){ toast('번역할 내용이 없습니다',1600); return; }
        if(trCtl||trBusy){ toast('번역이 이미 진행 중입니다 — 진행바의 [중단] 을 누르거나 잠시 기다려 주세요',2400); return; }
        beginTrTask();
        showTrProg(null,(TR_NAME[target]||target)+'로 번역 중… · 중단하려면 [중단] 또는 Esc');
        try{
            // 본문을 먼저 바꾼다. 용어 학습을 앞에 두면 무료 엔진 한도를
            // 먼저 깎아 정작 상자 번역이 '실패'로 떨어졌다.
            if(trCancel) throw new Error(TR_CANCEL);
            const out=await apiTranslate(src,target,window._sdy.doc.glossary);
            learnGlossary([src],target).then(n=>{ if(n){ try{ saveDoc(); queueOps(); }catch(e){} } }).catch(()=>{});
            pushHistory(true);        // 20.3 · 오래 걸린 뒤라도 확실히 되돌리기 지점을 남긴다
            if(isTight){
                // 가지런한 일반 텍스트 상자로 전환 (찌부됨 방지)
                el.tight=0; el.align='left'; delete el.fitDown;
                node.classList.remove('tight');
            }
            el.fit=0;
            el.html=esc(out).replace(/\n/g,'<br>');
            if(c) c.innerHTML=el.html;
            fitTranslated(node,c,el);                     // 6.1: 상자 안으로 자동 맞춤
            try{
                syncState();
                const rev=Date.now();
                window._sdy.doc.__localRev.set(el.id,rev);
                window._sdy.doc.__lastHash.set(el.id,JSON.stringify(el));
            }catch(e){}
            syncTextEl(node);
            await persistTranslatedChange();
            toast((TR_NAME[target]||target)+'로 번역하고 저장했습니다',2000);
        }catch(e){
            if(e&&e.message===TR_CANCEL) toast('번역을 중단했습니다 — 원문은 그대로입니다',2200);
            else toast('번역 실패: '+e.message,2600);
        }finally{ endTrTask(); }
}

    // 긁어놓은 글자만 번역해서 그 자리에 넣는다
    // 고른 글자를 그 자리에서 번역문으로 바꿔 넣는다 (서식·위치 유지)
    const TR_NAME={ko:'한국어',en:'영어',ja:'일본어','zh-CN':'중국어'};
    async function translateSelectedText(target){
        closeCtxMenu();
        // 우클릭 도중 선택이 풀릴 수 있으니 저장해 둔 선택을 되살린다
        let host=restoreSel();
        let sel=window.getSelection();
        if((!sel||sel.isCollapsed) && host){ /* 복원 실패 */ }
        if(!host){
            const n=sel&&sel.anchorNode
                ? (sel.anchorNode.nodeType===1?sel.anchorNode:sel.anchorNode.parentElement) : null;
            host=n?n.closest('.tb-content'):null;
        }
        sel=window.getSelection();
        // tight 상자는 단어 스팬 구조에서 공백을 재조립하고,
        // 번역 품질을 위해 뉴라인은 공백으로 보낸다.
        let txt=(host&&host.closest('.tight'))? tightSelectionText(sel) : (sel?String(sel):'');
        if(host&&host.closest('.tight'))
            txt=txt.replace(/\n+/g,' ').replace(/\s{2,}/g,' ').trim();
        if(!host||!txt.trim()){ toast('번역할 글자를 선택해 주세요',1800); return; }
        if(trCtl||trBusy){ toast('번역이 이미 진행 중입니다 — 진행바의 [중단] 을 누르거나 잠시 기다려 주세요',2400); return; }
        const w=host.closest('.tb');
        const rng=sel.getRangeAt(0).cloneRange();
        beginTrTask();
        showTrProg(null,`${TR_NAME[target]||target}로 번역 중… · 중단하려면 [중단] 또는 Esc`);
        try{
            const out=await apiTranslate(txt,target);
            if(!out||!String(out).trim()){ toast('번역 결과가 비어 있습니다',2000); return; }
            pushHistory(true);        // 20.3 · 비동기 결과 적용은 항상 되돌릴 수 있게
            // 편집 상태여야 execCommand 가 먹는다
            if(w&&!w.classList.contains('edit')){
                enterEdit(w,true); enableTextSelect(host);
            }
            const s2=window.getSelection();
            s2.removeAllRanges(); s2.addRange(rng);
            host.focus({preventScroll:true});
            // 브라우저 execCommand 는 자체 실행취소 스택을 써서 Ctrl+Z 가 어긋난다.
            // → 직접 바꿔 넣어 우리 되돌리기 한 번으로 정확히 복구되게 한다.
            rng.deleteContents();
            const tn=document.createTextNode(out);
            rng.insertNode(tn);
            const r2=document.createRange();
            r2.setStartAfter(tn); r2.collapse(true);
            s2.removeAllRanges(); s2.addRange(r2);
            if(w){
                syncTextEl(w);
                await persistTranslatedChange();
            }
            saveSel();
            toast(`${TR_NAME[target]||target}로 바꾸고 저장했습니다 (Ctrl+Z 로 되돌리기)`,2400);
        }catch(e){
            if(e&&e.message===TR_CANCEL) toast('번역을 중단했습니다 — 원문은 그대로입니다',2200);
            else toast('번역 실패: '+e.message,2600);
        }finally{ endTrTask(); }
}

    // ============ 6.1: 페이지/문서 전체 번역 + 용어 기억 + 자동 맞춤 ============
    // tight 상자의 단어 스팬은 인라인 top 을 갖고 있으므로 레이아웃 없이 파싱 가능
    function tightTextFromHtml(html){
        const d=document.createElement('div'); d.innerHTML=html||'';
        const sps=Array.from(d.querySelectorAll('span')).filter(s=>s.style.left!==''||s.style.top!=='');
        sps.sort((a,b)=>(parseFloat(a.style.top)||0)-(parseFloat(b.style.top)||0)
                       ||(parseFloat(a.style.left)||0)-(parseFloat(b.style.left)||0));
        const lines=[]; let cur=[]; let last=null;
        sps.forEach(s=>{
            const t=(s.textContent||'').replace(/[​‌‍﻿]/g,'').trim();
            if(!t) return;
            const top=parseFloat(s.style.top)||0;
            if(last!=null&&Math.abs(top-last)>2){ lines.push(cur.join(' ')); cur=[]; }
            cur.push(t); last=top;
        });
        if(cur.length) lines.push(cur.join(' '));
        return lines.join(' ');
    }
    function plainTextFromHtml(html){
        const d=document.createElement('div');
        d.innerHTML=(html||'').replace(/<br\s*\/?>/gi,'\n');
        return (d.textContent||'').replace(/[​‌‍﻿]/g,'');
    }
    // 전문용어 후보 추출: 대문자 줄임말·하이픈 결합 용어·CamelCase
    const TR_STOP=new Set(['FIG','FIGS','FIGURE','FIGURES','TABLE','TABLES','SECTION','SECTIONS',
        'EQ','EQS','VOL','NO','PP','ET','AL','THE','AND','OR','OF','IN','ON','FOR','WITH','TO','BY',
        'IS','ARE','WAS','WERE','WE','OUR','US','AS','AT','AN','NOT','YES','OK','PDF','HTML','HTTP',
        'HTTPS','URL','DOI','ISBN','ISSN','ARXIV','CC','USA','UK','EU','UN','ABSTRACT','INTRODUCTION',
        'CONCLUSION','CONCLUSIONS','REFERENCES','ACKNOWLEDGMENTS','ACKNOWLEDGEMENTS','APPENDIX',
        'SUPPLEMENTARY','METHODS','RESULTS','DISCUSSION','PAGE','PAGES','COPYRIGHT','IEEE','ACM',
        'LNCS','SPRINGER','ELSEVIER','PREPRINT','ARTICLE','LETTER','LETTERS','NOTE','NOTES']);
    function extractTerms(text){
        const set=new Set();
        const re=/\b([A-Z][A-Z0-9]{1,9}(?:-[A-Z0-9]+)?)\b|\b([A-Z][a-z]+(?:-[A-Z][a-z]+)+)\b|\b([A-Z][a-z]+[A-Z][A-Za-z]+)\b/g;
        let m;
        while((m=re.exec(text))){
            const t=m[1]||m[2]||m[3];
            if(!t) continue;
            if(TR_STOP.has(t.toUpperCase())) continue;
            set.add(t);
            if(set.size>=300) break;
        }
        return Array.from(set);
    }
    // 문서 사전(window._sdy.doc.glossary)에 새 용어 번역을 학습해 저장 → 이후 번역이 일관됨
    async function learnGlossary(texts,target){
        if(!window._sdy.doc) return 0;
        const g=window._sdy.doc.glossary||(window._sdy.doc.glossary={});
        const seen=new Set(Object.keys(g));
        const terms=[];
        (texts||[]).forEach(t=>extractTerms(t).forEach(x=>{
            if(!seen.has(x)){ seen.add(x); terms.push(x); }
        }));
        if(!terms.length) return 0;
        for(let i=0;i<terms.length;i+=60){
            if(trCancel) return 0;                    // 사용자 중단 → 학습도 멈춤
            const chunk=terms.slice(i,i+60);
            try{
                const r=await fetch('/api/translate/gloss',{method:'POST',
                    signal:trCtl?trCtl.signal:undefined,
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({terms:chunk,target})});
                const d=await r.json().catch(()=>({}));
                if(d&&d.ok&&d.gloss) Object.assign(g,d.gloss);
            }catch(e){ if(trCancel) return 0; }
        }
        return terms.length;
    }
    // 번역문이 상자를 넘치면: ① 글자간격 → ② 기 → ③ 글자 크기 순으로 맞춤
    function fitTranslated(w,c,el){
        if(!c||!el) return;
        const base=el.fontSize||parseFloat(getComputedStyle(c).fontSize)||14;
        c.style.fontSize=base+'px'; c.style.letterSpacing='';
        c.style.fontWeight=el.fontWeight?String(el.fontWeight):'';
        const over=()=>c.scrollHeight>c.clientHeight+1||c.scrollWidth>c.clientWidth+1;
        el.trFit=1; el.trLS=''; el.trFW=''; el.trFS=base;
        if(!over()) return;
        for(const ls of [-0.012,-0.024,-0.036,-0.048]){   // ① 글자간격
            if(!over()) break;
            c.style.letterSpacing=ls+'em'; el.trLS=ls+'em';
        }
        let fw=parseInt(getComputedStyle(c).fontWeight)||400;   // ② 굵기
        for(const step of [600,500,400]){
            if(!over()||fw<=step) continue;
            c.style.fontWeight=step; el.trFW=step; fw=step;
        }
        let px=base, guard=0;                              // ③ 크기
        const min=Math.max(7,Math.round(base*0.62*10)/10);
        while(over()&&guard++<22&&px>min){
            px=Math.round(px*0.94*10)/10;
            c.style.fontSize=px+'px';
        }
        el.trFS=px;
        // ④ 최소 크기에서도 넘치면 상자 높이를 늘린다 (표 칸은 제외)
        if(el.h&&over()&&!el.tbl){
            let h=el.h, g2=0;
            while(over()&&g2++<60){ h+=16; el.h=h; w.style.height=h+'px'; }
        }
    }
    // 진행률 바
    function showTrProg(f,label){
        let p=document.getElementById('trProg');
        if(!p){
            p=document.createElement('div'); p.id='trProg';
            p.innerHTML='<span class="tr-label"></span><span class="tr-track"><i class="tr-fill"></i></span>'+
                '<button type="button" class="tr-cancel" title="번역 중단 (Esc)">중단</button>';
            p.querySelector('.tr-cancel').addEventListener('click',cancelTranslation);
            document.body.appendChild(p);
        }
        p.style.display='flex';
        const fill=p.querySelector('.tr-fill');
        if(f==null){ fill.classList.add('indet'); fill.style.width=''; }
        else{ fill.classList.remove('indet'); fill.style.width=Math.round(Math.min(1,Math.max(0,f))*100)+'%'; }
        p.querySelector('.tr-label').textContent=label||'';
    }
    function hideTrProg(){
        const p=document.getElementById('trProg');
        if(p) p.style.display='none';
    }
    // 피규어/표 캡션·축 라벨 등 "본문이 아닌" 글자인지 판별 (논문 전체 번역 시 제외)
    function isFigureText(el,src){
        if(el.isFig) return true;                        // 명시적으로 그림 글자로 표시된 경우
        const s=(src||'').replace(/\s+/g,' ').trim();
        if(!s) return true;
        // 캡션 패턴: Fig. 1 / Figure 2 / Table 3 / 그림 1 / 표 2 ...
        if(/^(fig(?:ure)?s?\.?|table|그림|표)\s*[0-9]+/i.test(s)) return true;
        // 축 눈금처럼 짧고 숫자·기호 위주인 글자는 그림 위 글자로 간주
        const letters=(s.match(/[A-Za-z가-힣]/g)||[]).length;
        if(letters<=3 && /[0-9]/.test(s) && s.length<=24) return true;
        return false;
    }
    // 논문 잡음: 참고문헌 번호·DOI·연도만 있는 조각은 번역하지 않는다.
    function isPaperNoise(src){
        const s=String(src||'').replace(/\s+/g,' ').trim();
        if(!s) return true;
        if(/^\[[0-9,\s–\-]+\]$/.test(s)) return true;
        if(/^\(\s*\d{4}[a-z]?\s*\)$/.test(s)) return true;
        if(/^(doi:|https?:\/\/|arxiv:)/i.test(s)) return true;
        if(/^[A-Za-z][A-Za-z\-']+ et al\.?$/i.test(s)) return true;
        if(/^(vol\.?|pp?\.?|no\.?)\s*[\d\-]+$/i.test(s)) return true;
        if(/^[\d.,+\-±%=\s]+$/.test(s) && s.length<=20) return true;
        return false;
    }
    function trLooksTarget(s,target){
        const t=String(s||'');
        if(target==='ko'){
            let ko=0; for(const ch of t) if(ch>='\uAC00'&&ch<='\uD7A3') ko++;
            return ko>=Math.max(2,Math.floor(t.trim().length*0.2));
        }
        if(target==='ja') return /[\u3040-\u30ff]/.test(t);
        if(target==='zh-CN'||target==='zh') return /[\u4e00-\u9fff]/.test(t)&&!/[\u3040-\u30ff]/.test(t);
        if(target==='en'){
            const letters=(t.match(/[A-Za-z]/g)||[]).length;
            const ko=(t.match(/[\uAC00-\uD7A3]/g)||[]).length;
            return letters>=8 && ko===0;
        }
        return false;
    }
    function applyTrResult(o,out){
        if(!out||!String(out).trim()) return false;
        o.el.tight=0; o.el.fit=0; delete o.el.fitDown;
        o.el.html=esc(out).replace(/\n/g,'<br>');
        try{ markPageEdited(o.pi); }catch(e){}
        try{
            syncState();
            const rev=Date.now()+Math.random();
            window._sdy.doc.__localRev.set(o.el.id,rev);
            window._sdy.doc.__lastHash.set(o.el.id,JSON.stringify(o.el));
        }catch(e){}
        const node=document.querySelector('.tb[data-id="'+o.el.id+'"]');
        const c=node&&node.querySelector('.tb-content');
        if(node&&c){
            node.classList.remove('tight');
            c.innerHTML=o.el.html;
            fitTranslated(node,c,o.el);
        }else o.el.trPending=1;
        return true;
    }
    // 논문 PDF 는 한 줄=한 상자인 경우가 많다. 짧은 상자를 한 요청으로 묶어
    // 문맥도 살리고 무료 엔진 한도도 덜 깎는다.
    function packTrJobs(list){
        const shorts=list.filter(o=>o.src.length<=240).length;
        const pack=list.length>=5 || shorts>=4;
        if(!pack) return list.map(o=>({items:[o]}));
        const packs=[]; let cur=null;
        const flush=()=>{ if(cur) packs.push(cur); cur=null; };
        list.forEach(o=>{
            const short=o.src.length<=240;
            if(!short){ flush(); packs.push({items:[o]}); return; }
            if(!cur){ cur={items:[o]}; return; }
            const next=cur.items.reduce((n,x)=>n+x.src.length,0)+o.src.length+10*cur.items.length;
            if(cur.items.length>=12 || next>1800){ flush(); cur={items:[o]}; }
            else cur.items.push(o);
        });
        flush();
        return packs;
    }
    function joinTrPack(items){
        if(items.length===1) return items[0].src;
        return items.map((o,i)=>i===0?o.src:('§#'+(i+1)+'§\n'+o.src)).join('\n');
    }
    function splitTrPack(out,n){
        if(n<=1) return [String(out||'')];
        const parts=[]; let rest=String(out||'');
        for(let i=2;i<=n;i++){
            const mark='§#'+i+'§';
            const idx=rest.indexOf(mark);
            if(idx<0) return null;
            parts.push(rest.slice(0,idx).replace(/^\s+|\s+$/g,''));
            rest=rest.slice(idx+mark.length);
        }
        parts.push(rest.replace(/^\s+|\s+$/g,''));
        if(parts.length!==n || parts.some(p=>!p)) return null;
        return parts;
    }
    function collectPageEls(pi){
        const pg=(window._sdy.doc.pages||[])[pi]; const out=[];
        if(!pg) return out;
        // 그림(이미지) 영역 위에 놓인 글자는 번역에서 제외
        const imgs=(pg.els||[]).filter(e=>e.type==='image'&&!e.isBg);
        const overImg=(el)=>{
            if(!imgs.length) return false;
            return imgs.some(im=>{
                const iw=im.w||0, ih=im.h||0, ew=el.w||0, eh=el.h||0;
                if(!iw||!ih||im.x==null||im.y==null||el.x==null||el.y==null) return false;
                return el.x>=im.x-2 && el.y>=im.y-2 &&
                       el.x+ew<=im.x+iw+2 && el.y+eh<=im.y+ih+2;
            });
        };
        (pg.els||[]).forEach(el=>{
            if(el.type!=='text'||el.locked) return;
            // 20.1 · 글상자 하나의 글자 뽑기 결과를 상자에 붙여 둔다.
            //   가져온 PDF(tight)는 상자마다 절대좌표 <span> 이 수백 개라
            //   tightTextFromHtml 한 번이 innerHTML 파싱 + querySelectorAll + 정렬이다.
            //   해돌이 warm/버튼 상태 갱신이 이걸 문서 전체로 매번 다시 돌려
            //   스크롤 한 번에 수만 번씩 파싱하던 것이 '10초 멈춤'의 정체였다.
            let src;
            if(el.__txtSrc!=null && el.__txtHtml===el.html){
                src=el.__txtSrc;
            }else{
                src=el.tight? tightTextFromHtml(el.html) : plainTextFromHtml(el.html);
                src=(src||'').replace(/\s+/g,' ').trim();
                try{
                    Object.defineProperty(el,'__txtHtml',{value:el.html,writable:true,configurable:true,enumerable:false});
                    Object.defineProperty(el,'__txtSrc',{value:src,writable:true,configurable:true,enumerable:false});
                }catch(e){}
            }
            src=(src||'').replace(/\s+/g,' ').trim();
            if(!src) return;
            if(isFigureText(el,src)||overImg(el)) return;   // 6.6: 피규어/캡션은 제외
            out.push({el,src,pi});
        });
        return out;
    }
    let trBusy=false;
    // 15.0 · 무료 번역 엔진은 요청이 몰리면 잠깐 제한(429)된다. 그럴 땐
    //   기다렸다가 다시 시도한다 — 문서 전체 번역이 중간에 통째로 실패하지 않게.
    async function apiTranslateRetry(src,target,gloss){
        for(let a=0;a<3;a++){
            if(trCancel) throw new Error(TR_CANCEL);
            try{ return await apiTranslate(src,target,gloss); }
            catch(e){
                const msg=String(e&&e.message||'');
                if(msg===TR_CANCEL) throw e;                 // 사용자 중단은 재시도하지 않는다
                if(a>=2||!/제한|429|닿지 않/.test(msg)) throw e;
                await trSleep(9000*(a+1));                   // 대기 중에도 중단 즉시 반영
            }
        }
    }
    async function translateEls(list,target,label){
        if(trBusy||trCtl){ toast('번역이 이미 진행 중입니다 — 진행바의 [중단] 을 누르거나 잠시 기다려 주세요',2400); return; }
        if(!list.length){ toast('번역할 텍스트 상자가 없습니다',1800); return; }
        trBusy=true;
        beginTrTask();
        let failCnt=0, lastErr='', okCnt=0;
        const remaining=()=>q.reduce((n,p)=>n+((p&&p.items)||[p]).length,0);
        let q=[];
        try{
            showTrProg(0,label+' · 번역 준비… · 중단하려면 [중단]/Esc');
            pushHistory(true);                             // 되돌리기 한 번으로 전체 복구
            const jobs=list.filter(o=>{
                if(trLooksTarget(o.src,target)){ okCnt++; return false; }
                return true;
            });
            const packs=packTrJobs(jobs);
            q=packs.slice();
            const totalPacks=Math.max(1,packs.length);
            const worker=async()=>{
                while(q.length&&!trCancel){
                    const pack=q.shift();
                    const items=pack.items||[pack];
                    const done=okCnt+failCnt;
                    showTrProg(done/Math.max(1,list.length),
                        label+' · 번역 '+Math.min(done+items.length,list.length)+'/'+list.length
                        +(failCnt?' · 실패 '+failCnt:'')+' · 중단: [중단]/Esc');
                    try{
                        if(items.length===1){
                            const out=await apiTranslateRetry(items[0].src,target,window._sdy.doc.glossary);
                            if(applyTrResult(items[0],out)) okCnt++;
                        }else{
                            const joined=joinTrPack(items);
                            const out=await apiTranslateRetry(joined,target,window._sdy.doc.glossary);
                            const parts=splitTrPack(out,items.length);
                            if(parts){
                                items.forEach((o,i)=>{ if(applyTrResult(o,parts[i])) okCnt++; else failCnt++; });
                            }else if(/제한|429/.test(String(out||''))){
                                failCnt+=items.length;
                                lastErr='지금 번역 요청이 몰려 잠시 제한됐어요';
                            }else{
                                // 구분자가 깨지면 그 묶음만 상자별로 한 번 더 (429는 안 함)
                                for(const o of items){
                                    if(trCancel){ q.unshift({items:items.slice(items.indexOf(o))}); break; }
                                    try{
                                        const one=await apiTranslateRetry(o.src,target,window._sdy.doc.glossary);
                                        if(applyTrResult(o,one)) okCnt++; else failCnt++;
                                    }catch(e){
                                        if(e&&e.message===TR_CANCEL){ q.unshift({items:[o]}); break; }
                                        failCnt++; lastErr=String(e&&e.message||'');
                                        if(/제한|429/.test(lastErr)){
                                            const rest=items.slice(items.indexOf(o)+1);
                                            failCnt+=rest.length;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }catch(e){
                        if(e&&e.message===TR_CANCEL){ q.unshift(pack); }
                        else {
                            failCnt+=items.length;
                            lastErr=String(e&&e.message||'');
                        }
                    }
                    await trSleep(packs.length>8?80:160);
                }
            };
            // 논문은 묶음이 이미 커서 일꾼 2개면 한도만 더 깎인다. 묶음이 많을 때만 2개.
            await Promise.all(totalPacks>=6?[worker(),worker()]:[worker()]);
            // 중단했어도 이미 완료된 상자는 유실하지 않고 저장한다
            await persistTranslatedChange();
            learnGlossary(list.map(o=>o.src),target)
                .then(n=>{ if(n){ try{ saveDoc(); queueOps(); }catch(e){} } })
                .catch(()=>{});
            const left=remaining();
            if(trCancel){
                toast(label+' 번역을 중단했어요 · 완료한 '+okCnt+'개 상자는 저장했습니다'
                    +(left?' · 남은 '+left+'개 상자는 원문 유지':''),3200);
            }
            // 15.0 · 실패한 상자가 있으면 '완료'라고만 알리지 않는다 —
            //   다 번역 안 됐는데 완료로 보이던 문제.
            else if(failCnt>=list.length){
                toast('번역에 실패했어요 · '+(lastErr||'잠시 뒤 다시 시도해 주세요'),3600);
            }else if(failCnt){
                toast(label+' 번역 부분 완료 · '+failCnt+'개 상자는 실패 (잠시 뒤 다시 눌러 주세요)',3200);
            }else{
                toast(label+' 번역 완료 · 저장됨 ('+list.length+'개 상자)',2400);
            }
        }catch(e){
            toast('번역 결과 저장 실패: '+String(e&&e.message||'다시 시도해 주세요'),3600);
        }finally{ trBusy=false; endTrTask(); }
    }
    async function translatePageAction(pi,target){
        if(trBusy||trCtl){ toast('번역이 이미 진행 중입니다 — 진행바의 [중단] 을 누르거나 잠시 기다려 주세요',2400); return; }
        closeCtxMenu();
        try{ await ensureLazyPage(pi); }catch(e){}
        const list=collectPageEls(pi);
        await translateEls(list,target,(pi+1)+'페이지');
    }
    async function translateDocAction(target){
        if(trBusy||trCtl){ toast('번역이 이미 진행 중입니다 — 진행바의 [중단] 을 누르거나 잠시 기다려 주세요',2400); return; }
        closeCtxMenu();
        const total=(window._sdy.doc.pages||[]).length;
        // 대용량(서버 보관) 문서는 먼저 전부 불러온다 → 번역이 중간에 끊기지 않게
        if(window._sdy.doc.__ref&&(window._sdy.doc.pages||[]).some(p=>p.__lazy!=null)){
            showTrProg(0,'문서 전체 불러오는 중…');
            try{ await loadAllLazyNoEvict(); }catch(e){}
        }
        const list=[];
        for(let i=0;i<total;i++){
            showTrProg(i/Math.max(1,total),'문서 로딩 '+(i+1)+'/'+total);
            const got=collectPageEls(i);
            got.forEach(o=>list.push(o));
        }
        hideTrProg();
        await translateEls(list,target,'문서 전체');
    }
    try{
        window.__sdyTranslate={
            page:translatePageAction,
            doc:translateDocAction,
            getDoc:()=>window._sdy.doc,
            curPage:()=>window._sdy.curPageIdx|0,     // 14.29.3 · 해돌이 '이 페이지 번역'용
            pack:packTrJobs,
        };
    }catch(e){}

    // 14.20.0 · AI UI가 노트 글과 문서 구조를 편집기 스코프 안에서만 다루는 다리.
    //   일반 질문은 text()로 글만 읽는다. 14.24.0 문서 편집은 capture()로 제한된
    //   상태 스냅샷을 만들고, apply()가 허용된 명령만 검증해 한 번에 적용한다.
    //   모델 응답이 오는 동안 노트를 바꾸거나 내용을 고치면 revision이 달라져
    //   오래된 계획은 전부 거절한다. AI 편집 전체는 Ctrl+Z 한 번으로 되돌릴 수 있다.
    //   14.25.0 · 스냅샷에 글꼴·서식·표를 싣고(@st·@tbl·@tcell), 부분 수정(@rp·@ap),
    //   쪽 이동·추가(@goto·@newpage), 노트 제목(@title), 클립보드(@clip·@clipin·@copy),
    //   되묻기(@ask)까지 허용 목록이 늘었다. 적용 규칙은 같다 — 검증·한 번에·undo.
    //   14.27.0 · 형광펜 글귀 단위(@hl)·표 삭제 완화(@del·@tdel)·보기 좋은 배치
    //   (@tidy·auto 좌표)가 늘었다. 스냅샷은 칠해진 곳을 ⟦…⟧ 로 보여 준다.
    //   14.27.1 · 긴 편집을 위해 요소 800개·상태 8만 자·상자 미리보기 1200자와
    //   명령 120개·명령 본문 12000자까지 확장했다. 검증·원자 적용·undo는 그대로다.
    const AI_EDIT_MAX_ITEMS=800, AI_EDIT_MAX_SNAPSHOT=80000;
    const AI_EDIT_MAX_OPS=120, AI_EDIT_MAX_TEXT=12000;

    function aiEditText(el){
        if(!el) return '';
        if(el.type==='text') return el.tight?tightTextFromHtml(el.html):plainTextFromHtml(el.html);
        if(el.type==='latex') return String(el.latex||'');
        return '';
    }
    function aiEditStrokeBox(el){
        let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity,n=0;
        (el&&el.pts||[]).forEach(pt=>{
            if(!pt||!Number.isFinite(+pt[0])||!Number.isFinite(+pt[1])) return;
            n++; x1=Math.min(x1,+pt[0]); y1=Math.min(y1,+pt[1]);
            x2=Math.max(x2,+pt[0]); y2=Math.max(y2,+pt[1]);
        });
        if(!n) x1=y1=x2=y2=0;
        const dx=+el.dx||0,dy=+el.dy||0;
        return {x:x1+dx,y:y1+dy,w:Math.max(0,x2-x1),h:Math.max(0,y2-y1),baseX:x1,baseY:y1};
    }
    function aiEditBox(el){
        if(el&&el.type==='stroke') return aiEditStrokeBox(el);
        return {x:+(el&&el.x)||0,y:+(el&&el.y)||0,w:+(el&&el.w)||0,h:+(el&&el.h)||0};
    }
    function aiEditSnapshot(){
        if(!doc||!window._sdy.doc.pages||!window._sdy.doc.pages.length) return '';
        const size=paperSize();
        const title=(String((document.getElementById('edTitle')||{}).value||'')
            .replace(/\s+/g,' ').replace(/</g,'‹').replace(/>/g,'›').trim())||'(제목 없음)';
        const lines=[]; let chars=0,items=0,folded=false;
        const add=line=>{
            line=String(line||'');
            if(chars+line.length+1>AI_EDIT_MAX_SNAPSHOT){ folded=true; return false; }
            lines.push(line); chars+=line.length+1; return true;
        };
        const preview=(value,max)=>{
            const text=String(value||'').replace(/\s+/g,' ').replace(/</g,'‹').replace(/>/g,'›').trim();
            const lim=max||1200;
            return text.length>lim?text.slice(0,lim)+'…':text;
        };
        // 14.27.0 · 글상자 미리보기에는 형광펜이 칠해진 글귀를 ⟦…⟧ 로 표시한다.
        //   모델이 '이미 칠한 곳'을 알아야 겹칠하거나 딴 데를 칠하지 않는다.
        const previewEl=(el,max)=>{
            const text=(el&&el.type==='text'&&!el.tight)
                ?aiEditHlPreview(el.html)
                :String(aiEditText(el)||'').replace(/\s+/g,' ')
                    .replace(/</g,'‹').replace(/>/g,'›').trim();
            const lim=max||1200;
            return text.length>lim?text.slice(0,lim)+'…':text;
        };
        // id는 모델이 그대로 되돌려 보내는 실행 토큰이다. 프롬프트 구분자나
        // 필드 구분자로 해석될 수 있는 비정상 가져오기 id는 노출하지 않는다.
        const safeId=id=>{
            id=String(id||'');
            if(!id||id.length>160||/[\s<>|]/.test(id)) return '';
            return id;
        };
        add('노트 제목: '+title);
        add('페이지 크기: '+size.w+'x'+size.h+' px · 왼쪽 위=0,0 · 총 '
            +window._sdy.doc.pages.length+'쪽 · 현재 '+(Math.min(Math.max(window._sdy.curPageIdx|0,0),window._sdy.doc.pages.length-1)+1)+'쪽');
        // 긴 문서에서도 현재 쪽은 반드시 모델에게 보인다. 나머지는 페이지 순서대로 싣는다.
        const current=Math.min(Math.max(window._sdy.curPageIdx|0,0),window._sdy.doc.pages.length-1);
        const order=[current].concat(window._sdy.doc.pages.map((p,i)=>i).filter(i=>i!==current));
        for(const pi of order){
            if(items>=AI_EDIT_MAX_ITEMS||folded) break;
            const pg=window._sdy.doc.pages[pi];
            // 빈 자리도 알려 준다 — 새 상자·표를 어디에 두면 정돈돼 보이는지
            // 모델이 스스로 고르게(그래도 최종 배치는 aiEditNeat가 다듬는다).
            let filled=0;
            aiEditOccupied(pi).forEach(o=>{ filled=Math.max(filled,Math.round(o.y+o.h)); });
            const freeFrom=Math.min(size.h,filled?filled+AI_GAP:AI_MARGIN);
            if(!add('['+(pi+1)+'쪽'+(pi===current?' · 현재':'')+']'
                +(filled?' 빈 자리 y='+freeFrom+'~'+size.h+' · 본문 왼쪽 x='
                    +(aiEditMargins(pi).left==null?AI_MARGIN:aiEditMargins(pi).left):' (빈 쪽)'))) break;
            if(!pg||pg.__lazy!=null){ add('  (아직 불러오지 않은 쪽 · 편집 불가)'); continue; }
            const els=pg.els||[];
            // 표는 칸 글과 함께 한 줄로 먼저 보여 준다 — 칸은 @tcell·@st로, 표 전체는
            // @tmv·@tsz로 다룬다. 표 테두리 선(자동 재생성)은 스냅샷에서 뺀다.
            (pg.tables||[]).forEach(t=>{
                if(items>=AI_EDIT_MAX_ITEMS||folded||!t||!t.id) return;
                const tid=safeId(t.id);
                if(!tid||!Array.isArray(t.cw)||!Array.isArray(t.ch)) return;
                const rows=t.ch.length,cols=t.cw.length;
                if(!rows||!cols) return;
                const size=tblSize(t);
                const cells={};
                els.forEach(e=>{
                    if(e&&e.type==='text'&&e.tbl&&e.tbl.tid===t.id
                       &&Number.isInteger(+e.tbl.r)&&Number.isInteger(+e.tbl.c))
                        cells[e.tbl.r+'_'+e.tbl.c]=previewEl(e,28);
                });
                const grid=[];
                for(let r=0;r<rows;r++){
                    const row=[];
                    for(let c=0;c<cols;c++) row.push(cells[r+'_'+c]||'');
                    grid.push(row.join('|'));
                }
                let dump=grid.join(';');
                if(dump.length>200) dump=dump.slice(0,200)+'…';
                if(add('  id='+tid+' type=표 x='+Math.round(t.x)+' y='+Math.round(t.y)
                    +' w='+Math.round(size.w)+' h='+Math.round(size.h)
                    +' rows='+rows+' cols='+cols+' cells='+JSON.stringify(dump))) items++;
            });
            if(!els.length){ add('  (빈 쪽 · @add 가능)'); continue; }
            // 읽는 순서(위→아래·왼쪽→오른쪽)로 보여 주면 "두 번째 상자" 같은
            // 가리킴이 나열 순서와 어긋나지 않는다.
            const sorted=els.slice().sort((a,b)=>{
                const ba=aiEditBox(a),bb=aiEditBox(b);
                if(Math.abs(ba.y-bb.y)>4) return ba.y-bb.y;
                return ba.x-bb.x;
            });
            for(const el of sorted){
                if(items>=AI_EDIT_MAX_ITEMS||folded) break;
                if(!el||!el.id) continue;
                const elementId=safeId(el.id);
                if(!elementId) continue;
                // 표 테두리 선은 표를 고치면 자동 재생성되니 모델에게 보이지 않는다.
                if(el.type==='stroke'&&el.tbl) continue;
                const b=aiEditBox(el);
                let kind='기타',extra='',fmt='';
                if(el.type==='text'){
                    kind='글상자';
                    // 서식은 기본값과 다를 때만 싣는다 — 없으면 프리텐다드·16·왼쪽이다.
                    if(el.font&&el.font!=='pretendard') fmt+=' font='+el.font;
                    if(el.fontSize&&+el.fontSize!==16) fmt+=' fs='+Math.round(+el.fontSize);
                    if(el.align&&el.align!=='left') fmt+=' al='+el.align;
                    if(el.textColor) fmt+=' fg='+el.textColor;
                    if(el.cellBg) fmt+=' hl='+el.cellBg;
                    const st=[];
                    if(el.fontWeight&&(String(el.fontWeight)==='700'||String(el.fontWeight)==='bold')) st.push('B');
                    if(el.fontStyle) st.push('I');
                    const td=String(el.textDecoration||'');
                    if(td.indexOf('underline')>=0) st.push('U');
                    if(td.indexOf('line-through')>=0) st.push('S');
                    if(st.length) fmt+=' st='+st.join(',');
                    extra=' text='+JSON.stringify(previewEl(el));
                }
                else if(el.type==='image') kind='사진';
                else if(el.type==='latex'){
                    kind='수식';
                    if(el.displayMath) fmt+=' display=1';
                    if(el.fontSize&&+el.fontSize!==20) fmt+=' fs='+Math.round(+el.fontSize);
                    extra=' latex='+JSON.stringify(preview(aiEditText(el)));
                }
                else if(el.type==='stroke'){
                    kind='그림획';
                    if(el.color) fmt+=' pen='+el.color;
                    if(el.size!=null) fmt+=' psz='+el.size;
                    if(el.shape) fmt+=' shape='+el.shape;
                }
                else if(el.type==='legacyDraw') kind='배경그림';
                else continue;
                let line='  id='+elementId+' type='+kind+' x='+Math.round(b.x)+' y='+Math.round(b.y)
                    +' w='+Math.round(b.w)+' h='+Math.round(b.h)+fmt+extra;
                if(el.locked) line+=' (잠김 · 편집 불가)';
                else if(el.tbl) line+=' (표 칸 · @tcell·@st로만)';
                if(!add(line)) break;
                items++;
            }
        }
        if(folded||items>=AI_EDIT_MAX_ITEMS) lines.push('… (긴 문서라 일부 요소는 생략됨)');
        return lines.join('\n');
    }
    // 서버 왕복 중 문서가 달라졌는지 확인하는 로컬 전용 지문. 서버에는 보내지 않는다.
    function aiEditRevision(){
        let h=2166136261;
        const mix=value=>{
            const s=String(value==null?'':value);
            for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); }
            h^=31; h=Math.imul(h,16777619);
        };
        mix(window._sdy.curNB&&window._sdy.curNB.id); mix((document.getElementById('edTitle')||{}).value); mix(window._sdy.doc&&window._sdy.doc.sizePreset);
        (window._sdy.doc&&window._sdy.doc.pages||[]).forEach(pg=>{
            mix(pg&&pg.id); mix(pg&&pg.__lazy);
            (pg&&pg.els||[]).forEach(el=>{
                if(!el) return;
                ['id','type','x','y','w','h','dx','dy','html','latex','locked',
                 'font','fontSize','textColor','cellBg','fontWeight','fontStyle',
                 'textDecoration','align','color','size','vAlign'].forEach(k=>mix(el[k]));
                mix(el.tbl&&JSON.stringify(el.tbl));
                if(el.type==='stroke') mix(JSON.stringify(el.pts||[]));
            });
            mix(JSON.stringify(pg&&pg.tables||[]));
        });
        return (h>>>0).toString(36);
    }
  // ── 외부 노출: sdynotes.js 에서 호출하는 번역 함수들 ──
  window.translateElement=translateElement;
  window.translateEls=translateEls;
  window.translatePageAction=translatePageAction;
  window.translateDocAction=translateDocAction;
  window.translateSelectedText=translateSelectedText;
  window.cancelTranslation=cancelTranslation;
  window.aiEditBox=aiEditBox;
  window.aiEditText=aiEditText;
  window.aiEditRevision=aiEditRevision;
  window.aiEditSnapshot=aiEditSnapshot;
  window.aiEditStrokeBox=aiEditStrokeBox;
  window.collectPageEls=collectPageEls;
  window.fitTranslated=fitTranslated;
  window.plainTextFromHtml=plainTextFromHtml;
  window.tightSelectionText=tightSelectionText;
  window.tightTextFromHtml=tightTextFromHtml;
  window.AI_EDIT_MAX_OPS=AI_EDIT_MAX_OPS;
  window.AI_EDIT_MAX_ITEMS=AI_EDIT_MAX_ITEMS;
  window.AI_EDIT_MAX_TEXT=AI_EDIT_MAX_TEXT;
  window.isTrBusy=()=>trBusy;
})();
