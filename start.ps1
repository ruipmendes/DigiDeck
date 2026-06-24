# Digi Deck launcher (production mode — single Node process).
# - Builds the server and client if their dist/ folders are missing.
# - Starts `node dist/index.js`, which serves both the API + WebSocket
#   AND the built client as static files (port 8765, single port).
# - Runs the server at BelowNormal priority so Fortnite / OBS / Discord
#   never have to compete with the deck for CPU time.
# - Opens the config UI in Firefox / default browser.
#
# Dev workflow is unaffected: run `npm run dev` in server/ and client/
# in separate terminals for HMR + live reload.

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

# ── Build if needed ─────────────────────────────────────────────
if (-not (Test-Path "$root\server\dist\index.js")) {
  Write-Host 'Server dist/ missing — building...' -ForegroundColor Cyan
  Push-Location "$root\server"
  try { npm run build } finally { Pop-Location }
}
if (-not (Test-Path "$root\client\dist\index.html")) {
  Write-Host 'Client dist/ missing — building...' -ForegroundColor Cyan
  Push-Location "$root\client"
  try { npm run build } finally { Pop-Location }
}

# ── Start the server (one process, BelowNormal priority) ───────
if (-not (Test-Port 8765)) {
  Write-Host 'Starting digi-deck server (port 8765)...' -ForegroundColor Cyan
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = (Get-Command node).Source
  $psi.Arguments = 'dist/index.js'
  $psi.WorkingDirectory = "$root\server"
  $psi.CreateNoWindow = $true
  $psi.UseShellExecute = $false
  $proc = [System.Diagnostics.Process]::Start($psi)
  Start-Sleep -Milliseconds 200
  try { $proc.PriorityClass = 'BelowNormal' } catch { }

  # Wait for the server to start listening (up to 20s — a built node start is ~1s).
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    if (Test-Port 8765) { break }
    Start-Sleep -Milliseconds 250
  }
} else {
  Write-Host 'Server already running on :8765' -ForegroundColor DarkGray
}

# ── Open the config page ────────────────────────────────────────
$configUrl = 'http://localhost:8765/config'

# Is the config tab already open in any browser window?
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
