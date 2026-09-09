#!/usr/bin/env bash
# 키이스케이프 예약 사격대 — 원샷 설치/기동 (macOS · Linux)
#
#   ./setup.sh                 검사 → 부족한 것 자동 구성 → DevTools 해제 → UI 기동 → 브라우저 개방
#   ./setup.sh --check         검사만 (아무것도 켜거나 바꾸지 않음)
#   ./setup.sh --stop          UI 서버/사격 프로세스만 종료 (크롬은 유지)
#   ./setup.sh --stop --chrome 크롬까지 종료 (booking.naver 탭이 있으면 거부 = 다른 예약 보호)
#   ./setup.sh --with-node     Node 없고 brew 있으면 brew install node 시도
#   PORT=9000 CDP_PORT=9333 ./setup.sh    포트 지정 (네이버 작업과 병렬 시 격리 권장)
#
# Windows 는 setup.bat (또는 setup.ps1) 을 사용하세요.
# 이 프로젝트는 npm 설치가 필요 없습니다. 필요한 런타임은 Node 22 + Chrome 뿐입니다.
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
UI="$ROOT/ui"
PORT="${PORT:-8899}"
CDP_PORT="${CDP_PORT:-9222}"
PROFILE="${KEYESCAPE_PROFILE:-/tmp/keyescape-chrome-profile}"
URL="${KEYESCAPE_URL:-https://www.keyescape.com/reservation1.php}"
CDP=http://127.0.0.1:${CDP_PORT}
UIURL=http://127.0.0.1:${PORT}
CHECK=0 STOP=0 KILLCHROME=0 WITHNODE=0
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;;
    --stop) STOP=1 ;;
    --chrome) KILLCHROME=1 ;;
    --with-node) WITHNODE=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo " 모르는 옵션: $a (사용법: ./setup.sh --help)"; exit 64 ;;
  esac
