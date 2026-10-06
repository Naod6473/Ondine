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
  revealTitles(root, startDelay);
  growCover(root, startDelay);
  drawCharts(root, startDelay);
  resetLists();
}

// ── Les titres qui se révèlent ───────────────────────────────────────────────

/** Les titres d'une vue : ils se dévoilent de gauche à droite, flous puis nets. */
const TITLES = "h2, h3, .media-title, .sys-title, .ask-outgoing-head b";

function revealTitles(root: Element, delay: number) {
  root.querySelectorAll<HTMLElement>(TITLES).forEach((title, i) => {
    // Un masque en dégradé glisse sur le texte : les lettres apparaissent une à une.
    // (On ne touche pas au texte lui-même : la traduction anglaise reste intacte.)
    title.animate(
      [
        { maskImage: "linear-gradient(90deg, #000 40%, transparent 60%)", maskSize: "260% 100%", maskPosition: "100% 0", filter: "blur(5px)", letterSpacing: "0.12em" },
        { maskImage: "linear-gradient(90deg, #000 40%, transparent 60%)", maskSize: "260% 100%", maskPosition: "0% 0", filter: "blur(0)", letterSpacing: "normal" },
      ],
      { duration: 620, delay: delay + 80 + i * 70, easing: OUT, fill: "backwards" },
    );
  });
}

// ── La pochette qui grandit ──────────────────────────────────────────────────

/** Musique : la grande pochette part de la place de la petite (en haut à gauche) et grandit. */
function growCover(root: Element, delay: number) {
  const cover = root.querySelector(".media-cover.large");
  if (!cover) return;
  cover.animate(
    [
      { transform: "translate(-34px, -30px) scale(0.3)", borderRadius: "50%", filter: "blur(6px)" },
      { transform: "none", filter: "blur(0)" },
    ],
    { duration: 640, delay, easing: SPRING, fill: "backwards" },
  );
}

// ── Les graphiques qui se dessinent ──────────────────────────────────────────

/** Les vues dont les barres se sont déjà dessinées (elles sont refaites à chaque mesure). */
const drawnViews = new WeakSet<Element>();

