// Les blocs en plus de la page « Home Assistant » des réglages (les champs
// eux-mêmes viennent du manifeste, rangés en trois sous-menus par
// MODULE_SECTIONS de main.ts) :
//   - Connexion : « Tester la connexion » (GET /api/config, sur votre clic) ;
//   - Appareils favoris : vos favoris (retirer, marquer « sensible »), puis
//     « Afficher les appareils » (GET /api/states, sur votre clic) pour en
//     ajouter, rangés par pièce si Home Assistant les donne ;
//   - Voix : une phrase sur ce que fait la voix, selon les réglages.
//
// Les favoris vont dans les réglages du module (`favorites` : {id, name,
// area} ; `sensitive` : les identifiants marqués), comme les pilules de
// l'Étagère : exportés, annulables, jamais le jeton.

import { Bridge } from "../core/bridge";
import { errorText } from "../core/log";
import { settingsStore } from "../core/settings-store";
import type { Settings } from "../core/types";
import { el } from "../island/dom";
import { glyph } from "../island/icon";
import { domainIcon, pickerGroups, readFavorites, toggleFavorite, toggleSensitive, type HaEntity, type HaFavorite } from "../modules/homeassistant/logic";
import { chip, group, inSub, toggle, wideRow } from "./controls";

const ID = "homeassistant";

type Save = (change: (s: Settings) => void) => void;

function values(): Record<string, unknown> {
  return settingsStore.current.modules[ID]?.values ?? {};
}

function setValue(save: Save, key: string, value: unknown) {
  save((d) => {
    const entry = (d.modules[ID] ??= { enabled: settingsStore.moduleEnabled(ID), values: {} });
    entry.values[key] = value;
  });
}

/** Les trois blocs, chacun dans son sous-menu. */
export function homeassistantGroups(save: Save): HTMLElement[] {
  // Tester et choisir les favoris : l'essentiel, visibles aussi en mode Simple.
  const essential = <T extends HTMLElement>(n: T) => (n.setAttribute("data-essential", ""), n);
  return [inSub("connection", essential(testGroup())), inSub("favorites", essential(favoritesGroup(save))), inSub("voice", voiceGroup())];
}

/** « Tester la connexion » : la version et le nom de la maison, ou l'erreur claire. */
function testGroup(): HTMLElement {
  const out = el("div", { class: "row-help", "aria-live": "polite" });
  const btn = el("button", { class: "btn small" }, "Tester la connexion") as HTMLButtonElement;
  btn.addEventListener("click", () => {
    btn.disabled = true;
    out.replaceChildren(chip("…"));
    void Bridge.moduleInvoke<{ address: string; version: string; name: string }>(ID, "test", null)
      .then((r) => out.replaceChildren(chip("✓ Connecté", "ok"), el("span", { "data-no-i18n": "" }, ` ${[r.name, r.version && `Home Assistant ${r.version}`, r.address].filter(Boolean).join(" · ")}`)))
      .catch((e: unknown) => out.replaceChildren(chip("Échec", "warn"), ` ${moduleError(e)}`))
      .finally(() => (btn.disabled = false));
  });
  return group("Vérifier", [wideRow("Tester la connexion", el("div", { class: "inline" }, btn, out), "Ondine demande à Home Assistant qui il est, avec votre jeton : rien d'autre ne part.", "Tester la connexion")]);
}

/** Un module coupé : on le dit simplement. */
function moduleError(e: unknown): string {
  const text = errorText(e);
  return /désactivé/.test(text) ? "Activez d'abord le module (en haut de la page)." : text;
}

