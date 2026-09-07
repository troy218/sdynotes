# PDF 논문 가져오기 품질 개선 — 14.37.1 / 14.38.1

검증일: **2026-09-07** · 기준 버전: **14.37.0** (`2582856`) · 결과 버전: **14.37.1**, 수식 후속 **14.38.1**

> 코드와 공개 샘플에 대한 검증 기록이다. **사용자가 문제를 겪은 PDF는 아직 받지 못했으며, 해당 문서의 정확도를 검증했다고 주장하지 않는다. 운영 배포도 별도다.**

## 14.38.1 — 깨진 LaTeX 수식 (사용자 보고)

사용자가 보고한 실제 출력: `\mathcal{C} _{\Delta} ( u _{i} , v \hat _{i} , Q _{i} )` · `\mathrm{e} \mathrm{x} \mathrm{p}` · `( 5 . , 4 4 )`. 첫 번째는 KaTeX 파스 오류(`Expected group after '_'`)라 수식 자리에 빨간 원문이 찍힌다.

| 원인 | 고친 방법 |
|---|---|
| TeX 는 `\hat v` 를 글자 + 그 위의 악센트 두 글리프로 조판한다. 읽는 순서로 이으면 `v \hat` 이 되고 뒤따르는 첨자를 악센트가 인수로 삼켜 파스 오류가 된다. | `_attach_accents` 가 **위치로 밑글자를 찾아** `\hat{v}` 로 붙인다(악센트 아래·가로 중심이 겹치는 가장 가까운 글자). 붙일 글자가 없으면 명령을 버린다. |
| 글꼴이 뜻하는 스타일을 **글자마다** 씌워 `exp` 가 `\mathrm{e}\mathrm{x}\mathrm{p}` 로 굳었다. 낱말 병합과 `\exp` 연산자 복원이 모두 막히고, 지수의 숫자까지 `\mathrm{1}` 이 됐다. | 스타일을 `Box.style` 로 들고 다니다 **낱말로 합친 뒤 한 번만** 씌운다. `exp`→`\exp`, `AdS`→`\mathrm{AdS}`, 숫자는 그대로. |
| 수식 밴드가 기하로 자라다 식 번호 `(5.44)` 를 품으면 `( 5 . 4 4 )` 가 식의 일부로 조립됐다. | `_is_equation_label` 로 번호를 인식해 밴드가 흡수하지 못하게 하고, 이미 들어온 번호는 `_trim_band_labels` 가 밴드를 잘라 낸다. 번호는 계속 편집 가능한 글상자다. |
| 인수 없는 명령(`\widetilde ^{a}`, `\mathcal _{x}`)이 남으면 요소 전체가 빨간 오류로 그려졌다. | `_tidy_latex` 가 고칠 수 있으면 고치고, 그래도 남으면 `_latex_is_sane` 이 **거부**한다 → 기존 방침대로 그 자리는 원본 벡터를 보존한다. |
| 이미 가져온 노트에는 깨진 문자열이 그대로 저장돼 있다. | 프런트 `tidyLatex` 가 **그릴 때도** 같은 규칙으로 고친다. 내보내기(PDF/JPG) 두 경로도 같은 문자열을 굽는다 — 예전에는 화면만 멀쩡하고 내보낸 파일에 빨간 오류가 남을 수 있었다. |

검증: `npm run test:pdf`. 사용자가 보고한 모양(악센트 글리프 + `exp` + 식 번호 + 중첩 분수)을 `test/import_pdf_fixture.py` 의 실제 PDF 쪽으로 추가했고, 검사 2개를 새로 넣었다. **수정 전 코드로 돌리면 두 검사가 실패한다** — `'\hat{v}' not found in 'C = \frac{\frac{\exp v ^{\hat} \omega}{b}}{\frac{c}{d}} ( 5 . 4 4 )'`, `'v \hat _{i}' != '\hat{v} _{i}'`. 변환 결과의 모든 수식을 앱과 같은 KaTeX 0.16.11 로 실제 렌더해 오류 0 을 확인했다.

