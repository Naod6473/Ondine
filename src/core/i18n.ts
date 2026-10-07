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
//
// Tutoiement : en français, l'interface vouvoie (« Vérifiez votre connexion »).
// Le réglage « S'adresser à moi » (general.address = "tu") la fait tutoyer, par
// le même mécanisme : un dictionnaire français → français (i18n-fr-tu.json),
// qui ne contient que les phrases au « vous ». Les boutons et les libellés à
// l'infinitif (« Coller ici… ») ne changent pas.
//
// Une autre langue plus tard : un fichier i18n-xx.json de la même forme, et une
// ligne dans DICTIONARIES ci-dessous (voir CONTRIBUTING.md, « Ajouter une langue »).

import { Bridge } from "./bridge";
import { settingsStore } from "./settings-store";
import english from "./i18n-en.json";
import frenchTu from "./i18n-fr-tu.json";

/** Un dictionnaire : français → autre langue. */
interface Dictionary {
  exact: Record<string, string>;
  patterns: [string, string][];
}

/** Les langues traduites, par code (le français est la langue d'origine). */
const DICTIONARIES: Record<string, Dictionary> = {
  en: english as unknown as Dictionary,
};

/** Vouvoiement → tutoiement (en français seulement, réglage general.address). */
const FRENCH_TU = frenchTu as unknown as Dictionary;

/** "fr", ou un code de DICTIONARIES ("en"…). */
export type Lang = string;

let lang: Lang = "fr";
/** Vrai : en français, on tutoie (réglage general.address = "tu"). */
let tutoie = false;
/** Vrai quand un dictionnaire est chargé (anglais, ou français tutoyé). */
let active = false;
/** Le dictionnaire de la langue courante, prêt à servir (vide en français). */
let exact = new Map<string, string>();
let patterns: [RegExp, string][] = [];

/** Le dictionnaire à utiliser : celui de la langue, ou le tutoiement en français. */
function dictionaryFor(code: Lang): Dictionary | undefined {
  if (code === "fr") return tutoie ? FRENCH_TU : undefined;
  return DICTIONARIES[code];
}

function loadDictionary(code: Lang) {
  const d = dictionaryFor(code);
  active = d !== undefined;
  exact = new Map(Object.entries(d?.exact ?? {}));
  patterns = (d?.patterns ?? []).map(([rx, rep]) => [new RegExp(rx), rep]);
  // En pack d'icônes « line », el() met le pictogramme d'un libellé à part
  // (« 📄 Copier vers… » → icône + « Copier vers… », voir island/icon.ts).
  // Le texte qui reste doit être traduit aussi : on ajoute chaque entrée sans
  // son pictogramme du début ou de la fin, quand la traduction a le même.
  for (const [fr, en] of [...exact]) {
    for (const rx of [LEAD_PICTO, TRAIL_PICTO]) {
      const pf = rx.exec(fr)?.[0];
      const pe = rx.exec(en)?.[0];
      if (!pf || pf.trim() !== pe?.trim()) continue;
      const bareFr = fr.replace(rx, "").trim();
      if (bareFr && !exact.has(bareFr)) exact.set(bareFr, en.replace(rx, "").trim());
    }
  }
  // Pareil pour les motifs : « ^⏳\ Pas de réponse… » sert aussi sans le ⏳.
  for (const [rx, rep] of d?.patterns ?? []) {
    const lead = /^\^((?:\p{Extended_Pictographic}️?)+)(?:\\ | )*/u.exec(rx);
    if (lead && LEAD_PICTO.exec(rep)?.[0].trim() === lead[1]) {
      patterns.push([new RegExp("^" + rx.slice(lead[0].length)), rep.replace(LEAD_PICTO, "")]);
    }
    const trail = /(?:\\ | )*((?:\p{Extended_Pictographic}️?)+)\$$/u.exec(rx);
    if (trail && TRAIL_PICTO.exec(rep)?.[0].trim() === trail[1]) {
      patterns.push([new RegExp(rx.slice(0, trail.index) + "$"), rep.replace(TRAIL_PICTO, "")]);
    }
  }
}

