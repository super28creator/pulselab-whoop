/** Web Bluetooth path (Chrome / Bluefy). */

import { UUID } from "../whoop";
import { batteryFrom2a19 } from "../battery";
import {
  WHOOP_OPTIONAL_SERVICES,
  bytesFromDataView,
  type WhoopHandlers,
  type WhoopSession,
} from "./types";

export async function connectWhoopWeb(handlers: WhoopHandlers): Promise<WhoopSession> {
  if (!("bluetooth" in navigator)) {
    throw new Error("Ta przeglądarka nie obsługuje Bluetooth. Na iPhonie użyj aplikacji PulseLab albo Bluefy.");
  }

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: "WHOOP" }, { services: [UUID.hrService] }],
    optionalServices: [...WHOOP_OPTIONAL_SERVICES],
  });

  const onDisc = () => handlers.onDisconnected();
  device.addEventListener("gattserverdisconnected", onDisc);

  const server = await device.gatt!.connect();
  let cmdChar: BluetoothRemoteGATTCharacteristic | null = null;
  let batChar: BluetoothRemoteGATTCharacteristic | null = null;

  try {
    const custom = await server.getPrimaryService(UUID.customService);
    const onWhoop = (ev: Event) => {
      const t = ev.target as BluetoothRemoteGATTCharacteristic;
      if (!t.value) return;
      handlers.onWhoopNotify(bytesFromDataView(t.value));
    };
    for (const id of [UUID.dataNotify, UUID.eventNotify, UUID.cmdNotify] as const) {
      try {
        const ch = await custom.getCharacteristic(id);
        await ch.startNotifications();
        ch.addEventListener("characteristicvaluechanged", onWhoop);
      } catch {
        /* bond may be required */
      }
    }
    cmdChar = await custom.getCharacteristic(UUID.cmdWrite);
  } catch {
    /* custom service optional if bond missing */
  }

  try {
    const batSvc = await server.getPrimaryService(UUID.batteryService);
    batChar = await batSvc.getCharacteristic(UUID.batteryChar);
    const first = await batChar.readValue();
    const pct = batteryFrom2a19(first);
    if (pct != null) handlers.onBattery(pct);
    try {
      await batChar.startNotifications();
      batChar.addEventListener("characteristicvaluechanged", (ev) => {
        const t = ev.target as BluetoothRemoteGATTCharacteristic;
        if (!t.value) return;
        const p = batteryFrom2a19(t.value);
        if (p != null) handlers.onBattery(p);
      });
    } catch {
      /* some stacks don't notify */
    }
  } catch {
    /* optional */
  }

  const hrSvc = await server.getPrimaryService(UUID.hrService);
  const hrChar = await hrSvc.getCharacteristic(UUID.hrChar);
  await hrChar.startNotifications();
  hrChar.addEventListener("characteristicvaluechanged", (ev) => {
    const t = ev.target as BluetoothRemoteGATTCharacteristic;
    if (t.value) handlers.onHr(t.value);
  });

  return {
    deviceName: device.name || "WHOOP",
    native: false,
    writeCmd: async (buf, withResponse = false) => {
      if (!cmdChar) throw new Error("Brak FD4B0002 — spróbuj sparować opaskę ponownie");
      const data = buf as unknown as BufferSource;
      if (withResponse) await cmdChar.writeValue(data);
      else {
        try {
          await cmdChar.writeValueWithoutResponse(data);
        } catch {
          await cmdChar.writeValue(data);
        }
      }
    },
    readBattery: async () => {
      if (!batChar) return null;
      try {
        return await batChar.readValue();
      } catch {
        return null;
      }
    },
    disconnect: async () => {
      try {
        device.removeEventListener("gattserverdisconnected", onDisc);
        device.gatt?.disconnect();
      } catch {
        /* ignore */
      }
    },
  };
}
