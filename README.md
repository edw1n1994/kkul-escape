# keyescape.com 개발자도구 차단 해제

`https://www.keyescape.com/reservation*.php` 하단 인라인 스크립트가
① `devtools-detector` 로 DevTools 감지 → `document.body.innerHTML` 을 검은 화면으로 교체
② `contextmenu`preventDefault` 로 우클릭 차단
③ `document.onkeydown` 으로 F12 / Cmd+Shift+I,J,C / Cmd+U 차단
을 수행한다. 이 폴더의 도구로 3가지를 모두 무력화한다.

> 같은 화면에서 **제로월드(`zeroworldkorea.com`)** 도 같은 방식으로 예약한다 (상단 사이트 탭, `--site zeroworld`).
> ZeroWorld 는 예약 페이지에 DevTools 감지/우클릭 차단 스크립트가 없어(실측: `devtools`/`contextmenu` 없음) 이 폴더의 해제 도구 없이 `ui/` 어댑터만으로 동작한다 → [`ui/README.md`](ui/README.md) 의 「두 개의 사이트」 절.

## 🚀 한 방 설치/기동 (여기부터 시작)

npm 설치 없음. 필요한 것은 **Node 22 +** 와 **Chrome** 뿐이다. 검사 → 부족한 것 자동 구성 →
DevTools 차단 해제 → UI 서버 기동 → 브라우저 개방까지 스크립트 하나로 끝난다.

```bash
# macOS / Linux
cd keyescape-devtools-unlock
./setup.sh                 # 전제조건 검사 + 크롬/CDP/UI 기동 + 차단 해제 + 화면 열기
./setup.sh --check         # 검사만 (아무것도 켜지 않음)
./setup.sh --stop          # UI 서버/사격만 종료 (--stop --chrome 으로 크롬까지)
./setup.sh --with-node     # Node 없고 brew 있으면 brew install node 까지 시도
PORT=9000 CDP_PORT=9333 ./setup.sh    # 다른 작업과 병렬로 쓸 때 격리 포트
```

```bat
:: Windows  (setup.bat 더블클릭, 또는 PowerShell 에서)
setup.bat
powershell -NoProfile -ExecutionPolicy Bypass -File setup.ps1 -Check
setup.ps1 -Stop            :: -Stop -Chrome 으로 격리 크롬까지 종료
setup.ps1 -Shortcut        :: 바탕화면 바로가기 만들기
setup.ps1 -Port 9000 -CdpPort 9333
```

두 스크립트 모두 **멱등**이다(이미 실행 중인 것은 건드리지 않음). 그리고 안전장치:
`--stop --chrome`(또는 `-Stop -Chrome`)은 **booking.naver 탭이 열려 있으면 크롬 종료를 거부**한다 —
같은 크롬을 쓰는 다른 예약 작업을 보호하기 위한 것이다(실측 확인됨).

## 🔑 캡차와 '예약하기' — 누가 무엇을 누르나

| 동작 | 주체 | 비고 |
|---|---|---|
| 슬롯 확보 → reservation2 이동 → 이름/연락처/약관 자동 입력 | 자동 | 기존 그대로 |
| reCAPTCHA "로봇이 아닙니다" 체크 | **사람만** | 대신 클릭하지 않는다. 토큰 생성/대입 코드도 없다 |
| `예약하기` 클릭 (= 예약 등록 + KCP 결제 진입) | 선택 자동 | `--auto-submit` 또는 UI 체크박스. **캡차 토큰이 생긴 뒤** 검증하고 1회만 클릭 |

```bash
cd ui
node runner.mjs --zizum 18 --theme 57 --info 34 --date 2026-09-14 --times "19:50" \
  --open-at 2026-09-07T10:30:00+09:00 --auto-submit      # 캡차 통과 직후 자동 제출
