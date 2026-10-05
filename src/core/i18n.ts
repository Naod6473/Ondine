// Français / anglais.
//
// L'interface est écrite en français. En anglais, on traduit ce qui s'AFFICHE :
// un observateur (MutationObserver) regarde chaque texte ajouté à la page, et
// les attributs title, placeholder et aria-label, et les remplace par leur
// traduction s'il en connaît une (src/core/i18n-en.json) :
//   - "exact" : le texte entier, tel quel (« Réglages » → « Settings ») ;
//   - "patterns" : les textes avec une partie variable (« Dans 5 min : Réunion »),
//     une expression régulière et son remplacement ($1, $2…).
// Un texte inconnu reste en français : rien ne casse.
//
// La langue : réglage « Langue » (auto, fr, en). « auto » = celle choisie dans
// l'installateur, sinon celle de Windows (le Rust la donne : ui_language).
// Changer la langue recharge les fenêtres.

import { Bridge } from "./bridge";
import { settingsStore } from "./settings-store";
import dictionary from "./i18n-en.json";

export type Lang = "fr" | "en";

let lang: Lang = "fr";
const exact = new Map<string, string>(Object.entries(dictionary.exact as Record<string, string>));
const patterns: [RegExp, string][] = (dictionary.patterns as [string, string][]).map(([rx, rep]) => [new RegExp(rx), rep]);

export function currentLang(): Lang {
  return lang;
}

/** Traduit un texte français (sans rien changer en français). */
export function t(fr: string): string {
  if (lang === "fr" || !fr) return fr;
  const trimmed = fr.trim();
  if (!trimmed) return fr;
  let en = exact.get(trimmed);
  if (en === undefined) {
    for (const [rx, rep] of patterns) {
      if (rx.test(trimmed)) {
        en = trimmed.replace(rx, rep);
        break;
      }
    }
  }
  if (en === undefined) return fr;
  // On garde les espaces autour (mise en page).
  const start = fr.slice(0, fr.indexOf(trimmed));
  const end = fr.slice(fr.indexOf(trimmed) + trimmed.length);
  return start + en + end;
}

const ATTRS = ["title", "placeholder", "aria-label"];

function translateNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const v = node.nodeValue ?? "";
    const tr = t(v);
    if (tr !== v) node.nodeValue = tr;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const elem = node as Element;
  // Ce qui vient de l'utilisateur (champs de saisie, notes, presse-papiers) n'est pas touché.
  if (elem.closest("[data-no-i18n], textarea, [contenteditable='true']")) return;
  for (const a of ATTRS) {
    const v = elem.getAttribute(a);
    if (v) {
      const tr = t(v);
      if (tr !== v) elem.setAttribute(a, tr);
    }
  }
  const walker = document.createTreeWalker(elem, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n = walker.nextNode();
  while (n) {
    if (n.nodeType === Node.TEXT_NODE) translateNode(n);
    else {
      const e = n as Element;
      for (const a of ATTRS) {
        const v = e.getAttribute(a);
        if (v) {
          const tr = t(v);
          if (tr !== v) e.setAttribute(a, tr);
        }
      }
    }
    n = walker.nextNode();
  }
}

/**
 * À appeler au démarrage d'une fenêtre, après les réglages : choisit la langue
 * et, en anglais, traduit la page et tout ce qui y arrivera ensuite.
 */
export async function startI18n(): Promise<void> {
  const wanted = settingsStore.current.general.language ?? "auto";
  if (wanted === "fr" || wanted === "en") lang = wanted;
  else {
    const sys = await Bridge.uiLanguage();
    lang = sys === "en" ? "en" : sys === "fr" ? "fr" : navigator.language.startsWith("fr") ? "fr" : "en";
  }
  document.documentElement.lang = lang;
  // La langue change dans les réglages : on recharge la fenêtre.
  let shown = wanted;
  settingsStore.onChange((s) => {
    const now = s.general.language ?? "auto";
    if (now !== shown) {
      shown = now;
      location.reload();
    }
  });
  if (lang === "fr") return;
  document.title = t(document.title);
  translateNode(document.body);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") translateNode(r.target);
      else if (r.type === "attributes") {
        const e = r.target as Element;
        const v = e.getAttribute(r.attributeName!);
        if (v && !e.closest("[data-no-i18n]")) {
          const tr = t(v);
          if (tr !== v) e.setAttribute(r.attributeName!, tr);
        }
      } else r.addedNodes.forEach(translateNode);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
