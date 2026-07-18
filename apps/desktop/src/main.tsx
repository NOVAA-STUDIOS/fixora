import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App.js';
import { ErrorBoundary } from './app/error-boundary.js';
import './styles/global.css';

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
