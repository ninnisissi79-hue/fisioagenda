import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ALL_FINGERS, fingerLabel, getExercise, handLabel, shortFinger, type ComfortZone, type FingerId, type Hand, type NPoint } from '@handlab/shared';
import { GET, POST, errMsg } from '../../api';
import { useAsync, ErrorBox, Loading, Field } from '../../components/ui';
import { TouchSurface } from '../../exercise/TouchSurface';
import { drawScene } from '../../exercise/render';
import { deviceInfo, measuredMaxContacts, physicalScale } from '../../local/device';

type Step = 'hand' | 'position' | 'single' | 'layout' | 'comfort' | 'trial' | 'summary';
interface Contact { id: number; x: number; y: number; t0: number }

/** permutazione che minimizza la distanza totale tra contatti e posizioni registrate (≤ 5 dita) */
function bestAssignment(points: NPoint[], fingers: FingerId[], ref: Partial<Record<FingerId, NPoint>>): Record<FingerId, NPoint> | null {
  if (points.length !== fingers.length) return null;
  let best: FingerId[] | null = null, bestCost = Infinity;
  const permute = (arr: FingerId[], k: number) => {
    if (k === arr.length) {
      let c = 0;
      arr.forEach((f, i) => { const r = ref[f]; c += r ? Math.hypot(r.x - points[i].x, r.y - points[i].y) : 0; });
      if (c < bestCost) { bestCost = c; best = [...arr]; }
      return;
    }
    for (let i = k; i < arr.length; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; permute(arr, k + 1); [arr[k], arr[i]] = [arr[i], arr[k]]; }
  };
  permute([...fingers], 0);
  const out = {} as Record<FingerId, NPoint>;
  best!.forEach((f, i) => { out[f] = points[i]; });
  return out;
}

