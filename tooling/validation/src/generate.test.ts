import type { AIProvider, ProviderEvent } from '@fixora/core-ai';
import type { Finding } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { generateRepair, spliceLines } from './generate.js';

/**
 * Proof that the AI "Generate Repair" leg is REAL wiring, not a placeholder: with a fake provider
 * standing in for OpenRouter, the whole orchestration runs — context build, the secret-gated prompt,
 * streaming accumulation, JSON parse + recovery, the single schema re-ask, and the CRLF-aware splice.
 * At runtime the only swap is the provider (real `createOpenRouterProvider`), so what these tests
 * exercise is the same code path a keyed run takes, minus the network — which is why the live numbers
 * are DEFERRED, not the wiring.
 */

/** A provider whose `stream` replays a scripted set of events per call (call 0 = first ask, 1 = re-ask). */
function fakeProvider(script: ProviderEvent[][]): AIProvider {
  let call = 0;
  return {
    id: 'fake',
    capabilities: { structuredOutput: true, maxContext: 32_000 },
    stream() {
      const events = script[call] ?? [];
      call += 1;
      return (async function* () {
        for (const e of events) await Promise.resolve(yield e);
      })();
    },
    // These tests never exercise connectivity checking — they replay a scripted stream. The method
    // exists because `AIProvider` requires it; reporting "reachable, unverified" is the honest
    // answer for a fake that never talks to anything.
    test() {
      return Promise.resolve({
        reachable: true,
        authenticated: null,
        modelAvailable: null,
        latencyMs: 0,
      });
    },
  };
}

const deltas = (text: string): ProviderEvent[] => [{ type: 'text_delta', text }];
const repairJson = (repairedCode: string): string =>
  JSON.stringify({ repairedCode, rationale: 'fix the defect', confidence: 0.9 });

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    source: 'tsc',
    ruleId: 'TS2322',
    severity: 'error',
    category: 'correctness',
    location: { file: 'src/a.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 24 },
    message: 'Type string is not assignable to number.',
    evidence: { snippet: 'const x: number = "1";', relatedLocations: [], toolOutput: null },
    fixable: false,
    repair: 'ai-required',
    confidence: 1,
    ...over,
  };
}

const baseInput = {
  model: 'test-model',
  finding: finding(),
  language: 'typescript' as const,
  fileContent: 'const x: number = "1";\n',
  workspaceRoot: '.',
  target: { symbolName: 'x', startLine: 1, endLine: 1 },
};

describe('generateRepair — real wiring against a fake provider', () => {
  it('turns a valid model response into a spliced, full-file patch', async () => {
    const provider = fakeProvider([deltas(repairJson('const x: number = 1;'))]);
    const r = await generateRepair({ ...baseInput, provider });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.repairedCode).toBe('const x: number = 1;');
      expect(r.patched).toBe('const x: number = 1;\n'); // target line replaced, trailing newline kept
      expect(r.reAsked).toBe(false);
      expect(r.confidence).toBeCloseTo(0.9);
    }
  });

  it('re-asks exactly once when the first output is not valid JSON, then succeeds', async () => {
    const provider = fakeProvider([
      deltas('here is your fix: const x = 1'), // prose, not JSON
      deltas(repairJson('const x: number = 1;')),
    ]);
    const r = await generateRepair({ ...baseInput, provider });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reAsked).toBe(true);
  });

  it('classifies a provider error as ai-provider, carrying the provider’s own words', async () => {
    const provider = fakeProvider([
      [{ type: 'error', retryable: false, providerCode: '404', message: 'model not found' }],
    ]);
    const r = await generateRepair({ ...baseInput, provider });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.subsystem).toBe('ai-provider');
      expect(r.reason).toContain('model not found');
    }
  });

  it('classifies persistent non-JSON output as response-parser (model output issue)', async () => {
    const provider = fakeProvider([deltas('garbage'), deltas('still not json')]);
    const r = await generateRepair({ ...baseInput, provider });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.subsystem).toBe('response-parser');
  });
});

describe('spliceLines — CRLF-aware (drift guard for the copy of verification/patch.ts)', () => {
  it('keeps a CRLF file uniformly CRLF when an LF replacement is spliced in', () => {
    const crlf = 'a = 1;\r\nb = 2;\r\nc = 3;\r\n';
    const out = spliceLines(crlf, 2, 2, 'b = 20;');
    expect(out).toBe('a = 1;\r\nb = 20;\r\nc = 3;\r\n');
    expect(/(?<!\r)\n/.test(out)).toBe(false); // no lone LF introduced
  });

  it('replaces a multi-line range with the full replacement', () => {
    expect(spliceLines('one\ntwo\nthree\n', 1, 2, 'X\nY')).toBe('X\nY\nthree\n');
  });
});
