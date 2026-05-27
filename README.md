# Digi Deck

Personal Stream Deck-style app: a PWA on your phone triggers actions on your Windows PC over LAN.

Two processes run on the PC: a Node WebSocket server (port 8765) that owns the layout file and executes actions, and a Vite + React dev server (port 5173) that serves the PWA to your phone. Your phone connects to both over your Wi-Fi.

---

## Shell convention used in this guide

Each command block below is labelled with where to run it:

- **`# Run in: PowerShell`** — requires PowerShell (e.g. `.ps1` scripts, .NET COM, dot-slash invocation).
- **`# Run in: PowerShell or cmd`** — works in either; `npm`, `winget`, `cd`, `node` don't care.

If you see no label, assume **PowerShell or cmd** is fine.

---

## Requirements

### Required

| What | Minimum | Why |
| ---- | ------- | --- |
| Windows | 10 or 11 | Tray icon uses .NET `NotifyIcon`; default action shells out to `cmd /c start`; appdata lives in `%APPDATA%`. |
| Node.js | **22 LTS or newer** | Top-level `await` and built-in `fetch`. |
| Wi-Fi | Same network for PC and phone | The WebSocket runs over LAN. |
| Windows Firewall | Allow Node.js on Private networks (prompted on first run) | Phone needs to reach the PC's server. |
| Phone browser | Any modern Chrome / Safari / Edge | Add to Home Screen for a near-native PWA feel. |
| Disk | ~250 MB free | `node_modules` for both server and client. |

### Optional (per integration)

| What | When you need it | Notes |
| ---- | ---------------- | ----- |
| OBS Studio 28+ | OBS actions (record / stream / scene / mute / source visibility) | Built-in WebSocket server replaces the old plugin. Enable in *Tools → WebSocket Server Settings*. |
| Twitch Developer app | Twitch chat actions | Free; register at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps). |
| Firefox | Pretty desktop-shortcut behaviour | `start.ps1` opens config in Firefox if installed; otherwise uses your default browser. |

### Not required

- Admin rights — installs run as your user; AppData and Desktop are user-writable.
- Visual Studio Build Tools — `@nut-tree-fork/nut-js` ships prebuilt binaries for Node 22 on Windows.
- Internet at runtime (unless you use Twitch — OAuth talks to `id.twitch.tv` / `api.twitch.tv`).

---

## Setup on a fresh machine

### 1. Install Node.js

```powershell
# Run in: PowerShell or cmd
winget install OpenJS.NodeJS.LTS
```

After this you **must open a new terminal** so `npm` shows up on PATH. Verify:

```powershell
# Run in: PowerShell or cmd
node --version   # expect v22.x or newer
npm --version
```

### 2. Get the project files

