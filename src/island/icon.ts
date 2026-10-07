// Une seule façon d'afficher une icône, partout (onglets, notifications,
// lanceur, réglages, cibles de dépôt).
//
// Une icône reste une simple chaîne :
//   - un emoji qui a son image (« 📅 » → src/assets/icons/agenda.webp) est
//     affiché en image, partout où il apparaît ;
//   - un autre emoji est affiché tel quel, comme du texte ;
//   - « logo:claude », « logo:gemini », « logo:codex » désignent les icônes
//     des agents. Ce sont des icônes à nous, jamais les logos des marques.
// Ainsi les manifestes et les notifications ne changent pas : pour donner une
// image à un emoji, il suffit d'ajouter une ligne dans BY_EMOJI.
//
// Deux packs d'icônes (réglage Apparence → « Icônes ») :
//   - « color » : les icônes dessinées en couleur (src/assets/icons/*.webp) ;
//   - « line » : des icônes au trait, sobres, façon Apple (Phosphor, licence
//     MIT, src/assets/icons-line/*.svg). Elles prennent la couleur du texte.
// Changer de pack remplace les icônes déjà affichées, sans rien recharger.
//
// Les petits pictogrammes DANS les modules (« 📄 Copier vers… », 🗑️ d'une
// ligne, ⚠️ d'un message) suivent aussi le pack : en « color » ils restent des
// emojis (texte), en « line » ils deviennent des icônes au trait. C'est el()
// (dom.ts) qui découpe les libellés avec glyphs() ; pour un texte réécrit plus
// tard, setText() (core/perf.ts) ou setLabel() ci-dessous.

import { settingsStore } from "../core/settings-store";

// Toutes les images de src/assets/icons, par nom de fichier (« agenda »…).
// Vite les copie avec l'appli et nous donne leur adresse.
const files = import.meta.glob<string>("../assets/icons/*.webp", { eager: true, query: "?url", import: "default" });
const byName = (name: string) => files[`../assets/icons/${name}.webp`];
// Le pack « au trait » : mêmes noms de fichiers, en .svg.
const lineFiles = import.meta.glob<string>("../assets/icons-line/*.svg", { eager: true, query: "?url", import: "default" });
const lineByName = (name: string) => lineFiles[`../assets/icons-line/${name}.svg`];

/** L'emoji d'origine → le nom de son image (icônes dessinées pour l'île). */
const BY_EMOJI: Record<string, string> = {
  "📅": "agenda",
  "🎚️": "controls",
  "🤖": "agents",
  "💬": "askclaude",
  "✂️": "capture",
  "📋": "clipboard",
  "🚀": "launcher",
  "🎵": "media",
  "🌐": "nettools",
  "📝": "notes",
  "📡": "remote",
  "⚡": "rules",
  "🧺": "shelf",
  "📊": "system",
  "🖥️": "terminal",
  "⏱️": "timer",
  "⚙️": "general",
  "🗂️": "tabs",
  "💧": "mascot",
  "🛡️": "privacy",
  "🔑": "credentials",
  "💾": "backup",
  "☕": "pauses",
  "🎨": "appearance",
  // Pas encore d'image en couleur : l'emoji reste affiché dans ce pack.
  "🌤️": "weather",
  "🧭": "profiles",
};

/**
 * Pictogrammes sans image en couleur, dessinés seulement dans le pack au
 * trait (nom d'un .svg de src/assets/icons-line, copié de Phosphor « regular »).
 * Clés sans le « \uFE0F » final (« ⚠ » vaut pour « ⚠️ »).
 * Les flèches et signes simples (→ ↑ ↓ ← ↗ ‹ ✕ ✓ ↺ ↻ ＋ ★ ⚑ ○ ⋯) n'y sont pas :
 * ce sont déjà des caractères sobres, de la couleur du texte.
 */