남는 한계: 이 수정은 **새로 변환하는 PDF** 의 조립 품질을 고친다. 이미 저장된 노트는 렌더/내보내기 단계에서만 복구되므로, 원래 잘못 조립된 구조(예: 삼켜진 식 번호)는 다시 가져와야 사라진다. 아래 14.37.1 의 남은 범위도 그대로 유효하다.

## 변경 사항

### 본문·그림의 중복과 글자 겹침

- 표를 먼저 찾고, 그림은 가까운 캡션/연결된 도형을 기준으로 한정한다. 다른 캡션과 본문은 영역을 확장하지 못하게 하는 경계다. 아주 복잡한 벡터 페이지에서는 무리하게 영역을 합치지 않는다.
- 그림이 소유하는 글자는 **글리프 전체가 영역 안에 들어온 경우**로 한정한다. 경계에 걸친 글자는 편집 가능한 본문에 남기고, 이미지에서는 해당 글리프만 제거한다.
- 같은 글꼴/스타일의 거의 같은 위치에 중복된 글리프는 한 번만 가져온다. 보이지 않는 OCR 레이어는 새로 그리지 않는다.
- 배경을 큰 흰 사각형으로 지우는 대신, MuPDF SVG의 글리프 원점/문자 식별자로 **실제로 편집기로 옮긴 글자만** 뺀다. TeX 루트나 큰 괄호의 과도한 글꼴 bbox 때문에 이웃 기호까지 지워지던 문제를 피한다. 원본 PDF 객체를 훼손하지 않는다.
- 사진 저장이 실패하면 그 영역은 배경에 원본으로 남긴다. 전체 변환이 실패하면 원본 페이지 스냅샷을 우선해 빈 페이지/이중 본문을 피한다.

### 글꼴과 배치

- PDF의 소수점 좌표, 원래 단어/스타일 구간의 폭, 기준선, 크기, 굵기, 기울임과 색을 유지한다. 다시 양끝 정렬하거나 HTML `<sup>/<sub>`로 위치를 추측하지 않는다.
- `data-pdf-w` / `data-pdf-base`를 실제 로드된 글꼴의 Canvas 측정값과 맞춘다. 예전 `data-j` 구간의 보정 제외와 84% 압축 하한을 없앴다. 새 PDF 글상자를 이웃 문단까지 자동으로 키우지 않는다.
- 전역 `*` 스타일의 UI 글꼴이 가져온 단어의 글꼴을 덮어쓰지 않게 했다. 글상자 테두리가 PDF 좌표를 밀지 않게 했다.
- 단순 bbox 포함 관계만으로 서로 다른 문장을 지우던 프런트 중복 제거에서, 이미 글리프 단위로 처리한 `pdfText` 요소를 제외했다.
- `fi`, `fl` 등의 합자는 검색/복사 가능한 문자로 표시하되 원래 폭과 배경의 원본 글리프 식별자는 유지한다.
- Times/Nimbus Roman → **Tinos**, Arial/Helvetica/Nimbus Sans → **Arimo**, Computer Modern/Latin Modern Roman → **CMU Serif 기반 글꼴**을 자체 호스팅한다. 정체를 알 수 없는 이름은 PDF 글꼴 플래그로 계열을 추정한다. 라이선스·출처·재패키징 절차: [`server/assets/fonts/README.md`](../server/assets/fonts/README.md).

### 표와 수식의 보존 원칙

- **단순한 표:** 원래 선/채움/간격을 배경에 두고, 글자는 원래 위치의 편집 가능한 요소로 유지한다. 임의의 회색 격자·패딩·행 높이를 만들지 않는다.
- **복잡한 표:** 병합 셀이나 확장 글리프 등 구조 복원이 불확실하면 300dpi 무손실 PNG로 보존한다. 저품질 JPEG로 압축하지 않는다.
- 기존 LaTeX 조립기는 유지한다. 다만 본문을 삼키는 수식 후보를 거부하고, 서로 겹치는 밴드/불확실한 다중 행 수식과 변환되지 않은 수학 전용 글리프는 원본 벡터로 보존한다. 샘플 Adam의 잘못 조립된 첨자/시그마와 본문 누락을 이 방식으로 방지했다.
- **편집성의 절충:** 원본 보존 영역은 개별 셀/기호 편집 대상이 아니다. 단순 표도 스프레드시트 구조(`tbl`)로 재구성한 것이 아니라 글자 편집 + 원본 선이다. 변환된 LaTeX 요소와 일반 본문은 계속 편집할 수 있다.

