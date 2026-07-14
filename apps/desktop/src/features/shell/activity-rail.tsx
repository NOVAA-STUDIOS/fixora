import {
  AlertIcon,
  Button,
  ClockIcon,
  FolderIcon,
  SettingsIcon,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@fixora/ui';

import { useUiStore, type ActivityView } from '../../stores/ui-store.js';

type RailItem = {
  view: ActivityView;
  label: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
};

const items: RailItem[] = [
  { view: 'workspace', label: 'Workspace', Icon: FolderIcon },
  { view: 'findings', label: 'Findings', Icon: AlertIcon },
  { view: 'history', label: 'History', Icon: ClockIcon },
  { view: 'settings', label: 'Settings', Icon: SettingsIcon },
];

/**
 * The activity rail (Design Review §5): the vertical strip that switches the primary view. Each
 * item is a real button with a tooltip label and `aria-current` on the active one — a rail of
 * unlabelled icons is unusable by a screen reader, and our users include keyboard users.
 */
export function ActivityRail(): React.JSX.Element {
  const activeView = useUiStore((s) => s.activeView);
  const setActiveView = useUiStore((s) => s.setActiveView);

  return (
    <TooltipProvider delayDuration={300}>
      <nav
        aria-label="Primary"
        className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border-subtle bg-canvas py-2"
      >
        {items.map(({ view, label, Icon }) => {
          const active = view === activeView;
          return (
            <Tooltip key={view}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={label}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    setActiveView(view);
                  }}
                  className={active ? 'text-accent-text' : 'text-fg-muted'}
                >
                  <Icon className="size-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </TooltipProvider>
  );
}
