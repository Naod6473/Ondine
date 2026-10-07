// Clés USB et disques amovibles, dans le module Contrôles :
//   - une bande en bas de l'onglet, avec chaque clé (nom, lettre, « Éjecter ») ;
//     cachée quand aucune clé n'est branchée ;
//   - une notification quand une clé est branchée (« Ouvrir », « Éjecter »),
//     et le résultat d'une éjection (« Vous pouvez retirer la clé E: … », ou
//     qui bloque).
//
// Le Rust (src-tauri/src/modules/controls.rs, platform/eject.rs) liste les
// lecteurs et les éjecte dans un fil à part : l'éjection peut prendre quelques
// secondes, l'île ne se fige pas. Le résultat arrive par "controls.usb-ejected".

import { errorText } from "../../core/log";
import type { ModuleApi } from "../../core/module-types";
import { el } from "../../island/dom";
import { driveName, ejectMessage, pluggedTitle, type EjectResult, type UsbDrive } from "./usb-text";

/** Demande l'éjection. La réponse arrive plus tard, par "controls.usb-ejected". */
async function ejectDrive(api: ModuleApi, d: UsbDrive): Promise<boolean> {
  try {
    await api.invoke("eject", { root: d.root });
    return true;
  } catch (err) {
    api.notify({ title: errorText(err), icon: "⚠️", priority: "normal", key: `usb-${d.letter}` });
    return false;
  }
}

/** Les notifications : clé branchée, résultat d'une éjection. Renvoie de quoi se désabonner. */
export function wireUsbNotifications(api: ModuleApi): () => void {
  const offAdded = api.on("controls.usb-added", (msg) => {
    const d = msg.payload as UsbDrive | null;
    if (!d?.root) return;
    api.notify({
      title: pluggedTitle(d),
      icon: "🔌",
      priority: "normal",
      // Même clé que le résultat de l'éjection : il remplacera cette notification.
      key: `usb-${d.letter}`,
      durationMs: 12_000,
      actions: [
        {
          label: "Ouvrir",
          run: async () => {
            try {
              await api.invoke("open_drive", { root: d.root });
            } catch (err) {
              api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: `usb-${d.letter}` });
            }
          },
        },
        { label: "Éjecter", run: () => void ejectDrive(api, d) },
      ],
    });
  });
  const offEjected = api.on("controls.usb-ejected", (msg) => {
    const r = msg.payload as EjectResult | null;
    if (!r?.root) return;
    const m = ejectMessage(r);
    api.notify({
      title: m.title,
      body: m.body,
      icon: m.ok ? "✅" : "⚠️",
      // Refusé : en alerte, pour qu'on ne retire pas la clé quand même.
      priority: m.ok ? "normal" : "high",
      key: `usb-${r.letter}`,
      durationMs: m.ok ? 8_000 : 15_000,
    });
  });
  return () => {
    offAdded();
    offEjected();
  };
}

/** La bande « Clés USB et disques amovibles » de l'onglet (cachée sans clé). */
export function usbStrip(api: ModuleApi) {
  const list = el("div", { class: "ctl-usb-list" });
  const node = el(
    "div",
    { class: "ctl-card ctl-usb", role: "group", "aria-label": "Clés USB et disques amovibles", hidden: true },
    el("span", { class: "ctl-usb-title" }, "Clés USB et disques amovibles"),
    list,
  );
  /** Éjections demandées d'ici, en attente de la réponse du Rust. */
  const asked = new Set<string>();
  let drives: UsbDrive[] = [];
  let shown = "";

  const draw = () => {
    const key = JSON.stringify(drives.map((d) => [d.root, d.label, d.removable, !!d.ejecting || asked.has(d.root)]));
    if (key === shown) return;
    shown = key;
    node.hidden = drives.length === 0;
    list.replaceChildren(
      ...drives.map((d) => {
        const busy = !!d.ejecting || asked.has(d.root);
        // Le nom du volume est écrit par l'utilisateur : pas de traduction.
        const name = el("span", d.label.trim() ? { class: "ctl-usb-name", "data-no-i18n": true } : { class: "ctl-usb-name" }, driveName(d));
        const button = el(
          "button",
          {
            class: "btn small",
            type: "button",
            disabled: busy,
            onclick: api.handler(async () => {
              asked.add(d.root);
              draw();
              if (!(await ejectDrive(api, d))) {
                asked.delete(d.root);
                draw();
              }
            }),
          },
          busy ? "Éjection…" : "Éjecter",
        );
        return el("div", { class: "ctl-usb-item", title: `${driveName(d)} (${d.letter})` }, name, el("span", { class: "ctl-usb-letter muted" }, d.letter), button);
      }),
    );
  };

  // La réponse du Rust : éjectée, la clé disparaît de la liste tout de suite ;
  // refusée, son bouton redevient utilisable.
  const off = api.on("controls.usb-ejected", (msg) => {
    const r = msg.payload as EjectResult | null;
    if (!r?.root) return;
    asked.delete(r.root);
    if (r.ok) drives = drives.filter((d) => d.root !== r.root);
    draw();
  });

  return {
    node,
    /** La liste a peut-être changé (relue avec les radios, toutes les 2 s). */
    update(next: UsbDrive[]) {
      drives = next;
      // Une clé retirée entre-temps : on l'oublie.
      for (const root of [...asked]) if (!next.some((d) => d.root === root)) asked.delete(root);
      draw();
    },
    stop: off,
  };
}
