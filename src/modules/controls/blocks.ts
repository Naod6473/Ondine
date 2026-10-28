// Contrôles en blocs qui se déplient (1.2.5, style A choisi par Simon).
//
// La page d'accueil de l'onglet garde l'essentiel : les pastilles des
// connexions et du micro, les piliers Son et Écran, et quatre blocs (Écrans,
// Appareils, Outils, Alimentation). Un clic sur un bloc le déplie : sa page
// grandit depuis l'endroit du clic et prend la place de l'onglet ; « Retour »
// (ou Échap) ramène les blocs. Rien n'a disparu, tout a été rangé :
//   - Son : la sortie audio, le volume, le micro, le volume de chaque appli ;
//   - Écrans (screens.ts) : Windows+P, l'écran principal, la luminosité de
//     chaque écran, le mode sombre, la veilleuse, éteindre seulement l'écran ;
//   - Appareils : les clés USB, la batterie Bluetooth, la télécommande ;
//   - Outils : garder au premier plan, Bureau propre, le mode nettoyage
//     (clean.ts), l'aide-mémoire des raccourcis (cheat.ts) ;
//   - Alimentation : les quatre boutons à maintenir (extras.ts).

import "../../styles/controls-blocks.css";
import type { ModuleApi } from "../../core/module-types";
import { el } from "../../island/dom";
import { appsList, fail, pageHead, powerButton } from "./extras";
import { POWER_ACTIONS } from "./extras-logic";
import type { UsbDrive } from "./usb-text";
import { usbStrip } from "./usb";

export type BlockPage = "net" | "son" | "ecr" | "app" | "out" | "pow";

/** Les pictogrammes au trait des blocs (24 × 24). */
const PATHS = {
  screens: "M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 20h8M12 16v4",
  devices: "M4.5 5h10A1.5 1.5 0 0 1 16 6.5v6a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 3 12.5v-6A1.5 1.5 0 0 1 4.5 5zM18.5 8h2a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM6 18h7",
  tools: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z",
  power: "M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0",
  chevron: "M9 6l6 6-6 6",
  sparkle: "M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8zM19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z",
  keyboard: "M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10",
  speaker: "M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7",
  speakerOff: "M4 9h4l5-4v14l-5-4H4zM16.5 9.5l5 5M21.5 9.5l-5 5",
  mic: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4",
  micOff: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4M4 4l16 16",
  headphones: "M4 18v-6a8 8 0 0 1 16 0v6M3 15h4v6H3zM17 15h4v6h-4z",
  battery: "M3 8h15a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM22 11v2M5 11v2",
  eject: "M5 15h14L12 6zM5 19h14",
  pin: "M9 3h6M10 3v6l-3 4h10l-3-4V3M12 13v8",
} as const;

export function blockIcon(kind: keyof typeof PATHS): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", PATHS[kind]);
  svg.append(path);
  return svg;
}

/** Une valeur partagée entre la page d'accueil (qui la relit) et une page ouverte. */
export function hub<T>(initial: T) {
  let last = initial;
  const fns = new Set<(v: T) => void>();
  return {
    get: () => last,
    set(v: T) {
      last = v;
      fns.forEach((f) => f(v));
    },
    /** Appelle `f` tout de suite puis à chaque changement ; renvoie de quoi arrêter. */
    listen(f: (v: T) => void) {
      fns.add(f);
      f(last);
      return () => void fns.delete(f);
    },
  };
}
export type Hub<T> = ReturnType<typeof hub<T>>;

/** Une page dépliée : son contenu et ce qu'il faut arrêter en la fermant. */
export interface Page {
  node: HTMLElement;
  stop: () => void;
}

/**
 * La page grandit depuis le bloc cliqué : son point de départ (en % de la
 * zone de l'onglet) devient l'origine de l'animation (controls-blocks.css).
 */
export function unfoldFrom(page: HTMLElement, from: Element | null, host: Element) {
  page.classList.add("ctl-unfold");
  if (!from) return;
  const h = host.getBoundingClientRect();
  const r = from.getBoundingClientRect();
  if (!h.width || !h.height) return;
  const x = ((r.left + r.width / 2 - h.left) / h.width) * 100;
  const y = ((r.top + r.height / 2 - h.top) / h.height) * 100;
  page.style.setProperty("--ox", `${Math.round(Math.max(0, Math.min(100, x)))}%`);
  page.style.setProperty("--oy", `${Math.round(Math.max(0, Math.min(100, y)))}%`);
}

