# Farkle — Architecture

**Status:** Draft v0.1 · **Owner:** Product · **Updated:** 7 Nov 2026
**Companions:** [PRD](./PRD.md) · [Roadmap](./ROADMAP.md)

> This document owns *how*. It records the re-platform decision, module boundaries, the authority model for online dice, and the migration path. Decisions are written as ADRs so they can be revisited without re-litigating the whole design.

---

## 1. Decision: re-platform and redesign

The current app is a single 1,548-line `index.html` with a clean state machine, a memoized scoring search, and a three.js/cannon-es dice table. It is good at Local. It will not carry three modes, a lobby, a scorepad ledger, history, settings, and a realtime server without becoming unmaintainable.

**Decision:** rewrite the application shell in **React 19 + TypeScript** as a small monorepo, **redesign the visual system with the product designer**, and **port the 3D dice physics and scoring semantics**. The prototype is the functional reference; its CSS is not the final design. The existing app remains the reference for behavior and rules until the Local cutover. **Status: accepted** (product owner, 7 Nov 2026).

### Options considered

| Option | Fit for three modes | Cost now | Cost later | Risk |
| --- | --- | --- | --- | --- |
| Extend the single-file vanilla app | Low | Low | High | State/DOM coupling; no shared types with the server; harder testing |
| React + TypeScript monorepo | High | Medium | Low | Design integration and behavior regression during the port |
| Svelte/Solid + TypeScript | High | Medium | Low | Smaller ecosystem; no advantage for this UI |
| Native wrapper | Low | High | High | Duplicate platforms; PWA is sufficient |

React is not chosen because a dice game needs React. It is chosen because the product is becoming a multi-screen app with shared client/server state, and React + TypeScript gives the most boring, well-supported path to that. The 3D layer stays imperative and outside React's render loop.

### What is preserved

- The validated interaction model: tap-to-keep, one-screen play, thumb-zone controls, and the dice's physical feel.
- The 3D dice table, physics tuning, settle/snap behavior, and 2D fallback.
- The scoring semantics and turn rules.

### What is rewritten

- The visual system: tokens, typography, components, and layout. The product designer owns the new design; engineering implements it.
- State management, rendering, routing, persistence, and event handling.
- The scoring engine, extracted into a pure, tested package.
- The app shell, setup, lobby, scorepad, history, and settings.

### What is retired

- The prototype's CSS as the production design system. The prototype remains at `/classic` as a functional reference.
- `localStorage` as the primary store (migrated to IndexedDB; the old key is kept for 30 days as a backup).
- The CDN import map for three.js/cannon-es (bundled and lazy-loaded).
- Google Fonts at runtime (self-hosted for offline and privacy).

---

## 2. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Web app | React 19, Vite, React Router | Static SPA; deep-linkable rooms; fast dev loop |
| Client state | Zustand for session/UI; engine reducer for game state | Small, explicit; no global store ceremony |
| Styling | Plain CSS with custom properties, delivered as a token layer | The design is bespoke; Tailwind would fight it |
| Engine | TypeScript, zero runtime dependencies | Pure, testable, shared by client and server |
| Dice | three.js + cannon-es, imperative adapter, lazy chunk | Preserve the physics feel; keep it out of React renders |
| Server | Node 22 LTS, Fastify, `@fastify/websocket`, Zod, pino | Small operational surface; typed validation |
| Server state | In-memory rooms + SQLite snapshots (`better-sqlite3`) | Turn-based rooms are tiny; snapshots survive restarts |
| Web hosting | GitHub Pages or Netlify (static) | Already static; cheap and fast |
| Server hosting | Fly.io, single region, one machine | Simple, affordable, easy rollback |
| Tests | Vitest, Testing Library, Playwright, fast-check, axe | Unit → component → E2E → property → a11y |
| CI | GitHub Actions | Typecheck, lint, test, build, preview deploy |

**Why not Next.js:** no SSR, SEO, or server-rendered routes are needed. A static SPA plus a separate WebSocket service is simpler and keeps the game server independent of the web deploy.

