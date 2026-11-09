import { create } from "zustand";
import {
  CLASSIC,
  createGame,
  createScorepad,
  deriveScorepad,
  migrateRecord,
  pendingTotal,
  preset,
  reduce,
  reduceScorepad,
  toRecord,
  toScorepadRecord,
  type DiceGameAction,
  type DiceGameState,
  type GameConfig,
  type ScorepadAction,
  type ScorepadState,
} from "@farkle/engine";
import { getSetting, loadActiveRecord, saveRecord, setSetting } from "@/lib/db.ts";
import { setHapticsEnabled, setMuted } from "@/lib/audio.ts";
import { setAnalyticsEnabled, track } from "@/lib/analytics.ts";

export interface Settings {
  sound: boolean;
  haptics: boolean;
  shake: boolean;
  dice: "auto" | "3d" | "2d";
  reducedMotion: boolean;
  analytics: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  sound: true,
  haptics: true,
  shake: false,
  dice: "auto",
  reducedMotion: false,
  analytics: true,
};

interface UndoBank {
  state: DiceGameState;
  text: string;
  expiresAt: number;
}

const LEGACY_KEY = "farkle.prototype.v1";

interface SessionState {
  ready: boolean;
  game: DiceGameState | null;
  recordId: string | null;
  createdAt: number;
  scorepad: ScorepadState | null;
  scoreRecordId: string | null;
  scoreCreatedAt: number;
  roster: string[];
  scoreRoster: string[];
  settings: Settings;
  draftConfig: GameConfig;
  undo: UndoBank | null;
  error: string | null;
  hydrate: () => Promise<void>;
  addPlayer: (name: string) => string | null;
  removePlayer: (index: number) => void;
  addScorePlayer: (name: string) => string | null;
  removeScorePlayer: (index: number) => void;
  startGame: (config?: GameConfig) => void;
  startScoreGame: (config?: GameConfig) => void;
  dispatch: (action: DiceGameAction) => { ok: boolean; error?: string };
  dispatchScore: (action: ScorepadAction) => { ok: boolean; error?: string };
  undoBank: () => void;
  undoScore: () => void;
  rematch: () => void;
  endGame: () => void;
  endScoreGame: () => void;
  setSettings: (patch: Partial<Settings>) => void;
  setDraftConfig: (config: GameConfig) => void;
  clearError: () => void;
}

let saveTimer: number | null = null;
let undoTimer: number | null = null;

function clearUndoTimer(): void {
  if (undoTimer !== null) window.clearTimeout(undoTimer);
  undoTimer = null;
}

function scheduleSave(record: Parameters<typeof saveRecord>[0]): void {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void saveRecord(record).catch(() => {});
  }, 100);
}

function persist(recordId: string, createdAt: number, game: DiceGameState): void {
  scheduleSave(toRecord(recordId, game, createdAt));
}

function persistScore(recordId: string, createdAt: number, state: ScorepadState): void {
  scheduleSave(toScorepadRecord(recordId, state, createdAt));
}

function fromLegacy(): { state: DiceGameState; createdAt: number } | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const legacy = JSON.parse(raw) as {
      players?: { name: string; score: number; streak: number }[];
      turn?: number;
      over?: boolean;
      winner?: string | null;
      t?: { roll?: { face: number }[]; selected?: boolean[]; banked?: number; kept?: number[] };
    };
    if (!legacy.players || legacy.players.length < 2 || legacy.over) return null;
    const state = createGame(
      legacy.players.map((player) => String(player.name).slice(0, 18) || "Player"),
      CLASSIC,
      0,
    );
    state.players = legacy.players.slice(0, 6).map((player, index) => ({
      id: `p${index + 1}`,
      name: String(player.name).slice(0, 18),
      score: Math.max(0, Number(player.score) || 0),
      streak: Math.max(0, Number(player.streak) || 0),
      turns: 0,
    }));
    state.turn = Math.min(Math.max(0, legacy.turn ?? 0), state.players.length - 1);
    state.turnScore = Math.max(0, Number(legacy.t?.banked) || 0);
    state.kept = (legacy.t?.kept ?? []).filter((face) => face >= 1 && face <= 6) as DiceGameState["kept"];
    const roll = (legacy.t?.roll ?? [])
      .map((die) => die.face)
      .filter((face) => face >= 1 && face <= 6);
    state.roll = roll as DiceGameState["roll"];
    state.selected = roll.map((_, index) => Boolean(legacy.t?.selected?.[index]));
    state.phase = roll.length ? "awaitingKeep" : "awaitingRoll";
    return { state, createdAt: Date.now() };
  } catch {
    return null;
  }
}

