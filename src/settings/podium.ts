// Réglages → Mascotte → Apparence : le podium des mascottes.
//
// Toutes les mascottes du catalogue posées sur des marches en fausse 3D
// (1, 3, 5, 6 places, puis d'autres rangées si le catalogue grandit). Celle de
// la première marche vit dans l'île : on en glisse une autre dessus (ou
// double-clic, ou Entrée au clavier) pour la choisir. Les autres changent
// d'humeur au hasard, de temps en temps.
//
// L'ordre des marches du bas est une préférence de cette fenêtre
// (localStorage), seule la première place est un réglage (`mascot.id`).
// Les mascottes ne sont dessinées qu'une fois le podium affiché (`start`),
// et `destroy` arrête tout quand la page change.

import { el } from "../island/dom";
import { reducedMotion } from "../island/tab-pill";
import type { CatalogEntry } from "../mascot/catalog";
import { createRenderer, type MascotRenderer } from "../mascot/renderer";
import { podiumOrder, podiumRows } from "./podium-layout";

/** La largeur de chaque marche, en % de la scène. */
const WIDTHS = [26, 50, 76, 100];
/** Les humeurs tirées au hasard (animations du manifeste gomme). */
const MOODS = ["coucou", "rire", "love", "wink", "shy", "fiere", "boude", "etoiles", "malice", "emue", "genee", "danse", "pensive", "baille", "surprise", "happy", "calm"];
const CHAMPION_MOODS = ["fiere", "danse", "coucou", "etoiles"];
const ORDER_KEY = "settings.podium";

interface Slot {
  x: number;
  y: number;
}

