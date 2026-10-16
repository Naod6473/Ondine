// Module « Jeux » (1.2.4) : quatre petits jeux contre Ondine, dans un onglet
// à pastilles (Puissance 4, Morpion, Aquarium, Course).
//
//   - Puissance 4 (connect4-*.ts) : trois niveaux, IA alpha-bêta bornée ;
//   - Morpion (ttt-*.ts) : dans l'onglet, ou « express » dans la mini-île ;
//   - Aquarium de gouttes (aquarium-*.ts) : le jeu « idle », qui grandit
//     avec les tâches des agents IA, les pauses, les Pomodoros et les parties ;
//   - Course de gouttes (race-*.ts) : suit la liste de tâches d'un agent IA.
//
// Pour lancer :
//   - l'onglet « Jeux » (ou le Lanceur : « jouer », « puissance 4 »,
//     « aquarium », « course ») → « games.play » {game} ;
//   - un appui long sur Ondine dans l'île (« mascot.long-press », island.ts :
//     le geste n'était pris par rien d'autre) ou « morpion » dans le Lanceur :
//     le morpion express, dans la mini-île.
// Pendant un appel, une présentation ou une appli en plein écran, les jeux se
// mettent en pause et se taisent (kit.ts, Quiet). La progression de l'aquarium
// est tenue par le Rust (games.rs) ; le reste est en mémoire.

import manifest from "./manifest.json";
import "../../styles/games.css";
import { el } from "../../island/dom";
import { reducedMotion, TabPill } from "../../island/tab-pill";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { Kit, quietText } from "./kit";
import { Connect4Game, mountConnect4 } from "./connect4-view";
import { EXPRESS_IDLE_MS, mountTtt, TttGame } from "./ttt-view";
import { mountAquarium } from "./aquarium-view";
import { mountRace, RaceTracker } from "./race-view";

export type GameId = "connect4" | "ttt" | "aquarium" | "race";

const PILLS: { id: GameId; label: string }[] = [
  { id: "connect4", label: "🟡 Puissance 4" },
  { id: "ttt", label: "⭕ Morpion" },
  { id: "aquarium", label: "🐠 Aquarium" },
  { id: "race", label: "🏁 Course" },
];

/** Tout ce qui vit tant que le module tourne (les parties survivent à l'onglet fermé). */
interface Live {
  kit: Kit;
  c4: Connect4Game;
  ttt: TttGame;
  race: RaceTracker;
  express: Express;
  /** La pastille ouverte (la dernière choisie, ou celle demandée par games.play). */
  pill: GameId;
}
let live: Live | null = null;

/**
 * Le morpion express : une alerte de l'île (la mini-île agrandie juste ce
 * qu'il faut, games.css) avec la grille dedans. Elle se range toute seule
 * 3 s après la fin, ou après 30 s sans jouer, ou pendant un appel.
 */
class Express {
  private game: TttGame | null = null;
  private timer = 0;
  private stops: (() => void)[] = [];

  constructor(private kit: Kit) {
    this.stops.push(kit.quiet.onChange((r) => r && this.close(quietText(r))));
  }

  open() {
    const kit = this.kit;
    if (kit.quiet.quiet()) {
      kit.api.notify({ title: quietText(kit.quiet.reason()), icon: "🎮", priority: "low", key: "games-ttt", durationMs: 2500 });
      return;
    }
    this.end();
    const game = new TttGame(kit);
    this.game = game;
    let ended = false;
    game.onChange(() => {
      if (!game.result.state || ended) return;
      ended = true;
      window.setTimeout(() => this.game === game && this.close(this.resultText(game)), 2800);
    });
    kit.emote("mischief");
    kit.api.notify({
      title: "Morpion express",
      icon: "⭕",
      priority: "high",
      sticky: true,
      key: "games-ttt",
      content: (host) => mountTtt(host, kit, game, { mini: true }),
      // Fermée par ×, ou Échap : la partie s'arrête là.
      onDismiss: () => this.end(),
    });
    // 30 s sans jouer : on range.
    this.timer = window.setInterval(() => {
      if (this.game === game && !game.result.state && Date.now() - game.touched > EXPRESS_IDLE_MS) this.close("Morpion rangé : à la prochaine pause");
    }, 1000);
  }

