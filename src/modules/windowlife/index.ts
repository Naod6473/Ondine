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
//
// Le « trou noir » (réglage `swallow`, coupé par défaut) : une fenêtre lâchée
// sur l'île est cachée par le Rust (windowlife_hole.rs) ; ici, la liste des
// fenêtres avalées (icône + titre, en mémoire seulement), montrée dans la
// mini-île (vue compacte : le nombre, les icônes, un clic recrache) et sur
// l'Accueil, et les réactions d'Ondine : elle ouvre la bouche quand une
// fenêtre arrive au-dessus de l'île (`surprised`), la mange (`eating`), la
// repousse quand elle ressort (`push`). L'île elle-même s'assombrit et fait
// « gloups » (island.ts, classes hole-over / hole-gulp / hole-spit).

import manifest from "./manifest.json";
import { settingsStore } from "../../core/settings-store";
import type { HomeCardHandle } from "../../core/home-cards";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";
import { holeCountText, holePhrase, holeShown } from "./hole-logic";
import "../../styles/windowlife.css";

/** Une fenêtre avalée, telle que le Rust la décrit (`hole_list`). */
interface Swallowed {
  hwnd: number;
  title: string;
  /** Son icône (data URL PNG), ou null. */
  icon: string | null;
}

/** Les fenêtres avalées, la plus récente d'abord (en mémoire seulement). */
let hole: Swallowed[] = [];
/** Les vues compactes montées, à redessiner quand la liste change. */
const redraws = new Set<() => void>();
const HOLE_KEY = "windowlife-hole";

/** Une expression d'Ondine, sauf en mode Calme. */
function emote(api: ModuleApi, emotion: string) {
  if (settingsStore.current.mascot.calm) return;
  api.emit("mascot.emote", { emotion });
}

/** Relit la liste du trou noir, puis redessine la mini-île et la carte de l'Accueil. */
async function reloadHole(api: ModuleApi, card: HomeCardHandle | null) {
  try {
    hole = await api.invoke<Swallowed[]>("hole_list");
  } catch {
    hole = [];
  }
  redraws.forEach((draw) => draw());
  api.refreshCompact();
  card?.refresh();
}

/** Recrache une fenêtre (un clic sur son icône ou sa ligne). */
function spit(api: ModuleApi, hwnd: number) {
  void api.invoke("spit", { hwnd }).catch(() =>
    api.notify({
      title: "Trou noir",
      body: "Cette fenêtre n'a pas pu ressortir tout de suite. Réessayez dans un instant.",
      icon: "🕳️",
      priority: "low",
      key: HOLE_KEY,
    }),
  );
}

function spitAll(api: ModuleApi) {
  void api.invoke("spit_all").catch((err) => api.log.warn(`trou noir : ${String(err)}`));
}

/** L'icône d'une fenêtre avalée : son image, sinon une fenêtre. */
function windowIcon(item: Swallowed): HTMLElement {
  if (item.icon) return el("img", { class: "hole-icon", src: item.icon, alt: "", draggable: "false" });
  return el("span", { class: "hole-icon hole-icon-none", "aria-hidden": "true" }, "🪟");
}

export const windowlife: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    // La carte de l'Accueil : le nombre, les titres, « Recracher la dernière » et « Tout recracher ».
    const card = api.homeCard({
      title: "Trou noir",
      icon: "🕳️",
      moments: { morning: 45, day: 50, evening: 45 },
      expandable: false,
      view: ({ size }) => {
        if (!holeShown(hole.length)) return null;
        const latest = hole[0];
        return {
          value: String(hole.length),
          sub: holeCountText(hole.length),
          rows: hole.slice(0, size === "large" ? 4 : 2).map((w) => ({ label: w.title, value: "" })),
          actions: [
            { icon: "⤴️", label: "Recracher la dernière", run: () => spit(api, latest.hwnd) },
            { icon: "🌀", label: "Tout recracher", run: () => spitAll(api) },
          ],
          phrase: holePhrase(hole.length),
        };
      },
    });
    void reloadHole(api, card);

    const offs = [
      // ── Le trou noir ──
      api.on("windowlife.hole", () => void reloadHole(api, card)),
      // Une fenêtre arrive au-dessus de l'île : Ondine ouvre grand la bouche.
      api.on("windowlife.hole-hover", (msg) => (msg.payload as { over?: boolean } | null)?.over && emote(api, "surprised")),
      api.on("windowlife.swallowed", (msg) => {
        const p = msg.payload as { ok?: boolean; reason?: string } | null;
        if (p?.ok) {
          emote(api, "eating");
          return;
        }
        api.notify({
          title: "Trou noir",
          body:
            p?.reason === "full"
              ? "Le trou noir est plein. Recrachez une fenêtre avant d'en avaler une autre."
              : "Windows n'a pas laissé Ondine cacher cette fenêtre. Elle reste à sa place.",
          icon: "🕳️",
          priority: "low",
          key: HOLE_KEY,
        });
      }),
      // Elle ressort : Ondine la repousse des deux mains.
      api.on("windowlife.spat", () => emote(api, "push")),

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
    return () => {
      offs.forEach((off) => off());
      card.remove();
      hole = [];
    };
  },

  views: {
    // La mini-île tant que le trou noir n'est pas vide : la pastille avec le
    // nombre, les icônes (un clic recrache), « Tout recracher ».
    compactWhen: () => holeShown(hole.length),

    compact(root, api) {
      const count = el("b", { class: "hole-count" });
      const icons = el("span", { class: "hole-icons" });
      const all = el("button", { class: "hole-all", onclick: api.handler(() => spitAll(api)) }, "Tout recracher");
      root.append(el("div", { class: "hole-compact", role: "group", "aria-label": "Fenêtres avalées par Ondine" }, el("span", { class: "hole-mark", "aria-hidden": "true" }, "🕳️"), count, icons, all));
      let shown = "";
      const draw = () => {
        count.textContent = String(hole.length);
        const key = hole.map((w) => `${w.hwnd}\u0001${w.title}`).join("\u0002");
        if (key === shown) return;
        shown = key;
        // Cinq icônes au plus dans la mini-île ; les autres sont sur l'Accueil.
        icons.replaceChildren(
          ...hole.slice(0, 5).map((w) =>
            el(
              "button",
              { class: "hole-win", "data-no-i18n": true, title: w.title, "aria-label": w.title, onclick: api.handler(() => spit(api, w.hwnd)) },
              windowIcon(w),
            ),
          ),
        );
      };
      draw();
      redraws.add(draw);
      return () => redraws.delete(draw);
    },
  },
};
