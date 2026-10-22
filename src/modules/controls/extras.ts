// Contrôles : trois idées d'Orbix (1.2.5), réécrites pour Ondine.
//
//   - la bande « Plus » en bas de l'onglet : « Applis », « Réseaux » et les
//     quatre boutons d'alimentation (verrouiller, veille, redémarrer,
//     éteindre) qu'il faut MAINTENIR appuyés une seconde (un anneau se
//     remplit ; lâcher avant annule) ;
//   - la page « Applis » : le volume de chaque appli qui a du son, avec son
//     niveau qui bouge et un bouton pour la couper (platform/app_volume.rs) ;
//   - la page « Réseaux » : les Wi-Fi à portée ; un réseau déjà connu de
//     Windows se rejoint d'un clic, un nouveau réseau ouvre la liste de
//     Windows (Ondine ne demande ni ne garde jamais de mot de passe Wi-Fi).
//
// Une page prend la place de l'onglet (comme la télécommande) ; « Retour »
// ramène les piliers. La logique sans DOM est dans extras-logic.ts.

import "../../styles/controls-extras.css";
import { errorText } from "../../core/log";
import type { ModuleApi } from "../../core/module-types";
import { pacedInterval } from "../../core/perf";
import { el } from "../../island/dom";
import {
  HOLD_MS,
  meterLevel,
  POWER_ACTIONS,
  POWER_DONE,
  POWER_NAMES,
  sameApps,
  wifiBars,
  wifiDetail,
  type AppVolume,
  type PowerAction,
  type WifiAnswer,
  type WifiNetwork,
} from "./extras-logic";

export type ExtraPage = "apps" | "wifi";

/** Pendant qu'on fait glisser un curseur d'appli, au plus un envoi tous les… */
const SEND_MS = 60;

/** Les pictogrammes au trait (24 × 24). */
const PATHS = {
  mixer: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  wifi: "M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5h.01",
  back: "M15 5l-7 7 7 7",
  speaker: "M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7",
  speakerOff: "M4 9h4l5-4v14l-5-4H4zM16.5 9.5l5 5M21.5 9.5l-5 5",
  lockSmall: "M8 11V8a4 4 0 0 1 8 0v3M6 11h12v9H6z",
  lock: "M8 11V8a4 4 0 0 1 8 0v3M6 11h12v9H6zM12 15v2",
  sleep: "M20 14.5A8.5 8.5 0 1 1 9.5 4a7.5 7.5 0 0 0 10.5 10.5z",
  restart: "M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4",
  shutdown: "M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0",
} as const;

function icon(kind: keyof typeof PATHS): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", PATHS[kind]);
  svg.append(path);
  return svg;
}

/** Quatre barres de signal, `n` allumées. */
function bars(n: number): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 20 16");
  svg.setAttribute("class", "ctl-wifi-bars");
  svg.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 4; i++) {
    const r = document.createElementNS(ns, "rect");
    const h = 4 + i * 3.5;
    r.setAttribute("x", String(1 + i * 5));
    r.setAttribute("y", String(15 - h));
    r.setAttribute("width", "3");
    r.setAttribute("height", String(h));
    r.setAttribute("rx", "1");
    if (i < n) r.setAttribute("class", "on");
    svg.append(r);
  }
  return svg;
}

function fail(api: ModuleApi, err: unknown) {
  api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "controls-error" });
}

// ── La bande « Plus » ────────────────────────────────────────────────────────

/** L'icône des notifications (au trait dans le style épuré : src/island/icon.ts). */
const POWER_ICON: Record<PowerAction, string> = { lock: "🔒", sleep: "🌙", restart: "🔄", shutdown: "🔌" };

