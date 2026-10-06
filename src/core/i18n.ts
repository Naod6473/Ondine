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
// Changer la langue traduit les fenêtres sur place, sans les recharger.

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

// Le texte d'origine (français) de chaque texte traduit, pour revenir au
// français sans recharger la fenêtre. `shown` = ce qu'on a écrit nous-mêmes :
// si le texte affiché a changé depuis, c'est l'appli qui l'a réécrit.
type Seen = { orig: string; shown: string };
const seenText = new WeakMap<Node, Seen>();
const seenAttr = new WeakMap<Element, Map<string, Seen>>();

/** Traduit (ou remet en français) un texte de la page. */
function applyText(node: Node) {
  const v = node.nodeValue ?? "";
  const seen = seenText.get(node);
  // Le texte d'origine : celui qu'on a gardé, sauf si l'appli l'a changé depuis.
  const orig = seen && v === seen.shown ? seen.orig : v;
  const shown = t(orig);
  seenText.set(node, { orig, shown });
  if (shown !== v) node.nodeValue = shown;
}

function applyAttr(elem: Element, name: string) {
  const v = elem.getAttribute(name);
  if (!v) return;
  let map = seenAttr.get(elem);
  if (!map) seenAttr.set(elem, (map = new Map()));
  const seen = map.get(name);
  const orig = seen && v === seen.shown ? seen.orig : v;
  const shown = t(orig);
  map.set(name, { orig, shown });
  if (shown !== v) elem.setAttribute(name, shown);
}

function skipped(elem: Element): boolean {
  // Ce qui vient de l'utilisateur (champs de saisie, notes, presse-papiers) n'est pas touché.
  return elem.closest("[data-no-i18n], textarea, [contenteditable='true']") !== null;
}

function translateNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (!parent || !skipped(parent)) applyText(node);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const elem = node as Element;
  if (skipped(elem)) return;
  for (const a of ATTRS) applyAttr(elem, a);
  const walker = document.createTreeWalker(elem, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n = walker.nextNode();
  while (n) {
    if (n.nodeType === Node.TEXT_NODE) applyText(n);
    else for (const a of ATTRS) applyAttr(n as Element, a);
    n = walker.nextNode();
  }
}

let originalTitle = "";

/** La langue voulue par le réglage (« auto » : celle de l'installateur ou de Windows). */
async function wantedLang(setting: string): Promise<Lang> {
  if (setting === "fr" || setting === "en") return setting;
  const sys = await Bridge.uiLanguage();
  return sys === "en" ? "en" : sys === "fr" ? "fr" : navigator.language.startsWith("fr") ? "fr" : "en";
}

/** Passe toute la page dans la langue `next`, sans recharger la fenêtre. */
function switchTo(next: Lang) {
  lang = next;
  document.documentElement.lang = lang;
  document.title = t(originalTitle);
  // En français, t() rend le texte tel quel : on retrouve les originaux.
  translateNode(document.body);
}

/**
 * À appeler au démarrage d'une fenêtre, après les réglages : choisit la langue
 * et, en anglais, traduit la page et tout ce qui y arrivera ensuite.
 *
 * Changer la langue dans les réglages traduit la page sur place. (Avant, on
 * rechargeait la fenêtre, mais recharger l'île la faisait disparaître.)
 */
export async function startI18n(): Promise<void> {
  originalTitle = document.title;
  let setting = settingsStore.current.general.language ?? "auto";
  switchTo(await wantedLang(setting));
  settingsStore.onChange((s) => {
    const now = s.general.language ?? "auto";
    if (now === setting) return;
    setting = now;
    void wantedLang(now).then((next) => {
      if (next !== lang) switchTo(next);
    });
  });
  // Tout ce qui arrive ensuite dans la page (en français, rien ne change).
  new MutationObserver((records) => {
    if (lang === "fr") return;
    for (const r of records) {
      if (r.type === "characterData") translateNode(r.target);
      else if (r.type === "attributes") {
        const e = r.target as Element;
        if (!skipped(e)) applyAttr(e, r.attributeName!);
      } else r.addedNodes.forEach(translateNode);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
