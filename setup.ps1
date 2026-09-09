<#
  키이스케이프 예약 사격대 - 원샷 설치/기동 (Windows)

  사용법
    setup.bat                     더블클릭 실행 (검사 -> 부족한 것 자동 구성 -> DevTools 해제 -> UI 기동 -> 브라우저)
    .\setup.ps1                  同上 (PowerShell 에서)
    .\setup.ps1 -Check            검사만 (아무것도 켜지 않음)
    .\setup.ps1 -Stop             UI 서버/사격 프로세스만 종료 (크롬 유지)
    .\setup.ps1 -Stop -Chrome     크롬까지 종료 (booking.naver 탭이 있으면 거부 = 다른 예약 보호)
    .\setup.ps1 -Port 9000 -CdpPort 9333     포트 지정 (다른 작업과 병렬 시 격리 권장)

  필요 조건은 Node.js 22 이상 + Chrome 뿐입니다. npm 설치는 필요 없습니다.
  한글이 깨지면: chcp 65001  또는 PowerShell 7(pwsh) 사용.
#>
param(
  [switch]$Check,
  [switch]$Stop,
  [switch]$Chrome,
  [switch]$Shortcut,
  [int]$Port = 8899,
  [int]$CdpPort = 9222,
  [string]$Profile = "$env:TEMP\keyescape-chrome-profile",
  [string]$Url = 'https://www.keyescape.com/reservation1.php'
)
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Ui = Join-Path $Root 'ui'
$Cdp = "http://127.0.0.1:$CdpPort"
$UiUrl = "http://127.0.0.1:$Port"
$script:N = 0
$script:Bad = 0

function Step([string]$m) { $script:N = $script:N + 1; Write-Host ""; Write-Host "[$script:N] $m" -ForegroundColor White }
function Ok([string]$m)   { Write-Host "    [ OK ] $m" -ForegroundColor Green }
function Info([string]$m) { Write-Host "    ·      $m" -ForegroundColor DarkGray }
function Warn([string]$m) { Write-Host "    [ !  ] $m" -ForegroundColor Yellow }
function Bad([string]$m)  { Write-Host "    [ X  ] $m" -ForegroundColor Red; $script:Bad = $script:Bad + 1 }

function Test-Up([string]$u) {
  try { (Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 3).StatusCode -eq 200 } catch { $false }
}
function Get-Json([string]$u) {
  try { (Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 4).Content | ConvertFrom-Json } catch { $null }
}
function Find-Chrome {
  $c = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($p in $c) { if (Test-Path $p) { return $p } }
  return $null
}

Write-Host "==============================================="
Write-Host " 키이스케이프 예약 사격대 설치  (CDP:$CdpPort / UI:$Port)"
Write-Host "==============================================="

# ---------- 종료 모드 ----------
if ($Stop) {
  Step "실행 중인 것 종료"
  $script:killed = 0
  try {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
      $cl = $_.CommandLine
      # ★ 이 프로젝트 경로(ui 서버/러너)만 종료한다. 같은 이름의 무관한 node 를 죽이면 안 된다.
      if ($cl -and $cl -match [regex]::Escape($Ui) -and $cl -match 'server\.mjs|runner\.mjs') {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        # ForEach-Object 블록은 자식 스코프라서 $killed++ 로는 바깥 값이 안 늘어난다 → $script:
        $script:killed = $script:killed + 1
      }
    }
  } catch { Warn "프로세스 조회 실패: $($_.Exception.Message)" }
  if ($script:killed -gt 0) { Ok "UI 서버/사격 프로세스 ${script:killed}개 종료" } else { Info "종료할 node 프로세스 없음" }

  if ($Chrome) {
    $list = Get-Json "$Cdp/json/list"
    if ($list -and ($list | Where-Object { $_.url -match 'booking\.naver\.com' })) {
      Bad "booking.naver 탭이 열려 있어 크롬 종료를 거부합니다 (진행 중인 예약 보호). 탭을 닫고 다시 실행하세요."
    } else {
      try {
        Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match [regex]::Escape($Profile) } |
          ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Ok "격리 크롬 종료 ($Profile)"
      } catch { Warn "크롬 종료 실패: $($_.Exception.Message)" }
    }
  } else {
    Info "크롬은 유지했습니다 (전부 닫으려면: .\setup.ps1 -Stop -Chrome)"
  }
  exit $script:Bad
}

