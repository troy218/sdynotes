# AI 노트 도우미 설정 (14.20.0 · 14.22.0 부터 '노트 해돌이')

**14.22.0 부터는 노트를 열어야만 만날 수 있다.** 노트 안 왼쪽 아래
**해돌이(마스코트)** 를 누르거나, 노트가 열려 있을 때만 보이는 왼쪽 아래 **✨
버튼**(14.21.0 부터 그 자리)을 누르면 패널이 열린다. **홈 화면에는 뜨지 않는다.**

화면은 **해돌이가 말하는 말풍선**이다 — 답은 한 방에 뚝 떨어지지 않고 **말하듯
흘러나온다**(SSE 스트림). 표정도 따라 바뀐다(말하는 중 윙크 → 다 말하면 웃음 →
못 답하면 울상). 할 일은 4가지: `요약` · `개조식 정리` · `노트 질문`(노트
본문에만 근거) · `자유 질문`. **요약·개조식은 노트를 여는 순간 미리 준비해
두므로 버튼을 누르면 기다림 없이 바로 나온다.**

**기본값은 '끔'이다.** 키가 하나도 없으면 `/api/ai/status` 가 `enabled:false` 를
돌려주고, 버튼의 점이 주황으로 뜨고 패널에는 *'키가 아직 등록되지 않았어요'*
안내 카드가 뜬다. 서버 `.env` 에 키(예: `GEMINI_API_KEY`)가 들어가면 버튼 점이
초록이 되고 안내 카드는 사라진다(패널을 다시 열 때마다 상태를 다시 확인).
사이트 다른 부분은 영향을 받지 않는다.

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
> 그건 **비교 사이트를 따로 띄울 때** 쓰는 물건이고(별도 Python 서비스 + nginx
> WebSocket 경로 필요), 이 노트 앱에는 필요 없다.

## 1) 공급사 체인 — 무료 티어 한도가 걸려도 다음 공급사로

`translate.js` 가 Google 호스트 3개를 순회하듯, **429 를 맞은 공급사만 잠시 쉬고
다음 공급사로 넘어간다.** 전부 막혀야 비로소 '제한' 안내가 나간다.

### ★ 이미 Gemini API 키를 서버에 넣어 두셨다면 — 이것만 하면 됩니다

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

안 그러면 `404` 가 떨어지고, 패널에는 *"gemini · 모델을 못 찾았어요(404) · curl
"<base>/models" 로…"* 힌트가 뜹니다. `401` 이면 *"키가 거부됐어요(401) · Google AI
Studio 에서 만든 API 키가 맞는지… (Vertex AI 서비스계정 키는 여기서 안 됩니다)"*
가 뜹니다 — **AI Studio 키(aistudio.google.com)여야 하고 Vertex AI 서비스계정
자격증명은 이 엔드포인트에서 안 됩니다.**

