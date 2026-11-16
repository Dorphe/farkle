import { useRef, type ReactNode, type RefObject } from "react";
import {
  currentPlayer,
  diceLeft,
  pendingTotal,
  scoreSelection,
  selectedFaces,
  type DiceGameState,
  type Face,
} from "@farkle/engine";
import { DieButton, GhostDice, MiniDie } from "./Die.tsx";
import { BankFlash, useBankFlash } from "./BankFlash.tsx";
import { TopBar } from "./AppChrome.tsx";
import { avatarColor } from "@/lib/avatar.ts";

const fmt = (value: number) => value.toLocaleString("en-US");

export type GameTableProps = {
  game: DiceGameState;
  /** The viewer may keep, roll and bank this turn. False for a spectator, or
   *  for an online player waiting on someone else. */
  interactive: boolean;
  /** Whose turn it is, when the viewer cannot act. */
  waitingFor?: string;
  /** Dice are in the air — the roll caption and hint read "Rolling…". */
  busy?: boolean;
  /** Opt-in WebGL table; the flat grid is the default in the design. */
  use3D?: boolean;
  /** Host element for the WebGL table, so the owning screen can drive it. */
  tableHost?: RefObject<HTMLDivElement | null>;
  /** Suppress the placeholder dice while the 3D table is throwing them. */
  hideGhosts?: boolean;
  onToggle: (index: number) => void;
  onRoll: () => void;
  onBank: () => void;
  /** Absent for a viewer who cannot advance the turn. */
  onNextTurn?: () => void;
  onMenu: () => void;
  /** Extra control in the top bar (the online room code). */
  topbarExtra?: ReactNode;
  /** Strip under the top bar, e.g. a reconnect notice. */
  banner?: ReactNode;
  isOffline?: (index: number) => boolean;
  /** Left-hand control in the footer (the shake switch). */
  footLeft?: ReactNode;
  footNote: ReactNode;
  sectionRef?: RefObject<HTMLElement | null>;
  className?: string;
  label?: string;
  /** Sheets, dialogs and toasts drawn over the table. */
  children?: ReactNode;
};

/**
 * The table both local and online play on: top bar, other-player tabs, the
 * turn card, the dice card (roll / keeping / farkle), the rack and the footer.
 * Behaviour lives in the calling screen — this only renders the design and
 * derives the captions both modes share.
 */