  private resultText(g: TttGame): string {
    const r = g.result.state;
    const base = r === 1 ? "Bien joué !" : r === 2 ? "Ondine gagne cette fois" : "Match nul";
    return g.gained ? `${base} +${g.gained} 💧` : base;
  }

  /** Remplace l'alerte par un petit mot (même clé : l'alerte s'en va). */
  private close(text: string) {
    if (!this.game) return;
    this.end();
    this.kit.api.notify({ title: text, icon: "⭕", priority: "low", key: "games-ttt", durationMs: 2600 });
  }

  private end() {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.game?.stop();
    this.game = null;
  }

  stop() {
    this.end();
    for (const s of this.stops) s();
  }
}

/** Les jeux activés dans les réglages, dans l'ordre des pastilles. */
function enabledGames(kit: Kit): GameId[] {
  return PILLS.map((p) => p.id).filter((id) => kit.enabled(id));
}

function isGame(v: unknown): v is GameId {
  return v === "connect4" || v === "ttt" || v === "aquarium" || v === "race";
}

export const games: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api: ModuleApi) {
    const kit = new Kit(api);
    const l: Live = { kit, c4: new Connect4Game(kit), ttt: new TttGame(kit), race: new RaceTracker(kit), express: new Express(kit), pill: "connect4" };
    live = l;
    void kit.store.refresh();

    const stops = [
      // Le Lanceur, ou un autre module : ouvrir un jeu.
      api.on("games.play", (msg) => {
        const game = (msg.payload as { game?: unknown } | null)?.game;
        if (game === "ttt-express") {
          if (kit.enabled("ttt")) l.express.open();
          return;
        }
        if (isGame(game) && kit.enabled(game)) l.pill = game;
        api.openIsland("games");
      }),
      // Un appui long sur Ondine : le morpion express (ou l'onglet, s'il est coupé).
      api.on("mascot.long-press", () => {
        if (kit.enabled("ttt")) l.express.open();
        else if (enabledGames(kit).length) api.openIsland("games");
      }),
    ];
    return () => {
      for (const s of stops) s();
      l.express.stop();
      l.c4.stop();
      l.ttt.stop();
      l.race.stop();
      kit.stop();
      if (live === l) live = null;
    };
  },

  views: {
    expanded(root, api) {
      const l = live;
      if (!l) return;
      const kit = l.kit;
      const list = enabledGames(kit);
      root.classList.add("games");
      if (!list.length) {
        root.append(el("p", { class: "muted" }, "Tous les jeux sont coupés dans les réglages du module Jeux."));
        return;
      }
      if (!list.includes(l.pill)) l.pill = list[0];
      const seg = el("div", { class: "segmented games-pills", role: "tablist" });
      const buttons = new Map<GameId, HTMLElement>();
      for (const p of PILLS.filter((x) => list.includes(x.id))) {
        const b = el("button", { class: "seg", role: "tab", onclick: api.handler(() => show(p.id)) }, p.label);
        buttons.set(p.id, b);
        seg.append(b);
      }
      const pill = new TabPill(seg);
      const body = el("div", { class: "games-body" });
      root.append(seg, body);
      let unmount: () => void = () => {};

      const show = (id: GameId, animate = true) => {
        l.pill = id;
        for (const [g, b] of buttons) {
          b.classList.toggle("active", g === id);
          b.setAttribute("aria-selected", String(g === id));
        }
        const b = buttons.get(id)!;
        if (animate) pill.moveTo(b);
        else requestAnimationFrame(() => pill.jumpTo(b));
        unmount();
        body.replaceChildren();
        const host = el("div", { class: "games-pane" });
        body.append(host);
        unmount =
          id === "connect4"
            ? mountConnect4(host, kit, l.c4)
            : id === "ttt"
              ? mountTtt(host, kit, l.ttt, { onExpress: () => (api.closeIsland(), l.express.open()) })
              : id === "aquarium"
                ? mountAquarium(host, kit)
                : mountRace(host, kit, l.race);
        if (animate && !reducedMotion()) {
          host.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
        }
      };
      show(l.pill, false);
      return () => unmount();
    },
  },
};
