# 예약도우미 — 컨테이너 이미지 (linux/arm64·amd64)
#
#   docker build -t keyescape-ui .
#   docker run --rm keyescape-ui --check        # 전제조건 검사만
#   docker run --rm keyescape-ui selftest       # 설치 테스트 묶음
#   docker run --rm -p 8898:8899 keyescape-ui   # 헤드리스 크롬 + CDP + UI 서빙
#
# npm 설치 없음. Node 22 + Chromium + CDP 로 구성되는 완전 로컬 스택.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PORT=8899 \
    CDP_PORT=9222 \
    BIND=0.0.0.0 \
    KEYESCAPE_PROFILE=/tmp/keyescape-chrome-profile \
    CHROME_ARGS="--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage"

# chromium: CDP 대상 / fonts-noto-cjk: 한글 렌더링 / procps: pgrep-pkill
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium fonts-noto-cjk ca-certificates curl procps \
 && rm -rf /var/lib/apt/lists/* \
 && chromium --version

WORKDIR /app
COPY . /app

# 빌드 게이트: 모든 mjs 문법검사 + 셸 문법검사 + 실행권한
RUN sh -c 'set -e; \
      for f in *.mjs ui/*.mjs scripts/docker/*.mjs; do [ -e "$f" ] && node --check "$f"; done; \
      for f in setup.sh scripts/docker/docker-entrypoint.sh scripts/docker/docker-selftest.sh ui/*.sh; do [ -e "$f" ] && bash -n "$f" && chmod +x "$f"; done; \
      chmod +x setup.sh scripts/docker/docker-entrypoint.sh scripts/docker/docker-selftest.sh 2>/dev/null || true'

EXPOSE 8899
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -sf "http://127.0.0.1:${PORT}/api/log" >/dev/null || exit 1

ENTRYPOINT ["/app/scripts/docker/docker-entrypoint.sh"]
CMD ["serve"]
