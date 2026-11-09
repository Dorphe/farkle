import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { deriveScorepad, detectPreset, type PresetName } from "@farkle/engine";
import { useSession } from "@/store/session.ts";
import { RulesSheet } from "@/components/RulesSheet.tsx";
import { avatarColor } from "@/screens/SetupScreen.tsx";

const PRESET_LABELS: Record<PresetName | "custom", string> = {
  classic: "Classic",
  bar: "Bar rules",
  family: "Family",
  custom: "Custom",
};

export function ScoreSetupScreen() {
  const navigate = useNavigate();
  const scorepad = useSession((state) => state.scorepad);
  const game = useSession((state) => state.game);
  const scoreRoster = useSession((state) => state.scoreRoster);
  const addScorePlayer = useSession((state) => state.addScorePlayer);
  const removeScorePlayer = useSession((state) => state.removeScorePlayer);
  const startScoreGame = useSession((state) => state.startScoreGame);
  const draftConfig = useSession((state) => state.draftConfig);
  const setDraftConfig = useSession((state) => state.setDraftConfig);

  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  useEffect(() => {
    if (scorepad && deriveScorepad(scorepad).phase !== "gameOver") {
      navigate("/score/game", { replace: true });
    }
  }, [scorepad, navigate]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = addScorePlayer(name);
    if (problem) {
      setNotice(problem);
      return;
    }
    setName("");
    setNotice(null);
  }

  function start() {
    if (scoreRoster.length < 2) return;
    const active = (game && game.phase !== "gameOver") || (scorepad && deriveScorepad(scorepad).phase !== "gameOver");
    if (active && !window.confirm("Start a new scorepad? The saved game will be closed.")) return;
    startScoreGame(draftConfig);
    navigate("/score/game");
  }

  const presetName = detectPreset(draftConfig);

  return (
    <section className="screen setup-screen" aria-label="Keep score">
      <header className="topbar">
        <span className="wordmark">Farkle</span>
        <button type="button" className="pill" onClick={() => navigate("/rules")}>
          Rules
        </button>
      </header>

      <div className="mode-switch" role="group" aria-label="Game mode">
        <button type="button" aria-pressed="false" onClick={() => navigate("/")}>
          Play dice
        </button>
        <button type="button" aria-pressed="true">
          Keep score
        </button>
        <button type="button" aria-pressed="false" onClick={() => navigate("/online")}>
          With friends
        </button>
      </div>

      <div className="setup-scroll">
        <div className="roster-wrap">
          <div className="roster-card">
            <h2 className="roster-heading">PLAYERS</h2>
            {scoreRoster.length === 0 ? (
              <p className="empty-note">No one at the table yet. Add two players to start.</p>
            ) : (
              scoreRoster.map((player, index) => (
                <div className="player-row" key={player}>
                  <span className="avatar" style={{ background: avatarColor(index) }} aria-hidden="true">
                    {player.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="player-name">{player}</span>
                  <button
                    type="button"
                    className="remove"
                    onClick={() => removeScorePlayer(index)}
                    aria-label={`Remove ${player}`}
                  >
                    ×
                  </button>
                </div>
              ))
            )}

            <form className="add-row" onSubmit={onSubmit} autoComplete="off">
              <input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setNotice(null);
                }}
                placeholder={scoreRoster.length >= 8 ? "Table is full" : "Add a player…"}
                aria-label="Player name"
                maxLength={18}
                disabled={scoreRoster.length >= 8}
              />
              <button type="submit" className="btn-add" disabled={scoreRoster.length >= 8 || !name.trim()}>
                Add
              </button>
            </form>
          </div>
          {notice ? (
            <p className="hint" role="alert">
              {notice}
            </p>
          ) : null}
        </div>

        <button type="button" className="rule-summary" onClick={() => setRulesOpen(true)}>
          <span>
            <span className="rule-summary-label">HOUSE RULES</span>
            <span className="rule-summary-value">
              {PRESET_LABELS[presetName]} · {draftConfig.target.toLocaleString("en-US")} to win
            </span>
          </span>
          <span className="rule-summary-change">Change</span>
        </button>
      </div>

      <div className="setup-tail">
        <p className="hint">
          {scoreRoster.length >= 8
            ? "Table is full · eight players"
            : `${scoreRoster.length} of 8 players · two to start`}
        </p>
        <button type="button" className="btn-primary" onClick={start} disabled={scoreRoster.length < 2}>
          Start scorepad
        </button>
        <div className="setup-links">
          <button type="button" className="setup-link" onClick={() => navigate("/history")}>
            History
          </button>
          <button type="button" className="setup-link" onClick={() => navigate("/settings")}>
            Settings
          </button>
        </div>
      </div>

      {rulesOpen ? (
        <RulesSheet config={draftConfig} onChange={setDraftConfig} onClose={() => setRulesOpen(false)} />
      ) : null}
    </section>
  );
}
