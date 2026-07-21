"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScoreRing, recoveryColor, useSparkPath } from "../components/ScoreRing";
import { DayChart } from "../components/DayChart";
import { CalendarView } from "../components/CalendarView";
import { ActivitiesView } from "../components/ActivitiesView";
import { computeRecovery, emptyBaseline, updateBaseline } from "../lib/metrics/recovery";
import { estimateRestingHr, computeSleepPerformance } from "../lib/metrics/sleep";
import { computeStrain } from "../lib/metrics/strain";
import { stressSeries, averageStress, hrSeries, currentStress, stressBandLabel } from "../lib/metrics/stress";
import { Profile, HrSample, localDateKey, DEFAULT_PROFILE } from "../lib/metrics/types";
import {
  appendSample,
  loadActiveSession,
  loadActivities,
  loadBaseline,
  loadDaySamples,
  loadProfile,
  loadRecentSamples,
  saveBaseline,
  saveDaySummary,
  saveProfile,
  stopActiveSession,
  type ActiveSession,
} from "../lib/store";
import { CMD, UUID } from "../lib/whoop";
import { createHistorySync, type SyncProgress } from "../lib/whoopSync";
import { sportById } from "../lib/sports";

type Tab = "today" | "calendar" | "activities";

function parseHrPacket(data: DataView): { bpm: number; rrMs: number[] } | null {
  if (data.byteLength < 2) return null;
  const flags = data.getUint8(0);
  let idx = 1;
  let bpm: number;
  if (flags & 0x01) {
    if (idx + 1 >= data.byteLength) return null;
    bpm = data.getUint16(idx, true);
    idx += 2;
  } else {
    bpm = data.getUint8(idx++);
  }
  if (bpm < 25 || bpm > 250) return null;
  if (flags & 0x08) idx += 2;
  const rrMs: number[] = [];
  while (idx + 1 < data.byteLength) {
    const raw = data.getUint16(idx, true);
    rrMs.push(Math.round((raw * 1000) / 1024));
    idx += 2;
  }
  return { bpm, rrMs };
}

