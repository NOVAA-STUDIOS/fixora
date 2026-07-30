import type { AIProvider, ProviderEvent } from '@fixora/core-ai';
import { UserFacingError, type Finding } from '@fixora/shared-types';
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
  readFile?: () => string;
  finding?: Finding;
  microRepair?: AiServiceDeps['microRepair'];
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
    getByFindingId: () => overrides.finding ?? makeFinding(),
    list: () => [overrides.finding ?? makeFinding()],
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
    readFile: overrides.readFile ?? (() => overrides.fileContent ?? CLEAN_FILE),
    // Real deps route this through the analysis worker (Q2 Fix #2A); the default here answers "no
    // autofix" so tests that don't care about deterministic repair are unaffected.
    microRepair: overrides.microRepair ?? (() => Promise.resolve(null)),
  };
}

function textEvents(text: string): ProviderEvent[] {
  return [{ type: 'text_delta', text }];
}

describe('AI service (BYOK run orchestration)', () => {
  it('refuses with no_key when no key is configured', async () => {
    const service = createAiService(deps({ hasKey: false, provider: scriptedProvider([[]]) }));
    const result = await service.run({ profile: 'explain', findingId: 'find-1' }, null);
    // A missing key is a CONFIGURATION failure, and it carries a card: it is the failure the panel
    // can resolve most directly, and a bare sentence left the user with nothing to click.
    expect(result).toEqual({
      status: 'error',
      code: 'no_key',
      message: expect.any(String),
      failure: {
        category: 'invalid-api-key',
        layer: 'configuration',
        actions: ['open-settings'],
        provider: 'OpenRouter',
        model: expect.any(String),
      },
    });
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

  // Bug-fix sprint, Phase 1: `languageFor`'s extension map used to be missing `json`/`pyi`, so a
  // `.json` finding (the Analyzer's own `JsonAnalyzer` produces real findings for `.json` files, and
  // `repair-eligibility.ts`'s `REPAIRABLE_LANGUAGES` already listed `json` as repairable) was
  // rejected here as "unsupported" before eligibility was even consulted.
  it('no longer rejects a .json finding as an unsupported file type', async () => {
    const jsonFinding: Finding = {
      ...makeFinding(),
      location: { file: 'src/config.json', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      repair: 'ai-required',
    };
    const explanation = 'This key is misspelled.';
    const service = createAiService(
      deps({ finding: jsonFinding, provider: scriptedProvider([textEvents(explanation)]) }),
    );
    const result = await service.run({ profile: 'explain', findingId: 'find-1' }, null);
    expect(result).toEqual({
      status: 'ok',
      proposal: { profile: 'explain', explanation },
    });
  });

  it('reports a genuinely unsupported file type with the same friendly wording Proceed uses', async () => {
    const rubyFinding: Finding = {
      ...makeFinding(),
      location: { file: 'src/thing.rb', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    };
    const service = createAiService(deps({ finding: rubyFinding, provider: scriptedProvider([]) }));
    const result = await service.run({ profile: 'explain', findingId: 'find-1' }, null);
    expect(result).toEqual({
      status: 'error',
      code: 'not_found',
      message: "This file type isn't supported for AI actions yet.",
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

  // Q2 Fix #2A: deterministic (`safe-auto`) repair routing. A tool-authored autofix (ESLint's `fix`,
  // Ruff's edits) needs no model — `evaluateRepairEligibility` already computes `method:
  // 'deterministic'` for it. Fix #2 proved a DIRECT import of `deterministicRepair`
  // (`@fixora/core-analysis`, pure ESM + tree-sitter/WASM) into this CJS main process crashes the app
  // (`require()` on an ESM package throws `ERR_REQUIRE_ESM` — confirmed via a real `electron-vite
  // build`). Fix #2A instead routes through the SAME worker-boundary seam `resolveScope` uses
  // (`AiServiceDeps.microRepair`, backed in production by `AnalysisHost.microRepair` → the worker's
  // own `deterministicRepair` call) — never duplicated here.
  describe('deterministic (safe-auto) repair', () => {
    function deterministicFinding(): Finding {
      const target = "'hi ' + name";
      const start = CLEAN_FILE.indexOf(target);
      return {
        ...makeFinding(),
        repair: 'safe-auto',
        fixable: true,
        autofix: {
          source: 'eslint',
          edits: [{ range: [start, start + target.length], text: '`hi ${name}`' }],
        },
      };
    }

    function noProviderCall(): { provider: AIProvider; called: () => boolean } {
      let called = false;
      return {
        called: () => called,
        provider: {
          id: 'fake',
          capabilities: { structuredOutput: true, maxContext: 100 },
          stream() {
            called = true;
            return (async function* () {})();
          },
        },
      };
    }

    it('executes through the injected worker seam and never calls the AI provider', async () => {
      const { provider, called } = noProviderCall();
      const finding = deterministicFinding();
      const microRepairCalls: unknown[] = [];
      const service = createAiService(
        deps({
          provider,
          finding,
          microRepair: (input) => {
            microRepairCalls.push(input);
            return Promise.resolve({
              patched: 'export function greet(name: string): string {\n  return `hi ${name}`;\n}\n',
              edits: finding.autofix?.edits ?? [],
              parseOk: true,
              source: 'eslint',
            });
          },
        }),
      );
      const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);

      expect(called()).toBe(false); // provider call count = 0
      expect(microRepairCalls).toEqual([
        {
          finding,
          source: CLEAN_FILE,
          language: 'typescript',
          filePath: 'src/greet.ts',
        },
      ]);
      expect(result.status).toBe('ok');
      if (result.status !== 'ok' || result.proposal.profile !== 'repair')
        throw new Error('expected repair');
      expect(result.proposal.repairedCode).toContain('`hi ${name}`');
      expect(result.proposal.confidence).toBe(1);
    });

    it('routes the repaired code through the SAME verification gate the AI path uses', async () => {
      const { provider } = noProviderCall();
      const verifyCalls: unknown[] = [];
      const patched = 'export function greet(name: string): string {\n  return `hi ${name}`;\n}\n';
      const withSpy = deps({
        provider,
        finding: deterministicFinding(),
        microRepair: () =>
          Promise.resolve({ patched, edits: [], parseOk: true, source: 'eslint' as const }),
      });
      const realVerify = withSpy.verification.verify.bind(withSpy.verification);
      withSpy.verification.verify = (input) => {
        verifyCalls.push(input);
        return realVerify(input);
      };
      const service = createAiService(withSpy);
      const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);

      expect(verifyCalls).toHaveLength(1); // never skipped
      expect((verifyCalls[0] as { repairedCode: string }).repairedCode).toBe(patched);
      expect(result.status).toBe('ok');
      if (result.status !== 'ok' || result.proposal.profile !== 'repair')
        throw new Error('expected repair');
      expect(result.proposal.verification.verdict).toBe('verified');
    });

    it('a regression verdict is carried through, never silently upgraded to verified', async () => {
      const { provider } = noProviderCall();
      const regressingDeps = deps({
        provider,
        finding: deterministicFinding(),
        microRepair: () =>
          Promise.resolve({
            patched: 'export function greet(name: string): string {\n  return `hi ${name}`;\n}\n',
            edits: [],
            parseOk: true,
            source: 'eslint',
          }),
      });
      regressingDeps.verification.verify = () =>
        Promise.resolve({
          report: {
            verdict: 'regression',
            targetResolved: true,
            newFindingCount: 1,
            syntaxOk: true,
            ran: ['syntax', 'eslint'],
            note: 'The edit introduces 1 new problem(s).',
          },
          originalCode: 'ORIGINAL_SYMBOL_TEXT',
        });
      const service = createAiService(regressingDeps);
      const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);
      // Still `status: 'ok'` — same contract the AI path uses (ai-panel.tsx's client-side apply gate
      // disables Apply on a regression verdict; the service never fabricates a passing verdict).
      expect(result.status).toBe('ok');
      if (result.status !== 'ok' || result.proposal.profile !== 'repair')
        throw new Error('expected repair');
      expect(result.proposal.verification.verdict).toBe('regression');
    });

    it('a null result (edits could not be applied) is a typed failure, never falls through to AI', async () => {
      const { provider, called } = noProviderCall();
      const service = createAiService(
        deps({
          provider,
          finding: deterministicFinding(),
          microRepair: () => Promise.resolve(null),
        }),
      );
      const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);
      expect(called()).toBe(false);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('not_found');
        expect(result.message).toContain('could not be applied safely');
      }
    });

    it('a patch that fails the parser gate (parseOk: false) is a typed failure, never applied', async () => {
      const { provider, called } = noProviderCall();
      const service = createAiService(
        deps({
          provider,
          finding: deterministicFinding(),
          microRepair: () =>
            Promise.resolve({
              patched: 'export function greet(',
              edits: [],
              parseOk: false,
              source: 'eslint',
            }),
        }),
      );
      const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);
      expect(called()).toBe(false);
      expect(result.status).toBe('error');
      if (result.status === 'error') expect(result.code).toBe('not_found');
    });

    it('a worker failure (rejected promise — timeout/crash) is a typed failure, not a throw or a fallback to AI', async () => {
      const { provider, called } = noProviderCall();
      const service = createAiService(
        deps({
          provider,
          finding: deterministicFinding(),
          microRepair: () => Promise.reject(new Error('Deterministic repair timed out.')),
        }),
      );
      const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);
      expect(called()).toBe(false);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('not_found');
        expect(result.message.toLowerCase()).not.toContain('internal error');
      }
    });
  });

  it('refuses a manual-only finding BEFORE any provider call, with the precise reason (P0.1 Part 2)', async () => {
    let called = false;
    const provider: AIProvider = {
      id: 'fake',
      capabilities: { structuredOutput: true, maxContext: 100 },
      stream() {
        called = true;
        return (async function* () {})();
      },
    };
    const manual: Finding = { ...makeFinding(), ruleId: 'TS2304', repair: 'manual' };
    const service = createAiService(deps({ provider, finding: manual }));
    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toContain('TS2304');
      expect(result.message.toLowerCase()).not.toContain('internal error');
    }
    expect(called).toBe(false); // eligibility short-circuits before the model
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

  // Q2 (Repair Reliability): `retryable` used to be computed by the shared `describeProviderFailure`
  // classifier and then thrown away here — Proceed exposed it (P2.2.1), Repair didn't, so the same
  // 429 offered a Retry affordance in one panel and not the other. These pin that the classifier's
  // `retryable` verdict now survives all the way out to `AiRunResponse`, for both directions.
  it('a retryable provider failure (429) carries retryable: true through to AiRunResponse', async () => {
    const provider = scriptedProvider([
      [{ type: 'error', retryable: true, providerCode: 'HTTP_429', message: 'rate limited' }],
    ]);
    const service = createAiService(deps({ provider }));
    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);
    expect(result).toMatchObject({ status: 'error', code: 'provider_error', retryable: true });
  });

  it('a non-retryable provider failure (401) carries retryable: false through to AiRunResponse', async () => {
    const provider = scriptedProvider([
      [{ type: 'error', retryable: false, providerCode: 'HTTP_401', message: 'bad key' }],
    ]);
    const service = createAiService(deps({ provider }));
    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);
    expect(result).toMatchObject({ status: 'error', code: 'provider_error', retryable: false });
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

  /**
   * P0 regression: a file deleted/renamed/locked between analysis and repair. The fs layer authors a
   * precise reason; the service must surface THAT, not the old vague "Could not read the file." and
   * never a generic "internal error". This is the "explain exactly why it cannot be repaired" contract.
   */
  it('surfaces the authored fs reason when the target file cannot be read (not a generic message)', async () => {
    const authored = new UserFacingError(
      'src/a.ts no longer exists. It was probably moved, renamed or deleted since the project was analyzed — re-run analysis to refresh.',
      { code: 'fs_not_found', action: { type: 'none', label: 'Dismiss' } },
    );
    const service = createAiService(
      deps({
        provider: scriptedProvider([[]]),
        readFile: () => {
          throw authored;
        },
      }),
    );
    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toBe(authored.message); // the precise reason, verbatim
      expect(result.message).not.toContain('Could not read the file');
      expect(result.message.toLowerCase()).not.toContain('internal error');
    }
  });

  it('still gives an actionable message when a non-authored read error occurs', async () => {
    const service = createAiService(
      deps({
        provider: scriptedProvider([[]]),
        readFile: () => {
          throw new Error('EIO: i/o error');
        },
      }),
    );
    const result = await service.run({ profile: 'explain', findingId: 'find-1' }, null);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toContain('re-run analysis'); // recovery guidance
      expect(result.message.toLowerCase()).not.toContain('internal error');
    }
  });
});
