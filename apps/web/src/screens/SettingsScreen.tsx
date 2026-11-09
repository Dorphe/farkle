import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "@/store/session.ts";

export function SettingsScreen() {
  const navigate = useNavigate();
  const game = useSession((state) => state.game);
  const settings = useSession((state) => state.settings);
  const setSettings = useSession((state) => state.setSettings);
  const [notice, setNotice] = useState<string | null>(null);

  const back = () => navigate(game && game.phase !== "gameOver" ? "/local/game" : "/", { replace: true });

  async function toggleShake() {
    if (settings.shake) {
      setSettings({ shake: false });
      return;
    }
    if (!window.isSecureContext) {
      setNotice("Shake needs HTTPS (or localhost).");
      return;
    }
    try {
      const motion = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
      if (typeof motion.requestPermission === "function") {
        const result = await motion.requestPermission();
        if (result !== "granted") {
          setNotice("Motion access denied in browser settings.");
          return;
        }
      }
      setSettings({ shake: true });
      setNotice("Shake to roll is on.");
    } catch {
      setNotice("Couldn't get motion access.");
    }
  }

  return (
    <section className="screen settings-screen" aria-labelledby="settings-title">
      <header className="topbar">
        <span className="wordmark">Farkle</span>
        <button type="button" className="pill" onClick={back}>
          Back
        </button>
      </header>

      <div className="subpage-title">
        <h1 id="settings-title">Settings</h1>
        <p className="subpage-lede">Sound, motion, and privacy. Everything applies immediately.</p>
      </div>

      <div className="settings-card">
        <div className="settings-row">
          <span>
            <span className="settings-label">Sound</span>
            <span className="settings-hint">Dice, bank, farkle, and win cues.</span>
          </span>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={settings.sound}
            onClick={() => setSettings({ sound: !settings.sound })}
          >
            <span className="knob" aria-hidden="true" />
            <span>{settings.sound ? "On" : "Off"}</span>
          </button>
        </div>
        <div className="settings-row">
          <span>
            <span className="settings-label">Haptics</span>
            <span className="settings-hint">Short vibration on roll and keep.</span>
          </span>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={settings.haptics}
            onClick={() => setSettings({ haptics: !settings.haptics })}
          >
            <span className="knob" aria-hidden="true" />
            <span>{settings.haptics ? "On" : "Off"}</span>
          </button>
        </div>
        <div className="settings-row">
          <span>
            <span className="settings-label">Shake to roll</span>
            <span className="settings-hint">Opt-in motion control; needs HTTPS.</span>
          </span>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={settings.shake}
            onClick={() => void toggleShake()}
          >
            <span className="knob" aria-hidden="true" />
            <span>{settings.shake ? "On" : "Off"}</span>
          </button>
        </div>
        <div className="settings-row">
          <span>
            <span className="settings-label">Reduce motion</span>
            <span className="settings-hint">Replaces the dice tumble with a quick reveal.</span>
          </span>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={settings.reducedMotion}
            onClick={() => setSettings({ reducedMotion: !settings.reducedMotion })}
          >
            <span className="knob" aria-hidden="true" />
            <span>{settings.reducedMotion ? "On" : "Off"}</span>
          </button>
        </div>
        <div className="settings-row">
          <span>
            <span className="settings-label">3D dice</span>
            <span className="settings-hint">Falls back to flat dice when WebGL is unavailable.</span>
          </span>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={settings.dice !== "2d"}
            onClick={() => setSettings({ dice: settings.dice === "2d" ? "auto" : "2d" })}
          >
            <span className="knob" aria-hidden="true" />
            <span>{settings.dice === "2d" ? "Flat" : "On"}</span>
          </button>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-row">
          <span>
            <span className="settings-label">Usage analytics</span>
            <span className="settings-hint">
              Cookieless. No provider is connected in this build, so events never leave the device.
            </span>
          </span>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={settings.analytics}
            onClick={() => setSettings({ analytics: !settings.analytics })}
          >
            <span className="knob" aria-hidden="true" />
            <span>{settings.analytics ? "On" : "Off"}</span>
          </button>
        </div>
        <div className="settings-row">
          <span>
            <span className="settings-label">Finished games</span>
            <span className="settings-hint">Recaps of the last 100 completed games.</span>
          </span>
          <button type="button" className="text-link" onClick={() => navigate("/history")}>
            History
          </button>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-row">
          <span>
            <span className="settings-label">Classic version</span>
            <span className="settings-hint">The single-file build, kept as the rollback path.</span>
          </span>
          <a className="text-link" href="/classic/">
            Open
          </a>
        </div>
        <div className="settings-row">
          <span>
            <span className="settings-label">Farkle</span>
            <span className="settings-hint">M1 · Local rebuild</span>
          </span>
          <span className="settings-hint">v0.1.0</span>
        </div>
      </div>

      {notice ? (
        <p className="settings-footnote" role="status">
          {notice}
        </p>
      ) : null}

      <p className="settings-footnote">
        Local games are stored on this device in IndexedDB. Signed-in accounts, Online rooms, and Scorekeeping
        arrive in later milestones.
      </p>

      <div className="settings-tail">
        <button type="button" className="btn-dark" onClick={back}>
          Done
        </button>
      </div>
    </section>
  );
}
