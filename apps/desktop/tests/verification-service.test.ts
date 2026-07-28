import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Finding } from '@fixora/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  AnalysisHost,
  VerifyJob,
  VerifyResult,
} from '../electron/main/analysis/analysis-host.js';
import { createVerificationService } from '../electron/main/verification/verification-service.js';

let workspace: string;

beforeEach(() => {
  workspace = join(tmpdir(), `fixora-vs-${String(Date.now())}-${String(Math.random()).slice(2)}`);
  mkdirSync(join(workspace, 'src'), { recursive: true });
  writeFileSync(
    join(workspace, 'src', 'greet.ts'),
    'export function greet(n: string) {\n  return "hi " + n;\n}\n',
  );
});
afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const TARGET: Finding = {
  id: 'f1',
  source: 'eslint',
  ruleId: 'prefer-template',
  severity: 'warning',
  category: 'maintainability',
  location: { file: 'src/greet.ts', startLine: 2, startCol: 3, endLine: 2, endCol: 20 },
  message: 'Prefer template literals.',
  evidence: {
    enclosingSymbol: {
      name: 'greet',
      kind: 'function',
      location: { file: 'src/greet.ts', startLine: 1, startCol: 1, endLine: 3, endCol: 1 },
    },
    snippet: 'return "hi " + n;',
    relatedLocations: [],
    toolOutput: {},
  },
  fixable: true,
  repair: 'ai-required',
  confidence: 1,
};

function hostReturning(result: VerifyResult | 'error'): AnalysisHost {
  return {
    run: () => undefined,
    cancel: () => undefined,
    dispose: () => undefined,
    resolveScope: () => undefined, // not exercised by verification tests
    microRepair: () => undefined, // not exercised by verification tests
    verify: (job: VerifyJob) => {
      if (result === 'error') job.onError('worker died');
      else job.onResult(result);
    },
  };
}

const repairedCode = 'export function greet(n: string) {\n  return `hi ${n}`;\n}';

describe('verification service (overlay + host + verdict)', () => {
  it('returns a VERIFIED report when the overlay re-check is clean and the target is gone', async () => {
    const service = createVerificationService({
      host: hostReturning({ syntaxOk: true, findings: [], aborted: false }),
    });
    const { report, originalCode } = await service.verify({
      finding: TARGET,
      repairedCode,
      target: { file: 'src/greet.ts', startLine: 1, endLine: 3, language: 'typescript' },
      workspaceRoot: workspace,
      originalContent: 'export function greet(n: string) {\n  return "hi " + n;\n}\n',
      originalFindings: [TARGET],
    });
    expect(report.verdict).toBe('verified');
    expect(originalCode).toContain('return "hi " + n;');
  });

  it('returns REGRESSION when the overlay re-check reports broken syntax', async () => {
    const service = createVerificationService({
      host: hostReturning({ syntaxOk: false, findings: [], aborted: false }),
    });
    const { report } = await service.verify({
      finding: TARGET,
      repairedCode: 'this is not valid code {{{',
      target: { file: 'src/greet.ts', startLine: 1, endLine: 3, language: 'typescript' },
      workspaceRoot: workspace,
      originalContent: 'export function greet(n: string) {\n  return "hi " + n;\n}\n',
      originalFindings: [TARGET],
    });
    expect(report.verdict).toBe('regression');
  });

  it('degrades to SKIPPED (never a false VERIFIED) when the worker errors', async () => {
    const service = createVerificationService({ host: hostReturning('error') });
    const { report } = await service.verify({
      finding: TARGET,
      repairedCode,
      target: { file: 'src/greet.ts', startLine: 1, endLine: 3, language: 'typescript' },
      workspaceRoot: workspace,
      originalContent: 'export function greet(n: string) {\n  return "hi " + n;\n}\n',
      originalFindings: [TARGET],
    });
    expect(report.verdict).toBe('skipped');
  });
});
