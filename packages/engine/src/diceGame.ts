/**
 * Local/Online dice-turn reducer (PRD §7.1, Architecture §5.2–§5.3).
 * Pure: values arrive in `rollResolved`, never from Math.random here.
 */
import {
  CLASSIC,
  isFarkle,
  scoreSelection,
  type Face,
  type GameConfig,
} from "./rules.ts";

export type PlayerId = string;

export interface Player {
  id: PlayerId;
  name: string;
  score: number;
  /** Consecutive farkles. */
  streak: number;
  /** Completed turns, used by the complete-the-round win condition. */
  turns: number;
}

export type Phase =
  | "awaitingRoll"
  | "rolling"
  | "awaitingKeep"
  | "turnEnd"
  | "gameOver";

export type EventKind =
  | "roll"
  | "keep"
  | "bank"
  | "farkle"
  | "penalty"
  | "turn"
  | "win";

export interface GameEvent {
  kind: EventKind;
  playerId: PlayerId;
  text: string;
  /** Signed change applied to the player's total, if any. */
  delta?: number;
}

export interface DiceGameState {
  config: GameConfig;
  players: Player[];
  turn: number;
  startIndex: number;
  phase: Phase;
  roll: Face[];
  selected: boolean[];
  kept: Face[];
  turnScore: number;
  winnerId: PlayerId | null;
  targetReached: boolean;
  suddenDeath: boolean;
  lastEvent: GameEvent | null;
}

export type DiceGameAction =
  | { type: "roll" }
  | { type: "rollResolved"; values: number[] }
  | { type: "toggle"; index: number }
  | { type: "keep" }
  | { type: "bank" }
  | { type: "nextTurn" }
  | { type: "rematch" };

export type ReduceResult =
  | { ok: true; state: DiceGameState }
  | { ok: false; error: string; state: DiceGameState };

const clone = (state: DiceGameState): DiceGameState => ({
  ...state,
  players: state.players.map((player) => ({ ...player })),
  roll: [...state.roll],
  selected: [...state.selected],
  kept: [...state.kept],
});

export function isValidFace(value: number): value is Face {
  return Number.isInteger(value) && value >= 1 && value <= 6;
}

export function createGame(
  names: readonly string[],
  config: GameConfig = CLASSIC,
  firstIndex = 0,
): DiceGameState {
  if (names.length < 2) throw new Error("A game needs at least two players.");
  if (names.length > 6) throw new Error("A game supports at most six players.");
  const players: Player[] = names.map((name, index) => ({
    id: `p${index + 1}`,
    name,
    score: 0,
    streak: 0,
    turns: 0,
  }));
  const start = ((firstIndex % players.length) + players.length) % players.length;
  return {
    config: { ...config },
    players,
    turn: start,
    startIndex: start,
    phase: "awaitingRoll",
    roll: [],
    selected: [],
    kept: [],
    turnScore: 0,
    winnerId: null,
    targetReached: false,
    suddenDeath: false,
    lastEvent: null,
  };
}

export function currentPlayer(state: DiceGameState): Player {
  return state.players[state.turn] as Player;
}

export function selectedFaces(state: DiceGameState): Face[] {
  return state.roll.filter((_, index) => state.selected[index]);
}

/** Turn total including the current legal selection (null if the selection is invalid). */
export function pendingTotal(state: DiceGameState): number | null {
  if (state.roll.length === 0) return state.turnScore;
  const faces = selectedFaces(state);
  if (faces.length === 0) return state.turnScore;
  const selection = scoreSelection(faces, state.config);
  return selection === null ? null : state.turnScore + selection;
}

export function diceLeft(state: DiceGameState): number {
  return state.kept.length >= 6 ? 0 : 6 - state.kept.length;
}

function fail(state: DiceGameState, error: string): ReduceResult {
  return { ok: false, error, state };
}

const ok = (state: DiceGameState): ReduceResult => ({ ok: true, state });

