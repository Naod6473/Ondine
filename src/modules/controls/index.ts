// Module « Contrôles » : Wi-Fi, Bluetooth, mode avion, micro coupé, des
// piliers verticaux pour le son et la luminosité, et des blocs qui se
// déplient (1.2.5, blocks.ts) pour tout le reste.
//
// Façon centre de contrôle de l'iPhone, en verre liquide : à gauche une carte
// de pastilles rondes (interrupteurs), au milieu des « piliers » qu'on remplit
// en glissant de bas en haut, à droite les blocs Écrans, Appareils, Outils et
// Alimentation. Un clic sur un bloc (ou sur « Son », « Écran », « Tout ») le
// déplie en page ; « Retour » ramène l'accueil.
//
// Le Rust (src-tauri/src/modules/controls.rs) lit et change les réglages de
// Windows. Tant que l'onglet est ouvert, on relit le son chaque seconde (le
// volume a pu changer avec les touches du clavier), les radios, le mode
// sombre, l'éclairage nocturne et les clés USB toutes les 2 s, et les écrans
// toutes les 5 s (leur réponse est lente).
//
// Les clés USB (bande du bas, notifications « branchée » et « éjectée ») sont
// dans usb.ts ; la batterie des appareils Bluetooth et « Bureau propre »
// (cacher les icônes du bureau), dans bt.ts. Le volume de chaque appli, les
// réseaux Wi-Fi à portée et les boutons d'alimentation (1.2.5), dans extras.ts ;
// les pages des blocs dans blocks.ts, screens.ts, clean.ts et cheat.ts.

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";
import { pacedInterval } from "../../core/perf";
import { usbStrip, wireUsbNotifications } from "./usb";
import { btStrip, wireBtNotifications, type BtBattery } from "./bt";
import { onRemoteChange, remotePanel, remoteSession, wireRemote } from "./remote";
import { wireWheelVolume } from "./wheel";
import { wifiPage } from "./extras";
import { blocksCard, devicesPage, hub, moreButton, powerPage, sonPage, toolsPage, unfoldFrom, type BlockPage, type Page, type SoundState } from "./blocks";
import { screensPage } from "./screens";
import { cleanPage } from "./clean";
import { cheatPage } from "./cheat";
import type { UsbDrive } from "./usb-text";

type DeviceId = "speakers" | "microphone";

interface Level {
  volume: number;
  muted: boolean;
}

interface State {
  speakers: Level | null;
  microphone: Level | null;
}

type RadioKind = "wifi" | "bluetooth" | "mobile";

interface Radio {
  kind: RadioKind;
  on: boolean;
  /** Bloquée (interrupteur matériel, carte désactivée) : on ne peut pas l'allumer d'ici. */
  disabled: boolean;
}

interface Screen {
  id: string;
  name: string;
  brightness: number;
}

/** Le mode sombre et l'éclairage nocturne de Windows (commande `theme`). */
interface ThemeState {
  /** Applis et barre des tâches en sombre. */
  dark: boolean;
  /** L'un en sombre, l'autre en clair (mode « Personnalisé » de Windows). */
  mixed: boolean;
  /** supported = false : Ondine ne sait pas lire la valeur de Windows (la pastille ouvre les Paramètres). */
  night: { supported: boolean; on: boolean };
}

// Le son est relu chaque seconde, les radios toutes les 2 s, la luminosité
// toutes les 5 s (c'est lent) : "controlsSound", "controlsRadios",
// "controlsScreens" de src/core/perf.ts (selon le mode de performance).
/** Pendant qu'on fait glisser un pilier, au plus un envoi tous les… (le son réagit vite, un écran externe non). */
const SOUND_SEND_MS = 60;
const SCREEN_SEND_MS = 150;
/** Un appui sur une flèche du clavier change la valeur de… */
const KEY_STEP = 5;

