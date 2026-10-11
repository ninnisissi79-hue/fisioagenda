import { useState } from 'react';
import { physicalScale, setPhysicalScale } from '../local/device';

const CARD_MM = 85.6; // formato ID-1 (ISO/IEC 7810): 85,60 × 53,98 mm

/** Calibrazione fisica facoltativa con un riferimento di dimensione nota (tessera formato carta di credito). */
export function PhysicalScaleCard() {
  const cur = physicalScale();
  const [w, setW] = useState(cur ? cur.pxPerMm * CARD_MM : 320);
  const [saved, setSaved] = useState(cur);
  return (
    <div className="card">
      <h2>Calibrazione fisica dello schermo (facoltativa)</h2>
      <p className="small">I pixel del browser non corrispondono a millimetri in modo affidabile. Se servono misure in mm, appoggia sullo schermo una tessera in formato carta di credito (85,60 × 53,98 mm, es. tessera sanitaria) e regola il riquadro finché coincide esattamente con il lato lungo. Il metodo viene registrato con ogni esecuzione. Va ripetuta per ogni tablet e se cambia lo zoom del browser.</p>
      <div style={{ width: w, height: w * (53.98 / 85.6), border: '3px solid var(--primary)', borderRadius: 10, background: 'var(--primary-soft)', margin: '10px 0', maxWidth: '100%' }} />
      <div className="row">
        <button onClick={() => setW(w - 5)}>−5</button><button onClick={() => setW(w - 1)}>−1</button>
        <input type="range" min={150} max={700} step={0.5} value={w} onChange={(e) => setW(Number(e.target.value))} style={{ flex: 1, minWidth: 160 }} />
        <button onClick={() => setW(w + 1)}>+1</button><button onClick={() => setW(w + 5)}>+5</button>
      </div>
      <p className="small muted">Larghezza riquadro: {w.toFixed(1)} px CSS → {(w / CARD_MM).toFixed(3)} px/mm</p>
      <div className="row">
        <button className="btn-primary" onClick={() => { const s = { pxPerMm: w / CARD_MM, method: 'Tessera formato ID-1 (85,60 mm) sovrapposta allo schermo, regolazione manuale', measuredAt: new Date().toISOString() }; setPhysicalScale(s); setSaved(s); }}>Salva calibrazione</button>
        {saved && <button onClick={() => { setPhysicalScale(null); setSaved(null); }}>Rimuovi</button>}
      </div>
      {saved ? <p className="notice ok small" style={{ marginTop: 10 }}>Calibrazione attiva: {saved.pxPerMm.toFixed(3)} px/mm ({new Date(saved.measuredAt).toLocaleDateString('it-IT')}).</p> : <p className="notice info small" style={{ marginTop: 10 }}>Nessuna calibrazione fisica: le distanze sono riportate solo in unità normalizzate.</p>}
    </div>
  );
}
