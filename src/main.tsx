import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';

const rootEl = document.getElementById('root')!;
const app = (
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

// Prerendered routes (scripts/prerender.mjs — see src/seo/meta.ts's
// PRERENDERED_ROUTES) ship real markup inside #root already, so hydrate
// it instead of discarding and re-rendering from scratch. Routes that
// were never prerendered (/check, /result/:id, 404) load a #root with
// nothing (or a stale SPA-fallback page) in it — hasChildNodes() tells
// the two cases apart and falls back to a normal client render for those.
if (rootEl.hasChildNodes()) {
  hydrateRoot(rootEl, app);
} else {
  createRoot(rootEl).render(app);
}