// L'écran de veille (1.2.3) : la promenade d'Ondine et les vagues, en calculs
// purs (testés par tests/front/screensaver.test.ts) ; le dessin : main.ts.

/** Où en est la promenade. */
export interface Walker {
  /** Position du centre d'Ondine, 0 (bord gauche) à 1 (bord droit). */
  x: number;
  /** 1 vers la droite, -1 vers la gauche. */
  dir: 1 | -1;
  /** Elle marche, ou elle se pose (pause) jusqu'à `until` (ms). */
  walking: boolean;
  until: number;
}

/** Vitesse de marche : une largeur d'écran en ~45 s (plus lente au réglage Calme). */
export const WALK_SPEED = 1 / 45;
/** Les bords qu'elle ne dépasse pas (elle fait demi-tour avant). */
export const MARGIN = 0.12;

/** Une nouvelle promenade : au milieu, posée quelques secondes. */
export function newWalker(now: number): Walker {
  return { x: 0.5, dir: 1, walking: false, until: now + 2500 };
}

/**
 * Un pas de la promenade (`dt` en s, `now` en ms). `rand` : le hasard (0 à 1),
 * donné pour pouvoir tester. `calm` : elle se pose plus souvent et plus
 * longtemps. Elle marche 6 à 14 s, se pose 3 à 8 s (le double au calme), fait
 * demi-tour aux bords, et parfois en chemin.
 */
export function stepWalker(w: Walker, dt: number, now: number, rand: () => number, calm = false): Walker {
  const next = { ...w };
  if (now >= next.until) {
    next.walking = !next.walking;
    if (next.walking) {
      next.until = now + (6 + rand() * 8) * 1000 * (calm ? 0.6 : 1);
      if (rand() < 0.35) next.dir = next.dir === 1 ? -1 : 1;
    } else next.until = now + (3 + rand() * 5) * 1000 * (calm ? 2 : 1);
  }
  if (next.walking) {
    next.x += next.dir * WALK_SPEED * (calm ? 0.7 : 1) * Math.max(0, Math.min(0.1, dt));
    if (next.x > 1 - MARGIN) {
      next.x = 1 - MARGIN;
      next.dir = -1;
    } else if (next.x < MARGIN) {
      next.x = MARGIN;
      next.dir = 1;
    }
  }
  return next;
}

/**
 * La hauteur de l'eau (0 = repos ; ±1 = la plus haute vague) au point `x`
 * (0 à 1) à l'instant `t` (s) : trois houles qui se croisent.
 */
export function waveHeight(x: number, t: number, layer = 0): number {
  const k = layer * 1.7;
  return 0.55 * Math.sin(x * 6.3 + t * 0.6 + k) + 0.3 * Math.sin(x * 13.1 - t * 0.9 + k * 2) + 0.15 * Math.sin(x * 23.7 + t * 1.4 + k * 3);
}

/**
 * Le petit décalage de l'horloge (px), qui change lentement : rien ne reste
 * au même endroit des heures durant (pas de marque sur les écrans OLED).
 */
export function clockDrift(now: number, range = 24): { x: number; y: number } {
  const m = now / 60_000;
  return { x: Math.round(Math.sin(m * 0.37) * range), y: Math.round(Math.cos(m * 0.23) * range * 0.6) };
}

/** « 09:05 » (24 h) ou « 9:05 AM » selon la langue. */
export function clockText(d: Date, english: boolean): string {
  if (!english) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;
}
