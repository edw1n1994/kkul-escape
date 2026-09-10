#!/usr/bin/env bash
# 컨테이너 진입점.  인자:
#   serve (기본)  : CDP 크롬(헤드리스) + UI 서버 기동 후 포그라운드 유지
#   --check       : setup.sh --check 만 수행
#   selftest      : scripts/docker/docker-selftest.sh (설치 테스트 묶음)
#   sh|shell      : bash
set -u
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
export CHROME_ARGS="${CHROME_ARGS:---headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage}"
export KEYESCAPE_PROFILE="${KEYESCAPE_PROFILE:-/tmp/keyescape-chrome-profile}"

case "${1:-serve}" in
  --check | check) exec bash "$HERE/setup.sh" --check ;;
  selftest)        exec bash "$HERE/scripts/docker/docker-selftest.sh" ;;
  sh | shell)      exec bash ;;
  serve)
    bash "$HERE/setup.sh" || echo "(setup.sh 가 일부 항목을 미충족으로 보고했습니다 — 위 로그 확인)"
    echo
    echo "컨테이너 안 준비 끝. 바깥에서 접속: http://localhost:${PORT:-8899}/  (-p 8898:8899 식의 포트맵 필요)"
    echo "컨테이너 안 테스트:  docker exec <this> bash /app/scripts/docker/docker-selftest.sh"
    echo "-----------------------------------------------------------------"
    PID="$(pgrep -f "$HERE/ui/server.mjs" | head -1)"
    if [ -z "$PID" ]; then echo 'UI 서버가 뜨지 않았습니다.'; tail -20 "$HERE/ui/server.out" 2>/dev/null; exit 1; fi
    echo "UI 서버 pid=$PID  (로그를 docker logs 로도 흐름)"
    # 서버는 setup.sh 이 백그라운드로 띄웠다(이 셸의 자식 아님 → wait 사용 불가).
    # 대신 라이브니스를 폴링해서 서버가 죽으면 컨테이너도 끝나게 만든다.
    (tail -F "$HERE/ui/server.out" 2>/dev/null &)
    FAILS=0
    while :; do
      if curl -sf --max-time 4 "http://127.0.0.1:${PORT:-8899}/api/log" >/dev/null 2>&1; then
        FAILS=0
      else
        FAILS=$((FAILS + 1))
        [ "$FAILS" -ge 3 ] && { echo "UI 서버 응답 없음 — 컨테이너 종료"; break; }
      fi
      sleep 3
    done
    tail -20 "$HERE/ui/server.out" 2>/dev/null
    exit 1
    ;;
  *)
    echo "알 수 없는 인자: $1   (serve | --check | selftest | sh)"
    exit 64
    ;;
esac
