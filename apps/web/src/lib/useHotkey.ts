import { useEffect } from 'react';

/**
 * A document-level shortcut. Skips the event when it lands in a field, so ⌘K
 * inside a text input is still whatever the browser wants it to be — the only
 * exception being the palette's own input, which is inside a dialog and closes
 * on Escape instead.
 */
export function useHotkey(key: string, handler: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== key) return;
      event.preventDefault();
      handler();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [key, handler]);
}