### 확대·저장·내보내기

- 최초 변환의 배경 생성 계획을 `{ref}.bg{sourcePage}.gz`에 따로 저장한다. 큰 글리프 배열은 브라우저/동기화 모델로 보내지 않는다.
- 배경 요소의 `pdfBg:2`, `pdfPage`, `pdfRef`가 원본을 가리킨다. 쪽 이동/본문 편집 후 고화질 배경도 동일한 계획으로 만든다. 다른 방식으로 재분할해 원래 글자를 되살리지 않는다.
- SVG 배경은 불필요하게 래스터로 승급하지 않는다. 계획이 없는 구버전 문서, 만료된 원본의 404/410은 기존 배경을 유지하며 반복 요청하지 않는다.
- `/Rotate`는 원본을 바꾸지 않는 사본에 반영해 텍스트와 배경 좌표를 일치시킨다. 거꾸로 된 글자를 똑바른 글자로 바꾸지 않으며, 크롭 경계의 수학/회전 글리프도 편집 텍스트처럼 지우지 않는다.
- JPG/PDF 내보내기용 SVG에 필요한 PDF 글꼴과 KaTeX CSS/글꼴을 인라인한다. 캔버스 텍스트 폴백도 단어 폭/기준선을 보존한다. 수식의 화면 밖 측정기는 실제 수식 상자와 같은 크기/여백을 사용한다.
- 글상자 크기 조절 때 PDF 구간 폭/기준선/좌표도 함께 배율을 적용한다. 구간 안에 새 서식이 중첩되면 단일 글꼴의 Canvas 추정 대신 실제 DOM 폭을 측정한다.
- 화면용 맞춤은 모델의 HTML·dirty·동기화 해시를 바꾸지 않는다. 기존 읽기/쓰기 예산, 프레임당 제한, 늦게 로드된 글꼴의 캐시 무효화를 유지한다.

## 실제 원본/편집 화면 비교

공개 논문 **3종의 7쪽**을 실제 워커로 변환하고, 실제 `sdynotes.html/js/css`를 Chromium에서 열어 캡처했다. 원본 페이지 미리보기 이미지를 대신 보여주는 방식이 아니다. 모든 쪽에서 편집 가능한 텍스트/수식 요소 수가 변환 결과와 일치하는지도 검사했다.

| 샘플 | 쪽 | 최종 확인 내용 | 실제 DOM의 위치 지정 구간 수 |
|---|---:|---|---:|
| ResNet | 2 | 잔차 블록 주변 본문, 양단 본문, 기울임/수학 글리프 | 853 |
| ResNet | 4 | 큰 네트워크 도식과 옆 본문 분리, 작은 도식 라벨 | 520 |
| ResNet | 5 | 위쪽 구조 표와 아래 그래프를 분리, 작은 표, 본문 간격 | 458 |
| Attention Is All You Need | 3 | 모델 도식, 캡션, 아래 본문 | 297 |
| Attention Is All You Need | 6 | 잘리던 표 캡션, booktabs 선, 표 안 수식, 본문/독립 수식 | 556 |
| Attention Is All You Need | 8 | 다중 헤더 표, 굵은 숫자, 지수와 각주 | 567 |
| Adam | 3 | 본문 안 기호, 본문을 삼키던 수식 후보, 수식끼리 겹치는 밴드 | 668 |

확인한 결과:

- 변경 전의 sans-serif 대체·문자 충돌과 표/그림의 과도한 합침이 크게 줄었다. 원본과 수정 전/후 이미지를 직접 대조했다.
- 최종 7쪽 모두 브라우저 페이지 오류 0, 원본 페이지 미리보기 이미지 0, 렌더 과정에서 사라진 텍스트/수식 요소 0.
- 지정된 동일 기준선상의 편집 구간에서 **PDF 원본에는 없던 새 단어 겹침 0**. 실제 DOM 구간 폭과 기록된 PDF 폭의 최대 차이는 약 **0.00042 CSS px**였다.
- 이는 구간 배치 검사이지 **모든 글리프의 픽셀 일치율**이나 모든 논문의 정확도 점수가 아니다. 그림/표/기호 보존은 원본과 별도로 눈으로 확인했다.
- 합성 PDF의 글꼴 로딩 600ms 지연 및 자체 호스팅 글꼴 전체 차단도 확인했다. 두 경우 모두 새 단어 겹침 0; 차단 때 최대 폭 차이는 약 0.0133px였다. Helvetica 본문도 포함한다.
- 합성 PDF 두 쪽에서 원래 구간 안에 굵은 서식을 중첩하고 125%로 크기를 조절한 뒤에도 실제 DOM 폭 맞춤 검사를 통과했다.
- 편집 화면과 내보내기 결과는 합성 수식/표, ResNet 5쪽, Attention 6쪽에서 추가로 대조했다. 고화질 배경 캡처도 생성했다.

### 로컬 검증 산출물 (Git 제외)

- `import_uploads/visual/before/`: 수정 전 실제 편집 화면.
- `import_uploads/visual/final/`: 원본, 최종 편집 화면, 고화질 배경 화면, 내보내기 PNG, `manifest.json`, `results.json`.
- `import_uploads/visual/comparisons/pdf-import-comparison.png`: ResNet 표/본문의 원본·수정 전·수정 후 비교.
- `import_uploads/visual/comparisons/attention-table-comparison.png`: 표/캡션 비교.
- `import_uploads/visual/comparisons/*-pair.png`: 쪽별 원본/편집 화면 및 내보내기 비교.
- `import_uploads/visual/{delayed-fonts,fallback-fonts}/`: 지연/실패 상황 캡처.

## 회귀 테스트 결과

- `npm test`: **56 그룹 통과, 실패 0, 알려진 실패 0**.
- 새 `test:pdf`: 실제 PDF를 만드는 Python 테스트 **23개** + 프런트 맞춤/보존/폰트 서빙 계약 통과.
- 전체 스위트 통과 후 추가한 크롭 경계의 수학 글리프/180도 텍스트 검사도 실패 재현 후 수정하고 PDF·미리보기·방향 그룹을 다시 실행했다. 혼합 서식/크기 조절의 프런트 검사를 보강한 뒤 글꼴·편집·활성화 그룹도 재검증했다.
- 기존 표 편집, 글꼴, undo/협업, 읽기→편집 전환, 페이지 활성화, 큰 문서/저사양, 이미지·스티커 흐름도 전체 스위트에 포함된다.
- `python -m compileall -q worker`, `node --check sdynotes.js`, `node scripts/bump-version.mjs --check`, `git diff --check` 통과.
- 환경: PyMuPDF 1.28.2, Chromium 149.0.7827.0, 앱과 같은 KaTeX 0.16.11.

## 재현 방법

```sh
npm ci
python3 -m venv .venv
.venv/bin/pip install -r worker/requirements.txt
PATH="$PWD/.venv/bin:$PATH" npm run test:pdf

# 브라우저는 Playwright 기본 설치 또는 SDY_CHROMIUM_PATH로 지정한다.
npx playwright install chromium

# 테스트 브라우저는 외부 요청을 차단한다. 앱과 동일한 KaTeX를 로컬에 준비한다.
mkdir -p import_uploads/visual/katex
npm pack katex@0.16.11 --pack-destination import_uploads/visual
tar -xzf import_uploads/visual/katex-0.16.11.tgz \
  --strip-components=1 -C import_uploads/visual/katex

SDY_REVIEW_KATEX="$PWD/import_uploads/visual/katex/dist" npm run bench:import
SDY_REVIEW_FONT_DELAY=600 SDY_BENCH_OUT=import_uploads/visual/delayed-fonts npm run bench:import
SDY_REVIEW_NO_FONTS=1 SDY_BENCH_OUT=import_uploads/visual/fallback-fonts npm run bench:import
```

