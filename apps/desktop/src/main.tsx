import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App.js';
import './styles/global.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html is missing #root — the document we shipped is not the one we built.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
