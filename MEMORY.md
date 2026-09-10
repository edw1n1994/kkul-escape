# MEMORY — 키이스케이프 예약 자동화 (다른 LLM/개발자용 핸드오프)

> 이 문서는 세션 메모리를 이관하기 위한 것이다. 코드가 정답이고 이 문서는 방향·경험·금기 사항을 담는다.
> 모든 실측은 2026-09-07 ~ 09-09, macOS + Chrome CDP :9222 환경에서 얻은 것.

## 소스 정리 (2026-09-10)

- 현재 폴더 안내: `docs/STRUCTURE.md`. Windows 안내는 `docs/WINDOWS.md`.
- 초기 루트 실험 스크립트와 `mapping.json`·`SUMMARY.txt`는 `tools/legacy/`로 이동.
  기존 루트 로그·스크린샷은 `.local/legacy/`에 보관하고 Git·배포에서 제외.
- Docker 보조 스크립트는 `scripts/docker/`. Dockerfile과 호출 경로도 갱신.
- `ui/`, `desktop/`, `ext/`의 실행 소스와 루트 설치 진입점은 유지.
  루트 README는 사용자 요청에 따라 계속 빈 파일.
- `npm run check`: 오프라인 문법 검사. `npm test`: 문법 + 앱·제로월드 게이트 테스트.
  `npm run test:browser`: 기존 CDP 픽스처 테스트.
- 아래 메모는 과거 동작 기록을 포함한다. 제로월드 제출 관련해서는 최신 사용자 요청
  (사람이 코드를 입력하면 자동 진행)이 이전 자동 제출 금지 기록에 우선한다.

## 네이버 앱 연결 (2026-09-10)

- 네이버 탭·로그인창·상품/날짜/시간 선택·미리보기·실행을 연결했다.
- `ui/naver-products.json`에 상품별 요일 시간표와 오픈 시각을 등록한다.
- 9/16 예약 오픈은 9/10 00:00 KST(달력 차이 6일). 과거 문서의 D-7은 포함 일수 표현이다.
- 런너는 자체 탭만 열고 날짜 잠금 해제 → 클릭 반영 확인 → 회차 선택 → 다음 1회 → 신청서 확인.
  최종 확인·결제는 앱에서 자동 클릭하지 않는다. 별도 navpeek 작업의 최종 클릭 설정과 구분한다.
- 네이버 화면 요청 제한 시 중단하며, 사용자 인증·캡차는 직접 처리한다.
- 앱 배포 목록에 naver 모듈 2개와 상품 JSON을 포함했다.

## 0. 30초 요약

- 목적: `keyescape.com`(및 같은 코드의 `zeroworldkorea.com`) 예약 화면에서 **슬롯이 열리는 순간** 잡아
  reservation2 폼을 자동으로 채우고, **사람이 reCAPTCHA 를 통과한 뒤** `예약하기` 클릭까지(옵트인) 대행.
- 현재 상태: 로컬/컨테이너 전부 동작. 단위 테스트 `submit-test` 16/16 + `dps-test` 30/30,
  컨테이너 설치 테스트 A~J 106건(로컬 실행에서는 컨테이너 전용인 `Chromium 바이너리` 1건만 실패).
  공개 저장소 `https://github.com/edw1n1994/kkul-escape` 에 푸시됨(이 폴더가 git 체크아웃).
- **세 번째 사이트 단편선(`dpsnnn.com/reserve_g`, 아임웹) 추가**: 무통장입금 + 이름/연락처/입금자명,
  **로그인 필수**(상단 `로그인` 배지로 표시), 자동등록방지는 없지만 **최종 결제 클릭은 절대 하지 않는다**.
- **불변의 경계**: reCAPTCHA 는 반드시 사람이 통과한다. 토큰 생성/대입/위젯 실행 코드는 존재하지 않고,
  설치 테스트가 그 패턴의 부재를 검사한다. 결제·개인정보 우회도 없다.

## 1. 환경 좌표

