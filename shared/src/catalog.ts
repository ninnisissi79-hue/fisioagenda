import type { FingerId, Params, ParamValue } from './types.ts';

export interface ParamDef {
  key: string;
  label: string;
  type: 'number' | 'select' | 'boolean';
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  default: ParamValue;
  options?: { value: string; label: string }[];
  help?: string;
  group: 'volume' | 'difficulty' | 'timing';
  /** il parametro può essere oggetto di progressione automatica (se autorizzata) */
  progressable?: boolean;
}

export interface MetricDef {
  key: string;
  label: string;
  /** count, ms, u (unità normalizzate), mm (solo con calibrazione fisica), ratio (0–1), u/s */
  unit: 'count' | 'ms' | 'u' | 'mm' | 'ratio' | 'u/s';
  description: string;
  higherIsBetter: boolean | null;
  primary?: boolean;
}

export interface FingerRule {
  min: number;
  max: number;
  /** etichette dei ruoli in ordine (es. "Pollice", "Dito che si avvicina") */
  roles: string[];
  firstMustBe?: FingerId;
  description: string;
}

export interface ExerciseDef {
  id: string;
  version: string;
  metricsVersion: string;
  name: string;
  status: 'available' | 'planned';
  /** prova touchscreen sperimentale non validata */
  experimental: true;
  summary: string;
  positioning: string[];
  gesture: string[];
  /** cosa l'esercizio NON misura */
  limits: string;
  fingerRule: FingerRule;
  defaultFingers: FingerId[];
  /** tipo di area confortevole da approvare in taratura */
  comfortKind: 'distance' | 'segment' | 'region' | null;
  params: ParamDef[];
  completion: string;
  metrics: MetricDef[];
  alternatives: string[];
  /** sigla dell'animazione dimostrativa */
  demo: string;
}

const VOLUME_REPS: ParamDef[] = [
  { key: 'sets', label: 'Serie', type: 'number', min: 1, max: 10, step: 1, default: 2, group: 'volume' },
  { key: 'reps', label: 'Ripetizioni per serie', type: 'number', min: 1, max: 50, step: 1, default: 8, group: 'volume' },
  { key: 'restSec', label: 'Pausa tra le serie', unit: 's', type: 'number', min: 0, max: 300, step: 5, default: 20, group: 'timing' },
];

const COMMON_METRICS: MetricDef[] = [
  { key: 'validReps', label: 'Ripetizioni valide', unit: 'count', description: 'Ripetizioni che soddisfano i criteri dell\'esercizio.', higherIsBetter: true, primary: true },
  { key: 'attempts', label: 'Tentativi', unit: 'count', description: 'Ripetizioni iniziate (valide + non valide).', higherIsBetter: null },
  { key: 'successRate', label: 'Quota di ripetizioni valide', unit: 'ratio', description: 'Ripetizioni valide / tentativi.', higherIsBetter: true, primary: true },
  { key: 'activeMs', label: 'Tempo attivo', unit: 'ms', description: 'Tempo di esercizio escluse pause, riposo tra le serie e app in secondo piano.', higherIsBetter: null },
  { key: 'contactLosses', label: 'Contatti persi', unit: 'count', description: 'Sollevamenti non richiesti di un dito assegnato.', higherIsBetter: false },
  { key: 'extraContacts', label: 'Contatti non assegnati', unit: 'count', description: 'Contatti rilevati lontano dalle dita previste.', higherIsBetter: false },
];