**Why not Tailwind:** the new design is being delivered as a token layer plus component CSS. Tailwind would fight that system. Engineering implements the delivered design; it does not translate it into utilities.

**Why not XState:** the engine is a small, explicit reducer. XState would add a dependency and a mental model without buying much. Revisit if the online lobby grows into a genuinely complex actor system.

---

## 3. Repository layout

```text
farkle/
├─ apps/
│  ├─ web/                 # React SPA
│  │  ├─ src/
│  │  │  ├─ routes/        # home, local, score, online, room, history, settings
│  │  │  ├─ components/    # dice tray, scoreboard, keypad, lobby, sheets
│  │  │  ├─ dice/          # imperative 3D adapter + 2D fallback
│  │  │  ├─ stores/        # session, settings, transport
│  │  │  └─ styles/        # tokens.css, base.css, component CSS
│  │  └─ public/
│  └─ server/              # Fastify + WebSocket room service
│     ├─ src/
│     │  ├─ rooms/         # lifecycle, seats, host, TTL
│     │  ├─ transport/     # ws protocol, validation, rate limits
│     │  └─ persistence/   # SQLite snapshots
├─ packages/
│  ├─ engine/              # pure rules + dice-game + scorepad reducers
│  ├─ protocol/            # Zod schemas, message types, shared constants
│  └─ dice/                # three.js/cannon-es scene (framework-agnostic)
├─ docs/
│  ├─ PRD.md
│  ├─ ROADMAP.md
│  └─ ARCHITECTURE.md
└─ package.json            # pnpm workspace
```

**Dependency rule:** `web` and `server` may import `engine` and `protocol`. `engine` imports nothing from the app. `dice` imports only three.js/cannon-es. No package imports `web` or `server`.

---

## 4. Module boundaries

```text
┌──────────────┐      ┌──────────────┐
│   apps/web   │      │ apps/server  │
└──────┬───────┘      └──────┬───────┘
       │                     │
       ├────────┬────────────┤
       ▼        ▼            ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│  engine  │ │ protocol │ │  engine  │
└──────────┘ └──────────┘ └──────────┘
       ▲
       │
┌──────────┐
│   dice   │  (imperative; no React, no engine)
└──────────┘
```

### Engine

- Pure TypeScript. No DOM, no network, no clock, no `Math.random`.
- Deterministic: `reduce(state, action) → state`; all randomness arrives as an action payload (`RollResolved`).
- Serializable state with a schema version and migration function.
- Exports scoring utilities that the UI can use for explanations.

### Protocol

- Zod schemas for every client→server and server→client message.
- Shared types for `GameRecord`, `RoomSummary`, error codes.
- Version constant; the server rejects mismatched clients with a clear message.

### Dice

- Framework-agnostic module with a single imperative interface.
- Owns the canvas, scene, physics, resize, and disposal.
- Never re-rendered by React; mounted once per game screen and driven by refs.
- Exposes both true physics rolls (Local) and presentation rolls (Online).

### Web

- Routes and screens; no rules logic beyond presentation.
- Persists game records; owns the local session.
- Talks to the server through a transport abstraction so the UI doesn't know whether state came from IndexedDB or a socket.

### Server

- Owns rooms, seats, identity, turns, timers, and authoritative state.
- Validates every action against the engine; never trusts client scores.
- Broadcasts full state snapshots with a monotonic sequence number.
- Snapshots rooms to SQLite for restart recovery.

---

## 5. Engine design

### 5.1 One scoring core, two turn models

The PRD's "one rules engine" is implemented as **one scoring/rules core** plus **two turn reducers**:

| Module | Responsibility |
| --- | --- |
| `rules.ts` | Config, presets, scoring table, selection validation, farkle detection, penalty, win check |
| `diceGame.ts` | Local/Online turn model: roll → keep → roll/bank, hot dice, turn order |
| `scorepad.ts` | Scorekeeping turn model: log turn total or farkle → next, ledger, corrections |
| `records.ts` | `GameRecord` envelope, schema version, migrations |

