/**
 * Wire protocol for ephemeral online rooms (Architecture §7).
 *
 * Rooms are in-memory only: a code is valid while its players are connected
 * and for a short grace period afterwards. Codes are four uppercase letters
 * or digits, e.g. `5T1S`.
 */
import { z } from "zod";
import type { DiceGameState, GameConfig } from "@farkle/engine";

export const PROTOCOL_VERSION = 2;
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_PATTERN = /^[A-Z0-9]{4}$/;
/** Code alphabet: no 0/O/1/I lookalikes for spoken or typed invites. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const MAX_SEATS = 6;
export const MIN_SEATS = 2;

/** Uppercase and trim a user-typed code; null when it can never be valid. */
export function normalizeRoomCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}

export const roomCode = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(ROOM_CODE_PATTERN, "Room codes are four letters or digits."));

export const displayName = z
  .string()
  .trim()
  .min(1, "Enter a name first.")
  .max(18, "Names are 18 characters at most.")
  .transform((value) => value.replace(/\s+/g, " "));

/**
 * Server-side copy of the engine's GameConfig. Kept here so the socket layer
 * can reject junk before it reaches the engine.
 */
export const gameConfigSchema = z.object({
  target: z.number().int().min(1_000).max(50_000),
  entryThreshold: z.number().int().min(0).max(10_000),
  straight: z.number().int().min(0).max(10_000).nullable(),
  threePairs: z.boolean(),
  twoTriplets: z.boolean(),
  farklePenalty: z.number().int().min(0).max(10_000),
  hotDice: z.boolean(),
  winCondition: z.enum(["first", "completeRound"]),
  firstPlayer: z.enum(["first", "random"]),
});

/** Actions a client may submit. `rollResolved` is server-only. */
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("roll") }),
  z.object({ type: z.literal("toggle"), index: z.number().int().min(0).max(5) }),
  z.object({ type: z.literal("keep") }),
  z.object({ type: z.literal("bank") }),
  z.object({ type: z.literal("nextTurn") }),
  z.object({ type: z.literal("rematch") }),
]);

export type ClientAction = z.infer<typeof actionSchema>;

export const clientMessage = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("create"),
    v: z.literal(PROTOCOL_VERSION),
    name: displayName,
    config: gameConfigSchema,
  }),
  z.object({
    t: z.literal("hello"),
    v: z.literal(PROTOCOL_VERSION),
    room: roomCode,
    token: z.string().min(1).max(128).optional(),
    name: displayName.optional(),
  }),
  z.object({ t: z.literal("ready"), ready: z.boolean() }),
  z.object({ t: z.literal("start") }),
  z.object({
    t: z.literal("action"),
    id: z.string().min(1).max(64),
    action: actionSchema,
  }),
  z.object({ t: z.literal("leave") }),
  z.object({ t: z.literal("ping"), ts: z.number() }),
]);

export type ClientMessage = z.infer<typeof clientMessage>;

export type RoomPhase = "lobby" | "playing" | "finished";

export interface SeatView {
  id: string;
  seat: number;
  name: string;
  ready: boolean;
  connected: boolean;
  host: boolean;
}

export interface RoomView {
  code: string;
  phase: RoomPhase;
  config: GameConfig;
  hostId: string;
  maxPlayers: number;
  seats: SeatView[];
  game: DiceGameState | null;
}

export const seatViewSchema = z.object({
  id: z.string(),
  seat: z.number().int().min(0).max(MAX_SEATS - 1),
  name: z.string(),
  ready: z.boolean(),
  connected: z.boolean(),
  host: z.boolean(),
});

export const roomViewSchema = z.object({
  code: z.string().regex(ROOM_CODE_PATTERN),
  phase: z.enum(["lobby", "playing", "finished"]),
  config: gameConfigSchema,
  hostId: z.string(),
  maxPlayers: z.number().int().min(MIN_SEATS).max(MAX_SEATS),
  seats: z.array(seatViewSchema),
  game: z.unknown().nullable(),
});

export const serverMessage = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("welcome"),
    playerId: z.string(),
    token: z.string(),
    room: roomViewSchema,
    seq: z.number().int().nonnegative(),
  }),
  z.object({
    t: z.literal("state"),
    seq: z.number().int().nonnegative(),
    state: roomViewSchema,
  }),
  z.object({ t: z.literal("error"), code: z.string(), message: z.string() }),
  z.object({ t: z.literal("pong"), ts: z.number() }),
]);

export type ServerMessage = z.infer<typeof serverMessage>;

export type ErrorCode =
  | "PROTOCOL"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_STARTED"
  | "NAME_REQUIRED"
  | "NOT_HOST"
  | "NOT_READY"
  | "NOT_YOUR_TURN"
  | "INVALID_ACTION"
  | "RATE_LIMITED"
  | "SEAT_TAKEN";

export type ManagerError = { ok: false; code: ErrorCode; message: string };
export type ManagerResult<T> = ({ ok: true } & T) | ManagerError;
