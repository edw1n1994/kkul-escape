# 키이스케이프 / 제로월드 예약 사격대 (UI)

테마 이름 → 날짜 → 시간대를 화면에서 골라서 **오픈 시각에 자동 사격**하는 로컬 웹 UI.
`../reserve-fast.mjs` 의 초고속 경로를 그대로 엔진으로 쓴다. 화면 상단 탭으로 **키이스케이프 / 제로월드**를 바꾼다.

**가장 단순한 방법 — 프로젝트 루트의 설치 스크립트 한 개면 끝남** (`npm install` 없음):

```bash
# macOS / Linux
cd ..            # keyescape-devtools-unlock/
./setup.sh       # 검사 + 크롬/CDP 기동 + 차단 해제 + 이 UI 서버 기동 + 브라우저 개방
./setup.sh --check   # 검사만    /   ./setup.sh --stop  # 종료
```

```bat
:: Windows
setup.bat        :: 동일 절차. setup.bat -Check / -Stop / -Shortcut / -Port 9000 -CdpPort 9333
```

이미 세팅된 상태에서 UI 만 쓸 때:

```bash
sh ui.sh                     # CDP 확인 → UI 서버 기동 → 브라우저 개방  http://127.0.0.1:8899/
PORT=9000 CDP_PORT=9333 sh ui.sh   # 네이버 작업과 병렬로 쓸 때 격리 포트
sh preflight.sh              # 전제조건 6종만 검사 (--fix 로 자동 복구)
```
Windows 에서는 `run-server.cmd` 를 더블클릭해도 UI 서버가 뜬다(로그: `server.out`).

## 두 개의 사이트 — 키이스케이프 / 제로월드 (화면 상단 탭)

한 화면에서 상단 탭으로 사이트를 고른다. 서버·러너는 `site` 파라미터 하나로 분기하고,
차이는 전부 `sites.mjs`(등록표 + 어댑터) 에 모여 있다. 화면 구조·조작 순서는 동일하다.

| | 키이스케이프 | 제로월드 (`zeroworldkorea.com`) |
|---|---|---|
| 예약 화면 | `reservation1.php` → `reservation2.php` (2단계) | `layout/res/home.php?go=rev.make&s_subj=A&zizum_num=N` (한 장) |
| 데이터 API | `POST /controller/run_proc.php` (JSON, `t=get_theme_info_list/get_theme_date/get_theme_time`) | `POST /core/res/rev.make.sel.php` (HTML 조각, `act=calendar/theme_list/theme_select/theme_time_list/theme_time_select`) |
| 예약 좌표 | `zizum_num` + `theme_num` + `theme_info_num` | `zizum_num` + `theme_num` (info 없음), 시간은 `theme_time_num` |
| 지점 | 14개 (`reservation1.php` 의 `#zizum`) | **강남점(4) · 홍대점(5) 만** (김포본점(1) 은 페이지에 떠도 목록에서 제외) |
| 예약자 폼 | `name`, `mobile1/2/3`, 약관 `agree_1`,`agree_2` | `name`, `mobile`(한 줄, `010-0000-0000` 13자), `person`(셀렉트) |
| 자동등록방지 | reCAPTCHA | 이미지 코드 `input_captcha` |
| 제출 | `reservation2.php` 로 직접 POST (Step1 생략) | `rev.act.php` (결과를 iframe `ifr_ok` 로 받음) — **대신 제출하지 않는다** |
| 예약 창 | 오늘 포함 7일 (D-6, 슬롯 응답으로 측정) | 오늘 포함 15일 (D-14, **달력의 클릭 가능한 날짜**가 기준) |
| 오픈 시각 출처 | `reservation.php` 의 지점별 표 | 서버 응답 문구 `예약 오픈시간은 12:00 입니다` (실측: 홍대 12:00 · 강남 11:30 → `zw-open-times.json` 에 기억) |

제로월드는 **달력의 클릭 가능한 날짜(`act=calendar` 의 `fun_days_select`)가 실제 예약 창**이다. 실측 규칙:

