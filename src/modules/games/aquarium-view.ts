// L'aquarium de gouttes (vrai jeu « idle ») : la vue de l'onglet Jeux.
//
// L'aquarium grandit tout seul pendant que vous travaillez : chaque tâche finie
// par un agent IA, chaque vraie pause, chaque Pomodoro mené au bout et chaque
// partie gagnée rapporte des gouttes (games.rs, barème d'aquarium.json, 150
// au plus par jour). On les dépense en décors et en accessoires pour Ondine :
// ceux que la famille gomme sait déjà porter (casquette, nœud, lunettes,
// écharpe… gum-draw.ts). Aucune notification : seulement le nombre qui monte
// dans l'onglet (et une petite bulle « +5 » quand on le regarde).
//
// Le dessin : un canvas (l'eau, les rayons, le sable, les décors achetés, les
// petites gouttes qui nagent, les bulles) et, par-dessus, Ondine elle-même
// (GumEngine, le moteur de la goutte gomme, avec la tenue de l'aquarium).
// Plus l'aquarium a gagné de gouttes, plus il est large et peuplé (niveaux 1
// à 6). La boucle de dessin est celle de l'appli (core/perf.ts frameLoop :
// arrêtée île cachée, 30 images/s en économie). « Réduire les animations » :
// une image fixe. « Calme » : tout nage deux fois moins vite, moins de bulles.

import { el } from "../../island/dom";
import { frameLoop, perfMode, setText } from "../../core/perf";
import { settingsStore } from "../../core/settings-store";
import { calmMode } from "../../mascot/mascot-state";
import { findMascot } from "../../mascot/catalog";
import { APP_GUM_ENV } from "../../mascot/renderers/gum";
import { GumEngine } from "../../mascot/renderers/gum-engine";
import type { EyeWear, HeadWear, NeckWear } from "../../mascot/renderers/gum-draw";
import type { AnimationSpec, MascotManifest } from "../../mascot/types";
import { reducedMotion } from "../../island/tab-pill";
import { DAILY_CAP, ITEMS, stageOf, toNextStage, type AquaState, type Item, type WearSlot } from "./aquarium-logic";
import { wobble } from "./jelly-drop";
import type { Kit } from "./kit";

/** La largeur de l'aquarium à chaque niveau (part de la place disponible). */
const STAGE_WIDTH = [58, 66, 74, 82, 91, 100];

function spec(m: MascotManifest, name: string): AnimationSpec {
  return m.animations.find((a) => a.name === name) ?? m.animations.find((a) => a.name === "idle")!;
}

interface Bubble {
  x: number;
  y: number;
  r: number;
  speed: number;
  phase: number;
}

