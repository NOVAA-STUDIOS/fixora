import type { CodeShieldReport, ShieldSettings } from '@fixora/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
}));

type AnalyzeHandler = (
  req: { filePath: string },
  ctx: { requestId: string; window: object | null },
) => Promise<CodeShieldReport>;
type SettingsHandler = (req: unknown, ctx: { requestId: string; window: null }) => ShieldSettings;

const WINDOW = { id: 'w1' };
const CTX = { requestId: 'r1', window: WINDOW };

function report(overrides: Partial<CodeShieldReport> = {}): CodeShieldReport {
  return {
    score: 100,
    critical: [],
    warnings: [],
    passed: [],
    prReadiness: 'ready',
    analyzedAt: Date.now(),
    file: 'a.ts',
    error: null,
    ...overrides,
  };
}

async function handlers(opts: {
  enabled?: boolean;
  hasWorkspace?: boolean;
  analyzeFile?: () => Promise<CodeShieldReport>;
}): Promise<{
  analyze: AnalyzeHandler;
  getSettings: SettingsHandler;
  saveSettings: SettingsHandler;
  resetShieldThrottle: () => void;
}> {
  vi.resetModules();
  const { getHandler } = await import('../electron/main/ipc/router.js');
  const settingsModule = await import('../electron/main/lib/shield-settings.js');
  vi.spyOn(settingsModule, 'getShieldSettings').mockReturnValue({
    enabled: opts.enabled ?? true,
    sensitivity: 'balanced',
  });
  vi.spyOn(settingsModule, 'saveShieldSettings').mockImplementation((next) => next);
  const { registerShieldHandlers, resetShieldThrottle } = await import(
    '../electron/main/ipc/handlers/shield.handlers.js'
  );
  const shield = {
    analyzeFile: vi.fn(opts.analyzeFile ?? (() => Promise.resolve(report()))),
  };
  const workspace = {
    getCurrent: () => (opts.hasWorkspace === false ? null : { id: 'ws-1', rootPath: '/x' }),
  };
  resetShieldThrottle();
  registerShieldHandlers({ shield, workspace } as never);
  return {
    analyze: getHandler('shield:analyze') as unknown as AnalyzeHandler,
    getSettings: getHandler('shield:getSettings') as unknown as SettingsHandler,
    saveSettings: getHandler('shield:saveSettings') as unknown as SettingsHandler,
    resetShieldThrottle,
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('throttle', () => {
  it('same file within 10s returns cached result', async () => {
    let calls = 0;
    const { analyze } = await handlers({
      analyzeFile: () => {
        calls += 1;
        return Promise.resolve(report({ score: calls === 1 ? 90 : 10 }));
      },
    });
    const first = await analyze({ filePath: 'a.ts' }, CTX);
    const second = await analyze({ filePath: 'a.ts' }, CTX);
    expect(first.score).toBe(90);
    expect(second.score).toBe(90);
    expect(calls).toBe(1);
  });

  it('different file bypasses cache', async () => {
    let calls = 0;
    const { analyze } = await handlers({
      analyzeFile: () => {
        calls += 1;
        return Promise.resolve(report({ score: calls === 1 ? 90 : 10 }));
      },
    });
    await analyze({ filePath: 'a.ts' }, CTX);
    await analyze({ filePath: 'b.ts' }, CTX);
    expect(calls).toBe(2);
  });

  it('after 10s, fresh analysis runs', async () => {
    let calls = 0;
    const { analyze } = await handlers({
      analyzeFile: () => {
        calls += 1;
        return Promise.resolve(report({ score: calls === 1 ? 90 : 10 }));
      },
    });
    vi.useFakeTimers();
    await analyze({ filePath: 'a.ts' }, CTX);
    await vi.advanceTimersByTimeAsync(10_001);
    const second = await analyze({ filePath: 'a.ts' }, CTX);
    vi.useRealTimers();
    expect(calls).toBe(2);
    expect(second.score).toBe(10);
  });

  it('resetShieldThrottle() clears cache', async () => {
    let calls = 0;
    const { analyze, resetShieldThrottle } = await handlers({
      analyzeFile: () => {
        calls += 1;
        return Promise.resolve(report({ score: calls === 1 ? 90 : 10 }));
      },
    });
    await analyze({ filePath: 'a.ts' }, CTX);
    resetShieldThrottle();
    await analyze({ filePath: 'a.ts' }, CTX);
    expect(calls).toBe(2);
  });
});

describe('disabled state', () => {
  it('Shield OFF → returns disabled stub report', async () => {
    const { analyze } = await handlers({ enabled: false });
    const result = await analyze({ filePath: 'a.ts' }, CTX);
    expect(result.score).toBeNull();
    expect(result.error).toBe('Code Shield is turned off in Settings.');
  });

  it('no workspace → returns disabled stub', async () => {
    const { analyze } = await handlers({ hasWorkspace: false });
    const result = await analyze({ filePath: 'a.ts' }, CTX);
    expect(result.score).toBeNull();
    expect(result.error).toBe('No project is open.');
  });
});

describe('settings', () => {
  it('shield:getSettings returns current settings', async () => {
    const { getSettings } = await handlers({});
    expect(getSettings(undefined, CTX as never)).toEqual({ enabled: true, sensitivity: 'balanced' });
  });

  it('shield:saveSettings persists and returns updated settings', async () => {
    const { saveSettings } = await handlers({});
    const next = { enabled: false, sensitivity: 'strict' };
    expect(saveSettings(next, CTX as never)).toEqual(next);
  });
});
