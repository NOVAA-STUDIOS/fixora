import { createHash } from 'node:crypto';

import { UserFacingError, type ApplyOutcome, type StaleRangeCheck } from '@fixora/shared-types';

import type { AiService } from '../../ai/ai-service.js';
import type { KeyStore } from '../../ai/key-store.js';
import type { ModelCatalogueService } from '../../ai/model-catalogue.js';
import type { RepairHistoryRepository } from '../../db/repositories.js';
import { readTextFile, writeTextFile } from '../../services/fs/fs-service.js';
import type { WorkspaceService } from '../../services/workspace-service.js';
import { sliceLines, spliceLines } from '../../verification/patch.js';
import { emitToWindow } from '../emit.js';
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
  /**
   * Called on every mount of the assistant panel and of Settings, and it does real I/O: keychain
   * decryption plus a network fetch of the model catalogue. Its response type has no error variant,
   * so a failure can only leave as an exception — which the router redacts. That made a network
   * blip or a keychain problem indistinguishable from any other fault, reported as "Something went
   * wrong handling that action." on the screen where you go to repair code.
   *
   * `UserFacingError` is the mechanism for exactly this: an authored message the router passes
   * through intact, while still redacting everything unexpected.
   */
  registerHandler('ai:getConfig', async () => {
    let config;
    try {
      config = deps.keyStore.getConfig();
    } catch {
      throw new UserFacingError(
        'Fixora could not read your saved provider key from the OS keychain. Re-adding the key in Settings → AI usually fixes it.',
        {
          code: 'keystore_unreadable',
          action: { type: 'open_settings', label: 'Open Settings' },
          stage: 'keystore',
        },
      );
    }
    try {
      const { model, migratedFrom } = await deps.catalogue.resolve(config.model);
      if (model !== config.model) {
        // Persist it, so the migration happens once rather than on every read.
        deps.keyStore.setModel(model);
      }
      return { ...config, model, migratedFrom };
    } catch (error) {
      // The catalogue is a *convenience* — it exists to migrate retired model ids. Failing the whole
      // config read because it was unreachable turns "you are offline" into "the app is broken", so
      // the stored model is returned unresolved instead.
      console.error('[ai:getConfig] catalogue resolve failed; returning stored model unresolved', {
        message: error instanceof Error ? error.message : String(error),
      });
      return { ...config, migratedFrom: null };
    }
  });

  registerHandler('ai:listModels', async ({ refresh }) => {
    try {
      return await deps.catalogue.list(refresh ?? false);
    } catch (error) {
      throw new UserFacingError(
        `Fixora could not reach OpenRouter to list models: ${error instanceof Error ? error.message : String(error)}`,
        {
          code: 'catalogue_unreachable',
          action: { type: 'retry', label: 'Try again' },
          stage: 'catalogue',
        },
      );
    }
  });

  registerHandler('ai:setKey', ({ key, model }) => deps.keyStore.setKey(key, model));

  registerHandler('ai:clearKey', () => deps.keyStore.clearKey());

  registerHandler('ai:setModel', ({ model }) => deps.keyStore.setModel(model));

  /**
   * `ai:run` must never throw.
   *
   * It used to call straight through to the service, so ANY exception anywhere in the pipeline —
   * provider adapter, verification overlay, a bug of ours — reached the router, which redacts a
   * thrown error to "Something went wrong handling that action.". That single sentence was the
   * entire failure report for the product's core feature: no cause in the UI, and (until this
   * sprint) no message in the log either.
   *
   * The response type already has an `error` variant. Using it means the real cause travels as
   * contract data, validated by zod, never redacted — the same correction applied to
   * `ai:applyRepair`. The catch is deliberately broad because its job is to guarantee the property
   * "this handler returns a value", not to anticipate specific faults.
   */
  registerHandler('ai:run', async (request, { window, requestId }) => {
    const started = Date.now();
    console.error('[ai:run] entered', {
      requestId,
      profile: request.profile,
      findingId: request.findingId,
    });
    try {
      const response = await deps.aiService.run(request, window);
      console.error('[ai:run] exited', {
        requestId,
        status: response.status,
        ...(response.status === 'error' ? { code: response.code, message: response.message } : {}),
        ms: Date.now() - started,
      });
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ai:run] THREW', {
        requestId,
        profile: request.profile,
        name: error instanceof Error ? error.name : 'unknown',
        message,
        stack: error instanceof Error ? error.stack : undefined,
        ms: Date.now() - started,
      });
      // Clear the renderer's "running" state, or the UI spins forever on a crash.
      if (window !== null) emitToWindow(window, 'ai:runState', { status: 'error', message });
      return {
        status: 'error' as const,
        code: 'internal_error' as const,
        // The real message, not a placeholder. This is Fixora's own error text on the user's own
        // machine; withholding it is what made the failure undiagnosable.
        message: `Fixora hit an internal error while running this ${request.profile}: ${message}`,
      };
    }
  });

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
