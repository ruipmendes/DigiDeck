# Digi Deck -- one-click updater for zip installs.
# Downloads the latest source zip from GitHub, extracts it over the
# current install (preserving %APPDATA% state), re-runs install.ps1,
# and relaunches. Called from the "Check for updates" dialog when the
# install has no .git directory.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path','User')

$Host.UI.RawUI.WindowTitle = 'Digi Deck -- applying update'

Write-Host ''
Write-Host '  Digi Deck -- applying update (zip install)' -ForegroundColor Cyan
Write-Host '  ------------------------------------------' -ForegroundColor DarkGray
Write-Host ''

function Step($n, $total, $label) {
  Write-Host "[$n/$total] $label" -ForegroundColor Yellow
}

function Assert-LastExit($cmd) {
  if ($LASTEXITCODE -ne 0) { throw "$cmd exited with $LASTEXITCODE" }
}

try {
  # 1. Stop the currently running server (holds server/dist locks)
  Step 1 6 'Stopping current server...'
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

  # 2. Download the latest source zip from GitHub.
  Step 2 6 'Downloading latest source...'
  $tempDir = Join-Path $env:TEMP "digi-deck-update-$(Get-Date -Format 'yyyyMMddHHmmss')"
  New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
  $zipPath = Join-Path $tempDir 'main.zip'
  # Silencing the progress bar makes Invoke-WebRequest dramatically faster on
  # PS 5.1 (default progress rendering can add 30+ seconds on medium-size zips).
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri 'https://github.com/ruipmendes/DigiDeck/archive/refs/heads/main.zip' `
                    -OutFile $zipPath `
                    -UseBasicParsing
  Write-Host "  saved to $zipPath" -ForegroundColor DarkGray

  # 3. Extract to temp so we can copy from a stable source.
  Step 3 6 'Extracting...'
  Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force
  $extractRoot = Get-ChildItem -Path $tempDir -Directory |
                 Where-Object { $_.Name -like 'DigiDeck-*' } |
                 Select-Object -First 1
  if (-not $extractRoot) { throw 'Could not find extracted DigiDeck-* directory.' }
  $extractPath = $extractRoot.FullName

  # 4. Overlay extracted files onto the install root.
  # Skips apply-update-zip.ps1 (this script itself is locked; the next update
  # cycle will pick up any changes to it). node_modules/ and dist/ are not in
  # the source zip, so they're preserved automatically; install.ps1 will
  # refresh them next.
  Step 4 6 'Applying files...'
  Get-ChildItem -Path $extractPath -Recurse -Force | ForEach-Object {
    if ($_.Name -eq 'apply-update-zip.ps1') { return }
    $relative = $_.FullName.Substring($extractPath.Length).TrimStart('\')
    $dest = Join-Path $root $relative
    if ($_.PSIsContainer) {
      if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest -Force | Out-Null }
    } else {
      $destDir = Split-Path -Parent $dest
      if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
      Copy-Item -Path $_.FullName -Destination $dest -Force
    }
  }
  Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue

  # 5. Refresh deps + rebuild via install.ps1. -NoLaunch skips its prompt.
  Step 5 6 'Installing deps + rebuilding...'
  & "$root\install.ps1" -NoLaunch
  Assert-LastExit 'install.ps1'

  # 6. Relaunch via start.ps1.
  Step 6 6 'Restarting...'
  & "$root\start.ps1"

  Write-Host ''
  Write-Host '  Update applied.' -ForegroundColor Green
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
