#!/usr/bin/env bash
# 전제조건 검사 + (선택) DevTools 차단 해제까지 한 번에
#
#   sh preflight.sh          검사만 (아무것도 건드리지 않음)
#   sh preflight.sh --fix    필요한 것을 자동으로 켜고 해제까지 실행
#
# 검사 항목
#   1) Node >= 22            (전역 WebSocket 때문에 22 미만은 즉시 죽음)
#   2) Google Chrome 설치    (mac 기준)
#   3) CDP 포트             :9222 (CDP_PORT 로 변경 가능)
#   4) keyescape 접속        : reservation1.php HTTP 200
#   5) UI 서버               :8899
#   6) DevTools 차단 3종     : 디텍터 더미 / 우클릭 / F12  ← keyescape 탭이 있을 때만
#
# --fix 동작
#   CDP 없으면   : ../unlock.sh 가 격리 크롬(/tmp/keyescape-chrome-profile) 을 띄우고 주입
#   탭은 있는데 차단이면 : ../unlock.mjs 로 재주입 (멱등, 새로고침 후에도 재실행 안전)
#   UI 서버 없으면       : node server.mjs 를 백그라운드로 기동
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8899}"
CDP_PORT="${CDP_PORT:-9222}"
FIX=0; for a in "$@"; do [ "$a" = "--fix" ] && FIX=1; done
FAIL=0
ok()   { printf '  \033[32m✔\033[0m %-16s %s\n' "$1" "$2"; }
warn() { printf '  \033[33m!\033[0m %-16s %s\n' "$1" "$2"; }
bad()  { printf '  \033[31m✘\033[0m %-16s %s\n' "$1" "$2"; FAIL=1; }

echo "== 예약도우미 전제조건 검사 (CDP:$CDP_PORT / UI:$PORT) =="

# 1) Node
if command -v node >/dev/null 2>&1; then
  NV=$(node -v | tr -d 'v'); MAJ=${NV%%.*}
  if [ "$MAJ" -ge 22 ]; then ok "Node" "$NV"
  elif [ "$MAJ" -ge 21 ]; then warn "Node" "$NV (21 은 --experimental-websocket 이 필요할 수 있음)"
  else bad "Node" "$NV — 22 이상 필요 (전역 WebSocket 없음)"; fi
else bad "Node" "없음 — https://nodejs.org LTS 설치"; fi

# 2) Chrome / Chromium  (mac · Linux · 컨테이너 모두)
CHROME_FOUND=""
if [ -d "/Applications/Google Chrome.app" ]; then
  CHROME_FOUND="/Applications/Google Chrome.app"
else
  for b in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge; do
    if command -v "$b" >/dev/null 2>&1; then
      CHROME_FOUND="$(command -v "$b") — $("$b" --version 2>/dev/null | head -1)"
      break
    fi
  done
fi
if [ -n "$CHROME_FOUND" ]; then ok "Chrome" "$CHROME_FOUND"
else warn "Chrome" "표준 경로/PATH 에 없음 — CDP 되는 Chromium 이면 다른 것도 가능"; fi

# 3) CDP
if ! curl -sf --max-time 3 "http://127.0.0.1:${CDP_PORT}/json/version" >/dev/null 2>&1; then
  if [ "$FIX" = 1 ]; then
    if [ -d "/Applications/Google Chrome.app" ]; then
      warn "CDP :$CDP_PORT" "없음 → ../unlock.sh 로 격리 크롬 기동 시도"
      (cd "$DIR/.." && CDP_PORT="$CDP_PORT" ./unlock.sh >/tmp/ke-unlock.log 2>&1)
      tail -3 /tmp/ke-unlock.log | sed 's/^/      /'
    else
      # mac 이 아니면(리눅스/컨테이너) unlock.sh(open -na) 가 못 뜬다 → 직접 기동
      BIN=""
      for b in google-chrome google-chrome-stable chromium chromium-browser; do
        command -v "$b" >/dev/null 2>&1 && { BIN="$(command -v "$b")"; break; }
      done
      if [ -n "$BIN" ]; then
        warn "CDP :$CDP_PORT" "없음 → $BIN 을 격리 프로필로 기동"
        nohup "$BIN" --user-data-dir="${KEYESCAPE_PROFILE:-/tmp/keyescape-chrome-profile}" \
          --remote-debugging-port="$CDP_PORT" --no-first-run --no-default-browser-check \
          ${CHROME_ARGS:---headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage} \
          >/tmp/ke-chrome.log 2>&1 </dev/null &
        disown 2>/dev/null || true
        for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
          curl -sf --max-time 2 "http://127.0.0.1:${CDP_PORT}/json/version" >/dev/null 2>&1 && break
          sleep 0.5
        done
      else
        warn "CDP :$CDP_PORT" "기동할 Chromium 바이너리가 PATH 에 없음"
      fi
    fi
  fi
  if curl -sf --max-time 3 "http://127.0.0.1:${CDP_PORT}/json/version" >/dev/null 2>&1; then
    ok "CDP :$CDP_PORT" "기동됨"
  else
    bad "CDP :$CDP_PORT" "응답 없음 — 예약 실행 불가(조회만). 같은 프로필 점유 시 pkill -f -- '--user-data-dir=/tmp/keyescape-chrome-profile'"
  fi