| 항목 | 값 |
|---|---|
| 코드 루트 | `keyescape-devtools-unlock/` (= git 리포지토리, remote `origin` = kkul-escape) |
| UI 서버 | `ui/server.mjs` → 로컬 `http://127.0.0.1:8899`, 컨테이너 `:8898` (이미지 `keyescape-ui`, 컨테이너 `ke-ui`) |
| 브라우저 | Chrome CDP `http://127.0.0.1:9222` (**다른 자동화와 공유 — 크롬·프로세스를 한꺼번에 죽이면 안 됨**) |
| 러너 | `ui/runner.mjs` (의존성 0, Node 22+ 전역 WebSocket 사용) |
| 개인 값 | `--name/--hp/--dep` → 환경변수 `KEYESCAPE_NAME`/`KEYESCAPE_HP`/`KEYESCAPE_DEP` → `ui/local.env` (git·docker 무시) |
| 단편선 좌표 | `https://www.dpsnnn.com/reserve_g` (강남) · `menu_code=m2021111422e8d3a51ef50` · 달력 `POST /booking/html_list.cm` · 슬롯 `POST /booking/get_prod_list.cm` · 결제 `/shop_payment/?order_code=…` — 상세 `ui/dps.mjs` |
| 재시작 | `sh ui/ui.sh` (포트/CDP 확인 후 기동) — 세션용 임시 스크립트는 `/tmp` 에 있었으므로 재현 보장 없음 |

## 2. 실행 흐름 (핵심 파일: `ui/runner.mjs`, `ui/lib.mjs`, `ui/sites.mjs`)

1. 슬롯 조회는 브라우저가 아니라 **서버 API 직접 호출**: `POST https://www.keyescape.com/controller/run_proc.php`
   (`t=get_theme_info_list | get_theme_date | get_theme_time`) — `lib.rpc()`, 쿠키·세션 불필요.
2. `--open-at`(오픈 시각) 까지 1초 틱으로 대기 → `--preroll`(기본 20초) 전부터 폴링.
   폴링 간격: CDP 경로 45ms(`--poll-open`), 감시 전용 300ms(`WATCH_POLL`, 최소 120ms). 마감 `--deadline` 기본 60초.
3. 히트(`enable === 'Y'` && 목표 시간) → `lib.postNav()` 가 Step1 NEXT 가 만드는 것과 같은 폼을 만들어
   `reservation2.php` 로 **POST** (딥링크 GET 은 선택을 반영하지 못한다 — 실측으로 확인됨).
4. `Page.addScriptToEvaluateOnNewDocument` 로 등록해 둔 `lib.filler()` 가 새 문서에서
   이름/연락처/약관을 채운다(사이트 자체의 리액트식 value setter 우회 + input/change 이벤트).
5. 여기서부터 사람: reCAPTCHA 체크 → `예약하기`. `--auto-submit` 을 켰으면 토큰이 관찰된 뒤 `lib.step2Submit()`
   이 검증 후 **1회만** 클릭한다(`window.__SUBMITTED` 로 중복 방지).
6. 종료 코드: `3` CDP/탭 없음, `4` POST 실패, `7` 디버거 차단 화면.

주요 플래그: `--site keyescape|zeroworld` `--zizum --theme --info --date --times --tname`
`--open-at --deadline --preroll --poll-open` `--dry`(슬롯 조회만) `--auto-submit` `--submit-preview`
`--watch-only`(디버거 미연결) `--no-open`(알림만) `--agrees` `--name --hp --port`.

## 3. 금기 / 불변 규칙 (어기면 작업을 되돌린다)

1. **reCAPTCHA 를 기계가 건드리지 않는다.** `grecaptcha.execute|reset|render|ready` 호출 금지,
   `g-recaptcha-response` 에 값 대입 금지, 이미지/오디오 챌린지 처리 금지. 토큰은 **읽기만** 한다.
2. **제로월드(두 번째 사이트)의 제출은 자동화하지 않는다.** `AUTO_SUBMIT = flag && site==='keyescape' && !WATCH_ONLY`.
3. 클릭은 검증 후에만 1회: 제출 버튼 정확히 1개 / 예약좌표 5종 일치 / 약관 체크 / 이름·연락처 / 상품명·금액.
   하나라도 빠지면 `[ABORT]` + 사유. 실패 후 재시도(재클릭) 하지 않는다 → 중복 예약·중복 결제 방지.