function advanceTurn(state: DiceGameState): void {
  state.turn = (state.turn + 1) % state.players.length;
  state.phase = "awaitingRoll";
  state.roll = [];
  state.selected = [];
  state.kept = [];
  state.turnScore = 0;
}

function allTurnsEqual(players: readonly Player[]): boolean {
  return players.every((player) => player.turns === players[0]?.turns);
}

function resolveCompleteRound(state: DiceGameState, actor: Player): void {
  if (!state.targetReached || !allTurnsEqual(state.players)) return;
  const best = Math.max(...state.players.map((player) => player.score));
  const leaders = state.players.filter((player) => player.score === best);
  if (leaders.length === 1) {
    const winner = leaders[0] as Player;
    state.phase = "gameOver";
    state.winnerId = winner.id;
    state.lastEvent = {
      kind: "win",
      playerId: winner.id,
      text: `${winner.name} wins with ${winner.score.toLocaleString("en-US")}`,
    };
    return;
  }
  // Tied at the end of a complete round: play one more equal round.
  state.suddenDeath = true;
  state.lastEvent = {
    kind: "turn",
    playerId: actor.id,
    text: `Tied at ${best.toLocaleString("en-US")} — sudden-death round`,
  };
}

function endTurn(state: DiceGameState): void {
  advanceTurn(state);
  state.lastEvent = {
    kind: "turn",
    playerId: currentPlayer(state).id,
    text: `${currentPlayer(state).name}'s turn`,
  };
}

