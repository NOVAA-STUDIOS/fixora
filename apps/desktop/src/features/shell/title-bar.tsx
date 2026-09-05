import {
  Button,
  FileIcon,
  SidebarLeftIcon,
  SidebarRightIcon,
  SparkleIcon,
  WinCloseIcon,
  WinMaximizeIcon,
  WinMinimizeIcon,
  WinRestoreIcon,
  cn,
} from '@fixora/ui';

import { useUiStore, type WorkspaceMode } from '../../stores/ui-store.js';

import { useWindowControls } from './use-window-controls.js';

/**
 * The custom title bar for the frameless window (Design Review §5). The wide central strip is the
 * OS drag region (`app-region: drag`); the wordmark and the three Windows-style controls sit on
 * top of it as non-draggable islands (`app-region: no-drag`), or they could not be clicked.
 *
 * The controls are buttons with real `aria-label`s — a frameless window must not cost keyboard or
 * screen-reader users the ability to minimise, maximise or close it. Close gets the conventional
 * red hover so muscle memory still finds it.
 */
export function TitleBar(): React.JSX.Element {
  const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();
  const primaryPanelVisible = useUiStore((s) => s.primaryPanelVisible);
  const aiPanelVisible = useUiStore((s) => s.aiPanelVisible);
  const togglePrimaryPanel = useUiStore((s) => s.togglePrimaryPanel);
  const toggleAiPanel = useUiStore((s) => s.toggleAiPanel);

  return (
    <header
      // The whole bar is draggable; interactive children opt out with `no-drag-region` below.
      className="drag-region flex h-10 shrink-0 items-center justify-between border-b border-border-subtle bg-raised pl-3 select-none"
    >
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight text-fg">
          <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
          Fixora
        </div>
        <ModeSwitcher />
        <div className="no-drag-region ml-2 flex items-center gap-0.5">
          <TitleBarButton
            label={primaryPanelVisible ? 'Hide sidebar' : 'Show sidebar'}
            title="Toggle Sidebar (Ctrl+B)"
            onClick={togglePrimaryPanel}
            dimmed={!primaryPanelVisible}
          >
            <SidebarLeftIcon className="size-4" />
          </TitleBarButton>
          <TitleBarButton
            label={aiPanelVisible ? 'Hide AI panel' : 'Show AI panel'}
            title="Toggle AI Panel (Ctrl+J)"
            onClick={toggleAiPanel}
            dimmed={!aiPanelVisible}
          >
            <SidebarRightIcon className="size-4" />
          </TitleBarButton>
        </div>
      </div>

      <div className="no-drag-region flex items-center">
        <TitleBarButton label="Minimize" onClick={minimize}>
          <WinMinimizeIcon className="size-4" />
        </TitleBarButton>
        <TitleBarButton label={isMaximized ? 'Restore' : 'Maximize'} onClick={toggleMaximize}>
          {isMaximized ? (
            <WinRestoreIcon className="size-4" />
          ) : (
            <WinMaximizeIcon className="size-4" />
          )}
        </TitleBarButton>
        <TitleBarButton label="Close" onClick={close} danger>
          <WinCloseIcon className="size-4" />
        </TitleBarButton>
      </div>
    </header>
  );
}

const MODES: readonly {
  id: WorkspaceMode;
  label: string;
  hint: string;
  Icon: typeof SparkleIcon;
}[] = [
  {
    id: 'fix',
    label: 'Fix & Analyze',
    hint: 'Problems lead — the repair-focused layout',
    Icon: SparkleIcon,
  },
  { id: 'code', label: 'Code', hint: 'The editor leads — files and code up front', Icon: FileIcon },
];

/**
 * The workbench-mode switcher: a real radiogroup, not two buttons that happen to look like one.
 *
 * `radiogroup`/`radio` with `aria-checked` is the role pair that tells a screen reader "these are
 * the two states of one setting, and this is the current one" — a pair of plain buttons announces
 * two unrelated actions and never says which is active. Arrow keys move between them for the same
 * reason, since that is what a radiogroup binds by convention.
 */
function ModeSwitcher(): React.JSX.Element {
  const mode = useUiStore((s) => s.workspaceMode);
  const setMode = useUiStore((s) => s.setWorkspaceMode);

  return (
    <div
      role="radiogroup"
      aria-label="Workbench mode"
      className="no-drag-region flex shrink-0 items-center gap-0.5 rounded-lg bg-inset p-0.5"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        setMode(mode === 'fix' ? 'code' : 'fix');
      }}
    >
      {MODES.map(({ id, label, hint, Icon }) => {
        const active = mode === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            // Only the active option is in the tab order — a radiogroup is one stop, and the arrow
            // keys above move within it.
            tabIndex={active ? 0 : -1}
            title={hint}
            onClick={() => {
              setMode(id);
            }}
            className={cn(
              'flex items-center gap-1.5 rounded px-2 py-1 text-[12px] tracking-tight transition-colors duration-(--fx-motion-duration-fast) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline',
              active
                ? 'bg-raised font-semibold text-fg shadow-sm ring-1 ring-border-subtle'
                : 'text-fg-muted hover:bg-raised/50 hover:text-fg',
            )}
          >
            <Icon className="size-3 shrink-0" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

function TitleBarButton({
  label,
  title,
  onClick,
  danger = false,
  dimmed = false,
  children,
}: {
  label: string;
  /** Tooltip text; falls back to `label` when omitted. */
  title?: string;
  onClick: () => void;
  danger?: boolean;
  /** Muted styling for a toggle button in its "off" state — e.g. a hidden panel. */
  dimmed?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      className={cn(
        danger
          ? 'h-10 w-12 rounded-none text-fg-muted hover:bg-danger hover:text-on-danger'
          : 'h-10 w-12 rounded-none text-fg-muted hover:bg-hover hover:text-fg',
        dimmed && 'text-fg-muted',
      )}
    >
      {children}
    </Button>
  );
}
