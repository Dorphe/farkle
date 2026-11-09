import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useSession } from "@/store/session.ts";
import { SetupScreen } from "@/screens/SetupScreen.tsx";
import { GameScreen } from "@/screens/GameScreen.tsx";
import { RulesScreen } from "@/screens/RulesScreen.tsx";
import { SettingsScreen } from "@/screens/SettingsScreen.tsx";
import { HistoryScreen } from "@/screens/HistoryScreen.tsx";
import { UpdatePrompt } from "@/components/UpdatePrompt.tsx";

export default function App() {
  const ready = useSession((state) => state.ready);
  const hydrate = useSession((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!ready) {
    return (
      <div className="app-frame">
        <div
          className="screen"
          style={{ alignItems: "center", justifyContent: "center", gap: 8 }}
          aria-busy="true"
        >
          <span className="wordmark">Farkle</span>
          <span className="hint">Loading the table…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="app-frame">
      <UpdatePrompt />
      <Routes>
        <Route path="/" element={<SetupScreen />} />
        <Route path="/local/game" element={<GameScreen />} />
        <Route path="/rules" element={<RulesScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/history" element={<HistoryScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
