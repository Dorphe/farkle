import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { deriveScorepad, detectPreset, type PresetName } from "@farkle/engine";
import { useSession } from "@/store/session.ts";
import { RulesSheet } from "@/components/RulesSheet.tsx";

const PRESET_LABELS: Record<PresetName | "custom", string> = {
  classic: "Classic",
  bar: "Bar rules",
  family: "Family",
  custom: "Custom",
};

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
    <section className="screen setup-screen" aria-labelledby="setup-title">
      <header className="topbar">
        <span className="wordmark">Farkle</span>
        <button type="button" className="pill" onClick={() => navigate("/rules")}>
          Rules
        </button>
      </header>

      <div className="mode-switch" role="group" aria-label="Game mode">
        <button type="button" aria-pressed="true">
          Play dice
        </button>
        <button type="button" aria-pressed="false" onClick={() => navigate("/score/setup")}>
          Keep score
        </button>
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

        <div className="hero">
          <h1 id="setup-title">
            Roll. Risk it.
            <span>Bank it.</span>
          </h1>
        </div>

        {!gameActive && !scoreActive ? (
          <p className="intro">
            Six dice, one table, no turns hidden. Keep the scoring dice, push your luck on the rest — or bank
            what you&apos;ve got before a farkle takes it all.
          </p>
        ) : null}

        <div className="rules-strip" aria-label="Game rules at a glance">
          <div className="tile">
            <b>6</b>
            <span>DICE</span>
          </div>
          <div className="tile">
            <b>10K</b>
            <span>TO WIN</span>
          </div>
          <div className="tile">
            <b>3</b>
            <span>FARKLES · −1K</span>
          </div>
        </div>

        <div className="roster-wrap">
          <div className="roster-card">
            <h2 className="roster-heading">PLAYERS</h2>
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
              <button type="submit" className="btn-add" disabled={roster.length >= 6 || !name.trim()}>
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
          {roster.length >= 6
            ? "Table is full · six players"
            : `${roster.length} of 6 players · two to start`}
        </p>
        <button type="button" className="btn-primary" onClick={start} disabled={roster.length < 2}>
          Start game
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
        <RulesSheet
          config={draftConfig}
          onChange={setDraftConfig}
          onClose={() => setRulesOpen(false)}
        />
      ) : null}
    </section>
  );
}
