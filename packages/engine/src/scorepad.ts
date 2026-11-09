/**
 * Scorekeeping turn model (PRD §8.4, Architecture §5.1).
 *
 * One shared device records one outcome per real-dice turn. The ledger is
 * append-only; totals, streaks, the current player, and the winner are all
 * derived by replaying effective entries, so a correction recomputes every
 * later total without editing history.
 */
import { CLASSIC, type GameConfig } from "./rules.ts";

export interface ScorepadPlayer {
  id: string;
  name: string;
}

export type ScorepadEntryKind = "score" | "farkle" | "correction" | "undo";

export interface ScorepadEntry {
  id: string;
  playerId: string;
  kind: ScorepadEntryKind;
  /** Entered turn total; for a correction, the replacement total. */
  total: number;
  at: number;
  correctionOf?: string;
  undoOf?: string;
}

export interface ScorepadState {
  config: GameConfig;
  players: ScorepadPlayer[];
  ledger: ScorepadEntry[];
  startIndex: number;
  endedAt: number | null;
}

export interface ComputedEntry {
  entry: ScorepadEntry;
  playerId: string;
  kind: "score" | "farkle";
  total: number;
  delta: number;
  resultingTotal: number;
  streak: number;
  correctedBy?: string;
}

export interface ScorepadView {
  totals: Record<string, number>;
  streaks: Record<string, number>;
  turns: Record<string, number>;
  currentPlayerId: string;
  currentIndex: number;
  phase: "playing" | "gameOver";
  winnerId: string | null;
  targetReached: boolean;
  suddenDeath: boolean;
  roundComplete: boolean;
  entries: ComputedEntry[];
  ledger: ScorepadEntry[];
  undoable: ScorepadEntry | null;
  undoDepth: number;
  manuallyEnded: boolean;
}

export type ScorepadAction =
  | {
      type: "logTurn";
      id: string;
      at: number;
      playerId: string;
      kind: "score" | "farkle";
      total: number;
    }
  | {
      type: "correct";
      id: string;
      at: number;
      entryId: string;
      replacement: { kind: "score" | "farkle"; total: number };
    }
  | { type: "undo"; id: string; at: number }
  | { type: "endGame"; at: number };

export type ScorepadResult =
  | { ok: true; state: ScorepadState }
  | { ok: false; error: string; state: ScorepadState };

const ok = (state: ScorepadState): ScorepadResult => ({ ok: true, state });
const fail = (state: ScorepadState, error: string): ScorepadResult => ({ ok: false, error, state });

const clone = (state: ScorepadState): ScorepadState => ({
  ...state,
  config: { ...state.config },
  players: state.players.map((player) => ({ ...player })),
  ledger: state.ledger.map((entry) => ({ ...entry })),
});

export function createScorepad(
  names: readonly string[],
  config: GameConfig = CLASSIC,
  firstIndex = 0,
): ScorepadState {
  if (names.length < 2) throw new Error("A scorepad needs at least two players.");
  if (names.length > 8) throw new Error("A scorepad supports at most eight players.");
  const players: ScorepadPlayer[] = names.map((name, index) => ({
    id: `sp${index + 1}`,
    name,
  }));
  const start = ((firstIndex % players.length) + players.length) % players.length;
  return {
    config: { ...config },
    players,
    ledger: [],
    startIndex: start,
    endedAt: null,
  };
}

interface EffectiveTurn {
  entry: ScorepadEntry;
  playerId: string;
  kind: "score" | "farkle";
  total: number;
  correctedBy?: string;
}

