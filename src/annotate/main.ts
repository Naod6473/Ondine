// La fenêtre d'annotation : dessiner rapidement sur une capture (flèche,
// rectangle, crayon, surligneur, texte), puis la copier, l'enregistrer ou la
// poser sur l'étagère.
//
// L'image vient du module Capture (commande "annotate_image") ; l'image finie y
// retourne en PNG ("annotate_export"), et c'est le Rust qui écrit le fichier.
//
// Les annotations sont gardées comme une liste de formes (pas comme des pixels) :
// « Annuler » retire simplement la dernière forme, et on redessine tout.

import { Bridge, IS_TAURI, onTauriEvent } from "../core/bridge";
import { errorText } from "../core/log";
import { el } from "../island/dom";
import { reducedMotion, TabPill } from "../island/tab-pill";

type Tool = "arrow" | "rect" | "pen" | "marker" | "text";
type Point = { x: number; y: number };

interface Shape {
  tool: Tool;
  color: string;
  /** Épaisseur en pixels de l'image. */
  width: number;
  points: Point[];
  text?: string;
}

const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: "arrow", icon: "➚", label: "Flèche", key: "a" },
  { id: "rect", icon: "▭", label: "Rectangle", key: "r" },
  { id: "pen", icon: "✎", label: "Crayon", key: "p" },
  { id: "marker", icon: "▮", label: "Surligneur", key: "h" },
  { id: "text", icon: "T", label: "Texte", key: "t" },
];
const COLORS = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#0a84ff", "#ffffff", "#111111"];
const SIZES = [
  { id: 1, label: "Fin" },
  { id: 2, label: "Moyen" },
  { id: 3.5, label: "Épais" },
];

// ── État ─────────────────────────────────────────────────────────────────────

let image: HTMLImageElement | null = null;
let shapes: Shape[] = [];
/** Formes retirées par « Annuler », pour « Rétablir ». */
let undone: Shape[] = [];
let drawing: Shape | null = null;
let tool: Tool = "arrow";
let color = COLORS[0];
let size = 2;
let busy = false;

// ── Interface ────────────────────────────────────────────────────────────────

const app = document.getElementById("app")!;
const canvas = el("canvas", { class: "board" });
const ctx = canvas.getContext("2d")!;
const stage = el("div", { class: "stage" }, canvas);
const empty = el("p", { class: "empty" }, "Aucune image. Dans l'onglet Capture de l'île, choisis « ✏️ Annoter ».");
const toast = el("div", { class: "toast" });

function group(...children: HTMLElement[]) {
  return el("div", { class: "group" }, ...children);
}

const toolButtons = new Map<Tool, HTMLElement>();
const toolGroup = group(
  ...TOOLS.map((t) => {
    const b = el("button", { class: "tool", title: `${t.label} (${t.key.toUpperCase()})`, onclick: () => setTool(t.id) }, t.icon);
    toolButtons.set(t.id, b);
    return b;
  }),
);
const toolPill = new TabPill(toolGroup);

const swatches = COLORS.map((c) =>
  el("button", { class: "swatch", title: "Couleur", style: `--c: ${c}`, onclick: () => setColor(c) }),
);
const sizeButtons = SIZES.map((s) =>
  el("button", { class: "size", title: s.label, onclick: () => setSize(s.id) }, el("i", { style: `--s: ${3 + s.id * 3}px` })),
);

const toolbar = el(
  "div",
  { class: "toolbar" },
  toolGroup,
  group(...swatches),
  group(...sizeButtons),
  group(
    el("button", { class: "tool", title: "Annuler (Ctrl+Z)", onclick: undo }, "↶"),
    el("button", { class: "tool", title: "Rétablir (Ctrl+Y)", onclick: redo }, "↷"),
  ),
  el("span", { class: "spacer" }),
  el("button", { class: "action", title: "Copier l'image (Ctrl+C)", onclick: () => void finish("copy") }, "📋 Copier"),
  el("button", { class: "action", title: "Enregistrer en PNG (Ctrl+S)", onclick: () => void finish("save") }, "💾 Enregistrer"),
  el("button", { class: "action", title: "Enregistrer et poser sur l'étagère", onclick: () => void finish("shelf") }, "🧺 Étagère"),
  el("button", { class: "action ghost", title: "Fermer (Échap)", onclick: close }, "Fermer"),
);
app.append(toolbar, stage, toast);

