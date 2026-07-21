/**
 * Recovery 0–100 — HRV-dominant z-score composite (NOOP weights / Capodilupo hierarchy).
 * score = 100 / (1 + exp(-1.6 * (z - (-0.20))))
 */

import { rmssd, syntheticRrFromBpm } from "./hrv";
import { SleepResult } from "./sleep";
import { HrSample, clamp, round } from "./types";

export type Baseline = {
  hrvMean: number;
  hrvMad: number;
  rhrMean: number;
  rhrMad: number;
  nights: number;
};

export type RecoveryResult = {
  recovery: number;
  band: "red" | "yellow" | "green";
  hrvMs: number | null;
  restingHr: number;
  sleepPerformance: number;
  provisional: boolean;
  drivers: { hrvZ: number; rhrZ: number; sleepZ: number };
};

function robustZ(value: number, mean: number, mad: number, invert = false): number {
  const sigma = Math.max(1.253 * mad, 1e-3);
  let z = (value - mean) / sigma;
  if (invert) z = -z;
  return z;
}

function ewmaMad(values: number[], mean: number): number {
  if (!values.length) return 1;
  const abs = values.map((v) => Math.abs(v - mean));
  return abs.reduce((a, b) => a + b, 0) / abs.length || 1;
}

export function emptyBaseline(): Baseline {
  return { hrvMean: 50, hrvMad: 12, rhrMean: 60, rhrMad: 4, nights: 0 };
}

/** Build / update baseline from historical nightly HRV + RHR. */
export function updateBaseline(
  prev: Baseline,
  nightHrv: number,
  nightRhr: number,
): Baseline {
  const n = prev.nights;
  const a = n === 0 ? 1 : 2 / (Math.min(n, 14) + 1); // EWMA-ish
  const hrvMean = n === 0 ? nightHrv : prev.hrvMean * (1 - a) + nightHrv * a;
  const rhrMean = n === 0 ? nightRhr : prev.rhrMean * (1 - a) + nightRhr * a;
  const hrvMad = n === 0 ? Math.max(8, nightHrv * 0.2) : prev.hrvMad * 0.85 + Math.abs(nightHrv - hrvMean) * 0.15;
  const rhrMad = n === 0 ? 4 : prev.rhrMad * 0.85 + Math.abs(nightRhr - rhrMean) * 0.15;
  return {
    hrvMean,
    hrvMad: Math.max(hrvMad, 3),
    rhrMean,
    rhrMad: Math.max(rhrMad, 1.5),
    nights: n + 1,
  };
}

export function overnightHrv(samples: HrSample[], restingHr: number): number | null {
  // Prefer real RR from quiet periods
  const quiet = samples.filter((s) => s.bpm <= restingHr + 15);
  const rr: number[] = [];
  for (const s of quiet) {
    if (s.rrMs?.length) rr.push(...s.rrMs);
  }
  if (rr.length >= 40) return rmssd(rr);

  // Fallback: synthetic from quiet bpm (lower confidence)
  if (quiet.length < 20) return null;
  const avgBpm = quiet.reduce((a, s) => a + s.bpm, 0) / quiet.length;
  return rmssd(syntheticRrFromBpm(avgBpm, 60));
}

export function computeRecovery(
  samples: HrSample[],
  restingHr: number,
  sleep: SleepResult,
  baseline: Baseline,
): RecoveryResult {
  const hrv = overnightHrv(samples, restingHr);
  // Recovery needs a real night + personal baseline — never invent a score from 2h of wear
  const provisional =
    baseline.nights < 4 || hrv == null || sleep.provisional || sleep.hoursAsleep < 5.5;

  if (provisional) {
    return {
      recovery: 0,
      band: "yellow",
      hrvMs: hrv != null ? round(hrv, 1) : null,
      restingHr: round(restingHr, 0),
      sleepPerformance: sleep.performance,
      provisional: true,
      drivers: { hrvZ: 0, rhrZ: 0, sleepZ: 0 },
    };
  }

  const hrvZ = robustZ(hrv!, baseline.hrvMean, baseline.hrvMad, false);
  const rhrZ = robustZ(restingHr, baseline.rhrMean, baseline.rhrMad, true);
  const sleepZ = (sleep.performance / 100 - 0.85) / 0.12;

  // Weights: HRV 60%, RHR 20%, Sleep 20%
  const z = 0.6 * hrvZ + 0.2 * rhrZ + 0.2 * sleepZ;
  const k = 1.6;
  const z0 = -0.2;
  const recovery = clamp(100 / (1 + Math.exp(-k * (z - z0))), 0, 100);
  const band = recovery < 34 ? "red" : recovery < 67 ? "yellow" : "green";

  return {
    recovery: round(recovery, 0),
    band,
    hrvMs: round(hrv!, 1),
    restingHr: round(restingHr, 0),
    sleepPerformance: sleep.performance,
    provisional: false,
    drivers: {
      hrvZ: round(hrvZ, 2),
      rhrZ: round(rhrZ, 2),
      sleepZ: round(sleepZ, 2),
    },
  };
}
