import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deriveScorepad, type GameRecord } from "@farkle/engine";
import { listRecords } from "@/lib/db.ts";
import { shareSummary, type ShareSummary } from "@/lib/share.ts";

const fmt = (value: number) => value.toLocaleString("en-US");
const dateLabel = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

interface RecordView {
  winnerName: string;
  winnerScore: number;
  winnerId: string | null;
  players: { id: string; name: string; score: number }[];
  modeLabel: string;
  target: number;
}

function viewOf(record: GameRecord): RecordView {
  if (record.mode === "score") {
    const derived = deriveScorepad(record.state);
    const players = record.state.players
      .map((player) => ({ ...player, score: derived.totals[player.id] ?? 0 }))
      .sort((a, b) => b.score - a.score);
    const winnerId = derived.winnerId ?? players[0]?.id ?? null;
    const winner = players.find((player) => player.id === winnerId) ?? players[0];
    return {
      winnerName: winner?.name ?? "Game",
      winnerScore: winner?.score ?? 0,
      winnerId,
      players,
      modeLabel: "Scorepad",
      target: record.config.target,
    };
  }

  const players = record.state.players
    .map((player) => ({ id: player.id, name: player.name, score: player.score }))
    .sort((a, b) => b.score - a.score);
  const winnerId = record.state.winnerId ?? players[0]?.id ?? null;
  const winner = players.find((player) => player.id === winnerId) ?? players[0];
  return {
    winnerName: winner?.name ?? "Game",
    winnerScore: winner?.score ?? 0,
    winnerId,
    players,
    modeLabel: "Dice",
    target: record.config.target,
  };
}

function summaryOf(record: GameRecord, view: RecordView): ShareSummary {
  return {
    winner: view.winnerName,
    winnerScore: view.winnerScore,
    target: record.config.target,
    players: view.players.map((player) => ({ name: player.name, score: player.score })),
    date: record.updatedAt,
  };
}

export function HistoryScreen() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<GameRecord[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listRecords(100)
      .then((rows) => {
        if (!cancelled) setRecords(rows.filter((row) => row.status === "finished"));
      })
      .catch(() => {
        if (!cancelled) setRecords([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const open = useMemo(
    () => (openId ? records?.find((record) => record.id === openId) ?? null : null),
    [openId, records],
  );
  const recap = open ? viewOf(open) : null;

  async function share() {
    if (!open || !recap) return;
    const outcome = await shareSummary(summaryOf(open, recap));
    if (outcome === "copied") setNotice("Scorecard copied to the clipboard.");
    else if (outcome === "failed") setNotice("Couldn't share from this browser.");
    else if (outcome === "shared") setNotice("Shared.");
  }

  return (
    <section className="screen history-screen" aria-labelledby="history-title">
      <header className="topbar">
        <span className="wordmark">Farkle</span>
        <button type="button" className="pill" onClick={() => navigate("/", { replace: true })}>
          Back
        </button>
      </header>

      <div className="subpage-title">
        <h1 id="history-title">History</h1>
        <p className="subpage-lede">Finished games on this device. Tap one for the recap.</p>
      </div>

      {records === null ? (
        <p className="subpage-lede" role="status">
          Loading…
        </p>
      ) : records.length === 0 ? (
        <div className="history-list">
          <p className="empty-state">No finished games yet. Play one to the target and it will appear here.</p>
        </div>
      ) : (
        <div className="history-list">
          {records.map((record) => {
            const view = viewOf(record);
            return (
              <button
                key={record.id}
                type="button"
                className="history-card"
                onClick={() => {
                  setNotice(null);
                  setOpenId(record.id);
                }}
              >
                <span className="history-top">
                  <span className="history-winner">{view.winnerName}</span>
                  <span className="history-score">{fmt(view.winnerScore)}</span>
                </span>
                <span className="history-meta">
                  {dateLabel(record.updatedAt)} · {view.modeLabel} · {view.players.length} players · first to{" "}
                  {fmt(record.config.target)}
                </span>
                <span className="history-players">
                  {view.players.map((player) => `${player.name} ${fmt(player.score)}`).join(" · ")}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {notice ? (
        <p className="settings-footnote" role="status">
          {notice}
        </p>
      ) : null}

      {open && recap ? (
        <div
          className="sheet-backdrop"
          onClick={(event) => event.target === event.currentTarget && setOpenId(null)}
        >
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Game recap">
            <div className="sheet-head">
              <div>
                <h2>{recap.winnerName}</h2>
                <p className="sheet-sub">
                  {dateLabel(open.updatedAt)} · {recap.modeLabel} · first to {fmt(open.config.target)}
                </p>
              </div>
              <button type="button" className="sheet-close" onClick={() => setOpenId(null)} aria-label="Close recap">
                ×
              </button>
            </div>

            <p className="recap-total">{fmt(recap.winnerScore)}</p>
            <div className="board-card" style={{ marginTop: 12 }}>
              {recap.players.map((player, index) => (
                <div
                  key={player.id}
                  className={`board-row ${player.id === recap.winnerId ? "is-winner" : ""}`}
                >
                  <span className="board-rank">{index + 1}</span>
                  <span className="board-name">{player.name}</span>
                  <span className="board-score">{fmt(player.score)}</span>
                </div>
              ))}
            </div>
            <p className="settings-footnote">
              {recap.players.length} players · {recap.modeLabel} ·{" "}
              {open.config.winCondition === "first" ? "first to target" : "complete round"} ·{" "}
              {open.config.farklePenalty > 0
                ? `−${fmt(open.config.farklePenalty)} farkle penalty`
                : "no penalty"}
            </p>
            <div className="recap-actions">
              <button type="button" className="btn-secondary" onClick={() => void share()}>
                Share
              </button>
              <button type="button" className="btn-primary" onClick={() => setOpenId(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
