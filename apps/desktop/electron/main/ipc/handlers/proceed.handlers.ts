import { createOpenRouterProvider } from '@fixora/core-ai';
import type { ProceedOutcome } from '@fixora/shared-types';

import { languageFor } from '../../ai/ai-service.js';
import type { KeyStore } from '../../ai/key-store.js';
import { createProceedService, type ProceedLogEntry } from '../../ai/proceed-service.js';
import { projectConventions } from '../../ai/repair-context.js';
import type { AnalysisHost } from '../../analysis/analysis-host.js';
import type { FindingsRepository } from '../../db/repositories.js';
import { readTextFile } from '../../services/fs/fs-service.js';
import type { WorkspaceService } from '../../services/workspace-service.js';
import type { VerificationService } from '../../verification/verification-service.js';
import { registerHandler } from '../router.js';

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
  workspace: WorkspaceService;
  findings: FindingsRepository;
  verification: VerificationService;
  /** The verification worker — scope selection runs there because the AST does. */
  host: AnalysisHost;
  appMeta?: { url?: string; name?: string };
}): void {
  registerHandler('proceed:run', async (request): Promise<ProceedOutcome> => {
    const key = deps.keyStore.getKey();
    if (key === null) {
      return {
        status: 'error',
        code: 'no_key',
        message: 'Add your provider key in Settings → AI.',
      };
    }
    const workspace = deps.workspace.getCurrent();
    if (workspace === null) {
      return { status: 'error', code: 'not_found', message: 'Open a workspace first.' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, RUN_TIMEOUT_MS);

    try {
      const service = createProceedService({
        provider: createOpenRouterProvider({
          apiKey: key,
          ...(deps.appMeta?.url !== undefined ? { appUrl: deps.appMeta.url } : {}),
          ...(deps.appMeta?.name !== undefined ? { appName: deps.appMeta.name } : {}),
        }),
        model: deps.keyStore.getConfig().model,
        workspaceRoot: workspace.rootPath,
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

      return await service.run(request, controller.signal);
    } catch (error) {
      // A worker crash / scope timeout reaches here. Report it as a typed outcome rather than
      // throwing, so the renderer shows the reason instead of the router's redacted string.
      const message = error instanceof Error ? error.message : String(error);
      return { status: 'error', code: 'proceed_failed', message };
    } finally {
      clearTimeout(timer);
    }
  });
}