export function CalibrationWizard() {
  const { id } = useParams();
  const nav = useNavigate();
  const pq = useAsync(() => GET<any>(`/api/patients/${id}`), [id]);
  const cq = useAsync(() => GET<any[]>(`/api/patients/${id}/calibrations`), [id]);
  const [step, setStep] = useState<Step>('hand');
  const [hand, setHand] = useState<Hand | null>(null);
  const [fingers, setFingers] = useState<FingerId[]>(['T', 'I', 'M', 'R', 'L']);
  const [isReference, setIsReference] = useState<boolean | null>(null);
  const [notes, setNotes] = useState('');
  const [posOk, setPosOk] = useState(false);
  const [single, setSingle] = useState<Partial<Record<FingerId, NPoint>>>({});
  const [layout, setLayout] = useState<Record<FingerId, NPoint> | null>(null);
  const [layoutMethod, setLayoutMethod] = useState<'simultaneous' | 'single_only'>('simultaneous');
  const [maxSeen, setMaxSeen] = useState(0);
  const [comfortPlan, setComfortPlan] = useState<{ pinch: boolean; slide: boolean; region: boolean }>({ pinch: true, slide: true, region: true });
  const [comfort, setComfort] = useState<ComfortZone[]>([]);
  const [trial, setTrial] = useState<{ done: boolean; ok: boolean; note?: string }>({ done: false, ok: false });
  const [area, setArea] = useState<{ w: number; h: number }>({ w: window.innerWidth, h: window.innerHeight });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (pq.loading || cq.loading) return <Loading />;
  if (pq.error) return <ErrorBox error={pq.error} />;
  const patient = pq.data;
  const h: Hand = hand ?? (patient.affectedHand === 'left' ? 'left' : 'right');
  const ref = isReference ?? !(cq.data?.length);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const body = {
        id: crypto.randomUUID(), isReference: ref, hand: h, fingers, singleAnchors: single, layout, layoutMethod, comfort,
        area, orientation: area.w >= area.h ? 'landscape' : 'portrait', device: { ...deviceInfo(), measuredMaxContacts: Math.max(maxSeen, measuredMaxContacts() ?? 0) || null },
        physicalScale: physicalScale(), trial, notes,
      };
      await POST(`/api/patients/${id}/calibrations`, body);
      nav(`/pazienti/${id}?tab=calibration`);
    } catch (e) { setErr(errMsg(e)); } finally { setSaving(false); }
  };

  if (step === 'hand') return (
    <div>
      <div className="small"><Link to={`/pazienti/${id}?tab=calibration`}>← {patient.code}</Link></div>
      <h1>Taratura · 1. Mano</h1>
      <div className="card">
        <div className="notice info small">Il touchscreen non riconosce le dita: l'associazione deriva da questa procedura. Le posizioni sono salvate in coordinate normalizzate (frazioni del lato corto dell'area), non in centimetri.</div>
        <Field label="Mano"><div className="row">{(['right', 'left'] as Hand[]).map((x) => <button key={x} className={h === x ? 'btn-primary' : ''} onClick={() => setHand(x)}>{handLabel(x)}</button>)}</div></Field>
        <Field label="Dita da tarare"><div className="finger-pick">{ALL_FINGERS.map((f) => <button key={f} className={fingers.includes(f) ? 'sel' : ''} onClick={() => setFingers(fingers.includes(f) ? fingers.filter((x) => x !== f) : ALL_FINGERS.filter((x) => x === f || fingers.includes(x)))}>{fingerLabel(f)}</button>)}</div></Field>
        <label className="check"><input type="checkbox" checked={ref} disabled={!cq.data?.length} onChange={(e) => setIsReference(e.target.checked)} /> Taratura di riferimento {!cq.data?.length && '(prima taratura)'}</label>
        <p className="small muted">{cq.data?.length ? `Esistono già ${cq.data.length} tarature: questa diventerà la versione ${cq.data.length + 1}, senza cancellare le precedenti.` : ''}</p>
        <Field label="Note (facoltative)"><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <button className="btn-primary" disabled={!fingers.length} onClick={() => setStep('position')}>Avanti</button>
      </div>
    </div>
  );

  if (step === 'position') return (
    <div>
      <h1>Taratura · 2. Posizionamento</h1>
      <div className="card">
        <ul>
          <li>Tablet appoggiato in piano su un tavolo stabile, in orizzontale.</li>
          <li>Avambraccio appoggiato e comodo, polso rilassato.</li>
          <li>La mano {h === 'left' ? 'sinistra' : 'destra'} sullo schermo senza sforzo; il paziente non deve superare movimenti confortevoli.</li>
          <li>Annota la posizione (es. distanza dal bordo del tavolo) per ritrovarla nelle sedute successive.</li>
        </ul>
        {window.innerHeight > window.innerWidth && <div className="notice warn">Il tablet è in verticale: si consiglia l'orientamento orizzontale.</div>}
        {measuredMaxContacts() === null && <div className="notice info small">Contatti simultanei del dispositivo non ancora verificati: puoi farlo in Impostazioni → Verifica touchscreen. La taratura registrerà comunque quanti contatti rileva.</div>}
        <label className="check"><input type="checkbox" checked={posOk} onChange={(e) => setPosOk(e.target.checked)} /> Posizione verificata con il paziente</label>
        <div className="row" style={{ marginTop: 10 }}><button onClick={() => setStep('hand')}>Indietro</button><button className="btn-primary" disabled={!posOk} onClick={() => setStep('single')}>Avanti</button></div>
      </div>
    </div>
  );

  if (step === 'single') return <SingleStep fingers={fingers} onArea={setArea} onCancel={() => setStep('position')} onDone={(s) => { setSingle(s); setStep('layout'); }} />;
  if (step === 'layout') return <LayoutStep fingers={fingers} single={single} onArea={setArea} onSeen={(n) => setMaxSeen((m) => Math.max(m, n))} onBack={() => setStep('single')}
    onDone={(l) => { setLayout(l); setLayoutMethod(l ? 'simultaneous' : 'single_only'); setStep('comfort'); }} />;
  if (step === 'comfort') return <ComfortStep fingers={fingers} anchors={{ ...single, ...(layout ?? {}) }} plan={comfortPlan} setPlan={setComfortPlan} onArea={setArea} onBack={() => setStep('layout')} onDone={(c) => { setComfort(c); setStep('trial'); }} />;
  if (step === 'trial') return <TrialStep fingers={fingers} anchors={{ ...single, ...(layout ?? {}) }} onArea={setArea} onDone={(t) => { setTrial(t); setStep('summary'); }} />;

  return (
    <div>
      <h1>Taratura · Riepilogo</h1>
      <div className="card">
        <dl className="dl">
          <dt>Paziente</dt><dd>{patient.code}</dd>
          <dt>Mano</dt><dd>{handLabel(h)}</dd>
          <dt>Dita</dt><dd>{fingers.map(fingerLabel).join(', ')}</dd>
          <dt>Disposizione</dt><dd>{layoutMethod === 'simultaneous' ? 'registrata con tutte le dita appoggiate' : 'solo una alla volta'}</dd>
          <dt>Contatti simultanei rilevati</dt><dd>{maxSeen || '—'}</dd>
          <dt>Aree confortevoli approvate</dt><dd>{comfort.length ? comfort.map((c) => getExercise(c.exerciseId)?.name).join(', ') : 'nessuna (verranno usati valori prudenti predefiniti)'}</dd>
          <dt>Prova</dt><dd>{trial.done ? (trial.ok ? 'superata' : `con problemi${trial.note ? `: ${trial.note}` : ''}`) : 'saltata'}</dd>
          <dt>Area di gioco</dt><dd>{Math.round(area.w)}×{Math.round(area.h)} px</dd>
          <dt>Calibrazione fisica</dt><dd>{physicalScale() ? `${physicalScale()!.pxPerMm.toFixed(2)} px/mm (${physicalScale()!.method})` : 'non eseguita: le misure restano in unità normalizzate'}</dd>
          <dt>Tipo</dt><dd>{ref ? 'Taratura di riferimento' : 'Nuova taratura (versione successiva)'}</dd>
        </dl>
        <ErrorBox error={err} />
        <div className="row" style={{ marginTop: 12 }}><button onClick={() => setStep('trial')}>Indietro</button><button className="btn-primary" disabled={saving} onClick={save} data-testid="save-calibration">Salva taratura</button></div>
      </div>
    </div>
  );
}

