import { useCallback, useEffect, useState } from 'react';

import { invoke, subscribe } from '../../lib/bridge.js';

/**
 * The state and actions the custom title bar's window controls need. `isMaximized` is seeded from
 * main and then kept in sync by the `window:maximizedChanged` push — because the window can be
 * maximised by routes the renderer never sees (OS snap shortcut, double-click on the drag region),
 * the button reflects main's truth rather than guessing from its own last click.
 */
export function useWindowControls(): {
  isMaximized: boolean;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
} {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void invoke('window:isMaximized', {}).then((result) => {
      if (!cancelled && result.ok) setIsMaximized(result.value.isMaximized);
    });
    const unsubscribe = subscribe('window:maximizedChanged', ({ isMaximized: next }) => {
      setIsMaximized(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const minimize = useCallback(() => {
    void invoke('window:minimize', {});
  }, []);

  const toggleMaximize = useCallback(() => {
    void invoke('window:toggleMaximize', {}).then((result) => {
      // Optimistically reflect the returned state; the push event will confirm it.
      if (result.ok) setIsMaximized(result.value.isMaximized);
    });
  }, []);

  const close = useCallback(() => {
    void invoke('window:close', {});
  }, []);

  return { isMaximized, minimize, toggleMaximize, close };
}
