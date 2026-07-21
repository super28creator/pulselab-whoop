/** Whoop 5 frame reassembly + historical sync (type 47/49). */

import { buildWhoop5Frame, UUID } from "./whoop";

export type BioSample = {
  t: number;
  bpm: number;
  rrMs?: number[];
  accelG?: [number, number, number];
  skinTempRaw?: number;
  motion?: number;
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

export type WhoopFrame = {
  ok: boolean;
  packetType: number;
  seq: number;
  cmd: number;
  payload: Uint8Array;
  record: Uint8Array;
};

/** Incremental AA 01 … frame splitter for fragmented BLE notifies. */
export class FrameReassembler {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array): WhoopFrame[] {
    const next = new Uint8Array(this.buf.length + chunk.length);
    next.set(this.buf);
    next.set(chunk, this.buf.length);
    this.buf = next;
    const out: WhoopFrame[] = [];
    while (this.buf.length >= 8) {
      let start = -1;
      for (let i = 0; i < this.buf.length - 1; i++) {
        if (this.buf[i] === 0xaa && this.buf[i + 1] === 0x01) {
          start = i;
          break;
        }
      }
      if (start < 0) {
        this.buf = new Uint8Array(0);
        break;
      }
      if (start > 0) this.buf = this.buf.slice(start);
      if (this.buf.length < 8) break;
      const decl = this.buf[2]! | (this.buf[3]! << 8);
      const total = decl + 8;
      if (this.buf.length < total) break;
      const frame = this.buf.slice(0, total);
      this.buf = this.buf.slice(total);
      const parsed = parseWhoopFrame(frame);
      if (parsed) out.push(parsed);
    }
    return out;
  }
}

export function parseWhoopFrame(data: Uint8Array): WhoopFrame | null {
  if (data.length < 12 || data[0] !== 0xaa || data[1] !== 0x01) return null;
  const decl = data[2]! | (data[3]! << 8);
  if (data.length < decl + 8) return null;
  const head = data.slice(0, 6);
  const c16 = data[6]! | (data[7]! << 8);
  const crc16Ok = crc16Modbus(head) === c16;
  const inner = data.slice(8, 8 + decl);
  if (inner.length < 7) return null;
  const record = inner.slice(0, inner.length - 4);
  const gotCrc =
    inner[inner.length - 4]! |
    (inner[inner.length - 3]! << 8) |
    (inner[inner.length - 2]! << 16) |
    (inner[inner.length - 1]! << 24);
  const crc32Ok = (gotCrc >>> 0) === crc32(record);
  if (record.length < 3) return null;
  return {
    ok: crc16Ok && crc32Ok,
    packetType: record[0]!,
    seq: record[1]!,
    cmd: record[2]!,
    payload: record.slice(3),
    record,
  };
}

/** R24-like historical biometric second (OpenStrap field map). */
export function parseR24(inner: Uint8Array): BioSample | null {
  // Accept record starting at type byte, or payload-only
  let blob = inner;
  if (blob[0] === 47 && blob.length > 55) {
    /* keep with type */
  } else if (blob.length >= 3 && blob[0] === 47) {
    /* keep */
  }
  const tryBlobs = [blob, blob.length > 3 ? blob.slice(3) : blob];
  for (const b of tryBlobs) {
    if (b.length < 72) continue;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const ts = dv.getUint32(7, true);
    if (ts < 1_500_000_000 || ts > 2_200_000_000) continue;
    const version = b[1]!;
    const hrOff = ({ 7: 27, 9: 17, 12: 17, 18: 14, 24: 17 } as Record<number, number>)[version] ?? 17;
    if (hrOff >= b.length) continue;
    const hr = b[hrOff]!;
    if (hr !== 0 && (hr < 25 || hr > 230)) continue;
    const rrCount = b[18] ?? 0;
    const rrMs: number[] = [];
    for (let i = 0; i < Math.min(rrCount, 4); i++) {
      const v = dv.getInt16(19 + 2 * i, true);
      if (v >= 250 && v <= 2000) rrMs.push(v);
    }
    const ax = dv.getFloat32(36, true);
    const ay = dv.getFloat32(40, true);
    const az = dv.getFloat32(44, true);
    const skinTempRaw = b.length >= 70 ? dv.getUint16(68, true) : undefined;
    if (!hr) continue;
    return {
      t: ts * 1000,
      bpm: hr,
      rrMs: rrMs.length ? rrMs : undefined,
      accelG: [round4(ax), round4(ay), round4(az)],
      skinTempRaw,
    };
  }
  return null;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Motion proxy from type-43 IMU payload (FINDINGS layout). */
export function motionFromImuPayload(payload: Uint8Array): { bpm?: number; motion: number } | null {
  if (payload.length < 682) return null;
  const hr = payload[14]!;
  const bpm = hr >= 25 && hr <= 230 ? hr : undefined;
  const scale = 3900;
  let sum = 0;
  const n = 20; // subsample for speed
  for (let i = 0; i < n; i++) {
    const off = Math.floor((i * 100) / n);
    const ax = new DataView(payload.buffer, payload.byteOffset + 82 + 2 * off, 2).getInt16(0, true);
    const ay = new DataView(payload.buffer, payload.byteOffset + 282 + 2 * off, 2).getInt16(0, true);
    const az = new DataView(payload.buffer, payload.byteOffset + 482 + 2 * off, 2).getInt16(0, true);
    sum += Math.sqrt(ax * ax + ay * ay + az * az) / scale;
  }
  return { bpm, motion: Math.round((sum / n) * 1000) / 1000 };
}

export function cmdSetClock(seq = 1, now = Date.now()): Uint8Array {
  const sec = Math.floor(now / 1000);
  const subsec = Math.floor(((now % 1000) * 32768) / 1000);
  const payload = new Uint8Array(8);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, sec, true);
  dv.setUint16(4, subsec, true);
  return buildWhoop5Frame(35, seq, 10, payload);
}

