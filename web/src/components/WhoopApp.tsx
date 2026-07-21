"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CMD,
  LogRow,
  parseHexLine,
  parseHr2a37,
  rowsToCsv,
  supportsWebBluetooth,
  UUID,
} from "../lib/whoop";

type Status = "idle" | "connecting" | "live" | "error";

function sparkPath(values: number[], w: number, h: number): string {
  if (values.length < 2) return "";
  const min = Math.min(...values) - 2;
  const max = Math.max(...values) + 2;
  const span = Math.max(max - min, 1);
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function WhoopApp() {
  const [status, setStatus] = useState<Status>("idle");
  const [deviceName, setDeviceName] = useState<string>("");
  const [bpm, setBpm] = useState<number | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [error, setError] = useState<string>("");
  const [paste, setPaste] = useState("");
  const [bleOk, setBleOk] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const serverRef = useRef<BluetoothRemoteGATTServer | null>(null);

  useEffect(() => {
    setBleOk(supportsWebBluetooth());
    const ua = navigator.userAgent;
    setIosHint(/iPhone|iPad|iPod/i.test(ua));
  }, []);

  const pushLog = useCallback((row: LogRow) => {
    setLogs((prev) => [row, ...prev].slice(0, 500));
  }, []);

  const onHr = useCallback(
    (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      if (!target.value) return;
      const sample = parseHr2a37(target.value);
      if (!sample) return;
      setBpm(sample.bpm);
      setHistory((h) => [...h.slice(-59), sample.bpm]);
      pushLog({
        t: new Date(sample.at).toISOString(),
        source: "2A37",
        bpm: sample.bpm,
        hex: [...new Uint8Array(target.value.buffer)].map((b) => b.toString(16).padStart(2, "0")).join(""),
      });
    },
    [pushLog],
  );

  const disconnect = useCallback(async () => {
    try {
      deviceRef.current?.gatt?.disconnect();
    } catch {
      /* ignore */
    }
    deviceRef.current = null;
    serverRef.current = null;
    setStatus("idle");
    setDeviceName("");
  }, []);

  const connect = useCallback(async () => {
    setError("");
    if (!supportsWebBluetooth()) {
      setError(
        iosHint
          ? "Safari na iPhonie nie ma Web Bluetooth. Uzyj przegladarki Bluefy (App Store) albo wklej hex z nRF ponizej."
          : "Ta przegladarka nie wspiera Web Bluetooth. Uzyj Chrome na Androidzie.",
      );
      setStatus("error");
      return;
    }

    setStatus("connecting");
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "WHOOP" }, { services: [UUID.hrService] }],
        optionalServices: [
          UUID.customService,
          UUID.hrService,
          UUID.batteryService,
        ],
      });

      deviceRef.current = device;
      setDeviceName(device.name || "WHOOP");
      device.addEventListener("gattserverdisconnected", () => {
        setStatus("idle");
        setError("Rozlaczono z opaska.");
      });

      const server = await device.gatt!.connect();
      serverRef.current = server;

      // Client Hello + realtime HR (Whoop 5)
      try {
        const custom = await server.getPrimaryService(UUID.customService);
        const cmd = await custom.getCharacteristic(UUID.cmdWrite);
        await cmd.writeValueWithoutResponse(CMD.clientHello().buffer as ArrayBuffer);
        await new Promise((r) => setTimeout(r, 200));
        await cmd.writeValueWithoutResponse(CMD.realtimeHrOn().buffer as ArrayBuffer);
      } catch (e) {
        console.warn("Whoop custom write skipped", e);
      }

      // Battery
      try {
        const batSvc = await server.getPrimaryService(UUID.batteryService);
        const batChar = await batSvc.getCharacteristic(UUID.batteryChar);
        const batVal = await batChar.readValue();
        setBattery(batVal.getUint8(0));
      } catch {
        /* optional */
      }

      // Standard HR notify
      const hrSvc = await server.getPrimaryService(UUID.hrService);
      const hrChar = await hrSvc.getCharacteristic(UUID.hrChar);
      await hrChar.startNotifications();
      hrChar.addEventListener("characteristicvaluechanged", onHr);

      setStatus("live");
      pushLog({
        t: new Date().toISOString(),
        source: "system",
        hex: "",
        note: `connected ${device.name}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus("error");
    }
  }, [iosHint, onHr, pushLog]);

  const decodePaste = useCallback(() => {
    const lines = paste.split(/\r?\n/);
    let found = 0;
    for (const line of lines) {
      const bytes = parseHexLine(line);
      if (!bytes) continue;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const sample = parseHr2a37(view);
      if (sample) {
        found++;
        setBpm(sample.bpm);
        setHistory((h) => [...h.slice(-59), sample.bpm]);
        pushLog({
          t: new Date().toISOString(),
          source: "paste",
          bpm: sample.bpm,
          hex: [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""),
        });
      } else if (bytes[0] === 0xaa && bytes[1] === 0x01) {
        pushLog({
          t: new Date().toISOString(),
          source: "whoop5",
          hex: [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""),
          note: "Whoop 5 frame",
        });
        found++;
      }
    }
    if (!found) setError("Nie znaleziono poprawnego hex tętna (np. 00 4A) ani ramki AA 01.");
    else setError("");
  }, [paste, pushLog]);

  const downloadCsv = useCallback(() => {
    const csv = rowsToCsv(logs);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `whoop-log-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logs]);

  const path = useMemo(() => sparkPath(history, 320, 72), [history]);

  return (
    <div className="shell">
      <header className="hero">
        <p className="brand">PULSELAB</p>
        <h1>Whoop 5 — Twoje dane lokalnie</h1>
        <p className="lede">
          Polacz opaske przez Bluetooth albo wklej hex z nRF Connect. Wszystko zostaje na
          telefonie / w CSV — bez chmury Whoop.
        </p>
      </header>

      <section className="hr-stage" aria-live="polite">
        <div className={`pulse ${status === "live" ? "on" : ""}`}>
          <span className="bpm">{bpm ?? "—"}</span>
          <span className="unit">bpm</span>
        </div>
        <svg className="spark" viewBox="0 0 320 72" preserveAspectRatio="none">
          <path d={path} fill="none" stroke="currentColor" strokeWidth="2.5" />
        </svg>
        <div className="meta">
          <span>{deviceName || "brak urzadzenia"}</span>
          <span>{battery != null ? `bateria ${battery}%` : "bateria —"}</span>
          <span className={`st ${status}`}>{status}</span>
        </div>
      </section>

      <section className="actions">
        {status === "live" ? (
          <button type="button" className="btn primary" onClick={disconnect}>
            Rozlacz
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={connect} disabled={status === "connecting"}>
            {status === "connecting" ? "Lacze…" : "Polacz z Whoop"}
          </button>
        )}
        <button type="button" className="btn ghost" onClick={downloadCsv} disabled={!logs.length}>
          Pobierz CSV ({logs.length})
        </button>
      </section>

      {!bleOk && (
        <aside className="banner">
          {iosHint ? (
            <>
              <strong>iPhone:</strong> Safari nie ma Web Bluetooth. Zainstaluj{" "}
              <a href="https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055" target="_blank" rel="noreferrer">
                Bluefy
              </a>{" "}
              i otworz ta strone — albo uzyj trybu wklejania hex z nRF (ponizej).
            </>
          ) : (
            <>Uzyj Chrome / Edge z wlaczonym Bluetoothem.</>
          )}
        </aside>
      )}

      {error && <p className="err">{error}</p>}

      <section className="paste-block">
        <h2>Tryb nRF (iPhone Safari OK)</h2>
        <p>
          W nRF: Notify na <code>2A37</code> → skopiuj Last Read → wklej tutaj.
        </p>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={"00 4A\n00 38\nAA 01 0C 00 ..."}
          rows={5}
        />
        <button type="button" className="btn secondary" onClick={decodePaste}>
          Dekoduj wklejone
        </button>
      </section>

      <section className="log">
        <h2>Log</h2>
        <ul>
          {logs.slice(0, 40).map((r, i) => (
            <li key={`${r.t}-${i}`}>
              <time>{r.t.slice(11, 19)}</time>
              <span>{r.source}</span>
              <strong>{r.bpm != null ? `${r.bpm} bpm` : r.note || r.hex.slice(0, 24)}</strong>
            </li>
          ))}
          {!logs.length && <li className="empty">Brak probek — polacz albo wklej hex.</li>}
        </ul>
      </section>

      <footer className="foot">
        Nieoficjalne narzedzie do wlasnej opaski. Nie jest to produkt Whoop Inc.
      </footer>
    </div>
  );
}
