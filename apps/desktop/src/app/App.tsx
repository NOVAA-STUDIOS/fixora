import { AppShell } from '../features/shell/app-shell.js';
import { useAppearance } from '../hooks/use-appearance.js';

/**
 * The root. It applies the persisted appearance (theme + density) to the document, then renders
 * the application shell. The M0 diagnostic panel has done its job — the IPC round-trip and the
 * token layer it proved are now load-bearing under the shell rather than displayed as a demo.
 */
export function App(): React.JSX.Element {
  useAppearance();
  return <AppShell />;
}