done
N=0
step() { N=$((N+1)); printf '\n\033[1m[%d] %s\033[0m\n' "$N" "$1"; }
ok()   { printf '    \033[32m✔\033[0m %s\n' "$1"; }
info() { printf '    ·  %s\n' "$1"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$1"; }
bad()  { printf '    \033[31m✘\033[0m %s\n' "$1"; BAD=1; }
BAD=0
up() { curl -sf --max-time 3 "$1" >/dev/null 2>&1; }

echo "==============================================="
echo " 키이스케이프 예약 사격대 설치  (CDP:${CDP_PORT} / UI:${PORT})"
echo "==============================================="

# ---------- 종료 모드 ----------
if [ "$STOP" = 1 ]; then
  step "실행 중인 것 종료"
  # ★ 절대 이 프로젝트 경로限定 으로만 잡는다.
  #   예전에 느슨하게 'server[.]mjs' 로 매칭했다가 Codex 앱의 `node ./server.mjs` 를
  #   우발 종료한 적이 있다. 패턴에 반드시 $UI 또는 저장소 경로가 들어가야 한다.
  hit=0
  for f in server.mjs runner.mjs; do
    pkill -f -- "$UI/$f" 2>/dev/null && hit=1
    pkill -f "keyescape-devtools-unlock/ui/$f" 2>/dev/null && hit=1
    pkill -f "^node $f\$" 2>/dev/null && hit=1   # 예전 방식(cd ui && node server.mjs) 호환
  done
  [ "$hit" = 1 ] && ok 'UI 서버/사격 프로세스 종료' || info '종료할 UI 서버/사격 프로세스 없음'
  if [ "$KILLCHROME" = 1 ]; then
    if curl -sf --max-time 3 "$CDP/json/list" 2>/dev/null | grep -q 'booking\.naver\.com'; then
      bad "booking.naver 탭이 열려 있어 크롬 종료를 거부합니다 (진행 중인 예약 보호). 닫고 다시 실행하세요."
    else
      pkill -f -- "--user-data-dir=$PROFILE" 2>/dev/null && ok "격리 크롬 종료 ($PROFILE)" || info '격리 크롬 없음'
    fi
  else
    info '크롬은 유지했습니다 (전부 닫으려면: ./setup.sh --stop --chrome)'
  fi
  exit 0
fi

# ---------- 1) Node ----------
step "Node 런타임"
if command -v node >/dev/null 2>&1; then
  NV="$(node -v | tr -d 'v')"; MAJ="${NV%%.*}"
  if [ "$MAJ" -ge 22 ]; then ok "Node ${NV} (전역 WebSocket 사용 가능)"
  else bad "Node ${NV} 는 너무 오래됨 — 22 이상 필요. 설치는 brew install node@22 또는 https://nodejs.org"; fi
else
  if [ "$WITHNODE" = 1 ] && command -v brew >/dev/null 2>&1; then
    warn "Node 없음 → brew install node 시도"
    brew install node >/tmp/ke-node.log 2>&1 && ok "설치 완료: $(node -v 2>/dev/null || echo '재로그인 후 PATH 확인 필요')" \
      || bad "brew 설치 실패 (/tmp/ke-node.log)"
  else
    bad "Node 가 PATH 에 없습니다 — 설치 후 다시 실행 (mac: brew install node / https://nodejs.org)"
  fi
fi

# ---------- 2) Chrome ----------
step "Chrome"
CHROME_BIN=''
if [ -d "/Applications/Google Chrome.app" ]; then CHROME_BIN='open' ; ok "Google Chrome.app 발견"
elif command -v google-chrome >/dev/null 2>&1; then CHROME_BIN="$(command -v google-chrome)"; ok "google-chrome 발견"
elif command -v chromium >/dev/null 2>&1; then CHROME_BIN="$(command -v chromium)"; ok "chromium 발견"
elif command -v chromium-browser >/dev/null 2>&1; then CHROME_BIN="$(command -v chromium-browser)"; ok "chromium-browser 발견"
else bad "Chrome/Chromium 없음 — https://www.google.com/chrome 설치 후 재실행"; fi
launch_chrome() {
  # CHROME_ARGS: 컨테이너/서버 환경용 추가 플래그 (예: "--headless=new --no-sandbox --disable-gpu")
  local extra="${CHROME_ARGS:-}"
  if [ "$CHROME_BIN" = 'open' ]; then
    # shellcheck disable=SC2086
    open -na "Google Chrome" --args \
      --user-data-dir="$PROFILE" --remote-debugging-port="$CDP_PORT" \
      --no-first-run --no-default-browser-check $extra "$URL" >/dev/null 2>&1
  elif [ -n "$CHROME_BIN" ]; then
    # shellcheck disable=SC2086
    nohup "$CHROME_BIN" --user-data-dir="$PROFILE" --remote-debugging-port="$CDP_PORT" \
      --no-first-run --no-default-browser-check $extra "$URL" >/tmp/ke-chrome.log 2>&1 &
    disown 2>/dev/null || true
  fi
}

# ---------- 3) CDP ----------
step "CDP(원격 디버깅) 포트"
if up "$CDP/json/version"; then
  BR="$(curl -s --max-time 3 "$CDP/json/version" | tr -d '\n' | sed -E 's/.*"Browser": ?"([^"]+)".*/\1/')"
  ok "이미 실행 중 — $BR"
elif [ "$CHECK" = 1 ]; then
  warn "CDP 없음 (--check 이므로 기동하지 않음). 실행: ./setup.sh"
else
  warn "CDP 없음 → 격리 크롬 기동 시도"
  launch_chrome
  for _ in $(seq 1 40); do up "$CDP/json/version" && break; sleep 0.5; done
  if up "$CDP/json/version"; then ok "CDP 기동 완료"
  else
    bad "CDP 바인딩 실패 — 같은 프로필을 두 인스턴스가 점유한 경우: pkill -f -- '--user-data-dir=$PROFILE' 후 재실행"
  fi
fi

# ---------- 4) 사이트 ----------
step "keyescape 접속"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$URL")"
[ "$CODE" = "200" ] && ok "HTTP 200" || bad "HTTP ${CODE} — 네트워크/프록시/차단 확인"

# ---------- 5) UI 서버 ----------
step "UI 서버"
if up "$UIURL/api/log"; then
  ok "이미 실행 중 — $UIURL"
elif [ "$CHECK" = 1 ]; then
  warn "정지됨 (--check 이므로 기동하지 않음). 실행: ./setup.sh"
else
  info "node ui/server.mjs 백그라운드 기동 (로그: ui/server.out)"
  # 서브셸 & 가 아니라 이 셸에서 띄우고 disown 한다 — 안 그러면 스크립트가 자식을 추적하고 남는다
  PORT="$PORT" CDP_PORT="$CDP_PORT" nohup node "$UI/server.mjs" >"$UI/server.out" 2>&1 </dev/null &
  UIPID=$!
  disown 2>/dev/null || true
  sleep 2
  if up "$UIURL/api/log"; then ok "기동 완료 (pid $UIPID) — $UIURL"
  else bad "기동 실패 — $UI/server.out 확인"; fi
fi

# ---------- 6) 전제조건 정밀 검사 + DevTools 해제 ----------
step "전제조건 + DevTools 차단 해제"
if [ "$CHECK" = 1 ]; then
  (cd "$UI" && PORT="$PORT" CDP_PORT="$CDP_PORT" sh preflight.sh) || BAD=1
else
  (cd "$UI" && PORT="$PORT" CDP_PORT="$CDP_PORT" sh preflight.sh --fix) || BAD=1
fi

# ---------- 7) 브라우저 개방 ----------
step "화면 열기"
if [ "$CHECK" = 1 ]; then
  info "--check 모드: 열지 않았습니다. 준비되면 ./setup.sh"
elif [ "$(uname -s)" = "Darwin" ] && command -v open >/dev/null 2>&1; then
  open "$UIURL" >/dev/null 2>&1 && ok "$UIURL 개방" || info "브라우저에서 $UIURL 을 직접 여세요"
elif command -v xdg-open >/dev/null 2>&1 && xdg-open "$UIURL" >/dev/null 2>&1; then
  ok "$UIURL 개방 시도"
else
  # 리눅스 서버/컨테이너: Debian 의 /usr/bin/open 은 별개 프로그램이라 쓰지 않는다
  info "컨테이너/헤드리스 환경입니다 — 호 상태에서 브라우저로 $UIURL 을 여세요"
fi

echo
echo "==============================================="
if [ "$BAD" = 0 ]; then
  printf ' \033[32m준비 완료\033[0m  →  %s\n' "$UIURL"
  echo "   지점/테마/날짜/시간대를 고르고  [오픈 시각에 사격] → 브라우저에서 캡차+예약하기+결제"
else
  printf ' \033[33m일부 미충족\033[0m  위 ✘ 항목을 처리한 뒤 다시 ./setup.sh 를 실행하세요.'
  echo
fi
echo "   검사만      : ./setup.sh --check"
echo "   종료        : ./setup.sh --stop        (크롬까지: --stop --chrome)"
echo "   다른 포트    : PORT=9000 CDP_PORT=9333 ./setup.sh"
echo "==============================================="
exit "$BAD"