/** Les pictogrammes en SVG (nets à toute taille). */
const GLYPHS = {
  speakers: "M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12",
  speakersOff: "M4 9h4l5-4v14l-5-4H4zM16.5 9.5l5 5M21.5 9.5l-5 5",
  microphone: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4",
  microphoneOff: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4M4 4l16 16",
  wifi: "M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5h.01",
  bluetooth: "M7 7l10 10-5 4V3l5 4L7 17",
  pin: "M9 3h6l-1 5 3 3v2h-4v7l-1 1-1-1v-7H7v-2l3-3z",
  airplane: "M10.5 3.5a1.5 1.5 0 0 1 3 0V9l7 4v2l-7-2v4.5l2.5 2V21L12 20l-4 1v-1.5l2.5-2V13l-7 2v-2l7-4z",
  mobile: "M5 20v-3M10 20v-7M15 20v-11M20 20V4",
  sun: "M12 8a4 4 0 1 1 0 8a4 4 0 0 1 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  /** Mode sombre : un croissant de lune. */
  moon: "M20 14.5A8.5 8.5 0 1 1 9.5 4a7.5 7.5 0 0 0 10.5 10.5z",
  /** Éclairage nocturne : un soleil couchant sur l'horizon. */
  night: "M3 18h18M7 18a5 5 0 0 1 10 0M12 8v3M5.6 11.6l1.6 1.6M18.4 11.6l-1.6 1.6M7 21h10",
};

function glyph(kind: keyof typeof GLYPHS): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  // Le haut-parleur en trois morceaux (corps + deux ondes) : le design Studio
  // allume les ondes selon le volume (island.css, data-level sur le pilier).
  const parts = kind === "speakers" ? GLYPHS.speakers.split(/(?=M16 |M18\.5 )/) : [GLYPHS[kind]];
  parts.forEach((d, i) => {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    if (i > 0) path.setAttribute("class", `wave w${i}`);
    svg.append(path);
  });
  return svg;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Un pilier vertical qu'on remplit de bas en haut (0 à 100).
 * Souris : on appuie et on glisse ; clavier : flèches, Début, Fin.
 * `onMove` dessine tout de suite ; `send` part au plus une fois tous les
 * `everyMs` pendant le glissé (le dernier mouvement part toujours).
 */