node runner.mjs … --submit-preview                        # 클릭 대상(버튼/상품명/금액)만 보고하고 끝남
node tests/submit-test.mjs                                # 제출 로직 단위 테스트 (목업, 16항목)
```

`--auto-submit` 은 토큰이 없으면, 예약좌표가 목표와 다르면, 약관/이름/금액이 빠지면,
제출 버튼이 1개가 아니면 **클릭하지 않고 `[ABORT]`** 한다. 중복 클릭도 하지 않는다(`window.__SUBMITTED`).
제로월드(두 번째 사이트)는 이 기능 대상이 아니다 — 제출을 자동화하지 않는다.

## 🔓 디버거 차단 해제 — 러너가 알아서 건다 (`👀 감시만` 은 예비 수단)

키이스케이프는 2026-09 실측으로 `devtools-detector@2.0.22` 를 쓴다. 디버거가 붙은 탭을 감지하면
`document.body.innerHTML` 을 통째로 `개발자 도구 사용이 금지되어 있습니다.` 로 교체해 버린다.
그래서 CDP 로 붙는 러너는 **사이트 스크립트보다 한 발 먼저** 해제를 걸어야 한다 — 이 저장소의 기존
수재(`ext/inject.js`: 디텍터를 더미로 선점 + 우클릭/F12 차단 무력화) 를 `Page.addScriptToEvaluateOnNewDocument`
로 **입력기 주입보다 먼저** 등록한다 (등록 순서가 곧 실행 순서). 키이스케이프 탭에서만 동작하고,
차단이 없는 제로월드는 건드리지 않는다.

```bash
# ui/runner.mjs 가 키이스케이프 탭을 잡으면 자동 (2026-09-09 실측 로그)
[UNLOCK] 디텍터 더미 O / 우클릭 O / F12 미등록(F12 열림)
[STEP2] url=https://www.keyescape.com/reservation2.php fill_ms=18.1 fill_after_hit_ms=116 name=홍길동 … 캡차=미완료
[PREVIEW] 클릭대상=BUTTON.submit pc "예약하기" 상품=머니머니패키지(09:20) 금액=60000 캡차토큰=0 문제=없음
```

차단 화면이 여전히 뜨는 경우(해제 등록 **전에** 떠 있던 탭 등)를 대비해 `STEP2_READ.blocked` 가 알아채면
**해제를 다시 걸어 reservation2 를 한 번 더 열고**, 그래도 안 열릴 때만 `[BLOCK]` + 소리 알림 +
스크린샷 후 `exit 7` 로 멈춘다 — 6분을 헛되이 기다리지 않는다.

| 수단 | 언제 쓰나 |
|---|---|
| 기본 (CDP) | 해제로 폼이 살아 있으면: 슬롯 확보 → 예약좌표/이름/연락처/약관 자동 입력 → (사람이 캡차) → `--auto-submit` 시 `예약하기` 1회 |
| `--watch-only` (UI 의 `👀 감시만`) | 디버거를 **붙이지 않으므로** 차단과 무관. 서버 슬롯 조회만 하다 열리는 순간 소리 알림 + 예약 페이지를 연다(실측 0.1초) — 이후 선택/캡차/제출은 사람 |

```bash
node ui/runner.mjs --zizum 18 --theme 57 --info 34 --date 2026-09-14 --times "19:50" \
  --open-at 2026-09-07T10:30:00+09:00 --watch-only          # 👀 감시만 (디버거 없이 알림만)
