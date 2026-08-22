# SDYnotes 14.9.0 — Fastify + Python worker (renewed, fast)

기존 단일 `app.py`(약 11,000줄)를 **"빠른 부분은 Node, 무거운 부분만 Python"** 으로
재설계한 백엔드입니다. 모든 엔드포인트 URL·응답 모양·로컬 폴백·Supabase/Cloudinary
동작은 원본(14.8.0)과 동일합니다. 프런트(`sdynotes.html`)에는 14.9.0 에서 아래 두
가지가 추가되었습니다(그 외는 원본 그대로).

- **같은 텍스트상자 동시 편집 병합**: 서버가 텍스트 요소의 최근 버전을 보관하고,
  같은 공통 조상에서 갈라진 두 기기의 편집을 3-way 병합해 양쪽을 모두 남깁니다
  (구글독스식). 프런트는 `prevRev`/`__base` 로 재기반하고, 편집 중인 상자도
  커서를 보존하며 실시간 반영합니다.
- **고정(pin) 시 폴더 이름 스왑 수정**: 설정 동기화의 rev 가 `Date.now()`(ms)라
  기기 간 rev 충돌 + `since` 커서 제외로 폴더/고정 연산이 유실·되돌림 되던 버그를
  고쳤습니다. (서브 ms 난수 rev + `since=0` 전체 pull + `_stApplied` 워터마크 +
  Lamport 시계 캐치업)

## 왜 이 구조인가

| 작업 | 어디서 | 이유 |
|---|---|---|
| 프런트 서빙, 동기화, 카드, 스티커, 배경화면, 알림, SSE, 관리자, 보관함 | **Node(Fastify)** | JSON CRUD + 스트리밍에 최적. 기동 수 ms, 동시 요청 빠름 |
| PDF/Word 가져오기 | **Python worker** | PyMuPDF·python-docx 그대로 사용 (원본 코드 보존) |
| 음악 태깅·유튜브·소리인식 | **Python worker** | yt-dlp·mutagen·AcoustID(fpcalc) 그대로 사용 (원본 코드 보존) |

Node 는 **읽기 전용**으로 `music/_index.json` 을 읽고, 그 파일의 **작성자는
worker 하나**뿐입니다 (원자적 교체라 읽는 쪽은 항상 안전). 알림/관리자 세션/SSE 는
Node 가 단일 소유하고, worker 가 내부 엔드포인트(`/internal/*`)로 위임합니다.

## 구조

```
sdynotes-fast/
├── package.json          Node 의존성
├── sdynotes.html         프런트 (원본 그대로)
├── apply.sh              배포 스크립트 (★서버에서 실행)
├── server/               Node(Fastify) 메인 서버
│   └── src/
│       ├── index.js      앱 조립 + 기동 (:5000)
│       ├── lib/          경로/설정/락/SSE/관리자/클라우드/워커프록시
│       └── routes/       pages·sync·admin·vault·cards·stickers·wallpaper·
│                         translate·notify·live·misc·music
└── worker/               Python 워커 (127.0.0.1:5100)
    ├── run.py            기동
    └── sdynotes_worker/
        ├── importer.py   가져오기 (원본 그대로 보존)
        ├── music.py      음악 태깅/유튜브/인식 (원본 그대로 보존)
        ├── music_cloud.py 클라우드 음악 변이 (cloud_routes.py 원본 보존) + 라우트 교체
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
# zip에 apply.sh · package.json · sdynotes.html · server/ · worker/ 를 모두 넣고
bash apply.sh
```

- `/var/www/memo/` 에 배포, systemd 서비스 2개:
  - `sdynotes`        (Node, :5000, 단일 프로세스)
  - `sdynotes-worker` (Python, 127.0.0.1:5100, 단일 프로세스)
- `.env` 보존, vault 데이터 보존, nginx(SSE 버퍼링 해제 + 512M 업로드 + 900초 타임아웃),
  swap, deno/bgutil(유튜브), fpcalc(소리인식) 자동 준비.

## 주의 (기존 운영 규칙 그대로)

- **단일 프로세스 전제** — worker 를 여러 개 띄우면 `music/_index.json` 이
  서로 덮어써져 곡이 사라질 수 있습니다. gunicorn 다중 worker 금지.
- `SUPABASE_SERVICE_KEY` 등 비밀키는 zip/로그/프런트에 절대 노출 금지.
- 키가 없으면 로컬 폴더 폴백으로 그대로 동작합니다.
- `APP_VERSION` 은 프런트 `<meta name="application-version">`(14.9.0) 와 일치해야
  합니다.
- **14.9.0 에서 엽스코드(Youpscord) 채팅·WebRTC 음성 통화를 제거**했습니다.
  프런트의 둥근 채팅 버튼, `/api/chat/*` 엔드포인트, coturn(TURN) 설치와
  Oracle 인그레스(UDP/TCP 3478, UDP 49160-49200)가 모두 필요 없어졌습니다.
  구버전 서버라면 `bash apply.sh` 를 다시 실행해 coturn 을 중지하면 됩니다.
- 이스터에그(쫄라맨 야구)는 프런트 전용 — `sdynotes.html` 그대로 서빙하므로 유지.

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

# 클라우드 모드 (실제 키 없이 모의 서버로)
python3 test/cloud_smoke.py     # worker 클라우드 음악 변이 (모의 Supabase+Cloudinary)
# ── 아래는 별도 터미널/셸 3개 ──
python3 test/mock_cloud.py      # 모의 PostgREST(:5231, http) + Cloudinary(:5232, https)
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
- `CLOUDINARY_UPLOAD_PREFIX`(선택)는 Cloudinary 호환 프록시로 업로드를
  돌릴 때 쓴다(https 만 허용). 미설정 시 실제 Cloudinary API 를 쓴다.
