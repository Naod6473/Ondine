// Le catalogue des mascottes : tout dossier `mascots/<id>/` contenant un
// `manifest.json`. Vite les trouve au moment du build (import.meta.glob) :
// déposer une nouvelle mascotte = ajouter son dossier puis relancer l'appli.

import { MASCOT_STATES, type MascotManifest } from "./types";

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

/** Vérifie un manifeste et liste ce qui ne va pas, au lieu de planter plus tard. */
export function validateManifest(m: MascotManifest, assets?: Record<string, string>): string[] {
  const problems: string[] = [];
  if (!m.id || !m.name) problems.push("id ou name manquant");
  const names = new Set<string>();
  for (const a of m.animations ?? []) {
    if (names.has(a.name)) problems.push(`animation en double : ${a.name}`);
    names.add(a.name);
    if (!(a.durationMs > 0)) problems.push(`${a.name} : durationMs doit être > 0`);
    for (const f of [a.source?.file, a.source?.nearFile]) {
      if (f && assets && !(f in assets)) problems.push(`${a.name} : fichier introuvable (${f})`);
    }
    for (const pose of [a.source?.pose, ...(a.source?.poses ?? []), ...(a.source?.variants ?? [])]) {
      if (pose && !m.poses?.[pose]) problems.push(`${a.name} : pose inconnue (${pose})`);
    }
    for (const t of a.transitionsTo ?? []) {
      if (t !== "*" && !(m.animations ?? []).some((b) => b.name === t)) problems.push(`${a.name} : transition vers une animation inconnue (${t})`);
    }
  }
  for (const [name, pose] of Object.entries(m.poses ?? {})) {
    if (assets && !(pose.file in assets)) problems.push(`pose ${name} : fichier introuvable (${pose.file})`);
    if (pose.blink && !m.poses?.[pose.blink]) problems.push(`pose ${name} : pose de clignement inconnue (${pose.blink})`);
  }
  if (!names.has(m.fallback)) problems.push(`fallback inconnu : ${m.fallback}`);
  for (const [state, anim] of Object.entries(m.states ?? {})) {
    if (!(MASCOT_STATES as readonly string[]).includes(state)) problems.push(`état inconnu : ${state}`);
    if (anim && !names.has(anim)) problems.push(`l'état ${state} pointe vers une animation inconnue (${anim})`);
  }
  return problems;
}

export function mascotCatalog(): CatalogEntry[] {
  return Object.entries(manifests).map(([path, manifest]) => {
    const folder = path.replace(/manifest\.json$/, "");
    const assets: Record<string, string> = {};
    for (const [assetPath, url] of Object.entries(assetUrls)) {
      if (assetPath.startsWith(folder)) assets[assetPath.slice(folder.length)] = url;
    }
    return { manifest, assets, problems: validateManifest(manifest, assets) };
  });
}

/** La mascotte demandée, sinon la provisoire. */
export function findMascot(id: string): CatalogEntry | null {
  const all = mascotCatalog();
  const valid = (e: CatalogEntry) => e.problems.length === 0;
  return all.find((e) => e.manifest.id === id && valid(e)) ?? all.find((e) => e.manifest.id === "placeholder") ?? null;
}
