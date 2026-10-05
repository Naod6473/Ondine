// Point d'entrée de la fenêtre de l'île.
//
// Ordre de démarrage : réglages → bus → file de notifications → modules → île
// (avec la mascotte) → on démarre les modules → "app.ready" sur le bus.

import { Bridge, windowLabel } from "./core/bridge";
import { Bus } from "./core/bus";
import { errorText, logger } from "./core/log";
import { ModuleRegistry } from "./core/module-registry";
import { NotificationQueue } from "./core/notifications";
import { settingsStore } from "./core/settings-store";
import { Island } from "./island/island";
import { ALL_MODULES } from "./modules";

const log = logger("app");

// Filet de sécurité : une erreur que personne n'a rattrapée est notée, l'île continue.
window.addEventListener("error", (e) => log.error(`erreur non rattrapée : ${e.message}`));
window.addEventListener("unhandledrejection", (e) => log.error(`promesse rejetée : ${errorText(e.reason)}`));

async function start() {
  const boot = await Bridge.boot();
  await settingsStore.connect(boot?.settings ?? null);

  const bus = new Bus(windowLabel("island"));
  await bus.connect();

  const notifications = new NotificationQueue();
  const registry = new ModuleRegistry(ALL_MODULES, bus, notifications);
  new Island(document.getElementById("root")!, bus, registry, notifications);

  registry.sync();
  bus.emit("app.ready", { version: boot?.version ?? "dev" });
  log.info(`île prête (${boot?.version ?? "navigateur"})`);
}

void start();
