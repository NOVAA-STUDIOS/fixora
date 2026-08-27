import { UserFacingError } from '@fixora/shared-types';

import { searchWorkspace } from '../../services/search-service.js';
import type { WorkspaceService } from '../../services/workspace-service.js';
import { registerHandler } from '../router.js';

export function registerSearchHandlers(workspace: WorkspaceService): void {
  registerHandler('search:query', async ({ query, caseSensitive, useRegex, fileFilter }) => {
    const open = workspace.getCurrent();
    if (open === null) {
      throw new UserFacingError('Open a folder before searching.', {
        code: 'no_workspace',
        action: { type: 'none', label: 'Dismiss' },
        stage: 'workspace',
      });
    }
    const { matches, truncated } = await searchWorkspace(open, query, {
      caseSensitive: caseSensitive ?? false,
      useRegex: useRegex ?? false,
      fileFilter: fileFilter ?? '',
    });
    return { matches, truncated };
  });
}
