// Le dépôt unifié (1.2.5) : ce que montre l'île pendant qu'on y glisse un
// fichier. Maquette validée : animations-ile/maquette-depot-unifie.html,
// version A (« tout dans l'île, modulable au besoin »).
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │ (Ondine) vacances.heic                    ↻ Conserver à côté │
//   │          Image · 3,4 Mo                                      │
//   │ CONVERTIR  JPG  PNG  WebP  PDF  Alléger  …  ZIP  Redimens.…  │
//   │ RANGER     Étagère  Copier vers…  Déplacer vers…  Corbeille  │
//   │ OUTILS     Parler à Ondine  Renommer…  Copier le chemin  …   │
//   │            Convertir en JPG, à côté de l'original            │
//   └──────────────────────────────────────────────────────────────┘
//
// Toutes les pilules ont le même style (icône au trait, nom entier, jamais
// coupé ; survol : couleur d'Ondine et léger grossissement) ; Ondine regarde
// celle qui est visée, et la phrase du bas dit ce qui va se passer. Une ligne
// vide est masquée. La pilule d'option (Conserver / Remplacer / Sur le
// bureau) tourne après 0,5 s de survol, avec Maj (Remplacer) ou d'un clic ;
// pas de pilule d'option pour un dossier ni quand aucun format n'est possible.
//
// Les cibles viennent des modules (views.drop) ; leur ordre, et celles qui
// sont masquées, des réglages (drop-pills-logic.ts, Réglages → Étagère →
// Pilules du dépôt). Les formats viennent d'Ondine convertit
// (convert-gesture.ts) ; un lâcher sur un format lance son geste.
//
// L'île prend la hauteur de ce contenu (island.ts, fitDrop) : sur un côté de
// l'écran, elle prend la largeur qu'il faut vers le centre ; en bas, elle
// grandit vers le haut (island.css).
//
// Animations : les pilules arrivent une à une (ressort) ; « Réduire les
// animations », le mode Calme et le mode Économie : pas de ressort ni de
// grossissement, un simple fondu (ou rien en Économie).

import { currentLang, t } from "../core/i18n";
import type { DropTarget } from "../core/module-types";
import { perfMode } from "../core/perf";
import { calmMode } from "../mascot/mascot-state";
import { DEST_LABEL, formatBytes, nextDest, type Dest, type Pill } from "../modules/convert/convert-logic";
import { pillDelay, Dwell } from "./convert-plan";
import { SPIN_ICON, type ConvertGesture, type ConvertOffer, type ConvertStart } from "./convert-gesture";
import { el } from "./dom";
import {
  arrange,
  arrangeFormats,
  bareLabel,
  formatSay,
  headerFor,
  IDLE_SAY,
  isShown,
  KNOWN,
  keyOf,
  OPTION_SAY,
  OTHER_ICON,
  ROW_LABEL,
  rowOf,
  targetSay,
  type DropLayout,
  type DropRow,
  type Probe,
} from "./drop-pills-logic";
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
  /** Les cibles des modules actifs (registre). */
  targets(): ModuleTarget[];
  /** La disposition des pilules (réglages de l'Étagère, migration comprise). */
  layout(): DropLayout;
  /** Lâcher sur un favori déplace (réglage de l'Étagère) ? */
  favoriteMove(): boolean;
  /** Ondine regarde ce point (px CSS de la fenêtre), ou la souris (null). */
  lookAt(point: { x: number; y: number } | null): void;
  /** Demande au Rust la taille des fichiers (convert.probe) ; la réponse arrive par probed(). */
  probe(paths: string[], id: number): void;
}

/** Ce que l'île doit faire d'un lâcher. */
export type DropChoice = { type: "convert"; start: ConvertStart } | { type: "target"; target: ModuleTarget } | null;

interface Item {
  el: HTMLElement;
  say: () => string;
  choose: (paths: string[], from: { x: number; y: number }) => DropChoice;
}

