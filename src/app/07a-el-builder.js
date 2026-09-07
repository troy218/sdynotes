/* === src/app/07a-el-builder.js ===
   요소 빌더 · 가져온 텍스트 안겹침
   소스 오브 트루스 — 수정 후: node scripts/bundle-frontend.mjs
   (concat 번들 · 단독 <script> 로드 금지) */
/* APP-PART:07a-el-builder.js:BEGIN */
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

/* APP-PART:07a-el-builder.js:END */
