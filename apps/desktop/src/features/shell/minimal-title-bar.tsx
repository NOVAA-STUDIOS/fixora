import { WinCloseIcon, WinMinimizeIcon } from '@fixora/ui';

import { useWindowControls } from './use-window-controls.js';

/**
 * Minimize + close only, for the two screens that render before `AppShell` (and its full
 * `TitleBar`) ever mounts — the login gate and the auth-loading screen. Without this, a frameless
 * window (`frame: false`) leaves the user unable to minimize or close it except via the OS
 * taskbar or Alt+F4.
 */
export function MinimalTitleBar(): React.JSX.Element {
  const { minimize, close } = useWindowControls();

  return (
    <div className="drag-region absolute top-0 right-0 left-0 flex h-8 items-center justify-end">
      <button
        type="button"
        aria-label="Minimize"
        onClick={minimize}
        className="no-drag-region flex h-8 w-12 items-center justify-center text-white/50 hover:bg-white/10 hover:text-white"
      >
        <WinMinimizeIcon className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="no-drag-region flex h-8 w-12 items-center justify-center text-white/50 hover:bg-[#ef4444] hover:text-white"
      >
        <WinCloseIcon className="size-4" />
      </button>
    </div>
  );
}
