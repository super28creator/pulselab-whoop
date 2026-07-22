/**
 * Patch ios/App/App/Info.plist with Bluetooth + Location usage strings.
 * Run after: npx cap add ios
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const plistPath = join(process.cwd(), "ios", "App", "App", "Info.plist");
if (!existsSync(plistPath)) {
  console.error("Brak ios/App/App/Info.plist — najpierw na Macu: npx cap add ios");
  process.exit(1);
}

let xml = readFileSync(plistPath, "utf8");
const entries = [
  [
    "NSBluetoothAlwaysUsageDescription",
    "PulseLab łączy się z opaską Whoop, żeby odczytać tętno, baterię i historię.",
  ],
  [
    "NSBluetoothPeripheralUsageDescription",
    "PulseLab używa Bluetooth do połączenia z Whoop.",
  ],
  [
    "NSLocationWhenInUseUsageDescription",
    "PulseLab używa GPS telefonu podczas biegania i aktywności outdoor.",
  ],
];

for (const [key, value] of entries) {
  if (xml.includes(`<key>${key}</key>`)) continue;
  const block = `	<key>${key}</key>\n	<string>${value}</string>\n`;
  xml = xml.replace("</dict>\n</plist>", `${block}</dict>\n</plist>`);
}

writeFileSync(plistPath, xml);
console.log("OK — Info.plist zaktualizowany (Bluetooth + GPS).");
