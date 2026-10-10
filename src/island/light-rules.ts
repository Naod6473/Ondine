// L'île en verre clair (thème « Givre », 1.2.3) : les calculs, sans DOM.
//
// island.css est écrit pour une île sombre : du texte clair, des surfaces et
// des liserés en blanc translucide (« rgba(255, 255, 255, 0.08) »). Plutôt
// que de réécrire ses milliers de lignes (et de les garder en double), la page
// relit ses règles une fois (light-island.ts) et ajoute, juste après chacune,
// la même règle limitée au thème clair, avec ses couleurs retournées :
//   - une couleur neutre (blanc, gris, noir) prend la luminosité opposée, sur
//     une échelle qui va du papier (#fafbfd) à l'encre (#1b1e2b) : le blanc
//     translucide d'une pastille devient de l'encre translucide, le texte
//     blanc devient de l'encre, le noir d'un texte posé sur un bouton clair
//     devient du papier ;
//   - une couleur vive très claire ou très sombre (hors texte) garde sa
//     teinte et prend la luminosité opposée ;
//   - une autre couleur vive reste la même, sauf pour un texte (ou un trait
//     d'icône) : elle est foncée juste assez pour garder 4,5:1 sur le fond le
//     plus défavorable du thème (le verre clair au-dessus d'un bureau noir) ;
//   - un élément de couleur vive (pastille rouge, point lumineux) est laissé
//     tel quel ; le texte d'une surface qui devient sombre (bouton à la
//     couleur d'accent) est seulement retourné (voir ownBackground) ;
//   - les ombres noires restent des ombres, plus douces ; les reflets blancs
//     d'une ombre intérieure deviennent un liseré d'encre très léger.
// L'opacité est toujours gardée (un masque ne change donc pas).
//
// Testé par tests/front/light-island.test.ts.

export type Rgba = [number, number, number, number];

/** L'encre (texte) et le papier (fond) du thème clair. */
export const INK = "#1b1e2b";
export const PAPER = "#fafbfd";
/** Le fond le plus défavorable du verre clair : son blanc à 88 % au-dessus d'un bureau noir. */
export const WORST_LIGHT_BG = "#dcdde0";

/** Le contraste minimal d'un texte (WCAG AA). */
const TEXT_CONTRAST = 4.5;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** « #rgb », « #rgba », « #rrggbb », « #rrggbbaa », « rgb(…) », « rgba(…) », white, black → [r, g, b, a] ; null sinon. */
export function parseColor(token: string): Rgba | null {
  const t = token.trim().toLowerCase();
  if (t === "white") return [255, 255, 255, 1];
  if (t === "black") return [0, 0, 0, 1];
  let m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const v = [...h].map((c) => parseInt(c + c, 16));
      return [v[0], v[1], v[2], h.length === 4 ? v[3] / 255 : 1];
    }
    if (h.length === 6 || h.length === 8) {
      const v = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
      return [v[0], v[1], v[2], h.length === 8 ? v[3] / 255 : 1];
    }
    return null;
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(t);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  return [Number(m[1]), Number(m[2]), Number(m[3]), clamp(a, 0, 1)];
}

