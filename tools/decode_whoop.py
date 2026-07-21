#!/usr/bin/env python3
"""
Decode raw Whoop / BLE hex captured on your PHONE (nRF Connect).

Works without PC Bluetooth. Optimized for Whoop 5.0 (service FD4B0001...).

Usage:
  python decode_whoop.py raw_input.example.txt
  python decode_whoop.py --paste
  python decode_whoop.py "AA01 0C00 0100 2711 2447 1744"
"""

from __future__ import annotations

import argparse
import csv
import re
import struct
import sys
import zlib
from dataclasses import dataclass
from pathlib import Path

HEX_TOKEN = re.compile(r"[0-9a-fA-F]{2}")

PACKET_TYPES = {
    36: "COMMAND_RESPONSE",
    40: "REALTIME_DATA",
    43: "REALTIME_RAW_DATA",
    47: "HISTORICAL_DATA",
    48: "EVENT",
    49: "METADATA",
    50: "CONSOLE_LOGS",
}


def parse_hex_line(line: str) -> bytes | None:
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    tokens = HEX_TOKEN.findall(line)
    if not tokens:
        return None
    return bytes(int(t, 16) for t in tokens)


def crc32_whoop(data: bytes) -> int:
    return zlib.crc32(data) & 0xFFFFFFFF


def crc16_modbus(data: bytes) -> int:
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc & 0xFFFF


@dataclass
class DecodeResult:
    kind: str
    summary: str
    details: dict


def decode_hr_2a37(data: bytes) -> DecodeResult | None:
    if len(data) < 2:
        return None

    flags = data[0]
    idx = 1
    if flags & 0x01:
        if idx + 1 >= len(data):
            return None
        bpm = data[idx] | (data[idx + 1] << 8)
        idx += 2
    else:
        bpm = data[idx]
        idx += 1

    if flags & 0x08:
        idx += 2

    rr_ms: list[float] = []
    while idx + 1 < len(data):
        rr_raw = data[idx] | (data[idx + 1] << 8)
        rr_ms.append(round(rr_raw * 1000 / 1024, 1))
        idx += 2

    if not (30 <= bpm <= 220):
        return None

    parts = [f"tetno={bpm} bpm"]
    if rr_ms:
        parts.append(f"RR={rr_ms} ms")
    if flags & 0x02:
        parts.append("czujnik OK")

    return DecodeResult(
        kind="BLE_HR_2A37",
        summary=", ".join(parts),
        details={"bpm": bpm, "rr_ms": rr_ms, "flags": flags},
    )


def decode_whoop5_frame(data: bytes) -> DecodeResult | None:
    """Whoop 5.0 / MG frame: starts with AA 01, CRC16-Modbus header."""
    if len(data) < 12 or data[0] != 0xAA or data[1] != 0x01:
        return None

    decl_len = struct.unpack_from("<H", data, 2)[0]
    expected = decl_len + 8
    if len(data) != expected:
        return None

    crc16_ok = crc16_modbus(data[:6]) == struct.unpack_from("<H", data, 6)[0]
    inner = data[8 : 8 + decl_len]
    if len(inner) < 4:
        return None

    record = inner[:-4]
    crc32_ok = struct.unpack_from("<I", inner, len(inner) - 4)[0] == crc32_whoop(record)

    if len(record) < 3:
        return None

    pkt_type = record[0]
    seq = record[1]
    cmd = record[2]
    payload = record[3:]
    pkt_name = PACKET_TYPES.get(pkt_type, f"type_{pkt_type}")

    parts = [f"WHOOP5 {pkt_name}", f"seq={seq}", f"cmd={cmd}"]
    if not crc16_ok or not crc32_ok:
        parts.append(f"CRC16={'OK' if crc16_ok else 'BAD'}")
        parts.append(f"CRC32={'OK' if crc32_ok else 'BAD'}")

    details: dict = {
        "packet_type": pkt_type,
        "packet_name": pkt_name,
        "seq": seq,
        "cmd": cmd,
        "payload_hex": payload[1:].hex() if len(payload) > 1 else "",
        "crc16_ok": crc16_ok,
        "crc32_ok": crc32_ok,
    }

    # Heurystyki dla REALTIME_DATA (40) — pierwsze bajty payloadu
    if pkt_type == 40 and len(payload) >= 3:
        hr = payload[1] if len(payload) > 1 else None
        if hr and 30 <= hr <= 220:
            parts.append(f"tetno~{hr} bpm")
            details["heart_rate_bpm"] = hr

    if pkt_type == 48 and len(payload) >= 2:
        parts.append(f"event={payload[0]}")
        details["event_code"] = payload[0]

    if pkt_type == 49:
        parts.append("metadata/historical control")

    # ASCII w pakiecie (np. FD4B0007: firmware maverick 50.36.2.0)
    ascii_run = "".join(chr(b) if 32 <= b < 127 else "." for b in data)
    if "maverick" in ascii_run or "50.36" in ascii_run:
        parts.append("info urzadzenia (FW/model)")

    return DecodeResult(
        kind="WHOOP5_FRAME",
        summary=", ".join(parts),
        details=details,
    )


