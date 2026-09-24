import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import App from './App.tsx';

// Re-exported so scripts/prerender.mjs can pull the same title/description/
// JSON-LD source of truth the client uses (@/seo/meta) out of this one SSR
// bundle, instead of building and importing a second bundle just for that.
export { SITE_URL, pageMeta, buildJsonLd, DEFAULT_TITLE, DEFAULT_DESCRIPTION, PRERENDERED_ROUTES } from '@/seo/meta';

// Build-time only: scripts/prerender.mjs imports this (via a `vite build
// --ssr` bundle) and calls render(path) once per route in
// PRERENDERED_ROUTES, then splices the returned HTML into a static
// dist/<route>/index.html. usePageMeta's useEffect (in App.tsx) never
// runs here — renderToString doesn't run effects — so title/meta/JSON-LD
// for each route come from scripts/prerender.mjs reading src/seo/meta.ts
// directly, not from anything this file produces.
export function render(url: string): string {
  return renderToString(
    <StrictMode>
      <StaticRouter location={url}>
        <App />
      </StaticRouter>
    </StrictMode>,
  );
}