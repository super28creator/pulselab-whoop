/**
 * Physiological stress 0–10 (Firstbeat / Garmin-style approximation).
 *
 * Combines:
 *  1. Absolute elevation above RHR (most reliable without R-R from BLE)
 *  2. Heart-rate reserve (Karvonen %HRR)
 *  3. Short-window RMSSD when real R-R exists
 *  4. Beat-to-beat HR stability
 *  5. Light overnight dampening only when truly at rest
 *  6. EWMA smoothing
 *
 * NOT a clinical diagnosis. Open physiology, not Whoop/Garmin proprietary IP.
 */

import { rmssd } from "./hrv";
import { HrSample, Profile, clamp, resolveMaxHr } from "./types";

export type StressPoint = { t: number; level: number; hrvMs?: number };

/** Typical resting ln(RMSSD) ~3.5–4.2 (RMSSD ~35–70 ms) for young adults. */
const DEFAULT_LN_RMSSD_BASELINE = 3.8;

function ln(x: number): number {
  return Math.log(Math.max(x, 1e-6));
}

/**
 * bpm above resting → stress. Primary signal for Whoop BLE (often no R-R).
 * Calibrated so desk/walk/run land in sensible bands.
 */
function stressFromElevation(meanBpm: number, rhr: number): number {
  const above = meanBpm - rhr;
  if (above <= 3) return 0.8;
  if (above <= 10) return 0.8 + ((above - 3) / 7) * 1.7; // → ~2.5
  if (above <= 18) return 2.5 + ((above - 10) / 8) * 1.8; // → ~4.3
  if (above <= 30) return 4.3 + ((above - 18) / 12) * 2.0; // → ~6.3
  if (above <= 45) return 6.3 + ((above - 30) / 15) * 1.7; // → ~8.0
  if (above <= 70) return 8.0 + ((above - 45) / 25) * 1.3; // → ~9.3
  return clamp(9.3 + ((above - 70) / 40) * 0.7, 0, 10);
}

/**
 * Map %HRR → stress contribution 0–10 (more responsive than v1).
 */
function stressFromHrr(pctHrr: number): number {
  if (pctHrr <= 3) return 0.8;
  if (pctHrr <= 10) return 0.8 + ((pctHrr - 3) / 7) * 1.7; // → ~2.5
  if (pctHrr <= 20) return 2.5 + ((pctHrr - 10) / 10) * 1.9; // → ~4.4
  if (pctHrr <= 35) return 4.4 + ((pctHrr - 20) / 15) * 2.0; // → ~6.4
  if (pctHrr <= 50) return 6.4 + ((pctHrr - 35) / 15) * 1.6; // → ~8.0
  if (pctHrr <= 70) return 8.0 + ((pctHrr - 50) / 20) * 1.2; // → ~9.2
  return clamp(9.2 + ((pctHrr - 70) / 30) * 0.8, 0, 10);
}

/**
 * Map ln(RMSSD) vs personal baseline → stress 0–10.
 */
function stressFromHrv(rmssdMs: number, lnBaseline: number): number {
  const z = (ln(rmssdMs) - lnBaseline) / 0.4;
  // Steeper logistic — HRV drops register as clearer stress
  const raw = 10 / (1 + Math.exp(1.35 * z));
  return clamp(raw, 0.5, 10);
}

/** Successive-BPM proxy when strap sends no R-R. */
function stressFromHrStability(bpms: number[], meanBpm: number, rhr: number): number {
  if (bpms.length < 3) return stressFromElevation(meanBpm, rhr);
  let sumAbs = 0;
  for (let i = 1; i < bpms.length; i++) sumAbs += Math.abs(bpms[i]! - bpms[i - 1]!);
  const mad = sumAbs / (bpms.length - 1);
  const elev = clamp((meanBpm - rhr) / 28, 0, 1);
  const jitter = clamp(mad / 6, 0, 1);
  return clamp(0.8 + elev * 7.2 + jitter * 2.5, 0.5, 10);
}

function hourLocal(t: number): number {
  return new Date(t).getHours();
}

function isQuietNight(hour: number, bpm: number, rhr: number): boolean {
  return (hour >= 23 || hour < 6) && bpm <= rhr + 6;
}

/**
 * Stress for one analysis window (samples in a ~2–5 min bucket).
 */
