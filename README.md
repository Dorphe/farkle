# Farkle

Two builds live in this repo during the M1 cutover:

- **`index.html`** — the classic single-file prototype. It is still the production build at <https://farkle.mathieu.cc/>; the rebuild is live beside it at <https://farkle.mathieu.cc/v2/> and the classic rollback path at <https://farkle.mathieu.cc/classic/>.
- **`apps/web` + `packages/*`** — the rebuild: React 19 + TypeScript, the Soft Clay design from `farkle-design.pen`, the 3D dice table ported from the prototype, and the rules extracted into a pure engine.

## The rebuild

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # engine golden vectors + reducer tests
pnpm build      # typecheck + production build
```

The layout follows [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md):

```text
apps/web          React SPA — setup, game, rules, settings, history, winner
packages/engine   pure rules + dice-turn reducer + versioned records
packages/dice     imperative three.js/cannon-es table, lazy-loaded
packages/protocol wire schemas for Online (frozen skeleton, no server yet)
```

Implemented for Local: the five screens in the pen file, physics dice with a flat fallback, tap/keyboard selection, hot dice, farkle and penalty, entry threshold and complete-round variants, house-rule presets (Classic / Bar / Family / custom), resume through IndexedDB, migration of the prototype's `farkle.prototype.v1` save, keyboard shortcuts, shake-to-roll, sound/haptics, reduced-motion handling, a variant-aware rules screen, settings, history with read-only recaps, native share with a generated PNG scorecard, and a 5-second undo-bank snackbar.

PWA: installable manifest, self-hosted font, offline app shell and dice chunk (Workbox), plus an update prompt that never reloads a game by itself.

Remaining before the production cutover: the 20-game dogfood pass and visual-regression sign-off in the M1 gate, and flipping the production route to `/v2` while keeping `/classic` as the rollback. `apps/server` arrives in M3.

Design tokens are in `apps/web/src/styles/tokens.css`. Two contrast-safe adjustments were made to the pen palette: interactive fills use `#B2523C` (white text at AA; the pen's `#D4715B` remains for display type and selected dice) and small muted text uses `#6E625C`.

## Deploy

GitHub Pages serves `main` from the repository root. The rebuild is built with `VITE_BASE=/v2/` and committed to `v2/`; the classic single file is copied to `classic/`, and the same shell is copied to the root `404.html` so deep links such as `/v2/local/game` boot the SPA instead of 404ing.

```bash
VITE_BASE=/v2/ pnpm --filter @farkle/web build
rm -rf v2 && cp -R apps/web/dist v2
mkdir -p classic && cp index.html classic/index.html
cp apps/web/dist/index.html 404.html
```

No CI workflow is required; Pages rebuilds on push. Rollback is opening `/classic/` or reverting the commit.


## Classic prototype (production until cutover)

The single-file app still runs at <https://farkle.mathieu.cc/>. Open `index.html` in any browser — no build step. Fonts come from Google Fonts and the 3D table pulls three.js + cannon-es from jsDelivr; if either is unavailable the game falls back to the flat dice and system fonts.

Docs:

- [Product requirements](docs/PRD.md) — scope, rules, requirements, release gates
- [Roadmap](docs/ROADMAP.md) — milestones and sequencing
- [Architecture](docs/ARCHITECTURE.md) — re-platform decision, module boundaries, online design

## What works

- Add 2–6 players and name them; start a game.
- Roll six dice on a 3D table — real rigid-body physics (cannon-es), tap a die to keep it. The die's value is whatever face is pointing up when the simulation settles, so the throw itself decides the roll.
- Tap dice directly on the 3D table, or keep the flat dice if WebGL is unavailable.
- Bank points or keep rolling with the dice that are left.
- Full classic scoring: singles, three-of-a-kind (×2/×4/×8 for four/five/six), straight, three pairs, two triplets.
- Farkle detection (no scoring dice = bust), hot dice when all six score, three farkles in a row = −1,000.
- First to 10,000 wins; scores, turn, and dice persist in `localStorage`, so a refresh doesn't lose the game.
- Keyboard: `R` roll, `B` bank, `1`–`6` toggle dice, `Esc` close rules.
- **Shake to roll** on phones: flip the switch under the action buttons, then shake. Shaking only rolls when a roll is actually legal (it commits a valid selection, or refuses while dice are still on the table).

## Mobile layout

The phone view is one screen, no scrolling: score strip at the top (the current player's chip scrolls itself into view), big dice in the middle, and stats + Roll/Bank pinned to the bottom thumb zone above the safe area. Dice run three across at up to 116px so a thumb can hit them; the empty tray shows dashed placeholders. Landscape phones switch to a side rail with all six dice in one row and the shake switch hidden to save height.

## Testing on a phone

Motion sensors need a secure context: serve the file over HTTPS (GitHub Pages, Netlify drop, `npx localtunnel`) — not over a plain-`http` LAN IP. iOS asks for motion permission the first time you flip the switch, and that prompt must come from the tap, so the toggle starts off after a reload.

## Rules implemented

| Roll | Points |
| --- | --- |
| Single 1 / 5 | 100 / 50 |
| Three of a kind (2–6) | face × 100 |
| Three 1s | 1,000 |
| Four / five / six of a kind | triple ×2 / ×4 / ×8 |
| Straight 1–6 | 1,500 |
| Three pairs | 1,500 |
| Two triplets | 2,500 |

A selection is only valid if every die in it belongs to a scoring combination. The turn score is banked only when you press **Bank**.

## 3D dice

The tray is a three.js scene over a cannon-es world: six 1×1×1 boxes with canvas-textured pips, thrown from a jittered grid, bouncing off invisible arena walls. When everything comes to rest (or after 2.2 s) each die is snapped to the nearest flat orientation and its top face becomes the value. Rolling the rest of the dice re-throws only the dice still on the table.

The GL layer is progressive enhancement — `window.Dice3D` mounts only if WebGL initialises, and any failure leaves the original DOM dice in charge.

## Structure

Everything lives in `index.html`: markup, CSS tokens, a small state machine (`roll → keep → bank / bust`) with a memoized scoring search, and the module script for the dice table. Shake detection reads `devicemotion`, compares the acceleration magnitude frame to frame, and fires on a jump of >15 m/s² with a 1.1 s cooldown so one shake doesn't roll twice.
