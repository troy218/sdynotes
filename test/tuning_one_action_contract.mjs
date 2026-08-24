// 14.11 계약 검증:
//   1) 12GB 메모리 재구성 — Node 힙을 '실제 필요량'으로 낮추고, 변환 자식
//      프로세스는 전역 상한(SDY_IMP_MAX_CHUNKS + 세마포)으로 잠근다.
//   2) 사용자 동작 = 한 기능 — 재생/가사 탭 열기가 외부 검색을 연쇄하지 않고,
//      자동 태그가 표지·가사·소리인식을 덩달아 돌리지 않는다.
//   3) 통화 — WebRTC/TURN 제거, 서버 릴레이(/api/chat/voice-ws) 만.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const html = fs.readFileSync(new URL('sdynotes.js', root), 'utf8');
const music = fs.readFileSync(new URL('worker/sdynotes_worker/music.py', root), 'utf8');
const cloud = fs.readFileSync(new URL('worker/sdynotes_worker/music_cloud.py', root), 'utf8');
const importer = fs.readFileSync(new URL('worker/sdynotes_worker/importer.py', root), 'utf8');
const apply = fs.readFileSync(new URL('apply.sh', root), 'utf8');
const chat = fs.readFileSync(new URL('server/src/routes/chat.js', root), 'utf8');

