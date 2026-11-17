# Windows 에서 돌리기 위한 전제조건

## 0. 한 방 설치 (권장) — `setup.bat`

수동 설정 없이 이 폴더의 **`setup.bat` 를 더블클릭**하면 된다(PowerShell 이 직접 실행하면 `.\setup.ps1`).

```bat
setup.bat                       :: 검사 → 부족한 것 자동 구성 → 차단 해제 → UI 기동 → 화면 열기
setup.bat -Check                :: 검사만
setup.bat -Stop                 :: UI 서버/예약 프로세스만 종료
setup.bat -Stop -Chrome         :: 격리 크롬까지 종료 (booking.naver 탭이 열려 있으면 거부)
setup.bat -Shortcut             :: 바탕화면 바로가기
setup.bat -Port 9000 -CdpPort 9333
```

`setup.ps1` 이 하는 일(아래 1~4장을 자동화한 것이다):
Node 22 확인 → Chrome/Edge 경로 탐지 → `%TEMP%\keyescape-chrome-profile` 격리 프로필로
`--remote-debugging-port` 크롬 기동 → keyescape 접속 확인 → `ui\run-server.cmd` 로 UI 서버 기동
→ `ui\unlock-status.mjs` 로 차단 3종 감지 + 필요 시 `unlock.mjs` 재주입 → UI 브라우저 개방.

> 한글이 깨져 보이면 `chcp 65001` 후 실행하거나 PowerShell 7(pwsh) 를 쓰세요.
> `setup.ps1` 은 UTF-8 BOM 으로 저장돼 있어 Windows PowerShell 5.1 도 한글을 바로 읽는다.

아래는 스크립트를 안 쓰고 맨손으로 할 때의 참고다.

---

결론부터: **실제 로직은 이미 크로스플랫폼**이고, mac 전용인 것은 셸 래퍼뿐이었다.

| 파일 | Windows 호환 | 이유 |
|---|---|---|
| `unlock.mjs` | ✅ 그대로 동작 | `node:fs/path/url` + `fetch` + `WebSocket` + CDP 만 사용. 경로도 `path.join` |
| `ext/` (manifest + inject) | ✅ 그대로 | 확장이라 OS 무관. 오히려 Windows에선 이쪽이 제일 견고 |
| `rescue.js` | ✅ 그대로 | 콘솔에 붙여넣는 코드 |
| `unlock.sh` / `tools/legacy/start.sh` | ❌ → **`setup.ps1`/`setup.bat` 으로 대체됨** | `#!/usr/bin/env bash`, `open -na "Google Chrome"`, `/Applications/Google Chrome.app/...`, `/tmp/...`, `pgrep/pkill` 등 mac 전용. Windows 는 `setup.ps1` 이 같은 역할 |
| `ui/ui.sh` / `ui/preflight.sh` | ❌ → **`setup.bat` 이 대체** | 같은 검사/기동 로직을 PowerShell 로 옮긴 것이 `setup.ps1`. 로직(server/runner/lib/unlock-status) 은 ✅ 그대로 |
| `reserve-fast.mjs` 등 예약 스크립트 | ✅ 그대로 | 역시 Node + CDP |

## 1. Node.js 22 이상 (가장 많이 걸리는 지점)

`unlock.mjs` 는 전역 `WebSocket` 을 쓴다. Node 공식 문서 기준:

```
Class: WebSocket   Added in: v21.0.0, v20.10.0
  v22.0.0  No longer behind --experimental-websocket CLI flag.
  v22.4.0  No longer experimental.
```

즉 **Node 22 미만이면 `WebSocket is not defined` 로 즉시 죽는다** (Node 20 은 플래그를 줘도 실험 단계).
나머지 의존 API 는 더 낮은 버전부터 있다: `fetch` v18.0.0, `AbortSignal.timeout` v17.3.0.

```powershell
node -v        # v22.x 이상 확인  (모르면 https://nodejs.org LTS 설치)
```

## 2. Chrome

- **격리 `--user-data-dir` 가 필수**다. Chrome 136+ 는 **기본 프로필에서는 `--remote-debugging-port` 를 거부**하는데 이건 Windows 도 동일하다.
  → `%TEMP%\keyescape-chrome-profile` 처럼 다른 폴더를 쓰면 **평소 쓰는 Chrome 을 켜둔 채로 병렬 실행 가능**하다.
- 단, **같은 프로필 폴더를 두 인스턴스가 동시에 점유하면 CDP 포트가 뜨지 않는다.** 그 경우:
  ```powershell
  taskkill /IM chrome.exe /F      # (mac 의 pkill 에 해당)
  ```
- CDP 는 `127.0.0.1` 에만 바인딩되므로 방화벽 진입점은 보통 없다. 대신 **회사 관리형 PC** 의 GPO
  `RemoteDebuggingAllowed = false` 를 만나면 CDP 경로 자체가 막힐 수 있다 → 이 경우 **확장 수동 설치(아래 4번)로 우회** 가능(CDP·Node 불필요).

## 3. 셸

- PowerShell/cmd 만 쓸 거면 추가 설치 없음(아래 2줄 실행).
- `./unlock.sh` 를 그대로 돌리려면 Git Bash 또는 WSL 이 필요하고, **개행이 LF여야** 한다.
  zip/git 복사 과정에서 CRLF 로 바뀌면 `bash\r: No such file or directory` 류 오류가 난다
  (`git config core.autocrlf input` 또는 `.gitattributes` 의 `*.sh text eol=lf`).
- PowerShell 5.1 콘솔은 기본 코드페이지가 CP949 라 스크립트의 한글 출력이 깨질 수 있다 → `chcp 65001` 또는 PowerShell 7.