function pillar(opts: { label: string; color: string; everyMs: number; icon: Node; onMove: (v: number) => void; send: (v: number) => void }) {
  const fill = el("div", { class: "ctl-fill" });
  const value = el("span", { class: "ctl-pct" });
  const iconBox = el("span", { class: "ctl-pill-icon" }, opts.icon);
  const pill = el(
    "div",
    { class: "ctl-pill", role: "slider", tabindex: "0", "aria-label": opts.label, "aria-valuemin": "0", "aria-valuemax": "100" },
    fill,
    value,
    iconBox,
  );
  pill.style.setProperty("--tint", opts.color);

  let held = false;
  let lastSent = 0;
  let pending: number | undefined;

  const move = (v: number) => {
    opts.onMove(v);
    window.clearTimeout(pending);
    const go = () => {
      lastSent = Date.now();
      opts.send(v);
    };
    const wait = opts.everyMs - (Date.now() - lastSent);
    if (wait <= 0) go();
    else pending = window.setTimeout(go, wait);
  };
  /** La valeur sous le pointeur : 0 en bas du pilier, 100 en haut. */
  const fromPointer = (e: PointerEvent) => {
    const r = pill.getBoundingClientRect();
    return clamp(((r.bottom - e.clientY) / r.height) * 100);
  };

  pill.addEventListener("pointerdown", (e) => {
    if (pill.classList.contains("off")) return;
    held = true;
    pill.classList.add("held");
    pill.setPointerCapture(e.pointerId);
    move(fromPointer(e));
  });
  pill.addEventListener("pointermove", (e) => {
    if (held) move(fromPointer(e));
  });
  const release = () => {
    held = false;
    pill.classList.remove("held");
  };
  pill.addEventListener("pointerup", release);
  pill.addEventListener("pointercancel", release);
  pill.addEventListener("keydown", (e) => {
    if (pill.classList.contains("off")) return;
    const now = Number(pill.getAttribute("aria-valuenow") ?? 0);
    const keys: Record<string, number> = { ArrowUp: now + KEY_STEP, ArrowRight: now + KEY_STEP, ArrowDown: now - KEY_STEP, ArrowLeft: now - KEY_STEP, Home: 0, End: 100 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    move(clamp(keys[e.key]));
  });

  return {
    pill,
    iconBox,
    dragging: () => held,
    /** Montre une valeur (le remplissage glisse en douceur : voir .ctl-fill). */
    show(v: number, text = `${v} %`) {
      pill.style.setProperty("--v", `${v}%`);
      pill.setAttribute("aria-valuenow", String(v));
      pill.setAttribute("aria-valuetext", text);
      value.textContent = text;
    },
    /** Pas de périphérique : pilier grisé, inutilisable. */
    setOff(off: boolean) {
      pill.classList.toggle("off", off);
      pill.setAttribute("aria-disabled", String(off));
    },
  };
}

/** Un pilier + son nom dessous. */
function column(pill: HTMLElement, name: string) {
  const caption = el("span", { class: "ctl-caption" }, name);
  return { node: el("div", { class: "ctl-col" }, pill, caption), caption };
}

/** Le pilier du son ou du micro. Pour le son, l'icône du bas est un bouton « couper ». */
function devicePillar(api: ModuleApi, device: DeviceId, onState: (level: Level | null) => void) {
  const label = device === "speakers" ? "Son" : "Micro";
  const off = device === "speakers" ? "speakersOff" : "microphoneOff";
  const fail = (err: unknown) => api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "controls-error" });
  let current: Level | null = null;

  const paint = (level: Level) => {
    p.show(level.volume, level.muted ? "coupé" : `${level.volume} %`);
    p.pill.classList.toggle("muted-dev", level.muted);
    // 0 = aucune onde, 1 = une, 2 = les deux (design Studio).
    p.pill.dataset.level = level.muted || level.volume === 0 ? "0" : level.volume < 50 ? "1" : "2";
    p.iconBox.replaceChildren(glyph(level.muted ? off : device));
    onState(level);
  };

  const p = pillar({
    label: `Volume : ${label.toLowerCase()}`,
    color: device === "speakers" ? "#3d8bff" : "#8a6cff",
    everyMs: SOUND_SEND_MS,
    icon: glyph(device),
    onMove: (volume) => {
      // Monter le volume réactive le son, comme dans Windows.
      const wasMuted = current?.muted ?? false;
      const muted = wasMuted && volume === 0;
      if (wasMuted && !muted) api.invoke("set_muted", { device, muted: false }).catch(fail);
      current = { volume, muted };
      paint(current);
    },
    send: (volume) => api.invoke("set_volume", { device, volume }).catch(fail),
  });

  const toggleMute = async () => {
    if (!current) return;
    current = { ...current, muted: !current.muted };
    paint(current);
    await api.invoke("set_muted", { device, muted: current.muted });
  };

  // Son : un clic sur l'icône du bas coupe / réactive (sans faire bouger le pilier).
  if (device === "speakers") {
    p.iconBox.classList.add("ctl-mute");
    p.iconBox.title = "Couper / réactiver le son";
    p.iconBox.addEventListener("pointerdown", (e) => e.stopPropagation());
    p.iconBox.addEventListener("click", api.handler(() => toggleMute().catch(fail)));
  }

  const col = column(p.pill, label);
  return {
    node: col.node,
    caption: col.caption,
    toggleMute,
    update(level: Level | null) {
      p.setOff(!level);
      col.caption.textContent = level ? label : device === "speakers" ? "Pas de son" : "Pas de micro";
      if (!level) {
        current = null;
        onState(null);
        return;
      }
      // Pendant un glissé, c'est la main qui décide : on n'écrase pas le pilier.
      if (p.dragging()) return;
      if (current && current.volume === level.volume && current.muted === level.muted) return;
      current = level;
      paint(level);
    },
  };
}

