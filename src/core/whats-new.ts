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
// Jamais en mode démo (la version n'est alors pas notée : elle le sera au
// premier démarrage hors démo), ni dans un navigateur.
//
// CHANGELOG.md est intégré à l'appli au moment de la construction (« ?raw » de
// Vite) : rien n'est téléchargé. La lecture du fichier est dans changelog.ts.
// Le bouton « Voir les nouveautés » (Réglages → Général → À propos) publie
// « app.whats-new » : l'île montre la même notification, sans rien noter.

import changelog from "../../CHANGELOG.md?raw";
import { Bridge, IS_TAURI } from "./bridge";
import type { Bus } from "./bus";
import { whatsNewAction, whatsNewLines } from "./changelog";
import { currentLang } from "./i18n";
import { errorText, logger } from "./log";
import type { NotificationQueue } from "./notifications";
import { settingsStore } from "./settings-store";

const log = logger("whats-new");

/**
 * À appeler au démarrage de l'île, AVANT le mot de bienvenue (qui marque
 * general.welcomed) : `version` = celle de l'appli (null dans un navigateur).
 */
export function startWhatsNew(bus: Bus, notifications: NotificationQueue, version: string | null) {
  bus.on("app.whats-new", () => showWhatsNew(notifications, version ?? "dev"));
  if (!IS_TAURI || !version) return;
  const g = settingsStore.current.general;
  const action = whatsNewAction(g.lastSeenVersion ?? "", version, g.welcomed, g.demo === true);
  if (action === "nothing") return;
  void settingsStore.update((d) => {
    d.general.lastSeenVersion = version;
  });
  if (action === "show") {
    log.info(`nouvelle version : ${g.lastSeenVersion || "(non notée)"} → ${version}`);
    showWhatsNew(notifications, version);
    // Une nouvelle version : Ondine a des étoiles plein les yeux (si sa mascotte sait le faire).
    bus.emit("mascot.emote", { emotion: "starstruck" }, "whats-new");
  }
}

/** La notification « Quoi de neuf », pour `version`. */
export function showWhatsNew(notifications: NotificationQueue, version: string) {
  const lines = whatsNewLines(changelog, version, currentLang());
  notifications.push({
    moduleId: "island",
    title: `Quoi de neuf dans Ondine ${version}`,
    // Une puce par ligne (la carte de l'île passe à la ligne sur « \n »).
    body: lines?.length ? lines.map((l) => `• ${l}`).join("\n") : "Toutes les nouveautés de cette version sont sur GitHub.",
    icon: "✨",
    priority: "high",
    sticky: true,
    key: "whats-new",
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
      { label: "OK", run: () => undefined },
    ],
  });
}
