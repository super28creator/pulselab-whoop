/**
 * Sleep detection + Sleep Performance (duration vs need).
 * Actigraphy-lite from HR only — real Whoop also uses accelerometer.
 * Daytime wear / short sessions must NEVER produce a sleep score.
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
  const strainExtra = (Math.max(0, yesterdayStrain - 8) * (12 / 60)) / 3;
  return clamp(base + strainExtra + debtHours * 0.5, 6, 10);
}

/**
 * Find longest contiguous low-HR window that looks like a real night.
 */
export function detectSleep(
  samples: HrSample[],
  restingHr: number,
): {
  asleepSamples: HrSample[];
  bedtime?: number;
  wakeTime?: number;
} {
  if (samples.length < 60) return { asleepSamples: [] };

  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const threshold = restingHr + 12;
  const candidates: HrSample[] = [];

  for (const s of sorted) {
    const hour = new Date(s.t).getHours();
    // Core night only — not "anytime before noon"
    const night = hour >= 21 || hour < 8;
    if (night && s.bpm <= threshold) candidates.push(s);
  }

  if (candidates.length < 40) return { asleepSamples: [] };

  let best: HrSample[] = [];
  let cur: HrSample[] = [candidates[0]!];
  for (let i = 1; i < candidates.length; i++) {
    const gap = candidates[i]!.t - candidates[i - 1]!.t;
    if (gap <= 15 * 60_000) {
      cur.push(candidates[i]!);
    } else {
      if (cur.length > best.length) best = cur;
      cur = [candidates[i]!];
    }
  }
  if (cur.length > best.length) best = cur;

  const bedtime = best[0]!.t;
  const wakeTime = best[best.length - 1]!.t;
  const spanH = (wakeTime - bedtime) / 3_600_000;
  const bedHour = new Date(bedtime).getHours();
  const plausibleBed = bedHour >= 20 || bedHour < 3;
  if (spanH < 4 || !plausibleBed) return { asleepSamples: [] };

  return { asleepSamples: best, bedtime, wakeTime };
}

export function computeSleepPerformance(
  samples: HrSample[],
  restingHr: number,
  profile: Profile,
  yesterdayStrain: number,
): SleepResult {
  const need = sleepNeedHours(profile, yesterdayStrain);
  const { asleepSamples, bedtime, wakeTime } = detectSleep(samples, restingHr);

  if (!bedtime || !wakeTime || asleepSamples.length < 40) {
    return {
      performance: 0,
      hoursAsleep: 0,
      hoursNeeded: round(need, 2),
      efficiency: 0,
      provisional: true,
    };
  }

  const hoursAsleep = (wakeTime - bedtime) / 3_600_000;
  const expectedSamples = hoursAsleep * 60;
  const efficiency = clamp(asleepSamples.length / Math.max(expectedSamples, 1), 0.55, 1);
  const durationScore = clamp(hoursAsleep / need, 0, 1.15);
  let performance = durationScore * 100 * (0.7 + 0.3 * efficiency);
  performance = clamp(performance, 0, 100);

  // Full-ish night required before we claim a score
  const provisional = hoursAsleep < 5.5;

  return {
    performance: provisional ? 0 : round(performance, 0),
    hoursAsleep: round(hoursAsleep, 2),
    hoursNeeded: round(need, 2),
    efficiency: round(efficiency, 2),
    bedtime,
    wakeTime,
    provisional,
  };
}

/** Resting HR from quiet overnight / lowest rolling average. */
export function estimateRestingHr(samples: HrSample[], fallback = 60): number {
  if (samples.length < 20) return fallback;
  const sorted = [...samples].sort((a, b) => a.t - b.t);
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
