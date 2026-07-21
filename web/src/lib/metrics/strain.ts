/**
 * Strain 0–21 — Karvonen %HRR + Edwards TRIMP + log compression (NOOP / Edwards 1993).
 * strain = 21 * ln(TRIMP + 1) / ln(7201)
 */

import { HrSample, Profile, clamp, resolveMaxHr, round } from "./types";

function zoneWeight(pctHrr: number): number {
  if (pctHrr < 50) return 1;
  if (pctHrr < 60) return 2;
  if (pctHrr < 70) return 3;
  if (pctHrr < 80) return 4;
  return 5;
}

export type StrainResult = {
  strain: number;
  trimp: number;
  maxHr: number;
  restingHr: number;
  minutesTracked: number;
  zoneMinutes: number[];
};

/**
 * Accumulate strain from irregular HR samples.
 * Each sample covers the gap to the next (capped at 120s) so dropouts don't explode TRIMP.
 */
export function computeStrain(
  samples: HrSample[],
  restingHr: number,
  profile: Profile,
): StrainResult {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const observedMax = sorted.reduce((m, s) => Math.max(m, s.bpm), 0);
  const maxHr = resolveMaxHr(profile, observedMax);
  const denom = Math.max(maxHr - restingHr, 1);

  let trimp = 0;
  let minutes = 0;
  const zoneMinutes = [0, 0, 0, 0, 0];

  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    const next = sorted[i + 1];
    const dtMs = next ? Math.min(next.t - s.t, 120_000) : 1000;
    if (dtMs <= 0) continue;
    const dtMin = dtMs / 60_000;
    const pct = clamp(((s.bpm - restingHr) / denom) * 100, 0, 100);
    const w = zoneWeight(pct);
    trimp += w * dtMin;
    minutes += dtMin;
    zoneMinutes[w - 1]! += dtMin;
  }

  const strain = clamp((21 * Math.log(trimp + 1)) / Math.log(7201), 0, 21);

  return {
    strain: round(strain, 1),
    trimp: round(trimp, 2),
    maxHr,
    restingHr: round(restingHr, 0),
    minutesTracked: round(minutes, 1),
    zoneMinutes: zoneMinutes.map((z) => round(z, 1)),
  };
}

/** Banister alternative (for comparison / optional). */
export function banisterTrimpMinute(
  bpm: number,
  restingHr: number,
  maxHr: number,
  sex: Profile["sex"],
): number {
  const [k, b] = sex === "f" ? [0.86, 1.67] : [0.64, 1.92];
  const ratio = clamp((bpm - restingHr) / Math.max(maxHr - restingHr, 1), 0, 1);
  return ratio * k * Math.exp(b * ratio);
}
