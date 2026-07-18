import type { AiService } from '../../ai/ai-service.js';
import type { KeyStore } from '../../ai/key-store.js';
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
}): void {
  registerHandler('ai:getConfig', () => deps.keyStore.getConfig());

  registerHandler('ai:setKey', ({ key, model }) => deps.keyStore.setKey(key, model));

  registerHandler('ai:clearKey', () => deps.keyStore.clearKey());

  registerHandler('ai:setModel', ({ model }) => deps.keyStore.setModel(model));

  registerHandler('ai:run', (request, { window }) => deps.aiService.run(request, window));

  registerHandler('ai:cancel', () => {
    deps.aiService.cancel();
  });

  registerHandler(
    'ai:applyRepair',
    ({ file, startLine, endLine, code, expectedOriginal, historyId }) => {
      const workspace = deps.workspace.getCurrent();
      if (workspace === null) {
        throw new Error('No workspace is open.');
      }
      // Re-read now, and refuse if the target range no longer matches what the repair was computed
      // against — the file changed under us, and splicing a stale range would corrupt it (audit fix).
      const current = readTextFile(workspace.rootPath, file).content;
      if (sliceLines(current, startLine, endLine) !== expectedOriginal) {
        throw new Error('The file changed since this repair was proposed. Re-run the repair.');
      }
      const patched = spliceLines(current, startLine, endLine, code);
      writeTextFile(workspace.rootPath, file, patched);
      if (historyId !== undefined) deps.history.markApplied(historyId);
    },
  );

  registerHandler('ai:history', () => {
    const workspace = deps.workspace.getCurrent();
    if (workspace === null) return { entries: [] };
    return { entries: deps.history.list(workspace.id) };
  });
}
