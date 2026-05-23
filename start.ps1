# Digi Deck launcher
# - Starts the server and the client if they're not already running
# - If no browser tab currently shows the config page, opens it in Firefox
#   (falls back to the system default browser if Firefox is not installed)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Pick up Node/npm from registry PATH (in case this shell predates the install)
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path','User')

function Test-Port {
  param([int]$Port)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $client.Connect('127.0.0.1', $Port)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

$startedAnything = $false

if (-not (Test-Port 8765)) {
  Write-Host 'Starting digi-deck server...' -ForegroundColor Cyan
  Start-Process powershell.exe `
    -WorkingDirectory "$root\server" `
    -ArgumentList '-NoExit', '-NoProfile', '-Command',
      'Write-Host "digi-deck server" -ForegroundColor Cyan; npm run dev'
  $startedAnything = $true
} else {
  Write-Host 'Server already running on :8765' -ForegroundColor DarkGray
}

if (-not (Test-Port 5173)) {
  Write-Host 'Starting digi-deck client (Vite)...' -ForegroundColor Cyan
  Start-Process powershell.exe `
    -WorkingDirectory "$root\client" `
    -ArgumentList '-NoExit', '-NoProfile', '-Command',
      'Write-Host "digi-deck client" -ForegroundColor Cyan; npm run dev'
  $startedAnything = $true
} else {
  Write-Host 'Client already running on :5173' -ForegroundColor DarkGray
}

# Wait for Vite when we just launched it (give it up to 45s to be ready)
if ($startedAnything) {
  Write-Host 'Waiting for Vite...' -ForegroundColor DarkGray
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    if (Test-Port 5173) { break }
    Start-Sleep -Milliseconds 500
  }
  Start-Sleep -Seconds 1  # let Vite finish its initial compile
}

# Is the config page already open in any browser window?
$configOpen = $false
try {
  $configOpen = [bool](
    Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -like '*Digi Deck*Config*' }
  )
} catch {}

if ($configOpen) {
  Write-Host 'Config tab already open in a browser — leaving it alone.' -ForegroundColor Yellow
  exit 0
}

# Locate Firefox; fall back to the default browser.
$configUrl = 'http://localhost:5173/config'
$firefox = @(
  "$env:ProgramFiles\Mozilla Firefox\firefox.exe",
  "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($firefox) {
  Write-Host "Opening $configUrl in Firefox..." -ForegroundColor Green
  Start-Process $firefox -ArgumentList $configUrl
} else {
  Write-Host 'Firefox not found; opening in default browser.' -ForegroundColor Yellow
  Start-Process $configUrl
}
