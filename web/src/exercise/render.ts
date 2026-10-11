import type { Shape, Tone } from '@handlab/shared';

let cache: Record<string, string> | null = null;
function colors(): Record<Tone, string> {
  if (!cache) {
    const cs = getComputedStyle(document.documentElement);
    const g = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
    cache = {
      target: g('--ex-target', '#0f6e6e'), active: g('--ex-active', '#2457a6'), ok: g('--ex-ok', '#1f9d55'), warn: g('--ex-warn', '#e08a00'),
      muted: g('--ex-muted', '#9fb3b1'), finger: g('--ex-finger', '#2457a6'), track: g('--ex-track', '#5aa7a0'), ghost: g('--ex-ghost', '#c9d8d6'),
      error: g('--ex-error', '#c0392b'), cue: g('--ex-cue', '#f2a900'),
    };
  }
  return cache as Record<Tone, string>;
}

export function drawScene(ctx: CanvasRenderingContext2D, shapes: Shape[]) {
  const c = colors();
  for (const s of shapes) {
    ctx.save();
    ctx.globalAlpha = 'alpha' in s && s.alpha !== undefined ? s.alpha : 1;
    if (s.kind === 'circle') {
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(1, s.r), 0, Math.PI * 2);
      if (s.fill) { ctx.fillStyle = c[s.fill]; ctx.fill(); }
      if (s.stroke) { ctx.globalAlpha = 1; ctx.lineWidth = s.width ?? 3; ctx.strokeStyle = c[s.stroke]; ctx.stroke(); }
      if (s.label) { ctx.globalAlpha = 1; ctx.fillStyle = s.fill === 'finger' || s.fill === 'error' ? '#fff' : '#17302f'; ctx.font = `700 ${Math.round(s.r * 0.8)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s.label, s.x, s.y); }
    } else if (s.kind === 'line') {
      if (s.pts.length < 2) { ctx.restore(); continue; }
      ctx.beginPath();
      ctx.moveTo(s.pts[0].x, s.pts[0].y);
      for (const p of s.pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.lineWidth = s.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = c[s.tone];
      if (s.dash) ctx.setLineDash(s.dash);
      ctx.stroke();
    } else if (s.kind === 'text') {
      ctx.fillStyle = c[s.tone]; ctx.font = `600 ${Math.round(s.size)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(s.text, s.x, s.y);
    }
    ctx.restore();
  }
}

export function resetColorCache() { cache = null; }