/** Un bouton d'alimentation : il faut le maintenir appuyé HOLD_MS. */
function powerButton(api: ModuleApi, action: PowerAction): HTMLButtonElement {
  const name = POWER_NAMES[action];
  const button = el(
    "button",
    { class: "ctl-power", type: "button", "data-action": action, title: `${name} (maintenir appuyé)`, "aria-label": `${name} : maintenir appuyé une seconde` },
    el("span", { class: "ctl-power-ring", "aria-hidden": "true" }),
    icon(action),
  ) as HTMLButtonElement;
  button.style.setProperty("--hold", `${HOLD_MS}ms`);
  let timer: number | undefined;
  const cancel = () => {
    window.clearTimeout(timer);
    timer = undefined;
    button.classList.remove("holding");
  };
  const start = () => {
    if (timer !== undefined || button.disabled) return;
    button.classList.add("holding");
    timer = window.setTimeout(
      api.handler(async () => {
        timer = undefined;
        button.classList.remove("holding");
        button.classList.add("fired");
        window.setTimeout(() => button.classList.remove("fired"), 600);
        try {
          await api.invoke("power_now", { action });
          api.notify({ title: POWER_DONE[action], icon: POWER_ICON[action], priority: "low", key: "controls-power" });
        } catch (err) {
          fail(api, err);
        }
      }),
      HOLD_MS,
    );
  };
  button.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    button.setPointerCapture(e.pointerId);
    start();
  });
  button.addEventListener("pointerup", cancel);
  button.addEventListener("pointercancel", cancel);
  button.addEventListener("lostpointercapture", cancel);
  // Au clavier : Entrée ou Espace maintenus, pareil.
  button.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
      e.preventDefault();
      start();
    }
  });
  button.addEventListener("keyup", (e) => (e.key === "Enter" || e.key === " ") && cancel());
  button.addEventListener("blur", cancel);
  // Un simple clic (trop court) rappelle comment faire.
  button.addEventListener(
    "click",
    api.handler(() => {
      if (button.classList.contains("fired")) return;
      api.notify({ title: `${name} : maintenez le bouton appuyé une seconde`, icon: POWER_ICON[action], priority: "low", key: "controls-power-hint", durationMs: 2200 });
    }),
  );
  return button;
}

/** La bande du bas : « Applis », « Réseaux », et les boutons d'alimentation (réglage powerButtons). */
export function moreStrip(api: ModuleApi, open: (page: ExtraPage) => void) {
  const pageButton = (page: ExtraPage, kind: keyof typeof PATHS, label: string, title: string) =>
    el("button", { class: "btn small ctl-more-btn", type: "button", title, onclick: api.handler(() => open(page)) }, icon(kind), el("span", {}, label));
  const power = el("div", { class: "ctl-power-row", role: "group", "aria-label": "Alimentation" }, ...POWER_ACTIONS.map((a) => powerButton(api, a)));
  const node = el(
    "div",
    { class: "ctl-card ctl-more", role: "group", "aria-label": "Plus de contrôles" },
    pageButton("apps", "mixer", "Applis", "Le volume de chaque appli"),
    pageButton("wifi", "wifi", "Réseaux", "Les réseaux Wi-Fi à portée"),
    power,
  );
  const sync = () => {
    power.hidden = api.settings().powerButtons === false;
  };
  sync();
  return { node, sync };
}

/** L'en-tête d'une page : « Retour » et le titre. */
function pageHead(title: string, back: () => void, ...extra: HTMLElement[]) {
  return el(
    "div",
    { class: "ctl-page-head" },
    el("button", { class: "btn small ctl-back", type: "button", title: "Retour aux contrôles", "aria-label": "Retour", onclick: back }, icon("back")),
    el("b", { class: "ctl-page-title" }, title),
    ...extra,
  );
}

// ── La page « Applis » ───────────────────────────────────────────────────────

