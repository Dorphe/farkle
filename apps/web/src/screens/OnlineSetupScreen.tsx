import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { detectPreset } from "@farkle/engine";
import { useSession } from "@/store/session.ts";
import { useOnline } from "@/store/online.ts";
import { cleanCodeInput, onlineConfigured, savedOnlineName } from "@/lib/online.ts";
import { RulesSheet } from "@/components/RulesSheet.tsx";
import { PRESET_LABELS } from "@/screens/SetupScreen.tsx";

export function OnlineSetupScreen() {
  const navigate = useNavigate();
  const draftConfig = useSession((state) => state.draftConfig);
  const setDraftConfig = useSession((state) => state.setDraftConfig);
  const createRoom = useOnline((state) => state.createRoom);
  const joinRoom = useOnline((state) => state.joinRoom);
  const room = useOnline((state) => state.room);
  const status = useOnline((state) => state.status);
  const error = useOnline((state) => state.error);
  const clearError = useOnline((state) => state.clearError);

  const [name, setName] = useState(savedOnlineName());
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  const configured = onlineConfigured();
  const presetName = detectPreset(draftConfig);

  useEffect(() => {
    if (room && status === "joined") {
      navigate(`/join/${room.code}`, { replace: true });
    }
  }, [room, status, navigate]);

  useEffect(() => {
    if (creating && status === "error") setCreating(false);
  }, [creating, status]);

  function validateName(): boolean {
    if (!name.trim()) {
      setNotice("Enter a name first.");
      return false;
    }
    return true;
  }

  function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!validateName()) return;
    clearError();
    setNotice(null);
    setCreating(true);
    createRoom(name, draftConfig);
  }

  function onJoin(event: FormEvent) {
    event.preventDefault();
    if (!validateName()) return;
    if (code.length !== 4) {
      setNotice("Room codes are four letters or digits.");
      return;
    }
    clearError();
    setNotice(null);
    joinRoom(code, name);
    navigate(`/join/${code}`);
  }

  return (
    <section className="screen setup-screen" aria-label="Play with friends">
      <header className="topbar">
        <span className="wordmark">Farkle</span>
        <button type="button" className="pill" onClick={() => navigate("/rules")}>
          Rules
        </button>
      </header>

      <div className="mode-switch" role="group" aria-label="Game mode">
        <button type="button" aria-pressed="false" onClick={() => navigate("/")}>
          Play dice
        </button>
        <button type="button" aria-pressed="false" onClick={() => navigate("/score/setup")}>
          Keep score
        </button>
        <button type="button" aria-pressed="true">
          With friends
        </button>
      </div>

      <div className="setup-scroll">
        {!configured ? (
          <p className="notice-card" role="alert">
            Online play needs a room server. This build has no server address configured.
          </p>
        ) : null}

        <form className="online-form" onSubmit={onCreate}>
          <label className="field-label" htmlFor="online-name">
            YOUR NAME
          </label>
          <input
            id="online-name"
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
            className="btn-primary online-create"
            disabled={!configured || creating || !name.trim()}
          >
            {creating ? "Opening a room…" : "Create a room"}
          </button>
        </form>

        <div className="or-rule" role="separator">
          <span>OR JOIN WITH A CODE</span>
        </div>

        <form className="online-form join-form" onSubmit={onJoin}>
          <label className="field-label" htmlFor="online-code">
            ROOM CODE
          </label>
          <input
            id="online-code"
            className="text-input code-entry"
            value={code}
            onChange={(event) => {
              setCode(cleanCodeInput(event.target.value));
              setNotice(null);
              clearError();
            }}
            placeholder="5T1S"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={4}
          />
          <button
            type="submit"
            className="btn-secondary"
            disabled={!configured || code.length !== 4 || status === "connecting" || !name.trim()}
          >
            {status === "connecting" ? "Joining…" : "Join room"}
          </button>
        </form>

        {notice || error ? (
          <p className="hint online-error" role="alert">
            {notice ?? error}
          </p>
        ) : null}

        <button type="button" className="rule-summary" onClick={() => setRulesOpen(true)}>
          <span>
            <span className="rule-summary-label">HOUSE RULES</span>
            <span className="rule-summary-value">
              {PRESET_LABELS[presetName]} · {draftConfig.target.toLocaleString("en-US")} to win
            </span>
          </span>
          <span className="rule-summary-change">Change</span>
        </button>

        <p className="hint online-note">
          The host picks the rules. Codes work once while the room is alive, then expire.
        </p>
      </div>

      <div className="setup-tail">
        <div className="setup-links">
          <button type="button" className="setup-link" onClick={() => navigate("/history")}>
            History
          </button>
          <button type="button" className="setup-link" onClick={() => navigate("/settings")}>
            Settings
          </button>
        </div>
      </div>

      {rulesOpen ? (
        <RulesSheet
          config={draftConfig}
          onChange={setDraftConfig}
          onClose={() => setRulesOpen(false)}
        />
      ) : null}
    </section>
  );
}
