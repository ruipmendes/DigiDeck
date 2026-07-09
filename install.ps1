# Digi Deck installer
# - Verifies Node.js (installs via winget if missing)
# - Runs `npm install` in server and client
# - Creates a desktop shortcut anchored to this folder
# - Optionally launches Digi Deck at the end
#
# Works regardless of where the folder lives (DigiDeck-main, digi-deck, anywhere).
# A transcript of the run is written to %TEMP%\digi-deck-install.log.

$ErrorActionPreference = 'Stop'

$root    = $PSScriptRoot
$logPath = Join-Path $env:TEMP 'digi-deck-install.log'

Start-Transcript -Path $logPath -Append | Out-Null

function Write-Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Info($msg)  { Write-Host "    $msg" -ForegroundColor DarkGray }
function Write-Warn($msg)  { Write-Host "    $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "    $msg" -ForegroundColor Red }
function Write-Ok($msg)    { Write-Host "    $msg" -ForegroundColor Green }

try {
  Write-Host "Digi Deck installer" -ForegroundColor White
  Write-Info "Project folder: $root"
  Write-Info "Install log:    $logPath"

  # --- 1. Sanity check --------------------------------------------
  Write-Step 'Verifying project layout'
  if (-not (Test-Path "$root\server\package.json") -or -not (Test-Path "$root\client\package.json")) {
    Write-Fail "Couldn't find server\ and client\ next to this script."
    Write-Fail "Make sure install.ps1 is in the project root (next to start.ps1, README.md, server\, client\)."
    exit 1
  }
  Write-Ok 'OK'

  # --- 2. Node.js -------------------------------------------------
  Write-Step 'Checking Node.js'

  function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path','User')
  }

  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Warn 'Node.js is not on PATH.'
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      Write-Info 'Installing Node.js LTS via winget (this can take a minute)...'
      winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
      Refresh-Path
      if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Fail 'Node installed but npm is still not visible in this session.'
        Write-Fail 'Close this window, open a new PowerShell, and re-run install.bat / install.ps1.'
        exit 1
      }
    } else {
      Write-Fail 'winget is not available on this machine.'
      Write-Fail 'Install Node.js LTS manually from https://nodejs.org and re-run this script.'
      Start-Process 'https://nodejs.org' 2>$null
      exit 1
    }
  }

  $nodeVer = (node --version).TrimStart('v')
  $npmVer  = (npm --version)
  Write-Info "node:  v$nodeVer"
  Write-Info "npm:   v$npmVer"
  if ([int]($nodeVer.Split('.')[0]) -lt 22) {
    Write-Warn 'Node 22 LTS or newer is recommended. Older versions may fail to install dependencies.'
  }
  Write-Ok 'OK'

  # --- 3. Server deps ---------------------------------------------
  Write-Step 'Installing server dependencies'
  Push-Location "$root\server"
  try { npm install --no-audit --no-fund } finally { Pop-Location }
  Write-Ok 'Server deps installed'

  # --- 4. Client deps ---------------------------------------------
  Write-Step 'Installing client dependencies'
  Push-Location "$root\client"
  try { npm install --no-audit --no-fund } finally { Pop-Location }
  Write-Ok 'Client deps installed'

  # --- 5. Production builds ---------------------------------------
  # Server is run as `node dist/index.js` (not tsx watch) for production,
  # and the built client lives at client/dist/ which the server serves
  # as static files. Single Node process at runtime; no Vite running
  # while you stream/game.
  Write-Step 'Building server (tsc)'
  Push-Location "$root\server"
  try { npm run build } finally { Pop-Location }
  Write-Ok 'Server built'

  Write-Step 'Building client (vite build)'
  Push-Location "$root\client"
  try { npm run build } finally { Pop-Location }
  Write-Ok 'Client built'

  # --- 6. Version stamp (best effort) -----------------------------
  Write-Step 'Recording installed version'
  $sha = $null
  try {
    Push-Location $root
    $gitSha = git rev-parse HEAD 2>$null
    Pop-Location
    if ($LASTEXITCODE -eq 0 -and $gitSha -match '^[a-f0-9]{40}$') {
      $sha = $gitSha
    }
  } catch { Pop-Location -ErrorAction SilentlyContinue }
  if (-not $sha) {
    try {
      $headers = @{ 'Accept' = 'application/vnd.github+json'; 'User-Agent' = 'digi-deck-installer' }
      $resp = Invoke-RestMethod -Uri 'https://api.github.com/repos/ruipmendes/DigiDeck/commits/main' -Headers $headers -ErrorAction Stop
      if ($resp.sha -match '^[a-f0-9]{40}$') { $sha = $resp.sha }
    } catch { }
  }
  if ($sha) {
    Set-Content -Path (Join-Path $root '.digi-deck-version') -Value $sha -Encoding ASCII -NoNewline
    Write-Ok "Recorded SHA: $($sha.Substring(0,7))"
  } else {
    Write-Warn 'Could not determine current commit (no git, GitHub unreachable, or repo private). Update check will say "unknown local version".'
  }

  # --- 7. Desktop shortcut ----------------------------------------
  Write-Step 'Creating desktop shortcut'
  $desktop  = [Environment]::GetFolderPath('Desktop')
  $lnkPath  = Join-Path $desktop 'Digi Deck.lnk'

  $shell    = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($lnkPath)
  $shortcut.TargetPath       = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $shortcut.Arguments        = "-NoProfile -ExecutionPolicy Bypass -File `"$root\start.ps1`""
  $shortcut.WorkingDirectory = $root
  $shortcut.IconLocation     = "$env:SystemRoot\System32\imageres.dll,76"
  $shortcut.WindowStyle      = 7
  $shortcut.Description      = 'Start Digi Deck'
  $shortcut.Save()
  Write-Ok "Shortcut: $lnkPath"

  # --- 8. Optional launch -----------------------------------------
  Write-Host ''
  Write-Host 'Install complete.' -ForegroundColor Green
  Write-Host ''
  $answer = Read-Host 'Launch Digi Deck now? [Y/n]'
  if ($answer -ne 'n' -and $answer -ne 'N') {
    & "$root\start.ps1"
  } else {
    Write-Info 'You can launch it later from the Desktop shortcut.'
  }
}
catch {
  Write-Fail "Install failed: $($_.Exception.Message)"
  Write-Fail "Full transcript: $logPath"
  exit 1
}
finally {
  Stop-Transcript | Out-Null
}
