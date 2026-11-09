import { create } from "zustand";
import type { DiceGameState, GameConfig } from "@farkle/engine";
import {
  PROTOCOL_VERSION,
  roomViewSchema,
  serverMessage,
  type ClientAction,
  type RoomView,
} from "@farkle/protocol";
import {
  forgetToken,
  onlineSocketUrl,
  saveOnlineName,
  saveToken,
  savedToken,
} from "@/lib/online.ts";

export type OnlineStatus = "idle" | "connecting" | "reconnecting" | "joined" | "error";

type Intent =
  | { t: "create"; name: string; config: GameConfig }
  | { t: "hello"; room: string; name?: string; token?: string };

interface OnlineState {
  status: OnlineStatus;
  room: RoomView | null;
  code: string | null;
  playerId: string | null;
  token: string | null;
  error: string | null;
  createRoom: (name: string, config: GameConfig) => void;
  joinRoom: (code: string, name?: string) => void;
  setReady: (ready: boolean) => void;
  startGame: () => void;
  dispatchAction: (action: ClientAction) => void;
  rematch: () => void;
  leave: () => void;
  clearError: () => void;
}

const FATAL_CODES = new Set([
  "ROOM_NOT_FOUND",
  "ROOM_STARTED",
  "ROOM_FULL",
  "NAME_REQUIRED",
  "PROTOCOL",
  "SEAT_TAKEN",
]);

const RECONNECT_WINDOW_MS = 5 * 60_000;

let socket: WebSocket | null = null;
let intent: Intent | null = null;
let seq = -1;
let lastPong = 0;
let manualClose = false;
let fatal = false;
let reconnectAttempts = 0;
let reconnectUntil = 0;
let reconnectTimer: number | null = null;
let pingTimer: number | null = null;

function clearReconnect(): void {
  if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectAttempts = 0;
  reconnectUntil = 0;
}

function stopHeartbeat(): void {
  if (pingTimer !== null) window.clearInterval(pingTimer);
  pingTimer = null;
}

function startHeartbeat(): void {
  stopHeartbeat();
  pingTimer = window.setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastPong > 45_000) {
      socket.close(4000, "Heartbeat timeout");
      return;
    }
    socket.send(JSON.stringify({ t: "ping", ts: Date.now() }));
  }, 20_000);
}

function send(message: unknown): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function currentIntent(): Intent | null {
  if (!intent) return null;
  if (intent.t === "hello") {
    return { ...intent, token: intent.token ?? savedToken(intent.room) ?? undefined };
  }
  return intent;
}

function handleWelcome(
  message: Extract<NonNullable<ReturnType<typeof parseServerMessage>>, { t: "welcome" }>,
  set: (patch: Partial<OnlineState>) => void,
): void {
  const room = message.room as RoomView;
  const mine = room.seats.find((seat) => seat.id === message.playerId);
  saveToken(room.code, message.token);
  if (mine) saveOnlineName(mine.name);
  intent = { t: "hello", room: room.code, token: message.token };
  seq = message.seq;
  reconnectAttempts = 0;
  reconnectUntil = 0;
  set({
    room,
    code: room.code,
    playerId: message.playerId,
    token: message.token,
    status: "joined",
    error: null,
  });
}

