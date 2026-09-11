// 14.65 · 음량 정규화 계약 — "곡마다 소리가 크고 작다" 를 백엔드가 맞춘다.
//
// 사용자 지시: "사용자가 선택하는 옵션이 아니라 **백엔드에서 송출 시** 크기를
//              일관되게 처리."
//
// 그래서 이 계약은
//   ① worker 가 곡마다 음량을 재서 보정값(gain_db)을 남기는가
//   ② 서버(송출)가 그 값을 실제로 적용하는가 (로컬=정규화 사본 / 클라우드=e_volume)
//   ③ 클라이언트에 '사용자가 고르는' 음량 옵션이 생기지 않았는가
//   ④ 실패해도 재생은 막지 않는가 (ffmpeg 없음 → 그대로 송출)
// 를 지킨다.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const worker = read('worker/sdynotes_worker/music.py');
const loud = read('worker/sdynotes_worker/loudness.py');
const common = read('worker/sdynotes_worker/common.py');
const reqs = read('worker/requirements.txt');
const server = read('server/src/routes/music.js');
const paths = read('server/src/lib/paths.js');
const client = read('src/music-player.js');

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };

console.log('음량 정규화(백엔드 송출) 계약\n');

// ── ① worker: 측정과 보정값 ───────────────────────────────────────────
check('worker: EBU R128(ebur128)로 통합 음량을 잰다', /ebur128=peak=true/.test(loud));
check('worker: 목표 음량은 -14 LUFS', /TARGET_LUFS\s*=\s*-14/.test(loud));
check('worker: 보정값은 상한·하한 안에서만 (과증폭 방지)', /MAX_GAIN_DB\s*=\s*9/.test(loud)
  && /MIN_GAIN_DB\s*=\s*-12/.test(loud));
check('worker: 트루피크 헤드룸을 지켜 클리핑을 막는다', /PEAK_CEIL_DB\s*=\s*-1/.test(loud)
  && /peak_db/.test(loud));
check('worker: 리미터 오토레벨을 꺼 목표가 흔들리지 않게 한다', /alimiter=limit=[^\n]*level=0/.test(loud));
check('worker: ffmpeg 가 없으면 재생을 막지 않고 표시만 남긴다',
  /norm_state.*unavailable|"unavailable"/.test(loud) && /def available\(\)/.test(loud));
check('worker: ffmpeg 를 PATH → SDY_FFMPEG → 동봉 바이너리 순으로 찾는다',
  /SDY_FFMPEG/.test(loud) && /shutil\.which\("ffmpeg"\)/.test(loud) && /imageio_ffmpeg/.test(loud));
check('worker: 정규화 사본은 원본과 다른 폴더(music_norm)에 만든다',
  /MUSIC_NORM_DIR/.test(common) && /music_norm/.test(common));
check('worker: 곡이 들어오면 자동으로 잰다 (업로드 파이프라인)',
  /_music_loudness\(mid\)/.test(worker));
check('worker: 유튜브로 들어온 곡도 잰다', /Thread\(target=_music_loudness/.test(worker));
check('worker: 밀린 곡은 백그라운드 백필이 따라잡는다', /noloud/.test(worker) && /kind == "loud"/.test(worker));
check('worker: 곡을 지우면 정규화 사본도 지운다',
  /def _music_norm_remove/.test(worker) && /_music_norm_remove\(mid\)/.test(worker));
check('worker: 결과를 곡 기록에 남긴다 (gain_db·norm_state)',
  /"gain_db", "norm_state", "norm_lufs"/.test(worker));
check('worker: 상태/강제 실행 엔드포인트가 있다',
  /@app\.route\("\/api\/music\/normalize", methods=\["GET", "POST"\]\)/.test(worker));

// ── ② 서버: 송출할 때 적용 ───────────────────────────────────────────
check('서버: 정규화 사본 폴더(music_norm)를 안다',
  /musicNorm:/.test(paths) && /DIRS\.musicNorm/.test(server));
check('서버: 로컬 송출은 정규화 사본을 먼저 찾는다',
  /const norm = await normFileFor\(mid, ext\)/.test(server)
  && /sendPath = norm \? norm\.path/.test(server));
check('서버: 사본이 없으면 원본을 그대로 송출한다 (재생이 막히지 않는다)',
  /sendPath = norm \? norm\.path : path\.join\(DIRS\.music, hits\[0\]\)/.test(server));
check('서버: 클라우드 송출도 같은 값을 적용한다 (e_volume:<gain>dB)',
  /effect = `volume:\$\{gain\}dB`/.test(server));
check('서버: 보정값은 서버가 다시 한 번 자른다 (0.1dB 미만은 무시)',
  /const normGain = \(rec\) =>/.test(server) && /NORM_MIN_DB = 0\.1/.test(server));
check('서버: Range(구간) 요청 규칙은 그대로다',
  /function streamAudio\(req, reply, filePath, mime, size\)/.test(server)
  && /Content-Range/.test(server) && /206/.test(server));
check('서버: normalize 상태/실행을 worker 로 넘긴다',
  /\['GET', '\/api\/music\/normalize'\]/.test(server) && /\['POST', '\/api\/music\/normalize'\]/.test(server));

// ── ③ 클라이언트: 서버 값을 적용만 한다 (사용자 옵션 없음) ───────────
check('클라이언트: 곡 음량 보정은 서버 값(norm_db)을 그대로 적용한다',
  /function normDbOf\(t\)/.test(client) && /t&&t\.norm_db/.test(client)
  && /_normDb=normDbOf\(t\)/.test(client));
const clientCode = client.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check('클라이언트: 새 설정·토글·슬라이더를 만들지 않았다 (사용자 옵션 없음)',
  !/음량\s*맞춤|음량\s*정규화|자동\s*음량/.test(clientCode)
  && !/id=['"]mpNorm|mpNormOn|normToggle/i.test(clientCode));
check('클라이언트: 적용 경로는 그래프(게인 노드)와 기기 음량(감쇠) 두 가지뿐',
  /_normGainNode\.gain/.test(client) && /Math\.min\(1,_dbLin\(_normDb\)\)/.test(client));
check('클라이언트: 값이 없는 곡은 재생하면서 조용히 재서 서버에 보고한다',
  /\/api\/music\/norm/.test(client) && /player-rms/.test(client)
  && /getFloatTimeDomainData/.test(client));
check('클라이언트: 측정은 원본 레벨에서 (게인·EQ 영향 없이)',
  /src\.connect\(_lvlAnalyser\)/.test(client) && /const inv=1\/\(vol\*vol\)/.test(client));
check('클라이언트: 재생 볼륨은 예전과 같은 사용자 볼륨 하나뿐',
  (client.match(/A\.volume=P\.vol/g) || []).length >= 2);

// ── ④ 배포 준비 ──────────────────────────────────────────────────────
check('의존성: ffmpeg 동봉 바이너리(imageio-ffmpeg)를 고정 버전으로 넣었다',
  /imageio-ffmpeg==/.test(reqs));

console.log(`\n음량 정규화 계약 — ${pass}개 항목 통과`);
