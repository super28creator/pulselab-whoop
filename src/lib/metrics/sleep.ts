/**
 * Sleep detection + Sleep Performance (duration vs need).
 * Actigraphy-lite from HR: sustained low HR overnight = sleep candidate.
 */

import { HrSample, Profile, clamp, round } from "./types";

export type SleepResult = {
  performance: number; // 0-100
  hoursAsleep: number;
  hoursNeeded: number;
  efficiency: number; // 0-1
  bedtime?: number;
  wakeTime?: number;
  provisional: boolean;
};

/** Sleep need hours — base + strain debt + age (Whoop-like heuristic, open). */
export function sleepNeedHours(profile: Profile, yesterdayStrain: number, debtHours = 0): number {
  const age = profile.age || 30;
  let base = 7.5;
  if (age < 25) base = 8.0;
  else if (age > 50) base = 7.0;
  // Strain debt: every 3 strain points above 8 adds ~12 min need
  const strainExtra = Math.max(0, yesterdayStrain - 8) * (12 / 60) / 3;
  return clamp(base + strainExtra + debtHours * 0.5, 6, 10);
}

/**
 * Find longest contiguous low-HR window during local night (21:00–12:00 next day).
 */
export function detectSleep(samples: HrSample[], restingHr: number): {
  asleepSamples: HrSample[];
  bedtime?: number;
  wakeTime?: number;
} {
  if (samples.length < 30) return { asleepSamples: [] };

  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const threshold = restingHr + 12; // near-resting
  const candidates: HrSample[] = [];

  for (const s of sorted) {
    const hour = new Date(s.t).getHours();
    const night = hour >= 21 || hour < 12;
    if (night && s.bpm <= threshold) candidates.push(s);
  }

  if (candidates.length < 20) return { asleepSamples: [] };

  // Longest run with gaps < 10 min
  let best: HrSample[] = [];
  let cur: HrSample[] = [candidates[0]!];
  for (let i = 1; i < candidates.length; i++) {
    const gap = candidates[i]!.t - candidates[i - 1]!.t;
    if (gap <= 10 * 60_000) {
      cur.push(candidates[i]!);
    } else {
      if (cur.length > best.length) best = cur;
      cur = [candidates[i]!];
    }
  }
  if (cur.length > best.length) best = cur;

  // Require at least ~90 minutes of signal coverage
  const spanH = (best[best.length - 1]!.t - best[0]!.t) / 3_600_000;
  if (spanH < 1.5) return { asleepSamples: [] };

  return {
    asleepSamples: best,
    bedtime: best[0]!.t,
    wakeTime: best[best.length - 1]!.t,
  };
}

export function computeSleepPerformance(
  samples: HrSample[],
  restingHr: number,
  profile: Profile,
  yesterdayStrain: number,
): SleepResult {
  const need = sleepNeedHours(profile, yesterdayStrain);
  const { asleepSamples, bedtime, wakeTime } = detectSleep(samples, restingHr);

  if (!bedtime || !wakeTime || asleepSamples.length < 20) {
    return {
      performance: 0,
      hoursAsleep: 0,
      hoursNeeded: round(need, 2),
      efficiency: 0,
      provisional: true,
    };
  }

  const hoursAsleep = (wakeTime - bedtime) / 3_600_000;
  // Efficiency proxy: sample density vs continuous coverage
  const expectedSamples = hoursAsleep * 60; // ~1/min if sparse store
  const efficiency = clamp(asleepSamples.length / Math.max(expectedSamples, 1), 0.55, 1);

  const durationScore = clamp(hoursAsleep / need, 0, 1.15);
  // Soft penalty for short sleep, mild bonus near need
  let performance = durationScore * 100 * (0.7 + 0.3 * efficiency);
  performance = clamp(performance, 0, 100);

  return {
    performance: round(performance, 0),
    hoursAsleep: round(hoursAsleep, 2),
    hoursNeeded: round(need, 2),
    efficiency: round(efficiency, 2),
    bedtime,
    wakeTime,
    provisional: hoursAsleep < 4,
  };
}

/** Resting HR from quiet overnight / lowest 30-min average. */
export function estimateRestingHr(samples: HrSample[], fallback = 60): number {
  if (samples.length < 20) return fallback;
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  // Rolling 10-sample means, take 5th percentile
  const means: number[] = [];
  const win = Math.min(15, Math.floor(sorted.length / 4));
  for (let i = 0; i + win <= sorted.length; i++) {
    const chunk = sorted.slice(i, i + win);
    const avg = chunk.reduce((s, x) => s + x.bpm, 0) / chunk.length;
    means.push(avg);
  }
  means.sort((a, b) => a - b);
  const idx = Math.floor(means.length * 0.05);
  const rhr = means[idx] ?? fallback;
  return clamp(Math.round(rhr), 35, 100);
}
