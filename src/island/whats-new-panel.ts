// Le panneau « Quoi de neuf » quand une version apporte de nouvelles mascottes
// (src/core/whats-new-mascots.ts) : un carrousel des VRAIES mascottes en
// gomme, animées en direct dans de petits canvas (le moteur gum, comme dans
// l'île), leur nom dessous, « Adopter » qui change la mascotte de l'île tout
// de suite (réglage mascot.id), et les puces du CHANGELOG en dessous.
//
//   - trois mascottes à la fois (une seule en économie d'énergie), flèches
//     « ‹ › » pour faire défiler ; un clic sur une carte la choisit ;
//   - à tour de rôle, l'une d'elles fait coucou, rit ou danse, puis revient au
//     repos ; rien de tout ça avec « Réduire les animations » (elles restent
//     posées, dessinées une fois) ;
//   - tout est défait (moteurs détruits, minuteries arrêtées) dès que la carte
//     de l'île disparaît : la fonction renvoyée par mountWhatsNewPanel.
// Monté par core/whats-new.ts dans une notification (champ `content`), et par
// l'assistant de premier lancement (island/setup-panel.ts, étape « mascotte »).

import { perfMode } from "../core/perf";
import { settingsStore } from "../core/settings-store";
import { shortName } from "../core/whats-new-mascots";
import { findMascot, type CatalogEntry } from "../mascot/catalog";
import { GumRenderer } from "../mascot/renderers/gum";
import type { AnimationSpec } from "../mascot/types";
import { el } from "./dom";
import { reducedMotion } from "./tab-pill";

export interface WhatsNewPanelOptions {
  /** Les ids des mascottes à présenter (celles qui manquent au catalogue sont passées). */
  mascots: string[];
  /** Le texte des nouveautés (une puce par ligne), sous le carrousel. */
  text: string;
  /** Après « Adopter » (l'île a déjà changé de mascotte par les réglages). */
  onAdopt?: (id: string) => void;
  /** Sans `text` : la phrase sous le carrousel (assistant de premier lancement, src/core/setup.ts). */
  hint?: string;
}

/** Les gestes joués à tour de rôle, et leur durée à l'écran (ms). */
const GESTURES: [string, number][] = [
  ["coucou", 2600],
  ["rire", 2400],
  ["danse", 2600],
];
/** Entre deux gestes (ms). */
const GESTURE_EVERY_MS = 2200;

/** Une fiche d'animation du manifeste par nom (sinon idle). */
function spec(entry: CatalogEntry, name: string): AnimationSpec {
  return entry.manifest.animations.find((a) => a.name === name) ?? entry.manifest.animations.find((a) => a.name === "idle")!;
}

