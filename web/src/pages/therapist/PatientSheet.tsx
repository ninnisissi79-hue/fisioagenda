import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { GET } from '../../api';
import { useAsync, ErrorBox, Loading, Tabs, DemoBadge } from '../../components/ui';
import { OverviewTab, NotesTab, CalibrationsTab, TeamTab, HistoryTab } from './tabs/OtherTabs';
import { ProgramTab } from './tabs/ProgramTab';
import { ExecutionTab } from './tabs/ExecutionTab';
import { ProgressTab } from './tabs/ProgressTab';
import { AssessmentsTab } from './tabs/AssessmentsTab';

export type SheetTab = 'overview' | 'program' | 'execution' | 'progress' | 'assessments' | 'notes' | 'calibration' | 'team' | 'history';

const TABS: { id: SheetTab; label: string }[] = [
  { id: 'overview', label: 'Panoramica' },
  { id: 'program', label: 'Programma' },
  { id: 'execution', label: 'Esecuzione' },
  { id: 'progress', label: 'Progressi' },
  { id: 'assessments', label: 'Valutazioni' },
  { id: 'calibration', label: 'Taratura' },
  { id: 'notes', label: 'Note' },
  { id: 'team', label: 'Team' },
  { id: 'history', label: 'Cronologia e dati' },
];

export function usePatient(id: string | undefined) {
  return useAsync(() => (id ? GET<any>(`/api/patients/${id}`) : Promise.resolve(null)), [id]);
}

export function TabContent({ tab, patient, reload, setTab }: { tab: SheetTab; patient: any; reload: () => void; setTab: (t: SheetTab) => void }) {
  const canEdit = patient.accessLevel === 'owner' || patient.accessLevel === 'editor';
  switch (tab) {
    case 'overview': return <OverviewTab patient={patient} canEdit={canEdit} onChanged={reload} />;
    case 'program': return <ProgramTab patient={patient} canEdit={canEdit} />;
    case 'execution': return <ExecutionTab patient={patient} canEdit={canEdit} />;
    case 'progress': return <ProgressTab patient={patient} canEdit={canEdit} onEditProgram={() => setTab('program')} />;
    case 'assessments': return <AssessmentsTab patient={patient} canEdit={canEdit} />;
    case 'notes': return <NotesTab patient={patient} canEdit={canEdit} />;
    case 'calibration': return <CalibrationsTab patient={patient} canEdit={canEdit} />;
    case 'team': return <TeamTab patient={patient} />;
    case 'history': return <HistoryTab patient={patient} canEdit={canEdit} />;
  }
}

export function PatientSheet() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as SheetTab) || 'overview';
  const setTab = (t: SheetTab) => setSp({ tab: t }, { replace: true });
  const q = usePatient(id);
  useEffect(() => { if (id) try { sessionStorage.setItem('handlab.lastPatient', id); } catch { /* */ } }, [id]);
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const p = q.data;
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="small"><Link to="/pazienti">← Pazienti</Link></div>
          <h1>{p.code} <DemoBadge show={p.isDemo} /></h1>
          <div className="small muted">{p.condition || 'Problema non indicato'}{p.accessLevel !== 'owner' ? ` · tuo accesso: ${p.accessLevel === 'editor' ? 'modifica' : 'sola lettura'}` : ''}</div>
        </div>
      </div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <TabContent tab={tab} patient={p} reload={q.reload} setTab={setTab} />
    </div>
  );
}

/** Sezioni del menu riferite a un paziente: selezione del paziente + scheda corrispondente */
export function PatientSection({ title, tab, intro }: { title: string; tab: SheetTab; intro: string }) {
  const nav = useNavigate();
  const list = useAsync(() => GET<any[]>('/api/patients'), []);
  const [pid, setPid] = useState<string>(() => { try { return sessionStorage.getItem('handlab.lastPatient') ?? ''; } catch { return ''; } });
  const valid = list.data?.some((p) => p.id === pid) ? pid : '';
  const q = usePatient(valid || undefined);
  const [innerTab, setInnerTab] = useState<SheetTab>(tab);
  useEffect(() => setInnerTab(tab), [tab]);
  return (
    <div>
      <div className="page-head">
        <div><h1>{title}</h1><p className="small muted" style={{ margin: 0 }}>{intro}</p></div>
        <select value={valid} onChange={(e) => { setPid(e.target.value); try { sessionStorage.setItem('handlab.lastPatient', e.target.value); } catch { /* */ } }} style={{ maxWidth: 320 }} aria-label="Paziente">
          <option value="">Scegli un paziente…</option>
          {(list.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}{p.isDemo ? ' (demo)' : ''}</option>)}
        </select>
      </div>
      {!valid && <div className="card muted">Seleziona un paziente.</div>}
      {valid && q.data && (
        <>
          <p className="small"><a href={`/pazienti/${valid}`} onClick={(e) => { e.preventDefault(); nav(`/pazienti/${valid}?tab=${innerTab}`); }}>Apri la scheda completa di {q.data.code} →</a></p>
          <TabContent tab={innerTab} patient={q.data} reload={q.reload} setTab={(t) => { if (t === innerTab) return; nav(`/pazienti/${valid}?tab=${t}`); }} />
        </>
      )}
    </div>
  );
}
