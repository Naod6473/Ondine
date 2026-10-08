// Le calendrier de contributions GitHub de l'onglet Agents IA : la grille
// 53 × 7 du profil (mois en haut, Lun / Mer / Ven à gauche), cinq niveaux
// tirés de la couleur d'accent de l'île, une vague d'allumage au premier
// affichage de la session, et la case du jour qui pulse tant qu'elle est vide.
//
// Les données viennent du Rust (`github_calendar`, modules/agents_github.rs) :
// au plus une demande toutes les 30 minutes ; « ↻ » relit (ou dit « déjà à
// jour »). Rien ne s'affiche tant que le réglage « Identifiant GitHub » est
// vide. La logique pure (textes, colonnes, série) est dans github-logic.ts.
//
// Série : à 7, 30 et 100 jours d'affilée, une fois par palier et par série,
// la vue publie `agents.github-streak` ; src/eggs/eggs.ts fait fêter la
// mascotte et range un trésor dans le carnet.

import type { ModuleApi } from "../../core/module-types";
import { demoOn } from "../../core/demo";
import { errorText } from "../../core/log";
import { currentLang, t } from "../../core/i18n";
import { pacedInterval, perfMode } from "../../core/perf";
import { el } from "../../island/dom";
import { reducedMotion } from "../../island/tab-pill";
import { celebrationKey, columns, dayTitle, headlineParts, levelClass, monthLabels, stageToCelebrate, updatedLabel, waveDelay, type GithubCalendar } from "./github-logic";

/** La clé localStorage de la dernière fête (« 2025-09-01:7 »). */
const CELEBRATED = "ondine.github.celebrated";
/** La vague ne joue qu'au premier affichage de la session. */
let waveShown = false;

const ROW_LABELS = ["", "Lun", "", "Mer", "", "Ven", ""];

function recall(): string | null {
  try {
    return localStorage.getItem(CELEBRATED);
  } catch {
    return null;
  }
}

function remember(key: string) {
  try {
    localStorage.setItem(CELEBRATED, key);
  } catch {
    // Stockage indisponible : la fête pourra se rejouer, ce n'est pas grave.
  }
}

/** Monte le calendrier dans `box` ; renvoie de quoi l'arrêter. */
export function mountGithub(box: HTMLElement, api: ModuleApi): () => void {
  let cal: GithubCalendar | null = null;
  let error = "";
  let loading = false;
  /** Un mot d'état à côté du bouton (« Déjà à jour »), effacé au prochain dessin. */
  let note = "";
  let noteTimer = 0;
  // En démo, un identifiant inventé (le Rust n'est pas appelé : src/core/demo.ts répond).
  const login = () => String(api.settings().githubLogin ?? "").trim() || (demoOn() ? "simon-demo" : "");

  const grid = (c: GithubCalendar) => {
    const cols = columns(c.days);
    const animate = !waveShown && !reducedMotion() && perfMode() !== "eco";
    const today = c.days[c.days.length - 1]?.date;
    const months = el("div", { class: "gh-months", "aria-hidden": "true" }, ...monthLabels(cols).map((m) => el("span", { style: `grid-column: ${m.col + 1}` }, m.label)));
    const rows = el("div", { class: "gh-rows", "aria-hidden": "true" }, ...ROW_LABELS.map((l) => el("span", {}, l)));
    const english = currentLang() === "en";
    const [left, right] = headlineParts(c.total, c.streak);
    const cells = el("div", { class: "gh-cells", role: "img", "aria-label": `${t(left)} · ${t(right)}` });
    cols.forEach((col, w) => {
      col.forEach((d) => {
        if (!d) return cells.append(el("i", { class: "gh-cell gh-future" }));
        const isToday = d.date === today;
        const cls = ["gh-cell", `gh-l${levelClass(d.level)}`, animate ? "gh-wave" : "", isToday ? "gh-today" : "", isToday && d.count === 0 ? "gh-zero" : ""].filter(Boolean).join(" ");
        cells.append(el("i", { class: cls, title: dayTitle(d.count, d.date, english), style: animate ? `animation-delay: ${waveDelay(w)}ms` : undefined }));
      });
    });
    if (animate) waveShown = true;
    return el("div", { class: "gh-grid" }, months, rows, cells);
  };

  const draw = () => {
    if (!login()) return box.replaceChildren();
    const head = el(
      "div",
      { class: "agents-usage-head" },
      el("b", {}, "Contributions GitHub"),
      el("span", { class: "muted" }, cal ? `${cal.login}${cal.private ? " · avec les privées" : ""}` : login()),
      el(
        "div",
        { class: "net-chips" },
        note ? el("small", { class: "muted gh-note" }, note) : null,
        el("button", { class: "net-chip", title: "Redemander à GitHub", disabled: loading, onclick: api.handler(() => load(true)) }, "↻"),
      ),
    );
    if (!cal) {
      const text = error ? t(error) : loading ? "Lecture du calendrier…" : "";
      return box.replaceChildren(head, text ? el("p", { class: "muted" }, text) : el("p", {}));
    }
    // Les deux moitiés dans deux éléments : chacune garde sa traduction.
    const [left, right] = headlineParts(cal.total, cal.streak);
    const line = el("p", { class: "gh-headline" }, el("b", {}, left), " · ", el("span", {}, right));
    const foot = el("p", { class: "muted gh-foot" }, [error ? t(error) : "", updatedLabel(cal.fetchedAt)].filter(Boolean).join(" · "));
    box.replaceChildren(head, line, grid(cal), foot);
  };

  /** Un mot d'état pendant 2,5 s (« Déjà à jour »). */
  const say = (text: string) => {
    note = text;
    draw();
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => {
      note = "";
      draw();
    }, 2500);
  };

  /** Fête un palier de série (7, 30, 100 jours), une fois par palier et par série. */
  const celebrate = (c: GithubCalendar) => {
    const stage = stageToCelebrate(c, recall());
    if (!stage) return;
    const key = celebrationKey(c, stage);
    if (key) remember(key);
    api.emit("agents.github-streak", { days: c.streak, stage });
  };

  /** Demande le calendrier au Rust (lui respecte les 30 minutes). `manual` : le bouton ↻. */
  const load = async (manual = false) => {
    if (!login() || loading) return;
    loading = true;
    if (!cal) draw();
    try {
      const next = await api.invoke<GithubCalendar>("github_calendar");
      cal = next;
      error = "";
      celebrate(next);
      if (manual) return say(next.fromCache ? "Déjà à jour" : "Relu");
    } catch (e) {
      // Un calendrier déjà lu reste affiché, l'erreur passe en bas.
      error = errorText(e);
    } finally {
      loading = false;
    }
    draw();
  };

  draw();
  void load();
  // Le Rust garde 30 minutes : ces passages ne coûtent rien tant qu'ils ne sont pas écoulés.
  const stopTimer = pacedInterval(() => void load(), "agentsList", true);
  let lastLogin = login();
  const stopSettings = api.onSettingsChange(() => {
    if (login() === lastLogin) return;
    lastLogin = login();
    cal = null;
    error = "";
    draw();
    void load();
  });
  return () => {
    stopTimer();
    stopSettings();
    window.clearTimeout(noteTimer);
  };
}