/** Une ligne du mélangeur ; mise à jour sur place à chaque lecture. */
function appRow(api: ModuleApi, app: AppVolume) {
  let current = app;
  let held = false;
  let level = 0;
  let lastSent = 0;
  let pending: number | undefined;
  const range = el("input", { type: "range", min: 0, max: 100, step: 1, class: "ctl-app-range", "aria-label": `Volume : ${app.name}` }) as HTMLInputElement;
  const pct = el("span", { class: "ctl-app-pct" });
  const meter = el("span", { class: "ctl-app-meter", "aria-hidden": "true" }, el("i"));
  const mute = el("button", { class: "ctl-app-mute", type: "button" }) as HTMLButtonElement;
  // Le nom vient de l'appli (ou de son exécutable) : pas de traduction, sauf « Sons système ».
  const name = el("span", { class: "ctl-app-name", title: app.name, ...(app.key === "system" ? {} : { "data-no-i18n": true }) }, app.name);
  const node = el("div", { class: "ctl-app" }, el("div", { class: "ctl-app-top" }, name, pct), el("div", { class: "ctl-app-bottom" }, mute, el("span", { class: "ctl-app-track" }, meter, range)));

  const paint = () => {
    if (!held) range.value = String(current.volume);
    range.style.setProperty("--v", `${held ? range.value : current.volume}%`);
    pct.textContent = current.muted ? "coupé" : `${held ? range.value : current.volume} %`;
    node.classList.toggle("muted", current.muted);
    node.classList.toggle("idle", !current.active);
    mute.replaceChildren(icon(current.muted ? "speakerOff" : "speaker"));
    mute.title = current.muted ? "Réactiver le son de l'appli" : "Couper le son de l'appli";
    mute.setAttribute("aria-pressed", String(current.muted));
  };
  const send = (volume: number) => {
    window.clearTimeout(pending);
    const go = () => {
      lastSent = Date.now();
      api.invoke("set_app_volume", { key: current.key, volume }).catch((err) => fail(api, err));
    };
    const wait = SEND_MS - (Date.now() - lastSent);
    if (wait <= 0) go();
    else pending = window.setTimeout(go, wait);
  };
  range.addEventListener("pointerdown", () => (held = true));
  const release = () => {
    held = false;
    paint();
  };
  range.addEventListener("pointerup", release);
  range.addEventListener("pointercancel", release);
  range.addEventListener("input", () => {
    const volume = Number(range.value);
    // Monter le volume d'une appli coupée la réactive, comme dans Windows.
    if (current.muted && volume > 0) {
      current = { ...current, muted: false };
      api.invoke("set_app_volume", { key: current.key, muted: false }).catch((err) => fail(api, err));
    }
    current = { ...current, volume };
    paint();
    send(volume);
  });
  mute.addEventListener(
    "click",
    api.handler(async () => {
      current = { ...current, muted: !current.muted };
      paint();
      try {
        await api.invoke("set_app_volume", { key: current.key, muted: current.muted });
      } catch (err) {
        current = { ...current, muted: !current.muted };
        paint();
        fail(api, err);
      }
    }),
  );
  paint();
  return {
    node,
    update(next: AppVolume) {
      // Le niveau qui bouge : il monte tout de suite, redescend en douceur.
      level = meterLevel(level, next.muted ? 0 : next.peak);
      meter.style.setProperty("--m", String(Math.round(level * 100) / 100));
      if (held) return; // c'est la main qui décide
      if (next.volume === current.volume && next.muted === current.muted && next.active === current.active) return;
      current = next;
      paint();
    },
  };
}

export function appsPage(api: ModuleApi, back: () => void) {
  const list = el("div", { class: "ctl-page-list ctl-apps" });
  const node = el(
    "div",
    { class: "ctl-page", "data-island-fit": true },
    pageHead("Volume des applis", back),
    list,
    el("p", { class: "muted ctl-page-note" }, "Relatif au volume général, comme le mélangeur de Windows."),
  );
  let shown: AppVolume[] = [];
  let rows = new Map<string, ReturnType<typeof appRow>>();
  let busy = false;
  let alive = true;
  const refresh = async () => {
    if (busy) return;
    busy = true;
    try {
      const apps = await api.invoke<AppVolume[]>("app_volumes");
      if (!alive) return;
      if (!sameApps(shown, apps)) {
        shown = apps;
        rows = new Map(apps.map((a) => [a.key, appRow(api, a)]));
        list.replaceChildren(...[...rows.values()].map((r) => r.node));
        if (!apps.length) list.append(el("p", { class: "muted ctl-page-empty" }, "Aucune appli ne fait de son en ce moment. Lancez une musique ou une vidéo : elle apparaîtra ici."));
      }
      for (const a of apps) rows.get(a.key)?.update(a);
    } catch {
      // hors de l'appli (navigateur) : la liste reste vide
      if (alive && !list.childElementCount) list.append(el("p", { class: "muted ctl-page-empty" }, "Aucune appli ne fait de son en ce moment. Lancez une musique ou une vidéo : elle apparaîtra ici."));
    } finally {
      busy = false;
    }
  };
  void refresh();
  const stop = pacedInterval(() => void refresh(), "controlsMixer", true);
  return {
    node,
    stop() {
      alive = false;
      stop();
    },
  };
}

// ── La page « Réseaux » ──────────────────────────────────────────────────────

