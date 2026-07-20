import { createHash } from 'node:crypto';

import type { ApplyOutcome, StaleRangeCheck } from '@fixora/shared-types';

import type { AiService } from '../../ai/ai-service.js';
import type { KeyStore } from '../../ai/key-store.js';
import type { ModelCatalogueService } from '../../ai/model-catalogue.js';
import type { RepairHistoryRepository } from '../../db/repositories.js';
import { readTextFile, writeTextFile } from '../../services/fs/fs-service.js';
import type { WorkspaceService } from '../../services/workspace-service.js';
import { sliceLines, spliceLines } from '../../verification/patch.js';
import { registerHandler } from '../router.js';

/**
 * AI handlers (M5, BYOK). The key is write-only from the renderer's side: `ai:setKey` accepts one and
 * hands it to the keychain-backed store; no channel ever returns it. `ai:run` grounds a task on a
 * stored finding and streams the result — the secret gate runs inside the service before any provider
 * call. `ai:applyRepair` is the one place we modify the user's code, and only for a repair they accepted:
 * it splices the verified replacement into the file through the same path guard reads use.
 */
export function registerAiHandlers(deps: {
  keyStore: KeyStore;
  aiService: AiService;
  workspace: WorkspaceService;
  history: RepairHistoryRepository;
  catalogue: ModelCatalogueService;
}): void {
  // Resolving here is what makes a retired model self-heal: every config read checks the stored id
  // against the live catalogue, migrates it if it is gone, and reports what it moved away from so the
  // UI can explain itself. A failed fetch resolves to unchanged — we never migrate on a guess.
  registerHandler('ai:getConfig', async () => {
    const config = deps.keyStore.getConfig();
    const { model, migratedFrom } = await deps.catalogue.resolve(config.model);
    if (model !== config.model) {
      // Persist it, so the migration happens once rather than on every read.
      deps.keyStore.setModel(model);
    }
    return { ...config, model, migratedFrom };
  });

  registerHandler('ai:listModels', ({ refresh }) => deps.catalogue.list(refresh ?? false));

  registerHandler('ai:setKey', ({ key, model }) => deps.keyStore.setKey(key, model));

  registerHandler('ai:clearKey', () => deps.keyStore.clearKey());

  registerHandler('ai:setModel', ({ model }) => deps.keyStore.setModel(model));

  registerHandler('ai:run', (request, { window }) => deps.aiService.run(request, window));

  registerHandler('ai:cancel', () => {
    deps.aiService.cancel();
  });

  registerHandler(
    'ai:applyRepair',
    ({ file, startLine, endLine, code, expectedOriginal, historyId }): ApplyOutcome => {
      const workspace = deps.workspace.getCurrent();
      if (workspace === null) {
        // Returned, not thrown. The router redacts thrown errors by design, so an expected and
        // actionable condition must travel as contract data or the user gets "something went wrong".
        const outcome: ApplyOutcome = {
          applied: false,
          reason: 'no-workspace',
          message: 'No project is open, so there is nothing to apply this repair to.',
          staleRangeCheck: null,
        };
        console.error('[apply] refused', outcome);
        return outcome;
      }

      // Re-read now, and refuse if the target range no longer matches what the repair was computed
      // against — the file changed under us, and splicing a stale range would corrupt it (audit fix).
      const current = readTextFile(workspace.rootPath, file).content;
      const actualOriginal = sliceLines(current, startLine, endLine);
      const staleRangeCheck = compareRange({
        expected: expectedOriginal,
        actual: actualOriginal,
        startLine,
        endLine,
        fileLineCount: current.split('\n').length,
      });

      // Everything the decision was made from, on every attempt — not only on failure. A log that
      // appears only when something breaks cannot tell you what a working attempt looked like.
      console.error('[apply] attempt', {
        file,
        startLine,
        endLine,
        historyId: historyId ?? null,
        codeLength: code.length,
        staleRangeCheck: {
          ...staleRangeCheck,
          expectedExcerpt: '<omitted>',
          actualExcerpt: '<omitted>',
        },
      });

      if (startLine < 1 || endLine < startLine || endLine > staleRangeCheck.fileLineCount) {
        const outcome: ApplyOutcome = {
          applied: false,
          reason: 'range-out-of-bounds',
          message: `This repair targets lines ${String(startLine)}–${String(endLine)}, but the file now has ${String(staleRangeCheck.fileLineCount)} lines. Re-run the repair.`,
          staleRangeCheck,
        };
        console.error('[apply] refused', { reason: outcome.reason, message: outcome.message });
        return outcome;
      }

      if (!staleRangeCheck.passed) {
        const outcome: ApplyOutcome = {
          applied: false,
          reason: 'stale-range',
          message:
            'The file changed since this repair was proposed, so applying it would overwrite work that is not in the preview. Re-run the repair.',
          staleRangeCheck,
        };
        console.error('[apply] refused', {
          reason: outcome.reason,
          firstDifferingLine: staleRangeCheck.firstDifferingLine,
          expectedHash: staleRangeCheck.expectedHash,
          actualHash: staleRangeCheck.actualHash,
        });
        return outcome;
      }

      const patched = spliceLines(current, startLine, endLine, code);
      writeTextFile(workspace.rootPath, file, patched);
      if (historyId !== undefined) deps.history.markApplied(historyId);
      console.error('[apply] applied', { file, bytesWritten: patched.length });
      return { applied: true, staleRangeCheck, bytesWritten: patched.length };
    },
  );

  registerHandler('ai:history', () => {
    const workspace = deps.workspace.getCurrent();
    if (workspace === null) return { entries: [] };
    return { entries: deps.history.list(workspace.id) };
  });

  // Deleting history removes the *record* of a repair. It never reverts the change the repair made
  // — that already lives in the file, and undoing it is the editor's job, not the audit log's.
  registerHandler('ai:historyRemove', ({ id }) => {
    const workspace = deps.workspace.getCurrent();
    if (workspace === null) return { entries: [] };
    deps.history.remove(id);
    return { entries: deps.history.list(workspace.id) };
  });

  registerHandler('ai:historyClear', () => {
    const workspace = deps.workspace.getCurrent();
    if (workspace === null) return { entries: [] };
    deps.history.clearWorkspace(workspace.id);
    return { entries: deps.history.list(workspace.id) };
  });
}

