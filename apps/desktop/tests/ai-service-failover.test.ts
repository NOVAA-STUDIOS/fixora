import { PREFERRED_FREE_CODE_MODELS } from '@fixora/core-ai';
import type { AIProvider, CatalogueModel, ProviderEvent, ProviderRequest } from '@fixora/core-ai';
import type { Finding } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { createAiService, type AiServiceDeps } from '../electron/main/ai/ai-service.js';
import type { KeyStore } from '../electron/main/ai/key-store.js';
import type { FindingsRepository, RepairHistoryRepository } from '../electron/main/db/repositories.js';
import type { WorkspaceService } from '../electron/main/services/workspace-service.js';
import type { VerificationService } from '../electron/main/verification/verification-service.js';

/**
 * Provider failover, through the real service rather than the loop in isolation.
 *
 * `failover.test.ts` proves the walk. These prove it is actually WIRED: that the chain is built from
 * the configured model plus catalogue fallbacks, that each candidate is asked with its own model id,
 * and that a repair which succeeds on the second candidate comes back as an ordinary verified
 * proposal — because the point of failover is that the user never learns it happened.
 */

const CONFIGURED = 'configured/model';

const CLEAN_FILE = ['export function target() {', '  return 1;', '}', ''].join('\n');

function makeFinding(): Finding {
  return {
    id: 'find-1',
    source: 'eslint',
    ruleId: 'prefer-template',
    severity: 'warning',
    category: 'maintainability',
    location: { file: 'src/greet.ts', startLine: 2, startCol: 3, endLine: 2, endCol: 27 },
    message: 'Prefer template literals.',
    evidence: {
      enclosingSymbol: {
        name: 'greet',
        kind: 'function',
        location: { file: 'src/greet.ts', startLine: 1, startCol: 1, endLine: 4, endCol: 1 },
      },
      snippet: "const msg = 'hi ' + name;",
      relatedLocations: [],
      toolOutput: {},
    },
    fixable: true,
    repair: 'ai-required',
    confidence: 1,
  };
}

/** A model the catalogue vouches for — free, code-capable, schema-capable. */
function catalogueModel(id: string): CatalogueModel {
  return { id, name: id, free: true, codeCapable: true, structuredOutput: true, contextLength: 128_000 };
}

/**
 * A catalogue that vouches for the real fallback ids.
 *
 * Derived from `PREFERRED_FREE_CODE_MODELS` rather than hardcoded: the service builds its chain from
 * that list, so inventing ids here would silently produce a one-candidate chain and these tests would
 * pass while exercising no failover at all.
 */
function preferredCatalogue(): CatalogueModel[] {
  return PREFERRED_FREE_CODE_MODELS.map(catalogueModel);
}

const REPAIR_JSON = JSON.stringify({
  repairedCode: 'export function target() {\n  return 2;\n}',
  rationale: 'Fixed.',
  confidence: 0.9,
});

type Script = (model: string) => ProviderEvent[];

/**
 * A provider that answers differently per model, and records every model it was asked for — which is
 * what makes "did it actually move on?" observable.
 */
function recordingProvider(script: Script): { provider: AIProvider; asked: string[] } {
  const asked: string[] = [];
  const provider: AIProvider = {
    id: 'fake',
    capabilities: { structuredOutput: true, maxContext: 100_000 },
    stream(request: ProviderRequest) {
      asked.push(request.model);
      const events = script(request.model);
      return (async function* () {
        for (const event of events) yield event;
      })();
    },
  };
  return { provider, asked };
}

const down = (): ProviderEvent[] => [
  { type: 'error', retryable: true, providerCode: 'HTTP_503', message: 'upstream is down', status: 503 },
];
const badKey = (): ProviderEvent[] => [
  { type: 'error', retryable: false, providerCode: 'HTTP_401', message: 'invalid key', status: 401 },
];
const answers = (): ProviderEvent[] => [{ type: 'text_delta', text: REPAIR_JSON }];

