"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScoreRing, recoveryColor, useSparkPath } from "../components/ScoreRing";
import { computeRecovery, emptyBaseline, updateBaseline } from "../lib/metrics/recovery";
import { estimateRestingHr, computeSleepPerformance } from "../lib/metrics/sleep";
import { computeStrain } from "../lib/metrics/strain";
import { Profile, HrSample, localDateKey } from "../lib/metrics/types";
import {
  appendSample,
  exportCsv,
  loadBaseline,
  loadDaySamples,
  loadProfile,
  loadRecentSamples,
  saveBaseline,
  saveProfile,
} from "../lib/store";

const UUID = {
  customService: "fd4b0001-cce1-4033-93ce-002d5875f58a",
  cmdWrite: "fd4b0002-cce1-4033-93ce-002d5875f58a",
  hrService: "0000180d-0000-1000-8000-00805f9b34fb",
  hrChar: "00002a37-0000-1000-8000-00805f9b34fb",
  batteryService: "0000180f-0000-1000-8000-00805f9b34fb",
  batteryChar: "00002a19-0000-1000-8000-00805f9b34fb",
};

function crc32(data: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function crc16Modbus(data: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!;
    for (let b = 0; b < 8; b++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

function buildWhoop5Frame(pktType: number, seq: number, cmd: number, payload: Uint8Array): ArrayBuffer {
  const record = new Uint8Array(3 + payload.length);
  record[0] = pktType;
  record[1] = seq;
  record[2] = cmd;
  record.set(payload, 3);
  const inner = new Uint8Array(record.length + 4);
  inner.set(record);
  new DataView(inner.buffer).setUint32(record.length, crc32(record), true);
  const head = new Uint8Array(6);
  head[0] = 0xaa;
  head[1] = 0x01;
  new DataView(head.buffer).setUint16(2, inner.length, true);
  head[4] = 0x00;
  head[5] = 0x01;
  const out = new Uint8Array(8 + inner.length);
  out.set(head);
  new DataView(out.buffer).setUint16(6, crc16Modbus(head), true);
  out.set(inner, 8);
  return out.buffer;
}

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

function parseHexLine(line: string): Uint8Array | null {
  const tokens = line.match(/[0-9a-fA-F]{2}/g);
  if (!tokens || tokens.length < 2) return null;
  return new Uint8Array(tokens.map((t) => parseInt(t, 16)));
}

export default function Home() {
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [deviceName, setDeviceName] = useState("");
  const [bpm, setBpm] = useState<number | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const [hrSpark, setHrSpark] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [paste, setPaste] = useState("");
  const [bleOk, setBleOk] = useState(false);
  const [iosHint, setIosHint] = useState(false);
  const [profile, setProfile] = useState<Profile>({ age: 30, sex: "u" });
  const [showSettings, setShowSettings] = useState(false);
  const [tick, setTick] = useState(0);

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const path = useSparkPath(hrSpark, 140, 40);

  const recompute = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    setBleOk(typeof navigator !== "undefined" && "bluetooth" in navigator);
    setIosHint(/iPhone|iPad|iPod/i.test(navigator.userAgent));
    setProfile(loadProfile());
  }, []);

  const metrics = useMemo(() => {
    const today = loadDaySamples();
    const recent = loadRecentSamples(2);
    const rhr = estimateRestingHr(recent, profile.restingHrHint ?? 58);
    const strain = computeStrain(today, rhr, profile);
    const yesterday = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return loadDaySamples(localDateKey(d.getTime()));
    })();
    const yStrain = computeStrain(yesterday, rhr, profile).strain;
    const sleep = computeSleepPerformance(recent, rhr, profile, yStrain);
    let baseline = loadBaseline();
    if (sleep.bedtime && !sleep.provisional && baseline.nights < 60) {
      // Soft-update baseline when we have overnight signal (once per day key handled by nights++)
      // Only bump if last update wasn't today — store flag in session via nights heuristic
    }
    const recovery = computeRecovery(recent, rhr, sleep, baseline.nights ? baseline : emptyBaseline());
    return { strain, sleep, recovery, rhr, todayCount: today.length, baseline };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, tick, bpm, status]);

  // Nightly baseline update once when sleep looks valid
  useEffect(() => {
    const { sleep, recovery, rhr, baseline } = metrics;
    if (sleep.provisional || recovery.hrvMs == null) return;
    const flag = `pulselab.baseline.${localDateKey()}`;
    if (sessionStorage.getItem(flag)) return;
    const next = updateBaseline(baseline, recovery.hrvMs, rhr);
    saveBaseline(next);
    sessionStorage.setItem(flag, "1");
    recompute();
  }, [metrics, recompute]);

  const ingest = useCallback(
    (sample: HrSample) => {
      appendSample(sample);
      setBpm(sample.bpm);
      setHrSpark((h) => [...h.slice(-80), sample.bpm]);
      recompute();
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
    setStatus("idle");
    setDeviceName("");
  }, []);

  const connect = useCallback(async () => {
    setError("");
    if (!("bluetooth" in navigator)) {
      setError(
        iosHint
          ? "Safari nie laczy BLE — uzyj Bluefy albo wklej hex z nRF."
          : "Potrzebny Chrome z Bluetoothem.",
      );
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
      device.addEventListener("gattserverdisconnected", () => setStatus("idle"));
      const server = await device.gatt!.connect();
      try {
        const custom = await server.getPrimaryService(UUID.customService);
        const cmd = await custom.getCharacteristic(UUID.cmdWrite);
        await cmd.writeValueWithoutResponse(buildWhoop5Frame(35, 1, 145, new Uint8Array([0x01])));
        await new Promise((r) => setTimeout(r, 200));
        await cmd.writeValueWithoutResponse(buildWhoop5Frame(35, 1, 3, new Uint8Array([0x01])));
      } catch {
        /* optional */
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [iosHint, onHr]);

  const decodePaste = useCallback(() => {
    let n = 0;
    for (const line of paste.split(/\r?\n/)) {
      const bytes = parseHexLine(line);
      if (!bytes) continue;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const parsed = parseHrPacket(view);
      if (parsed) {
        n++;
        ingest({ t: Date.now() + n * 1000, bpm: parsed.bpm, rrMs: parsed.rrMs });
      }
    }
    setError(n ? "" : "Brak hex tetna (np. 00 4A).");
  }, [paste, ingest]);

  const downloadCsv = useCallback(() => {
    const csv = exportCsv(loadRecentSamples(3));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `pulselab-${localDateKey()}.csv`;
    a.click();
  }, []);

  const saveProf = () => {
    saveProfile(profile);
    setShowSettings(false);
    recompute();
  };

  const { strain, sleep, recovery } = metrics;
  const recColor = recoveryColor(recovery.band);

  return (
    <div className="app">
      <header className="top">
        <div>
          <p className="brand">PULSELAB · v2</p>
          <p className="sub">
            {deviceName || "Whoop 5 lokalnie"}
            {battery != null ? ` · ${battery}%` : ""}
            {status === "live" ? " · LIVE" : ""}
          </p>
        </div>
        <button type="button" className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Ustawienia">
          ⚙
        </button>
      </header>

      <section className="hero-recovery">
        <ScoreRing value={recovery.recovery} max={100} size={200} stroke={12} color={recColor}>
          <p className="label">Recovery</p>
          <p className="big" style={{ color: recColor }}>
            {metrics.todayCount < 30 && recovery.provisional ? "—" : `${recovery.recovery}%`}
          </p>
          <p className="hint">
            {recovery.band === "green" ? "Gotowy" : recovery.band === "yellow" ? "Umiarkowanie" : "Odpoczynek"}
          </p>
        </ScoreRing>
        {recovery.provisional && (
          <p className="provisional">Zbieram baseline (kilka nocy / godzin noszenia) — wynik prowizoryczny</p>
        )}
      </section>

      <section className="duo">
        <div className="card">
          <ScoreRing value={strain.strain} max={21} size={120} stroke={8} color="#00f0ff">
            <p className="label sm">Strain</p>
            <p className="mid cyan">{strain.strain.toFixed(1)}</p>
          </ScoreRing>
          <p className="card-meta">/ 21 · {strain.minutesTracked.toFixed(0)} min</p>
        </div>
        <div className="card">
          <ScoreRing value={sleep.performance} max={100} size={120} stroke={8} color="#5b8cff">
            <p className="label sm">Sleep</p>
            <p className="mid blue">{sleep.provisional && sleep.hoursAsleep < 1 ? "—" : `${sleep.performance}%`}</p>
          </ScoreRing>
          <p className="card-meta">
            {sleep.hoursAsleep > 0
              ? `${sleep.hoursAsleep.toFixed(1)}h / ${sleep.hoursNeeded.toFixed(1)}h`
              : `need ${sleep.hoursNeeded.toFixed(1)}h`}
          </p>
        </div>
      </section>

      <section className="vitals">
        <div className="vital">
          <span className="v-label">HR</span>
          <span className="v-val">{bpm ?? "—"}</span>
          <span className="v-unit">bpm</span>
          <svg className="mini-spark" viewBox="0 0 140 40">
            <path d={path} fill="none" stroke="#16ec92" strokeWidth="2" />
          </svg>
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

      <section className="actions">
        {status === "live" ? (
          <button type="button" className="primary" onClick={disconnect}>
            Rozlacz
          </button>
        ) : (
          <button type="button" className="primary" onClick={connect} disabled={status === "connecting"}>
            {status === "connecting" ? "Lacze…" : "Polacz z Whoop"}
          </button>
        )}
        <button type="button" className="ghost" onClick={downloadCsv}>
          CSV
        </button>
      </section>

      {!bleOk && iosHint && (
        <aside className="banner">iPhone: Bluefy do BLE, albo wklej hex z nRF ponizej.</aside>
      )}
      {error && <p className="err">{error}</p>}

      <section className="paste">
        <h2>Wklej z nRF (2A37)</h2>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} placeholder="00 4A" />
        <button type="button" className="secondary" onClick={decodePaste}>
          Dodaj do dziennika
        </button>
      </section>

      <footer className="foot">
        Strain: Edwards TRIMP → skala 0–21. Recovery: HRV (RMSSD) 60% + RHR 20% + Sleep 20%. Sleep:
        czas vs potrzeba. To otwarte metody fizjologiczne — nie oficjalny algorytm Whoop.
        Bateria BLE ± ok. 2–5%.
      </footer>

      {showSettings && (
        <div className="modal" role="dialog">
          <div className="modal-card">
            <h2>Profil</h2>
            <label>
              Wiek
              <input
                type="number"
                value={profile.age}
                onChange={(e) => setProfile({ ...profile, age: Number(e.target.value) || 30 })}
              />
            </label>
            <label>
              Plec (TRIMP)
              <select
                value={profile.sex}
                onChange={(e) => setProfile({ ...profile, sex: e.target.value as Profile["sex"] })}
              >
                <option value="u">Nie podano</option>
                <option value="m">Mezczyzna</option>
                <option value="f">Kobieta</option>
              </select>
            </label>
            <label>
              RHR hint (opcjonalnie)
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
