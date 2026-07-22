/** Capacitor native BLE (iOS CoreBluetooth / Android). */

import { BleClient } from "@capacitor-community/bluetooth-le";
import { UUID } from "../whoop";
import { batteryFrom2a19 } from "../battery";
import {
  WHOOP_OPTIONAL_SERVICES,
  bytesFromDataView,
  dataViewFromBytes,
  type WhoopHandlers,
  type WhoopSession,
} from "./types";

function norm(uuid: string): string {
  return uuid.toLowerCase();
}

export async function connectWhoopNative(handlers: WhoopHandlers): Promise<WhoopSession> {
  await BleClient.initialize({ androidNeverForLocation: true });

  const device = await BleClient.requestDevice({
    services: [norm(UUID.hrService)],
    optionalServices: WHOOP_OPTIONAL_SERVICES.map(norm),
    namePrefix: "WHOOP",
  });

  const deviceId = device.deviceId;

  await BleClient.connect(deviceId, () => {
    handlers.onDisconnected();
  });

  // Discover services so subsequent get/notify calls are reliable on iOS
  try {
    await BleClient.getServices(deviceId);
  } catch {
    /* continue */
  }

  const custom = norm(UUID.customService);
  const cmdWrite = norm(UUID.cmdWrite);

  const onWhoop = (value: DataView) => {
    handlers.onWhoopNotify(bytesFromDataView(value));
  };

  for (const char of [UUID.dataNotify, UUID.eventNotify, UUID.cmdNotify] as const) {
    try {
      await BleClient.startNotifications(deviceId, custom, norm(char), onWhoop);
    } catch {
      /* characteristic may need bond */
    }
  }

  try {
    const bat = await BleClient.read(deviceId, norm(UUID.batteryService), norm(UUID.batteryChar));
    const pct = batteryFrom2a19(bat);
    if (pct != null) handlers.onBattery(pct);
  } catch {
    /* optional */
  }

  try {
    await BleClient.startNotifications(
      deviceId,
      norm(UUID.batteryService),
      norm(UUID.batteryChar),
      (value) => {
        const pct = batteryFrom2a19(value);
        if (pct != null) handlers.onBattery(pct);
      },
    );
  } catch {
    /* optional */
  }

  await BleClient.startNotifications(deviceId, norm(UUID.hrService), norm(UUID.hrChar), (value) => {
    handlers.onHr(value);
  });

  return {
    deviceName: device.name || "WHOOP",
    native: true,
    writeCmd: async (buf, withResponse = false) => {
      const dv = dataViewFromBytes(buf);
      if (withResponse) {
        await BleClient.write(deviceId, custom, cmdWrite, dv);
      } else {
        try {
          await BleClient.writeWithoutResponse(deviceId, custom, cmdWrite, dv);
        } catch {
          await BleClient.write(deviceId, custom, cmdWrite, dv);
        }
      }
    },
    readBattery: async () => {
      try {
        return await BleClient.read(deviceId, norm(UUID.batteryService), norm(UUID.batteryChar));
      } catch {
        return null;
      }
    },
    disconnect: async () => {
      try {
        await BleClient.disconnect(deviceId);
      } catch {
        /* ignore */
      }
    },
  };
}
