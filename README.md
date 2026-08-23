# SDYnotes 14.12.0 — Fastify + Python worker + Oracle 자체 저장소

기존 단일 `app.py`(약 11,000줄)를 **"빠른 부분은 Node, 무거운 부분만 Python"** 으로
재설계한 백엔드입니다. **14.12 부터 모든 데이터(상태·파일)는 이 Oracle VM 디스크에
저장·실행됩니다** — Supabase/Cloudinary 는 기본적으로 전혀 호출하지 않습니다
(쿼터 초과·과금 걱정 없음). 예전 클라우드 모드는 `SDY_STORAGE=cloud` 로 언제든
롤백할 수 있고, 기존 데이터 이전은 `scripts/migrate_to_oracle.mjs` 가 자동으로
합니다 (자세한 것은 `ORACLE_MIGRATION.md`).

프런트(`sdynotes.html`)의 주요 변화:

- **Supabase 직접 접속 제거**: 노트 목록/본문(notebooks·memos·images)을 예전엔
  브라우저에서 Supabase 로 직접 저장했지만, 이제 같은 서버의 `/api/db/query`
  (오라클 디스크 저장소)가 담당합니다. 기존 코드가 그대로 동작하도록 supabase-js
  와 같은 체인을 제공하는 SDB shim 을 내장했습니다 (CDN·API 키 제거).
- **이미지 업로드 전부 서버 디스크로**: 노트 이미지는 `/api/upload` →
  `imported/` 폴더 → `/api/img/<file>` 로 서빙됩니다. 예전의 Cloudinary 직접
  업로드 폴백은 삭제됐습니다.
- **같은 텍스트상자 동시 편집 병합** (14.9): 서버가 텍스트 요소의 최근 버전을
  보관하고, 같은 공통 조상에서 갈라진 두 기기의 편집을 3-way 병합해 양쪽을 모두
  남깁니다.
- **고정(pin) 시 폴더 이름 스왑 수정** (14.9): 서브 ms 난수 rev + `since=0` 전체
  pull + `_stApplied` 워터마크 + Lamport 시계 캐치업.

## 왜 이 구조인가

| 작업 | 어디서 | 이유 |
|---|---|---|
| 프런트 서빙, 동기화, 카드, 스티커, 배경화면, 알림, SSE, 관리자, 보관함, 노트 DB | **Node(Fastify)** | JSON CRUD + 스트리밍에 최적. 기동 수 ms, 동시 요청 빠름 |
| PDF/Word 가져오기 | **Python worker** | PyMuPDF·python-docx 그대로 사용 (원본 코드 보존) |
| 음악 태깅·유튜브·소리인식 | **Python worker** | yt-dlp·mutagen·AcoustID(fpcalc) 그대로 사용 (원본 코드 보존) |
| 모든 상태·파일 저장 | **Oracle 서버 디스크** | `sync/`·`cards/`·`music/`·`stickers/`·`wallpaper/`·`vault/`·`imported/`·`db/` — 외부 클라우드 무료 한도 초과 원천 해소 |

Node 는 **읽기 전용**으로 `music/_index.json` 을 읽고, 그 파일의 **작성자는
worker 하나**뿐입니다 (원자적 교체라 읽는 쪽은 항상 안전). 알림/관리자 세션/SSE 는
Node 가 단일 소유하고, worker 가 내부 엔드포인트(`/internal/*`)로 위임합니다.

## 저장소 모드 (14.12)

| 모드 | 상태(JSON) | 파일(이미지·음악·보관함) | 언제 |
|---|---|---|---|
| **oracle** (기본) | 이 서버 디스크: `sync/`, `cards/`, `db/`, `music/_index.json`, `stickers/_index.json` | 이 서버 디스크: `imported/`, `music/`, `stickers/`, `wallpaper/`, `vault/` | 기본. Supabase/Cloudinary 트래픽 0 |
| cloud (legacy) | Supabase 4 테이블 | Cloudinary | `SDY_STORAGE=cloud` 로 배포할 때만 (롤백용) |