export function stressForWindow(
  samples: HrSample[],
  rhr: number,
  maxHr: number,
  lnHrvBaseline = DEFAULT_LN_RMSSD_BASELINE,
): { level: number; hrvMs: number | null } {
  if (!samples.length) return { level: 0, hrvMs: null };

  const bpms = samples.map((s) => s.bpm);
  const meanBpm = bpms.reduce((a, b) => a + b, 0) / bpms.length;
  const denom = Math.max(maxHr - rhr, 1);
  const pctHrr = clamp(((meanBpm - rhr) / denom) * 100, 0, 100);

  const rr: number[] = [];
  for (const s of samples) {
    if (s.rrMs?.length) rr.push(...s.rrMs);
  }

  let hrvMs: number | null = null;
  // Lower bar — BLE often sends short RR bursts
  if (rr.length >= 16) {
    hrvMs = rmssd(rr);
  }

  const elevComp = stressFromElevation(meanBpm, rhr);
  const hrComp = stressFromHrr(pctHrr);
  const rateComp = Math.max(elevComp, hrComp) * 0.55 + Math.min(elevComp, hrComp) * 0.45;

  let level: number;

  if (hrvMs != null && hrvMs > 8) {
    const hrvComp = stressFromHrv(hrvMs, lnHrvBaseline);
    // Near-rest + absurdly low RMSSD ⇒ junk RR — distrust HRV
    const hrvTrusted = !(pctHrr < 12 && hrvMs < 15);
    if (hrvTrusted) {
      // HRV + rate — don't let rate alone dominate when autonomic signal exists
      level = 0.5 * hrvComp + 0.5 * rateComp;
    } else {
      level = 0.8 * rateComp + 0.2 * stressFromHrStability(bpms, meanBpm, rhr);
    }
  } else {
    const stab = stressFromHrStability(bpms, meanBpm, rhr);
    // No R-R: lean hard on elevation (what the user feels)
    level = 0.75 * rateComp + 0.25 * stab;
  }

  // Only soft overnight dampen when truly asleep-like — don't crush daytime stress
  const midT = samples[Math.floor(samples.length / 2)]!.t;
  if (isQuietNight(hourLocal(midT), meanBpm, rhr)) {
    level = level * 0.65 + 1.0 * 0.35;
    level = Math.min(level, 3.2);
  }

  return { level: clamp(Math.round(level * 10) / 10, 0, 10), hrvMs };
}

/** Estimate personal ln(RMSSD) baseline from quiet daytime/overnight samples. */
export function estimateLnHrvBaseline(samples: HrSample[], rhr: number): number {
  const quiet = samples.filter((s) => s.bpm <= rhr + 12);
  const rr: number[] = [];
  for (const s of quiet) {
    if (s.rrMs?.length) rr.push(...s.rrMs);
  }
  if (rr.length >= 40) {
    const v = rmssd(rr);
    if (v != null && v > 8) return ln(v);
  }
  return DEFAULT_LN_RMSSD_BASELINE;
}

/**
 * Build a day stress series (default 2-min buckets) with EWMA smoothing.
 */
export function stressSeries(
  samples: HrSample[],
  rhr: number,
  profile: Profile,
  bucketMs = 2 * 60_000,
): StressPoint[] {
  if (!samples.length) return [];
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const maxHr = resolveMaxHr(profile, sorted.reduce((m, s) => Math.max(m, s.bpm), 0));
  const lnBase = estimateLnHrvBaseline(sorted, rhr);

  const buckets = new Map<number, HrSample[]>();
  for (const s of sorted) {
    const key = Math.floor(s.t / bucketMs) * bucketMs;
    const arr = buckets.get(key) ?? [];
    arr.push(s);
    buckets.set(key, arr);
  }

  const raw: StressPoint[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, arr]) => arr.length >= 1)
    .map(([t, arr]) => {
      const { level, hrvMs } = stressForWindow(arr, rhr, maxHr, lnBase);
      return { t, level, hrvMs: hrvMs ?? undefined };
    });

  if (raw.length < 2) return raw;

  // Higher α → peaks show up (was over-smoothing and looking "always low")
  const alpha = 0.55;
  const smooth: StressPoint[] = [];
  let prev = raw[0]!.level;
  for (const p of raw) {
    prev = alpha * p.level + (1 - alpha) * prev;
    smooth.push({
      t: p.t,
      level: Math.round(prev * 10) / 10,
      hrvMs: p.hrvMs,
    });
  }
  return smooth;
}

export function averageStress(series: StressPoint[]): number {
  if (!series.length) return 0;
  return Math.round((series.reduce((a, p) => a + p.level, 0) / series.length) * 10) / 10;
}

/** Current / latest stress reading. */
export function currentStress(series: StressPoint[]): number | null {
  if (!series.length) return null;
  return series[series.length - 1]!.level;
}

/** Label for UI. */
export function stressBand(level: number): "low" | "moderate" | "high" | "very_high" {
  if (level < 2.5) return "low";
  if (level < 5) return "moderate";
  if (level < 7.5) return "high";
  return "very_high";
}

export function stressBandLabel(level: number): string {
  switch (stressBand(level)) {
    case "low":
      return "Spokojnie";
    case "moderate":
      return "Umiarkowany";
    case "high":
      return "Wysoki";
    case "very_high":
      return "Bardzo wysoki";
  }
}

/** Down-sampled HR series (bpm) for the day chart. */
export function hrSeries(samples: HrSample[], bucketMs = 2 * 60_000): { t: number; bpm: number }[] {
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