```text
· 3개 지점 모두 오늘 ~ 오늘+14 (하루에 하루씩 앞쪽으로 밀림)
· act=theme_time_list 는 창 밖 날짜에도 기본 시간표를 그냥 뱉는다 → 창 크기를 재는 데 쓰면 안 된다
  (창 끝이 9/22 인 날에 9/24~10/2 가 시간표를 출력했다. 그래서 이 코드는 창 밖 날짜를 '오픈 전'으로 되돌린다)
· 창 안이되 아직 안 열린 날짜만 "예약 오픈시간은 HH:MM 입니다" → 지점별 매일 오픈 시각은 여기서 배운다
· 창 끝 W 를 기준으로  openAt(목표일) = 오늘 + (목표일 - W) at HH:MM   (오픈 전/후 같은 식)
  실측 9/8: 강남(11:30) 은 11:31 에 W=9/22 가 이미 시간 목록, 홍대(12:00) 는 11:31 에 W=9/22 가 아직 문구
```

오픈 시각 문구는 **그 날 오픈이 지나면 더 이상 뜨지 않는다** → 읽는 즉시 `ui/zw-open-times.json` 에 저장해 두고,
그 날 오픈 후의 조회는 기억한 시각을 쓴다(`openTimeSource` 가 `과거에 읽은 문구(기억: HH:MM)` 로 표시된다).
아무것도 모르는 지점은 오픈 전에 한 번 조회하면 그 뒤로 계산이 가능하다.

```bash
# 화면과 같은 API 를 사이트만 바꿔 직접 호출
curl 'http://127.0.0.1:8899/api/env?site=zeroworld'
curl 'http://127.0.0.1:8899/api/themes?site=zeroworld&zizum=5'
curl 'http://127.0.0.1:8899/api/slots?site=zeroworld&zizum=5&theme=36&date=2026-09-23'
curl 'http://127.0.0.1:8899/api/openinfo?site=zeroworld&zizum=5&theme=36&date=2026-09-23'
# 러너도 --site 만 붙이면 끝이다 (제로는 --info 없어도 된다)
node runner.mjs --site zeroworld --zizum 5 --theme 36 --date 2026-09-23 --times "12:35" \
     --open-at 2026-09-09T12:00:00+09:00
```

히트하면 러너는 페이지를 옮기지 않고 같은 화면에서 `rev_days / theme_num / theme_time_num` 을 확정하고
예약하기 버튼을 활성화한 뒤 멈춘다. **이미지 코드 입력과 '예약하기' 클릭은 사용자 동작으로 남긴다** —
자동 제출·코드 판독은 코드에 존재하지 않으며 `../docker-selftest.sh` 의 `[G]` 가 그것을 정적으로 검사한다.

## 화면

| 영역 | 동작 |
|---|---|
| 상단 탭 | **키이스케이프 / 제로월드** 전환 — 지점·테마 목록을 그 사이트에서 다시 읽고 날짜/시간/오픈 계산을 초기화한다 (선택한 목표는 사이트별로 따로 기억) |
| 상단 배지 | CDP 연결 여부 / 서버 기준일(KE `get_theme_date.calendarData.today`, ZW 서버 KST 날짜) / 실행 상태 / 오픈 카운트다운 |
| 1 지점·테마 | KE `get_theme_info_list` + `get_theme_date` · ZW `act=theme_list` + `act=theme_select` → 이름·themeNum·(KE themeInfoNum)·난이도·장르·러닝타임·가능인원 |
| 2 날짜 | 3주(21일)치를 스캔해 **이미 오픈**(예약 창 안 → 클릭 불가, 회색) / **오픈 대기**(창 밖 = KE 보통 7일 이후, ZW 15일 이후, 선택 대상) 로 갈라 표시. 가장 가까운 `오픈 대기` 날짜를 자동 선택 |
| 3 시간대 | KE `get_theme_time` · ZW `act=theme_time_list`. 창 밖 날짜는 창 안의 가장 가까운 날짜 시간표를 미리 띄운다(발사 때 서버 응답의 실제 슬롯 사용). 제로월드의 `disable` 셀은 **마감**으로 표시되어 클릭되지 않는다. **하나만 선택** — 다시 클릭하면 해제 |
| 실행 | **`예약자 이름` / `휴대폰(연락처)` 폼** — 예약 폼에 자동 입력될 값(브라우저에 기억, 실행 시 저장). 버튼 `🎯 예약`·`🧪 슬롯 상태만 조회`·`중단`. 오픈 시각·폴링 60초·인원은 입력란 없이 자동/고정 |
| 오른쪽 | KE `reservation2` 도달 상태(예약좌표 hidden, 이름, 약관, 자동입력 ms, reCAPTCHA) · ZW 예약 폼 상태(선택좌표, 이름/연락처, 인원, 이미지 코드, 예약하기 활성) + SSE 실시간 로그 |