export const CATALOG: ExerciseDef[] = [
  {
    id: 'pinch',
    version: '1.0.0',
    metricsVersion: '1.0.0',
    name: 'Pinza sul piano',
    status: 'available',
    experimental: true,
    summary: 'Avvicinare e allontanare sul piano il pollice e il dito selezionato.',
    positioning: [
      'Avambraccio appoggiato sul tavolo, tablet piatto e stabile.',
      'Appoggia il pollice e il dito indicato sui due cerchi.',
    ],
    gesture: [
      'Fai scivolare le due dita una verso l\'altra fino al segno.',
      'Mantieni un attimo, poi allontanale fino al segno esterno.',
      'Le dita restano sempre appoggiate allo schermo.',
    ],
    limits: 'Rileva la distanza tra due contatti sullo schermo. Non misura la forza di pinza né l\'ampiezza articolare.',
    fingerRule: { min: 2, max: 2, roles: ['Pollice', 'Dito'], firstMustBe: 'T', description: 'Pollice e un altro dito.' },
    defaultFingers: ['T', 'I'],
    comfortKind: 'distance',
    params: [
      ...VOLUME_REPS,
      { key: 'amplitude', label: 'Ampiezza (quota dell\'intervallo approvato)', type: 'number', min: 0.2, max: 1, step: 0.05, default: 0.6, group: 'difficulty', progressable: true, help: 'Non può superare 1 = intervallo confortevole approvato in taratura.' },
      { key: 'tolerance', label: 'Tolleranza', unit: 'u', type: 'number', min: 0.01, max: 0.15, step: 0.01, default: 0.04, group: 'difficulty', progressable: true },
      { key: 'holdMs', label: 'Mantenimento in chiusura', unit: 'ms', type: 'number', min: 0, max: 5000, step: 100, default: 500, group: 'timing', progressable: true },
      { key: 'maxRepSec', label: 'Tempo massimo per ripetizione', unit: 's', type: 'number', min: 3, max: 60, step: 1, default: 15, group: 'timing' },
    ],
    completion: 'Completato quando il numero di ripetizioni valide raggiunge serie × ripetizioni. Una ripetizione è valida se le due dita restano appoggiate, raggiungono la distanza di chiusura, la mantengono per il tempo richiesto e tornano alla distanza di apertura entro il tempo massimo.',
    metrics: [
      ...COMMON_METRICS,
      { key: 'meanRepMs', label: 'Tempo medio per ripetizione', unit: 'ms', description: 'Dall\'inizio della chiusura al ritorno in apertura (solo ripetizioni valide).', higherIsBetter: null },
      { key: 'minDistanceU', label: 'Distanza minima raggiunta', unit: 'u', description: 'Distanza minima tra i due contatti.', higherIsBetter: null },
      { key: 'maxDistanceU', label: 'Distanza massima raggiunta', unit: 'u', description: 'Distanza massima tra i due contatti durante le ripetizioni.', higherIsBetter: null },
      { key: 'meanRangeU', label: 'Escursione media sul piano', unit: 'u', description: 'Media per ripetizione di (distanza massima − minima).', higherIsBetter: null },
      { key: 'meanRangeMm', label: 'Escursione media sul piano (mm)', unit: 'mm', description: 'Disponibile solo con calibrazione fisica esplicita del dispositivo.', higherIsBetter: null },
      { key: 'planeDriftU', label: 'Spostamento sul piano', unit: 'u', description: 'Spostamento medio del punto medio tra le due dita rispetto all\'inizio della ripetizione.', higherIsBetter: null },
    ],
    alternatives: ['fan'],
    demo: 'pinch',
  },
  {
    id: 'slide',
    version: '1.0.0',
    metricsVersion: '1.0.0',
    name: 'Scorrimento di un dito',
    status: 'available',
    experimental: true,
    summary: 'Far scorrere un dito avanti e indietro tra due bersagli, mantenendo le altre dita nelle loro zone.',
    positioning: [
      'Avambraccio appoggiato, polso comodo.',
      'Appoggia il dito che si muove sul cerchio di partenza e le altre dita indicate nelle loro zone.',
    ],
    gesture: [
      'Fai scorrere il dito fino al bersaglio lontano.',
      'Torna indietro fino al bersaglio vicino.',
      'Le altre dita restano ferme nelle loro zone.',
    ],
    limits: 'Rileva lo spostamento dei contatti sullo schermo. Lo scorrimento non dimostra da solo un movimento articolare isolato.',
    fingerRule: { min: 1, max: 5, roles: ['Dito che scorre', 'Dita ferme (facoltative)'], description: 'Il primo dito scorre; gli eventuali altri restano fermi nelle zone.' },
    defaultFingers: ['I'],
    comfortKind: 'segment',
    params: [
      ...VOLUME_REPS,
      { key: 'amplitude', label: 'Ampiezza (quota del tratto approvato)', type: 'number', min: 0.2, max: 1, step: 0.05, default: 0.6, group: 'difficulty', progressable: true },
      { key: 'targetRadius', label: 'Raggio bersagli', unit: 'u', type: 'number', min: 0.03, max: 0.2, step: 0.01, default: 0.08, group: 'difficulty', progressable: true },
      { key: 'zoneRadius', label: 'Raggio zone delle dita ferme', unit: 'u', type: 'number', min: 0.04, max: 0.25, step: 0.01, default: 0.12, group: 'difficulty', progressable: true },
      { key: 'requireStabilizers', label: 'Ripetizione valida solo con dita ferme nelle zone', type: 'boolean', default: true, group: 'difficulty' },
      { key: 'maxRepSec', label: 'Tempo massimo per ripetizione', unit: 's', type: 'number', min: 3, max: 60, step: 1, default: 15, group: 'timing' },
    ],
    completion: 'Completato quando le ripetizioni valide raggiungono serie × ripetizioni. Una ripetizione è valida se il dito raggiunge il bersaglio lontano e torna a quello vicino entro il tempo massimo senza sollevarsi e, se richiesto, con le altre dita sempre nelle loro zone.',
    metrics: [
      ...COMMON_METRICS,
      { key: 'meanReachMs', label: 'Tempo medio di andata', unit: 'ms', description: 'Tempo per raggiungere il bersaglio lontano.', higherIsBetter: null },
      { key: 'meanReturnMs', label: 'Tempo medio di ritorno', unit: 'ms', description: 'Tempo per tornare al bersaglio vicino.', higherIsBetter: null },
      { key: 'meanDeviationU', label: 'Deviazione media dalla traiettoria', unit: 'u', description: 'Distanza media perpendicolare dalla retta tra i due bersagli.', higherIsBetter: false },
      { key: 'stabilizerExits', label: 'Uscite delle dita ferme', unit: 'count', description: 'Volte in cui una delle altre dita è uscita dalla zona o si è sollevata.', higherIsBetter: false },
      { key: 'stabilizerInZoneRatio', label: 'Quota di tempo con dita ferme in zona', unit: 'ratio', description: 'Calcolata solo se sono previste dita ferme.', higherIsBetter: true },
    ],
    alternatives: ['path'],
    demo: 'slide',
  },
  {
    id: 'piano',
    version: '1.0.0',
    metricsVersion: '1.0.0',
    name: 'Pianoforte',
    status: 'available',
    experimental: true,
    summary: 'Sollevare e riappoggiare il dito indicato mentre le altre dita restano appoggiate.',
    positioning: [
      'Mano rilassata, dita appoggiate sui tasti colorati.',
      'Avambraccio e polso appoggiati.',
    ],
    gesture: [
      'Quando un tasto si illumina, solleva quel dito.',
      'Riappoggialo sul suo tasto.',
      'Le altre dita restano giù.',
    ],
    limits: 'Rileva quando un contatto si stacca e torna sullo schermo. Non misura l\'altezza del sollevamento né il movimento delle singole articolazioni.',
    fingerRule: { min: 1, max: 5, roles: ['Dita sui tasti'], description: 'Da 1 a 5 dita; servono tanti contatti simultanei quante sono le dita.' },
    defaultFingers: ['I', 'M', 'R'],
    comfortKind: null,
    params: [
      { key: 'sets', label: 'Serie', type: 'number', min: 1, max: 10, step: 1, default: 2, group: 'volume' },
      { key: 'reps', label: 'Segnali per serie', type: 'number', min: 1, max: 60, step: 1, default: 10, group: 'volume' },
      { key: 'restSec', label: 'Pausa tra le serie', unit: 's', type: 'number', min: 0, max: 300, step: 5, default: 20, group: 'timing' },
      { key: 'responseSec', label: 'Tempo per rispondere', unit: 's', type: 'number', min: 1, max: 15, step: 0.5, default: 4, group: 'timing', progressable: true },
      { key: 'zoneRadius', label: 'Raggio dei tasti', unit: 'u', type: 'number', min: 0.04, max: 0.2, step: 0.01, default: 0.09, group: 'difficulty', progressable: true },
      { key: 'order', label: 'Ordine dei segnali', type: 'select', default: 'sequence', options: [{ value: 'sequence', label: 'In sequenza' }, { value: 'random', label: 'Casuale (sequenza registrata)' }], group: 'difficulty' },
    ],
    completion: 'Completato quando le risposte corrette raggiungono serie × segnali per serie. Una risposta è corretta se si solleva il dito indicato (e nessun altro) entro il tempo previsto e lo si riappoggia sul suo tasto.',
    metrics: [
      ...COMMON_METRICS,
      { key: 'wrongLifts', label: 'Dita sbagliate sollevate', unit: 'count', description: 'Sollevamenti di un dito diverso da quello indicato.', higherIsBetter: false },
      { key: 'omissions', label: 'Segnali senza risposta', unit: 'count', description: 'Segnali scaduti senza sollevamento del dito indicato.', higherIsBetter: false },
      { key: 'meanReactionMs', label: 'Tempo medio di reazione', unit: 'ms', description: 'Dal segnale al sollevamento del dito corretto.', higherIsBetter: false },
      { key: 'meanLiftMs', label: 'Durata media del sollevamento', unit: 'ms', description: 'Dal sollevamento al riappoggio.', higherIsBetter: null },
      { key: 'meanReplaceErrorU', label: 'Errore medio di riappoggio', unit: 'u', description: 'Distanza dal centro del tasto al riappoggio.', higherIsBetter: false },
    ],
    alternatives: ['rhythm'],
    demo: 'piano',
  },
  {
    id: 'path',
    version: '1.0.0',
    metricsVersion: '1.0.0',
    name: 'Segui la strada',
    status: 'available',
    experimental: true,
    summary: 'Percorrere con un dito una strada rettilinea, curva o a onda restando nel tracciato.',
    positioning: ['Avambraccio appoggiato, tablet stabile.', 'Appoggia il dito indicato sul cerchio di partenza.'],
    gesture: ['Segui la strada fino all\'arrivo senza staccare il dito.', 'La volta successiva la strada si percorre al contrario.'],
    limits: 'Rileva la traiettoria del contatto sullo schermo, non il movimento delle singole articolazioni.',
    fingerRule: { min: 1, max: 1, roles: ['Dito'], description: 'Un dito.' },
    defaultFingers: ['I'],
    comfortKind: 'region',
    params: [
      { key: 'sets', label: 'Serie', type: 'number', min: 1, max: 10, step: 1, default: 2, group: 'volume' },
      { key: 'reps', label: 'Percorsi per serie', type: 'number', min: 1, max: 30, step: 1, default: 4, group: 'volume' },
      { key: 'restSec', label: 'Pausa tra le serie', unit: 's', type: 'number', min: 0, max: 300, step: 5, default: 20, group: 'timing' },
      { key: 'pathType', label: 'Tipo di strada', type: 'select', default: 'straight', options: [{ value: 'straight', label: 'Rettilinea' }, { value: 'curve', label: 'Curva' }, { value: 'wave', label: 'A onda' }, { value: 'zigzag', label: 'Spezzata' }], group: 'difficulty' },
      { key: 'amplitude', label: 'Ampiezza (quota dell\'area approvata)', type: 'number', min: 0.2, max: 1, step: 0.05, default: 0.7, group: 'difficulty', progressable: true },
      { key: 'corridor', label: 'Larghezza della strada', unit: 'u', type: 'number', min: 0.04, max: 0.3, step: 0.01, default: 0.12, group: 'difficulty', progressable: true },
      { key: 'minInCorridor', label: 'Quota minima nel tracciato per percorso valido', type: 'number', min: 0, max: 1, step: 0.05, default: 0.7, group: 'difficulty', progressable: true },
      { key: 'maxRepSec', label: 'Tempo massimo per percorso', unit: 's', type: 'number', min: 5, max: 120, step: 5, default: 30, group: 'timing' },
    ],
    completion: 'Completato quando i percorsi validi raggiungono serie × percorsi. Un percorso è valido se si arriva al traguardo entro il tempo massimo, passando per tutto il tracciato, con una quota di campioni dentro la strada almeno pari a quella impostata.',
    metrics: [
      ...COMMON_METRICS,
      { key: 'meanPathMs', label: 'Tempo medio per percorso', unit: 'ms', description: 'Solo percorsi conclusi.', higherIsBetter: null },
      { key: 'inCorridorRatio', label: 'Quota nel tracciato', unit: 'ratio', description: 'Quota di campioni del contatto dentro la strada.', higherIsBetter: true },
      { key: 'meanDeviationU', label: 'Deviazione media dal centro', unit: 'u', description: 'Distanza media dal centro della strada.', higherIsBetter: false },
      { key: 'corridorExits', label: 'Uscite dalla strada', unit: 'count', description: 'Numero di uscite dal tracciato.', higherIsBetter: false },
      { key: 'meanSpeed', label: 'Velocità media', unit: 'u/s', description: 'Lunghezza percorsa / tempo (percorsi conclusi).', higherIsBetter: null },
    ],
    alternatives: ['chase'],
    demo: 'path',
  },
  {
    id: 'chase',
    version: '1.0.0',
    metricsVersion: '1.0.0',
    name: 'Insegui il bersaglio',
    status: 'available',
    experimental: true,
    summary: 'Tenere il dito sopra un bersaglio che si muove lentamente.',
    positioning: ['Avambraccio appoggiato.', 'Appoggia il dito sul bersaglio: partirà quando lo tocchi.'],
    gesture: ['Segui il bersaglio tenendo il dito sopra di lui.', 'Se stacchi il dito il bersaglio si ferma e ti aspetta.'],
    limits: 'Rileva la vicinanza del contatto al bersaglio, non la qualità del movimento articolare.',
    fingerRule: { min: 1, max: 1, roles: ['Dito'], description: 'Un dito.' },
    defaultFingers: ['I'],
    comfortKind: 'region',
    params: [
      { key: 'sets', label: 'Serie', type: 'number', min: 1, max: 10, step: 1, default: 2, group: 'volume' },
      { key: 'durationSec', label: 'Durata di ogni serie', unit: 's', type: 'number', min: 10, max: 300, step: 5, default: 30, group: 'volume' },
      { key: 'restSec', label: 'Pausa tra le serie', unit: 's', type: 'number', min: 0, max: 300, step: 5, default: 20, group: 'timing' },
      { key: 'speed', label: 'Velocità del bersaglio', unit: 'u/s', type: 'number', min: 0.02, max: 0.5, step: 0.01, default: 0.08, group: 'difficulty', progressable: true },
      { key: 'targetRadius', label: 'Raggio del bersaglio', unit: 'u', type: 'number', min: 0.03, max: 0.2, step: 0.01, default: 0.09, group: 'difficulty', progressable: true },
      { key: 'amplitude', label: 'Ampiezza (quota dell\'area approvata)', type: 'number', min: 0.2, max: 1, step: 0.05, default: 0.7, group: 'difficulty', progressable: true },
    ],
    completion: 'Completato quando il tempo di inseguimento (dito appoggiato, bersaglio in movimento) raggiunge serie × durata. Il tempo con il dito sollevato non viene conteggiato.',
    metrics: [
      ...COMMON_METRICS.filter((m) => !['validReps', 'attempts', 'successRate'].includes(m.key)),
      { key: 'validReps', label: 'Serie completate', unit: 'count', description: 'Serie concluse.', higherIsBetter: true, primary: true },
      { key: 'successRate', label: 'Quota di tempo sul bersaglio', unit: 'ratio', description: 'In questo esercizio coincide con la quota di tempo sul bersaglio.', higherIsBetter: true, primary: true },
      { key: 'trackingMs', label: 'Tempo di inseguimento', unit: 'ms', description: 'Tempo con dito appoggiato e bersaglio in movimento.', higherIsBetter: null },
      { key: 'onTargetRatio', label: 'Quota di tempo sul bersaglio', unit: 'ratio', description: 'Quota del tempo di inseguimento con il dito entro il raggio del bersaglio.', higherIsBetter: true },
      { key: 'meanDistanceU', label: 'Distanza media dal bersaglio', unit: 'u', description: 'Distanza media tra contatto e centro del bersaglio.', higherIsBetter: false },
      { key: 'longestOnTargetMs', label: 'Tempo continuo più lungo sul bersaglio', unit: 'ms', description: 'Intervallo continuo più lungo entro il raggio.', higherIsBetter: true },
    ],
    alternatives: ['path'],
    demo: 'chase',
  },
  ...planned('thumb', 'Movimento del pollice', 'Raggiungere con il pollice bersagli disposti nell\'area calibrata.', { min: 1, max: 1, roles: ['Pollice'], firstMustBe: 'T', description: 'Pollice.' }, ['T'], 'region'),
  ...planned('fan', 'Ventaglio', 'Allontanare e riavvicinare due dita sul piano.', { min: 2, max: 2, roles: ['Dito 1', 'Dito 2'], description: 'Due dita.' }, ['I', 'M'], 'distance'),
  ...planned('drag', 'Raccogli e sposta', 'Trascinare oggetti e rilasciarli in un\'area.', { min: 1, max: 1, roles: ['Dito'], description: 'Un dito.' }, ['I'], 'region'),
  ...planned('dual', 'Due dita, due percorsi', 'Coordinare due contatti o mantenerne uno fermo mentre l\'altro si muove.', { min: 2, max: 2, roles: ['Dito 1', 'Dito 2'], description: 'Due dita.' }, ['T', 'I'], 'region'),
  ...planned('scale', 'Allarga la figura', 'Modificare la distanza tra due contatti fino a raggiungere una sagoma.', { min: 2, max: 2, roles: ['Dito 1', 'Dito 2'], description: 'Due dita.' }, ['T', 'I'], 'distance'),
  ...planned('rotate', 'Ruota la figura', 'Modificare l\'orientamento di un oggetto con due dita.', { min: 2, max: 2, roles: ['Dito 1', 'Dito 2'], description: 'Due dita.' }, ['T', 'I'], 'distance'),
  ...planned('rhythm', 'Tocca a ritmo', 'Alternare le dita selezionate seguendo segnali.', { min: 1, max: 5, roles: ['Dita'], description: 'Da 1 a 5 dita.' }, ['I', 'M'], null),
  ...planned('sequence', 'Ripeti la sequenza', 'Riprodurre una sequenza di bersagli, distinguendo la componente cognitiva (memoria della sequenza) da quella motoria.', { min: 1, max: 5, roles: ['Dita'], description: 'Da 1 a 5 dita.' }, ['I', 'M', 'R'], null),
];

