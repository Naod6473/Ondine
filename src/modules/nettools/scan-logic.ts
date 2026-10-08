// Réseau : ce que la liste du scanner montre, sans DOM (testé dans
// tests/front/net-scan.test.ts). L'affichage est dans scan-view.ts.

export interface ScanDevice {
  ip: string;
  mac: string | null;
  vendor: string | null;
  randomMac: boolean;
  name: string | null;
  ms: number | null;
  gateway: boolean;
  kind: string;
  new: boolean;
}

export interface ScanResult {
  network: string;
  adapter: string;
  me: { ip: string; name: string | null };
  gateway: string | null;
  devices: ScanDevice[];
  elapsedMs: number;
}

/** Le pictogramme et le nom de chaque type d'appareil deviné. */
export const KINDS: Record<string, [string, string]> = {
  box: ["📡", "Box / routeur"],
  pc: ["💻", "Ordinateur"],
  phone: ["📱", "Téléphone ou tablette"],
  printer: ["🖨️", "Imprimante"],
  nas: ["🗄️", "NAS (stockage)"],
  camera: ["📷", "Caméra"],
  speaker: ["🔊", "Enceinte"],
  iot: ["💡", "Objet connecté"],
  console: ["🎮", "Console de jeu"],
  server: ["🖥️", "Serveur ou mini-PC"],
  web: ["🌐", "Appareil avec une page web"],
  unknown: ["❔", "Appareil"],
};

/** Les ports web qu'on sait ouvrir, dans l'ordre de préférence. */
const WEB_PORTS = [443, 80, 5001, 5000, 8080];

/** Le nom à montrer : le nom DNS (sans le domaine local), sinon le fabricant, sinon le type. */
export function deviceTitle(d: ScanDevice): string {
  const name = d.name?.replace(/\.(home|lan|local|localdomain|box|fritz\.box)$/i, "");
  if (name) return name;
  if (d.vendor) return d.vendor;
  return (KINDS[d.kind] ?? KINDS.unknown)[1];
}

/** La ligne de détails : l'adresse, le fabricant, l'adresse MAC (ou « adresse MAC privée »). */
export function deviceDetails(d: ScanDevice): string[] {
  const parts = [d.ip];
  if (d.name && d.vendor) parts.push(d.vendor);
  if (d.randomMac) parts.push("adresse MAC privée");
  else if (d.mac) parts.push(d.mac);
  if (d.ms != null) parts.push(`${d.ms} ms`);
  return parts;
}

/** Le premier port web ouvert, s'il y en a un. */
export function webPort(open: number[]): number | null {
  return WEB_PORTS.find((p) => open.includes(p)) ?? null;
}

/** L'ordre de la liste : la box d'abord, puis les adresses dans l'ordre. */
export function sortDevices(list: ScanDevice[]): ScanDevice[] {
  const num = (ip: string) => ip.split(".").reduce((a, b) => a * 256 + Number(b), 0);
  return [...list].sort((a, b) => Number(b.gateway) - Number(a.gateway) || num(a.ip) - num(b.ip));
}
