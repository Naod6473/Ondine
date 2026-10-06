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
  const line = p === "line" ? LINE[name] : undefined;
  if (line) {
    // Un masque : la forme du .svg, remplie avec la couleur du texte.
    const span = document.createElement("span");
    span.className = "icon-line";
    span.style.setProperty("--src", `url("${line}")`);
    return span;
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
