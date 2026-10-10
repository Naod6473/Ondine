// Contrôles : la bande du bas « Bluetooth et bureau » :
//   - la batterie des appareils Bluetooth (écouteurs, souris, clavier…) telle
//     que Windows la connaît, relue toutes les 30 s tant que l'onglet est
//     ouvert ; en rouge sous le seuil du réglage btBatteryLow ;
//   - « Bureau propre » : cacher / montrer les icônes du bureau d'un clic ;
//   - « Télécommande » (si le réglage phoneRemote est activé, voir remote.ts).
// Et la notification quand un appareil passe sous le seuil
// ("controls.bt-battery-low", envoyée par le fil de fond du Rust, toutes les 5 min).

import { errorText } from "../../core/log";
import type { ModuleApi } from "../../core/module-types";
import { el } from "../../island/dom";
import { startRemote } from "./remote";

export interface BtBattery {
  name: string;
  percent: number;
  /** Connecté en ce moment (null : Windows ne le dit pas). */
  connected: boolean | null;
}

/** « Casque : 12 % » ; « (éteint) » quand Windows dit qu'il n'est pas connecté. */
export function btLabel(b: BtBattery): string {
  return `${b.name} : ${b.percent} %${b.connected === false ? " (éteint)" : ""}`;
}

/** La notification « batterie faible ». */
export function wireBtNotifications(api: ModuleApi): () => void {
  return api.on("controls.bt-battery-low", (msg) => {
    const p = (msg.payload ?? {}) as { name?: string; percent?: number };
    if (!p.name) return;
    api.notify({ title: `Batterie faible : ${p.name} (${p.percent ?? 0} %)`, icon: "🪫", priority: "normal", key: `bt-${p.name}` });
  });
}

export function btStrip(api: ModuleApi) {
  const list = el("div", { class: "ctl-usb-list" });
  const desk = el("button", { class: "btn small", type: "button" }, "Cacher les icônes du bureau") as HTMLButtonElement;
  const remote = el(
    "button",
    { class: "btn small", type: "button", title: "Piloter la musique, le volume et les diapositives depuis le téléphone", onclick: api.handler(() => startRemote(api)) },
    "📱 Télécommande",
  ) as HTMLButtonElement;
  const node = el(
    "div",
    { class: "ctl-card ctl-usb ctl-bt", role: "group", "aria-label": "Bluetooth et bureau", hidden: true },
    el("span", { class: "ctl-usb-title" }, "Batteries Bluetooth"),
    list,
    remote,
    desk,
  );
  let devices: BtBattery[] = [];
  let hidden: boolean | null = null;
  let busy = false;
  let shown = "";

  const draw = () => {
    const threshold = Number(api.settings().btBatteryLow ?? 15);
    const remoteOn = api.settings().phoneRemote === true;
    const key = JSON.stringify([devices, hidden, busy, threshold, remoteOn]);
    if (key === shown) return;
    shown = key;
    remote.hidden = !remoteOn;
    node.hidden = devices.length === 0 && hidden === null && !remoteOn;
    list.replaceChildren(
      ...devices.map((b) => {
        const low = threshold > 0 && b.percent < threshold && b.connected !== false;
        // Le nom de l'appareil vient de Windows (choisi par le fabricant) : pas de traduction.
        return el(
          "div",
          { class: `ctl-usb-item ctl-bt-item${low ? " low" : ""}${b.connected === false ? " off" : ""}`, title: btLabel(b) },
          el("span", { class: "ctl-usb-name", "data-no-i18n": true }, b.name),
          el("span", { class: "ctl-bt-meter", style: `--p:${b.percent}%` }),
          el("span", { class: "ctl-usb-letter" }, `${b.percent} %`),
        );
      }),
    );
    if (!devices.length) list.append(el("span", { class: "muted ctl-bt-none" }, "Aucun appareil ne donne sa batterie"));
    desk.hidden = hidden === null;
    desk.disabled = busy;
    desk.textContent = hidden ? "Montrer les icônes du bureau" : "Cacher les icônes du bureau";
    desk.setAttribute("aria-pressed", String(!!hidden));
  };

  desk.addEventListener(
    "click",
    api.handler(async () => {
      if (busy || hidden === null) return;
      busy = true;
      draw();
      try {
        const r = await api.invoke<{ hidden: boolean }>("set_desktop_icons", { hidden: !hidden });
        hidden = r.hidden;
        api.notify({ title: hidden ? "Icônes du bureau cachées" : "Icônes du bureau de retour", icon: "🧹", priority: "low", key: "controls-desk" });
      } catch (err) {
        api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "controls-desk" });
      } finally {
        busy = false;
        draw();
      }
    }),
  );

  const refreshDesk = async () => {
    try {
      const r = await api.invoke<{ hidden: boolean | null }>("desktop_icons");
      if (!busy) hidden = r.hidden;
    } catch {
      hidden = null; // hors de l'appli
    }
    draw();
  };
  const refreshBt = async () => {
    try {
      devices = await api.invoke<BtBattery[]>("bt_batteries");
    } catch {
      devices = [];
    }
    draw();
  };

  void refreshBt();
  void refreshDesk();
  const timer = window.setInterval(() => void refreshBt(), 30_000);
  return {
    node,
    /** Relu avec les radios (toutes les 2 s) : l'état du bureau a pu changer (menu du bureau). */
    refreshDesk,
    stop: () => window.clearInterval(timer),
  };
}
