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
//
// En largeur aussi, avec `data-island-fit="both"` (variable --fit-w) : une
// réponse courte, sur une ou deux lignes, donne une île plus étroite ; un
// contenu large (un bloc de code) l'élargit un peu. Jamais plus étroite que
// les onglets ni que FIT_MIN_W, jamais plus large que la fenêtre. Seule la
// partie marquée `data-island-fit-w` compte, s'il y en a une (la liste des
// bulles d'une conversation : le champ de saisie, lui, prend toute la place).
//
// La mesure est CONTINUE : island.ts observe le contenu marqué
// (ResizeObserver, et le texte qui change) pour suivre une réponse qui s'écrit
// mot à mot. Pour que l'île ne saute pas à chaque mot, la gelée passe alors en
// « glisse » (jelly.ts, setGlide) : un ressort amorti, sans rebond, qui garde
// sa vitesse quand la cible bouge et la rattrape en douceur.

/** La hauteur habituelle de l'île ouverte (px, island.css). */
export const BASE_H = 270;
/** Au plus (px) : le panneau haut (530) garde de la place pour l'étirement (gestures.ts). */
export const FIT_MAX_H = 480;
/** L'attribut d'un contenu à montrer en entier. */
export const FIT_ATTR = "data-island-fit";
/** La largeur habituelle de l'île ouverte (px, island.css). */
export const BASE_W = 640;
/** Au moins (px) : en dessous, l'île ouverte n'est plus lisible. */
export const FIT_MIN_W = 420;
/** Au plus (px) : la fenêtre fait 720 px ; sur un côté de l'écran, l'étirement
    (gestures.ts, 42 px) se fait en largeur, il lui faut de la place. */
export const FIT_MAX_W = 700;
export const FIT_MAX_W_SIDE = 676;
/** La part de la largeur que le contenu occupe : un peu d'air autour, et une
    bulle de conversation (au plus 85 % de large) ne se replie pas. */
export const FIT_W_FILL = 0.85;
/** Dans un contenu `both`, la partie dont la largeur compte (une liste de
    bulles), quand le reste (champ de saisie, notes) s'adapte à toute largeur. */
export const FIT_W_ATTR = "data-island-fit-w";

/** Ce que demande la valeur de l'attribut : la hauteur seule (par défaut), ou aussi la largeur. */
export function fitMode(value: string | null): "height" | "both" {
  return value === "both" ? "both" : "height";
}

/**
 * La largeur de l'île pour son contenu, ou null si la largeur habituelle
 * convient. `island` et `view` : les largeurs actuelles de l'île et de la vue ;
 * `content` : la largeur naturelle du contenu (sans retour à la ligne) ;
 * `min` : au moins (les onglets) ; `max` : au plus (la fenêtre).
 */
export function fitWidth(island: number, view: number, content: number, min = FIT_MIN_W, max = FIT_MAX_W): number | null {
  const want = Math.ceil(island - view + content / FIT_W_FILL);
  // Les onglets ne demandent jamais plus que la largeur habituelle (au-delà, ils défilent déjà).
  const lo = Math.min(BASE_W, Math.max(FIT_MIN_W, min));
  const w = Math.max(lo, Math.min(max, want));
  // Quelques pixels près de la largeur habituelle : on ne bouge pas.
  return Math.abs(w - BASE_W) <= 4 ? null : w;
}

/**
 * La largeur naturelle d'un contenu (sans retour à la ligne), mesurée en le
 * mettant un instant en `max-content` : rien n'est dessiné entre les deux, et
 * cette mesure ne dépend pas de la largeur de l'île (pas d'aller-retour).
 */
export function naturalWidth(el: HTMLElement): number {
  const st = el.style;
  const saved = [st.width, st.maxWidth];
  st.width = "max-content";
  st.maxWidth = "none";
  const w = el.offsetWidth;
  st.width = saved[0];
  st.maxWidth = saved[1];
  const cs = getComputedStyle(el);
  return w + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0);
}

/**
 * Suit une cible qui bouge (un texte qui s'écrit) sans va-et-vient : elle
 * grandit dès que le contenu le demande (rien n'est jamais coupé), mais ne
 * rétrécit que si elle est nettement trop grande (plus de 2 × `step` px,
 * hystérésis) : un mot qui passe à la ligne puis revient ne la fait pas
 * trembler. Sans page ni horloge (testé par Node).
 */
export function settle(current: number | null, want: number | null, step = 8): number | null {
  if (want === null || current === null) return want;
  if (want >= current) return want;
  return current - want > step * 2 ? want : current;
}

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
