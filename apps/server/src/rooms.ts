/**
 * Ephemeral room manager. Everything lives in memory: restarting the server
 * drops every room, which is the intended lifecycle for v1.
 */
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import {
  createGame,
  diceLeft,
  reduce,
  type DiceGameAction,
  type DiceGameState,
  type GameConfig,
} from "@farkle/engine";
import {
  MAX_SEATS,
  MIN_SEATS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  normalizeRoomCode,
  type ClientAction,
  type ManagerResult,
  type RoomView,
} from "@farkle/protocol";

/** Empty rooms are dropped quickly; idle rooms keep a friend's seat for a while. */
export const EMPTY_ROOM_TTL_MS = 10 * 60_000;
export const IDLE_ROOM_TTL_MS = 2 * 60 * 60_000;
export const LOBBY_SEAT_TTL_MS = 2 * 60_000;
const MAX_REMEMBERED_ACTIONS = 400;

export interface Seat {
  id: string;
  token: string;
  name: string;
  ready: boolean;
  connected: boolean;
  joinedAt: number;
  disconnectedAt: number | null;
}

export interface Room {
  code: string;
  hostId: string;
  config: GameConfig;
  phase: "lobby" | "playing" | "finished";
  seats: Seat[];
  game: DiceGameState | null;
  seq: number;
  createdAt: number;
  lastActivity: number;
  emptySince: number | null;
  actions: Map<string, number>;
}

interface RoomManagerOptions {
  now?: () => number;
  generateCode?: () => string;
}

function generateRoomCode(): string {
  let code = "";
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function cleanName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ").slice(0, 18);
  return name.length > 0 ? name : null;
}

