/* Home-card placement in untransformed CSS pixels, independent of device zoom. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/app/02c-home-stack.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('    function previewPlacement('),source.indexOf('    // ===== 꾹'));
let cards=[], theme='pro', frames=[], observer;
const events=new Map(), viewportEvents=new Map();
class ResizeObserver {
  targets=new Set();
  constructor(callback){this.callback=callback;observer=this;}
  observe(el){this.targets.add(el);}
  unobserve(el){this.targets.delete(el);}
  disconnect(){this.targets.clear();}
}
const context=vm.createContext({
  ResizeObserver, getComputedStyle:el=>el.computed,
  sdyTheme:()=>theme, requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},
  document:{querySelectorAll:()=>cards},
  window:{addEventListener:(name,fn)=>events.set(name,fn),visualViewport:{addEventListener:(name,fn)=>viewportEvents.set(name,fn)}},
  _layoutHomeStacks(){}, layoutPages(){}
});
vm.runInContext(code,context);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
let cases=0;
for(const cw of [72,113.25,148.8,185,219.625,320,480]){
  for(const ch of [90,180.125,260,400.5]){
    for(const [bw,bh] of [[800,1100],[1100,800],[800,800],[1600,400],[400,1600]]){
      for(const pro of [true,false]){
        const p=context.previewPlacement(cw,ch,bw,bh,pro);
        assert.ok(p.scale>0);
        close(p.left,cw-(p.left+bw*p.scale));
        close(p.top,ch-(p.top+bh*p.scale));
        assert.ok(p.left>=p.inset-1e-8&&p.top>=p.inset-1e-8);
        close(Math.min(p.left,p.top),p.inset);
        cases++;
      }
    }
  }
}
for(const bad of [0,-1,NaN,Infinity]) assert.equal(context.previewPlacement(bad,260,800,1100,true),null);
function card(w=219.625,h=274.53125){
  const frame={style:{transform:'scale(0)'}};
  return {
    isConnected:true, clientWidth:Math.round(w),clientHeight:Math.round(h),
    dataset:{bw:'800',bh:'1100'},
    computed:{width:w+'px',height:h+'px',boxSizing:'border-box'},
    querySelector:()=>frame, frame,
    // Screen rectangles intentionally differ from layout size (zoom + rotation).
    getBoundingClientRect(){throw Error('Must not measure transformed screen bounds');}
  };
}
const pv=card();cards=[pv];context.rescalePreviews();
let expected=context.previewPlacement(219.625,274.53125,800,1100,true);
close(parseFloat(pv.frame.style.left),expected.left);
close(parseFloat(pv.frame.style.top),expected.top);
assert.equal(observer.targets.size,1);
context.rescalePreviews();assert.equal(observer.targets.size,1);
// A container-only resize, without a window resize event.
observer.callback([{target:pv,contentRect:{width:180.25,height:225.3125}}]);
expected=context.previewPlacement(180.25,225.3125,800,1100,true);
close(parseFloat(pv.frame.style.left),expected.left);
// Hidden content must not get a bogus zero/infinite transform.
pv.clientWidth=0;const before=pv.frame.style.transform;
observer.callback([{target:pv,contentRect:{width:0,height:0}}]);
assert.equal(pv.frame.style.transform,before);
pv.clientWidth=220;
// Late-loaded landscape document and a theme switch both use fresh geometry.
pv.dataset.bw='1100';pv.dataset.bh='800';theme='classic';context.rescalePreviews();
expected=context.previewPlacement(219.625,274.53125,1100,800,false);
close(parseFloat(pv.frame.style.top),expected.top);
// Padding-box coordinates with a border: never include the border in available space.
pv.computed={width:'224.5px',height:'280.25px',boxSizing:'border-box',borderLeftWidth:'1px',borderRightWidth:'1px',borderTopWidth:'1px',borderBottomWidth:'1px',paddingLeft:'4px',paddingRight:'4px',paddingTop:'4px',paddingBottom:'4px'};
context.rescaleOne(pv);
expected=context.previewPlacement(222.5,278.25,1100,800,false);
close(parseFloat(pv.frame.style.left),expected.left);
observer.callback([{target:pv,contentRect:{width:214.5,height:270.25}}]);
close(parseFloat(pv.frame.style.left),expected.left);
pv.dataset.bw='Infinity';pv.dataset.bh='-2';context.rescaleOne(pv);
assert.ok(!/NaN|Infinity/.test(pv.frame.style.transform));
// Resize bursts are coalesced; orientation and visual viewport use the same path.
events.get('resize')();events.get('orientationchange')();viewportEvents.get('resize')();
assert.equal(frames.length,1);frames.shift()();
pv.isConnected=false;cards=[];context.rescalePreviews();assert.equal(observer.targets.size,0);
cards=[card()];context.rescalePreviews();context._disconnectPreviewSizes();assert.equal(observer.targets.size,0);
// Cached HTML cannot reintroduce a previous viewport's coordinates on first paint.
const apply=source.slice(source.indexOf('function pvPaintApply'),source.indexOf('function renderGrid'));
assert.ok(!apply.includes('f.style.transform=e.tf'));
assert.ok(source.includes('height:${size.h}px;transform:scale(0);'));
console.log(`PASS: ${cases} geometry combinations; fractional sizes, portrait/landscape, border/padding, theme, resize, hidden/reopen, cache and observer cleanup`);
