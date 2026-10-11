import type { Hand } from '@handlab/shared';

const CAPTIONS: Record<string, string> = {
  pinch: 'avvicina · mantieni · allontana',
  slide: 'scorri avanti e indietro, le altre dita restano ferme',
  piano: 'solleva il dito indicato e riappoggialo',
  path: 'segui la strada senza staccare il dito',
  chase: 'tieni il dito sul bersaglio che si muove',
};

/** Dimostrazioni animate del gesto (schematiche: cerchi = polpastrelli sullo schermo). */
export function DemoAnimation({ exerciseId, hand = 'right' }: { exerciseId: string; hand?: Hand }) {
  const mirror = hand === 'left' ? 'translate(320,0) scale(-1,1)' : undefined;
  const dur = '3s';
  const finger = (cx: number | string, cy: number | string, label: string, anim?: React.ReactNode) => (
    <g>
      <circle cx={cx} cy={cy} r="16" fill="var(--ex-finger)" opacity=".9">{anim}</circle>
    </g>
  );
  let body: React.ReactNode = null;
  if (exerciseId === 'pinch') {
    body = (
      <>
        <line x1="90" y1="150" x2="230" y2="70" stroke="var(--ex-ghost)" strokeWidth="3" strokeDasharray="6 6" />
        <circle cx="90" cy="150" r="18" fill="none" stroke="var(--ex-ghost)" strokeWidth="3" />
        <circle cx="230" cy="70" r="18" fill="none" stroke="var(--ex-ghost)" strokeWidth="3" />
        <circle cx="140" cy="121" r="18" fill="none" stroke="var(--ex-target)" strokeWidth="3" />
        <circle cx="180" cy="99" r="18" fill="none" stroke="var(--ex-target)" strokeWidth="3" />
        {finger(0, 0, 'P', <><animate attributeName="cx" values="90;140;140;90" keyTimes="0;.4;.6;1" dur={dur} repeatCount="indefinite" /><animate attributeName="cy" values="150;121;121;150" keyTimes="0;.4;.6;1" dur={dur} repeatCount="indefinite" /></>)}
        {finger(0, 0, 'D', <><animate attributeName="cx" values="230;180;180;230" keyTimes="0;.4;.6;1" dur={dur} repeatCount="indefinite" /><animate attributeName="cy" values="70;99;99;70" keyTimes="0;.4;.6;1" dur={dur} repeatCount="indefinite" /></>)}
      </>
    );
  } else if (exerciseId === 'slide') {
    body = (
      <>
        <line x1="190" y1="150" x2="200" y2="40" stroke="var(--ex-track)" strokeWidth="14" opacity=".3" strokeLinecap="round" />
        <circle cx="190" cy="150" r="20" fill="var(--ex-target)" opacity=".3" />
        <circle cx="200" cy="40" r="20" fill="var(--ex-target)" opacity=".5" />
        <circle cx="100" cy="140" r="28" fill="none" stroke="var(--ex-ok)" strokeWidth="3" />
        {finger(100, 140, 'P')}
        {finger(0, 0, 'I', <><animate attributeName="cx" values="190;200;190" dur={dur} repeatCount="indefinite" /><animate attributeName="cy" values="150;40;150" dur={dur} repeatCount="indefinite" /></>)}
      </>
    );
  } else if (exerciseId === 'piano') {
    const keys = [[110, 90], [160, 70], [210, 85]];
    body = (
      <>
        {keys.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="24" fill={i === 1 ? 'var(--ex-cue)' : 'var(--ex-muted)'} opacity={i === 1 ? .8 : .35}>{i === 1 && <animate attributeName="opacity" values=".2;.9;.9;.2" dur={dur} repeatCount="indefinite" />}</circle>)}
        {finger(110, 90, 'I')}
        {finger(210, 85, 'A')}
        <circle cx="160" cy="70" r="16" fill="var(--ex-finger)"><animate attributeName="opacity" values=".9;.9;0;0;.9" keyTimes="0;.3;.4;.7;.8" dur={dur} repeatCount="indefinite" /></circle>
      </>
    );
  } else if (exerciseId === 'path') {
    const d = 'M40,140 Q160,0 280,140';
    body = (
      <>
        <path d={d} stroke="var(--ex-track)" strokeWidth="30" fill="none" opacity=".3" strokeLinecap="round" />
        <path d={d} stroke="var(--ex-muted)" strokeWidth="2" fill="none" strokeDasharray="8 8" />
        <circle cx="40" cy="140" r="18" fill="var(--ex-ok)" opacity=".5" />
        <circle cx="280" cy="140" r="18" fill="var(--ex-target)" opacity=".4" />
        <circle r="16" fill="var(--ex-finger)"><animateMotion dur={dur} repeatCount="indefinite" path={d} /></circle>
      </>
    );
  } else if (exerciseId === 'chase') {
    const d = 'M160,90 C230,20 280,90 230,140 C180,180 140,0 90,40 C40,80 90,160 160,90 Z';
    body = (
      <>
        <path d={d} stroke="var(--ex-muted)" strokeWidth="2" fill="none" strokeDasharray="5 10" />
        <circle r="24" fill="var(--ex-ok)" opacity=".5"><animateMotion dur="6s" repeatCount="indefinite" path={d} /></circle>
        <circle r="14" fill="var(--ex-finger)"><animateMotion dur="6s" begin="0.15s" repeatCount="indefinite" path={d} /></circle>
      </>
    );
  } else {
    body = <text x="160" y="100" textAnchor="middle" fontSize="14" fill="var(--muted)">Dimostrazione non ancora disponibile</text>;
  }
  return (
    <svg className="demo-anim" viewBox="0 0 320 200" role="img" aria-label="Dimostrazione animata del gesto">
      <g transform={mirror}>{body}</g>
      <text x="160" y="190" textAnchor="middle" fontSize="13" fill="var(--muted)">{CAPTIONS[exerciseId] ?? ''}</text>
      {hand === 'left' && <text x="8" y="16" fontSize="11" fill="var(--muted)">mano sinistra</text>}
    </svg>
  );
}
