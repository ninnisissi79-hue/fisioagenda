import { useState } from 'react';
import { POST, PUT, errMsg } from '../../api';
import { Field, Modal } from '../../components/ui';

const EMPTY = { code: '', ageBand: '', affectedHand: 'right', dominantHand: 'right', condition: '', surgery: '', surgeryDate: null as string | null, phase: '', limitations: '', goals: '', notes: '' };

export function PatientForm({ initial, patientId, onClose, onSaved }: { initial?: any; patientId?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const [p, setP] = useState({ ...EMPTY, ...(initial ? pick(initial) : {}) });
  const [acc, setAcc] = useState({ create: false, username: '', password: '' });
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setP({ ...p, [k]: v });
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      if (patientId) { await PUT(`/api/patients/${patientId}`, { patient: p, reason: reason || undefined }); onSaved(patientId); }
      else { const r = await POST<{ id: string }>('/api/patients', { patient: p, account: acc.create ? { username: acc.username, password: acc.password } : null }); onSaved(r.id); }
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={patientId ? 'Modifica scheda paziente' : 'Nuovo paziente'} onClose={onClose} wide>
      <div className="notice info small">Usa un codice identificativo, non nome e cognome. Inserisci solo i dati necessari al percorso.</div>
      <div className="grid-2">
        <Field label="Codice identificativo *"><input value={p.code} onChange={(e) => set('code', e.target.value)} placeholder="es. MANO-0012" /></Field>
        <Field label="Fascia d'età (se necessaria)">
          <select value={p.ageBand} onChange={(e) => set('ageBand', e.target.value)}>
            <option value="">Non indicata</option>
            {['<18', '18-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80+'].map((a) => <option key={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="Mano interessata">
          <select value={p.affectedHand} onChange={(e) => set('affectedHand', e.target.value)}><option value="right">Destra</option><option value="left">Sinistra</option><option value="both">Entrambe</option></select>
        </Field>
        <Field label="Mano dominante">
          <select value={p.dominantHand} onChange={(e) => set('dominantHand', e.target.value)}><option value="right">Destra</option><option value="left">Sinistra</option><option value="ambidextrous">Ambidestro</option><option value="unknown">Non indicata</option></select>
        </Field>
        <Field label="Problema trattato"><input value={p.condition} onChange={(e) => set('condition', e.target.value)} /></Field>
        <Field label="Fase del percorso"><input value={p.phase} onChange={(e) => set('phase', e.target.value)} /></Field>
        <Field label="Eventuale intervento"><input value={p.surgery} onChange={(e) => set('surgery', e.target.value)} /></Field>
        <Field label="Data dell'intervento"><input type="date" value={p.surgeryDate ?? ''} onChange={(e) => set('surgeryDate', e.target.value || null)} /></Field>
      </div>
      <Field label="Limitazioni indicate dal fisioterapista"><textarea value={p.limitations} onChange={(e) => set('limitations', e.target.value)} /></Field>
      <Field label="Obiettivi funzionali"><textarea value={p.goals} onChange={(e) => set('goals', e.target.value)} /></Field>
      <Field label="Note"><textarea value={p.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      {!patientId && (
        <div className="card" style={{ background: 'var(--surface-2)' }}>
          <label className="check"><input type="checkbox" checked={acc.create} onChange={(e) => setAcc({ ...acc, create: e.target.checked })} /> Crea subito l'accesso del paziente</label>
          {acc.create && <div className="grid-2">
            <Field label="Nome utente del paziente"><input value={acc.username} onChange={(e) => setAcc({ ...acc, username: e.target.value })} autoComplete="off" /></Field>
            <Field label="Password iniziale (min. 8 caratteri)"><input value={acc.password} onChange={(e) => setAcc({ ...acc, password: e.target.value })} autoComplete="new-password" /></Field>
          </div>}
        </div>
      )}
      {patientId && <Field label="Motivo della modifica (facoltativo, resta nella cronologia)"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      {err && <div className="notice danger">{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onClose}>Annulla</button>
        <button className="btn-primary" onClick={save} disabled={busy || p.code.length < 2}>Salva</button>
      </div>
    </Modal>
  );
}

function pick(x: any) {
  const o: any = {};
  for (const k of Object.keys(EMPTY)) o[k] = x[k] ?? (EMPTY as any)[k];
  return o;
}