4. 다른 자동화와 CDP :9222 를 공유한다. Chrome 과 프로세스를 통째로 종료하지 말고, 자기가 연 탭만 닫는다.
5. 개인 값(이름/전화번호)을 코드·문서·테스트 픽스처·로그·이미지·커밋 저자에 넣지 않는다.
   문서 예시는 `홍길동` / `010-0000-0000` / `테스트유저`.
6. `reservation2` 는 POST 페이지이므로 **`Page.reload` 금지**(재전송 경고 화면이 뜬다). 다시 그으려면 `postNav` 를 재실행한다.
7. **단편선의 최종 결제(`결제하기`) 는 기본 클릭하지 않는다.** 이름/연락처/입금자명 채움 + 무통장입금 선택 +
   **약관 전체동의 체크**까지는 자동이고(2026-09-09 사용자 결정으로 기본 on), `결제하기` 는 화면 체크박스(= `--pay-submit`) 로
   켰을 때만 `dpsPay` 게이트(결제화면 URL · 무통장 화면 · 필드 채워짐 · cash 라디오 · 계좌 · 약관 전부 체크 ·
   금액 · 버튼 1개 · 미결제 상태 · 중복 금지)를 **모두** 통과한 뒤에 1회 누른다.
   `예약하기`(주문 생성 `add_order.cm`) 는 단편선에서 기본 자동이 되었다(끄려면 `--no-auto-submit` — 캡차가 없고
   예약좌표 prod_idx/start_day 를 화면에서 검증할 수 있기 때문). 로그아웃 상태에서는 검증 단계에서 거부된다.

## 4. 디버거 차단(`devtools-detector`) 사가 — 반드시 알아야 하는 함정

- 사이트 `reservation*.php` 하단 인라인 스크립트가 `devtools-detector@2.0.22` 를 읽고, 디버거가 감지되면
  `document.body.innerHTML` 을 `개발자 도구 사용이 금지되어 있습니다.` 로 통째로 교체한다. 우클릭/F12 도 막는다.
- CDP 러너는 `Runtime.enable` 만으로도 디버거가 감지되므로, **사이트 스크립트보다 한 발 먼저** 해제를 걸어야 한다.
  → `lib.applyUnlock()` 이 `ext/inject.js`(디텍터 더미 선점 + contextmenu 캡처 + `onkeydown` setter no-op)를
  `Page.addScriptToEvaluateOnNewDocument` 로 **입력기 주입보다 먼저** 등록하고 현재 문서에도 바로 적용한다.
  등록 순서가 곧 실행 순서다. 키이스케이프 탭에서만 동작, 제로월드는 건드리지 않는다.
- 루트의 `unlock.mjs` 는 **별개 도구**(UI 의 `DevTools` 배지/`preflight.sh` 가 사용)이고, 세션 단위라
  프로세스가 끝나면 등록이 사라진다. 그래서 러너는 자기 세션에서 직접 건다(과거 이것 없이 붙였다가 전면 차단됐었다).
- 그래도 차단 화면이 보이면(`STEP2_READ.blocked`): 해제 재적용 → `postNav` 로 reservation2 1회 재요청 →
  실패 시에만 `[BLOCK]` + 소리 알림 + 스크린샷(`ui/runs/`) + `exit 7`.
- 디버거를 아예 붙이지 않는 경로 `--watch-only` 도 있다: 서버 조회만 하다 히트하면 macOS 알림 + 기본 브라우저로
  예약 페이지를 연다(`[HANDOFF]`, 실측 0.1초). 이 경로는 차단과 무관하고 클릭/입력을 대신하지 않는다.
- 실측 로그 모양(정상):
  `[UNLOCK] 디텍터 더미 O / 우클릭 O / F12 미등록(F12 열림)` → `[STEP2] … fill_ms=18.1 name=홍길동 …`

## 5. 개인 값 처리 규칙 (공개 리포라 강제됨)

- 해석 순서 `lib.personal(key, arg)`: 인자 → `process.env.KEYESCAPE_NAME|KEYESCAPE_HP` → `ui/local.env` → 없음.
  (러너 인자가 플래그만 넘어와 `true`가 되는 케이스는 문자열이 아니면 무시하도록 방어)
