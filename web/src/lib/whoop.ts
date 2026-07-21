/** Whoop 5.0 BLE helpers (Web Bluetooth + frame decode). */

export const UUID = {
  customService: "fd4b0001-cce1-4033-93ce-002d5875f58a",
  cmdWrite: "fd4b0002-cce1-4033-93ce-002d5875f58a",
  cmdNotify: "fd4b0003-cce1-4033-93ce-002d5875f58a",
  eventNotify: "fd4b0004-cce1-4033-93ce-002d5875f58a",
  dataNotify: "fd4b0005-cce1-4033-93ce-002d5875f58a",
  hrService: "0000180d-0000-1000-8000-00805f9b34fb",
  hrChar: "00002a37-0000-1000-8000-00805f9b34fb",
  batteryService: "0000180f-0000-1000-8000-00805f9b34fb",
  batteryChar: "00002a19-0000-1000-8000-00805f9b34fb",
} as const;

function crc32(data: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function crc16Modbus(data: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!;
    for (let b = 0; b < 8; b++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}

export function buildWhoop5Frame(
  pktType: number,
  seq: number,
  cmd: number,
  payload: Uint8Array = new Uint8Array([0x00]),
): Uint8Array {
  const record = new Uint8Array(3 + payload.length);
  record[0] = pktType;
  record[1] = seq;
  record[2] = cmd;
  record.set(payload, 3);
  const crc = crc32(record);
  const inner = new Uint8Array(record.length + 4);
  inner.set(record);
  new DataView(inner.buffer).setUint32(record.length, crc, true);

  const head = new Uint8Array(6);
  head[0] = 0xaa;
  head[1] = 0x01;
  new DataView(head.buffer).setUint16(2, inner.length, true);
  head[4] = 0x00;
  head[5] = 0x01;
  const c16 = crc16Modbus(head);
  const out = new Uint8Array(8 + inner.length);
  out.set(head);
  new DataView(out.buffer).setUint16(6, c16, true);
  out.set(inner, 8);
  return out;
}

export const CMD = {
  clientHello: () => buildWhoop5Frame(35, 1, 145, new Uint8Array([0x01])),
  realtimeHrOn: () => buildWhoop5Frame(35, 1, 3, new Uint8Array([0x01])),
  realtimeHrOff: () => buildWhoop5Frame(35, 1, 3, new Uint8Array([0x00])),
  getBattery: () => buildWhoop5Frame(35, 1, 26, new Uint8Array([0x00])),
};

export type HrSample = {
  bpm: number;
  rrMs: number[];
  at: number;
};

export function parseHr2a37(data: DataView): HrSample | null {
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
  return { bpm, rrMs, at: Date.now() };
}

export function parseHexLine(line: string): Uint8Array | null {
  const tokens = line.match(/[0-9a-fA-F]{2}/g);
  if (!tokens || tokens.length < 2) return null;
  return new Uint8Array(tokens.map((t) => parseInt(t, 16)));
}

export function supportsWebBluetooth(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

export type LogRow = {
  t: string;
  source: string;
  bpm?: number;
  hex: string;
  note?: string;
};

export function rowsToCsv(rows: LogRow[]): string {
  const header = "timestamp,source,bpm,hex,note";
  const lines = rows.map((r) =>
    [r.t, r.source, r.bpm ?? "", r.hex, JSON.stringify(r.note ?? "")].join(","),
  );
  return [header, ...lines].join("\n");
}
