import { createHash } from 'node:crypto';
// TEMP-DIAGNOSTIC (Q3 file-corruption incident — remove after root cause).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { capabilitiesFor, suggestCapableModel } from '@fixora/core-ai';
import {
  UserFacingError,
  isUserFacingError,
  type ApplyOutcome,
  type StaleRangeCheck,
} from '@fixora/shared-types';

/**
 * The user-facing message for an unexpected throw inside `ai:run`, as a pure function so the wording
 * is testable and can be proven to never be the forbidden bare "internal error" string (P0 Priority 1).
 *
 * An authored `UserFacingError` that reached this catch is already user-ready — its message is precise
 * and carries a recovery action — so it is surfaced verbatim. Anything else is a genuine bug in
 * Fixora: the message says so plainly, carries the real detail (never hidden), and tells the user what
 * to do, without ever collapsing to "internal error" / "unknown error".
 */
export function describeRunFailure(error: unknown, profile: string): string {
  if (isUserFacingError(error)) return error.message;
  const detail = error instanceof Error ? error.message : String(error);
  return (
    `Fixora could not finish this ${profile}. This is a bug in Fixora, not a problem with your ` +
    `project. Details: ${detail}. Re-run the ${profile}; if it keeps happening, please report it ` +
    `with this message.`
  );
}

import type { AiService } from '../../ai/ai-service.js';
import { timeoutFailure } from '../../ai/failure-report.js';
import type { KeyStore, StoredAiConfig } from '../../ai/key-store.js';
import type { ModelCatalogueService } from '../../ai/model-catalogue.js';
import type { RepairHistoryRepository } from '../../db/repositories.js';
import { readTextFile, writeTextFile } from '../../services/fs/fs-service.js';
import type { WorkspaceService } from '../../services/workspace-service.js';
import { locateRange, sliceLines, spliceLines } from '../../verification/patch.js';
import { emitToWindow } from '../emit.js';
import { registerHandler } from '../router.js';

/**
 * AI handlers (M5, BYOK). The key is write-only from the renderer's side: `ai:setKey` accepts one and
 * hands it to the keychain-backed store; no channel ever returns it. `ai:run` grounds a task on a
 * stored finding and streams the result — the secret gate runs inside the service before any provider
 * call. `ai:applyRepair` is the one place we modify the user's code, and only for a repair they accepted:
 * it splices the verified replacement into the file through the same path guard reads use.
 */
/**
 * How long a single `ai:run` may take before it is aborted and reported as timed out.
 *
 * 180s matches the budget Proceed Mode has always used, for the same shape of work (a couple of model
 * round trips plus overlay verification). Past this a run is wedged, not slow.
 */
export const DEFAULT_RUN_TIMEOUT_MS = 180_000;