- UI 는 입력값을 `localStorage['ke.buyer']` 에 저장해 다음 실행 때 채운다. 화면에 하드코딩된 기본값은 없다.
- `ui/local.env`(실값), `*.log`, `*.png`, `ui/runs/`, `step2-snapshot.json`, `.env` 는 `.gitignore`.
  `.dockerignore` 는 `**/` 패턴을 쓴다 — 접두 없이 쓰면 `ui/` 아래 파일이 이미지로 복사된다(실측 버그, 수정됨).
- 이 리포지토리의 커밋 저자는 `edw1n1994 <274138769+edw1n1994@users.noreply.github.com>` (repo 로컬 설정).
- 컨테이너는 개인 값을 담지 않는다: `docker run -e KEYESCAPE_NAME=… -e KEYESCAPE_HP=…` 또는 compose 의 환경변수 전달.

## 6. 검증 (고칠 때 반드시 함께 돌릴 것)

```bash
# 문법
for f in ui/*.mjs ui/tests/*.mjs *.mjs; do node --check "$f"; done; bash -n scripts/docker/docker-selftest.sh
# 제출 로직 단위 테스트 (목업 픽스처, 결제 이동 없음) → 17/17
node ui/tests/submit-test.mjs --port 9222
# 단편선 단위 테스트 (달력 파서 + 로그인 판정 + 결제화면 입력기/약관 전체동의 + 예약하기·결제하기 게이트) → 46/46
node ui/tests/dps-test.mjs --port 9222
# 단편선 라이브 (사람 클릭 경로 — 주문 생성 후 결제화면 채움까지, 결제하기 는 사람이 클릭)
node ui/runner.mjs --site dps --zizum m2021111422e8d3a51ef50 --theme 36 --info 36 \
  --date 2026-09-14 --times "10:20" --deadline 25 --no-open --human-wait 420
curl -s 'localhost:8899/api/login?site=dps'    # 상단 로그인 배지의 근거 (탭이 있으면 탭 실측, 없으면 쿠키 HTTP)
# 클릭 대상 확인만 (아무것도 누르지 않음)
node ui/runner.mjs --site keyescape --zizum 19 --theme 60 --info 38 --tname "머니머니패키지" \
  --date 2026-09-10 --times "09:20" --deadline 15 --auto-submit --submit-preview
# 컨테이너 설치 테스트 A~I → 통과 92 / 실패 0
docker build -t keyescape-ui . && docker rm -f ke-ui; docker run -d --name ke-ui -p 8898:8899 keyescape-ui
sleep 20; docker exec -d ke-ui bash -c 'bash /app/scripts/docker/docker-selftest.sh > /tmp/selftest.log 2>&1'; sleep 110
docker exec ke-ui tail -3 /tmp/selftest.log
```

- `submit-test.mjs` 가 잡아주는 것: 프리뷰는 클릭 안 함 / 토큰 없으면 거부 / 좌표 불일치 거부 / 약관 미체크 거부 /
  이름 미입력 거부 / 통과 시 1회만 클릭 / 재호출 시 중복 클릭 없음 / 차단 화면에서는 시도조차 안 함 /
  **상품명·금액은 결제 폼(`order_info`) 밖에서도 찾는다**.
- 셀프테스트 섹션: A 런타임·정적 / B 네트워크·CDP / C UI API / D DevTools 해제 / E 예약 엔진(dry) /
  F 안전장치 / G 제로월드 / H 자동 제출(opt-in) / I 디버거 차단 해제 배선 + 감시 전용 / **J 단편선(아임웹)**.

## 7. git 상태 (이 문서를 쓴 시점)

- `main` = 로컬 `5a5e09a`, remote `origin/main` 동일. 커밋 4개(초기 + dockerignore/compose 개인정보 관련 3).
- 푸시된 파일 64개. `ui/local.env`·로그·스크린샷·snapshot 이 원격에 **없음**을 GitHub API 로 확인.
- 이 `MEMORY.md` 는 작성 직후에는 **미커밋** 상태였다 (공개 리포에 올릴지 사용자 판단 필요).


