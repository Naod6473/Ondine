// Le catalogue des mascottes : tout dossier `mascots/<id>/` contenant un
// `manifest.json`. Vite les trouve au moment du build (import.meta.glob) :
// déposer une nouvelle mascotte = ajouter son dossier puis relancer l'appli.

import { cousinManifest, GUM_FAMILY } from "./gum-family";
import { validateManifest } from "./manifest-check";
import type { MascotManifest } from "./types";

export { validateManifest };

// Manifestes (JSON déjà lus) et fichiers d'animation (URL utilisables par le webview).
const manifests = import.meta.glob("/mascots/*/manifest.json", { eager: true, import: "default" }) as Record<
  string,
  MascotManifest
>;
const assetUrls = import.meta.glob("/mascots/*/**/*.{png,webp,json,riv,lottie}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export interface CatalogEntry {
  manifest: MascotManifest;
  /** Nom de fichier relatif au dossier de la mascotte → URL. */
  assets: Record<string, string>;
  /** Problèmes trouvés dans le manifeste (vide = tout va bien). */
  problems: string[];
}

export function mascotCatalog(): CatalogEntry[] {
  const entries = Object.entries(manifests).map(([path, manifest]) => {
    const folder = path.replace(/manifest\.json$/, "");
    const assets: Record<string, string> = {};
    for (const [assetPath, url] of Object.entries(assetUrls)) {
      if (assetPath.startsWith(folder)) assets[assetPath.slice(folder.length)] = url;
    }
    return { manifest, assets, problems: validateManifest(manifest, assets) };
  });
  // Les cousines de la goutte gomme (gum-family.ts), juste après elle.
  const gum = entries.findIndex((e) => e.manifest.id === "goutte-gomme");
  if (gum >= 0) {
    const base = entries[gum];
    const cousins = GUM_FAMILY.map((c) => {
      const manifest = cousinManifest(base.manifest, c);
      return { manifest, assets: base.assets, problems: validateManifest(manifest, base.assets) };
    });
    entries.splice(gum + 1, 0, ...cousins);
  }
  return entries;
}

/** La mascotte demandée, sinon la goutte (mascotte par défaut), sinon la goutte gomme (dessinée en code). */
export function findMascot(id: string): CatalogEntry | null {
  const all = mascotCatalog();
  const valid = (e: CatalogEntry) => e.problems.length === 0;
  const byId = (wanted: string) => all.find((e) => e.manifest.id === wanted && valid(e));
  return byId(id) ?? byId("goutte-gomme") ?? byId("goutte") ?? null;
}
