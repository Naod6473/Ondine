// Les codes secrets : les mots magiques du Lanceur et le code Konami.
// (Pur : testé dans tests/front/eggs.test.ts.)

export type MagicWord = "code-rain" | "retro" | "barrel-roll" | "answer";

/** « Réveille-toi ! » → « reveille toi » : minuscules, sans accents ni ponctuation. */
export function normalizeWord(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const WORDS: Record<string, MagicWord> = {
  "reveille toi": "code-rain",
  "reveilles toi": "code-rain",
  "wake up": "code-rain",
  retro: "retro",
  "8 bits": "retro",
  "8bits": "retro",
  "8 bit": "retro",
  "8bit": "retro",
  tonneau: "barrel-roll",
  "fais un tonneau": "barrel-roll",
  "barrel roll": "barrel-roll",
  "do a barrel roll": "barrel-roll",
  "la reponse": "answer",
  "quelle est la reponse": "answer",
  "la grande question": "answer",
  "the answer": "answer",
  "meaning of life": "answer",
  "le sens de la vie": "answer",
};

/** Le texte tapé est-il un mot magique ? (le texte entier, pas un morceau) */
export function magicWord(text: string): MagicWord | null {
  return WORDS[normalizeWord(text)] ?? null;
}

/** ↑ ↑ ↓ ↓ ← → ← → B A */
export const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

/** Garde les dernières touches ; `push` renvoie vrai quand elles forment la suite. */
export class KeySequence {
  private recent: string[] = [];
  constructor(private readonly keys: string[] = KONAMI) {}

  push(key: string): boolean {
    this.recent.push(key.length === 1 ? key.toLowerCase() : key);
    if (this.recent.length > this.keys.length) this.recent.shift();
    if (this.recent.length === this.keys.length && this.recent.every((k, i) => k === this.keys[i])) {
      this.recent = [];
      return true;
    }
    return false;
  }
}

/**
 * Compte les tours de souris autour d'Ondine. On lui donne la position de la
 * souris par rapport à son centre ; il additionne les angles parcourus (dans
 * le même sens) et renvoie vrai après `turns` tours en moins de `withinMs`.
 */
export class SpinCounter {
  private last: number | null = null;
  private sum = 0;
  private start = 0;
  private lastAt = 0;
  constructor(
    private readonly turns = 2,
    private readonly withinMs = 4000,
    private readonly minR = 24,
    private readonly maxR = 180,
  ) {}

  push(dx: number, dy: number, now: number): boolean {
    const r = Math.hypot(dx, dy);
    // Trop près, trop loin ou une pause : on recommence.
    if (r < this.minR || r > this.maxR || now - this.lastAt > 600) {
      this.reset(now);
      if (r >= this.minR && r <= this.maxR) this.last = Math.atan2(dy, dx);
      return false;
    }
    this.lastAt = now;
    const a = Math.atan2(dy, dx);
    if (this.last !== null) {
      let d = a - this.last;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      // Changement de sens : on repart de ce point.
      if (this.sum !== 0 && Math.sign(d) !== Math.sign(this.sum) && Math.abs(d) > 0.05) {
        this.sum = 0;
        this.start = now;
      }
      this.sum += d;
    }
    this.last = a;
    if (now - this.start > this.withinMs) {
      this.sum = 0;
      this.start = now;
    }
    if (Math.abs(this.sum) >= this.turns * 2 * Math.PI) {
      this.reset(now);
      return true;
    }
    return false;
  }

  private reset(now: number) {
    this.last = null;
    this.sum = 0;
    this.start = now;
    this.lastAt = now;
  }
}