## 4. 스크립트 없이 쓰는 최소 절차 (Windows, 권장)

```powershell
# 1) 격리 크롬 기동 (이 창이 열려 있는 동안 CDP 사용 가능)
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --user-data-dir="$env:TEMP\keyescape-chrome-profile" `
  --remote-debugging-port=9222 --no-first-run --no-default-browser-check `
  "https://www.keyescape.com/reservation1.php?zizum_num=18&theme_num=57&theme_info_num=34"

# 2) 해제 + 검증 (이게 unlock.sh 의 실제 몸통)
node .\unlock.mjs https://www.keyescape.com/
```

CDP 를 아예 안 쓰는 영구 방식(가장 견고):

1. `chrome://extensions` 이동
2. 우측 상단 **개발자 모드** 켜기
3. **압축 해제된 확장 프로그램** → 이 폴더의 `ext/` 지정
4. 크롬 재시작·새로고침과 무관하게 계속 해제 유지 (Node 불필요)

## 5. mac 명령 ↔ Windows 명령 대응표

| 용도 | mac (현재 스크립트) | Windows |
|---|---|---|
| 크롬 분리 기동 | `open -na "Google Chrome" --args ...` | `& "C:\Program Files\Google\Chrome\Application\chrome.exe" --args에 해당하는 인자 직접 전달` |
| CDP 건강 확인 | `curl -s http://127.0.0.1:9222/json/version` | `curl.exe -s http://127.0.0.1:9222/json/version` (Win10 1803+ 내장) |
| 실행기 종료 | `pkill -f reserve-fast.mjs` | `Get-Process node \| Where-Object {$_.Path -like '*'} \| Stop-Process` 또는 `taskkill /IM node.exe /F` |
| 크롬 강제 종료 | `pkill -f -- '--user-data-dir=...'` | `taskkill /IM chrome.exe /F` |
| 슬립 방지 | `caffeinate -disu -t 3600` | `powercfg /change standby-timeout-ac 0` (또는 설정에서 잠금 해제) |
| 격리 프로필 기본값 | `/tmp/keyescape-chrome-profile` | `$env:TEMP\keyescape-chrome-profile` |

## 6. 예약 대기(reserve-fast.mjs)를 Windows 에서 돌릴 때 추가 확인

- 위 Node 22 / CDP 조건에 더해, **10:30 에 PC가 깨어 있어야** 한다. 위 표의 `powercfg` 로 대기 전환을 끄고,
  브라우저 창도 최소화하지 두지 않는 편이 안전하다(일부 GPU 절감 정책에서 백그라운드 탭 타이머가 느려진다).
- `OPEN_AT` 은 그대로 `2026-09-05T10:30:00+09:00` 형태(KST 오프셋 명시) 를 쓰면 로컬 타임존 설정과 무관하다.
- 시간 동기화가 안 된 PC면 서버와 수백 ms 차이가 날 수 있으니 `w32tm /resync` 로 맞춰두면 좋다.

## 7. 배포 ZIP 실행 스모크 (예약·결제 없음)

Windows에서 Node.js 22 이상을 설치한 뒤, 빌드한 ZIP을 **새 폴더**에 풀고 실행한다.
개발용 `electron .` 또는 `dist/win-unpacked` 대신 ZIP 안의 실행 파일을 검증한다.

```powershell
npm ci
npm run build:win -- --publish never
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
Expand-Archive "dist/Kkul-Escape-$version-win-x64.zip" "$env:TEMP/kkul smoke" -Force
npm run test:desktop:win -- "$env:TEMP/kkul smoke/예약도우미.exe"
```

- `--desktop-smoke`로 EXE를 직접 실행하고 최대 90초 기다린다. 정상 종료(코드 0)와
  정확히 한 번 출력된 `DESKTOP_SMOKE_OK` JSON을 모두 요구한다.
- JSON의 화면 제목, 입력 요소, 네이버 기본 테마, Node 비노출, 브라우저 재연결 IPC를 검사한다.
  재연결은 더미 포트 1을 사용하며 실제 Chrome/Edge 연결 복구를 검증하는 것은 아니다.
- 렌더러 오류/크래시, 페이지 로딩 실패, 오류 마커, 성공 결과 누락, 비정상 종료,
  시간 초과는 실패한다. 시간 초과 시 해당 EXE의 프로세스 트리만 종료한다.
- 매번 임시 userData를 사용하고 테스트 후 삭제한다. 사용자 예약 정보나 로그인 프로필을
  읽지 않는다. 스모크 서버는 예약 실행·브라우저 열기·변경 요청을 차단하고,
  무통장입금 옵션을 끈다. 읽기 전용 상품/사이트 데이터 요청은 발생할 수 있다.
- `.local/desktop-smoke/`에 stdout/stderr, 백엔드 로그와 `result.json`을 남긴다.
  다른 로그 폴더는 EXE 경로 다음 인자로 지정한다. `ELECTRON_RUN_AS_NODE`,
  `NODE_OPTIONS`, `NODE_PATH`는 자식 실행 환경에서 제거한다.
- `.github/workflows/windows-desktop-smoke.yml`은 PR, main push, v 태그 push,
  수동 실행에서 Windows x64 ZIP을 빌드·압축 해제·실행하고 진단 로그를 14일 보관한다.
  배포 업로드나 예약 제출은 수행하지 않는다. CI 성공은 해당 커밋에서 새로 빌드한 ZIP에
  대한 결과이며, 기존 v1.3.0 릴리스 자산의 실행 검증 결과를 소급해서 의미하지 않는다.
