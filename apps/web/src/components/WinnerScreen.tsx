import type { DiceGameState } from "@farkle/engine";

export function WinnerScreen({
  game,
  onRematch,
  onScoreboard,
  onShare,
}: {
  game: DiceGameState;
  onRematch: () => void;
  onScoreboard: () => void;
  onShare: () => void;
}) {
  const winner = game.players.find((player) => player.id === game.winnerId) ?? game.players[0];
  if (!winner) return null;

  return (
    <div className="winner-screen" role="dialog" aria-modal="true" aria-label={`${winner.name} wins`}>
      <div className="winner-body">
        <span className="winner-kicker">GAME OVER</span>
        <div className="confetti" aria-hidden="true">
          <i style={{ background: "var(--avatar-1)", transform: "rotate(-8deg)" }} />
          <i style={{ background: "var(--avatar-2)", transform: "rotate(6deg)" }} />
          <i style={{ background: "var(--avatar-3)", transform: "rotate(-4deg)" }} />
          <i style={{ background: "var(--avatar-4)", transform: "rotate(10deg)" }} />
        </div>
        <div className="winner-stack">
          <span className="winner-name">{winner.name}</span>
          <span className="winner-verb">wins.</span>
        </div>
        <div className="score-block">
          <span className="score-value">{winner.score.toLocaleString("en-US")}</span>
          <span className="score-label">POINTS</span>
        </div>
        <span className="winner-sub">
          {game.config.winCondition === "first"
            ? `First to ${game.config.target.toLocaleString("en-US")}`
            : "Complete round"}{" "}
          · {game.players.length} {game.players.length === 1 ? "player" : "players"}
        </span>
        <button type="button" className="share-link" onClick={onShare}>
          Share result
        </button>
      </div>
      <div className="winner-actions">
        <button type="button" className="btn-primary" autoFocus onClick={onRematch}>
          Play again
        </button>
        <button type="button" className="btn-secondary" onClick={onScoreboard}>
          Scoreboard
        </button>
      </div>
    </div>
  );
}
