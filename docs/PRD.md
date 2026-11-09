# Farkle — Product Requirements Document

**Status:** Draft v0.1 for review · **Owner:** Product · **Updated:** 7 Nov 2026
**Scope:** v1 — Local, Scorekeeping, Online
**Companions:** [Roadmap](./ROADMAP.md) · [Architecture](./ARCHITECTURE.md)

> This document is the source of truth for *what* Farkle does. The roadmap owns *when*; the architecture owns *how*. Requirement IDs are stable and should be cited in issues and PRs. **P0** blocks that mode's launch, **P1** is a fast-follow, **P2** is explicitly deferred.

---

## 1. Summary

Farkle is a browser-based dice game with three ways to play:

| Mode | Dice | Who scores | Best for |
| --- | --- | --- | --- |
| **Local** | App rolls (3D physics) | App | A table sharing one phone |
| **Scorekeeping** | Real dice | App, from the keeper's entry | A table with physical dice and a scorekeeper |
| **Online** | Server rolls | Server | Friends in different places |

All three share one scoring core, one visual language, and one promise: open the link, add names, play. No install, no account required.

---

## 2. Context

Today's app is a single-file prototype (`index.html`, ~1,550 lines) that does Local well: physics dice, full classic scoring, a one-screen mobile layout, and localStorage resume. It has proved the interaction model; the visual design is being redone.

It cannot support the next step. Scorekeeping needs a different turn model, a ledger, and corrections. Online needs a server, authoritative state, rooms, presence, and reconnect. Rule variants cut across all three. Adding that to a DOM-coupled single file would multiply states without a testable core.

