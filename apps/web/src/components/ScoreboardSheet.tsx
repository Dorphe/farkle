import { useEffect, useRef } from "react";
import type { Player } from "@farkle/engine";

export function ScoreboardSheet({
  players,
  winnerId,
  onClose,
}: {
  players: Player[];
  winnerId: string | null;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ranked = [...players].sort((a, b) => b.score - a.score);

  return (
    <div className="sheet-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Final scoreboard">
        <div className="sheet-head">
          <h2>Scoreboard</h2>
          <button ref={closeRef} type="button" className="sheet-close" onClick={onClose} aria-label="Close scoreboard">
            ×
          </button>
        </div>
        <div className="board-card">
          {ranked.map((player, index) => (
            <div key={player.id} className={`board-row ${player.id === winnerId ? "is-winner" : ""}`}>
              <span className="board-rank">{index + 1}</span>
              <span className="board-name">{player.name}</span>
              <span className="board-score">{player.score.toLocaleString("en-US")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
