import { CommandPalette } from '../commands/command-palette.js';
import { CommandProvider } from '../commands/command-provider.js';
import { useAppCommands } from '../commands/use-app-commands.js';

import { ActivityRail } from './activity-rail.js';
import { StatusBar } from './status-bar.js';
import { TitleBar } from './title-bar.js';
import { Workbench } from './workbench.js';

/**
 * The application shell (Design Review §5, roadmap M1): title bar, activity rail, resizable
 * workbench, status bar — plus the command system that drives the ⌘K palette and the keybindings
 * from one registry. This is the finished *frame* of the product; the surfaces inside it fill in
 * from M2.
 *
 * The command list is derived from the UI store and handed to the provider, which owns the single
 * global keybinding listener. The palette is a view over that same registry.
 */
export function AppShell(): React.JSX.Element {
  const commands = useAppCommands();

  return (
    <CommandProvider commands={commands}>
      <div className="flex h-screen flex-col overflow-hidden bg-canvas text-fg">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <ActivityRail />
          <Workbench />
        </div>
        <StatusBar />
      </div>
      <CommandPalette />
    </CommandProvider>
  );
}
