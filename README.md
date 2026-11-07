# Farkle

A single-file, pass-and-play Farkle prototype. Open `index.html` in any browser — no build, no dependencies beyond Google Fonts (falls back to system serif/sans offline).

## What works

- Add 2–6 players and name them; start a game.
- Roll six dice, tap dice to keep, watch the selected set score live.
- Bank points or keep rolling with the dice that are left.
- Full classic scoring: singles, three-of-a-kind (×2/×4/×8 for four/five/six), straight, three pairs, two triplets.
- Farkle detection (no scoring dice = bust), hot dice when all six score, three farkles in a row = −1,000.
- First to 10,000 wins; scores, turn, and dice persist in `localStorage`, so a refresh doesn't lose the game.
- Keyboard: `R` roll, `B` bank, `1`–`6` toggle dice, `Esc` close rules.
- **Shake to roll** on phones: flip the switch under the action buttons, then shake. Shaking only rolls when a roll is actually legal (it commits a valid selection, or refuses while dice are still on the table).

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

## Structure

Everything lives in `index.html`: markup, CSS tokens, and a small state machine (`roll → keep → bank / bust`) with a memoized scoring search. Shake detection reads `devicemotion`, compares the acceleration magnitude frame to frame, and fires on a jump of >15 m/s² with a 1.1 s cooldown so one shake doesn't roll twice.
