import { useEffect, useRef } from 'react';
import { useUpdatePrefs } from '@/api/mutations';
import type { Member } from '@/types/api';
import type { Density } from '@/types/theme';
import { useTheme } from '@/providers/ThemeProvider';

/**
 * Theme and density for signed-in members: changes apply instantly (local
 * state + `<html>` attributes) and are persisted to the member's server-side
 * preferences so they follow the person to another browser.
 */
export function useThemeControls() {
  const { theme, density, setTheme, setDensity } = useTheme();
  const updatePrefs = useUpdatePrefs();

  return {
    theme,
    density,
    toggleTheme: () => {
      const next = theme === 'light' ? 'dark' : 'light';
      setTheme(next);
      updatePrefs.mutate({ theme: next });
    },
    changeDensity: (next: Density) => {
      setDensity(next);
      updatePrefs.mutate({ density: next });
    },
  };
}

/** Adopts the member's stored preferences once, when their session loads. */
export function useAdoptMemberPrefs(member: Member): void {
  const { setTheme, setDensity } = useTheme();
  const adopted = useRef(false);

  useEffect(() => {
    if (adopted.current) return;
    adopted.current = true;
    setTheme(member.theme);
    setDensity(member.density);
  }, [member.theme, member.density, setTheme, setDensity]);
}