function normalizeCode(raw: string): string | null {
  return normalizeRoomCode(raw);
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly byPlayer = new Map<string, string>();
  private readonly now: () => number;
  private readonly generateCode: () => string;

  constructor(options: RoomManagerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.generateCode = options.generateCode ?? generateRoomCode;
  }

  get size(): number {
    return this.rooms.size;
  }

  createRoom(name: string, config: GameConfig): ManagerResult<{ room: Room; seat: Seat }> {
    const clean = cleanName(name);
    if (!clean) return { ok: false, code: "NAME_REQUIRED", message: "Enter a name first." };

    let code = this.generateCode();
    for (let attempt = 0; this.rooms.has(code) && attempt < 50; attempt += 1) {
      code = this.generateCode();
    }
    if (this.rooms.has(code)) {
      return { ok: false, code: "ROOM_FULL", message: "Couldn't allocate a room code. Try again." };
    }

    const now = this.now();
    const seat = this.makeSeat(clean, now);
    seat.ready = true;
    const room: Room = {
      code,
      hostId: seat.id,
      config: { ...config },
      phase: "lobby",
      seats: [seat],
      game: null,
      seq: 1,
      createdAt: now,
      lastActivity: now,
      emptySince: null,
      actions: new Map(),
    };
    this.rooms.set(code, room);
    this.byPlayer.set(seat.id, code);
    return { ok: true, room, seat };
  }

  /** Reconnect with a token, or join a lobby by name. */
  join(rawCode: string, name?: string, token?: string): ManagerResult<{ room: Room; seat: Seat }> {
    const code = normalizeCode(rawCode);
    if (!code) return { ok: false, code: "ROOM_NOT_FOUND", message: "That room code doesn't look right." };
    const room = this.rooms.get(code);
    if (!room) {
      return { ok: false, code: "ROOM_NOT_FOUND", message: "That room has expired or never existed." };
    }

    if (token) {
      const seat = room.seats.find((candidate) => candidate.token === token);
      if (seat) {
        seat.connected = true;
        seat.disconnectedAt = null;
        room.emptySince = null;
        this.ensureHost(room);
        room.seq += 1;
        room.lastActivity = Math.max(room.lastActivity, this.now());
        return { ok: true, room, seat };
      }
      if (room.phase !== "lobby") {
        return {
          ok: false,
          code: "ROOM_STARTED",
          message: "That game is already in progress. Ask for a fresh invite.",
        };
      }
    }

    if (room.phase !== "lobby") {
      return {
        ok: false,
        code: "ROOM_STARTED",
        message: "That game is already in progress. Ask for a fresh invite.",
      };
    }
    if (room.seats.length >= MAX_SEATS) {
      return { ok: false, code: "ROOM_FULL", message: "This room already has six players." };
    }
    const clean = name ? cleanName(name) : null;
    if (!clean) return { ok: false, code: "NAME_REQUIRED", message: "Enter a name to join." };

    const now = this.now();
    const seat = this.makeSeat(clean, now);
    room.seats.push(seat);
    room.emptySince = null;
    room.lastActivity = now;
    room.seq += 1;
    this.byPlayer.set(seat.id, room.code);
    this.ensureHost(room);
    return { ok: true, room, seat };
  }

  setReady(playerId: string, ready: boolean): ManagerResult<{ room: Room }> {
    const found = this.locate(playerId);
    if (!found) return { ok: false, code: "ROOM_NOT_FOUND", message: "You're not in a room." };
    const { room, seat } = found;
    if (room.phase !== "lobby") {
      return { ok: false, code: "INVALID_ACTION", message: "The game already started." };
    }
    seat.ready = ready;
    room.lastActivity = this.now();
    room.seq += 1;
    return { ok: true, room };
  }

  startGame(playerId: string): ManagerResult<{ room: Room }> {
    const found = this.locate(playerId);
    if (!found) return { ok: false, code: "ROOM_NOT_FOUND", message: "You're not in a room." };
    const { room } = found;
    if (room.phase !== "lobby") {
      return { ok: false, code: "INVALID_ACTION", message: "The game already started." };
    }
    if (room.hostId !== playerId) {
      return { ok: false, code: "NOT_HOST", message: "Only the host can start the game." };
    }

    const players = room.seats.filter((seat) => seat.connected);
    if (players.length < MIN_SEATS) {
      return { ok: false, code: "NOT_READY", message: "At least two players need to be here." };
    }
    if (players.some((seat) => !seat.ready)) {
      return { ok: false, code: "NOT_READY", message: "Everyone needs to tap Ready first." };
    }

    // Drop anyone who left the lobby so the game's turn order is exact.
    for (const seat of room.seats) {
      if (!seat.connected) this.byPlayer.delete(seat.id);
    }
    room.seats = players;

    const first = room.config.firstPlayer === "random" ? randomInt(players.length) : 0;
    room.game = createGame(
      players.map((seat) => seat.name),
      room.config,
      first,
    );
    room.phase = "playing";
    room.seq += 1;
    room.lastActivity = this.now();
    return { ok: true, room };
  }

  apply(playerId: string, action: ClientAction, actionId?: string): ManagerResult<{ room: Room }> {
    const found = this.locate(playerId);
    if (!found) return { ok: false, code: "ROOM_NOT_FOUND", message: "You're not in a room." };
    const { room } = found;

    if (actionId) {
      const key = `${playerId}:${actionId}`;
      if (room.actions.has(key)) return { ok: true, room };
    }

    if (room.phase === "lobby") {
      return { ok: false, code: "INVALID_ACTION", message: "The game hasn't started yet." };
    }
    const game = room.game;
    if (!game) return { ok: false, code: "INVALID_ACTION", message: "There is no game in this room." };

    if (action.type === "rematch") {
      if (room.hostId !== playerId) {
        return { ok: false, code: "NOT_HOST", message: "Only the host can start a rematch." };
      }
      const result = reduce(game, { type: "rematch" });
      if (!result.ok) return { ok: false, code: "INVALID_ACTION", message: result.error };
      room.game = result.state;
      room.phase = "playing";
      room.seq += 1;
      room.lastActivity = this.now();
      this.recordAction(room, playerId, actionId);
      return { ok: true, room };
    }

    if (room.phase !== "playing") {
      return { ok: false, code: "INVALID_ACTION", message: "This game is over." };
    }

    const current = room.seats[game.turn];
    if (!current || current.id !== playerId) {
      return { ok: false, code: "NOT_YOUR_TURN", message: "It's not your turn." };
    }

    let next: DiceGameState;
    if (action.type === "roll") {
      const started = reduce(game, { type: "roll" });
      if (!started.ok) return { ok: false, code: "INVALID_ACTION", message: started.error };
      const count = diceLeft(started.state);
      const values = Array.from({ length: count }, () => randomInt(1, 7));
      const resolved = reduce(started.state, { type: "rollResolved", values });
      if (!resolved.ok) return { ok: false, code: "INVALID_ACTION", message: resolved.error };
      next = resolved.state;
    } else {
      const result = reduce(game, action as DiceGameAction);
      if (!result.ok) return { ok: false, code: "INVALID_ACTION", message: result.error };
      next = result.state;
    }

    room.game = next;
    room.phase = next.phase === "gameOver" ? "finished" : "playing";
    room.seq += 1;
    room.lastActivity = this.now();
    this.recordAction(room, playerId, actionId);
    return { ok: true, room };
  }

  /** A socket closed. The seat survives for a while so a refresh can reclaim it. */
  disconnect(playerId: string): Room | null {
    const found = this.locate(playerId);
    if (!found) return null;
    const { room, seat } = found;
    seat.connected = false;
    seat.disconnectedAt = this.now();
    if (room.seats.every((candidate) => !candidate.connected)) {
      room.emptySince ??= this.now();
    }
    this.ensureHost(room);
    room.seq += 1;
    return room;
  }

  /** An explicit leave: lobby seats vanish immediately, game seats stay for a reconnect. */
  leave(playerId: string): Room | null {
    const found = this.locate(playerId);
    if (!found) return null;
    const { room, seat } = found;
    if (room.phase === "lobby") {
      room.seats = room.seats.filter((candidate) => candidate.id !== playerId);
      this.byPlayer.delete(playerId);
      room.seq += 1;
      room.lastActivity = this.now();
      if (room.seats.length === 0) room.emptySince = this.now();
      this.ensureHost(room);
      return room;
    }
    return this.disconnect(playerId);
  }

  view(room: Room): RoomView {
    return {
      code: room.code,
      phase: room.phase,
      config: room.config,
      hostId: room.hostId,
      maxPlayers: MAX_SEATS,
      seats: room.seats.map((seat, index) => ({
        id: seat.id,
        seat: index,
        name: seat.name,
        ready: seat.ready,
        connected: seat.connected,
        host: seat.id === room.hostId,
      })),
      game: room.game,
    };
  }

  sweep(): string[] {
    const now = this.now();
    const removed: string[] = [];
    for (const room of [...this.rooms.values()]) {
      if (room.phase === "lobby") {
        const stale = room.seats.filter(
          (seat) =>
            !seat.connected &&
            seat.disconnectedAt !== null &&
            now - seat.disconnectedAt > LOBBY_SEAT_TTL_MS,
        );
        if (stale.length) {
          for (const seat of stale) this.byPlayer.delete(seat.id);
          room.seats = room.seats.filter(
            (candidate) => !stale.some((seat) => seat.id === candidate.id),
          );
          this.ensureHost(room);
          room.seq += 1;
        }
      }

      if (room.seats.every((seat) => !seat.connected)) {
        room.emptySince ??= now;
        if (now - room.emptySince >= EMPTY_ROOM_TTL_MS) {
          this.destroy(room);
          removed.push(room.code);
          continue;
        }
      } else {
        room.emptySince = null;
      }

      if (now - room.lastActivity >= IDLE_ROOM_TTL_MS) {
        this.destroy(room);
        removed.push(room.code);
      }
    }
    return removed;
  }

  private locate(playerId: string): { room: Room; seat: Seat } | null {
    const code = this.byPlayer.get(playerId);
    if (!code) return null;
    const room = this.rooms.get(code);
    const seat = room?.seats.find((candidate) => candidate.id === playerId);
    if (!room || !seat) {
      this.byPlayer.delete(playerId);
      return null;
    }
    return { room, seat };
  }

  private makeSeat(name: string, now: number): Seat {
    return {
      id: randomUUID(),
      token: randomBytes(24).toString("base64url"),
      name,
      ready: false,
      connected: true,
      joinedAt: now,
      disconnectedAt: null,
    };
  }

  private ensureHost(room: Room): void {
    const host = room.seats.find((seat) => seat.id === room.hostId);
    if (host?.connected) return;
    const next = room.seats.find((seat) => seat.connected);
    if (next) room.hostId = next.id;
  }

  private recordAction(room: Room, playerId: string, actionId?: string): void {
    if (!actionId) return;
    room.actions.set(`${playerId}:${actionId}`, room.seq);
    while (room.actions.size > MAX_REMEMBERED_ACTIONS) {
      const oldest = room.actions.keys().next().value;
      if (oldest === undefined) break;
      room.actions.delete(oldest);
    }
  }

  private destroy(room: Room): void {
    this.rooms.delete(room.code);
    for (const seat of room.seats) this.byPlayer.delete(seat.id);
  }
}