## 예약 흐름 (미래 오픈 대기 전용)

이 UI 는 **아직 예약이 열리지 않은 날짜**를 목표로 한다. 이미 창이 열린 날짜는 선택 대상이 아니다.

1. **지점·테마** 선택
2. **날짜** — 21일치를 `get_theme_date` 로 스캔
   - `total > 0` → 예약 창 안 = **이미 오픈** → 클릭 불가(회색)
   - `total === 0` → 창 밖 = **오픈 대기** → 선택 가능 (보통 오늘+7일 이후)
   - 가장 가까운 오픈 대기 날짜를 자동 선택
3. **시간대** — **하나만** 고른다 (단선택, 다시 클릭하면 해제). 예약 창이 아직 안 열린 날짜라 서버에 슬롯이 없으면
   창 안의 가장 가까운 날짜 시간표를 미리 심어두고, 그 시각이 서버에 뜨는 순간을 노린다
4. **오픈 시각 자동 계산** — `/api/openinfo` 가 "그 날짜가 예약 열리는 순간"을 계산 (아래 openInfo 참조)
5. `🎯 예약` → 오픈까지 대기 → 발사 → 재CAPTCHA·`예약하기` 는 직접

실행 조건 입력(오픈 시각·마감·인원) 은 화면에 없다. **예약자 이름/휴대폰 폼만** 남는다 —
reservation2 에 자동 입력될 값이고 실행할 때마다 브라우저(`localStorage`)에 저장된다.
저장소에 기본값은 없다: 비어 있으면 환경변수 `KEYESCAPE_NAME`/`KEYESCAPE_HP` → `ui/local.env` 순으로 채워진다.

## 실행이 하는 일 / 하지 않는 일

한다:
1. **선택한 날짜의 오픈 시각까지 대기** — 대상은 **아직 예약이 열리지 않은 날짜(보통 7일 이후)** 이고
   시간대는 **하나만** 고른다. 이미 예약이 열린 날짜 / 지난 날짜는 화면에서 선택 자체가 막힌다.
   예약 창이 아직 안 열린 날짜는 창 안의 가까운 날짜 시간표를 미리 심어두고 창이 열리는 순간을 기다린다.
2. 오픈 예정 시각 20초 전부터 `get_theme_time` 을 45ms 간격 폴링 → 고른 그 시각이 `enable!=N` 으로 바뀌는 즉시 확보
   (미리 고른 시간대라도 **실제 슬롯 번호는 이 시점에 서버 응답으로** 쓴다)
3. Step1 화면 생략, `NEXT` 와 동일한 폼으로 `reservation2.php` 에 직접 POST
4. `Page.addScriptToEvaluateOnNewDocument` 로 심어둔 입력기가 문서 파싱과 동시에 `name`/`mobile1~3`/약관 체크
5. reCAPTCHA 토큰 생성과 페이지 이동을 감시해 사용자에게 알림
   — `--auto-submit` 이 켜져 있으면 토큰이 보이는 순간 아래 검증을 통과한 뒤 `예약하기` 를 **1회** 클릭한다

기본으로 하지 않는다 (직접 해야 예약이 확정된다):
- reCAPTCHA "로봇이 아닙니다" 체크 — **어떤 경우에도 대신 클릭하지 않는다.** 토큰을 읽기만 하고
  `grecaptcha.execute()` 나 토큰 대입 같은 코드는 이 저장소에 없다 (설치 테스트가 금지 항목으로 검사)
- `예약하기` 클릭 (= 실제 예약 등록 + KCP 결제 레이어) — `--auto-submit`(또는 UI 체크박스) 을 켰을 때만

`--auto-submit` 은 캡차 토큰이 **이미 존재** 할 때만 동작하며, 클릭 직전 페이지 안에서 다시 검증한다:

| 검사 | 실패하면 |
|---|---|
| reCAPTCHA 토큰 존재 (사람이 통과) | 클릭하지 않고 `[ABORT]` |
| 숨은 예약좌표 = 목표 (`zizum/theme/theme_info/rev_days/theme_time`) | 클릭하지 않음 (다른 회차 결제 방지) |
| 약관 필수 체크 (`agree_1`, `agree_2`) | 클릭하지 않음 |
| 예약자 이름 / 연락처 입력됨 | 클릭하지 않음 |
| 상품명 `good_name` / 결제금액 `good_mny` 존재 | 클릭하지 않음 |
| 제출 버튼(`#form button.submit.pc`) 정확히 1개 | 클릭하지 않음 (모호하면 중단) |
| `window.__SUBMITTED` 비어 있음 | 이미 제출됐으면 재클릭 금지 |

클릭 대상은 `--submit-preview` 로 미리 확인할 수 있다 (아무것도 누르지 않고 버튼/상품명/금액만 보고).

## 예약이 열리는 시각 (openInfo)

`🎯 예약` 은 오픈 시각을 알아야 대기한다. 두 가지를 합쳐 계산한다.

1. **지점별 오픈 시각** — `https://www.keyescape.com/reservation.php` 의 `[ 지점별 예약 오픈 시간 ]` 을
   런타임에 파싱(30분 캐시, 실패 시 `OPEN_TIME_FALLBACK` 내장 표):
   `더오름/우주라이크/LOG_IN 1·2 = 10:00` · `메모리컴퍼니 = 10:30` · `후즈데어 = 11:00` ·
   `STATION = 11:30` · `무비무드(전주 포함) = 13:30` · `강남/부산/전주 = 18:00` · `홍대 = 20:00`
   사이트 응답에 `예약오픈시간 : HH:MM` 이 있으면 그 값을 우선한다.
2. **며칠 전 오픈인지(D-n)** — 정적 페이지에 없다. `reserveWindow()` 가 오늘부터 날짜별로
   `get_theme_time` 을 불러 **슬롯 목록이 뜨는 마지막 날짜**를 찾는다. 지점/테마마다 다르다
   (실측: 메모리컴퍼니 D-6, 홍대점 D-12).
   **주의 — 오픈 시각 전에 스캔하면 창 끝이 하루 덜 보인다.** 지점은 매일 자기 오픈 시각에
   창을 하루 민다. 그래서 메모리컴퍼니(10:30) 의 경우 10:28 스캔의 창 끝은 `오늘+5` 다.
   이 값을 곧바로 D-n 으로 쓰면 사격이 하루 밀린다 (실수 사례: 9/8 10:28 세팅 → 9/14 의 오픈을
   9/9 10:30 으로 계산 — 실제로는 그 날 10:30 에 열렸다). `windowSpan()` 이 **스캔이 그 날의
   오픈 시각 이전이었으면 +1일** 보정한다 → 오픈 전/후 어느 때 스캔해도 창 크기는 6일로 일정하다.

`openAt = (예약 날짜 − D-n) 그 지점 오픈 시각 KST` → 실행 조건 입력란은 없고 이 값이 그대로 쓰인다.
날짜 아래 안내문과 상단 카운트다운(`오픈까지 HH:MM:SS`)에 근거(출처·D-n·남은 시간)가 표시된다.
표에 없는 지점(에버랜드) 은 `ok:false` → 해당 지점은 이 UI 로 자동 대기가 불가(CLI 로 `--open-at` 직접 지정).

```bash
curl 'localhost:8899/api/openinfo?zizum=18&theme=57&info=34&date=2026-09-14'
# → {"ok":true,"branch":"메모리컴퍼니","openTime":"10:30","leadDays":6,
#    "windowEnd":"2026-09-13","openAt":"2026-09-08T10:30:00+09:00", ...}
```

## API (curl 로 직접 제어 가능)

```bash
curl 'localhost:8899/api/env?info=34'                       # CDP/기준일/지점 목록
curl 'localhost:8899/api/themes?zizum=18'                   # 테마 목록
curl 'localhost:8899/api/matrix?zizum=18&theme=57&info=34&days=14'   # 날짜별 가능 개수
curl 'localhost:8899/api/slots?zizum=18&theme=57&date=2026-09-12'    # 시간대 + enable
curl 'localhost:8899/api/openinfo?zizum=18&theme=57&info=34&date=2026-09-12'  # 그 날짜가 열리는 시각
curl -X POST localhost:8899/api/run -d '{"zizum":18,"theme":57,"info":34,
  "date":"2026-09-12","times":"19:50,21:25","tname":"FILM BY EDDY",
  "openAt":"2026-09-06T10:30:00+09:00","deadline":60}'    # 실행 (openAt 없으면 즉시)
curl localhost:8899/api/log                                 # 최근 로그
curl -X POST localhost:8899/api/stop                        # 중단
curl localhost:8899/api/step2                               # reservation2 읽기 전용 확인
```

