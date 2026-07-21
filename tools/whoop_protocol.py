#!/usr/bin/env python3
"""Whoop 5.0 BLE framing + decode (no Bluetooth required)."""

from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass
from typing import Optional

# GATT (from your nRF screenshots)
SERVICE = "fd4b0001-cce1-4033-93ce-002d5875f58a"
CMD_WRITE = "fd4b0002-cce1-4033-93ce-002d5875f58a"
CMD_NOTIFY = "fd4b0003-cce1-4033-93ce-002d5875f58a"
EVENT_NOTIFY = "fd4b0004-cce1-4033-93ce-002d5875f58a"
DATA_NOTIFY = "fd4b0005-cce1-4033-93ce-002d5875f58a"
DIAG_NOTIFY = "fd4b0007-cce1-4033-93ce-002d5875f58a"
HR_CHAR = "00002a37-0000-1000-8000-00805f9b34fb"
BATTERY_CHAR = "00002a19-0000-1000-8000-00805f9b34fb"

PACKET_TYPES = {
    35: "COMMAND",
    36: "COMMAND_RESPONSE",
    37: "PUFFIN_COMMAND",
    38: "PUFFIN_COMMAND_RESPONSE",
    40: "REALTIME_DATA",
    43: "REALTIME_RAW_DATA",
    47: "HISTORICAL_DATA",
    48: "EVENT",
    49: "METADATA",
    50: "CONSOLE_LOGS",
    51: "REALTIME_IMU",
    52: "HISTORICAL_IMU",
    53: "RELATIVE_PUFFIN_EVENTS",
    54: "PUFFIN_EVENTS",
    56: "PUFFIN_METADATA",
}

EVENT_NAMES = {
    3: "BATTERY_LEVEL",
    7: "CHARGING_ON",
    8: "CHARGING_OFF",
    9: "WRIST_ON",
    10: "WRIST_OFF",
    13: "RTC_LOST",
    14: "DOUBLE_TAP",
    17: "TEMPERATURE_LEVEL",
    23: "BLE_BONDED",
    33: "BLE_REALTIME_HR_ON",
    34: "BLE_REALTIME_HR_OFF",
    46: "RAW_DATA_COLLECTION_ON",
    47: "RAW_DATA_COLLECTION_OFF",
    60: "HAPTICS_FIRED",
    63: "EXTENDED_BATTERY_INFORMATION",
    96: "HIGH_FREQ_SYNC_PROMPT",
    97: "HIGH_FREQ_SYNC_ENABLED",
    98: "HIGH_FREQ_SYNC_DISABLED",
}

COMMAND_NAMES = {
    1: "LINK_VALID",
    3: "TOGGLE_REALTIME_HR",
    7: "REPORT_VERSION_INFO",
    10: "SET_CLOCK",
    11: "GET_CLOCK",
    22: "SEND_HISTORICAL_DATA",
    26: "GET_BATTERY_LEVEL",
    34: "GET_DATA_RANGE",
    35: "GET_HELLO_HARVARD",
    63: "SEND_R10_R11_REALTIME",
    76: "GET_ADVERTISING_NAME",
    98: "GET_EXTENDED_BATTERY_INFO",
    145: "CLIENT_HELLO",  # Whoop 5 static hello (0x91)
}


def crc32_whoop(data: bytes) -> int:
    return zlib.crc32(data) & 0xFFFFFFFF


def crc16_modbus(data: bytes) -> int:
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc & 0xFFFF


def build_whoop5_frame(pkt_type: int, seq: int, cmd: int, payload: bytes = b"\x00") -> bytes:
    """Build a complete Whoop 5.0 frame for WRITE to FD4B0002."""
    record = bytes([pkt_type & 0xFF, seq & 0xFF, cmd & 0xFF]) + payload
    inner = record + struct.pack("<I", crc32_whoop(record))
    decl = len(inner)
    head = bytes([0xAA, 0x01]) + struct.pack("<H", decl) + bytes([0x00, 0x01])
    return head + struct.pack("<H", crc16_modbus(head)) + inner


def frame_hex(frame: bytes) -> str:
    return " ".join(f"{b:02X}" for b in frame)


# Ready-to-paste commands for nRF Connect → FD4B0002 → Write
NRF_COMMANDS = {
    "client_hello": build_whoop5_frame(35, 1, 145, b"\x01"),
    "get_battery": build_whoop5_frame(35, 1, 26, b"\x00"),
    "realtime_hr_on": build_whoop5_frame(35, 1, 3, b"\x01"),
    "realtime_hr_off": build_whoop5_frame(35, 1, 3, b"\x00"),
    "get_version": build_whoop5_frame(35, 1, 7, b"\x00"),
    "get_data_range": build_whoop5_frame(35, 1, 34, b"\x00"),
    "historical_start": build_whoop5_frame(35, 1, 22, b"\x00"),
}


@dataclass
class ParsedFrame:
    ok: bool
    kind: str
    summary: str
    packet_type: Optional[int] = None
    seq: Optional[int] = None
    cmd: Optional[int] = None
    payload: bytes = b""
    heart_rate_bpm: Optional[float] = None
    rr_ms: Optional[list] = None
    battery_pct: Optional[float] = None
    event_name: Optional[str] = None
    crc16_ok: bool = False
    crc32_ok: bool = False
    raw: bytes = b""


