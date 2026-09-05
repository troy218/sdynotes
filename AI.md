# AI 노트 도우미 설정 (14.27.0 · 형광펜·표 삭제·보기 좋은 배치)

**14.26.0부터 해돌이는 문서뿐 아니라 앱 기능도 직접 실행한다.** 검색창에
`봄날 틀어줘`, `5분 타이머 맞춰줘`, `회의록 노트 열어줘`처럼 쓰면 **앱 실행
모드로 자동 라우팅**된다(질문처럼 보이면 그냥 답한다). 꼭 앱 실행으로 보내고
싶을 때만 `/앱 ...`, `/app ...`, `앱: ...`을 쓰면 된다. 입력 중에는 검색창에
**앱 실행 딱지**가 붙는다. 해돌이는 앱 상태(노트 목록·음악·집중 화면)를 읽고
노래 재생·타이머·노트 열기 같은 동작을 순서대로 실행한다. 답이 완성되기 전에는
아무것도 건드리지 않으며, 완료된 명령을 브라우저가 다시 검증한 뒤 실행한다.

**14.25.0부터 해돌이는 `!` 없이도 고쳐 달라는 말을 알아듣는다.** 검색창에
`제목을 맨 위로 옮겨 줘`, `표 만들어 줘`처럼 쓰면 **편집 모드로 자동 라우팅**
된다(질문처럼 보이면 그냥 답한다). 꼭 편집으로 보내고 싶을 때만 `!`로 시작하거나
`/편집 ...`, `/edit ...`, `편집: ...`을 쓰면 된다. 입력 중에는 검색창에
**편집 딱지**가 붙는다. 해돌이는 현재 문서 구조를 읽고 글상자 내용·위치·크기,
사진/수식 위치·크기, 그림획 위치를 고치거나 글상자를 추가·삭제한다. 답이 완성되기
전에는 아무것도 건드리지 않으며, 완료된 명령을 브라우저가 다시 검증한 뒤 한 번에
반영한다. 모든 변경은 **Ctrl+Z 한 번으로 되돌릴 수 있다**(되돌리기 직후 동기화
에코가 서식을 되살리는 문제도 가드로 막는다).

**사람 손처럼 편집(14.27.0):** 해돌이가 못 하던 세 가지가 된다.
① **형광펜을 글귀 단위로** — `@hl 상자id | 찾을 글 | 색`으로 중요한 글귀만 칠한다
(색 생략 = 노랑, `없음` = 그 글귀만 지우기). 상자 전체 배경은 예전처럼 `@st hl`
또는 `@hl 상자id | 색`이다. 스냅샷에 `⟦…⟧`로 이미 칠해진 곳이 보이므로 겹쳐
칠하지 않는다. ② **표 삭제** — `@del`에 표 id는 물론 표 칸 id·테두리 id를 넣어도
표 전체가 지워진다(`@tdel` 별칭). ③ **보기 좋은 배치** — 새 상자·표는 `auto`로
자리·크기를 맡기면 본문 왼쪽 끝·너비를 따라 겹치지 않는 빈자리에 8px 격자로
앉고 높이는 글이 넘치지 않을 만큼 잡힌다. 쪽이 어수선하면 `@tidy 쪽번호`.
여기에 **최근 대화 5턴을 묶어 문맥으로** 실으므로 "아까 그 상자", "방금 만든 표
지워" 같은 이어서 하기가 이어진다.

**똑똑해진 편집(14.25.0):** 해돌이가 스냅샷의 서식·표 정보를 보고 어디를 어떻게
고칠지 스스로 정한다 — 글 일부만 바꾸기(`@rp`), 줄 덧붙이기(`@ap`), 글꼴·크기·
색·형광펜·굵기·기울임·밑줄·취소선·정렬과 그림획 펜색·굵기 바꾸기(`@st`), 표 만들기·
크기·이동·칸 채우기(`@tbl`/`@tsz`/`@tmv`/`@tcell`), 클립보드 붙여넣기·복사하기
(`@clip`/`@clipin`/`@copy`), 새 쪽·쪽 이동·제목 바꾸기(`@newpage`/`@goto`/
`@title`). 대상이 모호하면 실행 대신 `@ask`로 되묻고, 그 답은 다음 편집에 이전
대화로 함께 전달된다. `chat`에서 편집 요청이 오면 `[[edit]]` 표식으로 편집기가
이어받는다.

