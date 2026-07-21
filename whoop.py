#!/usr/bin/env python3
"""
Whoop 5.0 - dekoder + komendy (bez Bluetooth na PC).

Telefon (nRF Connect) zbiera dane -> PC je dekoduje.

Uzycie:
  python whoop.py commands          # gotowe hex do WRITE w nRF
  python whoop.py decode plik.txt   # dekoduj hex / export log
  python whoop.py decode --paste    # wklej hex z telefonu
  python whoop.py guide             # instrukcja krok po kroku
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from whoop_protocol import NRF_COMMANDS, frame_hex, parse_auto

HEX_TOKEN = re.compile(r"[0-9a-fA-F]{2}")
HEX_LINE = re.compile(
    r"(?:(?:Value|value|hex|Hex|Data|data)[:\s]+)?((?:[0-9a-fA-F]{2}[\s:\-]*){2,})",
)


def _fix_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def parse_hex_blob(text: str) -> bytes | None:
    tokens = HEX_TOKEN.findall(text)
    if len(tokens) < 2:
        return None
    return bytes(int(t, 16) for t in tokens)


def extract_hex_lines(text: str) -> list[bytes]:
    """Pull hex payloads from free text / nRF export."""
    found: list[bytes] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if re.fullmatch(r"-?\d+\s*dBm", line, re.I):
            continue
        if re.fullmatch(r"\d+(\.\d+)?\s*ms", line, re.I):
            continue
        m = HEX_LINE.search(line)
        if not m:
            continue
        data = parse_hex_blob(m.group(1))
        if data is None:
            continue
        if data.startswith(b"\xaa\x01") or len(data) <= 20 or len(data) == 96:
            found.append(data)
        elif len(data) >= 12 and b"\xaa\x01" in data:
            idx = data.find(b"\xaa\x01")
            if idx >= 0:
                found.append(data[idx:])
    return found


def cmd_commands(_args: argparse.Namespace) -> None:
    print("=== Whoop 5.0 - komendy do nRF Connect ===\n")
    print("1. CONNECT do WHOOP 5AGxxxxxxx")
    print("2. Otworz: FD4B0001 -> charakterystyke FD4B0002")
    print("3. Write -> Byte Array -> wklej JEDNA z ponizszych linii")
    print("4. Potem wlacz Notify (dzwonek) na: 2A37, FD4B0003, FD4B0004, FD4B0005\n")
    print("-" * 60)
    order = [
        ("client_hello", "1) START - Client Hello (obowiazkowy na 5.0)"),
        ("get_battery", "2) Bateria"),
        ("realtime_hr_on", "3) Wlacz strumien tetna (REALTIME_HR)"),
        ("get_version", "4) Wersja firmware"),
        ("get_data_range", "5) Zakres zapisanych danych"),
        ("historical_start", "6) Pobierz historie (opcjonalnie)"),
        ("realtime_hr_off", "7) Wylacz strumien tetna"),
    ]
    for key, label in order:
        frame = NRF_COMMANDS[key]
        print(f"\n{label}")
        print(f"  {frame_hex(frame)}")
        print(f"  (bez spacji: {frame.hex().upper()})")
    print("\n" + "-" * 60)
    print("UUID do Notify:")
    print("  2A37     = standardowe tetno (najlatwiejsze)")
    print("  FD4B0005 = glowny strumien Whoop")
    print("  FD4B0004 = eventy (duzo pakietow - OK)")
    print("  FD4B0003 = odpowiedzi na komendy")


def cmd_guide(_args: argparse.Namespace) -> None:
    print(
        """
=== Instrukcja: Whoop 5.0 bez Bluetooth na PC ===

TELEFON (nRF Connect)
  1. Zamknij oficjalna apke Whoop (1 polaczenie BLE naraz).
  2. nRF Connect -> Scanner -> WHOOP 5AG... -> CONNECT.
  3. Lista serwisow (ikona listy) - NIE log z -dBm (to tylko RSSI).
  4. python whoop.py commands  -> skopiuj hex Client Hello.
  5. FD4B0001 -> FD4B0002 -> Write -> Byte Array -> wklej Client Hello.
  6. Potem Write: realtime_hr_on (z listy commands).
  7. Wlacz dzwonek Notify na:
       - Heart Rate -> 2A37
       - FD4B0005 (i opcjonalnie 0003, 0004)
  8. Porusz nadgarstkiem - przy 2A37 powinny pojawic sie krotkie hex.
  9. Export log / Copy Last Read -> plik tekstowy na PC.

