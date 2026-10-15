// Page « Dictée » du groupe Voix des Réglages (1.2.4).
//
// En haut, la bande : « Bonjour <prénom> », la touche à maintenir, et deux
// boutons (Enregistrer un appel, Dicter mains libres). Puis, à gauche,
// l'historique (recherche, copier, effacer) ; à droite, quelques chiffres et
// la carte des Notes d'appel. En bas, les réglages du module (touche, moteur,
// pilule, historique…). Le module est coupé par défaut : la page le dit et
// propose de l'allumer.

import { Bridge } from "../../core/bridge";
import { settingsStore } from "../../core/settings-store";
import { el } from "../../island/dom";
import { keyLabel } from "../../pill/pill-logic";
import { group, row } from "../controls";
import { settingsRows } from "../form";
import { hero } from "../hero";
import {
  formatNumber,
  greetingName,
  groupByDay,
  timeLabel,
  type DictationEntry,
  type Stats,
} from "./dictation-format";
import { DICTATION_MANIFEST, dictationCall, dictationToggle, dictationValues, errorLine, goToPage, onBusTopic, saveDictationValue } from "./dictation-ui";
import type { VoicePage } from "./pages";

const COLOR = "#5fd4e6";

/** Réglages montrés sur les pages Styles et Dictionnaire. */
const ELSEWHERE = ["cleanup", "defaultStyle", "voiceSnippets"];

interface Status {
  phase: string;
  engine: string;
  parakeetReady: boolean;
  hasApiKey: boolean;
  cleanupDestination: string;
  windows: boolean;
}

const ENGINE_NAMES: Record<string, string> = {
  parakeet: "Parakeet, sur le PC",
  windows: "la dictée de Windows (en ligne)",
  offline: "Windows hors ligne",
  api: "la transcription par l'API",
};

