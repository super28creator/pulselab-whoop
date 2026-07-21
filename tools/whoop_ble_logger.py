#!/usr/bin/env python3
"""
Log raw BLE notifications from a Whoop band to CSV.

Usage:
  1. Set CHARACTERISTIC_UUID (and optionally DEVICE_ADDRESS or DEVICE_NAME).
  2. pip install -r requirements.txt
  3. python whoop_ble_logger.py
  4. Stop with Ctrl+C
"""

from __future__ import annotations

import asyncio
import csv
import signal
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bleak import BleakClient, BleakScanner
from bleak.backends.device import BLEDevice

# --- Configuration -----------------------------------------------------------

# Known Whoop UUIDs (community RE). Start with HR — works without bonding:
#   Standard HR:  00002a37-0000-1000-8000-00805f9b34fb
#   Whoop 4 data: 61080005-8d6d-82b8-614a-1c8cb0f8dcc6  (needs bond — use whoop_discover.py)
CHARACTERISTIC_UUID = "00002a37-0000-1000-8000-00805f9b34fb"

# Use either MAC/address OR name. Leave the unused one as None.
# Windows often shows addresses like "AA:BB:CC:DD:EE:FF"
DEVICE_ADDRESS: str | None = None
DEVICE_NAME: str | None = "WHOOP"

# Optional: restrict scan to a specific service UUID if you know it.
SERVICE_UUID: str | None = None

OUTPUT_CSV = Path(__file__).with_name("data_log.csv")
SCAN_TIMEOUT_SECONDS = 15.0

# --- Internals ---------------------------------------------------------------

_stop_event = asyncio.Event()
_csv_file: Any = None
_csv_writer: csv.writer | None = None


def _setup_csv() -> None:
    global _csv_file, _csv_writer

    file_exists = OUTPUT_CSV.exists()
    _csv_file = OUTPUT_CSV.open("a", newline="", encoding="utf-8")
    _csv_writer = csv.writer(_csv_file)

    if not file_exists:
        _csv_writer.writerow(
            [
                "timestamp_utc",
                "length_bytes",
                "hex",
                "integers",
            ]
        )
        _csv_file.flush()


def _close_csv() -> None:
    global _csv_file
    if _csv_file is not None:
        _csv_file.close()
        _csv_file = None


def _handle_notification(_handle: int, data: bytearray) -> None:
    if _csv_writer is None:
        return

    timestamp = datetime.now(timezone.utc).isoformat()
    hex_str = data.hex()
    integers = " ".join(str(b) for b in data)

    _csv_writer.writerow([timestamp, len(data), hex_str, integers])
    _csv_file.flush()

    print(f"[{timestamp}] {len(data)} B | hex={hex_str} | ints={integers}")


def _request_stop() -> None:
    print("\nStopping... (waiting for clean disconnect)")
    _stop_event.set()


def _install_signal_handlers() -> None:
    if sys.platform == "win32":
        signal.signal(signal.SIGINT, lambda _sig, _frame: _request_stop())
        signal.signal(signal.SIGBREAK, lambda _sig, _frame: _request_stop())
    else:
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, _request_stop)


async def _find_device() -> BLEDevice:
    if DEVICE_ADDRESS:
        print(f"Scanning for device address: {DEVICE_ADDRESS}")
        device = await BleakScanner.find_device_by_address(
            DEVICE_ADDRESS,
            timeout=SCAN_TIMEOUT_SECONDS,
            service_uuids=[SERVICE_UUID] if SERVICE_UUID else None,
        )
        if device is None:
            raise RuntimeError(f"Device with address {DEVICE_ADDRESS!r} not found.")
        return device

    if not DEVICE_NAME:
        raise RuntimeError("Set DEVICE_ADDRESS or DEVICE_NAME in the script config.")

    print(f"Scanning for device name containing: {DEVICE_NAME!r}")
    devices = await BleakScanner.discover(
        timeout=SCAN_TIMEOUT_SECONDS,
        service_uuids=[SERVICE_UUID] if SERVICE_UUID else None,
    )

    needle = DEVICE_NAME.casefold()
    for device in devices:
        name = (device.name or "").casefold()
        if needle in name:
            print(f"Found: {device.name!r} [{device.address}]")
            return device

    visible = ", ".join(
        f"{d.name or '(no name)'} [{d.address}]" for d in devices
    ) or "(none)"
    raise RuntimeError(
        f"No device matching name {DEVICE_NAME!r} found. Visible devices: {visible}"
    )


async def _run() -> None:
    _setup_csv()
    _install_signal_handlers()

    device = await _find_device()
    print(f"Connecting to {device.name!r} [{device.address}]...")

    async with BleakClient(device, timeout=20.0) as client:
        if not client.is_connected:
            raise RuntimeError("Failed to connect.")

        print(f"Connected. Subscribing to {CHARACTERISTIC_UUID}...")
        await client.start_notify(CHARACTERISTIC_UUID, _handle_notification)
        print(f"Logging to {OUTPUT_CSV}. Press Ctrl+C to stop.")

        await _stop_event.wait()

        print("Unsubscribing...")
        await client.stop_notify(CHARACTERISTIC_UUID)


def main() -> None:
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        pass
    finally:
        _close_csv()
        print(f"Done. Data saved to {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
