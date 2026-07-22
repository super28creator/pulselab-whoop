import { UUID } from "../whoop";

export type WhoopHandlers = {
  onHr: (value: DataView) => void;
  onWhoopNotify: (bytes: Uint8Array) => void;
  onBattery: (pct: number) => void;
  onDisconnected: () => void;
};

export type WhoopSession = {
  deviceName: string;
  native: boolean;
  writeCmd: (buf: Uint8Array, withResponse?: boolean) => Promise<void>;
  readBattery: () => Promise<DataView | null>;
  disconnect: () => Promise<void>;
};

export const WHOOP_OPTIONAL_SERVICES = [
  UUID.customService,
  UUID.hrService,
  UUID.batteryService,
] as const;

export function bytesFromDataView(dv: DataView): Uint8Array {
  return new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
}

export function dataViewFromBytes(buf: Uint8Array): DataView {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}
