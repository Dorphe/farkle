import { useNavigate } from "react-router-dom";
import { deriveScorepad } from "@farkle/engine";
import { useSession } from "@/store/session.ts";

export function RulesScreen() {
  const navigate = useNavigate();
  const game = useSession((state) => state.game);
  const scorepad = useSession((state) => state.scorepad);
  const draftConfig = useSession((state) => state.draftConfig);

  const config = game?.config ?? scorepad?.config ?? draftConfig;
  const target = config.target.toLocaleString("en-US");

  function close() {
    if (game && game.phase !== "gameOver") {
      navigate("/local/game", { replace: true });
      return;
    }
    if (scorepad && deriveScorepad(scorepad).phase !== "gameOver") {
      navigate("/score/game", { replace: true });
      return;
    }
    navigate("/", { replace: true });
  }

  return (
    <section className="screen rules-screen" aria-labelledby="rules-title">
      <div className="rules-column">
        <div className="rules-title">
          <h1 id="rules-title">How to play</h1>
          <ol className="rules-lede">
            <li>Roll all six dice.</li>
            <li>Set aside at least one scoring die, then either roll the rest or bank your points.</li>
            <li>No scoring dice is a farkle — the turn ends with nothing.</li>
            <li>{config.winCondition === "first" ? `First to ${target}` : `Highest score at the end of a round, from ${target}`} wins.</li>
          </ol>

          {config.hotDice ? (
            <div className="callout">
              <span className="callout-label">HOT DICE</span>
              <p>
                All six dice scored? Roll them all again and keep the pile — the turn doesn&apos;t end
                until you stop scoring.
              </p>
            </div>
          ) : null}
        </div>

        <div className="table-wrap">
          <div className="score-card">
            <div className="score-row">
              <span className="score-rule">Single 1 / single 5</span>
              <span className="score-points">100 / 50</span>
            </div>
            <div className="score-row">
              <span className="score-rule">Three of a kind (2–6)</span>
              <span className="score-points">200–600</span>
            </div>
            <div className="score-row">
              <span className="score-rule">Three 1s</span>
              <span className="score-points">1,000</span>
            </div>
            <div className="score-row">
              <span className="score-rule">Four / five / six of a kind</span>
              <span className="score-points accent">×2 / ×4 / ×8</span>
            </div>
            {config.straight !== null ? (
              <div className="score-row">
                <span className="score-rule">Straight 1–6</span>
                <span className="score-points">{config.straight.toLocaleString("en-US")}</span>
              </div>
            ) : null}
            {config.threePairs ? (
              <div className="score-row">
                <span className="score-rule">Three pairs</span>
                <span className="score-points">1,500</span>
              </div>
            ) : null}
            {config.twoTriplets ? (
              <div className="score-row">
                <span className="score-rule">Two triplets</span>
                <span className="score-points">2,500</span>
              </div>
            ) : null}
            {config.farklePenalty > 0 ? (
              <div className="score-row">
                <span className="score-rule">Three farkles in a row</span>
                <span className="score-points accent">
                  −{config.farklePenalty.toLocaleString("en-US")}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rules-tail">
        <button type="button" className="btn-dark" onClick={close}>
          Close
        </button>
      </div>
    </section>
  );
}
