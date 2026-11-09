import { useEffect, useMemo } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { deriveScorepad } from "@farkle/engine";
import { useSession } from "@/store/session.ts";
import { avatarColor } from "@/screens/SetupScreen.tsx";

const fmt = (value: number) => value.toLocaleString("en-US");

export function ScoreBoardScreen() {
  const navigate = useNavigate();
  const scorepad = useSession((state) => state.scorepad);
  const view = useMemo(() => (scorepad ? deriveScorepad(scorepad) : null), [scorepad]);

  useEffect(() => {
    type Sentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<Sentinel> };
    };
    let sentinel: Sentinel | null = null;
    let cancelled = false;
    void nav.wakeLock
      ?.request("screen")
      .then((lock) => {
        if (cancelled) void lock.release();
        else sentinel = lock;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      void sentinel?.release().catch(() => {});
    };
  }, []);

  if (!scorepad || !view) return <Navigate to="/score/setup" replace />;

  const current = scorepad.players.find((player) => player.id === view.currentPlayerId);
  const winner = scorepad.players.find((player) => player.id === view.winnerId);

  return (
    <section className="screen score-board-screen" aria-label="Table scoreboard">
      <header className="board-top">
        <span className="board-wordmark">FARKLE</span>
        <span className="board-target">{fmt(scorepad.config.target)} TO WIN</span>
        <button type="button" className="pill" onClick={() => navigate("/score/game", { replace: true })}>
          Back
        </button>
      </header>

      <div className="board-current">
        {view.phase === "gameOver" ? (
          <>
            <span className="board-kicker">GAME OVER</span>
            <span className="board-current-name">{winner?.name ?? "Winner"} wins</span>
          </>
        ) : (
          <>
            <span className="board-kicker">{view.suddenDeath ? "SUDDEN DEATH" : "NOW UP"}</span>
            <span className="board-current-name">{current?.name ?? "Player"}</span>
          </>
        )}
      </div>

      <div className="board-grid" role="list">
        {scorepad.players.map((player, index) => {
          const isCurrent = player.id === view.currentPlayerId && view.phase === "playing";
          return (
            <div
              key={player.id}
              role="listitem"
              className={`board-tile ${isCurrent ? "is-current" : ""} ${
                player.id === view.winnerId ? "is-winner" : ""
              }`}
            >
              <span className="board-avatar" style={{ background: avatarColor(index) }} aria-hidden="true">
                {player.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="board-tile-name">{player.name}</span>
              <span className="board-tile-score">{fmt(view.totals[player.id] ?? 0)}</span>
            </div>
          );
        })}
      </div>

      <footer className="board-foot">
        <span>{view.phase === "playing" ? "Screen stays awake while the board is open" : "Final scores"}</span>
        <span>{scorepad.config.winCondition === "first" ? "First to target" : "Complete round"}</span>
      </footer>
    </section>
  );
}
