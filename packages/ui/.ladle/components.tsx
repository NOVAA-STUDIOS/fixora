import type { GlobalProvider } from '@ladle/react';
import { useEffect } from 'react';

import './ladle.css';

/**
 * Wraps every story. Ladle's control panel exposes `theme` and `density` args; this reflects them
 * onto the document root, where the token layer reads them — so a reviewer can flip light/dark and
 * compact/comfortable and see every primitive respond, which is precisely what the workbench is
 * for (Design Review §6: build both themes and both densities from day one).
 */
export const Provider: GlobalProvider = ({ children, globalState }) => {
  const theme = globalState.control['theme']?.value ?? 'dark';
  const density = globalState.control['density']?.value ?? 'comfortable';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', String(theme));
    document.documentElement.setAttribute('data-density', String(density));
  }, [theme, density]);

  return <div className="p-6">{children}</div>;
};

export const args = {
  theme: {
    control: { type: 'select' },
    options: ['dark', 'light'],
    defaultValue: 'dark',
  },
  density: {
    control: { type: 'select' },
    options: ['comfortable', 'compact'],
    defaultValue: 'comfortable',
  },
};
