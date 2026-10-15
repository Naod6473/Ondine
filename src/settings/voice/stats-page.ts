// Page « Statistiques » du groupe Voix des Réglages (1.2.4) : ce qui a été
// dicté, à quelle vitesse, et où. Tout est compté sur le PC
// (%APPDATA%\Ondine\dictation.json, modules/dictation_store.rs), jamais envoyé.

import { settingsStore } from "../../core/settings-store";
import { el } from "../../island/dom";
import { segmented } from "../controls";
import { hero } from "../hero";
import { appShares, dailyBars, EMPTY_TOTALS, formatNumber, shortDay, statTiles, streakText, type Period, type Stats } from "./dictation-format";
import { dictationCall, errorLine, onBusTopic } from "./dictation-ui";
import type { VoicePage } from "./pages";

const COLOR = "#4cd98b";

export const statsPage: VoicePage = {
  id: "voice:stats",
  label: "Statistiques",
  color: COLOR,
  module: "dictation",
  render(root) {
    let period: Period = "month";
    let stats: Stats | null = null;
    const body = el("div", { class: "dict-stats" });
    const streak = el("span", { class: "chip" });
    const periods = segmented(period, [["week", "Semaine"], ["month", "Mois"], ["all", "Tout"]], (v) => {
      period = v as Period;
      draw();
    });
    root.append(
      hero({ title: "Statistiques", subtitle: "Ce que vous avez dicté, à quelle vitesse, et où.", color: COLOR, mascots: ["gomme-etoile"] }),
      el("div", { class: "dict-stats-bar" }, periods, streak),
      body,
      el("p", { class: "dict-note" }, "Compté sur votre PC, jamais envoyé."),
    );

    function draw() {
      if (!stats) return;
      const t = stats[period] ?? EMPTY_TOTALS;
      streak.textContent = streakText(stats.streak);
      const tiles = el(
        "div",
        { class: "dict-stat-tiles" },
        ...statTiles(t, period).map((x) => el("div", { class: "dict-tile big" }, el("span", { class: "dict-label" }, x.label), el("strong", { "data-no-i18n": true }, x.value), el("span", { class: "dict-sub" }, x.sub))),
      );
      const bars = dailyBars(stats.daily);
      const chart = el(
        "div",
        { class: "dict-chart", role: "img", "aria-label": "Mots par jour" },
        ...bars.map((b) => {
          const bar = el("span", { class: "dict-bar", title: `${shortDay(b.day)} : ${formatNumber(b.words)} mots` });
          bar.style.setProperty("--h", String(Math.max(0.02, b.h)));
          return bar;
        }),
      );
      const ticks = bars.length ? el("div", { class: "dict-ticks", "aria-hidden": "true" }, el("span", {}, shortDay(bars[0].day)), el("span", {}, shortDay(bars[bars.length - 1].day))) : null;
      const shares = appShares(t.apps);
      const apps = el(
        "section",
        { class: "dict-card" },
        el("h3", { class: "dict-label" }, "Où vous dictez"),
        shares.length
          ? el(
              "div",
              { class: "dict-apps" },
              ...shares.map((a) => {
                const fill = el("span", { class: "dict-app-fill" });
                fill.style.setProperty("--w", `${a.pct}%`);
                return el("div", { class: "dict-app" }, el("span", { class: "dict-app-name", "data-no-i18n": true }, a.name), el("span", { class: "dict-app-track" }, fill), el("span", { class: "dict-app-pct" }, `${a.pct} %`));
              }),
            )
          : el("p", { class: "empty" }, "Pas encore de dictée sur cette période."),
      );
      body.replaceChildren(tiles, el("div", { class: "dict-columns" }, el("section", { class: "dict-card" }, el("h3", { class: "dict-label" }, "Mots par jour"), chart, ticks), apps));
    }

    async function load() {
      if (!settingsStore.moduleEnabled("dictation")) {
        body.replaceChildren(el("p", { class: "empty" }, "Allumez la dictée (page Dictée) pour voir ses statistiques."));
        return;
      }
      try {
        stats = await dictationCall<Stats>("stats");
        draw();
      } catch (e) {
        body.replaceChildren(errorLine(e));
      }
    }

    void load();
    return onBusTopic("dictation.history", () => void load());
  },
};