/** Le pilier de luminosité d'un écran. */
function screenPillar(api: ModuleApi, screen: Screen) {
  const fail = (err: unknown) => api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "controls-error" });
  const p = pillar({
    label: `Luminosité : ${screen.name}`,
    color: "#ffb31f",
    everyMs: SCREEN_SEND_MS,
    icon: glyph("sun"),
    onMove: (v) => p.show(v),
    send: (v) => api.invoke("set_brightness", { id: screen.id, brightness: v }).catch(fail),
  });
  // Sur l'accueil, un seul pilier (le premier écran) ; tous les écrans sont
  // dans la page Écrans, que ce nom ouvre.
  const col = column(p.pill, "Écrans");
  return {
    node: col.node,
    caption: col.caption,
    update(s: Screen) {
      if (!p.dragging()) p.show(s.brightness);
    },
  };
}

const TILE_NAMES = { wifi: "Wi-Fi", bluetooth: "Bluetooth", mobile: "Mobile", airplane: "Avion", mic: "Micro", pin: "Épingler", dark: "Sombre", night: "Veilleuse" } as const;
type TileId = keyof typeof TILE_NAMES;
/** Les pastilles toujours là (les radios, elles, dépendent du PC). */
const FIXED_TILES: TileId[] = ["mic", "pin", "dark", "night"];

/**
 * La carte de pastilles rondes : radios, mode avion, micro coupé. Les
 * pastilles « Épingler », « Sombre » et « Veilleuse » sont tenues à jour ici
 * aussi, mais rangées dans les pages Outils et Écrans (`moved`).
 */
