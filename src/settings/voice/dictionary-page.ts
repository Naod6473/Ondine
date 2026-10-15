// Page « Dictionnaire » du groupe Voix des Réglages (1.2.4) :
//   - les noms toujours bien écrits (« Supabase », « Léonie ») ;
//   - les remplacements (« cloud code » → « Claude Code ») ;
//   - les snippets à la voix : dire le nom d'un snippet du Presse-papiers
//     colle son texte (la liste vient du module Presse-papiers).
// Tout reste sur le PC (dictation.json) ; les noms ne partent vers l'IA que
// si la remise au propre est allumée (page Styles).

import { settingsStore } from "../../core/settings-store";
import { el } from "../../island/dom";
import { group, row, toggle, wideRow } from "../controls";
import { hero } from "../hero";
import { addReplacement, addWord, type Words } from "./dictation-format";
import { dictationCall, dictationValues, errorLine, saveDictationValue } from "./dictation-ui";
import type { VoicePage } from "./pages";

const COLOR = "#ffc25a";

export const dictionaryPage: VoicePage = {
  id: "voice:dictionary",
  label: "Dictionnaire",
  color: COLOR,
  module: "dictation",
  render(root) {
    let words: Words = { words: [], replacements: [] };
    const body = el("div");
    root.append(hero({ title: "Dictionnaire", subtitle: "Les mots qu'Ondine doit toujours bien écrire.", color: COLOR, mascots: ["gomme-guimauve"] }), body);

    async function save(next: Words) {
      try {
        words = await dictationCall<Words>("set_words", { words: next.words, replacements: next.replacements });
        draw();
      } catch (e) {
        body.prepend(errorLine(e));
      }
    }

    function namesGroup(): HTMLElement {
      const input = el("input", { class: "text", type: "text", maxlength: 80, placeholder: "Un nom, une marque, un terme", "aria-label": "Nom à ajouter" }) as HTMLInputElement;
      const add = () => {
        const next = addWord(words.words, input.value);
        if (next) void save({ ...words, words: next });
        input.value = "";
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") add();
      });
      const chips = words.words.map((w, i) =>
        el(
          "span",
          { class: "chip dict-word" },
          el("span", { "data-no-i18n": true }, w),
          el("button", { class: "dict-chip-x", type: "button", title: "Retirer", "aria-label": "Retirer", onclick: () => void save({ ...words, words: words.words.filter((_, j) => j !== i) }) }, "×"),
        ),
      );
      return group("Noms bien écrits", [
        wideRow(null, el("div", { class: "chips" }, ...(chips.length ? chips : [el("span", { class: "muted" }, "Aucun nom pour l'instant.")]))),
        row("Ajouter un nom", el("div", { class: "dict-inline" }, input, el("button", { class: "btn small", type: "button", onclick: add }, "Ajouter"))),
      ], "Écrits comme ici, quelle que soit la façon dont la reconnaissance les a entendus (majuscules, tirets).");
    }

    function replacementsGroup(): HTMLElement {
      const from = el("input", { class: "text", type: "text", maxlength: 120, placeholder: "Ce qui est entendu", "aria-label": "Ce qui est entendu" }) as HTMLInputElement;
      const to = el("input", { class: "text", type: "text", maxlength: 400, placeholder: "Ce qui est écrit", "aria-label": "Ce qui est écrit" }) as HTMLInputElement;
      const add = () => {
        const next = addReplacement(words.replacements, from.value, to.value);
        if (next) void save({ ...words, replacements: next });
        from.value = "";
        to.value = "";
      };
      to.addEventListener("keydown", (e) => {
        if (e.key === "Enter") add();
      });
      const rows = words.replacements.map((r, i) =>
        el(
          "div",
          { class: "dict-repl" },
          el("span", { class: "dict-repl-from", "data-no-i18n": true }, r.from),
          el("span", { class: "dict-arrow", "aria-hidden": "true" }, "→"),
          el("span", { class: "dict-repl-to", "data-no-i18n": true }, r.to),
          el("button", { class: "dict-icon-btn", type: "button", title: "Supprimer", "aria-label": "Supprimer", onclick: () => void save({ ...words, replacements: words.replacements.filter((_, j) => j !== i) }) }, "×"),
        ),
      );
      return group("Remplacements", [
        wideRow(null, el("div", { class: "dict-repls" }, ...(rows.length ? rows : [el("p", { class: "muted" }, "Par exemple « cloud code » → « Claude Code ».")]))),
        wideRow("Ajouter un remplacement", el("div", { class: "dict-inline" }, from, el("span", { class: "dict-arrow", "aria-hidden": "true" }, "→"), to, el("button", { class: "btn small", type: "button", onclick: add }, "Ajouter"))),
      ], "En mots entiers seulement, sans tenir compte des majuscules ni de la ponctuation.");
    }

    async function snippetsGroup(): Promise<HTMLElement> {
      const on = dictationValues().voiceSnippets !== false;
      const rows: HTMLElement[] = [row("Snippets à la voix", toggle(on, (v) => saveDictationValue("voiceSnippets", v), "Snippets à la voix"), "Dire le nom d'un snippet du Presse-papiers colle son texte, tel quel.")];
      try {
        const r = await dictationCall<{ clipboard: boolean; names: string[] }>("snippets");
        if (!r.clipboard) rows.push(wideRow(null, el("p", { class: "muted" }, "Le module Presse-papiers est coupé : allumez-le pour dire vos snippets.")));
        else if (!r.names.length) rows.push(wideRow(null, el("p", { class: "muted" }, "Pas encore de snippet : créez-en dans l'onglet Presse-papiers.")));
        else rows.push(wideRow("Ce que vous pouvez dire", el("div", { class: "chips" }, ...r.names.map((n) => el("span", { class: "chip", "data-no-i18n": true }, n)))));
      } catch (e) {
        rows.push(errorLine(e));
      }
      return group("Snippets", rows);
    }

    function draw() {
      const snippets = el("div");
      body.replaceChildren(namesGroup(), replacementsGroup(), snippets);
      void snippetsGroup().then((g) => snippets.replaceChildren(g));
    }

    async function load() {
      if (!settingsStore.moduleEnabled("dictation")) {
        body.replaceChildren(el("p", { class: "empty" }, "Allumez la dictée (page Dictée) pour remplir son dictionnaire."));
        return;
      }
      try {
        words = await dictationCall<Words>("words");
        draw();
      } catch (e) {
        body.replaceChildren(errorLine(e));
      }
    }

    void load();
  },
};