# ---------- 1) Node ----------
Step "Node 런타임"
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  $ver = (& node -v).TrimStart('v')
  $major = [int](($ver -split '\.')[0])
  if ($major -ge 22) { Ok "Node $ver (전역 WebSocket 사용 가능)" }
  else { Bad "Node $ver 는 너무 오래됨 - 22 이상 필요.  winget install OpenJS.NodeJS.LTS  또는 https://nodejs.org" }
} else {
  Bad "Node 가 PATH 에 없습니다 - winget install OpenJS.NodeJS.LTS 후 터미널을 다시 열고 실행"
}

# ---------- 2) Chrome ----------
Step "Chrome"
$chrome = Find-Chrome
if ($chrome) { Ok "발견: $chrome" } else { Bad "Chrome/Edge 없음 - https://www.google.com/chrome 설치 후 재실행" }
# ---------- 3) CDP ----------
Step "CDP(원격 디버깅) 포트"
if (Test-Up "$Cdp/json/version") {
  $v = Get-Json "$Cdp/json/version"
  Ok "이미 실행 중 - $($v.Browser)"
} elseif ($Check) {
  Warn "CDP 없음 (--Check 이므로 기동하지 않음). 실행: .\setup.ps1"
} elseif (-not $chrome) {
  Bad "CDP 를 띄울 브라우저가 없어 기동 불가"
} else {
  Warn "CDP 없음 -> 격리 크롬 기동 시도"
  try {
    Start-Process -FilePath $chrome -ArgumentList @(
      "--user-data-dir=$Profile", "--remote-debugging-port=$CdpPort",
      '--no-first-run', '--no-default-browser-check', $Url
    )
    $up = $false
    for ($i = 0; $i -lt 40; $i++) { if (Test-Up "$Cdp/json/version") { $up = $true; break }; Start-Sleep -Milliseconds 500 }
    if ($up) { Ok "CDP 기동 완료" }
    else { Bad "CDP 바인딩 실패 - 같은 프로필을 두 인스턴스가 점유한 경우: taskkill /IM chrome.exe /F 후 재실행" }
  } catch { Bad "크롬 기동 실패: $($_.Exception.Message)" }
}

# ---------- 4) 사이트 ----------
Step "keyescape 접속"
try {
  $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 8
  if ($r.StatusCode -eq 200) { Ok "HTTP 200" } else { Bad "HTTP $($r.StatusCode)" }
} catch { Bad "접속 실패: $($_.Exception.Message)" }

# ---------- 5) UI 서버 ----------
Step "UI 서버"
if (Test-Up "$UiUrl/api/log") {
  Ok "이미 실행 중 - $UiUrl"
} elseif ($Check) {
  Warn "정지됨 (--Check 이므로 기동하지 않음). 실행: .\setup.ps1"
} elseif (-not $node) {
  Bad "node 가 없어 기동 불가"
} else {
  Info "ui\run-server.cmd 로 백그라운드 기동 (로그: ui\server.out)"
  $env:PORT = "$Port"
  $env:CDP_PORT = "$CdpPort"
  $cmd = Join-Path $Ui 'run-server.cmd'
  if (-not (Test-Path $cmd)) { Bad "$cmd 가 없습니다 - 저장소가 불완전합니다" }
  else {
    try {
      # 리다이렉트는 cmd 래퍼가 하고, Start-Process 는 숨김으로 detached 기동 (5.1 제약 회피)
      Start-Process -FilePath $cmd -WorkingDirectory $Ui -WindowStyle Hidden | Out-Null
    } catch { Bad "기동 명령 실패: $($_.Exception.Message)" }
  }
  Start-Sleep -Seconds 3
  if (Test-Up "$UiUrl/api/log") { Ok "기동 완료 - $UiUrl" } else { Bad "기동 실패 - ui\server.out 확인" }
}

