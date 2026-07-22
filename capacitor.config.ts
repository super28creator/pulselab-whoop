import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.pulselab.whoop",
  appName: "PulseLab",
  webDir: "out",
  server: {
    androidScheme: "https",
    iosScheme: "capacitor",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#050506",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#050506",
    },
    BluetoothLe: {
      displayStrings: {
        scanning: "Szukam Whoop…",
        cancel: "Anuluj",
        availableDevices: "Dostępne urządzenia",
        noDeviceFound: "Nie znaleziono Whoop",
      },
    },
  },
  ios: {
    contentInset: "automatic",
    scheme: "PulseLab",
    backgroundColor: "#050506",
  },
};

export default config;
