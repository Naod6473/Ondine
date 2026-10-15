// Page « Styles » du groupe Voix des Réglages (1.2.4) : le ton de la dictée
// selon l'appli au premier plan (Tel quel, Naturel, Soigné), et la remise au
// propre par l'IA de Parler à Ondine (coupée par défaut), avec ce qui part.

import { settingsStore } from "../../core/settings-store";
import { el } from "../../island/dom";
import { group, row, segmented, select, toggle, wideRow } from "../controls";
import { hero } from "../hero";
import { setAppStyle, STYLE_OPTIONS, type AppStyle, type StyleId } from "./dictation-format";
import { dictationCall, dictationValues, errorLine, saveDictationValue } from "./dictation-ui";
import type { VoicePage } from "./pages";

const COLOR = "#f28bd2";

const STYLE_HELP: Record<StyleId, string> = {
  verbatim: "Tel quel : les mots tels qu'entendus, sans rien enlever.",
  natural: "Naturel : sans les « euh » ni les répétitions, ponctué, le ton gardé.",
  polished: "Soigné : des phrases complètes et nettes, pour un e-mail ou un document.",
};

export const stylesPage: VoicePage = {
  id: "voice:styles",
  label: "Styles",
  color: COLOR,
  module: "dictation",
  render(root) {
    let styles: AppStyle[] = [];
    const body = el("div");
    root.append(hero({ title: "Styles", subtitle: "Un ton pour chaque appli : détendu dans Slack, soigné dans Outlook.", color: COLOR, mascots: ["gomme-fleur"] }), body);

    async function save(next: AppStyle[]) {
      try {
        const r = await dictationCall<{ styles: AppStyle[] }>("set_styles", { styles: next });
        styles = r.styles;
        draw();
      } catch (e) {
        body.prepend(errorLine(e));
      }
    }

    function cleanupGroup(destination: string): HTMLElement {
      const values = dictationValues();
      return group("Remise au propre", [
        row(
          "Remettre au propre avec l'IA",
          toggle(values.cleanup === true, (v) => saveDictationValue("cleanup", v), "Remettre au propre avec l'IA"),
          "Coupée par défaut. Allumée, le texte dicté (jamais l'audio) part vers l'IA choisie dans Parler à Ondine, avec votre clé.",
        ),
        wideRow(
          "Ce qui part",
          el(
            "ul",
            { class: "dict-leaves" },
            el("li", {}, `Destination : ${destination}`),
            el("li", {}, "Le texte de la dictée, le nom de l'appli et vos noms du dictionnaire."),
            el("li", {}, "Rien d'autre : ni l'audio, ni l'historique, ni le contenu de l'appli."),
            el("li", {}, "Sans réponse en 8 secondes, le texte est collé tel qu'entendu."),
          ),
        ),
      ], "Les styles ne changent le texte que quand la remise au propre est allumée. Le style Tel quel ne part jamais.");
    }

    function appsGroup(running: { id: string; name: string }[]): HTMLElement {
      const rows = styles.map((s, i) =>
        row(
          s.name,
          el(
            "div",
            { class: "dict-inline" },
            segmented(s.style, STYLE_OPTIONS, (v) => void save(setAppStyle(styles, s.id, s.name, v as StyleId))),
            el("button", { class: "dict-icon-btn", type: "button", title: "Retirer", "aria-label": "Retirer", onclick: () => void save(styles.filter((_, j) => j !== i)) }, "×"),
          ),
        ),
      );
      const known = new Set(styles.map((s) => s.id));
      const choices: [string, string][] = [["", "Ajouter une appli ouverte…"], ...running.filter((a) => !known.has(a.id)).map((a): [string, string] => [a.id, a.name])];
      const picker = select("", choices, (id) => {
        const app = running.find((a) => a.id === id);
        if (app) void save(setAppStyle(styles, app.id, app.name, "natural"));
      });
      return group("Par appli", [...rows, row("Une autre appli", picker, "La liste des applis ouvertes en ce moment.")]);
    }

    function defaultGroup(): HTMLElement {
      const current = String(dictationValues().defaultStyle ?? "natural") as StyleId;
      const help = el("p", { class: "muted" }, STYLE_HELP[current] ?? STYLE_HELP.natural);
      return group("Les autres applis", [
        row("Style des autres applis", segmented(current, STYLE_OPTIONS, (v) => {
          saveDictationValue("defaultStyle", v);
          help.textContent = STYLE_HELP[v as StyleId] ?? "";
        })),
        wideRow(null, help),
      ]);
    }

    let running: { id: string; name: string }[] = [];
    let destination = "";

    function draw() {
      body.replaceChildren(cleanupGroup(destination), appsGroup(running), defaultGroup());
    }

    async function load() {
      if (!settingsStore.moduleEnabled("dictation")) {
        body.replaceChildren(el("p", { class: "empty" }, "Allumez la dictée (page Dictée) pour choisir ses styles."));
        return;
      }
      try {
        const [r, apps, status] = await Promise.all([
          dictationCall<{ styles: AppStyle[] }>("styles"),
          dictationCall<{ apps: { id: string; name: string }[] }>("running_apps").catch(() => ({ apps: [] })),
          dictationCall<{ cleanupDestination: string }>("status"),
        ]);
        styles = r.styles;
        running = apps.apps;
        destination = status.cleanupDestination;
        draw();
      } catch (e) {
        body.replaceChildren(errorLine(e));
      }
    }

    void load();
  },
};
