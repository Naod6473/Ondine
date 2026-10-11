/** Plusieurs nouvelles entre deux images provoquent un seul rendu. */
export class FrameBatch {
  private frame: number | null = null;
  private stopped = false;
  constructor(
    private readonly draw: () => void,
    private readonly schedule = (draw: FrameRequestCallback) => requestAnimationFrame(draw),
    private readonly cancel = (id: number) => cancelAnimationFrame(id),
  ) {}
  request = () => {
    if (this.stopped || this.frame !== null) return;
    this.frame = this.schedule(() => {
      this.frame = null;
      if (!this.stopped) this.draw();
    });
  };
  stop() {
    this.stopped = true;
    if (this.frame !== null) this.cancel(this.frame);
    this.frame = null;
  }
}
