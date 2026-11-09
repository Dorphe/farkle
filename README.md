# Farkle

Pass-and-play Farkle for one phone at the table, plus private online rooms for friends on their own phones. Live at <https://farkle.mathieu.cc/>.

React 19 + TypeScript, the Soft Clay visual system from `farkle-design.pen`, a pure rules engine, a small WebSocket room server, and the physics dice table ported from the original prototype. The single-file prototype is retired; it remains in git history.

## Run

```bash
pnpm install
pnpm dev        # web on http://localhost:5173
pnpm dev:server # room server on ws://localhost:8787
pnpm dev:all    # both, in parallel
pnpm test       # engine + room server tests
pnpm build      # typecheck + production build
```

Online play needs the room server. In development the web app defaults to
`ws://localhost:8787/ws`. For a production build, point it at the deployed
server:

```bash
VITE_SERVER_URL=https://farkle-online.example.com pnpm --filter @farkle/web build
```

Without `VITE_SERVER_URL`, the online screens show a clear "not configured"
message instead of failing silently.

## Layout

The workspace follows [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md):

```text
apps/web          React SPA — setup, game, online lobby/room, rules, settings, history, winner
apps/server       Node WebSocket room service — ephemeral in-memory rooms, server-side rolls
packages/engine   pure rules + dice-turn reducer + versioned records
packages/dice     imperative three.js/cannon-es table, lazy-loaded
packages/protocol wire schemas and room view types shared by web and server
```

## What works

- 2–6 players; add, name, and remove them before starting.
- **Online rooms (M3 start):** a host creates an ephemeral room with a 4-character code; friends join with `farkle.mathieu.cc/join/5T1S` or by typing the code. The server owns every roll and score, the lobby tracks ready/presence, and a refresh restores the same seat with a private reconnect token. Rooms are in-memory only and expire shortly after everyone leaves.
- 3D physics dice with tap-to-keep; flat dice fall back automatically when WebGL is unavailable.
- Full classic scoring, farkle detection, hot dice, three-farkle penalty, entry threshold.
- **Scorekeeping (M2):** 2–8 players, a shared keypad, quick chips, a one-tap Farkle button, an append-only ledger with corrections, 10-level undo, finish-the-round and sudden death, and a full-screen table display with wake lock.
- House rules: Classic / Bar / Family presets plus a custom target, entry threshold, straight value, three pairs, two triplets, hot dice, penalty, win condition (first to target or complete round), and first player.
- Resume through IndexedDB, including migration of the old prototype's `farkle.prototype.v1` save.
- Keyboard: `R` roll, `B` bank, `1`–`6` toggle dice, `Esc` close dialogs. Screen readers get die names, turn changes, and results through live regions.
- Shake-to-roll (opt-in, motion permission requested on tap), sound and haptics with toggles, reduced-motion mode.
- Settings, history with read-only recaps, native share with a generated PNG scorecard, and a 5-second undo-bank snackbar.
- A table menu in both modes to leave (saved for resume), start a new game, or jump to History/Settings; setup shows a Resume card for an in-progress game.
- PWA: installable manifest, self-hosted font, offline app shell and dice chunk, update prompt that never reloads a game by itself.

Scoring:

| Roll | Points |
| --- | --- |
| Single 1 / 5 | 100 / 50 |
| Three of a kind (2–6) | face × 100 |
| Three 1s | 1,000 |
| Four / five / six of a kind | triple ×2 / ×4 / ×8 |
| Straight 1–6 | 1,500 |
| Three pairs | 1,500 |
| Two triplets | 2,500 |

A selection is valid only if every selected die belongs to a scoring combination; the engine scores it at its maximum legal value.

## Design notes

