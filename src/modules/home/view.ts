// Module « Accueil » : la première page de l'île ouverte.
//
// Une carte par module qui a quelque chose à dire. Les modules les proposent
// eux-mêmes (`api.homeCard`, src/core/home-cards.ts) ; ici, on les range, on
// les dessine et on les anime :
//   - en haut, la phrase d'Ondine (home-rules.ts, composePhrase), faite des
//     morceaux que donnent les cartes, sans IA ;
//   - les cartes : petites ou larges ; glisser pour les ranger, clic droit
//     pour changer la taille ou les retirer ; un clic agrandit la carte sur
//     place jusqu'à la vue complète de son module, un clic sur son en-tête la
//     referme. L'ordre automatique suit le moment de la journée ;
//   - la carte « Reprendre » (le dernier fichier, la dernière note, la
//     dernière session d'agent), faite des lignes `resume()` des modules ;
//   - en bas, 4 actions rapides au choix (réglages action1 … action4).
// Ce qu'on range à la main est gardé par profil (modules.home.values.layouts).
// La carte importante (urgent) : Ondine la regarde (`mascot.look-at`), sauf en Calme.
// Animations : cascade en gelée à l'ouverture, fondu seul avec « Réduire les
// animations » ; tout est interrompu proprement par un clic.

import manifest from "./manifest.json";
import type { HomeCardAction, HomeCardEntry, HomeCardSize, HomeCardView, HomeMoment, HomeResumeItem } from "../../core/home-cards";
import { FrameBatch } from "../../core/frame-batch";
import { homeCards } from "../../core/home-cards";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { pacedInterval, setText } from "../../core/perf";
import { settingsStore } from "../../core/settings-store";
import { calmMode } from "../../mascot/mascot-state";
import { el } from "../../island/dom";
import { icon } from "../../island/icon";
import { reducedMotion } from "../../island/tab-pill";
import {
  arrangeCards,
  composePhrase,
  hideCard,
  layoutFor,
  layoutKey,
  lookTarget,
  momentOf,
  orderAfterDrag,
  pickQuickActions,
  pickResume,
  resizeCard,
  weightAt,
  withLayout,
  type CardInfo,
  type HomeLayout,
  type PlacedCard,
} from "./home-rules";
import { EASE_OUT, POP_SOFT } from "../../core/easing";

/** La clé de la carte « Reprendre », faite par l'Accueil lui-même. */
const RESUME_KEY = "home.resume";
const RESUME_MOMENTS: Partial<Record<HomeMoment, number>> = { morning: 62, day: 45, evening: 35 };
/** Au-delà de ce déplacement (px), un appui sur une carte devient un glisser. */
const DRAG_THRESHOLD = 6;
const OUT = EASE_OUT;
/** Un ressort un peu mou : la gelée de l'île. */
const JELLY = POP_SOFT;

// ── Réglages et disposition ──────────────────────────────────────────────────

function layoutNow(): { key: string; layout: HomeLayout } {
  const key = layoutKey(settingsStore.current.profiles?.active);
  return { key, layout: layoutFor(settingsStore.current.modules.home?.values?.layouts, key) };
}

function saveLayout(layout: HomeLayout) {
  const key = layoutKey(settingsStore.current.profiles?.active);
  void settingsStore.update((d) => {
    const entry = (d.modules.home ??= { enabled: true, values: {} });
    entry.values.layouts = withLayout(entry.values.layouts, key, layout);
  });
}

/** Le style de l'île (réglage `island.style` de l'île-bouche) : les cartes en gomme dans le style bouche. */
function mouthStyle(): boolean {
  return (settingsStore.current.island as { style?: string }).style === "mouth";
}

// ── Les actions rapides ──────────────────────────────────────────────────────

function runQuick(api: ModuleApi, id: string) {
  switch (id) {
    case "capture":
      api.closeIsland();
      api.emit("capture.request", { then: "save" });
      break;
    case "color":
      api.closeIsland();
      api.emit("capture.pick");
      break;
    case "timer25":
      api.emit("timer.start", { minutes: 25 });
      break;
    case "terminal":
      api.emit("terminal.open", {});
      break;
    case "note":
      api.openIsland("notes");
      break;
    default:
      // askclaude, launcher, clipboard, agents : leur onglet.
      api.openIsland(id);
  }
}

