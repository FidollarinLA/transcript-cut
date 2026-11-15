param(
  [string] $MoonHome,
  [string] $WhisperModel,
  [switch] $Build,
  [switch] $NoBrowser,
  [int] $Port = 4317
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $repoRoot

function Get-NodeExe {
  $commands = @(Get-Command node.exe -ErrorAction SilentlyContinue)
  foreach ($item in $commands) {
    & $item.Source -e "process.exit(Number(process.versions.node.split('.')[0]) < 22 ? 1 : 0)" 2>$null
    if ($LASTEXITCODE -eq 0) { return $item.Source }
  }
  $pkg = Get-AppxPackage -Name '*CodexPrimaryRuntime*' -ErrorAction SilentlyContinue |
    Sort-Object Version -Descending |
    Select-Object -First 1
  if ($pkg) {
    $candidate = Join-Path $pkg.InstallLocation 'dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}

function Test-EditorReady([int] $ListenPort) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$ListenPort/edit-core.js" -UseBasicParsing -TimeoutSec 2
    return [bool]($response.Content -match 'export function calculateEdit')
  } catch {
    return $false
  }
}

function Get-ListenProcessId([int] $ListenPort) {
  $connections = @(Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -in @('127.0.0.1', '::1', '0.0.0.0', '::') })
  if ($connections.Count -eq 0) { return $null }
  return [int]($connections | Select-Object -First 1).OwningProcess
}

function Test-ThisEditor([int] $ProcessId) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if (-not $process -or -not $process.CommandLine) { return $false }
  return $process.CommandLine -match 'server[/\]index\.mjs'
}

function Open-Editor([int] $ListenPort) {
  $address = "http://127.0.0.1:$ListenPort"
  if (-not $NoBrowser) {
    Start-Process $address | Out-Null
  }
  Write-Host "文字剪视频 $address"
}

if ($MoonHome) {
  $env:MOON_HOME = (Resolve-Path -LiteralPath $MoonHome).Path
  $env:MOON_BIN = Join-Path $env:MOON_HOME 'bin\moon.exe'
}
if ($WhisperModel) {
  $env:WHISPER_MODEL = (Resolve-Path -LiteralPath $WhisperModel).Path
}
if (-not $env:WHISPER_MODEL) {
  $defaultModel = Join-Path $repoRoot '..\..\work\ggml-base-q5_1.bin'
  if (Test-Path -LiteralPath $defaultModel) {
    $env:WHISPER_MODEL = (Resolve-Path -LiteralPath $defaultModel).Path
  }
}
if (-not $env:MOON_HOME) {
  $defaultSdk = Join-Path $repoRoot '..\..\work\moon-sdk'
  if (Test-Path -LiteralPath (Join-Path $defaultSdk 'bin\moon.exe')) {
    $env:MOON_HOME = (Resolve-Path -LiteralPath $defaultSdk).Path
    $env:MOON_BIN = Join-Path $env:MOON_HOME 'bin\moon.exe'
  }
}

if ($env:PORT) { $Port = [int]$env:PORT }
else { $env:PORT = "$Port" }

$ready = $false
for ($i = 0; $i -lt 3 -and -not $ready; $i++) {
  if ($i -gt 0) { Start-Sleep -Milliseconds 400 }
  $ready = Test-EditorReady $Port
}
if ($ready) {
  Open-Editor $Port
  exit 0
}

$listener = Get-ListenProcessId $Port
if ($listener) {
  if (Test-ThisEditor $listener) {
    Write-Host "端口 $Port 上的编辑器无响应，正在重新启动。"
    Stop-Process -Id $listener -Force
    $deadline = (Get-Date).AddSeconds(8)
    while ((Get-Date) -lt $deadline) {
      if (-not (Get-ListenProcessId $Port)) { break }
      Start-Sleep -Milliseconds 200
    }
    if (Get-ListenProcessId $Port) {
      Write-Error "无法释放端口 $Port，请稍后重试。"
      exit 1
    }
  } else {
    Write-Host "端口 $Port 已被其他程序占用，请关闭后再启动。"
    exit 1
  }
}

$node = Get-NodeExe
if (-not $node) {
  Write-Host 'Node.js 22 or newer is required. Install it and run this file again.'
  exit 1
}
$nodeDir = Split-Path -Parent $node
$env:Path = $nodeDir + ';' + $env:Path

$coreJs = Join-Path $repoRoot '_build\js\release\build\core\core.js'
if ($Build -or -not (Test-Path -LiteralPath $coreJs)) {
  & $node (Join-Path $repoRoot 'scripts\build.mjs')
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
}

if (-not $NoBrowser) { $env:TRANSCRIPT_CUT_OPEN = '1' }
else { Remove-Item Env:TRANSCRIPT_CUT_OPEN -ErrorAction SilentlyContinue }

Write-Host 'Keep this window open while using Transcript Cut. Press Ctrl+C to stop.'
& $node (Join-Path $repoRoot 'server\index.mjs')
exit $LASTEXITCODE
