/**
 * Stress level 0–10 from heart rate relative to personal resting/max HR.
 * Not a clinical value — a Garmin-style intensity proxy. Higher HR above
 * resting (and lower HRV when available) => more physiological stress.
 */

import { HrSample, Profile, clamp, resolveMaxHr } from "./types";

export type StressPoint = { t: number; level: number };

export function stressFromHr(bpm: number, rhr: number, maxHr: number): number {
  const frac = clamp((bpm - rhr) / Math.max(maxHr - rhr, 1), 0, 1);
  // Non-linear: resting sits low (1-2), moderate effort climbs fast
  const shaped = Math.pow(frac, 0.75);
  return clamp(Math.round(shaped * 10), 0, 10);
}

/** Build a per-day stress series, smoothed to ~5 min buckets. */
export function stressSeries(
  samples: HrSample[],
  rhr: number,
  profile: Profile,
  bucketMs = 5 * 60_000,
): StressPoint[] {
  if (!samples.length) return [];
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const maxHr = resolveMaxHr(profile, sorted.reduce((m, s) => Math.max(m, s.bpm), 0));

  const buckets = new Map<number, number[]>();
  for (const s of sorted) {
    const key = Math.floor(s.t / bucketMs) * bucketMs;
    const arr = buckets.get(key) ?? [];
    arr.push(stressFromHr(s.bpm, rhr, maxHr));
    buckets.set(key, arr);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, arr]) => ({
      t,
      level: Math.round((arr.reduce((x, y) => x + y, 0) / arr.length) * 10) / 10,
    }));
}

export function averageStress(series: StressPoint[]): number {
  if (!series.length) return 0;
  return Math.round((series.reduce((a, p) => a + p.level, 0) / series.length) * 10) / 10;
}

/** Down-sampled HR series (bpm) for the day chart. */
export function hrSeries(samples: HrSample[], bucketMs = 3 * 60_000): { t: number; bpm: number }[] {
  if (!samples.length) return [];
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const buckets = new Map<number, number[]>();
  for (const s of sorted) {
    const key = Math.floor(s.t / bucketMs) * bucketMs;
    const arr = buckets.get(key) ?? [];
    arr.push(s.bpm);
    buckets.set(key, arr);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, arr]) => ({ t, bpm: Math.round(arr.reduce((x, y) => x + y, 0) / arr.length) }));
}
