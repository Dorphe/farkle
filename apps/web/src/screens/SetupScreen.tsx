import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { deriveScorepad, detectPreset, type PresetName } from "@farkle/engine";
import { useSession } from "@/store/session.ts";
import { RulesSheet } from "@/components/RulesSheet.tsx";
import { GameMenu } from "@/components/GameMenu.tsx";
import { ModeTabs, TopBar } from "@/components/AppChrome.tsx";
import { EditIcon, PlusIcon } from "@/components/Icons.tsx";

const PRESET_LABELS: Record<PresetName | "custom", string> = {
  classic: "Classic",
  bar: "Bar rules",
  family: "Family",
  custom: "Custom",
};

export { PRESET_LABELS };

export function avatarColor(index: number): string {
  return `var(--avatar-${(index % 6) + 1})`;
}

export function SetupScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const game = useSession((state) => state.game);
  const scorepad = useSession((state) => state.scorepad);
  const roster = useSession((state) => state.roster);
  const addPlayer = useSession((state) => state.addPlayer);
  const removePlayer = useSession((state) => state.removePlayer);
  const startGame = useSession((state) => state.startGame);
  const draftConfig = useSession((state) => state.draftConfig);
  const setDraftConfig = useSession((state) => state.setDraftConfig);

  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const scoreView = scorepad ? deriveScorepad(scorepad) : null;
  const gameActive = Boolean(game && game.phase !== "gameOver");
  const scoreActive = Boolean(scoreView && scoreView.phase !== "gameOver");
  const fromLeave = Boolean((location.state as { fromLeave?: boolean } | null)?.fromLeave);

  useEffect(() => {
    if (fromLeave) return;
    if (gameActive) navigate("/local/game", { replace: true });
    else if (scoreActive) navigate("/score/game", { replace: true });
  }, [gameActive, scoreActive, fromLeave, navigate]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = addPlayer(name);
    if (problem) {
      setNotice(problem);
      return;
    }
    setName("");
    setNotice(null);
  }

  function start() {
    if (roster.length < 2) return;
    if ((gameActive || scoreActive) && !window.confirm("Start a new dice game? The saved game will be closed.")) {
      return;
    }
    startGame(draftConfig);
    navigate("/local/game");
  }

  const presetName = detectPreset(draftConfig);
  const gamePlayer = game ? game.players[game.turn] : undefined;
  const scoreCurrent = scorepad?.players.find((player) => player.id === scoreView?.currentPlayerId);

  return (
    <section className="screen setup-screen" aria-label="Play dice">
      <TopBar onMenu={() => setMenuOpen(true)} />

      <div className="setup-tabs">
        <ModeTabs active="local" />
      </div>

      <div className="setup-scroll">
        {gameActive && game ? (
          <button
            type="button"
            className="resume-card"
            onClick={() => navigate("/local/game")}
          >
            <span className="resume-body">
              <span className="resume-kicker">RESUME</span>
              <span className="resume-title">Dice game</span>
              <span className="resume-meta">
                {gamePlayer?.name ?? "Player"} · {game.players.length} players · turn{" "}
                {(gamePlayer?.turns ?? 0) + 1}
              </span>
            </span>
            <span className="resume-cta">Continue</span>
          </button>
        ) : null}

        {scoreActive && scorepad && scoreView ? (
          <button
            type="button"
            className="resume-card"
            onClick={() => navigate("/score/game")}
          >
            <span className="resume-body">
              <span className="resume-kicker">RESUME</span>
              <span className="resume-title">Scorepad</span>
              <span className="resume-meta">
                {scoreCurrent?.name ?? "Player"} · {scorepad.players.length} players ·{" "}
                {scorepad.config.target.toLocaleString("en-US")} to win
              </span>
            </span>
            <span className="resume-cta">Continue</span>
          </button>
        ) : null}

        <div className="roster-wrap">
          <div className="roster-card">
            {roster.length === 0 ? (
              <p className="empty-note">No one at the table yet. Add two players to start.</p>
            ) : (
              roster.map((player, index) => (
                <div className="player-row" key={player}>
                  <span className="avatar" style={{ background: avatarColor(index) }} aria-hidden="true">
                    {player.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="player-name">{player}</span>
                  <button
                    type="button"
                    className="remove"
                    onClick={() => removePlayer(index)}
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
                placeholder={roster.length >= 6 ? "Table is full" : "Add a player…"}
                aria-label="Player name"
                maxLength={18}
                disabled={roster.length >= 6}
              />
              <button
                type="submit"
                className="btn-add"
                disabled={roster.length >= 6 || !name.trim()}
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
        <button type="button" className="btn-primary" onClick={start} disabled={roster.length < 2}>
          Start game
        </button>
      </div>

      {rulesOpen ? (
        <RulesSheet
          config={draftConfig}
          onChange={setDraftConfig}
          onClose={() => setRulesOpen(false)}
        />
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