// ── Une carte dessinée ───────────────────────────────────────────────────────

interface CardUi {
  key: string;
  el: HTMLElement;
  head: HTMLElement;
  title: HTMLElement;
  value: HTMLElement;
  sub: HTMLElement;
  bar: HTMLElement;
  barFill: HTMLElement;
  cover: HTMLImageElement;
  rows: HTMLElement;
  actions: HTMLElement;
  /** Ce qui a été dessiné en dernier (pour ne refaire que ce qui change). */
  shown: { image: string | null; rows: string; actions: string };
  entry: HomeCardEntry | null;
  currentActions: HomeCardAction[];
}

function cardUi(key: string, title: string, glyph: string): CardUi {
  const t = el("span", { class: "home-card-title" }, title);
  const head = el("div", { class: "home-card-head" }, el("span", { class: "home-card-icon", "aria-hidden": "true" }, icon(glyph)), t);
  const value = el("b", { class: "home-card-value" });
  const sub = el("span", { class: "home-card-sub" });
  const barFill = el("i");
  const bar = el("div", { class: "home-card-bar", hidden: true }, barFill);
  const cover = el("img", { class: "home-card-cover", alt: "", hidden: true });
  const rows = el("div", { class: "home-card-rows" });
  const actions = el("div", { class: "home-card-actions" });
  const mini = el("div", { class: "home-card-mini" }, el("div", { class: "home-card-main" }, cover, el("div", { class: "home-card-text" }, value, sub)), rows, bar, actions);
  const node = el("div", { class: "home-card", "data-key": key, tabindex: 0, role: "button" }, head, mini);
  return { key, el: node, head, title: t, value, sub, bar, barFill, cover, rows, actions, shown: { image: null, rows: "", actions: "" }, entry: null, currentActions: [] };
}

/** Met la carte à jour sur place : les chiffres qui changent roulent (motion.ts, watchContent). */
function paintCard(ui: CardUi, view: HomeCardView, fallbackTitle: string, size: HomeCardSize, api: ModuleApi) {
  ui.el.classList.toggle("large", size === "large");
  ui.el.classList.toggle("urgent", !!view.urgent);
  setText(ui.title, view.title ?? fallbackTitle);
  setText(ui.value, view.value ?? "");
  ui.value.hidden = !view.value;
  setText(ui.sub, view.sub ?? "");
  ui.sub.hidden = !view.sub;
  const p = view.progress;
  ui.bar.hidden = p === undefined || p === null;
  if (!ui.bar.hidden) ui.barFill.style.setProperty("--fill", `${Math.round(Math.max(0, Math.min(1, p!)) * 100)}%`);
  const image = view.image ?? null;
  if (image !== ui.shown.image) {
    ui.shown.image = image;
    ui.cover.hidden = !image;
    if (image) ui.cover.src = image;
    else ui.cover.removeAttribute("src");
  }
  if (view.tint) {
    ui.el.style.setProperty("--tint-rgb", view.tint.map((c) => Math.round(c)).join(" "));
    ui.el.classList.add("tinted");
  } else ui.el.classList.remove("tinted");
  const rows = (view.rows ?? []).slice(0, size === "large" ? 4 : 2);
  const rowsKey = rows.map((r) => `${r.label}\u0001${r.value}`).join("\u0002");
  if (rowsKey !== ui.shown.rows) {
    // Même nombre de lignes : on change les textes sur place (les chiffres roulent).
    const same = ui.rows.children.length === rows.length;
    if (!same) ui.rows.replaceChildren(...rows.map(() => el("div", { class: "home-row" }, el("span", { "data-no-i18n": true }), el("span"))));
    rows.forEach((r, i) => {
      const line = ui.rows.children[i] as HTMLElement;
      setText(line.children[0], r.label);
      setText(line.children[1], r.value);
    });
    ui.shown.rows = rowsKey;
  }
  const actions = (view.actions ?? []).slice(0, 3);
  ui.currentActions = actions;
  const actionsKey = actions.map((a) => `${a.icon}\u0001${a.label}`).join("\u0002");
  if (actionsKey !== ui.shown.actions) {
    ui.shown.actions = actionsKey;
    ui.actions.replaceChildren(
      ...actions.map((a, index) =>
        el(
          "button",
          {
            class: "home-card-btn",
            title: a.label,
            "aria-label": a.label,
            // Un clic sur un petit bouton n'ouvre pas la carte.
            onpointerdown: (e: PointerEvent) => e.stopPropagation(),
            onclick: (e: MouseEvent) => {
              e.stopPropagation();
              const entry = ui.entry;
              const action = ui.currentActions[index];
              if (entry && action) entry.guard("action", () => void Promise.resolve(action.run()).catch((err) => api.log.warn(`action de carte : ${String(err)}`)), undefined);
            },
          },
          icon(a.icon),
        ),
      ),
    );
  }
  ui.actions.hidden = actions.length === 0;
}

