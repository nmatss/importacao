(function () {
  try {
    var theme = localStorage.getItem('theme');
    var prefersDark =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (theme === 'dark' || ((!theme || theme === 'system') && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch (_) {
    // Keep first paint unblocked when storage is unavailable.
  }
})();
