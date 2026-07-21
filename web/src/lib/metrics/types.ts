/** PulseLab metrics — published physiology, Whoop-scale outputs (approximation). */

export type Sex = "m" | "f" | "u";

export type Profile = {
  age: number;
  sex: Sex;
  /** Override Tanaka if known */
  maxHr?: number;
  restingHrHint?: number;
};

export type HrSample = {
  t: number; // ms epoch
  bpm: number;
  rrMs?: number[];
};

export type DayBucket = {
  date: string; // YYYY-MM-DD local
  samples: HrSample[];
};

export function tanakaMaxHr(age: number): number {
  return Math.round(208 - 0.7 * age);
}

export function resolveMaxHr(profile: Profile, observedMax?: number): number {
  if (profile.maxHr && profile.maxHr > 120) return profile.maxHr;
  if (observedMax && observedMax > 130) return observedMax;
  return tanakaMaxHr(profile.age || 30);
}

export function localDateKey(ts = Date.now()): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function round(n: number, digits = 1): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}
