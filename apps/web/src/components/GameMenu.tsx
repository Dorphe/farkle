import { useEffect, useRef } from "react";

export function GameMenu({
  mode,
  onClose,
  onLeave,
  onNewGame,
  onHistory,
  onSettings,
}: {
  mode: "local" | "score";
  onClose: () => void;
  onLeave: () => void;
  onNewGame: () => void;
  onHistory: () => void;
  onSettings: () => void;
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

  return (
    <div className="sheet-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sheet menu-sheet" role="dialog" aria-modal="true" aria-label="Table menu">
        <div className="sheet-head">
          <div>
            <h2>Menu</h2>
            <p className="sheet-sub">{mode === "score" ? "Scorekeeping" : "Dice table"}</p>
          </div>
          <button ref={closeRef} type="button" className="sheet-close" onClick={onClose} aria-label="Close menu">
            ×
          </button>
        </div>

        <div className="menu-card">
          <button type="button" className="menu-row" onClick={onLeave}>
            <b>Leave table</b>
            <span>Saved on this device — resume from setup</span>
          </button>
          <button type="button" className="menu-row" onClick={onHistory}>
            <b>History</b>
            <span>Recaps of finished games</span>
          </button>
          <button type="button" className="menu-row" onClick={onSettings}>
            <b>Settings</b>
            <span>Sound, motion, dice, privacy</span>
          </button>
          <button type="button" className="menu-row danger" onClick={onNewGame}>
            <b>New {mode === "score" ? "scorepad" : "game"}</b>
            <span>Ends this game and returns to setup</span>
          </button>
        </div>
      </div>
    </div>
  );
}
