import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const STORAGE_KEY = 'capornot_theme';

/**
 * Light / dark switch. The initial theme is applied before first paint by
 * public/theme-init.js; this only reads it back (in an effect, so the
 * prerendered HTML and the first client render always match) and flips it.
 */
export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
    setMounted(true);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      /* storage unavailable — the switch still works for this visit */
    }
  };

  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
    >
      {mounted ? (dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />) : <span className="block w-5 h-5" />}
    </button>
  );
}