The move is a re-platform plus a redesign: keep the validated interaction model and the physics dice; extract the rules into a pure, tested engine; build the three modes as views over it. The visual design is being redone by the product designer and is not specified here. The new shell is React 19 + TypeScript, decided in [Architecture §1](./ARCHITECTURE.md#1-decision-re-platform-and-redesign). The existing `index.html` remains the production app and the functional reference until the Local cutover (§12), then lives at `/classic` for a short period.

---

## 3. Goals and non-goals

### 3.1 Goals (first 12 months)

- **G1 — One rules core.** Every mode scores identically; a game is never scored differently because of where it runs.
- **G2 — Feature parity, then better.** Match today's Local feature set, then add resume reliability, accessibility, offline, history, and rule variants.
- **G3 — Scorekeeping is faster than paper.** Median time to log a real-dice turn ≤15 seconds, measured across 10 real table sessions.
- **G4 — Online works with friends.** Private rooms of 2–6, server-authoritative rolls and scoring, reconnect within 5 minutes, p95 action-to-render ≤250 ms.
- **G5 — Installable and offline.** Local and Scorekeeping play fully offline after first load; the app installs as a PWA.
- **G6 — Guest first, accounts optional.** Every mode is playable with only a display name; an optional magic-link account keeps identity and history across devices.

### 3.2 Non-goals (v1)

- Native iOS/Android apps (PWA only).
- Public matchmaking, ranked play, tournaments, leagues.
- Accounts beyond a magic-link sign-in; friends lists; social graph; cross-device live sync.
- Chat or voice; canned reactions are P2.
- Spectator mode.
- AI opponents.
- 5-dice Farkle or non-Farkle game variants.
- Monetization, ads, or paid tiers.
- Multiple simultaneous scorepads on one device.

---

## 4. Users and jobs

| Persona | Context | Job to be done |
| --- | --- | --- |
| **The table host** | Owns the phone, starts the game, keeps it moving | "Start fast, don't lose our game, settle disputes." |
| **The scorekeeper** | Has the pen today | "Log a turn in seconds and fix mistakes without an argument." |
| **The remote friend** | Joins from a link, plays between other things | "Tell me when it's my turn and don't lose my seat." |
| **The rule traditionalist** | Has house rules | "Set the target, entry, and penalties once and trust the app." |

Core jobs:

1. *When we're at a table with real dice, I want to keep score without arithmetic, so the game keeps moving.*
2. *When I'm playing remotely, I want the app to handle turn order and scoring, so we don't argue or lose track.*
3. *When I open the app mid-game, I want to be exactly where we left off.*

---

## 5. Product principles

1. **The table is the interface.** One screen during play, no scrolling, controls in thumb reach, totals legible across a table.
2. **Speed beats features.** A scorekeeping turn is ≤4 taps; a Local turn is roll → tap → roll/bank.
3. **The dice are the show.** Physics dice remain the signature. UI recedes; animation never blocks input longer than it must.
4. **Forgiving, not loose.** Mistakes are correctable; rules are enforced consistently; corrections are auditable.
5. **Trust the table, verify the game.** Online rolls and scoring are server-authoritative. Local play trusts the device.
6. **Guest first, no friction.** A name is enough. Identity is device-scoped by default; signing in is optional and never gates a game.
7. **Design is intentional.** The prototype is the functional reference; the new visual system is owned by the product designer. Engineering implements the delivered design; it does not invent a palette or a component language.
8. **Phone first, one-handed.** Nothing ships until it works on a 390×844 phone in the thumb zone.

---

## 6. Mode model

Mode is chosen when a game is created and stored on the game record. It never changes mid-game.

| Capability | Local | Scorekeeping | Online |
| --- | --- | --- | --- |
| Who supplies dice values | Device (physics) | Nobody — real dice | Server (CSPRNG) |
| Who computes scores | Device | Device, from keeper entry | Server |
| Players per game | 2–6 | 2–8 | 2–6 |
| State lives | Device (IndexedDB) | Device (IndexedDB) | Server + local cache |
| Network required | No | No | Yes |
| Account required | Optional | Optional | Optional (guest) |
| Turn timer | No | No | Optional |
| Undo | Last bank, 5 s | Full ledger undo/edit | Selection only |
| Rule variants | Yes | Yes | Host-set, locked at start |
| Resume | Yes | Yes | Reconnect |

**One scoring core, two turn models.** Local and Online share the dice-turn model (roll → keep → roll/bank). Scorekeeping uses a turn-total model (enter total or farkle → next). Both consume the same scoring table, validation, penalty, and win logic. See [Architecture §4](./ARCHITECTURE.md#4-module-boundaries).

---

## 7. Rules specification (normative)

### 7.1 Turn sequence (dice modes)

1. Roll all six dice.
2. If the roll contains no scoring die or combination → **farkle**: the turn ends immediately; unbanked turn points are lost.
3. Otherwise, set aside at least one scoring die or combination.
4. If all six dice are set aside → **hot dice**: all six return and the turn continues at step 1.
5. Otherwise, either roll the remaining dice (back to step 2) or **bank** the turn score.
6. Banking adds the turn score to the player's total and passes the turn.
7. First player to reach the target wins immediately (default).

### 7.2 Scoring table (canonical)

| Roll | Points |
| --- | --- |
| Single 1 | 100 |
| Single 5 | 50 |
| Three of a kind, face 2–6 | face × 100 (200–600) |
| Three 1s | 1,000 |
| Four of a kind | triple value × 2 |
| Five of a kind | triple value × 4 |
| Six of a kind | triple value × 8 |
| Straight 1–6 | 1,500 |
| Three pairs | 1,500 |
| Two triplets | 2,500 |

### 7.3 Selection semantics

- A selection is **valid** only if every selected die belongs to at least one scoring combination. Selecting a non-scoring die invalidates the whole selection.
- The engine scores a valid selection at its **maximum legal value**. Players choose *which dice* to keep, not how to decompose them.
- Players may keep a subset of the dice that could score (e.g., three 1s from four) and leave the rest on the table.
- Farkle is evaluated on the **full roll**, before any selection.
- Banking requires turn points > 0.
- Hot dice triggers at exactly six kept dice; it resets the kept pile but not the turn score.

### 7.4 Variants (v1)

| Setting | Options | Default | Behavior |
| --- | --- | --- | --- |
| Target score | 5,000 / 10,000 / 15,000 / custom 1,000–50,000 | 10,000 | First to reach or exceed wins (default). |
| Entry threshold | 0 / 500 / 1,000 | 0 | A player with 0 total who banks below the threshold scores 0 for that turn. |
| Straight 1–6 | 1,500 / 1,000 / 3,000 / off | 1,500 | Value of a six-die straight. |
| Three pairs | on / off | on | 1,500 when enabled. |
| Two triplets | on / off | on | 2,500 when enabled. |
| Farkle penalty | −1,000 / off | −1,000 | Applied on the third consecutive farkle; score floors at 0. |
| Hot dice | on / off | on | All six scoring dice return. |
| Win condition | first to target / complete the round | first | "Complete the round" gives every player equal turns, then highest score wins. |
| First player | player 1 / random | player 1 | Chosen at setup. |

**Presets**

| Preset | Target | Entry | Straight | Penalty | Hot dice |
| --- | --- | --- | --- | --- | --- |
| **Classic** | 10,000 | 0 | 1,500 | −1,000 | on |
| **Bar rules** | 10,000 | 500 | 1,500 | −1,000 | on |
| **Family** | 5,000 | 0 | 1,500 | off | on |
| **Custom** | any | any | any | any | any |

Rules are locked when an Online game starts. Local and Scorekeeping rules can be changed only by starting a new game.

### 7.5 Edge cases (normative)

- The three-farkle penalty never reduces a score below 0; the penalty is `min(1,000, score)`.
- A farkle on the first roll of a turn is the same as any other farkle.
- A farkle streak persists across other players' turns; it resets only when that player banks or takes the penalty.
- With an entry threshold, a below-threshold bank is allowed but adds 0; the turn passes.
- With "complete the round," a player who reaches the target is marked, play continues until every player has had the same number of turns, then the highest total wins. Ties play one sudden-death turn each; repeat if still tied.
- A scorekeeping correction that invalidates a win reopens the game without rewinding turn order.
- Online disconnects never change scoring rules; the turn-timer policy applies.

### 7.6 Determinism and audit

- The engine is a pure reducer: `reduce(state, action) → state`. No DOM, network, clock, or randomness inside.
- Every transition is appended to an action log with a monotonic sequence number.
- Online games store the roll values and action log; a game can be replayed from `config + log`.
- Local and Scorekeeping games store their logs with the game record; exports include them.

---

## 8. Functional requirements

### 8.1 Shared platform

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| PLT-01 | Mode selection | P0 | From a cold open, Local, Scorekeeping, and Online are each reachable in ≤2 taps; an active game shows **Resume** first. |
| PLT-02 | Resume | P0 | After a reload or app kill mid-turn, the same mode, players, scores, turn, dice, and selection return in ≤2 s with no dialog. |
| PLT-03 | History | P1 | The last 100 finished games are listed with mode, date, players, final scores, and winner; tapping opens a read-only recap. |
| PLT-04 | Settings | P1 | Sound, haptics, motion, dice style (auto/3D/2D), and analytics opt-out persist and apply immediately. |
| PLT-05 | Installable and offline | P0 | After first load, the app installs to the home screen; Local and Scorekeeping start, play, and finish with the network off; Online shows an explicit offline state. |
| PLT-06 | Accessibility | P0 | A full game is playable with the keyboard alone; screen readers announce turn, roll, and banked totals; reduced motion replaces the dice tumble with a ≤200 ms reveal; all text meets WCAG 2.1 AA. |
| PLT-07 | Guest playable | P0 | Every mode is playable as a guest with only a display name; no email, password, or sign-in wall. |
| PLT-08 | Error recovery | P0 | A render or storage error shows a recoverable screen with **Resume** and **Export**; no active game is silently discarded. |
| PLT-09 | Share result | P1 | A finished game produces a shareable summary (text + image) via the native share sheet; no personal data beyond display names. |
| PLT-10 | Privacy | P0 | Analytics are cookieless and exclude names, email addresses, room codes, and free text; users can opt out; a plain-language privacy page is linked in Settings. |
| PLT-11 | Optional accounts | P1 | A player can sign in with an email magic link to keep their display name and history across devices; no password, no profile, no social features; every mode remains playable without signing in. |

### 8.2 Rules core

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| RUL-01 | Canonical scoring | P0 | §7.2 is implemented exactly; golden-vector tests cover every combination and multiplier. |
| RUL-02 | Selection validity | P0 | A selection is accepted only if every selected die belongs to a scoring combination; the engine returns the maximum legal score for that selection. |
| RUL-03 | Farkle detection | P0 | A roll with no scoring die or combination ends the turn immediately and forfeits unbanked points. |
| RUL-04 | Hot dice | P0 | Keeping all six dice restores all six to the next roll without ending the turn or losing turn points. |
| RUL-05 | Farkle penalty | P0 | Three consecutive farkles apply −1,000 once, reset the streak, and never reduce a score below 0. |
| RUL-06 | Win | P0 | A bank that reaches the target ends the game immediately (default); the winner screen shows final scores. |
| RUL-07 | Variants and presets | P0 | Every setting in §7.4 is configurable; Classic, Bar, Family, and Custom presets are available; the rules screen reflects the active variant. |
| RUL-08 | Pure engine | P0 | The engine is a pure reducer with serializable, versioned state and no DOM/network imports; the same log replays to the same state. |
| RUL-09 | Rule tests | P0 | Property tests assert score ≥0, empty selection = 0, farkle iff best score = 0, termination, and replay determinism. |
| RUL-10 | Score explanation | P1 | The UI can show which combinations produced a selection's score (e.g., "two triplets 2,500" vs "two triples 500"). |

### 8.3 Local mode

*Experience: the current game, with fewer sharp edges. Roll on a physical table, tap the dice you keep, bank before the farkle. The phone is the table.*

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| LOC-01 | Players | P0 | 2–6 players, names 1–18 characters, optional color; add, remove, and reorder before start. |
| LOC-02 | 3D dice | P0 | Six physics dice settle in ≤2.5 s; each value is the top face; no visible interpenetration at rest. |
| LOC-03 | 2D fallback | P0 | If WebGL fails or is unavailable, flat dice with the same tap/keyboard behavior appear automatically; no error dialog. |
| LOC-04 | Keep dice | P0 | Tapping a die toggles keep; keyboard 1–6 mirrors it; selected dice and their score are visually distinct. |
| LOC-05 | Actions | P0 | Roll is disabled while dice move; Bank is disabled until the selection is legal and turn points >0; Roll commits the selection and rolls the remainder. |
| LOC-06 | HUD | P0 | Current player, turn score, selected score, farkle count (x/3), target, and remaining dice are visible without scrolling on a 390×844 phone. |
| LOC-07 | Shake | P1 | Shake-to-roll is opt-in, requests motion permission on tap, ignores shakes while dice move, and never rolls illegally. |
| LOC-08 | Resume | P0 | PLT-02 applies; dice positions may reset but values and game state must not. |
| LOC-09 | Undo bank | P1 | A 5 s snackbar restores the exact pre-bank turn (scores, kept dice, roll) if the game is not over. |
| LOC-10 | Rematch | P1 | Rematch keeps players and rules, resets scores, and alternates the first player. |
| LOC-11 | Leave/end | P0 | Leaving an active game requires confirmation and preserves it for resume; ending it archives the result. |
| LOC-12 | Performance | P0 | Dice animation holds 60 fps on the target device matrix; first interaction is available in ≤2.5 s on mid-tier 4G. |
| LOC-13 | Sound and haptics | P1 | Dice, bank, and farkle cues are on by default; a single mute toggle persists; cues respect reduced motion and never block input. |

### 8.4 Scorekeeping mode

*Experience: a keeper's card, not a game board. Big totals, a keypad, one button for a farkle. It should feel like writing on paper, but faster and harder to get wrong.*

**Device model.** One shared scorepad device — the keeper's phone or a tablet at the table — is the v1 default. Every player sees the same scorepad when it is passed or propped up. A *multi-device* scorepad (each player joins from their own phone and logs their own turn) is not v1; it reuses the room infrastructure and is a post-launch item.

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| SCR-01 | Setup | P0 | 2–8 players, target, preset/custom rules, first player (pick or random); last roster is pre-filled. |
| SCR-02 | No dice | P0 | Scorekeeping never simulates dice or asks for individual die values; it records one outcome per turn (banked total or farkle). |
| SCR-03 | Turn entry | P0 | A turn total is entered with a keypad and quick chips (+50/+100/+300/+500/+1,000); logging a turn takes ≤4 taps (≤2 with a chip) and advances to the next player. |
| SCR-04 | Farkle | P0 | A dedicated Farkle button logs a 0-point turn, increments the player's streak, and applies the penalty on the third. |
| SCR-05 | Ledger | P0 | Every action is an immutable entry with player, type, signed delta, timestamp, and resulting total; entries are never edited in place. |
| SCR-06 | Derived totals | P0 | Totals and streaks are derived from the ledger; a correction recomputes every later total and the winner. |
| SCR-07 | Undo | P0 | Undo reverses the last action (10 levels) within 200 ms and is itself recorded; a 5 s snackbar offers it after each log. |
| SCR-08 | Correct | P0 | Any past entry can be corrected with confirmation; the log shows original, correction, and time; a corrected win reopens the game. |
| SCR-09 | Win | P0 | Reaching the target shows the winner; with "finish the round" on, play continues until equal turns, then highest score wins; ties go to sudden death. |
| SCR-10 | Table display | P1 | A full-screen scoreboard shows all totals in large type, highlights the current player, keeps the screen awake, and works in landscape. |
| SCR-11 | Resume | P0 | A scorepad survives reload/kill and restores the current player and ledger. |
| SCR-12 | Share | P1 | The final scorecard can be shared as text/image. |
| SCR-13 | Offline | P0 | The entire mode works with no network after first load. |
| SCR-14 | Speed gate | P0 | In 10 real table sessions, median time to log a turn is ≤15 s and no session loses data. |

### 8.5 Online multiplayer

*Experience: the same table, with seats. A private room, a link, a short lobby, then play. Remote dice are choreographed to the server's result; the board is authoritative and always in sync.*

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| ONL-01 | Create room | P0 | Host sets rules, max players (2–6), and optional turn timer; the room gets a 4-character code and an invite link. |
| ONL-02 | Join | P0 | A link or code opens the room; a guest enters a name and taps Ready; invalid, expired, or full codes show a clear message and a path back. |
| ONL-03 | Lobby | P0 | All players, host badge, rules summary, and ready states are visible; the host can start with ≥2 ready players. |
| ONL-04 | Authority | P0 | The server generates every roll and computes every score; a forged client roll or score is rejected and cannot change state. |
| ONL-05 | Sync | P0 | Every action produces a monotonic state version; remote clients render it within 250 ms p95 on a 20 ms RTT link; stale versions are discarded. |
| ONL-06 | Presence | P0 | Connected, disconnected, and away states are visible for every player. |
| ONL-07 | Reconnect | P0 | Closing for ≤5 minutes and reopening the link restores the same seat, scores, and turn with no duplicate player. |
| ONL-08 | Turn ownership | P0 | Only the current player can roll, toggle, keep, or bank; everyone else sees a read-only board. |
| ONL-09 | Dice presentation | P0 | All clients animate the same server values and land on them; no client can influence the values. |
| ONL-10 | Timer | P1 | Optional 30/60/90 s timer; on expiry, committed turn points are banked or, if none, the turn farkles; the room is told. |
| ONL-11 | Disconnect | P1 | A disconnected current player pauses the table for up to 60 s; the host can then skip the turn or end the game. |
| ONL-12 | Host controls | P1 | Start, skip, kick, end, and rematch; host transfers to the next connected player if the host leaves. |
| ONL-13 | Rematch | P1 | Same room and players, scores reset, first player rotates; players who decline can leave. |
| ONL-14 | Lifecycle | P0 | Idle rooms expire after 2 h, empty rooms after 10 min, and codes are not reused for 24 h. |
| ONL-15 | Abuse | P0 | Per-socket and per-IP rate limits, 18-character names, HTML stripped, and no free-text chat in v1. |
| ONL-16 | Errors | P0 | Full room, expired code, version mismatch, and server error each show a specific, recoverable message. |
| ONL-17 | History | P2 | Finished online games are stored on-device with the same recap as Local. |

### 8.6 Cross-mode

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| X-01 | Engine parity | P0 | The same scoring vectors produce identical results in Local, Scorekeeping, and Online. |
| X-02 | Design consistency | P0 | New screens use the design system delivered by the product designer; engineering does not invent tokens or a component language. |
| X-03 | Record schema | P0 | All modes write the same `GameRecord` envelope with a `mode` discriminator and schema version. |

---

## 9. UX

### 9.1 Information architecture

| Route | Screen |
| --- | --- |
| `/` | Home: Resume (if any), three mode cards, history/settings links |
| `/local/setup` | Players, house rules, start |
| `/local/game` | Dice table and HUD |
| `/score/setup` | Players, target, rules, first player |
| `/score/game` | Scorepad and keypad |
| `/score/board` | Full-screen table display |
| `/online` | Create or join |
| `/room/:code` | Lobby or live game (deep link) |
| `/history` | Finished games |
| `/settings` | Sound, motion, dice, privacy |
| `/rules` | Variant-aware rules |

Rules:

- `/room/:code` works logged out and from a cold start; the join sheet appears over the room.
- Browser Back never silently loses a game; leaving an active game confirms.
- Active game state is persisted, not encoded in the URL. The URL identifies the mode or room, not the turn.

### 9.2 Key flows

**Local.** Home → Local → add players → (house rules) → Start → Roll → tap scoring dice → Roll/Bank → next player → winner → Rematch.

**Scorekeeping.** Home → Keep score → players/target → Start → current player enters total → Log turn → next player. Farkle is one button. Undo is always one tap away.

**Online.** Home → Play online → create/join → lobby → Ready → host starts → turn loop → winner → Rematch.

### 9.3 Scorekeeping screen (wireframe)

```text
┌──────────────────────────────────────┐
│ ←  Keep score            10,000  ⚙  │
├──────────────────────────────────────┤
│  ANA        3,200     ●  CURRENT     │
│  BEN        1,450                    │
│  CLEO       2,900                    │
├──────────────────────────────────────┤
│              ANA'S TURN              │
│                + 0                   │
│   [50] [100] [300] [500] [1,000]     │
│    1    2    3                       │
│    4    5    6                       │
│    7    8    9                       │
│    0   00    ⌫                       │
│   [ FARKLE ]      [ LOG TURN ]       │
├──────────────────────────────────────┤
│  Last: Ben +450 → 1,450      Undo    │
└──────────────────────────────────────┘
```

The keypad uses tabular numerals. Totals use the serif face, like a written scorecard. Farkle is the only destructive action and is visually distinct.

### 9.4 Design system

**Design ownership.** The visual design is owned by the product designer. The tokens below are the current prototype's reference, not a mandate for the redesign. Engineering implements the delivered design as a token layer and does not invent a palette. The new design must meet the accessibility requirements in §9.5.

If the redesign keeps the current tokens, these contrast fixes are required:

| Token | Current | Use | Change |
| --- | --- | --- | --- |
| `--paper` | `#F3EEE3` | Page | — |
| `--paper-2` | `#EAE3D4` | Sheets | — |
| `--ink` | `#16140F` | Primary text | — |
| `--ink-soft` | `#3A352B` | Body | — |
| `--muted` | `#7B7363` | Micro-labels | **→ `#6B6353`** |
| `--accent` | `#C63B22` | Accent text, large display | **Text → `#B8341D`**; keep `#C63B22` for large display only |
| `--line` | `#D5CBB7` | Decorative rules | Keep for rules; **form borders → `#8A7D63`** |

Measured against the current palette:

- `--muted` on `--paper` = **4.06:1** — fails AA for 11 px labels. `#6B6353` gives **5.13:1** on paper and **4.65:1** on paper-2.
- `--accent` on `--paper` = **4.48:1** — 0.02 short of AA for normal text. `#B8341D` gives **5.12:1**.
- `--line` on `--paper` = **1.39:1** — below the 3:1 required for control boundaries. `#8A7D63` gives **3.84:1** on the dice fill, **3.16:1** on paper-2, and **3.49:1** on paper; use it for form-control borders and keep `--line` for non-interactive rules.
- Disabled controls are exempt from contrast minimums; do not change the disabled style.

Other prototype rules (reference; the designer may replace them):

- Display type: Instrument Serif, as today. UI type: Archivo. Numerals in the scorepad: tabular.
- Hard-shadow sheets (`8px 8px 0`) for setup cards and the scorepad; no soft shadows.
- Motion: dice physics is the signature; all other transitions ≤200 ms. Respect `prefers-reduced-motion`.
- Touch targets ≥44×44 px; primary actions in the bottom thumb zone.
- No new icon library; use text labels and simple glyphs.

### 9.5 Accessibility

- **Keyboard:** `R` roll, `B` bank, `1`–`6` toggle dice, `Esc` close modal, `Tab` reaches every control in order.
- **Screen readers:** dice are buttons named "Die 3, value 5, kept"; turn changes, roll results, and banked totals are announced via a polite live region; modals trap focus and restore it on close.
- **Motion:** a "Reduce motion" setting (and `prefers-reduced-motion`) replaces the 3D tumble with a 150 ms reveal; 2D dice remain fully playable.
- **Color:** never the only signal; selected dice use border, lift, and `aria-pressed`; current player uses weight and a marker, not just fill.
- **Zoom:** 200% text zoom without loss of function on setup, scorepad, and history.
- **Testing:** axe automated pass plus manual VoiceOver (iOS), TalkBack (Android), and NVDA (desktop) on the core flows.

### 9.6 Empty, error, and edge states

| State | Required behavior |
| --- | --- |
| No players | Start disabled; "Add at least two players." |
| One player | Start disabled with the same hint. |
| Max players reached | Add form disabled with "Table is full." |
| WebGL unavailable | Silent 2D fallback; Settings shows "3D unavailable." |
| Motion permission denied | Shake toggle explains and stays off; Roll still works. |
| Storage full/unavailable | In-memory play continues; persistent banner warns that the game won't survive a reload. |
| Room full / expired / not found | Specific message, code re-entry, and a link home. |
| Offline in Online mode | Banner + retry; board stays visible and read-only. |
| Reconnecting | "Reconnecting…" banner; input disabled; automatic retry with backoff. |
| Version mismatch | "This room is on a newer version. Refresh to join." |
| Server error | Recoverable toast + retry; no silent state loss. |

---

## 10. Non-functional requirements

| ID | Area | Requirement |
| --- | --- | --- |
| NFR-01 | Performance | Initial JS ≤150 KB gzip; the 3D dice chunk ≤250 KB gzip and lazy-loaded; LCP ≤2.5 s on mid-tier 4G. |
| NFR-02 | Frame rate | 60 fps dice animation on the target matrix; auto-switch to 2D if sustained <40 fps. |
| NFR-03 | Local latency | UI responds to a tap in <50 ms. |
| NFR-04 | Online latency | Action-to-render p95 ≤250 ms, p99 ≤500 ms, same region, 20 ms RTT. |
| NFR-05 | Reliability | Crash-free sessions ≥99.5%; no active game lost on reload, kill, or reconnect. |
| NFR-06 | Availability | Server 99.5% monthly; deploys drain rooms before restart. |
| NFR-07 | Compatibility | Last 2 versions of Safari iOS, Chrome Android, Chrome/Edge/Firefox desktop. |
| NFR-08 | Security | TLS, schema validation on every message, rate limits, CSP, dependency audit, no secrets in the client. |
| NFR-09 | Privacy | No cookies for analytics; no PII beyond display names; local data is user-controlled and deletable. |
| NFR-10 | Cost | <$25/month at 100 concurrent rooms. |
| NFR-11 | Observability | Structured logs, error tracking, room/game metrics, health endpoint, uptime check. |
| NFR-12 | Maintainability | Engine coverage ≥90%; typecheck, lint, unit, and E2E gates in CI. |

---

## 11. Metrics

**North star:** weekly completed games across all modes.

| Area | Metric | Initial target |
| --- | --- | --- |
| Local | Started → completed | ≥60% |
| Local | D7 return | ≥20% |
| Scorekeeping | Median seconds per turn | ≤15 s |
| Scorekeeping | Entries corrected | <5% |
| Scorekeeping | Sessions per active table per month | ≥3 |
| Online | Room created → game started | ≥60% |
| Online | Started → completed | ≥70% |
| Online | Average players per room | ≥3 |
| Online | Reconnect success | ≥95% |
| Online | p95 action-to-render | ≤250 ms |
| Quality | Crash-free sessions | ≥99.5% |

Events: `mode_selected`, `game_started`, `turn_logged`, `farkle`, `bank`, `undo`, `correction`, `room_created`, `room_joined`, `online_game_started`, `reconnect`, `error`. Properties: mode, player count, rules preset, duration, platform. Never names or room codes.

Targets are hypotheses; revisit after four weeks of real use.

---

## 12. Release criteria

### Local (replaces today's app)

- Every current feature works, plus resume reliability, history, settings, and offline.
- 20 dogfood games completed with no P0/P1 bugs.
- Visual regression approved against the new design on setup, game, rules, and winner screens.
- Installs on iOS and Android; offline verified; performance budget met; axe pass with no critical issues.
- Rollback: keep the previous build at `/classic` for a short period.

### Scorekeeping

- 10 real table sessions; median turn entry ≤15 s; zero lost sessions.
- Undo and correction verified on a game with a disputed win.
- Works offline; table display keeps the screen awake.
- Share output is legible and contains no room codes or analytics IDs.

### Online

- 20 remote games across at least 3 devices; zero desyncs.
- p95 ≤250 ms and reconnect ≤5 s verified on a throttled link.
- Forged-roll and forged-score tests rejected by the server.
- 100 concurrent rooms load test; room TTL and code reuse verified.
- Security review: validation, rate limits, name sanitization, dependency audit.
- Runbook: deploy, drain, rollback, room recovery, incident contact.

### Cross-cutting

- Analytics events fire once and only once per action.
- Error tracking receives a synthetic error from production.
- Privacy page and rules page published.
- Accessibility manual pass on iOS and Android.

---

## 13. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Redesign loses the validated interaction feel | High | High | Keep the dice physics and tap-to-keep model; behavior regression tests; design review on real devices; no shell change without a design review. |
| Design handoff and engineering drift | Medium | Medium | Token layer plus component specs; design review at each gate; no engineering-invented palette. |
| Online dice feel canned | Medium | Medium | Invest in choreographed presentation; test with players; spike physics-assisted landing in M4. |
| Rule-variant scope creep | High | Medium | Freeze the v1 variant list in §7.4; custom rules later. |
| Server operations burden | Medium | Medium | Single process, managed host, SQLite snapshots, runbook, room TTL. |
| Reconnect and identity edge cases | Medium | High | Signed tokens, seat reclaim flow, integration tests with two clients. |
| Mobile Safari quirks (WebGL, PWA, wake lock) | Medium | Medium | Device matrix, feature detection, 2D fallback, graceful degradation. |
| Cheating in Online | Low | Medium | Server-authoritative rolls and scoring; validate every action; rate limits. |
| Data loss on device | Low | High | IndexedDB, export, crash-safe writes, resume tests. |
| Low Online adoption (cold start) | Medium | Medium | Private rooms only; invite links; no matchmaking dependency. |
| Accessibility debt | Medium | Medium | A11y in Definition of Done; automated axe plus manual passes each milestone. |

---

## 14. Decisions and open questions

Decided items are recorded so this document is the source of truth. Open items carry a default so work can proceed without waiting.

| # | Decision | Status | Call | Needed by |
| --- | --- | --- | --- | --- |
| D1 | Accounts at launch? | Decided | **Yes, but simple.** Email magic link only; no passwords, no OAuth, no profiles. Guest play remains the default. If the spike is not cheap, ship in M5. | M3 |
| D2 | Public matchmaking? | Decided | **No.** Private rooms and invite links only. | M3 |
| D3 | Scorekeeping on multiple phones? | Decided | **One shared scorepad device.** The keeper's phone or a table tablet is passed or propped up; each player logging from their own phone is a later room-based feature. | M2 |
| D4 | Turn timer default? | Decided | **Off.** Host can enable 30/60/90 s. | M3 |
| D5 | Sound default? | Decided | **On.** Cues are on by default; a single mute toggle persists and reduced motion is respected. | M1 |
| D6 | Exact-score finish variant? | Decided | **P2.** Adds edge cases; not needed for v1. | M2 |
| D7 | Analytics provider? | Open | **Plausible or self-hosted Umami**, cookieless. | M1 |
| D8 | Server host? | Open | **Fly.io single region** for v1; Cloudflare Durable Objects if edge/scale demands it. | M3 |
| D9 | Keep 3D on low-end devices? | Open | **Auto-detect**; fall back to 2D below 40 fps or without WebGL. | M1 |
| D10 | Max Online players? | Decided | **6.** Matches six dice and the current table. | M3 |
| D11 | Rematch behavior? | Decided | **Same room, reset scores, rotate first player.** | M4 |
| D12 | Chat or emotes? | Decided | **Neither in v1**; six canned emotes in M5. | M4 |

---

## 15. Out of scope / future

- Accounts beyond magic-link sign-in; cross-device live sync; friends; profiles.
- Public rooms, matchmaking, rankings, seasons.
- Tournaments, leagues, spectator mode, replays.
- Chat, voice, moderation tooling.
- AI opponents, hints, or auto-play.
- 5-dice and alternate game variants.
- Dice-assist Scorekeeping entry (tap the faces you rolled; the app computes the total).
- Multi-device Scorekeeping (each player logs their own turn from their phone).
- Native app wrappers.
- Monetization.

---

## Appendix A — Glossary

| Term | Meaning |
| --- | --- |
| **Farkle** | A roll with no scoring dice; the turn ends and unbanked points are lost. |
| **Hot dice** | All six dice kept as scoring; all six return for the next roll. |
| **Turn score** | Points accumulated but not yet banked. |
| **Bank** | Commit the turn score to the player's total and end the turn. |
| **Entry threshold** | Minimum turn score needed for a player at 0 to get on the board. |
| **Scorepad** | A Scorekeeping game: players, ledger, totals. |
| **Room** | An Online game container with a code, seats, and server state. |
| **Seat** | A player's reserved place in a room, held through disconnects. |
| **Keeper** | The person entering scores in Scorekeeping mode. |
| **Keeper device** | The one phone or tablet that holds the shared scorepad in Scorekeeping mode. |
| **Multi-device scorepad** | A Scorekeeping game where each player joins from their own phone and logs their own turn; not v1. |
| **Presentation roll** | A cosmetic dice animation that lands on server-provided values. |

## Appendix B — Scoring examples

| Roll | Best score | Why |
| --- | --- | --- |
| `1` | 100 | Single 1. |
| `5, 5, 5` | 500 | Three 5s beats three singles (150). |
| `1, 1, 1` | 1,000 | Three 1s. |
| `1, 1, 1, 1` | 2,000 | Four 1s: 1,000 × 2. |
| `1, 1, 1, 1, 1, 1` | 8,000 | Six 1s: 1,000 × 8, beating two separate triples of 1s (2,000). |
| `2, 2, 2, 3, 3, 3` | 2,500 | Two triplets, beating 200 + 300. |
| `2, 2, 3, 3, 4, 4` | 1,500 | Three pairs. |
| `1, 2, 3, 4, 5, 6` | 1,500 | Straight, beating 1 + 5 (150). |
| `2, 2, 2, 2, 3, 3` | 400 | Four 2s; the pair of 3s does not score, so all six is invalid. |
| `1, 5, 2, 3, 4, 4` | 150 | 1 + 5; the pair of 4s does not score and there is no straight. |

---

## Change log

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 2026-11-07 | Initial draft: three modes, rules, requirements, UX, NFRs, release gates, open decisions. |
| 0.2 | 2026-11-07 | React confirmed; optional magic-link accounts; sound on by default; scorekeeping device model clarified. |
| 0.3 | 2026-11-07 | Redesign confirmed and owned by the product designer; prototype is the functional reference; visual parity replaced by design integration. |
