# Farkle

Pass-and-play Farkle for one phone at the table. Live at <https://farkle.mathieu.cc/>.

React 19 + TypeScript, the Soft Clay visual system from `farkle-design.pen`, a pure rules engine, and the physics dice table ported from the original prototype. The single-file prototype is retired; it remains in git history.

## Run

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # engine golden vectors + reducer tests
pnpm build      # typecheck + production build
```

## Layout

The workspace follows [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md):

```text
apps/web          React SPA — setup, game, rules, settings, history, winner
packages/engine   pure rules + dice-turn reducer + versioned records
packages/dice     imperative three.js/cannon-es table, lazy-loaded
packages/protocol wire schemas for Online (frozen skeleton, no server yet)
```

## What works

- 2–6 players; add, name, and remove them before starting.
- 3D physics dice with tap-to-keep; flat dice fall back automatically when WebGL is unavailable.
- Full classic scoring, farkle detection, hot dice, three-farkle penalty, entry threshold.
- **Scorekeeping (M2):** 2–8 players, a shared keypad, quick chips, a one-tap Farkle button, an append-only ledger with corrections, 10-level undo, finish-the-round and sudden death, and a full-screen table display with wake lock.
- House rules: Classic / Bar / Family presets plus a custom target, entry threshold, straight value, three pairs, two triplets, hot dice, penalty, win condition (first to target or complete round), and first player.
- Resume through IndexedDB, including migration of the old prototype's `farkle.prototype.v1` save.
- Keyboard: `R` roll, `B` bank, `1`–`6` toggle dice, `Esc` close dialogs. Screen readers get die names, turn changes, and results through live regions.
- Shake-to-roll (opt-in, motion permission requested on tap), sound and haptics with toggles, reduced-motion mode.
- Settings, history with read-only recaps, native share with a generated PNG scorecard, and a 5-second undo-bank snackbar.
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

GitHub Pages serves `main` from the repository root. The Vite build uses the default `/` base, so the app is the site root; `404.html` is a copy of the shell so deep links such as `/local/game` boot the SPA on Pages.

```bash
pnpm --filter @farkle/web build
rm -rf assets icons manifest.webmanifest sw.js workbox-*.js
cp -R apps/web/dist/. .
cp index.html 404.html
```

Then commit and push. Pages rebuilds from `main`; `CNAME` keeps the custom domain.

## Docs

- [Product requirements](docs/PRD.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture](docs/ARCHITECTURE.md)

Remaining for the M1 gate: the 20-game dogfood pass and visual sign-off. M2's engine and scorepad are in place; its release gate is 10 real table sessions, a correction on a disputed win, table-display wake lock, and the ≤15 s turn-entry target. Online starts in M3.