/** [r, g, b, a] → « #rrggbb » (opaque) ou « rgba(r, g, b, a) ». */
export function formatColor([r, g, b, a]: Rgba): string {
  const c = (v: number) => Math.round(clamp(v, 0, 255));
  if (a >= 0.999) return "#" + [r, g, b].map((v) => c(v).toString(16).padStart(2, "0")).join("");
  return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${Math.round(a * 1000) / 1000})`;
}

function hexRgb(hex: string): [number, number, number] {
  const p = parseColor(hex) ?? [0, 0, 0, 1];
  return [p[0], p[1], p[2]];
}

/** Luminance relative (WCAG), de 0 à 1. */
export function luminanceOf([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastOf(a: [number, number, number], b: [number, number, number]): number {
  const la = luminanceOf(a);
  const lb = luminanceOf(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** La couleur `c` (avec son opacité) vue au-dessus du fond opaque `bg`. */
export function over(c: Rgba, bg: [number, number, number]): [number, number, number] {
  return [0, 1, 2].map((i) => bg[i] + (c[i] - bg[i]) * c[3]) as [number, number, number];
}

function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Les propriétés qui dessinent du texte ou le trait d'une icône : elles doivent rester lisibles. */
export function isTextProp(prop: string): boolean {
  return /^(color|fill|stroke|caret-color|-webkit-text-fill-color|-webkit-text-stroke-color|text-decoration-color)$/.test(prop);
}

/** Les propriétés d'ombre ou de filtre (une ombre reste une ombre). */
function isShadowProp(prop: string): boolean {
  return /shadow|filter/.test(prop);
}

/** Une couleur presque grise (blanc, gris, noir, à peine teintée) ? */
function neutral(c: Rgba): boolean {
  const [, s, l] = toHsl(c[0], c[1], c[2]);
  return s < 0.22 || l > 0.93 || l < 0.07;
}

/** Une couleur vive mais très claire ou très sombre (un fond de pastille, un texte pastel) ? */
function extreme(c: Rgba): boolean {
  const [, , l] = toHsl(c[0], c[1], c[2]);
  return l > 0.78 || l < 0.2;
}

/**
 * Une couleur de l'île sombre → la même pour l'île claire, selon la
 * propriété où elle sert (voir l'en-tête). Renvoie la couleur à écrire.
 */
export function flipColor(c: Rgba, prop: string, onDark = false): Rgba {
  const [r, g, b, a] = c;
  const [, , l] = toHsl(r, g, b);
  if (isShadowProp(prop)) {
    // Une ombre sombre reste une ombre, plus douce sur un fond clair ;
    // un reflet clair (ombre intérieure) devient un liseré d'encre léger.
    if (l < 0.5) return [r, g, b, a * 0.55];
    const ink = hexRgb(INK);
    return [ink[0], ink[1], ink[2], a * 0.6];
  }
  let out: Rgba;
  if (neutral(c)) {
    // L'échelle papier → encre : le blanc devient l'encre, le noir le papier.
    const paper = hexRgb(PAPER);
    const ink = hexRgb(INK);
    out = [0, 1, 2].map((i) => paper[i] + (ink[i] - paper[i]) * l) as unknown as Rgba;
    out[3] = a;
  } else if (extreme(c) && !isTextProp(prop)) {
    // Même teinte, luminosité opposée (un bleu nuit devient un bleu pâle).
    const [h, sat] = toHsl(r, g, b);
    const [nr, ng, nb] = fromHsl(h, sat, 1 - l);
    out = [nr, ng, nb, a];
  } else {
    out = [r, g, b, a];
  }
  // Un texte posé sur l'île claire doit rester lisible ; posé sur une pastille
  // devenue sombre (`onDark` : un bouton à la couleur d'accent), il suffit de
  // l'avoir retourné.
  if (isTextProp(prop) && !onDark) out = readableOnLight(out);
  return out;
}

/** Les variables du thème qui changent avec lui (les autres sont des couleurs vives : --glow, --peer…). */
const THEME_VARS = ["--island-bg", "--island-fg", "--accent", "--muted", "--line"];

/**
 * Le fond propre d'une règle, une fois l'île claire : "kept" pour un élément
 * de couleur vive (une pastille rouge, un point lumineux : on le laisse tel
 * quel, texte compris), "light" ou "dark" pour une surface qui se retourne
 * (le texte doit se lire dessus), null sans fond couvrant (le texte est posé
 * sur l'île).
 */
export function ownBackground(decls: Decl[]): "kept" | "light" | "dark" | null {
  let tone: "light" | "dark" | null = null;
  for (const d of decls) {
    if (!/^background(-color|-image)?$/.test(d.prop)) continue;
    for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!THEME_VARS.includes(m[1])) return "kept";
      if (m[1] === "--accent") tone = "dark"; // l'accent du thème clair est foncé
      if (m[1] === "--island-bg") tone = tone ?? "light";
    }
    for (const tok of d.value.replace(/url\([^)]*\)/g, "").match(COLOR_TOKEN) ?? []) {
      const c = parseColor(tok);
      if (!c || c[3] < 0.5) continue;
      if (!neutral(c) && !extreme(c)) return "kept";
      tone = luminanceOf(over(flipColor(c, d.prop), [255, 255, 255])) > 0.35 ? "light" : "dark";
    }
  }
  return tone;
}

/**
 * Un texte assez foncé pour 4,5:1 sur le fond le plus défavorable du verre
 * clair : on fonce la couleur (même teinte), puis on la rend plus couvrante.
 * Un texte presque invisible exprès (opacité < 0,15 : un filigrane) reste tel quel.
 */
export function readableOnLight(c: Rgba): Rgba {
  if (c[3] < 0.15) return c;
  const bg = hexRgb(WORST_LIGHT_BG);
  // Un peu de marge : la couleur est ensuite arrondie à l'entier.
  const ok = (x: Rgba) => contrastOf(over(x, bg), bg) >= TEXT_CONTRAST + 0.1;
  if (ok(c)) return c;
  const [h, s, l] = toHsl(c[0], c[1], c[2]);
  for (let k = l; k >= 0; k -= 0.02) {
    const [r, g, b] = fromHsl(h, s, k);
    const x: Rgba = [r, g, b, c[3]];
    if (ok(x)) return x;
  }
  // Même noire, trop transparente : plus couvrante.
  const [r, g, b] = fromHsl(h, s, Math.min(l, 0.2));
  for (let a = c[3]; a <= 1.0001; a += 0.05) {
    const x: Rgba = [r, g, b, Math.min(1, a)];
    if (ok(x)) return x;
  }
  return [r, g, b, 1];
}

/** Les couleurs écrites dans une valeur CSS (le nom d'une variable n'en est pas une). */
const COLOR_TOKEN = /#[0-9a-fA-F]{3,8}\b|rgba?\([^()]*\)|(?<![\w-])(?:white|black)(?![\w-])/g;

/**
 * Une valeur CSS avec ses couleurs retournées, ou null si elle n'en a pas
 * (ou si rien ne change). Les masques ne sont pas touchés (seule l'opacité y compte).
 */
export function flipValue(prop: string, value: string, onDark = false): string | null {
  if (/mask/.test(prop) || !value) return null;
  let changed = false;
  const flip = (part: string) =>
    part.replace(COLOR_TOKEN, (tok) => {
      const c = parseColor(tok);
      if (!c) return tok;
      const f = formatColor(flipColor(c, prop, onDark));
      if (f !== formatColor(c)) changed = true;
      return f;
    });
  // Une image en url(…) (une icône SVG dessinée sur sa pastille) garde ses couleurs.
  const out = value
    .split(/(url\((?:"[^"]*"|'[^']*'|[^)]*)\))/)
    .map((part) => (part.startsWith("url(") ? part : flip(part)))
    .join("");
  return changed ? out : null;
}

/** Une liste de sélecteurs coupée à ses virgules du premier niveau (pas celles de :is(a, b)). */
export function splitSelectors(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** L'attribut posé sur <html> par un thème clair (themes.ts, applyTheme). */
export const LIGHT_ATTR = '[data-theme-tone="light"]';

/**
 * Le même sélecteur, limité au thème clair, SANS changer sa spécificité
 * (`:where`) : la règle ajoutée juste après l'originale la remplace, et une
 * règle plus précise ou écrite plus loin garde le dessus, comme avant.
 */
export function scopeSelector(selector: string): string {
  return splitSelectors(selector)
    .map((s) => {
      if (/^:root(?![\w-])/.test(s)) return `:root:where(${LIGHT_ATTR})${s.slice(5)}`;
      if (/^html(?![\w-])/.test(s)) return `html:where(${LIGHT_ATTR})${s.slice(4)}`;
      return `:where(:root${LIGHT_ATTR}) ${s}`;
    })
    .join(", ");
}

/** Une déclaration d'une règle CSS. */
export interface Decl {
  prop: string;
  value: string;
  important: boolean;
}

/**
 * La règle claire qui suit une règle de l'île : son texte CSS, ou null si
 * elle n'a aucune couleur à retourner. Les règles déjà propres à un thème
 * (Verre, Givre) sont laissées telles quelles.
 */
export function lightRule(selector: string, decls: Decl[]): string | null {
  if (/data-theme/.test(selector)) return null;
  const bg = ownBackground(decls);
  if (bg === "kept") return null;
  const body: string[] = [];
  for (const d of decls) {
    const v = flipValue(d.prop, d.value, bg === "dark");
    if (v !== null) body.push(`${d.prop}: ${v}${d.important ? " !important" : ""}`);
  }
  return body.length ? `${scopeSelector(selector)} { ${body.join("; ")}; }` : null;
}
