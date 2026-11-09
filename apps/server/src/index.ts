import Fastify from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { clientMessage, PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from "@farkle/protocol";
import { RoomManager, type Room } from "./rooms.ts";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

interface Connection {
  playerId: string | null;
  roomCode: string | null;
  alive: boolean;
  bucket: { count: number; resetAt: number };
}

const manager = new RoomManager();
const clients = new Map<WebSocket, Connection>();
const socketsByPlayer = new Map<string, WebSocket>();
const createBuckets = new Map<string, { count: number; resetAt: number }>();
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 500);

function allowCreate(ip: string): boolean {
  const now = Date.now();
  const bucket = createBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    createBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= 5;
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
await app.register(websocket);

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== 1) return;
  socket.send(JSON.stringify(message));
}

function sendError(socket: WebSocket, code: string, message: string): void {
  send(socket, { t: "error", code, message });
}

function broadcast(room: Room): void {
  const state = manager.view(room);
  for (const seat of room.seats) {
    if (!seat.connected) continue;
    const socket = socketsByPlayer.get(seat.id);
    if (socket) send(socket, { t: "state", seq: room.seq, state });
  }
}

function bind(socket: WebSocket, playerId: string, room: Room): void {
  const previous = socketsByPlayer.get(playerId);
  if (previous && previous !== socket) {
    const old = clients.get(previous);
    if (old) old.playerId = null;
    previous.close(4001, "Replaced by a newer connection");
  }
  const connection = clients.get(socket);
  if (connection) {
    connection.playerId = playerId;
    connection.roomCode = room.code;
  }
  socketsByPlayer.set(playerId, socket);
}

function unbind(socket: WebSocket): Connection | null {
  const connection = clients.get(socket) ?? null;
  if (connection?.playerId && socketsByPlayer.get(connection.playerId) === socket) {
    socketsByPlayer.delete(connection.playerId);
  }
  return connection;
}

function rateLimited(connection: Connection): boolean {
  const now = Date.now();
  if (now > connection.bucket.resetAt) {
    connection.bucket = { count: 0, resetAt: now + 5_000 };
  }
  connection.bucket.count += 1;
  return connection.bucket.count > 30;
}

app.get("/health", async () => ({ ok: true, rooms: manager.size, protocol: PROTOCOL_VERSION }));

app.get("/ws", { websocket: true }, (socket, request) => {
  if (ALLOWED_ORIGINS.length) {
    const origin = request.headers.origin;
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      socket.close(4403, "Origin not allowed");
      return;
    }
  }

  const connection: Connection = {
    playerId: null,
    roomCode: null,
    alive: true,
    bucket: { count: 0, resetAt: Date.now() + 5_000 },
  };
  clients.set(socket, connection);

  socket.on("pong", () => {
    connection.alive = true;
  });

  socket.on("message", (raw) => {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw.toString());
    } catch {
      sendError(socket, "PROTOCOL", "Messages must be JSON.");
      return;
    }
    const parsed = clientMessage.safeParse(parsedJson);
    if (!parsed.success) {
      sendError(socket, "PROTOCOL", parsed.error.issues[0]?.message ?? "Unsupported message.");
      return;
    }
    const message: ClientMessage = parsed.data;

    if (message.t === "ping") {
      send(socket, { t: "pong", ts: message.ts });
      return;
    }

    if (message.t === "create") {
      if (connection.playerId) {
        sendError(socket, "PROTOCOL", "You're already in a room.");
        return;
      }
      if (!allowCreate(request.ip)) {
        sendError(socket, "RATE_LIMITED", "Too many rooms from this connection. Try again in a minute.");
        socket.close(4400, "RATE_LIMITED");
        return;
      }
      if (manager.size >= MAX_ROOMS) {
        sendError(socket, "ROOM_FULL", "The room server is at capacity. Try again shortly.");
        socket.close(4400, "ROOM_FULL");
        return;
      }
      const result = manager.createRoom(message.name, message.config);
      if (!result.ok) {
        sendError(socket, result.code, result.message);
        socket.close(4400, result.code);
        return;
      }
      bind(socket, result.seat.id, result.room);
      send(socket, {
        t: "welcome",
        playerId: result.seat.id,
        token: result.seat.token,
        room: manager.view(result.room),
        seq: result.room.seq,
      });
      return;
    }

    if (message.t === "hello") {
      if (connection.playerId) {
        sendError(socket, "PROTOCOL", "You're already in a room.");
        return;
      }
      const result = manager.join(message.room, message.name, message.token);
      if (!result.ok) {
        sendError(socket, result.code, result.message);
        socket.close(4400, result.code);
        return;
      }
      bind(socket, result.seat.id, result.room);
      send(socket, {
        t: "welcome",
        playerId: result.seat.id,
        token: result.seat.token,
        room: manager.view(result.room),
        seq: result.room.seq,
      });
      broadcast(result.room);
      return;
    }

    const playerId = connection.playerId;
    if (!playerId) {
      sendError(socket, "PROTOCOL", "Join a room first.");
      return;
    }

    if (message.t === "leave") {
      const room = manager.leave(playerId);
      unbind(socket);
      if (room) broadcast(room);
      socket.close(1000, "Left the room");
      return;
    }

    if (message.t === "ready") {
      const result = manager.setReady(playerId, message.ready);
      if (!result.ok) {
        sendError(socket, result.code, result.message);
        return;
      }
      broadcast(result.room);
      return;
    }

    if (message.t === "start") {
      const result = manager.startGame(playerId);
      if (!result.ok) {
        sendError(socket, result.code, result.message);
        return;
      }
      broadcast(result.room);
      return;
    }

    if (message.t === "action") {
      if (rateLimited(connection)) {
        sendError(socket, "RATE_LIMITED", "Slow down a moment.");
        return;
      }
      const result = manager.apply(playerId, message.action, message.id);
      if (!result.ok) {
        sendError(socket, result.code, result.message);
        return;
      }
      broadcast(result.room);
    }
  });

  socket.on("close", () => {
    const connection = clients.get(socket);
    clients.delete(socket);
    if (!connection?.playerId) return;
    // A socket replaced by a reconnect must not knock the player offline.
    if (socketsByPlayer.get(connection.playerId) !== socket) return;
    socketsByPlayer.delete(connection.playerId);
    const room = manager.disconnect(connection.playerId);
    if (room) broadcast(room);
  });

  socket.on("error", () => {
    socket.terminate();
  });
});

const heartbeat = setInterval(() => {
  for (const [socket, connection] of clients) {
    if (!connection.alive) {
      socket.terminate();
      continue;
    }
    connection.alive = false;
    try {
      socket.ping();
    } catch {
      socket.terminate();
    }
  }
}, 30_000);

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of createBuckets) {
    if (now > bucket.resetAt) createBuckets.delete(ip);
  }
  const removed = manager.sweep();
  if (!removed.length) return;
  const gone = new Set(removed);
  for (const socket of clients.keys()) {
    const connection = clients.get(socket);
    if (connection?.roomCode && gone.has(connection.roomCode)) {
      sendError(socket, "ROOM_NOT_FOUND", "That room has expired.");
      socket.close(4404, "Room expired");
    }
  }
}, 60_000);

async function shutdown(): Promise<void> {
  clearInterval(heartbeat);
  clearInterval(sweeper);
  for (const socket of clients.keys()) socket.close(1001, "Server shutting down");
  await app.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await app.listen({ port: PORT, host: HOST });
app.log.info(`Farkle rooms listening on ${HOST}:${PORT} (ephemeral, in-memory)`);