function planned(id: string, name: string, summary: string, fingerRule: FingerRule, defaultFingers: FingerId[], comfortKind: ExerciseDef['comfortKind']): ExerciseDef[] {
  return [{
    id, version: '0.0.0', metricsVersion: '0.0.0', name, status: 'planned', experimental: true, summary,
    positioning: [], gesture: [], limits: 'Non ancora disponibile.', fingerRule, defaultFingers, comfortKind,
    params: [], completion: 'Non ancora disponibile.', metrics: [], alternatives: [], demo: id,
  }];
}

export function getExercise(id: string): ExerciseDef | undefined {
  return CATALOG.find((e) => e.id === id);
}

export function availableExercises(): ExerciseDef[] {
  return CATALOG.filter((e) => e.status === 'available');
}

export function defaultParams(def: ExerciseDef): Params {
  const out: Params = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}

/** Valida i parametri rispetto al catalogo; restituisce i parametri normalizzati e gli errori. */
export function normalizeParams(def: ExerciseDef, input: Params): { params: Params; errors: string[] } {
  const params: Params = {};
  const errors: string[] = [];
  for (const p of def.params) {
    const v = input[p.key];
    if (v === undefined || v === null || v === '') { params[p.key] = p.default; continue; }
    if (p.type === 'number') {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) { errors.push(`${p.label}: valore non numerico`); params[p.key] = p.default; continue; }
      if (p.min !== undefined && n < p.min) errors.push(`${p.label}: minimo ${p.min}`);
      if (p.max !== undefined && n > p.max) errors.push(`${p.label}: massimo ${p.max}`);
      params[p.key] = n;
    } else if (p.type === 'boolean') {
      params[p.key] = v === true || v === 'true';
    } else {
      const s = String(v);
      if (p.options && !p.options.some((o) => o.value === s)) errors.push(`${p.label}: valore non ammesso`);
      params[p.key] = s;
    }
  }
  return { params, errors };
}

