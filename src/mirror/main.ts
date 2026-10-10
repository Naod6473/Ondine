// Un reflet de l'île sur un autre écran (1.2.3, src-tauri/src/island/mirrors.rs) :
// une petite encoche aux couleurs du thème, avec Ondine qui somnole. Aucune
// logique ici : la fenêtre est transparente aux clics, c'est le Rust qui voit
// la souris la toucher et fait venir l'île. La page demande son apparence au
// chargement (ce qui dit aussi au Rust qu'elle peut être montrée), puis le
// Rust la lui renvoie quand elle change (thème, bord, mascotte).

import { Bridge, type MirrorLook } from "../core/bridge";
import { effectiveThemeId, themeFor } from "../island/themes";

const box = document.getElementById("mirror")!;
const SVG_NS = "http://www.w3.org/2000/svg";

/** Ondine en goutte gomme, les yeux fermés (palette de gum-draw.ts). */
function drop(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "mirror-ondine");
  svg.innerHTML =
    '<defs><radialGradient id="g" cx="38%" cy="34%" r="75%">' +
    '<stop offset="0" stop-color="#c9f0ff"/><stop offset="0.35" stop-color="#5cc8ff"/>' +
    '<stop offset="0.75" stop-color="#1f86e0"/><stop offset="1" stop-color="#145a9e"/></radialGradient></defs>' +
    '<path d="M12 2.6c3.7 4.2 7.2 8 7.2 12A7.2 7.2 0 0 1 4.8 14.6c0-4 3.5-7.8 7.2-12z" fill="url(#g)"/>' +
    '<ellipse cx="9.3" cy="10.4" rx="1.7" ry="2.4" fill="#fff" opacity="0.55" transform="rotate(-24 9.3 10.4)"/>' +
    '<path d="M8.8 15.2q1.1 1 2.2 0M13 15.2q1.1 1 2.2 0" fill="none" stroke="#2a2840" stroke-width="1.15" stroke-linecap="round"/>';
  return svg;
}

function apply(look: MirrorLook) {
  const theme = themeFor(effectiveThemeId(look.theme, look.style), look.color);
  document.documentElement.style.setProperty("--mirror-bg", theme.bg);
  document.documentElement.style.setProperty("--mirror-accent", theme.accent);
  document.documentElement.dataset.themeTone = theme.light ? "light" : "dark";
  document.body.dataset.edge = ["top", "bottom", "left", "right"].includes(look.edge) ? look.edge : "top";
  box.replaceChildren(look.mascot ? drop() : Object.assign(document.createElement("i"), { className: "mirror-dot" }));
}

// Le Rust renvoie l'apparence quand elle change (WebviewWindow::eval).
(window as unknown as { __ondineMirror: (l: MirrorLook) => void }).__ondineMirror = apply;

apply({ edge: "top", theme: "nuit", color: "", mascot: true, style: "classic" });
void Bridge.mirrorLook().then((look) => look && apply(look));
