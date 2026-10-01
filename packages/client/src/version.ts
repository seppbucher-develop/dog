import { useSyncExternalStore } from 'react';

export interface VersionState {
  /** Version, mit der diese Seite gestartet wurde */
  current: string | null;
  /** Zuletzt vom Server gemeldete Version */
  latest: string | null;
}

let state: VersionState = { current: null, latest: null };
const listeners = new Set<() => void>();

function set(next: VersionState) {
  state = next;
  listeners.forEach((l) => l());
}

/** Fragt die Server-Version ab; nach einem Update des Servers unterscheidet sie sich von der geladenen. */
export async function checkVersion(): Promise<void> {
  try {
    const r = await fetch('/version', { cache: 'no-store' });
    if (!r.ok) return;
    const { version } = (await r.json()) as { version?: string };
    if (typeof version !== 'string') return;
    set({ current: state.current ?? version, latest: version });
  } catch {
    /* ohne Antwort bleibt die Anzeige leer */
  }
}

export const useVersion = (): VersionState => useSyncExternalStore((fn) => (listeners.add(fn), () => void listeners.delete(fn)), () => state);

/** Es läuft eine neuere Version auf dem Server als die geladene. */
export const isOutdated = (v: VersionState): boolean => v.current !== null && v.latest !== null && v.current !== v.latest;

/** Aktueller Zustand (auch für Tests) */
export const getVersionState = (): VersionState => state;

/** Nur für Tests */
export function resetVersionForTest() {
  state = { current: null, latest: null };
}