export function validateFingers(def: ExerciseDef, fingers: FingerId[]): string | null {
  const r = def.fingerRule;
  if (new Set(fingers).size !== fingers.length) return 'Ogni dito può comparire una sola volta.';
  if (fingers.length < r.min) return `Servono almeno ${r.min} dita.`;
  if (fingers.length > r.max) return `Al massimo ${r.max} dita.`;
  if (r.firstMustBe && fingers[0] !== r.firstMustBe) return 'Il primo dito deve essere il pollice.';
  return null;
}

/** Numero di contatti simultanei necessari per l'esercizio con le dita indicate. */
export function requiredContacts(def: ExerciseDef, fingers: FingerId[]): number {
  if (def.id === 'path' || def.id === 'chase') return 1;
  return fingers.length;
}

export function plannedReps(def: ExerciseDef, params: Params): { sets: number; reps: number } {
  const sets = Number(params.sets ?? 1);
  if (def.id === 'chase') return { sets, reps: sets };
  return { sets, reps: sets * Number(params.reps ?? 1) };
}

export function paramLabel(def: ExerciseDef, key: string): string {
  return def.params.find((p) => p.key === key)?.label ?? key;
}

export function formatParam(def: ExerciseDef, key: string, v: unknown): string {
  const p = def.params.find((x) => x.key === key);
  if (!p) return String(v);
  if (p.type === 'boolean') return v ? 'sì' : 'no';
  if (p.type === 'select') return p.options?.find((o) => o.value === v)?.label ?? String(v);
  return `${v}${p.unit ? ' ' + p.unit : ''}`;
}
