# Farkle — Roadmap

**Status:** Draft v0.1 · **Owner:** Product · **Updated:** 7 Nov 2026
**Companions:** [PRD](./PRD.md) · [Architecture](./ARCHITECTURE.md)

> This document owns *when* and *in what order*. Product behavior lives in the PRD; technical design lives in the Architecture doc. This is a solo hobby project: milestones are ordered by dependency, not by calendar. There is no week-by-week schedule; a milestone is done when its exit criteria pass.

---

## 1. Sequencing principles

1. **Engine before screens.** Every mode depends on the scoring core. Building it first makes the rest cheap and testable.
2. **Feature parity before new modes.** Prove the re-platform preserves the validated behavior before adding scope. Local is the reference.
3. **Ship Scorekeeping before Online.** It delivers real value with no backend, no operations, and no moderation surface. It also validates the ledger and correction model.
4. **Online last, but designed first.** The protocol and authority model are decided in M0 so the engine and client don't need rework.
5. **Cut over behind a flag.** The current app stays live until feature parity is signed off; the old build remains at `/classic` for a short period.
6. **No milestone ships without a demo.** Each gate is a real game, on a real phone, with real people.

---

## 2. Milestones at a glance

| Milestone | Depends on | Primary outcome |
| --- | --- | --- |
| **M0 — Foundation** | — | Playable skeleton in the new stack; rules engine proven |
| **M1 — Local rebuild & cutover** | M0 | Production runs the new app; feature parity and new design integrated |
| **M2 — Scorekeeping** | M1 (design system) | Real-dice scorepad launches |
| **M3 — Online alpha** | M0 (protocol frozen) | Private rooms playable with remote friends |
| **M4 — Online launch** | M2, M3 | Public Online launch with guardrails |
| **M5 — Post-launch** | M4 | Optional accounts, emotes, variants |

```text
M0 Foundation → M1 Local rebuild → M2 Scorekeeping → M3 Online alpha → M4 Launch → M5
```

M3 does not depend on M1 or M2. Build it after M0's protocol is frozen, either before or after Scorekeeping; the diagram shows the recommended order, not a hard constraint.

**Critical path:** M0 → M1 → M2 → M4. M3 does not depend on M1 or M2; it needs M0's engine and protocol frozen. With one person there is no parallel staffing plan — the order above is the sequence.

---

## 3. Milestone detail

### M0 — Foundation

**Outcome:** a new app that can play a full Local game with 2D dice, backed by a tested rules engine and a deploy preview.

**Scope**

- pnpm workspace, TypeScript strict, Vite, React, React Router, Zustand for session state.
- Design tokens and base components: current CSS as a placeholder in M0; the product designer's new system lands in M1.
- `packages/engine`: scoring table, selection validation, farkle, hot dice, penalty, win, variants, presets.
- `packages/engine`: dice-turn reducer and scorepad reducer skeletons.
- `packages/protocol`: Zod schemas and shared types for future Online.
- Local setup and game screens with 2D dice, IndexedDB persistence, resume.
- CI: typecheck, lint, unit, build, Playwright smoke; PR preview deploy.
- Error boundary, analytics stub, structured logging.

**Deliverables**

- Preview URL that plays Local end to end.
- Engine test suite with golden vectors and property tests.
- `docs/ARCHITECTURE.md` decisions accepted.
- Baseline bundle and performance report.

**Exit criteria**

- [ ] A full game to 10,000 is playable with 2D dice on the preview.
- [ ] Refresh mid-turn restores the exact state in ≤2 s.
- [ ] Engine branch coverage ≥90%; golden vectors for every scoring combination pass.
- [ ] Property tests run 10,000 generated games without invariant failure.
- [ ] Setup screen visual diff against production is approved as a placeholder; the new design lands in M1.
- [ ] CI gates are required on `main`; a PR cannot merge red.
- [ ] Production is untouched.

**Requirements covered:** RUL-01–RUL-09, PLT-01, PLT-02, PLT-07, PLT-08, X-01, X-03, LOC-01, LOC-03–LOC-06 (2D).

**Demo:** start a 3-player game, play to 10,000 with 2D dice, refresh mid-turn, resume, finish, rematch.

**Risks:** the engine's variant flags balloon; keep the v1 list in PRD §7.4 frozen.

---

