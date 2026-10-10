// Module « Contrôles » : Wi-Fi, Bluetooth, mode avion, micro coupé, et des
// piliers verticaux pour le son, le micro et la luminosité des écrans.
//
// Façon centre de contrôle de l'iPhone, en verre liquide : à gauche une carte
// de pastilles rondes (interrupteurs), à droite des « piliers » qu'on remplit
// en glissant de bas en haut. Tout tient dans la vue de l'île, sans défiler.
//
// Le Rust (src-tauri/src/modules/controls.rs) lit et change les réglages de
// Windows. Tant que l'onglet est ouvert, on relit le son chaque seconde (le
// volume a pu changer avec les touches du clavier), les radios, le mode
// sombre, l'éclairage nocturne et les clés USB toutes les 2 s, et les écrans
// toutes les 5 s (leur réponse est lente).
//
// Les clés USB (bande du bas, notifications « branchée » et « éjectée ») sont
// dans usb.ts ; la batterie des appareils Bluetooth et « Bureau propre »
// (cacher les icônes du bureau), dans bt.ts.

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";
import { pacedInterval } from "../../core/perf";
import { usbStrip, wireUsbNotifications } from "./usb";
import { btStrip, wireBtNotifications } from "./bt";
import { onRemoteChange, remotePanel, remoteSession, wireRemote } from "./remote";
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

interface Output {
  id: string;
  name: string;
  default: boolean;
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

/**
 * Choisir la sortie audio (casque, haut-parleurs, écran…) : le nom « Son »
 * sous le pilier devient un bouton qui ouvre une petite liste en verre.
 * Changer la sortie passe par une API interne de Windows (voir audio.rs).
 */
function outputMenu(api: ModuleApi, caption: HTMLElement, host: HTMLElement) {
  caption.classList.add("ctl-output-btn");
  caption.setAttribute("role", "button");
  caption.tabIndex = 0;
  caption.title = "Choisir la sortie audio";
  let menu: HTMLElement | null = null;
  const close = () => {
    menu?.remove();
    menu = null;
    document.removeEventListener("pointerdown", outside, true);
  };
  const outside = (e: Event) => {
    if (menu && !menu.contains(e.target as Node) && e.target !== caption) close();
  };
  const open = async () => {
    if (menu) return close();
    let list: Output[] = [];
    try {
      list = await api.invoke<Output[]>("outputs");
    } catch (err) {
      api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "controls-error" });
      return;
    }
    menu = el("div", { class: "ctl-menu", role: "menu" });
    if (!list.length) menu.append(el("div", { class: "ctl-menu-empty muted" }, "Aucune sortie audio"));
    for (const o of list) {
      menu.append(
        el(
          "button",
          {
            class: `ctl-menu-item ${o.default ? "on" : ""}`,
            role: "menuitemradio",
            "aria-checked": String(o.default),
            title: o.name,
            onclick: api.handler(async () => {
              close();
              if (o.default) return;
              try {
                await api.invoke("set_output", { id: o.id });
                api.notify({ title: `Le son sort sur ${o.name}`, icon: "🎧", priority: "low", key: "controls-output" });
              } catch (err) {
                api.notify({ title: errorText(err), icon: "⚠️", priority: "normal", key: "controls-error" });
              }
            }),
          },
          el("span", { class: "ctl-menu-check" }, o.default ? "✓" : ""),
          el("span", { class: "ctl-menu-name" }, o.name),
        ),
      );
    }
    // La liste s'ouvre au-dessus du bouton, à sa gauche (dans la vue, sans déborder).
    const h = host.getBoundingClientRect();
    const c = caption.getBoundingClientRect();
    menu.style.left = `${Math.max(0, c.left - h.left - 8)}px`;
    menu.style.bottom = `${h.bottom - c.top + 4}px`;
    host.append(menu);
    document.addEventListener("pointerdown", outside, true);
  };
  caption.addEventListener("click", api.handler(open));
  caption.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), void open()));
  return close;
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
  const col = column(p.pill, "Écran");
  col.caption.title = screen.name;
  return {
    node: col.node,
    /** Plusieurs écrans : on les nomme (« Écran intégré », « DELL U2720Q »). */
    named(on: boolean) {
      col.caption.textContent = on ? screen.name : "Écran";
    },
    update(s: Screen) {
      if (!p.dragging()) p.show(s.brightness);
    },
  };
}

