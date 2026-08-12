(() => {
  try {
    const savedTheme = localStorage.getItem('istek_demirbas_theme');
    const theme =
      savedTheme === 'dark' || savedTheme === 'light'
        ? savedTheme
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';

    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0b3b5f' : '#0066b1');
  } catch {
    document.documentElement.dataset.theme = 'light';
  }
})();
