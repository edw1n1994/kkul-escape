#!/usr/bin/env bash
# keyescape.com 개발자도구 차단 해제 - 원샷 스크립트
#
#   ./unlock.sh                    : 크롬이 켜져 있으면 해제만, 없으면 격리 크롬까지 자동 기동
#   ./unlock.sh <URL>              : keyescape 탭이 없을 때 그 URL 로 연다
#   ./unlock.sh --reload           : 새로고침 후(사이트 스크립트 재실행 후)에도 해제 유지되는지 검증
#   CDP_PORT=9333 ./unlock.sh      : 포트 지정
#   KEYESCAPE_URL=... ./unlock.sh  : 열 URL 지정
#
# 해제 대상 (사이트 인라인 스크립트 3종):
#   1) devtools-detector  : DevTools 감지 후 body 를 검은 화면으로 교체  -> 더미 객체로 선점
#   2) contextmenu 차단   : 우클릭 / "검사" 비활성                      -> 캡처 단계 선점
#   3) document.onkeydown : F12 / Cmd+Opt+I / Cmd+U 키 차단             -> setter no-op 치환
#
# 재실행 안전(멱등): 이미 해제되어 있어도 다시 돌려도 됩니다. 새로고침 후 다시 실행하면 됩니다.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${CDP_PORT:-9222}"
URL="${1:-${KEYESCAPE_URL:-https://www.keyescape.com/reservation1.php?zizum_num=18&theme_num=57&theme_info_num=34}}"
UP=http://127.0.0.1:$PORT/json/version

if ! curl -sf --max-time 3 "$UP" >/dev/null 2>&1; then
  echo "· 격리 크롬 기동 중 (프로필: ${KEYESCAPE_PROFILE:-/tmp/keyescape-chrome-profile})"
  # open(LaunchServices) 으로 띄우면 이 셸이 종료돼도 창이 같이 죽지 않는다
  PROFILE="${KEYESCAPE_PROFILE:-/tmp/keyescape-chrome-profile}"
  open -na "Google Chrome" --args \
    --user-data-dir="$PROFILE" \
    --remote-debugging-port="$PORT" \
    --no-first-run \
    --no-default-browser-check \
    --disable-features=Translate \
    "$URL" || { echo "크롬 실행 실패 (open 명령). 수동: ./start.sh"; exit 1; }
  for _ in $(seq 1 40); do
    curl -sf --max-time 1 "$UP" >/dev/null 2>&1 && break
    sleep 0.5
  done
  curl -sf --max-time 2 "$UP" >/dev/null 2>&1 || {
    echo "CDP(:$PORT) 바인딩 실패. 이미 다른 크롬이 같은 프로필을 쓰고 있으면 완전히 종료 후 재시도하세요."
    echo "  pkill -f -- '--user-data-dir=$PROFILE'"
    exit 1
  }
  sleep 2
fi

CDP_PORT="$PORT" node "$DIR/unlock.mjs" "$URL" "$@"
