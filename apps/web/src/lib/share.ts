/** Share sheet: PNG scorecard when the platform supports files, text otherwise. */

export interface ShareSummary {
  winner: string;
  winnerScore: number;
  target: number;
  players: { name: string; score: number }[];
  date?: number;
}

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

const fmt = (value: number) => value.toLocaleString("en-US");

export function summaryText(summary: ShareSummary): string {
  const standings = summary.players
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((player) => `${player.name} ${fmt(player.score)}`)
    .join(" · ");
  return `${summary.winner} wins Farkle with ${fmt(summary.winnerScore)}!\n${standings}\nfarkle.mathieu.cc`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

export async function buildShareImage(summary: ShareSummary): Promise<Blob | null> {
  try {
    await document.fonts.ready;
  } catch {
    /* system fonts are fine */
  }

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const ink = "#2B2220";
  const body = "#4A403B";
  const muted = "#6E625C";
  const accent = "#D4715B";
  const accentInk = "#FFF8F5";
  const card = "#FFFFFF";
  const font = '"Plus Jakarta Sans", "Segoe UI", sans-serif';

  const background = ctx.createLinearGradient(0, 0, 0, canvas.height);
  background.addColorStop(0, "#FAF5F0");
  background.addColorStop(1, "#ECE1D8");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = ink;
  ctx.font = `800 58px ${font}`;
  ctx.textAlign = "left";
  ctx.fillText("Farkle", 84, 130);

  ctx.fillStyle = muted;
  ctx.font = `700 24px ${font}`;
  ctx.letterSpacing = "6px";
  ctx.textAlign = "center";
  ctx.fillText("GAME OVER", canvas.width / 2, 300);

  ctx.letterSpacing = "0px";
  ctx.fillStyle = ink;
  ctx.font = `800 118px ${font}`;
  ctx.fillText(summary.winner, canvas.width / 2, 470);

  ctx.fillStyle = accent;
  ctx.font = `800 118px ${font}`;
  ctx.fillText("wins.", canvas.width / 2, 590);

  const pillWidth = 360;
  const pillHeight = 150;
  roundRect(ctx, (canvas.width - pillWidth) / 2, 650, pillWidth, pillHeight, 42);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.fillStyle = accentInk;
  ctx.font = `800 66px ${font}`;
  ctx.fillText(fmt(summary.winnerScore), canvas.width / 2, 740);
  ctx.font = `700 18px ${font}`;
  ctx.fillStyle = "#FFE9E0";
  ctx.letterSpacing = "4px";
  ctx.fillText("POINTS", canvas.width / 2, 778);
  ctx.letterSpacing = "0px";

  const rows = summary.players.slice().sort((a, b) => b.score - a.score);
  const cardX = 84;
  const cardY = 858;
  const cardW = canvas.width - 168;
  const rowH = 76;
  const cardH = rows.length * rowH + 32;
  roundRect(ctx, cardX, cardY, cardW, cardH, 40);
  ctx.fillStyle = card;

  const gradients = ["#F7C9A9", "#B9DCC1", "#F3B7C3", "#C9C2E8", "#F6E2A8", "#BCD7EA"];
  ctx.fill();
  ctx.textAlign = "left";
  rows.forEach((player, index) => {
    const top = cardY + 16 + index * rowH;
    roundRect(ctx, cardX + 24, top + 16, 44, 44, 14);
    ctx.fillStyle = gradients[index % gradients.length] ?? "#F7C9A9";
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.font = `800 22px ${font}`;
    ctx.fillText(player.name.slice(0, 1).toUpperCase(), cardX + 42, top + 47);

    ctx.font = `700 28px ${font}`;
    ctx.fillStyle = ink;
    ctx.fillText(player.name.slice(0, 18), cardX + 90, top + 47);

    ctx.textAlign = "right";
    ctx.font = `800 30px ${font}`;
    ctx.fillStyle = index === 0 ? accent : ink;
    ctx.fillText(fmt(player.score), cardX + cardW - 28, top + 47);
    ctx.textAlign = "left";
  });

  ctx.textAlign = "center";
  ctx.fillStyle = muted;
  ctx.font = `600 22px ${font}`;
  ctx.fillText(
    `First to ${fmt(summary.target)} · ${summary.players.length} ${summary.players.length === 1 ? "player" : "players"}`,
    canvas.width / 2,
    cardY + cardH + 70,
  );
  ctx.fillStyle = body;
  ctx.font = `600 22px ${font}`;
  ctx.fillText("farkle.mathieu.cc", canvas.width / 2, canvas.height - 60);

  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
}

function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:-1000px;left:-1000px;opacity:0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export async function shareSummary(summary: ShareSummary): Promise<ShareOutcome> {
  const text = summaryText(summary);
  let blob: Blob | null = null;
  try {
    blob = await buildShareImage(summary);
  } catch {
    blob = null;
  }

  if (blob && navigator.canShare) {
    const file = new File([blob], "farkle-result.png", { type: "image/png" });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ title: "Farkle result", text, files: [file] });
        return "shared";
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      }
    }
  }

  if (navigator.share) {
    try {
      await navigator.share({ title: "Farkle result", text });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return legacyCopy(text) ? "copied" : "failed";
  }
}
