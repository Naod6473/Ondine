// Les modes de performance côté front : à quel rythme tournent les minuteries
// et les boucles de dessin de l'interface.
//
// Le mode qui s'applique (« effectif ») est décidé par le Rust
// (src-tauri/src/services/perf.rs) : le choix de Réglages → Performances
// Performances, ou « éco » sur batterie si la case est cochée. Il arrive au
// démarrage (Bridge.perfState) puis à chaque changement (événement "perf-mode") :
// tout change à chaud, sans redémarrer.
//
// Règle : un module ne choisit pas son rythme avec des `if` ; il demande
// `every("…")` ou utilise `pacedInterval` / `frameLoop`, et le tableau
// ci-dessous (recopié dans docs/ARCHITECTURE.md) décide.

import { Bridge, IS_TAURI, onTauriEvent, type PerfState } from "./bridge";
import { settingsStore } from "./settings-store";
import type { PerfMode } from "./types";
import { setLabel } from "../island/icon";

/**
 * Les rythmes en millisecondes : [haute, équilibrée, éco]. La colonne
 * « équilibrée » est le comportement d'avant les modes. L'éco ne ralentit que
 * ce qui ne se voit pas tout de suite, et jamais au point de casser une
 * fonction (le minuteur s'affiche toujours à la seconde, un appui est toujours vu).
 */
export const CADENCES = {
  /** Minuteur : fin d'un compte à rebours, d'une séance Pomodoro. */
  timerTick: [250, 250, 500],
  /** Musique : la barre et le temps écoulé (affiché à la seconde). */
  mediaProgress: [250, 500, 1000],
  /** Onglet Système : jauges processeur / mémoire. */
  systemTab: [1000, 2000, 5000],
  /** Onglet Contrôles : volume du son et du micro (touches du clavier, autre appli). */
  controlsSound: [500, 1000, 2000],
  /** Onglet Contrôles : Wi-Fi, Bluetooth. */
  controlsRadios: [1000, 2000, 4000],
  /** Onglet Contrôles : luminosité des écrans (lent à lire). */
  controlsScreens: [5000, 5000, 10000],
  /** Agenda : la pilule « Dans 12 min » doit-elle apparaître ? */
  agendaPill: [10000, 10000, 30000],
  /** Agenda : le texte de la pilule (à la minute) et la barre « En cours ». */
  agendaCompact: [1000, 1000, 5000],
  /** Onglet Agenda : « dans 12 min » qui avance tout seul. */
  agendaList: [30000, 30000, 60000],
  /** Onglet Agents IA : « il y a 5 min ». */
  agentsList: [15000, 15000, 30000],
  /** Mascotte : ennui puis sommeil après un moment sans activité. */
  mascotIdle: [2000, 2000, 4000],
  /** Ondine vient-elle pendre au bord ? */
  peekCheck: [15000, 15000, 30000],
  /** Mode présentation : une appli est-elle en plein écran ? */
  presentationCheck: [2000, 4000, 8000],
  /** Pauses : une pause à proposer ? */
  pausesCheck: [30000, 30000, 60000],
  /** Bilan de la semaine : est-ce l'heure du bilan ? */
  weeklyCheck: [60000, 60000, 120000],
  /** Agents IA : le budget du jour (coût estimé des jetons) est-il dépassé ? */
  agentsBudget: [900000, 900000, 1800000],
  /** Animations de l'île : heure de partir, bonjour du matin, couleurs du ciel. */
  halosClock: [30000, 30000, 60000],
  /** Animations de l'île : le niveau du micro (visio) ou de la musique, pendant qu'ils servent. */
  halosLevel: [66, 80, 160],
} satisfies Record<string, readonly [number, number, number]>;

export type Cadence = keyof typeof CADENCES;

const COLUMN: Record<PerfMode, 0 | 1 | 2> = { high: 0, balanced: 1, eco: 2 };

/** Images par seconde au plus des dessins continus (mascotte, minuteur) en éco. */
export const ECO_FPS = 30;

let mode: PerfMode = "balanced";
let onBattery = false;
const listeners = new Set<(mode: PerfMode) => void>();

/** Le mode qui s'applique en ce moment. */
export function perfMode(): PerfMode {
  return mode;
}

/** Le PC est sur batterie (vu par le Rust). */
export function perfOnBattery(): boolean {
  return onBattery;
}

/** Le rythme (ms) de `c` dans un mode donné (par défaut : le mode actuel). */
export function every(c: Cadence, m: PerfMode = mode): number {
  return CADENCES[c][COLUMN[m] ?? 1];
}

