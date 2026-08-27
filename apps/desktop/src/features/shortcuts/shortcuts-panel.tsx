import { Dialog, DialogContent, DialogDescription, DialogTitle, Kbd } from '@fixora/ui';

import { useShortcutsStore } from '../../stores/shortcuts-store.js';

type Shortcut = { keys: readonly string[]; label: string };
type Section = { heading: string; shortcuts: readonly Shortcut[] };

const SECTIONS: readonly Section[] = [
  {
    heading: 'Navigation',
    shortcuts: [
      { keys: ['Ctrl', 'Shift', 'P'], label: 'Command Palette' },
      { keys: ['Ctrl', 'B'], label: 'Toggle Sidebar' },
      { keys: ['Ctrl', 'J'], label: 'Toggle AI Panel' },
      { keys: ['Ctrl', '`'], label: 'Toggle Terminal' },
    ],
  },
  {
    heading: 'Analysis',
    shortcuts: [
      { keys: ['Ctrl', 'Shift', 'A'], label: 'Run Analysis' },
      { keys: ['Ctrl', 'Shift', 'R'], label: 'Repair All' },
      { keys: ['Ctrl', 'Shift', 'G'], label: 'Group Repair' },
    ],
  },
  {
    heading: 'Editor',
    shortcuts: [
      { keys: ['Ctrl', 'S'], label: 'Save File' },
      { keys: ['Ctrl', 'Z'], label: 'Undo' },
      { keys: ['Ctrl', 'Shift', 'Z'], label: 'Redo' },
      { keys: ['Ctrl', '\\'], label: 'Toggle split editor' },
    ],
  },
  {
    heading: 'AI Features',
    shortcuts: [
      { keys: ['Click Repair'], label: 'Fix with AI' },
      { keys: ['Click Explain'], label: 'Understand issue' },
      { keys: ['Click Test'], label: 'Generate tests' },
    ],
  },
  {
    heading: 'General',
    shortcuts: [
      { keys: ['?'], label: 'Show this panel' },
      { keys: ['Esc'], label: 'Close panel' },
    ],
  },
];

/** The '?' shortcuts reference (`shortcuts-store.ts` owns open state, the global listener lives in
 * App.tsx). Radix's Dialog gives Esc-to-close and outside-click-to-close for free. */
export function ShortcutsPanel(): React.JSX.Element | null {
  const isOpen = useShortcutsStore((s) => s.isOpen);
  const close = useShortcutsStore((s) => s.close);

  if (!isOpen) return null;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogTitle className="text-base font-semibold text-fg">Keyboard Shortcuts</DialogTitle>
        <DialogDescription className="text-sm text-fg-muted">
          Everything you can do without reaching for the mouse.
        </DialogDescription>

        <div className="mt-4 flex flex-col gap-5">
          {SECTIONS.map((section) => (
            <div key={section.heading} className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                {section.heading}
              </h3>
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {section.shortcuts.map((shortcut) => (
                    <tr key={shortcut.label} className="border-t border-border-subtle first:border-t-0">
                      <td className="py-1.5 pr-4 text-fg-muted">{shortcut.label}</td>
                      <td className="py-1.5 text-right">
                        <span className="inline-flex items-center gap-1">
                          {shortcut.keys.map((key) => (
                            <Kbd key={key}>{key}</Kbd>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