`.env` 에 옛 키(SUPABASE_*/CLOUDINARY_*)가 남아 있어도 oracle 모드에서는
**전혀 읽히지 않습니다**. `/api/cloud/status` 는 현재 모드와 로컬 보유량
(`local.files`, `local.bytes`) 을 알려 줍니다.

## 구조

```
sdynotes-fast/
├── package.json          Node 의존성
├── sdynotes.html         프런트 (SDB 로컬 DB shim 내장)
├── apply.sh              배포 스크립트 (★서버에서 실행 — 최초 1회 데이터 자동 이전)
├── scripts/
│   ├── migrate_to_oracle.mjs        Supabase/Cloudinary → Oracle 디스크 일괄 이전
│   └── ensure_nginx_voice_ws.py     기존 nginx site 에 음성 WS Upgrade 경로 보강
├── server/               Node(Fastify) 메인 서버
│   └── src/
│       ├── index.js      앱 조립 + 기동 (:5000)
│       ├── lib/          경로/설정/락/SSE/관리자/저장소(dbstore)/워커프록시
│       └── routes/       pages·sync·admin·vault·cards·stickers·wallpaper·
│                         translate·notify·live·misc·music·db
└── worker/               Python 워커 (127.0.0.1:5100)
    ├── run.py            기동
    └── sdynotes_worker/
        ├── importer.py   가져오기 (원본 그대로 보존)
        ├── music.py      음악 태깅/유튜브/인식 (원본 그대로 보존)
        ├── music_cloud.py 클라우드 음악 변이 (legacy 모드에서만 활성)
        ├── extra.py      /api/music/play 로컬 폴백
        └── core/common/cloud/admin/notify.py  지원 모듈
```

## 엔드포인트 (원본과 동일)

- 가벼운 API: `/api/sync/*`, `/api/cards/*`, `/api/stickers/*`,
  `/api/wallpaper/*`, `/api/notifications*`, `/api/presence/ping`,
  `/api/live`, `/api/live/ping`, `/api/live/leave`, `/api/admin/*`,
  `/api/escrow/*`, `/api/files/*`, `/api/upload`, `/api/delete`,
  `/api/translate*`, `/api/version`, `/api/health`, `/api/storage/info`,
  `/api/server/stat`, `/api/cloud/status`
- 음악 읽기(빠른 경로): `/api/music/list`, `/api/music/file/:mid`,
  `/api/music/lyrics/:mid`, `/api/music/cover/:mid`, `/api/music/play`,
  `/api/music/delete`
- 무거운 작업(worker 프록시): `/api/import/*`, `/api/music/upload`,
  `/api/music/youtube*`, `/api/music/lookup`, `/api/music/recognize*`,
  `/api/music/rescan`, `/api/music/reset`, `/api/music/meta`,
  `/api/music/cover`, `/api/music/synced-lyrics`, `/api/music/from_url`,
  `/api/music/background-work`
- 엽스코드(Youpscord) 채팅(전부 인메모리 — 영구 저장 없음):
  `/api/chat/join|ping|leave|msg|upload|react|voice|del|bgm|knock`,
  `/api/chat/file/:id`, `/api/chat/stream`(SSE), `/api/chat/config`,
  `/api/chat/voice-ws`(WebSocket 음성 릴레이).
  앱 전체 공용 1개 방. 닉네임은 라이브 새 이름 + 파스텔 색.
  실시간 음성은 **서버 릴레이** — 마이크를 16kHz μ-law 프레임으로
  `/api/chat/voice-ws` 에 올리고 Node 가 참가자에게 중계한다.
  WebRTC mesh · TURN · STUN · P2P 폴백은 없다. 채팅(SSE)이 열리는 망이면
  통화도 된다 (지연은 P2P보다 0.2~0.3초 크다).
  - 채팅은 SSE 응답에 **즉시 push**한다. LTE↔Wi-Fi 전환으로 EventSource가
    잠시 끊겨도 사용자별 대기 큐에 보관했다가 재연결 즉시 전달한다.
  - `apply.sh`는 nginx 에 `/api/chat/voice-ws` Upgrade 경로를 넣는다
    (`location /` 의 `Connection ""` 가 핸드셰이크를 막지 않게).
  - `/api/chat/config` 는 `{ok:true, voice:"relay"}` 만 준다.
  마지막 대화 후 24시간(`SDY_CHAT_TTL`, 기본 86400초)이 지나면 메시지·파일이
  '펑' 하고 사라진다.

