# 소스 구조

| 위치 | 용도 |
| --- | --- |
| `desktop/` | Electron 앱, 아이콘, 앱 시작·패키지 테스트 |
| `ui/` | 웹 화면, 로컬 서버, 사이트별 예약 엔진 |
| `ui/tests/` | 예약 검증 테스트와 오프라인 HTML 픽스처 |
| `ext/`, `unlock.mjs` | 실행 중 사용하는 브라우저 확장·초기화 |
| `scripts/` | 소스 검사와 Docker 실행·검사 도구 |
| `tools/legacy/` | 초기 실험·진단 스크립트와 과거 조사 데이터 |
| `docs/` | 개발 안내와 Windows 실행 안내 |
| `.local/legacy/` | 기존 로그·스크린샷 보관, Git·배포 제외 |
| `dist/` | 빌드된 macOS·Windows 앱, Git 제외 |

루트의 `setup.sh`, `setup.ps1`, `setup.bat`, `unlock.sh`는 기존 실행 진입점입니다.
루트 README는 사용자 요청에 따라 비워 둡니다. 작업 기록은 루트 `MEMORY.md`를 참고합니다.

## 실행·검증

```sh
npm ci
npm start                 # 데스크톱 앱
npm run start:ui          # 웹 UI 서버
npm run check             # JS·인라인 JS·셸 문법 검사 (예약 실행 없음)
npm test                  # 문법 + 앱 런타임 + 제로월드 제출 게이트 테스트
npm run test:browser      # CDP 브라우저가 필요한 기존 픽스처 테스트
npm run build:mac
npm run build:win
```

`npm test`의 앱 테스트는 임시 로컬 서버를 사용합니다. `test:browser`는 테스트용
브라우저의 CDP 9222 포트가 필요합니다. 실제 사이트 예약 동작은 검사하지 않습니다.

Docker 명령은 루트에서 `docker compose up --build`를 사용합니다.
컨테이너 내부 진단은 `bash /app/scripts/docker/docker-selftest.sh`입니다.
Docker 진단은 실제 사이트에 조회 요청을 하므로 오프라인 검사와 별개입니다.

앱 배포에는 `package.json`의 `extraResources`와 `desktop/runtime.cjs`의 허용 목록이
사용됩니다. 런타임 파일을 추가하면 두 목록을 함께 확인해야 합니다.
실험 도구·개인 설정·로그는 앱이나 Docker 이미지에 넣지 않습니다.

Windows 실행: [WINDOWS.md](WINDOWS.md) · 앱 배포: [desktop/README.md](../desktop/README.md)
· 예약 엔진: [ui/README.md](../ui/README.md)
