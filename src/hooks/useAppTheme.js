import { useCallback, useEffect, useState } from 'react';

export const APP_THEME_STORAGE_KEY = 'istek_demirbas_theme';

function resolveInitialTheme() {
  if (typeof document !== 'undefined') {
    const bootstrappedTheme = document.documentElement.dataset.theme;
    if (bootstrappedTheme === 'dark' || bootstrappedTheme === 'light') {
      return bootstrappedTheme;
    }
  }

  if (typeof window === 'undefined') return 'light';

  try {
    const savedTheme = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
    if (savedTheme === 'dark' || savedTheme === 'light') return savedTheme;
  } catch {
    // Depolama kapalıysa sistem tercihi kullanılmaya devam eder.
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useAppTheme() {
  const [theme, setTheme] = useState(resolveInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;

    const themeColor = theme === 'dark' ? '#11161d' : '#f8fafc';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);

    try {
      window.localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
    } catch {
      // Tema yine uygulanır; yalnızca sonraki açılışa kaydedilemez.
    }
  }, [theme]);

  useEffect(() => {
    const handleStorage = (event) => {
      if (
        event.key === APP_THEME_STORAGE_KEY &&
        (event.newValue === 'dark' || event.newValue === 'light')
      ) {
        setTheme(event.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'));
  }, []);

  return {
    theme,
    isDark: theme === 'dark',
    toggleTheme,
  };
}