// ── Les animations ───────────────────────────────────────────────────────────

/** Une carte arrive : en gelée (elle gonfle, s'écrase un peu, se pose) ; en fondu seul si on réduit les animations. */
function jellyIn(node: HTMLElement, delay: number) {
  if (reducedMotion()) {
    node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: delay / 3, easing: "ease-out", fill: "backwards" });
    return;
  }
  node.animate(
    [
      { opacity: 0, transform: "translateY(10px) scale(0.84)" },
      { opacity: 1, transform: "translateY(-1px) scale(1.04, 0.97)", offset: 0.5 },
      { transform: "scale(0.985, 1.02)", offset: 0.75 },
      { opacity: 1, transform: "none" },
    ],
    { duration: 560, delay, easing: OUT, fill: "backwards" },
  );
}

function fadeOut(node: HTMLElement): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  return node
    .animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.9)" }], { duration: 180, easing: OUT, fill: "forwards" })
    .finished.then(
      () => undefined,
      () => undefined,
    );
}

/** Les cartes qui ont bougé glissent depuis leur ancienne place (FLIP). */
function flipFrom(nodes: HTMLElement[], before: Map<HTMLElement, DOMRect>) {
  if (reducedMotion()) return;
  const moves: { node: HTMLElement; dx: number; dy: number }[] = [];
  for (const n of nodes) {
    const old = before.get(n);
    if (!old || n.classList.contains("dragged")) continue;
    const now = n.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    moves.push({ node: n, dx, dy });
  }
  for (const { node, dx, dy } of moves) node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 380, easing: JELLY });
}

/** Arrête net les animations d'une carte (un clic pendant l'arrivée : elle est tout de suite à sa place). */
function settleNow(node: HTMLElement) {
  for (const a of node.getAnimations()) a.finish();
}

// ── La vue ───────────────────────────────────────────────────────────────────

