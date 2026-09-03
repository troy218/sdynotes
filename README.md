# SDYnotes 14.23.0 — Fastify + Python worker + Oracle 자체 저장소

기존 단일 `app.py`(약 11,000줄)를 **"빠른 부분은 Node, 무거운 부분만 Python"** 으로
재설계한 백엔드입니다. **14.12 부터 모든 데이터(상태·파일)는 이 Oracle VM 디스크에
저장·실행됩니다** — Supabase/Cloudinary 는 기본적으로 전혀 호출하지 않습니다
(쿼터 초과·과금 걱정 없음). 예전 클라우드 모드는 `SDY_STORAGE=cloud` 로 언제든
롤백할 수 있고, 기존 데이터 이전은 `scripts/migrate_to_oracle.mjs` 가 자동으로
합니다 (자세한 것은 `ORACLE_MIGRATION.md`).

프런트(`sdynotes.html`)의 주요 변화:

- **14.23.0 노트 해돌이가 성큼 — 검색창 하나로 끝 (패널·버튼·고르기 전부 철거)**:
  - **AI 버튼(#aiFab) 을 없앴습니다.** 이제 노트를 열 때마다 해돌이 옆에 **작은
    검색창**이 그냥 붙어 있습니다. 창을 더 열 필요도 없습니다 — 논리적으로
    패널 자체가 사라지고, 남는 건 해돌이·검색창·말풍선뿐입니다.
  - **요약·개조식은 버리고 범위 버튼 둘로 물었습니다** — 검색창 **바로 위**의
    **'이 페이지'**(지금 보는 쪽만) 와 **'전체 페이지'**(문서 전체). 예전
    '개요 정리' 라는 말 대신 범위만 고르면 됩니다. 노트 글이 켜지는 순간
    백그라운드로 미리 받아 둬서(`warm:true`, 전용 한도 `AI_WARM_N`) 누르는
    순간 답합니다. 답은 목차처럼 번호 매긴 줄들입니다.
  - **보내기 버튼도 없습니다** — 쓰고 그냥 **Enter** 를 누르기만 하면 끝.
    (한글 조합 중에는 보내지 않는다.) 질문칸은 **유동 크기** — 글이 길어지면
    옆으로 늘고, **Shift+Enter** 로 줄을 늘리면 상자가 **위로** 자랍니다
    (아래가 고정이라 위를 향해 커짐, 최대 5줄 뒤엔 칸 안에서 스크롤).
  - **노트질문/자유질문 고르기도 없습니다** — 해돌이가 **스스로 판단**합니다.
    서버 프롬프트가 모델에게 첫 줄에 `[[note]]` 또는 `[[free]]` 표식을
    쓰라고 요구하고(이 표식은 화면엔 안 보여 줍니다), 해돌이 말풍선 구석에
    '노트 질문' / '자유 질문' **딱지**로 알려 줍니다.
  - **대답은 전부 말풍선에서** — 스트리밍 그대로 한 글자씩 붙기, 멈추기·복사
    버튼 그대로. 모델 이름·소요 초 같은 **기술 정보는 화면에서 뺐습니다**.
    **답이 길면 말풍선 안을 아래로 스크롤**해서 전부 읽습니다(다 말한 답은
    맨 위부터). **말풍선은 닫기(×)를 누르기 전까지 자리에 그대로** 둡니다.
  - **지난 이야기는 해돌이를 눌러서** — 가벼운 탭 한 번에 대화기록이 열리고
    (최신 40개·범위+질문 딱지 달림), 한 줄을 고륵면 말풍선으로 다시 떠
    줍니다. Esc 나 바깥 클릭으로 닫습니다. **아이디어(전구) 변신은 클릭이
    아니라 커서를 올렸을 때(호버)** 나옵니다 — 클릭은 대화기록 전용.
  - 서버 할 일은 이제 2종(`outline`/`chat`)뿐 — 예전 `summarize/bullets/ask/free`
    는 화이트리스트에서 날아갔습니다(부르면 400). 계약 테스트 전면 교체:
    `npm run test:ai` (59+25+6+81).

- **14.22.0 노트 해돌이 — AI 도우미가 '해돌이' 로 말한다 (스트리밍 + 미리 준비)**:
  - **홈 화면에는 없습니다.** 노트를 열어야만 해돌이를 만난다 — 노트 안 왼쪽
    아래 **해돌이(마스코트) 를 누르거나**, 그때만 보이는 왼쪽 아래 ✨ 버튼을
    누르면 패널이 열린다. (예전엔 홈에도 떠 있었다.)
  - **말하는 대로 나온다** — 답이 다 끝날 때까지 기다리지 않는다.
    `POST /api/ai/ask` 에 `stream:true` 를 주면 서버가 **SSE**(event:
    `meta`/`delta`/`done`/`error`) 로 조각을 흘려 보내고, 화면은 **해돌이
    말풍선**에 글자를 한 글자씩 붙인다. 스트림을 못 주는 모델이면 알아서
    한 방(JSON) 응답으로 떨어진다. 조각이 이미 나간 뒤엔 다른 공급사로
    갈아타지 않는다(앞부분이 두 번 붙는 게 더 나쁘다).
  - **해돌이가 말하는 UI** — 머리말과 답 옆에 해돌이 얼굴(해돌이 스쿼드 공유
    부품 `#om-m-head`), 답은 꼬리 달린 **말풍선**(`#aiSay`), 이름표 '해돌이'.
    말하는 중엔 윙크, 다 말하면 웃는 얼굴, 못 답하면 우는 얼굴로 바뀐다.
  - **요약·개조식 정리는 누르자마자 나온다** — 노트를 열면(그리고 글을 고치면)
    백그라운드로 요약·개조식을 **미리 준비**해 둔다(`warm:true`). 버튼을 누르면
    그 자리에서 바로 나온다(서버 호출 0번 · 기다림 0초). 준비 요청은
    `AI_WARM_N`(기본 `AI_RATE_N/2`) **전용 한도**를 쓴다 — 사용자가 직접 누른
    요청과 한도를 섞지 않는다.
  - **질문 칸 정리** — 질문칸이 패널 **오른쪽 끝까지 꽉 찬다**(칸 안 오른쪽에
    보내기 버튼이 붙는다). **Enter 만 누르면 바로 물어보고**(한글 조합 중
    Enter·Shift+Enter 는 보내지 않는다), 요약·개조식처럼 질문이 필요 없는
    일은 칸이 접히고 버튼이 칸을 가득 채운다.
  - **긴 노트를 '앞부분만' 보내지 않는다** — `AI_MAX_TEXT` 기본 3만 자로 올리고,
    한도를 넘기면 **앞 70% + 뒤 30%** 를 살려 보낸다(가운데만 접는다). 결론이
    보통 뒤에 있으니, 뒤를 잘라먹던 예전보다 답이 낫다.
  - 계약 테스트: `npm run test:ai` 에 SSE 조각·스트림 캐시·스트림 429·미리 준비
    한도 분리 + jsdom '말하는 중' 관찰·Enter(한글 조합 포함)·노트 밖 숨김 검사가
    추가됐다 (54+25+6+92).
  - 키 없이 화면·스트림을 확인하는 개발용 목업: `test/mock_ai_provider.mjs`.

- **14.21.0 AI 도우미 버튼 이동 + 패널 유리 디자인 전면 개편**:
  - **AI 버튼(#aiFab) 이 왼쪽 아래로 이동** — 오른쪽 아랫자리는 음악 칩(#mpReopen)·
    엽스코드 칩이 쓰던 자리라, AI 버튼이 음악 칩을 가리고 있었다. 이제 음악 칩과
    **마주 보듯 왼쪽**에, 음악 칩과 같은 크기(42px)·같은 유리 원반으로 떠 있다.
  - **AI 패널 내부 싹 교체(유리 디자인)** — 음악 플레이어와 같은 `--g-*` 유리
    토큰(블러 배경·유리 테두리·하이글로스 그림자)으로 재구성: 그라데이션
    ✨ 엠블럼 머리말, 작업 칩(요약·개조식·노트 질문·자유 질문), '지금 쪽만'
    체크박스 카드, 유리 질문란·결과 카드, 바닥 실행/멈추기/결과 복사 버튼
    (실행 중엔 스피너 아이콘).
  - **API 키 '나중에 등록' 흐름 대비** — 버튼에 키 상태 점(초록=켜짐/주황=미등록)
    이 붙고, 키가 없으면 패널에 *"Google AI Studio 키를 서버 .env 의
    `GEMINI_API_KEY` 에 넣으면 알아서 켜져요"* 안내 카드가 뜬다. 패널을 열 때마다
    `/api/ai/status` 를 다시 확인해서, 키 등록·재시작 후에 새로고침 없이도 다음에
    열 때 바로 켜진 걸 보여 준다.

- **14.20.0 AI 노트 도우미 — 요약 · 개조식 · 노트 질문 · 자유 질문 (OpenAI 호환 API)**:
  - **14.22.0 부터는 '노트 해돌이'** — 노트를 열었을 때만 보이는 둥근 버튼(#aiFab)
    또는 노트 안 해돌이(#noteOtter) 로 연다. 할 일은 4가지다 — `요약`(노트
    전체를 5문장 이내), `개조식 정리`(3~7줄), `노트 질문`(노트 본문에만 근거해
    답함), `자유 질문`(노트 없이 아무 질문). '지금 쪽만' 체크박스로 문서 전체
    대신 현재 쪽만 보낼 수 있다.
  - **모델 키는 프런트에 없다.** 브라우저는 `/api/ai/ask` 만 부르고, 키·모델·
    시스템 프롬프트는 전부 `server/src/routes/ai.js` 가 들고 OpenAI 호환
    `/chat/completions` 로 나간다. `AI_BASE_URL` 한 줄로 OpenAI·OpenRouter·Groq
    등 어떤 게이트웨이라도 그대로 탄다. **`AI_KEY` 가 비어 있으면 기능은 '끔'
    상태로 부팅한다** (`/api/ai/status` → `enabled:false`, 패널에 'AI 꺼짐').
    설정 방법: **`AI.md`**.
  - **왜 Arena.ai 에 직접 붙이지 않았나** — Arena.ai 는 공개 API·임베드 위젯을
    제공하지 않는 무료 소비자용 채팅/투표 사이트다(reCAPTCHA + "대화가 AI
    제공사에 전달·공개될 수 있다" 약관). 그래서 '아레나에 붙이기' 대신
    '아레나로 코드를 만들고, 사이트는 모델 API 에 붙이기'로 갔다.
  - **돈이 나가는 경로라 남용 장치를 기본으로 걸었다** — task 화이트리스트(임의
    프롬프트 주입 차단), 본문 길이 상한(`AI_MAX_TEXT`, 자르면 `truncated:true`),
    같은 입력 재요청은 캐시로 응답(외부 호출 0번), 동시에 온 중복 요청은
    in-flight 하나로 합침, uid(없으면 ip)별 슬라이딩 윈도우 레이트리밋,
    429/5xx 뒤 잠깐 쿨다운(그 사이엔 외부 API 를 아예 부르지 않음). 프런트는
    429 안내에 `retry_after` 초를 그대로 보여 준다.
  - **공급사 '체인'** — `AI_PROVIDERS=groq,gemini` 처럼 여러 개를 걸어 두면
    **429 를 맞은 그 공급사만 잠시 쉬고 다음 공급사로 넘어간다** (translate.js 의
    Google 호스트 순회와 같은 발상). 무료 티어 하루 한도가 걸려도 답이 나온다.
    프리셋: `groq` · `gemini` · `openrouter` · `openai` · `ollama`(로컬, 키 0원 ·
    외부 전송 0). `<이름>_BASE_URL` · `<이름>_MODEL` 로 덮어쓴다.
  - **arena.ai 계정 우회는 하지 않는다** — 약관이 "대화가 제3자 AI 에 전달되고
    공개될 수 있다"고 명시하고 reCAPTCHA 가 걸려 있어, 개인 노트를 그 경로로
    흘리는 건 이 앱에서 최대 손실이다. '아레나 UI'가 필요하면 그건 오픈소스
    `lm-sys/FastChat`(Apache-2.0, `gradio_web_server_multi`)를 **별도 서비스로**
    띄우는 일이고 이 노트 앱에는 필요 없다. 자세한 근거와 설정: **`AI.md`**.
  - 계약 테스트: `npm run test:ai` (요청 모양·키 비노출·캐시·in-flight·길이
    상한·429 쿨다운·레이트리밋·**공급사 폴백** + jsdom 에서 패널을 실제로 열고
    실행하는 프런트 런타임 — 31+25+6+50 검사).

- **14.19.0 음악 — 랜덤 20곡 대기열 · 백엔드 태그 추천 엔진 · 업로드 즉시 재생 · 해돌이 클릭 토글**:
  - **처음 접속하면 랜덤 20곡이 대기열에 자동으로 담긴다** (저장된 대기열이 없을
    때만 · 재생은 시작하지 않는다). 듣던 곡이 있으면 그 곡을 맨 앞에 두고
    나머지 19곡을 무작위로 채운다.
  - **추천 화면 맨 위에 '랜덤 믹스 🎲' 히어로 버튼** — 누를 때마다 아무 곡이나
    20곡을 뽑아 대기열을 통째로 교체하고 첫 곡부터 재생한다.
  - **태그 기반 추천 엔진(백엔드, `GET /api/music/reco`)**: 곡마다 제목·가수·앨범·
    장르·연도·가사에서 태그를 아주 많이 뽑고(언어·템포·무드 12종·스타일 12종·
    보컬·장르 토큰·연대·가사 키워드 …) 태그가 겹치는 곡들을 묶어 추천한다.
    화면에는 태그를 절대 보여주지 않는다 — '나를 위한 추천 믹스 🎯'(묶음 카드,
    누르면 대기열 교체)와 '비슷한 감성'(곡별 유사곡)만 보인다. 태그·유사도
    계산은 전부 서버에서, 응답에는 해시 id 와 대표곡 이름만 담긴다.
  - **노래를 새로 올리면(파일·유튜브) '그 곡'이 바로 재생된다.** 예전엔 전체
    목록 인덱스로 재생을 걸어 대기열이 있으면 대기열 첫 곡이 틀어졌다. 이제
    대기열이 있으면 현재 곡 바로 뒤에 끼워 넣고 정확히 그 자리를 튼다
    (`playNewTrack`).
  - **해돌이 싱크 가사 따라 부르기 = 클릭 토글.** 호버링이 아니라 한 번 누르면
    켜지고(들썩이는 애니메이션 + aria-pressed), **다시 누를 때까지 계속** 지금
    나오는 싱크 가사를 따라 부른다. 부르는 동안 말풍선은 꺼지지 않는다.
  - 계약 테스트: `npm run test:reco` (백엔드 태그 엔진 · 부팅 자동 대기열 ·
    랜덤 히어로 · 서버 묶음 카드 · 업로드 즉시 재생 · 해돌이 토글 검증).

- **14.18.4 같은 노트 실시간 표시 — 그리는 획 실시간 공유 · 펜/캐럿 커서 · 왼쪽 범례**:
  - **그리는 중인 획을 이제 획 단위 완성을 기다리지 않고 실시간으로 보여 준다.**
    펜을 긋는 동안 점을 단순화(RDP·최대 96점)한 '잉크 미리보기'를 `/api/live/ping`
    (25fps)에 함께 실어 보내고, 다른 기기는 그 획을 상대 종이 위 임시 SVG 로
    그린다. 펜을 뗀 뒤에는 최종 획이 기존 요소 동기화로 도착할 시간(3.5초 유예)을
    주고 임시 잉크를 지운다. 서버(`sanitizeInk`)는 좌표·점 수·굵기·불투명도를
    강제로 다듬어 신뢰할 수 없는 입력을 차단한다.
  - **상대 커서 모양**: 그리는 중(`mode:'draw'`)엔 화살표 대신 그 사람 색의 **펜촉**,
    글 입력 중(`mode:'type'`)엔 **깜빡이는 캐럿**이 보인다. 글 쓰는 중에는 마우스
    좌표가 아니라 `selectionchange` 로 잰 **실제 캐럿 위치**(종이 좌표)를 보내
    캐럿이 정확한 자리에서 깜빡인다.
  - **커서 이름표 축소**: 커서에는 더 이상 이름 라벨을 달지 않고 **색만** 보여
    준다. 누가 어떤 색인지(이름·지금 하는 일)는 **화면 왼쪽 범례(#liveLegend)** 가
    안내한다(나 포함, 상대가 있을 때만 표시).
  - 계약 테스트: `npm run test:live` (실시간 잉크·모드 전달·입력 정규화 29 검사).
- **14.18.3 기본 글꼴 프리텐다드 · 파스텔 색 팔레트 · 툴바 그리기 분리 · 그리기 되돌리기 재설계**:
  - **기본 글꼴을 프리텐다드(변수형)로 교체**했다. 예전 기본이던 '노토 산스'는
    글꼴 메뉴에서 빠지고 새 기본 '프리텐다드'가 맨 앞에 들어갔다. 옛 노트의
    `el.font:'noto'`·인라인 `'Noto Sans KR'` 지정은 렌더 시 전부 프리텐다드로
    풀린다(CSS `@font-face` 별칭 + `fontCSS()` 폴백). 본문 로드도
    Google Fonts 대신 jsDelivr 의 pretendardvariable-dynamic-subset (한글 서브셋)로 바꿨다.
  - **글자색·형광펜(글자)·펜 색을 파스텔톤으로** 바꿨다 — 예전 팔레트의 같은 색·
    같은 순서를 유지한 채 흰색을 50% 섞은 값이다(검정→연회색 `#808080`, 빨강→코랄
    `#f3a69e`, 형광 노랑 `#ffff00`→`#ffff80` …). 브라우저에 저장돼 있던 옛 펜 색도
    같은 색조의 파스텔로 자동 마이그레이션된다(`LEGACY_DRAW_COLORS`).
  - **펜·형광펜 버튼을 '넣기'(텍스트·사진·스티커·표·수식) 그룹에서 분리**해
    옆에 독립된 그리기 그룹으로 둘렀다(구분선으로 구별).
  - **그리기 되돌리기(undo) 재설계**: ① `drawStart` 의 히스토리 기록이 250ms
    묶음에 걸려 빠르게 연속으로 그린 획이 한 덩어리로 통째로 되돌아가던 것을
    획마다 개별 기록(`pushHistory(force)`)으로 고쳤다. ② 지우개는 '첫 획을 지운
    뒤'에 스냅샷을 남겨 되돌려도 그 첫 획이 영영 안 돌아왔는데, 이제 제스처
    시작 시 '지우기 전' 상태를 남긴다. ③ 아무 변화 없던 제스처(헛클릭·빗나간
    지우개)의 스냅샷은 도로 치워 되돌리기가 헛돌지 않게 했다. ④ 되돌리기가 종이를
    다시 그린 뒤에도 펜 모드(`.drawing`)를 새 종이에 다시 붙여, 되돌린 직후
    계속 그릴 수 있게 했다. 계약 테스트: `npm run test:draw` (연속 획 1획씩
    되돌리기·지우개 첫 획 복구·펜 모드 유지 포함 30 검사).
- **14.18.1 "노트 사진이 1시간쯤 뒤 사라지는" 진짜 원인 수정 (서버/워커)**:
  사진이 *올린 직후엔 모든 기기에서 보이다가 잠시 뒤 404*가 되는 증상은
  프런트 문제가 아니라 **워커 임시파일 정리 버그**였다. 음악 백필 스레드가
  15분마다 부르는 `_cleanup_old_temp_files()`(worker/sdynotes_worker/common.py)가
  `imported/`·`imported_docs/` 를 "mtime 1시간 넘음 = 임시"로 보고 **통째로**
  지웠는데, oracle 자체 저장소 전환(14.12) 이후 그 폴더는 노트 이미지
  (`img_*.webp` → `/api/img/…`)·가져오기 배경·대용량 문서 본문의 **영구
  저장소**이기 때문이다. 이제 영구 데이터는 절대 건드리지 않고, 이름으로
  확실히 임시인 파일(`chunk_*.json`·`*.tmp`·`*.part`, 24시간 넘은 업로드
  `*.bin`)만 정리한다. 회귀 방지 계약 테스트:
  `npm run test:imgstore` (`python3 test/worker_img_cleanup_contract.py`,
  `test:image` 그룹에도 포함). 자세한 분석은
  `docs/image_paste_persistence_bug.md` 머리글.
- **14.18.0 이미지 저장 방식 v3 — 업로드-선행(단순·확실)으로 전면 교체**:
  "그림을 올린 뒤 나중에 다른 기기에서 열면 사진이 안 불러와진다"가 여러 차례의
  부분 개선(pending 플래그 → data: 라이딩 → outbox → IndexedDB+큐+자가복구)
  뒤에도 재발한 근본 원인은, **'화면에 먼저 붙이고 저장은 백그라운드가 나중에'**
  라는 구조 자체가 부분 실패(업로드 미완료·URL-fix op 유실·로컬 소스 공유)를
  낳기 때문이었다. 그 구조를 통째로 걷어내고 성능을 조금 양보하는 대신 실패
  모드가 구조적으로 없는 알고리즘으로 바꿨다. ① 사진을 넣으면 **배치보다 먼저**
  `/api/upload` 로 올린다(진행 배지 표시, 3회 재시도·압축 폴백). ② 서버가 준
  url(`/api/img/…`)을 **실제 GET 으로 다시 읽어 검증**한다. ③ 요소는 그 검증된
  url 로만 태어난다 — pending/blob:/data:/IndexedDB/백그라운드 큐/8초 자가복구가
  신규 경로에 아예 없다. ④ 배치 직후 로컬 저장·서버 memo·요소 op 를 디바운스
  없이 즉시 확정한다(`commitImagesNow`). ⑤ 업로드 실패 시 **아무것도 놓지 않고**
  알린다 — 어떤 기기에도 '깨진 자리'가 생길 수 없다(없거나, 어디서든 보이거나).
  배치를 취소한 업로드는 서버에서도 지운다(`discardImgItems`). 옛 저장물의
  data: 레거시는 렌더 호환을 유지하며 노트를 열 때 같은 확실한 경로로 1회
  재업로드해 복구한다(`repairLegacyImages`). 계약 테스트:
  `npm run test:pasteimg`(업로드-선행 계약 19 검사) + `npm run test:image`
  (레거시 복구·크로스 디바이스·클립보드 포함 70 검사). 상세 설계는
  `docs/image_paste_persistence_bug.md` 머리글.
- **14.17.0 텍스트 서식 엔진(SDY-FMT v2) 전면 재설계**: "일부 글꼴을 바꾼 뒤
  굵게를 씌우는" 편집이 통하지 않던 근본 원인은 구버전 인라인 엔진이
  **선택 조각 수술 방식**(extractContents 로 떼어내고 → 새 span 으로 감싸고 →
  속성을 걷어내고 → 빈 span 을 치운다)이어서, span 이 중첩될수록 어느 조상이
  어떤 속성을 담당하는지 상태가 꼬였기 때문이다. execCommand 병행 경로와 그
  오류를 감싸던 보정(captureSelFonts/_keepFontOnSel)까지 합쳐 구조가 더
  복잡해졌다. 이번 버전에서 그 전부를 갈아엎고 **선언형 재구축 방식** 으로
  새로 썼다. ① 상자 안 글자를 문자 오프셋 지도로 잰다. ② 편집 범위의 문단마다
  토큰(글자 세그먼트+유효 스타일, <br>, <img>, 캐럿 서식 마커)을 만든다.
  ③ 편집은 토큰의 스타일 사전을 고치는 것뿐이다. ④ 문단을 정규형으로 다시
  그린다 — 같은 스타일의 이웃 세그먼트는 하나의 span 으로 합쳐 중첩이
  누적되지 않는다. ⑤ 선택(캐럿)은 문자 오프셋으로 복원한다. 덕분에 같은
  연산을 몇 번을 다시 적용해도 결과가 같아지고(멱등), "글꼴 바꾼 뒤 굵게가
  안 먹힘" 같은 상태 누적 버그가 원천 차단된다. 함께 바뀐 것: 굵게·기울임
  **해제는 상자 상속과 충돌할 때만 중립값(400/normal)을 적는다**(일반 글자는
  속성 삭제 → font-weight:400 덧대기 제거). 상자 전체 글꼴·크기 교체는
  인라인 오버라이드가 있는 부분만 갱신해 글자마다 span 을 깔지 않는다.
  밑줄+취소선은 한 span 에 토큰으로 공존한다. 문단 정렬·링크 걸기/해제도
  execCommand 없이 같은 엔진 경로로 통일했다(구형 웹뷰에서도 동일 동작).
  재구축 중에는 selectionchange 가 저장 선택을 덮지 않게 잠근다(_fmtBusy).
  회귀 방지 테스트: `npm run test:fmtv2` (런타임 41 케이스) +
  `npm run test:txtstyle` (소스 계약 84 케이스).
- **14.16.10 사용자 흐름 단계별 점검에서 잡은 버그 8종**: 실제 조작 순서를 그대로
  밟는 런타임 점검(`npm run test:uflow`, 42단계)에서 드러난 문제들을 고쳤다.
  ① **마지막에 적은 글이 다시 열면 사라지던 동기화 버그** — 서버가 아직 옛 내용을
  들고 있는데도 '이미 보냈다'고 표시(`__lastHash`)해 버려서 내 마지막 편집이 영영
  전송되지 않았고, 노트를 다시 열면 옛 ops 가 덮어써 글이 사라진 것처럼 보였다.
  이제 서버 내용이 내 것과 같을 때만 '보낸 것'으로 표시한다. ② **표 전체 삭제가
  중간에 멈추던 버그**(없는 함수 `clearSel` 호출 → 화면엔 표가 남고 저장도 안 됨).
  ③ **툴바 글자 크기칸을 만진 뒤 Escape 를 누르면 노트가 통째로 닫히던 문제** —
  글상자 편집 중 Escape 는 언제나 편집만 끝낸다. ④ **타이핑이 되돌리기(Ctrl+Z)에
  안 잡히던 문제** — 편집을 시작할 때 '적기 전' 상태를 기록해 편집을 끝낸 뒤에도
  방금 적은 글을 되돌릴 수 있다. ⑤ **상자를 Ctrl+C → Ctrl+V 하면 글자만 든 새
  상자가 생기던 것** → 위치·크기·글꼴·서식까지 그대로인 상자 복제로 바꿨다.
  ⑥ **서식 지우기·영문 대소문자 바꾸기·링크 걸기가 execCommand 없는 환경(구형
  웹뷰)에서 안 먹던 것** → 인라인 엔진으로 직접 처리한다(대소문자는 이제 서식을
  잃지 않는다). ⑦ `<b>글자</b>` 를 통째로 드래그해 굵게 해제/서식 지우기를 하면
  태그가 안 벗겨지고 `font-weight:400` 이 덧대지던 것. ⑧ 찾기 하이라이트·페이지
  스크롤이 `getClientRects`/`scrollTo` 없는 환경에서 예외로 죽던 것, 페이지 삭제
  인자 방어.
- **14.16.9 글자 선택·툴바 서식 4종 수리**: ① **끌어 고른 글자에 우클릭이 먹는다** —
  예전엔 우클릭 순간(pointerdown)에 캐럿이 눌린 자리로 옮겨가 선택이 풀려서
  '복사·굵게·형광펜' 같은 선택 글자 메뉴가 뜨지 않았다. 이제 오른쪽 버튼은 선택을
  전혀 건드리지 않고 그대로 우클릭 메뉴로 이어진다. ② **새 글상자는 글꼴·글자 크기만
  물려받는다** — 굵게·기울임·밑줄·취소선·글자색·형광펜은 새 상자를 만들 때 풀리고
  툴바 표시도 함께 초기화된다. ③ **아무것도 고르지 않은 화면에서 글자 크기가 2·3 만
  오가던 버그** 수정 — 잴 대상이 없을 때 툴바 크기를 0(→2)으로 깎아 버리던 것을
  막아, 30 → 32 → 34 처럼 지금 값에서 이어서 오르내린다. ④ **툴바 글꼴 = 지금 입력되는
  글꼴** — 캐럿을 옮기거나 상자를 고르면 툴바의 글꼴·크기가 그 자리 글자에 맞춰 따라오고,
  **속성을 먼저 입힌 뒤에도 글꼴·크기 변경이 먹는다**(서식 span 에 옛 글꼴이 박제되던
  원인을 없앴다 — 상자 전체 글꼴/크기는 안쪽 인라인 값을 걷어내고 적용한다).
  회귀 방지 런타임 테스트: `npm run test:selux` (53 케이스).
- **14.16.7 스티커를 SVG 벡터로 굽기**: 선택한 글자·펜 그림·이미지를 PNG 래스터가
  아니라 **SVG 벡터**로 구워 보관함에 저장한다 — 아무리 확대해도 선과 글자가 깨지지
  않는다. 내보내기가 쓰던 검증된 조립을 그대로 재사용한다(펜 획은 `<path>`, 글자는
  `<foreignObject>`+XHTML 로 서식 유지, 이미지는 data: 로 인라인). SVG 굽기가
  실패하는 환경에서는 예전 캔버스 PNG 경로로 자동 폴백하고, 서버는 SVG 스티커를
  `.svg` 로 저장해 `image/svg+xml` 로 돌려준다(문서로 바로 열 때 스크립트가 못
  돌게 sanitize + CSP 헤더). 웹폰트는 SVG 안에서 외부 로딩이 막히므로 시스템
  글꼴로 대체되는 점은 선명도 우선의 트레이드오프다.
- **14.16.6 스티커 넣기 진입점 정리**: ① 여러 개를 골라 우클릭하던 **'스티커로 합치기'는
  객체 묶기와 겹치는 기능이라 뺐다** — 여러 개는 '객체 묶기'로 묶어서 옮기고, 스티커는
  '스티커로 만들기'(원본을 그대로 두고 보관함에만 저장)로 만든다. ② 스티커를 만들어도
  다시 꺼내 놓을 방법이 없었는데, 이제 **빈 종이 우클릭 → '스티커 넣기'** 로 보관함을
  열 수 있고, 여기서 고르면 **우클릭한 그 자리**에 스티커가 붙는다. ③ 상단 툴바의
  사진 추가 버튼 바로 옆에도 **스티커 넣기 버튼**이 생겼다 — 이쪽으로 열면 기본
  자리(80,100)에 붙는다. 보관함을 닫거나 다시 열면 기억한 자리는 버린다.
- **14.15.0 암기카드 파스텔 리디자인 + 진짜 해달 + 보기별 해설**: ① 전체화면 배경이
  단색에서 노트 앱 오로라와 어울리는 라벤더→바이올렛→로즈 파스텔 그라데이션으로 바뀌고,
  기본 화면(묶음 목록) 맨 위에 '오늘은 무엇을 외워 볼까요?' 히어로 카드와 해동이
  미니 프로필이 생겼다. ② 듀오링고식 원색 3D 버튼(AI 프롬프트 복사 그린 버튼, 학습
  방식 6색 타일, 진행바·정오답 색)을 전부 파스텔 톤으로 물러나게 다듬었다 — 타일은
  연한 면 + 진한 글씨, 버튼은 부드러운 그라데이션 알약. ③ 마스코트를 수달이 아니라
  **진짜 해달**처럼 다시 그렸다: 진한 갈색 털에 크림 얼굴, 긴 흰 수염, 크고 까만 코,
  눈에 하이라이트 3개가 반짝이는 크고 귀여운 눈. 살이 찐 듯한 뚱한 몸은 슬림하게
  빼고 머리는 크게(치비 비율) 유지했다. ④ AI 프롬프트가 이제 **정답 보기를 포함한
  모든 보기마다 ①②③④ 개별 해설**을 붙여 달라고 요구하고, 앱도 그 해설을 줄로
  나눠 읽기 좋게 보여 준다(`fmtExplain` — 문제 풀이·뒤집기 카드·시험 성적표 공통).
- **14.14.1 암기카드 화면 다시 다듬기**: 14.14.0 에서 큰 해달·안 보이는 문제가
  지적되어 스크린 테스트로 직접 확인하며 고쳤다. ① 문제는 카드 위에 듀오링고식
  큰 제목(유형 칩 + `clamp(26~38px)` 볼드)으로 항상 뜨고, 뒤집기 카드 앞면은
  질문을 반복하지 않는 '답 보기' 패널로 바꿨다. ② 해달은 180px→`clamp(96~126px)`
  로 줄이고 밝은 모피·작은 눈·두 손 사이 작은 하트로 '징그러움'을 빼고, 머리
  기울임(otterHead)·귀 흔들림(otterEar)·3.8s 윙크(otterBob2)로 계속 움직이게 했다.
  표정 반응(happy/sad)이 끝나면 윙크가 영영 멈추던 버그도 같은 animation 리스트로
  잇어 바로잡았다. ③ 진행바는 듀오링고 그린으로 늘리고, 객관식 보기는 1열 중앙
  정렬 + 3D 눌림 버튼, 학습 방식은 색 3D 타일로 정렬했다. ④ CSS 에서 닫지 않은
  `/* …` 주석 하나로 이후 규칙(학습 방식 그리드·목록 정렬 등)이 통째로 무시되던
  문제도 찾아 바로잡았고, 휴대폰 폭에선 학습 방식 타일이 3열로 접혀 화면 밖으로
  새어나가지 않게 했다. `prefers-reduced-motion` 일 때는 움직임이 전부 멈춘다.
- **14.13.8 창 이동범위 보정**: 엽스코드·단어카드·음악플레이어 같은 플로팅 창은
  화면 어디서든 잡은 만큼 움직이고, 모니터(뷰포트) 밖으로는 한 픽셀도 나가지 않는다.
  예전엔 화면 폭·높이를 `innerWidth`·`clientWidth`·`visualViewport` 를 섞어 추정했는데
  이 값들의 단위가 브라우저·배율·스크롤바마다 달라서 90% 배율 데스크톱에서 **오른쪽
  10% 가량이 창이 갈 수 없는 영역**이었다(어떤 엔진은 반대로 창이 오른쪽 벽을 넘쳤다).
  이제 창과 똑같은 `position:fixed` 좌표계에 '화면 가득 자(프로브)' 를 붙여
  **실제로 다닐 수 있는 사각형을 직접 잰다** — 배율·브라우저·디바이스와 무관하다.
  음악플레이어 큰 창의 최초 크기·중앙 정정과 곡 우클릭 메뉴도 같은 실측을 쓴다.
- **14.13.7 글자 크기 보정**: Alt+휠로 글상자를 키우면(줄이면) 그 배율이 상자의
  '글자 크기'로 그대로 저장되고 툴바의 숫자칸도 같이 따라갑니다. 그래서 키운 직후
  툴바의 '+'를 눌러도 옛 값(처음 16)으로 되돌아가지 않고 지금 보이는 크기에서 더
  커집니다. 상자를 집거나 편집에 들어갈 때도 툴바가 그 상자의 크기를 보여 줍니다.
  글꼴 목록의 미리보기 문구는 `abc 가나다` 로 통일했습니다.
- **14.13.1 화면 동작 보정**: 90% 데스크톱 배율에서도 기존 금속 집게와 줄이
  정확히 이어지고, 화면 위치에 따라 최대 3.2°만 자연스럽게 기울어집니다.
  상대 커서는 25fps 수신 + GPU 이동으로 바뀌었고 펜·북마크·음악창 포인터의
  배율 어긋남도 바로잡았습니다. 빠른 노트 전환 시 편집기가 열리지 않던 회귀도
  수정했습니다.
- **안전한 재배포**: `apply.sh`가 JS 문법/버전을 먼저 검사하고 프런트 파일을
  원자적으로 교체합니다. HTML의 버전 쿼리로 이전 JS/CSS가 섞이지 않습니다.
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
├── sdynotes.html         프런트 마크업
├── sdynotes.css          프런트 스타일시트 (HTML이 참조 — 배포 필수)
├── sdynotes.js           프런트 스크립트 (HTML이 참조 — 배포 필수)
├── apply.sh              배포 스크립트 (★서버에서 실행 — 최초 1회 데이터 자동 이전)
├── docs/
│   └── ci-workflow.yml              CI 워크플로 — .github/workflows/ 로 옮기면 활성화
├── scripts/
│   ├── run-all-tests.mjs            npm test — test:* 그룹 전부 일괄 실행 (알려진 실패 관리)
│   ├── bump-version.mjs             버전 5곳 한 번에 올리기 (--check 은 검사만)
│   ├── migrate_to_oracle.mjs        Supabase/Cloudinary → Oracle 디스크 일괄 이전
│   └── ensure_nginx_voice_ws.py     기존 nginx site 에 음성 WS Upgrade 경로 보강
├── server/               Node(Fastify) 메인 서버
│   └── src/
│       ├── index.js      앱 조립 + 기동 (:5000)
│       ├── lib/          경로/설정/락/SSE/관리자/저장소(dbstore)/워커프록시
│       └── routes/       pages·sync·admin·vault·cards·stickers·wallpaper·
│                         translate·notify·live·misc·music·db·friends·dm
└── worker/               Python 워커 (127.0.0.1:5100)
    ├── requirements.txt  파이썬 의존성 (버전 고정 — yt-dlp 만 매 배포 최신)
    ├── run.py            기동
    └── sdynotes_worker/
        ├── importer.py   가져오기 (원본 그대로 보존)
        ├── music.py      음악 태깅/유튜브/인식 (원본 그대로 보존)
        ├── music_cloud.py 클라우드 음악 변이 (legacy 모드에서만 활성)
        ├── extra.py      /api/music/play 로컬 폴백
        └── core/common/cloud/admin/notify.py  지원 모듈
```

## 개발 워크플로 (테스트 · 버전)

| 하고 싶은 일 | 명령 |
|---|---|
| 전체 테스트 한 방 | `npm test` — `test:*` 그룹을 package.json 순서대로 전부 실행 |
| 그룹 골라 실행 | `npm run test:only -- music,auth` |
| 엄격 모드 | `npm run test:strict` — '알려진 깨진 그룹'도 실패로 처리 |
| 버전 올리기 | `node scripts/bump-version.mjs 14.16.5` — 버전 5곳을 한 번에 |
| 버전 동기화 검사 | `npm run bump:check` (CI 도 같은 검사를 돌린다) |

- CI 워크플로는 `docs/ci-workflow.yml` 로 준비돼 있다. `.github/workflows/ci.yml`
  로 옮겨 커밋하면 브랜치 push 마다 `npm ci` → worker `requirements.txt` 설치 →
  파이썬 문법 검사 → 버전 동기화 검사 → `npm test` 가 돌아간다.
- worker 파이썬 의존성은 `worker/requirements.txt` 로 고정돼 있고, yt-dlp 만
  유튜브 대응상 매 배포 최신으로 갱신된다(apply.sh).
- `scripts/run-all-tests.mjs` 의 `KNOWN_FAILS` 는 CI 가 없던 시절 깨진 채 남은
  그룹 목록이다. 소스를 고쳐 통과하면 러너가 *unexpected pass* 로 알려 주므로
  그때 목록에서 지우면 된다. 현재 목록은 비어 있어 CI는 모든 그룹 통과를 요구한다.
  목록 밖에서 새로 깨지는 그룹은 곧바로 실패 처리된다.
- 각 그룹은 자기만의 프로세스 그룹에서 돌리고 끝나면 그룹 전체를 정리한다 —
  테스트가 띄운 서버가 고아로 남아 시스템을 메우는 사고를 막는다.

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
# zip에 apply.sh · package.json · sdynotes.html · sdynotes.css · sdynotes.js ·
# server/ · worker/ · scripts/ 를 모두 넣고
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
- `APP_VERSION` 은 프런트 `<meta name="application-version">`(14.13.1) 와 일치해야
  합니다.
- 이스터에그(쫄라맨 야구)는 프런트 전용 — `sdynotes.html` 그대로 서빙하므로 유지.
- **디스크가 이제 영구 저장소** — 음원/이미지/보관함이 모두 VM 디스크에 쌓이므로,
  스냅샷/백업(`tar` 한 번이면 `sync/ cards/ db/ music/ stickers/ wallpaper/
  vault/ imported/ dm/` + `.sdy_users.json .sdy_user_sessions.json .sdy_friends.json
  .sdy_dm.json` 전부 백업됨)을 주기적으로 챙기세요.

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

## 16.2 · 로그인/회원 (이메일 OTP · 선택 사항)

로그인하지 않아도 사이트 전부를 쓸 수 있다. 로그인하면:

- **엽스코드 고정 닉네임** — 엽스코드 진입 시 `로그인하고 입장 / 비회원으로 입장`
  두 문 중에서 고른다. 회원은 서버가 고정 닉네임을 강제하고(게스트가 흉내 내면 409),
  이름 옆에 회원 배지(✔)가 붙는다.
- **올린 곡 표시** — 로그인한 상태에서 올린 곡(파일·유튜브)은 음악 목록에서
  제목 옆에 `👤 닉네임` 마크가 작게 붙는다(worker 가 `/internal/whoami` 로 신원 확인).

비밀번호가 없다: 이메일로 오는 6자리 인증 코드(OTP, 10분·일회용)로만 로그인한다.

```
POST /api/auth/otp      {email}              → 코드 발송(SMTP) · registered 여부
POST /api/auth/verify   {email,code,nick?}   → 토큰 발급 (새 이메일이면 닉네임 등록)
GET  /api/auth/me       (x-sdy-auth 헤더)    → 내 정보 (세션 30일 자동 연장)
POST /api/auth/nick     {nick}               → 고정 닉네임 변경 (유일해야 함)
POST /api/auth/logout                          → 토큰 무효화
POST /internal/whoami   {token}              → loopback 전용 (worker 용 신원 조회)
```

**SMTP 설정** (설정하지 않으면 코드를 서버 콘솔에만 찍는다):

```
SDY_SMTP_HOST=smtp.gmail.com
SDY_SMTP_PORT=587          # 465면 암시적 SSL, 587는 STARTTLS
SDY_SMTP_USER=sdynotes@gmail.com
SDY_SMTP_PASS=앱비밀번호     # Gmail: 2단계 인증 후 발급 (빈칸 없이 16자)
SDY_SMTP_FROM=sdynotes@gmail.com   # 생략하면 USER 사용
SDY_AUTH_DEV_CODE=1        # (개발/점검 전용) SMTP 실패·미설정 시 응답에 코드를 실어 준다
SDY_AUTH_OTP_COOLDOWN=45   # 코드 재발송 대기(초, 기본 45)
```

값은 **`APP_DIR/.env`** 하나에 둔다(`apply.sh` 의 systemd EnvironmentFile 가 같은 파일을 읽고,
로컬 실행은 `server/src/lib/env.js` 가 직접 읽는다 — 이미 시스템에 있는 값은 덮어쓰지 않는다).

> 참고 · Oracle Cloud(OCI) 서버: 기본적으로 아웃바운드 SMTP(25/465/587)가 막혀 있다.
> `SMTP 응답 대기 시간 초과` 가 계속되면 OCI 콘솔에서 메일 릴레이 제한 해제를 요청하거나,
> 587 회선이 열린 상태인지 확인한다. 코드·설정이 맞아도 회선이 막히면 메일이 못 나간다.

상태 파일: `.sdy_users.json`(회원) · `.sdy_user_sessions.json`(세션) — 서버 디스크에만 있다.

## 16.3 · 친구 + 1:1 대화 (DM)

로그인한 회원끼리 **친구를 맺고** 둘만의 1:1 대화를 나눈다. 앱 전체 공용인 엽스코드
방과 달리, 친구 관계·대화 내용은 **서버 디스크에 남는다** — 상대가 지금 접속해
있지 않아도 본낸 메시지는 그대로 전달된다(다다음에 접속하면 안 읽은 수로 뜬다).

- **친구 추가**: 엽스코드 헤더의 친구 버튼(👥) → 친구의 고정 닉네임으로 요청.
  상대가 친구 화면에서 **수락**하면 친구가 된다. 서로 동시에 요청하면 바로 친구.
  요청은 7일(`SDY_FRIEND_REQ_TTL`) 지나면 자동 만료.
- **1:1 대화**: 친구를 누률 때 열린다. 텍스트·사진(8MB)·파일(20MB) 전송,
  읽음 표시(내 메시지 옆 '1'), 상대 온라인 표시(🟢), 이전 대화 더 보기,
  내 메시지 삭제. 친구끼리만 가능(서버가 강제, 403 `not_friends`).
- **실시간 전파**: 회원 SSE(`/api/dm/stream`) 하나로 새 메시지·읽음·친구 변화·
  접속 상태가 모두 온다. 엽스코드를 열지 않아도 로그인만 돼 있으면 수신되고,
  스트림이 열린 회원은 친구들에게 '온라인'으로 표시된다.
- **알림**: 엽스코드 칩과 친구 버튼에 안 읽은 합계 뱃지. 새 DM 이 오면 소리·
  데스크톱 알림(설정 존중) + 칩 흔들기.
- **정리 규칙**: 스레드당 최근 500개(`SDY_DM_MAX_MSGS`), 30일 지난 메시지는
  자동 삭제(`SDY_DM_TTL`). 사진/파일은 `dm/` 폴터에 저장하고 총 256MB
  (`SDY_DM_FILE_MB`)를 넘으면 오래된 파일부터 지우고 메시지에는 "오래돼 사라진
  사진이에요"로 표시된다.

```
GET  /api/friends/list      내 친구 목록 + 받은/본낸 요청 (online 포함)
GET  /api/friends/summary   뱃지용 요약 {requests_in, unread_dm}
POST /api/friends/request   {nick}   닉네임으로 요청 (서로 요청하면 자동 수락)
POST /api/friends/accept    {uid}    수락        POST /api/friends/decline {uid} 거절
POST /api/friends/cancel    {uid}    본낸 요청 취소
POST /api/friends/remove    {uid}    친구 삭제 (양쪽 모두에게 즉시 반영·DM 차단)

GET  /api/dm/stream?token=  회원 SSE — 이벤트: hello / dm_msg / dm_read / dm_del / friend / presence
GET  /api/dm/threads        내 대화 목록 (상대·마지막 메시지·unread·online)
GET  /api/dm/history/:peer  히스토리 (?before=<id>&limit= — more 로 이전 페이지)
POST /api/dm/msg            {to,text}
POST /api/dm/upload         사진/파일 (multipart, 필드 to)
GET  /api/dm/file/:id       첨부 낭미 받기 — 대화 참여자만 (그 외 403)
POST /api/dm/read           {to,id}  읽음 처리 → 상대에게 dm_read
POST /api/dm/del            {to,id}  내 메시지 삭제
```

전부 인증 필요(`x-sdy-auth` 또는 `Bearer`). 상태 파일: `.sdy_friends.json`
(`pairs` + `requests`) · `.sdy_dm.json` (`threads` + 파일 인덱스) — 서버 디스크에
만 있다. 메시지 저장은 250ms 디바운스로 묶어 쓴다(채팅 버스트 대비).

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

# 16.2 — 로그인(이메일 OTP) + 엽스코드 입장 게이트 + 올린 곡 표시
node test/auth_contract.mjs        # OTP 발급/검증·회원가입·고정닉 보호·whoami·목록 통과  (npm run test:auth)
node test/yp_gate_contract.cjs     # 입장 게이트 두 문·비회원/로그인 흐름·마크 소스 계약  (npm run test:gate)
node test/smtp_contract.mjs        # 최소 SMTP 클라이언트: STARTTLS·AUTH LOGIN·MIME (가짜 서버) (npm run test:smtp)

# 14.12 — Oracle 자체 저장소 (로컬 DB·shim·이전 시뮬레이션)
node test/oracle_db_contract.mjs   # dbstore/db 라우트 + 노트 이미지 로컬 저장
node test/sdb_shim_contract.mjs    # 프런트 SDB shim ↔ 서버 descriptor 계약
node test/migrate_oracle_sim.mjs   # 모의 Supabase/Cloudinary → 오라클 이전 전 과정

# 16.3 — 친구 + 1:1 대화 (서버 계약 48건 + 프런트 jsdom 29건)
node test/friends_dm_contract.mjs  # 친구 요청/수락/삭제·DM 전송/읽음/파일 권한·SSE (npm run test:friends)
node test/yf_dm_frontend_contract.cjs # 친구 패널·DM 뷰·전송 계약·뱃지·비로그인 안내 (jsdom)

# 14.13.8 — 플로팅 창 이동범위 = 모니터 안쪽 (환경과 무관하게 실측)
npm run test:bounds                 # 경계 계약 + 가짜 브라우저 6종(단위 제각각) × 창 4종 시뮬레이션

# 14.13.7 — Alt 배율 글자 크기 저장 + 툴바 동기화 + 글꼴 미리보기 문구
npm run test:font                     # 소스 계약 + jsdom 런타임(Alt+휠 → '+' → 서버 저장)

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
