// Le texte qui bouge dans Parler à Ondine, en douceur (1.2.4) :
//
//   - LiveWords : vos mots en direct. La bulle est mise à jour sur place : les
//     mots déjà là ne bougent pas, les nouveaux arrivent en fondu doux, et une
//     fin de phrase réécrite par le moteur passe en fondu croisé ;
//   - Typewriter : la réponse d'Ondine, lettre après lettre, chaque lettre en
//     fondu ; la fin du mot en cours est gardée invisible à sa place, pour
//     qu'un mot ne saute pas à la ligne en s'écrivant ;
//   - HeightTween : une bulle qui prend une ligne grandit en glissant (l'île
//     qui suit son contenu, fit.ts, grandit donc ligne par ligne, sans à-coup) ;
//   - ScrollFollow : la conversation défile en douceur vers le bas, sans
//     sauter à chaque lettre, et reste où vous l'avez mise si vous remontez ;
//   - syncThread : la liste des bulles est mise à jour sans tout redessiner
//     (une bulle déjà là n'est jamais refaite ; celle qui s'en va s'efface
//     sans prendre de place, les autres glissent à leur nouvelle place).
//
// Les calculs sont dans flow-logic.ts. « Réduire les animations » (Windows)
// ou mascotte « Calme » (`instant()`) : tout s'affiche tout de suite, sans
// fondu ni glissement. Aucune boucle ne tourne quand rien ne bouge.
//
// Jamais de texte changé « sur place » dans un élément sans enfants : les
// chiffres qui changent roulent (motion.ts, watchContent). On remplace des
// morceaux (`span`) à la place.

import { CROSSFADE_MAX_CHARS, diffWords, wordEnd, wordsOf } from "./flow-logic";

/** La courbe des fondus et des glissements (la même que --ease). */
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
/** Durée d'un glissement de hauteur (ms). */
const GROW_MS = 240;

const easeOut = (p: number) => 1 - (1 - p) ** 3;

/**
 * La hauteur de `outer` suit celle de `inner` en glissant : quand une ligne
 * s'ajoute (ou s'en va), `outer` passe de l'ancienne hauteur à la nouvelle en
 * GROW_MS, et reprend sa hauteur naturelle à la fin. Interruptible : une
 * nouvelle ligne repart de la hauteur affichée.
 */
export class HeightTween {
  private raf = 0;
  private from = 0;
  private to = 0;
  private t0 = 0;
  private last = -1;
  private readonly observer: ResizeObserver;

  constructor(
    private readonly outer: HTMLElement,
    inner: HTMLElement,
    private readonly instant: () => boolean,
  ) {
    this.observer = new ResizeObserver(() => this.changed(inner.getBoundingClientRect().height));
    this.observer.observe(inner);
  }

  private changed(h: number) {
    if (this.last < 0 || !this.outer.isConnected) {
      this.last = h;
      return;
    }
    if (Math.abs(h - this.last) < 0.5) return;
    const from = this.raf ? this.current() : this.last;
    this.last = h;
    if (this.instant()) {
      this.stop();
      return;
    }
    this.from = from;
    this.to = h;
    this.t0 = performance.now();
    // Tout de suite (avant que l'image ne se dessine) : l'ancienne hauteur.
    this.apply(from);
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private current(): number {
    const p = Math.min(1, (performance.now() - this.t0) / GROW_MS);
    return this.from + (this.to - this.from) * easeOut(p);
  }

  private apply(h: number) {
    const st = this.outer.style;
    st.height = `${h}px`;
    st.overflow = "hidden";
  }

  private tick = () => {
    this.raf = 0;
    if (!this.outer.isConnected) return this.stop();
    const p = (performance.now() - this.t0) / GROW_MS;
    if (p >= 1) return this.stop();
    this.apply(this.current());
    this.raf = requestAnimationFrame(this.tick);
  };

  private stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.outer.style.removeProperty("height");
    this.outer.style.removeProperty("overflow");
  }

  dispose() {
    this.observer.disconnect();
    this.stop();
  }
}

/**
 * Une bulle qui s'en va : elle ne prend plus de place tout de suite (posée
 * par-dessus, à sa dernière place) et s'efface ; les autres glissent à leur
 * nouvelle place (syncThread). La liste doit être `position: relative`.
 */
