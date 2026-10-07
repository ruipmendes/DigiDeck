# Digi Deck — Quick Install

A ~10 minute setup, no programming knowledge required. Follow each step in order.

> **Shortcut: just double-click `install.bat`** in the unzipped folder. It handles Node.js (via winget), installs the server + client, creates the desktop shortcut, and offers to launch. If that works, skip to **Step 6 — Pair your phone**. The steps below are the manual alternative.

## What you need

- Windows 10 / 11, macOS, or Linux (Windows is the first-class target — see **macOS & Linux** at the bottom for the per-OS gaps)
- A phone on the same Wi-Fi as your PC
- The `digi-deck.zip` file — grab it from the [latest release](https://github.com/ruipmendes/DigiDeck/releases/latest) (recommended — counts toward download totals and gives you release notes), or use "Code → Download ZIP" on the main repo page.

## Quick legend

- **PowerShell** = the blue terminal. Open it from Start menu → type `PowerShell` → Enter.
- Anywhere you see `<your-username>` below, replace it with your Windows username (run `whoami` in PowerShell to check).
- Copy command blocks **all at once** and paste — PowerShell handles multiple lines fine.

---

## Step 1 — Install Node.js

- Open https://nodejs.org in your browser
- Click the big green **LTS** button → run the installer → click *Next* on every screen → *Finish*
- **Close and reopen PowerShell** (so it picks up Node on PATH)
- Verify it worked. In **PowerShell**:

```powershell
node --version
npm --version
```

Expect `v22.x` (or higher) and `10.x` (or higher).

---

## Step 2 — Unzip Digi Deck

- Move `digi-deck.zip` to your user folder (`C:\Users\<your-username>\`)
- Right-click → **Extract All...** → make sure the destination is `C:\Users\<your-username>\` → Extract
- You should now have a folder like `DigiDeck-0.3.0\` (release install) or `DigiDeck-main\` (source zip) containing `server`, `client`, `README.md`, and `start.ps1`. Rename it to just `digi-deck` if you like — the rest of this guide assumes that.

---

## Step 3 — Install the dependencies

In **PowerShell**, paste this whole block (replace `<your-username>` first):

```powershell
cd C:\Users\<your-username>\digi-deck\server
npm install
cd ..\client
npm install
```

Takes ~2–3 minutes total. You'll see lots of text scroll by — that's normal. Wait until you see `added N packages` and the prompt comes back.

---

## Step 4 — Create the desktop shortcut

In **PowerShell**, paste this whole block (replace `<your-username>` first):

```powershell
$desktop  = [Environment]::GetFolderPath('Desktop')
$lnkPath  = Join-Path $desktop 'Digi Deck.lnk'
$root     = 'C:\Users\<your-username>\digi-deck'

$shell    = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath       = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments        = "-NoProfile -ExecutionPolicy Bypass -File `"$root\start.ps1`""
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation     = "$env:SystemRoot\System32\imageres.dll,76"
$shortcut.WindowStyle      = 7
$shortcut.Description      = 'Start Digi Deck'
$shortcut.Save()
```

You should now see a **Digi Deck** icon on your desktop.

---

## Step 5 — Start it

- Double-click **Digi Deck** on your desktop
- Windows will pop a firewall prompt for Node.js → tick **Private networks** → **Allow access**
- A single background Node process starts (no visible terminal). Look for the **Digi Deck** tray icon — right-click it for Open / Reload / Quit.
- Your browser opens to the config page automatically (`http://localhost:8765/config`)

---

## Step 6 — Pair your phone

- In the config page, click **Pair phone** (top right)
- Make sure your phone is on the **same Wi-Fi** as your PC
- Open your phone's camera and point it at one of the QR codes
- Tap the link that appears → Digi Deck opens on your phone, paired and ready
- On iOS: tap *Share → Add to Home Screen* to use it like a native app
- On Android: tap the browser menu → *Install app* / *Add to Home screen*

---

## Day-to-day use

- Double-click the **Digi Deck** shortcut to start everything. If it's already running, nothing happens — safe to click again.
- Right-click the **tray icon** (look in the system tray, click the up-arrow if Windows hides it):
  - **Open config** — config page in browser
  - **Reload layout** / **Restart OBS** / **Restart Twitch** — quick refresh
  - **Quit** — stops everything cleanly

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `npm` not recognized | Close every open PowerShell window and reopen a fresh one. Node installer doesn't update PATH for already-open shells. |
| Phone shows "Not paired" or nothing happens after scanning | Double-check phone and PC are on the same Wi-Fi network. Click Pair phone in the config UI to regenerate the QR. |
| Phone can connect but no button does anything | The Windows Firewall prompt was missed. Re-enable: Start menu → *Allow an app through firewall* → find Node.js → tick **Private**. |
| `Execution of scripts is disabled on this system` when running the shortcut | The shortcut already uses `-ExecutionPolicy Bypass`. If you got here some other way, paste this in **PowerShell (Admin)**: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Browser doesn't open automatically | Manually visit http://localhost:8765/config |
| Want to start over | Right-click tray icon → Quit. Delete `C:\Users\<your-username>\AppData\Roaming\digi-deck\` to wipe paired phones, OBS/Twitch settings, and your button layout. |

---

## Push notifications on the phone (Twitch alerts)

The deck's "notify" toggle in the header enables OS-level push alerts for Twitch events (sub / raid / cheer / follow / stream online). It depends on three things being true on the phone:

1. The connection is treated as a **secure context** (HTTPS or an allow-listed origin).
2. **Service Workers + Push** are supported by the browser.
3. The deck is paired (you have an auth token).

If the toggle is missing or does nothing:

**Toggle doesn't appear** → secure-context failure. Paste `javascript:alert('secure=' + window.isSecureContext)` into the URL bar; if it says `secure=false`, HTTPS isn't live. See below.

**Toggle shows "service worker registration failed"** → the TLS cert isn't trusted by the browser. Common on Android Chrome with the self-signed cert — accepting the browser's "Advanced → Proceed" warning lets pages load but blocks SW registration. Two fixes:

- **Easiest (dev-mode flag — recommended for one tablet)**: on the device, visit `chrome://flags/#unsafely-treat-insecure-origin-as-secure`. Enable it and add `http://<pc-ip>:8765` (your PC's LAN IP). Relaunch Chrome. The deck now runs over plain HTTP but Chrome treats that one origin as "secure" so SW + Push work. Scope: only that one Chrome install.
- **Proper path (works for every device without per-browser setup)**: use a tunnel like [Tailscale](https://tailscale.com/) that gives Digi Deck a real cert chain devices natively trust. Install Tailscale on both PC and phone, point the deck at your `.ts.net` hostname, done.

**Toggle says "blocked"** → you tapped Deny on the browser's permission prompt. Clear site data in browser settings, or long-press the deck's address bar → Site settings → Notifications → Allow, then try again.

**iPad / iOS Safari** → Push works only when the deck is installed as a PWA. Open the deck in Safari → Share → *Add to Home Screen* → open from the home-screen icon. The toggle should appear.

### Enabling HTTPS on the server

HTTPS is opt-in and off by default. Enable it in the config UI's **Security** panel. **Restart the server after flipping the toggle** — the HTTPS listener is created at server boot, so toggling the setting doesn't swap the live listener. Right-click tray → Quit → re-launch. Look for `[https] listening with self-signed cert` in the console.

---

That's it. For customizing buttons, integrations, or technical details, see `README.md` in the project folder.

---

## macOS & Linux

The server runs on both. There's no `install.bat` equivalent yet — install manually:

```bash
# 1. Clone the repo (or download + unzip the source zip)
git clone https://github.com/ruipmendes/DigiDeck.git
cd DigiDeck

# 2. Install dependencies
(cd server && npm ci)
(cd client && npm ci)

# 3. Launch — builds server + client on first run, then starts
./start.sh
```

Config page opens automatically at `http://localhost:8765/config` (or `https://` if you flip the HTTPS switch — `selfsigned` ships the cert pure-JS, no OpenSSL needed).

**What works everywhere:** the full deck UI, every integration (OBS, Streamlabs Desktop, Twitch, Kick, Discord, Spotify, Hue, Home Assistant, OpenRGB, Nanoleaf, Mix It Up, Voicemod, Elite Dangerous), hotkey / text / launch / url / script actions, sound playback (`afplay` on macOS, `paplay` on Linux), HTTPS, CPU + RAM chart sources, pairing + QR, mDNS discovery.

**Windows-only features** (degrade cleanly on other OSes):
- **Tray icon** — no tray; keep a browser tab on the config page or `ps`/`pkill` to stop.
- **Native file-browse dialog** — type paths manually in the Launch / Sound editors.
- **One-click HTTPS cert trust** — HTTPS still works via `selfsigned`; trust the cert in your OS keychain manually (macOS: Keychain Access → System → Trust; Linux: distro-specific).
- **Mic mute, per-app audio, Voicemeeter** — Windows Core Audio only. Use OS-equivalent hotkeys (e.g. macOS: `osascript -e 'set volume input volume 0'`).
- **GPU utilization chart source** — Windows perf counter only; CPU / RAM still work.
- **Update MessageBox** — results print to the server log instead; the release page opens in your browser.
