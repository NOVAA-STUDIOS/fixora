import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import type { Finding, Language, VerificationReport } from '@fixora/shared-types';

import type { AnalysisHost, VerifyResult } from '../analysis/analysis-host.js';

import { createOverlay, patchOverlayFile } from './overlay.js';
import { computeVerdict, sliceLines, spliceLines } from './patch.js';

/**
 * The verification service (ADR-003). It applies a proposed repair to a throwaway overlay, asks the
 * analysis worker to re-check that one file (syntax + the workspace's analyzers), and turns the result
 * into a verdict. It never touches the user's files, and it always disposes the overlay — verification
 * is a read-only claim about a fix, computed off to the side.
 */

export interface VerifyInput {
  /** The finding being repaired, or `null` for a Proceed-Mode edit (verify regression-only). */
  finding: Finding | null;
  repairedCode: string;
  target: { file: string; startLine: number; endLine: number; language: Language };
  workspaceRoot: string;
  originalContent: string;
  /** The current findings for this file (from the DB) — the baseline we compare the patch against. */
  originalFindings: readonly Finding[];
  /**
   * Correlation id for the worker job, supplied by the caller so one repair's trace can be followed
   * across renderer, main and the analysis worker. Optional: a caller that does not care still gets a
   * generated one, and the id has no effect on the verdict.
   */
  verifyId?: string;
}

export interface VerificationService {
  verify(
    input: VerifyInput,
  ): Promise<{ report: VerificationReport; originalCode: string; verifyId?: string }>;
  dispose(): void;
}

const VERIFY_TIMEOUT_MS = 120_000;

function skipped(note: string): VerificationReport {
  return {
    verdict: 'skipped',
    targetResolved: false,
    newFindingCount: 0,
    syntaxOk: true,
    ran: [],
    note,
  };
}

export function createVerificationService(deps: {
  host: AnalysisHost;
  timeoutMs?: number;
}): VerificationService {
  return {
    async verify(
      input,
    ): Promise<{ report: VerificationReport; originalCode: string; verifyId?: string }> {
      const verifyId = input.verifyId ?? randomUUID();
      const originalCode = sliceLines(
        input.originalContent,
        input.target.startLine,
        input.target.endLine,
      );
      const patched = spliceLines(
        input.originalContent,
        input.target.startLine,
        input.target.endLine,
        input.repairedCode,
      );

      // Building the overlay is scaffolding, not the repair. If it fails — a full temp disk, a
      // permission wall, anything — verification is skipped with an honest note and the repair is
      // still returned unverified. It must never throw out of here and become a generic internal
      // error on a feature that otherwise worked (release-blocker hardening).
      let overlay;
      try {
        overlay = createOverlay(input.workspaceRoot);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          report: skipped(
            `Could not build a verification workspace, so this repair was not checked automatically. ${detail}`,
          ),
          originalCode,
          verifyId,
        };
      }
      try {
        patchOverlayFile(overlay.root, input.target.file, patched);

        const result = await new Promise<VerifyResult | null>((resolve) => {
          deps.host.verify({
            id: verifyId,
            overlayRoot: overlay.root,
            target: {
              file: input.target.file,
              absPath: join(overlay.root, input.target.file),
              language: input.target.language,
            },
            // The pre-patch bytes, so the parser gate can charge the patch only with what it
            // actually introduced. See `VerifyJob.originalSource`.
            originalSource: input.originalContent,
            timeoutMs: deps.timeoutMs ?? VERIFY_TIMEOUT_MS,
            onResult: resolve,
            onError: () => {
              resolve(null);
            },
          });
        });

        if (result === null) {
          return { verifyId, report: skipped('Verification could not run for this file.'), originalCode };
        }

        /**
         * Prefer the worker's own baseline over the caller's.
         *
         * The caller's comes from the database — the last time the WORKSPACE was analyzed — while the
         * patched set comes from this overlay, moments ago. Measured on the real pipeline, that gap
         * turned a user's own post-analysis edit into a "new problem introduced by the patch" and
         * disabled Apply on a correct repair. The worker's baseline is the same file, the same
         * analyzers, the same capabilities and the same moment, differing only by the patch — which is
         * the only thing a verdict is entitled to be about.
         *
         * Falls back to the caller's when the worker did not send one, so behaviour degrades to the
         * previous semantics rather than to no baseline at all.
         */
        const baseline = result.baselineFindings ?? input.originalFindings;
        const verdict = computeVerdict({
          target: input.finding,
          originalFindings: baseline,
          patchedFindings: result.findings,
          syntaxOk: result.syntaxOk,
        });
        // The parser error location and the formatter-gate result are computed in the worker (where
        // core-analysis is loaded and the overlay file lives) and ride back on the verify result.
        const report = {
          ...verdict,
          ...(result.syntaxError !== undefined ? { syntaxError: result.syntaxError } : {}),
          ...(result.formatter !== undefined ? { formatter: result.formatter } : {}),
        };

        return { report, originalCode, verifyId };
      } finally {
        overlay.dispose();
      }
    },

    dispose(): void {
      deps.host.dispose();
    },
  };
}
