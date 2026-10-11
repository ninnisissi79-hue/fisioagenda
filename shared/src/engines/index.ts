import type { EngineSetup } from './base.ts';
import { BaseEngine } from './base.ts';
import { PinchEngine } from './pinch.ts';
import { SlideEngine } from './slide.ts';
import { PianoEngine } from './piano.ts';
import { PathEngine } from './path.ts';
import { ChaseEngine } from './chase.ts';

export * from './base.ts';
export * from './tracker.ts';
export * from './comfort.ts';
export { PinchEngine, SlideEngine, PianoEngine, PathEngine, ChaseEngine };
export { unitPath } from './path.ts';

export function createEngine(setup: EngineSetup): BaseEngine {
  switch (setup.exerciseId) {
    case 'pinch': return new PinchEngine(setup);
    case 'slide': return new SlideEngine(setup);
    case 'piano': return new PianoEngine(setup);
    case 'path': return new PathEngine(setup);
    case 'chase': return new ChaseEngine(setup);
    default: throw new Error(`Esercizio non ancora disponibile: ${setup.exerciseId}`);
  }
}
