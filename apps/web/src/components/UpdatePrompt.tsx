import { useRegisterSW } from "virtual:pwa-register/react";

/**
 * Update prompt that never reloads on its own: a game in progress stays put
 * until the player taps Refresh.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

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
