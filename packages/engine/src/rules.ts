/**
 * Scoring core. Pure: no DOM, no clock, no randomness.
 * Implements PRD §7.2–§7.3 (canonical scoring + selection semantics).
 */

export type Face = 1 | 2 | 3 | 4 | 5 | 6;
export type WinCondition = "first" | "completeRound";

export interface GameConfig {
  /** First total at or above this wins. */
  target: number;
  /** A player on 0 must bank at least this much to score (0 = off). */
  entryThreshold: number;
  /** Value of a 1–6 straight, or null when disabled. */
  straight: number | null;
  threePairs: boolean;
  twoTriplets: boolean;
  /** Points lost on the third consecutive farkle; 0 disables the penalty. */
  farklePenalty: number;
  hotDice: boolean;
  winCondition: WinCondition;
  firstPlayer: "first" | "random";
}

export const ALL_FACES: readonly Face[] = [1, 2, 3, 4, 5, 6];

export const CLASSIC: GameConfig = {
  target: 10_000,
  entryThreshold: 0,
  straight: 1_500,
  threePairs: true,
  twoTriplets: true,
  farklePenalty: 1_000,
  hotDice: true,
  winCondition: "first",
  firstPlayer: "first",
};

export const BAR: GameConfig = { ...CLASSIC, entryThreshold: 500 };
export const FAMILY: GameConfig = { ...CLASSIC, target: 5_000, farklePenalty: 0 };

export const PRESETS = {
  classic: CLASSIC,
  bar: BAR,
  family: FAMILY,
} as const;

export type PresetName = keyof typeof PRESETS;

export function preset(name: PresetName): GameConfig {
  return { ...PRESETS[name] };
}

/** Which preset a config matches, ignoring first-player choice. */
export function detectPreset(config: GameConfig): PresetName | "custom" {
  const fields: (keyof GameConfig)[] = [
    "target",
    "entryThreshold",
    "straight",
    "threePairs",
    "twoTriplets",
    "farklePenalty",
    "hotDice",
    "winCondition",
  ];
  for (const name of Object.keys(PRESETS) as PresetName[]) {
    const candidate = PRESETS[name];
    if (fields.every((field) => candidate[field] === config[field])) return name;
  }
  return "custom";
}

export type Counts = [number, number, number, number, number, number];

export function countsOf(faces: readonly Face[]): Counts {
  const counts: Counts = [0, 0, 0, 0, 0, 0];
  for (const face of faces) counts[face - 1] = (counts[face - 1] ?? 0) + 1;
  return counts;
}

export interface Combo {
  /** Face indices (0-based) consumed by this combination. */
  use: number[];
  points: number;
  label: string;
}

/** All scoring combinations available in a multiset of dice. */
export function combos(counts: Counts, config: GameConfig): Combo[] {
  const out: Combo[] = [];

  if (counts[0] > 0) out.push({ use: [0], points: 100, label: "single 1" });
  if (counts[4] > 0) out.push({ use: [4], points: 50, label: "single 5" });

  for (let i = 0; i < 6; i++) {
    const count = counts[i] ?? 0;
    if (count < 3) continue;
    const base = i === 0 ? 1_000 : (i + 1) * 100;
    for (let n = 3; n <= count; n++) {
      const multiplier = 2 ** (n - 3);
      out.push({
        use: Array<number>(n).fill(i),
        points: base * multiplier,
        label: `${n} × ${i + 1}`,
      });
    }
  }

  if (config.straight !== null && counts.every((n) => n >= 1)) {
    out.push({ use: [0, 1, 2, 3, 4, 5], points: config.straight, label: "straight 1–6" });
  }

  if (config.threePairs) {
    const pairs = [0, 1, 2, 3, 4, 5].filter((i) => (counts[i] ?? 0) >= 2);
    for (let a = 0; a < pairs.length; a++) {
      for (let b = a + 1; b < pairs.length; b++) {
        for (let c = b + 1; c < pairs.length; c++) {
          const pa = pairs[a] ?? 0;
          const pb = pairs[b] ?? 0;
          const pc = pairs[c] ?? 0;
          out.push({
            use: [pa, pa, pb, pb, pc, pc],
            points: 1_500,
            label: "three pairs",
          });
        }
      }
    }
  }

  if (config.twoTriplets) {
    const trips = [0, 1, 2, 3, 4, 5].filter((i) => (counts[i] ?? 0) >= 3);
    for (let a = 0; a < trips.length; a++) {
      for (let b = a + 1; b < trips.length; b++) {
        const ta = trips[a] ?? 0;
        const tb = trips[b] ?? 0;
        out.push({
          use: [ta, ta, ta, tb, tb, tb],
          points: 2_500,
          label: "two triplets",
        });
      }
    }
  }

  return out;
}

/**
 * Maximum legal score from a multiset. Returns null when `mustUseAll` is true
 * and some dice cannot be assigned to a scoring combination.
 */
export function bestScore(
  faces: readonly Face[],
  config: GameConfig = CLASSIC,
  mustUseAll = false,
): number | null {
  const memo = new Map<string, number | null>();

  function go(counts: Counts): number | null {
    const key = `${counts.join(",")}|${mustUseAll ? "all" : "any"}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    const empty = counts.every((n) => n === 0);
    let best: number | null;
    if (empty) {
      best = 0;
    } else {
      best = mustUseAll ? null : 0;
      for (const combo of combos(counts, config)) {
        const next: Counts = [...counts];
        let legal = true;
        for (const face of combo.use) {
          next[face] = (next[face] ?? 0) - 1;
          if ((next[face] ?? 0) < 0) {
            legal = false;
            break;
          }
        }
        if (!legal) continue;
        const sub = go(next);
        if (sub === null) continue;
        const total = combo.points + sub;
        if (best === null || total > best) best = total;
      }
    }
    memo.set(key, best);
    return best;
  }

  return go(countsOf(faces));
}

/** Score a selection; null when any selected die is not part of a scoring set. */
export function scoreSelection(
  faces: readonly Face[],
  config: GameConfig = CLASSIC,
): number | null {
  if (faces.length === 0) return 0;
  return bestScore(faces, config, true);
}

/** A roll is a farkle iff no subset of it scores (PRD RUL-03). */
export function isFarkle(faces: readonly Face[], config: GameConfig = CLASSIC): boolean {
  if (faces.length === 0) return false;
  return (bestScore(faces, config, false) ?? 0) === 0;
}

export function validateConfig(config: GameConfig): string[] {
  const problems: string[] = [];
  if (!Number.isFinite(config.target) || config.target < 1_000 || config.target > 50_000) {
    problems.push("Target must be between 1,000 and 50,000.");
  }
  if (![0, 500, 1_000].includes(config.entryThreshold)) {
    problems.push("Entry threshold must be 0, 500, or 1,000.");
  }
  if (config.straight !== null && ![1_000, 1_500, 3_000].includes(config.straight)) {
    problems.push("Straight value must be 1,000, 1,500, or 3,000.");
  }
  if (config.farklePenalty !== 0 && config.farklePenalty !== 1_000) {
    problems.push("Farkle penalty must be 0 or 1,000.");
  }
  return problems;
}
