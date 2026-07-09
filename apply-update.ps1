# Digi Deck -- one-click updater.
# Invoked from the "Check for updates" dialog when the user clicks Apply.
# Runs in a visible PowerShell window so users see progress live and can
# read any error before the window closes.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path','User')

$Host.UI.RawUI.WindowTitle = 'Digi Deck -- applying update'

Write-Host ''
Write-Host '  Digi Deck -- applying update' -ForegroundColor Cyan
Write-Host '  ----------------------------' -ForegroundColor DarkGray
Write-Host ''

function Step($n, $total, $label) {
  Write-Host "[$n/$total] $label" -ForegroundColor Yellow
}

function Assert-LastExit($cmd) {
  if ($LASTEXITCODE -ne 0) { throw "$cmd exited with $LASTEXITCODE" }
}

try {
  # 1. Confirm this is a git checkout
  if (-not (Test-Path "$root\.git")) {
    throw 'Not a git checkout. Apply is only available for cloned installs. Please pull manually or re-download the release.'
  }

  # 2. Stop the currently running server (holds server/dist locks)
  Step 1 5 'Stopping current server...'
  $owner = $null
  try {
    $owner = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue |
             Select-Object -First 1 -ExpandProperty OwningProcess
  } catch {}
  if ($owner) {
    try {
      Stop-Process -Id $owner -Force -ErrorAction Stop
    } catch {
      Write-Host "  (could not stop PID $owner - continuing)" -ForegroundColor DarkGray
    }
    # Wait for port 8765 to actually free so the build + relaunch don't race.
    $deadline = (Get-Date).AddSeconds(8)
    while ((Get-Date) -lt $deadline) {
      $stillOpen = $null
      try {
        $stillOpen = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
      } catch {}
      if (-not $stillOpen) { break }
      Start-Sleep -Milliseconds 250
    }
    Write-Host '  server stopped.' -ForegroundColor DarkGray
  } else {
    Write-Host '  (server not running)' -ForegroundColor DarkGray
  }

  # 3. git pull
  Step 2 5 'git pull --ff-only...'
  Push-Location $root
  try {
    & git pull --ff-only
    Assert-LastExit 'git pull'
  } finally { Pop-Location }

  # 4. Rebuild server
  Step 3 5 'Rebuilding server...'
  Push-Location "$root\server"
  try {
    & npm run build
    Assert-LastExit 'server build'
  } finally { Pop-Location }

  # 5. Rebuild client
  Step 4 5 'Rebuilding client...'
  Push-Location "$root\client"
  try {
    & npm run build
    Assert-LastExit 'client build'
  } finally { Pop-Location }

  # 6. Stamp version + relaunch
  Step 5 5 'Restarting...'
  $sha = & git -C $root rev-parse HEAD
  Assert-LastExit 'git rev-parse'
  Set-Content -Path "$root\.digi-deck-version" -Value $sha.Trim() -Encoding ascii

  & "$root\start.ps1"

  Write-Host ''
  Write-Host '  Update applied.' -ForegroundColor Green
  Write-Host "  Now on: $($sha.Trim().Substring(0, 7))" -ForegroundColor DarkGray
  Write-Host ''
  Start-Sleep -Seconds 2
}
catch {
  Write-Host ''
  Write-Host '  Update failed:' -ForegroundColor Red
  Write-Host "  $_" -ForegroundColor Red
  Write-Host ''
  Write-Host '  The old server is not running. Launch it manually with start.ps1' -ForegroundColor Yellow
  Write-Host '  once you have resolved the issue above.' -ForegroundColor Yellow
  Write-Host ''
  Read-Host '  Press Enter to close'
  exit 1
}