/** Le petit bouton « Tout › » / « Son › » qui ouvre un bloc. */
export function moreButton(label: string, title: string, onClick: (from: HTMLElement) => void) {
  const b = el("button", { class: "ctl-more-link", type: "button", title }, el("span", {}, label), blockIcon("chevron")) as HTMLButtonElement;
  b.addEventListener("click", () => onClick(b));
  return b;
}

// ── La carte des blocs (page d'accueil) ─────────────────────────────────────

export function blocksCard(api: ModuleApi, open: (page: BlockPage, from: HTMLElement) => void) {
  const block = (page: BlockPage, kind: keyof typeof PATHS, name: string, title: string) => {
    const sub = el("span", { class: "ctl-block-sub" });
    const b = el(
      "button",
      { class: "ctl-block", type: "button", "data-page": page, title: `${name} · ${title}` },
      el("span", { class: "ctl-block-icon" }, blockIcon(kind)),
      el("span", { class: "ctl-block-name" }, name),
      sub,
    ) as HTMLButtonElement;
    b.addEventListener(
      "click",
      api.handler(() => open(page, b)),
    );
    return { b, sub };
  };
  const screens = block("ecr", "screens", "Écrans", "Windows+P, écran principal, luminosité, mode sombre, veilleuse");
  const devices = block("app", "devices", "Appareils", "Clés USB, batterie des appareils Bluetooth");
  const tools = block("out", "tools", "Outils", "Premier plan, Bureau propre, mode nettoyage, aide-mémoire");
  const power = block("pow", "power", "Alimentation", "Verrouiller, veille, redémarrer, éteindre");
  tools.sub.textContent = "4 outils";
  power.sub.textContent = "Maintenir 1 s";
  const node = el("div", { class: "ctl-card ctl-blocks", role: "group", "aria-label": "Plus de contrôles" }, screens.b, devices.b, tools.b, power.b);
  return {
    node,
    /** Les sous-titres (mode d'affichage, appareils) et le bloc Alimentation (réglage powerButtons). */
    sync(info: { mode?: string; devices?: string }) {
      if (info.mode !== undefined) screens.sub.textContent = info.mode;
      if (info.devices !== undefined) devices.sub.textContent = info.devices;
      power.b.hidden = api.settings().powerButtons === false;
      node.classList.toggle("three", power.b.hidden);
    },
  };
}

// ── Page « Son » ────────────────────────────────────────────────────────────

export interface Level {
  volume: number;
  muted: boolean;
}
export interface SoundState {
  speakers: Level | null;
  microphone: Level | null;
}
interface Output {
  id: string;
  name: string;
  default: boolean;
}

const SEND_MS = 60;

