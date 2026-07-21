/** Phone GPS track for outdoor sports (running, cycling, …). */

export type GpsPoint = {
  t: number;
  lat: number;
  lon: number;
  acc?: number;
};

export type GpsTrack = {
  points: GpsPoint[];
  distanceM: number;
};

const R = 6371000; // earth radius m

export function haversineM(a: GpsPoint, b: GpsPoint): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function distanceOfTrack(points: GpsPoint[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    // Skip huge GPS jumps (tunnels / bad lock)
    const step = haversineM(prev, cur);
    if (step < 80) d += step;
  }
  return d;
}

/** Sports that should record GPS when started live. */
export function sportNeedsGps(sportId: string): boolean {
  return [
    "running",
    "cycling",
    "walking",
    "hiking",
    "football",
    "rollerblading",
    "skiing",
    "snowboard",
    "walk_dog",
  ].includes(sportId);
}

export function formatKm(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

/** Pace min/km from distance + elapsed ms. */
export function formatPace(meters: number, elapsedMs: number): string {
  if (meters < 30 || elapsedMs < 5000) return "—";
  const minPerKm = elapsedMs / 60000 / (meters / 1000);
  if (!Number.isFinite(minPerKm) || minPerKm > 30) return "—";
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${String(s).padStart(2, "0")} /km`;
}

export type GpsWatcher = {
  stop: () => GpsTrack;
  getTrack: () => GpsTrack;
};

/**
 * Start watchPosition. Returns controller; call stop() to end and get final track.
 */
export function startGpsWatch(
  onUpdate?: (track: GpsTrack) => void,
): GpsWatcher | null {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;

  const points: GpsPoint[] = [];
  let watchId = -1;

  const emit = () => {
    const track = { points: [...points], distanceM: distanceOfTrack(points) };
    onUpdate?.(track);
  };

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      if (accuracy != null && accuracy > 45) return; // ignore rough fixes
      const last = points[points.length - 1];
      // Debounce near-duplicates
      if (
        last &&
        haversineM(last, { t: 0, lat: latitude, lon: longitude }) < 3 &&
        pos.timestamp - last.t < 2000
      ) {
        return;
      }
      points.push({
        t: pos.timestamp || Date.now(),
        lat: latitude,
        lon: longitude,
        acc: accuracy ?? undefined,
      });
      emit();
    },
    () => {
      /* permission denied / unavailable — keep going without GPS */
    },
    {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 15000,
    },
  );

  return {
    stop: () => {
      if (watchId >= 0) navigator.geolocation.clearWatch(watchId);
      return { points: [...points], distanceM: distanceOfTrack(points) };
    },
    getTrack: () => ({ points: [...points], distanceM: distanceOfTrack(points) }),
  };
}

/* ---- Shared session GPS (page + activities tab) ---- */

let sessionWatcher: GpsWatcher | null = null;
let sessionTrack: GpsTrack = { points: [], distanceM: 0 };
const sessionListeners = new Set<(t: GpsTrack) => void>();

function notifyGps() {
  for (const l of sessionListeners) l(sessionTrack);
}

export function subscribeGps(cb: (t: GpsTrack) => void): () => void {
  sessionListeners.add(cb);
  cb(sessionTrack);
  return () => {
    sessionListeners.delete(cb);
  };
}

/** Start GPS for outdoor sports; no-op if sport doesn't need it. */
export function beginGpsIfNeeded(sportId: string): boolean {
  if (!sportNeedsGps(sportId)) return false;
  endGps();
  sessionTrack = { points: [], distanceM: 0 };
  sessionWatcher = startGpsWatch((t) => {
    sessionTrack = t;
    notifyGps();
  });
  notifyGps();
  return sessionWatcher != null;
}

export function endGps(): GpsTrack {
  const final = sessionWatcher ? sessionWatcher.stop() : sessionTrack;
  sessionWatcher = null;
  sessionTrack = { points: [], distanceM: 0 };
  notifyGps();
  return final;
}

export function peekGps(): GpsTrack {
  return sessionWatcher ? sessionWatcher.getTrack() : sessionTrack;
}
