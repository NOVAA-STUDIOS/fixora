import { isValidProjectName, UserFacingError } from '@fixora/shared-types';

import { createProject } from '../../services/project-service.js';
import type { WorkspaceService } from '../../services/workspace-service.js';
import { registerHandler } from '../router.js';

export function registerProjectHandlers(workspace: WorkspaceService): void {
  registerHandler('project:create', async ({ parentDir, name, templateId }) => {
    if (!workspace.isUserAuthorized(parentDir)) {
      throw new UserFacingError(
        'Fixora only creates a project in a folder you picked yourself or have opened before.',
        { code: 'unauthorized_path', action: { type: 'none', label: 'Dismiss' }, stage: 'workspace' },
      );
    }
    if (!isValidProjectName(name)) {
      throw new UserFacingError(
        'Project name must be 1–64 letters, numbers, dots, dashes, or underscores, without paths or consecutive dots.',
        { code: 'contract_violation', action: { type: 'none', label: 'Dismiss' }, stage: 'workspace' },
      );
    }
    const path = await createProject(parentDir, name, templateId);
    // The renderer's next call is workspace:open(path) to auto-open it — `path` itself was never
    // picked (only its PARENT was, via workspace:pickFolder), so without this it would fail that
    // channel's own authorization check with a confusing "Fixora only opens folders you picked"
    // refusal for a folder main just created. Safe to authorize here: main just wrote it.
    workspace.authorize(path);
    return { path };
  });
}