/** Une ligne « volume » (haut-parleurs ou micro), comme celles des applis. */
function levelRow(api: ModuleApi, device: "speakers" | "microphone", sound: Hub<SoundState | null>) {
  const label = device === "speakers" ? "Haut-parleurs" : "Micro";
  const range = el("input", { type: "range", min: 0, max: 100, step: 1, class: "ctl-app-range", "aria-label": `Volume : ${label}` }) as HTMLInputElement;
  const pct = el("span", { class: "ctl-app-pct" });
  const mute = el("button", { class: "ctl-app-mute", type: "button" }) as HTMLButtonElement;
  const node = el(
    "div",
    { class: "ctl-app ctl-level" },
    el("div", { class: "ctl-app-top" }, el("span", { class: "ctl-app-name" }, label), pct),
    el("div", { class: "ctl-app-bottom" }, mute, el("span", { class: "ctl-app-track" }, range)),
  );
  let current: Level | null = null;
  let held = false;
  let lastSent = 0;
  let pending: number | undefined;
  const paint = () => {
    node.classList.toggle("off", !current);
    range.disabled = !current;
    mute.disabled = !current;
    if (!current) {
      pct.textContent = device === "speakers" ? "Pas de son" : "Pas de micro";
      mute.replaceChildren(blockIcon(device === "speakers" ? "speakerOff" : "micOff"));
      return;
    }
    if (!held) range.value = String(current.volume);
    pct.textContent = current.muted ? "coupé" : `${held ? range.value : current.volume} %`;
    node.classList.toggle("muted", current.muted);
    mute.replaceChildren(blockIcon(device === "speakers" ? (current.muted ? "speakerOff" : "speaker") : current.muted ? "micOff" : "mic"));
    mute.title = current.muted ? "Réactiver" : "Couper";
    mute.setAttribute("aria-pressed", String(current.muted));
  };
  range.addEventListener("pointerdown", () => (held = true));
  const release = () => {
    held = false;
    paint();
  };
  range.addEventListener("pointerup", release);
  range.addEventListener("pointercancel", release);
  range.addEventListener("input", () => {
    if (!current) return;
    const volume = Number(range.value);
    if (current.muted && volume > 0) {
      api.invoke("set_muted", { device, muted: false }).catch((err) => fail(api, err));
      current = { ...current, muted: false };
    }
    current = { ...current, volume };
    paint();
    window.clearTimeout(pending);
    const go = () => {
      lastSent = Date.now();
      api.invoke("set_volume", { device, volume }).catch((err) => fail(api, err));
    };
    const wait = SEND_MS - (Date.now() - lastSent);
    if (wait <= 0) go();
    else pending = window.setTimeout(go, wait);
  });
  mute.addEventListener(
    "click",
    api.handler(async () => {
      if (!current) return;
      current = { ...current, muted: !current.muted };
      paint();
      try {
        await api.invoke("set_muted", { device, muted: current.muted });
      } catch (err) {
        fail(api, err);
      }
    }),
  );
  const off = sound.listen((s) => {
    if (held) return;
    current = s ? s[device] : null;
    paint();
  });
  return { node, stop: off };
}

export function sonPage(api: ModuleApi, back: () => void, sound: Hub<SoundState | null>): Page {
  const outputs = el("div", { class: "ctl-chips", role: "radiogroup", "aria-label": "Le son sort sur" });
  const speakers = levelRow(api, "speakers", sound);
  const mic = levelRow(api, "microphone", sound);
  const apps = appsList(api);
  const node = el(
    "div",
    { class: "ctl-page ctl-block-page", "data-island-fit": true },
    pageHead("Son", back),
    el(
      "div",
      { class: "ctl-page-list" },
      el("p", { class: "ctl-section" }, "Le son sort sur"),
      outputs,
      el("p", { class: "ctl-section" }, "Volume et micro"),
      speakers.node,
      mic.node,
      el("p", { class: "ctl-section" }, "Chaque appli"),
      apps.node,
      el("p", { class: "muted ctl-page-note" }, "Relatif au volume général, comme le mélangeur de Windows."),
    ),
  );
  let alive = true;
  const drawOutputs = async () => {
    let list: Output[] = [];
    try {
      list = await api.invoke<Output[]>("outputs");
    } catch {
      // hors de l'appli
    }
    if (!alive) return;
    outputs.replaceChildren(
      ...list.map((o) =>
        el(
          "button",
          {
            class: `ctl-chip${o.default ? " on" : ""}`,
            type: "button",
            role: "radio",
            "aria-checked": String(o.default),
            title: o.name,
            "data-no-i18n": true,
            onclick: api.handler(async () => {
              if (o.default) return;
              try {
                await api.invoke("set_output", { id: o.id });
                api.notify({ title: `Le son sort sur ${o.name}`, icon: "🎧", priority: "low", key: "controls-output" });
              } catch (err) {
                fail(api, err);
              }
              void drawOutputs();
            }),
          },
          blockIcon("headphones"),
          el("span", {}, o.name),
        ),
      ),
    );
    if (!list.length) outputs.append(el("span", { class: "muted ctl-page-empty" }, "Aucune sortie audio"));
  };
  void drawOutputs();
  return {
    node,
    stop() {
      alive = false;
      speakers.stop();
      mic.stop();
      apps.stop();
    },
  };
}

// ── Page « Appareils » ──────────────────────────────────────────────────────

