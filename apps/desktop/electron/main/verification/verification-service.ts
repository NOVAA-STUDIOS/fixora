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
  finding: Finding;
  repairedCode: string;
  target: { file: string; startLine: number; endLine: number; language: Language };
  workspaceRoot: string;
  originalContent: string;
  /** The current findings for this file (from the DB) — the baseline we compare the patch against. */
  originalFindings: readonly Finding[];
}

export interface VerificationService {
  verify(input: VerifyInput): Promise<{ report: VerificationReport; originalCode: string }>;
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
    async verify(input): Promise<{ report: VerificationReport; originalCode: string }> {
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
        };
      }
      try {
        patchOverlayFile(overlay.root, input.target.file, patched);

        const result = await new Promise<VerifyResult | null>((resolve) => {
          deps.host.verify({
            id: randomUUID(),
            overlayRoot: overlay.root,
            target: {
              file: input.target.file,
              absPath: join(overlay.root, input.target.file),
              language: input.target.language,
            },
            timeoutMs: deps.timeoutMs ?? VERIFY_TIMEOUT_MS,
            onResult: resolve,
            onError: () => {
              resolve(null);
            },
          });
        });

        if (result === null) {
          return { report: skipped('Verification could not run for this file.'), originalCode };
        }

        const report = computeVerdict({
          target: input.finding,
          originalFindings: input.originalFindings,
          patchedFindings: result.findings,
          syntaxOk: result.syntaxOk,
        });
        return { report, originalCode };
      } finally {
        overlay.dispose();
      }
    },

    dispose(): void {
      deps.host.dispose();
    },
  };
}
