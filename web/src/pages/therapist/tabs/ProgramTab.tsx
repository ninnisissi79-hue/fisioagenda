import { useMemo, useState } from 'react';
import {
  availableExercises, CATALOG, defaultParams, diffVersions, effectiveVersionAt, fingerLabel, formatParam, getExercise, localDay, paramLabel, validateFingers, validateProgramItems, WEEKDAYS, ALL_FINGERS,
  type ExerciseDef, type FingerId, type Hand, type ProgramItem, type ProgramVersion,
} from '@handlab/shared';
import { GET, POST, errMsg } from '../../../api';
import { useAsync, ErrorBox, Loading, Field, ExperimentalBadge } from '../../../components/ui';
import { fmtDateTime, fmtDay } from '../../../format';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function ProgramTab({ patient, canEdit }: { patient: any; canEdit: boolean }) {
  const { data, error, loading, reload } = useAsync(() => GET<(ProgramVersion & { changes: any[] })[]>(`/api/patients/${patient.id}/programs`), [patient.id]);
  const [editing, setEditing] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const versions = data!;
  const today = localDay();
  const current = effectiveVersionAt(versions, today);
  const latest = versions[versions.length - 1] ?? null;
  if (editing) return <ProgramEditor patient={patient} base={latest} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); void reload(); }} />;
  return (
    <div>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Programma {current ? `attuale (versione ${current.version}, dal ${fmtDay(current.effectiveFrom)})` : ''}</h2>
        {canEdit && <button className="btn-primary" onClick={() => setEditing(true)} data-testid="edit-program">{versions.length ? 'Modifica programma' : 'Crea programma'}</button>}
      </div>
      {!current && <div className="notice info">Nessun programma in vigore oggi.</div>}
      {latest && current && latest.version !== current.version && <div className="notice info">La versione {latest.version} entrerà in vigore il {fmtDay(latest.effectiveFrom)}. Le sedute già iniziate restano legate alla versione con cui sono partite.</div>}
      {current && <ProgramView v={current} />}
      <h2 style={{ marginTop: 24 }}>Storico delle versioni</h2>
      <p className="small muted">Le versioni precedenti non vengono modificate né cancellate: ogni esecuzione registra la versione eseguita.</p>
      {[...versions].reverse().map((v) => (
        <details className="card" key={v.id}>
          <summary style={{ cursor: 'pointer' }}>
            <b>Versione {v.version}</b> · in vigore dal {fmtDay(v.effectiveFrom)} · creata il {fmtDateTime(v.createdAt)} da {v.createdByName ?? '—'}
            {v.changeNote && <div className="small muted">{v.changeNote}</div>}
            <ul className="diff-list">{v.changes.map((c: any, i: number) => <li key={i}>{getExercise(c.exerciseId)?.name}: {{ added: 'aggiunto', removed: 'eliminato', suspended: 'sospeso', reactivated: 'riattivato', modified: `modificato (${c.fields.map((f: string) => paramLabel(getExercise(c.exerciseId)!, f)).join(', ')})` }[c.kind as string]}</li>)}</ul>
          </summary>
          <ProgramView v={v} />
        </details>
      ))}
    </div>
  );
}

