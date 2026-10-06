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
import { currentLang, startI18n } from "./core/i18n";
import { Island } from "./island/island";
import { startUpdates } from "./core/updates";
import { startPerf } from "./core/perf";
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
  // Premier démarrage (dans l'appli, pas dans le navigateur) : un mot de bienvenue.
  if (boot && !settingsStore.current.general.welcomed) welcome(bus, notifications);
  log.info(`île prête (${boot?.version ?? "navigateur"})`);
}

/**
 * Le mot de bienvenue du premier démarrage : où vit l'île, comment l'ouvrir, et
 * le choix de la langue. Montré une seule fois (réglage general.welcomed).
 */
function welcome(bus: Bus, notifications: NotificationQueue) {
  const other = currentLang() === "fr" ? "en" : "fr";
  void settingsStore.update((d) => {
    d.general.welcomed = true;
  });
  bus.emit("mascot.emote", { emotion: "success" });
  notifications.push({
    moduleId: "island",
    title: "Bonjour, je suis Ondine 👋",
    body: `Je vis en haut de l'écran : passez la souris tout en haut, ou ${settingsStore.current.island.hotkey || "Ctrl+Alt+O"}. Mon icône est près de l'horloge (clic droit : Réglages, Quitter).`,
    icon: "💧",
    priority: "high",
    sticky: true,
    key: "welcome",
    actions: [
      {
        label: other === "en" ? "English" : "Français",
        run: () =>
          settingsStore.update((d) => {
            d.general.language = other;
          }),
      },
      { label: "Réglages", run: () => void Bridge.openSettingsWindow() },
      { label: "C'est parti", run: () => undefined },
    ],
  });
}

void start();