def decode_whoop4_frame(data: bytes) -> DecodeResult | None:
    """Whoop 4.0 frame: AA [len u16] [crc8] ..."""
    if len(data) < 8 or data[0] != 0xAA or data[1] == 0x01:
        return None

    length = struct.unpack_from("<H", data, 1)[0]
    if len(data) != length + 4:
        return None

    inner = data[4:length]
    crc32_ok = struct.unpack_from("<I", data, length)[0] == crc32_whoop(inner)
    pkt_type = data[4]
    seq = data[5]
    cmd = data[6]
    pkt_name = PACKET_TYPES.get(pkt_type, f"type_{pkt_type}")

    return DecodeResult(
        kind="WHOOP4_FRAME",
        summary=f"WHOOP4 {pkt_name}, seq={seq}, cmd={cmd}, CRC32={'OK' if crc32_ok else 'BAD'}",
        details={"packet_type": pkt_type, "seq": seq, "cmd": cmd, "crc32_ok": crc32_ok},
    )


def decode_auto(data: bytes) -> DecodeResult:
    if data.startswith(b"\xaa\x01"):
        w5 = decode_whoop5_frame(data)
        if w5:
            return w5

    if data.startswith(b"\xaa") and len(data) > 1 and data[1] != 0x01:
        w4 = decode_whoop4_frame(data)
        if w4:
            return w4

    if len(data) <= 20:
        h = decode_hr_2a37(data)
        if h:
            return h

    if len(data) == 1 and 0 <= data[0] <= 100:
        return DecodeResult("BATTERY", f"bateria={data[0]}%", {"percent": data[0]})

    return DecodeResult(
        kind="RAW",
        summary=f"{len(data)} bajtow — nie rozpoznano",
        details={"hex": data.hex()},
    )


def decode_lines(lines: list[str]) -> list[tuple[str, bytes, DecodeResult]]:
    out: list[tuple[str, bytes, DecodeResult]] = []
    for line in lines:
        data = parse_hex_line(line)
        if data is None:
            continue
        out.append((line.strip(), data, decode_auto(data)))
    return out


def print_results(rows: list[tuple[str, bytes, DecodeResult]]) -> None:
    if not rows:
        print("Brak hex. Wklej linie z nRF Connect (Last Read / Export log).")
        return

    for i, (_src, data, res) in enumerate(rows, 1):
        print(f"\n--- #{i} ({len(data)} B) [{res.kind}] ---")
        print(f"hex: {data.hex()}")
        print(f"=> {res.summary}")


def write_csv(path: Path, rows: list[tuple[str, bytes, DecodeResult]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["length", "hex", "kind", "summary"])
        for _src, data, res in rows:
            w.writerow([len(data), data.hex(), res.kind, res.summary])
    print(f"\nZapisano: {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Decode Whoop 5.0 / BLE hex from phone")
    parser.add_argument("input", nargs="?", help="File with hex lines")
    parser.add_argument("--paste", action="store_true")
    parser.add_argument("-o", "--csv", type=Path, default=None)
    args = parser.parse_args()

    if args.paste:
        print("Wklej hex. Pusta linia = koniec:")
        lines = []
        while True:
            try:
                line = input()
            except EOFError:
                break
            if not line.strip():
                break
            lines.append(line)
    elif args.input:
        lines = Path(args.input).read_text(encoding="utf-8").splitlines()
    elif len(sys.argv) > 1 and not sys.argv[1].startswith("-"):
        lines = [" ".join(sys.argv[1:])]
    else:
        parser.print_help()
        sys.exit(0)

    rows = decode_lines(lines)
    print_results(rows)
    if args.csv and rows:
        write_csv(args.csv, rows)


if __name__ == "__main__":
    main()
