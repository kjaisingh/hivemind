import { useEffect, useState } from 'react';

const STORAGE_KEY = 'hivemind-theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEY, theme);
  window.dispatchEvent(new CustomEvent('hivemind-theme-change', { detail: theme }));
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'light');

  useEffect(() => {
    const handleThemeChange = (event) => setTheme(event.detail);
    window.addEventListener('hivemind-theme-change', handleThemeChange);
    return () => window.removeEventListener('hivemind-theme-change', handleThemeChange);
  }, []);

  function toggleTheme() {
    applyTheme(theme === 'dark' ? 'light' : 'dark');
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