Tokens are in `apps/web/src/styles/tokens.css`. Two contrast-safe adjustments were made to the pen palette: interactive fills use `#B2523C` (white text at AA; the pen's `#D4715B` remains for display type and selected dice) and small muted text uses `#6E625C`.

## Deploy

GitHub Pages serves `main` from the repository root. The Vite build uses the default `/` base, so the app is the site root; `404.html` is a copy of the shell so deep links such as `/local/game` and `/join/5T1S` boot the SPA on Pages.

```bash
VITE_SERVER_URL=https://<your-room-server> pnpm --filter @farkle/web build
rm -rf assets icons manifest.webmanifest sw.js workbox-*.js
cp -R apps/web/dist/. .
cp index.html 404.html
```

Then commit and push. Pages rebuilds from `main`; `CNAME` keeps the custom domain.

The room server is a separate Node process (`apps/server`). It keeps rooms in
memory only, so a restart ends every live room — that is the intended
ephemeral behaviour.

> **DNS note:** `farkle.mathieu.cc` is already a CNAME to GitHub Pages. A CNAME
> owns its whole name, so a child like `online.farkle.mathieu.cc` cannot exist.
> Use a sibling such as `farkle-online.mathieu.cc`.

### Render (free, no credit card)

`render.yaml` defines a free Node web service with the right build, start, and
health-check settings. Render deploys from GitHub, so the server code must be
on `main` first.

1. Create a Render account with GitHub at <https://render.com/>.
2. Dashboard → **New → Blueprint** → connect the `Dorphe/farkle` repository →
   **Apply**. It reads `render.yaml` and deploys.
3. Note the service URL (`https://farkle-online-xxxx.onrender.com`) and check
   `/health`.
4. In the service's **Settings → Custom Domains**, add
   `farkle-online.mathieu.cc`, then create the CNAME Render shows (host
   `farkle-online`, target usually `farkle-online.onrender.com`).

Render free services sleep after 15 minutes without HTTP requests or WebSocket
messages. Clients send a ping every 20 seconds, so an active room keeps the
service awake; once everyone leaves it sleeps and the in-memory room is gone,
which is fine. The first visitor after a sleep waits roughly a minute.

### Fly.io (paid, included config)

`fly.toml` and `Dockerfile.server` deploy a single always-on machine. Fly builds
remotely; Docker is not needed locally. Fly has no permanent free tier — after
the short trial you add a card.

```bash
fly auth signup        # or: fly auth login
fly apps create farkle-online-<unique>
# set app = "farkle-online-<unique>" in fly.toml
fly deploy
curl https://farkle-online-<unique>.fly.dev/health

fly certs add farkle-online.mathieu.cc
# CNAME: farkle-online -> farkle-online-<unique>.fly.dev
```

**Keep exactly one machine.** `fly.toml` sets `min_machines_running = 1` and
disables auto-stop. Never scale to two: each process has its own in-memory
rooms, so a second machine would have a different set of room codes.

### VPS

Run `pnpm --filter @farkle/server start` under a process manager and
reverse-proxy with Caddy, which handles WebSockets automatically:

```caddyfile
farkle-online.mathieu.cc {
  reverse_proxy 127.0.0.1:8787
}
```

### Point the web app at the server

Whatever the host, set `ALLOWED_ORIGINS=https://farkle.mathieu.cc` (already in
`fly.toml` and `render.yaml`) and rebuild the SPA with the server's HTTPS
origin. Do not add `/ws`; the client appends it.

```bash
VITE_SERVER_URL=https://farkle-online.mathieu.cc pnpm --filter @farkle/web build
rm -rf assets icons manifest.webmanifest sw.js workbox-*.js
cp -R apps/web/dist/. .
cp index.html 404.html
```

Commit and push; GitHub Pages serves the new build. `MAX_ROOMS` (default 500)
caps memory use.

## Docs

- [Product requirements](docs/PRD.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture](docs/ARCHITECTURE.md)

Remaining for the M1 gate: the 20-game dogfood pass and visual sign-off. M2's engine and scorepad are in place; its release gate is 10 real table sessions, a correction on a disputed win, table-display wake lock, and the ≤15 s turn-entry target. Online starts in M3.
