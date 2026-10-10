// Point d'entrée de la fenêtre de l'île.
//
// Ordre de démarrage : réglages → bus → file de notifications → modules → île
// (avec la mascotte) → on démarre les modules → "app.ready" sur le bus.

import { Bridge, windowLabel } from "./core/bridge";
import { Bus } from "./core/bus";
import { hidesRealData, startDemo } from "./core/demo";
import { errorText, logger } from "./core/log";
import { ModuleRegistry } from "./core/module-registry";
import { NotificationQueue } from "./core/notifications";
import { settingsStore } from "./core/settings-store";
import { startI18n } from "./core/i18n";
import { Island } from "./island/island";
import { startUpdates } from "./core/updates";
import { startWhatsNew } from "./core/whats-new";
import { startPerf } from "./core/perf";
import { startSetup } from "./core/setup";
import { startSuggestions } from "./core/suggestions";
import { ALL_MODULES } from "./modules";

const log = logger("app");

// Filet de sécurité : une erreur que personne n'a rattrapée est notée, l'île continue.
window.addEventListener("error", (e) => log.error(`erreur non rattrapée : ${e.message}`));
window.addEventListener("unhandledrejection", (e) => log.error(`promesse rejetée : ${errorText(e.reason)}`));

async function start() {
  const boot = await Bridge.boot();
  await settingsStore.connect(boot?.settings ?? null);
  await startI18n();
  // Le mode de performance (haute, équilibrée, éco) : avant les modules, qui le lisent.
  await startPerf();

  const bus = new Bus(windowLabel("island"));
  // Mode démo : les vraies nouvelles du Rust (musique, presse-papiers…) sont ignorées.
  bus.accept = (msg) => !hidesRealData(msg);
  await bus.connect();

  const notifications = new NotificationQueue();
  const registry = new ModuleRegistry(ALL_MODULES, bus, notifications);
  new Island(document.getElementById("root")!, bus, registry, notifications);

  registry.sync();
  startDemo(bus);
  if (boot?.elevated) {
    // Windows refuse le glisser-déposer d'une appli normale vers une appli administrateur.
    notifications.push({
      moduleId: "island",
      title: "Ondine tourne en administrateur",
      body: "Windows bloque alors le glisser-déposer depuis l'Explorateur. Relancez-la depuis un terminal normal.",
      icon: "🛡️",
      priority: "high",
      sticky: true,
      key: "elevated",
    });
  }
  bus.emit("app.ready", { version: boot?.version ?? "dev" });
  // Une nouvelle version sur GitHub ? Proposée dans une notification (core/updates.ts).
  startUpdates(notifications);
  // Juste après une mise à jour : « Quoi de neuf » (core/whats-new.ts). Avant
  // l'assistant de premier lancement, qui marque general.welcomed.
  startWhatsNew(bus, notifications, boot?.version ?? null);
  // Premier démarrage (dans l'appli, pas dans le navigateur, hors démo) :
  // l'assistant, dans l'île (core/setup.ts). Réglages → Général le relance.
  const g = settingsStore.current.general;
  startSetup(bus, notifications, !!boot && !g.welcomed && g.demo !== true);
  // Les propositions d'onglets (bon moment, onglet oublié) : core/suggestions.ts.
  startSuggestions(bus, notifications, registry);
  log.info(`île prête (${boot?.version ?? "navigateur"})`);
}

void start();
