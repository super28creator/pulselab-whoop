/** Local persistence: HR samples, profile, baselines, activities, favorites, day summaries. */

import { Baseline, emptyBaseline } from "./metrics/recovery";
import { DEFAULT_PROFILE, HrSample, Profile, localDateKey } from "./metrics/types";

const PROFILE_KEY = "pulselab.profile";
const BASELINE_KEY = "pulselab.baseline";
const SAMPLES_KEY = "pulselab.samples.v1";
const ACTIVITIES_KEY = "pulselab.activities.v1";
const FAVSPORTS_KEY = "pulselab.favsports.v1";
const SUMMARY_KEY = "pulselab.summaries.v1";
const ACTIVE_KEY = "pulselab.active.v1";

const MAX_SAMPLE_DAYS = 8;

export function loadProfile(): Profile {
  if (typeof window === "undefined") return { ...DEFAULT_PROFILE };
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return { ...DEFAULT_PROFILE };
    return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PROFILE };
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

/* ---------------- HR samples ---------------- */

type StoreShape = Record<string, HrSample[]>;

function readAll(): StoreShape {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SAMPLES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAll(data: StoreShape): void {
  const keys = Object.keys(data).sort();
  while (keys.length > MAX_SAMPLE_DAYS) {
    delete data[keys.shift()!];
  }
  try {
    localStorage.setItem(SAMPLES_KEY, JSON.stringify(data));
  } catch {
    // Quota — drop oldest and retry once
    const k = Object.keys(data).sort();
    if (k.length) {
      delete data[k[0]!];
      try {
        localStorage.setItem(SAMPLES_KEY, JSON.stringify(data));
      } catch {
        /* give up silently */
      }
    }
  }
}

export function appendSample(sample: HrSample): void {
  const all = readAll();
  const key = localDateKey(sample.t);
  const list = all[key] ?? [];
  const last = list[list.length - 1];
  const rich = !!(sample.rrMs?.length || sample.accelG || sample.skinTempRaw);
  if (last && sample.t - last.t < 5000 && !rich) {
    list[list.length - 1] = sample;
  } else {
    list.push(sample);
  }
  if (list.length > 20_000) list.splice(0, list.length - 20_000);
  all[key] = list;
  writeAll(all);
}

export function appendSamples(samples: HrSample[]): void {
  for (const s of samples) appendSample(s);
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

/* ---------------- Activities ---------------- */

export type Activity = {
  id: string;
  sport: string;
  start: number;
  end: number;
  manual: boolean;
  note?: string;
};

/** Live session — started but not yet stopped. */
export type ActiveSession = {
  sport: string;
  start: number;
};

type ActivityStore = Record<string, Activity[]>;

function readActivities(): ActivityStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(ACTIVITIES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeActivities(data: ActivityStore): void {
  localStorage.setItem(ACTIVITIES_KEY, JSON.stringify(data));
}

export function addActivity(a: Omit<Activity, "id">): Activity {
  const all = readActivities();
  const key = localDateKey(a.start);
  const activity: Activity = { ...a, id: `${a.start}-${Math.random().toString(36).slice(2, 7)}` };
  all[key] = [...(all[key] ?? []), activity].sort((x, y) => x.start - y.start);
  writeActivities(all);
  return activity;
}

export function updateActivity(dateKey: string, id: string, patch: Partial<Activity>): void {
  const all = readActivities();
  all[dateKey] = (all[dateKey] ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a));
  writeActivities(all);
}

export function removeActivity(dateKey: string, id: string): void {
  const all = readActivities();
  all[dateKey] = (all[dateKey] ?? []).filter((a) => a.id !== id);
  writeActivities(all);
}

export function loadActivities(date = localDateKey()): Activity[] {
  return readActivities()[date] ?? [];
}

export function loadActiveSession(): ActiveSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function startActiveSession(sport: string): ActiveSession {
  const session: ActiveSession = { sport, start: Date.now() };
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(session));
  return session;
}

export function stopActiveSession(): Activity | null {
  const session = loadActiveSession();
  if (!session) return null;
  localStorage.removeItem(ACTIVE_KEY);
  return addActivity({
    sport: session.sport,
    start: session.start,
    end: Date.now(),
    manual: false,
  });
}

export function clearActiveSession(): void {
  localStorage.removeItem(ACTIVE_KEY);
}

/* ---------------- Favorite sports ---------------- */

export function loadFavoriteSports(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(FAVSPORTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function toggleFavoriteSport(id: string): string[] {
  const cur = loadFavoriteSports();
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  localStorage.setItem(FAVSPORTS_KEY, JSON.stringify(next));
  return next;
}

/* ---------------- Day summaries (for calendar) ---------------- */

export type DaySummary = {
  date: string;
  recovery: number | null;
  strain: number;
  sleep: number | null;
  rhr: number;
  hrv: number | null;
  avgStress: number;
  hrAvg: number;
  hrMin: number;
  hrMax: number;
};

type SummaryStore = Record<string, DaySummary>;

function readSummaries(): SummaryStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SUMMARY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveDaySummary(s: DaySummary): void {
  const all = readSummaries();
  all[s.date] = s;
  // keep ~180 days of tiny summaries
  const keys = Object.keys(all).sort();
  while (keys.length > 180) delete all[keys.shift()!];
  localStorage.setItem(SUMMARY_KEY, JSON.stringify(all));
}

export function loadDaySummary(date: string): DaySummary | null {
  return readSummaries()[date] ?? null;
}

export function loadSummaries(): SummaryStore {
  return readSummaries();
}
