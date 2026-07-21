/** Task Force 1996 RMSSD + Malik ectopic filter (NOOP / sports-science standard). */

import { clamp } from "./types";

const RR_MIN = 300;
const RR_MAX = 2000;

export function cleanNnIntervals(rrMs: number[]): number[] {
  const ranged = rrMs.filter((r) => r >= RR_MIN && r <= RR_MAX);
  if (ranged.length < 5) return ranged;

  const out: number[] = [];
  for (let i = 0; i < ranged.length; i++) {
    const start = Math.max(0, i - 2);
    const end = Math.min(ranged.length, i + 3);
    const window = ranged.slice(start, end).sort((a, b) => a - b);
    const median = window[Math.floor(window.length / 2)]!;
    const v = ranged[i]!;
    if (Math.abs(v - median) / median <= 0.2) out.push(v);
  }
  return out;
}

/** RMSSD in milliseconds. null if insufficient clean beats. */
export function rmssd(rrMs: number[]): number | null {
  const nn = cleanNnIntervals(rrMs);
  if (nn.length < 20) return null;
  let sumSq = 0;
  let n = 0;
  for (let i = 1; i < nn.length; i++) {
    const d = nn[i]! - nn[i - 1]!;
    sumSq += d * d;
    n++;
  }
  if (n < 10) return null;
  return Math.sqrt(sumSq / n);
}

export function sdnn(rrMs: number[]): number | null {
  const nn = cleanNnIntervals(rrMs);
  if (nn.length < 20) return null;
  const mean = nn.reduce((a, b) => a + b, 0) / nn.length;
  const varSum = nn.reduce((a, b) => a + (b - mean) ** 2, 0) / (nn.length - 1);
  return Math.sqrt(varSum);
}

/** Estimate RR series from bpm when strap doesn't send RR (less accurate). */
export function syntheticRrFromBpm(bpm: number, count = 30): number[] {
  const base = 60000 / clamp(bpm, 40, 180);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    // small physiological jitter ~2%
    const jitter = 1 + (Math.sin(i * 1.7) * 0.015 + Math.sin(i * 0.3) * 0.01);
    out.push(base * jitter);
  }
  return out;
}