export const dictationPage: VoicePage = {
  id: "voice:dictation",
  label: "Dictée",
  color: COLOR,
  module: "dictation",
  render(root) {
    let query = "";
    let searchTimer = 0;
    const on = () => settingsStore.moduleEnabled("dictation");
    const key = () => keyLabel(String(dictationValues().holdKey ?? "rightCtrl"));
    const first = greetingName(settingsStore.current.general.firstName);

    const handsFree = el("button", { class: "btn primary", type: "button" }, "Dicter mains libres");
    handsFree.addEventListener("click", () => {
      dictationCall("hands_free").catch((e) => statusBox.replaceChildren(errorLine(e)));
    });
    const callBtn = el("button", { class: "btn", type: "button" }, "Enregistrer un appel");
    callBtn.addEventListener("click", () => void Bridge.busPublish("callnotes.start", {}, "settings"));
    const band = hero({
      title: first ? `Bonjour ${first}` : "Dictée",
      subtitle: `Maintenez ${key()} n'importe où, parlez, relâchez : c'est collé.`,
      color: COLOR,
      mascots: ["goutte-gomme", "gomme-nuage"],
      actions: [callBtn, handsFree],
    });

    // L'interrupteur, et ce qui se passe quand le module est coupé.
    const statusBox = el("div", { class: "dict-status" });
    const top = group(null, [row("Dictée partout", dictationToggle(() => refreshAll()), "Coupée par défaut. Allumée, Ondine suit la touche choisie dans toutes les applis (sans jamais l'avaler) et montre la pilule.")]);

    // L'historique.
    const search = el("input", { class: "text dict-search", type: "search", placeholder: "Chercher dans l'historique", "aria-label": "Chercher dans l'historique" }) as HTMLInputElement;
    search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        query = search.value;
        void loadHistory();
      }, 200);
    });
    const list = el("div", { class: "dict-history", "aria-live": "polite" });
    const clearBtn = el("button", { class: "btn small", type: "button" }, "Effacer l'historique");
    clearBtn.addEventListener("click", () => {
      if (!confirm("Effacer toutes les dictées de l'historique ? Les statistiques restent.")) return;
      dictationCall("clear", { stats: false }).then(loadHistory).catch((e) => list.replaceChildren(errorLine(e)));
    });
    const history = el(
      "section",
      { class: "dict-card dict-history-card" },
      el("div", { class: "dict-card-head" }, el("h3", { class: "dict-label" }, "Historique"), clearBtn),
      search,
      list,
    );

    // Les chiffres et les Notes d'appel.
    const tiles = el("div", { class: "dict-tiles" });
    const callCard = el(
      "section",
      { class: "dict-card dict-call-card" },
      el("h3", {}, "Notes d'appel"),
      el("p", {}, "Vos appels écrits personne par personne, avec un résumé et les choses à faire. Aucun robot dans la réunion."),
      el("button", { class: "link-btn", type: "button", onclick: () => goToPage("voice:callnotes") }, "Ouvrir les notes d'appel"),
    );
    const side = el("div", { class: "dict-side" }, tiles, el("p", { class: "dict-note" }, "Sur votre PC, sans abonnement"), callCard);

    const columns = el("div", { class: "dict-columns" }, history, side);

    // Les réglages du module.
    const settingsBox = el("div");
    const drawSettings = () => {
      settingsBox.replaceChildren(group("Réglages", settingsRows(
        (DICTATION_MANIFEST.settings?.fields ?? []).filter((f) => !ELSEWHERE.includes(f.key)),
        dictationValues(), (k, v) => {
        saveDictationValue(k, v);
        if (k === "holdKey" || k === "engine") window.setTimeout(() => void loadStatus(), 300);
      })));
    };

    root.append(band, top, statusBox, columns, settingsBox);

    function drawEntries(items: DictationEntry[]) {
      if (!items.length) {
        list.replaceChildren(el("p", { class: "empty" }, query ? "Aucune dictée ne correspond." : "Pas encore de dictée. Maintenez la touche dans n'importe quelle appli pour commencer."));
        return;
      }
      const now = Date.now();
      list.replaceChildren(
        ...groupByDay(items, now).flatMap((g) => [
          el("h4", { class: "dict-day" }, g.label),
          ...g.items.map((e) => {
            const copy = el("button", { class: "dict-icon-btn", type: "button", title: "Copier", "aria-label": "Copier" }, "⧉");
            copy.addEventListener("click", () => {
              dictationCall("copy", { id: e.id })
                .then(() => {
                  copy.textContent = "✓";
                  window.setTimeout(() => (copy.textContent = "⧉"), 1200);
                })
                .catch((err) => list.prepend(errorLine(err)));
            });
            const del = el("button", { class: "dict-icon-btn", type: "button", title: "Supprimer", "aria-label": "Supprimer" }, "×");
            del.addEventListener("click", () => {
              dictationCall("delete", { id: e.id }).then(loadHistory).catch((err) => list.prepend(errorLine(err)));
            });
            return el(
              "article",
              { class: "dict-entry" },
              el(
                "div",
                { class: "dict-entry-head" },
                el("span", { class: "dict-time" }, timeLabel(e.at)),
                e.app ? el("span", { class: "chip", "data-no-i18n": true }, e.app) : null,
                e.handsFree ? el("span", { class: "chip" }, "mains libres") : null,
                el("span", { class: "dict-entry-tools" }, copy, del),
              ),
              el("p", { class: "dict-text", "data-no-i18n": true }, e.text),
            );
          }),
        ]),
      );
    }

    async function loadHistory() {
      if (!on()) {
        list.replaceChildren(el("p", { class: "empty" }, "Allumez la dictée pour voir son historique."));
        return;
      }
      try {
        const r = await dictationCall<{ items: DictationEntry[]; total: number }>("history", { query, limit: 300 });
        drawEntries(r.items);
      } catch (e) {
        list.replaceChildren(errorLine(e));
      }
    }

    async function loadTiles() {
      if (!on()) {
        tiles.replaceChildren();
        return;
      }
      try {
        const s = await dictationCall<Stats>("stats");
        tiles.replaceChildren(
          tile(formatNumber(s.all.words), "mots dictés"),
          tile(formatNumber(s.month.wordsPerMinute || s.all.wordsPerMinute), "mots par minute"),
          tile(formatNumber(s.streak), s.streak > 1 ? "jours d'affilée" : "jour d'affilée"),
        );
      } catch (e) {
        tiles.replaceChildren(errorLine(e));
      }
    }

    async function loadStatus() {
      if (!on()) {
        statusBox.replaceChildren(el("p", { class: "dict-hint" }, "La dictée est coupée : rien n'écoute le clavier ni le micro."));
        return;
      }
      try {
        const s = await dictationCall<Status>("status");
        const lines: HTMLElement[] = [el("p", { class: "dict-hint" }, `Reconnaissance : ${ENGINE_NAMES[s.engine] ?? s.engine}.`)];
        const wanted = String(dictationValues().engine ?? "auto");
        if (wanted === "parakeet" && !s.parakeetReady) lines.push(el("p", { class: "dict-warn" }, "Parakeet n'est pas encore installé : la dictée le dira dans la pilule."));
        if (wanted === "api" && !s.hasApiKey) lines.push(el("p", { class: "dict-warn" }, "Pas de clé OpenAI ou Gemini : ajoutez-en une dans Réglages → Identifiants."));
        if (!s.windows) lines.push(el("p", { class: "dict-warn" }, "La touche, le micro et le collage ne marchent que sous Windows."));
        statusBox.replaceChildren(...lines);
      } catch (e) {
        statusBox.replaceChildren(errorLine(e));
      }
    }

    function refreshAll() {
      void loadStatus();
      void loadHistory();
      void loadTiles();
    }

    drawSettings();
    refreshAll();
    const stopBus = onBusTopic("dictation.history", () => {
      void loadHistory();
      void loadTiles();
    });
    return () => {
      clearTimeout(searchTimer);
      stopBus();
    };
  },
};

function tile(value: string, label: string): HTMLElement {
  return el("div", { class: "dict-tile" }, el("strong", { "data-no-i18n": true }, value), el("span", {}, label));
}