export function leave(node: HTMLElement, instant: boolean) {
  if (instant || !node.isConnected) {
    node.remove();
    return;
  }
  const { offsetTop: top, offsetLeft: left, offsetWidth: width } = node;
  node.dataset.leaving = "";
  node.setAttribute("aria-hidden", "true");
  Object.assign(node.style, { position: "absolute", top: `${top}px`, left: `${left}px`, width: `${width}px`, margin: "0", pointerEvents: "none" });
  node.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(0.97)" }], { duration: 180, easing: EASE, fill: "forwards" }).finished.then(
    () => node.remove(),
    () => node.remove(),
  );
}

/**
 * Vos mots en direct, dans `box` : un `span` par mot. `set(text)` compare
 * avec ce qui est affiché (diffWords) : les mots communs restent tels quels.
 */
export class LiveWords {
  private words: string[] = [];

  constructor(
    private readonly box: HTMLElement,
    private readonly instant: () => boolean,
  ) {}

  /** Le texte affiché (mots séparés par une espace). */
  get text(): string {
    return this.words.join(" ");
  }

  set(text: string) {
    const next = wordsOf(text);
    const d = diffWords(this.words, next);
    if (d.replaced.length === 0 && d.added.length === 0) return;
    this.words = next;
    const fade = !this.instant();
    // Un fondu croisé encore en cours : fini tout de suite (ses nouveaux mots restent).
    for (const swap of this.box.querySelectorAll(".ask-swap")) swap.replaceWith(...(swap.querySelector(".ask-swap-new")?.children ?? []));
    // Les mots réécrits s'en vont.
    for (const c of [...this.box.children].slice(d.keep)) c.remove();
    const fresh = d.added.map((w, i) => this.word(w, d.keep + i, fade && d.replaced.length === 0));
    const changed = d.replaced.join(" ");
    if (fade && d.replaced.length > 0 && changed.length <= CROSSFADE_MAX_CHARS && d.added.length > 0) {
      // Fondu croisé : l'ancienne fin et la nouvelle, superposées le temps du fondu.
      const swap = document.createElement("span");
      swap.className = "ask-swap";
      const gone = document.createElement("span");
      gone.className = "ask-swap-old";
      gone.setAttribute("aria-hidden", "true");
      gone.textContent = (d.keep > 0 ? " " : "") + changed;
      const now = document.createElement("span");
      now.className = "ask-swap-new";
      now.append(...fresh);
      swap.append(gone, now);
      this.box.append(swap);
      const opts = { duration: 260, easing: EASE };
      gone.animate([{ opacity: 1 }, { opacity: 0 }], { ...opts, fill: "forwards" });
      now.animate([{ opacity: 0 }, { opacity: 1 }], opts).finished.then(
        () => {
          // Fini : les mots reprennent leur place normale (sans bloc).
          if (swap.isConnected) swap.replaceWith(...fresh);
        },
        () => {},
      );
      return;
    }
    // Des mots ajoutés (ou une réécriture trop longue : fondu simple).
    if (fade && d.replaced.length > 0) for (const f of fresh) f.classList.add("ask-in");
    this.box.append(...fresh);
  }

  /** Remet tout à zéro (une nouvelle écoute). */
  clear() {
    this.words = [];
    this.box.replaceChildren();
  }

  private word(w: string, index: number, fade: boolean): HTMLSpanElement {
    const s = document.createElement("span");
    s.className = fade ? "ask-w ask-in" : "ask-w";
    s.textContent = (index > 0 ? " " : "") + w;
    return s;
  }
}

/**
 * La réponse qui s'écrit dans `box` : `show(n)` montre les `n` premiers
 * caractères, chaque nouveau morceau en fondu, la fin du mot en cours
 * réservée (invisible). `done()` : le texte entier, en un seul morceau, une
 * fois les derniers fondus finis.
 */
export class Typewriter {
  /** Chaque vue qui montre la réponse (l'île, la bulle d'Ondine sur le bureau) : ce qui y est écrit. */
  private boxes = new Map<HTMLElement, { shown: number; ghost: HTMLSpanElement | null }>();
  private shown = 0;

  constructor(
    private readonly text: string,
    private readonly instant: () => boolean,
  ) {}

