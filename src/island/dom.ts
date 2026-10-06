// Petite aide pour créer des éléments HTML sans framework.
//
//   el("button", { class: "btn", onclick: () => … }, "Texte")
//
// Les enfants de type texte sont insérés comme TEXTE (jamais comme HTML) :
// aucun contenu venant d'un fichier ou d'une page ne peut s'exécuter.

type Attrs = Record<string, string | number | boolean | ((e: any) => void) | undefined>;
type Child = Node | string | number | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") {
      node.addEventListener(key.replace(/^on/, ""), value);
    } else if (key === "class") {
      node.className = String(value);
    } else if (value === true) {
      node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "object" ? child : String(child));
  }
  nameIconButton(node);
  return node;
}

/**
 * Un bouton-icône (« × », « ⚙ », une icône dessinée) n'a pas de nom lisible
 * pour un lecteur d'écran : il annoncerait « multiplication ». S'il a une
 * bulle (title) et aucun texte en lettres ou chiffres, sa bulle devient son
 * nom (aria-label), traduit comme le reste par i18n.ts.
 */
function nameIconButton(node: HTMLElement) {
  if (node.tagName !== "BUTTON" || node.hasAttribute("aria-label")) return;
  const title = node.getAttribute("title");
  if (title && !/[\p{L}\p{N}]/u.test(node.textContent ?? "")) node.setAttribute("aria-label", title);
}

export function clear(node: HTMLElement) {
  node.replaceChildren();
}
