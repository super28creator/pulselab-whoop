/** Pull battery % from standard 2A19 or Whoop5 frames. */

export function batteryFrom2a19(data: DataView | Uint8Array): number | null {
  const v = data instanceof DataView ? data.getUint8(0) : data[0];
  if (v == null || v > 100) return null;
  return v;
}

/**
 * Scan Whoop AA01 frame for battery:
 * - COMMAND_RESPONSE (36) GET_BATTERY (26) → payload[0]
 * - EVENT (48) BATTERY_LEVEL (3) → u16 LE / 10
 */
export function batteryFromWhoopFrame(bytes: Uint8Array): number | null {
  if (bytes.length < 12 || bytes[0] !== 0xaa || bytes[1] !== 0x01) return null;
  const decl = bytes[2]! | (bytes[3]! << 8);
  if (bytes.length < decl + 8 || decl < 7) return null;
  const inner = bytes.slice(8, 8 + decl);
  const record = inner.slice(0, Math.max(0, inner.length - 4));
  if (record.length < 3) return null;
  const pkt = record[0]!;
  const cmd = record[2]!;
  const payload = record.slice(3);

  // COMMAND_RESPONSE get_battery
  if ((pkt === 36 || pkt === 38) && cmd === 26 && payload.length >= 1) {
    const pct = payload[0]!;
    if (pct <= 100) return pct;
  }

  // EVENT BATTERY_LEVEL
  if (pkt === 48 && cmd === 3) {
    for (let off = 0; off + 1 < payload.length; off++) {
      const v = payload[off]! | (payload[off + 1]! << 8);
      if (v >= 100 && v <= 1000) return Math.round(v / 10);
    }
    if (payload.length >= 1 && payload[0]! <= 100) return payload[0]!;
  }

  return null;
}