const LINE_ONLY: Record<string, string> = {
  "⚠": "warning",
  "📄": "file",
  "✅": "check-circle",
  "✔": "check-circle",
  "☑": "check-square",
  "✏": "pencil-simple",
  "🔐": "lock-key",
  "🔒": "lock",
  "🔓": "lock-open",
  "🗑": "trash",
  "⌨": "keyboard",
  "🖼": "image",
  "🍅": "orange",
  "↩": "arrow-u-up-left",
  "🎧": "headphones",
  "📁": "folder",
  "📂": "folder-open",
  "⏸": "pause",
  "⏹": "stop",
  "▶": "play",
  "⏯": "play-pause",
  "⏭": "skip-forward",
  "⏮": "skip-back",
  "📦": "package",
  "🔤": "text-t",
  "🔠": "text-aa",
  "🔗": "link",
  "🔎": "magnifying-glass",
  "🔍": "magnifying-glass",
  "🔌": "plug",
  "📌": "push-pin",
  "📍": "map-pin",
  "🎥": "video-camera",
  "🎬": "film-slate",
  "✋": "hand-palm",
  "👋": "hand-waving",
  "❓": "question",
  "⏳": "hourglass-medium",
  "⌛": "hourglass-low",
  "📵": "wifi-slash",
  "🌍": "globe-hemisphere-west",
  "📶": "cell-signal-full",
  "⭐": "star",
  "🗜": "file-zip",
  "💽": "hard-drives",
  "🎫": "ticket",
  "🌙": "moon",
  "🌴": "tree-palm",
  "🔄": "arrows-clockwise",
  "🧠": "brain",
  "⛔": "prohibit",
  "⬆": "arrow-up",
  "⬇": "arrow-down",
  "🧹": "broom",
  "🎉": "confetti",
  "🔇": "speaker-slash",
  "🎙": "microphone",
  "🛠": "wrench",
  "🔖": "bookmark-simple",
  "📤": "export",
  "📥": "tray-arrow-down",
  "🪫": "battery-low",
  "🔋": "battery-full",
  "⏲": "clock-countdown",
  "🔕": "bell-slash",
  "🔔": "bell",
  "🧪": "flask",
  "🎯": "target",
  "✳": "asterisk",
  "✨": "sparkle",
  "☀": "sun",
  "⛅": "cloud-sun",
  "☁": "cloud",
  "🌫": "cloud-fog",
  "🌦": "cloud-rain",
  "🌧": "cloud-rain",
  "🌨": "cloud-snow",
  "⛈": "cloud-lightning",
  "🌡": "thermometer",
  "🙂": "smiley",
  "⏰": "alarm",
  "📱": "device-mobile",
};

/** Les images connues. Une clé « logo: » absente retombe sur FALLBACK. */
const IMAGES: Record<string, string> = {};
// Les agents : des icônes maison (un C, un G, un « codex », livre de code),
// pas les logos d'Anthropic, de Google ni d'OpenAI.
const AGENTS = ["claude", "gemini", "codex"];
for (const name of AGENTS) if (byName(name)) IMAGES[`logo:${name}`] = byName(name);
for (const [emoji, name] of Object.entries(BY_EMOJI)) {
  const url = byName(name);
  if (url) IMAGES[emoji] = url;
}

/** Si une image manque (logo pas encore fourni), on montre ceci. */
const FALLBACK = "✳️";

/** Le pack au trait : emoji (ou « logo:codex ») → adresse du .svg. */
const LINE: Record<string, string> = {};
for (const [emoji, name] of Object.entries(BY_EMOJI)) {
  const url = lineByName(name);
  if (url) LINE[emoji] = url;
}
for (const name of AGENTS) if (lineByName(name)) LINE[`logo:${name}`] = lineByName(name);

/** Le .svg au trait d'un pictogramme (avec ou sans \uFE0F), s'il en a un. */
const VS16 = /\uFE0F/g;
const GLYPH_LINE: Record<string, string> = {};
for (const [emoji, name] of [...Object.entries(LINE_ONLY), ...Object.entries(BY_EMOJI)]) {
  const url = lineByName(name);
  if (url) GLYPH_LINE[emoji.replace(VS16, "")] = url;
}
const glyphLine = (emoji: string): string | undefined => GLYPH_LINE[emoji.replace(VS16, "")];

export type IconPack = "color" | "line";

function pack(): IconPack {
  return settingsStore.current.island.iconPack === "line" ? "line" : "color";
}

/** Le nœud à mettre dans un `<span class="…-icon">`. */
export function icon(name: string): Node {
  shownPack ??= pack();
  const node = draw(name, shownPack);
  // On garde le nom : un changement de pack sait quoi redessiner.
  if (node instanceof HTMLElement) node.dataset.icon = name;
  return node;
}

function draw(name: string, p: IconPack): Node {
  // Au trait : l'icône de l'onglet, sinon celle du pictogramme (☕, 🌤️, 📁…).
  const line = p === "line" ? (LINE[name] ?? glyphLine(name)) : undefined;
  if (line) {
    // Un masque : la forme du .svg, remplie avec la couleur du texte.
    return lineSpan(line);
  }
  const src = IMAGES[name];
  if (src) {
    const img = document.createElement("img");
    img.className = "icon-img";
    img.src = src;
    img.alt = "";
    img.draggable = false;
    return img;
  }
  // Un nom d'image inconnu ne doit jamais s'afficher en texte brut.
  // Un emoji sans image : du texte, dans un <span> pour qu'un changement de
  // pack puisse le retrouver (il a peut-être une icône au trait).
  const span = document.createElement("span");
  span.textContent = name.includes(":") ? FALLBACK : name;
  return span;
}

