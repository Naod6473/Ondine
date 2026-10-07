// « Redémarrage en attente » dans le module Système :
//   - une ligne dans l'onglet (« 🔄 Redémarrage en attente depuis 3 jours
//     (mises à jour de Windows) ») avec un bouton qui ouvre Windows Update ;
//   - un rappel doux (réglage « rebootReminder ») : au plus une fois par jour,
//     après un jour d'attente, jamais pendant un appel (micro utilisé, d'après
//     le module Contrôles, comme Pauses) ni pendant une présentation.
//
// Ondine ne redémarre JAMAIS le PC : elle ouvre seulement la page Windows
// Update des Paramètres. Le Rust lit le registre (platform/reboot.rs).

import { Bridge } from "../../core/bridge";
import { errorText } from "../../core/log";
import type { ModuleApi } from "../../core/module-types";
import { el } from "../../island/dom";
import { pendingText, reasonText, shouldRemind, type RebootState } from "./reboot-text";

/** Le rappel regarde toutes les 10 min (une simple lecture du registre). */
const CHECK_MS = 10 * 60_000;
/** Premier coup d'œil 2 min après le démarrage : pas de rappel dès l'ouverture de session. */
const FIRST_CHECK_MS = 2 * 60_000;
/** Au-delà de 5 min sans clavier ni souris, on considère que personne n'est là. */
const AWAY_MS = 5 * 60_000;
/** Le dernier rappel, gardé d'un lancement d'Ondine à l'autre (« au plus une fois par jour »). */
const LAST_REMINDED_KEY = "ondine.system.rebootRemindedAt";

const nowSecs = () => Math.floor(Date.now() / 1000);

function lastReminded(): number {
  try {
    return Number(localStorage.getItem(LAST_REMINDED_KEY)) || 0;
  } catch {
    return 0;
  }
}

function rememberReminder(secs: number) {
  try {
    localStorage.setItem(LAST_REMINDED_KEY, String(secs));
  } catch {
    // stockage indisponible : au pire, un rappel de plus au prochain lancement
  }
}

/** Ouvre la page Windows Update des Paramètres (jamais de redémarrage automatique). */
async function openUpdate(api: ModuleApi) {
  try {
    await api.invoke("open_update");
  } catch (err) {
    api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "system-error" });
  }
}

/** Le rappel doux (dans `setup`). Renvoie de quoi l'arrêter. */
export function watchReboot(api: ModuleApi): () => void {
  let micInUse = false;
  // La première fois qu'on a vu le redémarrage en attente (si Windows ne donne pas de date).
  let firstSeen = 0;
  const offMic = api.on("controls.media-use", (msg) => {
    micInUse = ((msg.payload as { mic?: string[] } | null)?.mic ?? []).length > 0;
  });

  const check = async () => {
    if (api.settings().rebootReminder === false) return;
    let state: RebootState | null = null;
    try {
      state = await api.invoke<RebootState>("reboot");
    } catch {
      return; // hors de l'appli
    }
    const now = nowSecs();
    if (!state?.pending) {
      firstSeen = 0;
      return;
    }
    firstSeen ||= now;
    // Présentation, plein écran (comme Pauses : Windows le signale).
    const desk = await Bridge.deskState();
    // Personne devant le PC depuis 5 min : le rappel attend son retour (sinon
    // il passerait inaperçu, et compterait quand même pour la journée).
    if (!desk || desk.idleMs > AWAY_MS) return;
    const remind = shouldRemind({ enabled: true, state, firstSeenSecs: firstSeen, nowSecs: now, lastRemindedSecs: lastReminded(), micInUse, presenting: desk.busy });
    if (!remind) return;
    rememberReminder(now);
    api.notify({
      // La durée seulement si Windows donne la date (sinon « Redémarrage en attente »).
      title: pendingText(state.sinceSecs, now),
      body: "Windows attend un redémarrage pour terminer ses mises à jour. Redémarrez quand cela vous arrange.",
      icon: "🔄",
      priority: "normal",
      key: "system-reboot",
      durationMs: 20_000,
      actions: [
        { label: "Ouvrir Windows Update", run: () => openUpdate(api) },
        { label: "Plus tard", run: () => {} },
      ],
    });
  };

  const first = window.setTimeout(() => void check(), FIRST_CHECK_MS);
  const timer = window.setInterval(() => void check(), CHECK_MS);
  return () => {
    window.clearTimeout(first);
    window.clearInterval(timer);
    offMic();
  };
}

/** La ligne de l'onglet (cachée s'il n'y a pas de redémarrage en attente). */
export function rebootRow(api: ModuleApi) {
  const text = el("span", {});
  const why = el("span", { class: "muted" });
  const node = el(
    "div",
    { class: "sys-reboot", hidden: true },
    el("span", { class: "sys-reboot-text" }, "🔄", " ", text, " ", why),
    el("button", { class: "btn small", type: "button", onclick: api.handler(() => openUpdate(api)) }, "Ouvrir Windows Update"),
  );
  let alive = true;

  const refresh = async () => {
    let state: RebootState | null = null;
    try {
      state = await api.invoke<RebootState>("reboot");
    } catch {
      // hors de l'appli : rien à montrer
    }
    if (!alive) return;
    node.hidden = !state?.pending;
    if (!state?.pending) return;
    // La durée seulement si Windows donne la date : « depuis moins d'une
    // heure » compté depuis l'ouverture de l'onglet serait trompeur.
    text.textContent = pendingText(state.sinceSecs, nowSecs());
    why.textContent = reasonText(state.reasons);
  };

  void refresh();
  // Ça change rarement : une fois par minute tant que l'onglet est ouvert.
  const timer = window.setInterval(() => void refresh(), 60_000);
  return {
    node,
    stop() {
      alive = false;
      window.clearInterval(timer);
    },
  };
}
