# PulseLab — Whoop 5

Aplikacja webowa do lokalnego odczytu tetna z Whoop 5.0.

## Uruchomienie lokalne

```bash
cd web
npm install
npm run dev
```

Otworz http://localhost:3000

## Telefon

- **Android Chrome:** przycisk "Polacz z Whoop" (Web Bluetooth)
- **iPhone Safari:** wklej hex z nRF Connect ALBO otworz strone w [Bluefy](https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055)

## Python (PC bez BT)

```bash
python whoop.py guide
python whoop.py commands
python whoop.py decode plik.txt
```