```
감시 전용은 슬롯 조회 간격을 300ms 로 눌러 서버에 부담을 줄이고, 회차번호까지 로그에 남긴다 —
알림을 받는 사람은 브라우저에서 그 시간대만 고르면 된다.

> **전제**: 이 해제는 **본인 계정·본인 브라우저**에서 예약을 돕는 용도다. 사이트가 금지한 통제를
> 푸는 일인 만큼 계정 제재 등 불이익은 사용자에게 있을 수 있다. reCAPTCHA 는 어떤 경우에도
> 사람이 통과해야 한다(코드에 토큰 생성/대입 경로가 없고, 설치 테스트가 그것을 검사한다).

## 🔒 개인 정보 (예약자명 / 연락처)

이름과 연락처는 **저장소에 없다.** 해석 순서는 아래 둘 같다.

1. `ui/runner.mjs` — `--name` / `--hp` → 환경변수 `KEYESCAPE_NAME` / `KEYESCAPE_HP` → `ui/local.env`
2. UI 화면 — 입력값을 브라우저 `localStorage(ke.buyer)` 에 저장해서 다음 실행 때 자동으로 채운다

```bash
cp ui/local.env.example ui/local.env     # 로컬에만 남는 파일 (.gitignore 됨)
# ui/local.env  →  KEYESCAPE_NAME=홍길동 / KEYESCAPE_HP=010-0000-0000
```

예약 화면에 자동 입력될 값이고 실행할 때마다 브라우저에 저장된다.

## 🐳 Docker (리눅스·서버·격리 환경)

`node:22-bookworm-slim` + Chromium 을 담은 이미지로, 컨테이너 안에서 헤드리스 Chromium(CDP :9222)
을 띄우고 UI 서버를 :8899 에 올린다. 이 환경에서 설치 테스트 92종(A~I)을 실제 실행해 전부 통과했다.

```bash
cd keyescape-devtools-unlock
docker build -t keyescape-ui .                        # 빌드 게이트: 전 *.mjs node --check + chromium --version
docker run --rm keyescape-ui --check                  # 전제조건 검사만
docker run --rm keyescape-ui selftest                 # 설치 테스트(A~I 92종, 읽기 전용 조회만)
docker run -d --name ke-ui -p 8898:8899 keyescape-ui  # 헤드리스 크롬 + UI 서빙
curl -s http://127.0.0.1:8898/api/env | head -c 200   # 호스트에서 접속 확인 (포트는 예시)
docker rm -f ke-ui                                    # 정리
```

`docker-compose.yml` 도 함께 제공한다(이 머신에 compose 플러그인이 없어 YAML 검증만 했다).

| 파일 | 역할 |
|---|---|
| `Dockerfile` | Node 22 + chromium + fonts-noto-cjk. 빌드 중 `node --check` 게이트, HEALTHCHECK 내장 |
| `docker-entrypoint.sh` | `serve`(기본) / `--check` / `selftest` / `sh`. UI 서버가 죽으면 컨테이너도 종료 |
| `docker-selftest.sh` | 설치 테스트 묶음. A 런타임·정적 / B 네트워크·CDP / C UI API / D DevTools 해제 / E 사격 엔진(dry) / F 안전장치 / G 제로월드 / H 자동 제출(opt-in) / I 차단 감지·감시 전용 |
| `docker-opentab.mjs` | 테스트용 탭 준비. `Target.createTarget` + `Page.navigate` (런너와 동일한 경로) |

**컨테이너로 돌릴 때 알아둘 점(모두 실측)**

- UI 서버는 컨테이너 안에서 `BIND=0.0.0.0` 이어야 포트맵이 된다. (`server.mjs` 기본값은 여전히 `127.0.0.1` — 노트북에선 로컬 전용)
- 헤드리스 Chromium 은 `/json/new?url=` 의 url 인자를 **무시**하고 `about:blank` 를 연다 → 탭은 `Target.createTarget` + `Page.navigate` 로 열어야 한다(런너는 원래 이렇게 동작).
- 헤드리스에서는 사이트 디텍터가 실제로 body 를 검은 화면으로 교체한다. `unlock.mjs --reload` 가 **로드 완료까지 기다린 뒤** 주입하도록 되어 있어 해소된다(재주입+검증까지 1회 더 시도).
- CDP 로 심은 `addScriptToEvaluateOnNewDocument` 는 **세션이 살아 있는 동안만** 유효하다. 확장(`ext/`)을 설치하지 않는 헤드리스에서는 새로고침 후 재주입이 필요할 수 있다 → UI 의 DevTools 배지(`POST /api/unlock`) 또는 `sh preflight.sh --fix` 재실행.
- reCAPTCHA·결제는 사람 동작이 필요하다 → 컨테이너는 슬롯 확보 + Step2 준비까지. 최종 확정은 데스크톱 브라우저에서.


## 구성

| 파일 | 역할 |
|---|---|
| **`setup.sh`** | **mac/Linux 원샷 설치·기동.** Node/Chrome/CDP/사이트/UI 검사 → 격리 크롬·UI 서버 기동 → `ui/preflight.sh --fix` → 브라우저 개방. `--check` / `--stop` / `--with-node` |
| **`setup.ps1` + `setup.bat`** | **Windows 동일 버전.** 같은 7단계 + `-Shortcut`(바탕화면 바로가기). 크롬/Edge 경로 자동 탐지, `%TEMP%\keyescape-chrome-profile` 격리 |
| **`ui/`** | **예약 사격대 UI.** 지점·테마·날짜·시간대 선택 → 오픈 시각 사격. `ui/server.mjs`(HTTP+SSE) + `ui/runner.mjs`(엔진) + `ui/lib.mjs` + `public/index.html` + `ui.sh`(mac 기동) + `preflight.sh`(전제조건) + `unlock-status.mjs`(차단 감지) + `run-server.cmd`(Windows 기동 래퍼) |
| **`unlock.sh`** | **한 방 진입점.** CDP 없으면 격리 Chrome 을 `open -na` 로 분리 기동 → `ext/` 설치 시도 → keyescape 탭 전부에 주입 → 3종 해제 검증 출력. 재실행 안전(멱등) |
| `unlock.mjs` | 위 스크립트의 실제 로직 (CDP 클라이언트 + 주입 + 검증). `--reload` 로 새로고침 후 유지 여부 검증 |
| `ext/manifest.json` + `ext/inject.js` | MV3 확장. `world: MAIN` + `run_at: document_start` 로 사이트 스크립트보다 먼저 무력화 (**영구/수동 설치 시 유지**) |
| `rescue.js` | CDP 없이 콘솔/북마크릿으로 쓸 응급 스니펫 (우클릭·F12 즉시 해제, 디텍터 선점) |
| `start.sh [port] [url]` | 격리 프로필 + 원격디버깅으로 Chrome 실행 후 `load-ext.mjs` 호출 |
| `load-ext.mjs` | CDP `Extensions.loadUnpacked` 로 `ext/` 설치 후 탭 새로고침 |
| `cdp-unlock.mjs [url]` | (확장 없이) CDP 세션에서 요청 차단 + 스크립트 주입 후 이동/검증 |
| `verify.mjs` | 정밀 검증 + `after.png` 저장 |
| `smoke-test.mjs` | 날짜 클릭 → 시간대 로딩 등 예약 UI 정상 동작 확인 (조회만, 제출 안 함) |

## 실행

```bash
cd keyescape-devtools-unlock

