import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs with globals disabled, so Testing Library cannot register its
// automatic cleanup hook — do it explicitly.
afterEach(() => {
  cleanup();
});

// jsdom implements no layout, so it has no scrollIntoView. Anything that keeps
// a keyboard-driven highlight in view (the command palette) calls it, and a
// missing method would throw where a real browser simply scrolls.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Node's experimental localStorage global (undefined without --localstorage-file)
// shadows jsdom's implementation in Vitest's jsdom environment. Install a real
// in-memory Storage so code under test sees the browser API.
if (typeof window !== 'undefined' && !window.localStorage) {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => void store.delete(key),
    setItem: (key, value) => void store.set(key, String(value)),
  };
  Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
}
