import type { ProceedOutcome } from '@fixora/shared-types';

import { languageFor } from '../../ai/ai-service.js';
import type { KeyStore } from '../../ai/key-store.js';
import { createProceedService, type ProceedLogEntry } from '../../ai/proceed-service.js';
import type { Orchestrator } from '../../ai/providers/orchestrator.js';
import { projectConventions } from '../../ai/repair-context.js';
import type { AnalysisHost } from '../../analysis/analysis-host.js';
import type { FindingsRepository, RepairHistoryRepository } from '../../db/repositories.js';
import { checkAndIncrementRepairLimit, peekRepairLimit } from '../../lib/repair-limit.js';
import { readTextFile } from '../../services/fs/fs-service.js';
import type { WorkspaceService } from '../../services/workspace-service.js';
import type { VerificationService } from '../../verification/verification-service.js';
import { registerHandler } from '../router.js';

import { describeRunFailure } from './ai.handlers.js';

/**
 * The Proceed Mode IPC surface (P2.2R). One channel: `proceed:run` takes an instruction + the caret
 * and answers with a VERIFIED edit proposal or an exact refusal. It writes nothing — applying reuses
 * `ai:applyRepair`, the app's single verified write path.
 *
 * Every dependency here is the REAL one the repair path already uses: the same key store and provider
 * construction, the same path-guarded reader, the same `languageFor` mapping, the same project
 * conventions, the same findings repository, and the same verification service. Scope selection is
 * delegated to the analysis worker, which owns tree-sitter. Nothing is mocked and nothing duplicated.
 */

/** A Proceed run is a couple of model round-trips plus verification; past this it is wedged. */
const RUN_TIMEOUT_MS = 180_000;

export function registerProceedHandlers(deps: {
  keyStore: KeyStore;
  /** Owns provider selection, so Proceed and Repair can never disagree about who answers. */
  orchestrator: Orchestrator;
  workspace: WorkspaceService;
  findings: FindingsRepository;
  verification: VerificationService;
  /** The verification worker — scope selection runs there because the AST does. */
  host: AnalysisHost;
  /** The SAME repair audit trail Repair writes to — an edit is recorded whatever its verdict. */
  history: RepairHistoryRepository;
  appMeta?: { url?: string; name?: string };
}): void {
  // Mirrors `ai-service.ts`'s `active` controller exactly (Q3 Defect #4): held at module-registration
  // scope, not inside the request closure, so a LATER `proceed:cancel` call — arriving on its own IPC
  // round trip — can reach the SAME controller a `proceed:run` in flight is using. One Proceed request
  // running at a time; starting a new one aborts whatever was still running.
  let active: AbortController | null = null;

  registerHandler('proceed:cancel', () => {
    active?.abort();
    active = null;
  });

  registerHandler('proceed:run', async (request): Promise<ProceedOutcome> => {
    const workspace = deps.workspace.getCurrent();
    if (workspace === null) {
      return { status: 'error', code: 'not_found', message: 'Open a workspace first.' };
    }

    const limitCheck = peekRepairLimit();
    if (!limitCheck.allowed) {
      return {
        status: 'error',
        code: 'quota',
        message: limitCheck.message ?? 'Repair limit reached — upgrade your plan to continue',
      };
    }

    const controller = new AbortController();
    active?.abort();
    active = controller;
    const timer = setTimeout(() => {
      controller.abort();
    }, RUN_TIMEOUT_MS);

    // Provider SELECTION comes from the orchestrator, so Proceed and Repair can never disagree
    // about which provider is active, which credential it uses, or whether it is capable — the
    // duplicated construction here was the drift risk this platform exists to remove.
    //
    // Proceed does not yet FAIL OVER: `createProceedService` takes one provider, and threading the
    // walk through it is a change to that service rather than to provider orchestration. Selection
    // is unified now; failover for Proceed is a follow-up, and is called out rather than implied.
    // Asks for `repair` capability: a Proceed edit is schema-constrained output that lands in a
    // source file, so it needs exactly what a repair needs. There is no separate `edit` profile and
    // inventing one would let a provider qualify for edits while being unfit to write code.
    const chain = await deps.orchestrator.resolveChain('repair');
    if (!chain.ok) {
      return {
        status: 'error',
        code: 'no_key',
        message:
          chain.reason === 'none-enabled'
            ? 'No AI provider is enabled yet. Turn one on in Settings.'
            : chain.reason === 'no-credentials'
              ? 'Your enabled AI providers have no API key yet. Add one in Settings.'
              : 'None of your enabled providers can make this edit with their selected model.',
      };
    }
    const candidate = chain.candidates[0];
    if (candidate === undefined) {
      return { status: 'error', code: 'no_key', message: 'No AI provider is available.' };
    }

    try {
      const service = createProceedService({
        provider: candidate.adapter,
        providerId: candidate.provider,
        model: candidate.model,
        workspaceRoot: workspace.rootPath,
        workspaceId: workspace.id,
        history: deps.history,
        readSource: (file) => readTextFile(workspace.rootPath, file).content,
        detectLanguage: languageFor,
        resolveScope: (input) =>
          new Promise((resolve, reject) => {
            deps.host.resolveScope({
              id: `proceed-${String(Date.now())}`,
              source: input.source,
              language: input.language,
              filePath: input.filePath,
              ...(input.selectionEndLine !== undefined
                ? { selectionEndLine: input.selectionEndLine }
                : {}),
              selectionStartLine: input.selectionStartLine,
              onResult: resolve,
              onError: (message) => {
                reject(new Error(message));
              },
            });
          }),
        baselineFindings: (file) =>
          Promise.resolve(deps.findings.list(workspace.id, { relPath: file })),
        verify: (input) => deps.verification.verify(input),
        conventions: (input) =>
          projectConventions({
            language: input.language,
            fileContent: input.fileContent,
            workspaceRoot: workspace.rootPath,
          }),
        // Decision-only logging: intent, language, scope shape, verdict, outcome. Never source, never
        // the instruction text, never a key.
        log: (entry: ProceedLogEntry) => {
          console.error('[proceed]', JSON.stringify(entry));
        },
      });

      const outcome = await service.run(request, controller.signal);
      if (outcome.status === 'ok') checkAndIncrementRepairLimit();
      return outcome;
    } catch (error) {
      // A worker crash / scope timeout reaches here. Report it as a typed outcome rather than
      // throwing, so the renderer shows the reason instead of the router's redacted string.
      // `describeRunFailure` is the same wording Repair's `ai:run` uses (P0 Priority 1): an authored
      // UserFacingError is surfaced verbatim, anything else becomes an actionable, non-generic
      // sentence — never a raw JS error/stack reaching the renderer.
      return { status: 'error', code: 'proceed_failed', message: describeRunFailure(error, 'edit') };
    } finally {
      clearTimeout(timer);
      // Only clear `active` if it is STILL this request's controller — a newer `proceed:run` (which
      // aborts and replaces `active` on entry) or an explicit `proceed:cancel` may already have moved
      // it on, and this stale request finishing must not null out someone else's live controller.
      if (active === controller) active = null;
    }
  });
}
