// Le bloc « À propos » de la page Général des réglages :
//   - « Voir les nouveautés » : l'île montre « Quoi de neuf dans Ondine X.Y.Z »,
//     comme après une mise à jour (src/core/whats-new.ts) ;
//   - « Signaler un problème » : ouvre dans le navigateur une issue GitHub
//     préremplie (version, Windows, 40 dernières lignes du journal avec les
//     chemins personnels masqués). Rien ne part sans la personne : elle relit
//     tout sur GitHub avant d'envoyer (src-tauri/src/diagnostics.rs) ;
//   - ce qu'Ondine consomme : mémoire et processeur de son processus et de ses
//     processus WebView2, rafraîchis toutes les 2 s, seulement tant que ce bloc
//     est affiché et que la fenêtre est visible.

import { Bridge, IS_TAURI, type SelfUsage } from "../core/bridge";
import { demoOn } from "../core/demo";
import { errorText } from "../core/log";
import { el } from "../island/dom";
import { group, row, wideRow } from "./controls";

const REFRESH_MS = 2000;

/** 96 468 992 octets → « 92 Mo ». */
function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} Mo`;
}

/** « 92 Mo · 0,4 % du processeur · 6 processus ». */
export function usageText(u: SelfUsage): string {
  const cpu = u.cpuPercent == null ? "…" : u.cpuPercent.toFixed(1).replace(".", ",");
  return `${megabytes(u.memoryBytes)} · ${cpu} % du processeur · ${u.processes} processus`;
}

/** Mode démo : des chiffres inventés, plausibles, qui bougent un peu. */
function demoUsage(): SelfUsage {
  return { memoryBytes: (88 + Math.random() * 6) * 1024 * 1024, cpuPercent: 0.2 + Math.random() * 0.4, processes: 6 };
}

/** `whatsNew` : demande à l'île de montrer « Quoi de neuf » (sujet « app.whats-new », voir core/whats-new.ts). */
export function aboutGroup(whatsNew: () => void): HTMLElement {
  // ── Version ──
  const version = el("span", { class: "muted" }, "…");
  void Bridge.boot().then((b) => (version.textContent = b ? `Ondine ${b.version}` : "Ondine"));
  // ── Nouveautés : la même notification qu'après une mise à jour ──
  const news = el("button", { class: "btn small", onclick: whatsNew }, "Voir les nouveautés");

  // ── Signaler un problème ──
  const status = el("span", { class: "muted", "aria-live": "polite" }, "");
  const report = el(
    "button",
    {
      class: "btn small",
      onclick: async () => {
        status.textContent = "";
        try {
          await Bridge.bugReportOpen();
          status.textContent = "Page ouverte dans votre navigateur : relisez tout avant d'envoyer.";
        } catch (err) {
          status.textContent = errorText(err);
        }
      },
    },
    "Signaler un problème",
  );

  // ── Ressources ──
  const usage = el("span", { class: "muted", "aria-live": "off" }, "…");
  const refresh = async () => {
    const u = demoOn() ? demoUsage() : await Bridge.selfUsage();
    if (u) usage.textContent = usageText(u);
    else if (!IS_TAURI) usage.textContent = "Disponible dans l'appli seulement.";
  };
  // Dès que le bloc quitte la page (autre page des réglages), on arrête.
  const timer = window.setInterval(() => {
    if (!usage.isConnected) return window.clearInterval(timer);
    if (document.visibilityState === "visible") void refresh();
  }, REFRESH_MS);
  requestAnimationFrame(() => void refresh());

  return group(
    "À propos",
    [
      row("Version", version, "La version installée de cette copie d'Ondine."),
      row("Nouveautés", news, "Ce qui a changé dans cette version, comme après une mise à jour : la notification s'affiche dans l'île."),
      wideRow(
        "Signaler un problème",
        el("div", { class: "chips" }, report, status),
        "Ouvre GitHub avec la version, Windows et les 40 dernières lignes du journal (chemins personnels masqués). Vous relisez et complétez tout avant d'envoyer : rien ne part sans vous.",
      ),
      row(
        "Ressources utilisées",
        usage,
        "Mémoire et processeur d'Ondine et de ses fenêtres (WebView2). Mesuré seulement pendant que cette page est ouverte.",
      ),
    ],
  );
}
