// Les barres de défilement discrètes de l'île et de la bulle d'Ondine.
//
// Le dessin est dans island.css (::-webkit-scrollbar) : une fine pastille
// grise translucide, sans flèches. Ce fichier décide QUAND on la voit, en
// animant la variable --sb-a (0 = invisible, 1 = visible) de chaque zone qui
// défile :
//   - au survol d'une zone qui peut défiler, elle apparaît ;
//   - pendant le défilement (molette, glisser, clavier), elle apparaît ;
//   - la souris partie et le défilement arrêté, elle s'efface en douceur.
// Une animation Web (element.animate) plutôt qu'une transition CSS : poser
// `transition` sur toutes les zones écraserait leurs propres transitions.
// Avec « Réduire les animations », elle apparaît et disparaît d'un coup.

import { reducedMotion } from "./tab-pill";

/** Après le dernier défilement (ms), elle s'efface (si la souris n'est plus là). */
const IDLE_MS = 900;
const IN_MS = 140;
const OUT_MS = 420;

const anims = new WeakMap<Element, Animation>();
const timers = new WeakMap<Element, number>();
const shown = new Set<Element>();
let hovered = new Set<Element>();

/** Peut-elle défiler (et défile-t-elle par elle-même, overflow auto/scroll) ? */
function scrolls(el: Element): boolean {
  const y = el.scrollHeight > el.clientHeight + 1;
  const x = el.scrollWidth > el.clientWidth + 1;
  if (!x && !y) return false;
  const cs = getComputedStyle(el);
  const can = (v: string) => v === "auto" || v === "scroll";
  return (y && can(cs.overflowY)) || (x && can(cs.overflowX));
}

function fade(el: Element, to: 0 | 1) {
  if (to === 1 ? shown.has(el) : !shown.has(el)) return;
  if (to === 1) shown.add(el);
  else shown.delete(el);
  const from = parseFloat(getComputedStyle(el).getPropertyValue("--sb-a")) || 0;
  anims.get(el)?.cancel();
  const ms = reducedMotion() ? 0 : to === 1 ? IN_MS : OUT_MS;
  const a = el.animate([{ "--sb-a": String(from) }, { "--sb-a": String(to) }], { duration: ms, easing: "ease-out", fill: "forwards" });
  anims.set(el, a);
  // Effacée : plus rien ne reste posé sur l'élément.
  if (to === 0) a.onfinish = () => anims.get(el) === a && (a.cancel(), anims.delete(el));
}

function onScroll(e: Event) {
  const t = e.target;
  const el = t instanceof Element ? t : document.scrollingElement;
  if (!el) return;
  fade(el, 1);
  window.clearTimeout(timers.get(el));
  timers.set(el, window.setTimeout(() => !hovered.has(el) && fade(el, 0), IDLE_MS));
}

function onOver(e: PointerEvent) {
  const next = new Set<Element>();
  for (let el = e.target instanceof Element ? e.target : null; el; el = el.parentElement) {
    if (scrolls(el)) next.add(el);
  }
  for (const el of hovered) if (!next.has(el)) fade(el, 0);
  for (const el of next) fade(el, 1);
  hovered = next;
}

function leaveAll() {
  for (const el of hovered) fade(el, 0);
  hovered = new Set();
}

let started = false;

/** Une fois par page (l'île, la bulle d'Ondine). */
export function startScrollbars() {
  if (started) return;
  started = true;
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  document.addEventListener("pointerover", onOver, { passive: true });
  document.documentElement.addEventListener("pointerleave", leaveAll);
  window.addEventListener("blur", leaveAll);
}
