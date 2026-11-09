// Applies the saved (or system) colour theme before first paint, so there is no
// white flash in dark mode. Kept as an external file on purpose: the site's
// Content-Security-Policy (public/_headers) blocks inline scripts.
(function () {
  try {
    var saved = localStorage.getItem('capornot_theme');
    var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();