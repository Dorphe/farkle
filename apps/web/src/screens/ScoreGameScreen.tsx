import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  deriveScorepad,
  type ComputedEntry,
  type ScorepadEntry,
  type ScorepadState,
} from "@farkle/engine";
import { useSession } from "@/store/session.ts";
import { avatarColor } from "@/screens/SetupScreen.tsx";
import { playCue, haptic } from "@/lib/audio.ts";
import { track } from "@/lib/analytics.ts";

const fmt = (value: number) => value.toLocaleString("en-US");

const QUICK = [50, 100, 300, 500, 1_000];
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"];

function playerName(state: ScorepadState, id: string): string {
  return state.players.find((player) => player.id === id)?.name ?? "Player";
}

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function ScoreGameScreen() {
  const navigate = useNavigate();
  const scorepad = useSession((state) => state.scorepad);
  const dispatchScore = useSession((state) => state.dispatchScore);
  const undoScore = useSession((state) => state.undoScore);
  const endScoreGame = useSession((state) => state.endScoreGame);

  const [entry, setEntry] = useState("");
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [correcting, setCorrecting] = useState<ScorepadEntry | null>(null);
  const [correctionValue, setCorrectionValue] = useState("");
  const [correctionKind, setCorrectionKind] = useState<"score" | "farkle">("score");
  const turnStarted = useRef(performance.now());

  const view = useMemo(() => (scorepad ? deriveScorepad(scorepad) : null), [scorepad]);

  useEffect(() => {
    setEntry("");
    turnStarted.current = performance.now();
  }, [view?.currentPlayerId]);

  if (!scorepad || !view) return <Navigate to="/score/setup" replace />;

  const current = scorepad.players.find((player) => player.id === view.currentPlayerId);
  const currentId = view.currentPlayerId;
  const currentName = current?.name ?? "Player";
  const entryValue = Number(entry) || 0;
  const currentTotal = view.totals[view.currentPlayerId] ?? 0;
  const belowEntry =
    currentTotal === 0 && entryValue > 0 && entryValue < scorepad.config.entryThreshold;
  const last = view.entries.at(-1);

  function pressKey(key: string) {
    haptic(5);
    if (key === "⌫") {
      setEntry((value) => value.slice(0, -1));
      return;
    }
    setEntry((value) => {
      const next = `${value}${key}`.replace(/^0+(?=\d)/, "");
      return next.slice(0, 6);
    });
  }

  function chip(amount: number) {
    haptic(6);
    setEntry((value) => String((Number(value) || 0) + amount).slice(0, 6));
  }

  function logTurn() {
    const total = Number(entry);
    if (!total || total <= 0) return;
    const seconds = Math.round((performance.now() - turnStarted.current) / 100) / 10;
    const result = dispatchScore({
      type: "logTurn",
      id: crypto.randomUUID(),
      at: Date.now(),
      playerId: currentId,
      kind: "score",
      total,
    });
    if (result.ok) {
      playCue("bank");
      haptic(12);
      setEntry("");
      track("turn_time", { seconds });
    }
  }

  function logFarkle() {
    const result = dispatchScore({
      type: "logTurn",
      id: crypto.randomUUID(),
      at: Date.now(),
      playerId: currentId,
      kind: "farkle",
      total: 0,
    });
    if (result.ok) {
      playCue("farkle");
      haptic([25, 35, 25]);
      setEntry("");
    }
  }

  function openCorrection(target: ScorepadEntry) {
    setCorrecting(target);
    setCorrectionKind(target.kind === "farkle" ? "farkle" : "score");
    setCorrectionValue(target.kind === "farkle" ? "" : String(target.total));
    setLedgerOpen(false);
  }

  function applyCorrection() {
    if (!correcting) return;
    const total = correctionKind === "farkle" ? 0 : Number(correctionValue);
    if (correctionKind === "score" && (!total || total <= 0)) return;
    const result = dispatchScore({
      type: "correct",
      id: crypto.randomUUID(),
      at: Date.now(),
      entryId: correcting.id,
      replacement: { kind: correctionKind, total },
    });
    if (result.ok) {
      playCue("bank");
      setCorrecting(null);
    }
  }

  function endGame() {
    if (!window.confirm("End this scorepad? The result is archived in History.")) return;
    dispatchScore({ type: "endGame", at: Date.now() });
    endScoreGame();
    navigate("/score/setup", { replace: true });
  }

  return (
    <section className="screen score-screen" aria-label="Scorepad">
      <header className="topbar">
        <span className="wordmark">Farkle</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="pill" onClick={() => navigate("/score/board")}>
            Board
          </button>
          <button type="button" className="pill" onClick={() => navigate("/rules")}>
            Rules
          </button>
        </div>
      </header>

      <div className="score-head">
        <span className="score-head-label">{fmt(scorepad.config.target)} TO WIN</span>
        <span className={`score-status ${view.suddenDeath ? "is-hot" : ""}`}>
          {view.suddenDeath ? "SUDDEN DEATH" : view.targetReached ? "FINAL ROUND" : "KEEPING SCORE"}
        </span>
      </div>

      <div className="score-players" role="list" aria-label="Scores">
        {scorepad.players.map((player, index) => {
          const total = view.totals[player.id] ?? 0;
          const streak = view.streaks[player.id] ?? 0;
          const isCurrent = player.id === view.currentPlayerId && view.phase === "playing";
          return (
            <div
              key={player.id}
              role="listitem"
              className={`score-player ${isCurrent ? "is-current" : ""}`}
              aria-current={isCurrent ? "true" : undefined}
            >
              <span className="avatar" style={{ background: avatarColor(index) }} aria-hidden="true">
                {player.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="score-player-name">{player.name}</span>
              {streak > 0 ? (
                <span className="score-streak" title="Consecutive farkles">
                  {[0, 1, 2].map((dot) => (
                    <i key={dot} className={dot < streak ? "on" : ""} />
                  ))}
                </span>
              ) : null}
              <span className="score-player-total">{fmt(total)}</span>
            </div>
          );
        })}
      </div>

      <div className="entry-card">
        <div className="entry-top">
          <span className="entry-label">{currentName.toUpperCase()}&apos;S TURN</span>
          <span className="entry-target">{view.phase === "playing" ? "TURN TOTAL" : "GAME OVER"}</span>
        </div>
        <div className="entry-display" aria-live="polite">
          +{fmt(entryValue)}
        </div>
        {belowEntry ? (
          <p className="entry-hint">Below the {fmt(scorepad.config.entryThreshold)} entry — scores 0.</p>
        ) : null}

        <div className="quick-chips">
          {QUICK.map((amount) => (
            <button key={amount} type="button" className="chip-chip" onClick={() => chip(amount)}>
              +{fmt(amount)}
            </button>
          ))}
        </div>

        <div className="keypad" role="group" aria-label="Score keypad">
          {KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={`key ${key === "⌫" ? "is-action" : ""}`}
              onClick={() => pressKey(key)}
              aria-label={key === "⌫" ? "Backspace" : key}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      <div className="score-actions">
        <button type="button" className="btn-action farkle" onClick={logFarkle} disabled={view.phase !== "playing"}>
          Farkle
        </button>
        <button
          type="button"
          className="btn-action primary"
          onClick={logTurn}
          disabled={view.phase !== "playing" || entryValue <= 0}
        >
          Log turn
        </button>
      </div>

      <div className="score-last">
        <span className="score-last-text">
          {last
            ? `Last: ${playerName(scorepad, last.playerId)} ${
                last.kind === "farkle" ? "farkle" : `+${fmt(last.total)}`
              } → ${fmt(last.resultingTotal)}`
            : "No turns logged yet"}
        </span>
        <div className="score-last-actions">
          <button type="button" className="mini-link" onClick={() => setLedgerOpen(true)}>
            Ledger
          </button>
          <button
            type="button"
            className="mini-link"
            onClick={() => {
              undoScore();
              playCue("keep");
            }}
            disabled={!view.undoable || view.undoDepth >= 10}
          >
            Undo
          </button>
        </div>
      </div>

      {ledgerOpen ? (
        <LedgerSheet
          state={scorepad}
          entries={view.entries}
          undoDepth={view.undoDepth}
          onCorrect={openCorrection}
          onEnd={endGame}
          onClose={() => setLedgerOpen(false)}
        />
      ) : null}

      {correcting ? (
        <CorrectionSheet
          player={playerName(scorepad, correcting.playerId)}
          original={correcting}
          kind={correctionKind}
          value={correctionValue}
          onKind={setCorrectionKind}
          onValue={setCorrectionValue}
          onConfirm={applyCorrection}
          onClose={() => setCorrecting(null)}
        />
      ) : null}

      {view.phase === "gameOver" ? (
        <div className="overlay score-winner" role="dialog" aria-modal="true" aria-label="Game over">
          <div className="overlay-inner">
            <span className="winner-kicker">GAME OVER</span>
            <span className="winner-name">{playerName(scorepad, view.winnerId ?? "")}</span>
            <span className="winner-verb">wins.</span>
            <div className="score-block">
              <span className="score-value">{fmt(view.totals[view.winnerId ?? ""] ?? 0)}</span>
              <span className="score-label">POINTS</span>
            </div>
            <span className="winner-sub">
              {view.manuallyEnded ? "Ended by the keeper" : `First to ${fmt(scorepad.config.target)}`}
            </span>
            <button type="button" className="share-link" onClick={() => setLedgerOpen(true)}>
              Review ledger
            </button>
          </div>
          <div className="winner-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                endScoreGame();
                navigate("/score/setup", { replace: true });
              }}
            >
              New scorepad
            </button>
            <button type="button" className="btn-secondary" onClick={() => navigate("/score/board")}>
              Scoreboard
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function LedgerSheet({
  state,
  entries,
  undoDepth,
  onCorrect,
  onEnd,
  onClose,
}: {
  state: ScorepadState;
  entries: ComputedEntry[];
  undoDepth: number;
  onCorrect: (entry: ScorepadEntry) => void;
  onEnd: () => void;
  onClose: () => void;
}) {
  return (
    <div className="sheet-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sheet ledger-sheet" role="dialog" aria-modal="true" aria-label="Turn ledger">
        <div className="sheet-head">
          <div>
            <h2>Ledger</h2>
            <p className="sheet-sub">
              {entries.length} turns · {undoDepth} undo{undoDepth === 1 ? "" : "s"}
            </p>
          </div>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close ledger">
            ×
          </button>
        </div>

        <div className="ledger-list">
          {entries.length === 0 ? (
            <p className="empty-state">No turns yet.</p>
          ) : (
            entries
              .slice()
              .reverse()
              .map((item) => (
                <div className="ledger-row" key={item.entry.id}>
                  <div className="ledger-main">
                    <span className="ledger-name">{playerName(state, item.playerId)}</span>
                    <span className={`ledger-amount ${item.kind === "farkle" ? "is-muted" : ""}`}>
                      {item.kind === "farkle" ? "Farkle" : `+${fmt(item.total)}`}
                    </span>
                  </div>
                  <div className="ledger-meta">
                    <span>
                      {timeLabel(item.entry.at)} · → {fmt(item.resultingTotal)}
                      {item.correctedBy ? " · corrected" : ""}
                    </span>
                    <button type="button" className="mini-link" onClick={() => onCorrect(item.entry)}>
                      Correct
                    </button>
                  </div>
                </div>
              ))
          )}
        </div>

        <div className="sheet-actions ledger-actions">
          <button type="button" className="ghost-link" onClick={onEnd}>
            End scorepad
          </button>
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function CorrectionSheet({
  player,
  original,
  kind,
  value,
  onKind,
  onValue,
  onConfirm,
  onClose,
}: {
  player: string;
  original: ScorepadEntry;
  kind: "score" | "farkle";
  value: string;
  onKind: (kind: "score" | "farkle") => void;
  onValue: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="sheet-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Correct ${player}'s turn`}>
        <div className="sheet-head">
          <div>
            <h2>Correct turn</h2>
            <p className="sheet-sub">
              {player} · logged {original.kind === "farkle" ? "farkle" : `+${fmt(original.total)}`} at{" "}
              {timeLabel(original.at)}
            </p>
          </div>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close correction">
            ×
          </button>
        </div>

        <div className="segmented correction-kind">
          <button type="button" className="seg" aria-pressed={kind === "score"} onClick={() => onKind("score")}>
            Score
          </button>
          <button type="button" className="seg" aria-pressed={kind === "farkle"} onClick={() => onKind("farkle")}>
            Farkle
          </button>
        </div>

        <input
          type="text"
          inputMode="numeric"
          className="correction-input"
          aria-label="Corrected turn total"
          value={kind === "farkle" ? "" : value}
          placeholder="Turn total"
          disabled={kind === "farkle"}
          onChange={(event) => onValue(event.target.value.replace(/[^\d]/g, "").slice(0, 6))}
        />

        <p className="settings-footnote">
          Later totals, streaks, and the winner are recomputed from the ledger.
        </p>

        <div className="sheet-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={kind === "score" && !Number(value)}
          >
            Save correction
          </button>
        </div>
      </div>
    </div>
  );
}
