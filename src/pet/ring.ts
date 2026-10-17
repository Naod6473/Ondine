// Le menu en cercle d'Ondine sur le bureau (1.2.5) : un fichier lâché sur
// elle ouvre, autour d'elle, le menu de la maquette
// (animations-ile/maquette-menu-cercle.html ; spec menu-fichiers, partie B).
//
//   - au centre, la goutte (Ondine elle-même) et l'étiquette du type (PNG,
//     MOV, Dossier, « 3 éléments ») ; dessous, la pilule d'option Conserver
//     à côté / Remplacer l'original / Sur le bureau (clic, ou survol 0,5 s) ;
//   - Convertir en haut, Outils à gauche, Ranger à droite (sens fixe), qui
//     sortent une à une (50 ms) ; un survol de 0,4 s (l'anneau se remplit) ou
//     un clic ouvre les choix dans l'arc de la bulle mère, une deuxième
//     rangée au-delà de six (ring-layout.ts) ;
//   - les favoris en bas, la bulle Étagère sous eux, toujours là ;
//   - l'étoile d'un choix survolé l'épingle ou le retire (l'île l'enregistre) ;
//   - un clic lance ; Échap, un clic dans le vide (la fenêtre perd le
//     clavier) annulent ; tout se replie dans la goutte après l'action.
// Près d'un bord de l'écran, pet.rs décale le carré du menu (le sens reste) :
// Ondine glisse jusqu'au centre du menu, puis revient à sa place.
//
// L'île calcule le menu (elle a les cibles des modules et les formats
// d'Ondine convertit : drop-menu-logic.ts) et l'envoie ici
// (« island.drop-menu ») ; le choix repart vers elle (« pet.drop-choice »),
// qui le fait comme un clic dans l'île (progression et résultat dans la
// mini-île). Animations : ressorts ; « Réduire les animations » et Calme :
// fondus ; Économie : rien.

import type { Bus } from "../core/bus";
import { perfMode } from "../core/perf";
import { calmMode } from "../mascot/mascot-state";
import { DEST_LABEL, nextDest, type Dest } from "../modules/convert/convert-logic";
import { Dwell } from "../island/convert-plan";
import { SPIN_ICON } from "../island/convert-gesture";
import { el } from "../island/dom";
import { ROW_KEY, type DropMenuMessage, type MenuItem } from "../island/drop-menu-logic";
import { OPTION_SAY, ROW_LABEL, type DropRow } from "../island/drop-pills-logic";
import { lineIcon } from "../island/icon";
import { sounds } from "../island/sounds";
import { reducedMotion } from "../island/tab-pill";
import { favSpots, motherSpot, MOTHER_ORDER, RING, shelfSpot, subSpots, SUBS_MAX, type Spot } from "./ring-layout";

/** Survol d'une bulle mère avant qu'elle s'ouvre (s). */
const OPEN_DWELL = 0.4;
const ROW_ICON: Record<DropRow, string> = { convert: "🔀", ranger: "📦", outils: "🛠" };

export interface RingHooks {
  /** Le cadre d'Ondine (la page) : le cercle s'y pose. */
  box: HTMLElement;
  bus: Bus;
  /** Ouvre (true) ou ferme le carré du cercle (pet.rs) ; renvoie la case de la mascotte dedans. */
  frame(open: boolean): Promise<{ ox: number; oy: number }>;
  /** Les cases du cercle ont changé (clics traversants ailleurs). */
  hitChanged(): void;
  /** Ondine : une expression, regarder un point. */
  play(anim: "surprise" | "focus" | "eating" | "idle"): void;
  lookAt(x: number, y: number): void;
}

interface Bub {
  el: HTMLElement;
  spot: Spot;
  d: number;
  /** D'où elle sort (sa bulle mère, ou le centre), depuis sa place. */
  from: Spot;
}

type Hit =
  | { kind: "mom"; row: DropRow; b: Bub }
  | { kind: "item"; item: MenuItem; b: Bub }
  | { kind: "star"; item: MenuItem; b: Bub }
  | { kind: "shelf"; b: Bub }
  | { kind: "opt"; b: Bub }
  | { kind: "core"; b: Bub };

