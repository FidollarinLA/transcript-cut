@echo off
setlocal
cd /d "%~dp0" || exit /b 1

set "NODE_EXE="
for /f "delims=" %%N in ('where.exe node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
if defined NODE_EXE "%NODE_EXE%" -e "process.exit(Number(process.versions.node.split('.')[0]) < 22 ? 1 : 0)" >nul 2>&1
if errorlevel 1 set "NODE_EXE="
if not defined NODE_EXE (
  for /f "usebackq delims=" %%N in (`powershell.exe -NoProfile -Command "Get-AppxPackage -Name '*CodexPrimaryRuntime*' | Sort-Object Version -Descending | ForEach-Object { Join-Path $_.InstallLocation 'dependencies/node/bin/node.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1"`) do set "NODE_EXE=%%N"
)
if not defined NODE_EXE (
  echo Node.js 22 or newer is required. Install it and run this file again.
  goto failed
)

set "PORT=4317"
set "ADDRESS=http://127.0.0.1:%PORT%"
curl.exe -fsS --max-time 2 "%ADDRESS%/edit-core.js" 2>nul | findstr.exe /C:"export function calculateEdit" >nul
if not errorlevel 1 (
  if /i not "%~1"=="--no-browser" start "" "%ADDRESS%"
  exit /b 0
)

if not defined WHISPER_MODEL if exist "..\..\work\ggml-base-q5_1.bin" (
  for %%M in ("..\..\work\ggml-base-q5_1.bin") do set "WHISPER_MODEL=%%~fM"
)
if not exist "_build\js\release\build\core\core.js" (
  if exist "..\..\work\moon-sdk\bin\moon.exe" (
    for %%M in ("..\..\work\moon-sdk") do set "MOON_HOME=%%~fM"
    for %%M in ("..\..\work\moon-sdk\bin\moon.exe") do set "MOON_BIN=%%~fM"
  )
  "%NODE_EXE%" scripts/build.mjs
  if errorlevel 1 goto failed
)

set "TRANSCRIPT_CUT_OPEN="
if /i not "%~1"=="--no-browser" set "TRANSCRIPT_CUT_OPEN=1"
echo Keep this window open while using Transcript Cut. Press Ctrl+C to stop.
"%NODE_EXE%" server/index.mjs
if errorlevel 1 goto failed
exit /b 0

:failed
if /i not "%~1"=="--no-browser" pause
exit /b 1