Why not one reducer with a `mode` union? Because the phases and actions barely overlap: Scorekeeping has no roll, selection, or hot-dice states. A union reducer would carry dead states and invite bugs. Sharing the scoring core is the meaningful reuse; sharing the turn state machine is not.

### 5.2 Dice-game state machine

```text
        start
          │
          ▼
    ┌─────────────┐   roll    ┌──────────┐
    │ awaitingRoll│──────────▶│ rolling  │
    └─────────────┘           └────┬─────┘
          ▲                        │ resolved
          │                        ▼
          │                 ┌──────────────┐
          │   keep / hot    │ awaitingKeep │
          ├─────────────────└──────┬───────┘
          │                        │ bank
          │                        ▼
          │                  ┌───────────┐
          │                  │ turnEnd   │
          │                  └─────┬─────┘
          │                        │ next player
          └────────────────────────┘
                                   │ target reached
                                   ▼
                              ┌───────────┐
                              │ gameOver  │
                              └───────────┘
```

Farkle is a transition from `awaitingKeep` (or immediately after a roll) to `turnEnd` with the turn score discarded.

### 5.3 Action types

```ts
type DiceGameAction =
  | { type: "start" }
  | { type: "roll" }
  | { type: "rollResolved"; values: number[] }
  | { type: "toggle"; index: number }
  | { type: "keep" }
  | { type: "bank" }
  | { type: "rematch" };

type ScorepadAction =
  | { type: "logTurn"; playerId: string; total: number; kind: "score" | "farkle" }
  | { type: "correct"; entryId: string; replacement: { total: number; kind: "score" | "farkle" } }
  | { type: "undo" }
  | { type: "endGame" };
```

`toggle` lives in engine state, not in React local state. This gives Local, Online, and reconnect the same behavior, and lets other players watch the roller deliberate. Online coalesces toggles for 50 ms before broadcasting.

### 5.4 Invariants

- `score(state) ≥ 0` for every player.
- An empty selection scores 0 and is not bankable.
- A roll is a farkle iff `bestScore(fullRoll) === 0`.
- A valid selection is fully decomposable into scoring combinations.
- Every action either changes state or returns the same state plus a typed error; it never partially applies.
- Replaying the action log from the initial state reproduces the final state exactly.
- Hot dice occurs iff `kept.length === 6` and the player chooses to continue.

---

## 6. Dice authority and presentation

This is the most consequential technical choice in Online.

### Options

| Option | Feel | Integrity | Complexity |
| --- | --- | --- | --- |
| Client physics, client reports values | Best | Cheatable | Low |
| Server seed, deterministic physics on every client | Good in theory | Fragile across devices | High |
| Server values, client re-rolls until match | Good | Fine | Unbounded, unacceptable |
| **Server values, choreographed presentation** | Good | Strong | Medium |

**Decision:** server-authoritative values with a **presentation roll** that is choreographed to land on them. Local keeps true physics. Online dice are "choreographed, not simulated"; the tradeoff is documented and tested with players.

### Presentation algorithm

1. Server sends `values` and the new state.
2. The dice module places six dice above the table with random positions and orientations.
3. For 700–900 ms, apply a scripted ballistic tumble (position + angular velocity), independent of physics.
4. In the last 200 ms, ease each die to a target position and a quaternion whose top face is the required value.
5. Settle, then reveal the value and enable selection for the roller.
6. All clients use the same timing; the roller's input unlocks when their own animation completes.

The choreography uses the same die meshes, lighting, table, and camera as Local, so the visual language is identical. The difference is that gravity is a curve, not a simulation.

A physics-assisted variant (apply corrective torque near the end of a real simulation) is a **spike for M4**, not a launch requirement. If it reliably lands and feels better, adopt it behind a flag.

### Interface

```ts
export interface DiceTable {
  roll(n: number): Promise<number[]>;        // Local: physics decides
  present(values: number[]): Promise<void>;  // Online: cosmetic, lands on values
  setSelection(selected: boolean[]): void;
  setInteractive(on: boolean): void;
  reset(): void;
  dispose(): void;
}
```