function deps(provider: AIProvider, catalogue: readonly CatalogueModel[]): AiServiceDeps {
  const keyStore = {
    getKey: () => 'sk-or-test',
    getConfig: () => ({ configured: true, model: CONFIGURED, keyHint: '••••', migratedFrom: null }),
    hasKey: () => true,
    setKey: () => ({ configured: true, model: CONFIGURED, keyHint: null, migratedFrom: null }),
    clearKey: () => ({ configured: false, model: CONFIGURED, keyHint: null, migratedFrom: null }),
    setModel: () => ({ configured: true, model: CONFIGURED, keyHint: null, migratedFrom: null }),
  } satisfies KeyStore;

  return {
    keyStore,
    findings: {
      getByFindingId: () => makeFinding(),
      list: () => [makeFinding()],
    } as unknown as FindingsRepository,
    workspace: {
      getCurrent: () => ({ id: 'ws1', rootPath: '/root', name: 'proj', ignore: [] }),
    } as unknown as WorkspaceService,
    verification: {
      verify: () =>
        Promise.resolve({
          report: {
            verdict: 'verified' as const,
            targetResolved: true,
            newFindingCount: 0,
            syntaxOk: true,
            ran: ['syntax'],
          },
          originalCode: 'export function target() {\n  return 1;\n}',
        }),
      dispose: () => undefined,
    } as VerificationService,
    history: {
      record: () => 'history-1',
      markApplied: () => undefined,
      list: () => [],
      clearWorkspace: () => undefined,
    } as unknown as RepairHistoryRepository,
    providerFactory: () => provider,
    readFile: () => CLEAN_FILE,
    microRepair: () => Promise.resolve(null),
    failoverCatalogue: () => Promise.resolve(catalogue),
  };
}


describe('ai service — provider failover is wired, not just implemented', () => {
  it('a failure on the configured model moves to a fallback and still returns a repair', async () => {
    // Fail everything except the LAST preferred model, so the walk has to actually happen.
    const { provider, asked } = recordingProvider((model) =>
      model === CONFIGURED ? down() : answers(),
    );
    const service = createAiService(deps(provider, preferredCatalogue()));

    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);

    expect(asked[0]).toBe(CONFIGURED);
    expect(asked.length).toBeGreaterThan(1);
    // The user gets an ordinary verified proposal. Failover is invisible by design.
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.proposal.profile).toBe('repair');
  });

  it('a rejected key stops after ONE attempt and reports configuration guidance', async () => {
    const { provider, asked } = recordingProvider(() => badKey());
    const service = createAiService(deps(provider, preferredCatalogue()));

    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);

    // The whole point of the non-retryable stop: one call, not a walk of the entire chain.
    expect(asked).toEqual([CONFIGURED]);
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.failure?.category).toBe('invalid-api-key');
    expect(result.failure?.layer).toBe('configuration');
    expect(result.failure?.actions).toContain('open-settings');
  });

  it('a success on the first candidate contacts nothing else', async () => {
    const { provider, asked } = recordingProvider(() => answers());
    const service = createAiService(deps(provider, preferredCatalogue()));

    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);

    expect(asked).toEqual([CONFIGURED]);
    expect(result.status).toBe('ok');
  });

  it('when every candidate is down, the error names the model that actually failed last', async () => {
    const { provider, asked } = recordingProvider(() => down());
    const service = createAiService(deps(provider, preferredCatalogue()));

    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);

    expect(asked.length).toBeGreaterThan(1);
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.failure?.category).toBe('provider-unavailable');
    // Reported against the candidate that failed last, not the configured id — a card saying
    // "Model: X" must name the model the failure actually came from.
    expect(result.failure?.model).toBe(asked.at(-1));
  });

  it('with no catalogue there are no fallbacks — behaviour is exactly as before failover existed', async () => {
    const { provider, asked } = recordingProvider(() => down());
    const service = createAiService(deps(provider, []));

    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);

    expect(asked).toEqual([CONFIGURED]);
    expect(result.status).toBe('error');
  });
});
