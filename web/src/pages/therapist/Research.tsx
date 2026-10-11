import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { localDay } from '@handlab/shared';
import { GET, POST, PUT, download, errMsg } from '../../api';
import { useAsync, ErrorBox, Loading, Field, Modal, Tabs, DemoBadge, ExperimentalBadge } from '../../components/ui';
import { fmtDay } from '../../format';

const EMPTY_STUDY = {
  title: '', code: '', protocolVersion: '1.0', objective: '', hypothesis: '', inclusion: '', exclusion: '', groups: [] as string[], intervention: '',
  primaryOutcome: '', secondaryOutcomes: [] as string[], timepoints: [{ code: 'T0', label: 'Basale', offsetDays: 0, windowBefore: 0, windowAfter: 3 }], ethicsReference: '', status: 'draft',
};

export function ResearchList() {
  const q = useAsync(() => GET<any[]>('/api/studies'), []);
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <div className="page-head"><div><h1>Ricerca</h1><p className="small muted" style={{ margin: 0 }}>Raccolte dati strutturate per studi pilota. Dati pseudonimizzati, non anonimi.</p></div><button className="btn-primary" onClick={() => setCreating(true)}>+ Nuovo studio</button></div>
      <div className="notice info small">Questi strumenti organizzano la raccolta dati: non sostituiscono il protocollo approvato, il processo di consenso informato né le autorizzazioni richieste. Le sintesi sono solo descrittive. Le prove touchscreen sono sperimentali e non validate.</div>
      <ErrorBox error={q.error} />
      {q.loading && !q.data && <Loading />}
      {(q.data ?? []).map((s) => (
        <Link key={s.id} to={`/ricerca/${s.id}`} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
          <div className="row between"><b>{s.title}</b><span>{{ draft: <span className="badge">Bozza</span>, active: <span className="badge ok">Attivo</span>, closed: <span className="badge">Chiuso</span> }[s.status as 'draft']} <DemoBadge show={s.isDemo} /></span></div>
          <div className="small muted">{s.code} · protocollo v{s.protocolVersion} · {s.participants} partecipanti · ruolo: {s.memberRole === 'owner' ? 'responsabile' : 'membro'}</div>
        </Link>
      ))}
      {q.data?.length === 0 && <p className="muted">Nessuno studio.</p>}
      {creating && <StudyForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void q.reload(); }} />}
    </div>
  );
}

