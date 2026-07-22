# PulseLab na iPhone — co Ty robisz (krok po kroku)

Kod aplikacji natywnej jest już w repo (Capacitor + Bluetooth).
**Żeby wgrać apkę na iPhone, potrzebujesz Maca z Xcode.** Na samym Windowsie się tego nie zbuduje.

---

## Masz Maca? Zrób tak:

### 1. Pobierz projekt na Maca

```bash
git clone https://github.com/super28creator/pulselab-whoop.git
cd pulselab-whoop
npm install
```

(Albo skopiuj folder z Windowsa / GitHub.)

### 2. Zbuduj i otwórz w Xcode

```bash
npm run build:ios
npm run cap:patch-plist
npx cap open ios
```

### 3. Signing w Xcode (1 raz)

1. Po lewej kliknij niebieski projekt **App**
2. Zakładka **Signing & Capabilities**
3. Zaznacz **Automatically manage signing**
4. **Team** → zaloguj się swoim Apple ID i wybierz siebie
5. Jeśli Bundle ID zajęty — zmień na np. `app.pulselab.whoop.twojeimie`

### 4. Uruchom na iPhonie

1. Podłącz iPhone kablem, zaufaj komputerowi
2. Na górze Xcode wybierz **swój iPhone** (nie symulator — Bluetooth nie działa w symulatorze)
3. Kliknij ▶ **Run**
4. Na iPhonie: **Ustawienia → Ogólne → VPN i zarządzanie urządzeniem** → zaufaj deweloperowi
5. Otwórz **PulseLab** → zezwól na Bluetooth → **Połącz z Whoop**

Gotowe — masz własną apkę z ikoną, bez Bluefy.

---

## Nie masz Maca?

Wybierz jedną opcję:

1. **Pożycz Maca na 1–2 h** u kogoś / w szkole / pracy — wystarczy do pierwszej instalacji
2. **Mac w chmurze** (MacinCloud, MacStadium) — zainstaluj Xcode i powtórz kroki powyżej
3. Na razie zostaw **Bluefy** w przeglądarce (web nadal działa)

---

## Po każdej zmianie w kodzie (na Macu)

```bash
git pull
npm install
npm run build:ios
npx cap open ios
```

Potem ▶ Run.

Z Windowsa możesz edytować i `git push` — budujesz tylko na Macu.

---

## Problemy

| Objaw | Rozwiązanie |
|--------|-------------|
| Nie widać Whoop | Zamknij apkę Whoop / nRF / Bluefy; Bluetooth ON; zrestartuj opaskę |
| Błąd podpisu | Wybierz Team; zmień Bundle ID |
| Stara wersja apki | `npm run build:ios` + Run ponownie |
| Brak GPS przy bieganiu | Ustawienia → PulseLab → Lokalizacja → Podczas używania |

---

## TestFlight / App Store (później, opcjonalnie)

Jak apka działa u Ciebie:

1. Apple Developer Program (~99 USD/rok)
2. Xcode → **Product → Archive** → wyślij do TestFlight

Na start **nie musisz** — wystarczy Run z Xcode na swoim telefonie.