// ── 1. 12GB 메모리 배분 ──
// 예전: NODE_HEAP = RAM*62% (12GB→7.5GB). 지금: 12GB→2GB 고정 + 오프힙 예산.
assert.match(apply, /NODE_HEAP_MB=2048/, '12GB 박스 Node 힙은 2GB 계열이어야 한다');
assert.doesNotMatch(apply, /NODE_HEAP_MB\$\{?\(RAM_MB \* 62/, 'RAM 비례 62% 힙은 없어야 한다');
assert.match(apply, /SDY_CHAT_FILE_MB=\$CHAT_FILE_MB/, '채팅 파일 총 바이트 예산을 주입해야 한다');
assert.match(apply, /SDY_IMP_MAX_CHUNKS=\$IMP_MAX_CHUNKS/, '변환 자식 전역 상한을 주입해야 한다');
assert.match(apply, /MALLOC_ARENA_MAX=2/, 'Python glibc 아레나 상한이 있어야 한다');
assert.match(apply, /SWAP_GB=4/, '12GB 박스 swap은 4GB 계열이어야 한다');

// importer: 전역 세마포 + 시작/수확에서 정확히 1:1 쌍
assert.match(importer, /_imp_chunk_sem = threading\.BoundedSemaphore\(IMP_MAX_CHUNKS\)/,
  '자식 프로세스 전역 세마포가 있어야 한다');
assert.match(importer, /SDY_IMP_MAX_CHUNKS/, 'apply.sh 가 상한을 주입하는 환경변수여야 한다');
const starts = (importer.match(/_run_chunk_start\(/g) || []).length;
const collects = (importer.match(/_run_chunk_collect\(/g) || []).length;
assert.equal(starts, 4, '정의 1 + 호출 3(일반/재시도/안전모드)');
assert.equal(collects, 4, '모든 시작은 수확과 쌍을 이뤄 세마포가 새지 않는다');

// ── 2. 한 번의 동작 = 한 기능 (가사) ──
// 재생(playIdx)은 외부 검색을 연쇄하지 않는다
assert.doesNotMatch(html, /lookupTrack\(t\.id,\{silent:true\}\)/,
  '재생만으로 자동 태그 검색을 하면 안 된다');
assert.doesNotMatch(html, /lookupTrack\(t\.id,\{lyricsOnly:true,silent:true\}\)/,
  '재생만으로 가사 검색을 하면 안 된다');
assert.equal((html.match(/lookupTrack\(t\.id,\{lyricsOnly:true\}\)/g) || []).length, 1,
  '가사 검색 호출은 명시적 버튼의 1곳만 남아야 한다');
assert.match(html, /mpLyrFind/, '가사 없는 화면엔 명시적 [가사 찾기] 버튼');
assert.doesNotMatch(html, /P\._lyrAsk/, '가사 탭 자동 검색(20초 규칙)이 없어야 한다');

// 서버: 자동 태그는 '정보만' — 표지/가사/소리인식을 연쇄하지 않는다
const autotag = music.slice(music.indexOf('def _music_autotag'),
  music.indexOf('def _music_cover_search'));
assert.doesNotMatch(autotag, /_music_lyrics\(/, '자동 태그가 가사를 연쇄하면 안 된다');
assert.doesNotMatch(autotag, /_fetch_cover\(/, '자동 태그가 표지를 연쇄하면 안 된다');
assert.doesNotMatch(autotag, /_music_recognize\(/, '자동 태그가 소리 인식을 연쇄하면 안 된다');
const recognize = music.slice(music.indexOf('def _music_recognize'),
  music.indexOf('TAG_ALGO ='));
assert.doesNotMatch(recognize, /_music_lyrics\(/, '소리 인식이 가사를 연쇄하면 안 된다');
const cloudAutotag = cloud.slice(cloud.indexOf('def _cloud_music_autotag'),
  cloud.indexOf('def _music_lyrics_cloud'));
assert.doesNotMatch(cloudAutotag, /_music_lyrics_cloud\(/, '클라우드 자동 태그가 가사를 연쇄하면 안 된다');
assert.doesNotMatch(cloudAutotag, /_cloud_cover_upload\(/, '클라우드 자동 태그가 표지를 연쇄하면 안 된다');
assert.match(cloud, /def _cloud_cover_pick\(mid, alt=0\)/, '표지 전용 헬퍼가 있어야 한다');
assert.doesNotMatch(cloud, /threading\.Thread\(target=_cloud_music_autotag/,
  '소리 인식 뒤 자동 태그 스레드를 연쇄하면 안 된다');

// ── 2.5 · 수동 버튼 = 결과 반영 (14.13) ──
// '소리 인식' 버튼을 직접 누르면 이미 제목이 있어도(tag_state=done/manual)
// 인식 결과를 제목·가수에 반영해야 한다. (배경 백필은 보수적으로 유지)
assert.match(music, /def _music_recognize\(mid, apply_tags=True, force=False\)/,
  '소리 인식은 force 매개변수를 가진다 (버튼=강제, 배경=보수)');
assert.match(recognize, /if force or not \(r2\.get\("title"\) or ""\)\.strip\(\)/,
  'force 요청은 제목이 이미 있어도 인식 결과를 덮어 적용한다');
const recognizeApi = music.slice(music.indexOf('def music_recognize_api'),
  music.indexOf('def music_recognize_status'));
assert.match(recognizeApi, /_music_recognize\(mid, apply_tags=True, force=True\)/,
  '인식 API(버튼)는 force=True 로 호출한다');
// 배경 백필의 두 호출 지점은 여전히 보수 모드여야 한다
assert.ok((music.match(/_music_recognize\(mid, apply_tags=True\)\n/g) || []).length >= 2,
  '배경 백필/복구 경로는 force 없이 그대로 2곳');
// 싱크 가사·표지 찾기는 편집창에 적어둔 제목/가수 힌트를 쓴다
const synced = music.slice(music.indexOf('def music_synced_lyrics'),
  music.indexOf('@app.route("/api/music/meta"'));
assert.match(synced, /d\.get\("q_title"\)/, '싱크 가사 API 는 편집창 제목 힌트를 받는다');
assert.match(synced, /q_t or \(rec\.get\("title"\)/, '힌트가 있으면 저장된 제목보다 우선한다');
assert.match(music, /_music_cover_search\(mid, d\.get\("alt"\) or 0, qh\)/,
  '표지 찾기 API 가 편집창 힌트(qh)를 전달한다');
assert.match(music, /def _music_cover_search\(mid, alt=0, qh=None\)/,
  '표지 검색 헬퍼가 qh 매개변수를 가진다');
// 프런트: 인식 응답의 recog 값을 편집창에 다시 심는다 (목록 새로고침과 무관하게)
assert.match(html, /\$\('mpTagTitle'\)\.value=g\.title/, 'recog 결과가 제목 칸에 반영된다');
assert.match(html, /q_title:\$\('mpTagTitle'\)\.value\.trim\(\)/,
  '싱크 가사·표지 찾기 버튼이 편집창 제목을 검색 힌트로 보낸다');

// ── 3. 음성은 서버 릴레이 (WebRTC/TURN 없음) ──
assert.match(apply, /location \/api\/chat\/voice-ws/, 'apply.sh 가 음성 WS Upgrade 경로를 넣는다');
assert.match(apply, /ensure_nginx_voice_ws\.py/, '기존 nginx 파일이 있어도 voice-ws 를 보강해야 한다');
assert.match(apply, /proxy_set_header Connection "upgrade"/, 'nginx 가 WebSocket 핸드셰이크를 통과시킨다');
assert.doesNotMatch(apply, /tls-listening-port=5349/, 'TURN TLS 를 새로 켜면 안 된다');
assert.doesNotMatch(apply, /apt-get install -y -qq coturn/, 'coturn 을 새로 깔면 안 된다');
assert.match(chat, /voice: 'relay'/, '채팅 설정이 릴레이 전용이다');
assert.doesNotMatch(chat, /\/api\/chat\/signal/, 'P2P 시그널 라우트가 없어야 한다');
assert.doesNotMatch(chat, /SDY_TURN_HOST|localTlsTurn|publicTlsTcp/, 'TURN 호스트/진단 코드가 없어야 한다');
assert.doesNotMatch(html, /RTCPeerConnection/, '프론트에 WebRTC 가 없어야 한다');
assert.match(chat, /SDY_CHAT_FILE_MB/, '채팅 파일 바이트 예산을 읽는다');
assert.match(chat, /fileEvict\(\)/, '채팅 파일 예산 초과 시 오래된 파일을 지운다');

// SSE 시그널 유실 방지: 느린/늦은 수신자 스트림이 offer/ICE 를 밀어내지 않도록
// (a) 큐가 가득 차면 그 스트림은 버리고 pending 으로 넘기고,
// (b) drain 이 안 오면 30초 만에 죽이고, (c) close 뿐 아니라 error 로도
// 스트림 맵에서 제거한다.
assert.match(chat, /client\.queue\.length >= 128[\s\S]{0,120}raw\.destroy\(\)/,
  '큐 오버플로 시 스트림을 shift 하지 않고 파괴해야 한다');
assert.match(chat, /30000/, 'drain 이 안 오면 30초 내 스트림을 버린다');
assert.match(chat, /req\.raw\.on\('error', cleanup\)/, 'error 로 끊겨도 스트림 맵에서 제거');
assert.match(chat, /if \(dead\.length && set\.size === 0\) remember\(uid, evt\)/,
  '모든 스트림이 죽으면 그 이벤트를 pending 큐에 보존한다');

// 음악 목록 캐시: 매 요청 JSON 재파싱 제거 — _music_lock 을 잡은 채로도
// 불릴 수 있으므로(재진입 불가) 전용 락을 쓰고, 저장 즉시 캐시도 갱신한다.
assert.match(music, /_music_cache_lock = threading\.Lock\(\)/, '캐시는 전용 락으로 보호');
if (music.indexOf('with _music_lock:') < music.indexOf('_music_cache_lock')) {
  // _music_load 본문 안에서 _music_lock 을 잡는 코드가 없어야 한다.
  const loadBody = music.slice(music.indexOf('def _music_load'), music.indexOf('def _music_shallow'));
  assert.doesNotMatch(loadBody, /with _music_lock/, '_music_load 가 메인 락을 재진입하면 안 된다');
}
assert.match(music, /_music_cache\["data"\] = _music_shallow\(m\)/,
  '저장 직후 캐시를 갱신해 mtime/size 키 의존을 줄인다');

console.log('Tuning + one-action contract: PASS (12GB 메모리 배분 / 한 동작=한 기능 / 서버 릴레이 음성)');
