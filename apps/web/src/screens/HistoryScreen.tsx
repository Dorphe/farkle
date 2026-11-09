import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { GameRecord } from "@farkle/engine";
import { listRecords } from "@/lib/db.ts";
import { shareSummary, type ShareSummary } from "@/lib/share.ts";

const fmt = (value: number) => value.toLocaleString("en-US");
const dateLabel = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function winnerOf(record: GameRecord) {
  return (
    record.state.players.find((player) => player.id === record.state.winnerId) ??
    record.state.players.slice().sort((a, b) => b.score - a.score)[0]
  );
}

function summaryOf(record: GameRecord): ShareSummary {
  const winner = winnerOf(record);
  return {
    winner: winner?.name ?? "Someone",
    winnerScore: winner?.score ?? 0,
    target: record.config.target,
    players: record.state.players.map((player) => ({ name: player.name, score: player.score })),
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

  async function share() {
    if (!open) return;
    const outcome = await shareSummary(summaryOf(open));
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
            const winner = winnerOf(record);
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
                  <span className="history-winner">{winner?.name ?? "Game"}</span>
                  <span className="history-score">{fmt(winner?.score ?? 0)}</span>
                </span>
                <span className="history-meta">
                  {dateLabel(record.updatedAt)} · {record.state.players.length} players · first to{" "}
                  {fmt(record.config.target)}
                </span>
                <span className="history-players">
                  {record.state.players.map((player) => `${player.name} ${fmt(player.score)}`).join(" · ")}
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

      {open ? (
        <div
          className="sheet-backdrop"
          onClick={(event) => event.target === event.currentTarget && setOpenId(null)}
        >
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Game recap">
            <div className="sheet-head">
              <div>
                <h2>{winnerOf(open)?.name ?? "Recap"}</h2>
                <p className="sheet-sub">
                  {dateLabel(open.updatedAt)} · first to {fmt(open.config.target)}
                </p>
              </div>
              <button type="button" className="sheet-close" onClick={() => setOpenId(null)} aria-label="Close recap">
                ×
              </button>
            </div>

            <p className="recap-total">{fmt(winnerOf(open)?.score ?? 0)}</p>
            <div className="board-card" style={{ marginTop: 12 }}>
              {open.state.players
                .slice()
                .sort((a, b) => b.score - a.score)
                .map((player, index) => (
                  <div
                    key={player.id}
                    className={`board-row ${player.id === open.state.winnerId ? "is-winner" : ""}`}
                  >
                    <span className="board-rank">{index + 1}</span>
                    <span className="board-name">{player.name}</span>
                    <span className="board-score">{fmt(player.score)}</span>
                  </div>
                ))}
            </div>
            <p className="settings-footnote">
              {open.state.players.length} players ·{" "}
              {open.config.winCondition === "first" ? "first to target" : "complete round"} ·{" "}
              {open.config.farklePenalty > 0 ? `−${fmt(open.config.farklePenalty)} farkle penalty` : "no penalty"}
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
