// Une seule façon d'afficher une icône, partout (onglets, notifications,
// lanceur, réglages, cibles de dépôt).
//
// Une icône reste une simple chaîne :
//   - un emoji qui a son image (« 📅 » → src/assets/icons/agenda.webp) est
//     affiché en image, partout où il apparaît ;
//   - un autre emoji est affiché tel quel, comme du texte ;
//   - « logo:claude » désigne un logo fourni avec l'île.
// Ainsi les manifestes et les notifications ne changent pas : pour donner une
// image à un emoji, il suffit d'ajouter une ligne dans BY_EMOJI.

import claudeLogo from "../assets/logos/claude.svg?url";
import geminiLogo from "../assets/logos/gemini.svg?url";

// Toutes les images de src/assets/icons, par nom de fichier (« agenda »…).
// Vite les copie avec l'appli et nous donne leur adresse.
const files = import.meta.glob<string>("../assets/icons/*.webp", { eager: true, query: "?url", import: "default" });
const byName = (name: string) => files[`../assets/icons/${name}.webp`];

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
};

/** Les images connues. Une clé « logo: » absente retombe sur FALLBACK. */
const IMAGES: Record<string, string> = {
  "logo:claude": claudeLogo,
  "logo:gemini": geminiLogo,
};
// Codex : une icône à nous (un « codex », livre de code), pas le logo d'OpenAI.
if (byName("codex")) IMAGES["logo:codex"] = byName("codex");
for (const [emoji, name] of Object.entries(BY_EMOJI)) {
  const url = byName(name);
  if (url) IMAGES[emoji] = url;
}

/** Si une image manque (logo pas encore fourni), on montre ceci. */
const FALLBACK = "✳️";

/** Le nœud à mettre dans un `<span class="…-icon">`. */
export function icon(name: string): Node {
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
  return document.createTextNode(name.includes(":") ? FALLBACK : name);
}

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
