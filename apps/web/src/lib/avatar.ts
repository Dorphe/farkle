/** Seat tint, cycled over the six avatar tones declared in tokens.css. */
export function avatarColor(index: number): string {
  return `var(--avatar-${(index % 6) + 1})`;
}