The 2D fallback implements the same interface with DOM dice, so the rest of the app never branches on 3D vs 2D.

---

## 7. Protocol

### Transport

- WebSocket, JSON messages, one socket per client.
- Heartbeat: client `ping` every 20 s; server closes after 45 s of silence.
- Reconnect: exponential backoff with jitter, capped at 5 s, for up to 5 minutes.

### Messages

```ts
// client → server
{ t: "hello", v: 1, room: "7KQ2M9", token?: string, name?: string }
{ t: "ready", ready: true }
{ t: "start" }
{ t: "action", id: "a_8f2", action: DiceGameAction }
{ t: "ping", ts: 1730000000000 }

// server → client
{ t: "welcome", playerId, token, seat, state, seq }
{ t: "state", seq, state, lastEvent? }
{ t: "presence", players: [{ id, connected, away }] }
{ t: "error", code: "NOT_YOUR_TURN" | "INVALID_SELECTION" | ..., message }
{ t: "pong", ts }
```

### Rules

- **Full state, not deltas.** Room state is <15 KB. Full snapshots make reconnect, ordering, and debugging trivial. At turn-based pace, bandwidth is irrelevant.
- **Monotonic `seq` per room.** Clients discard any state with `seq` lower than the last applied.
- **Idempotency.** Every action carries a client-generated `id`; the server remembers the last 50 ids per player and returns the current state for duplicates.
- **Validation.** Every action is parsed with Zod, then checked against the engine (turn ownership, phase, selection legality). The server computes scores; it never accepts a score from the client.
- **Presence is separate.** Connection state changes do not bump the game `seq`; they are a separate message so a flaky socket doesn't spam the board.
- **Log cap.** The state includes the last 50 events for the recap; the full log is stored server-side for audit/replay.

### Roll sequence

```text
Roller              Server                         Others
  │  action:roll      │                              │
  ├──────────────────▶│ validate turn/phase          │
  │                   │ CSPRNG 6 values              │
  │                   │ reduce(RollResolved)         │
  │◀── state seq+1 ───┼─────────────────────────────▶│
  │ animate           │                              │ animate
  │ toggle ×N         │                              │
  ├──────────────────▶│ validate index, broadcast    │
  │◀── state ─────────┼─────────────────────────────▶│
  │ action:keep       │                              │
  ├──────────────────▶│ validate selection, score    │
  │◀── state ─────────┼─────────────────────────────▶│
```

---

## 8. Identity, rooms, and lifecycle

### Guest identity

- On first visit, the client generates `playerId = crypto.randomUUID()` and stores it in IndexedDB.
- On join, the server issues `token = HMAC-SHA256(playerId | roomId | exp, serverSecret)`.
- Reconnect sends the token; the server verifies and restores the seat.
- Clearing site data loses the seat; the host can free it after the 5-minute hold. Guest identity is the default and never requires an account.

### Accounts (optional)

Signing in adds continuity across devices, not a gate. It is deliberately minimal:

- **Sign-in:** email plus a one-time magic link. No password, no OAuth, no profile page.
- **Session:** an `HttpOnly`, `SameSite=Lax` cookie with an HMAC-signed session ID; 30-day expiry, sliding on use.
- **What an account owns:** a display name and a history pointer. It does not own a room; rooms remain guest-addressable.
- **Merge:** a guest who signs in mid-game keeps the current game; the guest token remains valid for that room as a fallback.
- **Recovery and deletion:** sign in again from the same email; one action deletes the account and its history. Rooms are already ephemeral.
- **Cost control:** magic-link email goes through a provider free tier; links are short-lived and rate-limited per address and IP.

### Room

```ts
type Room = {
  id: string;            // 6 chars, Crockford base32 (no I/O/0/1)
  hostId: string;
  createdAt: number;
  lastActivity: number;
  seats: Seat[];         // max 6
  state: DiceGameState;  // authoritative
  seq: number;
  timer?: { deadline: number; handle: NodeJS.Timeout };
};
```

