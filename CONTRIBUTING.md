# Contributing

Digi Deck is a personal / hobby project, but the integration architecture is designed so a fifth (or fiftieth) integration can be added without touching central files. This doc explains how.

## Ways to contribute

- **New integration** — Home Assistant, Philips Hue, VoiceMeeter, Elgato Wave Link, whatever your streaming setup uses. OBS / Streamlabs / Twitch / Kick / Discord / Spotify are already shipped. See the walkthrough below.
- **New starter template** — a curated layout bundle for a persona (gamer, podcaster, music-producer). Content-only, no code required. Drop a JSON in `server/src/templates/` following the existing shape.
- **Bug fix, docs, polish** — normal PR.

For anything security-adjacent, please open a private security advisory instead of a public issue — see [`SECURITY.md`](SECURITY.md).

---

## Adding a new integration

### 1. Scaffold

From the repo root:

```sh
# Basic (host/port/token style):
node scripts/scaffold-integration.mjs discord

# OAuth-based (Twitch / Kick style):
node scripts/scaffold-integration.mjs discord --oauth --display "Discord RPC"
```

That command:

- Creates `server/src/integrations/<name>.ts` with a full working stub — a `Config` type, defaults, public/redacted config helper, validator, status type, manifest, and a `<Name>Client` class implementing `IntegrationLifecycle`.
- Patches `server/src/config.ts` — adds the import, adds the field to `IntegrationsConfig`, and adds the default entry in `withDefaults`.
- Patches `server/src/index.ts` — adds the import and singleton call so the integration registers at server startup.
- Prints a "next steps" summary.

At this point the server compiles, the integration appears in the registry, and the auto-generated HTTP routes are live:

- `GET  /api/integrations/<name>` → `{ config, status }`
- `PUT  /api/integrations/<name>/config` → validate + persist + restart
- `POST /api/integrations/<name>/reconnect` → restart
- `GET  /api/integrations/<name>/authorize` (OAuth) → `{ url }`
- `GET  /api/integrations/<name>/callback` (OAuth) → HTML page
- `POST /api/integrations/<name>/disconnect` (OAuth) → clear tokens + restart

The routes work; they just call `start()`/`connect()`/etc. on a stub that does nothing yet. That's what the TODOs are for.

### 2. Fill in the TODOs

Open `server/src/integrations/<name>.ts` and:

1. **Config type** — add the fields your protocol needs (host, port, apiKey, refreshToken, whatever). Update `DEFAULT_<UPPER>_CONFIG` with sensible defaults.
2. **Public config** — expose fields the client UI needs to render. Redact secrets: emit `hasSecret: boolean` instead of the secret itself. Match the pattern in `twitch.ts` / `kick.ts`.
3. **Validator** — coerce and validate the incoming PUT body. Keep secrets from being overwritten by empty strings (see `validateStreamlabsConfig` for the pattern where the token is preserved on empty input).
4. **`start()` / `stop()`** — the actual protocol connect / disconnect. Set `this.state` and `this.err` correctly at each transition and always call `this.emitChange()` so the phone and tray refresh.
5. **Status fields** — add anything the tile-state logic (`server/src/states.ts`) needs to render live indicators.
6. **OAuth methods** (if applicable) — `buildAuthorizeUrl`, `handleCallback`, `disconnectIntegration`. `handleCallback` returns `CallbackOutcome` — the auto-router renders that message on the success HTML page.

Look at [`server/src/integrations/obs.ts`](server/src/integrations/obs.ts) for a non-OAuth reference and [`server/src/integrations/twitch.ts`](server/src/integrations/twitch.ts) for an OAuth one.

### 3. Wire up actions (if the integration exposes any)

If your integration has button actions (like "send chat message" or "start recording"):

1. Add the action type to the `Action` union in [`server/src/actions/types.ts`](server/src/actions/types.ts).
2. Add a case to `executeStep()` in the same file that calls your integration's `execute()` method.
3. Mirror the action type in the client at `client/src/lib/types.ts`.

### 4. Client-side wiring (still manual)

The client scaffold is on the roadmap but not automated yet. For now, mirror the pattern from an existing integration:

- Add a `<Name>Panel.tsx` component under `client/src/components/`.
- Add API helpers (`get<Name>State`, `put<Name>Config`, etc.) to `client/src/lib/api.ts`.
- Wire the panel into `client/src/components/IntegrationsPanel.tsx` (import + add to the pill row + add to the expanded card list).
- If actions were added: register the type in `client/src/lib/types.ts` and add a `Body` case in `client/src/components/ActionEditor.tsx`.
- If states are meaningful (live indicators, connected/disconnected pill, etc.): route them through `client/src/ws.ts` and `client/src/components/ButtonGrid.tsx`.

### 5. Test

- Server compiles: `cd server && npx tsc --noEmit`
- Client compiles: `cd client && npx tsc --noEmit`
- Server runs: `cd server && node dist/index.js` (watch for `[integration-name]` logs)
- Config UI shows the new integration and lets you enable / save credentials
- If OAuth: the authorize round-trip completes and phone tiles reflect connected state

### 6. Send a PR

Please include:

- What the integration does and who it's for
- Any external service setup steps (developer app registration, API keys, redirect URIs)
- Screenshot of the panel if visible in the UI

---

## Architecture cheat sheet

| File | Role |
| ---- | ---- |
| `server/src/integrations/base.ts` | `IntegrationManifest` + `IntegrationLifecycle` contract, central registry |
| `server/src/integrations/<name>.ts` | One integration — self-contained, registers at singleton creation |
| `server/src/index.ts` | Iterates the registry for lifecycle wiring (config, save, start, onChange) |
| `server/src/tray.ts` | Iterates the registry for menu items and restart dispatch |
| `server/src/http.ts` — `routeIntegration()` | Auto-router: /api/integrations/<name>/* dispatched via the registry |
| `server/src/actions/types.ts` | Action union + `executeStep()` — where per-action-type dispatch happens |
| `server/src/states.ts` | Per-tile live-state computation — reads integration status |

## Style

- TypeScript strict mode; use `unknown` for boundaries and validate before narrowing.
- No new npm deps without a good reason — the project keeps its dependency surface deliberately small.
- Discreet commit messages for anything security-adjacent.
- No emoji in code or commit messages unless explicitly requested.

## Roadmap for this system

Currently manual, likely automated later:

- Client panel + API + action-editor scaffolding (phase 4).
- Runtime plugin loading — integrations as npm packages installed at runtime rather than compiled in. Big lift; not on the near-term list.
