import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Density, Theme } from '@/types/theme';
import type { ThemeContextValue, ThemeProviderProps } from './types/themeProvider';

// The inline script in index.html applies these before first paint (no flash);
// this provider adopts them, and mirrors every change back to <html> and
// localStorage. Once auth lands (PR 3), changes also persist to the signed-in
// member's server-side preferences.
const THEME_KEY = 'inv.theme';
const DENSITY_KEY = 'inv.density';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  );
  const [density, setDensityState] = useState<Density>(() =>
    document.documentElement.dataset.density === 'compact' ? 'compact' : 'comfortable',
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.density = density;
    window.localStorage.setItem(DENSITY_KEY, density);
  }, [density]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const setDensity = useCallback((next: Density) => setDensityState(next), []);
  const toggleTheme = useCallback(
    () => setThemeState((current) => (current === 'light' ? 'dark' : 'light')),
    [],
  );

  const value = useMemo(
    () => ({ theme, density, setTheme, setDensity, toggleTheme }),
    [theme, density, setTheme, setDensity, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
