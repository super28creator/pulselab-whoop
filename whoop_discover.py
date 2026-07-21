#!/usr/bin/env python3
"""
Whoop BLE discovery + logger.

Why nRF Connect shows a graph but no services/bell:
  - The SCANNER tab only shows advertising packets (RSSI graph, sometimes HR in ad data).
  - GATT services appear only AFTER you tap CONNECT (Client tab).
  - Whoop custom service needs bonding; standard Heart Rate (2A37) works without it.

Usage:
  python whoop_discover.py              # scan + connect + list services + log HR
  python whoop_discover.py --scan-only    # only advertising, no connection
  python whoop_discover.py --address AA:BB:CC:DD:EE:FF
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import signal
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bleak import BleakClient, BleakScanner
from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData
from bleak.backends.characteristic import BleakGATTCharacteristic

# Standard SIG (work unbonded on Whoop)
HR_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb"
HR_MEASUREMENT = "00002a37-0000-1000-8000-00805f9b34fb"
BATTERY_SERVICE = "0000180f-0000-1000-8000-00805f9b34fb"
BATTERY_LEVEL = "00002a19-0000-1000-8000-00805f9b34fb"

# Whoop 4.0 custom service (needs bonding for data stream)
WHOOP4_SERVICE = "61080001-8d6d-82b8-614a-1c8cb0f8dcc6"
WHOOP4_CMD_WRITE = "61080002-8d6d-82b8-614a-1c8cb0f8dcc6"
WHOOP4_CMD_NOTIFY = "61080003-8d6d-82b8-614a-1c8cb0f8dcc6"
WHOOP4_EVENT_NOTIFY = "61080004-8d6d-82b8-614a-1c8cb0f8dcc6"
WHOOP4_DATA_NOTIFY = "61080005-8d6d-82b8-614a-1c8cb0f8dcc6"

# Whoop 5.0 / MG
WHOOP5_SERVICE = "fd4b0001-cce1-4033-93ce-002d5875f58a"
WHOOP5_CMD_WRITE = "fd4b0002-cce1-4033-93ce-002d5875f58a"
WHOOP5_NOTIFIES = [
    "fd4b0003-cce1-4033-93ce-002d5875f58a",
    "fd4b0004-cce1-4033-93ce-002d5875f58a",
    "fd4b0005-cce1-4033-93ce-002d5875f58a",
    "fd4b0007-cce1-4033-93ce-002d5875f58a",
]

OUTPUT_CSV = Path(__file__).with_name("data_log.csv")
_stop = asyncio.Event()
_csv_file: Any = None
_csv_writer: csv.writer | None = None


def _props(char: BleakGATTCharacteristic) -> str:
    names = []
    for flag, label in (
        ("read", "read"),
        ("write", "write"),
        ("write-without-response", "write-no-resp"),
        ("notify", "notify"),
        ("indicate", "indicate"),
        ("broadcast", "broadcast"),
    ):
        if flag in char.properties:
            names.append(label)
    return ",".join(names) or "?"


def _log_csv(source: str, data: bytes) -> None:
    if _csv_writer is None:
        return
    ts = datetime.now(timezone.utc).isoformat()
    _csv_writer.writerow([ts, source, len(data), data.hex(), " ".join(map(str, data))])
    _csv_file.flush()
    print(f"[{ts}] {source}: {len(data)} B | {data.hex()}")


def _setup_csv() -> None:
    global _csv_file, _csv_writer
    new = not OUTPUT_CSV.exists()
    _csv_file = OUTPUT_CSV.open("a", newline="", encoding="utf-8")
    _csv_writer = csv.writer(_csv_file)
    if new:
        _csv_writer.writerow(["timestamp_utc", "source", "length_bytes", "hex", "integers"])
        _csv_file.flush()


def _close_csv() -> None:
    global _csv_file
    if _csv_file:
        _csv_file.close()
        _csv_file = None


def _request_stop(*_args: object) -> None:
    print("\nStopping...")
    _stop.set()


def _parse_hr(data: bytes) -> str:
    """BLE Heart Rate Measurement (0x2A37) — rough decode for console."""
    if not data:
        return "empty"
    flags = data[0]
    idx = 1
    if flags & 0x01:
        if idx + 1 >= len(data):
            return f"flags=0x{flags:02x} (truncated 16-bit HR)"
        bpm = data[idx] | (data[idx + 1] << 8)
        idx += 2
    else:
        if idx >= len(data):
            return f"flags=0x{flags:02x} (truncated 8-bit HR)"
        bpm = data[idx]
        idx += 1
    if flags & 0x08:
        idx += 2  # skip energy expended
    rr: list[float] = []
    while idx + 1 < len(data):
        rr_raw = data[idx] | (data[idx + 1] << 8)
        rr.append(round(rr_raw * 1000 / 1024, 1))
        idx += 2
    extra = f", RR ms={rr}" if rr else ""
    return f"HR={bpm} bpm{extra}"


def _make_notify_handler(source: str):
    def handler(_handle: int, data: bytearray) -> None:
        line = _parse_hr(data) if source == "HR_2A37" else data.hex()
        print(f"  >> {source}: {line}")
        _log_csv(source, bytes(data))

    return handler


async def scan_advertising(name_filter: str | None, timeout: float) -> list[tuple[BLEDevice, AdvertisementData | None]]:
    print(f"Scanning {timeout}s (advertising only — this is what nRF graph shows)...")
    seen: dict[str, tuple[BLEDevice, AdvertisementData | None]] = {}

    def callback(device: BLEDevice, adv: AdvertisementData) -> None:
        if name_filter:
            n = (device.name or adv.local_name or "").casefold()
            if name_filter.casefold() not in n:
                return
        seen[device.address] = (device, adv)

    async with BleakScanner(detection_callback=callback) as scanner:
        await asyncio.sleep(timeout)

    results = list(seen.values())
    if not results:
        print("No matching devices in range.")
        return []

    for device, adv in results:
        name = device.name or (adv.local_name if adv else None) or "(no name)"
        print(f"\n--- {name} [{device.address}] ---")
        if adv:
            print(f"  RSSI: {adv.rssi} dBm  (graph in nRF = mostly this, NOT live GATT)")
            if adv.service_uuids:
                print(f"  Ad service UUIDs: {adv.service_uuids}")
            if adv.service_data:
                for uuid, payload in adv.service_data.items():
                    print(f"  Ad service data {uuid}: {payload.hex()}")
            if adv.manufacturer_data:
                for mid, payload in adv.manufacturer_data.items():
                    print(f"  Manufacturer 0x{mid:04x}: {payload.hex()}")
        else:
            print("  (no advertisement payload captured)")

    return results


async def find_device(name: str | None, address: str | None, timeout: float) -> BLEDevice:
    if address:
        dev = await BleakScanner.find_device_by_address(address, timeout=timeout)
        if dev is None:
            raise RuntimeError(f"Device {address} not found.")
        return dev

    devices = await BleakScanner.discover(timeout=timeout)
    if name:
        needle = name.casefold()
        for d in devices:
            if needle in (d.name or "").casefold():
                return d
    else:
        for d in devices:
            if d.name and "whoop" in d.name.casefold():
                return d

    visible = ", ".join(f"{d.name or '?'} [{d.address}]" for d in devices) or "(none)"
    raise RuntimeError(f"Whoop not found. Visible: {visible}")


async def list_gatt(client: BleakClient) -> None:
    print("\n=== GATT services (after CONNECT — bell icons live here) ===")
    for service in client.services:
        print(f"\nService {service.uuid}")
        for char in service.characteristics:
            print(f"  Char {char.uuid}  [{_props(char)}]  handle={char.handle}")
            for desc in char.descriptors:
                print(f"    Desc {desc.uuid}")


async def try_bond_whoop4(client: BleakClient) -> None:
    """Confirmed write to cmd char triggers Windows pairing / encryption."""
    # Minimal GET_BATTERY-style frame from community RE (Whoop 4.0)
    # Safe read-only probe; exact bytes may vary by firmware.
    probe = bytes.fromhex("aa0800a81a00001147c585")
    try:
        print("\nAttempting Whoop 4.0 bond handshake (write with response)...")
        await client.write_gatt_char(WHOOP4_CMD_WRITE, probe, response=True)
        print("  Write OK — if Windows asked to pair, accept it.")
        await asyncio.sleep(1.0)
    except Exception as exc:
        print(f"  Bond probe failed (maybe Whoop 5.0?): {exc}")


async def subscribe_all_notifies(client: BleakClient, uuids: list[str], prefix: str) -> None:
    for uuid in uuids:
        try:
            await client.start_notify(uuid, _make_notify_handler(f"{prefix}_{uuid[:8]}"))
            print(f"  Subscribed: {uuid}")
        except Exception as exc:
            print(f"  Skip {uuid}: {exc}")


async def run_session(device: BleakClient, bond: bool) -> None:
    await list_gatt(device)

    # Battery (one-shot read)
    try:
        bat = await device.read_gatt_char(BATTERY_LEVEL)
        print(f"\nBattery: {bat[0]}%")
        _log_csv("BATTERY_2A19", bytes(bat))
    except Exception as exc:
        print(f"\nBattery read failed: {exc}")

    # Standard HR — best starting point, no bonding required
    print("\nSubscribing to standard Heart Rate (2A37)...")
    try:
        await device.start_notify(HR_MEASUREMENT, _make_notify_handler("HR_2A37"))
        print("  OK — move wrist / raise HR; you should see HR=... lines.")
    except Exception as exc:
        print(f"  HR notify failed: {exc}")

    if bond:
        services = {s.uuid.casefold() for s in device.services}
        if WHOOP4_SERVICE.casefold() in services:
            await try_bond_whoop4(device)
            await subscribe_all_notifies(
                device,
                [WHOOP4_CMD_NOTIFY, WHOOP4_EVENT_NOTIFY, WHOOP4_DATA_NOTIFY],
                "WHOOP4",
            )
        elif WHOOP5_SERVICE.casefold() in services:
            print("\nWhoop 5.0 detected — custom notify channels (bond may be required).")
            await subscribe_all_notifies(device, WHOOP5_NOTIFIES, "WHOOP5")
        else:
            print("\nNo known Whoop custom service UUID on this connection.")

    print(f"\nLogging to {OUTPUT_CSV}. Ctrl+C to stop.\n")
    await _stop.wait()


async def main_async(args: argparse.Namespace) -> None:
    if args.scan_only:
        await scan_advertising(args.name, args.timeout)
        return

    _setup_csv()
    if sys.platform == "win32":
        signal.signal(signal.SIGINT, _request_stop)
        signal.signal(signal.SIGBREAK, _request_stop)

    await scan_advertising(args.name, min(args.timeout, 8.0))

    device = await find_device(args.name, args.address, args.timeout)
    print(f"\nConnecting to {device.name!r} [{device.address}]...")
    print("TIP: disconnect official Whoop app on phone first (one BLE client at a time).")

    async with BleakClient(device, timeout=25.0) as client:
        if not client.is_connected:
            raise RuntimeError("Connection failed.")
        print("Connected.")
        await run_session(client, bond=not args.no_bond)

        try:
            await client.stop_notify(HR_MEASUREMENT)
        except Exception:
            pass


def main() -> None:
    parser = argparse.ArgumentParser(description="Discover and log Whoop BLE data")
    parser.add_argument("--name", default="WHOOP", help="Name substring (default: WHOOP)")
    parser.add_argument("--address", default=None, help="BLE address if known")
    parser.add_argument("--timeout", type=float, default=15.0, help="Scan timeout seconds")
    parser.add_argument("--scan-only", action="store_true", help="Only show advertising data")
    parser.add_argument("--no-bond", action="store_true", help="Skip custom Whoop bond/subscribe")
    args = parser.parse_args()

    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        pass
    finally:
        _close_csv()
        print(f"Done. Check {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
