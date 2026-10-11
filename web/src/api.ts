export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export class OfflineError extends Error {
  constructor() { super('Connessione assente: impossibile contattare il server.'); }
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'x-handlab': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new OfflineError();
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Errore ${res.status}`);
  return data as T;
}

export const GET = <T = any>(url: string) => api<T>('GET', url);
export const POST = <T = any>(url: string, body: unknown = {}) => api<T>('POST', url, body);
export const PUT = <T = any>(url: string, body: unknown) => api<T>('PUT', url, body);
export const DEL = <T = any>(url: string, body?: unknown) => api<T>('DELETE', url, body);

/** scarica un file prodotto dal server (esportazioni) */
export async function download(url: string, filename: string) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) { let msg = `Errore ${res.status}`; try { msg = (await res.json()).error ?? msg; } catch { /* */ } throw new ApiError(res.status, msg); }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
