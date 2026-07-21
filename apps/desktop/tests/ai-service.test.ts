import type { AIProvider, ProviderEvent } from '@fixora/core-ai';
import type { Finding } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { createAiService, type AiServiceDeps } from '../electron/main/ai/ai-service.js';
import type { KeyStore } from '../electron/main/ai/key-store.js';
import type {
  FindingsRepository,
  RepairHistoryRepository,
} from '../electron/main/db/repositories.js';
import type { WorkspaceService } from '../electron/main/services/workspace-service.js';
import type { VerificationService } from '../electron/main/verification/verification-service.js';

const CLEAN_FILE = `export function greet(name: string): string {
  const msg = 'hi ' + name;
  return msg;
}
`;

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

function scriptedProvider(scripts: ProviderEvent[][]): AIProvider {
  let call = 0;
  return {
    id: 'fake',
    capabilities: { structuredOutput: true, maxContext: 100_000 },
    stream(_request, _signal) {
      const events = scripts[Math.min(call, scripts.length - 1)] ?? [];
      call += 1;
      return (async function* () {
        for (const event of events) yield event;
      })();
    },
  };
}

function deps(overrides: {
  fileContent?: string;
  hasKey?: boolean;
  provider: AIProvider;
}): AiServiceDeps {
  const keyStore = {
    getKey: () => (overrides.hasKey === false ? null : 'sk-or-test'),
    getConfig: () => ({
      configured: true,
      model: 'anthropic/claude-3.5-sonnet',
      keyHint: '••••',
      migratedFrom: null,
    }),
    hasKey: () => overrides.hasKey !== false,
    setKey: () => ({ configured: true, model: 'm', keyHint: null, migratedFrom: null }),
    clearKey: () => ({ configured: false, model: 'm', keyHint: null, migratedFrom: null }),
    setModel: () => ({ configured: true, model: 'm', keyHint: null, migratedFrom: null }),
  } satisfies KeyStore;

  const findings = {
    getByFindingId: () => makeFinding(),
    list: () => [makeFinding()],
  } as unknown as FindingsRepository;

  const workspace = {
    getCurrent: () => ({ id: 'ws1', rootPath: '/root', name: 'proj', ignore: [] }),
  } as unknown as WorkspaceService;

  const verification: VerificationService = {
    verify: () =>
      Promise.resolve({
        report: {
          verdict: 'verified',
          targetResolved: true,
          newFindingCount: 0,
          syntaxOk: true,
          ran: ['syntax', 'eslint'],
        },
        originalCode: 'ORIGINAL_SYMBOL_TEXT',
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
    providerFactory: () => overrides.provider,
    readFile: () => overrides.fileContent ?? CLEAN_FILE,
  };
}

function textEvents(text: string): ProviderEvent[] {
  return [{ type: 'text_delta', text }];
}

describe('AI service (BYOK run orchestration)', () => {
  it('refuses with no_key when no key is configured', async () => {
    const service = createAiService(deps({ hasKey: false, provider: scriptedProvider([[]]) }));
    const result = await service.run({ profile: 'explain', findingId: 'find-1' }, null);
    expect(result).toEqual({ status: 'error', code: 'no_key', message: expect.any(String) });
  });

  it('runs an explain and returns the streamed prose', async () => {
    const provider = scriptedProvider([[...textEvents('The '), ...textEvents('concatenation…')]]);
    const service = createAiService(deps({ provider }));
    const result = await service.run({ profile: 'explain', findingId: 'find-1' }, null);
    expect(result).toEqual({
      status: 'ok',
      proposal: { profile: 'explain', explanation: 'The concatenation…' },
    });
  });

  it('runs a repair and grounds the target on the finding’s enclosing symbol', async () => {
    const json = JSON.stringify({
      repairedCode: 'export function greet(name: string): string {\n  return `hi ${name}`;\n}',
      rationale: 'Template literal.',
      confidence: 0.92,
    });
    const service = createAiService(deps({ provider: scriptedProvider([textEvents(json)]) }));
    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok' || result.proposal.profile !== 'repair')
      throw new Error('expected repair');
    expect(result.proposal.confidence).toBe(0.92);
    expect(result.proposal.target).toEqual({
      file: 'src/greet.ts',
      startLine: 1,
      endLine: 4,
      symbolName: 'greet',
    });
    // The proposal already carries its verification verdict (ADR-003) and a history id (Phase E).
    expect(result.proposal.verification.verdict).toBe('verified');
    expect(result.proposal.originalCode).toBe('ORIGINAL_SYMBOL_TEXT');
    expect(result.proposal.historyId).toBe('history-1');
  });

  it('BLOCKS at the gate when the target file contains a secret — no provider call', async () => {
    const withSecret =
      'export function greet() {\n  const k = "AKIAIOSFODNN7EXAMPLE";\n  return k;\n}';
    let called = false;
    const provider: AIProvider = {
      id: 'fake',
      capabilities: { structuredOutput: true, maxContext: 100 },
      stream() {
        called = true;
        return (async function* () {})();
      },
    };
    const service = createAiService(deps({ provider, fileContent: withSecret }));
    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') throw new Error('expected blocked');
    expect(result.matches.some((m) => m.rule === 'aws-access-key-id')).toBe(true);
    expect(called).toBe(false); // the provider was never invoked
  });

  it('surfaces a provider error as a typed value', async () => {
    const provider = scriptedProvider([
      [{ type: 'error', retryable: true, providerCode: 'HTTP_429', message: 'rate limited' }],
    ]);
    const service = createAiService(deps({ provider }));
    const result = await service.run({ profile: 'explain', findingId: 'find-1' }, null);
    expect(result).toMatchObject({ status: 'error', code: 'provider_error' });
  });

  it('re-asks once on a schema violation, then succeeds', async () => {
    const bad = textEvents('sorry, here is the fix in prose');
    const good = textEvents(
      JSON.stringify({ repairedCode: 'return `hi`;', rationale: 'x', confidence: 0.5 }),
    );
    const service = createAiService(deps({ provider: scriptedProvider([bad, good]) }));
    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);
    expect(result.status).toBe('ok');
  });

  it('fails typed after a re-ask that still violates the schema', async () => {
    const bad = textEvents('still not json');
    const service = createAiService(deps({ provider: scriptedProvider([bad, bad]) }));
    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);
    expect(result).toMatchObject({ status: 'error', code: 'schema_error' });
  });
});