export function cmdHistoryAck(seq: number, endData8: Uint8Array): Uint8Array {
  const payload = new Uint8Array(9);
  payload[0] = 0x01;
  payload.set(endData8.slice(0, 8), 1);
  return buildWhoop5Frame(35, seq, 23, payload);
}

export function cmdSendHistorical(seq = 1): Uint8Array {
  return buildWhoop5Frame(35, seq, 22, new Uint8Array([0x00]));
}

/** Extract 8-byte HISTORY_END token for ACK (Whoop 4/5 offsets). */
export function historyEndToken(payload: Uint8Array): Uint8Array | null {
  if (payload.length >= 18) {
    // Preferred: bytes at trim_cursor region (off 10..18)
    return payload.slice(10, 18);
  }
  if (payload.length >= 8) return payload.slice(payload.length - 8);
  return null;
}

export type SyncProgress = {
  status: string;
  records: number;
  chunks: number;
  done: boolean;
  error?: string;
};

type WriteFn = (buf: Uint8Array, withResponse?: boolean) => Promise<void>;

/**
 * Run historical offload. Caller must already be subscribed to FD4B notifies
 * and pass every notify chunk into onNotify.
 */
export function createHistorySync(write: WriteFn, onSample: (s: BioSample) => void) {
  const reasm = new FrameReassembler();
  let seq = 2;
  let records = 0;
  let chunks = 0;
  let complete = false;
  let listeners: Array<(p: SyncProgress) => void> = [];

  const emit = (status: string, extra?: Partial<SyncProgress>) => {
    const p: SyncProgress = { status, records, chunks, done: complete, ...extra };
    listeners.forEach((l) => l(p));
  };

  const onNotify = async (chunk: Uint8Array) => {
    const frames = reasm.push(chunk);
    for (const f of frames) {
      if (!f.ok) continue;
      // type 47 historical
      if (f.packetType === 47) {
        const bio = parseR24(f.record) ?? parseR24(f.payload);
        if (bio) {
          onSample(bio);
          records++;
          if (records % 25 === 0) emit(`Pobieram… ${records} rekordów`);
        }
      }
      // type 49 metadata
      if (f.packetType === 49 || f.packetType === 56) {
        const meta = f.cmd; // 1 start, 2 end, 3 complete (common mapping)
        if (meta === 2) {
          const token = historyEndToken(f.payload);
          if (token) {
            // Persist first (caller already got samples via onSample), then ACK
            await write(cmdHistoryAck(seq++ & 0xff, token), true);
            chunks++;
            emit(`Chunk ${chunks} OK · ${records} rekordów`);
          }
        }
        if (meta === 3) {
          complete = true;
          emit("Historia pobrana", { done: true });
        }
      }
      // type 43 live IMU while connected
      if (f.packetType === 43) {
        const m = motionFromImuPayload(f.payload);
        if (m?.bpm) {
          onSample({ t: Date.now(), bpm: m.bpm, motion: m.motion });
        }
      }
    }
  };

  const start = async () => {
    complete = false;
    records = 0;
    chunks = 0;
    emit("Ustawiam zegar opaski…");
    await write(cmdSetClock(seq++ & 0xff), true);
    await sleep(200);
    emit("Wyłączam IMU (żeby zwolnić łącze)…");
    await write(buildWhoop5Frame(35, seq++ & 0xff, 63, new Uint8Array([0x00])), true);
    await sleep(300);
    emit("Start pobierania historii…");
    await write(cmdSendHistorical(seq++ & 0xff), true);
    // Wait up to 3 min for HISTORY_COMPLETE
    const deadline = Date.now() + 180_000;
    while (!complete && Date.now() < deadline) {
      await sleep(500);
    }
    if (!complete) {
      if (records > 0) {
        complete = true;
        emit(`Koniec (timeout) · ${records} rekordów`, { done: true });
      } else {
        emit("Brak historii / sync nie ruszył", {
          done: true,
          error:
            "Opaska nie wysłała type47. Zostaw nRF Disconnect, połącz przez PulseLab (Bluefy/Chrome) i spróbuj ponownie. Albo opaska ma pustą pamięć.",
        });
      }
    }
    // Restore live streams
    await write(buildWhoop5Frame(35, seq++ & 0xff, 3, new Uint8Array([0x01])));
    await write(buildWhoop5Frame(35, seq++ & 0xff, 63, new Uint8Array([0x01])));
  };

  return {
    onNotify,
    start,
    subscribe: (fn: (p: SyncProgress) => void) => {
      listeners.push(fn);
      return () => {
        listeners = listeners.filter((x) => x !== fn);
      };
    },
    get UUID() {
      return UUID;
    },
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
