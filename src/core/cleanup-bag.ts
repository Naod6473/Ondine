/** Les nettoyages déjà exécutés ne retiennent plus les vues fermées. */
export class CleanupBag {
  private tasks = new Set<() => void>();
  private closed = false;
  get size() { return this.tasks.size; }
  add(fn: () => void): () => void {
    if (this.closed) { fn(); return () => {}; }
    let active = true;
    const dispose = () => {
      if (!active) return;
      active = false;
      this.tasks.delete(dispose);
      fn();
    };
    this.tasks.add(dispose);
    return dispose;
  }
  flush() {
    this.closed = true;
    const errors: unknown[] = [];
    for (const dispose of [...this.tasks]) {
      try { dispose(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "erreurs de nettoyage");
  }
}