function mountHome(root: HTMLElement, api: ModuleApi): () => void {
  const greet = el("span", { class: "home-greet" });
  const parts = el("span", { class: "home-parts" });
  const phrase = el("p", { class: "home-phrase" }, greet, parts);
  const grid = el("div", { class: "home-grid" });
  const empty = el("p", { class: "home-empty muted", hidden: true }, "Rien de spécial pour l'instant : Ondine vous préviendra.");
  const quick = el("div", { class: "home-quick" });
  const menu = el("div", { class: "home-menu", role: "menu", hidden: true });
  // data-island-fit : l'île grandit pour montrer les cartes (et la carte ouverte) en entier (fit.ts).
  const home = el("div", { class: "home", "data-island-fit": true }, phrase, grid, empty, quick, menu);
  root.append(home);

  const cards = new Map<string, CardUi>();
  /** La carte ouverte (agrandie jusqu'au module), et de quoi la refermer. */
  let open: { key: string; body: HTMLElement; unmount: () => void } | null = null;
  let placed: PlacedCard[] = [];
  let first = true;
  let looked: string | null = null;
  let disposed = false;
  /** Le dernier `load()` de chaque carte (ms). */
  const loadedAt = new Map<string, number>();
  let quickKey = "";
  let partsShown: string | null = null;

  const ctxFor = (key: string, layout: HomeLayout, fallback: HomeCardSize | undefined): { moment: HomeMoment; size: HomeCardSize } => ({
    moment: momentOf(new Date().getHours()),
    size: layout.sizes[key] ?? fallback ?? "small",
  });

  /** Demande aux cartes de se mettre à jour (commande Rust), à l'arrivée puis de temps en temps. */
  const loadAll = (force = false) => {
    const now = Date.now();
    for (const entry of homeCards.list()) {
      const load = entry.spec.load;
      if (!load) continue;
      const every = Math.max(5_000, entry.spec.refreshMs ?? 30_000);
      if (!force && now - (loadedAt.get(entry.key) ?? 0) < every) continue;
      loadedAt.set(entry.key, now);
      void entry
        .guard("load", () => load.call(entry.spec), Promise.resolve())
        .catch(() => undefined)
        .then(() => !disposed && renders.request());
    }
  };

  /** La carte « Reprendre » : les lignes `resume()` des modules. */
  const resumeView = (): HomeCardView | null => {
    if (api.settings().resume === false) return null;
    const items = pickResume(
      homeCards.list().map((e) => (e.spec.resume ? e.guard("resume", () => e.spec.resume!(), null) : null)),
      Date.now(),
    ) as HomeResumeItem[];
    if (!items.length) return null;
    resumeItems = items;
    return { rows: items.map((x) => ({ label: `${x.icon} ${x.label}`, value: x.detail })) };
  };
  let resumeItems: HomeResumeItem[] = [];

  /** Relit toutes les cartes et met la page à jour. */
  const tick = () => {
    if (disposed) return;
    const s = api.settings();
    const { layout } = layoutNow();
    const moment = momentOf(new Date().getHours());
    home.classList.toggle("home-gum", mouthStyle());

    // La carte ouverte dont le module s'est arrêté : on la referme.
    if (open && !homeCards.list().some((e) => e.key === open!.key)) closeCard(true);

    // 1. Ce que chaque carte a à dire.
    const views = new Map<string, { view: HomeCardView; entry: HomeCardEntry | null; title: string; glyph: string }>();
    const infos: CardInfo[] = [];
    for (const entry of homeCards.list()) {
      const ctx = ctxFor(entry.key, layout, entry.spec.size);
      const view = entry.guard("view", () => entry.spec.view(ctx), null);
      if (!view && open?.key !== entry.key) continue;
      views.set(entry.key, { view: view ?? {}, entry, title: entry.spec.title, glyph: entry.spec.icon });
      infos.push({ key: entry.key, weight: weightAt(entry.spec.moments, moment), urgent: !!view?.urgent, size: entry.spec.size ?? "small" });
    }
    const resume = resumeView();
    if (resume) {
      views.set(RESUME_KEY, { view: resume, entry: null, title: "Reprendre", glyph: "↩️" });
      infos.push({ key: RESUME_KEY, weight: weightAt(RESUME_MOMENTS, moment), urgent: false, size: "large" });
    }

    // 2. L'ordre et la taille.
    placed = arrangeCards(infos, layout, s.byMoment !== false);

    // 3. Les cartes : celles qui partent s'effacent, les nouvelles arrivent en gelée.
    const wanted = new Set(placed.map((p) => p.key));
    if (open) wanted.add(open.key);
    const before = new Map<HTMLElement, DOMRect>();
    for (const ui of cards.values()) before.set(ui.el, ui.el.getBoundingClientRect());
    for (const [key, ui] of [...cards]) {
      if (wanted.has(key)) continue;
      cards.delete(key);
      ui.el.classList.add("leaving");
      void fadeOut(ui.el).then(() => ui.el.remove());
    }
    let arrivals = 0;
    placed.forEach((p, i) => {
      const info = views.get(p.key)!;
      let ui = cards.get(p.key);
      if (!ui) {
        ui = cardUi(p.key, info.title, info.glyph);
        cards.set(p.key, ui);
        wire(ui);
        jellyIn(ui.el, first ? 90 + i * 60 : 40 + arrivals++ * 60);
      }
      ui.entry = info.entry;
      ui.el.classList.toggle("expandable", !!info.entry?.expand);
      paintCard(ui, info.view, info.title, p.size, api);
      // À sa place dans la grille (pas pendant un glisser : la main décide).
      const at = grid.children[i];
      if (at !== ui.el && !dragging) grid.insertBefore(ui.el, at ?? null);
    });
    flipFrom([...cards.values()].map((u) => u.el), before);
    empty.hidden = placed.length > 0 || !!open;

    // 4. La phrase d'Ondine.
    phrase.hidden = s.phrase === false;
    if (!phrase.hidden) {
      const said = composePhrase(
        moment,
        settingsStore.current.general.firstName ?? "",
        placed.map((p) => views.get(p.key)?.view.phrase),
      );
      setText(greet, said.greeting);
      // Comparé au texte français écrit la dernière fois (l'écran, lui, peut être traduit).
      const want = said.parts.join("\u0001");
      if (want !== partsShown) {
        partsShown = want;
        // Un morceau par élément : chacun garde sa traduction (i18n-en.json).
        const nodes: Node[] = [];
        said.parts.forEach((p, i) => {
          if (i) nodes.push(document.createTextNode(", "));
          nodes.push(el("span", { class: "home-part" }, p));
        });
        if (nodes.length) nodes.push(document.createTextNode("."));
        parts.replaceChildren(...nodes);
      }
    }

    // 5. Les actions rapides.
    const actions = pickQuickActions([s.action1, s.action2, s.action3, s.action4], (id) => settingsStore.moduleEnabled(id));
    const key = actions.map((a) => a.id).join(",");
    if (key !== quickKey) {
      quickKey = key;
      quick.replaceChildren(
        ...actions.map((a) => el("button", { class: "home-quick-btn", "data-id": a.id, onclick: api.handler(() => runQuick(api, a.id)) }, el("span", { "aria-hidden": "true" }, icon(a.icon)), el("span", {}, a.label))),
      );
    }
    quick.hidden = actions.length === 0;

    // 6. Ondine regarde la carte importante (une fois par carte).
    lookAtImportant(s.look !== false);
    first = false;
  };

  const lookAtImportant = (enabled: boolean) => {
    const target = enabled && !calmMode() && !open ? lookTarget(placed) : null;
    if (target === looked) return;
    looked = target;
    const node = target ? cards.get(target)?.el : null;
    if (!node) return;
    // Après l'arrivée des cartes : sa vraie place.
    window.setTimeout(() => {
      if (disposed || looked !== target || !node.isConnected) return;
      const r = node.getBoundingClientRect();
      api.emit("mascot.look-at", { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    }, reducedMotion() ? 0 : 450);
  };

  // ── Ouvrir une carte sur place ─────────────────────────────────────────────

  const toggleOpen = (ui: CardUi) => {
    if (open?.key === ui.key) return closeCard();
    if (open) closeCard(true);
    const entry = ui.entry;
    if (!entry?.expand) return;
    for (const c of cards.values()) settleNow(c.el);
    const firstRect = ui.el.getBoundingClientRect();
    const body = el("div", { class: "home-card-full" });
    home.classList.add("home-focus");
    ui.el.classList.add("open");
    ui.el.setAttribute("aria-expanded", "true");
    ui.el.append(body);
    const unmount = entry.expand(body);
    open = { key: ui.key, body, unmount };
    looked = null;
    growFrom(ui.el, firstRect);
    if (!reducedMotion()) body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 120, easing: OUT, fill: "backwards" });
  };

  /** Referme la carte ouverte ; `quick` : sans animation (on en ouvre une autre). */
  const closeCard = (quick = false) => {
    if (!open) return;
    const ui = cards.get(open.key);
    const { body, unmount } = open;
    open = null;
    unmount();
    body.remove();
    const bigRect = ui?.el.getBoundingClientRect();
    home.classList.remove("home-focus");
    ui?.el.classList.remove("open");
    ui?.el.setAttribute("aria-expanded", "false");
    tick();
    if (quick || !ui || !bigRect) return;
    growFrom(ui.el, bigRect);
    let i = 0;
    for (const c of cards.values()) if (c !== ui) jellyIn(c.el, 60 + i++ * 40);
    ui.el.focus({ preventScroll: true });
  };

  /** La carte passe de `from` (son ancienne place) à sa nouvelle place, en ressort (FLIP). */
  const growFrom = (node: HTMLElement, from: DOMRect) => {
    if (reducedMotion()) return;
    const to = node.getBoundingClientRect();
    if (!to.width || !to.height) return;
    node.animate(
      [
        { transformOrigin: "top left", transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})` },
        { transformOrigin: "top left", transform: "none" },
      ],
      { duration: 520, easing: JELLY },
    );
  };

  // ── Glisser pour ranger, clic droit pour le menu ───────────────────────────

  let press: { ui: CardUi; id: number; x: number; y: number } | null = null;
  let dragging = false;
  let swallow = false;

  const wire = (ui: CardUi) => {
    ui.el.addEventListener("click", (e) => {
      if (swallow) {
        swallow = false;
        return;
      }
      // Dans la carte ouverte : seul l'en-tête la referme (le reste est au module).
      if (open?.key === ui.key && !ui.head.contains(e.target as Node)) return;
      if (ui.key === RESUME_KEY) return openResume(e);
      toggleOpen(ui);
    });
    ui.el.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target === ui.el) {
        e.preventDefault();
        if (ui.key === RESUME_KEY) resumeItems[0] && void resumeItems[0].open();
        else toggleOpen(ui);
      }
    });
    ui.el.addEventListener("contextmenu", (e) => {
      // Dans la carte ouverte, le clic droit appartient au module.
      if (open?.key === ui.key && !ui.head.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();
      showMenu(e, ui);
    });
  };

  /** « Reprendre » : chaque ligne ouvre sa chose. */
  const openResume = (e: MouseEvent) => {
    const row = (e.target as HTMLElement).closest(".home-row");
    const ui = cards.get(RESUME_KEY);
    if (!row || !ui) return;
    const item = resumeItems[[...ui.rows.children].indexOf(row)];
    if (item) void Promise.resolve(item.open()).catch((err) => api.log.warn(`reprendre : ${String(err)}`));
  };

  grid.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || open) return;
    const node = (e.target as HTMLElement).closest<HTMLElement>(".home-card");
    const ui = node ? cards.get(node.dataset.key ?? "") : undefined;
    if (!ui) return;
    settleNow(ui.el);
    press = { ui, id: e.pointerId, x: e.clientX, y: e.clientY };
    dragging = false;
  });
  grid.addEventListener("pointermove", (e) => {
    if (!press || e.pointerId !== press.id) return;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    const ui = press.ui;
    if (!dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      dragging = true;
      ui.el.setPointerCapture(e.pointerId);
      ui.el.classList.add("dragged");
      home.classList.add("dragging");
    }
    // La carte sous la souris : la nôtre prend sa place, les autres s'écartent.
    const others = [...grid.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c !== ui.el && !c.classList.contains("leaving"));
    // Leur vraie place (offsetLeft/Top), pas leur dessin en train de glisser :
    // sinon une carte qui s'écarte repasserait sous la souris et tout reviendrait.
    const box = home.getBoundingClientRect();
    const place = (c: HTMLElement) => ({ left: box.left + c.offsetLeft, top: box.top + c.offsetTop, width: c.offsetWidth, height: c.offsetHeight });
    const over = others.find((c) => {
      const r = place(c);
      return e.clientX >= r.left && e.clientX <= r.left + r.width && e.clientY >= r.top && e.clientY <= r.top + r.height;
    });
    if (over) {
      const r = place(over);
      const after = e.clientX > r.left + r.width / 2;
      const ref = after ? over.nextSibling : over;
      if (ref !== ui.el && ui.el.nextSibling !== ref) {
        const before = new Map(others.map((c) => [c, c.getBoundingClientRect()]));
        const mine = ui.el.getBoundingClientRect();
        grid.insertBefore(ui.el, ref);
        flipFrom(others, before);
        // La carte reste sous la souris : son décalage compense sa nouvelle place.
        const now = ui.el.getBoundingClientRect();
        press.x += now.left - mine.left;
        press.y += now.top - mine.top;
      }
    }
    const sx = e.clientX - press.x;
    const sy = e.clientY - press.y;
    ui.el.dataset.dx = String(sx);
    ui.el.dataset.dy = String(sy);
    ui.el.style.transform = `translate(${sx}px, ${sy}px) scale(1.04)`;
  });
  const endDrag = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    const ui = press.ui;
    press = null;
    if (!dragging) return;
    dragging = false;
    swallow = true;
    window.setTimeout(() => (swallow = false), 0);
    const sx = Number(ui.el.dataset.dx ?? 0);
    const sy = Number(ui.el.dataset.dy ?? 0);
    delete ui.el.dataset.dx;
    delete ui.el.dataset.dy;
    ui.el.style.transform = "";
    ui.el.classList.remove("dragged");
    home.classList.remove("dragging");
    if (!reducedMotion()) ui.el.animate([{ transform: `translate(${sx}px, ${sy}px) scale(1.04)` }, { transform: "none" }], { duration: 420, easing: JELLY });
    const visible = [...grid.children].map((c) => (c as HTMLElement).dataset.key ?? "").filter((k) => k && cards.has(k));
    const { layout } = layoutNow();
    saveLayout({ ...layout, order: orderAfterDrag(visible, layout.order.length ? layout.order : placed.map((p) => p.key)) });
  };
  grid.addEventListener("pointerup", endDrag);
  grid.addEventListener("pointercancel", endDrag);

  // ── Le menu du clic droit ──────────────────────────────────────────────────

  const hideMenu = () => {
    menu.hidden = true;
    menu.replaceChildren();
  };
  const item = (label: string, run: () => void) =>
    el(
      "button",
      {
        class: "home-menu-item",
        role: "menuitem",
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          hideMenu();
          run();
        },
      },
      label,
    );
  const showMenu = (e: MouseEvent, ui: CardUi | null) => {
    const { layout } = layoutNow();
    const items: HTMLElement[] = [];
    if (ui) {
      const size = placed.find((p) => p.key === ui.key)?.size ?? "small";
      items.push(
        size === "large" ? item("Petite taille", () => saveLayout(resizeCard(layoutNow().layout, ui.key, "small"))) : item("Grande taille", () => saveLayout(resizeCard(layoutNow().layout, ui.key, "large"))),
        item("Retirer de l'accueil", () => saveLayout(hideCard(layoutNow().layout, ui.key))),
      );
    }
    if (layout.order.length) items.push(item("Ranger selon le moment", () => saveLayout({ ...layoutNow().layout, order: [] })));
    if (layout.hidden.length) items.push(item("Remettre les cartes retirées", () => saveLayout({ ...layoutNow().layout, hidden: [] })));
    if (!items.length) return;
    menu.replaceChildren(...items);
    menu.hidden = false;
    const box = home.getBoundingClientRect();
    const x = Math.min(e.clientX - box.left, box.width - menu.offsetWidth - 4);
    const y = Math.min(e.clientY - box.top, Math.max(0, box.height - menu.offsetHeight - 4));
    menu.style.left = `${Math.max(4, x)}px`;
    menu.style.top = `${Math.max(4, y)}px`;
    if (!reducedMotion()) menu.animate([{ opacity: 0, transform: "scale(0.92)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: JELLY });
    (menu.firstElementChild as HTMLElement | null)?.focus({ preventScroll: true });
  };
  home.addEventListener("contextmenu", (e) => {
    if (open) return;
    e.preventDefault();
    showMenu(e, null);
  });
  // Échap referme d'abord la carte ouverte (puis, une seconde fois, l'île).
  home.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !open || !menu.hidden) return;
    e.stopPropagation();
    closeCard();
  });
  const outside = (e: PointerEvent) => {
    if (!menu.hidden && !menu.contains(e.target as Node)) hideMenu();
  };
  document.addEventListener("pointerdown", outside, true);
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      hideMenu();
    }
  });

  // ── En route ───────────────────────────────────────────────────────────────

  const renders = new FrameBatch(tick);
  const offCards = homeCards.onChange(renders.request);
  const offSettings = settingsStore.onChange(renders.request);
  const stopTick = pacedInterval(() => {
    renders.request();
    loadAll();
  }, "homeTick", true);
  loadAll(true);
  tick();

  return () => {
    disposed = true;
    renders.stop();
    offCards();
    offSettings();
    stopTick();
    document.removeEventListener("pointerdown", outside, true);
    open?.unmount();
    open = null;
  };
}

export const home: IslandModule = {
  manifest: manifest as ModuleManifest,
  views: {
    expanded: mountHome,
  },
};
