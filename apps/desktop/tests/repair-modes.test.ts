import type { AIProvider, ProviderEvent } from '@fixora/core-ai';
import type { Finding, RepairMode } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { singleProvider } from './support/fake-orchestrator.js';
import { createAiService, type AiServiceDeps } from '../electron/main/ai/ai-service.js';
import type {
  FindingsRepository,
  RepairHistoryRepository,
} from '../electron/main/db/repositories.js';
import type { KeyStore } from '../electron/main/ai/key-store.js';
import type { WorkspaceService } from '../electron/main/services/workspace-service.js';
import type { VerificationService } from '../electron/main/verification/verification-service.js';

/**
 * ISSUE 4 + 8: repair modes and the scope-bounded merge.
 *
 * The safety model these pin: the SPLICE RANGE is the blast radius, so widening it is always an
 * explicit user choice and never something the engine does on its own.
 *
 *  - `finding` (the default) merges nothing and keeps the resolved scope.
 *  - `related-scope` keeps the SAME range — it does not grow the patch, it only lets the same patch
 *    resolve problems already inside it.
 *  - `ai-file` is the only mode that widens the range, and only when asked for by name.
 *
 * A `manual` finding is never merged into any of them: the analyzer already judged that no machine
 * should guess it, and bundling one into a patch would launder that refusal.
 */

const FILE = 'src/w.ts';
const CONTENT = [
  'const a = 1;', // 1
  'function target() {', // 2
  '  const b = 2;', // 3
  '  return b;', // 4
  '}', // 5
  'const far = 3;', // 6
].join('\n');

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'primary',
    source: 'eslint',
    ruleId: 'prefer-const',
    severity: 'warning',
    category: 'maintainability',
    location: { file: FILE, startLine: 3, startCol: 3, endLine: 3, endCol: 14 },
    message: 'Primary problem.',
    evidence: {
      enclosingRange: { startLine: 2, endLine: 5 },
      snippet: '  const b = 2;',
      relatedLocations: [],
      toolOutput: null,
    },
    fixable: false,
    repair: 'ai-required',
    confidence: 1,
    ...over,
  };
}

/** A second problem INSIDE the target scope (lines 2–5). */
const inScope = finding({
  id: 'in-scope',
  ruleId: 'no-unused-vars',
  location: { file: FILE, startLine: 4, startCol: 3, endLine: 4, endCol: 12 },
  message: 'In-scope problem.',
});
/** A problem OUTSIDE the target scope. */
const outOfScope = finding({
  id: 'out-of-scope',
  ruleId: 'eqeqeq',
  location: { file: FILE, startLine: 6, startCol: 1, endLine: 6, endCol: 14 },
  message: 'Out-of-scope problem.',
});
/** A manual-only problem inside the scope — never mergeable, whatever the mode. */
const manualInScope = finding({
  id: 'manual-in-scope',
  ruleId: 'TS2304',
  repair: 'manual',
  location: { file: FILE, startLine: 4, startCol: 3, endLine: 4, endCol: 12 },
  message: 'Manual problem.',
});

const REPAIR_JSON = JSON.stringify({
  repairedCode: 'function target() {\n  const b = 2;\n  return b;\n}',
  rationale: 'Fixed.',
  confidence: 0.9,
});

function capture() {
  const prompts: string[] = [];
  const verified: { startLine: number; endLine: number }[] = [];
  const provider: AIProvider = {
    id: 'fake',
    capabilities: { structuredOutput: true, maxContext: 100_000 },
    // Test Connection is part of the AIProvider contract; a fake that omits it would not be a
    // provider. Answers "healthy" because these tests exercise streaming, not diagnostics.
    test: () =>
      Promise.resolve({ reachable: true, authenticated: true, modelAvailable: true, latencyMs: 1 }),
    stream(request) {
      prompts.push(request.messages.map((m) => m.content).join('\n'));
      return (async function* () {
        yield { type: 'text_delta', text: REPAIR_JSON } as ProviderEvent;
      })();
    },
  };
  return { prompts, verified, provider };
}

function deps(all: Finding[], captured: ReturnType<typeof capture>): AiServiceDeps {
  return {
    keyStore: {
      getKey: () => 'sk-test',
      getConfig: () => ({ configured: true, model: 'm', keyHint: null, migratedFrom: null }),
    } as unknown as KeyStore,
    findings: {
      getByFindingId: () => all[0] ?? null,
      list: () => all,
    } as unknown as FindingsRepository,
    workspace: {
      getCurrent: () => ({ id: 'ws', rootPath: '/root', name: 'p', ignore: [] }),
    } as unknown as WorkspaceService,
    verification: {
      verify: (input) => {
        captured.verified.push({
          startLine: input.target.startLine,
          endLine: input.target.endLine,
        });
        return Promise.resolve({
          report: {
            verdict: 'verified',
            targetResolved: true,
            newFindingCount: 0,
            syntaxOk: true,
            ran: ['syntax'],
          },
          originalCode: 'ORIGINAL',
        });
      },
      dispose: () => undefined,
    } as VerificationService,
    history: { record: () => 'h1' } as unknown as RepairHistoryRepository,
    orchestrator: singleProvider(captured.provider),
    readFile: () => CONTENT,
    microRepair: () => Promise.resolve(null),
  };
}

