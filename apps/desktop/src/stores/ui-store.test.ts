import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * localStorage survives across app versions and is writable by a compromised renderer, so what the
 * store reads back on launch is untrusted input. These tests pin the "degrade, never crash"
 * contract (DB §1): a stale, tampered or corrupt persisted value is coerced to a valid default,
 * never passed through to a downstream lookup that would throw.
 */
async function loadStoreWith(persisted: unknown) {
  localStorage.setItem('fixora.ui', JSON.stringify({ state: persisted, version: 0 }));
  // Fresh module so the persist middleware rehydrates from what we just wrote, not from a
  // store instance an earlier test already created.
  vi.resetModules();
  const mod = await import('./ui-store.js');
  return mod.useUiStore.getState();
}

describe('ui-store rehydration is a trust boundary', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('accepts valid persisted state', async () => {
    const s = await loadStoreWith({
      theme: 'light',
      density: 'compact',
      activeView: 'findings',
      panelLayout: { workspace: { primary: 30 } },
    });
    expect([s.theme, s.density, s.activeView]).toEqual(['light', 'compact', 'findings']);
    expect(s.panelLayout).toEqual({ workspace: { primary: 30 } });
  });

  it('coerces a stale activeView (renamed view) to the default rather than crashing', async () => {
    const s = await loadStoreWith({ activeView: 'a-view-that-was-removed' });
    expect(s.activeView).toBe('workspace');
  });

  it('coerces a tampered theme/density to defaults', async () => {
    const s = await loadStoreWith({ theme: 'rainbow', density: 42 });
    expect(s.theme).toBe('dark');
    expect(s.density).toBe('comfortable');
  });

  it('drops non-numeric / corrupt panel layout entries', async () => {
    // Layout is now per-view: {view: {pane: size}}. Non-numeric pane sizes are dropped, and a
    // view whose sizes are all junk is dropped with them (as is a flat pre-per-view layout).
    const s = await loadStoreWith({
      panelLayout: {
        workspace: { a: 20, b: 'wide', c: NaN, d: 30 },
        findings: 'nope',
        history: {},
      },
    });
    expect(s.panelLayout).toEqual({ workspace: { a: 20, d: 30 } });
  });

  it('survives a completely corrupt payload', async () => {
    const s = await loadStoreWith('not an object at all');
    expect([s.theme, s.density, s.activeView]).toEqual(['dark', 'comfortable', 'workspace']);
  });

  // Telemetry is opt-in and off by default (FR-5). Rehydration must never *enable* it from a
  // truthy-but-not-`true` value — otherwise a `1`, `"yes"`, or `{}` left in a tampered store would
  // silently turn on data collection the user never agreed to.
  it('leaves telemetry off by default (no persisted value)', async () => {
    const s = await loadStoreWith({});
    expect(s.telemetryEnabled).toBe(false);
  });

  it('enables telemetry only for an explicit boolean true', async () => {
    const s = await loadStoreWith({ telemetryEnabled: true });
    expect(s.telemetryEnabled).toBe(true);
  });

  it.each([1, 'yes', {}, 'true', [true]])(
    'keeps telemetry off for a truthy non-boolean (%o)',
    async (value) => {
      const s = await loadStoreWith({ telemetryEnabled: value });
      expect(s.telemetryEnabled).toBe(false);
    },
  );
});