## 로컬 실행

```bash
# 1) Node 메인 서버 (:5000)
npm install
node server/src/index.js

# 2) Python worker (:5100) — 다른 터미널
pip install flask flask-cors beautifulsoup4 cloudinary pillow-heif pymupdf \
            python-docx deep-translator requests mutagen openpyxl yt-dlp
python3 worker/run.py
```

## 배포 (서버에서)

```bash
# zip에 apply.sh · package.json · sdynotes.html · server/ · worker/ · scripts/ 를
# 모두 넣고
bash apply.sh
```

- `/var/www/memo/` 에 배포, systemd 서비스 2개:
  - `sdynotes`        (Node, :5000, 단일 프로세스)
  - `sdynotes-worker` (Python, 127.0.0.1:5100, 단일 프로세스)
- `.env` 보존, vault 데이터 보존, nginx(SSE 버퍼링 해제 + 음성 WebSocket Upgrade
  + 512M 업로드 + 900초 타임아웃), swap(12GB → 4GB, swappiness=10),
  deno/bgutil(유튜브), fpcalc(소리인식) 자동 준비. coturn 은 쓰지 않는다.
- **`.env` 에 옛 Supabase/Cloudinary 키가 남아 있으면 최초 1회, 서비스 정지
  상태에서 `scripts/migrate_to_oracle.mjs` 가 자동 실행돼 모든 데이터를 이
  서버 디스크로 이전합니다** (`ORACLE_MIGRATION.md` 참조).

#### 12GB 메모리 배분 (14.11)

`apply.sh`가 RAM 을 보고 아래처럼 잠근다(Node 힙을 62%로 크게 주지 않는다 —
V8 이 회수를 미뤄 RSS 가 부풀고, Python 변환 자식과 겹치면 스왑쓰래싱/OOM 이 났다).

| 항목 | 12GB 박스 | 설명 |
|---|---|---|
| Node `--max-old-space-size` | **2048MB** | JSON CRUD/SSE 는 수백 MB면 충분 |
| Node 오프힙 예산(SDY_CHAT_FILE_MB) | **512MB** | 채팅 사진/파일 총 바이트 — 초과 시 오래된 것부터 삭제 |
| Python 변환 자식 | **전역 최대 4 × 1GB** | `SDY_IMP_MAX_CHUNKS` 세마포로 모든 잡의 청크 합계를 잠금 |
| worker 동시 잡(IMP_CONC) | 2 | |
| libuv 스레드풀 | CPU×2 (8~24) | |
| swap | 4GB | `vm.swappiness=10` |

9GB 미만 박스는 비율을 자동으로 낮춘다. 음악 목록(`music/_index.json`)은
가사 본문까지 담겨 수 MB 이상이므로 mtime 캐시 + 곡 단위 얕은 복사로
매 요청 JSON 재파싱을 없앴다.

#### 한 번의 사용자 동작 = 한 기능 (14.11)

가사/정보 찾기가 다른 기능을 덩달아 돌리지 않는다:

| 동작 | 실행되는 기능 |
|---|---|
| **재생** | 재생만 (예전엔 자동 태그 + 가사 검색이 연쇄) |
| **가사 탭 열기** | 저장된 가사 표시만 (검색은 버튼을 누를 때) |
| **자동 찾기** | 제목·가수·앨범·연도·장르 정보만 |
| **표지만 찾기** | 표지 검색만 |
| **가사 찾기 / 싱크 가사** | 가사 검색만 (LRCLIB → lyrics.ovh) |
| **소리 인식** | AcoustID 인식 + 제목·가수 반영만 |
| **초기화 / 유튜브 추가** | 각자 자기 일만 (연쇄 자동태깅 없음) |

유휴 백필(백그라운드)은 곡마다 하나의 기능만 수행하며, 표지·가사·정보를
순서대로 처리한다.

