import { useEffect } from 'react';

/**
 * A document-level ⌘/Ctrl shortcut, wherever focus is — a field included.
 * Whether the handler should act right now is the handler's question; the
 * palette's, for one, declines while a dialog is open.
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
