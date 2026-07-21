"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

function parseHr(data: DataView): number | null {
  if (data.byteLength < 2) return null;
  const flags = data.getUint8(0);
  let idx = 1;
  const bpm = flags & 0x01 ? data.getUint16(idx, true) : data.getUint8(idx);
  return bpm >= 25 && bpm <= 250 ? bpm : null;
}

function parseHexLine(line: string): Uint8Array | null {
  const tokens = line.match(/[0-9a-fA-F]{2}/g);
  if (!tokens || tokens.length < 2) return null;
  return new Uint8Array(tokens.map((t) => parseInt(t, 16)));
}

type LogRow = { t: string; source: string; bpm?: number; note?: string };

export default function Home() {
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [deviceName, setDeviceName] = useState("");
  const [bpm, setBpm] = useState<number | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [error, setError] = useState("");
  const [paste, setPaste] = useState("");
  const [bleOk, setBleOk] = useState(false);
  const [iosHint, setIosHint] = useState(false);
  const deviceRef = useRef<BluetoothDevice | null>(null);

  useEffect(() => {
    setBleOk(typeof navigator !== "undefined" && "bluetooth" in navigator);
    setIosHint(/iPhone|iPad|iPod/i.test(navigator.userAgent));
  }, []);

  const pushLog = useCallback((row: LogRow) => {
    setLogs((prev) => [row, ...prev].slice(0, 400));
  }, []);

  const onHr = useCallback(
    (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      if (!target.value) return;
      const v = parseHr(target.value);
      if (v == null) return;
      setBpm(v);
      setHistory((h) => [...h.slice(-59), v]);
      pushLog({ t: new Date().toISOString(), source: "2A37", bpm: v });
    },
    [pushLog],
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
          ? "Safari nie ma Web Bluetooth. Uzyj Bluefy albo wklej hex z nRF ponizej."
          : "Uzyj Chrome na Androidzie z Bluetoothem.",
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
        await cmd.writeValueWithoutResponse(
          buildWhoop5Frame(35, 1, 145, new Uint8Array([0x01])),
        );
        await new Promise((r) => setTimeout(r, 200));
        await cmd.writeValueWithoutResponse(
          buildWhoop5Frame(35, 1, 3, new Uint8Array([0x01])),
        );
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
      pushLog({ t: new Date().toISOString(), source: "system", note: `connected ${device.name}` });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [iosHint, onHr, pushLog]);

  const decodePaste = useCallback(() => {
    let found = 0;
    for (const line of paste.split(/\r?\n/)) {
      const bytes = parseHexLine(line);
      if (!bytes) continue;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const v = parseHr(view);
      if (v != null) {
        found++;
        setBpm(v);
        setHistory((h) => [...h.slice(-59), v]);
        pushLog({ t: new Date().toISOString(), source: "paste", bpm: v });
      } else if (bytes[0] === 0xaa && bytes[1] === 0x01) {
        found++;
        pushLog({ t: new Date().toISOString(), source: "whoop5", note: "frame OK" });
      }
    }
    setError(found ? "" : "Brak poprawnego hex (np. 00 4A).");
  }, [paste, pushLog]);

  const downloadCsv = useCallback(() => {
    const csv = ["timestamp,source,bpm,note", ...logs.map((r) => `${r.t},${r.source},${r.bpm ?? ""},${r.note ?? ""}`)].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `whoop-${Date.now()}.csv`;
    a.click();
  }, [logs]);

  const spark = useMemo(() => {
    if (history.length < 2) return "";
    const min = Math.min(...history) - 2;
    const max = Math.max(...history) + 2;
    const span = Math.max(max - min, 1);
    return history
      .map((v, i) => {
        const x = (i / (history.length - 1)) * 320;
        const y = 72 - ((v - min) / span) * 72;
        return `${i === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");
  }, [history]);

  return (
    <main className="shell">
      <p className="brand">PULSELAB</p>
      <h1>Whoop 5 — Twoje dane lokalnie</h1>
      <p className="lede">Polacz opaske albo wklej hex z nRF. Bez chmury Whoop.</p>

      <section className="hr">
        <div className={status === "live" ? "pulse on" : "pulse"}>
          <span className="bpm">{bpm ?? "—"}</span>
          <span className="unit">bpm</span>
        </div>
        <svg viewBox="0 0 320 72" className="spark">
          <path d={spark} fill="none" stroke="currentColor" strokeWidth="2.5" />
        </svg>
        <div className="meta">
          <span>{deviceName || "brak urzadzenia"}</span>
          <span>{battery != null ? `bateria ${battery}%` : "bateria —"}</span>
          <span>{status}</span>
        </div>
      </section>

      <div className="actions">
        {status === "live" ? (
          <button type="button" className="primary" onClick={disconnect}>
            Rozlacz
          </button>
        ) : (
          <button type="button" className="primary" onClick={connect} disabled={status === "connecting"}>
            {status === "connecting" ? "Lacze…" : "Polacz z Whoop"}
          </button>
        )}
        <button type="button" onClick={downloadCsv} disabled={!logs.length}>
          CSV ({logs.length})
        </button>
      </div>

      {!bleOk && (
        <aside className="banner">
          {iosHint ? (
            <>
              iPhone: Safari nie laczy BLE. Zainstaluj Bluefy albo wklej hex z nRF.
            </>
          ) : (
            <>Uzyj Chrome z Bluetoothem.</>
          )}
        </aside>
      )}

      {error && <p className="err">{error}</p>}

      <section className="paste">
        <h2>Tryb nRF (dziala w Safari)</h2>
        <p>Notify na 2A37 → skopiuj Last Read → wklej:</p>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} placeholder={"00 4A\n00 38"} />
        <button type="button" className="secondary" onClick={decodePaste}>
          Dekoduj
        </button>
      </section>

      <section className="log">
        <h2>Log</h2>
        <ul>
          {logs.slice(0, 30).map((r, i) => (
            <li key={`${r.t}-${i}`}>
              <time>{r.t.slice(11, 19)}</time> {r.source}{" "}
              <strong>{r.bpm != null ? `${r.bpm} bpm` : r.note}</strong>
            </li>
          ))}
          {!logs.length && <li>Brak probek</li>}
        </ul>
      </section>
    </main>
  );
}
