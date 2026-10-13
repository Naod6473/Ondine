// Quand jouer l'éclosion de l'île (src/island/hatch.ts), et avec quoi.
//
// Au démarrage, avant « Quoi de neuf » et l'assistant de premier lancement
// (main.ts attend la fin de l'animation) :
//   - premier lancement : « Bonjour ! », anneaux Onglets, Modules, Batterie
//     (Mascottes sur un PC sans batterie) ;
//   - après une mise à jour : « Ondine X.Y.Z est là ! », anneaux Nouveautés
//     (les puces du CHANGELOG), Mascottes, Réglages gardés.
// Jamais : réglage island.hatch coupé, Réduire les animations, mode Calme,
// île sur un autre bord que le haut, île-bouche, Ondine sur le bureau, mode démo.
//
// Le bouton « Voir l'éclosion » des Réglages publie « app.hatch »
// ({ kind: "first" | "update" }) : on la rejoue sans rien noter.

import changelog from "../../CHANGELOG.md?raw";
import { GUM_FAMILY } from "../mascot/gum-family";
import type { Island } from "../island/island";
import { hatchKind, type Ring } from "../island/hatch-plan";
import type { HatchTexts } from "../island/hatch";
import { reducedMotion } from "../island/tab-pill";
import { Bridge, IS_TAURI } from "./bridge";
import type { Bus } from "./bus";
import { changelogSection, whatsNewAction } from "./changelog";
import { t } from "./i18n";
import { logger } from "./log";
import type { ModuleRegistry } from "./module-registry";
import { settingsStore } from "./settings-store";

const log = logger("hatch");

/** Les anneaux attendent leurs valeurs au plus… (ms). */
const DATA_WAIT_MS = 600;

const COLORS = { blue: "#5cc8ff", mint: "#62e6c4", gold: "#ffd84a", pink: "#ff9cc6", violet: "#b98cff" };

const count = (n: number) => (f: number) => String(Math.round(n * f));
const percent = (f: number) => `${Math.round(100 * f)} %`;

async function battery(): Promise<number | null> {
  if (!IS_TAURI) return null;
  const ask = Bridge.moduleInvoke<{ percent: number | null } | null>("system", "battery", null).then((b) => b?.percent ?? null);
  const wait = new Promise<null>((r) => window.setTimeout(() => r(null), DATA_WAIT_MS));
  try {
    return await Promise.race([ask, wait]);
  } catch {
    return null;
  }
}

const MASCOTS = 1 + GUM_FAMILY.length;

async function firstRun(registry: ModuleRegistry): Promise<{ texts: HatchTexts; rings: Ring[] }> {
  const name = (settingsStore.current.general.firstName ?? "").trim();
  const tabs = registry.withView("expanded").length;
  const modules = registry.allIds().filter((id) => settingsStore.moduleEnabled(id)).length;
  const pct = await battery();
  return {
    texts: {
      hello: name ? t(`Bonjour ${name} !`) : t("Bonjour !"),
      busy: t("Je prépare votre île…"),
      done: t("Tout est prêt."),
      mini: t("Tout est prêt"),
    },
    rings: [
      { label: t("Onglets"), value: 1, show: count(tabs), color: COLORS.blue },
      { label: t("Modules"), value: 1, show: count(modules), color: COLORS.mint },
      pct === null
        ? { label: t("Mascottes"), value: 1, show: count(MASCOTS), color: COLORS.gold }
        : { label: t("Batterie"), value: Math.max(0.02, pct / 100), show: percent, color: COLORS.gold },
    ],
  };
}

function update(version: string): { texts: HatchTexts; rings: Ring[] } {
  const news = Math.max(1, changelogSection(changelog, version)?.items.length ?? 1);
  return {
    texts: {
      hello: t(`Ondine ${version} est là !`),
      busy: t("Je range les nouveautés…"),
      done: news > 1 ? t(`${news} nouveautés vous attendent.`) : t("Une nouveauté vous attend."),
      mini: news > 1 ? t(`${news} nouveautés`) : t("1 nouveauté"),
    },
    rings: [
      { label: t("Nouveautés"), value: 1, show: count(news), color: COLORS.pink },
      { label: t("Mascottes"), value: 1, show: count(MASCOTS), color: COLORS.violet },
      { label: t("Réglages gardés"), value: 1, show: percent, color: COLORS.mint },
    ],
  };
}

async function play(island: Island, registry: ModuleRegistry, kind: "first" | "update", version: string) {
  const what = kind === "first" ? await firstRun(registry) : update(version);
  log.info(`éclosion (${kind === "first" ? "premier lancement" : `version ${version}`})`);
  await island.hatch(what.texts, what.rings);
}

/**
 * À appeler au démarrage, AVANT startWhatsNew et startSetup : se résout
 * quand l'éclosion est finie (tout de suite si elle ne joue pas).
 */
export async function startHatch(island: Island, bus: Bus, registry: ModuleRegistry, version: string | null, isFirstRun: boolean): Promise<void> {
  bus.on("app.hatch", (msg) => {
    const kind = (msg.payload as { kind?: string } | null)?.kind === "update" ? "update" : "first";
    void play(island, registry, kind, version ?? "1.2.4");
  });
  const s = settingsStore.current;
  const g = s.general;
  const kind = hatchKind({
    firstRun: isFirstRun,
    whatsNew: IS_TAURI && version ? whatsNewAction(g.lastSeenVersion ?? "", version, g.welcomed, g.demo === true) : "nothing",
    enabled: s.island.hatch !== false && g.demo !== true,
    quiet: reducedMotion() || s.mascot.calm === true,
    edge: s.island.edge,
    style: s.island.style ?? "classic",
    petOut: s.mascot.enabled && !!s.mascot.pet,
  });
  if (!kind || !island.canHatch()) return;
  await play(island, registry, kind, version ?? "");
}
