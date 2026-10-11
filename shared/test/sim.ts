import type { BaseEngine } from '../src/engines/base.ts';

/** Simulatore di tocchi: muove i contatti in modo lineare con tick ogni 16 ms. */
export class Sim {
  t = 1000;
  pos = new Map<number, { x: number; y: number }>();
  constructor(public e: BaseEngine) { e.start(this.t); }
  tick(ms = 16) { this.t += ms; this.e.tick(this.t); }
  wait(ms: number) { const n = Math.ceil(ms / 16); for (let i = 0; i < n; i++) this.tick(16); }
  down(id: number, x: number, y: number) { this.pos.set(id, { x, y }); this.e.pointerDown(id, x, y, this.t); this.tick(); }
  up(id: number) { this.pos.delete(id); this.e.pointerUp(id, this.t); this.tick(); }
  /** sposta più contatti contemporaneamente verso le destinazioni indicate */
  moveTo(targets: Record<number, { x: number; y: number }>, ms: number) {
    const steps = Math.max(1, Math.round(ms / 16));
    const from = new Map(Object.keys(targets).map((k) => [Number(k), { ...this.pos.get(Number(k))! }]));
    for (let i = 1; i <= steps; i++) {
      for (const [id, to] of Object.entries(targets)) {
        const f = from.get(Number(id))!;
        const p = { x: f.x + ((to.x - f.x) * i) / steps, y: f.y + ((to.y - f.y) * i) / steps };
        this.pos.set(Number(id), p);
        this.e.pointerMove(Number(id), p.x, p.y, this.t);
      }
      this.tick();
    }
  }
  /** segue una sequenza di punti */
  follow(id: number, pts: { x: number; y: number }[], msPerSeg = 16) {
    for (const p of pts) this.moveTo({ [id]: p }, msPerSeg);
  }
}