function useContacts() {
  const contacts = useRef(new Map<number, Contact>());
  const handlers = {
    onDown: (id: number, x: number, y: number, t: number) => { contacts.current.set(id, { id, x, y, t0: t }); },
    onMove: (id: number, x: number, y: number) => { const c = contacts.current.get(id); if (c) { c.x = x; c.y = y; } },
    onUp: (id: number) => { contacts.current.delete(id); },
  };
  return { contacts, handlers };
}

function Bar({ title, msg, children }: { title: string; msg: string; children?: React.ReactNode }) {
  return <div className="exercise-bar"><span className="title">{title}</span><span className="msg" data-testid="calib-message">{msg}</span>{children}</div>;
}

function SingleStep({ fingers, onDone, onCancel, onArea }: { fingers: FingerId[]; onDone: (s: Partial<Record<FingerId, NPoint>>) => void; onCancel: () => void; onArea: (a: { w: number; h: number }) => void }) {
  const { contacts, handlers } = useContacts();
  const [idx, setIdx] = useState(0);
  const [got, setGot] = useState<Partial<Record<FingerId, NPoint>>>({});
  const [waitLift, setWaitLift] = useState(false);
  const size = useRef({ w: 1, h: 1 });
  const samples = useRef<NPoint[]>([]);
  const f = fingers[idx];
  const onFrame = useCallback((t: number) => {
    const cs = [...contacts.current.values()];
    const s = Math.min(size.current.w, size.current.h);
    if (waitLift) { if (cs.length === 0) { setWaitLift(false); if (idx + 1 < fingers.length) setIdx(idx + 1); } return; }
    if (cs.length !== 1 || !f) { samples.current = []; return; }
    const c = cs[0];
    samples.current.push({ x: c.x / s, y: c.y / s });
    if (t - c.t0 > 800 && samples.current.length > 10) {
      const xs = samples.current.map((p) => p.x).sort((a, b) => a - b), ys = samples.current.map((p) => p.y).sort((a, b) => a - b);
      const med = { x: xs[Math.floor(xs.length / 2)], y: ys[Math.floor(ys.length / 2)] };
      setGot((g) => ({ ...g, [f]: med }));
      samples.current = [];
      setWaitLift(true);
    }
  }, [f, idx, fingers.length, waitLift, contacts]);
  const complete = fingers.every((x) => got[x]);
  return (
    <div className="exercise-screen">
      <Bar title="3. Un dito alla volta" msg={complete ? 'Tutte le dita registrate' : waitLift ? 'Registrato: solleva il dito' : `Appoggia il ${fingerLabel(f).toUpperCase()} nella posizione comoda`}>
        <button onClick={() => { setGot({}); setIdx(0); setWaitLift(false); }}>Ricomincia</button>
        <button onClick={onCancel}>Indietro</button>
        <button className="btn-primary" disabled={!complete} onClick={() => onDone(got)} data-testid="calib-next">Avanti</button>
      </Bar>
      <TouchSurface handlers={{ ...handlers, onFrame, onResize: (w, h) => { size.current = { w, h }; onArea({ w, h }); },
        draw: (ctx, w, h) => {
          const s = Math.min(w, h);
          const shapes: any[] = [];
          for (const [ff, p] of Object.entries(got) as [FingerId, NPoint][]) shapes.push({ kind: 'circle', x: p.x * s, y: p.y * s, r: 0.05 * s, stroke: 'ok', width: 4, label: shortFinger(ff) });
          for (const c of contacts.current.values()) shapes.push({ kind: 'circle', x: c.x, y: c.y, r: 0.045 * s, fill: 'finger', alpha: .8 });
          drawScene(ctx, shapes);
        } }} />
    </div>
  );
}

