/**
 * Archivio locale su IndexedDB: copia del programma per l'uso offline e coda delle attività
 * da sincronizzare. Non è un archivio definitivo: i dati fanno fede solo una volta ricevuti dal server.
 */
const DB_NAME = 'handlab';
const VERSION = 1;

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return wrap(db.transaction('kv').objectStore('kv').get(key)) as Promise<T | undefined>;
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  await wrap(db.transaction('kv', 'readwrite').objectStore('kv').put(value, key));
}
export async function kvDel(key: string): Promise<void> {
  const db = await open();
  await wrap(db.transaction('kv', 'readwrite').objectStore('kv').delete(key));
}

export interface OutboxItem {
  key: string;            // kind:id
  kind: 'session' | 'run' | 'symptom' | 'deviceCheck';
  id: string;
  userId: string;
  patientId: string | null;   // valorizzato per le valutazioni registrate dal professionista
  rev: number;
  updatedAt: string;
  payload: any;
}

export async function outboxPut(item: Omit<OutboxItem, 'key' | 'rev' | 'updatedAt'>): Promise<void> {
  const db = await open();
  const key = `${item.kind}:${item.id}`;
  const store = db.transaction('outbox', 'readwrite').objectStore('outbox');
  const prev = (await wrap(store.get(key))) as OutboxItem | undefined;
  const tx2 = db.transaction('outbox', 'readwrite').objectStore('outbox');
  await wrap(tx2.put({ ...item, key, rev: (prev?.rev ?? 0) + 1, updatedAt: new Date().toISOString() }));
}

export async function outboxAll(): Promise<OutboxItem[]> {
  const db = await open();
  return wrap(db.transaction('outbox').objectStore('outbox').getAll()) as Promise<OutboxItem[]>;
}

/** rimuove gli elementi inviati, solo se non sono stati aggiornati nel frattempo */
export async function outboxAck(sent: { key: string; rev: number }[]): Promise<void> {
  const db = await open();
  for (const s of sent) {
    const store = db.transaction('outbox', 'readwrite').objectStore('outbox');
    const cur = (await wrap(store.get(s.key))) as OutboxItem | undefined;
    if (cur && cur.rev === s.rev) await wrap(db.transaction('outbox', 'readwrite').objectStore('outbox').delete(s.key));
  }
}
