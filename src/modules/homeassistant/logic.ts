// Home Assistant : la logique de l'onglet et des Réglages, sans DOM (testée
// dans tests/front/homeassistant.test.ts). Le Rust (homeassistant.rs) parle à
// Home Assistant ; ici on range, on nomme et on choisit l'action d'un clic.

/** Un appareil tel que le Rust le renvoie (`favorites`, `entities`). */
export interface HaEntity {
  id: string;
  domain: string;
  name: string;
  state: string;
  area?: string | null;
  deviceClass?: string | null;
  brightness?: number | null;
  dimmable?: boolean;
  position?: number | null;
  target?: number | null;
  current?: number | null;
  minTemp?: number;
  maxTemp?: number;
  volume?: number | null;
  mediaTitle?: string | null;
  sensitive?: boolean;
  available?: boolean;
}

/** Un favori rangé dans les réglages (`favorites`). */
export interface HaFavorite {
  id: string;
  name?: string;
  area?: string;
}

/** Les favoris enregistrés, vérifiés (une valeur abîmée devient une liste vide). */
export function readFavorites(raw: unknown): HaFavorite[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is HaFavorite => !!f && typeof f === "object" && typeof (f as HaFavorite).id === "string" && /^[a-z_]+\.[a-z0-9_]+$/.test((f as HaFavorite).id))
    .map((f) => ({ id: f.id, ...(typeof f.name === "string" && f.name ? { name: f.name } : {}), ...(typeof f.area === "string" && f.area ? { area: f.area } : {}) }));
}

/** Ajoute ou retire un favori (en gardant le nom et la pièce du moment). */
export function toggleFavorite(list: HaFavorite[], e: HaEntity, on: boolean): HaFavorite[] {
  const rest = list.filter((f) => f.id !== e.id);
  if (!on) return rest;
  return [...rest, { id: e.id, name: e.name, ...(e.area ? { area: e.area } : {}) }];
}

/** Marque ou démarque un appareil « sensible ». */
export function toggleSensitive(list: unknown, id: string, on: boolean): string[] {
  const ids = Array.isArray(list) ? list.filter((x): x is string => typeof x === "string" && x !== id) : [];
  return on ? [...ids, id] : ids;
}

/** Le pictogramme d'un appareil (chacun a son trait, src/island/icon.ts). */
export function domainIcon(e: Pick<HaEntity, "domain" | "deviceClass">): string {
  switch (e.domain) {
    case "light":
      return "💡";
    case "switch":
    case "input_boolean":
      return "🔌";
    case "fan":
      return "🔄";
    case "cover":
      return e.deviceClass && ["garage", "gate", "door"].includes(e.deviceClass) ? "🚪" : "🪟";
    case "scene":
      return "✨";
    case "script":
      return "▶";
    case "climate":
      return "🌡";
    case "media_player":
      return "🎵";
    case "lock":
      return "🔒";
    case "alarm_control_panel":
      return "🛡️";
    default:
      return "🔌";
  }
}

/** Le nom d'un type d'appareil (rangement quand Home Assistant ne donne pas les pièces). */
export function domainName(domain: string): string {
  const names: Record<string, string> = {
    light: "Lumières",
    switch: "Prises et interrupteurs",
    input_boolean: "Prises et interrupteurs",
    fan: "Ventilateurs",
    cover: "Volets et portes",
    scene: "Scènes",
    script: "Scripts",
    climate: "Chauffage",
    media_player: "Lecteurs",
    lock: "Serrures",
    alarm_control_panel: "Alarme",
  };
  return names[domain] ?? "Autres";
}

/** L'appareil est-il « allumé » (la pastille brille) ? */
export function isOn(e: Pick<HaEntity, "domain" | "state">): boolean {
  switch (e.domain) {
    case "cover":
      return e.state === "open" || e.state === "opening";
    case "lock":
      return e.state === "unlocked";
    case "alarm_control_panel":
      return e.state.startsWith("armed");
    case "media_player":
      return e.state === "playing";
    case "climate":
      return e.state !== "off" && e.state !== "unavailable";
    case "scene":
    case "script":
      return false;
    default:
      return e.state === "on";
  }
}

/** La petite ligne sous le nom (« 50 % », « Ouvert », « 20,5 °C »). */
export function stateText(e: HaEntity): string {
  if (e.available === false || e.state === "unavailable") return "Indisponible";
  switch (e.domain) {
    case "light":
      return e.state === "on" ? (e.brightness != null ? `${e.brightness} %` : "Allumée") : "Éteinte";
    case "cover":
      if (e.state === "opening") return "S'ouvre…";
      if (e.state === "closing") return "Se ferme…";
      if (e.position != null && e.state === "open") return `Ouvert ${e.position} %`;
      return e.state === "open" ? "Ouvert" : "Fermé";
    case "climate":
      return e.target != null ? `${frNumber(e.target)} °C` : e.state === "off" ? "Arrêté" : "En marche";
    case "media_player":
      return e.state === "playing" ? "En lecture" : e.state === "paused" ? "En pause" : e.state === "off" ? "Éteint" : "Prêt";
    case "lock":
      return e.state === "locked" ? "Verrouillée" : e.state === "unlocked" ? "Déverrouillée" : "…";
    case "alarm_control_panel":
      return e.state === "disarmed" ? "Désarmée" : e.state.startsWith("armed") ? "Armée" : "…";
    case "scene":
    case "script":
      return "Lancer";
    default:
      return e.state === "on" ? "Allumé" : "Éteint";
  }
}

function frNumber(n: number): string {
  return String(Math.round(n * 10) / 10).replace(".", ",");
}

