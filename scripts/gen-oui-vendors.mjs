// Regénère src-tauri/src/modules/oui-vendors.txt : la table des fabricants de
// cartes réseau du scanner (onglet Réseau, « Scanner mon réseau »).
//
// La source : la base IEEE des préfixes MAC (OUI), telle que publiée par le
// paquet npm oui-data (BSD-2-Clause, © silverwind). On ne garde que les
// fabricants courants à la maison et au bureau, sous un nom court, et les
// préfixes de 24 bits (MA-L).
//
//   npm pack oui-data && tar xzf oui-data-*.tgz
//   node scripts/gen-oui-vendors.mjs package/index.json

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "src", "modules", "oui-vendors.txt");
const source = process.argv[2];
if (!source) {
  console.error("usage : node scripts/gen-oui-vendors.mjs <chemin de oui-data/index.json>");
  process.exit(1);
}

/** [début du nom IEEE (minuscules, expression régulière), nom affiché] ; "" = ignoré. */
const VENDORS = [
  ["^apple", "Apple"], ["^samsung", "Samsung"], ["^google", "Google"], ["^amazon", "Amazon"], ["^microsoft", "Microsoft"],
  ["^intel corporate|^intel corp", "Intel"], ["^dell", "Dell"], ["^hewlett packard enterprise", "HPE"], ["^hewlett packard|^hp inc", "HP"],
  ["^lenovo", "Lenovo"], ["^asustek", "ASUS"], ["^acer", "Acer"], ["^tp-link|^tp link", "TP-Link"], ["^netgear", "Netgear"],
  ["^ubiquiti", "Ubiquiti"], ["^cisco", "Cisco"], ["^huawei", "Huawei"], ["^xiaomi|^beijing xiaomi", "Xiaomi"], ["^sagemcom", "Sagemcom"],
  ["^freebox", "Freebox"], ["^technicolor|^vantiva", "Technicolor"], ["^synology", "Synology"], ["^qnap", "QNAP"],
  ["^western digital", "Western Digital"], ["^sonos", "Sonos"], ["^signify|^philips lighting", "Philips Hue"], ["^nintendo", "Nintendo"],
  ["^sony", "Sony"], ["^lg electronics|^lg innotek", "LG"], ["^raspberry pi", "Raspberry Pi"], ["^espressif", "Espressif (objet connecté)"],
  ["^brother", "Brother"], ["^canon", "Canon"], ["^seiko epson", "Epson"], ["^xerox", "Xerox"], ["^ricoh", "Ricoh"], ["^kyocera", "Kyocera"],
  ["^lexmark", "Lexmark"], ["^nest labs", "Google Nest"], ["^roku", "Roku"], ["^avm ", "AVM (FRITZ!Box)"], ["^netatmo", "Netatmo"],
  ["^hangzhou hikvision", "Hikvision"], ["^zhejiang dahua", "Dahua"], ["^realtek", "Realtek"], ["^motorola mobility", "Motorola"],
  ["^oneplus", "OnePlus"], ["^guangdong oppo", "Oppo"], ["^vivo mobile", "Vivo"], ["^honor device", "Honor"], ["^nokia", "Nokia"],
  ["^arcadyan", "Arcadyan (box)"], ["^zyxel", "Zyxel"], ["^d-link", "D-Link"], ["^belkin", "Belkin / Linksys"], ["^linksys", "Linksys"],
  ["^routerboard|^mikrotik", "MikroTik"], ["^fortinet", "Fortinet"], ["^aruba", "Aruba"], ["^juniper", "Juniper"], ["^vmware", "VMware"],
  ["^parallels", "Parallels"], ["^withings", "Withings"], ["^bose", "Bose"], ["^garmin", "Garmin"], ["^fitbit", "Fitbit"], ["^tesla", "Tesla"],
  ["^shelly|^allterco", "Shelly"], ["^zte", "ZTE"], ["^eero", "eero"], ["^nvidia", "NVIDIA"], ["^giga-byte", "Gigabyte"], ["^micro-star", "MSI"],
  ["^asrock", "ASRock"], ["^panasonic", "Panasonic"], ["^toshiba", "Toshiba"], ["^sharp", "Sharp"], ["^hisense", "Hisense"], ["^tcl ", "TCL"],
  ["^bouygues", "Bouygues Telecom"], ["^orange", "Orange"], ["^sfr", "SFR"], ["^tuya", "Tuya (objet connecté)"], ["^broadcom", "Broadcom"],
  ["^qualcomm", "Qualcomm"], ["^mediatek", "MediaTek"], ["^liteon|^lite-on", "Lite-On"], ["^azurewave", "AzureWave"], ["^murata", "Murata"],
  ["^hon hai|^foxconn", "Foxconn"], ["^wistron", "Wistron"], ["^compal", "Compal"], ["^quanta", "Quanta"], ["^pegatron", "Pegatron"],
  ["^gemtek", "Gemtek"], ["^ezviz", "EZVIZ"], ["^reolink", "Reolink"], ["^ring llc", "Ring"], ["^ecobee", "ecobee"], ["^logitech", "Logitech"],
  ["^valve", "Valve"], ["^meta platforms|^oculus", "Meta"], ["^polycom|^plantronics", "Poly"], ["^yealink", "Yealink"],
  ["^grandstream", "Grandstream"], ["^snom", "Snom"], ["^axis communications", "Axis"], ["^supermicro|^super micro", "Supermicro"],
  ["^cloud network technology", "Foxconn"], ["^sony interactive", "PlayStation"], ["^texas instruments", "Texas Instruments"], ["^private$", ""],
].map(([rx, name]) => [new RegExp(rx), name]);

const data = JSON.parse(readFileSync(source, "utf8"));
const byVendor = new Map();
for (const [prefix, text] of Object.entries(data)) {
  if (!/^[0-9A-F]{6}$/.test(prefix)) continue; // préfixes de 24 bits seulement
  const first = String(text).split("\n")[0].trim().toLowerCase();
  const hit = VENDORS.find(([rx]) => rx.test(first));
  if (!hit || !hit[1]) continue;
  if (!byVendor.has(hit[1])) byVendor.set(hit[1], []);
  byVendor.get(hit[1]).push(prefix);
}
const head = [
  "# Fabricants des cartes réseau : préfixe MAC (OUI, 24 bits) → nom court.",
  "# Extrait de la base IEEE via le paquet npm oui-data (BSD-2-Clause,",
  "# © silverwind), réduit aux fabricants courants à la maison et au bureau.",
  "# Une ligne par fabricant : « Nom|préfixe,préfixe,… ». Regénérer :",
  "# scripts/gen-oui-vendors.mjs.",
];
const lines = [...byVendor.keys()].sort().map((v) => `${v}|${byVendor.get(v).sort().join(",")}`);
writeFileSync(OUT, [...head, ...lines].join("\n") + "\n");
console.log(`${lines.length} fabricants, ${[...byVendor.values()].reduce((a, l) => a + l.length, 0)} préfixes → ${OUT}`);
