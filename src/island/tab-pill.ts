// La pastille qui se déplace derrière l'onglet actif, façon « verre liquide ».
//
// Au lieu de faire glisser un rectangle rigide, on anime ses deux bords
// séparément, chacun avec un ressort :
//   - le bord qui part EN AVANT (vers le nouvel onglet) a un ressort raide :
//     il arrive vite ;
//   - le bord qui SUIT a un ressort plus mou : il traîne un peu.
// Résultat : la pastille s'étire pendant le trajet, puis se rétracte en
// arrivant, avec un petit rebond. Pendant qu'elle va vite, elle s'aplatit
// légèrement (comme une goutte).
//
// La cible est relue à chaque image : si l'onglet change de largeur pendant
// le trajet (son nom qui apparaît), la pastille suit.

/** Un ressort amorti : position, vitesse, raideur. */
interface Spring {
  x: number;
  v: number;
}

/** Raideur du bord qui mène, et de celui qui suit (plus mou = traîne plus). */
const LEAD_STIFFNESS = 620;
const TRAIL_STIFFNESS = 240;
/** Amortissement (1 = aucun rebond ; un peu moins = petit rebond). */
const DAMPING_RATIO = 0.78;

function step(s: Spring, target: number, stiffness: number, dt: number) {
  const damping = 2 * Math.sqrt(stiffness) * DAMPING_RATIO;
  const force = stiffness * (target - s.x) - damping * s.v;
  s.v += force * dt;
  s.x += s.v * dt;
}

export class TabPill {
  readonly el: HTMLElement;
  private left: Spring = { x: 0, v: 0 };
  private right: Spring = { x: 0, v: 0 };
  private target: HTMLElement | null = null;
  private frame = 0;
  private last = 0;
  /** Jusqu'à quand continuer même si tout semble immobile (largeurs qui s'animent en CSS). */
  private busyUntil = 0;

  constructor(container: HTMLElement) {
    this.el = document.createElement("span");
    this.el.className = "tab-pill";
    container.prepend(this.el);
  }

  /** Place la pastille sur `tab` sans animation (ouverture de l'île). */
  jumpTo(tab: HTMLElement) {
    this.target = tab;
    const { l, r } = this.edges(tab);
    this.left = { x: l, v: 0 };
    this.right = { x: r, v: 0 };
    this.paint(0);
  }

  /** Fait glisser la pastille jusqu'à `tab`. */
  moveTo(tab: HTMLElement) {
    this.target = tab;
    if (reducedMotion()) return this.jumpTo(tab);
    this.busyUntil = performance.now() + 450;
    if (!this.frame) {
      this.last = performance.now();
      this.frame = requestAnimationFrame(this.tick);
    }
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** Bords gauche et droit de l'onglet, relatifs au conteneur. */
  private edges(tab: HTMLElement) {
    return { l: tab.offsetLeft, r: tab.offsetLeft + tab.offsetWidth };
  }

  private tick = (now: number) => {
    this.frame = 0;
    if (!this.target || !this.target.isConnected) return;
    // On plafonne le pas de temps : après une pause (fenêtre cachée), le ressort ne doit pas s'emballer.
    const dt = Math.min(0.032, (now - this.last) / 1000);
    this.last = now;

    const { l, r } = this.edges(this.target);
    // Vers la droite, c'est le bord droit qui mène ; vers la gauche, le gauche.
    const goingRight = l > this.left.x;
    step(this.left, l, goingRight ? TRAIL_STIFFNESS : LEAD_STIFFNESS, dt);
    step(this.right, r, goingRight ? LEAD_STIFFNESS : TRAIL_STIFFNESS, dt);

    const speed = Math.abs(this.left.v) + Math.abs(this.right.v);
    this.paint(speed);

    const settled =
      Math.abs(this.left.x - l) < 0.3 && Math.abs(this.right.x - r) < 0.3 && speed < 5 && now > this.busyUntil;
    if (settled) {
      this.left = { x: l, v: 0 };
      this.right = { x: r, v: 0 };
      this.paint(0);
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  /** Dessine la pastille. `speed` (px/s) l'aplatit un peu pendant le trajet. */
  private paint(speed: number) {
    const width = Math.max(8, this.right.x - this.left.x);
    const squash = Math.min(0.14, speed / 9000); // au plus 14 % plus plate
    if (this.target) {
      this.el.style.top = `${this.target.offsetTop}px`;
      this.el.style.height = `${this.target.offsetHeight}px`;
    }
    this.el.style.width = `${width}px`;
    this.el.style.transform = `translateX(${this.left.x}px) scaleY(${1 - squash})`;
  }
}

/** L'utilisateur a demandé à Windows de réduire les animations. */
export function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