엔드포인트 자체는 Google 공식 OpenAI 호환 경로
`https://generativelanguage.googleapis.com/v1beta/openai` + `Authorization: Bearer <키>`
+ `/chat/completions` 입니다 — 이 저장소가 부르는 것과 정확히 같습니다
([공식 문서](https://ai.google.dev/gemini-api/docs/openai)).

### 다른 공급사와 함께 쓰기 (체인)

```ini
# /var/www/memo/.env  (로컬은 저장소 루트 .env)

# ── A. 무료 티어 2개 체인 (Gemini 가 한도에 걸리면 Groq 로) ─────
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
- **키는 서버에서만 읽는다.** 프런트(`sdynotes.js`)에 키를 심지 말 것 — 이 사이트는
  전역 CSP 가 없어서 JS 에 박힌 값은 그대로 노출된다.

### ⚠ 무료 티어를 고를 때 — 노트 앱이라 '학습 사용' 여부가 중요하다

| 공급사 | 무료 티어 | 입력을 학습에 쓰나 |
|---|---|---|
| **Groq** | 있음(모델별 하루 한도) | **아니요** ← 개인 노트에 무난 |
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
| `AI_WARM_N` | `AI_RATE_N/2` | 14.22.0 · '미리 준비'(`warm:true`) 전용 한도 — 사용자가 누른 요청과 섞이지 않는다 (0 = 미리 준비 끔) |
| `AI_COOLDOWN_MS` | `60000` | 429/5xx 를 맞은 **그 공급사만** 쉬는 시간 |

### 스트리밍 (14.22.0)

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

# 실제 호출 — '누가 답했는지'가 provider 로 돌아온다
curl -s -X POST localhost:5000/api/ai/ask \
  -H 'Content-Type: application/json' \
  -d '{"task":"summarize","text":"광합성은 엽록체에서 일어난다. ..."}'
# → {"ok":true,"text":"...","provider":"groq","model":"...","cached":false}

# 말하는 대로 보기 (스트림)
curl -N -X POST localhost:5000/api/ai/ask \
  -H 'Content-Type: application/json' \
  -d '{"task":"summarize","text":"광합성은 엽록체에서 일어난다. ...","stream":true}'

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
- **task 화이트리스트** — `summarize/bullets/ask/free` 만. 임의 system 프롬프트
  주입 불가(그 외 값은 400).
- **캐시 + in-flight 합치기** — 같은 노트를 여러 번 눌러도 모델 호출은 한 번.
  **모든 공급사가 쉬는 중에도 캐시가 있으면 그것으로 답한다**(외부 호출 0번).
- **공급사별 쿨다운** — 한 곳이 429 를 맞으면 그 곳만 쉬고 나머지는 계속 쓴다.
  401/404 는 설정 문제라 쿨다운을 걸지 않는다.
- **레이트리밋** — 로그인은 uid, 비로그인은 ip 로 계산.
- **본문 길이 상한** — 긴 문서도 상한만큼만 보낸다. 14.22.0 부터는 **앞 70% +
  뒤 30%** 를 살리므로 '앞부분만 읽고 답하는' 일이 없다(가운데만 접는다).
- **미리 준비(warm) 는 전용 한도** — 요약·개조식을 백그라운드로 준비하는 요청은
  `AI_WARM_N` 창을 따로 쓴다. 한도가 차도 사용자가 직접 누른 요청은 막지 않는다.

## 5) 테스트

```bash
npm run test:ai
```

- `test/ai_contract.mjs` — 요청 모양(키가 헤더에만)·task 화이트리스트·캐시·
  in-flight·길이 상한(앞 70%+뒤 30%)·429 쿨다운·401 처리 + **SSE 스트림·스트림
  캐시·스트림 429·미리 준비 한도 분리** (54 검사)
- `test/ai_providers_contract.mjs` — `.env` 해석·프리셋 URL/모델·자동 감지·중복
  제거·Ollama·**429 폴백**·전부 쿨다운 시 캐시 응답 (25 검사)
- `test/ai_ratelimit_contract.mjs` — 사용량 한도 (6 검사)
- `test/ai_frontend_contract.mjs` — 소스 계약 + jsdom 에서 패널을 실제로 열고
  실행해 `/api/ai/ask` 를 부르는지 + **말하는 중 조각 관찰 · Enter(한글 조합
  포함) · 미리 준비 즉시 응답 · 노트 밖(홈)에서는 숨김** (92 검사)

## 6) 파일 위치

| 파일 | 역할 |
|---|---|
| `server/src/routes/ai.js` | 라우트·프롬프트·공급사 체인·캐시·레이트리밋 (본체) |
| `server/src/lib/config.js` | `AI_*` 설정 + `aiProvidersFromEnv()` (`.env` 에서만) |
| `sdynotes.js` (끝부분) | 노트 해돌이 IIFE + `window.__sdyAiBridge` (노트 글 추출) |
| `sdynotes.html` (본문 끝) | `#aiFab` · `#aiPanel` · 해돌이 말풍선(`#aiSay`) 마크업 |
| `test/mock_ai_provider.mjs` | 14.22.0 · 키 없이 화면·스트림을 보는 가짜 모델 API |
| `sdynotes.css` (모바일 최종 블록 앞) | `.ai-*` 스타일 (기존 변수 사용 → 다크모드 자동) |