CLI 로 돌릴 때:

```bash
node runner.mjs --zizum 18 --theme 57 --info 34 --date 2026-09-12 \
     --times "19:50,21:25" --tname "FILM BY EDDY" \
     --open-at 2026-09-06T10:30:00+09:00 --deadline 60
node runner.mjs --zizum 18 --theme 57 --info 34 --date 2026-09-12 --dry   # 슬롯만 조회

# 👀 감시 전용 — 디버거를 붙이지 않는다. 사이트의 devtools-detector 차단과 무관하게 항상 동작한다.
#    열리는 순간 소리 알림 + 기본 브라우저에 예약 페이지를 열고 끝낸다 (선택/캡차/결제는 사람).
node runner.mjs --zizum 18 --theme 57 --info 34 --date 2026-09-12 --times "19:50" --watch-only
node runner.mjs … --watch-only --no-open          # 창은 열지 않고 알림만

# 디버거가 허용되는 환경에서 쓰는 제출 보조 (캡차 자체는 항상 사람이 클릭)
node runner.mjs … --auto-submit                   # 캡차 토큰이 생긴 뒤 '예약하기' 1회 클릭
node runner.mjs … --submit-preview                # 클릭 대상만 보고하고 아무것도 누르지 않음
```

## 로그 태그

| 태그 | 의미 |
|---|---|
| `[READY]` | CDP 탭 연결 + 입력기 주입 완료 |
| `[WAIT]` / `[POLL]` | 오픈 대기 / 폴링 진행(`:O` 가능 `:N` 마감 `:x` 미노출) |
| `[HIT]` | 슬롯 확보 + `themeTimeNum` |
| `[POST]` / `[STEP2]` | reservation2 제출 / 도달 + 입력 결과(ms) |
| `[MISS]` | 데드라인까지 슬롯 미확보 → **어떤 시간대가 열려 있었는지** 출력 |
| `[TODO]` / `[OK]` | 사용자 클릭 안내 / 캡차 완료 감지 |
| `[ARM]` | `--auto-submit` 대기 중 (캡차는 사람이 클릭해야 함) |
| `[CAPTCHA]` | 토큰 감지 (글자 수 + 히트 이후 경과 ms) |
| `[CHECK]` / `[SUBMIT]` | 클릭 전 검증 결과 / 클릭 결과 (버튼·금액·사유) |
| `[RESULT]` / `[SHOT]` | 제출 후 화면 문구 / 제출 직후 스크린샷 (`ui/runs/`) |
| `[ABORT]` | 검증 실패로 클릭하지 않음 — 브라우저에서 직접 클릭 (재시도 없음) |
| `[UNLOCK]` | 디버거 차단 무력화(`ext/inject.js`) 를 걸고 확인한 결과 (디텍터 더미 / 우클릭 / F12) |
| `[BLOCK]` | 해제 재적용 + 1회 재요청 후에도 차단 화면일 때만 → 중단(`exit 7`) + 알림 + 스크린샷 |
| `[WATCH]` | 감시 전용(`--watch-only`)으로 히트 — 이후 선택/캡차/결제는 사람 |
| `[HANDOFF]` | 클릭 순서(지점→테마→날짜→시간대) 안내 + 소리 알림 + 기본 브라우저에 예약 페이지 열기 (클릭/입력은 대신 하지 않음) |

## 실측 (이 폴더에서 검증한 것)

- 폴링 6초에 54회(≈90ms/회) 호출, 서버 제한 없음 — 네이버 GraphQL 처럼 rate limit 걱정 없음
- 전 슬롯 `enable=N` 상태에서 데드라인 초과 → `[MISS]` 로 조용히 종료, POST 없음 (오탐 안전)
- CDP 가 없으면 `[FAIL] CDP(:포트) 응답 없음` 으로 종료 (탭 생성 시도 없음)
- `/api/step2` 는 읽기 전용이라 keyescape 탭을 만들지 않는다
- reservation2 제출 버튼 실측: `<form id="form">` 안의 `<button type="submit" class="submit pc">예약하기</button>`
  하나뿐이고, 결제는 별개 폼 `<form id="order_info" action="…/lib/kcp_pc/pc/pp_cli_hub.php">` 로 넘어간다
