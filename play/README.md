# play/ — 플레이스토어 발매판

안드로이드(갤럭시 스토어 → Google Play)로 내보내는 것만 담는다.
실제 내용은 전부 **`play/playstore/`** 안에 있다 — 이 문서는 길잡이다.

| 자리 | 무엇 | 자세히 |
|---|---|---|
| `playstore/` | 발매판 전체(조립·검사·문구·법적 문서) | `playstore/README.md` |
| `playstore/scripts/build.mjs` | PWA 조립 → `playstore/build/` (TWA 가 감쌀 웹앱) | 같은 문서 §조립 |
| `playstore/twa/` | TWA(주소창 없는 안드로이드 앱) 준비 | `playstore/twa/README.md` |
| `playstore/server-play/` | 발매판 정적 서버(로컬 확인용) | — |
| `playstore/docs/` | 스토어 문구·출시 계획 | `playstore/docs/listing.md` |

## 지금 상태

- 조립·검사 완료: `node play/playstore/scripts/test-all.mjs` → 6단계 전부 통과
- 남은 것: JDK·Android SDK 가 있는 기기에서 `bubblewrap build` (AAB), 서명 키,
  플레이 콘솔 등록($25 1회), 갤럭시 스토어 등록(무료)
- 도메인은 `site.mjs`(루트) 한 곳에서 온다 — TWA 의 host·assetlinks 도 따라온다