일반 질문은 기존과 같다. 노트를 열 때마다 해돌이 옆에 **작은 검색창**이 붙어 있고,
궁금한 것을 쓴 뒤 **그냥 Enter를 누르면** 된다(별도 보내기 버튼 없음 — 한글 조합
중에는 보내지 않는다). 해돌이가 **노트 질문인지 자유 질문인지 스스로 판단해서**
딱지로 알려 준다. 답은 **말하는 말풍선**에 흘러나오고(SSE 스트림), **내가 닫기
버튼을 누르기 전까지는 그 자리에 그대로** 남는다. 모델 이름·소요 초 같은 기술
정보는 화면에 보여주지 않는다. **`이 페이지`** 와
**`전체 페이지`** 는 검색창 바로 위의 범위 버튼 둘 — 지금 보는 쪽만 물을지
문서 전체를 물을지 고른다(서버 task 는 둘 다 `outline`). 노트 글이
**켜지는 순간 백그라운드에서 미리 받아 두므로**, 누르는 순간 답한다.
지난 이야기는 **해돌이를 살짝 누르기만** 하면 최신순으로 다시 볼 수 있고,
아이디어(전구) 변신은 **커서를 올렸을 때(호버)** 나온다.

**기본값은 '끔'이다.** 키가 하나도 없으면 `/api/ai/status` 가 `enabled:false` 를
돌려주고, 검색창 옆의 점이 주황으로 뜬다(점 위에 손을 띄면 무슨 뜻인지 말로
알려 준다). 서버 `.env` 에 키(예: `GEMINI_API_KEY`)가 들어가면 점이 초록이
된다. 사이트 다른 부분은 영향을 받지 않는다. 키가 없으면 해돌이가
*'AI 키가 아직 등록되지 않았어요'* 라고 말풍선으로 말해 준다.

---

## 0) "arena.ai 계정으로 우회"는 하지 않는다

arena.ai 에 계정을 만들어 내부 엔드포인트를 부르는 우회 경로는 **쓰지 않는다.**

- 첫 화면 약관: *"Inputs are processed by third-party AI... Your conversations and
  certain other personal information will be disclosed to the relevant AI providers
  and **may otherwise be disclosed publicly**"*, *"Do not submit... any personal
  information... that you would not want to be shared publicly"*,
  *"We also use your conversations for automated evaluation."*
- 페이지 끝에 reCAPTCHA 가 걸려 있고, `api.arena.ai`·`docs.arena.ai`·
  `developers.arena.ai` 는 DNS 레코드 자체가 없다.
- **무엇보다 이건 노트 앱이다.** 우회로 붙이면 개인 노트 본문이 제3자 소비자 계정
  경로를 타고 넘어가고 공개될 수 있다. 잠깐 동작해도 그게 최대 손실이다.

대신 아래 **합법 무료 티어**나 **로컬(Ollama)** 을 쓴다. 둘 다 이 저장소가 이미
지원한다.

> 참고: '아레나 UI' 자체는 오픈소스다 — `lm-sys/FastChat`(Apache-2.0)의
> `python3 -m fastchat.serve.gradio_web_server_multi` 가 그 Gradio 화면이다.
> 그건 **비교 사이트를 따로 띄울 때** 쓰는 물건이고(별도 Python service + nginx
> WebSocket 경로 필요), 이 노트 앱에는 필요 없다.

## 1) 공급사 체인 — 무료 티어 한도가 걸리면 다음 공급사로

`translate.js` 가 Google 호스트 3개를 순회하듯, **429 를 맞은 공급사만 잠시 쉬고
다음 공급사로 넘어간다.** 전부 막혀야 비로소 '제한' 안내가 나간다.

### ★ 이미 Gemini API 키를 serv 홠에 넣어 두셨다면 — 이것만 하면 됩니다

```ini
# /var/www/memo/.env
AI_PROVIDERS=gemini
GEMINI_API_KEY=AIza...(이미 넣어 두신 그 키)
```

그리고 서비스 재시작. 확인:

```bash
curl -s localhost:5000/api/ai/status
# → {"enabled":true,"providers":[{"name":"gemini","model":"gemini-2.5-flash"}], ...}
```

**키 이름이 `GEMINI_API_KEY` 가 아니면** 두 가지 중 하나:

- `.env` 에서 이름을 `GEMINI_API_KEY` 로 바꾸거나 (권장),
- 수동 경로로 직접 지정 — 예전 방식 그대로 동작합니다:
  ```ini
  AI_KEY=<그 키>
  AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
  AI_MODEL=<모델명>
  ```

