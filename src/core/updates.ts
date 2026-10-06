// Mises à jour automatiques, côté île : on demande au Rust s'il existe une
// nouvelle version (un peu après le démarrage, puis une fois par jour) et on la
// propose dans une notification. Rien ne s'installe sans un clic sur « Installer ».
//
// Réglage : general.autoUpdate (Réglages → Général). Jamais en mode démo ni
// dans un navigateur.

import { Bridge, IS_TAURI } from "./bridge";
import { errorText, logger } from "./log";
import type { NotificationQueue } from "./notifications";
import { settingsStore } from "./settings-store";

const log = logger("updates");

/** Premier coup d'œil : quand le PC a fini de démarrer. */
const FIRST_CHECK_MS = 60_000;
const EVERY_MS = 24 * 60 * 60 * 1000;

/** La version déjà proposée : on ne la repropose pas à chaque vérification. */
let offered = "";

function enabled(): boolean {
  const g = settingsStore.current.general;
  return IS_TAURI && g.autoUpdate !== false && g.demo !== true;
}

export function startUpdates(notifications: NotificationQueue) {
  if (!IS_TAURI) return;
  const tick = () => {
    if (enabled()) void check(notifications, false);
  };
  window.setTimeout(tick, FIRST_CHECK_MS);
  window.setInterval(tick, EVERY_MS);
}

/**
 * Cherche une mise à jour et la propose. `manual` (bouton des réglages) :
 * renvoie un texte à afficher, et repropose même une version déjà vue.
 */
export async function check(notifications: NotificationQueue | null, manual: boolean): Promise<string> {
  let info;
  try {
    info = await Bridge.updateCheck();
  } catch (err) {
    log.warn(`recherche impossible : ${errorText(err)}`);
    return "Impossible de joindre GitHub. Vérifie ta connexion à Internet.";
  }
  if (!info) return "Ondine est à jour.";
  if (notifications && (manual || offered !== info.version)) {
    offered = info.version;
    offer(notifications, info.version);
  }
  return `La version ${info.version} est disponible.`;
}

function offer(notifications: NotificationQueue, version: string) {
  notifications.push({
    moduleId: "island",
    title: `Ondine ${version} est disponible`,
    body: "Installer maintenant ? Ondine se ferme quelques secondes puis revient toute seule.",
    icon: "✨",
    priority: "normal",
    sticky: true,
    key: "update",
    actions: [
      { label: "Installer", run: () => install(notifications) },
      { label: "Plus tard", run: () => undefined },
    ],
  });
}

async function install(notifications: NotificationQueue) {
  notifications.push({ moduleId: "island", title: "Téléchargement de la mise à jour…", icon: "⬇️", sticky: true, key: "update" });
  try {
    await Bridge.updateInstall();
  } catch (err) {
    notifications.push({
      moduleId: "island",
      title: "La mise à jour n'a pas pu s'installer",
      body: errorText(err),
      icon: "⚠️",
      key: "update",
    });
  }
}