const TILE_NAMES = { wifi: "Wi-Fi", bluetooth: "Bluetooth", mobile: "Mobile", airplane: "Avion", mic: "Micro", pin: "Épingler", dark: "Sombre", night: "Veilleuse" } as const;
type TileId = keyof typeof TILE_NAMES;
/** Les pastilles toujours là (les radios, elles, dépendent du PC). */
const FIXED_TILES: TileId[] = ["mic", "pin", "dark", "night"];

/** La carte de pastilles rondes : radios, mode avion, micro coupé, premier plan, mode sombre, éclairage nocturne. */
function toggleCard(api: ModuleApi, onMicToggle: () => Promise<void>) {
  const fail = (err: unknown) => api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "controls-error" });
  const card = el("div", { class: "ctl-card ctl-toggles" });
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

  return {
    node: card,
    /** Les radios présentes (la carte se refait si la liste change). */
    radios(list: Radio[]) {
      if (busy) return;
      const key = list.map((r) => r.kind).join(",");
      if (key !== shown) {
        shown = key;
        for (const id of [...tiles.keys()]) if (!FIXED_TILES.includes(id)) tiles.delete(id);
        card.replaceChildren(
          ...list.map((r) => tile(r.kind, r.kind, (on) => api.invoke("set_radio", { kind: r.kind, on }))),
          ...(list.length ? [tile("airplane", "airplane", (on) => api.invoke("set_airplane", { on }))] : []),
          mic,
          pin,
          dark,
          night,
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
    return () => {
      offRemote();
      offMuted();
      offError();
      offUsb();
      offBt();
    };
  },

  views: {
    expanded(root, api: ModuleApi) {
      // Le micro apparaît deux fois (pastille + pilier) : le pilier tient la pastille à jour.
      const speakers = devicePillar(api, "speakers", () => {});
      const microphone = devicePillar(api, "microphone", (level) => toggles.mic(level));
      const toggles = toggleCard(api, () => microphone.toggleMute());
      const screensBox = el("div", { class: "ctl-screens" });
      const ctl = el("div", { class: "ctl" }, toggles.node, el("div", { class: "ctl-card ctl-pillars" }, speakers.node, microphone.node, screensBox));
      // En bas, les clés USB branchées (la bande se cache quand il n'y en a pas).
      const usb = usbStrip(api);
      // Puis la batterie des appareils Bluetooth et « Bureau propre ».
      const bt = btStrip(api);
      const ctlRoot = el("div", { class: "ctl-root" }, ctl, usb.node, bt.node);
      // La télécommande tourne : son panneau (QR code) remplace l'onglet.
      const remoteHost = el("div", { class: "ctl-remote-host" });
      const showRemote = () => {
        const s = remoteSession();
        ctlRoot.hidden = !!s;
        remoteHost.replaceChildren(...(s ? [remotePanel(api, s)] : []));
      };
      root.append(ctlRoot, remoteHost);
      showRemote();
      const offRemote = onRemoteChange(showRemote);
      const closeMenu = outputMenu(api, speakers.caption, ctl);
      toggles.radios([]);

      let alive = true;
      const refreshSound = async () => {
        try {
          const s = await api.invoke<State>("state");
          if (!alive) return;
          speakers.update(s.speakers);
          microphone.update(s.microphone);
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
          if (alive) usb.update(list);
        } catch {
          // hors de l'appli : pas de clé USB
        }
      };

      const refreshRadios = async () => {
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

      const pillars = new Map<string, ReturnType<typeof screenPillar>>();
      let screensKey = "";
      const refreshScreens = async () => {
        try {
          const list = await api.invoke<Screen[]>("screens");
          if (!alive) return;
          // La liste des écrans a changé (branché, débranché) : on refait les piliers.
          const key = list.map((s) => s.id).join(",");
          if (key !== screensKey) {
            screensKey = key;
            pillars.clear();
            screensBox.replaceChildren(
              ...list.map((s) => {
                const p = screenPillar(api, s);
                p.named(list.length > 1);
                pillars.set(s.id, p);
                return p.node;
              }),
            );
          }
          for (const s of list) pillars.get(s.id)?.update(s);
        } catch {
          // hors de l'appli : pas d'écran
        }
      };

      void refreshRadios();
      void refreshSound();
      void refreshScreens();
      const timers = [
        pacedInterval(() => void refreshSound(), "controlsSound", true),
        pacedInterval(() => void refreshRadios(), "controlsRadios", true),
        pacedInterval(() => void refreshScreens(), "controlsScreens", true),
      ];
      return () => {
        alive = false;
        closeMenu();
        usb.stop();
        bt.stop();
        offRemote();
        timers.forEach((stop) => stop());
      };
    },
  },
};
