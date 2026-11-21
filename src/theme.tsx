'use client';

import { useCallback, useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from './components/Icons.tsx';

export type Theme = 'light' | 'dark';

/** Saved choice; when nothing is saved the OS preference decides (set in index.html). */
export const THEME_KEY = 'lps_theme';
const readTheme = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode / storage disabled: the choice simply lasts for this page */
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#0a0a0a' : '#ffffff');
}

export function useTheme() {
  // the saved theme is applied to <html> by the inline script in the root layout before paint;
  // read it after mount so server and client markup match
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => setTheme(readTheme()), []);

  // keep other open tabs in sync
  useEffect(() => {
    const root = document.documentElement;
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        root.dataset.theme = e.newValue;
        root.style.colorScheme = e.newValue;
        setTheme(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return next;
    });
  }, []);

  return { theme, toggle };
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const next = dark ? 'bright' : 'dark';
  return (
    <button
      type="button"
      className={`btn ghost theme-toggle${compact ? ' compact' : ''}`}
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
      <span>{dark ? 'Bright mode' : 'Dark mode'}</span>
    </button>
  );
}
