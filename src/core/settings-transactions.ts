// Sauvegardes optimistes et sérialisées. Seuls les champs réellement modifiés
// partent au Rust : deux fenêtres ne remplacent plus leurs copies complètes.
export interface SettingsPatch {
  path: string[];
  op: "set" | "remove";
  value?: unknown;
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const safeKey = (k: string) => !["__proto__", "constructor", "prototype"].includes(k);

export function settingsDiff(before: unknown, after: unknown, path: string[] = []): SettingsPatch[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (record(before) && record(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) => {
      if (!safeKey(key) || (!path.length && key === "revision")) return [];
      return settingsDiff(before[key], after[key], [...path, key]);
    });
  }
  return after === undefined ? [{ path, op: "remove" }] : [{ path, op: "set", value: structuredClone(after) }];
}

export function applySettingsPatch<T>(base: T, patches: readonly SettingsPatch[]): T {
  const out = structuredClone(base);
  for (const patch of patches) {
    if (!patch.path.length || patch.path.some((k) => !safeKey(k))) throw new Error("champ de réglages refusé");
    let target = out as Record<string, unknown>;
    for (const key of patch.path.slice(0, -1)) {
      if (!record(target[key])) target[key] = {};
      target = target[key] as Record<string, unknown>;
    }
    const key = patch.path[patch.path.length - 1];
    if (patch.op === "remove") delete target[key];
    else target[key] = structuredClone(patch.value);
  }
  return out;
}

interface Pending {
  patch: SettingsPatch[];
  waiters: { resolve(): void; reject(error: unknown): void }[];
}

export class SettingsTransactions<T extends { revision?: number }> {
  current: T;
  private confirmed: T;
  private queue: Pending[] = [];
  private working = false;
  private listeners = new Set<(settings: T) => void>();
  private errors = new Set<(error: unknown) => void>();

  constructor(initial: T, private readonly persist: (patch: SettingsPatch[], base: T) => Promise<T>) {
    this.current = structuredClone(initial);
    this.confirmed = structuredClone(initial);
  }

  onChange(fn: (settings: T) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onError(fn: (error: unknown) => void): () => void {
    this.errors.add(fn);
    return () => this.errors.delete(fn);
  }

  /** Ignore un événement livré en retard ; conserve les changements en attente. */
  accept(settings: T) {
    if ((settings.revision ?? 0) < (this.confirmed.revision ?? 0)) return;
    this.confirmed = structuredClone(settings);
    this.publish();
  }

  update(change: (draft: T) => void): Promise<void> {
    const draft = structuredClone(this.current);
    change(draft);
    const patch = settingsDiff(this.current, draft);
    if (!patch.length) return Promise.resolve();
    const result = new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject };
      if (this.working && this.queue.length > 1) {
        // Un curseur ou une roue de couleur peut produire 60 changements/s.
        // Garde le dernier brouillon, sans accumuler 60 écritures sur le disque.
        const tail = this.queue[this.queue.length - 1];
        const before = this.queue.slice(0, -1).reduce((s, item) => applySettingsPatch(s, item.patch), structuredClone(this.confirmed));
        tail.patch = settingsDiff(before, draft);
        tail.waiters.push(waiter);
      } else this.queue.push({ patch, waiters: [waiter] });
    });
    // Les appels « void update » disposent du retour visible onError. Le résultat
    // original reste rejeté pour les appelants qui attendent la sauvegarde.
    void result.catch(() => {});
    this.publish();
    void this.drain();
    return result;
  }

  private publish() {
    this.current = this.queue.reduce((s, item) => applySettingsPatch(s, item.patch), structuredClone(this.confirmed));
    for (const fn of this.listeners) {
      try { fn(this.current); } catch (error) { console.error("[réglages] abonné en erreur", error); }
    }
  }

  private async drain() {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length) {
        const item = this.queue[0];
        try {
          const saved = await this.persist(item.patch, structuredClone(this.confirmed));
          if ((saved.revision ?? 0) >= (this.confirmed.revision ?? 0)) this.confirmed = structuredClone(saved);
          this.queue.shift();
          this.publish();
          for (const waiter of item.waiters) waiter.resolve();
        } catch (error) {
          this.queue.shift();
          this.publish();
          for (const fn of this.errors) {
            try { fn(error); } catch (listenerError) { console.error(listenerError); }
          }
          for (const waiter of item.waiters) waiter.reject(error);
        }
      }
    } finally {
      this.working = false;
    }
  }
}