function effectiveTurns(ledger: readonly ScorepadEntry[]): EffectiveTurn[] {
  const voided = new Set<string>();
  for (const entry of ledger) {
    if (entry.kind === "undo" && entry.undoOf) voided.add(entry.undoOf);
  }

  const corrections = new Map<string, ScorepadEntry>();
  for (const entry of ledger) {
    if (entry.kind !== "correction" || !entry.correctionOf) continue;
    if (voided.has(entry.id)) continue;
    corrections.set(entry.correctionOf, entry);
  }

  const turns: EffectiveTurn[] = [];
  for (const entry of ledger) {
    if (entry.kind !== "score" && entry.kind !== "farkle") continue;
    if (voided.has(entry.id)) continue;
    const replacement = corrections.get(entry.id);
    const use = replacement ?? entry;
    turns.push({
      entry,
      playerId: entry.playerId,
      kind: use.kind === "farkle" ? "farkle" : "score",
      total: use.total,
      correctedBy: replacement?.id,
    });
  }
  return turns;
}

export function deriveScorepad(state: ScorepadState): ScorepadView {
  const totals: Record<string, number> = {};
  const streaks: Record<string, number> = {};
  const turns: Record<string, number> = {};
  for (const player of state.players) {
    totals[player.id] = 0;
    streaks[player.id] = 0;
    turns[player.id] = 0;
  }

  const effective = effectiveTurns(state.ledger);
  const entries: ComputedEntry[] = [];
  let targetReached = false;
  let suddenDeath = false;
  let phase: "playing" | "gameOver" = "playing";
  let winnerId: string | null = null;
  let totalTurns = 0;

  const playerCount = state.players.length;
  const playerAt = (offset: number) =>
    state.players[(state.startIndex + offset) % playerCount];

  for (const turn of effective) {
    if ((phase as "playing" | "gameOver") === "gameOver") break;
    const playerId = turn.playerId;
    let delta = 0;
    let streak = streaks[playerId] ?? 0;

    if (turn.kind === "score") {
      const current = totals[playerId] ?? 0;
      delta =
        current === 0 && turn.total < state.config.entryThreshold ? 0 : turn.total;
      totals[playerId] = current + delta;
      streak = 0;
    } else {
      streak += 1;
      if (state.config.farklePenalty > 0 && streak >= 3) {
        const penalty = Math.min(state.config.farklePenalty, totals[playerId] ?? 0);
        totals[playerId] = (totals[playerId] ?? 0) - penalty;
        delta = -penalty;
        streak = 0;
      }
    }

    streaks[playerId] = streak;
    turns[playerId] = (turns[playerId] ?? 0) + 1;
    totalTurns += 1;
    entries.push({
      entry: turn.entry,
      playerId,
      kind: turn.kind,
      total: turn.total,
      delta,
      resultingTotal: totals[playerId] ?? 0,
      streak,
      correctedBy: turn.correctedBy,
    });

    if (state.config.winCondition === "first" && (totals[playerId] ?? 0) >= state.config.target) {
      phase = "gameOver";
      winnerId = playerId;
      break;
    }

    if (state.config.winCondition === "completeRound") {
      if ((totals[playerId] ?? 0) >= state.config.target) targetReached = true;
      const equalTurns = state.players.every(
        (player) => (turns[player.id] ?? 0) === (turns[state.players[0]?.id ?? ""] ?? 0),
      );
      if (targetReached && equalTurns) {
        const best = Math.max(...state.players.map((player) => totals[player.id] ?? 0));
        const leaders = state.players.filter((player) => (totals[player.id] ?? 0) === best);
        if (leaders.length === 1) {
          phase = "gameOver";
          winnerId = leaders[0]?.id ?? null;
          break;
        }
        suddenDeath = true;
      }
    }
  }

  if (state.endedAt !== null) {
    phase = "gameOver";
    const best = Math.max(...state.players.map((player) => totals[player.id] ?? 0));
    const leaders = state.players.filter((player) => (totals[player.id] ?? 0) === best);
    winnerId = leaders[0]?.id ?? null;
  }

  const currentIndex = (state.startIndex + totalTurns) % playerCount;
  const currentPlayerId = playerAt(totalTurns)?.id ?? state.players[0]?.id ?? "";

  const voided = new Set<string>();
  for (const entry of state.ledger) {
    if (entry.kind === "undo" && entry.undoOf) voided.add(entry.undoOf);
  }
  let undoable: ScorepadEntry | null = null;
  for (let index = state.ledger.length - 1; index >= 0; index--) {
    const entry = state.ledger[index];
    if (!entry) continue;
    if (entry.kind === "undo") continue;
    if (voided.has(entry.id)) continue;
    if (entry.kind === "correction" && entry.correctionOf && voided.has(entry.correctionOf)) continue;
    undoable = entry;
    break;
  }
  let undoDepth = 0;
  for (let index = state.ledger.length - 1; index >= 0; index--) {
    if (state.ledger[index]?.kind !== "undo") break;
    undoDepth += 1;
  }

  const equalTurns =
    state.players.length > 0 &&
    state.players.every(
      (player) => (turns[player.id] ?? 0) === (turns[state.players[0]?.id ?? ""] ?? 0),
    );

  return {
    totals,
    streaks,
    turns,
    currentPlayerId,
    currentIndex,
    phase,
    winnerId,
    targetReached,
    suddenDeath,
    roundComplete: targetReached && equalTurns,
    entries,
    ledger: state.ledger,
    undoable,
    undoDepth,
    manuallyEnded: state.endedAt !== null,
  };
}

