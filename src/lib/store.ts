/** Local persistence for HR samples, profile, baselines. */

import { Baseline, emptyBaseline } from "./metrics/recovery";
import { HrSample, Profile, localDateKey } from "./metrics/types";

const PROFILE_KEY = "pulselab.profile";
const BASELINE_KEY = "pulselab.baseline";
const SAMPLES_KEY = "pulselab.samples.v1";

export function loadProfile(): Profile {
  if (typeof window === "undefined") return { age: 30, sex: "u" };
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return { age: 30, sex: "u" };
    return { age: 30, sex: "u", ...JSON.parse(raw) };
  } catch {
    return { age: 30, sex: "u" };
  }
}

export function saveProfile(p: Profile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

export function loadBaseline(): Baseline {
  if (typeof window === "undefined") return emptyBaseline();
  try {
    const raw = localStorage.getItem(BASELINE_KEY);
    if (!raw) return emptyBaseline();
    return { ...emptyBaseline(), ...JSON.parse(raw) };
  } catch {
    return emptyBaseline();
  }
}

export function saveBaseline(b: Baseline): void {
  localStorage.setItem(BASELINE_KEY, JSON.stringify(b));
}

type StoreShape = Record<string, HrSample[]>;

function readAll(): StoreShape {
  try {
    const raw = localStorage.getItem(SAMPLES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAll(data: StoreShape): void {
  // Cap ~3 days of dense samples to avoid quota issues
  const keys = Object.keys(data).sort();
  while (keys.length > 4) {
    delete data[keys.shift()!];
  }
  localStorage.setItem(SAMPLES_KEY, JSON.stringify(data));
}

export function appendSample(sample: HrSample): void {
  const all = readAll();
  const key = localDateKey(sample.t);
  const list = all[key] ?? [];
  const last = list[list.length - 1];
  // Downsample: keep ~every 5s unless RR present
  if (last && sample.t - last.t < 5000 && !sample.rrMs?.length) {
    list[list.length - 1] = sample;
  } else {
    list.push(sample);
  }
  // Cap per day
  if (list.length > 20_000) list.splice(0, list.length - 20_000);
  all[key] = list;
  writeAll(all);
}

export function loadDaySamples(date = localDateKey()): HrSample[] {
  return readAll()[date] ?? [];
}

export function loadRecentSamples(days = 2): HrSample[] {
  const all = readAll();
  const out: HrSample[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = localDateKey(d.getTime());
    out.push(...(all[key] ?? []));
  }
  return out.sort((a, b) => a.t - b.t);
}

export function exportCsv(samples: HrSample[]): string {
  const lines = ["timestamp,bpm,rr_ms"];
  for (const s of samples) {
    lines.push(`${new Date(s.t).toISOString()},${s.bpm},${(s.rrMs ?? []).join("|")}`);
  }
  return lines.join("\n");
}