/** Système : les anneaux tournent en arrivant, les barres des disques se remplissent. */
function drawCharts(root: Element, delay: number) {
  root.querySelectorAll(".sys-ring").forEach((ring, i) => {
    ring.animate(
      [
        { transform: "rotate(-120deg) scale(0.7)", opacity: 0 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 760, delay: delay + i * 90, easing: SPRING, fill: "backwards" },
    );
  });
  // Les disques arrivent un peu après (ils se chargent à part) : voir watchContent.
  drawnViews.delete(root);
}

/** Remplit les barres de disque de 0 à leur valeur, une seule fois par ouverture. */
function drawBars(view: Element) {
  if (drawnViews.has(view)) return;
  const bars = view.querySelectorAll<HTMLElement>(".sys-bar i");
  if (bars.length === 0) return;
  drawnViews.add(view);
  bars.forEach((bar, i) => {
    bar.animate([{ width: "0%" }, { width: bar.style.width || "0%" }], { duration: 900, delay: i * 80, easing: SPRING, fill: "backwards" });
  });
}

// ── L'icône d'onglet qui vole jusqu'au titre ─────────────────────────────────

/**
 * Au changement d'onglet, une copie de l'icône cliquée s'envole jusqu'en haut
 * à gauche de la vue en grandissant, puis se dissout dans le contenu.
 */
export function flyIcon(tab: Element, stage: Element) {
  if (!studioOn()) return;
  const from = tab.querySelector(".tab-icon")?.getBoundingClientRect();
  const to = stage.getBoundingClientRect();
  if (!from || from.width === 0) return;
  const ghost = tab.querySelector(".tab-icon")!.cloneNode(true) as HTMLElement;
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    display: "grid",
    placeItems: "center",
    pointerEvents: "none",
    zIndex: "50",
  });
  document.body.append(ghost);
  const dx = to.left + 18 - from.left;
  const dy = to.top + 14 - from.top;
  ghost
    .animate(
      [
        { transform: "none", opacity: 1, filter: "blur(0)" },
        { transform: `translate(${dx * 0.6}px, ${dy * 0.6}px) scale(2.2)`, opacity: 1, filter: "blur(0)", offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(2.6)`, opacity: 0, filter: "blur(8px)" },
      ],
      { duration: 620, easing: OUT },
    )
    .finished.finally(() => ghost.remove());
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
 * On surveille tout le contenu de l'île (MutationObserver) :
 *  - un texte qui contient des chiffres change (minuteur, volume, heure,
 *    pourcentage…) : l'ancien glisse en floutant et le nouveau arrive ;
 *  - une liste est redessinée : les lignes glissent jusqu'à leur nouvelle place ;
 *  - les barres des disques arrivent : elles se remplissent.
 */
export function watchContent(root: Element) {
  const observer = new MutationObserver((records) => {
    if (!studioOn()) return;
    const touched = new Set<Element>();
    let listsChanged = false;
    for (const r of records) {
      const target = r.type === "characterData" ? r.target.parentElement : (r.target as Element);
      if (!target) continue;
      touched.add(target);
      if (r.type === "childList" && (target.closest(LISTS) || target.querySelector(LISTS))) listsChanged = true;
      if (r.type === "childList" && target.querySelector(".sys-bar i")) {
        const view = target.closest(".view");
        if (view) drawBars(view);
      }
    }
    for (const elem of touched) roll(elem);
    if (listsChanged) flipLists(root);
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

// ── Les listes qui se réordonnent en glissant ────────────────────────────────

/** Les listes des modules (notes, étagère, presse-papiers, agents, agenda…). */
const LISTS = "ul, ol, .note-grid, .agenda-list";

/** Pour chaque sorte de liste : la place de chaque ligne au dernier passage. */
let snapshots = new Map<string, Map<string, { x: number; y: number }>>();

/** Nouvelle vue : on oublie les anciennes places (sinon tout « arriverait »). */
export function resetLists() {
  snapshots = new Map();
}

/** Ce qui reconnaît une ligne d'un dessin à l'autre : son id, sinon son texte. */
function keyOf(item: HTMLElement): string {
  return item.dataset.id ?? item.dataset.key ?? (item.textContent ?? "").trim().slice(0, 60);
}

/**
 * Les modules redessinent souvent leur liste en entier. On retrouve chaque
 * ligne par son texte, et celles qui ont bougé glissent depuis leur ancienne
 * place (technique « FLIP ») ; les nouvelles arrivent floues.
 */
function flipLists(root: Element) {
  const seen = new Map<string, number>();
  root.querySelectorAll<HTMLElement>(LISTS).forEach((list) => {
    // Plusieurs listes de même classe : on les distingue par leur rang.
    const kind = `${list.tagName}.${list.className}`;
    const n = seen.get(kind) ?? 0;
    seen.set(kind, n + 1);
    const id = `${kind}#${n}`;
    const before = snapshots.get(id);
    const now = new Map<string, { x: number; y: number }>();
    const counts = new Map<string, number>();
    for (const child of list.children) {
      if (!(child instanceof HTMLElement)) continue;
      const base = keyOf(child);
      const k = `${base}§${counts.get(base) ?? 0}`;
      counts.set(base, (counts.get(base) ?? 0) + 1);
      // offsetLeft/Top ignorent les transformations en cours : la vraie place.
      const pos = { x: child.offsetLeft, y: child.offsetTop };
      now.set(k, pos);
      if (!before) continue;
      const old = before.get(k);
      if (!old) {
        child.animate(
          [
            { opacity: 0, transform: "scale(0.94)", filter: "blur(8px)" },
            { opacity: 1, transform: "none", filter: "blur(0)" },
          ],
          { duration: 420, easing: SPRING },
        );
      } else if (old.x !== pos.x || old.y !== pos.y) {
        child.animate([{ transform: `translate(${old.x - pos.x}px, ${old.y - pos.y}px)` }, { transform: "none" }], { duration: 480, easing: SPRING });
      }
    }
    snapshots.set(id, now);
  });
}

// ── Le reflet qui suit la souris ─────────────────────────────────────────────

/** Un reflet doux suit le curseur sur le verre de l'île (voir island.css). */
export function spotlight(shell: HTMLElement) {
  shell.addEventListener("pointermove", (e) => {
    if (!studioOn()) return;
    const r = shell.getBoundingClientRect();
    shell.style.setProperty("--mx", `${e.clientX - r.left}px`);
    shell.style.setProperty("--my", `${e.clientY - r.top}px`);
  });
}
