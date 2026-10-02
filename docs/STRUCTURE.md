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

의존성 설치·로컬 테스트·빌드를 한 번에 실행하려면:

```sh
./scripts/build.sh       # Mac에서 macOS 두 종류 + Windows ZIP 빌드
./scripts/build.sh mac   # macOS만
./scripts/build.sh win   # Windows만
```

다른 작업 디렉터리에서도 스크립트 경로를 지정해 실행할 수 있습니다.
결과는 `dist/`에 저장되며 GitHub에는 자동 업로드하지 않습니다.

`npm test`의 앱 테스트는 임시 로컬 서버를 사용합니다. `test:browser`는 테스트용
브라우저의 CDP 9222 포트가 필요합니다. 실제 사이트 예약 동작은 검사하지 않습니다.

Docker 명령은 루트에서 `docker compose up --build`를 사용합니다.
컨테이너 내부 진단은 `bash /app/scripts/docker/docker-selftest.sh`입니다.
Docker 진단은 실제 사이트에 조회 요청을 하므로 오프라인 검사와 별개입니다.

앱 배포에는 `package.json`의 `extraResources`와 `desktop/runtime.cjs`의 허용 목록이
사용됩니다. 런타임 파일을 추가하면 두 목록을 함께 확인해야 합니다.
실험 도구·개인 설정·로그는 앱이나 Docker 이미지에 넣지 않습니다.

## 사이트 어댑터

| 파일 | 대상 사이트 |
| --- | --- |
| `ui/lib.mjs` | 키이스케이프(`www.keyescape.com`) — 예약창 + reservation2 · reCAPTCHA 체크박스 자동 클릭 |
| `ui/zw.mjs` | 제로월드(`zeroworldkorea.com`) — 자동입력방지 코드는 사람이 입력 |
| `ui/naver.mjs` | 네이버 예약 단편선(동시대를 씹다) + 무통장입금 게이트 |
| `ui/rhe.mjs` | 방탈출 토끼굴 홍대(`rabbitholeescape.co.kr`) · 지구별(`지구별.com`, 같은 템플릿 `tonySite`) — 예약 화면의 시간 버튼을 누르고 신청서를 채운다. 최종 '예약하기'(예약 생성 + 가상계좌 발급) 는 사람 클릭 |
| `ui/pagetoday.mjs` | 오늘의 한 페이지 강남(`page-today.co.kr`) — 예약 API 카탈로그 조회, 화면 버튼으로 03 확인까지 진행 (`예약 확정` 은 사람) |
| `ui/oasis.mjs` | 오아시스 뮤지엄 홍대(`oasismuseum.com/ticket`) — 날짜 화면 + 마감 목록 조회, 시간 버튼과 정보 입력·동의 (`예약하기` 는 사람) |
| `ui/unlock-pages.mjs` | 각 화면에 삽입하는 디버거 해제 스크립트 (토끼굴은 차단이 없어 쓰지 않는다) |
| `ui/sites.mjs` · `ui/runner.mjs` | 사이트 목록·API 분기와 CDP 실행기 — 새 사이트는 여기 두 곳을 함께 고친다 |

Windows 실행: [WINDOWS.md](WINDOWS.md) · 앱 배포: [desktop/README.md](../desktop/README.md)
· 예약 엔진: [ui/README.md](../ui/README.md)

## 앱 화면

- `ui/public/index.html`, `guided.css`, `guided.js`: 기본 단계별 화면.
- `ui/public/classic.html`: 기존 디자인 화면.
- `ui/public/app.js`: 두 화면이 공유하는 조회·예약·자동입력 설정.
- `ui/tests/guided-ui-test.mjs`: 로컬 API 픽스처로 다섯 사이트(키이스케이프·제로월드·단편선·네이버·토끼굴)의 실행·중단·전환 검증.
- `ui/tests/rhe-test.mjs` + `ui/tests/fixture-rhe-{reservation,create}.html`: 토끼굴 예약 화면 파싱, 시간 버튼 클릭 게이트, 신청서 입력기, 롤링 창(D-7) 오픈 안내를 오프라인으로 검증.
- `ui/tests/sites-form-test.mjs`: 지구별 파싱·지점별 창, 오늘의 한 페이지 카탈로그·03 확인에서 멈춤(예약 확정 미클릭), 오아시스 파싱·마감 목록·시간 버튼 게이트·입력기(예약하기 미클릭).
- `.local/backups/classic-1.0.1/`: 이전 디자인 ZIP과 원본 HTML, Git·배포 제외.
