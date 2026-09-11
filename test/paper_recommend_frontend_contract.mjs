// 오늘의 추천 논문 띠 — 설정 키워드·링크·반복 이동·hover 정지의 브라우저 계약
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const html=fs.readFileSync(new URL('../sdynotes.html',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../src/app/02h-paper-recommend.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../sdynotes.css',import.meta.url),'utf8');
const dom=new JSDOM(html,{url:'https://notes.example/',pretendToBeVisual:true});
const {window}=dom, {document}=window;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let asked=[];
const paperFetch=async(url)=>{
  asked.push(String(url));
  return {ok:true,json:async()=>({ok:true,items:[
    {title:'HBFSim: Fast and Faithful Simulation of High-Bandwidth Flash Under Real GPU Execution',url:'https://arxiv.org/abs/2609.09800'},
    {title:'A newer GPU paper',url:'https://arxiv.org/abs/2609.09000'},
  ]})};
};

// concat bundle 안에서 이 파트가 기대하는 앞선 어휘 스코프만 아주 작게 제공한다.
const execute=new Function('window','document','fetch',`
  let S={paperKeywords:['hbf']};
  let curFolder=null, searchQuery='', selectMode=false;
  function saveS(){} function pushSettings(){} function toast(){}
  ${source}
  return { settings:()=>S };
`);
const api=execute(window,document,paperFetch);
document.dispatchEvent(new window.Event('DOMContentLoaded'));
await wait(30);

let pass=0, fail=0;
function ok(name, condition){
  try{ assert.ok(condition); pass++; console.log('✅ '+name); }
  catch(error){ fail++; console.error('❌ '+name+'\n   '+error.message); }
}
const ticker=document.getElementById('paperTicker');
const links=[...document.querySelectorAll('#paperTickerRun a.paper-ticker-paper')];
ok('홈: 등록한 키워드가 있으면 얇은 추천 띠를 보인다', ticker && !ticker.hidden && asked.length===1 && /keyword=hbf/.test(asked[0]||''));
ok('홈: 최신 논문은 1위부터 실제 arXiv 링크로 움직인다',
  links.length===4 && links[0].textContent.includes('01') && links[0].href==='https://arxiv.org/abs/2609.09800' && links[0].target==='_blank');
ok('홈: 끊김 없는 반복을 위해 두 번째 목록은 보조 접근성 트리에서 숨긴다',
  document.querySelectorAll('#paperTickerRun .paper-ticker-set[aria-hidden="true"]').length===1 && links.slice(2).every(link=>link.tabIndex===-1));
ok('스타일: 로고의 깊은 파랑과 밝은 글자를 쓴다', /\.paper-ticker\s*\{[\s\S]*?color:\s*#f8fbff[\s\S]*?background:\s*#14366e/i.test(css));
ok('스타일: 배너 hover 또는 링크 focus 중에는 이동을 멈춘다',
  /\.paper-ticker:hover\s+\.paper-ticker-run,[\s\S]*?\.paper-ticker:focus-within\s+\.paper-ticker-run\s*\{\s*animation-play-state:\s*paused/i.test(css));

const form=document.getElementById('paperKeywordForm');
const input=document.getElementById('paperKeywordInput');
input.value='gpu';
form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
await wait(20);
ok('설정: 입력 후 등록하면 설정 배열과 칩이 함께 갱신된다',
  JSON.stringify(api.settings().paperKeywords)==='["hbf","gpu"]' && document.querySelectorAll('.paper-keyword-chip').length===2);
document.querySelector('.paper-keyword-remove').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
ok('설정: 칩의 X를 누르면 해당 키워드를 지울 수 있다',
  JSON.stringify(api.settings().paperKeywords)==='["gpu"]' && document.querySelectorAll('.paper-keyword-chip').length===1);

console.log(`\n추천 논문 프런트엔드 테스트: PASS ${pass} / FAIL ${fail}`);
dom.window.close();
process.exit(fail?1:0);
