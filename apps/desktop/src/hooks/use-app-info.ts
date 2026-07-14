import type { AppInfo, FixoraError } from '@fixora/shared-types';
import { useEffect, useState } from 'react';

import { invoke } from '../lib/bridge.js';

/**
 * The one wire call M0 makes, extracted from the component per Standards §3: "a component with
 * a useEffect doing data fetching is a hook that hasn't been extracted yet."
 *
 * From M1 this is a `useQuery` (TanStack Query owns anything that came over a wire, ADR-015).
 * It is a bare hook now only because the query client is an M1 deliverable — the *shape*
 * (a component that reads a result, never fetches) is already correct, so the M1 swap touches
 * this file and not `App.tsx`.
 */
export type AppInfoState =
  | { status: 'loading' }
  | { status: 'ready'; info: AppInfo }
  | { status: 'error'; error: FixoraError };

export function useAppInfo(): AppInfoState {
  const [state, setState] = useState<AppInfoState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    void invoke('system:getAppInfo', {}).then((result) => {
      if (cancelled) return;
      setState(
        result.ok
          ? { status: 'ready', info: result.value }
          : { status: 'error', error: result.error },
      );
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