function LayoutStep({ fingers, single, onDone, onBack, onSeen, onArea }: { fingers: FingerId[]; single: Partial<Record<FingerId, NPoint>>; onDone: (l: Record<FingerId, NPoint> | null) => void; onBack: () => void; onSeen: (n: number) => void; onArea: (a: { w: number; h: number }) => void }) {
  const { contacts, handlers } = useContacts();
  const [result, setResult] = useState<Record<FingerId, NPoint> | null>(null);
  const [maxNow, setMaxNow] = useState(0);
  const size = useRef({ w: 1, h: 1 });
  const stable = useRef<number | null>(null);
  const onFrame = useCallback((t: number) => {
    const cs = [...contacts.current.values()];
    if (cs.length > maxNow) { setMaxNow(cs.length); onSeen(cs.length); }
    if (result) return;
    if (cs.length !== fingers.length) { stable.current = null; return; }
    if (stable.current === null) stable.current = t;
    if (t - stable.current > 1000) {
      const s = Math.min(size.current.w, size.current.h);
      setResult(bestAssignment(cs.map((c) => ({ x: c.x / s, y: c.y / s })), fingers, single));
    }
  }, [contacts, fingers, single, result, maxNow, onSeen]);
  return (
    <div className="exercise-screen">
      <Bar title="4. Disposizione iniziale" msg={result ? 'Disposizione registrata' : `Appoggia insieme: ${fingers.map(fingerLabel).join(', ')}`}>
        <span className="small muted">contatti ora: {maxNow ? `max ${maxNow}` : '0'}</span>
        <button onClick={onBack}>Indietro</button>
        <button onClick={() => { setResult(null); stable.current = null; }}>Ripeti</button>
        <button onClick={() => onDone(null)} data-testid="calib-single-only">Usa solo un dito alla volta</button>
        <button className="btn-primary" disabled={!result} onClick={() => onDone(result)} data-testid="calib-next">Avanti</button>
      </Bar>
      {maxNow > 0 && maxNow < fingers.length && !result && <div className="notice warn small area-notice">Finora rilevati al massimo {maxNow} contatti simultanei su {fingers.length}. Se il dispositivo non ne rileva di più, usa "solo un dito alla volta": gli esercizi che richiedono più contatti potrebbero non essere disponibili.</div>}
      <TouchSurface handlers={{ ...handlers, onFrame, onResize: (w, h) => { size.current = { w, h }; onArea({ w, h }); },
        draw: (ctx, w, h) => {
          const s = Math.min(w, h);
          const shapes: any[] = [];
          for (const [ff, p] of Object.entries(single) as [FingerId, NPoint][]) shapes.push({ kind: 'circle', x: p.x * s, y: p.y * s, r: 0.06 * s, stroke: 'ghost', width: 3, label: shortFinger(ff) });
          if (result) for (const [ff, p] of Object.entries(result) as [FingerId, NPoint][]) shapes.push({ kind: 'circle', x: p.x * s, y: p.y * s, r: 0.05 * s, stroke: 'ok', width: 5, label: shortFinger(ff) });
          for (const c of contacts.current.values()) shapes.push({ kind: 'circle', x: c.x, y: c.y, r: 0.045 * s, fill: 'finger', alpha: .8 });
          drawScene(ctx, shapes);
        } }} />
    </div>
  );
}

