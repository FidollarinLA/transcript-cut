@echo off
setlocal
cd /d "%~dp0" || exit /b 1
set "ARGS="
if /i "%~1"=="--no-browser" set "ARGS=-NoBrowser"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1" %ARGS%
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
  if /i not "%~1"=="--no-browser" pause
  exit /b %CODE%
)
exit /b 0
