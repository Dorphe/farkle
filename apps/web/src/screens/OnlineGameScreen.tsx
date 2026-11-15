import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { DiceTable } from "@farkle/dice";
import type { RoomView } from "@farkle/protocol";
import { isMyTurn, useOnline } from "@/store/online.ts";
import { useSession } from "@/store/session.ts";
import { currentPlayer, pendingTotal, scoreSelection, selectedFaces } from "@farkle/engine";
import { GameTable, tableFootNote } from "@/components/GameTable.tsx";
import { WinnerScreen } from "@/components/WinnerScreen.tsx";
import { ScoreboardSheet } from "@/components/ScoreboardSheet.tsx";
import { GameMenu } from "@/components/GameMenu.tsx";
import { playCue, haptic } from "@/lib/audio.ts";
import { shareInvite, inviteLink } from "@/lib/online.ts";
import { shareSummary } from "@/lib/share.ts";

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

  if (!game) {
    return (
      <section className="screen join-screen">
        <div className="join-card">
          <h1>The table is loading…</h1>
          <p className="hint">Waiting for the first roll.</p>
        </div>
      </section>
    );
  }

  const player = current ? currentPlayer(game) : null;

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
      const picked = selectedFaces(game);
      const selection = game.roll.length ? scoreSelection(picked, game.config) : 0;
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

  return (
    <GameTable
      game={game}
      interactive={mine}
      waitingFor={player?.name}
      busy={busy || tossing}
      use3D={use3D}
      tableHost={tableHostRef}
      hideGhosts={tossing}
      className="online-game"
      label="Online game table"
      onToggle={toggle}
      onRoll={rollNow}
      onBank={bank}
      onNextTurn={mine ? () => dispatchAction({ type: "nextTurn" }) : undefined}
      onMenu={() => setMenuOpen(true)}
      topbarExtra={
        <button type="button" className="pill room-pill" onClick={() => void invite()}>
          {room.code}
        </button>
      }
      banner={
        status === "reconnecting" ? (
          <p className="reconnect-banner" role="status">
            Reconnecting…
          </p>
        ) : null
      }
      isOffline={(index) => !room.seats[index]?.connected}
      footNote={tableFootNote(game)}
    >
      {toast ? (
        <div className="toast" role="status">
          {toast}
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
        <GameMenu
          mode="online"
          subtitle={`Room ${room.code} · with friends`}
          onClose={() => setMenuOpen(false)}
          onRules={() => {
            setMenuOpen(false);
            navigate("/rules");
          }}
          onInvite={() => {
            setMenuOpen(false);
            void invite();
          }}
          onLeave={() => {
            setMenuOpen(false);
            onLeave();
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