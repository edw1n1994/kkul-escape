#!/bin/bash
# keyescape.com 을 "개발자도구 사용 가능" 상태로 여는 Chrome 래퍼 (명령 한 번으로 끝)
#
#  ./start.sh [CDP포트] [열 URL]
#
#  - --user-data-dir        : 격리 프로필 (기존 프로필/로그인 무영향.
#                             Chrome 136+ 는 기본 프로필에서 원격디버깅을 거부하므로 분리 필수)
#  - --remote-debugging-port: CDP 포트
#  - --auto-open-devtools   : 탭이 열리면 DevTools UI 자동 오픈
#  기동 후 CDP Extensions.loadUnpacked 로 ext/ 를 설치하고 예약 페이지를 연다.
#  (loadUnpacked 는 세션 전용이라 매 실행마다 재설치가 필요하다 -> 아래에서 자동 처리)
set -uo pipefail

PORT="${1:-9222}"
URL="${2:-${KEYESCAPE_URL:-https://www.keyescape.com/reservation1.php?zizum_num=18&theme_num=58&theme_info_num=35}}"
PROFILE="${KEYESCAPE_PROFILE:-/tmp/keyescape-chrome-profile}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DIR="$(cd "$(dirname "$0")" && pwd)"

"$CHROME" \
  --user-data-dir="$PROFILE" \
  --remote-debugging-port="$PORT" \
  --no-first-run \
  --no-default-browser-check \
  --disable-features=Translate \
  about:blank &
CHROME_PID=$!

echo "Chrome 기동 중 (pid $CHROME_PID) ..."
for _ in $(seq 1 60); do
  curl -sf --max-time 1 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 || {
  echo "CDP 포트($PORT) 바인딩 실패. 다른 포트나 다른 크롬 창을 확인하세요."; exit 1;
}

CDP_PORT="$PORT" node "$DIR/load-ext.mjs" "$URL" || echo "확장 설치 실패 - 수동으로 node load-ext.mjs 실행 필요"
echo "준비 완료. 창에서 DevTools 가 열린 채로 사용 가능합니다."
wait "$CHROME_PID"
