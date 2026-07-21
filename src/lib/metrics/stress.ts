/**
 * Physiological stress 0–10 (Firstbeat / Garmin-style approximation).
 *
 * Combines:
 *  1. Heart-rate reserve (Karvonen %HRR) — sympathetic drive from rate
 *  2. Short-window RMSSD (Task Force 1996) when R-R intervals exist —
 *     primary autonomic signal; low HRV ⇒ higher stress
 *  3. Beat-to-beat HR stability fallback when no R-R (successive BPM diffs)
 *  4. Circadian dampening overnight at near-resting HR
 *  5. EWMA smoothing so the day chart isn't noise
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
 * Map %HRR → stress contribution 0–10.
 * Resting / slightly above RHR stays low; only real load climbs.
 */
function stressFromHrr(pctHrr: number): number {
  // pctHrr is 0–100
  if (pctHrr <= 5) return 1.0;
  if (pctHrr <= 15) return 1.0 + ((pctHrr - 5) / 10) * 1.2; // → ~2.2
  if (pctHrr <= 30) return 2.2 + ((pctHrr - 15) / 15) * 1.5; // → ~3.7
  if (pctHrr <= 50) return 3.7 + ((pctHrr - 30) / 20) * 2.0; // → ~5.7
  if (pctHrr <= 70) return 5.7 + ((pctHrr - 50) / 20) * 2.0; // → ~7.7
  if (pctHrr <= 85) return 7.7 + ((pctHrr - 70) / 15) * 1.3; // → ~9.0
  return clamp(9.0 + ((pctHrr - 85) / 15) * 1.0, 0, 10);
}

/**
 * Map ln(RMSSD) vs personal baseline → stress 0–10.
 * Higher HRV than baseline = recovery (low stress).
 * Drop of ~1.0 ln unit ≈ strong acute stress.
 */
function stressFromHrv(rmssdMs: number, lnBaseline: number): number {
  const z = (ln(rmssdMs) - lnBaseline) / 0.45; // ~robust sigma
  // Invert: low HRV → high stress. Logistic around z=0.
  const raw = 10 / (1 + Math.exp(1.1 * z));
  return clamp(raw, 0.5, 10);
}

/** Successive-BPM proxy when strap sends no R-R (weaker signal). */
function stressFromHrStability(bpms: number[], meanBpm: number, rhr: number): number {
  if (bpms.length < 4) return stressFromHrr(((meanBpm - rhr) / Math.max(40, 1)) * 50);
  let sumAbs = 0;
  for (let i = 1; i < bpms.length; i++) sumAbs += Math.abs(bpms[i]! - bpms[i - 1]!);
  const mad = sumAbs / (bpms.length - 1);
  // Stable low HR → calm; unstable or high → stressed
  const elev = clamp((meanBpm - rhr) / 40, 0, 1);
  const jitter = clamp(mad / 8, 0, 1); // ~8 bpm successive = high
  return clamp(1 + elev * 6 + jitter * 3, 0.5, 10);
}

function hourLocal(t: number): number {
  return new Date(t).getHours();
}

function isQuietNight(hour: number, bpm: number, rhr: number): boolean {
  return (hour >= 23 || hour < 6) && bpm <= rhr + 8;
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

  // Collect real R-R
  const rr: number[] = [];
  for (const s of samples) {
    if (s.rrMs?.length) rr.push(...s.rrMs);
  }

  let hrvMs: number | null = null;
  // Only real R-R — never synthetic for stress (fabricates false autonomic signal)
  if (rr.length >= 40) {
    hrvMs = rmssd(rr);
  }

  const hrComp = stressFromHrr(pctHrr);
  let level: number;

  if (hrvMs != null && hrvMs > 8) {
    const hrvComp = stressFromHrv(hrvMs, lnHrvBaseline);
    // Near-rest HR + absurdly low RMSSD ⇒ undersampled RR junk — distrust HRV
    const hrvTrusted = !(pctHrr < 18 && hrvMs < 20);
    if (hrvTrusted) {
      level = 0.55 * hrvComp + 0.45 * hrComp;
    } else {
      level = 0.75 * hrComp + 0.25 * stressFromHrStability(bpms, meanBpm, rhr);
    }
  } else {
    const stab = stressFromHrStability(bpms, meanBpm, rhr);
    level = 0.7 * hrComp + 0.3 * stab;
  }

  // Overnight near-resting: pull toward recovery (avoid false "stress" spikes)
  const midT = samples[Math.floor(samples.length / 2)]!.t;
  if (isQuietNight(hourLocal(midT), meanBpm, rhr)) {
    level = Math.min(level, 2.5);
    level = level * 0.55 + 1.2 * 0.45;
  }

  // True rest / desk: HR barely above RHR → stay in calm band
  if (pctHrr < 12) {
    level = Math.min(level, 2.8);
  } else if (pctHrr < 20) {
    level = Math.min(level, 4.0);
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
  if (rr.length >= 60) {
    const v = rmssd(rr);
    if (v != null && v > 8) return ln(v);
  }
  // Age-ish heuristic: younger → higher typical RMSSD
  return DEFAULT_LN_RMSSD_BASELINE;
}

/**
 * Build a day stress series (default 3-min buckets) with EWMA smoothing.
 */
export function stressSeries(
  samples: HrSample[],
  rhr: number,
  profile: Profile,
  bucketMs = 3 * 60_000,
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
    .filter(([, arr]) => arr.length >= 2)
    .map(([t, arr]) => {
      const { level, hrvMs } = stressForWindow(arr, rhr, maxHr, lnBase);
      return { t, level, hrvMs: hrvMs ?? undefined };
    });

  if (raw.length < 2) return raw;

  // EWMA α≈0.35 — responsive but not twitchy
  const alpha = 0.35;
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
  // Time-weighted equal buckets already — mean is fine
  return Math.round((series.reduce((a, p) => a + p.level, 0) / series.length) * 10) / 10;
}

/** Current / latest stress reading. */
export function currentStress(series: StressPoint[]): number | null {
  if (!series.length) return null;
  return series[series.length - 1]!.level;
}

/** Label for UI. */
export function stressBand(level: number): "low" | "moderate" | "high" | "very_high" {
  if (level < 3) return "low";
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
