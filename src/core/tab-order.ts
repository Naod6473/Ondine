// L'ordre des onglets choisi par l'utilisateur (réglage `island.tabOrder`).
//
// Le réglage est une liste d'ids de modules. Un module qui n'y est pas (nouveau
// module, ou réglage jamais touché) garde sa place d'origine, après ceux qui
// y sont : ajouter un module ne bouscule jamais l'ordre déjà choisi.

export function applyTabOrder<T>(items: T[], idOf: (item: T) => string, order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return items
    .map((item, i) => ({ item, i, r: rank.get(idOf(item)) }))
    .sort((a, b) => {
      if (a.r !== undefined && b.r !== undefined) return a.r - b.r;
      if (a.r !== undefined) return -1;
      if (b.r !== undefined) return 1;
      return a.i - b.i;
    })
    .map((x) => x.item);
}

/**
 * Le nouvel ordre complet après avoir déplacé des onglets : `visible` est
 * l'ordre affiché (modules actifs), `all` tous les modules connus. Les modules
 * désactivés gardent leur rang relatif, pour retrouver leur place s'ils
 * reviennent.
 */
export function mergeOrder(visible: string[], all: string[]): string[] {
  const shown = new Set(visible);
  const out: string[] = [];
  let v = 0;
  for (const id of all) {
    // Chaque place occupée par un onglet visible reçoit le suivant dans le nouvel ordre.
    out.push(shown.has(id) ? visible[v++] : id);
  }
  // Par sécurité : un id visible absent de `all` est ajouté à la fin.
  for (; v < visible.length; v++) if (!out.includes(visible[v])) out.push(visible[v]);
  return out;
}