  /** Écrit dans `box` (une bulle refaite repart de ce qui est déjà visible). */
  show(box: HTMLElement, n: number) {
    this.shown = Math.max(this.shown, Math.min(n, this.text.length));
    let st = this.boxes.get(box);
    if (!st) {
      for (const b of this.boxes.keys()) if (!b.isConnected) this.boxes.delete(b);
      // Une bulle refaite : ce qui était déjà visible revient sans fondu.
      st = { shown: this.shown, ghost: null };
      this.boxes.set(box, st);
      box.replaceChildren(this.text.slice(0, this.shown));
    }
    const upTo = this.shown;
    if (upTo > st.shown) {
      const piece = document.createElement("span");
      if (!this.instant()) piece.className = "ask-ch";
      piece.textContent = this.text.slice(st.shown, upTo);
      if (st.ghost) st.ghost.before(piece);
      else box.append(piece);
      st.shown = upTo;
    }
    // La fin du mot en cours, à sa place mais invisible (remplacée, jamais réécrite).
    const rest = this.text.slice(upTo, wordEnd(this.text, upTo));
    if ((st.ghost?.textContent ?? "") !== rest) {
      let g: HTMLSpanElement | null = null;
      if (rest) {
        g = document.createElement("span");
        g.className = "ask-ghost";
        g.setAttribute("aria-hidden", "true");
        g.textContent = rest;
      }
      if (st.ghost && g) st.ghost.replaceWith(g);
      else if (st.ghost) st.ghost.remove();
      else if (g) box.append(g);
      st.ghost = g;
    }
  }

  /** Le texte entier, en un seul nœud (après les derniers fondus). */
  done() {
    this.shown = this.text.length;
    for (const box of this.boxes.keys()) {
      if (!box.isConnected) continue;
      this.show(box, this.text.length);
      window.setTimeout(() => {
        if (box.isConnected && box.textContent === this.text) box.textContent = this.text;
      }, 400);
    }
  }
}

/**
 * La conversation défile vers le bas en douceur quand elle s'allonge, si
 * vous étiez en bas (vous avez remonté pour relire : elle ne bouge pas).
 */
export class ScrollFollow {
  private raf = 0;
  private last = 0;
  private stick = true;
  private user = 0;

  constructor(
    private readonly list: HTMLElement,
    private readonly instant: () => boolean,
  ) {
    // Vous faites défiler : on regarde où vous vous arrêtez.
    const mark = () => (this.user = performance.now());
    list.addEventListener("wheel", mark, { passive: true });
    list.addEventListener("pointerdown", mark);
    list.addEventListener("keydown", mark);
    list.addEventListener("scroll", () => {
      if (performance.now() - this.user < 600) this.stick = this.gap() < 24;
    }, { passive: true });
  }

  private gap(): number {
    return this.list.scrollHeight - this.list.clientHeight - this.list.scrollTop;
  }

  /** Va en bas (tout de suite avec `now`, ou pour un nouvel envoi : `force`). */
  follow(force = false) {
    if (force) this.stick = true;
    if (!this.stick) return;
    if (this.instant()) {
      this.list.scrollTop = this.list.scrollHeight;
      return;
    }
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (!this.list.isConnected || !this.stick) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const gap = this.gap();
    if (gap <= 0.5) return;
    // Rattrape le bas avec une approche amortie (~90 ms), sans dépasser.
    const k = 1 - Math.exp(-dt / 0.09);
    this.list.scrollTop += Math.max(1, gap * k);
    this.raf = requestAnimationFrame(this.tick);
  };
}

/** Une bulle voulue dans la conversation : sa clé, sa « signature » (refaite seulement si elle change), sa fabrique. */
export interface ThreadItem {
  key: string;
  sig: string;
  build: () => HTMLElement;
}

const sigs = new WeakMap<Element, string>();

/** La clé d'une bulle déjà dans la liste. */
export function keyOf(node: Element): string | undefined {
  return (node as HTMLElement).dataset?.key;
}

/** Donne une clé et une signature à une bulle transformée sur place (la bulle en direct devenue votre message). */
export function rekey(node: HTMLElement, key: string, sig: string) {
  node.dataset.key = key;
  sigs.set(node, sig);
}

/** Où est chaque bulle à l'écran (avant un changement), pour les faire glisser ensuite. */
export function snapshot(list: HTMLElement): Map<Element, number> {
  const at = new Map<Element, number>();
  for (const c of list.children) if (!("leaving" in (c as HTMLElement).dataset)) at.set(c, c.getBoundingClientRect().top);
  return at;
}

/**
 * Met la liste à jour : les bulles dont la signature n'a pas changé restent
 * (elles ne clignotent pas, leurs animations continuent), les autres sont
 * refaites à leur place, celles qui ne sont plus voulues s'effacent sans
 * prendre de place (leave). Les bulles qui restent glissent de leur ancienne
 * place à la nouvelle (FLIP), d'après `before` (snapshot, pris avant tout
 * changement de la liste).
 */
