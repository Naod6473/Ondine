// Agents IA : le « Bilan du jour » en image, à partager (LinkedIn, Teams…).
//
// « Bilan du jour en image » (onglet Agents IA) ouvre un panneau avec la carte
// (1200 × 675, dessinée deux fois plus fine pour rester nette) : la date, les
// tâches finies par les agents, le temps où ils vous ont attendu, les jetons du
// jour (et leur coût, si vous le voulez), la série de jours d'affilée, le
// rythme de la journée heure par heure, votre mascotte qui pose à droite et,
// en petit dessous, le QR code du site pour télécharger Ondine (site-qr.ts).
// Les chiffres : commande « day_card » (src-tauri/src/modules/agents.rs) ; ce
// que la carte dit : day-card-logic.ts.
//
// Les noms des projets et le coût restent hors de la carte tant que vous ne
// cochez pas leur case : une image partagée part loin. « Copier l'image » la
// met dans le presse-papiers (prête à coller), « Enregistrer » l'écrit dans
// Téléchargements (commande « day_card_export ») : rien n'est envoyé ailleurs.
//
// La mascotte est le vrai moteur (createRenderer), monté dans une boîte de
// 600 px réduite à l'écran : son canvas reste net, et l'export y prend
// l'image du moment.

import { errorText } from "../../core/log";
import { currentLang, t } from "../../core/i18n";
import type { ModuleApi } from "../../core/module-types";
import { settingsStore } from "../../core/settings-store";
import { el } from "../../island/dom";
import { findMascot } from "../../mascot/catalog";
import { createRenderer, type MascotRenderer } from "../../mascot/renderer";
import { focusText } from "../weekly/summary";
import { costText } from "./cost";
import { dayFigures, emptyDay, tiles, type DayCardData, type DayFigures } from "./day-card-logic";
import { SITE_QR } from "./site-qr";
import { tokensShort } from "./texts";

/** La carte, en points (le PNG fait le double). */
const W = 1200;
const H = 675;
const SCALE = 2;
/** La place de la mascotte sur la carte (en points), et la taille de sa boîte à l'écran. */
const MASCOT = { x: 850, y: 210, size: 300 };
const MASCOT_BOX = 600;
/** Le QR code du site, centré sous la mascotte (en points). */
const QR = { cx: MASCOT.x + MASCOT.size / 2, y: 488, size: 112 };
const FONT = `"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif`;

type Theme = "night" | "day";
interface Options {
  theme: Theme;
  projects: boolean;
  cost: boolean;
  mascot: boolean;
}
/** Les choix du panneau, gardés tant que l'appli tourne. */
const options: Options = { theme: "night", projects: false, cost: false, mascot: true };

const PALETTES = {
  night: { bg: ["#0b1430", "#1b1050"], glowA: "rgba(92, 200, 255, 0.35)", glowB: "rgba(185, 140, 255, 0.32)", ink: "#ffffff", soft: "rgba(255, 255, 255, 0.72)", faint: "rgba(255, 255, 255, 0.45)", tile: "rgba(255, 255, 255, 0.08)", line: "rgba(255, 255, 255, 0.16)", bar: "rgba(255, 255, 255, 0.28)", accent: "#5cc8ff" },
  day: { bg: ["#f4f8ff", "#efe8ff"], glowA: "rgba(92, 200, 255, 0.35)", glowB: "rgba(255, 156, 198, 0.30)", ink: "#141a33", soft: "rgba(20, 26, 51, 0.72)", faint: "rgba(20, 26, 51, 0.48)", tile: "rgba(255, 255, 255, 0.72)", line: "rgba(20, 26, 51, 0.10)", bar: "rgba(20, 26, 51, 0.18)", accent: "#1f86e0" },
} as const;

const english = () => currentLang() === "en";
/** « Libellé : valeur », à la française ou à l'anglaise. */
const labelled = (fr: string, value: string) => (english() ? `${t(fr)}: ${value}` : `${fr} : ${value}`);
const hourText = (h: number) => (english() ? `${h}:00` : `${h} h`);

/** « Jeudi 8 octobre 2026 ». */
function dateText(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const s = new Date(y, m - 1, d).toLocaleDateString(english() ? "en-US" : "fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Écrit `text` en réduisant la police s'il dépasse `max` points de large. */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, weight: number, size: number) {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (s > 12 && ctx.measureText(text).width > max) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${FONT}`;
  }
  ctx.fillText(text, x, y);
}

