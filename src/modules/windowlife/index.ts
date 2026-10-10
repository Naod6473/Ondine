// Module « Ondine et les fenêtres » : Ondine réagit aux autres fenêtres.
//
// Pas d'onglet : le Rust (src-tauri/src/modules/windowlife.rs) regarde
// Windows et publie ce qu'il voit ; ici, on le traduit en expressions de la
// mascotte (mascot.emote) et, pour une fenêtre oubliée, en proposition de la
// réduire (rien sans un clic, jamais fermée). Les déplacements de l'île
// (s'écarter, se percher, laisser la place aux bulles) sont faits par le Rust
// (island/dodge.rs).
//
// En mode Calme (Réglages → Mascotte), Ondine ne fait pas ces petites
// réactions ; la proposition de ranger une fenêtre, elle, reste.

import manifest from "./manifest.json";
import { settingsStore } from "../../core/settings-store";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";

/** Une expression d'Ondine, sauf en mode Calme. */
function emote(api: ModuleApi, emotion: string) {
  if (settingsStore.current.mascot.calm) return;
  api.emit("mascot.emote", { emotion });
}

export const windowlife: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    const offs = [
      // Une fenêtre passe en plein écran : un sursaut (puis l'île se cache, mode présentation).
      api.on("windowlife.fullscreen", () => emote(api, "surprised")),
      // Le bord d'une fenêtre arrive tout près : elle s'y assoit, jambes dans le vide.
      api.on("windowlife.sit", (msg) => (msg.payload as { on?: boolean } | null)?.on && emote(api, "sit-edge")),
      // La souris secouée près d'elle : elle rit, ou se cache.
      api.on("windowlife.mouse-shake", (msg) => emote(api, (msg.payload as { emotion?: string } | null)?.emotion === "hide" ? "hide" : "laugh")),
      // La nuit, une fenêtre très claire : lunettes de soleil.
      api.on("windowlife.bright", () => emote(api, "sunglasses")),
      // Verrouillage : au revoir ; retour : elle s'étire.
      api.on("windowlife.lock", (msg) => emote(api, (msg.payload as { locked?: boolean } | null)?.locked ? "goodbye" : "stretch")),
      // Un rendez-vous approche (rappel de l'agenda) : elle grimpe.
      api.on("agenda.reminder", () => api.settings().agendaClimb !== false && emote(api, "climb")),
      // Une fenêtre oubliée : proposer de la réduire.
      api.on("windowlife.forgotten", (msg) => {
        const p = msg.payload as { hwnd?: number; title?: string; minutes?: number } | null;
        if (typeof p?.hwnd !== "number") return;
        const hwnd = p.hwnd;
        api.notify({
          title: `Ranger « ${p.title ?? ""} » ?`,
          body: `Vous ne l'avez pas utilisée depuis ${p.minutes ?? 60} minutes. Ondine peut la réduire dans la barre des tâches (elle ne sera pas fermée).`,
          icon: "🪟",
          priority: "low",
          key: "windowlife-forgotten",
          durationMs: 15_000,
          actions: [
            {
              label: "Réduire",
              run: () => {
                emote(api, "push");
                void api.invoke("minimize", { hwnd }).catch((err) => api.log.warn(`fenêtre non réduite : ${String(err)}`));
              },
            },
            { label: "Laisser", run: () => undefined },
          ],
        });
      }),
    ];
    return () => offs.forEach((off) => off());
  },
};
