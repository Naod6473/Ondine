// Une seule façon d'afficher une icône, partout (onglets, notifications,
// lanceur, réglages, cibles de dépôt).
//
// Une icône reste une simple chaîne :
//   - un emoji (« 📅 ») est affiché tel quel, comme du texte ;
//   - « logo:claude » désigne une image fournie avec l'île (voir IMAGES).
// Ainsi les manifestes et les notifications ne changent pas de forme : pour
// remplacer un emoji par une image, il suffit d'ajouter l'image ici.

import claudeLogo from "../assets/logos/claude.svg?url";
import geminiLogo from "../assets/logos/gemini.svg?url";

/** Les images connues. Une clé absente retombe sur FALLBACK. */
const IMAGES: Record<string, string> = {
  "logo:claude": claudeLogo,
  "logo:gemini": geminiLogo,
};

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
 * « gemini », « codex »…). Codex n'a pas encore de logo : un terminal.
 */
export function agentIcon(tool: string): string {
  const t = tool.toLowerCase();
  if (t.includes("claude")) return "logo:claude";
  if (t.includes("gemini")) return "logo:gemini";
  if (t.includes("codex")) return "⌨️";
  return "🤖";
}
