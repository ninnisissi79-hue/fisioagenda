import { useState } from 'react';
import { CATALOG, defaultParams, fingerLabel, formatParam, requiredContacts, getExercise, type ExerciseDef, type Hand } from '@handlab/shared';
import { Modal, ExperimentalBadge } from '../../components/ui';
import { DemoAnimation } from '../../components/DemoAnimation';
import { Player } from '../../exercise/Player';
import { measuredMaxContacts } from '../../local/device';
import { unitLabel } from '../../format';

export function Exercises() {
  const [open, setOpen] = useState<ExerciseDef | null>(null);
  const [practice, setPractice] = useState<{ def: ExerciseDef; hand: Hand } | null>(null);
  const maxC = measuredMaxContacts();
  if (practice) return <Player def={practice.def} cfg={{ hand: practice.hand, fingers: practice.def.defaultFingers, params: defaultParams(practice.def), mode: 'training', programItemId: null, programVersionId: null, programVersion: null, progression: null }} placement={{ calibration: null, offset: { x: 0, y: 0 } }} record={null} onDone={() => setPractice(null)} header={`Prova libera (non registrata): ${practice.def.name}`} />;
  return (
    <div>
      <div className="page-head"><div><h1>Esercizi</h1><p className="small muted" style={{ margin: 0 }}>Catalogo ampliabile. Tutte le prove touchscreen sono sperimentali e non validate.</p></div></div>
      {maxC !== null && <div className="notice info small">Su questo tablet la verifica ha rilevato al massimo {maxC} contatti simultanei.</div>}
      <div className="grid-3">
        {CATALOG.map((d) => {
          const need = requiredContacts(d, d.defaultFingers);
          return (
            <div className="card" key={d.id} style={d.status === 'planned' ? { opacity: .65 } : undefined}>
              <div className="row between"><h3 style={{ margin: 0 }}>{d.name}</h3>{d.status === 'available' ? <span className="badge ok">Disponibile</span> : <span className="badge">Non ancora disponibile</span>}</div>
              <p className="small" style={{ marginTop: 8 }}>{d.summary}</p>
              {d.status === 'available' && <p className="small muted">Dita predefinite: {d.defaultFingers.map(fingerLabel).join(' + ')} · contatti simultanei: {need}{maxC !== null && maxC < need ? ' ⚠ non supportato su questo tablet' : ''}</p>}
              {d.status === 'available' && <div className="row"><button className="btn-small" onClick={() => setOpen(d)}>Dettagli</button><button className="btn-small btn-primary" onClick={() => setPractice({ def: d, hand: 'right' })}>Prova (destra)</button><button className="btn-small" onClick={() => setPractice({ def: d, hand: 'left' })}>Prova (sinistra)</button></div>}
            </div>
          );
        })}
      </div>
      {open && (
        <Modal title={open.name} onClose={() => setOpen(null)} wide>
          <p className="row"><span className="small muted">Versione {open.version} · calcolo metriche {open.metricsVersion}</span> <ExperimentalBadge /></p>
          <div className="grid-2">
            <div>
              <h3>Posizionamento</h3><ul>{open.positioning.map((x, i) => <li key={i}>{x}</li>)}</ul>
              <h3>Gesto</h3><ul>{open.gesture.map((x, i) => <li key={i}>{x}</li>)}</ul>
              <h3>Dita</h3><p>{open.fingerRule.description} Ruoli: {open.fingerRule.roles.join(' → ')}.</p>
            </div>
            <div><DemoAnimation exerciseId={open.id} /><p className="notice warn small" style={{ marginTop: 10 }}>{open.limits}</p></div>
          </div>
          <h3>Criteri di completamento</h3><p>{open.completion}</p>
          <h3>Parametri configurabili</h3>
          <table className="table small"><tbody>{open.params.map((p) => <tr key={p.key}><td>{p.label}</td><td>predefinito {formatParam(open, p.key, p.default)}</td><td>{p.type === 'number' ? `${p.min}–${p.max}` : p.options?.map((o) => o.label).join(', ') ?? ''}</td><td>{p.progressable ? 'progressione possibile' : ''}</td></tr>)}</tbody></table>
          <h3>Risultati registrati</h3>
          <table className="table small"><tbody>{open.metrics.map((m) => <tr key={m.key}><td>{m.label}</td><td className="muted">{unitLabel(m.unit)}</td><td>{m.description}</td></tr>)}</tbody></table>
          {open.alternatives.length > 0 && <p className="small">Alternative se il dispositivo non supporta i contatti necessari: {open.alternatives.map((a) => getExercise(a)?.name).join(', ')}.</p>}
        </Modal>
      )}
    </div>
  );
}
