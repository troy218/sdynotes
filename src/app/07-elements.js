/* === src/app/07-elements.js ===
   요소 빌더 · 형광펜 레이어 · 되돌리기
   (sdynotes.js 메가 분리 · 이 파일들은 scripts/bundle-frontend.mjs 가 순서대로 이어 붙인다.
    let/const 스코프를 공유하려면 반드시 concat 되어야 한다 — 단독 <script> 로드 금지) */
/* APP-PART:07-elements.js:BEGIN */
    // ============ 요소 빌더 ============
    function findEl(pageIdx,id){ return (doc.pages[pageIdx].els||[]).find(e=>e.id===id); }

    function tidyLatex(src){
        let t=String(src||'');
        t=t.replace(/\u2032/g,"'").replace(/\u2033/g,"''").replace(/\u00b4/g,"'").replace(/\u2019/g,"'");
        t=t.replace(/\^\{\s*'\s*'\s*\}/g,"''").replace(/\^\{\s*'\s*\}/g,"'");
        t=t.replace(/(\\[A-Za-z]+|[A-Za-z])\s+'\s+'(?![A-Za-z])/g,"$1''");
        t=t.replace(/([A-Za-z])\s*[\u00af]/g,"\\bar{$1}");
        t=t.replace(/\\sqrt\{\}/g,"");
        return t;
    }
    function latexHTML(src,display){
        try{
            const t=tidyLatex(src);
            if(window.katex) return katex.renderToString(t,{displayMode:!!display,
                throwOnError:false,strict:'ignore',output:'htmlAndMathml'});
        }catch(e){}
        return '<span class="latex-fallback">'+esc(String(src||''))+'</span>';
    }
    // 9.0 · 수식이 원문 잉크 상자를 얼마나 넘치는지 실제로 재서 축소 배율을 낸다.
    //  내보내기(PDF/JPG)는 화면과 달리 requestAnimationFrame 보정 기회가 없으므로,
    //  화면 밖 측정용 상자에 한 번 그려 보고 넘치는 만큼 미리 줄여서 굽는다.
    let _fitProbe=null;
    function latexFitScale(el){
        try{
            const bw=el.inkW||el.w, bh=el.inkH||el.h;
            if(!bw||!bh) return 1;
            if(!_fitProbe){
                _fitProbe=document.createElement('div');
                _fitProbe.style.cssText='position:fixed;left:-99999px;top:0;visibility:hidden;'+
                    'white-space:nowrap;pointer-events:none;z-index:-1;';
                document.body.appendChild(_fitProbe);
            }
            _fitProbe.style.fontSize=(el.fontSize||20)+'px';
            _fitProbe.style.lineHeight='1.05';
            _fitProbe.innerHTML=latexHTML(el.latex||'',!!el.displayMath);
            // Match the actual imported .latex-box, not KaTeX's default 1.21em
            // font and 1em display margins (which shrank export-only formulas).
            const k=_fitProbe.querySelector('.katex'), d=_fitProbe.querySelector('.katex-display');
            if(k){ k.style.fontSize='1em'; k.style.lineHeight='1.05'; }
            if(d) d.style.margin='0';
            const rw=Math.max(1,_fitProbe.scrollWidth), rh=Math.max(1,_fitProbe.scrollHeight);
            return Math.max(.35,Math.min(1,Math.min(bw/rw,bh/rh)));
        }catch(e){ return 1; }
    }

    function paintLatex(node,el){
        if(!node) return;
        const base=el.fontSize||20;
        node.style.fontSize=base+'px';
        node.innerHTML=latexHTML(el.latex||'',!!el.displayMath);
        // 9.0 · PDF에서 가져온 수식은 '원문 잉크 크기'를 절대 넘지 않게 줄인다.
        //  KaTeX 글꼴은 원본 PDF 글꼴보다 폭이 넓어, 예전에는 렌더 결과가
        //  상자 밖으로 삐져나가 바로 옆/아래 본문 글자와 겹쳐 보였다.
        //  imported 수식은 넘치는 만큼 글씨를 줄여 제자리에 딱 앉힌다.
        const imported=!!el.imported;
        const fit=()=>{
            if(!node.isConnected) return;
            node.style.fontSize=base+'px';
            const padW=imported?1:8, padH=imported?0:4;
            const aw=Math.max(8,(imported?(el.inkW||node.clientWidth):node.clientWidth)-padW);
            const ah=Math.max(8,(imported?(el.inkH||node.clientHeight):node.clientHeight)-padH);
            const rw=Math.max(1,node.scrollWidth), rh=Math.max(1,node.scrollHeight);
            const k=Math.min(1,aw/rw,ah/rh);
            if(k<.995) node.style.fontSize=Math.max(6,base*k)+'px';
        };
        requestAnimationFrame(fit);
        // KaTeX가 늦게 로드된 경우 한 번 더 바꿔 그리고 상자 안에 맞춘다.
        if(!window.katex) setTimeout(()=>{
            if(node.isConnected&&window.katex){ node.innerHTML=latexHTML(el.latex||'',!!el.displayMath); requestAnimationFrame(fit); }
        },500);
    }
    let latexEditing=null, _latexAnchor=null;
    function openLatexModal(id,pi){
        latexEditing=null; _latexAnchor=null;
        cancelPlaceMode();
        let src='E = mc^2', display=true;
        if(id!=null&&pi!=null){
            const el=findEl(+pi,id);
            if(el&&el.type==='latex'){ latexEditing={id,pageIdx:+pi}; src=el.latex||''; display=!!el.displayMath; }
        }
        document.getElementById('latexInput').value=src;
        document.getElementById('latexDisplay').checked=display;
        document.querySelector('#latexModal .latex-modal-actions .primary').innerHTML=
            latexEditing?'<i class="ri-check-line"></i> 적용':'<i class="ri-add-line"></i> 넣기';
        document.getElementById('latexModal').style.display='flex';
        previewLatex(); openNav(closeLatexModal);
        setTimeout(()=>{ const i=document.getElementById('latexInput');i.focus();i.select(); },60);
    }
    function closeLatexModal(){
        document.getElementById('latexModal').style.display='none'; latexEditing=null; navDrop(closeLatexModal);
    }
    function setLatexExample(v){ document.getElementById('latexInput').value=v; previewLatex(); }
    function previewLatex(){
        const p=document.getElementById('latexPreview'), src=document.getElementById('latexInput').value.trim();
        if(!src){ p.textContent='수식을 입력하면 여기에 미리 보입니다.'; return; }
        p.innerHTML=latexHTML(src,document.getElementById('latexDisplay').checked);
    }
    function saveLatexElement(){
        if(!doc) return;
        const src=document.getElementById('latexInput').value.trim();
        if(!src){ toast('LaTeX 수식을 입력해 주세요',1500); return; }
        const display=document.getElementById('latexDisplay').checked;
        // ① 기존 수식 수정 — 자리 그대로
        if(latexEditing){
            pushHistory();
            const pi=latexEditing.pageIdx, el=findEl(pi,latexEditing.id);
            if(!el){ closeLatexModal(); return; }
            el.latex=src; el.displayMath=display?1:0; el.fontSize=el.fontSize||20;
            closeLatexModal();
            if(renderedPages.has(pi)) renderPageEls(pi);
            markPageEdited(pi); saveDoc(); toast('수식을 수정했습니다',1300);
            return;
        }
        // ② 우클릭 '수식 넣기' — 눌렀던 바로 그 지점(문서 좌표)에
        const anchor=_latexAnchor; _latexAnchor=null;
        closeLatexModal();
        if(anchor&&doc.pages[anchor.pageIdx]){
            const w=display?400:230, h=display?82:48;
            pushHistory();
            const c=clampEl(anchor.x-w/2,anchor.y-h/2,w,h);
            doc.pages[anchor.pageIdx].els.push({type:'latex',id:uid('m'),latex:src,
                x:Math.round(c.x),y:Math.round(c.y),w,h,
                fontSize:display?22:18,displayMath:display?1:0});
            if(renderedPages.has(anchor.pageIdx)) renderPageEls(anchor.pageIdx);
            markPageEdited(anchor.pageIdx); saveDoc(); toast('수식을 넣었습니다',1300);
            return;
        }
        // ③ 도구막대 '수식 넣기' — 상자·표처럼 고스트를 보여 주고 누른 자리에 넣는다.
        //    예전엔 '마우스가 마지막으로 스쳐 간 자리'에 들어가 커서와 어긋나 보였다.
        beginLatexPlacement(src,display);
    }

    function buildLatexEl(el,pageIdx){
        const w=document.createElement('div');
        w.className='tb latex-box'+(el.displayMath?' display-math':'')+(el.imported?' imported':'');
        w.dataset.id=el.id; w.dataset.pageIdx=pageIdx;
        w.style.cssText=`left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;`;
        applyBoxRotation(w,el);
        const c=document.createElement('div'); c.className='latex-content';
        paintLatex(c,el); w.appendChild(c);
        // 가져온 수식은 위치 보호만 유지하고 자물쇠 배지는 표시하지 않는다.
        if(el.locked) w.classList.add('el-lock');
        c.addEventListener('dblclick',e=>{ e.preventDefault();e.stopPropagation();openLatexModal(el.id,pageIdx); });
        const eb=document.createElement('button'); eb.className='latex-edit';
        eb.innerHTML='<i class="ri-function-line"></i> 편집';
        eb.addEventListener('pointerdown',e=>e.stopPropagation());
        eb.addEventListener('click',e=>{e.stopPropagation();openLatexModal(el.id,pageIdx);});
        w.appendChild(eb);
        // 22.1 · 테두리·손잡이는 수식을 고를 때 만든다 (글상자와 같은 규칙).
        return w;
    }

    window.addEventListener('load',()=>{
        if(!window.katex) return;
        try{
            document.querySelectorAll('.latex-box').forEach(w=>{
                const el=findEl(+w.dataset.pageIdx,w.dataset.id); if(el) paintLatex(w.querySelector('.latex-content'),el);
            });
            document.querySelectorAll('#noteGrid .note-card').forEach(c=>{
                const f=c.querySelector('.note-preview-frame');
                if(f&&f.querySelector('.latex-fallback')){ delete f.dataset.done; c._render&&c._render(); }
            });
        }catch(e){}
    });

    // 18.13 성능 — 이미지 한 장당 테두리 4 + 손잡이 8 = 13개 노드가 그릴 때마다
    //   생겼다. 그림이 많은 가져온 문서에서 이 노드 폭증이 렌더·레이아웃 비용을
    //   크게 키웠다. 테두리·손잡이는 '선택했을 때'에만 보이므로(display:none),
    //   지금은 선택되는 순간에 한 번만 붙인다(_ensureImgControls).
    function _ensureImgControls(im){
        if(!im||im._ctl) return im;
        im._ctl=1;
        ['top','bottom','left','right'].forEach(side=>{
            const eg=document.createElement('div');
            eg.className='tb-edge '+side; eg.title='끌어서 이동';
            im.appendChild(eg);
        });
        ['h-nw','h-ne','h-sw','h-se','h-n','h-s','h-w','h-e'].forEach(c=>{
            const h=document.createElement('div'); h.className='handle '+c; h.dataset.dir=c; im.appendChild(h);
        });
        return im;
    }
    // 22.1 · 글상자(·수식)의 테두리/손잡이도 이미지와 같은 방식으로 늦게 만든다.
    //   쪽당 글상자가 수백 개인 논문에서 이 두 종류 장식이 요소 수를 13배로
    //   늘렸다(상자당 테두리 4 + 손잡이 8 = 12개). CSS 는 이미 '고른 상자와
    //   편집 중인 상자'에만 보이도록(.tb.sel/.edit) 규정하고, 히트 테스트도 그
    //   상자를 건드릴 때만 의미를 갖는다 → 선택되는 순간에 만들면 된다.
    //   (표 칸은 손잡이를 쓰지 않는다 — .tb.in-tbl .handle{display:none!important})
    function _ensureTbControls(w){
        if(!w||w._ctl) return w;
        // SVG 안(그려진 획·stroke-g)에 HTML 장식을 넣지 않는다. (안전망)
        try{ if(w.namespaceURI&&w.namespaceURI!=='http://www.w3.org/1999/xhtml') { w._ctl=1; return w; } }catch(e){}
        w._ctl=1;
        if(w.classList.contains('in-tbl')) return w;
        ['top','bottom','left','right'].forEach(side=>{
            const eg=document.createElement('div');
            eg.className='tb-edge '+side; eg.title='끌어서 이동';
            w.appendChild(eg);
        });
        ['h-nw','h-ne','h-sw','h-se','h-n','h-s','h-w','h-e'].forEach(cls=>{
            const h=document.createElement('div');
            h.className='handle '+cls; h.dataset.dir=cls;
            w.appendChild(h);
        });
        return w;
    }
    function buildImageEl(el,pageIdx){
        const w=document.createElement('div');
        w.className='paper-img'; w.dataset.id=el.id; w.dataset.pageIdx=pageIdx;
        w.style.cssText=`left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;`;
        applyBoxRotation(w,el);
        const img=document.createElement('img');
        img.draggable=false;
        img.loading='lazy'; img.decoding='async';
        // 이미지 저장 방식 v3(업로드-선행): 새 요소는 태어날 때부터 확정 서버
        // URL(/api/img/…)만 갖는다. 아래의 data: 폴백은 옛 저장물(레거시)
        // 렌더 호환용이다. blob: 은 그 문서에서만 유효하므로 절대 쓰지 않는다.
        const remoteSrc=String(el.url||'');
        const localSrc=String(el.localURL||'');
        const bestSrc=(remoteSrc&&!/^blob:/i.test(remoteSrc))
            ? remoteSrc
            : (localSrc&&!/^blob:/i.test(localSrc)?localSrc:'');
        img.src=bestSrc;
        if(el.pending && !remoteSrc) w.classList.add('pending');
        if(el.failed) w.classList.add('failed');
        if(el.isMath){ w.classList.add('math'); w.title='PDF 수식'; }
        if(el.isBg){ w.classList.add('pdf-bg'); w.title='PDF 원본 배경'; }
        if(el.locked) w.classList.add('el-lock');
        // ★ 14.28.1 · 그림을 더블클릭하면 주변이 싹 사라지는 확대 뷰어로 들어가던 동작을 없앤다.
        //   그림은 한 번 눌러 선택 → 테두리/손잡이가 뜬 상태에서 바로 이동·크기 조절한다.
        //   (크게 보기는 우클릭 메뉴의 '크게 보기'나 스페이스바 등 별도 동작으로만 열리게 한다.)
        w.appendChild(img);
        // ★ 18.13 · 테두리·손잡이는 선택 순간 _ensureImgControls 가 한 번만 붙인다.
        // 비율 고정 배지와 X 버튼은 없앤다.
        //  · 비율 고정 전환 → 우클릭 메뉴
        //  · 삭제 → Delete 키
        return w;
    }

    function normalizedRotation(v){
        let n=Number(v)||0;
        n=((n+180)%360+360)%360-180;
        return Math.abs(n)<0.01?0:Math.round(n*10)/10;
    }
    function applyBoxRotation(node,el){
        const a=normalizedRotation(el&&el.rotation);
        node.style.transform=a?`rotate(${a}deg)`:'';
        node.style.transformOrigin='50% 50%';
    }
    function strokeTransform(el){
        const dx=Number(el&&el.dx)||0, dy=Number(el&&el.dy)||0;
        const a=normalizedRotation(el&&el.rotation);
        let tr=(dx||dy)?`translate(${dx} ${dy})`:'';
        if(a){
            const bb=strokeBBox(el), cx=Math.round((bb.x+bb.w/2)*10)/10, cy=Math.round((bb.y+bb.h/2)*10)/10;
            tr+=(tr?' ':'')+`rotate(${a} ${cx} ${cy})`;
        }
        return tr;
    }
    function buildStrokeFillEl(el,pageIdx){
        const p=document.createElementNS('http://www.w3.org/2000/svg','path');
        p.setAttribute('class','stroke-fill'); p.dataset.for=el.id; p.dataset.pageIdx=pageIdx;
        p.setAttribute('d',strokePath(el.pts,el.sharp&&!isEllipsePts(el.pts)));
        p.setAttribute('fill',_classicPaletteColor('draw',el.fillColor));
        p.setAttribute('fill-opacity',el.fillOpacity==null?0.58:el.fillOpacity);
        p.setAttribute('fill-rule','evenodd');
        const tr=strokeTransform(el); if(tr) p.setAttribute('transform',tr);
        return p;
    }
    function syncStrokeTransform(el,node,pageIdx){
        const tr=strokeTransform(el);
        if(node){ if(tr) node.setAttribute('transform',tr); else node.removeAttribute('transform'); }
        const f=paperQ(pageIdx,`.stroke-fill[data-for="${el.id}"]`);
        if(f){ if(tr) f.setAttribute('transform',tr); else f.removeAttribute('transform'); }
    }

    // 펜 획: 얇은 선만 정확히 잡히도록 hit 영역을 선 두께 기반으로 좁게 잡는다
    function buildStrokeEl(el,pageIdx){
        const g=document.createElementNS('http://www.w3.org/2000/svg','g');
        g.setAttribute('class','stroke-g'); g.dataset.id=el.id; g.dataset.pageIdx=pageIdx;
        const d=strokePath(el.pts,el.sharp&&!isEllipsePts(el.pts));
        const halo=document.createElementNS('http://www.w3.org/2000/svg','path');
        halo.setAttribute('class','stroke-halo'); halo.setAttribute('d',d);
        halo.setAttribute('stroke-width',(el.size||2)+8);
        halo.setAttribute('stroke-linecap','round'); halo.setAttribute('stroke-linejoin','round');
        const vis=document.createElementNS('http://www.w3.org/2000/svg','path');
        vis.setAttribute('class','stroke-vis'); vis.setAttribute('d',d);
        vis.setAttribute('fill','none'); vis.setAttribute('stroke',_classicPaletteColor('draw',el.color));
        vis.setAttribute('stroke-width',el.size);
        if(el.opacity!=null) vis.setAttribute('stroke-opacity',el.opacity);
        vis.setAttribute('stroke-linecap','round'); vis.setAttribute('stroke-linejoin','round');
        const hit=document.createElementNS('http://www.w3.org/2000/svg','path');
        hit.setAttribute('class','stroke-hit'); hit.setAttribute('d',d);
        // 획 두께 + 6px 정도만 → 뒤 요소를 가리지 않음
        hit.setAttribute('stroke-width',Math.max(8,(el.size||2)+6));
        hit.setAttribute('stroke-linecap','round'); hit.setAttribute('stroke-linejoin','round');
        g.appendChild(halo); g.appendChild(vis); g.appendChild(hit);
        const tr=strokeTransform(el); if(tr) g.setAttribute('transform',tr);
        return g;
    }

    // PDF 등에서 가져온 글상자용.
    // 원본 글꼴이 없으면 글자 폭이 달라져 넘치거나 남는다.
    // → 상자 위치·크기는 그대로 두고, 글씨 크기만 키우거나 줄여
    //   오른쪽 끝까지 꽉 차게 맞춘다.
    function fitTextToBox(w,c,el){
        const run=()=>{
            const bw=el.w, bh=el.h;
            if(!bw||!bh) return;
            const txt=(c.innerText||'').trim();
            if(!txt) return;

            // 가져온 본문: 원본 크기를 그대로 쓰되 넘칠 때만 조금 줄인다.
            // (제목·그림 설명이 작아지지 않게)
            if(el.fitDown){
                let px=Math.max(5,el.fontSize||14);
                c.style.letterSpacing='';
                c.style.fontSize=px+'px';
                let guard=0;
                // 단어 상자(tight)는 세로를 무시하고 가로 넘침만 막는다.
                // → 브라우저 글꼴이 더 넓어도 옆 단어와 절대 겹치지 않는다.
                const over=()=> el.tight
                    ? c.scrollWidth>c.clientWidth+1
                    : (c.scrollWidth>c.clientWidth || c.scrollHeight>c.clientHeight);
                while(guard++<24 && px>5 && over()){
                    px=Math.round((px-0.5)*10)/10;
                    c.style.fontSize=px+'px';
                }
                el.fitSize=px; el.fitLS='';
                return;
            }

            // 표 칸: 원본 글씨 크기에서 시작해, 칸을 넘치면 줄이기만 한다.
            if(el.fitCell){
                let px=Math.max(5,el.fontSize||12);
                c.style.letterSpacing='';
                c.style.lineHeight='1.15';
                c.style.fontSize=px+'px';
                // 안쪽 여백까지 감안한 실제 표시 영역을 기준으로 맞춘다
                const fits=()=>c.scrollWidth<=c.clientWidth
                             && c.scrollHeight<=c.clientHeight;
                let guard=0;
                while(guard++<40 && px>4 && !fits()){
                    px=Math.round((px-0.5)*10)/10;
                    c.style.fontSize=px+'px';
                }
                // 그래도 세로가 넘치면 줄 간격을 더 좁힌다 (여러 줄 칸)
                let lh=1.15;
                while(lh>0.85 && !fits()){
                    lh=Math.round((lh-0.05)*100)/100;
                    c.style.lineHeight=String(lh);
                }
                el.fitSize=px; el.fitLS=''; el.fitLH=lh;
                return;
            }

            // 한 줄짜리는 가로로 꽉 차게, 여러 줄은 넘치지 않는 최대 크기로
            const oneLine = !/\n/.test(c.innerText) && !c.querySelector('br');
            const over=(px)=>{
                c.style.fontSize=px+'px';
                return c.scrollWidth>bw+1 || c.scrollHeight>bh+1;
            };

            let lo=4, hi=Math.max(6,(el.fontSize||16)*3);
            // 이분법으로 '넘치지 않는 가장 큰 크기'를 찾는다
            for(let i=0;i<22 && hi-lo>0.2;i++){
                const mid=(lo+hi)/2;
                if(over(mid)) hi=mid; else lo=mid;
            }
            let best=Math.max(4,Math.floor(lo*10)/10);
            c.style.fontSize=best+'px';

            // 한 줄인데 아직 오른쪽이 남으면 자간으로 끝까지 채운다
            c.style.letterSpacing='';
            if(oneLine && c.scrollWidth>0){
                const gap=bw-c.scrollWidth;
                const n=Math.max(1,txt.length-1);
                if(gap>2 && gap/n<2.2) c.style.letterSpacing=(gap/n).toFixed(2)+'px';
            }
            el.fitSize=best;
            el.fitLS=c.style.letterSpacing||'';
        };
        if(el.fitSize){
            c.style.fontSize=el.fitSize+'px';
            if(el.fitLS) c.style.letterSpacing=el.fitLS;
            if(el.fitLH) c.style.lineHeight=String(el.fitLH);
            return;
        }
        requestAnimationFrame(run);
    }

    // ===== 가져온 텍스트 자동 안겹침 + 간격 조절 =====
    // 브라우저 글꼴이 PDF 글꼴보다 넓게 그려져도 다음 단어 자리를 침범하지 않게
    // 자간(약간 넘칠 때) 또는 글자 크기(많이 넘칠 때)를 자동 압축한다.
    //
    // 단어 맞춤은 표시 작업이다. 읽기/편집 전환 중 원문·동기화 해시를 쓰지 않는다.
    // 모든 폭을 먼저 읽고, 그 다음 스타일을 쓴다. 단어마다 read→write 를 섞으면
    // 36문단/2160단어에서 강제 레이아웃이 2천 번 발생해 한 프레임이 수 초 멎는다.
    const _tightFitCache=new WeakMap();
    let _tightFontEpoch=0;
    let _scrollUntil=0;
    function _isScrolling(){ return Date.now()<_scrollUntil; }
    function _markScrolling(ms){ _scrollUntil=Math.max(_scrollUntil,Date.now()+(ms||250)); }
    const _tightQueue=new Map();             // content → resumable job
    let _tightRaf=0, _tightWait=0;
    function _tightKey(el){
        return [el.w,el.h,el.fontSize,el.font,el.fontWeight,el.fontStyle,
            el.ls,el.wsp,el.lg,_fontState(),_tightFontEpoch].join('|');
    }
    function _queueTightFit(c,el){
        if(!c||!el) return;
        const old=_tightQueue.get(c), key=_tightKey(el);
        if(!old||old.el!==el||old.html!==el.html||old.key!==key)
            _tightQueue.set(c,{c,el,html:el.html,key,readAt:0,fit:null});
        if(!_tightRaf&&!_tightWait) _tightRaf=requestAnimationFrame(_drainTightQueue);
    }
    function _dropPageTightFits(paper){
        const layer=paper&&paper.querySelector('.layer-text');
        if(layer) for(const w of layer.children){
            const c=w.querySelector('.tb-content');
            if(c) _tightQueue.delete(c);
        }
    }
    function _tightFitLive(c,el){
        const w=c&&c.parentElement;
        return !!(w&&w.isConnected&&!w.classList.contains('edit')
            &&w._sdyRv===(doc&&doc.__rv)&&findEl(+w.dataset.pageIdx,w.dataset.id)===el);
    }
    function _drainTightQueue(){
        _tightRaf=0;
        if(!_tightQueue.size) return;
        if(_isScrolling()||_pageRenderJobs.size){
            _tightWait=setTimeout(()=>{ _tightWait=0; _queueTightDrain(); },80);
            return;
        }
        const until=performance.now()+5;
        // 한 프레임은 읽기 또는 쓰기만 한다. 한 문단 안에서도 재개 가능해야
        // 수천 단어짜리 단일 상자가 '상자 수 예산'을 뚫지 못한다.
        const writing=Array.from(_tightQueue.values()).some(j=>j.fit);
        let writes=0;
        for(const [c,job] of _tightQueue){
            const el=job.el;
            if(!_tightFitLive(c,el)||job.html!==el.html||job.key!==_tightKey(el)){
                _tightQueue.delete(c); continue;
            }
            if(writing){
                if(!job.fit) continue;
                const before=job.fit.writeAt||0;
                const done=_applyTightFit(job.fit,until,80-writes);
                writes+=(job.fit.writeAt||0)-before;
                if(done) _tightQueue.delete(c);
                if(writes>=80) break;       // 다음 페인트의 스타일 계산량도 제한
            }else{
                const fit=_measureTightSpans(c,el,job,until);
                if(fit===null) _tightQueue.delete(c);
                else if(fit) job.fit=fit;
            }
            if(performance.now()>=until) break;
        }
        if(_tightQueue.size) _queueTightDrain();
    }
    function _queueTightDrain(){
        if(_tightQueue.size&&!_tightRaf) _tightRaf=requestAnimationFrame(_drainTightQueue);
    }
    function _fontState(){
        try{ if(document.fonts&&document.fonts.status==='loading') return 'P'; }catch(e){}
        return 'L';
    }
    function _tightFitHit(c,el){
        const rec=_tightFitCache.get(el);
        return rec&&rec.html===el.html&&rec.w===(el.w||0)&&rec.h===(el.h||0)
            &&rec.fs===(el.fontSize||0)&&rec.font===el.font&&rec.weight===el.fontWeight&&rec.style===el.fontStyle
            &&rec.ls===(el.ls||0)&&rec.wsp===(el.wsp||0)&&rec.lg===(el.lg||1)
            &&rec.fonts===_fontState()&&rec.epoch===_tightFontEpoch?rec:null;
    }
    let _pdfMeasureCtx;
    const _pdfBaselineMetrics=new Map();
    function _pdfSpanMetrics(s,c,fs){
        try{
            // Inline edits/highlights can introduce mixed fonts inside a run.
            // Canvas with ONE font is only exact for the original flat markup.
            if(s.children&&Array.from(s.children).some(n=>!n.classList.contains('zsp'))) return null;
            _pdfMeasureCtx=_pdfMeasureCtx||document.createElement('canvas').getContext('2d');
            if(!_pdfMeasureCtx) return null;
            const font=[s.style.fontStyle||c.style.fontStyle||'normal',s.style.fontWeight||c.style.fontWeight||'400',fs+'px',
                s.style.fontFamily||c.style.fontFamily].join(' ');
            const ctx=_pdfMeasureCtx; ctx.font=font;
            // The zero-width copy/search spacer must not participate in width.
            const text=(s.textContent||'').trimEnd(), measured=ctx.measureText(text);
            let baseline=_pdfBaselineMetrics.get(font);
            if(baseline==null){
                const fm=ctx.measureText('Hg');
                baseline=Number.isFinite(fm.fontBoundingBoxAscent)&&Number.isFinite(fm.fontBoundingBoxDescent)
                    ?(fs+fm.fontBoundingBoxAscent-fm.fontBoundingBoxDescent)/2:fs*.8;
                _pdfBaselineMetrics.set(font,baseline);
            }
            const ls=parseFloat(c.style.letterSpacing)||0;
            return {w:measured.width+Math.max(0,text.length-1)*ls,baseline};
        }catch(e){ return null; }
    }
    function _measureTightSpans(c,el,job,until){
        job=job||{readAt:0}; until=until==null?Infinity:until;
        if(!job.sps){
            job.sps=Array.from(c.children).filter(s=>s.tagName==='SPAN');
            const cached=_tightFitHit(c,el);
            if(cached&&cached.transforms.length===job.sps.length)
                return {c,el,sps:job.sps,rec:cached,writeAt:0};
            job.cw=c.clientWidth; job.ch=c.clientHeight;
            if(!job.cw&&!job.ch) return null;
            job.groups=new Map(); job.maxR=0; job.maxB=0;
        }
        const sps=job.sps;
        while(job.readAt<sps.length){
            const i=job.readAt++, s=sps[i];
            const m={i,x:parseFloat(s.style.left)||0,y:parseFloat(s.dataset.origTop||s.style.top)||0,w:s.scrollWidth,h:s.offsetHeight,
                fs:parseFloat(s.dataset.fs)||parseFloat(s.style.fontSize)||14,
                pdfW:parseFloat(s.dataset.pdfW),pdfBase:parseFloat(s.dataset.pdfBase)};
            if(m.pdfW>0&&Number.isFinite(m.pdfBase)){
                m.fs=parseFloat(s.style.fontSize)||parseFloat(c.style.fontSize)||m.fs;
                const metrics=_pdfSpanMetrics(s,c,m.fs);
                if(metrics&&metrics.w>0){ m.w=metrics.w; m.baseline=metrics.baseline; }
                else{
                    // Respect actually rendered nested styles. Undo our previous
                    // scale, and the page/UI zoom, for a fractional natural width.
                    m.baseline=null;
                    try{
                        if(!job.pxScale){
                            const css=getComputedStyle(c).width;
                            const cw=css.endsWith('px')?parseFloat(css):c.clientWidth;
                            job.pxScale=c.getBoundingClientRect().width/cw||1;
                        }
                        const match=(s.style.transform||'').match(/scaleX\(([^)]+)\)/);
                        const sx=match?Math.abs(parseFloat(match[1]))||1:1;
                        const natural=s.getBoundingClientRect().width/job.pxScale/sx;
                        if(natural>0) m.w=natural;
                    }catch(e){}
                }
            }
            if(!job.groups.has(m.y)) job.groups.set(m.y,[]);
            job.groups.get(m.y).push(m);
            job.maxR=Math.max(job.maxR,m.x+m.w); job.maxB=Math.max(job.maxB,m.y+m.h);
            if(performance.now()>=until) return;   // 다음 프레임에서 이 단어 다음부터
        }
        if(!job.rows){
            job.rows=Array.from(job.groups.values()); job.rowAt=0;
            job.transforms=new Array(sps.length).fill(null);
            job.tops=new Array(sps.length).fill(null);
        }
        while(job.rowAt<job.rows.length){
            const group=job.rows[job.rowAt++];
            group.sort((a,b)=>a.x-b.x);
            group.forEach((m,i)=>{
                if(m.pdfW>0&&Number.isFinite(m.pdfBase)){
                    // PDF already specifies each run's exact advance and baseline.
                    // Fit justified runs too; never impose an 84% compression floor.
                    job.transforms[m.i]=m.w>0?'scaleX('+(m.pdfW/m.w).toFixed(5)+')':'';
                    if(m.baseline!=null) job.tops[m.i]=+(m.pdfBase-m.baseline).toFixed(3);
                    return;
                }
                const next=group[i+1], avail=(next?next.x:job.cw)-m.x-0.5;
                const space=Math.max(1,m.fs*0.12);
                job.transforms[m.i]=m.w>avail-space&&m.w>0
                    ?'scaleX('+Math.max(0.01,(avail-space)/m.w).toFixed(4)+')':'';
            });
            if(performance.now()>=until) return;
        }
        return {c,el,sps,writeAt:0,rec:{html:el.html,w:el.w||0,h:el.h||0,fs:el.fontSize||0,
            font:el.font,weight:el.fontWeight,style:el.fontStyle,epoch:_tightFontEpoch,
            ls:el.ls||0,wsp:el.wsp||0,lg:el.lg||1,fonts:_fontState(),transforms:job.transforms,tops:job.tops,
            growR:!el.pdfText&&job.maxR>job.cw?job.maxR:0,growB:!el.pdfText&&job.maxB>job.ch?job.maxB:0}};
    }
    function _applyTightFit(fit,until,max){
        const {c,el,sps,rec}=fit;
        if(!_tightFitLive(c,el)||el.html!==rec.html) return true;
        const w=c.parentElement;
        until=until==null?Infinity:until; max=max==null?Infinity:max;
        let count=0;
        while((fit.writeAt||0)<sps.length&&count<max){
            const i=fit.writeAt||0, s=sps[i], v=rec.transforms[i];
            fit.writeAt=i+1; count++;
            if(rec.tops&&rec.tops[i]!=null){
                const baseTop=rec.tops[i];
                const t0=(rec.tops&&rec.tops.length)?Math.min(...rec.tops.filter(x=>x!=null)):0;
                const scaledTop=(el.lg&&Math.abs(el.lg-1)>0.001)?(t0+(baseTop-t0)*el.lg):baseTop;
                s.style.top=scaledTop.toFixed(3)+'px';
            }
            if(v!==null){
                if(s.style.transform!==v) s.style.transform=v;
                if(v&&s.style.transformOrigin!=='left center') s.style.transformOrigin='left center';
                if(s.style.letterSpacing) s.style.letterSpacing='';
            }
            if(performance.now()>=until) break;
        }
        const done=(fit.writeAt||0)>=sps.length;
        if(done){
            if(rec.growR>0){ c.style.width=rec.growR+'px'; w.style.width=rec.growR+'px'; }
            if(rec.growB>0){ c.style.height=rec.growB+'px'; w.style.height=rec.growB+'px'; }
            _tightFitCache.set(el,rec);
        }
        // 도중에 사용자가 편집해도 지금까지의 표시용 변화는 원문 수정이 아니다.
        w._sdyViewHtml=c.innerHTML;
        return done;
    }
    function fitTightSpans(c,el){
        if(!_tightFitLive(c,el)) return;
        const rec=_measureTightSpans(c,el);
        if(rec) _applyTightFit(rec);
    }

    try{ if(document.fonts&&document.fonts.addEventListener) document.fonts.addEventListener('loadingdone',()=>{
        _tightFontEpoch++;
        _pdfBaselineMetrics.clear();
        mountedShells.forEach(wrap=>{
            const layer=wrap.querySelector('.layer-text');
            if(!layer) return;
            for(const w of layer.children){
                if(!w.classList.contains('tight')) continue;
                const c=w.querySelector('.tb-content'), el=findEl(+w.dataset.pageIdx,w.dataset.id);
                if(c&&el) _queueTightFit(c,el);
            }
        });
    }); }catch(e){}

    function tightAdj(kind,delta){
        const w=document.querySelector('#pagesStage .tb.sel.tight');
        if(!w) return;
        const el=findEl(+w.dataset.pageIdx,w.dataset.id);
        if(!el) return;
        pushHistory();
        if(kind==='ls')   el.ls=Math.max(-2,Math.min(3,+(((el.ls||0)+delta).toFixed(2))));
        if(kind==='wsp')  el.wsp=Math.max(0,Math.min(12,+(((el.wsp||0)+delta).toFixed(1))));
        if(kind==='lg')   el.lg=Math.max(0.7,Math.min(1.8,+(((el.lg||1)+delta).toFixed(2))));
        if(kind==='reset'){ delete el.ls; delete el.wsp; delete el.lg; }
        const nw=buildTextEl(el,+w.dataset.pageIdx);
        w.replaceWith(nw); nw.classList.add('sel'); _ensureTbControls(nw);
        markPageEdited(+w.dataset.pageIdx); updateTightBar(); saveDoc();
    }

    // 9.3 · 자간/줄간 막대는 없앴다. (상자를 고를 때마다 떠서 방해가 됐다)
    //  el.ls / el.wsp / el.lg 값 자체는 그대로 읽고 그리므로,
    //  예전에 조절해 둔 문서도 보이는 모습은 변하지 않는다.
    function updateTightBar(){
        const bar=document.getElementById('tightBar');
        if(bar) bar.classList.remove('show');
    }

    // 저장 포맷의 글자 단위 속성을 실제 브라우저 스타일로 디코드한다.
    // data-* 포맷은 협업/구버전 저장물에서 들어올 수 있고, 기존 HTML style과
    // 함께 있을 때는 명시적인 data 값이 우선한다. 문자열을 직접 치환하지 않고
    // DOM에서 처리해 한 글자씩 나뉜 span, 링크, 줄바꿈을 훼손하지 않는다.
    // 이 표식이 하나도 없는 html 은 풀어낼 것이 없다 → DOM 파싱을 건너뛴다.
    //   ★ 14.30.1 성능 — 가져온 논문은 글상자마다 단어 span 이 수십 개인데,
    //     대부분은 data-* 서식이나 <font> 가 전혀 없다. 그런데도 상자를 그릴
    //     때마다 html 을 DOM 으로 파싱하고 전 노드를 훑었다(열기·스크롤 공통
    //     비용 3위). 표식이 있을 때만 파싱하면 결과는 완전히 같다.
    const _DEC_RE=/data-(?:font-family|font-size|font-weight|font-style|text-color|color|highlight|background-color|text-decoration)\s*=|<font\b/i;
    function decodeTextMarkup(html){
        const src=String(html||'');
        if(!src||!_DEC_RE.test(src)) return src;
        const box=document.createElement('div');
        box.innerHTML=src;
        const props={
            'data-font-family':'fontFamily','data-font-size':'fontSize',
            'data-font-weight':'fontWeight','data-font-style':'fontStyle',
            'data-text-color':'color','data-color':'color',
            'data-highlight':'backgroundColor','data-background-color':'backgroundColor',
            'data-text-decoration':'textDecoration'
        };
        box.querySelectorAll('*').forEach(node=>{
            for(const attr in props){
                if(!node.hasAttribute(attr)) continue;
                const value=node.getAttribute(attr);
                if(value!=null&&value!=='') node.style[props[attr]]=value;
                node.removeAttribute(attr);
            }
            // 구형 HTML의 <font>도 글자 단위 속성으로 승격한다.
            if(node.tagName==='FONT'){
                if(node.hasAttribute('face')) node.style.fontFamily=node.getAttribute('face');
                if(node.hasAttribute('color')) node.style.color=node.getAttribute('color');
                if(node.hasAttribute('size')){
                    const n=parseFloat(node.getAttribute('size'));
                    if(n) node.style.fontSize=(n<=7?Math.round(8+n*2):n)+'px';
                }
            }
        });
        return box.innerHTML;
    }

    /* ══ 14.29.2 · 해돌이가 쓴 글 → 노트 서식 ════════════════════════════
       모델(제미나이 등)은 마크다운으로 말한다: "# 제목", "**중요어**",
       "- 목록", 그리고 문장 안에 섞인 "$수식$". 예전에는 그 표시를 글자
       그대로 넣어서
         · **중요어** 의 별표가 노트에 그대로 보였고,
         · 제목 줄이 섞이면 상자 '전체'가 크고 굵어져 본문까지 제목처럼 됐고,
         · 문장 안 수식은 $x^2$ 라는 맨 글자로 남았다(따로 적은 수식만 인식).
       이제 줄 단위로 제목과 본문을 가르고(제목 줄만 크게·굵게), 인라인은
       굵게·기울임·수식으로 옮긴다. 본문은 보통 굵기 그대로 둔다.

       ─ 저장 형식 ─ 인라인 수식은  <span class="imath" data-latex="…">$…$</span>.
         화면과 내보내기에서만 KaTeX 로 펼치고(imathFill·imathExpandHtml),
         저장할 때는 다시 접는다(imathCollapse) — 문서 데이터에는 언제나
         짧은 원문($…$)만 남아 검색·단어분석·동기화가 그대로 동작한다. */
    const AI_MD_H_FS=[30,24,20];                 // # / ## / ### 글자 크기(px)
    function imathSpan(latex){
        const src=String(latex||'').trim();
        if(!src) return '';
        return '<span class="imath" data-latex="'+esc(src).replace(/"/g,'&quot;')+'">'
             + esc('$'+src+'$')+'</span>';
    }
    /* 한 줄 안의 인라인 표시(굵게·기울임·코드·수식)를 노트 HTML 로.
       수식을 먼저 빼 두고 이스케이프하므로 수식 안의 *·_ 는 건드리지 않는다. */
    function aiMdInline(raw){
        let s=String(raw==null?'':raw);
        const math=[];
        s=s.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g,
            function(m,a,b,c,d){
                const src=String(a||b||c||d||'').trim();
                // "$5,000" 같은 돈 표기는 수식이 아니다 — 기호·글자가 있어야 수식으로 본다
                if(!src||!/[\\^_{}=+\-*/<>a-zA-Z]/.test(src)) return m;
                const i=math.length; math.push(src);
                return '\u0001'+i+'\u0001';
            });
        s=esc(s);
        s=s.replace(/\*\*\*([^*\n]+?)\*\*\*/g,'<b><i>$1</i></b>');
        s=s.replace(/\*\*([^*\n]+?)\*\*/g,'<b>$1</b>');
        s=s.replace(/__([^_\n]+?)__/g,'<b>$1</b>');
        s=s.replace(/(^|[\s(\[，,])\*([^*\n]+?)\*(?=[\s)\].,!?:;]|$)/g,'$1<i>$2</i>');
        s=s.replace(/`([^`\n]+?)`/g,'$1');       // 코드 표시는 글자만 남긴다
        s=s.replace(/\u0001(\d+)\u0001/g,function(_,i){ return imathSpan(math[+i]||''); });
        return s;
    }
    /* 여러 줄 글 → 상자 HTML. 제목 줄만 크고 굵은 span 으로 감싸고,
       본문·목록은 보통 굵기로 둔다(줄바꿈은 이 앱의 저장 형식대로 <br>). */
    function aiMdToHtml(src,baseFs){
        const base=Math.max(8,Number(baseFs)||16);
        const lines=String(src==null?'':src).split('\n');
        const out=[];
        for(const raw of lines){
            const line=raw.replace(/\s+$/,'');
            const h=/^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
            if(h){
                const lv=Math.min(3,h[1].length);
                const fs=Math.max(base+2,AI_MD_H_FS[lv-1]);
                out.push('<span style="font-size:'+fs+'px;font-weight:700;">'
                    +aiMdInline(h[2].replace(/\s*#+\s*$/,''))+'</span>');
                continue;
            }
            if(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)){ out.push(''); continue; }  // 구분선은 버린다
            const li=/^(\s*)[-*+•]\s+(.*)$/.exec(line);
            if(li){ out.push(esc(li[1])+'• '+aiMdInline(li[2])); continue; }
            const ol=/^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
            if(ol){ out.push(esc(ol[1])+esc(ol[2])+'. '+aiMdInline(ol[3])); continue; }
            out.push(aiMdInline(line));
        }
        return out.join('<br>');
    }
    /* 새 상자용 — 글 전체가 제목 한 줄이면 '상자 서식'(크게·굵게·가운데)으로,
       제목+본문이 섞였으면 줄 단위 서식으로 옮긴다. */
    function aiMdBox(src,baseFs){
        const body=String(src==null?'':src);
        const lines=body.split('\n').filter(l=>l.trim());
        const one=lines.length===1?/^\s{0,3}(#{1,3})\s+(.*)$/.exec(lines[0]):null;
        if(one){
            const lv=one[1].length;
            return {html:'<b>'+aiMdInline(one[2].replace(/\s*#+\s*$/,''))+'</b>',
                    fs:AI_MD_H_FS[lv-1], bold:true, align:lv===1?'center':'', level:lv};
        }
        return {html:aiMdToHtml(body,baseFs), fs:0, bold:false, align:'', level:0};
    }
    // 높이를 어림잡을 때 쓰는 '표시를 걷어낸' 글 (제목 줄은 크니 여유를 더한다)
    function aiMdPlain(src){
        return String(src==null?'':src)
            .replace(/^\s{0,3}#{1,6}\s+/gm,'')
            .replace(/\*\*\*|\*\*|__/g,'')
            .replace(/`/g,'');
    }
    function aiMdTitleExtra(src,baseFs){
        const base=Math.max(8,Number(baseFs)||16);
        let extra=0;
        String(src==null?'':src).split('\n').forEach(function(l){
            const h=/^\s{0,3}(#{1,6})\s+\S/.exec(l);
            if(h) extra+=Math.max(0,AI_MD_H_FS[Math.min(3,h[1].length)-1]-base)*1.6;
        });
        return Math.round(extra);
    }
    /* 화면용 — 상자 안의 인라인 수식을 KaTeX 로 채운다(원문은 data-latex 에 그대로).
       KaTeX 가 아직 안 실려 있으면 몇 번만 다시 시도하고 조용히 포기한다. */
    function imathFill(root,tries){
        if(!root||!root.querySelectorAll) return;
        const list=root.querySelectorAll('span.imath[data-latex]');
        if(!list.length) return;
        if(!window.katex){
            const n=(tries||0)+1;
            if(n<=6) setTimeout(function(){ imathFill(root,n); },400);
            return;
        }
        list.forEach(function(sp){
            if(sp.getAttribute('data-imath-on')==='1') return;
            const src=sp.getAttribute('data-latex')||'';
            if(!src) return;
            try{
                sp.innerHTML=katex.renderToString(src,
                    {displayMode:false,throwOnError:false,strict:'ignore',output:'html'});
            }catch(e){ return; }
            sp.setAttribute('data-imath-on','1');
            sp.setAttribute('contenteditable','false');
        });
    }
    // 내보내기용 — HTML 문자열 안의 인라인 수식을 KaTeX 로 펼쳐 돌려준다.
    function imathExpandHtml(html){
        const s=String(html==null?'':html);
        if(s.indexOf('imath')<0||!window.katex) return s;
        const box=document.createElement('div'); box.innerHTML=s;
        box.querySelectorAll('span.imath[data-latex]').forEach(function(sp){
            try{
                sp.innerHTML=katex.renderToString(sp.getAttribute('data-latex')||'',
                    {displayMode:false,throwOnError:false,strict:'ignore',output:'html'});
            }catch(e){}
        });
        return box.innerHTML;
    }
    // 저장용 — 화면에서 펼쳐진 KaTeX 를 다시 짧은 원문($…$)으로 접는다.
    function imathCollapse(html){
        const s=String(html==null?'':html);
        if(s.indexOf('imath')<0) return s;
        const box=document.createElement('div'); box.innerHTML=s;
        box.querySelectorAll('span.imath[data-latex]').forEach(function(sp){
            sp.removeAttribute('contenteditable');
            sp.removeAttribute('data-imath-on');
            sp.textContent='$'+(sp.getAttribute('data-latex')||'')+'$';
        });
        return box.innerHTML;
    }

    // ── 14.18.2 · 부드러운 형광펜(하이라이트) 표시 레이어 ──────────────────
    // 저장 데이터·편집 엔진은 글자 span 의 background-color 를 그대로 쓴다
    // (동기화·되돌리기·툴바 판정·계약 테스트 불변). 대신 '화면 표시'만 실제
    // 레이아웃(Range.getClientRects)을 재서, 글자 크기가 섞여도 줄 단위로
    // 끊긴 연속 띠 + 둥근 끝으로 한 겹 더 그린다. 레이어는 .tb-content 바깥
    // (.tb 아래)에 두므로 el.html·서버 저장에는 절대 섞이지 않는다.
    // 레이아웃을 못 재는 환경(구형 웹뷰·테스트 DOM)에서는 레이어가 생기지
    // 않고 기존 span 배경이 그대로 폴백으로 남는다.
    const _HL_NS='http://www.w3.org/2000/svg';

    function _hlLayer(w){
        let lyr=w&&w.querySelector(':scope > .sdy-hl-layer');
        if(!lyr&&w){
            try{
                lyr=document.createElementNS(_HL_NS,'svg');
                lyr.setAttribute('class','sdy-hl-layer');
                lyr.style.cssText='position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none;z-index:-1;';
                w.appendChild(lyr);
            }catch(e){ lyr=null; }
        }
        return lyr||null;
    }
    // 글자에서 가장 가까운 span 의 배경색을 따른다. '투명' span 은 차단.
    function _hlColorOf(node,c,baseHex){
        let el=node&&(node.nodeType===3?node.parentNode:node);
        while(el&&el!==c&&el.nodeType===1){
            const v=el.style&&el.style.backgroundColor;
            if(v&&String(v).trim()){
                const h=_colorToHex(_classicPaletteColor('hl',v));
                return (h&&h!=='transparent')?h:null;
            }
            el=el.parentNode;
        }
        return baseHex||null;
    }
    // 같은 색으로 연속된 텍스트 노드 묶음
    function _hlRuns(c,baseHex){
        const runs=[]; let cur=null;
        const walker=document.createTreeWalker(c,NodeFilter.SHOW_TEXT);
        for(let n;(n=walker.nextNode());){
            const color=_hlColorOf(n,c,baseHex);
            if(color){
                if(cur&&cur.color===color) cur.nodes.push(n);
                else { cur={color:color,nodes:[n]}; runs.push(cur); }
            }else cur=null;
        }
        return runs;
    }
    // 텍스트 노드를 실제 화면 선 조각(뷰 좌표)으로 잰다
    function _hlFragRects(run){
        const out=[], range=document.createRange();
        for(const n of run.nodes){
            try{ range.selectNodeContents(n); }catch(e){ continue; }
            let rs=[];
            try{ rs=Array.from(range.getClientRects()); }catch(e){ rs=[]; }
            for(const r of rs){
                if(r&&r.width>0.3&&r.height>0.3)
                    out.push({l:r.left,t:r.top,rr:r.right,b:r.bottom,color:run.color});
            }
        }
        return out;
    }
    // 같은 줄 조각을 세로 겹침으로 묶고, 가로로 닿은 조각은 한 띠로 합친다
    function _hlBands(frags){
        const rows=[];
        for(const f of frags){
            let row=null;
            for(const r of rows){ if(f.t<r.maxT+2&&f.b>r.minT-2){ row=r; break; } }
            if(!row){ row={minT:f.t,maxT:f.b,items:[]}; rows.push(row); }
            if(f.t<row.minT) row.minT=f.t;
            if(f.b>row.maxT) row.maxT=f.b;
            row.items.push(f);
        }
        const bands=[];
        for(const row of rows){
            const items=row.items.slice().sort((a,b)=>a.l-b.l);
            let band=null;
            for(const f of items){
                if(band&&f.l-band.rr<=2.5){
                    if(f.rr>band.rr) band.rr=f.rr;
                    if(f.t<band.t) band.t=f.t;
                    if(f.b>band.b) band.b=f.b;
                }else{ band={l:f.l,t:f.t,rr:f.rr,b:f.b,color:f.color}; bands.push(band); }
            }
        }
        return bands;
    }
    // 22.1 · 형광펜 띠를 '다시 잴 가치'가 있는 상자인가?
    //   띠는 저장 HTML 과 무관한 표시 전용 레이어라, 배경색이 하나도 없는 상자는
    //   재든 아니든 결과가 '아무 것도 안 그림'이다. 글상자 수백 개인 쪽에서
    //   이 판정 하나가 레이아웃 읽기(상자 × 텍스트 노드)를 통째로 없앤다.
    //   편집 중인 상자는 글자마다 배경이 생길 수 있으니 항상 계산 대상.
    function _hlMayHave(c,w){
        try{
            if(w.classList&&w.classList.contains('edit')) return true;
            const el=(w.dataset&&w.dataset.id!=null)?findEl(+w.dataset.pageIdx,w.dataset.id):null;
            if(el&&(el.cellBg||el.hl)) return true;
            if(c.style&&c.style.backgroundColor) return true;
            return /background/i.test((el&&el.html)||'');
        }catch(e){ return true; }
    }
    // 22.1 · 웹폰트 로드는 한 번만 기다린다. 예전엔 글상자·표시 레이어마다
    //   document.fonts.ready.then(...) 을 걸어, 쪽 하나를 그릴 때 수백 개의
    //   Promise 와 그만큼의 재측정이 쌓였다. 이제 단일 구독 + 콜백 목록.
    const _fontsReadyCbs=[];
    let _fontsReadyArmed=false;
    function _onFontsReady(cb){
        try{
            if(!(document.fonts&&document.fonts.ready)){ cb(); return; }
            if(document.fonts.status!=='loading'){ cb(); return; }   // 이미 떠 있으면 즉시
            _fontsReadyCbs.push(cb);
            if(_fontsReadyArmed) return;
            _fontsReadyArmed=true;
            document.fonts.ready.then(()=>{
                _fontsReadyArmed=false;
                const list=_fontsReadyCbs.splice(0);
                list.forEach(f=>{ try{ f(); }catch(e){} });
            }).catch(()=>{ _fontsReadyArmed=false; _fontsReadyCbs.length=0; });
        }catch(e){ try{ cb(); }catch(_e){} }
    }
    function _hlSchedule(c,w){
        if(!c||!w||!c.isConnected) return;
        if(c._sdyHlT) return;
        // 22.1 · 이미 띠 레이어가 있는 상자는(지금은 배경이 없어도) 지워 주려면
        //   계산이 필요하므로 통과시킨다.
        if(!_hlMayHave(c,w)&&!(w.querySelector&&w.querySelector(':scope > .sdy-hl-layer'))) return;
        c._sdyHlT=setTimeout(()=>{ c._sdyHlT=0; try{ _hlPaint(c,w); }catch(_e){} },60);
    }
    function _hlWatch(c,w){
        if(typeof MutationObserver==='undefined'||c._sdyHlMO) return;
        const mo=new MutationObserver(()=>_hlSchedule(c,w));
        try{
            mo.observe(c,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','class']});
            c._sdyHlMO=mo;
        }catch(e){}
    }
    function _hlRepaintAll(){
        try{
            document.querySelectorAll('#pagesStage .tb').forEach(w=>{
                const c=w&&w.querySelector('.tb-content');
                if(c&&w.dataset&&w.dataset.id!=null) _hlSchedule(c,w);
            });
        }catch(_e){}
    }
    function _hlPaint(c,w){
        if(!c||!w) return;
        let baseHex='';
        try{ baseHex=_colorToHex(_classicPaletteColor('hl',(c.style&&c.style.backgroundColor)||'')); }catch(_e){}
        let frags=[];
        try{
            for(const run of _hlRuns(c,baseHex)) frags=frags.concat(_hlFragRects(run));
        }catch(e){ frags=[]; }
        if(!frags.length){
            w.classList.remove('sdy-hl-band-on');
            const old=w.querySelector(':scope > .sdy-hl-layer');
            if(old){ try{ old.remove(); }catch(_e){} }
            // 22.1 · 칠할 띠가 남지 않은 상자는 관찰도 멈춘다. (형광펜을 지운
            //   상자에서 글자마다 레이아웃을 다시 재지 않게)
            if(c._sdyHlMO){ try{ c._sdyHlMO.disconnect(); }catch(_e){} c._sdyHlMO=null; }
            return;
        }
        // 22.1 · 띠가 실제로 필요한 상자만 이때부터 관찰한다. 렌더 시점에 상자마다
        //   관찰자를 붙이던 것의 대체 — 형광펜을 방금 칠한 상자도 이 경로로
        //   관찰자가 붙으므로 서식 변경 후 재그림은 예전대로 동작한다.
        if(!c._sdyHlMO){ try{ _hlWatch(c,w); }catch(_e){} }
        // 레이아웃을 아직 못 재는 순간(숨김·폰트 로딩 전)에는 다음 사이클에서
        const crect=c.getBoundingClientRect();
        if(!crect||(!crect.width&&!crect.height)) return;
        const wrect=w.getBoundingClientRect();
        const sc=pageScreenScale(parseInt(w.dataset&&w.dataset.pageIdx,10));
        const sx=(sc&&sc.x>0)?sc.x:1, sy=(sc&&sc.y>0)?sc.y:1;
        const ox=(crect.left-wrect.left)/sx-(w.clientLeft||0);
        const oy=(crect.top-wrect.top)/sy-(w.clientTop||0);
        const lyr=_hlLayer(w);
        if(!lyr) return;
        w.classList.add('sdy-hl-band-on');
        lyr.style.cssText='position:absolute;left:'+ox+'px;top:'+oy+'px;width:1px;height:1px;overflow:visible;pointer-events:none;z-index:-1;';
        while(lyr.firstChild) lyr.removeChild(lyr.firstChild);
        const bands=_hlBands(frags);
        for(const b of bands){
            const x=(b.l-crect.left)/sx, y=(b.t-crect.top)/sy;
            const wd=(b.rr-b.l)/sx, h=(b.b-b.t)/sy;
            if(wd<=0.2||h<=0.2) continue;
            const rr=document.createElementNS(_HL_NS,'rect');
            rr.setAttribute('x',x.toFixed(2));
            rr.setAttribute('y',y.toFixed(2));
            rr.setAttribute('width',wd.toFixed(2));
            rr.setAttribute('height',h.toFixed(2));
            const rad=Math.max(1.2,Math.min(5,h*0.5));
            rr.setAttribute('rx',rad.toFixed(2));
            rr.setAttribute('ry',rad.toFixed(2));
            rr.setAttribute('fill',_classicPaletteColor('hl',b.color));
            lyr.appendChild(rr);
        }
    }
    function buildTextEl(el,pageIdx){
        const w=document.createElement('div');
        w.className='tb'; w.dataset.id=el.id; w.dataset.pageIdx=pageIdx;
        // 14.15 · 이 DOM 이 어느 노트의 그리기인지 기록 → 교체 후 남은 타이머가
        //   새 노트 doc 을 잘못 수정하지 않도록 syncTextEl 이 검증한다.
        w.dataset.nbId=(curNB&&curNB.id)||'';
        w._sdyRv=doc&&doc.__rv;
        w.style.cssText=`left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;`;
        const c=document.createElement('div');
        c.className='tb-content'; c.contentEditable='false';
        c.style.fontSize=(el.fontSize||16)+'px';
        c.style.fontFamily=fontCSS(el.font||'pretendard');
        if(el.align) c.style.textAlign=el.align;
        if(el.textColor) c.style.color=_classicPaletteColor('text',el.textColor);
        if(el.cellBg) c.style.backgroundColor=_classicPaletteColor('hl',el.cellBg);
        if(el.fontWeight) c.style.fontWeight=el.fontWeight;
        if(el.fontStyle) c.style.fontStyle=el.fontStyle;
        if(el.textDecoration) c.style.textDecoration=el.textDecoration;
        if(el.tbl){
            const va={top:'flex-start',middle:'center',bottom:'flex-end'}[el.vAlign||'middle'];
            c.style.justifyContent=va||'center';
        }
        // 18.10 · 텍스트는 상자 하나의 style 로 그리지 않고, 저장된 인라인
        // 속성을 DOM 에 다시 풀어낸다. 예전 렌더러는 HTML 문자열을 그대로 꽂은
        // 뒤 상자 style 을 먼저 적용해, 연속 서식 변경 뒤에도 화면이 마지막
        // 값만 보이거나(특히 구형 <font> 데이터) 일부 글자가 기본값으로
        // 돌아가는 경우가 있었다. decodeTextMarkup 은 각 요소의 속성을
        // 독립적으로 복원하므로 저장/재렌더링이 반복돼도 글자별 값이 유지된다.
        const _tHtml=decodeTextMarkup(_normalizePaletteHtml(el.html||''));
        c.innerHTML=_tHtml;
        // 14.29.2 · 문장 안에 섞인 $수식$ 그리기 — 수식 표식(imath)이 없으면
        //   querySelectorAll 조차 돌리지 않는다(대부분의 가져온 상자는 수식이 없다).
        if(_tHtml.indexOf('imath')>=0) imathFill(c);
        // 가져온(tight) 상자: 저장된 자간/띄어쓰기/줄간격 반영 + 자동 안겹침
        if(el.tight){
            if(el.ls) c.style.letterSpacing=el.ls+'px';
            if(el.wsp) c.style.wordSpacing=el.wsp+'px';
            if(el.lg&&Math.abs(el.lg-1)>0.001){
                const sps=Array.from(c.querySelectorAll(':scope>span'));
                if(sps.length){
                    const t0=Math.min(...sps.map(s=>parseFloat(s.dataset.origTop||s.style.top)||0));
                    sps.forEach(s=>{
                        const origTop=parseFloat(s.dataset.origTop||s.style.top)||0;
                        if(!s.dataset.origTop) s.dataset.origTop=origTop.toFixed(1);
                        s.style.top=(t0+(origTop-t0)*el.lg).toFixed(1)+'px';
                    });
                }
            }
            _queueTightFit(c,el);  // 단어 단위 재개 가능 큐; 늦은 웹폰트는 공용 loadingdone에서 갱신
        }
        // 14.14 · innerText 는 일부 환경(구형 WebView·테스트 DOM)에서 undefined.
        //   .trim() 이 그대로 터지면 텍스트 상자 전체가 안 그려져 빈 종이가 된다.
        const _tbPlain=()=>String((c.innerText!=null?c.innerText:c.textContent)||'');
        if(!String(c.textContent||'').trim()){ c.setAttribute('data-empty','true'); w.classList.add('empty'); }
        if(el.locked) w.classList.add('el-lock');
        c.addEventListener('dblclick',e=>{ e.stopPropagation(); if(pageReady(pageIdx)&&!w.classList.contains('edit')) enterEdit(w,true); });
        // 활성 캐럿 서식은 실제 입력 직전에 wrapper를 확인한다. 빈 span을 브라우저가
        // 정리했더라도 beforeinput 단계에서 복구되므로 첫 글자부터 서식이 빠지지 않는다.
        c.addEventListener('beforeinput',e=>{
            if(w.classList.contains('edit') && (!e.inputType||e.inputType.indexOf('insert')===0))
                _ensurePendingTypingSpan(c);
        });
        // beforeinput이 없는 구형 WebView용 선행 fallback (조합 중에는 keydown이 없어도
        // 표준 beforeinput이 오며, 둘 다 없는 환경은 아래 input에서 다음 글자를 복구).
        c.addEventListener('keydown',e=>{
            if(w.classList.contains('edit')&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&
               (e.key.length===1||e.key==='Enter')) _ensurePendingTypingSpan(c);
        });
        c.addEventListener('input',()=>{
            w._caretV=(w._caretV||0)+1;   // 22.1 · 실시간 캐럿 좌표 캐시를 무효화하는 신호
            if(w.classList.contains('edit')){
                commitEditSnapshot();   // 18.9 · 첫 타이핑 = 되돌리기 지점
                _armTypingCheckpoint(w);// 20.3 · 타자를 잠깐 쉬면 새 되돌리기 지점
            }
            _scriptEditUndoable=false;        // 실제 타이핑 뒤 Ctrl+Z 는 브라우저 기본 undo 를 우선
            _lastTypeT=Date.now();            // 20.3 · 앱/브라우저 undo 판정용
            const em=!_tbPlain().trim();
            if(em) c.setAttribute('data-empty','true'); else c.removeAttribute('data-empty');
            w.classList.toggle('empty',em);
            // 엔진이 입력 뒤 캐럿을 inline 밖으로 옮긴 경우 다음 입력 전에 다시 준비한다.
            if(w.classList.contains('edit')) _ensurePendingTypingSpan(c);
            clearTimeout(w._t); w._t=setTimeout(()=>{ syncTextEl(w); },300);
        });
        // 편집 상자에서 포커스를 벗어나면 즉시 반영 (자동저장 신뢰성)
        c.addEventListener('blur',()=>{
            if(w.classList.contains('edit')){
                clearTimeout(w._t);
                try{ syncTextEl(w); }catch(e){}
            }
        });
        if(el.tbl) w.classList.add('in-tbl');
        if(el.tight) w.classList.add('tight');
        if(el.pdfText) w.classList.add('pdf-text');
        w.appendChild(c);
        if(el.fit||el.fitDown) fitTextToBox(w,c,el);
        else if(el.trFit&&!el.trPending){            // 6.1: 번역 맞춤값 적용
            if(el.trLS) c.style.letterSpacing=el.trLS;
            if(el.trFW) c.style.fontWeight=el.trFW;
            if(el.trFS) c.style.fontSize=el.trFS+'px';
        }
        if(el.trPending){ fitTranslated(w,c,el); delete el.trPending; }
        // 이동 버튼과 X 버튼은 두지 않는다.
        //  · 이동 → 테두리를 잡고 끌기 (또는 Alt+드래그)
        //  · 삭제 → 선택 후 Delete 키
        // 22.1 · 테두리·손잡이는 여기서 만들지 않는다(위 _ensureTbControls).
        //   상자를 고르거나 편집에 들어가는 순간에 붙이며, 붙이는 곳은
        //   선택 경로 전부 + 아래 쪽(stage) MutationObserver 안전망이다.
        // 14.18.2 · 부드러운 형광펜 표시 레이어 — 형광펜이 있는 상자만 다시 잰다.
        //   관찰자(MutationObserver)는 띠가 실제로 그려질 때 _hlPaint 가 붙인다.
        //   웹폰트가 늦게 뜨는 경우에도 한 번 더 그린다.
        try{ _hlSchedule(c,w); }catch(_e){}
        _onFontsReady(()=>{ if(w.isConnected) _hlSchedule(c,w); });
        w._sdyViewHtml=c.innerHTML; w._sdyModelHtml=el.html;
        w._sdyModelKey=JSON.stringify(el);
        return w;
    }

    // 18.9 · 글자 입력도 '되돌리기(Ctrl+Z)' 로 되돌아가게 한다.
    //   예전에는 타이핑이 pushHistory 를 전혀 부르지 않아서, 편집을 끝내고
    //   Ctrl+Z 를 눌러도 방금 적은 글이 되돌아가지 않았다(브라우저 기본 undo 는
    //   편집 중일 때만 듣는다). 편집을 시작할 때 '적기 전' 문서를 기억해 두고,
    //   그 세션에서 처음 글자가 바뀌는 순간 한 번만 기록한다.
    //
    // ★ 22.1 · 똥컴에서 '글상자를 누르는 순간' 멈추던 핵심이 여기 있었다.
    //   예전 기록은 doc 전체 JSON.stringify — 논문처럼 쪽이 많은 문서에서
    //   편집에 들어갈 때마다 수백 KB~수십 MB 를 직렬화했고(동작이 끝나기 전까지
    //   화면이 얼음), 그 문자열을 60개까지 쌓아 두어 GC 까지 무거웠다.
    //   글자 편집이 바꿀 수 있는 것은 **그 상자 하나**뿐이므로, 그 상자의
    //   필드만 기억하는 '쪽 패치' 기록으로 바꾼다. 비용은 문서 크기(쪽 500개)가
    //   아니라 상자 크기(수백 바이트)이고, 되돌리기/다시 실행도 같은 패치로 처리한다.
    let _editSnap=null, _editSnapUsed=true;
    function histMax(){
        // 기록은 통째 직렬화(doc)라 한 장이 아주 크다. 저사양·대용량 문서에서는
        // 깊이를 줄여 기억에 붙드는 문자열 총량(= GC 부담)을 아낀다.
        try{
            if(sdyTurbo()) return 12;
            const n=(doc&&doc.pages)?doc.pages.length:0;
            return n>120?24:60;
        }catch(e){ return 60; }
    }
    // 요소의 '지금 상태' 얕은 복사 — 중첩 객체(표 셀 정보 등)만 본따서 복제한다.
    function _snapEl(el){
        const o={};
        if(!el) return o;
        for(const k in el){
            const v=el[k];
            if(typeof v==='function') continue;
            if(v&&typeof v==='object'){
                try{ o[k]=JSON.parse(JSON.stringify(v)); }catch(e){ o[k]=v; }
            }else o[k]=v;
        }
        return o;
    }
    function _editPatch(pi,id,before){ return {__sdyEdit:1,pi:+pi,id,before}; }
    // 패치를 그 상자에 입히고, 반대 방향 기록에 쓸 '바뀌기 직전 상태'를 돌려준다.
    //   remote = 그 사이 남(다른 기기·다른 탭)이 고친 요소 id 표시(20.3 계약) →
    //   남의 작업을 되돌리기가 덮어쓰지 않는다. 이미 그 상태라면 다시 그리지도 않는다.
    function _applyEditPatch(pt,remote){
        const pg=doc&&doc.pages&&doc.pages[pt.pi];
        if(!pg||!Array.isArray(pg.els)) return null;
        const el=pg.els.find(e=>e&&e.id===pt.id);
        if(!el) return null;
        if(remote&&remote.has(pt.id)) return null;
        const cur=_snapEl(el);
        let now='', want='';
        try{ now=JSON.stringify(cur); want=JSON.stringify(pt.before||{}); }catch(e){}
        if(now===want) return {cur:cur,changed:false};
        const b=pt.before||{};
        for(const k in el){ if(!(k in b)) delete el[k]; }
        for(const k in b) el[k]=b[k];
        try{ markPageEdited(pt.pi); }catch(e){}
        return {cur:cur,changed:true};
    }
    function markEditSnapshot(w){
        _editSnap=null; _editSnapUsed=true;
        try{
            if(!doc) return;
            if(!w) w=_activeEditBox();   // 20.3 · 인자 없이 불리면 '지금 편집 중인 상자'
            if(!w||!w.dataset) return;
            const pi=+w.dataset.pageIdx, id=w.dataset.id;
            if(!doc.pages||!doc.pages[pi]||id==null) return;
            const el=findEl(pi,id); if(!el) return;
            _editSnap=_editPatch(pi,id,_snapEl(el));
            _editSnapUsed=!_editSnap;
        }catch(e){ _editSnap=null; _editSnapUsed=true; }
    }
    // 20.3 · 긴 타이핑이 되돌리기 한 칸이 되지 않게, 1.2초 이상 멈추면 그때까지
    //   친 글을 하나의 되돌리기 지점으로 확정한다(워드프로세서와 같은 감각).
    //   예전에는 상자 하나를 열어 한참 쓰고 나오면 Ctrl+Z 한 번에 그 글이 통째로
    //   날아가거나(브라우저 기본 undo 가 안 듣는 환경) 아예 안 되돌아갔다.
    let _typingCkT=null;
    function _armTypingCheckpoint(w){
        clearTimeout(_typingCkT);
        _typingCkT=setTimeout(()=>{
            _typingCkT=null;
            try{
                if(!doc||!w||!w.isConnected||!w.classList.contains('edit')) return;
                syncTextEl(w);              // DOM → 문서 확정
                markEditSnapshot();         // 다음 타이핑의 '적기 전' 상태
            }catch(e){}
        },1200);
    }
    function commitEditSnapshot(){
        if(_editSnapUsed||!_editSnap) return false;
        _editSnapUsed=true;
        history.push(_histEntry(null,_editSnap));   // 22.1 · 글상자 패치 한 칸(문서 통째 아님)
        if(history.length>histMax()) history.shift();
        redoStack=[];
        _histT=Date.now();
        return true;
    }

    function syncTextEl(w){
        // 14.15 · 노트를 빠르게 바꾸거나 되돌리기로 다시 그린 뒤에 남은 타이머가
        //   새 노트/새 doc 의 같은 id 요소를 건드리지 않게 한다.
        //   - DOM 이 떨어져 있으면 무시 (다시 그린 화면은 새 타이머를 쓴다)
        //   - 속한 노트나 renderVersion 이 다르면 무시
        if(!w||!w.isConnected) return;
        if(curNB&&w.dataset.nbId&&curNB.id!==w.dataset.nbId) return;
        if(doc&&doc.__rv!=null&&w._sdyRv!=null&&doc.__rv!==w._sdyRv) return;
        const el=findEl(+w.dataset.pageIdx,w.dataset.id); if(!el) return;
        const c=w.querySelector('.tb-content'); if(!c) return;
        const viewOnly=c.innerHTML===w._sdyViewHtml;
        const html=viewOnly?el.html:imathCollapse(stripWF(c.innerHTML));
        const fs=parseFloat(c.style.fontSize)||16;
        // Formatting commands may have changed model-only fields (font, align,
        // cellBg, etc.) before calling us. Those edits still need a dirty page;
        // only a genuinely unchanged view/model pair can take the no-op path.
        if(html===el.html&&fs===el.fontSize&&w._sdyModelKey===JSON.stringify(el)) return;
        markPageEdited(+w.dataset.pageIdx);
        el.html=html; el.fontSize=fs;
        el.x=parseFloat(w.style.left)||0; el.y=parseFloat(w.style.top)||0;
        el.w=w.offsetWidth; el.h=w.offsetHeight;
        w._sdyModelHtml=el.html; w._sdyViewHtml=c.innerHTML; w._sdyModelKey=JSON.stringify(el);
        w.classList.toggle('empty',!String((c.innerText!=null?c.innerText:c.textContent)||'').trim());
        saveDoc();
    }

    let _histT=0, _lastTypeT=0, _scriptEditUndoable=false;
    // ── 20.3 · 되돌리기 재설계 ───────────────────────────────────────────────
    //  예전 문제 ①  undo 가 문서를 스냅샷으로 **통째 교체**했다. 그래서 같이
    //    편집 중이던 다른 사람이 그 사이에 적은 글·그림이 통째로 사라졌다
    //    ("여러 명이 편집하면 되돌리기가 남의 작업을 먹는다").
    //  예전 문제 ②  되돌린 뒤 reviveDocMaps 가 rehashAll 로 '이미 보낸 것' 표를
    //    현재 내용으로 새로 써 버려서, 되돌린 결과가 **서버로 전송되지 않았다**.
    //    서버에는 되돌리기 전 내용이 남아 있으니 다음 pull 이 그걸 도로 끌고 와
    //    "되돌렸는데 잠시 뒤 되살아난다 / 해돌이 작업은 되돌리기가 안 먹는다"
    //    처럼 보였다(30초 에코 가드는 글자 서식만 막아 줬다).
    //  이제 되돌리기는 doc 객체를 그대로 두고 **바뀐 요소만 골라 되돌린다**.
    //   · 스냅샷 이후 원격(다른 기기/사람)이 건드린 요소는 건드리지 않는다.
    //   · 원격이 새로 만든 요소·쪽은 지우지 않는다.
    //   · 해시 표를 유지하므로 되돌린 내용이 정상적으로 동기화된다.
    // 히스토리 한 칸 = {snap, remote:Set(원격이 건드린 요소 id), remotePages}
    //   22.1 · 글상자 한 칸 편집은 snap 대신 patch 를 담는다 — 그 상자의 '적기 전'
    //   필드뿐이라 문서 크기(쪽 500개)가 아니라 상자 크기(수백 바이트)다.
    function _histEntry(snap,patch){ return {snap:patch?null:snap,patch:patch||null,remote:new Set(),remotePages:false}; }
    // 원격 동기화가 요소를 건드리면 쌓여 있는 모든 되돌리기 지점에 표시한다.
    function histMarkRemote(id){
        if(!id) return;
        try{
            history.forEach(e=>{ if(e&&e.remote) e.remote.add(id); });
            redoStack.forEach(e=>{ if(e&&e.remote) e.remote.add(id); });
        }catch(e){}
    }
    function histMarkRemotePages(){
        try{
            history.forEach(e=>{ if(e) e.remotePages=true; });
            redoStack.forEach(e=>{ if(e) e.remotePages=true; });
        }catch(e){}
    }
    // 스냅샷 문서에 그 id 의 요소가 있는지 (쪽을 옮겼을 수도 있어 전체를 본다)
    function _snapElIds(T){
        const s=new Set();
        ((T&&T.pages)||[]).forEach(pg=>((pg&&pg.els)||[]).forEach(el=>{ if(el&&el.id) s.add(el.id); }));
        return s;
    }
    // 한 쪽 병합: 스냅샷의 요소로 되돌리되, 원격이 건드린 요소는 지금 것을 남긴다.
    function _histMergePage(livePage,tPage,remote,tIds){
        const live=(livePage.els||[]);
        const liveById=new Map(); live.forEach(el=>{ if(el&&el.id) liveById.set(el.id,el); });
        const out=[]; const done=new Set(); let changed=false;
        ((tPage&&tPage.els)||[]).forEach(tel=>{
            if(!tel||!tel.id) return;
            done.add(tel.id);
            if(remote.has(tel.id)){
                // 그 사이 남이 고친 요소 — 되돌리지 않고 지금 내용을 지킨다.
                const cur=liveById.get(tel.id);
                if(cur) out.push(cur);          // 남이 지웠으면 되살리지도 않는다
                return;
            }
            const h=JSON.stringify(tel);
            if(h!==JSON.stringify(liveById.get(tel.id))) changed=true;
            out.push(JSON.parse(h));
        });
        // 스냅샷에 없던 요소 = 그 뒤에 생긴 것. 남이 만든 것만 남긴다.
        live.forEach(el=>{
            if(!el||!el.id||done.has(el.id)) return;
            if(tIds.has(el.id)) return;          // 다른 쪽으로 옮겨간 요소는 위에서 처리됨
            if(remote.has(el.id)) out.push(el);
        });
        if(out.length!==live.length||JSON.stringify(livePage.tables||[])!==JSON.stringify((tPage&&tPage.tables)||[])) changed=true;
        if(changed&&(!tPage||tPage.__lazy==null)){ livePage.__dirty=true; livePage.edited=1; }
        livePage.els=out;
        if(tPage&&tPage.tables) livePage.tables=JSON.parse(JSON.stringify(tPage.tables));
        else if(livePage.tables) livePage.tables=[];
        if(tPage&&tPage.__lazy!=null) livePage.__lazy=tPage.__lazy; else delete livePage.__lazy;
        return livePage;
    }
    // 스냅샷을 '지금 문서 위에' 되돌려 붙인다 (doc 객체는 그대로 둔다).
    function histRestore(entry){
        if(!doc||!entry) return false;
        let T=null;
        if(!entry.snap) return false;          // 22.1 · 패치 칸은 문서 스냅샷이 없다
        try{ T=JSON.parse(entry.snap); }catch(e){ return false; }
        if(!T) return false;
        const remote=entry.remote||new Set();
        const tIds=_snapElIds(T);
        const livePages=(doc.pages||[]).slice();
        const byId=new Map(); livePages.forEach(p=>{ if(p&&p.id) byId.set(p.id,p); });
        const used=new Set(); const outPages=[];
        ((T.pages)||[]).forEach((tp,i)=>{
            if(!tp) return;
            let lp=byId.get(tp.id);
            if(!lp){
                // 그 사이 남이 지운 쪽은 되살리지 않는다 (원격 쪽 변경이 있었을 때만)
                if(entry.remotePages) return;
                lp={id:tp.id,els:[],tables:[]};
            }
            used.add(tp.id);
            outPages.push(_histMergePage(lp,tp,remote,tIds));
        });
        // 스냅샷 뒤에 생긴 쪽 — 남이 만든 것이면 지우지 않는다.
        livePages.forEach(p=>{ if(p&&!used.has(p.id)&&entry.remotePages) outPages.push(p); });
        doc.pages=outPages.length?outPages:[blankPage()];
        // 문서 수준 설정(용지·크기·이모지·용어집·즐겨찾기 쪽…)은 스냅샷 값으로
        Object.keys(T).forEach(k=>{
            if(k==='pages'||k.indexOf('__')===0) return;
            doc[k]=T[k];
        });
        return true;
    }
    // 14.25.0 · 되돌리기 에코 가드. since=0 풀은 방금 되돌린 내 op 를 다시 들고
    //   오는데, html 은 3-way 병합이 지켜 주지만 _tbMergeRemote 가 서식
    //   (fontSize·font…)은 원격 값으로 덮어써 서식 되돌리기가 풀려 보였다.
    //   undo/redo 직후 30초(조용한 동기화 15초 주기 + 여유) 동안은 같은 기기의
    //   같은 rev 에코를 건너뛴다. 남의 기기 op·새 rev 는 그대로 적용한다.
    let _undoGuardUntil=0;
    // force=true 면 250ms 묶음을 건너뛰고 무조건 기록한다. 그리기(획·지우개)가
    // 쓴다 — 빠르게 연속으로 그려도 한 획씩 각자 되돌아가야 하기 때문이다.
    // 리턴값 = 방금 쌓은 스냅샷 문자열 (아무것도 안 쌓았으면 null). 그리기 쪽에서
    // "결국 아무 변화가 없던 제스처"의 스냅샷을 도로 치울 때 쓴다.
    function pushHistory(force){
        if(!doc) return null;
        // 18.9/20.3 · 편집 중 상자가 있으면 '적기 전' 스냅샷을 먼저 사다리에
        //   올린다. (타이핑 → 툴바 서식 순서일 때 타이핑분이 통째로 빠지던 문제)
        //   이때는 250ms 묶음도 건너뛴다 — 방금 올린 '적기 전'과 지금 상태는
        //   서로 다른 되돌리기 지점이어야 한다.
        try{ if(commitEditSnapshot()) force=true; }catch(e){}
        // 편집 중 툴바/우클릭 메뉴가 스크립트로 DOM 을 바꾼 작업은 브라우저 기본
        // contenteditable undo 스택에 안 들어가는 환경이 있다. 이 경우 바로 Ctrl+Z 를
        // 누르면 앱 히스토리로 되돌릴 수 있게 표시해 둔다. 실제 타이핑 input 이 오면
        // 위 input 리스너에서 다시 false 로 돌려 브라우저 기본 undo 를 우선한다.
        try{ if(document.querySelector('.tb.edit')) _scriptEditUndoable=true; }catch(e){}
        const now=Date.now();
        // 잦은 변화는 한 덩어리로 묶는다 (큰 문서에서 JSON.stringify 폭주 방지)
        if(!force&&now-_histT<250){ redoStack=[]; return null; }
        _histT=now;
        // 20.3 · 편집 중이던 글자는 아직 DOM 에만 있을 수 있다 → 스냅샷 전에 확정.
        //   (안 그러면 되돌리기 지점이 '방금 친 글자가 빠진 상태'로 찍혀,
        //    되돌리면 엉뚱하게 글자가 되살아나거나 사라진다)
        try{ commitEditingText(); }catch(e){}
        const snap=JSON.stringify(doc);
        history.push(_histEntry(snap));
        if(history.length>histMax()) history.shift();
        redoStack=[];                       // 새 작업이 생기면 다시 실행 기록은 무효
        return snap;
    }
    // 되돌리기는 문서를 JSON 으로 통째 복원한다. 그런데 동기화용 Map
    // (__localRev/__lastHash) 은 JSON 을 거치면 그냥 {} 가 되어 버려서
    // 이후 .get/.forEach 호출이 터지고 편집 동기화가 멈춘다.
    // → 복원 직후 Map 을 되살리고, 내용은 현재 문서 기준으로 다시 만든다.
    function reviveDocMaps(keep){
        if(!doc) return;
        const oldRev=keep&&keep.__localRev instanceof Map?keep.__localRev:null;
        const oldHash=keep&&keep.__lastHash instanceof Map?keep.__lastHash:null;
        const oldBase=keep&&keep.__base instanceof Map?keep.__base:null;
        const oldBaseRev=keep&&keep.__baseRev instanceof Map?keep.__baseRev:null;
        doc.__localRev=oldRev||new Map();
        doc.__lastHash=oldHash||new Map();
        doc.__base=oldBase||new Map();
        doc.__baseRev=oldBaseRev||new Map();
        doc.__pagesRev=keep?keep.__pagesRev||0:0;
        doc.__since=keep?keep.__since||0:0;
        if(keep&&keep.__ref){ doc.__ref=keep.__ref; doc.__loadedTo=keep.__loadedTo||0; }
        try{ rehashAll(); }catch(e){}     // 현재 내용으로 해시 재작성 → 변경분만 전송
    }
    // 20.3 · undo/redo 공통 — doc 을 교체하지 않고 '바뀐 것만' 되돌린다.
    //   되돌린 결과는 __lastHash 를 그대로 두고 saveDoc/queueOps 로 올라가므로
    //   서버에도 반영된다(예전에는 rehashAll 이 전송을 막아 도로 되살아났다).
    // 22.1 · '글상자 패치' 칸은 여기서 한 걸 더 들어간다 — 문서 전체를
    //   직렬화·파싱·재렌더하지 않고 그 상자와 그 쪽만 되돌린다. 되돌리기 자체가
    //   렉이 되지 않게 하기 위한 것으로, 저사양에서는 한 칸이 더 늘어나는 일도 없다.
    //   반환: null = 이 칸은 되돌릴 수 없다(사다리에서 건너뜀)
    //         {back, changed, patch?} = 되돌림 성공(back 은 반대 방향 기록)
    function _histApply(entry,label){
        const isPatch=!!(entry&&entry.patch);
        // 22.1 · 패치 칸에서는 JSON.stringify(doc) 를 아예 하지 않는다.
        const before=isPatch?null:JSON.stringify(doc);
        try{ commitEditingText(); }catch(e){}
        // 편집 중이던 상자는 되돌린 내용이 DOM 에 다시 그려져야 하므로 편집 종료
        try{ document.querySelectorAll('.tb.edit').forEach(o=>{
            o.classList.remove('edit');
            const c=o.querySelector('.tb-content'); if(c) c.contentEditable='false';
        }); _editScanDirty=true; _editBoxEl=null; }catch(e){}
        _editSnap=null; _editSnapUsed=true;
        if(isPatch) return _histApplyPatch(entry);
        if(!histRestore(entry)) return null;
        _docId=(curNB&&curNB.id)||null;
        try{ syncState(); }catch(e){}
        _undoGuardUntil=Date.now()+30000;   // 14.25.0 · 내 에코가 되돌리기를 덮지 않게
        selected=null; clearMulti();
        try{ clearActiveTbl(); }catch(e){}
        if(!doc.pages.length) doc.pages=[blankPage()];
        if(curPageIdx>=doc.pages.length) curPageIdx=doc.pages.length-1;
        if(curPageIdx<0) curPageIdx=0;
        try{ doc.__rv=(doc.__rv||0)+1; }catch(e){}
        renderPages();
        try{ updatePageInfo(); }catch(e){}
        saveDoc();
        try{ queueOps(); }catch(e){}        // 되돌린 내용을 다른 기기에도 반영
        // 되돌리기가 종이를 통째로 다시 그리므로, 펜 모드 중이었다면 그리기
        // 레이어(.drawing)를 새 종이에 다시 붙여야 한다. 예전엔 이게 빠져
        // 되돌린 뒤 펜이 먹통 → 펜을 끄고 다시 켜야 하는 불편이 있었다.
        if(penActive){ editorPapers().forEach(pp=>pp.classList.add('drawing')); try{ updateToolCursor(); }catch(e){} }
        return {back:before,changed:JSON.stringify(doc)!==before};
    }
    // 쪽 패치 칸 하나를 되돌린다 — 상자만 원상복구, 그 쪽만 다시 그린다.
    //   쪽·상자가 이미 없어진 칸(남이 지운 뒤 등)은 null → 사다리에서 건너뛴다.
    function _histApplyPatch(entry){
        const pt=entry.patch;
        const r=_applyEditPatch(pt,entry.remote);
        if(!r) return null;
        if(!r.changed) return {back:null,changed:false};
        const back=_editPatch(pt.pi,pt.id,r.cur);
        _docId=(curNB&&curNB.id)||null;
        _undoGuardUntil=Date.now()+30000;
        selected=null; clearMulti();
        try{ clearActiveTbl(); }catch(e){}
        // 쪽 하나만 다시 그린다 — renderPageEls 가 .drawing 층도 같이 챙긴다.
        try{ if(renderedPages.has(pt.pi)){ renderPageEls(pt.pi); renderTblDivs(pt.pi); } }catch(e){}
        saveDoc();
        try{ queueOps(); }catch(e){}        // 되돌린 내용이 다른 기기에도 반영
        return {back:back,changed:true,patch:true};
    }
    // 사다리에서 '지금과 다른' 지점이 나올 때까지 내려간다.
    //   같이 편집하던 중 남이 내 변경을 이미 덮었거나, 아무 변화가 없던 제스처가
    //   섞여 있으면 예전에는 Ctrl+Z 가 헛돌았다("눌러도 아무 일도 안 일어난다").
    function _histStep(from,to,label){
        if(!doc){ toast('열린 노트가 없습니다',900); return; }
        let tries=0;
        while(from.length&&tries<60){
            tries++;
            const entry=from.pop();
            const r=_histApply(entry,label);
            if(!r) continue;                                   // 되돌릴 수 없는 칸
            if(!r.changed) continue;                           // 실질 변화 없음 → 한 칸 더
            const back=r.patch?_histEntry(null,r.back):_histEntry(r.back);
            back.remote=entry.remote; back.remotePages=entry.remotePages;
            to.push(back);
            if(to.length>histMax()) to.shift();
            toast(penActive?(label==='되돌림'?'그리기 되돌림':'그리기 다시 실행'):label,900);
            return;
        }
        toast(label==='되돌림'?'되돌릴 작업이 없습니다':'다시 실행할 작업이 없습니다',900);
    }
    function undo(){ _histStep(history,redoStack,'되돌림'); }
    function redo(){ _histStep(redoStack,history,'다시 실행'); }
    // 20.3 · Ctrl+Z 를 앱 히스토리로 처리할지 판단한다.
    //   글상자에 커서를 두고 **글자를 치는 중**일 때만 브라우저 기본 undo 에
    //   양보한다. 그 밖에는(문서 편집·해돌이 편집·번역·서식·표·그림…) 앱이 받는다.
    //   예전에는 '편집 상자에 포커스가 있다'는 이유만으로 무조건 양보해서,
    //   해돌이가 고친 내용이나 스크립트로 바꾼 서식이 되돌아가지 않았다.
    function _useAppUndo(){
        try{
            const editing=document.querySelector('.tb.edit');
            const inBox=editing&&document.activeElement&&document.activeElement.classList
                &&document.activeElement.classList.contains('tb-content');
            if(!inBox) return true;
            if(_scriptEditUndoable) return true;
            // 마지막 타이핑보다 뒤에 생긴 앱 되돌리기 지점이 있으면 앱이 처리한다.
            if(history.length&&_histT>_lastTypeT) return true;
            return false;
        }catch(e){ return true; }
    }


/* APP-PART:07-elements.js:END */