export const useSession = create<SessionState>((set, get) => ({
  ready: false,
  game: null,
  recordId: null,
  createdAt: 0,
  scorepad: null,
  scoreRecordId: null,
  scoreCreatedAt: 0,
  roster: [],
  scoreRoster: [],
  settings: DEFAULT_SETTINGS,
  draftConfig: { ...CLASSIC },
  undo: null,
  error: null,

  hydrate: async () => {
    const storedSettings = await getSetting<Partial<Settings>>("settings", {});
    const settings = { ...DEFAULT_SETTINGS, ...storedSettings };
    const roster = await getSetting<string[]>("roster", []);
    const storedScoreRoster = await getSetting<string[]>("scoreRoster", []);
    const scoreRoster = storedScoreRoster.length ? storedScoreRoster : roster.slice(0, 8);
    const storedConfig = await getSetting<Partial<GameConfig>>("config", {});
    const draftConfig: GameConfig = { ...CLASSIC, ...storedConfig };
    setMuted(!settings.sound);
    setHapticsEnabled(settings.haptics);
    setAnalyticsEnabled(settings.analytics);
    set({ settings, roster, scoreRoster, draftConfig });

    let loadedLocal: { state: DiceGameState; id: string; createdAt: number } | null = null;
    let loadedScore: { state: ScorepadState; id: string; createdAt: number } | null = null;
    try {
      const record = await loadActiveRecord();
      const migrated = record ? migrateRecord(record) : null;
      if (migrated?.mode === "score") {
        loadedScore = { state: migrated.state, id: migrated.id, createdAt: migrated.createdAt };
      } else if (migrated?.mode === "local") {
        loadedLocal = { state: migrated.state, id: migrated.id, createdAt: migrated.createdAt };
      }
    } catch {
      /* storage unavailable — keep playing in memory */
    }

    if (loadedScore) {
      set({
        scorepad: loadedScore.state,
        scoreRecordId: loadedScore.id,
        scoreCreatedAt: loadedScore.createdAt,
        ready: true,
      });
    } else if (loadedLocal) {
      set({ game: loadedLocal.state, recordId: loadedLocal.id, createdAt: loadedLocal.createdAt, ready: true });
    } else {
      const legacy = fromLegacy();
      if (legacy) {
        const id = crypto.randomUUID();
        const record = toRecord(id, legacy.state, legacy.createdAt);
        void saveRecord(record).catch(() => {});
        set({ game: legacy.state, recordId: id, createdAt: legacy.createdAt, ready: true });
      } else {
        set({ ready: true });
      }
    }

    window.addEventListener("pagehide", () => {
      const { game, recordId, createdAt, scorepad, scoreRecordId, scoreCreatedAt } = get();
      if (game && recordId) void saveRecord(toRecord(recordId, game, createdAt)).catch(() => {});
      if (scorepad && scoreRecordId) {
        void saveRecord(toScorepadRecord(scoreRecordId, scorepad, scoreCreatedAt)).catch(() => {});
      }
    });
  },

  addPlayer: (name) => {
    const cleaned = name.trim().replace(/\s+/g, " ").slice(0, 18);
    if (!cleaned) return "Enter a name first.";
    const { roster } = get();
    if (roster.length >= 6) return "Six players is the limit.";
    if (roster.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())) {
      return "That name is already at the table.";
    }
    const next = [...roster, cleaned];
    set({ roster: next, error: null });
    void setSetting("roster", next);
    return null;
  },

  removePlayer: (index) => {
    const next = get().roster.filter((_, i) => i !== index);
    set({ roster: next, error: null });
    void setSetting("roster", next);
  },

  addScorePlayer: (name) => {
    const cleaned = name.trim().replace(/\s+/g, " ").slice(0, 18);
    if (!cleaned) return "Enter a name first.";
    const { scoreRoster } = get();
    if (scoreRoster.length >= 8) return "Eight players is the limit.";
    if (scoreRoster.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())) {
      return "That name is already at the table.";
    }
    const next = [...scoreRoster, cleaned];
    set({ scoreRoster: next, error: null });
    void setSetting("scoreRoster", next);
    return null;
  },

  removeScorePlayer: (index) => {
    const next = get().scoreRoster.filter((_, i) => i !== index);
    set({ scoreRoster: next, error: null });
    void setSetting("scoreRoster", next);
  },

  startGame: (config = preset("classic")) => {
    const { roster, game, recordId, createdAt, scorepad, scoreRecordId, scoreCreatedAt } = get();
    if (roster.length < 2) return;
    if (game && recordId) {
      void saveRecord({ ...toRecord(recordId, game, createdAt), status: "finished" }).catch(() => {});
    }
    if (scorepad && scoreRecordId) {
      void saveRecord({
        ...toScorepadRecord(scoreRecordId, scorepad, scoreCreatedAt),
        status: "finished",
      }).catch(() => {});
    }
    const nextGame = createGame(
      roster,
      config,
      config.firstPlayer === "random" ? Math.floor(Math.random() * roster.length) : 0,
    );
    const id = crypto.randomUUID();
    const startedAt = Date.now();
    clearUndoTimer();
    set({
      game: nextGame,
      recordId: id,
      createdAt: startedAt,
      scorepad: null,
      scoreRecordId: null,
      scoreCreatedAt: 0,
      undo: null,
      error: null,
    });
    persist(id, startedAt, nextGame);
    track("game_started", { mode: "local", players: roster.length, target: config.target });
  },

  startScoreGame: (config = preset("classic")) => {
    const { scoreRoster, game, recordId, createdAt, scorepad, scoreRecordId, scoreCreatedAt } = get();
    if (scoreRoster.length < 2) return;
    if (game && recordId) {
      void saveRecord({ ...toRecord(recordId, game, createdAt), status: "finished" }).catch(() => {});
    }
    if (scorepad && scoreRecordId) {
      void saveRecord({
        ...toScorepadRecord(scoreRecordId, scorepad, scoreCreatedAt),
        status: "finished",
      }).catch(() => {});
    }
    const state = createScorepad(
      scoreRoster,
      config,
      config.firstPlayer === "random" ? Math.floor(Math.random() * scoreRoster.length) : 0,
    );
    const id = crypto.randomUUID();
    const startedAt = Date.now();
    clearUndoTimer();
    set({
      scorepad: state,
      scoreRecordId: id,
      scoreCreatedAt: startedAt,
      game: null,
      recordId: null,
      createdAt: 0,
      undo: null,
      error: null,
    });
    persistScore(id, startedAt, state);
    track("game_started", { mode: "score", players: scoreRoster.length, target: config.target });
  },

  dispatch: (action) => {
    const { game, recordId, createdAt } = get();
    if (!game || !recordId) return { ok: false, error: "No game in progress." };
    const result = reduce(game, action);
    if (!result.ok) {
      set({ error: result.error });
      return { ok: false, error: result.error };
    }

    const finished = result.state.phase === "gameOver";
    let undo: UndoBank | null = null;
    if (action.type === "bank" && !finished) {
      const banked = pendingTotal(game) ?? 0;
      undo = {
        state: game,
        text: `Banked ${banked.toLocaleString("en-US")}`,
        expiresAt: Date.now() + 5_000,
      };
      clearUndoTimer();
      undoTimer = window.setTimeout(() => {
        undoTimer = null;
        useSession.setState({ undo: null });
      }, 5_000);
    } else {
      clearUndoTimer();
    }

    set({ game: result.state, undo, error: null });
    persist(recordId, createdAt, result.state);

    if (action.type === "roll") track("roll");
    if (action.type === "bank") track("bank", { target: result.state.config.target });
    if (result.state.lastEvent?.kind === "farkle") track("farkle");
    if (finished && game.phase !== "gameOver") {
      track("game_finished", { players: result.state.players.length, target: result.state.config.target });
    }
    return { ok: true };
  },

  undoBank: () => {
    const { undo, recordId, createdAt } = get();
    if (!undo || !recordId) return;
    clearUndoTimer();
    set({ game: undo.state, undo: null, error: null });
    persist(recordId, createdAt, undo.state);
    track("undo");
  },

  dispatchScore: (action) => {
    const { scorepad, scoreRecordId, scoreCreatedAt } = get();
    if (!scorepad || !scoreRecordId) return { ok: false, error: "No scorepad in progress." };
    const result = reduceScorepad(scorepad, action);
    if (!result.ok) {
      set({ error: result.error });
      return { ok: false, error: result.error };
    }
    set({ scorepad: result.state, error: null });
    persistScore(scoreRecordId, scoreCreatedAt, result.state);

    const view = deriveScorepad(result.state);
    if (action.type === "logTurn") {
      track(action.kind === "farkle" ? "farkle" : "turn_logged", {
        players: result.state.players.length,
      });
    } else if (action.type === "correct") {
      track("correction");
    } else if (action.type === "undo") {
      track("undo");
    }
    if (view.phase === "gameOver" && deriveScorepad(scorepad).phase !== "gameOver") {
      track("game_finished", { mode: "score", players: result.state.players.length });
    }
    return { ok: true };
  },

  undoScore: () => {
    const result = get().dispatchScore({
      type: "undo",
      id: crypto.randomUUID(),
      at: Date.now(),
    });
    if (result.ok) track("undo");
  },

  rematch: () => {
    const { game, recordId, createdAt } = get();
    if (!game || !recordId) return;
    const result = reduce(game, { type: "rematch" });
    if (!result.ok) return;
    const id = crypto.randomUUID();
    const startedAt = Date.now();
    clearUndoTimer();
    set({ game: result.state, recordId: id, createdAt: startedAt, undo: null, error: null });
    persist(id, startedAt, result.state);
    track("rematch", { players: result.state.players.length });
  },

  endGame: () => {
    const { game, recordId, createdAt } = get();
    if (game && recordId) {
      void saveRecord({ ...toRecord(recordId, game, createdAt), status: "finished" }).catch(() => {});
    }
    clearUndoTimer();
    set({ game: null, recordId: null, createdAt: 0, undo: null, error: null });
  },

  endScoreGame: () => {
    const { scorepad, scoreRecordId, scoreCreatedAt } = get();
    if (scorepad && scoreRecordId) {
      void saveRecord({
        ...toScorepadRecord(scoreRecordId, scorepad, scoreCreatedAt),
        status: "finished",
      }).catch(() => {});
    }
    set({
      scorepad: null,
      scoreRecordId: null,
      scoreCreatedAt: 0,
      error: null,
    });
  },

  setSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    setMuted(!settings.sound);
    setHapticsEnabled(settings.haptics);
    setAnalyticsEnabled(settings.analytics);
    void setSetting("settings", settings);
  },

  setDraftConfig: (config) => {
    set({ draftConfig: config });
    void setSetting("config", config);
  },

  clearError: () => set({ error: null }),
}));

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__farkle = useSession;
}
