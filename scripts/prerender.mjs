// Runs after both `vite build` (client) and `vite build --ssr
// src/entry-server.tsx --outDir dist-ssr` have already produced dist/ and
// dist-ssr/. For each route in PRERENDERED_ROUTES this:
//   1. Calls the SSR bundle's render(path) to get real HTML for #root.
//   2. Takes the already-built dist/index.html as a template and swaps in
//      that route's title/description/canonical/OG/Twitter/JSON-LD tags
//      (computed from the same src/seo/meta.ts the client uses, re-exported
//      by entry-server.tsx into this same bundle) plus the rendered #root
//      markup.
//   3. Writes the result to dist/<route>/index.html (dist/index.html
//      itself for "/"), so Netlify serves the real file directly for that
//      path instead of falling through to the generic SPA shell.
// dist-ssr/ is deleted afterward — it's a build-time intermediate, never
// deployed.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// import.meta.dirname needs Node 20.11+/21.2+ — derive it the
// version-independent way instead so this doesn't silently break on an
// older Node (e.g. whatever a CI/build image happens to ship).
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const distDir = path.join(root, 'dist');
const ssrEntry = path.join(root, 'dist-ssr', 'entry-server.js');

if (!existsSync(distDir)) {
  throw new Error(`dist/ not found at ${distDir} — run "vite build" before this script.`);
}
if (!existsSync(ssrEntry)) {
  throw new Error(`${ssrEntry} not found — run "vite build --ssr src/entry-server.tsx --outDir dist-ssr" before this script.`);
}

// pathToFileURL instead of a hand-built `file://${path}` string: on
// Windows a raw path has backslashes and a drive letter, neither of which
// is a valid file:// URL, so dynamic import() would fail there.
const { render, PRERENDERED_ROUTES, pageMeta, buildJsonLd, SITE_URL, DEFAULT_TITLE, DEFAULT_DESCRIPTION } =
  await import(pathToFileURL(ssrEntry).href);

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function replaceMetaContent(html, matchAttr, value) {
  const re = new RegExp(`(<meta[^>]*${matchAttr}[^>]*content=")[^"]*(")`, 'i');
  return html.replace(re, `$1${escapeHtml(value)}$2`);
}

async function main() {
  const template = await readFile(path.join(distDir, 'index.html'), 'utf-8');

  for (const route of PRERENDERED_ROUTES) {
    const meta = pageMeta[route] ?? { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION };
    const appHtml = render(route);
    const canonicalUrl = `${SITE_URL}${route === '/' ? '' : route}`;
    const jsonLd = buildJsonLd(route);

    let html = template;
    html = html.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`);
    html = html.replace(/<title>.*?<\/title>/, `<title>${escapeHtml(meta.title)}</title>`);
    html = replaceMetaContent(html, 'name="description"', meta.description);
    html = replaceMetaContent(html, 'property="og:title"', meta.title);
    html = replaceMetaContent(html, 'property="og:description"', meta.description);
    html = replaceMetaContent(html, 'property="og:url"', canonicalUrl);
    html = replaceMetaContent(html, 'name="twitter:title"', meta.title);
    html = replaceMetaContent(html, 'name="twitter:description"', meta.description);
    html = html.replace(/<link rel="canonical"[^>]*\/>/, `<link rel="canonical" href="${canonicalUrl}" />`);
    if (jsonLd) {
      html = html.replace(
        '</head>',
        `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n  </head>`,
      );
    }

    const outDir = route === '/' ? distDir : path.join(distDir, route);
    if (route !== '/') await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'index.html'), html, 'utf-8');
    console.log(`prerendered ${route} -> dist${route === '/' ? '' : route}/index.html`);
  }

  await rm(path.join(root, 'dist-ssr'), { recursive: true, force: true });
}

await main();