./unlock.sh                # (권장) 크롬 기동 여부와 무관하게 한 방에 해제 + 검증
./unlock.sh --reload       # 새로고침(사이트 스크립트 재실행) 후에도 해제 유지 확인
./unlock.sh https://www.keyescape.com/   # 열 탭이 없을 때 열 URL 지정
CDP_PORT=9333 ./unlock.sh  # 포트 지정 (다른 크롬과 병렬)
```

정상 출력 예시:

```
· 격리 크롬 기동 중 (프로필: /tmp/keyescape-chrome-profile)
확장(ext/)              : 설치됨 (모든 탭·프레임에 자동 주입)
탭 [1]          : 해제됨
   URL             : https://www.keyescape.com/reservation1.php?zizum_num=18&theme_num=57&the
   디텍터 더미     : O (감지 무력화)
   우클릭          : O (검사 가능)
   F12/단축키      : 미등록(F12 열림)
```

> **실측 주의**: 이 셸의 자식으로 직접 `Google Chrome` 을 띄우면 셸 종료와 함께 크롬이
> `Trace/BPT trap: 5` 로 죽는 것을 확인했다. 그래서 `unlock.sh` 는 `open -na "Google Chrome" --args ...`
> (LaunchServices 분리 실행) 를 사용한다. 셸이 끝나도 창과 CDP 포트가 살아남을 검증했다.
> DevTools 는 알아서 여는 게 목적이라 `--auto-open-devtools-for-tabs` 는 제거했다(F12 로 열림).
> 크롬이 같은 프로필을 두고 다투면 CDP 가 안 뜬다:
> `pkill -f -- '--user-data-dir=/tmp/keyescape-chrome-profile'` 후 재실행.

### CDP 없이 쓸 때 (콘솔 / 북마크릿)

`./unlock.sh` 를 못 쓰는 환경에서는 `rescue.js` 를 콘솔에 붙여넣는다(메뉴 ⋮ → 더 많은 도구 → 개발자 도구).
북마크릿 한 줄 형태도 파일 상단 주석에 있다.

```bash
node try-rescue.mjs            # keyescape 탭에서 rescue.js 평가 (부드러운 재실행 확인)
node try-rescue.mjs --sandbox  # 주입 없는 탭에 사이트 차단을 흉내내고 실제로 풀리는지 검증
```

`--sandbox` 실측 (차단 설치 → rescue 실행):

```
사이트 차단 설치: 우클릭prevent=true  onkeydown=function  디텍터isOpened=true
rescue 후      : 우클릭prevent=false onkeydown=object    디텍터isOpened=false  launch=noop
```

즉 이미 차단이 걸린 페이지에서도 **우클릭·F12 는 바로 풀린다.** 다만 디텍터가 이미
`document.body.innerHTML` 을 검은 화면으로 바꿔놓은 뒤라면 복구가 불가능하니(새로고침 후 즉시 실행)
"사이트 스크립트 실행 전" 차단이 필요한 상황은 `./unlock.sh` 또는 확장을 써야 한다.

### CDP 기반으로만 쓸 때의 한계 (실측)

`cdp-unlock.mjs` 의 `addScriptToEvaluateOnNewDocument` / `Network.setBlockedURLs`,
그리고 `load-ext.mjs` 의 `Extensions.loadUnpacked` 는 **모두 CDP 세션 전용**이다.
클라이언트가 끊기거나 크롬을 재시작하면 사라진다(프로필 `extensions.settings` 에 0건으로 기록됨).
실제로 세션 종료 후 새로고침하면 `transferSize=4670` 으로 라이브러리가 재로드되며 차단이 부활했고,
`--load-extension` 플래그는 Chrome 152 에서 아예 무시됐다(확장 0건).
→ 그래서 `start.sh` 가 기동마다 확장을 자동으로 재설치하도록 처리했다.

## 평소 쓰는 Chrome에 영구 적용

> Windows 에서 돌릴 계획이면 **`WINDOWS.md` 를 먼저 보라** (Node 22 이상 필수, mac 전용 셸 래퍼 대체 절차).

CDP/스크립트 없이 이 확장 폴더를 그대로 설치한다.

1. `chrome://extensions` 이동
2. 우측 상단 **개발자 모드** 켬
3. **로드되지 않은 확장 프로그램** → 이 폴더의 `ext/` 선택
4. keyescape 페이지 새로고침 → 우클릭 / F12 / Cmd+Opt+I 전부 동작

