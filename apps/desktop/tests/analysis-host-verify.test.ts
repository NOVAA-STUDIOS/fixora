import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

/**
 * The host forks a real Electron utility process. Here it is replaced by an EventEmitter, so the test
 * drives the exact message-handling code the app runs without spawning anything.
 */
const forked = vi.hoisted(() => ({ current: null as (EventEmitter & { postMessage: (m: unknown) => void; kill: () => void }) | null }));
vi.mock('electron', () => ({
  utilityProcess: {
    fork: () => {
      const child = new EventEmitter() as EventEmitter & {
        postMessage: (m: unknown) => void;
        kill: () => void;
      };
      child.postMessage = () => undefined;
      child.kill = () => undefined;
      forked.current = child;
      return child;
    },
  },
}));

import { createAnalysisHost, type VerifyResult } from '../electron/main/analysis/analysis-host.js';

/** A host wired to the fake worker, plus a way to push a message back from it. */
function hostWithFakeWorker(): {
  host: ReturnType<typeof createAnalysisHost>;
  emit: (message: unknown) => void;
} {
  const host = createAnalysisHost('C:/unused/worker.mjs');
  return {
    host,
    emit: (message: unknown) => {
      // The host subscribes on first job, so the child exists by the time this is called.
      forked.current?.emit('message', message);
    },
  };
}

/**
 * Every optional field on a verify result must survive the worker → main hop.
 *
 * The hop has THREE places that must each name a field, and each one silently drops what it does not
 * list: the worker's `postMessage`, `asWorkerMessage`'s normalizer, and the dispatch to `onResult`.
 * Adding a field to two of the three looks complete and changes nothing observable — which is exactly
 * what happened: `syntaxError` and `formatter` were computed correctly by the worker and thrown away
 * at the dispatch, so the parser gate could never say "Parser failed at line N" and the formatter
 * badge always read "not run". `baselineFindings` was lost the same way.
 *
 * This drives the REAL host against a fake worker and asserts the whole payload arrives.
 */
describe('analysis host — the verify payload survives the process hop', () => {
  it('forwards syntaxError, formatter and baselineFindings, not just findings', async () => {
    const { host, emit } = hostWithFakeWorker();
    const received = new Promise<VerifyResult>((resolve) => {
      host.verify({
        id: 'job-1',
        overlayRoot: 'C:/overlay',
        target: { file: 'a.ts', absPath: 'C:/overlay/a.ts', language: 'ts' },
        originalSource: 'before',
        onResult: resolve,
        onError: () => resolve({ syntaxOk: false, findings: [], aborted: false }),
      });
    });

    emit({
      type: 'verifyResult',
      jobId: 'job-1',
      syntaxOk: false,
      syntaxError: { line: 42, column: 7, text: "Unexpected syntax near 'ERROR'" },
      formatter: { ran: true, ok: false, formatter: 'prettier', message: 'would reformat' },
      findings: [],
      baselineFindings: [],
      aborted: false,
    });

    const result = await received;
    // Without these the gate cannot name the line, the badge cannot show a real result, and the
    // same-environment baseline never reaches the verdict.
    expect(result.syntaxError).toEqual({ line: 42, column: 7, text: "Unexpected syntax near 'ERROR'" });
    expect(result.formatter).toEqual({ ran: true, ok: false, formatter: 'prettier', message: 'would reformat' });
    expect(result.baselineFindings).toEqual([]);
    expect(result.syntaxOk).toBe(false);
  });

  it('omits the optional fields when the worker did not send them', async () => {
    const { host, emit } = hostWithFakeWorker();
    const received = new Promise<VerifyResult>((resolve) => {
      host.verify({
        id: 'job-2',
        overlayRoot: 'C:/overlay',
        target: { file: 'a.ts', absPath: 'C:/overlay/a.ts', language: 'ts' },
        onResult: resolve,
        onError: () => resolve({ syntaxOk: false, findings: [], aborted: false }),
      });
    });

    emit({ type: 'verifyResult', jobId: 'job-2', syntaxOk: true, findings: [], aborted: false });

    const result = await received;
    // Absent, not null or empty — the service distinguishes "no baseline" from "an empty baseline",
    // and conflating them would silently treat a clean file as having no comparison at all.
    expect(result.baselineFindings).toBeUndefined();
    expect(result.syntaxError).toBeUndefined();
    expect(result.formatter).toBeUndefined();
    expect(result.syntaxOk).toBe(true);
  });
});