실제 PDF를 지정할 때 (`:1,3,5`는 **1부터 시작하는 쪽 번호**):

```sh
.venv/bin/python scripts/import-visual-fixture.py \
  --out import_uploads/review path/to/paper.pdf:1,3,5
SDY_REVIEW_KATEX="$PWD/import_uploads/visual/katex/dist" \
  node scripts/import-visual-review.mjs import_uploads/review/manifest.json
# 내보내기도 캡처: SDY_REVIEW_EXPORT=1
# 캡처 후 혼합 서식/크기 조절 검사: SDY_REVIEW_EDIT_CHECK=1
```

브라우저 설치가 제한된 환경에서는 호환되는 로컬 Chromium 경로를 `SDY_CHROMIUM_PATH`로 지정한다. 이번 작업 환경에서는 `@sparticuz/chromium@149.0.0`을 scratch 디렉터리에 풀어 사용했다. 브라우저/공유 라이브러리/논문 PDF/캡처 파일은 저장소에 추가하지 않는다.

### 사용한 공개 PDF의 정확한 식별자

출처: <https://github.com/tpn/pdfs>. 파일명이 같은 다른 리비전과 혼동하지 않도록 Git blob SHA를 기록한다.

| 파일 | Git blob SHA |
|---|---|
| `Deep Residual Learning for Image Recognition (1512.03385v1).pdf` | `4b29933825685003bebd6ccf14d55869dca85806` |
| `Attention Is All You Need - 2017 (1706.03762).pdf` | `5cf8ea6dc51086113c0755ff40d7eef594b7bd95` |
| `Adam - A Method for Stochastic Optimization (1412.6980v9).pdf` | `ebf3aff96246fd563f4c11ebe7eeb49053b159c9` |

필요하면 GitHub API의 `repos/tpn/pdfs/git/blobs/<sha>` 응답 `content`를 base64 디코드해 로컬 fixture를 준비할 수 있다. 생성한 manifest에는 PDF SHA-256도 기록한다. 이 논문들은 **사용자 제공 문제 문서의 대체 검증이 아니다.**

## 남은 범위와 적용 시 주의

1. **사용자 PDF 검증 대기.** 문제가 있었던 PDF와 쪽 번호를 받아 같은 원본/편집/확대 비교를 반복해야 한다. 이 단계 전에는 사용자 논문을 정확하게 가져온다고 보장할 수 없다.
2. 새 분할·글꼴 추정·배경 계획은 **새로 변환하는 PDF**에 적용된다. 기존에 손실된 글자/잘못 자른 이미지는 프런트 업데이트만으로 복구할 수 없다. 기존 편집분을 덮어쓰지 말고 원본을 별도 노트로 다시 가져와 비교한다.
3. 모든 임베디드 글꼴을 추출하는 기능은 아니다. 비슷한 영문 글꼴과 원래 폭/기준선을 사용한다. 힌팅·앤티앨리어싱·특수 서체의 모양 차이는 남는다.
4. 그림/복잡한 표의 PNG는 300dpi다. 아주 작은 라벨을 축소하면 원본 PDF의 직접 렌더보다 부드러워 보일 수 있다. 큰 확대에서 무한한 벡터 해상도를 보장하지 않는다.
5. 복잡한 표/불확실한 수식/비상 페이지 스냅샷은 모양 보존 대신 개별 텍스트 편집성이 제한된다. 원본 벡터에 남긴 인라인 수학 글리프도 독립적인 편집 구간이 아니다.
6. 스캔 PDF의 OCR, 모든 캡션 없는 레이아웃, 임의의 다단/회전/Type3 폰트 조합을 완벽하게 해결했다고 주장하지 않는다. 원본 보존 폴백과 실제 문서별 비교를 유지한다.
