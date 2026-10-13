(function initializeTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem('hivemind-theme');
  } catch {
    // Fall back to the OS preference when storage is unavailable.
  }
  const theme = stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
})();
