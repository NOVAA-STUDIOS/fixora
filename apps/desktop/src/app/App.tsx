import { useEffect } from 'react';

import { AppShell } from '../features/shell/app-shell.js';
import { useWorkspaceStore } from '../features/workspace/workspace-store.js';
import { useAppearance } from '../hooks/use-appearance.js';

/**
 * The root. It applies the persisted appearance (theme + density), adopts any workspace the main
 * process restored on launch (reopen-last-project), then renders the application shell.
 */
export function App(): React.JSX.Element {
  useAppearance();
  const hydrateCurrent = useWorkspaceStore((s) => s.hydrateCurrent);

  useEffect(() => {
    void hydrateCurrent();
  }, [hydrateCurrent]);

  return <AppShell />;
}