// Des pictogrammes (et espaces) au début ou à la fin d'un texte.
const LEAD_PICTO = /^(?:\p{Extended_Pictographic}\uFE0F?\s*)+/u;
const TRAIL_PICTO = /(?:\s*\p{Extended_Pictographic}\uFE0F?)+$/u;

/** Les langues qu'on sait afficher. */
export function knownLang(code: string | null | undefined): code is Lang {
  return code === "fr" || (!!code && code in DICTIONARIES);
}

export function currentLang(): Lang {
  return lang;
}

/** Traduit un texte français (sans rien changer en français vouvoyé). */
export function t(fr: string): string {
  if (!active || !fr) return fr;
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

/** Ce qui vient de l'utilisateur (champs de saisie, notes, presse-papiers) n'est pas touché. */
const USER_TEXT = "[data-no-i18n], textarea, [contenteditable='true']";

function skipped(elem: Element): boolean {
  return elem.closest(USER_TEXT) !== null;
}

/**
 * Le placeholder et la bulle d'une zone de texte sont de l'appli, même si son
 * contenu est à l'utilisateur.
 */
function applyFieldAttrs(elem: Element) {
  const parent = elem.parentElement;
  if (elem.tagName === "TEXTAREA" && (!parent || !skipped(parent))) for (const a of ATTRS) applyAttr(elem, a);
}

/** Le parcours d'un morceau de page saute ce qui vient de l'utilisateur (et tout ce qu'il contient). */
const userFilter: NodeFilter = {
  acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && (n as Element).matches(USER_TEXT) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
};

function translateNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (!parent || !skipped(parent)) applyText(node);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const elem = node as Element;
  if (skipped(elem)) return applyFieldAttrs(elem);
  for (const a of ATTRS) applyAttr(elem, a);
  const walker = document.createTreeWalker(elem, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, userFilter);
  let n = walker.nextNode();
  while (n) {
    if (n.nodeType === Node.TEXT_NODE) applyText(n);
    else for (const a of ATTRS) applyAttr(n as Element, a);
    n = walker.nextNode();
  }
  for (const field of elem.querySelectorAll("textarea")) applyFieldAttrs(field);
}

let originalTitle = "";

/** La langue voulue par le réglage (« auto » : celle de l'installateur ou de Windows). */
async function wantedLang(setting: string): Promise<Lang> {
  if (knownLang(setting)) return setting;
  const sys = await Bridge.uiLanguage();
  if (knownLang(sys)) return sys;
  // Hors de l'appli : la langue du navigateur, sinon l'anglais.
  const nav = navigator.language.slice(0, 2).toLowerCase();
  return knownLang(nav) ? nav : "en";
}

/** Passe toute la page dans la langue `next`, sans recharger la fenêtre. */
function switchTo(next: Lang) {
  lang = next;
  loadDictionary(next);
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
  tutoie = settingsStore.current.general.address === "tu";
  switchTo(await wantedLang(setting));
  settingsStore.onChange((s) => {
    const now = s.general.language ?? "auto";
    const tu = s.general.address === "tu";
    if (now === setting && tu === tutoie) return;
    const addressChanged = tu !== tutoie;
    setting = now;
    tutoie = tu;
    void wantedLang(now).then((next) => {
      // Le tutoiement ne change que le français.
      if (next !== lang || (addressChanged && next === "fr")) switchTo(next);
    });
  });
  // Tout ce qui arrive ensuite dans la page (en français vouvoyé, rien ne change).
  new MutationObserver((records) => {
    if (!active) return;
    for (const r of records) {
      if (r.type === "characterData") translateNode(r.target);
      else if (r.type === "attributes") {
        const e = r.target as Element;
        if (!skipped(e)) applyAttr(e, r.attributeName!);
        else applyFieldAttrs(e);
      } else r.addedNodes.forEach(translateNode);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
