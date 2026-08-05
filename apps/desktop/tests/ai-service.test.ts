import type { AIProvider, ProviderEvent } from '@fixora/core-ai';
import { UserFacingError, type Finding } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { refusingChain, singleProvider } from './support/fake-orchestrator.js';
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
    // Test Connection is part of the AIProvider contract; a fake that omits it would not be a
    // provider. Answers "healthy" because these tests exercise streaming, not diagnostics.
    test: () =>
      Promise.resolve({ reachable: true, authenticated: true, modelAvailable: true, latencyMs: 1 }),
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
  orchestrator?: AiServiceDeps['orchestrator'];
  readFile?: () => string;
  finding?: Finding;
  microRepair?: AiServiceDeps['microRepair'];
  /** Override the verifier, for the verification-retry tests below. */
  verification?: VerificationService;
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
    verification: overrides.verification ?? verification,
    history,
    orchestrator: overrides.orchestrator ?? singleProvider(overrides.provider),
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
  it('refuses with no_key when the CHAIN has no usable credential', async () => {
    // Decided by the chain, not by the legacy single-slot key store. That store only ever held an
    // OpenRouter key, so gating on it here refused users who had configured a different provider
    // entirely — Repair never reached provider selection.
    const service = createAiService(
      deps({ provider: scriptedProvider([[]]), orchestrator: refusingChain('no-credentials') }),
    );
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
        // Null, not "OpenRouter": nothing was contacted, so there is no provider to name and the
        // card omits the row rather than blaming one that never saw the request.
        provider: null,
        model: null,
        attempts: [],
      },
    });
  });

  it('runs even when the LEGACY key store is empty, if the chain has a credential', async () => {
    /**
     * The regression. `hasKey: false` empties the v1 single-slot store, which is exactly the state
     * of a user who configured their only provider through the Provider Manager — v1 is only ever
     * written by `ai:setKey`, and that writes the OpenRouter slot alone.
     *
     * Repair used to read that store, find nothing, and refuse with "add your key in Settings"
     * without ever consulting the registry. A provider the user had enabled, credentialed and put
     * at the top of the chain could not be reached.
     */
    const provider = scriptedProvider([textEvents('It concatenates.')]);
    const service = createAiService(deps({ hasKey: false, provider }));
    const result = await service.run({ profile: 'explain', findingId: 'find-1' }, null);
    expect(result).toEqual({
      status: 'ok',
      proposal: { profile: 'explain', explanation: 'It concatenates.' },
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
    // Test Connection is part of the AIProvider contract; a fake that omits it would not be a
    // provider. Answers "healthy" because these tests exercise streaming, not diagnostics.
    test: () =>
      Promise.resolve({ reachable: true, authenticated: true, modelAvailable: true, latencyMs: 1 }),
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
    // Test Connection is part of the AIProvider contract; a fake that omits it would not be a
    // provider. Answers "healthy" because these tests exercise streaming, not diagnostics.
    test: () =>
      Promise.resolve({ reachable: true, authenticated: true, modelAvailable: true, latencyMs: 1 }),
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
    // Test Connection is part of the AIProvider contract; a fake that omits it would not be a
    // provider. Answers "healthy" because these tests exercise streaming, not diagnostics.
    test: () =>
      Promise.resolve({ reachable: true, authenticated: true, modelAvailable: true, latencyMs: 1 }),
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

/**
 * Verification retry. A patch that PARSES but fails its gates is re-asked with the verifier's own
 * diagnostic fed back, up to three times, before the panel is handed a dead patch. The gate is not
 * weakened: the LAST attempt's verdict is what the proposal carries, so a repair that never passes
 * still arrives with Apply disabled.
 */
describe('AI service — verification retry', () => {
  const REPAIR = JSON.stringify({
    repairedCode: 'const a = 2;',
    rationale: 'fix',
    confidence: 0.9,
  });

  /** A verifier that fails `failures` times, then verifies. Counts how often it ran. */
  function flakyVerifier(failures: number): VerificationService & { calls: () => number } {
    let calls = 0;
    return {
      calls: () => calls,
      verify: () => {
        calls += 1;
        const failing = calls <= failures;
        return Promise.resolve({
          report: failing
            ? {
                verdict: 'regression' as const,
                targetResolved: true,
                newFindingCount: 1,
                syntaxOk: true,
                ran: ['syntax', 'eslint'],
                newFindings: [
                  { source: 'tsc', ruleId: 'TS2322', line: 3, message: 'Type mismatch.' },
                ],
              }
            : {
                verdict: 'verified' as const,
                targetResolved: true,
                newFindingCount: 0,
                syntaxOk: true,
                ran: ['syntax', 'eslint'],
              },
          originalCode: 'ORIGINAL_SYMBOL_TEXT',
        });
      },
      dispose: () => undefined,
    };
  }

  it('retries a failed verification and returns the attempt that finally passes', async () => {
    const verifier = flakyVerifier(2); // fails twice, verifies on the third
    const provider = scriptedProvider([
      textEvents(REPAIR),
      textEvents(REPAIR),
      textEvents(REPAIR),
    ]);
    const service = createAiService(deps({ provider, verification: verifier }));
    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok' || result.proposal.profile !== 'repair') throw new Error('no repair');
    expect(result.proposal.verification.verdict).toBe('verified');
    expect(verifier.calls()).toBe(3);
  });

  it('gives up after the retry limit and hands back the LAST failing verdict', async () => {
    const verifier = flakyVerifier(Number.MAX_SAFE_INTEGER); // never passes
    const provider = scriptedProvider([
      textEvents(REPAIR),
      textEvents(REPAIR),
      textEvents(REPAIR),
      textEvents(REPAIR),
    ]);
    const service = createAiService(deps({ provider, verification: verifier }));
    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);

    // Still a proposal, not an error: the user sees the diff and the reason Apply is refused.
    expect(result.status).toBe('ok');
    if (result.status !== 'ok' || result.proposal.profile !== 'repair') throw new Error('no repair');
    expect(result.proposal.verification.verdict).toBe('regression');
    // One initial attempt + VERIFY_RETRY_LIMIT (3) retries.
    expect(verifier.calls()).toBe(4);
  });

  it('does not retry a verdict that already passed — no wasted round-trip', async () => {
    const verifier = flakyVerifier(0);
    const service = createAiService(
      deps({ provider: scriptedProvider([textEvents(REPAIR)]), verification: verifier }),
    );
    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);
    expect(result.status).toBe('ok');
    expect(verifier.calls()).toBe(1);
  });

  it('does not retry a `skipped` verdict — a check that never ran is not a failure to correct', async () => {
    let calls = 0;
    const verification: VerificationService = {
      verify: () => {
        calls += 1;
        return Promise.resolve({
          report: {
            verdict: 'skipped' as const,
            targetResolved: false,
            newFindingCount: 0,
            syntaxOk: true,
            ran: [],
          },
          originalCode: 'ORIGINAL_SYMBOL_TEXT',
        });
      },
      dispose: () => undefined,
    };
    const service = createAiService(
      deps({ provider: scriptedProvider([textEvents(REPAIR)]), verification }),
    );
    await service.run({ profile: 'repair', findingId: 'find-1' }, null);
    expect(calls).toBe(1);
  });
});

/**
 * Scope escalation on a dependent verification failure.
 *
 * The production case. The finding is on line 3, so the repair target is line 3, and the model
 * returns `const data = await response.json();` — correct in isolation, and still not compiling,
 * because `response` on line 2 was never awaited. **No possible replacement of line 3 alone
 * compiles**, so the old behaviour was to burn all three verify-retries on an impossible question
 * and hand the user a dead patch.
 *
 * The engine must instead notice that the rejection is attributable to code outside the range, widen
 * the splice to the enclosing function, and regenerate — emitting the prerequisite edit and the
 * original fix together, as one repair, which then passes the SAME verifier.
 */
describe('AI service — dependent failures expand the repair scope', () => {
  const FETCH_FILE = [
    'export async function load(url: string) {',
    '  const response = fetch(url);',
    '  const data = response.json();',
    '  return data;',
    '}',
    '',
  ].join('\n');

  function fetchFinding(): Finding {
    return {
      id: 'find-1',
      source: 'tsc',
      ruleId: 'TS2339',
      severity: 'error',
      category: 'correctness',
      location: { file: 'src/load.ts', startLine: 3, startCol: 3, endLine: 3, endCol: 32 },
      message: "Property 'json' does not exist on type 'Promise<Response>'.",
      evidence: {
        enclosingSymbol: {
          name: 'load',
          kind: 'function',
          location: { file: 'src/load.ts', startLine: 1, startCol: 1, endLine: 5, endCol: 1 },
        },
        // The smallest self-contained scope: the failing statement, and nothing else.
        enclosingRange: { startLine: 3, endLine: 3 },
        snippet: 'const data = response.json();',
        relatedLocations: [],
        toolOutput: {},
      },
      fixable: true,
      repair: 'ai-required',
      confidence: 1,
    };
  }

  const NARROW_PATCH = JSON.stringify({
    repairedCode: '  const data = await response.json();',
    rationale: 'await the json call',
    confidence: 0.9,
  });
  const COMPLETE_PATCH = JSON.stringify({
    repairedCode: [
      'export async function load(url: string) {',
      '  const response = await fetch(url);',
      '  const data = await response.json();',
      '  return data;',
      '}',
    ].join('\n'),
    rationale: 'await the fetch as well — the json call depends on it',
    confidence: 0.95,
  });

  /** Records every request it is asked to stream, so the widened prompt can be inspected. */
  function capturingProvider(scripts: ProviderEvent[][]): AIProvider & {
    requests: () => { model: string; messages: { role: string; content: string }[] }[];
  } {
    const seen: { model: string; messages: { role: string; content: string }[] }[] = [];
    let call = 0;
    return {
      id: 'fake',
      capabilities: { structuredOutput: true, maxContext: 100_000 },
      test: () =>
        Promise.resolve({
          reachable: true,
          authenticated: true,
          modelAvailable: true,
          latencyMs: 1,
        }),
      requests: () => seen,
      stream(request, _signal) {
        seen.push({ model: request.model, messages: [...request.messages] });
        const events = scripts[Math.min(call, scripts.length - 1)] ?? [];
        call += 1;
        return (async function* () {
          for (const event of events) yield event;
        })();
      },
    };
  }

  /** Rejects the narrow patch with the dependent type error, then accepts the complete one. */
  function dependentVerifier(): VerificationService & {
    calls: () => { startLine: number; endLine: number }[];
  } {
    const seen: { startLine: number; endLine: number }[] = [];
    return {
      calls: () => seen,
      verify: (input) => {
        seen.push({ startLine: input.target.startLine, endLine: input.target.endLine });
        // The first attempt patched line 3 only. It parses; it does not compile — and the cause is
        // the un-awaited declaration on line 2, which that range does not contain.
        const narrow = input.target.startLine === input.target.endLine;
        return Promise.resolve({
          report: narrow
            ? {
                verdict: 'regression' as const,
                targetResolved: false,
                newFindingCount: 1,
                syntaxOk: true,
                ran: ['syntax', 'tsc'],
                newFindings: [
                  {
                    source: 'tsc',
                    ruleId: 'TS2339',
                    line: 3,
                    message: "Property 'json' does not exist on type 'Promise<Response>'.",
                  },
                ],
              }
            : {
                verdict: 'verified' as const,
                targetResolved: true,
                newFindingCount: 0,
                syntaxOk: true,
                ran: ['syntax', 'tsc'],
              },
          originalCode: 'ORIGINAL',
        });
      },
      dispose: () => undefined,
    };
  }

  function runFetchRepair(scripts: ProviderEvent[][]) {
    const provider = capturingProvider(scripts);
    const verifier = dependentVerifier();
    const service = createAiService(
      deps({
        provider,
        verification: verifier,
        finding: fetchFinding(),
        fileContent: FETCH_FILE,
        readFile: () => FETCH_FILE,
      }),
    );
    return { provider, verifier, service };
  }

  it('widens the splice to the enclosing function and emits BOTH edits as one repair', async () => {
    const { verifier, service } = runFetchRepair([
      textEvents(NARROW_PATCH),
      textEvents(COMPLETE_PATCH),
    ]);
    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok' || result.proposal.profile !== 'repair') throw new Error('no repair');

    // The first attempt was verified against the one failing line; the second against the whole
    // function. The widening is what made a passing patch possible at all.
    expect(verifier.calls()).toEqual([
      { startLine: 3, endLine: 3 },
      { startLine: 1, endLine: 5 },
    ]);

    // The verdict is the real one from the same verifier — nothing was relaxed to get here.
    expect(result.proposal.verification.verdict).toBe('verified');
    // The proposal splices the WIDER range, so the range shown and the range applied agree.
    expect(result.proposal.target).toMatchObject({ startLine: 1, endLine: 5 });
    // And it carries the prerequisite edit, not just the reported symptom.
    expect(result.proposal.repairedCode).toContain('const response = await fetch(url);');
    expect(result.proposal.repairedCode).toContain('const data = await response.json();');
  });

  it('re-grounds the second request on the wider code and says why', async () => {
    const { provider, service } = runFetchRepair([
      textEvents(NARROW_PATCH),
      textEvents(COMPLETE_PATCH),
    ]);
    await service.run({ profile: 'repair', findingId: 'find-1' }, null);

    expect(provider.requests()).toHaveLength(2);
    const first = provider.requests()[0]?.messages.map((m) => m.content).join('\n') ?? '';
    const second = provider.requests()[1]?.messages.map((m) => m.content).join('\n') ?? '';

    // The first prompt showed only the failing statement — which is why it could not succeed.
    expect(first).not.toContain('const response = fetch(url);');
    // The second shows the prerequisite line, so a complete answer is now expressible.
    expect(second).toContain('const response = fetch(url);');
    // And it is told to return one replacement covering both edits, rather than the same one-liner.
    expect(second).toMatch(/did not compile/i);
    expect(second).toMatch(/prerequisite change AND the original problem/i);
  });

  it('does not widen when the failure is fixable where it stands', async () => {
    // A style violation at the patch site means the model was wrong, not that the range was too
    // small. Widening here would enlarge the blast radius to cover a bad answer.
    const provider = capturingProvider([textEvents(NARROW_PATCH), textEvents(NARROW_PATCH)]);
    const localOnly: VerificationService = {
      verify: () =>
        Promise.resolve({
          report: {
            verdict: 'regression' as const,
            targetResolved: true,
            newFindingCount: 1,
            syntaxOk: true,
            ran: ['syntax', 'eslint'],
            newFindings: [
              { source: 'eslint', ruleId: 'semi', line: 3, message: 'Missing semicolon.' },
            ],
          },
          originalCode: 'ORIGINAL',
        }),
      dispose: () => undefined,
    };
    const service = createAiService(
      deps({
        provider,
        verification: localOnly,
        finding: fetchFinding(),
        fileContent: FETCH_FILE,
        readFile: () => FETCH_FILE,
      }),
    );
    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);

    if (result.status !== 'ok' || result.proposal.profile !== 'repair') throw new Error('no repair');
    // Still the narrow range, and still rejected — the ordinary re-ask path, untouched.
    expect(result.proposal.target).toMatchObject({ startLine: 3, endLine: 3 });
    expect(result.proposal.verification.verdict).toBe('regression');
  });

  it('escalates at most once, then falls back to the ordinary re-ask', async () => {
    // A verifier that rejects everything, narrow or wide, with a dependent error.
    const seen: { startLine: number; endLine: number }[] = [];
    const alwaysDependent: VerificationService = {
      verify: (input) => {
        seen.push({ startLine: input.target.startLine, endLine: input.target.endLine });
        return Promise.resolve({
          report: {
            verdict: 'regression' as const,
            targetResolved: false,
            newFindingCount: 1,
            syntaxOk: true,
            ran: ['syntax', 'tsc'],
            newFindings: [
              { source: 'tsc', ruleId: 'TS2339', line: 3, message: 'Property does not exist.' },
            ],
          },
          originalCode: 'ORIGINAL',
        });
      },
      dispose: () => undefined,
    };
    const provider = capturingProvider([textEvents(NARROW_PATCH)]);
    const service = createAiService(
      deps({
        provider,
        verification: alwaysDependent,
        finding: fetchFinding(),
        fileContent: FETCH_FILE,
        readFile: () => FETCH_FILE,
      }),
    );
    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);

    // One widening, then the range stays put for the remaining retries — it never climbs to the file.
    expect(seen[0]).toEqual({ startLine: 3, endLine: 3 });
    expect(seen.slice(1).every((c) => c.startLine === 1 && c.endLine === 5)).toBe(true);
    // 1 initial attempt + VERIFY_RETRY_LIMIT (3) retries, each verified on a fresh overlay.
    expect(seen).toHaveLength(4);
    // And the user still gets the best attempt with the verifier's real verdict — never a pass.
    if (result.status !== 'ok' || result.proposal.profile !== 'repair') throw new Error('no repair');
    expect(result.proposal.verification.verdict).toBe('regression');
  });
});

