import { useCallback, useRef, useState } from 'react';
import { ContactTracker, fingerLabel, shortFinger, type Calibration, type FingerId, type Hand, type NPoint, type Pt } from '@handlab/shared';
import { TouchSurface } from './TouchSurface';
import { drawScene } from './render';
import { anchorsPx, areaMismatch } from './placement';

/**
 * Riposizionamento all'inizio della seduta: non è una nuova taratura. Le dita vengono appoggiate
 * sulle posizioni di riferimento; lo scostamento medio viene applicato solo a questa seduta.
 */
export function Reposition({ calibration, hand, fingers, onDone, onCancel }: {
  calibration: Calibration | null; hand: Hand; fingers: FingerId[];
  onDone: (r: { method: 'accepted' | 'offset' | 'skipped'; offset: NPoint }) => void; onCancel: () => void;
}) {
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  const [found, setFound] = useState<NPoint | null>(null);
  const tracker = useRef<ContactTracker | null>(null);
  const anchors = useRef<Partial<Record<FingerId, Pt>>>({});
  const stableSince = useRef<number | null>(null);

  const onResize = useCallback((w: number, h: number) => {
    setArea({ w, h });
    anchors.current = anchorsPx({ calibration, offset: { x: 0, y: 0 } }, hand, { w, h });
    tracker.current = new ContactTracker(fingers, anchors.current, 0.3 * Math.min(w, h));
    stableSince.current = null;
    setFound(null);
  }, [calibration, hand, fingers]);

  const onFrame = useCallback((t: number) => {
    const tr = tracker.current;
    if (!tr || !area || found) return;
    const all = fingers.every((f) => tr.isDown(f));
    if (!all) { stableSince.current = null; return; }
    if (stableSince.current === null) stableSince.current = t;
    if (t - stableSince.current > 1000) {
      const s = Math.min(area.w, area.h);
      let dx = 0, dy = 0;
      for (const f of fingers) { const p = tr.pos(f)!, a = anchors.current[f]!; dx += p.x - a.x; dy += p.y - a.y; }
      setFound({ x: dx / fingers.length / s, y: dy / fingers.length / s });
    }
  }, [area, fingers, found]);

  const mismatch = area ? areaMismatch(calibration, area) : 0;
  const dist = found ? Math.hypot(found.x, found.y) : 0;

  return (
    <div className="exercise-screen">
      <div className="exercise-bar">
        <span className="title">Posizione della mano</span>
        <span className="msg">{found ? 'Posizione rilevata' : `Appoggia: ${fingers.map(fingerLabel).join(', ')}`}</span>
        <button onClick={() => onDone({ method: 'skipped', offset: { x: 0, y: 0 } })} data-testid="skip-reposition">Salta</button>
        <button onClick={onCancel}>Indietro</button>
      </div>
      {mismatch > 0.05 && <div className="notice warn small area-notice">L'area di gioco è diversa da quella della taratura ({Math.round(mismatch * 100)}%): controlla con attenzione la posizione della mano.</div>}
      {!calibration && <div className="notice warn small area-notice">Nessuna taratura per questa mano: vengono mostrate posizioni predefinite.</div>}
      <TouchSurface
        handlers={{
          onResize, onFrame,
          onDown: (id, x, y, t) => { if (!found) tracker.current?.down(id, x, y, t); },
          onMove: (id, x, y) => { tracker.current?.move(id, x, y); },
          onUp: (id) => { tracker.current?.up(id, false); },
          draw: (ctx) => {
            const tr = tracker.current;
            if (!tr || !area) return;
            const s = Math.min(area.w, area.h);
            const shapes: any[] = [];
            for (const f of fingers) {
              const a = anchors.current[f];
              if (a) {
                shapes.push({ kind: 'circle', x: a.x, y: a.y, r: 0.07 * s, stroke: tr.isDown(f) ? 'ok' : 'cue', width: 5 });
                shapes.push({ kind: 'text', x: a.x, y: a.y - 0.1 * s, text: fingerLabel(f), size: 0.035 * s, tone: 'muted' });
              }
            }
            for (const c of tr.contacts.values()) shapes.push({ kind: 'circle', x: c.x, y: c.y, r: 0.045 * s, fill: c.finger ? 'finger' : 'error', alpha: 0.85, label: c.finger ? shortFinger(c.finger) : '?' });
            drawScene(ctx, shapes);
          },
        }}
      />
      {found && (
        <div className="exercise-overlay">
          <div className="box">
            <h2>Posizione rilevata</h2>
            <p>{dist < 0.03 ? 'La mano è nella posizione della taratura.' : `La mano è spostata di circa ${(dist * 100).toFixed(0)}% del lato corto dello schermo rispetto alla taratura: le zone dell'esercizio verranno spostate di conseguenza solo per questa seduta.`}</p>
            {dist > 0.15 && <p className="notice warn">Spostamento ampio: verifica che il tablet e l'avambraccio siano nella posizione abituale.</p>}
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn-huge" onClick={() => { setFound(null); stableSince.current = null; }}>Riprova</button>
              <button className="btn-huge btn-primary" data-testid="confirm-reposition" onClick={() => onDone({ method: dist < 0.03 ? 'accepted' : 'offset', offset: found })}>Conferma</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
