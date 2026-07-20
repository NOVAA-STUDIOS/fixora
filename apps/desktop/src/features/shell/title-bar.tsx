import { Button, WinCloseIcon, WinMaximizeIcon, WinMinimizeIcon, WinRestoreIcon } from '@fixora/ui';

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

  return (
    <header
      // The whole bar is draggable; interactive children opt out with `no-drag-region` below.
      className="drag-region flex h-10 shrink-0 items-center justify-between pl-3 select-none"
    >
      <div className="flex items-center gap-2 text-sm font-semibold tracking-tight text-fg">
        <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
        Fixora
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

function TitleBarButton({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      onClick={onClick}
      className={
        danger
          ? 'h-10 w-12 rounded-none text-fg-muted hover:bg-danger hover:text-on-danger'
          : 'h-10 w-12 rounded-none text-fg-muted hover:bg-hover hover:text-fg'
      }
    >
      {children}
    </Button>
  );
}