export function syncThread(list: HTMLElement, items: ThreadItem[], instant: boolean, before = snapshot(list)) {
  const have = new Map<string, HTMLElement>();
  for (const c of list.children) {
    const k = keyOf(c);
    if (k !== undefined && !("leaving" in (c as HTMLElement).dataset)) have.set(k, c as HTMLElement);
  }
  const wanted = new Set(items.map((it) => it.key));
  // D'abord celles qui s'en vont (mesurées tant que la liste n'a pas bougé).
  for (const [k, node] of have) {
    if (wanted.has(k)) continue;
    have.delete(k);
    leave(node, instant);
  }
  const want: HTMLElement[] = [];
  for (const it of items) {
    let node = have.get(it.key);
    if (!node || sigs.get(node) !== it.sig) {
      const fresh = it.build();
      fresh.dataset.key = it.key;
      sigs.set(fresh, it.sig);
      if (node) node.replaceWith(fresh);
      node = fresh;
    }
    want.push(node);
  }
  // Dans l'ordre voulu (de la fin vers le début), sans toucher aux bulles déjà à leur place.
  let ref: Element | null = null;
  for (let i = want.length - 1; i >= 0; i--) {
    const node = want[i];
    let next = node.nextElementSibling;
    while (next && "leaving" in (next as HTMLElement).dataset) next = next.nextElementSibling;
    if (node.parentElement !== list || next !== ref) list.insertBefore(node, ref);
    ref = node;
  }
  if (instant) return;
  for (const node of want) {
    const old = before.get(node);
    if (old === undefined) continue;
    const dy = old - node.getBoundingClientRect().top;
    if (Math.abs(dy) > 0.5) node.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 320, easing: EASE, composite: "add" });
  }
}

/**
 * Change un petit texte (« J'écoute… » → « J'écris ce que vous avez dit… »)
 * en fondu croisé : `box` empile l'ancien et le nouveau au même endroit
 * (CSS : .ask-stack), l'ancien s'efface puis s'en va.
 */
export function swapText(box: HTMLElement, text: string, instant: boolean, make: (text: string) => HTMLElement) {
  const now = make(text);
  const old = [...box.children] as HTMLElement[];
  box.append(now);
  if (instant) {
    old.forEach((o) => o.remove());
    return;
  }
  const opts = { duration: 220, easing: EASE };
  now.animate([{ opacity: 0 }, { opacity: 1 }], opts);
  for (const o of old) {
    o.setAttribute("aria-hidden", "true");
    o.animate([{ opacity: Number(getComputedStyle(o).opacity) || 1 }, { opacity: 0 }], { ...opts, fill: "forwards" }).finished.then(() => o.remove(), () => o.remove());
  }
}

/**
 * La bulle en direct devient votre message, sans clignoter : la ligne du
 * haut (point rouge, « J'écoute… ») et celle du bas s'effacent sur place, la
 * bulle prend sa taille de message en glissant et le texte remonte en
 * douceur. `change()` fait le changement (classes, éléments retirés, mots).
 */
export function morphBubble(node: HTMLElement, fading: HTMLElement[], text: HTMLElement, instant: boolean, change: () => void) {
  if (instant) {
    change();
    return;
  }
  const r0 = node.getBoundingClientRect();
  const t0 = text.getBoundingClientRect();
  // Les lignes qui s'en vont : une copie fixe à leur place, qui s'efface.
  const ghosts = fading.filter((f) => f.isConnected).map((f) => {
    const g = f.cloneNode(true) as HTMLElement;
    g.setAttribute("aria-hidden", "true");
    Object.assign(g.style, { position: "absolute", left: `${f.offsetLeft}px`, top: `${f.offsetTop}px`, width: `${f.offsetWidth}px`, margin: "0", pointerEvents: "none" });
    return g;
  });
  change();
  for (const g of ghosts) {
    node.append(g);
    g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: EASE, fill: "forwards" }).finished.then(() => g.remove(), () => g.remove());
  }
  const r1 = node.getBoundingClientRect();
  const t1 = text.getBoundingClientRect();
  const opts = { duration: GROW_MS, easing: EASE };
  if (Math.abs(r1.width - r0.width) > 0.5 || Math.abs(r1.height - r0.height) > 0.5) {
    node.animate(
      [
        { width: `${r0.width}px`, height: `${r0.height}px`, boxSizing: "border-box", overflow: "hidden" },
        { width: `${r1.width}px`, height: `${r1.height}px`, boxSizing: "border-box", overflow: "hidden" },
      ],
      opts,
    );
  }
  // Le texte remonte en douceur (la largeur, elle, suit déjà la bulle qui glisse).
  const dy = t0.top - r0.top - (t1.top - r1.top);
  if (Math.abs(dy) > 0.5) text.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], opts);
}
