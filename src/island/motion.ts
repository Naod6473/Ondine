// Les effets d'animation de l'île et des réglages, en deux intensités
// (réglage Apparence → Animations) :
//
//   Classique : les mêmes effets, en douceur (sans flou, sans rebond).
//   Studio    : façon vidéo de présentation (flou → net franc, rebonds,
//               boutons en gélatine).
//
// Les éléments arrivent l'un après l'autre, les chiffres « roulent » quand ils
// changent, les listes glissent à leur nouvelle place… Si Windows demande
// moins d'animations (prefers-reduced-motion), rien ne bouge.

import { reducedMotion } from "./tab-pill";

/** Les animations sont-elles autorisées ? */
export function motionOn(): boolean {
  return !reducedMotion();
}

/** Le design Studio (la version forte) est-il choisi ? */
export function studioOn(): boolean {
  return document.body.classList.contains("motion-studio") && !reducedMotion();
}

/** Active ou coupe le design Studio (classe sur <body>, utilisée aussi en CSS). */
export function setStudio(on: boolean) {
  document.body.classList.toggle("motion-studio", on);
}

/**
 * Les réglages de chaque intensité : flou (px), distance (px), petit zoom de
 * départ, écart entre deux éléments (ms), durée (ms) et courbe.
 */
function feel() {
  return studioOn()
    ? { blur: 10, rise: 10, scale: 0.96, gap: 45, ms: 520, ease: SPRING }
    : { blur: 0, rise: 6, scale: 0.99, gap: 28, ms: 340, ease: OUT };
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
 * l'un après l'autre (plus franc en Studio).
 */
export function staggerIn(root: Element, startDelay = 40) {
  if (!motionOn()) return;
  const f = feel();
  pieces(root).forEach((piece, i) => {
    piece.animate(
      [
        { opacity: 0, transform: `translateY(${f.rise}px) scale(${f.scale})`, filter: `blur(${f.blur}px)` },
        { opacity: 1, transform: "none", filter: "blur(0)" },
      ],
      { duration: f.ms, delay: startDelay + i * f.gap, easing: f.ease, fill: "backwards" },
    );
  });
  revealTitles(root, startDelay);
  growCover(root, startDelay);
  drawCharts(root, startDelay);
  resetLists();
}

// ── Les titres qui se révèlent ───────────────────────────────────────────────

/** Les titres d'une vue : ils se dévoilent de gauche à droite, flous puis nets. */
const TITLES = "h1, h2, h3, .media-title, .sys-title, .ask-outgoing-head b";

function revealTitles(root: Element, delay: number) {
  const strong = studioOn();
  root.querySelectorAll<HTMLElement>(TITLES).forEach((title, i) => {
    // Un masque en dégradé glisse sur le texte : les lettres apparaissent une à une.
    // (On ne touche pas au texte lui-même : la traduction anglaise reste intacte.)
    title.animate(
      [
        { maskImage: "linear-gradient(90deg, #000 40%, transparent 60%)", maskSize: "260% 100%", maskPosition: "100% 0", filter: `blur(${strong ? 5 : 0}px)`, letterSpacing: strong ? "0.12em" : "normal" },
        { maskImage: "linear-gradient(90deg, #000 40%, transparent 60%)", maskSize: "260% 100%", maskPosition: "0% 0", filter: "blur(0)", letterSpacing: "normal" },
      ],
      { duration: strong ? 620 : 420, delay: delay + 60 + i * 60, easing: OUT, fill: "backwards" },
    );
  });
}

// ── La pochette qui grandit ──────────────────────────────────────────────────

/** Musique : la grande pochette part de la place de la petite (en haut à gauche) et grandit. */
function growCover(root: Element, delay: number) {
  const cover = root.querySelector(".media-cover.large");
  if (!cover) return;
  const strong = studioOn();
  cover.animate(
    [
      strong
        ? { transform: "translate(-34px, -30px) scale(0.3)", borderRadius: "50%", filter: "blur(6px)" }
        : { transform: "translate(-14px, -12px) scale(0.7)" },
      { transform: "none", filter: "blur(0)" },
    ],
    { duration: strong ? 640 : 420, delay, easing: strong ? SPRING : OUT, fill: "backwards" },
  );
}

// ── Les graphiques qui se dessinent ──────────────────────────────────────────

/** Les vues dont les barres se sont déjà dessinées (elles sont refaites à chaque mesure). */
const drawnViews = new WeakSet<Element>();

/** Système : les anneaux tournent en arrivant, les barres des disques se remplissent. */
function drawCharts(root: Element, delay: number) {
  const strong = studioOn();
  root.querySelectorAll(".sys-ring").forEach((ring, i) => {
    ring.animate(
      [
        { transform: strong ? "rotate(-120deg) scale(0.7)" : "rotate(-40deg) scale(0.92)", opacity: 0 },
        { transform: "none", opacity: 1 },
      ],
      { duration: strong ? 760 : 480, delay: delay + i * (strong ? 90 : 50), easing: strong ? SPRING : OUT, fill: "backwards" },
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
    const strong = studioOn();
    bar.animate([{ width: "0%" }, { width: bar.style.width || "0%" }], { duration: strong ? 900 : 600, delay: i * 60, easing: strong ? SPRING : OUT, fill: "backwards" });
  });
}

// ── Le changement d'onglet ───────────────────────────────────────────────────

/** L'ancien onglet s'en va (en Studio : plus de flou, un léger recul). */
export function tabOut(old: Element, direction: number): Animation {
  const strong = studioOn();
  return old.animate(
    [
      { opacity: 1, transform: "none", filter: "blur(0)" },
      strong
        ? { opacity: 0, transform: `translateX(${-direction * 30}px) scale(0.92)`, filter: "blur(14px)" }
        : { opacity: 0, transform: `translateX(${-direction * 18}px) scale(0.98)` },
    ],
    { duration: strong ? 260 : 220, easing: OUT, fill: "forwards" },
  );
}

/** Une notification qui arrive : elle « sort » de la pilule en grossissant. */
export function popIn(card: Element) {
  if (!motionOn()) return;
  const strong = studioOn();
  card.animate(
    strong
      ? [
          { opacity: 0, transform: "scale(0.6)", filter: "blur(12px)" },
          { opacity: 1, transform: "scale(1.03)", filter: "blur(0)", offset: 0.6 },
          { opacity: 1, transform: "none", filter: "blur(0)" },
        ]
      : [
          { opacity: 0, transform: "scale(0.92)" },
          { opacity: 1, transform: "none" },
        ],
    { duration: strong ? 560 : 340, easing: OUT, fill: "backwards" },
  );
}

// ── Les chiffres qui roulent ─────────────────────────────────────────────────

/** Le dernier texte vu pour chaque élément, pour savoir s'il a vraiment changé. */
const lastText = new WeakMap<Element, string>();
/** L'heure (ms) du dernier changement de chaque élément, pour repérer les compteurs rapides. */
const lastChange = new WeakMap<Element, number>();
/** Un texte qui change plus vite que ça (chronomètre aux centièmes) ne roule pas. */
const FAST_MS = 400;

/**
 * On surveille tout le contenu de l'île (MutationObserver) :
 *  - un texte qui contient des chiffres change (minuteur, volume, heure,
 *    pourcentage…) : l'ancien glisse en floutant et le nouveau arrive ;
 *  - une liste est redessinée : les lignes glissent jusqu'à leur nouvelle place ;
 *  - les barres des disques arrivent : elles se remplissent.
 */
export function watchContent(root: Element, opts: { lists?: boolean } = {}) {
  const lists = opts.lists ?? true;
  const observer = new MutationObserver((records) => {
    if (!motionOn()) return;
    const touched = new Set<Element>();
    let listsChanged = false;
    for (const r of records) {
      const target = r.type === "characterData" ? r.target.parentElement : (r.target as Element);
      if (!target) continue;
      touched.add(target);
      if (lists && r.type === "childList" && (target.closest(LISTS) || target.querySelector(LISTS))) listsChanged = true;
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
  // Un compteur qui change très vite (le chronomètre, à chaque image) ne roule pas :
  // l'effet redémarrerait sans arrêt et le chiffre deviendrait illisible.
  const now = performance.now();
  const previous = lastChange.get(elem);
  lastChange.set(elem, now);
  if (previous !== undefined && now - previous < FAST_MS) {
    elem.getAnimations().forEach((a) => a.cancel());
    return;
  }
  // Pendant un glissé (barre de musique), le chiffre suit la main : pas de roulement.
  if (document.querySelector(".scrubbing")) return;
  // Le sens suit la valeur : un nombre qui monte arrive d'en bas, qui descend d'en haut.
  const up = (parseFloat(text.replace(/[^\d.-]/g, "")) || 0) >= (parseFloat(before.replace(/[^\d.-]/g, "")) || 0);
  const strong = studioOn();
  const d = strong ? 0.6 : 0.35;
  const from = `${up ? d : -d}em`; // en « em » : marche aussi dans un dessin SVG
  // Un texte « en ligne » ne peut pas glisser : on en fait un petit bloc.
  if (elem instanceof HTMLElement && getComputedStyle(elem).display === "inline") elem.style.display = "inline-block";
  // On arrête d'abord un roulement encore en cours : sinon on lirait sa position
  // « en plein glissement » comme si c'était la position normale, et le chiffre
  // descendrait un peu plus à chaque changement (le bug du chronomètre).
  elem.getAnimations().forEach((a) => a.cancel());
  // L'élément peut déjà être tourné ou déplacé en CSS (le texte du minuteur) :
  // on garde sa transformation et on ajoute le glissement devant.
  const own = getComputedStyle(elem).transform;
  const base = own && own !== "none" ? own : "";
  elem.animate(
    [
      { transform: `translateY(${from}) ${base}`, filter: `blur(${strong ? 4 : 0}px)`, opacity: strong ? 0.2 : 0.4 },
      { transform: `translateY(0) ${base}`, filter: "blur(0)", opacity: 1 },
    ],
    { duration: strong ? 340 : 260, easing: strong ? SPRING : OUT },
  );
}

// ── La gélatine des boutons ──────────────────────────────────────────────────

/**
 * Appui sur un bouton : il s'écrase un peu ; au relâchement il revient (en
 * Studio il rebondit, plus large puis plus haut, comme une gomme).
 */
export function jellyButtons(root: Element) {
  root.addEventListener("pointerdown", (e) => {
    if (!motionOn()) return;
    const strong = studioOn();
    const button = (e.target as Element).closest("button, [role=switch], .ctl-dot");
    // Pas les onglets : on peut les glisser pour les ranger (tab-drag.ts les déplace déjà).
    if (!button || button.classList.contains("tab")) return;
    const down = strong ? "scale(0.9)" : "scale(0.95)";
    const press = button.animate([{ transform: "none" }, { transform: down }], {
      duration: 120,
      easing: OUT,
      fill: "forwards",
    });
    const release = () => {
      button.removeEventListener("pointerup", release);
      button.removeEventListener("pointerleave", release);
      press.cancel();
      // Classique : il revient simplement ; Studio : il rebondit comme une gomme.
      button.animate(
        strong
          ? [
              { transform: down },
              { transform: "scale(1.08, 0.95)", offset: 0.35 },
              { transform: "scale(0.97, 1.04)", offset: 0.65 },
              { transform: "none" },
            ]
          : [{ transform: down }, { transform: "none" }],
        { duration: strong ? 480 : 200, easing: "ease-out" },
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
  const f = feel();
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
            { opacity: 0, transform: `scale(${f.scale - 0.02})`, filter: `blur(${f.blur * 0.8}px)` },
            { opacity: 1, transform: "none", filter: "blur(0)" },
          ],
          { duration: f.ms - 100, easing: f.ease },
        );
      } else if (old.x !== pos.x || old.y !== pos.y) {
        child.animate([{ transform: `translate(${old.x - pos.x}px, ${old.y - pos.y}px)` }, { transform: "none" }], { duration: f.ms - 40, easing: f.ease });
      }
    }
    snapshots.set(id, now);
  });
}

// ── Le reflet qui suit la souris ─────────────────────────────────────────────

/** Un reflet doux suit le curseur sur le verre de l'île (voir island.css). */
export function spotlight(shell: HTMLElement) {
  shell.addEventListener("pointermove", (e) => {
    if (!motionOn()) return;
    const r = shell.getBoundingClientRect();
    shell.style.setProperty("--mx", `${e.clientX - r.left}px`);
    shell.style.setProperty("--my", `${e.clientY - r.top}px`);
  });
}
