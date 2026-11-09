import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { normalizeRoomCode } from "@farkle/protocol";
import { useOnline } from "@/store/online.ts";
import {
  onlineConfigured,
  savedOnlineName,
  savedToken,
} from "@/lib/online.ts";
import { OnlineLobbyScreen } from "@/screens/OnlineLobbyScreen.tsx";
import { OnlineGameScreen } from "@/screens/OnlineGameScreen.tsx";

export function JoinRoomScreen() {
  const navigate = useNavigate();
  const { code: rawCode } = useParams<{ code: string }>();
  const code = normalizeRoomCode(rawCode ?? "");

  const room = useOnline((state) => state.room);
  const status = useOnline((state) => state.status);
  const error = useOnline((state) => state.error);
  const playerId = useOnline((state) => state.playerId);
  const joinRoom = useOnline((state) => state.joinRoom);
  const clearError = useOnline((state) => state.clearError);

  const [name, setName] = useState(savedOnlineName());
  const [notice, setNotice] = useState<string | null>(null);
  const attempted = useRef(false);
  const configured = onlineConfigured();

  // A stored token means this browser already holds a seat: rejoin silently.
  useEffect(() => {
    if (attempted.current || !code) return;
    attempted.current = true;
    if (room?.code === code) return;
    if (status === "connecting" || status === "reconnecting") return;
    if (savedToken(code)) joinRoom(code);
  }, [code, room?.code, status, joinRoom]);

  function onJoin(event: FormEvent) {
    event.preventDefault();
    if (!code) return;
    if (!name.trim()) {
      setNotice("Enter a name first.");
      return;
    }
    clearError();
    setNotice(null);
    joinRoom(code, name);
  }

  if (!code) {
    return (
      <section className="screen join-screen">
        <header className="topbar">
          <span className="wordmark">Farkle</span>
        </header>
        <div className="join-card">
          <span className="kicker">INVITE LINK</span>
          <h1>That code isn&apos;t valid.</h1>
          <p className="hint">Room codes are four letters or digits, like 5T1S.</p>
          <Link className="btn-primary join-home" to="/online">
            Start or join a room
          </Link>
        </div>
      </section>
    );
  }

  if (room && room.code === code && playerId) {
    return room.phase === "lobby" ? (
      <OnlineLobbyScreen room={room} playerId={playerId} />
    ) : (
      <OnlineGameScreen room={room} playerId={playerId} />
    );
  }

  const busy = status === "connecting" || status === "reconnecting";
  const hasSeat = Boolean(savedToken(code));

  return (
    <section className="screen join-screen" aria-labelledby="join-title">
      <header className="topbar">
        <span className="wordmark">Farkle</span>
        <button type="button" className="pill" onClick={() => navigate("/")}>
          Home
        </button>
      </header>

      <div className="join-card">
        <span className="kicker">YOU&apos;RE INVITED</span>
        <h1 id="join-title">
          Join room <span className="join-code">{code}</span>
        </h1>

        {!configured ? (
          <p className="notice-card" role="alert">
            Online play needs a room server. This build has no server address configured.
          </p>
        ) : null}

        {busy ? (
          <p className="join-status" role="status">
            Joining room {code}…
          </p>
        ) : (
          <form className="online-form" onSubmit={onJoin}>
            <label className="field-label" htmlFor="join-name">
              YOUR NAME
            </label>
            <input
              id="join-name"
              className="text-input"
              value={name}
              onChange={(event) => {
                setName(event.target.value.slice(0, 18));
                setNotice(null);
              }}
              placeholder="e.g. Mathieu"
              autoComplete="nickname"
              maxLength={18}
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={!configured || !name.trim()}
            >
              {hasSeat ? "Rejoin table" : "Join room"}
            </button>
          </form>
        )}

        {notice || error ? (
          <p className="hint online-error" role="alert">
            {notice ?? error}
          </p>
        ) : null}

        <p className="hint">
          Rooms are temporary. If everyone leaves, the code is gone for good.
        </p>
      </div>
    </section>
  );
}
