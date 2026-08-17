import type { ReactNode } from 'react';
import type { Density, Theme } from '@/types/theme';

export interface ThemeContextValue {
  theme: Theme;
  density: Density;
  setTheme: (theme: Theme) => void;
  setDensity: (density: Density) => void;
  toggleTheme: () => void;
}

export interface ThemeProviderProps {
  children: ReactNode;
}
