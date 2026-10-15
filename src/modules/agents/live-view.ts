// Les fichiers modifiés en direct (onglet Agents IA, 1.2.4) : sous chaque
// session du tableau, les fichiers que l'agent vient de modifier, avec
// « +12 −3 » ; un clic ouvre le changement dans un panneau de l'onglet, en
// lecture seule (rien n'est ouvert ni exécuté). Le Rust
// (src-tauri/src/modules/agents_live.rs) garde tout en mémoire et oublie les
// fichiers d'une session à son message suivant.
//
// Une nouvelle puce arrive avec une petite gelée (CSS, coupée avec « Réduire
// les animations », Calme et en mode éco) ; les puces déjà vues ne rejouent rien.

import { errorText } from "../../core/log";
import type { ModuleApi } from "../../core/module-types";
import { settingsStore } from "../../core/settings-store";
import { el } from "../../island/dom";
import { reducedMotion } from "../../island/tab-pill";
import { filesOf, lineClass, lineSymbol, liveCounts, type LiveDiff, type LiveFile } from "./live-logic";

export function liveOn(api: ModuleApi): boolean {
  return api.settings().liveFiles !== false;
}

/** Les ids déjà montrés (pour n'animer que les nouveaux). */
const seen = new Set<string>();

/** La rangée de puces d'une session (vide si elle n'a rien modifié). */
export function liveRow(files: LiveFile[], session: string, open: (f: LiveFile) => void): HTMLElement {
  const { shown, more } = filesOf(files, session);
  const row = el("ul", { class: "agents-live", "aria-label": "Fichiers modifiés" });
  for (const f of shown) {
    const key = `${f.id}:${f.added}:${f.removed}`;
    const fresh = !seen.has(key);
    seen.add(key);
    const { plus, minus } = liveCounts(f);
    const chip = el(
      "button",
      { class: "agents-live-file", title: "Voir le changement", onclick: () => open(f) },
      // Un nom de fichier : jamais traduit.
      el("code", { "data-no-i18n": true }, f.name),
      plus ? el("span", { class: "diff-add" }, plus) : null,
      minus ? el("span", { class: "diff-del" }, minus) : null,
    );
    // Déjà vue, « Réduire les animations » ou Calme : pas de gelée.
    if (!fresh || reducedMotion() || settingsStore.current.mascot.calm === true) chip.style.animation = "none";
    row.append(el("li", {}, chip));
  }
  if (more) row.append(el("li", { class: "muted" }, `+ ${more} autre${more > 1 ? "s" : ""}`));
  if (seen.size > 500) seen.clear();
  return row;
}

/** Le panneau du changement : `show(f)` le remplit, « ✕ » le vide. */
export function diffPanel(api: ModuleApi, box: HTMLElement): { show(f: LiveFile): Promise<void> } {
  let current = 0;
  const close = () => {
    current = 0;
    box.replaceChildren();
  };
  const head = (f: LiveFile) => {
    const { plus, minus } = liveCounts(f);
    return el(
      "div",
      { class: "agents-diff-head" },
      el("code", { "data-no-i18n": true, title: f.folder ? `${f.folder}/${f.name}` : f.name }, f.name),
      f.isNew ? el("small", { class: "muted" }, "nouveau") : null,
      plus ? el("span", { class: "diff-add" }, plus) : null,
      minus ? el("span", { class: "diff-del" }, minus) : null,
      el("button", { class: "btn small", title: "Fermer le changement", onclick: api.handler(close) }, "✕"),
    );
  };
  const show = async (f: LiveFile) => {
    current = f.id;
    box.replaceChildren(head(f), el("p", { class: "muted" }, "Lecture…"));
    let d: LiveDiff;
    try {
      d = await api.invoke<LiveDiff>("live_diff", { id: f.id });
    } catch (err) {
      if (current === f.id) box.replaceChildren(head(f), el("p", { class: "muted" }, errorText(err)));
      return;
    }
    if (current !== f.id) return;
    const body = d.tooLarge && !d.lines.length
      ? el("p", { class: "muted" }, "Changement trop gros pour être montré : seulement les nombres.")
      : el(
          "div",
          { class: "agents-diff-lines", role: "region", "aria-label": "Changement, en lecture seule", "data-no-i18n": true },
          ...d.lines.map(([kind, text]) => el("div", { class: `agents-diff-line ${lineClass(kind)}` }, el("span", { class: "sym" }, lineSymbol(kind)), el("span", {}, text))),
        );
    box.replaceChildren(head(d), body, ...(d.cut ? [el("p", { class: "muted" }, "Coupé : seulement une partie du changement est gardée.")] : []));
  };
  return { show };
}