- `step2Submit` 단위 테스트 16/16 통과 — `node ui/tests/submit-test.mjs` (목업 픽스처, 결제 이동 없음)
  · 토큰 없으면 거부 / 좌표·약관·이름 불일치 시 거부 / 통과 시 1회만 클릭 / 재호출 시 중복 클릭 없음
  · 상품명·금액은 결제 폼(`order_info`) 밖에서도 찾는다 — 실제 페이지 구조를 픽스처에 그대로 복제
- **2026-09-07 18시경** 이 CDP 브라우저 세션에서 keyescape 페이지가 `개발자 도구 사용이 금지되어 있습니다.` 를
  반환한 적이 있다. 원인: 사이트가 `devtools-detector@2.0.22` 를 읽고 감지 시
  `document.body.innerHTML` 을 저 문구로 통째로 교체 → 디버거가 붙은 탭에 폼이 사라진다.
  - 원인은 러너가 **해제 없이** CDP 만 붙이고 있었기 때문이다 (`../unlock.mjs` 는 기존 탭에만 주입하고 끝나고,
    러너가 새로 연 탭은 무방비였다). → `lib.applyUnlock()` 이 `ext/inject.js` 를 읽어 **입력기 주입보다 먼저**
    `Page.addScriptToEvaluateOnNewDocument` 에 등록한다. 실측: `[UNLOCK] 디텍터 더미 O / 우클릭 O / F12 미등록`
    이후 `[STEP2] … fill_ms=18.1 name=홍길동 …` 로 폼이 그대로 살아 있다.
  - 그래도 차단 화면이면(`STEP2_READ.blocked`) 해제를 다시 걸어 reservation2 를 1회 다시 열고, 안 풀릴 때만
    `[BLOCK]` + 소리 알림 + 스크린샷 후 `exit 7`.
  - 디버거를 아예 붙이지 않는 길도 남아 있다: **`--watch-only`(`👀 감시만`)** — 차단과 무관하게 실측 0.1초 만에
    히트/핸드오프(알림 + 창) 까지 동작한다.

## 전제조건 검사 + DevTools 차단 해제

```bash
sh preflight.sh          # 검사만 (아무것도 건드리지 않음 / 미충족 시 exit 1)
sh preflight.sh --fix    부족한 것을 자동으로 켜고 차단 해제까지 실행
CDP_PORT=9333 sh preflight.sh --fix   # 다른 크롬 인스턴스에 대해
```

검사 항목과 자동 조치:

| 항목 | 검사 | `--fix` 동작 |
|---|---|---|
| Node | 22 이상 (전역 `WebSocket`) | — (직접 설치) |
| Chrome | `/Applications/Google Chrome.app` | — |
| CDP 포트 | `:9222` 응답 | `../unlock.sh` 가 격리 크롬 기동 |
| keyescape | `reservation1.php` HTTP 200 | — |
| UI 서버 | `:8899` 응답 | `node server.mjs` 백그라운드 기동 |
| **DevTools 차단 3종** | 탭별 `devtoolsDetector` 더미 / `contextmenu` 미preventDefault / `onkeydown` 미등록 (+검은 화면 여부) | `../unlock.mjs` 로 **재주입** (멱등) |

차단 상태 판독은 `node unlock-status.mjs [port]` 가 단독으로 해도 됩니다 (읽기 전용, 주입 없음).
출력 예:

```json
{ "ok": false, "cdp": "OK", "count": 1, "allUnlocked": false,
  "tabs": [{ "url": "...reservation1.php...", "unlocked": false,
             "dummy": false, "ctxOpen": false, "keyBlock": "차단기 등록됨", "wiped": false }] }
```

서버에도 같은 기능이 붙어 있습니다 — 화면 상단 배지를 클릭하면 즉시 복구됩니다.

```bash
curl localhost:8899/api/unlock                  # 현재 차단 상태
curl -X POST localhost:8899/api/unlock           # 재주입(복구) 후 재검사
curl -X POST 'localhost:8899/api/unlock?cdp=9333'  # 다른 인스턴스 대상
```

