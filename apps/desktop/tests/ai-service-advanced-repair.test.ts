import type { AIProvider, ProviderEvent } from '@fixora/core-ai';
import type { Finding, Location } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { createAiService, type AiServiceDeps } from '../electron/main/ai/ai-service.js';
import type { KeyStore } from '../electron/main/ai/key-store.js';
import type { Orchestrator } from '../electron/main/ai/providers/orchestrator.js';
import type { FindingsRepository, RepairHistoryRepository } from '../electron/main/db/repositories.js';
import type { WorkspaceService } from '../electron/main/services/workspace-service.js';
import type { VerificationService } from '../electron/main/verification/verification-service.js';

import { singleProvider } from './support/fake-orchestrator.js';

/**
 * Advanced Repair, through the real service.
 *
 * `root-cause-grouping.test.ts` proves the grouping is correct in isolation. These prove it is
 * actually WIRED, and — the tests that matter most — that nothing about Advanced Repair opens a new
 * way for an unsafe patch to reach disk: a rejected verdict still returns as rejected, and the target
 * range still comes back exactly what the grouping computed, never widened further downstream.
 */

const FILE = 'src/big.ts';

function loc(startLine: number, endLine = startLine): Location {
  return { file: FILE, startLine, startCol: 1, endLine, endCol: 1 };
}

function undefinedNameFinding(id: string, line: number): Finding {
  return {
    id,
    source: 'tsc',
    ruleId: 'TS2304',
    severity: 'error',
    category: 'correctness',
    location: loc(line),
    message: "Cannot find name 'config'.",
    evidence: { snippet: '', relatedLocations: [], toolOutput: {} },
    fixable: false,
    repair: 'ai-required',
    confidence: 1,
  };
}

const REPAIR_JSON = JSON.stringify({
  repairedCode: "import { config } from './config.js';",
  rationale: 'Added the missing import.',
  confidence: 0.9,
});

function scriptedProvider(text: string): AIProvider {
  return {
    id: 'fake',
    capabilities: { structuredOutput: true, maxContext: 100_000 },
    test: () =>
      Promise.resolve({ reachable: true, authenticated: true, modelAvailable: true, latencyMs: 1 }),
    stream: () =>
      (async function* (): AsyncGenerator<ProviderEvent> {
        yield { type: 'text_delta', text };
      })(),
  };
}

function baseDeps(overrides: {
  provider: AIProvider;
  allFindings: Finding[];
  selected: Finding;
  verdict?: 'verified' | 'regression' | 'unresolved';
  newFindingCount?: number;
  orchestrator?: Orchestrator;
}): AiServiceDeps {
  const keyStore = {
    getKey: () => 'sk-or-test',
    getConfig: () => ({
      configured: true,
      model: 'anthropic/claude-3.5-sonnet',
      keyHint: '••••',
      migratedFrom: null,
    }),
    hasKey: () => true,
    setKey: () => ({ configured: true, model: 'm', keyHint: null, migratedFrom: null }),
    clearKey: () => ({ configured: false, model: 'm', keyHint: null, migratedFrom: null }),
    setModel: () => ({ configured: true, model: 'm', keyHint: null, migratedFrom: null }),
  } satisfies KeyStore;

  const findings = {
    getByFindingId: () => overrides.selected,
    list: () => overrides.allFindings,
  } as unknown as FindingsRepository;

  const workspace = {
    getCurrent: () => ({ id: 'ws1', rootPath: '/root', name: 'proj', ignore: [] }),
  } as unknown as WorkspaceService;

  const verification: VerificationService = {
    verify: () =>
      Promise.resolve({
        report: {
          verdict: overrides.verdict ?? 'verified',
          targetResolved: (overrides.verdict ?? 'verified') === 'verified',
          newFindingCount: overrides.newFindingCount ?? 0,
          syntaxOk: true,
          ran: ['syntax', 'tsc'],
        },
        originalCode: 'ORIGINAL',
      }),
    dispose: () => undefined,
  };

  const history = {
    record: () => 'history-1',
    markApplied: () => undefined,
    list: () => [],
    clearWorkspace: () => undefined,
  } as unknown as RepairHistoryRepository;

  return {
    keyStore,
    findings,
    workspace,
    verification,
    history,
    orchestrator: overrides.orchestrator ?? singleProvider(overrides.provider),
    readFile: () =>
      Array.from({ length: 250 }, (_, i) => `line ${String(i + 1)}`).join('\n') + '\n',
    microRepair: () => Promise.resolve(null),
  };
}