export function devicesPage(api: ModuleApi, back: () => void, usb: Hub<UsbDrive[]>, bt: HTMLElement): Page {
  const strip = usbStrip(api);
  const none = el("p", { class: "muted ctl-page-empty" }, "Aucune clé ni disque USB branché.");
  const node = el(
    "div",
    { class: "ctl-page ctl-block-page", "data-island-fit": true },
    pageHead("Appareils", back),
    el("div", { class: "ctl-page-list" }, el("p", { class: "ctl-section" }, "Clés et disques USB"), strip.node, none, bt),
  );
  const off = usb.listen((list) => {
    strip.update(list);
    none.hidden = list.length > 0;
  });
  return {
    node,
    stop() {
      off();
      strip.stop();
    },
  };
}

// ── Page « Outils » ─────────────────────────────────────────────────────────

/** Une carte d'outil : un pictogramme, un titre, une phrase, et le bouton. */
function tool(kind: keyof typeof PATHS, title: string, text: string, action: HTMLElement, isNew = false) {
  return el(
    "div",
    { class: "ctl-tool" },
    el("span", { class: "ctl-block-icon" }, blockIcon(kind)),
    el("span", { class: "ctl-tool-text" }, el("b", {}, title, ...(isNew ? [el("em", { class: "ctl-new" }, "nouveau")] : [])), el("span", { class: "muted" }, text)),
    action,
  );
}

export function toolsPage(
  api: ModuleApi,
  back: () => void,
  parts: { pin: HTMLElement; desk: HTMLElement; startClean: () => void; openCheat: (from: HTMLElement) => void },
): Page {
  const seconds = Number(api.settings().cleanSeconds ?? 30) || 30;
  const clean = el("button", { class: "btn small", type: "button", onclick: api.handler(() => parts.startClean()) }, `Lancer (${seconds} s)`) as HTMLButtonElement;
  const cheat = el("button", { class: "btn small", type: "button" }, "Ouvrir") as HTMLButtonElement;
  cheat.addEventListener("click", () => parts.openCheat(cheat));
  const hold = api.settings().cheatHold !== "";
  const node = el(
    "div",
    { class: "ctl-page ctl-block-page", "data-island-fit": true },
    pageHead("Outils", back),
    el(
      "div",
      { class: "ctl-page-list ctl-tools" },
      tool("pin", "Garder au premier plan", "La fenêtre où vous travailliez reste devant les autres. Un second appui la relâche.", parts.pin),
      tool("screens", "Bureau propre", "Cache les icônes du bureau d'un clic (les fichiers ne bougent pas).", parts.desk),
      tool("sparkle", "Mode nettoyage", `Le clavier et la souris sont bloqués ${seconds} secondes, le temps de les essuyer. Échap maintenue 2 s arrête plus tôt.`, clean, true),
      tool(
        "keyboard",
        "Aide-mémoire des raccourcis",
        hold ? "Les raccourcis de l'appli ouverte, de Windows et d'Ondine. Ou maintenez Ctrl gauche n'importe où." : "Les raccourcis de l'appli ouverte, de Windows et d'Ondine.",
        cheat,
        true,
      ),
    ),
  );
  return { node, stop() {} };
}

// ── Page « Alimentation » ───────────────────────────────────────────────────

export function powerPage(api: ModuleApi, back: () => void): Page {
  const names: Record<(typeof POWER_ACTIONS)[number], string> = { lock: "Verrouiller", sleep: "Veille", restart: "Redémarrer", shutdown: "Éteindre" };
  const node = el(
    "div",
    { class: "ctl-page ctl-block-page", "data-island-fit": true },
    pageHead("Alimentation", back),
    el("p", { class: "muted ctl-page-note" }, "Maintenez un bouton une seconde : l'anneau se remplit. Lâcher avant annule."),
    el(
      "div",
      { class: "ctl-power-grid", role: "group", "aria-label": "Alimentation" },
      ...POWER_ACTIONS.map((a) => el("div", { class: "ctl-power-cell" }, powerButton(api, a), el("span", {}, names[a]))),
    ),
    el("p", { class: "muted ctl-page-note" }, "Les applis ne sont jamais fermées de force : une appli qui a un document à enregistrer peut arrêter l'arrêt."),
  );
  return { node, stop() {} };
}
