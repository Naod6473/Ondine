// Lire CHANGELOG.md, pour « Quoi de neuf » après une mise à jour (whats-new.ts).
//
// Rien d'autre que du texte ici (pas de fenêtre, pas de Tauri) : les tests
// (tests/front/changelog.test.ts) lisent le vrai fichier et vérifient tout.
//
// La forme du fichier :
//
//   ## 1.0.1 · 2026-10-07
//
//   - Une phrase en français. · A sentence in English.
//   - Une puce peut continuer sur la ligne suivante, en retrait,
//     comme celle-ci. · A bullet can go on over several lines.
//
// Chaque puce est « français · English » : on garde la moitié de la langue de
// l'interface.

/** Une version du journal des changements. */
export interface ChangelogSection {
  /** « 1.0.1 », « 1.0.0-beta.3 ». */
  version: string;
  /** « 2026-10-07 », ou "" si le titre n'en donne pas. */
  date: string;
  /** Les puces, chacune sur une seule ligne (les retours à la ligne du fichier sont recollés). */
  items: string[];
}

/** « ## 1.0.1 · 2026-10-07 », « ## [1.0.1] - 2026-10-07 », « ## v1.0.0-beta.3 ». */
const SECTION = /^##\s+\[?v?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)\]?\s*(?:[·—–-]\s*(.*))?$/;
/** Une puce : « - texte » ou « * texte », au début de la ligne. */
const BULLET = /^[-*]\s+(.*)$/;

/** Toutes les versions du fichier, dans l'ordre du fichier (la plus récente en haut). */
export function parseChangelog(text: string): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  let section: ChangelogSection | null = null;
  let item: string[] | null = null;
  const closeItem = () => {
    const joined = (item ?? []).join(" ").replace(/\s+/g, " ").trim();
    if (section && joined) section.items.push(joined);
    item = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith("#")) {
      // Un nouveau titre ferme la puce en cours. « ## version » ouvre une
      // section ; un autre titre (« # Changements », « ### Ajouts ») non.
      closeItem();
      const m = SECTION.exec(line);
      if (m) {
        section = { version: m[1], date: (m[2] ?? "").trim(), items: [] };
        sections.push(section);
      } else if (/^##\s/.test(line)) {
        section = null; // « ## Pas encore publié » : pas une version
      }
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      closeItem();
      item = [bullet[1]];
    } else if (item && /^\s+\S/.test(line)) {
      item.push(line.trim()); // la suite de la puce, en retrait
    } else {
      closeItem(); // ligne vide, ou paragraphe hors puce
    }
  }
  closeItem();
  return sections;
}

/** La section de cette version (« 1.0.1 » ou « v1.0.1 »), ou null si le fichier n'en parle pas. */
export function changelogSection(text: string, version: string): ChangelogSection | null {
  const wanted = version.trim().replace(/^v/, "");
  return parseChangelog(text).find((s) => s.version === wanted) ?? null;
}

/**
 * Coupe une puce « français · English » en deux. On coupe au premier « · »
 * qui suit une fin de phrase (« . », « ! », « ? », « … », éventuellement suivis
 * de « ) » ou « » ») ; sinon au premier « · » ; sans « · », les deux moitiés
 * sont le texte entier.
 */
export function splitBilingual(item: string): { fr: string; en: string } {
  const m = /(?<=[.!?…][)»"]?)\s+·\s+/.exec(item) ?? /\s+·\s+/.exec(item);
  if (!m) return { fr: item.trim(), en: item.trim() };
  return { fr: item.slice(0, m.index).trim(), en: item.slice(m.index + m[0].length).trim() };
}

/** Raccourcit une ligne trop longue pour la notification (au mot près, avec « … »). */
export function shorten(line: string, max: number): string {
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:·]+$/, "")}…`;
}

/**
 * Les premières lignes de nouveautés de `version`, dans la langue `lang`
 * (« fr » : la moitié française, sinon l'anglaise). null si la version n'est
 * pas dans le fichier.
 */
export function whatsNewLines(text: string, version: string, lang: string, max = 3, maxChars = 120): string[] | null {
  const section = changelogSection(text, version);
  if (!section) return null;
  return section.items.slice(0, max).map((item) => {
    const halves = splitBilingual(item);
    return shorten(lang === "fr" ? halves.fr : halves.en, maxChars);
  });
}

/**
 * Au démarrage, que faire de « Quoi de neuf » ?
 *   - "show" : montrer la notification (et retenir la version) ;
 *   - "remember" : seulement retenir la version (premier lancement) ;
 *   - "nothing" : rien (même version, mode démo, version de développement) ;
 *     en mode démo, une version jamais notée est seulement retenue.
 * `seen` = réglage general.lastSeenVersion ; `welcomed` = le mot de bienvenue a
 * déjà été montré, donc Ondine a déjà tourné : une version notée vide vient
 * alors d'une version d'avant ce réglage, et c'est bien une mise à jour.
 */
export function whatsNewAction(seen: string, current: string, welcomed: boolean, demo: boolean): "show" | "remember" | "nothing" {
  if (!/^\d/.test(current) || seen === current) return "nothing";
  // Mode démo : jamais de notification, mais une version jamais notée l'est
  // quand même (sinon, une fois la démo coupée, un premier lancement passerait
  // pour une mise à jour).
  if (demo) return seen ? "nothing" : "remember";
  if (!seen && !welcomed) return "remember";
  return "show";
}
