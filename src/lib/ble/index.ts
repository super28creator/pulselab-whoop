/** Unified Whoop connect — native Capacitor BLE or Web Bluetooth. */

import { isNativeApp } from "./platform";
import type { WhoopHandlers, WhoopSession } from "./types";

export type { WhoopHandlers, WhoopSession } from "./types";
export { isBleAvailable, isIosBrowserWithoutBle, isNativeApp } from "./platform";

export async function connectWhoop(handlers: WhoopHandlers): Promise<WhoopSession> {
  if (isNativeApp()) {
    const { connectWhoopNative } = await import("./nativeBle");
    return connectWhoopNative(handlers);
  }
  const { connectWhoopWeb } = await import("./webBle");
  return connectWhoopWeb(handlers);
}
