#!/usr/bin/env bash
# Digi Deck launcher (production mode) for macOS / Linux.
#
# Mirrors start.ps1 on Windows:
#   - Builds the server and client if their dist/ folders are missing.
#   - Starts `node server/dist/index.js`, which serves both the API +
#     WebSocket AND the built client as static files on a single port.
#   - Opens the config UI in the default browser.
#
# Dev workflow is unaffected: run `npm run dev` in server/ and client/
# in separate terminals for HMR + live reload.
#
# Note: Digi Deck is Windows-first. On macOS / Linux the following
# features are unavailable or degraded:
#   - Tray icon (none)
#   - Native file-browse dialog (type paths manually)
#   - Mic mute, per-app audio, Voicemeeter (Windows Core Audio only)
#   - One-click HTTPS cert generation + trust (run over HTTP for now)
#   - GPU utilization metric (CPU / RAM still work)
# Everything else — the deck UI, every integration, hotkey / text / launch
# / URL / script actions, sound playback (via afplay on macOS, paplay on
# Linux) — works.

set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
cd "$root"

PORT="${DIGI_DECK_PORT:-8765}"

# Build if needed -------------------------------------------------
if [ ! -f "$root/server/dist/index.js" ]; then
  echo "Server dist/ missing — building…"
  (cd "$root/server" && npm run build)
fi
if [ ! -f "$root/client/dist/index.html" ]; then
  echo "Client dist/ missing — building…"
  (cd "$root/client" && npm run build)
fi

# Open the config URL once the server port is live --------------
(
  for _ in $(seq 1 60); do
    if (echo > /dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then
      url="http://localhost:$PORT/config"
      case "$(uname -s)" in
        Darwin*) open "$url" ;;
        Linux*)  xdg-open "$url" ;;
      esac
      exit 0
    fi
    sleep 0.5
  done
) &

# Run the server (foreground; Ctrl-C stops it) -----------------
exec node "$root/server/dist/index.js"
