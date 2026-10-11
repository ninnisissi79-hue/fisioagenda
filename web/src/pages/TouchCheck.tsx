import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { availableExercises, requiredContacts } from '@handlab/shared';
import { TouchSurface } from '../exercise/TouchSurface';
import { drawScene } from '../exercise/render';
import { deviceInfo, lastTouchCheck, saveTouchCheck, type TouchCheckResult } from '../local/device';
import { enqueue, syncUserId } from '../local/sync';
import { POST } from '../api';

const STEPS = [
  { n: 1, text: 'Appoggia UN dito sullo schermo' },
  { n: 2, text: 'Appoggia DUE dita insieme' },
  { n: 3, text: 'Appoggia TRE dita insieme' },
  { n: 4, text: 'Appoggia QUATTRO dita insieme' },
  { n: 5, text: 'Appoggia CINQUE dita insieme (tutta la mano)' },
];

/**
 * Verifica guidata del touchscreen: misura i contatti simultanei realmente rilevati,
 * gli annullamenti di sistema e la ricomparsa di un contatto. Non si basa solo su navigator.maxTouchPoints.
 */
export function TouchCheck({ embedded }: { embedded?: boolean }) {
  const nav = useNavigate();
  const contacts = useRef(new Map<number, { x: number; y: number }>());
  const [step, setStep] = useState(0);
  const [maxSeen, setMaxSeen] = useState(0);
  const [cancels, setCancels] = useState(0);
  const [reappear, setReappear] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<'count' | 'reappear' | 'done'>('count');
  const [result, setResult] = useState<TouchCheckResult | null>(null);
  const reapState = useRef<{ lifted: boolean; first: { x: number; y: number } | null }>({ lifted: false, first: null });
  const stable = useRef<number | null>(null);
  const declared = navigator.maxTouchPoints ?? 0;
  const pointerEvents = typeof window.PointerEvent === 'function';

  const finish = useCallback((max: number, re: boolean | null, canc: number) => {
    const r: TouchCheckResult = { at: new Date().toISOString(), maxContacts: max, declared, pointerEvents, cancelEvents: canc, reappearOk: re, notes: '' };
    saveTouchCheck(r);
    setResult(r);
    setPhase('done');
    const payload = { id: crypto.randomUUID(), at: r.at, device: deviceInfo(), maxContacts: max, declared, notes: `cancel:${canc} reappear:${re}` };
    if (syncUserId()) void enqueue('deviceCheck', payload.id, payload).catch(() => POST('/api/device-checks', { id: payload.id, at: payload.at, data: payload }).catch(() => {}));
  }, [declared, pointerEvents]);

  const onFrame = useCallback((t: number) => {
    if (phase !== 'count') return;
    const n = contacts.current.size;
    const target = STEPS[step]?.n;
    if (n === target) {
      if (stable.current === null) stable.current = t;
      if (t - stable.current > 600) { stable.current = null; if (step + 1 < STEPS.length) setStep(step + 1); else setPhase('reappear'); }
    } else stable.current = null;
  }, [phase, step]);

  const skipToReappear = () => setPhase('reappear');
  const s = STEPS[step];
  const supported = (max: number) => availableExercises().map((d) => ({ d, need: requiredContacts(d, d.defaultFingers) })).map((x) => ({ ...x, ok: x.need <= max }));

  if (phase === 'done' && result) {
    return (
      <div className={embedded ? '' : 'patient-main'}>
        <h1>Risultato della verifica</h1>
        <div className="card">
          <p>Contatti simultanei rilevati: <b data-testid="touch-max">{result.maxContacts}</b> (dichiarati dal browser: {result.declared || 'non indicati'})</p>
          <p>Pointer Events: {result.pointerEvents ? 'disponibili' : 'non disponibili'} · Contatti annullati dal sistema: {result.cancelEvents} · Ricomparsa di un dito: {result.reappearOk === null ? 'non verificata' : result.reappearOk ? 'rilevata correttamente' : 'problemi'}</p>
          {result.cancelEvents > 0 && <div className="notice warn small">Il sistema ha annullato alcuni contatti (es. gesti di sistema con molte dita). Su iPad valuta di disattivare i "Gesti multitasking" nelle impostazioni del dispositivo.</div>}
          <h3>Esercizi con le dita predefinite</h3>
          <ul>{supported(result.maxContacts).map(({ d, need, ok }) => <li key={d.id}>{d.name}: {ok ? '✓ supportato' : `✗ richiede ${need} contatti – usa meno dita o un'alternativa`}</li>)}</ul>
        </div>
        <div className="row"><button onClick={() => { setStep(0); setMaxSeen(0); setCancels(0); setReappear(null); setPhase('count'); setResult(null); }}>Ripeti la verifica</button>{!embedded && <button className="btn-primary" onClick={() => nav(-1)}>Fine</button>}</div>
      </div>
    );
  }

  const prev = lastTouchCheck();
  return (
    <div className="exercise-screen">
      <div className="exercise-bar">
        <span className="title">Verifica touchscreen</span>
        <span className="msg" data-testid="touch-message">{phase === 'count' ? s.text : reappear === null ? 'Appoggia un dito, sollevalo e riappoggialo nello stesso punto' : 'Fatto'}</span>
        <span className="small">rilevati ora: <b data-testid="touch-now">{contacts.current.size}</b> · massimo: <b>{maxSeen}</b></span>
        {phase === 'count' && <button onClick={skipToReappear} data-testid="touch-skip">Non riesco ad andare oltre</button>}
        {phase === 'reappear' && <button className="btn-primary" onClick={() => finish(maxSeen, reappear, cancels)} data-testid="touch-finish">Concludi</button>}
        <button onClick={() => nav(-1)}>Esci</button>
      </div>
      {prev && phase === 'count' && step === 0 && <div className="small" style={{ padding: 4, textAlign: 'center' }}>Ultima verifica: {prev.maxContacts} contatti ({new Date(prev.at).toLocaleDateString('it-IT')})</div>}
      <TouchSurface handlers={{
        onFrame,
        onDown: (id, x, y) => {
          contacts.current.set(id, { x, y });
          setMaxSeen((m) => Math.max(m, contacts.current.size));
          if (phase === 'reappear') {
            const r = reapState.current;
            if (!r.first) r.first = { x, y };
            else if (r.lifted) { setReappear(Math.hypot(x - r.first.x, y - r.first.y) < 120); }
          }
        },
        onMove: (id, x, y) => { const c = contacts.current.get(id); if (c) { c.x = x; c.y = y; } },
        onUp: (id, _t, cancelled) => {
          if (!contacts.current.has(id)) return;
          contacts.current.delete(id);
          if (cancelled) setCancels((c) => c + 1);
          if (phase === 'reappear' && reapState.current.first) reapState.current.lifted = true;
        },
        draw: (ctx, w, h) => {
          const r = Math.min(w, h) * 0.06;
          drawScene(ctx, [...contacts.current.values()].map((c, i) => ({ kind: 'circle', x: c.x, y: c.y, r, fill: 'finger', alpha: .85, label: String(i + 1) } as any)));
        },
      }} />
    </div>
  );
}
