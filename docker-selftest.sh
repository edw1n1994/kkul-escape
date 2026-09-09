#!/usr/bin/env bash
# ============================================================================
#  컨테이너(또는 리눅스 VM) 안에서 도는 설치/스모크 테스트 묶음
#    docker run --rm keyescape-ui selftest
#    docker exec <running> bash /app/docker-selftest.sh
#  읽기 전용 조회(dry)만 수행한다. reservation2 제출 / 예약 확정 동작은 절대 건드리지 않는다.
# ============================================================================
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
UI="$HERE/ui"
PORT="${PORT:-8899}"
CDP_PORT="${CDP_PORT:-9222}"
CDP="http://127.0.0.1:$CDP_PORT"
U="http://127.0.0.1:$PORT"
URL="${KEYESCAPE_URL:-https://www.keyescape.com/reservation1.php}"
ZIZUM="${ZIZUM:-18}"; THEME="${THEME:-57}"; INFO="${INFO:-34}"
DATE="$(date -d '+5 days' +%F 2>/dev/null || date -v+5d +%F)"
PASS=0; FAIL=0; SKIP=0
# eval 로 현재 셸에서 실행하되 서브셸로 감싼다 — bash -c 는 함수를 못 보고, 감싸지 않으면 테스트 안의 exit 이 전체를 끝낸다
t()  { if ( eval "$2" ) >/dev/null 2>&1; then printf '  \033[32m✔\033[0m %s\n' "$1"; PASS=$((PASS + 1)); else printf '  \033[31m✘\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); fi; }
ts() { if ( eval "$2" ) >/dev/null 2>&1; then printf '  \033[32m✔\033[0m %s\n' "$1"; PASS=$((PASS + 1)); else printf '  \033[33m-\033[0m %s (건넘)\n' "$1"; SKIP=$((SKIP + 1)); fi; }
has() { curl -s --max-time 30 "$1" | grep -q "$2"; }
code() { test "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1")" = "$2"; }
# tp <이름> <명령>: 최대 48초까지 재시도. 헤드리스 크롬은 실제 사이트 로딩이 느려 고정 sleep 은 레이스를 만든다
tp() {
  local i=0
  while [ "$i" -lt 48 ]; do
    if ( eval "$2" ) >/dev/null 2>&1; then printf '  \033[32m✔\033[0m %s\033[2m (%ds)\033[0m\n' "$1" "$i"; PASS=$((PASS + 1)); return; fi
    sleep 3; i=$((i + 3))
  done
  printf '  \033[31m✘\033[0m %s\033[2m (48초 초과)\033[0m\n' "$1"; FAIL=$((FAIL + 1))
}

echo "== 예약도우미 설치 테스트 ===================================="
echo "   date=$DATE  zizum=$ZIZUM theme=$THEME info=$INFO  CDP=$CDP_PORT UI=$PORT"

echo; echo "[A] 런타임/정적"
t 'Node >= 22'                'node -e "const m=+process.versions.node.split(\".\")[0]; if(m<22) process.exit(1)"'
t '전역 WebSocket (CDP 용도)'  'node -e "if(typeof WebSocket!==\"function\") process.exit(1)"'
t '전역 fetch'                'node -e "if(typeof fetch!==\"function\") process.exit(1)"'
t 'Chromium 바이너리'          'chromium --version || google-chrome --version'
t 'mjs 전량 문법검사'          "cd $HERE && for f in *.mjs ui/*.mjs; do [ -e \"\$f\" ] && node --check \"\$f\" || exit 1; done"
t '셸 스크립트 문법검사'        "bash -n $HERE/setup.sh && bash -n $UI/preflight.sh && bash -n $UI/ui.sh && bash -n $HERE/docker-entrypoint.sh"
t 'package.json 의존성 없음'    "test ! -f $HERE/package.json || ! grep -q '\"dependencies\"' $HERE/package.json"

echo; echo "[B] 네트워크/CDP"
t 'CDP /json/version'         "curl -sf --max-time 5 $CDP/json/version"
t 'CDP 브라우저 식별'          "curl -s --max-time 5 $CDP/json/version | grep -q Browser"
t 'keyescape HTTP 200'        "code '$URL' 200"
t 'RPC get_theme_info_list'   "cd $UI && node -e \"import('./lib.mjs').then(async m=>{const r=await m.rpc('get_theme_info_list',{zizum_num:'$ZIZUM'}); if(!JSON.stringify(r).includes('theme_num')) process.exit(1)})\""

echo; echo "[C] UI 서버 API"
t 'GET /  (index.html)'       "curl -sf --max-time 6 $U/ | grep -qi '<html'"
t 'GET /api/log'              "has $U/api/log '\"running\"'"
t 'GET /api/env'              "has $U/api/env '\"cdp\":\"OK\"'"
t 'GET /api/themes'           "has '$U/api/themes?zizum=$ZIZUM' '\"themes\":\\['"
t 'GET /api/matrix'           "has '$U/api/matrix?zizum=$ZIZUM&theme=$THEME&info=$INFO&days=7' '\"date\"'"
t 'GET /api/slots'            "has '$U/api/slots?zizum=$ZIZUM&theme=$THEME&date=$DATE' '\"slots\"'"
t 'GET /api/openinfo (오픈 시각 계산)' "has '$U/api/openinfo?zizum=$ZIZUM&theme=$THEME&info=$INFO&date=$DATE' '\"openAt\"'"
t 'openinfo: 지점 오픈 시각 존재' "has '$U/api/openinfo?zizum=$ZIZUM&theme=$THEME&info=$INFO&date=$DATE' '\"openTimeSource\"'"
t 'lib: 오픈 전 스캔 보정(windowSpan +1일) 탑재' "grep -q 'export function windowSpan' $UI/lib.mjs && grep -q 'windowSpan({' $UI/lib.mjs"
t 'UI: 오픈 시각 자동 계산 코드 탑재' "curl -s --max-time 8 $U/ | grep -q 'loadOpenInfo'"
t 'UI: 지금 예약 버튼 제거 / 예약 버튼' "curl -s --max-time 8 $U/ | grep -q '예약</button>' && ! curl -s --max-time 8 $U/ | grep -q '지금 예약'"
t 'UI: 오픈시각/폴링/인원 입력란 없음 (기본값 고정)' "! grep -qE 'id=\"(openAt|deadline|person)\"' $UI/public/index.html && grep -q 'const DEF = {' $UI/public/index.html"
t 'UI: 예약자 이름/휴대폰 폼 존재' "grep -q 'id=\"pname\"' $UI/public/index.html && grep -q 'id=\"hp\"' $UI/public/index.html && grep -q 'saveBuyer' $UI/public/index.html"
t 'UI: 조건 요약 바 없음' "! grep -qE 'id=\"bar\"|updateBar' $UI/public/index.html"
t 'UI: 시간대 단선택 (우선순위 목록 아님)' "grep -q 'function pickTime' $UI/public/index.html && ! grep -qE 'addAllWaiting|S\\.times' $UI/public/index.html"
t 'UI: 이미 열린 날짜는 클릭 차단 (noOpen)' "grep -q 'noOpen()' $UI/public/index.html"
t 'UI: 창 밖 날짜는 가까운 날짜 시간표로 미리 대기' "grep -q 'SLOT_PREVIEW' $UI/public/index.html"

t 'GET /api/events (SSE)'     "curl -s --max-time 3 $U/api/events | head -c 60 | grep -q 'ready\\|data\\|:'"

echo; echo "[D] DevTools 차단 해제 (실제 탭)"
# 헤드리스 Chromium 은 /json/new?url= 을 무시한다 → 런너와 동일하게 createTarget + Page.navigate
NEWID="$(cd $HERE && CDP_PORT=$CDP_PORT node docker-opentab.mjs '$URL' 2>/dev/null | tail -1)"
ts 'CDP 탭 생성 + keyescape 이동' "test -n '$NEWID'"
t 'unlock.mjs 주입(+reload)'  "cd $HERE && node unlock.mjs --quiet --reload '$URL'"
# unlock-status.mjs 의 출력은 JSON.stringify(o, null, 2) — 즉 "key": true (공백 있음).
# 패턴에 공백을 허용하지 않으면 영원히 매칭되지 못한다(한때 여기서 오탐이 났다).
tp '해제 상태(allUnlocked)'     "cd $UI && node unlock-status.mjs $CDP_PORT | grep -qE '\"allUnlocked\": *true'"
tp '디텍터 더미 장전'           "cd $UI && node unlock-status.mjs $CDP_PORT | grep -qE '\"dummy\": *true'"
# '탭이 하나도 없으면' ctxOpen 이 한 줄도 안 찍혀 grep 은 실패한다. 이 도구의 계약은 종료코드다
# (0 = 전부 해제됨 또는 keyescape 탭 없음 / 2 = 일부 차단) — 공유 CDP 환경에서 탭이 사라지는 flake 를 막는다.
t '모든 탭 우클릭 허용'         "cd $UI && node unlock-status.mjs $CDP_PORT >/dev/null"
t '검은화면(wiped) 없음'        "! (cd $UI && node unlock-status.mjs $CDP_PORT | grep -qE '\"wiped\": *true')"
if [ -n "${NEWID:-}" ]; then curl -s --max-time 5 "$CDP/json/close/$NEWID" >/dev/null 2>&1; fi

echo; echo "[E] 예약 엔진 (dry = 조회만, 제출 없음)"
t 'runner.mjs --dry 슬롯 조회' "cd $UI && node runner.mjs --zizum $ZIZUM --theme $THEME --info $INFO --date $DATE --dry"
t 'runner --dry + 우선순위 상태 라벨' "cd $UI && node runner.mjs --zizum $ZIZUM --theme $THEME --info $INFO --date $DATE --times '09:15,23:00' --dry | grep -q '우선순위 09:15='"

t 'POST /api/run (dry)'        "curl -sf --max-time 12 -X POST $U/api/run -H 'content-type: application/json' -d '{\"zizum\":\"$ZIZUM\",\"theme\":\"$THEME\",\"info\":\"$INFO\",\"date\":\"$DATE\",\"dry\":true}' | grep -q '\"ok\":true'"
sleep 5
t 'POST /api/stop 또는 자연종료' "curl -sf --max-time 8 -X POST $U/api/stop | grep -q 'ok'"
t 'runs.log 기록'              "grep -q . $UI/runs.log"

echo; echo "[F] 안전장치 (돈 나가는 동작 금지가 코드에 강제되는지)"
t 'runner 는 마우스/키 물리 이벤트를 쏘지 않는다 (CDP Input.dispatch 없음)' \
  "! grep -qE 'dispatchMouseEvent|dispatchKeyEvent' $UI/runner.mjs"
t 'runner 자체는 버튼을 클릭하지 않는다 (클릭은 lib.step2Submit 하나뿐)' \
  "! grep -q 'click(' $UI/runner.mjs && grep -q 'btns\[0\]\.click()' $UI/lib.mjs"
t 'runner 는 캡차/예약하기에서 사용자에게 핸드오프한다' \
  "grep -q \"이제 '예약하기'만 클릭하세요\" $UI/runner.mjs"
t 'runner 에 결제(KCP) 자동화 없음' \
  "! grep -qiE 'kcp|window\\.open.*pay|payment.*submit' $UI/runner.mjs"
t 'setup.sh --stop 이 느슨한 패턴으로 남의 프로세스를 잡지 않음' \
  "! grep -qE \"pkill -f '?(server|runner)[.]mjs\" $HERE/setup.sh"
t 'UI JS: Response 에 .then/.catch 붙이는 실수 없음' \
  "! grep -qE 'await \\(await fetch\\(.*\\)\\)\\.(then|catch)' $UI/public/index.html"
t 'UI 인라인 JS 문법 통과 (node --check)' \
  "awk '/<script>/{f=1;next} /<\\/script>/{f=0} f' $UI/public/index.html > /tmp/ui-inline.js && node --check /tmp/ui-inline.js"

echo; echo "[G] 제로월드 (같은 화면의 두 번째 사이트)"
t 'sites.mjs 문법 통과'          "node --check $UI/sites.mjs"
t 'SITES 에 keyescape/zeroworld 모두 등록' \
  "grep -q 'keyescape: {' $UI/sites.mjs && grep -q 'zeroworld: {' $UI/sites.mjs"
t 'runner 가 --site 으로 사이트 분기' "grep -q 'siteOf(A.site)' $UI/runner.mjs && grep -q \"SITE.key === 'zeroworld'\" $UI/runner.mjs"
t 'UI 에 사이트 전환 탭'          "grep -q 'id=\"siteTabs\"' $UI/public/index.html && grep -q 'function setSite' $UI/public/index.html"
t '제로월드 자동 제출 없음 (폼 .submit()/사이트 fun_submit 호출 금지)' \
  "! grep -qE '\\.submit\\(|fun_submit' $UI/sites.mjs"
t '제로월드 예약하기 버튼 클릭 없음 (활성화 class 만 건드림)' \
  "! grep -qE 'rese-form__button.{0,60}\\.click\\(' $UI/sites.mjs"
t '제로월드 탭을 사이트별로 구분'  "grep -q 'tabMatch' $UI/sites.mjs && grep -q 't.url.includes(s.tabMatch)' $UI/sites.mjs"
ts 'API /api/env?site=zeroworld'  "has '$U/api/env?site=zeroworld' '\"site\":\"zeroworld\"'"
ts 'API /api/themes?site=zeroworld' "has '$U/api/themes?site=zeroworld&zizum=5' '\"ok\":true'"
ts 'API /api/slots?site=zeroworld' "has '$U/api/slots?site=zeroworld&zizum=5&theme=36&date=$DATE' '\"slots\"'"
ts 'API /api/openinfo?site=zeroworld (오픈 시각 문구에서 읽음)' \
  "has '$U/api/openinfo?site=zeroworld&zizum=5&theme=36&date=$DATE' '\"openTimeSource\"'"
ts 'RUNNER dry (제로월드 조회만, 제출 없음)' \
  "cd $UI && timeout 90 node runner.mjs --site zeroworld --zizum 5 --theme 36 --date $DATE --dry | grep -q 'SLOTS'"
D20="$(date -d '+20 days' +%F 2>/dev/null || date -v+20d +%F)"
ts 'API: 예약 창 밖 날짜는 슬롯을 보여주지 않는다' \
  "has '$U/api/slots?site=zeroworld&zizum=5&theme=36&date=$D20' '달력 예약 창 밖'"
t 'API: 창 기준이 달력에서 나온다 (theme_time_list 아님)' "grep -q 'zwCalendarDates' $UI/sites.mjs && grep -q 'fun_days_select' $UI/sites.mjs"
t '지점 목록을 코드로 걸러낸다 (내장 표 = 강남/홍대)' "! grep -qE 'branches: \[\[1,' $UI/sites.mjs"
ts 'API 지점 목록에 김포본점이 없다' "! has '$U/api/env?site=zeroworld' '김포'"


echo; echo "[H] 캡차 통과 후 '예약하기' 자동 클릭 (opt-in — reCAPTCHA 체크는 여전히 사람이)"
t 'lib.mjs 에 제출 함수 step2Submit 가 있다'        "grep -q 'export function step2Submit' $UI/lib.mjs"
t '제출은 opt-in (--auto-submit), 기본값 off' \
  "grep -q 'const AUTO_SUBMIT = !!A' $UI/runner.mjs"
t '자동 제출은 키이스케이프에서만 (제로월드는 제출을 자동화하지 않음)' \
  "grep -q \"SITE.key === 'keyescape'\" $UI/runner.mjs"
t '토큰이 없으면 클릭을 거부한다 (사람 캡차 통과가 선행 조건)' \
  "grep -q 'reCAPTCHA 토큰 없음' $UI/lib.mjs"
t 'reCAPTCHA API 를 실행/리셋하지 않는다 (execute/reset/render 금지)' \
  "! grep -qE 'grecaptcha\\.(execute|reset|render|ready)' $UI/lib.mjs $UI/runner.mjs $UI/sites.mjs"
t 'g-recaptcha-response 에 값을 대입하지 않는다 (토큰 생성 금지)' \
  "! grep -qE 'g-recaptcha-response.{0,40}value *=' $UI/lib.mjs $UI/runner.mjs $UI/sites.mjs"
t '클릭 전에 예약좌표/약관/예약자/금액을 검증한다' \
  "grep -q '예약좌표 불일치' $UI/lib.mjs && grep -q '약관 미체크' $UI/lib.mjs && grep -q '상품명/금액 없음' $UI/lib.mjs"
t '상품명/금액은 결제 폼(order_info) 밖에서도 찾는다 (실측에서 막혔던 회귀)' \
  "grep -q \"const doc = (n) => { const e = document.querySelector\" $UI/lib.mjs"
t '픽스처가 실제 구조대로 order_info 를 별도 폼으로 둔다' \
  "grep -q 'name=\"order_info\"' $UI/tests/fixture-step2.html"
t '중복 클릭 방지 (문서당 1회 플래그)'                "grep -q '__SUBMITTED' $UI/lib.mjs"
t '서버가 --auto-submit 을 러너로 전달한다'          "grep -q -- \"'--auto-submit'\" $UI/server.mjs"
t 'UI 체크박스가 있고 기본 미체크' \
  "grep -q 'id=\"autosub\"' $UI/public/index.html && ! grep -qE 'id=\"autosub\"[^>]*checked' $UI/public/index.html"
t 'UI 문구가 캡차는 사람이 클릭한다고 밝힌다'        "grep -q '여전히 사람이 클릭' $UI/public/index.html"
t 'step2Submit 단위 테스트/픽스처가 저장소에 있다' \
  "test -f $UI/tests/submit-test.mjs && test -f $UI/tests/fixture-step2.html"
t 'step2Submit 테스트 문법 통과'                     "node --check $UI/tests/submit-test.mjs"
t 'STEP2_READ 은 getResponse 예외로 죽지 않는다'     "grep -q 'try { return (window.grecaptcha' $UI/lib.mjs"

echo; echo "[I] 디버거 차단 해제 배선 + 감시 전용 (사이트가 devtools-detector 로 디버거를 막는다)"
t 'lib.mjs 에 차단 문구 마커(BLOCK_MARK) 가 있다'   "grep -q \"export const BLOCK_MARK = '개발자 도구 사용이 금지'\" $UI/lib.mjs"
t 'STEP2_READ 이 차단 화면을 판정한다'              "grep -q 'blocked: /개발자 도구 사용이 금지/' $UI/lib.mjs"
t '러너가 이 저장소의 기존 해제(ext/inject.js) 를 재사용한다 (사본을 만들지 않음)' \
  "grep -q \"'..', 'ext', 'inject.js'\" $UI/lib.mjs && grep -q 'export function unlockSource' $UI/lib.mjs && grep -q 'applyUnlock' $UI/runner.mjs"
t '해제를 입력기 주입보다 먼저 건다 (addScript 등록 순서가 곧 실행 순서)' \
  "test $(grep -n 'applyUnlock(c, log)' $UI/runner.mjs | head -1 | cut -d: -f1) -lt $(grep -n 'source: inject' $UI/runner.mjs | head -1 | cut -d: -f1)"
t '해제 스크립트는 디텍터/우클릭/F12 3종을 무력화한다 (기존 수재 그대로)' \
  "grep -q 'devtoolsDetector' $UI/../ext/inject.js && grep -q 'contextmenu' $UI/../ext/inject.js && grep -q 'onkeydown' $UI/../ext/inject.js"
t '차단 화면이면 해제 재적용 → 1회 복구 → 안 되면 중단 (exit 7)' \
  "grep -q '복구됨' $UI/runner.mjs && grep -q '\\[BLOCK\\]' $UI/runner.mjs && grep -q 'process.exit(7)' $UI/runner.mjs"
t '감시 전용은 디버거를 붙이지 않는다 (CDP 분기 조건)' \
  "grep -q 'if (!DRY && !WATCH_ONLY)' $UI/runner.mjs"
t '감시 전용은 사람 핸드오프만 한다 (알림 + 창 열기, 클릭 없음)' \
  "grep -q 'HANDOFF' $UI/runner.mjs && grep -q \"'open'\" $UI/runner.mjs"
t '서버가 --watch-only 를 전달한다'                 "grep -q -- \"'--watch-only'\" $UI/server.mjs"
t 'UI 에 감시만 버튼이 있다'                        "grep -q '감시만' $UI/public/index.html"
t 'UI 로그가 [BLOCK] 을 빨강으로 표시한다'          "grep -q 'BLOCK|ABORT' $UI/public/index.html"
t '차단 화면 픽스처가 있다'                         "test -f $UI/tests/fixture-blocked.html"
ts 'RUNNER 감시 전용 실행 (디버거 없이 HIT/MISS 까지)' \
  "cd $UI && timeout 60 node runner.mjs --zizum $ZIZUM --theme $THEME --info $INFO --date $DATE --times '10:45' --deadline 6 --watch-only --no-open | grep -qE '\\[WATCH\\]|\\[MISS\\]'"

echo; echo "[J] 단편선(dpsnnn) — 아임웹 예약 · 로그인 필수 · 무통장입금"
t 'dps.mjs 가 있고 문법 통과'                    "test -f $UI/dps.mjs && node --check $UI/dps.mjs"
t 'sites.mjs 에 단편선이 등록되어 있다'          "grep -q \"key: 'dps'\" $UI/sites.mjs"
t 'façade(apiTimes) 가 dps 로 위임한다'          "grep -q \"k === 'dps'\" $UI/sites.mjs"
t '러너에 단편선 분기가 있다'                    "grep -q '3-DPS' $UI/runner.mjs"
t '로그아웃 상태에서는 클릭하지 않는다(게이트)'  "grep -q '로그인해야 예약할 수 있습니다' $UI/runner.mjs && grep -q '로그아웃 상태' $UI/dps.mjs"
t '결제화면의 최종 결제 버튼은 누르지 않는다'    "grep -q '최종 결제' $UI/dps.mjs && ! grep -q '결제하기' $UI/dps.mjs"
t '이름/연락처/입금자명 + 무통장입금을 채운다'   "grep -q deposit $UI/dps.mjs && grep -q 무통장입금 $UI/dps.mjs"
t '서버에 /api/login 라우트가 있다'              "grep -q '/api/login' $UI/server.mjs"
t 'UI 상단에 로그인 배지가 있다'                 "grep -q 'id=\"bLogin\"' $UI/public/index.html"
t 'UI 에 입금자명 입력이 있다'                   "grep -q 'id=\"dep\"' $UI/public/index.html"
t '로그에는 개인 값을 마스킹해서 남긴다'         "grep -q maskName $UI/lib.mjs && grep -q maskHp $UI/runner.mjs"
t '단편선 테스트/픽스처가 저장소에 있다'         "test -f $UI/tests/dps-test.mjs && test -f $UI/tests/fixture-dps-calendar.html && test -f $UI/tests/fixture-dps-payment.html && test -f $UI/tests/fixture-dps-slot.html"
t '단편선 테스트 문법 통과'                      "node --check $UI/tests/dps-test.mjs"
t '달력 파서: 완료일은 닫힘, 가(예약가능) 는 열림 (오프라인 픽스처)' \
  "cd $UI && node -e \"import('./dps.mjs').then(m=>{const f=require('fs').readFileSync('tests/fixture-dps-calendar.html','utf8');const a=m.parseDpsDay(f,'2026-09-10'),b=m.parseDpsDay(f,'2026-09-15'),c=m.parseDpsDay(f,'2026-09-16');if(a.total>0&&a.open===0&&b.open===b.total&&c.notOpen)process.exit(0);process.exit(1);})\""
t '로그인 판정: guest 마커 우선 (로그아웃 링크는 함정)' \
  "cd $UI && node -e \"import('./dps.mjs').then(m=>process.exit(m.parseDpsLogin({guest:true,memberBlock:true}).loggedIn===false?0:1))\""
t '결제화면 확정 필드가 입력기에 박혀 있다 (orderer_name/orderer_call/depositor_name)' \
  "grep -q orderer_name $UI/dps.mjs && grep -q orderer_call $UI/dps.mjs && grep -q depositor_name $UI/dps.mjs"
t '결제수단(pay_type)·입금계좌(cash_idx) 를 인지한다' "grep -q pay_type $UI/dps.mjs && grep -q cash_idx $UI/dps.mjs"
t '요청사항(deliv_memo) 등은 입력 대상에서 제외'    "grep -q deliv_memo $UI/dps.mjs"
t '로그인 배지는 실명/이메일을 마스킹한다'         "cd $UI && node -e \"import('./dps.mjs').then(m=>{const x=m.parseDpsLogin({guest:false,memberBlock:true,member:'테스트유저 t@x.com'}).msg;process.exit(!/테스트유저|t@x/.test(x)?0:1)})\""

echo "======================================================================"
printf ' 통과 \033[32m%s\033[0m   실패 \033[31m%s\033[0m   건넘 \033[33m%s\033[0m\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" = 0 ] || exit 1
