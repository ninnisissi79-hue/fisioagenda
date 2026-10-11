import type { DeviceInfo, PhysicalScale } from '@handlab/shared';

/** Informazioni sul dispositivo. Le preferenze del dispositivo restano in localStorage. */
const LS = {
  deviceId: 'handlab.deviceId',
  measured: 'handlab.measuredMaxContacts',
  scale: 'handlab.physicalScale',
  touchCheck: 'handlab.touchCheck',
};

function safeGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k: string, v: string | null) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* archivio non disponibile */ } }

export function deviceId(): string {
  let id = safeGet(LS.deviceId);
  if (!id) { id = crypto.randomUUID(); safeSet(LS.deviceId, id); }
  return id;
}

export function measuredMaxContacts(): number | null {
  const v = Number(safeGet(LS.measured));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export interface TouchCheckResult { at: string; maxContacts: number; declared: number; pointerEvents: boolean; cancelEvents: number; reappearOk: boolean | null; notes: string }

export function lastTouchCheck(): TouchCheckResult | null {
  try { const s = safeGet(LS.touchCheck); return s ? JSON.parse(s) : null; } catch { return null; }
}

export function saveTouchCheck(r: TouchCheckResult) {
  safeSet(LS.touchCheck, JSON.stringify(r));
  safeSet(LS.measured, String(r.maxContacts));
}

export function physicalScale(): PhysicalScale | null {
  try { const s = safeGet(LS.scale); return s ? JSON.parse(s) : null; } catch { return null; }
}

export function setPhysicalScale(s: PhysicalScale | null) { safeSet(LS.scale, s ? JSON.stringify(s) : null); }

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}

export function deviceInfo(): DeviceInfo {
  return {
    deviceId: deviceId(),
    userAgent: navigator.userAgent.slice(0, 400),
    screenW: window.screen.width,
    screenH: window.screen.height,
    dpr: window.devicePixelRatio || 1,
    maxTouchPointsDeclared: navigator.maxTouchPoints ?? 0,
    measuredMaxContacts: measuredMaxContacts(),
    standalone: isStandalone(),
  };
}

export function timeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}
