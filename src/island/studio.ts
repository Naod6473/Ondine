// Le design d'animation « Studio » (réglage Apparence → Animations).
//
// Inspiré des vidéos de présentation d'interface : les éléments arrivent flous
// puis deviennent nets, l'un après l'autre ; les chiffres « roulent » quand ils
// changent ; les boutons s'écrasent comme de la gélatine quand on appuie.
//
// Tout passe par la classe `motion-studio` posée sur <body> : en « Classique »,
// rien de ce fichier ne s'exécute. Et si Windows demande moins d'animations
// (prefers-reduced-motion), rien ne bouge non plus.

import { reducedMotion } from "./tab-pill";

/** Le design Studio est-il actif (et les animations autorisées) ? */
export function studioOn(): boolean {
  return document.body.classList.contains("motion-studio") && !reducedMotion();
}

/** Active ou coupe le design Studio. */
export function setStudio(on: boolean) {
  document.body.classList.toggle("motion-studio", on);
}

// La courbe « ressort » : part vite, dépasse un peu, revient se poser.
const SPRING = "cubic-bezier(0.34, 1.4, 0.5, 1)";
const OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/**
 * Les « morceaux » d'une vue à faire apparaître un par un. On descend dans les
 * enveloppes qui n'ont qu'un seul enfant, jusqu'à trouver une vraie liste.
 */
function pieces(root: Element): Element[] {
  let node: Element = root;
  for (let depth = 0; depth < 4; depth++) {
    const kids = [...node.children].filter((k) => !(k instanceof HTMLStyleElement));
    if (kids.length > 1) return kids.slice(0, 10);
    if (kids.length === 0) break;
    node = kids[0];
  }
  return [node];
}

/**
 * Arrivée en cascade : chaque morceau passe de flou et un peu plus bas à net,
 * avec 45 ms d'écart entre deux morceaux.
 */
export function staggerIn(root: Element, startDelay = 40) {
  if (!studioOn()) return;
  pieces(root).forEach((piece, i) => {
    piece.animate(
      [
        { opacity: 0, transform: "translateY(10px) scale(0.96)", filter: "blur(10px)" },
        { opacity: 1, transform: "none", filter: "blur(0)" },
      ],
      { duration: 520, delay: startDelay + i * 45, easing: SPRING, fill: "backwards" },
    );
  });
}

/** Changement d'onglet façon Studio : plus de flou, un léger zoom. */
export function tabOut(old: Element, direction: number): Animation {
  return old.animate(
    [
      { opacity: 1, transform: "none", filter: "blur(0)" },
      { opacity: 0, transform: `translateX(${-direction * 30}px) scale(0.92)`, filter: "blur(14px)" },
    ],
    { duration: 260, easing: OUT, fill: "forwards" },
  );
}

/** Une notification qui arrive : elle « sort » de la pilule en grossissant. */
export function popIn(card: Element) {
  if (!studioOn()) return;
  card.animate(
    [
      { opacity: 0, transform: "scale(0.6)", filter: "blur(12px)" },
      { opacity: 1, transform: "scale(1.03)", filter: "blur(0)", offset: 0.6 },
      { opacity: 1, transform: "none", filter: "blur(0)" },
    ],
    { duration: 560, easing: OUT, fill: "backwards" },
  );
}

// ── Les chiffres qui roulent ─────────────────────────────────────────────────

/** Le dernier texte vu pour chaque élément, pour savoir s'il a vraiment changé. */
const lastText = new WeakMap<Element, string>();

/**
 * Quand un texte qui contient des chiffres change (minuteur, volume, heure,
 * pourcentage…), l'ancien glisse vers le haut en floutant et le nouveau arrive
 * d'en bas. On surveille tout le contenu de l'île avec un MutationObserver.
 */
export function watchNumbers(root: Element) {
  const observer = new MutationObserver((records) => {
    if (!studioOn()) return;
    const touched = new Set<Element>();
    for (const r of records) {
      const target = r.type === "characterData" ? r.target.parentElement : (r.target as Element);
      if (target) touched.add(target);
    }
    for (const elem of touched) roll(elem);
  });
  observer.observe(root, { subtree: true, characterData: true, childList: true });
}

function roll(elem: Element) {
  // Seulement les petits textes « feuilles » : pas une liste entière qui se redessine.
  if (elem.children.length > 0) return;
  const text = elem.textContent ?? "";
  if (text.length > 24 || !/\d/.test(text)) return;
  const before = lastText.get(elem);
  lastText.set(elem, text);
  if (before === undefined || before === text) return;
  // Le sens suit la valeur : un nombre qui monte arrive d'en bas, qui descend d'en haut.
  const up = (parseFloat(text.replace(/[^\d.-]/g, "")) || 0) >= (parseFloat(before.replace(/[^\d.-]/g, "")) || 0);
  const from = up ? "0.6em" : "-0.6em"; // en « em » : marche aussi dans un dessin SVG
  // Un texte « en ligne » ne peut pas glisser : on en fait un petit bloc.
  if (elem instanceof HTMLElement && getComputedStyle(elem).display === "inline") elem.style.display = "inline-block";
  // L'élément peut déjà être tourné ou déplacé en CSS (le texte du minuteur) :
  // on garde sa transformation et on ajoute le glissement devant.
  const own = getComputedStyle(elem).transform;
  const base = own && own !== "none" ? own : "";
  elem.animate(
    [
      { transform: `translateY(${from}) ${base}`, filter: "blur(4px)", opacity: 0.2 },
      { transform: `translateY(0) ${base}`, filter: "blur(0)", opacity: 1 },
    ],
    { duration: 340, easing: SPRING },
  );
}

// ── La gélatine des boutons ──────────────────────────────────────────────────

/**
 * Appui sur un bouton : il s'écrase un peu ; au relâchement il rebondit
 * (plus large puis plus haut, puis se pose), comme une gomme.
 */
export function jellyButtons(root: Element) {
  root.addEventListener("pointerdown", (e) => {
    if (!studioOn()) return;
    const button = (e.target as Element).closest("button, [role=switch], .ctl-dot");
    // Pas les onglets : on peut les glisser pour les ranger (tab-drag.ts les déplace déjà).
    if (!button || button.classList.contains("tab")) return;
    const press = button.animate([{ transform: "none" }, { transform: "scale(0.9)" }], {
      duration: 120,
      easing: OUT,
      fill: "forwards",
    });
    const release = () => {
      button.removeEventListener("pointerup", release);
      button.removeEventListener("pointerleave", release);
      press.cancel();
      button.animate(
        [
          { transform: "scale(0.9)" },
          { transform: "scale(1.08, 0.95)", offset: 0.35 },
          { transform: "scale(0.97, 1.04)", offset: 0.65 },
          { transform: "none" },
        ],
        { duration: 480, easing: "ease-out" },
      );
    };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointerleave", release);
  });
}