type ComfortTask = { key: 'pinch' | 'slide' | 'region'; kind: ComfortZone['kind']; label: string; exerciseIds: string[] };
const TASKS: ComfortTask[] = [
  { key: 'pinch', kind: 'distance', label: 'Pinza sul piano: avvicinare e allontanare pollice e dito nel range confortevole', exerciseIds: ['pinch'] },
  { key: 'slide', kind: 'segment', label: 'Scorrimento: dal punto di partenza al punto più lontano confortevole', exerciseIds: ['slide'] },
  { key: 'region', kind: 'region', label: 'Area di movimento del dito (Segui la strada, Insegui il bersaglio)', exerciseIds: ['path', 'chase'] },
];

function ComfortStep({ fingers, anchors, plan, setPlan, onDone, onBack, onArea }: { fingers: FingerId[]; anchors: Partial<Record<FingerId, NPoint>>; plan: Record<string, boolean>; setPlan: (p: any) => void; onDone: (c: ComfortZone[]) => void; onBack: () => void; onArea: (a: { w: number; h: number }) => void }) {
  const tasks = TASKS.filter((t) => plan[t.key] && (t.key !== 'pinch' || (fingers.includes('T') && fingers.length > 1)));
  const [i, setI] = useState(-1);
  const [zones, setZones] = useState<ComfortZone[]>([]);
  const [mover, setMover] = useState<FingerId>(fingers.find((f) => f !== 'T') ?? fingers[0]);
  const finished = i >= 0 && i >= tasks.length;
  useEffect(() => { if (finished) onDone(zones); }, [finished]); // eslint-disable-line
  if (i === -1) return (
    <div>
      <h1>Taratura · 5. Aree di movimento confortevoli</h1>
      <div className="card">
        <p>Per ciascun esercizio il paziente esegue il movimento solo entro l'ampiezza confortevole; tu approvi l'area registrata. Gli esercizi non supereranno mai quest'area (ampiezza ≤ 100%).</p>
        {TASKS.map((t) => <label key={t.key} className="check" style={{ display: 'flex' }}><input type="checkbox" checked={plan[t.key]} onChange={(e) => setPlan({ ...plan, [t.key]: e.target.checked })} /> {t.label}</label>)}
        <Field label="Dito usato per scorrimento e area di movimento"><select value={mover} onChange={(e) => setMover(e.target.value as FingerId)}>{fingers.map((f) => <option key={f} value={f}>{fingerLabel(f)}</option>)}</select></Field>
        {plan.pinch && !fingers.includes('T') && <p className="small muted">La pinza richiede il pollice tra le dita tarate.</p>}
        <div className="row"><button onClick={onBack}>Indietro</button><button className="btn-primary" onClick={() => (tasks.length ? setI(0) : onDone([]))}>{tasks.length ? 'Inizia' : 'Salta'}</button></div>
      </div>
    </div>
  );
  if (finished) return null;
  return <ComfortRecorder key={i} task={tasks[i]} mover={mover} anchors={anchors} onArea={onArea}
    onApprove={(z) => { setZones([...zones.filter((x) => !z.some((n) => n.exerciseId === x.exerciseId)), ...z]); setI(i + 1); }}
    onSkip={() => setI(i + 1)} />;
}

