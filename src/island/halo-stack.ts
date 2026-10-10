// Qui a la parole sur le halo de l'île (halo.ts) : une seule demande est
// montrée à la fois, la plus prioritaire, et à priorité égale la plus récente.
// Quand elle finit, celle d'avant revient (avec un fondu, fait par halo.ts).
//
// Sans DOM : testé par Node (tests/front/halo.test.ts).

export type HaloPriority = "low" | "normal" | "high" | "critical";

const RANK: Record<HaloPriority, number> = { low: 0, normal: 1, high: 2, critical: 3 };

export function priorityOf(v: unknown): HaloPriority {
  return v === "low" || v === "normal" || v === "high" || v === "critical" ? v : "normal";
}

export class HaloStack<T extends { id: string; priority: HaloPriority }> {
  private items: { item: T; seq: number }[] = [];
  private seq = 0;

  /** Ajoute (ou remplace : même id) une demande ; elle devient la plus récente. */
  add(item: T): void {
    this.items = this.items.filter((e) => e.item.id !== item.id);
    this.items.push({ item, seq: ++this.seq });
  }

  remove(id: string): T | null {
    const hit = this.items.find((e) => e.item.id === id);
    if (!hit) return null;
    this.items = this.items.filter((e) => e !== hit);
    return hit.item;
  }

  get(id: string): T | null {
    return this.items.find((e) => e.item.id === id)?.item ?? null;
  }

  /** Celle qu'on montre : la plus prioritaire, puis la plus récente. */
  top(): T | null {
    let best: { item: T; seq: number } | null = null;
    for (const e of this.items) {
      if (!best || RANK[e.item.priority] > RANK[best.item.priority] || (RANK[e.item.priority] === RANK[best.item.priority] && e.seq > best.seq)) best = e;
    }
    return best?.item ?? null;
  }

  get size(): number {
    return this.items.length;
  }

  all(): T[] {
    return this.items.map((e) => e.item);
  }

  clear(): void {
    this.items = [];
  }
}