/**
 * Lint-only rejections earn one more targeted attempt before Apply is written off.
 *
 * A patch that parses, type-checks and resolves the reported problem can still be rejected for
 * `prefer-const` on a line it touched. That is a real regression and the gate is right to fail it —
 * but it is the most trivially fixable kind, and spending the user's Accept on it is a poor trade.
 *
 * The gate is NOT relaxed by any of this. The retry is verified by the same pipeline, and the verdict
 * it produces is the one the panel receives. These pin both halves: the retry happens for lint, and a
 * failure that is not lint-only still goes straight to a disabled Apply.
 */
describe('AI service — lint-only rejections get one targeted retry', () => {
  const REPAIR = JSON.stringify({ repairedCode: 'const a = 2;', rationale: 'fix', confidence: 0.9 });

  /** Rejects with lint findings `failures` times, then verifies. Records the prompts it caused. */
  function lintVerifier(failures: number): VerificationService & { calls: () => number } {
    let calls = 0;
    return {
      calls: () => calls,
      verify: () => {
        calls += 1;
        const failing = calls <= failures;
        return Promise.resolve({
          report: failing
            ? {
                verdict: 'regression' as const,
                targetResolved: true,
                newFindingCount: 1,
                // Parses and type-checks: the ONLY problem is a lint rule.
                syntaxOk: true,
                ran: ['syntax', 'eslint', 'tsc'],
                newFindings: [
                  {
                    source: 'eslint',
                    ruleId: 'prefer-const',
                    line: 3,
                    message: "'a' is never reassigned. Use 'const' instead.",
                  },
                ],
              }
            : {
                verdict: 'verified' as const,
                targetResolved: true,
                newFindingCount: 0,
                syntaxOk: true,
                ran: ['syntax', 'eslint', 'tsc'],
              },
          originalCode: 'ORIGINAL',
        });
      },
      dispose: () => undefined,
    };
  }

  /** Captures the prompts sent, so the targeted instruction can be inspected. */
  function capturing(scripts: ProviderEvent[][]): AIProvider & { prompts: () => string[] } {
    const seen: string[] = [];
    let call = 0;
    return {
      id: 'fake',
      capabilities: { structuredOutput: true, maxContext: 100_000 },
      test: () =>
        Promise.resolve({ reachable: true, authenticated: true, modelAvailable: true, latencyMs: 1 }),
      prompts: () => seen,
      stream(request, _signal) {
        seen.push(request.messages.map((m) => m.content).join('\n'));
        const events = scripts[Math.min(call, scripts.length - 1)] ?? [];
        call += 1;
        return (async function* () {
          for (const event of events) yield event;
        })();
      },
    };
  }

  it('retries once and returns the attempt that passes, so Accept is enabled', async () => {
    const verifier = lintVerifier(1); // fails on lint once, then verifies
    const provider = capturing([textEvents(REPAIR), textEvents(REPAIR)]);
    const service = createAiService(deps({ provider, verification: verifier }));
    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);

    if (result.status !== 'ok' || result.proposal.profile !== 'repair') throw new Error('no repair');
    // The verdict comes from the same verifier that rejected the first attempt — not from a bypass.
    expect(result.proposal.verification.verdict).toBe('verified');
    expect(verifier.calls()).toBe(2);
  });

  it('asks for the NARROWEST possible follow-up, naming the rule and nothing else', async () => {
    const provider = capturing([textEvents(REPAIR), textEvents(REPAIR)]);
    const service = createAiService(deps({ provider, verification: lintVerifier(1) }));
    await service.run({ profile: 'repair', findingId: 'find-1' }, null);

    const second = provider.prompts()[1] ?? '';
    expect(second).toMatch(/prefer-const/);
    // The distinguishing instruction: keep the fix, fix only the lint.
    expect(second).toMatch(/Keep the fix exactly as it is/i);
    expect(second).toMatch(/resolve ONLY these lint diagnostics/i);
    // And it must NOT be the general "your fix was rejected, make a narrower change" message.
    expect(second).not.toMatch(/it resolved the original problem but INTRODUCED/i);
  });

  it('a TYPE regression gets the general re-ask, never the lint one', async () => {
    const typeVerifier: VerificationService = {
      verify: () =>
        Promise.resolve({
          report: {
            verdict: 'regression' as const,
            targetResolved: true,
            newFindingCount: 1,
            syntaxOk: true,
            ran: ['syntax', 'tsc'],
            newFindings: [
              { source: 'tsc', ruleId: 'TS2322', line: 3, message: 'Type mismatch.' },
            ],
          },
          originalCode: 'ORIGINAL',
        }),
      dispose: () => undefined,
    };
    const provider = capturing([textEvents(REPAIR)]);
    const service = createAiService(deps({ provider, verification: typeVerifier }));
    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);

    const second = provider.prompts()[1] ?? '';
    expect(second).not.toMatch(/Keep the fix exactly as it is/i);
    // And the strict gate still stands: a type regression ends with Apply disabled.
    if (result.status !== 'ok' || result.proposal.profile !== 'repair') throw new Error('no repair');
    expect(result.proposal.verification.verdict).toBe('regression');
  });

  it('keeps Apply disabled when the lint retry ALSO fails — no bypass', async () => {
    const verifier = lintVerifier(Number.MAX_SAFE_INTEGER); // never passes
    const provider = capturing([textEvents(REPAIR)]);
    const service = createAiService(deps({ provider, verification: verifier }));
    const result = await service.run({ profile: 'repair', findingId: 'find-1' }, null);

    if (result.status !== 'ok' || result.proposal.profile !== 'repair') throw new Error('no repair');
    // The last verdict stands. Reached one attempt later, but reached honestly.
    expect(result.proposal.verification.verdict).toBe('regression');
    expect(result.proposal.verification.newFindings?.[0]?.ruleId).toBe('prefer-const');
  });

  it('spends the lint-targeted attempt at most once', async () => {
    // Otherwise a model that cannot satisfy a linter consumes the whole retry budget on it.
    const provider = capturing([textEvents(REPAIR)]);
    const service = createAiService(
      deps({ provider, verification: lintVerifier(Number.MAX_SAFE_INTEGER) }),
    );
    await service.run({ profile: 'repair', findingId: 'find-1' }, null);

    const lintPrompts = provider
      .prompts()
      .filter((p) => /Keep the fix exactly as it is/i.test(p));
    expect(lintPrompts).toHaveLength(1);
  });
});
