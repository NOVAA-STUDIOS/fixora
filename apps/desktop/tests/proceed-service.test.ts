import type { AIProvider, ProviderEvent, ProviderRequest } from '@fixora/core-ai';
import type { VerificationReport } from '@fixora/shared-types';
import { describe, expect, it, vi } from 'vitest';

import { createProceedService, type ProceedDeps } from '../electron/main/ai/proceed-service.js';
import type { EditScope } from '@fixora/core-analysis';

/**
 * Proceed Mode orchestration, proven end-to-end with injected fakes (no Electron, worker, or network):
 * intent → scope → context → gate → generate → parse → the REAL verify contract → safe apply. Every
 * terminal outcome is pinned, and — critically — a regression is REJECTED (never applied), a secret in
 * scope is BLOCKED, and the structured log never carries source code.
 */

function fakeProvider(events: ProviderEvent[][]): AIProvider {
  let call = 0;
  return {
    id: 'fake',
    capabilities: { structuredOutput: true, maxContext: 32_000 },
    stream() {
      const evs = events[call] ?? [];
      call += 1;
      return (async function* () {
        for (const e of evs) await Promise.resolve(yield e);
      })();
    },
  };
}

const editJson = (editedCode: string): ProviderEvent[] => [
  {
    type: 'text_delta',
    text: JSON.stringify({ editedCode, summary: 'did the thing', confidence: 0.9 }),
  },
];

const scope: EditScope = {
  symbolName: 'Button',
  startLine: 1,
  endLine: 3,
  text: 'export function Button() {\n  return <button>x</button>;\n}',
  basis: 'enclosing-symbol',
};

function report(verdict: VerificationReport['verdict'], newFindingCount = 0): VerificationReport {
  return {
    verdict,
    targetResolved: true,
    newFindingCount,
    syntaxOk: verdict !== 'regression' || newFindingCount > 0,
    ran: ['syntax', 'eslint'],
    ...(verdict === 'regression' ? { note: 'The edit introduces 1 new problem(s).' } : {}),
  };
}

function deps(over: Partial<ProceedDeps> = {}): ProceedDeps {
  return {
    provider: fakeProvider([
      editJson('export function Button() {\n  return <button className="green">x</button>;\n}'),
    ]),
    model: 'test-model',
    workspaceRoot: '/ws',
    workspaceId: 'ws-1',
    history: { record: vi.fn(() => 'history-1') } as unknown as ProceedDeps['history'],
    readSource: () => scope.text,
    detectLanguage: () => 'typescript',
    resolveScope: () => Promise.resolve(scope),
    baselineFindings: () => Promise.resolve([]),
    verify: () => Promise.resolve({ report: report('verified'), originalCode: scope.text }),
    log: vi.fn(),
    ...over,
  };
}

const request = {
  instruction: 'make this button green',
  file: 'src/Button.tsx',
  selectionStartLine: 2,
};
const NO_ABORT = new AbortController().signal;