## 8. 알려진 함정 (모두 실측으로 확인된 것만 적었다)

1. `good_name`/`good_mny` 는 `#form` 이 아니라 **결제용 별도 폼 `order_info`** 에 있다.
   `form.elements` 로만 찾으면 상품명/금액 검사가 영구 실패해 클릭이 항상 거부된다.
   → `step2Submit` 은 ① 폼 밖 필드 ② 화면 문구(`예약 상품 정보 …`, `이용금액 …원`) ③ `rev_price` 순으로 해석한다.
2. `addScriptToEvaluateOnNewDocument` 등록은 **세션 수명**이다. 주입 스크립트를 실행한 프로세스가 끝나면 사라진다.
3. 예약 화면을 다시 그릴 때 `Page.reload` 대신 `postNav` 재실행(POST 재요청)을 쓴다(위 3장 6번).
4. POST 직후 `Runtime.evaluate` 는 문서 교체와 경합해 실패/빈 값을 낸다 → 스냅샷은 최대 5초 재시도한다.
5. `window.__FILL_AT` 같은 이전 문서 잔존 플래그로 측정이 속는다(실측: 히트 후 `-89ms`). POST 전에 초기화하되
   **`__SUBMITTED` 는 초기화하지 않는다**(중복 클릭 방지 플래그라 문서가 살아 있는 한 유지).
6. 사이트가 `alert()` 를 띄우면 이후 평가가 전부 막힌다 → `Page.javascriptDialogOpening` 을 주기적으로 드레인.
7. 이 실행 환경에서는 매우 긴 `setTimeout` 이 재개되지 않은 사례가 있다 → 대기도 1초 틱 루프로 쪼갠다.
8. `keTab()` 은 URL 에 `keyescape` 문자열이 있으면 키이스케이프 탭으로 본다. 로컬 픽스처(경로에 폴더명 포함)와
   오탐 가능 → 테스트가 연 탭은 반드시 `/json/close/{id}` 로 닫는다.
9. `.dockerignore`/`.gitignore` 에 `*.log` 만 쓰면 루트만 매칭된다. 서브디렉터리는 `**/*.log` 처럼 `**/` 를 붙인다.
10. 감시 전용의 핸드오프는 **OS 기본 브라우저**로 연다(디버그 창이 아니므로 차단과 무관하게 정상 렌더).
11. 셸 도구에서 heredoc 기반 `git commit -F -` 가 걸린 적이 있다 → 커밋 메시지는 파일로 만들어 `-F 파일`.
12. **[단편선] 알림 드로어 템플릿에는 로그인 여부와 무관하게 `a[href="/logout.cm"]`(로그아웃) 이 항상 있다.**
    그래서 로그인 판정은 ① `.member-info.guest`/"로그인이 필요합니다." → 로그아웃 ② `member-info:not(.guest)` → 로그인됨
    ③ 마지막에 `IS_GUEST` 플래그. 로그아웃 링크를 우선으로 두면 로그아웃인데 "로그인됨" 이 된다(실측 버그, 수정됨).
13. **[단편선] `#booking_f` 의 hidden(`start_day` 등) 은 달력 JS 가 조금 뒤에 채운다.** 직전까지 빈 값으로
    `dpsBook` 을 부르면 좌표 불일치로 영원히 클릭이 거부된다 → 러너는 hidden 이 다 채워질 때까지 최대 10초 대기하고,
    게이트는 빈 값을 '불일치'가 아니라 '미채움'으로 구분해 통과시키지 않는다.
14. **[단편선] 아임웹은 필드 name/id 가 설정마다 달라 확정할 수 없다.** 입력기는 라벨 텍스트 → name/id 후보 순으로 찾고
    못 찾으면 `누락`으로 보고한다. `dpsFiller` 는 결제화면이 아닌 문서(URL/`무통장` 문구로 판정) 에서 25초 rAF 루프로
    헛돌지 않고 즉시 빠져나온다.
