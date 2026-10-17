// Le menu de fichiers dans l'île (1.2.5) : ce que montre l'île quand on y
// glisse un fichier. Maquette validée : animations-ile/maquette-menu-cercle.html
// (spec : menu-fichiers/spec.md, partie A). Il remplace les trois lignes de
// pilules du dépôt unifié (1.2.4) par des icônes, toujours DANS l'île.
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │ (Ondine) vacances.heic                    ↻ Conserver à côté │
//   │          Image · 3,4 Mo                                      │
//   │   (⇄)       (▣)       (🔧)    ┊  (★JPG) (★Projets)           │
//   │ Convertir  Ranger Alt  Outils Ctrl                           │
//   │  (JPG) (PNG) (WebP) (PDF) (🪶) (GIF) (BMP) (TIFF)             │
//   │  image image image  document plus léger …                    │
//   │            Convertir en JPG, à côté de l'original   Annuler  │
//   └──────────────────────────────────────────────────────────────┘
//                                                     ( 🧺 Étagère 2 )
//
//   - L'en-tête est gardé : le nom, le type et la taille, et la pilule
//     d'option Conserver à côté / Remplacer l'original / Sur le bureau
//     (survol de 0,5 s, clic, Maj = Remplacer). Pas pour un dossier.
//   - Trois bulles mères : Convertir, Ranger, Outils (mêmes contenus et
//     mêmes réglages « Pilules du dépôt » qu'en 1.2.4). Convertir est ouverte
//     d'office ; les autres s'ouvrent au survol de 0,4 s (un anneau se
//     remplit) ou au clic ; Ctrl ouvre Outils, Alt ouvre Ranger.
//   - Les choix du groupe ouvert : des icônes rondes, leur nom dessous, qui
//     sortent une à une. L'île suit la hauteur (island.ts, fitDrop).
//   - Les favoris (au plus 5) : petites bulles étoilées après un séparateur,
//     épinglées par l'étoile qui apparaît sur une icône survolée (fichier
//     tenu), ou dans Réglages → Étagère → Pilules du dépôt.
//   - LÂCHER = TENIR : lâcher le fichier sur l'île ne lance rien. L'île reste
//     ouverte et cliquable, le fichier « dans la main » d'Ondine ; un clic sur
//     une icône lance. Échap, un clic hors de l'île ou « Annuler » referment
//     (island.ts). Seul lâcher qui agit : sur le petit rond Étagère, à côté de
//     l'île (drop-shelf.ts), qui revient se fondre dans l'île après l'action.
//   - Dépôt mixte : les actions communes vives, les autres grisées, la phrase
//     du bas dit pourquoi au survol (drop-menu-logic.ts).
//
// Les choix viennent de drop-menu-logic.ts (pur, testé) ; le geste après un
// format, de convert-gesture.ts (inchangé). Animations : les bulles sortent
// une à une (50 ms) en ressort ; « Réduire les animations » et mode Calme :
// un fondu ; mode Économie : rien.

import { currentLang, t } from "../core/i18n";
import type { DropTarget } from "../core/module-types";
import { perfMode } from "../core/perf";
import { calmMode } from "../mascot/mascot-state";
import { DEST_LABEL, formatBytes, nextDest, type Dest, type FormatId, type Pill } from "../modules/convert/convert-logic";
import { Dwell } from "./convert-plan";
import { SPIN_ICON, type ConvertGesture, type ConvertOffer, type ConvertStart } from "./convert-gesture";
import { el } from "./dom";
import { buildMenu, rowForKeys, ROW_KEY, typeTag, type DropMenu, type MenuItem } from "./drop-menu-logic";
import {
  formatSay,
  headerFor,
  isFav,
  isShown,
  OPTION_SAY,
  ROW_LABEL,
  ROWS,
  targetSay,
  toggleFav,
  type DropLayout,
  type DropRow,
  type Probe,
} from "./drop-pills-logic";
import { DropShelf } from "./drop-shelf";
import { lineIcon } from "./icon";
import { sounds } from "./sounds";
import { reducedMotion } from "./tab-pill";

/** Une cible de module, telle que la donne le registre. */
export interface ModuleTarget {
  target: DropTarget;
  moduleId: string;
}