function lineSpan(url: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "icon-line";
  span.style.setProperty("--src", `url("${url}")`);
  return span;
}

// ── Pictogrammes dans les libellés ───────────────────────────────────────────

// Un pictogramme connu, avec son « \uFE0F » éventuel. Les plus longs d'abord.
const GLYPH_RX = new RegExp(
  `(?:${Object.keys(GLYPH_LINE)
    .sort((a, b) => b.length - a.length)
    .map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})\uFE0F?`,
  "u",
);
// Une suite de pictogrammes (et d'espaces) au début, ou à la fin, du texte.
const LEAD_RX = new RegExp(`^(?:\\s*${GLYPH_RX.source})+`, "u");
const TRAIL_RX = new RegExp(`(?:${GLYPH_RX.source}\\s*)+$`, "u");
const ONE_RX = new RegExp(GLYPH_RX.source, "gu");

/**
 * Un pictogramme seul (« 🗑️ ») : en « color » l'emoji tel quel (du texte),
 * en « line » son icône au trait. Garde l'emoji dans data-glyph pour le
 * redessiner quand le pack change.
 */
export function glyph(emoji: string): HTMLElement {
  shownPack ??= pack();
  const node = drawGlyph(emoji, shownPack);
  node.dataset.glyph = emoji;
  return node;
}

function drawGlyph(emoji: string, p: IconPack): HTMLElement {
  const url = p === "line" ? glyphLine(emoji) : undefined;
  if (url) return lineSpan(url);
  const span = document.createElement("span");
  span.textContent = emoji;
  return span;
}

/**
 * Découpe un libellé : « 📄 Copier vers… » → [glyph("📄"), " Copier vers…"].
 * Seuls les pictogrammes du DÉBUT et de la FIN sont découpés : le texte du
 * milieu reste d'un seul morceau, pour que la traduction (i18n.ts) le trouve
 * (« Copier vers… » est retrouvé grâce à l'entrée « 📄 Copier vers… »).
 * Un texte sans pictogramme est rendu tel quel.
 */
export function glyphs(text: string): (Node | string)[] {
  if (!text || !GLYPH_RX.test(text)) return [text];
  const lead = LEAD_RX.exec(text)?.[0] ?? "";
  const rest = text.slice(lead.length);
  // Tout le texte n'est que pictogrammes : la fin est déjà dans `lead`.
  const trail = rest ? (TRAIL_RX.exec(rest)?.[0] ?? "") : "";
  const middle = rest.slice(0, rest.length - trail.length);
  const out: (Node | string)[] = [];
  const split = (part: string) => {
    let last = 0;
    for (const m of part.matchAll(ONE_RX)) {
      if (m.index! > last) out.push(part.slice(last, m.index));
      out.push(glyph(m[0]));
      last = m.index! + m[0].length;
    }
    if (last < part.length) out.push(part.slice(last));
  };
  split(lead);
  if (middle) out.push(middle);
  split(trail);
  return out;
}

/** Remplace le contenu de `node` par le libellé `text` (pictogrammes compris). */
export function setLabel(node: Node, text: string) {
  if (node instanceof Element) node.replaceChildren(...glyphs(text));
  else node.textContent = text;
}

// Le pack change dans les réglages : on redessine les icônes déjà affichées.
let shownPack: IconPack | null = null;
settingsStore.onChange(() => {
  const p = pack();
  if (shownPack === null || p === shownPack) return;
  shownPack = p;
  document.querySelectorAll<HTMLElement>("[data-icon]").forEach((old) => {
    const name = old.dataset.icon!;
    const fresh = draw(name, p);
    if (fresh instanceof HTMLElement) fresh.dataset.icon = name;
    old.replaceWith(fresh);
  });
  document.querySelectorAll<HTMLElement>("[data-glyph]").forEach((old) => {
    const emoji = old.dataset.glyph!;
    const fresh = drawGlyph(emoji, p);
    fresh.dataset.glyph = emoji;
    old.replaceWith(fresh);
  });
});

/**
 * L'icône d'un agent IA, d'après son nom (« claude », « claude-code »,
 * « gemini », « codex »…).
 */
export function agentIcon(tool: string): string {
  const t = tool.toLowerCase();
  if (t.includes("claude")) return "logo:claude";
  if (t.includes("gemini")) return "logo:gemini";
  if (t.includes("codex")) return "logo:codex";
  return "🤖";
}