/** Le service d'un clic sur la pastille, ou null (climat : il faut une valeur). */
export function mainService(e: Pick<HaEntity, "domain" | "state">): string | null {
  switch (e.domain) {
    case "light":
    case "switch":
    case "input_boolean":
    case "fan":
      return "toggle";
    case "scene":
    case "script":
      return "turn_on";
    case "cover":
      return e.state === "open" || e.state === "opening" ? "close_cover" : "open_cover";
    case "media_player":
      return "media_play_pause";
    case "lock":
      return e.state === "locked" ? "unlock" : "lock";
    case "alarm_control_panel":
      return e.state === "disarmed" ? "alarm_arm_away" : "alarm_disarm";
    default:
      return null;
  }
}

/** Le bouton de la confirmation, à l'infinitif (« Ouvrir », « Déverrouiller »). */
export function confirmVerb(service: string): string {
  const verbs: Record<string, string> = {
    open_cover: "Ouvrir",
    close_cover: "Fermer",
    stop_cover: "Arrêter",
    set_cover_position: "Régler",
    lock: "Verrouiller",
    unlock: "Déverrouiller",
    alarm_arm_away: "Armer",
    alarm_arm_home: "Armer",
    alarm_disarm: "Désarmer",
    turn_on: "Allumer",
    turn_off: "Éteindre",
    toggle: "Confirmer",
  };
  return verbs[service] ?? "Confirmer";
}

/** Les favoris rangés par pièce (dans l'ordre où ils apparaissent), sans pièce à la fin. */
export function byArea<T extends { area?: string | null }>(items: T[]): { area: string | null; items: T[] }[] {
  const groups = new Map<string | null, T[]>();
  for (const it of items) {
    const key = it.area?.trim() || null;
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  const named = [...groups.entries()].filter(([k]) => k !== null).map(([area, items]) => ({ area, items }));
  const none = groups.get(null);
  return none ? [...named, { area: null, items: none }] : named;
}

/** Réglages → Appareils favoris : les appareils rangés par pièce, sinon par type, filtrés. */
export function pickerGroups(items: HaEntity[], query: string, withAreas: boolean): { title: string; items: HaEntity[] }[] {
  const q = normalize(query);
  const shown = q ? items.filter((e) => normalize(`${e.name} ${e.id} ${e.area ?? ""}`).includes(q)) : items;
  const groups = new Map<string, HaEntity[]>();
  for (const e of shown) {
    const title = withAreas ? e.area?.trim() || "Sans pièce" : domainName(e.domain);
    groups.set(title, [...(groups.get(title) ?? []), e]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "Sans pièce" ? 1 : b === "Sans pièce" ? -1 : a.localeCompare(b, "fr")))
    .map(([title, items]) => ({ title, items }));
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** La ligne de la carte d'Accueil : combien de lumières sont allumées. */
export function homeSummary(items: HaEntity[]): string {
  const lights = items.filter((e) => e.domain === "light" && e.available !== false);
  const on = lights.filter((e) => e.state === "on").length;
  if (!lights.length) return items.length === 1 ? "1 appareil" : `${items.length} appareils`;
  if (on === 0) return "Lumières éteintes";
  return on === 1 ? "1 lumière allumée" : `${on} lumières allumées`;
}

/** Les services qu'Ondine accepte (miroir de `services` dans homeassistant_logic.rs). */
export const SERVICES: Record<string, string[]> = {
  light: ["turn_on", "turn_off", "toggle"],
  switch: ["turn_on", "turn_off", "toggle"],
  input_boolean: ["turn_on", "turn_off", "toggle"],
  fan: ["turn_on", "turn_off", "toggle"],
  cover: ["open_cover", "close_cover", "stop_cover", "set_cover_position"],
  scene: ["turn_on"],
  script: ["turn_on"],
  climate: ["set_temperature", "turn_on", "turn_off"],
  media_player: ["media_play_pause", "media_next_track", "media_previous_track", "volume_set", "turn_on", "turn_off"],
  lock: ["lock", "unlock"],
  alarm_control_panel: ["alarm_arm_home", "alarm_arm_away", "alarm_disarm"],
};

/** Le nom d'un service, à l'infinitif (Règles). */
export const SERVICE_LABELS: Record<string, string> = {
  turn_on: "Allumer",
  turn_off: "Éteindre",
  toggle: "Basculer",
  open_cover: "Ouvrir",
  close_cover: "Fermer",
  stop_cover: "Arrêter",
  set_cover_position: "Régler la position (%)",
  set_temperature: "Régler la consigne (°C)",
  media_play_pause: "Lecture ou pause",
  media_next_track: "Morceau suivant",
  media_previous_track: "Morceau précédent",
  volume_set: "Régler le volume (%)",
  lock: "Verrouiller",
  unlock: "Déverrouiller",
  alarm_arm_home: "Armer (présence)",
  alarm_arm_away: "Armer (absence)",
  alarm_disarm: "Désarmer",
};

/** Un service qui demande une valeur (ou l'accepte : la luminosité d'une lumière). */
export function serviceValue(domain: string, service: string): { min: number; max: number; required: boolean } | null {
  if (domain === "light" && service === "turn_on") return { min: 1, max: 100, required: false };
  if (service === "set_cover_position" || service === "volume_set") return { min: 0, max: 100, required: true };
  if (service === "set_temperature") return { min: 7, max: 35, required: true };
  return null;
}

/** Les services possibles pour un appareil (« light.salon » → ceux des lumières). */
export function servicesFor(entity: string): string[] {
  return SERVICES[entity.split(".")[0]] ?? [];
}