### 엽스코드 음성 (서버 릴레이)

통화는 HTTPS(또는 localhost) 위의 WebSocket `/api/chat/voice-ws` 로만 중계한다.
Oracle VCN 에 UDP 3478 / 49160-49200 을 열 필요가 없다. 웹 마이크는 보안
컨텍스트에서만 열리므로 실제 접속 주소는 **HTTPS 도메인**이어야 한다
(`localhost`만 예외).

확인 명령:

```bash
curl -s 'http://127.0.0.1:5000/api/chat/config?uid=test'
# 기대: {"ok":true,"voice":"relay"}
grep -n 'location /api/chat/voice-ws' /etc/nginx/sites-available/memo
# 기대: Upgrade / Connection "upgrade" / 긴 timeout
```

#### 자주 막히는 함정

1. **"연결 중"에서 멈춤** — 기존 nginx `location /` 의 `Connection ""` 가
   WebSocket 핸드셰이크를 삼킨다. `apply.sh` 가 이미 있는 site 파일에도
   `/api/chat/voice-ws` location 을 보강한다. 배포 후
   `grep -n 'location /api/chat/voice-ws' /etc/nginx/sites-available/memo`
   로 생겼는지 확인한다.
2. **HTTP 로 접속** — 마이크가 막힌다. `https://` 주소로 연다.
3. **프록시가 유휴 WS 를 끊음** — 클라/서버가 20초마다 ping 한다.
   nginx `proxy_read_timeout` 은 3600s 로 잡혀 있어야 한다.
4. **옛 HTML 캐시** — WebRTC/TURN 토글이 보이면 강력 새로고침
   (`Ctrl+Shift+R`).

## 주의 (기존 운영 규칙 그대로)

- **단일 프로세스 전제** — worker 를 여러 개 띄우면 `music/_index.json` 이
  서로 덮어써져 곡이 사라질 수 있습니다. gunicorn 다중 worker 금지.
- `SUPABASE_SERVICE_KEY` 등 비밀키는 zip/로그/프런트에 절대 노출 금지.
  (oracle 모드에선 이 키들이 필요 없고, 남아 있어도 무시됩니다.)
- `APP_VERSION` 은 프런트 `<meta name="application-version">`(14.12.0) 와 일치해야
  합니다.
- 이스터에그(쫄라맨 야구)는 프런트 전용 — `sdynotes.html` 그대로 서빙하므로 유지.
- **디스크가 이제 영구 저장소** — 음원/이미지/보관함이 모두 VM 디스크에 쌓이므로,
  스냅샷/백업(`tar` 한 번이면 `sync/ cards/ db/ music/ stickers/ wallpaper/
  vault/ imported/` 전부 백업됨)을 주기적으로 챙기세요.

## 단계별 이관 상태

- **1단계 (완료)** — 가벼운 API 전체 + 가져오기/음악 무거운 작업 worker 분리.
  로컬 폴백 모드에서 음악 목록/재생/태깅/유튜브/인식까지 동작.
- **2단계 (완료)** — 클라우드(Supabase/Cloudinary) 모드의 음악 변이
  (업로드·유튜브·태깅·표지·가사·인식·백필)를 worker 로 이관
  (`music_cloud.py`, 원본 `cloud_routes.py` 보존 + 라우트 교체).
  클라우드 모드에서도 목록/재생/삭제/가사/표지는 Node 가 처리한다.
- **3단계 (완료)** — 전면 스모크 테스트(`test/smoke.py`): 프런트 엔드포인트
  62종 전부 커버 확인 + 로컬 음악 변이 라이프사이클 + PDF 가져오기
  파이프라인까지 검증.
- **4단계 (완료)** — 클라우드 모드 통합 검증(모의 Supabase/Cloudinary):
  worker 클라우드 음악 변이 34건, Node 클라우드 읽기/쓰기 26건 전부 통과.
  스티커/배경화면도 Supabase·Cloudinary 를 쓰도록 원본 계약에 맞게 보강.