export function ProgramView({ v }: { v: ProgramVersion }) {
  return (
    <div className="table-wrap card" style={{ padding: 0 }}>
      <table className="table">
        <thead><tr><th>#</th><th>Esercizio</th><th>Mano e dita</th><th>Frequenza</th><th>Parametri</th><th>Progressione</th></tr></thead>
        <tbody>
          {v.items.map((it, i) => {
            const def = getExercise(it.exerciseId)!;
            return (
              <tr key={it.itemId} style={it.status === 'suspended' ? { opacity: .55 } : undefined}>
                <td>{i + 1}</td>
                <td><b>{def?.name}</b> {it.status === 'suspended' && <span className="badge warn">sospeso</span>} {it.mode === 'assessment' && <span className="badge info">condizioni fisse</span>}<div className="small muted">v{it.exerciseVersion}</div>{it.notes && <div className="small">{it.notes}</div>}</td>
                <td>{it.hand === 'left' ? 'Sinistra' : 'Destra'}<div className="small">{it.fingers.map(fingerLabel).join(' + ')}</div></td>
                <td>{it.frequency.timesPerDay}× al giorno<div className="small muted">{DAY_ORDER.filter((d) => it.frequency.days.includes(d)).map((d) => WEEKDAYS[d]).join(' ')}</div></td>
                <td className="small">{def?.params.map((p) => <div key={p.key}>{p.label}: <b>{formatParam(def, p.key, it.params[p.key])}</b></div>)}</td>
                <td className="small">{it.progression?.enabled ? <>{paramLabel(def, it.progression.param)}: {it.progression.step > 0 ? '+' : ''}{it.progression.step} per livello fino a {it.progression.limit}; sale con media ≥ {Math.round(it.progression.upThreshold * 100)}% su {it.progression.windowRuns} esecuzioni{it.progression.downThreshold !== null ? `; scende sotto ${Math.round(it.progression.downThreshold * 100)}%` : ''}</> : 'Nessuna'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function newItem(def: ExerciseDef, hand: Hand): ProgramItem {
  return {
    itemId: crypto.randomUUID(), exerciseId: def.id, exerciseVersion: def.version, mode: 'training', status: 'active', hand,
    fingers: [...def.defaultFingers], params: defaultParams(def), frequency: { timesPerDay: 1, days: [1, 2, 3, 4, 5] }, progression: null, notes: '',
  };
}

function ProgramEditor({ patient, base, onCancel, onSaved }: { patient: any; base: ProgramVersion | null; onCancel: () => void; onSaved: () => void }) {
  const defHand: Hand = patient.affectedHand === 'left' ? 'left' : 'right';
  const [items, setItems] = useState<ProgramItem[]>(() => (base ? JSON.parse(JSON.stringify(base.items)) : []));
  const [effectiveFrom, setEffectiveFrom] = useState(localDay());
  const [note, setNote] = useState('');
  const [rest, setRest] = useState(base?.restBetweenExercisesSec ?? 30);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errors = useMemo(() => validateProgramItems(items), [items]);
  const changes = useMemo(() => diffVersions(base, { ...(base ?? ({} as any)), items } as ProgramVersion), [base, items]);
  const upd = (i: number, it: ProgramItem) => setItems(items.map((x, j) => (j === i ? it : x)));
  const move = (i: number, d: number) => { const n = [...items]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); setItems(n); };
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await POST(`/api/patients/${patient.id}/programs`, { effectiveFrom, changeNote: note, restBetweenExercisesSec: rest, items, basedOnVersion: base?.version ?? null });
      onSaved();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div>
      <h2>{base ? `Nuova versione del programma (da versione ${base.version})` : 'Nuovo programma'}</h2>
      <div className="notice info small">Il salvataggio crea una nuova versione con la data di decorrenza indicata: la versione precedente e i risultati già acquisiti restano invariati. Il paziente riceve la nuova versione alla sincronizzazione e la usa dalla seduta successiva.</div>
      {items.map((it, i) => (
        <ItemEditor key={it.itemId} item={it} index={i} count={items.length} onChange={(x) => upd(i, x)} onMove={(d) => move(i, d)}
          onRemove={() => setItems(items.filter((_, j) => j !== i))}
          onReplace={(exId) => { const def = getExercise(exId)!; const n = newItem(def, it.hand); n.replacesItemId = it.itemId; n.frequency = it.frequency; upd(i, n); }} />
      ))}
      <div className="row" style={{ marginBottom: 16 }}>
        <select defaultValue="" onChange={(e) => { if (e.target.value) { setItems([...items, newItem(getExercise(e.target.value)!, defHand)]); e.target.value = ''; } }} style={{ maxWidth: 360 }} data-testid="add-exercise">
          <option value="">+ Aggiungi esercizio…</option>
          {availableExercises().map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <div className="card">
        <div className="grid-3">
          <Field label="Data di decorrenza"><input type="date" value={effectiveFrom} min={localDay()} onChange={(e) => setEffectiveFrom(e.target.value)} data-testid="effective-from" /></Field>
          <Field label="Pausa tra un esercizio e l'altro (s)"><input type="number" min={0} max={600} value={rest} onChange={(e) => setRest(Number(e.target.value))} /></Field>
        </div>
        <Field label="Nota sulla modifica (visibile nello storico)"><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="es. aumentata l'ampiezza della pinza" /></Field>
        {base && changes.length > 0 && <div className="small"><b>Modifiche rispetto alla versione {base.version}:</b><ul className="diff-list">{changes.map((c, i) => <li key={i}>{getExercise(c.exerciseId)?.name}: {{ added: 'aggiunto', removed: 'eliminato', suspended: 'sospeso', reactivated: 'riattivato', modified: `modificato (${c.fields.join(', ')})` }[c.kind]}</li>)}</ul></div>}
        {errors.length > 0 && <div className="notice danger small"><ul style={{ margin: 0 }}>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
        {err && <div className="notice danger">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onCancel}>Annulla</button>
          <button className="btn-primary" disabled={busy || errors.length > 0 || (base !== null && changes.length === 0 && rest === base.restBetweenExercisesSec)} onClick={save} data-testid="save-program">Salva nuova versione</button>
        </div>
      </div>
    </div>
  );
}

function ItemEditor({ item, index, count, onChange, onMove, onRemove, onReplace }: { item: ProgramItem; index: number; count: number; onChange: (i: ProgramItem) => void; onMove: (d: number) => void; onRemove: () => void; onReplace: (exerciseId: string) => void }) {
  const def = getExercise(item.exerciseId)!;
  const set = (patch: Partial<ProgramItem>) => onChange({ ...item, ...patch });
  const setParam = (k: string, v: any) => set({ params: { ...item.params, [k]: v } });
  const fingerErr = validateFingers(def, item.fingers);
  const toggleFinger = (f: FingerId) => set({ fingers: item.fingers.includes(f) ? item.fingers.filter((x) => x !== f) : [...item.fingers, f] });
  const prog = item.progression;
  const progressable = def.params.filter((p) => p.progressable);
  return (
    <div className={`item-editor ${item.status === 'suspended' ? 'suspended' : ''}`} data-testid="item-editor">
      <div className="row between">
        <div><b>{index + 1}. {def.name}</b> <span className="small muted">v{def.version}</span> <ExperimentalBadge /> {item.status === 'suspended' && <span className="badge warn">sospeso</span>}</div>
        <div className="row">
          <button className="btn-small" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Sposta su">↑</button>
          <button className="btn-small" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Sposta giù">↓</button>
          <button className="btn-small" onClick={() => set({ status: item.status === 'active' ? 'suspended' : 'active' })}>{item.status === 'active' ? 'Sospendi' : 'Riattiva'}</button>
          <select className="btn-small" style={{ width: 'auto', minHeight: 36 }} value="" onChange={(e) => e.target.value && onReplace(e.target.value)} aria-label="Sostituisci con">
            <option value="">Sostituisci con…</option>
            {CATALOG.filter((d) => d.status === 'available' && d.id !== def.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button className="btn-small btn-danger" onClick={onRemove}>Elimina</button>
        </div>
      </div>
      <div className="grid-3" style={{ marginTop: 10 }}>
        <Field label="Mano">
          <select value={item.hand} onChange={(e) => set({ hand: e.target.value as Hand })}><option value="right">Destra</option><option value="left">Sinistra</option></select>
        </Field>
        <Field label="Modalità" hint={item.mode === 'assessment' ? 'Parametri fissi, nessuna progressione: risultati confrontabili nel tempo.' : 'Allenamento: può usare la progressione automatica.'}>
          <select value={item.mode} onChange={(e) => set({ mode: e.target.value as any, progression: e.target.value === 'assessment' ? null : item.progression })}><option value="training">Allenamento</option><option value="assessment">Prova a condizioni fisse</option></select>
        </Field>
        <Field label="Volte al giorno"><input type="number" min={1} max={6} value={item.frequency.timesPerDay} onChange={(e) => set({ frequency: { ...item.frequency, timesPerDay: Number(e.target.value) } })} /></Field>
      </div>
      <Field label={`Dita (${def.fingerRule.roles.join(' → ')}) – nell'ordine di selezione`}>
        <div className="finger-pick">{ALL_FINGERS.map((f) => <button type="button" key={f} className={item.fingers.includes(f) ? 'sel' : ''} onClick={() => toggleFinger(f)}>{item.fingers.includes(f) ? `${item.fingers.indexOf(f) + 1}. ` : ''}{fingerLabel(f)}</button>)}</div>
        {fingerErr && <div className="hint" style={{ color: 'var(--danger)' }}>{fingerErr}</div>}
      </Field>
      <Field label="Giorni">
        <div className="days">{DAY_ORDER.map((d) => <button type="button" key={d} className={item.frequency.days.includes(d) ? 'sel' : ''} onClick={() => set({ frequency: { ...item.frequency, days: item.frequency.days.includes(d) ? item.frequency.days.filter((x) => x !== d) : [...item.frequency.days, d] } })}>{WEEKDAYS[d]}</button>)}</div>
      </Field>
      <div className="grid-3">
        {def.params.map((p) => (
          <Field key={p.key} label={`${p.label}${p.unit ? ` (${p.unit})` : ''}`} hint={p.help ?? (p.type === 'number' ? `${p.min}–${p.max}` : undefined)}>
            {p.type === 'number' && <input type="number" min={p.min} max={p.max} step={p.step} value={String(item.params[p.key] ?? p.default)} onChange={(e) => setParam(p.key, e.target.value === '' ? '' : Number(e.target.value))} />}
            {p.type === 'boolean' && <label className="check"><input type="checkbox" checked={!!item.params[p.key]} onChange={(e) => setParam(p.key, e.target.checked)} /> Sì</label>}
            {p.type === 'select' && <select value={String(item.params[p.key] ?? p.default)} onChange={(e) => setParam(p.key, e.target.value)}>{p.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
          </Field>
        ))}
      </div>
      {item.mode === 'training' && progressable.length > 0 && (
        <div className="card" style={{ background: 'var(--surface-2)', marginBottom: 8 }}>
          <label className="check"><input type="checkbox" checked={!!prog?.enabled} onChange={(e) => set({ progression: e.target.checked ? { enabled: true, param: progressable[0].key, step: progressable[0].step ?? 0.05, limit: Number(item.params[progressable[0].key] ?? progressable[0].default), windowRuns: 3, upThreshold: 0.85, downThreshold: null } : null })} /> Progressione automatica (facoltativa)</label>
          {prog?.enabled && (() => {
            const pd = def.params.find((p) => p.key === prog.param)!;
            return (
              <>
                <div className="grid-3">
                  <Field label="Parametro autorizzato"><select value={prog.param} onChange={(e) => { const np = def.params.find((p) => p.key === e.target.value)!; set({ progression: { ...prog, param: np.key, step: np.step ?? 0.05, limit: Number(item.params[np.key] ?? np.default) } }); }}>{progressable.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></Field>
                  <Field label="Variazione per livello" hint="Negativa per ridurre (es. tolleranza o tempo)"><input type="number" step={pd.step} value={prog.step} onChange={(e) => set({ progression: { ...prog, step: Number(e.target.value) } })} /></Field>
                  <Field label={`Limite autorizzato${pd.unit ? ` (${pd.unit})` : ''}`} hint={pd.key === 'amplitude' ? 'Mai oltre 1 = area confortevole approvata' : `${pd.min}–${pd.max}`}><input type="number" step={pd.step} min={pd.min} max={pd.max} value={prog.limit} onChange={(e) => set({ progression: { ...prog, limit: Number(e.target.value) } })} /></Field>
                  <Field label="Esecuzioni valutate"><input type="number" min={1} max={20} value={prog.windowRuns} onChange={(e) => set({ progression: { ...prog, windowRuns: Number(e.target.value) } })} /></Field>
                  <Field label="Soglia per salire (% ripetizioni valide)"><input type="number" min={1} max={100} value={Math.round(prog.upThreshold * 100)} onChange={(e) => set({ progression: { ...prog, upThreshold: Number(e.target.value) / 100 } })} /></Field>
                  <Field label="Soglia per scendere (%, vuoto = mai)"><input type="number" min={0} max={100} value={prog.downThreshold === null ? '' : Math.round(prog.downThreshold * 100)} onChange={(e) => set({ progression: { ...prog, downThreshold: e.target.value === '' ? null : Number(e.target.value) / 100 } })} /></Field>
                </div>
                <p className="hint">Le soglie sono scelte da te: l'app non propone valori clinici. Il paziente vede il livello applicato e il motivo; la storia riparte da zero con ogni nuova versione del programma.</p>
              </>
            );
          })()}
        </div>
      )}
      <Field label="Indicazioni per questo esercizio (facoltative)"><input value={item.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
    </div>
  );
}
