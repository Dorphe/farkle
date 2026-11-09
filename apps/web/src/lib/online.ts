import { normalizeRoomCode, ROOM_CODE_LENGTH } from "@farkle/protocol";

const NAME_KEY = "farkle.online.name";
const TOKEN_PREFIX = "farkle.online.token.";

/** Configured server base, or the dev default. Empty means this build has no online server. */
export function onlineSocketUrl(): string {
  const configured = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim();
  if (configured) {
    const base = configured.replace(/\/+$/, "").replace(/^http/, "ws");
    return base.endsWith("/ws") ? base : `${base}/ws`;
  }
  if (import.meta.env.DEV) return "ws://localhost:8787/ws";
  return "";
}

export function onlineConfigured(): boolean {
  return onlineSocketUrl().length > 0;
}

export function savedOnlineName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveOnlineName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name.trim().slice(0, 18));
  } catch {
    /* private mode — the name just won't persist */
  }
}

export function savedToken(code: string): string | null {
  const normalized = normalizeRoomCode(code);
  if (!normalized) return null;
  try {
    return localStorage.getItem(TOKEN_PREFIX + normalized);
  } catch {
    return null;
  }
}

export function saveToken(code: string, token: string): void {
  try {
    localStorage.setItem(TOKEN_PREFIX + code.toUpperCase(), token);
  } catch {
    /* ignore */
  }
}

export function forgetToken(code: string): void {
  try {
    localStorage.removeItem(TOKEN_PREFIX + code.toUpperCase());
  } catch {
    /* ignore */
  }
}

/** The canonical invite link, e.g. https://farkle.mathieu.cc/join/5T1S */
export function inviteLink(code: string): string {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/+$/, "");
  return `${base}/join/${code.toUpperCase()}`;
}

export function cleanCodeInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, ROOM_CODE_LENGTH);
}

export type ShareInviteOutcome = "shared" | "copied" | "cancelled" | "failed";

export async function shareInvite(code: string, roomLabel = "Farkle"): Promise<ShareInviteOutcome> {
  const url = inviteLink(code);
  const text = `Join my ${roomLabel} table — code ${code.toUpperCase()}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Farkle", text, url });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // Fall through to the clipboard.
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}
