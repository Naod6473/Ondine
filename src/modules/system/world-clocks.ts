// Horloges du monde (réglage « Horloges du monde » du module Système) : une
// rangée de petites horloges sous les jauges. Pour chaque ville : son nom,
// l'heure là-bas, « demain » ou « hier » si le jour n'est pas le même qu'ici,
// et l'écart avec ici (« +6 h »).
//
// Tout est calculé sur le PC (src/core/world-time.ts, avec les fuseaux de
// Windows) : rien ne part sur Internet. Une ville inconnue est ignorée ici ;
// la page de réglages la signale sous le champ.
//
// Les textes sont écrits directement dans la langue de l'interface (heures,
// jours, noms de villes) : la rangée est marquée data-no-i18n.

import { currentLang } from "../../core/i18n";
import type { ModuleApi } from "../../core/module-types";
import { parseCityList } from "../../core/world-cities";
import { cityClock, dayWord, offsetText } from "../../core/world-time";
import { el } from "../../island/dom";

/** La rangée d'horloges, et de quoi l'arrêter quand l'onglet se ferme. */
export function worldClocks(api: ModuleApi): { node: HTMLElement; stop: () => void } {
  const node = el("div", { class: "sys-clocks", "data-no-i18n": true });
  let timer = 0;

  const draw = () => {
    const lang = currentLang() === "en" ? "en" : "fr";
    const { cities } = parseCityList(String(api.settings().worldClocks ?? ""));
    node.hidden = cities.length === 0;
    const now = new Date();
    node.replaceChildren(
      ...cities.map((city) => {
        const k = cityClock(city, now, lang);
        const day = dayWord(k.dayDiff, lang);
        const offset = offsetText(k.offset, lang);
        return el(
          "div",
          { class: "sys-clock", title: `${k.name} · ${k.date} · ${offset}` },
          el("span", { class: "muted" }, k.name),
          el("b", {}, k.time),
          el("small", { class: "muted" }, day ? `${day} · ${offset}` : offset),
        );
      }),
    );
  };

  // Redessinée au début de chaque minute (une fois par minute : rien à économiser).
  const tick = () => {
    draw();
    const now = new Date();
    timer = window.setTimeout(tick, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
  };
  const off = api.onSettingsChange(draw);
  tick();
  return {
    node,
    stop: () => {
      window.clearTimeout(timer);
      off();
    },
  };
}
