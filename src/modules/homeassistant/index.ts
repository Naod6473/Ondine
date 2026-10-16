// Module « Home Assistant » : vos appareils favoris en pastilles, rangés par
// pièce, dans l'onglet de l'île (le même verre que l'onglet Contrôles), et
// les premiers sur une carte de l'Accueil.
//
// Le Rust (src-tauri/src/modules/homeassistant.rs) parle à Home Assistant et
// garde le jeton ; ici on ne fait que montrer et cliquer :
//   - un clic sur une pastille fait l'action évidente (allumer / éteindre,
//     ouvrir / fermer, lancer la scène) et montre en dessous ses réglages
//     fins s'il en a (luminosité, position, consigne, volume) ;
//   - un appareil sensible (serrure, alarme, garage, portail, ou marqué
//     « sensible ») : le Rust répond `{confirm}` et une barre « Ouvrir ? »
//     attend votre clic (`confirm_call`), sinon rien n'est fait ;
//   - l'état est relu seulement tant que l'onglet est affiché (cadence
//     « homeassistantTab » de src/core/perf.ts, rien quand la fenêtre est
//     cachée), et la carte d'Accueil seulement quand l'Accueil est affiché.
// La voix (« Dis Ondine, allume la lumière du salon ») passe par Parler à
// Ondine (askclaude_home.rs), qui demande d'abord à Assist.

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";
import { glyph } from "../../island/icon";
import { pacedInterval, setText } from "../../core/perf";
import { openParakeetSettings } from "../../settings/voice/parakeet-link";
import { byArea, confirmVerb, domainIcon, homeSummary, isOn, mainService, stateText, type HaEntity } from "./logic";
import "../../styles/homeassistant.css";

interface Status {
  configured: boolean;
  favorites: number;
}

interface CallResult {
  ok?: boolean;
  label?: string;
  state?: HaEntity | null;
  confirm?: { id: number; label: string };
}

/** Les derniers favoris lus (l'onglet et la carte d'Accueil les partagent). */
let last: HaEntity[] = [];
let lastStatus: Status | null = null;

const SETTINGS_PAGE = "module:homeassistant#connection";

async function loadFavorites(api: ModuleApi): Promise<HaEntity[]> {
  lastStatus = await api.invoke<Status>("status");
  if (!lastStatus.configured || !lastStatus.favorites) {
    last = [];
    return last;
  }
  const r = await api.invoke<{ items: HaEntity[] }>("favorites");
  last = r.items;
  return last;
}

/** Remplace un appareil par son nouvel état (réponse d'une action). */
function merge(e: HaEntity | null | undefined) {
  if (!e) return;
  last = last.map((x) => (x.id === e.id ? { ...x, ...e, name: x.name, area: x.area, sensitive: x.sensitive } : x));
}