/** Monte l'aquarium dans `root`. */
export function mountAquarium(root: HTMLElement, kit: Kit): () => void {
  const store = kit.store;
  const drops = el("span", { class: "aqua-drops" });
  const stage = el("span", { class: "aqua-stage" });
  const next = el("span", { class: "aqua-next muted" });
  const toast = el("span", { class: "aqua-toast", "aria-hidden": "true" });
  const canvas = el("canvas", { class: "aqua-canvas", "aria-hidden": "true" });
  const ondine = el("div", { class: "aqua-ondine" });
  const tank = el("div", { class: "aqua-tank", role: "img", "aria-label": "L'aquarium d'Ondine" }, canvas, ondine, toast);
  const decor = el("div", { class: "aqua-chips" });
  const wear = el("div", { class: "aqua-chips" });
  const toIsland = el("button", { class: "btn small", title: "Ondine garde cette tenue dans l'île", onclick: kit.api.handler(() => wearInIsland()) }, "Porter dans l'île");
  const problem = el("span", { class: "aqua-problem", "aria-live": "polite" });
  root.append(
    el(
      "div",
      { class: "aqua", "data-island-fit": "" },
      el("div", { class: "aqua-head" }, drops, stage, next),
      el("div", { class: "aqua-stage-row" }, tank),
      el("div", { class: "aqua-row" }, el("span", { class: "aqua-label" }, "Décors"), decor),
      el("div", { class: "aqua-row" }, el("span", { class: "aqua-label" }, "Pour Ondine"), wear, toIsland),
      el("div", { class: "aqua-how muted" }, problem, `Les tâches finies par vos agents, vos pauses, vos Pomodoros et vos victoires remplissent l'aquarium (${DAILY_CAP} gouttes par jour au plus).`),
    ),
  );

  // ── Ondine dans l'aquarium, avec la tenue de l'aquarium ──
  const entry = findMascot(settingsStore.current.mascot.id || "goutte-gomme");
  const manifest = entry && entry.manifest.renderer === "gum" ? entry.manifest : findMascot("goutte-gomme")?.manifest ?? null;
  let engine: GumEngine | null = null;
  if (manifest && manifest.renderer === "gum") {
    engine = new GumEngine(manifest, {
      ...APP_GUM_ENV,
      prefs: () => {
        const w = store.state.wear;
        return { ...APP_GUM_ENV.prefs(), wear: { head: w.head as HeadWear, eyes: w.eyes as EyeWear, neck: w.neck as NeckWear } };
      },
      onPrefsChange: (fn) => {
        const a = APP_GUM_ENV.onPrefsChange(fn);
        const b = store.onChange(() => fn());
        return () => (a(), b());
      },
    });
    engine.mount(ondine);
    engine.onAnimationEnd(() => engine?.play(spec(manifest, "idle")));
    engine.play(spec(manifest, "idle"));
  }
  const ondinePlays = (name: string) => manifest && engine?.play(spec(manifest, name));

  // ── Le magasin ──
  const chip = (item: Item, s: AquaState) => {
    const owned = s.owned.includes(item.id);
    if (item.kind === "decor") {
      return el(
        "button",
        {
          class: `aqua-chip${owned ? " owned" : ""}`,
          disabled: owned,
          title: owned ? "Dans l'aquarium" : s.drops < item.price ? "Pas assez de gouttes" : `Acheter pour ${item.price} gouttes`,
          onclick: kit.api.handler(() => buyItem(item)),
        },
        owned ? `✓ ${item.name}` : item.name,
        owned ? null : el("span", { class: "aqua-price" }, `${item.price} 💧`),
      );
    }
    const worn = s.wear[item.kind as WearSlot] === item.id;
    return el(
      "button",
      {
        class: `aqua-chip${owned ? " owned" : ""}${worn ? " worn" : ""}`,
        "aria-pressed": owned ? String(worn) : undefined,
        title: !owned ? (s.drops < item.price ? "Pas assez de gouttes" : `Acheter pour ${item.price} gouttes`) : worn ? "Retirer" : "Mettre",
        onclick: kit.api.handler(() => (owned ? void store.wear(item.kind as WearSlot, worn ? "none" : item.id) : buyItem(item))),
      },
      item.name,
      owned ? null : el("span", { class: "aqua-price" }, `${item.price} 💧`),
    );
  };

  const buyItem = async (item: Item) => {
    const err = await store.buy(item.id);
    setText(problem, err ? `${err}. ` : "");
    if (err) return;
    kit.sound("coin");
    ondinePlays(item.kind === "decor" ? "happy" : "fiere");
    // (Le Rust publie « games.changed » : le magasin se redessine.)
    await store.refresh();
  };

  /** La tenue de l'aquarium devient celle de l'île (Réglages → Mascotte). */
  const wearInIsland = () => {
    const w = store.state.wear;
    void settingsStore.update((d) => {
      d.mascot.wearHead = w.head;
      d.mascot.wearEyes = w.eyes;
      d.mascot.wearNeck = w.neck;
    });
    kit.emote("proud");
  };

  let shownStage = 0;
  const paint = (s: AquaState, gained: number) => {
    setText(drops, `${s.drops} 💧`);
    drops.setAttribute("aria-label", `${s.drops} gouttes`);
    const st = stageOf(s.earned);
    setText(stage, `Niveau ${st}`);
    const left = toNextStage(s.earned);
    setText(next, left === null ? "Aquarium au complet" : `Encore ${left} gouttes pour grandir`);
    tank.style.width = `${STAGE_WIDTH[st - 1]}%`;
    if (shownStage && st > shownStage) {
      wobble(tank, 0.5);
      ondinePlays("bras-leves");
    }
    shownStage = st;
    decor.replaceChildren(...ITEMS.filter((i) => i.kind === "decor").map((i) => chip(i, s)));
    wear.replaceChildren(...ITEMS.filter((i) => i.kind !== "decor").map((i) => chip(i, s)));
    const m = settingsStore.current.mascot;
    toIsland.hidden = s.wear.head === (m.wearHead ?? "none") && s.wear.eyes === (m.wearEyes ?? "none") && s.wear.neck === (m.wearNeck ?? "none");
    if (gained > 0) {
      toast.textContent = `+${gained}`;
      toast.classList.remove("show");
      void toast.offsetWidth; // repart de zéro
      toast.classList.add("show");
    }
    dirty = true;
  };

  // ── Le dessin ──
  const ctx = canvas.getContext("2d");
  const bubbles: Bubble[] = [];
  /** Vrai : quelque chose a changé (avec « Réduire les animations », on ne redessine qu'alors). */
  let dirty = true;
  const t0 = performance.now();
  let lastFrame = t0;
  let swim = 0; // le temps de l'aquarium (plus lent en Calme)
  const draw = (now: number) => {
    if (!ctx) return;
    const reduced = reducedMotion();
    if (reduced && !dirty) return; // image fixe : rien à redessiner tant que rien ne change
    dirty = false;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    swim += reduced ? 0 : dt * (calmMode() ? 0.5 : 1);
    const t = swim;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const s = store.state;
    const owned = new Set(s.owned);
    drawWater(ctx, w, h, t);
    drawSand(ctx, w, h);
    drawDecor(ctx, w, h, t, owned);
    // Les petites gouttes qui nagent : une par niveau, et l'amie achetée.
    const st = stageOf(s.earned);
    for (let i = 0; i < st; i++) drawFish(ctx, w, h, t, i, FISH_COLORS[i % FISH_COLORS.length], 1);
    if (owned.has("amie")) drawFish(ctx, w, h, t * 0.8, 7, "#ff8fc0", 1.35);
    // Les bulles (moins en Calme et en économie, aucune en animations réduites).
    const wanted = reduced ? 0 : (calmMode() ? 4 : 9) * (perfMode() === "eco" ? 0.5 : 1);
    while (bubbles.length < wanted) bubbles.push({ x: Math.random(), y: 1 + Math.random() * 0.6, r: 1.5 + Math.random() * 2.6, speed: 0.12 + Math.random() * 0.16, phase: Math.random() * 6 });
    bubbles.length = Math.min(bubbles.length, Math.ceil(wanted));
    for (const b of bubbles) {
      b.y -= b.speed * dt * (calmMode() ? 0.5 : 1);
      if (b.y < -0.05) Object.assign(b, { x: owned.has("coffre") && Math.random() < 0.4 ? 0.42 : Math.random(), y: 0.95, phase: Math.random() * 6 });
      const x = b.x * w + Math.sin(t * 2 + b.phase) * 3;
      ctx.beginPath();
      ctx.arc(x, b.y * h, b.r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Ondine nage doucement d'un bout à l'autre (une courbe de Lissajous).
    const ox = reduced ? 0.5 : 0.5 + 0.3 * Math.sin(t * 0.21);
    const oy = reduced ? 0.42 : 0.4 + 0.1 * Math.sin(t * 0.47 + 1);
    const size = ondine.offsetWidth || 46;
    ondine.style.transform = `translate(${(ox * w - size / 2).toFixed(1)}px, ${(oy * h - size / 2).toFixed(1)}px) rotate(${reduced ? 0 : (Math.cos(t * 0.21) * 6).toFixed(2)}deg)`;
  };

  const stops = [store.onChange(paint), frameLoop(canvas, draw)];
  paint(store.state, 0);
  void store.refresh();
  return () => {
    for (const s of stops) s();
    engine?.destroy();
  };
}

const FISH_COLORS = ["#7cc4ff", "#ffd36b", "#9ef0c0", "#c9a6ff", "#ffa98a", "#8fe3ff"];

function drawWater(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgba(96, 190, 255, 0.42)");
  g.addColorStop(1, "rgba(24, 74, 160, 0.62)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Trois rayons de lumière qui se balancent.
  for (let i = 0; i < 3; i++) {
    const x = w * (0.2 + i * 0.3) + Math.sin(t * 0.3 + i) * 12;
    ctx.beginPath();
    ctx.moveTo(x - 10, 0);
    ctx.lineTo(x + 14, 0);
    ctx.lineTo(x + 48, h);
    ctx.lineTo(x + 8, h);
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
    ctx.fill();
  }
  // La surface qui ondule.
  ctx.beginPath();
  for (let x = 0; x <= w; x += 6) ctx.lineTo(x, 3 + Math.sin(x / 22 + t * 1.4) * 1.6);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function drawSand(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const top = h * 0.84;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 8) ctx.lineTo(x, top + Math.sin(x / 37) * 3);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = "rgba(240, 214, 160, 0.85)";
  ctx.fill();
}

/** Les décors achetés, chacun à sa place. */
function drawDecor(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, owned: Set<string>) {
  const floor = h * 0.86;
  if (owned.has("algues")) {
    for (const [x, n] of [[0.07, 3], [0.93, 2]] as const) {
      for (let k = 0; k < n; k++) {
        const bx = w * x + k * 7;
        ctx.beginPath();
        ctx.moveTo(bx, floor);
        const sway = Math.sin(t * 0.9 + k + x * 9) * 6;
        ctx.bezierCurveTo(bx + sway, floor - h * 0.25, bx - sway, floor - h * 0.4, bx + sway * 0.6, floor - h * (0.5 + k * 0.06));
        ctx.strokeStyle = "rgba(80, 200, 120, 0.9)";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }
  }
  if (owned.has("corail")) {
    const x = w * 0.2;
    ctx.strokeStyle = "rgba(255, 120, 150, 0.95)";
    ctx.lineWidth = 3.2;
    ctx.lineCap = "round";
    for (const [dx, hh] of [[-8, 0.26], [0, 0.34], [8, 0.24]] as const) {
      ctx.beginPath();
      ctx.moveTo(x, floor);
      ctx.quadraticCurveTo(x + dx * 0.4, floor - h * hh * 0.5, x + dx, floor - h * hh);
      ctx.stroke();
    }
  }
  if (owned.has("coquillage")) {
    const x = w * 0.31;
    ctx.beginPath();
    ctx.moveTo(x - 9, floor);
    ctx.arc(x, floor, 9, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = "#ffd9c2";
    ctx.fill();
    ctx.strokeStyle = "rgba(200, 120, 90, 0.6)";
    ctx.lineWidth = 1;
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath();
      ctx.moveTo(x, floor);
      ctx.lineTo(x + k * 4, floor - 8);
      ctx.stroke();
    }
  }
  if (owned.has("coffre")) {
    const x = w * 0.42;
    const open = Math.max(0, Math.sin(t * 0.5)) * 0.5;
    ctx.fillStyle = "#a8743e";
    ctx.fillRect(x - 12, floor - 12, 24, 12);
    ctx.save();
    ctx.translate(x - 12, floor - 12);
    ctx.rotate(-open);
    ctx.fillStyle = "#c48a4c";
    ctx.fillRect(0, -6, 24, 6);
    ctx.restore();
    ctx.fillStyle = "#ffd36b";
    ctx.fillRect(x - 2, floor - 9, 4, 4);
  }
  if (owned.has("etoile")) {
    const x = w * 0.53;
    const y = floor - 3;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 3.2 : 8;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = "#ff9d5c";
    ctx.fill();
  }
  if (owned.has("phare")) {
    const x = w * 0.63;
    const top = floor - h * 0.42;
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = k % 2 ? "#ffffff" : "#ff6b6b";
      const y0 = floor - ((k + 1) * (floor - top)) / 4;
      const half = 6 - k * 0.8;
      ctx.fillRect(x - half, y0, half * 2, (floor - top) / 4 + 0.5);
    }
    // Sa lumière tourne.
    const beam = Math.sin(t * 0.8);
    ctx.beginPath();
    ctx.moveTo(x, top - 3);
    ctx.lineTo(x + beam * 60, top - 14);
    ctx.lineTo(x + beam * 60, top + 8);
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 240, 160, 0.25)";
    ctx.fill();
    ctx.fillStyle = "#ffe48a";
    ctx.beginPath();
    ctx.arc(x, top - 3, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (owned.has("galets")) {
    for (const [dx, rx, c] of [[0, 9, "#b9c0cc"], [12, 6, "#9aa3b2"], [-10, 5, "#cfd5de"]] as const) {
      ctx.beginPath();
      ctx.ellipse(w * 0.73 + dx, floor + 1, rx, rx * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    }
  }
  if (owned.has("chateau")) {
    const x = w * 0.83;
    const top = floor - h * 0.3;
    ctx.fillStyle = "#c9ccd6";
    ctx.fillRect(x - 16, top, 32, floor - top);
    ctx.fillRect(x - 20, top - 10, 9, floor - top + 10);
    ctx.fillRect(x + 11, top - 10, 9, floor - top + 10);
    ctx.fillStyle = "rgba(40, 50, 80, 0.7)";
    ctx.beginPath();
    ctx.arc(x, floor, 6, Math.PI, 0);
    ctx.fill();
  }
}

/** Une petite goutte qui nage (son propre chemin selon `i`). */
function drawFish(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, i: number, color: string, scale: number) {
  const speed = 0.12 + (i % 3) * 0.04;
  const p = (t * speed + i * 0.37) % 2;
  const dir = p < 1 ? 1 : -1;
  const x = (dir > 0 ? p : 2 - p) * (w - 20) + 10;
  const y = h * (0.2 + ((i * 0.17) % 0.5)) + Math.sin(t * 1.3 + i) * 5;
  const r = 4.2 * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  // Le corps (une goutte couchée, la pointe derrière) et un œil.
  ctx.beginPath();
  ctx.moveTo(-r * 2.1, 0);
  ctx.quadraticCurveTo(-r * 0.6, -r * 1.2, r * 0.4, -r);
  ctx.arc(r * 0.4, 0, r, -Math.PI / 2, Math.PI / 2);
  ctx.quadraticCurveTo(-r * 0.6, r * 1.2, -r * 2.1, 0);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = "rgba(20, 30, 50, 0.85)";
  ctx.beginPath();
  ctx.arc(r * 0.7, -r * 0.2, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
