// Module « Bilan de la semaine » : chaque semaine (vendredi 17 h par défaut),
// une notification résume ce qui a été fait, et la mascotte fait la fête.
//
// Rien à afficher dans l'île : seulement des réglages (jour, heure) et des
// notifications. Les compteurs sont tenus par le Rust
// (src-tauri/src/modules/weekly.rs), qui les reçoit du bus :
//   - "timer.work-session" {seconds, completed} (Minuteur, séances Pomodoro) ;
//   - "notes.todo-toggled" {done} (Notes, une tâche cochée ou décochée) ;
//   - et, à la demande, le module Agents IA (sa commande « weekly » : tâches
//     finies, attente, jetons, projets de la semaine), pour une carte « Agents IA ».
// Ici, on demande seulement au Rust, toutes les minutes (et une première fois
// peu après le démarrage, pour un bilan manqué PC éteint), s'il y a un bilan à
// montrer : il le rend une seule fois, et seulement s'il s'est passé quelque chose.
//
// « weekly.show » (bouton « Voir le bilan maintenant » des réglages) montre la
// semaine en cours sans rien consommer.

import manifest from "./manifest.json";
import { t } from "../../core/i18n";
import { pacedInterval } from "../../core/perf";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { agentsParts, summaryParts, type WeekTally } from "./summary";
import { costOfRows, costText, parsePrices } from "../agents/cost";
import { sumTokens, tokensShort, totalTokens } from "../agents/texts";

/** Le premier coup d'œil après le démarrage (le reste : "weeklyCheck" de src/core/perf.ts). */
const FIRST_CHECK_MS = 20_000;
/** Le bilan reste un peu plus longtemps qu'une notification ordinaire. */
const SHOW_MS = 15_000;

/** La notification du bilan. Chaque morceau est traduit avant d'être assemblé. */
function notify(api: ModuleApi, title: string, w: WeekTally) {
  const parts = summaryParts(w).map((p) => t(p));
  // La carte « Agents IA » (logique pure du compteur : src/modules/agents/cost.ts).
  const a = w.agents;
  const total = a?.days?.length ? totalTokens(sumTokens(a.days)) : 0;
  const cost = a?.days?.length ? costOfRows(a.days, parsePrices(a.prices ?? "")) : 0;
  const agentsLine = agentsParts(a, total ? tokensShort(total) : "", cost ? costText(cost) : "").map((p) => t(p));
  if (agentsLine.length) parts.push(`${t("Agents IA")} : ${agentsLine.join(", ")}`);
  api.notify({
    title,
    body: parts.join(" · "),
    icon: "🎉",
    // En alerte : une notification « normal » ne montre que son titre dans la
    // pilule, et le bilan, ce sont les chiffres.
    priority: "high",
    wide: true,
    key: "weekly",
    durationMs: SHOW_MS,
  });
}

export const weekly: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    const check = async () => {
      try {
        const due = await api.invoke<WeekTally | null>("due");
        if (!due || (!summaryParts(due).length && !due.agents)) return;
        notify(api, "Le bilan de votre semaine", due);
        // Après l'alerte, qui met la goutte en « alerte » : elle fait la fête.
        api.emit("mascot.emote", { emotion: "celebrate" });
      } catch (e) {
        api.log.warn(`bilan de la semaine : ${String(e)}`);
      }
    };

    // « Voir le bilan maintenant » (Réglages → Bilan de la semaine).
    const offShow = api.on("weekly.show", async () => {
      try {
        const now = await api.invoke<WeekTally | null>("peek");
        if (now && (summaryParts(now).length || now.agents)) {
          notify(api, "Votre semaine jusqu'ici", now);
        } else {
          api.notify({
            title: "Votre semaine jusqu'ici",
            body: "Rien de compté pour l'instant : lancez un Pomodoro ou cochez une tâche dans Notes.",
            icon: "🎉",
            priority: "high",
            wide: true,
            key: "weekly",
          });
        }
      } catch (e) {
        api.log.warn(`bilan de la semaine (aperçu) : ${String(e)}`);
      }
    });

    const first = window.setTimeout(() => void check(), FIRST_CHECK_MS);
    const stop = pacedInterval(() => void check(), "weeklyCheck");
    return () => {
      window.clearTimeout(first);
      stop();
      offShow();
    };
  },
};