export function reduce(state: DiceGameState, action: DiceGameAction): ReduceResult {
  const next = clone(state);

  switch (action.type) {
    case "roll": {
      if (next.phase === "rolling") return fail(state, "Dice are already rolling.");
      if (next.phase !== "awaitingRoll") return fail(state, "You can't roll right now.");
      if (diceLeft(next) === 0 && !next.config.hotDice) {
        return fail(state, "All six dice are kept — bank to finish the turn.");
      }
      next.phase = "rolling";
      next.roll = [];
      next.selected = [];
      next.lastEvent = {
        kind: "roll",
        playerId: currentPlayer(next).id,
        text: `${currentPlayer(next).name} rolled`,
      };
      return ok(next);
    }

    case "rollResolved": {
      if (next.phase !== "rolling") return fail(state, "No roll is in progress.");
      if (action.values.length === 0 || !action.values.every(isValidFace)) {
        return fail(state, "Roll values must be 1–6.");
      }
      const values = action.values as Face[];
      next.roll = values;
      next.selected = values.map(() => false);
      next.phase = "awaitingKeep";
      if (isFarkle(values, next.config)) {
        const player = currentPlayer(next);
        const lost = next.turnScore;
        player.streak += 1;
        player.turns += 1;
        let penalty = 0;
        if (next.config.farklePenalty > 0 && player.streak >= 3) {
          penalty = Math.min(next.config.farklePenalty, player.score);
          player.score -= penalty;
          player.streak = 0;
        }
        next.turnScore = 0;
        next.phase = "turnEnd";
        next.lastEvent = {
          kind: penalty > 0 ? "penalty" : "farkle",
          playerId: player.id,
          text: penalty > 0
            ? `Third farkle in a row — ${player.name} loses ${penalty.toLocaleString("en-US")}`
            : lost > 0
              ? `Farkle — no scoring dice. ${player.name} loses ${lost.toLocaleString("en-US")}`
              : `Farkle — no scoring dice. ${player.name} loses the turn`,
          delta: -penalty,
        };
        resolveCompleteRound(next, player);
      }
      return ok(next);
    }

    case "toggle": {
      if (next.phase !== "awaitingKeep") return fail(state, "There is nothing to select.");
      const index = action.index;
      if (!Number.isInteger(index) || index < 0 || index >= next.roll.length) {
        return fail(state, "That die is not on the table.");
      }
      const updated = [...next.selected];
      updated[index] = !updated[index];
      next.selected = updated;
      return ok(next);
    }

    case "keep": {
      if (next.phase !== "awaitingKeep") return fail(state, "There is nothing to keep.");
      const faces = selectedFaces(next);
      if (faces.length === 0) return fail(state, "Select at least one scoring die.");
      const points = scoreSelection(faces, next.config);
      if (points === null) return fail(state, "That selection is not a scoring set.");

      const player = currentPlayer(next);
      next.turnScore += points;
      next.kept = [...next.kept, ...faces];
      next.roll = [];
      next.selected = [];
      next.lastEvent = {
        kind: "keep",
        playerId: player.id,
        text: `${player.name} keeps ${faces.length} ${faces.length === 1 ? "die" : "dice"} for ${points.toLocaleString("en-US")}`,
        delta: points,
      };

      if (next.kept.length === 6) {
        if (next.config.hotDice) {
          next.kept = [];
          next.phase = "awaitingRoll";
          next.lastEvent = {
            kind: "keep",
            playerId: player.id,
            text: "Hot dice — all six dice return",
            delta: points,
          };
        } else {
          next.phase = "awaitingKeep";
        }
      } else {
        next.phase = "awaitingRoll";
      }
      return ok(next);
    }

    case "bank": {
      if (next.phase !== "awaitingKeep" && next.phase !== "awaitingRoll") {
        return fail(state, "You can't bank right now.");
      }
      const player = currentPlayer(next);
      let scored = next.turnScore;

      if (next.roll.length > 0) {
        const faces = selectedFaces(next);
        if (faces.length === 0) return fail(state, "Select scoring dice before banking.");
        const points = scoreSelection(faces, next.config);
        if (points === null) return fail(state, "That selection is not a scoring set.");
        scored += points;
      }
      if (scored <= 0) return fail(state, "There is nothing to bank.");

      const before = player.score;
      const credited = before === 0 && scored < next.config.entryThreshold ? 0 : scored;
      player.score += credited;
      player.streak = 0;
      player.turns += 1;

      if (next.config.winCondition === "first" && player.score >= next.config.target) {
        next.phase = "gameOver";
        next.winnerId = player.id;
        next.lastEvent = {
          kind: "win",
          playerId: player.id,
          text: `${player.name} wins with ${player.score.toLocaleString("en-US")}`,
          delta: credited,
        };
        next.turnScore = 0;
        next.roll = [];
        next.selected = [];
        next.kept = [];
        return ok(next);
      }

      if (next.config.winCondition === "completeRound") {
        if (player.score >= next.config.target) next.targetReached = true;
        next.lastEvent = {
          kind: "bank",
          playerId: player.id,
          text:
            credited === 0 && before === 0
              ? `${player.name} banks ${scored.toLocaleString("en-US")} — below the ${next.config.entryThreshold.toLocaleString("en-US")} entry`
              : `${player.name} banks ${credited.toLocaleString("en-US")}`,
          delta: credited,
        };
        next.turnScore = 0;
        next.roll = [];
        next.selected = [];
        next.kept = [];
        resolveCompleteRound(next, player);
        if ((next.phase as Phase) !== "gameOver") advanceTurn(next);
        return ok(next);
      }

      endTurn(next);
      return ok(next);
    }

    case "nextTurn": {
      if (next.phase !== "turnEnd") return fail(state, "The turn has already moved on.");
      endTurn(next);
      return ok(next);
    }

    case "rematch": {
      if (next.phase !== "gameOver") return fail(state, "The game is still running.");
      const start = (next.startIndex + 1) % next.players.length;
      next.players = next.players.map((player) => ({
        ...player,
        score: 0,
        streak: 0,
        turns: 0,
      }));
      next.turn = start;
      next.startIndex = start;
      next.phase = "awaitingRoll";
      next.roll = [];
      next.selected = [];
      next.kept = [];
      next.turnScore = 0;
      next.winnerId = null;
      next.targetReached = false;
      next.suddenDeath = false;
      next.lastEvent = {
        kind: "turn",
        playerId: (next.players[start] as Player).id,
        text: "Rematch — scores reset",
      };
      return ok(next);
    }
  }
}