Copy the entire `digi-deck` folder onto the new machine (`C:\Users\<you>\digi-deck\` is the path the desktop shortcut assumes — anywhere else also works, just adjust the shortcut at the end). If you put the project under git, `git clone` it instead.

### 3. Install dependencies

```powershell
# Run in: PowerShell or cmd
cd C:\Users\<you>\digi-deck\server
npm install

cd C:\Users\<you>\digi-deck\client
npm install
```

Both installs together take 2–3 minutes on a fresh machine. `@nut-tree-fork/nut-js` pulls a prebuilt native binding — no compilation needed.

### 4. (Optional) Create the desktop shortcut

```powershell
# Run in: PowerShell
$desktop  = [Environment]::GetFolderPath('Desktop')
$lnkPath  = Join-Path $desktop 'Digi Deck.lnk'
$root     = 'C:\Users\<you>\digi-deck'     # ← change if you put it elsewhere

$shell    = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath       = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments        = "-NoProfile -ExecutionPolicy Bypass -File `"$root\start.ps1`""
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation     = "$env:SystemRoot\System32\imageres.dll,76"
$shortcut.WindowStyle      = 7   # start minimized
$shortcut.Description      = 'Start Digi Deck server, client, and open the config UI'
$shortcut.Save()
```

### 5. Start it

Either double-click the **Digi Deck** desktop shortcut, or:

```powershell
# Run in: PowerShell
C:\Users\<you>\digi-deck\start.ps1
```

The launcher idempotently starts both processes (skips whatever's already running on `:8765` and `:5173`), then opens the config UI in Firefox / your default browser if a Digi Deck tab isn't already open.

When the **Windows Firewall prompt** appears for Node.js, tick **Private networks** and click Allow. Without this the phone can't reach the server.

### 6. Pair your phone

On the PC: in the config UI click **Pair phone**. A modal shows a QR per LAN IP.

On your phone (same Wi-Fi): open the camera app, point at the QR, tap the link. The PWA opens, stores the auth token, and connects. Add to Home Screen if you want it to feel like a native app.

---

## Day-to-day use

The desktop shortcut handles everything. If both processes are already running and the config tab is already open in some browser window, it does nothing. Otherwise it starts what's missing and opens the config tab.

The server also runs as a **system tray icon** (look for the up-arrow in the taskbar if Windows hides it):

- **Left-click** the tray icon → open config UI
- **Right-click** → Open config / Reload layout / Restart OBS connection / Restart Twitch connection / Quit

To stop everything: tray → **Quit**.

---

## Manually running the server and client

If you want to see the logs (or restart just one piece), run each in its own terminal:

```powershell
# Run in: PowerShell or cmd
cd C:\Users\<you>\digi-deck\server
npm run dev
```

```powershell
# Run in: PowerShell or cmd  (in a second terminal)
cd C:\Users\<you>\digi-deck\client
npm run dev
```

The server prints `digi-deck server listening on :8765` and the LAN URLs Vite is on (e.g. `http://192.168.1.10:5173`).

---

## Pairing details and revocation

The auth token is stored in `%APPDATA%\digi-deck\config.json` on the PC and in your phone's `localStorage` under `digi-deck:token` after pairing. To re-pair a second phone, just scan the QR again. To revoke a phone:

- Tap **unpair** in the PWA header (clears that phone's token), **or**
- Delete `%APPDATA%\digi-deck\config.json` on the PC — the server regenerates a new random token on next start, so every previously paired phone is invalidated.

---

## Customizing buttons

**Config UI** ([http://localhost:5173/config](http://localhost:5173/config)): drag the ≡ handle to reorder, click the icon to change it, edit label and action, click **Save**. Connected phones get the new layout within ~200 ms.

**Pages**: group buttons into named tabs (e.g. "Home", "OBS", "Twitch"). Click *+ page* to add one; rename / icon / delete via the bar under the tabs. Each button has a *→ page* dropdown to move it between pages.

**Navigation mode** (top of the config editor): pick *Tabs at top* or *Folders (back-stack)*.
- **Tabs at top** (default): phone shows the page strip at the top; tapping a tab jumps directly to that page.
- **Folders**: tab strip is hidden. Use the *Go to page (folder)* action on a button to navigate into a sub-page. The phone auto-injects a *Back* tile as the first cell of the grid whenever navigation history is non-empty — like Stream Deck folders.

**By hand**: edit `%APPDATA%\digi-deck\layout.json` directly. The server watches the file and hot-reloads on save. Schema: `{ pages: [{ id, name, icon?, buttons: [...] }] }`.

Each button is `{ id, label, icon?, action }`. Action shapes:

```jsonc
// Send a keyboard combo. Keys are nut-js Key enum names.
{ "type": "hotkey", "keys": ["LeftControl", "LeftShift", "M"] }

// Type a literal string at the cursor.
{ "type": "text", "text": "Hello!" }

// Spawn a process (no shell — pass full path or a binary on PATH).
{ "type": "launch", "path": "C:\\Program Files\\Spotify\\Spotify.exe" }
{ "type": "launch", "path": "notepad.exe", "args": ["C:\\notes.txt"] }

// Open a URL / file / steam:// link in its default handler.
{ "type": "url", "url": "https://github.com" }

// Run a PowerShell one-liner or script string.
{ "type": "script", "script": "Get-Date | Out-File $HOME\\Desktop\\time.txt" }

// System volume (speakers — sends OS media keys via nut-js).
{ "type": "volume", "delta": 2 }
{ "type": "volume", "delta": -2 }
{ "type": "volume", "mute": true }

// Microphone mute (default capture device — uses Windows Core Audio).
// Button lights up when the mic is currently muted, same as OBS toggle-mute.
{ "type": "mic", "op": "toggle-mute" }
{ "type": "mic", "op": "mute" }
{ "type": "mic", "op": "unmute" }

// OBS — see the OBS section below for all `op` values.
{ "type": "obs", "op": "toggle-record" }
{ "type": "obs", "op": "set-scene", "params": { "sceneName": "Gameplay" } }

// Twitch chat.
{ "type": "twitch", "op": "chat", "text": "!website" }

// Twitch streamer thumbnail (requires Twitch connected).
// Phone shows the streamer's profile photo — color when live, grayscale when offline —
// and tapping opens twitch.tv/<login> in the PC's default browser
// (so the streamer's channel shows up on the same machine running OBS).
{ "type": "twitch-streamer", "login": "skullbizarre" }

// Go to a different page (folder navigation).
// In Folders mode the phone pushes onto a back-stack; a Back tile appears in the grid.
{ "type": "goto-page", "pageId": 1 }
```

**Multi-step sequences.** A button's `action` field also accepts an *array* of steps that run in order. The sequence aborts on the first failing step. In the config UI, click "+ add step" under any action to turn one button into a sequence; remove all extra steps to collapse back to a single action.

```jsonc
// One button that starts a stream: switch scene, start recording, post to chat.
{
  "id": 99, "label": "Go live", "icon": "video",
  "action": [
    { "type": "obs",    "op": "set-scene", "params": { "sceneName": "Gameplay" } },
    { "type": "obs",    "op": "start-record" },
    { "type": "twitch", "op": "chat", "text": "!live" }
  ]
}
```

Common `keys` values: `LeftControl`, `RightControl`, `LeftShift`, `LeftAlt`, `LeftSuper` (Windows key), `A`–`Z`, `F1`–`F12`, `Space`, `Enter`, `Escape`, `Tab`, `AudioVolUp`, `AudioVolDown`, `AudioMute`, `AudioPlay`, `AudioNext`, `AudioPrev`. Full list: nut-js [`Key` enum](https://nutjs.dev/api/Key). In the config UI, you can also just click **record** and press the combo — no need to type the names.

---

## OBS Studio integration

In OBS: *Tools → WebSocket Server Settings → Enable WebSocket server → Show Connect Info* (note the port and password).

In Digi Deck's config UI: expand the **OBS Studio** card, tick *Enable*, paste the port + password, click **Save & reconnect**.

Action types you can bind: toggle/start/stop recording, toggle/start/stop streaming, toggle virtual camera, toggle/save replay buffer, switch scene (dropdown of your scenes), toggle input mute (dropdown of your inputs), toggle source visibility in a scene (dropdown of scene → sources in that scene).

Live state on the phone: recording / streaming / virtual cam / scene-active / muted buttons show a blue dot, source-visible buttons show a green dot, and any OBS button is dimmed with an "offline" pip if OBS isn't connected.

> **Note:** this integration speaks the `obs-websocket` v5 protocol bundled with **OBS Studio 28+**. It does **not** work with **Streamlabs Desktop** (formerly Streamlabs OBS), which uses a separate remote-control protocol.

### Audio mixer slider tiles

The config UI's *+ add slider* button creates a slider tile bound to one OBS audio input. The tile renders as a horizontal fader with an integrated mute button — drag to set the volume, tap the speaker icon to toggle mute. The slider colour goes gray when the input is muted, and the percentage display switches to `muted`. Volume changes made from OBS itself (e.g. via the desktop mixer) push back to the phone within ~200 ms.

---

## Twitch chat integration

Send chat messages (including `!commands`) to your own Twitch channel from a button — no tabbing out of your game.

One-time setup:

1. Register a free Twitch app at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) → *Register Your Application*.
2. **OAuth Redirect URL**: `http://localhost:8765/api/integrations/twitch/callback` (exactly this — Twitch allows `http://localhost` as an exception to the HTTPS rule).
3. Category: *Application Integration*. Click *Create*.
4. Copy the **Client ID**; click *New Secret* and copy that too.
5. In the config UI → **Twitch chat** card → expand → paste Client ID + Secret → *Save credentials*.
6. Click **Connect to Twitch** → approve in the new tab → close it when it says "Connected".

Create a button with action *Twitch chat* and text `!website` (or any message). The server keeps an IRC connection open, so chats fire instantly.

---

## File and folder layout

```
digi-deck/
├── server/                            ← Node WS server (port 8765)
│   ├── src/
│   │   ├── index.ts                   entry, wires everything together
│   │   ├── layout.ts                  load/save/watch/validate layout.json
│   │   ├── config.ts                  load/save config.json (token + integrations)
│   │   ├── auth.ts                    token check + localhost bypass
│   │   ├── http.ts                    REST endpoints
│   │   ├── mdns.ts                    Bonjour service advertisement
│   │   ├── tray.ts                    spawns hidden PowerShell NotifyIcon
│   │   ├── states.ts                  computes per-button live state for the phone
│   │   ├── actions/                   one file per action type
│   │   └── integrations/              obs.ts, twitch.ts
│   └── package.json
├── client/                            ← Vite + React PWA (port 5173)
│   ├── src/
│   │   ├── GridApp.tsx                phone grid view
│   │   ├── ConfigApp.tsx              PC config view
│   │   ├── ws.ts                      WebSocket hook
│   │   ├── components/                ButtonGrid, ConfigRow, ActionEditor, etc.
│   │   └── lib/                       icons, api, types, token
│   └── package.json
├── start.ps1                          launcher used by the desktop shortcut
└── README.md
```

User data lives outside the project folder, in `%APPDATA%\digi-deck\`:

- `config.json` — auth token + OBS settings + Twitch credentials/refresh token.
- `layout.json` — your pages and buttons.

You can copy this folder to another machine to migrate everything, or delete it to factory-reset.

---

## Possible next steps

Spotify integration, custom themes, export/import layouts, long-press for secondary action.

---

## Support this project

If Digi Deck saves you from alt-tabbing mid-stream and you'd like to keep me caffeinated:

<a href="https://ko-fi.com/skullbizarre" target="_blank">
  <img width="143" height="36" alt="image" src="https://github.com/user-attachments/assets/0d3dad1e-1ca3-49ce-a780-181b041956a0" />
</a>

You can also ★ star the repo on [GitHub](https://github.com/ruipmendes/DigiDeck) — it's free and signal-boosts the project. Feedback, bug reports, and feature ideas are welcome via the issues tab.