**키는 `.env` 에만 두세요.** `.gitignore` 3번째 줄이 `.env` 라 git 에는 안 들어갑니다
(이 저장소에 실제 키가 박힌 곳이 없는지 `grep -rn "AIza"` 로 확인했습니다 —
`AI.md` 의 자리표시자 `AIza...` 하나뿐). 소스 파일에 직접 박으면 커밋과 함께
공개 저장소로 나갑니다.

### 모델명은 꼭 한 번 확인하세요

프리셋 기본값은 `gemini-2.5-flash` 인데, **Gemini 모델명은 자주 바뀝니다.**
내 키에서 지금 쓸 수 있는 이름은 이렇게 뽑습니다:

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/openai/models" \
  -H "Authorization: Bearer $GEMINI_API_KEY" | grep '"id"' | head -20
```

다른 이름이면 덮어씁니다:

```ini
GEMINI_MODEL=<위에 나온 id>
```

안 그러면 `404` 가 떨어지고, 해돌이 말풍선에는 *"gemini · 모델을 못 찾았어요(404)
· curl "<base>/models" 로…"* 힌트가 뜹니다. `401` 이면 *"키가 거부됐어요(401) ·
Google AI Studio 에서 만든 API 키가 맞는지… (Vertex AI 서비스계정 키는 여기서 안
됩니다)"* 가 뜹니다 — **AI Studio 키(aistudio.google.com)여야 하고 Vertex AI
서비스계정 자격증명은 이 엔드포인트에서 안 됩니다.**

엔드포인트 자체는 Google 공식 OpenAI 호환 경로
`https://generativelanguage.googleapis.com/v1beta/openai` + `Authorization: Bearer <키>`
+ `/chat/completions` 입니다 — 이 저장소가 부르는 것과 정확히 같습니다
([공식 문서](https://ai.google.dev/gemini-api/docs/openai)).

### ★ 같은 키로 모델 여러 개 걸어 두기 — 무료 티어 '한도 라우팅'

무료 티어의 한도는 **모델마다 따로** 잡힙니다. 예를 들어 `Gemini 3.5 Flash` 가
하루치(RPD)를 다 쓰면 막히지만, `Gemini 3.1 Flash Lite`·`Gemini 3.5 Flash Lite`
는 아직 남아 있을 수 있습니다. 그래서 GEMINI 키 **하나로** 모델을 여러 개 나열해
두면, 앞 모델이 429(한도)를 주면 **같은 키로 다음 모델로** 자동으로 넘어갑니다.
체인이니 전부 막혀야 비로소 '제한' 안내가 나갑니다.

```ini
# /var/www/memo/.env  (로컬은 저장소 루트 .env)
AI_PROVIDERS=gemini
GEMINI_API_KEY=AIza...(그 키 하나면 충분)
GEMINI_MODELS=gemini-3.5-flash,gemini-3.1-flash-lite,gemini-3.5-flash-lite
```

- `<이름>_MODELS` 는 **콤마(,) 목록** — 순서대로 시도합니다.
- `<이름>_MODELS` 가 있으면 단일 `<이름>_MODEL` 보다 우선합니다.
- 수동 경로도 똑같습니다: `AI_MODELS=m1,m2` (없으면 `AI_MODEL` 하나).
- `AI_PROVIDERS` 를 안 적어도 프리셋 키만 있으면 자동으로 잡힙니다
  (`GEMINI_API_KEY` + `GEMINI_MODELS` 만 있어도 됨).
- **자기 키에서 정말 쓸 수 있는 모델명**은 위에 있는
  `curl "…/v1beta/openai/models"` 로 뽑은 id 를 쓰세요. 없는 이름을 넣으면
  `404` 가 나고 다음 모델로 넘어갑니다.
- `/api/ai/status` 의 `providers` 에는 같은 공급사가 **모델별로** 나타납니다.
- 예: `/var/www/memo/.env` 를 고쳤으면 `sudo systemctl restart sdy` 후
  `curl -s localhost:5000/api/ai/status` 로 확인.

> 참고 — 국내 오픈소스 노트앱 운영 관례대로, **무료 티어 한도는 자주 바뀝니다.**
> 숫자를 외우지 말고 Google AI Studio 대시보드에서 확인하세요. 이 앱은 그래서
> 공급사 체인(`AI_PROVIDERS=gemini,groq`)과 모델 체인(`GEMINI_MODELS=…`)을
> 모두 지원합니다. 둘을 함께 써도 됩니다.

### 다른 공급사와 함께 쓰기 (체인)

```ini
# /var/www/memo/.env  (로컬은 저장소 루트 .env)

# ── A. 무료 티어 2개 체인 (Gemini 가 한도에 걸리면 Groq 로) ──
AI_PROVIDERS=gemini,groq
GEMINI_API_KEY=AIza...
GROQ_API_KEY=gsk_...

# ── B. 로컬 Ollama — 키 0원 · 외부 전송 0 (노트 앱엔 이게 제일 안전) ──
#AI_PROVIDERS=ollama
#OLLAMA_MODEL=qwen2.5:3b
#   curl -fsSL https://ollama.com/install.sh | sh && ollama pull qwen2.5:3b
#   MIGRATION_AMD_TO_ARM.md 권장 Always Free(4 OCPU/24GB) 면 3B 급 CPU 추론 가능.
#   2코어/저RAM 이면 많이 느리다 — 1.5B 급으로 내린다.

# ── C. 수동 1곳 (예전 방식 그대로 동작) ────────────────────────
#AI_KEY=sk-...
#AI_BASE_URL=https://api.openai.com/v1
#AI_MODEL=gpt-4o-mini
```

### 프리셋 (`AI_PROVIDERS` 에 쓸 수 있는 이름)

| 이름 | 기본 `AI_BASE_URL` | 기본 모델 | 키 env |
|---|---|---|---|
| `groq` | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | `GROQ_API_KEY` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` | `GEMINI_API_KEY` |
| `openrouter` | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` | `OPENROUTER_API_KEY` |
| `openai` | `https://api.openai.com/v1` | `gpt-4o-mini` | `OPENAI_API_KEY` |
| `ollama` | `http://127.0.0.1:11434/v1` | `qwen2.5:3b` | (`OLLAMA_API_KEY`, 없으면 자리표시자) |

- `AI_PROVIDERS` 를 안 적어도 **키가 있는 프리셋은 자동으로 붙는다.**
- `<이름>_BASE_URL` · `<이름>_MODEL` 로 개별 덮어쓰기 가능 (예: `OLLAMA_MODEL`).
- `<이름>_MODELS` 로 **모델 여러 개**를 체인에 올릴 수 있다 (같은 키로 429 시 다음 모델로,
  위 "같은 키로 모델 여러 개 걸어 두기" 참고).
- **키는 서버에서만 읽는다.** 프런트(`sdynotes.js`)에 키를 심지 말 것 — 이 사이트는
  전역 CSP 가 없어서 JS 에 박힌 값은 그대로 노출된다.

### ⚠ 무료 티어를 고를 때 — 노트 앱이라 '학습 사용' 여부가 중요하다

| 공급사 | 무료 티어 | 입력을 학습에 쓰나 |
|---|---|---|
| **Groq** | 있음(모델별 하루 한도) | **아니요** ← 개인 노트에 안전 |
| **Google Gemini** | 있음(Flash 계열) | **예** — 무료 티어는 Google 제품 개선에 사용될 수 있음 |
| **OpenRouter** | 일부 `:free` 모델 | 모델마다 다름 |
| **Ollama(로컬)** | 무제한 | **서버 밖으로 안 나감** |

무료 티어의 **정확한 하루 한도는 자주 바뀝니다.** 숫자를 외우지 말고
각자 대시보드(Groq Console / Google AI Studio)에서 확인하세요. 그래서 이 앱은
한 공급자가 막히면 다음으로 넘기는 체인으로 만들어 두었습니다.

## 2) 그 외 설정 (전부 기본값이 안전하다)

| 변수 | 기본 | 뜻 |
|---|---|---|
| `AI_MAX_TOKENS` | `2500` | 응답 길이 상한 (256~8000 clamp). 14.22.0 에 900 → 1800, **14.27.0 에 2500** — 편집 명령이 40개까지 늘면서 `@` 명령 묶음이 길어졌다 |
| `AI_MAX_TEXT` | `30000` | 한 번에 보내는 노트 본문/편집 상태 길이(자). 넘으면 **앞 70% + 뒤 30%** 를 살리고 가운데만 접는다 (`truncated:true`, `note_chars` 에 원본 길이) |
| `AI_MAX_QUESTION` | `1200` | 사용자 요청 길이 상한(자). 14.27.0 에 600 → 1200 — "이 상자는 이렇게, 저 상자는 저렇게" 같은 긴 편집 요청을 통째로 받는다 |
| `AI_MAX_CONTEXT` | `6000` | `edit`·`app` 에 싣는 **이전 대화 문맥** 상한(자). 14.27.0 부터 직전 1턴이 아니라 프런트가 묶어 보낸 최근 5턴(질문·편집·실행 전부)을 그대로 싣는다 |
| `AI_TIMEOUT_MS` | `45000` | 모델 호출 타임아웃 (스트림은 '전체' 시간) |
| `AI_CACHE_TTL_MS` | `600000` | 같은 입력 캐시 유지 (0 = 끔) |
| `AI_RATE_N` / `AI_RATE_WINDOW_MS` | `12` / `60000` | uid(없으면 ip)별 60초당 요청 수 |
| `AI_WARM_N` | `AI_RATE_N/2` | **이 페이지·전체 페이지 정리 미리 준비**(`warm:true`) 전용 한도 — 사용자가 누른 요청과 섞이지 않는다 (0 = 미리 준비 끔) |

### 스트리밍

`POST /api/ai/ask` 에 `stream:true` 를 주면 SSE 로 답한다.

```
event: meta   data: {"truncated":false,"chars":123,"note_chars":123,"cached":false}
event: delta  data: {"t":"광합성은 "}          ← 모델이 만드는 대로 여러 번
event: done   data: {"text":"...","provider":"gemini","model":"...","cached":false}
event: error  data: {"ok":false,"limited":true,"retry_after":37,"error":"..."}
```

- 캐시에 있으면 `delta` 한 방 + `cached:true` — '누르면 바로 나오는' 그 경로다.
- 스트림을 못 주는 모델(응답이 JSON 으로 오는 곳)이면 알아서 한 방으로 받는다.
- 조각이 이미 나간 뒤에는 다른 공급사로 갈아타지 않는다(앞부분이 두 번 붙는 게
  더 나쁘다).
- 스트림도 캐시·in-flight·레이트리밋·공급사 체인을 그대로 탄다.
- 단, `edit`은 캐시·in-flight 합치기를 의도적으로 쓰지 않는다. 같은 추가 명령이
  다시 적용되어 상자가 복제되는 것을 막기 위해 요청마다 새 계획을 만든다.

### 문서 편집 동작과 안전 범위

1. 프런트의 `capture()`가 현재 노트 revision과 구조 스냅샷을 잡는다. 스냅샷에는
   페이지 크기/번호와 요소 id·종류·좌표·크기, 최대 240자의 평문 미리보기가
   들어간다. 14.25.0부터는 글꼴·크기·색·형광펜·굵기·정렬 같은 서식과
   `type=표 rows cols cells` 한 줄 표 요약도 함께 싣는다.
   **14.27.0부터는 형광펜이 칠해진 글귀를 `⟦…⟧`로 감싸 보여 주고**, 쪽마다
   `빈 자리 y=…`와 본문 왼쪽 x도 싣는다 — 모델이 이미 칠한 곳과 새 요소를
   둘 자리를 스스로 알게 하려는 것이다.
2. 서버 `task=edit` 프롬프트는 모델이 `@mv`, `@sz`, `@bx`, `@tx`, `@add`,
   `@del`(`@tdel`), `@rp`, `@ap`, `@st`, `@hl`, `@tbl`, `@tsz`, `@tmv`,
   `@tcell`, `@tidy`, `@goto`, `@newpage`, `@title`, `@clip`, `@clipin`,
   `@copy`, `@ask`, `@done`만 한 줄씩 내도록 제한한다. 문서 본문 안의 가짜
   프롬프트는 사용자 데이터로 취급하고 따르지 말라는 규칙도 함께 보낸다.
3. 프런트는 스트림 중 명령을 숨기고 **완료 뒤에만** 파싱한다. 알 수 없는 명령,
   잘못된 숫자, 없는 id, 잠긴 요소, 표 칸 직접 편집, 허용되지 않는 요소 작업은
   건너뛴다. 모델 텍스트는 HTML을 이스케이프한 평문으로만 저장한다. 부분 수정은
   굵기·색 span과 줄바꿈을 살리는 토큰 방식으로 치환한다.
   **형광펜(`@hl`)도 같은 토큰 방식**이라 저장 포맷과 똑같은
   `<span style="background-color:…">`만 해당 글귀에 씌우고, 지울 때는 그 글귀를
   감싸던 span을 경계에서 끊어 앞뒤 형광펜·서식을 그대로 남긴다(빈 span은 털어 낸다).
   **표 삭제는 관대하다** — 표 id는 물론 표 칸 id나 테두리 획 id를 넣어도 표
   전체(칸·테두리)가 함께 지워진다.
4. 적용 직전에 revision을 다시 비교한다. 그 사이 다른 기기/사용자가 문서를 바꿨다면
   오래된 계획은 하나도 실행하지 않고 다시 요청하라고 알린다.
5. **배치는 브라우저가 마지막으로 다듬는다.** 새 상자·표는 `auto`를 받으면
   본문 왼쪽 끝·너비를 따르고 겹치지 않는 첫 빈자리를 8px 격자로 찾아 앉히며,
   높이는 글이 넘치지 않을 만큼 스스로 잡는다(`aiEditFreeSpot`·`aiEditNeat`·
   `aiEditGuessH`). 좌표를 직접 줘도 격자·왼쪽 끝 맞추기를 거치고, `@mv`·`@bx`는
   '그 자리로 옮겨 달라'는 요청이라 격자 없이 본문 왼쪽 끝과 가까울 때만 붙인다.
   `@tidy 쪽번호`는 쪽 전체를 같은 규칙으로 정돈하되(잠긴 요소 제외) 나란히 세운
   두 칸은 건드리지 않는다(절반 넘게 겹친 것만 아래로 내린다).
6. 성공하면 변경한 페이지를 다시 그리고 저장·동기화한다. 최대 40개 명령을 하나의
   undo 스냅샷으로 묶으므로 Ctrl+Z 한 번이면 요청 전 상태로 돌아간다. undo/redo
   직후 30초는 같은 기기의 같은 rev 동기화 에코를 건너뛰어 되돌린 서식이
   되살아나지 않게 한다(`_undoGuardUntil`).

### 앱 실행 동작과 안전 범위 (14.26.0)

1. 프런트가 앱 상태 스냅샷을 잡는다. 열린 노트, 노트 목록(최대 25개),
   음악 상태(재생 중·일시정지·정지 + 곡), 노래 목록(최대 40곡),
   집중 화면 상태(열림·모드·타이머 남은 시간)가 들어간다.
2. 서버 `task=app` 프롬프트는 모델이 `@music`(play·pause·resume·next·prev·
   mix·big·vol), `@note`(new·open·close), `@timer`(분·off), `@clock`, `@sw`,
   `@present`, `@export`, `@find`, `@stickers`, `@cards`, `@settings`, `@ask`,
   `@done`만 한 줄씩 내도록 제한한다. 앱 상태 안의 제목도 사용자 데이터로
   취급하고 따르지 말라는 규칙도 함께 보낸다.
3. 프런트는 스트림 중 실행하지 않고 **완료 뒤에만** 파싱한다. 한 번에
   10개까지, 순서대로 실행한다. 목록에 없는 노래·노트, 잘못된 시간·볼륨,
   노트가 닫힌 상태의 발표·내보내기·찾기는 건너뛴다. 음악은 화면 버튼과 같은
   창구(`sdyMusic` 등)로만 다루고, 타이머·시계는 집중 화면의 같은 함수를
   부른다. 노트 삭제·이름 바꾸기·설정 값 변경·배경 변경·파일 올리기는 명령
   자체가 없어 할 수 없다.
4. 음악 재생을 시도했으면 0.7초 뒤 자동재생이 막혔는지 확인한다. 막혔으면
   곡은 골라 둔 상태라 아래 바의 ▶ 만 누르면 바로 나온다고 알려 준다
   (브라우저 정책상 모델 응답 뒤의 재생은 막힐 수 있다).
5. 발표 시작은 모드 켜짐까지만 확인하고 쪽 그리기는 백그라운드에서 이어진다.
   `@ask` 되묻기 뒤의 짧은 답은 직전 1턴 문맥과 함께 다음 실행에 실린다.

## 3) 동작 확인

```bash
# 어떤 공급사·모델이 잡혔는지 (키는 절대 안 나온다)
curl -s localhost:5000/api/ai/status
# → {"ok":true,"enabled":true,"model":"llama-3.3-70b-versatile",
#    "providers":[{"name":"groq","model":"..."},{"name":"gemini","model":"..."}], ...}

# 실제 호출 — 이 페이지/전체 페이지 정리 (task=outline)
curl -s -X POST localhost:5000/api/ai/ask \
  -H 'Content-Type: application/json' \
  -d '{"task":"outline","text":"광합성은 엽록체에서 일어난다. ..."}'
# → {"ok":true,"text":"...","provider":"groq","model":"...","cached":false}

# 질문 — 노트/자유 구분은 해돌이(서버 프롬프트)가 스스로 판단한다
curl -s -X POST localhost:5000/api/ai/ask \
  -H 'Content-Type: application/json' \
  -d '{"task":"chat","text":"광합성은 엽록체에서 일어난다. ...","question":"어디서 일어나?"}'

# 문서 편집 계획 확인 (실제 브라우저에서는 ! 요청이 이 상태를 자동으로 만든다)
curl -s -X POST localhost:5000/api/ai/ask \
  -H 'Content-Type: application/json' \
  -d '{"task":"edit","text":"페이지 크기: 800x1100 px · 총 1쪽\n[1쪽]\n  id=t_1 type=글상자 x=40 y=50 w=300 h=80 text=\"옛 제목\"","question":"제목을 맨 위로 옮겨 줘"}'
# → {"ok":true,"task":"edit","text":"@mv t_1 | 40 | 20\n@done ...", ...}

# 앱 실행 계획 확인 (시켜 달라 말투·/앱 요청이 이 상태를 자동으로 만든다)
curl -s -X POST localhost:5000/api/ai/ask \
  -H 'Content-Type: application/json' \
  -d '{"task":"app","text":"열린 노트: 회의록\n노트 목록 2개: 회의록 / 일기\n음악: 정지\n노래 목록 2곡: 봄날 - 방탄소년단 / NIGHT DANCER - imase","question":"봄날 틀어줘"}'
# → {"ok":true,"task":"app","text":"@music play | 봄날\n@done ...", ...}

# 말하는 대로 보기 (스트림)
curl -N -X POST localhost:5000/api/ai/ask \
  -H 'Content-Type: application/json' \
  -d '{"task":"outline","text":"광합성은 엽록체에서 일어난다. ...","stream":true}'

# 키 없이 화면·스트림만 확인 (개발용 가짜 모델 — 실제 모델을 부르지 않는다)
node test/mock_ai_provider.mjs &
AI_PROVIDER=manual AI_KEY=demo AI_BASE_URL=http://127.0.0.1:5399/v1 \
  AI_MODEL=mock-haedori-1 PORT=5000 node server/src/index.js
```

- `enabled:false` → `.env` 의 키와 서비스 재시작 확인.
- `502 AI에 닿지 못했어요` → `AI_BASE_URL`/키/모델명 확인. **401·404 는 거의 항상
  모델명 오타**다 (프리셋 모델명이 바뀌었을 수 있으니 대시보드에서 확인).
- `429 AI 사용량이 잠시 찼어요` → 체인의 모든 공급사가 한도에 걸린 상태.
  `retry_after` 초 뒤에 풀린다.

## 4) 안전장치 (기본으로 켜져 있다)

- **키는 서버에만** — 프런트에는 없다.
- **task 화이트리스트** — `outline/chat/edit/app` 4종뿐. 임의 system 프롬프트
  주입 불가(그 외 값은 400).
- **편집 허용 목록 + revision 검사** — 모델은 문서 객체를 직접 받거나 실행하지
  못한다. 검증된 명령 목록(이동·크기·내용·추가·삭제·부분수정·덧붙이기·서식·
  형광펜·표·정돈·클립보드·쪽·제목·되묻기)만 가능하고, 요청 중 문서가 달라지면
  전부 취소한다. 형광펜도 모델이 HTML을 넣는 게 아니라 **찾을 글과 색 이름**만
  보내고 span은 브라우저가 만든다.
- **캐시 + in-flight 합치기** — 같은 개요/질문은 모델 호출을 한 번으로 줄인다.
  **`edit`·`app`은 중복 실행 방지를 위해 예외로 매번 새 계획을 만든다.**
- **쿨다운 없음** — 429/5xx 를 맞아도 서버가 스스로 쉬지 않는다. 다음 요청은
  곧바로 다시 외부로 나가고, 공급사가 직접 준 `retry-after` 만 그대로 전달한다.
- **레이트리밋** — 로그인은 uid, 비로그인은 ip 로 계산.
- **본문 길이 상한** — 긴 문서도 상한만큼만 보낸다. **앞 70% + 뒤 30%** 를
  살리므로 '앞부분만 읽고 답하는' 일이 없다(가운데만 접는다).
- **미리 준비(warm) 는 전용 한도** — 이 페이지·전체 페이지 정리를 백그라운드로 준비하는 요청은
  `AI_WARM_N` 창을 따로 쓴다. 한도가 차도 사용자가 직접 누른 요청은 막지 않는다.

## 5) 테스트

```bash
npm run test:ai
```

- `test/ai_contract.mjs` — 요청 모양(키가 헤더에만)·task 화이트리스트·캐시·
  in-flight·길이 상한(앞 70%+뒤 30%)·429 제한 안내(쿨다운 없음)·401 처리 +
  **SSE 스트림·스트림 캐시·스트림 429·미리 준비 한도 분리** +
  **14.25.0 edit 프롬프트·`[[edit]]`·후속 context** +
  **14.26.0 app 프롬프트·`[[app]]`·후속 context** +
  **14.27.0 형광펜·정돈·표 삭제 프롬프트와 여러 턴 묶음 문맥(AI_MAX_CONTEXT)** (85 검사)
- `test/ai_providers_contract.mjs` — `.env` 해석·프리셋 URL/모델·자동 감지·중복
  제거·Ollama·**429 폴백**·캐시 응답·쿨다운 없음 (29 검사)
- `test/ai_model_chain_contract.mjs` — 같은 키 모델 체인 (11 검사)
- `test/ai_ratelimit_contract.mjs` — 사용량 한도 (6 검사)
- `test/ai_frontend_contract.mjs` — 소스 계약 + jsdom에서 질문/편집/실행을 실제로 보내
  **`!` 없이 자동 라우팅 · 편집 딱지 · 스냅샷 전송 · 스트림 중 부분 적용 금지 ·
  새 명령 파싱(@rp/@ap/@st/@tbl…/@ask) · stale 안내 · 비동기 적용 대기 ·
  되돌리기 에코 가드** + **14.26.0 앱 자동 라우팅·앱 딱지·앱 명령 파싱·
  `[[app]]` 넘기기·후속 문맥** + **14.27.0 형광펜(@hl)·표 삭제(@tdel)·정돈
  (@tidy)·auto 자리 파싱과 여러 턴 문맥**까지 검사한다 (185 검사).
- `test/ai_edit_runtime.mjs` — 실제 서버와 편집기를 열어 스냅샷·좌표 제한·잠금/표
  거절·HTML 이스케이프·저장 반영·**Ctrl+Z 전체 원복·revision 충돌 취소** +
  **14.25.0 부분수정·서식·표·쪽·제목·클립보드·되돌리기** +
  **14.27.0 글귀 형광펜(칠하기·스냅샷 `⟦⟧`·지우기·상자 전체·파서↔적용기 이어짐)·
  표 칸 id로 표 전체 삭제·auto 자리/크기·겹침 없음·`@mv` 좌표 존중·`@tidy`
  정돈**을 검증한다 (43 검사).
- `test/ai_app_runtime.mjs` — 실제 서버와 앱을 열어 **14.26.0 노래 틀기·넘기기·
  볼륨·믹스·타이머·스톱워치·시계·찾기·발표·내보내기·창 열기·노트 새로·열기·
  닫기**를 검증한다 (30 검사).

## 6) 파일 위치

| 파일 | 역할 |
|---|---|
| `server/src/routes/ai.js` | 라우트·질문/편집 프롬프트·공급사 체인·캐시·레이트리밋 |
| `server/src/lib/config.js` | `AI_*` 설정 + `aiProvidersFromEnv()` (`.env` 에서만) |
| `sdynotes.js` (편집기/끝부분) | `__sdyAiBridge` 스냅샷·검증 적용기 + 해돌이 질문/편집 IIFE |
| `sdynotes.html` (본문 끝) | 노트 안 검색창(`#aiAsk`) · 편집 딱지 · 말풍선 · 대화기록 마크업 |
| `test/mock_ai_provider.mjs` | 키 없이 화면·스트림을 보는 가짜 모델 API |
| `sdynotes.css` | `.ai-*` 스타일 (기존 변수 사용 → 다크모드 자동) |