async function run(all: Finding[], mode?: RepairMode) {
  const captured = capture();
  const service = createAiService(deps(all, captured));
  const result = await service.run(
    mode === undefined
      ? { profile: 'repair', findingId: 'primary' }
      : { profile: 'repair', findingId: 'primary', mode },
    null,
  );
  return { result, ...captured };
}

describe('repair modes — the splice range is the blast radius', () => {
  it('finding (the default) keeps the resolved scope and merges nothing', async () => {
    const { result, prompts, verified } = await run([finding(), inScope, outOfScope]);
    expect(result.status).toBe('ok');
    expect(verified[0]).toEqual({ startLine: 2, endLine: 5 });
    // The in-scope problem is NOT mentioned to the model in the default mode.
    expect(prompts[0]).not.toContain('In-scope problem.');
  });

  it('an absent mode behaves exactly like the old code path — backward compatible', async () => {
    const withMode = await run([finding(), inScope], 'finding');
    const withoutMode = await run([finding(), inScope]);
    expect(withoutMode.verified[0]).toEqual(withMode.verified[0]);
    expect(withoutMode.prompts[0]).toBe(withMode.prompts[0]);
  });

  it('related-scope does NOT widen the patch — same range, more fixed within it', async () => {
    const { result, prompts, verified } = await run(
      [finding(), inScope, outOfScope],
      'related-scope',
    );
    expect(result.status).toBe('ok');
    // The critical assertion: minimality is preserved.
    expect(verified[0]).toEqual({ startLine: 2, endLine: 5 });
    expect(prompts[0]).toContain('In-scope problem.');
    // A problem outside the range cannot be fixed by a patch that does not cover it.
    expect(prompts[0]).not.toContain('Out-of-scope problem.');
  });

  it('related-scope never merges a manual-only finding, even inside the scope', async () => {
    const { prompts } = await run([finding(), manualInScope], 'related-scope');
    // The analyzer already refused this rule; bundling it into a patch would launder that refusal.
    expect(prompts[0]).not.toContain('Manual problem.');
  });

  it('ai-file is the ONLY mode that widens the range, and it covers the whole file', async () => {
    const { result, verified, prompts } = await run([finding(), inScope, outOfScope], 'ai-file');
    expect(result.status).toBe('ok');
    expect(verified[0]).toEqual({ startLine: 1, endLine: 6 });
    // Everything repairable in the file is now in scope, including what was previously outside it.
    expect(prompts[0]).toContain('In-scope problem.');
    expect(prompts[0]).toContain('Out-of-scope problem.');
  });
});

describe('repair summary — what was fixed, merged, and deliberately skipped', () => {
  it('the default mode reports every other problem as skipped, each with a reason', async () => {
    const { result } = await run([finding(), inScope, outOfScope]);
    if (result.status !== 'ok' || result.proposal.profile !== 'repair') throw new Error('expected');
    const summary = result.proposal.repairSummary;
    expect(summary?.fixed.map((e) => e.ruleId)).toEqual(['prefer-const']);
    expect(summary?.related).toEqual([]);
    expect(summary?.skipped).toHaveLength(2);
    for (const entry of summary?.skipped ?? []) {
      expect(entry.reason).toBeDefined();
      expect(entry.reason?.length ?? 0).toBeGreaterThan(10);
    }
  });

  it('related-scope moves the merged problem from skipped into related', async () => {
    const { result } = await run([finding(), inScope, outOfScope], 'related-scope');
    if (result.status !== 'ok' || result.proposal.profile !== 'repair') throw new Error('expected');
    const summary = result.proposal.repairSummary;
    expect(summary?.related.map((e) => e.ruleId)).toEqual(['no-unused-vars']);
    expect(summary?.skipped.map((e) => e.ruleId)).toEqual(['eqeqeq']);
    expect(summary?.skipped[0]?.reason).toMatch(/outside the repair scope/i);
  });

  it('a manual-only skip explains it needs judgment, not that it is out of scope', async () => {
    const { result } = await run([finding(), manualInScope], 'related-scope');
    if (result.status !== 'ok' || result.proposal.profile !== 'repair') throw new Error('expected');
    expect(result.proposal.repairSummary?.skipped[0]?.reason).toMatch(/judgment/i);
  });

  it('the proposal carries its mode so the panel can state the scope it covers', async () => {
    const { result } = await run([finding()], 'ai-file');
    if (result.status !== 'ok' || result.proposal.profile !== 'repair') throw new Error('expected');
    expect(result.proposal.mode).toBe('ai-file');
  });
});
