import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { detectPreset } from "@farkle/engine";
import type { RoomView } from "@farkle/protocol";
import { useOnline } from "@/store/online.ts";
import { inviteLink, shareInvite } from "@/lib/online.ts";
import { avatarColor, PRESET_LABELS } from "@/screens/SetupScreen.tsx";

export function OnlineLobbyScreen({ room, playerId }: { room: RoomView; playerId: string }) {
  const navigate = useNavigate();
  const setReady = useOnline((state) => state.setReady);
  const startGame = useOnline((state) => state.startGame);
  const leave = useOnline((state) => state.leave);
  const status = useOnline((state) => state.status);
  const error = useOnline((state) => state.error);
  const clearError = useOnline((state) => state.clearError);

  const [toast, setToast] = useState<string | null>(null);

  const me = room.seats.find((seat) => seat.id === playerId) ?? null;
  const host = room.seats.find((seat) => seat.id === room.hostId) ?? null;
  const isHost = room.hostId === playerId;
  const connected = room.seats.filter((seat) => seat.connected);
  const allReady = connected.length >= 2 && connected.every((seat) => seat.ready);
  const presetName = detectPreset(room.config);

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
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!me) {
    return (
      <section className="screen join-screen">
        <div className="join-card">
          <h1>You left this room.</h1>
          <p className="hint">The seat was released when the connection closed.</p>
          <button type="button" className="btn-primary" onClick={() => navigate("/online")}>
            Find another room
          </button>
        </div>
      </section>
    );
  }

  async function invite() {
    const outcome = await shareInvite(room.code);
    if (outcome === "copied") setToast("Invite link copied.");
    else if (outcome === "failed") setToast(`Invite: ${inviteLink(room.code)}`);
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(inviteLink(room.code));
      setToast("Invite link copied.");
    } catch {
      setToast(`Room code ${room.code}`);
    }
  }

  function onLeave() {
    if (!window.confirm("Leave the room? Your seat is released.")) return;
    leave();
    navigate("/online");
  }

  return (
    <section className="screen online-lobby" aria-labelledby="lobby-title">
      <header className="topbar">
        <span className="wordmark">Farkle</span>
        <div className="online-head-actions">
          <button type="button" className="pill" onClick={() => void invite()}>
            Invite
          </button>
          <button type="button" className="pill" onClick={onLeave}>
            Leave
          </button>
        </div>
      </header>

      {status === "reconnecting" ? (
        <p className="reconnect-banner" role="status">
          Reconnecting to room {room.code}…
        </p>
      ) : null}

      <div className="setup-scroll">
        <div className="hero">
          <h1 id="lobby-title">
            The table is
            <span>open.</span>
          </h1>
        </div>

        <div className="room-card">
          <span className="room-kicker">ROOM CODE</span>
          <button type="button" className="room-code" onClick={() => void copyCode()}>
            {room.code.split("").map((letter, index) => (
              <span key={`${letter}-${index}`}>{letter}</span>
            ))}
          </button>
          <p className="hint">Tap the code to copy the link. Anyone with it can join.</p>
          <button type="button" className="btn-secondary room-share" onClick={() => void invite()}>
            Share invite link
          </button>
        </div>

        <div className="roster-card online-roster">
          <div className="roster-head">
            <h2 className="roster-heading">PLAYERS</h2>
            <span className="roster-count">
              {room.seats.length} of {room.maxPlayers}
            </span>
          </div>
          {room.seats.map((seat, index) => (
            <div className={`player-row online-player ${seat.connected ? "" : "offline"}`} key={seat.id}>
              <span className="avatar" style={{ background: avatarColor(index) }} aria-hidden="true">
                {seat.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="player-name">
                {seat.name}
                {seat.id === playerId ? <span className="you-tag">YOU</span> : null}
              </span>
              {seat.host ? <span className="host-tag">HOST</span> : null}
              <span className={`ready-tag ${seat.ready ? "on" : ""}`}>
                {!seat.connected ? "Offline" : seat.ready ? "Ready" : "Not ready"}
              </span>
            </div>
          ))}
          {host && !host.connected ? <p className="hint">The host left — the badge passes on.</p> : null}
        </div>

        <div className="rule-summary as-card">
          <span>
            <span className="rule-summary-label">HOUSE RULES</span>
            <span className="rule-summary-value">
              {PRESET_LABELS[presetName]} · {room.config.target.toLocaleString("en-US")} to win
            </span>
          </span>
          <span className="rule-summary-change">Set by host</span>
        </div>

        <p className="hint online-note">
          Rooms are temporary — no accounts, no history. They expire shortly after everyone leaves.
        </p>
      </div>

      <div className="setup-tail lobby-tail">
        <p className="hint">
          {connected.length < 2
            ? "Waiting for at least one more player."
            : allReady
              ? isHost
                ? "Everyone is ready."
                : `Waiting for ${host?.name ?? "the host"} to start.`
              : "Everyone needs to tap Ready."}
        </p>
        <button
          type="button"
          className={me.ready ? "btn-secondary" : "btn-primary"}
          aria-pressed={me.ready}
          onClick={() => setReady(!me.ready)}
        >
          {me.ready ? "I'm ready ✓" : "Tap when ready"}
        </button>
        {isHost ? (
          <button type="button" className="btn-primary" onClick={startGame} disabled={!allReady}>
            Start game
          </button>
        ) : null}
      </div>

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </section>
  );
}
