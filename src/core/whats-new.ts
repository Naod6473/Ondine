// « Quoi de neuf dans Ondine X.Y.Z » : une fois, au premier démarrage après une
// mise à jour.
//
// Le réglage general.lastSeenVersion retient la dernière version lancée. Au
// démarrage de l'île :
//   - même version : rien ;
//   - premier lancement (rien de noté, pas encore de mot de bienvenue) : on
//     retient seulement la version ;
//   - autre version : une notification avec les 3 premières lignes de cette
//     version dans CHANGELOG.md (la moitié française ou anglaise de chaque
//     puce) et « Tout voir », qui ouvre la page de la version sur GitHub.
//     Si la version apporte de nouvelles mascottes (whats-new-mascots.ts), la
//     notification devient un panneau : les mascottes animées en carrousel,
//     « Adopter », et les puces dessous (src/island/whats-new-panel.ts).
// Jamais en mode démo (la version n'est alors pas notée : elle le sera au
// premier démarrage hors démo), ni dans un navigateur.
//
// CHANGELOG.md est intégré à l'appli au moment de la construction (« ?raw » de
// Vite) : rien n'est téléchargé. La lecture du fichier est dans changelog.ts.
// Le bouton « Voir les nouveautés » (Réglages → Général → À propos) et la scène
// « Quoi de neuf » du mode démo publient « app.whats-new » : l'île montre le
// même panneau, sans rien noter (le message peut porter une version :
// { version: "1.2.0" }, pour voir celui d'une autre version dans un navigateur).

import changelog from "../../CHANGELOG.md?raw";
import { Bridge, IS_TAURI } from "./bridge";
import type { Bus } from "./bus";
import { whatsNewAction, whatsNewLines } from "./changelog";
import { currentLang } from "./i18n";
import { errorText, logger } from "./log";
import type { NotificationQueue } from "./notifications";
import { settingsStore } from "./settings-store";
import { newMascotsFor } from "./whats-new-mascots";
import { mountWhatsNewPanel } from "../island/whats-new-panel";

const log = logger("whats-new");

/**
 * À appeler au démarrage de l'île, AVANT le mot de bienvenue (qui marque
 * general.welcomed) : `version` = celle de l'appli (null dans un navigateur).
 */
export function startWhatsNew(bus: Bus, notifications: NotificationQueue, version: string | null) {
  bus.on("app.whats-new", (msg) => {
    const asked = (msg.payload as { version?: string } | null)?.version;
    showWhatsNew(notifications, (typeof asked === "string" && asked) || version || "dev", bus);
  });
  if (!IS_TAURI || !version) return;
  const g = settingsStore.current.general;
  const action = whatsNewAction(g.lastSeenVersion ?? "", version, g.welcomed, g.demo === true);
  if (action === "nothing") return;
  void settingsStore.update((d) => {
    d.general.lastSeenVersion = version;
  });
  if (action === "show") {
    log.info(`nouvelle version : ${g.lastSeenVersion || "(non notée)"} → ${version}`);
    showWhatsNew(notifications, version, bus);
    // Une nouvelle version : Ondine a des étoiles plein les yeux (si sa mascotte sait le faire).
    bus.emit("mascot.emote", { emotion: "starstruck" }, "whats-new");
  }
}

/**
 * La notification « Quoi de neuf », pour `version` : le texte seul, ou le
 * panneau avec les nouvelles mascottes quand la version en apporte.
 */
export function showWhatsNew(notifications: NotificationQueue, version: string, bus?: Bus) {
  const lines = whatsNewLines(changelog, version, currentLang());
  const mascots = newMascotsFor(version);
  // Une puce par ligne (la carte de l'île passe à la ligne sur « \n »).
  const body = lines?.length ? lines.map((l) => `• ${l}`).join("\n") : "Toutes les nouveautés de cette version sont sur GitHub.";
  notifications.push({
    moduleId: "island",
    title: `Quoi de neuf dans Ondine ${version}`,
    body,
    icon: "✨",
    priority: "high",
    sticky: true,
    key: "whats-new",
    content: mascots.length
      ? (host) =>
          mountWhatsNewPanel(host, {
            mascots,
            text: body,
            // La nouvelle mascotte (déjà dans l'île) fait coucou.
            onAdopt: () => window.setTimeout(() => bus?.emit("mascot.emote", { emotion: "wave" }, "whats-new"), 400),
          })
      : undefined,
    actions: [
      {
        label: "Tout voir",
        run: async () => {
          try {
            await Bridge.releasePageOpen();
          } catch (err) {
            log.warn(`page de la version non ouverte : ${errorText(err)}`);
          }
        },
      },
      { label: mascots.length ? "Plus tard" : "OK", run: () => undefined },
    ],
  });
}