# ---------- 6) DevTools 차단 3종 ----------
Step "DevTools 차단 상태 (디텍터 / 우클릭 / F12)"
$statusScript = Join-Path $Ui 'unlock-status.mjs'
function Get-Lock {
  try {
    $o = (& node $statusScript $CdpPort) -join "`n"
    if ($o) { return ($o | ConvertFrom-Json) }
  } catch { }
  return $null
}
$s = Get-Lock
if (-not $s) { Bad "상태 검사를 실행할 수 없습니다 (node 필요)" }
elseif ($s.cdp -eq 'DOWN') { Warn "CDP 가 없어 검사 불가 - 크롬을 켠 뒤 다시 실행" }
elseif ($s.count -eq 0) { Ok "keyescape 탭 없음 (사격 실행 시 자동 주입됨)" }
elseif ($s.allUnlocked) { Ok "$($s.count)개 탭 모두 해제됨" }
elseif ($Check) { Bad "$($s.count)개 탭 중 일부 미해제 - .\setup.ps1 로 복구" }
else {
  Warn "차단된 탭 있음 -> 재주입 실행"
  Push-Location $Root
  & node 'unlock.mjs' --quiet $Url | Out-Null
  Pop-Location
  $s = Get-Lock
  if ($s -and $s.allUnlocked) { Ok "복구 완료 - $($s.count)개 탭 해제" } else { Bad "일부 미해제 - 해당 탭을 새로고침한 뒤 재실행" }
}

# ---------- 7) 브라우저 열기 ----------
Step "화면 열기"
if ($Check) { Info "--Check 모드: 열지 않았습니다. 준비되면 .\setup.ps1" }
else {
  try { Start-Process $UiUrl | Out-Null; Ok "$UiUrl 개방" } catch { Info "브라우저에서 $UiUrl 을 직접 여세요" }
}

# ---------- 8) 바탕화면 바로가기 (선택) ----------
if ($Shortcut) {
  Step "바탕화면 바로가기 만들기"
  try {
    $desk = [Environment]::GetFolderPath('Desktop')
    $lnk = Join-Path $desk 'keyescape-sagigdae.lnk'
    $ws = New-Object -ComObject WScript.Shell
    $sc = $ws.CreateShortcut($lnk)
    $sc.TargetPath = (Join-Path $Root 'setup.bat')
    $sc.WorkingDirectory = $Root
    $sc.Description = '키이스케이프 예약 사격대 (검사 + 크롬 기동 + UI 실행)'
    $sc.Save()
    Ok "생성됨: $lnk"
  } catch { Warn "바로가기 생성 실패: $($_.Exception.Message)" }
}

Write-Host ""
Write-Host "==============================================="
if ($script:Bad -eq 0) {
  Write-Host " 준비 완료  ->  $UiUrl" -ForegroundColor Green
  Write-Host "   지점/테마/날짜/시간대를 고르고 [오픈 시각에 사격] -> 브라우저에서 캡차 + 예약하기 + 결제"
} else {
  Write-Host " 일부 미충족 ($($script:Bad)건) - 위 [ X ] 항목을 처리한 뒤 다시 실행하세요." -ForegroundColor Yellow
}
Write-Host "   검사만 : .\setup.ps1 -Check"
Write-Host "   종료   : .\setup.ps1 -Stop        (크롬까지: -Stop -Chrome)"
Write-Host "   다른 포트: .\setup.ps1 -Port 9000 -CdpPort 9333"
Write-Host "==============================================="
exit $script:Bad
