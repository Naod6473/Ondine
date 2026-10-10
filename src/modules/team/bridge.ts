// Le pont de fichier à travers l'île (1.2.3) : la petite animation quand un
// fichier part vers un collègue (cible de dépôt du module Équipe), ou arrive
// de lui. Le mouvement est dans bridge-path.ts (testé) ; ici, le dessin.
//
// La feuille est un petit élément posé dans `.island` (qui rogne ce qui
// dépasse) : elle passe À TRAVERS l'île, sous rien de cliquable
// (`pointer-events: none`). Interruptible : un clic, un nouveau glisser ou un
// autre pont l'arrête et l'enlève. « Réduire les animations » : rien ne
// bouge, le rond du collègue s'allume puis s'éteint en fondu. Le fichier, lui,
// suit le chemin habituel (toujours à accepter par le destinataire).

import { el } from "../../island/dom";
import { reducedMotion } from "../../island/tab-pill";
import { bridgeLook, startBridge, stepBridge } from "./bridge-path";

let stopCurrent: (() => void) | null = null;

/** Une couleur sûre pour le style (#rrggbb), sinon le bleu de la goutte. */
function safeColor(c: string | undefined): string {
  return c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#5cc8ff";
}

/**
 * Lance le pont : `dir` 1 = le fichier part (sort à droite vers le rond du
 * collègue), -1 = il arrive (entre par la gauche). Renvoie de quoi l'arrêter.
 */
export function playFileBridge(dir: 1 | -1, color?: string): () => void {
  stopCurrent?.();
  const island = document.querySelector<HTMLElement>(".island");
  if (!island) return () => {};
  const tint = safeColor(color);
  const sheet = el("div", { class: "team-bridge-sheet", "aria-hidden": "true" });
  const portal = el("div", { class: `team-bridge-portal ${dir === 1 ? "right" : "left"}`, "aria-hidden": "true" });
  portal.style.setProperty("--peer", tint);
  const layer = el("div", { class: "team-bridge", "aria-hidden": "true" }, portal, sheet);
  island.append(layer);

  let raf = 0;
  let timer = 0;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    window.removeEventListener("pointerdown", stop, true);
    window.removeEventListener("dragenter", stop, true);
    layer.remove();
    if (stopCurrent === stop) stopCurrent = null;
  };
  stopCurrent = stop;
  window.addEventListener("pointerdown", stop, true);
  window.addEventListener("dragenter", stop, true);

  // Animations réduites : seulement le rond du collègue, en fondu.
  if (reducedMotion()) {
    sheet.remove();
    portal.classList.add("still");
    requestAnimationFrame(() => portal.classList.add("lit"));
    timer = window.setTimeout(stop, 900);
    return stop;
  }

  const s = startBridge(dir);
  let last = performance.now();
  let flashed = false;
  const frame = (now: number) => {
    if (stopped) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    stepBridge(s, dt);
    const W = island.clientWidth;
    const H = island.clientHeight;
    const look = bridgeLook(s);
    const px = s.x.x * W;
    const py = s.y.x * H;
    sheet.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -50%) rotate(${look.rot.toFixed(3)}rad) scale(${look.sx.toFixed(3)}, ${look.sy.toFixed(3)})`;
    sheet.style.opacity = look.alpha.toFixed(3);
    // Le rond du collègue s'allume quand la feuille l'approche (ou au départ, en réception).
    if (!flashed && ((dir === 1 && s.x.x > 0.8) || (dir === -1 && s.t > 0.02))) {
      flashed = true;
      portal.classList.add("lit");
    }
    if (s.phase === "done") {
      // Le rond s'éteint après la feuille.
      portal.classList.remove("lit");
      timer = window.setTimeout(stop, 260);
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return stop;
}