## 검증 결과 (실측)

```
detectorKeys        : addListener,removeListener,launch,stop,setLogger,isDevToolsOpened,isDevToolsCmdKeyHotkey
launchSrc           : function () {}          ← 사이트 라이브러리가 아닌 우리 더미
onkeydownType       : object (null)           ← 키 차단기 등록 실패
rightClickPrevented : false                   ← 우클릭 복구
wiped               : false                   ← 검은 화면 미발동 (DevTools UI 타겟 1개 열린 상태)
dateCells           : 30                      ← 예약 캘린더 정상
smoke-test          : 날짜 '8' 클릭 → 시간대 13개 로딩
```

## 동작 원리 (`ext/inject.js`)

1. `window.devtoolsDetector` 를 **선점**해서 `configurable:false` 더미로 채운다
   → 사이트의 `addListener()/launch()` 가 더미를 바라보므로 감지 자체가 공회전.
2. `document` **캡처 단계**에서 `contextmenu` 에 `stopImmediatePropagation()`
   → 사이트의 버블 단계 핸들러가 실행되지 못해 우클릭 살아남.
3. `document.onkeydown` setter 를 no-op 으로 교체
   → 키 차단 함수가 아예 등록되지 않음. (`addEventListener` 기반 정상 핸들러는 건드리지 않음)

