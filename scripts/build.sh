#!/usr/bin/env bash
# Run from any directory: /path/to/project/scripts/build.sh [all|mac|win]
set -euo pipefail

usage() {
  cat <<'EOF'
사용법: ./scripts/build.sh [all|mac|win]

  all   macOS (Apple Silicon + Intel) 및 Windows 64비트 ZIP 빌드 (기본값)
  mac   macOS ZIP 두 종류 빌드
  win   Windows 64비트 ZIP 빌드

Node.js 22 이상과 npm이 필요합니다. mac/all은 Mac에서 실행하세요.
의존성 설치 → 로컬 테스트 → 빌드 순서로 진행하며 결과는 dist/에 저장합니다.
GitHub 릴리즈 업로드는 수행하지 않습니다.
EOF
}

if [[ $# -gt 1 ]]; then usage >&2; exit 64; fi
target="${1:-all}"
case "$target" in
  -h|--help) usage; exit 0 ;;
  all|mac|win) ;;
  *) usage >&2; exit 64 ;;
esac

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' 'Node.js 22 이상과 npm을 설치한 뒤 다시 실행하세요.' >&2
  exit 1
fi
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node.js 22 이상이 필요합니다."); process.exit(1); }'
if [[ "$target" != win && "$(uname -s)" != Darwin ]]; then
  printf '%s\n' 'macOS 빌드는 Mac에서 실행하세요. Windows만 빌드하려면: ./scripts/build.sh win' >&2
  exit 1
fi

printf '\n%s\n' '[1/3] 잠금 파일 기준으로 빌드 의존성을 설치합니다.'
npm ci --include=dev

printf '\n%s\n' '[2/3] 문법과 로컬 테스트를 실행합니다.'
npm test

printf '\n%s\n' '[3/3] 앱을 빌드합니다.'
if [[ "$target" == all || "$target" == mac ]]; then
  npm run build:mac -- --publish never
fi
if [[ "$target" == all || "$target" == win ]]; then
  npm run build:win -- --publish never
fi

printf '\n빌드 완료: %s/dist/\n' "$project_root"