describe('createProceedService', () => {
  it('OK: verified edit → proposal with the diff-able original + verification', async () => {
    const d = deps();
    const out = await createProceedService(d).run(request, NO_ABORT);
    expect(out.status).toBe('ok');
    if (out.status === 'ok') {
      expect(out.proposal.intent).toBe('styling');
      expect(out.proposal.editedCode).toContain('className="green"');
      expect(out.proposal.originalCode).toBe(scope.text);
      expect(out.proposal.verification.verdict).toBe('verified');
      expect(out.proposal.historyId).toBe('history-1');
      expect(out.proposal.target).toEqual({
        file: 'src/Button.tsx',
        startLine: 1,
        endLine: 3,
        symbolName: 'Button',
      });
    }
    expect(d.log).toHaveBeenCalledTimes(1);
  });

  it('AUDIT TRAIL (B1): a verified edit is recorded in the SAME repair history Repair writes to', async () => {
    const record = vi.fn((_repair: Record<string, unknown>) => 'history-2');
    const d = deps({ history: { record } as unknown as ProceedDeps['history'] });
    const out = await createProceedService(d).run(request, NO_ABORT);
    expect(out.status).toBe('ok');
    expect(record).toHaveBeenCalledTimes(1);
    const entry = record.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry['workspaceId']).toBe('ws-1');
    expect(entry['relPath']).toBe('src/Button.tsx');
    expect(entry['symbolName']).toBe('Button');
    expect(entry['ruleId']).toBe('proceed-edit');
    expect(entry['source']).toBe('proceed');
    expect(entry['verdict']).toBe('verified');
    expect(entry['repairedCode']).toContain('className="green"');
    if (out.status === 'ok') expect(out.proposal.historyId).toBe('history-2');
  });

  it('AUDIT TRAIL (B1): a REJECTED (regression) edit is recorded too — mirrors Repair, whatever the verdict', async () => {
    const record = vi.fn((_repair: Record<string, unknown>) => 'history-3');
    const d = deps({
      history: { record } as unknown as ProceedDeps['history'],
      verify: () => Promise.resolve({ report: report('regression', 1), originalCode: scope.text }),
    });
    const out = await createProceedService(d).run(request, NO_ABORT);
    expect(out.status).toBe('rejected');
    expect(record).toHaveBeenCalledTimes(1);
    const entry = record.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry['verdict']).toBe('regression');
  });

  it('UNSUPPORTED FILE: reports the same friendly wording Repair uses for the identical condition (bug-fix sprint)', async () => {
    const out = await createProceedService(deps({ detectLanguage: () => null })).run(
      request,
      NO_ABORT,
    );
    expect(out.status).toBe('error');
    if (out.status === 'error') {
      expect(out.code).toBe('unsupported_language');
      expect(out.message).toBe("This file type isn't supported for editing yet.");
    }
  });

  it('UNKNOWN-INTENT: gibberish fails gracefully and never calls the provider', async () => {
    const provider = { ...fakeProvider([]), stream: vi.fn() };
    const out = await createProceedService(
      deps({ provider: provider as unknown as AIProvider }),
    ).run({ ...request, instruction: 'asdf qwerty zxcv' }, NO_ABORT);
    expect(out.status).toBe('unknown-intent');
    expect(provider.stream).not.toHaveBeenCalled();
  });

  it('EXPLANATION-INTENT: a non-actionable question is refused gracefully and never calls the provider', async () => {
    const provider = { ...fakeProvider([]), stream: vi.fn() };
    const out = await createProceedService(
      deps({ provider: provider as unknown as AIProvider }),
    ).run({ ...request, instruction: 'Explain what this does' }, NO_ABORT);
    expect(out.status).toBe('unknown-intent');
    expect(provider.stream).not.toHaveBeenCalled();
  });

  it('GENERAL-INTENT: a valid actionable instruction with no specific category still proceeds', async () => {
    // "add error handling" matches no LEXICON category (styling/react/typescript/python/documentation/
    // refactoring/explanation) but has a real action verb ("add"), so it must classify `general` and
    // still reach the provider — the fix for explanation-intent must not touch this path.
    const out = await createProceedService(deps()).run(
      { ...request, instruction: 'add error handling' },
      NO_ABORT,
    );
    expect(out.status).toBe('ok');
    if (out.status === 'ok') expect(out.proposal.intent).toBe('general');
  });

  it('BLOCKED: a secret in the target scope is refused before anything is sent', async () => {
    const out = await createProceedService(
      deps({
        readSource: () => 'const k = "AKIAIOSFODNN7EXAMPLE";',
        resolveScope: () =>
          Promise.resolve({ ...scope, text: 'const k = "AKIAIOSFODNN7EXAMPLE";' }),
      }),
    ).run(request, NO_ABORT);
    expect(out.status).toBe('blocked');
  });

  it('REJECTED: a regression verdict is never applied — the edit is refused with its report', async () => {
    const out = await createProceedService(
      deps({
        verify: () =>
          Promise.resolve({ report: report('regression', 1), originalCode: scope.text }),
      }),
    ).run(request, NO_ABORT);
    expect(out.status).toBe('rejected');
    if (out.status === 'rejected') expect(out.verification?.verdict).toBe('regression');
  });

  it('CANCELLED: an aborted signal returns a clean cancellation, never a confusing model-output error (Q3 Defect #4)', async () => {
    const controller = new AbortController();
    controller.abort();
    // `fakeProvider([])` yields nothing — exactly how the real OpenRouter provider ends a stream once
    // its signal is aborted (no error event, just an empty stream). That must be detected explicitly
    // rather than falling through to `parseEditOutput('')` and surfacing as "invalid model output".
    const out = await createProceedService(deps({ provider: fakeProvider([]) })).run(
      request,
      controller.signal,
    );
    expect(out.status).toBe('error');
    if (out.status === 'error') {
      expect(out.code).toBe('cancelled');
      expect(out.message).toBe('Cancelled.');
    }
  });

  it('ERROR: persistent non-JSON output is classified `model-output`, retryable, with diagnostics', async () => {
    const provider = fakeProvider([
      [{ type: 'text_delta', text: 'nope' }],
      [{ type: 'text_delta', text: 'still nope' }],
    ]);
    const out = await createProceedService(deps({ provider })).run(request, NO_ABORT);
    expect(out.status).toBe('error');
    if (out.status === 'error') {
      expect(out.code).toBe('model-output'); // the failing LAYER, not a generic code
      expect(out.retryable).toBe(true);
      // P2.2.1 item 5: every failure states what we detected and what to try.
      expect(out.message).toContain('Detected intent: styling');
      expect(out.message).toContain('language: typescript');
      expect(out.message).toMatch(/stronger model/);
    }
  });

  it('RE-ASK (bug-fix sprint): a truncated first attempt is re-asked to be complete and brief, not told to "remove surrounding text"', async () => {
    const truncated = '{"editedCode": "export function Button() {"'; // cut off mid-object, no closing brace
    const complete = JSON.stringify({
      editedCode: 'ok',
      summary: 'did the thing',
      confidence: 0.9,
    });
    const requests: ProviderRequest[] = [];
    const provider: AIProvider = {
      id: 'fake',
      capabilities: { structuredOutput: true, maxContext: 32_000 },
      stream(req: ProviderRequest) {
        requests.push(req);
        const text = requests.length === 1 ? truncated : complete;
        return (async function* () {
          yield { type: 'text_delta', text } as ProviderEvent;
        })();
      },
    };
    await createProceedService(deps({ provider })).run(request, NO_ABORT);
    expect(requests).toHaveLength(2);
    const reAskMessage = requests[1]?.messages.at(-1)?.content;
    expect(reAskMessage).toMatch(/cut off|incomplete/i);
    expect(reAskMessage).not.toMatch(/surrounding text/);
  });

  it('ERROR: a provider 429 becomes the quota sentence, never a raw HTTP string', async () => {
    const provider = fakeProvider([
      [
        {
          type: 'error',
          retryable: true,
          providerCode: 'HTTP_429',
          message: 'Rate limit exceeded',
        },
      ],
    ]);
    const out = await createProceedService(deps({ provider })).run(request, NO_ABORT);
    expect(out.status).toBe('error');
    if (out.status === 'error') {
      expect(out.code).toBe('quota');
      expect(out.retryable).toBe(true);
      expect(out.message).toContain('Your OpenRouter quota has been exhausted');
      expect(out.message).not.toMatch(/429|Too Many Requests/);
    }
  });

  it('LOGS the decision without source code or keys', async () => {
    const log = vi.fn();
    await createProceedService(deps({ log })).run(request, NO_ABORT);
    const entry = log.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry['intent']).toBe('styling');
    expect(entry['verdict']).toBe('verified');
    expect(entry['outcome']).toBe('ok');
    // No source text fields anywhere in the log entry.
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('button');
    expect(serialized).not.toContain('className');
  });
});
