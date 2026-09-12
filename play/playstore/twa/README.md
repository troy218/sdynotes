# TWA 포장 — 안드로이드 앱으로 내기

`notesis` 는 이미 설치형 웹앱(PWA)입니다. **TWA(Trusted Web Activity)** 는 그 웹앱을
안드로이드 앱 껍데기에 담아 스토어에 올리는 방식입니다. 앱을 열면 주소창이 없고,
내용은 서버에서 그대로 옵니다 — **웹을 고치면 앱도 같이 고쳐집니다.**

```
웹(PWA) ── 이미 완성 ─┐
                      ├─→ TWA(AAB) ─→ 갤럭시스토어 (무료) → 구글플레이 ($25)
서명 키 + 지문 ────────┘
```

## 왜 TWA 인가 (심사에서 중요)

| 방식 | 애플 심사 | 구글 심사 | 유지보수 |
|---|---|---|---|
| 웹뷰 껍데기 | **4.2 리젝** | 통과 | 웹 고칠 때마다 앱 재배포 |
| **TWA** | (해당 없음) | 통과 | **웹만 고치면 됨** |

웹뷰 껍데기(WebView wrapper)는 애플 4.2 "최소 기능" 조항에 걸립니다. TWA 는 실제
크롬 엔진이 돌고 사이트 소유가 증명돼 있어 이 지적을 피합니다. 안드로이드는 TWA 로
먼저 내고, 애플은 나중에 별도 판단합니다(`docs/store_plan.md` §9).

## 1. 준비물

```bash
# JDK 17 이상
java -version
# Android SDK (명령줄 도구) — https://developer.android.com/studio#command-tools
sdkmanager "platforms;android-34" "build-tools;34.0.0"
export ANDROID_HOME=$HOME/Android/Sdk

npm i -g @bubblewrap/cli
bubblewrap doctor          # 준비물을 스스로 점검해 줍니다
```

## 2. 서명 키 만들기 (한 번만 · **절대 잃어버리면 안 됨**)

```bash
keytool -genkey -v -keystore android.keystore -alias notesis \
  -keyalg RSA -keysize 2048 -validity 10000
```

> 이 키를 잃으면 **앱을 영영 업데이트할 수 없습니다.** 비밀번호와 함께 안전한 곳에
> 백업하세요. (구글플레이에 올리면 플레이가 별도 '앱 서명 키'를 만들고, 우리 키는
> 업로드 키가 됩니다 — 지문이 두 개가 되므로 둘 다 등록해야 합니다.)

## 3. 도메인·지문 등록 (저장소에서 자동 처리)

```bash
cd play/playstore
node scripts/twa-prepare.mjs --host <실제 도메인> --keystore android.keystore --alias notesis
```

이 명령이 하는 일:

| 만드는 것 | 쓰이는 곳 |
|---|---|
| `twa/twa-manifest.json` | bubblewrap 빌드 입력 |
| `.well-known/assetlinks.json` | **TWA 가 주소창을 지우는 증명서** |

`.well-known/assetlinks.json` 은 서버가 `/.well-known/assetlinks.json` 으로 그대로
내보냅니다(`server/src/routes/wellknown.js`). 환경변수로도 넣을 수 있습니다:

```bash
SDY_ANDROID_SHA256="AB:CD:...:EF" \
SDY_ANDROID_PACKAGE="app.notesis.notes" \
node server/src/index.js
```

배포 후 **반드시** 확인:

```bash
curl https://<도메인>/.well-known/assetlinks.json
curl https://<도메인>/api/app/status
```

지문이 아직 등록되지 않았으면 404 와 함께 등록 방법을 알려 줍니다.

## 4. AAB 굽기

```bash
cd play/playstore/twa
bubblewrap init --manifest twa-manifest.json --directory android
bubblewrap build
```

나오는 것:

| 파일 | 쓰임 |
|---|---|
| `app-release-bundle.aab` | **갤럭시스토어·구글플레이 제출용** ← 이걸 올립니다 |
| `app-release-signed.apk` | 내 폰에 직접 설치해 확인용 |

> `twa-manifest.json`·`.well-known/assetlinks.json`·`android/` 는 `.gitignore` 에
> 넣어 두었습니다(지문이 들어 있어 사람마다 다르고, 키와 함께 관리해야 합니다).
> 대신 `twa-manifest.example.json` 이 형식의 기준입니다.

## 5. 스토어 등록

| 항목 | 값 |
|---|---|
| 앱 이름 | `notesis` |
| 패키지 | `app.notesis.notes` |
| 카테고리 | 생산성 (Play) / 교육·생산성 (갤럭시) |
| 피처 그래픽 | `build/store/feature-graphic-1024x500.png` **(Play 필수)** |
| 대표 이미지 | `build/store/cover-1200x630.png` |
| 개인정보처리방침 | `https://<도메인>/privacy` |
| 이용약관 | `https://<도메인>/terms` |
| 계정 삭제 안내 | `https://<도메인>/privacy` 안의 '계정 삭제' 절 |
| 지원 이메일 | `dyshin218@gmail.com` |
| 데이터 안전 | 기기 저장 · 서버에는 계정 정보와 AI 사용 기록만 |

스토어 문구·스크린샷 초안은 `docs/listing.md` 에 그대로 쓸 수 있게 정리돼 있습니다.

## 6. 순서 (중요)

```
① 서버 배포 (/.well-known/assetlinks.json 이 열리는지 확인)
② AAB 업로드 → 갤럭시스토어(Seller Portal, 등록 무료, 수수료 20%)
③ 잘 되면 구글플레이 ($25 1회, 수수료 최대 30% — 2025-05 부터 국내 20% 정책 확인 필요)
④ 애플은 마지막
```

**① 없이 ②를 하면** 앱은 열리지만 주소창이 남습니다. 심사에서 지적되니 순서를 지키세요.

## 자주 걸리는 곳

| 증상 | 원인 | 해결 |
|---|---|---|
| 주소창이 그대로 보임 | assetlinks 지문 불일치 | `/api/app/status` 로 등록값 확인, 플레이 앱 서명 지문 추가 |
| 앱이 흰 화면 | startUrl·도메인 오타 | `twa/twa-manifest.json` 의 host·startUrl 확인 |
| 업데이트가 안 됨 | appVersionCode 가 그대로 | 빌드가 `package.json` 버전에서 자동 계산(`build.twa.appVersionCode`) |
| 폰에서 뒤로가기가 앱을 닫음 | TWA 기본 동작 | 정상입니다(웹 히스토리를 따라갑니다) |