export function GameTable({
  game,
  interactive,
  waitingFor,
  busy = false,
  use3D = false,
  tableHost,
  hideGhosts = false,
  onToggle,
  onRoll,
  onBank,
  onNextTurn,
  onMenu,
  topbarExtra,
  banner,
  isOffline,
  footLeft,
  footNote,
  sectionRef,
  className = "",
  label = "Game table",
  children,
}: GameTableProps) {
  const bankFlash = useBankFlash(game);
  const localRef = useRef<HTMLElement>(null);
  const root = sectionRef ?? localRef;

  const player = currentPlayer(game);
  const picked = selectedFaces(game);
  const selection = game.roll.length ? scoreSelection(picked, game.config) : 0;
  const total = pendingTotal(game) ?? 0;
  const left = diceLeft(game);
  const currentIndex = game.turn;
  const others = game.players
    .map((value, index) => ({ value, index }))
    .filter(({ index }) => index !== currentIndex);
  const farkle = game.phase === "turnEnd";

  let rollLabel = "Roll";
  let rollDisabled = true;
  if (!interactive) {
    rollLabel = `Waiting for ${waitingFor ?? player.name}`;
  } else if (busy || game.phase === "rolling") {
    rollLabel = "Rolling…";
  } else if (game.phase === "awaitingRoll") {
    rollLabel = left === 0 ? "All six kept" : `Roll ${left} ${left === 1 ? "die" : "dice"}`;
    rollDisabled = left === 0;
  } else if (game.phase === "awaitingKeep") {
    if (selection === null || picked.length === 0) {
      rollLabel = selection === null ? "Not a scoring set" : "Select dice to keep";
    } else {
      const remaining = 6 - game.kept.length - picked.length;
      rollLabel = remaining === 0 ? "Keep all six" : `Keep & roll ${remaining}`;
      rollDisabled = false;
    }
  }

  let bankDisabled = true;
  if (interactive && game.phase !== "gameOver") {
    if (game.phase === "awaitingKeep") bankDisabled = !(selection !== null && selection > 0);
    else if (game.phase === "awaitingRoll" && game.turnScore > 0) bankDisabled = false;
  }

  const hint =
    busy || game.phase === "rolling"
      ? "Rolling…"
      : !interactive
        ? `${player.name} is taking their turn.`
        : left === 0
          ? "All six dice are kept — bank to finish the turn."
          : game.phase === "awaitingKeep"
            ? "Tap scoring dice to keep them."
            : game.turnScore > 0
              ? `Roll the ${left} ${left === 1 ? "die" : "dice"} left.`
              : "Press Roll to start the turn.";

  // The dice the table shows: face-down placeholders while waiting, the roll
  // itself once it has landed.
  const showingRoll = game.phase === "awaitingKeep" && game.roll.length > 0;
  const ghosts = game.kept.length >= 6 ? 6 : 6 - game.kept.length;

  return (
    <section
      ref={root as RefObject<HTMLElement>}
      className={`screen game-screen ${className}`.trim()}
      aria-label={label}
    >
      <TopBar onMenu={onMenu}>{topbarExtra}</TopBar>
      {banner}

      {others.length ? (
        <div className="tabs" role="list" aria-label="Other players">
          {others.map(({ value, index }) => (
            <div className="tab" role="listitem" key={value.id}>
              <span className="tab-name">
                {value.name}
                {isOffline?.(index) ? " · offline" : ""}
              </span>
              <span className="tab-score">{fmt(value.score)}</span>
              {value.streak > 0 ? (
                <span className="sr-only">{value.streak} farkles in a row</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="turn-card-wrap">
        <div className="turn-card" key={game.turn}>
          <span
            className="avatar-lg"
            style={{ background: avatarColor(currentIndex) }}
            aria-hidden="true"
          >
            {player.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="turn-block">
            <span className="turn-name">{player.name}</span>
          </div>
          <div className="turn-score-block">
            <span className="turn-score">{fmt(player.score)}</span>
            <span className="turn-farkles" aria-hidden="true">
              {[0, 1, 2].map((dot) => (
                <i key={dot} className={dot < player.streak ? "on" : ""} />
              ))}
            </span>
            {player.streak > 0 ? (
              <span className="sr-only">{player.streak} farkles in a row</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="tray game-tray">
        <div className="table-card">
          <div className={`dice-area${use3D ? " is-3d" : ""}`}>
            <div className="dice-table" ref={tableHost} />
            {farkle ? (
              <div className="busted-dice" aria-hidden="true">
                {game.roll.map((face: Face, index: number) => (
                  <MiniDie key={index} face={face} />
                ))}
              </div>
            ) : null}
            {!farkle && !use3D
              ? showingRoll
                ? (
                    <div className="dice-grid" role="group" aria-label="Dice on the table">
                      {game.roll.map((face: Face, index: number) => (
                        <DieButton
                          key={`${index}-${face}`}
                          face={face}
                          index={index}
                          selected={game.selected[index] ?? false}
                          onToggle={onToggle}
                          disabled={!interactive}
                        />
                      ))}
                    </div>
                  )
                : !hideGhosts && <GhostDice count={ghosts} />
              : null}
            {!farkle && use3D && !showingRoll && !hideGhosts ? (
              <GhostDice count={ghosts} />
            ) : null}
            {use3D && showingRoll ? (
              <div className="sr-only" role="group" aria-label="Dice on the table">
                {game.roll.map((face, index) => (
                  <button
                    key={`sr-${index}-${face}`}
                    type="button"
                    aria-pressed={game.selected[index] ?? false}
                    aria-label={`Die ${index + 1}, value ${face}${
                      game.selected[index] ? ", kept" : ""
                    }`}
                    onClick={() => onToggle(index)}
                    disabled={!interactive}
                  />
                ))}
              </div>
            ) : null}
          </div>

          {farkle ? (
            <div className="farkle-stack">
              <span className="farkle-word">Farkle!</span>
              <span className="farkle-hint">You lose your turn.</span>
            </div>
          ) : (
            <p className={`keeping${selection !== null && selection > 0 ? " is-live" : ""}`}>
              {selection !== null && selection > 0 ? (
                <>
                  Keeping <b>{fmt(selection)}</b>
                </>
              ) : (
                <span className="keeping-hint">
                  {game.phase === "awaitingKeep"
                    ? selection === null
                      ? "Not a scoring set"
                      : "Tap dice to keep"
                    : hint}
                </span>
              )}
            </p>
          )}

          {farkle ? (
            onNextTurn ? (
              <button type="button" className="end-turn-btn" autoFocus onClick={onNextTurn}>
                Next player
              </button>
            ) : (
              <span className="farkle-hint">Waiting for {player.name} to continue…</span>
            )
          ) : (
            <button
              type="button"
              className="roll-btn"
              onClick={onRoll}
              disabled={rollDisabled || !interactive}
            >
              {rollLabel}
            </button>
          )}
        </div>

        {farkle ? null : (
          <div className="rack-card">
            <div className="rack-row">
              {Array.from({ length: 6 }, (_, slot) => {
                const face = game.kept[slot];
                return (
                  <span key={slot} className={`rack-slot${face !== undefined ? " is-filled" : ""}`}>
                    {face !== undefined ? <MiniDie face={face} /> : null}
                  </span>
                );
              })}
              <span className="rack-score" aria-label={`${fmt(game.turnScore)} on the table`}>
                {fmt(game.turnScore)}
              </span>
            </div>
            <button
              type="button"
              className="end-turn-btn"
              onClick={onBank}
              disabled={bankDisabled}
              aria-label={bankDisabled ? "End turn" : `End turn and bank ${fmt(total)}`}
            >
              End turn
            </button>
          </div>
        )}

        <BankFlash flash={bankFlash} />
      </div>

      <div className="game-foot">
        {footLeft ?? <span />}
        <span className="foot-note">{footNote}</span>
      </div>

      <p className="sr-only" aria-live="polite">
        {game.lastEvent?.text ?? ""}
      </p>

      {children}
    </section>
  );
}

/**
 * The footer note both modes share: farkle count, the target, and whether the
 * game has gone to sudden death.
 */
export function tableFootNote(game: DiceGameState) {
  const player = currentPlayer(game);
  return (
    <>
      {player.streak} / 3 farkles · {game.config.target.toLocaleString("en-US")} to win
      {game.suddenDeath ? " · sudden death" : ""}
    </>
  );
}
