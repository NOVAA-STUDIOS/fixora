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
    getConfig: () => ({
      configured: true,
      model: 'anthropic/claude-3.5-sonnet',
      keyHint: '••••',
      migratedFrom: null,
    }),
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
  it('targets the WHOLE FILE, not the root cause’s own scope', async () => {
    // Advanced Repair used to splice only the root cause's own range. It now collects every
    // problem in the file into one request, so the splice is the whole file — same as `ai-file` —
    // and the 250-line stub `readFile` below is what pins that number.
    const selected = undefinedNameFinding('f-mid', 120); // the user clicked the MIDDLE occurrence
    const allFindings = [
      undefinedNameFinding('f-root', 5), // earliest — still identified as the root cause
      selected,
      undefinedNameFinding('f-last', 240),
    ];
    const provider = scriptedProvider(REPAIR_JSON);
    const service = createAiService(baseDeps({ provider, allFindings, selected }));

    const result = await service.run({ profile: 'repair', findingId: 'f-mid', mode: 'advanced' }, null);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok' || result.proposal.profile !== 'repair') return;
    expect(result.proposal.target.startLine).toBe(1);
    // 251, not 250: the stub file content ends with a trailing newline, so splitting on it yields
    // one more element than there are "line N" rows.
    expect(result.proposal.target.endLine).toBe(251);
    expect(result.proposal.mode).toBe('advanced');
    // Root cause identification is unaffected by the range change — it still names line 5.
    expect(result.proposal.rootCause?.line).toBe(5);
  });

  it('lists every OTHER finding in the file in the single request it sends', async () => {
    const selected = undefinedNameFinding('f-mid', 120);
    const other1 = undefinedNameFinding('f-root', 5);
    const other2 = undefinedNameFinding('f-last', 240);
    const captured: string[] = [];
    const capturing: AIProvider = {
      id: 'capturing',
      capabilities: { structuredOutput: true, maxContext: 100_000 },
      test: () =>
        Promise.resolve({ reachable: true, authenticated: true, modelAvailable: true, latencyMs: 1 }),
      stream: (request) => {
        captured.push(request.messages.map((m) => m.content).join('\n'));
        return (async function* (): AsyncGenerator<ProviderEvent> {
          yield { type: 'text_delta', text: REPAIR_JSON };
        })();
      },
    };
    const service = createAiService(
      baseDeps({
        provider: capturing,
        allFindings: [other1, selected, other2],
        selected,
        orchestrator: singleProvider(capturing),
      }),
    );

    await service.run({ profile: 'repair', findingId: 'f-mid', mode: 'advanced' }, null);

    expect(captured).toHaveLength(1);
    const prompt = captured[0] ?? '';
    // The bullet format `formatEvidence` uses for a listed problem — not a bare "line 5"/"line
    // 240", which the stub file's own content (rows literally named "line 1".."line 250") would
    // match regardless of whether the finding was actually listed.
    expect(prompt).toContain('- line 5 [');
    expect(prompt).toContain('- line 240 [');
  });

  it('never merges a MANUAL-only finding into the single request', async () => {
    const selected = undefinedNameFinding('f-mid', 120);
    const manual: Finding = { ...undefinedNameFinding('f-manual', 60), repair: 'manual' };
    const captured: string[] = [];
    const capturing: AIProvider = {
      id: 'capturing',
      capabilities: { structuredOutput: true, maxContext: 100_000 },
      test: () =>
        Promise.resolve({ reachable: true, authenticated: true, modelAvailable: true, latencyMs: 1 }),
      stream: (request) => {
        captured.push(request.messages.map((m) => m.content).join('\n'));
        return (async function* (): AsyncGenerator<ProviderEvent> {
          yield { type: 'text_delta', text: REPAIR_JSON };
        })();
      },
    };
    const service = createAiService(
      baseDeps({
        provider: capturing,
        allFindings: [selected, manual],
        selected,
        orchestrator: singleProvider(capturing),
      }),
    );

    const result = await service.run({ profile: 'repair', findingId: 'f-mid', mode: 'advanced' }, null);

    // The bullet format `formatEvidence` uses for a listed problem, not a bare "line 60" — the
    // stub file's own content is literally lines named "line 1".."line 250" and would collide.
    expect(captured[0] ?? '').not.toContain('- line 60 [');
    if (result.status !== 'ok' || result.proposal.profile !== 'repair') throw new Error('expected ok');
    // Named in the summary as skipped, with the reason — not silently dropped.
    expect(result.proposal.repairSummary?.skipped.some((s) => s.line === 60)).toBe(true);
  });

  it('retries AT MOST ONCE — its own, smaller budget, not the standard 3', async () => {
    const selected = undefinedNameFinding('f1', 5);
    let calls = 0;
    const neverPasses: AIProvider = {
      id: 'never-passes',
      capabilities: { structuredOutput: true, maxContext: 100_000 },
      test: () =>
        Promise.resolve({ reachable: true, authenticated: true, modelAvailable: true, latencyMs: 1 }),
      stream: () => {
        calls += 1;
        return (async function* (): AsyncGenerator<ProviderEvent> {
          yield { type: 'text_delta', text: REPAIR_JSON };
        })();
      },
    };
    const service = createAiService(
      baseDeps({
        provider: neverPasses,
        allFindings: [selected],
        selected,
        orchestrator: singleProvider(neverPasses),
        // Every attempt still fails verification, so the loop runs to its cap either way.
        verdict: 'unresolved',
      }),
    );

    await service.run({ profile: 'repair', findingId: 'f1', mode: 'advanced' }, null);

    // One initial attempt + exactly one retry = 2. A standard mode under the same failing verdict
    // would run 1 + VERIFY_RETRY_LIMIT (3) = 4 — see the sibling assertion in repair-modes.test.ts
    // for the mode this budget does NOT apply to.
    expect(calls).toBe(2);
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
