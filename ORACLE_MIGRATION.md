# Oracle 자체 저장소 전환 가이드 (14.12)

Supabase(무료 한도 초과)·Cloudinary(한도 초과 임박) 대신 **이 Oracle VM 디스크에
모든 데이터를 저장·실행**하는 구조로 바뀌었습니다. 이 문서는 전환·이전·롤백을
정리합니다.

## 무엇이 바뀌나

| 데이터 | 예전 (cloud 모드) | 지금 (oracle 모드, 기본) |
|---|---|---|
| 노트 동기화 상태 (sdy_sync_states) | Supabase | `sync/<id>.json` (요소별 LWW 병합은 동일) |
| 암기카드 덱 (sdy_card_decks) | Supabase | `cards/<id>.json` |
| 음악 메타 (sdy_music_tracks) | Supabase | `music/_index.json` |
| 스티커 메타 (sdy_stickers) | Supabase | `stickers/_index.json` |
| 노트 목록/본문 (notebooks·memos·images) | 브라우저가 Supabase 에 **직접** | `/api/db/query` → `db/<table>/<id>.json` |
| 노트에 붙인 이미지 | Cloudinary | `imported/` + `/api/img/<file>` |
| 음원 + 표지 | Cloudinary | `music/<mid>.<ext>` + `music/<mid>.cover` |
| 스티커 이미지 | Cloudinary | `stickers/<sid>.png` |
| 배경화면 | Cloudinary | `wallpaper/<wid>.<ext>` |
| 보관함 파일 | Cloudinary | `vault/<file>` |
| 유튜브 쿠키 백업 | Supabase | `music/_yt_cookies.txt` (+백업) |

브라우저는 `sdynotes.html` 안의 **SDB shim** 으로 예전 supabase-js 체인
(`.from('memos').select().eq()...`)을 그대로 쓰며, 요청은 같은 서버의
`/api/db/query` 로 갑니다. Supabase CDN 스크립트·anon 키·Cloudinary 직접
업로드 코드는 프런트에서 완전히 제거되었습니다.

## 전환 절차 (서버에서 3줄)

```bash
cd /var/www/memo          # 또는 새로 받은 배포 zip 을 푼 곳
sudo systemctl stop sdynotes sdynotes-worker
bash apply.sh             # ← 안에서 알아서: 이전 → SDY_STORAGE=oracle → 재시작
```

`apply.sh` 는 `.env` 에 옛 키(`SUPABASE_SERVICE_KEY`, `CLOUDINARY_*`)가 있고
아직 `.oracle_migrated` 마커가 없으면, 서비스가 정지된 상태에서
`scripts/migrate_to_oracle.mjs` 를 자동 실행합니다. 수동으로 돌리려면:

```bash
node scripts/migrate_to_oracle.mjs --base /var/www/memo --dry   # 리허설
node scripts/migrate_to_oracle.mjs --base /var/www/memo          # 실제 이전
```

이전은 **항상 원본을 읽기만 합니다** — Supabase/Cloudinary 에서 뭔가를 지우지
않으므로, 문제가 생겨도 원본은 그대로 남습니다.

## 이전 스크립트가 하는 일

1. Supabase 테이블 7종을 내려받아 로컬 저장소로 변환
   - sync 상태는 로컬 파일과 **요소(rev)별 LWW 병합** — 이전 전에 로컬 폴백으로
     쓰인 최신 편집도 유실되지 않습니다.
   - 음악 레코드는 원격(클라우드 기준) + 로컬의 빈 필드(가사 등) 보충 병합.
2. Cloudinary 자산 다운로드: 음원·표지·스티커·보관함 파일
3. 노트/설정/배경 콘텐츠에 박힌 모든 `res.cloudinary.com/...` URL(변형
   `f_auto,q_auto`, `w_,h_`, `v123` 포함)을 스캔해 원본을 내려받고 로컬
   주소로 일괄 치환
4. `yt_cookies` 행 → `music/_yt_cookies.txt`
5. 결과 리포트: `/var/www/memo/.oracle_migrated.report.json`
   (실패/404 목록도 여기에 기록됩니다)

이미 로컬에 있는 파일은 다시 받지 않으므로, 실패 후 재실행(`--force`)하면
빠진 것만 보강합니다.

## 확인

```bash
curl -s http://127.0.0.1:5000/api/cloud/status
# {"storage":"oracle","supabase":false,"cloudinary":false,"durable":true,
#  "local":{"files":N,"bytes":M}, ...}

# 브라우저에서: 노트 목록·본문·이미지·음악·스티커·배경·보관함이 전부 보이는지
```

**각 기기에서 앱 탭을 한 번 새로고침** 해 주세요(옛 캐시된 화면은 아직 Supabase
스크립트를 부르려다 조용히 실패할 수 있습니다). 새 화면(정보 → 버전 14.12.0)
에서는 로컬 DB 만 사용합니다.

Supabase/Cloudinary 대시보드의 API 트래픽 그래프가 0 으로 떨어지면 성공입니다.
며칠 확인한 뒤 두 프로젝트를 Pause/삭제해도 됩니다 (권장: 최소 1~2주 유지).

## 백업 (이제 디스크가 영구 저장소)

```bash
sudo tar czf ~/sdy-backup-$(date +%F).tar.gz -C /var/www/memo \
  sync cards db music stickers wallpaper vault imported .env
```

이 안에 서비스의 모든 상태·파일이 들어 있습니다. Oracle Cloud 의
부팅볼륨 스냅샷을 켜두면 더 안전합니다.

## 롤백 (예전 클라우드 모드로)

이전이 원본을 건드리지 않았으므로, 언제든 되돌릴 수 있습니다:

```bash
# /var/www/memo/.env 에 SDY_STORAGE=cloud 추가 (또는 배포 시 SDY_STORAGE=cloud)
echo 'SDY_STORAGE=cloud' | sudo tee -a /var/www/memo/.env
sudo systemctl restart sdynotes sdynotes-worker
```

단, oracle 기간 동안 서버 디스크에 새로 쓴 데이터는 클라우드로 올라가지
않습니다(롤백 시 그 데이터는 로컬 파일로만 존재). 롤백은 "클라우드 시점의
데이터"로 돌아가는 것이지 양쪽을 합치는 게 아닙니다.

## 자주 묻는 질문

- **Q. `.env` 에 옛 키가 남아 있는데 괜찮나요?**
  네. `SDY_STORAGE` 가 `oracle`(기본)이면 코드가 키를 전혀 읽지 않습니다.
  다만 이전 재실행을 위해 지우지 않아도 됩니다.
- **Q. 디스크가 부족해지면?**
  `df -h /var/www/memo` 으로 확인. Oracle Free Tier 부팅볼륨은 최대 200GB
  까지 무료 확장 가능(총 계산량 안에서)합니다. `curl /api/cloud/status`의
  `local.bytes` 로 현재 보유량을 볼 수 있습니다.
- **Q. 여러 기기에서 동시에 써도 되나요?**
  네 — 예전과 같은 요소별 LWW + 3-way 텍스트 병합이 그대로 서버(Node)에서
  돌아갑니다. 노트 DB(db/)도 테이블별 락으로 직렬화됩니다.
