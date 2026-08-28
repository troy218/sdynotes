// PASTELS · 라이브 커서·채팅 참여자용 은은한 색 12가지
export const PASTELS = ['#f9a8d4','#fda4af','#fdba74','#fcd34d','#bef264','#6ee7b7',
                        '#5eead4','#7dd3fc','#a5b4fc','#c4b5fd','#d8b4fe','#f0abfc'];

// 14.13.4 · 이름의 '색 이름'이랑 커서 색을 똑같이 맞춘다.
//   이름은 '색 + 동물' (예: 복숭아빛 후투티) — 첫 단어만 보고 색을 정한다.
//   색이 이미 쓰이고 있으면 빈 팔레트 색으로 대체 (방 안 색은 무난히 다르게).
export const NAME_COLORS = {
  '연보라':'#b7a6f7','라벤더':'#c9a6f5','라일락':'#e0b3f8','연분홍':'#f9b9c9',
  '솜사탕':'#f9a8d4','장미빛':'#fda4af','코랄빛':'#ff8a75','복숭아빛':'#ffab91',
  '피치':'#ffb08a','살구색':'#ffc58f','시나몬':'#d3a075','레몬색':'#fde047',
  '버터':'#fbe29a','청포도':'#bef264','멜론':'#b8ecbe','민트색':'#8ce8c0',
  '청옥':'#5fd0a7','하늘색':'#7dd3fc','구름빛':'#c9d4e8','아이보리':'#e8dcb2',
};

export function colorForName(name){
  const tok = String(name||'').trim().split(/\s+/)[0] || '';
  return NAME_COLORS[tok] || null;
}

export function pickPastel(used, name){
  const s = used instanceof Set ? used : new Set(used || []);
  const wanted = colorForName(name);
  if (wanted && !s.has(wanted)) return wanted;      // 색 이름이랑 같은 색이 비어 있으면 → 그 색
  const free = PASTELS.filter(c => !s.has(c));
  const pool = free.length ? free : PASTELS;         // 다 차면 랜덤 (충돌 허용)
  return pool[Math.floor(Math.random()*pool.length)];
}