export interface DropPanelHooks {
  convert: ConvertGesture;
  /** La fenêtre de l'île et sa forme (le petit rond Étagère se pose à côté). */
  host: HTMLElement;
  shell: HTMLElement;
  /** Les cibles des modules actifs (registre). */
  targets(): ModuleTarget[];
  /** La disposition des pilules (réglages de l'Étagère, migration comprise). */
  layout(): DropLayout;
  /** Enregistre la disposition (un favori épinglé ou retiré). */
  saveLayout(layout: DropLayout): void;
  /** Lâcher sur un favori déplace (réglage de l'Étagère) ? */
  favoriteMove(): boolean;
  /** Ondine regarde ce point (px CSS de la fenêtre), ou la souris (null). */
  lookAt(point: { x: number; y: number } | null): void;
  /** Demande au Rust la taille des fichiers (convert.probe) ; la réponse arrive par probed(). */
  probe(paths: string[], id: number): void;
  /** Le nombre d'éléments sur l'étagère (null : l'Étagère est coupée). */
  shelfCount(): number | null;
  /** Un choix fait d'un clic, fichier tenu. */
  chosen(choice: Choice, paths: string[]): void;
  /** Annuler (bouton Annuler, Échap, clic dehors : island.ts). */
  cancel(): void;
  /** Ce qui prend la souris a changé (le petit rond Étagère). */
  rectChanged(): void;
  /** Le petit rond Étagère s'est fondu dans l'île : le petit saut de la gelée. */
  merged(): void;
}

/** Ce que l'île doit faire : convertir, ou la cible d'un module. */
export type Choice = { type: "convert"; start: ConvertStart } | { type: "target"; target: ModuleTarget };

/** Ce que l'île doit faire d'un lâcher. */
export type DropResult = { type: "hold" } | { type: "choice"; choice: Choice } | { type: "cancel" };

/** Ce que la souris vise. */
type Hit =
  | { kind: "opt"; el: HTMLElement }
  | { kind: "mom"; el: HTMLElement; row: DropRow }
  | { kind: "item"; el: HTMLElement; item: MenuItem }
  | { kind: "star"; el: HTMLElement; item: MenuItem }
  | { kind: "cancel"; el: HTMLElement }
  | { kind: "shelf"; el: HTMLElement };

/** Le survol d'une bulle mère avant qu'elle s'ouvre (s). */
const OPEN_DWELL = 0.4;
/** Un message (« Cinq favoris au plus ») reste tant que ça à la place de la phrase (ms). */
const FLASH_MS = 1800;

/** Les icônes des bulles mères (au trait). */
const ROW_ICON: Record<DropRow, string> = { convert: "🔀", ranger: "📦", outils: "🛠" };