15. 주석/문자열 안에 `**값**/다음` 처럼 `*/` 가 섞이면 블록 주석이 거기서 끝나 파일이 깨진다(실측).
    브라우저에 넣는 스니펫을 템플릿 리터럴 문자열로 쓰면 `\s` 가 `s` 로 변한다 → 스니펫은 **함수로 만들어 `toString()`** 로 직렬화한다.
16. 셀프테스트가 검사하는 UI 안전 문구(`여전히 사람이 클릭`) 가 편집 중에 사라진 적이 있다 → UI 문구를 고친 뒤엔
    `bash scripts/docker/docker-selftest.sh` 로 F/H 섹션이 여전히 통과하는지 볼 것.
17. **[단편선] 결제화면의 3개 필드는 라벨 텍스트가 완전히 비어 있다.** label/가까운 셀 텍스트 기반으로 찾으면
    전부 `누락` 이 된다(실측: `matched` 비고, 누락 4건). → `orderer_name`/`orderer_call`/`depositor_name` 를
    `CAND` 1순위로 박아두고, 라벨 정규식은 보조 수단으로 남긴다. `deliv_memo`·`pay_type`·`cash_idx` 는 `SKIP`.
18. **[단편선] 결제화면은 URL(`?order_code=`) 이 먼저 뜨고 입력란은 그 뒤에 렌더된다.** `onPayment` 만 보고 발표하면
    `inputs=0` 인 빈 화면을 "누락 4건" 으로 잘못 보고하고 프로세스가 끝나 입력기까지 죽는다(실측). → 필드가 생긴 뒤 +
    주입된 입력기의 `fillAt/fillErr` 이 둘 때까지 기다린다(`--human-wait` 기본 240초, 자동제출 시 60초).
19. `window.__FILL_ERR` 같은 이전 실행 잔존 플래그는 결과를 오염시킨다(실측: 채움은 완료됐는데 err 이 남아 있었음)
    → `dpsFiller` 는 시작 하자마자 `__FILL_ERR/__FILL_AT/__FILL_MS` 를 초기화한다. (KEYESCAPE 3장 5번과 같은 계열의 함정)
20. **[단편선] 로그인 배지의 근거가 되는 회원 블록 텍스트에 실명 + 이메일이 그대로 들어 있다.** 그대로 로그/UI 에 찍으면
    개인정보 유출(실측에서 실제로 발생). → `parseDpsLogin` 이 첫 글자만 남기고 마스킹(`로그인됨 (남**)`).
21. **배경 탭에서는 `requestAnimationFrame` 이 완전히 멈춘다.** 주입 입력기 3종(`filler`/`zwFiller`/`dpsFiller`) 이
    재시도 스케줄로 rAF 를 썼는데, 포커스가 다른 창에 있는 상황에서 결제화면 채움이 1차 시도 후 영원히 안 끝났다
    (실측: `at=미완료`, `ms=0`, 누락 잔존). → `document.hidden` 이면 `setTimeout(…, 120)` 으로 예약한다.
    회귀 테스트: `dps-test.mjs` 의 '배경 탭(rAF 정지)' 항목(동작) + `submit-test.mjs` 의 소스 패턴 검사(나머지 2종).
22. **[단편선] 결제가 끝나면 `/shop_payment/?order_code=…` 가 슬롯 페이지(`/reserve_g?idx=…`) 로 리다이렉트된다.**
    결제 완료/취소 판정 기준으로 쓸 수 없고, 탭을 다시 열어도 입력란이 없어 채움이 공회전한다(`inputs=0`).
23. **[단편선] 약관 체크박스는 name 이 없는 것이 섞여 있다.** `paymentAllCheck`(전체동의)·`agree_*` 는 name 으로 잡히지만
    하나는 `<label><input name=agree_notice></label>` 옆에 텍스트가 달려 있고 아예 name 이 없는 것도 있다 → **주변 텍스트**
    (`li,label,p,td,dt,div` 의 innerText) 로 `동의|약관|수집|이용|환불|취소|고지` 를 함께 본다. 반대 방향으로
    `광고|마케팅|이벤트|뉴스레터` 수신은 **선택**이므로 자동 체크에서 제외한다(테스트로 고정).