- Codes use a 32-character alphabet, 30 bits of entropy. Combined with per-IP join limits, guessing is impractical.
- Host is the first joiner; on disconnect, host transfers to the next connected player after 30 s.
- Idle rooms expire after 2 h; empty rooms after 10 min; codes are blocked from reuse for 24 h.
- A room with an active game is never silently deleted; it is snapshotted and can be restored after a deploy.

### Turn timer

- Server-side deadline, not client-side.
- On expiry: if the player has committed turn points, bank them; otherwise apply a farkle. Uncommitted roll points are forfeited. The room receives a `lastEvent` explaining what happened.
- Timer pauses while the current player is disconnected, up to 60 s; then the host chooses skip or end.

---

## 9. Persistence

### Local (IndexedDB)

```text
DB: farkle
  games:    id, mode, config, state, createdAt, updatedAt, status
  history:  index on updatedAt
  settings: key/value
  roster:   last players, last rules
  identity: playerId, displayName
```

- Write after every action, debounced 100 ms; flush on `pagehide`.
- Active game is the newest record with `status = "active"`.
- Completed games keep the full action log for recap/export; cap at 100 records.
- Migration: read `farkle.prototype.v1` from `localStorage` once, import the game, keep the old key for 30 days, then delete it.

### Server (SQLite)

- One `rooms` table with `id`, `state_json`, `log_json`, `seq`, `updated_at`, `expires_at`.
- Snapshot on every state change, debounced to at most one write per 2 s per room (WAL mode).
- On boot, load unexpired rooms into memory.
- No names or PII beyond display names; rooms are deleted at expiry. Logs retain room IDs, not names.

### Export

- A `GameRecord` is a single JSON document: config, players, final state, action log, schema version.
- Export is available from History and from the error-recovery screen.
- Import is P2; the format is designed to allow it.

---

## 10. Security and abuse

| Threat | Mitigation |
| --- | --- |
| Forged roll | Server generates values; client `roll` is only an intent. |
| Forged score | Server computes from the selection; client scores are ignored. |
| Out-of-turn action | Server checks `playerId === currentPlayer` and phase. |
| Invalid selection | Engine validates full decomposability before applying. |
| Room code guessing | 30-bit codes, per-IP join rate limit, no room list. |
| Seat hijack | HMAC token bound to room + player + expiry. |
| Session theft | `HttpOnly`, `SameSite=Lax`, HTTPS-only session cookie; short expiry; rotate on sign-in. |
| Magic-link abuse | Single-use tokens, short TTL, rate limits per address and IP. |
| Name XSS | Strip HTML, cap 18 chars, render as text, CSP. |
| Spam/DoS | Per-socket action limit (10/s), per-IP join limit (5/min), payload size cap, idle close. |
| Data exposure | No PII beyond display names and, for accounts, an email address; room state visible only to members; TLS. |
| Dependency risk | Lockfile, `npm audit` in CI, Dependabot, minimal dependencies. |

No free-text chat in v1 removes the largest moderation surface. Emotes, when added, are a fixed set.

---

## 11. Performance

| Asset | Budget |
| --- | --- |
| Initial JS (app shell + React + engine) | ≤150 KB gzip |
| Dice chunk (three.js + cannon-es) | ≤250 KB gzip, lazy |
| CSS | ≤20 KB gzip |
| Fonts | 2 families, 3 weights, woff2 subset, self-hosted, ≤60 KB |
| LCP (mid-tier 4G) | ≤2.5 s |
| Time to first interaction | ≤2.5 s |
| Dice animation | 60 fps target; auto-2D below 40 fps sustained |
| Online action→render | p95 ≤250 ms |

Techniques:

- Route-level code splitting; the dice chunk loads only on a game screen.
- No image assets; the UI is type, CSS, and canvas.
- Self-hosted fonts with `font-display: swap`; preload the two used weights.
- The dice canvas is mounted once and never re-rendered by React; selection is applied imperatively.
- Memoize scoring per roll; the engine's search is small but called on every toggle.
- Avoid layout thrash in the scoreboard; use `content-visibility` for long history lists.