else
  BR=$(curl -s --max-time 3 "http://127.0.0.1:${CDP_PORT}/json/version" | tr -d '\n' | sed -E 's/.*"Browser": ?"([^"]+)".*/\1/')
  ok "CDP :$CDP_PORT" "$BR"
fi

# 4) 사이트
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://www.keyescape.com/reservation1.php)
[ "$CODE" = "200" ] && ok "keyescape" "HTTP 200" || bad "keyescape" "HTTP $CODE — 네트워크/차단 확인"

# 5) UI 서버
if curl -sf --max-time 3 "http://127.0.0.1:${PORT}/api/log" >/dev/null 2>&1; then
  ok "UI server" "실행 중 → http://127.0.0.1:${PORT}/"
else
  if [ "$FIX" = 1 ]; then
    warn "UI server" "없음 → 백그라운드 기동"
    PORT="$PORT" CDP_PORT="$CDP_PORT" nohup node "$DIR/server.mjs" >"$DIR/server.out" 2>&1 </dev/null &
    disown 2>/dev/null || true
    sleep 2
  fi
  if curl -sf --max-time 3 "http://127.0.0.1:${PORT}/api/log" >/dev/null 2>&1; then ok "UI server" "기동됨"
  else warn "UI server" "정지 — sh ui.sh 로 기동 필요"; fi
fi

# 6) DevTools 차단 3종
if curl -sf --max-time 3 "http://127.0.0.1:${CDP_PORT}/json/version" >/dev/null 2>&1; then
  ST=$(CDP_PORT="$CDP_PORT" node "$DIR/unlock-status.mjs" "$CDP_PORT" 2>/dev/null); RC=$?
  if [ "$RC" = "2" ] && [ "$FIX" = 1 ]; then
    warn "DevTools 차단" "차단된 탭 있음 → 재주입 + 새로고침"
    (cd "$DIR/.." && CDP_PORT="$CDP_PORT" node unlock.mjs --quiet --reload >/tmp/ke-unlock2.log 2>&1)
    # 새로고침 후 document_start 주입이 사이트 스크립트보다 먼저 도는 것을 확인까지 대기한다 (고정 sleep 은 레이스를 만든다)
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      sleep 3
      ST=$(CDP_PORT="$CDP_PORT" node "$DIR/unlock-status.mjs" "$CDP_PORT" 2>/dev/null); RC=$?
      [ "$RC" = "0" ] && break
    done
  fi
  CNT=$(printf '%s' "$ST" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.count)}catch{console.log(0)}})')
  if [ "$CNT" = "0" ]; then
    ok "DevTools" "keyescape 탭 없음 (예약 시점에 자동 주입됨)"
  elif [ "$RC" = "0" ]; then
    ok "DevTools" "${CNT}개 탭 모두 해제 (디텍터/우클릭/F12)"
  else
    bad "DevTools" "${CNT}개 탭 중 일부 미해제 → sh preflight.sh --fix"
    printf '%s\n' "$ST" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s).tabs.forEach(t=>console.log("      ", t.unlocked?"O":"X", (t.url||"").slice(0,58), t.error||((t.dummy?"디텍터O":"디텍터X")+" "+(t.ctxOpen?"우클릭O":"우클릭X")+" "+t.keyBlock+(t.wiped?" 검은화면":""))))}catch{}})'
  fi
else
  warn "DevTools" "CDP 없어서 검사 불가"
fi

echo
if [ "$FAIL" = 0 ]; then
  echo "  → 준비 완료.  http://127.0.0.1:${PORT}/"
  echo "    (예약 확정은 브라우저에서 reCAPTCHA 체크 + '예약하기' 클릭 후 결제)"
else
  echo "  → 미충족 항목이 있습니다. 자동 해결은:  sh preflight.sh --fix"
fi
exit "$FAIL"
