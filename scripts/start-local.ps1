param(
  [string] $MoonHome,
  [string] $WhisperModel,
  [switch] $Build
)

$ErrorActionPreference = 'Stop'
if ($MoonHome) {
  $env:MOON_HOME = (Resolve-Path -LiteralPath $MoonHome).Path
  $env:MOON_BIN = Join-Path $env:MOON_HOME 'bin/moon.exe'
}
if ($WhisperModel) {
  $env:WHISPER_MODEL = (Resolve-Path -LiteralPath $WhisperModel).Path
}

Push-Location (Join-Path $PSScriptRoot '..')
try {
  if ($Build -or !(Test-Path -LiteralPath '_build/js/release/build/core/core.js')) {
    node scripts/build.mjs
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
  }
  node server/index.mjs
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
