import { UserFacingError } from '@fixora/shared-types';

import {
  detectManifestKind,
  listDependencies,
  searchRegistry,
} from '../../services/package-manager-service.js';
import type { WorkspaceService } from '../../services/workspace-service.js';
import { registerHandler } from '../router.js';

export function registerPackageManagerHandlers(workspace: WorkspaceService): void {
  registerHandler('packages:list', () => {
    const open = workspace.getCurrent();
    if (open === null) {
      throw new UserFacingError('Open a folder to see its dependencies.', {
        code: 'no_workspace',
        action: { type: 'none', label: 'Dismiss' },
        stage: 'workspace',
      });
    }
    const kind = detectManifestKind(open);
    return { kind, dependencies: listDependencies(open, kind) };
  });

  registerHandler('packages:search', async ({ query }) => {
    const open = workspace.getCurrent();
    if (open === null) {
      throw new UserFacingError('Open a folder before searching packages.', {
        code: 'no_workspace',
        action: { type: 'none', label: 'Dismiss' },
        stage: 'workspace',
      });
    }
    const kind = detectManifestKind(open);
    const results = await searchRegistry(kind, query);
    return { results };
  });
}
