import { useEffect, useRef } from "react";

export function GameMenu({
  mode,
  onClose,
  onRules,
  onLeave,
  onNewGame,
  onHistory,
  onSettings,
}: {
  mode: "home" | "local" | "score";
  onClose: () => void;
  onRules?: () => void;
  onLeave?: () => void;
  onNewGame?: () => void;
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

  const subtitle =
    mode === "home" ? "Farkle" : mode === "score" ? "Scorekeeping" : "Dice table";

  return (
    <div className="sheet-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sheet menu-sheet" role="dialog" aria-modal="true" aria-label="Menu">
        <div className="sheet-head">
          <div>
            <h2>Menu</h2>
            <p className="sheet-sub">{subtitle}</p>
          </div>
          <button ref={closeRef} type="button" className="sheet-close" onClick={onClose} aria-label="Close menu">
            ×
          </button>
        </div>

        <div className="menu-card">
          {onRules ? (
            <button type="button" className="menu-row" onClick={onRules}>
              <b>How to play</b>
              <span>Scoring table and house rules</span>
            </button>
          ) : null}
          {onLeave ? (
            <button type="button" className="menu-row" onClick={onLeave}>
              <b>Leave table</b>
              <span>Saved on this device — resume from setup</span>
            </button>
          ) : null}
          <button type="button" className="menu-row" onClick={onHistory}>
            <b>History</b>
            <span>Recaps of finished games</span>
          </button>
          <button type="button" className="menu-row" onClick={onSettings}>
            <b>Settings</b>
            <span>Sound, motion, dice, privacy</span>
          </button>
          {onNewGame ? (
            <button type="button" className="menu-row danger" onClick={onNewGame}>
              <b>New {mode === "score" ? "scorepad" : "game"}</b>
              <span>Ends this game and returns to setup</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
