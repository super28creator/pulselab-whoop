/** Detect Capacitor native shell vs browser. */

import { Capacitor } from "@capacitor/core";

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export async function isBleAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (isNativeApp()) return true;
  return "bluetooth" in navigator;
}

export function isIosBrowserWithoutBle(): boolean {
  if (typeof navigator === "undefined") return false;
  if (isNativeApp()) return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua);
  return ios && !("bluetooth" in navigator);
}
