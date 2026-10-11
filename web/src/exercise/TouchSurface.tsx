import { useEffect, useRef } from 'react';

export interface SurfaceHandlers {
  onDown?: (id: number, x: number, y: number, t: number) => void;
  onMove?: (id: number, x: number, y: number, t: number) => void;
  onUp?: (id: number, t: number, cancelled: boolean) => void;
  onFrame?: (t: number) => void;
  draw?: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;
  onResize?: (w: number, h: number) => void;
}

/**
 * Superficie di input multi-touch basata sui Pointer Events.
 * Blocca zoom, scorrimento e menu contestuale SOLO in quest'area (touch-action: none +
 * preventDefault sugli eventi touch e sui gesti di Safari).
 */
export function TouchSurface({ handlers, label }: { handlers: SurfaceHandlers; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    const el = ref.current!, canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let w = 0, hh = 0, raf = 0;
    const rect = () => el.getBoundingClientRect();
    const resize = () => {
      const r = rect();
      w = r.width; hh = r.height;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      h.current.onResize?.(w, hh);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const pos = (e: PointerEvent) => { const r = rect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const down = (e: PointerEvent) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* */ }
      const p = pos(e); h.current.onDown?.(e.pointerId, p.x, p.y, performance.now());
    };
    const move = (e: PointerEvent) => {
      const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const ce of evs.length ? evs : [e]) { const p = pos(ce); h.current.onMove?.(e.pointerId, p.x, p.y, performance.now()); }
    };
    const up = (e: PointerEvent) => h.current.onUp?.(e.pointerId, performance.now(), false);
    const cancel = (e: PointerEvent) => h.current.onUp?.(e.pointerId, performance.now(), true);
    const prevent = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('lostpointercapture', up);
    // blocca scorrimento e zoom nell'area (Safari iOS ignora user-scalable)
    el.addEventListener('touchstart', prevent, { passive: false });
    el.addEventListener('touchmove', prevent, { passive: false });
    el.addEventListener('gesturestart', prevent as any);
    el.addEventListener('gesturechange', prevent as any);
    el.addEventListener('contextmenu', prevent);
    const frame = (t: number) => {
      h.current.onFrame?.(t);
      ctx.clearRect(0, 0, w, hh);
      h.current.draw?.(ctx, w, hh, t);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('lostpointercapture', up);
      el.removeEventListener('touchstart', prevent);
      el.removeEventListener('touchmove', prevent);
      el.removeEventListener('gesturestart', prevent as any);
      el.removeEventListener('gesturechange', prevent as any);
      el.removeEventListener('contextmenu', prevent);
    };
  }, []);

  return (
    <div ref={ref} className="exercise-area" data-testid="exercise-area" aria-label={label ?? 'Area dell\'esercizio'}>
      <canvas ref={canvasRef} />
    </div>
  );
}
