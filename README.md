# Digi Deck

Personal Stream Deck-style app: a PWA on your phone triggers actions on your Windows PC over LAN.

A single Node process runs on the PC (port 8765) — it owns the layout file, executes actions, hosts the WebSocket, and serves the built React PWA as static files. Your phone connects to that one port over your Wi-Fi. (Developers can still run Vite in dev mode separately; see *Manually running the server and client* below.)

---

## tl;dr

1. Download [**main.zip**](https://github.com/ruipmendes/DigiDeck/archive/refs/heads/main.zip). Right-click it → *Properties* → tick **Unblock** → OK.
2. Extract it (anywhere — `C:\Users\<you>\` works fine). You'll get a `DigiDeck-main\` folder.
3. Double-click **install.bat** inside it. Installs Node.js if missing, builds, creates a Desktop shortcut, and launches. First run takes 2–3 min.
4. In the config UI that opens → **Pair phone** → scan the QR from your phone's camera. Done.

To update later: tray icon → *Check for updates* → **Apply**.

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

The launcher builds the server and client if their `dist/` folders are missing, then starts a single `node dist/index.js` at **BelowNormal** process priority — so when you're streaming or gaming, the deck never has to compete with your foreground app for CPU time. The config UI opens in Firefox / your default browser if a Digi Deck tab isn't already open.

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

The server prints `digi-deck server listening on :8765`. From the same port the phone gets the PWA, the API, and the WebSocket — one port end to end.

For active development (HMR + live reload), run `npm run dev` in each folder separately; Vite stays on `:5173` for that workflow and proxies `/api` to the Node server on `:8765`.

---

## Pairing details and revocation

The auth token is stored in `%APPDATA%\digi-deck\config.json` on the PC and in your phone's `localStorage` under `digi-deck:token` after pairing. To re-pair a second phone, just scan the QR again. To revoke a phone:

- Tap **unpair** in the PWA header (clears that phone's token), **or**
- Delete `%APPDATA%\digi-deck\config.json` on the PC — the server regenerates a new random token on next start, so every previously paired phone is invalidated.

---

## HTTPS / WSS (optional)

Digi Deck defaults to plain HTTP over your LAN. The pairing token stops anyone without it from controlling your deck — but on **shared Wi-Fi** (cafés, hotels, LAN parties, dorms) a passive sniffer can lift the token off the wire. If your Wi-Fi is trusted (your own home network), the default is fine. If not, opt into HTTPS:

**Config → Security → Encrypt traffic (HTTPS)** → confirm → **quit and restart the server** (tray → *Quit*, then *start.ps1*). The server generates a self-signed cert at `%APPDATA%\digi-deck\https\` on first enable and listens over TLS.

### Expect a "not secure" warning — it's cosmetic

Because the cert is self-signed (not issued by a public CA), every browser will flag it on first connect: strikethrough `https`, "connection is not private", etc. What matters:

- **Traffic is encrypted** ✅ — the actual threat (LAN sniffing your token) is closed.
- **Identity isn't publicly verifiable** ⚠️ — but *you* generated the cert on your own PC, so identity verification is a non-issue on your own LAN. The scary wording is Chrome's blanket label for *any* self-signed cert, not a real problem.

### Removing the warning (optional)

- **This PC — Chrome / Edge**: Config → Security → **Trust for Chrome / Edge**. One click, no admin, adds the cert to your `CurrentUser\Root` store. Restart the browser.
- **This PC — Firefox**: uses its own cert store. Either click through once (persists per profile), or `about:config` → `security.enterprise_roots.enabled` = `true` to trust the Windows store.
- **Phones (simplest)**: tap through Chrome/Safari's *Advanced → Proceed anyway* once per site. Per-site exception, works on every device.
- **Phones (proper CA trust)**: Config → Security → **Download cert** and install as a *CA certificate* (not "VPN / app" or "Wi-Fi certificate" — those want a private key). Android in particular is fussy about direct-file taps; the reliable path is Settings → Security → Encryption & credentials → *Install a certificate* → *CA certificate*.

### If you use Twitch or Kick

Add `https://localhost:8765/api/integrations/<twitch|kick>/callback` to your Twitch/Kick app's OAuth Redirect URIs before re-authorizing under HTTPS.

---

## Customizing buttons

**Config UI** ([http://localhost:8765/config](http://localhost:8765/config)): drag the ≡ handle to reorder, click the icon to change it, edit label and action, click **Save**. Connected phones get the new layout within ~200 ms.

**Pages**: group buttons into named tabs (e.g. "Home", "OBS", "Twitch"). Click *+ page* to add one; rename / icon / image / delete via the bar under the tabs, plus a `cols` selector (1–4) so each page can choose its own grid density. Each button has a *→ page* dropdown to move it between pages.

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

// Streamlabs Desktop — see the Streamlabs section below for all `op` values.
{ "type": "streamlabs", "op": "toggle-record" }
{ "type": "streamlabs", "op": "set-scene", "params": { "sceneName": "Gameplay" } }

// Twitch — see the Twitch section below for all `op` values.
{ "type": "twitch", "op": "chat", "text": "!website" }
{ "type": "twitch", "op": "toggle-shield-mode" }
{ "type": "twitch", "op": "run-ad", "params": { "adLength": 60 } }
{ "type": "twitch", "op": "chat-announcement", "text": "raid incoming!", "params": { "color": "purple" } }
// Ask the target on tap — phone pops a dialog for `target` before firing.
{ "type": "twitch", "op": "start-raid",
  "prompts": [ { "field": "target", "label": "Streamer" } ] }
// Preset poll — one press fires the full thing.
{ "type": "twitch", "op": "create-poll",
  "params": { "title": "Which map?", "choices": ["Nuke", "Mirage", "Inferno"], "duration": 60 } }

// Twitch streamer thumbnail (requires Twitch connected).
// Phone shows the streamer's profile photo — color when live, grayscale when offline —
// and tapping opens twitch.tv/<login> in the PC's default browser
// (so the streamer's channel shows up on the same machine running OBS).
{ "type": "twitch-streamer", "login": "skullbizarre" }

// Go to a different page (folder navigation).
// In Folders mode the phone pushes onto a back-stack; a Back tile appears in the grid.
{ "type": "goto-page", "pageId": 1 }

// Pause between steps in a sequence (no effect as a standalone button).
{ "type": "wait", "ms": 300 }
```

**Multi-step sequences.** A button's `action` field also accepts an *array* of steps that run in order. The sequence aborts on the first failing step. In the config UI, click "+ add step" under any action to turn one button into a sequence; remove all extra steps to collapse back to a single action. Drop a `wait` step in between to space them out.

```jsonc
// One button that starts a stream: switch scene, pause, start recording, post to chat.
{
  "id": 99, "label": "Go live", "icon": "video",
  "action": [
    { "type": "obs",    "op": "set-scene", "params": { "sceneName": "Gameplay" } },
    { "type": "wait",   "ms": 250 },
    { "type": "obs",    "op": "start-record" },
    { "type": "twitch", "op": "chat", "text": "!live" }
  ]
}
```

**Long-press secondary action.** Any button can have a second action fired by holding (~500 ms). The config UI surfaces it as an *add long-press action* button under the primary editor; the phone gives a stronger haptic when the hold threshold trips, then runs the secondary action instead of the primary. Buttons without a long-press action keep firing instantly on touch — no latency penalty.

**Custom images.** Each tile and page can upload its own image (PNG, JPG, **GIF**, WebP). On the phone, button images render Stream Deck–style: full-bleed cover with the label overlaid; pages can use a separate image as a full-screen phone backdrop (with a soft dark overlay so buttons stay legible) and another smaller one as the tab thumbnail. Images are content-hashed and stored under `%APPDATA%\digi-deck\images\`.

**Custom colours.** Each tile can pick an accent colour that drives its resting border, active-state border, ack flash, and source dot — useful to colour-code rows by purpose. Each page can pick a background colour (composes under any background image). The picker offers eight curated swatches plus a native colour picker for anything off-palette.

Common `keys` values: `LeftControl`, `RightControl`, `LeftShift`, `LeftAlt`, `LeftSuper` (Windows key), `A`–`Z`, `F1`–`F12`, `Space`, `Enter`, `Escape`, `Tab`, `AudioVolUp`, `AudioVolDown`, `AudioMute`, `AudioPlay`, `AudioNext`, `AudioPrev`. Full list: nut-js [`Key` enum](https://nutjs.dev/api/Key). In the config UI, you can also just click **record** and press the combo — no need to type the names.

---

## Templates, export and import

**Templates**: click **Templates** in the config header to browse starter layouts (Stream Focused, Chat Commands, System Controls). Hit **Preview** on one and your phone (plus the PC's preview view) switches to it live — your saved layout is untouched. Presses are no-op during preview, so you can poke around without firing actions. Click **Apply** to make it permanent, or **Exit** to drop the preview and snap back to what you had.

**Export**: the config header's **Export** button downloads a single `digi-deck-layout-<date>.json` containing your full layout *and* every uploaded image (base64). Good for backups and for sharing a layout with someone else.

**Import**: **Import** in the header takes any bundle of that shape, replaces the current layout, and rehydrates the images on disk. Filenames are content-hashed on import so duplicates dedupe automatically.

---

## OBS Studio integration

In OBS: *Tools → WebSocket Server Settings → Enable WebSocket server → Show Connect Info* (note the port and password).

In Digi Deck's config UI: expand the **OBS Studio** card, tick *Enable*, paste the port + password, click **Save & reconnect**.

Action types you can bind: toggle/start/stop recording, toggle/start/stop streaming, toggle virtual camera, toggle/save replay buffer, switch scene (dropdown of your scenes), toggle input mute (dropdown of your inputs), toggle source visibility in a scene (dropdown of scene → sources in that scene).

Live state on the phone: recording / streaming / virtual cam / scene-active / muted buttons show a blue dot, source-visible buttons show a green dot, and any OBS button is dimmed with an "offline" pip if OBS isn't connected.

> **Note:** this integration speaks the `obs-websocket` v5 protocol bundled with **OBS Studio 28+**. If you run **Streamlabs Desktop** instead, use the *Streamlabs Desktop* integration below — it speaks Streamlabs' own JSON-RPC protocol and lives entirely separately from OBS.

### Audio mixer slider tiles

The config UI's *+ add slider* button creates a slider tile bound to one audio input. The tile renders as a horizontal fader with an integrated mute button — drag to set the volume, tap the speaker icon to toggle mute. The slider colour goes gray when the input is muted, and the percentage display switches to `muted`. Volume changes made from OBS itself (e.g. via the desktop mixer) push back to the phone within ~200 ms.

Each slider has a **provider** sub-dropdown that lets it target either OBS Studio *or* Streamlabs Desktop. The dropdown only shows providers whose integration is currently enabled (existing sliders keep the provider they were created with). Defaults to OBS for backwards compatibility.

---

## Streamlabs Desktop integration

A separate integration for Streamlabs Desktop users — OBS Studio and Streamlabs are completely isolated from each other; you can use one, the other, or neither.

In Streamlabs Desktop: *Settings → Remote Control → click QR Code → show details*. Copy the API token.

In Digi Deck's config UI: expand the **Streamlabs Desktop** card, tick *Enable*, paste the token (host/port default to `127.0.0.1:59650`), click *Save & reconnect*.

Action types you can bind: toggle/start/stop recording, toggle/start/stop streaming, toggle virtual camera, toggle/save replay buffer, switch scene (dropdown of your scenes), toggle audio source mute (dropdown of your audio sources), toggle source visibility in a scene (dropdown of scene → sources in that scene).

Live state on the phone: recording / streaming / virtual cam / replay buffer / scene-active / muted buttons light up with a blue dot, source-visible buttons show a green dot, and any Streamlabs button is dimmed with an "offline" pip if Streamlabs isn't connected. The integration auto-reconnects every 5 seconds for up to 5 minutes, then surfaces a manual *retry* button in the card.

Audio mixer slider tiles work for Streamlabs too — the slider editor exposes a provider toggle (OBS / Streamlabs) that's filtered by which integration is enabled. See *Audio mixer slider tiles* under the OBS section above; everything carries over.

---

## Twitch integration

Chat + a bundle of native Twitch controls: run an ad, snooze the next one, create a clip, drop a stream marker, toggle Shield Mode, toggle emote-only / sub-only / follower-only / slow chat modes, send a highlighted announcement, clear chat, start / cancel a raid, send a shoutout, update the stream title, change the category, and fire off polls and predictions — all from a button, no tabbing out of your game.

**Prompt on tap.** For raids / shoutouts / title / category updates, the target is often something you decide in the moment. Each of those fields has an *Ask on tap* checkbox in the button editor — with it checked, the field is left blank in the config and the phone pops a small dialog when you press the tile, asking for the value before firing.

One-time setup:

1. Register a free Twitch app at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) → *Register Your Application*.
2. **OAuth Redirect URL**: `http://localhost:8765/api/integrations/twitch/callback` (exactly this — Twitch allows `http://localhost` as an exception to the HTTPS rule).
3. Category: *Application Integration*. Click *Create*.
4. Copy the **Client ID**; click *New Secret* and copy that too.
5. In the config UI → **Twitch** card → expand → paste Client ID + Secret → *Save credentials*.
6. Click **Connect to Twitch** → approve in the new tab → close it when it says "Connected".

Create a button with action *Twitch*, pick an op from the dropdown (Send chat message, Run ad, Toggle Shield Mode, etc.), fill in the op-specific field if any, and save. Chat runs through a persistent IRC connection for instant delivery; the rest go through the Helix API.

**Upgrading?** Every time this integration adds new ops, extra OAuth scopes come with them. On first *insufficient permission* error, open the Twitch card → *Disconnect* → *Connect to Twitch* — one round-trip re-approves with the full scope set.

**Twitch streamer tiles.** A separate action type — *Twitch streamer* — takes a login (e.g. `skullbizarre`). On the phone the tile renders the streamer's profile picture with a purple ring when live and grayscale when offline; tapping opens `twitch.tv/<login>` in the PC's default browser. Live/offline state polls every minute; the ring updates in place.

---

## Discord integration

Mute / unmute / deafen / undeafen your own Discord voice from a tile, with a live indicator that lights up when you're actually muted or deafened (unlike a keybind, we *read* the state — no drift between what the tile shows and what Discord is doing).

One-time setup:

1. Visit [discord.com/developers/applications](https://discord.com/developers/applications) → *New Application*, name it anything ("Digi Deck").
2. Under **OAuth2** → add a redirect URI. Any registered URI works — `http://127.0.0.1` is fine.
3. Copy the **Application ID** (Client ID) from *General Information*.
4. Under **OAuth2**, hit *Reset Secret* and copy the **Client Secret**.
5. In the config UI → **Discord** card → expand → paste Client ID + Secret → *Save credentials*.
6. Click **Connect to Discord**. A dialog appears **inside the Discord client** asking you to authorize the app — approve it. Digi Deck's panel flips to "Connected."

Action types: **Discord** → Mute (toggle/mute/unmute), Deafen (toggle/deafen/undeafen), Toggle push-to-talk mode, Toggle noise suppression (Krisp), Toggle automatic gain control, Toggle echo cancellation, Join voice channel, Leave voice channel, Set member volume, Mute member, Unmute member. Toggle variants read the current state and flip; force variants are for scripted sequences where you always want a specific final state.

For **Join voice channel** and the per-member ops, the config UI has an *Ask on tap* checkbox on the target field: check it, and instead of pasting an ID at config time, the phone pops a picker at press time.
- For **Join channel**, the picker lists every voice channel the authorized user can see across their guilds.
- For **Mute member / Unmute member / Set member volume**, the picker lists the users currently in the voice channel you're in. If you're not in a channel when you press it, the modal says "no options available" and won't fire.

Alternatively paste the raw ID at config time (Discord: *User Settings → Advanced → Developer Mode* → right-click channel or user → *Copy ID*) — useful when you always target the same person or channel.

The tile lights up when the corresponding thing is active (mic muted / deafened / PTT mode on / noise suppression on / currently in the target channel) — same convention as the OBS mic-mute UX. Live state comes from Discord's `VOICE_SETTINGS_UPDATE` and `VOICE_CHANNEL_SELECT` events, so if you change something via keybind or the app itself, the tile still updates.

**Sliders.** Discord is also a slider provider — add a slider tile and pick *Discord* as the source. Three channels:
- *Microphone input volume* (tap = mic mute)
- *Voice output volume* (tap = deafen)
- *Voice activation sensitivity* — sets the voice-activity threshold; higher slider = more sensitive. Flipping the slider overrides Discord's auto-threshold; the mute-pip lights when Discord is auto-adjusting.

Slider position and mute state live-update from Discord, so changing volume inside Discord moves the tile fader in real time.

**Requires Discord running on the same PC.** Discord's local IPC pipe (`\\.\pipe\discord-ipc-N`) is the transport; if Discord isn't open, the Discord card shows *disconnected* and retries every few seconds until it appears.

**Upgrading?** If you connected Discord before the picker-on-tap shipped, the channel/member listing needs the `guilds` OAuth scope your existing token doesn't have. On first "cannot list guilds" error, open the Discord card → *Disconnect* → *Connect to Discord* — one round-trip re-approves with the full scope set.

---

## Kick chat integration

Same idea as Twitch, for Kick. Send chat to your own Kick channel, plus optional Kick-streamer thumbnail tiles.

One-time setup:

1. Visit [kick.com/settings/developer](https://kick.com/settings/developer) → *Create a new application*.
2. **Redirect URI**: `http://localhost:8765/api/integrations/kick/callback` (add the `https://` variant too if you enable HTTPS later).
3. Enable the **user:read**, **channel:read**, and **chat:write** scopes.
4. Copy the **Client ID** and **Client Secret** after creating.
5. In the config UI → **Kick chat** card → expand → paste Client ID + Secret → *Save credentials*.
6. Click **Connect to Kick** → approve in the new tab → close when it says "Connected".

Action types: *Kick chat* (sends `text` to your channel) and *Kick streamer* (opens `kick.com/<slug>` on tap). One quirk on the streamer tiles: Kick's OAuth API doesn't expose other users' profile pictures, so the tile falls back to the initial letter or, if you paste a custom URL in the action's *avatar URL* field, that image (right-click the streamer's avatar on kick.com → *Copy image address*). Live-stream thumbnails also render on the tile while the streamer is broadcasting.

---

## File and folder layout

```
digi-deck/
├── server/                            ← Node WS server (port 8765)
│   ├── src/
│   │   ├── index.ts                   entry, wires everything together
│   │   ├── layout.ts                  load/save/watch/validate layout.json
│   │   ├── layout-bundle.ts           export/import bundles with embedded images
│   │   ├── images.ts                  upload/serve/delete uploaded button images
│   │   ├── templates.ts               starter templates + live preview state
│   │   ├── templates/                 shipped template bundles (.json)
│   │   ├── config.ts                  load/save config.json (token + integrations + security)
│   │   ├── auth.ts                    token check + Origin/Host allowlist + constant-time compare
│   │   ├── http.ts                    REST endpoints + auto-router for /api/integrations/*
│   │   ├── https-cert.ts              self-signed cert generation for opt-in HTTPS
│   │   ├── mdns.ts                    Bonjour service advertisement
│   │   ├── tray.ts                    spawns hidden PowerShell NotifyIcon
│   │   ├── states.ts                  computes per-button live state for the phone
│   │   ├── updates.ts                 GitHub-based "check for updates" comparator
│   │   ├── actions/                   one file per action type
│   │   └── integrations/              base.ts (registry) + obs.ts, streamlabs.ts, twitch.ts, kick.ts, discord.ts
│   └── package.json
├── client/                            ← Vite + React PWA (built to client/dist, served by the server at :8765)
│   ├── src/
│   │   ├── GridApp.tsx                phone grid view
│   │   ├── ConfigApp.tsx              PC config view
│   │   ├── ws.ts                      WebSocket hook
│   │   ├── components/                ButtonGrid, ConfigRow, ActionEditor, ObsPanel,
│   │   │                              StreamlabsPanel, TwitchPanel, KickPanel, DiscordPanel, SecurityPanel,
│   │   │                              ImagePicker, TemplatesPanel, PreviewBanner, etc.
│   │   └── lib/                       icons, api, types, token, errors
│   ├── public/                        favicon + PWA manifest + icon.svg / icon-maskable.svg
│   └── package.json
├── scripts/
│   └── scaffold-integration.mjs       generates the boilerplate for a new integration
├── start.ps1                          launcher used by the desktop shortcut
├── install.ps1 / install.bat          initial-install wrapper (winget node, npm install, build)
├── apply-update.ps1                   git-clone one-click updater (tray → Check for updates → Apply)
├── apply-update-zip.ps1               zip-install variant of the same
├── CONTRIBUTING.md                    how to add a new integration
├── SECURITY.md                        private disclosure policy
└── README.md
```

User data lives outside the project folder, in `%APPDATA%\digi-deck\`:

- `config.json` — auth token + OBS settings + Twitch credentials/refresh token.
- `layout.json` — your pages and buttons.
- `images/` — content-hashed copies of every image you've uploaded for buttons or page tabs.

You can copy this folder to another machine to migrate everything, or delete it to factory-reset.

---

## Possible next steps

Currently pinned:

- **Discord RPC integration** — deterministic mute / deafen + state indicator, matching the OBS mic UX. The scaffolder generates the whole server-side skeleton in one command (see [CONTRIBUTING.md](CONTRIBUTING.md)).
- **mDNS auto-discovery on the phone** — the server already advertises via mDNS; phone-side consumption is the missing piece so the QR doesn't need re-scanning after IP changes.
- **More starter templates** — gamer / podcaster / music-producer preset bundles. Pure content, no new code.
- **Cross-platform server** — currently Windows-only (PowerShell tray, native dialogs, `certutil` for cert trust, Windows Core Audio for mic mute). A best-effort Linux/macOS port would degrade the Windows-only pieces gracefully; full parity is a bigger project.

Reach ideas:

- More integrations — Spotify, Philips Hue.
- Native mobile shell (Capacitor) — currently a PWA, works well on Android; iOS would benefit from proper haptic feedback and a nicer install flow.

---

## Contributing

New integrations (Discord, Spotify, Home Assistant — whatever your setup needs) are meant to be cheap to add. The server side is registry-driven and auto-routed; a scaffolder generates the skeleton in one command:

```sh
node scripts/scaffold-integration.mjs discord --oauth --display "Discord RPC"
```

That drops a full working stub at `server/src/integrations/discord.ts`, patches `config.ts` and `index.ts`, and the auto-router immediately serves `/api/integrations/discord/{,config,reconnect,authorize,callback,disconnect}` — you fill in the protocol logic in the marked TODO blocks.

Full walkthrough: [CONTRIBUTING.md](CONTRIBUTING.md).

For security-adjacent issues, please use GitHub's private security advisories — see [SECURITY.md](SECURITY.md).

---

## Support this project

If Digi Deck saves you from alt-tabbing mid-stream and you'd like to keep me caffeinated:

<a href="https://ko-fi.com/skullbizarre" target="_blank">
  <img width="143" height="36" alt="image" src="https://github.com/user-attachments/assets/0d3dad1e-1ca3-49ce-a780-181b041956a0" />
</a>

You can also ★ star the repo on [GitHub](https://github.com/ruipmendes/DigiDeck) — it's free and signal-boosts the project. Feedback, bug reports, and feature ideas are welcome via the issues tab.