export function wifiPage(api: ModuleApi, back: () => void) {
  const list = el("div", { class: "ctl-page-list ctl-wifi" });
  const others = el(
    "button",
    { class: "btn small", type: "button", title: "La liste des réseaux de Windows (nouveau réseau, mot de passe)", onclick: api.handler(() => api.invoke("open_wifi_settings", { page: "networks" }).catch((err) => fail(api, err))) },
    "Autre réseau…",
  );
  const node = el("div", { class: "ctl-page", "data-island-fit": true }, pageHead("Réseaux Wi-Fi", back, others), list);
  let alive = true;
  let busy = false;
  let shown = "";
  /** Le réseau qu'on est en train de rejoindre (ou de quitter). */
  let working: string | null = null;

  const act = async (n: WifiNetwork) => {
    if (working) return;
    if (!n.known && !n.connected) {
      // Nouveau réseau : Windows demande le mot de passe lui-même.
      await api.invoke("open_wifi_settings", { page: "networks" }).catch((err) => fail(api, err));
      return;
    }
    working = n.ssid;
    shown = "";
    try {
      if (n.connected) {
        await api.invoke("wifi_disconnect");
        api.notify({ title: "Wi-Fi déconnecté", icon: "📶", priority: "low", key: "controls-wifi" });
      } else {
        await api.invoke("wifi_connect", { ssid: n.ssid });
        api.notify({ title: `Connexion à « ${n.ssid} »…`, icon: "📶", priority: "low", key: "controls-wifi" });
      }
    } catch (err) {
      fail(api, err);
    }
    // La carte met quelques secondes : on relit un peu plus tard.
    window.setTimeout(() => {
      working = null;
      shown = "";
      void refresh();
    }, 2500);
  };

  const row = (n: WifiNetwork) =>
    el(
      "div",
      { class: `ctl-net${n.connected ? " on" : ""}`, title: `${n.ssid} : signal ${n.signal} %` },
      bars(wifiBars(n.signal)),
      el(
        "span",
        { class: "ctl-net-text" },
        el("span", { class: "ctl-net-name", "data-no-i18n": true }, n.ssid),
        el("small", { class: "muted" }, working === n.ssid ? (n.connected ? "Déconnexion…" : "Connexion…") : wifiDetail(n)),
      ),
      n.secure ? el("span", { class: "ctl-net-lock", title: "Protégé par un mot de passe" }, icon("lockSmall")) : "",
      el(
        "button",
        { class: `btn small${n.connected ? "" : " primary"}`, type: "button", disabled: working !== null, onclick: api.handler(() => act(n)) },
        n.connected ? "Se déconnecter" : n.known ? "Se connecter" : "Ouvrir Windows",
      ),
    );

  const problem = (code: string, message: string) => {
    const parts: (HTMLElement | string)[] = [el("p", { class: "muted ctl-page-empty" }, message)];
    if (code === "location") {
      parts.push(
        el("p", { class: "muted ctl-page-note" }, "Depuis Windows 11 24H2 : Paramètres, Confidentialité et sécurité, Localisation, accès des applications de bureau. Ondine ne lit jamais votre position."),
        el(
          "button",
          { class: "btn small", type: "button", onclick: api.handler(() => api.invoke("open_wifi_settings", { page: "location" }).catch((err) => fail(api, err))) },
          "Ouvrir les paramètres de localisation",
        ),
      );
    }
    return el("div", { class: "ctl-page-problem" }, ...parts);
  };

  const refresh = async (scan = false) => {
    if (busy) return;
    busy = true;
    try {
      const r = await api.invoke<WifiAnswer>("wifi_networks", { scan });
      if (!alive) return;
      const key = JSON.stringify([r, working]);
      if (key === shown) return;
      shown = key;
      if ("error" in r) list.replaceChildren(problem(r.error, r.message));
      else if (!r.networks.length) list.replaceChildren(el("p", { class: "muted ctl-page-empty" }, "Recherche des réseaux…"));
      else list.replaceChildren(...r.networks.map(row));
    } catch {
      if (alive && !shown) list.replaceChildren(el("p", { class: "muted ctl-page-empty" }, "Les réseaux Wi-Fi ne s'affichent que dans l'appli Ondine."));
      shown = "offline";
    } finally {
      busy = false;
    }
  };
  // À l'ouverture : la carte cherche (réponse en quelques secondes), puis on relit.
  void refresh(true);
  const stop = pacedInterval(() => void refresh(), "controlsWifi", true);
  return {
    node,
    stop() {
      alive = false;
      stop();
    },
  };
}
