import { join } from 'node:path';

import { assertInsideWorkspace } from '../../services/fs/path-guard.js';
import { gitCommit, gitStage, gitStatus, gitUnstage } from '../../services/git-service.js';
import type { WorkspaceService } from '../../services/workspace-service.js';
import { registerHandler } from '../router.js';

export function registerGitHandlers(workspace: WorkspaceService): void {
  registerHandler('git:status', async () => {
    const { rootPath } = workspace.requireRoot();
    return gitStatus(rootPath);
  });

  registerHandler('git:stage', async ({ relPath }) => {
    const { rootPath } = workspace.requireRoot();
    assertInsideWorkspace(join(rootPath, relPath), rootPath);
    await gitStage(rootPath, relPath);
  });

  registerHandler('git:unstage', async ({ relPath }) => {
    const { rootPath } = workspace.requireRoot();
    assertInsideWorkspace(join(rootPath, relPath), rootPath);
    await gitUnstage(rootPath, relPath);
  });

  registerHandler('git:commit', async ({ message }) => {
    const { rootPath } = workspace.requireRoot();
    await gitCommit(rootPath, message);
  });
}
