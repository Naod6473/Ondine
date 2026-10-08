// La vérification d'un manifeste de mascotte (à part du catalogue, qui dépend
// de Vite : les tests peuvent ainsi l'utiliser directement).

import { MASCOT_STATES, type MascotManifest } from "./types";

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
