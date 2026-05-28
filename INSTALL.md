# Digi Deck — Quick Install

A ~10 minute setup, no programming knowledge required. Follow each step in order.

> **Shortcut: just double-click `install.bat`** in the unzipped folder. It handles Node.js (via winget), installs the server + client, creates the desktop shortcut, and offers to launch. If that works, skip to **Step 6 — Pair your phone**. The steps below are the manual alternative.

## What you need

- Windows 10 or 11
- A phone on the same Wi-Fi as your PC
- The `digi-deck.zip` file (sent to you separately, or "Code → Download ZIP" from GitHub)

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
- You should now have a folder `C:\Users\<your-username>\digi-deck\` containing `server`, `client`, `README.md`, and `start.ps1`

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
- Two small terminal windows open (the server and the client) — leave them running
- Your browser opens to the config page automatically (`http://localhost:5173/config`)

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
| Browser doesn't open automatically | Manually visit http://localhost:5173/config |
| Want to start over | Right-click tray icon → Quit. Delete `C:\Users\<your-username>\AppData\Roaming\digi-deck\` to wipe paired phones, OBS/Twitch settings, and your button layout. |

---

That's it. For customizing buttons, integrations, or technical details, see `README.md` in the project folder.
