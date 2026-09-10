# 예약도우미 데스크톱 앱

macOS와 Windows용 독립 창 앱입니다. Node는 앱에 포함되며, 예약 페이지를 열 Google Chrome 또는 Microsoft Edge는 별도로 설치되어 있어야 합니다.

## 실행

- Apple Silicon Mac: `Kkul-Escape-1.0.0-mac-arm64.zip` 압축 해제 → `예약도우미.app`을 응용 프로그램 폴더로 옮겨 실행.
- Intel Mac: `Kkul-Escape-1.0.0-mac-x64.zip` 사용.
- Windows 64비트: `Kkul-Escape-1.0.0-win-x64.zip`을 폴더에 **전부** 압축 해제 → `예약도우미.exe` 실행. 바로가기를 만들어 사용할 수 있는 포터블 배포입니다.

현재 빌드는 개발자 서명·Apple 공증이 없는 로컬 배포본입니다. 다른 컴퓨터로 전달하면 macOS Gatekeeper 또는 Windows 보안 확인이 표시될 수 있습니다. macOS에서는 신뢰하는 빌드에 한해 시스템 설정 → 개인정보 보호 및 보안에서 실행을 허용할 수 있습니다.

앱은 서버를 `127.0.0.1:18899`에서 실행합니다. 이 포트가 이미 사용 중이면 기존 서버를 재사용하지 않고 오류를 표시합니다. 예약용 브라우저는 앱 전용 프로필과 자동 할당 디버깅 포트를 사용합니다. 앱 종료 시 예약 대기와 앱 서버는 중단되지만, 캡차·결제 화면을 보호하기 위해 예약용 브라우저는 유지합니다. 브라우저를 직접 닫을 수 있습니다.

캡차는 사용자가 직접 처리합니다. 기존 자동 제출 옵션과 예약 엔진의 검증 동작은 그대로 사용합니다.

## 데이터 위치

도움말 → **앱 데이터 폴더 열기**에서 확인합니다.

- macOS: `~/Library/Application Support/kkul-escape/`
- Windows: `%APPDATA%/kkul-escape/`

예약자 입력은 앱의 로컬 저장소에, 로그는 `desktop.log`와 `runtime/ui/runs.log`에 저장됩니다. 예약용 Chrome 프로필은 `booking-browser/`에 저장됩니다. 기존 브라우저에 입력했던 개인정보는 자동으로 가져오지 않으므로 첫 실행에서 입력하세요. 앱 데이터와 로그에는 개인정보가 포함될 수 있으므로 배포 파일에 넣지 않습니다.

## 개발·빌드

빌드에는 Node와 npm이 필요합니다. 일반 앱 사용자에게는 필요하지 않습니다.

```sh
npm ci
npm start
npm run test:desktop
npm run build:mac
npm run build:win
```

결과는 `dist/`에 생성됩니다. macOS 빌드는 Mac에서 실행하세요. Windows ZIP은 Mac에서도 만들 수 있으며, 실제 Windows 실행 검증은 Windows 환경에서 수행해야 합니다.

macOS는 한글 이름으로 인한 시작 충돌을 막기 위해 `build.mac.extendInfo.CFBundleName`을 `productName`의 NFD 형식으로 설정합니다. 이름을 바꿀 때 이 값도 함께 갱신해야 합니다. `identity: "-"`는 로컬 ad-hoc 서명이며 개발자 인증서 서명·공증은 아닙니다. 빌드 후 실제 `.app`에 `--desktop-smoke`를 전달해 실행을 확인하세요.

`electron . --desktop-smoke`는 실제 예약 사이트·예약 브라우저를 열지 않고, 임시 데이터 폴더와 임의 포트에서 앱 화면 로딩 및 Node 격리를 검사합니다. 화면의 초기 조회 요청은 기존 UI 동작대로 발생할 수 있지만 예약 실행은 하지 않습니다.
