import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkVersion, getVersionState, isOutdated, resetVersionForTest } from '../src/version';

const answer = (version: string) => vi.fn(async () => new Response(JSON.stringify({ version }), { status: 200 }));

describe('Versionsprüfung', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetVersionForTest();
  });

  it('Erste Antwort legt die geladene Version fest; eine neuere Server-Version macht sie veraltet', async () => {
    vi.stubGlobal('fetch', answer('2026-10-01 aaaaaaa'));
    await checkVersion();
    expect(getVersionState()).toEqual({ current: '2026-10-01 aaaaaaa', latest: '2026-10-01 aaaaaaa' });
    expect(isOutdated(getVersionState())).toBe(false);

    vi.stubGlobal('fetch', answer('2026-10-02 bbbbbbb')); // Server wurde aktualisiert
    await checkVersion();
    expect(getVersionState()).toEqual({ current: '2026-10-01 aaaaaaa', latest: '2026-10-02 bbbbbbb' });
    expect(isOutdated(getVersionState())).toBe(true);
  });

  it('Ohne Antwort oder bei Fehlern bleibt alles unverändert und nichts wird als veraltet gemeldet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await checkVersion();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('kein json', { status: 200 })));
    await checkVersion();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await checkVersion();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: 42 }), { status: 200 })));
    await checkVersion();
    expect(getVersionState()).toEqual({ current: null, latest: null });
    expect(isOutdated(getVersionState())).toBe(false);
  });
});
