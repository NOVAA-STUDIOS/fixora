import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CodeShieldReport, Finding, ShieldSensitivity } from '@fixora/shared-types';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getName: () => 'fixora' },
}));

/**
 * Code Shield's scoring is the trust surface: every point deducted must trace to a real finding, and
 * a file that could not be analyzed must never read back as a clean score. These drive the REAL
 * `createShieldService` against a real temp workspace (mirrors `proceed-handlers.test.ts`) — `hasTests`
 * and `targetFor` both touch the filesystem directly, so a fake fs would test the mock, not the guard.
 */

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: overrides.id ?? 'f1',
    source: 'eslint',
    ruleId: 'no-console',
    severity: 'error',
    category: 'correctness',
    location: { file: 'a.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 2 },
    message: 'unexpected',
    evidence: { snippet: '', relatedLocations: [], toolOutput: null },
    fixable: false,
    repair: 'manual',
    confidence: 1,
    ...overrides,
  };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fx-shield-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function service(deps: { findings?: Finding[]; analysisOk?: boolean }): Promise<{
  analyzeFile: (window: null, relPath: string, sensitivity: ShieldSensitivity) => Promise<CodeShieldReport>;
}> {
  vi.resetModules();
  const { createShieldService } = await import('../electron/main/services/shield/shield-service.js');
  const workspace = {
    getCurrent: () => ({ id: 'ws-1', rootPath: root, name: 'p', ignore: { ignores: () => false } }),
  };
  const analysis = {
    analyzeFile: vi.fn(() => Promise.resolve({ ok: deps.analysisOk ?? true })),
  };
  const findings = { list: () => deps.findings ?? [] };
  return createShieldService({ workspace, analysis, findings } as never) as unknown as {
    analyzeFile: (window: null, relPath: string, sensitivity: ShieldSensitivity) => Promise<CodeShieldReport>;
  };
}

describe('score calculation', () => {
  it('perfect score = 100 when no findings and tests exist', async () => {
    writeFileSync(join(root, 'a.ts'), 'export const x = 1;');
    writeFileSync(join(root, 'a.test.ts'), '');
    const s = await service({ findings: [] });
    const report = await s.analyzeFile(null, 'a.ts', 'balanced');
    expect(report.score).toBe(100);
  });

  it('critical finding deducts 15 points', async () => {
    writeFileSync(join(root, 'a.ts'), 'x');
    writeFileSync(join(root, 'a.test.ts'), '');
    const s = await service({ findings: [finding({ severity: 'error' })] });
    const report = await s.analyzeFile(null, 'a.ts', 'balanced');
    expect(report.score).toBe(85);
  });

  it('warning finding deducts 5 points', async () => {
    writeFileSync(join(root, 'a.ts'), 'x');
    writeFileSync(join(root, 'a.test.ts'), '');
    const s = await service({ findings: [finding({ severity: 'warning' })] });
    const report = await s.analyzeFile(null, 'a.ts', 'balanced');
    expect(report.score).toBe(95);
  });

  it('no tests deducts 10 points', async () => {
    writeFileSync(join(root, 'a.ts'), 'x');
    const s = await service({ findings: [] });
    const report = await s.analyzeFile(null, 'a.ts', 'balanced');
    expect(report.score).toBe(90);
  });

  it('critical penalty capped at 45 (3+ critical findings)', async () => {
    writeFileSync(join(root, 'a.ts'), 'x');
    writeFileSync(join(root, 'a.test.ts'), '');
    const findings = [1, 2, 3, 4].map((n) => finding({ id: `f${String(n)}`, severity: 'error' }));
    const s = await service({ findings });
    const report = await s.analyzeFile(null, 'a.ts', 'balanced');
    expect(report.score).toBe(55);
  });

  it('warning penalty capped at 25 (5+ warning findings)', async () => {
    writeFileSync(join(root, 'a.ts'), 'x');
    writeFileSync(join(root, 'a.test.ts'), '');
    const findings = [1, 2, 3, 4, 5, 6].map((n) =>
      finding({ id: `f${String(n)}`, severity: 'warning' }),
    );
    const s = await service({ findings });
    const report = await s.analyzeFile(null, 'a.ts', 'balanced');
    expect(report.score).toBe(75);
  });

  it('score never goes below 0 (max penalties: critical + warning caps + no tests)', async () => {
    writeFileSync(join(root, 'a.ts'), 'x');
    const criticals = Array.from({ length: 10 }, (_, n) =>
      finding({ id: `c${String(n)}`, severity: 'error' }),
    );
    const warnings = Array.from({ length: 10 }, (_, n) =>
      finding({ id: `w${String(n)}`, severity: 'warning' }),
    );
    const s = await service({ findings: [...criticals, ...warnings] });
    const report = await s.analyzeFile(null, 'a.ts', 'balanced');
    // The caps (45 + 25) plus the no-tests penalty (10) sum to 80, so 100 - 80 = 20 is the actual
    // floor this formula can reach — the Math.max(0, ...) guard exists for future penalty additions,
    // and this pins today's worst-case score rather than asserting an unreachable 0.
    expect(report.score).toBe(20);
    expect(report.score).toBeGreaterThanOrEqual(0);
  });

  it('score with mixed findings calculates correctly', async () => {
    writeFileSync(join(root, 'a.ts'), 'x');
    const findings = [
      finding({ id: 'f1', severity: 'error' }),
      finding({ id: 'f2', severity: 'warning' }),
      finding({ id: 'f3', severity: 'warning' }),
    ];
    const s = await service({ findings });
    // 100 - 15 (1 critical) - 10 (2 warnings) - 10 (no tests) = 65
    const report = await s.analyzeFile(null, 'a.ts', 'balanced');
    expect(report.score).toBe(65);
  });
});