### M1 — Local rebuild and cutover

**Outcome:** production runs the new app, with feature parity and the new design integrated.

**Scope**

- Design integration: the new tokens, components, and screen specs from the product designer; engineering does not invent a visual system.
- Port the 3D dice module: three.js + cannon-es bundled, lazy-loaded, imperative adapter, 2D fallback.
- Tap-to-keep, keyboard, shake-to-roll, sound/haptics (on by default with a mute toggle), settings, history, share result.
- Undo bank, rematch, leave/end confirmation.
- Accessibility: keyboard map, live regions, reduced motion, focus management, contrast verified against the new tokens.
- PWA: installable, offline shell, self-hosted fonts, update prompt that never interrupts a game.
- Visual regression suite for the new design: setup, game, rules, and winner.
- Strangler cutover: production flag, `/classic` fallback, rollback rehearsal.

**Deliverables**

- Production cutover with the old build available at `/classic`.
- Feature parity checklist signed off screen by screen.
- Visual regression approved against the new design.
- Device matrix results: iPhone Safari, Android Chrome, desktop Chrome/Safari/Firefox.
- Performance report against PRD §10 budgets.

**Exit criteria**

- [ ] Every current feature works, plus resume, history, settings, offline.
- [ ] 20 dogfood games completed; no P0/P1 bugs.
- [ ] Visual regression approved against the new design.
- [ ] 60 fps dice on iPhone 12 / Pixel 5; first interaction ≤2.5 s on mid-tier 4G.
- [ ] Initial JS ≤150 KB gzip; dice chunk ≤250 KB gzip.
- [ ] Installs on iOS and Android; offline verified; axe pass with no critical issues.
- [ ] VoiceOver and TalkBack manual pass on the core flow.
- [ ] Rollback to the old build rehearsed and documented.

**Requirements covered:** LOC-01–LOC-13, PLT-03–PLT-06, PLT-09, RUL-10.

**Demo:** install the PWA, play a game offline, kill the app mid-turn, resume, undo a bank, finish, share the result.

**Risks:** the 3D port is the most likely place to lose the physical feel; keep the module 1:1. The redesign changes the shell, so keep the dice module as the continuity anchor and design-review the new screens on real devices.

---

### M2 — Scorekeeping

**Outcome:** a real-dice scorepad that is faster and more trustworthy than paper.

**Scope**

- Setup: 2–8 players, target, preset/custom rules, first player, last roster pre-filled.
- Scorepad: keypad, quick chips, Farkle, Log turn, current player, running totals.
- Append-only ledger with derived totals, 10-level undo, and corrections with audit.
- Farkle streak and −1,000 penalty; entry threshold; finish-the-round and sudden death.
- Full-screen table display with wake lock and landscape.
- Resume, share, offline, quick start.
- Instrumentation: time per turn, correction rate, session length.

**Deliverables**

- Scorekeeping mode live behind a flag, then default-on.
- A correction flow validated on a disputed win.
- Table-display mode tested on a tablet and a TV-sized browser.

**Exit criteria**

- [ ] 10 real table sessions completed; median turn entry ≤15 s.
- [ ] Zero lost sessions across reload, kill, and offline.
- [ ] Editing an entry 5 turns back recomputes all later totals and the winner.
- [ ] Undo works 10 levels deep and is itself recorded.
- [ ] Farkle penalty floors at 0 and resets the streak.
- [ ] Table display keeps the screen awake for 30 minutes.
- [ ] Works fully offline after first load.

**Requirements covered:** SCR-01–SCR-14, PLT-05, RUL-05–RUL-07.

**Demo:** 4 players, log a full game; mis-log a turn, correct it, watch totals and the winner recompute; trigger a third farkle; open the table display.

**Risks:** correction semantics are the hard part. The ledger must be append-only and the derived view must resolve supersessions deterministically; test this before UI polish.

---

### M3 — Online alpha

**Outcome:** private rooms with remote friends, server-authoritative, reconnect-safe.

**Scope**