function starSvg(full: boolean): string {
  const d = "M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z";
  return full
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="currentColor"/></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

export class PetRing {
  private msg: DropMenuMessage | null = null;
  private readonly layer = el("div", { class: "pet-ring", role: "menu", "aria-label": "Menu de fichiers" });
  private center: Spot = { x: RING.size / 2, y: RING.size / 2 };
  private core: Bub | null = null;
  private moms = new Map<DropRow, Bub>();
  private subs: { item: MenuItem; b: Bub; star: HTMLElement }[] = [];
  private favs: { item: MenuItem; b: Bub }[] = [];
  private shelf: Bub | null = null;
  private opt: Bub | null = null;
  private optLabel: HTMLElement | null = null;
  /** La phrase sous le cercle (traduite par la page ; celles de l'île le sont déjà). */
  private sayEl = el("div", { class: "pr-say", "aria-live": "polite" });
  private openRow: DropRow | null = null;
  private hot: Hit | null = null;
  private dwell = new Dwell(OPEN_DWELL);
  private optDwell = new Dwell();
  private frameId = 0;
  private dest: Dest = "keep";
  private openedAt = 0;
  private closing = false;
  private flashUntil = 0;

  constructor(private readonly hooks: RingHooks) {
    this.layer.addEventListener("pointermove", (e) => this.aim(e.clientX, e.clientY));
    this.layer.addEventListener("pointerleave", () => this.setHot(null));
    this.layer.addEventListener("click", (e) => {
      e.stopPropagation();
      const hit = this.hitAt(e.clientX, e.clientY);
      if (hit) this.activate(hit);
      else this.cancel();
    });
    window.addEventListener("keydown", (e) => {
      if (!this.msg || this.closing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.cancel();
      } else if (!e.repeat && (e.key === "Control" || e.key === "Alt")) {
        e.preventDefault();
        this.openGroup(e.key === "Control" ? "outils" : "ranger");
      } else if (!e.repeat && e.key === "Shift" && this.msg.option && this.dest !== "replace") {
        this.dest = "replace";
        this.fillOption(true);
      }
    }, true);
    // Un clic ailleurs sur l'écran : la fenêtre perd le clavier, on annule.
    window.addEventListener("blur", () => this.msg && !this.closing && performance.now() - this.openedAt > 400 && this.cancel());
  }

  get open(): boolean {
    return !!this.msg;
  }

  /** Les cases qui prennent la souris (px de la fenêtre). */
  hitRects(): { x: number; y: number; w: number; h: number }[] {
    if (!this.msg) return [];
    const out: { x: number; y: number; w: number; h: number }[] = [];
    const add = (b: Bub | null) => {
      if (!b) return;
      const x = this.center.x + b.spot.x - b.d / 2;
      const y = this.center.y + b.spot.y - b.d / 2;
      out.push({ x: Math.round(x - 4), y: Math.round(y - 4), w: Math.round(b.d + 8), h: Math.round(b.d + 8) });
    };
    add(this.core);
    for (const b of this.moms.values()) add(b);
    for (const s of this.subs) add(s.b);
    for (const f of this.favs) add(f.b);
    add(this.shelf);
    if (this.opt) {
      const r = this.opt.el.getBoundingClientRect();
      if (r.width) out.push({ x: Math.round(r.left - 4), y: Math.round(r.top - 4), w: Math.round(r.width + 8), h: Math.round(r.height + 8) });
    }
    return out;
  }

  private quiet(): boolean {
    return reducedMotion() || calmMode();
  }

  /** Un nouveau menu (ou le même, mis à jour : favoris, dossier su après coup). */
  async show(msg: DropMenuMessage) {
    const same = this.msg?.id === msg.id;
    const wasRow = this.openRow;
    this.msg = msg;
    this.closing = false;
    if (!same) {
      this.dest = msg.dest;
      const f = await this.hooks.frame(true);
      // Le centre du menu : le centre du carré ; Ondine y glisse depuis sa case.
      this.center = { x: RING.size / 2, y: RING.size / 2 };
      this.hooks.box.style.setProperty("--gx", `${this.center.x - f.ox - 56}px`);
      this.hooks.box.style.setProperty("--gy", `${this.center.y - f.oy - 56}px`);
      this.hooks.box.dataset.ring = "true";
      // Ondine glisse au centre du menu (pet.css), puis y reste le temps du choix.
      requestAnimationFrame(() => this.msg?.id === msg.id && (this.hooks.box.dataset.gather = "true"));
      this.openedAt = performance.now();
      this.hooks.play("surprise");
      window.setTimeout(() => this.msg?.id === msg.id && this.hooks.play("focus"), 700);
    }
    this.build(same ? wasRow : null);
    this.hooks.box.append(this.layer);
    this.hooks.hitChanged();
  }

  /** Tout se replie dans la goutte, puis la fenêtre redevient la case d'Ondine. */
  private async fold(eat: boolean) {
    if (!this.msg || this.closing) return;
    this.closing = true;
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    const all = [...this.subs.map((s) => s.b), ...this.favs.map((f) => f.b), this.shelf, ...MOTHER_ORDER.map((r) => this.moms.get(r)), this.opt, this.core].filter((b): b is Bub => !!b);
    const anims = all.map((b, i) => this.leave(b, i));
    this.sayEl.classList.remove("show");
    this.hooks.play(eat ? "eating" : "idle");
    await Promise.all(anims);
    this.hooks.box.dataset.gather = "false";
    // Ondine revient à sa place (la transition de .pet-mascot), puis la fenêtre se resserre.
    await new Promise((ok) => window.setTimeout(ok, this.quiet() || perfMode() === "eco" ? 0 : 320));
    this.layer.replaceChildren();
    this.layer.remove();
    this.msg = null;
    this.hot = null;
    this.subs = [];
    this.favs = [];
    this.moms.clear();
    this.core = this.shelf = this.opt = null;
    this.closing = false;
    this.hooks.box.style.removeProperty("--gx");
    this.hooks.box.style.removeProperty("--gy");
    await this.hooks.frame(false);
    this.hooks.box.dataset.ring = "false";
    this.hooks.hitChanged();
  }

  /** Annuler : rien n'est fait, le fichier reste où il était. */
  cancel() {
    const m = this.msg;
    if (!m || this.closing) return;
    this.hooks.bus.emit("pet.drop-choice", { id: m.id, cancel: true }, "pet");
    void this.fold(false);
  }

  // ── Le dessin ──────────────────────────────────────────────────────────────

  private bubble(cls: string, d: number, spot: Spot, from: Spot, ...children: (Node | string)[]): Bub {
    const node = el("div", { class: `pr-bub ${cls}` }, ...children);
    node.style.setProperty("--d", `${d}px`);
    node.style.left = `${this.center.x + spot.x}px`;
    node.style.top = `${this.center.y + spot.y}px`;
    this.layer.append(node);
    return { el: node, spot, d, from: { x: from.x - spot.x, y: from.y - spot.y } };
  }

  private build(keepRow: DropRow | null) {
    const msg = this.msg!;
    const { menu } = msg;
    this.layer.replaceChildren();
    this.layer.classList.toggle("pr-quiet", this.quiet() || perfMode() === "eco");
    const c = { x: 0, y: 0 };
    // Le centre : la goutte (Ondine passe par-dessus) et l'étiquette du type.
    this.core = this.bubble("pr-core", RING.core, c, c, el("span", { class: "pr-tag", "data-no-i18n": "" }, msg.tag));
    this.core.el.title = [msg.title, msg.meta].filter(Boolean).join(" · ");
    // Les bulles mères.
    this.moms.clear();
    for (const row of MOTHER_ORDER) {
      const ic = el("span", { class: "pr-icon", "aria-hidden": "true" });
      ic.append(lineIcon(ROW_ICON[row]));
      const kids: (Node | string)[] = [el("span", { class: "pr-ring", "aria-hidden": "true" }), ic, el("span", { class: "pr-name" }, ROW_LABEL[row])];
      if (ROW_KEY[row]) kids.push(el("span", { class: "pr-key", "data-no-i18n": "" }, ROW_KEY[row]));
      const b = this.bubble(`pr-mother${menu.dead[row] ? " off" : ""}`, RING.mother, motherSpot(row), c, ...kids);
      b.el.setAttribute("role", "menuitem");
      this.moms.set(row, b);
    }
    // Les favoris, la bulle Étagère, la pilule d'option.
    const fs = favSpots(menu.favs.length);
    this.favs = menu.favs.map((item, i) => {
      const star = el("span", { class: "pr-favstar", "aria-hidden": "true" });
      star.innerHTML = starSvg(true);
      // Une cible (Corbeille…) : son icône et son nom court ; un format : son nom (WebP).
      const own = item.type === "target" && /^(shelf-fav-|team-)/.test(item.id);
      const face: (Node | string)[] = [];
      if (item.icon) {
        const ic = el("span", { class: "pr-icon", "aria-hidden": "true" });
        ic.append(lineIcon(item.icon));
        face.push(ic, el("span", { class: "pr-name pr-small", ...(own ? { "data-no-i18n": "" } : {}) }, item.caption));
      } else face.push(el("span", { class: "pr-name", "data-no-i18n": "" }, item.face));
      const b = this.bubble(`pr-fav${item.off ? " off" : ""}`, RING.fav, fs[i], c, star, ...face);
      b.el.setAttribute("role", "menuitem");
      b.el.setAttribute("aria-label", item.label);
      return { item, b };
    });
    this.shelf = null;
    if (msg.shelf !== null) {
      const ic = el("span", { class: "pr-icon", "aria-hidden": "true" });
      ic.append(lineIcon("🧺"));
      this.shelf = this.bubble("pr-shelf", RING.shelf, shelfSpot(), c, ic, el("span", { class: "pr-name" }, "Étagère"), el("span", { class: "pr-count", "data-no-i18n": "" }, String(msg.shelf)));
    }
    this.opt = null;
    if (msg.option) {
      const node = el("div", { class: "pr-opt" });
      node.style.left = `${this.center.x}px`;
      node.style.top = `${this.center.y + RING.optY}px`;
      this.layer.append(node);
      this.opt = { el: node, spot: { x: 0, y: RING.optY }, d: 28, from: { x: 0, y: -RING.optY } };
      this.fillOption(false);
    }
    this.sayEl.style.left = `${this.center.x}px`;
    this.sayEl.style.top = `${this.center.y + 270}px`;
    this.layer.append(this.sayEl);

    // L'arrivée : la goutte, puis Convertir, Outils, Ranger (50 ms d'écart), puis les favoris.
    const show = (b: Bub | null, delay: number) => b && this.enter(b, delay);
    show(this.core, 0);
    MOTHER_ORDER.forEach((r, i) => show(this.moms.get(r)!, 0.07 + i * 0.05));
    this.favs.forEach((f, i) => show(f.b, 0.24 + i * 0.04));
    show(this.shelf, 0.3);
    show(this.opt, 0.12);
    this.subs = [];
    this.openRow = null;
    const row = keepRow && !menu.dead[keepRow] ? keepRow : menu.open;
    if (!menu.dead[row]) this.openGroup(row, keepRow ? 0 : 0.2);
    this.setSay(this.idleSay());
    this.sayEl.classList.add("show");
  }

  private fillOption(turned: boolean) {
    const o = this.opt;
    if (!o) return;
    const spin = el("span", { class: "pr-spin", "aria-hidden": "true" });
    spin.innerHTML = SPIN_ICON;
    this.optLabel = el("span", {}, DEST_LABEL[this.dest]);
    o.el.replaceChildren(spin, this.optLabel, el("span", { class: "pr-dwell" }));
    if (turned) {
      o.el.classList.remove("turned");
      void o.el.offsetWidth;
      o.el.classList.add("turned");
      sounds.toggle(true);
      this.hooks.hitChanged();
    }
  }

  /** Ouvre les choix d'un groupe dans l'arc de sa bulle mère. */
  private openGroup(row: DropRow, base = 0) {
    const msg = this.msg;
    if (!msg || row === this.openRow || msg.menu.dead[row]) return;
    for (const s of this.subs) void this.leave(s.b, 0);
    this.openRow = row;
    for (const [r, b] of this.moms) b.el.classList.toggle("open", r === row);
    const items = msg.menu.groups[row].slice(0, SUBS_MAX);
    const spots = subSpots(row, items.length);
    const from = motherSpot(row);
    const favIds = new Set(msg.menu.favs.map((f) => f.id));
    this.subs = items.map((item, i) => {
      const star = el("span", { class: `pr-pin${favIds.has(item.id) ? " on" : ""}`, "aria-hidden": "true" });
      star.innerHTML = starSvg(favIds.has(item.id));
      const face = item.icon ? el("span", { class: "pr-icon", "aria-hidden": "true" }) : null;
      if (face && item.icon) face.append(lineIcon(item.icon));
      const own = item.type === "target" && /^(shelf-fav-|team-)/.test(item.id);
      const name = el("span", { class: `pr-name${item.type === "format" && !item.icon ? " pr-fmt" : ""}`, ...(own || (item.type === "format" && !item.icon) ? { "data-no-i18n": "" } : {}) }, item.type === "format" && !item.icon ? item.face : item.caption);
      const b = this.bubble(`pr-sub${item.off ? " off" : ""}${favIds.has(item.id) ? " pinned" : ""}`, RING.sub, spots[i], from, ...(face ? [face] : []), name, star);
      b.el.setAttribute("role", "menuitem");
      b.el.setAttribute("aria-label", item.label);
      this.enter(b, base + i * 0.032);
      return { item, b, star };
    });
    this.dwell = new Dwell(OPEN_DWELL);
    this.hooks.play("focus");
    this.hooks.hitChanged();
  }

  /** Une bulle sort de sa bulle mère (ou du centre), en ressort ; fondu en mode calme ; rien en Économie. */
  private enter(b: Bub, delay: number) {
    b.el.classList.add("show");
    if (perfMode() === "eco" || typeof b.el.animate !== "function") return;
    const calm = this.quiet();
    b.el.animate(
      calm
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: `translate(${b.from.x}px, ${b.from.y}px) scale(0.2)` },
            { opacity: 1, offset: 0.35 },
            { opacity: 1, transform: "none" },
          ],
      { duration: calm ? 160 : 440, delay: calm ? 0 : delay * 1000, easing: calm ? "linear" : "cubic-bezier(.34,1.56,.64,1)", fill: "backwards" },
    );
  }

  /** Une bulle rentre (vers sa bulle mère ou le centre) et part. */
  private leave(b: Bub, i: number): Promise<void> {
    const done = () => b.el.remove();
    if (perfMode() === "eco" || typeof b.el.animate !== "function") {
      done();
      return Promise.resolve();
    }
    const calm = this.quiet();
    const anim = b.el.animate(
      calm ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translate(${-b.spot.x}px, ${-b.spot.y}px) scale(0.2)` }],
      { duration: calm ? 140 : 300, delay: calm ? 0 : Math.min(i, 12) * 22, easing: "cubic-bezier(.5,0,.75,0)", fill: "forwards" },
    );
    return anim.finished.then(done, done);
  }

  // ── Le survol, le clic ─────────────────────────────────────────────────────

  private hitAt(x: number, y: number): Hit | null {
    const node = document.elementFromPoint(x, y);
    const bub = node?.closest<HTMLElement>(".pr-bub, .pr-opt");
    if (!bub || !this.layer.contains(bub)) return null;
    if (this.opt && bub === this.opt.el) return { kind: "opt", b: this.opt };
    if (this.core && bub === this.core.el) return { kind: "core", b: this.core };
    if (this.shelf && bub === this.shelf.el) return { kind: "shelf", b: this.shelf };
    for (const [row, b] of this.moms) if (b.el === bub) return { kind: "mom", row, b };
    const s = this.subs.find((x) => x.b.el === bub);
    if (s) return node?.closest(".pr-pin") ? { kind: "star", item: s.item, b: s.b } : { kind: "item", item: s.item, b: s.b };
    const f = this.favs.find((x) => x.b.el === bub);
    if (f) return { kind: "item", item: f.item, b: f.b };
    return null;
  }

  private aim(x: number, y: number) {
    if (this.closing) return;
    const hit = this.hitAt(x, y);
    const same = hit?.kind === this.hot?.kind && hit?.b === this.hot?.b;
    if (!same) this.setHot(hit);
    if (hit) this.hooks.lookAt(this.center.x + hit.b.spot.x, this.center.y + hit.b.spot.y);
  }

  private setHot(hit: Hit | null) {
    const prev = this.hot;
    this.hot = hit;
    prev?.b.el.classList.remove("hot", "pinhot");
    if (prev?.kind === "mom") prev.b.el.style.removeProperty("--p");
    if (hit && hit.kind !== "core") {
      hit.b.el.classList.add("hot");
      if (hit.kind === "star") hit.b.el.classList.add("pinhot");
      if (prev?.b !== hit.b) sounds.tap();
    }
    this.setSay(this.sayFor(hit));
    if (hit?.kind === "mom" || hit?.kind === "opt") this.kick();
  }

  /** Les survols qui attendent : la bulle mère (0,4 s, l'anneau), la pilule d'option (0,5 s). */
  private kick() {
    if (this.frameId) return;
    const step = (now: number) => {
      this.frameId = 0;
      const h = this.hot;
      const mom = h?.kind === "mom" && h.row !== this.openRow && !this.msg?.menu.dead[h.row] ? h : null;
      if (this.dwell.update(!!mom, now) && mom) this.openGroup(mom.row);
      if (mom) mom.b.el.style.setProperty("--p", this.dwell.progress(now).toFixed(3));
      const onOpt = h?.kind === "opt";
      if (this.optDwell.update(onOpt, now)) this.turn();
      const bar = this.opt?.el.querySelector<HTMLElement>(".pr-dwell");
      if (bar) bar.style.transform = `scaleX(${this.optDwell.progress(now).toFixed(3)})`;
      if (mom || onOpt) this.frameId = requestAnimationFrame(step);
    };
    this.frameId = requestAnimationFrame(step);
  }

  private turn() {
    this.dest = nextDest(this.dest);
    this.fillOption(true);
  }

  private activate(hit: Hit) {
    const msg = this.msg;
    if (!msg || this.closing) return;
    switch (hit.kind) {
      case "core":
        return; // la goutte : rien (Échap ou un clic dans le vide annulent)
      case "opt":
        return this.turn();
      case "mom":
        if (msg.menu.dead[hit.row]) return this.flash(msg.menu.dead[hit.row]!);
        return this.openGroup(hit.row);
      case "star":
        // L'île enregistre le favori et renvoie le menu (show, même numéro).
        if (!hit.b.el.classList.contains("pinned") && msg.menu.favs.length >= 5) return this.flash("Cinq favoris au plus : retirez-en un d'abord");
        this.hooks.bus.emit("pet.drop-pin", { id: msg.id, choice: hit.item.id }, "pet");
        sounds.toggle(true);
        return;
      case "shelf":
        this.hooks.bus.emit("pet.drop-choice", { id: msg.id, choice: "shelf-add" }, "pet");
        void this.fold(true);
        return;
      case "item":
        if (hit.item.off) return this.flash(hit.item.off);
        this.hooks.bus.emit("pet.drop-choice", { id: msg.id, choice: hit.item.id, dest: this.dest }, "pet");
        void this.fold(true);
        return;
    }
  }

  // ── La phrase ──────────────────────────────────────────────────────────────

  private idleSay(): string {
    return "Survolez une bulle, puis cliquez · Échap annule";
  }

  private sayFor(hit: Hit | null): string {
    const msg = this.msg;
    if (!hit || !msg) return this.idleSay();
    switch (hit.kind) {
      case "core":
        return [msg.title, msg.meta].filter(Boolean).join(" · ");
      case "opt":
        return OPTION_SAY;
      case "mom":
        return msg.menu.dead[hit.row] ?? (hit.row === this.openRow ? this.idleSay() : "Restez un instant pour ouvrir, ou cliquez");
      case "star":
        return hit.b.el.classList.contains("pinned") ? "Cliquez pour retirer des favoris" : "Cliquez pour épingler en favori";
      case "shelf":
        return "Cliquez pour poser sur l'étagère";
      case "item":
        return hit.item.off ?? msg.says[hit.item.id] ?? hit.item.label;
    }
  }

  private flash(text: string) {
    this.flashUntil = performance.now() + 1800;
    this.setSay(text, true);
    window.setTimeout(() => performance.now() >= this.flashUntil && this.setSay(this.sayFor(this.hot)), 1820);
  }

  private setSay(text: string, force = false) {
    if (!force && performance.now() < this.flashUntil) return;
    if (this.sayEl.textContent !== text) this.sayEl.textContent = text;
  }
}