describe('prReadiness', () => {
  it('score >= 85 → ready', async () => {
    writeFileSync(join(root, 'a.ts'), 'x');
    writeFileSync(join(root, 'a.test.ts'), '');
    const s = await service({ findings: [] });
    const report = await s.analyzeFile(null, 'a.ts', 'balanced');
    expect(report.prReadiness).toBe('ready');
  });

  it('score 60-84 → needs-work', async () => {
    writeFileSync(join(root, 'a.ts'), 'x');
    const s = await service({ findings: [finding({ severity: 'error' })] });
    const report = await s.analyzeFile(null, 'a.ts', 'balanced');
    expect(report.score).toBe(75);
    expect(report.prReadiness).toBe('needs-work');
  });

  it('score < 60 → not-ready', async () => {
    writeFileSync(join(root, 'a.ts'), 'x');
    const findings = [1, 2, 3, 4].map((n) => finding({ id: `f${String(n)}`, severity: 'error' }));
    const s = await service({ findings });
    const report = await s.analyzeFile(null, 'a.ts', 'balanced');
    expect(report.score).toBe(45);
    expect(report.prReadiness).toBe('not-ready');
  });
});

describe('fabricated score guards', () => {
  it('non-analyzable file (README.md) → score: null', async () => {
    writeFileSync(join(root, 'README.md'), '# hi');
    const s = await service({});
    const report = await s.analyzeFile(null, 'README.md', 'balanced');
    expect(report.score).toBeNull();
    expect(report.error).not.toBeNull();
  });

  it('analysis timeout → score: null with error message', async () => {
    writeFileSync(join(root, 'a.ts'), 'x');
    vi.resetModules();
    const { createShieldService } = await import(
      '../electron/main/services/shield/shield-service.js'
    );
    const workspace = {
      getCurrent: () => ({ id: 'ws-1', rootPath: root, name: 'p', ignore: { ignores: () => false } }),
    };
    // Never resolves — the outer 30s race must still terminate the wait via fake timers.
    const analysis = { analyzeFile: () => new Promise(() => undefined) };
    const findings = { list: () => [] };
    vi.useFakeTimers();
    const s = createShieldService({ workspace, analysis, findings } as never) as unknown as {
      analyzeFile: (window: null, relPath: string, sensitivity: ShieldSensitivity) => Promise<CodeShieldReport>;
    };
    const pending = s.analyzeFile(null, 'a.ts', 'balanced');
    await vi.advanceTimersByTimeAsync(30_000);
    const report = await pending;
    vi.useRealTimers();
    expect(report.score).toBeNull();
    expect(report.error).toBe('Analysis timed out.');
  });

  it('analysis failure → score: null with error message', async () => {
    writeFileSync(join(root, 'a.ts'), 'x');
    const s = await service({ analysisOk: false });
    const report = await s.analyzeFile(null, 'a.ts', 'balanced');
    expect(report.score).toBeNull();
    expect(report.error).toBe('Analysis failed to complete.');
  });

  it('binary/image file → score: null', async () => {
    writeFileSync(join(root, 'pic.png'), Buffer.from([0, 1, 2]));
    const s = await service({});
    const report = await s.analyzeFile(null, 'pic.png', 'balanced');
    expect(report.score).toBeNull();
  });
});

