/**
 * Game record envelope + schema migration (PRD X-03, Architecture §9).
 */
import { CLASSIC, type GameConfig } from "./rules.ts";
import type { DiceGameState } from "./diceGame.ts";

export const SCHEMA_VERSION = 1;
export type GameMode = "local" | "score" | "online";

export interface GameRecord {
  schemaVersion: number;
  id: string;
  mode: GameMode;
  config: GameConfig;
  state: DiceGameState;
  createdAt: number;
  updatedAt: number;
  status: "active" | "finished";
}

export function toRecord(
  id: string,
  state: DiceGameState,
  createdAt = Date.now(),
): GameRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    mode: "local",
    config: state.config,
    state,
    createdAt,
    updatedAt: Date.now(),
    status: state.phase === "gameOver" ? "finished" : "active",
  };
}

/** Upgrade an older record in place-compatible form. Unknown versions are rejected. */
export function migrateRecord(raw: unknown): GameRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<GameRecord> & { version?: number };
  const version = record.schemaVersion ?? record.version ?? 0;
  if (version > SCHEMA_VERSION) return null;
  if (!record.state || !Array.isArray(record.state.players)) return null;

  const state = record.state;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: typeof record.id === "string" ? record.id : "legacy",
    mode: record.mode ?? "local",
    config: { ...CLASSIC, ...(record.config ?? state.config ?? {}) },
    state: {
      ...state,
      config: { ...CLASSIC, ...(record.config ?? state.config ?? {}) },
      phase: state.phase === "rolling" ? "awaitingRoll" : state.phase,
      roll: state.phase === "rolling" ? [] : state.roll,
      selected: state.phase === "rolling" ? [] : state.selected,
      kept: state.kept ?? [],
      turnScore: state.turnScore ?? 0,
      startIndex: state.startIndex ?? state.turn ?? 0,
      targetReached: state.targetReached ?? false,
      suddenDeath: state.suddenDeath ?? false,
      lastEvent: state.lastEvent ?? null,
      winnerId: state.winnerId ?? null,
    },
    createdAt: record.createdAt ?? Date.now(),
    updatedAt: record.updatedAt ?? Date.now(),
    status: state.phase === "gameOver" ? "finished" : "active",
  };
}
