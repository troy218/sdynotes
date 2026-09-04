# AI 노트 도우미 설정 (14.23.0 · 노트 해돌이가 성큼 다가왔다)

**해돌이가 직접 대답하는 검색창이다 — 14.23.0 부터** 떠다니던 ✨ 버튼·패널·
작업 고르기가 전부 사라졌다. 노트를 열 때마다 해돌이 옆에 **작은 검색창**이
붙어 있고, 거기에 궁금한 것을 쓴 뒤 **그냥 Enter 를 누르기만** 하면 된다
(별도 보내기 버튼 없음 — 한글 조합 중에는 보내지 않는다). 해돌이가 **노트
질문인지 자유 질문인지 스스로 판단해서** 딱지로 알려 준다. 답은 **말하는
말풍선**에 흘러나오고(SSE 스트림), **내가 닫기 버튼을 누르기 전까지는 그
자리에 그대로** 남는다 — 답이 길면 말풍선 안을 스크롤해 읽는다. 모델
이름·소요 초 같은 기술 정보는 화면에 보여주지 않는다. **`이 페이지`** 와
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

## 0-1) 버그·기능을 고치는 방법 (이 저장소의 손보기 원칙)

다른 개발자(사람·에이전트)가 같은 방식으로 고칠 수 있게 적어 둔다.

1. **먼저 틀린 줄을 정확히 찾는다.** 추측으로 여러 곳을 흩어 고치지 않는다.
   `grep` 으로 원인 후보를 좁히고, 가능하면 작은 런타임/계약 테스트로 재현해
   본다. (브라우저 화면이 필요한 경우는 `test/*_runtime.mjs` 처럼 jsdom 으로
   실제 앱을 띄워 확인한다.)
2. **틀린 부분은 지우고, 그 자리에 정확한 코드를 다시 쓴다.** 근처에 새 줄을
   덧붙여 우회하는 방식으로는 고치지 않는다. 덧붙이는 줄이 많아지면 코드만
   커지고, 원래 버그는 남아 다음 사람을 다시 헷갈리게 한다.
3. **변경을 최소·가독성 있게.** 수정 뒤 `node --check` 나 해당 계약 테스트로
   문법·동작이 안 깨지는지 확인한다. 주석의 숫자·기준값도 실제 값과 함께 고친다.
4. **테스트는 빨라야 한다.** 느린 브라우저·통합 테스트를 새로 만들지 말고,
   기존의 빠른 계약 테스트(`*_contract.mjs`, `test/ai_frontend_contract.mjs` 의
   jsdom 조각)에 검사를 추가한다. 동작이 바뀌면 그 계약 검사도 같이 고친다.
5. **`sdynotes.html`·`sdynotes.js`·`sdynotes.css` 를 고쳤으면 `?v=` 도 올린다**
   (`node scripts/bump-version.mjs <x.y.z>` — nginx 가 1년 immutable 로 캐싱한다).

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
| `AI_MAX_TOKENS` | `1800` | 응답 길이 상한 (256~8000 clamp). 14.22.0 부터 900 → 1800 — 한국어 답이 중간에 끊기지 않게 |
| `AI_MAX_TEXT` | `30000` | 한 번에 보내는 노트 본문 길이(자). 넘으면 **앞 70% + 뒤 30%** 를 살리고 가운데만 접는다 (`truncated:true`, `note_chars` 에 원본 길이) |
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
- **task 화이트리스트** — `outline/chat` 뿐 (2종). 임의 system 프롬프트
  주입 불가(그 외 값은 400).
- **캐시 + in-flight 합치기** — 같은 노트를 여러 번 눌러도 모델 호출은 한 번.
  **캐시가 있으면 항상 그것으로 답한다**(외부 호출 0번).
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
  **SSE 스트림·스트림 캐시·스트림 429·미리 준비 한도 분리** (60 검사)
- `test/ai_providers_contract.mjs` — `.env` 해석·프리셋 URL/모델·자동 감지·중복
  제거·Ollama·**429 폴백**·캐시 응답·쿨다운 없음 (25 검사)
- `test/ai_ratelimit_contract.mjs` — 사용량 한도 (6 검사)
- `test/ai_frontend_contract.mjs` — 소스 계약 + jsdom 에서 **해돌이·검색창을 실제로
  눌러 보고** Enter 로 질문을 보내는 검사 + **말하는 중 조각 관찰 · 한글 조합 중
  안 보내기 · 미리 준비 즉시 응답 · 해돌이 표식([[note]]/[[free]]) 파싱 · 말풍선
  유지 · 대화기록 재보기 · 429 안내 · 범위별 본문(이 페이지/전체 페이지)** (97 검사)

## 6) 파일 위치

| 파일 | 역할 |
|---|---|
| `server/src/routes/ai.js` | 라우트·프롬프트·공급사 체인·캐시·레이트리밋 (본체) |
| `server/src/lib/config.js` | `AI_*` 설정 + `aiProvidersFromEnv()` (`.env` 에서만) |
| `sdynotes.js` (끝부분) | 노트 해돌이 IIFE + `window.__sdyAiBridge` (노트 글 추출) |
| `sdynotes.html` (본문 끝) | 노트 안 검색창(`#aiAsk`) · 말풍선(`#aiSay`) · 대화기록(`#aiHist`) 마크업 |
| `test/mock_ai_provider.mjs` | 키 없이 화면·스트림을 보는 가짜 모델 API |
| `sdynotes.css` | `.ai-*` 스타일 (기존 변수 사용 → 다크모드 자동) |
