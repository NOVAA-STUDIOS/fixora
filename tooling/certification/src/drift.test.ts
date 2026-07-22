import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WorkspaceCapabilities } from '@fixora/core-analysis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hashSources, runSample, type CertificationSample } from './runner.js';

/**
 * The fixture-integrity guard. Certification expectations are DERIVED from specific bytes, so a
 * fixture whose source changed on disk (a stray Apply that wrote a repair back over a real sample —
 * the exact incident that once dropped recall to 57.1% and looked like an engine regression) must
 * be reported as `fixture-drift`, never as a mystery false-negative. These tests pin that.
 */

const NO_TOOLS: WorkspaceCapabilities = {
  tools: new Set(),
  bundled: new Set(),
} as unknown as WorkspaceCapabilities;

function sample(over: Partial<CertificationSample> = {}): CertificationSample {
  return {
    id: 'drift-fixture',
    language: 'typescript',
    category: 'broken',
    support: 'supported',
    requiresTools: ['tsc'],
    note: '',
    expected: { findings: [], deterministicRepairable: 0 },
    ...over,
  };
}

describe('hashSources', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fx-drift-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const x = 1;\n', 'utf8');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is stable for identical bytes and flips when a single byte changes', () => {
    const first = hashSources(dir);
    expect(hashSources(dir)).toEqual(first); // deterministic
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const x = 2;\n', 'utf8');
    expect(hashSources(dir)['src/a.ts']).not.toBe(first['src/a.ts']); // one byte → different hash
  });
});

describe('runSample — fixture-drift guard', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fx-drift-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const x = 1;\n', 'utf8');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('fails with an exact fixture-drift reason when the source no longer matches its fingerprint', async () => {
    // A manifest that pins a hash the current bytes do NOT produce = the fixture drifted.
    const result = await runSample(dir, sample({ sourceHashes: { 'src/a.ts': 'deadbeef' } }), NO_TOOLS);
    expect(result.status).toBe('fail');
    expect(result.reason).toMatch(/^fixture-drift: src\/a\.ts /);
  });

  it('does NOT report drift when the fingerprint matches (the guard is silent on an intact fixture)', async () => {
    // Recorded from the very bytes on disk → matches → the drift branch must not fire. With no tools
    // available the sample then skips on its tsc requirement, which is emphatically not a drift fail.
    const result = await runSample(dir, sample({ sourceHashes: hashSources(dir) }), NO_TOOLS);
    expect(result.reason ?? '').not.toMatch(/fixture-drift/);
    expect(result.status).toBe('skipped');
  });

  it('skips the check for a legacy manifest with no recorded fingerprint (backward compatible)', async () => {
    // A pre-fingerprint manifest simply has no `sourceHashes` key at all.
    const result = await runSample(dir, sample(), NO_TOOLS);
    expect(result.reason ?? '').not.toMatch(/fixture-drift/);
  });
});