function toggleCard(api: ModuleApi, onMicToggle: () => Promise<void>, onWifiMenu: () => void, openAll: (from: HTMLElement) => void) {
  const fail = (err: unknown) => api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "controls-error" });
  const grid = el("div", { class: "ctl-tiles" });
  const card = el(
    "div",
    { class: "ctl-card ctl-toggles" },
    el("div", { class: "ctl-card-head" }, el("span", { class: "ctl-card-title" }, "Connexions"), moreButton("Tout", "Les réseaux Wi-Fi à portée", openAll)),
    grid,
  );
  const tiles = new Map<TileId, HTMLButtonElement>();
  let busy = false;

  const tile = (id: TileId, icon: keyof typeof GLYPHS, onClick: (wanted: boolean) => Promise<unknown>) => {
    const button = el(
      "button",
      { class: "ctl-toggle", type: "button", "data-kind": id },
      el("span", { class: "ctl-dot" }, glyph(icon)),
      el("span", { class: "ctl-toggle-name" }, TILE_NAMES[id]),
    ) as HTMLButtonElement;
    button.addEventListener(
      "click",
      api.handler(async () => {
        if (busy) return;
        busy = true;
        // La pastille bascule tout de suite ; la prochaine lecture corrige si Windows a refusé.
        const wanted = button.classList.toggle("on");
        try {
          await onClick(wanted);
        } catch (err) {
          button.classList.toggle("on");
          fail(err);
        } finally {
          busy = false;
        }
      }),
    );
    tiles.set(id, button);
    return button;
  };

  const mic = tile("mic", "microphoneOff", () => onMicToggle());
  // Garder au premier plan la fenêtre où tu travaillais (celle d'avant l'île).
  const pin = tile("pin", "pin", async () => {
    const r = await api.invoke<{ title: string; pinned: boolean }>("toggle_pin");
    const name = r.title ? `« ${r.title.length > 40 ? `${r.title.slice(0, 40)}…` : r.title} »` : "La fenêtre";
    api.notify({ title: r.pinned ? `${name} reste au premier plan` : `${name} n'est plus au premier plan`, icon: "📌", priority: "low", key: "controls-pin" });
  });
  // Le mode sombre de Windows (applis et barre des tâches).
  const dark = tile("dark", "moon", (on) => api.invoke("set_dark", { on }));
  // L'éclairage nocturne. Si Ondine ne reconnaît pas la valeur de Windows, rien
  // n'est écrit et le Rust ouvre la page des Paramètres à la place.
  const night = tile("night", "night", async (on) => {
    const r = await api.invoke<{ opened: boolean }>("set_night", { on });
    if (r.opened) night.classList.remove("on");
  });
  let shown: string | null = null;

  // Avant la première lecture des radios : au moins le micro.
  grid.append(mic);

  return {
    node: card,
    /** Rangées ailleurs : « Épingler » (Outils), « Sombre » et « Veilleuse » (Écrans). */
    moved: { pin, dark, night },
    /** Les radios présentes (la carte se refait si la liste change). */
    radios(list: Radio[]) {
      if (busy) return;
      const key = list.map((r) => r.kind).join(",");
      if (key !== shown) {
        shown = key;
        for (const id of [...tiles.keys()]) if (!FIXED_TILES.includes(id)) tiles.delete(id);
        grid.replaceChildren(
          ...list.map((r) => {
            const t = tile(r.kind, r.kind, (on) => api.invoke("set_radio", { kind: r.kind, on }));
            // Clic droit sur le Wi-Fi : les réseaux à portée (page « Réseaux »).
            if (r.kind === "wifi") t.addEventListener("contextmenu", (e) => (e.preventDefault(), onWifiMenu()));
            return t;
          }),
          ...(list.length ? [tile("airplane", "airplane", (on) => api.invoke("set_airplane", { on }))] : []),
          mic,
        );
      }
      for (const r of list) {
        const button = tiles.get(r.kind);
        if (!button) continue;
        button.classList.toggle("on", r.on);
        button.disabled = r.disabled;
        button.title = `${TILE_NAMES[r.kind]} : ${r.disabled ? "bloqué sur ce PC" : r.on ? "activé" : "désactivé"}`;
        button.setAttribute("aria-pressed", String(r.on));
      }
      // « Mode avion » : toutes les radios sont éteintes.
      const airplane = tiles.get("airplane");
      if (airplane) {
        const on = list.length > 0 && list.every((r) => !r.on);
        airplane.classList.toggle("on", on);
        airplane.title = on ? "Mode avion : tout est coupé" : "Mode avion : couper Wi-Fi, Bluetooth…";
        airplane.setAttribute("aria-pressed", String(on));
      }
    },
    /** La pastille « Premier plan » : allumée si la fenêtre d'avant y est déjà. */
    window(info: { title: string; pinned: boolean } | null) {
      if (busy) return;
      pin.disabled = !info;
      pin.classList.toggle("on", !!info?.pinned);
      pin.title = !info ? "Aucune fenêtre" : `${info.pinned ? "Relâcher" : "Garder au premier plan"} : ${info.title || "la fenêtre d'avant"}`;
      pin.setAttribute("aria-pressed", String(!!info?.pinned));
    },
    /** Les pastilles « Sombre » et « Veilleuse », d'après Windows. */
    theme(t: ThemeState) {
      if (busy) return;
      dark.classList.toggle("on", t.dark);
      dark.title = t.dark
        ? "Mode sombre de Windows : activé"
        : t.mixed
          ? "Mode sombre de Windows : en partie (applis ou barre des tâches)"
          : "Mode sombre de Windows : désactivé";
      dark.setAttribute("aria-pressed", String(t.dark));
      const nightOn = t.night.supported && t.night.on;
      night.classList.toggle("on", nightOn);
      night.title = !t.night.supported
        ? "Éclairage nocturne : ouvrir les paramètres de Windows"
        : nightOn
          ? "Éclairage nocturne : activé"
          : "Éclairage nocturne : désactivé";
      night.setAttribute("aria-pressed", String(nightOn));
    },
    /** La pastille « Micro » s'allume (en rouge) quand le micro est coupé. */
    mic(level: Level | null) {
      if (busy) return;
      mic.disabled = !level;
      const muted = level?.muted ?? false;
      mic.classList.toggle("on", muted);
      mic.title = !level ? "Aucun micro" : muted ? "Micro coupé : cliquer pour le réactiver" : "Couper le micro";
      mic.setAttribute("aria-pressed", String(muted));
    },
  };
}

/**
 * L'aide-mémoire demandé par Ctrl gauche maintenu ("controls.cheat") :
 * l'onglet ouvert le montre tout de suite (`live`) ; sinon l'île s'ouvre sur
 * Contrôles et l'onglet le trouve en arrivant (`pending`).
 */
