import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

/**
 * The pen's `Top bar` component: wordmark on the left, one pill on the right.
 * The pill is labelled "Menu" in the design, and every table screen opens the
 * same sheet from it.
 */
export function TopBar({
  onMenu,
  menuLabel = "Menu",
  label = "Table menu",
  children,
}: {
  onMenu: () => void;
  menuLabel?: string;
  label?: string;
  /** Extra pills rendered before the menu pill, inside the same 8px group. */
  children?: ReactNode;
}) {
  return (
    <header className="topbar">
      <span className="wordmark">Farkle</span>
      <div className="topbar-actions">
        {children}
        <button type="button" className="pill" onClick={onMenu} aria-label={label}>
          {menuLabel}
        </button>
      </div>
    </header>
  );
}

export type Mode = "local" | "online" | "score";

const MODE_LABELS: Record<Mode, string> = {
  local: "Local",
  online: "Online",
  score: "Score",
};

const MODE_PATHS: Record<Mode, string> = {
  local: "/",
  online: "/online",
  score: "/score/setup",
};

/**
 * The pen's `startmenuTabs` component: one white rail holding three pills,
 * the active one washed in the accent tint. It is the only mode switch in the
 * app, so all three setup screens render the same control.
 */
export function ModeTabs({ active }: { active: Mode }) {
  const navigate = useNavigate();

  return (
    <div className="mode-tabs" role="group" aria-label="Game mode">
      {(Object.keys(MODE_LABELS) as Mode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={mode === active}
          className="mode-tab"
          onClick={() => {
            if (mode !== active) navigate(MODE_PATHS[mode]);
          }}
        >
          {MODE_LABELS[mode]}
        </button>
      ))}
    </div>
  );
}