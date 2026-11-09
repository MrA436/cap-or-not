import colors from 'tailwindcss/colors.js';
import plugin from 'tailwindcss/plugin.js';

/**
 * Theme colours are CSS variables, so light and dark mode are decided in ONE
 * place (this file) instead of by adding `dark:` variants to every class in
 * every component. Existing classes like `bg-white`, `text-gray-900` and
 * `border-red-200` keep working unchanged and follow the active theme.
 *
 * - Light mode: every shade up to 600 is moved one step darker than Tailwind's
 *   default, so near-white greys, borders, placeholders and tinted badges no
 *   longer blend into white backgrounds.
 * - Dark mode (`<html class="dark">`): the scale is flipped (light shades become
 *   dark surfaces, dark shades become light text).
 */
const FAMILIES = ['gray', 'red', 'emerald', 'amber', 'blue', 'orange'];
const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];

const LIGHT_SHIFT = { 50: '100', 100: '200', 200: '300', 300: '400', 400: '500', 500: '600', 600: '700' };

const DARK_GRAY = { 50: '950', 100: '800', 200: '700', 300: '600', 400: '400', 500: '300', 600: '200', 700: '200', 800: '100', 900: '50', 950: '50' };
const DARK_COLOR = { 50: '950', 100: '900', 200: '800', 300: '700', 400: '600', 500: '500', 600: '400', 700: '300', 800: '200', 900: '100', 950: '50' };

const toRgb = (hex) => {
  const h = hex.replace('#', '');
  return `${parseInt(h.slice(0, 2), 16)} ${parseInt(h.slice(2, 4), 16)} ${parseInt(h.slice(4, 6), 16)}`;
};

const light = { '--c-white': '255 255 255' };
const dark = { '--c-white': toRgb(colors.gray[900]) };
const themeColors = { white: 'rgb(var(--c-white) / <alpha-value>)' };

for (const fam of FAMILIES) {
  themeColors[fam] = {};
  const darkMap = fam === 'gray' ? DARK_GRAY : DARK_COLOR;
  for (const shade of SHADES) {
    light[`--c-${fam}-${shade}`] = toRgb(colors[fam][LIGHT_SHIFT[shade] ?? shade]);
    dark[`--c-${fam}-${shade}`] = toRgb(colors[fam][darkMap[shade]]);
    themeColors[fam][shade] = `rgb(var(--c-${fam}-${shade}) / <alpha-value>)`;
  }
}

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: themeColors,
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({ ':root': light, '.dark': dark });
    }),
  ],
};