function StudyForm({ initial, studyId, onClose, onSaved }: { initial?: any; studyId?: string; onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<any>(() => (initial ? strip(initial) : { ...EMPTY_STUDY }));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string[]>([]);
  const set = (k: string, v: any) => setS({ ...s, [k]: v });
  const tp = (i: number, k: string, v: any) => set('timepoints', s.timepoints.map((t: any, j: number) => (j === i ? { ...t, [k]: v } : t)));
  const save = async () => {
    setErr(null);
    try {
      if (studyId) { const r = await PUT<any>(`/api/studies/${studyId}`, { study: s, reason }); if (r.warnings?.length) { setWarn(r.warnings); return; } }
      else await POST('/api/studies', s);
      onSaved();
    } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal title={studyId ? 'Modifica protocollo' : 'Nuovo studio'} onClose={onClose} wide>
      <div className="grid-3">
        <Field label="Titolo"><input value={s.title} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="Codice studio"><input value={s.code} onChange={(e) => set('code', e.target.value)} /></Field>
        <Field label="Versione del protocollo"><input value={s.protocolVersion} onChange={(e) => set('protocolVersion', e.target.value)} /></Field>
        <Field label="Stato"><select value={s.status} onChange={(e) => set('status', e.target.value)}><option value="draft">Bozza</option><option value="active">Attivo</option><option value="closed">Chiuso</option></select></Field>
        <Field label="Riferimenti di approvazione (es. comitato etico)"><input value={s.ethicsReference} onChange={(e) => set('ethicsReference', e.target.value)} /></Field>
        <Field label="Gruppi (separati da virgola, nessuna assegnazione automatica)"><input value={s.groups.join(', ')} onChange={(e) => set('groups', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} /></Field>
      </div>
      <div className="grid-2">
        <Field label="Obiettivo"><textarea value={s.objective} onChange={(e) => set('objective', e.target.value)} /></Field>
        <Field label="Ipotesi"><textarea value={s.hypothesis} onChange={(e) => set('hypothesis', e.target.value)} /></Field>
        <Field label="Criteri di inclusione"><textarea value={s.inclusion} onChange={(e) => set('inclusion', e.target.value)} /></Field>
        <Field label="Criteri di esclusione"><textarea value={s.exclusion} onChange={(e) => set('exclusion', e.target.value)} /></Field>
        <Field label="Intervento previsto"><textarea value={s.intervention} onChange={(e) => set('intervention', e.target.value)} /></Field>
        <div>
          <Field label="Outcome primario (scelto dal ricercatore)"><input value={s.primaryOutcome} onChange={(e) => set('primaryOutcome', e.target.value)} /></Field>
          <Field label="Outcome secondari (uno per riga)"><textarea value={s.secondaryOutcomes.join('\n')} onChange={(e) => set('secondaryOutcomes', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} /></Field>
        </div>
      </div>
      <h3>Valutazioni programmate e finestre temporali</h3>
      <table className="table small"><thead><tr><th>Codice</th><th>Descrizione</th><th>Giorni dalla data di riferimento</th><th>Finestra prima (gg)</th><th>Finestra dopo (gg)</th><th></th></tr></thead>
        <tbody>{s.timepoints.map((t: any, i: number) => <tr key={i}>
          <td><input value={t.code} onChange={(e) => tp(i, 'code', e.target.value)} /></td><td><input value={t.label} onChange={(e) => tp(i, 'label', e.target.value)} /></td>
          <td><input type="number" value={t.offsetDays} onChange={(e) => tp(i, 'offsetDays', Number(e.target.value))} /></td><td><input type="number" value={t.windowBefore} onChange={(e) => tp(i, 'windowBefore', Number(e.target.value))} /></td><td><input type="number" value={t.windowAfter} onChange={(e) => tp(i, 'windowAfter', Number(e.target.value))} /></td>
          <td><button className="btn-small" onClick={() => set('timepoints', s.timepoints.filter((_: any, j: number) => j !== i))}>×</button></td></tr>)}</tbody></table>
      <button className="btn-small" onClick={() => set('timepoints', [...s.timepoints, { code: `T${s.timepoints.length}`, label: '', offsetDays: 28 * s.timepoints.length, windowBefore: 3, windowAfter: 3 }])}>+ Valutazione</button>
      {studyId && <Field label="Motivo della modifica (obbligatorio, resta nella cronologia)"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      {warn.length > 0 && <div className="notice warn">{warn.map((w, i) => <div key={i}>{w}</div>)}<button className="btn-small" onClick={onSaved}>Ho capito</button></div>}
      <ErrorBox error={err} />
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button onClick={onClose}>Annulla</button><button className="btn-primary" disabled={!s.title || !s.code || (!!studyId && reason.length < 3)} onClick={save}>Salva</button></div>
    </Modal>
  );
}

function strip(s: any) { const { id, createdAt, updatedAt, isDemo, ...rest } = s; return rest; }

type StudyTab = 'protocol' | 'participants' | 'events' | 'summary' | 'export';

export function StudyDetail() {
  const { id } = useParams();
  const q = useAsync(() => GET<any>(`/api/studies/${id}`), [id]);
  const [tab, setTab] = useState<StudyTab>('participants');
  const [edit, setEdit] = useState(false);
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { study, participants, hiddenParticipants, members, patientCodes } = q.data;
  return (
    <div>
      <div className="small"><Link to="/ricerca">← Ricerca</Link></div>
      <div className="page-head"><div><h1>{study.title} <DemoBadge show={study.isDemo} /></h1><div className="small muted">{study.code} · protocollo v{study.protocolVersion}</div></div></div>
      <Tabs tabs={[{ id: 'participants', label: 'Partecipanti e valutazioni' }, { id: 'protocol', label: 'Protocollo' }, { id: 'events', label: 'Eventi e deviazioni' }, { id: 'summary', label: 'Sintesi descrittiva' }, { id: 'export', label: 'Esportazioni' }]} value={tab} onChange={setTab} />
      {tab === 'protocol' && (
        <div className="card">
          <div className="row between"><h2 style={{ margin: 0 }}>Protocollo</h2><button onClick={() => setEdit(true)}>Modifica</button></div>
          <dl className="dl" style={{ marginTop: 10 }}>
            <dt>Obiettivo</dt><dd>{study.objective || '—'}</dd><dt>Ipotesi</dt><dd>{study.hypothesis || '—'}</dd>
            <dt>Inclusione</dt><dd>{study.inclusion || '—'}</dd><dt>Esclusione</dt><dd>{study.exclusion || '—'}</dd>
            <dt>Gruppi</dt><dd>{study.groups.join(', ') || '—'} (assegnazione manuale)</dd><dt>Intervento</dt><dd>{study.intervention || '—'}</dd>
            <dt>Outcome primario</dt><dd>{study.primaryOutcome || '—'}</dd><dt>Outcome secondari</dt><dd>{study.secondaryOutcomes.join('; ') || '—'}</dd>
            <dt>Valutazioni</dt><dd>{study.timepoints.map((t: any) => `${t.code} (${t.label}): giorno ${t.offsetDays}, finestra −${t.windowBefore}/+${t.windowAfter}`).join(' · ')}</dd>
            <dt>Approvazioni</dt><dd>{study.ethicsReference || '—'}</dd>
            <dt>Membri</dt><dd>{members.map((m: any) => `${m.displayName} (${m.role === 'owner' ? 'responsabile' : 'membro'})`).join(', ')}</dd>
          </dl>
          <p className="small muted">I campi su consenso e approvazioni servono a documentare: non sostituiscono il processo di consenso né le autorizzazioni richieste.</p>
        </div>
      )}
      {tab === 'participants' && <Participants study={study} participants={participants} hidden={hiddenParticipants} patientCodes={patientCodes} reload={q.reload} />}
      {tab === 'events' && <Events studyId={study.id} participants={participants} />}
      {tab === 'summary' && <Summary studyId={study.id} />}
      {tab === 'export' && <Exports study={study} />}
      {edit && <StudyForm initial={study} studyId={study.id} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); void q.reload(); }} />}
    </div>
  );
}

function Participants({ study, participants, hidden, patientCodes, reload }: { study: any; participants: any[]; hidden: number; patientCodes: Record<string, string>; reload: () => void }) {
  const pts = useAsync(() => GET<any[]>('/api/patients'), []);
  const [enroll, setEnroll] = useState<any | null>(null);
  const [tpEdit, setTpEdit] = useState<any | null>(null);
  const [pEdit, setPEdit] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const enrolled = new Set(participants.map((p) => p.patientId));
  const ST: Record<string, [string, string]> = { planned: ['Prevista', ''], completed: ['Completata', 'ok'], missed: ['Mancata', 'danger'] };
  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}><button className="btn-primary" onClick={() => setEnroll({ patientId: '', participantCode: '', groupName: null, baselineDate: localDay(), consentObtained: false, consentDate: null, consentVersion: '', consentNotes: '' })}>+ Includi paziente</button></div>
      {hidden > 0 && <p className="small muted">{hidden} partecipanti non visibili perché i relativi pazienti non ti sono assegnati.</p>}
      {participants.map((p) => (
        <div className="card" key={p.id}>
          <div className="row between">
            <div><b>{p.participantCode}</b> <span className="small muted">(paziente {patientCodes[p.patientId]})</span> {p.groupName && <span className="badge info">gruppo {p.groupName}</span>} {{ active: <span className="badge ok">attivo</span>, completed: <span className="badge">concluso</span>, withdrawn: <span className="badge danger">abbandono</span> }[p.status as 'active']}</div>
            <button className="btn-small" onClick={() => setPEdit({ ...p, reason: '' })}>Modifica</button>
          </div>
          <div className="small muted">Riferimento {fmtDay(p.baselineDate)} · consenso: {p.consentObtained ? `documentato${p.consentDate ? ` il ${fmtDay(p.consentDate)}` : ''}${p.consentVersion ? ` (versione ${p.consentVersion})` : ''}` : 'non documentato'}{p.statusReason ? ` · motivo: ${p.statusReason}` : ''}</div>
          <div className="table-wrap"><table className="table small" style={{ marginTop: 8 }}>
            <thead><tr><th>Valutazione</th><th>Data prevista</th><th>Finestra</th><th>Stato</th><th>Data</th><th>Note / motivo</th><th></th></tr></thead>
            <tbody>{p.timepoints.map((t: any) => (
              <tr key={t.code}>
                <td><b>{t.code}</b> {t.label}</td><td>{fmtDay(t.due)}</td><td>{fmtDay(t.windowStart)} – {fmtDay(t.windowEnd)} {t.inWindow && <span className="badge info">in corso</span>}</td>
                <td><span className={`badge ${ST[t.status][1]}`}>{ST[t.status][0]}</span> {t.windowPassed && <span className="badge warn">finestra scaduta: da confermare</span>}</td>
                <td>{fmtDay(t.date)}</td><td className="small">{t.missingReason ?? t.notes}</td>
                <td><button className="btn-small" onClick={() => setTpEdit({ participant: p, tp: t, status: t.status, date: t.date ?? localDay(), missingReason: t.missingReason ?? '', notes: t.notes ?? '', reason: '' })}>Aggiorna</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      ))}
      {participants.length === 0 && <p className="muted">Nessun partecipante.</p>}
      {enroll && (
        <Modal title="Includi un paziente nello studio" onClose={() => setEnroll(null)}>
          <div className="grid-2">
            <Field label="Paziente"><select value={enroll.patientId} onChange={(e) => setEnroll({ ...enroll, patientId: e.target.value })}><option value="">Scegli…</option>{(pts.data ?? []).filter((p) => !enrolled.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
            <Field label="Codice partecipante (specifico per lo studio)"><input value={enroll.participantCode} onChange={(e) => setEnroll({ ...enroll, participantCode: e.target.value })} placeholder="es. P07" /></Field>
            <Field label="Gruppo (assegnazione manuale)"><select value={enroll.groupName ?? ''} onChange={(e) => setEnroll({ ...enroll, groupName: e.target.value || null })}><option value="">Nessuno</option>{study.groups.map((g: string) => <option key={g}>{g}</option>)}</select></Field>
            <Field label="Data di riferimento (T0)"><input type="date" value={enroll.baselineDate} onChange={(e) => setEnroll({ ...enroll, baselineDate: e.target.value })} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={enroll.consentObtained} onChange={(e) => setEnroll({ ...enroll, consentObtained: e.target.checked })} /> Consenso informato documentato secondo il protocollo</label>
          <div className="grid-2">
            <Field label="Data del consenso"><input type="date" value={enroll.consentDate ?? ''} onChange={(e) => setEnroll({ ...enroll, consentDate: e.target.value || null })} /></Field>
            <Field label="Versione del modulo di consenso"><input value={enroll.consentVersion} onChange={(e) => setEnroll({ ...enroll, consentVersion: e.target.value })} /></Field>
          </div>
          <Field label="Note sul consenso"><input value={enroll.consentNotes} onChange={(e) => setEnroll({ ...enroll, consentNotes: e.target.value })} /></Field>
          <p className="small muted">Il codice partecipante rende i dati pseudonimizzati: chi dispone della corrispondenza può ricollegarli alla persona.</p>
          <ErrorBox error={err} />
          <div className="row" style={{ justifyContent: 'flex-end' }}><button onClick={() => setEnroll(null)}>Annulla</button><button className="btn-primary" disabled={!enroll.patientId || !enroll.participantCode} onClick={async () => { setErr(null); try { await POST(`/api/studies/${study.id}/participants`, enroll); setEnroll(null); reload(); } catch (e) { setErr(errMsg(e)); } }}>Includi</button></div>
        </Modal>
      )}
      {tpEdit && (
        <Modal title={`Valutazione ${tpEdit.tp.code} – ${tpEdit.participant.participantCode}`} onClose={() => setTpEdit(null)}>
          <Field label="Stato"><select value={tpEdit.status} onChange={(e) => setTpEdit({ ...tpEdit, status: e.target.value })}><option value="planned">Prevista</option><option value="completed">Completata</option><option value="missed">Mancata</option></select></Field>
          {tpEdit.status === 'completed' && <Field label="Data di esecuzione"><input type="date" value={tpEdit.date} onChange={(e) => setTpEdit({ ...tpEdit, date: e.target.value })} /></Field>}
          {tpEdit.status === 'completed' && (tpEdit.date < tpEdit.tp.windowStart || tpEdit.date > tpEdit.tp.windowEnd) && <div className="notice warn small">Data fuori dalla finestra prevista: documenta la deviazione negli eventi.</div>}
          {tpEdit.status === 'missed' && <Field label="Motivo del dato mancante"><input value={tpEdit.missingReason} onChange={(e) => setTpEdit({ ...tpEdit, missingReason: e.target.value })} /></Field>}
          <Field label="Note"><input value={tpEdit.notes} onChange={(e) => setTpEdit({ ...tpEdit, notes: e.target.value })} /></Field>
          {tpEdit.tp.status !== 'planned' && <Field label="Motivo della correzione"><input value={tpEdit.reason} onChange={(e) => setTpEdit({ ...tpEdit, reason: e.target.value })} /></Field>}
          <ErrorBox error={err} />
          <div className="row" style={{ justifyContent: 'flex-end' }}><button onClick={() => setTpEdit(null)}>Annulla</button><button className="btn-primary" onClick={async () => { setErr(null); try { await PUT(`/api/studies/${study.id}/participants/${tpEdit.participant.id}/assessments/${tpEdit.tp.code}`, { status: tpEdit.status, date: tpEdit.status === 'completed' ? tpEdit.date : null, missingReason: tpEdit.status === 'missed' ? tpEdit.missingReason : null, notes: tpEdit.notes, reason: tpEdit.reason || undefined }); setTpEdit(null); reload(); } catch (e) { setErr(errMsg(e)); } }}>Salva</button></div>
        </Modal>
      )}
      {pEdit && (
        <Modal title={`Partecipante ${pEdit.participantCode}`} onClose={() => setPEdit(null)}>
          <div className="grid-2">
            <Field label="Stato"><select value={pEdit.status} onChange={(e) => setPEdit({ ...pEdit, status: e.target.value })}><option value="active">Attivo</option><option value="completed">Concluso</option><option value="withdrawn">Abbandono</option></select></Field>
            <Field label="Gruppo"><select value={pEdit.groupName ?? ''} onChange={(e) => setPEdit({ ...pEdit, groupName: e.target.value || null })}><option value="">Nessuno</option>{study.groups.map((g: string) => <option key={g}>{g}</option>)}</select></Field>
            <Field label="Data di riferimento"><input type="date" value={pEdit.baselineDate} onChange={(e) => setPEdit({ ...pEdit, baselineDate: e.target.value })} /></Field>
            <Field label="Motivo abbandono / deviazione"><input value={pEdit.statusReason ?? ''} onChange={(e) => setPEdit({ ...pEdit, statusReason: e.target.value || null })} /></Field>
            <Field label="Data consenso"><input type="date" value={pEdit.consentDate ?? ''} onChange={(e) => setPEdit({ ...pEdit, consentDate: e.target.value || null })} /></Field>
            <Field label="Versione modulo consenso"><input value={pEdit.consentVersion} onChange={(e) => setPEdit({ ...pEdit, consentVersion: e.target.value })} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={pEdit.consentObtained} onChange={(e) => setPEdit({ ...pEdit, consentObtained: e.target.checked })} /> Consenso documentato</label>
          <Field label="Note sul consenso"><input value={pEdit.consentNotes} onChange={(e) => setPEdit({ ...pEdit, consentNotes: e.target.value })} /></Field>
          <Field label="Motivo della modifica (obbligatorio)"><input value={pEdit.reason} onChange={(e) => setPEdit({ ...pEdit, reason: e.target.value })} /></Field>
          <ErrorBox error={err} />
          <div className="row" style={{ justifyContent: 'flex-end' }}><button onClick={() => setPEdit(null)}>Annulla</button><button className="btn-primary" disabled={pEdit.reason.length < 3} onClick={async () => { setErr(null); try { const { groupName, status, statusReason, consentObtained, consentDate, consentVersion, consentNotes, baselineDate, reason } = pEdit; await PUT(`/api/studies/${study.id}/participants/${pEdit.id}`, { groupName, status, statusReason, consentObtained, consentDate, consentVersion, consentNotes, baselineDate, reason }); setPEdit(null); reload(); } catch (e) { setErr(errMsg(e)); } }}>Salva</button></div>
        </Modal>
      )}
    </div>
  );
}

const KINDS: Record<string, string> = { adverse_event: 'Evento avverso riferito', problem: 'Problema', deviation: 'Deviazione dal protocollo', withdrawal: 'Abbandono', missing_data: 'Dato mancante', other: 'Altro', session_stopped: 'Seduta interrotta (paziente)', reported: 'Segnalazione del paziente' };

function Events({ studyId, participants }: { studyId: string; participants: any[] }) {
  const q = useAsync(() => GET<any[]>(`/api/studies/${studyId}/events`), [studyId]);
  const [f, setF] = useState({ participantId: '', date: localDay(), kind: 'problem', description: '', relatedSessionId: null });
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <div className="card">
        <h3>Registra un evento, problema o deviazione</h3>
        <div className="grid-3">
          <Field label="Partecipante"><select value={f.participantId} onChange={(e) => setF({ ...f, participantId: e.target.value })}><option value="">Scegli…</option>{participants.map((p) => <option key={p.id} value={p.id}>{p.participantCode}</option>)}</select></Field>
          <Field label="Data"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Tipo"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['adverse_event', 'problem', 'deviation', 'withdrawal', 'missing_data', 'other'].map((k) => <option key={k} value={k}>{KINDS[k]}</option>)}</select></Field>
        </div>
        <Field label="Descrizione"><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <button className="btn-primary" disabled={!f.participantId || !f.description} onClick={async () => { setErr(null); try { await POST(`/api/studies/${studyId}/events`, f); setF({ ...f, description: '' }); void q.reload(); } catch (e) { setErr(errMsg(e)); } }}>Registra</button>
        <ErrorBox error={err} />
      </div>
      <div className="card table-wrap">
        <h3>Eventi registrati e segnalazioni durante le sessioni</h3>
        <table className="table small"><thead><tr><th>Data</th><th>Partecipante</th><th>Tipo</th><th>Descrizione</th><th>Fonte</th></tr></thead>
          <tbody>{(q.data ?? []).map((e) => <tr key={e.id}><td>{fmtDay(e.date)}</td><td>{e.participantCode}</td><td>{KINDS[e.kind] ?? e.kind}</td><td>{e.description}</td><td>{e.source === 'manual' ? e.author : 'riferito dal paziente'}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}

function Summary({ studyId }: { studyId: string }) {
  const q = useAsync(() => GET<any>(`/api/studies/${studyId}/summary`), [studyId]);
  if (!q.data) return <Loading />;
  const s = q.data;
  return (
    <div>
      <div className="notice warn small">{s.notice}</div>
      <div className="kpis">
        <div className="kpi"><div className="v">{s.participants}</div><div className="l">Partecipanti visibili</div></div>
        {Object.entries(s.byStatus).map(([k, v]) => <div className="kpi" key={k}><div className="v">{v as number}</div><div className="l">{{ active: 'Attivi', completed: 'Conclusi', withdrawn: 'Abbandoni' }[k] ?? k}</div></div>)}
      </div>
      <div className="card"><h3>Per gruppo</h3>{Object.entries(s.byGroup).map(([g, n]) => <div key={g}>{g}: {n as number}</div>)}</div>
      <div className="card table-wrap"><h3>Valutazioni programmate</h3>
        <table className="table small"><thead><tr><th>Valutazione</th><th>Completate</th><th>Mancate</th><th>Previste</th><th>di cui finestra scaduta</th></tr></thead>
          <tbody>{s.timepoints.map((t: any) => <tr key={t.code}><td>{t.code}</td><td>{t.completed}</td><td>{t.missed}</td><td>{t.planned}</td><td>{t.windowPassed}</td></tr>)}</tbody></table></div>
      <div className="card table-wrap"><h3>Misure cliniche per valutazione (statistiche descrittive)</h3>
        {s.measureStats.length === 0 ? <p className="muted small">Nessuna misura nelle finestre delle valutazioni.</p> :
          <table className="table small"><thead><tr><th>Valutazione</th><th>Misura</th><th>n</th><th>Media</th><th>DS</th><th>Mediana</th><th>Min–max</th></tr></thead>
            <tbody>{s.measureStats.map((m: any, i: number) => <tr key={i}><td>{m.timepoint}</td><td>{m.name} ({m.unit})</td><td>{m.n}</td><td>{m.mean}</td><td>{m.sd ?? '—'}</td><td>{m.median}</td><td>{m.min}–{m.max}</td></tr>)}</tbody></table>}
      </div>
    </div>
  );
}

function Exports({ study }: { study: any }) {
  const [withCode, setWithCode] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const q = withCode ? '?includePatientCode=1' : '';
  const files = [
    { f: 'assessments.csv', l: 'CSV delle valutazioni (misure cliniche, questionari, prove a condizioni fisse)' },
    { f: 'sessions.csv', l: 'CSV delle sessioni ed esecuzioni (con parametri, dispositivo, taratura, validità)' },
    { f: 'schedule.csv', l: 'CSV del calendario delle valutazioni (previste, completate, mancate)' },
    { f: 'technical.json', l: 'JSON dei dettagli tecnici (eventi, ripetizioni, tarature)' },
    { f: 'dictionary.csv', l: 'Dizionario delle variabili, unità e codifiche' },
  ];
  return (
    <div className="card">
      <h2>Esportazioni <ExperimentalBadge /></h2>
      <p className="small">Per impostazione predefinita le esportazioni contengono solo il codice partecipante. Valore zero, dato mancante, errore tecnico e "non applicabile" sono distinti in colonne di stato separate. Ogni esportazione viene registrata.</p>
      <label className="check"><input type="checkbox" checked={withCode} onChange={(e) => setWithCode(e.target.checked)} /> Includi anche il codice paziente interno (sconsigliato; usare solo se previsto dal protocollo)</label>
      <div className="stack" style={{ marginTop: 10 }}>
        {files.map((x) => <div key={x.f}><button onClick={() => download(`/api/studies/${study.id}/export/${x.f}${q}`, `${study.code}_${x.f}`).catch((e) => setErr(errMsg(e)))}>Scarica {x.f}</button> <span className="small muted">{x.l}</span></div>)}
      </div>
      <ErrorBox error={err} />
      <p className="small muted" style={{ marginTop: 12 }}>I file sono pseudonimizzati, non anonimi. Conservali secondo il protocollo e non caricarli su servizi esterni non autorizzati.</p>
    </div>
  );
}