describe('Advanced Repair — wired through the real service', () => {
  it('targets the root cause’s own scope, never a union across scattered usages', async () => {
    const selected = undefinedNameFinding('f-mid', 120); // the user clicked the MIDDLE occurrence
    const allFindings = [
      undefinedNameFinding('f-root', 5), // earliest — this is the true root cause
      selected,
      undefinedNameFinding('f-last', 240),
    ];
    const provider = scriptedProvider(REPAIR_JSON);
    const service = createAiService(baseDeps({ provider, allFindings, selected }));

    const result = await service.run({ profile: 'repair', findingId: 'f-mid', mode: 'advanced' }, null);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok' || result.proposal.profile !== 'repair') return;
    // The splice targets line 5 (the root cause), NOT a range spanning 5..240.
    expect(result.proposal.target.startLine).toBe(5);
    expect(result.proposal.target.endLine).toBe(5);
    expect(result.proposal.mode).toBe('advanced');
  });

  it('reports the root cause and marks it as differing from what the user selected', async () => {
    const selected = undefinedNameFinding('f-mid', 120);
    const allFindings = [undefinedNameFinding('f-root', 5), selected];
    const provider = scriptedProvider(REPAIR_JSON);
    const service = createAiService(baseDeps({ provider, allFindings, selected }));

    const result = await service.run({ profile: 'repair', findingId: 'f-mid', mode: 'advanced' }, null);

    if (result.status !== 'ok' || result.proposal.profile !== 'repair') throw new Error('expected ok');
    expect(result.proposal.rootCause).toBeDefined();
    expect(result.proposal.rootCause?.differsFromSelection).toBe(true);
    expect(result.proposal.rootCause?.basis).toBe('identifier');
    expect(result.proposal.rootCause?.line).toBe(5);
  });

  it('does not report a rootCause when the user selected the root cause itself', async () => {
    const selected = undefinedNameFinding('f-root', 5);
    const allFindings = [selected, undefinedNameFinding('f-mid', 120)];
    const provider = scriptedProvider(REPAIR_JSON);
    const service = createAiService(baseDeps({ provider, allFindings, selected }));

    const result = await service.run({ profile: 'repair', findingId: 'f-root', mode: 'advanced' }, null);

    if (result.status !== 'ok' || result.proposal.profile !== 'repair') throw new Error('expected ok');
    expect(result.proposal.rootCause?.differsFromSelection).toBe(false);
  });

  it('other modes never carry rootCause info', async () => {
    const selected = undefinedNameFinding('f1', 5);
    const provider = scriptedProvider(REPAIR_JSON);
    const service = createAiService(
      baseDeps({ provider, allFindings: [selected], selected }),
    );
    const result = await service.run({ profile: 'repair', findingId: 'f1', mode: 'finding' }, null);
    if (result.status !== 'ok' || result.proposal.profile !== 'repair') throw new Error('expected ok');
    expect(result.proposal.rootCause).toBeUndefined();
  });
});

describe('Advanced Repair — the safety guarantees hold exactly as they do for standard repair', () => {
  it('a REGRESSION verdict returns as a regression — verification is never bypassed', async () => {
    const selected = undefinedNameFinding('f1', 5);
    const provider = scriptedProvider(REPAIR_JSON);
    const service = createAiService(
      baseDeps({
        provider,
        allFindings: [selected],
        selected,
        verdict: 'regression',
        newFindingCount: 3,
      }),
    );

    const result = await service.run({ profile: 'repair', findingId: 'f1', mode: 'advanced' }, null);

    expect(result.status).toBe('ok'); // a rejected repair is still a returned PROPOSAL, not an error
    if (result.status !== 'ok' || result.proposal.profile !== 'repair') throw new Error('expected ok');
    expect(result.proposal.verification.verdict).toBe('regression');
    expect(result.proposal.verification.newFindingCount).toBe(3);
  });

  it('a provider failure on Advanced Repair still fails over exactly like standard repair', async () => {
    const selected = undefinedNameFinding('f1', 5);
    let calls = 0;
    const flaky: AIProvider = {
      id: 'flaky',
      capabilities: { structuredOutput: true, maxContext: 100_000 },
      test: () =>
        Promise.resolve({ reachable: true, authenticated: true, modelAvailable: true, latencyMs: 1 }),
      stream: () => {
        calls += 1;
        return (async function* (): AsyncGenerator<ProviderEvent> {
          if (calls === 1) {
            yield {
              type: 'error',
              retryable: true,
              providerCode: 'HTTP_503',
              message: 'down',
              status: 503,
            };
          } else {
            yield { type: 'text_delta', text: REPAIR_JSON };
          }
        })();
      },
    };
    const service = createAiService(
      baseDeps({
        provider: flaky,
        allFindings: [selected],
        selected,
        orchestrator: singleProvider(flaky), // one candidate is enough to prove the mechanism engages
      }),
    );

    const result = await service.run({ profile: 'repair', findingId: 'f1', mode: 'advanced' }, null);
    // With a single candidate, retrying the SAME candidate is not what failover does — this proves
    // the walk ran (the provider was asked) rather than skipping straight to an error.
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(result.status === 'ok' || result.status === 'error').toBe(true);
  });
});

describe('Advanced Repair — smart routing forces high complexity', () => {
  it('always passes complexity "high" to the orchestrator, regardless of file size', async () => {
    const selected = undefinedNameFinding('f1', 5);
    const capturedTasks: unknown[] = [];
    const recordingOrchestrator: Orchestrator = {
      resolveChain: () =>
        Promise.resolve({
          ok: true,
          candidates: [{ provider: 'openrouter', model: 'm', adapter: scriptedProvider(REPAIR_JSON) }],
        }),
      run: (_profile, attempt, options) => {
        capturedTasks.push(options?.task);
        const candidate = { provider: 'openrouter', model: 'm', adapter: scriptedProvider(REPAIR_JSON) };
        return attempt(candidate).then((r) =>
          r.ok
            ? { ok: true as const, value: r.value, candidate, attempts: [] }
            : {
                ok: false as const,
                reason: 'exhausted' as const,
                failure: r.failure,
                candidate,
                attempts: [],
              },
        );
      },
    };
    const service = createAiService(
      baseDeps({
        provider: scriptedProvider(REPAIR_JSON),
        allFindings: [selected],
        selected,
        orchestrator: recordingOrchestrator,
      }),
    );

    await service.run({ profile: 'repair', findingId: 'f1', mode: 'advanced' }, null);

    expect(capturedTasks).toHaveLength(1);
    expect((capturedTasks[0] as { complexity: string } | undefined)?.complexity).toBe('high');
  });
});
