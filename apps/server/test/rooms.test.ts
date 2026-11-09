import { describe, expect, it } from "vitest";
import { CLASSIC } from "@farkle/engine";
import { RoomManager, EMPTY_ROOM_TTL_MS, LOBBY_SEAT_TTL_MS, type Room, type Seat } from "../src/rooms.ts";

function setup() {
  let now = 1_750_000_000_000;
  const codes = ["5T1S", "AB12", "CD34", "EF56", "GH78"];
  const manager = new RoomManager({
    now: () => now,
    generateCode: () => codes.shift() ?? "ZZ99",
  });
  return {
    manager,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function created(): {
  manager: RoomManager;
  room: Room;
  host: Seat;
  advance: (ms: number) => void;
} {
  const { manager, advance } = setup();
  const result = manager.createRoom("Ana", CLASSIC);
  if (!result.ok) throw new Error(result.message);
  return { manager, room: result.room, host: result.seat, advance };
}

describe("room codes", () => {
  it("creates four-character codes", () => {
    const { manager } = setup();
    const result = manager.createRoom("Ana", CLASSIC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.room.code).toBe("5T1S");
    expect(result.room.code).toMatch(/^[A-Z0-9]{4}$/);
  });

  it("normalizes lowercase joins", () => {
    const { manager, room } = created();
    const joined = manager.join(" 5t1s ", "Ben");
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.room.code).toBe(room.code);
    expect(joined.room.seats).toHaveLength(2);
  });

  it("rejects unknown codes", () => {
    const { manager } = setup();
    const joined = manager.join("NOPE", "Ben");
    expect(joined.ok).toBe(false);
    if (joined.ok) return;
    expect(joined.code).toBe("ROOM_NOT_FOUND");
  });
});

describe("lobby", () => {
  it("requires ready players before the host can start", () => {
    const { manager, room, host } = created();
    const joined = manager.join(room.code, "Ben");
    if (!joined.ok) throw new Error(joined.message);

    const notReady = manager.startGame(host.id);
    expect(notReady.ok).toBe(false);
    if (!notReady.ok) expect(notReady.code).toBe("NOT_READY");

    expect(manager.setReady(joined.seat.id, true).ok).toBe(true);
    const started = manager.startGame(host.id);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.room.phase).toBe("playing");
    expect(started.room.game?.players.map((player) => player.name)).toEqual(["Ana", "Ben"]);
  });

  it("only lets the host start", () => {
    const { manager, room } = created();
    const joined = manager.join(room.code, "Ben");
    if (!joined.ok) throw new Error(joined.message);
    manager.setReady(joined.seat.id, true);
    const started = manager.startGame(joined.seat.id);
    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.code).toBe("NOT_HOST");
  });

  it("restores a seat with its token after a refresh", () => {
    const { manager, room } = created();
    const joined = manager.join(room.code, "Ben");
    if (!joined.ok) throw new Error(joined.message);

    manager.disconnect(joined.seat.id);
    const before = room.seq;
    const back = manager.join(room.code, undefined, joined.seat.token);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.seat.id).toBe(joined.seat.id);
    expect(room.seq).toBe(before + 1);
    expect(manager.view(back.room).seats.find((seat) => seat.id === joined.seat.id)?.connected).toBe(true);
  });

  it("moves the host badge when the host leaves", () => {
    const { manager, room, host } = created();
    const joined = manager.join(room.code, "Ben");
    if (!joined.ok) throw new Error(joined.message);

    const before = room.seq;
    manager.disconnect(host.id);
    const view = manager.view(room);
    expect(room.seq).toBe(before + 1);
    expect(view.hostId).toBe(joined.seat.id);
    expect(view.seats.find((seat) => seat.id === joined.seat.id)?.host).toBe(true);
  });
});

describe("game authority", () => {
  function playable() {
    const context = created();
    const joined = context.manager.join(context.room.code, "Ben");
    if (!joined.ok) throw new Error(joined.message);
    context.manager.setReady(joined.seat.id, true);
    const started = context.manager.startGame(context.host.id);
    if (!started.ok) throw new Error(started.message);
    return { ...context, ben: joined.seat, room: started.room };
  }

  it("generates the roll on the server and broadcasts a new seq", () => {
    const { manager, room, host } = playable();
    const before = room.seq;
    const result = manager.apply(host.id, { type: "roll" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const game = result.room.game;
    expect(result.room.seq).toBe(before + 1);
    expect(game?.roll).toHaveLength(6);
    for (const face of game?.roll ?? []) {
      expect(face).toBeGreaterThanOrEqual(1);
      expect(face).toBeLessThanOrEqual(6);
    }
    expect(["awaitingKeep", "turnEnd"]).toContain(game?.phase);
  });

  it("rejects out-of-turn actions", () => {
    const { manager, ben } = playable();
    const result = manager.apply(ben.id, { type: "roll" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_YOUR_TURN");
  });

  it("ignores a replayed action id", () => {
    const { manager, host, room } = playable();
    const first = manager.apply(host.id, { type: "roll" }, "a1");
    if (!first.ok) throw new Error(first.message);
    const seq = first.room.seq;
    const before = JSON.stringify(first.room.game);
    const replay = manager.apply(host.id, { type: "roll" }, "a1");
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.room.seq).toBe(seq);
    expect(JSON.stringify(replay.room.game)).toBe(before);
    expect(replay.room.code).toBe(room.code);
  });

  it("refuses a late guest without a token", () => {
    const { manager, room } = playable();
    const late = manager.join(room.code, "Cleo");
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.code).toBe("ROOM_STARTED");
  });

  it("only the host can start a rematch", () => {
    const { manager, room, host, ben } = playable();
    room.game = { ...room.game!, phase: "gameOver", winnerId: room.game!.players[0]!.id };
    room.phase = "finished";
    const denied = manager.apply(ben.id, { type: "rematch" });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("NOT_HOST");
    const allowed = manager.apply(host.id, { type: "rematch" });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) expect(allowed.room.phase).toBe("playing");
  });
});

describe("ephemeral lifecycle", () => {
  it("drops a room once everybody has been gone for ten minutes", () => {
    const { manager, room, host, advance } = created();
    manager.disconnect(host.id);
    expect(manager.size).toBe(1);
    advance(EMPTY_ROOM_TTL_MS - 1);
    expect(manager.sweep()).toEqual([]);
    advance(2);
    expect(manager.sweep()).toEqual([room.code]);
    expect(manager.size).toBe(0);
  });

  it("prunes a lobby seat left behind by a dropout", () => {
    const { manager, room, advance } = created();
    const joined = manager.join(room.code, "Ben");
    if (!joined.ok) throw new Error(joined.message);
    manager.disconnect(joined.seat.id);
    const before = room.seq;

    advance(LOBBY_SEAT_TTL_MS + 1);
    expect(manager.sweep()).toEqual([]);
    expect(room.seats.map((seat) => seat.name)).toEqual(["Ana"]);
    expect(room.seq).toBe(before + 1);
  });
});