- `apps/server`: Fastify + WebSocket, room manager, guest identity, signed reconnect tokens.
- Server-side CSPRNG rolls, reducer-driven scoring, action validation, idempotency, rate limits.
- Protocol: create/hello, welcome, state, error, ping/pong; monotonic `seq`; full `RoomView` snapshots with presence folded into seats.
- Client: create/join, lobby, ready, presence, reconnect banner, read-only board for non-current players.
- Dice presentation: 2D dice land on server values (M3 start); choreographed 3D presentation and 2D fallback remain follow-up work.
- Host controls: start and host transfer; skip/end are follow-up.
- Room lifecycle: 4-character codes, in-memory ephemeral rooms, 2 h idle TTL, 10 min empty TTL.
- No server snapshots in v1: a restart ends live rooms.
- Integration tests with two clients; forged-action tests; 100-room load test.

**Deliverables**

- Alpha deployed to a staging URL with 20 invited testers.
- Protocol reference and room-state schema.
- Load-test report and latency dashboard.

**Exit criteria**

- [ ] 20 remote games across ≥3 devices; zero desyncs.
- [ ] p95 action-to-render ≤250 ms on a 20 ms RTT link.
- [ ] Reconnect within 5 minutes restores seat, scores, and turn; no duplicate player.
- [ ] Forged roll and forged score are rejected without state change.
- [ ] Out-of-turn actions are rejected.
- [ ] 100 concurrent rooms sustain without error; room TTL and code reuse verified.
- [ ] Server restart restores active rooms from snapshots within 30 s.
- [ ] Alpha testers complete a game without host intervention.

**Requirements covered:** ONL-01–ONL-09, ONL-14–ONL-16, PLT-05 (offline state), X-01.

**Demo:** create a room on desktop, join on two phones, play a full game, kill one phone's browser, reconnect, finish, rematch.

**Risks:** reconnect identity and seat reclaim are the sharp edges. Design the token and reclaim flow before building the lobby. Dice presentation may feel canned; schedule a playtest specifically for it.

---

### M4 — Online launch

**Outcome:** Online is public, with the guardrails and operations needed to keep it healthy.

**Scope**

- Turn timer (30/60/90 s), timeout policy, disconnect pause, host skip/kick, rematch.
- Rate limits per socket and IP; name sanitization; no free-text chat.
- Observability: room metrics, action latency, error rate, reconnect success, alerts.
- Security review: validation coverage, token handling, CSP, dependency audit.
- Runbook: deploy, drain, rollback, room recovery, incident contact.
- Onboarding: empty states, invite link preview, rules summary in lobby.
- Privacy page and terms; analytics opt-out.

**Deliverables**

- Public launch announcement and invite flow.
- 7-day soak report.
- Incident runbook and rollback rehearsal.

**Exit criteria**

- [ ] 7-day soak: crash-free sessions ≥99.5%, p95 latency stable.
- [ ] Turn timer and disconnect policy tested on real devices and slow networks.
- [ ] Kick, skip, host transfer, and rematch all work without orphaned rooms.
- [ ] Security review closed with no high-severity findings.
- [ ] Alerts fire on error rate, latency, and room-creation failure.
- [ ] Runbook and rollback tested by someone other than the author.
- [ ] Launch checklist signed.

**Requirements covered:** ONL-10–ONL-13, NFR-04, NFR-06, NFR-08, NFR-11.

**Demo:** a full game with a 30 s timeout, a mid-game kick, a host transfer, and a rematch.

**Risks:** operational surprises. Keep the first launch invite-only and watch the dashboards daily.

---

### M5 — Post-launch (ongoing)

Prioritize by metrics, not enthusiasm.

- Optional accounts: email magic link, no passwords, cross-device history. Build only if the spike is cheap.
- Six canned emotes.
- Public rooms/matchmaking (only if private-room supply is the bottleneck).
- Multi-device Scorekeeping (reuses rooms).
- More variants: exact-score finish, 5-dice Farkle.
- i18n and localized rules.
- Native wrappers if PWA limitations are proven, not assumed.

**Requirements covered:** PLT-11, ONL-17.

---

## 4. Relative size and build order

The PRD specifies 68 requirements: **52 P0, 15 P1, 1 P2**. The P0 count is the real launch surface. P1s are included where they are cheap and protect the experience; they can slip without blocking a milestone gate. P2s are explicitly post-launch.

This is a hobby project, so sizes are relative, not commitments. They are useful for ordering and for knowing what to cut when time is short.

