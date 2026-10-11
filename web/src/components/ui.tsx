import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { errMsg } from '../api';

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try { const d = await fn(); if (my === seq.current) { setData(d); setError(null); } }
    catch (e) { if (my === seq.current) setError(errMsg(e)); }
    finally { if (my === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

export function Loading({ what = 'Caricamento…' }: { what?: string }) {
  return <p className="muted" role="status">{what}</p>;
}

export function ErrorBox({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null;
  return <div className="notice danger" role="alert">{error} {onRetry && <button className="btn-small" onClick={onRetry}>Riprova</button>}</div>;
}

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { maxWidth: 920 } : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn-ghost btn-small" onClick={onClose} aria-label="Chiudi">Chiudi ✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <div className="hint">{hint}</div>}</label>;
}

export function DemoBadge({ show }: { show?: boolean }) {
  return show ? <span className="badge demo" title="Dato dimostrativo, non reale">DEMO</span> : null;
}

export function ExperimentalBadge() {
  return <span className="badge exp" title="Prova touchscreen sperimentale, non validata">Sperimentale · non validata</span>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'active' : ''} onClick={() => onChange(t.id)}>{t.label}</button>)}
    </div>
  );
}

export function NumberScale({ value, onChange, labels }: { value: number | null; onChange: (v: number | null) => void; labels: [string, string] }) {
  return (
    <div>
      <div className="scale" role="radiogroup">
        {Array.from({ length: 11 }, (_, i) => (
          <button key={i} type="button" role="radio" aria-checked={value === i} className={value === i ? 'sel' : ''} onClick={() => onChange(value === i ? null : i)}>{i}</button>
        ))}
      </div>
      <div className="row between small muted" style={{ marginTop: 4 }}><span>0 = {labels[0]}</span><span>10 = {labels[1]}</span></div>
    </div>
  );
}

export function Confirm({ title, text, confirmLabel = 'Conferma', danger, onConfirm, onCancel, needReason }: { title: string; text: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: (reason: string) => void; onCancel: () => void; needReason?: boolean }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={title} onClose={onCancel}>
      <div style={{ marginBottom: 12 }}>{text}</div>
      {needReason && <Field label="Motivo (obbligatorio, resta nella cronologia)"><textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onCancel}>Annulla</button>
        <button className={danger ? 'btn-danger' : 'btn-primary'} disabled={needReason && reason.trim().length < 3} onClick={() => onConfirm(reason.trim())}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