/** Vos favoris, et la liste des appareils de Home Assistant pour en ajouter. */
function favoritesGroup(save: Save): HTMLElement {
  const mine = el("div", { class: "ha-fav-list" });
  const picker = el("div", { class: "ha-picker" });
  const search = el("input", { type: "search", class: "text", placeholder: "Chercher un appareil", "aria-label": "Chercher un appareil", hidden: true }) as HTMLInputElement;
  let all: HaEntity[] = [];
  let withAreas = false;

  const favorites = (): HaFavorite[] => readFavorites(values().favorites);
  const sensitive = (): string[] => (Array.isArray(values().sensitive) ? (values().sensitive as string[]) : []);
  const autoSensitive = (id: string) => all.find((e) => e.id === id)?.sensitive === true && !sensitive().includes(id);

  const sensitiveToggle = (id: string, name: string) => {
    if (autoSensitive(id) || /^(lock|alarm_control_panel)\./.test(id)) return el("span", { class: "chip warn", title: "Serrures, alarmes, garage, portails : toujours confirmés" }, "Toujours confirmé");
    return el(
      "label",
      { class: "ha-sens" },
      toggle(sensitive().includes(id), (v) => (setValue(save, "sensitive", toggleSensitive(values().sensitive, id, v)), drawMine()), `Sensible : ${name}`),
      el("span", { class: "muted" }, "Sensible"),
    );
  };

  const drawMine = () => {
    const list = favorites();
    mine.replaceChildren(
      ...(list.length
        ? list.map((f) =>
            el(
              "div",
              { class: "ha-fav" },
              glyph(domainIcon({ domain: f.id.split(".")[0], deviceClass: all.find((e) => e.id === f.id)?.deviceClass ?? null })),
              el("span", { class: "ha-fav-name", "data-no-i18n": "" }, f.name ?? f.id),
              f.area ? el("span", { class: "muted", "data-no-i18n": "" }, f.area) : null,
              sensitiveToggle(f.id, f.name ?? f.id),
              el(
                "button",
                {
                  class: "btn small",
                  title: "Retirer des favoris",
                  "aria-label": `Retirer ${f.name ?? f.id}`,
                  onclick: () => {
                    setValue(save, "favorites", favorites().filter((x) => x.id !== f.id));
                    drawMine();
                    drawPicker();
                  },
                },
                "✕",
              ),
            ),
          )
        : [el("p", { class: "muted" }, "Aucun favori pour l'instant : affichez vos appareils pour en choisir.")]),
    );
  };

  const drawPicker = () => {
    if (!all.length) return;
    const ids = new Set(favorites().map((f) => f.id));
    picker.replaceChildren(
      ...pickerGroups(all, search.value, withAreas).map((g) =>
        el(
          "div",
          { class: "ha-pick-group" },
          // Une pièce est un nom donné dans Home Assistant (jamais traduit) ; un type d'appareil, si.
          el("div", withAreas ? { class: "ha-pick-title", "data-no-i18n": "" } : { class: "ha-pick-title" }, g.title),
          ...g.items.map((e) =>
            el(
              "label",
              { class: "ha-pick" },
              toggle(ids.has(e.id), (v) => {
                setValue(save, "favorites", toggleFavorite(favorites(), e, v).slice(0, 60));
                drawMine();
              }, `Favori : ${e.name}`),
              glyph(domainIcon(e)),
              el("span", { "data-no-i18n": "" }, e.name),
              el("code", { class: "muted", "data-no-i18n": "" }, e.id),
            ),
          ),
        ),
      ),
    );
  };

  const load = el("button", { class: "btn small" }, "Afficher les appareils") as HTMLButtonElement;
  load.addEventListener("click", () => {
    load.disabled = true;
    picker.replaceChildren(el("p", { class: "muted" }, "Lecture…"));
    void Bridge.moduleInvoke<{ items: HaEntity[]; areas: boolean }>(ID, "entities", null)
      .then((r) => {
        all = r.items ?? [];
        withAreas = r.areas;
        search.hidden = all.length < 10;
        if (!all.length) picker.replaceChildren(el("p", { class: "muted" }, "Aucun appareil que Ondine sait commander."));
        else drawPicker();
        drawMine();
      })
      .catch((e: unknown) => picker.replaceChildren(el("p", { class: "muted" }, moduleError(e))))
      .finally(() => (load.disabled = false));
  });
  search.addEventListener("input", drawPicker);
  drawMine();
  return group(
    "Vos favoris",
    [
      wideRow(null, mine),
      wideRow("Ajouter des appareils", el("div", {}, el("div", { class: "inline" }, load, search), picker), "Lumières, prises, volets, scènes, scripts, thermostats et lecteurs, rangés par pièce si Home Assistant les donne (compte administrateur).", "Ajouter des appareils"),
    ],
    "Un appareil sensible demande toujours votre clic, depuis l'île comme à la voix. Les serrures, l'alarme, le garage et les portails le sont d'office.",
  );
}

/** Ce que fait la voix, en une phrase selon les réglages. */
function voiceGroup(): HTMLElement {
  const v = values();
  const assist = v.assistFirst !== false;
  const ai = v.aiTool === true;
  const text = !assist
    ? ai
      ? "Vos phrases vont directement à l'IA de Parler à Ondine, qui peut commander vos favoris."
      : "La voix ne commande pas la maison : activez « Assist d'abord » ou l'IA."
    : ai
      ? "« Dis Ondine, allume la lumière du salon » : Assist de Home Assistant s'en charge, sans IA. S'il ne comprend pas, l'IA de Parler à Ondine prend le relais avec vos favoris."
      : "« Dis Ondine, allume la lumière du salon » : Assist de Home Assistant s'en charge, sans IA. S'il ne comprend pas, la phrase va à Parler à Ondine, qui ne commande pas la maison.";
  return group("Comment ça marche", [wideRow(null, el("p", {}, text))], "Les questions sans rapport avec la maison ne passent pas par Assist. Les phrases qui visent une serrure, l'alarme, le garage ou un portail non plus : elles demandent toujours un clic.");
}
