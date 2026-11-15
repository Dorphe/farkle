import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { diceLeft, scoreSelection, selectedFaces, type DiceGameState } from "@farkle/engine";
import type { DiceTable } from "@farkle/dice";
import { useSession } from "@/store/session.ts";
import { GameTable, tableFootNote } from "@/components/GameTable.tsx";
import { WinnerScreen } from "@/components/WinnerScreen.tsx";
import { ScoreboardSheet } from "@/components/ScoreboardSheet.tsx";
import { GameMenu } from "@/components/GameMenu.tsx";
import { playCue, haptic } from "@/lib/audio.ts";
import { shareSummary } from "@/lib/share.ts";

const fmt = (value: number) => value.toLocaleString("en-US");

function randomRoll(count: number): number[] {
  const values = new Uint32Array(count);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => (value % 6) + 1);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
  } catch {
    return false;
  }
}

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Kept in step with --flight-ms in app.css: how long a die takes to reach the rack. */
const FLIGHT_MS = 340;

export function GameScreen() {
  const navigate = useNavigate();
  const game = useSession((state) => state.game);
  const settings = useSession((state) => state.settings);
  const dispatch = useSession((state) => state.dispatch);
  const undo = useSession((state) => state.undo);
  const undoBank = useSession((state) => state.undoBank);
  const rematch = useSession((state) => state.rematch);
  const endGame = useSession((state) => state.endGame);
  const setSettings = useSession((state) => state.setSettings);
  const error = useSession((state) => state.error);
  const clearError = useSession((state) => state.clearError);

  const [use3D, setUse3D] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [motionReady, setMotionReady] = useState(false);

  const tableHostRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<DiceTable | null>(null);
  const selectRef = useRef<(index: number) => void>(() => {});
  const gameRef = useRef<DiceGameState | null>(game);
  const shakeRef = useRef<() => void>(() => {});
  const busyRef = useRef(false);

  gameRef.current = game;
  busyRef.current = busy;

  const screenRef = useRef<HTMLElement>(null);
  const flightRef = useRef<{ nodes: HTMLButtonElement[]; from: number } | null>(null);

  /**
   * Clones the dice the player is keeping and leaves them on screen long enough
   * to fly into the rack. Runs before the state change so it can still measure
   * the dice; the clones are parked at their table position and only animated
   * once the rack has rendered the slots they are heading for.
   */
  const startDieFlight = useCallback((from: number) => {
    const root = screenRef.current;
    if (!root) return;
    if (useSession.getState().settings.reducedMotion || prefersReducedMotion()) return;
    const dice = Array.from(
      root.querySelectorAll<HTMLButtonElement>(".dice-grid .die[aria-pressed='true']"),
    );
    if (dice.length === 0) return;
    const nodes = dice.map((die) => {
      const box = die.getBoundingClientRect();
      const clone = die.cloneNode(true) as HTMLButtonElement;
      clone.classList.add("die-flight");
      clone.tabIndex = -1;
      clone.setAttribute("aria-hidden", "true");
      clone.style.left = `${box.left}px`;
      clone.style.top = `${box.top}px`;
      clone.style.width = `${box.width}px`;
      clone.style.height = `${box.height}px`;
      // The clone lives on <body>, outside the screen's custom properties.
      clone.style.transitionDuration = `${FLIGHT_MS}ms`;
      document.body.appendChild(clone);
      return clone;
    });
    flightRef.current = { nodes, from };
  }, []);

  const cancelDieFlight = useCallback(() => {
    const flight = flightRef.current;
    flightRef.current = null;
    flight?.nodes.forEach((node) => node.remove());
  }, []);

  // The rack has rendered its new slots: send each clone to its own slot.
  useLayoutEffect(() => {
    const flight = flightRef.current;
    if (!flight) return;
    flightRef.current = null;
    const root = screenRef.current;
    const slots = root ? Array.from(root.querySelectorAll<HTMLElement>(".rack-slot")) : [];
    flight.nodes.forEach((node, index) => {
      const slot = slots[flight.from + index];
      if (!slot) {
        node.remove();
        return;
      }
      const to = slot.getBoundingClientRect();
      const left = Number.parseFloat(node.style.left);
      const top = Number.parseFloat(node.style.top);
      const width = Number.parseFloat(node.style.width);
      node.classList.add("is-flying");
      // Commit the start position first, otherwise the browser only ever sees
      // the final transform and the die teleports into the rack.
      void node.offsetWidth;
      node.style.transform = `translate(${to.left - left}px, ${to.top - top}px) scale(${
        to.width / width
      })`;
      window.setTimeout(() => node.remove(), FLIGHT_MS + 120);
    });
  }, [game?.kept.length]);

  const toggle = useCallback(
    (index: number) => {
      const current = useSession.getState().game;
      if (!current || current.phase !== "awaitingKeep") return;
      dispatch({ type: "toggle", index });
      playCue("keep");
      haptic(8);
    },
    [dispatch],
  );
  selectRef.current = toggle;

  /* ---------- 3D table (lazy chunk) ---------- */
  useEffect(() => {
    if (settings.dice === "2d" || settings.reducedMotion || !hasWebGL()) return;
    let cancelled = false;
    let table: DiceTable | null = null;
    void import("@farkle/dice")
      .then((mod) => {
        if (cancelled || !tableHostRef.current) return;
        table = mod.createDiceTable(tableHostRef.current, {
          onSelect: (index) => selectRef.current(index),
        });
        if (table) {
          tableRef.current = table;
          setUse3D(true);
        }
      })
      .catch(() => {
        /* 2D fallback stays in charge */
      });
    return () => {
      cancelled = true;
      tableRef.current = null;
      setUse3D(false);
      table?.dispose();
    };
  }, [settings.dice, settings.reducedMotion]);
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    if (game?.phase === "awaitingKeep" && game.roll.length) {
      table.show(game.roll, game.selected);
    } else if (game?.phase !== "rolling") {
      table.clear();
    }
    table.setInteractive(game?.phase === "awaitingKeep");
  }, [game, use3D]);

  /* ---------- audio cues ---------- */
  useEffect(() => {
    const event = game?.lastEvent;
    if (!event) return;
    if (event.kind === "farkle" || event.kind === "penalty") {
      playCue("farkle");
      haptic([30, 40, 30]);
    } else if (event.kind === "bank") {
      playCue("bank");
    } else if (event.kind === "win") {
      playCue("win");
      haptic([20, 60, 20, 60]);
    }
  }, [game?.lastEvent]);

  /* ---------- errors / toast ---------- */
  useEffect(() => {
    if (!error) return;
    setToast(error);
    const timer = window.setTimeout(() => {
      setToast(null);
      clearError();
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [error, clearError]);

  useEffect(() => {
    if (!toast || error) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast, error]);

  /* ---------- roll ---------- */
  async function rollNow() {
    if (busyRef.current) return;
    let current = useSession.getState().game;
    if (!current) return;

    if (current.phase === "awaitingKeep") {
      startDieFlight(current.kept.length);
      const kept = dispatch({ type: "keep" });
      if (!kept.ok) {
        cancelDieFlight();
        return;
      }
      haptic(12);
      current = useSession.getState().game;
    }
    if (!current || current.phase !== "awaitingRoll") return;

    const count = diceLeft(current);
    if (count === 0) return;
    const started = dispatch({ type: "roll" });
    if (!started.ok) return;

    playCue("roll");
    setBusy(true);

    let values: number[];
    const table = tableRef.current;
    if (table && use3D) {
      try {
        values = await table.roll(count);
      } catch {
        values = randomRoll(count);
      }
    } else {
      await wait(settings.reducedMotion || prefersReducedMotion() ? 120 : 360);
      values = randomRoll(count);
    }

    setBusy(false);
    dispatch({ type: "rollResolved", values });
  }

  function bank() {
    const current = useSession.getState().game;
    if (!current) return;
    if (current.phase === "turnEnd" || current.phase === "gameOver") return;
    dispatch({ type: "bank" });
  }

  async function shareGame() {
    const current = useSession.getState().game;
    if (!current) return;
    const winner =
      current.players.find((player) => player.id === current.winnerId) ??
      current.players.slice().sort((a, b) => b.score - a.score)[0];
    if (!winner) return;
    const outcome = await shareSummary({
      winner: winner.name,
      winnerScore: winner.score,
      target: current.config.target,
      players: current.players.map((player) => ({ name: player.name, score: player.score })),
    });
    if (outcome === "copied") setToast("Scorecard copied to the clipboard.");
    else if (outcome === "failed") setToast("Couldn't share from this browser.");
  }

  /* ---------- shake ---------- */
  useEffect(() => {
    const supported =
      typeof DeviceMotionEvent !== "undefined" &&
      ((navigator.maxTouchPoints || 0) > 0 || "ontouchstart" in window);
    setMotionReady(supported);
  }, []);

  shakeRef.current = () => {
    const current = useSession.getState().game;
    if (!current || current.phase === "gameOver" || current.phase === "turnEnd") return;
    if (current.phase === "awaitingKeep") {
      const picked = selectedFaces(current);
      const selection = current.roll.length ? scoreSelection(picked, current.config) : 0;
      if (selection === null || picked.length === 0) {
        setToast("Shake won't roll — pick a scoring die first");
        return;
      }
    }
    void rollNow();
  };

  useEffect(() => {
    if (!settings.shake) return;
    let lastMagnitude: number | null = null;
    let lastJolt = 0;
    const onMotion = (event: DeviceMotionEvent) => {
      const acceleration = event.accelerationIncludingGravity ?? event.acceleration;
      if (!acceleration || acceleration.x == null) return;
      const magnitude = Math.hypot(
        acceleration.x ?? 0,
        acceleration.y ?? 0,
        acceleration.z ?? 0,
      );
      if (lastMagnitude === null) {
        lastMagnitude = magnitude;
        return;
      }
      const jolt = Math.abs(magnitude - lastMagnitude);
      lastMagnitude = magnitude;
      const now = performance.now();
      if (jolt > 15 && now - lastJolt > 1100) {
        lastJolt = now;
        shakeRef.current();
      }
    };
    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [settings.shake]);

  async function toggleShake() {
    if (settings.shake) {
      setSettings({ shake: false });
      return;
    }
    if (!window.isSecureContext) {
      setToast("Shake needs HTTPS (or localhost) to read the motion sensor.");
      return;
    }
    try {
      const motion = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
      if (typeof motion.requestPermission === "function") {
        const result = await motion.requestPermission();
        if (result !== "granted") {
          setToast("Motion access denied in browser settings.");
          return;
        }
      }
      setSettings({ shake: true });
      setToast("Shake to roll is on");
    } catch {
      setToast("Couldn't get motion access — check browser permissions.");
    }
  }

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const current = gameRef.current;
      if (!current) return;
      if (event.key === "Escape") {
        if (boardOpen) setBoardOpen(false);
        return;
      }
      if (event.key.toLowerCase() === "r") {
        void rollNow();
      } else if (event.key.toLowerCase() === "b") {
        bank();
      } else if (/^[1-6]$/.test(event.key) && current.phase === "awaitingKeep") {
        const index = Number(event.key) - 1;
        if (index < current.roll.length) selectRef.current(index);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [boardOpen]);

  if (!game) return <Navigate to="/" replace />;

  return (
    <GameTable
      game={game}
      interactive
      busy={busy}
      use3D={use3D}
      tableHost={tableHostRef}
      sectionRef={screenRef}
      className={settings.reducedMotion ? "is-reduced" : ""}
      onToggle={toggle}
      onRoll={() => void rollNow()}
      onBank={bank}
      onNextTurn={() => dispatch({ type: "nextTurn" })}
      onMenu={() => setMenuOpen(true)}
      footLeft={
        motionReady ? (
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={settings.shake}
            onClick={() => void toggleShake()}
          >
            <span className="knob" aria-hidden="true" />
            <span>Shake to roll</span>
          </button>
        ) : (
          <span />
        )
      }
      footNote={tableFootNote(game)}
    >
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}

      {undo ? (
        <div className="snackbar" role="status">
          <span>{undo.text}</span>
          <button type="button" onClick={undoBank}>
            Undo
          </button>
        </div>
      ) : null}

      {game.phase === "gameOver" ? (
        <WinnerScreen
          game={game}
          onRematch={() => {
            playCue("keep");
            rematch();
          }}
          onShare={() => void shareGame()}
          onScoreboard={() => setBoardOpen(true)}
        />
      ) : null}

      {boardOpen ? (
        <ScoreboardSheet
          players={game.players}
          winnerId={game.winnerId}
          onClose={() => setBoardOpen(false)}
        />
      ) : null}

      {menuOpen ? (
        <GameMenu
          mode="local"
          onClose={() => setMenuOpen(false)}
          onRules={() => {
            setMenuOpen(false);
            navigate("/rules");
          }}
          onLeave={() => {
            if (window.confirm("Leave the table? This game stays saved for resume.")) {
              setMenuOpen(false);
              navigate("/", { state: { fromLeave: true } });
            }
          }}
          onNewGame={() => {
            if (window.confirm("Start a new game? Current scores will be lost.")) {
              setMenuOpen(false);
              endGame();
              navigate("/");
            }
          }}
          onHistory={() => {
            setMenuOpen(false);
            navigate("/history");
          }}
          onSettings={() => {
            setMenuOpen(false);
            navigate("/settings");
          }}
        />
      ) : null}
    </GameTable>
  );
}