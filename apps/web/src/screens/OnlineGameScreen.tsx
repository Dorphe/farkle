import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  currentPlayer,
  diceLeft,
  pendingTotal,
  scoreSelection,
  selectedFaces,
  type Face,
} from "@farkle/engine";
import type { DiceTable } from "@farkle/dice";
import type { RoomView } from "@farkle/protocol";
import { isMyTurn, useOnline } from "@/store/online.ts";
import { useSession } from "@/store/session.ts";
import { DieButton, GhostDice, MiniDie } from "@/components/Die.tsx";
import { WinnerScreen } from "@/components/WinnerScreen.tsx";
import { ScoreboardSheet } from "@/components/ScoreboardSheet.tsx";
import { playCue, haptic } from "@/lib/audio.ts";
import { shareInvite, inviteLink } from "@/lib/online.ts";
import { shareSummary } from "@/lib/share.ts";
import { avatarColor } from "@/screens/SetupScreen.tsx";

const fmt = (value: number) => value.toLocaleString("en-US");

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
  } catch {
    return false;
  }
}

export function OnlineGameScreen({ room, playerId }: { room: RoomView; playerId: string }) {
  const navigate = useNavigate();
  const dispatchAction = useOnline((state) => state.dispatchAction);
  const rematch = useOnline((state) => state.rematch);
  const leave = useOnline((state) => state.leave);
  const status = useOnline((state) => state.status);
  const error = useOnline((state) => state.error);
  const clearError = useOnline((state) => state.clearError);

  const settings = useSession((state) => state.settings);

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [use3D, setUse3D] = useState(false);
  const [tossing, setTossing] = useState(false);
  const tableHostRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<DiceTable | null>(null);
  const selectRef = useRef<(index: number) => void>(() => {});
  const tossingRef = useRef(false);
  const expectRollRef = useRef(false);

  const game = room.game;
  const currentIndex = game?.turn ?? 0;
  const current = game ? currentPlayer(game) : null;
  const mine = Boolean(game && room.phase === "playing" && room.seats[currentIndex]?.id === playerId);
  const host = room.seats.find((seat) => seat.id === room.hostId) ?? null;
  const isHost = room.hostId === playerId;

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

  // The room server owns the values, so the table only animates them: a fresh
  // roll is thrown so the dice land on those faces, everything else (resume,
  // reconnect, selection) is drawn where it already is.
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    // `turnEnd` is a farkle: the dice that busted still land on the table.
    const revealing = game?.phase === "awaitingKeep" || game?.phase === "turnEnd";

    if (!game || !revealing || !game.roll.length) {
      if (game?.phase === "awaitingRoll") expectRollRef.current = true;
      table.setInteractive(false);
      if (!tossingRef.current) table.clear();
      return;
    }

    if (expectRollRef.current) {
      expectRollRef.current = false;
      const values = game.roll;
      tossingRef.current = true;
      setTossing(true);
      table.setInteractive(false);
      void table.toss(values).then(() => {
        tossingRef.current = false;
        setTossing(false);
        setBusy(false);
        const latest = useOnline.getState().room?.game;
        const live = tableRef.current;
        if (!live) return;
        if (latest?.roll.length) live.show(latest.roll, latest.selected);
        live.setInteractive(
          Boolean(latest?.phase === "awaitingKeep" && isMyTurn(useOnline.getState().room, playerId)),
        );
      });
      return;
    }

    table.show(game.roll, game.selected);
    table.setInteractive(Boolean(mine && game.phase === "awaitingKeep"));
  }, [game, mine, use3D, playerId]);

  useEffect(() => {
    if (tossingRef.current) return;
    setBusy(false);
  }, [game?.roll, game?.phase, game?.turn]);

  useEffect(() => {
    const event = game?.lastEvent;
    if (!event) return;
    if (event.kind === "roll") playCue("roll");
    else if (event.kind === "farkle" || event.kind === "penalty") {
      playCue("farkle");
      haptic([30, 40, 30]);
    } else if (event.kind === "bank") playCue("bank");
    else if (event.kind === "win") {
      playCue("win");
      haptic([20, 60, 20, 60]);
    }
  }, [game?.lastEvent]);

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

  const derived = useMemo(() => {
    if (!game) return null;
    const player = currentPlayer(game);
    const picked = selectedFaces(game);
    const selection = game.roll.length ? scoreSelection(picked, game.config) : 0;
    const total = pendingTotal(game) ?? 0;
    return { player, picked, selection, total };
  }, [game]);

  if (!game || !derived) {
    return (
      <section className="screen join-screen">
        <div className="join-card">
          <h1>The table is loading…</h1>
          <p className="hint">Waiting for the first roll.</p>
        </div>
      </section>
    );
  }

  const { player, picked, selection, total } = derived;

  function toggle(index: number) {
    if (!mine || game?.phase !== "awaitingKeep") return;
    dispatchAction({ type: "toggle", index });
    playCue("keep");
    haptic(8);
  }
  selectRef.current = toggle;

  function rollNow() {
    if (!mine || busy || !game) return;
    if (game.phase === "awaitingKeep") {
      if (selection === null || picked.length === 0) return;
      dispatchAction({ type: "keep" });
      const remaining = 6 - game.kept.length - picked.length;
      if (remaining === 0) {
        setBusy(true);
        return;
      }
    }

    // The throw itself starts when the server's roll comes back, so the dice
    // land on the values the room agrees on.
    dispatchAction({ type: "roll" });
    setBusy(true);
    window.setTimeout(() => setBusy(false), 4000);
  }

  function bank() {
    if (!mine) return;
    dispatchAction({ type: "bank" });
  }

  async function invite() {
    const outcome = await shareInvite(room.code);
    if (outcome === "copied") setToast("Invite link copied.");
    else if (outcome === "failed") setToast(`Invite: ${inviteLink(room.code)}`);
  }

  async function shareGame() {
    const current = game;
    if (!current) return;
    const winner =
      current.players.find((value) => value.id === current.winnerId) ??
      current.players.slice().sort((a, b) => b.score - a.score)[0];
    if (!winner) return;
    const outcome = await shareSummary({
      winner: winner.name,
      winnerScore: winner.score,
      target: current.config.target,
      players: current.players.map((value) => ({ name: value.name, score: value.score })),
    });
    if (outcome === "copied") setToast("Scorecard copied to the clipboard.");
    else if (outcome === "failed") setToast("Couldn't share from this browser.");
  }

  function onLeave() {
    if (
      !window.confirm(
        "Leave the table? Your seat is held while the game is live — reopen the invite link to come back.",
      )
    ) {
      return;
    }
    leave();
    navigate("/online");
  }

  let rollLabel = "Roll";
  let rollDisabled = true;
  if (!mine) {
    rollLabel = `Waiting for ${player.name}`;
  } else if (busy) {
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
  if (!mine || game.phase === "turnEnd" || game.phase === "gameOver") bankDisabled = true;

  const left = diceLeft(game);
  const hint = tossing
    ? "Rolling…"
    : mine
      ? game.phase === "awaitingRoll"
        ? game.turnScore > 0
          ? `Roll the ${left} ${left === 1 ? "die" : "dice"} left.`
          : "Press Roll to start your turn."
        : left === 0
          ? "All six dice are kept — bank to finish the turn."
          : "Tap scoring dice to keep them."
      : `${player.name} is taking their turn.`;

  const others = game.players
    .map((value, index) => ({ value, index }))
    .filter(({ index }) => index !== currentIndex);

  return (
    <section className="screen game-screen online-game" aria-label="Online game table">
      <header className="topbar">
        <span className="wordmark">Farkle</span>
        <div className="online-head-actions">
          <button type="button" className="pill room-pill" onClick={() => void invite()}>
            {room.code}
          </button>
          <button type="button" className="pill" onClick={() => setMenuOpen(true)}>
            Menu
          </button>
        </div>
      </header>

      {status === "reconnecting" ? (
        <p className="reconnect-banner" role="status">
          Reconnecting…
        </p>
      ) : null}

      {others.length ? (
        <div className="tabs" role="list" aria-label="Other players">
          {others.map(({ value, index }) => {
            const seat = room.seats[index];
            return (
              <div className="tab" role="listitem" key={value.id}>
                <span className="tab-name">
                  {value.name}
                  {seat && !seat.connected ? " · offline" : ""}
                </span>
                <span className="tab-score">{fmt(value.score)}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="turn-card-wrap">
        <div className={`turn-card ${mine ? "is-mine" : ""}`}>
          <span className="avatar-lg" style={{ background: avatarColor(currentIndex) }} aria-hidden="true">
            {player.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="turn-block">
            <span className="turn-name">{player.name}</span>
            <span className="turn-kicker">{mine ? "YOUR TURN" : "THEIR TURN"}</span>
          </div>
          <span className="turn-score">{fmt(player.score)}</span>
        </div>
      </div>

      <div className="tray">
        <div className="dice-table" ref={tableHostRef} />
        {!use3D &&
          (game.phase === "awaitingKeep" && game.roll.length ? (
            <div className="dice-grid" role="group" aria-label="Dice on the table">
              {game.roll.map((face: Face, index: number) => (
                <DieButton
                  key={`${index}-${face}-${game.selected[index] ? 1 : 0}`}
                  face={face}
                  index={index}
                  selected={game.selected[index] ?? false}
                  onToggle={toggle}
                  disabled={!mine}
                />
              ))}
            </div>
          ) : (
            <GhostDice count={game.kept.length >= 6 ? 6 : 6 - game.kept.length} />
          ))}
        {use3D && !tossing && game.phase !== "awaitingKeep" ? (
          <GhostDice count={game.kept.length >= 6 ? 6 : 6 - game.kept.length} />
        ) : null}
        <p className="tray-hint">{hint}</p>
        {use3D && game.phase === "awaitingKeep" && game.roll.length ? (
          <div className="sr-only" role="group" aria-label="Dice on the table">
            {game.roll.map((face, index) => (
              <button
                key={`sr-${index}-${face}`}
                type="button"
                aria-pressed={game.selected[index] ?? false}
                aria-label={`Die ${index + 1}, value ${face}${game.selected[index] ? ", kept" : ""}`}
                onClick={() => toggle(index)}
                disabled={!mine}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className={`readout ${tossing ? "is-waiting" : ""}`}>
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
          type="button"
          className="btn-action primary"
          onClick={rollNow}
          disabled={rollDisabled || !mine}
        >
          {rollLabel}
        </button>
        <button
          type="button"
          className="btn-action secondary"
          onClick={bank}
          disabled={bankDisabled}
        >
          {bankLabel}
        </button>
      </div>

      <div className="game-foot">
        <span className="foot-note">
          Room {room.code} · {game.config.target.toLocaleString("en-US")} to win
          {game.suddenDeath ? " · sudden death" : ""}
        </span>
      </div>

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {game.lastEvent?.text ?? ""}
      </p>

      {game.phase === "turnEnd" ? (
        <div className="overlay night" role="dialog" aria-modal="true" aria-label="Turn over">
          <div className="overlay-inner">
            <span className="kicker">TURN OVER</span>
            <div className="bust-dice" aria-hidden="true">
              {game.roll.map((face, index) => (
                <MiniDie key={index} face={face} />
              ))}
            </div>
            <span className="farkle-word">Farkle</span>
            <p className="farkle-sub">{game.lastEvent?.text ?? "No scoring dice — the turn is over."}</p>
            {mine ? null : (
              <p className="farkle-sub">Waiting for {player.name} to continue…</p>
            )}
          </div>
          {mine ? (
            <button
              type="button"
              className="btn-primary"
              autoFocus
              onClick={() => dispatchAction({ type: "nextTurn" })}
            >
              Next player
            </button>
          ) : null}
        </div>
      ) : null}

      {game.phase === "gameOver" ? (
        <WinnerScreen
          game={game}
          canRematch={isHost}
          rematchHint={`Waiting for ${host?.name ?? "the host"} to start a rematch…`}
          onRematch={rematch}
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
        <div
          className="sheet-backdrop"
          onClick={(event) => event.target === event.currentTarget && setMenuOpen(false)}
        >
          <div className="sheet menu-sheet" role="dialog" aria-modal="true" aria-label="Table menu">
            <div className="sheet-head">
              <div>
                <h2>Menu</h2>
                <p className="sheet-sub">Room {room.code} · with friends</p>
              </div>
              <button
                type="button"
                className="sheet-close"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
              >
                ×
              </button>
            </div>
            <div className="menu-card">
              <button type="button" className="menu-row" onClick={() => void invite()}>
                <b>Invite a player</b>
                <span>Share the /join/{room.code} link</span>
              </button>
              <button
                type="button"
                className="menu-row"
                onClick={() => {
                  setMenuOpen(false);
                  navigate("/history");
                }}
              >
                <b>History</b>
                <span>Recaps of finished games on this device</span>
              </button>
              <button
                type="button"
                className="menu-row"
                onClick={() => {
                  setMenuOpen(false);
                  navigate("/settings");
                }}
              >
                <b>Settings</b>
                <span>Sound, motion, dice, privacy</span>
              </button>
              <button type="button" className="menu-row danger" onClick={onLeave}>
                <b>Leave table</b>
                <span>Your seat is held — reopen the link to rejoin</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
