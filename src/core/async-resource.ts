/** Une ressource tardive appartient à la vue qui l'a demandée, même après sa fermeture. */
export class AsyncResource<T> {
  private generation = 0;
  private disposed = false;
  private resource: T | null = null;
  loading = false;

  constructor(private readonly release: (value: T) => void) {}
  get value(): T | null { return this.resource; }

  async open(create: () => Promise<T>): Promise<T | null> {
    if (this.disposed) return null;
    this.close();
    const generation = this.generation;
    this.loading = true;
    let value: T;
    try { value = await create(); }
    catch (error) {
      if (generation !== this.generation || this.disposed) return null;
      this.loading = false;
      throw error;
    }
    if (generation !== this.generation || this.disposed) {
      this.release(value);
      return null;
    }
    this.loading = false;
    this.resource = value;
    return value;
  }

  close() {
    this.generation++;
    this.loading = false;
    const value = this.resource;
    this.resource = null;
    if (value !== null) this.release(value);
  }

  destroy() { this.disposed = true; this.close(); }
}
