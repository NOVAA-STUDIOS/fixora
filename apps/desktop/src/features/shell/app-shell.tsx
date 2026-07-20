import { CommandPalette } from '../commands/command-palette.js';
import { CommandProvider } from '../commands/command-provider.js';
import { useAppCommands } from '../commands/use-app-commands.js';

import { ActivityRail } from './activity-rail.js';
import { StatusBar } from './status-bar.js';
import { TitleBar } from './title-bar.js';
import { Toaster } from './toaster.js';
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
      {/*
        The shell is the *chrome*, and it sits on the darkest surface in the palette. The panes
        inside it are raised surfaces floating on that base with a gutter between them.

        Before this, every surface in the app was the same near-black and the only thing separating
        a pane from its neighbour was a 1px hairline — which is why the window read as one flat sheet
        with lines drawn on it. Depth is what makes an interface look built rather than drawn: the
        chrome recedes, the content comes forward, and the eye gets a z-order to read the layout by
        without a single label. It is the difference between VS Code's classic look and what Linear,
        Arc and current Cursor do, and it costs nothing at runtime.
      */}
      <div className="flex h-screen flex-col overflow-hidden bg-inset text-fg">
        <TitleBar />
        <div className="flex min-h-0 flex-1 gap-1.5 px-1.5 pb-1.5">
          <ActivityRail />
          <Workbench />
        </div>
        <StatusBar />
      </div>
      <CommandPalette />
      <Toaster />
    </CommandProvider>
  );
}
