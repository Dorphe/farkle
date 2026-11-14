import { useEffect, useRef, useState } from "react";
import type { DiceGameState } from "@farkle/engine";

export interface BankFlashData {
  /** Changes on every bank so the badge animation restarts. */
  key: number;
  name: string;
  points: number;
}

/** How long the badge stays up — matched by the bank-float keyframes. */
const FLASH_MS = 1800;
/** Two broadcasts of the same bank closer than this are the same bank. */
const REPEAT_MS = 2000;

/**
 * Surfaces the points a player just banked. The score itself snaps to its new
 * value the instant the turn changes hands, so this badge is what makes the
 * change legible at the table.
 */
export function useBankFlash(game: DiceGameState | null): BankFlashData | null {
  const [flash, setFlash] = useState<BankFlashData | null>(null);
  const lastEvent = useRef<DiceGameState["lastEvent"]>(null);
  const lastSignature = useRef("");
  const lastAt = useRef(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const event = game?.lastEvent;
    if (!event || event === lastEvent.current) return;
    lastEvent.current = event;

    const points = event.delta ?? 0;
    if (event.kind !== "bank" || points <= 0) return;

    // A reconnecting room can replay the same state twice: one bank, one badge.
    const signature = `${event.playerId}:${points}:${event.text}`;
    const now = performance.now();
    if (signature === lastSignature.current && now - lastAt.current < REPEAT_MS) return;
    lastSignature.current = signature;
    lastAt.current = now;

    const name = game?.players.find((player) => player.id === event.playerId)?.name ?? "";
    if (timer.current !== null) window.clearTimeout(timer.current);
    setFlash({ key: Date.now(), name, points });
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setFlash(null);
    }, FLASH_MS);
  }, [game]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return flash;
}

/** Decorative: the live region in each screen already announces the bank. */
export function BankFlash({ flash }: { flash: BankFlashData | null }) {
  if (!flash) return null;
  return (
    <div key={flash.key} className="bank-flash" aria-hidden="true">
      <span className="bank-flash-name">{flash.name}</span>
      <span className="bank-flash-amount">+{flash.points.toLocaleString("en-US")}</span>
    </div>
  );
}