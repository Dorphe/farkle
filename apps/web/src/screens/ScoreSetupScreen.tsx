import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { deriveScorepad, detectPreset, type PresetName } from "@farkle/engine";
import { useSession } from "@/store/session.ts";
import { RulesSheet } from "@/components/RulesSheet.tsx";
import { avatarColor } from "@/lib/avatar.ts";
import { GameMenu } from "@/components/GameMenu.tsx";
import { ModeTabs, TopBar } from "@/components/AppChrome.tsx";
import { EditIcon, PlusIcon } from "@/components/Icons.tsx";

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
  const [menuOpen, setMenuOpen] = useState(false);

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
      <TopBar onMenu={() => setMenuOpen(true)} />

      <div className="setup-tabs">
        <ModeTabs active="score" />
      </div>

      <div className="setup-scroll">
        <div className="roster-wrap">
          <div className="roster-card">
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
              <button
                type="submit"
                className="btn-add"
                disabled={scoreRoster.length >= 8 || !name.trim()}
                aria-label="Add player"
              >
                <PlusIcon />
              </button>
            </form>
          </div>
          {notice ? (
            <p className="hint" role="alert">
              {notice}
            </p>
          ) : null}
          <button type="button" className="rule-summary" onClick={() => setRulesOpen(true)}>
            <span>
              <span className="rule-summary-label">RULESET</span>
              <span className="rule-summary-value">
                {PRESET_LABELS[presetName]} ({draftConfig.target.toLocaleString("en-US")} to win)
              </span>
            </span>
            <span className="rule-summary-edit" aria-hidden="true">
              <EditIcon />
            </span>
          </button>
        </div>
      </div>

      <div className="setup-tail">
        <button type="button" className="btn-primary" onClick={start} disabled={scoreRoster.length < 2}>
          Start scorepad
        </button>
      </div>

      {rulesOpen ? (
        <RulesSheet config={draftConfig} onChange={setDraftConfig} onClose={() => setRulesOpen(false)} />
      ) : null}

      {menuOpen ? (
        <GameMenu
          mode="home"
          onClose={() => setMenuOpen(false)}
          onRules={() => {
            setMenuOpen(false);
            navigate("/rules");
          }}
          onHistory={() => {
            setMenuOpen(false);
            navigate("/history");
          }}
          onSettings={() => {
            setMenuOpen(false);
            navigate("/settings");
          }}
        />
      ) : null}
    </section>
  );
}