export const homeassistant: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    // L'Accueil : les trois premiers favoris qu'un clic commande sans confirmation.
    const card = api.homeCard({
      title: "Maison",
      icon: "🏡",
      moments: { morning: 45, day: 30, evening: 60 },
      refreshMs: 30000,
      load: async () => {
        if (api.settings().homeCard === false) return;
        await loadFavorites(api).catch(() => (last = []));
      },
      view: () => {
        if (api.settings().homeCard === false || !last.length) return null;
        const quick = last.filter((e) => e.available !== false && !e.sensitive && mainService(e)).slice(0, 3);
        return {
          value: homeSummary(last),
          actions: quick.map((e) => ({
            icon: domainIcon(e),
            label: e.name,
            run: async () => {
              const r = await api.invoke<CallResult>("call", { entity: e.id, service: mainService(e), source: "button" });
              merge(r.state);
              card.refresh();
            },
          })),
        };
      },
    });
    return () => card.remove();
  },

  views: {
    expanded(root, api) {
      const box = el("div", { class: "ha", "data-island-fit": "" });
      const body = el("div", { class: "ha-body" });
      const detail = el("div", { class: "ha-detail", hidden: true });
      const note = el("div", { class: "ha-note muted", "aria-live": "polite" });
      box.append(body, detail, note);
      root.append(box);

      let alive = true;
      let key = "";
      let selected: string | null = null;
      /** Pendant un glissement, l'état relu ne bouge pas le curseur. */
      let holdUntil = 0;
      const tiles = new Map<string, { node: HTMLButtonElement; name: HTMLElement; state: HTMLElement }>();
      let confirmTimer = 0;

      const say = (text: string) => setText(note, text);

      const empty = (text: string) => {
        key = "";
        tiles.clear();
        detail.hidden = true;
        body.replaceChildren(
          el(
            "div",
            { class: "ha-empty" },
            el("p", {}, text),
            el("button", { class: "btn small", onclick: api.handler(() => openParakeetSettings(SETTINGS_PAGE)) }, "Ouvrir les réglages"),
          ),
        );
      };

      /** Une action, avec la confirmation des appareils sensibles. */
      const run = async (e: HaEntity, service: string, value?: number) => {
        try {
          const r = await api.invoke<CallResult>("call", { entity: e.id, service, value, source: "button" });
          if (r.confirm) return askConfirm(r.confirm, service);
          merge(r.state);
          say("");
          paint();
        } catch (err) {
          say(errorText(err));
        }
      };

      const askConfirm = (c: { id: number; label: string }, service: string) => {
        window.clearTimeout(confirmTimer);
        const bar: HTMLElement = el(
          "div",
          { class: "ha-confirm", role: "alertdialog", "aria-label": "Confirmation" },
          el("span", { class: "ha-confirm-text", "data-no-i18n": "" }, `${c.label.charAt(0).toUpperCase()}${c.label.slice(1)} ?`),
          el(
            "button",
            {
              class: "btn small primary",
              onclick: api.handler(async () => {
                bar.remove();
                try {
                  const r = await api.invoke<CallResult>("confirm_call", { id: c.id });
                  merge(r.state);
                  paint();
                } catch (err) {
                  say(errorText(err));
                }
              }),
            },
            confirmVerb(service),
          ),
          el("button", { class: "btn small", onclick: api.handler((): void => {
                bar.remove();
                void api.invoke("cancel_call", { id: c.id });
              }),
            }, "Annuler"),
        );
        box.querySelector(".ha-confirm")?.remove();
        box.insertBefore(bar, note);
        // Sans réponse, la question s'en va (le Rust l'oublie aussi).
        confirmTimer = window.setTimeout(() => bar.remove(), 30000);
      };

      /** Les réglages fins de l'appareil choisi. */
      const drawDetail = () => {
        const e = last.find((x) => x.id === selected);
        const controls: HTMLElement[] = [];
        if (e && e.available !== false) {
          const range = (v: number, min: number, max: number, label: string, send: (n: number) => void) => {
            const input = el("input", { type: "range", min: String(min), max: String(max), value: String(v), "aria-label": label, class: "ha-range" }) as HTMLInputElement;
            input.addEventListener("input", () => (holdUntil = Date.now() + 2500));
            input.addEventListener("change", api.handler(() => send(Number(input.value))));
            return input;
          };
          const btn = (icon: string, label: string, fn: () => void) => el("button", { class: "btn small ha-btn", title: label, "aria-label": label, onclick: api.handler(fn) }, icon);
          if (e.domain === "light" && e.dimmable) controls.push(range(e.brightness ?? 100, 1, 100, "Luminosité", (n) => void run(e, "turn_on", n)));
          if (e.domain === "cover") {
            controls.push(btn("⬆", "Ouvrir", () => void run(e, "open_cover")), btn("⏹", "Arrêter", () => void run(e, "stop_cover")), btn("⬇", "Fermer", () => void run(e, "close_cover")));
            if (e.position != null) controls.push(range(e.position, 0, 100, "Position", (n) => void run(e, "set_cover_position", n)));
          }
          if (e.domain === "climate") {
            const t = e.target ?? 20;
            const step = (d: number) => () => void run(e, "set_temperature", Math.min(e.maxTemp ?? 35, Math.max(e.minTemp ?? 7, t + d)));
            controls.push(btn("−", "Baisser la consigne", step(-0.5)), el("span", { class: "ha-temp" }, stateText(e)), btn("＋", "Monter la consigne", step(0.5)));
          }
          if (e.domain === "media_player") {
            controls.push(btn("⏮", "Morceau précédent", () => void run(e, "media_previous_track")), btn("⏯", "Lecture ou pause", () => void run(e, "media_play_pause")), btn("⏭", "Morceau suivant", () => void run(e, "media_next_track")));
            if (e.volume != null) controls.push(range(e.volume, 0, 100, "Volume", (n) => void run(e, "volume_set", n)));
          }
        }
        detail.hidden = !controls.length;
        detail.replaceChildren(...(controls.length && e ? [el("span", { class: "ha-detail-name", "data-no-i18n": "" }, e.name), ...controls] : []));
      };

      /** Met les pastilles à jour (sans refaire celles qui n'ont pas changé de place). */
      const paint = () => {
        const nextKey = last.map((e) => `${e.id}|${e.area ?? ""}`).join(",");
        if (nextKey !== key) {
          key = nextKey;
          tiles.clear();
          body.replaceChildren(
            ...byArea(last).map((g) =>
              el(
                "section",
                { class: "ctl-card ha-area" },
                g.area ? el("div", { class: "ha-area-name", "data-no-i18n": "" }, g.area) : null,
                el(
                  "div",
                  { class: "ha-grid" },
                  ...g.items.map((e) => {
                    const name = el("span", { class: "ctl-toggle-name ha-name", "data-no-i18n": "" }, e.name);
                    const state = el("span", { class: "ha-state" });
                    const node = el(
                      "button",
                      {
                        class: "ctl-toggle ha-tile",
                        "data-kind": e.domain,
                        title: e.name,
                        onclick: api.handler(() => {
                          const cur = last.find((x) => x.id === e.id) ?? e;
                          selected = cur.id;
                          drawDetail();
                          const service = mainService(cur);
                          if (service && cur.available !== false) void run(cur, service);
                        }),
                      },
                      el("span", { class: "ctl-dot" }, glyph(domainIcon(e))),
                      name,
                      state,
                    ) as HTMLButtonElement;
                    tiles.set(e.id, { node, name, state });
                    return node;
                  }),
                ),
              ),
            ),
          );
        }
        for (const e of last) {
          const t = tiles.get(e.id);
          if (!t) continue;
          t.node.classList.toggle("on", isOn(e));
          t.node.setAttribute("aria-pressed", String(isOn(e)));
          t.node.classList.toggle("sensitive", !!e.sensitive);
          t.node.disabled = e.available === false;
          setText(t.state, stateText(e));
        }
        if (Date.now() > holdUntil) drawDetail();
      };

      const load = async () => {
        try {
          await loadFavorites(api);
          if (!alive) return;
          if (!lastStatus?.configured) return empty("Reliez Home Assistant : son adresse et un jeton d'accès, dans les réglages.");
          if (!last.length) return empty("Choisissez vos appareils favoris dans les réglages.");
          paint();
          say("");
        } catch (err) {
          if (!alive) return;
          if (!last.length) empty(errorText(err));
          else say(errorText(err));
        }
      };

      void load();
      const stop = pacedInterval(() => void load(), "homeassistantTab", true);
      return () => {
        alive = false;
        window.clearTimeout(confirmTimer);
        stop();
      };
    },
  },
};