/** Le nom d'un fichier dans son chemin. */
function nameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export class DropPanel {
  private paths: string[] = [];
  private offer: ConvertOffer | null = null;
  private dest: Dest = "keep";
  private probes: (Probe | null)[] | null = null;
  private probeId = 0;
  private items: Item[] = [];
  private root: HTMLElement | null = null;
  private head: { title: HTMLElement; meta: HTMLElement } | null = null;
  private opt: HTMLElement | null = null;
  private optLabel: HTMLElement | null = null;
  private dwellBar: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private hot: Item | "opt" | null = null;
  private dwell = new Dwell();
  private dwellFrame = 0;
  private folder = false;

  constructor(private readonly hooks: DropPanelHooks) {}

  // ── Ce que l'île appelle ───────────────────────────────────────────────────

  /** Un glisser arrive : ce qu'on sait déjà des fichiers (le reste viendra du Rust). */
  prepare(paths: string[]) {
    this.hooks.convert.dragStarted();
    this.paths = paths;
    this.offer = paths.length ? this.hooks.convert.offer(paths) : null;
    this.dest = this.hooks.convert.defaultDest();
    this.probes = null;
    this.hot = null;
    this.dwell = new Dwell();
    if (paths.length) this.hooks.probe(paths.slice(0, 100), ++this.probeId);
    this.hooks.convert.react("open");
  }

  /** La réponse du Rust : l'en-tête se complète (taille, dossier). */
  probed(id: number, items: (Probe | null)[]) {
    if (id !== this.probeId) return;
    this.probes = items;
    const wasFolder = this.folder;
    this.fillHead();
    // Un dossier (deviné à tort, ou l'inverse) : la pilule d'option apparaît ou part.
    if (wasFolder !== this.folder) this.refreshOption();
  }

  /** Le contenu de l'île en mode dépôt. */
  build(): HTMLElement {
    this.items = [];
    this.hot = null;
    const root = el("div", { class: `dp${this.quiet() ? " dp-quiet" : ""}`, "data-drop-panel": "" });
    this.root = root;

    // L'en-tête : le nom, le type et la taille, la pilule d'option à droite.
    const title = el("b", { class: "dp-title", "data-no-i18n": "" });
    const meta = el("span", { class: "dp-meta", "data-no-i18n": "" });
    this.head = { title, meta };
    const head = el("div", { class: "dp-head" }, el("div", { class: "dp-who" }, title, meta));
    this.opt = el("div", { class: "dp-pill dp-opt", role: "button", onclick: () => this.turn() });
    head.append(this.opt);
    root.append(head);
    this.fillHead();
    this.refreshOption();

    // Les trois lignes.
    const layout = this.hooks.layout();
    const targets = this.hooks.targets();
    const byRow: Record<DropRow, ModuleTarget[]> = { convert: [], ranger: [], outils: [] };
    for (const t of targets) byRow[rowOf(keyOf(t.target.id))].push(t);
    const rows: [DropRow, Item[]][] = [
      ["convert", this.convertItems(layout, byRow.convert)],
      ["ranger", arrange(layout, "ranger", byRow.ranger, (t) => keyOf(t.target.id)).map((t) => this.targetItem(t))],
      ["outils", arrange(layout, "outils", byRow.outils, (t) => keyOf(t.target.id)).map((t) => this.targetItem(t))],
    ];
    let shown = 0;
    for (const [row, items] of rows) {
      if (!items.length) continue;
      root.append(el("div", { class: "dp-row", "data-row": row }, el("span", { class: "dp-lbl" }, ROW_LABEL[row]), el("div", { class: "dp-pills" }, ...items.map((i) => i.el))));
      this.items.push(...items);
      shown += items.length;
    }
    this.hint = el("div", { class: "dp-hint", "data-no-i18n": "", "aria-live": "polite" });
    this.setHint(shown ? t(IDLE_SAY) : t("Aucune cible de dépôt active."));
    root.append(this.hint);
    this.arrive();
    return root;
  }

  /** La souris bouge pendant le glisser (px CSS de la fenêtre ; Maj enfoncée ?). */
  over(pos: { x: number; y: number } | undefined, shift: boolean) {
    if (!this.root) return;
    if (shift && this.optShown() && this.dest !== "replace") {
      this.dest = "replace";
      this.refreshOption(true);
    }
    const hit = pos ? this.hitAt(pos) : null;
    if (hit !== this.hot) {
      this.setHot(hit);
      if (hit === "opt") this.kickDwell();
    }
  }

  /** Le glisser est parti (ou le fichier est lâché ailleurs). */
  leave() {
    this.setHot(null);
    this.root = null;
    cancelAnimationFrame(this.dwellFrame);
    this.dwellFrame = 0;
    this.hooks.convert.react("idle");
  }

  /** Le fichier est lâché : ce qu'il faut faire (null : rien, l'île se referme). */
  drop(paths: string[], pos: { x: number; y: number } | undefined): DropChoice {
    const hit = this.root && pos ? this.hitAt(pos) : null;
    const list = paths.length ? paths : this.paths;
    const choice = hit && hit !== "opt" && pos ? hit.choose(list, pos) : null;
    this.leave();
    return choice;
  }

  // ── Les pilules ────────────────────────────────────────────────────────────

  /** La ligne Convertir : les formats de ce fichier, puis les outils de conversion des modules. */
  private convertItems(layout: DropLayout, targets: ModuleTarget[]): Item[] {
    const out: Item[] = [];
    const offer = this.offer;
    const pills = new Map<string, Pill>((offer?.pills ?? []).map((p) => [p.id, p]));
    const ids = arrangeFormats(layout, (offer?.pills ?? []).map((p) => p.id), offer?.last);
    for (const id of ids) out.push(this.formatItem(pills.get(id)!));
    for (const t of targets) {
      const key = keyOf(t.target.id);
      if (!isShown(layout, key)) continue;
      // « Compresser » de l'Étagère : seulement si Ondine convertit ne propose pas déjà le ZIP.
      if (key === "zip" && pills.has("zip")) continue;
      // « Redimensionner… » : pour des images seulement.
      if (key === "shelf-images" && offer?.kind !== "image") continue;
      out.push(this.targetItem(t, key === "zip" ? "ZIP" : undefined));
    }
    return out;
  }

  private pill(label: string, iconName: string, format: boolean): HTMLElement {
    const node = el("div", { class: `dp-pill${format ? " dp-fmt" : ""}` });
    if (iconName) {
      const ic = el("span", { class: "dp-icon", "aria-hidden": "true" });
      ic.append(lineIcon(iconName));
      node.append(ic);
    }
    node.append(el("span", { class: "dp-name" }, label));
    return node;
  }

  private formatItem(p: Pill): Item {
    const icon = KNOWN[p.id]?.icon ?? "";
    const many = this.paths.length > 1;
    const node = this.pill(p.label, icon, true);
    return {
      el: node,
      say: () => t(formatSay(p.id, this.effectiveDest(), many)),
      choose: (paths, from) => ({ type: "convert", start: { paths, pill: p, kind: this.offer!.kind, dest: this.effectiveDest(), from, slot: this.slotOf(node) } }),
    };
  }

  private targetItem(mt: ModuleTarget, label?: string): Item {
    const key = keyOf(mt.target.id);
    const name = label ?? bareLabel(mt.target.label);
    const icon = KNOWN[key]?.icon ?? (mt.target.icon && !mt.target.icon.includes(":") ? mt.target.icon : OTHER_ICON);
    const many = this.paths.length > 1;
    // Le nom d'un favori ou d'un collègue est le leur : pas de traduction.
    const own = key === "shelf-fav" || key === "team";
    const node = this.pill(name, icon, false);
    if (own) node.querySelector(".dp-name")?.setAttribute("data-no-i18n", "");
    return {
      el: node,
      // Traduit par un motif (« Copier dans (.+) ») : le nom reste tel quel.
      say: () => t(targetSay(mt.target.id, name, many, this.hooks.favoriteMove())),
      choose: () => ({ type: "target", target: mt }),
    };
  }

  /** Le centre et la largeur d'une pilule (la progression part de là). */
  private slotOf(node: HTMLElement | undefined): { x: number; y: number; w: number } {
    const r = node?.getBoundingClientRect();
    if (!r || !r.width) return { x: window.innerWidth / 2, y: 80, w: 80 };
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
  }

  // ── L'en-tête et la pilule d'option ────────────────────────────────────────

  private fillHead() {
    const names = this.paths.map(nameOf);
    const h = headerFor(names, this.offer?.kind ?? "other", this.probes, (n) => formatBytes(n, currentLang() !== "fr"));
    this.folder = h.folder;
    if (!this.head) return;
    this.head.title.textContent = names.length === 1 ? h.title : t(h.title);
    this.head.meta.textContent = t(h.meta);
  }

  /** La pilule d'option a un sens : des formats, et pas un dossier (le ZIP d'un dossier se pose à côté). */
  private optShown(): boolean {
    return !!this.offer && this.offer.pills.length > 0 && !this.folder;
  }

  /** Où va le résultat : un dossier va toujours à côté. */
  private effectiveDest(): Dest {
    return this.optShown() ? this.dest : "keep";
  }

  private refreshOption(turned = false) {
    const opt = this.opt;
    if (!opt) return;
    opt.hidden = !this.optShown();
    const spin = el("span", { class: "dp-icon dp-spin", "aria-hidden": "true" });
    spin.innerHTML = SPIN_ICON;
    this.optLabel = el("span", { class: "dp-name" }, DEST_LABEL[this.dest]);
    this.dwellBar = el("span", { class: "dp-dwell" });
    opt.replaceChildren(spin, this.optLabel, this.dwellBar);
    if (turned) {
      opt.classList.remove("turned");
      void opt.offsetWidth;
      opt.classList.add("turned");
      sounds.toggle(true);
    }
    // La phrase du bas suit le nouveau choix.
    if (this.hot && this.hot !== "opt") this.setHint(this.hot.say());
  }

  /** Un tour de la pilule d'option (survol d'une demi-seconde, ou clic). */
  private turn() {
    if (!this.optShown()) return;
    this.dest = nextDest(this.dest);
    this.refreshOption(true);
  }

  /** Le survol de la pilule d'option : le petit trait se remplit, puis elle tourne. */
  private kickDwell() {
    if (this.dwellFrame) return;
    const step = (now: number) => {
      this.dwellFrame = 0;
      const on = this.hot === "opt";
      if (this.dwell.update(on, now)) this.turn();
      if (this.dwellBar) this.dwellBar.style.transform = `scaleX(${this.dwell.progress(now).toFixed(3)})`;
      if (on) this.dwellFrame = requestAnimationFrame(step);
    };
    this.dwellFrame = requestAnimationFrame(step);
  }

  // ── Le survol ──────────────────────────────────────────────────────────────

  private hitAt(pos: { x: number; y: number }): Item | "opt" | null {
    const hit = document.elementFromPoint(pos.x, pos.y)?.closest<HTMLElement>(".dp-pill");
    if (!hit || !this.root?.contains(hit)) return null;
    if (hit === this.opt) return this.optShown() ? "opt" : null;
    return this.items.find((i) => i.el === hit) ?? null;
  }

  private setHot(hit: Item | "opt" | null) {
    const prev = this.hot;
    this.hot = hit;
    const node = (h: Item | "opt" | null) => (h === "opt" ? this.opt : h ? h.el : null);
    node(prev)?.classList.remove("hot");
    const now = node(hit);
    now?.classList.add("hot");
    this.root?.classList.toggle("dp-aiming", !!hit);
    if (hit !== "opt") this.dwell.update(false, performance.now());
    if (this.dwellBar && hit !== "opt") this.dwellBar.style.transform = "scaleX(0)";
    if (!this.root) return;
    this.setHint(hit === "opt" ? t(OPTION_SAY) : hit ? hit.say() : t(IDLE_SAY));
    if (now) {
      const r = now.getBoundingClientRect();
      this.hooks.lookAt({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      this.hooks.convert.react("hover");
      sounds.tap();
    } else if (prev) {
      this.hooks.lookAt(null);
      this.hooks.convert.react("open");
    }
  }

  private setHint(text: string) {
    if (this.hint && this.hint.textContent !== text) this.hint.textContent = text;
  }

  // ── L'arrivée ──────────────────────────────────────────────────────────────

  /** Sans ressort ni grossissement : « Réduire les animations », mode Calme, mode Économie. */
  private quiet(): boolean {
    return reducedMotion() || calmMode() || perfMode() === "eco";
  }

  /** Les pilules arrivent une à une, en ressort (un simple fondu en mode calme, rien en Économie). */
  private arrive() {
    if (perfMode() === "eco" || typeof Element.prototype.animate !== "function") return;
    const calm = this.quiet();
    const pills = [this.opt, ...this.items.map((i) => i.el)].filter((p): p is HTMLElement => !!p && !p.hidden);
    pills.forEach((p, i) => {
      p.animate(
        calm
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: "scale(0.55)" },
              { opacity: 1, offset: 0.45 },
              { opacity: 1, transform: "scale(1)" },
            ],
        // Le dépassement du ressort : la même courbe que les pilules de la maquette.
        { duration: calm ? 180 : 420, delay: 60 + pillDelay(i) * 1000, easing: calm ? "ease-out" : "cubic-bezier(.34,1.56,.5,1)", fill: "backwards" },
      );
    });
  }
}