function remembered(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(ORDER_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function remember(order: string[]) {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    // pas grave : l'ordre des marches du bas reviendra par défaut
  }
}

/** Le nom court : « Guimauve (gomme carrée) » → « Guimauve ». */
function shortName(name: string): string {
  return name.replace(/\s*\(.*\)$/, "");
}

export interface Podium {
  el: HTMLElement;
  /** Dessine les mascottes (à appeler une fois le podium dans la page). */
  start(): void;
  destroy(): void;
}

/**
 * Le podium. `chosen` : l'id de la mascotte de l'île ; `size` : la taille du
 * réglage (data-size) ; `onChoose` : une autre mascotte arrive en haut.
 */
export function mascotPodium(catalog: CatalogEntry[], chosen: string, onChoose: (id: string) => void): Podium {
  const ids = catalog.map((e) => e.manifest.id);
  const order = podiumOrder(ids, chosen, remembered());
  const rows = podiumRows(order.length);
  // T : le bord avant du dessus de chaque marche (en % de la hauteur) ; D : sa profondeur vue d'en haut.
  const first = 36;
  const last = 92;
  const T = rows.map((_, r) => (rows.length === 1 ? last : first + ((last - first) * r) / (rows.length - 1)));
  const D = 6;
  const slots: Slot[] = [];
  rows.forEach((n, r) => {
    const w = WIDTHS[r] ?? 100;
    for (let i = 0; i < n; i++) slots.push({ x: 50 - w / 2 + (w / n) * (i + 0.5), y: T[r] - D * 0.3 });
  });

  const stage = el("div", { class: "podium", role: "group", "aria-label": "Podium des mascottes" });
  stage.style.setProperty("--rows", String(rows.length));
  stage.append(el("div", { class: "podium-ground" }));
  rows.forEach((_, r) => {
    const w = `${WIDTHS[r] ?? 100}%`;
    const top = el("div", { class: `podium-top ${r === 0 ? "first" : ""}` });
    Object.assign(top.style, { width: w, top: `${T[r] - D}%`, height: `${D}%` });
    top.style.setProperty("--inset", r === 0 ? "7%" : "2.6%");
    const face = el("div", { class: `podium-face ${r === 0 ? "first" : ""}` }, r === 0 ? el("span", { class: "podium-rank" }, "1") : null);
    Object.assign(face.style, { width: w, top: `${T[r]}%`, height: `${r < rows.length - 1 ? T[r + 1] - D - T[r] : 98 - T[r]}%` });
    stage.append(top, face);
  });
  const marks = slots.map((s, i) => {
    const m = el("i", { class: `podium-mark ${i === 0 ? "first" : ""}` });
    Object.assign(m.style, { left: `${s.x}%`, top: `${s.y}%` });
    stage.append(m);
    return m;
  });
  const toast = el("div", { class: "podium-toast", "aria-live": "polite" });
  stage.append(toast);

  interface Token {
    entry: CatalogEntry;
    el: HTMLElement;
    box: HTMLElement;
    slot: number;
    renderer: MascotRenderer | null;
    busyUntil: number;
    /** Joue une animation en boucle : à arrêter quand son tour est passé. */
    looping: boolean;
  }
  const tokens = new Map<string, Token>();
  for (const entry of catalog) {
    const name = shortName(entry.manifest.name) + (entry.problems.length ? " (invalide)" : "");
    const box = el("div", { class: "podium-canvas" });
    const t = el(
      "div",
      { class: `podium-token ${entry.problems.length ? "invalid" : ""}`, tabindex: "0", role: "button", "aria-label": name, "data-id": entry.manifest.id, "data-no-i18n": "" },
      el("span", { class: "podium-name" }, name),
      box,
    );
    stage.append(t);
    tokens.set(entry.manifest.id, { entry, el: t, box, slot: 0, renderer: null, busyUntil: 0, looping: false });
  }

  const play = (t: Token, name: string) => {
    const spec = t.entry.manifest.animations.find((a) => a.name === name);
    if (!spec || !t.renderer) return;
    t.renderer.play(spec);
    t.looping = spec.loop && name !== t.entry.manifest.fallback;
  };
  const idle = (t: Token) => play(t, t.entry.manifest.fallback);

  function place() {
    order.forEach((id, slot) => {
      const t = tokens.get(id);
      if (!t) return;
      t.slot = slot;
      t.el.style.left = `${slots[slot].x}%`;
      t.el.style.top = `${slots[slot].y}%`;
      t.el.classList.toggle("first", slot === 0);
      t.el.setAttribute("aria-pressed", String(slot === 0));
    });
  }

  let toastTimer = 0;
  function say(text: string) {
    toast.textContent = text;
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function swap(a: number, b: number) {
    if (a === b) return;
    [order[a], order[b]] = [order[b], order[a]];
    place();
    remember(order);
    if (a !== 0 && b !== 0) return;
    const winner = tokens.get(order[0])!;
    const loser = tokens.get(order[a === 0 ? b : a])!;
    play(winner, "victoire");
    play(loser, "boude");
    winner.busyUntil = performance.now() + 3000;
    loser.busyUntil = performance.now() + 3000;
    say(`${shortName(winner.entry.manifest.name)} vit maintenant dans l'île`);
    onChoose(order[0]);
  }

  // ── Le glisser ──
  let drag: { t: Token; from: number; dx: number; dy: number; moved: boolean } | null = null;
  const slotAt = (px: number, py: number): number => {
    const r = stage.getBoundingClientRect();
    let best = -1;
    let bestD = Infinity;
    slots.forEach((s, i) => {
      const d = Math.hypot(r.left + (s.x / 100) * r.width - px, r.top + (s.y / 100) * r.height - py);
      if (d < bestD) [best, bestD] = [i, d];
    });
    return bestD < r.width * (best === 0 ? 0.16 : 0.09) ? best : -1;
  };
  const tokenOf = (target: EventTarget | null) => {
    const node = (target as HTMLElement | null)?.closest<HTMLElement>(".podium-token");
    return node ? tokens.get(node.dataset.id ?? "") : undefined;
  };
  stage.addEventListener("pointerdown", (e) => {
    const t = tokenOf(e.target);
    if (!t || e.button !== 0) return;
    e.preventDefault();
    t.el.setPointerCapture(e.pointerId);
    t.el.focus({ preventScroll: true });
    const r = stage.getBoundingClientRect();
    const s = slots[t.slot];
    drag = { t, from: t.slot, dx: e.clientX - (r.left + (s.x / 100) * r.width), dy: e.clientY - (r.top + (s.y / 100) * r.height), moved: false };
    t.el.classList.add("dragging");
    play(t, "surprise");
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const r = stage.getBoundingClientRect();
    drag.t.el.style.left = `${((e.clientX - drag.dx - r.left) / r.width) * 100}%`;
    drag.t.el.style.top = `${((e.clientY - drag.dy - r.top) / r.height) * 100}%`;
    drag.moved = true;
    const target = slotAt(e.clientX - drag.dx, e.clientY - drag.dy);
    marks.forEach((m, i) => m.classList.toggle("target", i === target && i !== drag?.from));
  });
  const end = (e: PointerEvent) => {
    if (!drag) return;
    const { t, from, moved } = drag;
    const target = moved ? slotAt(e.clientX - drag.dx, e.clientY - drag.dy) : -1;
    drag = null;
    t.el.classList.remove("dragging");
    marks.forEach((m) => m.classList.remove("target"));
    if (target >= 0 && target !== from) swap(from, target);
    else {
      place();
      idle(t);
    }
  };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
  stage.addEventListener("dblclick", (e) => {
    const t = tokenOf(e.target);
    if (t) swap(t.slot, 0);
  });
  stage.addEventListener("keydown", (e) => {
    const t = tokenOf(e.target);
    if (t && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      swap(t.slot, 0);
    }
  });

  // ── Les humeurs au hasard ──
  let timer = 0;
  function moods() {
    if (!stage.isConnected) return destroy();
    const now = performance.now();
    for (const t of tokens.values()) {
      if (t.el.classList.contains("dragging") || t.busyUntil > now) continue;
      if (t.looping) idle(t);
      if (Math.random() > 0.28) continue;
      const pool = t.slot === 0 && Math.random() < 0.4 ? CHAMPION_MOODS : MOODS;
      play(t, pool[Math.floor(Math.random() * pool.length)]);
      t.busyUntil = now + 2600 + Math.random() * 2500;
    }
  }

  function start() {
    for (const t of tokens.values()) {
      if (t.renderer) continue;
      t.renderer = createRenderer(t.entry.manifest, t.entry.assets);
      t.renderer.mount(t.box);
      t.renderer.onAnimationEnd(() => idle(t));
      idle(t);
    }
    if (!reducedMotion() && !timer) timer = window.setInterval(moods, 1300);
  }

  function destroy() {
    window.clearInterval(timer);
    timer = 0;
    for (const t of tokens.values()) {
      t.renderer?.destroy();
      t.renderer = null;
    }
  }

  place();
  return { el: stage, start, destroy };
}
