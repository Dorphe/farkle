import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  currentPlayer,
  diceLeft,
  pendingTotal,
  scoreSelection,
  selectedFaces,
  type DiceGameState,
  type Face,
} from "@farkle/engine";
import type { DiceTable } from "@farkle/dice";
import { useSession } from "@/store/session.ts";
import { DieButton, GhostDice } from "@/components/Die.tsx";
import { FarkleOverlay } from "@/components/FarkleOverlay.tsx";
import { WinnerScreen } from "@/components/WinnerScreen.tsx";
import { ScoreboardSheet } from "@/components/ScoreboardSheet.tsx";
import { playCue, haptic } from "@/lib/audio.ts";
import { shareSummary } from "@/lib/share.ts";
import { avatarColor } from "@/screens/SetupScreen.tsx";

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

export function GameScreen() {
  const navigate = useNavigate();
  const game = useSession((state) => state.game);
  const settings = useSession((state) => state.settings);
  const dispatch = useSession((state) => state.dispatch);
  const undo = useSession((state) => state.undo);
  const undoBank = useSession((state) => state.undoBank);
  const rematch = useSession((state) => state.rematch);
  const setSettings = useSession((state) => state.setSettings);
  const error = useSession((state) => state.error);
  const clearError = useSession((state) => state.clearError);

  const [use3D, setUse3D] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  const [motionReady, setMotionReady] = useState(false);

  const tableHostRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<DiceTable | null>(null);
  const rollBtnRef = useRef<HTMLButtonElement>(null);
  const bankBtnRef = useRef<HTMLButtonElement>(null);
  const selectRef = useRef<(index: number) => void>(() => {});
  const gameRef = useRef<DiceGameState | null>(game);
  const shakeRef = useRef<() => void>(() => {});
  const busyRef = useRef(false);

  gameRef.current = game;
  busyRef.current = busy;

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
      const kept = dispatch({ type: "keep" });
      if (!kept.ok) return;
      haptic(12);
      current = useSession.getState().game;
    }
    if (!current || current.phase !== "awaitingRoll") return;

    const count = diceLeft(current);
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
    if (!useSession.getState().game) return;
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
    const button = rollBtnRef.current;
    if (button && !button.disabled) {
      button.click();
      return;
    }
    if (current.phase === "awaitingKeep") {
      setToast("Shake won't roll — pick a scoring die first");
    }
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
        if (rollBtnRef.current && !rollBtnRef.current.disabled) rollBtnRef.current.click();
      } else if (event.key.toLowerCase() === "b") {
        if (bankBtnRef.current && !bankBtnRef.current.disabled) bankBtnRef.current.click();
      } else if (/^[1-6]$/.test(event.key) && current.phase === "awaitingKeep") {
        const index = Number(event.key) - 1;
        if (index < current.roll.length) selectRef.current(index);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [boardOpen]);

  /* ---------- derived ---------- */
  const derived = useMemo(() => {
    if (!game) return null;
    const player = currentPlayer(game);
    const picked = selectedFaces(game);
    const selection = game.roll.length ? scoreSelection(picked, game.config) : 0;
    const total = pendingTotal(game) ?? 0;
    return { player, picked, selection, total };
  }, [game]);

  if (!game || !derived) return <Navigate to="/" replace />;

  const { player, picked, selection, total } = derived;
  const currentIndex = game.turn;
  const others = game.players.map((value, index) => ({ value, index })).filter(({ index }) => index !== currentIndex);

  let rollLabel = "Roll";
  let rollDisabled = true;
  if (game.phase === "rolling" || busy) {
    rollLabel = "Rolling…";
  } else if (game.phase === "awaitingRoll") {
    const left = diceLeft(game);
    rollLabel = left === 0 ? "All six kept" : `Roll ${left} ${left === 1 ? "die" : "dice"}`;
    rollDisabled = left === 0;
  } else if (game.phase === "awaitingKeep") {
    if (selection === null || picked.length === 0) {
      rollLabel = selection === null ? "Not a scoring set" : "Select dice to keep";
      rollDisabled = true;
    } else {
      const remaining = 6 - game.kept.length - picked.length;
      rollLabel = remaining === 0 ? "Keep all six" : `Keep & roll ${remaining}`;
      rollDisabled = false;
    }
  }
  if (game.phase === "turnEnd" || game.phase === "gameOver") rollDisabled = true;

  let bankLabel = "Bank";
  let bankDisabled = true;
  if (game.phase === "awaitingKeep") {
    if (selection !== null && selection > 0) {
      bankLabel = `Bank ${fmt(total)}`;
      bankDisabled = false;
    } else {
      bankLabel = "Bank —";
    }
  } else if (game.phase === "awaitingRoll" && game.turnScore > 0) {
    bankLabel = `Bank ${fmt(game.turnScore)}`;
    bankDisabled = false;
  }
  if (game.phase === "turnEnd" || game.phase === "gameOver") bankDisabled = true;

  const left = diceLeft(game);
  const hint =
    game.phase === "rolling" || busy
      ? "Rolling…"
      : left === 0
        ? "All six dice are kept — bank to finish the turn."
        : game.turnScore > 0
          ? `Roll the ${left} ${left === 1 ? "die" : "dice"} left.`
          : "Press Roll to start the turn.";

  return (
    <section className="screen game-screen" aria-label="Game table">
      <header className="topbar">
        <span className="wordmark">Farkle</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="pill" onClick={() => navigate("/rules")}>
            Rules
          </button>
        </div>
      </header>

      {others.length ? (
        <div className="tabs" role="list" aria-label="Other players">
          {others.map(({ value, index }) => (
            <div className="tab" role="listitem" key={value.id}>
              <span className="tab-name">{value.name}</span>
              <span className="tab-score">{fmt(value.score)}</span>
              {value.streak > 0 ? <span className="sr-only">{value.streak} farkles in a row</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="turn-card-wrap">
        <div className="turn-card">
          <span className="avatar-lg" style={{ background: avatarColor(currentIndex) }} aria-hidden="true">
            {player.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="turn-block">
            <span className="turn-name">{player.name}</span>
            <span className="turn-meta">
              turn {player.turns + 1} · {fmt(player.score)} points
            </span>
          </div>
          <div className="farkles">
            <span className="farkles-label">FARKLES</span>
            <span className="dots" aria-hidden="true">
              {[0, 1, 2].map((index) => (
                <span key={index} className={`dot ${index < player.streak ? "on" : ""}`} />
              ))}
            </span>
          </div>
        </div>
      </div>

      <div className="tray">
        <div className="dice-table" ref={tableHostRef} />
        {!use3D &&
          (game.phase === "awaitingKeep" && game.roll.length ? (
            <div className="dice-grid" role="group" aria-label="Dice on the table">
              {game.roll.map((face: Face, index: number) => (
                <DieButton
                  key={`${index}-${face}`}
                  face={face}
                  index={index}
                  selected={game.selected[index] ?? false}
                  onToggle={toggle}
                />
              ))}
            </div>
          ) : (
            <GhostDice count={game.kept.length >= 6 ? 6 : 6 - game.kept.length} />
          ))}
        {use3D && game.phase === "awaitingRoll" ? (
          <GhostDice count={game.kept.length >= 6 ? 6 : 6 - game.kept.length} />
        ) : null}
        {use3D && game.phase !== "awaitingKeep" ? <p className="tray-hint">{hint}</p> : null}
        {!use3D && game.phase !== "awaitingKeep" ? <p className="tray-hint">{hint}</p> : null}

        {use3D && game.phase === "awaitingKeep" ? (
          <div className="sr-only" role="group" aria-label="Dice on the table">
            {game.roll.map((face, index) => (
              <button
                key={`sr-${index}-${face}`}
                type="button"
                aria-pressed={game.selected[index] ?? false}
                aria-label={`Die ${index + 1}, value ${face}${game.selected[index] ? ", kept" : ""}`}
                onClick={() => toggle(index)}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="readout">
        <div className="readout-group">
          <span className="readout-label">SELECTED</span>
          <span className={`readout-value ${selection !== null && selection > 0 ? "accent" : ""}`}>
            {selection === null ? "—" : fmt(selection)}
          </span>
        </div>
        <div className="readout-group">
          <span className="readout-label">ON THE TABLE</span>
          <span className="readout-value">{fmt(game.turnScore)}</span>
        </div>
        <div className="readout-group">
          <span className="readout-label">FARKLES</span>
          <span className="readout-value soft">{player.streak} / 3</span>
        </div>
      </div>

      <div className="actions">
        <button
          ref={rollBtnRef}
          type="button"
          className="btn-action primary"
          onClick={() => void rollNow()}
          disabled={rollDisabled}
        >
          {rollLabel}
        </button>
        <button
          ref={bankBtnRef}
          type="button"
          className="btn-action secondary"
          onClick={bank}
          disabled={bankDisabled}
        >
          {bankLabel}
        </button>
      </div>

      <div className="game-foot">
        {motionReady ? (
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
        )}
        <span className="foot-note">
          {game.config.target.toLocaleString("en-US")} to win
          {game.suddenDeath ? " · sudden death" : ""}
        </span>
      </div>

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

      <p className="sr-only" aria-live="polite">
        {game.lastEvent?.text ?? ""}
      </p>

      {game.phase === "turnEnd" ? (
        <FarkleOverlay game={game} onNext={() => dispatch({ type: "nextTurn" })} />
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
    </section>
  );
}
