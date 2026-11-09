import { describe, expect, it } from "vitest";
import {
  bestScore,
  CLASSIC,
  detectPreset,
  isFarkle,
  preset,
  scoreSelection,
  type Face,
} from "../src/rules.ts";
import {
  createGame,
  currentPlayer,
  pendingTotal,
  reduce,
  type DiceGameState,
} from "../src/diceGame.ts";
import { migrateRecord, toRecord } from "../src/records.ts";

const f = (...faces: number[]) => faces as Face[];
const total = (faces: number[], config = CLASSIC) => bestScore(f(...faces), config, false);

describe("canonical scoring (PRD §7.2, Appendix B)", () => {
  it.each([
    [[1], 100],
    [[5], 50],
    [[1, 5], 150],
    [[5, 5, 5], 500],
    [[1, 1, 1], 1_000],
    [[1, 1, 1, 1], 2_000],
    [[1, 1, 1, 1, 1], 4_000],
    [[1, 1, 1, 1, 1, 1], 8_000],
    [[2, 2, 2], 200],
    [[6, 6, 6], 600],
    [[2, 2, 2, 2], 400],
    [[2, 2, 2, 2, 2], 800],
    [[2, 2, 2, 2, 2, 2], 1_600],
    [[1, 2, 3, 4, 5, 6], 1_500],
    [[2, 2, 3, 3, 4, 4], 1_500],
    [[2, 2, 2, 3, 3, 3], 2_500],
    [[2, 2, 2, 2, 3, 3], 400],
    [[1, 5, 2, 3, 4, 4], 150],
    [[1, 1, 1, 5, 5, 5], 2_500],
  ])("%j scores %i", (faces, expected) => {
    expect(total(faces)).toBe(expected);
  });

  it("honours variant flags", () => {
    expect(total([1, 2, 3, 4, 5, 6], { ...CLASSIC, straight: null })).toBe(150);
    expect(total([2, 2, 3, 3, 4, 4], { ...CLASSIC, threePairs: false })).toBe(0);
    expect(total([2, 2, 2, 3, 3, 3], { ...CLASSIC, twoTriplets: false })).toBe(500);
    expect(total([1, 2, 3, 4, 5, 6], { ...CLASSIC, straight: 3_000 })).toBe(3_000);
  });

  it("validates whole selections only", () => {
    expect(scoreSelection(f(1, 1))).toBe(200);
    expect(scoreSelection(f(2, 3))).toBeNull();
    expect(scoreSelection(f(1, 3))).toBeNull();
    expect(scoreSelection(f(2, 2, 2, 3, 3))).toBeNull();
    expect(scoreSelection(f(2, 2, 3, 3, 4, 4))).toBe(1_500);
  });

  it("detects farkles on the full roll", () => {
    expect(isFarkle(f(2, 3, 4, 6, 2, 3))).toBe(true);
    expect(isFarkle(f(1, 2, 3, 4, 6, 6))).toBe(false);
    expect(isFarkle(f(2, 2, 2, 3, 3, 3))).toBe(false);
  });

  it("exposes classic, bar, and family presets", () => {
    expect(preset("classic").target).toBe(10_000);
    expect(preset("bar").entryThreshold).toBe(500);
    expect(preset("family")).toMatchObject({ target: 5_000, farklePenalty: 0 });
    expect(detectPreset(preset("bar"))).toBe("bar");
    expect(detectPreset({ ...CLASSIC, firstPlayer: "random" })).toBe("classic");
    expect(detectPreset({ ...CLASSIC, target: 12_000 })).toBe("custom");
  });
});

function rolled(values: number[], state = createGame(["Maya", "Jonas"])): DiceGameState {
  const a = reduce(state, { type: "roll" });
  if (!a.ok) throw new Error(a.error);
  const b = reduce(a.state, { type: "rollResolved", values });
  if (!b.ok) throw new Error(b.error);
  return b.state;
}