/**
 * What the stale-range guard compared, in enough detail to diagnose a mismatch without guessing.
 *
 * Hashes rather than full content in the summary log, because the log is the thing most likely to
 * be pasted into an issue; the excerpts (bounded, and only around the first difference) travel in
 * the IPC response instead, where they stay on the user's own machine and screen.
 */
function compareRange(input: {
  expected: string;
  actual: string;
  startLine: number;
  endLine: number;
  fileLineCount: number;
}): StaleRangeCheck {
  const expectedLines = input.expected.split('\n');
  const actualLines = input.actual.split('\n');
  let firstDifferingLine: number | null = null;
  const max = Math.max(expectedLines.length, actualLines.length);
  for (let i = 0; i < max; i += 1) {
    if (expectedLines[i] !== actualLines[i]) {
      firstDifferingLine = i + 1;
      break;
    }
  }

  const excerpt = (lines: string[]): string => {
    if (firstDifferingLine === null) return '';
    const from = Math.max(0, firstDifferingLine - 2);
    return lines
      .slice(from, from + 3)
      .join('\n')
      .slice(0, 400);
  };

  return {
    passed: input.expected === input.actual,
    startLine: input.startLine,
    endLine: input.endLine,
    fileLineCount: input.fileLineCount,
    expectedLength: input.expected.length,
    actualLength: input.actual.length,
    expectedHash: sha1(input.expected),
    actualHash: sha1(input.actual),
    firstDifferingLine,
    expectedExcerpt: excerpt(expectedLines),
    actualExcerpt: excerpt(actualLines),
  };
}

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 12);
}
