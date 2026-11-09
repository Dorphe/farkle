import type { DiceGameState } from "@farkle/engine";
import { MiniDie } from "./Die.tsx";

export function FarkleOverlay({ game, onNext }: { game: DiceGameState; onNext: () => void }) {
  const event = game.lastEvent;
  return (
    <div className="overlay night" role="dialog" aria-modal="true" aria-label="Farkle — turn over">
      <div className="overlay-inner">
        <span className="kicker">TURN OVER</span>
        <div className="bust-dice" aria-hidden="true">
          {game.roll.map((face, index) => (
            <MiniDie key={index} face={face} />
          ))}
        </div>
        <span className="farkle-word">Farkle</span>
        <p className="farkle-sub">{event?.text ?? "No scoring dice — the turn is over."}</p>
      </div>
      <button type="button" className="btn-primary" autoFocus onClick={onNext}>
        Next player
      </button>
    </div>
  );
}