describe("dice-turn reducer", () => {
  it("runs roll → keep → bank and passes the turn", () => {
    let state = rolled([1, 2, 3, 4, 6, 6]);
    expect(state.phase).toBe("awaitingKeep");
    state = reduce(state, { type: "toggle", index: 0 }).state;
    expect(pendingTotal(state)).toBe(100);
    state = reduce(state, { type: "keep" }).state;
    expect(state.turnScore).toBe(100);
    expect(state.kept).toEqual([1]);
    expect(state.phase).toBe("awaitingRoll");
    const banked = reduce(state, { type: "bank" });
    expect(banked.ok).toBe(true);
    expect(banked.state.players[0]?.score).toBe(100);
    expect(banked.state.turn).toBe(1);
    expect(banked.state.phase).toBe("awaitingRoll");
  });

  it("rejects invalid selections and out-of-phase actions", () => {
    const state = rolled([1, 2, 3, 4, 6, 6]);
    expect(reduce(state, { type: "toggle", index: 1 }).ok).toBe(true);
    const toggled = reduce(state, { type: "toggle", index: 1 }).state;
    expect(pendingTotal(toggled)).toBeNull();
    expect(reduce(toggled, { type: "bank" }).ok).toBe(false);
    expect(reduce(state, { type: "roll" }).ok).toBe(false);
    expect(reduce(state, { type: "keep" }).ok).toBe(false);
  });

  it("turns a farkle into turnEnd and carries the streak", () => {
    let state = rolled([2, 2, 3, 3, 4, 6]);
    expect(state.phase).toBe("turnEnd");
    expect(currentPlayer(state).streak).toBe(1);
    expect(state.lastEvent?.kind).toBe("farkle");
    state = reduce(state, { type: "nextTurn" }).state;
    expect(state.turn).toBe(1);
    expect(state.phase).toBe("awaitingRoll");
  });

  it("applies the −1,000 penalty on the third consecutive farkle, flooring at 0", () => {
    let state = createGame(["Maya", "Jonas"]);
    state.players[0]!.score = 400;
    for (let i = 0; i < 3; i++) {
      state = rolled([2, 2, 3, 3, 4, 6], state);
      state = reduce(state, { type: "nextTurn" }).state;
      if (i < 2) state.turn = 0;
    }
    expect(state.players[0]?.score).toBe(0);
    expect(state.players[0]?.streak).toBe(0);
  });

  it("treats six kept dice as hot dice", () => {
    let state = rolled([1, 1, 1, 1, 1, 1]);
    for (let i = 0; i < 6; i++) state = reduce(state, { type: "toggle", index: i }).state;
    state = reduce(state, { type: "keep" }).state;
    expect(state.turnScore).toBe(8_000);
    expect(state.kept).toEqual([]);
    expect(state.phase).toBe("awaitingRoll");
    expect(state.lastEvent?.text).toMatch(/Hot dice/);
  });

  it("applies the entry threshold only to a player on zero", () => {
    const bar = { ...CLASSIC, entryThreshold: 500 };
    let state = createGame(["Maya", "Jonas"], bar);
    state = rolled([1, 2, 3, 4, 6, 6], state);
    state = reduce(state, { type: "toggle", index: 0 }).state;
    const banked = reduce(state, { type: "bank" });
    expect(banked.ok).toBe(true);
    expect(banked.state.players[0]?.score).toBe(0);
    expect(banked.state.turn).toBe(1);

    let again = createGame(["Maya", "Jonas"], bar);
    again.players[0]!.score = 700;
    again = rolled([1, 2, 3, 4, 6, 6], again);
    again = reduce(again, { type: "toggle", index: 0 }).state;
    expect(reduce(again, { type: "bank" }).state.players[0]?.score).toBe(800);
  });

  it("ends the game immediately on a target bank and rematches with rotated first player", () => {
    let state = createGame(["Maya", "Jonas"]);
    state.players[0]!.score = 9_950;
    state.phase = "awaitingRoll";
    state.turnScore = 100;
    state = reduce(state, { type: "bank" }).state;
    expect(state.phase).toBe("gameOver");
    expect(state.winnerId).toBe("p1");
    state = reduce(state, { type: "rematch" }).state;
    expect(state.turn).toBe(1);
    expect(state.players.every((p) => p.score === 0)).toBe(true);
  });

  it("plays a complete round and opens sudden death on a tie", () => {
    const config = { ...CLASSIC, target: 1_000, winCondition: "completeRound" as const };
    let state = createGame(["Maya", "Jonas"], config);
    state.players[0]!.score = 900;
    state.phase = "awaitingRoll";
    state.turnScore = 1_100;
    state = reduce(state, { type: "bank" }).state;
    expect(state.phase).toBe("awaitingRoll");
    expect(state.targetReached).toBe(true);
    expect(state.turn).toBe(1);

    state.players[1]!.score = 1_950;
    state.phase = "awaitingRoll";
    state.turnScore = 50;
    state = reduce(state, { type: "bank" }).state;
    expect(state.phase).toBe("awaitingRoll");
    expect(state.suddenDeath).toBe(true);
    expect(state.winnerId).toBeNull();
  });

  it("declares the leader after a complete round", () => {
    const config = { ...CLASSIC, target: 1_000, winCondition: "completeRound" as const };
    let state = createGame(["Maya", "Jonas"], config);
    state.players[0]!.score = 900;
    state.phase = "awaitingRoll";
    state.turnScore = 1_100;
    state = reduce(state, { type: "bank" }).state;
    state.players[1]!.score = 100;
    state.phase = "awaitingRoll";
    state.turnScore = 100;
    state = reduce(state, { type: "bank" }).state;
    expect(state.phase).toBe("gameOver");
    expect(state.winnerId).toBe("p1");
    expect(state.suddenDeath).toBe(false);
  });

  it("migrates a mid-roll record back to a safe phase", () => {
    const record = toRecord("r1", createGame(["Maya", "Jonas"]));
    const broken = {
      ...record,
      state: { ...record.state, phase: "rolling" as const, roll: [1, 2] as Face[], selected: [true, false] },
    };
    const migrated = migrateRecord(broken);
    expect(migrated?.state.phase).toBe("awaitingRoll");
    expect(migrated?.state.roll).toEqual([]);
    expect(migrated?.status).toBe("active");
    expect(migrateRecord({ schemaVersion: 99 })).toBeNull();
  });
});
