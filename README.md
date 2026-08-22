# SDYnotes 14.8.0 — Fastify + Python worker (renewed, fast)

기존 단일 `app.py`(약 11,000줄)를 **"빠른 부분은 Node, 무거운 부분만 Python"** 으로
재설계한 백엔드입니다. 모든 엔드포인트 URL·응답 모양·로컬 폴백·Supabase/Cloudinary
동작은 원본(14.8.0)과 동일합니다. 프런트(`sdynotes.html`)에는 14.9 에서 아래 두
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
- 엽스코드(Youpscord) 채팅(전부 인메모리 — 영구 저장 없음):
  `/api/chat/join|ping|leave|msg|upload|react|voice|signal|del|bgm|knock`,
  `/api/chat/file/:id`, `/api/chat/stream`(SSE), `/api/chat/config`(ICE 설정).
  앱 전체 공용 1개 방. 닉네임은 라이브 새 이름 + 파스텔 색.
  실시간 음성은 WebRTC mesh(시그널링만 Node가 릴레이).
  - 채팅·offer/answer/ICE는 SSE 응답에 **즉시 push**한다. LTE↔Wi-Fi 전환으로
    EventSource가 잠시 끊겨도 사용자별 대기 큐에 보관했다가 재연결 즉시 전달한다.
  - STUN(Google + Cloudflare)은 기본 내장. **같은 네트워크가 아니면 대칭 NAT·
    통신사 CGNAT·방화벽 뒤에서 STUN만으로는 연결이 안 되므로 TURN이 필수다.**
  - `apply.sh`는 Oracle VM에 coturn을 자동 설치하고, `.env`의
    `SDY_LOCAL_TURN_URL`/`SDY_TURN_SECRET`을 자동 생성한다. 브라우저에는 HMAC
    기반 1시간짜리 임시 인증만 전달한다. 자동 설치를 끄려면
    `SDY_SETUP_TURN=0`을 사용한다.
  - 외부 TURN을 따로 쓰는 경우 기존 방식도 함께 지원한다:
    `SDY_TURN_URL=turn:도메인:3478`, `SDY_TURN_USER=...`, `SDY_TURN_PASS=...`.
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
# zip에 apply.sh · package.json · sdynotes.html · server/ · worker/ 를 모두 넣고
bash apply.sh
```

- `/var/www/memo/` 에 배포, systemd 서비스 2개:
  - `sdynotes`        (Node, :5000, 단일 프로세스)
  - `sdynotes-worker` (Python, 127.0.0.1:5100, 단일 프로세스)
- `.env` 보존, vault 데이터 보존, nginx(SSE 버퍼링 해제 + 512M 업로드 + 900초 타임아웃),
  swap, deno/bgutil(유튜브), fpcalc(소리인식), coturn(통화 릴레이) 자동 준비.

### Oracle Cloud에서 서로 다른 망 통화 허용 (필수 1회)

`apply.sh`가 VM 안의 coturn/UFW는 설정하지만 **VM 밖에 있는 Oracle VCN 방화벽은
코드로 변경할 수 없습니다.** Oracle Console → Networking → VCN → Security Lists
(또는 해당 NSG) → Ingress Rules에서 다음을 한 번 열어 주세요.

| Source CIDR | Protocol | Destination port | 용도 |
|---|---|---:|---|
| `0.0.0.0/0` | UDP | `3478` | TURN 기본 경로(LTE/Wi-Fi 권장) |
| `0.0.0.0/0` | TCP | `3478` | UDP 차단 망의 대체 경로 |
| `0.0.0.0/0` | UDP | `49160-49200` | TURN 미디어 릴레이 |

그 뒤 서버에서 `bash apply.sh`를 다시 실행하고 마지막 결과의
`통화 TURN : 준비됨`을 확인합니다. 웹 마이크는 보안 컨텍스트에서만 열리므로 실제
접속 주소도 **HTTPS 도메인**이어야 합니다(`localhost`만 예외).

확인 명령:

```bash
systemctl status coturn --no-pager
curl -s 'http://127.0.0.1:5000/api/chat/config?uid=test'
# 결과에 "turn":true 및 turn:<Oracle 공인 IP>:3478 이 있어야 함
```

공인 IP 자동 감지가 실패하면 `/var/www/memo/.env`에
`SDY_TURN_PUBLIC_IP=오라클_공인_IP`를 추가한 뒤 `bash apply.sh`를 다시 실행합니다.

#### 자주 막히는 함정 (체크리스트)

1. **VCN 인그레스가 다 열렸는데도 통화 안 됨** — `curl /api/chat/config` 가
   `turn:true` 를 주는지 확인. `turn:false` 면 Node 가 TURN 인증을 못 만들고
   있다는 뜻이므로 `SDY_TURN_SECRET` (또는 `SDY_TURN_USER`+`SDY_TURN_PASS`) 이
   `systemctl show sdynotes -p Environment` 결과에 포함되는지 확인.
2. **"연결 중"에서 멈춤, ICE candidate 가 `relay` 가 안 잡힘** — 브라우저
   DevTools → `chrome://webrtc-internals` 에서 `Local Address` 가 49160~49200
   사이로 잡히면 정상. 안 잡히면 `relay-ip` 를 안 박은 현재 설정(자동 라우팅)
   으로 해결된다. 옛 버전의 `relay-ip=$TURN_PRIVATE_IP` 는 VCN 환경에서
   hairpin 함정에 빠져 일부 클라이언트가 relay candidate 를 버린다.
3. **VM 안에서 `bash -c 'exec 3<>/dev/tcp/$PUBIP/3478'` 가 `No route to host`** —
   Oracle VCN 의 source/dest check 또는 hairpin 차단. 외부 클라이언트 →
   공인 IP 경로에는 영향이 없으니 **무시해도 된다.** 정말로 외부에서도 막힌
   것이라면 VCN Security List 의 Source CIDR 가 `0.0.0.0/0` 가 맞는지 다시 확인.
4. **`turn:host:3478` 만 주고 TCP 를 안 붙인 경우** — 브라우저는 쿼리 없는
   `turn:` URL 을 UDP 전용으로 취급한다. Oracle 인그레스에 TCP 3478 을 열어
   둬도 브라우저가 시도하지 않아 통신사 UDP 차단 망에서 '연결 중'에 멈춘다.
   Node 는 베이스 URL 에서 UDP(쿼리 없음) + `?transport=tcp` 를 **별도
   iceServers 엔트리**로 나눠 내려 준다. 예전 버전에서 업그레이드했다면
   브라우저 캐시를 비우고 `curl /api/chat/config` 결과에
   `turn:IP:3478?transport=tcp` 가 있는지 확인한다.
5. **TURN 인증이 401 로 reject** — `lt-cred-mech` 가 켜져 있는지 확인
   (`grep ^lt-cred-mech /etc/turnserver.conf`). 그리고 VM 시계가
   `date` 기준 ±5 분 이내여야 HMAC 임시 인증이 통과한다
   (`sudo apt-get install -y chrony` 로 NTP 동기화).

## 주의 (기존 운영 규칙 그대로)

- **단일 프로세스 전제** — worker 를 여러 개 띄우면 `music/_index.json` 이
  서로 덮어써져 곡이 사라질 수 있습니다. gunicorn 다중 worker 금지.
- `SUPABASE_SERVICE_KEY` 등 비밀키는 zip/로그/프런트에 절대 노출 금지.
- 키가 없으면 로컬 폴더 폴백으로 그대로 동작합니다.
- `APP_VERSION` 은 프런트 `<meta name="application-version">`(14.8.0) 와 일치해야
  합니다.
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