PC
  python whoop.py decode twoj_log.txt
  python whoop.py decode twoj_log.txt -o wynik.csv
  python whoop.py decode --paste

Wykres RSSI / wartosci typu "-61 dBm" / "52 ms" to NIE tetno.
Tetno = krotki hex przy 2A37 (np. 00 4A = 74 bpm) albo ramki AA 01 ...
""".strip()
    )


def decode_blobs(blobs: list[bytes], csv_path: Path | None) -> None:
    if not blobs:
        print("Brak hex do dekodowania.")
        print("Wklej linie z nRF (Last Read) albo uruchom: python whoop.py guide")
        return

    hr_samples = 0
    whoop_ok = 0
    rows_out: list[list] = []

    for i, data in enumerate(blobs, 1):
        parsed = parse_auto(data)
        mark = "OK" if parsed.ok or parsed.kind == "BLE_HR" else "--"
        print(f"\n[{mark}] #{i} {len(data)}B  {parsed.kind}")
        print(f"  hex: {data[:48].hex()}{'...' if len(data) > 48 else ''}")
        print(f"  => {parsed.summary}")
        if parsed.heart_rate_bpm is not None:
            hr_samples += 1
        if parsed.kind == "WHOOP5" and parsed.ok:
            whoop_ok += 1
        rows_out.append(
            [
                datetime.now(timezone.utc).isoformat(),
                parsed.kind,
                len(data),
                data.hex(),
                parsed.summary,
                parsed.heart_rate_bpm or "",
                parsed.battery_pct or "",
                parsed.packet_type or "",
                parsed.event_name or "",
            ]
        )

    print("\n" + "=" * 50)
    print(f"Pakietow: {len(blobs)} | Whoop OK: {whoop_ok} | probek tetna: {hr_samples}")

    if csv_path:
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        with csv_path.open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(
                [
                    "timestamp_utc",
                    "kind",
                    "length",
                    "hex",
                    "summary",
                    "heart_rate_bpm",
                    "battery_pct",
                    "packet_type",
                    "event_name",
                ]
            )
            w.writerows(rows_out)
        print(f"CSV: {csv_path.resolve()}")


def cmd_decode(args: argparse.Namespace) -> None:
    if args.paste:
        print("Wklej hex / fragment logu nRF. Pusta linia = koniec:\n")
        lines: list[str] = []
        while True:
            try:
                line = input()
            except EOFError:
                break
            if not line.strip():
                break
            lines.append(line)
        text = "\n".join(lines)
    elif args.input:
        path = Path(args.input)
        if not path.exists():
            print(f"Brak pliku: {path}", file=sys.stderr)
            sys.exit(1)
        text = path.read_text(encoding="utf-8", errors="replace")
    else:
        print("Podaj plik albo --paste. Przyklad: python whoop.py decode raw_input.example.txt")
        sys.exit(1)

    blobs = extract_hex_lines(text)
    if not blobs:
        one = parse_hex_blob(text)
        if one:
            blobs = [one]

    out = Path(args.csv) if args.csv else None
    if out is None and args.input:
        out = Path(args.input).with_suffix(".decoded.csv")
    decode_blobs(blobs, out)


def main() -> None:
    _fix_stdio()
    parser = argparse.ArgumentParser(
        description="Whoop 5.0 - dekoder i komendy nRF (bez BT na PC)"
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_cmd = sub.add_parser("commands", help="Hex do WRITE w nRF Connect")
    p_cmd.set_defaults(func=cmd_commands)

    p_guide = sub.add_parser("guide", help="Instrukcja krok po kroku")
    p_guide.set_defaults(func=cmd_guide)

    p_dec = sub.add_parser("decode", help="Dekoduj hex / log z telefonu")
    p_dec.add_argument("input", nargs="?", help="Plik z hexem lub exportem nRF")
    p_dec.add_argument("--paste", action="store_true", help="Wklej z klawiatury")
    p_dec.add_argument("-o", "--csv", help="Sciezka CSV (domyslnie *.decoded.csv)")
    p_dec.set_defaults(func=cmd_decode)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
