// Module « Notifications de Windows » : les notifications des autres applis
// (celles du Centre de notifications) s'affichent aussi dans l'île.
//
// Le Rust (src-tauri/src/modules/winnotifs.rs) lit le Centre de notifications,
// repère les nouvelles, applique les filtres et publie `winnotifs.new`. Ici,
// chaque nouvelle passe par la file de l'île (api.notify), priorité normale :
// le mode concentration, le mode présentation et le Calme des Règles la font
// attendre comme les autres. Le logo de l'appli est demandé au Rust une fois
// par appli (commande `icon`) et gardé en mémoire (icon.ts, setAppIcon).
//
// L'onglet : l'état de l'accès (avec « Ouvrir les réglages de Windows » quand
// Windows refuse) et les 20 dernières notifications, en mémoire seulement
// (effacées quand le module s'arrête ou quand le réglage est décoché).
// Le texte des notifications n'est jamais journalisé : seuls les échecs de
// commande le sont, sans contenu.

import manifest from "./manifest.json";
import "../../styles/winnotifs.css";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";
import { hasAppIcon, icon, setAppIcon } from "../../island/icon";
import { ago, iconName, islandTitle, needsWindowsSettings, parseNotif, parseStatus, remember, statusText, type WinNotif, type WinNotifStatus } from "./logic";

/** L'historique (le plus récent d'abord) et l'état de l'accès : en mémoire seulement. */
let history: WinNotif[] = [];
let status: WinNotifStatus | null = null;
/** Les vues ouvertes, à redessiner quand l'un ou l'autre change. */
const redraws = new Set<() => void>();
const changed = () => redraws.forEach((f) => f());

/** Le logo de l'appli, demandé une fois (sans logo : la cloche). */
async function ensureIcon(api: ModuleApi, n: WinNotif) {
  const name = iconName(n);
  if (!n.icon || hasAppIcon(name)) return;
  try {
    const r = await api.invoke<{ url?: string | null }>("icon", { key: n.key });
    if (r?.url) setAppIcon(name, r.url);
  } catch {
    // Pas de logo : la cloche fera l'affaire.
  }
}

function openApp(api: ModuleApi, n: WinNotif) {
  void api.invoke("open_app", { key: n.key }).catch((err) => api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "winnotifs-error" }));
}

function openSettings(api: ModuleApi) {
  void api.invoke("open_settings").catch((err) => api.log.warn(`réglages de Windows non ouverts : ${errorText(err)}`));
}

/** La notification dans l'île (file habituelle, priorité normale). */
function show(api: ModuleApi, n: WinNotif) {
  const name = iconName(n);
  api.notify({
    title: islandTitle(n),
    body: n.body || undefined,
    icon: hasAppIcon(name) || name === "🔔" ? name : "🔔",
    priority: "normal",
    key: `winnotifs-${n.id}`,
    actions: n.key ? [{ label: "Ouvrir", run: () => openApp(api, n) }] : undefined,
    // Montrée puis refermée (temps écoulé, ×, ou « Ouvrir ») : la retirer du
    // Centre de notifications, si le réglage est coché et que Windows le permet.
    onDismiss: () => {
      if (api.settings().removeFromCenter !== true || status?.remove === "refused") return;
      void api.invoke("remove", { id: n.id }).catch(() => undefined);
    },
  });
}

export const winnotifs: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    // Windows refuse (ou l'API manque) : on le dit une fois par démarrage du module.
    let told = false;
    const tell = () => {
      if (told || !status) return;
      if (needsWindowsSettings(status)) {
        told = true;
        api.notify({
          title: "Windows ne laisse pas Ondine lire vos notifications",
          body: "Autorisez-le dans Paramètres, Confidentialité, Notifications : Ondine s'en aperçoit toute seule.",
          icon: "🔔",
          priority: "normal",
          key: "winnotifs-access",
          durationMs: 15_000,
          actions: [{ label: "Ouvrir les réglages de Windows", run: () => openSettings(api) }],
        });
      } else if (status.state === "unavailable") {
        told = true;
        api.notify({ title: statusText(status), icon: "🔔", priority: "low", key: "winnotifs-access" });
      }
    };
    const setStatus = (s: WinNotifStatus | null) => {
      if (!s) return;
      status = s;
      changed();
      tell();
    };

    const offs = [
      api.on("winnotifs.new", (msg) => {
        const n = parseNotif(msg.payload);
        if (!n) return;
        if (api.settings().history !== false) {
          history = remember(history, n);
          changed();
        }
        void ensureIcon(api, n).then(() => {
          show(api, n);
          changed();
        });
      }),
      api.on("winnotifs.status", (msg) => setStatus(parseStatus(msg.payload))),
      // Historique décoché : tout s'efface tout de suite.
      api.onSettingsChange((values) => {
        if (values.history === false && history.length) {
          history = [];
          changed();
        }
      }),
    ];
    void api
      .invoke("status")
      .then((s) => setStatus(parseStatus(s)))
      .catch(() => undefined);
    return () => {
      offs.forEach((off) => off());
      history = [];
      status = null;
    };
  },

  views: {
    expanded(root, api) {
      const box = el("div", { class: "wn" });
      root.append(box);

      const item = (n: WinNotif) =>
        el(
          n.key ? "button" : "div",
          { class: "wn-item", title: n.key ? "Ouvrir l'appli" : undefined, onclick: n.key ? api.handler(() => openApp(api, n)) : undefined },
          el("span", { class: "wn-icon" }, icon(hasAppIcon(iconName(n)) ? iconName(n) : "🔔")),
          el(
            "span",
            { class: "wn-text" },
            el("span", { class: "wn-line" }, el("b", { class: "wn-app", "data-no-i18n": true }, n.app), el("span", { class: "wn-when muted" }, ago(n.at))),
            el("span", { class: "wn-title", "data-no-i18n": true }, n.title),
            n.body ? el("span", { class: "wn-body muted", "data-no-i18n": true }, n.body) : null,
          ),
        );

      const draw = () => {
        const s = api.settings();
        const fix = needsWindowsSettings(status);
        const head = el(
          "div",
          { class: `wn-head ${status?.state === "allowed" ? "ok" : "warn"}` },
          el("span", { class: "wn-status" }, statusText(status)),
          fix ? el("button", { class: "btn small", onclick: api.handler(() => openSettings(api)) }, "Ouvrir les réglages de Windows") : null,
          fix || status?.state === "unavailable"
            ? el(
                "button",
                {
                  class: "btn small",
                  onclick: api.handler(async () => {
                    await api.invoke("recheck");
                  }),
                },
                "Vérifier de nouveau",
              )
            : null,
        );
        const removeNote =
          s.removeFromCenter === true && status?.remove === "refused"
            ? el("p", { class: "wn-note muted" }, "Windows ne laisse pas Ondine retirer les notifications du Centre de notifications : elles y restent.")
            : null;
        const list = history.length
          ? el("div", { class: "wn-list" }, ...history.map(item))
          : el(
              "p",
              { class: "wn-empty muted" },
              s.history === false ? "L'historique est désactivé dans les réglages du module." : "Aucune nouvelle notification depuis le démarrage d'Ondine.",
            );
        const clear = history.length
          ? el(
              "button",
              {
                class: "btn small wn-clear",
                onclick: api.handler(() => {
                  history = [];
                  changed();
                }),
              },
              "Effacer la liste",
            )
          : null;
        box.replaceChildren(...[head, removeNote, list, clear].filter((x) => x !== null));
      };

      redraws.add(draw);
      draw();
      return () => redraws.delete(draw);
    },
  },
};