> **참고**: 예약 실행(사격) 은 이 배지와 무관하게 동작한다 — `ui/runner.mjs` 가 CDP 에 붙을 때
> `lib.applyUnlock()` 으로 `ext/inject.js` 를 **직접** 등록하기 때문이다. 위 배지/`unlock.mjs` 는
> **사람이 F12 · 우클릭-검사로 현장 조사**를 할 때 필요하다. 단 DevTools 를 직접 열기 전에
> 해제를 먼저 해야 한다 — 디텍터가 먼저 감지하면 body 가 검은 화면으로 바뀌어 그 문서는 복구가 안 된다.

## 창 밖 날짜의 시간표 — 미리 심어두고 열린 순간 노리기 (previewDate)

**미래 날짜**(matrix 에서 `total === 0` → 오픈 대기) 를 고르면 서버는 아직 그 날짜의 슬롯을 주지 않는다.
그 상태에서 기다릴 시간대를 보여주려고 UI 가 두 가지를 동시에 계산한다.

1. **이 날짜가 예약 열리는 시각** = `예약 날짜 − 창 크기(D-n)` 의 지점 오픈 시각 — `/api/openinfo` 가 계산한다.
   창 크기는 21일 스캔에서 `total > 0` 인 마지막 날짜로 재되, 스캔이 그 날 오픈 시각 이전이면 +1일 보정(`windowSpan`).
   (실측 today=9/7: 창 끝 9/13 = 오늘+6 · 메모리컴퍼니 10:30 → 9/14 는 9/8 10:30, 9/16 은 9/10 10:30 오픈.
    실측 today=9/8 10:31: 창 끝 9/14 → 창은 매일 10:30 에 하루씩 밀린다)
2. **기다릴 시간대 목록** = 창 안의 **가장 가까운 날짜**(보통 창 끝날) 의 시간표를 따로 불러와 심는다.
   그 출처 날짜를 `previewDate` 로 기억해 두고, 저 시각들이 서버에 뜨는 순간이 곧 이 날짜의 오픈이다.

발사 시점에는 미리 심은 슬롯 번호를 **그대로 쓰지 않는다** — `pickReady()` 가 서버 응답에서
선택한 시각과 `enable != 'N'` 을 다시 확인하고, 그 응답에 담긴 실제 슬롯 번호(PK 는 날짜마다 다름) 를 쓴다.

서버 API 는 창 밖 날짜를 꾸미지 않고 있는 그대로 돌려준다 — 미리보기는 UI 쪽 동작이다.

```bash
curl 'localhost:8899/api/slots?zizum=18&theme=57&date=2026-09-16'
# → {"ok":false,"msg":"예약 가능 한 날짜가 아닙니다.","slots":[],"date":"2026-09-16"}   아직 창 밖
curl 'localhost:8899/api/slots?zizum=18&theme=57&date=2026-09-13'
# → {"ok":true,"slots":[{"num":"252719","time":"10:30","enable":"N","open":false, ...}, ...]}   창 끝 = 미리보기 출처
```

## 주의

- 이 사이트는 지점별로 오픈 시각이 다르고(실측: LOG_IN 10:00 / 메모리컴퍼니 10:30),
  오픈 전에는 서버가 `예약가능시간이 아닙니다. 예약오픈시간 : HH:MM` 로 거절한다.
  `오픈 대기 시각`을 그 값보다 **이르게** 잡아도 된다 — 서버가 거절하는 동안 계속 폴링한다.
- `enable=N` 은 "지금 선택 불가"이지 "이 시간대가 존재하지 않음"이 아니다. 슬롯 번호(`num`)는
  날짜마다 다른 PK 이므로 반드시 조회해서 얻은 값을 쓴다(서버가 제출 시 재검증).
- 실행은 동시 1개다(같은 탭을 사용). 병렬로 두 개 돌리려면 `CDP_PORT` 를 다르게 한 크롬을 분리한다.
- reCAPTCHA 토큰 유효 기간은 약 2분. 캡차 체크 후 빨리 '예약하기'까지 눌러야 한다.
  `--auto-submit`(UI 의 "캡차 통과 후 '예약하기' 자동 클릭") 을 켜두면 이 레이스에서 손을 뗀다 —
  토큰이 보이는 즉시(폴링 200ms) 검증하고 클릭한다. **캡차 체크 자체는 끝까지 사람이 누른다.**
