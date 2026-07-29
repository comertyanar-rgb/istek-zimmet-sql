import React from 'react';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle({ theme, onToggle, showLabel = false, className = '' }) {
  const isDark = theme === 'dark';
  const label = isDark ? 'Açık temaya geç' : 'Koyu temaya geç';
  const Icon = isDark ? Sun : Moon;

  if (showLabel) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={isDark}
        onClick={onToggle}
        className={`app-theme-switch ${className}`}
        title={label}
        aria-label={label}
      >
        <span className="app-theme-switch__label">
          <Moon className="h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden="true" />
          <span>Koyu tema</span>
        </span>
        <span
          className={`app-theme-switch__track ${isDark ? 'app-theme-switch__track--active' : ''}`}
          aria-hidden="true"
        >
          <span className="app-theme-switch__thumb" />
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`app-theme-toggle ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={isDark}
    >
      <Icon className="h-5 w-5 shrink-0" strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}