24. **채움 완료 판정에 약관 상태를 섞으면 안 된다(실측).** `agreeAll:false` 인데 `agreeOk` 을 완료 조건에 넣으면
    사이트를 채우는 의미가 없는 경우까지 25초 타임아웃 루프에 빠져 테스트/러너가 사실상 멈춘다(합계 3분 초과로 관측됨).
    → 자동 체크가 꺼져 있으면 약관 상태는 **노출만** 하고 완료를 막지 않는다. 결제는 `dpsPay` 게이트가 클릭 시점에 따로 검사.
25. **`ui/public/index.html` 의 인라인 JS 도 셀프테스트가 `node --check` 로 검사한다.** `confirm(...)))` 처럼 괄호 하나를
    더 닫으면 브라우저에서는 화면이 조용히 죽고(로그도 없음) 테스트에서 잡힌다 — UI 를 고치면 반드시 `bash scripts/docker/docker-selftest.sh`.
26. **SSR 마크업이 뜨는 시각과 리액트 하이드레이션 시각이 다르다(실측 +2~4초).** 그 사이에 던진 클릭은 화면만 흔든다 —
    버튼은 눌리고 클래스도 그대로인데 상태에 반영되지 않아 다음 화면으로 넘어가지 않는다(navpeek 예약에서 실측: 머리 날짜는
    오늘에 머물고 `다음` 은 비활성인 채 라운드가 5~16 초씩 낭비). → 클릭은 **클릭 + 반영 확인** 한 세트로 다닌다
    (`clickVerify`): 확인식이 참이 될 때까지 70ms 간격으로 같은 버튼을 다시 누른다. 재클릭은 같은 항목 재선택이라 안전하다.
27. **"잠김"과 "선택됨"은 한 DOM 에 동시에 있다.** 목표 날짜를 URL 로 미리 열어두면 **예약 불가한 날에도** 달력 셀 클래스가
    `calendar_date unselectable selected` 가 된다(navpeek 9/16 실측). `selected` 를 먼저 판정하면 미오픈인데도 열렸다고
    오판해 자정 전에 사격이 터진다 → `unselectable|disabled` 를 반드시 먼저 본다.


## 9. 남은 과제 (먼저 손댈 곳)

- [ ] `--auto-submit` 의 **끝단 실전 검증**이 아직 없다. 목업 16/16 과 실 페이지 프리뷰(`폼검증=통과`)까지만 확인.
      사람이 실제로 reCAPTCHA 를 통과한 회차에서 `[CAPTCHA] → [CHECK] → [SUBMIT] → [RESULT]` 흐름을 한 번 확인해야 한다.
- [ ] 첫 실행 UX: 이름/연락처 기본값이 사라졌으므로 화면이 비어 있다. `ui/local.env` 미설정 사용자에게
      안내 문구가 충분한지 확인할 것(러너는 `[WARN]` 을 찍는다).
- [x] **[단편선] 결제화면(`/shop_payment/`) 필드 확정 완료** (2026-09-09 실제 주문으로 실측):
      `orderer_name` / `orderer_call` / `depositor_name` / `pay_type=card|cash` / `cash_idx` / `deliv_memo` —
      `dpsFiller` 의 `CAND`·`SKIP` 에 고정했고 `tests/fixture-dps-payment.html` 이 그 구조를 복제해 회귀를 막는다.
- [ ] **[단편선] 자동 제출(`--auto-submit`) 끝단 실전 검증**: 이번에는 사람이 `예약하기` 를 클릭하는 경로만 실전 확인했다
      (주문 생성 → 결제화면 채움 → 무통장입금 선택, 결제하기 는 사람이 클릭). 자동 클릭 경로는 목업 30/30 으로만 확인.
- [x] **[단편선] 결제화면 약관 자동 체크 완료** (2026-09-09 사용자 결정): `paymentAllCheck` 전체동의 → 개별 약관 순으로 체크,
      `광고/마케팅/이벤트/뉴스레터` 수신은 제외. 끄는 방법 `--no-agree-all`(화면 체크박스 없음, 기본 on).