/** La plus grande police (≤ `size`) où chaque texte tient dans `max` points : les tuiles gardent la même. */
function commonSize(ctx: CanvasRenderingContext2D, texts: string[], max: number, weight: number, size: number): number {
  let s = size;
  const fits = () => texts.every((x) => {
    ctx.font = `${weight} ${s}px ${FONT}`;
    return ctx.measureText(x).width <= max;
  });
  while (s > 12 && !fits()) s -= 1;
  return s;
}

/** Dessine la carte (sans la mascotte) dans `canvas`, à la taille du PNG. */
function drawCard(canvas: HTMLCanvasElement, day: string, f: DayFigures, o: Options) {
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  const p = PALETTES[o.theme];

  // Le fond : un dégradé, deux lueurs douces (le verre liquide de l'île).
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, p.bg[0]);
  bg.addColorStop(1, p.bg[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = (x: number, y: number, r: number, c: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c);
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  glow(1010, 360, 420, p.glowA);
  glow(140, 620, 460, p.glowB);

  const left = 64;
  // La colonne de droite reste à la mascotte et au QR code, mascotte cochée ou non.
  const colW = 740;
  ctx.textBaseline = "alphabetic";

  // La date, le titre.
  ctx.fillStyle = p.faint;
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText(dateText(day).toUpperCase(), left, 82);
  ctx.fillStyle = p.ink;
  fitText(ctx, t("Ma journée avec mes agents IA"), left, 142, colW, 700, 52);

  // La phrase d'accroche : la plus longue tâche, l'heure la plus active.
  const hook = [f.longestMinutes >= 1 ? labelled("Plus longue tâche", focusText(f.longestMinutes)) : "", f.busiestHour >= 0 ? labelled("Heure la plus active", hourText(f.busiestHour)) : ""].filter(Boolean).join("   ·   ");
  if (hook) {
    ctx.fillStyle = p.soft;
    fitText(ctx, hook, left, 188, colW, 500, 24);
  }

  // Les tuiles.
  const list = tiles(f, { cost: o.cost }, { duration: focusText, tokens: tokensShort, cost: costText });
  const gap = 16;
  const tileW = (colW - gap * (list.length - 1)) / list.length;
  const tileY = 222;
  const tileH = 150;
  const valueSize = commonSize(ctx, list.map((x) => x.value), tileW - 44, 700, 54);
  const labelSize = commonSize(ctx, list.map((x) => t(x.label)), tileW - 44, 500, 21);
  list.forEach((tile, i) => {
    const x = left + i * (tileW + gap);
    roundRect(ctx, x, tileY, tileW, tileH, 22);
    ctx.fillStyle = p.tile;
    ctx.fill();
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = i === 0 ? p.accent : p.ink;
    fitText(ctx, tile.value, x + 22, tileY + 76, tileW - 44, 700, valueSize);
    ctx.fillStyle = p.soft;
    fitText(ctx, t(tile.label), x + 22, tileY + 112, tileW - 44, 500, labelSize);
    if (tile.note) {
      ctx.fillStyle = p.faint;
      fitText(ctx, tile.note, x + 22, tileY + 136, tileW - 44, 500, 17);
    }
  });

  // Le rythme de la journée : 24 barres, l'heure la plus active en couleur.
  const chartY = 438;
  const chartH = 104;
  ctx.fillStyle = p.faint;
  ctx.font = `600 17px ${FONT}`;
  ctx.fillText(t("Le rythme de la journée").toUpperCase(), left, chartY - 14);
  const max = Math.max(1, ...f.hours);
  const barGap = 6;
  const barW = (colW - barGap * 23) / 24;
  f.hours.forEach((n, h) => {
    const x = left + h * (barW + barGap);
    const bh = n ? Math.max(8, (chartH * n) / max) : 4;
    roundRect(ctx, x, chartY + chartH - bh, barW, bh, Math.min(6, barW / 2));
    ctx.fillStyle = h === f.busiestHour ? p.accent : n ? p.bar : p.line;
    ctx.fill();
  });
  ctx.fillStyle = p.faint;
  ctx.font = `500 15px ${FONT}`;
  for (const h of [0, 6, 12, 18]) ctx.fillText(hourText(h), left + h * (barW + barGap), chartY + chartH + 22);

  // Les projets (case cochée seulement).
  if (o.projects && f.projects.length) {
    ctx.fillStyle = p.soft;
    fitText(ctx, labelled("Projets", f.projects.join(" · ")), left, 598, colW, 500, 21);
  }

  // Le pied : Ondine, et où la trouver.
  ctx.fillStyle = p.faint;
  ctx.font = `500 18px ${FONT}`;
  ctx.fillText(t("Fait avec Ondine · ondine.pissits.com"), left, H - 34);

  drawQr(ctx, p.faint);
}

/** Le QR code du site, en petit sous la mascotte : carrés noirs sur une plaque blanche (lisible sur les deux thèmes). */
function drawQr(ctx: CanvasRenderingContext2D, caption: string) {
  const n = SITE_QR.length;
  const margin = 2;
  const cell = QR.size / (n + 2 * margin);
  const x0 = QR.cx - QR.size / 2;
  roundRect(ctx, x0, QR.y, QR.size, QR.size, 12);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.fillStyle = "#141a33";
  SITE_QR.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      // Un rien plus large que la case : pas de fines lignes claires entre deux carrés.
      if (row[x] === "1") ctx.fillRect(x0 + (x + margin) * cell, QR.y + (y + margin) * cell, cell + 0.3, cell + 0.3);
    }
  });
  ctx.fillStyle = caption;
  ctx.font = `600 16px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(t("Télécharger Ondine"), QR.cx, QR.y + QR.size + 24);
  ctx.textAlign = "left";
}

/** La carte entière (avec la mascotte du moment), en PNG base64. */
function exportPng(card: HTMLCanvasElement, mascot: HTMLCanvasElement | null): string {
  const out = document.createElement("canvas");
  out.width = card.width;
  out.height = card.height;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(card, 0, 0);
  if (mascot && mascot.width && mascot.height) {
    ctx.drawImage(mascot, MASCOT.x * SCALE, MASCOT.y * SCALE, MASCOT.size * SCALE, MASCOT.size * SCALE);
  }
  return out.toDataURL("image/png").split(",")[1];
}

/** La mascotte choisie dans les réglages, qui prend la pose ; null si elle ne peut pas. */
function mountMascot(box: HTMLElement): MascotRenderer | null {
  try {
    const entry = findMascot(String(settingsStore.current.mascot?.id ?? ""));
    if (!entry) return null;
    const r = createRenderer(entry.manifest, entry.assets);
    r.mount(box);
    const anim = (name: string) => entry.manifest.animations.find((a) => a.name === name);
    const idle = anim("idle");
    const pose = anim("fiere") ?? anim("celebrate") ?? idle;
    if (pose) r.play(pose);
    r.onAnimationEnd(() => idle && r.play(idle));
    return r;
  } catch {
    return null;
  }
}

/** Ce que l'onglet reçoit : le bouton qui ouvre le panneau, et le panneau. */
export interface DayCardSection {
  button: HTMLElement;
  box: HTMLElement;
  stop(): void;
}

export function dayCardSection(api: ModuleApi): DayCardSection {
  const box = el("section", { class: "agents-daycard-box" });
  let open = false;
  let mascot: MascotRenderer | null = null;
  let observer: ResizeObserver | null = null;

  const close = () => {
    open = false;
    mascot?.destroy();
    mascot = null;
    observer?.disconnect();
    observer = null;
    box.replaceChildren();
  };

  const show = async () => {
    if (open) return close();
    open = true;
    box.replaceChildren(el("p", { class: "muted" }, "Préparation du bilan…"));
    let data: DayCardData;
    try {
      data = await api.invoke<DayCardData>("day_card", { offsetMinutes: new Date().getTimezoneOffset() });
    } catch (err) {
      if (open) box.replaceChildren(el("p", { class: "muted" }, errorText(err)));
      return;
    }
    if (!open) return;
    const figures = dayFigures(data);
    const card = el("canvas", { class: "agents-daycard-canvas", role: "img", "aria-label": "Aperçu du bilan du jour" });
    const mascotBox = el("div", { class: "agents-daycard-mascot" });
    mascotBox.style.width = mascotBox.style.height = `${MASCOT_BOX}px`;
    const preview = el("div", { class: "agents-daycard-preview" }, card, mascotBox);
    // La boîte de la mascotte garde 600 px (canvas net) et se réduit à l'écran.
    const place = () => {
      const k = preview.clientWidth / W;
      mascotBox.style.transform = `translate(${MASCOT.x * k}px, ${MASCOT.y * k}px) scale(${(MASCOT.size * k) / MASCOT_BOX})`;
    };
    observer = new ResizeObserver(place);
    observer.observe(preview);
    const redraw = () => {
      drawCard(card, data.today, figures, options);
      mascotBox.hidden = !options.mascot;
      if (options.mascot && !mascot) mascot = mountMascot(mascotBox);
      place();
    };
    const check = (key: "projects" | "cost" | "mascot", label: string, title: string) =>
      el(
        "label",
        { class: "agents-daycard-check", title },
        el("input", {
          type: "checkbox",
          ...(options[key] ? { checked: true } : {}),
          onchange: (e: Event) => {
            options[key] = (e.target as HTMLInputElement).checked;
            redraw();
          },
        }),
        el("span", {}, label),
      );
    const themeChip = (theme: Theme, label: string) =>
      el(
        "button",
        {
          class: `net-chip${options.theme === theme ? " on" : ""}`,
          onclick: api.handler(() => {
            options.theme = theme;
            chips.querySelectorAll(".net-chip").forEach((c, i) => c.classList.toggle("on", (i === 0) === (theme === "night")));
            redraw();
          }),
        },
        label,
      );
    const chips = el("div", { class: "net-chips" }, themeChip("night", "Nuit"), themeChip("day", "Jour"));
    const exportAs = async (then: "copy" | "save") => {
      try {
        const png = exportPng(card, options.mascot ? mascotBox.querySelector("canvas") : null);
        const r = await api.invoke<{ name?: string; shelf?: boolean } | null>("day_card_export", { png, then });
        if (then === "copy") {
          api.notify({ title: "Image copiée", body: "Collez-la dans LinkedIn, Teams ou un message (Ctrl+V).", icon: "📋", priority: "low", durationMs: 3500, key: "agents-daycard" });
        } else {
          api.notify({ title: "Image enregistrée", body: r?.name ? `${r.name} · Téléchargements${r.shelf ? " · déposé sur l'étagère" : ""}` : "Dans vos Téléchargements.", icon: "🖼", priority: "low", key: "agents-daycard" });
        }
        api.emit("mascot.emote", { emotion: "celebrate" });
      } catch (err) {
        api.notify({ title: "Image impossible", body: errorText(err), icon: "⚠️", priority: "low", key: "agents-daycard" });
      }
    };
    box.replaceChildren(
      el("div", { class: "agents-files-head" }, el("b", {}, "Bilan du jour"), el("button", { class: "btn small", title: "Fermer le bilan", onclick: api.handler(close) }, "✕")),
      ...(emptyDay(figures) ? [el("p", { class: "muted" }, "Rien de compté aujourd'hui pour l'instant : la carte se remplira avec vos agents.")] : []),
      preview,
      el(
        "div",
        { class: "agents-daycard-options" },
        chips,
        check("mascot", "Mascotte", "Votre mascotte pose sur la carte"),
        check("projects", "Noms des projets", "Montrer les noms des dossiers des projets du jour"),
        ...(figures.tokens ? [check("cost", "Coût estimé", "Ajouter le coût estimé des jetons (grille de prix des réglages)")] : []),
      ),
      el(
        "div",
        { class: "btn-row" },
        el("button", { class: "btn small primary", title: "Copier la carte dans le presse-papiers", onclick: api.handler(() => exportAs("copy")) }, "Copier l'image"),
        el("button", { class: "btn small", title: "Enregistrer la carte en PNG dans vos Téléchargements", onclick: api.handler(() => exportAs("save")) }, "Enregistrer"),
      ),
      el("p", { class: "muted" }, "Calculé sur ce PC, rien n'est envoyé. Les noms des projets et le coût n'apparaissent que si vous les cochez."),
    );
    redraw();
  };

  const button = el("button", { class: "btn small agents-daycard-open", title: "Une carte de votre journée avec les agents, à partager", onclick: api.handler(show) }, "Bilan du jour en image");
  return { button, box, stop: close };
}