def parse_hr_2a37(data: bytes) -> Optional[ParsedFrame]:
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
    if not (25 <= bpm <= 250):
        return None
    if flags & 0x08:
        idx += 2
    rr: list[float] = []
    while idx + 1 < len(data):
        rr_raw = data[idx] | (data[idx + 1] << 8)
        rr.append(round(rr_raw * 1000 / 1024, 1))
        idx += 2
    parts = [f"tetno={bpm} bpm"]
    if rr:
        parts.append(f"RR={rr} ms")
    return ParsedFrame(
        ok=True,
        kind="BLE_HR",
        summary=", ".join(parts),
        heart_rate_bpm=float(bpm),
        rr_ms=rr or None,
        raw=data,
    )


def parse_battery_2a19(data: bytes) -> Optional[ParsedFrame]:
    if len(data) != 1 or data[0] > 100:
        return None
    return ParsedFrame(
        ok=True,
        kind="BLE_BATTERY",
        summary=f"bateria={data[0]}%",
        battery_pct=float(data[0]),
        raw=data,
    )


def _decode_realtime_payload(payload: bytes) -> tuple[Optional[float], Optional[list]]:
    """Best-effort HR / RR from REALTIME_DATA payload (layout still partially RE)."""
    hr = None
    rr = None
    if len(payload) >= 2:
        # Common community layouts: first byte or u16 LE /100
        if 30 <= payload[0] <= 220:
            hr = float(payload[0])
        elif len(payload) >= 2:
            raw = struct.unpack_from("<H", payload, 0)[0]
            if 3000 <= raw <= 22000:
                hr = raw / 100.0
    if len(payload) >= 4:
        rr_raw = struct.unpack_from("<H", payload, 2)[0]
        if 250 <= rr_raw <= 2000:
            rr = [rr_raw]
    return hr, rr


def _decode_event_extras(payload: bytes, event_code: int) -> dict:
    extra: dict = {}
    # BATTERY_LEVEL: soc% = u16@17 / 10  (offsets relative to full EVENT inner in docs;
    # here payload starts after type/seq/cmd — event code is cmd for type 48)
    if event_code == 3 and len(payload) >= 20:
        # Try flexible scan for plausible battery %
        for off in (0, 1, 4, 8, 12, 14):
            if off + 1 < len(payload):
                v = struct.unpack_from("<H", payload, off)[0]
                if 100 <= v <= 1000:  # 10.0% .. 100.0%
                    extra["battery_pct"] = v / 10.0
                    break
    return extra


def parse_whoop5_frame(data: bytes) -> Optional[ParsedFrame]:
    if len(data) < 12 or data[0] != 0xAA or data[1] != 0x01:
        return None

    decl = struct.unpack_from("<H", data, 2)[0]
    if len(data) < decl + 8:
        return None
    # Allow trailing junk from copy-paste; use exact frame length
    frame = data[: decl + 8]
    if len(frame) != decl + 8:
        return None

    crc16_ok = crc16_modbus(frame[:6]) == struct.unpack_from("<H", frame, 6)[0]
    inner = frame[8 : 8 + decl]
    if len(inner) < 4:
        return None

    record = inner[:-4]
    crc32_ok = struct.unpack_from("<I", inner, len(inner) - 4)[0] == crc32_whoop(record)
    if len(record) < 3:
        return None

    pkt_type, seq, cmd = record[0], record[1], record[2]
    payload = record[3:]
    name = PACKET_TYPES.get(pkt_type, f"TYPE_{pkt_type}")

    hr = None
    rr = None
    battery = None
    event_name = None
    parts = [f"WHOOP5 {name}", f"seq={seq}"]

    if pkt_type in (35, 37):
        cname = COMMAND_NAMES.get(cmd, f"cmd_{cmd}")
        parts.append(cname)
    elif pkt_type in (36, 38):
        cname = COMMAND_NAMES.get(cmd, f"cmd_{cmd}")
        parts.append(f"resp:{cname}")
        if cmd == 26 and payload:
            battery = float(payload[0])
            parts.append(f"bateria={payload[0]}%")
    elif pkt_type == 40:
        hr, rr = _decode_realtime_payload(payload)
        if hr is not None:
            parts.append(f"tetno~{hr:.1f} bpm")
        if rr:
            parts.append(f"RR={rr} ms")
    elif pkt_type == 48:
        event_name = EVENT_NAMES.get(cmd, f"event_{cmd}")
        parts.append(event_name)
        extras = _decode_event_extras(payload, cmd)
        if "battery_pct" in extras:
            battery = extras["battery_pct"]
            parts.append(f"bateria={battery:.1f}%")
    elif pkt_type in (49, 56):
        parts.append("metadata/sync")
    elif pkt_type == 47:
        parts.append(f"historical {len(payload)}B")

    if not crc16_ok or not crc32_ok:
        parts.append(f"CRC16={'OK' if crc16_ok else 'BAD'}")
        parts.append(f"CRC32={'OK' if crc32_ok else 'BAD'}")

    return ParsedFrame(
        ok=crc16_ok and crc32_ok,
        kind="WHOOP5",
        summary=", ".join(parts),
        packet_type=pkt_type,
        seq=seq,
        cmd=cmd,
        payload=payload,
        heart_rate_bpm=hr,
        rr_ms=rr,
        battery_pct=battery,
        event_name=event_name,
        crc16_ok=crc16_ok,
        crc32_ok=crc32_ok,
        raw=frame,
    )


def parse_auto(data: bytes) -> ParsedFrame:
    if data.startswith(b"\xaa\x01"):
        f = parse_whoop5_frame(data)
        if f:
            return f
    if len(data) <= 20:
        h = parse_hr_2a37(data)
        if h:
            return h
    b = parse_battery_2a19(data)
    if b:
        return b
    return ParsedFrame(
        ok=False,
        kind="RAW",
        summary=f"{len(data)} B nierozpoznane",
        raw=data,
    )