/** Le nom d'un fichier dans son chemin. */
function nameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Une étoile pleine (favori épinglé) ou vide (à épingler), au trait. */
function starSvg(full: boolean): string {
  const d = "M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z";
  return full
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="currentColor"/></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

export class DropPanel {
  private paths: string[] = [];
  private offer: ConvertOffer | null = null;
  private dest: Dest = "keep";
  private probes: (Probe | null)[] | null = null;
  private probeId = 0;
  private menu: DropMenu | null = null;
  private openRow: DropRow = "convert";
  private root: HTMLElement | null = null;
  private head: { title: HTMLElement; meta: HTMLElement } | null = null;
  private opt: HTMLElement | null = null;
  private dwellBar: HTMLElement | null = null;
  private bar: HTMLElement | null = null;
  private subs: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private cancelBtn: HTMLElement | null = null;
  private moms = new Map<DropRow, HTMLElement>();
  private hot: Hit | null = null;
  private optDwell = new Dwell();
  private momDwell = new Dwell(OPEN_DWELL);
  private dwellFrame = 0;
  private folder = false;
  private flash: { text: string; until: number } | null = null;
  /** Le fichier est lâché sur l'île : il est « dans la main » d'Ondine, un clic lance. */
  held = false;
  private readonly shelf: DropShelf;

  constructor(private readonly hooks: DropPanelHooks) {
    this.shelf = new DropShelf({
      host: hooks.host,
      shell: hooks.shell,
      rectChanged: () => hooks.rectChanged(),
      merged: () => hooks.merged(),
      clicked: () => {
        const c = this.shelfChoice();
        if (this.held && c) this.hooks.chosen(c, this.paths);
      },
    });
    // Fichier tenu : le rond est hors du panneau, il a son propre survol.
    this.shelf.node.addEventListener("pointermove", (e) => this.held && this.aim({ x: e.clientX, y: e.clientY }));
    this.shelf.node.addEventListener("pointerleave", () => this.held && this.hot?.kind === "shelf" && this.setHot(null));
  }

  // ── Ce que l'île appelle ───────────────────────────────────────────────────

  /** Un glisser arrive : ce qu'on sait déjà des fichiers (le reste viendra du Rust). */
  prepare(paths: string[]) {
    this.hooks.convert.dragStarted();
    this.paths = paths;
    this.offer = paths.length ? this.hooks.convert.offer(paths) : null;
    this.dest = this.hooks.convert.defaultDest();
    this.probes = null;
    this.hot = null;
    this.held = false;
    this.flash = null;
    this.optDwell = new Dwell();
    this.momDwell = new Dwell(OPEN_DWELL);
    this.menu = null;
    if (paths.length) this.hooks.probe(paths.slice(0, 100), ++this.probeId);
    this.hooks.convert.react("open");
  }

  /** La réponse du Rust : l'en-tête se complète (taille, dossier), le menu aussi (dépôt mixte). */
  probed(id: number, items: (Probe | null)[]) {
    if (id !== this.probeId) return;
    this.probes = items;
    const wasFolder = this.folder;
    this.fillHead();
    if (wasFolder !== this.folder) this.refreshOption();
    if (this.root) this.refreshMenu(false);
  }

  /** Les chemins du dépôt en cours. */
  currentPaths(): string[] {
    return this.paths;
  }

  /** Le menu en cours (pour Ondine sur le bureau, et les tests à la main). */
  currentMenu(): DropMenu {
    return this.menu ?? this.computeMenu();
  }

  /** Le contenu de l'île en mode dépôt. */
  build(): HTMLElement {
    this.hot = null;
    const root = el("div", { class: `dp${this.quiet() ? " dp-quiet" : ""}`, "data-drop-panel": "" });
    this.root = root;

    // L'en-tête : le nom, le type et la taille, la pilule d'option à droite.
    const title = el("b", { class: "dp-title", "data-no-i18n": "" });
    const meta = el("span", { class: "dp-meta", "data-no-i18n": "" });
    this.head = { title, meta };
    this.opt = el("button", { type: "button", class: "dp-pill dp-opt", "data-hit": "opt", onclick: () => this.turn() });
    root.append(el("div", { class: "dp-head" }, el("div", { class: "dp-who" }, title, meta), this.opt));
    this.fillHead();
    this.refreshOption();

    // Les bulles mères et les favoris, puis les choix du groupe ouvert.
    this.bar = el("div", { class: "dp-bar", role: "toolbar", "aria-label": "Menu de fichiers" });
    this.subs = el("div", { class: "dp-subs", role: "group" });
    this.hint = el("div", { class: "dp-hint", "data-no-i18n": "", "aria-live": "polite" });
    this.cancelBtn = el("button", { type: "button", class: "dp-cancel", "data-hit": "cancel", onclick: () => this.hooks.cancel() }, "Annuler");
    root.append(this.bar, this.subs, el("div", { class: "dp-foot" }, this.hint, this.cancelBtn));
    this.refreshMenu(true);

    // Fichier tenu : la vraie souris (la fenêtre prend les clics sur l'île).
    root.addEventListener("pointermove", (e) => this.held && this.aim({ x: e.clientX, y: e.clientY }));
    root.addEventListener("pointerleave", () => this.held && this.setHot(null));
    root.addEventListener("click", (e) => {
      if (!this.held) return;
      const hit = this.hitAt({ x: e.clientX, y: e.clientY });
      if (hit && hit.kind !== "opt" && hit.kind !== "cancel") {
        e.stopPropagation();
        this.activate(hit);
      }
    });

    // Le petit rond Étagère se détache de l'île (s'il y a une Étagère).
    const count = this.shelfChoice() ? this.hooks.shelfCount() : null;
    if (count !== null) this.shelf.show(count);
    else this.shelf.hide(false);
    return root;
  }

  /** La souris bouge pendant le glisser (px CSS de la fenêtre) ; les touches tenues. */
  over(pos: { x: number; y: number } | undefined, keys: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {}) {
    if (!this.root) return;
    this.keys(keys);
    if (pos) this.aim(pos);
  }

  /** Une touche, fichier tenu (la fenêtre a le clavier) ou pendant le glisser. */
  keys(keys: { shift?: boolean; ctrl?: boolean; alt?: boolean }) {
    if (keys.shift && this.optShown() && this.dest !== "replace") {
      this.dest = "replace";
      this.refreshOption(true);
    }
    const row = rowForKeys(!!keys.ctrl, !!keys.alt);
    if (row) this.openGroup(row);
  }

  /** Le glisser est parti (ou l'île se referme) : le petit rond revient dans l'île. */
  leave(merge = true) {
    this.setHot(null);
    this.root = null;
    this.held = false;
    cancelAnimationFrame(this.dwellFrame);
    this.dwellFrame = 0;
    this.shelf.hide(merge);
    this.hooks.convert.react("idle");
  }

  /**
   * Le fichier est lâché (px CSS de la fenêtre). Sur le petit rond Étagère :
   * posé tout de suite. Sur l'île : tenu, rien ne se lance. Ailleurs : rien.
   */
  drop(paths: string[], pos: { x: number; y: number } | undefined): DropResult {
    if (paths.length) this.paths = paths;
    if (pos && this.shelf.contains(pos)) {
      const c = this.shelfChoice();
      if (c) return { type: "choice", choice: c };
    }
    const r = this.hooks.shell.getBoundingClientRect();
    const inside = !pos || (pos.x >= r.left - 24 && pos.x <= r.right + 24 && pos.y >= r.top - 24 && pos.y <= r.bottom + 24);
    if (!this.root || !inside || !this.paths.length) return { type: "cancel" };
    this.hold();
    return { type: "hold" };
  }

  /** Le petit rond Étagère : quand on y pose un fichier, son nombre saute. */
  shelfBump(n: number) {
    this.shelf.bump(n);
  }

  /** Le rectangle du petit rond Étagère (il prend la souris lui aussi), ou null. */
  shelfRect() {
    return this.shelf.rect();
  }

  // ── Le fichier tenu ────────────────────────────────────────────────────────

  private hold() {
    this.held = true;
    this.root?.classList.add("dp-held");
    this.setHot(this.hot);
    this.setHint(this.idleSay());
    this.hooks.convert.react("open");
  }

  private activate(hit: Hit) {
    switch (hit.kind) {
      case "mom":
        if (this.menu?.dead[hit.row]) this.say(t(this.menu.dead[hit.row]!));
        else this.openGroup(hit.row);
        return;
      case "star":
        return this.toggleStar(hit.item);
      case "shelf": {
        const c = this.shelfChoice();
        if (c) this.hooks.chosen(c, this.paths);
        return;
      }
      case "item": {
        if (hit.item.off) return this.say(t(hit.item.off));
        const c = this.choiceFor(hit.item, hit.el);
        if (c) this.hooks.chosen(c, this.paths);
        return;
      }
      default:
        return;
    }
  }

  private toggleStar(item: MenuItem) {
    const r = toggleFav(this.hooks.layout(), item.id);
    if (r.full) return this.say(t("Cinq favoris au plus : retirez-en un d'abord"));
    this.hooks.saveLayout(r.layout);
    sounds.toggle(isFav(r.layout, item.id));
    this.say(t(isFav(r.layout, item.id) ? "Épinglé en favori" : "Favori retiré"));
    // Les favoris changent : le menu se redessine avec la nouvelle disposition.
    this.refreshMenu(false, r.layout);
  }

  // ── Le menu ────────────────────────────────────────────────────────────────

  private computeMenu(layout = this.hooks.layout()): DropMenu {
    return buildMenu({
      paths: this.paths,
      dirs: this.probes?.map((p) => (p ? p.dir : null)) ?? null,
      formats: this.offer?.pills.map((p) => p.id) ?? null,
      last: this.offer?.last,
      targets: this.hooks.targets().map((m) => ({ id: m.target.id, label: m.target.label, icon: m.target.icon })),
      layout,
    });
  }

  /** Recalcule le menu et redessine la rangée du haut et les choix (`first` : à l'ouverture). */
  private refreshMenu(first: boolean, layout?: DropLayout) {
    if (!this.bar || !this.subs) return;
    const menu = this.computeMenu(layout);
    this.menu = menu;
    if (first || menu.dead[this.openRow]) this.openRow = menu.open;
    const lay = layout ?? this.hooks.layout();

    // Les bulles mères.
    this.moms.clear();
    const moms = ROWS.map((row) => {
      const ball = el("span", { class: "dp-ball" }, el("span", { class: "dp-ring", "aria-hidden": "true" }));
      const ic = el("span", { class: "dp-icon", "aria-hidden": "true" });
      ic.append(lineIcon(ROW_ICON[row]));
      ball.append(ic);
      const cap = el("span", { class: "dp-cap" }, el("span", {}, ROW_LABEL[row]));
      if (ROW_KEY[row]) cap.append(el("kbd", { class: "dp-key", "data-no-i18n": "" }, ROW_KEY[row]));
      const node = el(
        "button",
        { type: "button", class: `dp-mom${row === this.openRow ? " open" : ""}${menu.dead[row] ? " off" : ""}`, "data-hit": "mom", "data-row": row, "aria-pressed": String(row === this.openRow) },
        ball,
        cap,
      );
      this.moms.set(row, node);
      return node;
    });
    const favs = menu.favs.map((item) => this.choiceNode(item, true, lay));
    this.bar.replaceChildren(...moms, ...(favs.length ? [el("span", { class: "dp-sep", "aria-hidden": "true" }), ...favs] : []));
    this.fillSubs(lay);
    if (first) this.arrive([...(this.opt && !this.opt.hidden ? [this.opt] : []), ...moms, ...favs], 0.06);
    if (this.hot) this.setHot(null);
    this.setHint(this.idleSay());
  }

  /** Les choix du groupe ouvert. */
  private fillSubs(layout = this.hooks.layout()) {
    if (!this.subs || !this.menu) return;
    const items = this.menu.groups[this.openRow];
    const nodes = items.map((item) => this.choiceNode(item, false, layout));
    this.subs.dataset.row = this.openRow;
    this.subs.setAttribute("aria-label", t(ROW_LABEL[this.openRow]));
    this.subs.replaceChildren(...nodes);
    this.arrive(nodes, 0.12);
  }

  /** Une icône ronde : la bulle (icône au trait, ou le nom court d'un format) et son nom dessous. */
  private choiceNode(item: MenuItem, fav: boolean, layout: DropLayout): HTMLElement {
    const ball = el("span", { class: "dp-ball" });
    if (item.icon) {
      const ic = el("span", { class: "dp-icon", "aria-hidden": "true" });
      ic.append(lineIcon(item.icon));
      ball.append(ic);
    } else ball.append(el("span", { class: `dp-face${item.face.length > 4 ? " long" : ""}`, "data-no-i18n": "" }, item.face));
    const pinned = isFav(layout, item.id);
    // L'étoile : épingler ou retirer (fichier tenu, au survol).
    const star = el("span", { class: `dp-star${pinned ? " on" : ""}`, "data-hit": "star", "aria-hidden": "true" });
    star.innerHTML = starSvg(pinned);
    if (fav) {
      const badge = el("span", { class: "dp-favmark", "aria-hidden": "true" });
      badge.innerHTML = starSvg(true);
      ball.append(badge);
    }
    // Le nom d'un favori ou d'un collègue est le leur : pas de traduction.
    const own = item.type === "target" && /^(shelf-fav-|team-)/.test(item.id);
    const cap = el("span", { class: "dp-cap", ...(own ? { "data-no-i18n": "" } : {}) }, item.caption);
    return el(
      "button",
      {
        type: "button",
        class: `dp-choice${fav ? " dp-fav" : ""}${item.off ? " off" : ""}${pinned ? " pinned" : ""}`,
        "data-hit": "item",
        "data-id": item.id,
        "aria-label": item.label,
        "aria-disabled": String(!!item.off),
      },
      ball,
      fav ? null : star,
      cap,
    );
  }

  /** Ouvre un groupe (survol de 0,4 s, clic, Ctrl ou Alt). */
  private openGroup(row: DropRow) {
    if (!this.menu || row === this.openRow) return;
    if (this.menu.dead[row]) return;
    this.openRow = row;
    for (const [r, node] of this.moms) {
      node.classList.toggle("open", r === row);
      node.setAttribute("aria-pressed", String(r === row));
      node.style.removeProperty("--p");
    }
    this.momDwell = new Dwell(OPEN_DWELL);
    this.fillSubs();
    sounds.tap();
    this.hooks.convert.react("hover");
    if (this.hot?.kind === "item" || this.hot?.kind === "star") this.setHot(null);
    // La bulle mère survolée vient de s'ouvrir : la phrase ne dit plus « Restez un instant ».
    else if (this.root && !this.flash) this.setHint(this.sayFor(this.hot));
  }

  // ── Les choix ──────────────────────────────────────────────────────────────

  private many(): boolean {
    return this.paths.length > 1;
  }

  /** Ce que fera ce choix (la phrase du bas). */
  private itemSay(item: MenuItem): string {
    if (item.off) return t(item.off);
    if (item.type === "format") return t(formatSay(item.id as FormatId, this.effectiveDest(), this.many()));
    // Traduit par un motif (« Copier dans (.+) ») : le nom reste tel quel.
    return t(targetSay(item.id, item.label, this.many(), this.hooks.favoriteMove()));
  }

  /** Toutes les phrases (pour Ondine sur le bureau : elle n'a pas les cibles). */
  says(): Record<string, string> {
    const menu = this.currentMenu();
    const out: Record<string, string> = {};
    for (const item of [...ROWS.flatMap((r) => menu.groups[r]), ...menu.favs]) out[item.id] = this.itemSay(item);
    return out;
  }

  /** Le choix d'un élément du menu (par son identifiant), pour l'île ou Ondine sur le bureau. */
  choiceFor(item: MenuItem, node?: HTMLElement, dest?: Dest): Choice | null {
    if (item.off) return null;
    if (item.type === "format") {
      const pill: Pill = { id: item.id as FormatId, label: item.label };
      if (!this.offer) return null;
      const from = this.slotOf(node);
      return { type: "convert", start: { paths: this.paths, pill, kind: this.offer.kind, dest: dest ?? this.effectiveDest(), from: { x: from.x, y: from.y }, slot: from } };
    }
    const mt = this.hooks.targets().find((m) => m.target.id === item.id);
    return mt ? { type: "target", target: mt } : null;
  }

  /** Un choix par son identifiant (Ondine sur le bureau répond avec lui). */
  choiceById(id: string, dest?: Dest): Choice | null {
    const menu = this.currentMenu();
    const item = [...ROWS.flatMap((r) => menu.groups[r]), ...menu.favs].find((i) => i.id === id);
    if (dest && this.optShown()) this.dest = dest;
    if (!item) return id === "shelf-add" ? this.shelfChoice() : null;
    return this.choiceFor(item, undefined, dest && this.optShown() ? dest : undefined);
  }

  /** L'Étagère est là (le petit rond de l'île, la bulle du cercle) ? */
  hasShelf(): boolean {
    return !!this.shelfChoice();
  }

  /** « Poser sur l'étagère » (le petit rond), si l'Étagère et sa cible sont là. */
  private shelfChoice(): Choice | null {
    if (!isShown(this.hooks.layout(), "shelf-add")) return null;
    const mt = this.hooks.targets().find((m) => m.target.id === "shelf-add");
    return mt ? { type: "target", target: mt } : null;
  }

  /** Le centre et la largeur d'une icône (la progression part de là). */
  private slotOf(node: HTMLElement | undefined): { x: number; y: number; w: number } {
    const r = (node?.querySelector(".dp-ball") ?? node)?.getBoundingClientRect();
    if (!r || !r.width) {
      const s = this.hooks.shell.getBoundingClientRect();
      return { x: s.left + s.width / 2, y: s.top + Math.min(80, s.height / 2), w: 80 };
    }
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.max(r.width, 64) };
  }

  // ── L'en-tête et la pilule d'option ────────────────────────────────────────

  /** Le titre, la ligne du type et l'étiquette du type (pour le cercle d'Ondine). */
  header(): { title: string; meta: string; tag: string } {
    const names = this.paths.map(nameOf);
    const h = headerFor(names, this.offer?.kind ?? "other", this.probes, (n) => formatBytes(n, currentLang() !== "fr"));
    const menu = this.currentMenu();
    return { title: names.length === 1 ? h.title : t(h.title), meta: t(h.meta), tag: t(typeTag(this.paths, menu.kinds)) };
  }

  private fillHead() {
    const names = this.paths.map(nameOf);
    const h = headerFor(names, this.offer?.kind ?? "other", this.probes, (n) => formatBytes(n, currentLang() !== "fr"));
    this.folder = h.folder;
    if (!this.head) return;
    this.head.title.textContent = names.length === 1 ? h.title : t(h.title);
    this.head.meta.textContent = t(h.meta);
  }

  /** La pilule d'option a un sens : des formats, et pas un dossier (le ZIP d'un dossier se pose à côté). */
  optShown(): boolean {
    return !!this.offer && this.offer.pills.length > 0 && !this.folder;
  }

  /** Où va le résultat : un dossier va toujours à côté. */
  effectiveDest(): Dest {
    return this.optShown() ? this.dest : "keep";
  }

  private refreshOption(turned = false) {
    const opt = this.opt;
    if (!opt) return;
    opt.hidden = !this.optShown();
    const spin = el("span", { class: "dp-icon dp-spin", "aria-hidden": "true" });
    spin.innerHTML = SPIN_ICON;
    this.dwellBar = el("span", { class: "dp-dwell" });
    opt.replaceChildren(spin, el("span", { class: "dp-name" }, DEST_LABEL[this.dest]), this.dwellBar);
    if (turned) {
      opt.classList.remove("turned");
      void opt.offsetWidth;
      opt.classList.add("turned");
      sounds.toggle(true);
    }
    // La phrase du bas suit le nouveau choix.
    if (this.hot?.kind === "item") this.setHint(this.itemSay(this.hot.item));
  }

  /** Un tour de la pilule d'option (survol d'une demi-seconde, ou clic). */
  private turn() {
    if (!this.optShown()) return;
    this.dest = nextDest(this.dest);
    this.refreshOption(true);
  }

  /** Les survols qui attendent (pilule d'option : 0,5 s ; bulle mère : 0,4 s, avec son anneau). */
  private kickDwell() {
    if (this.dwellFrame) return;
    const step = (now: number) => {
      this.dwellFrame = 0;
      const hot = this.hot;
      const onOpt = hot?.kind === "opt";
      if (this.optDwell.update(onOpt, now)) this.turn();
      if (this.dwellBar) this.dwellBar.style.transform = `scaleX(${this.optDwell.progress(now).toFixed(3)})`;
      const mom = hot?.kind === "mom" && hot.row !== this.openRow && !this.menu?.dead[hot.row] ? hot : null;
      if (this.momDwell.update(!!mom, now) && mom) this.openGroup(mom.row);
      if (mom) mom.el.style.setProperty("--p", this.momDwell.progress(now).toFixed(3));
      if (onOpt || mom) this.dwellFrame = requestAnimationFrame(step);
    };
    this.dwellFrame = requestAnimationFrame(step);
  }

  // ── Le survol ──────────────────────────────────────────────────────────────

  private aim(pos: { x: number; y: number }) {
    const hit = this.hitAt(pos);
    if (!sameHit(hit, this.hot)) {
      this.setHot(hit);
      if (hit?.kind === "opt" || hit?.kind === "mom") this.kickDwell();
    }
  }

  private hitAt(pos: { x: number; y: number }): Hit | null {
    if (this.shelf.contains(pos) && this.shelfChoice()) return { kind: "shelf", el: this.shelf.node };
    const node = document.elementFromPoint(pos.x, pos.y)?.closest<HTMLElement>("[data-hit]");
    if (!node || !this.root?.contains(node)) return null;
    switch (node.dataset.hit) {
      case "opt":
        return this.optShown() ? { kind: "opt", el: node } : null;
      case "cancel":
        return this.held ? { kind: "cancel", el: node } : null;
      case "mom":
        return { kind: "mom", el: node, row: node.dataset.row as DropRow };
      case "star": {
        // L'étoile ne se vise que fichier tenu (pendant le glisser, on vise l'icône).
        const host = node.closest<HTMLElement>("[data-hit='item']");
        const item = host && this.itemOf(host);
        if (!host || !item) return null;
        return this.held ? { kind: "star", el: host, item } : { kind: "item", el: host, item };
      }
      case "item": {
        const item = this.itemOf(node);
        return item ? { kind: "item", el: node, item } : null;
      }
      default:
        return null;
    }
  }

  private itemOf(node: HTMLElement): MenuItem | null {
    const id = node.dataset.id;
    const menu = this.menu;
    if (!id || !menu) return null;
    return [...menu.groups[this.openRow], ...menu.favs].find((i) => i.id === id) ?? null;
  }

  private setHot(hit: Hit | null) {
    const prev = this.hot;
    this.hot = hit;
    prev?.el.classList.remove("hot", "star-hot");
    if (prev?.kind === "shelf") this.shelf.setHot(false);
    if (prev?.kind === "mom") prev.el.style.removeProperty("--p");
    if (hit) {
      hit.el.classList.add("hot");
      if (hit.kind === "star") hit.el.classList.add("star-hot");
      if (hit.kind === "shelf") this.shelf.setHot(true);
    }
    this.root?.classList.toggle("dp-aiming", !!hit && hit.kind !== "cancel");
    if (hit?.kind !== "opt") this.optDwell.update(false, performance.now());
    if (hit?.kind !== "mom") this.momDwell.update(false, performance.now());
    if (this.dwellBar && hit?.kind !== "opt") this.dwellBar.style.transform = "scaleX(0)";
    if (!this.root) return;
    this.setHint(this.sayFor(hit));
    if (hit && hit.kind !== "cancel") {
      const r = (hit.el.querySelector(".dp-ball") ?? hit.el).getBoundingClientRect();
      this.hooks.lookAt({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      this.hooks.convert.react("hover");
      if (!sameNode(prev, hit)) sounds.tap();
    } else if (prev) {
      this.hooks.lookAt(null);
      this.hooks.convert.react("open");
    }
  }

  private sayFor(hit: Hit | null): string {
    if (!hit) return this.idleSay();
    switch (hit.kind) {
      case "opt":
        return t(OPTION_SAY);
      case "mom":
        return this.menu?.dead[hit.row] ? t(this.menu.dead[hit.row]!) : hit.row === this.openRow ? this.idleSay() : t("Restez un instant pour ouvrir, ou cliquez");
      case "star":
        return t(isFav(this.hooks.layout(), hit.item.id) ? "Cliquez pour retirer des favoris" : "Cliquez pour épingler en favori");
      case "shelf":
        return t(this.held ? "Cliquez pour poser sur l'étagère" : "Lâchez pour poser sur l'étagère");
      case "cancel":
        return t("Refermer sans rien faire");
      case "item":
        return this.itemSay(hit.item);
    }
  }

  /** La phrase sans rien de visé. */
  private idleSay(): string {
    if (!this.menu || !ROWS.some((r) => this.menu!.groups[r].length)) return t("Aucune cible de dépôt active.");
    return t(this.held ? "Survolez une icône, puis cliquez · Échap annule" : "Lâchez : rien ne se lance avant votre clic");
  }

  /** Un message un instant à la place de la phrase (« Cinq favoris au plus »). */
  private say(text: string) {
    this.flash = { text, until: performance.now() + FLASH_MS };
    this.setHint(text, true);
    window.setTimeout(() => {
      if (this.flash && performance.now() >= this.flash.until) {
        this.flash = null;
        this.setHint(this.sayFor(this.hot));
      }
    }, FLASH_MS + 20);
  }

  private setHint(text: string, force = false) {
    if (!force && this.flash && performance.now() < this.flash.until) return;
    if (this.hint && this.hint.textContent !== text) this.hint.textContent = text;
  }

  // ── L'arrivée ──────────────────────────────────────────────────────────────

  /** Sans ressort ni grossissement : « Réduire les animations », mode Calme, mode Économie. */
  private quiet(): boolean {
    return reducedMotion() || calmMode() || perfMode() === "eco";
  }

  /** Les bulles sortent une à une (50 ms), en ressort ; un fondu en mode calme ; rien en Économie. */
  private arrive(nodes: HTMLElement[], base: number) {
    if (perfMode() === "eco" || typeof Element.prototype.animate !== "function") return;
    const calm = this.quiet();
    nodes.forEach((p, i) => {
      p.animate(
        calm
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: "translateY(-6px) scale(0.3)" },
              { opacity: 1, offset: 0.4 },
              { opacity: 1, transform: "none" },
            ],
        // Le ressort de la maquette (cubic-bezier(.34,1.56,.64,1), 0,44 s).
        { duration: calm ? 180 : 440, delay: (calm ? 0 : base + Math.min(i, 14) * 0.05) * 1000, easing: calm ? "ease-out" : "cubic-bezier(.34,1.56,.64,1)", fill: "backwards" },
      );
    });
  }
}

function sameHit(a: Hit | null, b: Hit | null): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.el === b.el;
}

function sameNode(a: Hit | null, b: Hit | null): boolean {
  return !!a && !!b && a.el === b.el;
}