- [x] **[단편선] `예약하기` 자동 클릭을 기본값으로 전환** (`--no-auto-submit` 으로 해제). 화면 체크박스 라벨/문구 사이트별 분기.
- [ ] **[단편선] `결제하기` 자동 클릭(`--pay-submit` / 화면 체크박스) 의 실전 검증이 아직 없다.** 목업 46/46 으로만 확인 —
      실제 주문에서 게이트 통과·1회 클릭·클릭 후 화면 이동을 한 번 확인해야 한다. (돈이 나가는 동작이라 사람이 곁에서 볼 것)
- [ ] **[단편선] 입금계좌가 2개 이상인 설정에서는 `결제하기` 게이트가 '입금계좌 미선택' 으로 거부한다.** 강남은 계좌 1개라 통과.
- [ ] **[단편선] 성수(`/reserve_ss`, `dpsnnn-s.imweb.me`, 계정 분리) 는 미등록.** 필요하면 `dps.mjs` 의 상수 묶음을 복제해 등록.
- [ ] `MEMORY.md` 를 공개 리포에 커밋할지 결정 (현재 미커밋, 내용은 비식별화됨).
- [ ] 사이트가 다시 강하게 막으면: `node ui/unlock-status.mjs` → UI 상단 `DevTools` 배지 복구 → 그래도 안 되면 `--watch-only`.
- [ ] 인접 작업(별도 폴더 `navpeek`, 네이버 드림이스케이프): 9/9 17:55 실측으로 **9/9~9/15 바야흐로 전 회차 매진** 확인
      (요청했던 9/10 19:20 포함). 목표를 **9/16(수) 19:20** 으로 옮겨 2026-09-09 18:20 에 `sh run-0916.sh` + `login-guard.sh`
      기동 완료(23:40 실행 → 자정 사격 → 00:15 하드스탑, 최종 클릭 ON = 실결제). `auto-reserve2.mjs` v2.1 로 ① 달력 미렌더
      시 exit 금지(9/8 실패 원인) ② 클릭 후 반영 확인(함정 26) ③ 셀 판정 순서 교정(함정 27) — 클릭 3단 + 신청서 **+0.85~1.63초**.
      근거·요일 시간표는 `navpeek/README.md`. 9/30(수) 22:30 이 1매 열려 있었으나(임시 슬롯) 목표 시각이 아니므로 건드리지 않음.

## 10. 사전 (필드/상수)

- 예약좌표 5종: `zizum_num`(지점) `theme_num`(테마) `theme_info_num`(지점별 테마 정보) `rev_days`(예약일) `theme_time_num`(회차).
  클릭 전 이 5개가 목표와 일치해야 한다(`step2Submit` 의 `want`).
- 지점 목록은 `lib.BRANCHES`(예: `19 = LOG_IN 1`, `18 = 메모리컴퍼니`), 시간대별 오픈 시각은 `reservation.php` 기준
  `OPEN_TIME_FALLBACK` + 서버 스캔으로 계산한 `openInfo()` 를 쓴다.
- 약관: 키이스케이프 기본 `agree_1,agree_2` (화면에 `agree_3` 도 있으나 기본 대상 아님). 제로월드는 약관 자동체크 없음.
- 슬롯: `enable === 'N'` 이면 마감/비활성. `open` 여부로만 발사한다(오탐 시 POST 하지 않고 `[MISS]`).
- ZeroWorld: 지점은 `강남점`/`홍대점` 만 노출(김포 제외), 캡차는 이미지 코드 입력형, 제출 클릭은 자동화하지 않는다.
- `예약하기` 클릭 이후는 KCP 결제 화면(`order_info` 폼 제출)이며 사람 확인 영역으로 둔다.
- 단편선: 슬롯 = 상품 `idx`(이야기 × 시간대 18종, 예 `36 = 행복 / 10:20`), 달력 셀 `data-date="2026-9-15"`(zero-padding 없음),
  뱃지 `가`=예약가능(#8EC31F) / `완`=완료(#fa565a) / `대`=입금대기, 셀 텍스트 `예약불가`=아직 미오픈·`예약 종료`=지난 날.
  오픈은 **매일 자정 D-7**(실측 창 끝 = 오늘+6). 입금자명은 예약자명과 동일해야 한다(공지).