describe('sensitivity levels', () => {
  it('strict: counts error + warning + info findings', async () => {
    writeFileSync(join(root, 'a.ts'), 'x');
    writeFileSync(join(root, 'a.test.ts'), '');
    const findings = [
      finding({ id: 'f1', severity: 'error' }),
      finding({ id: 'f2', severity: 'warning' }),
      finding({ id: 'f3', severity: 'info' }),
    ];
    const s = await service({ findings });
    const report = await s.analyzeFile(null, 'a.ts', 'strict');
    // 1 critical + 2 warnings (warning + info both count as non-error here)
    expect(report.score).toBe(100 - 15 - 10);
  });

  it('balanced: counts error + warning only', async () => {
    writeFileSync(join(root, 'a.ts'), 'x');
    writeFileSync(join(root, 'a.test.ts'), '');
    const findings = [
      finding({ id: 'f1', severity: 'error' }),
      finding({ id: 'f2', severity: 'warning' }),
      finding({ id: 'f3', severity: 'info' }),
    ];
    const s = await service({ findings });
    const report = await s.analyzeFile(null, 'a.ts', 'balanced');
    // info is excluded entirely
    expect(report.score).toBe(100 - 15 - 5);
  });

  it('relaxed: counts error only', async () => {
    writeFileSync(join(root, 'a.ts'), 'x');
    writeFileSync(join(root, 'a.test.ts'), '');
    const findings = [
      finding({ id: 'f1', severity: 'error' }),
      finding({ id: 'f2', severity: 'warning' }),
      finding({ id: 'f3', severity: 'info' }),
    ];
    const s = await service({ findings });
    const report = await s.analyzeFile(null, 'a.ts', 'relaxed');
    expect(report.score).toBe(100 - 15);
  });
});

describe('hasTests', () => {
  it('file itself is a test file → hasTests: true', async () => {
    writeFileSync(join(root, 'a.test.ts'), 'x');
    const s = await service({ findings: [] });
    const report = await s.analyzeFile(null, 'a.test.ts', 'balanced');
    const check = report.passed.find((c) => c.name === 'Tests present');
    expect(check?.passed).toBe(true);
  });

  it('sibling .test.ts exists → hasTests: true', async () => {
    writeFileSync(join(root, 'a.ts'), 'x');
    writeFileSync(join(root, 'a.test.ts'), '');
    const s = await service({ findings: [] });
    const report = await s.analyzeFile(null, 'a.ts', 'balanced');
    const check = report.passed.find((c) => c.name === 'Tests present');
    expect(check?.passed).toBe(true);
  });

  it('sibling __tests__/ exists → hasTests: true', async () => {
    mkdirSync(join(root, '__tests__'), { recursive: true });
    writeFileSync(join(root, 'a.ts'), 'x');
    writeFileSync(join(root, '__tests__', 'a.test.ts'), '');
    const s = await service({ findings: [] });
    const report = await s.analyzeFile(null, 'a.ts', 'balanced');
    const check = report.passed.find((c) => c.name === 'Tests present');
    expect(check?.passed).toBe(true);
  });

  it('no test file found → hasTests: false', async () => {
    writeFileSync(join(root, 'a.ts'), 'x');
    const s = await service({ findings: [] });
    const report = await s.analyzeFile(null, 'a.ts', 'balanced');
    const check = report.passed.find((c) => c.name === 'Tests present');
    expect(check?.passed).toBe(false);
  });
});
