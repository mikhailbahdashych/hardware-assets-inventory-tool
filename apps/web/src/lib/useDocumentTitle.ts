import { useEffect } from 'react';

/**
 * Names the browser tab. index.html ships "Inventory" and it stays until a
 * page knows better, so a tab is never nameless — only ever one step stale.
 */
export function useDocumentTitle(title: string | undefined): void {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}
