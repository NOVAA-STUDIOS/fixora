import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/app.js';
import { ErrorBoundary } from './app/error-boundary.js';
import './styles/global.css';

try {
  const ui = localStorage.getItem('fixora.ui');
  if (ui !== null) {
    const parsed = JSON.parse(ui) as { state?: Record<string, unknown> };
    if (parsed.state !== undefined) {
      delete parsed.state['panelLayout'];
    }
    localStorage.setItem('fixora.ui', JSON.stringify(parsed));
  }
} catch {
  /* ignore */
}

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html is missing #root — the document we shipped is not the one we built.');
}

createRoot(container).render(
  <StrictMode>
    {/* The outermost net. Anything a pane-level boundary does not catch lands here rather than
        blanking the window. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