---

## 12. Testing

| Layer | What | Tool |
| --- | --- | --- |
| Scoring | Golden vectors for every combination, multiplier, straight, pairs, triplets | Vitest |
| Engine | Reducer transitions, invalid actions, hot dice, penalty, win, variants | Vitest |
| Engine | Property tests: invariants, termination, replay determinism | fast-check |
| Scorepad | Ledger totals, corrections, undo, win recomputation | Vitest |
| Components | Keypad, dice selection, lobby, presence, error states | Testing Library |
| E2E | Local game, resume, scorekeeping correction, online two-client game, reconnect | Playwright |
| Visual | Setup, game, scorepad, lobby, winner at 390×844 and desktop | Playwright screenshots |
| Server | Forged actions, out-of-turn, idempotency, TTL, host transfer | Vitest + ws clients |
| Load | 100 rooms, 6 players each, action latency | k6 or Artillery |
| A11y | axe on core routes; manual VoiceOver/TalkBack | axe-core + manual |

CI gates: typecheck → lint → unit → build → E2E smoke → preview deploy. Full E2E and load tests run nightly and before a milestone gate.

---

## 13. Migration plan (strangler)

1. **Build beside.** New app deploys to `/v2`; production stays on the current `index.html`.
2. **Port Local.** 2D first (M0), then 3D (M1). Compare behavior and play side by side; design review against the new spec.
3. **Migrate storage.** On first load of the new app, read `farkle.prototype.v1`, import the active game into IndexedDB, keep the old key for 30 days.
4. **Dogfood.** 20 games on real devices; log every behavior regression and design issue.
5. **Cut over.** Flip the production route to the new app; keep `/classic` for a short period.
6. **Retire.** Remove the old build only after a quiet stretch and a rollback rehearsal.

Rollback is a flag flip, not a redeploy. The old build and the old storage key remain valid during the window.

---

## 14. ADR index

| ADR | Decision | Consequence |
| --- | --- | --- |
| **001** | Re-platform to React + TypeScript; redesign the visual system; port dice physics and scoring | Moderate rewrite cost; design handoff and behavior regression; new design owned by the product designer |
| **002** | One scoring core, two turn reducers | No dead states in Scorekeeping; parity tests required across modes |
| **003** | Server-authoritative Online; choreographed dice presentation | Cheat-resistant and replayable; online dice are not true physics |
| **004** | Guest identity with signed reconnect tokens | Accounts are optional; clearing storage loses the seat; host reclaim flow |
| **005** | Full-state broadcast, not deltas | Simple, robust reconnect; bandwidth is trivial at turn-based pace |
| **006** | IndexedDB locally, SQLite snapshots on the server | Durable history and restart recovery; one native module to operate |
| **007** | Optional magic-link accounts | Cross-device continuity without passwords; adds email delivery and token lifecycle to operate |

---

## 15. Open technical questions

1. **Physics-assisted presentation.** Can corrective torque land dice on server values reliably enough to feel better than choreography? Spike in M4; keep choreography as the fallback.
2. **Node vs Durable Objects.** A single Fly machine is enough for 100 rooms. Revisit if rooms need multi-region edge presence or hibernation at scale.
3. **IndexedDB eviction.** Safari may evict site data under pressure. Mitigate with export, a "download backup" prompt after a completed game, and a persistent-storage request.
4. **Wake Lock on iOS Safari.** Supported in recent versions but can be released on backgrounding; re-acquire on `visibilitychange` and degrade gracefully.
5. **PWA update semantics.** Never auto-reload mid-game. Stage the new service worker, show "Refresh to update," and apply on the next safe navigation.
6. **Snapshot frequency.** Every action is simplest; measure write amplification at 100 rooms and batch if needed.
7. **Room recovery after deploy.** Snapshot-before-drain is required; test it with a synthetic room, not just unit tests.
8. **Name collisions.** Two "Ana"s in a room are allowed; disambiguate in the UI with a seat marker, not by forcing unique names.
