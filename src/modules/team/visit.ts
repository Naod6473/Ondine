// La visite d'Ondine (module Équipe) : la mascotte d'un collègue traverse
// l'île, dans la carte de l'alerte, et s'arrête au milieu pour faire coucou
// avec son petit mot.
//
// Pourquoi dans l'île et pas sur tout l'écran : une fenêtre transparente de
// plus, par-dessus toutes les autres, juste pour une traversée de quelques
// secondes, coûterait trop (WebView2 de plus, clics à laisser passer). La
// carte de l'alerte suffit, et elle s'efface avec elle.
//
// Le mouvement : un ressort (src/island/spring.ts) tire la mascotte de la
// gauche vers le milieu ; un petit rebond vertical suit sa vitesse (elle
// sautille en marchant). Interruptible : si la carte disparaît en route, tout
// s'arrête. Avec « Réduire les animations » ou le réglage Calme de la
// mascotte, elle est posée au milieu tout de suite, sans traverser.

import { settingsStore } from "../../core/settings-store";
import { findMascot } from "../../mascot/catalog";
import { APP_GUM_ENV } from "../../mascot/renderers/gum";
import { GumEngine } from "../../mascot/renderers/gum-engine";
import type { AnimationSpec, MascotManifest } from "../../mascot/types";
import { el } from "../../island/dom";
import { reducedMotion } from "../../island/tab-pill";
import { springAtRest, stepSpring, type Spring } from "../../island/spring";

/** Le ressort de la marche : souple, un petit dépassement à l'arrivée. */
const WALK = { stiffness: 38, damping: 0.62 };

function spec(m: MascotManifest, name: string): AnimationSpec {
  return m.animations.find((a) => a.name === name) ?? m.animations.find((a) => a.name === "idle")!;
}

/** Monte la visite dans `host` ; renvoie la fonction qui défait tout. */
export function mountVisit(host: HTMLElement, who: { name: string; color: string; mascot: string }, note: string): () => void {
  const entry = findMascot(who.mascot || "goutte-gomme");
  const lane = el("div", { class: "team-visit-lane" });
  const walker = el("div", { class: "team-visit-walker" });
  const bubble = el("div", { class: "team-visit-note", "data-no-i18n": true }, note || "👋");
  lane.append(walker);
  host.append(el("div", { class: "team-visit" }, lane, bubble));

  // La mascotte du collègue, à SA couleur (pas celle de l'île).
  let engine: GumEngine | null = null;
  if (entry && entry.manifest.renderer === "gum") {
    const color = /^#[0-9a-fA-F]{6}$/.test(who.color) ? who.color : "#5cc8ff";
    engine = new GumEngine(entry.manifest, {
      ...APP_GUM_ENV,
      prefs: () => ({ color: "custom", customColor: color, hands: "always", wear: { head: "none", eyes: "none", neck: "none" } }),
      onPrefsChange: () => () => {},
    });
    engine.mount(walker);
  }
  const manifest = entry?.manifest;
  const play = (name: string) => manifest && engine?.play(spec(manifest, name));

  let raf = 0;
  let stopped = false;
  const still = reducedMotion() || settingsStore.current.mascot.calm === true;
  const arrive = () => {
    bubble.classList.add("shown");
    play("coucou");
  };

  if (still) {
    walker.style.transform = "translateX(0px)";
    play("idle");
    arrive();
  } else {
    // Départ hors de la carte, à gauche ; la cible est le milieu (0).
    const start = -(lane.clientWidth / 2 + 60) || -220;
    const x: Spring = { x: start, v: 0 };
    let last = performance.now();
    play("happy");
    const frame = (now: number) => {
      if (stopped) return;
      const dt = (now - last) / 1000;
      last = now;
      stepSpring(x, 0, WALK, dt);
      // Le sautillement suit la vitesse : il s'éteint à l'arrivée.
      const hop = Math.abs(Math.sin(now / 90)) * Math.min(6, Math.abs(x.v) / 40);
      walker.style.transform = `translate(${x.x.toFixed(1)}px, ${(-hop).toFixed(1)}px)`;
      if (springAtRest(x, 0, 0.5, 6)) {
        walker.style.transform = "translateX(0px)";
        arrive();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    engine?.destroy();
    lane.parentElement?.remove();
  };
}
