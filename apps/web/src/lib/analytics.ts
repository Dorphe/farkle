/**
 * Cookieless analytics stub. No provider is wired in this build: events stay
 * on the device (dev console only) and the Settings switch stops even that.
 * Never pass names, room codes, or free text.
 */

let enabled = true;

export function setAnalyticsEnabled(value: boolean): void {
  enabled = value;
}

export function track(event: string, properties: Record<string, string | number | boolean> = {}): void {
  if (!enabled) return;
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug("[analytics]", event, properties);
  }
}
