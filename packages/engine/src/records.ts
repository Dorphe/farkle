/**
 * Game record envelope + schema migration (PRD X-03, Architecture §9).
 */
import { CLASSIC, type GameConfig } from "./rules.ts";
import type { DiceGameState } from "./diceGame.ts";
import { deriveScorepad, type ScorepadState } from "./scorepad.ts";

export const SCHEMA_VERSION = 1;
export type GameMode = "local" | "score" | "online";

interface BaseRecord {
  schemaVersion: number;
  id: string;
  config: GameConfig;
  createdAt: number;
  updatedAt: number;
  status: "active" | "finished";
}

export interface LocalGameRecord extends BaseRecord {
  mode: "local";
  state: DiceGameState;
}

export interface ScorepadGameRecord extends BaseRecord {
  mode: "score";
  state: ScorepadState;
}

export type GameRecord = LocalGameRecord | ScorepadGameRecord;

export function toRecord(
  id: string,
  state: DiceGameState,
  createdAt = Date.now(),
): LocalGameRecord {
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

export function toScorepadRecord(
  id: string,
  state: ScorepadState,
  createdAt = Date.now(),
): ScorepadGameRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    mode: "score",
    config: state.config,
    state,
    createdAt,
    updatedAt: Date.now(),
    status: deriveScorepad(state).phase === "gameOver" ? "finished" : "active",
  };
}

/** Upgrade an older record in place-compatible form. Unknown versions are rejected. */
export function migrateRecord(raw: unknown): GameRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<GameRecord> & { version?: number };
  const version = record.schemaVersion ?? record.version ?? 0;
  if (version > SCHEMA_VERSION) return null;
  if (!record.state || !Array.isArray(record.state.players)) return null;

  const config: GameConfig = {
    ...CLASSIC,
    ...(record.config ?? record.state.config ?? {}),
  };
  const state = record.state as unknown as Record<string, unknown>;
  const isScore = record.mode === "score" || Array.isArray(state.ledger);

  if (isScore) {
    const scoreState: ScorepadState = {
      config,
      players: (state.players as ScorepadState["players"]).map((player) => ({
        id: String(player.id),
        name: String(player.name).slice(0, 18),
      })),
      ledger: Array.isArray(state.ledger) ? (state.ledger as ScorepadState["ledger"]) : [],
      startIndex: Number(state.startIndex ?? 0) || 0,
      endedAt: typeof state.endedAt === "number" ? state.endedAt : null,
    };
    return {
      schemaVersion: SCHEMA_VERSION,
      id: typeof record.id === "string" ? record.id : "legacy",
      mode: "score",
      config,
      state: scoreState,
      createdAt: record.createdAt ?? Date.now(),
      updatedAt: record.updatedAt ?? Date.now(),
      status: deriveScorepad(scoreState).phase === "gameOver" ? "finished" : "active",
    };
  }

  const diceState = state as unknown as DiceGameState;
  const migrated: DiceGameState = {
    ...diceState,
    config,
    phase: diceState.phase === "rolling" ? "awaitingRoll" : diceState.phase,
    roll: diceState.phase === "rolling" ? [] : diceState.roll,
    selected: diceState.phase === "rolling" ? [] : diceState.selected,
    kept: diceState.kept ?? [],
    turnScore: diceState.turnScore ?? 0,
    startIndex: diceState.startIndex ?? diceState.turn ?? 0,
    targetReached: diceState.targetReached ?? false,
    suddenDeath: diceState.suddenDeath ?? false,
    lastEvent: diceState.lastEvent ?? null,
    winnerId: diceState.winnerId ?? null,
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    id: typeof record.id === "string" ? record.id : "legacy",
    mode: "local",
    config,
    state: migrated,
    createdAt: record.createdAt ?? Date.now(),
    updatedAt: record.updatedAt ?? Date.now(),
    status: migrated.phase === "gameOver" ? "finished" : "active",
  };
}
