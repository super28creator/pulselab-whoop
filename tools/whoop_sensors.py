#!/usr/bin/env python3
"""
Whoop biometric field decode (community RE — OpenStrap / NOOP / FINDINGS).

Historical type-47 inner records (R24-like) carry the full second:
  HR + RR + accel(g) + skinTemp(raw ADC) + PPG …

Live type-43 REALTIME_RAW_DATA carries high-rate IMU (+ HR byte).

These layouts are empirical; Whoop 5 firmware variants may differ slightly.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Optional


@dataclass
class BiometricSecond:
    """One second of strap biometrics (historical record)."""

    version: int
    ts_epoch: int
    hr: int
    rr_ms: list[int]
    accel_g: tuple[float, float, float]
    skin_temp_raw: int
    skin_contact: int
    ppg_green: int
    ambient_raw: int


@dataclass
class ImuPacket:
    """Decoded REALTIME_RAW_DATA (type 43) IMU block."""

    hr: Optional[int]
    accel_xyz: list[tuple[int, int, int]]  # raw LSB samples
    motion_rms: float  # mean |a| in g (approx, 1g≈3900 LSB)


def _f32(data: bytes, off: int) -> float:
    return struct.unpack_from("<f", data, off)[0]


def _i16(data: bytes, off: int) -> int:
    return struct.unpack_from("<h", data, off)[0]


def _u16(data: bytes, off: int) -> int:
    return struct.unpack_from("<H", data, off)[0]


def _u32(data: bytes, off: int) -> int:
    return struct.unpack_from("<I", data, off)[0]


def parse_r24(inner: bytes) -> Optional[BiometricSecond]:
    """
    Decode historical biometric record.

    `inner` should start at the packet-type byte (0x2F / 47) OR at the
    historical payload after type/seq/cmd — we accept both by scanning.
    Minimum validated length ~72–89 bytes (OpenStrap v24 map).
    """
    if len(inner) < 52:
        return None

    # If caller passed full Whoop5 record (type,seq,cmd,…), skip 3-byte header
    # when type looks like HISTORICAL (47) / puffin variants.
    data = inner
    if data[0] in (47, 0x2F) and len(data) > 55:
        data = data  # OpenStrap treats inner as starting AT type byte
    elif len(data) >= 3 and data[0] == 47:
        pass

    # Prefer layout where byte[1] is version and [17] is HR
    candidates = [data]
    if data[0] in (47, 0x2F) and len(data) > 4:
        candidates.append(data)  # type at [0]
        # Also try payload-only (after type/seq/cmd)
        if len(data) > 3:
            candidates.append(data[3:])

    for blob in candidates:
        if len(blob) < 72:
            continue
        version = blob[1] if len(blob) > 1 else 0
        # Header: counter@3, ts@7 — must look like unix time ~2018–2035
        try:
            ts = _u32(blob, 7)
        except struct.error:
            continue
        if not (1_500_000_000 <= ts <= 2_200_000_000):
            # Maybe blob already omitted type byte — try offset 0 as version path
            if len(blob) >= 89:
                ts2 = _u32(blob, 7)
                if not (1_500_000_000 <= ts2 <= 2_200_000_000):
                    continue
            else:
                continue

        hr_off = {7: 27, 9: 17, 12: 17, 18: 14, 24: 17}.get(version, 17)
        if hr_off >= len(blob):
            continue
        hr = blob[hr_off]
        rr_count = blob[18] if len(blob) > 18 else 0
        rr: list[int] = []
        for i in range(min(rr_count, 4)):
            off = 19 + 2 * i
            if off + 2 > len(blob):
                break
            v = _i16(blob, off)
            if 250 <= v <= 2000:
                rr.append(v)

        if len(blob) < 48:
            continue
        ax, ay, az = _f32(blob, 36), _f32(blob, 40), _f32(blob, 44)
        mag2 = ax * ax + ay * ay + az * az
        # Gravity sanity (~0.5–1.8 g) when we claim accel floats
        accel_ok = 0.25 <= mag2 <= 3.24
        if hr and not (25 <= hr <= 230):
            continue
        if hr and not accel_ok:
            # Still accept if HR ok but accel weird (firmware variant)
            pass

        skin_contact = blob[51] if len(blob) > 51 else 0
        ppg_green = _u16(blob, 29) if len(blob) >= 31 else 0
        skin_temp = _u16(blob, 68) if len(blob) >= 70 else 0
        ambient = _u16(blob, 70) if len(blob) >= 72 else 0

        return BiometricSecond(
            version=version,
            ts_epoch=ts,
            hr=hr,
            rr_ms=rr,
            accel_g=(round(ax, 4), round(ay, 4), round(az, 4)),
            skin_temp_raw=skin_temp,
            skin_contact=skin_contact,
            ppg_green=ppg_green,
            ambient_raw=ambient,
        )

    return None


def parse_imu_type43_payload(payload: bytes) -> Optional[ImuPacket]:
    """
    REALTIME_RAW_DATA payload (after type/seq/cmd).

    Layout from community FINDINGS (Whoop 5, subtype 10), signed i16 LE:
      hr @ 14
      accelX @ 82  (100 samples)
      accelY @ 282
      accelZ @ 482
    Scale empirical: ~3900 LSB ≈ 1 g.
    """
    if len(payload) < 682:
        return None

    hr = payload[14] if 25 <= payload[14] <= 230 else None
    n = 100
    samples: list[tuple[int, int, int]] = []
    mags: list[float] = []
    scale = 3900.0
    for i in range(n):
        ax = _i16(payload, 82 + 2 * i)
        ay = _i16(payload, 282 + 2 * i)
        az = _i16(payload, 482 + 2 * i)
        samples.append((ax, ay, az))
        mags.append((ax * ax + ay * ay + az * az) ** 0.5 / scale)

    motion = sum(mags) / len(mags) if mags else 0.0
    return ImuPacket(hr=hr, accel_xyz=samples, motion_rms=round(motion, 4))


def summarize_biometric(b: BiometricSecond) -> str:
    rr = f" RR={b.rr_ms}" if b.rr_ms else ""
    return (
        f"R24 v{b.version} t={b.ts_epoch} HR={b.hr}{rr} "
        f"accel=({b.accel_g[0]},{b.accel_g[1]},{b.accel_g[2]})g "
        f"skinTempRaw={b.skin_temp_raw} contact={b.skin_contact}"
    )