function parseServerMessage(raw: unknown) {
  const parsed = serverMessage.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export const useOnline = create<OnlineState>((set, get) => {
  function openSocket(): void {
    const url = onlineSocketUrl();
    if (!url) {
      set({
        status: "error",
        error: "Online play is not configured in this build. The room server address is missing.",
      });
      return;
    }

    manualClose = false;
    fatal = false;
    set({
      status: get().room ? "reconnecting" : "connecting",
      error: null,
    });

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      set({ status: "error", error: "Couldn't open a connection to the game server." });
      return;
    }
    socket = ws;

    ws.onopen = () => {
      lastPong = Date.now();
      startHeartbeat();
      const next = currentIntent();
      if (!next) return;
      if (next.t === "create") {
        send({ t: "create", v: PROTOCOL_VERSION, name: next.name, config: next.config });
      } else {
        send({ t: "hello", v: PROTOCOL_VERSION, room: next.room, name: next.name, token: next.token });
      }
    };

    ws.onmessage = (event) => {
      lastPong = Date.now();
      let raw: unknown;
      try {
        raw = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const message = parseServerMessage(raw);
      if (!message) return;

      if (message.t === "welcome") {
        handleWelcome(message, set);
        return;
      }
      if (message.t === "state") {
        if (message.seq <= seq) return;
        seq = message.seq;
        const parsed = roomViewSchema.safeParse(message.state);
        if (!parsed.success) return;
        set({ room: parsed.data as RoomView });
        return;
      }
      if (message.t === "error") {
        if (FATAL_CODES.has(message.code)) {
          fatal = true;
          intent = null;
          set({
            status: "error",
            room: message.code === "ROOM_NOT_FOUND" ? null : get().room,
            error: message.message,
          });
        } else {
          set({ error: message.message });
        }
      }
    };

    ws.onclose = () => {
      stopHeartbeat();
      if (socket === ws) socket = null;
      if (manualClose || fatal) {
        if (fatal) set({ status: get().room ? "reconnecting" : "error" });
        return;
      }
      scheduleReconnect();
    };
  }

  function scheduleReconnect(): void {
    const next = currentIntent();
    if (!next) {
      set({ status: get().room ? "reconnecting" : "idle" });
      return;
    }
    const now = Date.now();
    if (!reconnectUntil) reconnectUntil = now + RECONNECT_WINDOW_MS;
    if (now > reconnectUntil) {
      set({
        status: "error",
        error: "Lost the connection to the room. Reopen the invite link to rejoin.",
      });
      intent = null;
      return;
    }
    reconnectAttempts += 1;
    const delay = Math.min(5_000, 400 * 2 ** Math.min(reconnectAttempts, 4));
    set({ status: "reconnecting" });
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      openSocket();
    }, delay);
  }

  function start(nextIntent: Intent): void {
    clearReconnect();
    intent = nextIntent;
    seq = -1;
    if (socket) {
      socket.onclose = null;
      socket.close(1000, "New connection");
      socket = null;
    }
    openSocket();
  }

  return {
    status: "idle",
    room: null,
    code: null,
    playerId: null,
    token: null,
    error: null,

    createRoom: (name, config) => {
      start({ t: "create", name: name.trim().slice(0, 18), config: { ...config } });
    },

    joinRoom: (code, name) => {
      const normalized = code.trim().toUpperCase();
      const token = savedToken(normalized) ?? undefined;
      start({
        t: "hello",
        room: normalized,
        token,
        name: token ? undefined : name?.trim().slice(0, 18),
      });
    },

    setReady: (ready) => {
      send({ t: "ready", ready });
    },

    startGame: () => {
      send({ t: "start" });
    },

    dispatchAction: (action) => {
      if (!send({ t: "action", id: crypto.randomUUID(), action })) {
        set({ error: "Not connected to the room." });
      }
    },

    rematch: () => {
      get().dispatchAction({ type: "rematch" });
    },

    leave: () => {
      manualClose = true;
      clearReconnect();
      stopHeartbeat();
      if (socket?.readyState === WebSocket.OPEN) send({ t: "leave" });
      if (socket) {
        socket.onclose = null;
        socket.close(1000, "Left the room");
        socket = null;
      }
      const room = get().room;
      const code = get().code;
      // In a live game the seat must survive so the player can come back;
      // lobby seats are removed by the server, so the token is dead.
      if (code && (!room || room.phase === "lobby")) forgetToken(code);
      seq = -1;
      intent = null;
      set({
        status: "idle",
        room: null,
        code: null,
        playerId: null,
        token: null,
        error: null,
      });
    },

    clearError: () => set({ error: null }),
  };
});

export function mySeat(room: RoomView | null, playerId: string | null) {
  if (!room || !playerId) return null;
  return room.seats.find((seat) => seat.id === playerId) ?? null;
}

export function currentSeat(room: RoomView | null) {
  const game = room?.game;
  if (!room || !game) return null;
  return room.seats[game.turn] ?? null;
}

export function isMyTurn(room: RoomView | null, playerId: string | null): boolean {
  if (!room || !playerId || room.phase !== "playing") return false;
  return currentSeat(room)?.id === playerId;
}

export function gameOf(room: RoomView | null): DiceGameState | null {
  return room?.game ?? null;
}
