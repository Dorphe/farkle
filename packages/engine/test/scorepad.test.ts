import { describe, expect, it } from "vitest";
import { CLASSIC } from "../src/rules.ts";
import {
  createScorepad,
  deriveScorepad,
  reduceScorepad,
  type ScorepadResult,
  type ScorepadState,
} from "../src/scorepad.ts";
import { migrateRecord, toScorepadRecord } from "../src/records.ts";

let serial = 0;
const stamp = () => 1_700_000_000_000 + serial++;

function log(
  state: ScorepadState,
  playerId: string,
  total: number,
  kind: "score" | "farkle" = "score",
): ScorepadState {
  const result = reduceScorepad(state, {
    type: "logTurn",
    id: `e${serial}`,
    at: stamp(),
    playerId,
    kind,
    total,
  });
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function undo(state: ScorepadState): ScorepadState {
  const result = reduceScorepad(state, { type: "undo", id: `u${serial}`, at: stamp() });
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function correct(
  state: ScorepadState,
  entryId: string,
  total: number,
  kind: "score" | "farkle" = "score",
): ScorepadState {
  const result = reduceScorepad(state, {
    type: "correct",
    id: `c${serial}`,
    at: stamp(),
    entryId,
    replacement: { kind, total },
  });
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe("scorepad ledger", () => {
  it("logs a turn, derives totals, and advances the keeper", () => {
    let state = createScorepad(["Ana", "Ben", "Cleo"]);
    expect(deriveScorepad(state).currentPlayerId).toBe("sp1");

    state = log(state, "sp1", 450);
    const view = deriveScorepad(state);
    expect(view.totals.sp1).toBe(450);
    expect(view.turns.sp1).toBe(1);
    expect(view.currentPlayerId).toBe("sp2");
    expect(view.entries[0]?.delta).toBe(450);
    expect(view.entries[0]?.resultingTotal).toBe(450);
  });

  it("rejects out-of-turn and zero-score entries", () => {
    const state = createScorepad(["Ana", "Ben"]);
    const outOfTurn = reduceScorepad(state, {
      type: "logTurn",
      id: "x",
      at: stamp(),
      playerId: "sp2",
      kind: "score",
      total: 100,
    });
    expect(outOfTurn.ok).toBe(false);
    const zero = reduceScorepad(state, {
      type: "logTurn",
      id: "y",
      at: stamp(),
      playerId: "sp1",
      kind: "score",
      total: 0,
    });
    expect(zero.ok).toBe(false);
  });

  it("applies the entry threshold only while a player is on zero", () => {
    let state = createScorepad(["Ana", "Ben"], { ...CLASSIC, entryThreshold: 500 });
    state = log(state, "sp1", 450);
    expect(deriveScorepad(state).totals.sp1).toBe(0);

    state = log(state, "sp2", 300);
    state = log(state, "sp1", 500);
    expect(deriveScorepad(state).totals.sp1).toBe(500);
  });

  it("counts farkles across other turns and applies the penalty on the third", () => {
    let state = createScorepad(["Ana", "Ben"], { ...CLASSIC, entryThreshold: 0 });
    state = log(state, "sp1", 400);
    state = log(state, "sp2", 100);

    state = log(state, "sp1", 0, "farkle");
    state = log(state, "sp2", 100);
    expect(deriveScorepad(state).streaks.sp1).toBe(1);

    state = log(state, "sp1", 0, "farkle");
    state = log(state, "sp2", 100);
    expect(deriveScorepad(state).streaks.sp1).toBe(2);

    state = log(state, "sp1", 0, "farkle");
    const view = deriveScorepad(state);
    expect(view.totals.sp1).toBe(0);
    expect(view.streaks.sp1).toBe(0);
    expect(view.entries.at(-1)?.delta).toBe(-400);
  });

  it("recomputes later totals when a past entry is corrected", () => {
    let state = createScorepad(["Ana", "Ben"]);
    state = log(state, "sp1", 400);
    state = log(state, "sp2", 300);
    state = log(state, "sp1", 100);

    const first = deriveScorepad(state).entries[0]?.entry.id;
    expect(first).toBeTruthy();
    state = correct(state, first as string, 500);

    const view = deriveScorepad(state);
    expect(view.totals.sp1).toBe(600);
    expect(view.totals.sp2).toBe(300);
    expect(view.entries[0]?.total).toBe(500);
    expect(view.entries[0]?.correctedBy).toBeTruthy();
    expect(view.entries[2]?.resultingTotal).toBe(600);
  });

  it("undoes the last turn and then the correction before it", () => {
    let state = createScorepad(["Ana", "Ben"]);
    state = log(state, "sp1", 400);
    const entryId = deriveScorepad(state).entries[0]?.entry.id as string;
    state = correct(state, entryId, 500);
    expect(deriveScorepad(state).totals.sp1).toBe(500);

    state = undo(state);
    expect(deriveScorepad(state).totals.sp1).toBe(400);
    expect(deriveScorepad(state).currentPlayerId).toBe("sp2");

    state = undo(state);
    expect(deriveScorepad(state).totals.sp1).toBe(0);
    expect(deriveScorepad(state).currentPlayerId).toBe("sp1");
    expect(reduceScorepad(state, { type: "undo", id: "z", at: stamp() }).ok).toBe(false);
  });

  it("ends immediately at the target and reopens when a correction removes the win", () => {
    let state = createScorepad(["Ana", "Ben"], { ...CLASSIC, entryThreshold: 0 });
    state = log(state, "sp1", 9_900);
    state = log(state, "sp2", 100);
    state = log(state, "sp1", 200);
    expect(deriveScorepad(state).phase).toBe("gameOver");
    expect(deriveScorepad(state).winnerId).toBe("sp1");

    const winning = deriveScorepad(state).entries.at(-1)?.entry.id as string;
    state = correct(state, winning, 50);
    const view = deriveScorepad(state);
    expect(view.phase).toBe("playing");
    expect(view.winnerId).toBeNull();
    expect(view.totals.sp1).toBe(9_950);
    expect(view.currentPlayerId).toBe("sp2");
  });

  it("plays complete rounds, opens sudden death on ties, and resolves a unique leader", () => {
    const config = { ...CLASSIC, target: 1_000, winCondition: "completeRound" as const };
    let state = createScorepad(["Ana", "Ben"], config);
    state = log(state, "sp1", 1_000);
    state = log(state, "sp2", 1_000);
    let view = deriveScorepad(state);
    expect(view.phase).toBe("playing");
    expect(view.suddenDeath).toBe(true);

    state = log(state, "sp1", 100);
    state = log(state, "sp2", 100);
    expect(deriveScorepad(state).suddenDeath).toBe(true);

    state = log(state, "sp1", 100);
    state = log(state, "sp2", 50);
    view = deriveScorepad(state);
    expect(view.phase).toBe("gameOver");
    expect(view.winnerId).toBe("sp1");
  });

  it("supports eight players and a manual end", () => {
    const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
    let state = createScorepad(names);
    expect(() => createScorepad([...names, "I"])).toThrow();

    for (const name of names) {
      const player = state.players.find((candidate) => candidate.name === name);
      state = log(state, player?.id as string, 100);
    }
    expect(deriveScorepad(state).totals.sp8).toBe(100);

    const ended: ScorepadResult = reduceScorepad(state, { type: "endGame", at: stamp() });
    expect(ended.ok).toBe(true);
    if (ended.ok) {
      const view = deriveScorepad(ended.state);
      expect(view.phase).toBe("gameOver");
      expect(view.manuallyEnded).toBe(true);
      expect(view.winnerId).toBe("sp1");
    }
  });

  it("round-trips a scorepad record", () => {
    let state = createScorepad(["Ana", "Ben"]);
    state = log(state, "sp1", 450);
    const record = toScorepadRecord("r1", state);
    expect(record.mode).toBe("score");
    expect(record.status).toBe("active");
    const migrated = migrateRecord(record);
    expect(migrated?.mode).toBe("score");
    if (migrated?.mode !== "score") throw new Error("expected a scorepad record");
    expect(migrated.state.ledger).toHaveLength(1);
    expect(deriveScorepad(migrated.state).totals.sp1).toBe(450);
  });
});
