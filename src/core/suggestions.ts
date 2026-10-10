// Les propositions d'Ondine : une île qui commence petite (assistant de
// premier lancement) et s'enrichit quand on accepte ce qu'elle propose.
//
//   - Le bon onglet au bon moment, UNE fois par cas : la première clé USB
//     branchée ou la première visio (le Rust prévient : « island-hint »,
//     services/hints.rs) → Contrôles ; le premier fichier glissé sur l'île
//     → l'Étagère. Seulement si l'onglet est éteint.
//   - Masquer un onglet jamais ouvert depuis 3 semaines : un compteur local
//     (island.tabSeenAt, le jour de la dernière ouverture de chaque onglet,
//     noté par island.ts) ; une proposition par jour au plus, une seule fois
//     par onglet. Jamais fait tout seul : c'est toujours un clic.
//
// Les cas déjà proposés sont dans island.suggested ; Réglages → Onglets →
// « Propositions d'Ondine » (island.suggestions) les coupe toutes. Rien n'est
// envoyé nulle part. Jamais en mode démo ni dans un navigateur.
// Les règles (sans DOM) sont dans setup-plan.ts.

import { IS_TAURI, onTauriEvent } from "./bridge";
import type { Bus } from "./bus";
import { t } from "./i18n";
import type { ModuleRegistry } from "./module-registry";
import type { NotificationQueue } from "./notifications";
import { settingsStore } from "./settings-store";
import { dayNumber, HINTS, hintWanted, staleTab, withSuggested } from "./setup-plan";

/** Premier regard après le démarrage, puis toutes les 6 heures. */
const FIRST_LOOK_MS = 90_000;
const LOOK_EVERY_MS = 6 * 3600_000;
/** Une proposition reste un peu plus longtemps qu'une notification ordinaire. */
const SHOW_MS = 15_000;

function quietNow(): boolean {
  return !IS_TAURI || settingsStore.current.general.demo === true;
}

/** L'onglet `id` vient de s'afficher dans l'île ouverte : on note le jour (une fois par jour). */
export function noteTabOpen(id: string | null) {
  if (!id || quietNow()) return;
  const today = dayNumber(Date.now());
  if (settingsStore.current.island.tabSeenAt?.[id] === today) return;
  void settingsStore.update((d) => {
    d.island.tabSeenAt = { ...(d.island.tabSeenAt ?? {}), [id]: today };
  });
}

/** Allume un onglet (il retrouve sa place dans la rangée, island.tabOrder). */
function enableTab(id: string) {
  void settingsStore.update((d) => {
    d.modules[id] = { enabled: true, values: d.modules[id]?.values ?? {} };
  });
}

function markDone(kind: string) {
  void settingsStore.update((d) => {
    d.island.suggested = withSuggested(d.island.suggested ?? [], kind);
  });
}

export function startSuggestions(bus: Bus, notifications: NotificationQueue, registry: ModuleRegistry) {
  /** Un bon moment est arrivé : on propose son onglet, si c'est le moment. */
  const offer = (kind: string) => {
    const hint = HINTS[kind];
    if (!hint || quietNow()) return;
    const s = settingsStore.current;
    if (!hintWanted(kind, s.island, settingsStore.moduleEnabled(hint.module), s.general.welcomed)) return;
    markDone(kind);
    notifications.push({
      moduleId: "island",
      title: hint.title,
      body: hint.body,
      icon: hint.icon,
      priority: "normal",
      durationMs: SHOW_MS,
      key: `suggest-${kind}`,
      actions: [
        {
          label: "Ajouter l'onglet",
          run: () => {
            enableTab(hint.module);
            // Le nouvel onglet s'ouvre, une fois le module démarré.
            window.setTimeout(() => bus.emit("island.open", { tab: hint.module }, "island"), 300);
          },
        },
        { label: "Non merci", run: () => undefined },
      ],
    });
  };

  void onTauriEvent<{ kind?: string }>("island-hint", (p) => offer(String(p?.kind ?? "")));
  // Le premier fichier glissé sur l'île (l'île passe en « drop »).
  bus.on("island.state", (msg) => {
    if ((msg.payload as { to?: string } | null)?.to === "drop") offer("drop");
  });

  /** Un onglet oublié depuis 3 semaines ? On propose de le masquer (un par jour au plus). */
  const look = () => {
    if (quietNow() || !settingsStore.current.general.welcomed) return;
    const tabs = registry.withView("expanded").map((r) => r.module.manifest);
    const id = staleTab(
      tabs.map((m) => m.id),
      settingsStore.current.island,
      dayNumber(Date.now()),
    );
    const m = tabs.find((x) => x.id === id);
    if (!m) return;
    markDone(`hide-${m.id}`);
    notifications.push({
      moduleId: "island",
      title: `Masquer l'onglet ${t(m.name)} ?`,
      body: "Vous ne l'avez pas ouvert depuis 3 semaines. Vous pourrez le rallumer dans Réglages → Onglets.",
      icon: m.icon,
      priority: "normal",
      durationMs: SHOW_MS,
      key: "suggest-hide",
      actions: [
        {
          label: "Masquer",
          run: () =>
            settingsStore.update((d) => {
              d.modules[m.id] = { enabled: false, values: d.modules[m.id]?.values ?? {} };
            }),
        },
        { label: "Le garder", run: () => undefined },
      ],
    });
  };
  // Une installation d'avant l'assistant (déjà accueillie) : le compte des onglets commence aujourd'hui.
  if (!quietNow() && settingsStore.current.general.welcomed && !settingsStore.current.island.usageSince) {
    const today = dayNumber(Date.now());
    void settingsStore.update((d) => (d.island.usageSince = today));
  }
  window.setTimeout(look, FIRST_LOOK_MS);
  window.setInterval(look, LOOK_EVERY_MS);
}