const cheat: {
  pending: { app: string | null } | null;
  live: ((app: string | null) => void) | null;
  release: (() => void) | null;
} = { pending: null, live: null, release: null };

export const controls: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    // Le raccourci micro, ou un autre module (« Rétablir le micro » de
    // l'Agenda) : une petite notification confirme, le badge d'Ondine
    // (island.ts) reste tant que le micro est coupé.
    const offMuted = api.on("controls.mic-muted", (msg) => {
      const p = (msg.payload ?? {}) as { muted?: boolean; source?: string };
      if (p.source !== "hotkey" && p.source !== "request") return;
      api.notify({ title: p.muted ? "Micro coupé" : "Micro rétabli", icon: p.muted ? "🔇" : "🎙️", priority: "low", key: "controls-mic", durationMs: 1800 });
    });
    const offError = api.on("controls.mic-error", (msg) => {
      const p = (msg.payload ?? {}) as { message?: string };
      api.notify({ title: p.message ?? "Le micro ne répond pas", icon: "⚠️", priority: "normal", key: "controls-mic" });
    });
    // Clé USB branchée (« Ouvrir », « Éjecter ») et résultat d'une éjection.
    const offUsb = wireUsbNotifications(api);
    // Un appareil Bluetooth passe sous le seuil (fil de fond du Rust).
    const offBt = wireBtNotifications(api);
    // Télécommande sur le téléphone : téléphone connecté, arrêt automatique.
    const offRemote = wireRemote(api);
    // La molette sur l'île règle le volume (wheel.ts, 1.2.3).
    const offWheel = wireWheelVolume(api);
    // Ctrl gauche maintenu : l'aide-mémoire (platform/cheat_key.rs).
    const offCheat = api.on("controls.cheat", (msg) => {
      const p = (msg.payload ?? {}) as { show?: boolean; app?: string | null };
      if (p.show) {
        if (cheat.live) cheat.live(p.app ?? null);
        else {
          cheat.pending = { app: p.app ?? null };
          api.openIsland("controls");
        }
      } else if (cheat.release) cheat.release();
      else if (cheat.pending) {
        // Relâché avant que l'onglet n'arrive : on n'ouvre rien.
        cheat.pending = null;
        api.closeIsland();
      }
    });
    return () => {
      offCheat();
      offWheel();
      offRemote();
      offMuted();
      offError();
      offUsb();
      offBt();
    };
  },

  views: {
    expanded(root, api: ModuleApi) {
      let alive = true;
      // Ce que les pages lisent pendant que l'accueil relit Windows.
      const sound = hub<SoundState | null>(null);
      const drives = hub<UsbDrive[]>([]);
      let btCount = 0;

      // Le micro : sa pastille sur l'accueil, son curseur dans la page Son.
      // Le pilier n'est plus affiché ; il garde l'état et sait couper le micro.
      const speakers = devicePillar(api, "speakers", () => {});
      const microphone = devicePillar(api, "microphone", (level) => toggles.mic(level));
      const toggles = toggleCard(
        api,
        () => microphone.toggleMute(),
        () => openPage("net", null),
        (from) => openPage("net", from),
      );
      // Le premier écran sur l'accueil ; tous les écrans dans la page Écrans.
      const screensBox = el("div", { class: "ctl-screens" });
      speakers.caption.classList.add("ctl-caption-btn");
      speakers.caption.setAttribute("role", "button");
      speakers.caption.tabIndex = 0;
      speakers.caption.title = "Sortie audio, micro, volume de chaque appli";
      const openFromCaption = (caption: HTMLElement, page: BlockPage) => {
        caption.addEventListener("click", api.handler(() => openPage(page, caption)));
        caption.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openPage(page, caption)));
      };
      openFromCaption(speakers.caption, "son");
      const blocks = blocksCard(api, (page, from) => openPage(page, from));
      const ctl = el("div", { class: "ctl" }, toggles.node, el("div", { class: "ctl-card ctl-pillars" }, speakers.node, screensBox), blocks.node);

      // En bas, seulement ce qui compte maintenant : les clés USB branchées,
      // un appareil Bluetooth presque vide.
      const usb = usbStrip(api);
      const lowChip = el("button", { class: "ctl-chip ctl-low", type: "button", hidden: true }) as HTMLButtonElement;
      lowChip.addEventListener("click", () => openPage("app", lowChip));
      const bt = btStrip(api, (low: BtBattery[], all: BtBattery[]) => {
        lowChip.hidden = low.length === 0;
        lowChip.textContent = low.length ? `Batterie faible : ${low[0].name} (${low[0].percent} %)` : "";
        btCount = all.length;
        syncBlocks();
      });
      const chips = el("div", { class: "ctl-chips ctl-now" }, lowChip);
      const home = el("div", { class: "ctl-root", "data-island-fit": true }, ctl, usb.node, chips);

      // La télécommande tourne : son panneau (QR code) remplace l'onglet.
      const remoteHost = el("div", { class: "ctl-remote-host" });
      // Un bloc déplié : sa page remplace l'accueil, « Retour » le ramène.
      const pageHost = el("div", { class: "ctl-page-host" });
      let page: (Page & { kind: string }) | null = null;
      let modeName = "";

      const closePage = () => {
        page?.stop();
        page = null;
        pageHost.replaceChildren();
        show();
      };
      const mount = (kind: string, p: Page, from: HTMLElement | null) => {
        page?.stop();
        page = { ...p, kind };
        unfoldFrom(p.node, from, root);
        pageHost.replaceChildren(p.node);
        show();
      };
      function openPage(kind: BlockPage, from: HTMLElement | null) {
        const p =
          kind === "net"
            ? wifiPage(api, closePage)
            : kind === "son"
              ? sonPage(api, closePage, sound)
              : kind === "ecr"
                ? screensPage(api, closePage, { dark: toggles.moved.dark, night: toggles.moved.night, onMode: (name) => blocks.sync({ mode: (modeName = name) }) })
                : kind === "app"
                  ? devicesPage(api, closePage, drives, bt.node)
                  : kind === "out"
                    ? toolsPage(api, closePage, { pin: toggles.moved.pin, desk: bt.desk, startClean, openCheat: (b) => openCheat(cheatTarget(), false, b) })
                    : powerPage(api, closePage);
        mount(kind, p, from);
      }
      /** Le programme de la fenêtre où vous travailliez (« excel »). */
      const cheatTarget = async () => {
        try {
          return (await api.invoke<{ app: string | null }>("cheat_app")).app;
        } catch {
          return null;
        }
      };
      let heldCheat: ReturnType<typeof cheatPage> | null = null;
      async function openCheat(app: Promise<string | null> | string | null, held: boolean, from: HTMLElement | null) {
        const program = await app;
        if (!alive) return;
        const p = cheatPage(api, closePage, program, { held, onKeep: () => (heldCheat = null) });
        heldCheat = held ? p : null;
        mount("cheat", p, from);
      }
      function startClean() {
        const seconds = Math.max(10, Math.min(120, Number(api.settings().cleanSeconds ?? 30) || 30));
        mount("clean", cleanPage(api, seconds, closePage), null);
      }

      cheat.live = (app) => void openCheat(app, true, null);
      cheat.release = () => {
        if (!heldCheat || heldCheat.kept() || page?.kind !== "cheat") return;
        heldCheat = null;
        if (openedByHold) api.closeIsland();
        else closePage();
      };
      // L'île vient de s'ouvrir pour l'aide-mémoire (Ctrl gauche maintenu).
      const openedByHold = cheat.pending !== null;
      if (cheat.pending) {
        const app = cheat.pending.app;
        cheat.pending = null;
        void openCheat(app, true, null);
      }

      const show = () => {
        const s = remoteSession();
        // Le nettoyage passe avant tout : rien d'autre ne doit s'afficher.
        const busy = page?.kind === "clean";
        home.hidden = (!!s && !busy) || !!page;
        remoteHost.replaceChildren(...(s && !page ? [remotePanel(api, s)] : []));
      };
      root.append(home, remoteHost, pageHost);
      show();
      const offRemote = onRemoteChange(show);
      toggles.radios([]);

      const refreshSound = async () => {
        try {
          const s = await api.invoke<State>("state");
          if (!alive) return;
          speakers.update(s.speakers);
          microphone.update(s.microphone);
          sound.set(s);
        } catch {
          // hors de l'appli (navigateur) : on garde l'affichage
        }
      };

      const refreshWindow = async () => {
        try {
          const win = await api.invoke<{ title: string; pinned: boolean } | null>("window");
          if (alive) toggles.window(win);
        } catch {
          // hors de l'appli
        }
      };

      const refreshTheme = async () => {
        try {
          const t = await api.invoke<ThemeState>("theme");
          if (alive) toggles.theme(t);
        } catch {
          // hors de l'appli : les pastilles restent éteintes
        }
      };

      const refreshUsb = async () => {
        try {
          const list = await api.invoke<UsbDrive[]>("usb_drives");
          if (!alive) return;
          usb.update(list);
          drives.set(list);
          syncBlocks();
        } catch {
          // hors de l'appli : pas de clé USB
        }
      };

      /** Le sous-titre des blocs : le mode d'affichage, les appareils branchés. */
      function syncBlocks() {
        const n = drives.get().length;
        const parts = [n ? `${n} USB` : "", btCount ? `${btCount} Bluetooth` : ""].filter(Boolean);
        blocks.sync({ mode: modeName, devices: parts.length ? parts.join(" · ") : "Aucun branché" });
      }
      const refreshLayout = async () => {
        try {
          const l = await api.invoke<{ mode: "internal" | "clone" | "extend" | "external" | null; connected: number }>("display_layout");
          const names = { internal: "PC seul", clone: "Dupliquer", extend: "Étendre", external: "2e écran seul" };
          modeName = l.mode ? names[l.mode] : l.connected < 2 ? "1 écran" : "";
        } catch {
          modeName = "";
        }
        if (alive) syncBlocks();
      };

      const refreshRadios = async () => {
        syncBlocks();
        void refreshWindow();
        void refreshTheme();
        void refreshUsb();
        void bt.refreshDesk();
        try {
          const list = await api.invoke<Radio[]>("radios");
          if (alive) toggles.radios(list);
        } catch {
          // hors de l'appli, ou Windows ne liste pas les radios : seulement le micro
        }
      };

      let pillarFor = "";
      let mainPillar: ReturnType<typeof screenPillar> | null = null;
      const refreshScreens = async () => {
        try {
          const list = await api.invoke<Screen[]>("screens");
          if (!alive) return;
          // Le premier écran a changé (branché, débranché) : on refait le pilier.
          const first = list[0];
          if ((first?.id ?? "") !== pillarFor) {
            pillarFor = first?.id ?? "";
            mainPillar = first ? screenPillar(api, first) : null;
            screensBox.replaceChildren(...(mainPillar ? [mainPillar.node] : []));
            if (mainPillar) {
              const caption = mainPillar.caption;
              caption.classList.add("ctl-caption-btn");
              caption.setAttribute("role", "button");
              caption.tabIndex = 0;
              caption.title = "Windows+P, écran principal, chaque écran, mode sombre, veilleuse";
              openFromCaption(caption, "ecr");
            }
          }
          if (first) mainPillar?.update(first);
        } catch {
          // hors de l'appli : pas d'écran
        }
      };

      void refreshRadios();
      void refreshSound();
      void refreshScreens();
      void refreshLayout();
      const timers = [
        pacedInterval(() => void refreshSound(), "controlsSound", true),
        pacedInterval(() => void refreshRadios(), "controlsRadios", true),
        pacedInterval(() => void refreshScreens(), "controlsScreens", true),
        pacedInterval(() => void refreshLayout(), "controlsScreens", true),
      ];
      return () => {
        alive = false;
        cheat.live = null;
        cheat.release = null;
        page?.stop();
        usb.stop();
        bt.stop();
        offRemote();
        timers.forEach((stop) => stop());
      };
    },
  },
};