function validTotal(kind: "score" | "farkle", total: number): string | null {
  if (kind === "farkle") return total === 0 ? null : "A farkle scores 0.";
  if (!Number.isInteger(total) || total <= 0) return "Enter a turn total above zero.";
  if (total > 100_000) return "That total is too large.";
  return null;
}

export function reduceScorepad(state: ScorepadState, action: ScorepadAction): ScorepadResult {
  const next = clone(state);
  const view = deriveScorepad(next);

  switch (action.type) {
    case "logTurn": {
      if (view.phase === "gameOver") return fail(state, "The game is over.");
      if (!next.players.some((player) => player.id === action.playerId)) {
        return fail(state, "Unknown player.");
      }
      if (action.playerId !== view.currentPlayerId) {
        return fail(state, "It is not that player's turn.");
      }
      const problem = validTotal(action.kind, action.total);
      if (problem) return fail(state, problem);
      next.ledger.push({
        id: action.id,
        playerId: action.playerId,
        kind: action.kind,
        total: action.kind === "farkle" ? 0 : action.total,
        at: action.at,
      });
      return ok(next);
    }

    case "correct": {
      const target = next.ledger.find((entry) => entry.id === action.entryId);
      if (!target || (target.kind !== "score" && target.kind !== "farkle")) {
        return fail(state, "Only a logged turn can be corrected.");
      }
      const voided = new Set(
        next.ledger
          .filter((entry) => entry.kind === "undo" && entry.undoOf)
          .map((entry) => entry.undoOf),
      );
      if (voided.has(target.id)) return fail(state, "That turn was undone.");
      const problem = validTotal(action.replacement.kind, action.replacement.total);
      if (problem) return fail(state, problem);
      next.ledger.push({
        id: action.id,
        playerId: target.playerId,
        kind: "correction",
        total: action.replacement.kind === "farkle" ? 0 : action.replacement.total,
        at: action.at,
        correctionOf: target.id,
      });
      return ok(next);
    }

    case "undo": {
      if (view.undoDepth >= 10) return fail(state, "Undo is limited to ten steps.");
      const target = view.undoable;
      if (!target) return fail(state, "There is nothing to undo.");
      next.ledger.push({
        id: action.id,
        playerId: target.playerId,
        kind: "undo",
        total: 0,
        at: action.at,
        undoOf: target.id,
      });
      return ok(next);
    }

    case "endGame": {
      if (view.phase === "gameOver") return fail(state, "The game is already over.");
      next.endedAt = action.at;
      return ok(next);
    }
  }
}