/** Monte le panneau dans `host` ; renvoie la fonction qui défait tout. */
export function mountWhatsNewPanel(host: HTMLElement, opts: WhatsNewPanelOptions): () => void {
  const entries = opts.mascots
    .map((id) => findMascot(id))
    .filter((e): e is CatalogEntry => !!e && opts.mascots.includes(e.manifest.id) && e.manifest.renderer === "gum");
  // Pas de doublon si deux ids sont retombés sur la même mascotte.
  const seen = new Set<string>();
  const mascots = entries.filter((e) => !seen.has(e.manifest.id) && seen.add(e.manifest.id));

  // En économie d'énergie, une seule mascotte dessinée à la fois.
  const perPage = Math.max(1, Math.min(perfMode() === "eco" ? 1 : 3, mascots.length));
  let first = 0;
  let selected = mascots.find((e) => e.manifest.id === settingsStore.current.mascot.id)?.manifest.id ?? mascots[0]?.manifest.id ?? "";
  let adopted = settingsStore.current.mascot.enabled ? settingsStore.current.mascot.id : "";
  let shown: { entry: CatalogEntry; renderer: GumRenderer; card: HTMLElement; idle: () => void }[] = [];
  let tick = 0;
  let gestureTimer = 0;
  let restTimer = 0;

  const cards = el("div", { class: "wn-cards" });
  const prev = el("button", { class: "icon-btn", title: "Précédent", onclick: () => page(-1) }, "‹");
  const next = el("button", { class: "icon-btn", title: "Suivant", onclick: () => page(1) }, "›");
  const adopt = el("button", { class: "btn small", onclick: () => doAdopt() }, "Adopter");
  const lines = el("div", { class: "wn-lines" }, opts.text);
  const hint = el("div", { class: "wn-lines" }, opts.hint ?? "De nouvelles mascottes en gomme. Cliquez sur l'une d'elles, puis « Adopter » : l'île change tout de suite.");
  const panel = el(
    "div",
    { class: "wn-panel" },
    el("div", { class: "wn-carousel" }, prev, cards, next),
    el("div", { class: "wn-foot" }, opts.text ? lines : hint, adopt),
  );
  host.append(panel);

  const paging = mascots.length > perPage;
  prev.style.visibility = next.style.visibility = paging ? "" : "hidden";

  /** Le bouton « Adopter » suit la carte choisie. */
  function refreshButtons() {
    for (const s of shown) {
      s.card.classList.toggle("sel", s.entry.manifest.id === selected);
      s.card.classList.toggle("adopted", s.entry.manifest.id === adopted);
      s.card.setAttribute("aria-pressed", String(s.entry.manifest.id === selected));
    }
    const done = !!selected && selected === adopted;
    adopt.textContent = done ? "Adoptée" : "Adopter";
    adopt.disabled = done || !selected;
  }

  function doAdopt() {
    const id = selected;
    if (!id || id === adopted) return;
    void settingsStore.update((d) => {
      d.mascot.id = id;
      d.mascot.enabled = true;
    });
    adopted = id;
    refreshButtons();
    opts.onAdopt?.(id);
  }

  /** Détruit les mascottes affichées (moteurs, minuteries). */
  function clearPage() {
    window.clearTimeout(gestureTimer);
    window.clearTimeout(restTimer);
    gestureTimer = restTimer = 0;
    for (const s of shown) s.renderer.destroy();
    shown = [];
    cards.replaceChildren();
  }

  /** Dessine la page courante : `perPage` mascottes à partir de `first`. */
  function showPage() {
    clearPage();
    prev.disabled = first <= 0;
    next.disabled = first + perPage >= mascots.length;
    for (let i = 0; i < perPage; i++) {
      const entry = mascots[first + i];
      if (!entry) break;
      const id = entry.manifest.id;
      const slot = el("div", { class: "wn-canvas" });
      const name = el("div", { class: "wn-name" }, shortName(entry.manifest.name));
      const card = el("button", { class: "wn-card", title: entry.manifest.name, onclick: () => select(id) }, slot, name);
      cards.append(card);
      const renderer = new GumRenderer(entry.manifest);
      renderer.mount(slot);
      const idle = () => renderer.play(spec(entry, "idle"));
      renderer.onAnimationEnd(idle);
      idle();
      shown.push({ entry, renderer, card, idle });
    }
    refreshButtons();
    if (!reducedMotion()) gestureTimer = window.setTimeout(gesture, GESTURE_EVERY_MS);
  }

  /** Une mascotte de la page fait un geste, puis se repose ; la suivante après elle. */
  function gesture() {
    gestureTimer = 0;
    if (!shown.length) return;
    const who = shown[tick % shown.length];
    const [name, ms] = GESTURES[Math.floor(tick / shown.length) % GESTURES.length];
    tick++;
    who.renderer.play(spec(who.entry, name));
    restTimer = window.setTimeout(() => {
      restTimer = 0;
      who.idle();
      gestureTimer = window.setTimeout(gesture, GESTURE_EVERY_MS);
    }, ms);
  }

  function select(id: string) {
    selected = id;
    refreshButtons();
  }

  /** Page suivante ou précédente (la dernière montre les dernières, sans revenir au début). */
  function page(dir: number) {
    if (!paging) return;
    const last = Math.max(0, mascots.length - perPage);
    first = Math.max(0, Math.min(last, first + dir * perPage));
    selected = mascots[first].manifest.id;
    showPage();
  }

  // Si la mascotte change par ailleurs (réglages), la coche suit.
  const stopSettings = settingsStore.onChange((s) => {
    adopted = s.mascot.enabled ? s.mascot.id : "";
    refreshButtons();
  });

  showPage();
  return () => {
    stopSettings();
    clearPage();
    panel.remove();
  };
}
