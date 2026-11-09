/**
 * Wire protocol skeleton (Architecture §7). Frozen in M0; used from M3.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 1;

export const roomCode = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{6}$/);
export const displayName = z.string().trim().min(1).max(18);

export const actionSchema = z
  .object({ type: z.string() })
  .passthrough();

export const clientMessage = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("hello"),
    v: z.literal(PROTOCOL_VERSION),
    room: roomCode,
    token: z.string().optional(),
    name: displayName.optional(),
  }),
  z.object({ t: z.literal("ready"), ready: z.boolean() }),
  z.object({ t: z.literal("start") }),
  z.object({ t: z.literal("action"), id: z.string().min(1).max(64), action: actionSchema }),
  z.object({ t: z.literal("ping"), ts: z.number() }),
]);

export type ClientMessage = z.infer<typeof clientMessage>;

export const serverMessage = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("welcome"),
    playerId: z.string(),
    token: z.string(),
    seat: z.number().int().min(0).max(5),
    state: z.unknown(),
    seq: z.number().int().nonnegative(),
  }),
  z.object({ t: z.literal("state"), seq: z.number().int(), state: z.unknown(), lastEvent: z.unknown().optional() }),
  z.object({ t: z.literal("presence"), players: z.array(z.object({ id: z.string(), connected: z.boolean(), away: z.boolean() })) }),
  z.object({ t: z.literal("error"), code: z.string(), message: z.string() }),
  z.object({ t: z.literal("pong"), ts: z.number() }),
]);

export type ServerMessage = z.infer<typeof serverMessage>;
