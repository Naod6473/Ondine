// Vos propres sons (1.2.4) : le Rust lit %APPDATA%\Ondine\sounds
// (src-tauri/src/services/custom_sounds.rs : noms connus, 2 Mo au plus,
// en-tête vérifié) et renvoie les fichiers ; ici, Web Audio les décode et
// sounds.ts les joue à la place des sons fabriqués. Un fichier que Web Audio
// ne sait pas décoder est ignoré (le son d'origine reste, une ligne au
// journal). Rien n'est exécuté ni envoyé.
//
// Chargés au démarrage de l'île, et à nouveau sur « Recharger les sons »
// (Réglages → Apparence → Sons, événement « sounds.reload »).

import { Bridge } from "../core/bridge";
import type { Bus } from "../core/bus";
import { logger } from "../core/log";
import { audioContext, setCustomSounds } from "./sounds";

const log = logger("sons");

/** Les sons remplacés après ce chargement (leurs noms). */
export async function loadCustomSounds(): Promise<string[]> {
  const found = await Bridge.soundsCustom();
  const decoded = new Map<string, AudioBuffer>();
  const c = audioContext();
  for (const s of found?.sounds ?? []) {
    if (!c) break;
    try {
      const bytes = Uint8Array.from(atob(s.data), (ch) => ch.charCodeAt(0));
      decoded.set(s.name, await c.decodeAudioData(bytes.buffer));
    } catch {
      log.warn(`sons : « ${s.file} » illisible par le lecteur audio, le son d'origine est gardé`);
    }
  }
  setCustomSounds(decoded);
  return [...decoded.keys()];
}

/** Dans l'île : charge vos sons, et les recharge à la demande des réglages. */
export function startCustomSounds(bus: Bus): void {
  void loadCustomSounds().catch(() => {});
  bus.on("sounds.reload", () => void loadCustomSounds().catch(() => {}));
}