function ComfortRecorder({ task, mover, anchors, onApprove, onSkip, onArea }: { task: ComfortTask; mover: FingerId; anchors: Partial<Record<FingerId, NPoint>>; onApprove: (z: ComfortZone[]) => void; onSkip: () => void; onArea: (a: { w: number; h: number }) => void }) {
  const { contacts, handlers } = useContacts();
  const size = useRef({ w: 1, h: 1 });
  const [rec, setRec] = useState(false);
  const data = useRef<{ min: number; max: number; start: NPoint | null; end: NPoint | null; pts: NPoint[] }>({ min: Infinity, max: 0, start: null, end: null, pts: [] });
  const [snap, setSnap] = useState<typeof data.current | null>(null);
  const [, force] = useState(0);
  const partner: FingerId = mover === 'T' ? 'I' : mover;
  const onFrame = useCallback(() => {
    if (!rec) return;
    const s = Math.min(size.current.w, size.current.h);
    const cs = [...contacts.current.values()].map((c) => ({ x: c.x / s, y: c.y / s }));
    const d = data.current;
    if (task.kind === 'distance' && cs.length === 2) {
      const dd = Math.hypot(cs[0].x - cs[1].x, cs[0].y - cs[1].y);
      d.min = Math.min(d.min, dd); d.max = Math.max(d.max, dd);
    } else if (task.kind !== 'distance' && cs.length === 1) {
      const p = cs[0];
      if (!d.start) d.start = p;
      if (!d.end || Math.hypot(p.x - d.start.x, p.y - d.start.y) > Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y)) d.end = p;
      if (d.pts.length < 5000) d.pts.push(p);
    }
    force((n) => (n + 1) % 1000000);
  }, [rec, task.kind, contacts]);
  const stop = () => { setRec(false); setSnap({ ...data.current, pts: [...data.current.pts] }); };
  const rect = (pts: NPoint[]) => { const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; };
  const valid = snap && (task.kind === 'distance' ? snap.max - snap.min > 0.03 : task.kind === 'segment' ? !!snap.start && !!snap.end && Math.hypot(snap.end.x - snap.start.x, snap.end.y - snap.start.y) > 0.05 : snap.pts.length > 10 && rect(snap.pts).w > 0.05 && rect(snap.pts).h > 0.05);
  const approve = () => {
    const now = new Date().toISOString();
    onApprove(task.exerciseIds.map((exerciseId) => {
      if (task.kind === 'distance') return { exerciseId, kind: 'distance', fingers: ['T', partner], minDist: snap!.min, maxDist: snap!.max, approvedAt: now };
      if (task.kind === 'segment') return { exerciseId, kind: 'segment', fingers: [mover], start: snap!.start!, end: snap!.end!, approvedAt: now };
      return { exerciseId, kind: 'region', fingers: [mover], rect: rect(snap!.pts), approvedAt: now };
    }));
  };
  const msg = task.kind === 'distance' ? `Pollice e ${fingerLabel(partner).toLowerCase()}: avvicina e allontana entro il range confortevole` : task.kind === 'segment' ? `${fingerLabel(mover)}: parti dalla posizione comoda e scorri fino al punto più lontano confortevole` : `${fingerLabel(mover)}: muovi il dito in tutta l'area confortevole`;
  return (
    <div className="exercise-screen">
      <Bar title="5. Area confortevole" msg={snap ? 'Verifica e approva' : rec ? 'Registrazione in corso…' : msg}>
        {!rec && !snap && <button className="btn-primary" onClick={() => { data.current = { min: Infinity, max: 0, start: null, end: null, pts: [] }; setRec(true); }} data-testid="comfort-start">Registra</button>}
        {rec && <button className="btn-warn" onClick={stop} data-testid="comfort-stop">Fine</button>}
        {snap && <><button onClick={() => setSnap(null)}>Ripeti</button><button className="btn-primary" disabled={!valid} onClick={approve} data-testid="comfort-approve">Approva</button></>}
        <button onClick={onSkip}>Salta</button>
      </Bar>
      {snap && !valid && <div className="notice warn small area-notice">Movimento registrato troppo piccolo o incompleto: ripeti.</div>}
      {snap && valid && task.kind === 'distance' && <div className="notice info small area-notice">Distanza minima {snap.min.toFixed(3)} u · massima {snap.max.toFixed(3)} u (u = lato corto dell'area)</div>}
      <TouchSurface handlers={{ ...handlers, onFrame, onResize: (w, h) => { size.current = { w, h }; onArea({ w, h }); },
        draw: (ctx, w, h) => {
          const s = Math.min(w, h);
          const shapes: any[] = [];
          for (const [ff, p] of Object.entries(anchors) as [FingerId, NPoint][]) shapes.push({ kind: 'circle', x: p.x * s, y: p.y * s, r: 0.05 * s, stroke: 'ghost', width: 3, label: shortFinger(ff) });
          const d = snap ?? data.current;
          if (task.kind === 'segment' && d.start && d.end) shapes.push({ kind: 'line', pts: [{ x: d.start.x * s, y: d.start.y * s }, { x: d.end.x * s, y: d.end.y * s }], width: 10, tone: 'ok', alpha: .6 });
          if (task.kind === 'region' && d.pts.length > 2) {
            const r = rect(d.pts);
            shapes.push({ kind: 'line', pts: [{ x: r.x * s, y: r.y * s }, { x: (r.x + r.w) * s, y: r.y * s }, { x: (r.x + r.w) * s, y: (r.y + r.h) * s }, { x: r.x * s, y: (r.y + r.h) * s }, { x: r.x * s, y: r.y * s }], width: 3, tone: 'ok' });
            shapes.push({ kind: 'line', pts: d.pts.slice(-400).map((p) => ({ x: p.x * s, y: p.y * s })), width: 2, tone: 'track', alpha: .5 });
          }
          for (const c of contacts.current.values()) shapes.push({ kind: 'circle', x: c.x, y: c.y, r: 0.045 * s, fill: 'finger', alpha: .8 });
          drawScene(ctx, shapes);
        } }} />
    </div>
  );
}

function TrialStep({ fingers, anchors, onDone, onArea }: { fingers: FingerId[]; anchors: Partial<Record<FingerId, NPoint>>; onDone: (t: { done: boolean; ok: boolean; note?: string }) => void; onArea: (a: { w: number; h: number }) => void }) {
  const size = useRef({ w: 1, h: 1 });
  const [idx, setIdx] = useState(0);
  const [errors, setErrors] = useState<FingerId[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const done = idx >= fingers.length;
  return (
    <div className="exercise-screen">
      <Bar title="6. Prova" msg={done ? (errors.length ? `Prova completata con ${errors.length} errori` : 'Prova superata') : `Tocca il cerchio del ${fingerLabel(fingers[idx]).toUpperCase()} con quel dito`}>
        {flash && <span className="badge warn">{flash}</span>}
        <button onClick={() => onDone({ done: false, ok: false })}>Salta la prova</button>
        {done && <button className="btn-primary" onClick={() => onDone({ done: true, ok: errors.length === 0, note: errors.length ? `Tocchi lontani dalla posizione di: ${errors.map(fingerLabel).join(', ')}` : undefined })} data-testid="calib-next">Avanti</button>}
      </Bar>
      <TouchSurface handlers={{
        onResize: (w, h) => { size.current = { w, h }; onArea({ w, h }); },
        onDown: (_id, x, y) => {
          if (done) return;
          const s = Math.min(size.current.w, size.current.h);
          let best: FingerId | null = null, bd = Infinity;
          for (const f of fingers) { const a = anchors[f]; if (!a) continue; const d = Math.hypot(a.x * s - x, a.y * s - y); if (d < bd) { bd = d; best = f; } }
          const ok = best === fingers[idx] && bd < 0.1 * s;
          if (!ok) { setErrors((e) => [...e, fingers[idx]]); setFlash('Tocco lontano dalla posizione attesa'); setTimeout(() => setFlash(null), 1200); }
          setIdx(idx + 1);
        },
        draw: (ctx, w, h) => {
          const s = Math.min(w, h);
          drawScene(ctx, fingers.map((f, i) => { const a = anchors[f]!; return { kind: 'circle', x: a.x * s, y: a.y * s, r: 0.06 * s, fill: i === idx ? 'cue' : 'muted', alpha: i === idx ? .8 : .3, label: shortFinger(f) } as any; }));
        },
      }} />
    </div>
  );
}