/** Prévenu à chaque changement de mode. Renvoie de quoi se désabonner. */
export function onPerfChange(fn: (mode: PerfMode) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function apply(next: PerfMode, battery: boolean) {
  onBattery = battery;
  if (!(next in COLUMN)) next = "balanced";
  // Pour le CSS : body[data-perf="eco"] retire les effets coûteux (flou).
  if (typeof document !== "undefined") document.body.dataset.perf = next;
  // Même mode : on prévient quand même (« sur batterie » a peut-être changé).
  mode = next;
  for (const fn of listeners) {
    try {
      fn(mode);
    } catch (err) {
      console.error("[perf] abonné en erreur", err);
    }
  }
}

/** Branche le mode dans cette fenêtre (au démarrage, après les réglages). */
export async function startPerf(): Promise<void> {
  if (IS_TAURI) {
    await onTauriEvent<PerfState>("perf-mode", (s) => apply(s.mode, s.onBattery));
    const s = await Bridge.perfState();
    if (s) apply(s.mode, s.onBattery);
    return;
  }
  // Dans un navigateur (npm run dev) : le choix des réglages, jamais sur batterie.
  const fromSettings = () => apply(settingsStore.current.general.perfMode ?? "balanced", false);
  fromSettings();
  settingsStore.onChange(fromSettings);
}

/**
 * Comme setInterval, au rythme `c` du mode actuel, refait tout seul quand le
 * mode change. Renvoie la fonction qui arrête.
 *
 * `onlyWhenVisible` : pour ce qui ne fait QUE redessiner (une vue), rien
 * n'est appelé pendant que Windows dit la page cachée (fenêtre réduite ou
 * recouverte). Jamais pour une vérification qui doit tourner en fond (fin du
 * minuteur, mode présentation…).
 */
export function pacedInterval(fn: () => void, c: Cadence, onlyWhenVisible = false): () => void {
  const run = () => {
    if (onlyWhenVisible && typeof document !== "undefined" && document.hidden) return;
    fn();
  };
  let ms = every(c);
  let id = window.setInterval(run, ms);
  const off = onPerfChange(() => {
    if (every(c) === ms) return;
    ms = every(c);
    window.clearInterval(id);
    id = window.setInterval(run, ms);
  });
  return () => {
    window.clearInterval(id);
    off();
  };
}

/**
 * Une boucle de dessin (requestAnimationFrame) pour ce qui bouge en continu
 * (la mascotte, l'anneau du minuteur) :
 *   - elle s'arrête quand `target` n'a plus de taille (île cachée : la place
 *     de la mascotte fait 0 × 0) et repart quand il en retrouve une ;
 *   - en éco, au plus ECO_FPS images par seconde.
 * Renvoie la fonction qui arrête.
 */
export function frameLoop(target: Element, draw: (now: number) => void): () => void {
  let raf = 0;
  let timer = 0;
  let stopped = false;
  let sized = true;
  const tick = () => {
    raf = 0;
    if (stopped || !sized) return; // repartira quand la taille revient
    // performance.now() plutôt que l'heure de l'image : les dessins comparent
    // avec des instants pris par performance.now() (début d'animation).
    draw(performance.now());
    if (mode === "eco") {
      // On saute une image sur deux : un réveil de moins, un dessin de moins.
      timer = window.setTimeout(() => {
        timer = 0;
        schedule();
      }, 1000 / ECO_FPS - 1000 / 60);
    } else schedule();
  };
  const schedule = () => {
    if (!raf && !timer && !stopped) raf = requestAnimationFrame(tick);
  };
  const observer = new ResizeObserver((entries) => {
    const r = entries[entries.length - 1].contentRect;
    const now = r.width > 0 && r.height > 0;
    const wasSized = sized;
    sized = now;
    if (now && !wasSized) schedule();
  });
  observer.observe(target);
  schedule();
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    observer.disconnect();
  };
}

/** Le dernier texte écrit par setText dans chaque élément. */
const written = new WeakMap<Node, string>();

/**
 * Écrit `text` seulement s'il a changé depuis la dernière fois (évite un
 * recalcul de mise en page à chaque image). On compare avec ce qu'on a écrit,
 * pas avec ce qui est affiché : en anglais, i18n.ts remplace le texte affiché.
 */
export function setText(node: Node, text: string) {
  if (written.get(node) === text) return;
  written.set(node, text);
  // Les pictogrammes du libellé suivent le pack d'icônes (voir icon.ts).
  setLabel(node, text);
}
