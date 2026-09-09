@echo off
rem ============================================================
rem  keyescape reservation launcher (Windows one-shot installer)
rem  Runs setup.ps1 with the same options:
rem     setup.bat                install/check + start everything
rem     setup.bat -Check         check only
rem     setup.bat -Stop          stop UI server / runner
rem     setup.bat -Stop -Chrome  also close the isolated Chrome
rem     setup.bat -Shortcut      create a desktop shortcut
rem ============================================================
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
echo.
pause