function dayStartMs(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("today");
  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [deviceName, setDeviceName] = useState("");
  const [bpm, setBpm] = useState<number | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const [hrSpark, setHrSpark] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [bleOk, setBleOk] = useState(false);
  const [iosHint, setIosHint] = useState(false);
  const [profile, setProfile] = useState<Profile>({ ...DEFAULT_PROFILE });
  const [showSettings, setShowSettings] = useState(false);
  const [tick, setTick] = useState(0);
  const [syncInfo, setSyncInfo] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const cmdCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const syncRef = useRef<ReturnType<typeof createHistorySync> | null>(null);
  const lastRecomputeRef = useRef(0);
  const autoSyncedRef = useRef(false);
  const path = useSparkPath(hrSpark, 140, 40);

  const isToday = selectedDate === localDateKey();
  const recompute = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    setBleOk(typeof navigator !== "undefined" && "bluetooth" in navigator);
    setIosHint(/iPhone|iPad|iPod/i.test(navigator.userAgent));
    setProfile(loadProfile());
    setActive(loadActiveSession());
  }, []);

  // Timer only for live banner — NOT for charts/metrics (was causing lag)
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  // Refresh live chart segment every 30s only
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => recompute(), 30_000);
    return () => clearInterval(id);
  }, [active, recompute]);

  const metrics = useMemo(() => {
    const daySamples = loadDaySamples(selectedDate);
    const recent = isToday ? loadRecentSamples(2) : daySamples;
    const rhr = estimateRestingHr(recent, profile.restingHrHint ?? 58);
    const strain = computeStrain(daySamples, rhr, profile);
    const prevKey = (() => {
      const [y, m, d] = selectedDate.split("-").map(Number);
      return localDateKey(new Date(y, m - 1, d - 1).getTime());
    })();
    const yStrain = computeStrain(loadDaySamples(prevKey), rhr, profile).strain;
    const sleep = computeSleepPerformance(recent, rhr, profile, yStrain);
    const baseline = loadBaseline();
    const recovery = computeRecovery(recent, rhr, sleep, baseline.nights ? baseline : emptyBaseline());

    const stress = stressSeries(daySamples, rhr, profile);
    const hr = hrSeries(daySamples);
    return {
      strain,
      sleep,
      recovery,
      rhr,
      stress,
      hr,
      avgStress: averageStress(stress),
      nowStress: currentStress(stress),
      count: daySamples.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, tick, bpm, status, selectedDate, isToday]);

  // Persist compact day summary for calendar (debounced via count gate)
  useEffect(() => {
    if (metrics.count < 5) return;
    const hrVals = metrics.hr.map((p) => p.bpm);
    saveDaySummary({
      date: selectedDate,
      recovery: metrics.recovery.provisional ? null : metrics.recovery.recovery,
      strain: metrics.strain.strain,
      sleep: metrics.sleep.provisional ? null : metrics.sleep.performance,
      rhr: metrics.rhr,
      hrv: metrics.recovery.hrvMs,
      avgStress: metrics.avgStress,
      hrAvg: hrVals.length ? Math.round(hrVals.reduce((a, b) => a + b, 0) / hrVals.length) : 0,
      hrMin: hrVals.length ? Math.min(...hrVals) : 0,
      hrMax: hrVals.length ? Math.max(...hrVals) : 0,
    });
    // only when day / key metrics change — not every bpm
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, metrics.count, metrics.strain.strain, metrics.recovery.recovery, metrics.sleep.performance]);

  useEffect(() => {
    const { sleep, recovery, rhr } = metrics;
    if (!isToday || sleep.provisional || recovery.hrvMs == null) return;
    const flag = `pulselab.baseline.${localDateKey()}`;
    if (sessionStorage.getItem(flag)) return;
    saveBaseline(updateBaseline(loadBaseline(), recovery.hrvMs, rhr));
    sessionStorage.setItem(flag, "1");
    recompute();
  }, [metrics, recompute, isToday]);

  const ingest = useCallback(
    (sample: HrSample) => {
      appendSample(sample);
      setBpm(sample.bpm);
      setHrSpark((h) => [...h.slice(-80), sample.bpm]);
      const now = Date.now();
      // Throttle heavy metric recompute — was freezing UI on every BLE packet
      if (now - lastRecomputeRef.current > 4000) {
        lastRecomputeRef.current = now;
        recompute();
      }
    },
    [recompute],
  );

  const onHr = useCallback(
    (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      if (!target.value) return;
      const parsed = parseHrPacket(target.value);
      if (!parsed) return;
      ingest({ t: Date.now(), bpm: parsed.bpm, rrMs: parsed.rrMs.length ? parsed.rrMs : undefined });
    },
    [ingest],
  );

  const disconnect = useCallback(() => {
    try {
      deviceRef.current?.gatt?.disconnect();
    } catch {
      /* ignore */
    }
    deviceRef.current = null;
    cmdCharRef.current = null;
    syncRef.current = null;
    autoSyncedRef.current = false;
    setStatus("idle");
    setDeviceName("");
    setSyncing(false);
  }, []);

  const connect = useCallback(async () => {
    setError("");
    setSyncInfo("");
    if (!("bluetooth" in navigator)) {
      setError(iosHint ? "Safari nie łączy BLE — użyj Bluefy." : "Potrzebny Chrome z Bluetoothem.");
      setStatus("error");
      return;
    }
    setStatus("connecting");
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "WHOOP" }, { services: [UUID.hrService] }],
        optionalServices: [UUID.customService, UUID.hrService, UUID.batteryService],
      });
      deviceRef.current = device;
      setDeviceName(device.name || "WHOOP");
      device.addEventListener("gattserverdisconnected", () => {
        setStatus("idle");
        setSyncing(false);
      });
      const server = await device.gatt!.connect();

      const writeCmd = async (buf: Uint8Array, withResponse = false) => {
        const ch = cmdCharRef.current;
        if (!ch) throw new Error("Brak FD4B0002");
        const data = buf as unknown as BufferSource;
        if (withResponse) await ch.writeValue(data);
        else {
          try {
            await ch.writeValueWithoutResponse(data);
          } catch {
            await ch.writeValue(data);
          }
        }
      };

      const sync = createHistorySync(writeCmd, (s) => {
        appendSample(s);
        if (s.bpm) {
          setBpm(s.bpm);
          setHrSpark((h) => [...h.slice(-80), s.bpm]);
        }
      });
      sync.subscribe((p: SyncProgress) => {
        if (p.error) setSyncInfo(p.error);
        else if (!p.done) setSyncInfo(p.status);
        else {
          setSyncInfo(p.records > 0 ? `Zsynchronizowano ${p.records} rekordów` : "");
          setSyncing(false);
          lastRecomputeRef.current = Date.now();
          recompute();
          // Clear success message after a few seconds
          setTimeout(() => setSyncInfo(""), 4000);
        }
      });
      syncRef.current = sync;

      try {
        const custom = await server.getPrimaryService(UUID.customService);
        const onWhoopNotify = (ev: Event) => {
          const t = ev.target as BluetoothRemoteGATTCharacteristic;
          if (!t.value) return;
          const bytes = new Uint8Array(t.value.buffer, t.value.byteOffset, t.value.byteLength);
          void sync.onNotify(bytes);
        };
        for (const id of [UUID.dataNotify, UUID.eventNotify, UUID.cmdNotify] as const) {
          try {
            const ch = await custom.getCharacteristic(id);
            await ch.startNotifications();
            ch.addEventListener("characteristicvaluechanged", onWhoopNotify);
          } catch {
            /* bond may be required */
          }
        }
        const cmd = await custom.getCharacteristic(UUID.cmdWrite);
        cmdCharRef.current = cmd;
        await writeCmd(CMD.clientHello());
        await new Promise((r) => setTimeout(r, 300));
        await writeCmd(CMD.realtimeHrOn());
      } catch {
        /* custom service needs bond; 2A37 may still work */
      }
      try {
        const batSvc = await server.getPrimaryService(UUID.batteryService);
        const batChar = await batSvc.getCharacteristic(UUID.batteryChar);
        setBattery((await batChar.readValue()).getUint8(0));
      } catch {
        /* optional */
      }
      const hrSvc = await server.getPrimaryService(UUID.hrService);
      const hrChar = await hrSvc.getCharacteristic(UUID.hrChar);
      await hrChar.startNotifications();
      hrChar.addEventListener("characteristicvaluechanged", onHr);
      setStatus("live");

      // Auto history sync once per connection — no manual button needed
      if (cmdCharRef.current && syncRef.current && !autoSyncedRef.current) {
        autoSyncedRef.current = true;
        setSyncing(true);
        setSyncInfo("Synchronizuję dane z opaski…");
        void syncRef.current.start().catch((e) => {
          setSyncing(false);
          setSyncInfo(e instanceof Error ? e.message : String(e));
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [iosHint, onHr, recompute]);

  const saveProf = () => {
    saveProfile(profile);
    setShowSettings(false);
    recompute();
  };

  const { strain, sleep, recovery } = metrics;
  const recColor = recoveryColor(recovery.band);
  const dayStart = dayStartMs(selectedDate);
  const activities = useMemo(() => {
    const list = loadActivities(selectedDate);
    if (active && isToday) {
      list.push({
        id: "live",
        sport: active.sport,
        start: active.start,
        end: Date.now(),
        manual: false,
      });
    }
    return list;
    // nowTick intentionally omitted — chart live bar refreshes via 30s recompute
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, tick, active, isToday]);
  const prettyDate = new Date(dayStart).toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const liveElapsed = (() => {
    if (!active) return "";
    const s = Math.max(0, Math.floor((nowTick - active.start) / 1000));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  })();

  const endLive = () => {
    stopActiveSession();
    setActive(null);
    recompute();
  };

  return (
    <div className="app">
      <header className="top">
        <div>
          <p className="brand">PULSELAB</p>
          <p className="sub">
            {deviceName || "Recovery · Strain · Sleep"}
            {battery != null ? ` · ${battery}%` : ""}
            {status === "live" ? " · LIVE" : ""}
          </p>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setShowSettings(true)}
          aria-label="Ustawienia"
        >
          ⚙
        </button>
      </header>

      {tab === "today" && (
        <>
          {!isToday && (
            <div className="viewing-banner">
              <span>{prettyDate}</span>
              <button type="button" onClick={() => setSelectedDate(localDateKey())}>
                Wróć do dziś
              </button>
            </div>
          )}

          {active && isToday && (
            <div className="live-workout">
              <div>
                <p className="live-workout-label">Aktywność w toku</p>
                <p className="live-workout-name">
                  {sportById(active.sport).emoji} {sportById(active.sport).name} · {liveElapsed}
                </p>
              </div>
              <button type="button" className="primary stop-btn" onClick={endLive}>
                Zakończ
              </button>
            </div>
          )}

          <section className="hero-recovery">
            <ScoreRing
              value={recovery.provisional ? 0 : recovery.recovery}
              max={100}
              size={200}
              stroke={12}
              color={recovery.provisional ? "#6b7280" : recColor}
            >
              <p className="label">Recovery</p>
              <p className="big" style={{ color: recovery.provisional ? "#9ca3af" : recColor }}>
                {recovery.provisional ? "—" : `${recovery.recovery}%`}
              </p>
              <p className="hint">
                {recovery.provisional
                  ? "Czekam na noc"
                  : recovery.band === "green"
                    ? "Gotowy"
                    : recovery.band === "yellow"
                      ? "Umiarkowanie"
                      : "Odpoczynek"}
              </p>
            </ScoreRing>
            {recovery.provisional && isToday && (
              <p className="provisional">
                Recovery liczę rano po nocy (≥5.5h snu + kilka nocy baseline).
              </p>
            )}
          </section>

          <section className="duo">
            <div className="card">
              <ScoreRing value={strain.strain} max={21} size={116} stroke={8} color="#00f0ff">
                <p className="label sm">Strain</p>
                <p className="mid cyan">{strain.strain.toFixed(1)}</p>
              </ScoreRing>
              <p className="card-meta">
                {strain.minutesTracked.toFixed(0)} min{strain.minutesTracked < 120 ? " (częściowy)" : ""}
              </p>
            </div>
            <div className="card">
              <ScoreRing
                value={sleep.provisional ? 0 : sleep.performance}
                max={100}
                size={116}
                stroke={8}
                color="#5b8cff"
              >
                <p className="label sm">Sleep</p>
                <p className="mid blue">{sleep.provisional ? "—" : `${sleep.performance}%`}</p>
              </ScoreRing>
              <p className="card-meta">
                {sleep.provisional ? "czekam na noc" : `${sleep.hoursAsleep.toFixed(1)}h / ${sleep.hoursNeeded.toFixed(1)}h`}
              </p>
            </div>
          </section>

          <section className="vitals">
            <div className="vital">
              <span className="v-label">HR</span>
              <span className="v-val">{isToday ? bpm ?? "—" : metrics.hr.at(-1)?.bpm ?? "—"}</span>
              <span className="v-unit">bpm</span>
              {isToday && (
                <svg className="mini-spark" viewBox="0 0 140 40">
                  <path d={path} fill="none" stroke="#16ec92" strokeWidth="2" />
                </svg>
              )}
            </div>
            <div className="vital">
              <span className="v-label">HRV</span>
              <span className="v-val">{recovery.hrvMs ?? "—"}</span>
              <span className="v-unit">ms</span>
            </div>
            <div className="vital">
              <span className="v-label">RHR</span>
              <span className="v-val">{metrics.rhr}</span>
              <span className="v-unit">bpm</span>
            </div>
          </section>

          <section className="charts">
            <DayChart
              title="Poziom stresu"
              unit="0–10 · HRV (RMSSD) + %HRR · wygładzony"
              color="#f5a524"
              points={metrics.stress.map((p) => ({ t: p.t, v: p.level }))}
              dayStart={dayStart}
              yMin={0}
              yMax={10}
              activities={activities}
              headline={
                metrics.nowStress != null
                  ? `${metrics.nowStress.toFixed(1)} · ${stressBandLabel(metrics.nowStress)}`
                  : undefined
              }
            />
            <DayChart
              title="Tętno w ciągu dnia"
              unit="bpm"
              color="#16ec92"
              points={metrics.hr.map((p) => ({ t: p.t, v: p.bpm }))}
              dayStart={dayStart}
              activities={activities}
              headline={metrics.hr.length ? `${metrics.hr.at(-1)?.bpm ?? ""} bpm` : undefined}
            />
          </section>

          {isToday && (
            <section className="actions single">
              {status === "live" ? (
                <button type="button" className="primary" onClick={disconnect}>
                  Rozłącz
                </button>
              ) : (
                <button
                  type="button"
                  className="primary"
                  onClick={connect}
                  disabled={status === "connecting" || syncing}
                >
                  {status === "connecting"
                    ? "Łączę…"
                    : syncing
                      ? "Synchronizuję…"
                      : "Połącz z Whoop"}
                </button>
              )}
            </section>
          )}
          {(syncInfo || syncing) && (
            <p className="provisional">{syncInfo || "Synchronizuję dane z opaski…"}</p>
          )}
          {error && <p className="err">{error}</p>}
          {!bleOk && iosHint && (
            <aside className="banner">iPhone: użyj przeglądarki Bluefy do połączenia BLE.</aside>
          )}
        </>
      )}

      {tab === "calendar" && (
        <CalendarView
          selected={selectedDate}
          onSelect={(d) => {
            setSelectedDate(d);
            setTab("today");
          }}
        />
      )}

      {tab === "activities" && (
        <ActivitiesView
          selectedDate={selectedDate}
          onChange={() => {
            setActive(loadActiveSession());
            recompute();
          }}
        />
      )}

      <nav className="bottom-nav">
        <button
          type="button"
          className={tab === "today" ? "on" : ""}
          onClick={() => setTab("today")}
        >
          <span className="nav-ic">◎</span>
          Dziś
        </button>
        <button
          type="button"
          className={tab === "calendar" ? "on" : ""}
          onClick={() => setTab("calendar")}
        >
          <span className="nav-ic">🗓</span>
          Kalendarz
        </button>
        <button
          type="button"
          className={tab === "activities" ? "on" : ""}
          onClick={() => setTab("activities")}
        >
          <span className="nav-ic">🏃</span>
          Aktywności
        </button>
      </nav>

      {showSettings && (
        <div className="modal" role="dialog" onClick={() => setShowSettings(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Profil</h2>
            <label>
              Wiek
              <input
                type="number"
                min={10}
                max={90}
                value={profile.age}
                onChange={(e) => setProfile({ ...profile, age: Number(e.target.value) || 19 })}
              />
            </label>
            <label>
              Waga (kg)
              <input
                type="number"
                min={30}
                max={200}
                value={profile.weightKg ?? 80}
                onChange={(e) =>
                  setProfile({ ...profile, weightKg: Number(e.target.value) || undefined })
                }
              />
            </label>
            <label>
              Wzrost (cm)
              <input
                type="number"
                min={120}
                max={230}
                value={profile.heightCm ?? 190}
                onChange={(e) =>
                  setProfile({ ...profile, heightCm: Number(e.target.value) || undefined })
                }
              />
            </label>
            <label>
              Płeć (TRIMP)
              <select
                value={profile.sex}
                onChange={(e) => setProfile({ ...profile, sex: e.target.value as Profile["sex"] })}
              >
                <option value="u">Nie podano</option>
                <option value="m">Mężczyzna</option>
                <option value="f">Kobieta</option>
              </select>
            </label>
            <label>
              Tętno spoczynkowe (opcjonalnie)
              <input
                type="number"
                value={profile.restingHrHint ?? ""}
                placeholder="np. 55"
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    restingHrHint: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setShowSettings(false)}>
                Anuluj
              </button>
              <button type="button" className="primary" onClick={saveProf}>
                Zapisz
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
