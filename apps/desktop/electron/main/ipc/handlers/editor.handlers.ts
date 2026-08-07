import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Language } from '@fixora/shared-types';

import type { AnalysisHost, FormatResult } from '../../analysis/analysis-host.js';
import { detectLanguage } from '../../services/fs/language.js';
import { assertInsideWorkspace } from '../../services/fs/path-guard.js';
import { gitBlame } from '../../services/git-blame-service.js';
import type { WorkspaceService } from '../../services/workspace-service.js';
import { registerHandler } from '../router.js';

const FORMAT_LANGUAGES = new Set<string>([
  'typescript',
  'javascript',
  'python',
  'json',
  'css',
  'html',
  'markdown',
  'yaml',
]);

/** Format-on-save (editor-store.ts's `save()` calls this after the write succeeds). */
export function registerEditorHandlers(workspace: WorkspaceService, host: AnalysisHost): void {
  registerHandler('editor:formatFile', ({ relPath }) => {
    const { rootPath } = workspace.requireRoot();
    const absFile = assertInsideWorkspace(join(rootPath, relPath), rootPath);
    const detected = detectLanguage(relPath);

    // Not a language formatGate knows how to format — reading the current content back is enough
    // to answer the request; there is nothing for the worker to do.
    if (detected === null || !FORMAT_LANGUAGES.has(detected)) {
      return {
        ran: false,
        ok: true,
        formatter: null,
        message: null,
        content: readFileSync(absFile, 'utf8'),
      };
    }

    return new Promise<FormatResult>((resolve, reject) => {
      host.format({
        id: `format-${String(Date.now())}`,
        root: rootPath,
        absFile,
        language: detected as Language,
        onResult: resolve,
        onError: (message) => {
          reject(new Error(message));
        },
      });
    });
  });

  registerHandler('editor:gitBlame', async ({ relPath }) => {
    const { rootPath } = workspace.requireRoot();
    // Confirms relPath cannot escape the workspace (same guard every other path-taking handler
    // uses) before it ever reaches a spawned process; the string handed to git itself is still the
    // original relPath, which is what git's own path resolution expects.
    assertInsideWorkspace(join(rootPath, relPath), rootPath);
    const lines = await gitBlame(rootPath, relPath);
    return { lines };
  });
}
