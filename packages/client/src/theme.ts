import { useEffect, useState } from 'react';

/** auto folgt der Geräteeinstellung */
export type Theme = 'auto' | 'light' | 'dark';

export const THEMES: { id: Theme; label: string; title: string }[] = [
  { id: 'light', label: '☀', title: 'Hell' },
  { id: 'auto', label: 'Auto', title: 'Geräteeinstellung' },
  { id: 'dark', label: '☾', title: 'Dunkel' },
];

const KEY = 'dog.theme';

export const parseTheme = (v: unknown): Theme => (v === 'light' || v === 'dark' ? v : 'auto');

export function savedTheme(): Theme {
  try {
    return parseTheme(localStorage.getItem(KEY));
  } catch {
    return 'auto';
  }
}

/** Setzt das Farbschema auf der Seite; bei auto entscheidet die Geräteeinstellung (CSS) */
export function applyTheme(t: Theme): void {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(savedTheme);
  useEffect(() => applyTheme(theme), [theme]);
  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      if (t === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, t);
    } catch {
      /* ohne Speicher gilt die Wahl bis zum Neuladen */
    }
  };
  return [theme, setTheme];
}
