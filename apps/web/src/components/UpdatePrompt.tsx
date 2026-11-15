import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { deriveScorepad } from "@farkle/engine";
import { useSession } from "@/store/session.ts";

/**
 * Keeps the installed app on the deployed build without ever interrupting a
 * turn in progress.
 *
 * A waiting service worker is applied on its own whenever nothing is being
 * played — that is what makes a fresh deploy show up on the next visit instead
 * of sitting behind a cache until someone notices the banner. Mid-game the
 * banner appears and the player chooses when to reload.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  const game = useSession((state) => state.game);
  const scorepad = useSession((state) => state.scorepad);

  const playing = Boolean(
    (game && game.phase !== "gameOver") ||
      (scorepad && deriveScorepad(scorepad).phase !== "gameOver"),
  );

  useEffect(() => {
    if (!needRefresh || playing) return;
    // A tick of slack so the fresh worker is taken after first paint rather
    // than mid-render.
    const timer = window.setTimeout(() => void updateServiceWorker(true), 300);
    return () => window.clearTimeout(timer);
  }, [needRefresh, playing, updateServiceWorker]);

  // A long-lived tab (or the installed PWA) should still notice a deploy
  // without being closed first.
  useEffect(() => {
    const check = () => {
      void navigator.serviceWorker?.getRegistration().then((registration) => registration?.update());
    };
    const onVisible = () => {
      if (!document.hidden) check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, []);

  if (!needRefresh || !playing) return null;

  return (
    <div className="update-banner" role="status">
      <span>A new version is ready.</span>
      <button type="button" onClick={() => void updateServiceWorker(true)}>
        Refresh
      </button>
      <button
        type="button"
        className="update-dismiss"
        aria-label="Dismiss update"
        onClick={() => setNeedRefresh(false)}
      >
        ×
      </button>
    </div>
  );
}
