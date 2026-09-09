#!/bin/sh
# 키이스케이프 예약 사격대 실행 래퍼
#   sh ui.sh              CDP(:9222) 확인 → 없으면 ../unlock.sh 로 격리 크롬 기동 → UI 서버 → 브라우저 개방
#   PORT=9000 CDP_PORT=9333 sh ui.sh   포트 지정 (네이버 작업과 병렬 시 격리 포트 권장)
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
PORT=${PORT:-8899}
CDP_PORT=${CDP_PORT:-9222}
export PORT CDP_PORT

echo "== 키이스케이프 사격대 =="
if curl -s --max-time 3 "http://127.0.0.1:${CDP_PORT}/json/version" >/dev/null 2>&1; then
  echo "CDP(:${CDP_PORT}) 살아 있음"
else
  echo "CDP(:${CDP_PORT}) 없음 → ../unlock.sh 로 격리 크롬 기동 시도"
  (cd "$HERE/.." && CDP_PORT="$CDP_PORT" ./unlock.sh) || echo "unlock.sh 실패 — 수동으로 크롬을 띄우세요 (README 참고)"
fi

# 이미 떠 있는 UI 서
if curl -s --max-time 2 "http://127.0.0.1:${PORT}/api/log" >/dev/null 2>&1; then
  echo "UI 서버가 이미 :${PORT} 에 실행 중 → 그대로 사용"
else
  PORT="$PORT" CDP_PORT="$CDP_PORT" nohup node "$HERE/server.mjs" >"$HERE/server.out" 2>&1 </dev/null &
  sleep 1
  echo "UI 서버 시작 pid=$!  로그: $HERE/server.out"
  disown 2>/dev/null || true
fi

echo "http://127.0.0.1:${PORT}/"
command -v open >/dev/null 2>&1 && open "http://127.0.0.1:${PORT}/"
echo "--- 전제조건 / DevTools 차단 점검 ---"
sh "$HERE/preflight.sh" || echo "(미충족 항목 자동 해결: sh preflight.sh --fix)"
echo "중단: pkill -f 'ui/server.mjs'   (실행 중인 사격까지 함께 끝나면 pkill -f 'ui/runner.mjs')"