| Milestone | Size | Why |
| --- | --- | --- |
| M0 Foundation | M | Engine + shell + CI; the engine is the unknown |
| M1 Local rebuild | M | Design integration, 3D port, PWA, a11y, cutover; the port is the risk |
| M2 Scorekeeping | S–M | Ledger + corrections + table display |
| M3 Online alpha | L | Server, protocol, lobby, reconnect |
| M4 Online launch | M | Timer, guardrails, ops |
| M5 Post-launch | ongoing | Optional accounts, emotes, variants |

**Critical path:** M0 → M1 → M2 → M4. M3 does not depend on M1 or M2; it needs M0's engine and protocol frozen. With one person there is no parallel staffing plan — the order above is the sequence.

**Build order rule:** M2 may start once M1's design system and component primitives are in place; it does not need the 3D dice work. M3 may start once M0's engine and protocol schemas are frozen.

---

## 5. Definition of Done

A requirement is done when:

- [ ] Its acceptance criteria in the PRD are verified.
- [ ] Unit/component tests cover the behavior; E2E covers the user path where relevant.
- [ ] Typecheck, lint, and build pass in CI.
- [ ] It works on the device matrix (iPhone Safari, Android Chrome, desktop).
- [ ] Keyboard and screen-reader behavior are verified for new controls.
- [ ] Analytics events fire once per action, with no PII.
- [ ] Error and empty states are designed, not left to default.
- [ ] Docs/ADR are updated if a decision changed.
- [ ] No P0/P1 bugs remain in the touched area.
- [ ] A rollback path exists for anything that changes production state.

---

## 6. Traceability

| Requirement group | M0 | M1 | M2 | M3 | M4 | M5 |
| --- | --- | --- | --- | --- | --- | --- |
| PLT-01, 02, 07, 08 | ✓ | | | | | |
| PLT-03, 04, 06, 09, 10 | | ✓ | | | | |
| PLT-11 | | | | | | ✓ |
| PLT-05 (offline/PWA) | | ✓ | ✓ | ✓ | | |
| RUL-01–09 | ✓ | | | | | |
| RUL-10 | | ✓ | | | | |
| LOC-01, 03–06 | ✓ (2D) | | | | | |
| LOC-02 | | ✓ (3D) | | | | |
| LOC-07–13 | | ✓ | | | | |
| SCR-01–14 | | | ✓ | | | |
| ONL-01–09, 14–16 | | | | ✓ | | |
| ONL-10–13 | | | | | ✓ | |
| ONL-17 | | | | | | ✓ |
| X-01, X-03 | ✓ | | | | | |
| X-02 | | ✓ | ✓ | ✓ | ✓ | |

---

## 7. Release and rollback

**Feature flags**

- `mode.local` (default on)
- `mode.scorekeeping` (off until M2 gate)
- `mode.online` (off until M4 gate)
- `dice.3d` (on, with auto-fallback)
- `online.timer` (off by default)

**Local cutover**

1. Deploy the new app to `/v2`; keep production untouched.
2. Run the feature parity checklist and visual regression.
3. Dogfood 20 games.
4. Flip `mode.local` to the new app at the production route.
5. Keep `/classic` for a short period; monitor errors and session length.
6. Retire `/classic` only after a quiet stretch.

**Online deploys**

1. Stop accepting new rooms.
2. Let active rooms finish or snapshot them.
3. Deploy; restore snapshots.
4. Resume room creation.
5. Verify with a synthetic two-client game.

**Rollback**

- Client: flip the flag; `/classic` remains available.
- Server: restore the last SQLite snapshot; rooms created after the snapshot are lost and users get a clear "room expired" message.
- Data: local games are never deleted by a rollback.

---

## 8. Working rhythm

- **No calendar cadence.** Ship a milestone when its gate passes; there is no weekly ceremony to keep.
- **Demo gate:** a real game on a real device, not a slide. If it cannot be demoed, it is not done.
- **Gate review:** exit criteria reviewed before the next milestone starts; no gate waived silently.
- **Post-launch:** a few weeks of metrics review, then monthly.
- **Backlog:** groom only after a gate; protect the current milestone from new scope.

---

## 9. Explicitly not sequenced

- Friends, profiles, social graph.
- Public matchmaking, rankings, seasons.
- Chat/voice/moderation.
- Spectators, replays, tournaments.
- AI opponents.
- Native apps.
- Monetization.

These are not "no forever"; they are "not before the three modes are solid."
