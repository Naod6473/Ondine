// L'île ouverte s'adapte à son contenu, de temps en temps.
//
// D'habitude, l'île ouverte garde sa taille (270 px de haut, island.css) et un
// contenu trop long défile. Mais certains contenus doivent se voir en entier :
// un QR code coupé ne se lit pas. Une vue les marque avec l'attribut
// `data-island-fit`, et l'île grandit juste assez pour tout montrer, avec le
// même ressort que ses autres changements de forme. Quand le contenu marqué
// s'en va (« Retour », autre onglet), elle reprend sa taille.
//
// La hauteur passe par la variable CSS --fit-h. La fenêtre de l'île doit être
// assez haute : island.ts demande d'abord le panneau haut au Rust
// (`island_set_tall`, TALL_PANEL_H dans src-tauri/src/island/mod.rs), puis le
// rend quand l'île a fini de rétrécir.

/** La hauteur habituelle de l'île ouverte (px, island.css). */
export const BASE_H = 270;
/** Au plus (px) : le panneau haut (530) garde de la place pour l'étirement (gestures.ts). */
export const FIT_MAX_H = 480;
/** L'attribut d'un contenu à montrer en entier. */
export const FIT_ATTR = "data-island-fit";

/**
 * La hauteur de l'île pour montrer tout le contenu d'une vue, ou null si la
 * taille habituelle suffit. `island` et `view` : les hauteurs actuelles de
 * l'île et de la vue (la différence, ce sont les onglets et les marges, qui
 * ne changent pas quand l'île grandit) ; `content` : la hauteur du contenu.
 */
export function fitHeight(island: number, view: number, content: number): number | null {
  const want = Math.ceil(island - view + content);
  if (want <= BASE_H) return null;
  return Math.min(FIT_MAX_H, want);
}

/**
 * La hauteur du contenu d'une vue, mesurée sur la mise en page (offsetTop,
 * offsetHeight) : les animations d'arrivée, qui décalent les morceaux de
 * quelques pixels (motion.ts), ne la faussent pas.
 */
export function contentHeight(view: HTMLElement): number {
  let bottom = 0;
  for (const child of view.children) {
    if (!(child instanceof HTMLElement)) continue;
    // offsetTop compte depuis l'ancêtre positionné : la vue, ou le même que la vue.
    const top = child.offsetParent === view ? child.offsetTop : child.offsetTop - view.offsetTop;
    const margin = parseFloat(getComputedStyle(child).marginBottom) || 0;
    bottom = Math.max(bottom, top + child.offsetHeight + margin);
  }
  return bottom + (parseFloat(getComputedStyle(view).paddingBottom) || 0);
}