## Step1 자동 입력 (지점/테마/날짜/시간 주입)

### 필드 이름 (혼동하기 쉬움)

| | reservation1.php (Step1, POST → reservation2.php) | reservation2.php (Step2, 결제) |
|---|---|---|
| 지점 | `zizumNum` | `zizum_num` |
| 테마 | `themeNum` | `theme_num` |
| 테마정보 | `themeInfoNum` | `theme_info_num` |
| 날짜 | `revDays` | `rev_days` |
| 시간슬롯 | `themeTimeNum` | `theme_time_num` |

- Step1 폼은 **camelCase**, Step2 는 **snake_case**. `fun_submit()` 은 존재하지 않는다
  (`.btn_next_step` 클릭 핸들러가 hidden input 에 값을 넣고 `$('#form').submit()` 한다).
- 값의 출처: `themeNum`/`themeInfoNum` 은 `run_proc.php t=get_theme_info_list`,
  `themeTimeNum` 은 `t=get_theme_time`(날짜별 슬롯 PK). 서버가 `get_theme_time` 에서
  오픈 시간을 재검증하므로(F02) 존재하지 않는 슬롯 번호를 직접 넣으면 통과하지 못한다.

### 사용법

```bash
node probe.mjs branches                     # 지점 + 테마 수
node probe.mjs themes 25                     # 지점별 themeNum / themeInfoNum / doing
node probe.mjs times  25 72 2026-09-08       # 날짜별 themeTimeNum (value) 목록
node probe.mjs all                           # 전체 매트릭스 -> mapping.json
node summary.mjs                             # SUMMARY.txt (사람용 표)

node step1.mjs --zizum 25 --theme 72 --date 2026-09-08 --time 2604 --no-submit   # 입력까지만
node step1.mjs --zizum 25 --theme 72 --date 2026-09-08 --time 2604               # NEXT 까지
```

콘솔에 직접 붙여넣을 때는 `console-fill.js` 전체 실행 후
`KEY({zizum:25, theme:72, date:'2026-09-08', time:2604, submit:true})`.

### 실측 결과

`step1.mjs --zizum 25 --theme 72 --date 2026-09-08 --time 2604`
→ `reservation2.php` 이동 성공, 넘겨진 값:
`zizum_num=25 | theme_num=72 | theme_info_num=65 | rev_days=2026-09-08 | theme_time_num=2604 | rev_price=16000`
Step2 화면 = 정보 입력(person/name/mobile1~3) + reCAPTCHA + 결제.
**결제를 진행하지 않으면 예약은 생성되지 않는다.**



### Step2 입력폼까지 채우기 (결제 직전 정지)