- **5단계 (완료)** — 14.9 협업 편집: 같은 텍스트상자 동시 입력을 서버가
  3-way 병합(`server/src/lib/textmerge.js`, 최근 버전 히스토리)하고, 프런트가
  `prevRev`/`__base` 재기반으로 수렴. 설정 동기화 rev 충돌·커서 유실(핀 시 폴더
  이름 스왑)도 수정.
- **6단계 (완료, 14.12)** — Oracle 자체 저장소 전환: 상태 4종 + 노트 DB
  (notebooks/memos/images) + 모든 파일을 이 서버 디스크로. 프런트의 Supabase
  직접 접속 제거(SDB shim), 노트 이미지 서버 저장(`/api/img`), 일괄 이전
  스크립트(`scripts/migrate_to_oracle.mjs`). 예전 클라우드 모드는
  `SDY_STORAGE=cloud` 로 보존.

## 검증

```bash
# 두 서버가 켜진 상태에서
python3 test/smoke.py           # 전 엔드포인트 상태코드/본문 검증 (77건)
python3 test/collab_endpoint.py # 서버 3-way 병합 엔드포인트 (11건, 재실행 안전)

# 3-way 병합 알고리즘 (프런트/서버 공통 로직 단위 검증)
node test/merge3_unit.cjs       # 단위 테스트 (23건)
node test/merge3_prop.cjs       # 무작위 3000건 수렴성·무손실

# 설정 동기화 rev 충돌·커서 버그(핀 폴더 이름 스왑) 재현/수정 검증
node test/pinbug_sim.mjs        # 수정 전 발산 재현
node test/pinbug_fix_sim.mjs    # 수정 후 수렴 검증

# 14.11 — 12GB 메모리 배분 / 한 동작=한 기능 / 서버 릴레이 음성 계약
node test/tuning_one_action_contract.mjs
npm run test:call                 # 채팅 + 음성 릴레이 + nginx voice-ws 보강 + 프론트 스모크

# 14.12 — Oracle 자체 저장소 (로컬 DB·shim·이전 시뮬레이션)
node test/oracle_db_contract.mjs   # dbstore/db 라우트 + 노트 이미지 로컬 저장
node test/sdb_shim_contract.mjs    # 프런트 SDB shim ↔ 서버 descriptor 계약
node test/migrate_oracle_sim.mjs   # 모의 Supabase/Cloudinary → 오라클 이전 전 과정

# 클라우드(legacy) 모드 (실제 키 없이 모의 서버로)
python3 test/cloud_smoke.py     # worker 클라우드 음악 변이 (모의 Supabase+Cloudinary)
# ── 아래는 별도 터미널/셸 3개 ──
python3 test/mock_cloud.py      # 모의 PostgREST(:5231, http) + Cloudinary(:5232, https)
SDY_STORAGE=cloud \
SUPABASE_URL=http://127.0.0.1:5231 SUPABASE_SERVICE_KEY=test \
  CLOUDINARY_CLOUD_NAME=testcloud CLOUDINARY_API_KEY=k CLOUDINARY_API_SECRET=s \
  CLOUDINARY_UPLOAD_PREFIX=https://127.0.0.1:5232 NODE_TLS_REJECT_UNAUTHORIZED=0 \
  node server/src/index.js
python3 test/node_cloud_smoke.py  # Node 클라우드 읽기/쓰기 (26건)
```

- PDF 가져오기(업로드→변환→docfile→고해상도 배경 렌더)는 worker 의
  `importer.py`(원본 보존)가 그대로 처리한다.
- 협업 편집 병합 로직은 프런트(`mergeText3`)와 서버(`server/src/lib/textmerge.js`)
  가 동일한 훅 기반 diff3 를 공유해 양쪽이 같은 결과로 수렴한다.
- 클라우드 관련: `SDY_STORAGE=cloud` 로 배포한 경우에만 Supabase/Cloudinary 를
  읽는다. `CLOUDINARY_UPLOAD_PREFIX`(선택)는 Cloudinary 호환 프록시로 업로드를
  돌릴 때 쓴다(https 만 허용). 미설정 시 실제 Cloudinary API 를 쓴다.