function setTool(t: Tool) {
  tool = t;
  for (const [id, b] of toolButtons) b.classList.toggle("active", id === t);
  toolPill.moveTo(toolButtons.get(t)!);
  canvas.dataset.tool = t;
}

function setColor(c: string) {
  color = c;
  swatches.forEach((s, i) => s.classList.toggle("active", COLORS[i] === c));
}

function setSize(s: number) {
  size = s;
  sizeButtons.forEach((b, i) => b.classList.toggle("active", SIZES[i].id === s));
}

/** Un petit message en bas, qui apparaît et disparaît en douceur. */
function say(text: string, error = false) {
  toast.textContent = text;
  toast.classList.toggle("error", error);
  toast.classList.remove("show");
  void toast.offsetWidth; // relance l'animation
  toast.classList.add("show");
}

// ── Chargement de l'image ────────────────────────────────────────────────────

async function load() {
  shapes = [];
  undone = [];
  try {
    const r = await Bridge.moduleInvoke<{ url: string }>("capture", "annotate_image", null);
    const img = new Image();
    img.src = r.url;
    await img.decode();
    image = img;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    empty.remove();
    fit();
    redraw();
    if (!reducedMotion()) {
      canvas.animate(
        [
          { opacity: 0, transform: "scale(0.96)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 420, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    }
  } catch (err) {
    image = null;
    if (IS_TAURI) say(errorText(err), true);
    stage.append(empty);
  }
}

/** Taille d'affichage : l'image entière visible, sans l'agrandir au-delà de 100 %. */
function fit() {
  if (!image) return;
  const box = stage.getBoundingClientRect();
  const scale = Math.min(1, (box.width - 32) / image.naturalWidth, (box.height - 32) / image.naturalHeight);
  canvas.style.width = `${Math.round(image.naturalWidth * scale)}px`;
  canvas.style.height = `${Math.round(image.naturalHeight * scale)}px`;
}

// ── Dessin ───────────────────────────────────────────────────────────────────

/** Épaisseur de base : proportionnelle à l'image (une capture 4K a besoin de traits plus épais). */
function baseWidth(): number {
  return image ? Math.max(2, Math.round(Math.max(image.naturalWidth, image.naturalHeight) / 500)) : 2;
}

function redraw(target = ctx) {
  const c = target.canvas;
  target.clearRect(0, 0, c.width, c.height);
  if (image) target.drawImage(image, 0, 0);
  for (const s of shapes) drawShape(target, s);
  if (drawing && target === ctx) drawShape(target, drawing);
}

function drawShape(g: CanvasRenderingContext2D, s: Shape) {
  g.save();
  g.strokeStyle = s.color;
  g.fillStyle = s.color;
  g.lineWidth = s.width;
  g.lineCap = "round";
  g.lineJoin = "round";
  const [a, b] = [s.points[0], s.points[s.points.length - 1]];
  switch (s.tool) {
    case "rect": {
      g.beginPath();
      g.roundRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y), s.width * 1.5);
      g.stroke();
      break;
    }
    case "arrow": {
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const head = Math.max(12, s.width * 4);
      // Le trait s'arrête sous la pointe, pour qu'elle reste nette.
      const end = { x: b.x - Math.cos(angle) * head * 0.6, y: b.y - Math.sin(angle) * head * 0.6 };
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(end.x, end.y);
      g.stroke();
      g.beginPath();
      g.moveTo(b.x, b.y);
      g.lineTo(b.x - head * Math.cos(angle - 0.45), b.y - head * Math.sin(angle - 0.45));
      g.lineTo(b.x - head * Math.cos(angle + 0.45), b.y - head * Math.sin(angle + 0.45));
      g.closePath();
      g.fill();
      break;
    }
    case "pen":
    case "marker": {
      if (s.tool === "marker") {
        g.globalAlpha = 0.35;
        g.lineWidth = s.width * 5;
        g.lineCap = "square";
      }
      g.beginPath();
      s.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
      break;
    }
    case "text": {
      const px = Math.round(s.width * 5 + 12);
      g.font = `600 ${px}px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`;
      g.textBaseline = "top";
      // Un contour sombre discret : le texte reste lisible sur tout fond.
      g.lineWidth = Math.max(2, px / 7);
      g.strokeStyle = s.color === "#111111" ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.55)";
      (s.text ?? "").split("\n").forEach((line, i) => {
        g.strokeText(line, a.x, a.y + i * px * 1.2);
        g.fillText(line, a.x, a.y + i * px * 1.2);
      });
      break;
    }
  }
  g.restore();
}

/** Position de la souris en pixels de l'image. */
function toImage(e: PointerEvent): Point {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
}

canvas.addEventListener("pointerdown", (e) => {
  if (!image || e.button !== 0) return;
  if (tool === "text") return startText(e);
  canvas.setPointerCapture(e.pointerId);
  drawing = { tool, color, width: size * baseWidth(), points: [toImage(e)] };
});
canvas.addEventListener("pointermove", (e) => {
  if (!drawing) return;
  const p = toImage(e);
  if (drawing.tool === "pen" || drawing.tool === "marker") drawing.points.push(p);
  else drawing.points[1] = p;
  redraw();
});
canvas.addEventListener("pointerup", () => {
  if (!drawing) return;
  // Un simple clic (aucun mouvement) ne laisse rien.
  if (drawing.points.length > 1) {
    shapes.push(drawing);
    undone = [];
  }
  drawing = null;
  redraw();
});

/** Outil texte : un champ apparaît là où on clique ; Entrée valide, Échap annule. */
function startText(e: PointerEvent) {
  // Sans ça, le clic redonne aussitôt le focus à la page et le champ se ferme.
  e.preventDefault();
  const at = toImage(e);
  const r = canvas.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  const width = size * baseWidth();
  const displayPx = (width * 5 + 12) * (r.width / canvas.width);
  const input = el("input", {
    class: "text-input",
    type: "text",
    placeholder: "Texte…",
    style: `left:${e.clientX - s.left}px; top:${e.clientY - s.top}px; color:${color}; font-size:${Math.max(12, displayPx)}px`,
  });
  stage.append(input);
  requestAnimationFrame(() => input.focus());
  let done = false;
  const commit = (keep: boolean) => {
    if (done) return;
    done = true;
    if (keep && input.value.trim()) {
      shapes.push({ tool: "text", color, width, points: [at], text: input.value });
      undone = [];
      redraw();
    }
    input.remove();
  };
  input.addEventListener("keydown", (k) => {
    k.stopPropagation();
    if (k.key === "Enter") commit(true);
    if (k.key === "Escape") commit(false);
  });
  input.addEventListener("blur", () => commit(true));
}

function undo() {
  const s = shapes.pop();
  if (s) undone.push(s);
  redraw();
}

function redo() {
  const s = undone.pop();
  if (s) shapes.push(s);
  redraw();
}

// ── Fin : copier, enregistrer, étagère ───────────────────────────────────────

async function finish(then: "copy" | "save" | "shelf") {
  if (!image || busy) return;
  busy = true;
  try {
    // On redessine à pleine taille (sans la forme en cours) puis on exporte.
    redraw();
    const png = canvas.toDataURL("image/png").split(",")[1];
    await Bridge.moduleInvoke("capture", "annotate_export", { png, then });
    say(then === "copy" ? "Image copiée" : then === "shelf" ? "Posée sur l'étagère" : "Enregistrée");
    window.setTimeout(close, 650);
  } catch (err) {
    say(errorText(err), true);
  } finally {
    busy = false;
  }
}

function close() {
  void Bridge.windowHide();
}

// ── Clavier ──────────────────────────────────────────────────────────────────

window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "INPUT") return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === "z") return undo();
  if (e.ctrlKey && k === "y") return redo();
  if (e.ctrlKey && k === "c") return void finish("copy");
  if (e.ctrlKey && k === "s") {
    e.preventDefault();
    return void finish("save");
  }
  if (e.key === "Escape") return close();
  const t = TOOLS.find((t) => t.key === k);
  if (t && !e.ctrlKey && !e.altKey) setTool(t.id);
});

// ── Démarrage ────────────────────────────────────────────────────────────────

window.addEventListener("resize", fit);
setColor(color);
setSize(size);
setTool(tool);
requestAnimationFrame(() => toolPill.jumpTo(toolButtons.get(tool)!));
// L'île demande d'annoter une nouvelle image : on la recharge.
void onTauriEvent("annotate-load", () => void load());
void load();
