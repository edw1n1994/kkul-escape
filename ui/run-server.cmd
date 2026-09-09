@echo off
rem ============================================================
rem  keyescape UI server launcher (Windows)
rem  used by setup.ps1 ; also fine to double-click
rem  env PORT / CDP_PORT are inherited from the caller if set
rem ============================================================
cd /d "%~dp0"
echo [%date% %time%] start PORT=%PORT% CDP_PORT=%CDP_PORT% >> server.out
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found in PATH. Install Node.js 22+ from https://nodejs.org >> server.out
  exit /b 1
)
node "%~dp0server.mjs" >> server.out 2>&1