export function registerAiHandlers(deps: {
  keyStore: KeyStore;
  aiService: AiService;
  workspace: WorkspaceService;
  history: RepairHistoryRepository;
  catalogue: ModelCatalogueService;
  /** Overridable so a test can prove the timeout fires without waiting three minutes. */
  runTimeoutMs?: number;
}): void {
  const runTimeoutMs = deps.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
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

  /**
   * Join what is stored with what the provider says the model can do.
   *
   * Every config-returning channel goes through this, which is what makes requirement 7 true by
   * construction: changing the model re-reads capabilities in the same round-trip, so the UI cannot
   * show Repair as available for a model that was just switched away from a capable one.
   */
  async function enrich(config: StoredAiConfig, migratedFrom: string | null = null) {
    try {
      const catalogue = await deps.catalogue.list(false);
      const resolved = catalogue.models.find((m) => m.id === config.model) ?? null;
      const capabilities = capabilitiesFor(resolved);
      const suggestion =
        resolved !== null && !resolved.structuredOutput
          ? suggestCapableModel(catalogue.models, config.model)
          : null;
      return {
        ...config,
        migratedFrom,
        capabilities: {
          structuredOutput: capabilities.structuredOutput,
          contextLength: capabilities.contextLength,
          profiles: capabilities.profiles,
        },
        suggestedModel:
          suggestion === null
            ? null
            : { id: suggestion.id, name: suggestion.name, free: suggestion.free },
      };
    } catch {
      // Catalogue unreachable. Unknown capability is reported as unknown, never as capable — the
      // whole failure being fixed is a button that looks available and is not.
      return { ...config, migratedFrom, capabilities: null, suggestedModel: null };
    }
  }

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
      // Capabilities travel WITH the config, so the UI can disable an impossible action before the
      // user takes it rather than after. Read from the catalogue, never inferred from the model id.
      const catalogue = await deps.catalogue.list(false);
      const resolved = catalogue.models.find((m) => m.id === model) ?? null;
      const capabilities = capabilitiesFor(resolved);
      const suggestion =
        resolved !== null && !resolved.structuredOutput
          ? suggestCapableModel(catalogue.models, model)
          : null;
      return {
        ...config,
        model,
        migratedFrom,
        capabilities: {
          structuredOutput: capabilities.structuredOutput,
          contextLength: capabilities.contextLength,
          profiles: capabilities.profiles,
        },
        suggestedModel:
          suggestion === null
            ? null
            : { id: suggestion.id, name: suggestion.name, free: suggestion.free },
      };
    } catch (error) {
      // The catalogue is a *convenience* — it exists to migrate retired model ids. Failing the whole
      // config read because it was unreachable turns "you are offline" into "the app is broken", so
      // the stored model is returned unresolved instead.
      console.error('[ai:getConfig] catalogue resolve failed; returning stored model unresolved', {
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        ...config,
        migratedFrom: null,
        // Unknown, so reported as unknown. Optimistically enabling Repair here is the exact bug
        // being fixed — the user would press it and it would fail.
        capabilities: null,
        suggestedModel: null,
      };
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

  registerHandler('ai:setKey', async ({ key, model }) => enrich(deps.keyStore.setKey(key, model)));

  registerHandler('ai:clearKey', async () => enrich(deps.keyStore.clearKey()));

  registerHandler('ai:setModel', async ({ model }) => enrich(deps.keyStore.setModel(model)));

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

    /**
     * The run budget. Repair had NO timeout of any kind — not here, not in the service, and not in
     * the provider's `fetch` (which is called with a signal but no deadline, and Node's fetch imposes
     * no response timeout on a streaming body). So a provider that accepted the connection and then
     * sent nothing left the `for await` over the SSE stream blocked forever, `ai:run`'s promise
     * unresolved, and the renderer's `status: 'running'` permanently stuck — the reported hang.
     * Proceed Mode already had exactly this guard; Repair never got it. Now it does.
     */
    // Read through a call, not the binding: the assignment happens inside the timer callback, which
    // TypeScript's flow analysis cannot see, so a direct `timedOut` read below narrows to `false` and
    // the branch is reported as dead. Same helper shape `complexity.ts`/`syntax.ts` use.
    let didTimeOut = false;
    const timedOut = (): boolean => didTimeOut;
    const timeout = setTimeout(() => {
      didTimeOut = true;
      console.error('[ai:run] TIMED OUT — aborting', { requestId, ms: Date.now() - started });
      // Abort, rather than just resolving the promise: the point is to stop the background work and
      // release the connection, not to hide it while it keeps running.
      deps.aiService.cancel();
    }, runTimeoutMs);

    try {
      const response = await deps.aiService.run(request, window);
      console.error('[ai:run] exited', {
        requestId,
        status: response.status,
        ...(response.status === 'error' ? { code: response.code, message: response.message } : {}),
        ms: Date.now() - started,
      });
      // A run the timer aborted comes back as `cancelled`, because aborting is how the timeout is
      // enforced. The user did not cancel it, so reporting "Cancelled." would be a lie — retag it as
      // the timeout it actually was, with a message that says what to do next.
      if (response.status === 'error' && response.code === 'cancelled' && timedOut()) {
        const message =
          `This repair took longer than ${String(Math.round(runTimeoutMs / 1000))} seconds and was stopped, ` +
          'so nothing was changed. The provider may be slow or overloaded — try again, or pick a faster model in Settings → AI.';
        if (window !== null) emitToWindow(window, 'ai:runState', { status: 'error', message });
        return {
          status: 'error' as const,
          code: 'timeout' as const,
          message,
          retryable: true,
          // Attributed to the provider, not to Fixora: the deadline is ours, but the silence that
          // ran it out is theirs. A user who reads this as a Fixora hang files the wrong bug.
          failure: timeoutFailure({
            provider: 'openrouter',
            model: deps.keyStore.getConfig().model,
          }),
        };
      }
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
      // An authored error surfaces verbatim; anything else becomes an actionable, non-generic
      // message. The user text never says "internal error"/"unknown error" and is never silent —
      // the `internal_error` CODE remains for telemetry, but the MESSAGE explains and guides.
      const userMessage = describeRunFailure(error, request.profile);
      // Clear the renderer's "running" state, or the UI spins forever on a crash.
      if (window !== null)
        emitToWindow(window, 'ai:runState', { status: 'error', message: userMessage });
      return {
        status: 'error' as const,
        code: 'internal_error' as const,
        message: userMessage,
      };
    } finally {
      // Always, on every path. A timer left armed would abort the NEXT run several minutes later,
      // turning one slow repair into an unexplained cancellation of an unrelated one.
      clearTimeout(timeout);
    }
  });

  registerHandler('ai:cancel', () => {
    deps.aiService.cancel();
  });

  registerHandler(
    'ai:applyRepair',
    ({ file, startLine, endLine, code, expectedOriginal, historyId }): ApplyOutcome => {
      // TEMP-DIAGNOSTIC (Q3 file-corruption incident — remove after root cause). Gated on the
      // disposable repro filename so no other file's content is ever logged. Captures `code` and
      // `expectedOriginal` exactly as they arrived over the `ai:applyRepair` IPC boundary.
      if (file.includes('proceed-diag')) {
        const codeNul = code.split(String.fromCharCode(0)).length - 1;
        const origNul = expectedOriginal.split(String.fromCharCode(0)).length - 1;
        console.error('[Q3-DIAG] ai.handlers: ai:applyRepair received', {
          file,
          typeofCode: typeof code,
          codeLength: code.length,
          codeByteLength: Buffer.byteLength(code, 'utf8'),
          codeNulCount: codeNul,
          codePreview: JSON.stringify(code.slice(0, 60)),
          typeofExpectedOriginal: typeof expectedOriginal,
          expectedOriginalLength: expectedOriginal.length,
          expectedOriginalNulCount: origNul,
        });
      }
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
      // The read is guarded: a file deleted/renamed/locked/permission-denied between repair and apply
      // is an expected, actionable condition, so it travels as an ApplyOutcome with the fs layer's
      // precise reason — never thrown into the router's generic "Something went wrong" (P0 Priority 1).
      let current: string;
      try {
        current = readTextFile(workspace.rootPath, file).content;
      } catch (error) {
        // Only an AUTHORED fs condition — the file legitimately vanished, is locked, or is
        // permission-denied — becomes a friendly ApplyOutcome. A path-guard or secrets-denylist
        // refusal (a hostile or buggy target) is NOT authored: it re-throws so the router redacts it
        // and it stays a hard refusal, never dressed up as "the file moved". Security is unchanged.
        if (!isUserFacingError(error)) throw error;
        const outcome: ApplyOutcome = {
          applied: false,
          reason: 'read-failed',
          message: error.message,
          staleRangeCheck: null,
        };
        console.error('[apply] refused', { reason: outcome.reason, message: outcome.message });
        return outcome;
      }
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

      let applyStartLine = startLine;
      let applyEndLine = endLine;
      let finalRangeCheck = staleRangeCheck;
      let relocated = false;

      if (!staleRangeCheck.passed) {
        // The target may simply have MOVED — an edit elsewhere shifted line numbers without
        // touching the target text. Relocation only succeeds on an EXACT byte match, so the code
        // being spliced is still exactly what verification ran against; nothing unverified is ever
        // written. A near-miss (the block moved AND changed) still refuses below, unchanged.
        const moved = locateRange(current, expectedOriginal, startLine);
        if (moved !== null) {
          const relocatedCheck = compareRange({
            expected: expectedOriginal,
            actual: sliceLines(current, moved.startLine, moved.endLine),
            startLine: moved.startLine,
            endLine: moved.endLine,
            fileLineCount: staleRangeCheck.fileLineCount,
          });
          if (relocatedCheck.passed) {
            applyStartLine = moved.startLine;
            applyEndLine = moved.endLine;
            finalRangeCheck = relocatedCheck;
            relocated = true;
            console.error('[apply] relocated', {
              file,
              fromLine: startLine,
              toLine: moved.startLine,
            });
          }
        }
      }

      if (!finalRangeCheck.passed) {
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

      const patched = spliceLines(current, applyStartLine, applyEndLine, code);
      // TEMP-DIAGNOSTIC (Q3 file-corruption incident — remove after root cause). Captures spliceLines'
      // own output — this is the exact string `writeTextFile` is about to receive.
      if (file.includes('proceed-diag')) {
        const patchedNul = patched.split(String.fromCharCode(0)).length - 1;
        console.error('[Q3-DIAG] ai.handlers: spliceLines output (writeTextFile input)', {
          file,
          typeofPatched: typeof patched,
          patchedLength: patched.length,
          patchedByteLength: Buffer.byteLength(patched, 'utf8'),
          patchedNulCount: patchedNul,
          preview:
            JSON.stringify(patched.slice(0, 60)) + ' ... ' + JSON.stringify(patched.slice(-60)),
        });
      }
      // The write is guarded for the same reason as the read: EPERM/EBUSY/symlink-refusal/read-only
      // are actionable, so they return as an ApplyOutcome carrying the fs layer's precise reason,
      // never a thrown error the router would flatten to "Something went wrong" (P0 Priority 1).
      try {
        writeTextFile(workspace.rootPath, file, patched);
      } catch (error) {
        // Same rule as the read: an authored fs failure (EPERM/EBUSY/read-only/symlink-refusal) is a
        // friendly refusal; a path-guard or secrets refusal re-throws and stays hard-redacted.
        if (!isUserFacingError(error)) throw error;
        const outcome: ApplyOutcome = {
          applied: false,
          reason: 'write-failed',
          message: error.message,
          staleRangeCheck: finalRangeCheck,
        };
        console.error('[apply] refused', { reason: outcome.reason, message: outcome.message });
        return outcome;
      }
      // TEMP-DIAGNOSTIC (Q3 file-corruption incident — remove after root cause). Reads the file back
      // as RAW BYTES (not decoded text) immediately after the atomic rename completes, so a corruption
      // that only appears after the write can be told apart from one already present beforehand.
      if (file.includes('proceed-diag')) {
        try {
          const onDisk = readFileSync(join(workspace.rootPath, file));
          const expectedBuf = Buffer.from(patched, 'utf8');
          let diskNulCount = 0;
          for (const byte of onDisk) if (byte === 0) diskNulCount++;
          console.error('[Q3-DIAG] ai.handlers: post-rename on-disk bytes', {
            file,
            onDiskByteLength: onDisk.length,
            expectedByteLength: expectedBuf.length,
            diskNulCount,
            matchesExpected: onDisk.equals(expectedBuf),
          });
        } catch (diagError) {
          console.error('[Q3-DIAG] ai.handlers: post-rename read-back FAILED', {
            file,
            message: diagError instanceof Error ? diagError.message : String(diagError),
          });
        }
      }
      if (historyId !== undefined) deps.history.markApplied(historyId);
      console.error('[apply] applied', { file, bytesWritten: patched.length, relocated });
      return { applied: true, staleRangeCheck: finalRangeCheck, bytesWritten: patched.length, relocated };
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
