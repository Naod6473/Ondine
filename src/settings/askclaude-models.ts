// « Parler à Ondine » (1.2.4) : la logique sans DOM du serveur local et
// d'OpenRouter dans les réglages (askclaude-page.ts), testée dans
// tests/front/extras.test.ts. Le Rust : src-tauri/src/modules/askclaude_compat.rs.

/** Serveur sur ce PC : rien ne sort sur Internet. */
export function localSentText(destination: string, maxTurns: number): string {
  return `Vos messages restent sur votre PC : à chaque message partent vers le serveur local ${destination} la personnalité d'Ondine, les ${maxTurns} derniers messages au plus (avec leurs fichiers joints) et votre nouveau message. Rien n'est gardé sur le disque.`;
}

/** Un modèle de la liste du serveur (askclaude_compat.rs, `models`). */
export interface ServerModel {
  id: string;
  tools: boolean | null;
}

/** Le réglage du modèle choisi, selon le fournisseur. */
export function modelKey(provider: string): "localModel" | "openrouterModel" | null {
  return provider === "local" ? "localModel" : provider === "openrouter" ? "openrouterModel" : null;
}

/** Les modèles à montrer : ceux qui contiennent `filter`, 60 au plus. */
export function filterModels(list: ServerModel[], filter: string, max = 60): ServerModel[] {
  const f = filter.trim().toLowerCase();
  return list.filter((m) => !f || m.id.toLowerCase().includes(f)).slice(0, max);
}