```bash
node flow.mjs                 # 기본: 지점19 LOG_IN1 / 테마60 머니머니패키지 / 2026-09-10 / 14:40
DATE=2026-09-09 node flow.mjs # 날짜 override (env: ZIZUM THEME INFO DATE WANT)
OPEN_AT='2026-09-04T10:00:20+09:00' node flow.mjs   # 서버 예약오픈 시각에 자동 개시
node check-step2.mjs          # reservation2 현재 상태를 읽기 전용으로 재확인
```
- `flow.mjs` 는 ① `get_theme_time` 으로 WANT 시각의 `themeTimeNum` 조회(20초 재시도)
  ② Step1 자동 진행 후 NEXT ③ reservation2 의 `name`/`mobile1~3` 대입 ④ 스크린샷 저장.
  **`예약하기` 버튼은 누르지 않는다.**
- 9/10 은 지점 예약오픈시각(10:00) 이전에는 서버가 `예약가능시간이 아닙니다. 예약오픈시간 : 10:00` 로 거절한다.
- Step2 잔여 항목: `person`(기본 2), `agree_1~3` 약관 동의, `g-recaptcha-response`(reCAPTCHA 는 직접 클릭),
  `payment`(기본 D). 스크린샷 `step2.png`, 필드 스냅샷 `step2-snapshot.json`.



## 화면에서 골라서 예약 시도 (UI) · `ui/`

테마 이름 → 날짜 → 시간대를 마우스로 고르면 오픈 시각에 자동 사격하는 로컬 웹 UI.

```bash
cd ui && sh ui.sh        # http://127.0.0.1:8899/  (CDP 확인→UI 서버→브라우저 개방→전제조건 점검)
sh ui/preflight.sh       # 검사만 (Node/Chrome/CDP/사이트/UI/DevTools 차단 6종)
sh ui/preflight.sh --fix # 부족한 것 자동 기동 + DevTools 차단 재해제
```

- `ui/server.mjs` 정적 서+ API(지점/테마/날짜/시간 조회, 실행/중지, SSE 로그, Step2 읽기)
- `ui/runner.mjs` 실행 엔진 — `--times "19:50,21:25"` 처럼 **우선순위 목록**, 오픈 20초 전부터 45ms 폴링
- `ui/lib.mjs` 공용 (run_proc RPC + CDP + 페이지 주입 코드)
- **오픈 대기 시각은 자동** — 날짜를 고르면 `GET /api/openinfo` 가 그 날짜가 열리는 순간을 계산해 채운다.
  지점별 오픈 시각은 `reservation.php`(더오름/우주라이크/LOG_IN 10:00 · 메모리컴퍼니 10:30 · 후즈데어 11:00 ·
  STATION 11:30 · 무비무드 13:30 · 강남/부산/전주 18:00 · 홍대 20:00), **며칠 전 오픈(D-n)인지는 서버 슬롯 스캔**
  (실측: 메모리컴퍼니 D-6, 홍대점 D-12). 버튼은 `🎯 예약` 하나(오픈 시각 사격) + 슬롯 조회 + 중단. 인원은 사이트 기본값.
- `reserve-fast.mjs` 와 동일하게 Step1 을 생략하고 `reservation2.php` 로 직접 POST, 이름/휴대폰/약관을
  문서 파싱과 동시에 채운다. **reCAPTCHA 체크와 '예약하기' 클릭은 직접** 해야 예약이 확정된다.
- 상세는 `ui/README.md`

## 비고

## 비고

- 격리 프로필(`/tmp/keyescape-chrome-profile`)을 쓰므로 기존 로그인/확장/방문기록은 영향 없음.
  Chrome 136+ 는 기본 프로필에서 원격디버깅을 거부하므로 분리가 필수.
- CDP 접속은 `127.0.0.1:9222` 로컬에만 바인딩되므로 작업 후 크롬을 닫으면 종료된다.
- 화면 검증/디버깅 용도로만 사용할 것. 자동 예약·대량 요청은 이용약관에 저촉될 수 있다.
